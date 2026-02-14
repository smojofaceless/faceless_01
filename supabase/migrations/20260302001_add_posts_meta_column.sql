-- =====================================================
-- ADD META COLUMN TO POSTS TABLE
-- The schedule_post_idempotent RPC inserts p_meta into posts.meta,
-- but the column was never added. This fixes that.
-- Date: 2026-03-02
-- =====================================================

-- Add meta JSONB column for schedule_post_idempotent compatibility
ALTER TABLE posts ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;
