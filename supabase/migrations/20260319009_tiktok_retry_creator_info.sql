-- Reset TikTok post for retry with creator-info query
UPDATE posts
SET status       = 'scheduled',
    attempt_count = 0,
    error         = NULL,
    scheduled_at  = NOW() - INTERVAL '1 minute',
    next_attempt_at = NULL,
    updated_at    = NOW()
WHERE id = '72429a52-e57f-410b-803b-b3a7217f2546';
