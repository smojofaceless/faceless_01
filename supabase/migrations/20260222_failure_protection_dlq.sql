-- =====================================================
-- FAILURE CLUSTER PROTECTION + DLQ
-- Migration: Phase 1 - Failure Classification Foundation
-- =====================================================

-- =====================================================
-- 1. SYSTEM CONFIG TABLE (for kill switch + global settings)
-- =====================================================

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- Insert kill switch (default: off)
INSERT INTO system_config (key, value, updated_by)
VALUES ('kill_switch', '{"enabled": false, "reason": null, "enabled_at": null}'::jsonb, 'system')
ON CONFLICT (key) DO NOTHING;

-- Insert failure protection config
INSERT INTO system_config (key, value, updated_by)
VALUES ('failure_protection', '{
  "cluster_window_minutes": 10,
  "cluster_threshold": 5,
  "auto_pause_enabled": true,
  "cooldown_minutes": 30
}'::jsonb, 'system')
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- 2. UPDATE_JOB_FAILURE RPC
-- Records structured failure info in jobs.meta.last_failure
-- =====================================================

CREATE OR REPLACE FUNCTION update_job_failure(
  p_job_id UUID,
  p_failure JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE jobs
  SET 
    meta = jsonb_set(
      jsonb_set(
        COALESCE(meta, '{}'::jsonb),
        '{last_failure}',
        p_failure
      ),
      '{failure_history}',
      -- Append to failure history (keep last 10)
      (
        SELECT jsonb_agg(f)
        FROM (
          SELECT f
          FROM jsonb_array_elements(
            COALESCE(meta->'failure_history', '[]'::jsonb) || jsonb_build_array(p_failure)
          ) AS f
          ORDER BY (f->>'at')::timestamptz DESC
          LIMIT 10
        ) sub
      )
    ),
    updated_at = NOW()
  WHERE id = p_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_job_failure TO service_role;

COMMENT ON FUNCTION update_job_failure IS 
'Records structured failure info in jobs.meta.last_failure and appends to failure_history (max 10 entries)';

-- =====================================================
-- 3. INDEX FOR FAILURE CLUSTER QUERIES
-- Partial index on failed jobs with last_failure
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_jobs_failure_cluster 
ON jobs (updated_at DESC)
WHERE status = 'failed' AND meta ? 'last_failure';

-- =====================================================
-- 4. GET_FAILURE_CLUSTERS RPC
-- Detects failure patterns for auto-pause decisions
-- =====================================================

CREATE OR REPLACE FUNCTION get_failure_clusters(
  p_window_minutes INT DEFAULT 10,
  p_min_count INT DEFAULT 5
)
RETURNS TABLE (
  failure_class TEXT,
  error_signature TEXT,
  step TEXT,
  sample_error TEXT,
  job_count BIGINT,
  campaign_ids UUID[],
  first_seen TIMESTAMPTZ,
  last_seen TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (j.meta->'last_failure'->>'class')::TEXT AS failure_class,
    (j.meta->'last_failure'->>'signature')::TEXT AS error_signature,
    (j.meta->'last_failure'->>'step')::TEXT AS step,
    (j.meta->'last_failure'->>'error')::TEXT AS sample_error,
    COUNT(*)::BIGINT AS job_count,
    ARRAY_AGG(DISTINCT j.batch_id) FILTER (WHERE j.batch_id IS NOT NULL) AS campaign_ids,
    MIN(j.updated_at) AS first_seen,
    MAX(j.updated_at) AS last_seen
  FROM jobs j
  WHERE 
    j.status = 'failed'
    AND j.meta ? 'last_failure'
    AND j.updated_at >= NOW() - (p_window_minutes || ' minutes')::INTERVAL
  GROUP BY 
    j.meta->'last_failure'->>'class',
    j.meta->'last_failure'->>'signature',
    j.meta->'last_failure'->>'step',
    j.meta->'last_failure'->>'error'
  HAVING COUNT(*) >= p_min_count
  ORDER BY COUNT(*) DESC, MAX(j.updated_at) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_failure_clusters TO service_role;

COMMENT ON FUNCTION get_failure_clusters IS 
'Returns failure clusters grouped by class and error signature within a time window.
Used by scheduler to detect dependency outages and trigger auto-pause.';

-- =====================================================
-- 5. IS_KILL_SWITCH_ACTIVE RPC
-- Fast check for global emergency stop
-- =====================================================

CREATE OR REPLACE FUNCTION is_kill_switch_active()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE((value->>'enabled')::boolean, false)
  FROM system_config
  WHERE key = 'kill_switch';
$$;

GRANT EXECUTE ON FUNCTION is_kill_switch_active TO service_role;

-- =====================================================
-- 6. SET_KILL_SWITCH RPC
-- Admin toggle for emergency stop
-- =====================================================

CREATE OR REPLACE FUNCTION set_kill_switch(
  p_enabled BOOLEAN,
  p_reason TEXT DEFAULT NULL,
  p_updated_by TEXT DEFAULT 'admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  UPDATE system_config
  SET 
    value = jsonb_build_object(
      'enabled', p_enabled,
      'reason', p_reason,
      'enabled_at', CASE WHEN p_enabled THEN NOW() ELSE NULL END,
      'disabled_at', CASE WHEN NOT p_enabled THEN NOW() ELSE NULL END
    ),
    updated_at = NOW(),
    updated_by = p_updated_by
  WHERE key = 'kill_switch'
  RETURNING value INTO v_result;
  
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION set_kill_switch TO service_role;

-- =====================================================
-- 7. AUTO-PAUSE CAMPAIGNS RPC
-- Pauses campaigns affected by dependency failures
-- =====================================================

-- Add columns to track auto-pause
ALTER TABLE generation_batches 
ADD COLUMN IF NOT EXISTS auto_paused_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS auto_pause_reason JSONB;

CREATE OR REPLACE FUNCTION auto_pause_affected_campaigns(
  p_window_minutes INT DEFAULT 10,
  p_min_failures INT DEFAULT 5,
  p_cooldown_minutes INT DEFAULT 30
)
RETURNS TABLE (
  campaign_id UUID,
  campaign_name TEXT,
  failure_class TEXT,
  failure_count BIGINT,
  action TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cluster RECORD;
  v_campaign_id UUID;
  v_campaign_name TEXT;
BEGIN
  -- Get dependency-level clusters only (these warrant auto-pause)
  FOR v_cluster IN
    SELECT * FROM get_failure_clusters(p_window_minutes, p_min_failures)
    WHERE failure_class IN ('dependency', 'misconfig')
  LOOP
    -- Process each affected campaign
    IF v_cluster.campaign_ids IS NOT NULL THEN
      FOREACH v_campaign_id IN ARRAY v_cluster.campaign_ids
      LOOP
        -- Get campaign name
        SELECT name INTO v_campaign_name 
        FROM generation_batches 
        WHERE id = v_campaign_id;
        
        -- Check cooldown: don't re-pause if recently auto-paused
        IF EXISTS (
          SELECT 1 FROM generation_batches
          WHERE id = v_campaign_id
          AND auto_paused_at IS NOT NULL
          AND auto_paused_at > NOW() - (p_cooldown_minutes || ' minutes')::INTERVAL
        ) THEN
          -- Still in cooldown, skip
          RETURN QUERY SELECT 
            v_campaign_id,
            v_campaign_name,
            v_cluster.failure_class,
            v_cluster.job_count,
            'skipped_cooldown'::TEXT;
          CONTINUE;
        END IF;
        
        -- Check if already paused
        IF EXISTS (
          SELECT 1 FROM generation_batches
          WHERE id = v_campaign_id
          AND status = 'paused'
        ) THEN
          RETURN QUERY SELECT 
            v_campaign_id,
            v_campaign_name,
            v_cluster.failure_class,
            v_cluster.job_count,
            'already_paused'::TEXT;
          CONTINUE;
        END IF;
        
        -- Pause the campaign
        UPDATE generation_batches
        SET 
          status = 'paused',
          auto_paused_at = NOW(),
          auto_pause_reason = jsonb_build_object(
            'failure_class', v_cluster.failure_class,
            'error_signature', v_cluster.error_signature,
            'sample_error', v_cluster.sample_error,
            'failure_count', v_cluster.job_count,
            'detected_at', NOW()
          ),
          updated_at = NOW()
        WHERE id = v_campaign_id
        AND status IN ('active', 'running');
        
        IF FOUND THEN
          RETURN QUERY SELECT 
            v_campaign_id,
            v_campaign_name,
            v_cluster.failure_class,
            v_cluster.job_count,
            'paused'::TEXT;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION auto_pause_affected_campaigns TO service_role;

-- =====================================================
-- 8. DLQ VIEW
-- Failed jobs with structured failure info for UI
-- =====================================================

CREATE OR REPLACE VIEW v_failed_jobs_dlq AS
SELECT 
  j.id AS job_id,
  j.batch_id AS campaign_id,
  gb.name AS campaign_name,
  j.brand_id,
  b.name AS brand_name,
  j.vibe_preset,
  
  -- Failure info (from meta.last_failure)
  (j.meta->'last_failure'->>'step')::TEXT AS failed_step,
  (j.meta->'last_failure'->>'class')::TEXT AS failure_class,
  (j.meta->'last_failure'->>'error')::TEXT AS error_message,
  (j.meta->'last_failure'->>'error_code')::TEXT AS error_code,
  (j.meta->'last_failure'->>'signature')::TEXT AS error_signature,
  
  -- Attempt tracking
  j.attempt_count,
  
  -- Timestamps
  (j.meta->'last_failure'->>'at')::TIMESTAMPTZ AS failed_at,
  j.created_at,
  j.updated_at,
  
  -- Retry eligibility
  CASE 
    WHEN (j.meta->'last_failure'->>'class') IN ('transient', 'dependency') 
      AND COALESCE(j.attempt_count, 0) < 3 
    THEN true 
    ELSE false 
  END AS can_retry,
  
  -- Age in hours
  EXTRACT(EPOCH FROM (NOW() - j.updated_at)) / 3600 AS hours_since_failure

FROM jobs j
LEFT JOIN generation_batches gb ON j.batch_id = gb.id
LEFT JOIN brands b ON j.brand_id = b.id
WHERE j.status = 'failed'
ORDER BY j.updated_at DESC;

GRANT SELECT ON v_failed_jobs_dlq TO service_role;

COMMENT ON VIEW v_failed_jobs_dlq IS 
'Dead Letter Queue view - shows all failed jobs with structured failure info for operator review and requeue decisions.';

-- =====================================================
-- 9. REQUEUE_FAILED_JOBS RPC
-- Safe requeue with backoff
-- =====================================================

CREATE OR REPLACE FUNCTION requeue_failed_jobs(
  p_job_ids UUID[],
  p_apply_backoff BOOLEAN DEFAULT true,
  p_force BOOLEAN DEFAULT false  -- Override class restrictions
)
RETURNS TABLE (
  job_id UUID,
  action TEXT,
  new_generate_by TIMESTAMPTZ,
  error TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job RECORD;
  v_failure_class TEXT;
  v_attempt_count INT;
  v_backoff_minutes INT;
  v_new_generate_by TIMESTAMPTZ;
BEGIN
  FOR v_job IN
    SELECT j.*, (j.meta->'last_failure'->>'class')::TEXT AS failure_class
    FROM jobs j
    WHERE j.id = ANY(p_job_ids)
    FOR UPDATE SKIP LOCKED  -- Avoid blocking
  LOOP
    v_failure_class := v_job.failure_class;
    v_attempt_count := COALESCE(v_job.attempt_count, 0);
    
    -- Check if job is actually failed
    IF v_job.status != 'failed' THEN
      RETURN QUERY SELECT v_job.id, 'skipped'::TEXT, NULL::TIMESTAMPTZ, 
        'Job is not in failed status'::TEXT;
      CONTINUE;
    END IF;
    
    -- Check failure class (unless forced)
    IF NOT p_force AND v_failure_class IS NOT NULL AND v_failure_class NOT IN ('transient', 'dependency') THEN
      RETURN QUERY SELECT v_job.id, 'rejected'::TEXT, NULL::TIMESTAMPTZ,
        format('Failure class "%s" is not retryable (use force=true to override)', v_failure_class)::TEXT;
      CONTINUE;
    END IF;
    
    -- Check max retries (3 attempts total)
    IF v_attempt_count >= 3 AND NOT p_force THEN
      RETURN QUERY SELECT v_job.id, 'rejected'::TEXT, NULL::TIMESTAMPTZ,
        format('Max retries exceeded (attempt %s of 3)', v_attempt_count)::TEXT;
      CONTINUE;
    END IF;
    
    -- Calculate backoff
    IF p_apply_backoff THEN
      v_backoff_minutes := CASE v_attempt_count
        WHEN 0 THEN 0      -- First attempt: immediate
        WHEN 1 THEN 30     -- Second attempt: +30 min
        WHEN 2 THEN 120    -- Third attempt: +2 hours
        ELSE 240           -- Beyond: +4 hours
      END;
      v_new_generate_by := NOW() + (v_backoff_minutes || ' minutes')::INTERVAL;
    ELSE
      v_new_generate_by := NOW(); -- Immediate
    END IF;
    
    -- Requeue the job
    UPDATE jobs
    SET 
      status = 'pending',
      locked_by = NULL,
      locked_at = NULL,
      lease_expires_at = NULL,
      generate_by = v_new_generate_by,
      -- Preserve meta.steps, add requeue event
      meta = jsonb_set(
        COALESCE(meta, '{}'::jsonb),
        '{requeue_history}',
        COALESCE(meta->'requeue_history', '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'requeued_at', NOW(),
            'from_attempt', v_attempt_count,
            'failure_class', v_failure_class,
            'backoff_minutes', v_backoff_minutes
          )
        )
      ),
      updated_at = NOW()
    WHERE id = v_job.id;
    
    RETURN QUERY SELECT v_job.id, 'requeued'::TEXT, v_new_generate_by, NULL::TEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION requeue_failed_jobs TO service_role;

-- Convenience: Requeue single job
CREATE OR REPLACE FUNCTION requeue_job(
  p_job_id UUID,
  p_apply_backoff BOOLEAN DEFAULT true,
  p_force BOOLEAN DEFAULT false
)
RETURNS TABLE (
  job_id UUID,
  action TEXT,
  new_generate_by TIMESTAMPTZ,
  error TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM requeue_failed_jobs(ARRAY[p_job_id], p_apply_backoff, p_force);
$$;

GRANT EXECUTE ON FUNCTION requeue_job TO service_role;

-- =====================================================
-- 10. RLS POLICIES
-- =====================================================

-- Allow service role to read/write system_config
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage system_config"
ON system_config FOR ALL
USING (true)
WITH CHECK (true);

GRANT ALL ON system_config TO service_role;

-- =====================================================
-- Done!
-- =====================================================

COMMENT ON TABLE system_config IS 
'Global system configuration including kill switch and failure protection settings';
