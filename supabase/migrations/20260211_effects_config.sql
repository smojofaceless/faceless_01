-- =====================================================
-- Migration: 20260211_effects_config.sql
-- Purpose: Seed default effects_config per vibe_preset
--          into brand_templates.config_overrides.effects
--
-- Part of: Roadmap #15 — Effects Refinement (Controlled Motion)
--
-- ROLLOUT STRATEGY:
--   System defaults have enabled=false (effects OFF globally).
--   Per-preset profiles have enabled=true (ready to activate).
--   To enable for a brand: run get_effects_config_for_job() with
--   a brand that has config_overrides.effects.enabled=true in its
--   brand_template, OR pass { "effects_config": { "enabled": true } }
--   in job meta.
--
-- ACTIVE PRESETS:
--   - urban_legend  → documentary folklore style
--   - one_too_many  → counting horror style
--
-- SCHEMA: config_overrides.effects = {
--   enabled: boolean,        -- master kill switch
--   intensity: 0-1,          -- master knob (scales ALL sub-effects)
--   kenburns: { enabled, zoom_range, pan_speed, direction },
--   grain:    { enabled, intensity, size },
--   flicker:  { enabled, intensity, frequency },
--   vignette: { enabled, intensity },
--   color_grade: { enabled, preset, intensity },
--   fade:     { fade_in, fade_out, duration }
-- }
--
-- Merge order at runtime:  SYSTEM_DEFAULTS → preset profile → brand overrides → job meta
-- =====================================================

-- =====================================================
-- 1. SYSTEM DEFAULTS RPC
-- Returns the hardcoded system-level defaults so the
-- worker can use them without hardcoding in TypeScript.
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
    }
  }'::jsonb;
$$;

COMMENT ON FUNCTION get_effects_system_defaults IS
  'Returns the system-level default effects_config. Used by the worker as the base layer before merging preset and brand overrides.';

-- =====================================================
-- 2. PER-PRESET DEFAULT PROFILES
-- These live in a lookup function so they are DB-driven
-- and can be changed without redeploying the worker.
--
-- NOTE: Presets do NOT set "enabled" — that flag is controlled
-- exclusively by system defaults (false), brand overrides, or
-- job meta. This ensures effects stay OFF until explicitly opted in.
-- =====================================================
CREATE OR REPLACE FUNCTION get_effects_preset_profile(p_preset TEXT)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT CASE p_preset

    -- URBAN LEGEND: documentary folklore — subtle grain, strong vignette,
    -- alternating Ken Burns, cold color grade
    WHEN 'urban_legend' THEN '{
      "intensity": 0.6,
      "kenburns": {
        "enabled": true,
        "zoom_range": [1.0, 1.15],
        "pan_speed": 0.5,
        "direction": "alternate"
      },
      "grain": {
        "enabled": true,
        "intensity": 0.20,
        "size": 1.0
      },
      "flicker": {
        "enabled": true,
        "intensity": 0.15,
        "frequency": 0.25
      },
      "vignette": {
        "enabled": true,
        "intensity": 0.60
      },
      "color_grade": {
        "enabled": true,
        "preset": "cinematic_dark",
        "intensity": 0.65
      },
      "fade": {
        "fade_in": true,
        "fade_out": true,
        "duration": 1.5
      }
    }'::jsonb

    -- ONE TOO MANY: counting horror — static tension, cold desaturated,
    -- minimal motion, moderate grain
    WHEN 'one_too_many' THEN '{
      "intensity": 0.5,
      "kenburns": {
        "enabled": true,
        "zoom_range": [1.0, 1.08],
        "pan_speed": 0.25,
        "direction": "in"
      },
      "grain": {
        "enabled": true,
        "intensity": 0.15,
        "size": 0.8
      },
      "flicker": {
        "enabled": false,
        "intensity": 0.0,
        "frequency": 0.3
      },
      "vignette": {
        "enabled": true,
        "intensity": 0.50
      },
      "color_grade": {
        "enabled": true,
        "preset": "cold_desaturated",
        "intensity": 0.55
      },
      "fade": {
        "fade_in": true,
        "fade_out": true,
        "duration": 1.2
      }
    }'::jsonb

    -- ANALOG HORROR (legacy): VHS heavy, scanlines, heavy grain
    WHEN 'analog_horror' THEN '{
      "intensity": 0.7,
      "kenburns": {
        "enabled": true,
        "zoom_range": [1.0, 1.10],
        "pan_speed": 0.3,
        "direction": "alternate"
      },
      "grain": {
        "enabled": true,
        "intensity": 0.45,
        "size": 1.2
      },
      "flicker": {
        "enabled": true,
        "intensity": 0.35,
        "frequency": 0.4
      },
      "vignette": {
        "enabled": true,
        "intensity": 0.55
      },
      "color_grade": {
        "enabled": true,
        "preset": "vhs_degraded",
        "intensity": 0.60
      },
      "fade": {
        "fade_in": true,
        "fade_out": true,
        "duration": 1.0
      }
    }'::jsonb

    -- CLEAN: minimal effects, modern look
    WHEN 'clean' THEN '{
      "intensity": 0.3,
      "kenburns": {
        "enabled": true,
        "zoom_range": [1.0, 1.06],
        "pan_speed": 0.2,
        "direction": "in"
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
        "enabled": false,
        "intensity": 0.0
      },
      "color_grade": {
        "enabled": true,
        "preset": "auto",
        "intensity": 0.3
      },
      "fade": {
        "fade_in": true,
        "fade_out": true,
        "duration": 1.0
      }
    }'::jsonb

    -- Fallback: system defaults (for unknown presets)
    ELSE get_effects_system_defaults()

  END;
$$;

COMMENT ON FUNCTION get_effects_preset_profile IS
  'Returns the default effects_config for a given vibe_preset. Used as the second merge layer (after system defaults, before brand overrides).';

-- =====================================================
-- 3. FULL MERGE RPC
-- Resolves the final effects_config for a job by
-- merging: system_defaults → preset → brand overrides → job meta
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
  -- jsonb || does a shallow merge, so we merge each sub-key explicitly
  v_result := v_system;

  -- Merge preset on top
  IF v_preset IS NOT NULL THEN
    v_result := v_result || v_preset;
    -- Deep-merge nested objects
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
  END IF;

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
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_effects_config_for_job IS
  'Resolves the final effects_config for a job by deep-merging: system defaults → preset profile → brand template overrides → job meta overrides. If enabled=false, all sub-effects are force-disabled.';

-- =====================================================
-- 4. GRANT PERMISSIONS
-- =====================================================
GRANT EXECUTE ON FUNCTION get_effects_system_defaults() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_effects_preset_profile(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_effects_config_for_job(UUID, TEXT, JSONB) TO authenticated, service_role;

-- =====================================================
-- 5. VERIFICATION QUERIES (run manually after migration)
-- =====================================================
-- SELECT get_effects_system_defaults();
-- SELECT get_effects_preset_profile('urban_legend');
-- SELECT get_effects_preset_profile('one_too_many');
-- SELECT get_effects_preset_profile('analog_horror');
-- SELECT get_effects_preset_profile('clean');
-- SELECT get_effects_config_for_job('YOUR_BRAND_UUID', 'urban_legend', '{}'::jsonb);
