-- Fix: Mark metadata as permanently failed for threads/twitter so
-- post-worker falls through and posts with original fields.
-- Also reset the posts from 'failed' back to 'scheduled' for retry.

-- 1. Force-fail metadata so post-worker doesn't keep waiting
UPDATE post_metadata
SET 
  status = 'failed',
  attempt_count = 3,
  failure_class = 'permanent',
  error = 'Force-failed: posting with original fields',
  updated_at = NOW()
WHERE post_id IN (
  'e000afcd-b1d3-4c39-869f-a1ba05592041',  -- threads
  '4e5b42c8-e8ed-4688-90b2-e5cd3968e16c'   -- twitter
)
AND status = 'failed';

-- 2. Reset posts to scheduled so the scheduler picks them up
UPDATE posts
SET 
  status = 'scheduled',
  scheduled_at = '2026-02-17T02:26:15.647+00:00',
  next_attempt_at = NULL,
  attempt_count = 0,
  locked_by = NULL,
  locked_at = NULL,
  lease_expires_at = NULL,
  error = NULL,
  error_message = NULL,
  updated_at = NOW()
WHERE id IN (
  'e000afcd-b1d3-4c39-869f-a1ba05592041',  -- threads
  '4e5b42c8-e8ed-4688-90b2-e5cd3968e16c'   -- twitter
)
AND status = 'failed';
