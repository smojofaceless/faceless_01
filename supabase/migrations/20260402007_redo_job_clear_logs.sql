-- Migration: Redo Job — Clear pipeline logs and failure history
-- Previously, redo_job only cleared job_assets. Old job_step_logs and
-- job_failures remained, causing the UI to show stale data after redo.

CREATE OR REPLACE FUNCTION redo_job(
    p_job_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job RECORD;
    v_posts_reset INT;
    v_assets_cleared INT;
BEGIN
    -- Lock the job row
    SELECT * INTO v_job FROM jobs WHERE id = p_job_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Job not found');
    END IF;

    -- Block redo on actively-running jobs
    IF v_job.status IN ('generating', 'assembling', 'rendering', 'queued') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot redo a job that is currently running',
            'current_status', v_job.status
        );
    END IF;

    -- Safety: refuse if job has an active lease
    IF v_job.lease_expires_at IS NOT NULL AND v_job.lease_expires_at > NOW() THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Job has an active worker lease until ' || v_job.lease_expires_at::TEXT,
            'hint', 'Wait for the lease to expire'
        );
    END IF;

    -- 1. Reset the job itself
    UPDATE jobs SET
        status = 'pending',
        progress = 0,
        error = NULL,
        current_step = NULL,
        locked_by = NULL,
        locked_at = NULL,
        lease_expires_at = NULL,
        video_url = NULL,
        title = NULL,
        story_text = NULL,
        story_word_count = NULL,
        generate_by = NOW(),
        attempt_count = 0,
        meta = jsonb_set(
            COALESCE(meta, '{}'::jsonb) - 'steps' - 'last_requeue',
            ARRAY['redo'],
            jsonb_build_object(
                'at', NOW(),
                'previous_status', v_job.status,
                'previous_attempt_count', COALESCE(v_job.attempt_count, 0)
            )
        ),
        updated_at = NOW()
    WHERE id = p_job_id;

    -- 2. Reset associated posts back to pending
    UPDATE posts SET
        status = 'pending',
        posted_at = NULL,
        platform_post_id = NULL,
        platform_content = COALESCE(platform_content, '{}'::jsonb) || '{"redo": true}'::jsonb,
        updated_at = NOW()
    WHERE job_id = p_job_id
      AND status IN ('posted', 'failed', 'skipped');

    GET DIAGNOSTICS v_posts_reset = ROW_COUNT;

    -- 3. Delete generated assets so pipeline regenerates everything
    DELETE FROM job_assets
    WHERE job_id = p_job_id;

    GET DIAGNOSTICS v_assets_cleared = ROW_COUNT;

    -- 4. Clear old pipeline logs so the UI shows fresh data
    DELETE FROM job_step_logs
    WHERE job_id = p_job_id;

    -- 5. Clear old failure history
    DELETE FROM job_failures
    WHERE job_id = p_job_id;

    -- 6. Clear API usage ledger so per-job cost limits reset
    DELETE FROM api_usage
    WHERE job_id = p_job_id;

    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'new_status', 'pending',
        'posts_reset', v_posts_reset,
        'assets_cleared', v_assets_cleared,
        'generate_by', NOW()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION redo_job(UUID) TO anon, authenticated, service_role;
