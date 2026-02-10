-- =====================================================
-- FIX: claim_job RPC - ambiguous column reference
-- Date: 2026-02-20
-- 
-- Problem: attempt_count column name conflicts between RETURNS TABLE and jobs table
-- Solution: Qualify column with table alias in UPDATE
-- =====================================================

CREATE OR REPLACE FUNCTION claim_job(
    p_job_id UUID,
    p_locked_by TEXT,
    p_lease_seconds INTEGER DEFAULT 900  -- 15 minutes default
)
RETURNS TABLE (
    claimed BOOLEAN,
    job_id UUID,
    job_status TEXT,
    brand_id UUID,
    batch_id UUID,
    generate_by TIMESTAMPTZ,
    scheduled_post_at TIMESTAMPTZ,
    attempt_count INTEGER,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_job RECORD;
    v_campaign_status TEXT;
    v_now TIMESTAMPTZ := NOW();
    v_lease_expires TIMESTAMPTZ := v_now + (p_lease_seconds || ' seconds')::interval;
    v_new_attempt_count INTEGER;
BEGIN
    -- Validate inputs
    IF p_job_id IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::UUID, 
                            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::INTEGER, 'job_id is required'::TEXT;
        RETURN;
    END IF;
    
    IF p_locked_by IS NULL OR p_locked_by = '' THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::UUID, 
                            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::INTEGER, 'locked_by is required'::TEXT;
        RETURN;
    END IF;
    
    -- Lock ONLY the jobs row (not the join)
    SELECT * INTO v_job
    FROM jobs
    WHERE id = p_job_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, p_job_id, NULL::TEXT, NULL::UUID, NULL::UUID, 
                            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::INTEGER, 'Job not found'::TEXT;
        RETURN;
    END IF;
    
    -- Check if job is in claimable status
    IF v_job.status NOT IN ('pending', 'queued') THEN
        RETURN QUERY SELECT FALSE, v_job.id, v_job.status, v_job.brand_id, v_job.batch_id, 
                            v_job.generate_by, v_job.scheduled_post_at, v_job.attempt_count, 
                            ('Job not claimable (status=' || v_job.status || ')')::TEXT;
        RETURN;
    END IF;
    
    -- Check if there's an active lease
    IF v_job.lease_expires_at IS NOT NULL AND v_job.lease_expires_at > v_now THEN
        RETURN QUERY SELECT FALSE, v_job.id, v_job.status, v_job.brand_id, v_job.batch_id, 
                            v_job.generate_by, v_job.scheduled_post_at, v_job.attempt_count, 
                            ('Job has active lease until ' || v_job.lease_expires_at || ' by ' || COALESCE(v_job.locked_by, 'unknown'))::TEXT;
        RETURN;
    END IF;
    
    -- Check campaign status separately (no FOR UPDATE needed)
    IF v_job.batch_id IS NOT NULL THEN
        SELECT status INTO v_campaign_status
        FROM generation_batches
        WHERE id = v_job.batch_id;
        
        IF v_campaign_status IN ('paused', 'cancelled') THEN
            RETURN QUERY SELECT FALSE, v_job.id, v_job.status, v_job.brand_id, v_job.batch_id, 
                                v_job.generate_by, v_job.scheduled_post_at, v_job.attempt_count, 
                                ('Campaign is ' || v_campaign_status)::TEXT;
            RETURN;
        END IF;
    END IF;
    
    -- Calculate new attempt count
    v_new_attempt_count := COALESCE(v_job.attempt_count, 0) + 1;
    
    -- Claim the job (use jobs. prefix to avoid ambiguity)
    UPDATE jobs j
    SET 
        status = 'generating',
        locked_at = v_now,
        locked_by = p_locked_by,
        lease_expires_at = v_lease_expires,
        attempt_count = v_new_attempt_count,
        error = NULL,
        updated_at = v_now
    WHERE j.id = p_job_id;
    
    -- Return success
    RETURN QUERY SELECT TRUE, v_job.id, 'generating'::TEXT, v_job.brand_id, v_job.batch_id, 
                        v_job.generate_by, v_job.scheduled_post_at, v_new_attempt_count, 
                        NULL::TEXT;
END;
$$;

-- Re-grant permissions
GRANT EXECUTE ON FUNCTION claim_job(UUID, TEXT, INTEGER) TO service_role;

COMMENT ON FUNCTION claim_job IS 'Atomically claim a job for processing with lease-based locking (v2 - fixed ambiguous column)';
