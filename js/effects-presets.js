// =====================================================
// EFFECTS PRESETS & INTENSITY CURVES v1.0
// 
// Maps vibe_preset to effect configurations
// Provides intensity curves for natural-feeling sliders
// =====================================================

/**
 * Intensity mapping curves
 * These make sliders feel natural: 0.5 = "moderate", not "half-strength"
 * 
 * Usage:
 *   const ffmpegValue = INTENSITY_CURVES.vignette.toFFmpeg(sliderValue);
 */
const INTENSITY_CURVES = {
  
  // VIGNETTE: Subtle at low values, dramatic at high
  // slider 0.2 → subtle corner shadow
  // slider 0.5 → noticeable but not distracting  
  // slider 1.0 → heavy horror vignette
  vignette: {
    toFFmpeg: (slider) => {
      // Quadratic curve: y = x^1.5
      const intensity = Math.pow(Math.max(0, Math.min(1, slider)), 1.5);
      return {
        intensity,
        // FFmpeg vignette angle: PI/4 at full strength
        angle: (Math.PI / 4) * intensity,
        // Radius shrinks with intensity (larger radius = less vignette)
        radius: 1.0 - (intensity * 0.4),
        softness: 0.3 + (intensity * 0.4),
      };
    },
    toSlider: (ffmpegIntensity) => Math.pow(ffmpegIntensity, 1/1.5),
    previewLabel: (slider) => slider < 0.3 ? 'Subtle' : slider < 0.7 ? 'Medium' : 'Heavy',
    description: 'Darkens the edges of the frame',
  },
  
  // FILM GRAIN: Linear feels natural for noise
  // slider 0.2 → barely visible grain
  // slider 0.5 → film-like
  // slider 1.0 → heavy 8mm footage
  film_grain: {
    toFFmpeg: (slider) => {
      slider = Math.max(0, Math.min(1, slider));
      // Linear with base offset - noise strength 5-40
      const noiseStrength = 5 + (slider * 35);
      return {
        intensity: slider,
        alls: Math.round(noiseStrength),
        size: 0.8 + (slider * 0.4), // 0.8-1.2
        color: slider > 0.6, // Color grain only at high intensity
      };
    },
    toSlider: (ffmpegIntensity) => ffmpegIntensity,
    previewLabel: (slider) => slider < 0.25 ? 'Film' : slider < 0.6 ? 'Gritty' : 'Heavy',
    description: 'Adds film-like grain texture',
  },
  
  // VHS: Exponential - subtle differences at low end, dramatic at high
  // slider 0.2 → slight tracking wobble
  // slider 0.5 → recognizable VHS look  
  // slider 1.0 → damaged tape aesthetic
  vhs: {
    toFFmpeg: (slider) => {
      slider = Math.max(0, Math.min(1, slider));
      // Exponential curve: y = x^2
      const base = Math.pow(slider, 2);
      return {
        intensity: slider,
        tracking_noise: base * 0.8,
        color_bleed: base * 0.6,
        tape_crinkle: base * 0.4,
        jitter: base * 0.3,
      };
    },
    toSlider: (ffmpegIntensity) => Math.sqrt(ffmpegIntensity),
    previewLabel: (slider) => slider < 0.3 ? 'Aged' : slider < 0.7 ? 'Worn' : 'Damaged',
    description: 'VHS tracking noise and color bleed',
  },
  
  // GLITCH: Highly non-linear (glitch should be rare at low values)
  // slider 0.2 → occasional micro-glitch
  // slider 0.5 → intermittent corruption
  // slider 1.0 → heavy digital breakdown
  glitch: {
    toFFmpeg: (slider) => {
      slider = Math.max(0, Math.min(1, slider));
      // Cubic curve: y = x^3 (very subtle at low end)
      const base = Math.pow(slider, 3);
      return {
        intensity: slider,
        frequency: base * 0.5,       // How often (0-0.5)
        rgb_shift: slider * 0.8,     // Chromatic aberration (linear)
        block_shift: slider > 0.6,   // Only at high intensity
        duration: slider * 0.5,      // 0-0.5s
      };
    },
    toSlider: (ffmpegIntensity) => Math.pow(ffmpegIntensity, 1/3),
    previewLabel: (slider) => slider < 0.3 ? 'Micro' : slider < 0.6 ? 'Digital' : 'Corrupt',
    description: 'Digital glitch and chromatic aberration',
  },
  
  // SCANLINES: Linear, but only visible above threshold
  scanlines: {
    toFFmpeg: (slider) => {
      slider = Math.max(0, Math.min(1, slider));
      return {
        intensity: slider,
        opacity: slider * 0.6,       // Max 60% opacity
        spacing: 2,                   // Fixed 2px spacing
        thickness: 1,
        flicker: slider > 0.5,        // Flicker at higher intensity
      };
    },
    toSlider: (ffmpegIntensity) => ffmpegIntensity,
    previewLabel: (slider) => slider < 0.3 ? 'Faint' : slider < 0.7 ? 'CRT' : 'Heavy',
    description: 'CRT monitor scanline effect',
  },
  
  // COLOR GRADE: Linear intensity feels natural
  color_grade: {
    toFFmpeg: (slider) => {
      slider = Math.max(0, Math.min(1, slider));
      return {
        intensity: slider,
        // These modify the preset's base values
        contrast_mult: 1 + ((slider - 0.5) * 0.4),  // 0.8-1.2
        saturation_mult: 1 + ((slider - 0.5) * 0.6), // 0.7-1.3
        brightness_mult: 1.0, // Usually keep neutral
      };
    },
    toSlider: (ffmpegIntensity) => ffmpegIntensity,
    previewLabel: (slider) => slider < 0.4 ? 'Subtle' : slider < 0.7 ? 'Styled' : 'Bold',
    description: 'Color grading intensity',
  },
  
  // KEN BURNS: Linear speed mapping
  kenburns: {
    toFFmpeg: (slider) => {
      slider = Math.max(0, Math.min(1, slider));
      return {
        intensity: slider,
        speed: 0.2 + (slider * 0.8),        // 0.2-1.0 speed
        zoom_amount: 1.05 + (slider * 0.2), // 1.05-1.25x zoom
      };
    },
    toSlider: (ffmpegSpeed) => (ffmpegSpeed - 0.2) / 0.8,
    previewLabel: (slider) => slider < 0.3 ? 'Slow' : slider < 0.7 ? 'Medium' : 'Dynamic',
    description: 'Camera motion speed and zoom',
  },
  
  // LIGHT FLICKER: Non-linear - subtle at low values
  light_flicker: {
    toFFmpeg: (slider) => {
      slider = Math.max(0, Math.min(1, slider));
      const base = Math.pow(slider, 1.5);
      return {
        intensity: slider,
        frequency: 0.1 + (base * 0.4),    // 0.1-0.5
        variation: base * 0.5,             // 0-0.5 brightness swing
      };
    },
    toSlider: (ffmpegIntensity) => Math.pow(ffmpegIntensity, 1/1.5),
    previewLabel: (slider) => slider < 0.3 ? 'Subtle' : slider < 0.7 ? 'Noticeable' : 'Strobing',
    description: 'Flickering light effect',
  },
};

/**
 * Preset effect summaries for UI display
 * Shows what effects are active for each vibe_preset
 */
const PRESET_EFFECT_SUMMARY = {
  slow_creepy: {
    label: "Slow Creepy",
    description: "Atmospheric dread with slow motion and cold tones",
    activeEffects: [
      { name: "Vignette", key: "vignette", intensity: 0.45, label: "Medium edge darkness" },
      { name: "Color Grade", key: "color_grade", intensity: 0.70, preset: "horror_cold", label: "Cold blue tones" },
      { name: "Ken Burns", key: "kenburns", intensity: 0.30, label: "Slow zoom" },
    ],
    inactiveEffects: ["Film Grain", "VHS", "Glitch", "Scanlines"],
    colorPreset: "horror_cold",
    mood: "Building dread, slow pacing",
  },
  
  analog_horror: {
    label: "Analog Horror",
    description: "Corrupted VHS surveillance footage",
    activeEffects: [
      { name: "VHS", key: "vhs", intensity: 0.60, label: "Tracking noise + color bleed" },
      { name: "Scanlines", key: "scanlines", intensity: 0.50, label: "CRT monitor lines" },
      { name: "Glitch", key: "glitch", intensity: 0.35, label: "Occasional corruption" },
      { name: "Vignette", key: "vignette", intensity: 0.55, label: "Heavy edge darkness" },
      { name: "Film Grain", key: "film_grain", intensity: 0.45, label: "Noisy footage" },
      { name: "Color Grade", key: "color_grade", intensity: 0.60, preset: "vhs_degraded", label: "Desaturated, green tint" },
    ],
    inactiveEffects: [],
    colorPreset: "vhs_degraded",
    mood: "Corrupted, unsettling",
  },
  
  found_footage: {
    label: "Found Footage",
    description: "Amateur camera, authentic documentary feel",
    activeEffects: [
      { name: "Film Grain", key: "film_grain", intensity: 0.50, label: "Heavy grain" },
      { name: "Ken Burns", key: "kenburns", intensity: 0.55, label: "Handheld shake" },
      { name: "Vignette", key: "vignette", intensity: 0.35, label: "Light vignette" },
      { name: "Light Flicker", key: "light_flicker", intensity: 0.40, label: "Unsteady lighting" },
      { name: "Color Grade", key: "color_grade", intensity: 0.50, preset: "found_footage", label: "Muted, realistic" },
    ],
    inactiveEffects: ["VHS", "Glitch", "Scanlines"],
    colorPreset: "found_footage",
    mood: "Raw, authentic",
  },
  
  urban_legend: {
    label: "Urban Legend",
    description: "Street-lit, noir atmosphere",
    activeEffects: [
      { name: "Vignette", key: "vignette", intensity: 0.60, label: "Strong edge darkness" },
      { name: "Film Grain", key: "film_grain", intensity: 0.25, label: "Subtle grain" },
      { name: "Color Grade", key: "color_grade", intensity: 0.75, preset: "urban_night", label: "Cool night tones" },
      { name: "Ken Burns", key: "kenburns", intensity: 0.40, label: "Moderate motion" },
    ],
    inactiveEffects: ["VHS", "Glitch", "Scanlines"],
    colorPreset: "urban_night",
    mood: "Mysterious, urban noir",
  },
  
  psychological: {
    label: "Psychological",
    description: "Mind-bending, reality-warping",
    activeEffects: [
      { name: "Vignette", key: "vignette", intensity: 0.50, label: "Framed view" },
      { name: "Color Grade", key: "color_grade", intensity: 0.65, preset: "psychological", label: "Desaturated, cold" },
      { name: "Film Grain", key: "film_grain", intensity: 0.30, label: "Subtle grain" },
      { name: "Glitch", key: "glitch", intensity: 0.20, label: "Subtle distortion" },
    ],
    inactiveEffects: ["VHS", "Scanlines"],
    colorPreset: "psychological",
    mood: "Unsettling, paranoid",
  },
  
  cosmic_horror: {
    label: "Cosmic Horror",
    description: "Lovecraftian vastness and unknowable dread",
    activeEffects: [
      { name: "Vignette", key: "vignette", intensity: 0.85, label: "Heavy darkness" },
      { name: "Color Grade", key: "color_grade", intensity: 0.80, preset: "cosmic_void", label: "Deep blue-black void" },
      { name: "Film Grain", key: "film_grain", intensity: 0.35, label: "Grainy texture" },
      { name: "Glitch", key: "glitch", intensity: 0.25, label: "Reality glitches" },
      { name: "Ken Burns", key: "kenburns", intensity: 0.30, label: "Slow, ominous" },
    ],
    inactiveEffects: ["VHS", "Scanlines"],
    colorPreset: "cosmic_void",
    mood: "Vast, incomprehensible",
  },
  
  clean: {
    label: "Clean/Minimal",
    description: "Modern, polished look with minimal effects",
    activeEffects: [
      { name: "Ken Burns", key: "kenburns", intensity: 0.40, label: "Smooth motion" },
      { name: "Color Grade", key: "color_grade", intensity: 0.40, preset: "cinematic", label: "Light cinematic" },
      { name: "Vignette", key: "vignette", intensity: 0.20, label: "Very subtle" },
    ],
    inactiveEffects: ["VHS", "Glitch", "Scanlines", "Film Grain", "Light Flicker"],
    colorPreset: "cinematic",
    mood: "Clean, professional",
  },
  
  punchy_shock: {
    label: "Punchy Shock",
    description: "Fast-paced jump scares and sudden reveals",
    activeEffects: [
      { name: "Ken Burns", key: "kenburns", intensity: 0.75, label: "Fast, aggressive" },
      { name: "Glitch", key: "glitch", intensity: 0.45, label: "Sharp distortion" },
      { name: "Vignette", key: "vignette", intensity: 0.55, label: "Strong focus" },
      { name: "Film Grain", key: "film_grain", intensity: 0.35, label: "Gritty texture" },
      { name: "Color Grade", key: "color_grade", intensity: 0.60, preset: "high_contrast", label: "Harsh contrast" },
    ],
    inactiveEffects: ["Scanlines"],
    colorPreset: "high_contrast",
    mood: "Intense, shocking",
  },
  
  atmospheric: {
    label: "Atmospheric",
    description: "Slow-burn dread and ambient unease",
    activeEffects: [
      { name: "Vignette", key: "vignette", intensity: 0.65, label: "Heavy atmosphere" },
      { name: "Ken Burns", key: "kenburns", intensity: 0.25, label: "Very slow zoom" },
      { name: "Color Grade", key: "color_grade", intensity: 0.70, preset: "cold", label: "Cold, eerie" },
      { name: "Film Grain", key: "film_grain", intensity: 0.25, label: "Subtle grain" },
      { name: "Light Flicker", key: "light_flicker", intensity: 0.30, label: "Subtle flicker" },
    ],
    inactiveEffects: ["VHS", "Glitch", "Scanlines"],
    colorPreset: "cold",
    mood: "Dread, anticipation",
  },

  reddit_trending_horror: {
    label: "Reddit Trending Horror",
    description: "Clean animated horror — eerie but polished, no heavy VHS",
    activeEffects: [
      { name: "Ken Burns", key: "kenburns", intensity: 0.30, label: "Subtle slow zoom" },
      { name: "Vignette", key: "vignette", intensity: 0.40, label: "Light vignette" },
      { name: "Film Grain", key: "film_grain", intensity: 0.15, label: "Minimal grain" },
      { name: "Color Grade", key: "color_grade", intensity: 0.55, preset: "cool_muted", label: "Cool desaturated tones" },
      { name: "Light Flicker", key: "light_flicker", intensity: 0.15, label: "Very subtle flicker" },
    ],
    inactiveEffects: ["VHS", "Glitch", "Scanlines"],
    colorPreset: "cool_muted",
    mood: "Eerie, clean, cinematic unease",
  },

  dark_origins: {
    label: "Dark Origins",
    description: "Noir documentary — desaturated, heavy vignette, dissolve transitions",
    activeEffects: [
      { name: "Ken Burns", key: "kenburns", intensity: 0.50, label: "Slow deliberate zoom" },
      { name: "Vignette", key: "vignette", intensity: 0.75, label: "Heavy vignette" },
      { name: "Film Grain", key: "film_grain", intensity: 0.40, label: "Documentary grain" },
      { name: "Color Grade", key: "color_grade", intensity: 0.75, preset: "noir_documentary", label: "Noir desaturated tones" },
      { name: "Light Flicker", key: "light_flicker", intensity: 0.20, label: "Subtle flicker" },
      { name: "Edge Darken", key: "edge_darken", intensity: 0.45, label: "Dark edge creep" },
      { name: "Negative Flash", key: "negative_flash", intensity: 0.20, label: "Brief negative flashes" },
    ],
    inactiveEffects: ["VHS", "Glitch", "Scanlines"],
    colorPreset: "noir_documentary",
    mood: "Cold, clinical, true-crime documentary dread",
  },

  // =====================================================
  // DecideThisDaily presets
  // =====================================================

  no_good_choice: {
    label: "No Good Choice",
    description: "Clean, modern — gameplay-ready minimal look for decision content",
    activeEffects: [
      { name: "Ken Burns", key: "kenburns", intensity: 0.25, label: "Gentle drift" },
      { name: "Vignette", key: "vignette", intensity: 0.15, label: "Very subtle" },
      { name: "Color Grade", key: "color_grade", intensity: 0.30, preset: "neutral_warm", label: "Neutral warm tones" },
    ],
    inactiveEffects: ["VHS", "Glitch", "Scanlines", "Film Grain", "Light Flicker"],
    colorPreset: "neutral_warm",
    mood: "Clean, punchy, conversational tension",
  },

  one_rule_one_power: {
    label: "One Rule One Power",
    description: "Moody contemplative — deep tones, subtle movement for thought experiments",
    activeEffects: [
      { name: "Ken Burns", key: "kenburns", intensity: 0.35, label: "Slow contemplative zoom" },
      { name: "Vignette", key: "vignette", intensity: 0.40, label: "Moderate vignette" },
      { name: "Color Grade", key: "color_grade", intensity: 0.60, preset: "deep_blue_amber", label: "Deep blue-amber tones" },
      { name: "Film Grain", key: "film_grain", intensity: 0.10, label: "Barely-there grain" },
    ],
    inactiveEffects: ["VHS", "Glitch", "Scanlines", "Light Flicker"],
    colorPreset: "deep_blue_amber",
    mood: "Contemplative, surreal, mysterious",
  },

  two_doors: {
    label: "Two Doors",
    description: "High-contrast cinematic — bold colors for binary choice framing",
    activeEffects: [
      { name: "Ken Burns", key: "kenburns", intensity: 0.40, label: "Moderate dramatic zoom" },
      { name: "Vignette", key: "vignette", intensity: 0.35, label: "Focus vignette" },
      { name: "Color Grade", key: "color_grade", intensity: 0.65, preset: "bold_contrast", label: "Bold high-contrast tones" },
      { name: "Film Grain", key: "film_grain", intensity: 0.08, label: "Minimal texture" },
    ],
    inactiveEffects: ["VHS", "Glitch", "Scanlines", "Light Flicker"],
    colorPreset: "bold_contrast",
    mood: "Cinematic, dramatic, decisive",
  },
};

/**
 * Read slider values from DOM elements
 * Sliders have IDs like 'slider-vignette', 'slider-kenburns', etc.
 * and return values 0-100, which we normalize to 0-1
 * 
 * @returns {object} Slider values (0-1) for each effect
 */
function readSlidersFromDOM() {
  const getValue = (id) => {
    const el = document.getElementById(`slider-${id}`);
    if (!el) return 0;
    if (el.tagName === 'SELECT') {
      // For select elements, return the value directly (for color_grade)
      return el.value === 'none' ? 0 : el.value;
    }
    // Range sliders return 0-100, normalize to 0-1
    return parseInt(el.value || 0) / 100;
  };
  
  return {
    kenburns: getValue('kenburns'),
    vignette: getValue('vignette'),
    film_grain: getValue('film_grain'),
    scanlines: getValue('scanlines'),
    vhs: getValue('vhs'),
    glitch: getValue('glitch'),
    color_grade: getValue('color_grade'),
    light_flicker: getValue('light_flicker') || 0,
  };
}

/**
 * Convert slider values (0-1) to effects profile format
 * Uses intensity curves for natural mapping
 * 
 * @param {object} sliders - Raw slider values (0-1). If not provided, reads from DOM.
 * @param {string} basePreset - Preset to use as base (for color grade preset)
 * @returns {object} Effects profile ready for API
 */
function buildEffectsProfileFromSliders(sliders, basePreset = 'slow_creepy') {
  // If no sliders provided, read from DOM
  if (!sliders) {
    sliders = readSlidersFromDOM();
    console.log('[Effects] Read sliders from DOM:', sliders);
  }
  
  const presetInfo = PRESET_EFFECT_SUMMARY[basePreset] || PRESET_EFFECT_SUMMARY.slow_creepy;
  
  // Handle color_grade which can be a string preset name
  const colorGradeValue = typeof sliders.color_grade === 'string' 
    ? (sliders.color_grade === 'none' ? 0 : 0.5) 
    : (sliders.color_grade || 0);
  const colorGradePreset = typeof sliders.color_grade === 'string' && sliders.color_grade !== 'none'
    ? sliders.color_grade
    : presetInfo.colorPreset || 'cinematic';
  
  const profile = {
    version: '1.0',
    schema_version: 1,
    preset_source: basePreset,
    
    // Ken Burns
    kenburns: {
      enabled: (sliders.kenburns || 0) > 0.05,
      ...(INTENSITY_CURVES.kenburns.toFFmpeg(sliders.kenburns || 0)),
      direction: 'random',
    },
    
    // Vignette
    vignette: {
      enabled: (sliders.vignette || 0) > 0.05,
      ...(INTENSITY_CURVES.vignette.toFFmpeg(sliders.vignette || 0)),
    },
    
    // Film Grain
    film_grain: {
      enabled: (sliders.film_grain || 0) > 0.05,
      ...(INTENSITY_CURVES.film_grain.toFFmpeg(sliders.film_grain || 0)),
    },
    
    // Scanlines
    scanlines: {
      enabled: (sliders.scanlines || 0) > 0.05,
      ...(INTENSITY_CURVES.scanlines.toFFmpeg(sliders.scanlines || 0)),
    },
    
    // VHS
    vhs: {
      enabled: (sliders.vhs || 0) > 0.05,
      ...(INTENSITY_CURVES.vhs.toFFmpeg(sliders.vhs || 0)),
    },
    
    // Glitch
    glitch: {
      enabled: (sliders.glitch || 0) > 0.05,
      ...(INTENSITY_CURVES.glitch.toFFmpeg(sliders.glitch || 0)),
      block_shift: (sliders.glitch || 0) > 0.6,
    },
    
    // Color Grade
    color_grade: {
      enabled: colorGradeValue > 0.05 || typeof sliders.color_grade === 'string',
      preset: colorGradePreset,
      ...(INTENSITY_CURVES.color_grade.toFFmpeg(colorGradeValue)),
    },
    
    // Light Flicker
    light_flicker: {
      enabled: (sliders.light_flicker || 0) > 0.05,
      ...(INTENSITY_CURVES.light_flicker.toFFmpeg(sliders.light_flicker || 0)),
    },
    
    // Fade - usually just on/off
    fade: {
      fade_in: true,
      fade_in_duration: 0.5,
      fade_out: true,
      fade_out_duration: 0.5,
    },
    
    // Transitions
    transitions: {
      enabled: true,
      type: 'crossfade',
      duration: 0.5,
      intensity: 0.7,
    },
    
    // Video Overlay (configured per-preset via brand settings, not sliders)
    // This gets merged with any overlay_video config from brand_templates
    overlay_video: sliders._overlay_video || {
      enabled: false,
      url: null,
      opacity: 0.4,
      blend_mode: 'screen',
    },
  };
  
  return profile;
}

/**
 * Get slider values from a preset
 * @param {string} presetName - Preset name like 'analog_horror'
 * @returns {object} Slider values (0-100 for numeric, preset name for color_grade)
 */
function getSlidersFromPreset(presetName) {
  const preset = PRESET_EFFECT_SUMMARY[presetName];
  if (!preset) {
    console.warn(`[Effects] Unknown preset: ${presetName}, using slow_creepy`);
    return getSlidersFromPreset('slow_creepy');
  }
  
  const sliders = {
    kenburns: 0,
    vignette: 0,
    film_grain: 0,
    scanlines: 0,
    vhs: 0,
    glitch: 0,
    color_grade: 'none',  // String preset name for select element
    light_flicker: 0,
  };
  
  // Extract intensities from active effects
  // Convert 0-1 to 0-100 for slider range
  for (const effect of preset.activeEffects) {
    if (effect.key === 'color_grade') {
      // For color grade, use the preset name or map intensity to a preset
      sliders.color_grade = effect.preset || (effect.intensity > 0.5 ? 'cold' : 'none');
    } else if (sliders.hasOwnProperty(effect.key)) {
      // Convert 0-1 to 0-100 range
      sliders[effect.key] = Math.round(effect.intensity * 100);
    }
  }
  
  console.log(`[Effects] getSlidersFromPreset(${presetName}):`, sliders);
  return sliders;
}

/**
 * Get human-readable label for an intensity value
 * @param {string} effectKey - Effect key like 'vignette'
 * @param {number} intensity - 0-100 value (slider range) or 0-1 (normalized)
 * @returns {string} Label like 'Medium'
 */
function getIntensityLabel(effectKey, intensity) {
  // Normalize to 0-1 if value is in 0-100 range
  const normalized = intensity > 1 ? intensity / 100 : intensity;
  
  const curve = INTENSITY_CURVES[effectKey];
  if (curve && curve.previewLabel) {
    return curve.previewLabel(normalized);
  }
  // Fallback
  if (normalized === 0) return 'Off';
  if (normalized < 0.30) return 'Low';
  if (normalized < 0.65) return 'Medium';
  return 'High';
}

// Export to global scope
window.INTENSITY_CURVES = INTENSITY_CURVES;
window.PRESET_EFFECT_SUMMARY = PRESET_EFFECT_SUMMARY;
window.buildEffectsProfileFromSliders = buildEffectsProfileFromSliders;
window.readSlidersFromDOM = readSlidersFromDOM;
window.getSlidersFromPreset = getSlidersFromPreset;
window.getIntensityLabel = getIntensityLabel;
