-- =============================================================================
-- Migration: 20260402004_metrics_recompute_trigger.sql
-- Phase: AI Learning Improvement Roadmap 3.2 — Event-Driven Recomputation
-- =============================================================================
-- When new metrics arrive via record_post_metrics(), mark the brand+platform
-- as "stale" so winning patterns + preset weights get recomputed before
-- the next metadata generation — not just at 03:00 UTC nightly.
--
-- Design: debounced flag table + AFTER INSERT trigger on post_metrics
-- The generate-post-metadata edge function checks the flag and recomputes
-- inline if stale (< 1 hour old metrics exist since last computation).
-- =============================================================================

-- =====================================================
-- 1. Stale-flag table: tracks which brand/platform combos
--    have new metrics since last winning patterns computation
-- =====================================================

CREATE TABLE IF NOT EXISTS winning_patterns_staleness (
    brand_id    UUID NOT NULL,
    platform    TEXT NOT NULL,
    stale_since TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (brand_id, platform)
);

COMMENT ON TABLE winning_patterns_staleness IS
    'Tracks brand/platform combos with new metrics since last winning patterns recomputation. Trigger-populated, consumed by generate-post-metadata.';

-- =====================================================
-- 2. Trigger function: on post_metrics INSERT, mark
--    the corresponding brand+platform as stale
-- =====================================================

CREATE OR REPLACE FUNCTION trg_mark_patterns_stale()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_brand_id UUID;
BEGIN
    -- Look up brand_id from the posts table
    SELECT p.brand_id INTO v_brand_id
    FROM posts p
    WHERE p.id = NEW.post_id;

    IF v_brand_id IS NOT NULL THEN
        INSERT INTO winning_patterns_staleness (brand_id, platform, stale_since)
        VALUES (v_brand_id, NEW.platform, NOW())
        ON CONFLICT (brand_id, platform)
        DO UPDATE SET stale_since = NOW();
    END IF;

    RETURN NEW;
END;
$$;

-- =====================================================
-- 3. Attach trigger to post_metrics table
-- =====================================================

DROP TRIGGER IF EXISTS trg_metrics_stale_flag ON post_metrics;

CREATE TRIGGER trg_metrics_stale_flag
    AFTER INSERT ON post_metrics
    FOR EACH ROW
    EXECUTE FUNCTION trg_mark_patterns_stale();

-- =====================================================
-- 4. RPC: refresh_stale_patterns
--    Called by generate-post-metadata before generation
--    if the brand/platform has stale patterns. Recomputes
--    winning patterns + clears the stale flag.
--    Returns TRUE if patterns were refreshed.
-- =====================================================

CREATE OR REPLACE FUNCTION refresh_stale_patterns(
    p_brand_id    UUID,
    p_platform    TEXT,
    p_vibe_preset TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_stale_since TIMESTAMPTZ;
    v_last_computed TIMESTAMPTZ;
BEGIN
    -- Check if this brand/platform has a stale flag
    SELECT stale_since INTO v_stale_since
    FROM winning_patterns_staleness
    WHERE brand_id = p_brand_id AND platform = p_platform;

    IF v_stale_since IS NULL THEN
        RETURN FALSE;  -- No stale flag, patterns are fresh
    END IF;

    -- Check when patterns were last computed
    SELECT computed_at INTO v_last_computed
    FROM winning_metadata_patterns
    WHERE brand_id = p_brand_id
      AND platform = p_platform
      AND COALESCE(vibe_preset, '') = COALESCE(p_vibe_preset, '')
      AND window_days = 30;

    -- Only recompute if stale_since is after last computation
    -- (or if never computed)
    IF v_last_computed IS NULL OR v_stale_since > v_last_computed THEN
        -- Recompute winning patterns for this specific combo
        PERFORM recompute_winning_patterns(p_brand_id, p_platform, p_vibe_preset, 30);

        -- Also recompute brand-wide (NULL vibe) if applicable
        IF p_vibe_preset IS NOT NULL THEN
            PERFORM recompute_winning_patterns(p_brand_id, p_platform, NULL, 30);
        END IF;

        -- Clear the stale flag
        DELETE FROM winning_patterns_staleness
        WHERE brand_id = p_brand_id AND platform = p_platform;

        RETURN TRUE;
    END IF;

    -- Stale flag exists but patterns are already newer — clean up
    DELETE FROM winning_patterns_staleness
    WHERE brand_id = p_brand_id AND platform = p_platform;

    RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_stale_patterns(UUID, TEXT, TEXT) TO service_role;

-- =====================================================
-- Done
-- =====================================================
