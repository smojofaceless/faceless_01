# Job Scheduler

> **Document Version:** 2.0  
> **Last Updated:** February 8, 2026  
> **Author:** System Architect  
> **Status:** ✅ Implemented (with Job Claim + Lease System)

---

## Overview

The **Job Scheduler** is a cron-style Edge Function that automatically triggers video generation for campaign jobs when their `generate_by` time is reached. It bridges the gap between campaign planning (which creates jobs with scheduled times) and worker execution (which generates videos).

### V2.0: Job Claim + Lease System

The scheduler now uses a **lease-based locking system** to prevent jobs from getting stuck in `generating` forever:

- **Lease Duration**: 15 minutes (configurable)
- **Heartbeat Extension**: Workers extend their lease during processing
- **Stale Detection**: Jobs with expired leases are automatically marked as failed
- **No Double-Processing**: Atomic claims prevent multiple workers from processing the same job

```
┌─────────────────────────────────────────────────────────────────┐
│                    CAMPAIGN → SCHEDULER → WORKER FLOW           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Campaign Creation (Instant)                                   │
│   ┌──────────────────────────────────────────────────────┐     │
│   │  User creates campaign with:                          │     │
│   │  - 10 videos                                          │     │
│   │  - Start date: Feb 15                                 │     │
│   │  - Lead time: 24 hours                                │     │
│   └──────────────────────────────────────────────────────┘     │
│                            │                                    │
│                            ▼                                    │
│   ┌──────────────────────────────────────────────────────┐     │
│   │  Jobs created in DB (status = 'pending')              │     │
│   │  Job 1: scheduled_post_at = Feb 15 12:00              │     │
│   │         generate_by = Feb 14 12:00                    │     │
│   │  Job 2: scheduled_post_at = Feb 15 18:00              │     │
│   │         generate_by = Feb 14 18:00                    │     │
│   │  ...                                                  │     │
│   └──────────────────────────────────────────────────────┘     │
│                            │                                    │
│                            │ (Time passes...)                   │
│                            ▼                                    │
│   Scheduler (runs every 15 min)                                 │
│   ┌──────────────────────────────────────────────────────┐     │
│   │  1. Query: find_eligible_jobs() (respects lease)      │     │
│   │  2. Claim: claim_job() - atomic lock + lease          │     │
│   │  3. Trigger: POST /run-job { job_id: X }              │     │
│   │  4. On fail: release_job() - revert to pending        │     │
│   └──────────────────────────────────────────────────────┘     │
│                            │                                    │
│                            ▼                                    │
│   Worker (run-job Edge Function)                                │
│   ┌──────────────────────────────────────────────────────┐     │
│   │  1. Verify: tryClaimOrVerify() - take over lease      │     │
│   │  2. Process: audio → images → assemble phases         │     │
│   │  3. Heartbeat: extend lease between phases            │     │
│   │  4. Complete: releaseJob('complete')                  │     │
│   └──────────────────────────────────────────────────────┘     │
│                                                                 │
│   Stale Sweeper (periodic)                                      │
│   ┌──────────────────────────────────────────────────────┐     │
│   │  sweep_stale_jobs() - expired leases → failed         │     │
│   └──────────────────────────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

### `generate_by` - The Scheduling Timestamp

Every campaign job has a `generate_by` **column** that determines when generation should start:

```
generate_by = scheduled_post_at - generation_lead_time_hours
```

> **Source of Truth:** The `jobs.generate_by` column is authoritative. The scheduler reads
> this column directly. Legacy jobs without a column value fall back to computing it from
> `scheduled_post_at - lead_time`. Any `meta.generate_by` is for audit purposes only.

| Example | Lead Time | Post At | Generate By |
|---------|-----------|---------|-------------|
| Default (24h) | 24 hours | Feb 15 12:00 | Feb 14 12:00 |
| Fast (1h) | 1 hour | Feb 15 12:00 | Feb 15 11:00 |
| Relaxed (48h) | 48 hours | Feb 15 12:00 | Feb 13 12:00 |

**Why lead time matters:**
- Video generation takes 2-10 minutes per video
- If 100 jobs are due at once, they need time to queue
- Lead time ensures videos are ready before posting

### Job Status Flow

```
┌──────────┐    Scheduler    ┌────────────┐    Worker    ┌──────────┐
│  pending │───────────────▶│ generating │────────────▶│ complete │
└──────────┘                 └────────────┘              └──────────┘
     │                            │                           │
     │                            │                           │
     │                            ▼                           │
     │                       ┌────────┐                       │
     │                       │ failed │◀──────────────────────┘
     │                       └────────┘      (on error)
     │
     ▼
┌───────────┐
│ cancelled │  (campaign cancelled)
└───────────┘
```

| Status | Meaning | Who Sets It |
|--------|---------|-------------|
| `pending` | **Canonical not-started** - Waiting for generate_by time | Campaign creation |
| `queued` | Legacy: ready to run (direct creation) | Manual/legacy flows |
| `generating` | Claimed by scheduler, worker processing | Scheduler |
| `assembling` | Video being assembled | Worker |
| `rendering` | FFmpeg render in progress | Worker |
| `complete` | Done successfully | Worker |
| `failed` | Terminal failure | Worker |
| `cancelled` | Campaign cancelled | Campaign cancellation |

> **Note:** Both `pending` and `queued` mean "not started". The scheduler treats them identically.
> - New campaign jobs use `pending` (has generate_by set)
> - Legacy direct jobs may use `queued`
> - On failure recovery, jobs revert to `pending`

---

## Invariants

### 1. Atomic Claim with Lease (No Double-Trigger)

The scheduler uses the `claim_job` RPC for atomic claiming with lease:

```sql
-- claim_job(p_job_id, p_locked_by, p_lease_seconds)
-- Returns: claimed (boolean), message (text), already_locked_by (text)
SELECT * FROM claim_job(
    '<JOB_ID>',           -- Job to claim
    'scheduler-abc123',   -- Worker ID
    900                   -- Lease duration (15 minutes)
);
```

**Claim Logic:**
1. Acquire `FOR UPDATE` row lock
2. Check status is `pending` or `queued`
3. Check lease is not held by another worker (or expired)
4. Check campaign is not paused/cancelled
5. If all pass: Set `locked_at`, `locked_by`, `lease_expires_at`, `status='generating'`
6. Return result

If two scheduler instances run simultaneously:
- First one acquires row lock, sets lease
- Second one waits for lock, then sees lease already held → claim fails
- Only one worker processes the job

### 2. Lease Extension (Heartbeat)

Workers must extend their lease during long processing:

```sql
-- heartbeatJob(job_id, worker_id, lease_seconds, progress, status)
SELECT * FROM heartbeat_job(
    '<JOB_ID>',
    'worker-xyz789',
    900,                  -- Extend by 15 minutes
    50,                   -- Progress percentage
    'generating'          -- Optional status update
);
```

**Best Practice:** Call heartbeat before each phase (audio, images, assemble).

### 3. Campaign Status Gating

Jobs from paused/cancelled campaigns are never scheduled:

```sql
WHERE (
    job.batch_id IS NULL  -- No campaign (legacy job)
    OR campaign.status NOT IN ('paused', 'cancelled')
)
```

### 3. Stampede Prevention

Maximum jobs per scheduler run: **3** (configurable)

This prevents:
- API rate limiting issues
- Worker overload
- Long scheduler execution times

### 4. Failure Recovery

If `run-job` fails to start:
1. Scheduler catches the error
2. Job status reverted to `pending` (or `queued`)
3. Error stored in `job.meta.scheduler_error`
4. Job will be retried on next scheduler run

---

## Configuration

### Edge Function Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `DEFAULT_LEAD_TIME_HOURS` | 24 | Fallback if job has no `generate_by` |
| `MAX_JOBS_PER_RUN` | 3 | Maximum jobs to claim per scheduler invocation |
| `RUN_JOB_TIMEOUT_MS` | 30000 | Timeout for run-job HTTP call |

### Campaign Configuration

When creating a campaign, set lead time in config:

```javascript
{
  generation_lead_time_hours: 24,  // Default
  // ... other config
}
```

---

## API Reference

### `schedule-jobs` Edge Function

**Endpoint:** `POST /functions/v1/schedule-jobs`

**Request Body (optional):**
```json
{
  "lead_time_hours": 24,  // Override default lead time
  "dry_run": false        // If true, only report what would be done
}
```

**Response:**
```json
{
  "success": true,
  "jobs_found": 3,
  "jobs_claimed": 3,
  "jobs_triggered": 3,
  "errors": [],
  "details": [
    {
      "job_id": "uuid-1",
      "claimed": true,
      "triggered": true
    }
  ],
  "scheduler_run_id": "uuid-run",
  "duration_ms": 1234
}
```

### `find_eligible_jobs` RPC

**Signature:**
```sql
find_eligible_jobs(
    p_lead_time_hours INTEGER DEFAULT 24,
    p_max_jobs INTEGER DEFAULT 5
) RETURNS TABLE (...)
```

**Returns:** Jobs eligible for scheduling based on `generate_by` and campaign status.

### `claim_job_for_scheduler` RPC

**Signature:**
```sql
claim_job_for_scheduler(
    p_job_id UUID,
    p_scheduler_run_id TEXT
) RETURNS BOOLEAN
```

**Returns:** `true` if claim succeeded, `false` if job already claimed.

---

## Cron Setup

### Local Development

Run manually:
```bash
curl -X POST http://localhost:54321/functions/v1/schedule-jobs \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json"
```

### Production (Supabase Dashboard)

1. Go to Database → Extensions → pg_cron
2. Add schedule:
```sql
SELECT cron.schedule(
  'schedule-jobs',
  '*/15 * * * *',  -- Every 15 minutes
  $$
  SELECT net.http_post(
    url := '<SUPABASE_URL>/functions/v1/schedule-jobs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

### Alternative: External Cron

Use any cron service (GitHub Actions, Vercel Cron, etc.) to POST to the endpoint.

---

## Testing

### Manual Test: Force Eligible Job

1. Create a campaign normally
2. Directly update a job's `generate_by` to past:
   ```sql
   UPDATE jobs 
   SET generate_by = NOW() - interval '1 minute'
   WHERE id = '<JOB_ID>';
   ```
3. Run scheduler:
   ```bash
   curl -X POST <URL>/functions/v1/schedule-jobs
   ```
4. Verify job status changed to `generating`

### Dry Run Test

```bash
curl -X POST <URL>/functions/v1/schedule-jobs \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```

### Pause Gating Test

1. Create campaign
2. Pause campaign: `UPDATE generation_batches SET status='paused' WHERE id='...'`
3. Set job's `generate_by` to past
4. Run scheduler
5. Verify job NOT claimed (still `pending`)

### Double-Trigger Test

1. Set job's `generate_by` to past
2. Run scheduler twice quickly (parallel curl calls)
3. Verify job claimed exactly once

---

## Troubleshooting

### Job Not Being Picked Up

Check:
1. `status = 'pending'` or `'queued'`?
2. `scheduled_post_at IS NOT NULL`?
3. `generate_by <= NOW()`?
4. `brand_id IS NOT NULL`?
5. Campaign `status NOT IN ('paused', 'cancelled')`?

Query to debug:
```sql
SELECT 
  j.id, 
  j.status, 
  j.scheduled_post_at,
  j.generate_by,
  j.generate_by <= NOW() as is_due,
  gb.status as campaign_status
FROM jobs j
LEFT JOIN generation_batches gb ON j.batch_id = gb.id
WHERE j.status IN ('pending', 'queued')
  AND j.scheduled_post_at IS NOT NULL
ORDER BY j.generate_by;
```

### Scheduler Running but No Jobs Triggered

1. Check `MAX_JOBS_PER_RUN` limit
2. Check `DEFAULT_LEAD_TIME_HOURS` is reasonable
3. Check Edge Function logs for errors

### Job Stuck in `generating`

**V2.0 Solution:** The lease system automatically handles stuck jobs:

1. **Automatic Detection:** Jobs with expired leases are detected by `sweep_stale_jobs()`
2. **Automatic Failure:** Stale jobs are marked as `failed` (not auto-requeued)
3. **Manual Check:** Query to see stuck jobs:

```sql
-- Check for stuck jobs (lease expired)
SELECT 
  id, 
  status,
  locked_by,
  locked_at,
  lease_expires_at,
  lease_expires_at < NOW() as lease_expired,
  attempt_count
FROM jobs
WHERE status IN ('generating', 'assembling', 'rendering')
  AND lease_expires_at < NOW();

-- Run sweeper manually
SELECT * FROM sweep_stale_jobs(
    p_stale_threshold_minutes := 30,  -- Override default
    p_dry_run := true                 -- Preview what would be marked
);
```

**Manual Reset (if needed):**
```sql
-- Reset a stuck job (use sparingly)
UPDATE jobs SET 
    status = 'pending',
    locked_at = NULL,
    locked_by = NULL,
    lease_expires_at = NULL,
    attempt_count = attempt_count + 1
WHERE id = '<JOB_ID>';
```

---

## Lease System Reference

### New Columns on `jobs` Table

| Column | Type | Description |
|--------|------|-------------|
| `locked_at` | timestamptz | When the lock was acquired |
| `locked_by` | text | Worker ID holding the lock |
| `lease_expires_at` | timestamptz | When the lease expires (auto-fail if not extended) |
| `attempt_count` | integer | Number of processing attempts (incremented on stale fail) |

### New RPCs

| RPC | Purpose | Returns |
|-----|---------|---------|
| `claim_job(job_id, locked_by, lease_seconds)` | Atomic claim with lease | `{claimed, message, already_locked_by}` |
| `heartbeat_job(job_id, locked_by, lease_seconds, progress, status)` | Extend lease, update progress | `{success, message}` |
| `release_job(job_id, locked_by, final_status, error_message, final_progress)` | Clear lock, set final status | `{success, message}` |
| `sweep_stale_jobs(stale_threshold_minutes, dry_run)` | Find and fail stale jobs | Array of stale job records |

### Updated `find_eligible_jobs`

Now respects lease:
```sql
AND (
    j.locked_at IS NULL 
    OR j.lease_expires_at IS NULL 
    OR j.lease_expires_at < NOW()  -- Expired lease = claimable
)
```

---

## Files Changed

| File | Purpose |
|------|---------|
| `supabase/functions/schedule-jobs/index.ts` | Main scheduler Edge Function (v2.0 - uses claim/release RPCs) |
| `supabase/functions/run-job/index.ts` | Worker function (v78.0 - integrated lease system) |
| `supabase/functions/run-job/lease.ts` | Lease management helper module |
| `supabase/migrations/20260211_job_scheduler.sql` | Original scheduler RPCs |
| `supabase/migrations/20260219_job_claim_lease_system.sql` | Lease columns, claim/heartbeat/release/sweep RPCs |
| `js/services/campaignManager.js` | Already had `generate_by` computation |
| `docs/JOB_SCHEDULER.md` | This documentation |

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| Feb 19, 2026 | 2.0 | Job Claim + Lease System: atomic claims, heartbeat, stale sweeper |
| Feb 10, 2026 | 1.0 | Initial implementation |
