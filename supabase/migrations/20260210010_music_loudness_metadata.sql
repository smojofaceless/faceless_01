-- =====================================================
-- Migration: 20260210010_music_loudness_metadata.sql
-- Purpose: Add loudness normalization metadata columns to music_tracks
--          (future-proof: allows per-track gain tuning without code changes)
-- Date: February 10, 2026
-- =====================================================

-- Add loudness metadata columns (nullable — populated later via analysis tool)
ALTER TABLE music_tracks
    ADD COLUMN IF NOT EXISTS loudness_lufs NUMERIC,     -- Integrated loudness in LUFS (e.g. -14.0)
    ADD COLUMN IF NOT EXISTS peak_db      NUMERIC;      -- True peak in dBFS (e.g. -1.0)

COMMENT ON COLUMN music_tracks.loudness_lufs IS 'Integrated loudness in LUFS (e.g. -14). NULL = not yet measured. Used for per-track gain normalization.';
COMMENT ON COLUMN music_tracks.peak_db IS 'True peak in dBFS (e.g. -1.0). NULL = not yet measured. Used to prevent clipping when applying gain.';

-- Update the get_brand_music_tracks RPC to also return loudness data + per-track volume
CREATE OR REPLACE FUNCTION get_brand_music_tracks(
    p_brand_id UUID,
    p_vibe_preset TEXT DEFAULT NULL
)
RETURNS TABLE (
    track_id TEXT,
    display_name TEXT,
    file_path TEXT,
    duration_seconds INT,
    loopable BOOLEAN,
    mood TEXT,
    energy TEXT,
    vibe_presets TEXT[],
    loudness_lufs NUMERIC,
    peak_db NUMERIC,
    volume NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mt.id,
        mt.display_name,
        mt.file_path,
        mt.duration_seconds,
        mt.loopable,
        mt.mood,
        mt.energy,
        mt.vibe_presets,
        mt.loudness_lufs,
        mt.peak_db,
        mt.volume
    FROM music_tracks mt
    WHERE mt.brand_id = p_brand_id
      AND mt.is_active = true
      AND (
          p_vibe_preset IS NULL 
          OR p_vibe_preset = ANY(mt.vibe_presets)
          OR array_length(mt.vibe_presets, 1) IS NULL
          OR mt.vibe_presets = '{}'
      )
    ORDER BY mt.id ASC;
END;
$$;

COMMENT ON FUNCTION get_brand_music_tracks IS 'Get active music tracks for a brand with loudness metadata and per-track volume, optionally filtered by vibe preset.';
