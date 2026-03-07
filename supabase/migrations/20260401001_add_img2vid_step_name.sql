-- =====================================================
-- Add 'img2vid' to allowed step names in update_job_step RPC
-- Bug fix: img2vid was missing from the validation whitelist,
-- causing all status updates for the img2vid step to fail silently.
-- =====================================================

CREATE OR REPLACE FUNCTION update_job_step(
    p_job_id UUID,
    p_step_name TEXT,
    p_status TEXT,
    p_step_meta JSONB DEFAULT '{}'::JSONB
)
RETURNS TABLE (
    success BOOLEAN,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_job RECORD;
    v_current_meta JSONB;
    v_current_steps JSONB;
    v_old_step JSONB;
    v_new_step JSONB;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    -- Validate inputs
    IF p_job_id IS NULL OR p_step_name IS NULL OR p_status IS NULL THEN
        RETURN QUERY SELECT FALSE, 'job_id, step_name, and status are required'::TEXT;
        RETURN;
    END IF;

    -- Validate step name (added 'img2vid' — was missing, causing silent failures)
    IF p_step_name NOT IN ('story', 'uniqueness', 'scenes', 'voice', 'music', 'images', 'img2vid', 'subtitles', 'assemble', 'upload', 'schedule') THEN
        RETURN QUERY SELECT FALSE, ('Invalid step_name: ' || p_step_name)::TEXT;
        RETURN;
    END IF;

    -- Validate status
    IF p_status NOT IN ('pending', 'running', 'complete', 'failed', 'skipped') THEN
        RETURN QUERY SELECT FALSE, ('Invalid status: ' || p_status)::TEXT;
        RETURN;
    END IF;

    -- Lock job row
    SELECT * INTO v_job FROM jobs WHERE id = p_job_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Job not found'::TEXT;
        RETURN;
    END IF;

    -- Get current meta and steps
    v_current_meta := COALESCE(v_job.meta, '{}'::JSONB);
    v_current_steps := COALESCE(v_current_meta->'steps', '{}'::JSONB);
    v_old_step := COALESCE(v_current_steps->p_step_name, '{}'::JSONB);

    -- Build new step object with merge semantics
    -- Preserve existing meta fields, add new ones
    v_new_step := jsonb_build_object(
        'status', p_status,
        'updated_at', v_now::TEXT,
        'meta', COALESCE(v_old_step->'meta', '{}'::JSONB) || p_step_meta
    );

    -- Add started_at if transitioning to running
    IF p_status = 'running' AND v_old_step->>'status' IS DISTINCT FROM 'running' THEN
        v_new_step := v_new_step || jsonb_build_object('started_at', v_now::TEXT);
    END IF;

    -- Add completed_at if transitioning to complete/failed/skipped
    IF p_status IN ('complete', 'failed', 'skipped') AND v_old_step->>'status' NOT IN ('complete', 'failed', 'skipped') THEN
        v_new_step := v_new_step || jsonb_build_object('completed_at', v_now::TEXT);
    END IF;

    -- Update the job
    UPDATE jobs
    SET 
        meta = v_current_meta || jsonb_build_object(
            'steps', v_current_steps || jsonb_build_object(p_step_name, v_new_step)
        ),
        current_step = CASE 
            WHEN p_status = 'running' THEN p_step_name
            WHEN p_status IN ('complete', 'failed', 'skipped') THEN v_job.current_step
            ELSE v_job.current_step
        END,
        updated_at = v_now
    WHERE id = p_job_id;

    RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$;
