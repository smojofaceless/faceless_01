-- =====================================================
-- RUN THIS IN SUPABASE DASHBOARD → SQL Editor
-- Combines: music_tracks table + loudness columns + storage policies
-- Date: February 10, 2026
-- =====================================================

-- =====================================================
-- 1. CREATE music_tracks TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS music_tracks (
    id TEXT NOT NULL,
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    duration_seconds INT NOT NULL DEFAULT 0,
    loopable BOOLEAN NOT NULL DEFAULT true,
    bpm INT,
    mood TEXT NOT NULL DEFAULT 'dark',
    energy TEXT NOT NULL DEFAULT 'low',
    tags TEXT[] DEFAULT '{}',
    vibe_presets TEXT[] DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    loudness_lufs NUMERIC,
    peak_db NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, brand_id)
);

CREATE INDEX IF NOT EXISTS idx_music_tracks_brand_id ON music_tracks(brand_id);
CREATE INDEX IF NOT EXISTS idx_music_tracks_brand_active ON music_tracks(brand_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_music_tracks_mood ON music_tracks(mood);

-- =====================================================
-- 2. RLS POLICIES FOR music_tracks
-- =====================================================

ALTER TABLE music_tracks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    -- service_role full access
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='music_tracks' AND policyname='service_role_music_tracks_all') THEN
        CREATE POLICY "service_role_music_tracks_all" ON music_tracks FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;

    -- anon full access (matches your existing open-access pattern for brands)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='music_tracks' AND policyname='anon_music_tracks_all') THEN
        CREATE POLICY "anon_music_tracks_all" ON music_tracks FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- =====================================================
-- 3. STORAGE POLICIES for brands/*/music/* path
--    The existing policy only covers top-level /music/ folder.
--    We need policies for brands/{brand_id}/music/*.mp3
-- =====================================================

-- Read
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='Read brand music files') THEN
        CREATE POLICY "Read brand music files" ON storage.objects
            FOR SELECT USING (bucket_id = 'story-videos' AND name LIKE 'brands/%/music/%');
    END IF;
END $$;

-- Insert (upload)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='Upload brand music files') THEN
        CREATE POLICY "Upload brand music files" ON storage.objects
            FOR INSERT WITH CHECK (bucket_id = 'story-videos' AND name LIKE 'brands/%/music/%');
    END IF;
END $$;

-- Update (overwrite)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='Update brand music files') THEN
        CREATE POLICY "Update brand music files" ON storage.objects
            FOR UPDATE USING (bucket_id = 'story-videos' AND name LIKE 'brands/%/music/%');
    END IF;
END $$;

-- Delete
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='Delete brand music files') THEN
        CREATE POLICY "Delete brand music files" ON storage.objects
            FOR DELETE USING (bucket_id = 'story-videos' AND name LIKE 'brands/%/music/%');
    END IF;
END $$;

-- =====================================================
-- 4. RPCs
-- =====================================================

CREATE OR REPLACE FUNCTION get_brand_music_config(p_brand_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_config JSONB;
    v_defaults JSONB;
BEGIN
    v_defaults := jsonb_build_object(
        'enabled', true,
        'default_volume', 0.18,
        'ducking', jsonb_build_object('enabled', true, 'duck_volume', 0.08, 'attack_ms', 150, 'release_ms', 250),
        'fade', jsonb_build_object('in_ms', 800, 'out_ms', 1200)
    );
    SELECT bt.config_overrides->'music' INTO v_config
    FROM brand_templates bt WHERE bt.brand_id = p_brand_id AND bt.config_overrides ? 'music' AND bt.is_default = true LIMIT 1;
    IF v_config IS NULL THEN
        SELECT bt.config_overrides->'music' INTO v_config
        FROM brand_templates bt WHERE bt.brand_id = p_brand_id AND bt.config_overrides ? 'music' ORDER BY bt.created_at DESC LIMIT 1;
    END IF;
    IF v_config IS NULL THEN RETURN v_defaults; END IF;
    RETURN v_defaults || v_config;
END; $$;

CREATE OR REPLACE FUNCTION get_brand_music_tracks(
    p_brand_id UUID, p_vibe_preset TEXT DEFAULT NULL
) RETURNS TABLE (
    track_id TEXT, display_name TEXT, file_path TEXT, duration_seconds INT,
    loopable BOOLEAN, mood TEXT, energy TEXT, vibe_presets TEXT[],
    loudness_lufs NUMERIC, peak_db NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT mt.id, mt.display_name, mt.file_path, mt.duration_seconds,
           mt.loopable, mt.mood, mt.energy, mt.vibe_presets, mt.loudness_lufs, mt.peak_db
    FROM music_tracks mt
    WHERE mt.brand_id = p_brand_id AND mt.is_active = true
      AND (p_vibe_preset IS NULL OR p_vibe_preset = ANY(mt.vibe_presets)
           OR array_length(mt.vibe_presets,1) IS NULL OR mt.vibe_presets = '{}')
    ORDER BY mt.id ASC;
END; $$;

-- =====================================================
-- 5. DONE — Verify:
-- =====================================================
SELECT 'music_tracks table created' AS status, count(*) AS rows FROM music_tracks;
