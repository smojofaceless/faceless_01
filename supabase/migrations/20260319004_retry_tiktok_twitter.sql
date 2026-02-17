-- Retry Twitter (text-only fallback) and TikTok (verification file now deployed)
-- Reset both from 'failed' back to 'scheduled' at past time

-- Force-fail TikTok metadata too so it falls through
UPDATE post_metadata
SET 
  status = 'failed',
  attempt_count = 3,
  failure_class = 'permanent',
  error = 'Force-failed: posting with original fields',
  updated_at = NOW()
WHERE post_id = '72429a52-e57f-410b-803b-b3a7217f2546'  -- tiktok
AND status = 'failed';

-- Reset both posts
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
  '72429a52-e57f-410b-803b-b3a7217f2546',  -- tiktok
  '4e5b42c8-e8ed-4688-90b2-e5cd3968e16c'   -- twitter
)
AND status = 'failed';
