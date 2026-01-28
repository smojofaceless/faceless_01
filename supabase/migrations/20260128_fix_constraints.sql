-- =====================================================
-- Fix Constraints for Phased Processing
-- =====================================================

-- Add 'preview' and 'rendering' to jobs status
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check 
    CHECK (status IN ('queued', 'preview', 'generating', 'assembling', 'rendering', 'complete', 'failed'));

-- Add '90' to length_preset
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_length_preset_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_length_preset_check 
    CHECK (length_preset IN ('30', '45', '60', '90'));

-- Add new asset types: dalle_image, scene_data, render_job
ALTER TABLE job_assets DROP CONSTRAINT IF EXISTS job_assets_type_check;
ALTER TABLE job_assets ADD CONSTRAINT job_assets_type_check 
    CHECK (type IN ('story_json', 'captions_srt', 'captions_json', 'audio_mp3', 'bg_video', 'final_mp4', 'dalle_image', 'scene_data', 'render_job'));
