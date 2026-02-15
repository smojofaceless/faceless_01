-- =====================================================
-- TIME SLOT SCORING
-- Roadmap #19: Compute best posting windows per brand/platform
--
-- Analytics-only: scores are stored for display, never
-- used to automatically alter scheduling.
--
-- Scoring formula:
--   performance_value = views + 5*likes + 10*comments + 10*shares
--   score = AVG(performance_value) per (brand, platform, tz, dow, hour)
--
-- Maturity threshold: posts must be ≥ 6 hours old
-- Windows: 7 / 14 / 30 days
-- =====================================================

-- =====================================================
-- 1. TABLE
-- =====================================================

-- Drop and recreate to ensure clean schema
DROP TABLE IF EXISTS time_slot_scores CASCADE;

CREATE TABLE time_slot_scores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id        UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    platform        TEXT NOT NULL,
    tz              TEXT NOT NULL DEFAULT 'America/New_York',
    day_of_week     INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    hour            INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
    window_days     INTEGER NOT NULL CHECK (window_days IN (7, 14, 30)),
    score           NUMERIC NOT NULL DEFAULT 0,
    sample_size     INTEGER NOT NULL DEFAULT 0,
    avg_views       NUMERIC DEFAULT 0,
    avg_likes       NUMERIC DEFAULT 0,
    avg_comments    NUMERIC DEFAULT 0,
    avg_shares      NUMERIC DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (brand_id, platform, tz, window_days, day_of_week, hour)
);

-- =====================================================
-- 2. INDEXES
-- =====================================================

-- Primary lookup: brand + platform + window
CREATE INDEX idx_time_slot_scores_lookup
    ON time_slot_scores (brand_id, platform, window_days);

-- Score ranking queries (top-N slots)
CREATE INDEX idx_time_slot_scores_score
    ON time_slot_scores (brand_id, platform, window_days, score DESC);

-- =====================================================
-- 3. RLS POLICIES
-- =====================================================

ALTER TABLE time_slot_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "time_slot_scores_select_all" ON time_slot_scores
    FOR SELECT USING (true);

CREATE POLICY "time_slot_scores_insert_all" ON time_slot_scores
    FOR INSERT WITH CHECK (true);

CREATE POLICY "time_slot_scores_update_all" ON time_slot_scores
    FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "time_slot_scores_delete_all" ON time_slot_scores
    FOR DELETE USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON time_slot_scores TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON time_slot_scores TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON time_slot_scores TO service_role;

-- =====================================================
-- 4. RPCs
-- =====================================================

-- ─────────────────────────────────────────────────────
-- recompute_time_slot_scores
-- Recomputes scores for one brand/platform/window.
-- Timezone resolution: p_tz → brand.settings.timezone → 'America/New_York'
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recompute_time_slot_scores(
    p_brand_id    UUID,
    p_platform    TEXT,
    p_window_days INTEGER DEFAULT 30,
    p_tz          TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_tz TEXT;
    v_upserted INTEGER := 0;
BEGIN
    -- Resolve timezone: parameter → brand setting → fallback
    IF p_tz IS NOT NULL AND p_tz != '' THEN
        v_tz := p_tz;
    ELSE
        SELECT COALESCE(b.settings->>'timezone', 'America/New_York')
        INTO v_tz
        FROM brands b
        WHERE b.id = p_brand_id;

        IF v_tz IS NULL THEN
            v_tz := 'America/New_York';
        END IF;
    END IF;

    -- Upsert scores from posts + latest metrics
    WITH eligible_posts AS (
        SELECT
            p.id AS post_id,
            p.posted_at,
            -- Convert to local timezone for bucketing
            EXTRACT(DOW FROM p.posted_at AT TIME ZONE v_tz)::INTEGER AS dow,
            EXTRACT(HOUR FROM p.posted_at AT TIME ZONE v_tz)::INTEGER AS hr
        FROM posts p
        WHERE p.brand_id = p_brand_id
          AND p.platform = p_platform
          AND p.status = 'posted'
          AND p.posted_at IS NOT NULL
          -- Maturity: at least 6 hours old
          AND p.posted_at <= NOW() - INTERVAL '6 hours'
          -- Window filter
          AND p.posted_at >= NOW() - (p_window_days || ' days')::INTERVAL
    ),
    post_scores AS (
        SELECT
            ep.dow,
            ep.hr,
            -- Performance value: views + 5*likes + 10*comments + 10*shares
            COALESCE(m.views, 0) + 5 * COALESCE(m.likes, 0) + 10 * COALESCE(m.comments, 0) + 10 * COALESCE(m.shares, 0) AS perf_value,
            COALESCE(m.views, 0) AS views,
            COALESCE(m.likes, 0) AS likes,
            COALESCE(m.comments, 0) AS comments,
            COALESCE(m.shares, 0) AS shares
        FROM eligible_posts ep
        LEFT JOIN v_post_metrics_latest m ON m.post_id = ep.post_id
    ),
    slot_aggregates AS (
        SELECT
            ps.dow,
            ps.hr,
            AVG(ps.perf_value)::NUMERIC AS score,
            COUNT(*)::INTEGER AS sample_size,
            ROUND(AVG(ps.views), 1) AS avg_views,
            ROUND(AVG(ps.likes), 1) AS avg_likes,
            ROUND(AVG(ps.comments), 1) AS avg_comments,
            ROUND(AVG(ps.shares), 1) AS avg_shares
        FROM post_scores ps
        GROUP BY ps.dow, ps.hr
    )
    INSERT INTO time_slot_scores (
        brand_id, platform, tz, window_days,
        day_of_week, hour,
        score, sample_size,
        avg_views, avg_likes, avg_comments, avg_shares,
        updated_at
    )
    SELECT
        p_brand_id, p_platform, v_tz, p_window_days,
        sa.dow, sa.hr,
        sa.score, sa.sample_size,
        sa.avg_views, sa.avg_likes, sa.avg_comments, sa.avg_shares,
        NOW()
    FROM slot_aggregates sa
    ON CONFLICT (brand_id, platform, tz, window_days, day_of_week, hour)
    DO UPDATE SET
        score = EXCLUDED.score,
        sample_size = EXCLUDED.sample_size,
        avg_views = EXCLUDED.avg_views,
        avg_likes = EXCLUDED.avg_likes,
        avg_comments = EXCLUDED.avg_comments,
        avg_shares = EXCLUDED.avg_shares,
        updated_at = NOW();

    GET DIAGNOSTICS v_upserted = ROW_COUNT;
    RETURN v_upserted;
END;
$$;

-- ─────────────────────────────────────────────────────
-- recompute_all_time_slot_scores
-- Loops through all active brands × platforms and recomputes.
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recompute_all_time_slot_scores(
    p_window_days INTEGER DEFAULT 30
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_total INTEGER := 0;
    v_count INTEGER;
    r RECORD;
BEGIN
    -- Find all active brand + platform combos with posted content
    FOR r IN
        SELECT DISTINCT p.brand_id, p.platform
        FROM posts p
        JOIN brands b ON b.id = p.brand_id AND b.is_active = true
        WHERE p.status = 'posted'
          AND p.posted_at IS NOT NULL
          AND p.posted_at >= NOW() - (p_window_days || ' days')::INTERVAL
    LOOP
        v_count := recompute_time_slot_scores(r.brand_id, r.platform, p_window_days);
        v_total := v_total + v_count;
    END LOOP;

    RETURN v_total;
END;
$$;

-- ─────────────────────────────────────────────────────
-- get_time_slot_scores
-- Returns the full grid for a brand/platform/window.
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_time_slot_scores(
    p_brand_id    UUID,
    p_platform    TEXT,
    p_window_days INTEGER DEFAULT 30,
    p_tz          TEXT DEFAULT NULL
)
RETURNS TABLE (
    day_of_week     INTEGER,
    hour            INTEGER,
    score           NUMERIC,
    sample_size     INTEGER,
    avg_views       NUMERIC,
    avg_likes       NUMERIC,
    avg_comments    NUMERIC,
    avg_shares      NUMERIC,
    updated_at      TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    v_tz TEXT;
BEGIN
    -- Resolve timezone
    IF p_tz IS NOT NULL AND p_tz != '' THEN
        v_tz := p_tz;
    ELSE
        SELECT COALESCE(b.settings->>'timezone', 'America/New_York')
        INTO v_tz
        FROM brands b
        WHERE b.id = p_brand_id;

        IF v_tz IS NULL THEN
            v_tz := 'America/New_York';
        END IF;
    END IF;

    RETURN QUERY
    SELECT
        ts.day_of_week,
        ts.hour,
        ts.score,
        ts.sample_size,
        ts.avg_views,
        ts.avg_likes,
        ts.avg_comments,
        ts.avg_shares,
        ts.updated_at
    FROM time_slot_scores ts
    WHERE ts.brand_id = p_brand_id
      AND ts.platform = p_platform
      AND ts.window_days = p_window_days
      AND ts.tz = v_tz
    ORDER BY ts.day_of_week ASC, ts.hour ASC;
END;
$$;

-- ─────────────────────────────────────────────────────
-- get_best_time_slots
-- Returns top N slots by score with sample_size threshold.
-- Includes human-readable labels.
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_best_time_slots(
    p_brand_id    UUID,
    p_platform    TEXT,
    p_window_days INTEGER DEFAULT 30,
    p_limit       INTEGER DEFAULT 5,
    p_tz          TEXT DEFAULT NULL
)
RETURNS TABLE (
    day_of_week     INTEGER,
    day_name        TEXT,
    hour            INTEGER,
    hour_label      TEXT,
    score           NUMERIC,
    sample_size     INTEGER,
    avg_views       NUMERIC,
    avg_likes       NUMERIC,
    avg_comments    NUMERIC,
    avg_shares      NUMERIC,
    updated_at      TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    v_tz TEXT;
BEGIN
    -- Resolve timezone
    IF p_tz IS NOT NULL AND p_tz != '' THEN
        v_tz := p_tz;
    ELSE
        SELECT COALESCE(b.settings->>'timezone', 'America/New_York')
        INTO v_tz
        FROM brands b
        WHERE b.id = p_brand_id;

        IF v_tz IS NULL THEN
            v_tz := 'America/New_York';
        END IF;
    END IF;

    RETURN QUERY
    SELECT
        ts.day_of_week,
        CASE ts.day_of_week
            WHEN 0 THEN 'Sun'
            WHEN 1 THEN 'Mon'
            WHEN 2 THEN 'Tue'
            WHEN 3 THEN 'Wed'
            WHEN 4 THEN 'Thu'
            WHEN 5 THEN 'Fri'
            WHEN 6 THEN 'Sat'
        END AS day_name,
        ts.hour,
        CASE
            WHEN ts.hour = 0 THEN '12 AM'
            WHEN ts.hour < 12 THEN ts.hour || ' AM'
            WHEN ts.hour = 12 THEN '12 PM'
            ELSE (ts.hour - 12) || ' PM'
        END AS hour_label,
        ts.score,
        ts.sample_size,
        ts.avg_views,
        ts.avg_likes,
        ts.avg_comments,
        ts.avg_shares,
        ts.updated_at
    FROM time_slot_scores ts
    WHERE ts.brand_id = p_brand_id
      AND ts.platform = p_platform
      AND ts.window_days = p_window_days
      AND ts.tz = v_tz
      AND ts.sample_size >= 3
    ORDER BY ts.score DESC
    LIMIT p_limit;
END;
$$;

-- =====================================================
-- 5. CRON JOB
-- Recompute all scores every 6 hours
-- =====================================================

DO $outer$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Remove existing job if any
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recompute-time-slot-scores') THEN
            PERFORM cron.unschedule('recompute-time-slot-scores');
        END IF;

        -- Schedule every 6 hours
        PERFORM cron.schedule(
            'recompute-time-slot-scores',
            '0 */6 * * *',
            $inner$
            SELECT recompute_all_time_slot_scores(7);
            SELECT recompute_all_time_slot_scores(14);
            SELECT recompute_all_time_slot_scores(30);
            $inner$
        );
    END IF;
END;
$outer$;
