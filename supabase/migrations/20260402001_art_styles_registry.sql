-- =============================================================================
-- ART STYLES REGISTRY (Issue #7)
-- Single source of truth for all art style definitions.
-- Replaces fragmented definitions across 4 files:
--   1. run-job/config.ts (ART_STYLE_CONFIG)
--   2. worker-v1/steps.ts (styleTemplates)
--   3. js/app.js (ART_STYLE_INFO + BUILTIN_ART_STYLES)
--   4. video-renderer/comfyui/config.js (STYLE_MAP)
-- =============================================================================

CREATE TABLE IF NOT EXISTS art_styles (
  id text PRIMARY KEY,                    -- e.g. 'cinematic-dark'
  name text NOT NULL,                     -- Display name: 'Cinematic Dark Photography'
  icon text DEFAULT '🎨',                 -- Emoji icon for UI
  description text,                       -- Short description for UI preview
  category text DEFAULT 'horror',         -- 'horror', 'editorial', 'general', 'cartoon'
  
  -- Prompt config (replaces config.ts ART_STYLE_CONFIG + steps.ts styleTemplates)
  base_prompt text NOT NULL,              -- Full positive prompt for image generation
  color_override text,                    -- Color palette description
  technical_style text,                   -- Camera/technique description
  negative_prompt text,                   -- Style-specific negative prompt
  
  -- ComfyUI tokens (replaces config.js STYLE_MAP)
  comfyui_tokens text,                    -- Weighted tokens: '(cinematic:1.3), (dark:1.2)'
  
  -- Style protection (for styles like uncanny-illustrated with strict rules)
  banned_tokens text[],                   -- Tokens that must be stripped from Visual DNA injection
  style_replacement text[],              -- Safe replacement tokens for Visual DNA
  texture_replacement jsonb,              -- Map of texture token replacements
  extra_rules jsonb,                      -- Additional style-specific rules/config
  
  -- Metadata
  is_active boolean DEFAULT true,         -- Soft delete / disable
  sort_order integer DEFAULT 100,         -- Display ordering in UI
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for active styles query
CREATE INDEX IF NOT EXISTS idx_art_styles_active ON art_styles (is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_art_styles_category ON art_styles (category) WHERE is_active = true;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_art_styles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER art_styles_updated_at
  BEFORE UPDATE ON art_styles
  FOR EACH ROW
  EXECUTE FUNCTION update_art_styles_updated_at();

-- =============================================================================
-- RLS: Allow anon read access (frontend needs to load styles)
-- =============================================================================
ALTER TABLE art_styles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "art_styles_anon_read" ON art_styles
  FOR SELECT TO anon
  USING (is_active = true);

CREATE POLICY "art_styles_service_all" ON art_styles
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- SEED DATA: All 16 art styles consolidated from 4 source files
-- =============================================================================

INSERT INTO art_styles (id, name, icon, description, category, base_prompt, color_override, technical_style, negative_prompt, comfyui_tokens, sort_order) VALUES

-- ═══════════════════════════════════════════════════
-- HORROR STYLES
-- ═══════════════════════════════════════════════════

('cinematic-dark', 
 'Cinematic Dark Photography', 
 '🎬',
 'A24 horror film aesthetic. Moody desaturated colors, deep shadows, film grain, shallow depth of field, realistic but atmospheric.',
 'horror',
 'Cinematic dark photography. Moody desaturated colors, deep shadows, film grain, A24 horror film aesthetic. Realistic but atmospheric, shallow depth of field, dramatic lighting.',
 'muted colors, deep shadows, film grain, desaturated with selective color',
 'cinematic horror, film grain, shallow depth of field, realistic lighting, professional photography',
 'cartoon, anime, illustration, bright colors, cheerful, text, words, letters, symbols',
 '(cinematic lighting:1.3), (dark atmosphere:1.2), (film grain:1.1)',
 10),

('analog-horror', 
 'Analog Horror / VHS Glitch', 
 '📼',
 'Heavy VHS static, glitch artifacts, scanlines, digital noise. Shadow entities with glowing eyes, low exposure, found-footage style, deeply unsettling.',
 'horror',
 'Dark analog horror image with heavy VHS static, glitch artifacts, scanlines, and digital noise distorting the scene. Figures are mostly obscured by shadow with possible glowing eyes or unnatural grins barely visible. Low exposure, eerie dim lighting, muted washed-out colors. Deeply unsettling atmosphere, psychological horror, found-footage style with slow flickering shadows. The feeling of something wrong captured on an old camera.',
 'washed out colors, VHS grain, digital artifacts, scanlines, low exposure, muted greens and grays',
 'analog horror, VHS aesthetic, glitch art, scanlines, digital noise, found footage, surveillance camera, lo-fi horror',
 'high quality, clean, professional, sharp, colorful, cartoon, anime, bright, text, words, letters',
 '(VHS aesthetic:1.2), (analog distortion:1.1), (scanlines:1.0)',
 20),

('editorial-cartoon', 
 'Editorial Cartoon / Satirical Comic', 
 '📰',
 'Clean bold linework, exaggerated expressions, large expressive eyes. Web-comic style with soft gradients, satirical and slightly unsettling humor.',
 'horror',
 'Editorial cartoon illustration in a modern web-comic style. Clean, bold linework with smooth confident outlines. Semi-flat digital coloring with soft gradients and minimal texture. Slightly exaggerated proportions designed for satire and storytelling. Exaggerated facial expressions with large expressive eyes. The mood is satirical, ironic, and slightly unsettling but humorous.',
 'saturated but controlled color palette, clean digital colors, soft gradients, no painterly texture',
 'editorial cartoon, satirical comic illustration, modern digital comic, bold outlines, clean vector-style shading, web animation ready',
 'photorealism, oil painting, watercolor, anime style, sketchy lines, hyper realism, grainy noise, blurry edges, text, words, letters',
 '(editorial cartoon:1.3), (bold linework:1.2), (digital illustration:1.1)',
 30),

('horror-anime', 
 'Dark Anime / Manga Style', 
 '🎌',
 'Junji Ito / Berserk inspired. Detailed manga linework, heavy cross-hatching, dramatic poses, high contrast black and white with color accents.',
 'horror',
 'Dark anime horror illustration. Detailed manga-style linework with heavy cross-hatching for shadows. Dramatic poses, expressive characters, atmospheric horror lighting. Style of Junji Ito or Berserk manga. High contrast black and white with occasional color accents.',
 'high contrast, dramatic blacks, selective color accents, manga shading',
 'dark anime, horror manga, detailed linework, dramatic lighting, Japanese horror aesthetic',
 'cute, chibi, kawaii, bright happy colors, simple cartoon, text, words, letters',
 '(dark anime:1.3), (manga horror:1.2), (detailed linework:1.1)',
 40),

('oil-painting', 
 'Classic Oil Painting', 
 '🖼️',
 'Renaissance masters meets dark romanticism. Caravaggio chiaroscuro, Goya''s Black Paintings style. Rich textures, dramatic lighting, timeless.',
 'horror',
 'Classic oil painting horror art. Renaissance masters meets dark romanticism. Rich textures, dramatic chiaroscuro lighting, painterly brushstrokes. Style of Caravaggio, Goya''s Black Paintings, or John Martin. Moody and timeless.',
 'rich deep colors, warm shadows, golden highlights, classical palette',
 'oil painting, fine art, chiaroscuro, baroque lighting, museum quality, painterly brushstrokes',
 'digital art, cartoon, anime, modern, photography, text, words, letters',
 '(oil painting:1.3), (painterly brushstrokes:1.2), (chiaroscuro:1.1)',
 50),

('found-footage', 
 'Found Footage / Grainy', 
 '📹',
 'Blair Witch aesthetic. Grainy VHS quality, security camera look, night vision green, analog distortion. Accidental capture feel.',
 'horror',
 'Found footage horror aesthetic. Grainy VHS quality, security camera look, analog distortion. Night vision green or washed out colors. Unsettling surveillance feel, as if captured by accident. Blair Witch Project aesthetic.',
 'washed out colors, VHS grain, night vision green, analog artifacts',
 'found footage, VHS aesthetic, security camera, analog horror, lo-fi, grainy',
 'high quality, clean, professional, sharp, colorful, text, words, letters',
 '(found footage:1.2), (VHS grain:1.1), (surveillance camera:1.0)',
 60),

('surreal-nightmare', 
 'Surreal Nightmare', 
 '🌀',
 'Beksiński / H.R. Giger style. Impossible geometry, melting forms, biomechanical horror, dream logic. Subconscious terror made visible.',
 'horror',
 'Surrealist nightmare horror. Impossible geometry, melting forms, dream logic. Style of Zdzisław Beksiński, H.R. Giger, or Salvador Dali. Organic meets mechanical, disturbing and beautiful. Subconscious horror made visible.',
 'muted earth tones, sepia, burnt oranges, biomechanical grays',
 'surrealist art, nightmare imagery, biomechanical horror, Beksiński style, dreamlike, impossible architecture',
 'realistic, normal, cheerful, bright colors, cartoon, text, words, letters',
 '(surrealist:1.3), (nightmare imagery:1.2), (impossible geometry:1.1)',
 70),

('rnmort', 
 'RnMort (Cartoon Horror)', 
 '🧪',
 'Rick & Morty-inspired adult cartoon style. Bold thick outlines, flat cel shading, exaggerated proportions, vibrant colors against dark moody backgrounds.',
 'cartoon',
 'Adult animated cartoon illustration in the style of Rick and Morty. Bold thick black outlines on every character and object. Flat cel-shaded coloring with vibrant saturated hues. Exaggerated character proportions — large expressive heads, dot-like pupils, wide mouths. Dark horror atmosphere but rendered in colorful cartoon style. Fluid organic shapes, slightly wobbly linework for hand-drawn feel.',
 'vibrant saturated cartoon colors, neon greens and purples for sci-fi elements, warm skin tones, deep moody backgrounds with bright character colors, teal and pink accent lighting',
 'adult cartoon, cel shading, bold black outlines, flat color fills, exaggerated anatomy, large expressive eyes with dot pupils, hand-drawn aesthetic, Rick and Morty style, animated series quality',
 'photorealism, photography, DSLR, camera, realistic, oil painting, watercolor, 3D render, CGI, anime, manga, chibi, text, words, letters, symbols',
 '(adult cartoon:1.3), (bold black outlines:1.2), (cel shading:1.2), (flat colors:1.1), (exaggerated proportions:1.1)',
 80),

-- ═══════════════════════════════════════════════════
-- SPECIAL STYLES (with style protection rules)
-- ═══════════════════════════════════════════════════

('uncanny-illustrated', 
 'Uncanny Illustrated', 
 '👁️',
 'Editorial cartoon meets VHS horror. Cel-shaded with bold ink outlines, flat colors, posterized tones. Uncanny faces — smiles too wide, eyes too empty.',
 'horror',
 'Editorial cartoon illustration in graphic novel style. Cel-shaded horror scene with bold black ink outlines. Flat shading with VARIED color palette. Posterized tones like a vintage comic panel. Faces are uncanny - smiles too wide, eyes too white and empty, proportions slightly wrong. Cursed animated frame aesthetic. Lo-fi cartoon horror like a lost VHS recording of a cartoon. Characters have thick outlines and simplified but disturbing features. Use WARM NATURAL skin tones and VARIED clothing colors.',
 'COLOR PALETTE: warm natural skin tones (peach, tan, brown), varied clothing colors (reds, blues, greens, oranges, yellows, browns), rich environment colors. Characters should have DISTINCT colored clothing. Night scenes use deep blues and warm interior lighting. Subtle VHS chromatic aberration on edges only. Flat color fills with bold color contrast.',
 'editorial cartoon, graphic novel panel, cel shading, bold ink outlines, flat shading, posterized, slight halftone texture, VHS scanlines, chromatic aberration RGB edge split, analog noise, lo-fi horror cartoon, thick black outlines, simplified shapes',
 'painterly realism, oil painting, watercolor, photorealism, cinematic, DSLR, film still, realistic skin texture, realistic skin pores, professional photography, photograph, camera, bokeh, lens flare, depth of field, studio lighting, natural lighting, smooth gradients, soft blending, airbrushed, hyper-detailed, 4K, high definition, movie screenshot, portrait photography, monochrome, grayscale, desaturated, washed out colors, gray skin, blue skin, green skin, text, words, letters',
 '(editorial cartoon:1.3), (cel shading:1.2), (bold ink outlines:1.2), (VHS aesthetic:1.1)',
 85),

-- ═══════════════════════════════════════════════════
-- EDITORIAL / NON-HORROR STYLES (DecideThisDaily)
-- ═══════════════════════════════════════════════════

('editorial-clean', 
 'Clean Editorial Photography', 
 '📸',
 'Magazine-quality documentary photography. Sharp focus, balanced neutral tones, warm and readable with a hint of tension.',
 'editorial',
 'Clean modern editorial photography. Sharp focus, balanced neutral tones, documentary-style framing, everyday realism with cinematic composition. Magazine-quality imagery with a hint of tension. Professional commercial photography, warm and readable.',
 'warm neutrals — cream, khaki, soft gray, muted gold accents, selective amber for tension, clean whites, desaturated but warm',
 'editorial photography, documentary style, magazine quality, sharp focus, clean composition, balanced lighting, modern real-world',
 'horror, dark, creepy, supernatural, monsters, blood, VHS, film grain, A24 horror, unsettling, dark forest, analog artifacts, text, words, letters',
 '(editorial photography:1.2), (clean composition:1.1), (balanced lighting:1.0)',
 90),

('surreal-contemplative', 
 'Surreal Contemplative Art', 
 '✨',
 'Dreamlike atmospheric compositions with soft painterly edges. Ethereal and otherworldly but grounded in emotion. Conceptual photography meets magical realism.',
 'editorial',
 'Surreal contemplative digital art. Dreamlike atmospheric compositions with soft painterly edges meeting sharp focal points. Ethereal and otherworldly but grounded in emotion. Conceptual art photography meets magical realism. Volumetric light and atmospheric haze, premium gallery-quality imagery.',
 'deep indigo base, warm amber and gold accents, muted purple twilight, teal-to-copper gradients, soft rose highlights, occasional golden sunlight',
 'surreal art, contemplative, dreamlike, ethereal, volumetric lighting, magical realism, conceptual photography, gallery quality',
 'horror, dark, creepy, monsters, blood, VHS, film grain, A24 horror, unsettling faces, jump scares, dark forest, analog artifacts, text, words, letters',
 '(surreal art:1.3), (dreamlike:1.2), (volumetric lighting:1.1)',
 91),

('cinematic-contrast', 
 'High-Contrast Cinematic Photography', 
 '🎭',
 'Bold dramatic compositions with vivid split-tone color grading. Theatrical lighting, architectural symmetry meets human drama.',
 'editorial',
 'High-contrast cinematic photography. Bold dramatic compositions, vivid split-tone color grading, sharp depth of field, powerful visual metaphors. Premium editorial quality, architectural symmetry meets human drama, theatrical lighting design.',
 'bold complementary contrasts — warm gold vs cool sapphire, organic amber vs synthetic steel blue, vivid saturated opposing primaries, split-tone grading',
 'cinematic contrast, split-tone, theatrical lighting, bold composition, high contrast, editorial, architectural symmetry, dramatic',
 'horror, supernatural, VHS, film grain, monsters, blood, A24 horror, dark forest, desaturated, creepy, unsettling, analog artifacts, text, words, letters',
 '(cinematic contrast:1.3), (theatrical lighting:1.2), (split-tone:1.1)',
 92),

-- ═══════════════════════════════════════════════════
-- GENERIC FALLBACK STYLES (ComfyUI-only + base fallback)
-- ═══════════════════════════════════════════════════

('cinematic', 
 'Cinematic Photography', 
 '🎥',
 'General cinematic photography with dramatic compositions, balanced lighting, and film-quality aesthetic.',
 'general',
 'Cinematic photography, dramatic compositions, balanced lighting, film-quality aesthetic.',
 NULL,
 'cinematic photography, balanced lighting, dramatic',
 'cartoon, anime, text, words, letters',
 '(cinematic lighting:1.3)',
 95),

('horror', 
 'Dark Horror', 
 '👻',
 'Generic dark horror atmosphere with deep shadows.',
 'general',
 'Dark horror atmosphere. Deep shadows, unsettling mood, ominous lighting.',
 'dark shadows, muted colors, deep blacks',
 'dark horror, atmospheric, ominous',
 'bright colors, cheerful, cartoon, text, words, letters',
 '(dark horror atmosphere:1.2), (shadows:1.1)',
 96),

('noir', 
 'Film Noir', 
 '🕵️',
 'Classic film noir with high contrast black and white aesthetic.',
 'general',
 'Film noir photography. High contrast, dramatic shadows, detective/mystery atmosphere.',
 'high contrast black and white, deep shadows, silver highlights',
 'film noir, high contrast, dramatic shadows, mystery',
 'bright colors, cheerful, cartoon, anime, text, words, letters',
 '(film noir:1.3), (high contrast:1.2)',
 97),

('documentary', 
 'Documentary Photography', 
 '📷',
 'Naturalistic documentary-style photography with authentic feel.',
 'general',
 'Documentary photography. Naturalistic, authentic feel, real-world compositions.',
 'natural colors, balanced exposure, authentic tones',
 'documentary photography, naturalistic, authentic',
 'fantasy, supernatural, cartoon, anime, text, words, letters',
 '(documentary photography:1.2), (naturalistic:1.1)',
 98)

ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  icon = EXCLUDED.icon,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  base_prompt = EXCLUDED.base_prompt,
  color_override = EXCLUDED.color_override,
  technical_style = EXCLUDED.technical_style,
  negative_prompt = EXCLUDED.negative_prompt,
  comfyui_tokens = EXCLUDED.comfyui_tokens,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- Now add the style protection rules for uncanny-illustrated
UPDATE art_styles SET
  banned_tokens = ARRAY[
    'photography', 'photographic', 'photograph', 'photo',
    'DSLR', 'camera', 'lens', 'bokeh', 'depth of field',
    'film still', 'movie screenshot', 'movie still',
    'professional cinematography', 'realistic skin texture', 'realistic skin pores',
    'cinematic dark photography', 'portrait photography', 'studio lighting',
    'cinematic', 'cinematography', 'cinematographer',
    'film noir', 'film noir lighting', 'noir lighting',
    'painterly realism', 'painterly', 'oil painting', 'watercolor',
    'digital painting', 'soft brush', 'airbrushed', 'smooth blending',
    'photorealistic', 'photoreal', 'photo-realistic', 'hyper-realistic',
    'realistic lighting', 'natural lighting'
  ],
  style_replacement = ARRAY[
    'editorial cartoon illustration',
    'graphic novel panel style',
    'cel shading with flat colors',
    'bold black ink outlines',
    'limited color palette',
    'posterized tones',
    'VHS scanlines overlay',
    'chromatic aberration RGB split',
    'analog noise texture',
    'lo-fi horror cartoon aesthetic'
  ],
  texture_replacement = '{
    "film grain": "halftone texture",
    "film_grain": "halftone texture",
    "vignette heavy": "paper grain vignette",
    "vignette_heavy": "paper grain vignette",
    "fog bloom": "soft glow",
    "fog_bloom": "soft glow",
    "dust scratches": "analog noise",
    "dust_scratches": "analog noise"
  }'::jsonb
WHERE id = 'uncanny-illustrated';

-- =============================================================================
-- HELPER RPC: Get all active art styles (for frontend + worker)
-- =============================================================================
CREATE OR REPLACE FUNCTION get_art_styles()
RETURNS SETOF art_styles
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT * FROM art_styles
  WHERE is_active = true
  ORDER BY sort_order ASC, name ASC;
$$;

-- Grant execute to anon (frontend needs it)
GRANT EXECUTE ON FUNCTION get_art_styles() TO anon;
GRANT EXECUTE ON FUNCTION get_art_styles() TO service_role;
