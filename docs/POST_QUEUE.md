# Post Queue System

> **Version:** 1.2  
> **Date:** February 19, 2026  
> **Status:** ✅ Production Ready  
> **Verified:** February 19, 2026 (System Hardening Batch)  
> **Related:** ROADMAP.md Item #9

---

## Overview

The Post Queue System automates video publishing to social media platforms. When a job completes, posts are **automatically created** via a database trigger. A scheduler processes due posts and dispatches them to platform adapters.

**Key Design Goals:**
1. **Single Queue:** `posts` table is the only source of truth for publishing
2. **Automatic Import:** Database trigger creates posts when video completes (no manual step)
3. **Idempotency:** Never double-create or double-post
4. **Safety:** Respects kill switch, campaign pause, and retry limits

### v1.2 Enhancements (Feb 19, 2026)

- **Per-Platform Rate Limiting**: YouTube 10s, Instagram/Facebook/TikTok 5s, Twitter/Threads 3s delay between consecutive posts to avoid API rate limits
- **Optimistic Lock Claim**: Replaced batch `claim_due_posts` RPC with targeted UPDATE optimistic lock on specific post_id, eliminating race condition where wrong post could be claimed
- **Dead Post Sweeper**: `sweep_dead_posts(3)` runs every 5 min via cron, moves posts with ≥3 failed attempts from 'scheduled' to 'failed'
- **Draft Mode Support**: Posts with status='draft' are skipped by claim logic; `promote_draft_to_scheduled` / `reject_draft` RPCs for review workflow

---

## Video → Post Flow

```
                         ┌─────────────────────────┐
                         │     video-renderer      │
                         │   (FFmpeg on Render)    │
                         └───────────┬─────────────┘
                                     │ uploads video
                                     ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          job_assets INSERT                            │
│                      (type = 'final_mp4')                             │
└───────────────────────────────────────┬───────────────────────────────┘
                                        │
                                        ▼ TRIGGER: auto_import_video_to_posts
┌───────────────────────────────────────────────────────────────────────┐
│                            posts INSERT                               │
│  Creates one post per platform in job.meta.platforms[]                │
│  status = 'scheduled', scheduled_at = job.scheduled_post_at           │
└───────────────────────────────────────┬───────────────────────────────┘
                                        │
                                        ▼ schedule-posts (cron every 1 min)
┌───────────────────────────────────────────────────────────────────────┐
│                          post-worker                                  │
│  Claims due posts, uploads to YouTube/TikTok/Instagram                │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Post Status Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ┌──────────┐    claim     ┌─────────┐    success   ┌────────┐│
│   │scheduled │ ──────────►  │ posting │ ───────────► │ posted ││
│   └──────────┘              └─────────┘              └────────┘│
│        ▲                         │                             │
│        │ retry (backoff)         │ fail                        │
│        │                         ▼                             │
│        │                    ┌─────────┐                        │
│        └─────────────────── │ failed  │ (after 3 attempts)     │
│                             └─────────┘                        │
│                                                                 │
│   ┌───────────┐                                                │
│   │ cancelled │  (campaign paused/cancelled)                   │
│   └───────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
```

### Status Definitions

| Status | Description |
|--------|-------------|
| `scheduled` | Post is queued, waiting for `scheduled_at` time |
| `posting` | Actively being processed by post-worker (has lease) |
| `posted` | Successfully published to platform |
| `failed` | Permanently failed (max attempts or non-retryable error) |
| `cancelled` | Manually cancelled or campaign terminated |

### Transitions

| From | To | Trigger |
|------|-----|---------|
| `scheduled` | `posting` | `claim_due_posts()` by post-worker |
| `posting` | `posted` | `mark_post_posted()` on success |
| `posting` | `failed` | `mark_post_failed()` after max attempts |
| `posting` | `scheduled` | `mark_post_failed()` with retry (backoff) |
| `posting` | `scheduled` | `sweep_stale_post_leases()` (worker crashed) |
| `scheduled` | `cancelled` | Manual cancellation |

---

## Database Schema

### Posts Table (Extended)

```sql
posts
├── id (UUID, PK)
├── brand_id (UUID, FK → brands)
├── job_id (UUID, FK → jobs)
├── batch_id (UUID, FK → generation_batches)  -- For campaign gating
├── platform (TEXT)  -- 'youtube', 'instagram', 'facebook', 'threads', 'tiktok' (disabled)
├── video_url (TEXT)
├── title (TEXT)
├── description (TEXT)
├── tags (TEXT[])
├── status (TEXT)  -- scheduled, posting, posted, failed, cancelled
├── scheduled_at (TIMESTAMPTZ)
├── posted_at (TIMESTAMPTZ)
├── attempt_count (INTEGER, default 0)
├── last_attempt_at (TIMESTAMPTZ)   -- When last attempt started
├── next_attempt_at (TIMESTAMPTZ)   -- When next retry scheduled
├── locked_by (TEXT)  -- Worker ID
├── locked_at (TIMESTAMPTZ)
├── lease_expires_at (TIMESTAMPTZ)
├── platform_post_id (TEXT)  -- Platform's post ID
├── platform_url (TEXT)  -- Public URL on platform
├── error (JSONB)  -- {class, signature, message, failed_at, attempt}
├── ai_metadata (JSONB)  -- Note: actual column name (returned as 'meta' in RPCs)
├── idempotency_key (TEXT, computed)  -- job_id:platform
├── created_at, updated_at
```

### Unique Constraint

```sql
UNIQUE INDEX idx_posts_job_platform ON posts(job_id, platform)
WHERE job_id IS NOT NULL AND platform IS NOT NULL;
```

This prevents duplicate posts for the same job + platform.

---

## RPCs

### claim_due_posts(p_worker_id, p_limit, p_lease_seconds)

Atomically claims up to N posts that are due for posting.

```sql
SELECT * FROM claim_due_posts('post-worker-abc123', 5, 300);
```

**Claim Criteria:**
- `status = 'scheduled'`
- `scheduled_at <= NOW()`
- No active lease (or lease expired)
- Campaign not paused/cancelled
- `attempt_count < 3`

**Returns:** Claimed posts with full context (video_url, title, etc.)

### mark_post_posted(p_post_id, p_worker_id, p_platform_post_id, p_platform_url, p_meta)

Marks a post as successfully published.

```sql
SELECT * FROM mark_post_posted(
  'post-uuid',
  'post-worker-abc123',
  'tiktok_123456789',
  'https://tiktok.com/v/123456789'
);
```

**Behavior:**
- Sets `status = 'posted'`
- Stores platform IDs
- Clears lease
- Idempotent: Returns success if already posted

### mark_post_failed(p_post_id, p_worker_id, p_error_class, p_error_message, p_retryable)

Records failure and optionally schedules retry.

```sql
SELECT * FROM mark_post_failed(
  'post-uuid',
  'post-worker-abc123',
  'transient',
  'API rate limit exceeded',
  TRUE  -- retryable
);
```

**Behavior:**
- If retryable AND `attempt_count < 3`: Reschedules with backoff, status → `scheduled`
- Otherwise: status → `failed`

### sweep_stale_post_leases(p_dry_run)

Finds posts stuck in `posting` with expired leases and reverts to `scheduled`.

```sql
-- Preview
SELECT * FROM sweep_stale_post_leases(TRUE);

-- Execute
SELECT * FROM sweep_stale_post_leases(FALSE);
```

### find_due_posts(p_limit)

Read-only query for posts due for posting (used by scheduler preview).

```sql
SELECT * FROM find_due_posts(10);
```

### requeue_failed_post(p_post_id, p_delay_minutes)

Manually requeue a failed post.

```sql
SELECT * FROM requeue_failed_post('post-uuid', 5);
```

**Safety Checks:**
- Only works on `status = 'failed'`
- Rejects if `attempt_count >= 3`
- Rejects if `error.class = 'permanent'`

---

## Retry Policy

### Backoff Schedule

| Attempt | Delay Before Next Attempt |
|---------|--------------------------|
| 1 → 2 | +30 minutes |
| 2 → 3 | +2 hours |
| 3 | Permanent failure |

### Error Classes

| Class | Retryable | Description |
|-------|-----------|-------------|
| `transient` | Yes | Temporary failures (rate limit, timeout) |
| `dependency` | Yes | Platform API down |
| `misconfig` | No | Invalid credentials, missing data |
| `permanent` | No | Content rejected, account banned |

### Error Signatures

Error signatures enable cluster-protection for posting outages. Format: `{class}:{platform}:{detail}`

Examples:
- `dependency:youtube:api_down`
- `transient:youtube:rate_limit`
- `permanent:instagram:content_rejected`

> **Note (Feb 2026):** TikTok and Twitter scheduling are currently **disabled** in worker-v1 and post-worker. Fake TikTok/Twitter post records have been cleaned from the database. These platforms may be re-enabled when API access is available.

---

## Per-Platform Throttling

Schedule-posts v1.1 enforces per-platform limits per run to prevent hammering failing platforms:

| Platform | Max Per Run |
|----------|-------------|
| YouTube | 5 |
| Instagram | 5 |
| Facebook | 5 |
| Threads | 5 |
| TikTok | 5 (disabled) |
| Other | 3 |

**Auto-Throttle:** Platforms with 5+ failures in 10 minutes are automatically skipped until recovery.

---

## Queue Health View

```sql
SELECT * FROM v_post_queue_health;
```

Returns:
- `due_count` - Posts ready to be claimed
- `posting_count` - Currently being processed
- `stale_posting_count` - Stuck posts (lease expired)
- `failed_last_1h`, `failed_last_24h` - Failure rates
- `posted_last_1h`, `posted_last_24h` - Success rates
- `avg_failed_attempts` - Average attempts for failed posts
- `oldest_due_age_minutes` - How long oldest post waiting
- Per-platform breakdown (scheduled/failed)
- `health_status` - OK/CAUTION/WARNING/CRITICAL

---

## Edge Functions

### schedule-posts

**Cron Trigger:** Every 5-15 minutes

**Workflow:**
1. Check kill switch → abort if active (503)
2. Sweep stale leases
3. Find due posts (`scheduled_at <= NOW()`)
4. Trigger post-worker for batch

**Endpoints:**
```bash
# Run scheduler
curl -X POST https://<project>.supabase.co/functions/v1/schedule-posts \
  -H "Authorization: Bearer <service_role_key>"

# Dry run (preview only)
curl -X POST https://<project>.supabase.co/functions/v1/schedule-posts \
  -H "Authorization: Bearer <service_role_key>" \
  -d '{"dry_run": true}'

# Custom limit
curl -X POST https://<project>.supabase.co/functions/v1/schedule-posts \
  -H "Authorization: Bearer <service_role_key>" \
  -d '{"limit": 20}'
```

### post-worker

**Trigger:** Called by schedule-posts or manually

**Workflow:**
1. Check kill switch → abort if active (503)
2. Claim posts (from queue or specific IDs)
3. For each post:
   - Get platform adapter
   - Call platform API (stubbed)
   - Update status (posted/failed)
4. Return results

**Endpoints:**
```bash
# Process from queue
curl -X POST https://<project>.supabase.co/functions/v1/post-worker \
  -H "Authorization: Bearer <service_role_key>"

# Process specific post
curl -X POST https://<project>.supabase.co/functions/v1/post-worker \
  -H "Authorization: Bearer <service_role_key>" \
  -d '{"post_id": "uuid-here"}'

# Process multiple
curl -X POST https://<project>.supabase.co/functions/v1/post-worker \
  -H "Authorization: Bearer <service_role_key>" \
  -d '{"post_ids": ["uuid-1", "uuid-2"]}'
```

---

## Idempotency Rules

### 1. Post Creation (Worker-v1)

`schedule_post_idempotent(job_id, platform, ...)` ensures:
- Only ONE post per job + platform
- Returns existing post if duplicate attempt
- Race-safe via unique index + exception handling

### 2. Post Processing (Post-Worker)

- `claim_due_posts` uses `FOR UPDATE SKIP LOCKED` (no double-claim)
- `mark_post_posted` checks status first (no-op if already posted)
- Lease timeout reverts to `scheduled` (allows retry)

### 3. Platform Posting

- Post-worker stores `platform_post_id` after success
- Future: Check for existing platform post before re-uploading

---

## Campaign Gating

Posts inherit `batch_id` from their source job. The claim RPC respects:

```sql
-- In claim_due_posts
LEFT JOIN generation_batches gb ON p.batch_id = gb.id
WHERE (gb.id IS NULL OR gb.status = 'active')
```

**Behavior:**
- Campaign paused → posts not claimed (stay in queue)
- Campaign cancelled → posts not claimed
- No campaign (`batch_id IS NULL`) → posts always eligible

---

## DLQ View

```sql
SELECT * FROM v_failed_posts_dlq;
```

Returns:
- `post_id`, `job_id`, `brand_id`, `platform`
- `error_class`, `error_message`, `failed_at`
- `attempt_count`, `retry_eligible`
- `campaign_name`, `campaign_status`

---

## Cron Setup

### Supabase Dashboard

1. Go to **Database → Extensions** → Enable `pg_cron`
2. Go to **SQL Editor** and run:

```sql
-- Schedule posting every 5 minutes
SELECT cron.schedule(
  'schedule-posts-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.edge_function_url') || '/schedule-posts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

### Alternative: External Cron

Use Vercel Cron, GitHub Actions, or similar:

```yaml
# .github/workflows/schedule-posts.yml
name: Schedule Posts
on:
  schedule:
    - cron: '*/5 * * * *'
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST "$SUPABASE_URL/functions/v1/schedule-posts" \
            -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```

---

## Smoke Tests

### Test 1: Manual Post Creation

```sql
-- Create a test post
INSERT INTO posts (brand_id, platform, video_url, title, scheduled_at, status)
VALUES (
  (SELECT id FROM brands LIMIT 1),
  'tiktok',
  'https://example.com/test-video.mp4',
  'Test Post',
  NOW() - INTERVAL '1 minute',  -- Due now
  'scheduled'
);
```

### Test 2: Find Due Posts

```sql
SELECT * FROM find_due_posts(10);
```

Expected: Shows the test post.

### Test 3: Claim Posts

```sql
SELECT * FROM claim_due_posts('test-worker', 1, 60);
```

Expected: Returns the post with status changed to `posting`.

### Test 4: Mark Posted

```sql
SELECT * FROM mark_post_posted(
  '<post_id>',
  'test-worker',
  'test_123',
  'https://test.com/v/123'
);
```

### Test 5: Verify Status

```sql
SELECT id, status, platform_post_id, platform_url, posted_at
FROM posts WHERE id = '<post_id>';
```

Expected: `status = 'posted'`, URLs populated.

### Test 6: Test Failure + Retry

```sql
-- Reset post
UPDATE posts SET status = 'scheduled', attempt_count = 0 WHERE id = '<post_id>';

-- Claim
SELECT * FROM claim_due_posts('test-worker', 1, 60);

-- Fail with retry
SELECT * FROM mark_post_failed(
  '<post_id>',
  'test-worker',
  'transient',
  'Rate limit hit',
  TRUE
);

-- Check status
SELECT status, scheduled_at, attempt_count, error FROM posts WHERE id = '<post_id>';
```

Expected: `status = 'scheduled'`, `scheduled_at` pushed forward, `attempt_count = 1`.

### Test 7: Max Attempts Failure

```sql
-- Set attempt count to 2
UPDATE posts SET status = 'scheduled', attempt_count = 2 WHERE id = '<post_id>';

-- Claim and fail
SELECT * FROM claim_due_posts('test-worker', 1, 60);
SELECT * FROM mark_post_failed('<post_id>', 'test-worker', 'transient', 'Still failing', TRUE);

-- Check
SELECT status, attempt_count FROM posts WHERE id = '<post_id>';
```

Expected: `status = 'failed'`, `attempt_count = 3`.

### Test 8: Edge Function (if deployed)

```bash
# Run scheduler (dry run)
curl -X POST https://<project>.supabase.co/functions/v1/schedule-posts \
  -H "Authorization: Bearer <service_role_key>" \
  -d '{"dry_run": true}'
```

---

## Platform Adapters

Currently **stubbed** — all platforms return fake IDs.

> **Note (Feb 2026):** TikTok and Twitter adapters are disabled. Only YouTube, Instagram, Facebook, and Threads are active.

### Adapter Interface

```typescript
interface PlatformAdapter {
  name: string;
  post(
    videoUrl: string,
    title: string,
    description: string | null,
    tags: string[] | null,
    meta: Record<string, unknown>
  ): Promise<PlatformResult>;
}
```

### Implemented Adapters (Stubbed)

| Platform | Class | Notes |
|----------|-------|-------|
| YouTube | `YouTubeAdapter` | Validates title < 100 chars |
| Instagram | `InstagramAdapter` | Generic stub |
| Facebook | `FacebookAdapter` | Generic stub |
| Threads | `ThreadsAdapter` | Added Feb 2026 |
| TikTok | `TikTokAdapter` | **Disabled** — scheduling removed (Feb 2026) |
| Twitter | N/A | **Disabled** — never wired up |

### Future Integration

Replace stub logic in adapters with actual API calls:

```typescript
class TikTokAdapter implements PlatformAdapter {
  async post(...): Promise<PlatformResult> {
    // TODO: Implement TikTok Content Posting API
    // 1. Upload video chunk by chunk
    // 2. Create post with metadata
    // 3. Return post ID and URL
  }
}
```

---

## Monitoring

### Key Metrics

1. **Queue Depth:** `SELECT COUNT(*) FROM posts WHERE status = 'scheduled'`
2. **Posting Rate:** Posts moved to `posted` per hour
3. **Failure Rate:** `SELECT COUNT(*) FROM posts WHERE status = 'failed'`
4. **DLQ Size:** `SELECT COUNT(*) FROM v_failed_posts_dlq`

### Alerts

- Queue depth > 100 posts
- Failure rate > 10% in last hour
- Stale leases swept > 5 in single run (workers crashing)

---

## Files

| File | Purpose |
|------|---------|
| `supabase/migrations/20260223001_post_queue_system.sql` | Schema + RPCs |
| `supabase/functions/post-worker/index.ts` | Post processing worker |
| `supabase/functions/schedule-posts/index.ts` | Cron scheduler |
| `docs/POST_QUEUE.md` | This documentation |

---

## Implementation Verification

> **Verified:** February 10, 2026

### Smoke Test Results

| Test | Status | Notes |
|------|--------|-------|
| 1. Migration check (`find_due_posts` exists) | ✅ PASS | RPC deployed and callable |
| 2. Create scheduled post | ✅ PASS | Posts created with `scheduled` status |
| 3. Post-worker claims & processes | ✅ PASS | 2 posts processed, 2 posted |
| 4. Verify `posted` status + platform IDs | ✅ PASS | `stub_youtube_*`, `stub_tiktok_*` IDs |
| 5. Idempotency (no double-post) | ✅ PASS | 0 due posts after posting |
| 6. Lease recovery (`sweep_stale_post_leases`) | ✅ PASS | Stale lease sweep works |

### Gotchas Verified

| Gotcha | Status | Implementation |
|--------|--------|----------------|
| 1. `claim_due_posts` atomicity | ✅ | Uses `FOR UPDATE SKIP LOCKED` |
| 2. Lease expiry logic | ✅ | Consistent `lease_expires_at < NOW()` |
| 3. Status transitions | ✅ | Guards against stale claims |
| 4. Campaign gating | ✅ | Joins `generation_batches.status` |
| 5. Retry policy | ✅ | 30min → 2h → permanent fail |

### Schema Notes

- Posts table uses `ai_metadata` column (not `meta`)
- `attempt_count` qualified as `posts.attempt_count` in RPCs
- `idempotency_key` computed column: `job_id:platform`
