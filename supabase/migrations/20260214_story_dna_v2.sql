-- =====================================================
-- Story DNA v2 - Enhanced Split Dimensions
-- Migration: 20260214_story_dna_v2.sql
-- 
-- Changes from v1:
-- 1. Split threat into threat_behavior + threat_manifestation
-- 2. Added narrative_artifact for voice/format variation
-- 3. Split ending into ending_knowledge + ending_imagery
-- 
-- This increases combinations from ~4.1B to ~49.8B
-- =====================================================

-- Add new columns for split threat dimensions
ALTER TABLE story_dna
ADD COLUMN IF NOT EXISTS threat_behavior_id TEXT,
ADD COLUMN IF NOT EXISTS threat_behavior_description TEXT,
ADD COLUMN IF NOT EXISTS threat_manifestation_id TEXT,
ADD COLUMN IF NOT EXISTS threat_manifestation_description TEXT;

-- Add narrative artifact column
ALTER TABLE story_dna
ADD COLUMN IF NOT EXISTS narrative_artifact_id TEXT,
ADD COLUMN IF NOT EXISTS narrative_artifact_label TEXT;

-- Add split ending columns
ALTER TABLE story_dna
ADD COLUMN IF NOT EXISTS ending_knowledge_id TEXT,
ADD COLUMN IF NOT EXISTS ending_knowledge_description TEXT,
ADD COLUMN IF NOT EXISTS ending_imagery_id TEXT,
ADD COLUMN IF NOT EXISTS ending_imagery_description TEXT;

-- Create index on new threat dimensions for performance
CREATE INDEX IF NOT EXISTS idx_story_dna_threat_behavior ON story_dna(threat_behavior_id);
CREATE INDEX IF NOT EXISTS idx_story_dna_threat_manifestation ON story_dna(threat_manifestation_id);
CREATE INDEX IF NOT EXISTS idx_story_dna_narrative_artifact ON story_dna(narrative_artifact_id);
CREATE INDEX IF NOT EXISTS idx_story_dna_ending_knowledge ON story_dna(ending_knowledge_id);weeaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
CREATE INDEX IF NOT EXISTS idx_story_dna_ending_imagery ON story_dna(ending_imagery_id);

-- Update the component frequency view to include new dimensions
DROP VIEW IF EXISTS story_dna_component_frequency;
CREATE VIEW story_dna_component_frequency AS
SELECT 
  'era' as component_type,
  era_id as component_id,
  COUNT(*) as usage_count,
  MAX(created_at) as last_used
FROM story_dna
GROUP BY era_id
UNION ALL
SELECT 
  'location' as component_type,
  location_id as component_id,
  COUNT(*) as usage_count,
  MAX(created_at) as last_used
FROM story_dna
GROUP BY location_id
UNION ALL
SELECT 
  'subgenre' as component_type,
  subgenre_id as component_id,
  COUNT(*) as usage_count,
  MAX(created_at) as last_used
FROM story_dna
GROUP BY subgenre_id
UNION ALL
SELECT 
  'authority' as component_type,
  authority_id as component_id,
  COUNT(*) as usage_count,
  MAX(created_at) as last_used
FROM story_dna
GROUP BY authority_id
UNION ALL
SELECT 
  'narrative_artifact' as component_type,
  narrative_artifact_id as component_id,
  COUNT(*) as usage_count,
  MAX(created_at) as last_used
FROM story_dna
WHERE narrative_artifact_id IS NOT NULL
GROUP BY narrative_artifact_id
UNION ALL
SELECT 
  'threat_behavior' as component_type,
  threat_behavior_id as component_id,
  COUNT(*) as usage_count,
  MAX(created_at) as last_used
FROM story_dna
WHERE threat_behavior_id IS NOT NULL
GROUP BY threat_behavior_id
UNION ALL
SELECT 
  'threat_manifestation' as component_type,
  threat_manifestation_id as component_id,
  COUNT(*) as usage_count,
  MAX(created_at) as last_used
FROM story_dna
WHERE threat_manifestation_id IS NOT NULL
GROUP BY threat_manifestation_id
UNION ALL
SELECT 
  'repeating_detail' as component_type,
  repeating_detail_id as component_id,
  COUNT(*) as usage_count,
  MAX(created_at) as last_used
FROM story_dna
GROUP BY repeating_detail_id
UNION ALL
SELECT 
  'weird_axis' as component_type,
  weird_axis_id as component_id,
  COUNT(*) as usage_count,
  MAX(created_at) as last_used
FROM story_dna
GROUP BY weird_axis_id
UNION ALL
SELECT 
  'escalation' as component_type,
  escalation_id as component_id,
  COUNT(*) as usage_count,
  MAX(created_at) as last_used
FROM story_dna
GROUP BY escalation_id
UNION ALL
SELECT 
  'ending_knowledge' as component_type,
  ending_knowledge_id as component_id,
  COUNT(*) as usage_count,
  MAX(created_at) as last_used
FROM story_dna
WHERE ending_knowledge_id IS NOT NULL
GROUP BY ending_knowledge_id
UNION ALL
SELECT 
  'ending_imagery' as component_type,
  ending_imagery_id as component_id,
  COUNT(*) as usage_count,
  MAX(created_at) as last_used
FROM story_dna
WHERE ending_imagery_id IS NOT NULL
GROUP BY ending_imagery_id
UNION ALL
SELECT 
  'emotion' as component_type,
  emotion_id as component_id,
  COUNT(*) as usage_count,
  MAX(created_at) as last_used
FROM story_dna
GROUP BY emotion_id;

-- Drop and recreate function to get underused components (signature changed)
DROP FUNCTION IF EXISTS get_underused_components(TEXT, INT);
CREATE FUNCTION get_underused_components(
  p_component_type TEXT,
  p_threshold INT DEFAULT 5
)
RETURNS TABLE(component_id TEXT, usage_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    f.component_id,
    f.usage_count
  FROM story_dna_component_frequency f
  WHERE f.component_type = p_component_type
    AND f.usage_count < p_threshold
  ORDER BY f.usage_count ASC;
END;
$$;

-- Add comment about v2 schema
COMMENT ON TABLE story_dna IS 'Story DNA v2.0 - Split dimensions for enhanced uniqueness. ~49.8 billion possible combinations.';
