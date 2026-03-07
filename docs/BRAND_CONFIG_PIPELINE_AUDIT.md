# Brand Config → Pipeline Audit

> Last audited: Session where brands.html was redesigned (Settings Hub approach)

## Summary

This document tracks which brand-level config sections are **actually respected** by the video generation pipeline (worker → renderer → assembly).

| Section | Per-Preset | Respected | Notes |
|---------|-----------|-----------|-------|
| Image Prompt | ✅ Yes | ✅ Yes | `config_overrides.image_prompt` flows through to image generation. Worker reads from matching `brand_templates` row. |
| Effects | ✅ Yes | ✅ Yes | `effects_profile` object passed from worker to renderer. Renderer checks each effect's `.enabled` flag. |
| Subtitles | ✅ Yes | ✅ Yes | SQL RPC `get_subtitle_preset_profile()` reads from `brand_templates WHERE template_type = COALESCE(p_vibe_preset, 'urban_legend')`. |
| Voice | ⚠️ No | ⚠️ Partial | Worker reads voice from `brand_templates WHERE is_default = true` only. **Does NOT** read per-preset voice configs. See details below. |
| Music | ✅ Brand-level | ✅ Yes | Music tracks are brand-level (shared across presets). Volume from `config_overrides.music.default_volume`. |
| Gameplay Clips | ✅ Brand-level | ✅ Yes | Clips stored per-brand in Supabase bucket, injected during assembly. |
| img2vid | ✅ Brand-level | ❌ DISABLED | Step removed from `STEP_ORDER` (March 5, 2026). AnimateDiff clips were generated but not used in final video. Code intact — re-enable when upgrading GPU (5090) or using video API. |
| Schedule | N/A | ✅ Yes | Schedule windows are checked by job scheduler. Not per-preset. |
| Presets/Weights | N/A | ✅ Yes | Weighted random selection happens in worker when picking template for a job. |

## Voice Config Issue (⚠️)

**Location:** `supabase/functions/worker-v1/steps.ts` lines ~1731-1740

The voice step reads from:
```sql
SELECT config_overrides FROM brand_templates
WHERE brand_id = ? AND is_default = true
```

It then calls `getPresetVoiceConfig(vibePreset, brandVoiceConfig)` but `brandVoiceConfig` comes from the **default template**, not the template matching the selected vibe preset.

**Impact:** If a user configures different voice settings per-preset in the UI, only the default preset's voice config will actually be used during generation.

**Fix needed:** Worker should query `brand_templates WHERE template_type = selectedVibePreset` for voice config, similar to how subtitles already work.

## How Config Flows

1. **Job scheduler** picks a brand + weighted-random template (preset)
2. **Worker** receives `{ brand_id, template_type }` 
3. Worker queries `brand_templates` for `config_overrides`
4. Config sections are extracted and passed to their respective steps:
   - `image_prompt` → image generation step
   - `effects` → `effects_profile` sent to renderer
   - `subtitles` → handled via SQL RPC function
   - `voice` → read from default template (bug)
   - `music` → volume + track selection
5. **Renderer** receives assembled config and applies effects, captions, etc.
6. **Assembly** combines all rendered clips into final video

## UI Config Modals

All config modals support per-preset editing via tab bars:
- `fx-preset-tabs` → Effects modal
- `sub-preset-tabs` → Subtitles modal  
- `ip-preset-tabs` → Image Prompt modal
- `voice-preset-tabs` → Voice modal

Each tab loads/saves via `brandManager.getPresetConfigSection()` / `savePresetConfigSection()`.
