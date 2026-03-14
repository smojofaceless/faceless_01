-- Calendar performance indexes
-- The existing idx_posts_scheduled_status is partial (WHERE status='scheduled')
-- and doesn't cover the calendar's all-status range queries.

-- Covers: posts range queries by scheduled_at (any status)
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at
ON posts(scheduled_at);

-- Covers: jobs range queries by scheduled_post_at for calendar
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_post_at
ON jobs(scheduled_post_at)
WHERE scheduled_post_at IS NOT NULL;

-- Covers: post_metadata lookups by post_id (used in batch enrichment)
CREATE INDEX IF NOT EXISTS idx_post_metadata_post_id
ON post_metadata(post_id);
