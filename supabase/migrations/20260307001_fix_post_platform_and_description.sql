-- =====================================================
-- FIX: auto_import_job_to_posts missing `platform` column (singular)
--
-- Problem: The auto_import trigger sets `platforms` (TEXT[]) but not `platform` (TEXT).
-- The schedule_post_idempotent RPC checks `WHERE job_id AND platform = ?`, so it 
-- doesn't find the auto-imported post → creates a DUPLICATE with platform set but
-- description = NULL. The post-worker then picks up the step-10 post (which has 
-- the platform column) instead of the auto-import post (which has the description).
-- Result: Instagram posts only show the title, not the story text or AI metadata.
--
-- Fix:
-- 1. Update auto_import trigger to also set `platform = v_platform`
-- 2. Backfill existing posts: set platform FROM platforms[1] WHERE platform IS NULL
-- 3. Backfill existing posts: set description FROM job.story_text WHERE description IS NULL
-- 4. Remove duplicate posts (NULL-platform copies from auto_import)
-- =====================================================

-- =====================================================
-- PART 1: Fix auto_import_job_to_posts trigger function
-- =====================================================
CREATE OR REPLACE FUNCTION auto_import_job_to_posts()
RETURNS TRIGGER AS $$
DECLARE
    v_job RECORD;
    v_video_url TEXT;
    v_brand_id UUID;
    v_platforms TEXT[];
    v_platform TEXT;
    v_title TEXT;
    v_description TEXT;
    v_scheduled_at TIMESTAMPTZ;
    v_post_id UUID;
BEGIN
    -- Only handle final_mp4 assets
    IF NEW.type != 'final_mp4' THEN
        RETURN NEW;
    END IF;
    
    -- Get job details
    SELECT * INTO v_job FROM jobs WHERE id = NEW.job_id;
    IF NOT FOUND THEN
        RAISE NOTICE 'Job % not found, skipping auto-import', NEW.job_id;
        RETURN NEW;
    END IF;
    
    -- Only import completed jobs
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
    
    -- Get video URL
    v_video_url := COALESCE(NEW.public_url, NEW.storage_path);
    IF v_video_url IS NULL THEN
        RAISE NOTICE 'No video URL for asset %, skipping auto-import', NEW.id;
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
            platform,
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
            v_platform,
            ARRAY[v_platform],
            'scheduled',
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
-- PART 2: Backfill — set platform from platforms[1] where NULL
-- =====================================================
UPDATE posts 
SET platform = platforms[1]
WHERE platform IS NULL 
  AND platforms IS NOT NULL 
  AND array_length(platforms, 1) > 0;

-- =====================================================
-- PART 3: Backfill — set description from job.story_text where NULL
-- =====================================================
UPDATE posts p
SET description = j.story_text
FROM jobs j
WHERE p.job_id = j.id
  AND p.description IS NULL
  AND j.story_text IS NOT NULL;

-- =====================================================
-- PART 4: Remove duplicate posts (keep the one with earlier created_at)
-- For each job_id + platform combo, keep only one post
-- =====================================================
DELETE FROM posts
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY job_id, platform 
                   ORDER BY 
                       -- Prefer posts with description set
                       CASE WHEN description IS NOT NULL THEN 0 ELSE 1 END,
                       created_at ASC
               ) AS rn
        FROM posts
        WHERE job_id IS NOT NULL 
          AND platform IS NOT NULL
    ) ranked
    WHERE rn > 1
);

-- =====================================================
-- PART 5: Add defensive filter to claim_due_posts — skip NULL platform
-- =====================================================
CREATE OR REPLACE FUNCTION claim_due_posts(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 5,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  post_id UUID,
  job_id UUID,
  brand_id UUID,
  batch_id UUID,
  platform TEXT,
  video_url TEXT,
  title TEXT,
  description TEXT,
  tags TEXT[],
  scheduled_at TIMESTAMPTZ,
  attempt_count INTEGER,
  meta JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_lease_until TIMESTAMPTZ := v_now + (p_lease_seconds || ' seconds')::INTERVAL;
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT p.id
    FROM posts p
    LEFT JOIN generation_batches gb ON p.batch_id = gb.id
    WHERE 
      p.status = 'scheduled'
      AND p.scheduled_at <= v_now
      AND (p.lease_expires_at IS NULL OR p.lease_expires_at < v_now)
      -- Allow completed campaigns (only block paused/cancelled)
      AND (gb.id IS NULL OR gb.status NOT IN ('paused', 'cancelled'))
      AND COALESCE(p.attempt_count, 0) < 3
      -- Skip posts without a platform — they cannot be dispatched
      AND p.platform IS NOT NULL
    ORDER BY p.scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE OF p SKIP LOCKED
  ),
  claimed AS (
    UPDATE posts
    SET 
      status = 'posting',
      locked_by = p_worker_id,
      locked_at = v_now,
      lease_expires_at = v_lease_until,
      attempt_count = COALESCE(posts.attempt_count, 0) + 1,
      last_attempt_at = v_now,
      next_attempt_at = NULL,
      updated_at = v_now
    WHERE id IN (SELECT id FROM claimable)
    RETURNING *
  )
  SELECT 
    c.id AS post_id,
    c.job_id,
    c.brand_id,
    c.batch_id,
    c.platform,
    c.video_url,
    c.title,
    c.description,
    c.tags,
    c.scheduled_at,
    c.attempt_count,
    c.ai_metadata AS meta
  FROM claimed c;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_due_posts(TEXT, INTEGER, INTEGER) TO service_role;
