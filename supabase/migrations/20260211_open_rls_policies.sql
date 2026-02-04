-- =====================================================
-- Add anon-friendly RLS policies for dev/demo mode
-- The app uses anon tokens, so we need open RLS
-- =====================================================

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "posts_select_own" ON posts;
DROP POLICY IF EXISTS "posts_insert_own" ON posts;
DROP POLICY IF EXISTS "posts_update_own" ON posts;
DROP POLICY IF EXISTS "posts_delete_own" ON posts;

-- Create permissive policies that allow anon access
-- In production, you would want proper auth setup

-- Posts - allow all access (dev/demo mode)
CREATE POLICY "posts_select_all" ON posts FOR SELECT
    USING (true);
    
CREATE POLICY "posts_insert_all" ON posts FOR INSERT
    WITH CHECK (true);
    
CREATE POLICY "posts_update_all" ON posts FOR UPDATE
    USING (true);
    
CREATE POLICY "posts_delete_all" ON posts FOR DELETE
    USING (true);

-- Same for post_analytics
DROP POLICY IF EXISTS "post_analytics_select_own" ON post_analytics;
DROP POLICY IF EXISTS "post_analytics_insert_own" ON post_analytics;

CREATE POLICY "post_analytics_select_all" ON post_analytics FOR SELECT
    USING (true);
    
CREATE POLICY "post_analytics_insert_all" ON post_analytics FOR INSERT
    WITH CHECK (true);

-- Same for platform_tokens
DROP POLICY IF EXISTS "platform_tokens_select_own" ON platform_tokens;
DROP POLICY IF EXISTS "platform_tokens_insert_own" ON platform_tokens;
DROP POLICY IF EXISTS "platform_tokens_update_own" ON platform_tokens;
DROP POLICY IF EXISTS "platform_tokens_delete_own" ON platform_tokens;

CREATE POLICY "platform_tokens_select_all" ON platform_tokens FOR SELECT
    USING (true);
    
CREATE POLICY "platform_tokens_insert_all" ON platform_tokens FOR INSERT
    WITH CHECK (true);
    
CREATE POLICY "platform_tokens_update_all" ON platform_tokens FOR UPDATE
    USING (true);
    
CREATE POLICY "platform_tokens_delete_all" ON platform_tokens FOR DELETE
    USING (true);

-- Same for generation_batches
DROP POLICY IF EXISTS "generation_batches_select_own" ON generation_batches;
DROP POLICY IF EXISTS "generation_batches_insert_own" ON generation_batches;
DROP POLICY IF EXISTS "generation_batches_update_own" ON generation_batches;

CREATE POLICY "generation_batches_select_all" ON generation_batches FOR SELECT
    USING (true);
    
CREATE POLICY "generation_batches_insert_all" ON generation_batches FOR INSERT
    WITH CHECK (true);
    
CREATE POLICY "generation_batches_update_all" ON generation_batches FOR UPDATE
    USING (true);

-- Same for time_slot_scores
DROP POLICY IF EXISTS "time_slot_scores_select_own" ON time_slot_scores;
DROP POLICY IF EXISTS "time_slot_scores_insert_own" ON time_slot_scores;
DROP POLICY IF EXISTS "time_slot_scores_update_own" ON time_slot_scores;

CREATE POLICY "time_slot_scores_select_all" ON time_slot_scores FOR SELECT
    USING (true);
    
CREATE POLICY "time_slot_scores_insert_all" ON time_slot_scores FOR INSERT
    WITH CHECK (true);
    
CREATE POLICY "time_slot_scores_update_all" ON time_slot_scores FOR UPDATE
    USING (true);

-- Grant anon full access to tables
GRANT SELECT, INSERT, UPDATE, DELETE ON posts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON post_analytics TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_tokens TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON generation_batches TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON time_slot_scores TO anon;
