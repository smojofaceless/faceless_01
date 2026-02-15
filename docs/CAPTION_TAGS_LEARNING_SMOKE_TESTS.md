# Caption/Tags Learning Loop — Smoke Tests

> **Phase:** Roadmap #20  
> **Date:** 2026-02-16  
> **Migration:** `20260317001_caption_tags_learning.sql`

---

## Prerequisites

- Migration `20260317001` deployed
- `generate-post-metadata` v3.0 deployed
- At least one post with `post_metadata` in `ready` status
- At least one post with `post_metrics` collected (for performance tests)

---

## 1. Version Recording

### 1a. Record AI version

```sql
SELECT record_post_metadata_version(
    '<post_id>'::UUID,
    'youtube_shorts',
    'ai',
    NULL,                    -- no variant
    '{"title":"Test Title","description":"Test desc","tags":["horror","scary"]}'::JSONB,
    'gpt-4o',
    1,
    'smoke-test:v1:ai:' || extract(epoch FROM now())::TEXT,
    'manual'
);
```

**Expected:** Returns version row with `version_number = 1`.

### 1b. Record edit version (same post)

```sql
SELECT record_post_metadata_version(
    '<post_id>'::UUID,
    'youtube_shorts',
    'edit',
    NULL,
    '{"title":"Edited Title","description":"Updated desc","tags":["horror","mystery"]}'::JSONB,
    NULL,
    1,
    'smoke-test:v1:edit:' || extract(epoch FROM now())::TEXT,
    'manual'
);
```

**Expected:** Returns version row with `version_number = 2`.

### 1c. Idempotency check

Re-run test 1a with the same idempotency key.

**Expected:** No error, no duplicate row. Returns existing version.

### 1d. Version history retrieval

```sql
SELECT * FROM get_post_metadata_versions('<post_id>'::UUID, 'youtube_shorts');
```

**Expected:** Returns 2 rows ordered by `version_number DESC` (edit first, then AI).

---

## 2. A/B Variant Assignment

### 2a. Assign variant to job

```sql
SELECT assign_ab_variant(
    '<job_id>'::UUID,
    'youtube_shorts',
    'punchy_hooks',
    'Use extremely short, punchy titles under 50 chars. Lead with action verbs.'
);
```

**Expected:** Row inserted into `post_metadata_variant_assignments` with `is_active = true`.

### 2b. Assign second variant

```sql
SELECT assign_ab_variant(
    '<job_id>'::UUID,
    'youtube_shorts',
    'long_description',
    'Write detailed descriptions over 300 chars. Include story context and multiple CTAs.'
);
```

**Expected:** Second row inserted. Two active variants for this job/platform.

### 2c. Upsert existing variant

```sql
SELECT assign_ab_variant(
    '<job_id>'::UUID,
    'youtube_shorts',
    'punchy_hooks',
    'Updated instructions: Use ALL CAPS for the first 3 words.'
);
```

**Expected:** Existing row updated (not duplicated). UNIQUE constraint on `(job_id, platform, variant_key)`.

### 2d. Variant lookup

```sql
SELECT * FROM post_metadata_variant_assignments
WHERE job_id = '<job_id>' AND platform = 'youtube_shorts' AND is_active = true
ORDER BY created_at;
```

**Expected:** 2 rows. First one (`punchy_hooks`) has updated style_instructions.

---

## 3. Performance Correlation

### 3a. View populates for posted content

```sql
SELECT post_id, platform, version_number, variant_key, 
       views, likes, comments, shares, performance_value
FROM v_post_variant_performance
WHERE post_id = '<posted_post_id>'
ORDER BY version_number DESC;
```

**Expected:** Rows with metrics joined. `performance_value = views + 5*likes + 10*comments + 10*shares`.

### 3b. Zero metrics handled gracefully

```sql
SELECT post_id, performance_value
FROM v_post_variant_performance
WHERE post_id = '<unposted_post_id>';
```

**Expected:** `performance_value = 0` (all COALESCE to 0).

### 3c. Variant performance aggregation

```sql
SELECT * FROM get_variant_performance('<job_id>'::UUID, 'youtube_shorts');
```

**Expected:** Per-variant aggregates: `variant_key`, `avg_performance`, `post_count`, `min_performance`, `max_performance`. Control group (`variant_key IS NULL`) shown as `_control`.

---

## 4. Exemplar Retrieval

### 4a. Get exemplars for brand/platform/vibe

```sql
SELECT * FROM get_generation_exemplars(
    '<brand_id>'::UUID,
    'youtube_shorts',
    'slow_creepy',
    3
);
```

**Expected:** Up to 3 rows with top-performing metadata `fields` JSONB, ordered by `performance_value DESC`. Only includes posts with `performance_value > 0`.

### 4b. Empty result for new brand

```sql
SELECT * FROM get_generation_exemplars(
    '00000000-0000-0000-0000-000000000000'::UUID,
    'youtube_shorts',
    'slow_creepy',
    3
);
```

**Expected:** Empty result set (no error).

### 4c. Limit respected

```sql
SELECT COUNT(*) FROM get_generation_exemplars('<brand_id>'::UUID, 'youtube_shorts', 'slow_creepy', 1);
```

**Expected:** At most 1 row.

---

## 5. Generator Integration (End-to-End)

### 5a. Generate with exemplars available

1. Ensure at least 1 version with metrics exists for the target brand/platform/vibe.
2. Trigger generation:
   ```bash
   curl -X POST https://ustmetegzisztqqcjigt.supabase.co/functions/v1/generate-post-metadata \
     -H "Content-Type: application/json" \
     -d '{"post_id":"<post_id>","platform":"youtube_shorts","force":true,"source":"manual"}'
   ```

**Expected:** 
- Generation succeeds (`status: ready`)
- New version recorded in `post_metadata_versions` with `version_type = 'ai'`
- Function logs show exemplar count fetched

### 5b. Generate with A/B variant

1. Assign a variant to the post's job (test 2a).
2. Force-regenerate metadata for a post in that job.

**Expected:**
- Generation succeeds
- Version recorded with `variant_key` matching the assigned variant
- Prompt includes the variant's style_instructions

### 5c. Generate without exemplars (new brand)

1. Use a brand with no prior posted content.
2. Trigger generation.

**Expected:** Generation succeeds normally (no exemplars injected). Version recorded with `variant_key = NULL`.

---

## 6. UI Integration

### 6a. Version history displays in modal

1. Open calendar → click a post with metadata.
2. Look for "Version History" section below metadata fields.

**Expected:** Collapsible section shows version entries with version number, type badge, timestamp.

### 6b. Performance badge shows

1. Open a posted item with metrics.

**Expected:** Performance value shown near status badge (color-coded).

### 6c. Version detail expands

1. Click a version entry in the history.

**Expected:** Expands to show full fields snapshot (title, description, tags, etc.).

---

## 7. RLS & Security

### 7a. Anon read access

```sql
-- As anon role
SELECT * FROM post_metadata_versions LIMIT 1;
SELECT * FROM post_metadata_variant_assignments LIMIT 1;
```

**Expected:** Both return rows (open read policy per project convention).

### 7b. Anon write access

```sql
-- As anon role
INSERT INTO post_metadata_versions (post_id, platform, version_type, fields)
VALUES ('<post_id>', 'youtube_shorts', 'ai', '{}'::JSONB);
```

**Expected:** Insert succeeds (open write policy per project convention).

---

## 8. Edge Cases

### 8a. Concurrent version recording

Two concurrent calls to `record_post_metadata_version` for the same post/platform should not produce duplicate `version_number` values.

**Expected:** Each gets a unique, sequential version_number due to sub-select + unique constraint.

### 8b. Post deletion cascades

```sql
-- Delete a test post
DELETE FROM posts WHERE id = '<test_post_id>';
```

**Expected:** All `post_metadata_versions` rows for that post are cascade-deleted.

### 8c. Job deletion cascades

```sql
-- Delete a test job
DELETE FROM jobs WHERE id = '<test_job_id>';
```

**Expected:** All `post_metadata_variant_assignments` for that job are cascade-deleted.
