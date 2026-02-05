-- Visual DNA table for storing derived visual parameters
-- This table stores the deterministic mapping from Story DNA → Visual DNA
-- Visual DNA is DERIVED, never randomly generated

CREATE TABLE IF NOT EXISTS visual_dna (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_dna_id UUID NOT NULL REFERENCES story_dna(id) ON DELETE CASCADE,
  
  -- The 8 visual dimensions
  visual_style TEXT NOT NULL,        -- VHS_degraded, cinematic_dark, etc.
  color_palette TEXT NOT NULL,       -- cold_desaturated, sickly_green, etc.
  camera_language TEXT NOT NULL,     -- fixed_static, slow_push, etc.
  motion_profile TEXT NOT NULL,      -- none, micro_jitter, slow_drift, etc.
  texture_artifacts TEXT[] NOT NULL DEFAULT '{}',  -- Array of artifacts
  lighting_profile TEXT NOT NULL,    -- moonlit_fog, fluorescent_flat, etc.
  subject_scale TEXT NOT NULL,       -- tiny, human, looming, etc.
  frame_composition TEXT NOT NULL,   -- centered_void, rule_of_thirds, etc.
  
  -- Platform tuning
  platform TEXT NOT NULL DEFAULT 'default',  -- reels, tiktok, shorts, default
  platform_adjustments JSONB NOT NULL DEFAULT '{}',
  
  -- Derivation tracking
  derived_from JSONB NOT NULL,  -- Summary of source Story DNA fields
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for finding Visual DNA by story
CREATE INDEX IF NOT EXISTS idx_visual_dna_story ON visual_dna(story_dna_id);

-- Index for drift analysis queries
CREATE INDEX IF NOT EXISTS idx_visual_dna_created ON visual_dna(created_at DESC);

-- Index for platform-specific queries
CREATE INDEX IF NOT EXISTS idx_visual_dna_platform ON visual_dna(platform);

-- Index for visual style distribution analysis
CREATE INDEX IF NOT EXISTS idx_visual_dna_style ON visual_dna(visual_style);

-- Comments for documentation
COMMENT ON TABLE visual_dna IS 'Derived visual parameters from Story DNA - deterministic mapping, not random';
COMMENT ON COLUMN visual_dna.visual_style IS 'Core aesthetic style (VHS_degraded, cinematic_dark, etc.)';
COMMENT ON COLUMN visual_dna.color_palette IS 'Color grading approach (cold_desaturated, sickly_green, etc.)';
COMMENT ON COLUMN visual_dna.camera_language IS 'Camera movement style (fixed_static, slow_push, etc.)';
COMMENT ON COLUMN visual_dna.motion_profile IS 'Motion characteristics (none, micro_jitter, etc.)';
COMMENT ON COLUMN visual_dna.texture_artifacts IS 'Array of texture effects (film_grain, scanlines, etc.)';
COMMENT ON COLUMN visual_dna.lighting_profile IS 'Lighting approach (moonlit_fog, fluorescent_flat, etc.)';
COMMENT ON COLUMN visual_dna.subject_scale IS 'How large subjects appear (tiny, human, looming, etc.)';
COMMENT ON COLUMN visual_dna.frame_composition IS 'Framing style (centered_void, rule_of_thirds, etc.)';
COMMENT ON COLUMN visual_dna.platform IS 'Target platform for adjustments';
COMMENT ON COLUMN visual_dna.derived_from IS 'JSON summary of Story DNA fields used for derivation';

-- RLS policies
ALTER TABLE visual_dna ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access to visual_dna"
  ON visual_dna
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to read
CREATE POLICY "Authenticated users can read visual_dna"
  ON visual_dna
  FOR SELECT
  TO authenticated
  USING (true);
