-- =====================================================
-- Migration: 20260209_brand_templates_weight.sql
-- Purpose: Add weight column for campaign weighted-random selection
-- 
-- Part of: Option 1 - DB-Driven Templates
-- =====================================================

-- Add weight column (selection weight for campaigns)
ALTER TABLE brand_templates 
ADD COLUMN IF NOT EXISTS weight DECIMAL(3,2) DEFAULT 1.00;

-- Add constraint: weight must be positive
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'brand_templates_weight_positive'
    ) THEN
        ALTER TABLE brand_templates 
        ADD CONSTRAINT brand_templates_weight_positive CHECK (weight > 0);
    END IF;
END $$;

-- Add helpful comment
COMMENT ON COLUMN brand_templates.weight IS 'Selection weight for campaign weighted-random. 1.00 = baseline. Higher = more likely to be selected.';

-- Verify
-- SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'brand_templates' AND column_name = 'weight';
