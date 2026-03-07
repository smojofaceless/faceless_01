-- =====================================================
-- Migration: 20260220_overlay_video_support.sql
-- Purpose: Add overlay_video deep-merge support to
--          get_effects_config_for_job RPC and update
--          system defaults with overlay_video = disabled.
--
-- Part of: Video Overlay Compositing Feature
--
-- SCHEMA: config_overrides.overlay_video = {
--   enabled: boolean,        -- overlay kill switch
--   file_path: text,         -- Storage path in story-videos bucket
--   url: text,               -- Public URL to the overlay file
--   opacity: 0-1,            -- Blend opacity (default 0.4)
--   blend_mode: 'screen',    -- FFmpeg blend mode
--   display_name: text       -- Original filename for UI display
-- }
-- =====================================================

-- =====================================================
-- 1. UPDATE SYSTEM DEFAULTS — add overlay_video (disabled)
-- =====================================================
CREATE OR REPLACE FUNCTION get_effects_system_defaults()
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT '{
    "enabled": false,
    "intensity": 0.5,
    "kenburns": {
      "enabled": true,
      "zoom_range": [1.0, 1.12],
      "pan_speed": 0.4,
      "direction": "alternate"
    },
    "grain": {
      "enabled": false,
      "intensity": 0.0,
      "size": 1.0
    },
    "flicker": {
      "enabled": false,
      "intensity": 0.0,
      "frequency": 0.3
    },
    "vignette": {
      "enabled": true,
      "intensity": 0.35
    },
    "color_grade": {
      "enabled": true,
      "preset": "auto",
      "intensity": 0.5
    },
    "fade": {
      "fade_in": true,
      "fade_out": true,
      "duration": 1.5
    },
    "overlay_video": {
      "enabled": false,
      "file_path": null,
      "url": null,
      "opacity": 0.4,
      "blend_mode": "screen"
    }
  }'::jsonb;
$$;

-- =====================================================
-- 2. UPDATE MERGE RPC — add overlay_video deep-merge
-- =====================================================
CREATE OR REPLACE FUNCTION get_effects_config_for_job(
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
  v_job_fx   jsonb;
  v_result   jsonb;
BEGIN
  -- Layer 1: System defaults
  v_system := get_effects_system_defaults();

  -- Layer 2: Preset profile
  v_preset := get_effects_preset_profile(COALESCE(p_vibe_preset, 'urban_legend'));

  -- Layer 3: Brand-level overrides (from brand_templates.config_overrides.effects)
  SELECT bt.config_overrides -> 'effects'
    INTO v_brand
    FROM brand_templates bt
   WHERE bt.brand_id = p_brand_id
     AND bt.template_type = COALESCE(p_vibe_preset, 'urban_legend')
     AND bt.config_overrides ? 'effects'
   LIMIT 1;

  IF v_brand IS NULL THEN
    -- Fallback: try any template for this brand that has effects
    SELECT bt.config_overrides -> 'effects'
      INTO v_brand
      FROM brand_templates bt
     WHERE bt.brand_id = p_brand_id
       AND bt.config_overrides ? 'effects'
       AND bt.is_default = true
     LIMIT 1;
  END IF;

  -- Layer 4: Job-level overrides (from job meta.effects_config)
  v_job_fx := p_job_meta -> 'effects_config';

  -- Deep-merge: later layers override earlier
  v_result := v_system;

  -- Merge preset on top
  IF v_preset IS NOT NULL THEN
    v_result := v_result || v_preset;
    IF v_preset ? 'kenburns' THEN
      v_result := jsonb_set(v_result, '{kenburns}', COALESCE(v_result->'kenburns', '{}'::jsonb) || (v_preset->'kenburns'));
    END IF;
    IF v_preset ? 'grain' THEN
      v_result := jsonb_set(v_result, '{grain}', COALESCE(v_result->'grain', '{}'::jsonb) || (v_preset->'grain'));
    END IF;
    IF v_preset ? 'flicker' THEN
      v_result := jsonb_set(v_result, '{flicker}', COALESCE(v_result->'flicker', '{}'::jsonb) || (v_preset->'flicker'));
    END IF;
    IF v_preset ? 'vignette' THEN
      v_result := jsonb_set(v_result, '{vignette}', COALESCE(v_result->'vignette', '{}'::jsonb) || (v_preset->'vignette'));
    END IF;
    IF v_preset ? 'color_grade' THEN
      v_result := jsonb_set(v_result, '{color_grade}', COALESCE(v_result->'color_grade', '{}'::jsonb) || (v_preset->'color_grade'));
    END IF;
    IF v_preset ? 'fade' THEN
      v_result := jsonb_set(v_result, '{fade}', COALESCE(v_result->'fade', '{}'::jsonb) || (v_preset->'fade'));
    END IF;
    IF v_preset ? 'overlay_video' THEN
      v_result := jsonb_set(v_result, '{overlay_video}', COALESCE(v_result->'overlay_video', '{}'::jsonb) || (v_preset->'overlay_video'));
    END IF;
  END IF;

  -- Merge brand overrides on top
  IF v_brand IS NOT NULL THEN
    v_result := v_result || v_brand;
    IF v_brand ? 'kenburns' THEN
      v_result := jsonb_set(v_result, '{kenburns}', COALESCE(v_result->'kenburns', '{}'::jsonb) || (v_brand->'kenburns'));
    END IF;
    IF v_brand ? 'grain' THEN
      v_result := jsonb_set(v_result, '{grain}', COALESCE(v_result->'grain', '{}'::jsonb) || (v_brand->'grain'));
    END IF;
    IF v_brand ? 'flicker' THEN
      v_result := jsonb_set(v_result, '{flicker}', COALESCE(v_result->'flicker', '{}'::jsonb) || (v_brand->'flicker'));
    END IF;
    IF v_brand ? 'vignette' THEN
      v_result := jsonb_set(v_result, '{vignette}', COALESCE(v_result->'vignette', '{}'::jsonb) || (v_brand->'vignette'));
    END IF;
    IF v_brand ? 'color_grade' THEN
      v_result := jsonb_set(v_result, '{color_grade}', COALESCE(v_result->'color_grade', '{}'::jsonb) || (v_brand->'color_grade'));
    END IF;
    IF v_brand ? 'fade' THEN
      v_result := jsonb_set(v_result, '{fade}', COALESCE(v_result->'fade', '{}'::jsonb) || (v_brand->'fade'));
    END IF;
    IF v_brand ? 'overlay_video' THEN
      v_result := jsonb_set(v_result, '{overlay_video}', COALESCE(v_result->'overlay_video', '{}'::jsonb) || (v_brand->'overlay_video'));
    END IF;
  END IF;

  -- Layer 3b: Also check for overlay_video directly in config_overrides
  -- (overlay_video is stored as config_overrides.overlay_video, not under effects)
  DECLARE
    v_overlay jsonb;
  BEGIN
    SELECT bt.config_overrides -> 'overlay_video'
      INTO v_overlay
      FROM brand_templates bt
     WHERE bt.brand_id = p_brand_id
       AND bt.template_type = COALESCE(p_vibe_preset, 'urban_legend')
       AND bt.config_overrides ? 'overlay_video'
     LIMIT 1;

    IF v_overlay IS NOT NULL THEN
      v_result := jsonb_set(v_result, '{overlay_video}', COALESCE(v_result->'overlay_video', '{}'::jsonb) || v_overlay);
    END IF;
  END;

  -- Merge job-level overrides on top
  IF v_job_fx IS NOT NULL THEN
    v_result := v_result || v_job_fx;
    IF v_job_fx ? 'kenburns' THEN
      v_result := jsonb_set(v_result, '{kenburns}', COALESCE(v_result->'kenburns', '{}'::jsonb) || (v_job_fx->'kenburns'));
    END IF;
    IF v_job_fx ? 'grain' THEN
      v_result := jsonb_set(v_result, '{grain}', COALESCE(v_result->'grain', '{}'::jsonb) || (v_job_fx->'grain'));
    END IF;
    IF v_job_fx ? 'flicker' THEN
      v_result := jsonb_set(v_result, '{flicker}', COALESCE(v_result->'flicker', '{}'::jsonb) || (v_job_fx->'flicker'));
    END IF;
    IF v_job_fx ? 'vignette' THEN
      v_result := jsonb_set(v_result, '{vignette}', COALESCE(v_result->'vignette', '{}'::jsonb) || (v_job_fx->'vignette'));
    END IF;
    IF v_job_fx ? 'color_grade' THEN
      v_result := jsonb_set(v_result, '{color_grade}', COALESCE(v_result->'color_grade', '{}'::jsonb) || (v_job_fx->'color_grade'));
    END IF;
    IF v_job_fx ? 'fade' THEN
      v_result := jsonb_set(v_result, '{fade}', COALESCE(v_result->'fade', '{}'::jsonb) || (v_job_fx->'fade'));
    END IF;
    IF v_job_fx ? 'overlay_video' THEN
      v_result := jsonb_set(v_result, '{overlay_video}', COALESCE(v_result->'overlay_video', '{}'::jsonb) || (v_job_fx->'overlay_video'));
    END IF;
  END IF;

  -- MASTER KILL SWITCH: if enabled=false, force everything off
  IF (v_result->>'enabled')::boolean = false THEN
    v_result := jsonb_set(v_result, '{kenburns,enabled}', 'false');
    v_result := jsonb_set(v_result, '{grain,enabled}', 'false');
    v_result := jsonb_set(v_result, '{flicker,enabled}', 'false');
    v_result := jsonb_set(v_result, '{vignette,enabled}', 'false');
    v_result := jsonb_set(v_result, '{color_grade,enabled}', 'false');
    v_result := jsonb_set(v_result, '{fade,fade_in}', 'false');
    v_result := jsonb_set(v_result, '{fade,fade_out}', 'false');
    -- Note: overlay_video is NOT disabled by master kill switch
    -- since it's a compositing layer, not a filter effect
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_effects_config_for_job IS
  'Resolves the final effects_config for a job by deep-merging: system defaults → preset profile → brand template overrides (effects + overlay_video) → job meta overrides. If enabled=false, all sub-effects are force-disabled (overlay_video is exempt).';

-- =====================================================
-- 3. GRANT PERMISSIONS (re-grant in case of any changes)
-- =====================================================
GRANT EXECUTE ON FUNCTION get_effects_system_defaults() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_effects_config_for_job(UUID, TEXT, JSONB) TO authenticated, service_role;
