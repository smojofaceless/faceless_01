# Post Analytics System (Metrics Collection v1)

> **Roadmap Item:** #18  
> **Status:** Active  
> **Created:** February 15, 2026  
> **Migration:** `20260315001_metrics_collection_v1.sql`  
> **Edge Function:** `metrics-collector`

---

## Overview

Metrics Collection v1 provides **append-only time-series storage** for post engagement data (views, likes, comments, shares) across all platforms. It replaces the unused `post_analytics` scaffold table with a proper time-series design.

**Scope:** Data ingestion and storage ONLY. No scoring, ranking, optimization, or recommendations.

---

## Architecture

```
┌─────────────────┐     cron (30 min)     ┌────────────────────┐
│  schedule-posts  │ ─────────────────────▶│  metrics-collector  │
│  (posts videos)  │                       │  (fetches metrics)  │
└────────┬────────┘                       └─────────┬──────────┘
         │                                          │
         │ posts → posted                           │ for each eligible post:
         │ (platform_post_id set)                   │   1. get platform adapter
         ▼                                          │   2. call platform API
┌─────────────────┐                                 │   3. insert post_metrics row
│     posts       │◀────────────────────────────────┘
│  (anchor table) │
└────────┬────────┘
         │ 1:N
         ▼
┌─────────────────┐
│  post_metrics   │  ← append-only time-series
│  (one row per   │     (never overwritten)
│   collection)   │
└─────────────────┘
```

---

## Collection Schedule (Decay)

Posts are collected more frequently when fresh, less as they age:

| Post Age       | Collection Interval | Rationale                          |
|----------------|--------------------|------------------------------------|
| 0 – 2 hours    | Every 30 min       | Rapid initial traction tracking    |
| 2 – 24 hours   | Every 2 hours      | First-day growth curve             |
| 24 – 48 hours  | Every 6 hours      | Second-day plateau detection       |
| 48h – 7 days   | Every 12 hours     | Weekly trend                       |
| 7 – 30 days    | Every 24 hours     | Long-tail tracking                 |
| 30 – 90 days   | Every 7 days       | Archive collection                 |
| 90+ days       | Stop collecting     | Data is stable                     |

This schedule is hardcoded in the `find_metrics_eligible_posts` RPC. Future versions can move it to `system_config`.

---

## Database Schema

### `post_metrics` (replaces old `post_analytics`)

Append-only time-series table. One row per collection event.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Row identifier |
| `post_id` | UUID FK → posts | Which post |
| `platform` | TEXT | Denormalized from posts (for fast queries) |
| `views` | BIGINT | Total view count at collection time |
| `likes` | INTEGER | Total likes |
| `comments` | INTEGER | Total comments |
| `shares` | INTEGER | Total shares |
| `saves` | INTEGER | Bookmarks/saves |
| `watch_time_seconds` | INTEGER | Total watch time (YouTube) |
| `avg_view_duration_seconds` | NUMERIC(10,2) | Avg duration per view |
| `avg_view_percentage` | NUMERIC(5,2) | Avg retention % |
| `subscribers_gained` | INTEGER | Net subscriber gain |
| `subscribers_lost` | INTEGER | Net subscriber loss |
| `post_age_hours` | NUMERIC(10,1) | Age of post at collection time |
| `collected_at` | TIMESTAMPTZ | When this snapshot was taken |
| `source` | TEXT | 'api', 'backfill', 'manual', 'stub' |
| `collector_id` | TEXT | Edge function invocation ID |
| `raw_payload` | JSONB | Full API response for debugging |
| `error` | TEXT | Partial failure note |
| `created_at` | TIMESTAMPTZ | DB insert time |

**Indexes:**
- `idx_post_metrics_post_collected` — `(post_id, collected_at DESC)` for per-post history
- `idx_post_metrics_collected_at` — `(collected_at DESC)` for recency queries
- `idx_post_metrics_platform` — `(platform, collected_at DESC)` for platform-level queries

**Dedup:** The `find_metrics_eligible_posts` RPC only returns posts whose last collection is older than the current interval window. Multiple collections within a window are harmless (append-only) but avoided for efficiency.

### Views

| View | Purpose |
|------|---------|
| `v_post_metrics_latest` | `DISTINCT ON (post_id)` — most recent metrics per post |
| `v_post_metrics_summary` | Per-post summary: latest values + collection count + first/last collected |
| `v_metrics_collection_status` | Join posts ↔ latest metrics — shows what's collected, what's due, what's stale |

### RPCs

| RPC | Purpose |
|-----|---------|
| `find_metrics_eligible_posts(limit)` | Posts due for collection based on decay schedule |
| `record_post_metrics(...)` | Insert a metrics row (used by collector) |
| `get_post_metrics(post_id, since, until)` | Time-series history for one post |
| `get_job_metrics(job_id)` | Latest metrics aggregated across all platforms for a job |
| `get_campaign_metrics(batch_id)` | Campaign-level aggregate metrics |
| `get_latest_metrics(post_id)` | Single latest snapshot for one post |
| `get_latest_metrics_batch(post_ids)` | Latest metrics for multiple posts (calendar use) |

---

## Platform Adapters

Each platform has a metrics adapter implementing:

```typescript
interface MetricsAdapter {
  name: string;
  getMetrics(
    platformPostId: string,
    supabase: SupabaseClient,
    brandId: string
  ): Promise<MetricsResult>;
}
```

| Platform | Status | API | Notes |
|----------|--------|-----|-------|
| YouTube Shorts | **Real** | YouTube Data API v3 `/videos?part=statistics` | Uses OAuth from `platform_tokens` |
| Instagram Reels | **Real** | Graph API `/media?fields=like_count,comments_count` + `/insights` | Uses long-lived token from `platform_tokens` |
| Facebook Reels | **Real** | Graph API `/video_insights` | Uses page token from `platform_tokens` |
| Threads | **Real** | Threads API `/insights` | Wired up Feb 2026 (platform cleanup) |
| TikTok | **Disabled** | N/A | Scheduling disabled; metrics adapter returns zeros |

### Error Classification (reuses existing pattern)

| Error Class | Action | Examples |
|-------------|--------|----------|
| `transient` | Retry next interval | Network timeout, 500 |
| `dependency` | Retry next interval | API rate limit, 429 |
| `misconfig` | Stop collecting | Token expired, 401, no token |
| `permanent` | Mark terminal | Post deleted (404), content removed |

When a post returns `permanent` error, `posts.meta.metrics_terminal` is set to `true` and the post is excluded from future collection.

---

## Metrics Collector Edge Function

**Trigger:** Cron every 30 minutes  
**Deployment:** `npx supabase functions deploy metrics-collector --no-verify-jwt --project-ref ustmetegzisztqqcjigt`

### Flow

1. Kill switch check → abort if active
2. `find_metrics_eligible_posts(50)` → batch of posts due for collection
3. For each post:
   a. Get platform adapter
   b. Get platform token (from `platform_tokens`)
   c. Call adapter.getMetrics()
   d. Insert via `record_post_metrics`
   e. On permanent error → mark `posts.meta.metrics_terminal = true`
4. Return summary (total processed, success count, error count)

### Safety

- **Batch limit:** 50 posts per run (configurable)
- **Kill switch:** Reuses existing `is_kill_switch_active` RPC
- **No cost control hooks** for v1 (platform APIs are free-tier; cost controls can be added later)
- **Partial failure:** One post failing doesn't crash the batch
- **Idempotency:** Multiple runs in the same interval window are safe (RPC skips already-collected posts)

---

## UI Integration (Lightweight)

### Calendar Page

- Posted items show metrics badge: `👁 1.2K` (views count)
- Badge loaded lazily after calendar renders (batch fetch for visible posted items)
- "Last collected" timestamp shown in post detail modal

### Post Detail Modal

- **Metrics section** added below lifecycle timeline
- Shows latest snapshot: views, likes, comments, shares
- Shows collection history table (last 10 entries)
- Shows "Metrics terminal" warning if post was deleted

### Posts Page

- Post detail modal shows same metrics section as calendar

---

## Retention Strategy (v1 = no deletion)

v1 does NOT delete metrics data. Future versions may:
- Archive rows older than 1 year to cold storage
- Aggregate old rows into daily/weekly rollups
- Add `cleanup_old_post_metrics(days)` RPC (similar to `cleanup_old_lifecycle_events`)

The `cleanup_old_post_metrics` RPC is provided but defaults to 365 days and is not scheduled.

---

## Future: How #19 and #20 Build on This

### #19 Time Slot Scoring

- Queries `post_metrics` joined with `posts.posted_at` (hour/day-of-week)
- Groups by `(platform, posted_hour, posted_day_of_week)`
- Computes avg views/likes per time slot
- Stores results in `time_slot_scores` table
- `v_post_metrics_latest` provides the data source

### #20 Caption/Tags Learning Loop

- Queries `post_metrics` joined with `posts.ai_metadata` (titles, descriptions, tags)
- Correlates caption variants with engagement metrics
- Biases future metadata generation toward high performers
- `v_post_metrics_summary` provides per-post performance metrics

---

## Smoke Test Checklist

- [ ] `post_metrics` table exists with correct columns
- [ ] Old `post_analytics` table dropped
- [ ] `find_metrics_eligible_posts` returns only posted items with `platform_post_id`
- [ ] `find_metrics_eligible_posts` respects decay schedule (doesn't return recently collected posts)
- [ ] `find_metrics_eligible_posts` excludes `metrics_terminal` posts
- [ ] `record_post_metrics` inserts a row with correct `post_age_hours`
- [ ] `get_post_metrics` returns time-series ordered by `collected_at DESC`
- [ ] `get_job_metrics` aggregates across platforms
- [ ] `get_campaign_metrics` aggregates across all posts in batch
- [ ] `get_latest_metrics` returns single most recent row
- [ ] `get_latest_metrics_batch` returns latest for multiple posts
- [ ] `v_post_metrics_latest` correctly picks most recent row per post
- [ ] `v_post_metrics_summary` shows collection count and first/last times
- [ ] `v_metrics_collection_status` shows eligible vs collected vs terminal
- [ ] `metrics-collector` checks kill switch
- [ ] `metrics-collector` processes batch without crashing on single-post failure
- [ ] YouTube adapter fetches real statistics (with valid token)
- [ ] YouTube adapter handles expired token (refreshes)
- [ ] Stub adapter returns zeros gracefully
- [ ] Calendar shows metrics badge on posted items
- [ ] Post detail modal shows metrics section
- [ ] `cleanup_old_post_metrics` works with specified retention days
