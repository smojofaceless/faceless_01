-- =====================================================
-- Migration: 20260210_campaign_system_v1.sql
-- Purpose: Extend generation_batches and jobs for Campaign System v1
-- 
-- Reference: CAMPAIGN_SYSTEM.md v1.2
-- 
-- This migration:
-- 1. Extends generation_batches for campaign lifecycle
-- 2. Adds scheduled_post_at + batch_id to jobs
-- 3. Creates RPC for atomic campaign creation
-- =====================================================

-- =====================================================
-- PART 1: EXTEND GENERATION_BATCHES (CAMPAIGNS)
-- =====================================================

-- Update status enum to match CAMPAIGN_SYSTEM.md lifecycle
ALTER TABLE generation_batches DROP CONSTRAINT IF EXISTS generation_batches_status_check;
ALTER TABLE generation_batches ADD CONSTRAINT generation_batches_status_check 
CHECK (status IN (
    'draft',      -- UI form being filled (not yet submitted)
    'planned',    -- Jobs created, waiting for first worker pickup
    'active',     -- At least one job has started processing
    'paused',     -- Workers skip jobs in this campaign
    'complete',   -- All jobs finished (success or permanent failure)
    'cancelled',  -- Campaign aborted; unstarted jobs marked cancelled
    -- Legacy statuses for backward compatibility
    'setup', 'stories', 'generating', 'reviewing', 'scheduling', 'completed'
));

-- Add config JSONB if not exists (stores full campaign configuration)
ALTER TABLE generation_batches 
ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb;

-- Add name/label column for easier identification
ALTER TABLE generation_batches 
ADD COLUMN IF NOT EXISTS name TEXT;

-- Add computed_video_count (separate from settings-based video_count)
-- The existing video_count is fine, just ensure it's used correctly

-- =====================================================
-- PART 2: EXTEND JOBS TABLE FOR CAMPAIGNS
-- =====================================================

-- Add batch_id (FK to generation_batches)
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES generation_batches(id) ON DELETE SET NULL;

-- Add scheduled_post_at (pre-computed posting time)
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS scheduled_post_at TIMESTAMPTZ;

-- Add brand_id to jobs (may already exist, be safe)
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE CASCADE;

-- Index for efficient campaign job queries
CREATE INDEX IF NOT EXISTS idx_jobs_batch_id ON jobs(batch_id);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_post_at ON jobs(scheduled_post_at) WHERE scheduled_post_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_brand_id ON jobs(brand_id);
CREATE INDEX IF NOT EXISTS idx_jobs_batch_status ON jobs(batch_id, status);

-- =====================================================
-- PART 3: CREATE_CAMPAIGN RPC (ATOMIC TRANSACTION)
-- =====================================================

-- This function creates a campaign + N jobs atomically
-- Returns the campaign ID on success
CREATE OR REPLACE FUNCTION create_campaign(
    p_brand_id UUID,
    p_name TEXT,
    p_video_count INTEGER,
    p_config JSONB,
    p_jobs JSONB[]  -- Array of job objects
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_campaign_id UUID;
    v_job JSONB;
    v_job_id UUID;
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
    
    -- Create job records
    FOREACH v_job IN ARRAY p_jobs
    LOOP
        INSERT INTO jobs (
            batch_id,
            brand_id,
            status,
            vibe_preset,
            scheduled_post_at,
            meta,
            created_at
        ) VALUES (
            v_campaign_id,
            p_brand_id,
            'pending',
            v_job->>'vibe_preset',
            (v_job->>'scheduled_post_at')::timestamptz,
            v_job->'meta',
            NOW()
        );
    END LOOP;
    
    RETURN v_campaign_id;
END;
$$;

-- =====================================================
-- PART 4: UPDATE_CAMPAIGN_STATUS RPC
-- =====================================================

-- Update campaign status and optionally cancel pending jobs
CREATE OR REPLACE FUNCTION update_campaign_status(
    p_campaign_id UUID,
    p_new_status TEXT,
    p_cancel_pending_jobs BOOLEAN DEFAULT false
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Validate status
    IF p_new_status NOT IN ('planned', 'active', 'paused', 'complete', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid status: %', p_new_status;
    END IF;
    
    -- Update campaign
    UPDATE generation_batches
    SET status = p_new_status,
        updated_at = NOW(),
        completed_at = CASE WHEN p_new_status IN ('complete', 'cancelled') THEN NOW() ELSE completed_at END
    WHERE id = p_campaign_id;
    
    -- If cancelling, mark pending jobs as cancelled
    IF p_cancel_pending_jobs OR p_new_status = 'cancelled' THEN
        UPDATE jobs
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE batch_id = p_campaign_id
          AND status IN ('pending', 'queued');
    END IF;
    
    RETURN true;
END;
$$;

-- =====================================================
-- PART 5: GET_CAMPAIGN_SUMMARY RPC
-- =====================================================

-- Get campaign with aggregated job stats
CREATE OR REPLACE FUNCTION get_campaign_summary(p_campaign_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'campaign', row_to_json(gb),
        'stats', jsonb_build_object(
            'total', COUNT(j.id),
            'pending', COUNT(j.id) FILTER (WHERE j.status IN ('pending', 'queued')),
            'generating', COUNT(j.id) FILTER (WHERE j.status IN ('generating', 'assembling', 'rendering')),
            'complete', COUNT(j.id) FILTER (WHERE j.status = 'complete'),
            'failed', COUNT(j.id) FILTER (WHERE j.status = 'failed'),
            'cancelled', COUNT(j.id) FILTER (WHERE j.status = 'cancelled')
        )
    )
    INTO v_result
    FROM generation_batches gb
    LEFT JOIN jobs j ON j.batch_id = gb.id
    WHERE gb.id = p_campaign_id
    GROUP BY gb.id;
    
    RETURN v_result;
END;
$$;

-- =====================================================
-- PART 6: GRANT PERMISSIONS
-- =====================================================

-- Allow anon/authenticated to call these functions (admin-only system)
GRANT EXECUTE ON FUNCTION create_campaign TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_campaign_status TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_campaign_summary TO anon, authenticated, service_role;

-- =====================================================
-- PART 7: ADD UPDATED_AT TRIGGER TO GENERATION_BATCHES
-- =====================================================

-- Reuse existing trigger function
DROP TRIGGER IF EXISTS update_generation_batches_updated_at ON generation_batches;
CREATE TRIGGER update_generation_batches_updated_at
    BEFORE UPDATE ON generation_batches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- VERIFICATION QUERIES (run after migration)
-- =====================================================

-- Check generation_batches columns:
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'generation_batches';

-- Check jobs columns:
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'jobs' AND column_name IN ('batch_id', 'scheduled_post_at', 'brand_id');

-- Test create_campaign function exists:
-- SELECT proname FROM pg_proc WHERE proname = 'create_campaign';
