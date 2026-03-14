-- =============================================================================
-- Migration: 20260402003_auto_preset_weight_cron.sql
-- Phase: AI Learning Improvement Roadmap 2.2 — Vibe Preset Auto-Rotation
-- =============================================================================
-- The recompute_preset_weights() RPC already exists (20260326004) but is never
-- called automatically. This migration:
--   1. Creates recompute_all_preset_weights() — iterates all brands with
--      brand_templates rows and calls recompute_preset_weights() for each
--   2. Schedules a nightly pg_cron job at 03:15 UTC (after winning patterns
--      refresh at 03:00) to run it automatically
-- =============================================================================

-- =====================================================
-- 1. Bulk wrapper: recompute_all_preset_weights
-- =====================================================

CREATE OR REPLACE FUNCTION recompute_all_preset_weights(
    p_window_days INTEGER DEFAULT 30
)
RETURNS TABLE (
    brand_id         UUID,
    presets_updated   INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_brand UUID;
    v_count INTEGER;
BEGIN
    -- Iterate all brands that have at least 2 brand_templates rows
    FOR v_brand IN
        SELECT bt.brand_id
        FROM brand_templates bt
        GROUP BY bt.brand_id
        HAVING COUNT(*) >= 2
    LOOP
        -- recompute_preset_weights returns rows only when it has enough data
        SELECT COUNT(*) INTO v_count
        FROM recompute_preset_weights(v_brand, p_window_days);

        IF v_count > 0 THEN
            brand_id := v_brand;
            presets_updated := v_count;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION recompute_all_preset_weights(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION recompute_all_preset_weights(INTEGER) TO authenticated;

-- =====================================================
-- 2. pg_cron: nightly at 03:15 UTC (after winning patterns at 03:00)
-- =====================================================

DO $outer$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Remove existing job if any
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recompute-preset-weights') THEN
            PERFORM cron.unschedule('recompute-preset-weights');
        END IF;

        PERFORM cron.schedule(
            'recompute-preset-weights',
            '15 3 * * *',
            $inner$
            SELECT recompute_all_preset_weights(30);
            $inner$
        );
    END IF;
END;
$outer$;

-- =====================================================
-- Done
-- =====================================================
