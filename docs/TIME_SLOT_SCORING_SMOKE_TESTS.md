# Time Slot Scoring — Smoke Tests

> Roadmap #19 · Manual verification checklist

## Prerequisites

- Metrics Collection v1 (#18) deployed and working
- At least a few rows in `posts` with `status='posted'` and `posted_at` set
- At least some `post_metrics` rows for those posts

---

## 1. Table & Constraints

### 1.1 Table exists
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'time_slot_scores'
ORDER BY ordinal_position;
```
**Expected:** All columns present: id, brand_id, platform, tz, day_of_week, hour, window_days, score, sample_size, avg_views, avg_likes, avg_comments, avg_shares, updated_at.

### 1.2 UNIQUE constraint works
```sql
INSERT INTO time_slot_scores (brand_id, platform, tz, window_days, day_of_week, hour, score, sample_size)
VALUES ('00000000-0000-0000-0000-000000000001', 'youtube', 'America/New_York', 30, 3, 14, 100, 5);

-- Same insert again should conflict
INSERT INTO time_slot_scores (brand_id, platform, tz, window_days, day_of_week, hour, score, sample_size)
VALUES ('00000000-0000-0000-0000-000000000001', 'youtube', 'America/New_York', 30, 3, 14, 200, 10);
```
**Expected:** Second insert fails with UNIQUE violation.

### 1.3 CHECK constraints
```sql
-- Should fail: day_of_week = 7
INSERT INTO time_slot_scores (brand_id, platform, tz, window_days, day_of_week, hour, score, sample_size)
VALUES ('00000000-0000-0000-0000-000000000001', 'youtube', 'UTC', 30, 7, 14, 100, 5);

-- Should fail: hour = 24
INSERT INTO time_slot_scores (brand_id, platform, tz, window_days, day_of_week, hour, score, sample_size)
VALUES ('00000000-0000-0000-0000-000000000001', 'youtube', 'UTC', 30, 3, 24, 100, 5);

-- Should fail: window_days = 10
INSERT INTO time_slot_scores (brand_id, platform, tz, window_days, day_of_week, hour, score, sample_size)
VALUES ('00000000-0000-0000-0000-000000000001', 'youtube', 'UTC', 10, 3, 14, 100, 5);
```
**Expected:** All three fail with CHECK violation.

---

## 2. Timezone Conversion

### 2.1 UTC post → correct local slot
```sql
-- If posted_at = '2026-02-10 22:00:00+00' (10 PM UTC)
-- In America/New_York (EST = UTC-5), that's 5 PM → hour=17
-- In UTC, that stays 10 PM → hour=22
-- DOW: Tuesday (2026-02-10 is a Tuesday) → dow=2

SELECT
    '2026-02-10 22:00:00+00'::timestamptz AT TIME ZONE 'America/New_York' AS local_time,
    EXTRACT(DOW FROM '2026-02-10 22:00:00+00'::timestamptz AT TIME ZONE 'America/New_York')::int AS dow,
    EXTRACT(HOUR FROM '2026-02-10 22:00:00+00'::timestamptz AT TIME ZONE 'America/New_York')::int AS hour;
```
**Expected:** local_time = 2026-02-10 17:00:00, dow=2, hour=17.

### 2.2 DST edge case
```sql
-- March 8, 2026 — DST spring forward in America/New_York
SELECT
    '2026-03-08 07:30:00+00'::timestamptz AT TIME ZONE 'America/New_York' AS local_time,
    EXTRACT(HOUR FROM '2026-03-08 07:30:00+00'::timestamptz AT TIME ZONE 'America/New_York')::int AS hour;
```
**Expected:** hour=2 (EST→EDT transition, 2:30 AM becomes 3:30 AM, but 7:30 UTC = 2:30 AM EST).

---

## 3. Scoring RPCs

### 3.1 recompute_time_slot_scores — basic
```sql
-- Pick a brand_id and platform that has posted content with metrics
SELECT recompute_time_slot_scores(
    '<brand_id>'::uuid,
    'youtube',
    30,
    'America/New_York'
);
```
**Expected:** Returns rows_upserted > 0 (one row per slot that had posts).

### 3.2 Verify upserted data
```sql
SELECT day_of_week, hour, score, sample_size, avg_views, avg_likes
FROM time_slot_scores
WHERE brand_id = '<brand_id>'
  AND platform = 'youtube'
  AND window_days = 30
ORDER BY score DESC
LIMIT 5;
```
**Expected:** Rows with non-zero scores, sample_size ≥ 1.

### 3.3 Rerun is idempotent
```sql
SELECT COUNT(*) FROM time_slot_scores WHERE brand_id = '<brand_id>' AND platform = 'youtube' AND window_days = 30;
-- Note count

SELECT recompute_time_slot_scores('<brand_id>'::uuid, 'youtube', 30);

SELECT COUNT(*) FROM time_slot_scores WHERE brand_id = '<brand_id>' AND platform = 'youtube' AND window_days = 30;
```
**Expected:** Count is identical before and after rerun. `updated_at` changes but row count stays the same.

### 3.4 recompute_all_time_slot_scores
```sql
SELECT recompute_all_time_slot_scores(30);
```
**Expected:** Returns total_rows_upserted > 0. All active brands × platforms covered.

### 3.5 No data = no crash
```sql
-- Use a brand with no posts
SELECT recompute_time_slot_scores(
    '00000000-0000-0000-0000-000000000000'::uuid,
    'tiktok',
    7
);
```
**Expected:** Returns 0 rows upserted. No error.

---

## 4. Query RPCs

### 4.1 get_time_slot_scores — full grid
```sql
SELECT * FROM get_time_slot_scores('<brand_id>'::uuid, 'youtube', 30);
```
**Expected:** Returns rows sorted by day_of_week ASC, hour ASC. Only slots that have data (not a full 168-row grid if no posts in every slot).

### 4.2 get_best_time_slots — top N
```sql
SELECT * FROM get_best_time_slots('<brand_id>'::uuid, 'youtube', 30, 5);
```
**Expected:** Returns up to 5 rows sorted by score DESC. All have `sample_size >= 3`. Includes `day_name` and `hour_label` columns.

### 4.3 get_best_time_slots — sample threshold
```sql
-- If all slots have sample_size < 3:
SELECT * FROM get_best_time_slots('<brand_id>'::uuid, 'youtube', 7, 5);
```
**Expected:** Returns 0 rows (empty, not null, no error).

### 4.4 get_best_time_slots — nonexistent brand
```sql
SELECT * FROM get_best_time_slots('00000000-0000-0000-0000-000000000000'::uuid, 'youtube', 30, 5);
```
**Expected:** Returns 0 rows. No error.

---

## 5. Index Verification

### 5.1 Indexes exist
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'time_slot_scores';
```
**Expected:** At least 2 indexes:
- `idx_time_slot_scores_lookup` on `(brand_id, platform, window_days)`
- `idx_time_slot_scores_score` on `(brand_id, platform, window_days, score DESC)`

---

## 6. Cron Job

### 6.1 Job registered
```sql
SELECT jobid, jobname, schedule, command
FROM cron.job
WHERE jobname = 'recompute-time-slot-scores';
```
**Expected:** One row with schedule `0 */6 * * *` (every 6 hours).

---

## 7. UI Integration

### 7.1 Best Times button visible
1. Navigate to Calendar page
2. Look in the toolbar right section
3. **Expected:** "Best Times" button visible next to filters

### 7.2 Panel opens/closes
1. Click "Best Times" button
2. **Expected:** Panel slides open below toolbar with platform selector and window toggle
3. Click again → panel closes

### 7.3 Data loads
1. With a brand selected that has scored data
2. Open Best Times panel
3. **Expected:** Shows top slots as chips (e.g., "Wed 9 PM · 2.1K avg views · 5 posts")

### 7.4 Empty state
1. Switch to a brand with no posting history
2. Open Best Times panel
3. **Expected:** Shows "Not enough data — need at least 3 posts per time slot"

### 7.5 Platform/window switching
1. Change platform dropdown in Best Times panel
2. Change window selector (7d/14d/30d)
3. **Expected:** Results update without page reload

---

## 8. Performance Check

### 8.1 Recompute timing
```sql
\timing on
SELECT recompute_all_time_slot_scores(30);
```
**Expected:** Completes in < 2 seconds for typical workloads (< 1000 posts).

### 8.2 Query timing
```sql
\timing on
SELECT * FROM get_best_time_slots('<brand_id>'::uuid, 'youtube', 30, 5);
```
**Expected:** < 50ms.
