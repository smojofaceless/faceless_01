-- =====================================================
-- FIX: Auto-pause ONLY for dependency failures
-- Migration: 20260222_fix_autopause_dependency_only.sql
-- =====================================================
-- 
-- Previously: auto_pause_affected_campaigns paused for both 'dependency' AND 'misconfig'
-- Fix: Only pause for 'dependency' (service outages)
-- 
-- Rationale: 
--   - dependency: service is down, waiting and retrying makes sense
--   - misconfig: operator needs to fix config, pausing won't help
--   - permanent: bad data, will never succeed
--   - transient: short-lived, backoff handles it
-- =====================================================

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
  -- Get ONLY dependency-level clusters (service outages warrant auto-pause)
  -- NOTE: Do NOT auto-pause for misconfig/permanent - those need operator fix, not wait-and-retry
  FOR v_cluster IN
    SELECT * FROM get_failure_clusters(p_window_minutes, p_min_failures)
    WHERE failure_class = 'dependency'  -- ONLY dependency, not misconfig!
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

COMMENT ON FUNCTION auto_pause_affected_campaigns IS 
'Auto-pauses campaigns with dependency failure clusters. Only pauses for dependency class (service outages), NOT for misconfig/permanent (those need operator intervention, not wait-and-retry).';
