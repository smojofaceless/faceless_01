# AI Learning Pipeline — Improvement Roadmap

> Audit Date: March 8, 2026
> Based on: 2-week comparison (Feb 20–22 vs Mar 6–8) of Stories That Stalk brand

---

## Current State (Baseline)

| Metric | 2 Weeks Ago | Now | Status |
|---|---|---|---|
| Avg description length | 829 chars | 220 chars | ✅ Improved |
| Raw narration fallbacks (>400ch) | 75% of posts | 10% of posts | ✅ Improved |
| Avg tags per post | 2.4 | 4.6 | ✅ Improved |
| Posts with zero tags | 70% | 40% | ⚠️ Partial (Threads still 0) |
| Threads descriptions | 1,054 ch avg (raw story) | 149 ch avg (proper teaser) | ✅ Improved |
| Vibe preset rotation | Static (manual config) | Static (manual config) | ❌ No learning |
| AI self-awareness of progress | None | None | ❌ No visibility |

---

## Phase 1 — Quick Wins
> Target: Immediate / 1-2 sessions
> Impact: Fix visible bugs in the learning pipeline

### 1.1 Fix Threads Tag Injection
- **Problem:** Threads posts consistently get 0 tags across all posts
- **Root Cause:** Two bugs in `post-worker/index.ts`:
  1. Threads metadata mapping branch didn't extract `postTags` from `md.hashtags` (unlike every other platform)
  2. `ThreadsAdapter.post()` received tags but never appended them to the caption text
- **Fix:** Added `postTags` extraction in metadata mapping + hashtag append logic in ThreadsAdapter (up to 5 tags, appended as `\n\n#tag1 #tag2`)
- **Expected Result:** Threads posts get 3-5 relevant hashtags
- **Status:** `[x] Complete (March 8, 2026)`

### 1.2 Harden Raw Narration Fallback
- **Problem:** 2/20 recent posts still dumped 960-char raw story narration as description
- **Root Cause:** Three fallback paths in `post-worker/index.ts` (metadata permanently failed, no metadata row, metadata lookup error) all left `postDescription` as the raw story text with zero truncation
- **Fix:** Added a fallback description guard after the metadata try/catch: when `metadata_source` starts with `'fallback'` and description exceeds 200 chars, truncates to the last sentence boundary within 200 chars (or hard-truncates with `...`)
- **File:** `supabase/functions/post-worker/index.ts`
- **Expected Result:** Zero posts with >400ch raw narration descriptions
- **Status:** `[x] Complete (March 8, 2026)`

### 1.3 Auto-Flag Raw Narration as Negative Exemplar
- **Problem:** Posts with raw narration fallbacks that accidentally get views are treated as positive examples
- **Root Cause:** `get_generation_exemplars` had no content quality filter — long-text versions could be positive exemplars. `get_negative_exemplars` only queried `post_metadata_versions`, missing fallback posts entirely (no version rows exist when metadata fails).
- **Fix:** New migration `20260402002_exemplar_quality_filter.sql`:
  1. **`get_generation_exemplars`** — added text length filter: versions where primary text field > 400 chars are excluded from positive exemplar pool
  2. **`get_negative_exemplars`** — expanded to 3 sources: (A) low-performance AI versions (original), (B) fallback posts from `posts` table where `platform_content.metadata_source LIKE 'fallback%'`, (C) AI versions with text > 400 chars regardless of performance — all deduplicated by `post_id`
- **File:** `supabase/migrations/20260402002_exemplar_quality_filter.sql`
- **Expected Result:** Raw narration posts never pollute the exemplar pool
- **Status:** `[x] Complete (March 8, 2026)`

---

## Phase 2 — Smarter Learning
> Target: Next sprint
> Impact: Close the remaining learning gaps

### 2.1 Platform-Aware Length Targets
- **Problem:** `length_stats` prompt text said generic "Optimal lengths" without emphasizing platform specificity
- **Discovery:** `recompute_winning_patterns` already computes length_stats per platform+brand+vibe — the DB was already per-platform. The issue was the prompt language didn't make this explicit.
- **Fix:** Updated `buildUserPrompt` length_stats section to include platform name (e.g., "Optimal lengths for Instagram Reels: description/caption ~120 chars") and added emphasis that these come from top-performing posts on this specific platform.
- **File:** `supabase/functions/generate-post-metadata/index.ts` — `buildUserPrompt()`
- **Expected Result:** Each platform gets tailored description/title length guidance
- **Status:** `[x] Complete (March 8, 2026)`

### 2.2 Vibe Preset Auto-Rotation
- **Problem:** Vibe preset is static in brand config — the "urban legend may not be connecting" insight is shown but never acted on
- **Discovery:** Most of the system was already built:
  - `brand_templates` table stores per-preset weights
  - `campaignManager._selectPreset()` does weighted random selection during campaign creation
  - `recompute_preset_weights()` RPC rebalances weights proportionally to performance (min weight=10 for exploration)
  - UI has preset weight sliders and "Apply AI-suggested weights" button
- **Root Cause:** `recompute_preset_weights()` existed but was **never called automatically** — only via manual UI trigger
- **Fix:** New migration `20260402003_auto_preset_weight_cron.sql`:
  1. Created `recompute_all_preset_weights()` — iterates all brands with 2+ templates and calls `recompute_preset_weights()` for each
  2. Scheduled nightly pg_cron job at 03:15 UTC (after winning patterns refresh at 03:00)
- **Files:** `supabase/migrations/20260402003_auto_preset_weight_cron.sql`
- **Expected Result:** Low-performing vibes naturally get less usage; high performers dominate — weights auto-update nightly
- **Status:** `[x] Complete (March 8, 2026)`

### 2.3 Mandatory Tag Injection
- **Problem:** `buildUserPrompt` lists winning tags as suggestions, but GPT can ignore them
- **Fix:** Changed the prompt from `"High-engagement tags: #horror, #creepystory..."` to include a mandatory instruction: `"You MUST include at least 3 of these proven tags in your hashtags array: #horror, #creepystory, #urbanlegend..."` — top 6 winning tags are listed as mandatory picks (at least 3 must be used)
- **File:** `supabase/functions/generate-post-metadata/index.ts` → `buildUserPrompt()` patterns section
- **Expected Result:** Tag alignment jumps from ~3/8 to 6/8+ winning tags per post
- **Status:** `[x] Complete (March 8, 2026)`

---

## Phase 3 — Closed-Loop Intelligence
> Target: Future roadmap
> Impact: Self-improving system with full visibility

### 3.1 Learning Delta Dashboard
- **Problem:** The Deep Dive shows "What Could Improve" but never shows "What improved since last time"
- **Fix:** Add a "Learning Progress" section to the AI Intelligence page that shows week-over-week deltas:
  - Description length trend (was 829ch → now 220ch)
  - Tag alignment trend
  - Hook pattern shift
  - Top-performing vibe this week vs last
- **Files:** New JS module `js/pages/ai-intelligence/learning-delta.js`, HTML section, CSS
- **Expected Result:** Operator can see the AI improving in real-time without running manual audits
- **Status:** `[x] Complete (March 8, 2026)` — Created `js/pages/ai-intelligence/learning-delta.js` module showing week-over-week deltas for description length, tag count, fallback rate, zero-tag rate, and avg performance score. Wired into AI Learning tab in `pages/ai-intelligence.html` and loaded via `init.js`.
- **Problem:** `recompute_winning_patterns` runs on a schedule — new post metrics don't immediately influence the next generation
- **Fix:** Add a Postgres trigger or edge function hook: after metrics are inserted/updated, recompute winning patterns for that brand/platform
- **Status:** `[x] Complete (March 8, 2026)` — Created migration `20260402004_metrics_recompute_trigger.sql` with: (1) `winning_patterns_staleness` table tracking which brand/platform combos need refresh, (2) trigger on `post_metrics` INSERT that marks combos as stale, (3) `refresh_stale_patterns()` RPC called by `generate-post-metadata` before fetching patterns — recomputes inline if stale.

### 3.3 Automated A/B Vibe Testing
- **Problem:** When a vibe underperforms, the system suggests "consider testing alternatives" but doesn't test
- **Fix:** Extend the existing `post_metadata_variant_assignments` system to schedule periodic A/B tests:
  1. Pick the dominant vibe and a challenger vibe
  2. Generate the same story with both vibes
  3. Compare metrics after 48 hours
  4. Auto-update vibe weights based on results
- **Expected Result:** Continuous vibe optimization without manual intervention
- **Status:** `[x] Complete (March 8, 2026)` — Created migration `20260402005_ab_vibe_testing.sql` with: (1) `ab_vibe_tests` table tracking test state + results, (2) `schedule_ab_vibe_test()` picks dominant + challenger vibes, assigns variant instructions to next 6 pending posts alternating control/challenger, (3) `evaluate_ab_vibe_tests()` compares perf after 48h with 10% significance threshold, auto-adjusts weights (±5-15 points), extends evaluation window by 24h if insufficient data, (4) `run_ab_vibe_testing()` orchestrator called by pg_cron daily at 04:00 UTC.

---

## Implementation Priority

```
Phase 1 (Now)          Phase 2 (Next)              Phase 3 (Future)
─────────────         ─────────────────           ──────────────────
1.1 Threads tags      2.1 Platform lengths        3.1 Learning delta UI
1.2 Fallback fix      2.2 Vibe auto-rotation      3.2 Recompute trigger
1.3 Neg exemplar      2.3 Mandatory tags          3.3 A/B vibe testing
```

## Files Likely Touched

| File | Phases |
|---|---|
| `supabase/functions/post-worker/index.ts` | 1.1, 1.2 |
| `supabase/functions/generate-post-metadata/index.ts` | 2.1, 2.3 |
| `supabase/migrations/20260402002_exemplar_quality_filter.sql` | 1.3 |
| `supabase/migrations/20260402003_auto_preset_weight_cron.sql` | 2.2 |
| `supabase/migrations/` (new) | 3.2, 3.3 |
| `server_clean.js` | — (not needed; campaign manager already handles weighted selection) |
| `js/pages/ai-intelligence/` | 3.1 |
| `brands/` config files | 2.2 |
