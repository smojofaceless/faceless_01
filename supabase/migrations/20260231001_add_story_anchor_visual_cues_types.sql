-- =====================================================
-- Migration: Add story_anchor + visual_cues to job_assets type check
-- 
-- Root cause: upsertAsset() for these types silently fails because
-- the CHECK constraint on job_assets.type doesn't include them.
-- Story anchors and visual cues are created in memory during image
-- generation but never persist, so:
--   1. Continuation invocations regenerate them (wasting ~10s + API calls)
--   2. Cross-invocation consistency is lost
--
-- v1.0 - 2026-02-31
-- =====================================================

-- Drop and recreate with expanded types
ALTER TABLE job_assets DROP CONSTRAINT IF EXISTS job_assets_type_check;
ALTER TABLE job_assets ADD CONSTRAINT job_assets_type_check 
    CHECK (type IN (
        -- Original types
        'story_json', 'captions_srt', 'captions_json', 'audio_mp3', 'bg_video', 'final_mp4',
        -- Legacy types
        'scene_data', 'dalle_image', 'voice_audio', 'music_audio', 'subtitles_srt',
        -- Worker v1 step types
        'story', 'uniqueness_check', 'scenes', 'voice', 'music', 'images', 'subtitles', 'video',
        -- Worker v1 asset types (for upsertAsset calls)
        'audio', 'voice_hash', 'final_video', 'final_video_storage', 'post_schedule',
        -- Image pipeline caching types (NEW)
        'story_anchor', 'visual_cues'
    ) OR type LIKE 'image_scene_%' OR type LIKE 'image_prompt_%');

-- Add comment for documentation
COMMENT ON CONSTRAINT job_assets_type_check ON job_assets IS
'Allowed asset types. story_anchor and visual_cues added 2026-02-31 to fix silent upsert failures in image pipeline caching.';
