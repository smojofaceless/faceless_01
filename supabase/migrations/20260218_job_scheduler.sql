-- =====================================================
-- Migration: 20260211_job_scheduler.sql
-- Purpose: Add job scheduler support (generate_by, RPCs, status fixes)
-- 
-- Reference: JOB_SCHEDULER.md, CAMPAIGN_SYSTEM.md
-- 
-- This migration:
-- 1. Adds 'pending' and 'cancelled' to jobs status constraint
-- 2. Adds 'generate_by' column to jobs table
-- 3. Creates find_eligible_jobs RPC
-- 4. Creates claim_job_for_scheduler RPC
-- 5. Updates create_campaign to compute generate_by
-- =====================================================

-- =====================================================
-- PART 1: FIX JOB STATUS CONSTRAINT
-- =====================================================

-- Add 'pending' (pre-scheduled, waiting for generate_by time)
-- Add 'cancelled' (job cancelled by campaign cancellation)
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check 
    CHECK (status IN (
        'pending',      -- Campaign-created, waiting for scheduler (generate_by not reached)
        'queued',       -- Ready to run (legacy: direct creation OR generate_by reached)
        'preview',      -- Preview mode (partial run)
        'generating',   -- Active: story/images being generated
        'assembling',   -- Active: video being assembled
        'rendering',    -- Active: FFmpeg render in progress
        'complete',     -- Done successfully
        'failed',       -- Terminal failure
        'cancelled'     -- Cancelled (campaign cancelled or manual)
    ));

-- =====================================================
-- PART 2: ADD GENERATE_BY COLUMN TO JOBS
-- =====================================================

-- generate_by: The timestamp when this job becomes eligible for scheduling
-- Computed as: scheduled_post_at - lead_time_hours (from campaign config)
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS generate_by TIMESTAMPTZ;

-- Index for scheduler query efficiency
CREATE INDEX IF NOT EXISTS idx_jobs_generate_by 
ON jobs(generate_by) 
WHERE status = 'pending' AND generate_by IS NOT NULL;

-- Composite index for scheduler query
CREATE INDEX IF NOT EXISTS idx_jobs_scheduler_eligible
ON jobs(status, generate_by, scheduled_post_at)
WHERE status IN ('pending', 'queued') AND scheduled_post_at IS NOT NULL;

-- =====================================================
-- PART 3: FIND_ELIGIBLE_JOBS RPC
-- =====================================================

-- Find jobs eligible for scheduling
-- Returns jobs where:
-- - status = 'pending' or 'queued'
-- - scheduled_post_at IS NOT NULL
-- - generate_by <= NOW() (or computed from scheduled_post_at if null)
-- - Campaign (if exists) is not paused/cancelled
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
-- PART 4: CLAIM_JOB_FOR_SCHEDULER RPC
-- =====================================================

-- Atomically claim a job for the scheduler
-- Returns true if claim succeeded, false if job was already claimed
-- Uses row-level locking to prevent race conditions
CREATE OR REPLACE FUNCTION claim_job_for_scheduler(
    p_job_id UUID,
    p_scheduler_run_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_claimed BOOLEAN := false;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    -- Attempt to claim with row-level lock
    -- Only succeeds if job is still in 'pending' or 'queued' status
    UPDATE jobs
    SET 
        status = 'generating',
        meta = jsonb_set(
            jsonb_set(
                COALESCE(meta, '{}'::jsonb),
                '{scheduler_started_at}',
                to_jsonb(v_now)
            ),
            '{scheduler_run_id}',
            to_jsonb(p_scheduler_run_id)
        ),
        updated_at = v_now
    WHERE id = p_job_id
      AND status IN ('pending', 'queued')
    RETURNING true INTO v_claimed;
    
    RETURN COALESCE(v_claimed, false);
END;
$$;

-- =====================================================
-- PART 5: UPDATE CREATE_CAMPAIGN TO SET GENERATE_BY
-- =====================================================

-- Drop existing function to recreate with new signature
DROP FUNCTION IF EXISTS create_campaign(UUID, TEXT, INTEGER, JSONB, JSONB[]);

-- Recreate with generate_by support
CREATE OR REPLACE FUNCTION create_campaign(
    p_brand_id UUID,
    p_name TEXT,
    p_video_count INTEGER,
    p_config JSONB,
    p_jobs JSONB[]  -- Array of job objects with scheduled_post_at, vibe_preset, meta
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_campaign_id UUID;
    v_job JSONB;
    v_job_id UUID;
    v_lead_time_hours INTEGER;
    v_scheduled_at TIMESTAMPTZ;
    v_generate_by TIMESTAMPTZ;
BEGIN
    -- Validate inputs
    IF p_brand_id IS NULL THEN
        RAISE EXCEPTION 'brand_id is required';
    END IF;
    
    IF p_video_count < 1 OR p_video_count > 100 THEN
        RAISE EXCEPTION 'video_count must be between 1 and 100';
    END IF;
    
    IF array_length(p_jobs, 1) != p_video_count THEN
        RAISE EXCEPTION 'jobs array length (%) must match video_count (%)', 
            array_length(p_jobs, 1), p_video_count;
    END IF;
    
    -- Extract lead time from config (default 24 hours)
    -- Supports both 'lead_time_hours' and 'generation_lead_time_hours' for compatibility
    v_lead_time_hours := COALESCE(
        (p_config->>'lead_time_hours')::integer,
        (p_config->>'generation_lead_time_hours')::integer,
        24
    );
    
    -- Create campaign record
    INSERT INTO generation_batches (
        brand_id,
        name,
        video_count,
        themes,
        settings,
        config,
        status,
        videos,
        created_at
    ) VALUES (
        p_brand_id,
        COALESCE(p_name, 'Campaign ' || to_char(NOW(), 'Mon DD, YYYY')),
        p_video_count,
        ARRAY[]::TEXT[],  -- themes not used for v1 campaigns
        '{}'::jsonb,
        p_config,
        'planned',
        '[]'::jsonb,
        NOW()
    )
    RETURNING id INTO v_campaign_id;
    
    -- Create job records with generate_by computed
    FOREACH v_job IN ARRAY p_jobs
    LOOP
        -- Parse scheduled_post_at
        v_scheduled_at := (v_job->>'scheduled_post_at')::timestamptz;
        
        -- Compute generate_by (lead_time before scheduled_post_at)
        v_generate_by := v_scheduled_at - (v_lead_time_hours || ' hours')::interval;
        
        INSERT INTO jobs (
            batch_id,
            brand_id,
            status,
            vibe_preset,
            scheduled_post_at,
            generate_by,
            meta,
            created_at
        ) VALUES (
            v_campaign_id,
            p_brand_id,
            'pending',  -- Will be picked up by scheduler when generate_by is reached
            v_job->>'vibe_preset',
            v_scheduled_at,
            v_generate_by,
            COALESCE(v_job->'meta', '{}'::jsonb),
            NOW()
        );
    END LOOP;
    
    RETURN v_campaign_id;
END;
$$;

-- =====================================================
-- PART 6: HELPER FUNCTION FOR META UPDATES
-- =====================================================

-- Safely set a nested JSONB value
CREATE OR REPLACE FUNCTION jsonb_set_nested(
    target JSONB,
    path TEXT[],
    value JSONB
)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT jsonb_set(COALESCE(target, '{}'::jsonb), path, value, true);
$$;

-- Coalesce JSONB with default
CREATE OR REPLACE FUNCTION coalesce_jsonb(a JSONB, b JSONB)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT COALESCE(a, b);
$$;

-- =====================================================
-- PART 7: GRANT PERMISSIONS
-- =====================================================

-- Grant execute to service role (for Edge Functions)
GRANT EXECUTE ON FUNCTION find_eligible_jobs(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION claim_job_for_scheduler(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION create_campaign(UUID, TEXT, INTEGER, JSONB, JSONB[]) TO service_role;
GRANT EXECUTE ON FUNCTION jsonb_set_nested(JSONB, TEXT[], JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION coalesce_jsonb(JSONB, JSONB) TO service_role;

-- Also grant to authenticated for UI access
GRANT EXECUTE ON FUNCTION find_eligible_jobs(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION create_campaign(UUID, TEXT, INTEGER, JSONB, JSONB[]) TO authenticated;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

COMMENT ON FUNCTION find_eligible_jobs IS 'Find jobs eligible for scheduler pickup based on generate_by time and campaign status';
COMMENT ON FUNCTION claim_job_for_scheduler IS 'Atomically claim a job for processing, preventing double-triggers';
COMMENT ON COLUMN jobs.generate_by IS 'When this job becomes eligible for scheduling (scheduled_post_at - lead_time)';
