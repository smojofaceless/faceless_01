-- =====================================================
-- METRICS COLLECTION V1
-- Roadmap #18: Time-series metrics storage + collection infrastructure
--
-- Replaces unused post_analytics scaffold with proper append-only
-- time-series design. Provides collection schedule, platform-agnostic
-- storage, and query RPCs.
--
-- Collection Schedule (decay based on post age):
--   0-2h:    every 30 min
--   2-24h:   every 2h
--   24-48h:  every 6h
--   48h-7d:  every 12h
--   7-30d:   every 24h
--   30-90d:  every 7d
--   90d+:    stop collecting
-- =====================================================

-- =====================================================
-- 1. DROP OLD UNUSED post_analytics TABLE
-- =====================================================

-- Drop RLS policies first
DROP POLICY IF EXISTS "post_analytics_select_all" ON post_analytics;
DROP POLICY IF EXISTS "post_analytics_insert_all" ON post_analytics;
DROP POLICY IF EXISTS "post_analytics_select_own" ON post_analytics;
DROP POLICY IF EXISTS "post_analytics_insert_own" ON post_analytics;

-- Drop indexes
DROP INDEX IF EXISTS idx_post_analytics_post_id;
DROP INDEX IF EXISTS idx_post_analytics_platform;
DROP INDEX IF EXISTS idx_post_analytics_timing;

-- Drop the table
DROP TABLE IF EXISTS post_analytics CASCADE;

-- =====================================================
-- 2. CREATE post_metrics TABLE (append-only time-series)
-- =====================================================

CREATE TABLE post_metrics (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id                     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    platform                    TEXT NOT NULL,

    -- Engagement metrics (cumulative totals at collection time)
    views                       BIGINT DEFAULT 0,
    likes                       INTEGER DEFAULT 0,
    comments                    INTEGER DEFAULT 0,
    shares                      INTEGER DEFAULT 0,
    saves                       INTEGER DEFAULT 0,

    -- Watch metrics (platform-dependent, nullable)
    watch_time_seconds          INTEGER,
    avg_view_duration_seconds   NUMERIC(10,2),
    avg_view_percentage         NUMERIC(5,2),

    -- Growth metrics (platform-dependent, nullable)
    subscribers_gained          INTEGER DEFAULT 0,
    subscribers_lost            INTEGER DEFAULT 0,

    -- Collection metadata
    post_age_hours              NUMERIC(10,1),     -- age of post when collected
    collected_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source                      TEXT NOT NULL DEFAULT 'api'
                                CHECK (source IN ('api', 'backfill', 'manual', 'stub')),
    collector_id                TEXT,               -- edge function invocation ID
    raw_payload                 JSONB DEFAULT '{}'::jsonb,
    error                       TEXT,               -- partial failure note

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary query pattern: per-post history ordered by time
CREATE INDEX idx_post_metrics_post_collected
    ON post_metrics (post_id, collected_at DESC);

-- Recency queries (admin, batch lookups)
CREATE INDEX idx_post_metrics_collected_at
    ON post_metrics (collected_at DESC);

-- Platform-level queries
CREATE INDEX idx_post_metrics_platform
    ON post_metrics (platform, collected_at DESC);

-- =====================================================
-- 3. RLS POLICIES
-- =====================================================

ALTER TABLE post_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_metrics_select_all" ON post_metrics
    FOR SELECT USING (true);

CREATE POLICY "post_metrics_insert_all" ON post_metrics
    FOR INSERT WITH CHECK (true);

GRANT SELECT, INSERT ON post_metrics TO anon;
GRANT SELECT, INSERT ON post_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON post_metrics TO service_role;

-- =====================================================
-- 4. VIEWS
-- =====================================================

-- Latest metrics per post (most recent collection)
CREATE OR REPLACE VIEW v_post_metrics_latest AS
SELECT DISTINCT ON (pm.post_id)
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
ORDER BY pm.post_id, pm.collected_at DESC;

-- Per-post summary: latest values + collection stats
CREATE OR REPLACE VIEW v_post_metrics_summary AS
SELECT
    p.id AS post_id,
    p.platform,
    p.brand_id,
    p.batch_id,
    p.job_id,
    p.status AS post_status,
    p.posted_at,
    p.platform_post_id,
    p.platform_url,
    p.title,
    -- Latest metrics
    latest.views,
    latest.likes,
    latest.comments,
    latest.shares,
    latest.saves,
    latest.watch_time_seconds,
    latest.avg_view_duration_seconds,
    latest.avg_view_percentage,
    latest.collected_at AS last_collected_at,
    -- Collection stats
    stats.collection_count,
    stats.first_collected_at,
    stats.last_collected_at AS stats_last_collected,
    -- Computed
    CASE WHEN p.posted_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600
         ELSE NULL
    END AS current_post_age_hours,
    -- Terminal flag
    COALESCE((p.meta->>'metrics_terminal')::boolean, false) AS metrics_terminal
FROM posts p
LEFT JOIN v_post_metrics_latest latest ON latest.post_id = p.id
LEFT JOIN (
    SELECT
        post_id,
        COUNT(*) AS collection_count,
        MIN(collected_at) AS first_collected_at,
        MAX(collected_at) AS last_collected_at
    FROM post_metrics
    GROUP BY post_id
) stats ON stats.post_id = p.id
WHERE p.status = 'posted'
  AND p.platform_post_id IS NOT NULL;

-- Collection status: what's collected, what's due, what's terminal
CREATE OR REPLACE VIEW v_metrics_collection_status AS
SELECT
    p.id AS post_id,
    p.platform,
    p.brand_id,
    p.batch_id,
    p.posted_at,
    p.platform_post_id,
    COALESCE((p.meta->>'metrics_terminal')::boolean, false) AS metrics_terminal,
    EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 AS post_age_hours,
    latest.collected_at AS last_collected_at,
    latest.views AS latest_views,
    latest.likes AS latest_likes,
    CASE
        WHEN COALESCE((p.meta->>'metrics_terminal')::boolean, false) THEN 'terminal'
        WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 > 2160 THEN 'retired'  -- >90 days
        WHEN latest.collected_at IS NULL THEN 'never_collected'
        ELSE 'active'
    END AS collection_state,
    -- Compute interval for this post's age
    CASE
        WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 2     THEN 0.5     -- 30 min
        WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 24    THEN 2.0     -- 2h
        WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 48    THEN 6.0     -- 6h
        WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 168   THEN 12.0    -- 12h
        WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 720   THEN 24.0    -- 24h
        WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 2160  THEN 168.0   -- 7d
        ELSE NULL  -- >90 days, stop
    END AS interval_hours,
    -- Is this post due for collection?
    CASE
        WHEN COALESCE((p.meta->>'metrics_terminal')::boolean, false) THEN false
        WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 > 2160 THEN false  -- >90 days
        WHEN latest.collected_at IS NULL THEN true  -- never collected
        ELSE (
            EXTRACT(EPOCH FROM (NOW() - latest.collected_at)) / 3600 >=
            CASE
                WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 2     THEN 0.5
                WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 24    THEN 2.0
                WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 48    THEN 6.0
                WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 168   THEN 12.0
                WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 720   THEN 24.0
                WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 2160  THEN 168.0
                ELSE 99999  -- effectively never
            END
        )
    END AS is_due
FROM posts p
LEFT JOIN v_post_metrics_latest latest ON latest.post_id = p.id
WHERE p.status = 'posted'
  AND p.platform_post_id IS NOT NULL;

-- =====================================================
-- 5. RPCs
-- =====================================================

-- ─────────────────────────────────────────────────────
-- find_metrics_eligible_posts: Posts due for collection
-- Uses decay schedule to determine eligibility
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION find_metrics_eligible_posts(
    p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
    post_id         UUID,
    platform        TEXT,
    platform_post_id TEXT,
    brand_id        UUID,
    batch_id        UUID,
    posted_at       TIMESTAMPTZ,
    post_age_hours  NUMERIC,
    last_collected_at TIMESTAMPTZ,
    interval_hours  NUMERIC
)
LANGUAGE sql STABLE
AS $$
    SELECT
        p.id AS post_id,
        p.platform,
        p.platform_post_id,
        p.brand_id,
        p.batch_id,
        p.posted_at,
        EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 AS post_age_hours,
        latest.collected_at AS last_collected_at,
        -- Current interval for this post age
        CASE
            WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 2     THEN 0.5
            WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 24    THEN 2.0
            WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 48    THEN 6.0
            WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 168   THEN 12.0
            WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 720   THEN 24.0
            WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 2160  THEN 168.0
            ELSE NULL
        END AS interval_hours
    FROM posts p
    LEFT JOIN (
        SELECT DISTINCT ON (pm.post_id) pm.post_id, pm.collected_at
        FROM post_metrics pm
        ORDER BY pm.post_id, pm.collected_at DESC
    ) latest ON latest.post_id = p.id
    WHERE p.status = 'posted'
      AND p.platform_post_id IS NOT NULL
      AND p.posted_at IS NOT NULL
      -- Not terminal
      AND COALESCE((p.meta->>'metrics_terminal')::boolean, false) = false
      -- Not too old (< 90 days)
      AND EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 2160
      -- Due for collection: never collected OR last collection older than interval
      AND (
          latest.collected_at IS NULL
          OR EXTRACT(EPOCH FROM (NOW() - latest.collected_at)) / 3600 >=
              CASE
                  WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 2     THEN 0.5
                  WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 24    THEN 2.0
                  WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 48    THEN 6.0
                  WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 168   THEN 12.0
                  WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 720   THEN 24.0
                  WHEN EXTRACT(EPOCH FROM (NOW() - p.posted_at)) / 3600 <= 2160  THEN 168.0
                  ELSE 99999
              END
      )
    -- Prioritize: never collected first, then oldest last-collected
    ORDER BY latest.collected_at ASC NULLS FIRST
    LIMIT p_limit;
$$;

-- ─────────────────────────────────────────────────────
-- record_post_metrics: Insert a metrics snapshot
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_post_metrics(
    p_post_id       UUID,
    p_platform      TEXT,
    p_views         BIGINT DEFAULT 0,
    p_likes         INTEGER DEFAULT 0,
    p_comments      INTEGER DEFAULT 0,
    p_shares        INTEGER DEFAULT 0,
    p_saves         INTEGER DEFAULT 0,
    p_watch_time_seconds INTEGER DEFAULT NULL,
    p_avg_view_duration  NUMERIC DEFAULT NULL,
    p_avg_view_pct       NUMERIC DEFAULT NULL,
    p_subscribers_gained INTEGER DEFAULT 0,
    p_subscribers_lost   INTEGER DEFAULT 0,
    p_source        TEXT DEFAULT 'api',
    p_collector_id  TEXT DEFAULT NULL,
    p_raw_payload   JSONB DEFAULT '{}'::jsonb,
    p_error         TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_posted_at TIMESTAMPTZ;
    v_age_hours NUMERIC;
    v_id UUID;
BEGIN
    -- Get post's posted_at for age calculation
    SELECT posted_at INTO v_posted_at
    FROM posts WHERE id = p_post_id;

    IF v_posted_at IS NULL THEN
        RAISE EXCEPTION 'Post % not found or not posted', p_post_id;
    END IF;

    v_age_hours := EXTRACT(EPOCH FROM (NOW() - v_posted_at)) / 3600;

    INSERT INTO post_metrics (
        post_id, platform,
        views, likes, comments, shares, saves,
        watch_time_seconds, avg_view_duration_seconds, avg_view_percentage,
        subscribers_gained, subscribers_lost,
        post_age_hours, collected_at, source, collector_id,
        raw_payload, error
    ) VALUES (
        p_post_id, p_platform,
        p_views, p_likes, p_comments, p_shares, p_saves,
        p_watch_time_seconds, p_avg_view_duration, p_avg_view_pct,
        p_subscribers_gained, p_subscribers_lost,
        ROUND(v_age_hours, 1), NOW(), p_source, p_collector_id,
        p_raw_payload, p_error
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────
-- get_post_metrics: Time-series for one post
-- ─────────────────────────────────────────────────────
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
      AND (p_since IS NULL OR pm.collected_at >= p_since)
      AND (p_until IS NULL OR pm.collected_at <= p_until)
    ORDER BY pm.collected_at DESC
    LIMIT p_limit;
$$;

-- ─────────────────────────────────────────────────────
-- get_latest_metrics: Single latest snapshot for one post
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_latest_metrics(p_post_id UUID)
RETURNS TABLE (
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
    source          TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT
        pm.views, pm.likes, pm.comments, pm.shares, pm.saves,
        pm.watch_time_seconds, pm.avg_view_duration_seconds, pm.avg_view_percentage,
        pm.post_age_hours, pm.collected_at, pm.source
    FROM post_metrics pm
    WHERE pm.post_id = p_post_id
    ORDER BY pm.collected_at DESC
    LIMIT 1;
$$;

-- ─────────────────────────────────────────────────────
-- get_latest_metrics_batch: Latest metrics for multiple posts
-- Used by calendar UI for badge display
-- ─────────────────────────────────────────────────────
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
    SELECT DISTINCT ON (pm.post_id)
        pm.post_id, pm.platform,
        pm.views, pm.likes, pm.comments, pm.shares, pm.saves,
        pm.collected_at
    FROM post_metrics pm
    WHERE pm.post_id = ANY(p_post_ids)
    ORDER BY pm.post_id, pm.collected_at DESC;
$$;

-- ─────────────────────────────────────────────────────
-- get_job_metrics: Aggregate latest metrics across all platforms for a job
-- ─────────────────────────────────────────────────────
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
        SELECT DISTINCT ON (pm.post_id)
            pm.post_id, pm.platform,
            pm.views, pm.likes, pm.comments, pm.shares, pm.saves,
            pm.collected_at
        FROM post_metrics pm
        JOIN posts p ON p.id = pm.post_id
        WHERE p.job_id = p_job_id
        ORDER BY pm.post_id, pm.collected_at DESC
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

-- ─────────────────────────────────────────────────────
-- get_campaign_metrics: Aggregate metrics for entire campaign
-- ─────────────────────────────────────────────────────
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
        SELECT DISTINCT ON (pm.post_id)
            pm.post_id, pm.platform,
            pm.views, pm.likes, pm.comments, pm.shares, pm.saves,
            pm.collected_at
        FROM post_metrics pm
        JOIN campaign_posts cp ON cp.id = pm.post_id
        ORDER BY pm.post_id, pm.collected_at DESC
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

-- ─────────────────────────────────────────────────────
-- cleanup_old_post_metrics: Maintenance cleanup
-- Default: 365 days retention (not scheduled in v1)
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_old_post_metrics(
    p_older_than_days INTEGER DEFAULT 365
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM post_metrics
    WHERE collected_at < NOW() - (p_older_than_days || ' days')::INTERVAL;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

-- =====================================================
-- 6. CRON JOB FOR METRICS COLLECTOR
-- =====================================================
-- Schedule metrics-collector to run every 30 minutes
-- Uses same pattern as schedule-posts cron

DO $outer$
BEGIN
    -- Only create cron job if pg_cron extension is available
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Remove existing job if any
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'metrics-collector-cron') THEN
            PERFORM cron.unschedule('metrics-collector-cron');
        END IF;

        -- Schedule every 30 minutes
        PERFORM cron.schedule(
            'metrics-collector-cron',
            '*/30 * * * *',
            $inner$
            SELECT net.http_post(
                url := current_setting('app.settings.supabase_url') || '/functions/v1/metrics-collector',
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
                ),
                body := '{"source": "cron"}'::jsonb
            );
            $inner$
        );
    END IF;
END;
$outer$;
