-- =============================================================================
-- Migration: 20260317003_winning_patterns_cache.sql
-- Phase: Roadmap #20 — Winning Patterns Cache + get_negative_exemplars fix
-- =============================================================================
-- Creates:
--   1. FIX: get_negative_exemplars — add p_preset_name param
--   2. winning_metadata_patterns table (cached derived patterns)
--   3. recompute_winning_patterns RPC (per brand/platform/vibe)
--   4. recompute_all_winning_patterns RPC (bulk refresh)
--   5. get_winning_patterns RPC (generator reads)
--   6. pg_cron: nightly refresh at 03:00 UTC
-- =============================================================================

-- =====================================================
-- 1. FIX: get_negative_exemplars — add p_preset_name
--    Same cascade logic as get_generation_exemplars
-- =====================================================

CREATE OR REPLACE FUNCTION get_negative_exemplars(
    p_brand_id     UUID,
    p_platform     TEXT,
    p_vibe_preset  TEXT    DEFAULT NULL,
    p_preset_name  TEXT    DEFAULT NULL,
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
      AND (COALESCE(p_preset_name, p_vibe_preset) IS NULL
           OR vp.vibe_preset = COALESCE(p_preset_name, p_vibe_preset))
      AND vp.version_type IN ('ai', 'regenerate')
      AND vp.performance_value > 0
      AND vp.performance_value < 20
      AND vp.version_created_at >= now() - (p_window_days || ' days')::INTERVAL
    ORDER BY vp.performance_value ASC, vp.version_created_at DESC
    LIMIT p_limit;
$$;

-- =====================================================
-- 2. TABLE: winning_metadata_patterns
--    Cached derived patterns per brand/platform/vibe
-- =====================================================

CREATE TABLE IF NOT EXISTS winning_metadata_patterns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id        UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    platform        TEXT NOT NULL,
    vibe_preset     TEXT,                   -- NULL = brand-wide aggregate
    window_days     INTEGER NOT NULL DEFAULT 30,

    -- Cached pattern extractions
    top_hooks       JSONB NOT NULL DEFAULT '[]'::JSONB,   -- [{hook, perf, post_id}]
    top_hashtags    JSONB NOT NULL DEFAULT '[]'::JSONB,   -- [{tag, count, avg_perf}]
    top_ctas        JSONB NOT NULL DEFAULT '[]'::JSONB,   -- [{cta, count}]
    length_stats    JSONB NOT NULL DEFAULT '{}'::JSONB,   -- {avg_title_len, avg_desc_len, avg_tag_count}

    sample_count    INTEGER NOT NULL DEFAULT 0,
    avg_performance NUMERIC NOT NULL DEFAULT 0,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (brand_id, platform, vibe_preset, window_days)
);

CREATE INDEX IF NOT EXISTS idx_wmp_brand_platform
    ON winning_metadata_patterns (brand_id, platform)
    WHERE sample_count > 0;

COMMENT ON TABLE winning_metadata_patterns IS
    'Cached derived patterns (hooks, hashtags, CTAs, length stats) extracted from top-performing metadata. Refreshed nightly by pg_cron.';

-- RLS
ALTER TABLE winning_metadata_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wmp_select_all" ON winning_metadata_patterns
    FOR SELECT USING (true);
CREATE POLICY "wmp_insert_all" ON winning_metadata_patterns
    FOR INSERT WITH CHECK (true);
CREATE POLICY "wmp_update_all" ON winning_metadata_patterns
    FOR UPDATE USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON winning_metadata_patterns TO anon;
GRANT SELECT, INSERT, UPDATE ON winning_metadata_patterns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON winning_metadata_patterns TO service_role;

-- =====================================================
-- 3. RPC: recompute_winning_patterns
--    Extracts patterns from top performers for one
--    (brand_id, platform, vibe_preset, window_days) group
-- =====================================================

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
DECLARE
    v_top_hooks       JSONB;
    v_top_hashtags    JSONB;
    v_top_ctas        JSONB;
    v_length_stats    JSONB;
    v_sample_count    INTEGER;
    v_avg_perf        NUMERIC;
    v_computed        TIMESTAMPTZ := now();
BEGIN
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
    LIMIT 50;  -- cap to top 50 for pattern extraction

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
        ON CONFLICT (brand_id, platform, vibe_preset, window_days)
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
        HAVING COUNT(*) >= 2  -- must appear in at least 2 posts
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
    ON CONFLICT (brand_id, platform, vibe_preset, window_days)
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
-- 4. RPC: recompute_all_winning_patterns
--    Bulk refresh — iterates all brand+platform+vibe combos
--    that have metric data in the given window
-- =====================================================

CREATE OR REPLACE FUNCTION recompute_all_winning_patterns(
    p_window_days INTEGER DEFAULT 30
)
RETURNS TABLE (
    groups_processed INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER := 0;
    rec RECORD;
BEGIN
    -- Find distinct brand/platform/vibe groups with metric data
    FOR rec IN
        SELECT DISTINCT
            vp.brand_id,
            vp.platform,
            vp.vibe_preset
        FROM v_post_variant_performance vp
        WHERE vp.performance_value > 0
          AND vp.version_created_at >= now() - (p_window_days || ' days')::INTERVAL
    LOOP
        PERFORM recompute_winning_patterns(
            rec.brand_id, rec.platform, rec.vibe_preset, p_window_days
        );
        v_count := v_count + 1;

        -- Also compute brand-wide (NULL vibe) if not already a NULL row
        IF rec.vibe_preset IS NOT NULL THEN
            PERFORM recompute_winning_patterns(
                rec.brand_id, rec.platform, NULL, p_window_days
            );
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_count;
END;
$$;

-- =====================================================
-- 5. RPC: get_winning_patterns
--    Generator reads cached patterns with fallback
-- =====================================================

CREATE OR REPLACE FUNCTION get_winning_patterns(
    p_brand_id    UUID,
    p_platform    TEXT,
    p_vibe_preset TEXT    DEFAULT NULL,
    p_window_days INTEGER DEFAULT 30
)
RETURNS TABLE (
    top_hooks       JSONB,
    top_hashtags    JSONB,
    top_ctas        JSONB,
    length_stats    JSONB,
    sample_count    INTEGER,
    avg_performance NUMERIC,
    computed_at     TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
    -- Attempt 1: exact vibe match
    IF p_vibe_preset IS NOT NULL THEN
        RETURN QUERY
        SELECT
            w.top_hooks, w.top_hashtags, w.top_ctas, w.length_stats,
            w.sample_count, w.avg_performance, w.computed_at
        FROM winning_metadata_patterns w
        WHERE w.brand_id = p_brand_id
          AND w.platform = p_platform
          AND w.vibe_preset = p_vibe_preset
          AND w.window_days = p_window_days
          AND w.sample_count > 0;

        IF FOUND THEN RETURN; END IF;
    END IF;

    -- Attempt 2: brand-wide (NULL vibe)
    RETURN QUERY
    SELECT
        w.top_hooks, w.top_hashtags, w.top_ctas, w.length_stats,
        w.sample_count, w.avg_performance, w.computed_at
    FROM winning_metadata_patterns w
    WHERE w.brand_id = p_brand_id
      AND w.platform = p_platform
      AND w.vibe_preset IS NULL
      AND w.window_days = p_window_days
      AND w.sample_count > 0;
END;
$$;

-- =====================================================
-- 6. pg_cron: nightly refresh at 03:00 UTC
-- =====================================================

DO $outer$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Remove existing job if any
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recompute-winning-patterns') THEN
            PERFORM cron.unschedule('recompute-winning-patterns');
        END IF;

        -- Schedule nightly at 03:00 UTC
        PERFORM cron.schedule(
            'recompute-winning-patterns',
            '0 3 * * *',
            $inner$
            SELECT recompute_all_winning_patterns(30);
            $inner$
        );
    END IF;
END;
$outer$;

-- =====================================================
-- Done
-- =====================================================
