-- =====================================================
-- Add metadata JSONB column to platform_tokens
-- Stores platform-specific extra data like:
--   - Facebook page_access_token
--   - Cross-references (instagram_account_id on facebook token, etc.)
-- =====================================================

ALTER TABLE platform_tokens ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN platform_tokens.metadata IS 'Platform-specific metadata: facebook page_access_token, cross-platform references, etc.';
