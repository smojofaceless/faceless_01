-- Force immediate retry for TikTok with SELF_ONLY privacy (deployed)
UPDATE posts
SET 
  scheduled_at = NOW() - INTERVAL '1 minute',
  next_attempt_at = NULL,
  attempt_count = 0,
  error = NULL,
  updated_at = NOW()
WHERE id = '72429a52-e57f-410b-803b-b3a7217f2546'
AND status = 'scheduled';
