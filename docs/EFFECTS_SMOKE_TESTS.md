# Effects Refinement — Smoke Tests

> Run these tests after deploying the migration, worker, and renderer.

---

## Prerequisites

1. Run `20260211_effects_config.sql` in Supabase SQL editor
2. Deploy `worker-v1` edge function
3. Deploy `video-renderer` to Render.com / Railway

---

## E1 — RPC returns valid config

**Goal:** Verify the DB merge function works.

```sql
-- Should return urban_legend defaults (enabled=true, grain 20%, vignette 60%)
SELECT get_effects_config_for_job(
  'YOUR_BRAND_UUID',
  'urban_legend',
  '{}'::jsonb
);

-- Should return one_too_many defaults (flicker disabled, vignette 50%)
SELECT get_effects_config_for_job(
  'YOUR_BRAND_UUID',
  'one_too_many',
  '{}'::jsonb
);
```

**Pass:** Both return valid JSON with all expected keys. Urban legend has `grain.enabled=true`, one_too_many has `flicker.enabled=false`.

---

## E2 — Master kill switch

**Goal:** `enabled=false` disables all effects.

```sql
SELECT get_effects_config_for_job(
  'YOUR_BRAND_UUID',
  'urban_legend',
  '{"effects_config": {"enabled": false}}'::jsonb
);
```

**Pass:** All sub-effects have `enabled=false` (kenburns, grain, flicker, vignette, color_grade). Fade has `fade_in=false, fade_out=false`.

---

## E3 — Job-level override

**Goal:** Job meta overrides the preset.

```sql
SELECT get_effects_config_for_job(
  'YOUR_BRAND_UUID',
  'urban_legend',
  '{"effects_config": {"grain": {"intensity": 0.9}, "flicker": {"enabled": false}}}'::jsonb
);
```

**Pass:** `grain.intensity = 0.9` (overridden), `flicker.enabled = false` (overridden), all other keys match urban_legend preset defaults.

---

## E4 — Brand-level override

**Goal:** Brand template overrides merge correctly.

```sql
-- First add a brand-level override
UPDATE brand_templates
SET config_overrides = config_overrides || '{"effects": {"intensity": 0.9, "vignette": {"intensity": 0.8}}}'::jsonb
WHERE brand_id = 'YOUR_BRAND_UUID'
  AND template_type = 'urban_legend';

-- Then resolve
SELECT get_effects_config_for_job(
  'YOUR_BRAND_UUID',
  'urban_legend',
  '{}'::jsonb
);
```

**Pass:** `intensity = 0.9` (brand override), `vignette.intensity = 0.8` (brand override), `grain.intensity = 0.20` (preset default preserved).

**Cleanup:**
```sql
UPDATE brand_templates
SET config_overrides = config_overrides - 'effects'
WHERE brand_id = 'YOUR_BRAND_UUID'
  AND template_type = 'urban_legend';
```

---

## E5 — Renderer backwards compatibility

**Goal:** When no `effects_config` is sent, the renderer uses the legacy pipeline.

1. Send a `/render` POST **without** `effects_config`:
   ```json
   {
     "images": ["..."],
     "audio_url": "...",
     "durations": [5, 5],
     "effects": { "kenBurns": true, "vignette": true, "filmGrain": true }
   }
   ```
2. Check renderer logs.

**Pass:** Logs show "Adding vignette...", "Adding film grain..." (legacy individual passes). No mention of "Controlled Motion".

---

## E6 — Controlled Motion render

**Goal:** When `effects_config` is provided, the new pipeline fires.

1. Send a `/render` POST **with** `effects_config`:
   ```json
   {
     "images": ["..."],
     "audio_url": "...",
     "durations": [5, 5, 5],
     "effects": {},
     "effects_config": {
       "enabled": true,
       "intensity": 0.6,
       "kenburns": { "enabled": true, "zoom_range": [1.0, 1.15], "pan_speed": 0.5, "direction": "alternate" },
       "grain": { "enabled": true, "intensity": 0.2, "size": 1.0 },
       "flicker": { "enabled": true, "intensity": 0.15, "frequency": 0.25 },
       "vignette": { "enabled": true, "intensity": 0.6 },
       "color_grade": { "enabled": true, "preset": "cinematic_dark", "intensity": 0.65 },
       "fade": { "fade_in": true, "fade_out": true, "duration": 1.5 }
     }
   }
   ```
2. Check renderer logs.

**Pass:**
- Logs show `🎬 Controlled Motion v2.0 ACTIVE`
- Logs show `Controlled Motion KB (dir=..., seed=...)`  per scene
- Logs show `🎛️ Applying Controlled Motion filters`
- Legacy effect passes (vignette, film grain, etc.) are NOT logged
- Video renders successfully with visible grain, vignette, and Ken Burns motion

---

## E7 — Deterministic retries

**Goal:** Same `job_id` + `effects_config` produces the same Ken Burns direction.

1. Render with `job_id: "test-deterministic"` and `effects_config` with `direction: "random"`
2. Note the per-scene KB directions from the logs
3. Render again with the same `job_id`
4. Compare directions

**Pass:** Identical directions on both renders (e.g., Scene 1: pan-left, Scene 2: in, Scene 3: pan-right).

---

## E8 — Soft failure

**Goal:** If an effect filter fails, rendering continues.

1. Send `effects_config` with an invalid value that might cause a filter issue:
   ```json
   { "enabled": true, "intensity": 0.5, "grain": { "enabled": true, "intensity": 999 } }
   ```
2. Check logs.

**Pass:** Renderer clamps `intensity` to `1.0` (max) via `safeClamp`. Video renders successfully. If somehow a filter throws, log shows "soft failure, continuing without" and the video still completes.

---

## Checklist

| Test | Result | Date | Notes |
|------|--------|------|-------|
| E1 — RPC returns valid config | ⬜ | | |
| E2 — Master kill switch | ⬜ | | |
| E3 — Job-level override | ⬜ | | |
| E4 — Brand-level override | ⬜ | | |
| E5 — Renderer backwards compat | ⬜ | | |
| E6 — Controlled Motion render | ⬜ | | |
| E7 — Deterministic retries | ⬜ | | |
| E8 — Soft failure | ⬜ | | |
