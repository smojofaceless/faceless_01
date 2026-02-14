-- =====================================================
-- Migration: 20260303001_add_reddit_trending_horror_preset.sql
-- Purpose: Add reddit_trending_horror preset to existing horror brands
--
-- This seeds the new "Reddit Trending Horror" story engine
-- for all horror brands. Initial weight = 0 (inactive).
-- Users activate it by adjusting weights in the campaign page.
--
-- NOTE: Uses WHERE NOT EXISTS to prevent duplicates on re-run
-- =====================================================

-- Seed reddit_trending_horror template for HORROR brands only
INSERT INTO brand_templates (brand_id, name, template_type, config_overrides, is_default, weight)
SELECT 
    b.id as brand_id,
    'Reddit Trending Horror' as name,
    'reddit_trending_horror' as template_type,
    jsonb_build_object(
        'source', 'reddit',
        'subreddits', jsonb_build_array('nosleep', 'shortscarystories', 'creepypasta', 'letsnotmeet', 'paranormal', 'glitch_in_the_matrix'),
        'art_style', 'uncanny-illustrated-horror',
        'voice_id', 'ash',
        'voice_fallback', 'onyx',
        'word_target', 155,
        'word_min', 130,
        'word_max', 180,
        'tts_tone', 'calm_uneasy'
    ) as config_overrides,
    false as is_default,   -- Not default; opt-in activation
    1 as weight            -- 1% minimal weight (constraint requires > 0); user adjusts in campaign UI
FROM brands b
WHERE b.name ILIKE '%horror%'  -- Only horror brands
  AND NOT EXISTS (
    SELECT 1 FROM brand_templates bt 
    WHERE bt.brand_id = b.id AND bt.template_type = 'reddit_trending_horror'
);

-- Verification query (run after migration)
-- SELECT b.name as brand_name, bt.template_type, bt.weight, bt.is_default, bt.config_overrides
-- FROM brand_templates bt 
-- JOIN brands b ON bt.brand_id = b.id 
-- WHERE bt.template_type = 'reddit_trending_horror'
-- ORDER BY b.name;
