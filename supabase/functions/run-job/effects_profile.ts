/**
 * Effects Profile System v1.0
 * 
 * Configurable video effects with intensity controls.
 * Each effect supports 0-1 intensity (0=off, 1=max).
 * 
 * Flow:
 * 1. User selects vibe_preset/art_style
 * 2. System looks up preset's default effects_profile
 * 3. User can override via UI (advanced settings)
 * 4. Final profile = merge(system_defaults, preset_defaults, user_overrides)
 * 5. Profile passed to FFmpeg renderer
 */

// =====================================================
// TYPE DEFINITIONS
// =====================================================

export interface EffectConfig {
  enabled: boolean;
  intensity: number; // 0.0 - 1.0
}

export interface TransitionConfig extends EffectConfig {
  type: "crossfade" | "cut" | "dissolve" | "wipe" | "dip_black";
  duration: number; // seconds (0.1 - 2.0)
}

export interface KenBurnsConfig extends EffectConfig {
  zoom_amount: number; // 1.0 - 1.5 (1.0 = no zoom, 1.5 = 50% zoom)
  speed: number; // 0.0 - 1.0 (affects motion speed)
  direction: "in" | "out" | "random" | "alternating";
}

export interface ColorGradeConfig extends EffectConfig {
  preset: string; // "horror_cold", "warm", "noir", "vibrant", "sepia", "custom"
  contrast: number; // 0.5 - 2.0 (1.0 = neutral)
  saturation: number; // 0.0 - 2.0 (1.0 = neutral)
  brightness: number; // 0.5 - 1.5 (1.0 = neutral)
  temperature: number; // -1.0 to 1.0 (-1 = cold blue, 1 = warm orange)
}

export interface VignetteConfig extends EffectConfig {
  radius: number; // 0.0 - 1.0 (how far from center)
  softness: number; // 0.0 - 1.0 (edge softness)
}

export interface FilmGrainConfig extends EffectConfig {
  size: number; // 0.5 - 2.0 (grain particle size)
  color: boolean; // color noise vs monochrome
}

export interface ScanlinesConfig extends EffectConfig {
  spacing: number; // 1 - 4 (pixels between lines)
  thickness: number; // 0.5 - 2.0 (line thickness)
  flicker: boolean; // whether lines flicker
}

export interface VHSConfig extends EffectConfig {
  tracking_noise: number; // 0.0 - 1.0
  color_bleed: number; // 0.0 - 1.0
  tape_crinkle: number; // 0.0 - 1.0
  jitter: number; // 0.0 - 1.0 (horizontal jitter)
}

export interface GlitchConfig extends EffectConfig {
  frequency: number; // 0.0 - 1.0 (how often glitches occur)
  duration: number; // 0.0 - 1.0 (how long each glitch lasts)
  rgb_shift: number; // 0.0 - 1.0 (chromatic aberration amount)
  block_shift: boolean; // whether to include block displacement
}

export interface FadeConfig {
  fade_in: boolean;
  fade_in_duration: number; // seconds (0.0 - 3.0)
  fade_out: boolean;
  fade_out_duration: number; // seconds (0.0 - 3.0)
}

export interface LightFlickerConfig extends EffectConfig {
  frequency: number; // 0.0 - 1.0 (flicker rate)
  variation: number; // 0.0 - 1.0 (brightness variation)
}

export interface EdgeDarkenConfig extends EffectConfig {
  creep_speed: number; // 0.0 - 1.0 (how fast darkness creeps in)
}

// Main effects profile structure
export interface EffectsProfile {
  version: string;
  schema_version?: number; // For migration support
  preset_source?: string; // which preset this came from
  
  // Transitions
  transitions: TransitionConfig;
  
  // Motion
  kenburns: KenBurnsConfig;
  
  // Color & Lighting
  color_grade: ColorGradeConfig;
  vignette: VignetteConfig;
  light_flicker: LightFlickerConfig;
  
  // Texture
  film_grain: FilmGrainConfig;
  scanlines: ScanlinesConfig;
  
  // Disturbance
  vhs: VHSConfig;
  glitch: GlitchConfig;
  
  // Fades
  fade: FadeConfig;
  
  // Psychological
  edge_darken: EdgeDarkenConfig;
  heartbeat_zoom: EffectConfig;
  negative_flash: EffectConfig;
}

// =====================================================
// SYSTEM DEFAULTS
// =====================================================

// Current schema version - increment when making breaking changes
export const SCHEMA_VERSION = 1;

// Known effect keys for sanitization (drop unknown keys)
const KNOWN_EFFECT_KEYS = new Set([
  'version', 'schema_version', 'preset_source',
  'transitions', 'kenburns', 'color_grade', 'vignette', 'light_flicker',
  'film_grain', 'scanlines', 'vhs', 'glitch', 'fade', 'edge_darken',
  'heartbeat_zoom', 'negative_flash'
]);

export const SYSTEM_DEFAULTS: EffectsProfile = {
  version: "1.0",
  schema_version: SCHEMA_VERSION,
  
  transitions: {
    enabled: true,
    intensity: 0.7,
    type: "crossfade",
    duration: 0.5,
  },
  
  kenburns: {
    enabled: true,
    intensity: 0.6,
    zoom_amount: 1.12,
    speed: 0.5,
    direction: "random",
  },
  
  color_grade: {
    enabled: true,
    intensity: 0.5,
    preset: "cinematic",
    contrast: 1.1,
    saturation: 0.9,
    brightness: 1.0,
    temperature: 0,
  },
  
  vignette: {
    enabled: true,
    intensity: 0.5,
    radius: 0.8,
    softness: 0.5,
  },
  
  light_flicker: {
    enabled: false,
    intensity: 0.3,
    frequency: 0.2,
    variation: 0.15,
  },
  
  film_grain: {
    enabled: false,
    intensity: 0.3,
    size: 1.0,
    color: false,
  },
  
  scanlines: {
    enabled: false,
    intensity: 0.3,
    spacing: 2,
    thickness: 1.0,
    flicker: false,
  },
  
  vhs: {
    enabled: false,
    intensity: 0.5,
    tracking_noise: 0.3,
    color_bleed: 0.4,
    tape_crinkle: 0.2,
    jitter: 0.2,
  },
  
  glitch: {
    enabled: false,
    intensity: 0.4,
    frequency: 0.1,
    duration: 0.3,
    rgb_shift: 0.3,
    block_shift: false,
  },
  
  fade: {
    fade_in: true,
    fade_in_duration: 0.5,
    fade_out: true,
    fade_out_duration: 0.5,
  },
  
  edge_darken: {
    enabled: false,
    intensity: 0.4,
    creep_speed: 0.3,
  },
  
  heartbeat_zoom: {
    enabled: false,
    intensity: 0.3,
  },
  
  negative_flash: {
    enabled: false,
    intensity: 0.5,
  },
};

// =====================================================
// PRESET EFFECTS PROFILES
// =====================================================

/**
 * Map vibe_preset / art_style to effects profile overrides
 */
export const PRESET_EFFECTS_PROFILES: Record<string, Partial<EffectsProfile>> = {
  // Slow, creepy, atmospheric
  slow_creepy: {
    preset_source: "slow_creepy",
    kenburns: {
      enabled: true,
      intensity: 0.5,
      zoom_amount: 1.08,
      speed: 0.3,
      direction: "in",
    },
    color_grade: {
      enabled: true,
      intensity: 0.7,
      preset: "horror_cold",
      contrast: 1.15,
      saturation: 0.7,
      brightness: 0.95,
      temperature: -0.3,
    },
    vignette: {
      enabled: true,
      intensity: 0.7,
      radius: 0.7,
      softness: 0.4,
    },
    film_grain: {
      enabled: true,
      intensity: 0.25,
      size: 1.0,
      color: false,
    },
  },
  
  // Analog horror / VHS aesthetic
  analog_horror: {
    preset_source: "analog_horror",
    transitions: {
      enabled: true,
      intensity: 0.6,
      type: "dip_black",
      duration: 0.3,
    },
    kenburns: {
      enabled: true,
      intensity: 0.4,
      zoom_amount: 1.06,
      speed: 0.4,
      direction: "random",
    },
    color_grade: {
      enabled: true,
      intensity: 0.8,
      preset: "vhs_degraded",
      contrast: 1.1,
      saturation: 0.6,
      brightness: 0.98,
      temperature: 0.1,
    },
    vignette: {
      enabled: true,
      intensity: 0.6,
      radius: 0.75,
      softness: 0.6,
    },
    film_grain: {
      enabled: true,
      intensity: 0.5,
      size: 1.2,
      color: true,
    },
    scanlines: {
      enabled: true,
      intensity: 0.4,
      spacing: 2,
      thickness: 1.0,
      flicker: true,
    },
    vhs: {
      enabled: true,
      intensity: 0.6,
      tracking_noise: 0.4,
      color_bleed: 0.5,
      tape_crinkle: 0.3,
      jitter: 0.3,
    },
    glitch: {
      enabled: true,
      intensity: 0.4,
      frequency: 0.15,
      duration: 0.2,
      rgb_shift: 0.4,
      block_shift: true,
    },
  },
  
  // Found footage / Blair Witch style
  found_footage: {
    preset_source: "found_footage",
    kenburns: {
      enabled: true,
      intensity: 0.3,
      zoom_amount: 1.04,
      speed: 0.6,
      direction: "random",
    },
    color_grade: {
      enabled: true,
      intensity: 0.6,
      preset: "surveillance",
      contrast: 1.2,
      saturation: 0.5,
      brightness: 1.02,
      temperature: 0.2,
    },
    vignette: {
      enabled: true,
      intensity: 0.5,
      radius: 0.85,
      softness: 0.3,
    },
    film_grain: {
      enabled: true,
      intensity: 0.6,
      size: 1.3,
      color: false,
    },
    vhs: {
      enabled: true,
      intensity: 0.4,
      tracking_noise: 0.2,
      color_bleed: 0.3,
      tape_crinkle: 0.15,
      jitter: 0.25,
    },
    light_flicker: {
      enabled: true,
      intensity: 0.3,
      frequency: 0.15,
      variation: 0.2,
    },
  },
  
  // Urban legend / modern creepy
  urban_legend: {
    preset_source: "urban_legend",
    kenburns: {
      enabled: true,
      intensity: 0.6,
      zoom_amount: 1.1,
      speed: 0.5,
      direction: "alternating",
    },
    color_grade: {
      enabled: true,
      intensity: 0.6,
      preset: "cinematic_dark",
      contrast: 1.2,
      saturation: 0.8,
      brightness: 0.95,
      temperature: -0.15,
    },
    vignette: {
      enabled: true,
      intensity: 0.6,
      radius: 0.75,
      softness: 0.5,
    },
    film_grain: {
      enabled: true,
      intensity: 0.2,
      size: 0.8,
      color: false,
    },
    edge_darken: {
      enabled: true,
      intensity: 0.3,
      creep_speed: 0.2,
    },
  },
  
  // Psychological horror
  psychological: {
    preset_source: "psychological",
    kenburns: {
      enabled: true,
      intensity: 0.7,
      zoom_amount: 1.15,
      speed: 0.4,
      direction: "in",
    },
    color_grade: {
      enabled: true,
      intensity: 0.7,
      preset: "desaturated_cold",
      contrast: 1.25,
      saturation: 0.65,
      brightness: 0.92,
      temperature: -0.25,
    },
    vignette: {
      enabled: true,
      intensity: 0.8,
      radius: 0.65,
      softness: 0.4,
    },
    heartbeat_zoom: {
      enabled: true,
      intensity: 0.4,
    },
    negative_flash: {
      enabled: true,
      intensity: 0.3,
    },
    edge_darken: {
      enabled: true,
      intensity: 0.5,
      creep_speed: 0.4,
    },
  },
  
  // Cosmic horror / Lovecraftian
  cosmic_horror: {
    preset_source: "cosmic_horror",
    kenburns: {
      enabled: true,
      intensity: 0.5,
      zoom_amount: 1.1,
      speed: 0.3,
      direction: "out",
    },
    color_grade: {
      enabled: true,
      intensity: 0.8,
      preset: "cosmic_void",
      contrast: 1.3,
      saturation: 0.5,
      brightness: 0.88,
      temperature: -0.4,
    },
    vignette: {
      enabled: true,
      intensity: 0.85,
      radius: 0.6,
      softness: 0.5,
    },
    film_grain: {
      enabled: true,
      intensity: 0.35,
      size: 1.1,
      color: false,
    },
    glitch: {
      enabled: true,
      intensity: 0.25,
      frequency: 0.08,
      duration: 0.15,
      rgb_shift: 0.2,
      block_shift: false,
    },
  },
  
  // Clean/minimal (for non-horror content)
  clean: {
    preset_source: "clean",
    transitions: {
      enabled: true,
      intensity: 0.5,
      type: "crossfade",
      duration: 0.5,
    },
    kenburns: {
      enabled: true,
      intensity: 0.4,
      zoom_amount: 1.08,
      speed: 0.4,
      direction: "alternating",
    },
    color_grade: {
      enabled: true,
      intensity: 0.3,
      preset: "natural",
      contrast: 1.05,
      saturation: 1.0,
      brightness: 1.0,
      temperature: 0,
    },
    vignette: {
      enabled: true,
      intensity: 0.3,
      radius: 0.9,
      softness: 0.6,
    },
    film_grain: {
      enabled: false,
      intensity: 0,
      size: 1.0,
      color: false,
    },
  },

  // Reddit Trending Horror — clean but eerie animated look
  reddit_trending_horror: {
    preset_source: "reddit_trending_horror",
    transitions: {
      enabled: true,
      intensity: 0.6,
      type: "crossfade",
      duration: 0.6,
    },
    kenburns: {
      enabled: true,
      intensity: 0.35,
      zoom_amount: 1.08,
      speed: 0.35,
      direction: "alternating",
    },
    color_grade: {
      enabled: true,
      intensity: 0.55,
      preset: "cool_muted",
      contrast: 1.15,
      saturation: 0.75,
      brightness: 0.95,
      temperature: -0.20,
    },
    vignette: {
      enabled: true,
      intensity: 0.40,
      radius: 0.80,
      softness: 0.50,
    },
    film_grain: {
      enabled: true,
      intensity: 0.15,
      size: 0.8,
      color: false,
    },
    light_flicker: {
      enabled: true,
      intensity: 0.15,
      frequency: 0.08,
      variation: 0.1,
    },
    edge_darken: {
      enabled: true,
      intensity: 0.20,
      creep_speed: 0.15,
    },
  },
};

// =====================================================
// ART STYLE → EFFECTS MAPPING
// =====================================================

/**
 * Map art_style to effects profile adjustments
 * These layer ON TOP of vibe_preset effects
 */
export const ART_STYLE_EFFECTS_ADJUSTMENTS: Record<string, Partial<EffectsProfile>> = {
  "analog-horror": {
    scanlines: { enabled: true, intensity: 0.4, spacing: 2, thickness: 1.0, flicker: true },
    vhs: { enabled: true, intensity: 0.5, tracking_noise: 0.3, color_bleed: 0.4, tape_crinkle: 0.2, jitter: 0.2 },
    film_grain: { enabled: true, intensity: 0.45, size: 1.2, color: true },
  },
  "found-footage": {
    film_grain: { enabled: true, intensity: 0.5, size: 1.2, color: false },
    vhs: { enabled: true, intensity: 0.35, tracking_noise: 0.2, color_bleed: 0.25, tape_crinkle: 0.15, jitter: 0.2 },
    light_flicker: { enabled: true, intensity: 0.25, frequency: 0.12, variation: 0.15 },
  },
  "cinematic-dark": {
    color_grade: { enabled: true, intensity: 0.7, preset: "cinematic_dark", contrast: 1.2, saturation: 0.85, brightness: 0.95, temperature: -0.1 },
    vignette: { enabled: true, intensity: 0.65, radius: 0.75, softness: 0.5 },
  },
  "noir": {
    color_grade: { enabled: true, intensity: 0.9, preset: "noir", contrast: 1.35, saturation: 0.3, brightness: 0.9, temperature: 0 },
    vignette: { enabled: true, intensity: 0.8, radius: 0.65, softness: 0.4 },
  },
  "surreal": {
    color_grade: { enabled: true, intensity: 0.6, preset: "surreal", contrast: 1.1, saturation: 1.2, brightness: 1.0, temperature: 0.1 },
    glitch: { enabled: true, intensity: 0.2, frequency: 0.05, duration: 0.1, rgb_shift: 0.15, block_shift: false },
  },
  "uncanny-illustrated-horror": {
    // Steven Universe / Cartoon Network style — bright saturated colors, minimal post-processing
    color_grade: { enabled: true, intensity: 0.35, preset: "warm_bright", contrast: 1.05, saturation: 1.25, brightness: 1.05, temperature: 0.1 },
    vignette: { enabled: true, intensity: 0.15, radius: 0.90, softness: 0.70 },
    film_grain: { enabled: false, intensity: 0.0, size: 0.0, color: false },
  },
};

// =====================================================
// MERGE FUNCTIONS
// =====================================================

/**
 * Deep merge two objects, with source overriding target
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] !== undefined && source[key] !== null) {
      if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = deepMerge(target[key] || {}, source[key] as any);
      } else {
        (result as any)[key] = source[key];
      }
    }
  }
  
  return result;
}

/**
 * Resolve final effects profile by merging:
 * 1. System defaults
 * 2. Vibe preset effects
 * 3. Art style adjustments
 * 4. User overrides (sanitized)
 * 
 * Fail-soft: If user overrides are invalid, logs warning and uses preset defaults
 */
export function resolveEffectsProfile(
  vibePreset?: string,
  artStyle?: string,
  userOverrides?: Partial<EffectsProfile> | null
): EffectsProfile {
  // Start with system defaults
  let profile = { ...SYSTEM_DEFAULTS };
  let presetApplied = false;
  
  // Layer vibe preset effects
  if (vibePreset && PRESET_EFFECTS_PROFILES[vibePreset]) {
    profile = deepMerge(profile, PRESET_EFFECTS_PROFILES[vibePreset]);
    presetApplied = true;
    console.log(`[effects_profile] Preset profile applied: ${vibePreset}`);
  } else if (vibePreset) {
    console.log(`[effects_profile] Unknown preset "${vibePreset}", using system defaults`);
  }
  
  // Layer art style adjustments
  if (artStyle && ART_STYLE_EFFECTS_ADJUSTMENTS[artStyle]) {
    profile = deepMerge(profile, ART_STYLE_EFFECTS_ADJUSTMENTS[artStyle]);
    console.log(`[effects_profile] Art style adjustments applied: ${artStyle}`);
  }
  
  // Layer user overrides (highest priority) - sanitize first!
  if (userOverrides) {
    try {
      const sanitized = sanitizeEffectsProfile(userOverrides, profile);
      if (Object.keys(sanitized).length > 1) { // More than just schema_version
        profile = deepMerge(profile, sanitized);
        console.log(`[effects_profile] User overrides applied (sanitized)`);
      }
    } catch (err) {
      console.warn(`[effects_profile] Invalid user overrides, using ${presetApplied ? 'preset' : 'system'} defaults:`, err);
      // Fall through with preset/system profile (fail-soft)
    }
  }
  
  // Ensure schema_version is set
  profile.schema_version = SCHEMA_VERSION;
  
  return profile;
}

/**
 * Convert legacy boolean effects to effects profile
 * For backwards compatibility with existing jobs
 */
export function legacyEffectsToProfile(meta: Record<string, any>): Partial<EffectsProfile> {
  const overrides: Partial<EffectsProfile> = {};
  
  // Transitions
  if (meta.effect_fade_in !== undefined || meta.effect_fade_out !== undefined) {
    overrides.fade = {
      fade_in: meta.effect_fade_in === true,
      fade_in_duration: 0.5,
      fade_out: meta.effect_fade_out === true,
      fade_out_duration: 0.5,
    };
  }
  
  if (meta.effect_transitions !== undefined) {
    overrides.transitions = {
      enabled: meta.effect_transitions === true,
      intensity: 0.7,
      type: "crossfade",
      duration: 0.5,
    };
  }
  
  // Ken Burns
  if (meta.effect_kenburns !== undefined) {
    overrides.kenburns = {
      enabled: meta.effect_kenburns === true,
      intensity: 0.6,
      zoom_amount: 1.12,
      speed: 0.5,
      direction: "random",
    };
  }
  
  // Vignette
  if (meta.effect_vignette !== undefined) {
    overrides.vignette = {
      enabled: meta.effect_vignette === true,
      intensity: 0.5,
      radius: 0.8,
      softness: 0.5,
    };
  }
  
  // VHS
  if (meta.effect_vhs_tracking !== undefined) {
    overrides.vhs = {
      enabled: meta.effect_vhs_tracking === true,
      intensity: 0.5,
      tracking_noise: 0.3,
      color_bleed: 0.4,
      tape_crinkle: 0.2,
      jitter: 0.2,
    };
  }
  
  // Scanlines
  if (meta.effect_scanlines !== undefined) {
    overrides.scanlines = {
      enabled: meta.effect_scanlines === true,
      intensity: 0.4,
      spacing: 2,
      thickness: 1.0,
      flicker: false,
    };
  }
  
  // Film grain
  if (meta.effect_filmgrain !== undefined) {
    overrides.film_grain = {
      enabled: meta.effect_filmgrain === true,
      intensity: 0.35,
      size: 1.0,
      color: false,
    };
  }
  
  // Glitch
  if (meta.effect_glitch_flicker !== undefined) {
    overrides.glitch = {
      enabled: meta.effect_glitch_flicker === true,
      intensity: 0.4,
      frequency: 0.15,
      duration: 0.2,
      rgb_shift: 0.3,
      block_shift: false,
    };
  }
  
  // Light flicker
  if (meta.effect_light_flicker !== undefined) {
    overrides.light_flicker = {
      enabled: meta.effect_light_flicker === true,
      intensity: 0.3,
      frequency: 0.2,
      variation: 0.15,
    };
  }
  
  // Psychological effects
  if (meta.effect_heartbeat_zoom !== undefined) {
    overrides.heartbeat_zoom = {
      enabled: meta.effect_heartbeat_zoom === true,
      intensity: 0.4,
    };
  }
  
  if (meta.effect_negative_flash !== undefined) {
    overrides.negative_flash = {
      enabled: meta.effect_negative_flash === true,
      intensity: 0.5,
    };
  }
  
  if (meta.effect_edge_darkening !== undefined) {
    overrides.edge_darken = {
      enabled: meta.effect_edge_darkening === true,
      intensity: 0.4,
      creep_speed: 0.3,
    };
  }
  
  return overrides;
}

/**
 * Validate intensity value is within bounds
 */
export function clampIntensity(value: number, min = 0, max = 1): number {
  if (value === null || value === undefined || isNaN(value)) {
    return (min + max) / 2; // Return midpoint as default
  }
  return Math.max(min, Math.min(max, Number(value)));
}

/**
 * Safely get a number value, coercing nullish/NaN to default
 */
function safeNumber(value: any, defaultVal: number, min?: number, max?: number): number {
  if (value === null || value === undefined || isNaN(Number(value))) {
    return defaultVal;
  }
  let num = Number(value);
  if (min !== undefined) num = Math.max(min, num);
  if (max !== undefined) num = Math.min(max, num);
  return num;
}

/**
 * Safely get a boolean value
 */
function safeBool(value: any, defaultVal: boolean): boolean {
  if (value === null || value === undefined) return defaultVal;
  return Boolean(value);
}

/**
 * Sanitize and clamp an effects profile from user input.
 * - Clamps all intensities to [0, 1]
 * - Coerces NaN/null/undefined to defaults
 * - Drops unknown keys
 * - Adds schema_version if missing
 */
export function sanitizeEffectsProfile(
  userProfile: Partial<EffectsProfile> | null | undefined,
  defaults: EffectsProfile = SYSTEM_DEFAULTS
): Partial<EffectsProfile> {
  if (!userProfile || typeof userProfile !== 'object') {
    return {};
  }
  
  const sanitized: Partial<EffectsProfile> = {
    schema_version: SCHEMA_VERSION,
  };
  
  // Only process known keys
  for (const key of Object.keys(userProfile)) {
    if (!KNOWN_EFFECT_KEYS.has(key)) {
      console.log(`[effects_profile] Dropping unknown key: ${key}`);
      continue;
    }
  }
  
  // Transitions
  if (userProfile.transitions) {
    const src = userProfile.transitions;
    const def = defaults.transitions;
    sanitized.transitions = {
      enabled: safeBool(src.enabled, def.enabled),
      intensity: safeNumber(src.intensity, def.intensity, 0, 1),
      type: ['crossfade', 'cut', 'dissolve', 'wipe', 'dip_black'].includes(src.type) ? src.type : def.type,
      duration: safeNumber(src.duration, def.duration, 0.1, 3),
    };
  }
  
  // Ken Burns
  if (userProfile.kenburns) {
    const src = userProfile.kenburns;
    const def = defaults.kenburns;
    sanitized.kenburns = {
      enabled: safeBool(src.enabled, def.enabled),
      intensity: safeNumber(src.intensity, def.intensity, 0, 1),
      zoom_amount: safeNumber(src.zoom_amount, def.zoom_amount, 1.0, 2.0),
      speed: safeNumber(src.speed, def.speed, 0, 1),
      direction: ['in', 'out', 'random', 'alternating'].includes(src.direction) ? src.direction : def.direction,
    };
  }
  
  // Color grade
  if (userProfile.color_grade) {
    const src = userProfile.color_grade;
    const def = defaults.color_grade;
    sanitized.color_grade = {
      enabled: safeBool(src.enabled, def.enabled),
      intensity: safeNumber(src.intensity, def.intensity, 0, 1),
      preset: typeof src.preset === 'string' ? src.preset : def.preset,
      contrast: safeNumber(src.contrast, def.contrast, 0.5, 2.0),
      saturation: safeNumber(src.saturation, def.saturation, 0, 2.0),
      brightness: safeNumber(src.brightness, def.brightness, 0.5, 1.5),
      temperature: safeNumber(src.temperature, def.temperature, -1, 1),
    };
  }
  
  // Vignette
  if (userProfile.vignette) {
    const src = userProfile.vignette;
    const def = defaults.vignette;
    sanitized.vignette = {
      enabled: safeBool(src.enabled, def.enabled),
      intensity: safeNumber(src.intensity, def.intensity, 0, 1),
      radius: safeNumber(src.radius, def.radius, 0, 1),
      softness: safeNumber(src.softness, def.softness, 0, 1),
    };
  }
  
  // Film grain
  if (userProfile.film_grain) {
    const src = userProfile.film_grain;
    const def = defaults.film_grain;
    sanitized.film_grain = {
      enabled: safeBool(src.enabled, def.enabled),
      intensity: safeNumber(src.intensity, def.intensity, 0, 1),
      size: safeNumber(src.size, def.size, 0.5, 2.0),
      color: safeBool(src.color, def.color),
    };
  }
  
  // Scanlines
  if (userProfile.scanlines) {
    const src = userProfile.scanlines;
    const def = defaults.scanlines;
    sanitized.scanlines = {
      enabled: safeBool(src.enabled, def.enabled),
      intensity: safeNumber(src.intensity, def.intensity, 0, 1),
      spacing: safeNumber(src.spacing, def.spacing, 1, 8),
      thickness: safeNumber(src.thickness, def.thickness, 0.5, 2.0),
      flicker: safeBool(src.flicker, def.flicker),
    };
  }
  
  // VHS
  if (userProfile.vhs) {
    const src = userProfile.vhs;
    const def = defaults.vhs;
    sanitized.vhs = {
      enabled: safeBool(src.enabled, def.enabled),
      intensity: safeNumber(src.intensity, def.intensity, 0, 1),
      tracking_noise: safeNumber(src.tracking_noise, def.tracking_noise, 0, 1),
      color_bleed: safeNumber(src.color_bleed, def.color_bleed, 0, 1),
      tape_crinkle: safeNumber(src.tape_crinkle, def.tape_crinkle, 0, 1),
      jitter: safeNumber(src.jitter, def.jitter, 0, 1),
    };
  }
  
  // Glitch
  if (userProfile.glitch) {
    const src = userProfile.glitch;
    const def = defaults.glitch;
    sanitized.glitch = {
      enabled: safeBool(src.enabled, def.enabled),
      intensity: safeNumber(src.intensity, def.intensity, 0, 1),
      frequency: safeNumber(src.frequency, def.frequency, 0, 1),
      duration: safeNumber(src.duration, def.duration, 0, 1),
      rgb_shift: safeNumber(src.rgb_shift, def.rgb_shift, 0, 1),
      block_shift: safeBool(src.block_shift, def.block_shift),
    };
  }
  
  // Light flicker
  if (userProfile.light_flicker) {
    const src = userProfile.light_flicker;
    const def = defaults.light_flicker;
    sanitized.light_flicker = {
      enabled: safeBool(src.enabled, def.enabled),
      intensity: safeNumber(src.intensity, def.intensity, 0, 1),
      frequency: safeNumber(src.frequency, def.frequency, 0, 1),
      variation: safeNumber(src.variation, def.variation, 0, 1),
    };
  }
  
  // Edge darken
  if (userProfile.edge_darken) {
    const src = userProfile.edge_darken;
    const def = defaults.edge_darken;
    sanitized.edge_darken = {
      enabled: safeBool(src.enabled, def.enabled),
      intensity: safeNumber(src.intensity, def.intensity, 0, 1),
      creep_speed: safeNumber(src.creep_speed, def.creep_speed, 0, 1),
    };
  }
  
  // Fade
  if (userProfile.fade) {
    const src = userProfile.fade;
    const def = defaults.fade;
    sanitized.fade = {
      fade_in: safeBool(src.fade_in, def.fade_in),
      fade_in_duration: safeNumber(src.fade_in_duration, def.fade_in_duration, 0, 3),
      fade_out: safeBool(src.fade_out, def.fade_out),
      fade_out_duration: safeNumber(src.fade_out_duration, def.fade_out_duration, 0, 3),
    };
  }
  
  // Heartbeat zoom
  if (userProfile.heartbeat_zoom) {
    const src = userProfile.heartbeat_zoom;
    const def = defaults.heartbeat_zoom;
    sanitized.heartbeat_zoom = {
      enabled: safeBool(src.enabled, def.enabled),
      intensity: safeNumber(src.intensity, def.intensity, 0, 1),
    };
  }
  
  // Negative flash
  if (userProfile.negative_flash) {
    const src = userProfile.negative_flash;
    const def = defaults.negative_flash;
    sanitized.negative_flash = {
      enabled: safeBool(src.enabled, def.enabled),
      intensity: safeNumber(src.intensity, def.intensity, 0, 1),
    };
  }
  
  return sanitized;
}

/**
 * Convert effects profile to summary string for logging
 */
export function profileToSummary(profile: EffectsProfile): string {
  const active: string[] = [];
  
  if (profile.transitions.enabled) active.push(`transitions(${profile.transitions.type})`);
  if (profile.kenburns.enabled) active.push(`kenburns(${(profile.kenburns.intensity * 100).toFixed(0)}%)`);
  if (profile.color_grade.enabled) active.push(`color(${profile.color_grade.preset})`);
  if (profile.vignette.enabled) active.push(`vignette(${(profile.vignette.intensity * 100).toFixed(0)}%)`);
  if (profile.film_grain.enabled) active.push(`grain(${(profile.film_grain.intensity * 100).toFixed(0)}%)`);
  if (profile.scanlines.enabled) active.push(`scanlines(${(profile.scanlines.intensity * 100).toFixed(0)}%)`);
  if (profile.vhs.enabled) active.push(`vhs(${(profile.vhs.intensity * 100).toFixed(0)}%)`);
  if (profile.glitch.enabled) active.push(`glitch(${(profile.glitch.intensity * 100).toFixed(0)}%)`);
  if (profile.light_flicker.enabled) active.push('flicker');
  if (profile.edge_darken.enabled) active.push('edge_darken');
  if (profile.heartbeat_zoom.enabled) active.push('heartbeat');
  if (profile.negative_flash.enabled) active.push('negative');
  
  return active.join(', ') || 'none';
}
