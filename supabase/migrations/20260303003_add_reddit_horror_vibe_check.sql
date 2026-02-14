-- Add 'reddit_trending_horror' and 'one_too_many' to vibe_preset constraint
-- Extends the allowed presets for the jobs table

-- Drop the existing CHECK constraint on vibe_preset
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_vibe_preset_check;

-- Add new constraint including all active presets
ALTER TABLE jobs ADD CONSTRAINT jobs_vibe_preset_check 
    CHECK (vibe_preset IN (
        'slow_creepy',
        'punchy_shock',
        'atmospheric',
        'urban_legend',
        'analog_horror',
        'one_too_many',
        'reddit_trending_horror'
    ));
