-- =====================================================
-- POST REGISTRY (Roadmap #17)
-- Anchor table for metrics — lifecycle tracking layer
-- =====================================================
-- 
-- Design Decision: The existing `posts` table already serves as the
-- per-platform anchor (one row per job+platform). Rather than creating
-- a redundant registry table, we extend `posts` with lifecycle timestamps
-- and add an append-only `post_lifecycle_events` table for audit/analytics.
--
-- Schema additions:
--   posts: posting_started_at, failed_at
--   post_lifecycle_events: append-only state transition log
--   v_post_registry: clean view (no queue internals)
--   5 RPCs for registry queries
--
-- Future: post_analytics, time_slot_scores, caption_versions will
-- JOIN to post_lifecycle_events and v_post_registry.
-- =====================================================

-- =====================================================
-- PART 1: LIFECYCLE TIMESTAMP COLUMNS ON posts
-- =====================================================

-- When the post entered 'posting' state (claimed by worker)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS posting_started_at TIMESTAMPTZ;

-- When the post permanently failed (not retryable failures)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;

-- Ensure posted_at exists (should already, but safe)
-- ALTER TABLE posts ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

-- Index for lifecycle queries
CREATE INDEX IF NOT EXISTS idx_posts_posting_started_at 
  ON posts (posting_started_at) WHERE posting_started_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_failed_at 
  ON posts (failed_at) WHERE failed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_posted_at 
  ON posts (posted_at) WHERE posted_at IS NOT NULL;

-- =====================================================
-- PART 2: POST LIFECYCLE EVENTS TABLE
-- Append-only audit trail for state transitions.
-- Every status change gets a row. Future analytics
-- (time-to-post, failure patterns, retry timing) will
-- query this table.
-- =====================================================

CREATE TABLE IF NOT EXISTS post_lifecycle_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,         -- 'scheduled', 'posting', 'posted', 'failed', 'requeued', 'cancelled'
  from_status TEXT,                  -- previous status (NULL for initial insert)
  to_status   TEXT NOT NULL,         -- new status
  platform    TEXT,                  -- denormalized for fast queries without JOIN
  brand_id    UUID,                  -- denormalized
  job_id      UUID,                  -- denormalized
  batch_id    UUID,                  -- denormalized (campaign link)
  worker_id   TEXT,                  -- which worker caused this transition
  meta        JSONB DEFAULT '{}',    -- extra context (error details, platform IDs, timing)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX idx_ple_post_id ON post_lifecycle_events (post_id, created_at);
CREATE INDEX idx_ple_event ON post_lifecycle_events (event, created_at);
CREATE INDEX idx_ple_brand_id ON post_lifecycle_events (brand_id, created_at) WHERE brand_id IS NOT NULL;
CREATE INDEX idx_ple_job_id ON post_lifecycle_events (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX idx_ple_batch_id ON post_lifecycle_events (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX idx_ple_platform ON post_lifecycle_events (platform, created_at) WHERE platform IS NOT NULL;
CREATE INDEX idx_ple_created_at ON post_lifecycle_events (created_at);

-- RLS: service_role full access, authenticated users read their brands
ALTER TABLE post_lifecycle_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY ple_service_role ON post_lifecycle_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY ple_select_own ON post_lifecycle_events
  FOR SELECT TO authenticated
  USING (brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid()));

GRANT SELECT ON post_lifecycle_events TO authenticated;
GRANT ALL ON post_lifecycle_events TO service_role;

COMMENT ON TABLE post_lifecycle_events IS 
'Append-only audit trail for post state transitions. Each status change
produces one row. Used for lifecycle tracking, debugging, and as the
foundation for future analytics (Roadmap #18-20). Never updated or deleted
during normal operations.';

-- =====================================================
-- PART 3: TRIGGER — Auto-record lifecycle events
-- Fires on posts INSERT and UPDATE, captures every
-- status transition automatically. No manual calls needed.
-- =====================================================

CREATE OR REPLACE FUNCTION fn_record_post_lifecycle_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event TEXT;
  v_meta JSONB := '{}';
BEGIN
  -- On INSERT, record the initial state
  IF TG_OP = 'INSERT' THEN
    v_event := COALESCE(NEW.status, 'scheduled');
    
    INSERT INTO post_lifecycle_events (
      post_id, event, from_status, to_status,
      platform, brand_id, job_id, batch_id, worker_id, meta
    ) VALUES (
      NEW.id, v_event, NULL, NEW.status,
      NEW.platform, NEW.brand_id, COALESCE(NEW.job_id, NEW.source_job_id), NEW.batch_id,
      NULL,
      jsonb_build_object('scheduled_at', NEW.scheduled_at)
    );
    RETURN NEW;
  END IF;

  -- On UPDATE, only record if status actually changed
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_event := NEW.status;
    
    -- Build context-specific meta
    CASE NEW.status
      WHEN 'posting' THEN
        v_meta := jsonb_build_object(
          'attempt_count', NEW.attempt_count,
          'worker_id', NEW.locked_by
        );
      WHEN 'posted' THEN
        v_meta := jsonb_build_object(
          'platform_post_id', NEW.platform_post_id,
          'platform_url', NEW.platform_url,
          'posted_at', NEW.posted_at,
          'attempt_count', NEW.attempt_count
        );
      WHEN 'failed' THEN
        v_meta := jsonb_build_object(
          'error', NEW.error,
          'attempt_count', NEW.attempt_count
        );
      WHEN 'cancelled' THEN
        v_meta := jsonb_build_object('cancelled_at', NOW());
      ELSE
        -- 'scheduled' (requeue), 'draft', 'approved'
        v_meta := jsonb_build_object(
          'attempt_count', NEW.attempt_count,
          'next_attempt_at', NEW.next_attempt_at
        );
    END CASE;
    
    INSERT INTO post_lifecycle_events (
      post_id, event, from_status, to_status,
      platform, brand_id, job_id, batch_id, worker_id, meta
    ) VALUES (
      NEW.id, v_event, OLD.status, NEW.status,
      NEW.platform, NEW.brand_id, COALESCE(NEW.job_id, NEW.source_job_id), NEW.batch_id,
      NEW.locked_by,
      v_meta
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger to posts table
DROP TRIGGER IF EXISTS trg_post_lifecycle ON posts;
CREATE TRIGGER trg_post_lifecycle
  AFTER INSERT OR UPDATE ON posts
  FOR EACH ROW
  EXECUTE FUNCTION fn_record_post_lifecycle_event();

COMMENT ON FUNCTION fn_record_post_lifecycle_event IS
'Trigger function that auto-records every post status transition into
post_lifecycle_events. Fires on INSERT (initial state) and UPDATE 
(status changes only). Denormalizes platform, brand_id, job_id, batch_id
for fast analytics queries without JOINs.';

-- =====================================================
-- PART 4: UPDATE EXISTING RPCs — Add lifecycle timestamps
-- Patch mark_post_posted and mark_post_failed to set
-- the new timestamp columns, and claim_due_posts for
-- posting_started_at.
-- =====================================================

-- 4a: Patch claim_due_posts — set posting_started_at on claim
-- (We recreate the full function to add the column update)
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
      last_attempt_at = v_now,
      next_attempt_at = NULL,
      posting_started_at = v_now,   -- NEW: lifecycle timestamp
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

-- 4b: Patch mark_post_failed — set failed_at for permanent failures
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
  SELECT status, locked_by, attempt_count, platform 
  INTO v_current_status, v_current_locker, v_attempt_count, v_platform
  FROM posts WHERE id = p_post_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TIMESTAMPTZ, 'Post not found'::TEXT;
    RETURN;
  END IF;
  
  IF v_current_locker IS NOT NULL AND v_current_locker != p_worker_id THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TIMESTAMPTZ, 
      format('Post locked by different worker: %s', v_current_locker)::TEXT;
    RETURN;
  END IF;
  
  v_error_sig := COALESCE(p_error_signature, 
    p_error_class || ':' || COALESCE(v_platform, 'unknown') || ':post'
  );
  
  IF NOT p_retryable OR v_attempt_count >= 3 THEN
    v_new_status := 'failed';
    v_next_retry := NULL;
  ELSE
    v_backoff_interval := CASE v_attempt_count
      WHEN 1 THEN INTERVAL '30 minutes'
      WHEN 2 THEN INTERVAL '2 hours'
      ELSE INTERVAL '4 hours'
    END;
    v_new_status := 'scheduled';
    v_next_retry := NOW() + v_backoff_interval;
  END IF;
  
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
    failed_at = CASE WHEN v_new_status = 'failed' THEN NOW() ELSE failed_at END,  -- NEW: lifecycle timestamp
    locked_by = NULL,
    locked_at = NULL,
    lease_expires_at = NULL,
    updated_at = NOW()
  WHERE id = p_post_id;
  
  RETURN QUERY SELECT TRUE, v_new_status, v_next_retry, NULL::TEXT;
END;
$$;

-- =====================================================
-- PART 5: v_post_registry VIEW
-- Clean registry view: job → post → platform mapping
-- with lifecycle state. No queue internals.
-- =====================================================

CREATE OR REPLACE VIEW v_post_registry AS
SELECT
  p.id                  AS post_id,
  p.job_id,
  p.source_job_id,
  p.brand_id,
  p.batch_id,
  p.platform,
  p.status,
  p.platform_post_id,
  p.platform_url,
  p.video_url,
  p.title,
  p.description,
  p.tags,
  -- Lifecycle timestamps
  p.created_at,
  p.scheduled_at,
  p.posting_started_at,
  p.posted_at,
  p.failed_at,
  -- Derived fields
  p.attempt_count,
  CASE 
    WHEN p.status = 'failed' AND COALESCE(p.attempt_count, 0) < 3 
         AND (p.error->>'class') NOT IN ('permanent', 'misconfig')
    THEN TRUE
    ELSE FALSE
  END AS retry_eligible,
  -- Timing metrics (for future analytics)
  CASE 
    WHEN p.posted_at IS NOT NULL AND p.posting_started_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (p.posted_at - p.posting_started_at))
    ELSE NULL
  END AS posting_duration_seconds,
  CASE
    WHEN p.posting_started_at IS NOT NULL AND p.scheduled_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (p.posting_started_at - p.scheduled_at))
    ELSE NULL
  END AS queue_wait_seconds,
  -- Error summary (without queue noise)
  p.error->>'class'     AS error_class,
  p.error->>'message'   AS error_message,
  -- Metadata
  p.ai_metadata,
  p.meta
FROM posts p;

GRANT SELECT ON v_post_registry TO authenticated;
GRANT SELECT ON v_post_registry TO service_role;

COMMENT ON VIEW v_post_registry IS
'Clean post registry view: maps job_id → post → platform with lifecycle state,
timing metrics, and retry eligibility. No queue internals (no locked_by, lease,
etc.). This is the primary query surface for UI, calendar, and future analytics.';

-- =====================================================
-- PART 6: v_job_post_summary VIEW
-- Per-job summary: how many platforms done, which pending
-- =====================================================

CREATE OR REPLACE VIEW v_job_post_summary AS
SELECT
  COALESCE(p.job_id, p.source_job_id)  AS job_id,
  p.brand_id,
  p.batch_id,
  COUNT(*)                              AS total_platforms,
  COUNT(*) FILTER (WHERE p.status = 'posted')     AS posted_count,
  COUNT(*) FILTER (WHERE p.status = 'failed')      AS failed_count,
  COUNT(*) FILTER (WHERE p.status = 'scheduled')   AS scheduled_count,
  COUNT(*) FILTER (WHERE p.status = 'posting')     AS posting_count,
  COUNT(*) FILTER (WHERE p.status = 'cancelled')   AS cancelled_count,
  CASE 
    WHEN COUNT(*) = COUNT(*) FILTER (WHERE p.status = 'posted') THEN 'all_posted'
    WHEN COUNT(*) FILTER (WHERE p.status = 'failed') > 0 THEN 'has_failures'
    WHEN COUNT(*) FILTER (WHERE p.status = 'posting') > 0 THEN 'in_progress'
    ELSE 'pending'
  END AS aggregate_status,
  MIN(p.scheduled_at)   AS first_scheduled,
  MAX(p.posted_at)      AS last_posted,
  jsonb_agg(jsonb_build_object(
    'platform', p.platform,
    'status', p.status,
    'platform_post_id', p.platform_post_id,
    'platform_url', p.platform_url,
    'posted_at', p.posted_at
  ) ORDER BY p.platform) AS platform_details
FROM posts p
WHERE p.job_id IS NOT NULL OR p.source_job_id IS NOT NULL
GROUP BY COALESCE(p.job_id, p.source_job_id), p.brand_id, p.batch_id;

GRANT SELECT ON v_job_post_summary TO authenticated;
GRANT SELECT ON v_job_post_summary TO service_role;

COMMENT ON VIEW v_job_post_summary IS
'Per-job post summary: aggregates all platform posts for a single job into
one row with counts by status, aggregate state, and platform details array.
Used for job detail modals and campaign overview dashboards.';

-- =====================================================
-- PART 7: RPCs
-- =====================================================

-- 7a: get_post_registry — Query the registry with filters
CREATE OR REPLACE FUNCTION get_post_registry(
  p_brand_id UUID DEFAULT NULL,
  p_batch_id UUID DEFAULT NULL,
  p_job_id UUID DEFAULT NULL,
  p_platform TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  post_id UUID,
  job_id UUID,
  brand_id UUID,
  batch_id UUID,
  platform TEXT,
  status TEXT,
  platform_post_id TEXT,
  platform_url TEXT,
  video_url TEXT,
  title TEXT,
  scheduled_at TIMESTAMPTZ,
  posting_started_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  attempt_count INTEGER,
  retry_eligible BOOLEAN,
  posting_duration_seconds DOUBLE PRECISION,
  error_class TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.post_id, r.job_id, r.brand_id, r.batch_id,
    r.platform, r.status, r.platform_post_id, r.platform_url,
    r.video_url, r.title, r.scheduled_at,
    r.posting_started_at, r.posted_at, r.failed_at,
    r.attempt_count, r.retry_eligible,
    r.posting_duration_seconds,
    r.error_class, r.error_message,
    r.created_at
  FROM v_post_registry r
  WHERE
    (p_brand_id IS NULL OR r.brand_id = p_brand_id)
    AND (p_batch_id IS NULL OR r.batch_id = p_batch_id)
    AND (p_job_id IS NULL OR r.job_id = p_job_id)
    AND (p_platform IS NULL OR r.platform = p_platform)
    AND (p_status IS NULL OR r.status = p_status)
  ORDER BY r.scheduled_at DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION get_post_registry(UUID, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_post_registry(UUID, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER) TO service_role;

COMMENT ON FUNCTION get_post_registry IS
'Query the post registry with optional filters. Returns clean registry data
without queue internals. Supports pagination. Used by UI for post lists,
calendar views, and campaign detail pages.';

-- 7b: get_posts_for_job — All platform posts for a specific job
CREATE OR REPLACE FUNCTION get_posts_for_job(
  p_job_id UUID
)
RETURNS TABLE (
  post_id UUID,
  platform TEXT,
  status TEXT,
  platform_post_id TEXT,
  platform_url TEXT,
  scheduled_at TIMESTAMPTZ,
  posting_started_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  attempt_count INTEGER,
  retry_eligible BOOLEAN,
  posting_duration_seconds DOUBLE PRECISION,
  error_class TEXT,
  error_message TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.post_id, r.platform, r.status,
    r.platform_post_id, r.platform_url,
    r.scheduled_at, r.posting_started_at, r.posted_at, r.failed_at,
    r.attempt_count, r.retry_eligible,
    r.posting_duration_seconds,
    r.error_class, r.error_message
  FROM v_post_registry r
  WHERE r.job_id = p_job_id OR r.source_job_id = p_job_id
  ORDER BY r.platform;
END;
$$;

GRANT EXECUTE ON FUNCTION get_posts_for_job(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_posts_for_job(UUID) TO service_role;

COMMENT ON FUNCTION get_posts_for_job IS
'Get all platform posts for a specific job. Returns per-platform status,
platform IDs/URLs, lifecycle timestamps, and retry eligibility.';

-- 7c: get_post_lifecycle — Event history for a single post
CREATE OR REPLACE FUNCTION get_post_lifecycle(
  p_post_id UUID
)
RETURNS TABLE (
  event_id UUID,
  event TEXT,
  from_status TEXT,
  to_status TEXT,
  worker_id TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ple.id AS event_id,
    ple.event,
    ple.from_status,
    ple.to_status,
    ple.worker_id,
    ple.meta,
    ple.created_at
  FROM post_lifecycle_events ple
  WHERE ple.post_id = p_post_id
  ORDER BY ple.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_post_lifecycle(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_post_lifecycle(UUID) TO service_role;

COMMENT ON FUNCTION get_post_lifecycle IS
'Get the full lifecycle event history for a single post. Returns all state
transitions in chronological order. Used for post detail modals, debugging,
and future time-to-post analytics.';

-- 7d: get_batch_post_summary — Campaign-level post summary
CREATE OR REPLACE FUNCTION get_batch_post_summary(
  p_batch_id UUID
)
RETURNS TABLE (
  job_id UUID,
  total_platforms INTEGER,
  posted_count INTEGER,
  failed_count INTEGER,
  scheduled_count INTEGER,
  posting_count INTEGER,
  aggregate_status TEXT,
  platform_details JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.job_id,
    s.total_platforms::INTEGER,
    s.posted_count::INTEGER,
    s.failed_count::INTEGER,
    s.scheduled_count::INTEGER,
    s.posting_count::INTEGER,
    s.aggregate_status,
    s.platform_details
  FROM v_job_post_summary s
  WHERE s.batch_id = p_batch_id
  ORDER BY s.first_scheduled ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_batch_post_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_batch_post_summary(UUID) TO service_role;

COMMENT ON FUNCTION get_batch_post_summary IS
'Get post summary for all jobs in a campaign batch. Shows per-job platform
status aggregation. Used for campaign detail page post status overview.';

-- 7e: cleanup_old_lifecycle_events — Maintenance
CREATE OR REPLACE FUNCTION cleanup_old_lifecycle_events(
  p_older_than_days INTEGER DEFAULT 90
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM post_lifecycle_events
  WHERE created_at < NOW() - (p_older_than_days || ' days')::INTERVAL;
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_old_lifecycle_events(INTEGER) TO service_role;

COMMENT ON FUNCTION cleanup_old_lifecycle_events IS
'Delete lifecycle events older than N days (default 90). Run periodically
as maintenance. Posts table retains final state permanently; this only
removes the transition history.';

-- =====================================================
-- PART 8: BACKFILL — Generate lifecycle events for
-- existing posts so the registry has history.
-- =====================================================

INSERT INTO post_lifecycle_events (post_id, event, from_status, to_status, platform, brand_id, job_id, batch_id, meta, created_at)
SELECT 
  p.id,
  'scheduled',
  NULL,
  'scheduled',
  p.platform,
  p.brand_id,
  COALESCE(p.job_id, p.source_job_id),
  p.batch_id,
  jsonb_build_object('backfill', true, 'scheduled_at', p.scheduled_at),
  COALESCE(p.created_at, NOW())
FROM posts p
WHERE NOT EXISTS (
  SELECT 1 FROM post_lifecycle_events ple WHERE ple.post_id = p.id
);

-- Backfill 'posted' events for posts that are already posted
INSERT INTO post_lifecycle_events (post_id, event, from_status, to_status, platform, brand_id, job_id, batch_id, meta, created_at)
SELECT 
  p.id,
  'posted',
  'posting',
  'posted',
  p.platform,
  p.brand_id,
  COALESCE(p.job_id, p.source_job_id),
  p.batch_id,
  jsonb_build_object(
    'backfill', true,
    'platform_post_id', p.platform_post_id,
    'platform_url', p.platform_url
  ),
  COALESCE(p.posted_at, p.updated_at, NOW())
FROM posts p
WHERE p.status = 'posted'
  AND p.posted_at IS NOT NULL;

-- Backfill 'failed' events for posts that are currently failed
INSERT INTO post_lifecycle_events (post_id, event, from_status, to_status, platform, brand_id, job_id, batch_id, meta, created_at)
SELECT 
  p.id,
  'failed',
  'posting',
  'failed',
  p.platform,
  p.brand_id,
  COALESCE(p.job_id, p.source_job_id),
  p.batch_id,
  jsonb_build_object('backfill', true, 'error', p.error),
  COALESCE(p.updated_at, NOW())
FROM posts p
WHERE p.status = 'failed';
