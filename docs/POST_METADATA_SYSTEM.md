# Post Metadata System — Technical Design Spec

> **Version:** 2.1  
> **Date:** February 23, 2026  
> **Status:** ✅ Production (Strategy + Time-Aware + Per-Platform Optimization)

---

## Overview

AI-generated, platform-specific metadata (title, description, tags, hashtags, etc.) for each scheduled post. Runs asynchronously after video generation completes, stores structured data per (post, platform), supports user editing with revision history, and feeds into the post-worker for automated publishing.

### v2.0 Enhancements (Feb 19, 2026)

- **Time-Awareness**: Parses `scheduled_at` to inject day-of-week and time-of-day context. Morning posts get energetic/fresh tone, evening gets atmospheric/reflective, night gets dark/intimate.
- **Strategy Intelligence**: Fetches top-performing strategies via `get_top_strategies` RPC. Probabilistic weighted selection by avg_engagement. 10 strategy types each inject specific prompt guidance (hook_first, emotional_arc, question_hook, list_format, controversy, fomo, storytelling, community, authority, trend_ride).
- **Strategy Binding**: Strategy type and time context sections added to the base prompt template before GPT generation.

### v2.1 — Facebook Reels Optimization (Feb 23, 2026)

- **Facebook caption tightened**: `PLATFORM_CONFIGS.facebook_reels` caption max reduced from 300 → 125 characters. Prompt now says "Think Twitter energy — punchy, raw, done" with 1 emoji max and 5 hashtags max.
- **Post-worker FB hard cap**: `FacebookReelsAdapter` now caps `rawCaption` to 300 characters (slices with `…`) before posting, and limits hashtags to 6 max. Prevents story descriptions (600-1000 chars) from leaking through as captions.
- **Root cause**: When AI metadata had no `caption` field (only `title` + `description`), the post-worker fell through to `post.description` — the full story text. The tighter prompt + hard cap both defend against this.
- **Exemplar learning is per-platform**: The `get_winning_patterns` and `get_exemplar_metadata` RPCs filter by `p_platform`, so each platform's AI prompt learns only from that platform's top performers. Facebook was in a chicken-and-egg trap (0 engagement → no exemplars → no learning).

---

## Architecture

```
worker-v1 (existing)
  └─ schedule step → schedule_post_idempotent() → posts row created
                                                      │
metadata-scheduler (NEW, cron every 2 min)            ▼
  └─ find_posts_needing_metadata()  ──────────► post_metadata row
       │                                        (status: not_started)
       ▼
  generate-post-metadata (NEW, Edge Function)
       │
       ├─ Fetch post + job + brand data
       ├─ Build platform-specific prompt
       ├─ GPT-4o (JSON mode) → structured metadata
       ├─ Validate against platform constraints
       └─ upsert_post_metadata() → status: ready
                                      │
post-worker (existing, modified)      ▼
  └─ Fetch final_metadata from post_metadata
     └─ Use fields for platform API call
```

**Orchestration Choice: Option B (Separate Scheduler)**

Rationale:
- Does NOT block video generation — metadata runs async after post creation
- Decoupled retry logic — metadata failures don't affect video pipeline
- Works for any post source (worker-v1, manual import, future flows)
- Same cron pattern as existing `schedule-jobs` and `schedule-posts`
- Metadata can be regenerated independently

---

## Database Schema

### Table: `post_metadata`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Default `gen_random_uuid()` |
| `post_id` | UUID FK → posts(id) | ON DELETE CASCADE |
| `platform` | TEXT NOT NULL | `youtube_shorts`, `tiktok`, `instagram_reels` |
| `status` | TEXT NOT NULL | `not_started` / `generating` / `ready` / `failed` / `edited` |
| `ai_metadata` | JSONB | Original AI-generated fields (immutable after generation) |
| `final_metadata` | JSONB | Active version — starts as copy of `ai_metadata`, updated on user edit |
| `generation_model` | TEXT | e.g. `gpt-4o` |
| `idempotency_key` | TEXT UNIQUE | `{post_id}:metadata:{platform}:v1` |
| `error` | TEXT | Last error message |
| `attempt_count` | INTEGER | Count of generation attempts |
| `created_at` | TIMESTAMPTZ | Row creation |
| `updated_at` | TIMESTAMPTZ | Auto-updated on any change |
| `generated_at` | TIMESTAMPTZ | When AI generation completed |
| `edited_at` | TIMESTAMPTZ | When user last edited |
| **UNIQUE** | `(post_id, platform)` | One metadata per post per platform |

### Table: `platform_field_constraints`

| Column | Type | Notes |
|--------|------|-------|
| `platform` | TEXT PK | Platform identifier |
| `fields` | JSONB | Constraint definitions per field |
| `updated_at` | TIMESTAMPTZ | |

**Seeded for:** `youtube_shorts`, `tiktok`, `instagram_reels`

---

## RPCs

| RPC | Purpose | Caller |
|-----|---------|--------|
| `upsert_post_metadata(post_id, platform, ai_metadata, model, idempotency_key)` → UUID | Idempotent store. Preserves user edits if `status='edited'`. | generate-post-metadata |
| `get_post_metadata(post_id)` → TABLE | All metadata rows for a post | Calendar UI, post-worker |
| `update_post_metadata_fields(post_id, platform, fields)` → void | Merge user edits into `final_metadata`, set `status='edited'` | Calendar UI |
| `find_posts_needing_metadata(limit)` → TABLE | Posts missing or needing metadata regeneration | metadata-scheduler |
| `claim_metadata_generation(post_id, platform)` → BOOLEAN | Atomic claim to prevent double-generation | generate-post-metadata |
| `get_calendar_posts_with_metadata(start, end, brand_id?)` → TABLE | Calendar view with metadata status + fields | Calendar UI / postQueue.js |

---

## Edge Functions

### `generate-post-metadata` (NEW)

- **Trigger:** Called by metadata-scheduler, or manually via API
- **Input:** `{ post_id, platform?, force? }`
- **Flow:**
  1. Fetch post → `job_id`, `platform`, `brand_id`
  2. Fetch job → `title`, `story_text`, `vibe_preset`
  3. Fetch brand config (optional, for brand voice)
  4. Check idempotency — skip if already `ready`/`edited` and not `force`
  5. `claim_metadata_generation()` — atomic lock
  6. Build prompt with platform constraints
  7. Call GPT-4o with `response_format: { type: 'json_object' }`
  8. Validate response against `platform_field_constraints`
  9. `upsert_post_metadata()` — store result
  10. Record cost via `record_api_usage()`
- **Output:** `{ success, post_id, platform, status }`
- **Idempotency key:** `{post_id}:metadata:{platform}:v1`

### `metadata-scheduler` (NEW)

- **Trigger:** pg_cron every 2 minutes
- **Flow:**
  1. Check kill switch
  2. `find_posts_needing_metadata(limit=20)`
  3. For each: call `generate-post-metadata` via HTTP
  4. Return summary `{ processed, succeeded, failed }`

---

## Orchestration Flow

1. **Video completes** → worker-v1 `executeScheduleStep()` → `schedule_post_idempotent()` → post row created with `status='scheduled'`
2. **Metadata scheduler** (cron, every 2 min) → `find_posts_needing_metadata()` finds posts where:
   - `posts.status IN ('scheduled')` AND `posts.scheduled_at > NOW() - interval '7 days'`
   - AND (`post_metadata` row doesn't exist OR `status IN ('not_started', 'failed')` with `attempt_count < 3`)
3. **For each post:** scheduler invokes `generate-post-metadata({ post_id, platform })`
4. **Metadata generator:** Claims → builds prompt → GPT-4o → validates → stores → marks `ready`
5. **Post-worker** (at posting time): Fetches `post_metadata` → uses `final_metadata` fields → posts to platform
   - If metadata missing: **fail as retryable** with error `'metadata_not_ready'` (next retry, scheduler will have generated it)
   - Justification: On-the-fly generation adds unpredictable latency/cost; the scheduler should have already handled it; retryable failure gives it time to catch up

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| OpenAI timeout/500 | `status='failed'`, `error` logged, `attempt_count++`. Scheduler retries next cycle. |
| Invalid JSON response | Same as above — retry with attempt_count tracking. |
| Max attempts (3) | `status='failed'` permanently. Visible in calendar for manual action. |
| Cost budget exceeded | Generation skipped, logged. No metadata = post-worker retries later. |
| Kill switch active | Entire scheduler skips cycle. |
| User edited metadata | `status='edited'`. Regeneration updates `ai_metadata` only (preserves `final_metadata`). |
| Post deleted | `ON DELETE CASCADE` removes metadata rows automatically. |

---

## RLS Plan

Matches existing project pattern (open for dev/demo mode):

| Role | post_metadata | platform_field_constraints |
|------|--------------|---------------------------|
| `anon` | SELECT, INSERT, UPDATE, DELETE | SELECT |
| `service_role` | Full access (implicit) | Full access (implicit) |

For production: restrict `anon` to SELECT on `post_metadata` + UPDATE only on `final_metadata`/`status`/`edited_at`.

---

## Posting Integration (post-worker changes)

**Before posting each post:**
```ts
const { data: metadata } = await supabase
  .from('post_metadata')
  .select('final_metadata, status')
  .eq('post_id', post.id)
  .eq('platform', post.platform)
  .single();

if (!metadata || !['ready', 'edited'].includes(metadata.status)) {
  // Fail as retryable — scheduler will generate metadata
  throw new RetryableError('metadata_not_ready', 'Post metadata not yet generated');
}

// Use metadata.final_metadata for API call
const { title, description, tags, hashtags, ... } = metadata.final_metadata;
```

**Backwards compatible:** If no `post_metadata` row exists and post was created before this system, post-worker should fall back gracefully (use post title, empty description).

---

## Platform Metadata Schemas

### YouTube Shorts
```json
{
  "title": "The Seventh Shopper | Counting Horror #shorts",
  "description": "Six strangers shelter in a convenience store during a storm. But the headcount keeps coming back as seven.\n\nSubscribe for more horror stories.",
  "tags": ["horror", "shorts", "scary", "counting horror", "creepy story"],
  "category_id": 24,
  "made_for_kids": false
}
```

### TikTok
```json
{
  "caption": "They counted six people. There were seven. 😰 #horror #creepy #countinghorror #scarystory #storytime",
  "hashtags": ["horror", "creepy", "countinghorror", "scarystory", "storytime"],
  "cover_text": "There Were Seven"
}
```

### Instagram Reels
```json
{
  "caption": "Six strangers. One store. Seven headcounts.\n\nThey counted again. And again. The number never changed.\n\nWho is the seventh?\n\n#horror #creepy #countinghorror #scarystory #paranormal",
  "hashtags": ["horror", "creepy", "countinghorror", "scarystory", "paranormal"],
  "alt_text": "Dark convenience store interior with shadowy figures during a storm"
}
```

### Facebook Reels
```json
{
  "caption": "Six strangers. Seven shadows.\nWho was the extra one? 😰",
  "hashtags": ["horror", "creepy", "countinghorror", "scarystory", "paranormal"],
  "title": "The Seventh Shopper"
}
```
> **Limits:** Caption ≤ 125 chars (prompt enforced), description hard-capped at 300 chars (post-worker enforced), max 5 hashtags in prompt / 6 in post-worker.

### Threads
```json
{
  "caption": "They counted six. The number came back seven. Every. Single. Time. 😰",
  "hashtags": ["horror", "creepy", "shortstory"]
}
```

---

## Related Files

| File | Purpose |
|------|---------|
| `supabase/migrations/20260212_post_metadata_system.sql` | Tables, RPCs, RLS, constraints |
| `supabase/functions/generate-post-metadata/index.ts` | AI metadata generator |
| `supabase/functions/metadata-scheduler/index.ts` | Cron scheduler |
| `docs/POST_METADATA_SYSTEM.md` | This document |
