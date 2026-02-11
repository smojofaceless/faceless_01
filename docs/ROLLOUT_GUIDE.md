# Deployment Rollout Guide

## Feature Commit: `3f6fc71` (Effects, Cost Controls, Music, DLQ)

This commit bundles 4 roadmap items. Apply migrations and deploy in the order below
to minimize risk and allow per-feature rollback.

---

## Step A — Apply Migrations (Supabase SQL Editor)

Run in this exact order. Each step is independent of later steps; if one fails, stop and fix before proceeding.

| Order | File | Feature | Risk | Notes |
|-------|------|---------|------|-------|
| 1 | `20260228001_requeue_lease_safety.sql` | DLQ requeue fix | Low | Replaces `requeue_failed_job()`. No new tables. |
| 2 | `FIX_SLOT_FOR_UPDATE.sql` | Hotfix | Low | Adds `FOR UPDATE` to slot acquisition. |
| 3 | `FIX_REQUEUE_ERROR_COL.sql` | Hotfix | Low | Adds missing error column. |
| 4 | `20260210008_cost_controls_FULL.sql` | Cost Controls | Medium | Creates 3 tables + 9 RPCs + default limits. **Consolidated file — skip 003-007.** |
| 5 | `20260210009_background_music_v1.sql` | Background Music | Medium | Creates `music_tracks` table + 3 RPCs + seed data. |
| 6 | `20260210010_music_loudness_metadata.sql` | Music loudness | Low | Adds 2 columns to music_tracks. Run AFTER step 5. |
| 7 | `20260211_effects_config.sql` | Effects Config | Medium | Creates 3 effects RPCs. **Run last — depends on brand_templates existing.** |

### Files to SKIP (superseded by consolidated):
- `20260210003_cost_controls_schema.sql` — included in FULL
- `20260210004_cost_controls_rpcs.sql` — included in FULL  
- `20260210005_cost_controls_defaults.sql` — included in FULL
- `20260210006_cost_controls_consolidated.sql` — superseded by FULL
- `20260210007_cost_controls_scheduler.sql` — included in FULL

### Verify each migration succeeded:
```sql
-- After step 4 (cost controls):
SELECT COUNT(*) FROM cost_limits WHERE scope = 'system'; -- expect 6

-- After step 5 (music):
SELECT COUNT(*) FROM music_tracks; -- expect rows (seeded per brand)

-- After step 7 (effects):
SELECT get_effects_system_defaults(); -- should return JSON with enabled=false
SELECT get_effects_preset_profile('urban_legend'); -- should return preset JSON (no "enabled" key)
```

---

## Step B — Deploy Functions + Renderer

1. **Deploy worker-v1** (includes effects + cost control integration):
   ```bash
   supabase functions deploy worker-v1
   ```

2. **Deploy schedule-jobs** (if changed):
   ```bash
   supabase functions deploy schedule-jobs
   ```

3. **Deploy renderer** (server.js + ffmpeg_presets.js):
   - Rebuild container or push to hosting service
   - The renderer accepts `effects_config` in POST body but is fully backwards-compatible

---

## Step C — Effects Are OFF by Default

Effects ship **disabled globally**:
- System defaults: `"enabled": false`
- Preset profiles: no `"enabled"` key (won't override system default)
- Brands: no config_overrides.effects set yet

### Result:
- `get_effects_config_for_job(brand_id, 'urban_legend')` → returns `{ "enabled": false, ... }`
- Worker sends `effects_config` to renderer with `enabled: false`
- Renderer sees `enabled=false` → skips Controlled Motion, legacy pipeline runs unchanged
- **Zero behavior change from current production**

### To enable for ONE test brand:
```sql
-- Find your test brand's template
SELECT id, brand_id, template_type, config_overrides
FROM brand_templates
WHERE brand_id = 'YOUR_BRAND_UUID'
  AND is_default = true
LIMIT 1;

-- Add effects.enabled = true to its config_overrides
UPDATE brand_templates
SET config_overrides = jsonb_set(
  COALESCE(config_overrides, '{}'::jsonb),
  '{effects}',
  '{"enabled": true}'::jsonb
)
WHERE brand_id = 'YOUR_BRAND_UUID'
  AND is_default = true;

-- Verify:
SELECT get_effects_config_for_job('YOUR_BRAND_UUID', 'urban_legend');
-- Should now return { "enabled": true, "intensity": 0.6, "kenburns": {...}, ... }
```

### To disable for a brand (rollback):
```sql
UPDATE brand_templates
SET config_overrides = config_overrides - 'effects'
WHERE brand_id = 'YOUR_BRAND_UUID';
```

### To set brand-level ceilings:
```sql
UPDATE brand_templates
SET config_overrides = jsonb_set(
  COALESCE(config_overrides, '{}'::jsonb),
  '{effects,limits}',
  '{
    "kenburns": { "max_pan_speed": 0.4 },
    "grain": { "max_intensity": 0.25 },
    "flicker": { "max_intensity": 0.15 }
  }'::jsonb
)
WHERE brand_id = 'YOUR_BRAND_UUID'
  AND is_default = true;
```

Ceilings only lower values — they never raise them. The renderer logs which fields were capped.

---

## Step D — Baseline Parity Verification

Before enabling effects on any brand, run these two checks:

### Test 1: No effects_config in payload
Send a render request **without** `effects_config` in the POST body.
- Expected: identical output to current production
- Log should show NO "Controlled Motion" messages

### Test 2: effects_config with enabled=false
Send a render request with:
```json
{
  "effects_config": { "enabled": false }
}
```
- Expected: identical output to Test 1 (legacy pipeline unchanged)
- Log should show: `Controlled Motion: DISABLED (enabled=false) — legacy pipeline unchanged`

### Test 3: Determinism check
Run the same job twice with effects enabled.
- Expected: identical Ken Burns motion (same seed → same direction per scene)

---

## Soft-Fail Guarantees

The renderer has 3 layers of soft-fail protection:

| Layer | What fails | Fallback |
|-------|-----------|----------|
| Filter build | `buildFiltersFromEffectsConfig()` throws | Falls back to legacy pipeline entirely |
| Filter apply | FFmpeg rejects filtergraph | Renders without effects, cleans up partial output |
| Per-scene KB | `buildKenBurnsFromConfig()` throws | Falls back to standard `getKenBurnsFilter()` |

All failures log warnings with `⚠️` prefix but **never crash the render**.

---

## Rollback Plan

### Roll back effects only:
1. Set system default back to disabled (it already is)
2. Remove any brand overrides: `UPDATE brand_templates SET config_overrides = config_overrides - 'effects' WHERE ...`
3. No code rollback needed — renderer handles missing/disabled effects_config identically to pre-v4.0

### Roll back entire commit:
```bash
git revert 3f6fc71
git push
```
Then drop the new tables/functions in Supabase SQL Editor if migrations were applied.
