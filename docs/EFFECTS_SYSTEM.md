# Effects Profile System v1.0

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

Each vibe_preset maps to a default effects profile:

### `slow_creepy` (Default)
- Subtle Ken Burns (1.1x zoom)
- Gentle vignette (30%)
- Cold color grade (70%)
- Light film grain (15%)
- Slow, methodical atmosphere

### `analog_horror`
- VHS effects (60% tracking, color bleed)
- Heavy scanlines (70%)
- Occasional glitches (40%)
- Dated, corrupted footage feel

### `found_footage`
- Handheld shake (via Ken Burns jitter)
- Heavy film grain (50%)
- Light flicker (40%)
- Amateur camera aesthetic

### `urban_legend`
- Strong vignette (60%)
- Cool color temperature
- Moderate grain (25%)
- Street-lit atmosphere

### `psychological`
- Edge darkening (40%)
- Desaturated colors
- Subtle pulsing effects
- Mind-bending distortions

### `cosmic_horror`
- Deep darkness (strong vignette)
- Extreme cold color grade
- Subtle chromatic aberration
- Unknowable vastness

### `clean`
- Minimal effects
- Light transitions only
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

## FFmpeg Integration

Effects are applied via FFmpeg filters in the video-renderer:

| Effect | FFmpeg Filter |
|--------|---------------|
| Vignette | `vignette=PI/4*intensity:1-radius` |
| Film Grain | `noise=alls=intensity*50:allf=t+u` |
| Scanlines | `drawbox` with alternating rows |
| VHS | Custom shader with chromatic aberration |
| Glitch | `rgbashift` + `noise` combo |
| Color Grade | `eq` + `colorbalance` filters |

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
