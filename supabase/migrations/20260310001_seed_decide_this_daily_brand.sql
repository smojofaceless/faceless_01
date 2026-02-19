-- =====================================================
-- Migration: 20260310001_seed_decide_this_daily_brand.sql
-- Purpose: Create DecideThisDaily brand + 3 preset templates
--
-- Brand: DecideThisDaily
-- Niche: decision/engagement content
-- Presets: no_good_choice, one_rule_one_power, two_doors
--
-- NOTE: Uses WHERE NOT EXISTS to prevent duplicates on re-run
-- =====================================================

-- =====================================================
-- STEP 1: Create the brand
-- =====================================================
INSERT INTO brands (name, slug, niche, description, theme, settings, is_active)
SELECT
    'DecideThisDaily',
    'decide-this-daily',
    'decision',
    'Decision-first content: lose-lose dilemmas, power-with-a-catch, and binary choices designed to stop scrollers and ignite comment wars.',
    jsonb_build_object(
        'primaryColor', '#F59E0B',
        'secondaryColor', '#1F2937',
        'accentColor', '#EF4444',
        'fontFamily', 'Inter'
    ),
    jsonb_build_object(
        'engagement_focus', 'replies',
        'pov', 'second_person',
        'tone', 'provocative_neutral',
        'cost_tier', 1
    ),
    false  -- not active yet; activate when ready
WHERE NOT EXISTS (
    SELECT 1 FROM brands WHERE slug = 'decide-this-daily'
);

-- =====================================================
-- STEP 2: Seed brand_templates
-- All start weight=0 (inactive). Activate via campaign UI.
-- =====================================================

-- no_good_choice: Lose-lose binary dilemmas with gameplay footage
INSERT INTO brand_templates (brand_id, name, template_type, config_overrides, is_default, weight)
SELECT
    b.id,
    'No Good Choice',
    'no_good_choice',
    jsonb_build_object(
        'visual_type', 'gameplay',
        'art_style', 'none',
        'voice_id', 'echo',
        'voice_fallback', 'onyx',
        'word_target', 120,
        'word_min', 100,
        'word_max', 140,
        'tts_tone', 'steady_provocative',
        'engagement_intent', 'argument'
    ),
    true,  -- default preset for this brand
    1      -- minimal weight; user adjusts
FROM brands b
WHERE b.slug = 'decide-this-daily'
  AND NOT EXISTS (
    SELECT 1 FROM brand_templates bt
    WHERE bt.brand_id = b.id AND bt.template_type = 'no_good_choice'
  );

-- one_rule_one_power: Power + restriction thought experiments with moody AI images
INSERT INTO brand_templates (brand_id, name, template_type, config_overrides, is_default, weight)
SELECT
    b.id,
    'One Rule One Power',
    'one_rule_one_power',
    jsonb_build_object(
        'visual_type', 'ai_images_moody',
        'art_style', 'surreal-contemplative',
        'voice_id', 'echo',
        'voice_fallback', 'onyx',
        'word_target', 100,
        'word_min', 85,
        'word_max', 115,
        'tts_tone', 'measured_curious',
        'engagement_intent', 'debate'
    ),
    false,
    1
FROM brands b
WHERE b.slug = 'decide-this-daily'
  AND NOT EXISTS (
    SELECT 1 FROM brand_templates bt
    WHERE bt.brand_id = b.id AND bt.template_type = 'one_rule_one_power'
  );

-- two_doors: Symbolic binary choices with high-contrast AI images
INSERT INTO brand_templates (brand_id, name, template_type, config_overrides, is_default, weight)
SELECT
    b.id,
    'Two Doors',
    'two_doors',
    jsonb_build_object(
        'visual_type', 'ai_images_contrast',
        'art_style', 'cinematic-contrast',
        'voice_id', 'echo',
        'voice_fallback', 'onyx',
        'word_target', 110,
        'word_min', 95,
        'word_max', 125,
        'tts_tone', 'dramatic_neutral',
        'engagement_intent', 'side_picking'
    ),
    false,
    1
FROM brands b
WHERE b.slug = 'decide-this-daily'
  AND NOT EXISTS (
    SELECT 1 FROM brand_templates bt
    WHERE bt.brand_id = b.id AND bt.template_type = 'two_doors'
  );

-- =====================================================
-- VERIFICATION (run after migration)
-- =====================================================
-- SELECT b.name, b.slug, b.niche, bt.template_type, bt.weight, bt.is_default, bt.config_overrides
-- FROM brands b
-- LEFT JOIN brand_templates bt ON bt.brand_id = b.id
-- WHERE b.slug = 'decide-this-daily'
-- ORDER BY bt.template_type;
