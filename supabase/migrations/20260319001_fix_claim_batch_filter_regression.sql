-- =====================================================
-- FIX: claim_due_posts batch filter regression
-- 
-- Problem: Migration 20260309001_post_registry.sql recreated
-- claim_due_posts with the old `gb.status = 'active'` filter,
-- undoing the fix from 20260303001 that allowed 'completed' batches.
-- Posts from completed batches could not be claimed.
--
-- Fix: Restore correct filter: NOT IN ('paused', 'cancelled')
-- Also preserves posting_started_at from 20260309001.
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
  RETURN QUERY
  WITH claimable AS (
    SELECT p.id
    FROM posts p
    LEFT JOIN generation_batches gb ON p.batch_id = gb.id
    WHERE 
      p.status = 'scheduled'
      AND p.scheduled_at <= v_now
      AND (p.lease_expires_at IS NULL OR p.lease_expires_at < v_now)
      -- Allow completed campaigns (only block paused/cancelled)
      AND (gb.id IS NULL OR gb.status NOT IN ('paused', 'cancelled'))
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
      posting_started_at = v_now,
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
