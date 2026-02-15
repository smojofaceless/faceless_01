# Time Slot Scoring — Design Document

> Roadmap #19 · Level 3 Analytics · February 2026

## Overview

Time Slot Scoring answers:  
**"Which hours and days of the week perform best for each platform and brand?"**

It is **analytics-only** — scores are computed, stored, and displayed but never
automatically alter scheduling or presets. That line is drawn at Level 4.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   post_metrics                      │
│  (append-only time-series, collected every 30 min)  │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│       recompute_time_slot_scores() — RPC            │
│                                                     │
│  1. Filter posts: status=posted, age ≥ 6h           │
│  2. Join to v_post_metrics_latest for engagement     │
│  3. Compute performance_value per post              │
│  4. Bucket by (brand, platform, tz, dow, hour)      │
│  5. Aggregate: mean score, sample_size, avg stats   │
│  6. UPSERT into time_slot_scores                    │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│               time_slot_scores                      │
│  (168 rows per brand/platform/window — 7×24 grid)   │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│         get_best_time_slots() — RPC                 │
│         get_time_slot_scores() — RPC                │
│                                                     │
│  → Calendar UI "Best Times" panel                   │
│  → Campaign creation guidance (future)              │
└─────────────────────────────────────────────────────┘
```

## Scoring Formula

### Performance Value

We use a **weighted engagement** formula:

```
performance_value = views + (5 × likes) + (10 × comments) + (10 × shares)
```

**Rationale:**

| Signal    | Weight | Why                                              |
| --------- | ------ | ------------------------------------------------ |
| Views     | 1      | Baseline reach, high volume, low signal per unit |
| Likes     | 5      | Active engagement, easy to give                  |
| Comments  | 10     | High-effort signal, strong engagement indicator  |
| Shares    | 10     | Best virality proxy, drives new reach            |

Alternatives considered:

- **Engagement rate** (`(likes+comments+shares)/views × log(views+1)`) — penalizes
  high-view low-engagement posts, but unstable for small view counts. Better for
  Level 4 when we have more data.
- **Raw views** — too noisy, ignores engagement quality.

The weighted sum is simple, monotonic, and degrades gracefully when some metrics
are zero (e.g., YouTube doesn't expose shares via Data API).

### Maturity Threshold

Posts must be at least **6 hours old** before being included, ensuring metrics
have had time to accumulate through the initial rapid-poll phase of the
metrics collector.

### Scoring Windows

| Window | Purpose             |
| ------ | ------------------- |
| 7 days | Recent trend        |
| 14 days| Short-term pattern  |
| 30 days| Stable baseline     |

Each window is computed independently. A post is included if:
`posted_at >= NOW() - interval '{window_days} days' AND posted_at <= NOW() - interval '6 hours'`

### Score = Mean Performance Value

For each `(brand, platform, tz, day_of_week, hour)` slot:

```sql
score = AVG(performance_value)
sample_size = COUNT(*)
avg_views = AVG(views)
avg_likes = AVG(likes)
avg_comments = AVG(comments)
avg_shares = AVG(shares)
```

## Data Model

### `time_slot_scores` Table

```sql
CREATE TABLE time_slot_scores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id        UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    platform        TEXT NOT NULL,
    tz              TEXT NOT NULL DEFAULT 'America/New_York',
    day_of_week     INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    hour            INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
    window_days     INTEGER NOT NULL CHECK (window_days IN (7, 14, 30)),
    score           NUMERIC NOT NULL DEFAULT 0,
    sample_size     INTEGER NOT NULL DEFAULT 0,
    avg_views       NUMERIC DEFAULT 0,
    avg_likes       NUMERIC DEFAULT 0,
    avg_comments    NUMERIC DEFAULT 0,
    avg_shares      NUMERIC DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (brand_id, platform, tz, window_days, day_of_week, hour)
);
```

- **168 rows** per (brand, platform, tz, window) = 7 days × 24 hours
- UNIQUE constraint enables `ON CONFLICT ... DO UPDATE` upsert
- `day_of_week`: 0=Sunday through 6=Saturday (Postgres `EXTRACT(DOW ...)`)
- `hour`: 0-23 in the specified timezone

### Indexes

```sql
-- Primary query pattern: brand + platform + window lookup
CREATE INDEX idx_time_slot_scores_lookup
    ON time_slot_scores (brand_id, platform, window_days);

-- Score ranking queries
CREATE INDEX idx_time_slot_scores_score
    ON time_slot_scores (brand_id, platform, window_days, score DESC);
```

### RLS

Follows project convention (single-tenant, open read):

```sql
SELECT, INSERT, UPDATE, DELETE → anon, authenticated (true)
ALL → service_role
```

## RPCs

### `recompute_time_slot_scores(p_brand_id, p_platform, p_window_days, p_tz)`

- Recomputes scores for one brand/platform/window combination
- Timezone: uses `p_tz` if provided, else tries `brands.settings->>'timezone'`,
  else falls back to `'America/New_York'`
- Converts `posted_at` to local time for day-of-week/hour bucketing
- Uses `INSERT ... ON CONFLICT DO UPDATE` for idempotent upsert
- Returns count of rows upserted

### `recompute_all_time_slot_scores(p_window_days)`

- Loops through all active brands with posted content
- For each brand, loops through distinct platforms with posts
- Calls `recompute_time_slot_scores` for each combination
- Returns total rows upserted

### `get_time_slot_scores(p_brand_id, p_platform, p_window_days, p_tz)`

- Returns the full 7×24 grid for a brand/platform
- Sorted by day_of_week, hour for UI grid rendering
- Timezone defaults to stored brand preference or America/New_York

### `get_best_time_slots(p_brand_id, p_platform, p_window_days, p_limit)`

- Returns top N slots by score
- **Filters: `sample_size >= 3`** — won't recommend slots with tiny sample
- Returns human-readable labels (day name, formatted hour)

## Scheduled Computation

### pg_cron Job

```
Job:     recompute-time-slot-scores
Schedule: 0 */6 * * *  (every 6 hours)
Action:  SELECT recompute_all_time_slot_scores(7);
         SELECT recompute_all_time_slot_scores(14);
         SELECT recompute_all_time_slot_scores(30);
```

Lightweight: only reads from `posts` + `v_post_metrics_latest` with date
filters, then upserts up to 168 × (brands × platforms) rows.

## UI Integration

### Calendar "Best Times" Panel

Location: Calendar toolbar, right side — new "Best Times" button that toggles
a collapsible panel below the toolbar.

**Components:**
1. **Button** in toolbar filter group: "🕐 Best Times"
2. **Panel** (collapsible): platform dropdown + window selector (7/14/30d)
3. **Results**: Top 5 slots as chips (e.g., "Wed 9 PM · 2.1K avg views")
4. **Empty state**: "Not enough data — need at least 3 posts per time slot"

**Data flow:**
1. User clicks "Best Times" → panel toggles
2. Platform defaults to current filter or first available
3. Calls `get_best_time_slots` RPC via metricsService (or new timeSlotService)
4. Renders chips with score + sample info

### No Heatmap in v1

Full 7×24 heatmap deferred — the top-5 chip display is sufficient for v1
and much lighter. Heatmap can be added in a settings page later.

## Dependencies

| Dependency          | Status | Notes                                       |
| ------------------- | ------ | ------------------------------------------- |
| `post_metrics`      | ✅     | #18 — time-series metrics data              |
| `v_post_metrics_latest` | ✅ | #18 hardened — DISTINCT ON (post_id, platform) |
| `posts.posted_at`   | ✅     | Populated by post-worker on success         |
| `brands.settings`   | ✅     | JSONB — can store timezone                  |

## What This Does NOT Do

- ❌ Automatically reschedule posts
- ❌ Alter preset weights or content generation
- ❌ ML-based predictions
- ❌ A/B testing of time slots
- ❌ Full heatmap UI

These belong to Level 4+ (#21+).

## Smoke Test Checklist

See [TIME_SLOT_SCORING_SMOKE_TESTS.md](TIME_SLOT_SCORING_SMOKE_TESTS.md).
