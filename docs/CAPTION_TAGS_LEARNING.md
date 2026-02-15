# Caption/Tags Learning Loop

> **Phase:** Roadmap #20  
> **Status:** Implemented  
> **Date:** 2026-02-16  
> **Migrations:** `20260317001_caption_tags_learning.sql`, `20260317002_caption_tags_hardening.sql`, `20260317003_winning_patterns_cache.sql`

---

## Overview

The Caption/Tags Learning Loop stores metadata versions, correlates them with engagement metrics, and biases future AI generation toward high-performing patterns. It also enables A/B variant testing at the job level and maintains a nightly-refreshed cache of winning patterns (top hooks, hashtags, CTAs, length stats).

**Level 3 scope** — no ML models, no auto-optimization engines. The system captures data, surfaces performance, lets the generator fetch exemplars + winning patterns; humans decide when to intervene.

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│            generate-post-metadata                │
│                                                  │
│  1. Fetch exemplars (top performers for brand/   │
│     platform/vibe)                               │
│  2. Check A/B variant assignment for job         │
│  3. Inject exemplars + variant style into prompt │
│  4. Generate metadata via OpenAI                 │
│  5. Store via upsert_post_metadata (existing)    │
│  6. Record version in post_metadata_versions     │
└──────────────┬──────────────────┬────────────────┘
               │                  │
     ┌─────────▼────────┐  ┌─────▼──────────────────┐
     │ post_metadata_    │  │ post_metadata_variant_ │
     │ versions          │  │ assignments            │
     │ (append-only)     │  │ (A/B test config)      │
     └─────────┬─────────┘  └────────────────────────┘
               │
     ┌─────────▼─────────────────────────────────────┐
     │ v_post_variant_performance                     │
     │ (joins versions ↔ v_post_metrics_latest)       │
     │                                                │
     │ v_top_metadata_patterns                        │
     │ (aggregated top performers by brand/platform/  │
     │  vibe for exemplar retrieval)                  │
     └────────────────────────────────────────────────┘
```

---

## Schema Design

### Table: `post_metadata_versions`

Append-only version history for every metadata generation/edit event.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `gen_random_uuid()` |
| `post_id` | UUID FK → posts.id | ON DELETE CASCADE |
| `platform` | TEXT | youtube_shorts, tiktok, etc. |
| `version_number` | INTEGER | Auto-incremented per (post_id, platform) |
| `version_type` | TEXT | CHECK: `ai`, `edit`, `regenerate` |
| `variant_key` | TEXT | NULL = control, else A/B variant name |
| `fields` | JSONB | Full metadata snapshot (title, description, tags, etc.) |
| `generation_model` | TEXT | e.g. `gpt-4o` |
| `schema_version` | INTEGER | DEFAULT 1 |
| `idempotency_key` | TEXT UNIQUE | Prevents duplicate version recordings |
| `created_at` | TIMESTAMPTZ | DEFAULT `now()` |
| `created_by` | TEXT | `scheduler`, `manual`, `api` |

**Indexes:**
- `(post_id, platform, version_number)` — ordered history lookup
- `(post_id, platform, version_type)` — filter by type
- `idempotency_key` UNIQUE — dedup guard

### Table: `post_metadata_variant_assignments`

Configures A/B test variants for job-level experiments.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `gen_random_uuid()` |
| `job_id` | UUID FK → jobs.id | ON DELETE CASCADE |
| `platform` | TEXT | Scope to one platform |
| `variant_key` | TEXT | Human name: `punchy_hashtags`, `long_description` |
| `style_instructions` | TEXT | Extra prompt text injected into user prompt |
| `is_active` | BOOLEAN | DEFAULT true |
| `created_at` | TIMESTAMPTZ | DEFAULT `now()` |

**UNIQUE:** `(job_id, platform, variant_key)`

### View: `v_post_variant_performance`

Joins metadata versions with latest metrics to produce per-version performance scores.

```sql
SELECT
    v.id AS version_id,
    v.post_id,
    v.platform,
    v.version_number,
    v.version_type,
    v.variant_key,
    v.fields,
    v.created_at AS version_created_at,
    p.brand_id,
    j.vibe_preset,
    m.views,
    m.likes,
    m.comments,
    m.shares,
    -- Reuses #19 scoring formula
    COALESCE(m.views, 0) + 5 * COALESCE(m.likes, 0) 
      + 10 * COALESCE(m.comments, 0) + 10 * COALESCE(m.shares, 0) 
    AS performance_value
FROM post_metadata_versions v
JOIN posts p ON p.id = v.post_id
LEFT JOIN jobs j ON j.id = p.job_id
LEFT JOIN v_post_metrics_latest m 
    ON m.post_id = v.post_id AND m.platform = v.platform;
```

### View: `v_top_metadata_patterns`

Aggregates top-performing metadata across posts, grouped by brand/platform/vibe. Used by `get_generation_exemplars` RPC.

```sql
-- Ranks metadata versions by performance_value per (brand_id, platform, vibe_preset)
-- Returns top 3 per group for exemplar injection
```

---

## Scoring Formula

Reuses the same weighted engagement formula from #19 (Time Slot Scoring):

$$\text{performance\_value} = \text{views} + 5 \cdot \text{likes} + 10 \cdot \text{comments} + 10 \cdot \text{shares}$$

This is computed in the `v_post_variant_performance` view. Zero-metric posts score 0.

---

## RPCs

### `record_post_metadata_version(p_post_id, p_platform, p_version_type, p_variant_key, p_fields, p_generation_model, p_schema_version, p_idempotency_key, p_created_by)`

Inserts an append-only version row. Auto-calculates `version_number` as `MAX(version_number) + 1` for the `(post_id, platform)` pair. No-ops on idempotency conflict.

### `get_post_metadata_versions(p_post_id, p_platform)`

Returns all versions for a post/platform pair, ordered by `version_number DESC`. Includes performance data from the view.

### `get_variant_performance(p_job_id, p_platform)`

Returns variant-level aggregates: for each `variant_key` assigned to posts in this job, compute average `performance_value`, count of posts, min/max performance.

### `assign_ab_variant(p_job_id, p_platform, p_variant_key, p_style_instructions)`

Inserts or updates a variant assignment for a job. Uses `ON CONFLICT DO UPDATE` for the UNIQUE constraint.

### `get_generation_exemplars(p_brand_id, p_platform, p_vibe_preset, p_limit)`

Returns top-N metadata snapshots (from `v_top_metadata_patterns`) for the given brand/platform/vibe. These are injected into the generation prompt as style guidance. Default limit = 3.

---

## Generator Integration

### Hook Points in `generate-post-metadata/index.ts`

1. **After job data fetch (step 6):** Call `get_generation_exemplars` with brand_id, platform, vibe_preset.

2. **After job data fetch:** Check `post_metadata_variant_assignments` for any active variant assigned to this job/platform. Pick the first active one (deterministic — ordered by `created_at`).

3. **In `buildUserPrompt()`:** Add new optional parameters `exemplars` and `variantInstructions`. If exemplars exist, append a section:
   ```
   TOP-PERFORMING EXAMPLES (for style reference only — do NOT copy):
   Example 1: { title: "...", description: "...", tags: [...] }
   Example 2: ...
   
   Use these as inspiration for tone, structure, and tag strategy.
   ```
   If variant instructions exist, append:
   ```
   A/B VARIANT INSTRUCTIONS:
   {style_instructions}
   ```

4. **After successful upsert (step 12):** Call `record_post_metadata_version` with the validated metadata, variant_key (if any), and appropriate idempotency key.

### Version Tracking

- `version_type = 'ai'` when generated by the AI pipeline
- `version_type = 'regenerate'` when force-regenerated
- `version_type = 'edit'` when saved from the UI

### Idempotency Keys

- AI generation: `{postId}:meta-version:{platform}:ai:{timestamp_ms}`
- Edit: `{postId}:meta-version:{platform}:edit:{timestamp_ms}`

---

## Calendar UI Integration

### Version History Panel

Below the existing metadata fields, a collapsible "Version History" section shows:
- Version number, type badge (AI/Edit/Regen), variant key (if any)
- Timestamp
- Performance value (if metrics exist)
- Click to expand and see the full fields snapshot

### A/B Controls

In the metadata section header (next to status badge):
- Variant badge showing current variant_key (if assigned)
- Admin can see which variant this post is running

### Performance Overlay

When a post has metrics and metadata versions:
- Show performance_value next to the status badge
- Color-coded: green (>median), yellow (around median), red (<median)

---

## Constraints

- No automatic re-generation — humans trigger regeneration
- No ML scoring — uses simple weighted formula
- Exemplars are reference only — prompt says "do NOT copy"
- A/B variants are job-scoped, not post-scoped
- Version history is append-only — no deletions
- Maximum 3 exemplars per generation call (configurable via RPC param)

---

## Dependencies

- `post_metadata` table (existing — #14)
- `v_post_metrics_latest` view (existing — #18)
- `posts` table with `job_id`, `brand_id` (existing)
- `jobs` table with `vibe_preset` (existing)
- `generate-post-metadata` edge function (existing — modified)
- Calendar UI (existing — extended)

---

## Winning Patterns Cache

### Overview

A derived cache table refreshed nightly via pg_cron. Extracts aggregate patterns from top-performing metadata versions and injects them into the generation prompt alongside exemplars.

```
┌──────────────────────────────────────────────────────┐
│  recompute_all_winning_patterns (pg_cron 03:00 UTC)  │
│                                                      │
│  For each (brand_id, platform, vibe_preset) combo:   │
│    1. Get top 50 versions by performance_value       │
│    2. Extract hooks (first 80 chars of title/caption)│
│    3. Normalize hashtags, count frequency (≥2)       │
│    4. Regex-extract CTAs (subscribe, like, follow…)  │
│    5. Compute length stats (avg title/desc/tag count)│
│    6. UPSERT into winning_metadata_patterns          │
│    7. Also compute brand-wide (NULL vibe) rollup     │
└──────────────┬───────────────────────────────────────┘
               │
     ┌─────────▼─────────────────────────────────────┐
     │ winning_metadata_patterns                      │
     │ (brand_id, platform, vibe_preset, window_days) │
     │                                                │
     │ top_hooks JSONB       [{hook, perf}, ...]      │
     │ top_hashtags JSONB    [{tag, cnt, avg_perf}]    │
     │ top_ctas JSONB        [{cta, cnt}]              │
     │ length_stats JSONB    {avg_title, avg_desc, …}  │
     └────────────────────────────────────────────────┘
               │
     ┌─────────▼─────────────────────────────────────┐
     │ get_winning_patterns(brand, platform, vibe)    │
     │                                                │
     │ Cascade: exact vibe → brand-wide NULL vibe     │
     │ Returns cached row for prompt injection        │
     └────────────────────────────────────────────────┘
```

### Table: `winning_metadata_patterns`

Derived cache, refreshed nightly. One row per (brand_id, platform, vibe_preset, window_days).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `gen_random_uuid()` |
| `brand_id` | UUID FK → brands.id | ON DELETE CASCADE |
| `platform` | TEXT | youtube_shorts, tiktok, etc. |
| `vibe_preset` | TEXT | NULL = brand-wide aggregate |
| `window_days` | INTEGER | DEFAULT 30 |
| `top_hooks` | JSONB | Array of `{hook, perf}` — top 5 opening lines |
| `top_hashtags` | JSONB | Array of `{tag, cnt, avg_perf}` — hashtags used ≥2 times |
| `top_ctas` | JSONB | Array of `{cta, cnt}` — CTA phrases extracted via regex |
| `length_stats` | JSONB | `{avg_title_len, avg_desc_len, avg_tag_count}` |
| `sample_count` | INTEGER | How many versions contributed |
| `avg_performance` | NUMERIC | Average performance_value of contributing versions |
| `computed_at` | TIMESTAMPTZ | DEFAULT `now()` |

**UNIQUE:** `(brand_id, platform, vibe_preset, window_days)` — UPSERT target

### RPCs

#### `recompute_winning_patterns(p_brand_id, p_platform, p_vibe_preset, p_window_days)`

Computes patterns for a single brand/platform/vibe combo:
1. Creates temp table of top 50 versions (by performance_value, within window)
2. Extracts hooks: `LEFT(fields->>'title', 80)` or `LEFT(fields->>'caption', 80)` — top 5 by perf
3. Extracts hashtags: normalizes from `fields->'hashtags'` + `fields->'tags'` arrays, counts frequency, keeps those with ≥2 uses
4. Extracts CTAs: regex match on `fields->>'description'` for keywords (subscribe, like, follow, share, comment, bell, link in bio, watch till end)
5. Computes length_stats: avg title length, avg description length, avg tag count
6. UPSERTs result into `winning_metadata_patterns`

#### `recompute_all_winning_patterns()`

Iterates all distinct (brand_id, platform, vibe_preset) combinations from `v_post_variant_performance` that have metric data, plus brand-wide (NULL vibe) rollups. Calls `recompute_winning_patterns` for each.

#### `get_winning_patterns(p_brand_id, p_platform, p_vibe_preset, p_window_days)`

Returns cached winning patterns with fallback cascade:
1. Try exact match (brand_id, platform, vibe_preset, window_days)
2. If no rows: fall back to brand-wide (vibe_preset IS NULL)
3. Returns single row or empty

### Cron Schedule

```sql
-- pg_cron: nightly at 03:00 UTC
SELECT cron.schedule('recompute-winning-patterns', '0 3 * * *',
  'SELECT recompute_all_winning_patterns()');
```

### Generator Integration

In `buildUserPrompt()`, after the negative exemplars section:

```
WINNING PATTERNS (derived from your top-performing posts):
• Top hooks: "Did you know…", "The truth about…", …
• Top hashtags: #mystery (12 uses), #truecrime (9), …
• Common CTAs: subscribe (8), like (5)
• Optimal lengths: title ~48 chars, description ~180 chars, ~8 tags
```

Fetched in `generateForPost()` step 7a-iii via `get_winning_patterns` RPC. Non-fatal — if fetch fails, generation continues without patterns.
