# Failure Cluster Protection + Dead Letter Queue (DLQ)

> **Version:** 1.2  
> **Implemented:** February 22, 2026  
> **Updated:** February 19, 2026  
> **Status:** ✅ Production Ready

---

## Overview

This system protects the video generation pipeline from cascading failures when external dependencies (OpenAI, ElevenLabs, FFmpeg renderer, storage) experience outages. It provides:

1. **Error Classification** - Categorize failures for appropriate handling
2. **Failure Cluster Detection** - Identify dependency outages automatically
3. **Auto-Pause Campaigns** - Stop burning money on doomed jobs
4. **Global Kill Switch** - Emergency stop for all processing
5. **DLQ View** - Visibility into failed jobs with actionable data
6. **Bulk Requeue** - One-click recovery when services restore
7. **Retry Policies** - Exponential backoff to avoid hammering failing services
8. **External Alert Webhooks** - Discord/Slack/generic notifications on failures
9. **Dead Post Sweeper** - `sweep_dead_posts()` catches stuck posts (≥3 attempts)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SCHEDULE-JOBS (v2.1)                        │
│  ┌─────────────────┐    ┌─────────────────────────────────────┐    │
│  │  Kill Switch    │───▶│  If active: abort with 503          │    │
│  │  Check          │    └─────────────────────────────────────┘    │
│  └─────────────────┘                                                │
│  ┌─────────────────┐    ┌─────────────────────────────────────┐    │
│  │  Auto-Pause     │───▶│  Pause campaigns with 5+ failures   │    │
│  │  Check          │    │  in 10 min window                   │    │
│  └─────────────────┘    └─────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          WORKER-V1 (v2.2)                           │
│  ┌─────────────────┐    ┌─────────────────────────────────────┐    │
│  │  Kill Switch    │───▶│  If active: exit early              │    │
│  │  Check          │    └─────────────────────────────────────┘    │
│  └─────────────────┘                                                │
│  ┌─────────────────┐    ┌─────────────────────────────────────┐    │
│  │  On Error       │───▶│  classifyError() → update_job_failure│    │
│  │                 │    │  Records: class, signature, step     │    │
│  └─────────────────┘    └─────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          DATABASE LAYER                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐   │
│  │  system_config  │  │  jobs.meta.     │  │  v_failed_jobs   │   │
│  │  (kill_switch)  │  │  last_failure   │  │  _dlq (view)     │   │
│  └─────────────────┘  └─────────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Error Classification

### Failure Classes

| Class | Description | Retry? | Action |
|-------|-------------|--------|--------|
| `dependency` | External service down (OpenAI, ElevenLabs, FFmpeg, storage) - 5xx from known services | ✅ Yes | Auto-pause campaign, wait for recovery |
| `transient` | Network hiccups, 429 rate limits, timeouts where vendor is unclear | ✅ Yes | Auto-retry with backoff |
| `misconfig` | Configuration errors (bad API key, missing secrets, **cost limit exceeded**) | ❌ No | Operator must fix |
| `permanent` | Unrecoverable (invalid input, 4xx client errors) | ❌ No | Manual review required |

> **Note:** Cost limit failures (budget exceeded, max calls per job reached) are classified as `misconfig` because they require operator action (adjust limits in `cost_limits` table). They are NOT auto-retried. See [COST_CONTROLS.md](COST_CONTROLS.md) for details.

### Classification Logic

Located in `worker-v1/classifyError.ts`:

**Order matters - first match wins:**

```typescript
// 1. DEPENDENCY - Check FIRST for known services (triggers auto-pause)
//    5xx from OpenAI/ElevenLabs/FFmpeg/storage
//    Steps: images, voice, assemble, upload with 5xx
const isKnownService = /openai|elevenlabs|ffmpeg|renderer|creatomate|supabase.*storage/i;
const isServiceStep = ['images', 'voice', 'assemble', 'upload'].includes(step);
if (statusCode >= 500 && (isKnownService || isServiceStep)) → 'dependency'

// 2. TRANSIENT - Network/rate issues (simple retry)
//    429 rate limit, generic 502/503/504, timeouts, ECONNRESET
if (statusCode === 429) → 'transient'
if (statusCode in [502, 503, 504] && !knownService) → 'transient'
/ETIMEDOUT|ECONNRESET|timeout/ → 'transient'

// 3. MISCONFIG - Operator fix needed
//    401/403, invalid API key, missing env vars
if (statusCode in [401, 403]) → 'misconfig'
/api.?key|credentials|unauthorized/ → 'misconfig'

// 4. PERMANENT - No retry
//    400, content policy, validation failures
if (statusCode === 400) → 'permanent'
/content.*policy|invalid.*request/ → 'permanent'
```

**Key Rule:** 5xx from external services → `dependency` (clusters auto-pause campaigns)  
            5xx from unknown sources → `transient` (simple backoff retry)

### Error Signature

Each failure generates a signature for clustering:

```
{failure_class}:{step}:{service}
```

Examples:
- `dependency:images:openai` - OpenAI down during image generation
- `transient:voice:elevenlabs` - ElevenLabs rate limited
- `misconfig:story:api_key` - Invalid API key

---

## Failure Cluster Detection

### How It Works

The `get_failure_clusters` RPC scans failed jobs within a time window:

```sql
SELECT 
  failure_class,
  error_signature,
  step,
  COUNT(*) as job_count,
  ARRAY_AGG(DISTINCT batch_id) as campaign_ids
FROM jobs
WHERE 
  status = 'failed'
  AND meta ? 'last_failure'
  AND updated_at >= NOW() - interval '10 minutes'
GROUP BY failure_class, error_signature, step
HAVING COUNT(*) >= 5
```

### Thresholds

| Parameter | Default | Description |
|-----------|---------|-------------|
| `p_window_minutes` | 10 | Time window to scan |
| `p_min_count` | 5 | Minimum failures to form cluster |

### Response Format

```json
[
  {
    "failure_class": "dependency",
    "error_signature": "dependency:images:openai",
    "step": "images",
    "sample_error": "OpenAI API returned 503 Service Unavailable",
    "job_count": 12,
    "campaign_ids": ["uuid-1", "uuid-2"],
    "first_seen": "2026-02-22T10:15:00Z",
    "last_seen": "2026-02-22T10:23:00Z"
  }
]
```

---

## Auto-Pause Campaigns

### Trigger Conditions

Campaigns are auto-paused when:
1. 5+ jobs fail within 10 minutes
2. Failure class is `dependency` **ONLY** (service outages)
3. Campaign hasn't been paused in last 30 minutes (cooldown)

**Important:** `misconfig` and `permanent` failures do NOT trigger auto-pause because:
- `misconfig` needs operator intervention (fix the config, not wait)
- `permanent` will never succeed (bad data, content policy)
- Only `dependency` (service outages) benefit from pause-and-wait strategy

### RPC: `auto_pause_affected_campaigns`

```sql
-- Called by schedule-jobs on every run
SELECT * FROM auto_pause_affected_campaigns(
  p_window_minutes := 10,
  p_min_failures := 5,
  p_cooldown_minutes := 30
);
```

### Result

```json
[
  {
    "campaign_id": "uuid-1",
    "campaign_name": "Horror Daily",
    "failure_class": "dependency",
    "failure_count": 8,
    "action": "paused",
    "reason": "Auto-paused: 8 dependency failures (dependency:images:openai)"
  }
]
```

### Database Changes

When paused, the campaign record is updated:
- `status` → `'paused'`
- `auto_paused_at` → `NOW()`
- `auto_pause_reason` → Detailed failure info

---

## Global Kill Switch

### Purpose

Emergency stop for ALL job processing when:
- Major outage affecting all services
- Billing runaway detected
- Manual intervention required

### Usage

```sql
-- Check if active (fast, cached)
SELECT is_kill_switch_active();  -- Returns: true/false

-- Activate
SELECT set_kill_switch(
  p_enabled := true,
  p_reason := 'OpenAI billing spike detected'
);

-- Deactivate
SELECT set_kill_switch(
  p_enabled := false,
  p_reason := 'Services restored'
);
```

### Behavior When Active

| Component | Behavior |
|-----------|----------|
| `schedule-jobs` | Returns 503, skips all job processing |
| `worker-v1` | Exits early with message |
| Dashboard | Should show banner (future UI) |

### Storage

Stored in `system_config` table:

```json
{
  "key": "kill_switch",
  "value": {
    "enabled": true,
    "reason": "OpenAI billing spike detected",
    "enabled_at": "2026-02-22T10:30:00Z"
  }
}
```

---

## DLQ View

### View: `v_failed_jobs_dlq`

Provides actionable visibility into failed jobs:

```sql
SELECT * FROM v_failed_jobs_dlq;
```

### Columns

| Column | Description |
|--------|-------------|
| `job_id` | Job UUID |
| `brand_id` | Associated brand |
| `campaign_id` | Associated campaign (batch_id) |
| `campaign_name` | Human-readable campaign name |
| `status` | Always 'failed' |
| `attempt_count` | Number of attempts |
| `failure_class` | transient/dependency/misconfig/permanent |
| `failure_step` | Which step failed |
| `failure_error` | Error message |
| `failure_signature` | Clustering key |
| `failed_at` | When job failed |
| `can_retry` | Boolean: eligible for requeue |
| `next_retry_at` | Suggested retry time (with backoff) |

### Example Query

```sql
-- Get all retryable dependency failures
SELECT * FROM v_failed_jobs_dlq
WHERE failure_class = 'dependency'
  AND can_retry = true
ORDER BY failed_at DESC;
```

---

## Bulk Requeue

### RPC: `requeue_failed_jobs`

Requeue multiple jobs with safety checks:

```sql
SELECT * FROM requeue_failed_jobs(
  p_job_ids := ARRAY['uuid-1', 'uuid-2', 'uuid-3']::uuid[],
  p_reset_attempts := false  -- Keep attempt history
);
```

### Safety Checks

1. **Max Attempts:** Jobs with 3+ attempts cannot be requeued (use `reset_attempts := true` to override)
2. **Permanent Failures:** Jobs with `failure_class = 'permanent'` are skipped
3. **Backoff Applied:** `generate_by` is set based on attempt count

### Backoff Schedule

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | +30 minutes |
| 3 | +2 hours |
| 4+ | +4 hours |

### Result

```json
[
  {"job_id": "uuid-1", "success": true, "message": "Requeued"},
  {"job_id": "uuid-2", "success": false, "message": "Max attempts (3) reached"},
  {"job_id": "uuid-3", "success": false, "message": "Permanent failure, not retryable"}
]
```

### Single Job Requeue

```sql
SELECT * FROM requeue_job(
  p_job_id := 'uuid-1'::uuid,
  p_force := false  -- Set true to override safety checks
);
```

---

## Integration Points

### Worker-V1 (v2.2)

```typescript
// At start
const { data: killSwitchActive } = await supabase.rpc('is_kill_switch_active');
if (killSwitchActive) {
  return { success: false, error: 'Kill switch active' };
}

// On error
import { classifyError, generateErrorSignature } from './classifyError.ts';

const classification = classifyError(error.message, statusCode);
const signature = generateErrorSignature(classification, currentStep, service);

await supabase.rpc('update_job_failure', {
  p_job_id: jobId,
  p_failure: {
    class: classification,
    signature: signature,
    step: currentStep,
    error: error.message,
    at: new Date().toISOString()
  }
});
```

### Schedule-Jobs (v2.1)

```typescript
// Kill switch check
const { data: killSwitchActive } = await supabase.rpc('is_kill_switch_active');
if (killSwitchActive) {
  return new Response(JSON.stringify({ 
    message: 'Kill switch active - scheduler skipped' 
  }), { status: 503 });
}

// Auto-pause check
const { data: pauseResults } = await supabase.rpc('auto_pause_affected_campaigns', {
  p_window_minutes: 10,
  p_min_failures: 5,
  p_cooldown_minutes: 30
});
```

---

## Database Objects

### Tables

| Table | Purpose |
|-------|---------|
| `system_config` | Key-value store for kill switch and settings |

### Views

| View | Purpose |
|------|---------|
| `v_failed_jobs_dlq` | Failed jobs with classification and retry info |

### RPCs

| RPC | Purpose |
|-----|---------|
| `update_job_failure` | Record structured failure in jobs.meta |
| `get_failure_clusters` | Detect failure patterns |
| `is_kill_switch_active` | Fast kill switch check |
| `set_kill_switch` | Toggle kill switch |
| `auto_pause_affected_campaigns` | Pause campaigns with cluster failures |
| `requeue_failed_jobs` | Bulk requeue with safety checks |
| `requeue_job` | Single job requeue |

### Indexes

```sql
-- Optimizes failure cluster queries
CREATE INDEX idx_jobs_failure_cluster 
ON jobs (updated_at DESC)
WHERE status = 'failed' AND meta ? 'last_failure';
```

### Columns Added

| Table | Column | Purpose |
|-------|--------|---------|
| `generation_batches` | `auto_paused_at` | When campaign was auto-paused |
| `generation_batches` | `auto_pause_reason` | Why it was paused |

---

## Migration

**File:** `20260222_failure_protection_dlq.sql`

Includes:
- `system_config` table creation
- All RPC definitions
- View definition
- Index creation
- Initial data seeding (kill_switch = off)

---

## Monitoring & Observability

### Logs to Watch

```
[SCHEDULER] ⛔ Kill switch is ACTIVE - aborting scheduler run
[SCHEDULER] 🛑 Auto-paused N campaigns due to failure clusters
[WORKER] ⚠️ Job failed: {class} - {signature}
```

### Metrics to Track (Future)

- Failure rate by class
- Time-to-recovery after auto-pause
- Kill switch activation frequency
- Requeue success rate

---

## Future Enhancements

1. **Dashboard UI** - Visual DLQ management page
2. **Alerting** - Email/Slack notifications for clusters
3. **Service Health** - Pre-flight checks before job start
4. ~~**Cost Tracking** - Estimate wasted spend during outages~~ → **Delivered** in Cost Controls (Item #6)
5. **Auto-Resume** - Detect when services recover, unpause campaigns

---

## Related Documentation

- [ROADMAP.md](ROADMAP.md) - Item #4 (Level 1)
- [JOB_SCHEDULER.md](JOB_SCHEDULER.md) - Scheduler integration
- [CAMPAIGN_SYSTEM.md](CAMPAIGN_SYSTEM.md) - Campaign pause/resume
- [COST_CONTROLS.md](COST_CONTROLS.md) - Cost limit failures use `misconfig` class
