/**
 * FFmpeg Preset Binding v1.0
 * 
 * Maps Visual DNA dimensions directly to FFmpeg filter graphs.
 * This makes visuals:
 *   - Deterministic (same DNA = same look)
 *   - Reproducible (can regenerate identical output)
 *   - Renderer-agnostic (works with any FFmpeg-based system)
 * 
 * AI generates images → this system finishes them with consistent post-processing.
 */

// =====================================================
// VISUAL STYLE → FILTER PRESETS
// =====================================================

/**
 * Map visual_style to base FFmpeg filters
 * These define the foundational aesthetic
 */
const VISUAL_STYLE_FILTERS = {
  // VHS degraded: noise, desaturation, analog feel
  VHS_degraded: [
    'noise=alls=20:allf=t',           // Strong noise (alls=all strength)
    'eq=saturation=0.7:contrast=1.1', // Desaturated, slight contrast
    'unsharp=3:3:-0.5',               // Soft blur for analog feel
    'colorbalance=rs=-0.05:gs=0.08:bs=-0.03', // Slight green tint
  ],
  
  // Cinematic dark: film look, deep shadows
  cinematic_dark: [
    'eq=saturation=0.85:contrast=1.2:brightness=-0.05', // Rich darks
    'colorbalance=rs=-0.03:gs=-0.02:bs=0.05',           // Cool shadows
    'curves=preset=darker',                              // Film curve
  ],
  
  // Cinematic minimal: clean, subtle
  cinematic_minimal: [
    'eq=saturation=0.75:contrast=1.05',  // Muted but clear
    'colorbalance=bs=0.03',               // Slight cold cast
  ],
  
  // Documentary archival: aged, historical
  documentary_archival: [
    'eq=saturation=0.6:contrast=1.15:brightness=-0.02',
    'colorbalance=rs=0.05:gs=0.03:bs=-0.05',  // Warm sepia hint
    'noise=c0s=8:c0f=t',                       // Subtle grain
  ],
  
  // Surveillance footage: security camera aesthetic
  surveillance_footage: [
    'eq=saturation=0.5:contrast=1.25',       // High contrast, desaturated
    'noise=c0s=12:c0f=t',                    // Digital noise
    'colorbalance=gs=0.05',                  // Slight green tint
  ],
  
  // Found footage: amateur video quality
  found_footage: [
    'eq=saturation=0.8:contrast=1.1',
    'noise=c0s=15:allf=t',
    'unsharp=3:3:-0.3',                      // Slight softness
  ],
  
  // Polaroid faded: vintage photograph
  polaroid_faded: [
    'eq=saturation=0.65:contrast=0.95:brightness=0.03',
    'colorbalance=rs=0.08:gs=0.04:bs=-0.06', // Warm fade
    'curves=preset=lighter',
  ],
};

// =====================================================
// MOTION PROFILE → ANIMATION FILTERS
// =====================================================

// Safety inset: max 2% of frame for jitter (protects subtitle-safe areas)
const JITTER_SAFETY_PERCENT = 0.02;  // 2% max crop
const MIN_JITTER_PIXELS = 2;         // Minimum visible movement
const MAX_JITTER_PIXELS = 20;        // Maximum at 1080p

/**
 * Calculate safe jitter pixels based on resolution
 * Ensures jitter stays within subtitle-safe margins
 */
function calculateSafeJitter(width, height) {
  const maxJitterW = Math.floor(width * JITTER_SAFETY_PERCENT);
  const maxJitterH = Math.floor(height * JITTER_SAFETY_PERCENT);
  
  // Clamp to reasonable range
  const safeW = Math.max(MIN_JITTER_PIXELS, Math.min(MAX_JITTER_PIXELS, maxJitterW));
  const safeH = Math.max(MIN_JITTER_PIXELS, Math.min(MAX_JITTER_PIXELS, maxJitterH));
  
  return { safeW, safeH };
}

/**
 * Map motion_profile to FFmpeg zoompan/crop animations
 * These are applied per-scene during Ken Burns processing
 * 
 * SAFETY: micro_jitter uses 2% max crop to protect subtitle-safe areas
 */
const MOTION_PROFILE_FILTERS = {
  // No motion - static
  none: null,
  
  // Micro jitter - random tiny movements (VHS feel)
  // SAFE: Uses 2% max crop, never violates subtitle margins
  // Applied as crop with slight random offset
  micro_jitter: {
    type: 'crop',
    // Safe jitter: max 2% of frame (e.g., 4px at 1080p width)
    // Crops 2% then adds randomized offset within remaining safe zone
    filter: 'crop=iw*0.98:ih*0.98:iw*0.01+random(0)*iw*0.01:ih*0.01+random(0)*ih*0.01',
    // Fallback for FFmpeg versions without random() - uses safe deterministic jitter
    fallback: 'crop=iw*0.98:ih*0.98:iw*0.01+mod(n*7,iw*0.01):ih*0.01+mod(n*11,ih*0.01)',
    // Fixed pixel version for compatibility (4px jitter at any res)
    fixed: 'crop=in_w-4:in_h-4:2+mod(n*7,2):2+mod(n*11,2)',
    safety_note: 'Uses 2% max crop to protect subtitle-safe margins',
  },
  
  // Slow drift - gentle horizontal movement
  slow_drift: {
    type: 'zoompan',
    // Expressed as zoompan x movement over time
    x_expr: '(iw-iw/zoom)/2+((iw/zoom-ow)/4)*(1-cos(on/{frames}*PI))/2',
    y_expr: '(ih-ih/zoom)/2',
    zoom_expr: '1.05',
  },
  
  // Slow pan - deliberate camera movement
  slow_pan: {
    type: 'zoompan',
    x_expr: '(iw-iw/zoom)/2+((iw/zoom-ow)/3)*sin(on/{frames}*PI)',
    y_expr: '(ih-ih/zoom)/2',
    zoom_expr: '1.08',
  },
  
  // Subtle zoom - gradual zoom in
  subtle_zoom: {
    type: 'zoompan',
    x_expr: '(iw-iw/zoom)/2',
    y_expr: '(ih-ih/zoom)/2',
    zoom_expr: '1.0+0.08*on/{frames}',
  },
  
  // Tracking stutter - surveillance camera feel
  tracking_stutter: {
    type: 'zoompan',
    x_expr: '(iw-iw/zoom)/2+mod(floor(on/15)*3,6)-3',  // Step every 15 frames
    y_expr: '(ih-ih/zoom)/2',
    zoom_expr: '1.02',
  },
};

// =====================================================
// COLOR PALETTE → COLOR GRADING
// =====================================================

/**
 * Map color_palette to FFmpeg color correction filters
 */
const COLOR_PALETTE_FILTERS = {
  // Cold desaturated: drained, lifeless
  cold_desaturated: [
    'eq=saturation=0.6',
    'colorbalance=rs=-0.08:gs=-0.05:bs=0.12',  // Heavy blue shift
    'curves=master=0/0 0.3/0.25 0.7/0.75 1/1', // Slight S-curve
  ],
  
  // Sickly green: nauseous, unwell
  sickly_green: [
    'eq=saturation=0.75',
    'colorbalance=rs=-0.1:gs=0.15:bs=-0.08',   // Green dominance
    'hue=s=0.9',
  ],
  
  // Muted gray: washed out, neutral
  muted_gray: [
    'eq=saturation=0.4:contrast=0.95',
    'colorbalance=rs=0:gs=0:bs=0.02',
  ],
  
  // Deep shadow contrast: rich blacks, high drama
  deep_shadow_contrast: [
    'eq=contrast=1.25:brightness=-0.05',
    'curves=preset=increase_contrast',
  ],
  
  // Monochrome harsh: stark B&W
  monochrome_harsh: [
    'hue=s=0',                                  // Full desaturate
    'eq=contrast=1.3:brightness=-0.02',
    'curves=preset=strong_contrast',
  ],
  
  // Amber decay: aged, oxidized
  amber_decay: [
    'eq=saturation=0.7',
    'colorbalance=rs=0.12:gs=0.06:bs=-0.1',    // Warm amber
    'curves=preset=vintage',
  ],
  
  // Blue black void: cold emptiness
  blue_black_void: [
    'eq=saturation=0.5:brightness=-0.08',
    'colorbalance=rs=-0.1:gs=-0.08:bs=0.15',   // Deep blue
    'curves=master=0/0 0.2/0.15 0.8/0.85 1/1',
  ],
};

// =====================================================
// TEXTURE ARTIFACTS → OVERLAY FILTERS
// =====================================================

/**
 * Map texture_artifacts to FFmpeg noise/overlay filters
 * These are cumulative (multiple can be applied)
 */
const TEXTURE_ARTIFACT_FILTERS = {
  // Film grain: classic cinema noise
  film_grain: [
    'noise=c0s=12:c1s=8:c0f=t+u',
  ],
  
  // Scanlines: CRT monitor effect
  scanlines: [
    // Interlace-like effect using format and blend
    'eq=contrast=1.1',
    'noise=c0s=5:c0f=t',
  ],
  
  // Tracking noise: VHS horizontal distortion
  tracking_noise: [
    'noise=c0s=18:c0f=t',
    'unsharp=3:3:-0.4',
  ],
  
  // Compression noise: digital artifacts
  compression_noise: [
    'noise=c0s=6:c0f=u',  // Uniform noise (more digital feel)
  ],
  
  // Fog bloom: atmospheric haze
  fog_bloom: [
    'gblur=sigma=0.5',                    // Subtle bloom
    'eq=brightness=0.02:contrast=0.98',   // Lifted blacks
  ],
  
  // Dust scratches: aged film
  dust_scratches: [
    'noise=c0s=3:c0f=a',                  // Averaging noise
    'eq=contrast=1.05',
  ],
  
  // Vignette heavy: dark corners
  vignette_heavy: [
    'vignette=PI/4',
  ],
  
  // Chromatic aberration: RGB split
  chromatic_aberration: [
    'rgbashift=rh=-2:bh=2',               // Horizontal RGB split
  ],
};

// =====================================================
// LIGHTING PROFILE → BRIGHTNESS/CONTRAST
// =====================================================

/**
 * Map lighting_profile to exposure adjustments
 */
const LIGHTING_PROFILE_FILTERS = {
  // Moonlit fog: diffused silver light
  moonlit_fog: [
    'eq=brightness=0.02:contrast=0.92',
    'colorbalance=rs=-0.03:gs=-0.02:bs=0.05',
    'gblur=sigma=0.3',
  ],
  
  // Fluorescent flat: harsh institutional
  fluorescent_flat: [
    'eq=contrast=1.1',
    'colorbalance=gs=0.05',               // Slight green cast
  ],
  
  // Low key shadow: dramatic single source
  low_key_shadow: [
    'eq=contrast=1.2:brightness=-0.08',
    'curves=master=0/0 0.3/0.2 0.7/0.8 1/1',
  ],
  
  // Blown highlights: overexposed areas
  blown_highlights: [
    'eq=brightness=0.08:contrast=1.15',
    'curves=highlights=0.95',
  ],
  
  // Single source harsh: stark shadows
  single_source_harsh: [
    'eq=contrast=1.3:brightness=-0.05',
  ],
  
  // Twilight amber: golden hour fading
  twilight_amber: [
    'eq=saturation=0.9',
    'colorbalance=rs=0.1:gs=0.05:bs=-0.08',
  ],
  
  // Deep darkness: minimal light
  deep_darkness: [
    'eq=brightness=-0.12:contrast=1.1',
    'curves=master=0/0 0.4/0.25 1/0.9',   // Crushed shadows
  ],
};

// =====================================================
// PLATFORM ADJUSTMENTS
// =====================================================

/**
 * Apply platform-specific tweaks on top of Visual DNA
 */
const PLATFORM_ADJUSTMENTS = {
  reels: {
    motion_multiplier: 0.8,
    additional_filters: [
      'eq=contrast=1.05',  // Slight punch for Instagram
    ],
  },
  
  tiktok: {
    motion_multiplier: 1.2,
    additional_filters: [
      'noise=c0s=4:c0f=u', // Slight compression feel
    ],
  },
  
  shorts: {
    motion_multiplier: 1.0,
    additional_filters: [
      'eq=brightness=0.02', // Slightly brighter for small screens
    ],
  },
  
  default: {
    motion_multiplier: 1.0,
    additional_filters: [],
  },
};

// =====================================================
// RENDER BUDGET GUARD
// =====================================================

/**
 * Expensive filter combinations that can cause memory issues:
 * - High resolution (≥1080x1920) + motion + noise = danger zone
 * 
 * Strategy: downscale early → process → upscale late (or keep lower res)
 */
const RENDER_BUDGET_THRESHOLDS = {
  // Resolution thresholds
  HIGH_RES_WIDTH: 1080,
  HIGH_RES_HEIGHT: 1920,
  
  // Safe processing resolution
  SAFE_WIDTH: 900,
  SAFE_HEIGHT: 1600,
  
  // Filter cost estimates (arbitrary units)
  COST_NOISE: 3,
  COST_ZOOM: 4,
  COST_BLUR: 2,
  COST_COLOR: 1,
  COST_VIGNETTE: 1,
  
  // Budget limit before downscaling
  MAX_BUDGET: 10,
};

/**
 * Calculate render budget for a Visual DNA configuration
 * Returns budget info and whether downscaling is recommended
 */
function calculateRenderBudget(visualDNA, width = 1080, height = 1920) {
  if (!visualDNA) {
    return { cost: 0, overBudget: false, recommendation: 'proceed' };
  }
  
  let cost = 0;
  const costBreakdown = [];
  
  // Resolution factor
  const isHighRes = width >= RENDER_BUDGET_THRESHOLDS.HIGH_RES_WIDTH && 
                    height >= RENDER_BUDGET_THRESHOLDS.HIGH_RES_HEIGHT;
  const resFactor = isHighRes ? 1.5 : 1.0;
  
  // Motion cost
  if (visualDNA.motion_profile && visualDNA.motion_profile !== 'none') {
    cost += RENDER_BUDGET_THRESHOLDS.COST_ZOOM * resFactor;
    costBreakdown.push(`motion_profile (${visualDNA.motion_profile}): +${RENDER_BUDGET_THRESHOLDS.COST_ZOOM * resFactor}`);
  }
  
  // Texture artifacts cost
  if (visualDNA.texture_artifacts) {
    for (const artifact of visualDNA.texture_artifacts) {
      if (['film_grain', 'tracking_noise', 'compression_noise'].includes(artifact)) {
        cost += RENDER_BUDGET_THRESHOLDS.COST_NOISE * resFactor;
        costBreakdown.push(`noise artifact (${artifact}): +${RENDER_BUDGET_THRESHOLDS.COST_NOISE * resFactor}`);
      }
      if (['fog_bloom', 'chromatic_aberration'].includes(artifact)) {
        cost += RENDER_BUDGET_THRESHOLDS.COST_BLUR * resFactor;
        costBreakdown.push(`blur artifact (${artifact}): +${RENDER_BUDGET_THRESHOLDS.COST_BLUR * resFactor}`);
      }
    }
  }
  
  // Style-based cost
  if (['VHS_degraded', 'found_footage', 'surveillance_footage'].includes(visualDNA.visual_style)) {
    cost += RENDER_BUDGET_THRESHOLDS.COST_NOISE;  // These add noise
    costBreakdown.push(`style (${visualDNA.visual_style}): +${RENDER_BUDGET_THRESHOLDS.COST_NOISE}`);
  }
  
  // Lighting cost
  if (['moonlit_fog', 'low_key_shadow'].includes(visualDNA.lighting_profile)) {
    cost += RENDER_BUDGET_THRESHOLDS.COST_BLUR;
    costBreakdown.push(`lighting (${visualDNA.lighting_profile}): +${RENDER_BUDGET_THRESHOLDS.COST_BLUR}`);
  }
  
  const overBudget = cost > RENDER_BUDGET_THRESHOLDS.MAX_BUDGET;
  let recommendation = 'proceed';
  
  if (overBudget && isHighRes) {
    recommendation = 'downscale_early';
  } else if (cost > RENDER_BUDGET_THRESHOLDS.MAX_BUDGET * 0.8) {
    recommendation = 'reduce_quality';
  }
  
  return {
    cost: Math.round(cost * 10) / 10,
    budget: RENDER_BUDGET_THRESHOLDS.MAX_BUDGET,
    overBudget,
    recommendation,
    costBreakdown,
    suggestedResolution: overBudget ? {
      width: RENDER_BUDGET_THRESHOLDS.SAFE_WIDTH,
      height: RENDER_BUDGET_THRESHOLDS.SAFE_HEIGHT,
    } : null,
  };
}

/**
 * Build downscale-early filter for expensive renders
 * Strategy: scale down → process → scale up (or keep lower for social)
 */
function buildBudgetAwareFilters(visualDNA, targetWidth, targetHeight, options = {}) {
  const budget = calculateRenderBudget(visualDNA, targetWidth, targetHeight);
  
  if (budget.recommendation === 'downscale_early') {
    console.log(`[BUDGET] ⚠️ Over budget (${budget.cost}/${budget.budget}), recommending downscale`);
    console.log(`[BUDGET] Cost breakdown:`);
    budget.costBreakdown.forEach(line => console.log(`[BUDGET]   ${line}`));
    
    const safeW = budget.suggestedResolution.width;
    const safeH = budget.suggestedResolution.height;
    
    // Prepend downscale, append upscale
    return {
      prependFilter: `scale=${safeW}:${safeH}:flags=lanczos`,
      appendFilter: `scale=${targetWidth}:${targetHeight}:flags=lanczos`,
      processWidth: safeW,
      processHeight: safeH,
      budgetInfo: budget,
    };
  }
  
  return {
    prependFilter: null,
    appendFilter: null,
    processWidth: targetWidth,
    processHeight: targetHeight,
    budgetInfo: budget,
  };
}

// =====================================================
// MAIN FILTER BUILDER
// =====================================================

/**
 * Build complete FFmpeg filter graph from Visual DNA
 * 
 * @param {Object} visualDNA - The Visual DNA object
 * @param {Object} options - Additional options (lowMemory, etc.)
 * @returns {Object} Filter configuration
 */
function buildFFmpegFiltersFromVisualDNA(visualDNA, options = {}) {
  const { lowMemory = false, skipMotion = false } = options;
  
  if (!visualDNA) {
    console.log('[PRESETS] No Visual DNA provided, using defaults');
    return { filters: [], kenBurnsOverride: null };
  }
  
  console.log(`[PRESETS] Building FFmpeg filters from Visual DNA:`);
  console.log(`[PRESETS]   Style: ${visualDNA.visual_style}`);
  console.log(`[PRESETS]   Palette: ${visualDNA.color_palette}`);
  console.log(`[PRESETS]   Motion: ${visualDNA.motion_profile}`);
  console.log(`[PRESETS]   Lighting: ${visualDNA.lighting_profile}`);
  console.log(`[PRESETS]   Artifacts: ${visualDNA.texture_artifacts?.join(', ') || 'none'}`);
  console.log(`[PRESETS]   Platform: ${visualDNA.platform}`);
  
  const filters = [];
  
  // 1. Apply visual style base
  const styleFilters = VISUAL_STYLE_FILTERS[visualDNA.visual_style];
  if (styleFilters) {
    filters.push(...styleFilters);
    console.log(`[PRESETS]   + Visual style filters (${styleFilters.length})`);
  }
  
  // 2. Apply color palette (may overlap with style, FFmpeg handles it)
  const paletteFilters = COLOR_PALETTE_FILTERS[visualDNA.color_palette];
  if (paletteFilters) {
    // Avoid duplicate eq filters - merge intelligently
    const hasEq = filters.some(f => f.startsWith('eq='));
    const paletteEq = paletteFilters.find(f => f.startsWith('eq='));
    
    if (hasEq && paletteEq) {
      // Skip palette eq, style eq takes precedence
      filters.push(...paletteFilters.filter(f => !f.startsWith('eq=')));
    } else {
      filters.push(...paletteFilters);
    }
    console.log(`[PRESETS]   + Color palette filters`);
  }
  
  // 3. Apply lighting profile
  const lightingFilters = LIGHTING_PROFILE_FILTERS[visualDNA.lighting_profile];
  if (lightingFilters && !lowMemory) {
    // Only add non-duplicate lighting adjustments
    filters.push(...lightingFilters.filter(f => 
      !f.startsWith('eq=') || !filters.some(ef => ef.startsWith('eq='))
    ));
    console.log(`[PRESETS]   + Lighting profile filters`);
  }
  
  // 4. Apply texture artifacts (cumulative)
  if (visualDNA.texture_artifacts && visualDNA.texture_artifacts.length > 0) {
    for (const artifact of visualDNA.texture_artifacts) {
      const artifactFilters = TEXTURE_ARTIFACT_FILTERS[artifact];
      if (artifactFilters) {
        // Avoid duplicate vignette
        if (artifact === 'vignette_heavy' && filters.some(f => f.includes('vignette'))) {
          continue;
        }
        filters.push(...artifactFilters);
      }
    }
    console.log(`[PRESETS]   + Texture artifacts (${visualDNA.texture_artifacts.length})`);
  }
  
  // 5. Apply platform adjustments
  const platformConfig = PLATFORM_ADJUSTMENTS[visualDNA.platform] || PLATFORM_ADJUSTMENTS.default;
  if (platformConfig.additional_filters.length > 0) {
    filters.push(...platformConfig.additional_filters);
    console.log(`[PRESETS]   + Platform adjustments (${visualDNA.platform})`);
  }
  
  // 6. Get motion profile for Ken Burns override
  let kenBurnsOverride = null;
  if (!skipMotion && visualDNA.motion_profile !== 'none') {
    const motionConfig = MOTION_PROFILE_FILTERS[visualDNA.motion_profile];
    if (motionConfig) {
      kenBurnsOverride = {
        profile: visualDNA.motion_profile,
        config: motionConfig,
        multiplier: platformConfig.motion_multiplier,
      };
      console.log(`[PRESETS]   + Motion profile: ${visualDNA.motion_profile}`);
    }
  }
  
  // Low memory mode: reduce filter complexity
  if (lowMemory) {
    // Keep only essential filters
    const essentialFilters = filters.filter(f => 
      f.startsWith('eq=') || 
      f.startsWith('colorbalance=') || 
      f.startsWith('vignette') ||
      f.startsWith('noise=c0s=') // Keep basic noise only
    );
    console.log(`[PRESETS]   Low memory mode: reduced from ${filters.length} to ${essentialFilters.length} filters`);
    return { filters: essentialFilters, kenBurnsOverride };
  }
  
  // Deduplicate and optimize filter order
  const optimizedFilters = optimizeFilterChain(filters);
  console.log(`[PRESETS]   Final filter count: ${optimizedFilters.length}`);
  
  return { filters: optimizedFilters, kenBurnsOverride };
}

/**
 * Optimize filter chain for FFmpeg efficiency
 * - Remove duplicates
 * - Order filters optimally (color first, noise last)
 */
function optimizeFilterChain(filters) {
  // Remove exact duplicates
  const unique = [...new Set(filters)];
  
  // Categorize filters
  const colorFilters = unique.filter(f => 
    f.startsWith('eq=') || 
    f.startsWith('colorbalance=') || 
    f.startsWith('hue=') ||
    f.startsWith('curves=')
  );
  const noiseFilters = unique.filter(f => 
    f.startsWith('noise=') || 
    f.startsWith('rgbashift=')
  );
  const blurFilters = unique.filter(f => 
    f.startsWith('gblur=') || 
    f.startsWith('unsharp=')
  );
  const otherFilters = unique.filter(f => 
    !colorFilters.includes(f) && 
    !noiseFilters.includes(f) && 
    !blurFilters.includes(f)
  );
  
  // Optimal order: color → other → blur → noise → vignette
  const vignetteFilters = otherFilters.filter(f => f.includes('vignette'));
  const nonVignetteOther = otherFilters.filter(f => !f.includes('vignette'));
  
  return [
    ...colorFilters,
    ...nonVignetteOther,
    ...blurFilters,
    ...noiseFilters,
    ...vignetteFilters,
  ];
}

/**
 * Build Ken Burns filter with Visual DNA motion profile
 * 
 * @param {number} index - Scene index
 * @param {number} duration - Scene duration in seconds
 * @param {Object} motionOverride - Motion profile override from Visual DNA
 * @param {number} width - Output width
 * @param {number} height - Output height
 * @param {boolean} lowMemory - Low memory mode
 * @returns {string} FFmpeg zoompan filter string
 */
function buildKenBurnsWithMotionProfile(index, duration, motionOverride, width = 1080, height = 1920, lowMemory = false) {
  const frames = Math.floor(duration * (lowMemory ? 15 : 30));
  const fps = lowMemory ? 15 : 30;
  const scaleFactor = lowMemory ? 1.1 : 2;
  const scaledW = Math.floor(width * scaleFactor);
  const scaledH = Math.floor(height * scaleFactor);
  
  if (!motionOverride || !motionOverride.config) {
    // Fallback to standard Ken Burns
    return null;
  }
  
  const config = motionOverride.config;
  const multiplier = motionOverride.multiplier || 1.0;
  
  if (config.type === 'crop' && config.fallback) {
    // Micro jitter: use fallback that doesn't require random()
    const base = `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH}`;
    return `${base},${config.fallback.replace(/{frames}/g, String(frames))},scale=${width}:${height}`;
  }
  
  if (config.type === 'zoompan') {
    // Build zoompan with motion profile expressions
    const xExpr = config.x_expr.replace(/{frames}/g, String(frames));
    const yExpr = config.y_expr.replace(/{frames}/g, String(frames));
    const zExpr = config.zoom_expr.replace(/{frames}/g, String(frames));
    
    return `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='${zExpr}':d=${frames}:x='${xExpr}':y='${yExpr}':s=${width}x${height}:fps=${fps}`;
  }
  
  return null;
}

/**
 * Get effect flags from Visual DNA
 * Maps Visual DNA to existing effect booleans for backward compatibility
 */
function getEffectFlagsFromVisualDNA(visualDNA) {
  if (!visualDNA) return {};
  
  const flags = {
    kenBurns: true,  // Always use Ken Burns with DNA
    vignette: visualDNA.texture_artifacts?.includes('vignette_heavy'),
    horrorGrade: visualDNA.color_palette === 'cold_desaturated' || 
                 visualDNA.color_palette === 'blue_black_void' ||
                 visualDNA.color_palette === 'deep_shadow_contrast',
    filmGrain: visualDNA.texture_artifacts?.includes('film_grain'),
    scanlines: visualDNA.texture_artifacts?.includes('scanlines'),
    vhsTracking: visualDNA.visual_style === 'VHS_degraded' ||
                 visualDNA.texture_artifacts?.includes('tracking_noise'),
    glitchFlicker: visualDNA.visual_style === 'surveillance_footage',
    lightFlicker: visualDNA.lighting_profile === 'single_source_harsh' ||
                  visualDNA.lighting_profile === 'moonlit_fog',
    coldColorCreep: visualDNA.color_palette === 'cold_desaturated' ||
                    visualDNA.color_palette === 'blue_black_void',
    fadeIn: true,
    fadeOut: true,
    captionStyle: visualDNA.visual_style === 'VHS_degraded' ? 'vintage' :
                  visualDNA.visual_style === 'surveillance_footage' ? 'typewriter' :
                  visualDNA.color_palette === 'monochrome_harsh' ? 'shadow' :
                  'bold',
  };
  
  return flags;
}

/**
 * Apply Visual DNA filters as a single complex filter
 * This is more efficient than multiple filter passes
 */
function buildCombinedFilterGraph(visualDNA, options = {}) {
  const { filters, kenBurnsOverride } = buildFFmpegFiltersFromVisualDNA(visualDNA, options);
  
  if (filters.length === 0) {
    return null;
  }
  
  // Combine into single filter chain
  return filters.join(',');
}

// =====================================================
// BRAND SHADOW PROFILES
// =====================================================

/**
 * Shadow profiles define the allowed visual identity range per brand/genre.
 * Maintains brand consistency while allowing enough rotation to avoid sameness.
 * 
 * v4.0: Only two active story engines - urban_legend and one_too_many
 * Deprecated presets (analog_horror, cosmic_horror, true_crime) map to urban_legend
 * at the DNA layer, so they'll use the urban_legend shadow profile.
 * 
 * Usage: When forcing variety, respect these constraints.
 */
const DEFAULT_SHADOW_PROFILES = {
  // Urban legend: style can rotate, but within limits
  // This is the primary/default engine for most horror content
  urban_legend: {
    locked_visual_style: null,  // Can rotate
    preferred_styles: ['cinematic_dark', 'documentary_archival', 'found_footage', 'VHS_degraded'],
    allowed_palettes: ['deep_shadow_contrast', 'cold_desaturated', 'amber_decay', 'muted_gray', 'sickly_green'],
    allowed_motions: ['slow_pan', 'subtle_zoom', 'none', 'slow_drift', 'micro_jitter'],
    allowed_lightings: ['low_key_shadow', 'twilight_amber', 'single_source_harsh', 'moonlit_fog', 'fluorescent_flat'],
    texture_pool: ['film_grain', 'dust_scratches', 'vignette_heavy', 'scanlines'],
  },
  
  // One Too Many: counting horror - documentary witness style
  // Focused on group settings, paranoid atmosphere
  one_too_many: {
    locked_visual_style: null,
    preferred_styles: ['documentary_archival', 'found_footage', 'surveillance_footage', 'cinematic_dark'],
    allowed_palettes: ['cold_desaturated', 'muted_gray', 'deep_shadow_contrast', 'blue_black_void'],
    allowed_motions: ['none', 'slow_pan', 'subtle_zoom', 'slow_drift'],
    allowed_lightings: ['low_key_shadow', 'fluorescent_flat', 'single_source_harsh'],
    texture_pool: ['film_grain', 'compression_noise', 'vignette_heavy'],
  },

  // Dark Origins: documentary dark biographies / serial killer deep dives
  // Noir aesthetic with heavy desaturation, evidence-style framing
  dark_origins: {
    locked_visual_style: null,
    preferred_styles: ['noir_documentary', 'documentary_archival', 'cinematic_dark', 'found_footage'],
    allowed_palettes: ['deep_shadow_contrast', 'cold_desaturated', 'amber_decay', 'muted_gray'],
    allowed_motions: ['slow_pan', 'subtle_zoom', 'slow_drift', 'none'],
    allowed_lightings: ['low_key_shadow', 'single_source_harsh', 'twilight_amber', 'fluorescent_flat'],
    texture_pool: ['film_grain', 'dust_scratches', 'vignette_heavy', 'scanlines'],
  },
};

/**
 * Get shadow profile for a genre
 * Returns allowed rotation ranges for variety forcing
 */
function getShadowProfile(genre) {
  return DEFAULT_SHADOW_PROFILES[genre] || {
    locked_visual_style: null,
    allowed_palettes: Object.keys(COLOR_PALETTE_FILTERS),
    allowed_motions: Object.keys(MOTION_PROFILE_FILTERS).filter(m => m !== 'none'),
    allowed_lightings: Object.keys(LIGHTING_PROFILE_FILTERS),
    texture_pool: Object.keys(TEXTURE_ARTIFACT_FILTERS),
  };
}

/**
 * Get variety suggestions respecting shadow profile
 * Used when forcing variety to prevent sameness
 */
function getVarietySuggestions(genre, currentDNA, excludeRecent = []) {
  const profile = getShadowProfile(genre);
  
  const suggestions = {
    visual_style: profile.locked_visual_style 
      ? null  // Can't change
      : (profile.preferred_styles || Object.keys(VISUAL_STYLE_FILTERS))
          .filter(s => s !== currentDNA?.visual_style && !excludeRecent.includes(s)),
    
    color_palette: profile.allowed_palettes
      .filter(p => p !== currentDNA?.color_palette && !excludeRecent.includes(p)),
    
    motion_profile: profile.allowed_motions
      .filter(m => m !== currentDNA?.motion_profile && !excludeRecent.includes(m)),
    
    lighting_profile: profile.allowed_lightings
      .filter(l => l !== currentDNA?.lighting_profile && !excludeRecent.includes(l)),
  };
  
  return suggestions;
}

// =====================================================
// EFFECTS PROFILE → FFMPEG FILTERS (v3.1)
// Intensity-based filter generation
// =====================================================

/**
 * Build vignette filter with intensity control
 * @param {number} intensity - 0.0 to 1.0 (0=none, 1=max)
 * @param {number} radius - 0.0 to 1.0 (how far from center)
 * @param {number} softness - 0.0 to 1.0 (edge softness)
 * @returns {string} FFmpeg vignette filter string
 */
function buildVignetteFilter(intensity = 0.5, radius = 0.8, softness = 0.5) {
  if (intensity <= 0) return null;
  // FFmpeg vignette: vignette=angle:x0:y0:mode
  // angle controls darkness: PI/4 = subtle, PI/2 = strong
  // Map intensity 0-1 to angle PI/8 to PI/2
  const angle = (Math.PI / 8) + (intensity * (Math.PI / 2 - Math.PI / 8));
  // Map softness to mode: 0=forward (sharper), 1=same (softer)
  const mode = softness > 0.5 ? 'forward' : 'forward';
  return `vignette=${angle.toFixed(4)}`;
}

/**
 * Build film grain filter with intensity control
 * @param {number} intensity - 0.0 to 1.0
 * @param {number} size - 0.5 to 2.0 (grain particle size)
 * @param {boolean} colorNoise - true for color noise, false for monochrome
 * @returns {string} FFmpeg noise filter string
 */
function buildFilmGrainFilter(intensity = 0.3, size = 1.0, colorNoise = false) {
  if (intensity <= 0) return null;
  // Map intensity 0-1 to noise strength 5-35
  const strength = Math.round(5 + intensity * 30);
  // c0s = luma strength, c1s = chroma strength (for color noise)
  if (colorNoise) {
    const chromaStrength = Math.round(strength * 0.7);
    return `noise=c0s=${strength}:c1s=${chromaStrength}:c0f=t+u`;
  } else {
    return `noise=c0s=${strength}:c0f=t`;
  }
}

/**
 * Build scanlines filter with intensity control
 * @param {number} intensity - 0.0 to 1.0
 * @param {number} spacing - 1-4 (pixels between lines)
 * @param {number} thickness - 0.5 to 2.0
 * @returns {string} FFmpeg filter for scanline effect
 */
function buildScanlinesFilter(intensity = 0.3, spacing = 2, thickness = 1.0) {
  if (intensity <= 0) return null;
  // Scanlines via drawbox overlay or interlace-like effect
  // Using eq + noise combination for scanline-like effect
  const contrast = 1.0 + (intensity * 0.15);  // Slight contrast boost
  const noiseStr = Math.round(3 + intensity * 8);
  return `eq=contrast=${contrast.toFixed(2)},noise=c0s=${noiseStr}:c0f=t`;
}

/**
 * Build VHS/tracking noise filter with intensity control
 * @param {object} config - { tracking_noise, color_bleed, tape_crinkle, jitter }
 * @returns {string} FFmpeg filter chain for VHS effect
 */
function buildVHSFilter(config = {}) {
  const {
    tracking_noise = 0.3,
    color_bleed = 0.4,
    tape_crinkle = 0.2,
    jitter = 0.2,
    intensity = 0.5
  } = config;
  
  if (intensity <= 0) return null;
  
  const filters = [];
  
  // Tracking noise via noise filter
  if (tracking_noise > 0) {
    const noiseStr = Math.round(8 + (tracking_noise * intensity * 20));
    filters.push(`noise=c0s=${noiseStr}:c0f=t`);
  }
  
  // Color bleed via chromatic aberration (RGB shift)
  if (color_bleed > 0) {
    const shift = Math.round(1 + (color_bleed * intensity * 4));
    filters.push(`rgbashift=rh=-${shift}:bh=${shift}`);
  }
  
  // Softness/blur for tape degradation
  if (tape_crinkle > 0.3) {
    filters.push('unsharp=3:3:-0.3');
  }
  
  // Desaturation
  const saturation = 0.9 - (intensity * 0.25);
  filters.push(`eq=saturation=${saturation.toFixed(2)}`);
  
  return filters.join(',');
}

/**
 * Build glitch filter with intensity control
 * @param {object} config - { frequency, duration, rgb_shift, block_shift }
 * @returns {string} FFmpeg filter for glitch effect
 */
function buildGlitchFilter(config = {}) {
  const {
    frequency = 0.1,
    rgb_shift = 0.3,
    intensity = 0.4
  } = config;
  
  if (intensity <= 0) return null;
  
  const filters = [];
  
  // RGB shift for chromatic aberration glitch
  if (rgb_shift > 0) {
    const shift = Math.round(2 + (rgb_shift * intensity * 8));
    filters.push(`rgbashift=rh=${shift}:gh=-${Math.floor(shift/2)}:bh=-${shift}`);
  }
  
  // Add noise for digital artifact feel
  const noiseStr = Math.round(6 + (intensity * 15));
  filters.push(`noise=c0s=${noiseStr}:c0f=u`);  // Uniform noise for digital feel
  
  return filters.join(',');
}

/**
 * Build color grading filter with intensity control
 * @param {object} config - { preset, contrast, saturation, brightness, temperature, intensity }
 * @returns {string} FFmpeg filter chain for color grading
 */
function buildColorGradeFilter(config = {}) {
  const {
    preset = 'cinematic',
    contrast = 1.1,
    saturation = 0.9,
    brightness = 1.0,
    temperature = 0,
    intensity = 0.5
  } = config;
  
  if (intensity <= 0) return null;
  
  // Apply intensity scaling to adjustments
  const scaledContrast = 1.0 + ((contrast - 1.0) * intensity);
  const scaledSaturation = 1.0 + ((saturation - 1.0) * intensity);
  const scaledBrightness = ((brightness - 1.0) * intensity);
  
  const filters = [];
  
  // Base eq filter
  filters.push(`eq=saturation=${scaledSaturation.toFixed(2)}:contrast=${scaledContrast.toFixed(2)}:brightness=${scaledBrightness.toFixed(3)}`);
  
  // Temperature (cool blue = negative, warm orange = positive)
  if (Math.abs(temperature) > 0.05) {
    const tempScale = temperature * intensity;
    // Positive = warm (more red/yellow), negative = cool (more blue)
    const rs = tempScale > 0 ? tempScale * 0.08 : 0;
    const bs = tempScale < 0 ? Math.abs(tempScale) * 0.1 : 0;
    filters.push(`colorbalance=rs=${rs.toFixed(3)}:bs=${bs.toFixed(3)}`);
  }
  
  // Preset-specific adjustments
  switch (preset) {
    case 'horror_cold':
      filters.push('colorbalance=rs=-0.05:gs=-0.03:bs=0.08');
      break;
    case 'vhs_degraded':
      filters.push('colorbalance=gs=0.06');
      break;
    case 'noir':
      // Additional contrast curve for noir look
      break;
    case 'cinematic_dark':
      filters.push('colorbalance=rs=-0.02:bs=0.04');
      break;
    case 'surveillance':
      filters.push('colorbalance=gs=0.05');
      break;
    default:
      // No additional preset filters
      break;
  }
  
  return filters.join(',');
}

/**
 * Safely clamp a number to [min, max], coercing NaN/null/undefined to default
 */
function safeClamp(value, defaultVal, min = 0, max = 1) {
  if (value === null || value === undefined || isNaN(Number(value))) {
    return defaultVal;
  }
  return Math.max(min, Math.min(max, Number(value)));
}

/**
 * normalizeEffectsConfig(raw)
 *
 * Single-point clamp + sanitize for effects_config before it reaches any builder.
 * Guarantees every numeric field is a finite number within safe FFmpeg ranges.
 * Call once at the renderer entry point — individual builders can then trust the values.
 *
 * Two-pass clamping:
 *   Pass 1 — System-level safe ranges (hard limits, never exceeded):
 *     intensity:           0 – 1
 *     kenburns.zoom_range: each element 1.0 – 1.5
 *     kenburns.pan_speed:  0 – 0.6
 *     grain.intensity:     0 – 0.5
 *     grain.size:          0.5 – 2.0
 *     flicker.intensity:   0 – 0.5
 *     flicker.frequency:   0.05 – 2.0
 *     vignette.intensity:  0 – 1
 *     color_grade.intensity: 0 – 1
 *     fade.duration:       0.1 – 5.0
 *
 *   Pass 2 — Brand-level ceilings (optional, always tighter than system):
 *     Extracted from raw.limits — presets can request effects, brand caps them.
 *     Example: { "limits": { "grain": { "max_intensity": 0.25 } } }
 *     The brand says "no matter the preset, grain never exceeds 25%."
 *
 * @param {Object} raw - The effects_config object (may be from untrusted worker payload)
 * @returns {Object} A deep-cloned config with every numeric field clamped to safe ranges
 */
function normalizeEffectsConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;

  // Extract brand-level ceilings (applied AFTER system clamping)
  const limits = (raw.limits && typeof raw.limits === 'object') ? raw.limits : null;

  const cfg = {};

  // ── Pass 1: System-level safe ranges ──────────────────────────────────

  // Top-level
  cfg.enabled = raw.enabled === true;
  cfg.intensity = safeClamp(raw.intensity, 0.5, 0, 1);

  // Ken Burns
  if (raw.kenburns && typeof raw.kenburns === 'object') {
    const kb = raw.kenburns;
    cfg.kenburns = {
      enabled: kb.enabled !== false,
      zoom_range: [
        safeClamp(Array.isArray(kb.zoom_range) ? kb.zoom_range[0] : 1.0, 1.0, 1.0, 1.5),
        safeClamp(Array.isArray(kb.zoom_range) ? kb.zoom_range[1] : 1.12, 1.0, 1.0, 1.5),
      ],
      pan_speed: safeClamp(kb.pan_speed, 0.4, 0, 0.6),
      direction: ['alternate', 'in', 'out', 'random', 'pan-left', 'pan-right', 'pan-up', 'pan-down']
        .includes(kb.direction) ? kb.direction : 'alternate',
    };
  } else {
    cfg.kenburns = { enabled: true, zoom_range: [1.0, 1.12], pan_speed: 0.4, direction: 'alternate' };
  }

  // Grain
  if (raw.grain && typeof raw.grain === 'object') {
    cfg.grain = {
      enabled: raw.grain.enabled === true,
      intensity: safeClamp(raw.grain.intensity, 0.0, 0, 0.5),
      size: safeClamp(raw.grain.size, 1.0, 0.5, 2.0),
    };
  } else {
    cfg.grain = { enabled: false, intensity: 0, size: 1.0 };
  }

  // Flicker
  if (raw.flicker && typeof raw.flicker === 'object') {
    cfg.flicker = {
      enabled: raw.flicker.enabled === true,
      intensity: safeClamp(raw.flicker.intensity, 0.0, 0, 0.5),
      frequency: safeClamp(raw.flicker.frequency, 0.3, 0.05, 2.0),
    };
  } else {
    cfg.flicker = { enabled: false, intensity: 0, frequency: 0.3 };
  }

  // Vignette
  if (raw.vignette && typeof raw.vignette === 'object') {
    cfg.vignette = {
      enabled: raw.vignette.enabled === true,
      intensity: safeClamp(raw.vignette.intensity, 0.35, 0, 1),
    };
  } else {
    cfg.vignette = { enabled: false, intensity: 0 };
  }

  // Color grade
  if (raw.color_grade && typeof raw.color_grade === 'object') {
    const cg = raw.color_grade;
    cfg.color_grade = {
      enabled: cg.enabled === true,
      preset: ['auto', 'cinematic_dark', 'cold_desaturated', 'vhs_degraded']
        .includes(cg.preset) ? cg.preset : 'auto',
      intensity: safeClamp(cg.intensity, 0.5, 0, 1),
    };
  } else {
    cfg.color_grade = { enabled: false, preset: 'auto', intensity: 0 };
  }

  // Fade
  if (raw.fade && typeof raw.fade === 'object') {
    cfg.fade = {
      fade_in: raw.fade.fade_in !== false,
      fade_out: raw.fade.fade_out !== false,
      duration: safeClamp(raw.fade.duration, 1.5, 0.1, 5.0),
    };
  } else {
    cfg.fade = { fade_in: true, fade_out: true, duration: 1.5 };
  }

  // ── Pass 2: Brand-level ceilings ──────────────────────────────────────
  // Ceilings are tighter caps set by the brand. They never RAISE a value,
  // only lower it. Presets request effects → brand caps them → safe output.
  if (limits) {
    const capped = [];

    // Helper: apply a ceiling, track if it actually capped
    const cap = (obj, key, limitVal, label) => {
      if (limitVal === undefined || limitVal === null) return;
      const max = Number(limitVal);
      if (isNaN(max)) return;
      if (obj[key] > max) {
        obj[key] = Math.max(0, max);
        capped.push(label);
      }
    };

    // Ken Burns ceilings
    if (limits.kenburns && typeof limits.kenburns === 'object') {
      cap(cfg.kenburns, 'pan_speed', limits.kenburns.max_pan_speed, 'kb.pan_speed');
      if (limits.kenburns.max_zoom_range !== undefined) {
        const maxZ = Math.max(1.0, Number(limits.kenburns.max_zoom_range) || 1.0);
        if (cfg.kenburns.zoom_range[0] > maxZ) { cfg.kenburns.zoom_range[0] = maxZ; capped.push('kb.zoom[0]'); }
        if (cfg.kenburns.zoom_range[1] > maxZ) { cfg.kenburns.zoom_range[1] = maxZ; capped.push('kb.zoom[1]'); }
      }
    }

    // Grain ceilings
    if (limits.grain && typeof limits.grain === 'object') {
      cap(cfg.grain, 'intensity', limits.grain.max_intensity, 'grain.intensity');
      cap(cfg.grain, 'size', limits.grain.max_size, 'grain.size');
    }

    // Flicker ceilings
    if (limits.flicker && typeof limits.flicker === 'object') {
      cap(cfg.flicker, 'intensity', limits.flicker.max_intensity, 'flicker.intensity');
      cap(cfg.flicker, 'frequency', limits.flicker.max_frequency, 'flicker.frequency');
    }

    // Vignette ceiling
    if (limits.vignette && typeof limits.vignette === 'object') {
      cap(cfg.vignette, 'intensity', limits.vignette.max_intensity, 'vignette.intensity');
    }

    // Color grade ceiling
    if (limits.color_grade && typeof limits.color_grade === 'object') {
      cap(cfg.color_grade, 'intensity', limits.color_grade.max_intensity, 'color_grade.intensity');
    }

    // Fade ceiling
    if (limits.fade && typeof limits.fade === 'object') {
      cap(cfg.fade, 'duration', limits.fade.max_duration, 'fade.duration');
    }

    // Master intensity ceiling
    if (limits.max_intensity !== undefined) {
      cap(cfg, 'intensity', limits.max_intensity, 'master_intensity');
    }

    // Attach for observability (not forwarded to builders)
    if (capped.length > 0) {
      cfg._limits_applied = capped;
    }
  }

  return cfg;
}

/**
 * Build complete filter chain from effects profile
 * Fail-soft: wraps each effect builder in try/catch, continues on error
 * @param {Object} effectsProfile - Full effects profile with all effect configs
 * @param {Object} options - Additional options (lowMemory, etc.)
 * @returns {Object} { filters: string[], kenBurnsConfig: object }
 */
function buildFiltersFromEffectsProfile(effectsProfile, options = {}) {
  // Fail-soft: if profile missing/invalid, return empty (don't throw)
  if (!effectsProfile || typeof effectsProfile !== 'object') {
    console.warn('[ffmpeg_presets] Effects profile missing or invalid, using no effects');
    return { filters: [], kenBurnsConfig: null };
  }
  
  const { lowMemory = false } = options;
  const filters = [];
  let kenBurnsConfig = null;
  const failedEffects = [];
  
  // Color grading (applied first for base look)
  if (effectsProfile.color_grade?.enabled) {
    try {
      const colorFilter = buildColorGradeFilter(effectsProfile.color_grade);
      if (colorFilter) filters.push(colorFilter);
    } catch (err) {
      failedEffects.push('color_grade');
      console.warn('[ffmpeg_presets] color_grade builder failed:', err.message);
    }
  }
  
  // Vignette
  if (effectsProfile.vignette?.enabled) {
    try {
      const vignetteFilter = buildVignetteFilter(
        safeClamp(effectsProfile.vignette.intensity, 0.5, 0, 1),
        safeClamp(effectsProfile.vignette.radius, 0.8, 0, 1),
        safeClamp(effectsProfile.vignette.softness, 0.5, 0, 1)
      );
      if (vignetteFilter) filters.push(vignetteFilter);
    } catch (err) {
      failedEffects.push('vignette');
      console.warn('[ffmpeg_presets] vignette builder failed:', err.message);
    }
  }
  
  // Film grain
  if (effectsProfile.film_grain?.enabled && !lowMemory) {
    try {
      const grainFilter = buildFilmGrainFilter(
        safeClamp(effectsProfile.film_grain.intensity, 0.3, 0, 1),
        safeClamp(effectsProfile.film_grain.size, 1.0, 0.5, 2.0),
        effectsProfile.film_grain.color || false
      );
      if (grainFilter) filters.push(grainFilter);
    } catch (err) {
      failedEffects.push('film_grain');
      console.warn('[ffmpeg_presets] film_grain builder failed:', err.message);
    }
  }
  
  // Scanlines
  if (effectsProfile.scanlines?.enabled && !lowMemory) {
    try {
      const scanlinesFilter = buildScanlinesFilter(
        safeClamp(effectsProfile.scanlines.intensity, 0.3, 0, 1),
        safeClamp(effectsProfile.scanlines.spacing, 2, 1, 8),
        safeClamp(effectsProfile.scanlines.thickness, 1.0, 0.5, 2.0)
      );
      if (scanlinesFilter) filters.push(scanlinesFilter);
    } catch (err) {
      failedEffects.push('scanlines');
      console.warn('[ffmpeg_presets] scanlines builder failed:', err.message);
    }
  }
  
  // VHS effect
  if (effectsProfile.vhs?.enabled && !lowMemory) {
    try {
      // Clamp all VHS params
      const vhsConfig = {
        tracking_noise: safeClamp(effectsProfile.vhs.tracking_noise, 0.3, 0, 1),
        color_bleed: safeClamp(effectsProfile.vhs.color_bleed, 0.4, 0, 1),
        tape_crinkle: safeClamp(effectsProfile.vhs.tape_crinkle, 0.2, 0, 1),
        jitter: safeClamp(effectsProfile.vhs.jitter, 0.2, 0, 1),
        intensity: safeClamp(effectsProfile.vhs.intensity, 0.5, 0, 1),
      };
      const vhsFilter = buildVHSFilter(vhsConfig);
      if (vhsFilter) filters.push(vhsFilter);
    } catch (err) {
      failedEffects.push('vhs');
      console.warn('[ffmpeg_presets] vhs builder failed:', err.message);
    }
  }
  
  // Glitch effect
  if (effectsProfile.glitch?.enabled && !lowMemory) {
    try {
      // Clamp all glitch params
      const glitchConfig = {
        frequency: safeClamp(effectsProfile.glitch.frequency, 0.1, 0, 1),
        rgb_shift: safeClamp(effectsProfile.glitch.rgb_shift, 0.3, 0, 1),
        intensity: safeClamp(effectsProfile.glitch.intensity, 0.4, 0, 1),
      };
      const glitchFilter = buildGlitchFilter(glitchConfig);
      if (glitchFilter) filters.push(glitchFilter);
    } catch (err) {
      failedEffects.push('glitch');
      console.warn('[ffmpeg_presets] glitch builder failed:', err.message);
    }
  }
  
  // Ken Burns config (not a filter, but config for zoompan)
  if (effectsProfile.kenburns?.enabled) {
    try {
      kenBurnsConfig = {
        enabled: true,
        zoom_amount: safeClamp(effectsProfile.kenburns.zoom_amount, 1.12, 1.0, 2.0),
        speed: safeClamp(effectsProfile.kenburns.speed, 0.5, 0, 1),
        direction: effectsProfile.kenburns.direction || 'random',
        intensity: safeClamp(effectsProfile.kenburns.intensity, 0.6, 0, 1),
      };
    } catch (err) {
      failedEffects.push('kenburns');
      console.warn('[ffmpeg_presets] kenburns config failed:', err.message);
    }
  }
  
  if (failedEffects.length > 0) {
    console.warn(`[ffmpeg_presets] ${failedEffects.length} effect(s) failed: ${failedEffects.join(', ')}`);
  }
  
  return {
    filters,
    kenBurnsConfig,
    fadeConfig: effectsProfile.fade || null,
    transitionsConfig: effectsProfile.transitions || null,
  };
}

// =====================================================
// EFFECTS CONFIG v2.0 — Controlled Motion (Roadmap #15)
//
// Builds a complete FFmpeg filter list from the new
// effects_config shape produced by get_effects_config_for_job().
//
// Key guarantees:
//   1. enabled=false disables ALL effects
//   2. intensity (master knob) scales every sub-effect
//   3. All values are clamped to safe ranges
//   4. Seed-based determinism for Ken Burns direction
//   5. Soft failure: returns empty filters on error
// =====================================================

/**
 * Derive a deterministic integer seed from a string (job_id)
 *   djb2 hash → positive int31
 */
function hashSeed(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

/**
 * Build Ken Burns zoompan filter from effects_config.kenburns
 *
 * @param {Object}  kb        – kenburns config { enabled, zoom_range, pan_speed, direction }
 * @param {number}  master    – master intensity 0-1
 * @param {number}  index     – scene index
 * @param {number}  duration  – scene duration (seconds)
 * @param {number}  width     – output width
 * @param {number}  height    – output height
 * @param {string}  seed      – deterministic seed string (job_id)
 * @param {boolean} lowMem    – low memory mode
 * @returns {string|null} FFmpeg filter string or null
 */
function buildKenBurnsFromConfig(kb, master, index, duration, width, height, seed, lowMem) {
  if (!kb || !kb.enabled) return null;

  const fps = lowMem ? 15 : 30;
  const frames = Math.floor(duration * fps);
  const scaleFactor = lowMem ? 1.1 : 2;
  const scaledW = Math.floor(width * scaleFactor);
  const scaledH = Math.floor(height * scaleFactor);

  // Clamp
  const zoomMin = safeClamp(kb.zoom_range?.[0], 1.0, 1.0, 1.5);
  const zoomMax = safeClamp(kb.zoom_range?.[1], 1.12, 1.0, 1.5);
  const panSpeed = safeClamp(kb.pan_speed, 0.4, 0, 1) * master;
  const zoomDelta = (zoomMax - zoomMin) * master;

  // Deterministic direction from seed + scene index
  const dirSeed = hashSeed(`${seed}:${index}`);
  let direction = kb.direction || 'alternate';
  if (direction === 'alternate') {
    direction = index % 2 === 0 ? 'in' : 'out';
  } else if (direction === 'random') {
    // Seed-based choice: in, out, pan-left, pan-right, pan-up, pan-down
    const choices = ['in', 'out', 'pan-left', 'pan-right'];
    direction = choices[dirSeed % choices.length];
  }

  let zExpr, xExpr, yExpr;

  switch (direction) {
    case 'in':
      zExpr = `${zoomMin}+${zoomDelta.toFixed(4)}*on/${frames}`;
      xExpr = '(iw-iw/zoom)/2';
      yExpr = '(ih-ih/zoom)/2';
      break;
    case 'out':
      zExpr = `${(zoomMin + zoomDelta).toFixed(4)}-${zoomDelta.toFixed(4)}*on/${frames}`;
      xExpr = '(iw-iw/zoom)/2';
      yExpr = '(ih-ih/zoom)/2';
      break;
    case 'pan-left':
      zExpr = `${(zoomMin + zoomDelta * 0.5).toFixed(4)}`;
      xExpr = `(iw-iw/zoom)/2+((iw/zoom-ow)/${(3 + (1 - panSpeed) * 4).toFixed(1)})*(1-cos(on/${frames}*PI))/2`;
      yExpr = '(ih-ih/zoom)/2';
      break;
    case 'pan-right':
      zExpr = `${(zoomMin + zoomDelta * 0.5).toFixed(4)}`;
      xExpr = `(iw-iw/zoom)/2-((iw/zoom-ow)/${(3 + (1 - panSpeed) * 4).toFixed(1)})*(1-cos(on/${frames}*PI))/2`;
      yExpr = '(ih-ih/zoom)/2';
      break;
    case 'pan-up':
      zExpr = `${(zoomMin + zoomDelta * 0.5).toFixed(4)}`;
      xExpr = '(iw-iw/zoom)/2';
      yExpr = `(ih-ih/zoom)/2-((ih/zoom-oh)/${(4 + (1 - panSpeed) * 4).toFixed(1)})*(1-cos(on/${frames}*PI))/2`;
      break;
    case 'pan-down':
      zExpr = `${(zoomMin + zoomDelta * 0.5).toFixed(4)}`;
      xExpr = '(iw-iw/zoom)/2';
      yExpr = `(ih-ih/zoom)/2+((ih/zoom-oh)/${(4 + (1 - panSpeed) * 4).toFixed(1)})*(1-cos(on/${frames}*PI))/2`;
      break;
    default: // fallback: zoom in
      zExpr = `${zoomMin}+${zoomDelta.toFixed(4)}*on/${frames}`;
      xExpr = '(iw-iw/zoom)/2';
      yExpr = '(ih-ih/zoom)/2';
  }

  return `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='${zExpr}':d=${frames}:x='${xExpr}':y='${yExpr}':s=${width}x${height}:fps=${fps}`;
}

/**
 * Build grain filter from effects_config.grain
 */
function buildGrainFromConfig(grain, master) {
  if (!grain || !grain.enabled) return null;
  const intensity = safeClamp(grain.intensity, 0.2, 0, 1) * master;
  if (intensity <= 0.01) return null;
  const strength = Math.round(5 + intensity * 30);
  const sizeFlag = safeClamp(grain.size, 1.0, 0.5, 2.0) > 1.2 ? 't+u' : 't';
  return `noise=c0s=${strength}:c0f=${sizeFlag}`;
}

/**
 * Build flicker filter from effects_config.flicker
 * Deterministic: uses sine oscillation, no random().
 */
function buildFlickerFromConfig(flicker, master, seed, index) {
  if (!flicker || !flicker.enabled) return null;
  const intensity = safeClamp(flicker.intensity, 0.15, 0, 1) * master;
  if (intensity <= 0.01) return null;
  const freq = safeClamp(flicker.frequency, 0.3, 0.05, 1);
  // Phase offset from seed for determinism
  const phase = (hashSeed(`${seed}:flicker:${index}`) % 100) / 100;
  const brightSwing = (intensity * 0.12).toFixed(4);
  const freqVal = (freq * 0.5).toFixed(4);
  return `eq=brightness=${brightSwing}*sin(n*${freqVal}+${phase.toFixed(2)})`;
}

/**
 * Build vignette filter from effects_config.vignette
 */
function buildVignetteFromConfig(vignette, master) {
  if (!vignette || !vignette.enabled) return null;
  const intensity = safeClamp(vignette.intensity, 0.35, 0, 1) * master;
  if (intensity <= 0.01) return null;
  // Map 0-1 → PI/8 to PI/2
  const angle = (Math.PI / 8) + (intensity * (Math.PI / 2 - Math.PI / 8));
  return `vignette=${angle.toFixed(4)}`;
}

/**
 * Build color grade filter from effects_config.color_grade
 */
function buildColorGradeFromConfig(cg, master) {
  if (!cg || !cg.enabled) return null;
  const intensity = safeClamp(cg.intensity, 0.5, 0, 1) * master;
  if (intensity <= 0.01) return null;

  const filters = [];

  // Preset-specific base adjustments
  switch (cg.preset) {
    case 'cinematic_dark':
      filters.push(`eq=saturation=${(1 - intensity * 0.15).toFixed(2)}:contrast=${(1 + intensity * 0.2).toFixed(2)}:brightness=${(-intensity * 0.05).toFixed(3)}`);
      filters.push(`colorbalance=rs=${(-intensity * 0.03).toFixed(3)}:bs=${(intensity * 0.05).toFixed(3)}`);
      break;
    case 'cold_desaturated':
      filters.push(`eq=saturation=${(1 - intensity * 0.4).toFixed(2)}`);
      filters.push(`colorbalance=rs=${(-intensity * 0.08).toFixed(3)}:gs=${(-intensity * 0.05).toFixed(3)}:bs=${(intensity * 0.12).toFixed(3)}`);
      break;
    case 'vhs_degraded':
      filters.push(`eq=saturation=${(1 - intensity * 0.3).toFixed(2)}:contrast=${(1 + intensity * 0.1).toFixed(2)}`);
      filters.push(`colorbalance=gs=${(intensity * 0.06).toFixed(3)}`);
      break;
    case 'auto':
    default:
      // Gentle cinematic grade
      filters.push(`eq=saturation=${(1 - intensity * 0.1).toFixed(2)}:contrast=${(1 + intensity * 0.1).toFixed(2)}`);
      break;
  }

  return filters.join(',');
}

/**
 * Build the complete filter list from effects_config.
 *
 * @param {Object}  config  – The merged effects_config from get_effects_config_for_job()
 * @param {Object}  opts    – { lowMemory, seed, sceneIndex, sceneDuration, width, height }
 * @returns {{ postFilters: string[], kenBurnsFilter: string|null, fadeConfig: object|null }}
 */
function buildFiltersFromEffectsConfig(config, opts = {}) {
  const result = { postFilters: [], kenBurnsFilter: null, fadeConfig: null };

  // Guard: missing / disabled
  if (!config || typeof config !== 'object' || config.enabled === false) {
    return result;
  }

  const master = safeClamp(config.intensity, 0.5, 0, 1);
  const {
    lowMemory = false,
    seed = 'default',
    sceneIndex = 0,
    sceneDuration = 5,
    width = 1080,
    height = 1920,
  } = opts;

  // --- Ken Burns (per-scene, applied in createVideoFromImages) ---
  try {
    result.kenBurnsFilter = buildKenBurnsFromConfig(
      config.kenburns, master, sceneIndex, sceneDuration, width, height, seed, lowMemory
    );
  } catch (err) {
    console.warn(`[effects_config] kenburns failed (scene ${sceneIndex}):`, err.message);
  }

  // --- Post-processing filters (applied after concat) ---
  // Order: color_grade → vignette → grain → flicker

  try {
    const cg = buildColorGradeFromConfig(config.color_grade, master);
    if (cg) result.postFilters.push(cg);
  } catch (err) {
    console.warn('[effects_config] color_grade failed:', err.message);
  }

  try {
    const vig = buildVignetteFromConfig(config.vignette, master);
    if (vig) result.postFilters.push(vig);
  } catch (err) {
    console.warn('[effects_config] vignette failed:', err.message);
  }

  if (!lowMemory) {
    try {
      const gr = buildGrainFromConfig(config.grain, master);
      if (gr) result.postFilters.push(gr);
    } catch (err) {
      console.warn('[effects_config] grain failed:', err.message);
    }

    try {
      const fl = buildFlickerFromConfig(config.flicker, master, seed, sceneIndex);
      if (fl) result.postFilters.push(fl);
    } catch (err) {
      console.warn('[effects_config] flicker failed:', err.message);
    }
  }

  // Fade config (passed through, renderer handles separately)
  if (config.fade) {
    result.fadeConfig = {
      fade_in: config.fade.fade_in !== false,
      fade_out: config.fade.fade_out !== false,
      duration: safeClamp(config.fade.duration, 1.5, 0.1, 3.0),
    };
  }

  return result;
}

module.exports = {
  // Filter mappings
  VISUAL_STYLE_FILTERS,
  MOTION_PROFILE_FILTERS,
  COLOR_PALETTE_FILTERS,
  TEXTURE_ARTIFACT_FILTERS,
  LIGHTING_PROFILE_FILTERS,
  PLATFORM_ADJUSTMENTS,
  
  // Main builders
  buildFFmpegFiltersFromVisualDNA,
  buildKenBurnsWithMotionProfile,
  getEffectFlagsFromVisualDNA,
  buildCombinedFilterGraph,
  optimizeFilterChain,
  
  // Render budget system
  calculateRenderBudget,
  buildBudgetAwareFilters,
  RENDER_BUDGET_THRESHOLDS,
  
  // Safe jitter calculation
  calculateSafeJitter,
  JITTER_SAFETY_PERCENT,
  
  // Brand shadow profiles
  getShadowProfile,
  getVarietySuggestions,
  DEFAULT_SHADOW_PROFILES,
  
  // Effects Profile builders (v3.1)
  buildVignetteFilter,
  buildFilmGrainFilter,
  buildScanlinesFilter,
  buildVHSFilter,
  buildGlitchFilter,
  buildColorGradeFilter,
  buildFiltersFromEffectsProfile,
  
  // Effects Config v2.0 (Roadmap #15 — Controlled Motion)
  normalizeEffectsConfig,
  buildFiltersFromEffectsConfig,
  buildKenBurnsFromConfig,
  buildGrainFromConfig,
  buildFlickerFromConfig,
  buildVignetteFromConfig,
  buildColorGradeFromConfig,
  hashSeed,
  
  // Utility
  safeClamp,
};
