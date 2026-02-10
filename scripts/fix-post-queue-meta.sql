-- =====================================================
-- POST QUEUE FIX: meta -> ai_metadata
-- Apply this in Supabase Dashboard > SQL Editor
-- =====================================================

-- Fix claim_due_posts to use ai_metadata
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
  RETURN QUERY
  WITH claimable AS (
    SELECT p.id
    FROM posts p
    LEFT JOIN generation_batches gb ON p.batch_id = gb.id
    WHERE 
      p.status = 'scheduled'
      AND p.scheduled_at <= v_now
      AND (p.lease_expires_at IS NULL OR p.lease_expires_at < v_now)
      AND (gb.id IS NULL OR gb.status = 'active')
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

-- Fix mark_post_posted to use ai_metadata
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
  SELECT status, locked_by INTO v_current_status, v_current_locker
  FROM posts WHERE id = p_post_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Post not found'::TEXT;
    RETURN;
  END IF;
  
  IF v_current_status = 'posted' THEN
    RETURN QUERY SELECT TRUE, 'Already posted'::TEXT;
    RETURN;
  END IF;
  
  IF v_current_locker IS NOT NULL AND v_current_locker != p_worker_id THEN
    RETURN QUERY SELECT FALSE, format('Post locked by different worker: %s', v_current_locker)::TEXT;
    RETURN;
  END IF;
  
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

-- Confirm fix applied
SELECT 'Fix applied successfully. claim_due_posts and mark_post_posted now use ai_metadata.' as status;
