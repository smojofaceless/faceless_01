-- =====================================================
-- Migration: Expand job_assets type check
-- Purpose: Add all asset types used by worker-v1
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
        'audio', 'voice_hash', 'final_video', 'final_video_storage', 'post_schedule'
    ) OR type LIKE 'image_scene_%' OR type LIKE 'image_prompt_%');
