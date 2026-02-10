-- =====================================================
-- JOB STEP LOGS HARDENING
-- Migration: 20260222004_job_step_logs_hardening.sql
-- =====================================================
-- 
-- Fixes from verification checklist:
-- 1. RLS: Restrict to service_role only (anon/auth cannot write)
-- 2. Add attempt + worker_id columns for correlation
-- 3. Update timeline view to handle attempts
-- 4. Fix cleanup to handle edge cases
-- =====================================================

-- =====================================================
-- 1. ADD COLUMNS FOR ATTEMPT + WORKER CORRELATION
-- =====================================================

-- Add attempt number (which attempt this log belongs to)
ALTER TABLE job_step_logs 
ADD COLUMN IF NOT EXISTS attempt INT DEFAULT 1;

-- Add worker_id for correlation (which worker run this log belongs to)
ALTER TABLE job_step_logs 
ADD COLUMN IF NOT EXISTS worker_id TEXT;

-- Index for filtering by worker
CREATE INDEX IF NOT EXISTS idx_job_step_logs_worker
ON job_step_logs (worker_id) WHERE worker_id IS NOT NULL;

-- =====================================================
-- 2. FIX RLS POLICIES - SERVICE_ROLE ONLY
-- =====================================================

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Service role full access to job_step_logs" ON job_step_logs;

-- Create proper service_role only policies
-- Note: service_role bypasses RLS by default, but we add explicit policies for clarity

-- Service role: full access (INSERT/SELECT/UPDATE/DELETE)
CREATE POLICY "service_role_full_access_job_step_logs"
ON job_step_logs FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Anon/authenticated: NO access (explicitly deny by having no policy)
-- RLS is enabled, and without a matching policy, they get nothing

-- =====================================================
-- 3. UPDATE LOG_JOB_STEP_EVENT RPC - ADD ATTEMPT + WORKER_ID
-- =====================================================

CREATE OR REPLACE FUNCTION log_job_step_event(
  p_job_id UUID,
  p_step_name TEXT,
  p_event_type TEXT,
  p_message TEXT,
  p_meta JSONB DEFAULT '{}'::jsonb,
  p_attempt INT DEFAULT 1,
  p_worker_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  -- Validate event type
  IF p_event_type NOT IN ('started', 'progress', 'completed', 'failed', 'snapshot') THEN
    RAISE EXCEPTION 'Invalid event_type: %. Must be one of: started, progress, completed, failed, snapshot', p_event_type;
  END IF;

  -- Insert log entry (no joins, fast)
  INSERT INTO job_step_logs (job_id, step_name, event_type, message, meta, attempt, worker_id)
  VALUES (p_job_id, p_step_name, p_event_type, p_message, p_meta, COALESCE(p_attempt, 1), p_worker_id)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- Only service_role can execute (specify full signature for new function)
REVOKE EXECUTE ON FUNCTION log_job_step_event(UUID, TEXT, TEXT, TEXT, JSONB, INT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION log_job_step_event(UUID, TEXT, TEXT, TEXT, JSONB, INT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION log_job_step_event(UUID, TEXT, TEXT, TEXT, JSONB, INT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION log_job_step_event(UUID, TEXT, TEXT, TEXT, JSONB, INT, TEXT) TO service_role;

-- Also revoke on old signature if it exists
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION log_job_step_event(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION log_job_step_event(UUID, TEXT, TEXT, TEXT, JSONB) FROM anon;
  REVOKE EXECUTE ON FUNCTION log_job_step_event(UUID, TEXT, TEXT, TEXT, JSONB) FROM authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

COMMENT ON FUNCTION log_job_step_event(UUID, TEXT, TEXT, TEXT, JSONB, INT, TEXT) IS 
'Lightweight logging for worker steps. SERVICE_ROLE ONLY. Includes attempt number and worker_id for correlation.';

-- =====================================================
-- 4. UPDATE V_JOB_STEP_TIMELINE VIEW - HANDLE ATTEMPTS
-- =====================================================

-- Must drop and recreate since column types changed
DROP VIEW IF EXISTS v_job_step_timeline CASCADE;

CREATE VIEW v_job_step_timeline AS
WITH step_attempts AS (
  -- Group by job, step, and attempt to get per-attempt stats
  SELECT 
    l.job_id,
    l.step_name,
    COALESCE(l.attempt, 1) AS attempt,
    MIN(l.created_at) AS attempt_start,
    MAX(l.created_at) AS attempt_end,
    COUNT(*) AS events_in_attempt,
    -- Final status for this attempt (completed or failed)
    MAX(CASE WHEN l.event_type IN ('completed', 'failed') THEN l.event_type ELSE NULL END) AS attempt_status
  FROM job_step_logs l
  GROUP BY l.job_id, l.step_name, COALESCE(l.attempt, 1)
),
step_summary AS (
  SELECT 
    job_id,
    step_name,
    -- Overall stats
    MIN(attempt_start) AS first_seen,
    MAX(attempt_end) AS last_seen,
    SUM(events_in_attempt) AS total_events,
    MAX(attempt) AS max_attempt,
    -- Count completed/failed attempts
    COUNT(*) FILTER (WHERE attempt_status = 'completed') AS completed_attempts,
    COUNT(*) FILTER (WHERE attempt_status = 'failed') AS failed_attempts
  FROM step_attempts
  GROUP BY job_id, step_name
),
latest_attempt AS (
  -- Get the latest attempt's stats for each step
  SELECT DISTINCT ON (job_id, step_name)
    sa.job_id,
    sa.step_name,
    sa.attempt AS latest_attempt_num,
    sa.attempt_status AS latest_attempt_status,
    EXTRACT(EPOCH FROM (sa.attempt_end - sa.attempt_start))::NUMERIC(10,2) AS latest_attempt_duration
  FROM step_attempts sa
  ORDER BY sa.job_id, sa.step_name, sa.attempt DESC
),
last_errors AS (
  -- Get the last error for each step
  SELECT DISTINCT ON (job_id, step_name)
    job_id,
    step_name,
    message AS last_error,
    meta AS last_error_meta
  FROM job_step_logs
  WHERE event_type = 'failed'
  ORDER BY job_id, step_name, created_at DESC
),
step_order AS (
  SELECT 
    unnest(ARRAY['story', 'uniqueness', 'scenes', 'voice', 'music', 'images', 'subtitles', 'assemble', 'upload', 'schedule']) AS step_name,
    generate_series(1, 10) AS step_order
)
SELECT 
  s.job_id,
  s.step_name,
  so.step_order,
  s.first_seen,
  s.last_seen,
  la.latest_attempt_duration AS duration_seconds,
  s.total_events,
  s.max_attempt AS attempt_count,
  s.completed_attempts,
  s.failed_attempts,
  -- Final status from latest attempt, or 'in_progress' if started but not finished
  COALESCE(
    la.latest_attempt_status, 
    CASE WHEN s.total_events > 0 THEN 'in_progress' ELSE 'unknown' END
  ) AS final_status,
  -- Status indicator for UI
  CASE 
    WHEN la.latest_attempt_status = 'completed' THEN '✅'
    WHEN la.latest_attempt_status = 'failed' THEN '❌'
    WHEN s.total_events > 0 AND la.latest_attempt_status IS NULL THEN '🔄' -- Started but not finished
    ELSE '⏸️'
  END AS status_icon,
  le.last_error,
  le.last_error_meta
FROM step_summary s
LEFT JOIN latest_attempt la ON s.job_id = la.job_id AND s.step_name = la.step_name
LEFT JOIN last_errors le ON s.job_id = le.job_id AND s.step_name = le.step_name
LEFT JOIN step_order so ON s.step_name = so.step_name
ORDER BY s.job_id, COALESCE(so.step_order, 99), s.first_seen;

COMMENT ON VIEW v_job_step_timeline IS 
'Timeline view for job steps. Shows duration (latest attempt), status, attempts, and errors. Handles worker crashes (in_progress status) and multiple attempts.';

-- =====================================================
-- 5. UPDATE CLEANUP FUNCTION - SAFER DELETION
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_old_job_logs(p_days_to_keep INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted INT;
BEGIN
  -- Delete logs where:
  -- 1. Job is in terminal state (complete/failed/cancelled) AND older than p_days_to_keep
  -- OR
  -- 2. Log is VERY old (2x retention) regardless of job status (safety net for orphaned logs)
  DELETE FROM job_step_logs
  WHERE 
    (
      -- Normal cleanup: terminal jobs older than retention
      created_at < NOW() - (p_days_to_keep || ' days')::INTERVAL
      AND job_id IN (
        SELECT id FROM jobs 
        WHERE status IN ('complete', 'failed', 'cancelled')
      )
    )
    OR
    (
      -- Safety net: very old logs regardless of status (2x retention)
      created_at < NOW() - (p_days_to_keep * 2 || ' days')::INTERVAL
    );
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Only service_role can execute cleanup
REVOKE EXECUTE ON FUNCTION cleanup_old_job_logs(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cleanup_old_job_logs(INT) FROM anon;
REVOKE EXECUTE ON FUNCTION cleanup_old_job_logs(INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_job_logs(INT) TO service_role;

COMMENT ON FUNCTION cleanup_old_job_logs(INT) IS 
'Cleanup old logs. Only deletes for terminal jobs (complete/failed/cancelled) OR very old logs (2x retention as safety net). SERVICE_ROLE ONLY.';

-- =====================================================
-- 6. REVOKE ACCESS FROM OTHER RPCS TOO
-- =====================================================

-- get_job_step_logs: service_role only
REVOKE EXECUTE ON FUNCTION get_job_step_logs(UUID, TEXT, TEXT[], INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_job_step_logs(UUID, TEXT, TEXT[], INT) FROM anon;
REVOKE EXECUTE ON FUNCTION get_job_step_logs(UUID, TEXT, TEXT[], INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_job_step_logs(UUID, TEXT, TEXT[], INT) TO service_role;

-- get_job_timeline: service_role only
REVOKE EXECUTE ON FUNCTION get_job_timeline(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_job_timeline(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION get_job_timeline(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_job_timeline(UUID) TO service_role;

-- get_job_snapshots: service_role only
REVOKE EXECUTE ON FUNCTION get_job_snapshots(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_job_snapshots(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION get_job_snapshots(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_job_snapshots(UUID, TEXT) TO service_role;

-- =====================================================
-- 7. UPDATE GET_JOB_STEP_LOGS TO INCLUDE NEW COLUMNS
-- =====================================================

-- Drop old version (return type changed)
DROP FUNCTION IF EXISTS get_job_step_logs(UUID, TEXT, TEXT[], INT);

CREATE FUNCTION get_job_step_logs(
  p_job_id UUID,
  p_step_name TEXT DEFAULT NULL,
  p_event_types TEXT[] DEFAULT NULL,
  p_limit INT DEFAULT 500
)
RETURNS TABLE (
  id UUID,
  step_name TEXT,
  event_type TEXT,
  message TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ,
  attempt INT,
  worker_id TEXT,
  log_line TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    l.id,
    l.step_name,
    l.event_type,
    l.message,
    l.meta,
    l.created_at,
    COALESCE(l.attempt, 1) AS attempt,
    l.worker_id,
    -- Formatted log line with attempt
    TO_CHAR(l.created_at, 'HH24:MI:SS') || ' [' || 
    UPPER(SUBSTRING(l.event_type, 1, 4)) || '] ' ||
    '[' || l.step_name || '] ' ||
    CASE WHEN COALESCE(l.attempt, 1) > 1 THEN '[A' || l.attempt || '] ' ELSE '' END ||
    l.message AS log_line
  FROM job_step_logs l
  WHERE l.job_id = p_job_id
    AND (p_step_name IS NULL OR l.step_name = p_step_name)
    AND (p_event_types IS NULL OR l.event_type = ANY(p_event_types))
  ORDER BY l.created_at ASC
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION get_job_step_logs(UUID, TEXT, TEXT[], INT) IS 
'Query job logs for debugging. Includes attempt number and worker_id. Log lines show [A2] prefix for retries.';

