/**
 * Story Contract Builder v1.0
 * 
 * Builds structured prompts with beat tags based on StoryProfile + DNA.
 * Enforces narrative contracts and validates compliance.
 * 
 * The "contract" approach treats each requirement as a binding rule,
 * not a suggestion. The model must fulfill each beat, each motif mention,
 * each grounding detail.
 * 
 * Beat Tags: [BEAT_1:OPENING], [BEAT_2:DEVELOPMENT], etc.
 * These are stripped in post-processing but enforce structure during generation.
 */

import type { StoryProfile } from './story_profile.ts';
import { pickFromTropePack } from './story_dna.ts';

// =====================================================
// TYPES
// =====================================================

/** Story DNA structure for contract (simplified view) */
export interface StoryDNA {
  era: string;
  states: string[];
  location_type: string;
  voice_format: string;
  threat: {
    what: string;
    behavior: string;
  };
  repeating_detail: string;
  unique_element: string;
  escalation: string;
  authority_response: string;
  ending: {
    resolution: string;
    final_image: string;
  };
  emotional_target: string;
  concept_hash?: string;
  // DNA v3 additions
  vibe_preset?: string;
  opening_style?: string;
  ending_type?: string;
}

/**
 * Convert full StoryDNA (from story_dna.ts) to contract-compatible format
 * The story_dna.ts uses nested objects with .label and .description,
 * while contract needs flat strings.
 */
export function convertDNAToContract(fullDna: any): StoryDNA {
  const converted: any = {
    era: fullDna.era?.label || fullDna.era || 'late 1970s',
    states: fullDna.specific_states || fullDna.states || ['rural America'],
    location_type: fullDna.location?.label || fullDna.location_type || 'isolated road',
    voice_format: fullDna.narrative_artifact?.label || fullDna.voice_format || 'documentary narration',
    threat: {
      what: fullDna.threat_manifestation?.description || fullDna.threat?.what || 'something unnatural',
      behavior: fullDna.threat_behavior?.description || fullDna.threat?.behavior || 'watching, following',
    },
    repeating_detail: fullDna.repeating_detail?.description || fullDna.repeating_detail || 'a recurring element',
    unique_element: fullDna.weird_axis?.description || fullDna.unique_element || 'something unexplainable',
    escalation: fullDna.escalation?.description || fullDna.escalation || 'it spreads, it worsens',
    authority_response: fullDna.authority?.phrase || fullDna.authority_response || 'investigation closed',
    ending: {
      resolution: fullDna.ending_knowledge?.description || fullDna.ending?.resolution || 'unresolved',
      final_image: fullDna.ending_imagery?.description || fullDna.ending?.final_image || 'a haunting final image',
    },
    emotional_target: fullDna.emotion?.description || fullDna.emotional_target || 'unease',
    concept_hash: fullDna.concept_hash,
    vibe_preset: fullDna.genre || fullDna.vibe_preset,
    opening_style: fullDna.subgenre?.label,
    ending_type: fullDna.ending_knowledge?.id,
  };
  
  // Pass through counting_horror data for one_too_many preset
  if (fullDna.counting_horror) {
    converted.counting_horror = fullDna.counting_horror;
  }
  if (fullDna.trope_selection) {
    converted.trope_selection = fullDna.trope_selection;
  }
  
  return converted as StoryDNA;
}

/** Generated contract for story generation */
export interface StoryContract {
  /** The full prompt to send to the LLM */
  prompt: string;
  /** Beat markers to expect in response */
  expectedBeats: string[];
  /** Minimum motif mentions required */
  requiredMotifMentions: number;
  /** Whether final image must appear */
  requiresFinalImage: boolean;
  /** Word count range */
  wordRange: { min: number; max: number };
  /** Profile used for this contract */
  profile: StoryProfile;
  /** DNA used for this contract */
  dna: StoryDNA;
}

/** Compliance check result */
export interface ComplianceResult {
  passed: boolean;
  score: number; // 0-100
  issues: ComplianceIssue[];
  metrics: ComplianceMetrics;
  /** Hard failures that require immediate repair */
  hardFailures: string[];
  /** Whether the story was canonicalized before compliance check */
  canonicalized?: boolean;
  /** Notes from canonicalization pass */
  canonicalizationNotes?: string[];
}

export interface ComplianceIssue {
  type: 'beat' | 'motif' | 'unique_element' | 'final_image' | 'word_count' | 'marker' | 'grounding' | 'format' | 'counting_lane';
  severity: 'error' | 'warning';
  message: string;
}

export interface ComplianceMetrics {
  wordCount: number;
  beatCount: number;
  motifMentions: number;
  uniqueElementMentions: number;
  hasFinalImage: boolean;
  markerCount: number;
  groundingDetails: number;
  /** Per-beat grounding analysis */
  groundingPerBeat: Array<{ beat: number; count: number }>;
  /** Beats missing required grounding */
  groundingMissingBeats: number[];
  /** Word count range validation */
  wordCountInRange: boolean;
  wordCountMin: number;
  wordCountMax: number;
}

/** Canonicalization result */
export interface CanonicalizationResult {
  /** Canonicalized text with normalized beat tags */
  text: string;
  /** Whether any changes were made */
  changed: boolean;
  /** Notes about what was canonicalized */
  notes: string[];
}

// =====================================================
// CANONICALIZATION
// =====================================================

/**
 * Canonicalize beat tags in story text before compliance check.
 * - Normalizes common tag variants into [BEAT_#:LABEL]
 * - Removes duplicate beat tags (keeps first occurrence)
 * - Reorders beats if all expected beats exist but are out of order
 * 
 * @param story - Raw story text
 * @param expectedBeats - Expected beat tags in order
 * @returns Canonicalized result with text and notes
 */
export function canonicalizeStory(story: string, expectedBeats: string[]): CanonicalizationResult {
  const notes: string[] = [];
  let text = story;
  let changed = false;
  
  // =================================================
  // Step 1: Normalize common tag variants
  // =================================================
  
  // Variant patterns to normalize:
  // [BEAT 1: OPENING] -> [BEAT_1:OPENING]
  // [BEAT-1:OPENING] -> [BEAT_1:OPENING]
  // [BEAT_1 : OPENING] -> [BEAT_1:OPENING]
  // [beat_1:opening] -> [BEAT_1:OPENING]
  // [BEAT1:OPENING] -> [BEAT_1:OPENING]
  // [[BEAT_1:OPENING]] -> [BEAT_1:OPENING]
  
  // Pattern to match all beat-like tags with variations
  const variantPattern = /\[{1,2}\s*BEAT[\s_-]?(\d+)\s*[:\s]\s*([^\]\n]+?)\s*\]{1,2}/gi;
  
  const normalizedText = text.replace(variantPattern, (match, num, label) => {
    const normalizedLabel = label.trim().toUpperCase().replace(/\s+/g, '_');
    const normalized = `[BEAT_${num}:${normalizedLabel}]`;
    if (match !== normalized) {
      notes.push(`normalized: "${match}" → "${normalized}"`);
      changed = true;
    }
    return normalized;
  });
  text = normalizedText;
  
  // =================================================
  // Step 2: Remove duplicate beat tags (keep first)
  // =================================================
  const beatPattern = /\[BEAT_(\d+):([^\]]+)\]/g;
  const seenBeats = new Set<string>();
  
  text = text.replace(beatPattern, (match, num) => {
    const beatKey = `BEAT_${num}`;
    if (seenBeats.has(beatKey)) {
      notes.push(`removed_duplicate: "${match}"`);
      changed = true;
      return ''; // Remove duplicate
    }
    seenBeats.add(beatKey);
    return match;
  });
  
  // Clean up any double spaces/newlines from removed tags
  text = text.replace(/\n{3,}/g, '\n\n').replace(/  +/g, ' ');
  
  // =================================================
  // Step 3: Check if beats need reordering
  // =================================================
  const currentBeats: { tag: string; index: number; num: number }[] = [];
  let beatMatch;
  const beatRegex = /\[BEAT_(\d+):[^\]]+\]/g;
  
  while ((beatMatch = beatRegex.exec(text)) !== null) {
    currentBeats.push({
      tag: beatMatch[0],
      index: beatMatch.index,
      num: parseInt(beatMatch[1], 10),
    });
  }
  
  // Check if all expected beats exist
  const foundBeatNums = new Set(currentBeats.map(b => b.num));
  const expectedBeatNums = expectedBeats.map((_, i) => i + 1);
  const allExpectedExist = expectedBeatNums.every(n => foundBeatNums.has(n));
  
  // Check if they're out of order
  const isOutOfOrder = allExpectedExist && currentBeats.some((b, i) => i > 0 && b.num <= currentBeats[i - 1].num);
  
  if (isOutOfOrder && currentBeats.length === expectedBeats.length) {
    notes.push(`reordering: beats were out of order`);
    changed = true;
    
    // Extract beat sections and reorder
    const beatSections: { num: number; content: string }[] = [];
    
    for (let i = 0; i < currentBeats.length; i++) {
      const start = currentBeats[i].index;
      const end = i < currentBeats.length - 1 ? currentBeats[i + 1].index : text.length;
      beatSections.push({
        num: currentBeats[i].num,
        content: text.slice(start, end),
      });
    }
    
    // Sort by beat number
    beatSections.sort((a, b) => a.num - b.num);
    
    // Get any content before first beat
    const preContent = text.slice(0, currentBeats[0].index);
    
    // Reconstruct
    text = preContent + beatSections.map(s => s.content).join('');
  }
  
  return { text, changed, notes };
}

// =====================================================
// CONTRACT BUILDER
// =====================================================

/**
 * Build a story generation prompt from DNA and StoryProfile.
 * Creates a structured "contract" with beat tags and requirements.
 */
export function buildStoryContract(dna: StoryDNA, profile: StoryProfile): StoryContract {
  const lines: string[] = [];
  
  // =================================================
  // HEADER: Role & Task
  // =================================================
  lines.push('You are a master short-form storyteller. Your task is to write a complete, self-contained micro-narrative.');
  lines.push('');
  lines.push('CRITICAL: This is a CONTRACT. Each requirement below is BINDING, not a suggestion.');
  lines.push('Failure to include any required element means the story fails validation.');
  lines.push('');
  
  // =================================================
  // BEAT STRUCTURE
  // =================================================
  const beatLabels = profile.beatStructure.beatLabels;
  const beatCount = profile.beatStructure.beatCount;
  const wordsPerBeat = Math.floor(profile.wordCount.target / beatCount);
  
  lines.push('=== BEAT STRUCTURE (REQUIRED) ===');
  lines.push(`Your story MUST contain exactly ${beatCount} beats, marked with tags.`);
  lines.push('Each beat tag MUST appear at the start of that section.');
  lines.push('');
  
  // Beat budgeting for tight word counts (esp. one_too_many)
  const isCountingPreset = profile.genreFlags?.use_trope_pack === 'one_too_many';
  const beatBudgets = isCountingPreset && beatCount === 5
    ? [25, 30, 30, 30, 25]  // 140 total, tighter for counting horror
    : null;
  
  for (let i = 0; i < beatCount; i++) {
    const label = beatLabels[i] || `BEAT_${i + 1}`;
    const tag = `[BEAT_${i + 1}:${label}]`;
    lines.push(`${tag}`);
    
    // Use specific budget if available, otherwise even split
    const budgetWords = beatBudgets ? beatBudgets[i] : wordsPerBeat;
    lines.push(`  - Approximately ${budgetWords} words`);
    
    // Beat-specific guidance based on label
    const guidance = getBeatGuidance(label, dna, profile, i, beatCount);
    if (guidance) {
      lines.push(`  - ${guidance}`);
    }
    
    // Grounding requirement
    if (profile.beatStructure.requireGroundingDetail) {
      const groundingTypes = profile.beatStructure.groundingTypes.join('/');
      lines.push(`  - Include a grounding detail (${groundingTypes})`);
    }
    
    lines.push('');
  }
  
  // =================================================
  // TROPE PACK (Micro-Preset Randomization)
  // =================================================
  const tropePackName = profile.genreFlags?.use_trope_pack;
  console.log(`[CONTRACT] Trope pack check: genreFlags=${JSON.stringify(profile.genreFlags)}, tropePackName=${tropePackName}`);
  
  if (tropePackName && typeof tropePackName === 'string') {
    console.log(`[CONTRACT] Building trope pack section for: ${tropePackName}`);
    const tropeSelection = pickFromTropePack(tropePackName);
    
    // Check if DNA has counting_horror data from lane lock
    const countingHorror = (dna as any).counting_horror;
    console.log(`[CONTRACT] DNA counting_horror=${countingHorror ? 'present' : 'missing'}, tropeSelection=${tropeSelection ? 'present' : 'missing'}`);
    
    if (tropeSelection || countingHorror) {
      lines.push('=== MICRO-PRESET ELEMENTS (MANDATORY) ===');
      lines.push('');
      
      if (tropePackName === 'one_too_many') {
        console.log(`[CONTRACT] Adding one_too_many counting horror instructions`);
        // Use lane-locked counting data if available, else trope selection
        const ch = countingHorror || {
          start_count: tropeSelection?.group_size?.start || 4,
          wrong_count: tropeSelection?.group_size?.extra || 5,
          container: tropeSelection?.container,
          glitch: tropeSelection?.glitch,
          external_witness: tropeSelection?.external_witness,
          dialogue: tropeSelection?.dialogue_line,
          evidence: tropeSelection?.evidence_source,
        };
        const groupType = tropeSelection?.group_type || 'people';
        
        // NUMBERS FIRST - Make them impossible to miss
        lines.push('╔══════════════════════════════════════════════════════════════╗');
        lines.push(`║  THE NUMBERS: ${ch.start_count} ${groupType.toUpperCase()} → COUNT SHOWS ${ch.wrong_count}  ║`);
        lines.push('╚══════════════════════════════════════════════════════════════╝');
        lines.push('');
        lines.push(`MEMORIZE THESE TWO NUMBERS. USE ONLY THESE:`);
        lines.push(`  ★ CORRECT: ${ch.start_count} (how many there SHOULD be)`);
        lines.push(`  ★ WRONG:   ${ch.wrong_count} (what every count shows)`);
        lines.push('');
        lines.push(`The group is ${ch.start_count} ${groupType}. Every count shows ${ch.wrong_count}. That's it.`);
        lines.push(`Never use any other numbers for group size. Not ${ch.start_count - 1}, not ${ch.wrong_count + 1}, only ${ch.start_count} and ${ch.wrong_count}.`);
        lines.push('');
        lines.push('---');
        lines.push('');
        lines.push('THIS IS COUNTING HORROR. THE STORY CANNOT WORK WITHOUT EXPLICIT NUMBERS.');
        lines.push('');
        lines.push('=== MANDATORY COUNTING STRUCTURE ===');
        lines.push('');
        lines.push('EXPLICIT NUMBERS (REQUIRED):');
        lines.push(`  CORRECT COUNT: ${ch.start_count} (the number that SHOULD be true)`);
        lines.push(`  WRONG COUNT: ${ch.wrong_count} (what the count keeps showing - always one more)`);
        lines.push(`  GROUP TYPE: ${groupType}`);
        lines.push('');
        lines.push('CRITICAL NUMBER RULES:');
        lines.push(`  • The story starts with EXACTLY ${ch.start_count} ${groupType}. No other number.`);
        lines.push(`  • Every count in the story shows ${ch.wrong_count}. Never ${ch.start_count}, never any other number.`);
        lines.push(`  • The jump is ONLY ${ch.start_count}→${ch.wrong_count}. No intermediate counts like ${ch.start_count}→${ch.start_count + 1}→${ch.wrong_count}.`);
        lines.push(`  • Use "${ch.start_count}" and "${ch.wrong_count}" consistently throughout. Do not switch to different numbers.`);
        lines.push('');
        lines.push('GROUP IDENTITY RULES:');
        lines.push(`  • Pick ONE group identity and stick with it (e.g., "friends" or "coworkers" - NOT both).`);
        lines.push(`  • Refer to them the same way throughout the story.`);
        lines.push('');
        lines.push(`Example: "There were ${ch.start_count} of us. I counted ${ch.wrong_count}. Counted again - still ${ch.wrong_count}."`);
        lines.push('');
        
        if (ch.container) {
          lines.push('CLOSED CONTAINER (REQUIRED):');
          lines.push(`  SETTING: ${ch.container}`);
          lines.push('  This container must be CLOSED/SEALED during the count anomaly.');
          lines.push('  No one enters or leaves. The extra appears from nowhere.');
          lines.push('');
        }
        
        lines.push('RECOUNT ATTEMPTS (REQUIRED - minimum 2):');
        lines.push('  The protagonist must count at least twice. Each count shows the same wrong number.');
        lines.push('  Different counting methods should yield the same impossible result:');
        lines.push('    - Visual headcount');
        lines.push('    - Counting by seat/position');
        lines.push('    - Reviewing photos/records');
        lines.push('    - Someone else counting');
        lines.push('');
        
        if (ch.dialogue) {
          lines.push('DIALOGUE (REQUIRED):');
          lines.push('  At least ONE character must verbally acknowledge the count problem.');
          lines.push(`  USE THIS LINE: "${ch.dialogue}"`);
          lines.push('  Or a close variation. The count MUST be spoken aloud.');
          lines.push('');
        }
        
        if (ch.external_witness) {
          lines.push('EXTERNAL WITNESS (REQUIRED):');
          lines.push(`  WITNESS: ${ch.external_witness}`);
          lines.push('  This outsider must independently confirm the wrong count.');
          lines.push('  They have no reason to lie. They count what they see.');
          lines.push('');
        }
        
        if (ch.glitch) {
          lines.push('PHYSICAL GLITCH (REQUIRED):');
          lines.push(`  GLITCH: ${ch.glitch}`);
          lines.push('  This must happen AFTER the count is acknowledged.');
          lines.push('  Something in the world responds to the count being wrong.');
          lines.push('');
        }
        
        if (ch.evidence) {
          lines.push('FINAL IMAGE / VISUAL PROOF (REQUIRED):');
          lines.push(`  EVIDENCE: ${ch.evidence}`);
          lines.push(`  This shows ${ch.wrong_count} people clearly. The extra face looks at camera.`);
          lines.push('  The photo/video/record cannot be explained away.');
          lines.push('');
        }
        
        lines.push('=== BEAT STRUCTURE FOR COUNTING HORROR ===');
        lines.push(`(Remember: ${ch.start_count} ${groupType} → count shows ${ch.wrong_count})`);
        lines.push('');
        lines.push('BEAT 1 - NORMAL:');
        lines.push(`  "There were ${ch.start_count} of us." Establish EXACTLY ${ch.start_count} ${groupType}. Not ${ch.start_count - 1}, not ${ch.start_count + 1}.`);
        lines.push('');
        lines.push('BEAT 2 - FIRST WRONG COUNT:');
        lines.push(`  Count shows ${ch.wrong_count}. "I counted ${ch.wrong_count}." Protagonist recounts. Still ${ch.wrong_count}.`);
        lines.push('');
        lines.push('BEAT 3 - CONFIRMATION:');
        if (ch.external_witness) {
          lines.push(`  ${ch.external_witness} also counts ${ch.wrong_count}.`);
        } else {
          lines.push(`  Someone else counts. Also ${ch.wrong_count}.`);
        }
        lines.push(`  Dialogue: Someone says "${ch.wrong_count}" or "one too many" aloud.`);
        lines.push('');
        lines.push('BEAT 4 - ESCALATION:');
        if (ch.glitch) {
          lines.push(`  ${ch.glitch}`);
        } else {
          lines.push('  Something physical responds to the anomaly.');
        }
        lines.push(`  The count is still ${ch.wrong_count}. It won't change.`);
        lines.push('');
        lines.push('BEAT 5 - PROOF (CRITICAL):');
        lines.push(`  ★★★ THE EVIDENCE SHOWS EXACTLY ${ch.wrong_count} PEOPLE. NOT ${ch.wrong_count + 1}, NOT ${ch.wrong_count + 2}. EXACTLY ${ch.wrong_count}. ★★★`);
        lines.push(`  The photo/video/record clearly shows ${ch.wrong_count} people.`);
        lines.push(`  One more than there should be (should be ${ch.start_count}, shows ${ch.wrong_count}).`);
        lines.push('  The extra face is looking directly at the camera.');
        lines.push('');
        
        lines.push('=== WHAT NOT TO DO ===');
        lines.push('');
        lines.push('DO NOT:');
        lines.push('  ❌ Use vague numbers ("a few", "some", "several")');
        lines.push(`  ❌ Use any numbers other than ${ch.start_count} (correct) and ${ch.wrong_count} (wrong) for group size`);
        lines.push(`  ❌ Have the final evidence show a DIFFERENT number than ${ch.wrong_count}`);
        lines.push(`  ❌ Have intermediate counts (like ${ch.start_count}→${ch.start_count + 1}→${ch.wrong_count})`);
        lines.push(`  ❌ Let the count drift higher (if count is ${ch.wrong_count}, it stays ${ch.wrong_count}, never becomes ${ch.wrong_count + 1} or ${ch.wrong_count + 2})`);
        lines.push('  ❌ Switch group identity mid-story (e.g., "friends" becoming "coworkers")');
        lines.push('  ❌ Make the threat about something OTHER than the count');
        lines.push('  ❌ Add supernatural elements that distract from counting');
        lines.push('  ❌ Explain where the extra came from');
        lines.push('  ❌ Make the extra person visibly different or monstrous');
        lines.push('  ❌ Resolve or explain the anomaly');
        lines.push('');
        lines.push('The extra person should be NORMAL LOOKING. That\'s what makes it scary.');
        lines.push('They fit in perfectly. The only problem is the math.');
        lines.push('');
      }
    }
  }
  
  // =================================================
  // SETTING & ERA
  // =================================================
  lines.push('=== SETTING (REQUIRED) ===');
  lines.push(`ERA: ${dna.era}`);
  lines.push(`LOCATION TYPE: ${dna.location_type}`);
  lines.push(`REGION: ${dna.states.join(' or ')}`);
  
  if (profile.embodiment.eraLevel === 'objects' || profile.embodiment.eraLevel === 'full_immersion') {
    lines.push('');
    lines.push('EMBODIMENT REQUIREMENT:');
    if (profile.embodiment.requirePeriodObjects) {
      lines.push(`  - Include at least one era-authentic object/technology from ${dna.era}`);
    }
    if (profile.embodiment.requireLocationSensory) {
      lines.push(`  - Include at least one sensory detail specific to ${dna.location_type}`);
    }
  }
  lines.push('');
  
  // =================================================
  // VOICE FORMAT
  // =================================================
  lines.push('=== VOICE FORMAT (REQUIRED) ===');
  lines.push(`FORMAT: ${profile.voiceFormat.format}`);
  lines.push(`POV: ${profile.voiceFormat.povConstraint}`);
  
  if (profile.voiceFormat.styleNotes) {
    lines.push(`STYLE: ${profile.voiceFormat.styleNotes}`);
  }
  
  if (profile.voiceFormat.enforceMarkers && profile.voiceFormat.structuralMarkers.length > 0) {
    lines.push('');
    lines.push('STRUCTURAL MARKERS (must include at least 2):');
    for (const marker of profile.voiceFormat.structuralMarkers) {
      lines.push(`  ${marker}`);
    }
    
    if (profile.voiceFormat.exampleFragment) {
      lines.push('');
      lines.push('EXAMPLE FRAGMENT:');
      lines.push(profile.voiceFormat.exampleFragment);
    }
  }
  lines.push('');
  
  // =================================================
  // NARRATIVE ELEMENTS
  // =================================================
  lines.push('=== NARRATIVE ELEMENTS (REQUIRED) ===');
  lines.push('');
  
  // Threat
  lines.push('THREAT:');
  lines.push(`  What: ${dna.threat.what}`);
  lines.push(`  Behavior: ${dna.threat.behavior}`);
  lines.push('');
  
  // Motif/Repeating Detail
  lines.push('MOTIF (Repeating Detail):');
  lines.push(`  "${dna.repeating_detail}"`);
  lines.push(`  REQUIREMENT: Must appear at least ${profile.motif.minMentions} times`);
  if (profile.motif.shouldEscalate) {
    lines.push(`  REQUIREMENT: Each mention should ESCALATE or TRANSFORM`);
  }
  if (profile.motif.distribution === 'spread') {
    lines.push(`  REQUIREMENT: Spread across beats (not clustered)`);
  }
  lines.push('');
  
  // Unique Element
  lines.push('UNIQUE ELEMENT (Weird Axis):');
  lines.push(`  "${dna.unique_element}"`);
  lines.push(`  REQUIREMENT: Must appear at least ${profile.uniqueElement.minAppearances} times`);
  if (profile.uniqueElement.requireEscalation) {
    lines.push(`  REQUIREMENT: Second appearance must WORSEN or REVEAL new implication`);
  }
  if (profile.uniqueElement.finalMentionPosition !== 'any') {
    lines.push(`  REQUIREMENT: Final mention should be in ${profile.uniqueElement.finalMentionPosition} beat`);
  }
  lines.push('');
  
  // =================================================
  // ESCALATION
  // =================================================
  lines.push('ESCALATION:');
  lines.push(`  ${dna.escalation}`);
  lines.push('');
  
  // =================================================
  // AUTHORITY (if applicable)
  // =================================================
  if (profile.authority.style !== 'absent' && dna.authority_response) {
    lines.push('AUTHORITY RESPONSE:');
    lines.push(`  ${dna.authority_response}`);
    if (profile.authority.style === 'procedural') {
      lines.push(`  REQUIREMENT: Include at least ${profile.authority.minDetailSentences} procedural detail sentence(s)`);
    }
    lines.push('');
  }
  
  // =================================================
  // ENDING
  // =================================================
  lines.push('=== ENDING (REQUIRED) ===');
  lines.push(`RESOLUTION TYPE: ${dna.ending.resolution}`);
  
  if (profile.ending.enforceFinalImage) {
    lines.push('');
    lines.push('FINAL IMAGE (MUST appear in final beat):');
    lines.push(`  "${dna.ending.final_image}"`);
  }
  
  lines.push('');
  lines.push('CLOSURE CONSTRAINT:');
  const closureLevel = profile.ending.antiClosure;
  if (closureLevel >= 0.8) {
    lines.push('  MAXIMUM OPENNESS: Story must NOT resolve. No explanations, no comfort.');
    lines.push('  End with the horror ongoing or worsening. Leave the audience unsettled.');
    lines.push('  Forbidden: "but they were never seen again", "to this day no one knows"');
    lines.push('  The last beat should SHOW the horror continuing, not SUMMARIZE it.');
  } else if (closureLevel >= 0.5) {
    lines.push('  PARTIAL RESOLUTION: Some questions answered, others left open.');
    lines.push('  The ending should feel incomplete but not frustrating.');
  } else if (closureLevel >= 0.2) {
    lines.push('  MOSTLY RESOLVED: Main conflict resolved but room for reflection.');
  } else {
    lines.push('  FULL RESOLUTION: Provide clear closure and takeaway.');
  }
  
  if (profile.ending.takeaway?.enabled) {
    lines.push('');
    lines.push(`TAKEAWAY (required): End with a ${profile.ending.takeaway.style}-style conclusion.`);
    if (profile.ending.takeaway.style === 'question') {
      lines.push('  Ask the reader/listener a thought-provoking question.');
    } else if (profile.ending.takeaway.style === 'action') {
      lines.push('  Give the reader/listener something actionable to try.');
    } else if (profile.ending.takeaway.style === 'fact') {
      lines.push('  Reinforce the key fact or insight.');
    } else if (profile.ending.takeaway.style === 'reflection') {
      lines.push('  Invite personal reflection or connection.');
    }
  }
  lines.push('');
  
  // =================================================
  // EMOTIONAL TARGET
  // =================================================
  lines.push('=== EMOTIONAL TARGET ===');
  lines.push(`Target emotion: ${dna.emotional_target}`);
  lines.push('');
  
  // =================================================
  // WORD COUNT
  // =================================================
  const minWords = profile.wordCount.target - profile.wordCount.variance;
  const maxWords = profile.wordCount.target + profile.wordCount.variance;
  
  lines.push('=== WORD COUNT (REQUIRED) ===');
  lines.push(`RANGE: ${minWords}-${maxWords} words`);
  lines.push(`TARGET: ${profile.wordCount.target} words`);
  if (profile.wordCount.priority === 'structure') {
    lines.push('PRIORITY: Structure over word count. Hit all beats even if slightly over/under.');
  } else {
    lines.push('PRIORITY: Natural flow. Stay in range but let prose breathe.');
  }
  lines.push('');
  
  // =================================================
  // FORMAT INSTRUCTIONS (Output Mode aware)
  // =================================================
  lines.push('=== OUTPUT FORMAT ===');
  
  // Get output mode (default to narrative)
  const outputMode = profile.outputMode?.mode || 'narrative';
  
  // Mode-specific formatting instructions
  switch (outputMode) {
    case 'broadcast':
      lines.push('STYLE: Broadcast/News style');
      lines.push('- Short, punchy sentences (5-12 words typical)');
      lines.push('- Active voice preferred');
      lines.push('- Direct and immediate');
      lines.push('- No flowery language');
      break;
      
    case 'bullet_tips':
      lines.push('STYLE: Bullet Tips format');
      lines.push('- Use bullet points (•) for key tips within beats');
      lines.push('- Each beat can have 2-4 bullet points');
      lines.push('- Keep bullets concise (under 15 words each)');
      lines.push('- Include intro sentence before bullets');
      break;
      
    case 'explainer':
      lines.push('STYLE: Educational Explainer');
      lines.push('- Clear, didactic tone');
      lines.push('- Define terms when introducing them');
      lines.push('- Use "because" and "this means" to connect ideas');
      lines.push('- Build from simple to complex');
      break;
      
    case 'cta_script':
      lines.push('STYLE: Call-to-Action Script');
      lines.push('- Persuasive and direct');
      lines.push('- Address viewer directly ("you")');
      lines.push('- Include clear action phrases');
      lines.push('- Build urgency naturally');
      break;
      
    case 'narrative':
    default:
      lines.push('STYLE: Narrative prose');
      lines.push('- Traditional storytelling flow');
      lines.push('- Sensory details and atmosphere');
      lines.push('- Show, don\'t tell');
      break;
  }
  
  lines.push('');
  lines.push('Write the story with beat tags inline. Example structure:');
  lines.push('');
  lines.push(`[BEAT_1:${beatLabels[0] || 'OPENING'}]`);
  
  // Mode-specific example
  if (outputMode === 'bullet_tips') {
    lines.push('Introduction to this section...');
    lines.push('• First key point');
    lines.push('• Second key point');
  } else {
    lines.push('First section of story...');
  }
  
  lines.push('');
  lines.push(`[BEAT_2:${beatLabels[1] || 'DEVELOPMENT'}]`);
  lines.push('Second section of story...');
  lines.push('');
  lines.push('(Continue for all beats)');
  lines.push('');
  
  // FINAL checkpoint for one_too_many to hammer in the numbers
  const countingHorror = (dna as any).counting_horror;
  if (countingHorror) {
    const ch = countingHorror;
    lines.push('╔══════════════════════════════════════════════════════════════╗');
    lines.push(`║    ⚠️  FINAL NUMBER CHECK BEFORE WRITING  ⚠️                  ║`);
    lines.push(`║    CORRECT GROUP SIZE:  ${ch.start_count}                                      ║`);
    lines.push(`║    WRONG COUNT (anomaly): ${ch.wrong_count}                                    ║`);
    lines.push(`║    These are the ONLY TWO numbers you may use for group size ║`);
    lines.push(`║    ANY other number (${ch.wrong_count + 1}, ${ch.wrong_count + 2}, ${ch.start_count - 1}) = FAILURE                    ║`);
    lines.push('╚══════════════════════════════════════════════════════════════╝');
    lines.push('');
  }
  
  lines.push('IMPORTANT:');
  lines.push('- Beat tags MUST appear exactly as shown: [BEAT_N:LABEL]');
  
  if (outputMode !== 'bullet_tips') {
    lines.push('- Do NOT use asterisks, markdown, or other formatting');
  } else {
    lines.push('- Bullet points (•) are allowed within beats');
  }
  
  lines.push('- Write ONLY the story with beat tags - no commentary');
  lines.push('- Do NOT include "The End" or similar closers');
  lines.push('');
  
  // Build expected beats for validation
  const expectedBeats = beatLabels.map((label, i) => `[BEAT_${i + 1}:${label}]`);
  
  return {
    prompt: lines.join('\n'),
    expectedBeats,
    requiredMotifMentions: profile.motif.minMentions,
    requiresFinalImage: profile.ending.enforceFinalImage,
    wordRange: { min: minWords, max: maxWords },
    profile,
    dna,
  };
}

/**
 * Get beat-specific guidance based on label and position
 */
function getBeatGuidance(
  label: string, 
  dna: StoryDNA, 
  profile: StoryProfile, 
  index: number, 
  total: number
): string | null {
  const normalizedLabel = label.toUpperCase();
  
  // Position-based guidance
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const isPenultimate = index === total - 2;
  
  // Label-based guidance
  switch (normalizedLabel) {
    case 'OPENING':
    case 'SETUP':
    case 'HOOK':
      return `Establish ${dna.location_type} in ${dna.era}. Introduce first hint of wrongness.`;
      
    case 'EARLY_REPORTS':
      return `First accounts of ${dna.threat.what}. Keep it reportorial.`;
      
    case 'PATTERN':
    case 'DEVELOPMENT':
      return `Show the pattern emerging. Reference ${dna.repeating_detail}.`;
      
    case 'ESCALATION':
    case 'TURN':
      return `Stakes increase. ${dna.escalation}. Reference ${dna.unique_element}.`;
      
    case 'FINAL_IMAGE':
    case 'CLOSE':
    case 'IMPACT':
      if (profile.ending.enforceFinalImage) {
        return `MUST include: "${dna.ending.final_image}"`;
      }
      return `End with emotional impact. Target: ${dna.emotional_target}`;
      
    case 'CLIMAX':
      return `Peak tension. All elements converge.`;
      
    case 'FACT':
    case 'INSIGHT':
      return `Deliver the core information/insight clearly.`;
      
    case 'TAKEAWAY':
    case 'LESSON':
      if (profile.ending.takeaway?.enabled) {
        return `End with ${profile.ending.takeaway.style}-style takeaway.`;
      }
      return `Conclude with memorable point.`;
      
    case 'PROBLEM':
    case 'CHALLENGE':
      return `Present the problem/challenge clearly.`;
      
    case 'SOLUTION':
    case 'BREAKTHROUGH':
      return `Present the solution/breakthrough moment.`;
      
    case 'CONTEXT':
      return `Provide context/background for the fact.`;
      
    case 'STRUGGLE':
      return `Show the difficulty/effort involved.`;
      
    default:
      // Generic position-based guidance
      if (isFirst) {
        return `Opening beat. Hook the audience immediately.`;
      } else if (isLast) {
        return `Final beat. Land the emotional impact.`;
      } else if (isPenultimate) {
        return `Pre-climax. Build to final beat.`;
      }
      return null;
  }
}

// =====================================================
// COMPLIANCE CHECKER
// =====================================================

/**
 * Check if generated story complies with the contract.
 * v2.0: Strict word count enforcement, per-beat grounding, profile-driven unique element
 */
export function checkCompliance(story: string, contract: StoryContract): ComplianceResult {
  const issues: ComplianceIssue[] = [];
  const { profile, dna } = contract;
  
  // =================================================
  // WORD COUNT - Strict enforcement
  // =================================================
  const words = story.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const wordCountInRange = wordCount >= contract.wordRange.min && wordCount <= contract.wordRange.max;
  
  // Always report word count issues (severity depends on strictEnforcement)
  const wordCountSeverity = profile.wordCount.strictEnforcement ? 'error' : 'warning';
  
  if (wordCount < contract.wordRange.min) {
    issues.push({
      type: 'word_count',
      severity: wordCountSeverity,
      message: `Word count ${wordCount} below minimum ${contract.wordRange.min}`,
    });
  } else if (wordCount > contract.wordRange.max) {
    issues.push({
      type: 'word_count',
      severity: wordCountSeverity,
      message: `Word count ${wordCount} above maximum ${contract.wordRange.max}`,
    });
  }
  
  // Beat count
  const beatPattern = /\[BEAT_(\d+):([^\]]+)\]/g;
  const beatMatches = [...story.matchAll(beatPattern)];
  const beatCount = beatMatches.length;
  
  if (beatCount < profile.beatStructure.beatCount) {
    issues.push({
      type: 'beat',
      severity: 'error',
      message: `Found ${beatCount} beats, expected ${profile.beatStructure.beatCount}`,
    });
  }
  
  // Check specific beats
  for (const expected of contract.expectedBeats) {
    if (!story.includes(expected)) {
      issues.push({
        type: 'beat',
        severity: 'error',
        message: `Missing beat: ${expected}`,
      });
    }
  }
  
  // Motif mentions
  const motif = dna.repeating_detail.toLowerCase();
  const motifWords = motif.split(/\s+/).filter(w => w.length > 3);
  const storyLower = story.toLowerCase();
  
  // Count motif mentions (fuzzy - any core word)
  let motifMentions = 0;
  for (const word of motifWords) {
    const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = storyLower.match(regex);
    if (matches) {
      motifMentions = Math.max(motifMentions, matches.length);
    }
  }
  
  if (motifMentions < contract.requiredMotifMentions) {
    issues.push({
      type: 'motif',
      severity: 'error',
      message: `Motif "${dna.repeating_detail}" appears ${motifMentions} times, need ${contract.requiredMotifMentions}`,
    });
  }
  
  // Unique element mentions - profile-driven enforcement
  // Extended for micro-presets like "one_too_many" with trope pack phrase matching
  const uniqueElement = dna.unique_element.toLowerCase();
  const uniqueWords = uniqueElement.split(/\s+/).filter(w => w.length > 3);
  let uniqueMentions = 0;
  
  // Standard word matching
  for (const word of uniqueWords) {
    const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = storyLower.match(regex);
    if (matches) {
      uniqueMentions = Math.max(uniqueMentions, matches.length);
    }
  }
  
  // Extended phrase matching for specific presets
  // For "one_too_many" (counting horror), check for count-related phrases
  const isCountingHorror = 
    dna.unique_element.includes('counting') || 
    dna.unique_element.includes('one more') ||
    dna.unique_element.includes('extra person') ||
    (dna as any).vibe_preset === 'one_too_many' ||
    profile.genreFlags?.use_trope_pack === 'one_too_many';
  
  if (isCountingHorror) {
    // Additional count phrases to detect for one_too_many preset
    const countPhrases = [
      'one more than',
      'one too many',
      'count kept returning',
      "count didn't match",
      'count didnt match',
      'extra person',
      'extra seat',
      'one nobody recognized',
      "couldn't account for",
      'couldnt account for',
      'head count',
      'headcount',
      "who's the extra",
      'whos the extra',
      'there were supposed to be',
      'but we counted',
      'always came up one over',
      'seat count',
      'setting for one too many',
      'counted again',
      'one more head',
      'one more face',
      'didn\'t add up',
      'didnt add up',
      'came up short',
      'came up one over',
      'wrong number',
      'off by one',
    ];
    
    let phraseMatches = 0;
    for (const phrase of countPhrases) {
      if (storyLower.includes(phrase)) {
        phraseMatches++;
      }
    }
    
    // Use the higher of word matches or phrase matches
    uniqueMentions = Math.max(uniqueMentions, phraseMatches);
  }
  
  // Unique element severity: profile.uniqueElement.enforce determines if hard failure
  if (uniqueMentions < profile.uniqueElement.minAppearances) {
    const uniqueSeverity = profile.uniqueElement.enforce ? 'error' : 'warning';
    issues.push({
      type: 'unique_element',
      severity: uniqueSeverity,
      message: `Unique element "${dna.unique_element}" appears ${uniqueMentions} times, need ${profile.uniqueElement.minAppearances}`,
    });
  }
  
  // =================================================
  // COUNTING LANE CHECK (one_too_many preset)
  // Enhanced validation for true counting horror
  // =================================================
  const countingLaneMissingBeats: number[] = [];
  const countingHorrorIssues: string[] = [];
  
  if (isCountingHorror) {
    const storyLower = story.toLowerCase();
    
    // Get counting horror params from DNA if available
    const countingHorror = (dna as any).counting_horror;
    
    // ----------------------------------------
    // Check 1: EXPLICIT NUMBERS must appear
    // ----------------------------------------
    const numberPatterns = [
      // Digits
      /\b\d+\b/g,
      // Written numbers
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi,
      // Ordinals
      /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\b/gi,
    ];
    
    let hasExplicitNumbers = false;
    let foundNumbers: string[] = [];
    for (const pattern of numberPatterns) {
      const matches = story.match(pattern);
      if (matches) {
        foundNumbers.push(...matches);
        hasExplicitNumbers = true;
      }
    }
    
    if (!hasExplicitNumbers) {
      countingHorrorIssues.push('no explicit numbers found');
      issues.push({
        type: 'counting_lane',
        severity: 'error',
        message: 'Counting horror: No explicit numbers found. Story must contain specific numbers (e.g., "four", "5", "eighth")',
      });
    }
    
    // ----------------------------------------
    // Check 2: DIALOGUE indicating count problem
    // ----------------------------------------
    // Note: Handle both straight quotes ("") and curly quotes ("")
    const dialoguePatterns = [
      // Quoted speech with count words (straight and curly quotes)
      /[""][^""]*\b(count|counted|how many|number|extra|too many|supposed to be|should be|off by|wrong|one more)\b[^""]*[""]/gi,
      /[''][^'']*\b(count|counted|how many|number|extra|too many|supposed to be|should be|off by|wrong|one more)\b[^'']*['']/gi,
      // Common counting dialogue fragments
      /[""]?\s*that's\s*(not right|wrong|too many|off|impossible)\s*[""]?/gi,
      /[""][^""]*\d+[^""]*people[^""]*[""]/gi,
      /[""][^""]*(wait|but|no)[^""]*\d+[^""]*[""]/gi,
      // Specific counting horror dialogue
      /[""]I think we're one too many[.!]?[""]/gi,
      /[""]Wait[.…]*\s*count again[.!]?[""]/gi,
      /[""]Who'?s the extra\??[""]/gi,
      /[""]That can'?t be right[.!]?[""]/gi,
    ];
    
    let hasCountingDialogue = false;
    for (const pattern of dialoguePatterns) {
      if (pattern.test(story)) {
        hasCountingDialogue = true;
        break;
      }
    }
    
    if (!hasCountingDialogue) {
      countingHorrorIssues.push('no dialogue acknowledging count');
      issues.push({
        type: 'counting_lane',
        severity: 'warning',
        message: 'Counting horror: Missing dialogue where character verbally acknowledges the count problem',
      });
    }
    
    // ----------------------------------------
    // Check 3: RECOUNT attempt (count appears 2+ times)
    // ----------------------------------------
    const countActionPatterns = [
      /\bcounted\b/gi,
      /\brecount(ed)?\b/gi,
      /\bcounting\b/gi,
      /\bcount(ed)? again\b/gi,
      /\bcheckied\b/gi,
      /\bverif(y|ied)\b/gi,
    ];
    
    let countActionMatches = 0;
    for (const pattern of countActionPatterns) {
      const matches = story.match(pattern);
      if (matches) {
        countActionMatches += matches.length;
      }
    }
    
    if (countActionMatches < 2) {
      countingHorrorIssues.push(`only ${countActionMatches} count actions found (need 2+)`);
      issues.push({
        type: 'counting_lane',
        severity: 'warning',
        message: `Counting horror: Only ${countActionMatches} counting actions found. Need at least 2 recount attempts.`,
      });
    }
    
    // ----------------------------------------
    // Check 4: Basic counting tokens in beats 2-4
    // ----------------------------------------
    const countingTokens = [
      'count', 'counted', 'recount', 'recounted', 'counting',
      'number', 'numbers', 'numbered',
      'extra', 'one more', 'one too many', 'too many',
      'ninth', 'fifth', 'sixth', 'seventh', 'eighth', 'fourth', 'third',
      'seat', 'seats', 'seating',
      'headcount', 'head count',
      'photo', 'photograph', 'camera', 'selfie', 'picture',
      'reflection', 'reflections', 'mirror',
      "couldn't agree", 'couldnt agree', "didn't match", 'didnt match',
      'supposed to be', 'should have been', 'should be',
      'wrong number', 'off by one', 'one over', 'one short',
      'who was', 'who is that', 'recognize',
    ];
    
    // Get beats 2, 3, 4 content
    const beatRegex = /\[BEAT_(\d+):[^\]]+\]/g;
    const allBeatsForLane: Array<{ beat: number; start: number; end: number }> = [];
    let beatMatch;
    
    while ((beatMatch = beatRegex.exec(story)) !== null) {
      allBeatsForLane.push({ 
        beat: parseInt(beatMatch[1], 10), 
        start: beatMatch.index, 
        end: beatMatch.index + beatMatch[0].length 
      });
    }
    
    // Check beats 2, 3, 4 for counting tokens
    for (const targetBeat of [2, 3, 4]) {
      const beatIdx = allBeatsForLane.findIndex(b => b.beat === targetBeat);
      if (beatIdx === -1) continue;
      
      const beatInfo = allBeatsForLane[beatIdx];
      const endIndex = beatIdx < allBeatsForLane.length - 1 
        ? allBeatsForLane[beatIdx + 1].start 
        : story.length;
      const beatContent = story.slice(beatInfo.end, endIndex).toLowerCase();
      
      // Check if any counting token exists in this beat
      const hasCountingToken = countingTokens.some(token => beatContent.includes(token));
      
      if (!hasCountingToken) {
        countingLaneMissingBeats.push(targetBeat);
      }
    }
    
    if (countingLaneMissingBeats.length > 0) {
      issues.push({
        type: 'counting_lane',
        severity: 'error',
        message: `Counting horror: beats ${countingLaneMissingBeats.join(', ')} missing counting tokens (count/extra/photo/etc.)`,
      });
    }
    
    // ----------------------------------------
    // Check 5: External witness mention (if in DNA)
    // ----------------------------------------
    if (countingHorror?.external_witness) {
      const witnessTerms = countingHorror.external_witness.toLowerCase().split(/\s+/);
      const hasWitness = witnessTerms.some((term: string) => 
        term.length > 3 && storyLower.includes(term)
      );
      if (!hasWitness) {
        countingHorrorIssues.push('external witness not mentioned');
        issues.push({
          type: 'counting_lane',
          severity: 'warning',
          message: `Counting horror: External witness "${countingHorror.external_witness}" not found in story`,
        });
      }
    }
    
    // Log counting horror validation summary
    console.log(`[Contract] Counting horror validation:`);
    console.log(`  - Explicit numbers: ${hasExplicitNumbers ? '✓' : '✗'} (found: ${foundNumbers.slice(0, 5).join(', ')}...)`);
    console.log(`  - Counting dialogue: ${hasCountingDialogue ? '✓' : '✗'}`);
    console.log(`  - Count actions: ${countActionMatches} (need 2+)`);
    console.log(`  - Beats missing tokens: ${countingLaneMissingBeats.length > 0 ? countingLaneMissingBeats.join(', ') : 'none'}`);
    if (countingHorrorIssues.length > 0) {
      console.log(`  - Issues: ${countingHorrorIssues.join('; ')}`);
    }
  }
  
  // Final image check
  let hasFinalImage = false;
  if (contract.requiresFinalImage && dna.ending.final_image) {
    const finalImage = dna.ending.final_image.toLowerCase();
    const finalImageWords = finalImage.split(/\s+/).filter(w => w.length > 3);
    
    // Check if final beat contains final image elements
    const lastBeatIndex = story.lastIndexOf('[BEAT_');
    if (lastBeatIndex !== -1) {
      const finalBeatContent = story.slice(lastBeatIndex).toLowerCase();
      for (const word of finalImageWords) {
        if (finalBeatContent.includes(word)) {
          hasFinalImage = true;
          break;
        }
      }
    }
    
    if (!hasFinalImage) {
      issues.push({
        type: 'final_image',
        severity: 'error',
        message: `Final image "${dna.ending.final_image}" not found in final beat`,
      });
    }
  } else {
    hasFinalImage = true; // Not required
  }
  
  // =================================================
  // Output Mode format check
  // =================================================
  const outputMode = profile.outputMode?.mode || 'narrative';
  
  // Check for bullets in non-bullet modes
  const hasBullets = /[•\-\*]\s+\w/.test(story);
  const hasNumberedList = /^\s*\d+[\.\)]\s+\w/m.test(story);
  
  if (outputMode === 'bullet_tips') {
    // In bullet_tips mode, bullets are expected
    if (!hasBullets) {
      issues.push({
        type: 'format',
        severity: 'warning',
        message: 'bullet_tips mode expects bullet points but none found',
      });
    }
  } else if (!profile.outputMode?.allowBullets && hasBullets) {
    // In other modes, bullets are not allowed unless explicitly enabled
    issues.push({
      type: 'format',
      severity: 'warning',
      message: 'Unexpected bullet points in non-bullet mode',
    });
  }
  
  if (!profile.outputMode?.allowNumberedLists && hasNumberedList) {
    issues.push({
      type: 'format',
      severity: 'warning',
      message: 'Unexpected numbered list in output',
    });
  }
  
  // Structural markers check
  let markerCount = 0;
  if (profile.voiceFormat.enforceMarkers) {
    for (const marker of profile.voiceFormat.structuralMarkers) {
      if (story.includes(marker)) {
        markerCount++;
      }
    }
    
    if (markerCount < 2 && profile.voiceFormat.structuralMarkers.length >= 2) {
      issues.push({
        type: 'marker',
        severity: 'warning',
        message: `Found ${markerCount} structural markers, expected at least 2`,
      });
    }
  }
  
  // =================================================
  // PER-BEAT GROUNDING ANALYSIS (v2.0)
  // =================================================
  const groundingPerBeat: Array<{ beat: number; count: number }> = [];
  const groundingMissingBeats: number[] = [];
  let groundingDetails = 0;
  
  // Sensory patterns for grounding detection
  const sensoryPatterns = [
    /\b(sound(ed|s)?|noise|hum|buzz|creak|whisper|echo|static|ring(ing)?)\b/gi,
    /\b(smell(ed|s)?|scent|odor|stench|aroma|reek)\b/gi,
    /\b(touch(ed)?|felt|cold|warm|rough|smooth|wet|damp)\b/gi,
    /\b(saw|see|watch|glow|shine|dark(ness)?|light|shadow|flicker)\b/gi,
    /\b(taste(d)?|bitter|sweet|metallic|sour)\b/gi,
    // Object patterns (concrete nouns)
    /\b(phone|radio|car|door|window|mirror|photograph|tape|camera|clock|lamp)\b/gi,
  ];
  
  if (profile.beatStructure.requireGroundingDetail) {
    // Split story into beat sections
    const beatSections: Array<{ beat: number; content: string }> = [];
    const beatRegex = /\[BEAT_(\d+):[^\]]+\]/g;
    let lastIndex = 0;
    let match;
    
    while ((match = beatRegex.exec(story)) !== null) {
      const beatNum = parseInt(match[1], 10);
      const startIndex = match.index + match[0].length;
      
      // Get content until next beat or end
      const nextMatch = beatRegex.exec(story);
      const endIndex = nextMatch ? nextMatch.index : story.length;
      beatRegex.lastIndex = nextMatch ? nextMatch.index : story.length;
      
      const content = story.slice(startIndex, endIndex);
      beatSections.push({ beat: beatNum, content });
      
      if (nextMatch) {
        beatRegex.lastIndex = match.index + match[0].length;
      }
    }
    
    // Re-run regex from start for proper parsing
    beatRegex.lastIndex = 0;
    const allBeats: Array<{ beat: number; start: number; end: number }> = [];
    while ((match = beatRegex.exec(story)) !== null) {
      allBeats.push({ beat: parseInt(match[1], 10), start: match.index, end: match.index + match[0].length });
    }
    
    // Process each beat
    for (let i = 0; i < allBeats.length; i++) {
      const beatInfo = allBeats[i];
      const endIndex = i < allBeats.length - 1 ? allBeats[i + 1].start : story.length;
      const beatContent = story.slice(beatInfo.end, endIndex);
      
      let beatGrounding = 0;
      for (const pattern of sensoryPatterns) {
        const matches = beatContent.match(pattern);
        if (matches) {
          beatGrounding += matches.length;
        }
      }
      
      groundingPerBeat.push({ beat: beatInfo.beat, count: beatGrounding });
      groundingDetails += beatGrounding;
      
      // Check minimum grounding per beat
      const minRequired = profile.beatStructure.minGroundingPerBeat ?? 1;
      if (beatGrounding < minRequired) {
        groundingMissingBeats.push(beatInfo.beat);
      }
    }
    
    // Report grounding issues
    if (groundingMissingBeats.length > 0) {
      const severity = profile.beatStructure.repairOnMissingGrounding ? 'error' : 'warning';
      issues.push({
        type: 'grounding',
        severity,
        message: `Beats ${groundingMissingBeats.join(', ')} missing grounding details (need ${profile.beatStructure.minGroundingPerBeat ?? 1} per beat)`,
      });
    }
  }
  
  // Calculate score
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const score = Math.max(0, 100 - (errorCount * 20) - (warningCount * 5));
  
  // =====================================================
  // HARD FAILURES - Profile-driven v2.0
  // These determine repair/truncation triggers
  // =====================================================
  const hardFailures: string[] = [];
  
  // 1. STRUCTURAL: Missing beat tags (always hard failure)
  if (beatCount < profile.beatStructure.beatCount) {
    hardFailures.push(`missing_beats:${profile.beatStructure.beatCount - beatCount}`);
  }
  
  // 2. STRUCTURAL: Beat tag mismatch (wrong labels)
  const missingBeatTags = contract.expectedBeats.filter(tag => !story.includes(tag));
  if (missingBeatTags.length > 0 && beatCount >= profile.beatStructure.beatCount) {
    hardFailures.push(`beat_tag_mismatch:${missingBeatTags.length}`);
  }
  
  // 3. PROFILE-DRIVEN: Missing final image only if profile requires it
  if (profile.ending.enforceFinalImage && !hasFinalImage) {
    hardFailures.push('missing_final_image');
  }
  
  // 4. PROFILE-DRIVEN: Motif count only if profile requires minMentions > 0
  if (profile.motif.minMentions > 0 && motifMentions < contract.requiredMotifMentions) {
    hardFailures.push(`motif_below_min:${motifMentions}/${contract.requiredMotifMentions}`);
  }
  
  // 5. WORD COUNT - STRICT ENFORCEMENT (v2.0)
  // Always hard failure if out of range when strictEnforcement=true
  if (profile.wordCount.strictEnforcement && !wordCountInRange) {
    if (wordCount < contract.wordRange.min) {
      hardFailures.push(`word_count_out_of_range:${wordCount}<${contract.wordRange.min}`);
    } else {
      hardFailures.push(`word_count_out_of_range:${wordCount}>${contract.wordRange.max}`);
    }
  }
  
  // 6. UNIQUE ELEMENT - Profile-driven enforcement
  if (profile.uniqueElement.enforce && uniqueMentions < profile.uniqueElement.minAppearances) {
    hardFailures.push(`unique_element_below_min:${uniqueMentions}/${profile.uniqueElement.minAppearances}`);
  }
  
  // 7. PER-BEAT GROUNDING - Profile-driven (visual-first niches)
  if (profile.beatStructure.repairOnMissingGrounding && groundingMissingBeats.length > 0) {
    hardFailures.push(`grounding_missing_beats:${groundingMissingBeats.join(',')}`);
  }
  
  // 8. COUNTING LANE - one_too_many preset requires counting in beats 2-4
  if (isCountingHorror && countingLaneMissingBeats.length > 0) {
    hardFailures.push(`counting_lane_missing_beats:${countingLaneMissingBeats.join(',')}`);
  }
  
  return {
    passed: errorCount === 0 && wordCountInRange,
    score,
    issues,
    hardFailures,
    metrics: {
      wordCount,
      beatCount,
      motifMentions,
      uniqueElementMentions: uniqueMentions,
      hasFinalImage,
      markerCount,
      groundingDetails,
      groundingPerBeat,
      groundingMissingBeats,
      wordCountInRange,
      wordCountMin: contract.wordRange.min,
      wordCountMax: contract.wordRange.max,
    },
  };
}

// =====================================================
// POST-PROCESSOR
// =====================================================

/**
 * Truncate story to max words at sentence boundary.
 * Tries to end at a sentence boundary (. ! ?) for clean TTS.
 * 
 * @param story - Story text (with or without beat tags)
 * @param maxWords - Maximum word count
 * @returns Truncation result with text and metadata
 */
export function truncateAtSentenceBoundary(
  story: string,
  maxWords: number
): { text: string; truncated: boolean; originalWordCount: number; finalWordCount: number } {
  const words = story.split(/\s+/).filter(w => w.length > 0);
  const originalWordCount = words.length;
  
  if (originalWordCount <= maxWords) {
    return {
      text: story,
      truncated: false,
      originalWordCount,
      finalWordCount: originalWordCount,
    };
  }
  
  // Take maxWords, then find last sentence boundary
  const truncatedWords = words.slice(0, maxWords);
  let truncatedText = truncatedWords.join(' ');
  
  // Find last sentence boundary (. ! ?)
  const sentenceEndPattern = /[.!?]["']?\s*$/;
  const lastSentenceEnd = Math.max(
    truncatedText.lastIndexOf('. '),
    truncatedText.lastIndexOf('! '),
    truncatedText.lastIndexOf('? '),
    truncatedText.lastIndexOf('."'),
    truncatedText.lastIndexOf('!"'),
    truncatedText.lastIndexOf('?"'),
  );
  
  if (lastSentenceEnd > truncatedText.length * 0.6) {
    // Found a good sentence boundary in the last 40% - use it
    truncatedText = truncatedText.slice(0, lastSentenceEnd + 1).trim();
    
    // Handle closing quote if present
    if (truncatedText.endsWith('."') || truncatedText.endsWith('!"') || truncatedText.endsWith('?"')) {
      // Already includes quote
    } else if (truncatedText.endsWith('.') || truncatedText.endsWith('!') || truncatedText.endsWith('?')) {
      // Good ending
    } else {
      // Add ellipsis if we couldn't find a clean boundary
      truncatedText += '...';
    }
  } else {
    // No good sentence boundary - just truncate with ellipsis
    truncatedText = truncatedWords.slice(0, maxWords - 1).join(' ') + '...';
  }
  
  const finalWordCount = truncatedText.split(/\s+/).filter(w => w.length > 0).length;
  
  return {
    text: truncatedText,
    truncated: true,
    originalWordCount,
    finalWordCount,
  };
}

/**
 * Truncation result with beat preservation info
 */
export interface BeatPreservingTruncationResult {
  text: string;
  truncated: boolean;
  originalWordCount: number;
  finalWordCount: number;
  beatsPreserved: number;
  finalBeatPreserved: boolean;
  notes: string[];
  /** Whether truncation would corrupt structure (needs repair instead) */
  needsRepairInstead: boolean;
}

/**
 * Truncate story to max words while preserving beat structure.
 * 
 * Rules:
 * 1. All beat tags must be preserved
 * 2. Final beat must exist and have content
 * 3. If enforceFinalImage=true, final beat must have meaningful content
 * 4. Truncate within beats at sentence boundaries
 * 
 * If truncation would violate these rules, returns needsRepairInstead=true
 * 
 * @param story - Story text with beat tags
 * @param maxWords - Maximum word count
 * @param expectedBeats - Expected beat tags (e.g., ["[BEAT_1:OPENING]", ...])
 * @param enforceFinalImage - Whether final beat content is critical
 * @returns Truncation result with preservation info
 */
export function truncatePreservingBeats(
  story: string,
  maxWords: number,
  expectedBeats: string[],
  enforceFinalImage: boolean = false
): BeatPreservingTruncationResult {
  const words = story.split(/\s+/).filter(w => w.length > 0);
  const originalWordCount = words.length;
  const notes: string[] = [];
  
  // Already within range
  if (originalWordCount <= maxWords) {
    return {
      text: story,
      truncated: false,
      originalWordCount,
      finalWordCount: originalWordCount,
      beatsPreserved: expectedBeats.length,
      finalBeatPreserved: true,
      notes: [],
      needsRepairInstead: false,
    };
  }
  
  // Parse beat positions
  const beatRegex = /\[BEAT_(\d+):[^\]]+\]/g;
  const beatPositions: Array<{ tag: string; num: number; startIndex: number }> = [];
  let match;
  
  while ((match = beatRegex.exec(story)) !== null) {
    beatPositions.push({
      tag: match[0],
      num: parseInt(match[1], 10),
      startIndex: match.index,
    });
  }
  
  // If no beats found, use simple truncation
  if (beatPositions.length === 0) {
    const simple = truncateAtSentenceBoundary(story, maxWords);
    return {
      ...simple,
      beatsPreserved: 0,
      finalBeatPreserved: false,
      notes: ['no_beat_tags_found'],
      needsRepairInstead: false,
    };
  }
  
  // Calculate words per beat section
  const beatSections: Array<{ 
    tag: string; 
    num: number; 
    content: string; 
    wordCount: number;
    startIndex: number;
  }> = [];
  
  for (let i = 0; i < beatPositions.length; i++) {
    const beat = beatPositions[i];
    const nextBeat = beatPositions[i + 1];
    const contentStart = beat.startIndex + beat.tag.length;
    const contentEnd = nextBeat ? nextBeat.startIndex : story.length;
    const content = story.slice(contentStart, contentEnd);
    const wc = content.split(/\s+/).filter(w => w.length > 0).length;
    
    beatSections.push({
      tag: beat.tag,
      num: beat.num,
      content,
      wordCount: wc,
      startIndex: beat.startIndex,
    });
  }
  
  const totalBeatCount = beatSections.length;
  const finalBeat = beatSections[beatSections.length - 1];
  
  // Calculate minimum required words (all beats + minimum content each)
  const minWordsPerBeat = 10; // Minimum to be meaningful
  const minRequiredWords = beatPositions.reduce((sum, b) => {
    return sum + b.tag.split(/\s+/).length;
  }, 0) + (totalBeatCount * minWordsPerBeat);
  
  // If maxWords is too small to preserve structure, need repair instead
  if (maxWords < minRequiredWords) {
    notes.push(`max_words_too_small:${maxWords}<${minRequiredWords}`);
    return {
      text: story,
      truncated: false,
      originalWordCount,
      finalWordCount: originalWordCount,
      beatsPreserved: totalBeatCount,
      finalBeatPreserved: true,
      notes,
      needsRepairInstead: true, // Can't truncate, need repair
    };
  }
  
  // Calculate how much to trim
  const excessWords = originalWordCount - maxWords;
  notes.push(`trimming_${excessWords}_words`);
  
  // Strategy: Trim proportionally from each beat (except final beat if enforceFinalImage)
  const trimTargetBeats = enforceFinalImage 
    ? beatSections.slice(0, -1)  // Don't trim final beat
    : beatSections;
  
  // Calculate proportional trim per beat
  let remainingToTrim = excessWords;
  const trimmedSections: string[] = [];
  
  for (let i = 0; i < beatSections.length; i++) {
    const section = beatSections[i];
    const canTrim = trimTargetBeats.includes(section);
    
    if (!canTrim || remainingToTrim <= 0) {
      // Keep this section as-is
      trimmedSections.push(section.tag + section.content);
      continue;
    }
    
    // Calculate how much to trim from this beat (proportional)
    const proportion = section.wordCount / originalWordCount;
    let toTrim = Math.min(
      Math.ceil(excessWords * proportion),
      section.wordCount - minWordsPerBeat, // Keep at least minWordsPerBeat
      remainingToTrim
    );
    
    if (toTrim <= 0) {
      trimmedSections.push(section.tag + section.content);
      continue;
    }
    
    // Trim content at sentence boundary
    const contentWords = section.content.split(/\s+/).filter(w => w.length > 0);
    const targetWords = Math.max(minWordsPerBeat, contentWords.length - toTrim);
    
    if (targetWords >= contentWords.length) {
      trimmedSections.push(section.tag + section.content);
      continue;
    }
    
    // Find sentence boundary for trim
    let trimmedContent = contentWords.slice(0, targetWords).join(' ');
    
    // Try to end at sentence boundary
    const lastSentenceEnd = Math.max(
      trimmedContent.lastIndexOf('. '),
      trimmedContent.lastIndexOf('! '),
      trimmedContent.lastIndexOf('? '),
    );
    
    if (lastSentenceEnd > trimmedContent.length * 0.5) {
      trimmedContent = trimmedContent.slice(0, lastSentenceEnd + 1).trim();
    }
    
    // Ensure content ends cleanly
    if (!/[.!?]$/.test(trimmedContent)) {
      trimmedContent = trimmedContent.replace(/[,;:]?\s*$/, '...');
    }
    
    trimmedSections.push(section.tag + ' ' + trimmedContent + '\n\n');
    
    const actualTrimmed = contentWords.length - trimmedContent.split(/\s+/).length;
    remainingToTrim -= actualTrimmed;
    notes.push(`beat_${section.num}_trimmed_${actualTrimmed}`);
  }
  
  const truncatedText = trimmedSections.join('');
  const finalWordCount = truncatedText.split(/\s+/).filter(w => w.length > 0).length;
  
  // Verify final beat is preserved
  const finalBeatTag = beatPositions[beatPositions.length - 1].tag;
  const finalBeatPreserved = truncatedText.includes(finalBeatTag);
  
  return {
    text: truncatedText,
    truncated: true,
    originalWordCount,
    finalWordCount,
    beatsPreserved: beatPositions.length,
    finalBeatPreserved,
    notes,
    needsRepairInstead: !finalBeatPreserved && enforceFinalImage,
  };
}

/**
 * Strip beat tags and structural markers from the story.
 * Returns clean prose for TTS and display.
 * Handles whitespace variations while preserving paragraph structure.
 */
export function stripContractTags(story: string): string {
  let cleaned = story;
  
  // Remove beat tags with flexible whitespace: [BEAT_1:OPENING], [ BEAT_1 : OPENING ], etc.
  // Pattern: optional whitespace around brackets and colon
  cleaned = cleaned.replace(/\[\s*BEAT_\d+\s*:\s*[^\]]+\s*\]\s*/gi, '');
  
  // Also remove any standalone beat markers without colon: [BEAT_1], [BEAT1], etc.
  cleaned = cleaned.replace(/\[\s*BEAT[_\s]?\d+\s*\]\s*/gi, '');
  
  // Remove any leftover bracket artifacts: [], [ ], [  ]
  cleaned = cleaned.replace(/\[\s*\]/g, '');
  
  // Normalize multiple spaces to single space (but preserve newlines)
  cleaned = cleaned.replace(/[^\S\n]+/g, ' ');
  
  // Normalize excessive newlines (3+ → 2) for paragraph breaks
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // Clean up space before punctuation
  cleaned = cleaned.replace(/ ([.,!?;:])/g, '$1');
  
  // Clean up space after opening/before closing quotes
  cleaned = cleaned.replace(/" /g, '"');
  cleaned = cleaned.replace(/ "/g, '"');
  
  // Trim each line to remove leading/trailing spaces per line
  cleaned = cleaned.split('\n').map(line => line.trim()).join('\n');
  
  // Final trim
  cleaned = cleaned.trim();
  
  return cleaned;
}

/**
 * Process story output: validate, strip tags, return result
 */
export function processStoryOutput(
  rawStory: string, 
  contract: StoryContract
): {
  story: string;
  rawStory: string;
  compliance: ComplianceResult;
} {
  // Check compliance before stripping
  const compliance = checkCompliance(rawStory, contract);
  
  // Strip tags for final output
  const story = stripContractTags(rawStory);
  
  return {
    story,
    rawStory,
    compliance,
  };
}

// =====================================================
// LOGGING HELPERS
// =====================================================

/**
 * Format compliance result for logging
 */
export function complianceToLog(result: ComplianceResult): string {
  const status = result.passed ? '✅ PASSED' : '❌ FAILED';
  const parts = [
    `${status} (score: ${result.score}/100)`,
    `words=${result.metrics.wordCount}`,
    `beats=${result.metrics.beatCount}`,
    `motif=${result.metrics.motifMentions}`,
    `unique=${result.metrics.uniqueElementMentions}`,
  ];
  
  if (result.issues.length > 0) {
    parts.push(`issues=${result.issues.length}`);
  }
  
  if (result.hardFailures.length > 0) {
    parts.push(`hardFailures=[${result.hardFailures.join(',')}]`);
  }
  
  return parts.join(', ');
}

// =====================================================
// REPAIR PROMPT BUILDER
// =====================================================

/**
 * Build a deterministic repair prompt that fixes compliance issues
 * without changing story structure.
 * 
 * CRITICAL: This prompt must be highly deterministic - no creative additions.
 */
export function buildRepairPrompt(
  rawStory: string,
  contract: StoryContract,
  compliance: ComplianceResult
): string {
  const { profile, dna } = contract;
  const lines: string[] = [];
  
  lines.push('=== STORY REPAIR REQUEST ===');
  lines.push('');
  lines.push('The following story has compliance issues that MUST be fixed.');
  lines.push('');
  
  // List the specific failures
  lines.push('COMPLIANCE FAILURES:');
  for (const issue of compliance.issues) {
    const marker = issue.severity === 'error' ? '❌' : '⚠️';
    lines.push(`  ${marker} ${issue.message}`);
  }
  if (compliance.hardFailures.length > 0) {
    lines.push('');
    lines.push('HARD FAILURES (must fix):');
    for (const failure of compliance.hardFailures) {
      lines.push(`  🚨 ${failure}`);
    }
  }
  lines.push('');
  
  // Strict repair rules - REPEATED for emphasis
  lines.push('=== REPAIR RULES (MANDATORY - READ CAREFULLY) ===');
  lines.push('');
  lines.push('⚠️ DO NOT add, remove, or rename ANY beat tags. ⚠️');
  lines.push('⚠️ DO NOT change beat order. ⚠️');
  lines.push('');
  lines.push('The story MUST have EXACTLY these beat tags in this order:');
  for (const beat of contract.expectedBeats) {
    lines.push(`   ${beat}`);
  }
  lines.push('');
  lines.push('ALLOWED changes:');
  lines.push('- Edit text INSIDE beats');
  lines.push('- Add motif mentions within existing text');
  lines.push('- Adjust final image in last beat');
  lines.push('');
  lines.push('FORBIDDEN changes:');
  lines.push('- Adding new [BEAT_X:...] tags');
  lines.push('- Removing existing beat tags');
  lines.push('- Renaming beat labels');
  lines.push('- Changing beat order');
  lines.push('');
  
  // Specific fix instructions based on failures
  let ruleNum = 1;
  
  // Final image requirement
  if (profile.ending.enforceFinalImage && !compliance.metrics.hasFinalImage) {
    lines.push(`${ruleNum}. FINAL BEAT MUST include the final image:`);
    lines.push(`   "${dna.ending.final_image}"`);
    lines.push('   This can be paraphrased but the core imagery MUST be present.');
    lines.push('');
    ruleNum++;
  }
  
  // Motif requirement
  if (profile.motif.minMentions > 0 && compliance.metrics.motifMentions < contract.requiredMotifMentions) {
    const needed = contract.requiredMotifMentions - compliance.metrics.motifMentions;
    lines.push(`${ruleNum}. ADD ${needed} more mentions of the motif:`);
    lines.push(`   "${dna.repeating_detail}"`);
    lines.push('   Spread across different beats. Each mention should feel natural.');
    lines.push('');
    ruleNum++;
  }
  
  // Unique element recurrence requirement
  // Enhanced for micro-presets like "one_too_many" with specific escalation guidance
  const uniqueElementMentions = compliance.metrics.uniqueElementMentions || 0;
  if (profile.uniqueElement.minAppearances > 1 && uniqueElementMentions < profile.uniqueElement.minAppearances) {
    const needed = profile.uniqueElement.minAppearances - uniqueElementMentions;
    lines.push(`${ruleNum}. UNIQUE ELEMENT must appear at least ${profile.uniqueElement.minAppearances} times (currently: ${uniqueElementMentions}):`);
    lines.push(`   "${dna.unique_element}"`);
    lines.push('   - First mention: introduce the element naturally');
    if (profile.uniqueElement.requireEscalation) {
      lines.push('   - Second mention: MUST ESCALATE (worse, more specific, reveals new implication)');
      lines.push('   - Do NOT repeat the element identically - show PROGRESSION or DETERIORATION');
      
      // Special guidance for counting horror / one_too_many preset
      const isCountingHorror = 
        dna.unique_element.includes('counting') || 
        dna.unique_element.includes('one more') ||
        dna.unique_element.includes('extra person') ||
        profile.genreFlags?.use_trope_pack === 'one_too_many';
      
      if (isCountingHorror) {
        lines.push('');
        lines.push('   FOR COUNTING HORROR SPECIFICALLY:');
        lines.push('   - 1st count: Discovery ("they counted... one too many")');
        lines.push('   - 2nd count: Escalation (worse consequence: "counted again... still one extra... AND...")');
        lines.push('   - The 2nd count MUST reveal something NEW: who moved, who spoke, who wasn\'t there before');
        lines.push('   - WRONG: Just repeating "still one too many" without new information');
        lines.push('   - RIGHT: "counted again—still seven—but now Sarah noticed one of them was sitting in a seat that hadn\'t existed before"');
      }
    }
    lines.push('   - Keep beat tags UNCHANGED');
    lines.push('');
    ruleNum++;
  }
  
  // Word count
  if (compliance.metrics.wordCount < contract.wordRange.min) {
    lines.push(`${ruleNum}. EXPAND the story to at least ${contract.wordRange.min} words (currently ${compliance.metrics.wordCount})`);
    lines.push('');
    ruleNum++;
  } else if (compliance.metrics.wordCount > contract.wordRange.max + 50) {
    lines.push(`${ruleNum}. CONDENSE the story to at most ${contract.wordRange.max} words (currently ${compliance.metrics.wordCount})`);
    lines.push('');
    ruleNum++;
  }
  
  // Counting horror specific repair guidance
  const isCountingHorrorPreset = profile.genreFlags?.use_trope_pack === 'one_too_many';
  const hasCountingIssues = compliance.issues.some(i => i.type === 'counting_lane');
  
  if (isCountingHorrorPreset && hasCountingIssues) {
    const countingHorror = (dna as any).counting_horror;
    
    lines.push(`${ruleNum}. COUNTING HORROR REQUIREMENTS (one_too_many preset):`);
    lines.push('');
    lines.push('   This is COUNTING HORROR. The story cannot work without explicit numbers.');
    lines.push('');
    
    if (countingHorror) {
      lines.push(`   REQUIRED NUMBERS:`);
      lines.push(`     - Starting count: ${countingHorror.start_count}`);
      lines.push(`     - Wrong count: ${countingHorror.wrong_count}`);
      lines.push(`     - These EXACT numbers must appear as digits or spelled out.`);
      lines.push('');
    }
    
    lines.push('   REQUIRED ELEMENTS:');
    lines.push('     - At least 2 recount attempts (counted, recounted, checked again)');
    lines.push('     - Dialogue where someone speaks the wrong count aloud');
    lines.push('     - External witness independently confirming the count');
    lines.push('     - Physical glitch after count acknowledged');
    lines.push('');
    
    lines.push('   FIX PATTERN:');
    lines.push('     BEAT 1: Establish correct number clearly');
    lines.push('     BEAT 2: First wrong count, recount confirms it');
    lines.push('     BEAT 3: External witness confirms, dialogue spoken');
    lines.push('     BEAT 4: Physical environment responds to anomaly');
    lines.push('     BEAT 5: Visual proof showing one too many');
    lines.push('');
    
    lines.push('   DO NOT:');
    lines.push('     - Use vague numbers ("a few", "some", "several")');
    lines.push('     - Add other supernatural elements');
    lines.push('     - Make the extra person look different or monstrous');
    lines.push('     - Explain where the extra came from');
    lines.push('');
    ruleNum++;
  }
  
  // The original story
  lines.push('=== ORIGINAL STORY (with beat tags) ===');
  lines.push('');
  lines.push(rawStory);
  lines.push('');
  
  // Output format - repeat the critical rule
  lines.push('=== OUTPUT REQUIREMENTS ===');
  lines.push('');
  lines.push('Return the REPAIRED story with:');
  lines.push('- ALL beat tags preserved EXACTLY as shown above: [BEAT_N:LABEL]');
  lines.push('- DO NOT add, remove, or rename beat tags');
  lines.push('- All compliance issues fixed');
  lines.push('- Natural prose that flows well');
  lines.push('- NO commentary or explanations');
  lines.push('- NO markdown formatting');
  lines.push('');
  lines.push('Write ONLY the repaired story:');
  
  return lines.join('\n');
}

/**
 * Check if repair is needed based on compliance result
 */
export function needsRepair(compliance: ComplianceResult, threshold: number = 70): boolean {
  // Hard failures always need repair
  if (compliance.hardFailures.length > 0) {
    return true;
  }
  // Score below threshold needs repair
  return compliance.score < threshold;
}

/**
 * Build a summary of the contract for logging/display
 */
export function contractToSummary(contract: StoryContract): string {
  const { profile, dna } = contract;
  const parts: string[] = [];
  
  parts.push(`beats=${profile.beatStructure.beatCount}`);
  parts.push(`motif≥${profile.motif.minMentions}`);
  parts.push(`antiClosure=${(profile.ending.antiClosure * 100).toFixed(0)}%`);
  parts.push(`words=${contract.wordRange.min}-${contract.wordRange.max}`);
  
  if (contract.requiresFinalImage) {
    parts.push('finalImg=required');
  }
  
  if (profile.voiceFormat.enforceMarkers) {
    parts.push(`markers=${profile.voiceFormat.structuralMarkers.length}`);
  }
  
  return `[Contract] ${parts.join(', ')}`;
}