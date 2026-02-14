-- =====================================================
-- Story DNA System - Database Schema
-- Migration: 20260204_story_dna.sql
-- Purpose: Store pre-generated story DNA for uniqueness tracking
-- 
-- This implements the "Story DNA" architecture where story
-- parameters are determined BEFORE AI generation, ensuring
-- mathematical uniqueness at scale.
-- =====================================================

-- =====================================================
-- STORY DNA TABLE
-- Stores the DNA (parameters) of every generated story
-- =====================================================
CREATE TABLE IF NOT EXISTS story_dna (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Hash-based uniqueness detection
    concept_hash TEXT NOT NULL,     -- Hash of (threat + weird_axis + escalation) - core uniqueness
    full_hash TEXT NOT NULL,        -- Hash of entire DNA - exact duplicate detection
    
    -- Temporal dimension
    era_id TEXT NOT NULL,           -- e.g., "1970s_late"
    era_label TEXT NOT NULL,        -- e.g., "late 1970s"
    
    -- Spatial dimension
    location_id TEXT NOT NULL,      -- e.g., "forest_trail"
    location_label TEXT NOT NULL,   -- e.g., "forest trails"
    specific_states TEXT[] DEFAULT '{}',  -- e.g., ["Oregon", "Washington", "Idaho"]
    
    -- Narrative structure
    subgenre_id TEXT NOT NULL,      -- e.g., "urban_legend"
    authority_id TEXT NOT NULL,     -- e.g., "files_lost"
    
    -- Core horror elements (THE KEY UNIQUENESS FACTORS)
    threat_id TEXT NOT NULL,        -- e.g., "figure_watching"
    threat_description TEXT,        -- Human-readable description
    
    repeating_detail_id TEXT NOT NULL,  -- e.g., "face_covered"
    repeating_detail_description TEXT,
    
    weird_axis_id TEXT NOT NULL,    -- e.g., "photos_closer"
    weird_axis_description TEXT,
    
    -- Structure
    escalation_id TEXT NOT NULL,    -- e.g., "sightings_to_missing"
    ending_id TEXT NOT NULL,        -- e.g., "still_watching"
    
    -- Emotional target
    emotion_id TEXT NOT NULL,       -- e.g., "unease"
    
    -- Generation metadata
    generation_attempt INTEGER DEFAULT 1,  -- How many attempts to find unique DNA
    
    -- Links to generated content
    story_id UUID REFERENCES stories(id) ON DELETE SET NULL,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    
    -- Analytics
    meta JSONB DEFAULT '{}'::jsonb
);

-- =====================================================
-- INDEXES FOR FAST LOOKUPS
-- =====================================================

-- Concept hash index - for checking if core concept exists
CREATE INDEX IF NOT EXISTS idx_story_dna_concept_hash ON story_dna(concept_hash);

-- Full hash index - for exact duplicate detection
CREATE INDEX IF NOT EXISTS idx_story_dna_full_hash ON story_dna(full_hash);

-- Time-based lookups for recent concept avoidance
CREATE INDEX IF NOT EXISTS idx_story_dna_created_at ON story_dna(created_at DESC);

-- Component-based lookups for analytics and avoidance
CREATE INDEX IF NOT EXISTS idx_story_dna_threat_id ON story_dna(threat_id);
CREATE INDEX IF NOT EXISTS idx_story_dna_weird_axis_id ON story_dna(weird_axis_id);
CREATE INDEX IF NOT EXISTS idx_story_dna_escalation_id ON story_dna(escalation_id);
CREATE INDEX IF NOT EXISTS idx_story_dna_era_id ON story_dna(era_id);
CREATE INDEX IF NOT EXISTS idx_story_dna_location_id ON story_dna(location_id);

-- Link indexes
CREATE INDEX IF NOT EXISTS idx_story_dna_story_id ON story_dna(story_id);
CREATE INDEX IF NOT EXISTS idx_story_dna_job_id ON story_dna(job_id);

-- =====================================================
-- CONCEPT USAGE TRACKING VIEW
-- Helps identify overused concepts
-- =====================================================
DROP VIEW IF EXISTS story_dna_concept_usage CASCADE;
CREATE OR REPLACE VIEW story_dna_concept_usage AS
SELECT 
    threat_id,
    weird_axis_id,
    escalation_id,
    COUNT(*) as usage_count,
    MAX(created_at) as last_used,
    MIN(created_at) as first_used
FROM story_dna
GROUP BY threat_id, weird_axis_id, escalation_id
ORDER BY usage_count DESC;

-- =====================================================
-- COMPONENT FREQUENCY VIEW
-- Shows which individual components are most/least used
-- =====================================================
DROP VIEW IF EXISTS story_dna_component_frequency CASCADE;
CREATE OR REPLACE VIEW story_dna_component_frequency AS
WITH 
threat_freq AS (
    SELECT 'threat' as component_type, threat_id as component_id, COUNT(*) as count
    FROM story_dna GROUP BY threat_id
),
weird_freq AS (
    SELECT 'weird_axis' as component_type, weird_axis_id as component_id, COUNT(*) as count
    FROM story_dna GROUP BY weird_axis_id
),
escalation_freq AS (
    SELECT 'escalation' as component_type, escalation_id as component_id, COUNT(*) as count
    FROM story_dna GROUP BY escalation_id
),
era_freq AS (
    SELECT 'era' as component_type, era_id as component_id, COUNT(*) as count
    FROM story_dna GROUP BY era_id
),
location_freq AS (
    SELECT 'location' as component_type, location_id as component_id, COUNT(*) as count
    FROM story_dna GROUP BY location_id
)
SELECT * FROM threat_freq
UNION ALL SELECT * FROM weird_freq
UNION ALL SELECT * FROM escalation_freq
UNION ALL SELECT * FROM era_freq
UNION ALL SELECT * FROM location_freq
ORDER BY component_type, count DESC;

-- =====================================================
-- DAILY GENERATION STATS VIEW
-- =====================================================
DROP VIEW IF EXISTS story_dna_daily_stats CASCADE;
CREATE OR REPLACE VIEW story_dna_daily_stats AS
SELECT 
    DATE(created_at) as generation_date,
    COUNT(*) as stories_generated,
    COUNT(DISTINCT concept_hash) as unique_concepts,
    AVG(generation_attempt) as avg_attempts_for_uniqueness,
    MAX(generation_attempt) as max_attempts
FROM story_dna
GROUP BY DATE(created_at)
ORDER BY generation_date DESC;

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE story_dna ENABLE ROW LEVEL SECURITY;

-- Allow all operations (MVP - personal use only)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'story_dna' AND policyname = 'Allow all operations on story_dna'
  ) THEN
    CREATE POLICY "Allow all operations on story_dna" ON story_dna
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- =====================================================
-- FUNCTION: Get least-used components
-- Returns components that should be prioritized for variety
-- =====================================================
DROP FUNCTION IF EXISTS get_underused_components(TEXT, INTEGER);
DROP FUNCTION IF EXISTS get_underused_components(TEXT, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION get_underused_components(
    p_component_type TEXT,
    p_limit INTEGER DEFAULT 5
)
RETURNS TABLE(component_id TEXT, usage_count BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cf.component_id,
        cf.count
    FROM story_dna_component_frequency cf
    WHERE cf.component_type = p_component_type
    ORDER BY cf.count ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- FUNCTION: Check concept uniqueness
-- Returns true if the concept hash doesn't exist recently
-- =====================================================
DROP FUNCTION IF EXISTS is_concept_unique(TEXT, INTEGER);
CREATE OR REPLACE FUNCTION is_concept_unique(
    p_concept_hash TEXT,
    p_lookback_days INTEGER DEFAULT 60
)
RETURNS BOOLEAN AS $$
DECLARE
    v_exists BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM story_dna 
        WHERE concept_hash = p_concept_hash
        AND created_at > NOW() - (p_lookback_days || ' days')::INTERVAL
    ) INTO v_exists;
    
    RETURN NOT v_exists;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- FUNCTION: Get DNA statistics
-- Returns overall system health metrics
-- =====================================================
DROP FUNCTION IF EXISTS get_dna_statistics();
CREATE OR REPLACE FUNCTION get_dna_statistics()
RETURNS TABLE(
    total_generated BIGINT,
    unique_concepts BIGINT,
    stories_last_7_days BIGINT,
    stories_last_30_days BIGINT,
    avg_uniqueness_attempts NUMERIC,
    most_used_threat TEXT,
    most_used_weird_axis TEXT,
    least_used_threat TEXT,
    least_used_weird_axis TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT COUNT(*) FROM story_dna)::BIGINT as total_generated,
        (SELECT COUNT(DISTINCT concept_hash) FROM story_dna)::BIGINT as unique_concepts,
        (SELECT COUNT(*) FROM story_dna WHERE created_at > NOW() - INTERVAL '7 days')::BIGINT as stories_last_7_days,
        (SELECT COUNT(*) FROM story_dna WHERE created_at > NOW() - INTERVAL '30 days')::BIGINT as stories_last_30_days,
        (SELECT ROUND(AVG(generation_attempt), 2) FROM story_dna) as avg_uniqueness_attempts,
        (SELECT threat_id FROM story_dna GROUP BY threat_id ORDER BY COUNT(*) DESC LIMIT 1) as most_used_threat,
        (SELECT weird_axis_id FROM story_dna GROUP BY weird_axis_id ORDER BY COUNT(*) DESC LIMIT 1) as most_used_weird_axis,
        (SELECT threat_id FROM story_dna GROUP BY threat_id ORDER BY COUNT(*) ASC LIMIT 1) as least_used_threat,
        (SELECT weird_axis_id FROM story_dna GROUP BY weird_axis_id ORDER BY COUNT(*) ASC LIMIT 1) as least_used_weird_axis;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================
COMMENT ON TABLE story_dna IS 'Stores pre-generated story DNA parameters for uniqueness tracking. Each story is defined by its DNA BEFORE AI generation.';
COMMENT ON COLUMN story_dna.concept_hash IS 'Hash of (threat_id + weird_axis_id + escalation_id) - the core uniqueness signature';
COMMENT ON COLUMN story_dna.full_hash IS 'Hash of all DNA fields - for exact duplicate detection';
COMMENT ON COLUMN story_dna.weird_axis_id IS 'The unique "wrongness" that makes this story different - the most important field for variety';
COMMENT ON COLUMN story_dna.generation_attempt IS 'How many attempts were needed to find a unique DNA - higher = running low on combinations';
