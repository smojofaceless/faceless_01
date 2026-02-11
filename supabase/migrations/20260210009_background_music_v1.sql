-- =====================================================
-- Migration: 20260210009_background_music_v1.sql
-- Purpose: Background Music V1 — track catalog, brand music preferences, RPCs
-- Roadmap: Item #10
-- Date: February 10, 2026
-- =====================================================

-- =====================================================
-- 1. MUSIC TRACKS TABLE
-- Catalog of pre-licensed static tracks per brand
-- Tracks are stored in Supabase Storage at:
--   brands/{brand_id}/music/{track_id}.mp3
-- =====================================================

CREATE TABLE IF NOT EXISTS music_tracks (
    id TEXT NOT NULL,                          -- Human-readable ID e.g. "ambient_dark_01"
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    
    -- Track metadata
    display_name TEXT NOT NULL,                -- Friendly name for UI
    file_path TEXT NOT NULL,                   -- Storage path: brands/{brand_id}/music/{id}.mp3
    duration_seconds INT NOT NULL DEFAULT 0,   -- Track duration (0 = unknown, will be measured)
    loopable BOOLEAN NOT NULL DEFAULT true,    -- Can be seamlessly looped
    bpm INT,                                   -- Beats per minute (optional, for future sync)
    
    -- Classification
    mood TEXT NOT NULL DEFAULT 'dark',         -- dark, tense, eerie, ambient, dramatic, melancholic
    energy TEXT NOT NULL DEFAULT 'low',        -- low, medium, high
    tags TEXT[] DEFAULT '{}',                  -- Additional tags: ["synth", "drone", "piano"]
    
    -- Vibe preset associations (which presets this track works with)
    vibe_presets TEXT[] DEFAULT '{}',          -- ["urban_legend", "one_too_many"]
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,   -- Soft-delete / disable
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Primary key is composite: same track_id can exist for different brands
    PRIMARY KEY (id, brand_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_music_tracks_brand_id 
    ON music_tracks(brand_id);
CREATE INDEX IF NOT EXISTS idx_music_tracks_brand_active 
    ON music_tracks(brand_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_music_tracks_mood 
    ON music_tracks(mood);

-- Comments
COMMENT ON TABLE music_tracks IS 'Pre-licensed music track catalog. Tracks stored in Storage at brands/{brand_id}/music/{id}.mp3';
COMMENT ON COLUMN music_tracks.id IS 'Human-readable track identifier, e.g. ambient_dark_01';
COMMENT ON COLUMN music_tracks.file_path IS 'Supabase Storage path relative to story-videos bucket';
COMMENT ON COLUMN music_tracks.loopable IS 'Whether track can be seamlessly looped for longer videos';
COMMENT ON COLUMN music_tracks.vibe_presets IS 'Which vibe presets this track is suitable for';

-- =====================================================
-- 2. RLS POLICIES FOR music_tracks
-- =====================================================

ALTER TABLE music_tracks ENABLE ROW LEVEL SECURITY;

-- service_role bypass (for worker-v1 / edge functions)
CREATE POLICY "service_role_music_tracks_all"
    ON music_tracks FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Brand owners can read their tracks
CREATE POLICY "brand_owner_music_tracks_select"
    ON music_tracks FOR SELECT
    TO authenticated
    USING (
        brand_id IN (
            SELECT id FROM brands WHERE user_id = auth.uid()
        )
    );

-- Brand owners can insert tracks
CREATE POLICY "brand_owner_music_tracks_insert"
    ON music_tracks FOR INSERT
    TO authenticated
    WITH CHECK (
        brand_id IN (
            SELECT id FROM brands WHERE user_id = auth.uid()
        )
    );

-- Brand owners can update their tracks
CREATE POLICY "brand_owner_music_tracks_update"
    ON music_tracks FOR UPDATE
    TO authenticated
    USING (
        brand_id IN (
            SELECT id FROM brands WHERE user_id = auth.uid()
        )
    );

-- =====================================================
-- 3. RPC: get_brand_music_config
-- Returns the music configuration for a brand.
-- Pulls from brand_templates.config_overrides.music
-- Falls back to system defaults if not configured.
-- =====================================================

CREATE OR REPLACE FUNCTION get_brand_music_config(p_brand_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_config JSONB;
    v_defaults JSONB;
BEGIN
    -- System defaults
    v_defaults := jsonb_build_object(
        'enabled', true,
        'default_volume', 0.18,
        'ducking', jsonb_build_object(
            'enabled', true,
            'duck_volume', 0.08,
            'attack_ms', 150,
            'release_ms', 250
        ),
        'fade', jsonb_build_object(
            'in_ms', 800,
            'out_ms', 1200
        )
    );

    -- Try to get brand-specific config from brand_templates
    -- Look for any template that has music config in config_overrides
    SELECT bt.config_overrides->'music'
    INTO v_config
    FROM brand_templates bt
    WHERE bt.brand_id = p_brand_id
      AND bt.config_overrides ? 'music'
      AND bt.is_default = true
    LIMIT 1;

    -- If no default template has music, try any template
    IF v_config IS NULL THEN
        SELECT bt.config_overrides->'music'
        INTO v_config
        FROM brand_templates bt
        WHERE bt.brand_id = p_brand_id
          AND bt.config_overrides ? 'music'
        ORDER BY bt.created_at DESC
        LIMIT 1;
    END IF;

    -- If still no config, return defaults
    IF v_config IS NULL THEN
        RETURN v_defaults;
    END IF;

    -- Merge: brand config overrides defaults (brand wins)
    RETURN v_defaults || v_config;
END;
$$;

COMMENT ON FUNCTION get_brand_music_config IS 'Get music config for a brand. Merges brand_templates overrides with system defaults.';

-- =====================================================
-- 4. RPC: get_brand_music_tracks
-- Returns active tracks for a brand, optionally filtered by vibe_preset.
-- Ordered deterministically (by id) for consistent hash-based selection.
-- =====================================================

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
    vibe_presets TEXT[]
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
        mt.vibe_presets
    FROM music_tracks mt
    WHERE mt.brand_id = p_brand_id
      AND mt.is_active = true
      AND (
          p_vibe_preset IS NULL 
          OR p_vibe_preset = ANY(mt.vibe_presets)
          OR array_length(mt.vibe_presets, 1) IS NULL  -- tracks with no vibe filter match all
          OR mt.vibe_presets = '{}'                     -- empty array = universal
      )
    ORDER BY mt.id ASC;  -- Deterministic order for hash-based selection
END;
$$;

COMMENT ON FUNCTION get_brand_music_tracks IS 'Get active music tracks for a brand, optionally filtered by vibe preset. Ordered by id for deterministic selection.';

-- =====================================================
-- 5. RPC: select_music_track_deterministic
-- Deterministic track selection: hash(job_id || brand_id) % track_count
-- Returns the selected track or NULL if no tracks available.
-- =====================================================

CREATE OR REPLACE FUNCTION select_music_track_deterministic(
    p_job_id UUID,
    p_brand_id UUID,
    p_vibe_preset TEXT DEFAULT NULL
)
RETURNS TABLE (
    track_id TEXT,
    display_name TEXT,
    file_path TEXT,
    storage_url TEXT,
    duration_seconds INT,
    loopable BOOLEAN,
    mood TEXT,
    track_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tracks RECORD[];
    v_count INT;
    v_hash_input TEXT;
    v_hash_val BIGINT;
    v_index INT;
    v_selected RECORD;
BEGIN
    -- Get all eligible tracks as array
    SELECT array_agg(t ORDER BY t.id)
    INTO v_tracks
    FROM (
        SELECT mt.id, mt.display_name, mt.file_path, mt.duration_seconds, mt.loopable, mt.mood
        FROM music_tracks mt
        WHERE mt.brand_id = p_brand_id
          AND mt.is_active = true
          AND (
              p_vibe_preset IS NULL 
              OR p_vibe_preset = ANY(mt.vibe_presets)
              OR array_length(mt.vibe_presets, 1) IS NULL
              OR mt.vibe_presets = '{}'
          )
    ) t;

    v_count := COALESCE(array_length(v_tracks, 1), 0);
    
    -- Return empty if no tracks
    IF v_count = 0 THEN
        track_count := 0;
        RETURN;
    END IF;

    -- Deterministic hash: MD5 of (job_id || brand_id), take first 8 hex chars as bigint
    v_hash_input := p_job_id::text || '::' || p_brand_id::text;
    v_hash_val := ('x' || left(md5(v_hash_input), 8))::bit(32)::bigint;
    v_index := (abs(v_hash_val) % v_count) + 1;  -- 1-based array index

    v_selected := v_tracks[v_index];

    track_id := v_selected.id;
    display_name := v_selected.display_name;
    file_path := v_selected.file_path;
    duration_seconds := v_selected.duration_seconds;
    loopable := v_selected.loopable;
    mood := v_selected.mood;
    track_count := v_count;
    
    -- Build public storage URL
    -- The worker will use Supabase Storage client to get the signed/public URL
    storage_url := v_selected.file_path;
    
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION select_music_track_deterministic IS 'Deterministically select a music track using hash(job_id+brand_id) mod track_count. Same inputs always yield same output.';

-- =====================================================
-- 6. SEED DEFAULT TRACKS
-- Pre-populate with starter tracks for the horror brand.
-- Actual MP3 files must be uploaded to Storage separately.
-- =====================================================

-- Note: These are placeholder records. Actual audio files must be 
-- uploaded to the storage bucket at the paths specified in file_path.
-- The tracks are generic ambient/dark tracks suitable for horror content.

-- We insert for ALL existing brands as seed data
INSERT INTO music_tracks (id, brand_id, display_name, file_path, duration_seconds, loopable, mood, energy, vibe_presets, tags)
SELECT 
    track.id,
    b.id,
    track.display_name,
    'brands/' || b.id || '/music/' || track.id || '.mp3',
    track.duration_seconds,
    track.loopable,
    track.mood,
    track.energy,
    track.vibe_presets,
    track.tags
FROM brands b
CROSS JOIN (
    VALUES 
        ('ambient_dark_01', 'Dark Ambient Drone', 120, true, 'dark', 'low', 
         ARRAY['urban_legend', 'nosleep', 'backrooms']::TEXT[], 
         ARRAY['drone', 'synth', 'ambient']::TEXT[]),
        ('tension_pulse_01', 'Tension Pulse', 90, true, 'tense', 'medium', 
         ARRAY['one_too_many', 'glitch']::TEXT[], 
         ARRAY['pulse', 'bass', 'tension']::TEXT[]),
        ('eerie_piano_01', 'Eerie Piano Melody', 60, true, 'eerie', 'low', 
         ARRAY['urban_legend', 'nosleep', 'one_too_many']::TEXT[], 
         ARRAY['piano', 'melody', 'eerie']::TEXT[])
) AS track(id, display_name, duration_seconds, loopable, mood, energy, vibe_presets, tags)
ON CONFLICT (id, brand_id) DO NOTHING;

-- =====================================================
-- 7. STORAGE POLICY
-- Allow read access to music files in story-videos bucket
-- (Music files are at brands/{brand_id}/music/*.mp3)
-- The existing bucket policies should already cover this since
-- all brand assets are under brands/{brand_id}/...
-- No additional policy needed (service_role writes, public reads)
-- =====================================================

-- Verify: If needed, uncomment:
-- CREATE POLICY "public_music_read" ON storage.objects 
--     FOR SELECT USING (bucket_id = 'story-videos' AND name LIKE 'brands/%/music/%');
