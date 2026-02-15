-- =====================================================
-- POST REGISTRY HARDENING (Roadmap #17 follow-up)
-- Add missing indexes for registry filter patterns
-- =====================================================

-- Composite index for calendar/registry queries filtered by brand + time
-- Used by: get_post_registry(p_brand_id, ...), calendar views
CREATE INDEX IF NOT EXISTS idx_posts_brand_scheduled
  ON posts (brand_id, scheduled_at DESC)
  WHERE scheduled_at IS NOT NULL;

-- Index for "lookup by platform post ID" — future metrics collection
-- will need to look up posts by their external platform identifier
-- Used by: future Roadmap #18 (metrics pulls match platform ID → post)
CREATE INDEX IF NOT EXISTS idx_posts_platform_post_id
  ON posts (platform_post_id)
  WHERE platform_post_id IS NOT NULL;
