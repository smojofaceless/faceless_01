-- =====================================================
-- Migration: 20260212_story_dna_read_access.sql
-- Purpose: Grant authenticated users read-only access to story_dna
--          and execute permissions on uniqueness RPCs for the
--          testing UI on the brands page.
-- =====================================================

-- Allow authenticated users to SELECT from story_dna (read-only)
DO $$
BEGIN
    DROP POLICY IF EXISTS "Authenticated users can read story_dna" ON story_dna;
    
    CREATE POLICY "Authenticated users can read story_dna"
        ON story_dna
        FOR SELECT
        TO authenticated
        USING (true);
    
    RAISE NOTICE 'Created authenticated read policy for story_dna';
END $$;

-- Allow authenticated users to SELECT from stories (read-only)
DO $$
BEGIN
    DROP POLICY IF EXISTS "Authenticated users can read stories" ON stories;
    
    CREATE POLICY "Authenticated users can read stories"
        ON stories
        FOR SELECT
        TO authenticated
        USING (true);
    
    RAISE NOTICE 'Created authenticated read policy for stories';
END $$;

-- Grant execute on uniqueness RPCs to authenticated
GRANT EXECUTE ON FUNCTION is_concept_unique(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_dna_statistics() TO authenticated;
