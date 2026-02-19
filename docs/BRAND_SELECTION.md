# Brand Selection System Architecture

> **Document Version:** 1.2  
> **Last Updated:** February 22, 2026  
> **Author:** System Architect  
> **Status:** Implementation Reference

---

## Change Log

| Date | Version | Changes |
|------|---------|--------|
| Feb 22, 2026 | 1.2 | Added Brand Config Overrides section (voice, schedule, music advanced) — Brand Profiles #24 |
| Feb 8, 2026 | 1.1 | Added "Authoritative Brand for an Operation" section (Gap 1 clarification) |
| Feb 8, 2026 | 1.1 | Added "Cross-Tab Safety" section explaining multi-tab behavior |
| Feb 8, 2026 | 1.0 | Initial document |

---

## Table of Contents

1. [Overview](#1-overview)
2. [Storage Mechanism](#2-storage-mechanism)
3. [Core Components](#3-core-components)
4. [Data Flow](#4-data-flow)
5. [UI Components](#5-ui-components)
6. [Database Integration](#6-database-integration)
7. [Cross-Page Consistency](#7-cross-page-consistency)
8. [Event System](#8-event-system)
9. [Edge Cases & Fallbacks](#9-edge-cases--fallbacks)
10. [Integration with Other Systems](#10-integration-with-other-systems)

---

## 1. Overview

### What Is Brand Context?

The **Brand Context** is the currently selected/active brand that determines the scope of all operations across the admin panel. When you select a brand:

- Video generation uses that brand's presets and templates
- Platform connections filter to that brand's accounts
- Posts display for that brand only
- Campaigns are created under that brand
- Theme colors update to match brand identity

### Why This Architecture?

| Concern | Solution |
|---------|----------|
| **Consistency** | Same brand across all pages without re-selecting |
| **Persistence** | Brand selection survives page refresh |
| **Multi-source sync** | localStorage + Supabase stay in sync |
| **Visual feedback** | Navbar always shows current brand |
| **No URL pollution** | Brand is not in query params (cleaner URLs) |

### Authoritative Brand for an Operation

**Key Invariant**: Any long-running operation (e.g., "Create Campaign") must resolve the active brand **at request start** and use that `brand_id` consistently through the entire operation.

| Concept | Definition |
|---------|------------|
| **Resolution Point** | `BrandManager.getActiveBrand()` at the moment the user clicks "Create" (or API endpoint is called) |
| **Immutability** | Once resolved, that `brand_id` is passed into the operation and stored on `generation_batches.brand_id` and each `jobs.brand_id` |
| **No Mid-Operation Re-check** | The operation must NOT re-query `brands.is_active` mid-flight |

```javascript
// CORRECT: Resolve brand once at start
async function createCampaign(config) {
    const brand = brandManager.getActiveBrand(); // ← Resolution point
    if (!brand) throw new Error('No active brand');
    
    const brand_id = brand.id; // ← Lock this value
    
    // All subsequent operations use brand_id, never re-check
    await db.transaction(async (tx) => {
        const batch = await tx.insert('generation_batches', { brand_id, ... });
        for (const job of jobs) {
            await tx.insert('jobs', { brand_id, batch_id: batch.id, ... });
        }
    });
}
```

### Cross-Tab Safety

**Reality**: localStorage is shared across all tabs in the same browser profile. If a user has multiple tabs open and changes the brand in one tab, the other tabs will see the new value on their next localStorage read.

**Intended Behavior** (no surprises):

| Scenario | Behavior |
|----------|----------|
| Tab A starts "Create Campaign" for Brand X | Brand X is resolved and locked at request start |
| Tab B changes active brand to Brand Y (mid-operation) | Tab A's operation continues with Brand X |
| Tab A completes | Campaign and all jobs belong to Brand X |
| Tab A's UI refreshes | Now shows Brand Y (current active brand) |

**Critical Rule**: If another tab changes `brands.is_active` in Supabase or localStorage, it must **not** affect:
- Already-planned campaigns
- Already-created jobs
- In-progress operations

The `brand_id` stored on `generation_batches` and `jobs` is the source of truth for that data, not the current active brand context.

---

## 2. Storage Mechanism

### Primary: localStorage

The active brand ID is stored in localStorage for instant client-side access:

```
Key: contentengine_active_brand
Value: <brand_id> (UUID string)

Example:
localStorage.getItem('contentengine_active_brand')
// Returns: "550e8400-e29b-41d4-a716-446655440000"
```

**Why localStorage?**
- Instant read (no async/network delay)
- Survives page refresh
- Works offline
- No server round-trip needed

### Secondary: Supabase Database

The `brands` table has an `is_active` boolean column:

```sql
-- In brands table
is_active BOOLEAN DEFAULT false

-- Only one brand can be active at a time (per user)
```

**Why Supabase?**
- Persistent across devices (if needed)
- Source of truth for brand data
- Enables future multi-device sync

### Tertiary: In-Memory (BrandManager)

The `BrandManager` class keeps the active brand ID in memory:

```javascript
class BrandManager {
    constructor() {
        this.activeBrandId = null;  // In-memory cache
        // ...
    }
}
```

**Why In-Memory?**
- Fastest access during page session
- No storage API calls needed
- Updated by events

---

## 3. Core Components

### 3.1 BrandManager Service

**Location:** `js/services/brandManager.js`

The central service for all brand operations.

```
┌─────────────────────────────────────────────────────────────────┐
│                      BRAND MANAGER                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Properties:                                                    │
│  ├── brands: Map<string, Brand>    // All loaded brands        │
│  ├── activeBrandId: string | null  // Currently selected       │
│  ├── useSupabase: boolean          // Supabase available?      │
│  └── initialized: boolean          // Init complete?           │
│                                                                 │
│  Key Methods:                                                   │
│  ├── init()                        // Load brands on startup   │
│  ├── setActive(id)                 // Change active brand      │
│  ├── getActiveBrand()              // Get current brand        │
│  ├── getAll()                      // List all brands          │
│  └── on(event, callback)           // Event subscription       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Key Methods Explained

#### `init()`

Called once on page load. Loads brands from storage:

```javascript
async init() {
    if (this.initialized) return;

    // Determine storage backend
    this.useSupabase = typeof supabaseClient !== 'undefined';
    
    if (this.useSupabase) {
        await this.loadFromSupabase();
    } else {
        this.loadFromLocalStorage();
    }

    this.initialized = true;
}
```

#### `setActive(id)`

Changes the active brand and updates all storage layers:

```javascript
async setActive(id) {
    const brand = this.get(id);
    if (!brand) return;

    // 1. Update in-memory
    this.activeBrandId = id;

    // 2. Update Supabase (if available)
    if (this.useSupabase) {
        // Deactivate all others
        await supabaseClient
            .from('brands')
            .update({ is_active: false })
            .neq('id', id);

        // Activate this one
        await supabaseClient
            .from('brands')
            .update({ is_active: true })
            .eq('id', id);
    }

    // 3. Emit event for UI updates
    this.emit('brand:activated', brand);
    
    // 4. Update localStorage
    localStorage.setItem('contentengine_active_brand', id);

    // 5. Apply visual theme
    this.applyBrandTheme(brand);
}
```

#### `getActiveBrand()`

Returns the currently active brand object:

```javascript
getActiveBrand() {
    return this.activeBrandId ? this.get(this.activeBrandId) : null;
}
```

### 3.3 BrandSwitcher Component

**Location:** `js/components/brand-switcher.js`

The navbar dropdown for brand selection.

```
┌─────────────────────────────────────────────────────────────────┐
│                     BRAND SWITCHER UI                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────────────────────┐                              │
│   │ ● Stories That Stalk   ▼   │  ← Toggle button              │
│   └─────────────────────────────┘                              │
│   ┌─────────────────────────────┐                              │
│   │ ● Stories That Stalk   ✓   │  ← Active brand (checked)    │
│   │ ● Crime Chronicles         │  ← Other brands               │
│   │ ● Sci-Fi Shorts            │                               │
│   │ ─────────────────────────  │                               │
│   │ ⚙ Manage Brands            │  ← Link to brands.html        │
│   └─────────────────────────────┘                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Data Flow

### 4.1 On Page Load

```
┌──────────────────────────────────────────────────────────────────┐
│                     PAGE LOAD SEQUENCE                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. HTML loads                                                  │
│      │                                                           │
│      ▼                                                           │
│   2. brandManager.init() called                                  │
│      │                                                           │
│      ├──► Check: Supabase available?                             │
│      │    ├── YES → loadFromSupabase()                           │
│      │    │         ├── Fetch brands from DB                     │
│      │    │         ├── Check is_active flag in DB               │
│      │    │         └── Fall back to localStorage if no active   │
│      │    │                                                      │
│      │    └── NO → loadFromLocalStorage()                        │
│      │              ├── Parse stored brands JSON                 │
│      │              └── Read contentengine_active_brand          │
│      │                                                           │
│      ▼                                                           │
│   3. Set activeBrandId from resolved source                      │
│      │                                                           │
│      ▼                                                           │
│   4. applyBrandTheme() - CSS variables updated                   │
│      │                                                           │
│      ▼                                                           │
│   5. emit('brands:loaded') - UI components re-render             │
│      │                                                           │
│      ▼                                                           │
│   6. BrandSwitcher.render() - Navbar shows current brand         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 On Brand Switch

```
┌──────────────────────────────────────────────────────────────────┐
│                    BRAND SWITCH SEQUENCE                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. User clicks brand in dropdown                               │
│      │                                                           │
│      ▼                                                           │
│   2. BrandSwitcher.selectBrand(brandId) called                   │
│      │                                                           │
│      ▼                                                           │
│   3. brandManager.setActive(brandId) called                      │
│      │                                                           │
│      ├──► Update in-memory: this.activeBrandId = id              │
│      │                                                           │
│      ├──► Update Supabase (async):                               │
│      │    ├── SET is_active=false WHERE id != brandId            │
│      │    └── SET is_active=true WHERE id = brandId              │
│      │                                                           │
│      ├──► Update localStorage:                                   │
│      │    └── setItem('contentengine_active_brand', brandId)     │
│      │                                                           │
│      ├──► Apply theme:                                           │
│      │    └── Set CSS variables (--brand-primary, etc.)          │
│      │                                                           │
│      └──► Emit event: 'brand:activated'                          │
│           │                                                      │
│           ▼                                                      │
│   4. All subscribed components receive event                     │
│      ├── BrandSwitcher.updateSelection() - Update dropdown       │
│      ├── CreatePage.loadActiveBrand() - Reload preset list       │
│      ├── ConnectionsPage - Filter platform connections           │
│      └── PostsPage - Filter displayed posts                      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. UI Components

### 5.1 Navbar Brand Indicator

Every page includes the brand switcher in the header:

```html
<!-- In all page headers -->
<div id="brand-switcher"></div>

<script>
    // Initialize on page load
    const brandSwitcher = new BrandSwitcher({
        selector: '#brand-switcher'
    });
    brandSwitcher.init();
</script>
```

### 5.2 Brand Context Display (Read-Only)

For pages like Campaign Creation where brand shouldn't be changeable mid-form:

```html
<!-- Campaign page brand display -->
<div class="brand-context">
    <span class="brand-indicator" style="background: var(--brand-primary)"></span>
    <span class="brand-name">Stories That Stalk</span>
    <span class="brand-niche">(horror)</span>
    <span class="brand-source">from navbar</span>
</div>
```

This displays the current brand without allowing changes, preventing accidental campaign creation under wrong brand.

### 5.3 No Brand Selected State

When no brand is active, pages show a prompt:

```html
<div class="no-brand-notice">
    <h3>No Brand Selected</h3>
    <p>Please select a brand from the dropdown above to continue.</p>
</div>
```

---

## 6. Database Integration

### 6.1 Brands Table Schema

```sql
CREATE TABLE brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    niche TEXT NOT NULL,
    description TEXT,
    theme JSONB DEFAULT '{}',
    settings JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT false,  -- ← Active brand flag
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.2 Active Brand Query

```sql
-- Get active brand for current user
SELECT * FROM brands 
WHERE user_id = auth.uid() 
  AND is_active = true 
LIMIT 1;

-- Or get all brands with active status
SELECT *, is_active 
FROM brands 
WHERE user_id = auth.uid();
```

### 6.3 Switching Active Brand

```sql
-- Deactivate all brands
UPDATE brands 
SET is_active = false 
WHERE user_id = auth.uid();

-- Activate selected brand
UPDATE brands 
SET is_active = true 
WHERE id = $brandId 
  AND user_id = auth.uid();
```

---

## 7. Cross-Page Consistency

### 7.1 How Pages Stay In Sync

All pages read from the same sources in the same order:

```
Priority Order:
1. In-memory (if BrandManager already initialized)
2. localStorage (instant, survives refresh)
3. Supabase is_active flag (authoritative, but async)
```

### 7.2 Page Navigation Flow

```
Page A                      Page B
───────                     ───────
User on Create page         User navigates to Posts page
                            │
brandManager.activeBrandId  │  brandManager.init()
= "horror-brand"            │  │
                            │  ├── Check Supabase
localStorage:               │  │   └── is_active = horror-brand
active = "horror-brand"     │  │
                            │  ├── Check localStorage
Supabase:                   │  │   └── contentengine_active_brand
is_active = horror-brand    │  │       = "horror-brand"
                            │  │
                            │  ▼
                            │  activeBrandId = "horror-brand"
                            │  │
                            │  ▼
                            │  Posts filtered by horror-brand
```

### 7.3 Consistency Guarantees

| Scenario | Behavior |
|----------|----------|
| Page refresh | localStorage preserves selection |
| New tab | localStorage shared across tabs |
| Supabase offline | localStorage used as fallback |
| First visit | No brand selected until user chooses |
| Brand deleted | Falls back to first available brand |

---

## 8. Event System

### 8.1 Available Events

| Event | Fired When | Payload |
|-------|------------|---------|
| `brand:created` | New brand added | `Brand` object |
| `brand:updated` | Brand modified | `Brand` object |
| `brand:deleted` | Brand removed | `{ id: string }` |
| `brand:activated` | Active brand changed | `Brand` object |
| `brands:loaded` | Initial load complete | `{ count: number }` |

### 8.2 Subscribing to Events

```javascript
// In any component
brandManager.on('brand:activated', (brand) => {
    console.log('Brand switched to:', brand.name);
    this.reloadContent();
});

brandManager.on('brands:loaded', ({ count }) => {
    console.log(`${count} brands loaded`);
    this.render();
});
```

### 8.3 Event Implementation

```javascript
// In BrandManager
emit(eventName, data) {
    const listeners = this.listeners.get(eventName) || [];
    listeners.forEach(callback => {
        try {
            callback(data);
        } catch (e) {
            console.error(`Error in ${eventName} listener:`, e);
        }
    });
}

on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
        this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(callback);
}
```

---

## 9. Edge Cases & Fallbacks

### 9.1 No Brands Exist

```javascript
// In pages that require a brand
async loadActiveBrand() {
    let brand = brandManager.getActiveBrand();
    
    if (!brand) {
        // Try to get any available brand
        const allBrands = brandManager.getAll();
        if (allBrands.length > 0) {
            brand = allBrands[0];
            await brandManager.setActive(brand.id);
        }
    }
    
    if (!brand) {
        // No brands at all - show creation prompt
        this.showNoBrandNotice();
        return null;
    }
    
    return brand;
}
```

### 9.2 Stored Brand No Longer Exists

```javascript
// In BrandManager.loadFromSupabase()
const localActive = localStorage.getItem('contentengine_active_brand');

if (localActive && this.brands.has(localActive)) {
    // Brand still exists, use it
    this.activeBrandId = localActive;
} else if (localActive) {
    // Brand was deleted, clear stale reference
    localStorage.removeItem('contentengine_active_brand');
}
```

### 9.3 Supabase Unavailable

```javascript
// In BrandManager.init()
this.useSupabase = typeof supabaseClient !== 'undefined' && supabaseClient !== null;

if (this.useSupabase) {
    try {
        await this.loadFromSupabase();
    } catch (e) {
        console.error('Supabase load failed, falling back to localStorage');
        this.loadFromLocalStorage();
    }
} else {
    this.loadFromLocalStorage();
}
```

### 9.4 Race Condition: Multiple Tabs

localStorage changes are visible across tabs, but the in-memory state is not automatically synced. Future enhancement:

```javascript
// Potential future implementation
window.addEventListener('storage', (e) => {
    if (e.key === 'contentengine_active_brand') {
        const newBrandId = e.newValue;
        if (newBrandId !== this.activeBrandId) {
            this.activeBrandId = newBrandId;
            this.emit('brand:activated', this.get(newBrandId));
        }
    }
});
```

---

## 10. Integration with Other Systems

### 10.1 Campaign System

Campaigns read brand from current context:

```javascript
// In campaign creation
const brand = brandManager.getActiveBrand();
if (!brand) {
    showError('Please select a brand first');
    return;
}

// Create campaign under this brand
await createCampaign({
    brand_id: brand.id,
    // ... other config
});
```

See [CAMPAIGN_SYSTEM.md](./CAMPAIGN_SYSTEM.md) for full details.

### 10.2 Platform Connections

YouTube/Instagram connections are per-brand:

```javascript
// In YouTubeService
setBrand(brandId) {
    this.currentBrandId = brandId;
    // Load connections for this brand
}

// On brand switch
brandManager.on('brand:activated', (brand) => {
    youtubeService.setBrand(brand.id);
    metaService.setBrand(brand.id);
});
```

### 10.3 Post Creation/Display

Posts are filtered by active brand:

```javascript
// Query posts for active brand only
const { data: posts } = await supabaseClient
    .from('posts')
    .select('*')
    .eq('brand_id', brandManager.getActiveBrand()?.id);
```

### 10.4 Theme Application

Brand colors are applied as CSS variables:

```javascript
applyBrandTheme(brand) {
    if (!brand) return;

    // Set data attribute for CSS selectors
    document.documentElement.setAttribute('data-brand', brand.niche);
    
    // Set CSS custom properties
    const root = document.documentElement;
    root.style.setProperty('--brand-primary', brand.theme.primaryColor);
    root.style.setProperty('--brand-secondary', brand.theme.secondaryColor);
    root.style.setProperty('--brand-accent', brand.theme.accentColor);
}
```

CSS can then use these:

```css
.brand-indicator {
    background: var(--brand-primary);
}

[data-brand="horror"] .sidebar {
    background: var(--brand-secondary);
}
```

---

## Appendix: Quick Reference

### Storage Keys

| Key | Location | Purpose |
|-----|----------|---------|
| `contentengine_active_brand` | localStorage | Active brand ID |
| `contentengine_brands` | localStorage | Cached brand list (backup) |
| `brands.is_active` | Supabase | Authoritative active flag |

### Key Files

| File | Purpose |
|------|---------|
| `js/services/brandManager.js` | Core brand management service |
| `js/components/brand-switcher.js` | Navbar dropdown component |
| `js/models/Brand.js` | Brand data model |
| `supabase/migrations/20260203_brands_schema.sql` | Database schema |

### Common Operations

```javascript
// Get current brand
const brand = brandManager.getActiveBrand();

// Switch brand
await brandManager.setActive(brandId);

// Check if brand is selected
if (!brandManager.getActiveBrand()) {
    // Handle no brand state
}

// Listen for changes
brandManager.on('brand:activated', (brand) => {
    // React to brand change
});
```

---

## Document End

This document describes the brand selection system as implemented. For questions about how brands integrate with video generation, see [CAMPAIGN_SYSTEM.md](./CAMPAIGN_SYSTEM.md).

---

## 11. Brand Config Overrides (v1.2)

Brand-level configuration is stored in `brand_templates.config_overrides` (JSONB). Each config domain has a dedicated UI modal on the Brands page and corresponding `BrandManager` methods.

### 11.1 Config Override Keys

| Key | UI Modal | Purpose | Worker Integration |
|-----|----------|---------|-------------------|
| `music` | Music Config | Track selection, ducking, fades | `executeMusicStep()` reads config |
| `effects` | Effects Config | Intensity, Ken Burns, grain, flicker | `assembleWithRenderer()` reads config |
| `subtitles` | Subtitles Config | Font, size, position, colors | `executeSubtitleStep()` reads config |
| `image_prompt` | Image Config | Style, negative prompts, model | `executeImageStep()` reads config |
| `voice` | Voice Config | TTS voice, instructions, speed | `getPresetVoiceConfig()` merges brand override |
| `schedule` | Schedule Config | Posting hours, active days, limits | Future scheduler integration |

### 11.2 Voice Config (`config_overrides.voice`)

Added in Brand Profiles (#24). Allows per-brand TTS voice selection.

```json
{
  "voice": "onyx",
  "custom_instructions": "Speak slowly with dramatic pauses",
  "speed": 0.95
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `voice` | string | (preset default) | OpenAI TTS voice: alloy, echo, fable, onyx, nova, shimmer, ash, coral, sage |
| `custom_instructions` | string | `""` | Additional voice direction appended to system prompt |
| `speed` | number | `1.0` | TTS speed multiplier (0.7–1.3) |

**Worker merge order:** Brand voice config > Preset-specific voice > Global default (`onyx`)

**BrandManager methods:**
- `getVoiceConfig(brandId)` — reads from default template's `config_overrides.voice`
- `saveVoiceConfig(brandId, voiceConfig)` — writes to default template's `config_overrides.voice`

### 11.3 Schedule Config (`config_overrides.schedule`)

Added in Brand Profiles (#24). Allows per-brand posting windows.

```json
{
  "post_start_hour": 9,
  "post_end_hour": 21,
  "active_days": [1, 2, 3, 4, 5],
  "max_posts_per_day": 3,
  "min_gap_hours": 4,
  "blackout_start": "",
  "blackout_end": ""
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `post_start_hour` | number | `9` | Earliest posting hour (0–23) |
| `post_end_hour` | number | `21` | Latest posting hour (0–23) |
| `active_days` | number[] | `[0–6]` | Days of week (0=Sun, 6=Sat) |
| `max_posts_per_day` | number | `3` | Maximum posts per 24h |
| `min_gap_hours` | number | `4` | Minimum hours between posts |
| `blackout_start` | string | `""` | Blackout window start (HH:MM) |
| `blackout_end` | string | `""` | Blackout window end (HH:MM) |

**BrandManager methods:**
- `getScheduleConfig(brandId)` — reads from default template's `config_overrides.schedule`
- `saveScheduleConfig(brandId, scheduleConfig)` — writes to default template's `config_overrides.schedule`

### 11.4 Music Advanced Config (`config_overrides.music`)

The music config modal now includes an advanced collapsible panel for ducking and fade settings:

```json
{
  "enabled": true,
  "default_volume": 0.18,
  "ducking": {
    "enabled": true,
    "duck_volume": 0.08,
    "attack_ms": 150,
    "release_ms": 250
  },
  "fade": {
    "in_ms": 800,
    "out_ms": 1200
  }
}
```

See [BACKGROUND_MUSIC.md](BACKGROUND_MUSIC.md) for full schema reference.

### 11.5 UI: Brands Page Config Buttons

Each brand card footer shows **7 config buttons**:

```
[ Presets ] [ Music ] [ Images ] [ Effects ] [ Subs ] [ Voice ] [ Schedule ]
```

Each opens a dedicated modal for that config domain. All modals follow the same pattern:
1. Load current config from `config_overrides` via `BrandManager`
2. Populate form fields
3. Save back to `config_overrides` on submit
