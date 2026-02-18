-- Reset TikTok post for retry (domain now verified)
UPDATE posts
SET 
  status = 'scheduled',
  scheduled_at = NOW() - INTERVAL '1 minute',
  next_attempt_at = NULL,
  attempt_count = 0,
  locked_by = NULL,
  locked_at = NULL,
  lease_expires_at = NULL,
  error = NULL,
  error_message = NULL,
  updated_at = NOW()
WHERE id = '72429a52-e57f-410b-803b-b3a7217f2546'  -- tiktok
AND status = 'failed';

-- Mark Twitter post as permanently failed (X API requires paid tier)
UPDATE posts
SET
  error = jsonb_build_object(
    'class', 'permanent',
    'attempt', 3,
    'message', 'X/Twitter API requires paid tier — no free posting available',
    'failed_at', NOW()
  ),
  updated_at = NOW()
WHERE id = '4e5b42c8-e8ed-4688-90b2-e5cd3968e16c'  -- twitter
AND status = 'failed';
