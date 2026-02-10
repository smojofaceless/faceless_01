# Preset Source of Truth

> **Document Version:** 1.0  
> **Created:** February 8, 2026  
> **Author:** System Architect  
> **Status:** Implemented

---

## Overview

This document explains the architectural decision to make `brand_templates` the authoritative source of presets for video generation. It ensures that **manual generation** (create.html) and **campaign generation** (future) use the same preset logic.

---

## Why `brand_templates` is Authoritative

### The Problem (Before)

Prior to this change, presets were defined in two places:

1. **Hardcoded in `js/templates/horror.js`** — Used by manual generation (create.html)
2. **Database `brand_templates`** — Unused in frontend, existed for future campaigns

This created **drift risk**: if someone added a preset to one place but not the other, manual and campaign generation would behave differently.

### The Solution (Now)

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRESET SOURCE OF TRUTH                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────────────┐                                         │
│   │  brand_templates │  ← Single source of truth (DB)          │
│   │    (Supabase)    │                                         │
│   └────────┬─────────┘                                         │
│            │                                                    │
│            ▼                                                    │
│   ┌──────────────────────────────────────────────────────┐     │
│   │                   Preset Loading                      │     │
│   │                                                       │     │
│   │  1. Query brand_templates for active brand           │     │
│   │  2. If rows found → use DB presets (✅ Primary)      │     │
│   │  3. If no rows → fallback to hardcoded (⚠️ Backup)   │     │
│   │                                                       │     │
│   └──────────────────────────────────────────────────────┘     │
│            │                                                    │
│            ▼                                                    │
│   ┌──────────────────┐    ┌──────────────────┐                 │
│   │  create.html     │    │  Campaign System │                 │
│   │  (Manual Gen)    │    │  (Future)        │                 │
│   └──────────────────┘    └──────────────────┘                 │
│                                                                 │
│   Both flows now use the SAME preset logic                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## How It Works

### Primary Path: Database Presets

When a brand has templates configured in `brand_templates`:

1. `create.js` calls `loadPresetsFromDB(brand)`
2. Queries: `SELECT * FROM brand_templates WHERE brand_id = ?`
3. Transforms DB rows to UI preset format
4. Sets `this.presetSource = 'database'`
5. UI shows **"🏷️ Brand Presets"** badge
6. Each preset card shows **"Brand"** source label

### Fallback Path: Hardcoded Presets

When a brand has **no templates** in `brand_templates`:

1. DB query returns 0 rows
2. `this.presetSource = 'fallback'`
3. Uses hardcoded presets from `js/templates/horror.js`
4. UI shows **warning banner**: "⚠️ This brand has no templates configured. Using system defaults."
5. Each preset card shows **"System"** source label

### Why Fallback Exists

1. **Bootstrap**: New brands start with no templates
2. **Safety**: If DB is unavailable, generation still works
3. **Testing**: Developers can test without DB setup

---

## Schema Reference

### `brand_templates` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `brand_id` | UUID | FK to brands |
| `name` | TEXT | Display name (e.g., "Urban Legend") |
| `template_type` | TEXT | Preset key (e.g., "urban_legend") |
| `config_overrides` | JSONB | Overrides for preset defaults |
| `is_default` | BOOLEAN | Default preset for brand |
| `weight` | DECIMAL(3,2) | Campaign selection weight (0.01-1.00) |
| `created_at` | TIMESTAMP | Creation timestamp |

### Preset Format (UI)

```javascript
{
    id: 'urban_legend',              // template_type from DB
    name: 'Urban Legend',            // name from DB
    icon: '📜',                      // From hardcoded metadata
    tagline: 'Documentary folklore', // From hardcoded metadata
    description: '...',              // From hardcoded metadata
    weight: 0.60,                    // From DB
    is_default: true,                // From DB
    defaults: {                      // Merged: hardcoded + config_overrides
        vibe_preset: 'urban_legend',
        era: '1990s',
        ...
    },
    _source: 'database',             // Source indicator
    _dbId: 'uuid-...'                // Original DB row ID
}
```

---

## Invariants (MUST BE ENFORCED)

### 1. Preset Immutability

Once a preset is selected and a job is created:
- The preset is stored in `jobs.vibe_preset`
- Workers **MUST NOT** re-roll or override it
- The job's preset is locked at creation time

### 2. Mental Model Alignment

Both manual and campaign flows share this contract:
> "Presets come from `brand_templates`, not from code."

### 3. Fallback is Temporary

Fallback mode is a **safety net**, not a feature:
- New brands should have templates added via admin UI
- Fallback warning is intentionally visible to prompt action

---

## What Future Developers Should NOT Do

### ❌ Do NOT Re-Hardcode Presets

```javascript
// WRONG - Don't do this!
const presets = [
    { id: 'my_new_preset', ... }
];
```

Instead, add presets via:
1. Database migration (for system-wide defaults)
2. Admin UI (for brand-specific presets)

### ❌ Do NOT Skip the DB Query

```javascript
// WRONG - Don't bypass the DB!
if (someCondition) {
    this.template.presets = HARDCODED_PRESETS;
}
```

Always let `loadPresetsFromDB()` run — it handles fallback properly.

### ❌ Do NOT Remove Fallback Logic

The fallback exists for:
- Bootstrap scenarios
- DB outages
- Local development

Removing it would break these cases.

---

## Related Files

| File | Purpose |
|------|---------|
| [js/pages/create.js](../js/pages/create.js) | `loadPresetsFromDB()` implementation |
| [js/templates/horror.js](../js/templates/horror.js) | Hardcoded preset metadata (icons, descriptions) |
| [css/styles.css](../css/styles.css) | Fallback warning and source badge styles |
| [DNA_AND_DB_OPTION1_IMPLEMENTATION_PLAN.md](DNA_AND_DB_OPTION1_IMPLEMENTATION_PLAN.md) | Full Option 1 implementation plan |

---

## Verification

To verify presets are loading from DB:

1. Open browser DevTools → Console
2. Navigate to create.html
3. Look for: `[PRESETS] ✅ Loaded N presets from database`

To verify fallback is working:

1. Switch to a brand with no templates (e.g., "test")
2. Look for: `[PRESETS] No templates found... Using hardcoded fallback.`
3. UI should show warning banner

---

## Change Log

| Date | Version | Changes |
|------|---------|--------|
| Feb 8, 2026 | 1.0 | Initial implementation |
