-- Migration: Add one_too_many preset
-- Date: 2026-02-08
-- Description: Adds the 'one_too_many' counting horror preset to vibe_preset options

-- Drop the old constraint and add new one with all presets
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_vibe_preset_check;

ALTER TABLE jobs ADD CONSTRAINT jobs_vibe_preset_check 
    CHECK (vibe_preset IN (
        'slow_creepy', 
        'punchy_shock', 
        'atmospheric', 
        'urban_legend', 
        'analog_horror',
        'cosmic_horror',
        'true_crime',
        'neutral',
        'one_too_many'
    ));

-- Add comment documenting the presets
COMMENT ON COLUMN jobs.vibe_preset IS 'Story preset: slow_creepy, punchy_shock, atmospheric, urban_legend, analog_horror, cosmic_horror, true_crime, neutral, one_too_many';
