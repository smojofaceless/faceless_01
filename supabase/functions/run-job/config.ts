// =====================================================
// CONFIGURATION & TYPES
// =====================================================

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
};

// ElevenLabs voice
export const ELEVENLABS_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam

// Story length targets (approximate word counts for target durations)
// ~150 words per minute for narration
export const LENGTH_CONFIG: Record<string, { minWords: number; maxWords: number; targetSeconds: number }> = {
  "30": { minWords: 65, maxWords: 80, targetSeconds: 30 },
  "45": { minWords: 95, maxWords: 115, targetSeconds: 45 },
  "60": { minWords: 130, maxWords: 155, targetSeconds: 60 },
  "90": { minWords: 200, maxWords: 230, targetSeconds: 90 },
  "120": { minWords: 270, maxWords: 310, targetSeconds: 120 },
};

// Vibe prompts
export const VIBE_CONFIG: Record<string, string> = {
  slow_creepy: "slow building dread, atmospheric, unsettling ending",
  punchy_shock: "fast-paced, shocking twist, punchy ending",
  atmospheric: "moody, descriptive, lingering unease",
  urban_legend: "faux true-crime documentary, presented as a real unsolved event, factual tone",
};

// =====================================================
// ART STYLE CONFIGURATIONS FOR DALL-E
// =====================================================
export interface ArtStyleConfig {
  name: string;
  basePrompt: string;
  colorOverride: string;
  technicalStyle: string;
  negativePrompt: string;
}

export const ART_STYLE_CONFIG: Record<string, ArtStyleConfig> = {
  "cinematic-dark": {
    name: "Cinematic Dark Photography",
    basePrompt: "Cinematic dark photography. Moody desaturated colors, deep shadows, film grain, A24 horror film aesthetic. Realistic but atmospheric, shallow depth of field, dramatic lighting.",
    colorOverride: "muted colors, deep shadows, film grain, desaturated with selective color",
    technicalStyle: "cinematic horror, film grain, shallow depth of field, realistic lighting, professional photography",
    negativePrompt: "cartoon, anime, illustration, bright colors, cheerful, text, words, letters, symbols",
  },
  "analog-horror": {
    name: "Analog Horror / VHS Glitch",
    basePrompt: "Dark analog horror image with heavy VHS static, glitch artifacts, scanlines, and digital noise distorting the scene. Figures are mostly obscured by shadow with possible glowing eyes or unnatural grins barely visible. Low exposure, eerie dim lighting, muted washed-out colors. Deeply unsettling atmosphere, psychological horror, found-footage style with slow flickering shadows. The feeling of something wrong captured on an old camera.",
    colorOverride: "washed out colors, VHS grain, digital artifacts, scanlines, low exposure, muted greens and grays",
    technicalStyle: "analog horror, VHS aesthetic, glitch art, scanlines, digital noise, found footage, surveillance camera, lo-fi horror",
    negativePrompt: "high quality, clean, professional, sharp, colorful, cartoon, anime, bright, text, words, letters",
  },
  "editorial-cartoon": {
    name: "Editorial Cartoon / Satirical Comic",
    basePrompt: "Editorial cartoon illustration in a modern web-comic style. Clean, bold linework with smooth confident outlines. Semi-flat digital coloring with soft gradients and minimal texture. Slightly exaggerated proportions designed for satire and storytelling. Exaggerated facial expressions with large expressive eyes. The mood is satirical, ironic, and slightly unsettling but humorous.",
    colorOverride: "saturated but controlled color palette, clean digital colors, soft gradients, no painterly texture",
    technicalStyle: "editorial cartoon, satirical comic illustration, modern digital comic, bold outlines, clean vector-style shading, web animation ready",
    negativePrompt: "photorealism, oil painting, watercolor, anime style, sketchy lines, hyper realism, grainy noise, blurry edges, text, words, letters",
  },
  "horror-anime": {
    name: "Dark Anime / Manga Style",
    basePrompt: "Dark anime horror illustration. Detailed manga-style linework with heavy cross-hatching for shadows. Dramatic poses, expressive characters, atmospheric horror lighting. Style of Junji Ito or Berserk manga. High contrast black and white with occasional color accents.",
    colorOverride: "high contrast, dramatic blacks, selective color accents, manga shading",
    technicalStyle: "dark anime, horror manga, detailed linework, dramatic lighting, Japanese horror aesthetic",
    negativePrompt: "cute, chibi, kawaii, bright happy colors, simple cartoon, text, words, letters",
  },
  "oil-painting": {
    name: "Classic Oil Painting",
    basePrompt: "Classic oil painting horror art. Renaissance masters meets dark romanticism. Rich textures, dramatic chiaroscuro lighting, painterly brushstrokes. Style of Caravaggio, Goya's Black Paintings, or John Martin. Moody and timeless.",
    colorOverride: "rich deep colors, warm shadows, golden highlights, classical palette",
    technicalStyle: "oil painting, fine art, chiaroscuro, baroque lighting, museum quality, painterly brushstrokes",
    negativePrompt: "digital art, cartoon, anime, modern, photography, text, words, letters",
  },
  "found-footage": {
    name: "Found Footage / Grainy",
    basePrompt: "Found footage horror aesthetic. Grainy VHS quality, security camera look, analog distortion. Night vision green or washed out colors. Unsettling surveillance feel, as if captured by accident. Blair Witch Project aesthetic.",
    colorOverride: "washed out colors, VHS grain, night vision green, analog artifacts",
    technicalStyle: "found footage, VHS aesthetic, security camera, analog horror, lo-fi, grainy",
    negativePrompt: "high quality, clean, professional, sharp, colorful, text, words, letters",
  },
  "surreal-nightmare": {
    name: "Surreal Nightmare",
    basePrompt: "Surrealist nightmare horror. Impossible geometry, melting forms, dream logic. Style of Zdzisław Beksiński, H.R. Giger, or Salvador Dali. Organic meets mechanical, disturbing and beautiful. Subconscious horror made visible.",
    colorOverride: "muted earth tones, sepia, burnt oranges, biomechanical grays",
    technicalStyle: "surrealist art, nightmare imagery, biomechanical horror, Beksiński style, dreamlike, impossible architecture",
    negativePrompt: "realistic, normal, cheerful, bright colors, cartoon, text, words, letters",
  },
};

// =====================================================
// TYPES
// =====================================================

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface AudioResult {
  audioUrl: string;
  timestamps: WordTimestamp[];
  durationMs: number;
}

export interface StoryScene {
  text: string;
  startTime: number;
  endTime: number;
  keywords: string[];
  videoUrl?: string;
}

export interface StoryAnchor {
  // Legacy fields (kept for compatibility)
  environment: string;
  colorPalette: string;
  cameraStyle: string;
  horrorTone: string;
  timeOfDay: string;
  recurringMotifs: string;
  characterDescription: string | null;
  continuityRules: string;
  fullAnchorPrompt: string;
  
  // Legacy fields (alternate names for compatibility)
  setting?: string;
  weatherMood?: string;
  protagonistDescription?: string;
  
  // Structured anchors
  contentAnchor?: ContentAnchor;
  styleAnchor?: StyleAnchor;
  characterLock?: CharacterLock;
}

/**
 * Character Lock - ensures same face/outfit across ALL scenes
 */
export interface CharacterLock {
  id: string;           // stable hash like "char_8f3a"
  face: string;         // hair color/style, eye color, skin tone, age range, facial features
  outfit: string;       // exact clothing description
  silhouette: string;   // body type, height, build
  doNotChange: string[];// list of things that must stay constant
  // Legacy fields
  physicalTraits?: string;
  clothing?: string;
  distinguishingFeatures?: string;
  emotionalBaseline?: string;
}

/**
 * Content Anchor - WHAT is in the scene (no style info)
 */
export interface ContentAnchor {
  environment: string;      // physical setting, pure description
  props: string;            // objects in scene
  recurringMotifs: string;  // visual elements to repeat
  continuityRules: string;  // rules for consistency
  timeOfDay: string;        // lighting time
  characterLock: CharacterLock | null;
}

/**
 * Style Anchor - HOW it looks (rendering style only)
 */
export interface StyleAnchor {
  name: string;
  renderStyle: string;      // art style description
  colorPalette: string;     // color rules
  technique: string;        // rendering technique
  negativePrompt: string;   // things to avoid
}

export interface VisualBeat {
  sceneIndex: number;
  visualBeat: string;
  cameraAngle: string;
  focus: string;
  moodLevel: number;
  // Horror-specific rules
  mirrorBehavior?: string;  // "reflection lags", "reflection smiles", etc
  realityRule?: string;     // "door is locked", "hallway extends infinitely"
  compositionHint?: string; // "centered", "rule of thirds", etc
  // Visual contract (filled by createSceneVisualContracts)
  visualContract?: SceneVisualContract;
}

export interface SceneVisualContract {
  sceneIndex: number;
  location: string;              // exact physical place (bedroom, bathroom, hallway)
  characterPose: string;         // what the body is doing (sitting, standing, running)
  facialExpression: string;      // visible emotion (fear, confusion, shock)
  visibleObjects: string[];      // MUST be present in image
  supernaturalElement: string | null;  // the horror element, if any
  cameraDistance: "extreme-close-up" | "close-up" | "medium" | "wide";
  lightingSource: string;        // where light comes from
  actionFrozen: string;          // the exact moment captured
  // Anti-drift fields
  forbiddenElements: string[];   // "stairs", "hallway", "extra people" - things that MUST NOT appear
  continuityFromPrev: string;    // "same bedroom as scene 1", "same outfit" - link to previous
  evidenceRule: string;          // "shadows must be visible on bedroom wall" - proof the scene is correct
  continuityLock?: string;       // Legacy field for compatibility
}

export interface VideoOptions {
  // Transitions
  fadeIn: boolean;
  fadeOut: boolean;
  transitions: boolean;
  // Disturbance & Glitch
  glitchFlicker: boolean;
  vhsTracking: boolean;
  scanlines: boolean;
  filmGrain: boolean;
  // Atmospheric
  kenburns: boolean;
  filter: boolean;  // horror color grading
  vignette: boolean;
  lightFlicker: boolean;
  coldColorCreep: boolean;
  // Psychological
  heartbeatZoom: boolean;
  negativeFlash: boolean;
  edgeDarkeningCreep: boolean;
  // Audio
  music: boolean;
  musicTrack: string;  // filename in storage, e.g. "dark-ambient.mp3"
  musicVolume: number; // 0-100 percentage
  sfx: boolean;
  // Captions
  captionStyle: string;
  highlightScary: boolean;
}

// Caption styles for video assembly (10 styles)
export const CAPTION_STYLES: Record<string, any> = {
  bold: {
    font_family: "Impact",
    font_weight: "900",
    font_size: "8 vmin",
    color: "#FFFFFF",
  },
  horror: {
    font_family: "Times New Roman",
    font_weight: "700",
    font_size: "8 vmin",
    font_style: "italic",
    color: "#DC2626",
  },
  glitch: {
    font_family: "Impact",
    font_weight: "400",
    font_size: "8 vmin",
    color: "#00FFFF",
  },
  minimal: {
    font_family: "Arial",
    font_weight: "400",
    font_size: "7 vmin",
    color: "#E5E7EB",
  },
  neon: {
    font_family: "Arial",
    font_weight: "900",
    font_size: "8 vmin",
    color: "#F0ABFC",
  },
  vintage: {
    font_family: "Georgia",
    font_weight: "400",
    font_size: "7 vmin",
    color: "#FEF3C7",
  },
  blood: {
    font_family: "Impact",
    font_weight: "900",
    font_size: "8 vmin",
    color: "#7F1D1D",
  },
  typewriter: {
    font_family: "Courier New",
    font_weight: "400",
    font_size: "7 vmin",
    color: "#D1D5DB",
  },
  shadow: {
    font_family: "Arial",
    font_weight: "900",
    font_size: "8 vmin",
    color: "#FFFFFF",
  },
  comic: {
    font_family: "Comic Sans MS",
    font_weight: "700",
    font_size: "8 vmin",
    color: "#FBBF24",
  },
};

// Keyword mapping for visual presets (fallbacks)
export const VISUAL_KEYWORDS: Record<string, string[]> = {
  forest: ["dark forest", "misty woods", "foggy trees", "night forest"],
  hallway: ["dark hallway", "abandoned corridor", "creepy hallway", "dark passage"],
  attic: ["dusty attic", "abandoned room", "old house interior", "dark room"],
  foggy: ["thick fog", "misty atmosphere", "fog rolling", "eerie mist"],
  rain: ["rain drops", "rainy night", "storm rain", "dark rain"],
};

// Scary words to highlight in captions
export const SCARY_WORDS = new Set([
  "dead", "death", "die", "dying", "kill", "killed", "murder", "blood", "scream", "screaming",
  "fear", "terror", "horror", "nightmare", "demon", "ghost", "monster", "creature", "evil",
  "dark", "darkness", "shadow", "shadows", "whisper", "whispers", "haunted", "cursed",
  "grave", "corpse", "body", "flesh", "bone", "bones", "skull", "eyes", "watching",
  "behind", "door", "basement", "attic", "mirror", "reflection", "breathing", "footsteps",
  "alone", "trapped", "escape", "run", "hide", "follow", "followed", "stalking",
]);

// Deterministic mood level to descriptor mapping
export const MOOD_DESCRIPTORS: Record<number, string> = {
  1: "eerie stillness, subtle wrongness in the atmosphere",
  2: "quiet unease, something slightly off but hard to pinpoint",
  3: "creeping anxiety, shadows seem to shift at the edges",
  4: "growing dread, tension building in every frame",
  5: "mounting fear, the threat feels closer now",
  6: "palpable terror, danger is unmistakably present",
  7: "intense horror, the nightmare is unfolding",
  8: "visceral fear, escape seems impossible",
  9: "peak terror, the horror is fully revealed",
  10: "overwhelming cosmic dread, nightmare beyond comprehension",
};

// ORIENTATION LOCK (simplified - no forced symmetry to avoid hallway/stair bias)
export const ORIENTATION_LOCK = `ORIENTATION LOCK:
Upright portrait 9:16, not rotated.
Top=ceiling/sky, bottom=floor/ground.
No dutch angle. No tilted horizon.`;

// Terms that contaminate custom styles (RENDERING keywords only, not horror tone words)
export const FORBIDDEN_STYLE_TERMS = [
  "cinematic", "film grain", "depth of field", "dof", "bokeh",
  "photoreal", "photo-real", "photorealistic", "dslr", "macro", "ultra detailed",
  "noir", "graphic novel", "crosshatch", "crosshatching", "engraving", "etching",
  "realistic lighting", "dramatic lighting", "moody lighting",
  "ink shading", "hatching", "stippling", "woodcut",
  "concept art", "matte painting", "digital painting",
  "volumetric", "ray tracing", "subsurface scattering",
  "unreal engine", "octane render", "artstation",
];

// =====================================================
// HELPER: Update job status
// =====================================================

// Safer than stale merges: always fetch fresh job before writing
// Includes retry logic for transient database failures
export async function getFreshJob(supabase: any, jobId: string): Promise<any> {
  let lastError: any = null;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await supabase.from("jobs").select("*").eq("id", jobId).single();
    
    if (data) {
      return data;
    }
    
    lastError = error;
    if (attempt < 3) {
      console.log(`[getFreshJob] Attempt ${attempt} failed, retrying in 300ms...`);
      await new Promise(r => setTimeout(r, 300));
    }
  }
  
  throw new Error(`getFreshJob failed: ${lastError?.message || "not found"}`);
}

export async function updateJob(supabase: any, jobId: string, updates: any): Promise<void> {
  try {
    const { error } = await supabase
      .from("jobs")
      .update(updates)
      .eq("id", jobId);
    
    if (error) {
      console.error("[updateJob] Failed:", error);
      throw new Error(`updateJob failed: ${error.message || JSON.stringify(error)}`);
    }
  } catch (networkError: any) {
    // Handle network errors (e.g., edge function being killed, timeout)
    // These often return HTML error pages from Cloudflare
    const errorStr = String(networkError);
    if (errorStr.includes('<html>') || errorStr.includes('500') || errorStr.includes('timeout')) {
      console.error("[updateJob] Network/timeout error (edge function may be terminating):", errorStr.substring(0, 200));
      // Re-throw with cleaner message
      throw new Error(`updateJob network error - edge function may have timed out`);
    }
    throw networkError;
  }
}

// Merge patch into fresh meta (prevents stale overwrites)
// Accepts either a patch object or a callback function: (currentMeta) => newMeta
export async function updateJobMeta(
  supabase: any, 
  jobId: string, 
  patchOrFn: Record<string, any> | ((meta: Record<string, any>) => Record<string, any>)
): Promise<Record<string, any>> {
  const job = await getFreshJob(supabase, jobId);
  const meta = job.meta || {};
  
  // Support both object patch and callback function
  const merged = typeof patchOrFn === "function" 
    ? patchOrFn(meta) 
    : { ...meta, ...patchOrFn };
  
  await updateJob(supabase, jobId, { meta: merged });
  return merged;
}

// =====================================================
// STYLE HELPER FUNCTIONS
// =====================================================

/**
 * Strip forbidden style terms from anchor/beat text
 */
export function stripForbiddenStyleTerms(input: string): string {
  let out = input;
  for (const term of FORBIDDEN_STYLE_TERMS) {
    out = out.replace(new RegExp(term, "gi"), "");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * Rewrite content to be pure description (no style language)
 * This is a deterministic rule-based approach for common presets
 */
export function rewriteToContentOnly(input: string, _preset: string): string {
  // First strip forbidden terms
  let content = stripForbiddenStyleTerms(input);
  
  // Common style-to-content mappings
  const rewrites: [RegExp, string][] = [
    // Lighting style -> physical description
    [/dramatic\s*lighting/gi, "strong shadows, single light source"],
    [/moody\s*lighting/gi, "dim ambient light"],
    [/atmospheric\s*lighting/gi, "diffused light"],
    [/harsh\s*lighting/gi, "bright overhead light, hard shadows"],
    
    // Camera style -> physical framing
    [/cinematic\s*shot/gi, "wide view"],
    [/establishing\s*shot/gi, "full scene view"],
    [/hero\s*shot/gi, "subject centered"],
    
    // Mood -> physical indicators
    [/eerie\s*atmosphere/gi, "still air, no movement"],
    [/tense\s*atmosphere/gi, "frozen moment"],
    [/dread/gi, "stillness"],
    [/terror/gi, "frozen pose"],
    
    // Abstract -> concrete
    [/sense\s*of\s*\w+/gi, ""],
    [/feeling\s*of\s*\w+/gi, ""],
  ];
  
  for (const [pattern, replacement] of rewrites) {
    content = content.replace(pattern, replacement);
  }
  
  return content.replace(/\s{2,}/g, " ").trim();
}

/**
 * Determine which image model to use
 * Priority: job meta > environment variable > default
 * - dall-e-3: High quality, $0.12/image
 * - gpt-4o: Good quality, ~$0.03/image (75% cheaper) - default
 * - flux: FLUX.1 Pro/Redux via Replicate, ~$0.04/image + reference conditioning
 */
export function getImageModel(jobModel?: string): "dall-e-3" | "gpt-4o" | "flux" {
  // First check job-specific setting
  if (jobModel) {
    if (jobModel === "dall-e-3" || jobModel === "dalle-3" || jobModel === "dalle") {
      return "dall-e-3";
    }
    if (jobModel === "gpt-4o" || jobModel === "gpt-image-1") {
      return "gpt-4o";
    }
    if (jobModel === "flux" || jobModel === "replicate") {
      return "flux";
    }
  }
  
  // Fall back to environment variable
  const model = Deno.env.get("IMAGE_MODEL");
  if (model === "gpt-4o" || model === "gpt-image-1") {
    return "gpt-4o";
  }
  if (model === "flux" || model === "replicate") {
    return "flux";
  }
  if (model === "dall-e-3" || model === "dalle-3" || model === "dalle") {
    return "dall-e-3";
  }
  // Default to GPT-4o for balanced cost/quality
  return "gpt-4o";
}
