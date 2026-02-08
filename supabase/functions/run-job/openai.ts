// =====================================================
// OPENAI MODULE - Story Generation, Scene Analysis, Anchors
// VERSION: 5.5.0 - 2026-02-08 - Fixed NO/NOT cleanup, clean prompts
// =====================================================

import {
  LENGTH_CONFIG,
  VIBE_CONFIG,
  ART_STYLE_CONFIG,
  VISUAL_KEYWORDS,
  ORIENTATION_LOCK,
  FORBIDDEN_STYLE_TERMS,
  UNCANNY_ILLUSTRATED_BANNED_TOKENS,
  UNCANNY_ILLUSTRATED_STYLE_REPLACEMENT,
  UNCANNY_ILLUSTRATED_TEXTURE_REPLACEMENT,
  rewriteToContentOnly,
  type StoryAnchor,
  type VisualBeat,
  type SceneVisualContract,
  type StoryScene,
  type CharacterLock,
} from "./config.ts";

import { type ThemeGuidance } from "./stories.ts";
import { 
  type StoryDNA, 
  generateStoryDNA, 
  storeDNA, 
  buildPromptFromDNA,
  buildDNADisplaySummary,
  getRecentlyUsedConcepts,
  buildNegativeMemoryInjection,
} from "./story_dna.ts";

import {
  type VisualDNA,
  type Platform,
  deriveVisualDNA,
  storeVisualDNA,
  buildVisualStylePrompt,
  buildImagePromptWithVisualDNA,
  formatVisualDNADisplay,
} from "./visual_dna.ts";

import {
  resolveStoryProfile,
  sanitizeStoryProfile,
  getTemplateDefaults,
  getPresetProfile,
  profileToSummary as storyProfileToSummary,
  type StoryProfile,
  type PartialStoryProfile,
} from "./story_profile.ts";

import {
  buildStoryContract,
  checkCompliance,
  stripContractTags,
  processStoryOutput,
  complianceToLog,
  buildRepairPrompt,
  needsRepair,
  contractToSummary,
  convertDNAToContract,
  canonicalizeStory,
  truncateAtSentenceBoundary,
  truncatePreservingBeats,
  type StoryContract,
  type ComplianceResult,
  type CanonicalizationResult,
  type StoryDNA as ContractStoryDNA,
  type BeatPreservingTruncationResult,
} from "./story_contract.ts";

// =====================================================
// PROMPT HASH UTILITY (SHA-256 for ground-truth tracing)
// =====================================================
async function computePromptHash(prompt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(prompt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  // Return first 16 chars for readability
  return hashHex.substring(0, 16);
}

// Export for use in phases.ts
export { computePromptHash };

// =====================================================
// STORY GENERATION (Enhanced Viral System v2.0)
// =====================================================

// Visual environment descriptions for story context
const VISUAL_ENVIRONMENT_DESCRIPTIONS: Record<string, string> = {
  forest: "dark forest at night - fog, ancient trees, depth, shadows between branches",
  urban: "abandoned urban decay - empty streets, flickering lights, graffiti, broken windows",
  house: "haunted house interior - creaking floors, dusty furniture, long hallways, doors ajar",
  hospital: "abandoned hospital - sterile corridors, rusted equipment, flickering fluorescents",
  ocean: "deep dark ocean - endless water, unknown depths, isolation, creatures below",
  space: "cosmic void - stars, isolation, alien geometry, incomprehensible scale",
  hallway: "endless dark hallway - doors on both sides, something at the end, no escape",
  attic: "dusty attic space - old belongings, cobwebs, single light source, memories",
  foggy: "thick impenetrable fog - shapes in the mist, disorientation, sounds without source",
  rain: "dark rainy night - downpour, limited visibility, cold, wet, alone",
};

// Vibe-specific structure guidance
const VIBE_STRUCTURE_HINTS: Record<string, string> = {
  slow_creepy: "Build atmosphere gradually. Let wrongness creep in slowly. The horror should feel inevitable.",
  punchy_shock: "Quick setup, rapid escalation. Hit hard and fast. The twist should land like a punch.",
  atmospheric: "Prioritize mood over action. Let the environment be a character. Dread through description.",
  urban_legend: "Write as a factual documentary. Calm, serious tone. The horror comes from 'this really happened'.",
};

// Ending types for variety
const ENDING_TYPES = [
  "The narrator realizes they were never alone",
  "The 'safe' place was actually the threat",
  "What they thought was escape was a trap",
  "The familiar becomes horrifyingly unfamiliar",
  "They understand too late what the signs meant",
  "The horror was inside them all along",
  "The cycle is revealed to repeat",
  "The watcher becomes the watched",
  "The thing they feared was protecting them from something worse",
  "The monster was the only survivor",
  "Everyone except the narrator knows the truth",
  "The rescue was another layer of the nightmare",
  "The recording continues after they stopped filming",
  "The thing has always worn familiar faces",
  "The children remember what the adults forgot",
];

// OPENING STYLES for structural variety (randomly selected)
const OPENING_STYLES = [
  { style: "date_location", example: "In [month] of [year], in [specific place]..." },
  { style: "object_focus", example: "The old [object] had been in the family for generations..." },
  { style: "action_cold_open", example: "She was already running when she realized..." },
  { style: "dialogue_hook", example: "'Don't go in there,' the old man said..." },
  { style: "sensory_immersion", example: "The smell hit first. Then the sound..." },
  { style: "retrospective", example: "Looking back, the signs were always there..." },
  { style: "document_found", example: "The following was found in an abandoned..." },
  { style: "witness_account", example: "Multiple witnesses reported the same thing..." },
  { style: "routine_disrupted", example: "It started like any other [day/night]..." },
  { style: "discovery", example: "Nobody knows who first found the [thing]..." },
];

// NARRATIVE STRUCTURES for variety
const NARRATIVE_STRUCTURES = [
  "linear_escalation",     // Normal → weird → terrifying
  "false_resolution",     // Problem solved... no wait, it's worse
  "parallel_revelation",  // Two storylines converge horrifyingly  
  "countdown",            // Time pressure adds dread
  "investigation",        // Discovering pieces of the truth
  "infection_spread",     // The horror grows/spreads
  "isolation",            // Trapped and alone
  "perspective_shift",    // The truth was hidden by POV
];

/**
 * Generate a viral horror story using the enhanced prompt system
 */
export async function generateStory(
  openaiKey: string,
  vibePreset: string,
  lengthPreset: string,
  visualPreset?: string,
  artStyle?: string,
  themeGuidance?: ThemeGuidance
): Promise<{ title: string; story: string; hook: string }> {
  const config = LENGTH_CONFIG[lengthPreset as keyof typeof LENGTH_CONFIG];
  const vibe = VIBE_CONFIG[vibePreset as keyof typeof VIBE_CONFIG];
  const vibeHint = VIBE_STRUCTURE_HINTS[vibePreset] || VIBE_STRUCTURE_HINTS["slow_creepy"];
  const visualEnv = VISUAL_ENVIRONMENT_DESCRIPTIONS[visualPreset || "forest"] || VISUAL_ENVIRONMENT_DESCRIPTIONS["forest"];
  
  // Pick random structural elements for variety
  const selectedOpening = OPENING_STYLES[Math.floor(Math.random() * OPENING_STYLES.length)];
  const selectedStructure = NARRATIVE_STRUCTURES[Math.floor(Math.random() * NARRATIVE_STRUCTURES.length)];
  
  // Pick a random ending type for variety
  const endingHint = ENDING_TYPES[Math.floor(Math.random() * ENDING_TYPES.length)];

  console.log(`[STORY] Enhanced generation: ${lengthPreset}s, ${vibePreset}, ${visualPreset || 'forest'}`);
  console.log(`[STORY] Word range: ${config.minWords}-${config.maxWords}, ending hint: "${endingHint}"`);
  console.log(`[STORY] Structure: ${selectedStructure}, Opening: ${selectedOpening.style}`);
  console.log(`[STORY] Using ${vibePreset === "urban_legend" ? "URBAN LEGEND" : "STANDARD"} prompt`);
  if (themeGuidance) {
    console.log(`[STORY] Theme guidance: ${themeGuidance.bucket} / ${themeGuidance.suggestedTheme}`);
    console.log(`[STORY] Avoiding recent themes: ${themeGuidance.recentThemesAvoided.join(', ') || 'none'}`);
  }

  // Build theme guidance section if available
  const themeSection = themeGuidance ? `
═══════════════════════════════════════
🎯 THEME DIRECTION (REQUIRED FOR UNIQUENESS):
═══════════════════════════════════════
✅ FOCUS ON: ${themeGuidance.suggestedTheme}
✅ SETTING: ${themeGuidance.suggestedSetting}  
✅ INCLUDE: ${themeGuidance.suggestedElement}
${themeGuidance.recentThemesAvoided.length > 0 ? `
❌ DO NOT USE THESE (recently generated):
${themeGuidance.recentThemesAvoided.map(t => `   - ${t}`).join('\n')}
These themes were used in recent stories. Pick something DIFFERENT.` : ''}
` : '';

  // Use special prompt for Urban Legend style
  let prompt: string;
  let systemPrompt: string;
  
  if (vibePreset === "urban_legend") {
    console.log(`[STORY] ✓ Urban Legend mode ACTIVE - using faux true-crime prompt`);
    // URBAN LEGEND / FAUX TRUE-CRIME PROMPT - STRICT VERSION
    systemPrompt = "You are a viral horror writer specializing in 'true story' style urban legends. You write as if documenting real, suppressed historical events. CRITICAL: You MUST follow the exact structure provided. Always respond with valid JSON.";
    
    // Build theme section with specific decade
    const decades = ["late 1940s", "early 1950s", "mid-1950s", "late 1950s", "early 1960s", "mid-1960s", "late 1960s", "early 1970s", "mid-1970s", "late 1970s", "early 1980s", "late 1980s"];
    const randomDecade = decades[Math.floor(Math.random() * decades.length)];
    
    prompt = `You are writing a faux–true crime horror story. This MUST feel like a real suppressed historical event.

═══════════════════════════════════════
⚠️ MANDATORY STRUCTURE (FOLLOW EXACTLY):
═══════════════════════════════════════
1. OPENING: Start with "In the ${randomDecade}..." and name 2-3 specific US states/regions
2. EARLY REPORTS: Authorities dismiss initial sightings (use phrases like "local police dismissed" or "reports were filed but ignored")
3. PATTERN: The SAME disturbing detail appears across multiple locations (a figure, sound, or object)
4. ESCALATION: Sightings lead to disappearances
5. SUPPRESSION: Investigation closed, files lost, witnesses silenced
6. ENDING: Unresolved - end with a chilling image, NOT action

═══════════════════════════════════════
⚠️ REQUIRED ELEMENTS (MUST INCLUDE ALL):
═══════════════════════════════════════
✓ MUST start with "In the ${randomDecade}..."
✓ MUST mention 2-3 specific US states (e.g., "Oregon", "northern California", "Washington")
✓ MUST have authorities deny/ignore the events
✓ MUST have ONE repeating visual detail (same figure/sound/object in each location)
✓ MUST end unresolved with a haunting image
${themeSection}
═══════════════════════════════════════
TONE (CRITICAL):
═══════════════════════════════════════
- Documentary/factual voice - THIS REALLY HAPPENED
- Calm, serious narration throughout
- No first-person ("I") - use third person or passive voice
- Phrases like "reports indicated", "witnesses described", "according to records"

═══════════════════════════════════════
THREAT TYPE (Be creative within this):
═══════════════════════════════════════
- A figure (described the same way by different witnesses)
- A sound/signal (radio interference, music, voice)
- A phenomenon (specific type of fog, lights, time distortion)
- An object (appears in multiple places)

═══════════════════════════════════════
WORD COUNT (CRITICAL - Count carefully):
═══════════════════════════════════════
- MINIMUM: ${config.minWords} words
- MAXIMUM: ${config.maxWords} words

═══════════════════════════════════════
VISUAL ENVIRONMENT:
═══════════════════════════════════════
${visualEnv}

═══════════════════════════════════════
ENDING (Follow this direction):
═══════════════════════════════════════
"${endingHint}"
- The final line MUST be a chilling image/description
- NOT an action, NOT a revelation - just a haunting image that lingers

═══════════════════════════════════════
EXAMPLE STRUCTURE (for reference):
═══════════════════════════════════════
"In the late 1970s, reports began surfacing from rural highways in Oregon and northern California about [threat]. Authorities dismissed the sightings as [reason]. But over the next several years, similar reports appeared in Washington and Idaho, always describing the same detail: [specific repeating visual]. As sightings increased, so did reports of [escalation]. Local investigations were quietly closed, files later reported lost. To this day, [chilling unresolved image]."

Return ONLY valid JSON:
{
  "title": "Short mysterious title (3-5 words, no quotes)",
  "hook": "The opening claim starting with 'In the ${randomDecade}...'",
  "story": "The complete story including the hook"
}`;
  } else {
    // STANDARD HORROR PROMPT
    systemPrompt = "You are an expert viral horror story writer. You understand pacing, hooks, and what makes content shareable. Be CREATIVE - each story should feel unique and fresh. Always respond with valid JSON. Never include markdown or code blocks.";
    
    prompt = `You are a viral horror short-story writer for TikTok, Instagram Reels, and YouTube Shorts.

🎲 THIS STORY'S UNIQUE ANGLE (MUST USE):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Opening Style: ${selectedOpening.style} - "${selectedOpening.example}"
Narrative Structure: ${selectedStructure}
Ending Direction: "${endingHint}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${themeSection}
Write a scary story with these requirements:

═══════════════════════════════════════
STRUCTURE (follow general pacing):
═══════════════════════════════════════
1. HOOK (1-2 sentences): Use the opening style above. Create fear/curiosity.
2. SETUP (15-25 words): Establish setting and unease.
3. ESCALATION (50-70 words): Build tension using ${selectedStructure} structure.
4. REVEAL/TWIST (20-30 words): The horror crystallizes.
5. FINAL LINE: "${endingHint}"

═══════════════════════════════════════
STYLE REQUIREMENTS:
═══════════════════════════════════════
- Tone: ${vibe}
- Pacing hint: ${vibeHint}
- Present tense preferred
- Simple, punchy sentences
- First person POV ("I") for intimacy
- NO humor, NO explanations

═══════════════════════════════════════
WORD COUNT (CRITICAL):
═══════════════════════════════════════
- MINIMUM: ${config.minWords} words
- MAXIMUM: ${config.maxWords} words

═══════════════════════════════════════
VISUAL ENVIRONMENT:
═══════════════════════════════════════
${visualEnv}

═══════════════════════════════════════
CHARACTER RULES:
═══════════════════════════════════════
- No real person names
- Faceless or obscured antagonists work best
- Algorithm-safe (psychological horror, no extreme gore)

Return ONLY valid JSON:
{
  "title": "Short catchy title (3-5 words, no quotes in title)",
  "hook": "The attention-grabbing first line",
  "story": "The complete story including the hook"
}`;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      // Use lower temperature for urban legend (strict structure) vs higher for creative variety
      temperature: vibePreset === "urban_legend" ? 0.8 : 0.95,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[STORY] OpenAI error: ${response.status}`, errorText);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = JSON.parse(data.choices[0].message.content);
  
  // Log word count for debugging
  const wordCount = content.story?.split(/\s+/).length || 0;
  console.log(`[STORY] Generated: "${content.title}" (${wordCount} words)`);
  
  return content;
}

// =====================================================
// DNA-BASED STORY GENERATION (v4.0)
// The AI is a RENDERER - DNA defines uniqueness
// =====================================================

// =====================================================
// FALLBACK AUTOPSY TYPES (v2.1)
// =====================================================

/** Reason enum for why legacy fallback was triggered */
export type FallbackReason = 
  | "contract_exception"       // Exception during contract build or generation
  | "missing_beats"            // Beat tags missing after generation
  | "beat_tag_mismatch"        // Wrong number of beats
  | "word_count_out_of_range"  // Word count too high/low
  | "unique_element_below_min" // Unique element not mentioned enough
  | "grounding_missing_beats"  // Missing grounding in required beats
  | "motif_below_min"          // Motif not mentioned enough
  | "repair_failed"            // All repair attempts failed
  | "unknown";                 // Unknown error

/** Error details for contract failure */
export interface ContractError {
  message: string;
  stack?: string;
  stage: "build_contract" | "openai_generate" | "canonicalize" | "compliance" | "repair" | "truncate";
}

/** Single contract attempt record for tracking */
export interface ContractAttempt {
  stage: "initial" | "repair_1" | "repair_2" | "shorten" | "truncate";
  word_count: number;
  compliance_score?: number;
  hard_failures?: string[];
  had_tags: boolean;
}

/** Best contract attempt preserved for debugging even on fallback */
export interface BestContractAttempt {
  raw_with_tags: string;
  canonical_with_tags: string;
  stripped_for_tts: string;
  compliance: ComplianceResult | null;
  word_count: number;
  had_beat_tags: boolean;
  beat_count: number;
}

/**
 * DNA-Based Story Generation with StoryContract Enforcement (v2.1)
 * 
 * This is the NEW primary method for story generation with contract-based compliance.
 * Now includes full "fallback autopsy" when legacy fallback is triggered.
 * 
 * 1. Generate unique Story DNA (parameters)
 * 2. Derive Visual DNA from Story DNA (deterministic)
 * 3. Resolve and sanitize StoryProfile (system → template → preset → brand → user)
 * 4. Build StoryContract with beat tags and requirements
 * 5. Generate story with contract prompt
 * 6. Check compliance and repair if needed
 * 7. Fallback to legacy prompt if repair fails (with full autopsy)
 * 8. Store both DNAs for tracking
 * 
 * @param genre - Genre profile to use (urban_legend, cosmic_horror, true_crime, analog_horror, neutral)
 * @param platform - Target platform for Visual DNA tuning (reels, tiktok, shorts, default)
 * @param storyOptions - Optional story_mode, story_profile, niche overrides
 */
export interface StoryGenerationOptions {
  story_mode?: "auto" | "custom";
  story_profile?: PartialStoryProfile;
  niche?: string;  // For template selection (horror, food, finance, etc.)
  vibe_preset?: string;  // For preset selection
}

export interface StoryGenerationResult {
  title: string;
  story: string;           // Final stripped text for TTS
  raw_story: string;       // Original with beat tags (if contract used)
  hook: string;
  dna: StoryDNA;
  visual_dna: VisualDNA;
  dna_display: string;
  visual_dna_display: string;
  // Contract system outputs
  story_profile: StoryProfile;
  compliance: ComplianceResult | null;
  contract_summary: string;
  generation_method: "contract" | "contract_repaired" | "legacy_fallback";
  // Pipeline metadata
  canonicalization?: {
    changed: boolean;
    notes: string[];
  };
  truncation?: {
    truncated: boolean;
    originalWordCount: number;
    finalWordCount: number;
    notes?: string[];
  };
  // v2.0: Enhanced debug fields
  word_range?: {
    min: number;
    max: number;
    target: number;
    variance: number;
  };
  word_count_check?: {
    in_range: boolean;
    actual: number;
    reason: string;
  };
  repair_reasons?: string[];
  post_fixes_applied?: string[];
  final_source_text?: "contract" | "repaired" | "truncated" | "legacy";
  // v2.1: Fallback Autopsy fields
  fallback_reason?: FallbackReason;
  contract_error?: ContractError;
  contract_attempts?: ContractAttempt[];
  best_contract_attempt?: BestContractAttempt;
}

// Helper to convert numbers to words for clearer prompts
function numberToWord(n: number): string {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  return n >= 0 && n < words.length ? words[n] : String(n);
}

export async function generateStoryWithDNA(
  supabase: any,
  openaiKey: string,
  lengthPreset: string,
  visualPreset?: string,
  genre?: string,
  platform?: string,
  jobId?: string,
  storyOptions?: StoryGenerationOptions
): Promise<StoryGenerationResult> {
  const effectiveGenre = genre || 'urban_legend';
  const effectivePlatform = platform || 'default';
  const storyMode = storyOptions?.story_mode || 'auto';
  const niche = storyOptions?.niche || 'horror';  // Default to horror for backward compat
  const vibePreset = storyOptions?.vibe_preset || effectiveGenre;
  
  console.log(`[STORY-CONTRACT] Starting contract-based story generation`);
  console.log(`[STORY-CONTRACT]   genre=${effectiveGenre}, niche=${niche}, vibe=${vibePreset}`);
  console.log(`[STORY-CONTRACT]   story_mode=${storyMode}`);
  
  const config = LENGTH_CONFIG[lengthPreset as keyof typeof LENGTH_CONFIG] || LENGTH_CONFIG["60"];
  const visualEnv = VISUAL_ENVIRONMENT_DESCRIPTIONS[visualPreset || "forest"] || VISUAL_ENVIRONMENT_DESCRIPTIONS["forest"];
  
  // =====================================================
  // Step 1: Generate unique Story DNA with genre profile
  // =====================================================
  console.log(`[STORY-DNA] Generating unique Story DNA...`);
  const dna = await generateStoryDNA(supabase, effectiveGenre, 10);
  
  console.log(`[STORY-DNA] Story DNA generated:`);
  console.log(`[STORY-DNA]   Genre: ${dna.genre}`);
  console.log(`[STORY-DNA]   Era: ${dna.era.label}`);
  console.log(`[STORY-DNA]   Location: ${dna.location.label} (${dna.specific_states.join(', ')})`);
  console.log(`[STORY-DNA]   Threat: ${dna.threat_behavior.label} + ${dna.threat_manifestation.label}`);
  console.log(`[STORY-DNA]   Weird Axis: ${dna.weird_axis.id}`);
  console.log(`[STORY-DNA]   Concept Hash: ${dna.concept_hash}`);
  
  // =====================================================
  // Step 2: Derive Visual DNA from Story DNA (DETERMINISTIC)
  // =====================================================
  console.log(`[VISUAL-DNA] Deriving Visual DNA from Story DNA...`);
  const targetPlatform = effectivePlatform as Platform;
  const visualDNA = deriveVisualDNA(dna, targetPlatform);
  
  console.log(`[VISUAL-DNA] Visual DNA derived:`);
  console.log(`[VISUAL-DNA]   Style: ${visualDNA.visual_style}`);
  console.log(`[VISUAL-DNA]   Palette: ${visualDNA.color_palette}`);
  console.log(`[VISUAL-DNA]   Camera: ${visualDNA.camera_language}`);
  console.log(`[VISUAL-DNA]   Lighting: ${visualDNA.lighting_profile}`);
  
  // =====================================================
  // Step 3: Resolve and sanitize StoryProfile
  // Merge order: SYSTEM → TEMPLATE → PRESET → BRAND → USER
  // =====================================================
  const presetProfile = getPresetProfile(vibePreset);
  console.log(`[STORY-PROFILE] vibePreset=${vibePreset}, presetProfile found=${!!presetProfile}`);
  if (presetProfile) {
    console.log(`[STORY-PROFILE] preset.genreFlags=${JSON.stringify(presetProfile.genreFlags)}`);
  }
  
  const resolvedProfile = resolveStoryProfile({
    // System defaults are built-in
    template: getTemplateDefaults(niche),
    preset: presetProfile,
    // Brand-level would come from brand.settings.storyProfile (future)
    user: storyMode === 'custom' ? storyOptions?.story_profile : undefined,
  });
  console.log(`[STORY-PROFILE] resolved.genreFlags=${JSON.stringify(resolvedProfile.genreFlags)}`);
  
  const storyProfile = sanitizeStoryProfile(resolvedProfile);
  console.log(`[STORY-PROFILE] sanitized.genreFlags=${JSON.stringify(storyProfile.genreFlags)}`);
  
  console.log(`[STORY-PROFILE] ${storyProfileToSummary(storyProfile)}`);
  
  // =====================================================
  // Step 4: Build StoryContract with beat tags
  // =====================================================
  const contractDna = convertDNAToContract(dna);
  const contract = buildStoryContract(contractDna, storyProfile);
  const contractSummary = contractToSummary(contract);
  
  console.log(`[STORY-CONTRACT] Contract built: ${contractSummary}`);
  console.log(`[STORY-CONTRACT]   beats=${contract.expectedBeats.join(', ')}`);
  console.log(`[STORY-CONTRACT]   motifMin=${contract.requiredMotifMentions}, finalImage=${contract.requiresFinalImage}`);
  
  // =====================================================
  // Step 5: Generate story with contract prompt
  // =====================================================
  let rawStory: string;
  let compliance: ComplianceResult | null = null;
  let generationMethod: "contract" | "contract_repaired" | "legacy_fallback" = "contract";
  let title: string = "";
  let hook: string = "";
  let canonicalization: { changed: boolean; notes: string[] } | undefined;
  let truncation: { truncated: boolean; originalWordCount: number; finalWordCount: number; notes?: string[] } | undefined;
  
  // v2.0: Enhanced tracking
  let repairReasons: string[] = [];
  let postFixesApplied: string[] = [];
  let finalSourceText: "contract" | "repaired" | "truncated" | "legacy" = "contract";
  let wordRange: { min: number; max: number; target: number; variance: number } | undefined;
  let wordCountCheck: { in_range: boolean; actual: number; reason: string } | undefined;
  
  // v2.1: Fallback autopsy tracking
  let fallbackReason: FallbackReason | undefined;
  let contractError: ContractError | undefined;
  const contractAttempts: ContractAttempt[] = [];
  let bestContractAttempt: BestContractAttempt | undefined;
  
  // Helper to check if story has beat tags
  const countBeatTags = (text: string): number => {
    const matches = text.match(/\[\s*BEAT_\d+\s*:\s*[^\]]+\s*\]/g);
    return matches?.length || 0;
  };
  
  // Helper to preserve best attempt (highest compliance score, or most beat tags)
  const preserveBestAttempt = (
    rawText: string, 
    complianceResult: ComplianceResult | null, 
    stage: string
  ) => {
    const beatCount = countBeatTags(rawText);
    const wc = rawText.split(/\s+/).filter(w => w.length > 0).length;
    const score = complianceResult?.score ?? 0;
    
    // Keep if: no best yet, OR higher score, OR same score + more beats
    if (!bestContractAttempt || 
        score > (bestContractAttempt.compliance?.score ?? 0) ||
        (score === (bestContractAttempt.compliance?.score ?? 0) && beatCount > bestContractAttempt.beat_count)) {
      bestContractAttempt = {
        raw_with_tags: rawText,
        canonical_with_tags: rawText, // Will be updated after canonicalization
        stripped_for_tts: stripContractTags(rawText),
        compliance: complianceResult,
        word_count: wc,
        had_beat_tags: beatCount > 0,
        beat_count: beatCount,
      };
      console.log(`[STORY-CONTRACT] Best attempt updated at ${stage}: score=${score}, beats=${beatCount}`);
    }
  };
  
  // Get negative memory injection
  const recentConcepts = await getRecentlyUsedConcepts(supabase, 7, 10);
  const negativeMemory = buildNegativeMemoryInjection(recentConcepts);
  
  // Build the full contract prompt
  const contractPrompt = negativeMemory 
    ? contract.prompt + '\n' + negativeMemory 
    : contract.prompt;
  
  // System prompt for contract-based generation
  // Check for counting horror special case
  const countingHorror = (dna as any).counting_horror;
  let numberRule = '';
  if (countingHorror) {
    console.log(`[STORY-CONTRACT] COUNTING HORROR detected: start=${countingHorror.start_count}, wrong=${countingHorror.wrong_count}`);
    const correctWord = numberToWord(countingHorror.start_count);
    const wrongWord = numberToWord(countingHorror.wrong_count);
    numberRule = `
7. COUNTING HORROR - MANDATORY NUMBERS:
   - The group STARTS with exactly ${countingHorror.start_count} (${correctWord}) people
   - The WRONG count is always ${countingHorror.wrong_count} (${wrongWord}) people
   
   Example phrasing you MUST use:
   - "There were ${correctWord} of us" (correct count)
   - "The count showed ${wrongWord}" (wrong count)
   - "${wrongWord} people—one more than there should be" (final proof)
   
   DO NOT use ${countingHorror.start_count - 1} or ${countingHorror.wrong_count - 1} or any other numbers.
   The ONLY two numbers for group size in this story are ${countingHorror.start_count} and ${countingHorror.wrong_count}.`;
    console.log(`[STORY-CONTRACT] Number rule added to system prompt`);
  }
  
  const contractSystemPrompt = `You are a master storyteller. Your task is to write a story that EXACTLY follows the contract specifications.

CRITICAL RULES:
1. You MUST include all beat tags exactly as specified: [BEAT_N:LABEL]
2. You MUST include the motif at least ${contract.requiredMotifMentions} times
3. You MUST include the final image in the last beat${contract.requiresFinalImage ? ' (REQUIRED)' : ''}
4. You MUST stay within the word count range
5. Do NOT add commentary or explanations
6. Do NOT use markdown formatting${numberRule}

Return ONLY valid JSON with this structure:
{
  "title": "Story title",
  "story": "Full story with [BEAT_N:LABEL] tags",
  "hook": "Opening hook (1-2 sentences)"
}`;
  
  console.log(`[STORY-CONTRACT] Calling OpenAI with contract prompt...`);
  
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: contractSystemPrompt },
          { role: "user", content: contractPrompt },
        ],
        temperature: 0.7,  // Slightly lower for contract adherence
        response_format: { type: "json_object" },
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[STORY-CONTRACT] OpenAI error: ${response.status}`, errorText);
      contractError = {
        message: `OpenAI API error: ${response.status}`,
        stage: "openai_generate",
      };
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    
    const data = await response.json();
    const content = JSON.parse(data.choices[0].message.content);
    
    rawStory = content.story || "";
    title = content.title || "Untitled";
    hook = content.hook || "";
    
    const wordCount = rawStory.split(/\s+/).filter(w => w.length > 0).length;
    console.log(`[STORY-CONTRACT] Generated: "${title}" (${wordCount} words)`);
    
    // Track initial attempt
    contractAttempts.push({
      stage: "initial",
      word_count: wordCount,
      had_tags: countBeatTags(rawStory) > 0,
    });
    
    // =====================================================
    // Step 6: Canonicalize beat tags before compliance check
    // =====================================================
    const canonResult = canonicalizeStory(rawStory, contract.expectedBeats);
    if (canonResult.changed) {
      console.log(`[STORY-CONTRACT] Canonicalized: ${canonResult.notes.join(', ')}`);
      rawStory = canonResult.text;
    }
    canonicalization = {
      changed: canonResult.changed,
      notes: canonResult.notes,
    };
    
    // =====================================================
    // Step 7: COMPLIANCE & WORD COUNT ENFORCEMENT (v2.1)
    // Deterministic pipeline: repair → truncate → shortening repair
    // =====================================================
    compliance = checkCompliance(rawStory, contract);
    if (canonResult.changed) {
      compliance.canonicalized = true;
      compliance.canonicalizationNotes = canonResult.notes;
    }
    console.log(`[STORY-CONTRACT] Compliance: ${complianceToLog(compliance)}`);
    
    // Update initial attempt with compliance
    if (contractAttempts.length > 0) {
      contractAttempts[contractAttempts.length - 1].compliance_score = compliance.score;
      contractAttempts[contractAttempts.length - 1].hard_failures = compliance.hardFailures;
    }
    
    // Preserve best attempt (initial)
    preserveBestAttempt(rawStory, compliance, "initial");
    // Update canonical in best attempt after canonicalization
    if (bestContractAttempt && canonResult.changed) {
      bestContractAttempt.canonical_with_tags = rawStory;
      bestContractAttempt.stripped_for_tts = stripContractTags(rawStory);
    }
    
    // Build word range info (assign to outer scope variable)
    wordRange = {
      min: contract.wordRange.min,
      max: contract.wordRange.max,
      target: storyProfile.wordCount.target,
      variance: storyProfile.wordCount.variance,
    };
    
    // =====================================================
    // Phase 1: Check if repair is needed
    // =====================================================
    const maxRepairAttempts = storyProfile.generation?.maxRepairAttempts ?? 1;
    let repairAttempts = 0;
    
    // Collect repair reasons from hard failures
    for (const failure of compliance.hardFailures) {
      if (failure.startsWith('word_count_out_of_range')) {
        repairReasons.push('word_count_out_of_range');
      } else if (failure.startsWith('grounding_missing_beats')) {
        repairReasons.push('grounding_missing_beats');
      } else if (failure.startsWith('unique_element_below_min')) {
        repairReasons.push('unique_element_below_min');
      } else if (failure.startsWith('motif_below_min')) {
        repairReasons.push('motif_below_min');
      } else {
        repairReasons.push(failure.split(':')[0]);
      }
    }
    
    // Check if repair is needed
    if (needsRepair(compliance, 70)) {
      console.log(`[STORY-CONTRACT] ⚠️ Repair needed - score=${compliance.score}, reasons=[${repairReasons.join(',')}]`);
      
      // Try repair pass(es) with profile-defined temperature
      const repairTemp = storyProfile.generation?.repairTemperature ?? 0.15;
      
      while (repairAttempts < maxRepairAttempts) {
        repairAttempts++;
        console.log(`[STORY-CONTRACT] Repair attempt ${repairAttempts}/${maxRepairAttempts}...`);
        
        const repairResult = await attemptStoryRepair(
          openaiKey,
          rawStory,
          contract,
          compliance,
          repairTemp
        );
        
        // Track repair attempt
        const repairWc = repairResult.story.split(/\s+/).filter(w => w.length > 0).length;
        contractAttempts.push({
          stage: `repair_${repairAttempts}` as ContractAttempt["stage"],
          word_count: repairWc,
          compliance_score: repairResult.compliance.score,
          hard_failures: repairResult.compliance.hardFailures,
          had_tags: countBeatTags(repairResult.story) > 0,
        });
        
        if (repairResult.success) {
          rawStory = repairResult.story;
          compliance = repairResult.compliance;
          generationMethod = "contract_repaired";
          finalSourceText = "repaired";
          postFixesApplied.push(`repair_pass_${repairAttempts}`);
          preserveBestAttempt(rawStory, compliance, `repair_${repairAttempts}`);
          console.log(`[STORY-CONTRACT] ✅ Repair ${repairAttempts} successful: ${complianceToLog(compliance)}`);
          break;
        } else {
          console.log(`[STORY-CONTRACT] ⚠️ Repair ${repairAttempts} did not fully resolve issues`);
          postFixesApplied.push(`repair_pass_${repairAttempts}_partial`);
          // Still preserve if better than what we had
          preserveBestAttempt(repairResult.story, repairResult.compliance, `repair_${repairAttempts}_partial`);
        }
      }
    } else {
      console.log(`[STORY-CONTRACT] ✅ Compliance passed on first attempt`);
    }
    
    // =====================================================
    // Phase 2: Enforce word count with truncation if needed
    // This happens AFTER repair, regardless of repair success
    // =====================================================
    const currentWordCount = rawStory.split(/\s+/).filter(w => w.length > 0).length;
    const wordCountInRange = currentWordCount >= contract.wordRange.min && currentWordCount <= contract.wordRange.max;
    
    if (!wordCountInRange && storyProfile.wordCount.strictEnforcement) {
      console.log(`[STORY-CONTRACT] Word count ${currentWordCount} out of range [${contract.wordRange.min}-${contract.wordRange.max}]`);
      
      if (currentWordCount > contract.wordRange.max) {
        // Need to truncate
        console.log(`[STORY-CONTRACT] Attempting beat-preserving truncation...`);
        
        const truncResult = truncatePreservingBeats(
          rawStory,
          contract.wordRange.max,
          contract.expectedBeats,
          storyProfile.ending.enforceFinalImage
        );
        
        if (truncResult.needsRepairInstead) {
          // Truncation would corrupt structure - try shortening repair
          console.log(`[STORY-CONTRACT] Truncation would corrupt structure, trying shortening repair...`);
          
          const shortenRepairResult = await attemptShorteningRepair(
            openaiKey,
            rawStory,
            contract,
            contract.wordRange.max
          );
          
          if (shortenRepairResult.success) {
            rawStory = shortenRepairResult.story;
            truncation = {
              truncated: true,
              originalWordCount: currentWordCount,
              finalWordCount: shortenRepairResult.story.split(/\s+/).filter(w => w.length > 0).length,
              notes: ['shortening_repair'],
            };
            postFixesApplied.push('shortening_repair');
            finalSourceText = "repaired";
            console.log(`[STORY-CONTRACT] ✅ Shortening repair successful`);
          } else {
            // Last resort: simple truncation at sentence boundary
            console.log(`[STORY-CONTRACT] ⚠️ Shortening repair failed, using simple truncation`);
            const simpleResult = truncateAtSentenceBoundary(rawStory, contract.wordRange.max);
            rawStory = simpleResult.text;
            truncation = {
              truncated: true,
              originalWordCount: simpleResult.originalWordCount,
              finalWordCount: simpleResult.finalWordCount,
              notes: ['simple_truncation_fallback'],
            };
            postFixesApplied.push('truncation_sentence_boundary');
            finalSourceText = "truncated";
          }
        } else if (truncResult.truncated) {
          rawStory = truncResult.text;
          truncation = {
            truncated: true,
            originalWordCount: truncResult.originalWordCount,
            finalWordCount: truncResult.finalWordCount,
            notes: truncResult.notes,
          };
          postFixesApplied.push('truncation_beat_preserving');
          finalSourceText = "truncated";
          console.log(`[STORY-CONTRACT] Truncated: ${truncResult.originalWordCount} → ${truncResult.finalWordCount} words (beats preserved: ${truncResult.beatsPreserved})`);
        } else {
          // Truncation didn't happen but should have - log error
          console.log(`[STORY-CONTRACT] ⚠️ Truncation returned unchanged despite word count over max`);
          truncation = {
            truncated: false,
            originalWordCount: currentWordCount,
            finalWordCount: currentWordCount,
            notes: ['truncation_failed_unexpectedly'],
          };
        }
      } else {
        // Word count too low - can't fix with truncation, log warning
        console.log(`[STORY-CONTRACT] ⚠️ Word count too low (${currentWordCount} < ${contract.wordRange.min}), cannot fix with truncation`);
        repairReasons.push('word_count_too_low_unfixable');
      }
    }
    
    // ALWAYS re-check compliance after any truncation attempt
    // This ensures compliance reflects the current state
    compliance = checkCompliance(rawStory, contract);
    console.log(`[STORY-CONTRACT] Post-enforcement compliance: ${complianceToLog(compliance)}`);
    
    // Double-check word count enforcement succeeded
    const postEnforcementWc = rawStory.split(/\s+/).filter(w => w.length > 0).length;
    if (storyProfile.wordCount.strictEnforcement && postEnforcementWc > contract.wordRange.max) {
      console.log(`[STORY-CONTRACT] ⚠️ Word count still over max after enforcement: ${postEnforcementWc} > ${contract.wordRange.max}`);
      // Ensure hard failure is set
      if (!compliance.hardFailures.some(f => f.startsWith('word_count_out_of_range'))) {
        compliance.hardFailures.push(`word_count_out_of_range:${postEnforcementWc}>${contract.wordRange.max}`);
        compliance.passed = false;
      }
    }
    
    // =====================================================
    // Phase 3: Legacy fallback if still failing
    // =====================================================
    const allowFallback = storyProfile.generation?.allowLegacyFallback ?? true;
    
    // Preserve final state as best attempt before potential fallback
    preserveBestAttempt(rawStory, compliance, "final_before_fallback");
    
    if (compliance && compliance.hardFailures.length > 0 && allowFallback) {
      console.log(`[STORY-CONTRACT] Still has hard failures after repair/truncation, using legacy fallback...`);
      
      // Determine primary fallback reason from hard failures
      fallbackReason = determineFallbackReason(compliance.hardFailures);
      console.log(`[STORY-CONTRACT] Fallback reason: ${fallbackReason}`);
      
      const legacyResult = await generateStoryWithLegacyPrompt(
        openaiKey,
        dna,
        config,
        visualEnv,
        negativeMemory
      );
      
      rawStory = legacyResult.story;
      title = legacyResult.title;
      hook = legacyResult.hook;
      // Note: Keep compliance as-is to preserve the last contract compliance for debugging
      // We'll set a separate field for whether we used legacy
      generationMethod = "legacy_fallback";
      finalSourceText = "legacy";
      postFixesApplied.push('legacy_fallback');
      
      console.log(`[STORY-CONTRACT] Legacy fallback generated: "${title}"`);
    } else if (compliance && compliance.hardFailures.length > 0 && !allowFallback) {
      // Strict mode: Don't use legacy fallback, return best contract attempt with failures
      console.log(`[STORY-CONTRACT] ⚠️ Hard failures exist but legacy fallback disabled - returning best attempt`);
      fallbackReason = determineFallbackReason(compliance.hardFailures);
      
      // Use best contract attempt if available
      if (bestContractAttempt && bestContractAttempt.had_beat_tags) {
        console.log(`[STORY-CONTRACT] Using best contract attempt with beat tags for output`);
        rawStory = bestContractAttempt.raw_with_tags;
      }
      // Keep generationMethod as contract/contract_repaired to indicate we didn't fall back
    }
    
    // Build word count check result (assign to outer scope variable)
    const finalWc = rawStory.split(/\s+/).filter(w => w.length > 0).length;
    wordCountCheck = {
      in_range: finalWc >= contract.wordRange.min && finalWc <= contract.wordRange.max,
      actual: finalWc,
      reason: finalWc < contract.wordRange.min 
        ? `below_min:${finalWc}<${contract.wordRange.min}`
        : finalWc > contract.wordRange.max
          ? `above_max:${finalWc}>${contract.wordRange.max}`
          : 'in_range',
    };
    
  } catch (error) {
    console.error(`[STORY-CONTRACT] Contract generation failed:`, error);
    
    // Capture error details for autopsy
    if (!contractError) {
      contractError = {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        stage: "openai_generate", // Default stage if not set earlier
      };
    }
    fallbackReason = "contract_exception";
    
    // Check if legacy fallback is allowed
    const allowFallback = storyProfile.generation?.allowLegacyFallback ?? true;
    
    if (allowFallback) {
      console.log(`[STORY-CONTRACT] Falling back to legacy generation...`);
      
      // Fallback to legacy on any error
      const legacyResult = await generateStoryWithLegacyPrompt(
        openaiKey,
        dna,
        config,
        visualEnv,
        negativeMemory
      );
      
      rawStory = legacyResult.story;
      title = legacyResult.title;
      hook = legacyResult.hook;
      // Keep compliance preserved from best attempt for debugging
      generationMethod = "legacy_fallback";
      finalSourceText = "legacy";
    } else {
      console.error(`[STORY-CONTRACT] ❌ Contract failed and legacy fallback disabled - throwing error`);
      throw new Error(`Story contract generation failed: ${error}`);
    }
  }
  
  // =====================================================
  // Step 8: Strip tags for final output
  // =====================================================
  const finalStory = generationMethod !== "legacy_fallback" 
    ? stripContractTags(rawStory)
    : rawStory;
  
  // =====================================================
  // Step 9: TELEMETRY LOGGING
  // Log generation method, compliance, canonicalization, truncation
  // =====================================================
  const telemetry = {
    generation_method: generationMethod,
    compliance_score: compliance?.score ?? null,
    compliance_passed: compliance?.passed ?? null,
    hard_failures: compliance?.hardFailures ?? [],
    preset: vibePreset,
    niche: niche,
    profile_source: storyProfile.profile_source,
    output_mode: storyProfile.outputMode?.mode ?? 'narrative',
    allow_legacy_fallback: storyProfile.generation?.allowLegacyFallback ?? true,
    canonicalized: canonicalization?.changed ?? false,
    canonicalization_notes: canonicalization?.notes ?? [],
    truncated: truncation?.truncated ?? false,
    truncation_original_words: truncation?.originalWordCount ?? null,
    truncation_final_words: truncation?.finalWordCount ?? null,
  };
  console.log(`[TELEMETRY] ${JSON.stringify(telemetry)}`);
  
  // =====================================================
  // Step 10: Store both DNAs for tracking
  // =====================================================
  try {
    await storeDNA(supabase, dna, undefined, jobId);
    console.log(`[STORY-DNA] Story DNA stored successfully`);
  } catch (e) {
    console.error(`[STORY-DNA] Failed to store Story DNA:`, e);
  }
  
  try {
    await storeVisualDNA(supabase, visualDNA);
    console.log(`[VISUAL-DNA] Visual DNA stored successfully`);
  } catch (e) {
    console.error(`[VISUAL-DNA] Failed to store Visual DNA:`, e);
  }
  
  // Build display summaries for UI
  const dnaDisplay = buildDNADisplaySummary(dna);
  const visualDNADisplay = formatVisualDNADisplay(visualDNA);
  
  console.log(`[STORY-CONTRACT] Generation complete: method=${generationMethod}${fallbackReason ? `, fallback_reason=${fallbackReason}` : ''}`);
  
  return {
    title,
    story: finalStory,
    raw_story: rawStory,
    hook,
    dna,
    visual_dna: visualDNA,
    dna_display: dnaDisplay,
    visual_dna_display: visualDNADisplay,
    story_profile: storyProfile,
    compliance,
    contract_summary: contractSummary,
    generation_method: generationMethod,
    canonicalization,
    truncation,
    // v2.0: Enhanced debug fields
    word_range: wordRange,
    word_count_check: wordCountCheck,
    repair_reasons: repairReasons,
    post_fixes_applied: postFixesApplied,
    final_source_text: finalSourceText,
    // v2.1: Fallback autopsy fields
    fallback_reason: fallbackReason,
    contract_error: contractError,
    contract_attempts: contractAttempts.length > 0 ? contractAttempts : undefined,
    best_contract_attempt: bestContractAttempt,
  };
}

/**
 * Determine the primary fallback reason from hard failures
 */
function determineFallbackReason(hardFailures: string[]): FallbackReason {
  if (!hardFailures || hardFailures.length === 0) {
    return "unknown";
  }
  
  // Check each failure type in priority order
  for (const failure of hardFailures) {
    if (failure.startsWith('beat_count_mismatch') || failure.includes('missing_beats')) {
      return "missing_beats";
    }
    if (failure.startsWith('beat_tag_mismatch')) {
      return "beat_tag_mismatch";
    }
    if (failure.startsWith('word_count_out_of_range')) {
      return "word_count_out_of_range";
    }
    if (failure.startsWith('unique_element_below_min')) {
      return "unique_element_below_min";
    }
    if (failure.startsWith('grounding_missing_beats')) {
      return "grounding_missing_beats";
    }
    if (failure.startsWith('motif_below_min')) {
      return "motif_below_min";
    }
  }
  
  // If we went through repair but still have failures
  return "repair_failed";
}

/**
 * Attempt to repair a story that failed compliance
 * Uses very low temperature for deterministic repairs
 */
async function attemptStoryRepair(
  openaiKey: string,
  rawStory: string,
  contract: StoryContract,
  compliance: ComplianceResult,
  repairTemperature: number = 0.15
): Promise<{ success: boolean; story: string; compliance: ComplianceResult }> {
  console.log(`[STORY-REPAIR] Attempting repair pass (temp=${repairTemperature})...`);
  
  const repairPrompt = buildRepairPrompt(rawStory, contract, compliance);
  
  // System prompt with repeated beat tag rules for determinism
  const repairSystemPrompt = `You are a precise story editor. Your ONLY task is to fix the compliance issues.

=== CRITICAL RULES (READ CAREFULLY) ===

⚠️ DO NOT add, remove, or rename ANY beat tags. ⚠️
⚠️ DO NOT change the order of beat tags. ⚠️

Your job is ONLY to:
1. Edit text INSIDE existing beats
2. Fix the specific compliance issues listed
3. Return the full story with ALL beat tags intact

UNIQUE ELEMENT RECURRENCE:
- If unique element needs more mentions: add them naturally
- Second mention MUST ESCALATE (worse, more specific, new implication)
- Do NOT just repeat the same phrase - show PROGRESSION

FORBIDDEN ACTIONS:
- Adding new [BEAT_X:...] tags
- Removing existing beat tags  
- Renaming beat labels (e.g., changing OPENING to INTRO)
- Reordering beats
- Adding commentary or explanations
- Using markdown formatting

Return ONLY the repaired story text, no JSON.`;
  
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: repairSystemPrompt },
          { role: "user", content: repairPrompt },
        ],
        temperature: repairTemperature,  // Very low for deterministic repair (0.1-0.2)
        top_p: 0.9,  // Slightly constrained nucleus sampling
      }),
    });
    
    if (!response.ok) {
      console.error(`[STORY-REPAIR] OpenAI error: ${response.status}`);
      return { success: false, story: rawStory, compliance };
    }
    
    const data = await response.json();
    const repairedStory = data.choices[0].message.content.trim();
    
    // Re-check compliance
    const newCompliance = checkCompliance(repairedStory, contract);
    console.log(`[STORY-REPAIR] After repair: ${complianceToLog(newCompliance)}`);
    
    // Consider repair successful if score improved and no hard failures
    const success = newCompliance.score >= 70 && newCompliance.hardFailures.length === 0;
    
    return {
      success,
      story: success ? repairedStory : rawStory,
      compliance: success ? newCompliance : compliance,
    };
    
  } catch (error) {
    console.error(`[STORY-REPAIR] Repair failed:`, error);
    return { success: false, story: rawStory, compliance };
  }
}

/**
 * Attempt to shorten a story to fit within word limit
 * Uses explicit instruction to compress while preserving beat tags
 * This is a second repair pass specifically for word count
 */
async function attemptShorteningRepair(
  openaiKey: string,
  rawStory: string,
  contract: StoryContract,
  maxWords: number
): Promise<{ success: boolean; story: string }> {
  const currentWordCount = rawStory.split(/\s+/).filter(w => w.length > 0).length;
  console.log(`[STORY-SHORTEN] Attempting to shorten from ${currentWordCount} to ≤${maxWords} words...`);
  
  const shortenPrompt = `=== STORY SHORTENING REQUEST ===

The following story is ${currentWordCount} words but MUST be ≤${maxWords} words.

CRITICAL RULES:
1. ⚠️ DO NOT add, remove, or rename ANY beat tags. ⚠️
2. ⚠️ Keep ALL beat tags EXACTLY as they appear: ${contract.expectedBeats.join(', ')}
3. Compress text WITHIN each beat (not across beats)
4. Remove filler words, redundant phrases, unnecessary adjectives
5. Keep essential story elements and narrative flow
6. The final beat MUST remain intact and meaningful

Target: Reduce to ${maxWords} words or fewer while keeping all beat tags.

=== ORIGINAL STORY ===

${rawStory}

=== OUTPUT ===

Return ONLY the shortened story with all beat tags preserved:`;

  const systemPrompt = `You are a precise text editor. Shorten the story to fit the word limit WITHOUT changing beat tags. Beat tags look like [BEAT_N:LABEL] and MUST remain exactly as they appear.`;
  
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: shortenPrompt },
        ],
        temperature: 0.1,  // Very low for deterministic shortening
        top_p: 0.9,
      }),
    });
    
    if (!response.ok) {
      console.error(`[STORY-SHORTEN] OpenAI error: ${response.status}`);
      return { success: false, story: rawStory };
    }
    
    const data = await response.json();
    const shortenedStory = data.choices[0].message.content.trim();
    
    // Verify word count and beat preservation
    const newWordCount = shortenedStory.split(/\s+/).filter((w: string) => w.length > 0).length;
    const beatsPreserved = contract.expectedBeats.every(tag => shortenedStory.includes(tag));
    
    console.log(`[STORY-SHORTEN] Result: ${newWordCount} words, beats preserved: ${beatsPreserved}`);
    
    const success = newWordCount <= maxWords && beatsPreserved;
    
    return {
      success,
      story: success ? shortenedStory : rawStory,
    };
    
  } catch (error) {
    console.error(`[STORY-SHORTEN] Shortening failed:`, error);
    return { success: false, story: rawStory };
  }
}

/**
 * Legacy prompt generation (fallback when contract fails)
 */
async function generateStoryWithLegacyPrompt(
  openaiKey: string,
  dna: StoryDNA,
  config: typeof LENGTH_CONFIG[keyof typeof LENGTH_CONFIG],
  visualEnv: string,
  negativeMemory: string | null
): Promise<{ title: string; story: string; hook: string }> {
  // Use the original buildPromptFromDNA
  const prompt = buildPromptFromDNA(dna, { min: config.minWords, max: config.maxWords }, visualEnv);
  const fullPrompt = negativeMemory ? prompt + '\n' + negativeMemory : prompt;
  
  const systemPrompt = "You are a horror story writer. You MUST follow the DNA specifications exactly. The DNA defines WHAT the story is about - you render it into compelling prose. Do not deviate from the DNA. Always respond with valid JSON.";
  
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: fullPrompt },
      ],
      temperature: 0.75,
      response_format: { type: "json_object" },
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  const content = JSON.parse(data.choices[0].message.content);
  
  return {
    title: content.title || "Untitled",
    story: content.story || "",
    hook: content.hook || "",
  };
}

/**
 * Build the story prompt for display in generation details
 * This is a simplified version for the UI
 */
export function buildStoryPromptForDisplay(
  vibePreset: string,
  lengthPreset: string,
  visualPreset: string,
  artStyle: string
): string {
  const config = LENGTH_CONFIG[lengthPreset as keyof typeof LENGTH_CONFIG] || LENGTH_CONFIG["60"];
  const vibe = VIBE_CONFIG[vibePreset as keyof typeof VIBE_CONFIG] || VIBE_CONFIG["slow_creepy"];
  const vibeHint = VIBE_STRUCTURE_HINTS[vibePreset] || VIBE_STRUCTURE_HINTS["slow_creepy"];
  const visualEnv = VISUAL_ENVIRONMENT_DESCRIPTIONS[visualPreset] || VISUAL_ENVIRONMENT_DESCRIPTIONS["forest"];
  
  // Special display for Urban Legend style
  if (vibePreset === "urban_legend") {
    return `URBAN LEGEND / FAUX TRUE-CRIME PROMPT (v3.0 - Strict Structure)

📐 MANDATORY STRUCTURE:
  1. Opening → "In the [late 1940s-1980s]..." (specific decade)
  2. Location → Must name 2-3 specific US states
  3. Early Reports → Authorities dismiss sightings
  4. Pattern → Same disturbing detail across multiple locations
  5. Escalation → Sightings lead to disappearances
  6. Suppression → Investigation closed, files lost
  7. Ending → Unresolved - chilling image that lingers

🎭 STYLE:
  - Tone: ${vibe}
  - Voice: Documentary/Factual (third person or passive)
  - Pacing: ${vibeHint}
  - Phrases: "reports indicated", "witnesses described", "according to records"

📏 WORD COUNT: ${config.minWords}-${config.maxWords} words

📍 REQUIRED ELEMENTS:
  ✓ Historical time period (1940s-1980s)
  ✓ Multiple specific US states mentioned
  ✓ Authorities deny or ignore events  
  ✓ ONE repeating visual detail (same in each location)
  ✓ Files "lost" or investigations "closed"
  ✓ Unresolved ending with haunting image

🌲 VISUAL ENVIRONMENT:
  ${visualEnv}

🚫 RULES:
  - No real names (use roles: "a farmer", "the sheriff")
  - No first-person narration
  - Implied threat, not explicit violence
  - Final line: chilling description, NOT action`;
  }
  
  // Standard prompt display
  return `VIRAL HORROR STORY PROMPT (Enhanced v2.0)

📐 STRUCTURE:
  1. Hook (1-2 sentences) → instant curiosity
  2. Setup (15-25 words) → establish setting + unease  
  3. Escalation (50-70 words) → tension builds
  4. Reveal/Twist (20-30 words) → horror crystallizes
  5. Final Line (1 sentence) → chilling ending

🎭 STYLE:
  - Tone: ${vibe}
  - Pacing: ${vibeHint}
  - POV: First person ("I")
  - Present tense, simple sentences

📏 WORD COUNT: ${config.minWords}-${config.maxWords} words

👁️ SENSORY REQUIREMENTS:
  - 2+ sensory details (sound, shadow, texture)
  - Every paragraph must be visually depictable
  - Physical actions > abstract thoughts

🌲 VISUAL ENVIRONMENT:
  ${visualEnv}

🚫 RULES:
  - No real names, no humor, no meta commentary
  - Faceless/obscured antagonists
  - Algorithm-safe (psychological horror only)
  - Complete ending required`;
}

// =====================================================
// SCENE KEYWORD EXTRACTION
// =====================================================

/**
 * Extract scene keywords for preview (without audio timestamps)
 * Uses estimated timing based on word count
 * 
 * @param sceneCount - Target number of scenes (from user's slider)
 */
export async function extractSceneKeywordsForPreview(
  openaiKey: string,
  story: string,
  estimatedDuration: number,
  visualPreset: string,
  sceneCount: number = 6  // Target scene count from user
): Promise<StoryScene[]> {
  try {
    // Split story into sentences - handle ellipses (...) by replacing with placeholder first
    // This prevents "..." from being treated as 3 separate sentence endings
    const storyNormalized = story.replace(/\.{2,}/g, '…'); // Replace ... with single ellipsis char
    const sentences = storyNormalized.match(/[^.!?…]+[.!?…]+/g) || [story];
    const totalSentences = sentences.length;
    
    console.log(`[SCENES] ========== SCENE DISTRIBUTION v3.0 ==========`);
    console.log(`[SCENES] Story length: ${story.length} chars`);
    console.log(`[SCENES] Total sentences: ${totalSentences}`);
    console.log(`[SCENES] Requested scenes: ${sceneCount}`);
    console.log(`[SCENES] First 5 sentences:`, sentences.slice(0, 5).map(s => s.trim().substring(0, 40)));
    console.log(`[SCENES] Last 5 sentences:`, sentences.slice(-5).map(s => s.trim().substring(0, 40)));
    
    // CRITICAL: If more scenes than sentences, use WORD-SPLIT mode
    // This ensures every scene gets some content
    const sceneTexts: string[] = [];
    
    if (totalSentences >= sceneCount) {
      // More sentences than scenes - use proportional distribution
      console.log(`[SCENES] Mode: PROPORTIONAL (${totalSentences} sentences → ${sceneCount} scenes)`);
      
      for (let i = 0; i < sceneCount; i++) {
        // Calculate proportional start/end indices
        const start = Math.floor(i * totalSentences / sceneCount);
        const end = Math.floor((i + 1) * totalSentences / sceneCount);
        
        // Ensure at least 1 sentence per scene
        const actualEnd = Math.max(end, start + 1);
        const sceneText = sentences.slice(start, actualEnd).join(' ').trim();
        
        console.log(`[SCENES] Scene ${i}: [${start}:${actualEnd}] "${sceneText.substring(0, 50)}..."`);
        
        // Always add, even if empty (use fallback)
        if (sceneText && sceneText.length > 0) {
          sceneTexts.push(sceneText);
        } else {
          // Use the last sentence as fallback
          const fallbackText = sentences[Math.min(start, totalSentences - 1)]?.trim() || sentences[totalSentences - 1].trim();
          console.warn(`[SCENES] Scene ${i} empty! Using fallback: "${fallbackText.substring(0, 30)}..."`);
          sceneTexts.push(fallbackText);
        }
      }
    } else {
      // FEWER sentences than scenes - split by WORDS for finer granularity
      // This is the key case for 24 scenes with 15-16 sentences!
      console.log(`[SCENES] Mode: WORD-SPLIT (${totalSentences} sentences < ${sceneCount} scenes)`);
      
      const words = story.split(/\s+/);
      const totalWords = words.length;
      console.log(`[SCENES] Total words: ${totalWords}`);
      
      for (let i = 0; i < sceneCount; i++) {
        // Calculate proportional word indices
        const start = Math.floor(i * totalWords / sceneCount);
        const end = Math.floor((i + 1) * totalWords / sceneCount);
        const sceneText = words.slice(start, end).join(' ').trim();
        
        console.log(`[SCENES] Scene ${i}: words[${start}:${end}] = "${sceneText}"`);
        
        if (sceneText) {
          sceneTexts.push(sceneText);
        } else {
          // If empty (shouldn't happen), repeat previous
          const fallback = sceneTexts[sceneTexts.length - 1] || story;
          console.warn(`[SCENES] Scene ${i} was empty! Using fallback.`);
          sceneTexts.push(fallback);
        }
      }
    }
    
    console.log(`[SCENES] Final scene count: ${sceneTexts.length} (target: ${sceneCount})`);
    console.log(`[SCENES] ================================================`);
    
    // Verify we got the right count
    if (sceneTexts.length !== sceneCount) {
      console.error(`[SCENES] ❌ MISMATCH: Created ${sceneTexts.length} but needed ${sceneCount}!`);
    }
    
    // Get keywords for all scenes in one API call
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a video director. For each scene of this horror story, provide 2 stock video search keywords.

IMPORTANT RULES:
- Focus on VISUAL elements only (what can be SEEN on camera)
- NO abstract concepts (no "whispers", "fear", "dread", "silence")
- Use physical settings: "dark bedroom", "empty hallway", "foggy street", "old mirror", "flickering light"
- Use atmospheric visuals: "shadows moving", "candle flame", "rain window", "moonlight room"
- Keep keywords 2-3 words each

Return a JSON object with "scenes" array:
{"scenes": [{"scene": 1, "keywords": ["dark bedroom night", "shadows wall"]}, ...]}`,
          },
          {
            role: "user",
            content: `Scenes:\n${sceneTexts.map((s, i) => `Scene ${i + 1}: "${s}"`).join("\n")}`,
          },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    let sceneKeywords: Array<{ scene: number; keywords: string[] }>;
    
    if (!response.ok) {
      console.error("Failed to extract scene keywords for preview");
      sceneKeywords = sceneTexts.map((_, i) => ({
        scene: i + 1,
        keywords: VISUAL_KEYWORDS[visualPreset] || ["dark atmospheric"],
      }));
    } else {
      const data = await response.json();
      try {
        const content = data.choices[0].message.content;
        const parsed = JSON.parse(content);
        sceneKeywords = parsed.scenes;
        
        if (!Array.isArray(sceneKeywords) || sceneKeywords.length === 0) {
          throw new Error("Invalid scene keywords format: expected {scenes: [...]}" );
        }
      } catch {
        sceneKeywords = sceneTexts.map((_, i) => ({
          scene: i + 1,
          keywords: VISUAL_KEYWORDS[visualPreset] || ["dark atmospheric"],
        }));
      }
    }
    
    // Calculate estimated timing for each scene based on word count
    const totalWords = story.split(/\s+/).length;
    let currentTime = 0;
    
    const scenes: StoryScene[] = [];
    for (let i = 0; i < sceneTexts.length; i++) {
      const sceneText = sceneTexts[i];
      const sceneWords = sceneText.split(/\s+/).length;
      const sceneDuration = (sceneWords / totalWords) * estimatedDuration;
      
      scenes.push({
        text: sceneText,
        startTime: currentTime,
        endTime: currentTime + sceneDuration,
        keywords: sceneKeywords[i]?.keywords || VISUAL_KEYWORDS[visualPreset] || ["dark atmospheric"],
      });
      
      currentTime += sceneDuration;
    }
    
    return scenes;
  } catch (error) {
    console.error("Preview scene extraction error:", error);
    // Fallback: single scene
    return [{
      text: story,
      startTime: 0,
      endTime: estimatedDuration,
      keywords: VISUAL_KEYWORDS[visualPreset] || ["dark atmospheric"],
    }];
  }
}

/**
 * Split story into scenes and extract visual keywords for each
 * UPDATED: Now supports word-level splitting for high scene counts (24+ scenes)
 * This allows 24-30 scene videos even with short stories
 */
export async function extractSceneKeywords(
  openaiKey: string,
  story: string,
  captions: Array<{ word: string; start: number; end: number }>,
  visualPreset: string,
  targetSceneCount: number = 4
): Promise<StoryScene[]> {
  try {
    // Split story into sentences first
    const storyNormalized = story.replace(/\.{2,}/g, '…'); // Handle ellipses
    const sentences = storyNormalized.match(/[^.!?…]+[.!?…]+/g) || [story];
    const words = story.split(/\s+/).filter(w => w.length > 0);
    const totalWords = words.length;
    const totalSentences = sentences.length;
    
    console.log(`[extractSceneKeywords] ========== SCENE EXTRACTION ==========`);
    console.log(`[extractSceneKeywords] Story: ${totalWords} words, ${totalSentences} sentences`);
    console.log(`[extractSceneKeywords] Target scenes: ${targetSceneCount}`);
    
    // BUILD SCENES - Always use word-level timing for accuracy with captions
    // But choose content grouping based on scene count vs sentence count
    const sceneTexts: string[] = [];
    
    if (totalSentences >= targetSceneCount) {
      // MORE sentences than scenes - group sentences proportionally
      console.log(`[extractSceneKeywords] Mode: SENTENCE-GROUP (${totalSentences} sentences → ${targetSceneCount} scenes)`);
      
      for (let i = 0; i < targetSceneCount; i++) {
        // Distribute sentences as evenly as possible
        const baseSize = Math.floor(totalSentences / targetSceneCount);
        const remainder = totalSentences % targetSceneCount;
        
        // First 'remainder' scenes get one extra sentence
        const startIdx = i < remainder 
          ? i * (baseSize + 1) 
          : remainder * (baseSize + 1) + (i - remainder) * baseSize;
        const endIdx = startIdx + baseSize + (i < remainder ? 1 : 0);
        
        const sceneSentences = sentences.slice(startIdx, endIdx);
        if (sceneSentences.length > 0) {
          sceneTexts.push(sceneSentences.join(' ').trim());
        }
      }
    } else {
      // FEWER sentences than scenes - USE WORD-LEVEL SPLITTING
      // This is the key fix: allow 24 scenes for a 6-sentence story!
      console.log(`[extractSceneKeywords] Mode: WORD-SPLIT (${totalSentences} sentences < ${targetSceneCount} scenes)`);
      console.log(`[extractSceneKeywords] Each scene will have ~${Math.floor(totalWords / targetSceneCount)} words`);
      
      for (let i = 0; i < targetSceneCount; i++) {
        // Calculate proportional word indices
        const startWordIdx = Math.floor(i * totalWords / targetSceneCount);
        const endWordIdx = Math.floor((i + 1) * totalWords / targetSceneCount);
        const sceneText = words.slice(startWordIdx, endWordIdx).join(' ').trim();
        
        if (sceneText) {
          sceneTexts.push(sceneText);
          console.log(`[extractSceneKeywords] Scene ${i + 1}: words[${startWordIdx}:${endWordIdx}] = "${sceneText.substring(0, 50)}${sceneText.length > 50 ? '...' : ''}"`);
        } else {
          // Fallback: repeat previous text (shouldn't happen)
          const fallback = sceneTexts[sceneTexts.length - 1] || sentences[0] || story;
          sceneTexts.push(fallback);
          console.warn(`[extractSceneKeywords] Scene ${i + 1} was empty, using fallback`);
        }
      }
    }
    
    // Ensure we have the target count
    while (sceneTexts.length < targetSceneCount) {
      const lastText = sceneTexts[sceneTexts.length - 1] || story.substring(0, 50);
      sceneTexts.push(lastText);
      console.warn(`[extractSceneKeywords] Padding to reach target count`);
    }
    
    console.log(`[extractSceneKeywords] Created ${sceneTexts.length} scenes (target: ${targetSceneCount})`);
    console.log(`[extractSceneKeywords] ===========================================`);
    
    // Get keywords for all scenes in one API call
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a video director. For each scene of this horror story, provide 2 stock video search keywords.

IMPORTANT RULES:
- Focus on VISUAL elements only (what can be SEEN on camera)
- NO abstract concepts (no "whispers", "fear", "dread", "silence")
- Use physical settings: "dark bedroom", "empty hallway", "foggy street", "old mirror", "flickering light"
- Use atmospheric visuals: "shadows moving", "candle flame", "rain window", "moonlight room"
- Keep keywords 2-3 words each

Return JSON:
{"scenes": [{"scene": 1, "keywords": ["dark bedroom night", "shadows wall"]}, ...]}`,
          },
          {
            role: "user",
            content: `Scenes:\n${sceneTexts.map((s, i) => `Scene ${i + 1}: "${s}"`).join("\n")}`,
          },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    let sceneKeywords: Array<{ scene: number; keywords: string[] }>;
    
    if (!response.ok) {
      console.error("Failed to extract scene keywords, status:", response.status);
      sceneKeywords = sceneTexts.map((_, i) => ({
        scene: i + 1,
        keywords: VISUAL_KEYWORDS[visualPreset] || ["dark atmospheric"],
      }));
    } else {
      const data = await response.json();
      try {
        const content = data.choices[0].message.content;
        console.log("[extractSceneKeywords] GPT keywords response received");
        const parsed = JSON.parse(content);
        sceneKeywords = parsed.scenes;
        
        // Validate the structure
        if (!Array.isArray(sceneKeywords) || sceneKeywords.length === 0) {
          throw new Error("Invalid scene keywords format: expected {scenes: [...]}");
        }
      } catch (parseError) {
        console.error("Failed to parse scene keywords:", parseError);
        sceneKeywords = sceneTexts.map((_, i) => ({
          scene: i + 1,
          keywords: VISUAL_KEYWORDS[visualPreset] || ["dark atmospheric"],
        }));
      }
    }
    
    console.log(`[extractSceneKeywords] Got keywords for ${sceneKeywords.length} scenes`);
    
    // ========== VERSION 5.0: TIME-FIRST SCENE ASSIGNMENT ==========
    // Key insight: Instead of mapping TEXT -> TIME, we map TIME -> TEXT
    // This guarantees each scene's image matches what's being narrated during that time window
    const scenes: StoryScene[] = [];
    const totalDuration = captions[captions.length - 1]?.end || 45;
    const sceneDuration = totalDuration / sceneTexts.length;
    
    console.log(`[extractSceneKeywords] Time-based assignment: ${sceneDuration.toFixed(2)}s per scene`);
    
    for (let i = 0; i < sceneTexts.length; i++) {
      const startTime = i * sceneDuration;
      const endTime = (i + 1) * sceneDuration;
      
      // Find which words are actually spoken during this time window
      // This ensures the scene text represents what's being narrated
      const wordsInTimeWindow = captions.filter(cap => 
        cap.start < endTime && cap.end > startTime
      ).map(cap => cap.word);
      
      // Use the time-window words as scene text (for better image matching)
      // Fall back to original scene text if no words found
      const timeBasedText = wordsInTimeWindow.length > 0 
        ? wordsInTimeWindow.join(' ').trim()
        : sceneTexts[i];
      
      scenes.push({
        text: timeBasedText,
        startTime: startTime,
        endTime: endTime,
        keywords: sceneKeywords[i]?.keywords || VISUAL_KEYWORDS[visualPreset] || ["dark atmospheric"],
      });
      
      if (i < 3 || i >= sceneTexts.length - 2) {
        console.log(`[extractSceneKeywords] Scene ${i + 1}: ${startTime.toFixed(1)}s-${endTime.toFixed(1)}s = "${timeBasedText.substring(0, 40)}..."`);
      }
    }
    
    console.log(`[extractSceneKeywords] Final: ${scenes.length} scenes with TIME-SYNCED assignment`);
    return scenes;
  } catch (error) {
    console.error("Scene extraction error:", error);
    // Fallback: single scene with preset keywords
    const totalDuration = captions[captions.length - 1]?.end || 45;
    return [{
      text: story,
      startTime: 0,
      endTime: totalDuration,
      keywords: VISUAL_KEYWORDS[visualPreset] || ["dark atmospheric"],
    }];
  }
}

// =====================================================
// SCENE COHERENCE / FUSION LAYER
// =====================================================
// Prevents micro-scenes by enforcing minimum word counts
// and merging adjacent scenes until constraints are satisfied

export interface CoherentScene extends StoryScene {
  word_count: number;
  source_scene_indices: number[];  // Traceability back to original scenes
  fusion_reason?: string;          // Why scenes were merged (if applicable)
}

/**
 * Scene Coherence Configuration
 */
const SCENE_COHERENCE_CONFIG = {
  MIN_WORDS_PER_SCENE: 12,      // Absolute minimum - below this is a fragment
  TARGET_WORDS_PER_SCENE: 18,   // Ideal minimum for visual coherence
  CRITICAL_AVG_WORDS: 8,        // If avg < this, something is seriously wrong
  MAX_SCENES_PER_100_WORDS: 7,  // ~14 words/scene minimum implied
};

/**
 * Fuse micro-scenes into coherent visual units
 * 
 * Rules:
 * 1. Each scene must have >= MIN_WORDS_PER_SCENE (12)
 * 2. Prefer scenes with >= TARGET_WORDS_PER_SCENE (18)
 * 3. Merge adjacent scenes if below threshold
 * 4. Never exceed platform clamps (handled by caller)
 * 5. Preserve keyword relevance by concatenating or re-extracting
 * 
 * @param scenes - Original scenes (potentially micro-fragmented)
 * @param totalWords - Total words in story (for ratio validation)
 * @returns CoherentScene[] - Fused scenes with traceability
 */
export function fuseIntoCoherentScenes(
  scenes: StoryScene[],
  totalWords: number
): CoherentScene[] {
  console.log(`\n[SCENE-FUSION] ========== COHERENCE LAYER ==========`);
  console.log(`[SCENE-FUSION] Input: ${scenes.length} scenes, ${totalWords} total words`);
  
  const avgWordsOriginal = totalWords / scenes.length;
  console.log(`[SCENE-FUSION] Original avg: ${avgWordsOriginal.toFixed(1)} words/scene`);
  
  // Check if fusion is needed
  if (avgWordsOriginal >= SCENE_COHERENCE_CONFIG.TARGET_WORDS_PER_SCENE) {
    console.log(`[SCENE-FUSION] ✓ No fusion needed - avg already >= ${SCENE_COHERENCE_CONFIG.TARGET_WORDS_PER_SCENE}`);
    return scenes.map((s, i) => ({
      ...s,
      word_count: s.text.split(/\s+/).filter(w => w.length > 0).length,
      source_scene_indices: [i],
    }));
  }
  
  // Calculate recommended max scenes based on word count
  const maxRecommendedScenes = Math.floor(totalWords / SCENE_COHERENCE_CONFIG.MIN_WORDS_PER_SCENE);
  console.log(`[SCENE-FUSION] Recommended max scenes: ${maxRecommendedScenes} (for ${SCENE_COHERENCE_CONFIG.MIN_WORDS_PER_SCENE}+ words each)`);
  
  // Greedy fusion: merge adjacent scenes until all meet minimum
  const coherentScenes: CoherentScene[] = [];
  let currentGroup: { 
    texts: string[]; 
    keywords: string[];
    startTime: number; 
    endTime: number;
    sourceIndices: number[];
  } | null = null;
  
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const sceneWordCount = scene.text.split(/\s+/).filter(w => w.length > 0).length;
    
    if (currentGroup === null) {
      // Start new group
      currentGroup = {
        texts: [scene.text],
        keywords: [...(scene.keywords || [])],
        startTime: scene.startTime,
        endTime: scene.endTime,
        sourceIndices: [i],
      };
    } else {
      // Add to current group
      currentGroup.texts.push(scene.text);
      currentGroup.keywords.push(...(scene.keywords || []));
      currentGroup.endTime = scene.endTime;
      currentGroup.sourceIndices.push(i);
    }
    
    // Calculate current group's word count
    const groupText = currentGroup.texts.join(' ').trim();
    const groupWordCount = groupText.split(/\s+/).filter(w => w.length > 0).length;
    
    // Check if we should finalize this group
    const isLastScene = i === scenes.length - 1;
    const meetsMinimum = groupWordCount >= SCENE_COHERENCE_CONFIG.MIN_WORDS_PER_SCENE;
    const meetsTarget = groupWordCount >= SCENE_COHERENCE_CONFIG.TARGET_WORDS_PER_SCENE;
    const nextSceneSmall = i + 1 < scenes.length && 
      scenes[i + 1].text.split(/\s+/).filter(w => w.length > 0).length < SCENE_COHERENCE_CONFIG.MIN_WORDS_PER_SCENE;
    
    // Finalize if: meets target, OR (meets minimum AND next scene is also substantial), OR last scene
    const shouldFinalize = isLastScene || meetsTarget || (meetsMinimum && !nextSceneSmall);
    
    if (shouldFinalize && currentGroup) {
      // Deduplicate keywords while preserving order
      const uniqueKeywords = [...new Set(currentGroup.keywords)].slice(0, 4);
      
      const fusionReason = currentGroup.sourceIndices.length > 1 
        ? `Merged ${currentGroup.sourceIndices.length} micro-scenes (${currentGroup.sourceIndices.map(x => x + 1).join('+')})`
        : undefined;
      
      coherentScenes.push({
        text: groupText,
        startTime: currentGroup.startTime,
        endTime: currentGroup.endTime,
        keywords: uniqueKeywords,
        word_count: groupWordCount,
        source_scene_indices: currentGroup.sourceIndices,
        fusion_reason: fusionReason,
      });
      
      if (fusionReason) {
        console.log(`[SCENE-FUSION] Scene ${coherentScenes.length}: ${fusionReason} → ${groupWordCount} words`);
      }
      
      currentGroup = null;
    }
  }
  
  // Calculate new average
  const avgWordsNew = totalWords / coherentScenes.length;
  
  console.log(`[SCENE-FUSION] Output: ${coherentScenes.length} coherent scenes`);
  console.log(`[SCENE-FUSION] New avg: ${avgWordsNew.toFixed(1)} words/scene`);
  
  // Warn if still below critical threshold
  if (avgWordsNew < SCENE_COHERENCE_CONFIG.CRITICAL_AVG_WORDS) {
    console.warn(`[SCENE-FUSION] ⚠️ CRITICAL: Avg still < ${SCENE_COHERENCE_CONFIG.CRITICAL_AVG_WORDS} words/scene!`);
  }
  
  console.log(`[SCENE-FUSION] ==========================================\n`);
  
  return coherentScenes;
}

/**
 * Calculate recommended scene count based on story word count
 * Returns a sane range that avoids micro-fragmentation
 */
export function calculateRecommendedSceneCount(
  totalWords: number,
  durationSec: number,
  platform: string = 'reels'
): { min: number; max: number; recommended: number; warning?: string } {
  // Platform-specific clamps
  const platformClamps: Record<string, { min: number; max: number }> = {
    reels: { min: 4, max: 15 },
    tiktok: { min: 4, max: 15 },
    youtube_shorts: { min: 4, max: 20 },
    youtube: { min: 6, max: 40 },
  };
  
  const clamp = platformClamps[platform] || platformClamps.reels;
  
  // Calculate based on word count (primary constraint)
  const maxByWords = Math.floor(totalWords / SCENE_COHERENCE_CONFIG.MIN_WORDS_PER_SCENE);
  const recommendedByWords = Math.floor(totalWords / SCENE_COHERENCE_CONFIG.TARGET_WORDS_PER_SCENE);
  
  // Calculate based on duration (secondary constraint)
  const minSceneDuration = 2.5; // seconds - faster than this is jarring
  const maxSceneDuration = 8.0; // seconds - slower than this is boring
  const maxByDuration = Math.floor(durationSec / minSceneDuration);
  const minByDuration = Math.ceil(durationSec / maxSceneDuration);
  
  // Intersect constraints
  const min = Math.max(clamp.min, minByDuration);
  const max = Math.min(clamp.max, maxByWords, maxByDuration);
  const recommended = Math.min(max, Math.max(min, recommendedByWords));
  
  let warning: string | undefined;
  if (max < min) {
    warning = `Story too short for platform: ${totalWords} words can't fill ${durationSec}s without micro-scenes`;
  } else if (recommendedByWords < min) {
    warning = `Story density low: ${totalWords} words for ${durationSec}s = recommend ${recommended} scenes max`;
  }
  
  return { min, max, recommended, warning };
}

// =====================================================
// CHARACTER LOCK HELPER FUNCTIONS
// =====================================================

/**
 * Detect if the character description describes a GROUP of people
 * rather than a single character. This is important because pattern
 * extraction on multi-character descriptions creates garbled output.
 * 
 * @returns true if GROUP scenario (2+ characters)
 */
function detectGroupCharacters(description: string): boolean {
  const lowerDesc = description.toLowerCase();
  
  // Explicit group indicators
  const groupIndicators = [
    /\b(\d+)\s*(people|persons|friends|characters|individuals)/i,  // "6 friends"
    /\bgroup\s+of\b/i,                                              // "group of"
    /\bseveral\s+(people|friends|characters)/i,                     // "several friends"
    /\bmultiple\s+(people|characters)/i,                            // "multiple people"
    /\bfriends?\s+include/i,                                        // "friends include"
    /\bcharacters?\s+are\s*:/i,                                     // "characters are:"
    /\bfirst\s+(person|character|friend)\s*[,.:]/i,                 // "first person:"
    /\bsecond\s+(person|character|friend)\s*[,.:]/i,                // "second person:"
    /\bthird\s+(person|character|friend)\s*[,.:]/i,                 // "third person:"
    /\b(1|2|3|4|5|6|7|8|9|10)\.\s*(tall|short|male|female|woman|man)/i, // "1. Tall male..."
  ];
  
  for (const pattern of groupIndicators) {
    if (pattern.test(description)) {
      console.log(`[detectGroupCharacters] Matched pattern: ${pattern}`);
      return true;
    }
  }
  
  // Count distinct character descriptions by looking for numbered lists or "and" separators
  const personMatches = description.match(/\b(tall|short|male|female|man|woman|person|friend)\s+with\b/gi);
  if (personMatches && personMatches.length >= 3) {
    console.log(`[detectGroupCharacters] Found ${personMatches.length} person descriptions`);
    return true;
  }
  
  // Count comma-separated character descriptions
  const commaSegments = description.split(/[,;]/);
  let descriptionCount = 0;
  for (const segment of commaSegments) {
    if (/\b(wearing|dressed|hair|eyes|tall|short|male|female)\b/i.test(segment)) {
      descriptionCount++;
    }
  }
  if (descriptionCount >= 4) {
    console.log(`[detectGroupCharacters] Found ${descriptionCount} description segments`);
    return true;
  }
  
  return false;
}

/**
 * Generate a stable character ID from description
 */
function generateCharacterId(description: string): string {
  let hash = 0;
  for (let i = 0; i < description.length; i++) {
    const char = description.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `char_${Math.abs(hash).toString(16).substring(0, 6)}`;
}

/**
 * Extract face/head features from character description
 */
function extractCharacterFace(desc: string): string {
  const facePatterns = [
    /(?:hair|haired)[^,.]*/gi,
    /(?:eyes?|eyed)[^,.]*/gi,
    /(?:face|facial)[^,.]*/gi,
    /(?:skin|complexion)[^,.]*/gi,
    /(?:\d+\s*(?:year|yr)s?\s*old|in\s+(?:her|his|their)\s+\d+s)[^,.]*/gi,
    /(?:young|old|middle-aged|elderly)[^,.]*/gi,
  ];
  
  const matches: string[] = [];
  for (const pattern of facePatterns) {
    const found = desc.match(pattern);
    if (found) matches.push(...found);
  }
  
  return matches.length > 0 ? matches.join(", ").trim() : desc.split(",")[0].trim();
}

/**
 * Extract outfit/clothing from character description
 */
function extractCharacterOutfit(desc: string): string {
  const outfitPatterns = [
    /(?:wearing|dressed\s+in|wears?)[^,.]*/gi,
    /(?:jacket|coat|shirt|dress|pants|jeans|hoodie|sweater|uniform)[^,.]*/gi,
    /(?:red|blue|black|white|dark|light)\s+(?:jacket|coat|shirt|dress)[^,.]*/gi,
  ];
  
  const matches: string[] = [];
  for (const pattern of outfitPatterns) {
    const found = desc.match(pattern);
    if (found) matches.push(...found);
  }
  
  return matches.length > 0 ? matches.join(", ").trim() : "standard clothing";
}

/**
 * Extract body type/silhouette from character description
 */
function extractCharacterSilhouette(desc: string): string {
  const bodyPatterns = [
    /(?:tall|short|average|slim|thin|heavy|athletic|muscular)[^,.]*/gi,
    /(?:build|figure|frame)[^,.]*/gi,
    /(?:woman|man|girl|boy|person|child|adult)[^,.]*/gi,
  ];
  
  const matches: string[] = [];
  for (const pattern of bodyPatterns) {
    const found = desc.match(pattern);
    if (found) matches.push(...found);
  }
  
  return matches.length > 0 ? matches.join(", ").trim() : "average build";
}

/**
 * Extract key features that must not change
 */
function extractDoNotChange(desc: string): string[] {
  const keyFeatures: string[] = [];
  
  // Hair
  if (/(?:blonde|brunette|black|red|brown|gray|white)\s*hair/i.test(desc)) {
    keyFeatures.push("hair color");
  }
  if (/(?:long|short|curly|straight|wavy)\s*hair/i.test(desc)) {
    keyFeatures.push("hair style");
  }
  
  // Clothing colors
  const clothingColors = desc.match(/(?:red|blue|black|white|green|yellow|purple|brown)\s+(?:jacket|coat|shirt|dress|hoodie)/gi);
  if (clothingColors) {
    keyFeatures.push("clothing color");
  }
  
  // Age
  if (/(?:\d+\s*years?|in\s+(?:her|his|their)\s+\d+s)/i.test(desc)) {
    keyFeatures.push("apparent age");
  }
  
  // If nothing found, add generic
  if (keyFeatures.length === 0) {
    keyFeatures.push("overall appearance", "clothing");
  }
  
  return keyFeatures;
}

// =====================================================
// STORY ANCHOR CREATION
// =====================================================

/**
 * Create a "Story Anchor" - the visual bible for the entire story
 * This ensures all images share the same visual universe
 */
export async function createStoryAnchor(
  openaiKey: string,
  fullStory: string,
  visualPreset: string,
  artStyle: string = "cinematic-dark",
  customStyle?: any
): Promise<StoryAnchor> {
  // Get art style config - use custom style if provided, otherwise look up built-in
  let styleConfig;
  if (artStyle.startsWith('custom-') && customStyle) {
    styleConfig = {
      name: customStyle.name || "Custom Style",
      basePrompt: customStyle.basePrompt || "",
      colorOverride: customStyle.colorOverride || "",
      technicalStyle: customStyle.technicalStyle || "",
      negativePrompt: customStyle.negativePrompt || "text, words, letters"
    };
    console.log(`[createStoryAnchor] Using CUSTOM style: ${styleConfig.name}`);
    console.log(`[createStoryAnchor] Base prompt: ${styleConfig.basePrompt.substring(0, 100)}...`);
  } else {
    styleConfig = ART_STYLE_CONFIG[artStyle] || ART_STYLE_CONFIG["cinematic-dark"];
    console.log(`[createStoryAnchor] Using built-in style: ${styleConfig.name}`);
  }
  
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a horror visual director creating a "Story Anchor" - a visual bible for generating consistent images across an entire horror story.

TARGET ART STYLE: ${styleConfig.name}
STYLE DESCRIPTION: ${styleConfig.basePrompt}
COLOR PALETTE: ${styleConfig.colorOverride}
CAMERA/TECHNIQUE: ${styleConfig.technicalStyle}

Analyze the story and extract:
1. ENVIRONMENT: The PRIMARY setting - be very specific (e.g., "dense pine forest with twisted ancient roots" not just "forest")
2. COLOR_PALETTE: Colors that work within the target art style
3. CAMERA_STYLE: Must use the specified technique
4. HORROR_TONE: Type of horror (psychological, supernatural, cosmic, folklore, body horror)
5. TIME_OF_DAY: Specific lighting that fits the style
6. RECURRING_MOTIFS: Visual elements to repeat (fog, shadows, specific objects mentioned)
7. CHARACTER: If ANY human/person appears in the story, you MUST describe them in detail (age, hair, clothing, distinguishing features). This is REQUIRED for visual consistency. Only use null if the story has no human characters at all.
8. CONTINUITY_RULES: Specific rules to maintain visual consistency (e.g., "character always wears red jacket", "forest trees are always gnarled and twisted", "lighting always comes from the left")

CRITICAL: Adapt ALL elements to fit the ${styleConfig.name} art style!

Return JSON:
{
  "environment": "detailed, specific environment description IN THE TARGET ART STYLE",
  "colorPalette": "colors adapted to the style",
  "cameraStyle": "${styleConfig.technicalStyle}",
  "horrorTone": "type and mood of horror",
  "timeOfDay": "time and lighting",
  "recurringMotifs": "visual motifs to repeat",
  "characterDescription": "DETAILED character description if humans appear, including: age, gender, hair color/style, clothing, any distinguishing features. Use target art style. null ONLY if no humans in story.",
  "continuityRules": "Specific visual rules for consistency: character features that must stay constant, environment details that must repeat, lighting direction, any recurring visual elements",
  "fullAnchorPrompt": "Complete visual anchor combining ALL elements into a reusable prompt. MUST start with the art style description and include all visual rules."
}`,
          },
          {
            role: "user",
            content: `Story:\n"${fullStory}"\n\nVisual theme preference: ${visualPreset}\nTarget art style: ${styleConfig.name}\n\nCreate the Story Anchor (remember: if ANY person/human appears in the story, characterDescription is REQUIRED):`,
          },
        ],
        temperature: 0.6,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to create story anchor");
    }

    const data = await response.json();
    const anchor = JSON.parse(data.choices[0].message.content);
    
    // ========== CREATE CHARACTER LOCK ==========
    // If character exists, create structured CharacterLock for consistency
    // v5.6: Detect GROUP vs SINGLE character scenarios
    if (anchor.characterDescription) {
      const charDesc = anchor.characterDescription;
      
      // Detect if this is a GROUP scenario (multiple characters)
      const isGroupScenario = detectGroupCharacters(charDesc);
      
      if (isGroupScenario) {
        // GROUP MODE: Use simplified description to avoid garbled output
        // from pattern extraction on multi-character descriptions
        console.log(`[createStoryAnchor] Detected GROUP scenario - using simplified lock`);
        anchor.characterLock = {
          id: generateCharacterId(charDesc),
          face: "multiple characters - varied appearances",
          outfit: "casual group attire as described in story",
          silhouette: "group of people",
          doNotChange: ["group composition", "overall appearance styles"],
          isGroup: true,
          groupDescription: charDesc,  // Store full description for reference
        };
      } else {
        // SINGLE CHARACTER MODE: Use detailed extraction
        anchor.characterLock = {
          id: generateCharacterId(charDesc),
          face: extractCharacterFace(charDesc),
          outfit: extractCharacterOutfit(charDesc),
          silhouette: extractCharacterSilhouette(charDesc),
          doNotChange: extractDoNotChange(charDesc),
          isGroup: false,
        };
      }
      console.log(`[createStoryAnchor] Created CharacterLock: ${anchor.characterLock.id} (group: ${isGroupScenario})`);
    }
    
    // FORCE CUSTOM STYLE VERBATIM - don't let GPT invent style/camera language
    if (artStyle.startsWith('custom-') && customStyle) {
      console.log(`[createStoryAnchor] Forcing custom style verbatim over GPT suggestions`);
      
      // Force fullAnchorPrompt to START with the user's exact basePrompt
      anchor.fullAnchorPrompt = [
        customStyle.basePrompt,
        customStyle.colorOverride,
        customStyle.technicalStyle,
        anchor.environment, // Keep GPT's environment description
        anchor.horrorTone,  // Keep GPT's horror tone
      ].filter(Boolean).join("\n");
      
      // Force camera/technical style to be exactly what user specified
      anchor.cameraStyle = customStyle.technicalStyle || anchor.cameraStyle;
      
      // Force color palette to be exactly what user specified
      anchor.colorPalette = customStyle.colorOverride || anchor.colorPalette;
      
      console.log(`[createStoryAnchor] Overridden anchor with custom style: ${customStyle.name}`);
    }
    
    console.log("Story Anchor created:", anchor.fullAnchorPrompt?.substring(0, 200) + "...");
    return anchor;
  } catch (error) {
    console.error("Failed to create story anchor:", error);
    // Fallback anchors based on visual preset
    return createFallbackAnchor(visualPreset);
  }
}

/**
 * Create fallback story anchor for a preset
 */
function createFallbackAnchor(visualPreset: string): StoryAnchor {
  const presetAnchors: Record<string, StoryAnchor> = {
    forest: {
      environment: "dark ancient forest at night, towering pine trees with twisted gnarled roots, heavy fog rolling along the ground, dense undergrowth",
      colorPalette: "muted greens, cold blues, deep blacks, desaturated",
      cameraStyle: "cinematic horror, film grain, shallow depth of field, realistic lighting",
      horrorTone: "psychological horror, ominous and quiet, building dread",
      timeOfDay: "deep night, pale moonlight barely piercing the canopy",
      recurringMotifs: "fog between trees, shadows that seem to move, darkness beyond the treeline",
      characterDescription: null,
      continuityRules: "Trees always gnarled and twisted, fog always present at ground level, moonlight always from upper left, shadows always deep black",
      fullAnchorPrompt: "A dark, ancient forest at night. Towering pine trees with twisted roots, heavy fog rolling through the ground, moonlight barely piercing the dense canopy. Muted greens and cold blue tones with deep shadows. Cinematic horror style, realistic, film grain, psychological horror mood, ominous and quiet.",
    },
    hallway: {
      environment: "long abandoned hallway in a decrepit building, peeling wallpaper, water-stained ceiling, flickering fluorescent lights",
      colorPalette: "sickly yellows, institutional greens, deep shadows, desaturated",
      cameraStyle: "cinematic horror, film grain, shallow depth of field",
      horrorTone: "psychological horror, claustrophobic, institutional dread",
      timeOfDay: "indeterminate, harsh artificial lighting with deep shadows",
      recurringMotifs: "endless doors, flickering lights, long shadows, distant sounds",
      characterDescription: null,
      continuityRules: "Wallpaper always peeling in same pattern, fluorescent lights always flickering, ceiling always water-stained, perspective always long and narrow",
      fullAnchorPrompt: "A long, abandoned hallway in a decrepit building. Peeling wallpaper, water-stained ceiling, flickering fluorescent lights casting harsh shadows. Sickly yellow and institutional green tones. Cinematic horror style, claustrophobic and deeply unsettling.",
    },
    attic: {
      environment: "cramped dusty attic with exposed wooden beams, scattered old furniture covered in sheets, single dirty window",
      colorPalette: "warm browns, dusty grays, shafts of pale light, deep shadows",
      cameraStyle: "cinematic horror, film grain, shallow depth of field",
      horrorTone: "psychological horror, forgotten secrets, hidden things",
      timeOfDay: "late afternoon, dust-filtered light through a grimy window",
      recurringMotifs: "sheet-covered shapes, dust motes in light, boxes of forgotten things",
      characterDescription: null,
      continuityRules: "Wooden beams always exposed and dark, dust particles always visible in light, sheets always white and draped, window always grimy with diffused light",
      fullAnchorPrompt: "A cramped, dusty attic with exposed wooden beams. Old furniture covered in white sheets, dust floating in shafts of pale light from a single grimy window. Warm browns and dusty grays with deep shadows. Cinematic horror style, atmosphere of forgotten secrets.",
    },
    foggy: {
      environment: "open landscape consumed by thick, unnatural fog, visibility reduced to mere feet, vague shapes barely visible",
      colorPalette: "whites, pale grays, muted colors, ethereal glow",
      cameraStyle: "cinematic horror, soft focus, atmospheric haze",
      horrorTone: "cosmic horror, disorientation, the unknown",
      timeOfDay: "indeterminate, diffused light with no visible source",
      recurringMotifs: "shapes in the fog, limited visibility, sense of being watched",
      characterDescription: null,
      continuityRules: "Fog always thick and white, visibility always limited to few feet, shapes always vague and indistinct, light source always invisible and diffused",
      fullAnchorPrompt: "A landscape consumed by thick, unnatural fog. Visibility reduced to mere feet, vague threatening shapes barely visible in the white void. Pale grays and muted colors with an ethereal, sourceless glow. Cinematic horror style, deeply disorienting, cosmic dread.",
    },
    rain: {
      environment: "dark urban street at night during heavy rain, wet asphalt reflecting streetlights, rain streaking down",
      colorPalette: "deep blues, neon reflections, wet blacks, cold highlights",
      cameraStyle: "cinematic horror, rain streaks, reflections, noir lighting",
      horrorTone: "psychological horror, urban isolation, being followed",
      timeOfDay: "late night, streetlights creating pools of light in darkness",
      recurringMotifs: "rain reflections, empty streets, distant figures, wet surfaces",
      characterDescription: null,
      continuityRules: "Rain always heavy and streaking, asphalt always wet and reflective, streetlights always orange, buildings always dark silhouettes",
      fullAnchorPrompt: "A dark urban street at night during heavy rain. Wet asphalt reflecting orange streetlights, rain streaking through the frame, deep shadows between buildings. Deep blues and cold highlights with neon reflections. Cinematic noir horror style, urban isolation and paranoia.",
    },
  };
  return presetAnchors[visualPreset] || presetAnchors.forest;
}

// =====================================================
// VISUAL BEATS CREATION
// =====================================================

/**
 * Create visual beats with escalating mood for each scene
 * 
 * BATCHED to avoid output token truncation - GPT-4o-mini has limited output tokens
 * Processing 6 scenes at a time ensures we get complete beats for all scenes
 */
export async function createVisualBeats(
  openaiKey: string,
  scenes: StoryScene[],
  storyAnchor: StoryAnchor
): Promise<VisualBeat[]> {
  // Pre-initialize ALL beats with fallbacks first
  const allBeats: VisualBeat[] = scenes.map((scene, i) => ({
    sceneIndex: i,
    visualBeat: `atmospheric horror scene: ${scene.text.substring(0, 50)}`,
    cameraAngle: i === 0 ? "wide establishing shot" : i === scenes.length - 1 ? "close-up" : "medium shot",
    focus: "the growing darkness",
    moodLevel: Math.min(3 + Math.floor(i * 0.35 * 10), 10), // Gradual escalation
    mirrorBehavior: i < scenes.length * 0.2 ? "none" : i < scenes.length * 0.5 ? "reflection shows different expression" : "something in reflection that isn't there",
    realityRule: i < scenes.length * 0.3 ? "normal" : i < scenes.length * 0.6 ? "shadows wrong direction" : "eyes follow camera",
    compositionHint: "centered subject",
  }));
  
  // Process in batches of 6 (smaller batches = more reliable)
  const BATCH_SIZE = 6;
  const totalBatches = Math.ceil(scenes.length / BATCH_SIZE);
  
  console.log(`[BEATS] Creating visual beats for ${scenes.length} scenes in ${totalBatches} batches of ${BATCH_SIZE}`);
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const startIdx = batchIndex * BATCH_SIZE;
    const endIdx = Math.min(startIdx + BATCH_SIZE, scenes.length);
    const batchScenes = scenes.slice(startIdx, endIdx);
    
    console.log(`[BEATS] Batch ${batchIndex + 1}/${totalBatches}: scenes ${startIdx + 1}-${endIdx}`);
    
    try {
      const batchBeats = await createVisualBeatsBatch(
        openaiKey,
        batchScenes,
        storyAnchor,
        startIdx,
        scenes.length
      );
      
      // Store beats by matching sceneIndex
      for (const beat of batchBeats) {
        let targetIdx = beat.sceneIndex;
        
        // If sceneIndex is relative (0-5 instead of global), convert to global
        if (targetIdx < startIdx && targetIdx < BATCH_SIZE) {
          targetIdx = startIdx + targetIdx;
          console.log(`[BEATS] Fixing relative index ${beat.sceneIndex} → ${targetIdx}`);
        }
        
        // Validate the index is within expected range
        if (targetIdx >= startIdx && targetIdx < endIdx) {
          allBeats[targetIdx] = { ...beat, sceneIndex: targetIdx };
          console.log(`[BEATS] ✓ Scene ${targetIdx + 1}: "${beat.visualBeat?.substring(0, 50)}...", mood=${beat.moodLevel}`);
        } else {
          console.warn(`[BEATS] ⚠️ Beat sceneIndex ${beat.sceneIndex} out of batch range ${startIdx}-${endIdx-1}`);
        }
      }
      
      console.log(`[BEATS] Batch ${batchIndex + 1} complete: processed ${batchBeats.length} beats`);
      
    } catch (batchError) {
      console.error(`[BEATS] Batch ${batchIndex + 1} failed:`, batchError);
      console.log(`[BEATS] Using pre-initialized fallback beats for scenes ${startIdx + 1}-${endIdx}`);
    }
    
    // Delay between batches to avoid rate limits
    if (batchIndex < totalBatches - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  // Final validation
  let realBeats = 0;
  let fallbackBeats = 0;
  allBeats.forEach((b, i) => {
    if (b.visualBeat && b.visualBeat.length > 60 && !b.visualBeat.startsWith("atmospheric horror scene:")) {
      realBeats++;
    } else {
      fallbackBeats++;
      console.log(`[BEATS] Scene ${i + 1}: Using fallback (no detailed beat)`);
    }
  });
  
  console.log(`[BEATS] Final: ${realBeats} detailed beats, ${fallbackBeats} fallbacks`);
  
  return allBeats;
}

/**
 * Create visual beats for a batch of scenes
 */
async function createVisualBeatsBatch(
  openaiKey: string,
  scenes: StoryScene[],
  storyAnchor: StoryAnchor,
  startIndex: number,
  totalScenes: number
): Promise<VisualBeat[]> {
  const sceneData = scenes.map((s, i) => ({
    globalIndex: startIndex + i,
    text: s.text
  }));
  
  const sceneTexts = sceneData.map(s => 
    `=== SCENE ${s.globalIndex + 1} of ${totalScenes} (USE sceneIndex: ${s.globalIndex}) ===\n"${s.text}"`
  ).join("\n\n");
  
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a horror cinematographer creating "visual beats" for each scene of a horror story.

🔒 CRITICAL: You MUST create a COMPLETE, DETAILED visual beat for EVERY scene.
Do NOT summarize, abstract, or compress later scenes.
EVERY scene gets the SAME level of detail as the first scene.

The story takes place in: ${storyAnchor.environment}
Horror tone: ${storyAnchor.horrorTone}

For EACH scene, create a visual beat with these fields:
{
  "sceneIndex": GLOBAL_SCENE_NUMBER (the exact number I give you),
  "visualBeat": "DETAILED cinematic description - minimum 15 words. Use horror cinematography language: 'barely visible', 'partially obscured', 'emerging from shadow'. This MUST be a VISUAL DESCRIPTION, not story text.",
  "cameraAngle": "wide establishing shot | medium shot | close-up | extreme close-up | low angle | high angle | POV shot | over-the-shoulder",
  "focus": "What the viewer's eye should be drawn to (be specific)",
  "moodLevel": 1-10 escalating intensity,
  "mirrorBehavior": "none | reflection shows different expression | something in reflection that isn't there | reflection delayed | no reflection at all",
  "realityRule": "normal | shadows wrong direction | too many fingers | eyes follow camera | background subtly wrong | time seems frozen",
  "compositionHint": "centered subject | rule of thirds | negative space left | negative space right | claustrophobic tight | vast empty"
}

CRITICAL RULES:
- sceneIndex MUST be the GLOBAL index I provide (e.g., 6, 7, 8, 9, 10, 11)
- visualBeat MUST be a VISUAL/CINEMATIC description, NOT the story narration
- EVERY beat needs FULL detail - no shortcuts for later scenes
- ESCALATE tension - each beat more unsettling than the last

Return JSON: {"beats": [...]}`,
        },
        {
          role: "user",
          content: `Create DETAILED visual beats for these ${scenes.length} scenes.
USE THE EXACT GLOBAL SCENE INDICES I PROVIDE:

${sceneTexts}

Remember: sceneIndex values must be ${sceneData.map(s => s.globalIndex).join(", ")} respectively.
EVERY visualBeat must be a cinematic description (15+ words), NOT story text.`,
        },
      ],
      temperature: 0.7,
      response_format: { type: "json_object" },
      max_tokens: 2500,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create visual beats batch: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  const beats = parsed.beats || parsed.scenes || (Array.isArray(parsed) ? parsed : []);
  
  console.log(`[BEATS] Batch returned ${beats.length} beats for scenes ${startIndex + 1}-${startIndex + scenes.length}`);
  
  // Log what we got back
  beats.forEach((b: any) => {
    console.log(`[BEATS] Raw: sceneIndex=${b.sceneIndex}, visualBeat="${b.visualBeat?.substring(0, 50)}..."`);
  });
  
  return beats;
}

// =====================================================
// SCENE VISUAL CONTRACTS
// =====================================================

/**
 * Create Scene Visual Contracts - converts prose → literal frame descriptions
 * This is the critical layer that makes images follow the story
 * 
 * BATCHED to avoid output token truncation - GPT-4o-mini has limited output tokens
 * Processing 6 scenes at a time ensures we get complete contracts for all scenes
 * 
 * v5.1: Now includes CONTINUITY CARRYOVER - location, threat, character, time_of_day
 *       carry forward unless narration explicitly changes them
 */
export async function createSceneVisualContracts(
  openaiKey: string,
  scenes: StoryScene[],
  storyAnchor: StoryAnchor,
  visualBeats: VisualBeat[]
): Promise<SceneVisualContract[]> {
  // Pre-initialize ALL contracts with fallbacks first
  // This ensures every scene gets a contract even if API fails
  const baseLocation = storyAnchor.environment.split(",")[0] || "dark setting";
  const baseTimeOfDay = storyAnchor.timeOfDay || "night";
  const baseCharacter = storyAnchor.characterDescription || null;
  
  const allContracts: SceneVisualContract[] = scenes.map((scene, i) => ({
    sceneIndex: i,
    location: baseLocation,
    characterPose: "standing, tense posture",
    facialExpression: "fear, wide eyes",
    visibleObjects: ["walls", "shadows", "fog"],
    supernaturalElement: i > 2 ? "unnatural shadows moving" : null,
    cameraDistance: i === 0 ? "wide" : "medium" as const,
    lightingSource: "dim ambient light",
    actionFrozen: scene.text.substring(0, 80),
    forbiddenElements: ["stairs", "extra people", "text", "words"],
    continuityFromPrev: i === 0 ? "establishing shot" : `same environment as previous`,
    evidenceRule: `scene must clearly show ${baseLocation}`,
    // Initialize continuity with story anchor defaults
    continuity: {
      location: baseLocation,
      threat_manifestation: "unnatural presence",
      main_character: baseCharacter,
      time_of_day: baseTimeOfDay,
      camera_language: "cinematic",
    },
  }));
  
  // Process in batches of 6 (smaller batches = more reliable)
  const BATCH_SIZE = 6;
  const totalBatches = Math.ceil(scenes.length / BATCH_SIZE);
  
  console.log(`[VISUAL CONTRACTS] Processing ${scenes.length} scenes in ${totalBatches} batches of ${BATCH_SIZE}`);
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const startIdx = batchIndex * BATCH_SIZE;
    const endIdx = Math.min(startIdx + BATCH_SIZE, scenes.length);
    const batchScenes = scenes.slice(startIdx, endIdx);
    
    // Get previous scene's continuity to pass to this batch
    const previousContinuity = startIdx > 0 ? allContracts[startIdx - 1].continuity : {
      location: baseLocation,
      threat_manifestation: "unnatural presence forming",
      main_character: baseCharacter,
      time_of_day: baseTimeOfDay,
      camera_language: "cinematic horror",
    };
    
    console.log(`[VISUAL CONTRACTS] Batch ${batchIndex + 1}/${totalBatches}: scenes ${startIdx + 1}-${endIdx}`);
    console.log(`[VISUAL CONTRACTS] Continuity from prev: loc="${previousContinuity?.location}", time="${previousContinuity?.time_of_day}"`);
    
    try {
      const batchContracts = await createVisualContractsBatch(
        openaiKey,
        batchScenes,
        storyAnchor,
        visualBeats.slice(startIdx, endIdx),
        startIdx,
        scenes.length,
        scenes, // Pass ALL scenes for context
        previousContinuity // NEW: Pass previous continuity
      );
      
      // Store contracts by MATCHING sceneIndex, not by array position
      // This handles cases where GPT returns them in wrong order or with wrong indices
      for (const contract of batchContracts) {
        // Try to match by sceneIndex first
        let targetIdx = contract.sceneIndex;
        
        // If sceneIndex is relative (0-5 instead of 8-13), convert to global
        if (targetIdx < startIdx && targetIdx < BATCH_SIZE) {
          targetIdx = startIdx + targetIdx;
          console.log(`[VISUAL CONTRACTS] Fixing relative index ${contract.sceneIndex} → ${targetIdx}`);
        }
        
        // Validate the index is within expected range
        if (targetIdx >= startIdx && targetIdx < endIdx) {
          allContracts[targetIdx] = { ...contract, sceneIndex: targetIdx };
          console.log(`[VISUAL CONTRACTS] ✓ Scene ${targetIdx + 1}: ${contract.location}, action="${contract.actionFrozen?.substring(0, 40)}..."`);
        } else {
          console.warn(`[VISUAL CONTRACTS] ⚠️ Contract sceneIndex ${contract.sceneIndex} out of batch range ${startIdx}-${endIdx-1}`);
        }
      }
      
      console.log(`[VISUAL CONTRACTS] Batch ${batchIndex + 1} complete: processed ${batchContracts.length} contracts`);
      
    } catch (batchError) {
      console.error(`[VISUAL CONTRACTS] Batch ${batchIndex + 1} failed:`, batchError);
      // Fallback contracts were already pre-initialized, so we just log and continue
      console.log(`[VISUAL CONTRACTS] Using pre-initialized fallback contracts for scenes ${startIdx + 1}-${endIdx}`);
    }
    
    // Delay between batches to avoid rate limits
    if (batchIndex < totalBatches - 1) {
      await new Promise(r => setTimeout(r, 800));
    }
  }
  
  // ========== CONTINUITY CARRYOVER POST-PROCESSING ==========
  // Apply continuity rules: carry forward unless narration explicitly changes
  console.log(`[VISUAL CONTRACTS] Applying continuity carryover...`);
  
  for (let i = 1; i < allContracts.length; i++) {
    const prev = allContracts[i - 1];
    const curr = allContracts[i];
    const sceneText = scenes[i].text.toLowerCase();
    
    // Initialize continuity if missing
    if (!curr.continuity) {
      curr.continuity = {
        location: curr.location,
        threat_manifestation: curr.supernaturalElement || "unnatural presence",
        main_character: baseCharacter,
        time_of_day: baseTimeOfDay,
        camera_language: "cinematic",
      };
    }
    
    // LOCATION: Carry forward unless scene explicitly mentions a new place
    const locationChangeKeywords = ["moved to", "entered", "walked into", "arrived at", "found themselves in", "stepped into", "went to", "inside the", "outside the"];
    const hasLocationChange = locationChangeKeywords.some(kw => sceneText.includes(kw)) || 
                              (curr.location !== prev.location && curr.location !== baseLocation);
    
    if (!hasLocationChange && prev.continuity?.location) {
      curr.continuity.location = prev.continuity.location;
      // Also update the main location field for consistency
      if (curr.location === baseLocation) {
        curr.location = prev.location;
      }
    }
    
    // THREAT: Carry forward the threat manifestation (shadow, figure, presence)
    if (prev.continuity?.threat_manifestation && !curr.continuity.threat_manifestation) {
      curr.continuity.threat_manifestation = prev.continuity.threat_manifestation;
    }
    
    // TIME OF DAY: Carry forward unless narration mentions time change
    const timeChangeKeywords = ["dawn", "sunrise", "morning", "noon", "afternoon", "dusk", "sunset", "evening", "night", "midnight", "hours later", "next day"];
    const hasTimeChange = timeChangeKeywords.some(kw => sceneText.includes(kw));
    
    if (!hasTimeChange && prev.continuity?.time_of_day) {
      curr.continuity.time_of_day = prev.continuity.time_of_day;
    }
    
    // CHARACTER: Always carry forward (character doesn't change)
    if (prev.continuity?.main_character) {
      curr.continuity.main_character = prev.continuity.main_character;
    }
    
    // CAMERA LANGUAGE: Carry forward for visual consistency
    if (prev.continuity?.camera_language) {
      curr.continuity.camera_language = prev.continuity.camera_language;
    }
  }
  
  // Final validation - count how many have real contracts vs fallbacks
  let realContracts = 0;
  let fallbackContracts = 0;
  allContracts.forEach((c, i) => {
    if (c.actionFrozen && c.actionFrozen.length > 50) {
      realContracts++;
    } else {
      fallbackContracts++;
      console.log(`[VISUAL CONTRACTS] Scene ${i + 1}: Using fallback (no detailed contract)`);
    }
  });
  
  console.log(`[VISUAL CONTRACTS] Final: ${realContracts} detailed contracts, ${fallbackContracts} fallbacks`);
  console.log(`[VISUAL CONTRACTS] Continuity: location="${allContracts[0]?.continuity?.location}", time="${allContracts[0]?.continuity?.time_of_day}"`);
  
  return allContracts;
}

// =====================================================
// GROUP COUNT EXTRACTION (One Too Many preset)
// =====================================================

/**
 * Extract group count from scene text using regex patterns
 * Returns the number mentioned, or null if no count found
 * 
 * v5.2: STRICT PATTERNS ONLY - avoid false positives like "one of us" meaning "someone"
 */
function detectRevealPhase(text: string): boolean {
  const revealPatterns = [
    /count(ed|ing)?\s+\d+/i,                          // "counted 5", "counting five"
    /there\s+(were|was)\s+\d+\s+(faces|figures|people|heads)/i, // "there were 5 faces"
    /\d+\s+(faces|figures|people|heads)\s+(in\s+the|visible)/i, // "5 faces in the photo"
    /photo\s+show(s|ed)?\s+\d+/i,                     // "photo showed 5"
    /(one|1)\s+(extra|more|too\s+many)/i,            // "one extra", "one too many"
    /shouldn'?t\s+(be|have\s+been)\s+\d+/i,          // "shouldn't be 5"
    /extra\s+(person|figure|face|one)/i,             // "extra person"
    /wrong\s+(number|count)/i,                       // "wrong number"
  ];
  
  const lowerText = text.toLowerCase();
  return revealPatterns.some(p => p.test(lowerText));
}

/**
 * Determine if a scene likely depicts a group photo/image viewing
 * These scenes should show the WRONG count (extra person visible)
 */
function isPhotoViewingScene(text: string): boolean {
  const lowerText = text.toLowerCase();
  const photoPatterns = [
    /look(ed|ing)?\s+(at|through)\s+(the\s+)?(photo|picture|image|footage)/i,
    /stared?\s+at\s+(the\s+)?(photo|picture|image|footage)/i,
    /in\s+the\s+(photo|picture|image|footage)/i,
    /the\s+(photo|picture|image|footage)\s+show/i,
    /reviewing?\s+(the\s+)?(photo|picture|footage)/i,
    /check(ed|ing)?\s+(the\s+)?(photo|picture|footage|camera)/i,
  ];
  return photoPatterns.some(p => p.test(lowerText));
}

/**
 * Determine if a scene shows the group physically together
 * (not a photo, but the actual people)
 */
function isGroupTogetherScene(text: string): boolean {
  const lowerText = text.toLowerCase();
  // AVOID: "one of us" as this means "someone among us", not "1 person"
  // AVOID: "the extra one" as this refers to the anomaly
  const groupPatterns = [
    /all\s+(\d+|four|five|six|seven)\s+of\s+us/i,   // "all 4 of us" (strict)
    /the\s+(\d+|four|five|six|seven)\s+of\s+us/i,   // "the 4 of us" (strict)
    /we\s+were\s+all\s+together/i,                   // group together
    /stood\s+together/i,                             // physical grouping
    /gathered\s+(around|together)/i,                 // physical grouping
    /huddled\s+together/i,                           // physical grouping
  ];
  return groupPatterns.some(p => p.test(lowerText));
}

/**
 * Check if scene mentions only IMPLIED presence (shadow, sound, feeling)
 * not a VISIBLE extra person
 */
function isImpliedPresenceOnly(text: string): boolean {
  const lowerText = text.toLowerCase();
  const impliedPatterns = [
    /felt?\s+(like\s+)?(someone|something)\s+(was\s+)?(watch|there|behind)/i,
    /shadow\s+(in|at|near|behind)/i,
    /heard\s+(a\s+)?sound/i,
    /corner\s+of\s+(my|the)\s+eye/i,
    /peripheral\s+vision/i,
    /sense[d]?\s+(someone|something|a\s+presence)/i,
    /couldn'?t\s+shake\s+the\s+feeling/i,
  ];
  
  // If it's photo-viewing, it's NOT implied (it's shown in photo)
  if (isPhotoViewingScene(lowerText)) return false;
  
  return impliedPatterns.some(p => p.test(lowerText));
}

/**
 * Inject group counts into visual contracts based on story DNA counting_horror data
 * 
 * ARCHITECTURE-BASED APPROACH (v5.2):
 * - Uses counting_horror.start_count and wrong_count from DNA (not re-parsed)
 * - Determines reveal_phase_scene_index based on narrative patterns
 * - Before reveal: show start_count people, no uncanny rules
 * - After reveal: show wrong_count people, apply uncanny rules
 * - Implied presence scenes: keep start_count visible, add "implied presence" note
 */
export function injectGroupCountsIntoContracts(
  contracts: SceneVisualContract[],
  scenes: StoryScene[],
  countingHorror?: { start_count: number; wrong_count: number } | null
): SceneVisualContract[] {
  if (!countingHorror) {
    console.log(`[GROUP COUNT] No counting_horror data - skipping group count injection`);
    return contracts;
  }
  
  const { start_count, wrong_count } = countingHorror;
  console.log(`[GROUP COUNT] Architecture-based injection: expected=${start_count}, wrong=${wrong_count}`);
  
  // STEP 1: Determine the reveal scene index (first scene where extra is VISIBLE)
  let revealSceneIndex = -1;
  for (let i = 0; i < scenes.length; i++) {
    const text = scenes[i]?.text || "";
    if (detectRevealPhase(text) || isPhotoViewingScene(text)) {
      revealSceneIndex = i;
      console.log(`[GROUP COUNT] Reveal detected at scene ${i + 1}: "${text.substring(0, 60)}..."`);
      break;
    }
  }
  
  // SAFE FALLBACK: If no clear reveal found, default to 65% through story
  // This ensures photos/footage ALWAYS force wrong_count regardless
  if (revealSceneIndex === -1) {
    revealSceneIndex = Math.floor(scenes.length * 0.65);
    console.log(`[GROUP COUNT] ⚠️ No explicit reveal found - defaulting to scene ${revealSceneIndex + 1} (65% mark)`);
  }
  
  // STEP 2: Inject counts based on position relative to reveal
  for (let i = 0; i < contracts.length; i++) {
    const sceneText = scenes[i]?.text || "";
    const isBeforeReveal = i < revealSceneIndex;
    const isRevealOrAfter = i >= revealSceneIndex;
    const isPhoto = isPhotoViewingScene(sceneText);
    const isGroupScene = isGroupTogetherScene(sceneText);
    const isImplied = isImpliedPresenceOnly(sceneText);
    
    // Skip scenes that don't need group count enforcement
    if (!isPhoto && !isGroupScene && !isImplied) {
      // Only inject for scenes that actually show or imply groups
      continue;
    }
    
    if (isImplied && isBeforeReveal) {
      // BEFORE REVEAL + IMPLIED: Show EXACTLY start_count, NO human silhouettes
      // Implied presence must be abstract (shadow distortion, not a person shape)
      contracts[i].group_count = {
        expected: start_count,
        is_wrong: false,
        extra_person_rules: [
          `EXACTLY ${start_count} human figures visible. No more.`,
          "IMPLIED presence ONLY: shadow distortion, light anomaly, or motion blur.",
          "NO full head/torso outline, NO face, NO complete body shape.",
          "The presence is felt, not seen as a human form.",
        ].join(" "),
      };
      console.log(`[GROUP COUNT] Scene ${i + 1}: count=${start_count}, is_wrong=false (implied presence, NO human silhouette)`);
      
    } else if (isPhoto) {
      // PHOTO SCENES: ALWAYS show wrong count regardless of reveal position
      // Photos reveal the truth - this is the core horror mechanic
      contracts[i].group_count = {
        expected: wrong_count,
        is_wrong: true,
        extra_person_rules: "One figure in the photo is subtly wrong - posture off, standing too close to others, eyes fixed on camera while others look away. NOT monstrous or supernatural-looking.",
      };
      console.log(`[GROUP COUNT] Scene ${i + 1}: count=${wrong_count}, is_wrong=true (photo ALWAYS shows wrong count)`);
      
    } else if (isGroupScene && isBeforeReveal) {
      // GROUP SCENE BEFORE REVEAL: Show correct count, no uncanny
      contracts[i].group_count = {
        expected: start_count,
        is_wrong: false,
        extra_person_rules: undefined, // No uncanny rules before reveal
      };
      console.log(`[GROUP COUNT] Scene ${i + 1}: count=${start_count}, is_wrong=false (group scene, before reveal)`);
      
    } else if (isGroupScene && isRevealOrAfter) {
      // GROUP SCENE AFTER REVEAL: Show wrong count with uncanny
      contracts[i].group_count = {
        expected: wrong_count,
        is_wrong: true,
        extra_person_rules: "One figure is subtly wrong - posture off, smile frozen, eyes fixed on camera. NOT monstrous or supernatural-looking.",
      };
      console.log(`[GROUP COUNT] Scene ${i + 1}: count=${wrong_count}, is_wrong=true (group scene, after reveal)`);
    }
  }
  
  return contracts;
}

/**
 * Create visual contracts for a batch of scenes
 * Uses enhanced prompt to prevent abstraction/compression on later scenes
 * NOW includes surrounding context so AI understands split sentences
 * v5.1: Includes continuity carryover context from previous batch
 */
async function createVisualContractsBatch(
  openaiKey: string,
  scenes: StoryScene[],
  storyAnchor: StoryAnchor,
  visualBeats: VisualBeat[],
  startIndex: number,
  totalScenes: number,
  allScenes?: StoryScene[], // Pass all scenes for context
  previousContinuity?: {     // v5.1: Continuity from previous batch
    location?: string;
    threat_manifestation?: string;
    main_character?: string | null;
    time_of_day?: string;
    camera_language?: string;
  }
): Promise<SceneVisualContract[]> {
  // Helper: detect if text contains specific content types
  const detectContentType = (text: string, fullContext: string): string[] => {
    const hints: string[] = [];
    const combined = `${text} ${fullContext}`.toLowerCase();
    
    // Date patterns: years, months, specific dates
    const datePatterns = [
      /\b(19|20)\d{2}\b/, // Years like 1946, 2024
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
      /\b(spring|summer|fall|autumn|winter)\s+(of\s+)?(19|20)\d{2}\b/i,
      /\b(early|late|mid)[\s-]?(19|20)\d{2}\b/i,
      /\b\d{1,2}(st|nd|rd|th)\s+of\s+\w+/i, // "3rd of March"
    ];
    if (datePatterns.some(p => p.test(combined))) {
      hints.push("🗓️ DATE DETECTED → Show: vintage calendar page, dated newspaper clipping, era-appropriate technology, or clock");
    }
    
    // Location patterns: states, cities, geographical references
    const locationPatterns = [
      /\b(wisconsin|minnesota|michigan|ohio|illinois|iowa|indiana|texas|california|oregon|maine|florida|new\s+york|pennsylvania)\b/i,
      /\brural\s+\w+\b/i, // "rural Wisconsin"
      /\b(town|city|village|county)\s+of\s+\w+/i,
      /\b(small\s+town|remote\s+town|isolated\s+town)\b/i,
      /\b(lake|river|forest|mountain|hill)\s+\w+\b/i, // Named places
    ];
    if (locationPatterns.some(p => p.test(combined))) {
      hints.push("📍 LOCATION DETECTED → Show: welcome sign, state road sign, map with location marked, or regional landmark");
    }
    
    // Investigation patterns
    const investigationPatterns = [
      /\b(investigation|investigate|detective|police|sheriff|authority|authorities)\b/i,
      /\b(file|files|report|reports|case|cases|evidence)\b/i,
      /\b(halted|suppressed|covered[\s-]?up|classified)\b/i,
    ];
    if (investigationPatterns.some(p => p.test(combined))) {
      hints.push("🔍 INVESTIGATION DETECTED → Show: police file, detective's desk, evidence board, or official documents");
    }
    
    // Disappearance patterns  
    const disappearancePatterns = [
      /\b(vanish|vanished|disappear|disappeared|missing|gone)\b/i,
      /\b(without\s+a?\s*trace|never\s+found|never\s+seen)\b/i,
    ];
    if (disappearancePatterns.some(p => p.test(combined))) {
      hints.push("👻 DISAPPEARANCE DETECTED → Show: empty chair, abandoned belongings, missing person poster, or vacant space");
    }
    
    // Witness/testimony patterns
    const witnessPatterns = [
      /\b(witness|witnesses|testimony|testified|claimed|reported|sighting|sightings)\b/i,
      /\b(locals?\s+(say|claim|report)|people\s+claim)\b/i,
    ];
    if (witnessPatterns.some(p => p.test(combined))) {
      hints.push("🗣️ WITNESS/TESTIMONY DETECTED → Show: interview setting, tape recorder, person's face recounting, or group gathered");
    }
    
    return hints;
  };

  // Build scene data WITH surrounding context
  const sceneData = scenes.map((s, i) => {
    const globalIdx = startIndex + i;
    
    // Get surrounding scene text for context (the full sentence might be split across scenes)
    let prevContext = "";
    let nextContext = "";
    
    if (allScenes) {
      // Get up to 2 previous scenes for context
      if (globalIdx > 0) {
        prevContext = allScenes.slice(Math.max(0, globalIdx - 2), globalIdx)
          .map(sc => sc.text).join(" ");
      }
      // Get up to 2 next scenes for context  
      if (globalIdx < allScenes.length - 1) {
        nextContext = allScenes.slice(globalIdx + 1, Math.min(allScenes.length, globalIdx + 3))
          .map(sc => sc.text).join(" ");
      }
    }
    
    const fullContext = `${prevContext} [THIS SCENE: ${s.text}] ${nextContext}`.trim();
    const contentHints = detectContentType(s.text, fullContext);
    
    return {
      globalIndex: globalIdx,
      text: s.text,
      fullContext,
      contentHints,
      beat: visualBeats[i]?.visualBeat || "atmospheric moment",
      mood: visualBeats[i]?.moodLevel || 5
    };
  });
  
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a CREATIVE storyboard artist converting story scenes into VISUALLY INTERESTING frames.

🔒 CRITICAL GLOBAL OVERRIDE:
You MUST treat EVERY scene as a first-time image generation.
EVERY scene must have FULL, DETAILED visual specifications.
BE CREATIVE - don't always default to the same visual approach!

⚠️ ANTI-REPETITION RULE:
If I flag specific content (dates, locations, etc.) - you MUST visualize that content!
Do NOT default to "foggy atmosphere" when the narration mentions specific things.

ENVIRONMENT CONTEXT:
${storyAnchor.environment}
${storyAnchor.characterDescription ? `CHARACTER: ${storyAnchor.characterDescription}` : ""}

YOUR JOB: Convert each scene into a single FROZEN visual frame. Be CREATIVE with HOW you visualize concepts.

═══════════════════════════════════════
🎨 CONTENT-SPECIFIC VISUALS (MANDATORY when detected!)
═══════════════════════════════════════
When narration mentions specific content, you MUST show it visually:

📅 DATES/TIME PERIODS (e.g., "March 1946", "winter of 1972"):
→ REQUIRED: Show the date/era visually!
• vintage calendar page with month/year visible
• old newspaper with date in masthead  
• dated photograph corner
• era-specific car/TV/radio/phone
• clock with specific time
• weathered datebook or diary

🗺️ LOCATIONS/GEOGRAPHY (e.g., "rural Wisconsin", "Black Lake"):
→ REQUIRED: Show the location identifier!
• weathered "Welcome to [State]" road sign
• bent/worn state highway sign
• map spread on table with pin/circle
• faded postcard of the area
• regional landmark silhouette
• old license plate from state

📁 INVESTIGATIONS/AUTHORITIES:
→ REQUIRED: Show official elements!
• manila folder with CLASSIFIED stamp
• detective desk with lamp and papers
• cork board with photos and string
• police station interior
• filing cabinet drawer
• typed official report

👥 WITNESSES/SIGHTINGS:
→ REQUIRED: Show testimony context!
• person's face in interview lighting
• tape recorder reels turning
• notepad with scribbled notes
• silhouette gesturing/pointing
• group huddled in conversation
• telephone receiver

💀 DISAPPEARANCE/MISSING:
→ REQUIRED: Show absence evidence!
• empty chair with jacket draped
• abandoned shoes by door
• untouched meal on table
• faded missing person flyer
• empty bed with sheets disturbed
• door left slightly ajar

🎬 CAMERA VARIETY (Mix it up!):
• extreme close-up (eyes, hands, object detail)
• dutch angle (unease)
• low angle (intimidating)
• high angle (vulnerable)
• over-shoulder
• POV shot
• silhouette against light
• reflection in surface

⚠️ SPLIT SENTENCE HANDLING:
Narration is often SPLIT across scenes. I provide CONTEXT (prev/next scenes).
Understand the FULL MEANING and create a visual for the COMPLETE IDEA.

═══════════════════════════════════════

For EACH scene, return a contract with these fields:
{
  "sceneIndex": GLOBAL_SCENE_NUMBER (exact number I give you),
  "location": "SPECIFIC physical place",
  "characterPose": "body position and action",
  "facialExpression": "visible emotion",
  "visibleObjects": ["object1", "object2", "object3"] - at least 3 RELEVANT items,
  "supernaturalElement": "the horror visual (or null)",
  "cameraDistance": "close-up" | "medium" | "wide" | "extreme-close-up" | "POV",
  "lightingSource": "specific light source",
  "actionFrozen": "DETAILED description (20+ words) - be CREATIVE!",
  "forbiddenElements": ["text", "words", "extra people"],
  "continuityFromPrev": "what must match previous",
  "evidenceRule": "how this visual represents the narration"
}

RULES:
1. sceneIndex MUST match the GLOBAL scene number
2. actionFrozen MUST be at least 20 words
3. BE CREATIVE - vary camera angles, object choices, and visual approaches
4. Don't always show landscapes - show SPECIFIC objects, details, perspectives
5. CONTINUITY: Unless narration explicitly changes it, maintain the same location/time/threat

Return JSON: {"contracts": [...]}`,
        },
        {
          role: "user",
          content: `Convert these ${scenes.length} scenes to DETAILED visual contracts.
USE THE EXACT GLOBAL SCENE INDICES I PROVIDE:

${previousContinuity ? `
═══════════════════════════════════════
🔗 CONTINUITY FROM PREVIOUS SCENES (carry forward unless narration changes!):
═══════════════════════════════════════
Location: ${previousContinuity.location || "not established"}
Time of Day: ${previousContinuity.time_of_day || "night"}
Threat Manifestation: ${previousContinuity.threat_manifestation || "unnatural presence"}
${previousContinuity.main_character ? `Main Character: ${previousContinuity.main_character}` : ""}
Camera Language: ${previousContinuity.camera_language || "cinematic"}

⚠️ CRITICAL: Do NOT reset to generic "dark room / fog / shadow" unless narration EXPLICITLY moves to a new location!
═══════════════════════════════════════
` : ""}

${sceneData.map(s => {
  const hintsBlock = s.contentHints.length > 0 
    ? `\n⚠️ CONTENT DETECTED - MUST USE APPROPRIATE VISUAL:\n${s.contentHints.join("\n")}`
    : "";
  
  return `=== SCENE ${s.globalIndex + 1} of ${totalScenes} (USE sceneIndex: ${s.globalIndex}) ===
Mood: ${s.mood}/10

THIS SCENE'S NARRATION: "${s.text}"

FULL CONTEXT (to understand split sentences):
${s.fullContext}

Visual Beat: ${s.beat}${hintsBlock}`;
}).join("\n\n")}

Remember: sceneIndex values must be ${sceneData.map(s => s.globalIndex).join(", ")} respectively.

🎯 CRITICAL RULES:
1. If DATE/YEAR is mentioned → Show calendar, newspaper date, or era-appropriate item - NOT just atmosphere!
2. If LOCATION/STATE is mentioned → Show welcome sign, map, or regional identifier - NOT just landscape!
3. If DISAPPEARANCE is mentioned → Show empty chair, abandoned items, or missing poster - NOT just fog!
4. BE SPECIFIC and CREATIVE - avoid defaulting to "atmospheric fog" for everything!
5. MAINTAIN CONTINUITY: Keep the same location/threat/character unless the narration explicitly says otherwise!`,
        },
      ],
      temperature: 0.7, // Higher for more creative visual variety
      response_format: { type: "json_object" },
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create visual contracts: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  const contracts = parsed.contracts || parsed.scenes || (Array.isArray(parsed) ? parsed : []);
  
  console.log(`[VISUAL CONTRACTS] Batch returned ${contracts.length} contracts for scenes ${startIndex + 1}-${startIndex + scenes.length}`);
  
  // Log what we got back
  contracts.forEach((c: any) => {
    console.log(`[VISUAL CONTRACTS] Raw: sceneIndex=${c.sceneIndex}, location="${c.location}", actionFrozen="${c.actionFrozen?.substring(0, 50)}..."`);
  });
  
  return contracts;
}

// =====================================================
// DALL-E PROMPT BUILDING
// =====================================================

/**
 * Sanitize prompt for uncanny-illustrated art style (Editorial Cartoon VHS)
 * Removes ALL camera/cinematic/painterly vocabulary and replaces with cartoon terms
 * 
 * This is a FINAL PASS sanitizer applied to the complete prompt before sending to DALL-E
 * v5.2: Expanded to remove painterly/film noir/realistic terms for true cartoon look
 */
function sanitizePromptForUncannyIllustrated(prompt: string): string {
  // Camera/shot terminology → framing terminology
  const cameraReplacements: [RegExp, string][] = [
    // Camera: → Framing:
    [/\bCamera:\s*/gi, "Framing: "],
    // Shot types → framing types
    [/\bwide\s+shot\b/gi, "wide framing"],
    [/\bmedium\s+shot\b/gi, "medium framing"],
    [/\bclose[\s-]?up\s*(shot)?\b/gi, "close framing"],
    [/\bextreme\s+close[\s-]?up\b/gi, "extreme close framing"],
    [/\bfull\s+shot\b/gi, "full figure framing"],
    [/\bestablishing\s+shot\b/gi, "establishing view"],
    [/\baerial\s+shot\b/gi, "overhead view"],
    [/\bPOV\s*(shot)?\b/gi, "first-person view"],
    [/\bpoint[\s-]of[\s-]view\s*(shot)?\b/gi, "first-person view"],
    // Angle terminology
    [/\blow\s+angle\b/gi, "low viewpoint"],
    [/\bhigh\s+angle\b/gi, "high viewpoint"],
    [/\bdutch\s+angle\b/gi, "tilted viewpoint"],
    [/\bcanted\s+angle\b/gi, "tilted viewpoint"],
    [/\bover[\s-]the[\s-]shoulder\b/gi, "behind-subject view"],
    [/\btwo[\s-]shot\b/gi, "two-figure composition"],
    // Camera equipment references
    [/\bcamera\s+language\b/gi, "visual composition"],
    [/\bcamera\s+angle\b/gi, "viewpoint"],
    [/\bcamera\s+movement\b/gi, "visual flow"],
    [/\bcamera\s+distance\b/gi, "subject distance"],
  ];
  
  // Lighting terminology → illustration lighting
  const lightingReplacements: [RegExp, string][] = [
    [/\bfilm\s+noir\s+lighting\b/gi, "dramatic shadow illustration"],
    [/\bnoir\s+lighting\b/gi, "high contrast shadows"],
    [/\blow[\s-]key\s+(dramatic\s+)?lighting\b/gi, "dark cel-shaded lighting"],
    [/\bcinematic\s+lighting\b/gi, "dramatic illustration lighting"],
    [/\bprofessional\s+lighting\b/gi, "bold shadow contrast"],
    [/\bstudio\s+lighting\b/gi, "flat cartoon lighting"],
    [/\bnatural\s+lighting\b/gi, "simple ambient light"],
    [/\brealistic\s+lighting\b/gi, "flat illustration lighting"],
  ];
  
  // Texture terminology → illustration textures
  const textureReplacements: [RegExp, string][] = [
    [/\bfilm[\s_]grain\b/gi, "halftone texture"],
    [/\bvignette[\s_]heavy\b/gi, "paper grain vignette"],
    [/\bfog[\s_]bloom\b/gi, "soft glow effect"],
    [/\bdust[\s_]scratches\b/gi, "analog noise"],
    [/\bTextures:\s*film\s+grain/gi, "Textures: halftone, analog noise"],
  ];
  
  // Terms to REMOVE entirely (cinematic, painterly, photographic)
  const termsToRemove = [
    // Cinematic terms
    /\bcinematic\b/gi,
    /\bcinematography\b/gi,
    /\bcinematographer\b/gi,
    /\bfilm\s+still\b/gi,
    /\bmovie\s+screenshot\b/gi,
    /\bmovie\s+still\b/gi,
    /\bprofessional\s+cinematography\b/gi,
    /\bcinematic\s+dark\s+photography\b/gi,
    /\bfilm\s+noir\b/gi, // standalone "film noir"
    // Photography terms
    /\bDSLR\b/gi,
    /\bcamera\s+lens\b/gi,
    /\bphotography\b/gi,
    /\bphotographic\b/gi,
    /\bphoto[-\s]?realistic\b/gi,
    /\bphotorealism\b/gi,
    /\bphotograph\b/gi,
    /\bbokeh\b/gi,
    /\bdepth\s+of\s+field\b/gi,
    /\blens\s+flare\b/gi,
    /\brealistic\s+skin\s+texture\b/gi,
    /\brealistic\s+skin\s+pores\b/gi,
    /\bportrait\s+photography\b/gi,
    // Painterly terms (we want cartoon, not painting)
    /\bpainterly\s+realism\b/gi,
    /\bpainterly\b/gi,
    /\boil\s+painting\b/gi,
    /\bwatercolor\b/gi,
    /\bdigital\s+painting\b/gi,
    /\bsoft\s+brush\s+texture\b/gi,
    /\bsoft\s+brush\b/gi,
    /\bairbrushed\b/gi,
    /\bsmooth\s+blending\b/gi,
    /\bsemi[-\s]realistic\b/gi,
    // Realism terms
    /\bhyper[-\s]?realistic\b/gi,
    /\bhyper[-\s]?detailed\b/gi,
    // GREEN COLOR TERMS (v5.4 - aggressive anti-green)
    /\bsickly[\s_]?green\b/gi,
    /\bolive[\s_]?(tint|tone|cast)?\b/gi,
    /\bgreen[\s_]?(cast|tint|wash|tone)\b/gi,
    /\bteal[\s_]?green\b/gi,
    /\bforest[\s_]?green\b/gi,
    /\bmoss[\s_]?green\b/gi,
    /\byellow[\s_]?green\b/gi,
    /\bgreenish\b/gi,
    /\bdeep[\s_]shadow[\s_]contrast\b/gi,  // Visual DNA term that causes green
    /\blow[\s_]key[\s_]shadow\b/gi,        // Visual DNA term  
    /\bcinematic[\s_]dark\b/gi,            // Visual DNA term
    /\bblue[\s_]black[\s_]void\b/gi,       // Visual DNA palette term
  ];
  
  let sanitized = prompt;
  
  // Apply camera replacements
  for (const [pattern, replacement] of cameraReplacements) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  
  // Apply lighting replacements
  for (const [pattern, replacement] of lightingReplacements) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  
  // Apply texture replacements
  for (const [pattern, replacement] of textureReplacements) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  
  // ========== SMART TERM REMOVAL (v5.5) ==========
  // Instead of just removing terms and leaving orphans, we remove the whole "NO X" or "NOT X" pattern
  
  // First, remove "NO <term>" and "NOT <term>" patterns completely
  const termStrings = [
    "cinematic", "cinematography", "cinematographer", "film still", "movie screenshot",
    "movie still", "professional cinematography", "cinematic dark photography", "film noir",
    "DSLR", "camera lens", "photography", "photographic", "photo-realistic", "photorealism",
    "photograph", "bokeh", "depth of field", "lens flare", "realistic skin texture",
    "realistic skin pores", "portrait photography", "painterly realism", "painterly",
    "oil painting", "watercolor", "digital painting", "soft brush texture", "soft brush",
    "airbrushed", "smooth blending", "semi-realistic", "hyper-realistic", "hyper-detailed",
    "sickly green", "olive", "olive tint", "green cast", "green tint", "green wash",
    "teal green", "teal-green", "forest green", "moss green", "yellow-green", "greenish",
    "deep shadow contrast", "low key shadow", "cinematic dark", "blue black void",
    "camera", "lens", "professional", "4K", "high definition", "portrait"
  ];
  
  // Remove "NO <term>" patterns
  for (const term of termStrings) {
    const noPattern = new RegExp(`\\bNO\\s+${term.replace(/[-\s]/g, '[-\\s]?')}\\b`, 'gi');
    sanitized = sanitized.replace(noPattern, "");
  }
  
  // Remove "NOT <term>" patterns  
  for (const term of termStrings) {
    const notPattern = new RegExp(`\\bNOT\\s+${term.replace(/[-\s]/g, '[-\\s]?')}\\b`, 'gi');
    sanitized = sanitized.replace(notPattern, "");
  }
  
  // Now remove remaining standalone banned terms
  for (const pattern of termsToRemove) {
    sanitized = sanitized.replace(pattern, " ");
  }
  
  // ========== THOROUGH CLEANUP (v5.6 - smarter orphan detection) ==========
  // CRITICAL: Only remove truly ORPHANED "NO" and "NOT" tokens
  // DO NOT remove legitimate phrases like "no gradients", "no text", etc.
  
  // Pattern: "NO" followed by comma (orphaned - no term after it)
  // e.g., "NO, something" → ", something"
  sanitized = sanitized.replace(/\bNO\s*,(?!\s*[a-z])/gi, ",");
  
  // Pattern: "NOT" followed by comma (orphaned)
  sanitized = sanitized.replace(/\bNOT\s*,(?!\s*[a-z])/gi, ",");
  
  // Pattern: comma then "NO" then comma or end (truly orphaned)
  // e.g., ", NO," or ", NO." but NOT ", no gradients"
  sanitized = sanitized.replace(/,\s*NO\s*(?=[,\.\s]*$|[,\.])/gi, ",");
  sanitized = sanitized.replace(/,\s*NOT\s*(?=[,\.\s]*$|[,\.])/gi, ",");
  
  // Remove sequences of "NO, NO" or "NOT, NOT" (garbled artifacts)
  sanitized = sanitized.replace(/(\bNO\s*,?\s*){2,}/gi, "");
  sanitized = sanitized.replace(/(\bNOT\s*,?\s*){2,}/gi, "");
  
  // Remove "NO" or "NOT" alone on a line
  sanitized = sanitized.replace(/^\s*NO\s*$/gim, "");
  sanitized = sanitized.replace(/^\s*NOT\s*$/gim, "");
  
  // Remove "NO" or "NOT" at start of line followed by comma (orphaned)
  sanitized = sanitized.replace(/^\s*NO\s*,\s*/gim, "");
  sanitized = sanitized.replace(/^\s*NOT\s*,\s*/gim, "");
  
  // Remove "NO" or "NOT" followed by period (orphaned at end of sentence)
  // But NOT "no text." which is valid
  sanitized = sanitized.replace(/\bNO\s+NO\s*\./gi, ".");  // "NO NO." → "."
  sanitized = sanitized.replace(/\bNOT\s+NOT\s*\./gi, ".");  // "NOT NOT." → "."
  
  // Clean up consecutive commas (,, or , , ,)
  sanitized = sanitized.replace(/,(\s*,)+/g, ",");
  
  // Clean up comma followed by period
  sanitized = sanitized.replace(/,\s*\./g, ".");
  
  // Clean up leading commas on lines
  sanitized = sanitized.replace(/^\s*,\s*/gm, "");
  
  // Clean up trailing commas on lines
  sanitized = sanitized.replace(/,\s*$/gm, "");
  
  // Clean up space before comma
  sanitized = sanitized.replace(/\s+,/g, ",");
  
  // Clean up double+ spaces
  sanitized = sanitized.replace(/\s{2,}/g, " ");
  
  // Clean up "and and" or "with with" patterns
  sanitized = sanitized.replace(/\b(and|with|or)\s+\1\b/gi, "$1");
  
  // Final trim
  sanitized = sanitized.trim();
  
  return sanitized;
}

/**
 * Sanitize camera angles to be portrait-safe
 * Replaces landscape-implying terms with vertical equivalents
 */
function sanitizeCameraAngleForPortrait(cameraAngle: string): string {
  const replacements: [RegExp, string][] = [
    [/\bwide\s*(establishing)?\s*shot\b/gi, "tall vertical establishing shot"],
    [/\bpanoramic\b/gi, "vertically framed"],
    [/\bhorizontal\b/gi, "vertical"],
    [/\blandscape\b/gi, "portrait"],
    [/\bside[\s-]scrolling\b/gi, "vertical scrolling"],
    [/\bwide\s*angle\b/gi, "tall vertical angle"],
    [/\bfull\s*scene\s*visible\b/gi, "full vertical scene visible"],
  ];
  
  let sanitized = cameraAngle;
  for (const [pattern, replacement] of replacements) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  
  return sanitized;
}

/**
 * Build Character Lock block for prompt
 * v5.6: Handle GROUP scenarios with simplified description
 */
function buildCharacterLockBlock(anchor: StoryAnchor): string {
  // Use new structured characterLock if available
  if (anchor.characterLock) {
    const lock = anchor.characterLock;
    
    // GROUP MODE: Use simplified block with full description
    if (lock.isGroup) {
      const lines = [
        `CHARACTER LOCK (ID: ${lock.id}):`,
        `GROUP: ${lock.groupDescription || "Multiple characters as described in story"}`,
        `Style: Keep character appearances consistent throughout.`,
      ];
      return lines.join("\n");
    }
    
    // SINGLE CHARACTER MODE: Use detailed extraction
    const lines = [
      `CHARACTER LOCK (ID: ${lock.id}):`,
      `Face: ${lock.face}`,
      `Outfit: ${lock.outfit}`,
      `Build: ${lock.silhouette}`,
    ];
    if (lock.doNotChange && lock.doNotChange.length > 0) {
      lines.push(`DO NOT CHANGE: ${lock.doNotChange.join(", ")}`);
    }
    return lines.join("\n");
  }
  
  // Fallback to legacy characterDescription
  if (anchor.characterDescription) {
    return `CHARACTER LOCK:\n${anchor.characterDescription}\nKeep this character's appearance exactly the same in every scene.`;
  }
  
  return "";
}

/**
 * Build the final DALL-E prompt using UNIFIED TEMPLATE
 * 
 * PROMPT STRUCTURE (in order of DALL-E priority):
 * 1. ORIENTATION + COMPOSITION LOCK (fixed)
 * 2. STYLE LOCK (fixed per job) - or Visual DNA style if available
 * 3. CHARACTER LOCK (fixed per job)
 * 4. SCENE VISUAL CONTRACT (literal frame requirements)
 * 5. AVOID LIST (fixed)
 * 
 * MAX LENGTH: ~2500 chars for stability
 * 
 * v5.0: Now accepts Visual DNA for deterministic style mapping
 * v5.2: Art style protection - uncanny-illustrated cannot be overridden by Visual DNA
 */
export function buildFinalDallePrompt(
  storyAnchor: StoryAnchor,
  beat: VisualBeat,
  sceneIndex: number,
  totalScenes: number,
  styleConfig: { name: string; negativePrompt?: string; basePrompt?: string; colorOverride?: string; technicalStyle?: string },
  isCustomStyle: boolean = false,
  visualPreset: string = "forest",
  visualDNA?: VisualDNA | null,
  artStyleOverride?: string // NEW: explicit art style to enforce
): string {
  const moodLevel = Math.max(1, Math.min(10, Math.round(beat.moodLevel)));
  const sanitizedCameraAngle = sanitizeCameraAngleForPortrait(beat.cameraAngle);
  const contract = beat.visualContract;
  
  // ========== ART STYLE PROTECTION ==========
  // When artStyleOverride is 'uncanny-illustrated', the art_style basePrompt
  // takes ABSOLUTE priority over Visual DNA. This prevents photographic
  // Visual DNA from contaminating illustrated horror styles.
  const isUncannyIllustrated = artStyleOverride === 'uncanny-illustrated';
  
  // ========== BUILD VISUAL DNA STYLE (if available) ==========
  let visualDNAStyleBlock = "";
  if (visualDNA && !isUncannyIllustrated) {
    // Only use Visual DNA when NOT in uncanny-illustrated mode
    const styleMap: Record<string, string> = {
      "VHS_degraded": "grainy VHS aesthetic with analog video distortion and worn tape quality",
      "cinematic_dark": "cinematic dark photography with film noir lighting and professional cinematography",
      "cinematic_minimal": "minimalist cinematography with clean compositions and subtle lighting",
      "documentary_archival": "documentary archival style with authentic period look",
      "surveillance_footage": "security camera surveillance footage aesthetic with fixed angle",
      "found_footage": "found footage style with amateur video quality",
      "polaroid_faded": "faded polaroid aesthetic with vintage photograph quality",
    };
    
    const paletteMap: Record<string, string> = {
      "cold_desaturated": "cold desaturated colors with muted tones",
      "sickly_green": "sickly green color cast with nauseous grading",
      "muted_gray": "muted gray tones with washed out colors",
      "deep_shadow_contrast": "deep rich shadows with high contrast blacks",
      "monochrome_harsh": "harsh stark monochrome black and white",
      "amber_decay": "amber decay tones with aged sepia hints",
      "blue_black_void": "blue-black void colors with deep indigo shadows",
    };
    
    const lightingMap: Record<string, string> = {
      "moonlit_fog": "moonlit foggy atmosphere with diffused silver light",
      "fluorescent_flat": "harsh fluorescent institutional lighting",
      "low_key_shadow": "low-key dramatic lighting with deep shadows",
      "blown_highlights": "blown out highlights with harsh contrast",
      "single_source_harsh": "single harsh light source creating dramatic shadows",
      "twilight_amber": "twilight amber glow fading into darkness",
      "deep_darkness": "deep overwhelming darkness with minimal light",
    };
    
    const compositionMap: Record<string, string> = {
      "centered_void": "centered composition surrounded by empty void",
      "rule_of_thirds": "classic rule of thirds balanced composition",
      "off_balance": "deliberately off-balance unsettling framing",
      "deep_space": "deep space composition with layered depth",
      "claustrophobic": "claustrophobic tight framing with no escape",
      "negative_space_heavy": "heavy negative space with isolated subject",
    };
    
    visualDNAStyleBlock = [
      "VISUAL DNA STYLE:",
      styleMap[visualDNA.visual_style] || visualDNA.visual_style,
      paletteMap[visualDNA.color_palette] || visualDNA.color_palette,
      lightingMap[visualDNA.lighting_profile] || visualDNA.lighting_profile,
      compositionMap[visualDNA.frame_composition] || visualDNA.frame_composition,
      visualDNA.texture_artifacts.length > 0 
        ? `Textures: ${visualDNA.texture_artifacts.map(a => a.replace(/_/g, ' ')).join(', ')}`
        : "",
    ].filter(Boolean).join("\n");
    
    console.log(`[DALLE-PROMPT] Using Visual DNA: ${visualDNA.visual_style} / ${visualDNA.color_palette}`);
  } else if (visualDNA && isUncannyIllustrated) {
    // UNCANNY ILLUSTRATED MODE: Visual DNA is OVERRIDDEN
    // Extract only safe components (composition, some lighting) and replace style
    console.log(`[DALLE-PROMPT] ⚠️ UNCANNY-ILLUSTRATED OVERRIDE: Suppressing ALL Visual DNA (style="${visualDNA.visual_style}", palette="${visualDNA.color_palette}", lighting="${visualDNA.lighting_profile}")`);
  }
  
  // ========== BUILD STYLE BLOCK ==========
  let styleBlock: string;
  
  if (isUncannyIllustrated) {
    // UNCANNY ILLUSTRATED: Use styleConfig.basePrompt ALWAYS, ignore Visual DNA completely
    // NOTE: Do NOT use "NO X" patterns here - they get mangled by sanitization
    // Instead, use positive statements only. Bans go in AVOID block.
    styleBlock = [
      "ILLUSTRATION STYLE LOCK (MANDATORY):",
      styleConfig.basePrompt || UNCANNY_ILLUSTRATED_STYLE_REPLACEMENT.join(", "),
      styleConfig.colorOverride ? `Colors: ${styleConfig.colorOverride}` : "",
      styleConfig.technicalStyle ? `Technique: ${styleConfig.technicalStyle}` : "",
    ].filter(Boolean).join("\n");
    console.log(`[DALLE-PROMPT] ✅ UNCANNY-ILLUSTRATED style enforced, Visual DNA FULLY suppressed`);
  } else if (visualDNAStyleBlock) {
    // Visual DNA takes priority (normal mode)
    styleBlock = visualDNAStyleBlock;
  } else if (isCustomStyle && styleConfig.basePrompt) {
    styleBlock = [
      styleConfig.basePrompt,
      styleConfig.colorOverride ? `Colors: ${styleConfig.colorOverride}` : "",
      styleConfig.technicalStyle ? `Technique: ${styleConfig.technicalStyle}` : "",
    ].filter(Boolean).join("\n");
  } else {
    styleBlock = `${styleConfig.name} style. ${storyAnchor.fullAnchorPrompt}`;
  }
  
  // ========== BUILD CHARACTER LOCK ==========
  const characterBlock = buildCharacterLockBlock(storyAnchor);
  
  // ========== BUILD SCENE CONTRACT (MUST/MUST NOT FORMAT) ==========
  let sceneBlock: string;
  
  if (contract) {
    // USE VISUAL CONTRACT with MUST/MUST NOT format (high impact for DALL-E)
    const mustShowItems = [
      `- Location: ${contract.location}`,
      `- Person: ${contract.characterPose}, ${contract.facialExpression}`,
      ...(contract.visibleObjects?.map(o => `- ${o}`) || []),
      contract.supernaturalElement ? `- Supernatural: ${contract.supernaturalElement}` : "",
    ].filter(Boolean);
    
    // Get forbidden items from contract, with fallback defaults
    let mustNotItems = contract.forbiddenElements?.length > 0
      ? contract.forbiddenElements
      : ["stairs", "hallway", "extra people"];
    
    // CRITICAL: Remove items from MUST NOT if they appear in MUST SHOW
    // This prevents contradictions like "MUST SHOW: mirror" + "MUST NOT SHOW: mirrors"
    // Uses normalized tokens to handle plurals and variations
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    
    const mustShowNorm = normalize(mustShowItems.join(" "));
    
    mustNotItems = mustNotItems.filter(item => {
      const norm = normalize(item);
      // Split "mirrors, reflections" into tokens and block if any token appears in mustShow
      const tokens = norm.split(/\s+/).filter(Boolean);
      const conflict = tokens.some(t => {
        // Check both the token and its singular/plural form
        const singular = t.endsWith('s') ? t.slice(0, -1) : t;
        const plural = t.endsWith('s') ? t : t + 's';
        return mustShowNorm.includes(t) || 
               mustShowNorm.includes(singular) || 
               mustShowNorm.includes(plural);
      });
      if (conflict) {
        console.log(`[PROMPT] Removing "${item}" from MUST NOT (conflicts with MUST SHOW)`);
        return false;
      }
      return true;
    });
    
    const compositionHint = beat.compositionHint || "";
    
    // v5.14: Use Visual DNA lighting ONLY if NOT in uncanny-illustrated mode
    // When uncanny-illustrated is active, Visual DNA lighting must be suppressed
    // to prevent cold blue/green tints from low_key_shadow or deep_shadow_contrast
    const lightingSource = (visualDNA?.lighting_profile && !isUncannyIllustrated)
      ? visualDNA.lighting_profile.replace(/_/g, ' ')
      : (contract.lightingSource || "soft warm ambient light");
    
    // ========== SIGN/TEXT CONTRADICTION FIX ==========
    // If mustShow includes a sign/screen/paper, ensure text is blurred/unreadable
    // instead of contradicting the "no text" rule
    const signPatterns = /(sign|screen|paper|note|letter|document|newspaper|billboard|poster|menu)/i;
    const hasSignProp = mustShowItems.some(item => signPatterns.test(item));
    let signTextRule = "";
    if (hasSignProp) {
      // Add explicit rule for handling text on props
      signTextRule = "\nSIGN/TEXT RULE: Any signs, screens, or papers must have BLURRED or UNREADABLE text - no legible words, letters cropped or motion-blurred.";
      console.log(`[PROMPT] Scene ${sceneIndex + 1}: Sign/paper prop detected - adding blur rule`);
    }
    
    // Remove date/timestamp requirements when text is banned
    let evidenceRule = contract.evidenceRule || `Scene must clearly show ${contract.location}`;
    if (evidenceRule.toLowerCase().includes('date') || evidenceRule.toLowerCase().includes('timestamp')) {
      evidenceRule = evidenceRule.replace(/date\s+(visible|shown|displayed)/gi, 'analog elements visible');
      evidenceRule = evidenceRule.replace(/timestamp/gi, 'time indicator');
      console.log(`[PROMPT] Scene ${sceneIndex + 1}: Removed date/timestamp requirement from evidence rule`);
    }
    
    // ========== GROUP COUNT ENFORCEMENT (One Too Many preset) ==========
    let groupCountBlock = "";
    if (contract.group_count) {
      const { expected, is_wrong, extra_person_rules } = contract.group_count;
      
      // CRITICAL FIX: Only show "one figure is subtly wrong" when is_wrong=true
      // Before reveal, expected=start_count and is_wrong=false
      // After reveal, expected=wrong_count and is_wrong=true
      const countLockLines = [
        ``,
        `COUNT LOCK (CRITICAL - DO NOT VIOLATE):`,
        `EXACTLY ${expected} human figures must be visible in this image.`,
        `No more. No fewer. Count them carefully before finalizing.`,
      ];
      
      // ========== LAYOUT LOCK (v5.3) ==========
      // Explicit spatial arrangement to prevent occlusion and cropping
      const layoutLockLines = [
        ``,
        `LAYOUT LOCK (MANDATORY):`,
        `Show EXACTLY ${expected} distinct people, all fully inside frame.`,
      ];
      
      // Dynamic row arrangement based on count
      if (expected <= 3) {
        layoutLockLines.push(`Arrange them in a SINGLE ROW facing the viewer.`);
      } else if (expected <= 5) {
        const frontRow = Math.ceil(expected / 2);
        const backRow = expected - frontRow;
        layoutLockLines.push(`Arrange them in TWO ROWS: ${frontRow} in front, ${backRow} behind.`);
      } else if (expected <= 7) {
        // For 6-7 people, use 4 front, rest back
        const frontRow = 4;
        const backRow = expected - frontRow;
        layoutLockLines.push(`Arrange them in TWO ROWS: ${frontRow} in front, ${backRow} behind.`);
      } else {
        // For 8+ people, use three rows
        const frontRow = Math.ceil(expected / 3);
        const middleRow = Math.ceil((expected - frontRow) / 2);
        const backRow = expected - frontRow - middleRow;
        layoutLockLines.push(`Arrange them in THREE ROWS: ${frontRow} front, ${middleRow} middle, ${backRow} back.`);
      }
      
      layoutLockLines.push(
        `Every face must be VISIBLE - no one blocked by another person.`,
        `No cropping: all heads fully visible inside frame.`,
        `Distinct hair/outfit per person (no duplicates).`
      );
      
      // ========== UNIQUENESS ANCHORS (v5.3) ==========
      // Give each person a quick identity tag to prevent merging
      const identityTags = [
        "curly dark hair",
        "thick-framed glasses", 
        "short bob haircut",
        "buzz cut",
        "hoodie",
        "denim jacket",
        "blonde hair",
        "ponytail",
        "beard",
        "headband",
        "bandana",
        "cap",
      ];
      
      // Pick N unique tags for the expected count
      const shuffled = [...identityTags].sort(() => Math.random() - 0.5);
      const personTags = shuffled.slice(0, expected);
      
      const uniquenessLines = [
        ``,
        `UNIQUENESS ANCHORS (each person must be distinct):`,
        ...personTags.map((tag, i) => `Person ${i + 1}: ${tag}`),
      ];
      
      // Only add uncanny rules when is_wrong is true (after reveal)
      if (is_wrong) {
        countLockLines.push(`One figure (NOT in center) is subtly wrong - posture off, smile frozen, eyes fixed at viewer.`);
        countLockLines.push(`The extra person is NOT obviously supernatural or monstrous.`);
      }
      
      if (extra_person_rules) {
        countLockLines.push(extra_person_rules);
      }
      
      // Combine COUNT LOCK + LAYOUT LOCK + UNIQUENESS
      groupCountBlock = [...countLockLines, ...layoutLockLines, ...uniquenessLines].filter(Boolean).join("\n");
      console.log(`[CONTRACT] Scene ${sceneIndex + 1}: GROUP COUNT LOCK = ${expected} people (is_wrong=${is_wrong}), LAYOUT LOCK applied`);
    }
    
    // ========== MUST NOT contradiction fix ==========
    // If group_count shows the correct (expected) count without extra,
    // ensure "extra people" is in MUST NOT
    // If group_count shows wrong count, remove "extra people" from MUST NOT
    if (contract.group_count) {
      // Always add count-safety items to MUST NOT
      const countSafetyBans = ["cropped heads", "partial faces", "merged faces", "extra silhouettes"];
      for (const ban of countSafetyBans) {
        if (!mustNotItems.some(item => item.toLowerCase().includes(ban.split(' ')[0]))) {
          mustNotItems.push(ban);
        }
      }
      
      if (contract.group_count.is_wrong) {
        // AFTER REVEAL: extra person IS visible, remove from MUST NOT
        mustNotItems = mustNotItems.filter(item => 
          !item.toLowerCase().includes('extra people') && 
          !item.toLowerCase().includes('additional people')
        );
        console.log(`[PROMPT] Scene ${sceneIndex + 1}: Removed "extra people" from MUST NOT (is_wrong=true)`);
      } else {
        // BEFORE REVEAL: extra person is NOT visible, keep/add to MUST NOT
        if (!mustNotItems.some(item => item.toLowerCase().includes('extra people'))) {
          mustNotItems.push('extra people or figures');
        }
      }
    }
    
    sceneBlock = [
      `SCENE ${sceneIndex + 1}/${totalScenes} CONTRACT (MUST FOLLOW):`,
      ``,
      `MUST SHOW:`,
      mustShowItems.join("\n"),
      ``,
      `MUST NOT SHOW:`,
      `- ${mustNotItems.join(", ")}`,
      signTextRule,
      groupCountBlock,
      ``,
      `EVIDENCE:`,
      `- ${evidenceRule}`,
      ``,
      `Lighting: ${lightingSource}`,
      `Camera: ${contract.cameraDistance || "medium"} shot`,
      compositionHint ? `Composition: ${compositionHint}` : "",
      // Use continuity field if available, otherwise fall back to continuityFromPrev
      contract.continuity ? `Continuity: location=${contract.continuity.location}, time=${contract.continuity.time_of_day}` : 
        (contract.continuityFromPrev ? `Continuity: ${contract.continuityFromPrev}` : ""),
      `Mood: ${moodLevel}/10`,
    ].filter(Boolean).join("\n");
    
    // ALIGNMENT SCORE LOGGING
    const alignmentScore = {
      scene: sceneIndex + 1,
      location: contract.location ? "Y" : "N",
      objects: contract.visibleObjects?.length || 0,
      forbidden: mustNotItems.length,
      evidence: contract.evidenceRule ? "Y" : "N",
      continuity: contract.continuityFromPrev ? "Y" : "N",
    };
    console.log(`[CONTRACT] scene=${alignmentScore.scene} location=${alignmentScore.location} objects=${alignmentScore.objects} forbidden=${alignmentScore.forbidden} evidence=${alignmentScore.evidence} continuity=${alignmentScore.continuity}`);
  } else {
    // FALLBACK: Use old method if no contract
    const environment = isCustomStyle 
      ? rewriteToContentOnly(storyAnchor.environment || "", visualPreset)
      : storyAnchor.environment || "";
    
    const action = isCustomStyle 
      ? rewriteToContentOnly(beat.visualBeat || "", visualPreset)
      : beat.visualBeat;
    
    const cameraAngle = isCustomStyle 
      ? rewriteToContentOnly(sanitizedCameraAngle, visualPreset)
      : sanitizedCameraAngle;
    
    sceneBlock = [
      `SCENE ${sceneIndex + 1}/${totalScenes}:`,
      `Setting: ${environment}`,
      `Action: ${action}`,
      beat.mirrorBehavior ? `Mirror rule: ${beat.mirrorBehavior}` : "",
      beat.realityRule ? `Reality rule: ${beat.realityRule}` : "",
      `Camera: ${cameraAngle}`,
      `Focus: ${beat.focus}`,
      `Mood: ${moodLevel}/10`,
      storyAnchor.continuityRules ? `Continuity: ${storyAnchor.continuityRules}` : "",
    ].filter(Boolean).join("\n");
    
    console.log(`[PROMPT] No visual contract, using fallback for scene ${sceneIndex + 1}`);
  }
  
  // ========== BUILD AVOID BLOCK ==========
  const negativePrompt = styleConfig.negativePrompt || "text, words, letters, watermarks, signatures";
  const avoidBlock = `AVOID:\n${negativePrompt}\nAbsolutely no text, letters, captions, watermarks anywhere in image.`;
  
  // ========== ASSEMBLE FINAL PROMPT ==========
  // Order matters! DALL-E prioritizes the beginning
  const promptParts = [
    // 1. ORIENTATION LOCK (most critical - simplified to avoid hallway/stair bias)
    ORIENTATION_LOCK,
    
    // 2. STYLE (second most important)
    `\nSTYLE LOCK:\n${styleBlock}`,
    
    // 3. CHARACTER (must be consistent)
    characterBlock ? `\n${characterBlock}` : "",
    
    // 4. SCENE CONTRACT with MUST/MUST NOT
    `\n${sceneBlock}`,
    
    // 5. AVOID (last)
    `\n${avoidBlock}`,
  ].filter(Boolean);
  
  let finalPrompt = promptParts.join("\n");
  
  // ========== UNCANNY-ILLUSTRATED FINAL SANITIZATION ==========
  // Remove ALL camera/cinematic vocabulary when uncanny-illustrated is active
  if (isUncannyIllustrated) {
    finalPrompt = sanitizePromptForUncannyIllustrated(finalPrompt);
    console.log(`[PROMPT] Scene ${sceneIndex + 1}: Applied uncanny-illustrated sanitization`);
  }
  
  // ========== LENGTH CONTROL ==========
  // Keep under 2500 chars for stability
  if (finalPrompt.length > 2500) {
    console.log(`[PROMPT] Warning: prompt is ${finalPrompt.length} chars, truncating...`);
    // Truncate the style block (usually longest) to fit
    const excess = finalPrompt.length - 2400;
    if (styleBlock.length > excess + 100) {
      const truncatedStyle = styleBlock.substring(0, styleBlock.length - excess - 50) + "...";
      finalPrompt = finalPrompt.replace(styleBlock, truncatedStyle);
    }
  }
  
  // =====================================================
  // COMPREHENSIVE PROMPT LOGGING (v5.4)
  // Shows EVERYTHING that controls image generation
  // =====================================================
  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║ IMAGE GENERATION CONFIG - Scene ${sceneIndex + 1}/${totalScenes}`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║ ART STYLE OVERRIDE: ${artStyleOverride || 'NONE'}`);
  console.log(`║ IS UNCANNY-ILLUSTRATED: ${isUncannyIllustrated ? '✅ YES (Visual DNA SUPPRESSED)' : '❌ NO'}`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║ STYLE CONFIG:`);
  console.log(`║   Name: ${styleConfig.name}`);
  console.log(`║   Base Prompt: ${(styleConfig.basePrompt || 'NONE').substring(0, 100)}...`);
  console.log(`║   Color Override: ${(styleConfig.colorOverride || 'NONE').substring(0, 80)}...`);
  console.log(`║   Technical Style: ${(styleConfig.technicalStyle || 'NONE').substring(0, 80)}...`);
  console.log(`║   Negative Prompt: ${(styleConfig.negativePrompt || 'NONE').substring(0, 80)}...`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║ VISUAL DNA: ${visualDNA ? 'PRESENT' : 'NONE'}`);
  if (visualDNA) {
    console.log(`║   Visual Style: ${visualDNA.visual_style} ${isUncannyIllustrated ? '(IGNORED)' : '(ACTIVE)'}`);
    console.log(`║   Color Palette: ${visualDNA.color_palette} ${isUncannyIllustrated ? '(IGNORED)' : '(ACTIVE)'}`);
    console.log(`║   Lighting Profile: ${visualDNA.lighting_profile} ${isUncannyIllustrated ? '(IGNORED)' : '(ACTIVE)'}`);
    console.log(`║   Frame Composition: ${visualDNA.frame_composition} ${isUncannyIllustrated ? '(IGNORED)' : '(ACTIVE)'}`);
    console.log(`║   Texture Artifacts: ${visualDNA.texture_artifacts?.join(', ') || 'NONE'} ${isUncannyIllustrated ? '(IGNORED)' : '(ACTIVE)'}`);
    console.log(`║   Camera Language: ${visualDNA.camera_language || 'NONE'} ${isUncannyIllustrated ? '(IGNORED)' : '(ACTIVE)'}`);
    console.log(`║   Motion Profile: ${visualDNA.motion_profile || 'NONE'} ${isUncannyIllustrated ? '(IGNORED)' : '(ACTIVE)'}`);
  }
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║ VISUAL CONTRACT: ${contract ? 'PRESENT' : 'NONE'}`);
  if (contract) {
    console.log(`║   Location: ${contract.location}`);
    console.log(`║   Character Pose: ${contract.characterPose}`);
    console.log(`║   Facial Expression: ${contract.facialExpression || 'NONE'}`);
    console.log(`║   Visible Objects: ${contract.visibleObjects?.join(', ') || 'NONE'}`);
    console.log(`║   Forbidden Elements: ${contract.forbiddenElements?.join(', ') || 'NONE'}`);
    console.log(`║   GROUP COUNT: ${contract.group_count ? `${contract.group_count.expected} people (is_wrong: ${contract.group_count.is_wrong})` : 'NONE'}`);
  }
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║ STYLE BLOCK USED:`);
  console.log(`║ ${styleBlock.substring(0, 200).replace(/\n/g, ' | ')}...`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║ FINAL PROMPT LENGTH: ${finalPrompt.length} chars`);
  console.log(`║ PROMPT PREVIEW: ${finalPrompt.substring(0, 300).replace(/\n/g, ' | ')}...`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
  
  return finalPrompt;
}

// =====================================================
// FLUX PROMPT BUILDER - SIMPLIFIED FOR FLUX MODEL
// =====================================================
/**
 * Build a shorter, simpler prompt optimized for FLUX.
 * 
 * FLUX works best with:
 * - Short style header (1-2 lines)
 * - Brief scene description (2-3 lines)
 * - Minimal negatives (1-2 lines)
 * 
 * FLUX IGNORES long "rule" prompts and tends toward photorealism.
 * For cartoon/webcomic styles, DALL-E 3 or GPT-4o are better choices.
 * 
 * v5.0: Now accepts Visual DNA for deterministic style mapping
 */
export function buildFluxPrompt(
  storyAnchor: StoryAnchor,
  beat: VisualBeat,
  sceneIndex: number,
  totalScenes: number,
  styleConfig: { name: string; negativePrompt?: string; basePrompt?: string; colorOverride?: string; technicalStyle?: string },
  isCustomStyle: boolean = false,
  visualDNA?: VisualDNA | null,
  artStyleOverride?: string // v5.7: Art style override for preset protection
): string {
  const contract = beat.visualContract;
  const moodLevel = Math.max(1, Math.min(10, Math.round(beat.moodLevel)));
  
  // ========== ART STYLE PROTECTION (v5.7) ==========
  // When artStyleOverride is 'uncanny-illustrated', suppress Visual DNA completely
  const isUncannyIllustrated = artStyleOverride === 'uncanny-illustrated';
  
  // ========== VISUAL DNA STYLE (if available and NOT suppressed) ==========
  // When Visual DNA is present and NOT in uncanny-illustrated mode, it takes priority
  let visualDNAStyle = "";
  if (visualDNA && !isUncannyIllustrated) {
    const styleMap: Record<string, string> = {
      "VHS_degraded": "grainy VHS aesthetic, analog video distortion, worn tape quality",
      "cinematic_dark": "cinematic dark photography, film noir lighting, professional cinematography",
      "cinematic_minimal": "minimalist cinematography, clean compositions, subtle lighting",
      "documentary_archival": "documentary style, archival footage quality, authentic period look",
      "surveillance_footage": "security camera footage, surveillance aesthetic, fixed angle",
      "found_footage": "found footage style, amateur video quality, authentic discovered recording",
      "polaroid_faded": "faded polaroid aesthetic, vintage photograph quality, aged colors",
    };
    
    const paletteMap: Record<string, string> = {
      "cold_desaturated": "cold desaturated colors, muted tones",
      "sickly_green": "sickly green cast, nauseous color grading",
      "muted_gray": "muted grays, washed out tones",
      "deep_shadow_contrast": "deep shadows, high contrast, rich blacks",
      "monochrome_harsh": "harsh monochrome, stark black and white",
      "amber_decay": "amber decay tones, aged sepia hints",
      "blue_black_void": "blue-black void, deep indigo shadows",
    };
    
    const lightingMap: Record<string, string> = {
      "moonlit_fog": "moonlit foggy atmosphere, diffused silver light",
      "fluorescent_flat": "harsh fluorescent lighting, flat institutional light",
      "low_key_shadow": "low-key dramatic lighting, deep shadows",
      "blown_highlights": "blown out highlights, harsh contrast",
      "single_source_harsh": "single harsh light source, dramatic shadows",
      "twilight_amber": "twilight amber glow, fading golden hour",
      "deep_darkness": "deep darkness, minimal light, overwhelming shadow",
    };
    
    const compositionMap: Record<string, string> = {
      "centered_void": "centered composition with empty void",
      "rule_of_thirds": "classic rule of thirds composition",
      "off_balance": "deliberately off-balance framing, unsettling",
      "deep_space": "deep space composition, layered depth",
      "claustrophobic": "claustrophobic tight framing",
      "negative_space_heavy": "heavy negative space, isolated subject",
    };
    
    const parts = [
      styleMap[visualDNA.visual_style] || "",
      paletteMap[visualDNA.color_palette] || "",
      lightingMap[visualDNA.lighting_profile] || "",
      compositionMap[visualDNA.frame_composition] || "",
    ].filter(Boolean);
    
    // Add texture artifacts
    if (visualDNA.texture_artifacts.length > 0) {
      const artifactTerms = visualDNA.texture_artifacts.map(a => a.replace(/_/g, ' ')).slice(0, 3);
      parts.push(artifactTerms.join(', '));
    }
    
    visualDNAStyle = parts.join(", ");
    console.log(`[FLUX-PROMPT] Using Visual DNA style: ${visualDNA.visual_style} / ${visualDNA.color_palette}`);
  } else if (visualDNA && isUncannyIllustrated) {
    // UNCANNY ILLUSTRATED MODE: Visual DNA is SUPPRESSED for FLUX too
    console.log(`[FLUX-PROMPT] ⚠️ UNCANNY-ILLUSTRATED OVERRIDE: Suppressing ALL Visual DNA for FLUX (style="${visualDNA.visual_style}", palette="${visualDNA.color_palette}")`);
  }
  
  // ========== STYLE (SHORT!) ==========
  // FLUX bias: if style mentions "cartoon/webcomic/vector", it often ignores it
  // Best for: cinematic, photorealistic, dark atmospheric
  // v5.7: For uncanny-illustrated, ALWAYS use styleConfig.basePrompt
  let styleShort: string;
  if (isUncannyIllustrated) {
    // UNCANNY ILLUSTRATED: Force the style config, ignore Visual DNA
    styleShort = styleConfig.basePrompt || "editorial cartoon, graphic novel, cel-shaded horror, bold ink outlines, flat shading, muted cool grays, limited palette";
    console.log(`[FLUX-PROMPT] ✅ UNCANNY-ILLUSTRATED style enforced for FLUX`);
  } else if (visualDNAStyle) {
    // If Visual DNA is present (and not suppressed), use it as the primary style
    styleShort = visualDNAStyle;
  } else if (isCustomStyle && styleConfig.basePrompt) {
    // Custom style: extract the core concept (first 100 chars)
    styleShort = styleConfig.basePrompt.substring(0, 100).trim();
    if (styleConfig.colorOverride) {
      styleShort += `, ${styleConfig.colorOverride}`;
    }
  } else {
    // Built-in style: use the anchor's full prompt (already concise)
    styleShort = storyAnchor.fullAnchorPrompt || styleConfig.name;
  }
  
  // ========== CHARACTER (SHORT!) ==========
  let characterShort = "";
  if (storyAnchor.characterDescription) {
    // characterDescription is a string - extract key details
    const charDesc = storyAnchor.characterDescription;
    // Take first ~100 chars of character description for brevity
    characterShort = charDesc.length > 100 ? charDesc.substring(0, 100).trim() + "..." : charDesc;
  }
  
  // ========== SCENE (SHORT!) ==========
  let sceneShort: string;
  if (contract) {
    // Use visual contract but keep it brief
    const location = contract.location || "interior scene";
    const pose = contract.characterPose || "standing";
    const supernatural = contract.supernaturalElement || "";
    // Use Visual DNA lighting if available, otherwise contract lighting
    const lighting = visualDNA?.lighting_profile 
      ? visualDNA.lighting_profile.replace(/_/g, ' ')
      : (contract.lightingSource || "dim light");
    
    sceneShort = [
      location,
      characterShort ? `${characterShort}, ${pose}` : pose,
      supernatural,
      lighting,
      contract.cameraDistance || "medium shot",
    ].filter(Boolean).join(", ");
  } else {
    // Fallback to visual beat
    sceneShort = [
      storyAnchor.environment || "dark interior",
      characterShort,
      beat.visualBeat || "",
      beat.cameraAngle || "medium shot",
    ].filter(Boolean).join(", ");
  }
  
  // ========== ASSEMBLE (MAX ~600 chars for FLUX) ==========
  const parts = [
    // Style first (FLUX prioritizes early tokens)
    styleShort,
    // Scene description
    sceneShort,
    // Mood hint
    moodLevel >= 7 ? "intense horror atmosphere, dread" : moodLevel >= 4 ? "unsettling atmosphere" : "subtle unease",
    // Short negative
    "no text, no watermarks",
  ];
  
  const finalPrompt = parts.filter(Boolean).join(". ");
  
  // Warn if using cartoon style with FLUX
  const isCartoonStyle = styleConfig.name?.toLowerCase().includes("cartoon") ||
                         styleConfig.name?.toLowerCase().includes("webcomic") ||
                         styleConfig.name?.toLowerCase().includes("anime") ||
                         styleConfig.basePrompt?.toLowerCase().includes("cartoon") ||
                         styleConfig.basePrompt?.toLowerCase().includes("webcomic");
  
  if (isCartoonStyle) {
    console.warn(`[FLUX-PROMPT] ⚠️ Cartoon/webcomic style detected - FLUX often ignores this and generates photorealistic images. Consider using DALL-E 3 or GPT-4o for cartoon styles.`);
  }
  
  console.log(`[FLUX-PROMPT] Scene ${sceneIndex + 1}/${totalScenes}: ${finalPrompt.length} chars`);
  console.log(`[FLUX-PROMPT] Preview: ${finalPrompt.substring(0, 200)}...`);
  
  return finalPrompt;
}

// =====================================================
// ALIGNMENT SELF-CHECK: Verify contracts match narration
// Returns alignment scores and flags scenes needing repair
// =====================================================

export interface AlignmentResult {
  sceneIndex: number;
  score: number; // 0.0 - 1.0
  issues: string[];
  needsRepair: boolean;
}

/**
 * Check alignment between scene narration and visual contract
 * Score components:
 * - Key entity overlap (0.4): Do the contract's subjects appear in narration?
 * - Setting match (0.3): Is the location relevant to what's described?
 * - Action relevance (0.3): Does the frozen action reflect the narration?
 */
export function checkContractAlignment(
  scene: StoryScene,
  contract: SceneVisualContract
): AlignmentResult {
  const text = scene.text.toLowerCase();
  const issues: string[] = [];
  let score = 0;
  
  // ========== KEY ENTITY OVERLAP (0.4) ==========
  // Extract key nouns from contract's actionFrozen and check if they appear in narration
  const actionWords = (contract.actionFrozen || "").toLowerCase().split(/\s+/);
  const significantWords = actionWords.filter(w => 
    w.length > 3 && 
    !["the", "and", "with", "from", "into", "their", "this", "that", "they", "what", "when", "where", "being", "having"].includes(w)
  );
  
  if (significantWords.length > 0) {
    const matchingWords = significantWords.filter(w => text.includes(w));
    const entityOverlap = matchingWords.length / Math.min(significantWords.length, 5); // Cap at 5 for normalization
    score += Math.min(entityOverlap, 1) * 0.4;
    
    if (entityOverlap < 0.3) {
      issues.push(`Low entity overlap: contract mentions "${significantWords.slice(0, 3).join(', ')}" not in narration`);
    }
  } else {
    score += 0.2; // Partial credit if no significant words to check
  }
  
  // ========== SETTING MATCH (0.3) ==========
  // Check if contract location appears in or relates to narration
  const location = (contract.location || "").toLowerCase();
  const locationWords = location.split(/\s+/).filter(w => w.length > 3);
  
  if (locationWords.length > 0) {
    const locationMatch = locationWords.some(w => text.includes(w));
    if (locationMatch) {
      score += 0.3;
    } else {
      // Check for semantic synonyms
      const synonyms: Record<string, string[]> = {
        "forest": ["trees", "woods", "woodland", "grove"],
        "house": ["home", "building", "room", "door", "floor", "wall", "hallway"],
        "road": ["path", "street", "highway", "driveway"],
        "night": ["dark", "darkness", "midnight", "evening"],
        "water": ["lake", "river", "pond", "stream", "ocean", "sea"],
      };
      
      const hasSynonym = locationWords.some(w => 
        synonyms[w]?.some(syn => text.includes(syn))
      );
      
      if (hasSynonym) {
        score += 0.25;
      } else {
        issues.push(`Setting mismatch: "${location}" not reflected in narration`);
        score += 0.1; // Small credit - might be carrying forward location
      }
    }
  } else {
    score += 0.15; // Partial credit
  }
  
  // ========== ACTION RELEVANCE (0.3) ==========
  // Check if the action verbs in contract relate to narration
  const actionVerbs = ["standing", "walking", "running", "looking", "turning", "falling", "rising", "moving", "reaching", "watching", "hiding", "emerging", "approaching"];
  const contractAction = (contract.actionFrozen || "").toLowerCase();
  
  const usedVerbs = actionVerbs.filter(v => contractAction.includes(v));
  if (usedVerbs.length > 0) {
    const verbMatch = usedVerbs.some(v => {
      // Check for verb root in narration
      const root = v.replace(/ing$/, "");
      return text.includes(v) || text.includes(root) || text.includes(root + "ed") || text.includes(root + "s");
    });
    
    if (verbMatch) {
      score += 0.3;
    } else {
      // Check if narration at least implies similar action type
      const hasMotion = /walked?|ran?|moved?|went|came|stepped|rushed/i.test(text);
      const hasObservation = /saw|looked?|watched?|noticed|observed|stared?/i.test(text);
      const hasFear = /feared?|scared?|terrified|frozen|paralyzed/i.test(text);
      
      if ((hasMotion && usedVerbs.some(v => ["walking", "running", "moving"].includes(v))) ||
          (hasObservation && usedVerbs.some(v => ["looking", "watching"].includes(v))) ||
          (hasFear && usedVerbs.some(v => ["standing", "hiding"].includes(v)))) {
        score += 0.25;
      } else {
        issues.push(`Action may not match: contract shows "${usedVerbs.join(', ')}" but narration differs`);
        score += 0.1;
      }
    }
  } else {
    score += 0.15; // Partial credit
  }
  
  return {
    sceneIndex: contract.sceneIndex,
    score: Math.min(score, 1),
    issues,
    needsRepair: score < 0.5, // Flag for repair if below 50%
  };
}

/**
 * Run alignment check on all contracts
 * Returns overall stats and list of scenes needing repair
 */
export function runAlignmentCheck(
  scenes: StoryScene[],
  contracts: SceneVisualContract[]
): {
  overallScore: number;
  sceneResults: AlignmentResult[];
  needsRepair: number[];
  summary: string;
} {
  const results: AlignmentResult[] = [];
  
  for (let i = 0; i < Math.min(scenes.length, contracts.length); i++) {
    const result = checkContractAlignment(scenes[i], contracts[i]);
    results.push(result);
  }
  
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const needsRepair = results.filter(r => r.needsRepair).map(r => r.sceneIndex);
  
  // Log summary
  const distribution = {
    excellent: results.filter(r => r.score >= 0.8).length,
    good: results.filter(r => r.score >= 0.6 && r.score < 0.8).length,
    fair: results.filter(r => r.score >= 0.4 && r.score < 0.6).length,
    poor: results.filter(r => r.score < 0.4).length,
  };
  
  const summary = `Alignment: avg=${(avgScore * 100).toFixed(0)}%, excellent=${distribution.excellent}, good=${distribution.good}, fair=${distribution.fair}, poor=${distribution.poor}, repairs=${needsRepair.length}`;
  console.log(`[ALIGNMENT] ${summary}`);
  
  // Log any issues found
  for (const result of results) {
    if (result.issues.length > 0) {
      console.log(`[ALIGNMENT] Scene ${result.sceneIndex + 1} (${(result.score * 100).toFixed(0)}%): ${result.issues.join("; ")}`);
    }
  }
  
  return {
    overallScore: avgScore,
    sceneResults: results,
    needsRepair,
    summary,
  };
}

// =====================================================
// RELEVANCE SCORING + AUTO-REPAIR (v5.2)
// =====================================================

export interface RelevanceResult {
  relevance_score: number;       // 0-1 
  missing_elements: string[];    // Elements that should be in prompt but aren't
  reason: string;               // Short explanation
  needs_repair: boolean;        // true if score < 0.65
  // NEW: Hard evidence fields (v5.1)
  failure_type: "missing_objects" | "wrong_location" | "wrong_threat" | "too_generic" | "continuity_break" | "ok";
  matched_objects: string[];    // Objects from contract found in prompt
  mismatched_fields: string[];  // Fields that don't align
}

// Generic horror terms that should NOT count toward relevance unless narration supports
const GENERIC_HORROR_TERMS = [
  "fog", "mist", "shadow", "shadows", "darkness", "dark room", "dim light",
  "eerie", "ominous", "sinister", "creepy", "scary", "horror", "terror",
  "dread", "fear", "unease", "tension", "suspense"
];

/**
 * Score how well the image prompt captures the scene's visual contract
 * HARDENED RUBRIC (v5.1):
 * - Require ≥2 concrete objects from visibleObjects in prompt
 * - Require location alignment with contract
 * - Require threat_manifestation alignment if present
 * - Penalize generic horror signatures unless narration supports
 */
export async function scorePromptRelevance(
  openaiKey: string,
  sceneIndex: number,
  narration: string,
  visualContract: {
    location?: string;
    actionFrozen?: string;
    visibleObjects?: string[];
    characterPose?: string;
    supernaturalElement?: string | null;
    continuity?: {
      location?: string;
      threat_manifestation?: string;
      time_of_day?: string;
    };
  } | null,
  prompt: string
): Promise<RelevanceResult> {
  const THRESHOLD = 0.65;
  const MIN_OBJECTS_REQUIRED = 2;
  
  // Default result for early returns
  const defaultResult: RelevanceResult = {
    relevance_score: 0.5,
    missing_elements: [],
    reason: "",
    needs_repair: false,
    failure_type: "ok",
    matched_objects: [],
    mismatched_fields: [],
  };
  
  // If no contract, can't score - return neutral
  if (!visualContract) {
    console.log(`[RELEVANCE] Scene ${sceneIndex + 1}: No visual contract, skipping score`);
    return {
      ...defaultResult,
      missing_elements: ["no_contract"],
      reason: "No visual contract available for comparison",
    };
  }
  
  // Extract key elements from contract
  const mustShow = visualContract.visibleObjects || [];
  const location = visualContract.location || "";
  const actionFrozen = visualContract.actionFrozen || "";
  const characterPose = visualContract.characterPose || "";
  const supernatural = visualContract.supernaturalElement || "";
  const threatManifestation = visualContract.continuity?.threat_manifestation || "";
  const timeOfDay = visualContract.continuity?.time_of_day || "";
  
  const promptLower = prompt.toLowerCase();
  const narrationLower = narration.toLowerCase();
  
  // ========== HARD EVIDENCE CHECK (before LLM) ==========
  // Check how many concrete objects appear in prompt
  const matchedObjects: string[] = [];
  const missingObjects: string[] = [];
  
  for (const obj of mustShow) {
    const objLower = obj.toLowerCase();
    // Check if object (or partial match) appears in prompt
    const objWords = objLower.split(/\s+/);
    const found = objWords.some(word => word.length > 3 && promptLower.includes(word));
    if (found) {
      matchedObjects.push(obj);
    } else {
      missingObjects.push(obj);
    }
  }
  
  // Check location alignment
  const locationWords = location.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const locationInPrompt = locationWords.some(word => promptLower.includes(word));
  
  // Check for generic horror drift (penalize if not supported by narration)
  const genericTermsInPrompt = GENERIC_HORROR_TERMS.filter(term => promptLower.includes(term));
  const genericTermsInNarration = GENERIC_HORROR_TERMS.filter(term => narrationLower.includes(term));
  const unsupportedGenericTerms = genericTermsInPrompt.filter(term => !genericTermsInNarration.includes(term));
  
  // Check threat alignment if present
  const threatWords = threatManifestation.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const threatInPrompt = threatWords.length === 0 || threatWords.some(word => promptLower.includes(word));
  
  // ========== COMPUTE HARD EVIDENCE SCORE ==========
  let hardScore = 0;
  const mismatched: string[] = [];
  let failureType: RelevanceResult["failure_type"] = "ok";
  
  // Object coverage: 40% weight (require ≥2 objects)
  const objectScore = mustShow.length > 0 
    ? Math.min(1, matchedObjects.length / Math.max(MIN_OBJECTS_REQUIRED, mustShow.length * 0.6))
    : 0.8; // No objects specified = partial credit
  hardScore += objectScore * 0.4;
  
  if (matchedObjects.length < MIN_OBJECTS_REQUIRED && mustShow.length >= MIN_OBJECTS_REQUIRED) {
    mismatched.push(`objects (${matchedObjects.length}/${mustShow.length})`);
    failureType = "missing_objects";
  }
  
  // Location alignment: 25% weight
  if (locationInPrompt) {
    hardScore += 0.25;
  } else if (location) {
    mismatched.push(`location ("${location}" not found)`);
    if (failureType === "ok") failureType = "wrong_location";
    hardScore += 0.05; // Minimal credit
  } else {
    hardScore += 0.15; // No location specified = partial credit
  }
  
  // Threat alignment: 20% weight
  if (threatInPrompt) {
    hardScore += 0.2;
  } else if (threatManifestation) {
    mismatched.push(`threat ("${threatManifestation}" missing)`);
    if (failureType === "ok") failureType = "wrong_threat";
    hardScore += 0.05;
  } else {
    hardScore += 0.15;
  }
  
  // Generic penalty: -15% if too many unsupported generic terms
  if (unsupportedGenericTerms.length >= 3) {
    hardScore -= 0.15;
    mismatched.push(`too_generic (${unsupportedGenericTerms.length} unsupported horror terms)`);
    if (failureType === "ok") failureType = "too_generic";
  }
  
  // Action/pose alignment: 15% weight
  const actionWords = actionFrozen.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const actionInPrompt = actionWords.length === 0 || actionWords.some(word => promptLower.includes(word));
  if (actionInPrompt) {
    hardScore += 0.15;
  } else {
    mismatched.push("action");
    hardScore += 0.05;
  }
  
  hardScore = Math.max(0, Math.min(1, hardScore));
  
  // ========== LLM VALIDATION (for nuanced check) ==========
  let llmScore = hardScore; // Default to hard score if LLM fails
  let llmReason = "";
  
  try {
    const openai = new OpenAI({ apiKey: openaiKey });
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content: `You are a strict visual relevance checker. Score prompts harshly for missing concrete elements.

HARD REQUIREMENTS:
1. At least 2 concrete objects from visibleObjects MUST appear in prompt (not generic synonyms)
2. Location MUST match contract (same room/place name)
3. If threat_manifestation exists, prompt must reflect it
4. Generic horror terms (fog, shadow, darkness) without narration support = penalty

Return JSON:
{
  "relevance_score": 0.0-1.0,
  "missing_elements": ["specific missing items"],
  "reason": "Brief harsh assessment",
  "failure_type": "missing_objects|wrong_location|wrong_threat|too_generic|continuity_break|ok"
}

Score STRICTLY:
- 0.9-1.0: All contract elements present verbatim
- 0.65-0.89: Most elements present, acceptable
- 0.4-0.64: FAIL - Missing required objects/location
- 0.0-0.39: FAIL - Prompt doesn't match scene`
        },
        {
          role: "user",
          content: `SCENE ${sceneIndex + 1} STRICT RELEVANCE CHECK:

NARRATION: "${narration.substring(0, 250)}"

VISUAL CONTRACT:
- Location: ${location || "not specified"}
- Must show objects: [${mustShow.join(", ")}] (REQUIRE ≥2 IN PROMPT)
- Action frozen: ${actionFrozen || "not specified"}
- Threat: ${threatManifestation || supernatural || "none"}
- Time of day: ${timeOfDay || "not specified"}

PROMPT (first 600 chars):
"${prompt.substring(0, 600)}"

HARD EVIDENCE (pre-computed):
- Objects found in prompt: [${matchedObjects.join(", ")}] (${matchedObjects.length}/${mustShow.length})
- Location in prompt: ${locationInPrompt ? "YES" : "NO"}
- Unsupported generic terms: [${unsupportedGenericTerms.join(", ")}]

Score strictly. If <2 required objects found, score MUST be <0.65.`
        }
      ],
      response_format: { type: "json_object" }
    });
    
    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    
    llmScore = Math.max(0, Math.min(1, parseFloat(parsed.relevance_score) || hardScore));
    llmReason = parsed.reason || "LLM assessment";
    
    // Override failure_type if LLM provides one
    if (parsed.failure_type && parsed.failure_type !== "ok") {
      failureType = parsed.failure_type;
    }
    
    // Merge missing elements
    if (Array.isArray(parsed.missing_elements)) {
      missingObjects.push(...parsed.missing_elements.filter((e: string) => !missingObjects.includes(e)));
    }
    
  } catch (error) {
    console.error(`[RELEVANCE] Scene ${sceneIndex + 1} LLM error:`, error);
    llmReason = `Hard evidence only: ${mismatched.join(", ") || "ok"}`;
  }
  
  // Final score: average of hard evidence and LLM (hard evidence weighted 60%)
  const finalScore = hardScore * 0.6 + llmScore * 0.4;
  const needsRepair = finalScore < THRESHOLD || matchedObjects.length < MIN_OBJECTS_REQUIRED;
  
  console.log(`[RELEVANCE] Scene ${sceneIndex + 1}: hard=${(hardScore * 100).toFixed(0)}% llm=${(llmScore * 100).toFixed(0)}% final=${(finalScore * 100).toFixed(0)}%`);
  console.log(`[RELEVANCE] Scene ${sceneIndex + 1}: objects=${matchedObjects.length}/${mustShow.length}, location=${locationInPrompt}, failure=${failureType}`);
  
  return {
    relevance_score: finalScore,
    missing_elements: missingObjects,
    reason: llmReason,
    needs_repair: needsRepair,
    failure_type: failureType,
    matched_objects: matchedObjects,
    mismatched_fields: mismatched,
  };
}

/**
 * Repair a weak visual contract with STRICT requirements (v5.1)
 * - Rewrite actionFrozen as filmable: subject + verb + object
 * - Inject 1 distinct evidence item tied to story (compass, tilted-head figure, etc.)
 * - Tighten MUST NOT to avoid common drift (bedroom/modern unless narration says so)
 * - Add 3-5 SPECIFIC visible objects
 */
export async function repairVisualContract(
  openaiKey: string,
  sceneIndex: number,
  narration: string,
  originalContract: SceneVisualContract,
  missingElements: string[],
  storyDNAHints?: { vibe?: string; location_type?: string; threat_type?: string }
): Promise<SceneVisualContract> {
  console.log(`[REPAIR] Scene ${sceneIndex + 1}: STRICT repair starting, missing: ${missingElements.join(", ")}`);
  
  // Build story-specific evidence items based on DNA hints
  const evidenceItemSuggestions = [
    "compass pointing wrong direction",
    "clock with hands moving backward", 
    "photograph with scratched-out face",
    "sealed file cabinet with broken lock",
    "figure standing unnaturally still in background",
    "mirror showing reflection that doesn't match",
    "window with condensation forming words",
    "door slightly ajar when it was closed",
    "journal with pages torn out",
    "radio playing static",
  ];
  
  // Pick evidence based on vibe if available
  let evidenceHint = evidenceItemSuggestions[sceneIndex % evidenceItemSuggestions.length];
  if (storyDNAHints?.vibe?.includes("paranormal")) {
    evidenceHint = "figure with tilted head watching from shadows";
  } else if (storyDNAHints?.vibe?.includes("psychological")) {
    evidenceHint = "pills scattered across surface";
  } else if (storyDNAHints?.vibe?.includes("cosmic")) {
    evidenceHint = "geometry that shouldn't exist";
  }
  
  try {
    const openai = new OpenAI({ apiKey: openaiKey });
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content: `You are a visual contract repair specialist. Fix weak scene descriptions with STRICT, FILMABLE requirements.

REPAIR RULES:
1. actionFrozen MUST be filmable: [SUBJECT] [VERB] [OBJECT] format
   BAD: "tension builds" / "fear grows" / "something approaches"
   GOOD: "woman's hand reaches toward brass doorknob" / "man's flashlight beam illuminates wet footprints"

2. visibleObjects MUST have 4-5 SPECIFIC, CONCRETE items:
   BAD: "furniture", "shadows", "darkness"
   GOOD: "wooden chair", "brass lamp", "cracked window pane", "wet footprints on floor"

3. Add 1 EVIDENCE ITEM that proves this exact scene (unique identifier):
   Examples: "${evidenceHint}"

4. forbiddenElements MUST block common drift:
   - ALWAYS forbid: "bedroom", "modern interior", "bright lighting", "daylight" (unless narration explicitly mentions them)
   - Add scene-specific blocks based on what the NARRATION does NOT mention

5. evidenceRule MUST be a checkable statement:
   BAD: "scene must be scary"
   GOOD: "image must show flashlight beam hitting wet footprints on wooden floor"

Return JSON only:
{
  "location": "specific place from narration",
  "characterPose": "exact filmable body position with limb details",
  "visibleObjects": ["object1", "object2", "object3", "object4", "EVIDENCE_ITEM"],
  "actionFrozen": "[SUBJECT] [VERB] [OBJECT] - exact frozen moment",
  "supernaturalElement": "what horror element is visually present (or null)",
  "forbiddenElements": ["thing1", "thing2", "thing3"],
  "evidenceRule": "The image MUST show [specific checkable detail]"
}`
        },
        {
          role: "user",
          content: `STRICT REPAIR for Scene ${sceneIndex + 1}:

NARRATION (source of truth):
"${narration}"

ORIGINAL CONTRACT (FAILED):
- Location: ${originalContract.location}
- Pose: ${originalContract.characterPose}
- Objects: [${originalContract.visibleObjects?.join(", ")}]
- Action: ${originalContract.actionFrozen}

FAILURE REASONS: ${missingElements.join(", ")}

EVIDENCE ITEM SUGGESTION: ${evidenceHint}

REQUIREMENTS:
1. actionFrozen = [SUBJECT] [VERB] [OBJECT] from narration
2. 4-5 SPECIFIC objects that appear in narration (no generic "shadows")
3. 1 evidence item (can use suggestion or invent from narration)
4. forbiddenElements = things NOT in narration + ["bedroom", "modern furniture", "bright light"]
5. evidenceRule = checkable visual proof`
        }
      ],
      response_format: { type: "json_object" }
    });
    
    const content = response.choices[0]?.message?.content || "{}";
    const repair = JSON.parse(content);
    
    // Validate repair has required fields
    if (!repair.actionFrozen || repair.actionFrozen.length < 20) {
      throw new Error("Repair produced weak actionFrozen");
    }
    if (!repair.visibleObjects || repair.visibleObjects.length < 4) {
      throw new Error("Repair produced too few objects");
    }
    
    // Merge repair into original contract
    const repairedContract: SceneVisualContract = {
      ...originalContract,
      location: repair.location || originalContract.location,
      characterPose: repair.characterPose || originalContract.characterPose,
      visibleObjects: repair.visibleObjects,
      actionFrozen: repair.actionFrozen,
      supernaturalElement: repair.supernaturalElement ?? originalContract.supernaturalElement,
      forbiddenElements: repair.forbiddenElements || originalContract.forbiddenElements || [],
      evidenceRule: repair.evidenceRule || `Scene ${sceneIndex + 1} must match narration`,
    };
    
    console.log(`[REPAIR] Scene ${sceneIndex + 1}: SUCCESS`);
    console.log(`[REPAIR]   actionFrozen: "${repairedContract.actionFrozen?.substring(0, 60)}..."`);
    console.log(`[REPAIR]   objects: [${repairedContract.visibleObjects?.join(", ")}]`);
    console.log(`[REPAIR]   forbidden: [${repairedContract.forbiddenElements?.join(", ")}]`);
    console.log(`[REPAIR]   evidence: "${repairedContract.evidenceRule?.substring(0, 60)}..."`);
    
    return repairedContract;
    
  } catch (error) {
    console.error(`[REPAIR] Scene ${sceneIndex + 1} LLM failed:`, error);
    
    // STRICT FALLBACK: Extract nouns from narration as objects
    const narrationWords = narration.toLowerCase().split(/\s+/);
    const concreteNouns = narrationWords.filter(w => 
      w.length > 4 && 
      !["which", "where", "their", "there", "would", "could", "should", "about", "through"].includes(w)
    ).slice(0, 4);
    
    const fallbackObjects = [
      ...concreteNouns,
      evidenceHint, // Add the evidence item
    ];
    
    // Build filmable action from first sentence
    const firstSentence = narration.split(/[.!?]/)[0] || narration.substring(0, 100);
    const filmableAction = firstSentence.length > 20 
      ? firstSentence.substring(0, 80)
      : `character in ${originalContract.location || "scene"} - ${firstSentence}`;
    
    return {
      ...originalContract,
      visibleObjects: fallbackObjects,
      actionFrozen: filmableAction,
      forbiddenElements: [
        ...(originalContract.forbiddenElements || []),
        "bedroom", "modern interior", "bright daylight", "text", "words"
      ],
      evidenceRule: `Image must show: ${fallbackObjects[0]} and ${evidenceHint}`,
    };
  }
}
// =====================================================
// HUMAN COUNT VERIFICATION (v5.2)
// =====================================================
// Uses GPT-4 Vision to count visible human figures in generated images
// Returns verification result for COUNT LOCK enforcement

export interface CountVerificationResult {
  ok: boolean;
  expectedCount: number;
  detectedCount: number;
  confidence: "high" | "medium" | "low";
  notes: string;
}

/**
 * Verify that an image contains exactly the expected number of human figures
 * Uses GPT-4o vision to analyze the image
 * 
 * @param openaiKey - OpenAI API key
 * @param imageUrl - URL of the image to verify (can be base64 data URL)
 * @param expectedCount - Number of humans that should be visible
 * @returns Verification result with detected count and confidence
 */
export async function verifyHumanCount(
  openaiKey: string,
  imageUrl: string,
  expectedCount: number
): Promise<CountVerificationResult> {
  console.log(`[COUNT-VERIFY] Verifying image for ${expectedCount} humans...`);
  
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a precise image analyzer. Your ONLY job is to count the number of distinct human figures visible in an image. 
Rules:
- Count ONLY clearly visible human figures (head + at least partial body)
- Each person must have a DISTINCT, separate head
- Do NOT count reflections, shadows, or implied figures
- Do NOT count partial figures where you cannot see a distinct head
- Do NOT count silhouettes unless they clearly show a human head shape
- If faces overlap or merge, count them as separate people if you can see distinct head shapes
- Be conservative: if unsure whether something is a person, don't count it

Respond ONLY with JSON: {"count": N, "confidence": "high|medium|low", "notes": "brief explanation"}`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Count the EXACT number of distinct human figures visible in this image. I expect ${expectedCount} people. Count carefully.`
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 150,
        temperature: 0.1, // Low temperature for consistent counting
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[COUNT-VERIFY] Vision API error: ${response.status} - ${errorText}`);
      return {
        ok: true, // Fail open - don't block on API errors
        expectedCount,
        detectedCount: expectedCount,
        confidence: "low",
        notes: `Vision API error: ${response.status}. Assuming correct count.`,
      };
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    // Parse JSON response
    let parsed: { count: number; confidence: string; notes: string };
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error(`[COUNT-VERIFY] Failed to parse response: ${content}`);
      // Try to extract just a number
      const numMatch = content.match(/(\d+)/);
      parsed = {
        count: numMatch ? parseInt(numMatch[1]) : expectedCount,
        confidence: "low",
        notes: "Failed to parse structured response",
      };
    }
    
    const detectedCount = parsed.count;
    const confidence = (parsed.confidence || "medium") as "high" | "medium" | "low";
    const notes = parsed.notes || "";
    
    const ok = detectedCount === expectedCount;
    
    console.log(`[COUNT-VERIFY] Expected: ${expectedCount}, Detected: ${detectedCount}, OK: ${ok}, Confidence: ${confidence}`);
    if (notes) {
      console.log(`[COUNT-VERIFY] Notes: ${notes}`);
    }
    
    return {
      ok,
      expectedCount,
      detectedCount,
      confidence,
      notes,
    };
    
  } catch (error) {
    console.error(`[COUNT-VERIFY] Verification failed:`, error);
    return {
      ok: true, // Fail open
      expectedCount,
      detectedCount: expectedCount,
      confidence: "low",
      notes: `Verification error: ${error}. Assuming correct count.`,
    };
  }
}

/**
 * Build a stricter "lineup" fallback prompt for COUNT LOCK retries
 * When initial image has wrong count, use this simplified composition
 * v5.3: Added LAYOUT LOCK + uniqueness anchors
 */
export function buildCountLockFallbackPrompt(
  expectedCount: number,
  location: string,
  isWrong: boolean,
  styleConfig: { basePrompt?: string; technicalStyle?: string; colorOverride?: string }
): string {
  const styleBlock = styleConfig.basePrompt || "Editorial cartoon illustration in graphic novel style with cel shading and bold outlines.";
  const colorBlock = styleConfig.colorOverride || "muted cool grays, dirty blues, nicotine-brown highlights, desaturated skin tones, NO green color cast, NO olive tint";
  
  // Dynamic row arrangement based on count
  let layoutArrangement: string;
  if (expectedCount <= 3) {
    layoutArrangement = `Arrange them in a SINGLE ROW facing the viewer.`;
  } else if (expectedCount <= 5) {
    const frontRow = Math.ceil(expectedCount / 2);
    const backRow = expectedCount - frontRow;
    layoutArrangement = `Arrange them in TWO ROWS: ${frontRow} in front, ${backRow} behind.`;
  } else if (expectedCount <= 7) {
    const frontRow = 4;
    const backRow = expectedCount - frontRow;
    layoutArrangement = `Arrange them in TWO ROWS: ${frontRow} in front, ${backRow} behind.`;
  } else {
    const frontRow = Math.ceil(expectedCount / 3);
    const middleRow = Math.ceil((expectedCount - frontRow) / 2);
    const backRow = expectedCount - frontRow - middleRow;
    layoutArrangement = `Arrange them in THREE ROWS: ${frontRow} front, ${middleRow} middle, ${backRow} back.`;
  }
  
  // Uniqueness anchors - randomized identity tags
  const identityTags = [
    "curly dark hair", "thick-framed glasses", "short bob haircut", "buzz cut",
    "hoodie", "denim jacket", "blonde hair", "ponytail", "beard", "headband",
    "bandana", "cap", "long straight hair", "red shirt", "striped sweater",
  ];
  const shuffled = [...identityTags].sort(() => Math.random() - 0.5);
  const personTags = shuffled.slice(0, expectedCount);
  const uniquenessBlock = personTags.map((tag, i) => `Person ${i + 1}: ${tag}`).join(", ");
  
  const uncannySuffix = isWrong 
    ? `One figure (NOT in center) has a frozen smile and eyes staring at viewer. This person looks subtly wrong but not supernatural.`
    : "";
  
  return [
    `ORIENTATION LOCK: Upright portrait 9:16, not rotated.`,
    ``,
    `STYLE: ${styleBlock}`,
    `Colors: ${colorBlock}`,
    ``,
    `SCENE: Group portrait composition showing EXACTLY ${expectedCount} people.`,
    `Location: ${location}`,
    ``,
    `LAYOUT LOCK (MANDATORY):`,
    `Show EXACTLY ${expectedCount} distinct people, all fully inside frame.`,
    layoutArrangement,
    `Every face must be VISIBLE - no one blocked by another person.`,
    `No cropping: all heads fully visible inside frame.`,
    ``,
    `UNIQUENESS ANCHORS: ${uniquenessBlock}`,
    ``,
    `COUNT LOCK (ABSOLUTE REQUIREMENT):`,
    `- Draw EXACTLY ${expectedCount} distinct human figures, no more, no fewer.`,
    `- Every person's HEAD and FACE must be fully visible and distinct.`,
    `- NO overlapping heads, NO cropped faces, NO hidden figures.`,
    `- Clear spacing between each person.`,
    uncannySuffix,
    ``,
    `MUST NOT: cropped heads, partial faces, merged figures, extra silhouettes, more than ${expectedCount} people, fewer than ${expectedCount} people, green color cast, olive tint, text, words, letters.`,
  ].filter(Boolean).join("\n");
}