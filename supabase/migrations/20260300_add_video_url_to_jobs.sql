-- Add video_url column to jobs table
-- This column is used by the upload step to store the permanent video URL
-- and by the schedule step to pass the video URL to posts
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS video_url TEXT;

COMMENT ON COLUMN jobs.video_url IS 'Permanent storage URL for the final rendered video';

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
