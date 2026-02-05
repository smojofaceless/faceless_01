-- Add 'analog_horror' to vibe_preset constraint
-- This is a new vibe preset for VHS/found-footage style horror

-- Drop the existing CHECK constraint on vibe_preset
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_vibe_preset_check;

-- Add new constraint including analog_horror
ALTER TABLE jobs ADD CONSTRAINT jobs_vibe_preset_check 
    CHECK (vibe_preset IN ('slow_creepy', 'punchy_shock', 'atmospheric', 'urban_legend', 'analog_horror'));
