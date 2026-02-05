/**
 * VISUAL DNA SYSTEM v1.0
 * 
 * Core principle: Visuals are DERIVED, never random.
 * Story DNA is the source of truth.
 * 
 * Visual DNA exists to:
 * - Lock aesthetic identity
 * - Prevent AI "style drift"
 * - Make accounts algorithmically recognizable
 * - Stay platform-optimized without contaminating genres
 * 
 * Each Visual DNA field is mapped from MULTIPLE Story DNA axes.
 * This prevents brittle logic and creates coherent visual worlds.
 */

import type { StoryDNA } from "./story_dna.ts";

// =====================================================
// VISUAL DNA TYPES
// =====================================================

export type VisualStyle = 
  | "VHS_degraded"
  | "cinematic_dark"
  | "cinematic_minimal"
  | "documentary_archival"
  | "surveillance_footage"
  | "found_footage"
  | "polaroid_faded";

export type ColorPalette = 
  | "cold_desaturated"
  | "sickly_green"
  | "muted_gray"
  | "deep_shadow_contrast"
  | "monochrome_harsh"
  | "amber_decay"
  | "blue_black_void";

export type CameraLanguage = 
  | "fixed_static"
  | "slow_push"
  | "handheld_shaky"
  | "wide_static"
  | "archival_locked"
  | "drift_pan"
  | "security_cam";

export type MotionProfile = 
  | "none"
  | "micro_jitter"
  | "slow_drift"
  | "slow_pan"
  | "subtle_zoom"
  | "tracking_stutter";

export type TextureArtifact = 
  | "film_grain"
  | "scanlines"
  | "tracking_noise"
  | "compression_noise"
  | "fog_bloom"
  | "dust_scratches"
  | "vignette_heavy"
  | "chromatic_aberration";

export type LightingProfile = 
  | "moonlit_fog"
  | "fluorescent_flat"
  | "low_key_shadow"
  | "blown_highlights"
  | "single_source_harsh"
  | "twilight_amber"
  | "deep_darkness";

export type SubjectScale = 
  | "tiny"
  | "distant"
  | "human"
  | "close"
  | "looming"
  | "overwhelming";

export type FrameComposition = 
  | "centered_void"
  | "rule_of_thirds"
  | "off_balance"
  | "deep_space"
  | "claustrophobic"
  | "negative_space_heavy";

export type Platform = "reels" | "tiktok" | "shorts" | "default";

// =====================================================
// VISUAL DNA INTERFACE
// =====================================================

export interface VisualDNA {
  // Core identification
  visual_dna_id: string;
  story_dna_id: string;
  brand_id?: string;  // For per-brand similarity tracking
  
  // The 8 visual dimensions
  visual_style: VisualStyle;
  color_palette: ColorPalette;
  camera_language: CameraLanguage;
  motion_profile: MotionProfile;
  texture_artifacts: TextureArtifact[];
  lighting_profile: LightingProfile;
  subject_scale: SubjectScale;
  frame_composition: FrameComposition;
  
  // Platform tuning (applied on top)
  platform: Platform;
  platform_adjustments: PlatformAdjustments;
  
  // Metadata
  derived_from: DerivedFromSummary;
  created_at: string;
}

export interface PlatformAdjustments {
  motion_multiplier: number;      // 0.5 - 1.5
  grain_intensity: number;        // 0.0 - 1.0
  contrast_boost: number;         // -20 to +20
  darkness_floor: number;         // 0 - 20 (minimum black level)
  first_frames_motion?: MotionProfile;  // Override for first 2s
  additional_artifacts: TextureArtifact[];
}

export interface DerivedFromSummary {
  genre: string;
  era: string;
  location: string;
  emotion: string;
  threat_behavior: string;
  threat_manifestation: string;
  narrative_artifact: string;
  ending_imagery: string;
}

// =====================================================
// VISUAL STYLE MAPPING
// =====================================================

/**
 * Derive visual_style from Story DNA
 * Priority: genre > narrative_artifact > era > default
 */
function deriveVisualStyle(dna: StoryDNA): VisualStyle {
  const genre = dna.genre;
  const artifactId = dna.narrative_artifact.id;
  const eraId = dna.era.id;
  
  // Genre takes priority
  if (genre === "analog_horror") {
    return "VHS_degraded";
  }
  
  // Narrative artifact can override
  if (["police_memo", "agency_report", "coroner_notes"].includes(artifactId)) {
    return "documentary_archival";
  }
  
  if (["surveillance_report", "security_log"].includes(artifactId)) {
    return "surveillance_footage";
  }
  
  if (["found_journal", "recovered_tape", "confession_tape"].includes(artifactId)) {
    return "found_footage";
  }
  
  // Cosmic horror gets minimal aesthetic
  if (genre === "cosmic_horror") {
    return "cinematic_minimal";
  }
  
  // Era can influence
  if (["1970s", "1980s"].includes(eraId)) {
    return "polaroid_faded";
  }
  
  // Default: cinematic dark (works for urban_legend, true_crime)
  return "cinematic_dark";
}

// =====================================================
// COLOR PALETTE MAPPING
// =====================================================

/**
 * Derive color_palette from Story DNA
 * Priority: emotion > genre > ending_knowledge > default
 */
function deriveColorPalette(dna: StoryDNA): ColorPalette {
  const emotionId = dna.emotion.id;
  const genre = dna.genre;
  const endingKnowledgeId = dna.ending_knowledge.id;
  
  // Emotion dominates color
  if (emotionId === "cosmic_insignificance") {
    return "cold_desaturated";
  }
  
  if (emotionId === "isolation") {
    return "blue_black_void";
  }
  
  if (emotionId === "decay" || emotionId === "corruption") {
    return "amber_decay";
  }
  
  // Genre influences
  if (genre === "analog_horror") {
    return "sickly_green";
  }
  
  if (genre === "cosmic_horror") {
    return "cold_desaturated";
  }
  
  // Ending knowledge can shift palette
  if (endingKnowledgeId === "suppressed" || endingKnowledgeId === "redacted") {
    return "muted_gray";
  }
  
  if (endingKnowledgeId === "witness_silenced") {
    return "monochrome_harsh";
  }
  
  // Default: strong contrast for horror
  return "deep_shadow_contrast";
}

// =====================================================
// CAMERA LANGUAGE MAPPING
// =====================================================

/**
 * Derive camera_language from Story DNA
 * Priority: narrative_artifact > emotion > threat_behavior > default
 */
function deriveCameraLanguage(dna: StoryDNA): CameraLanguage {
  const artifactId = dna.narrative_artifact.id;
  const emotionId = dna.emotion.id;
  const behaviorId = dna.threat_behavior.id;
  
  // Artifact determines documentary approach
  if (["surveillance_report", "security_log"].includes(artifactId)) {
    return "security_cam";
  }
  
  if (["police_memo", "agency_report", "coroner_notes"].includes(artifactId)) {
    return "archival_locked";
  }
  
  // Emotion influences camera movement
  if (emotionId === "paranoia") {
    return "slow_push";
  }
  
  if (emotionId === "dread" || emotionId === "anticipation") {
    return "slow_push";
  }
  
  if (emotionId === "panic") {
    return "handheld_shaky";
  }
  
  // Threat behavior influences
  if (behaviorId === "following" || behaviorId === "stalking") {
    return "handheld_shaky";
  }
  
  if (behaviorId === "watching" || behaviorId === "observing") {
    return "fixed_static";
  }
  
  if (behaviorId === "approaching") {
    return "slow_push";
  }
  
  // Default: wide establishing shots
  return "wide_static";
}

// =====================================================
// MOTION PROFILE MAPPING
// =====================================================

/**
 * Derive motion_profile from Visual DNA (recursive) and Story DNA
 * Motion depends on visual_style and emotion
 */
function deriveMotionProfile(dna: StoryDNA, visualStyle: VisualStyle): MotionProfile {
  const emotionId = dna.emotion.id;
  
  // VHS always has jitter
  if (visualStyle === "VHS_degraded") {
    return "micro_jitter";
  }
  
  // Surveillance has tracking stutter
  if (visualStyle === "surveillance_footage") {
    return "tracking_stutter";
  }
  
  // Emotion influences motion
  if (emotionId === "dread") {
    return "slow_drift";
  }
  
  if (emotionId === "anticipation") {
    return "subtle_zoom";
  }
  
  if (emotionId === "paranoia") {
    return "slow_pan";
  }
  
  // Cinematic styles tend to be more static
  if (visualStyle === "cinematic_dark" || visualStyle === "cinematic_minimal") {
    return "none";
  }
  
  return "none";
}

// =====================================================
// TEXTURE ARTIFACTS MAPPING
// =====================================================

/**
 * Derive texture_artifacts from Story DNA
 * Cumulative: multiple sources can add artifacts
 */
function deriveTextureArtifacts(
  dna: StoryDNA, 
  visualStyle: VisualStyle,
  platform: Platform
): TextureArtifact[] {
  const artifacts: TextureArtifact[] = [];
  const genre = dna.genre;
  const eraId = dna.era.id;
  const locationId = dna.location.id;
  
  // Genre-specific artifacts
  if (genre === "analog_horror") {
    artifacts.push("scanlines", "tracking_noise");
  }
  
  // Visual style artifacts
  if (visualStyle === "cinematic_dark" || visualStyle === "cinematic_minimal") {
    artifacts.push("film_grain");
  }
  
  if (visualStyle === "VHS_degraded") {
    artifacts.push("chromatic_aberration");
  }
  
  if (visualStyle === "polaroid_faded") {
    artifacts.push("dust_scratches", "vignette_heavy");
  }
  
  if (visualStyle === "documentary_archival") {
    artifacts.push("film_grain", "dust_scratches");
  }
  
  // Era-specific
  if (["1950s", "1960s", "1970s"].includes(eraId)) {
    if (!artifacts.includes("dust_scratches")) {
      artifacts.push("dust_scratches");
    }
  }
  
  // Location-specific
  if (["forest", "swamp", "mountain_pass", "rural_road"].includes(locationId)) {
    artifacts.push("fog_bloom");
  }
  
  // Platform-specific (TikTok gets more texture)
  if (platform === "tiktok") {
    artifacts.push("compression_noise");
  }
  
  // Always add vignette for depth
  if (!artifacts.includes("vignette_heavy") && visualStyle !== "surveillance_footage") {
    artifacts.push("vignette_heavy");
  }
  
  // Remove duplicates
  return [...new Set(artifacts)];
}

// =====================================================
// LIGHTING PROFILE MAPPING
// =====================================================

/**
 * Derive lighting_profile from Story DNA
 * Priority: location > genre > emotion > default
 */
function deriveLightingProfile(dna: StoryDNA): LightingProfile {
  const locationId = dna.location.id;
  const genre = dna.genre;
  const emotionId = dna.emotion.id;
  const eraId = dna.era.id;
  
  // Location is strongest lighting influence
  if (["forest", "rural_road", "abandoned_property", "lakeside"].includes(locationId)) {
    return "moonlit_fog";
  }
  
  if (["abandoned_hospital", "empty_school", "basement"].includes(locationId)) {
    return "single_source_harsh";
  }
  
  if (["suburban_street", "strip_mall", "rest_stop"].includes(locationId)) {
    return "fluorescent_flat";
  }
  
  // Genre influences
  if (genre === "analog_horror") {
    return "fluorescent_flat";
  }
  
  if (genre === "cosmic_horror") {
    return "deep_darkness";
  }
  
  // Emotion can override
  if (emotionId === "cosmic_insignificance") {
    return "deep_darkness";
  }
  
  // Era twilight for older periods
  if (["1950s", "1960s", "1970s"].includes(eraId)) {
    return "twilight_amber";
  }
  
  // Default: classic horror lighting
  return "low_key_shadow";
}

// =====================================================
// SUBJECT SCALE MAPPING
// =====================================================

/**
 * Derive subject_scale from Story DNA
 * Priority: threat_manifestation > emotion > default
 */
function deriveSubjectScale(dna: StoryDNA): SubjectScale {
  const manifestationId = dna.threat_manifestation.id;
  const emotionId = dna.emotion.id;
  const behaviorId = dna.threat_behavior.id;
  
  // Manifestation determines physical scale
  if (["tall_humanoid", "giant_silhouette", "towering_figure"].includes(manifestationId)) {
    return "looming";
  }
  
  if (["swarm", "spreading_darkness", "geometric_lights"].includes(manifestationId)) {
    return "overwhelming";
  }
  
  if (["distant_watcher", "figure_in_treeline"].includes(manifestationId)) {
    return "distant";
  }
  
  // Emotion influences perception
  if (emotionId === "cosmic_insignificance") {
    return "tiny";
  }
  
  if (emotionId === "claustrophobia" || emotionId === "suffocation") {
    return "close";
  }
  
  // Behavior can adjust
  if (behaviorId === "approaching" || behaviorId === "closing_in") {
    return "looming";
  }
  
  // Default: human scale
  return "human";
}

// =====================================================
// FRAME COMPOSITION MAPPING
// =====================================================

/**
 * Derive frame_composition from Story DNA
 * Priority: emotion > threat_behavior > visual_style > default
 */
function deriveFrameComposition(
  dna: StoryDNA, 
  visualStyle: VisualStyle
): FrameComposition {
  const emotionId = dna.emotion.id;
  const behaviorId = dna.threat_behavior.id;
  
  // Emotion dominates composition
  if (emotionId === "paranoia") {
    return "off_balance";
  }
  
  if (emotionId === "dread" || emotionId === "anticipation") {
    return "centered_void";
  }
  
  if (emotionId === "isolation" || emotionId === "cosmic_insignificance") {
    return "negative_space_heavy";
  }
  
  if (emotionId === "claustrophobia" || emotionId === "suffocation") {
    return "claustrophobic";
  }
  
  // Behavior influences
  if (behaviorId === "watching" || behaviorId === "observing") {
    return "deep_space";
  }
  
  // Visual style fallback
  if (visualStyle === "surveillance_footage") {
    return "off_balance";
  }
  
  if (visualStyle === "cinematic_minimal") {
    return "negative_space_heavy";
  }
  
  // Default: classic cinematic
  return "rule_of_thirds";
}

// =====================================================
// PLATFORM ADJUSTMENTS
// =====================================================

/**
 * Get platform-specific visual adjustments
 * These modify presentation, NOT core Visual DNA
 */
function getPlatformAdjustments(
  platform: Platform,
  visualStyle: VisualStyle,
  motionProfile: MotionProfile
): PlatformAdjustments {
  const base: PlatformAdjustments = {
    motion_multiplier: 1.0,
    grain_intensity: 0.5,
    contrast_boost: 0,
    darkness_floor: 0,
    additional_artifacts: [],
  };
  
  switch (platform) {
    case "reels":
      // Instagram: aesthetic cohesion, polish
      return {
        motion_multiplier: 0.8,  // Slower motion
        grain_intensity: 0.4,    // Cleaner grain
        contrast_boost: 10,      // Slight contrast boost
        darkness_floor: 5,       // Not too dark
        additional_artifacts: [],
      };
      
    case "tiktok":
      // TikTok: immediacy, texture, rawness
      return {
        motion_multiplier: 1.2,  // Faster feel
        grain_intensity: 0.7,    // More texture
        contrast_boost: 5,
        darkness_floor: 0,
        first_frames_motion: "micro_jitter",  // Hook in first 2s
        additional_artifacts: ["compression_noise"],
      };
      
    case "shorts":
      // YouTube Shorts: clarity, retention
      return {
        motion_multiplier: 1.0,
        grain_intensity: 0.3,    // Reduced noise
        contrast_boost: 8,
        darkness_floor: 8,       // Not too dark for small screens
        first_frames_motion: "subtle_zoom",  // Gentle hook in first 2s
        additional_artifacts: [],
      };
      
    default:
      return base;
  }
}

// =====================================================
// MAIN DERIVATION FUNCTION
// =====================================================

/**
 * Derive complete Visual DNA from Story DNA
 * This is the main entry point - one function to rule them all
 * 
 * @param storyDNA - The story DNA to derive visuals from
 * @param platform - Target platform for adjustments
 * @returns Complete Visual DNA
 */
export function deriveVisualDNA(
  storyDNA: StoryDNA,
  platform: Platform = "default"
): VisualDNA {
  console.log(`[VISUAL-DNA] Deriving visual DNA from story ${storyDNA.dna_id.substring(0, 8)}...`);
  console.log(`[VISUAL-DNA]   Genre: ${storyDNA.genre}`);
  console.log(`[VISUAL-DNA]   Platform: ${platform}`);
  
  // Step 1: Derive visual_style (influences other derivations)
  const visualStyle = deriveVisualStyle(storyDNA);
  console.log(`[VISUAL-DNA]   Visual Style: ${visualStyle}`);
  
  // Step 2: Derive color_palette
  const colorPalette = deriveColorPalette(storyDNA);
  console.log(`[VISUAL-DNA]   Color Palette: ${colorPalette}`);
  
  // Step 3: Derive camera_language
  const cameraLanguage = deriveCameraLanguage(storyDNA);
  console.log(`[VISUAL-DNA]   Camera Language: ${cameraLanguage}`);
  
  // Step 4: Derive motion_profile (depends on visual_style)
  const motionProfile = deriveMotionProfile(storyDNA, visualStyle);
  console.log(`[VISUAL-DNA]   Motion Profile: ${motionProfile}`);
  
  // Step 5: Derive texture_artifacts (cumulative)
  const textureArtifacts = deriveTextureArtifacts(storyDNA, visualStyle, platform);
  console.log(`[VISUAL-DNA]   Texture Artifacts: ${textureArtifacts.join(", ")}`);
  
  // Step 6: Derive lighting_profile
  const lightingProfile = deriveLightingProfile(storyDNA);
  console.log(`[VISUAL-DNA]   Lighting Profile: ${lightingProfile}`);
  
  // Step 7: Derive subject_scale
  const subjectScale = deriveSubjectScale(storyDNA);
  console.log(`[VISUAL-DNA]   Subject Scale: ${subjectScale}`);
  
  // Step 8: Derive frame_composition
  const frameComposition = deriveFrameComposition(storyDNA, visualStyle);
  console.log(`[VISUAL-DNA]   Frame Composition: ${frameComposition}`);
  
  // Step 9: Get platform adjustments
  const platformAdjustments = getPlatformAdjustments(platform, visualStyle, motionProfile);
  
  // Build the complete Visual DNA
  const visualDNA: VisualDNA = {
    visual_dna_id: crypto.randomUUID(),
    story_dna_id: storyDNA.dna_id,
    
    visual_style: visualStyle,
    color_palette: colorPalette,
    camera_language: cameraLanguage,
    motion_profile: motionProfile,
    texture_artifacts: textureArtifacts,
    lighting_profile: lightingProfile,
    subject_scale: subjectScale,
    frame_composition: frameComposition,
    
    platform,
    platform_adjustments: platformAdjustments,
    
    derived_from: {
      genre: storyDNA.genre,
      era: storyDNA.era.id,
      location: storyDNA.location.id,
      emotion: storyDNA.emotion.id,
      threat_behavior: storyDNA.threat_behavior.id,
      threat_manifestation: storyDNA.threat_manifestation.id,
      narrative_artifact: storyDNA.narrative_artifact.id,
      ending_imagery: storyDNA.ending_imagery.id,
    },
    
    created_at: new Date().toISOString(),
  };
  
  console.log(`[VISUAL-DNA] ✅ Visual DNA derived successfully`);
  
  return visualDNA;
}

// =====================================================
// VISUAL PROMPT BUILDERS
// =====================================================

/**
 * Build a visual style description for image generation prompts
 * This translates Visual DNA into natural language for AI image models
 */
export function buildVisualStylePrompt(visualDNA: VisualDNA): string {
  const parts: string[] = [];
  
  // Visual style
  const styleDescriptions: Record<VisualStyle, string> = {
    "VHS_degraded": "grainy VHS aesthetic, worn tape quality, analog video distortion",
    "cinematic_dark": "cinematic dark photography, film noir lighting, professional cinematography",
    "cinematic_minimal": "minimalist cinematography, clean compositions, subtle lighting",
    "documentary_archival": "documentary style, archival footage quality, authentic period look",
    "surveillance_footage": "security camera footage, surveillance aesthetic, timestamp overlay style",
    "found_footage": "found footage style, amateur video quality, authentic discovered recording",
    "polaroid_faded": "faded polaroid aesthetic, vintage photograph quality, aged colors",
  };
  parts.push(styleDescriptions[visualDNA.visual_style]);
  
  // Color palette
  const paletteDescriptions: Record<ColorPalette, string> = {
    "cold_desaturated": "cold desaturated colors, muted tones, drained of warmth",
    "sickly_green": "sickly green cast, unhealthy pallor, nauseous color grading",
    "muted_gray": "muted grays, faded colors, washed out tones",
    "deep_shadow_contrast": "deep shadows, high contrast, rich blacks",
    "monochrome_harsh": "harsh monochrome, stark black and white, no middle grays",
    "amber_decay": "amber decay tones, aged sepia hints, oxidized colors",
    "blue_black_void": "blue-black void, deep indigo shadows, cold emptiness",
  };
  parts.push(paletteDescriptions[visualDNA.color_palette]);
  
  // Lighting
  const lightingDescriptions: Record<LightingProfile, string> = {
    "moonlit_fog": "moonlit foggy atmosphere, diffused silver light, misty ambiance",
    "fluorescent_flat": "harsh fluorescent lighting, flat institutional light, sterile illumination",
    "low_key_shadow": "low-key dramatic lighting, deep shadows, selective illumination",
    "blown_highlights": "blown out highlights, overexposed bright areas, harsh contrast",
    "single_source_harsh": "single harsh light source, dramatic shadows, stark illumination",
    "twilight_amber": "twilight amber glow, golden hour warmth fading to darkness",
    "deep_darkness": "deep darkness, minimal light, overwhelming shadow",
  };
  parts.push(lightingDescriptions[visualDNA.lighting_profile]);
  
  // Composition
  const compositionDescriptions: Record<FrameComposition, string> = {
    "centered_void": "centered composition with empty void, subject surrounded by darkness",
    "rule_of_thirds": "classic rule of thirds composition, balanced framing",
    "off_balance": "deliberately off-balance framing, unsettling asymmetry",
    "deep_space": "deep space composition, layered depth, foreground to background",
    "claustrophobic": "claustrophobic tight framing, compressed space, no escape",
    "negative_space_heavy": "heavy negative space, isolated subject, vast emptiness",
  };
  parts.push(compositionDescriptions[visualDNA.frame_composition]);
  
  // Subject scale
  const scaleDescriptions: Record<SubjectScale, string> = {
    "tiny": "subject appears tiny, dwarfed by environment, insignificant scale",
    "distant": "subject in the distance, far from camera, barely visible",
    "human": "human scale perspective, normal proportions, relatable size",
    "close": "close intimate framing, uncomfortably near, personal space invaded",
    "looming": "looming presence, subject dominates frame from above",
    "overwhelming": "overwhelming scale, subject fills and exceeds frame",
  };
  parts.push(scaleDescriptions[visualDNA.subject_scale]);
  
  // Texture artifacts
  const artifactDescriptions: Record<TextureArtifact, string> = {
    "film_grain": "visible film grain",
    "scanlines": "horizontal scanlines",
    "tracking_noise": "VHS tracking noise",
    "compression_noise": "digital compression artifacts",
    "fog_bloom": "atmospheric fog bloom",
    "dust_scratches": "dust and scratches",
    "vignette_heavy": "heavy vignette",
    "chromatic_aberration": "chromatic aberration on edges",
  };
  
  if (visualDNA.texture_artifacts.length > 0) {
    const artifactList = visualDNA.texture_artifacts
      .map(a => artifactDescriptions[a])
      .join(", ");
    parts.push(`with ${artifactList}`);
  }
  
  return parts.join(", ");
}

/**
 * Build a complete image prompt that combines Visual DNA with scene content
 */
export function buildImagePromptWithVisualDNA(
  sceneDescription: string,
  visualDNA: VisualDNA,
  additionalContext?: string
): string {
  const visualStyle = buildVisualStylePrompt(visualDNA);
  
  let prompt = `${sceneDescription}. ${visualStyle}`;
  
  if (additionalContext) {
    prompt += `. ${additionalContext}`;
  }
  
  // Platform-specific adjustments
  if (visualDNA.platform === "tiktok") {
    prompt += ". Vertical 9:16 aspect ratio, immediate visual impact";
  } else if (visualDNA.platform === "reels") {
    prompt += ". Vertical 9:16 aspect ratio, polished aesthetic";
  } else if (visualDNA.platform === "shorts") {
    prompt += ". Vertical 9:16 aspect ratio, clear subject focus";
  }
  
  return prompt;
}

// =====================================================
// DRIFT DETECTION
// =====================================================

export interface DriftAnalysis {
  dimension: string;
  expected: string;
  actual: string;
  is_violation: boolean;
  severity: "low" | "medium" | "high";
}

/**
 * Check if Visual DNA properly matches Story DNA mapping rules
 * Returns any violations found
 */
export function detectMappingViolations(
  storyDNA: StoryDNA,
  visualDNA: VisualDNA
): DriftAnalysis[] {
  const violations: DriftAnalysis[] = [];
  
  // Check visual_style matches genre
  if (storyDNA.genre === "analog_horror" && visualDNA.visual_style !== "VHS_degraded") {
    violations.push({
      dimension: "visual_style",
      expected: "VHS_degraded",
      actual: visualDNA.visual_style,
      is_violation: true,
      severity: "high",
    });
  }
  
  // Check color_palette matches emotion
  if (storyDNA.emotion.id === "cosmic_insignificance" && 
      visualDNA.color_palette !== "cold_desaturated") {
    violations.push({
      dimension: "color_palette",
      expected: "cold_desaturated",
      actual: visualDNA.color_palette,
      is_violation: true,
      severity: "medium",
    });
  }
  
  // Check subject_scale matches threat_manifestation
  if (["tall_humanoid", "giant_silhouette", "towering_figure"].includes(storyDNA.threat_manifestation.id) &&
      visualDNA.subject_scale !== "looming") {
    violations.push({
      dimension: "subject_scale",
      expected: "looming",
      actual: visualDNA.subject_scale,
      is_violation: true,
      severity: "medium",
    });
  }
  
  // Check texture_artifacts for genre
  if (storyDNA.genre === "analog_horror") {
    if (!visualDNA.texture_artifacts.includes("scanlines")) {
      violations.push({
        dimension: "texture_artifacts",
        expected: "includes scanlines",
        actual: visualDNA.texture_artifacts.join(", "),
        is_violation: true,
        severity: "medium",
      });
    }
  }
  
  return violations;
}

/**
 * Calculate visual entropy across a set of Visual DNAs
 * Low entropy = visual sameness = drift detected
 */
export function calculateVisualEntropy(
  visualDNAs: VisualDNA[]
): { dimension: string; entropy: number; status: "healthy" | "warning" | "critical" }[] {
  if (visualDNAs.length < 5) {
    return []; // Need minimum samples
  }
  
  const dimensions = [
    { name: "visual_style", getter: (v: VisualDNA) => v.visual_style },
    { name: "color_palette", getter: (v: VisualDNA) => v.color_palette },
    { name: "camera_language", getter: (v: VisualDNA) => v.camera_language },
    { name: "lighting_profile", getter: (v: VisualDNA) => v.lighting_profile },
    { name: "frame_composition", getter: (v: VisualDNA) => v.frame_composition },
  ];
  
  return dimensions.map(dim => {
    const values = visualDNAs.map(dim.getter);
    const counts = new Map<string, number>();
    
    for (const v of values) {
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    
    // Shannon entropy
    let entropy = 0;
    for (const count of counts.values()) {
      const p = count / values.length;
      entropy -= p * Math.log2(p);
    }
    
    // Normalize by max possible entropy
    const maxEntropy = Math.log2(7); // ~7 options per dimension
    const normalized = entropy / maxEntropy;
    
    let status: "healthy" | "warning" | "critical";
    if (normalized >= 0.6) status = "healthy";
    else if (normalized >= 0.4) status = "warning";
    else status = "critical";
    
    return {
      dimension: dim.name,
      entropy: Math.round(normalized * 100) / 100,
      status,
    };
  });
}

// =====================================================
// DATABASE HELPERS
// =====================================================

/**
 * Store Visual DNA in the database
 */
export async function storeVisualDNA(
  supabase: any,
  visualDNA: VisualDNA,
  brandId?: string
): Promise<void> {
  const { error } = await supabase
    .from('visual_dna')
    .insert({
      id: visualDNA.visual_dna_id,
      story_dna_id: visualDNA.story_dna_id,
      brand_id: brandId || null,
      visual_style: visualDNA.visual_style,
      color_palette: visualDNA.color_palette,
      camera_language: visualDNA.camera_language,
      motion_profile: visualDNA.motion_profile,
      texture_artifacts: visualDNA.texture_artifacts,
      lighting_profile: visualDNA.lighting_profile,
      subject_scale: visualDNA.subject_scale,
      frame_composition: visualDNA.frame_composition,
      platform: visualDNA.platform,
      platform_adjustments: visualDNA.platform_adjustments,
      derived_from: visualDNA.derived_from,
      created_at: visualDNA.created_at,
    });
  
  if (error) {
    console.error('[VISUAL-DNA] Error storing Visual DNA:', error);
    throw error;
  }
  
  console.log(`[VISUAL-DNA] Stored Visual DNA ${visualDNA.visual_dna_id.substring(0, 8)}...${brandId ? ` (brand: ${brandId})` : ''}`);
}

/**
 * Get recent Visual DNAs for drift analysis
 * Can filter by brand and/or platform
 */
export async function getRecentVisualDNAs(
  supabase: any,
  brandId?: string,
  platform?: string,
  limit: number = 20
): Promise<VisualDNA[]> {
  let query = supabase
    .from('visual_dna')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  
  // Filter by brand if provided
  if (brandId) {
    query = query.eq('brand_id', brandId);
  }
  
  // Filter by platform if provided
  if (platform) {
    query = query.eq('platform', platform);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('[VISUAL-DNA] Error fetching recent Visual DNAs:', error);
    return [];
  }
  
  return data || [];
}

// =====================================================
// DISPLAY HELPERS
// =====================================================

/**
 * Format Visual DNA for human-readable display
 */
export function formatVisualDNADisplay(visualDNA: VisualDNA): string {
  return `
═══════════════════════════════════════
🎨 VISUAL DNA
═══════════════════════════════════════
Style:       ${visualDNA.visual_style.replace(/_/g, ' ')}
Palette:     ${visualDNA.color_palette.replace(/_/g, ' ')}
Camera:      ${visualDNA.camera_language.replace(/_/g, ' ')}
Motion:      ${visualDNA.motion_profile.replace(/_/g, ' ')}
Lighting:    ${visualDNA.lighting_profile.replace(/_/g, ' ')}
Scale:       ${visualDNA.subject_scale}
Composition: ${visualDNA.frame_composition.replace(/_/g, ' ')}
Textures:    ${visualDNA.texture_artifacts.map(t => t.replace(/_/g, ' ')).join(', ')}
Platform:    ${visualDNA.platform}
═══════════════════════════════════════
Derived from: ${visualDNA.derived_from.genre} / ${visualDNA.derived_from.era}
`.trim();
}

// =====================================================
// VISUAL FINGERPRINT HASH SYSTEM v2.0
// =====================================================
// 
// Purpose: Detect and prevent visual sameness over time.
// Uses WEIGHTED Jaccard/Hamming hybrid for accurate similarity.
// Tracks both per-brand/platform AND global cross-contamination.
// Forces underused traits surgically (1 dimension at a time).

export interface VisualFingerprint {
  hash: string;
  components: {
    visual_style: string;
    color_palette: string;
    motion_profile: string;
    lighting_profile: string;
    texture_signature: string;  // Sorted, joined artifacts
  };
  timestamp: string;
  brand_id?: string;
  platform?: string;
}

export interface SimilarityAnalysis {
  current_fingerprint: VisualFingerprint;
  recent_fingerprints: VisualFingerprint[];
  similarity_scores: { hash: string; score: number; age_hours: number; breakdown: SimilarityBreakdown }[];
  max_similarity: number;
  is_samey: boolean;
  sameness_source: SamenessSource | null;  // Which dimension(s) caused sameness
  recommendation: "proceed" | "rebalance" | "force_variety";
  forced_dimension: ForcedDimensionRecommendation | null;  // Surgical recommendation
  underused_traits: {
    visual_styles: VisualStyle[];
    color_palettes: ColorPalette[];
    motion_profiles: MotionProfile[];
    lighting_profiles: LightingProfile[];
  };
}

// Weighted similarity breakdown for debugging
export interface SimilarityBreakdown {
  style_match: boolean;       // 0.35 weight
  palette_match: boolean;     // 0.25 weight  
  motion_match: boolean;      // 0.15 weight
  lighting_match: boolean;    // 0.10 weight
  texture_jaccard: number;    // 0.15 weight (0-1)
  weighted_score: number;
}

// Identifies what's causing the sameness
export interface SamenessSource {
  primary_culprit: "style" | "palette" | "motion" | "lighting" | "texture";
  secondary_culprit: string | null;
  pattern: string;  // e.g., "VHS|sickly_green repeated 4x"
}

// Surgical recommendation for forcing variety
export interface ForcedDimensionRecommendation {
  dimension: "visual_style" | "color_palette" | "motion_profile" | "lighting_profile" | "texture_artifacts";
  reason: string;
  suggested_values: string[];
  genre_locked: boolean;  // If true, cannot change this dimension
}

// Global similarity analysis result
export interface GlobalSimilarityAnalysis {
  cross_brand_similarity: number;
  contamination_detected: boolean;
  contamination_pattern: string | null;
  affected_brands: string[];
}

// N-gram run detection
export interface SequenceAnalysis {
  rolling_window: VisualFingerprint[];
  detected_runs: { pattern: string; count: number; is_problematic: boolean }[];
  sequence_health: "healthy" | "warning" | "critical";
}

// Brand shadow profile (allowed identity range)
export interface BrandShadowProfile {
  brand_id: string;
  genre: string;
  locked_dimensions: {
    visual_style?: VisualStyle;  // null = can rotate
    // Palettes, motion, lighting can rotate within allowed set
  };
  allowed_palettes: ColorPalette[];
  allowed_motions: MotionProfile[];
  allowed_lightings: LightingProfile[];
}

// SIMILARITY WEIGHTS (based on visual impact)
const WEIGHT_VISUAL_STYLE = 0.35;   // Most distinctive
const WEIGHT_COLOR_PALETTE = 0.25; // Strong brand signal
const WEIGHT_MOTION_PROFILE = 0.15; // Noticeable
const WEIGHT_LIGHTING_PROFILE = 0.10; // Subtle but matters
const WEIGHT_TEXTURE_JACCARD = 0.15; // Textural feel

// Similarity threshold: above this = "samey"
const SIMILARITY_THRESHOLD = 0.65;

// Strong rebalance threshold: force variety
const FORCE_VARIETY_THRESHOLD = 0.80;

// Global cross-brand contamination threshold (lower)
const GLOBAL_CONTAMINATION_THRESHOLD = 0.55;

// Time window for fingerprint comparison (hours)
const FINGERPRINT_WINDOW_HOURS = 72;

// Half-life for recency weighting (hours)
// "Score influence halves every 48 hours" - intuitive and tunable
const RECENCY_HALF_LIFE_HOURS = 48;

// N-gram run threshold (same high-weight pattern X times = problem)
const RUN_DETECTION_THRESHOLD = 3;
const RUN_WINDOW_SIZE = 5;

// Palette weight boost for style-locked genres (culprit detection only)
// Makes system learn "palette is the main lever" faster for analog_horror etc.
const STYLE_LOCKED_PALETTE_BOOST = 0.05;

/**
 * Calculate recency weight using true half-life decay
 * "48 hours = half the influence" - predictable and intuitive
 * 
 * @param ageHours - Age of fingerprint in hours
 * @param halfLifeHours - Hours for weight to halve (default 48)
 * @returns Weight between 0-1
 */
function recencyWeight(ageHours: number, halfLifeHours: number = RECENCY_HALF_LIFE_HOURS): number {
  return Math.pow(0.5, ageHours / halfLifeHours);
}

// =====================================================
// GENRE LOCK MAPPINGS (cannot violate these)
// =====================================================

const GENRE_LOCKED_STYLES: Record<string, VisualStyle> = {
  "analog_horror": "VHS_degraded",
  // Other genres allow rotation
};

const GENRE_ALLOWED_PALETTES: Record<string, ColorPalette[]> = {
  "analog_horror": ["sickly_green", "cold_desaturated", "muted_gray", "amber_decay"],
  "cosmic_horror": ["cold_desaturated", "blue_black_void", "muted_gray"],
  "urban_legend": ["deep_shadow_contrast", "cold_desaturated", "amber_decay", "muted_gray"],
  "true_crime": ["muted_gray", "deep_shadow_contrast", "cold_desaturated", "monochrome_harsh"],
  // Default allows all
};

const GENRE_ALLOWED_MOTIONS: Record<string, MotionProfile[]> = {
  "analog_horror": ["micro_jitter", "none", "slow_drift", "tracking_stutter"],
  "cosmic_horror": ["slow_drift", "none", "subtle_zoom"],
  "urban_legend": ["slow_pan", "subtle_zoom", "none", "slow_drift"],
  "true_crime": ["none", "slow_pan", "subtle_zoom"],
};

/**
 * Generate a visual fingerprint hash from Visual DNA
 * Now includes lighting_profile for more accurate similarity
 */
export function generateVisualFingerprint(
  visualDNA: VisualDNA,
  brandId?: string,
  platform?: string
): VisualFingerprint {
  // Sort texture artifacts for consistent hashing
  const textureSignature = [...visualDNA.texture_artifacts].sort().join('+');
  
  const components = {
    visual_style: visualDNA.visual_style,
    color_palette: visualDNA.color_palette,
    motion_profile: visualDNA.motion_profile,
    lighting_profile: visualDNA.lighting_profile,
    texture_signature: textureSignature,
  };
  
  // Create hash string (human-readable for debugging)
  const hash = `${components.visual_style}|${components.color_palette}|${components.motion_profile}|${components.lighting_profile}|${textureSignature}`;
  
  return {
    hash,
    components,
    timestamp: new Date().toISOString(),
    brand_id: brandId,
    platform,
  };
}

/**
 * Calculate similarity between two visual fingerprints
 * Returns 0.0 (completely different) to 1.0 (identical)
 * 
 * WEIGHTED HYBRID SCORING:
 * - Visual Style: 0.35 (binary match)
 * - Color Palette: 0.25 (binary match)
 * - Motion Profile: 0.15 (binary match)
 * - Lighting Profile: 0.10 (binary match)
 * - Texture Artifacts: 0.15 (Jaccard similarity)
 */
export function calculateFingerprintSimilarity(
  fp1: VisualFingerprint,
  fp2: VisualFingerprint
): { score: number; breakdown: SimilarityBreakdown } {
  // Binary matches
  const styleMatch = fp1.components.visual_style === fp2.components.visual_style;
  const paletteMatch = fp1.components.color_palette === fp2.components.color_palette;
  const motionMatch = fp1.components.motion_profile === fp2.components.motion_profile;
  const lightingMatch = fp1.components.lighting_profile === fp2.components.lighting_profile;
  
  // Texture Jaccard similarity
  const tex1 = new Set(fp1.components.texture_signature.split('+').filter(t => t));
  const tex2 = new Set(fp2.components.texture_signature.split('+').filter(t => t));
  const intersection = [...tex1].filter(t => tex2.has(t)).length;
  const union = new Set([...tex1, ...tex2]).size;
  const textureJaccard = union > 0 ? intersection / union : 0;
  
  // Weighted score calculation
  let score = 0;
  if (styleMatch) score += WEIGHT_VISUAL_STYLE;
  if (paletteMatch) score += WEIGHT_COLOR_PALETTE;
  if (motionMatch) score += WEIGHT_MOTION_PROFILE;
  if (lightingMatch) score += WEIGHT_LIGHTING_PROFILE;
  score += WEIGHT_TEXTURE_JACCARD * textureJaccard;
  
  const breakdown: SimilarityBreakdown = {
    style_match: styleMatch,
    palette_match: paletteMatch,
    motion_match: motionMatch,
    lighting_match: lightingMatch,
    texture_jaccard: Math.round(textureJaccard * 100) / 100,
    weighted_score: Math.round(score * 100) / 100,
  };
  
  return { score: Math.round(score * 100) / 100, breakdown };
}

/**
 * Identify what's causing the sameness
 * Returns the primary culprit dimension
 * 
 * IMPROVEMENTS:
 * - Normalized repeat counts (0-1) for consistent scaling across window sizes
 * - Palette weight boost for style-locked genres (palette becomes main lever)
 * - Texture as tie-breaker only (not a primary culprit)
 */
function identifySamenessSource(
  currentFp: VisualFingerprint,
  recentFingerprints: VisualFingerprint[],
  genre?: string
): SamenessSource | null {
  if (recentFingerprints.length === 0) return null;
  
  const windowSize = recentFingerprints.length;
  
  // Count matches per dimension
  const styleCounts = new Map<string, number>();
  const paletteCounts = new Map<string, number>();
  const motionCounts = new Map<string, number>();
  const lightingCounts = new Map<string, number>();
  const textureCounts = new Map<string, number>();  // For tie-breaking
  
  for (const fp of recentFingerprints) {
    styleCounts.set(fp.components.visual_style, (styleCounts.get(fp.components.visual_style) || 0) + 1);
    paletteCounts.set(fp.components.color_palette, (paletteCounts.get(fp.components.color_palette) || 0) + 1);
    motionCounts.set(fp.components.motion_profile, (motionCounts.get(fp.components.motion_profile) || 0) + 1);
    lightingCounts.set(fp.components.lighting_profile, (lightingCounts.get(fp.components.lighting_profile) || 0) + 1);
    textureCounts.set(fp.components.texture_signature, (textureCounts.get(fp.components.texture_signature) || 0) + 1);
  }
  
  // Find which dimension is most repeated (NORMALIZED 0-1)
  const currentStyle = currentFp.components.visual_style;
  const currentPalette = currentFp.components.color_palette;
  const currentMotion = currentFp.components.motion_profile;
  const currentLighting = currentFp.components.lighting_profile;
  const currentTexture = currentFp.components.texture_signature;
  
  // Normalize: count / windowSize gives 0-1 range
  const styleRepeatNorm = (styleCounts.get(currentStyle) || 0) / windowSize;
  const paletteRepeatNorm = (paletteCounts.get(currentPalette) || 0) / windowSize;
  const motionRepeatNorm = (motionCounts.get(currentMotion) || 0) / windowSize;
  const lightingRepeatNorm = (lightingCounts.get(currentLighting) || 0) / windowSize;
  const textureRepeatNorm = (textureCounts.get(currentTexture) || 0) / windowSize;
  
  // Check if style is locked for this genre
  const isStyleLocked = genre ? !!GENRE_LOCKED_STYLES[genre] : false;
  
  // Apply palette boost for style-locked genres (culprit detection only)
  // This makes the system learn "palette is the main lever" faster
  const paletteWeight = isStyleLocked 
    ? WEIGHT_COLOR_PALETTE + STYLE_LOCKED_PALETTE_BOOST  // 0.30 for analog_horror
    : WEIGHT_COLOR_PALETTE;                              // 0.25 normal
  
  // Weight by impact (normalized repeat * weight)
  const scores: { dim: SamenessSource["primary_culprit"]; score: number; pattern: string; rawRepeat: number }[] = [
    { 
      dim: "style", 
      score: styleRepeatNorm * WEIGHT_VISUAL_STYLE, 
      pattern: `${currentStyle} in ${Math.round(styleRepeatNorm * 100)}% of recent`,
      rawRepeat: styleRepeatNorm,
    },
    { 
      dim: "palette", 
      score: paletteRepeatNorm * paletteWeight,  // Boosted for style-locked genres
      pattern: `${currentPalette} in ${Math.round(paletteRepeatNorm * 100)}% of recent`,
      rawRepeat: paletteRepeatNorm,
    },
    { 
      dim: "motion", 
      score: motionRepeatNorm * WEIGHT_MOTION_PROFILE, 
      pattern: `${currentMotion} in ${Math.round(motionRepeatNorm * 100)}% of recent`,
      rawRepeat: motionRepeatNorm,
    },
    { 
      dim: "lighting", 
      score: lightingRepeatNorm * WEIGHT_LIGHTING_PROFILE, 
      pattern: `${currentLighting} in ${Math.round(lightingRepeatNorm * 100)}% of recent`,
      rawRepeat: lightingRepeatNorm,
    },
  ];
  
  scores.sort((a, b) => b.score - a.score);
  
  const primary = scores[0];
  let secondary = scores[1]?.score > 0.10 ? scores[1].dim : null;  // Threshold adjusted for normalized
  
  // Tie-breaker: if top two are very close, use texture repeat to decide
  if (scores.length >= 2 && Math.abs(scores[0].score - scores[1].score) < 0.02) {
    // Use texture as tie-breaker
    if (textureRepeatNorm > 0.5) {
      console.log(`[SAMENESS] Tie-breaker: texture repeat (${Math.round(textureRepeatNorm * 100)}%) favors ${scores[0].dim}`);
    }
    // Stick with primary but note the close tie
    secondary = scores[1].dim;
  }
  
  // Threshold for "enough repetition" (normalized: 0.15 = 15% of window)
  if (primary.rawRepeat < 0.15) return null;
  
  if (isStyleLocked) {
    console.log(`[SAMENESS] Style-locked genre (${genre}): palette weight boosted to ${paletteWeight}`);
  }
  
  return {
    primary_culprit: primary.dim,
    secondary_culprit: secondary,
    pattern: primary.pattern,
  };
}

/**
 * Generate surgical recommendation for forcing variety
 * Respects genre-locked dimensions
 */
function generateForcedDimensionRecommendation(
  samenessSource: SamenessSource | null,
  underusedTraits: SimilarityAnalysis["underused_traits"],
  genre: string
): ForcedDimensionRecommendation | null {
  if (!samenessSource) return null;
  
  const culprit = samenessSource.primary_culprit;
  const isGenreLocked = (dim: string) => {
    if (dim === "style" && GENRE_LOCKED_STYLES[genre]) return true;
    return false;
  };
  
  // If primary culprit is genre-locked, move to secondary
  let targetDimension = culprit;
  let targetSuggestions: string[] = [];
  let genreLocked = false;
  
  if (isGenreLocked(culprit)) {
    genreLocked = true;
    // Fall back to palette or motion
    if (samenessSource.secondary_culprit && !isGenreLocked(samenessSource.secondary_culprit)) {
      targetDimension = samenessSource.secondary_culprit as SamenessSource["primary_culprit"];
    } else {
      // Force palette rotation (safest)
      targetDimension = "palette";
    }
  }
  
  // Get allowed values for the dimension
  switch (targetDimension) {
    case "style":
      targetSuggestions = underusedTraits.visual_styles;
      break;
    case "palette":
      const allowedPalettes = GENRE_ALLOWED_PALETTES[genre] || underusedTraits.color_palettes;
      targetSuggestions = underusedTraits.color_palettes.filter(p => 
        !GENRE_ALLOWED_PALETTES[genre] || allowedPalettes.includes(p)
      );
      if (targetSuggestions.length === 0) targetSuggestions = allowedPalettes;
      break;
    case "motion":
      const allowedMotions = GENRE_ALLOWED_MOTIONS[genre] || underusedTraits.motion_profiles;
      targetSuggestions = underusedTraits.motion_profiles.filter(m =>
        !GENRE_ALLOWED_MOTIONS[genre] || allowedMotions.includes(m)
      );
      if (targetSuggestions.length === 0) targetSuggestions = allowedMotions;
      break;
    case "lighting":
      targetSuggestions = underusedTraits.lighting_profiles;
      break;
    default:
      targetSuggestions = [];
  }
  
  const dimensionMap: Record<string, ForcedDimensionRecommendation["dimension"]> = {
    "style": "visual_style",
    "palette": "color_palette",
    "motion": "motion_profile",
    "lighting": "lighting_profile",
    "texture": "texture_artifacts",
  };
  
  return {
    dimension: dimensionMap[targetDimension] || "color_palette",
    reason: genreLocked 
      ? `${culprit} is genre-locked (${genre}), forcing ${targetDimension} instead`
      : `${culprit} repeated too often`,
    suggested_values: targetSuggestions.slice(0, 3),
    genre_locked: genreLocked,
  };
}

/**
 * Analyze visual similarity against recent fingerprints (LOCAL: per brand/platform)
 * Returns recommendation for how to proceed
 */
export async function analyzeVisualSimilarity(
  supabase: any,
  currentVisualDNA: VisualDNA,
  brandId?: string,
  platform?: string,
  recentLimit: number = 20
): Promise<SimilarityAnalysis> {
  const currentFingerprint = generateVisualFingerprint(currentVisualDNA, brandId, platform);
  const genre = currentVisualDNA.derived_from?.genre || "urban_legend";
  
  // Fetch recent Visual DNAs (filter by brand/platform if provided)
  const recentDNAs = await getRecentVisualDNAs(supabase, brandId, platform, recentLimit);
  
  // Generate fingerprints for recent DNAs
  const now = new Date();
  const windowMs = FINGERPRINT_WINDOW_HOURS * 60 * 60 * 1000;
  
  const recentFingerprints: VisualFingerprint[] = recentDNAs
    .filter(dna => {
      const age = now.getTime() - new Date(dna.created_at).getTime();
      return age <= windowMs;
    })
    .map(dna => ({
      hash: `${dna.visual_style}|${dna.color_palette}|${dna.motion_profile}|${dna.lighting_profile}|${[...dna.texture_artifacts].sort().join('+')}`,
      components: {
        visual_style: dna.visual_style,
        color_palette: dna.color_palette,
        motion_profile: dna.motion_profile,
        lighting_profile: dna.lighting_profile,
        texture_signature: [...dna.texture_artifacts].sort().join('+'),
      },
      timestamp: dna.created_at,
      brand_id: dna.brand_id,
      platform: dna.platform,
    }));
  
  // Calculate similarity to each recent fingerprint (with breakdown)
  const similarityScores = recentFingerprints.map(fp => {
    const { score, breakdown } = calculateFingerprintSimilarity(currentFingerprint, fp);
    return {
      hash: fp.hash,
      score,
      age_hours: (now.getTime() - new Date(fp.timestamp).getTime()) / (60 * 60 * 1000),
      breakdown,
    };
  });
  
  // =========================================================
  // RECENCY-WEIGHTED AGGREGATION (improved method)
  // =========================================================
  // Instead of decaying the score (which artificially makes old patterns
  // "less similar"), we weight each comparison by recency.
  // This gives a true recency-weighted average similarity.
  //
  // True half-life: Math.pow(0.5, age/48) means "48h = half influence"
  // =========================================================
  
  let weightedSimilarityAccum = 0;
  let recencyWeightSum = 0;
  let maxRawSimilarity = 0;  // Still track max for edge cases
  
  const weightedScores = similarityScores.map(s => {
    const weight = recencyWeight(s.age_hours);  // True half-life decay
    weightedSimilarityAccum += s.score * weight;
    recencyWeightSum += weight;
    maxRawSimilarity = Math.max(maxRawSimilarity, s.score);
    
    return {
      ...s,
      recency_weight: Math.round(weight * 100) / 100,
      weighted_contribution: Math.round(s.score * weight * 100) / 100,
    };
  });
  
  // Recency-weighted average similarity
  const avgWeightedSimilarity = recencyWeightSum > 0 
    ? weightedSimilarityAccum / recencyWeightSum 
    : 0;
  
  // Use weighted average for threshold comparison
  // But also consider max raw similarity (if something is VERY similar, even if old)
  const maxSimilarity = Math.max(
    avgWeightedSimilarity,
    maxRawSimilarity * 0.7  // Old-but-identical still counts at 70%
  );
  
  console.log(`[FINGERPRINT] Recency-weighted avg: ${(avgWeightedSimilarity * 100).toFixed(1)}%`);
  console.log(`[FINGERPRINT] Max raw similarity: ${(maxRawSimilarity * 100).toFixed(1)}%`);
  
  // Count usage of each trait in recent fingerprints
  const styleCounts = new Map<VisualStyle, number>();
  const paletteCounts = new Map<ColorPalette, number>();
  const motionCounts = new Map<MotionProfile, number>();
  const lightingCounts = new Map<LightingProfile, number>();
  
  for (const fp of recentFingerprints) {
    styleCounts.set(
      fp.components.visual_style as VisualStyle, 
      (styleCounts.get(fp.components.visual_style as VisualStyle) || 0) + 1
    );
    paletteCounts.set(
      fp.components.color_palette as ColorPalette,
      (paletteCounts.get(fp.components.color_palette as ColorPalette) || 0) + 1
    );
    motionCounts.set(
      fp.components.motion_profile as MotionProfile,
      (motionCounts.get(fp.components.motion_profile as MotionProfile) || 0) + 1
    );
    lightingCounts.set(
      fp.components.lighting_profile as LightingProfile,
      (lightingCounts.get(fp.components.lighting_profile as LightingProfile) || 0) + 1
    );
  }
  
  // Find underused traits (0 or 1 usage)
  const allStyles: VisualStyle[] = [
    "VHS_degraded", "cinematic_dark", "cinematic_minimal", 
    "documentary_archival", "surveillance_footage", "found_footage", "polaroid_faded"
  ];
  const allPalettes: ColorPalette[] = [
    "cold_desaturated", "sickly_green", "muted_gray", "deep_shadow_contrast",
    "monochrome_harsh", "amber_decay", "blue_black_void"
  ];
  const allMotions: MotionProfile[] = [
    "none", "micro_jitter", "slow_drift", "slow_pan", "subtle_zoom", "tracking_stutter"
  ];
  const allLightings: LightingProfile[] = [
    "moonlit_fog", "fluorescent_flat", "low_key_shadow", "blown_highlights",
    "single_source_harsh", "twilight_amber", "deep_darkness"
  ];
  
  const underusedStyles = allStyles.filter(s => (styleCounts.get(s) || 0) <= 1);
  const underusedPalettes = allPalettes.filter(p => (paletteCounts.get(p) || 0) <= 1);
  const underusedMotions = allMotions.filter(m => (motionCounts.get(m) || 0) <= 1);
  const underusedLightings = allLightings.filter(l => (lightingCounts.get(l) || 0) <= 1);
  
  // Determine recommendation
  let recommendation: "proceed" | "rebalance" | "force_variety";
  if (maxSimilarity >= FORCE_VARIETY_THRESHOLD) {
    recommendation = "force_variety";
  } else if (maxSimilarity >= SIMILARITY_THRESHOLD) {
    recommendation = "rebalance";
  } else {
    recommendation = "proceed";
  }
  
  // Identify sameness source and generate surgical recommendation
  // Pass genre for style-locked palette boost
  const samenessSource = recommendation !== "proceed" 
    ? identifySamenessSource(currentFingerprint, recentFingerprints, genre)
    : null;
  
  const underusedTraits = {
    visual_styles: underusedStyles,
    color_palettes: underusedPalettes,
    motion_profiles: underusedMotions,
    lighting_profiles: underusedLightings,
  };
  
  const forcedDimension = recommendation === "force_variety"
    ? generateForcedDimensionRecommendation(samenessSource, underusedTraits, genre)
    : null;
  
  const analysis: SimilarityAnalysis = {
    current_fingerprint: currentFingerprint,
    recent_fingerprints: recentFingerprints,
    similarity_scores: similarityScores,
    max_similarity: Math.round(maxSimilarity * 100) / 100,
    is_samey: maxSimilarity >= SIMILARITY_THRESHOLD,
    sameness_source: samenessSource,
    recommendation,
    forced_dimension: forcedDimension,
    underused_traits: underusedTraits,
  };
  
  // Log analysis
  console.log(`[FINGERPRINT] Hash: ${currentFingerprint.hash.substring(0, 50)}...`);
  console.log(`[FINGERPRINT] Compared against ${recentFingerprints.length} recent fingerprints${brandId ? ` (brand: ${brandId})` : ''}`);
  console.log(`[FINGERPRINT] Max similarity: ${(maxSimilarity * 100).toFixed(1)}% (threshold: ${SIMILARITY_THRESHOLD * 100}%)`);
  console.log(`[FINGERPRINT] Recommendation: ${recommendation}`);
  
  if (samenessSource) {
    console.log(`[FINGERPRINT] ⚠️ Sameness source: ${samenessSource.pattern}`);
    console.log(`[FINGERPRINT] ⚠️ Primary culprit: ${samenessSource.primary_culprit}`);
  }
  
  if (forcedDimension) {
    console.log(`[FINGERPRINT] 🔧 Surgical fix: Force ${forcedDimension.dimension}`);
    console.log(`[FINGERPRINT] 🔧 Suggestions: ${forcedDimension.suggested_values.join(', ')}`);
    if (forcedDimension.genre_locked) {
      console.log(`[FINGERPRINT] 🔒 Genre lock active, redirected force`);
    }
  }
  
  return analysis;
}

/**
 * Analyze GLOBAL visual similarity across ALL brands (cross-contamination guard)
 * Use this to detect when different brands start looking too similar
 */
export async function analyzeGlobalVisualSimilarity(
  supabase: any,
  currentVisualDNA: VisualDNA,
  currentBrandId?: string,
  recentLimit: number = 50
): Promise<GlobalSimilarityAnalysis> {
  const currentFingerprint = generateVisualFingerprint(currentVisualDNA);
  
  // Fetch ALL recent Visual DNAs (no brand filter)
  const recentDNAs = await getRecentVisualDNAs(supabase, undefined, undefined, recentLimit);
  
  const now = new Date();
  const windowMs = FINGERPRINT_WINDOW_HOURS * 60 * 60 * 1000;
  
  // Group by brand and calculate average similarity to each brand
  const brandSimilarities = new Map<string, { total: number; count: number; fingerprints: VisualFingerprint[] }>();
  
  for (const dna of recentDNAs) {
    const age = now.getTime() - new Date(dna.created_at).getTime();
    if (age > windowMs) continue;
    
    const brandId = dna.brand_id || "unknown";
    if (brandId === currentBrandId) continue;  // Skip own brand
    
    const fp: VisualFingerprint = {
      hash: `${dna.visual_style}|${dna.color_palette}|${dna.motion_profile}|${dna.lighting_profile}`,
      components: {
        visual_style: dna.visual_style,
        color_palette: dna.color_palette,
        motion_profile: dna.motion_profile,
        lighting_profile: dna.lighting_profile,
        texture_signature: [...dna.texture_artifacts].sort().join('+'),
      },
      timestamp: dna.created_at,
      brand_id: brandId,
    };
    
    const { score } = calculateFingerprintSimilarity(currentFingerprint, fp);
    
    if (!brandSimilarities.has(brandId)) {
      brandSimilarities.set(brandId, { total: 0, count: 0, fingerprints: [] });
    }
    const entry = brandSimilarities.get(brandId)!;
    entry.total += score;
    entry.count += 1;
    entry.fingerprints.push(fp);
  }
  
  // Find highest cross-brand similarity
  let maxCrossBrandSimilarity = 0;
  let contaminationPattern: string | null = null;
  const affectedBrands: string[] = [];
  
  for (const [brandId, data] of brandSimilarities.entries()) {
    const avgSimilarity = data.total / data.count;
    if (avgSimilarity > maxCrossBrandSimilarity) {
      maxCrossBrandSimilarity = avgSimilarity;
    }
    if (avgSimilarity >= GLOBAL_CONTAMINATION_THRESHOLD) {
      affectedBrands.push(brandId);
      contaminationPattern = `Cross-brand similarity ${(avgSimilarity * 100).toFixed(0)}% with ${brandId}`;
    }
  }
  
  const contamination = maxCrossBrandSimilarity >= GLOBAL_CONTAMINATION_THRESHOLD;
  
  if (contamination) {
    console.log(`[GLOBAL-FINGERPRINT] ⚠️ Cross-brand contamination detected!`);
    console.log(`[GLOBAL-FINGERPRINT] Max cross-brand similarity: ${(maxCrossBrandSimilarity * 100).toFixed(1)}%`);
    console.log(`[GLOBAL-FINGERPRINT] Affected brands: ${affectedBrands.join(', ')}`);
  } else {
    console.log(`[GLOBAL-FINGERPRINT] ✓ No cross-brand contamination (max: ${(maxCrossBrandSimilarity * 100).toFixed(1)}%)`);
  }
  
  return {
    cross_brand_similarity: Math.round(maxCrossBrandSimilarity * 100) / 100,
    contamination_detected: contamination,
    contamination_pattern: contaminationPattern,
    affected_brands: affectedBrands,
  };
}

/**
 * Detect N-gram runs (same high-impact pattern repeated in sequence)
 * Even if motion differs, VHS|green|X|X|X 3x in a row = samey
 */
export function analyzeSequencePatterns(
  recentFingerprints: VisualFingerprint[]
): SequenceAnalysis {
  const window = recentFingerprints.slice(0, RUN_WINDOW_SIZE);
  const detectedRuns: { pattern: string; count: number; is_problematic: boolean }[] = [];
  
  // Track high-weight patterns (style + palette)
  const highWeightPatterns: string[] = window.map(fp => 
    `${fp.components.visual_style}|${fp.components.color_palette}`
  );
  
  // Count consecutive runs
  const patternCounts = new Map<string, number>();
  for (const pattern of highWeightPatterns) {
    patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);
  }
  
  for (const [pattern, count] of patternCounts.entries()) {
    const isProblematic = count >= RUN_DETECTION_THRESHOLD;
    if (count >= 2) {
      detectedRuns.push({ pattern, count, is_problematic: isProblematic });
    }
  }
  
  // Determine sequence health
  let health: "healthy" | "warning" | "critical" = "healthy";
  const problematicRuns = detectedRuns.filter(r => r.is_problematic);
  
  if (problematicRuns.length > 0) {
    health = "critical";
    console.log(`[SEQUENCE] ⚠️ Detected ${problematicRuns.length} problematic runs`);
    for (const run of problematicRuns) {
      console.log(`[SEQUENCE]   "${run.pattern}" appeared ${run.count}x in last ${RUN_WINDOW_SIZE}`);
    }
  } else if (detectedRuns.length > 0) {
    health = "warning";
  }
  
  return {
    rolling_window: window,
    detected_runs: detectedRuns,
    sequence_health: health,
  };
}

/**
 * Store fingerprint for future comparison
 */
export async function storeVisualFingerprint(
  supabase: any,
  visualDNA: VisualDNA,
  fingerprint: VisualFingerprint
): Promise<void> {
  // Fingerprint is stored as part of the visual_dna record
  // We could also create a separate table for fast fingerprint lookup
  // For now, we extract from visual_dna during comparison
  
  console.log(`[FINGERPRINT] Fingerprint stored with Visual DNA ${visualDNA.visual_dna_id.substring(0, 8)}`);
}

/**
 * Get visual health report for an account/brand
 * Shows entropy status and identifies sameness patterns
 */
export async function getVisualHealthReport(
  supabase: any,
  brandId?: string,
  windowHours: number = 72
): Promise<{
  entropy_status: { dimension: string; entropy: number; status: string }[];
  sameness_patterns: { pattern: string; count: number; percentage: number }[];
  health_score: number;
  recommendation: string;
}> {
  const recentDNAs = await getRecentVisualDNAs(supabase, brandId, undefined, 50);
  
  // Filter by time window
  const now = new Date();
  const windowMs = windowHours * 60 * 60 * 1000;
  const filteredDNAs = recentDNAs.filter(dna => {
    const age = now.getTime() - new Date(dna.created_at).getTime();
    return age <= windowMs;
  });
  
  if (filteredDNAs.length < 5) {
    return {
      entropy_status: [],
      sameness_patterns: [],
      health_score: 100,
      recommendation: "Not enough data yet - keep generating!",
    };
  }
  
  // Calculate entropy per dimension
  const entropyStatus = calculateVisualEntropy(filteredDNAs as VisualDNA[]);
  
  // Find repeated patterns (fingerprint hashes)
  const patternCounts = new Map<string, number>();
  for (const dna of filteredDNAs) {
    const hash = `${dna.visual_style}|${dna.color_palette}`;
    patternCounts.set(hash, (patternCounts.get(hash) || 0) + 1);
  }
  
  // Sort by frequency
  const samenessPatterns = [...patternCounts.entries()]
    .filter(([_, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pattern, count]) => ({
      pattern,
      count,
      percentage: Math.round((count / filteredDNAs.length) * 100),
    }));
  
  // Calculate overall health score
  const avgEntropy = entropyStatus.length > 0
    ? entropyStatus.reduce((sum, e) => sum + e.entropy, 0) / entropyStatus.length
    : 1;
  
  const repetitionPenalty = samenessPatterns.length > 0
    ? Math.min(0.3, samenessPatterns[0].percentage / 100)
    : 0;
  
  const healthScore = Math.round((avgEntropy - repetitionPenalty) * 100);
  
  // Generate recommendation
  let recommendation: string;
  if (healthScore >= 70) {
    recommendation = "Visual variety is healthy. Keep generating!";
  } else if (healthScore >= 50) {
    recommendation = "Some repetition detected. Consider forcing underused styles.";
  } else {
    recommendation = "HIGH SAMENESS ALERT. Force variety in Story DNA to break patterns.";
  }
  
  return {
    entropy_status: entropyStatus,
    sameness_patterns: samenessPatterns,
    health_score: healthScore,
    recommendation,
  };
}

// =====================================================
// BRAND SHADOW PROFILES (Server-side version)
// =====================================================

export interface BrandShadowProfileConfig {
  brand_id: string;
  genre: string;
  locked_visual_style: VisualStyle | null;
  allowed_palettes: ColorPalette[];
  allowed_motions: MotionProfile[];
  allowed_lightings: LightingProfile[];
  texture_pool: TextureArtifact[];
}

// Default shadow profiles by genre
const GENRE_SHADOW_PROFILES: Record<string, Omit<BrandShadowProfileConfig, 'brand_id'>> = {
  analog_horror: {
    genre: "analog_horror",
    locked_visual_style: "VHS_degraded",
    allowed_palettes: ["sickly_green", "cold_desaturated", "muted_gray", "amber_decay"],
    allowed_motions: ["micro_jitter", "none", "slow_drift", "tracking_stutter"],
    allowed_lightings: ["fluorescent_flat", "deep_darkness", "single_source_harsh"],
    texture_pool: ["scanlines", "tracking_noise", "film_grain", "vignette_heavy"],
  },
  cosmic_horror: {
    genre: "cosmic_horror",
    locked_visual_style: "cinematic_minimal",
    allowed_palettes: ["cold_desaturated", "blue_black_void", "muted_gray", "monochrome_harsh"],
    allowed_motions: ["slow_drift", "none", "subtle_zoom"],
    allowed_lightings: ["moonlit_fog", "deep_darkness", "low_key_shadow"],
    texture_pool: ["fog_bloom", "film_grain", "vignette_heavy"],
  },
  urban_legend: {
    genre: "urban_legend",
    locked_visual_style: null,
    allowed_palettes: ["deep_shadow_contrast", "cold_desaturated", "amber_decay", "muted_gray"],
    allowed_motions: ["slow_pan", "subtle_zoom", "none", "slow_drift"],
    allowed_lightings: ["low_key_shadow", "twilight_amber", "single_source_harsh", "moonlit_fog"],
    texture_pool: ["film_grain", "dust_scratches", "vignette_heavy"],
  },
  true_crime: {
    genre: "true_crime",
    locked_visual_style: null,
    allowed_palettes: ["muted_gray", "deep_shadow_contrast", "cold_desaturated", "monochrome_harsh"],
    allowed_motions: ["none", "slow_pan", "subtle_zoom"],
    allowed_lightings: ["fluorescent_flat", "low_key_shadow", "single_source_harsh"],
    texture_pool: ["compression_noise", "dust_scratches", "vignette_heavy"],
  },
};

/**
 * Get shadow profile for a genre
 * Used to constrain variety forcing
 */
export function getGenreShadowProfile(genre: string): Omit<BrandShadowProfileConfig, 'brand_id'> {
  return GENRE_SHADOW_PROFILES[genre] || {
    genre,
    locked_visual_style: null,
    allowed_palettes: ["cold_desaturated", "sickly_green", "muted_gray", "deep_shadow_contrast", "monochrome_harsh", "amber_decay", "blue_black_void"],
    allowed_motions: ["none", "micro_jitter", "slow_drift", "slow_pan", "subtle_zoom", "tracking_stutter"],
    allowed_lightings: ["moonlit_fog", "fluorescent_flat", "low_key_shadow", "blown_highlights", "single_source_harsh", "twilight_amber", "deep_darkness"],
    texture_pool: ["film_grain", "scanlines", "tracking_noise", "compression_noise", "fog_bloom", "dust_scratches", "vignette_heavy", "chromatic_aberration"],
  };
}

/**
 * Apply variety to Visual DNA respecting shadow profile constraints
 * Only modifies the recommended dimension, preserves genre identity
 */
export function applyVarietyToVisualDNA(
  visualDNA: VisualDNA,
  forcedDimension: ForcedDimensionRecommendation,
  genre: string
): VisualDNA {
  const profile = getGenreShadowProfile(genre);
  const modified = { ...visualDNA };
  
  console.log(`[VARIETY] Applying surgical variety to dimension: ${forcedDimension.dimension}`);
  console.log(`[VARIETY] Suggestions: ${forcedDimension.suggested_values.join(', ')}`);
  
  // Only modify the single dimension recommended
  switch (forcedDimension.dimension) {
    case "visual_style":
      if (!profile.locked_visual_style) {
        const newStyle = forcedDimension.suggested_values[0] as VisualStyle;
        if (newStyle) {
          modified.visual_style = newStyle;
          console.log(`[VARIETY] Changed visual_style: ${visualDNA.visual_style} → ${newStyle}`);
        }
      } else {
        console.log(`[VARIETY] ⚠️ visual_style locked to ${profile.locked_visual_style} for ${genre}`);
      }
      break;
      
    case "color_palette":
      const allowedPalettes = profile.allowed_palettes.filter(p => 
        forcedDimension.suggested_values.includes(p)
      );
      const newPalette = (allowedPalettes.length > 0 ? allowedPalettes[0] : forcedDimension.suggested_values[0]) as ColorPalette;
      if (newPalette && profile.allowed_palettes.includes(newPalette)) {
        modified.color_palette = newPalette;
        console.log(`[VARIETY] Changed color_palette: ${visualDNA.color_palette} → ${newPalette}`);
      }
      break;
      
    case "motion_profile":
      const allowedMotions = profile.allowed_motions.filter(m =>
        forcedDimension.suggested_values.includes(m)
      );
      const newMotion = (allowedMotions.length > 0 ? allowedMotions[0] : forcedDimension.suggested_values[0]) as MotionProfile;
      if (newMotion && profile.allowed_motions.includes(newMotion)) {
        modified.motion_profile = newMotion;
        console.log(`[VARIETY] Changed motion_profile: ${visualDNA.motion_profile} → ${newMotion}`);
      }
      break;
      
    case "lighting_profile":
      const allowedLightings = profile.allowed_lightings.filter(l =>
        forcedDimension.suggested_values.includes(l)
      );
      const newLighting = (allowedLightings.length > 0 ? allowedLightings[0] : forcedDimension.suggested_values[0]) as LightingProfile;
      if (newLighting && profile.allowed_lightings.includes(newLighting)) {
        modified.lighting_profile = newLighting;
        console.log(`[VARIETY] Changed lighting_profile: ${visualDNA.lighting_profile} → ${newLighting}`);
      }
      break;
      
    default:
      console.log(`[VARIETY] ⚠️ Unknown dimension: ${forcedDimension.dimension}`);
  }
  
  return modified;
}

/**
 * Full similarity check with automatic variety application
 * Runs local + global checks, applies surgical fix if needed
 */
export async function checkAndApplyVariety(
  supabase: any,
  visualDNA: VisualDNA,
  brandId?: string,
  platform?: string
): Promise<{ 
  modified: boolean; 
  finalDNA: VisualDNA; 
  localAnalysis: SimilarityAnalysis;
  globalAnalysis: GlobalSimilarityAnalysis | null;
}> {
  const genre = visualDNA.derived_from?.genre || "urban_legend";
  
  // 1. Local similarity check (per brand/platform)
  const localAnalysis = await analyzeVisualSimilarity(supabase, visualDNA, brandId, platform);
  
  // 2. Global contamination check
  let globalAnalysis: GlobalSimilarityAnalysis | null = null;
  if (brandId) {
    globalAnalysis = await analyzeGlobalVisualSimilarity(supabase, visualDNA, brandId);
  }
  
  // 3. Sequence analysis
  const sequenceAnalysis = analyzeSequencePatterns(localAnalysis.recent_fingerprints);
  
  // 4. Determine if variety should be forced
  let shouldForce = localAnalysis.recommendation === "force_variety";
  
  // Also force if global contamination detected
  if (globalAnalysis?.contamination_detected) {
    console.log(`[VARIETY] Global contamination detected - forcing variety`);
    shouldForce = true;
  }
  
  // Also force if sequence analysis shows critical run
  if (sequenceAnalysis.sequence_health === "critical") {
    console.log(`[VARIETY] Critical sequence run detected - forcing variety`);
    shouldForce = true;
  }
  
  // 5. Apply variety if needed
  if (shouldForce && localAnalysis.forced_dimension) {
    const modifiedDNA = applyVarietyToVisualDNA(
      visualDNA, 
      localAnalysis.forced_dimension,
      genre
    );
    
    return {
      modified: true,
      finalDNA: modifiedDNA,
      localAnalysis,
      globalAnalysis,
    };
  }
  
  return {
    modified: false,
    finalDNA: visualDNA,
    localAnalysis,
    globalAnalysis,
  };
}
