-- Add 'img2vid_clip' to job_assets type constraint
-- Root cause: executeImg2VidStep creates assets with type='img2vid_clip' via
-- upsertAsset, which wasn't in the CHECK constraint, causing
-- "violates check constraint job_assets_type_check"
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
        'gameplay_clip',
        -- img2vid video clips (SVD/ComfyUI generated)
        'img2vid_clip'
    ) OR type LIKE 'image_scene_%' OR type LIKE 'image_prompt_%');

COMMENT ON CONSTRAINT job_assets_type_check ON job_assets IS
'Allowed asset types. img2vid_clip added 2026-03-02 for SVD/ComfyUI video clip assets in executeImg2VidStep.';
