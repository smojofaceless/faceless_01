-- =====================================================
-- Migration: 20260209_seed_brand_templates.sql
-- Purpose: Seed default templates for existing brands
-- 
-- Part of: Option 1 - DB-Driven Templates
-- 
-- ACTIVE PRESETS (as of Feb 2026):
--   - urban_legend (60% weight, default)
--   - one_too_many (40% weight)
-- 
-- NOTE: Uses WHERE NOT EXISTS to prevent duplicates on re-run
-- =====================================================

-- =====================================================
-- BRAND-SPECIFIC SEEDING
-- Only seed presets for brands that match the niche!
-- =====================================================

-- Seed urban_legend template for HORROR brands only
INSERT INTO brand_templates (brand_id, name, template_type, config_overrides, is_default, weight)
SELECT 
    b.id as brand_id,
    'Urban Legend' as name,
    'urban_legend' as template_type,
    '{}'::jsonb as config_overrides,
    true as is_default,   -- urban_legend is default for horror
    0.60 as weight        -- 60% selection weight
FROM brands b
WHERE b.name ILIKE '%horror%'  -- Only horror brands
  AND NOT EXISTS (
    SELECT 1 FROM brand_templates bt 
    WHERE bt.brand_id = b.id AND bt.template_type = 'urban_legend'
);

-- Seed one_too_many template for HORROR brands only
INSERT INTO brand_templates (brand_id, name, template_type, config_overrides, is_default, weight)
SELECT 
    b.id as brand_id,
    'One Too Many' as name,
    'one_too_many' as template_type,
    '{}'::jsonb as config_overrides,
    false as is_default,  -- not default
    0.40 as weight        -- 40% selection weight
FROM brands b
WHERE b.name ILIKE '%horror%'  -- Only horror brands
  AND NOT EXISTS (
    SELECT 1 FROM brand_templates bt 
    WHERE bt.brand_id = b.id AND bt.template_type = 'one_too_many'
);

-- Verification query (run after migration)
-- SELECT b.name as brand_name, bt.template_type, bt.weight, bt.is_default 
-- FROM brand_templates bt 
-- JOIN brands b ON bt.brand_id = b.id 
-- ORDER BY b.name, bt.template_type;
