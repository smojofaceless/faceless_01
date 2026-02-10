-- =====================================================
-- JOB STEP LOGS - Visual Timeline + Debug Logging
-- Migration: 20260222003_job_step_logs.sql
-- =====================================================
-- 
-- Purpose:
--   - Per-job step logs with timestamps
--   - Store prompts + outputs snapshots for debugging
--   - Support visual timeline UI (future)
--   - Copy/paste friendly log messages
-- 
-- Related: Roadmap Item #7
-- =====================================================

-- =====================================================
-- 1. JOB_STEP_LOGS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS job_step_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('started', 'progress', 'completed', 'failed', 'snapshot')),
  message TEXT NOT NULL,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_job_step_logs_job_created 
ON job_step_logs (job_id, created_at);

CREATE INDEX IF NOT EXISTS idx_job_step_logs_job_step 
ON job_step_logs (job_id, step_name);

CREATE INDEX IF NOT EXISTS idx_job_step_logs_event_type
ON job_step_logs (event_type) WHERE event_type IN ('failed', 'snapshot');

-- =====================================================
-- 2. V_JOB_STEP_TIMELINE VIEW
-- Timeline-optimized view for UI display
-- =====================================================

CREATE OR REPLACE VIEW v_job_step_timeline AS
WITH step_summary AS (
  SELECT 
    job_id,
    step_name,
    MIN(created_at) AS first_seen,
    MAX(created_at) AS last_seen,
    COUNT(*) AS total_events,
    COUNT(*) FILTER (WHERE event_type = 'progress') AS progress_events,
    -- Final status: last non-progress event
    (
      SELECT event_type 
      FROM job_step_logs l2 
      WHERE l2.job_id = job_step_logs.job_id 
        AND l2.step_name = job_step_logs.step_name
        AND l2.event_type != 'progress'
      ORDER BY created_at DESC 
      LIMIT 1
    ) AS final_status,
    -- Last error message (if any)
    (
      SELECT message 
      FROM job_step_logs l3 
      WHERE l3.job_id = job_step_logs.job_id 
        AND l3.step_name = job_step_logs.step_name
        AND l3.event_type = 'failed'
      ORDER BY created_at DESC 
      LIMIT 1
    ) AS last_error,
    -- Last error meta (for details)
    (
      SELECT meta 
      FROM job_step_logs l4 
      WHERE l4.job_id = job_step_logs.job_id 
        AND l4.step_name = job_step_logs.step_name
        AND l4.event_type = 'failed'
      ORDER BY created_at DESC 
      LIMIT 1
    ) AS last_error_meta
  FROM job_step_logs
  GROUP BY job_id, step_name
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
  EXTRACT(EPOCH FROM (s.last_seen - s.first_seen))::NUMERIC(10,2) AS duration_seconds,
  s.total_events,
  s.progress_events,
  COALESCE(s.final_status, 'unknown') AS final_status,
  s.last_error,
  s.last_error_meta,
  -- Status indicator for UI
  CASE 
    WHEN s.final_status = 'completed' THEN '✅'
    WHEN s.final_status = 'failed' THEN '❌'
    WHEN s.final_status = 'started' THEN '🔄'
    ELSE '⏸️'
  END AS status_icon
FROM step_summary s
LEFT JOIN step_order so ON s.step_name = so.step_name
ORDER BY s.job_id, COALESCE(so.step_order, 99), s.first_seen;

COMMENT ON VIEW v_job_step_timeline IS 
'Timeline view for job steps. Shows duration, status, and errors per step. Optimized for future timeline UI.';

-- =====================================================
-- 3. V_JOB_LOGS_FORMATTED VIEW
-- Copy/paste friendly log output
-- =====================================================

CREATE OR REPLACE VIEW v_job_logs_formatted AS
SELECT 
  job_id,
  step_name,
  event_type,
  created_at,
  -- Formatted log line (copy-friendly)
  TO_CHAR(created_at, 'HH24:MI:SS') || ' [' || 
  UPPER(SUBSTRING(event_type, 1, 4)) || '] ' ||
  '[' || step_name || '] ' ||
  message AS log_line,
  -- Full timestamp for sorting
  created_at AS ts,
  -- Meta for expansion
  meta
FROM job_step_logs
ORDER BY job_id, created_at;

COMMENT ON VIEW v_job_logs_formatted IS 
'Formatted log lines for copy/paste into issues or debugging. Example: "10:32:45 [PROG] [images] scene 7/10 generated"';

-- =====================================================
-- 4. LOG_JOB_STEP_EVENT RPC
-- Lightweight logging function for worker
-- =====================================================

CREATE OR REPLACE FUNCTION log_job_step_event(
  p_job_id UUID,
  p_step_name TEXT,
  p_event_type TEXT,
  p_message TEXT,
  p_meta JSONB DEFAULT '{}'::jsonb
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
  INSERT INTO job_step_logs (job_id, step_name, event_type, message, meta)
  VALUES (p_job_id, p_step_name, p_event_type, p_message, p_meta)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION log_job_step_event TO service_role;

COMMENT ON FUNCTION log_job_step_event IS 
'Lightweight logging for worker steps. No joins, minimal overhead. Use for started/progress/completed/failed/snapshot events.';

-- =====================================================
-- 5. GET_JOB_STEP_LOGS RPC
-- Query logs for debugging/admin
-- =====================================================

CREATE OR REPLACE FUNCTION get_job_step_logs(
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
    -- Formatted log line
    TO_CHAR(l.created_at, 'HH24:MI:SS') || ' [' || 
    UPPER(SUBSTRING(l.event_type, 1, 4)) || '] ' ||
    '[' || l.step_name || '] ' ||
    l.message AS log_line
  FROM job_step_logs l
  WHERE l.job_id = p_job_id
    AND (p_step_name IS NULL OR l.step_name = p_step_name)
    AND (p_event_types IS NULL OR l.event_type = ANY(p_event_types))
  ORDER BY l.created_at ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_job_step_logs TO service_role;

COMMENT ON FUNCTION get_job_step_logs IS 
'Query job logs for debugging. Optional filters: step_name, event_types array. Returns formatted log_line for easy copy/paste.';

-- =====================================================
-- 6. GET_JOB_TIMELINE RPC
-- Get timeline summary for a job
-- =====================================================

CREATE OR REPLACE FUNCTION get_job_timeline(p_job_id UUID)
RETURNS TABLE (
  step_name TEXT,
  step_order INT,
  first_seen TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  duration_seconds NUMERIC,
  total_events BIGINT,
  final_status TEXT,
  status_icon TEXT,
  last_error TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT 
    step_name,
    step_order::INT,
    first_seen,
    last_seen,
    duration_seconds,
    total_events,
    final_status,
    status_icon,
    last_error
  FROM v_job_step_timeline
  WHERE job_id = p_job_id
  ORDER BY step_order, first_seen;
$$;

GRANT EXECUTE ON FUNCTION get_job_timeline TO service_role;

COMMENT ON FUNCTION get_job_timeline IS 
'Get step timeline summary for a job. Returns ordered steps with duration, status, and errors.';

-- =====================================================
-- 7. GET_JOB_SNAPSHOTS RPC
-- Get prompt/output snapshots for debugging
-- =====================================================

CREATE OR REPLACE FUNCTION get_job_snapshots(
  p_job_id UUID,
  p_step_name TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  step_name TEXT,
  created_at TIMESTAMPTZ,
  snapshot_type TEXT,
  meta JSONB
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT 
    id,
    step_name,
    created_at,
    COALESCE(meta->>'snapshot_type', 'unknown') AS snapshot_type,
    meta
  FROM job_step_logs
  WHERE job_id = p_job_id
    AND event_type = 'snapshot'
    AND (p_step_name IS NULL OR step_name = p_step_name)
  ORDER BY created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION get_job_snapshots TO service_role;

COMMENT ON FUNCTION get_job_snapshots IS 
'Get prompt/output snapshots for a job. Use for debugging prompts sent to OpenAI, ElevenLabs, etc.';

-- =====================================================
-- 8. RLS POLICIES
-- =====================================================

ALTER TABLE job_step_logs ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access to job_step_logs"
ON job_step_logs FOR ALL
USING (true)
WITH CHECK (true);

-- =====================================================
-- 9. GRANTS
-- =====================================================

GRANT SELECT ON v_job_step_timeline TO service_role;
GRANT SELECT ON v_job_logs_formatted TO service_role;

-- =====================================================
-- 10. CLEANUP FUNCTION (for maintenance)
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_old_job_logs(p_days_to_keep INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM job_step_logs
  WHERE created_at < NOW() - (p_days_to_keep || ' days')::INTERVAL
    AND job_id IN (
      SELECT id FROM jobs 
      WHERE status IN ('complete', 'failed', 'cancelled')
    );
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_old_job_logs TO service_role;

COMMENT ON FUNCTION cleanup_old_job_logs IS 
'Cleanup old logs for completed/failed/cancelled jobs. Default: keep 30 days. Call periodically to manage storage.';
