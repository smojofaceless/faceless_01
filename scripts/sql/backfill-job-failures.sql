-- =====================================================
-- BACKFILL JOB FAILURES FROM EXISTING FAILED JOBS
-- Run in Supabase SQL Editor
-- =====================================================

-- First, check what we have:
SELECT 
    j.id,
    j.title,
    j.current_step,
    j.status,
    j.attempt_count,
    j.updated_at
FROM jobs j
WHERE j.status = 'failed'
ORDER BY j.updated_at DESC;

-- Check current job_failures count
SELECT COUNT(*) as job_failures_count FROM job_failures;

-- =====================================================
-- BACKFILL: Extract error info from meta.steps[*].meta.last_error
-- =====================================================

-- This query finds the step with the most recent error and inserts a failure record
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
    raw_meta,
    created_at
)
SELECT
    j.id AS job_id,
    j.batch_id,
    j.brand_id,
    -- Find the step with error (use current_step if available, otherwise find from meta)
    COALESCE(
        j.current_step,
        -- Find step with last_error in meta
        (SELECT key FROM jsonb_each(j.meta->'steps') 
         WHERE value->'meta'->>'last_error' IS NOT NULL 
         LIMIT 1),
        'unknown'
    ) AS step_name,
    -- Classify error based on message content
    CASE 
        WHEN j.meta->'steps'->j.current_step->'meta'->>'last_error' ILIKE '%api key%' THEN 'misconfig'
        WHEN j.meta->'steps'->j.current_step->'meta'->>'last_error' ILIKE '%rate limit%' THEN 'transient'
        WHEN j.meta->'steps'->j.current_step->'meta'->>'last_error' ILIKE '%timeout%' THEN 'transient'
        WHEN j.meta->'steps'->j.current_step->'meta'->>'last_error' ILIKE '%connection%' THEN 'dependency'
        WHEN j.meta->'steps'->j.current_step->'meta'->>'last_error' ILIKE '%not found%' THEN 'dependency'
        ELSE 'unknown'
    END AS failure_class,
    -- Create error signature
    CONCAT('backfill:', COALESCE(j.current_step, 'unknown')) AS error_signature,
    -- Get error message from step meta
    COALESCE(
        j.meta->'steps'->j.current_step->'meta'->>'last_error',
        j.meta->'steps'->j.current_step->'meta'->>'error',
        'No error message recorded'
    ) AS error_message,
    COALESCE(j.attempt_count, 1) AS job_attempt_number,
    COALESCE((j.meta->'steps'->j.current_step->'meta'->>'attempts')::int, 1) AS step_attempt_number,
    true AS retry_eligible,
    jsonb_build_object(
        'backfilled', true,
        'source', 'jobs.meta.steps',
        'original_updated_at', j.updated_at
    ) AS raw_meta,
    COALESCE(
        (j.meta->'steps'->j.current_step->'meta'->>'last_error_at')::timestamptz,
        (j.meta->'steps'->j.current_step->'meta'->>'failed_at')::timestamptz,
        j.updated_at
    ) AS created_at
FROM jobs j
WHERE j.status = 'failed'
  -- Only backfill jobs that don't already have a failure record
  AND NOT EXISTS (
      SELECT 1 FROM job_failures f WHERE f.job_id = j.id
  )
  -- Only backfill jobs that have some step data
  AND j.meta ? 'steps';

-- Verify backfill results
SELECT 
    jf.job_id,
    j.title,
    jf.step_name,
    jf.failure_class,
    jf.error_message,
    jf.created_at,
    jf.raw_meta->>'backfilled' as backfilled
FROM job_failures jf
JOIN jobs j ON j.id = jf.job_id
ORDER BY jf.created_at DESC
LIMIT 20;

-- Final count
SELECT COUNT(*) as total_failures FROM job_failures;
