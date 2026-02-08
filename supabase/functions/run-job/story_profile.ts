/**
 * Story Profile System v1.0
 * 
 * Brand-agnostic narrative enforcement for story generation.
 * Each profile controls structural requirements, motif recurrence,
 * voice format compliance, closure behavior, and beat structure.
 * 
 * Flow:
 * 1. System defaults provide baseline
 * 2. Template defaults override by niche
 * 3. Brand settings can override template
 * 4. User can override everything via story_profile
 * 5. Final profile = merge(system, template, brand, user)
 * 6. Profile drives prompt contract + validation
 * 
 * This is NOT horror-specific. Works across niches:
 * - Horror: antiClosure high, motif 3+, voice=transcript
 * - Food facts: closure high, motif 1, voice=host_explainer
 * - Finance: closure medium, motif 2, voice=narrator
 */

// =====================================================
// SCHEMA VERSION
// =====================================================
export const STORY_PROFILE_SCHEMA_VERSION = 1;

// =====================================================
// TYPE DEFINITIONS
// =====================================================

/** Voice format structural requirements */
export interface VoiceFormatConfig {
  /** Format identifier (e.g., "radio_transcript", "host_explainer", "documentary_narrator") */
  format: string;
  /** Structural markers required in output (e.g., ["[STATIC]", "[PAUSE]"] for radio) */
  structuralMarkers: string[];
  /** Whether to enforce markers in validation */
  enforceMarkers: boolean;
  /** Example fragment for few-shot guidance */
  exampleFragment?: string;
  /** POV constraint: "first", "third", "passive", "any" */
  povConstraint: "first" | "third" | "passive" | "any";
  /** Additional style notes */
  styleNotes?: string;
}

/** Motif/repeating detail configuration */
export interface MotifConfig {
  /** Minimum times the repeating detail must appear */
  minMentions: number;
  /** Whether the motif should escalate/transform across mentions */
  shouldEscalate: boolean;
  /** Distribution preference: "spread" (evenly) or "clustered" (together) */
  distribution: "spread" | "clustered";
}

/** Unique element configuration */
export interface UniqueElementConfig {
  /** Minimum appearances (should be >= 2 for escalation) */
  minAppearances: number;
  /** Whether second appearance must worsen/reveal new implication */
  requireEscalation: boolean;
  /** Position preference for final mention: "penultimate" or "final" */
  finalMentionPosition: "penultimate" | "final" | "any";
  /** Whether to enforce minAppearances as hard failure (vs warning) */
  enforce: boolean;
}

/** Ending/closure configuration */
export interface EndingConfig {
  /** Anti-closure level: 0 = full resolution, 1 = maximally unresolved */
  antiClosure: number;
  /** Whether to enforce DNA's final_image concretely */
  enforceFinalImage: boolean;
  /** Allowed ending types for this profile */
  allowedEndingTypes: string[];
  /** Ending style for brand-safe control */
  endingStyle: "open_loop" | "suppressed" | "takeaway" | "cta" | "resolution" | "cyclical";
  /** Takeaway/call-to-action (for educational content) */
  takeaway?: {
    enabled: boolean;
    style: "question" | "fact" | "action" | "reflection";
  };
}

/** Beat structure configuration */
export interface BeatStructureConfig {
  /** Number of beats to enforce */
  beatCount: number;
  /** Beat labels (e.g., ["SETUP", "ESCALATION", "TURN", "FINAL"]) */
  beatLabels: string[];
  /** Whether each beat requires a grounding detail */
  requireGroundingDetail: boolean;
  /** Grounding detail types: object, sound, smell, texture, tech */
  groundingTypes: string[];
  /** Minimum words per beat */
  minWordsPerBeat: number;
  /** Maximum words per beat */
  maxWordsPerBeat: number;
  /** Minimum grounding details per beat (if requireGroundingDetail=true) */
  minGroundingPerBeat: number;
  /** Whether missing grounding triggers repair (visual-first niches) */
  repairOnMissingGrounding: boolean;
}

/** Era/location embodiment requirements */
export interface EmbodimentConfig {
  /** Level of era embodiment: "name_only", "objects", "full_immersion" */
  eraLevel: "name_only" | "objects" | "full_immersion";
  /** Require period-accurate objects/tech */
  requirePeriodObjects: boolean;
  /** Require location-specific sensory details */
  requireLocationSensory: boolean;
}

/** Authority response configuration (for applicable genres) */
export interface AuthorityConfig {
  /** Style: "summary", "procedural", "absent" */
  style: "summary" | "procedural" | "absent";
  /** Minimum detail level if procedural */
  minDetailSentences: number;
}

/** Word count configuration */
export interface WordCountConfig {
  /** Target word count */
  target: number;
  /** Allowed variance (+/-) */
  variance: number;
  /** Priority: "structure" (beats first) or "flow" (natural prose) */
  priority: "structure" | "flow";
  /** Whether to strictly enforce word range (hard failure vs warning) */
  strictEnforcement: boolean;
}

/** Output mode determines prose style within beat structure */
export type OutputMode = 
  | "narrative"     // Traditional narrative prose (default)
  | "broadcast"     // News/broadcast style - short punchy sentences
  | "bullet_tips"   // Bullet point tips/lists with intro/outro
  | "explainer"     // Educational explainer - clear, didactic
  | "cta_script";   // Call-to-action script - persuasive, direct

/** Output mode configuration */
export interface OutputModeConfig {
  /** The output mode style */
  mode: OutputMode;
  /** Allow bullet points/lists in output */
  allowBullets: boolean;
  /** Allow numbered lists */
  allowNumberedLists: boolean;
  /** Sentence length preference: short, medium, long */
  sentenceLength: "short" | "medium" | "long";
  /** Whether to use transitional phrases between sections */
  useTransitions: boolean;
}

/** Generation behavior configuration */
export interface GenerationConfig {
  /** Allow fallback to legacy prompt if contract fails (default: true) */
  allowLegacyFallback: boolean;
  /** Repair pass temperature (0.0-1.0, lower = more deterministic) */
  repairTemperature: number;
  /** Maximum repair attempts before giving up */
  maxRepairAttempts: number;
}

/** Visual readiness severity configuration v2.1 */
export interface VisualReadinessConfig {
  /** If true, missing grounding causes FAIL (blocks image gen). Default: false (warning only) */
  failOnMissingGrounding: boolean;
  /** If true, missing grounding issues a warning. Default: true */
  warnOnMissingGrounding: boolean;
  /** If true, missing environment causes FAIL. Default: false (warning only) */
  failOnMissingEnvironment: boolean;
  /** If true, missing environment issues a warning. Default: true */
  warnOnMissingEnvironment: boolean;
  /** If true, completely abstract beats (no props, no actions, no env) cause FAIL. Default: true */
  failOnAbstract: boolean;
  /** Minimum score (0-100) for a beat to be considered visually ready. Default: 30 */
  minScoreForReady: number;
}

/** Main Story Profile interface */
export interface StoryProfile {
  version: string;
  schema_version: number;
  profile_name?: string;
  profile_source?: string; // "system", "template", "brand", "user"
  
  // Voice format
  voiceFormat: VoiceFormatConfig;
  
  // Narrative elements
  motif: MotifConfig;
  uniqueElement: UniqueElementConfig;
  
  // Structure
  beatStructure: BeatStructureConfig;
  embodiment: EmbodimentConfig;
  authority: AuthorityConfig;
  
  // Ending
  ending: EndingConfig;
  
  // Word count
  wordCount: WordCountConfig;
  
  // Output mode/style
  outputMode: OutputModeConfig;
  
  // Generation behavior
  generation: GenerationConfig;
  
  // Visual readiness severity rules (v2.1)
  visualReadiness: VisualReadinessConfig;
  
  // Genre-specific flags
  genreFlags?: Record<string, boolean | number | string>;
}

/** Partial profile for overrides */
export type PartialStoryProfile = {
  [K in keyof StoryProfile]?: StoryProfile[K] extends object 
    ? Partial<StoryProfile[K]> 
    : StoryProfile[K];
};

// =====================================================
// SYSTEM DEFAULTS (Brand-Agnostic Baseline)
// =====================================================

export const SYSTEM_STORY_DEFAULTS: StoryProfile = {
  version: "1.0",
  schema_version: STORY_PROFILE_SCHEMA_VERSION,
  profile_source: "system",
  
  voiceFormat: {
    format: "narrator",
    structuralMarkers: [],
    enforceMarkers: false,
    povConstraint: "third",
  },
  
  motif: {
    minMentions: 2,
    shouldEscalate: false,
    distribution: "spread",
  },
  
  uniqueElement: {
    minAppearances: 1,
    requireEscalation: false,
    finalMentionPosition: "any",
    enforce: false, // System default: warning only
  },
  
  beatStructure: {
    beatCount: 4,
    beatLabels: ["OPENING", "DEVELOPMENT", "TURN", "CLOSE"],
    requireGroundingDetail: false,
    groundingTypes: ["object", "sound", "visual"],
    minWordsPerBeat: 20,
    maxWordsPerBeat: 60,
    minGroundingPerBeat: 1,
    repairOnMissingGrounding: false, // System default: no repair
  },
  
  embodiment: {
    eraLevel: "name_only",
    requirePeriodObjects: false,
    requireLocationSensory: false,
  },
  
  authority: {
    style: "summary",
    minDetailSentences: 0,
  },
  
  ending: {
    antiClosure: 0.3,
    enforceFinalImage: false,
    allowedEndingTypes: ["resolved", "open", "twist"],
    endingStyle: "resolution",
  },
  
  wordCount: {
    target: 140,
    variance: 20,
    priority: "flow",
    strictEnforcement: true, // Always enforce word range
  },
  
  outputMode: {
    mode: "narrative",
    allowBullets: false,
    allowNumberedLists: false,
    sentenceLength: "medium",
    useTransitions: true,
  },
  
  generation: {
    allowLegacyFallback: true,
    repairTemperature: 0.15,
    maxRepairAttempts: 1,
  },
  
  visualReadiness: {
    failOnMissingGrounding: false,  // Missing grounding = warning, not fail
    warnOnMissingGrounding: true,
    failOnMissingEnvironment: false, // Missing environment = warning, not fail
    warnOnMissingEnvironment: true,
    failOnAbstract: true,  // Truly abstract beats (nothing visual) = fail
    minScoreForReady: 30,  // Score threshold for "ready"
  },
};

// =====================================================
// TEMPLATE DEFAULTS BY NICHE
// =====================================================

export const TEMPLATE_STORY_DEFAULTS: Record<string, PartialStoryProfile> = {
  // Horror niche - urban legend style
  horror: {
    profile_name: "horror_urban_legend",
    
    voiceFormat: {
      format: "documentary_narrator",
      structuralMarkers: [],
      enforceMarkers: false,
      povConstraint: "third",
      styleNotes: "Calm, measured narration. Documentary feel. The horror comes from the facts, not the delivery.",
    },
    
    motif: {
      minMentions: 3,
      shouldEscalate: true,
      distribution: "spread",
    },
    
    uniqueElement: {
      minAppearances: 2,
      requireEscalation: true,
      finalMentionPosition: "penultimate",
      enforce: true, // Horror: hard failure if unique element missing
    },
    
    beatStructure: {
      beatCount: 5,
      beatLabels: ["OPENING", "EARLY_REPORTS", "PATTERN", "ESCALATION", "FINAL_IMAGE"],
      requireGroundingDetail: true,
      groundingTypes: ["object", "sound", "smell", "tech"],
      minWordsPerBeat: 20,
      maxWordsPerBeat: 45,
      minGroundingPerBeat: 1,
      repairOnMissingGrounding: true, // Horror: visual-first niche, repair missing grounding
    },
    
    embodiment: {
      eraLevel: "objects",
      requirePeriodObjects: true,
      requireLocationSensory: true,
    },
    
    authority: {
      style: "procedural",
      minDetailSentences: 1,
    },
    
    ending: {
      antiClosure: 0.85,
      enforceFinalImage: true,
      allowedEndingTypes: ["unresolved", "suppressed", "cyclical", "ongoing"],
      endingStyle: "suppressed",
    },
    
    wordCount: {
      target: 140,
      variance: 20,
      priority: "structure",
      strictEnforcement: true,
    },
    
    // Horror visual readiness: lenient on grounding (visual-first but atmospheric allowed)
    visualReadiness: {
      failOnMissingGrounding: false,  // Horror allows atmospheric beats without concrete grounding
      warnOnMissingGrounding: true,
      failOnMissingEnvironment: false, // Horror can have ambiguous environments
      warnOnMissingEnvironment: true,
      failOnAbstract: true,  // Still fail truly abstract beats
      minScoreForReady: 25,  // Slightly lower threshold for horror
    },
  },
  
  // Food/recipe content
  food: {
    profile_name: "food_explainer",
    
    voiceFormat: {
      format: "host_explainer",
      structuralMarkers: [],
      enforceMarkers: false,
      povConstraint: "any",
      styleNotes: "Friendly, enthusiastic. Like a cooking show host sharing a fun fact.",
    },
    
    motif: {
      minMentions: 1,
      shouldEscalate: false,
      distribution: "clustered",
    },
    
    uniqueElement: {
      minAppearances: 1,
      requireEscalation: false,
      finalMentionPosition: "any",
      enforce: false, // Food: warning only
    },
    
    beatStructure: {
      beatCount: 4,
      beatLabels: ["HOOK", "FACT", "CONTEXT", "TAKEAWAY"],
      requireGroundingDetail: true,
      groundingTypes: ["object", "visual", "taste", "texture"],
      minWordsPerBeat: 25,
      maxWordsPerBeat: 50,
      minGroundingPerBeat: 1,
      repairOnMissingGrounding: true, // Food: visual-first niche
    },
    
    embodiment: {
      eraLevel: "name_only",
      requirePeriodObjects: false,
      requireLocationSensory: true,
    },
    
    authority: {
      style: "absent",
      minDetailSentences: 0,
    },
    
    ending: {
      antiClosure: 0.1,
      enforceFinalImage: false,
      allowedEndingTypes: ["resolved", "call_to_action"],
      endingStyle: "takeaway",
      takeaway: {
        enabled: true,
        style: "action",
      },
    },
    
    wordCount: {
      target: 120,
      variance: 15,
      priority: "flow",
      strictEnforcement: true,
    },
  },
  
  // Finance/money tips
  finance: {
    profile_name: "finance_tips",
    
    voiceFormat: {
      format: "expert_narrator",
      structuralMarkers: [],
      enforceMarkers: false,
      povConstraint: "third",
      styleNotes: "Authoritative but accessible. Clear, actionable advice.",
    },
    
    motif: {
      minMentions: 2,
      shouldEscalate: false,
      distribution: "spread",
    },
    
    uniqueElement: {
      minAppearances: 1,
      requireEscalation: false,
      finalMentionPosition: "any",
      enforce: false, // Finance: warning only
    },
    
    beatStructure: {
      beatCount: 4,
      beatLabels: ["PROBLEM", "INSIGHT", "SOLUTION", "TAKEAWAY"],
      requireGroundingDetail: true,
      groundingTypes: ["number", "example", "comparison"],
      minWordsPerBeat: 25,
      maxWordsPerBeat: 50,
      minGroundingPerBeat: 1,
      repairOnMissingGrounding: false, // Finance: not visual-first
    },
    
    embodiment: {
      eraLevel: "name_only",
      requirePeriodObjects: false,
      requireLocationSensory: false,
    },
    
    authority: {
      style: "summary",
      minDetailSentences: 0,
    },
    
    ending: {
      antiClosure: 0.2,
      enforceFinalImage: false,
      allowedEndingTypes: ["resolved", "call_to_action"],
      endingStyle: "cta",
      takeaway: {
        enabled: true,
        style: "action",
      },
    },
    
    wordCount: {
      target: 130,
      variance: 15,
      priority: "flow",
      strictEnforcement: true,
    },
  },
  
  // Motivational/inspirational
  motivation: {
    profile_name: "inspirational_narrator",
    
    voiceFormat: {
      format: "inspirational_narrator",
      structuralMarkers: [],
      enforceMarkers: false,
      povConstraint: "any",
      styleNotes: "Warm, encouraging. Build to an emotional peak.",
    },
    
    motif: {
      minMentions: 2,
      shouldEscalate: true,
      distribution: "spread",
    },
    
    uniqueElement: {
      minAppearances: 1,
      requireEscalation: false,
      finalMentionPosition: "final",
      enforce: false, // Motivation: warning only
    },
    
    beatStructure: {
      beatCount: 4,
      beatLabels: ["CHALLENGE", "STRUGGLE", "BREAKTHROUGH", "LESSON"],
      requireGroundingDetail: true,
      groundingTypes: ["emotion", "action", "visual"],
      minWordsPerBeat: 25,
      maxWordsPerBeat: 50,
      minGroundingPerBeat: 1,
      repairOnMissingGrounding: false, // Motivation: not visual-first
    },
    
    embodiment: {
      eraLevel: "name_only",
      requirePeriodObjects: false,
      requireLocationSensory: false,
    },
    
    authority: {
      style: "absent",
      minDetailSentences: 0,
    },
    
    ending: {
      antiClosure: 0.3,
      enforceFinalImage: false,
      allowedEndingTypes: ["resolved", "call_to_action", "reflection"],
      endingStyle: "takeaway",
      takeaway: {
        enabled: true,
        style: "reflection",
      },
    },
    
    wordCount: {
      target: 140,
      variance: 20,
      priority: "flow",
    },
  },
  
  // Generic fallback
  generic: {
    profile_name: "generic_narrator",
    
    voiceFormat: {
      format: "narrator",
      structuralMarkers: [],
      enforceMarkers: false,
      povConstraint: "third",
    },
    
    motif: {
      minMentions: 2,
      shouldEscalate: false,
      distribution: "spread",
    },
    
    uniqueElement: {
      minAppearances: 1,
      requireEscalation: false,
      finalMentionPosition: "any",
    },
    
    beatStructure: {
      beatCount: 4,
      beatLabels: ["OPENING", "DEVELOPMENT", "CLIMAX", "CLOSE"],
      requireGroundingDetail: false,
      groundingTypes: ["object", "sound", "visual"],
      minWordsPerBeat: 25,
      maxWordsPerBeat: 50,
    },
    
    embodiment: {
      eraLevel: "name_only",
      requirePeriodObjects: false,
      requireLocationSensory: false,
    },
    
    authority: {
      style: "summary",
      minDetailSentences: 0,
    },
    
    ending: {
      antiClosure: 0.4,
      enforceFinalImage: false,
      allowedEndingTypes: ["resolved", "open", "twist"],
      endingStyle: "open_loop",
    },
    
    wordCount: {
      target: 140,
      variance: 20,
      priority: "flow",
    },
  },
};

// =====================================================
// PRESET STORY PROFILES (for vibe_preset)
// =====================================================

export const PRESET_STORY_PROFILES: Record<string, PartialStoryProfile> = {
  // =====================================================
  // ACTIVE STORY ENGINES (v2.0)
  // =====================================================
  // 
  // WHY ONLY TWO PRESETS?
  // ---------------------
  // Presets are STORY ENGINES, not genres or vibes. Each must:
  // 1. Enforce unique structural rules that change the writing logic
  // 2. Have clear, detectable failure modes
  // 3. Justify its existence independently (not just "different mood")
  // 4. Be safe for auto-generation (no weak/generic outputs)
  //
  // CRITERIA FOR ADDING A NEW PRESET:
  // - Must have structural enforcement (beat structure, required elements)
  // - Must have clear pass/fail compliance checks
  // - Must be mechanically different (not just tone changes)
  // - Must be tested with 20+ generations for consistency
  //
  // FUTURE PRESET CANDIDATES:
  // - Rules Horror: "Don't break the rules" / survival instructions
  // - Memory Horror: Unreliable narrator, contradicting details
  // - Countdown Horror: Time-based escalation with real timestamps
  // =====================================================

  // =====================================================
  // URBAN_LEGEND - Broad Folklore Engine
  // =====================================================
  // The default, flexible engine for documentary-style horror.
  // Designed for high-volume auto-generation.
  //
  // STRUCTURAL RULES:
  // - Authority denial (officials explain it away)
  // - Repeating motif (3+ mentions with escalation)
  // - Ambiguous ending (90% anti-closure)
  // - Final image requirement (visual proof)
  //
  // FAILURE MODES:
  // - motif < 3 mentions = fail
  // - unique_element < 2 = fail  
  // - final_image missing = fail
  // - resolution/explanation = fail
  // =====================================================
  urban_legend: {
    profile_name: "urban_legend",
    
    voiceFormat: {
      format: "documentary_narrator",
      structuralMarkers: [],
      enforceMarkers: false,
      povConstraint: "third",
      styleNotes: "Calm, factual documentary. The horror comes from 'this really happened.'",
    },
    
    motif: {
      minMentions: 3,
      shouldEscalate: true,
      distribution: "spread",
    },
    
    uniqueElement: {
      minAppearances: 2,
      requireEscalation: true,
      finalMentionPosition: "penultimate",
      enforce: true, // Hard failure if unique element < 2 mentions
    },
    
    ending: {
      antiClosure: 0.9,
      enforceFinalImage: true,
      allowedEndingTypes: ["unresolved", "suppressed", "ongoing"],
      endingStyle: "open_loop",
    },
  },

  // =====================================================
  // ONE_TOO_MANY - Structural Counting Horror
  // =====================================================
  // Highly constrained micro-preset with explicit numeric logic.
  // The story CANNOT work without the counting mechanic.
  //
  // STRUCTURAL RULES:
  // - Explicit group size (N people)
  // - Wrong count (always N+1, never varies)
  // - Container math (seats, rooms, faces, photos)
  // - Mandatory final proof (photo/receipt/recording showing N+1)
  // - Escalation MUST worsen the count inconsistency
  //
  // FAILURE MODES:
  // - Numbers drift (N→N+2 or N-1→N) = fail
  // - Vague numbers ("a few", "several") = fail
  // - Missing final proof image = fail
  // - Extra person explained/identified = fail
  // - Counting mechanic removable from story = fail
  // =====================================================
  one_too_many: {
    profile_name: "one_too_many",
    
    voiceFormat: {
      format: "documentary_narrator",
      structuralMarkers: [],
      enforceMarkers: false,
      povConstraint: "third",
      styleNotes: "Calm factual recounting. Numbers matter. The horror comes from mathematics not adding up.",
    },
    
    // Motif: the count itself - must appear 3+ times with escalation
    motif: {
      minMentions: 3,
      shouldEscalate: true,
      distribution: "spread",
    },
    
    // Unique element: the "extra person" anomaly
    uniqueElement: {
      minAppearances: 2,
      requireEscalation: true,
      finalMentionPosition: "penultimate",
      enforce: true,
    },
    
    // 5 beats: structured counting horror progression
    beatStructure: {
      beatCount: 5,
      beatLabels: ["OPENING", "EARLY_REPORTS", "PATTERN", "ESCALATION", "FINAL_IMAGE"],
      requireGroundingDetail: true,
      groundingTypes: ["object", "sound", "tech", "reflection"],
      minWordsPerBeat: 20,
      maxWordsPerBeat: 45,
      minGroundingPerBeat: 1,
      repairOnMissingGrounding: true,
    },
    
    embodiment: {
      eraLevel: "objects",
      requirePeriodObjects: false,
      requireLocationSensory: true,
    },
    
    authority: {
      style: "procedural",
      minDetailSentences: 1,
    },
    
    ending: {
      antiClosure: 0.9,
      enforceFinalImage: true, // CRITICAL: Must have proof image
      allowedEndingTypes: ["unresolved", "suppressed", "proof_discovered"],
      endingStyle: "open_loop",
    },
    
    wordCount: {
      target: 170,
      variance: 25,
      priority: "structure",
      strictEnforcement: true,
    },
    
    visualReadiness: {
      failOnMissingGrounding: false,
      warnOnMissingGrounding: true,
      failOnMissingEnvironment: false,
      warnOnMissingEnvironment: true,
      failOnAbstract: true,
      minScoreForReady: 30,
    },
    
    genreFlags: {
      use_trope_pack: "one_too_many",
      preset_category: "micro-preset",
      core_anomaly: "count_mismatch",
    },
  },
  
  // =====================================================
  // DEPRECATED PRESETS - ARCHIVED
  // =====================================================
  // The following presets are deprecated and archived.
  // They map to urban_legend for backward compatibility.
  // DO NOT add new presets here. See criteria above.
  // =====================================================
};

// =====================================================
// PROFILE RESOLUTION
// =====================================================

/**
 * Deep merge two objects, with source overriding target
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = target[key];
    
    if (sourceValue === undefined) continue;
    
    if (
      typeof sourceValue === 'object' && 
      sourceValue !== null && 
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(targetValue, sourceValue as any);
    } else {
      result[key] = sourceValue as T[keyof T];
    }
  }
  
  return result;
}

export interface ResolveStoryProfileOptions {
  /** System defaults (usually SYSTEM_STORY_DEFAULTS) */
  system?: StoryProfile;
  /** Template/niche defaults (from TEMPLATE_STORY_DEFAULTS) */
  template?: PartialStoryProfile;
  /** Preset defaults (from PRESET_STORY_PROFILES) */
  preset?: PartialStoryProfile;
  /** Brand-level overrides */
  brand?: PartialStoryProfile;
  /** User-level overrides */
  user?: PartialStoryProfile;
}

/**
 * Resolve story profile by merging layers:
 * system -> template -> preset -> brand -> user
 */
export function resolveStoryProfile(options: ResolveStoryProfileOptions): StoryProfile {
  const { system, template, preset, brand, user } = options;
  
  // Start with system defaults
  let resolved = system ? { ...system } : { ...SYSTEM_STORY_DEFAULTS };
  
  // Apply template defaults
  // Using 'as any' because PartialStoryProfile has nested partials
  // The sanitize step after resolve ensures all values are valid
  if (template) {
    resolved = deepMerge(resolved, template as any);
    resolved.profile_source = "template";
  }
  
  // Apply preset defaults
  if (preset) {
    resolved = deepMerge(resolved, preset as any);
    resolved.profile_source = "preset";
  }
  
  // Apply brand overrides
  if (brand) {
    resolved = deepMerge(resolved, brand as any);
    resolved.profile_source = "brand";
  }
  
  // Apply user overrides
  if (user) {
    resolved = deepMerge(resolved, user as any);
    resolved.profile_source = "user";
  }
  
  // Ensure schema version
  resolved.schema_version = STORY_PROFILE_SCHEMA_VERSION;
  
  return resolved;
}

/**
 * Get template defaults by niche
 */
export function getTemplateDefaults(niche: string): PartialStoryProfile | undefined {
  return TEMPLATE_STORY_DEFAULTS[niche] || TEMPLATE_STORY_DEFAULTS.generic;
}

/**
 * Get preset profile by vibe_preset
 */
export function getPresetProfile(vibePreset: string): PartialStoryProfile | undefined {
  return PRESET_STORY_PROFILES[vibePreset];
}

// =====================================================
// SANITIZATION
// =====================================================

const KNOWN_PROFILE_KEYS = new Set([
  'version', 'schema_version', 'profile_name', 'profile_source',
  'voiceFormat', 'motif', 'uniqueElement', 'beatStructure',
  'embodiment', 'authority', 'ending', 'wordCount', 'outputMode', 'generation', 'genreFlags'
]);

/**
 * Clamp a number to a range
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Sanitize and validate a story profile
 * - Clamps numeric values
 * - Coerces types
 * - Drops unknown keys
 * - Falls back to defaults for invalid values
 */
export function sanitizeStoryProfile(profile: any): StoryProfile {
  if (!profile || typeof profile !== 'object') {
    console.warn('[StoryProfile] Invalid profile, returning system defaults');
    return { ...SYSTEM_STORY_DEFAULTS };
  }
  
  const sanitized: StoryProfile = {
    version: String(profile.version || "1.0"),
    schema_version: STORY_PROFILE_SCHEMA_VERSION,
    profile_source: profile.profile_source || "sanitized",
    profile_name: profile.profile_name || undefined,
    
    voiceFormat: {
      format: String(profile.voiceFormat?.format || SYSTEM_STORY_DEFAULTS.voiceFormat.format),
      structuralMarkers: Array.isArray(profile.voiceFormat?.structuralMarkers) 
        ? profile.voiceFormat.structuralMarkers.map(String) 
        : [],
      enforceMarkers: Boolean(profile.voiceFormat?.enforceMarkers),
      povConstraint: ['first', 'third', 'passive', 'any'].includes(profile.voiceFormat?.povConstraint)
        ? profile.voiceFormat.povConstraint
        : 'third',
      styleNotes: profile.voiceFormat?.styleNotes || undefined,
      exampleFragment: profile.voiceFormat?.exampleFragment || undefined,
    },
    
    motif: {
      minMentions: clamp(Number(profile.motif?.minMentions) || 2, 1, 10),
      shouldEscalate: Boolean(profile.motif?.shouldEscalate),
      distribution: ['spread', 'clustered'].includes(profile.motif?.distribution)
        ? profile.motif.distribution
        : 'spread',
    },
    
    uniqueElement: {
      minAppearances: clamp(Number(profile.uniqueElement?.minAppearances) || 1, 1, 5),
      requireEscalation: Boolean(profile.uniqueElement?.requireEscalation),
      finalMentionPosition: ['penultimate', 'final', 'any'].includes(profile.uniqueElement?.finalMentionPosition)
        ? profile.uniqueElement.finalMentionPosition
        : 'any',
    },
    
    beatStructure: {
      beatCount: clamp(Number(profile.beatStructure?.beatCount) || 4, 2, 10),
      beatLabels: Array.isArray(profile.beatStructure?.beatLabels)
        ? profile.beatStructure.beatLabels.map(String)
        : SYSTEM_STORY_DEFAULTS.beatStructure.beatLabels,
      requireGroundingDetail: Boolean(profile.beatStructure?.requireGroundingDetail),
      groundingTypes: Array.isArray(profile.beatStructure?.groundingTypes)
        ? profile.beatStructure.groundingTypes.map(String)
        : SYSTEM_STORY_DEFAULTS.beatStructure.groundingTypes,
      minWordsPerBeat: clamp(Number(profile.beatStructure?.minWordsPerBeat) || 20, 10, 100),
      maxWordsPerBeat: clamp(Number(profile.beatStructure?.maxWordsPerBeat) || 50, 20, 150),
    },
    
    embodiment: {
      eraLevel: ['name_only', 'objects', 'full_immersion'].includes(profile.embodiment?.eraLevel)
        ? profile.embodiment.eraLevel
        : 'name_only',
      requirePeriodObjects: Boolean(profile.embodiment?.requirePeriodObjects),
      requireLocationSensory: Boolean(profile.embodiment?.requireLocationSensory),
    },
    
    authority: {
      style: ['summary', 'procedural', 'absent'].includes(profile.authority?.style)
        ? profile.authority.style
        : 'summary',
      minDetailSentences: clamp(Number(profile.authority?.minDetailSentences) || 0, 0, 5),
    },
    
    ending: {
      antiClosure: clamp(Number(profile.ending?.antiClosure) ?? 0.3, 0, 1),
      enforceFinalImage: Boolean(profile.ending?.enforceFinalImage),
      allowedEndingTypes: Array.isArray(profile.ending?.allowedEndingTypes)
        ? profile.ending.allowedEndingTypes.map(String)
        : SYSTEM_STORY_DEFAULTS.ending.allowedEndingTypes,
      endingStyle: ['open_loop', 'suppressed', 'takeaway', 'cta', 'resolution', 'cyclical'].includes(profile.ending?.endingStyle)
        ? profile.ending.endingStyle
        : 'resolution',
      takeaway: profile.ending?.takeaway ? {
        enabled: Boolean(profile.ending.takeaway.enabled),
        style: ['question', 'fact', 'action', 'reflection'].includes(profile.ending.takeaway.style)
          ? profile.ending.takeaway.style
          : 'action',
      } : undefined,
    },
    
    wordCount: {
      target: clamp(Number(profile.wordCount?.target) || 140, 50, 500),
      variance: clamp(Number(profile.wordCount?.variance) || 20, 5, 100),
      priority: ['structure', 'flow'].includes(profile.wordCount?.priority)
        ? profile.wordCount.priority
        : 'flow',
    },
    
    outputMode: {
      mode: ['narrative', 'broadcast', 'bullet_tips', 'explainer', 'cta_script'].includes(profile.outputMode?.mode)
        ? profile.outputMode.mode
        : 'narrative',
      allowBullets: Boolean(profile.outputMode?.allowBullets),
      allowNumberedLists: Boolean(profile.outputMode?.allowNumberedLists),
      sentenceLength: ['short', 'medium', 'long'].includes(profile.outputMode?.sentenceLength)
        ? profile.outputMode.sentenceLength
        : 'medium',
      useTransitions: profile.outputMode?.useTransitions !== false, // Default true
    },
    
    generation: {
      allowLegacyFallback: profile.generation?.allowLegacyFallback !== false, // Default true
      repairTemperature: clamp(Number(profile.generation?.repairTemperature) || 0.15, 0, 0.5),
      maxRepairAttempts: clamp(Number(profile.generation?.maxRepairAttempts) || 1, 1, 3),
    },
    
    genreFlags: profile.genreFlags || undefined,
  };
  
  // Ensure beat labels match beat count
  while (sanitized.beatStructure.beatLabels.length < sanitized.beatStructure.beatCount) {
    sanitized.beatStructure.beatLabels.push(`BEAT_${sanitized.beatStructure.beatLabels.length + 1}`);
  }
  sanitized.beatStructure.beatLabels = sanitized.beatStructure.beatLabels.slice(0, sanitized.beatStructure.beatCount);
  
  return sanitized;
}

// =====================================================
// PROFILE SUMMARY (for logging)
// =====================================================

/**
 * Generate a concise summary of the story profile for logging
 */
export function profileToSummary(profile: StoryProfile): string {
  const parts: string[] = [];
  
  parts.push(`voice=${profile.voiceFormat.format}`);
  parts.push(`motif≥${profile.motif.minMentions}${profile.motif.shouldEscalate ? '↑' : ''}`);
  parts.push(`unique≥${profile.uniqueElement.minAppearances}${profile.uniqueElement.requireEscalation ? '↑' : ''}`);
  parts.push(`beats=${profile.beatStructure.beatCount}`);
  parts.push(`antiClosure=${(profile.ending.antiClosure * 100).toFixed(0)}%`);
  parts.push(`words=${profile.wordCount.target}±${profile.wordCount.variance}`);
  
  if (profile.voiceFormat.enforceMarkers) {
    parts.push(`markers=${profile.voiceFormat.structuralMarkers.length}`);
  }
  
  if (profile.embodiment.eraLevel !== 'name_only') {
    parts.push(`era=${profile.embodiment.eraLevel}`);
  }
  
  if (profile.ending.takeaway?.enabled) {
    parts.push(`takeaway=${profile.ending.takeaway.style}`);
  }
  
  return `[StoryProfile:${profile.profile_source || 'unknown'}] ${parts.join(', ')}`;
}

// =====================================================
// EXPORTS
// =====================================================

export {
  deepMerge,
};
