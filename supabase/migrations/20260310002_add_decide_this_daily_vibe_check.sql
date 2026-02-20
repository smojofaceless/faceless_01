-- =====================================================
-- Migration: Add DecideThisDaily presets to jobs_vibe_preset_check
-- Adds: no_good_choice, one_rule_one_power, two_doors
-- =====================================================

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_vibe_preset_check;

ALTER TABLE jobs ADD CONSTRAINT jobs_vibe_preset_check 
    CHECK (vibe_preset IN (
        'slow_creepy',
        'punchy_shock',
        'atmospheric',
        'urban_legend',
        'analog_horror',
        'one_too_many',
        'reddit_trending_horror',
        'dark_origins',
        'no_good_choice',
        'one_rule_one_power',
        'two_doors'
    ));
