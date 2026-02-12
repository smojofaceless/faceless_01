-- Add brand_id and genre columns to story_dna 
-- These are needed by worker-v1 uniqueness step to:
-- 1. Track which brand generated each story DNA
-- 2. Store the vibe_preset (genre) for per-genre uniqueness checking

-- Add brand_id column (nullable UUID, no FK since brand may be deleted)
ALTER TABLE story_dna ADD COLUMN IF NOT EXISTS brand_id UUID;

-- Add genre column (nullable text for vibe_preset value)
ALTER TABLE story_dna ADD COLUMN IF NOT EXISTS genre TEXT DEFAULT 'unknown';

-- Index for per-brand uniqueness queries
CREATE INDEX IF NOT EXISTS idx_story_dna_brand_id ON story_dna(brand_id);
