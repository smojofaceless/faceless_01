-- =====================================================
-- Fix import function - brand_id is required
-- =====================================================

DROP FUNCTION IF EXISTS import_job_to_posts(UUID, UUID, TEXT[]);

CREATE OR REPLACE FUNCTION import_job_to_posts(
    p_job_id UUID,
    p_brand_id UUID,  -- Now required (removed DEFAULT NULL)
    p_platforms TEXT[] DEFAULT ARRAY['youtube']
)
RETURNS UUID 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job RECORD;
    v_video_url TEXT;
    v_post_id UUID;
BEGIN
    -- Validate brand_id
    IF p_brand_id IS NULL THEN
        RAISE EXCEPTION 'brand_id is required for import';
    END IF;

    -- Get job details
    SELECT * INTO v_job FROM jobs WHERE id = p_job_id AND status = 'complete';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job not found or not complete: %', p_job_id;
    END IF;
    
    -- Get video URL from job_assets
    SELECT COALESCE(public_url, storage_path) INTO v_video_url
    FROM job_assets
    WHERE job_id = p_job_id AND type = 'final_mp4'
    LIMIT 1;
    
    IF v_video_url IS NULL THEN
        RAISE EXCEPTION 'No video found for job: %', p_job_id;
    END IF;
    
    -- Check if already imported
    SELECT id INTO v_post_id FROM posts WHERE source_job_id = p_job_id LIMIT 1;
    IF FOUND THEN
        RETURN v_post_id; -- Already imported, return existing post
    END IF;
    
    -- Create post from job
    INSERT INTO posts (
        brand_id,
        source_job_id,
        video_url,
        duration_seconds,
        title,
        description,
        platforms,
        status,
        theme,
        ai_metadata
    ) VALUES (
        p_brand_id,
        p_job_id,
        v_video_url,
        v_job.duration_sec,
        COALESCE(v_job.title, 'Untitled Video'),
        v_job.story_text,
        p_platforms,
        'draft',
        v_job.vibe_preset,
        jsonb_build_object(
            'importedFrom', 'jobs',
            'importedAt', NOW(),
            'originalJobId', p_job_id,
            'lengthPreset', v_job.length_preset,
            'visualPreset', v_job.visual_preset
        )
    )
    RETURNING id INTO v_post_id;
    
    RETURN v_post_id;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate bulk function  
DROP FUNCTION IF EXISTS bulk_import_jobs_to_posts(UUID, INTEGER);

CREATE OR REPLACE FUNCTION bulk_import_jobs_to_posts(
    p_brand_id UUID,  -- Now required
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE(job_id UUID, post_id UUID, success BOOLEAN, error TEXT) 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job RECORD;
    v_post_id UUID;
    v_error TEXT;
BEGIN
    -- Validate brand_id
    IF p_brand_id IS NULL THEN
        RAISE EXCEPTION 'brand_id is required for bulk import';
    END IF;

    FOR v_job IN 
        SELECT j.id 
        FROM jobs j
        LEFT JOIN posts p ON p.source_job_id = j.id
        WHERE j.status = 'complete' 
        AND p.id IS NULL
        ORDER BY j.created_at DESC
        LIMIT p_limit
    LOOP
        BEGIN
            v_post_id := import_job_to_posts(v_job.id, p_brand_id);
            RETURN QUERY SELECT v_job.id, v_post_id, TRUE, NULL::TEXT;
        EXCEPTION WHEN OTHERS THEN
            v_error := SQLERRM;
            RETURN QUERY SELECT v_job.id, NULL::UUID, FALSE, v_error;
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION import_job_to_posts(UUID, UUID, TEXT[]) TO anon;
GRANT EXECUTE ON FUNCTION import_job_to_posts(UUID, UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION bulk_import_jobs_to_posts(UUID, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION bulk_import_jobs_to_posts(UUID, INTEGER) TO authenticated;
