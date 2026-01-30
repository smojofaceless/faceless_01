-- =====================================================
-- Migration: Add urban_legend vibe preset
-- Date: 2026-01-30
-- =====================================================

-- Drop the existing CHECK constraint on vibe_preset
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_vibe_preset_check;

-- Add new CHECK constraint that includes urban_legend
ALTER TABLE jobs ADD CONSTRAINT jobs_vibe_preset_check 
    CHECK (vibe_preset IN ('slow_creepy', 'punchy_shock', 'atmospheric', 'urban_legend'));
