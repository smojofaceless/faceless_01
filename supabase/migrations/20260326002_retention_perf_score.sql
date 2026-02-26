-- =====================================================
-- Add retention bonus to performance scoring
-- 
-- Instagram Reels now collects ig_reels_avg_watch_time
-- and ig_reels_video_view_total_time. This migration:
--
-- 1. Creates a reusable compute_perf_score() function
--    that includes a retention bonus
-- 2. Updates v_cross_platform_performance,
--    v_strategy_performance, v_visual_performance
--    to use the new function
--
-- Formula:
--   base = views + 5×likes + 10×comments + 10×shares
--   retention_bonus = avg_view_duration_seconds × 20
--     (capped at 50% of base score)
--   perf_score = base + retention_bonus
--
-- Rationale: A 30-second average watch time adds 600
-- points, roughly equivalent to 60 likes or 60 shares.
-- This rewards stories that hold attention. The 50% cap
-- prevents retention from completely dominating when
-- engagement is low.
-- =====================================================

-- 1. Reusable perf_score function
CREATE OR REPLACE FUNCTION compute_perf_score(
    p_views         BIGINT DEFAULT 0,
    p_likes         INTEGER DEFAULT 0,
    p_comments      INTEGER DEFAULT 0,
    p_shares        INTEGER DEFAULT 0,
    p_avg_view_dur  NUMERIC DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE
AS $$
    SELECT
        CASE
            WHEN COALESCE(p_avg_view_dur, 0) > 0 THEN
                -- Base engagement score
                (COALESCE(p_views, 0) + 5 * COALESCE(p_likes, 0) + 10 * COALESCE(p_comments, 0) + 10 * COALESCE(p_shares, 0))
                +
                -- Retention bonus: avg_view_dur × 20, capped at 50% of base
                LEAST(
                    ROUND(p_avg_view_dur * 20),
                    ROUND(0.5 * (COALESCE(p_views, 0) + 5 * COALESCE(p_likes, 0) + 10 * COALESCE(p_comments, 0) + 10 * COALESCE(p_shares, 0)))
                )
            ELSE
                -- No retention data — pure engagement score (backwards compatible)
                COALESCE(p_views, 0) + 5 * COALESCE(p_likes, 0) + 10 * COALESCE(p_comments, 0) + 10 * COALESCE(p_shares, 0)
        END;
$$;

COMMENT ON FUNCTION compute_perf_score IS
    'Unified performance score: engagement base + retention bonus (capped at 50% of base). Used by all performance views.';

GRANT EXECUTE ON FUNCTION compute_perf_score TO anon;
GRANT EXECUTE ON FUNCTION compute_perf_score TO authenticated;


-- 2. Update v_cross_platform_performance
CREATE OR REPLACE VIEW v_cross_platform_performance AS
SELECT
  p.job_id,
  p.brand_id,
  p.title,
  p.platform,
  p.posted_at,
  m.views,
  m.likes,
  m.comments,
  m.shares,
  m.saves,
  m.avg_view_duration_seconds,
  m.watch_time_seconds,
  compute_perf_score(m.views, m.likes, m.comments, m.shares, m.avg_view_duration_seconds) AS perf_score,
  m.collected_at AS metrics_at
FROM posts p
LEFT JOIN v_post_metrics_latest m ON m.post_id = p.id
WHERE p.status = 'posted'
  AND p.job_id IS NOT NULL;

GRANT SELECT ON v_cross_platform_performance TO anon;
GRANT SELECT ON v_cross_platform_performance TO authenticated;


-- 3. Update v_strategy_performance
CREATE OR REPLACE VIEW v_strategy_performance AS
SELECT
  ps.platform,
  ps.strategy_type,
  ps.caption_style,
  ps.hook_type,
  p.brand_id,
  COUNT(*) AS post_count,
  ROUND(AVG(COALESCE(m.views, 0)), 0) AS avg_views,
  ROUND(AVG(COALESCE(m.likes, 0)), 0) AS avg_likes,
  ROUND(AVG(COALESCE(m.comments, 0)), 0) AS avg_comments,
  ROUND(AVG(COALESCE(m.shares, 0)), 0) AS avg_shares,
  ROUND(AVG(COALESCE(m.saves, 0)), 0) AS avg_saves,
  ROUND(AVG(COALESCE(m.avg_view_duration_seconds, 0)), 2) AS avg_retention_seconds,
  ROUND(AVG(
    compute_perf_score(m.views, m.likes, m.comments, m.shares, m.avg_view_duration_seconds)
  ), 0) AS avg_perf_score
FROM post_strategies ps
JOIN posts p ON ps.post_id = p.id
LEFT JOIN v_post_metrics_latest m ON m.post_id = p.id
WHERE p.status = 'posted'
GROUP BY ps.platform, ps.strategy_type, ps.caption_style, ps.hook_type, p.brand_id;

GRANT SELECT ON v_strategy_performance TO anon;
GRANT SELECT ON v_strategy_performance TO authenticated;


-- 4. Update v_visual_performance
CREATE OR REPLACE VIEW v_visual_performance AS
SELECT
  p.brand_id,
  p.job_id,
  p.title,
  p.platform,
  ja.meta->>'scene_count' AS scene_count,
  ja.meta->>'total_images' AS total_images,
  ja.meta->>'image_provider' AS image_provider,
  p.meta->>'vibe_preset' AS vibe_preset,
  COALESCE(m.views, 0) AS views,
  COALESCE(m.likes, 0) AS likes,
  COALESCE(m.comments, 0) AS comments,
  COALESCE(m.shares, 0) AS shares,
  m.avg_view_duration_seconds,
  compute_perf_score(m.views, m.likes, m.comments, m.shares, m.avg_view_duration_seconds) AS perf_score,
  p.posted_at
FROM posts p
LEFT JOIN v_post_metrics_latest m ON m.post_id = p.id
LEFT JOIN job_assets ja ON ja.job_id = p.job_id AND ja.type = 'image_manifest'
WHERE p.status = 'posted';

GRANT SELECT ON v_visual_performance TO anon;
GRANT SELECT ON v_visual_performance TO authenticated;
