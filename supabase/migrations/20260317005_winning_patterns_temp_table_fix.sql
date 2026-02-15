-- =============================================================================
-- Migration: 20260317005_winning_patterns_temp_table_fix.sql
-- Phase: Roadmap #20 — Fix temp table reuse in recompute_winning_patterns
-- =============================================================================
-- Fix: When recompute_all_winning_patterns calls recompute_winning_patterns
-- multiple times in one transaction, the temp table _wp_versions persists
-- (ON COMMIT DROP only fires at transaction end). Fix: DROP IF EXISTS first.
-- =============================================================================

CREATE OR REPLACE FUNCTION recompute_winning_patterns(
    p_brand_id    UUID,
    p_platform    TEXT,
    p_vibe_preset TEXT    DEFAULT NULL,
    p_window_days INTEGER DEFAULT 30
)
RETURNS TABLE (
    brand_id     UUID,
    platform     TEXT,
    vibe_preset  TEXT,
    sample_count INTEGER,
    computed_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
    v_top_hooks       JSONB;
    v_top_hashtags    JSONB;
    v_top_ctas        JSONB;
    v_length_stats    JSONB;
    v_sample_count    INTEGER;
    v_avg_perf        NUMERIC;
    v_computed        TIMESTAMPTZ := now();
BEGIN
    -- Drop any leftover temp table from previous call in same transaction
    DROP TABLE IF EXISTS _wp_versions;

    -- --------------------------------------------------------
    -- Gather top-performing versions within window
    -- --------------------------------------------------------
    CREATE TEMP TABLE _wp_versions ON COMMIT DROP AS
    SELECT
        vp.post_id,
        vp.fields,
        vp.performance_value,
        vp.version_created_at
    FROM v_post_variant_performance vp
    WHERE vp.brand_id = p_brand_id
      AND vp.platform = p_platform
      AND (p_vibe_preset IS NULL OR vp.vibe_preset = p_vibe_preset)
      AND vp.version_type IN ('ai', 'regenerate')
      AND vp.performance_value > 0
      AND vp.version_created_at >= now() - (p_window_days || ' days')::INTERVAL
    ORDER BY vp.performance_value DESC
    LIMIT 50;

    SELECT COUNT(*), COALESCE(ROUND(AVG(performance_value), 2), 0)
    INTO v_sample_count, v_avg_perf
    FROM _wp_versions;

    -- If no data, store empty row and return
    IF v_sample_count = 0 THEN
        INSERT INTO winning_metadata_patterns (
            brand_id, platform, vibe_preset, window_days,
            top_hooks, top_hashtags, top_ctas, length_stats,
            sample_count, avg_performance, computed_at
        ) VALUES (
            p_brand_id, p_platform, p_vibe_preset, p_window_days,
            '[]', '[]', '[]', '{}',
            0, 0, v_computed
        )
        ON CONFLICT (brand_id, platform, COALESCE(vibe_preset, ''), window_days)
        DO UPDATE SET
            top_hooks = '[]', top_hashtags = '[]', top_ctas = '[]',
            length_stats = '{}', sample_count = 0, avg_performance = 0,
            computed_at = v_computed;

        RETURN QUERY SELECT p_brand_id, p_platform, p_vibe_preset, 0, v_computed;
        RETURN;
    END IF;

    -- --------------------------------------------------------
    -- Extract top hooks (first ~80 chars of title or caption)
    -- --------------------------------------------------------
    SELECT COALESCE(jsonb_agg(hook_row ORDER BY hook_row->>'perf' DESC), '[]'::JSONB)
    INTO v_top_hooks
    FROM (
        SELECT DISTINCT ON (hook_text)
            jsonb_build_object(
                'hook', hook_text,
                'perf', v.performance_value,
                'post_id', v.post_id
            ) AS hook_row
        FROM _wp_versions v,
        LATERAL (
            SELECT LEFT(COALESCE(
                v.fields->>'title',
                v.fields->>'caption',
                ''
            ), 80) AS hook_text
        ) h
        WHERE h.hook_text != ''
        ORDER BY hook_text, v.performance_value DESC
        LIMIT 10
    ) hooks;

    -- --------------------------------------------------------
    -- Extract top hashtags/tags (normalized, aggregated)
    -- --------------------------------------------------------
    SELECT COALESCE(jsonb_agg(tag_row ORDER BY (tag_row->>'count')::INT DESC), '[]'::JSONB)
    INTO v_top_hashtags
    FROM (
        SELECT jsonb_build_object(
            'tag', LOWER(tag_val),
            'count', COUNT(*),
            'avg_perf', ROUND(AVG(v.performance_value), 1)
        ) AS tag_row
        FROM _wp_versions v,
        LATERAL jsonb_array_elements_text(
            CASE
                WHEN jsonb_typeof(v.fields->'hashtags') = 'array' THEN v.fields->'hashtags'
                WHEN jsonb_typeof(v.fields->'tags') = 'array' THEN v.fields->'tags'
                ELSE '[]'::JSONB
            END
        ) AS tag_val
        WHERE tag_val IS NOT NULL AND tag_val != ''
        GROUP BY LOWER(tag_val)
        HAVING COUNT(*) >= 2
        ORDER BY COUNT(*) DESC, AVG(v.performance_value) DESC
        LIMIT 20
    ) tags;

    -- --------------------------------------------------------
    -- Extract CTA phrases via regex matching
    -- --------------------------------------------------------
    SELECT COALESCE(jsonb_agg(cta_row ORDER BY (cta_row->>'count')::INT DESC), '[]'::JSONB)
    INTO v_top_ctas
    FROM (
        SELECT jsonb_build_object(
            'cta', cta_match,
            'count', COUNT(*)
        ) AS cta_row
        FROM _wp_versions v,
        LATERAL (
            SELECT (regexp_matches(
                LOWER(COALESCE(v.fields->>'description', '') || ' ' || COALESCE(v.fields->>'caption', '')),
                '(subscribe|like (?:and |& )?(?:share|comment)|follow (?:for |us )?(?:more)?|share (?:this|with)|comment (?:below|your|what)|turn on (?:notifications|the bell)|hit (?:the )?(?:bell|like)|don''t forget to|link in (?:bio|description)|watch (?:till|until|to) (?:the )?end)',
                'gi'
            ))[1] AS cta_match
        ) cta
        WHERE cta.cta_match IS NOT NULL
        GROUP BY cta_match
        ORDER BY COUNT(*) DESC
        LIMIT 10
    ) ctas;

    -- --------------------------------------------------------
    -- Compute length statistics
    -- --------------------------------------------------------
    SELECT jsonb_build_object(
        'avg_title_len', COALESCE(ROUND(AVG(LENGTH(v.fields->>'title')), 0), 0),
        'avg_desc_len',  COALESCE(ROUND(AVG(LENGTH(
            COALESCE(v.fields->>'description', v.fields->>'caption', '')
        )), 0), 0),
        'avg_tag_count', COALESCE(ROUND(AVG(
            CASE
                WHEN jsonb_typeof(v.fields->'hashtags') = 'array' THEN jsonb_array_length(v.fields->'hashtags')
                WHEN jsonb_typeof(v.fields->'tags') = 'array' THEN jsonb_array_length(v.fields->'tags')
                ELSE 0
            END
        ), 1), 0),
        'avg_perf', v_avg_perf
    )
    INTO v_length_stats
    FROM _wp_versions v;

    -- --------------------------------------------------------
    -- Upsert the cached row
    -- --------------------------------------------------------
    INSERT INTO winning_metadata_patterns (
        brand_id, platform, vibe_preset, window_days,
        top_hooks, top_hashtags, top_ctas, length_stats,
        sample_count, avg_performance, computed_at
    ) VALUES (
        p_brand_id, p_platform, p_vibe_preset, p_window_days,
        v_top_hooks, v_top_hashtags, v_top_ctas, v_length_stats,
        v_sample_count, v_avg_perf, v_computed
    )
    ON CONFLICT (brand_id, platform, COALESCE(vibe_preset, ''), window_days)
    DO UPDATE SET
        top_hooks       = EXCLUDED.top_hooks,
        top_hashtags    = EXCLUDED.top_hashtags,
        top_ctas        = EXCLUDED.top_ctas,
        length_stats    = EXCLUDED.length_stats,
        sample_count    = EXCLUDED.sample_count,
        avg_performance = EXCLUDED.avg_performance,
        computed_at     = EXCLUDED.computed_at;

    RETURN QUERY SELECT p_brand_id, p_platform, p_vibe_preset, v_sample_count, v_computed;
END;
$$;

-- =====================================================
-- Also drop the old UNIQUE constraint that wasn't dropped
-- in migration 004 (name was truncated). Find and drop it.
-- =====================================================

DO $$
DECLARE
    v_constraint TEXT;
BEGIN
    SELECT conname INTO v_constraint
    FROM pg_constraint
    WHERE conrelid = 'winning_metadata_patterns'::regclass
      AND contype = 'u'
    LIMIT 1;

    IF v_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE winning_metadata_patterns DROP CONSTRAINT %I', v_constraint);
        RAISE NOTICE 'Dropped old unique constraint: %', v_constraint;
    END IF;
END;
$$;

-- =====================================================
-- Done
-- =====================================================
