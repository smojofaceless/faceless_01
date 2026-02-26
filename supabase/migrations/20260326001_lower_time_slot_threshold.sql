-- =====================================================
-- Lower time slot sample_size threshold from 3 to 2
-- Allows the AI scheduling system to use learned time
-- slots earlier in the learning phase (fewer posts needed)
-- =====================================================

CREATE OR REPLACE FUNCTION get_best_time_slots(
    p_brand_id   UUID,
    p_platform   TEXT,
    p_window_days INTEGER DEFAULT 30,
    p_limit      INTEGER DEFAULT 5,
    p_tz         TEXT DEFAULT NULL
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
      AND ts.sample_size >= 2  -- Lowered from 3 to allow earlier AI learning
    ORDER BY ts.score DESC
    LIMIT p_limit;
END;
$$;
