-- =====================================================
-- Migration: 20260310004_gameplay_clips_v1.sql
-- Purpose: Gameplay Clips V1 — background video catalog for non-image presets
-- Date: February 19, 2026
--
-- Mirrors the background_music_v1 pattern:
--   - gameplay_clips table (catalog per brand)
--   - Deterministic clip selection RPC
--   - Random offset calculation for variety
--   - Storage at: brands/{brand_id}/gameplay/{clip_id}.mp4
--
-- Used by presets with visual_type = "gameplay" (e.g. no_good_choice)
-- instead of AI-generated images.
-- =====================================================

-- =====================================================
-- 1. GAMEPLAY CLIPS TABLE
-- Catalog of pre-recorded gameplay/background videos per brand
-- Clips are stored in Supabase Storage at:
--   brands/{brand_id}/gameplay/{clip_id}.mp4
-- =====================================================

CREATE TABLE IF NOT EXISTS gameplay_clips (
    id TEXT NOT NULL,                          -- Human-readable ID e.g. "minecraft_parkour_01"
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    
    -- Clip metadata
    display_name TEXT NOT NULL,                -- Friendly name for UI
    file_path TEXT NOT NULL,                   -- Storage path: brands/{brand_id}/gameplay/{id}.mp4
    duration_seconds INT NOT NULL DEFAULT 0,   -- Total clip duration in seconds (critical for offset calc)
    
    -- Classification
    game TEXT NOT NULL DEFAULT 'generic',      -- Game/category: "minecraft", "subway_surfers", "satisfying", "generic"
    mood TEXT NOT NULL DEFAULT 'neutral',      -- neutral, tense, calm, energetic, satisfying
    energy TEXT NOT NULL DEFAULT 'medium',     -- low, medium, high
    tags TEXT[] DEFAULT '{}',                  -- Additional tags: ["parkour", "fps", "puzzle"]
    
    -- Vibe preset associations (which presets this clip works with)
    vibe_presets TEXT[] DEFAULT '{}',          -- ["no_good_choice", "two_doors"]
    
    -- Technical
    resolution TEXT DEFAULT '720p',           -- 720p, 1080p
    orientation TEXT DEFAULT 'portrait',      -- portrait (9:16), landscape (16:9) — portrait preferred
    fps INT DEFAULT 30,                       -- Frames per second
    file_size_mb NUMERIC(8,2) DEFAULT 0,      -- File size for storage tracking
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,   -- Soft-delete / disable
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Primary key: same clip_id can exist for different brands
    PRIMARY KEY (id, brand_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_gameplay_clips_brand_id 
    ON gameplay_clips(brand_id);
CREATE INDEX IF NOT EXISTS idx_gameplay_clips_brand_active 
    ON gameplay_clips(brand_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_gameplay_clips_game 
    ON gameplay_clips(game);

-- Comments
COMMENT ON TABLE gameplay_clips IS 'Background gameplay/video clip catalog. Clips stored in Storage at brands/{brand_id}/gameplay/{id}.mp4. Used for presets with visual_type=gameplay instead of AI images.';
COMMENT ON COLUMN gameplay_clips.id IS 'Human-readable clip identifier, e.g. minecraft_parkour_01';
COMMENT ON COLUMN gameplay_clips.file_path IS 'Supabase Storage path relative to story-videos bucket';
COMMENT ON COLUMN gameplay_clips.duration_seconds IS 'Total clip duration — must be accurate for random offset calculation';
COMMENT ON COLUMN gameplay_clips.vibe_presets IS 'Which vibe presets this clip is suitable for';

-- =====================================================
-- 2. RLS POLICIES FOR gameplay_clips
-- =====================================================

ALTER TABLE gameplay_clips ENABLE ROW LEVEL SECURITY;

-- service_role bypass (for worker-v1 / edge functions)
CREATE POLICY "service_role_gameplay_clips_all"
    ON gameplay_clips FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Brand owners can read their clips
CREATE POLICY "brand_owner_gameplay_clips_select"
    ON gameplay_clips FOR SELECT
    TO authenticated
    USING (
        brand_id IN (
            SELECT id FROM brands WHERE user_id = auth.uid()
        )
    );

-- Brand owners can insert clips
CREATE POLICY "brand_owner_gameplay_clips_insert"
    ON gameplay_clips FOR INSERT
    TO authenticated
    WITH CHECK (
        brand_id IN (
            SELECT id FROM brands WHERE user_id = auth.uid()
        )
    );

-- Brand owners can update their clips
CREATE POLICY "brand_owner_gameplay_clips_update"
    ON gameplay_clips FOR UPDATE
    TO authenticated
    USING (
        brand_id IN (
            SELECT id FROM brands WHERE user_id = auth.uid()
        )
    );

-- Brand owners can delete their clips
CREATE POLICY "brand_owner_gameplay_clips_delete"
    ON gameplay_clips FOR DELETE
    TO authenticated
    USING (
        brand_id IN (
            SELECT id FROM brands WHERE user_id = auth.uid()
        )
    );

-- =====================================================
-- 3. RPC: get_brand_gameplay_clips
-- Returns active clips for a brand, optionally filtered by vibe_preset.
-- =====================================================

CREATE OR REPLACE FUNCTION get_brand_gameplay_clips(
    p_brand_id UUID,
    p_vibe_preset TEXT DEFAULT NULL
)
RETURNS TABLE (
    clip_id TEXT,
    display_name TEXT,
    file_path TEXT,
    duration_seconds INT,
    game TEXT,
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
        gc.id,
        gc.display_name,
        gc.file_path,
        gc.duration_seconds,
        gc.game,
        gc.mood,
        gc.energy,
        gc.vibe_presets
    FROM gameplay_clips gc
    WHERE gc.brand_id = p_brand_id
      AND gc.is_active = true
      AND (
          p_vibe_preset IS NULL 
          OR p_vibe_preset = ANY(gc.vibe_presets)
          OR array_length(gc.vibe_presets, 1) IS NULL  -- clips with no vibe filter match all
          OR gc.vibe_presets = '{}'                     -- empty array = universal
      )
    ORDER BY gc.id ASC;
END;
$$;

COMMENT ON FUNCTION get_brand_gameplay_clips IS 'Get active gameplay clips for a brand, optionally filtered by vibe preset.';

-- =====================================================
-- 4. RPC: select_gameplay_clip_with_offset
-- Deterministic clip selection + random offset within the clip.
-- Uses hash(job_id || brand_id) to pick the clip,
-- and hash(job_id || clip_id) to pick the start offset.
-- Ensures offset + video_duration < clip_duration (safe trim).
-- =====================================================

CREATE OR REPLACE FUNCTION select_gameplay_clip_with_offset(
    p_job_id UUID,
    p_brand_id UUID,
    p_video_duration INT,        -- Target video duration in seconds
    p_vibe_preset TEXT DEFAULT NULL
)
RETURNS TABLE (
    clip_id TEXT,
    display_name TEXT,
    file_path TEXT,
    storage_url TEXT,
    duration_seconds INT,
    start_offset_seconds INT,
    game TEXT,
    clip_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INT;
    v_hash_input TEXT;
    v_hash_val BIGINT;
    v_index INT;
    v_sel_id TEXT;
    v_sel_name TEXT;
    v_sel_path TEXT;
    v_sel_duration INT;
    v_sel_game TEXT;
    v_safe_range INT;
    v_offset INT;
    v_offset_hash BIGINT;
BEGIN
    -- Count eligible clips
    SELECT COUNT(*)
    INTO v_count
    FROM gameplay_clips gc
    WHERE gc.brand_id = p_brand_id
      AND gc.is_active = true
      AND gc.duration_seconds > p_video_duration
      AND (
          p_vibe_preset IS NULL 
          OR p_vibe_preset = ANY(gc.vibe_presets)
          OR array_length(gc.vibe_presets, 1) IS NULL
          OR gc.vibe_presets = '{}'
      );

    -- Return empty if no clips
    IF v_count = 0 THEN
        clip_count := 0;
        RETURN;
    END IF;

    -- Deterministic clip selection: hash(job_id || brand_id) mod clip_count
    v_hash_input := p_job_id::text || '::' || p_brand_id::text;
    v_hash_val := ('x' || left(md5(v_hash_input), 8))::bit(32)::bigint;
    v_index := abs(v_hash_val) % v_count;  -- 0-based for OFFSET

    -- Select the specific clip using OFFSET
    SELECT gc.id, gc.display_name, gc.file_path, gc.duration_seconds, gc.game
    INTO v_sel_id, v_sel_name, v_sel_path, v_sel_duration, v_sel_game
    FROM gameplay_clips gc
    WHERE gc.brand_id = p_brand_id
      AND gc.is_active = true
      AND gc.duration_seconds > p_video_duration
      AND (
          p_vibe_preset IS NULL 
          OR p_vibe_preset = ANY(gc.vibe_presets)
          OR array_length(gc.vibe_presets, 1) IS NULL
          OR gc.vibe_presets = '{}'
      )
    ORDER BY gc.id ASC
    OFFSET v_index
    LIMIT 1;

    -- Calculate safe offset range: 0 to (clip_duration - video_duration - 5s buffer)
    v_safe_range := GREATEST(0, v_sel_duration - p_video_duration - 5);
    
    -- Deterministic offset: hash(job_id || clip_id) mod safe_range
    IF v_safe_range > 0 THEN
        v_hash_input := p_job_id::text || '::' || v_sel_id;
        v_offset_hash := ('x' || left(md5(v_hash_input), 8))::bit(32)::bigint;
        v_offset := abs(v_offset_hash) % v_safe_range;
    ELSE
        v_offset := 0;
    END IF;

    clip_id := v_sel_id;
    display_name := v_sel_name;
    file_path := v_sel_path;
    duration_seconds := v_sel_duration;
    start_offset_seconds := v_offset;
    game := v_sel_game;
    clip_count := v_count;
    storage_url := v_sel_path;
    
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION select_gameplay_clip_with_offset IS 'Deterministically select a gameplay clip and compute a random start offset. Same job always gets same clip + offset. Ensures offset + video_duration < clip_duration.';

-- =====================================================
-- 5. GRANT PERMISSIONS
-- =====================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON gameplay_clips TO authenticated;
GRANT ALL ON gameplay_clips TO service_role;
GRANT EXECUTE ON FUNCTION get_brand_gameplay_clips(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION select_gameplay_clip_with_offset(UUID, UUID, INT, TEXT) TO authenticated, service_role;
