# Worker V1 Smoke Tests

> **Last Updated:** February 10, 2026  
> **Status:** ✅ Production Ready - End-to-end verified

---

## Prerequisites

1. Worker V1 deployed: `supabase functions deploy worker-v1`
2. A brand exists in `brands` table
3. Required API keys set in Supabase Edge Function secrets:
   - `OPENAI_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `FFMPEG_RENDERER_URL` (preferred) or `CREATOMATE_API_KEY` (fallback)

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Auto-set by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Auto-set by Supabase |
| `OPENAI_API_KEY` | Yes | For story, scenes, and image generation |
| `ELEVENLABS_API_KEY` | Yes | For voice synthesis |
| `FFMPEG_RENDERER_URL` | **Preferred** | Your Render.com FFmpeg service (e.g., `https://xxx.onrender.com`) |
| `VIDEO_RENDERER_URL` | Alternative | Alias for FFMPEG_RENDERER_URL |
| `CREATOMATE_API_KEY` | Fallback | Only used if no FFmpeg URL set |

---

## Duration Format Support

The worker now handles duration in two formats:

```javascript
// Format 1: Simple number (seconds)
meta: { duration: 75 }

// Format 2: Object with range (campaigns use this)
meta: { duration: { minSeconds: 60, maxSeconds: 90 } }
// Worker will use average: (60 + 90) / 2 = 75 seconds
```

---

## Test A: Fresh Job End-to-End

### Setup SQL
```sql
-- Create a test job with minimal required fields
INSERT INTO jobs (
  id, 
  brand_id, 
  status, 
  vibe_preset, 
  length_preset,
  meta,
  scheduled_post_at
)
VALUES (
  '00000000-0000-0000-0000-000000000001', -- Test job ID
  (SELECT id FROM brands LIMIT 1),         -- First brand
  'pending',
  'urban_legend',
  'short',
  jsonb_build_object(
    'platforms', ARRAY['tiktok'],
    'duration', 60
  ),
  NOW() + INTERVAL '24 hours'
)
ON CONFLICT (id) DO UPDATE SET 
  status = 'pending',
  locked_by = NULL,
  locked_at = NULL,
  lease_expires_at = NULL,
  video_url = NULL,
  meta = EXCLUDED.meta;
```

### Invoke Worker
```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/worker-v1 \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"job_id": "00000000-0000-0000-0000-000000000001"}'
```

### Verify - Expected Outcomes

```sql
-- ✅ Job status = 'complete', progress = 100, video_url populated
SELECT id, status, progress, video_url, current_step, 
       meta->'steps' as steps
FROM jobs 
WHERE id = '00000000-0000-0000-0000-000000000001';

-- ✅ job_assets has all expected keys
SELECT idempotency_key, type, public_url IS NOT NULL as has_url
FROM job_assets
WHERE job_id = '00000000-0000-0000-0000-000000000001'
ORDER BY created_at;

-- Expected keys:
-- {job_id}:story_generate
-- {job_id}:uniqueness_check
-- {job_id}:scenes_subtitles
-- {job_id}:voice_synthesis
-- {job_id}:music_select
-- {job_id}:image_generate:scene_0 (per scene)
-- {job_id}:image_generate:scene_1
-- ...
-- {job_id}:subtitle_generation
-- {job_id}:video_assemble
-- {job_id}:upload_storage
-- {job_id}:schedule_post

-- ✅ Exactly 1 post per platform (no duplicates)
SELECT job_id, platform, COUNT(*) as count
FROM posts 
WHERE job_id = '00000000-0000-0000-0000-000000000001'
GROUP BY job_id, platform;
```

---

## Test B: Retry Same Job (Idempotency)

### Invoke Worker Again (same job_id)
```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/worker-v1 \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"job_id": "00000000-0000-0000-0000-000000000001"}'
```

### Verify - Expected Outcomes

```sql
-- ✅ No NEW job_assets rows (same count as before)
SELECT COUNT(*) FROM job_assets 
WHERE job_id = '00000000-0000-0000-0000-000000000001';

-- ✅ No additional posts rows
SELECT COUNT(*) FROM posts 
WHERE job_id = '00000000-0000-0000-0000-000000000001';

-- ✅ Worker response should show mostly "skipped" steps
-- Check response JSON for step_results with skipped: true
```

---

## Test C: Crash Mid-Job (Resume)

### Setup - Create Job and Fail Intentionally

```sql
-- Create a new test job
INSERT INTO jobs (
  id, 
  brand_id, 
  status, 
  vibe_preset, 
  length_preset,
  meta,
  scheduled_post_at
)
VALUES (
  '00000000-0000-0000-0000-000000000002', -- Test job 2
  (SELECT id FROM brands LIMIT 1),
  'pending',
  'urban_legend',
  'short',
  jsonb_build_object(
    'platforms', ARRAY['tiktok'],
    'duration', 60
  ),
  NOW() + INTERVAL '24 hours'
);
```

### Method 1: Temporary Bad API Key
1. Set `OPENAI_API_KEY` to invalid value temporarily
2. Run worker - it will fail at images step
3. Restore correct API key
4. Run worker again

### Method 2: Force Status Reset
```sql
-- After a partial run, simulate failure
UPDATE jobs 
SET status = 'failed', 
    locked_by = NULL, 
    locked_at = NULL, 
    lease_expires_at = NULL
WHERE id = '00000000-0000-0000-0000-000000000002';

-- Reset status to pending for retry
UPDATE jobs 
SET status = 'pending'
WHERE id = '00000000-0000-0000-0000-000000000002';
```

### Invoke Worker
```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/worker-v1 \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"job_id": "00000000-0000-0000-0000-000000000002"}'
```

### Verify - Expected Outcomes

```sql
-- ✅ Worker resumes from first incomplete step
-- Check jobs.meta.steps - completed steps should be preserved
SELECT meta->'steps' FROM jobs 
WHERE id = '00000000-0000-0000-0000-000000000002';

-- ✅ Per-scene images resume where they left off
SELECT idempotency_key, created_at 
FROM job_assets
WHERE job_id = '00000000-0000-0000-0000-000000000002'
  AND idempotency_key LIKE '%image_generate%'
ORDER BY idempotency_key;
```

---

## Test D: Concurrency (Two Workers Same Job)

### Setup
```sql
-- Create a fresh job
INSERT INTO jobs (
  id, 
  brand_id, 
  status, 
  vibe_preset, 
  length_preset,
  meta,
  scheduled_post_at
)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  (SELECT id FROM brands LIMIT 1),
  'pending',
  'urban_legend',
  'short',
  jsonb_build_object(
    'platforms', ARRAY['tiktok'],
    'duration', 60
  ),
  NOW() + INTERVAL '24 hours'
);
```

### Fire Two Requests Simultaneously
```bash
# In terminal 1
curl -X POST https://<project-ref>.supabase.co/functions/v1/worker-v1 \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"job_id": "00000000-0000-0000-0000-000000000003"}' &

# In terminal 2 (immediately)
curl -X POST https://<project-ref>.supabase.co/functions/v1/worker-v1 \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"job_id": "00000000-0000-0000-0000-000000000003"}' &

wait
```

### Verify - Expected Outcomes

```
✅ One returns HTTP 200 (success)
✅ One returns HTTP 409 (Conflict - active lease)
✅ The 409 response did NOT do any work
```

Check that only one worker's work is visible:
```sql
SELECT locked_by, attempt_count FROM jobs 
WHERE id = '00000000-0000-0000-0000-000000000003';

-- Should show single attempt_count (not 2)
```

---

## Cleanup

```sql
-- Delete test jobs and related data
DELETE FROM posts WHERE job_id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003'
);

DELETE FROM job_assets WHERE job_id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003'
);

DELETE FROM jobs WHERE id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003'
);
```

---

## Checklist Summary

| Test | Expected | Verified |
|------|----------|----------|
| A. Fresh job | complete, video_url, all assets, 1 post | ⬜ |
| B. Retry same job | No new assets, no new posts, fast skip | ⬜ |
| C. Crash + resume | Resumes from incomplete step | ⬜ |
| D. Concurrency | One 200, one 409 | ⬜ |
