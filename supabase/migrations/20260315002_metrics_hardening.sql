-- =====================================================
-- METRICS HARDENING
-- Audit fixes for #18 Metrics Collection v1
--
-- Fixes:
--   1. Index: (post_id, collected_at) → (post_id, platform, collected_at)
--      Optimal for DISTINCT ON (post_id, platform) + time-range queries
--   2. v_post_metrics_latest: DISTINCT ON (post_id) → (post_id, platform)
--   3. All RPCs using DISTINCT ON: same fix
--   4. v_post_metrics_summary: join key matches updated latest view
-- =====================================================

-- =====================================================
-- 1. REPLACE PRIMARY INDEX
-- Old:  (post_id, collected_at DESC)
-- New:  (post_id, platform, collected_at DESC)
-- This is the "one ideal index" for UI, views, and batch lookups
-- =====================================================

DROP INDEX IF EXISTS idx_post_metrics_post_collected;

CREATE INDEX idx_post_metrics_post_platform_collected
    ON post_metrics (post_id, platform, collected_at DESC);

-- =====================================================
-- 2. FIX v_post_metrics_latest
-- Was: DISTINCT ON (post_id) — misses platform dimension
-- Now: DISTINCT ON (post_id, platform) — correct per-post-per-platform
-- =====================================================

CREATE OR REPLACE VIEW v_post_metrics_latest AS
SELECT DISTINCT ON (pm.post_id, pm.platform)
    pm.post_id,
    pm.platform,
    pm.views,
    pm.likes,
    pm.comments,
    pm.shares,
    pm.saves,
    pm.watch_time_seconds,
    pm.avg_view_duration_seconds,
    pm.avg_view_percentage,
    pm.subscribers_gained,
    pm.subscribers_lost,
    pm.post_age_hours,
    pm.collected_at,
    pm.source,
    pm.error
FROM post_metrics pm
ORDER BY pm.post_id, pm.platform, pm.collected_at DESC;

-- =====================================================
-- 3. FIX v_post_metrics_summary
-- Join to latest view unchanged (post_id is still unique per post
-- in practice because each post has one platform), but the ORDER BY
-- in the view itself is now correct.
-- No structural change needed here — just recreate to pick up
-- the updated v_post_metrics_latest dependency.
-- =====================================================

-- (view recreated automatically since latest view was replaced)

-- =====================================================
-- 4. FIX RPCs with DISTINCT ON
-- =====================================================

-- get_latest_metrics_batch: used by calendar badges
CREATE OR REPLACE FUNCTION get_latest_metrics_batch(p_post_ids UUID[])
RETURNS TABLE (
    post_id         UUID,
    platform        TEXT,
    views           BIGINT,
    likes           INTEGER,
    comments        INTEGER,
    shares          INTEGER,
    saves           INTEGER,
    collected_at    TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT ON (pm.post_id, pm.platform)
        pm.post_id, pm.platform,
        pm.views, pm.likes, pm.comments, pm.shares, pm.saves,
        pm.collected_at
    FROM post_metrics pm
    WHERE pm.post_id = ANY(p_post_ids)
    ORDER BY pm.post_id, pm.platform, pm.collected_at DESC;
$$;

-- get_job_metrics: aggregate latest per post for a job
CREATE OR REPLACE FUNCTION get_job_metrics(p_job_id UUID)
RETURNS TABLE (
    job_id          UUID,
    total_views     BIGINT,
    total_likes     INTEGER,
    total_comments  INTEGER,
    total_shares    INTEGER,
    total_saves     INTEGER,
    platform_count  INTEGER,
    platforms       JSONB,
    last_collected_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    WITH latest_per_post AS (
        SELECT DISTINCT ON (pm.post_id, pm.platform)
            pm.post_id, pm.platform,
            pm.views, pm.likes, pm.comments, pm.shares, pm.saves,
            pm.collected_at
        FROM post_metrics pm
        JOIN posts p ON p.id = pm.post_id
        WHERE p.job_id = p_job_id
        ORDER BY pm.post_id, pm.platform, pm.collected_at DESC
    )
    SELECT
        p_job_id AS job_id,
        COALESCE(SUM(lpp.views), 0)::BIGINT AS total_views,
        COALESCE(SUM(lpp.likes), 0)::INTEGER AS total_likes,
        COALESCE(SUM(lpp.comments), 0)::INTEGER AS total_comments,
        COALESCE(SUM(lpp.shares), 0)::INTEGER AS total_shares,
        COALESCE(SUM(lpp.saves), 0)::INTEGER AS total_saves,
        COUNT(*)::INTEGER AS platform_count,
        jsonb_agg(jsonb_build_object(
            'platform', lpp.platform,
            'views', lpp.views,
            'likes', lpp.likes,
            'comments', lpp.comments,
            'shares', lpp.shares,
            'collected_at', lpp.collected_at
        )) AS platforms,
        MAX(lpp.collected_at) AS last_collected_at
    FROM latest_per_post lpp;
$$;

-- get_campaign_metrics: aggregate latest per post for a campaign
CREATE OR REPLACE FUNCTION get_campaign_metrics(p_batch_id UUID)
RETURNS TABLE (
    batch_id         UUID,
    total_posts      INTEGER,
    posts_with_metrics INTEGER,
    total_views      BIGINT,
    total_likes      INTEGER,
    total_comments   INTEGER,
    total_shares     INTEGER,
    total_saves      INTEGER,
    avg_views_per_post NUMERIC,
    avg_likes_per_post NUMERIC,
    platform_breakdown JSONB,
    last_collected_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
    WITH campaign_posts AS (
        SELECT p.id, p.platform
        FROM posts p
        WHERE p.batch_id = p_batch_id
          AND p.status = 'posted'
          AND p.platform_post_id IS NOT NULL
    ),
    latest_per_post AS (
        SELECT DISTINCT ON (pm.post_id, pm.platform)
            pm.post_id, pm.platform,
            pm.views, pm.likes, pm.comments, pm.shares, pm.saves,
            pm.collected_at
        FROM post_metrics pm
        JOIN campaign_posts cp ON cp.id = pm.post_id
        ORDER BY pm.post_id, pm.platform, pm.collected_at DESC
    ),
    per_platform AS (
        SELECT
            lpp.platform,
            COUNT(*) AS post_count,
            SUM(lpp.views) AS views,
            SUM(lpp.likes) AS likes,
            SUM(lpp.comments) AS comments,
            SUM(lpp.shares) AS shares
        FROM latest_per_post lpp
        GROUP BY lpp.platform
    )
    SELECT
        p_batch_id AS batch_id,
        (SELECT COUNT(*)::INTEGER FROM campaign_posts) AS total_posts,
        (SELECT COUNT(*)::INTEGER FROM latest_per_post) AS posts_with_metrics,
        COALESCE((SELECT SUM(views) FROM latest_per_post), 0)::BIGINT AS total_views,
        COALESCE((SELECT SUM(likes) FROM latest_per_post), 0)::INTEGER AS total_likes,
        COALESCE((SELECT SUM(comments) FROM latest_per_post), 0)::INTEGER AS total_comments,
        COALESCE((SELECT SUM(shares) FROM latest_per_post), 0)::INTEGER AS total_shares,
        COALESCE((SELECT SUM(saves) FROM latest_per_post), 0)::INTEGER AS total_saves,
        CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(lpp.views)::NUMERIC / COUNT(*), 1) ELSE 0 END AS avg_views_per_post,
        CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(lpp.likes)::NUMERIC / COUNT(*), 1) ELSE 0 END AS avg_likes_per_post,
        COALESCE(
            (SELECT jsonb_agg(jsonb_build_object(
                'platform', pp.platform,
                'post_count', pp.post_count,
                'views', pp.views,
                'likes', pp.likes,
                'comments', pp.comments,
                'shares', pp.shares
            )) FROM per_platform pp),
            '[]'::jsonb
        ) AS platform_breakdown,
        MAX(lpp.collected_at) AS last_collected_at
    FROM latest_per_post lpp;
$$;

-- get_post_metrics: add default 30-day range cap when no range specified
-- Prevents heavy reads on posts with long collection histories
CREATE OR REPLACE FUNCTION get_post_metrics(
    p_post_id UUID,
    p_since   TIMESTAMPTZ DEFAULT NULL,
    p_until   TIMESTAMPTZ DEFAULT NULL,
    p_limit   INTEGER DEFAULT 100
)
RETURNS TABLE (
    id              UUID,
    views           BIGINT,
    likes           INTEGER,
    comments        INTEGER,
    shares          INTEGER,
    saves           INTEGER,
    watch_time_seconds INTEGER,
    avg_view_duration_seconds NUMERIC,
    avg_view_percentage NUMERIC,
    post_age_hours  NUMERIC,
    collected_at    TIMESTAMPTZ,
    source          TEXT,
    error           TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT
        pm.id,
        pm.views, pm.likes, pm.comments, pm.shares, pm.saves,
        pm.watch_time_seconds, pm.avg_view_duration_seconds, pm.avg_view_percentage,
        pm.post_age_hours, pm.collected_at, pm.source, pm.error
    FROM post_metrics pm
    WHERE pm.post_id = p_post_id
      -- Default to last 30 days if no range specified
      AND pm.collected_at >= COALESCE(p_since, NOW() - INTERVAL '30 days')
      AND (p_until IS NULL OR pm.collected_at <= p_until)
    ORDER BY pm.collected_at DESC
    LIMIT p_limit;
$$;
