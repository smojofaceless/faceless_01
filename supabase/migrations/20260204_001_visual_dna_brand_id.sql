-- Migration: Add brand_id to visual_dna for per-brand similarity tracking
-- Date: 2026-02-04

-- Add brand_id column for per-brand fingerprint tracking
ALTER TABLE visual_dna ADD COLUMN IF NOT EXISTS brand_id TEXT;

-- Add index for efficient per-brand queries
CREATE INDEX IF NOT EXISTS idx_visual_dna_brand_id ON visual_dna(brand_id);

-- Add compound index for brand + platform queries (local similarity)
CREATE INDEX IF NOT EXISTS idx_visual_dna_brand_platform ON visual_dna(brand_id, platform);

-- Add index for created_at for time-windowed queries
CREATE INDEX IF NOT EXISTS idx_visual_dna_created_at ON visual_dna(created_at DESC);
