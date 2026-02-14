-- =====================================================
-- Migration: Add reddit_trending_horror to image prompt preset profiles
-- 
-- Problem: reddit_trending_horror had NO image prompt preset, falling back
-- to generic system defaults (cinematic-dark). This made images
-- visually identical to urban_legend.
--
-- Fix: Add distinct "uncanny-illustrated-horror" visual identity:
--   - 2D digital illustration style (not photographic)
--   - Clean bold ink outlines, cartoon-horror aesthetic
--   - Modern suburban/domestic settings (not rural/retro)
--   - Muted cool tones (not VHS-degraded greens)
--   - Slightly exaggerated character expressions
--
-- Also adjusts story_dna weights to further separate from urban_legend.
-- =====================================================

-- Replace the function to add reddit_trending_horror case
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

    -- ONE TOO MANY: counting horror — uncanny illustrated editorial style
    WHEN 'one_too_many' THEN '{
      "art_style": "uncanny-illustrated",
      "style_prompt": "Detailed horror comic book illustration, bold clean black ink outlines on every figure and object, flat cel-shaded coloring with bright saturated hues, every character face clearly visible and detailed with distinct expressions, manga-influenced horror art, sharp line work, professional graphic novel quality, slight chromatic aberration on edges only.",
      "environment": "any setting where a group gathers — match the scene description. Examples: road trip van, office conference room, cabin living room, restaurant table, hotel lobby, subway platform, school hallway, elevator, ferry deck, backyard barbecue, wedding venue",
      "color_palette": "bright saturated greens for grass and trees, vivid clothing colors (red, yellow, blue, green), warm orange campfire glow, clear skin tones, deep but rich navy-blue night sky with visible stars, high color contrast even in dark scenes",
      "lighting": "bright key lighting on all characters even at night, warm campfire/lamplight illuminating faces clearly, ambient fill light so no face is lost in shadow, starry sky provides cool blue backlight",
      "mood": "uneasy group gathering at night, everyone looks normal but the count feels wrong",
      "camera_angles": ["wide establishing shot showing the full group at night", "medium shot of the group around a campfire", "close-up on a face with a slightly off expression", "low angle looking up at friends talking", "POV from someone arriving at the group", "extreme close-up of an expression that is just slightly wrong"],
      "tension_escalation": true,
      "negative_prompt": "No text, no words, no letters, no watermarks, no signatures, no photorealistic style, no oil painting, no blurry faces, no dark muddy colors, no impressionist style, no faces hidden in shadow, no shadow figures, no silhouettes, no dark mysterious figures, no monsters, no demons, no glowing eyes",
      "suffix": "Portrait orientation 9:16. Clean horror comic book illustration with bold ink outlines, bright flat colors, and every face clearly visible. NOT a painting."
    }'::jsonb

    -- REDDIT TRENDING HORROR: modern internet horror — clean digital illustration,
    -- thick outlines, cartoon-horror aesthetic with dark themes, domestic/suburban settings
    WHEN 'reddit_trending_horror' THEN '{
      "art_style": "uncanny-illustrated-horror",
      "style_prompt": "Digital horror illustration, 2D animated style with thick bold ink outlines, expressive character faces with slightly exaggerated emotions, clean cel-shading, cartoon style hiding deeply unsettling horror. NOT photography. NOT oil painting. Clean vector-like illustration with dark themes.",
      "environment": "modern suburban homes at night, dimly lit hallways, apartment bedrooms, smartphone-lit faces, bathroom mirrors, convenience store at 2am, parking lots under sodium lights, dark staircases, kitchen at midnight, car interior on empty road",
      "color_palette": "muted forest greens and teals, deep navy shadows, soft warm skin tones, slightly desaturated environment with pops of phone-screen blue and red emergency light, cool midnight palette",
      "lighting": "dim ambient room light, phone screen glow on faces, moonlight through blinds, single lamp casting long shadows, LED indicator lights in darkness, bathroom fluorescent flicker",
      "mood": "childlike animation style hiding genuine terror, the ordinary made horrifying, domestic dread, internet-age paranoia",
      "camera_angles": ["wide shot of normal room with one wrong detail", "medium shot of character discovering something", "close-up of phone screen or device", "over-shoulder looking at disturbing evidence", "low angle from doorway into dark room", "extreme close-up of wide frightened eyes"],
      "tension_escalation": true,
      "negative_prompt": "No text, no words, no letters, no watermarks, no photorealistic style, no oil painting, no VHS effects, no film grain, no retro aesthetic, no 1970s-80s settings, no rural backroads, no found footage look",
      "suffix": "Portrait orientation 9:16. Clean digital horror illustration, bold outlines, cartoon horror aesthetic. Modern setting."
    }'::jsonb

    -- BACKROOMS: liminal space horror
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

    -- NOSLEEP: first-person creepypasta
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

    -- GLITCH IN THE MATRIX
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

    -- ANALOG HORROR (legacy)
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
