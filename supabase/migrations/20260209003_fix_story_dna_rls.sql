-- =====================================================
-- Migration: 20260209_fix_story_dna_rls.sql
-- Purpose: Fix DNA table schema and RLS for Edge Function writes
-- 
-- DIAGNOSIS: 272 jobs with stories, 0 DNA rows
-- ROOT CAUSES FOUND:
--   1. RLS policies missing for service_role
--   2. Legacy columns (threat_id, ending_id) were NOT NULL but code uses new split columns
--   3. visual_dna missing brand_id column that code tries to insert
-- 
-- APPLIED: February 9, 2026
-- =====================================================

-- Enable RLS if not already enabled (safe to re-run)
ALTER TABLE story_dna ENABLE ROW LEVEL SECURITY;
ALTER TABLE visual_dna ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- FIX 1: STORY_DNA - Service role full access
-- =====================================================
DO $$
BEGIN
    DROP POLICY IF EXISTS "Service role has full access to story_dna" ON story_dna;
    
    CREATE POLICY "Service role has full access to story_dna"
        ON story_dna
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    
    RAISE NOTICE 'Created service_role policy for story_dna';
END $$;

-- =====================================================
-- FIX 2: VISUAL_DNA - Service role full access
-- =====================================================
DO $$
BEGIN
    DROP POLICY IF EXISTS "Service role has full access to visual_dna" ON visual_dna;
    
    CREATE POLICY "Service role has full access to visual_dna"
        ON visual_dna
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    
    RAISE NOTICE 'Created service_role policy for visual_dna';
END $$;

-- =====================================================
-- FIX 3: STORY_DNA - Make legacy columns nullable
-- Code now uses split columns (threat_behavior_id, threat_manifestation_id, 
-- ending_knowledge_id, ending_imagery_id) instead of legacy (threat_id, ending_id)
-- =====================================================
ALTER TABLE story_dna ALTER COLUMN threat_id DROP NOT NULL;
ALTER TABLE story_dna ALTER COLUMN ending_id DROP NOT NULL;

-- =====================================================
-- FIX 4: VISUAL_DNA - Add missing brand_id column
-- Code tries to insert brand_id but column didn't exist
-- =====================================================
ALTER TABLE visual_dna 
ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE SET NULL;

-- =====================================================
-- VERIFICATION QUERIES (run after migration)
-- =====================================================
-- SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'story_dna';
-- SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'visual_dna';
-- SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'story_dna' AND column_name IN ('threat_id', 'ending_id');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'visual_dna' AND column_name = 'brand_id';
