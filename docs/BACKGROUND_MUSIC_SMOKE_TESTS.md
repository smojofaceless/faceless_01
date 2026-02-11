# Background Music V1 — Smoke Tests

> **Version:** 1.1 (hardened)  
> **Date:** February 10, 2026  
> **Migration:** `20260210009_background_music_v1.sql`  
> **Worker:** v2.7 | **Renderer:** v3.2.1

---

## Prerequisites

- Migration `20260210009_background_music_v1.sql` applied
- Worker-v1 deployed (v2.7)
- FFmpeg renderer deployed (v3.2)
- At least 1 music track MP3 uploaded to Storage at `brands/{brand_id}/music/{track_id}.mp3`

---

## Test 1: music_tracks Table Exists

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'music_tracks'
ORDER BY ordinal_position;
```

**Expected:** Columns: `id`, `brand_id`, `display_name`, `file_path`, `duration_seconds`, `loopable`, `bpm`, `mood`, `energy`, `tags`, `vibe_presets`, `is_active`, `created_at`, `updated_at`

---

## Test 2: Default Tracks Seeded

```sql
SELECT id, brand_id, display_name, mood, energy, vibe_presets
FROM music_tracks
ORDER BY brand_id, id;
```

**Expected:** 3 tracks per brand (`ambient_dark_01`, `tension_pulse_01`, `eerie_piano_01`)

---

## Test 3: get_brand_music_config Returns Defaults

```sql
SELECT get_brand_music_config('YOUR_BRAND_ID'::uuid);
```

**Expected:**
```json
{
  "enabled": true,
  "default_volume": 0.18,
  "ducking": { "enabled": true, "duck_volume": 0.08, "attack_ms": 150, "release_ms": 250 },
  "fade": { "in_ms": 800, "out_ms": 1200 }
}
```

---

## Test 4: get_brand_music_config Respects brand_templates Override

```sql
-- Set custom music config on a brand template
UPDATE brand_templates 
SET config_overrides = config_overrides || '{"music": {"default_volume": 0.25, "ducking": {"enabled": false}}}'::jsonb
WHERE brand_id = 'YOUR_BRAND_ID'::uuid
AND is_default = true;

-- Query
SELECT get_brand_music_config('YOUR_BRAND_ID'::uuid);
```

**Expected:** `default_volume` = 0.25, `ducking.enabled` = false (overridden), but `fade` still has defaults (merged)

```sql
-- Cleanup
UPDATE brand_templates 
SET config_overrides = config_overrides - 'music'
WHERE brand_id = 'YOUR_BRAND_ID'::uuid AND is_default = true;
```

---

## Test 5: get_brand_music_tracks Returns Active Tracks

```sql
SELECT * FROM get_brand_music_tracks('YOUR_BRAND_ID'::uuid);
```

**Expected:** 3 rows (all active tracks), ordered by `track_id` ASC

---

## Test 6: get_brand_music_tracks Filters by Vibe

```sql
SELECT * FROM get_brand_music_tracks('YOUR_BRAND_ID'::uuid, 'urban_legend');
```

**Expected:** `ambient_dark_01` and `eerie_piano_01` (both have `urban_legend` in `vibe_presets`)

---

## Test 7: get_brand_music_tracks Excludes Inactive

```sql
-- Deactivate a track
UPDATE music_tracks SET is_active = false 
WHERE id = 'tension_pulse_01' AND brand_id = 'YOUR_BRAND_ID'::uuid;

SELECT * FROM get_brand_music_tracks('YOUR_BRAND_ID'::uuid);

-- Cleanup
UPDATE music_tracks SET is_active = true 
WHERE id = 'tension_pulse_01' AND brand_id = 'YOUR_BRAND_ID'::uuid;
```

**Expected:** Only 2 rows returned while track is inactive

---

## Test 8: Deterministic Track Selection (Same Input = Same Output)

```sql
SELECT * FROM select_music_track_deterministic(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'YOUR_BRAND_ID'::uuid,
    'urban_legend'
);
```

Run 3 times. **Expected:** Same `track_id` every time.

---

## Test 9: Deterministic Track Selection (Different Jobs = Varied Tracks)

```sql
SELECT * FROM select_music_track_deterministic(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'YOUR_BRAND_ID'::uuid, NULL
);
SELECT * FROM select_music_track_deterministic(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'YOUR_BRAND_ID'::uuid, NULL
);
SELECT * FROM select_music_track_deterministic(
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'YOUR_BRAND_ID'::uuid, NULL
);
```

**Expected:** Different `track_id` values (given 3 tracks, all should appear across varied UUIDs)

---

## Test 10: Worker Music Step — Idempotent Selection

Run a job through the pipeline. Check:

```sql
-- Music asset stored
SELECT idempotency_key, type, meta->'track_id', meta->'music_config', meta->'source'
FROM job_assets
WHERE job_id = 'YOUR_JOB_ID'::uuid
AND idempotency_key LIKE '%music_select';

-- Job meta updated
SELECT meta->'music_track_id', meta->'music_url', meta->'music_config', meta->'music_enabled'
FROM jobs
WHERE id = 'YOUR_JOB_ID'::uuid;
```

**Expected:** 
- `job_assets` has entry with type `music`, `source` = `db_tracks` or `fallback_hardcoded`
- `jobs.meta` has `music_track_id`, `music_url`, `music_config`, `music_enabled`

---

## Test 11: Worker Music Step — Resume After Failure

1. Run job until music step completes
2. Force-fail job at images step
3. Requeue job
4. Check music step is skipped on retry

```sql
SELECT meta->'steps'->'music' FROM jobs WHERE id = 'YOUR_JOB_ID'::uuid;
```

**Expected:** Step status = `complete` or `skipped`, same `track_id` as original run

---

## Test 12: Renderer — Music Mixing with Ducking

Send a test render request directly to the renderer:

```bash
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" \
  -d '{
    "images": ["https://example.com/test.png"],
    "audio_url": "https://example.com/narration.mp3",
    "durations": [10],
    "music_url": "https://example.com/music.mp3",
    "music_volume": 18,
    "music_config": {
      "ducking": { "enabled": true, "duck_volume": 0.08, "attack_ms": 150, "release_ms": 250 },
      "fade": { "in_ms": 800, "out_ms": 1200 }
    },
    "effects": { "kenBurns": false }
  }'
```

**Expected:** 
- Render completes without FFmpeg errors
- Music is audible but quieter during narration (ducking)
- Music fades in over 0.8s at start
- Music fades out over 1.2s before end

---

## Test 13: Renderer — Music Without Ducking (Fallback)

```bash
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" \
  -d '{
    "images": ["https://example.com/test.png"],
    "audio_url": "https://example.com/narration.mp3",
    "durations": [10],
    "music_url": "https://example.com/music.mp3",
    "music_volume": 15,
    "music_config": null,
    "effects": { "kenBurns": false }
  }'
```

**Expected:** Render completes with simple volume-reduced music mix (no ducking, no fades). Backwards compatible.

---

## Test 14: Music Step — Brand with Music Disabled

```sql
-- Disable music for a brand
UPDATE brand_templates 
SET config_overrides = config_overrides || '{"music": {"enabled": false}}'::jsonb
WHERE brand_id = 'YOUR_BRAND_ID'::uuid AND is_default = true;
```

Run a job. **Expected:**
- Music step returns `skipped: true`
- `jobs.meta.music_enabled` = false
- Assemble step sends `music_url: null` to renderer
- Video renders without music

```sql
-- Cleanup
UPDATE brand_templates 
SET config_overrides = config_overrides - 'music'
WHERE brand_id = 'YOUR_BRAND_ID'::uuid AND is_default = true;
```

---

## Test 15: Cost Controls — Music Step Is Free

```sql
-- Check no api_usage records for music step
SELECT * FROM api_usage 
WHERE job_id = 'YOUR_JOB_ID'::uuid 
AND step_name = 'music';
```

**Expected:** 0 rows. Music selection makes no API calls.

---

## Test 16: Cost Controls — Music Mixing Counted as FFmpeg

```sql
SELECT service, step_name, render_seconds, estimated_cost_cents
FROM api_usage 
WHERE job_id = 'YOUR_JOB_ID'::uuid 
AND step_name = 'assemble';
```

**Expected:** Service = `ffmpeg_renderer`, `render_seconds` > 0. Music mixing is part of the render cost.

---

## Test 17: RLS — Brand Owner Can Read Tracks

Login as the brand owner and:

```sql
SELECT * FROM music_tracks WHERE brand_id = 'YOUR_BRAND_ID'::uuid;
```

**Expected:** Returns tracks. Non-owners should get 0 rows.

---

## Test 18: Step Logger — Music Snapshot Captured

```sql
SELECT * FROM get_job_step_logs('YOUR_JOB_ID'::uuid)
WHERE step_name = 'music';
```

**Expected:** Events include `started`, `completed`, and a `snapshot` with track_id, volume, ducking settings.

---

## Cleanup

```sql
-- Remove test data
DELETE FROM music_tracks WHERE id LIKE 'test_%';
DELETE FROM job_assets WHERE idempotency_key LIKE '%music_select' AND job_id = 'YOUR_JOB_ID'::uuid;
DELETE FROM api_usage WHERE job_id = 'YOUR_JOB_ID'::uuid;
```

---

## Edge-Case Tests (M1–M4)

> Added in hardening pass v3.2.1

### Test M1: Music File Missing from Storage → Warning Snapshot

1. Ensure the brand has a `music_tracks` row but **no MP3 uploaded** to Storage
2. Run a job for that brand

```sql
-- Verify warning snapshot captured
SELECT event_type, data->>'warn_code', data->>'reason'
FROM get_job_step_logs('YOUR_JOB_ID'::uuid)
WHERE step_name = 'music' AND event_type = 'warn';
```

**Expected:**
- `warn_code` = `music_missing_file`
- `reason` contains "MP3 not found in storage"
- Job continues to assemble step — video renders **without music** (no hard failure)
- `job_assets` row exists with `meta.track_id` set and `meta.music_url` = null or empty

---

### Test M2: Quiet Narration → Ducking Still Activates

Send a render request with very quiet narration audio and ducking enabled:

```bash
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" \
  -d '{
    "images": ["https://example.com/test.png"],
    "audio_url": "https://example.com/whisper_narration.mp3",
    "durations": [15],
    "music_url": "https://example.com/music.mp3",
    "music_volume": 18,
    "music_config": {
      "ducking": { "enabled": true, "duck_volume": 0.08, "attack_ms": 150, "release_ms": 250 },
      "fade": { "in_ms": 800, "out_ms": 1200 }
    },
    "effects": { "kenBurns": false }
  }'
```

**Expected:**
- Render completes without FFmpeg errors
- `sidechaincompress` appears in the filter chain log
- `threshold=0.02` ensures even quiet narration triggers ducking
- Music volume reduces during narration segments

**Why this matters:** If the threshold were too high (e.g., 0.5), quiet narration wouldn't trigger ducking and music would overpower speech.

---

### Test M3: Long Video + Short Music → Looping Works, No Pop

1. Create a render with a short music track (e.g., 10s) and long video (e.g., 60s):

```bash
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" \
  -d '{
    "images": ["https://example.com/img1.png", "https://example.com/img2.png", "https://example.com/img3.png"],
    "audio_url": "https://example.com/narration_60s.mp3",
    "durations": [20, 20, 20],
    "music_url": "https://example.com/short_10s_loop.mp3",
    "music_volume": 18,
    "music_config": {
      "ducking": { "enabled": true, "duck_volume": 0.08 },
      "fade": { "in_ms": 800, "out_ms": 1200 },
      "loopable": true
    },
    "effects": { "kenBurns": false }
  }'
```

**Expected:**
- Render completes successfully
- Music loops seamlessly throughout the 60s video
- Fade-out starts at ~58.8s (60 - 1.2)
- No audible pop or cut at loop boundaries
- `duration=first` in amix truncates output to narration length

2. Repeat with `"loopable": false`:

**Expected:**
- Music plays once (10s) then silence for remaining 50s
- Fade-out at end of music still applies
- No `-stream_loop` in FFmpeg command

---

### Test M4: Retry Determinism → Same Job Gets Same Track

1. Run a job through the music step
2. Record the selected `track_id` from logs/assets
3. Delete the `job_assets` row for the music step:

```sql
DELETE FROM job_assets 
WHERE job_id = 'YOUR_JOB_ID'::uuid 
AND idempotency_key LIKE '%music_select';
```

4. Clear music meta from the job:

```sql
UPDATE jobs 
SET meta = meta - 'music_track_id' - 'music_url' - 'music_config' - 'music_enabled'
WHERE id = 'YOUR_JOB_ID'::uuid;
```

5. Re-run the music step (requeue the job)

```sql
SELECT meta->>'music_track_id' FROM jobs WHERE id = 'YOUR_JOB_ID'::uuid;
```

**Expected:** Same `track_id` as step 2 — deterministic selection via `hash(job_id + brand_id) % track_count` guarantees this.

**Why this matters:** Retries must select the same track to avoid non-deterministic behavior across attempts. The hash is computed from immutable inputs (job UUID + brand UUID).

---

### Test M5: Soft Failure → Job_Assets Always Persisted

1. Force a failure in the music step (e.g., corrupt the `get_brand_music_config` RPC temporarily)
2. Run a job

```sql
-- Verify asset was persisted even on failure
SELECT meta->>'source', meta->>'error', meta->>'applied'
FROM job_assets
WHERE job_id = 'YOUR_JOB_ID'::uuid
AND idempotency_key LIKE '%music_select';

-- Verify job meta records the failure
SELECT meta->>'music_enabled', meta->>'music_error'
FROM jobs WHERE id = 'YOUR_JOB_ID'::uuid;

-- Verify warning snapshot
SELECT event_type, data->>'warn_code'
FROM get_job_step_logs('YOUR_JOB_ID'::uuid)
WHERE step_name = 'music' AND event_type = 'warn';
```

**Expected:**
- `job_assets` row exists with `source` = `error`, `applied` = `false`, `error` = failure message
- `jobs.meta.music_enabled` = false, `music_error` set
- Warning snapshot has `warn_code` = `music_selection_failed`
- Job **continues** to assemble step — video renders without music (soft failure)

---

### Test M6: Renderer Backward Compat — No music_config

Send a render request with `music_url` but **no** `music_config` (simulating pre-v3.2 worker):

```bash
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" \
  -d '{
    "images": ["https://example.com/test.png"],
    "audio_url": "https://example.com/narration.mp3",
    "durations": [10],
    "music_url": "https://example.com/music.mp3",
    "music_volume": 15,
    "effects": { "kenBurns": false }
  }'
```

**Expected:**
- Render completes successfully (no crash on null musicConfig)
- Music mixed at 15% volume with simple amix (no ducking, no fades)
- Behavior identical to pre-v3.2 renderer
