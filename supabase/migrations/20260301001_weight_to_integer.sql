-- Migration: 20260301001_weight_to_integer.sql
-- Purpose: Change weight column from DECIMAL(3,2) to INTEGER
--          DECIMAL(3,2) maxes at 9.99 and caused rounding issues when
--          the UI stored slider values ÷ 100. Switch to plain integers
--          (1–100) so slider values map directly to DB weights.

-- Drop the old constraint
ALTER TABLE brand_templates DROP CONSTRAINT IF EXISTS brand_templates_weight_positive;

-- Convert existing decimal weights → integer (× 100) and change type
-- e.g. 0.60 → 60, 0.40 → 40, 0.01 → 1, 0.99 → 99, 1.00 → 100
ALTER TABLE brand_templates 
ALTER COLUMN weight TYPE INTEGER USING GREATEST(ROUND(weight * 100)::INTEGER, 1);

-- Set sensible default
ALTER TABLE brand_templates ALTER COLUMN weight SET DEFAULT 50;

-- Re-add constraint: weight must be positive
ALTER TABLE brand_templates 
ADD CONSTRAINT brand_templates_weight_positive CHECK (weight > 0);

COMMENT ON COLUMN brand_templates.weight IS 'Selection weight for campaign weighted-random. Integer 1-100 (slider maps directly). Higher = more likely to be selected.';
