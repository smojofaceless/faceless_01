-- Add 'gameplay_clip' to job_assets type constraint
-- Root cause: trySelectGameplayClip() stores an idempotency asset with
-- type='gameplay_clip', which wasn't in the CHECK constraint, causing
-- "violates check constraint job_assets_type_check" on the images step
-- for gameplay-enabled presets like no_good_choice.
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
        -- Image pipeline caching types
        'story_anchor', 'visual_cues',
        -- Gameplay clip selection (v1)
        'gameplay_clip'
    ) OR type LIKE 'image_scene_%' OR type LIKE 'image_prompt_%');

COMMENT ON CONSTRAINT job_assets_type_check ON job_assets IS
'Allowed asset types. gameplay_clip added 2026-02-20 for gameplay preset idempotency in trySelectGameplayClip.';
