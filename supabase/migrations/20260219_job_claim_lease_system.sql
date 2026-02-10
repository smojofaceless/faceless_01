-- =====================================================
-- Migration: 20260219_job_claim_lease_system.sql
-- Purpose: Add Job Claim + Lease (lock) system for preventing stuck jobs
-- 
-- Reference: JOB_SCHEDULER.md, CAMPAIGN_SYSTEM.md
-- 
-- This migration:
-- 1. Adds lease/lock columns to jobs table
-- 2. Adds indexes for efficient claim queries
-- 3. Creates claim_job RPC (atomic claim with lease)
-- 4. Creates heartbeat_job RPC (extend lease during processing)
-- 5. Creates release_job RPC (release lock and set final status)
-- 6. Creates sweep_stale_jobs RPC (fail jobs with expired leases)
-- =====================================================

-- =====================================================
-- PART 1: ADD LEASE/LOCK COLUMNS TO JOBS
-- =====================================================

-- locked_at: When the job was claimed
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- locked_by: Identifier of who holds the lock (worker_id, scheduler_run_id, etc.)
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS locked_by TEXT;

-- lease_expires_at: When the lease expires (job becomes reclaimable if stuck)
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

-- attempt_count: How many times this job has been claimed
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

-- =====================================================
-- PART 2: ADD INDEXES FOR CLAIM + ELIGIBLE QUERIES
-- =====================================================

-- Index for finding claimable jobs (not started, or expired lease)
CREATE INDEX IF NOT EXISTS idx_jobs_claimable
ON jobs(status, lease_expires_at)
WHERE status IN ('pending', 'queued');

-- Index for finding stale in-progress jobs
CREATE INDEX IF NOT EXISTS idx_jobs_stale
ON jobs(status, lease_expires_at, updated_at)
WHERE status IN ('generating', 'assembling', 'rendering');

-- Index for lock lookup (used by heartbeat/release)
CREATE INDEX IF NOT EXISTS idx_jobs_locked_by
ON jobs(id, locked_by)
WHERE locked_by IS NOT NULL;

-- =====================================================
-- PART 3: CLAIM_JOB RPC
-- =====================================================

-- Atomically claim a job for processing
-- Returns: claimed boolean + job fields
-- 
-- Claim succeeds only if:
-- - status IN ('pending', 'queued')
-- - lease_expires_at IS NULL OR lease_expires_at < now() (no active lease)
-- - if batch_id exists, campaign status NOT IN ('paused', 'cancelled')
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
    v_claimed BOOLEAN := FALSE;
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
    
    -- Check if job exists and get current state
    SELECT j.*, gb.status AS campaign_status
    INTO v_job
    FROM jobs j
    LEFT JOIN generation_batches gb ON j.batch_id = gb.id
    WHERE j.id = p_job_id
    FOR UPDATE;  -- Lock the row for atomic update
    
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
    
    -- Check campaign status if job belongs to a campaign
    IF v_job.batch_id IS NOT NULL AND v_job.campaign_status IN ('paused', 'cancelled') THEN
        RETURN QUERY SELECT FALSE, v_job.id, v_job.status, v_job.brand_id, v_job.batch_id, 
                            v_job.generate_by, v_job.scheduled_post_at, v_job.attempt_count, 
                            ('Campaign is ' || v_job.campaign_status)::TEXT;
        RETURN;
    END IF;
    
    -- Claim the job
    UPDATE jobs
    SET 
        status = 'generating',
        locked_at = v_now,
        locked_by = p_locked_by,
        lease_expires_at = v_lease_expires,
        attempt_count = COALESCE(attempt_count, 0) + 1,
        error = NULL,  -- Clear previous error on new attempt
        updated_at = v_now
    WHERE id = p_job_id;
    
    -- Return success
    RETURN QUERY SELECT TRUE, v_job.id, 'generating'::TEXT, v_job.brand_id, v_job.batch_id, 
                        v_job.generate_by, v_job.scheduled_post_at, COALESCE(v_job.attempt_count, 0) + 1, 
                        NULL::TEXT;
END;
$$;

-- =====================================================
-- PART 4: HEARTBEAT_JOB RPC
-- =====================================================

-- Extend the lease for an in-progress job
-- Only succeeds if locked_by matches AND job is still in-progress
CREATE OR REPLACE FUNCTION heartbeat_job(
    p_job_id UUID,
    p_locked_by TEXT,
    p_lease_seconds INTEGER DEFAULT 900,  -- 15 minutes default
    p_progress INTEGER DEFAULT NULL,       -- Optional: update progress
    p_new_status TEXT DEFAULT NULL         -- Optional: update status (e.g., 'assembling')
)
RETURNS TABLE (
    success BOOLEAN,
    new_lease_expires_at TIMESTAMPTZ,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_job RECORD;
    v_now TIMESTAMPTZ := NOW();
    v_new_lease TIMESTAMPTZ := v_now + (p_lease_seconds || ' seconds')::interval;
BEGIN
    -- Validate inputs
    IF p_job_id IS NULL OR p_locked_by IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, 'job_id and locked_by are required'::TEXT;
        RETURN;
    END IF;
    
    -- Check job state
    SELECT * INTO v_job FROM jobs WHERE id = p_job_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, 'Job not found'::TEXT;
        RETURN;
    END IF;
    
    -- Verify lock ownership
    IF v_job.locked_by IS NULL OR v_job.locked_by != p_locked_by THEN
        RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, 
            ('Lock ownership mismatch (job locked by ' || COALESCE(v_job.locked_by, 'none') || ')')::TEXT;
        RETURN;
    END IF;
    
    -- Verify job is in-progress
    IF v_job.status NOT IN ('generating', 'assembling', 'rendering') THEN
        RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, 
            ('Job not in-progress (status=' || v_job.status || ')')::TEXT;
        RETURN;
    END IF;
    
    -- Update lease and optionally progress/status
    UPDATE jobs
    SET 
        lease_expires_at = v_new_lease,
        progress = COALESCE(p_progress, progress),
        status = COALESCE(p_new_status, status),
        updated_at = v_now
    WHERE id = p_job_id;
    
    RETURN QUERY SELECT TRUE, v_new_lease, NULL::TEXT;
END;
$$;

-- =====================================================
-- PART 5: RELEASE_JOB RPC
-- =====================================================

-- Release a job lock and set final status
-- Only succeeds if locked_by matches (safety)
-- Always clears lock fields on release
CREATE OR REPLACE FUNCTION release_job(
    p_job_id UUID,
    p_locked_by TEXT,
    p_new_status TEXT,
    p_error TEXT DEFAULT NULL,
    p_progress INTEGER DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    final_status TEXT,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_job RECORD;
    v_now TIMESTAMPTZ := NOW();
    v_allowed_statuses TEXT[] := ARRAY['pending', 'queued', 'complete', 'failed', 'cancelled'];
BEGIN
    -- Validate inputs
    IF p_job_id IS NULL OR p_locked_by IS NULL OR p_new_status IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, 'job_id, locked_by, and new_status are required'::TEXT;
        RETURN;
    END IF;
    
    -- Validate new_status is allowed
    IF NOT (p_new_status = ANY(v_allowed_statuses)) THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, 
            ('Invalid new_status. Allowed: ' || array_to_string(v_allowed_statuses, ', '))::TEXT;
        RETURN;
    END IF;
    
    -- Check job state
    SELECT * INTO v_job FROM jobs WHERE id = p_job_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, 'Job not found'::TEXT;
        RETURN;
    END IF;
    
    -- Verify lock ownership (allow release if locked_by matches OR if job is already terminal)
    IF v_job.status IN ('complete', 'failed', 'cancelled') THEN
        -- Job already terminal, nothing to do
        RETURN QUERY SELECT TRUE, v_job.status, 'Job already in terminal state'::TEXT;
        RETURN;
    END IF;
    
    IF v_job.locked_by IS NOT NULL AND v_job.locked_by != p_locked_by THEN
        RETURN QUERY SELECT FALSE, v_job.status, 
            ('Lock ownership mismatch (job locked by ' || v_job.locked_by || ')')::TEXT;
        RETURN;
    END IF;
    
    -- Release the job
    UPDATE jobs
    SET 
        status = p_new_status,
        error = COALESCE(p_error, CASE WHEN p_new_status = 'failed' THEN error ELSE NULL END),
        progress = COALESCE(p_progress, CASE WHEN p_new_status = 'complete' THEN 100 ELSE progress END),
        locked_at = NULL,
        locked_by = NULL,
        lease_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_job_id;
    
    RETURN QUERY SELECT TRUE, p_new_status, NULL::TEXT;
END;
$$;

-- =====================================================
-- PART 6: SWEEP_STALE_JOBS RPC
-- =====================================================

-- Find and fail stale jobs (DEFAULT ACTION: FAIL, NOT REQUEUE)
-- A job is stale if:
-- - Status is in-progress ('generating', 'assembling', 'rendering')
-- - AND (lease_expires_at < now() OR updated_at is too old)
CREATE OR REPLACE FUNCTION sweep_stale_jobs(
    p_max_age_minutes INTEGER DEFAULT 60,  -- Max time without heartbeat/update
    p_limit INTEGER DEFAULT 50              -- Max jobs to sweep per call
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
    v_max_age_threshold TIMESTAMPTZ := v_now - (p_max_age_minutes || ' minutes')::interval;
    v_affected_jobs UUID[];
    v_details JSONB := '[]'::jsonb;
    v_job RECORD;
    v_count INTEGER := 0;
BEGIN
    -- Find stale jobs
    FOR v_job IN
        SELECT id, status, locked_by, lease_expires_at, updated_at, error
        FROM jobs
        WHERE status IN ('generating', 'assembling', 'rendering')
          AND (
              -- Lease expired
              (lease_expires_at IS NOT NULL AND lease_expires_at < v_now)
              OR
              -- No recent update (heartbeat timeout)
              (updated_at < v_max_age_threshold)
          )
        ORDER BY updated_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED  -- Skip jobs being processed by other transactions
    LOOP
        -- Fail the job
        UPDATE jobs
        SET 
            status = 'failed',
            error = COALESCE(error, 'Stale job auto-failed (lease expired or heartbeat timeout)'),
            locked_at = NULL,
            locked_by = NULL,
            lease_expires_at = NULL,
            updated_at = v_now
        WHERE id = v_job.id;
        
        -- Track affected jobs
        v_affected_jobs := array_append(v_affected_jobs, v_job.id);
        v_details := v_details || jsonb_build_object(
            'job_id', v_job.id,
            'previous_status', v_job.status,
            'previous_locked_by', v_job.locked_by,
            'lease_expires_at', v_job.lease_expires_at,
            'last_updated', v_job.updated_at,
            'reason', CASE 
                WHEN v_job.lease_expires_at IS NOT NULL AND v_job.lease_expires_at < v_now 
                THEN 'lease_expired'
                ELSE 'heartbeat_timeout'
            END
        );
        v_count := v_count + 1;
    END LOOP;
    
    RETURN QUERY SELECT v_count, COALESCE(v_affected_jobs, ARRAY[]::UUID[]), v_details;
END;
$$;

-- =====================================================
-- PART 7: UPDATE find_eligible_jobs TO RESPECT LEASE
-- =====================================================

-- Drop and recreate to add lease check
DROP FUNCTION IF EXISTS find_eligible_jobs(INTEGER, INTEGER);

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
    ORDER BY 
        COALESCE(j.generate_by, j.scheduled_post_at - v_lead_interval) ASC
    LIMIT p_max_jobs;
END;
$$;

-- =====================================================
-- PART 8: GRANT PERMISSIONS
-- =====================================================

-- Grant execute to service role (for Edge Functions)
GRANT EXECUTE ON FUNCTION claim_job(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION heartbeat_job(UUID, TEXT, INTEGER, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION release_job(UUID, TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION sweep_stale_jobs(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION find_eligible_jobs(INTEGER, INTEGER) TO service_role;

-- Grant to authenticated for admin UI access
GRANT EXECUTE ON FUNCTION sweep_stale_jobs(INTEGER, INTEGER) TO authenticated;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

COMMENT ON FUNCTION claim_job IS 'Atomically claim a job for processing with lease-based locking';
COMMENT ON FUNCTION heartbeat_job IS 'Extend job lease during processing; must match locked_by';
COMMENT ON FUNCTION release_job IS 'Release job lock and set final status; clears all lock fields';
COMMENT ON FUNCTION sweep_stale_jobs IS 'Fail stale jobs with expired leases or heartbeat timeouts';
COMMENT ON COLUMN jobs.locked_at IS 'Timestamp when job was claimed';
COMMENT ON COLUMN jobs.locked_by IS 'Identifier of lock holder (worker_id, scheduler_run_id)';
COMMENT ON COLUMN jobs.lease_expires_at IS 'When the lease expires; job becomes reclaimable after this';
COMMENT ON COLUMN jobs.attempt_count IS 'Number of times this job has been claimed/attempted';
