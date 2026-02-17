-- =====================================================
-- Per-Track Volume Override
-- Adds a nullable volume column to music_tracks so each
-- track can override the brand-wide default_volume.
-- NULL = use brand default, 0.0–1.0 = explicit override.
-- =====================================================

-- 1. Add volume column
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS volume NUMERIC DEFAULT NULL;
COMMENT ON COLUMN music_tracks.volume IS 'Per-track volume override (0.0-1.0). NULL = use brand default_volume.';

-- 2. Drop existing function (return type changed, can't CREATE OR REPLACE)
DROP FUNCTION IF EXISTS get_brand_music_tracks(UUID, TEXT);

-- 3. Recreate get_brand_music_tracks RPC with volume column
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
