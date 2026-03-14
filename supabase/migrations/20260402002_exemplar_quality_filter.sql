-- =============================================================================
-- Migration: 20260402002_exemplar_quality_filter.sql
-- Phase: AI Learning Improvement Roadmap 1.3
-- =============================================================================
-- Changes:
--   1. get_generation_exemplars — exclude versions with excessively long text
--      fields (> 400 chars) so old raw-narration-style metadata can't be used
--      as positive exemplars
--   2. get_negative_exemplars — add fallback posts (metadata_source starts with
--      'fallback') and long-text AI versions as negative exemplars regardless
--      of engagement score
-- =============================================================================

-- =====================================================
-- 1. UPDATE RPC: get_generation_exemplars
--    Add content quality filter — exclude versions where the primary text
--    field exceeds 400 characters (sign of raw narration leak)
-- =====================================================

CREATE OR REPLACE FUNCTION get_generation_exemplars(
    p_brand_id     UUID,
    p_platform     TEXT,
    p_vibe_preset  TEXT    DEFAULT NULL,
    p_preset_name  TEXT    DEFAULT NULL,
    p_limit        INTEGER DEFAULT 3,
    p_window_days  INTEGER DEFAULT 30
)
RETURNS TABLE (
    post_id           UUID,
    fields            JSONB,
    performance_value BIGINT,
    variant_key       TEXT
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    v_effective_vibe TEXT;
    v_found INTEGER;
BEGIN
    -- Resolve effective vibe: p_preset_name takes priority over p_vibe_preset
    v_effective_vibe := COALESCE(p_preset_name, p_vibe_preset);

    -- Attempt 1: exact vibe match within window
    IF v_effective_vibe IS NOT NULL THEN
        RETURN QUERY
        SELECT
            t.post_id,
            t.fields,
            t.performance_value::BIGINT,
            t.variant_key
        FROM v_top_metadata_patterns t
        WHERE t.brand_id = p_brand_id
          AND t.platform = p_platform
          AND t.vibe_preset = v_effective_vibe
          AND t.version_created_at >= now() - (p_window_days || ' days')::INTERVAL
          -- Content quality: exclude versions with excessively long text
          AND GREATEST(
              COALESCE(LENGTH(t.fields->>'caption'), 0),
              COALESCE(LENGTH(t.fields->>'description'), 0),
              COALESCE(LENGTH(t.fields->>'tweet_text'), 0),
              COALESCE(LENGTH(t.fields->>'text'), 0)
          ) < 400
        ORDER BY t.performance_value DESC, t.version_created_at DESC
        LIMIT p_limit;

        GET DIAGNOSTICS v_found = ROW_COUNT;
        IF v_found >= p_limit THEN
            RETURN;
        END IF;
    END IF;

    -- Attempt 2: brand-wide fallback (any vibe) within window
    RETURN QUERY
    SELECT
        t.post_id,
        t.fields,
        t.performance_value::BIGINT,
        t.variant_key
    FROM v_top_metadata_patterns t
    WHERE t.brand_id = p_brand_id
      AND t.platform = p_platform
      AND (v_effective_vibe IS NULL OR t.vibe_preset != v_effective_vibe)
      AND t.version_created_at >= now() - (p_window_days || ' days')::INTERVAL
      -- Content quality: exclude versions with excessively long text
      AND GREATEST(
          COALESCE(LENGTH(t.fields->>'caption'), 0),
          COALESCE(LENGTH(t.fields->>'description'), 0),
          COALESCE(LENGTH(t.fields->>'tweet_text'), 0),
          COALESCE(LENGTH(t.fields->>'text'), 0)
      ) < 400
    ORDER BY t.performance_value DESC, t.version_created_at DESC
    LIMIT p_limit - v_found;

    RETURN;
END;
$$;

-- =====================================================
-- 2. UPDATE RPC: get_negative_exemplars
--    Three sources of negative exemplars:
--    (a) Low-performing AI versions (original: perf < 20)
--    (b) Fallback posts where metadata failed/missing (raw narration posted)
--    (c) AI versions with excessively long text (> 400ch = quality signal)
-- =====================================================

CREATE OR REPLACE FUNCTION get_negative_exemplars(
    p_brand_id     UUID,
    p_platform     TEXT,
    p_vibe_preset  TEXT    DEFAULT NULL,
    p_limit        INTEGER DEFAULT 2,
    p_window_days  INTEGER DEFAULT 30
)
RETURNS TABLE (
    post_id           UUID,
    fields            JSONB,
    performance_value BIGINT,
    variant_key       TEXT
)
LANGUAGE sql STABLE
AS $$
    WITH combined AS (
        -- Source A: Low-performing AI-generated versions (original logic)
        SELECT
            vp.post_id,
            vp.fields,
            vp.performance_value::BIGINT AS performance_value,
            vp.variant_key
        FROM v_post_variant_performance vp
        WHERE vp.brand_id = p_brand_id
          AND vp.platform = p_platform
          AND (p_vibe_preset IS NULL OR vp.vibe_preset = p_vibe_preset)
          AND vp.version_type IN ('ai', 'regenerate')
          AND vp.performance_value > 0
          AND vp.performance_value < 20
          AND vp.version_created_at >= now() - (p_window_days || ' days')::INTERVAL

        UNION ALL

        -- Source B: Fallback posts (metadata failed/missing, raw narration posted)
        -- These have no post_metadata_versions row, so pull from posts table directly
        SELECT
            p.id AS post_id,
            jsonb_build_object(
                'title', p.title,
                'description', p.description,
                'tags', COALESCE(to_jsonb(p.tags), '[]'::jsonb),
                '_negative_reason', 'raw_narration_fallback'
            ) AS fields,
            0::BIGINT AS performance_value,
            'fallback' AS variant_key
        FROM posts p
        WHERE p.brand_id = p_brand_id
          AND p.platform = p_platform
          AND p.platform_content->>'metadata_source' LIKE 'fallback%'
          AND p.created_at >= now() - (p_window_days || ' days')::INTERVAL

        UNION ALL

        -- Source C: AI versions with excessively long text (quality signal)
        -- Even if they performed well, long text = bad pattern to learn from
        SELECT
            vp.post_id,
            vp.fields,
            vp.performance_value::BIGINT AS performance_value,
            vp.variant_key
        FROM v_post_variant_performance vp
        WHERE vp.brand_id = p_brand_id
          AND vp.platform = p_platform
          AND (p_vibe_preset IS NULL OR vp.vibe_preset = p_vibe_preset)
          AND vp.version_type IN ('ai', 'regenerate')
          AND vp.version_created_at >= now() - (p_window_days || ' days')::INTERVAL
          AND GREATEST(
              COALESCE(LENGTH(vp.fields->>'caption'), 0),
              COALESCE(LENGTH(vp.fields->>'description'), 0),
              COALESCE(LENGTH(vp.fields->>'tweet_text'), 0),
              COALESCE(LENGTH(vp.fields->>'text'), 0)
          ) > 400
    )
    SELECT DISTINCT ON (combined.post_id)
        combined.post_id,
        combined.fields,
        combined.performance_value,
        combined.variant_key
    FROM combined
    ORDER BY combined.post_id, combined.performance_value ASC
    LIMIT p_limit;
$$;

-- =====================================================
-- Done
-- =====================================================
