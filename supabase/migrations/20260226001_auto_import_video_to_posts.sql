-- =====================================================
-- AUTO IMPORT VIDEO TO POSTS
-- Automatically creates posts when a video is saved to job_assets
-- =====================================================
-- 
-- When the video-renderer completes and inserts final_mp4 into job_assets,
-- this trigger automatically creates post records for each platform
-- specified in the job's target_platforms.
-- 
-- Flow: job_assets INSERT (type=final_mp4) → trigger fires → posts created → schedule-posts picks them up
-- =====================================================

-- =====================================================
-- FUNCTION: Auto-import job to posts when video asset is created
-- =====================================================
CREATE OR REPLACE FUNCTION auto_import_job_to_posts()
RETURNS TRIGGER AS $$
DECLARE
    v_job RECORD;
    v_video_url TEXT;
    v_brand_id UUID;
    v_platforms TEXT[];
    v_platform TEXT;
    v_post_id UUID;
    v_scheduled_at TIMESTAMPTZ;
    v_title TEXT;
    v_description TEXT;
BEGIN
    -- Only trigger on final_mp4 assets
    IF NEW.type != 'final_mp4' THEN
        RETURN NEW;
    END IF;
    
    -- Get video URL from the asset
    v_video_url := COALESCE(NEW.public_url, NEW.storage_path);
    IF v_video_url IS NULL THEN
        RAISE NOTICE 'No video URL in asset, skipping auto-import';
        RETURN NEW;
    END IF;
    
    -- Get the job details
    SELECT * INTO v_job FROM jobs WHERE id = NEW.job_id;
    IF NOT FOUND THEN
        RAISE NOTICE 'Job % not found, skipping auto-import', NEW.job_id;
        RETURN NEW;
    END IF;
    
    -- Only for completed jobs
    IF v_job.status NOT IN ('complete', 'completed') THEN
        RAISE NOTICE 'Job % not complete (status=%), skipping auto-import', NEW.job_id, v_job.status;
        RETURN NEW;
    END IF;
    
    -- Check if already imported (prevent duplicates)
    IF EXISTS (SELECT 1 FROM posts WHERE source_job_id = NEW.job_id LIMIT 1) THEN
        RAISE NOTICE 'Job % already has posts, skipping auto-import', NEW.job_id;
        RETURN NEW;
    END IF;
    
    -- Get brand_id from job or batch
    v_brand_id := v_job.brand_id;
    IF v_brand_id IS NULL AND v_job.batch_id IS NOT NULL THEN
        SELECT brand_id INTO v_brand_id
        FROM generation_batches
        WHERE id = v_job.batch_id;
    END IF;
    
    IF v_brand_id IS NULL THEN
        RAISE NOTICE 'No brand_id for job %, skipping auto-import', NEW.job_id;
        RETURN NEW;
    END IF;
    
    -- Get target platforms from job (default to youtube if not set)
    v_platforms := COALESCE(v_job.target_platforms, ARRAY['youtube']);
    
    -- Use job's scheduled time or NOW + 1 hour
    v_scheduled_at := COALESCE(v_job.scheduled_post_at, NOW() + INTERVAL '1 hour');
    
    -- Build title and description
    v_title := COALESCE(v_job.title, 'Untitled Video');
    v_description := v_job.story_text;
    
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
            NEW.job_id,
            NEW.job_id,
            v_job.batch_id,
            v_video_url,
            v_job.duration_sec,
            v_title,
            v_description,
            ARRAY[v_platform],
            'scheduled',  -- Ready to be picked up by schedule-posts
            v_scheduled_at,
            v_job.vibe_preset,
            jsonb_build_object(
                'auto_imported', true,
                'imported_at', NOW(),
                'source_job_id', NEW.job_id,
                'source_asset_id', NEW.id,
                'platform', v_platform,
                'length_preset', v_job.length_preset,
                'visual_preset', v_job.visual_preset
            )
        )
        RETURNING id INTO v_post_id;
        
        RAISE NOTICE 'Auto-created post % for job % on platform %', v_post_id, NEW.job_id, v_platform;
    END LOOP;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRIGGER: Auto-import on job_assets INSERT (final_mp4)
-- =====================================================
DROP TRIGGER IF EXISTS trg_auto_import_video_to_posts ON job_assets;
CREATE TRIGGER trg_auto_import_video_to_posts
    AFTER INSERT ON job_assets
    FOR EACH ROW
    WHEN (NEW.type = 'final_mp4')
    EXECUTE FUNCTION auto_import_job_to_posts();

-- =====================================================
-- Add job_id and batch_id columns to posts if not exist
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
    v_asset RECORD;
    v_job RECORD;
    v_brand_id UUID;
    v_platforms TEXT[];
    v_platform TEXT;
    v_post_id UUID;
    v_count INTEGER := 0;
BEGIN
    -- Find all final_mp4 assets without corresponding posts
    FOR v_asset IN 
        SELECT ja.* 
        FROM job_assets ja
        JOIN jobs j ON j.id = ja.job_id
        LEFT JOIN posts p ON p.source_job_id = ja.job_id
        WHERE ja.type = 'final_mp4'
          AND j.status IN ('complete', 'completed')
          AND (ja.public_url IS NOT NULL OR ja.storage_path IS NOT NULL)
          AND p.id IS NULL
        ORDER BY ja.created_at DESC
        LIMIT 50  -- Limit backfill to avoid long transaction
    LOOP
        -- Get job details
        SELECT * INTO v_job FROM jobs WHERE id = v_asset.job_id;
        IF NOT FOUND THEN
            CONTINUE;
        END IF;
        
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
                v_asset.job_id,
                v_asset.job_id,
                v_job.batch_id,
                COALESCE(v_asset.public_url, v_asset.storage_path),
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
                    'source_job_id', v_asset.job_id,
                    'source_asset_id', v_asset.id,
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
'Automatically creates scheduled posts when a final_mp4 asset is inserted into job_assets. Creates one post per target platform.';
