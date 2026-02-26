-- Migration: Update recompute_time_slot_scores to use compute_perf_score()
-- This includes the retention bonus (avg_view_duration_seconds × 20, capped at 50% of base)
-- Previously: inline views + 5*likes + 10*comments + 10*shares (no retention)

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
            -- Use compute_perf_score() for retention-boosted scoring
            compute_perf_score(
                COALESCE(m.views, 0),
                COALESCE(m.likes, 0),
                COALESCE(m.comments, 0),
                COALESCE(m.shares, 0),
                m.avg_view_duration_seconds
            ) AS perf_value,
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
