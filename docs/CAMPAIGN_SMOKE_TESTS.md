# Campaign System V1 - Smoke Tests

## Overview
This document contains smoke test queries and UI verification steps for the Campaign System V1 implementation.

## Pre-requisites
1. Run the migration: `20260210_campaign_system_v1.sql`
2. Run the migration: `20260219_job_claim_lease_system.sql` (for lease system)
3. Have at least one brand with templates in `brand_templates`
4. Have a browser with access to the admin UI

---

## UI Compatibility Fixes (Feb 8, 2026)

The following fixes were applied to resolve UI/data format mismatches:

### Files Changed

| File | Fixes Applied |
|------|--------------|
| `js/services/campaignManager.js` | Support both `windows[]` array and `windowA/windowB` formats; support `jitterMinutes` and `jitterRange`; support `platformOffsetMinutes` and `platformOffsets` |
| `js/pages/campaign.js` | Fix `getActiveBrand()` to use `brandManager.getActiveBrand()`; fix redirect to use `campaign.campaignId`; guard `loadBrand()` against undefined; fix `formatPresetName()` null check; support both `scheduled_post_at`/`scheduledAt` and `vibe_preset`/`preset` |
| `js/pages/campaign-detail.js` | Extract `campaign` from nested RPC response `{campaign, stats}`; use pre-computed stats; fix status name mismatches (`complete` not `completed`); look up brand name from brandManager |

### Verification Steps

1. **Brand Auto-Loading**: Navigate to `/pages/campaign.html` - should automatically load the brand shown in the navbar dropdown
2. **Schedule Preview**: Change video count or dates - schedule preview should render without errors
3. **Campaign Creation**: Create a campaign - should redirect to detail page with correct campaign ID
4. **Campaign Detail**: View campaign detail - should show brand name (not "Unknown") and correct stats

---

## Job Claim + Lease System Smoke Tests (V2.0)

### 1. Verify Lease Columns Exist

```sql
-- Check jobs has lease columns
SELECT column_name, data_type, column_default
FROM information_schema.columns 
WHERE table_name = 'jobs' 
AND column_name IN ('locked_at', 'locked_by', 'lease_expires_at', 'attempt_count');

-- Expected:
-- locked_at        | timestamp with time zone | NULL
-- locked_by        | text                     | NULL
-- lease_expires_at | timestamp with time zone | NULL
-- attempt_count    | integer                  | 0
```

### 2. Test claim_job RPC

```sql
-- First, create or find a pending job
-- Then test claiming it
SELECT * FROM claim_job(
    p_job_id := '<JOB_ID>',
    p_locked_by := 'test-worker-001',
    p_lease_seconds := 900
);

-- Expected: { claimed: true, message: 'Job claimed successfully', already_locked_by: null }

-- Verify the claim was recorded
SELECT id, status, locked_at, locked_by, lease_expires_at
FROM jobs WHERE id = '<JOB_ID>';

-- Try claiming again (should fail)
SELECT * FROM claim_job(
    p_job_id := '<JOB_ID>',
    p_locked_by := 'test-worker-002',
    p_lease_seconds := 900
);

-- Expected: { claimed: false, message: 'Job is locked by another worker', already_locked_by: 'test-worker-001' }
```

### 3. Test heartbeat_job RPC

```sql
-- Extend lease and update progress
SELECT * FROM heartbeat_job(
    p_job_id := '<JOB_ID>',
    p_locked_by := 'test-worker-001',
    p_lease_seconds := 900,
    p_progress := 50,
    p_status := 'generating'
);

-- Expected: { success: true, message: 'Lease extended' }

-- Verify lease was extended
SELECT id, progress, lease_expires_at
FROM jobs WHERE id = '<JOB_ID>';
```

### 4. Test release_job RPC

```sql
-- Release on success
SELECT * FROM release_job(
    p_job_id := '<JOB_ID>',
    p_locked_by := 'test-worker-001',
    p_final_status := 'complete',
    p_error_message := NULL,
    p_final_progress := 100
);

-- Expected: { success: true, message: 'Job released successfully' }

-- Verify lock was cleared
SELECT id, status, locked_at, locked_by, lease_expires_at, progress
FROM jobs WHERE id = '<JOB_ID>';

-- status = 'complete', locked_at/locked_by/lease_expires_at = NULL, progress = 100
```

### 5. Test sweep_stale_jobs RPC

```sql
-- Create a stale job (manually set expired lease for testing)
UPDATE jobs SET 
    status = 'generating',
    locked_at = NOW() - interval '2 hours',
    locked_by = 'stale-worker',
    lease_expires_at = NOW() - interval '1 hour'
WHERE id = '<JOB_ID>';

-- Dry run (preview only)
SELECT * FROM sweep_stale_jobs(
    p_stale_threshold_minutes := 30,
    p_dry_run := true
);

-- Actual sweep
SELECT * FROM sweep_stale_jobs(
    p_stale_threshold_minutes := 30,
    p_dry_run := false
);

-- Verify job was marked failed
SELECT id, status, attempt_count, meta->>'stale_reason' as stale_reason
FROM jobs WHERE id = '<JOB_ID>';
```

### 6. Test find_eligible_jobs Respects Lease

```sql
-- Create two jobs: one locked, one not locked
-- The locked one should NOT appear in results

SELECT * FROM find_eligible_jobs(
    p_lead_time_hours := 24,
    p_max_jobs := 10
);

-- Verify: Only unlocked jobs with generate_by <= NOW() appear
```

---

## "Are We Done?" Validation Queries

Run these queries in Supabase Dashboard SQL Editor to validate the lease system is working correctly.

### 1. Check for Stuck In-Progress Jobs

```sql
-- Count jobs by in-progress status
SELECT status, count(*)
FROM jobs
WHERE status IN ('generating', 'assembling', 'rendering')
GROUP BY 1
ORDER BY 2 DESC;

-- If any exist, check their lease status
SELECT id, status, locked_by, lease_expires_at, updated_at,
       CASE 
           WHEN lease_expires_at IS NULL THEN 'NO LEASE'
           WHEN lease_expires_at < NOW() THEN 'EXPIRED'
           ELSE 'ACTIVE'
       END as lease_status
FROM jobs
WHERE status IN ('generating', 'assembling', 'rendering')
ORDER BY updated_at ASC
LIMIT 50;
```

### 2. Verify Sweeper Fails Stale Jobs

```sql
-- Dry run: preview what would be swept
SELECT * FROM sweep_stale_jobs(60, true);

-- If stale jobs found, run actual sweep
SELECT * FROM sweep_stale_jobs(60, false);

-- Verify failed jobs have cleared locks
SELECT id, status, error, locked_by, lease_expires_at, attempt_count
FROM jobs
WHERE status = 'failed'
ORDER BY updated_at DESC
LIMIT 20;
```

### 3. Test Double-Claim Prevention

```sql
-- Find a pending job
SELECT id FROM jobs WHERE status IN ('pending', 'queued') LIMIT 1;

-- Try claiming with worker-1
SELECT * FROM claim_job('<JOB_ID>', 'test-worker-001', 900);
-- Expected: { claimed: true, message: 'Job claimed successfully' }

-- Try claiming same job with worker-2
SELECT * FROM claim_job('<JOB_ID>', 'test-worker-002', 900);
-- Expected: { claimed: false, message: 'Job is locked by another worker', already_locked_by: 'test-worker-001' }

-- Clean up: release the job
SELECT * FROM release_job('<JOB_ID>', 'test-worker-001', 'pending', NULL, NULL);
```

---

## Database Smoke Tests

### 1. Verify Schema Extensions

```sql
-- Check generation_batches has new columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'generation_batches' 
AND column_name IN ('status', 'config', 'video_count');

-- Check jobs has new columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'jobs' 
AND column_name IN ('batch_id', 'scheduled_post_at', 'brand_id');

-- Verify new status enum values exist
SELECT enum_range(NULL::campaign_status);
-- Should return: {draft,planned,active,paused,complete,cancelled}
```

### 2. Test create_campaign RPC

```sql
-- Create a test campaign with 3 videos
SELECT create_campaign(
    p_brand_id := '<YOUR_BRAND_ID>',
    p_video_count := 3,
    p_platforms := ARRAY['tiktok', 'reels']::text[],
    p_config := '{
        "windows": ["08:00", "12:00", "18:00"],
        "jitterMinutes": 15,
        "platformOffsetMinutes": 5
    }'::jsonb,
    p_jobs := '[
        {"scheduled_post_at": "2025-02-15T13:00:00Z", "vibe_preset": "urban_legend", "meta": {"platforms": ["tiktok", "reels"]}},
        {"scheduled_post_at": "2025-02-15T17:00:00Z", "vibe_preset": "one_too_many", "meta": {"platforms": ["tiktok", "reels"]}},
        {"scheduled_post_at": "2025-02-16T13:00:00Z", "vibe_preset": "urban_legend", "meta": {"platforms": ["tiktok", "reels"]}}
    ]'::jsonb
);

-- Verify campaign was created
SELECT id, status, video_count, created_at 
FROM generation_batches 
ORDER BY created_at DESC 
LIMIT 1;

-- Verify jobs were created
SELECT id, batch_id, scheduled_post_at, vibe_preset, status 
FROM jobs 
WHERE batch_id = (SELECT id FROM generation_batches ORDER BY created_at DESC LIMIT 1);
```

### 3. Test update_campaign_status RPC

```sql
-- Get the campaign ID from above
-- Pause the campaign
SELECT update_campaign_status(
    p_campaign_id := '<CAMPAIGN_ID>',
    p_status := 'paused',
    p_cancel_pending_jobs := false
);

-- Verify status changed
SELECT id, status FROM generation_batches WHERE id = '<CAMPAIGN_ID>';

-- Resume the campaign
SELECT update_campaign_status(
    p_campaign_id := '<CAMPAIGN_ID>',
    p_status := 'active',
    p_cancel_pending_jobs := false
);

-- Cancel the campaign with job cancellation
SELECT update_campaign_status(
    p_campaign_id := '<CAMPAIGN_ID>',
    p_status := 'cancelled',
    p_cancel_pending_jobs := true
);

-- Verify jobs were cancelled
SELECT id, status FROM jobs WHERE batch_id = '<CAMPAIGN_ID>';
```

### 4. Test get_campaign_summary RPC

```sql
-- Get summary for a campaign
SELECT * FROM get_campaign_summary('<CAMPAIGN_ID>');

-- Should return:
-- - id, status, video_count, config, created_at, updated_at
-- - total_jobs, pending_jobs, processing_jobs, completed_jobs, failed_jobs
```

### 5. Verify Indexes

```sql
-- Check indexes were created
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'jobs' 
AND indexname LIKE 'idx_jobs_%';

-- Should see:
-- - idx_jobs_batch_id
-- - idx_jobs_scheduled_post_at
-- - idx_jobs_brand_id
```

---

## UI Smoke Tests

### 1. Campaign Creation Page (`/pages/campaign.html`)

**Test Auto Mode (Default):**
1. ✅ Navigate to `/pages/campaign.html`
2. ✅ Verify brand is displayed (read from navbar)
3. ✅ Change video count using +/- buttons
4. ✅ Select/deselect platforms
5. ✅ Change start date
6. ✅ Verify summary updates in real-time
7. ✅ Verify schedule preview updates when form changes

**Test Advanced Mode:**
1. ✅ Toggle "Advanced" checkbox in header
2. ✅ Verify advanced settings panel appears
3. ✅ Change posting window times
4. ✅ Adjust jitter range
5. ✅ Adjust platform offset
6. ✅ Verify preset weight sliders show values from DB
7. ✅ Adjust preset weights (should normalize to 100%)
8. ✅ Verify schedule preview reflects advanced settings

**Test Campaign Creation:**
1. ✅ Configure a campaign (any mode)
2. ✅ Click "Create Campaign"
3. ✅ Verify loading state appears
4. ✅ Verify success toast appears
5. ✅ Verify redirect to campaign detail page
6. ✅ Verify campaign appears in database

### 2. Campaign Detail Page (`/pages/campaign-detail.html?id=<ID>`)

**Test Campaign View:**
1. ✅ Navigate to campaign detail page
2. ✅ Verify status badge shows correct status
3. ✅ Verify meta info (created date, brand)
4. ✅ Verify stats cards show correct counts
5. ✅ Verify progress bar reflects completion
6. ✅ Verify jobs table shows all scheduled jobs

**Test Lifecycle Controls:**
1. ✅ Click "Pause" button
2. ✅ Verify confirmation modal appears
3. ✅ Confirm pause
4. ✅ Verify status changes to "paused"
5. ✅ Verify "Resume" button appears
6. ✅ Click "Resume" and confirm
7. ✅ Verify status changes back to "active"
8. ✅ Click "Cancel" and confirm
9. ✅ Verify status changes to "cancelled"
10. ✅ Verify pending jobs are cancelled

**Test Job Filtering:**
1. ✅ Use status dropdown to filter jobs
2. ✅ Verify table updates with filtered results
3. ✅ Verify "No jobs match filter" message when empty

### 3. Campaign List (on campaign.html)

1. ✅ Create multiple campaigns
2. ✅ Verify campaigns appear in list
3. ✅ Verify status badges are correct
4. ✅ Verify progress bars reflect completion
5. ✅ Click "View" to navigate to detail

---

## Integration Tests

### 1. Full Campaign Flow

```
1. Create brand with templates
2. Navigate to campaign page
3. Configure: 7 videos, 3 platforms, 3 posts/day
4. Create campaign
5. Verify 7 jobs created with correct:
   - scheduled_post_at times
   - vibe_preset values (weighted random)
   - platform arrays
6. Pause campaign
7. Verify worker respects pause (no new jobs picked up)
8. Resume campaign
9. Let worker execute some jobs
10. Cancel remaining
11. Verify final state
```

### 2. Preset Weight Distribution

```sql
-- After creating a campaign with 30 videos
-- Check preset distribution
SELECT vibe_preset, COUNT(*) as count, 
       ROUND(COUNT(*)::numeric / 30 * 100, 1) as percentage
FROM jobs
WHERE batch_id = '<CAMPAIGN_ID>'
GROUP BY vibe_preset;

-- Should roughly match brand_templates weights
-- e.g., urban_legend ~60%, one_too_many ~40%
```

### 3. Schedule Spacing

```sql
-- Verify jitter is applied (times not exactly on the hour)
SELECT scheduled_post_at,
       EXTRACT(MINUTE FROM scheduled_post_at) as minutes
FROM jobs
WHERE batch_id = '<CAMPAIGN_ID>'
ORDER BY scheduled_post_at;

-- Minutes should vary (not all 00)
```

---

## Cleanup

```sql
-- Delete test campaigns and jobs
DELETE FROM jobs WHERE batch_id IN (
    SELECT id FROM generation_batches WHERE config->>'test' = 'true'
);
DELETE FROM generation_batches WHERE config->>'test' = 'true';
```

---

## Expected Results Summary

| Test | Expected |
|------|----------|
| create_campaign RPC | Returns campaign ID, creates N jobs |
| update_campaign_status RPC | Updates status, optionally cancels jobs |
| get_campaign_summary RPC | Returns campaign with job counts |
| Campaign UI - Auto Mode | Creates campaign with defaults |
| Campaign UI - Advanced Mode | Creates campaign with custom settings |
| Pause/Resume | Status toggles, jobs respect pause |
| Cancel | Status = cancelled, pending jobs cancelled |
| Preset distribution | Matches brand_templates weights ±15% |

---

## V1 Validation Checklist

> **Use this structured checklist to verify Campaign System V1 correctness before marking READY.**

### ☑️ Atomicity Test
**Goal:** `create_campaign` RPC must be all-or-nothing.

```sql
-- Inject a bad job to force failure
SELECT create_campaign(
    p_brand_id := '<BRAND_ID>',
    p_video_count := 2,
    p_platforms := ARRAY['tiktok'],
    p_config := '{}'::jsonb,
    p_jobs := '[
        {"scheduled_post_at": "2025-02-15T13:00:00Z", "vibe_preset": "urban_legend"},
        {"scheduled_post_at": "INVALID_DATE", "vibe_preset": "urban_legend"}
    ]'::jsonb
);
-- Should fail

-- Verify NO partial campaign was created
SELECT COUNT(*) FROM generation_batches WHERE brand_id = '<BRAND_ID>' AND created_at > NOW() - interval '1 minute';
-- Expected: 0
```

**Pass criteria:** If ANY job insert fails, entire transaction rolls back. No orphan campaigns.

---

### ☑️ Pause Test
**Goal:** Paused campaigns should NOT have jobs picked up by worker.

1. Create campaign with 5 jobs
2. Immediately pause it
3. Verify jobs stay in `pending` (not `processing`)
4. Worker claim query should exclude paused campaigns

```sql
-- Verify pause blocks worker claim (example query)
SELECT j.* FROM jobs j
JOIN generation_batches b ON j.batch_id = b.id
WHERE j.status = 'pending'
  AND b.status = 'active'  -- Worker should only see active campaigns
  AND j.scheduled_post_at <= NOW();
-- Paused campaign jobs should NOT appear
```

**Pass criteria:** Jobs from paused campaign never appear in worker claim results.

---

### ☑️ Cancel Test
**Goal:** Cancelling a campaign cancels all pending jobs.

```sql
-- Cancel with p_cancel_pending_jobs := true
SELECT update_campaign_status('<CAMPAIGN_ID>', 'cancelled', true);

-- Verify
SELECT status, COUNT(*) FROM jobs WHERE batch_id = '<CAMPAIGN_ID>' GROUP BY status;
-- Expected: pending → 0, cancelled → N (or original pending count)
```

**Pass criteria:** All `pending` jobs become `cancelled`. Already-completed jobs remain `completed`.

---

### ☑️ Preset Immutability Test
**Goal:** Changing preset weights AFTER campaign creation should NOT affect existing jobs.

1. Create campaign with 10 jobs (weights: urban_legend=60%, one_too_many=40%)
2. Note the `vibe_preset` distribution
3. Change weights in `brand_templates` (e.g., urban_legend=20%, one_too_many=80%)
4. Verify existing jobs still have original presets

```sql
-- Check job presets haven't changed
SELECT vibe_preset, COUNT(*) FROM jobs WHERE batch_id = '<CAMPAIGN_ID>' GROUP BY vibe_preset;
-- Should match original distribution, NOT new weights
```

**Pass criteria:** Existing jobs are snapshot at creation time. Preset changes only affect NEW campaigns.

---

### ☑️ DB-Driven Weights Test
**Goal:** Preset weights should be read from `brand_templates`, with fallback.

1. Query `brand_templates` for brand
2. Create campaign
3. Verify distribution matches DB weights (±15% tolerance for randomness)

```sql
-- Get expected weights
SELECT preset_key, weight FROM brand_templates WHERE brand_id = '<BRAND_ID>';

-- Compare to actual distribution in created campaign
SELECT vibe_preset, COUNT(*)::float / (SELECT COUNT(*) FROM jobs WHERE batch_id = '<CAMPAIGN_ID>') * 100 as pct
FROM jobs WHERE batch_id = '<CAMPAIGN_ID>'
GROUP BY vibe_preset;
```

**Pass criteria:** Distribution matches `brand_templates` weights within ±15%.

**Fallback test:** Delete `brand_templates` rows → fallback should be `{ urban_legend: 0.6, one_too_many: 0.4 }`.

---

### ☑️ Timezone Test
**Goal:** `scheduled_post_at` should be stored in UTC.

1. Create campaign with start date "2025-02-15" from UI
2. Check jobs in DB

```sql
SELECT scheduled_post_at, scheduled_post_at AT TIME ZONE 'UTC' as utc_time
FROM jobs WHERE batch_id = '<CAMPAIGN_ID>'
ORDER BY scheduled_post_at;
```

**Pass criteria:** All timestamps stored as UTC. UI displays in user's local timezone.

---

### ☑️ Weight Normalization Test
**Goal:** UI sliders must normalize to 100% total.

1. Open Advanced mode
2. Set urban_legend = 80, one_too_many = 80 (160 total)
3. Verify UI shows normalized: urban_legend = 50%, one_too_many = 50%
4. Or: Verify error message if normalization not automatic

**Pass criteria:** Weights always sum to 100% before submission. No invalid state sent to RPC.

---

### ☑️ `generate_by` Handling Test
**Goal:** Jobs should have correct `generate_by` timestamp for worker scheduling.

```sql
-- Check generate_by column
SELECT id, scheduled_post_at, generate_by 
FROM jobs WHERE batch_id = '<CAMPAIGN_ID>'
LIMIT 5;
```

**Expected behavior options (verify which is implemented):**
- A) `generate_by = scheduled_post_at - interval '30 minutes'` (pre-generate buffer)
- B) `generate_by = NULL` (worker generates on-demand)
- C) `generate_by = created_at` (generate immediately)

**Pass criteria:** Documented behavior matches actual implementation.

---

## Validation Summary Table

| Test | Status | Notes |
|------|--------|-------|
| Atomicity | ⬜ | Transaction rollback on error |
| Pause | ⬜ | Worker respects campaign status |
| Cancel | ⬜ | Pending jobs → cancelled |
| Preset Immutability | ⬜ | Jobs snapshot preset at creation |
| DB-Driven Weights | ⬜ | Reads brand_templates, has fallback |
| Timezone | ⬜ | UTC storage, local display |
| Weight Normalization | ⬜ | UI enforces 100% sum |
| generate_by | ⬜ | Documented and implemented |

> **Legend:** ⬜ Not tested, ✅ Passed, ❌ Failed

---

## Job Scheduler Smoke Tests

> **Reference:** [JOB_SCHEDULER.md](JOB_SCHEDULER.md)

### Prerequisites

1. Run migration: `20260211_job_scheduler.sql`
2. Deploy scheduler: `npx supabase functions deploy schedule-jobs`
3. Have a campaign with at least 3 jobs

### 1. Verify Schema Updates

```sql
-- Check jobs has generate_by column
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'jobs' 
AND column_name = 'generate_by';

-- Check job status constraint includes new values
SELECT 
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'jobs'::regclass
AND conname = 'jobs_status_check';
-- Should include: 'pending', 'cancelled'
```

### 2. Test find_eligible_jobs RPC

```sql
-- First, create a test job that's due
UPDATE jobs 
SET generate_by = NOW() - interval '1 minute'
WHERE id = '<JOB_ID>' AND status = 'pending';

-- Query eligible jobs
SELECT * FROM find_eligible_jobs(24, 5);
-- Should return the updated job

-- Verify paused campaign is excluded
UPDATE generation_batches SET status = 'paused' WHERE id = '<CAMPAIGN_ID>';
SELECT * FROM find_eligible_jobs(24, 5);
-- Job from paused campaign should NOT appear
```

### 3. Test claim_job_for_scheduler RPC

```sql
-- Claim a job
SELECT claim_job_for_scheduler('<JOB_ID>', 'test-run-123');
-- Should return TRUE

-- Verify job status changed
SELECT status, meta->>'scheduler_run_id' as run_id
FROM jobs WHERE id = '<JOB_ID>';
-- Status should be 'generating', run_id should be 'test-run-123'

-- Try to claim same job again
SELECT claim_job_for_scheduler('<JOB_ID>', 'test-run-456');
-- Should return FALSE (already claimed)
```

### 4. Test Scheduler Edge Function

**Manual invocation:**
```bash
curl -X POST '<SUPABASE_URL>/functions/v1/schedule-jobs' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**Expected response:**
```json
{
  "success": true,
  "jobs_found": 1,
  "jobs_claimed": 1,
  "jobs_triggered": 1,
  "errors": [],
  "details": [{"job_id": "...", "claimed": true, "triggered": true}]
}
```

### 5. Test Dry Run Mode

```bash
curl -X POST '<SUPABASE_URL>/functions/v1/schedule-jobs' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"dry_run": true}'
```

Should return what WOULD be done without actually claiming/triggering.

### 6. Test Pause Gating

1. Create campaign with jobs
2. Set one job's `generate_by` to past
3. Pause the campaign: `UPDATE generation_batches SET status='paused' WHERE id='...'`
4. Run scheduler
5. **Verify:** Job NOT claimed (still `pending`)
6. Resume campaign
7. Run scheduler again
8. **Verify:** Job claimed and triggered

### 7. Test Double-Trigger Prevention

```bash
# Run two scheduler calls in parallel
curl -X POST '<URL>/functions/v1/schedule-jobs' &
curl -X POST '<URL>/functions/v1/schedule-jobs' &
wait
```

**Verify:** Only ONE scheduler actually claims the job (check `scheduler_run_id` in job meta).

### 8. End-to-End Scheduler Test

1. Create campaign with `lead_time_hours=24`, start date = tomorrow
2. Note: jobs will have `generate_by` = TODAY
3. Wait for generate_by to pass (or manually set to past)
4. Run scheduler: `curl -X POST .../schedule-jobs`
5. **Verify:** Job status changes from `pending` → `generating`
6. **Verify:** run-job starts executing (check logs)
7. **Verify:** Job eventually reaches `complete`

---

## Scheduler Validation Checklist

| Test | Status | Notes |
|------|--------|-------|
| generate_by column exists | ⬜ | Column on jobs table |
| find_eligible_jobs RPC works | ⬜ | Returns due jobs, excludes paused |
| claim_job_for_scheduler atomic | ⬜ | Cannot double-claim |
| Scheduler function deploys | ⬜ | No errors on deploy |
| Scheduler finds eligible jobs | ⬜ | Manual invocation |
| Scheduler triggers run-job | ⬜ | Job starts processing |
| Pause gating works | ⬜ | Paused campaign = no trigger |
| Cancel gating works | ⬜ | Cancelled campaign = no trigger |
| Double-trigger prevented | ⬜ | Parallel calls claim once |
| Failure recovery | ⬜ | Failed trigger reverts to pending |

> **Legend:** ⬜ Not tested, ✅ Passed, ❌ Failed

---

## Verification Results (February 8, 2026)

This section documents the code review and validation performed on the Campaign System V1 implementation.

### Status Canonicalization ✅

**Issue Discovered:** The scheduler Edge Function's fallback queries used `status = 'queued'` while campaign creation uses `status = 'pending'`.

**Resolution:**
- Updated `schedule-jobs/index.ts` to use `status IN ('pending', 'queued')` everywhere
- `pending` = canonical status for campaign-created jobs (waiting for generate_by)
- `queued` = legacy status for direct job creation (backwards compatibility)
- `revertClaim()` now reverts to `pending` (not `queued`)
- All SQL RPCs already handled both statuses correctly

**Files Changed:**
- `supabase/functions/schedule-jobs/index.ts`

### generate_by Source of Truth ✅

**Verified:**
- `create_campaign` RPC sets `jobs.generate_by` **column** (not meta) correctly:
  ```sql
  v_generate_by := v_scheduled_at - (v_lead_time_hours || ' hours')::interval;
  INSERT INTO jobs (..., generate_by, ...) VALUES (..., v_generate_by, ...);
  ```
- `find_eligible_jobs` RPC uses column with COALESCE fallback:
  ```sql
  COALESCE(j.generate_by, j.scheduled_post_at - v_lead_interval) <= v_now
  ```
- Edge Function fallback also updated to check `job.generate_by` column first

**Conclusion:** Column is authoritative; meta.generate_by is optional/audit only.

### Scheduler Gating & Locking ✅

**Campaign Status Gating:**
```sql
AND (
    j.batch_id IS NULL 
    OR gb.status NOT IN ('paused', 'cancelled')
)
```
Jobs from paused/cancelled campaigns are excluded at SQL level.

**Atomic Claim:**
```sql
UPDATE jobs SET status = 'generating' ...
WHERE id = p_job_id AND status IN ('pending', 'queued')
RETURNING true INTO v_claimed;
```
Uses single UPDATE with WHERE clause - if two scheduler instances run simultaneously, only one can claim.

**Logging:** Scheduler logs clearly report:
- `[SCHEDULER] Found N eligible jobs via RPC`
- `[SCHEDULER] Claiming job X (run_id: Y)`
- `[SCHEDULER] run-job triggered successfully for X`

### UI Consistency ✅

**Brand Switcher on Campaign Pages:**
- [campaign.html#L137](../pages/campaign.html#L137) - `<div id="brand-switcher"></div>`
- [campaign-detail.html#L137](../pages/campaign-detail.html#L137) - `<div id="brand-switcher"></div>`
- JS initialization in both `campaign.js` and `campaign-detail.js`

**Campaigns Nav Button Global:**
| Page | Has Campaign Link |
|------|-------------------|
| index.html | ✅ line 57 |
| calendar.html | ✅ line 50 |
| brands.html | ✅ line 88 |
| connections.html | ✅ line 50 |
| create.html | ✅ line 55 |
| settings.html | ✅ line 207 |
| posts.html | ✅ line 51 |
| campaign.html | ✅ (active) |
| campaign-detail.html | ✅ (active) |

### Double-Run Prevention ✅

**Design:**
1. Scheduler uses `UPDATE ... WHERE status IN ('pending', 'queued') RETURNING`
2. Only one instance can claim (others get empty result)
3. `scheduler_run_id` stored in job meta for audit

**Test Command:**
```bash
# Run two in parallel - only one should claim
curl -X POST '<URL>/functions/v1/schedule-jobs' &
curl -X POST '<URL>/functions/v1/schedule-jobs' &
wait
# Check job meta: only one scheduler_run_id
```

### Summary

| Check | Result |
|-------|--------|
| Status canonicalization (pending/queued) | ✅ Fixed & verified |
| generate_by column is authoritative | ✅ Verified |
| Scheduler excludes paused/cancelled | ✅ SQL gating |
| Atomic claim prevents double-trigger | ✅ UPDATE RETURNING pattern |
| Brand dropdown on campaign pages | ✅ Both HTML & JS |
| Campaigns nav button global | ✅ All 9 admin pages |

---

## Version History
- v1.3 (2026-02-08): Added Verification Results from code review
- v1.2 (2025-02-10): Added Job Scheduler smoke tests
- v1.1 (2025-02-10): Added structured V1 Validation Checklist
- v1.0 (2025-02-10): Initial smoke tests for Campaign System V1
