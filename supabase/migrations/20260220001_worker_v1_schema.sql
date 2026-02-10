-- =====================================================
-- WORKER V1 SCHEMA CHANGES
-- Idempotency columns and constraints for safe video pipeline
-- 
-- v1.0 - 2026-02-20
-- =====================================================

-- =====================================================
-- PART 1: JOB_ASSETS IDEMPOTENCY
-- =====================================================

-- Add idempotency_key column for deduplication
ALTER TABLE job_assets 
ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Update existing type constraint to include new asset types
ALTER TABLE job_assets DROP CONSTRAINT IF EXISTS job_assets_type_check;
ALTER TABLE job_assets ADD CONSTRAINT job_assets_type_check 
    CHECK (type IN (
        -- Existing types
        'story_json', 'captions_srt', 'captions_json', 'audio_mp3', 'bg_video', 'final_mp4',
        -- Legacy types (may exist)
        'scene_data', 'dalle_image', 'voice_audio', 'music_audio', 'subtitles_srt',
        -- Worker v1 types
        'story', 'uniqueness_check', 'scenes', 'voice', 'music', 'images', 'subtitles', 'video'
    ));

-- Unique constraint: (job_id, idempotency_key) for upsert safety
-- Allows only one asset per idempotency key per job
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_assets_idempotency 
ON job_assets(job_id, idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- =====================================================
-- PART 2: POSTS IDEMPOTENCY
-- =====================================================

-- Add job_id column if not exists (links post to source job)
ALTER TABLE posts 
ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;

-- Add platform column for single-platform scheduling (Worker V1 creates one post per platform)
ALTER TABLE posts
ADD COLUMN IF NOT EXISTS platform TEXT;

-- Index for job_id lookups
CREATE INDEX IF NOT EXISTS idx_posts_job_id ON posts(job_id) WHERE job_id IS NOT NULL;

-- Ensure no duplicate posts for same job + platform
-- This prevents "double-post" when schedule step retries
-- Only applies to posts with explicit platform set (not legacy platforms[] posts)
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_job_platform 
ON posts(job_id, platform) 
WHERE job_id IS NOT NULL AND platform IS NOT NULL;

-- =====================================================
-- PART 3: JOBS STEP TRACKING
-- =====================================================

-- Add current_step column for at-a-glance status
ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS current_step TEXT;

-- Index for dashboard queries filtering by step
CREATE INDEX IF NOT EXISTS idx_jobs_current_step ON jobs(current_step) WHERE current_step IS NOT NULL;

-- =====================================================
-- PART 4: ENSURE JOBS.META.STEPS STRUCTURE EXISTS
-- =====================================================

-- Initialize empty steps object in meta if not present
-- This runs once on existing jobs to ensure consistency
UPDATE jobs
SET meta = COALESCE(meta, '{}'::jsonb) || '{"steps": {}}'::jsonb
WHERE meta IS NULL OR NOT (meta ? 'steps');

-- =====================================================
-- PART 5: SERVICE ROLE POLICIES
-- =====================================================

-- Ensure service_role can access job_assets
DROP POLICY IF EXISTS "service_role_job_assets" ON job_assets;
CREATE POLICY "service_role_job_assets" ON job_assets
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON COLUMN job_assets.idempotency_key IS 
    'Unique key per job for safe upsert. Format: {step_name}:{sub_key} e.g., "images:scene_1"';

COMMENT ON COLUMN jobs.current_step IS 
    'Current worker step: story, uniqueness, scenes, voice, music, images, assemble, upload, schedule';

COMMENT ON INDEX idx_job_assets_idempotency IS 
    'Ensures idempotent asset creation - same key cannot be inserted twice per job';

COMMENT ON INDEX idx_posts_job_platform IS 
    'Prevents double-posting - only one post per job+platform allowed';
