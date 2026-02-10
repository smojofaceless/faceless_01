-- =====================================================
-- POST QUEUE SYSTEM MIGRATION
-- Adds posting infrastructure: claim mechanism, retry tracking, platform results
-- 
-- Reference: ROADMAP.md Item #9, POST_QUEUE.md
-- Date: February 23, 2026
-- =====================================================

-- =====================================================
-- PART 1: EXTEND POSTS TABLE
-- Add lease/claim columns + platform result columns
-- =====================================================

-- Add claim/lease columns (similar to jobs table pattern)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS locked_by TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

-- Add attempt tracking (rename retry_count if needed for consistency)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0;

-- Add attempt timing for DLQ/dashboard clarity
ALTER TABLE posts ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

-- Add platform result columns (single platform per post in new model)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS platform_post_id TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS platform_url TEXT;

-- Ensure error column exists and can hold structured error
ALTER TABLE posts ADD COLUMN IF NOT EXISTS error JSONB;

-- Add job reference if missing (should exist but ensure)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;

-- Add campaign reference for easier gating
ALTER TABLE posts ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES generation_batches(id) ON DELETE SET NULL;

-- Add idempotency key for debugging (job_id:platform)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS idempotency_key TEXT GENERATED ALWAYS AS (
  COALESCE(job_id::TEXT, 'no-job') || ':' || COALESCE(platform, 'unknown')
) STORED;

-- =====================================================
-- PART 2: INDEXES FOR POST QUEUE
-- =====================================================

-- Index for finding due posts
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_status 
ON posts(scheduled_at, status) 
WHERE status = 'scheduled';

-- Index for lease expiry checks
CREATE INDEX IF NOT EXISTS idx_posts_lease_expires 
ON posts(lease_expires_at) 
WHERE lease_expires_at IS NOT NULL;

-- Index for DLQ view (failed posts)
CREATE INDEX IF NOT EXISTS idx_posts_status_failed 
ON posts(status, updated_at DESC) 
WHERE status = 'failed';

-- Index for campaign gating lookups
CREATE INDEX IF NOT EXISTS idx_posts_batch_id 
ON posts(batch_id) 
WHERE batch_id IS NOT NULL;

-- Index for idempotency key (debugging duplicate posts)
CREATE INDEX IF NOT EXISTS idx_posts_idempotency_key 
ON posts(idempotency_key);

-- =====================================================
-- PART 3: CLAIM_DUE_POSTS RPC
-- Atomically claim N posts that are due for posting
-- Returns posts with lease acquired
-- =====================================================

CREATE OR REPLACE FUNCTION claim_due_posts(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 5,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  post_id UUID,
  job_id UUID,
  brand_id UUID,
  batch_id UUID,
  platform TEXT,
  video_url TEXT,
  title TEXT,
  description TEXT,
  tags TEXT[],
  scheduled_at TIMESTAMPTZ,
  attempt_count INTEGER,
  meta JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_lease_until TIMESTAMPTZ := v_now + (p_lease_seconds || ' seconds')::INTERVAL;
BEGIN
  -- Claim posts atomically with FOR UPDATE SKIP LOCKED
  RETURN QUERY
  WITH claimable AS (
    SELECT p.id
    FROM posts p
    LEFT JOIN generation_batches gb ON p.batch_id = gb.id
    WHERE 
      -- Status check
      p.status = 'scheduled'
      -- Due for posting
      AND p.scheduled_at <= v_now
      -- Not already leased (or lease expired)
      AND (p.lease_expires_at IS NULL OR p.lease_expires_at < v_now)
      -- Campaign not paused/cancelled (if has campaign)
      AND (gb.id IS NULL OR gb.status = 'active')
      -- Max attempts not exceeded
      AND COALESCE(p.attempt_count, 0) < 3
    ORDER BY p.scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE OF p SKIP LOCKED
  ),
  claimed AS (
    UPDATE posts
    SET 
      status = 'posting',
      locked_by = p_worker_id,
      locked_at = v_now,
      lease_expires_at = v_lease_until,
      attempt_count = COALESCE(posts.attempt_count, 0) + 1,
      last_attempt_at = v_now,
      next_attempt_at = NULL,
      updated_at = v_now
    WHERE id IN (SELECT id FROM claimable)
    RETURNING *
  )
  SELECT 
    c.id AS post_id,
    c.job_id,
    c.brand_id,
    c.batch_id,
    c.platform,
    c.video_url,
    c.title,
    c.description,
    c.tags,
    c.scheduled_at,
    c.attempt_count,
    c.ai_metadata AS meta
  FROM claimed c;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_due_posts(TEXT, INTEGER, INTEGER) TO service_role;

COMMENT ON FUNCTION claim_due_posts IS 
'Atomically claim N posts due for posting. Uses FOR UPDATE SKIP LOCKED for concurrency safety.
Respects campaign status (skips paused/cancelled campaigns) and max attempt limit (3).
Returns claimed posts with lease acquired.';

-- =====================================================
-- PART 4: MARK_POST_POSTED RPC
-- Successfully posted - store platform results
-- =====================================================

CREATE OR REPLACE FUNCTION mark_post_posted(
  p_post_id UUID,
  p_worker_id TEXT,
  p_platform_post_id TEXT,
  p_platform_url TEXT,
  p_meta JSONB DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status TEXT;
  v_current_locker TEXT;
BEGIN
  -- Get current state
  SELECT status, locked_by INTO v_current_status, v_current_locker
  FROM posts WHERE id = p_post_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Post not found'::TEXT;
    RETURN;
  END IF;
  
  -- Already posted is success (idempotent)
  IF v_current_status = 'posted' THEN
    RETURN QUERY SELECT TRUE, 'Already posted'::TEXT;
    RETURN;
  END IF;
  
  -- Validate ownership (if we have a lease)
  IF v_current_locker IS NOT NULL AND v_current_locker != p_worker_id THEN
    RETURN QUERY SELECT FALSE, format('Post locked by different worker: %s', v_current_locker)::TEXT;
    RETURN;
  END IF;
  
  -- Update to posted (use ai_metadata for extra metadata)
  UPDATE posts
  SET 
    status = 'posted',
    platform_post_id = p_platform_post_id,
    platform_url = p_platform_url,
    posted_at = NOW(),
    locked_by = NULL,
    locked_at = NULL,
    lease_expires_at = NULL,
    error = NULL,
    ai_metadata = COALESCE(ai_metadata, '{}'::jsonb) || COALESCE(p_meta, '{}'::jsonb),
    updated_at = NOW()
  WHERE id = p_post_id;
  
  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_post_posted(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION mark_post_posted IS 
'Mark a post as successfully posted. Stores platform_post_id and platform_url.
Idempotent: returns success if already posted.
Validates worker ownership if lease exists.';

-- =====================================================
-- PART 5: MARK_POST_FAILED RPC
-- Post failed - store error, optionally reschedule for retry
-- =====================================================

CREATE OR REPLACE FUNCTION mark_post_failed(
  p_post_id UUID,
  p_worker_id TEXT,
  p_error_class TEXT,
  p_error_message TEXT,
  p_retryable BOOLEAN DEFAULT TRUE,
  p_error_signature TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  new_status TEXT,
  next_retry_at TIMESTAMPTZ,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status TEXT;
  v_current_locker TEXT;
  v_attempt_count INTEGER;
  v_platform TEXT;
  v_new_status TEXT;
  v_backoff_interval INTERVAL;
  v_next_retry TIMESTAMPTZ := NULL;
  v_error_sig TEXT;
BEGIN
  -- Get current state
  SELECT status, locked_by, attempt_count, platform 
  INTO v_current_status, v_current_locker, v_attempt_count, v_platform
  FROM posts WHERE id = p_post_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TIMESTAMPTZ, 'Post not found'::TEXT;
    RETURN;
  END IF;
  
  -- Validate ownership
  IF v_current_locker IS NOT NULL AND v_current_locker != p_worker_id THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TIMESTAMPTZ, 
      format('Post locked by different worker: %s', v_current_locker)::TEXT;
    RETURN;
  END IF;
  
  -- Build error signature if not provided (matches job DLQ pattern)
  v_error_sig := COALESCE(p_error_signature, 
    p_error_class || ':' || COALESCE(v_platform, 'unknown') || ':post'
  );
  
  -- Determine next status
  IF NOT p_retryable OR v_attempt_count >= 3 THEN
    -- Permanent failure
    v_new_status := 'failed';
    v_next_retry := NULL;
  ELSE
    -- Retryable - calculate backoff
    -- Attempt 1->2: +30 min, 2->3: +2 hours
    v_backoff_interval := CASE v_attempt_count
      WHEN 1 THEN INTERVAL '30 minutes'
      WHEN 2 THEN INTERVAL '2 hours'
      ELSE INTERVAL '4 hours'
    END;
    
    v_new_status := 'scheduled';
    v_next_retry := NOW() + v_backoff_interval;
  END IF;
  
  -- Update post
  UPDATE posts
  SET 
    status = v_new_status,
    scheduled_at = COALESCE(v_next_retry, scheduled_at),
    next_attempt_at = v_next_retry,
    error = jsonb_build_object(
      'class', p_error_class,
      'message', p_error_message,
      'signature', v_error_sig,
      'failed_at', NOW(),
      'attempt', v_attempt_count
    ),
    locked_by = NULL,
    locked_at = NULL,
    lease_expires_at = NULL,
    updated_at = NOW()
  WHERE id = p_post_id;
  
  RETURN QUERY SELECT TRUE, v_new_status, v_next_retry, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_post_failed(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO service_role;

COMMENT ON FUNCTION mark_post_failed IS 
'Mark a post as failed. If retryable and under max attempts (3), reschedules with backoff.
Backoff: 30min after attempt 1, 2h after attempt 2, permanent fail after attempt 3.
Error classes: transient, dependency, misconfig, permanent.
Error signature format: {class}:{platform}:{detail} - enables cluster-protection for posting outages.';

-- =====================================================
-- PART 6: RELEASE_POST_LEASE RPC
-- Release lease without changing status (for graceful shutdown)
-- =====================================================

CREATE OR REPLACE FUNCTION release_post_lease(
  p_post_id UUID,
  p_worker_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_locker TEXT;
BEGIN
  SELECT locked_by INTO v_current_locker FROM posts WHERE id = p_post_id;
  
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  -- Only release if we own the lease
  IF v_current_locker IS NULL OR v_current_locker != p_worker_id THEN
    RETURN FALSE;
  END IF;
  
  -- Revert to scheduled status (our claim is abandoned)
  UPDATE posts
  SET 
    status = 'scheduled',
    locked_by = NULL,
    locked_at = NULL,
    lease_expires_at = NULL,
    updated_at = NOW()
  WHERE id = p_post_id;
  
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION release_post_lease(UUID, TEXT) TO service_role;

-- =====================================================
-- PART 7: FIND_DUE_POSTS RPC (read-only for scheduler)
-- Find posts that are due for posting without claiming
-- =====================================================

CREATE OR REPLACE FUNCTION find_due_posts(
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  post_id UUID,
  job_id UUID,
  brand_id UUID,
  batch_id UUID,
  platform TEXT,
  scheduled_at TIMESTAMPTZ,
  attempt_count INTEGER,
  campaign_status TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT 
    p.id AS post_id,
    p.job_id,
    p.brand_id,
    p.batch_id,
    p.platform,
    p.scheduled_at,
    COALESCE(p.attempt_count, 0) AS attempt_count,
    gb.status AS campaign_status
  FROM posts p
  LEFT JOIN generation_batches gb ON p.batch_id = gb.id
  WHERE 
    p.status = 'scheduled'
    AND p.scheduled_at <= NOW()
    AND (p.lease_expires_at IS NULL OR p.lease_expires_at < NOW())
    AND (gb.id IS NULL OR gb.status = 'active')
    AND COALESCE(p.attempt_count, 0) < 3
  ORDER BY p.scheduled_at ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION find_due_posts(INTEGER) TO service_role;

-- =====================================================
-- PART 8: SWEEP_STALE_POST_LEASES RPC
-- Find expired post leases and revert to scheduled
-- =====================================================

CREATE OR REPLACE FUNCTION sweep_stale_post_leases(
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  post_id UUID,
  platform TEXT,
  job_id UUID,
  stale_worker TEXT,
  lease_expired_at TIMESTAMPTZ,
  action_taken TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_dry_run THEN
    -- Just report what would be swept
    RETURN QUERY
    SELECT 
      p.id AS post_id,
      p.platform,
      p.job_id,
      p.locked_by AS stale_worker,
      p.lease_expires_at AS lease_expired_at,
      'would_revert_to_scheduled'::TEXT AS action_taken
    FROM posts p
    WHERE 
      p.status = 'posting'
      AND p.lease_expires_at IS NOT NULL
      AND p.lease_expires_at < v_now;
  ELSE
    -- Actually sweep
    RETURN QUERY
    WITH stale AS (
      SELECT p.id
      FROM posts p
      WHERE 
        p.status = 'posting'
        AND p.lease_expires_at IS NOT NULL
        AND p.lease_expires_at < v_now
      FOR UPDATE SKIP LOCKED
    ),
    swept AS (
      UPDATE posts
      SET 
        status = 'scheduled',
        locked_by = NULL,
        locked_at = NULL,
        lease_expires_at = NULL,
        error = jsonb_build_object(
          'class', 'transient',
          'message', 'Lease expired - worker may have crashed',
          'swept_at', v_now
        ),
        updated_at = v_now
      WHERE id IN (SELECT id FROM stale)
      RETURNING *
    )
    SELECT 
      s.id AS post_id,
      s.platform,
      s.job_id,
      s.locked_by AS stale_worker,
      s.lease_expires_at AS lease_expired_at,
      'reverted_to_scheduled'::TEXT AS action_taken
    FROM swept s;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION sweep_stale_post_leases(BOOLEAN) TO service_role;

COMMENT ON FUNCTION sweep_stale_post_leases IS 
'Find posts with expired leases (stuck in posting status) and revert to scheduled.
These are posts where the worker crashed or timed out mid-posting.
Use p_dry_run=true to preview without making changes.';

-- =====================================================
-- PART 9: FAILED POSTS DLQ VIEW
-- Shows failed posts for review/requeue
-- =====================================================

CREATE OR REPLACE VIEW v_failed_posts_dlq AS
SELECT 
  p.id AS post_id,
  p.job_id,
  p.brand_id,
  p.batch_id,
  p.platform,
  p.video_url,
  p.title,
  p.status,
  p.attempt_count,
  p.last_attempt_at,
  p.next_attempt_at,
  p.error->>'class' AS error_class,
  p.error->>'signature' AS error_signature,
  p.error->>'message' AS error_message,
  p.error->>'failed_at' AS failed_at,
  p.scheduled_at,
  p.created_at,
  p.updated_at,
  gb.name AS campaign_name,
  gb.status AS campaign_status,
  CASE 
    WHEN p.attempt_count >= 3 THEN FALSE
    WHEN p.error->>'class' = 'permanent' THEN FALSE
    ELSE TRUE
  END AS retry_eligible
FROM posts p
LEFT JOIN generation_batches gb ON p.batch_id = gb.id
WHERE p.status = 'failed'
ORDER BY p.updated_at DESC;

GRANT SELECT ON v_failed_posts_dlq TO service_role;

COMMENT ON VIEW v_failed_posts_dlq IS 
'Dead Letter Queue view for failed posts. Shows error details and retry eligibility.
Posts with 3+ attempts or permanent errors are not retry eligible.';

-- =====================================================
-- PART 10: REQUEUE_FAILED_POST RPC
-- Manually requeue a failed post for retry
-- =====================================================

CREATE OR REPLACE FUNCTION requeue_failed_post(
  p_post_id UUID,
  p_delay_minutes INTEGER DEFAULT 5
)
RETURNS TABLE (
  success BOOLEAN,
  new_scheduled_at TIMESTAMPTZ,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status TEXT;
  v_attempt_count INTEGER;
  v_error_class TEXT;
BEGIN
  SELECT status, attempt_count, error->>'class' 
  INTO v_status, v_attempt_count, v_error_class
  FROM posts WHERE id = p_post_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, 'Post not found'::TEXT;
    RETURN;
  END IF;
  
  IF v_status != 'failed' THEN
    RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, 
      format('Post is not failed (status: %s)', v_status)::TEXT;
    RETURN;
  END IF;
  
  -- Check if retryable
  IF v_attempt_count >= 3 THEN
    RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, 
      'Post has reached max attempts (3). Consider manual intervention.'::TEXT;
    RETURN;
  END IF;
  
  IF v_error_class = 'permanent' THEN
    RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, 
      'Post has permanent error. Fix underlying issue before retrying.'::TEXT;
    RETURN;
  END IF;
  
  -- Requeue
  UPDATE posts
  SET 
    status = 'scheduled',
    scheduled_at = NOW() + (p_delay_minutes || ' minutes')::INTERVAL,
    error = NULL,
    updated_at = NOW()
  WHERE id = p_post_id
  RETURNING scheduled_at INTO v_status; -- reusing variable
  
  RETURN QUERY SELECT TRUE, (NOW() + (p_delay_minutes || ' minutes')::INTERVAL), NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION requeue_failed_post(UUID, INTEGER) TO service_role;

-- =====================================================
-- PART 11: UPDATE schedule_post_idempotent
-- Ensure batch_id is populated from job
-- =====================================================

CREATE OR REPLACE FUNCTION schedule_post_idempotent(
    p_job_id UUID,
    p_brand_id UUID,
    p_platform TEXT,
    p_scheduled_at TIMESTAMPTZ,
    p_video_url TEXT,
    p_title TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_tags TEXT[] DEFAULT NULL,
    p_meta JSONB DEFAULT '{}'::JSONB
)
RETURNS TABLE (
    post_id UUID,
    was_inserted BOOLEAN,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_id UUID;
    v_new_id UUID;
    v_batch_id UUID;
BEGIN
    -- Validate required inputs
    IF p_job_id IS NULL OR p_brand_id IS NULL OR p_platform IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, FALSE, 'job_id, brand_id, and platform are required'::TEXT;
        RETURN;
    END IF;

    -- Check if post already exists for this job + platform
    SELECT id INTO v_existing_id
    FROM posts
    WHERE job_id = p_job_id AND platform = p_platform;

    IF v_existing_id IS NOT NULL THEN
        -- Post already exists - return it without modification
        RETURN QUERY SELECT v_existing_id, FALSE, 'Post already scheduled for this job+platform'::TEXT;
        RETURN;
    END IF;

    -- Get batch_id from job for campaign gating
    SELECT batch_id INTO v_batch_id FROM jobs WHERE id = p_job_id;

    -- Insert new post
    INSERT INTO posts (
        job_id,
        brand_id,
        batch_id,
        platform,
        scheduled_at,
        video_url,
        title,
        description,
        tags,
        meta,
        status,
        attempt_count
    ) VALUES (
        p_job_id,
        p_brand_id,
        v_batch_id,
        p_platform,
        p_scheduled_at,
        p_video_url,
        p_title,
        p_description,
        p_tags,
        p_meta,
        'scheduled',
        0
    )
    RETURNING id INTO v_new_id;

    RETURN QUERY SELECT v_new_id, TRUE, NULL::TEXT;

EXCEPTION WHEN unique_violation THEN
    -- Race condition: another worker inserted between our check and insert
    SELECT id INTO v_existing_id
    FROM posts
    WHERE job_id = p_job_id AND platform = p_platform;
    
    RETURN QUERY SELECT v_existing_id, FALSE, 'Concurrent insert detected, returning existing'::TEXT;
END;
$$;

-- Grant already exists but re-grant for clarity
GRANT EXECUTE ON FUNCTION schedule_post_idempotent(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT[], JSONB) TO service_role;

-- =====================================================
-- PART 12: RLS POLICIES
-- =====================================================

-- Ensure service_role can manage posts
DROP POLICY IF EXISTS "service_role_posts" ON posts;
CREATE POLICY "service_role_posts" ON posts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- =====================================================
-- DOCUMENTATION
-- =====================================================

COMMENT ON COLUMN posts.locked_by IS 'Worker ID holding the lease (post-worker-{id})';
COMMENT ON COLUMN posts.locked_at IS 'When lease was acquired';
COMMENT ON COLUMN posts.lease_expires_at IS 'When lease expires (default 5 min)';
COMMENT ON COLUMN posts.attempt_count IS 'Number of posting attempts (max 3)';
COMMENT ON COLUMN posts.last_attempt_at IS 'When the last posting attempt started (set on claim)';
COMMENT ON COLUMN posts.next_attempt_at IS 'When the next retry is scheduled (set on backoff)';
COMMENT ON COLUMN posts.platform_post_id IS 'Platform-specific post ID after successful post';
COMMENT ON COLUMN posts.platform_url IS 'Public URL on platform after successful post';
COMMENT ON COLUMN posts.error IS 'Structured error: {class, signature, message, failed_at, attempt}';
COMMENT ON COLUMN posts.batch_id IS 'Campaign/batch ID for gating (from job)';
COMMENT ON COLUMN posts.idempotency_key IS 'Computed: job_id:platform - for debugging duplicate posts';

-- =====================================================
-- PART 13: POST QUEUE HEALTH VIEW
-- Quick "is it on fire?" dashboard
-- =====================================================

CREATE OR REPLACE VIEW v_post_queue_health AS
WITH stats AS (
  SELECT
    -- Due posts (scheduled and past due)
    COUNT(*) FILTER (
      WHERE status = 'scheduled' 
      AND scheduled_at <= NOW()
      AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
    ) AS due_count,
    
    -- Currently posting (active leases)
    COUNT(*) FILTER (WHERE status = 'posting') AS posting_count,
    
    -- Stale posting (lease expired but still in posting)
    COUNT(*) FILTER (
      WHERE status = 'posting' 
      AND lease_expires_at IS NOT NULL 
      AND lease_expires_at < NOW()
    ) AS stale_posting_count,
    
    -- Failed in last hour
    COUNT(*) FILTER (
      WHERE status = 'failed' 
      AND updated_at > NOW() - INTERVAL '1 hour'
    ) AS failed_last_1h,
    
    -- Failed in last 24h
    COUNT(*) FILTER (
      WHERE status = 'failed' 
      AND updated_at > NOW() - INTERVAL '24 hours'
    ) AS failed_last_24h,
    
    -- Total failed (DLQ size)
    COUNT(*) FILTER (WHERE status = 'failed') AS total_failed,
    
    -- Posted in last hour
    COUNT(*) FILTER (
      WHERE status = 'posted' 
      AND posted_at > NOW() - INTERVAL '1 hour'
    ) AS posted_last_1h,
    
    -- Posted in last 24h
    COUNT(*) FILTER (
      WHERE status = 'posted' 
      AND posted_at > NOW() - INTERVAL '24 hours'
    ) AS posted_last_24h,
    
    -- Average attempts for failed posts
    ROUND(AVG(attempt_count) FILTER (WHERE status = 'failed'), 2) AS avg_failed_attempts,
    
    -- Oldest due post age (minutes)
    EXTRACT(EPOCH FROM (NOW() - MIN(scheduled_at) FILTER (
      WHERE status = 'scheduled' 
      AND scheduled_at <= NOW()
    ))) / 60 AS oldest_due_age_minutes,
    
    -- Per-platform breakdown
    COUNT(*) FILTER (WHERE status = 'scheduled' AND platform = 'tiktok') AS tiktok_scheduled,
    COUNT(*) FILTER (WHERE status = 'scheduled' AND platform = 'youtube') AS youtube_scheduled,
    COUNT(*) FILTER (WHERE status = 'scheduled' AND platform = 'instagram') AS instagram_scheduled,
    COUNT(*) FILTER (WHERE status = 'failed' AND platform = 'tiktok') AS tiktok_failed,
    COUNT(*) FILTER (WHERE status = 'failed' AND platform = 'youtube') AS youtube_failed,
    COUNT(*) FILTER (WHERE status = 'failed' AND platform = 'instagram') AS instagram_failed
  FROM posts
)
SELECT 
  *,
  -- Health status indicator
  CASE
    WHEN stale_posting_count > 5 THEN 'CRITICAL: Stale leases'
    WHEN failed_last_1h > 10 THEN 'WARNING: High failure rate'
    WHEN oldest_due_age_minutes > 60 THEN 'WARNING: Queue backlog'
    WHEN due_count > 50 THEN 'CAUTION: Large queue'
    ELSE 'OK'
  END AS health_status,
  NOW() AS checked_at
FROM stats;

GRANT SELECT ON v_post_queue_health TO service_role;

COMMENT ON VIEW v_post_queue_health IS 
'Quick health check for post queue. Shows queue depth, failure rates, and platform breakdown.
Health status: OK, CAUTION, WARNING, CRITICAL based on thresholds.';

-- =====================================================
-- PART 14: POST FAILURE CLUSTERS (for cluster-protection)
-- Detect platform outages by error signature clustering
-- =====================================================

CREATE OR REPLACE FUNCTION get_post_failure_clusters(
  p_window_minutes INTEGER DEFAULT 10,
  p_min_failures INTEGER DEFAULT 5
)
RETURNS TABLE (
  error_signature TEXT,
  platform TEXT,
  failure_count BIGINT,
  first_failure TIMESTAMPTZ,
  last_failure TIMESTAMPTZ,
  sample_message TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT 
    p.error->>'signature' AS error_signature,
    p.platform,
    COUNT(*) AS failure_count,
    MIN(p.updated_at) AS first_failure,
    MAX(p.updated_at) AS last_failure,
    (array_agg(p.error->>'message' ORDER BY p.updated_at DESC))[1] AS sample_message
  FROM posts p
  WHERE 
    p.status = 'failed'
    AND p.updated_at > NOW() - (p_window_minutes || ' minutes')::INTERVAL
    AND p.error->>'signature' IS NOT NULL
  GROUP BY p.error->>'signature', p.platform
  HAVING COUNT(*) >= p_min_failures
  ORDER BY failure_count DESC;
$$;

GRANT EXECUTE ON FUNCTION get_post_failure_clusters(INTEGER, INTEGER) TO service_role;

COMMENT ON FUNCTION get_post_failure_clusters IS 
'Detect posting failure clusters by error signature. Use for auto-throttling or alerts.
Default: 5+ failures in 10 minutes of same signature indicates platform issue.';
