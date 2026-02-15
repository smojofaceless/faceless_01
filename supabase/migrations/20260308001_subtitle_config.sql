-- =====================================================
-- Migration: 20260308001_subtitle_config.sql
-- Purpose: Subtitle System v1 — Per-brand subtitle styling
--
-- Part of: Roadmap #14 — Subtitle System v1 (Styles Per Brand)
--
-- WHAT THIS DOES:
--   1. Creates get_subtitle_system_defaults() RPC
--   2. Creates get_subtitle_preset_profile(preset) RPC
--   3. Creates get_subtitle_config_for_job(brand_id, preset, meta) RPC
--   4. Grants permissions
--
-- Subtitle config lives in brand_templates.config_overrides.subtitles
-- alongside the existing .effects, .image_prompt, .music keys.
--
-- SCHEMA: config_overrides.subtitles = {
--   style: string,             -- one of CAPTION_STYLES keys (bold, horror, glitch, minimal, neon, vintage, blood, typewriter, shadow, comic)
--   font_size: number,         -- ASS font size (48-120)
--   position: string,          -- 'bottom' | 'center' | 'top'
--   highlight_scary: boolean,  -- whether to red-highlight scary words
--   words_per_chunk: number,   -- words per subtitle chunk (2-5)
--   highlight_color: string,   -- ASS BGR color for active word highlight
--   scary_color: string,       -- ASS BGR color for scary words
--   emphasis_scale: number,    -- active word scale factor (100-130, maps to \fscx\fscy)
-- }
--
-- Merge order at runtime:  SYSTEM_DEFAULTS → preset profile → brand overrides → job meta
-- (Same pattern as effects_config)
-- =====================================================

-- =====================================================
-- 1. SYSTEM DEFAULTS RPC
-- Returns the hardcoded system-level subtitle defaults.
-- These match the current hardcoded values in server.js createASSSubtitles().
-- =====================================================
CREATE OR REPLACE FUNCTION get_subtitle_system_defaults()
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT '{
    "style": "bold",
    "font_size": 85,
    "position": "bottom",
    "highlight_scary": true,
    "words_per_chunk": 3,
    "highlight_color": "&H0000FFFF",
    "scary_color": "&H001D1DFF",
    "emphasis_scale": 110
  }'::jsonb;
$$;

COMMENT ON FUNCTION get_subtitle_system_defaults IS
  'Returns the system-level default subtitle config. Used by the worker as the base layer before merging preset and brand overrides. Matches the hardcoded defaults in createASSSubtitles().';

-- =====================================================
-- 2. PER-PRESET DEFAULT PROFILES
-- Each vibe preset can specify its own subtitle style
-- that matches the visual tone of the preset.
-- =====================================================
CREATE OR REPLACE FUNCTION get_subtitle_preset_profile(p_preset TEXT)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT CASE p_preset

    -- URBAN LEGEND: classic documentary feel — bold white captions
    WHEN 'urban_legend' THEN '{
      "style": "bold",
      "font_size": 85,
      "position": "bottom",
      "highlight_scary": true,
      "words_per_chunk": 3,
      "emphasis_scale": 110
    }'::jsonb

    -- ONE TOO MANY: uncanny/cold — minimal style, slightly smaller
    WHEN 'one_too_many' THEN '{
      "style": "minimal",
      "font_size": 70,
      "position": "bottom",
      "highlight_scary": true,
      "words_per_chunk": 3,
      "emphasis_scale": 105
    }'::jsonb

    -- ANALOG HORROR: VHS feel — typewriter font
    WHEN 'analog_horror' THEN '{
      "style": "typewriter",
      "font_size": 68,
      "position": "bottom",
      "highlight_scary": true,
      "words_per_chunk": 3,
      "emphasis_scale": 110
    }'::jsonb

    -- REDDIT TRENDING HORROR: dramatic red — horror/blood style
    WHEN 'reddit_trending_horror' THEN '{
      "style": "horror",
      "font_size": 88,
      "position": "bottom",
      "highlight_scary": true,
      "words_per_chunk": 3,
      "emphasis_scale": 112
    }'::jsonb

    -- DARK ORIGINS: cinematic — shadow style with larger font
    WHEN 'dark_origins' THEN '{
      "style": "shadow",
      "font_size": 85,
      "position": "bottom",
      "highlight_scary": true,
      "words_per_chunk": 3,
      "emphasis_scale": 110
    }'::jsonb

    -- CLEAN / CUSTOM: bold defaults
    WHEN 'clean' THEN '{
      "style": "minimal",
      "font_size": 65,
      "position": "bottom",
      "highlight_scary": false,
      "words_per_chunk": 3,
      "emphasis_scale": 105
    }'::jsonb

    -- Fallback: system defaults (for unknown presets like 'custom')
    ELSE get_subtitle_system_defaults()

  END;
$$;

COMMENT ON FUNCTION get_subtitle_preset_profile IS
  'Returns the default subtitle config for a given vibe_preset. Used as the second merge layer (after system defaults, before brand overrides).';

-- =====================================================
-- 3. FULL MERGE RPC
-- Resolves the final subtitle config for a job by
-- merging: system_defaults → preset → brand overrides → job meta
-- =====================================================
CREATE OR REPLACE FUNCTION get_subtitle_config_for_job(
  p_brand_id   UUID,
  p_vibe_preset TEXT,
  p_job_meta    JSONB DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_system   jsonb;
  v_preset   jsonb;
  v_brand    jsonb;
  v_job_sub  jsonb;
  v_result   jsonb;
BEGIN
  -- Layer 1: System defaults
  v_system := get_subtitle_system_defaults();

  -- Layer 2: Preset profile
  v_preset := get_subtitle_preset_profile(COALESCE(p_vibe_preset, 'urban_legend'));

  -- Layer 3: Brand-level overrides (from brand_templates.config_overrides.subtitles)
  SELECT bt.config_overrides -> 'subtitles'
    INTO v_brand
    FROM brand_templates bt
   WHERE bt.brand_id = p_brand_id
     AND bt.template_type = COALESCE(p_vibe_preset, 'urban_legend')
     AND bt.config_overrides ? 'subtitles'
   LIMIT 1;

  IF v_brand IS NULL THEN
    -- Fallback: try any default template for this brand that has subtitles config
    SELECT bt.config_overrides -> 'subtitles'
      INTO v_brand
      FROM brand_templates bt
     WHERE bt.brand_id = p_brand_id
       AND bt.config_overrides ? 'subtitles'
       AND bt.is_default = true
     LIMIT 1;
  END IF;

  -- Layer 4: Job-level overrides (from job meta.subtitle_config)
  v_job_sub := p_job_meta -> 'subtitle_config';

  -- Shallow merge: later layers override earlier (subtitle config is flat, no nesting needed)
  v_result := v_system;

  IF v_preset IS NOT NULL THEN
    v_result := v_result || v_preset;
  END IF;

  IF v_brand IS NOT NULL THEN
    v_result := v_result || v_brand;
  END IF;

  IF v_job_sub IS NOT NULL THEN
    v_result := v_result || v_job_sub;
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_subtitle_config_for_job IS
  'Resolves the final subtitle config for a job by merging: system defaults → preset profile → brand template overrides → job meta overrides.';

-- =====================================================
-- 4. GRANT PERMISSIONS
-- =====================================================
GRANT EXECUTE ON FUNCTION get_subtitle_system_defaults() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_subtitle_preset_profile(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_subtitle_config_for_job(UUID, TEXT, JSONB) TO authenticated, service_role;

-- =====================================================
-- 5. VERIFICATION QUERIES (run manually after migration)
-- =====================================================
-- SELECT get_subtitle_system_defaults();
-- SELECT get_subtitle_preset_profile('urban_legend');
-- SELECT get_subtitle_preset_profile('one_too_many');
-- SELECT get_subtitle_preset_profile('reddit_trending_horror');
-- SELECT get_subtitle_preset_profile('dark_origins');
-- SELECT get_subtitle_config_for_job('YOUR_BRAND_UUID', 'urban_legend', '{}'::jsonb);
