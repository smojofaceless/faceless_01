# System Hardening Batch — Smoke Tests

> **Version:** 1.0  
> **Date:** February 19, 2026  
> **Migration:** `20260319020_system_hardening_batch.sql` + `20260319021_fix_ab_variant_assignment.sql`

---

## Quick Run

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY = "your-service-role-key"
node scripts/smoke-test-system-hardening.js
```

**Expected:** 44 passed, 0 failed, 1 skipped

The 1 skip is `cron.job` table not accessible via REST API (expected — pg_cron schema is internal).

---

## Test Inventory

| # | Test | What It Checks |
|---|------|----------------|
| 1 | Data Cleanup Cron | `cleanup_old_job_logs`, `cleanup_old_lifecycle_events`, `cleanup_old_post_metrics` RPCs callable |
| 2 | Winning Patterns Multi-Window | `recompute_winning_patterns` accepts 7/14/30-day windows, rows written to `winning_metadata_patterns` |
| 3 | Recency Decay | 30-day recompute succeeds, `computed_at` is fresh |
| 4 | Story Uniqueness | `check_story_uniqueness` returns `is_unique=true`, `score=0.95` for novel hash, 0 collisions |
| 5 | Sweep Dead Posts | `sweep_dead_posts` returns integer count |
| 6 | Cross-Platform View | `v_cross_platform_performance` queryable, has platform/perf_score/views columns |
| 7 | Strategy Tables | `platform_strategies` has ≥20 rows across 6 platforms; `post_strategies` table exists; `v_strategy_performance` view accessible |
| 8 | Strategy RPCs | `get_top_strategies` returns array; `assign_post_strategy` exists (tested via FK violation) |
| 9 | A/B Variant Assignment | `auto_assign_ab_variants` returns integer |
| 10 | Visual Performance View | `v_visual_performance` queryable |
| 11 | Draft RPCs | `promote_draft_to_scheduled` returns false for missing draft; `reject_draft` same |
| 12 | Alert Tables | `brand_alert_config` and `system_alert_config` tables exist |
| 13 | Edge Functions | All 7 scheduled/cron functions reachable (HTTP < 500) |
| 14 | worker-v1 | Deployed and reachable |

---

## Manual Verification Queries

### Check cron jobs (run in Supabase SQL Editor)
```sql
SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;
-- Expected: cleanup-old-data, recompute-winning-patterns, sweep-stale-leases, etc.
```

### Check platform strategies seeded
```sql
SELECT platform, COUNT(*) FROM platform_strategies GROUP BY platform ORDER BY platform;
-- Expected: facebook_reels=3, instagram_reels=5, threads=2, tiktok=3, x=2, youtube_shorts=5
```

### Check winning patterns computed
```sql
SELECT brand_id, platform, vibe_preset, window_days, sample_count, computed_at
FROM winning_metadata_patterns
ORDER BY computed_at DESC
LIMIT 10;
```

### Verify cross-platform view
```sql
SELECT platform, COUNT(*), ROUND(AVG(perf_score)) AS avg_perf
FROM v_cross_platform_performance
WHERE brand_id = '68a58afb-8c85-4d6d-9eec-144ab7e5f106'
GROUP BY platform;
```

### Test story uniqueness with a known hash
```sql
SELECT * FROM check_story_uniqueness(
  '68a58afb-8c85-4d6d-9eec-144ab7e5f106',
  'test_hash_12345',
  '00000000-0000-0000-0000-000000000001',
  0.6
);
-- Expected: is_unique=true, uniqueness_score=0.95, collision_count=0
```

---

## Frontend Verification

1. **AI Intelligence page** → "Cross-Platform & Strategy" tab → should render platform comparison table and strategy performance cards
2. **All pages** → Resize to mobile width (< 640px) → forms should stack, modals should go fullscreen, tab bars should scroll horizontally
3. **Dashboard** → Brand overview should load without N+1 queries (check Network tab — single bulk query instead of per-brand)
4. **Brands page** → Post counts should load from bulk queries

---

## Edge Function Code Verification

| Function | Key Change | How to Verify |
|----------|-----------|---------------|
| metrics-collector | Stub platforms skipped | Check logs: "Skipped N stub platform connections" |
| metrics-collector | Instagram token refresh | Watch for "Refreshed Instagram token" in logs on 401 |
| post-worker | Rate limiting | Check logs for "Rate limit delay: Xs for platform" |
| post-worker | Optimistic lock | Check logs for "Claimed post X via optimistic lock" |
| schedule-jobs | Alert webhooks | Configure a Discord webhook in `system_alert_config`, trigger kill switch |
| worker-v1 | Uniqueness enforcement | Generate a duplicate concept_hash, check for rejection in job logs |
| generate-post-metadata | Strategy injection | Check metadata prompt includes "STRATEGY:" section in job step logs |
| generate-post-metadata | Time awareness | Check metadata prompt includes "TIME CONTEXT:" section |
