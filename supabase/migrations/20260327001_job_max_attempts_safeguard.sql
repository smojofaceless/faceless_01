-- =====================================================
-- MIGRATION: Job Max Attempts Safeguard
-- Date: 2026-03-01
-- 
-- Problem: find_eligible_jobs had no attempt_count cap, allowing
-- infinite retry loops when scheduler triggers fail (e.g. JWT issues).
-- Campaign 710c1425 accumulated 3,172 attempts on a single job.
--
-- Fix:
-- 1. Add attempt_count < 10 cap to find_eligible_jobs
-- 2. Add sweep_stuck_jobs() to auto-fail jobs exceeding max attempts
-- 3. Jobs that exceed 10 scheduler attempts are moved to 'failed'
-- =====================================================

-- =====================================================
-- PART 1: Update find_eligible_jobs with max attempt cap
-- =====================================================

CREATE OR REPLACE FUNCTION find_eligible_jobs(
    p_lead_time_hours INTEGER DEFAULT 24,
    p_max_jobs INTEGER DEFAULT 5
)
RETURNS TABLE (
    id UUID,
    brand_id UUID,
    batch_id UUID,
    scheduled_post_at TIMESTAMPTZ,
    generate_by TIMESTAMPTZ,
    meta JSONB,
    vibe_preset TEXT,
    campaign_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_lead_interval INTERVAL := (p_lead_time_hours || ' hours')::interval;
BEGIN
    RETURN QUERY
    SELECT 
        j.id,
        j.brand_id,
        j.batch_id,
        j.scheduled_post_at,
        COALESCE(j.generate_by, j.scheduled_post_at - v_lead_interval) AS generate_by,
        j.meta,
        j.vibe_preset,
        gb.status AS campaign_status
    FROM jobs j
    LEFT JOIN generation_batches gb ON j.batch_id = gb.id
    WHERE 
        -- Job is waiting to be scheduled
        j.status IN ('pending', 'queued')
        -- No active lease (never claimed, or lease expired)
        AND (j.lease_expires_at IS NULL OR j.lease_expires_at < v_now)
        -- Has a scheduled post time
        AND j.scheduled_post_at IS NOT NULL
        -- Has a brand
        AND j.brand_id IS NOT NULL
        -- Generate-by time has been reached
        AND COALESCE(j.generate_by, j.scheduled_post_at - v_lead_interval) <= v_now
        -- Campaign (if exists) is not paused or cancelled
        AND (
            j.batch_id IS NULL 
            OR gb.status NOT IN ('paused', 'cancelled')
        )
        -- SAFEGUARD: Max scheduler attempts (prevents infinite retry loops)
        AND COALESCE(j.attempt_count, 0) < 10
    ORDER BY 
        COALESCE(j.generate_by, j.scheduled_post_at - v_lead_interval) ASC
    LIMIT p_max_jobs;
END;
$$;

GRANT EXECUTE ON FUNCTION find_eligible_jobs(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION find_eligible_jobs(INTEGER, INTEGER) TO authenticated;

COMMENT ON FUNCTION find_eligible_jobs IS 
  'Find jobs eligible for scheduler pickup. Respects lease, campaign status, and max 10 attempts.';

-- =====================================================
-- PART 2: sweep_stuck_jobs - Auto-fail jobs with too many attempts
-- Runs as part of the scheduler cycle to clean up stuck jobs
-- =====================================================

CREATE OR REPLACE FUNCTION sweep_stuck_jobs(
    p_max_attempts INTEGER DEFAULT 10,
    p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
    jobs_failed INTEGER,
    job_ids UUID[],
    details JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_affected_jobs UUID[];
    v_details JSONB := '[]'::jsonb;
    v_job RECORD;
BEGIN
    -- Find stuck jobs: pending/queued with too many attempts
    FOR v_job IN
        SELECT j.id, j.status, j.attempt_count, j.error, j.batch_id, j.scheduled_post_at
        FROM jobs j
        WHERE j.status IN ('pending', 'queued')
          AND COALESCE(j.attempt_count, 0) >= p_max_attempts
        ORDER BY j.updated_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        -- Move to failed
        UPDATE jobs
        SET 
            status = 'failed',
            error = format('Exceeded max scheduler attempts (%s). Last error: %s', 
                          v_job.attempt_count, COALESCE(v_job.error, 'none')),
            locked_at = NULL,
            locked_by = NULL,
            lease_expires_at = NULL,
            updated_at = v_now
        WHERE id = v_job.id;
        
        v_affected_jobs := array_append(v_affected_jobs, v_job.id);
        v_details := v_details || jsonb_build_array(jsonb_build_object(
            'job_id', v_job.id,
            'attempts', v_job.attempt_count,
            'last_error', COALESCE(v_job.error, 'none'),
            'scheduled_post_at', v_job.scheduled_post_at
        ));
    END LOOP;
    
    RETURN QUERY SELECT 
        COALESCE(array_length(v_affected_jobs, 1), 0),
        COALESCE(v_affected_jobs, ARRAY[]::UUID[]),
        v_details;
END;
$$;

GRANT EXECUTE ON FUNCTION sweep_stuck_jobs(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION sweep_stuck_jobs(INTEGER, INTEGER) TO authenticated;

COMMENT ON FUNCTION sweep_stuck_jobs IS 
  'Auto-fail jobs that exceeded max scheduler attempts (default 10). Prevents infinite retry loops.';
