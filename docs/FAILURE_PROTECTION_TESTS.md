# Failure Protection + DLQ Manual Test Guide

## Prerequisites

- Access to Supabase Dashboard SQL Editor (https://supabase.com/dashboard/project/ustmetegzisztqqcjigt/sql)
- Supabase CLI configured with service role access

---

## TEST 1: Kill Switch Blocks Scheduler + Worker

### Step 1a: Activate Kill Switch (SQL Editor)

```sql
SELECT set_kill_switch(true, 'Manual test: blocking all processing');
SELECT is_kill_switch_active(); -- Should return: true
```

### Step 1b: Test Scheduler (PowerShell)

```powershell
$headers = @{
  "Authorization" = "Bearer <ANON_KEY>"
  "apikey" = "<ANON_KEY>"
  "Content-Type" = "application/json"
}
Invoke-RestMethod -Uri "https://ustmetegzisztqqcjigt.supabase.co/functions/v1/schedule-jobs" -Method POST -Headers $headers -Body "{}"
```

**Expected:** Response contains `kill_switch_active: true` or message about kill switch

### Step 1c: Test Worker (PowerShell)

```powershell
# Get a job ID first
# Then invoke worker
Invoke-RestMethod -Uri "https://ustmetegzisztqqcjigt.supabase.co/functions/v1/worker-v1" -Method POST -Headers $headers -Body '{"job_id": "<JOB_ID>"}'
```

**Expected:** HTTP 503 with `reason: "kill_switch"`

### Step 1d: Deactivate Kill Switch

```sql
SELECT set_kill_switch(false, 'Test complete');
SELECT is_kill_switch_active(); -- Should return: false
```

---

## TEST 2: Auto-Pause Only on Dependency Clusters

### Step 2a: Setup - Create Test Failures (SQL Editor)

```sql
-- Find an active campaign with jobs
SELECT gb.id, gb.name, gb.status, COUNT(j.id) as job_count
FROM generation_batches gb
JOIN jobs j ON j.batch_id = gb.id
WHERE gb.status = 'active'
GROUP BY gb.id, gb.name, gb.status
LIMIT 5;
```

### Step 2b: Create 5 DEPENDENCY Failures

```sql
-- Replace <CAMPAIGN_ID> with actual ID
WITH campaign_jobs AS (
  SELECT id FROM jobs 
  WHERE batch_id = '<CAMPAIGN_ID>' 
  AND status IN ('pending', 'queued', 'failed')
  LIMIT 5
)
UPDATE jobs SET 
  status = 'failed',
  meta = jsonb_set(
    COALESCE(meta, '{}'::jsonb),
    '{last_failure}',
    jsonb_build_object(
      'class', 'dependency',
      'signature', 'dependency:images:openai',
      'step', 'images',
      'error', 'OpenAI API returned 503 Service Unavailable',
      'at', NOW()::TEXT
    )
  ),
  updated_at = NOW()
WHERE id IN (SELECT id FROM campaign_jobs);
```

### Step 2c: Check Failure Clusters

```sql
SELECT * FROM get_failure_clusters(10, 5);
-- Should show cluster with failure_class = 'dependency'
```

### Step 2d: Run Auto-Pause

```sql
SELECT * FROM auto_pause_affected_campaigns(10, 5, 0);
-- Should show action = 'paused' for the campaign
```

### Step 2e: Verify Campaign Paused

```sql
SELECT id, name, status, auto_paused_at, auto_pause_reason
FROM generation_batches
WHERE id = '<CAMPAIGN_ID>';
-- status should be 'paused'
```

### Step 2f: Reset and Test MISCONFIG Failures

```sql
-- Reset campaign
UPDATE generation_batches 
SET status = 'active', auto_paused_at = NULL, auto_pause_reason = NULL
WHERE id = '<CAMPAIGN_ID>';

-- Change failures to misconfig
WITH campaign_jobs AS (
  SELECT id FROM jobs 
  WHERE batch_id = '<CAMPAIGN_ID>' 
  AND status = 'failed'
  LIMIT 5
)
UPDATE jobs SET 
  meta = jsonb_set(
    meta,
    '{last_failure}',
    jsonb_build_object(
      'class', 'misconfig',
      'signature', 'misconfig:voice:api_key',
      'step', 'voice',
      'error', 'Invalid API key for ElevenLabs',
      'at', NOW()::TEXT
    )
  ),
  updated_at = NOW()
WHERE id IN (SELECT id FROM campaign_jobs);

-- Run auto-pause again
SELECT * FROM auto_pause_affected_campaigns(10, 5, 0);
-- Should return EMPTY (no paused campaigns) because misconfig doesn't trigger auto-pause
```

---

## TEST 3: Requeue Respects Max Attempts + Backoff

### Step 3a: Check DLQ View

```sql
SELECT job_id, attempt_count, failure_class, can_retry, 
       hours_since_failure, error_message
FROM v_failed_jobs_dlq
ORDER BY attempt_count DESC
LIMIT 10;
```

### Step 3b: Test Requeue with attempt_count = 0

```sql
-- Find a failed job with 0 attempts
SELECT id FROM jobs WHERE status = 'failed' AND COALESCE(attempt_count, 0) = 0 LIMIT 1;

-- Requeue it
SELECT * FROM requeue_job('<JOB_ID>'::uuid);
-- success: true, generate_by should be NOW (immediate)

-- Check the job
SELECT id, status, generate_by, attempt_count FROM jobs WHERE id = '<JOB_ID>';
```

### Step 3c: Test Requeue with attempt_count = 1

```sql
-- Set attempt_count to 1
UPDATE jobs SET attempt_count = 1, status = 'failed' WHERE id = '<JOB_ID>';

-- Requeue
SELECT * FROM requeue_job('<JOB_ID>'::uuid);

-- Check generate_by (should be NOW + 30 minutes)
SELECT id, generate_by, NOW() + interval '30 minutes' as expected_around
FROM jobs WHERE id = '<JOB_ID>';
```

### Step 3d: Test Requeue with attempt_count = 2

```sql
UPDATE jobs SET attempt_count = 2, status = 'failed' WHERE id = '<JOB_ID>';
SELECT * FROM requeue_job('<JOB_ID>'::uuid);
-- generate_by should be NOW + 2 hours
```

### Step 3e: Test Requeue BLOCKED at attempt_count >= 3

```sql
UPDATE jobs SET attempt_count = 3, status = 'failed' WHERE id = '<JOB_ID>';
SELECT * FROM requeue_job('<JOB_ID>'::uuid);
-- Should return: success: false, message: "Max attempts (3) reached"
```

### Step 3f: Test Force Requeue (Override Max Attempts)

```sql
SELECT * FROM requeue_job('<JOB_ID>'::uuid, true);  -- p_force = true
-- Should succeed despite max attempts
```

### Step 3g: Test Permanent Failure Can't Be Requeued

```sql
UPDATE jobs SET 
  attempt_count = 1,
  status = 'failed',
  meta = jsonb_set(meta, '{last_failure,class}', '"permanent"')
WHERE id = '<JOB_ID>';

SELECT * FROM requeue_job('<JOB_ID>'::uuid);
-- Should return: success: false, message: "Permanent failure, not retryable"
```

### Step 3h: Test Bulk Requeue

```sql
-- Get 3 failed jobs
SELECT ARRAY_AGG(id) FROM (
  SELECT id FROM jobs WHERE status = 'failed' LIMIT 3
) sub;

-- Bulk requeue
SELECT * FROM requeue_failed_jobs(
  ARRAY['<JOB_ID_1>', '<JOB_ID_2>', '<JOB_ID_3>']::uuid[],
  false  -- don't reset attempts
);
```

---

## TEST 4: Error Classification Logic (Unit Test)

Test these error messages to verify classification:

| Error Message | Expected Class |
|---------------|----------------|
| `OpenAI API returned 503` | `dependency` |
| `ElevenLabs returned 500` | `dependency` |
| `ETIMEDOUT` | `transient` |
| `Rate limit exceeded` | `transient` |
| `Invalid API key` | `misconfig` |
| `HTTP 401 Unauthorized` | `misconfig` |
| `Content policy violation` | `permanent` |
| `HTTP 400 Bad Request` | `permanent` |

Worker should classify these correctly in `jobs.meta.last_failure.class`.

---

## Cleanup

```sql
-- Reset test jobs to pending
UPDATE jobs SET status = 'pending', meta = meta - 'last_failure'
WHERE id IN ('<JOB_ID_1>', '<JOB_ID_2>', ...);

-- Ensure kill switch is off
SELECT set_kill_switch(false, 'Cleanup');

-- Reset test campaign
UPDATE generation_batches 
SET status = 'active', auto_paused_at = NULL, auto_pause_reason = NULL
WHERE id = '<CAMPAIGN_ID>';
```
