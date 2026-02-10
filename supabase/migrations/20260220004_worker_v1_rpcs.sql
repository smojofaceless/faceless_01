-- =====================================================
-- WORKER V1 RPCs
-- Idempotent asset upsert, step tracking, and post scheduling
-- 
-- v1.0 - 2026-02-20
-- =====================================================

-- =====================================================
-- PART 1: UPSERT_JOB_ASSET RPC
-- Idempotent asset creation using ON CONFLICT
-- =====================================================

CREATE OR REPLACE FUNCTION upsert_job_asset(
    p_job_id UUID,
    p_idempotency_key TEXT,
    p_type TEXT,
    p_storage_path TEXT DEFAULT NULL,
    p_public_url TEXT DEFAULT NULL,
    p_meta JSONB DEFAULT '{}'::JSONB
)
RETURNS TABLE (
    asset_id UUID,
    was_inserted BOOLEAN,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_id UUID;
    v_new_id UUID;
BEGIN
    -- Validate required inputs
    IF p_job_id IS NULL OR p_idempotency_key IS NULL OR p_type IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, FALSE, 'job_id, idempotency_key, and type are required'::TEXT;
        RETURN;
    END IF;

    -- Check if asset already exists with this idempotency key
    SELECT id INTO v_existing_id
    FROM job_assets
    WHERE job_id = p_job_id AND idempotency_key = p_idempotency_key;

    IF v_existing_id IS NOT NULL THEN
        -- Asset already exists - return it without modification
        RETURN QUERY SELECT v_existing_id, FALSE, NULL::TEXT;
        RETURN;
    END IF;

    -- Insert new asset
    INSERT INTO job_assets (
        job_id,
        idempotency_key,
        type,
        storage_path,
        public_url,
        meta
    ) VALUES (
        p_job_id,
        p_idempotency_key,
        p_type,
        COALESCE(p_storage_path, ''),
        p_public_url,
        p_meta
    )
    RETURNING id INTO v_new_id;

    RETURN QUERY SELECT v_new_id, TRUE, NULL::TEXT;

EXCEPTION WHEN unique_violation THEN
    -- Race condition: another worker inserted between our check and insert
    -- This is safe - just return the existing record
    SELECT id INTO v_existing_id
    FROM job_assets
    WHERE job_id = p_job_id AND idempotency_key = p_idempotency_key;
    
    RETURN QUERY SELECT v_existing_id, FALSE, 'Concurrent insert detected, returning existing'::TEXT;
END;
$$;

-- =====================================================
-- PART 2: UPDATE_JOB_STEP RPC
-- Update step status in jobs.meta.steps with merge semantics
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

    -- Validate step name
    IF p_step_name NOT IN ('story', 'uniqueness', 'scenes', 'voice', 'music', 'images', 'subtitles', 'assemble', 'upload', 'schedule') THEN
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

-- =====================================================
-- PART 3: GET_STEP_STATUS RPC
-- Retrieve status of a specific step or all steps
-- =====================================================

CREATE OR REPLACE FUNCTION get_step_status(
    p_job_id UUID,
    p_step_name TEXT DEFAULT NULL
)
RETURNS TABLE (
    step_name TEXT,
    status TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    meta JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_job RECORD;
    v_steps JSONB;
    v_step_data JSONB;
    v_key TEXT;
BEGIN
    -- Validate inputs
    IF p_job_id IS NULL THEN
        RETURN;
    END IF;

    -- Get job
    SELECT * INTO v_job FROM jobs WHERE id = p_job_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    v_steps := COALESCE(v_job.meta->'steps', '{}'::JSONB);

    -- If specific step requested
    IF p_step_name IS NOT NULL THEN
        v_step_data := v_steps->p_step_name;
        IF v_step_data IS NOT NULL THEN
            RETURN QUERY SELECT 
                p_step_name,
                v_step_data->>'status',
                (v_step_data->>'started_at')::TIMESTAMPTZ,
                (v_step_data->>'completed_at')::TIMESTAMPTZ,
                COALESCE(v_step_data->'meta', '{}'::JSONB);
        END IF;
        RETURN;
    END IF;

    -- Return all steps
    FOR v_key IN SELECT jsonb_object_keys(v_steps) LOOP
        v_step_data := v_steps->v_key;
        RETURN QUERY SELECT 
            v_key,
            v_step_data->>'status',
            (v_step_data->>'started_at')::TIMESTAMPTZ,
            (v_step_data->>'completed_at')::TIMESTAMPTZ,
            COALESCE(v_step_data->'meta', '{}'::JSONB);
    END LOOP;
END;
$$;

-- =====================================================
-- PART 4: SCHEDULE_POST_IDEMPOTENT RPC
-- Create post with idempotency via unique constraint
-- =====================================================

CREATE OR REPLACE FUNCTION schedule_post_idempotent(
    p_job_id UUID,
    p_brand_id UUID,
    p_platform TEXT,
    p_scheduled_at TIMESTAMPTZ,
    p_video_url TEXT,
    p_title TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_tags TEXT[] DEFAULT NULL,
    p_meta JSONB DEFAULT '{}'::JSONB
)
RETURNS TABLE (
    post_id UUID,
    was_inserted BOOLEAN,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_id UUID;
    v_new_id UUID;
BEGIN
    -- Validate required inputs
    IF p_job_id IS NULL OR p_brand_id IS NULL OR p_platform IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, FALSE, 'job_id, brand_id, and platform are required'::TEXT;
        RETURN;
    END IF;

    -- Check if post already exists for this job + platform
    SELECT id INTO v_existing_id
    FROM posts
    WHERE job_id = p_job_id AND platform = p_platform;

    IF v_existing_id IS NOT NULL THEN
        -- Post already exists - return it without modification
        RETURN QUERY SELECT v_existing_id, FALSE, 'Post already scheduled for this job+platform'::TEXT;
        RETURN;
    END IF;

    -- Insert new post
    INSERT INTO posts (
        job_id,
        brand_id,
        platform,
        scheduled_at,
        video_url,
        title,
        description,
        tags,
        meta,
        status
    ) VALUES (
        p_job_id,
        p_brand_id,
        p_platform,
        p_scheduled_at,
        p_video_url,
        p_title,
        p_description,
        p_tags,
        p_meta,
        'scheduled'
    )
    RETURNING id INTO v_new_id;

    RETURN QUERY SELECT v_new_id, TRUE, NULL::TEXT;

EXCEPTION WHEN unique_violation THEN
    -- Race condition: another worker inserted between our check and insert
    SELECT id INTO v_existing_id
    FROM posts
    WHERE job_id = p_job_id AND platform = p_platform;
    
    RETURN QUERY SELECT v_existing_id, FALSE, 'Concurrent insert detected, returning existing'::TEXT;
END;
$$;

-- =====================================================
-- PART 5: GRANTS
-- =====================================================

GRANT EXECUTE ON FUNCTION upsert_job_asset(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION update_job_step(UUID, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION get_step_status(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION schedule_post_idempotent(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT[], JSONB) TO service_role;

-- =====================================================
-- PART 6: COMMENTS
-- =====================================================

COMMENT ON FUNCTION upsert_job_asset IS 
    'Idempotent asset creation. Returns existing asset if idempotency_key already exists for job.';

COMMENT ON FUNCTION update_job_step IS 
    'Update step status in jobs.meta.steps with merge semantics. Preserves existing meta fields.';

COMMENT ON FUNCTION get_step_status IS 
    'Get status of a specific step or all steps for a job.';

COMMENT ON FUNCTION schedule_post_idempotent IS 
    'Idempotent post scheduling. Only one post allowed per job+platform combination.';
