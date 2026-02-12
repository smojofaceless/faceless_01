# Effects Profile System v1.0

> **Last Updated:** February 11, 2026

This document describes the intensity-based effects system for video generation.

## Overview

The effects profile system replaces the legacy boolean-only effects with a flexible, intensity-based approach that supports:

1. **Preset-based effects** - Each vibe_preset has a default effects profile
2. **Custom effects** - Users can override individual effect intensities (0-1 scale)
3. **Merge strategy** - System defaults → Vibe preset → Art style → User overrides

## Effects Mode

Jobs support two effects modes:

| Mode | Description |
|------|-------------|
| `auto` | Effects are determined by the vibe_preset (recommended) |
| `custom` | User provides custom effects_profile overrides |

## Effects Profile Schema

```typescript
interface EffectsProfile {
  version: '1.0';
  
  // Motion & transitions
  transitions: {
    enabled: boolean;
    type: 'crossfade' | 'cut' | 'dissolve' | 'wipe';
    duration: number;      // 0.1 - 2.0 seconds
    intensity: number;     // 0-1
  };
  
  kenburns: {
    enabled: boolean;
    zoom_amount: number;   // 1.0 - 1.5
    speed: number;         // 0-1
    direction: 'in' | 'out' | 'random';
  };
  
  // Color & lighting
  color_grade: {
    enabled: boolean;
    preset: 'auto' | 'horror_cold' | 'warm' | 'noir' | 'vibrant' | 'sepia' | 'bleach';
    intensity: number;     // 0-1
    contrast: number;      // 0.5 - 2.0
    saturation: number;    // 0 - 2.0
    brightness: number;    // 0.5 - 1.5
    temperature: number;   // -1 to 1 (cold to warm)
  };
  
  vignette: {
    enabled: boolean;
    intensity: number;     // 0-1
    radius: number;        // 0-1 (center to edge)
    softness: number;      // 0-1
  };
  
  // Film & grain
  film_grain: {
    enabled: boolean;
    intensity: number;     // 0-1
    size: number;          // 0.5 - 2.0
    color_noise: boolean;  // Color or B&W grain
  };
  
  scanlines: {
    enabled: boolean;
    intensity: number;     // 0-1
    spacing: number;       // 1-8 pixels
    thickness: number;     // 1-4 pixels
  };
  
  // Distortion effects
  vhs: {
    enabled: boolean;
    tracking_noise: number;  // 0-1
    color_bleed: number;     // 0-1
    tape_crinkle: number;    // 0-1
    jitter: number;          // 0-1
    intensity: number;       // 0-1 (master)
  };
  
  glitch: {
    enabled: boolean;
    frequency: number;       // 0-1 (how often)
    intensity: number;       // 0-1 (severity)
    rgb_shift: number;       // 0-1
  };
  
  // Atmospheric
  light_flicker: {
    enabled: boolean;
    intensity: number;       // 0-1
    frequency: number;       // 0-1
    randomness: number;      // 0-1
  };
  
  edge_darken: {
    enabled: boolean;
    intensity: number;       // 0-1
    spread: number;          // 0-1
  };
  
  // Fade in/out
  fade: {
    fade_in: boolean;
    fade_out: boolean;
    duration: number;        // 0.1 - 2.0 seconds
  };
}
```

## Preset Effects Profiles

Each vibe_preset maps to a default effects profile.

> **Note:** As of v4.0, only **two active story engines** are used in production:
> - `urban_legend` - Documentary folklore style (60% campaign weight)
> - `one_too_many` - Counting horror style (40% campaign weight)
>
> Legacy presets (`slow_creepy`, `analog_horror`, `cosmic_horror`, etc.) still exist in the effects system for backwards compatibility but are deprecated in the UI.

> **DB-Driven Configuration (Option 1):** Preset assignments and weights are stored in 
> `brand_templates` table. Each brand has its own set of templates with selection weights.
> See [DNA_AND_DB_OPTION1_IMPLEMENTATION_PLAN.md](DNA_AND_DB_OPTION1_IMPLEMENTATION_PLAN.md).

### `urban_legend` (Primary Active)
- Strong vignette (60%)
- Cool color temperature (-0.15)
- Moderate grain (20%)
- Edge darkening (30%)
- Alternating Ken Burns (1.1x zoom)
- Cinematic dark color grade

### `one_too_many` (Primary Active)
- Cold desaturated color palette
- Subtle vignette (50%)
- Minimal motion (static tension)
- **Forces `uncanny-illustrated` art style**
- Designed for counting horror visuals

### `slow_creepy` (Legacy)
- Subtle Ken Burns (1.08x zoom)
- Gentle vignette (50%)
- Cold color grade (70%)
- Light film grain (25%)
- Slow, methodical atmosphere

### `analog_horror` (Legacy)
- VHS effects (40% tracking, 30% color bleed)
- Scanlines enabled
- Film grain (45%)
- Dated, corrupted footage feel

### `found_footage` (Legacy)
- Handheld shake (via Ken Burns jitter)
- Heavy film grain (50%)
- Light flicker (40%)
- Amateur camera aesthetic

### `psychological` (Legacy)
- Edge darkening (50%)
- Heavy desaturation (65%)
- Strong vignette (80%)
- Heartbeat zoom effect
- Negative flash effects

### `cosmic_horror` (Legacy)
- Deep darkness (85% vignette)
- Extreme cold color grade (-0.4 temp)
- Subtle glitch effects (25%)
- Low saturation (50%)

### `clean`
- Minimal effects
- Light crossfade transitions
- Natural color grade
- No grain, glitch, or distortion
- Modern, polished look

## API Usage

### Auto Mode (Preset-Based)

```javascript
// Effects determined automatically by vibe_preset
const job = await createJob({
  theme: 'horror',
  vibe_preset: 'analog_horror',
  effects_mode: 'auto'  // or omit - 'auto' is default
});
```

### Custom Mode (User Overrides)

```javascript
// Build custom profile from UI sliders
const customProfile = buildEffectsProfile({
  vignette: 0.7,       // 70% intensity
  film_grain: 0.3,     // 30% intensity
  vhs: 0.5,            // 50% VHS effect
  scanlines: 0.4       // 40% scanlines
});

const job = await createJob({
  theme: 'horror',
  vibe_preset: 'analog_horror',
  effects_mode: 'custom',
  effects_profile: customProfile
});
```

### Helper: `buildEffectsProfile(sliders)`

Converts UI slider values (0-1) to a full effects profile:

```javascript
const profile = buildEffectsProfile({
  transitions: 0.8,    // Transition intensity
  kenburns: 0.5,       // Ken Burns speed
  color_intensity: 0.7,
  vignette: 0.4,
  film_grain: 0.2,
  scanlines: 0.3,
  vhs: 0.5,
  glitch: 0.2,
  light_flicker: 0.3
});
```

## Merge Strategy

Effects are resolved in this order (later overrides earlier):

1. **System Defaults** - Base values for all effects
2. **Vibe Preset Profile** - Default profile for the selected preset
3. **Art Style Adjustments** - Modifications based on art_style (e.g., 'vintage' adds grain)
4. **User Overrides** - Custom effects_profile from the request

```
Final Profile = merge(
  SYSTEM_DEFAULTS,
  PRESET_EFFECTS_PROFILES[vibe_preset],
  ART_STYLE_ADJUSTMENTS[art_style],
  user_effects_profile
)
```

### Two-Pass Normalization (v4.1)

Before any builder sees the merged config, `normalizeEffectsConfig()` runs two passes:

| Pass | Purpose | Example |
|------|---------|---------|
| **1. System clamp** | Hard FFmpeg-safe ranges that can never be exceeded | `grain.intensity` capped at 0.5 |
| **2. Brand ceilings** | Optional per-brand caps — tighter than system ranges | Brand says "grain never exceeds 25%" |

### Brand-Level Effect Ceilings

Brands can define `limits` in their `config_overrides.effects` to cap any effect —
regardless of what presets request. Ceilings are **not targets**: they only lower values, never raise them.

```json
{
  "enabled": true,
  "intensity": 0.6,
  "limits": {
    "max_intensity": 0.7,
    "kenburns": { "max_pan_speed": 0.4, "max_zoom_range": 1.3 },
    "grain":    { "max_intensity": 0.25, "max_size": 1.5 },
    "flicker":  { "max_intensity": 0.15, "max_frequency": 1.0 },
    "vignette": { "max_intensity": 0.7 },
    "color_grade": { "max_intensity": 0.8 },
    "fade":     { "max_duration": 3.0 }
  }
}
```

**Flow:** Preset requests grain at 0.4 → system clamps to 0.4 (within 0–0.5) → brand ceiling caps to 0.25.

Available ceiling keys:

| Ceiling | Caps | System Max |
|---------|------|-----------|
| `max_intensity` | Master intensity | 1.0 |
| `kenburns.max_pan_speed` | Pan speed | 0.6 |
| `kenburns.max_zoom_range` | Both zoom_range elements | 1.5 |
| `grain.max_intensity` | Grain strength | 0.5 |
| `grain.max_size` | Grain particle size | 2.0 |
| `flicker.max_intensity` | Flicker strength | 0.5 |
| `flicker.max_frequency` | Flicker Hz | 2.0 |
| `vignette.max_intensity` | Vignette darkening | 1.0 |
| `color_grade.max_intensity` | Color grade strength | 1.0 |
| `fade.max_duration` | Fade in/out seconds | 5.0 |

When a ceiling is applied, the renderer logs `🔒 Brand ceilings applied: grain.intensity, flicker.intensity` for auditability.

## FFmpeg Integration

Effects are applied via FFmpeg filters in the self-hosted **video-renderer** service (replaces Creatomate):

| Effect | FFmpeg Filter |
|--------|---------------|
| Vignette | `vignette=PI/4*intensity:1-radius` |
| Film Grain | `noise=alls=intensity*50:allf=t+u` |
| Scanlines | `drawbox` with alternating rows |
| VHS | Custom tracking noise + color bleed |
| Glitch | `rgbashift` + `noise` combo |
| Color Grade | `eq` + `colorbalance` filters |
| Ken Burns | `zoompan` with motion profiles |

### Per-Shot Mood Levels (Feb 11, 2026)

Ken Burns motion is now controlled per-image via **mood levels** (1–10), computed by `computeMoodLevel()` in `worker-v1/steps.ts`:

| Mood Range | Ken Burns Style | Description |
|------------|----------------|-------------|
| 1–6 | Gentle | Classic slow zoom (in or out). For establishing shots, objects, calm moments. |
| 7–10 | Cinematic | Pan, sweep, diagonal movement. For atmosphere, climax, POV shots. |

**Computation:** Base mood escalates from 3→8 across the video's progress. Adjustments are made per scene type:
- `establishing` / `wide` → mood−1
- `atmosphere` → mood+1  
- `character` + `close-up` → mood+1
- `pov` → mood+2
- `isClimax: true` → baseMood+3 (capped at 10)

The `mood_levels[]` array is sent in the assembly payload alongside `durations[]`, allowing the FFmpeg renderer to apply different Ken Burns intensity to each scene independently.

### Visual DNA → FFmpeg Binding

The `ffmpeg_presets.js` file in `video-renderer/` maps Visual DNA dimensions directly to FFmpeg filter graphs:

- **Visual Style** → Base filters (VHS_degraded, cinematic_dark, documentary_archival)
- **Motion Profile** → Ken Burns animation (micro_jitter, slow_drift, subtle_zoom)
- **Color Palette** → Color grading (cold_desaturated, sickly_green, amber_decay)
- **Texture Artifacts** → Overlay filters (film_grain, scanlines, tracking_noise)

## Backwards Compatibility

Legacy boolean effects (e.g., `effect_vhs_tracking: true`) are automatically converted to intensity-based profiles using `legacyEffectsToProfile()`:

```javascript
// Legacy boolean → New intensity profile
{
  effect_vhs_tracking: true,    // → vhs.enabled: true, vhs.intensity: 0.5
  effect_filmgrain: true,       // → film_grain.enabled: true, film_grain.intensity: 0.25
  effect_scanlines: false       // → scanlines.enabled: false
}
```

## UI Integration Ideas

### "Auto Effects" vs "Custom" Toggle

```
┌──────────────────────────────────────────┐
│ Effects Mode                             │
│ ┌─────────────┐ ┌─────────────┐         │
│ │ ✓ Auto      │ │   Custom    │         │
│ └─────────────┘ └─────────────┘         │
│                                          │
│ Using: analog_horror preset              │
│ • VHS tracking noise                     │
│ • Heavy scanlines                        │
│ • Occasional glitches                    │
└──────────────────────────────────────────┘
```

### Custom Mode Sliders

```
┌──────────────────────────────────────────┐
│ Custom Effects                           │
│                                          │
│ Vignette        ████████░░  80%          │
│ Film Grain      ██░░░░░░░░  20%          │
│ VHS Distortion  █████░░░░░  50%          │
│ Scanlines       ████░░░░░░  40%          │
│ Glitch          ██░░░░░░░░  20%          │
│ Color Intensity ███████░░░  70%          │
│                                          │
│ [Preview Effect] [Reset to Preset]       │
└──────────────────────────────────────────┘
```

## Files Modified

| File | Changes |
|------|---------|
| `run-job/effects_profile.ts` | NEW - Schema, presets, merge logic |
| `run-job/phases.ts` | Resolves effects profile in assemble phase |
| `run-job/video.ts` | Passes effects_profile to FFmpeg |
| `create-job/index.ts` | Accepts effects_mode and effects_profile |
| `video-renderer/server.js` | Accepts effects_profile in /render |
| `video-renderer/ffmpeg_presets.js` | Intensity-aware filter builders |
| `js/api.js` | buildEffectsProfile() helper, createJob updates |

## Version History

- **v1.0** (2025-01-30): Initial effects profile system with intensity controls
- **v1.1** (2026-02-11): Per-shot mood levels for Ken Burns (gentle 1-6, cinematic 7-10), climax awareness boost
