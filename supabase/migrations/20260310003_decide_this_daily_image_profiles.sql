-- =====================================================
-- Migration: Add DecideThisDaily image prompt preset profiles
--
-- ROOT CAUSE: no_good_choice, one_rule_one_power, two_doors
-- had no WHEN clause in get_image_prompt_preset_profile(), so
-- they fell through to get_image_prompt_system_defaults() which
-- returns horror-branded defaults (A24 horror, dark misty forest,
-- unsettling dread). This caused DecideThisDaily videos to be
-- generated with horror imagery.
--
-- FIX: Add 3 brand-appropriate preset profiles:
--   - no_good_choice:      Clean editorial, real-world decision tension
--   - one_rule_one_power:  Surreal contemplative, dreamlike atmosphere
--   - two_doors:           High-contrast cinematic, bold visual contrast
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

    -- REDDIT TRENDING HORROR: modern cartoon horror — Steven Universe / Cartoon Network
    WHEN 'reddit_trending_horror' THEN '{
      "art_style": "uncanny-illustrated-horror",
      "style_prompt": "Modern Western cartoon animation in the style of Steven Universe and Cartoon Network shows, thick clean black outlines on every character and object, flat cel-shaded coloring with bright saturated colors, rounded soft character designs with large expressive eyes, slightly exaggerated proportions, simple clean backgrounds with soft color gradients, professional TV animation quality. Cheerful cartoon art style that hides deeply unsettling horror beneath its colorful surface. NOT photography. NOT oil painting. NOT anime. NOT realistic.",
      "environment": "colorful cartoon suburban homes, bright beach towns with pastel buildings, cheerful-looking bedrooms with one unsettling detail, cartoon kitchen at night with warm lighting, simplified cartoon convenience stores, cozy apartments with something slightly wrong, cartoon car interiors, school hallways drawn in bright colors, cartoon bathroom with clean tile patterns",
      "color_palette": "bright saturated pastels — sky blues, warm pinks, sunny yellows, soft lavenders, vibrant greens, warm peachy skin tones, cotton candy color harmony, star-shaped highlights, bright cheerful palette with occasional dramatic shadow contrast for horror beats",
      "lighting": "bright warm cartoon lighting, golden hour glow, cheerful blue skies that can suddenly shift to dramatic deep purple-blue, soft ambient cartoon fill light on all characters, warm lamplight in interior scenes, dramatic backlight silhouettes only for peak horror moments",
      "mood": "bright cheerful cartoon surface hiding genuine terror underneath, the juxtaposition of cute rounded characters in horrifying situations, Steven Universe meets creepypasta, wholesome animation style delivering unwholesome content",
      "camera_angles": ["wide establishing shot of colorful cartoon location with one wrong detail", "medium shot of rounded cartoon character discovering something disturbing", "close-up of large expressive cartoon eyes showing fear", "over-shoulder shot in bright cartoon room with unsettling background element", "low angle looking up at friendly-looking character who feels wrong", "extreme close-up of cartoon face shifting from cheerful to terrified"],
      "tension_escalation": true,
      "negative_prompt": "No text, no words, no letters, no watermarks, no photorealistic style, no oil painting, no VHS effects, no film grain, no anime style, no dark muddy colors, no desaturated palette, no retro aesthetic, no rural backroads, no found footage look, no realistic proportions",
      "suffix": "Portrait orientation 9:16. Bright colorful cartoon animation style like Steven Universe. Thick outlines, flat cel-shading, saturated colors, rounded character designs. Modern setting."
    }'::jsonb

    -- DARK ORIGINS: documentary dark biography
    WHEN 'dark_origins' THEN '{
      "art_style": "dark-realistic",
      "style_prompt": "Dark eerie realistic digital illustration, photorealistic horror art with painterly edges, heavy chiaroscuro lighting, hyper-detailed faces and environments, cinematic composition like a true crime documentary still frame, muted desaturated color palette with selective warm accents, film grain texture overlay, detailed period-accurate clothing and architecture. NOT cartoon. NOT anime. NOT bright colors. Think: concept art for a dark Netflix documentary, each frame could be a crime scene evidence photo rendered as fine art.",
      "environment": "1950s-1980s small-town America: crumbling Victorian houses, abandoned factories, dimly lit hospital wards, rural churches at dusk, taxidermy workshops, old TV studios with analog equipment, recording studios with reel-to-reel tape, overgrown summer camps, boarded-up farmhouses, courthouse basements with filing cabinets, rain-slicked parking lots under sodium lamps",
      "color_palette": "heavily desaturated earth tones — muddy browns, cold grays, sickly yellows, deep shadows approaching black, selective warm amber from single light sources, skin tones slightly pallid, faded photograph quality, occasional deep crimson accent",
      "lighting": "dramatic chiaroscuro with single harsh light source, strong directional shadows, pools of warm light surrounded by deep darkness, overhead interrogation-style lighting, dim amber from old desk lamps, cold blue moonlight through cracked windows, flashbulb-frozen moment quality",
      "mood": "documentary dread — the calm presentation of deeply disturbing facts, archival horror, the uncanny valley of historical photographs that feel too alive, something terrible happened here and the evidence remains",
      "camera_angles": ["wide establishing shot of isolated historical building at dusk", "medium shot of figure in period clothing half-lit by single lamp", "close-up of hands holding aged evidence (photographs, documents, objects)", "low angle looking up at imposing figure silhouetted in doorway", "overhead shot of crime scene or workshop with unsettling details", "extreme close-up of face half in shadow with one eye visible", "evidence photo framing — mugshot style front-facing portrait with harsh flash", "newspaper clipping framing — grainy archive photo with visible halftone dots", "crime scene overhead — birds-eye view of floor plan or evidence layout with numbered markers", "case file insert — close-up of aged document, typed report, or handwritten journal with selective focus"],
      "tension_escalation": true,
      "negative_prompt": "No text, no words, no letters, no watermarks, no cartoon style, no anime, no bright saturated colors, no modern technology (smartphones, laptops), no cheerful scenes, no clean well-lit environments, no flat illustration style, no cel-shading",
      "suffix": "Portrait orientation 9:16. Dark realistic horror illustration. Film grain, heavy shadows, period-accurate 1950s-1980s setting. Documentary evidence still frame quality."
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

    -- =========================================================
    -- DECIDE THIS DAILY PRESETS (non-horror engagement brand)
    -- =========================================================

    -- NO_GOOD_CHOICE: Clean editorial — real-world decision tension
    -- Visual type: gameplay (may not generate AI images, but profile
    -- exists as safety net if image pipeline is invoked)
    WHEN 'no_good_choice' THEN '{
      "art_style": "editorial-clean",
      "style_prompt": "Clean modern editorial photography, sharp focus, balanced neutral tones, documentary-style framing, everyday realism with cinematic composition, magazine-quality imagery, professional commercial photography with a hint of tension.",
      "environment": "real-world decision spaces — office boardrooms, hospital waiting rooms, courtrooms, city crossroads at dusk, apartment interiors with warm lighting, parking lots under sodium lamps, coffee shops, airport departure gates",
      "color_palette": "warm neutrals — cream, khaki, soft gray, muted gold accents, selective amber and burnt orange for tension, clean whites, desaturated but warm overall palette",
      "lighting": "even balanced key lighting, soft overhead panels, natural daylight through large windows, warm practical lamps, golden hour side light, clean and readable — no horror shadows",
      "mood": "uncomfortable pressure, moral weight, the quiet dread of consequence — no escape from this choice, but NOT horror — real-life stakes",
      "camera_angles": ["wide shot of decision space (two paths, two doors, split room)", "medium shot of person at crossroads looking uncertain", "close-up of hands gripping an object tightly", "over-shoulder POV facing two options", "low angle looking up at looming consequence", "extreme close-up of eyes reflecting difficult thought"],
      "tension_escalation": false,
      "negative_prompt": "No horror, no supernatural, no dark misty forests, no VHS effects, no blood, no monsters, no film grain, no desaturated dark palette, no A24 horror, no creepy, no unsettling faces, no text, no words, no letters, no watermarks",
      "suffix": "Portrait orientation 9:16. Clean editorial photography, documentary composition. Modern real-world setting."
    }'::jsonb

    -- ONE_RULE_ONE_POWER: Surreal contemplative — dreamlike atmosphere
    -- Visual type: ai_images_moody (3-5 atmospheric AI images)
    WHEN 'one_rule_one_power' THEN '{
      "art_style": "surreal-contemplative",
      "style_prompt": "Surreal contemplative digital art, dreamlike atmospheric compositions with soft painterly edges meeting sharp focal points, ethereal and otherworldly but grounded in emotion, conceptual art photography meets magical realism, volumetric light and atmospheric haze, premium gallery-quality imagery.",
      "environment": "liminal symbolic spaces — empty grand halls with floating objects, misty mountain overlooks at golden hour, solitary figures in vast ethereal landscapes, quiet rooms with impossible geometry, infinite libraries, doorways opening to skies, still water reflecting something different than reality",
      "color_palette": "deep indigo and midnight blue base, warm amber and liquid gold accents, muted purple twilight tones, occasional warm sunlight breaking through clouds, teal-to-copper gradients, soft rose highlights on skin",
      "lighting": "soft diffused ethereal light, golden hour warmth cutting through mist, volumetric god rays, gentle warm rim lighting, bioluminescent ambient glow, light as a metaphor for power and revelation",
      "mood": "contemplative gravity, the weight of extraordinary choice, awe mixed with quiet uncertainty, standing at the threshold of something immense — NOT horror, NOT dread — wonder and consequence",
      "camera_angles": ["wide establishing shot of vast symbolic landscape", "medium shot of solitary figure contemplating floating object", "close-up of hands cupping glowing light or symbolic artifact", "low angle looking up through impossible architecture", "POV reaching toward something luminous", "extreme close-up of eye reflecting the power being offered"],
      "tension_escalation": false,
      "negative_prompt": "No horror, no gore, no dark forests, no VHS effects, no film grain, no monsters, no blood, no A24 horror, no unsettling faces, no creepy atmosphere, no jump scares, no darkness without light, no text, no words, no letters, no watermarks",
      "suffix": "Portrait orientation 9:16. Surreal contemplative art, atmospheric dreamlike composition. Ethereal and thought-provoking."
    }'::jsonb

    -- TWO_DOORS: High-contrast cinematic — bold dramatic visual contrast
    -- Visual type: ai_images_contrast (paired contrasting AI images)
    WHEN 'two_doors' THEN '{
      "art_style": "cinematic-contrast",
      "style_prompt": "High-contrast cinematic photography with bold dramatic compositions, vivid split-tone color grading, sharp depth of field, powerful visual metaphors, premium editorial quality, architectural symmetry meets human drama, theatrical lighting design.",
      "environment": "symmetrical architectural spaces — long corridors splitting into two distinct paths, grand doorways side by side each glowing different colors, mirrors showing different reflections, crossroads in dramatic landscapes, split-screen reality — one side warm and organic, the other cool and geometric",
      "color_palette": "bold complementary contrasts — warm gold against cool sapphire, organic amber versus synthetic steel blue, rich saturated opposing primaries, split-tone grading where each choice has its own color identity, vivid and decisive palette",
      "lighting": "dramatic directional side lighting, strong key light with deep fill creating theater-stage drama, golden versus blue opposing light sources, each path lit differently to emphasize contrast, chiaroscuro for drama NOT horror",
      "mood": "electric anticipation, the breathless moment before an irreversible choice, dramatic weight and consequence — two equally compelling futures, neither clearly better — NOT horror, NOT dread — tension and possibility",
      "camera_angles": ["wide symmetrical shot of two paths diverging", "medium shot of figure standing between two glowing doorways", "close-up split composition — warm left half vs cool right half", "low angle looking up at towering dual archways", "POV standing at the threshold looking into each path", "extreme close-up of hand reaching toward one of two options"],
      "tension_escalation": false,
      "negative_prompt": "No horror, no supernatural, no VHS effects, no film grain, no monsters, no blood, no A24 horror, no dark misty forests, no desaturated palette, no creepy faces, no unsettling atmosphere, no text, no words, no letters, no watermarks",
      "suffix": "Portrait orientation 9:16. Dramatic cinematic photography, high-contrast split-tone composition. Bold and decisive visual storytelling."
    }'::jsonb

    -- Fallback: system defaults
    ELSE get_image_prompt_system_defaults()

  END;
$$;

COMMENT ON FUNCTION get_image_prompt_preset_profile IS
  'Returns the default image prompt config for a given vibe preset. Second merge layer after system defaults. Includes DecideThisDaily presets (no_good_choice, one_rule_one_power, two_doors) with non-horror visual profiles.';
