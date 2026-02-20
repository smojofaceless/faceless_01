-- =====================================================
-- Migration: 20260310005_gameplay_clips_anon_policy.sql
-- Purpose: Add anon role access to gameplay_clips table
-- 
-- The dashboard client uses the anon key (no auth sign-in),
-- so it needs anon policies for CRUD operations.
-- =====================================================

-- Allow anon role full access (dashboard uses anon key)
CREATE POLICY "anon_gameplay_clips_all"
    ON gameplay_clips FOR ALL
    TO anon
    USING (true)
    WITH CHECK (true);

-- Grant table permissions to anon
GRANT SELECT, INSERT, UPDATE, DELETE ON gameplay_clips TO anon;

-- Grant RPC permissions to anon
GRANT EXECUTE ON FUNCTION get_brand_gameplay_clips(UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION select_gameplay_clip_with_offset(UUID, UUID, INT, TEXT) TO anon;
