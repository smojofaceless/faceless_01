-- =====================================================
-- CAMPAIGN STATS VIEW & RPC
-- Provides enriched campaign data with job/post statistics
-- =====================================================

-- Create a view for campaign statistics
CREATE OR REPLACE VIEW campaign_stats AS
SELECT 
    gb.id,
    gb.brand_id,
    gb.video_count,
    gb.status,
    gb.settings,
    gb.created_at,
    gb.updated_at,
    gb.completed_at,
    
    -- Job statistics
    COALESCE(job_stats.total_jobs, 0) AS total_jobs,
    COALESCE(job_stats.pending_jobs, 0) AS pending_jobs,
    COALESCE(job_stats.processing_jobs, 0) AS processing_jobs,
    COALESCE(job_stats.complete_jobs, 0) AS complete_jobs,
    COALESCE(job_stats.failed_jobs, 0) AS failed_jobs,
    COALESCE(job_stats.cancelled_jobs, 0) AS cancelled_jobs,
    
    -- Post statistics  
    COALESCE(post_stats.total_posts, 0) AS total_posts,
    COALESCE(post_stats.draft_posts, 0) AS draft_posts,
    COALESCE(post_stats.scheduled_posts, 0) AS scheduled_posts,
    COALESCE(post_stats.queued_posts, 0) AS queued_posts,
    COALESCE(post_stats.publishing_posts, 0) AS publishing_posts,
    COALESCE(post_stats.published_posts, 0) AS published_posts,
    COALESCE(post_stats.failed_posts, 0) AS failed_posts,
    
    -- Schedule info
    job_stats.next_scheduled_at,
    job_stats.last_completed_at,
    
    -- Progress calculation (based on video completion)
    CASE 
        WHEN gb.video_count > 0 THEN 
            ROUND((COALESCE(job_stats.complete_jobs, 0)::numeric / gb.video_count::numeric) * 100, 1)
        ELSE 0 
    END AS progress_percent
    
FROM generation_batches gb
LEFT JOIN LATERAL (
    SELECT 
        COUNT(*) AS total_jobs,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending_jobs,
        COUNT(*) FILTER (WHERE status IN ('claimed', 'processing')) AS processing_jobs,
        COUNT(*) FILTER (WHERE status = 'complete') AS complete_jobs,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed_jobs,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_jobs,
        MIN(scheduled_post_at) FILTER (WHERE status = 'pending') AS next_scheduled_at,
        MAX(updated_at) FILTER (WHERE status = 'complete') AS last_completed_at
    FROM jobs 
    WHERE jobs.batch_id = gb.id
) job_stats ON true
LEFT JOIN LATERAL (
    SELECT 
        COUNT(*) AS total_posts,
        COUNT(*) FILTER (WHERE status = 'draft') AS draft_posts,
        COUNT(*) FILTER (WHERE status = 'scheduled') AS scheduled_posts,
        COUNT(*) FILTER (WHERE status = 'queued') AS queued_posts,
        COUNT(*) FILTER (WHERE status = 'publishing') AS publishing_posts,
        COUNT(*) FILTER (WHERE status = 'published') AS published_posts,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed_posts
    FROM posts 
    WHERE posts.batch_id = gb.id
) post_stats ON true;

-- Grant access
GRANT SELECT ON campaign_stats TO anon, authenticated, service_role;

-- RPC to get campaigns with stats for a brand
CREATE OR REPLACE FUNCTION get_campaign_stats_by_brand(
    p_brand_id UUID,
    p_limit INTEGER DEFAULT 20,
    p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    brand_id UUID,
    video_count INTEGER,
    status TEXT,
    settings JSONB,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    total_jobs BIGINT,
    pending_jobs BIGINT,
    processing_jobs BIGINT,
    complete_jobs BIGINT,
    failed_jobs BIGINT,
    cancelled_jobs BIGINT,
    total_posts BIGINT,
    draft_posts BIGINT,
    scheduled_posts BIGINT,
    queued_posts BIGINT,
    publishing_posts BIGINT,
    published_posts BIGINT,
    failed_posts BIGINT,
    next_scheduled_at TIMESTAMPTZ,
    last_completed_at TIMESTAMPTZ,
    progress_percent NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cs.id,
        cs.brand_id,
        cs.video_count,
        cs.status,
        cs.settings,
        cs.created_at,
        cs.updated_at,
        cs.completed_at,
        cs.total_jobs,
        cs.pending_jobs,
        cs.processing_jobs,
        cs.complete_jobs,
        cs.failed_jobs,
        cs.cancelled_jobs,
        cs.total_posts,
        cs.draft_posts,
        cs.scheduled_posts,
        cs.queued_posts,
        cs.publishing_posts,
        cs.published_posts,
        cs.failed_posts,
        cs.next_scheduled_at,
        cs.last_completed_at,
        cs.progress_percent
    FROM campaign_stats cs
    WHERE cs.brand_id = p_brand_id
      AND (p_status IS NULL OR cs.status = p_status)
    ORDER BY cs.created_at DESC
    LIMIT p_limit;
END;
$$;

-- Grant execute on RPC
GRANT EXECUTE ON FUNCTION get_campaign_stats_by_brand TO anon, authenticated, service_role;

COMMENT ON VIEW campaign_stats IS 'Enriched view of generation_batches with job and post statistics';
COMMENT ON FUNCTION get_campaign_stats_by_brand IS 'Get campaigns with computed statistics for a brand';
