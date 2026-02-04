// =====================================================
// OPENAI MODULE - Story Generation, Scene Analysis, Anchors
// VERSION: 3.0.1 - 2026-01-29T21:10 - Fixed sentence splitting for ellipses
// =====================================================

import {
  LENGTH_CONFIG,
  VIBE_CONFIG,
  ART_STYLE_CONFIG,
  VISUAL_KEYWORDS,
  ORIENTATION_LOCK,
  FORBIDDEN_STYLE_TERMS,
  rewriteToContentOnly,
  type StoryAnchor,
  type VisualBeat,
  type SceneVisualContract,
  type StoryScene,
  type CharacterLock,
} from "./config.ts";

import { type ThemeGuidance } from "./stories.ts";

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
// CHARACTER LOCK HELPER FUNCTIONS
// =====================================================

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
    if (anchor.characterDescription) {
      const charDesc = anchor.characterDescription;
      anchor.characterLock = {
        id: generateCharacterId(charDesc),
        face: extractCharacterFace(charDesc),
        outfit: extractCharacterOutfit(charDesc),
        silhouette: extractCharacterSilhouette(charDesc),
        doNotChange: extractDoNotChange(charDesc),
      };
      console.log(`[createStoryAnchor] Created CharacterLock: ${anchor.characterLock.id}`);
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
  }));
  
  // Process in batches of 6 (smaller batches = more reliable)
  const BATCH_SIZE = 6;
  const totalBatches = Math.ceil(scenes.length / BATCH_SIZE);
  
  console.log(`[VISUAL CONTRACTS] Processing ${scenes.length} scenes in ${totalBatches} batches of ${BATCH_SIZE}`);
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const startIdx = batchIndex * BATCH_SIZE;
    const endIdx = Math.min(startIdx + BATCH_SIZE, scenes.length);
    const batchScenes = scenes.slice(startIdx, endIdx);
    
    console.log(`[VISUAL CONTRACTS] Batch ${batchIndex + 1}/${totalBatches}: scenes ${startIdx + 1}-${endIdx}`);
    
    try {
      const batchContracts = await createVisualContractsBatch(
        openaiKey,
        batchScenes,
        storyAnchor,
        visualBeats.slice(startIdx, endIdx),
        startIdx,
        scenes.length,
        scenes // Pass ALL scenes for context
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
  
  return allContracts;
}

/**
 * Create visual contracts for a batch of scenes
 * Uses enhanced prompt to prevent abstraction/compression on later scenes
 * NOW includes surrounding context so AI understands split sentences
 */
async function createVisualContractsBatch(
  openaiKey: string,
  scenes: StoryScene[],
  storyAnchor: StoryAnchor,
  visualBeats: VisualBeat[],
  startIndex: number,
  totalScenes: number,
  allScenes?: StoryScene[] // Pass all scenes for context
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

Return JSON: {"contracts": [...]}`,
        },
        {
          role: "user",
          content: `Convert these ${scenes.length} scenes to DETAILED visual contracts.
USE THE EXACT GLOBAL SCENE INDICES I PROVIDE:

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
4. BE SPECIFIC and CREATIVE - avoid defaulting to "atmospheric fog" for everything!`,
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
 */
function buildCharacterLockBlock(anchor: StoryAnchor): string {
  // Use new structured characterLock if available
  if (anchor.characterLock) {
    const lock = anchor.characterLock;
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
 * 2. STYLE LOCK (fixed per job)
 * 3. CHARACTER LOCK (fixed per job)
 * 4. SCENE VISUAL CONTRACT (literal frame requirements)
 * 5. AVOID LIST (fixed)
 * 
 * MAX LENGTH: ~2500 chars for stability
 */
export function buildFinalDallePrompt(
  storyAnchor: StoryAnchor,
  beat: VisualBeat,
  sceneIndex: number,
  totalScenes: number,
  styleConfig: { name: string; negativePrompt?: string; basePrompt?: string; colorOverride?: string; technicalStyle?: string },
  isCustomStyle: boolean = false,
  visualPreset: string = "forest"
): string {
  const moodLevel = Math.max(1, Math.min(10, Math.round(beat.moodLevel)));
  const sanitizedCameraAngle = sanitizeCameraAngleForPortrait(beat.cameraAngle);
  const contract = beat.visualContract;
  
  // ========== BUILD STYLE BLOCK ==========
  let styleBlock: string;
  if (isCustomStyle && styleConfig.basePrompt) {
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
    
    sceneBlock = [
      `SCENE ${sceneIndex + 1}/${totalScenes} CONTRACT (MUST FOLLOW):`,
      ``,
      `MUST SHOW:`,
      mustShowItems.join("\n"),
      ``,
      `MUST NOT SHOW:`,
      `- ${mustNotItems.join(", ")}`,
      ``,
      `EVIDENCE:`,
      `- ${contract.evidenceRule || `Scene must clearly show ${contract.location}`}`,
      ``,
      `Lighting: ${contract.lightingSource || "dim ambient light"}`,
      `Camera: ${contract.cameraDistance || "medium"} shot`,
      compositionHint ? `Composition: ${compositionHint}` : "",
      contract.continuityFromPrev ? `Continuity: ${contract.continuityFromPrev}` : "",
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
  
  // Final log with prompt length for debugging
  console.log(`[PROMPT] Scene ${sceneIndex + 1} prompt built: ${isCustomStyle ? "custom" : "built-in"} style, ${finalPrompt.length} chars`);
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
 */
export function buildFluxPrompt(
  storyAnchor: StoryAnchor,
  beat: VisualBeat,
  sceneIndex: number,
  totalScenes: number,
  styleConfig: { name: string; negativePrompt?: string; basePrompt?: string; colorOverride?: string; technicalStyle?: string },
  isCustomStyle: boolean = false
): string {
  const contract = beat.visualContract;
  const moodLevel = Math.max(1, Math.min(10, Math.round(beat.moodLevel)));
  
  // ========== STYLE (SHORT!) ==========
  // FLUX bias: if style mentions "cartoon/webcomic/vector", it often ignores it
  // Best for: cinematic, photorealistic, dark atmospheric
  let styleShort: string;
  if (isCustomStyle && styleConfig.basePrompt) {
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
    const lighting = contract.lightingSource || "dim light";
    
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
