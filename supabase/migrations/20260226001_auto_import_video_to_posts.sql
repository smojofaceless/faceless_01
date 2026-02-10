-- =====================================================
-- AUTO IMPORT VIDEO TO POSTS
-- Automatically creates posts when a job's video_url is set
-- =====================================================
-- 
-- When the video-renderer completes and sets video_url on a job,
-- this trigger automatically creates post records for each platform
-- specified in the job's target_platforms.
-- 
-- Flow: video_url set → trigger fires → posts created → schedule-posts picks them up
-- =====================================================

-- =====================================================
-- FUNCTION: Auto-import job to posts on video completion
-- =====================================================
CREATE OR REPLACE FUNCTION auto_import_job_to_posts()
RETURNS TRIGGER AS $$
DECLARE
    v_video_url TEXT;
    v_brand_id UUID;
    v_platforms TEXT[];
    v_platform TEXT;
    v_post_id UUID;
    v_scheduled_at TIMESTAMPTZ;
    v_title TEXT;
    v_description TEXT;
BEGIN
    -- Only run when video_url is newly set
    -- For UPDATE: was NULL, now has value
    -- For INSERT: has value and status is complete
    IF TG_OP = 'UPDATE' THEN
        IF OLD.video_url IS NOT NULL OR NEW.video_url IS NULL THEN
            RETURN NEW;
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.video_url IS NULL OR NEW.status NOT IN ('complete', 'completed') THEN
            RETURN NEW;
        END IF;
    END IF;
    
    -- Only for completed jobs
    IF NEW.status NOT IN ('complete', 'completed') THEN
        RETURN NEW;
    END IF;
    
    -- Check if already imported
    IF EXISTS (SELECT 1 FROM posts WHERE source_job_id = NEW.id LIMIT 1) THEN
        RAISE NOTICE 'Job % already has posts, skipping auto-import', NEW.id;
        RETURN NEW;
    END IF;
    
    -- Get video URL (prefer job.video_url, fallback to job_assets)
    v_video_url := NEW.video_url;
    IF v_video_url IS NULL THEN
        SELECT COALESCE(public_url, storage_path) INTO v_video_url
        FROM job_assets
        WHERE job_id = NEW.id AND type = 'final_mp4'
        LIMIT 1;
    END IF;
    
    IF v_video_url IS NULL THEN
        RAISE NOTICE 'No video URL for job %, skipping auto-import', NEW.id;
        RETURN NEW;
    END IF;
    
    -- Get brand_id from job or batch
    v_brand_id := NEW.brand_id;
    IF v_brand_id IS NULL AND NEW.batch_id IS NOT NULL THEN
        SELECT brand_id INTO v_brand_id
        FROM generation_batches
        WHERE id = NEW.batch_id;
    END IF;
    
    IF v_brand_id IS NULL THEN
        RAISE NOTICE 'No brand_id for job %, skipping auto-import', NEW.id;
        RETURN NEW;
    END IF;
    
    -- Get target platforms from job (default to youtube if not set)
    v_platforms := COALESCE(NEW.target_platforms, ARRAY['youtube']);
    
    -- Use job's scheduled time or NOW + 1 hour
    v_scheduled_at := COALESCE(NEW.scheduled_post_at, NOW() + INTERVAL '1 hour');
    
    -- Build title and description
    v_title := COALESCE(NEW.title, 'Untitled Video');
    v_description := NEW.story_text;
    
    -- Create a post for each platform
    FOREACH v_platform IN ARRAY v_platforms
    LOOP
        INSERT INTO posts (
            brand_id,
            source_job_id,
            job_id,
            batch_id,
            video_url,
            duration_seconds,
            title,
            description,
            platforms,
            status,
            scheduled_at,
            theme,
            ai_metadata
        ) VALUES (
            v_brand_id,
            NEW.id,
            NEW.id,
            NEW.batch_id,
            v_video_url,
            NEW.duration_sec,
            v_title,
            v_description,
            ARRAY[v_platform],
            'scheduled',  -- Ready to be picked up by schedule-posts
            v_scheduled_at,
            NEW.vibe_preset,
            jsonb_build_object(
                'auto_imported', true,
                'imported_at', NOW(),
                'source_job_id', NEW.id,
                'platform', v_platform,
                'length_preset', NEW.length_preset,
                'visual_preset', NEW.visual_preset
            )
        )
        RETURNING id INTO v_post_id;
        
        RAISE NOTICE 'Auto-created post % for job % on platform %', v_post_id, NEW.id, v_platform;
    END LOOP;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRIGGER: Auto-import on video_url update
-- =====================================================
DROP TRIGGER IF EXISTS trg_auto_import_video_to_posts ON jobs;
CREATE TRIGGER trg_auto_import_video_to_posts
    AFTER UPDATE OF video_url ON jobs
    FOR EACH ROW
    EXECUTE FUNCTION auto_import_job_to_posts();

-- Also handle INSERT with video_url already set (rare but possible)
DROP TRIGGER IF EXISTS trg_auto_import_video_to_posts_insert ON jobs;
CREATE TRIGGER trg_auto_import_video_to_posts_insert
    AFTER INSERT ON jobs
    FOR EACH ROW
    EXECUTE FUNCTION auto_import_job_to_posts();

-- =====================================================
-- Add job_id column to posts if not exists (direct reference)
-- =====================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'posts' AND column_name = 'job_id'
    ) THEN
        ALTER TABLE posts ADD COLUMN job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_posts_job_id ON posts(job_id);
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'posts' AND column_name = 'batch_id'
    ) THEN
        ALTER TABLE posts ADD COLUMN batch_id UUID REFERENCES generation_batches(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_posts_batch_id ON posts(batch_id);
    END IF;
END $$;

-- =====================================================
-- Backfill: Import existing completed jobs without posts
-- =====================================================
DO $$
DECLARE
    v_job RECORD;
    v_video_url TEXT;
    v_brand_id UUID;
    v_platforms TEXT[];
    v_platform TEXT;
    v_post_id UUID;
    v_count INTEGER := 0;
BEGIN
    FOR v_job IN 
        SELECT j.* 
        FROM jobs j
        LEFT JOIN posts p ON p.source_job_id = j.id
        WHERE j.status IN ('complete', 'completed')
          AND j.video_url IS NOT NULL
          AND p.id IS NULL
        ORDER BY j.created_at DESC
        LIMIT 50  -- Limit backfill to avoid long transaction
    LOOP
        -- Get brand_id
        v_brand_id := v_job.brand_id;
        IF v_brand_id IS NULL AND v_job.batch_id IS NOT NULL THEN
            SELECT brand_id INTO v_brand_id
            FROM generation_batches
            WHERE id = v_job.batch_id;
        END IF;
        
        IF v_brand_id IS NULL THEN
            CONTINUE;  -- Skip jobs without brand
        END IF;
        
        v_video_url := v_job.video_url;
        v_platforms := COALESCE(v_job.target_platforms, ARRAY['youtube']);
        
        -- Create posts for each platform
        FOREACH v_platform IN ARRAY v_platforms
        LOOP
            INSERT INTO posts (
                brand_id,
                source_job_id,
                job_id,
                batch_id,
                video_url,
                duration_seconds,
                title,
                description,
                platforms,
                status,
                scheduled_at,
                theme,
                ai_metadata
            ) VALUES (
                v_brand_id,
                v_job.id,
                v_job.id,
                v_job.batch_id,
                v_video_url,
                v_job.duration_sec,
                COALESCE(v_job.title, 'Untitled Video'),
                v_job.story_text,
                ARRAY[v_platform],
                'scheduled',
                COALESCE(v_job.scheduled_post_at, NOW() + INTERVAL '1 hour'),
                v_job.vibe_preset,
                jsonb_build_object(
                    'auto_imported', true,
                    'backfill', true,
                    'imported_at', NOW(),
                    'source_job_id', v_job.id,
                    'platform', v_platform
                )
            )
            RETURNING id INTO v_post_id;
            
            v_count := v_count + 1;
        END LOOP;
    END LOOP;
    
    RAISE NOTICE 'Backfilled % posts from existing completed jobs', v_count;
END $$;

COMMENT ON FUNCTION auto_import_job_to_posts IS 
'Automatically creates scheduled posts when a job completes with a video_url. Creates one post per target platform.';
