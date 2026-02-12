/**
 * TEST ENDPOINT: Scene Splitting + Visual Cue Extraction
 * 
 * Runs just the scene splitting and visual cue extraction pipeline
 * WITHOUT generating images, voice, music, or video.
 * 
 * Usage:
 *   POST /test-scenes
 *   Body: {
 *     "story": "Your test story...",
 *     "brand_id": "optional-brand-uuid",
 *     "vibe_preset": "one_too_many",
 *     "duration": 75,
 *     "scene_count": 8
 *   }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Types ────────────────────────────────────────────────────

interface ImagePromptConfig {
  art_style: string;
  style_prompt: string;
  environment: string;
  color_palette: string;
  lighting: string;
  mood: string;
  camera_angles: string[];
  tension_escalation: boolean;
  negative_prompt: string;
  suffix: string;
}

interface StoryAnchor {
  environment: string;
  characterDescription: string | null;
  recurringMotifs: string;
  horrorTone: string;
  timeOfDay: string;
  isGroupStory: boolean;
  groupCount: number | null;
}

interface VisualCue {
  sceneIndex: number;
  description: string;
  sceneType: string;
  camera: string;
  isClimax?: boolean;
}

interface Scene {
  index: number;
  text: string;
  startTime: number;
  endTime: number;
  keywords: string[];
}

// ── Scene Splitting (mirrors executeScenesStep logic from steps.ts) ──

function splitStoryIntoScenes(storyText: string, duration: number, sceneCount: number): Scene[] {
  const sentences = storyText
    .split(/(?<=[.!?])\s+/)
    .filter((s: string) => s.trim().length > 0);

  let textChunks = [...sentences];
  if (textChunks.length < sceneCount) {
    const clauseSplitters = /(?<=,)\s+|(?<=;)\s+|(?<=—)\s*|\s+(?:and|but|when|as|while|then)\s+/i;
    const expanded: string[] = [];
    for (const sentence of textChunks) {
      if (expanded.length >= sceneCount) {
        expanded.push(sentence);
        continue;
      }
      const clauses = sentence.split(clauseSplitters).filter((c: string) => c.trim().length > 3);
      if (clauses.length > 1) {
        expanded.push(...clauses);
      } else {
        expanded.push(sentence);
      }
    }
    textChunks = expanded;
  }

  const chunksPerScene = textChunks.length / sceneCount;

  // First pass: build scene texts and measure word counts
  const rawScenes: Array<{ text: string; wordCount: number; keywords: string[] }> = [];

  for (let i = 0; i < sceneCount; i++) {
    const startIdx = Math.floor(i * chunksPerScene);
    const endIdx = i === sceneCount - 1 ? textChunks.length : Math.floor((i + 1) * chunksPerScene);
    const actualEnd = Math.max(endIdx, startIdx + 1);
    const sceneText = textChunks.slice(startIdx, actualEnd).join(' ').trim();

    const words = sceneText.toLowerCase().split(/\s+/).filter((w: string) => w.length > 0);
    const keywords = words.filter((w: string) => w.length > 4).slice(0, 5);

    rawScenes.push({
      text: sceneText || textChunks[Math.min(i, textChunks.length - 1)] || 'Scene',
      wordCount: Math.max(words.length, 1),
      keywords,
    });
  }

  // Second pass: word-proportional timing
  const totalWords = rawScenes.reduce((sum, s) => sum + s.wordCount, 0);
  const minSceneDuration = 1.5;
  const reservedTime = minSceneDuration * sceneCount;
  const flexibleTime = Math.max(0, duration - reservedTime);

  const scenes: Scene[] = [];
  let currentTime = 0;

  for (let i = 0; i < rawScenes.length; i++) {
    const raw = rawScenes[i];
    const proportion = raw.wordCount / totalWords;
    const sceneDur = minSceneDuration + (flexibleTime * proportion);
    const startTime = currentTime;
    const endTime = i === rawScenes.length - 1 ? duration : currentTime + sceneDur;

    scenes.push({
      index: i,
      text: raw.text,
      startTime: parseFloat(startTime.toFixed(2)),
      endTime: parseFloat(endTime.toFixed(2)),
      keywords: raw.keywords,
    });

    currentTime = endTime;
  }

  // Merge micro-scenes: any scene under 3s gets merged with its neighbor
  const MIN_SCENE_DURATION = 3.0;
  let merged = true;
  while (merged) {
    merged = false;
    for (let m = 0; m < scenes.length; m++) {
      const dur = scenes[m].endTime - scenes[m].startTime;
      if (dur < MIN_SCENE_DURATION && scenes.length > 2) {
        const mergeWith = m < scenes.length - 1 ? m + 1 : m - 1;
        const kept = Math.min(m, mergeWith);
        const removed = Math.max(m, mergeWith);
        scenes[kept].text = scenes[kept].text + ' ' + scenes[removed].text;
        scenes[kept].startTime = Math.min(scenes[kept].startTime, scenes[removed].startTime);
        scenes[kept].endTime = Math.max(scenes[kept].endTime, scenes[removed].endTime);
        const allKw = [...new Set([...scenes[kept].keywords, ...scenes[removed].keywords])];
        scenes[kept].keywords = allKw.slice(0, 5);
        scenes.splice(removed, 1);
        for (let j = 0; j < scenes.length; j++) scenes[j].index = j;
        merged = true;
        break;
      }
    }
  }

  return scenes;
}

// ── Story Anchor (mirrors createStoryAnchor from steps.ts) ──

async function createStoryAnchor(
  storyText: string,
  openaiKey: string,
  vibePreset: string,
  config: ImagePromptConfig | null,
): Promise<StoryAnchor | null> {
  const stylePrompt = config?.style_prompt || 'cinematic horror';
  const envHint = config?.environment || 'dark atmospheric setting';

  const prompt = `You are a visual director. Analyze this story and extract a consistent visual identity that should persist across ALL images in the video.

ART STYLE: ${stylePrompt}
ENVIRONMENT GUIDE: ${envHint}
GENRE/VIBE: ${vibePreset}

STORY: "${storyText.substring(0, 1500)}"

Extract these elements as a JSON object:
{
  "environment": "The PRIMARY physical setting (be specific: 'cramped office elevator with brushed steel walls and fluorescent panel lighting', not just 'elevator')",
  "characterDescription": "If ANY humans appear, describe their appearance in detail. null if no humans.",
  "recurringMotifs": "Visual elements that should appear in multiple shots (specific objects, textures, lighting effects)",
  "horrorTone": "The type of dread (paranoia, cosmic, body horror, psychological, etc.)",
  "timeOfDay": "Specific lighting/time conditions",
  "isGroupStory": true/false,
  "groupCount": number or null (for "one_too_many" stories, this is the EXPECTED number of people BEFORE the extra person appears)
}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a visual director. Respond only with valid JSON.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content) as StoryAnchor;
  } catch {
    return null;
  }
}

// ── Visual Cue Extraction (mirrors extractVisualCues from steps.ts) ──

async function extractVisualCues(
  scenes: Scene[],
  openaiKey: string,
  vibePreset: string,
  config: ImagePromptConfig | null,
  storyAnchor: StoryAnchor | null,
): Promise<VisualCue[]> {
  const sceneList = scenes.map((s, i) =>
    `Scene ${i + 1} (sceneIndex: ${i}): "${s.text.substring(0, 350)}"`
  ).join('\n');

  const styleContext = config ? `
ART STYLE: ${config.style_prompt}
ENVIRONMENT GUIDE: ${config.environment}
COLOR PALETTE: ${config.color_palette}
NEGATIVE CONSTRAINTS (things images must NEVER show): ${config.negative_prompt}` : '';

  const anchorContext = storyAnchor ? `
STORY ENVIRONMENT: ${storyAnchor.environment}
${storyAnchor.characterDescription ? `CHARACTER(S): ${storyAnchor.characterDescription}` : 'NO HUMAN CHARACTERS (use objects, environments, and atmospheric shots only)'}
RECURRING MOTIFS: ${storyAnchor.recurringMotifs}
HORROR TONE: ${storyAnchor.horrorTone}
TIME OF DAY: ${storyAnchor.timeOfDay}
${storyAnchor.isGroupStory ? `GROUP STORY: Yes, ${storyAnchor.groupCount || 'unknown number of'} people` : ''}` : '';

  const countingRules = (vibePreset === 'one_too_many' && storyAnchor?.isGroupStory) ? `
COUNTING HORROR RULES (CRITICAL):
- This is a "one too many" story — the group discovers an extra person
- Expected group size: ${storyAnchor.groupCount || 'varies'}
- BEFORE the reveal moment: show exactly the expected count, everyone looks normal
- AFTER the reveal: show one extra person, with subtly unsettling expressions
- For "implied presence" scenes (feeling watched, shadows): do NOT show extra people as humans — use shadow distortions, light anomalies, motion blur
- For scenes examining photos/footage: ALWAYS show the wrong count
- VARY the scene types — not every scene needs the full group. Use establishing shots, object close-ups, atmosphere shots, and individual character moments too.` : '';

  const liminalRules = vibePreset === 'backrooms' ? `
LIMINAL SPACE RULES:
- Avoid showing humans unless the scene text explicitly mentions a person
- Focus on empty impossible architecture, repeating patterns, fluorescent-lit void
- Use POV shots, impossible corridors, empty rooms` : '';

  const prompt = `You are an expert CINEMATOGRAPHER creating a shot list for a short horror video.
${styleContext}
${anchorContext}
${countingRules}
${liminalRules}

Genre/vibe: ${vibePreset}

Your job: for each scene, design a CINEMATIC SHOT that tells the story visually. Think like a film director — each image is a DIFFERENT CAMERA SETUP, not the same wide shot repeated.

SHOT DESIGN PRINCIPLES:
1. VARY THE SUBJECT: Not every shot shows the full group or the same thing. Some shots should be:
   - A CLOSE-UP of a hand, a face, an object (elevator buttons, a flickering light, sweat on a palm, a number display)
   - An OVERHEAD/birds-eye view looking straight down
   - A POV shot from a character's perspective
   - A DETAIL SHOT of something small but important (a name badge, a cracked mirror, fingers counting)
   - A REACTION SHOT focused on ONE person's face
2. FOLLOW THE NARRATIVE FOCUS: Read what the scene text is actually about:
   - If it mentions "counting" → show hands counting or numbered objects, NOT the full group
   - If it mentions "jolt of every floor" → show the floor indicator numbers changing, NOT people standing
   - If it mentions a character noticing something → show THEIR face in close-up reacting
   - If it mentions silence or unease → show an EMPTY detail (the elevator gap, emergency phone, a crack in the wall)
3. NEVER repeat the same basic composition. If scene 1 is "group in elevator", scene 2 MUST be a different angle/subject.
4. ESCALATE visually: start with normal/wide shots, progress to tighter, more unsettling compositions.

SCENE-GROUNDING RULES:
- Each description must match the DOMINANT ACTION or SUBJECT of THAT specific scene's narration.
- Do NOT bleed unique elements between scenes.
- MAINTAIN CONSISTENCY for: location/setting, character appearance, recurring props.
- The BACKGROUND and CAST stay consistent, but the CAMERA FOCUS and FRAMING change every scene.

VARIETY IS MANDATORY:
- Maximum 2 scenes of type "group" unless the story is entirely about the group acting together in every scene.
- At least 2 scenes should be "object" or "atmosphere" or "establishing" type.
- At least 1 scene should use close-up or extreme-close-up camera.
- At least 1 scene should use overhead, low-angle, or pov camera.
- If a scene has only 1-2 sentences of dialogue or narration, use an object/atmosphere/detail shot rather than showing people.

CLIMAX RULE:
- The last 1-2 scenes are the CLIMAX — the most dramatic, frightening moment.
- These scenes MUST show the story's most powerful visual (the monster revealed, the impossible face, the terrifying realization). Never waste the climax on an atmosphere/establishing shot.
- The final scene should be the image that lingers in the viewer's mind.

For each scene, provide:
- description: A concise 1-2 sentence visual description. Be SPECIFIC about what is visible — describe the exact subject, framing, and what makes this shot different from the others.
- sceneType: One of: establishing (wide location), object (specific item/detail focus), atmosphere (mood/environment), character (single person), group (multiple people)
- camera: One of: wide, medium, close-up, extreme-close-up, overhead, low-angle, pov
- isClimax: true if this is one of the last 1-2 scenes and represents the story's most dramatic moment, false otherwise

${sceneList}

Respond with a JSON object: { "cues": [ { "sceneIndex": 0, "description": "...", "sceneType": "...", "camera": "...", "isClimax": false }, ... ] }`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an expert cinematographer designing a shot list. Each shot must be visually DISTINCT — vary subjects, angles, and framing like a real film. Respond only with valid JSON.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[TEST] Visual cues GPT call failed: ${response.status} ${errText}`);
      return [];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    return parsed.cues || parsed.scenes || [];
  } catch (err) {
    console.warn(`[TEST] Extraction failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

// ── Main handler ──

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      story,
      brand_id,
      vibe_preset = 'one_too_many',
      duration = 75,
      scene_count,
    } = body;

    if (!story) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing "story" in request body' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY") || '';
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'OPENAI_API_KEY not set' }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const startTime = Date.now();

    // ── Step 1: Scene splitting ──
    const fallbackSceneCount = Math.max(12, Math.min(24, Math.round(duration / 2.5)));
    const finalSceneCount = scene_count || fallbackSceneCount;

    const scenes = splitStoryIntoScenes(story, duration, finalSceneCount);
    const sceneSplitMs = Date.now() - startTime;

    console.log(`[TEST] Split into ${scenes.length} scenes in ${sceneSplitMs}ms`);

    // ── Step 2: Load image prompt config from DB (optional) ──
    let imagePromptConfig: ImagePromptConfig | null = null;
    if (brand_id) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") || '',
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || '',
      );

      try {
        const { data } = await supabase.rpc('get_image_prompt_config_for_job', {
          p_brand_id: brand_id,
          p_vibe_preset: vibe_preset,
          p_job_meta: {},
        });
        if (data && typeof data === 'object') {
          imagePromptConfig = data as ImagePromptConfig;
        }
      } catch (e) {
        console.warn(`[TEST] Could not load image prompt config: ${e}`);
      }
    }

    // ── Step 3: Story Anchor ──
    const anchorStart = Date.now();
    const storyAnchor = await createStoryAnchor(story, openaiKey, vibe_preset, imagePromptConfig);
    const anchorMs = Date.now() - anchorStart;
    console.log(`[TEST] Story anchor created in ${anchorMs}ms`);

    // ── Step 4: Visual Cue Extraction ──
    const cueStart = Date.now();
    const visualCues = await extractVisualCues(scenes, openaiKey, vibe_preset, imagePromptConfig, storyAnchor);
    const cueMs = Date.now() - cueStart;
    console.log(`[TEST] Visual cues extracted in ${cueMs}ms`);

    // ── Build response ──
    const typeDistribution: Record<string, number> = {};
    const cameraDistribution: Record<string, number> = {};
    for (const cue of visualCues) {
      typeDistribution[cue.sceneType] = (typeDistribution[cue.sceneType] || 0) + 1;
      cameraDistribution[cue.camera] = (cameraDistribution[cue.camera] || 0) + 1;
    }

    // Compute mood levels and image sequence plan (mirrors worker logic)
    const LONG_SCENE_THRESHOLD = 10;
    const TARGET_IMAGE_DURATION = 8;

    const imageSequence: Array<{
      sceneIndex: number; subIndex: number; duration: number; moodLevel: number;
    }> = [];

    for (let si = 0; si < scenes.length; si++) {
      const s = scenes[si];
      const sceneDuration = s.endTime - s.startTime;
      const cue = visualCues.find(c => c.sceneIndex === si);

      // Compute mood level (mirrors computeMoodLevel from worker)
      const progress = si / Math.max(scenes.length - 1, 1);
      let mood = Math.round(3 + progress * 5);
      if (cue?.isClimax) mood = Math.min(10, mood + 3);
      const type = cue?.sceneType || 'atmosphere';
      const cam = cue?.camera || 'medium';
      if (type === 'establishing' || cam === 'wide') mood = Math.max(2, mood - 1);
      if (type === 'atmosphere') mood = Math.min(8, mood + 1);
      if (cam === 'pov') mood = Math.min(9, mood + 2);
      mood = Math.max(1, Math.min(10, mood));

      if (sceneDuration > LONG_SCENE_THRESHOLD) {
        const imageCount = Math.min(3, Math.ceil(sceneDuration / TARGET_IMAGE_DURATION));
        const subDur = sceneDuration / imageCount;
        for (let j = 0; j < imageCount; j++) {
          imageSequence.push({ sceneIndex: si, subIndex: j, duration: parseFloat(subDur.toFixed(2)), moodLevel: mood });
        }
      } else {
        imageSequence.push({ sceneIndex: si, subIndex: 0, duration: parseFloat(sceneDuration.toFixed(2)), moodLevel: mood });
      }
    }

    const sceneSummary = scenes.map((s, i) => {
      const cue = visualCues.find(c => c.sceneIndex === i);
      const dur = s.endTime - s.startTime;
      return {
        scene: i + 1,
        time: `${s.startTime.toFixed(1)}s – ${s.endTime.toFixed(1)}s`,
        duration: `${dur.toFixed(1)}s`,
        words: s.text.split(/\s+/).length,
        text: s.text,
        visual_cue: cue ? {
          type: cue.sceneType,
          camera: cue.camera,
          description: cue.description,
          isClimax: cue.isClimax || false,
        } : null,
      };
    });

    return new Response(
      JSON.stringify({
        success: true,
        config: {
          vibe_preset,
          duration,
          scene_count: finalSceneCount,
          has_brand_config: !!imagePromptConfig,
          art_style: imagePromptConfig?.art_style || 'none (no brand config)',
        },
        story_anchor: storyAnchor,
        scenes: sceneSummary,
        distributions: {
          scene_types: typeDistribution,
          cameras: cameraDistribution,
        },
        image_sequence: {
          total_images: imageSequence.length,
          multi_image_scenes: imageSequence.filter(e => e.subIndex > 0).length,
          entries: imageSequence,
          mood_levels: imageSequence.map(e => e.moodLevel),
          durations: imageSequence.map(e => e.duration),
        },
        timing: {
          scene_split_ms: sceneSplitMs,
          story_anchor_ms: anchorMs,
          visual_cues_ms: cueMs,
          total_ms: Date.now() - startTime,
        },
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
