-- =====================================================
-- STEP-LEVEL RETRY + DLQ SYSTEM
-- Migration: 20260210002_step_retry_dlq.sql
-- 
-- This migration implements:
-- 1. job_step_retry_policies - configurable per-step retry limits/backoffs
-- 2. job_failures - DLQ table tracking every failure event
-- 3. v_failed_jobs_dlq_step - admin view with can_retry, recommended_action
-- 4. RPCs for recording failures, requeuing, querying DLQ
--
-- Related: ROADMAP.md Item #5 "Retries + Dead-Letter Queue (DLQ)"
-- =====================================================

-- =====================================================
-- 1. JOB STEP RETRY POLICIES TABLE
-- Configurable per-step retry limits and backoff schedules
-- =====================================================

CREATE TABLE IF NOT EXISTS job_step_retry_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    step_name TEXT NOT NULL UNIQUE,
    
    -- Max attempts before permanent failure
    max_attempts INTEGER NOT NULL DEFAULT 3,
    
    -- Backoff schedule in minutes: [10, 30, 120, 360] means:
    -- After attempt 1 fail: wait 10 min
    -- After attempt 2 fail: wait 30 min
    -- After attempt 3 fail: wait 120 min (2 hours)
    -- After attempt 4+ fail: wait 360 min (6 hours)
    backoff_minutes INTEGER[] NOT NULL DEFAULT ARRAY[10, 30, 120, 360],
    
    -- Should this step retry on transient errors?
    retry_on_transient BOOLEAN NOT NULL DEFAULT true,
    
    -- Should this step retry on dependency errors (API down)?
    retry_on_dependency BOOLEAN NOT NULL DEFAULT true,
    
    -- Description for admin reference
    description TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default policies for each step
INSERT INTO job_step_retry_policies (step_name, max_attempts, backoff_minutes, description) VALUES
    ('story', 3, ARRAY[10, 30, 120], 'Story generation - moderate cost, retry on transient'),
    ('uniqueness', 3, ARRAY[5, 15, 60], 'Uniqueness check - cheap, quick retry'),
    ('scenes', 3, ARRAY[10, 30, 120], 'Scene breakdown - moderate cost'),
    ('voice', 3, ARRAY[10, 30, 120], 'Voice synthesis - moderate cost (ElevenLabs)'),
    ('music', 3, ARRAY[5, 15, 60], 'Music selection - cheap/local'),
    ('images', 2, ARRAY[30, 120], 'Image generation - EXPENSIVE (DALL-E), fewer retries'),
    ('subtitles', 3, ARRAY[5, 15, 60], 'Subtitle generation - cheap/local'),
    ('assemble', 3, ARRAY[10, 30, 120], 'Video assembly - external renderer'),
    ('upload', 3, ARRAY[5, 15, 60], 'Storage upload - cheap, quick retry'),
    ('schedule', 3, ARRAY[5, 15, 60], 'Post scheduling - cheap, quick retry')
ON CONFLICT (step_name) DO UPDATE SET
    max_attempts = EXCLUDED.max_attempts,
    backoff_minutes = EXCLUDED.backoff_minutes,
    description = EXCLUDED.description,
    updated_at = NOW();

CREATE INDEX IF NOT EXISTS idx_job_step_retry_policies_step ON job_step_retry_policies(step_name);

-- =====================================================
-- 2. JOB FAILURES TABLE (DLQ)
-- Stores one row per failure event for audit/analysis
-- =====================================================

CREATE TABLE IF NOT EXISTS job_failures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES generation_batches(id) ON DELETE SET NULL,
    brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
    
    -- Failure details
    step_name TEXT NOT NULL,
    failure_class TEXT NOT NULL CHECK (failure_class IN ('transient', 'dependency', 'misconfig', 'permanent', 'unknown')),
    error_signature TEXT, -- e.g., 'dependency:images:openai'
    error_message TEXT,
    
    -- Attempt tracking
    job_attempt_number INTEGER NOT NULL DEFAULT 1,
    step_attempt_number INTEGER NOT NULL DEFAULT 1,
    
    -- Retry eligibility (computed at insert, can be overridden)
    retry_eligible BOOLEAN NOT NULL DEFAULT true,
    next_retry_at TIMESTAMPTZ,
    
    -- Raw metadata for debugging
    raw_meta JSONB DEFAULT '{}'::jsonb,
    -- Structure: {
    --   worker_id: string,
    --   lease_expires_at: string,
    --   http_status: number,
    --   duration_ms: number,
    --   step_progress: object
    -- }
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Prevent duplicate failure records for exact same failure event
    UNIQUE(job_id, job_attempt_number, step_name, step_attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_job_failures_job ON job_failures(job_id);
CREATE INDEX IF NOT EXISTS idx_job_failures_batch ON job_failures(batch_id);
CREATE INDEX IF NOT EXISTS idx_job_failures_brand ON job_failures(brand_id);
CREATE INDEX IF NOT EXISTS idx_job_failures_class ON job_failures(failure_class);
CREATE INDEX IF NOT EXISTS idx_job_failures_step ON job_failures(step_name);
CREATE INDEX IF NOT EXISTS idx_job_failures_created ON job_failures(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_failures_retry_eligible ON job_failures(retry_eligible) WHERE retry_eligible = true;

-- =====================================================
-- 3. FAILED JOBS DLQ VIEW (Step-Aware)
-- Joins jobs + batches + failures for admin UI
-- =====================================================

CREATE OR REPLACE VIEW v_failed_jobs_dlq_step AS
WITH latest_failures AS (
    SELECT DISTINCT ON (job_id)
        job_id,
        step_name AS last_failure_step,
        failure_class AS last_failure_class,
        error_signature AS last_failure_signature,
        error_message AS last_failure_error,
        job_attempt_number,
        step_attempt_number,
        retry_eligible,
        next_retry_at,
        created_at AS failed_at,
        raw_meta
    FROM job_failures
    ORDER BY job_id, created_at DESC
),
step_policies AS (
    SELECT step_name, max_attempts, backoff_minutes, retry_on_transient, retry_on_dependency
    FROM job_step_retry_policies
)
SELECT
    j.id AS job_id,
    j.batch_id AS campaign_id,
    gb.name AS campaign_name,
    j.brand_id,
    b.name AS brand_name,
    j.status,
    j.current_step,
    j.title,
    j.scheduled_post_at,
    COALESCE(j.attempt_count, 1) AS attempt_count,
    
    -- Latest failure info
    lf.last_failure_step,
    lf.last_failure_class,
    lf.last_failure_signature,
    lf.last_failure_error,
    lf.failed_at,
    lf.job_attempt_number,
    lf.step_attempt_number,
    lf.next_retry_at,
    
    -- Policy for failed step
    COALESCE(sp.max_attempts, 3) AS step_max_attempts,
    
    -- Can retry logic:
    -- 1. Not permanent/misconfig errors
    -- 2. Under max attempts for this step
    -- 3. Job status is 'failed'
    CASE
        WHEN j.status != 'failed' THEN false
        WHEN lf.last_failure_class IN ('permanent', 'misconfig') THEN false
        WHEN lf.step_attempt_number >= COALESCE(sp.max_attempts, 3) THEN false
        WHEN lf.last_failure_class = 'transient' AND NOT COALESCE(sp.retry_on_transient, true) THEN false
        WHEN lf.last_failure_class = 'dependency' AND NOT COALESCE(sp.retry_on_dependency, true) THEN false
        ELSE true
    END AS can_retry,
    
    -- Recommended action for admin
    CASE
        WHEN j.status != 'failed' THEN 'none'
        WHEN lf.last_failure_class = 'permanent' THEN 'investigate_content'
        WHEN lf.last_failure_class = 'misconfig' THEN 'fix_configuration'
        WHEN lf.step_attempt_number >= COALESCE(sp.max_attempts, 3) THEN 'manual_review'
        WHEN lf.last_failure_class = 'dependency' THEN 'wait_and_retry'
        WHEN lf.last_failure_class = 'transient' THEN 'auto_retry'
        ELSE 'manual_review'
    END AS recommended_action,
    
    -- Failure count for this job
    (SELECT COUNT(*) FROM job_failures WHERE job_failures.job_id = j.id) AS total_failure_count,
    
    -- Meta for debugging
    j.meta,
    lf.raw_meta AS failure_meta
    
FROM jobs j
LEFT JOIN generation_batches gb ON j.batch_id = gb.id
LEFT JOIN brands b ON j.brand_id = b.id
LEFT JOIN latest_failures lf ON j.id = lf.job_id
LEFT JOIN step_policies sp ON lf.last_failure_step = sp.step_name
WHERE j.status = 'failed'
ORDER BY lf.failed_at DESC NULLS LAST;

-- =====================================================
-- 4. RPC: record_job_step_failure
-- Called by worker-v1 before releasing job as failed
-- =====================================================

CREATE OR REPLACE FUNCTION record_job_step_failure(
    p_job_id UUID,
    p_step_name TEXT,
    p_failure JSONB
    -- Expected structure:
    -- {
    --   "failure_class": "transient|dependency|misconfig|permanent|unknown",
    --   "error_message": "...",
    --   "error_signature": "dependency:images:openai",
    --   "worker_id": "worker-xxx",
    --   "http_status": 500,
    --   "duration_ms": 1234,
    --   "step_progress": { "completed_scenes": 3, "total_scenes": 5 }
    -- }
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job RECORD;
    v_policy RECORD;
    v_step_attempts INTEGER;
    v_job_attempts INTEGER;
    v_failure_class TEXT;
    v_retry_eligible BOOLEAN;
    v_next_retry_at TIMESTAMPTZ;
    v_backoff_minutes INTEGER;
    v_failure_id UUID;
BEGIN
    -- Get job info
    SELECT * INTO v_job FROM jobs WHERE id = p_job_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Job not found');
    END IF;
    
    -- Get retry policy for this step
    SELECT * INTO v_policy FROM job_step_retry_policies WHERE step_name = p_step_name;
    
    -- Extract failure class
    v_failure_class := COALESCE(p_failure->>'failure_class', 'unknown');
    
    -- Get current step attempts from job meta
    v_step_attempts := COALESCE(
        (v_job.meta->'steps'->p_step_name->>'attempts')::INTEGER,
        0
    ) + 1; -- This failure is the next attempt
    
    v_job_attempts := COALESCE(v_job.attempt_count, 1);
    
    -- Determine if retry is eligible based on class and attempts
    v_retry_eligible := CASE
        WHEN v_failure_class IN ('permanent', 'misconfig') THEN false
        WHEN v_policy IS NOT NULL AND v_step_attempts >= v_policy.max_attempts THEN false
        WHEN v_policy IS NULL AND v_step_attempts >= 3 THEN false -- Default max 3
        ELSE true
    END;
    
    -- Calculate next retry time if eligible
    IF v_retry_eligible THEN
        -- Get backoff based on attempt number
        IF v_policy IS NOT NULL AND array_length(v_policy.backoff_minutes, 1) > 0 THEN
            -- Use policy backoff schedule, clamping to last value for attempts beyond array
            v_backoff_minutes := v_policy.backoff_minutes[
                LEAST(v_step_attempts, array_length(v_policy.backoff_minutes, 1))
            ];
        ELSE
            -- Default backoff: 10, 30, 120, 360 minutes
            v_backoff_minutes := CASE v_step_attempts
                WHEN 1 THEN 10
                WHEN 2 THEN 30
                WHEN 3 THEN 120
                ELSE 360
            END;
        END IF;
        
        v_next_retry_at := NOW() + (v_backoff_minutes || ' minutes')::INTERVAL;
    END IF;
    
    -- Insert failure record
    INSERT INTO job_failures (
        job_id,
        batch_id,
        brand_id,
        step_name,
        failure_class,
        error_signature,
        error_message,
        job_attempt_number,
        step_attempt_number,
        retry_eligible,
        next_retry_at,
        raw_meta
    ) VALUES (
        p_job_id,
        v_job.batch_id,
        v_job.brand_id,
        p_step_name,
        v_failure_class,
        p_failure->>'error_signature',
        p_failure->>'error_message',
        v_job_attempts,
        v_step_attempts,
        v_retry_eligible,
        v_next_retry_at,
        jsonb_build_object(
            'worker_id', p_failure->>'worker_id',
            'http_status', p_failure->'http_status',
            'duration_ms', p_failure->'duration_ms',
            'step_progress', p_failure->'step_progress',
            'lease_expires_at', v_job.lease_expires_at
        )
    )
    ON CONFLICT (job_id, job_attempt_number, step_name, step_attempt_number) 
    DO UPDATE SET
        failure_class = EXCLUDED.failure_class,
        error_signature = EXCLUDED.error_signature,
        error_message = EXCLUDED.error_message,
        retry_eligible = EXCLUDED.retry_eligible,
        next_retry_at = EXCLUDED.next_retry_at,
        raw_meta = EXCLUDED.raw_meta
    RETURNING id INTO v_failure_id;
    
    -- Update job meta with step failure info
    UPDATE jobs SET
        meta = jsonb_set(
            jsonb_set(
                COALESCE(meta, '{}'::jsonb),
                ARRAY['steps', p_step_name],
                COALESCE(meta->'steps'->p_step_name, '{}'::jsonb) || jsonb_build_object(
                    'attempts', v_step_attempts,
                    'last_error', p_failure->>'error_message',
                    'last_error_at', NOW(),
                    'last_error_class', v_failure_class
                )
            ),
            ARRAY['last_failure'],
            jsonb_build_object(
                'step', p_step_name,
                'class', v_failure_class,
                'signature', p_failure->>'error_signature',
                'message', p_failure->>'error_message',
                'at', NOW(),
                'step_attempt', v_step_attempts,
                'retry_eligible', v_retry_eligible,
                'next_retry_at', v_next_retry_at
            )
        ),
        updated_at = NOW()
    WHERE id = p_job_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'failure_id', v_failure_id,
        'step_name', p_step_name,
        'step_attempt', v_step_attempts,
        'retry_eligible', v_retry_eligible,
        'next_retry_at', v_next_retry_at,
        'backoff_minutes', v_backoff_minutes
    );
END;
$$;

-- =====================================================
-- 5. RPC: requeue_failed_job
-- Resets job for retry with proper backoff
-- =====================================================

CREATE OR REPLACE FUNCTION requeue_failed_job(
    p_job_id UUID,
    p_force BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job RECORD;
    v_latest_failure RECORD;
    v_policy RECORD;
    v_backoff_minutes INTEGER;
    v_next_generate_by TIMESTAMPTZ;
    v_can_retry BOOLEAN;
BEGIN
    -- Get job with lock
    SELECT * INTO v_job FROM jobs WHERE id = p_job_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Job not found');
    END IF;
    
    IF v_job.status != 'failed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Job is not in failed status', 'current_status', v_job.status);
    END IF;
    
    -- Safety: Check for active lease (unless force)
    -- If job has an unexpired lease, another worker might be processing it
    IF NOT p_force AND v_job.lease_expires_at IS NOT NULL AND v_job.lease_expires_at > NOW() THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error', 'Job has active lease until ' || v_job.lease_expires_at::TEXT,
            'locked_by', v_job.locked_by,
            'lease_expires_at', v_job.lease_expires_at,
            'hint', 'Wait for lease to expire or use force=true'
        );
    END IF;
    
    -- Get latest failure record
    SELECT * INTO v_latest_failure 
    FROM job_failures 
    WHERE job_id = p_job_id 
    ORDER BY created_at DESC 
    LIMIT 1;
    
    -- Check if can retry (unless force)
    IF NOT p_force THEN
        IF v_latest_failure.failure_class IN ('permanent', 'misconfig') THEN
            RETURN jsonb_build_object(
                'success', false, 
                'error', 'Cannot retry: failure class is ' || v_latest_failure.failure_class,
                'recommendation', CASE 
                    WHEN v_latest_failure.failure_class = 'permanent' THEN 'Content was rejected. Review and regenerate.'
                    ELSE 'Configuration error. Check API keys and settings.'
                END
            );
        END IF;
        
        -- Get policy for failed step
        SELECT * INTO v_policy FROM job_step_retry_policies WHERE step_name = v_latest_failure.step_name;
        
        IF v_policy IS NOT NULL AND v_latest_failure.step_attempt_number >= v_policy.max_attempts THEN
            RETURN jsonb_build_object(
                'success', false, 
                'error', 'Max step attempts reached for ' || v_latest_failure.step_name,
                'step_attempts', v_latest_failure.step_attempt_number,
                'max_attempts', v_policy.max_attempts
            );
        END IF;
    END IF;
    
    -- Calculate next generate_by based on backoff
    IF v_latest_failure IS NOT NULL AND v_latest_failure.next_retry_at IS NOT NULL AND NOT p_force THEN
        v_next_generate_by := v_latest_failure.next_retry_at;
    ELSE
        -- Default: immediate retry if forced or no failure record
        v_next_generate_by := NOW();
    END IF;
    
    -- Reset job for retry (preserve current_step so worker resumes correctly)
    UPDATE jobs SET
        status = 'pending',
        locked_by = NULL,
        locked_at = NULL,
        lease_expires_at = NULL,
        generate_by = v_next_generate_by,
        attempt_count = COALESCE(attempt_count, 0) + 1,
        error_message = NULL,
        -- NOTE: current_step is NOT reset - worker will check step completion and resume
        meta = jsonb_set(
            COALESCE(meta, '{}'::jsonb),
            ARRAY['last_requeue'],
            jsonb_build_object(
                'at', NOW(),
                'forced', p_force,
                'previous_failure_step', v_latest_failure.step_name,
                'scheduled_for', v_next_generate_by,
                'resume_from_step', v_job.current_step
            )
        ),
        updated_at = NOW()
    WHERE id = p_job_id;
    
    -- Mark the failure as processed (optional tracking)
    UPDATE job_failures SET
        raw_meta = raw_meta || jsonb_build_object('requeued_at', NOW(), 'requeue_forced', p_force)
    WHERE id = v_latest_failure.id;
    
    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'new_status', 'pending',
        'generate_by', v_next_generate_by,
        'attempt_count', COALESCE(v_job.attempt_count, 0) + 1,
        'previous_failure_step', v_latest_failure.step_name,
        'forced', p_force
    );
END;
$$;

-- =====================================================
-- 6. RPC: get_failed_jobs_dlq
-- Query failed jobs for admin UI with filtering
-- =====================================================

CREATE OR REPLACE FUNCTION get_failed_jobs_dlq(
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0,
    p_filters JSONB DEFAULT '{}'::jsonb
    -- Supported filters:
    -- { "brand_id": uuid, "campaign_id": uuid, "failure_class": text, "step_name": text, "can_retry": boolean }
)
RETURNS TABLE (
    job_id UUID,
    campaign_id UUID,
    campaign_name TEXT,
    brand_id UUID,
    brand_name TEXT,
    status TEXT,
    current_step TEXT,
    title TEXT,
    scheduled_post_at TIMESTAMPTZ,
    attempt_count INTEGER,
    last_failure_step TEXT,
    last_failure_class TEXT,
    last_failure_signature TEXT,
    last_failure_error TEXT,
    failed_at TIMESTAMPTZ,
    step_attempt_number INTEGER,
    next_retry_at TIMESTAMPTZ,
    can_retry BOOLEAN,
    recommended_action TEXT,
    total_failure_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        v.job_id,
        v.campaign_id,
        v.campaign_name,
        v.brand_id,
        v.brand_name,
        v.status,
        v.current_step,
        v.title,
        v.scheduled_post_at,
        v.attempt_count,
        v.last_failure_step,
        v.last_failure_class,
        v.last_failure_signature,
        v.last_failure_error,
        v.failed_at,
        v.step_attempt_number,
        v.next_retry_at,
        v.can_retry,
        v.recommended_action,
        v.total_failure_count
    FROM v_failed_jobs_dlq_step v
    WHERE
        (p_filters->>'brand_id' IS NULL OR v.brand_id = (p_filters->>'brand_id')::UUID) AND
        (p_filters->>'campaign_id' IS NULL OR v.campaign_id = (p_filters->>'campaign_id')::UUID) AND
        (p_filters->>'failure_class' IS NULL OR v.last_failure_class = p_filters->>'failure_class') AND
        (p_filters->>'step_name' IS NULL OR v.last_failure_step = p_filters->>'step_name') AND
        (p_filters->>'can_retry' IS NULL OR v.can_retry = (p_filters->>'can_retry')::BOOLEAN)
    ORDER BY v.failed_at DESC NULLS LAST
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- =====================================================
-- 7. RPC: get_job_failures
-- Get failure history for a specific job
-- =====================================================

CREATE OR REPLACE FUNCTION get_job_failures(
    p_job_id UUID
)
RETURNS TABLE (
    id UUID,
    step_name TEXT,
    failure_class TEXT,
    error_signature TEXT,
    error_message TEXT,
    job_attempt_number INTEGER,
    step_attempt_number INTEGER,
    retry_eligible BOOLEAN,
    next_retry_at TIMESTAMPTZ,
    raw_meta JSONB,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        jf.id,
        jf.step_name,
        jf.failure_class,
        jf.error_signature,
        jf.error_message,
        jf.job_attempt_number,
        jf.step_attempt_number,
        jf.retry_eligible,
        jf.next_retry_at,
        jf.raw_meta,
        jf.created_at
    FROM job_failures jf
    WHERE jf.job_id = p_job_id
    ORDER BY jf.created_at DESC;
END;
$$;

-- =====================================================
-- 8. RPC: get_step_retry_policies
-- Get all retry policies for admin reference
-- =====================================================

CREATE OR REPLACE FUNCTION get_step_retry_policies()
RETURNS TABLE (
    step_name TEXT,
    max_attempts INTEGER,
    backoff_minutes INTEGER[],
    retry_on_transient BOOLEAN,
    retry_on_dependency BOOLEAN,
    description TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.step_name,
        p.max_attempts,
        p.backoff_minutes,
        p.retry_on_transient,
        p.retry_on_dependency,
        p.description
    FROM job_step_retry_policies p
    ORDER BY p.step_name;
END;
$$;

-- =====================================================
-- 9. GRANT PERMISSIONS
-- =====================================================

-- Grant access to service role
GRANT ALL ON job_step_retry_policies TO service_role;
GRANT ALL ON job_failures TO service_role;
GRANT SELECT ON v_failed_jobs_dlq_step TO service_role;

-- Grant execute on RPCs
GRANT EXECUTE ON FUNCTION record_job_step_failure(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION requeue_failed_job(UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION get_failed_jobs_dlq(INTEGER, INTEGER, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION get_job_failures(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION get_step_retry_policies() TO service_role;

-- RLS policies for job_failures
ALTER TABLE job_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can do everything on job_failures" ON job_failures;
CREATE POLICY "Service role can do everything on job_failures" ON job_failures
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can view job_failures" ON job_failures;
CREATE POLICY "Authenticated users can view job_failures" ON job_failures
    FOR SELECT TO authenticated USING (true);

-- RLS for job_step_retry_policies (read-only for most users)
ALTER TABLE job_step_retry_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read retry policies" ON job_step_retry_policies;
CREATE POLICY "Anyone can read retry policies" ON job_step_retry_policies
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role can manage retry policies" ON job_step_retry_policies;
CREATE POLICY "Service role can manage retry policies" ON job_step_retry_policies
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================
-- 10. COMMENT DOCUMENTATION
-- =====================================================

COMMENT ON TABLE job_step_retry_policies IS 'Configurable per-step retry limits and backoff schedules for worker-v1';
COMMENT ON TABLE job_failures IS 'Dead Letter Queue (DLQ) - tracks every job failure event for audit and analysis';
COMMENT ON VIEW v_failed_jobs_dlq_step IS 'Admin view of failed jobs with retry eligibility and recommended actions';
COMMENT ON FUNCTION record_job_step_failure IS 'Records step failure to DLQ, updates job meta, calculates retry eligibility';
COMMENT ON FUNCTION requeue_failed_job IS 'Resets failed job for retry with proper backoff calculation';
COMMENT ON FUNCTION get_failed_jobs_dlq IS 'Query failed jobs for admin UI with optional filters';
COMMENT ON FUNCTION get_job_failures IS 'Get failure history for a specific job';
