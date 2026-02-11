# Effects Refinement — Controlled Motion v2.0

> **Roadmap #15 | February 2026**

## Overview

Controlled Motion replaces the legacy boolean-only effects pipeline with a
**DB-driven, intensity-based, deterministic** effects system.

### Key properties

| Property | Detail |
|----------|--------|
| **DB-driven** | Effect profiles live in Postgres functions (`get_effects_config_for_job`), changeable without redeploying the renderer or worker |
| **Intensity-scaled** | A master `intensity` knob (0-1) scales every sub-effect proportionally |
| **Deterministic** | Ken Burns direction and flicker phase are derived from `job_id` + `sceneIndex` seeds — retries produce identical output |
| **Backwards compatible** | If `effects_config` is absent or `null`, the renderer falls back to the existing legacy effect pipeline |
| **Soft failure** | If any effect builder throws, it is skipped and rendering continues |

---

## Architecture

```
┌───────────────┐      ┌──────────────┐      ┌──────────────────┐
│  brand_templates │─────▶│  RPC Merge   │─────▶│  effects_config  │
│  config_overrides│      │  (4 layers)  │      │  (final JSON)    │
│  .effects        │      └──────────────┘      └────────┬─────────┘
└───────────────┘                                        │
                                                         ▼
                                              ┌──────────────────┐
                                              │  worker-v1       │
                                              │  (assemble step) │
                                              └────────┬─────────┘
                                                       │ POST /render
                                                       ▼
                                              ┌──────────────────┐
                                              │  video-renderer  │
                                              │  server.js       │
                                              └──────────────────┘
```

### Merge order (later wins)

1. **System defaults** — `get_effects_system_defaults()`
2. **Preset profile** — `get_effects_preset_profile('urban_legend')`
3. **Brand overrides** — `brand_templates.config_overrides.effects` (matching preset + brand)
4. **Job-level overrides** — `job.meta.effects_config`

---

## effects_config schema

```jsonc
{
  "enabled": true,          // Master kill switch — false disables ALL effects
  "intensity": 0.6,         // Master knob 0-1 — scales every sub-effect

  "kenburns": {
    "enabled": true,
    "zoom_range": [1.0, 1.15],   // [min, max] zoom factor
    "pan_speed": 0.5,            // 0-1 panning speed
    "direction": "alternate"     // "in" | "out" | "alternate" | "random"
  },

  "grain": {
    "enabled": true,
    "intensity": 0.20,           // 0-1 → maps to FFmpeg noise strength 5-35
    "size": 1.0                  // 0.5-2.0 grain particle scale
  },

  "flicker": {
    "enabled": true,
    "intensity": 0.15,           // 0-1 brightness oscillation amplitude
    "frequency": 0.25            // 0.05-1.0 oscillation speed
  },

  "vignette": {
    "enabled": true,
    "intensity": 0.60            // 0-1 → maps to PI/8..PI/2
  },

  "color_grade": {
    "enabled": true,
    "preset": "cinematic_dark",  // "auto" | "cinematic_dark" | "cold_desaturated" | "vhs_degraded"
    "intensity": 0.65            // 0-1
  },

  "fade": {
    "fade_in": true,
    "fade_out": true,
    "duration": 1.5              // 0.1-3.0 seconds
  }
}
```

---

## Per-preset defaults

| Preset | Intensity | KB Direction | Grain | Flicker | Vignette | Color Grade |
|--------|-----------|-------------|-------|---------|----------|-------------|
| `urban_legend` | 0.6 | alternate | 20% | 15% | 60% | cinematic_dark 65% |
| `one_too_many` | 0.5 | in | 15% | off | 50% | cold_desaturated 55% |
| `analog_horror` | 0.7 | alternate | 45% | 35% | 55% | vhs_degraded 60% |
| `clean` | 0.3 | in (gentle) | off | off | off | auto 30% |

---

## Deterministic rendering

Ken Burns direction is derived from:
```
seed = djb2_hash(job_id + ':' + sceneIndex)
```

For `direction: "alternate"` → even scenes zoom in, odd scenes zoom out.
For `direction: "random"` → seed selects from `[in, out, pan-left, pan-right]`.

Flicker phase offset: `djb2_hash(job_id + ':flicker:' + sceneIndex) % 100 / 100`

This ensures **retries produce byte-identical visual motion**.

---

## FFmpeg filter mapping

| Effect | FFmpeg Filter | Intensity range |
|--------|---------------|-----------------|
| Ken Burns | `zoompan` with seed-based direction | zoom 1.0–1.5× |
| Grain | `noise=c0s={5+i*30}:c0f=t` | strength 5–35 |
| Flicker | `eq=brightness={A}*sin(n*{F}+{P})` | amplitude 0–0.12 |
| Vignette | `vignette={PI/8..PI/2}` | angle PI/8–PI/2 |
| Color grade | `eq` + `colorbalance` presets | scaled by intensity |
| Fade | `fade=t=in/out` | duration 0.1–3.0s |

All values are **clamped** in the renderer via `safeClamp(value, default, min, max)`.

---

## normalizeEffectsConfig() — Centralized Safety Gate (v4.1)

A single function clamps and sanitizes the entire `effects_config` before any builder sees it.
Called once at the renderer `/render` entry point.

### Two-pass clamping

| Pass | Purpose |
|------|--------|
| **1. System clamp** | Hard FFmpeg-safe ranges — never exceeded |
| **2. Brand ceilings** | Optional per-brand caps from `raw.limits` — only lower, never raise |

### System safe ranges

| Field | Min | Max | Default |
|-------|-----|-----|---------|
| `intensity` | 0 | 1 | 0.5 |
| `kenburns.zoom_range[]` | 1.0 | 1.5 | [1.0, 1.12] |
| `kenburns.pan_speed` | 0 | 0.6 | 0.4 |
| `grain.intensity` | 0 | 0.5 | 0 |
| `grain.size` | 0.5 | 2.0 | 1.0 |
| `flicker.intensity` | 0 | 0.5 | 0 |
| `flicker.frequency` | 0.05 | 2.0 | 0.3 |
| `vignette.intensity` | 0 | 1 | 0 |
| `color_grade.intensity` | 0 | 1 | 0 |
| `fade.duration` | 0.1 | 5.0 | 1.5 |

### Brand ceilings (Pass 2)

Brands set `limits` in `config_overrides.effects` — ceilings cap effects regardless of preset:

```json
{
  "enabled": true,
  "intensity": 0.6,
  "limits": {
    "max_intensity": 0.7,
    "kenburns": { "max_pan_speed": 0.4 },
    "grain": { "max_intensity": 0.25 },
    "flicker": { "max_intensity": 0.15 }
  }
}
```

**Flow:** Preset requests grain 0.40 → system clamps 0.40 (within 0–0.5) → brand ceiling caps to 0.25.

When ceilings fire, the renderer logs `🔒 Brand ceilings applied: grain.intensity, flicker.intensity`.

---

## Backwards compatibility

| Scenario | Behavior |
|----------|----------|
| `effects_config` absent / null | Legacy pipeline runs (individual effect passes) |
| `effects_config.enabled = false` | **All** effects disabled (master kill switch) |
| `effects_config` present + valid | Controlled Motion pipeline runs; legacy passes are skipped |
| RPC `get_effects_config_for_job` fails | Worker logs warning, sends `effects_config: null`, legacy pipeline runs |
| Individual effect filter throws | Effect skipped, rendering continues (soft failure) |

---

## Files changed

| File | Change |
|------|--------|
| `supabase/migrations/20260211_effects_config.sql` | NEW — RPCs for system defaults, preset profiles, merge function |
| `video-renderer/ffmpeg_presets.js` | NEW — `buildFiltersFromEffectsConfig()`, per-effect builders, `hashSeed()` |
| `video-renderer/server.js` | UPDATED — accepts `effects_config` in `/render`, applies controlled motion pipeline |
| `supabase/functions/worker-v1/helpers.ts` | NEW — `getEffectsConfigForJob()` helper + `EffectsConfig` type |
| `supabase/functions/worker-v1/steps.ts` | UPDATED — assemble step resolves + passes `effects_config` to renderer |
| `docs/EFFECTS_REFINEMENT.md` | NEW — this document |
| `docs/EFFECTS_SMOKE_TESTS.md` | NEW — manual verification checklist |

---

## Brand-level overrides

To customize effects for a specific brand, update `brand_templates.config_overrides`:

```sql
UPDATE brand_templates
SET config_overrides = config_overrides || '{
  "effects": {
    "intensity": 0.8,
    "grain": { "intensity": 0.4 },
    "flicker": { "enabled": false }
  }
}'::jsonb
WHERE brand_id = 'YOUR_BRAND_UUID'
  AND template_type = 'urban_legend';
```

Only the keys you specify are overridden — everything else inherits from the preset profile.

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| v2.1 | Feb 10, 2026 | Brand-level ceilings (`limits`), centralized `normalizeEffectsConfig()`, hardening (enabled=false fix, soft-fail, effects OFF by default) |
| v2.0 | Feb 2026 | Controlled Motion: DB-driven, intensity-scaled, deterministic effects |
| v1.0 | Jan 2026 | Initial effects profile system (boolean flags + intensity overrides) |
