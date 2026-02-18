-- Reset TikTok post for retry with SELF_ONLY privacy
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
WHERE id = '72429a52-e57f-410b-803b-b3a7217f2546';
