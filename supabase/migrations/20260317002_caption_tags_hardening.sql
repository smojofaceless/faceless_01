-- =============================================================================
-- Migration: 20260317002_caption_tags_hardening.sql
-- Phase: Roadmap #20 hardening — fixes + exemplar bucketing + negative exemplars
-- =============================================================================
-- Fixes:
--   1. v_post_variant_performance — add collected_at from metrics
--   2. v_top_metadata_patterns   — add collected_at for window filtering
--   3. get_generation_exemplars  — add p_preset_name, p_window_days, NULL fallback cascade
--   4. get_negative_exemplars    — bottom performers for "avoid these" prompting
-- =============================================================================

-- =====================================================
-- 1. FIX VIEW: v_post_variant_performance — add collected_at
--    Must DROP CASCADE because column order changed
--    (CREATE OR REPLACE cannot reorder/add columns)
-- =====================================================

-- Drop dependent view first
DROP VIEW IF EXISTS v_top_metadata_patterns;
DROP VIEW IF EXISTS v_post_variant_performance;

CREATE VIEW v_post_variant_performance AS
SELECT
    v.id             AS version_id,
    v.post_id,
    v.platform,
    v.version_number,
    v.version_type,
    v.variant_key,
    v.fields,
    v.generation_model,
    v.created_at     AS version_created_at,
    v.created_by,
    p.brand_id,
    p.job_id,
    j.vibe_preset,
    m.views,
    m.likes,
    m.comments,
    m.shares,
    m.collected_at,
    COALESCE(m.views, 0)
        + 5  * COALESCE(m.likes, 0)
        + 10 * COALESCE(m.comments, 0)
        + 10 * COALESCE(m.shares, 0)
    AS performance_value
FROM post_metadata_versions v
JOIN posts p ON p.id = v.post_id
LEFT JOIN jobs j ON j.id = p.job_id
LEFT JOIN v_post_metrics_latest m
    ON m.post_id = v.post_id AND m.platform = v.platform;

-- =====================================================
-- 2. FIX VIEW: v_top_metadata_patterns — add collected_at for window
--    Already dropped above, recreate with new column
-- =====================================================

CREATE VIEW v_top_metadata_patterns AS
WITH ranked AS (
    SELECT
        vp.version_id,
        vp.post_id,
        vp.platform,
        vp.version_number,
        vp.variant_key,
        vp.fields,
        vp.brand_id,
        vp.vibe_preset,
        vp.performance_value,
        vp.version_created_at,
        vp.collected_at,
        ROW_NUMBER() OVER (
            PARTITION BY vp.brand_id, vp.platform, vp.vibe_preset
            ORDER BY vp.performance_value DESC, vp.version_created_at DESC
        ) AS rank_in_group
    FROM v_post_variant_performance vp
    WHERE vp.performance_value > 0
      AND vp.version_type IN ('ai', 'regenerate')
)
SELECT
    version_id,
    post_id,
    platform,
    version_number,
    variant_key,
    fields,
    brand_id,
    vibe_preset,
    performance_value,
    version_created_at,
    collected_at,
    rank_in_group
FROM ranked
WHERE rank_in_group <= 10;

-- =====================================================
-- 3. FIX RPC: get_generation_exemplars
--    - Add p_preset_name (alias for vibe_preset bucketing)
--    - Add p_window_days (time scope, default 30)
--    - NULL fallback cascade: preset → brand-wide
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
      AND (v_effective_vibe IS NULL OR t.vibe_preset != v_effective_vibe)  -- avoid dupes from attempt 1
      AND t.version_created_at >= now() - (p_window_days || ' days')::INTERVAL
    ORDER BY t.performance_value DESC, t.version_created_at DESC
    LIMIT p_limit - v_found;

    RETURN;
END;
$$;

-- =====================================================
-- 4. NEW RPC: get_negative_exemplars
--    Bottom performers — "avoid these patterns"
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
    SELECT
        vp.post_id,
        vp.fields,
        vp.performance_value::BIGINT,
        vp.variant_key
    FROM v_post_variant_performance vp
    WHERE vp.brand_id = p_brand_id
      AND vp.platform = p_platform
      AND (p_vibe_preset IS NULL OR vp.vibe_preset = p_vibe_preset)
      AND vp.version_type IN ('ai', 'regenerate')
      AND vp.performance_value > 0               -- must have SOME metrics
      AND vp.performance_value < 20               -- low threshold
      AND vp.version_created_at >= now() - (p_window_days || ' days')::INTERVAL
    ORDER BY vp.performance_value ASC, vp.version_created_at DESC
    LIMIT p_limit;
$$;

-- =====================================================
-- Done
-- =====================================================
