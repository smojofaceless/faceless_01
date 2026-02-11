-- =====================================================
-- Migration: 20260212_image_prompt_config.sql
-- Purpose: DB-driven image prompt config per vibe preset
--          Follows effects_config pattern: system defaults → preset → brand → job meta
--
-- Part of: Image Generation Unification
--
-- SCHEMA: config_overrides.image_prompt = {
--   art_style:        string  (key into style_prompt, e.g. "cinematic-dark")
--   style_prompt:     string  (full DALL-E style prefix)
--   environment:      string  (environment description for the scene)
--   color_palette:    string  (color guidance appended to prompt)
--   lighting:         string  (lighting description)
--   mood:             string  (mood/atmosphere text)
--   camera_angles:    string[] (progression per scene index)
--   tension_escalation: boolean (whether tension level increases per scene)
--   negative_prompt:  string  (things to exclude: "no text, no words, no letters, no watermarks")
--   suffix:           string  (appended after everything, e.g. "Portrait orientation 9:16")
-- }
--
-- Merge order at runtime: SYSTEM_DEFAULTS → preset profile → brand overrides → job meta
-- =====================================================

-- =====================================================
-- 1. SYSTEM DEFAULTS
-- =====================================================
CREATE OR REPLACE FUNCTION get_image_prompt_system_defaults()
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT '{
    "art_style": "cinematic-dark",
    "style_prompt": "Cinematic dark photography, moody desaturated colors, deep shadows, film grain, A24 horror aesthetic.",
    "environment": "dark misty forest, twisted trees",
    "color_palette": "dark, desaturated, moody colors with deep shadows",
    "lighting": "low-key lighting, dramatic shadows, occasional harsh light",
    "mood": "unsettling dread",
    "camera_angles": ["establishing wide shot", "medium shot", "close-up", "dutch angle", "low angle", "extreme close-up"],
    "tension_escalation": true,
    "negative_prompt": "No text, no words, no letters, no watermarks, no signatures",
    "suffix": "Portrait orientation 9:16. Horror photography, cinematic composition."
  }'::jsonb;
$$;

COMMENT ON FUNCTION get_image_prompt_system_defaults IS
  'Returns the system-level default image prompt config. Base layer before merging preset and brand overrides.';

-- =====================================================
-- 2. PER-PRESET PROFILES
-- These define the visual identity per vibe preset
-- =====================================================
CREATE OR REPLACE FUNCTION get_image_prompt_preset_profile(p_preset TEXT)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT CASE p_preset

    -- URBAN LEGEND: documentary folklore — VHS-degraded cinematic dark,
    -- sickly green tones, grainy found-footage feel
    WHEN 'urban_legend' THEN '{
      "art_style": "cinematic-dark",
      "style_prompt": "Cinematic dark photography, A24 horror film style, moody desaturated colors, deep shadows, film grain, shallow depth of field, VHS-degraded footage quality.",
      "environment": "small-town America, rural backroads, overgrown lots, chain-link fences, roadside diners at night",
      "color_palette": "sickly green undertones, desaturated yellows, deep blacks, sodium vapor orange cast",
      "lighting": "low-key lighting, single harsh overhead light casting long shadows, flashlight beams in darkness",
      "mood": "documentary unease, something is wrong but nobody will say it",
      "camera_angles": ["establishing wide shot of desolate location", "medium shot through dirty window", "close-up of unsettling detail", "dutch angle implying wrongness", "low angle looking up at looming figure", "extreme close-up of eyes or hands"],
      "tension_escalation": true,
      "negative_prompt": "No text, no words, no letters, no watermarks, no signatures, no happy scenes",
      "suffix": "Portrait orientation 9:16. Horror photography, cinematic composition, documentary still."
    }'::jsonb

    -- ONE TOO MANY: counting horror — uncanny illustrated editorial style,
    -- cold blue tones, static tension, group photos that feel wrong
    WHEN 'one_too_many' THEN '{
      "art_style": "uncanny-illustrated",
      "style_prompt": "Editorial cartoon illustration, cel-shaded horror, bold black ink outlines, flat cold colors, uncanny valley faces, extra figure that should not be there, off-kilter group composition.",
      "environment": "mundane group settings — camping trip, school photo, dinner table, group selfie, elevator, waiting room",
      "color_palette": "cold blue undertones, washed-out pastels, stark white highlights, deep navy shadows",
      "lighting": "flat institutional lighting, flash photography overexposure, unflattering fluorescent",
      "mood": "counting dread — the number is wrong and no one else notices",
      "camera_angles": ["wide group shot showing everyone", "medium shot — count the figures", "close-up on the extra face", "overhead view showing one too many shadows", "POV looking at a group photo", "extreme close-up of a face that was not there before"],
      "tension_escalation": true,
      "negative_prompt": "No text, no words, no letters, no watermarks, no signatures, no happy expressions",
      "suffix": "Portrait orientation 9:16. Unsettling editorial illustration, horror comic style."
    }'::jsonb

    -- BACKROOMS: liminal space horror — empty impossible architecture,
    -- fluorescent hum, infinite repetition
    WHEN 'backrooms' THEN '{
      "art_style": "analog-horror",
      "style_prompt": "Analog horror aesthetic, liminal space photography, endless empty rooms, VHS tracking artifacts, fluorescent buzz, impossible architecture, the backrooms.",
      "environment": "infinite yellow office rooms, empty malls after hours, abandoned hotels with repeating hallways, pools with no exits",
      "color_palette": "sickly fluorescent yellow-green, beige monotone, muted institutional colors, buzzing white light",
      "lighting": "harsh overhead fluorescent panels, no shadows (impossibly even lighting), flickering tubes",
      "mood": "you are somewhere you should not be, and it goes on forever",
      "camera_angles": ["POV entering through a door that should not exist", "wide shot of impossibly long corridor", "medium shot of identical repeating doorways", "close-up of wall texture that subtly shifts", "low angle looking down infinite stairs", "extreme close-up of a sign that makes no sense"],
      "tension_escalation": true,
      "negative_prompt": "No text, no words, no letters, no watermarks, no people (unless specified in scene), no natural environments",
      "suffix": "Portrait orientation 9:16. Liminal space photography, found footage quality."
    }'::jsonb

    -- NOSLEEP: first-person creepypasta — starts mundane, becomes terrifying,
    -- documentary realism that degrades as story progresses
    WHEN 'nosleep' THEN '{
      "art_style": "cinematic-dark",
      "style_prompt": "Cinematic dark photography, dash cam quality, Ring doorbell camera aesthetic, mundane suburban horror, the ordinary made terrifying.",
      "environment": "suburban neighborhoods at night, normal bedrooms with something wrong, parking garages, gas stations at 3am",
      "color_palette": "natural muted tones degrading to sickly yellows and deep blacks, normal colors that slowly feel wrong",
      "lighting": "natural lighting that progressively fails, porch lights, phone screen glow, headlights on empty road",
      "mood": "this started normal — what changed? — creeping First-person dread",
      "camera_angles": ["establishing shot of normal location", "medium shot showing something slightly off", "close-up of the first sign of wrongness", "dutch angle as reality warps", "low angle trapped perspective", "extreme close-up of the horror revealed"],
      "tension_escalation": true,
      "negative_prompt": "No text, no words, no letters, no watermarks, no supernatural (until final scenes)",
      "suffix": "Portrait orientation 9:16. Found footage realism, creepypasta photography."
    }'::jsonb

    -- GLITCH IN THE MATRIX: reality malfunction — déjà vu, NPCs,
    -- digital artifacts bleeding into real world
    WHEN 'glitch' THEN '{
      "art_style": "analog-horror",
      "style_prompt": "Glitch art horror, digital artifacts in real-world photography, pixel corruption, scanline tears, reality rendering errors, simulation malfunction aesthetic.",
      "environment": "everyday locations with subtle digital corruption — supermarkets, crosswalks, office buildings, identical houses in a row",
      "color_palette": "clinical clean tones with RGB channel splitting, magenta/cyan glitch fringing, oversaturated patches in otherwise muted scenes",
      "lighting": "normal daylight with impossible shadow duplications, streetlights that repeat, lens flares from no light source",
      "mood": "reality is a program and it is crashing — déjà vu panic",
      "camera_angles": ["wide shot of normal scene with one glitch detail", "medium shot of duplicated person in crowd", "close-up of object that should not repeat", "skewed angle as if the camera clipped through geometry", "low angle of identical NPCs walking in sync", "extreme close-up of a face mid-render"],
      "tension_escalation": true,
      "negative_prompt": "No text, no words, no letters, no watermarks, no overtly supernatural elements",
      "suffix": "Portrait orientation 9:16. Simulation horror, glitch photography."
    }'::jsonb

    -- ANALOG HORROR (legacy): VHS found footage, Mandela Catalogue style
    WHEN 'analog_horror' THEN '{
      "art_style": "analog-horror",
      "style_prompt": "Analog horror VHS aesthetic, heavy static, tracking distortion, grainy footage, retro horror, scanlines, glitch artifacts, found footage from the 1980s.",
      "environment": "local TV station, basement, VHS tape labeled DO NOT WATCH, emergency broadcast, government training video",
      "color_palette": "VHS color bleeding, oversaturated reds, magnetic tape degradation, CRT phosphor glow",
      "lighting": "tube television glow, camera auto-exposure failures, night-shot green infrared",
      "mood": "you found a tape that someone tried to destroy — Mandela Catalogue dread",
      "camera_angles": ["static wide shot of empty room (security cam)", "medium shot with tracking lines obscuring", "close-up distorted by VHS warping", "dutch angle with scan line tear", "low angle of figure approaching camera", "extreme close-up of face through static"],
      "tension_escalation": true,
      "negative_prompt": "No text, no words, no modern technology, no HD quality, no clean images",
      "suffix": "Portrait orientation 9:16. VHS found footage, analog horror photography."
    }'::jsonb

    -- Fallback: system defaults
    ELSE get_image_prompt_system_defaults()

  END;
$$;

COMMENT ON FUNCTION get_image_prompt_preset_profile IS
  'Returns the default image prompt config for a given vibe preset. Second merge layer after system defaults.';

-- =====================================================
-- 3. FULL MERGE RPC
-- Resolves final image prompt config for a job:
-- system_defaults → preset → brand overrides → job meta
-- =====================================================
CREATE OR REPLACE FUNCTION get_image_prompt_config_for_job(
  p_brand_id    UUID,
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
  v_job_ip   jsonb;
  v_result   jsonb;
BEGIN
  -- Layer 1: System defaults
  v_system := get_image_prompt_system_defaults();

  -- Layer 2: Preset profile
  v_preset := get_image_prompt_preset_profile(COALESCE(p_vibe_preset, 'urban_legend'));

  -- Layer 3: Brand-level overrides (from brand_templates.config_overrides.image_prompt)
  SELECT bt.config_overrides -> 'image_prompt'
    INTO v_brand
    FROM brand_templates bt
   WHERE bt.brand_id = p_brand_id
     AND bt.template_type = COALESCE(p_vibe_preset, 'urban_legend')
     AND bt.config_overrides ? 'image_prompt'
   LIMIT 1;

  IF v_brand IS NULL THEN
    -- Fallback: try any default template for this brand that has image_prompt
    SELECT bt.config_overrides -> 'image_prompt'
      INTO v_brand
      FROM brand_templates bt
     WHERE bt.brand_id = p_brand_id
       AND bt.config_overrides ? 'image_prompt'
       AND bt.is_default = true
     LIMIT 1;
  END IF;

  -- Layer 4: Job-level overrides (from job meta.image_prompt_config)
  v_job_ip := p_job_meta -> 'image_prompt_config';

  -- Merge: later layers fully override earlier for top-level keys
  -- (image prompt config is flat strings, not nested objects like effects)
  v_result := v_system;

  IF v_preset IS NOT NULL THEN
    -- Preset overrides system defaults (only non-null keys)
    v_result := v_result || v_preset;
  END IF;

  IF v_brand IS NOT NULL THEN
    -- Brand overrides preset
    v_result := v_result || v_brand;
  END IF;

  IF v_job_ip IS NOT NULL THEN
    -- Job meta overrides everything
    v_result := v_result || v_job_ip;
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_image_prompt_config_for_job IS
  'Resolves the final image_prompt config for a job by merging: system defaults → preset profile → brand template overrides → job meta overrides.';

-- =====================================================
-- 4. GRANT PERMISSIONS
-- =====================================================
GRANT EXECUTE ON FUNCTION get_image_prompt_system_defaults() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_image_prompt_preset_profile(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_image_prompt_config_for_job(UUID, TEXT, JSONB) TO authenticated, service_role;

-- =====================================================
-- 5. VERIFICATION QUERIES (run manually after migration)
-- =====================================================
-- SELECT get_image_prompt_system_defaults();
-- SELECT get_image_prompt_preset_profile('urban_legend');
-- SELECT get_image_prompt_preset_profile('one_too_many');
-- SELECT get_image_prompt_preset_profile('backrooms');
-- SELECT get_image_prompt_preset_profile('nosleep');
-- SELECT get_image_prompt_preset_profile('glitch');
-- SELECT get_image_prompt_config_for_job('YOUR_BRAND_UUID', 'urban_legend', '{}'::jsonb);
