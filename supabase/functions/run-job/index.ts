import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
};

// =====================================================
// CONFIGURATION
// =====================================================
const ELEVENLABS_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam

// Story length targets (approximate word counts for target durations)
// ~150 words per minute for narration
const LENGTH_CONFIG = {
  "30": { minWords: 65, maxWords: 80, targetSeconds: 30 },
  "45": { minWords: 95, maxWords: 115, targetSeconds: 45 },
  "60": { minWords: 130, maxWords: 155, targetSeconds: 60 },
  "90": { minWords: 200, maxWords: 230, targetSeconds: 90 },
};

// Vibe prompts
const VIBE_CONFIG = {
  slow_creepy: "slow building dread, atmospheric, unsettling ending",
  punchy_shock: "fast-paced, shocking twist, punchy ending",
  atmospheric: "moody, descriptive, lingering unease",
};

// =====================================================
// ART STYLE CONFIGURATIONS FOR DALL-E
// =====================================================
const ART_STYLE_CONFIG: Record<string, {
  name: string;
  basePrompt: string;
  colorOverride: string;
  technicalStyle: string;
  negativePrompt: string;
}> = {
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
// HELPER: Update job status
// =====================================================
async function updateJob(supabase: any, jobId: string, updates: any) {
  const { error } = await supabase
    .from("jobs")
    .update(updates)
    .eq("id", jobId);
  
  if (error) {
    console.error("Failed to update job:", error);
  }
}

// =====================================================
// STEP 1: Generate Story with OpenAI
// =====================================================
async function generateStory(
  openaiKey: string,
  vibePreset: string,
  lengthPreset: string
): Promise<{ title: string; story: string; hook: string }> {
  const config = LENGTH_CONFIG[lengthPreset as keyof typeof LENGTH_CONFIG];
  const vibe = VIBE_CONFIG[vibePreset as keyof typeof VIBE_CONFIG];

  const prompt = `You are a viral horror short story writer for TikTok/Reels/Shorts.

Write a scary story with these requirements:
- Length: ${config.minWords}-${config.maxWords} words (CRITICAL: stay within this range)
- Style: ${vibe}
- Must have a HOOK in the first sentence that grabs attention
- MUST have a COMPLETE ending - either a twist, cliffhanger, or scary reveal
- The final sentence should feel like an ending (e.g., "And then I realized...", "It was standing right behind me.", "That's when I knew...")
- No real person names (use "I", "my friend", "the man", etc.)
- No "based on true story" claims
- Present tense preferred
- Simple, punchy sentences
- DO NOT end mid-thought or cut off abruptly

Return JSON format:
{
  "title": "Short catchy title (3-5 words)",
  "hook": "The attention-grabbing first line",
  "story": "The complete story including the hook - MUST have a proper ending"
}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a horror story writer. Always respond with valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.9,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = JSON.parse(data.choices[0].message.content);
  
  return content;
}

// =====================================================
// STEP 2: Generate Captions - NOW HANDLED BY ELEVENLABS
// We get word-level timestamps directly from ElevenLabs API
// =====================================================

// =====================================================
// STEP 3: Generate Audio with ElevenLabs (with word timestamps)
// =====================================================
interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

interface AudioResult {
  audioBuffer: ArrayBuffer;
  wordTimestamps: WordTimestamp[];
  actualDuration: number;
}

async function generateAudio(
  elevenLabsKey: string,
  text: string,
  voiceId: string
): Promise<AudioResult> {
  console.log(`Calling ElevenLabs API with voice ${voiceId} and timestamps...`);
  console.log(`Text length: ${text.length} characters`);
  
  // Use the streaming endpoint with timestamps
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
    {
      method: "POST",
      headers: {
        "xi-api-key": elevenLabsKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("ElevenLabs error response:", error);
    throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  console.log("ElevenLabs response received with timestamps");
  
  // Decode base64 audio
  const audioBase64 = data.audio_base64;
  const audioBuffer = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0)).buffer;
  
  // Extract word-level timestamps from alignment data
  const wordTimestamps: WordTimestamp[] = [];
  let actualDuration = 0;
  
  if (data.alignment && data.alignment.characters) {
    const chars = data.alignment.characters;
    const charStarts = data.alignment.character_start_times_seconds;
    const charEnds = data.alignment.character_end_times_seconds;
    
    // Group characters into words
    let currentWord = '';
    let wordStart = 0;
    let wordEnd = 0;
    
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      
      if (char === ' ' || i === chars.length - 1) {
        // End of word
        if (i === chars.length - 1 && char !== ' ') {
          currentWord += char;
          wordEnd = charEnds[i];
        }
        
        // Clean up the word - remove hyphens and extra punctuation for display
        let cleanWord = currentWord.trim();
        // Remove hyphens (but keep the word)
        cleanWord = cleanWord.replace(/-/g, '');
        // Keep only essential punctuation at the end (period, comma, question mark, exclamation)
        // Remove quotes, apostrophes from display but keep letters
        cleanWord = cleanWord.replace(/['"]/g, '');
        
        if (cleanWord.length > 0) {
          wordTimestamps.push({
            word: cleanWord,
            start: Number(wordStart.toFixed(3)),
            end: Number(wordEnd.toFixed(3)),
          });
        }
        
        currentWord = '';
        if (i + 1 < chars.length) {
          wordStart = charStarts[i + 1];
        }
      } else {
        if (currentWord === '') {
          wordStart = charStarts[i];
        }
        currentWord += char;
        wordEnd = charEnds[i];
      }
    }
    
    // Get actual audio duration from last timestamp
    if (charEnds.length > 0) {
      actualDuration = Math.ceil(charEnds[charEnds.length - 1]) + 1;
    }
  }
  
  console.log(`Generated ${wordTimestamps.length} word timestamps, duration: ${actualDuration}s`);
  console.log("Sample timestamps:", wordTimestamps.slice(0, 5));
  
  return {
    audioBuffer,
    wordTimestamps,
    actualDuration,
  };
}

// =====================================================
// STEP 4: Search Pexels for Multiple Scene Backgrounds
// =====================================================

// Keyword mapping for visual presets (fallbacks)
const VISUAL_KEYWORDS: Record<string, string[]> = {
  forest: ["dark forest", "misty woods", "foggy trees", "night forest"],
  hallway: ["dark hallway", "abandoned corridor", "creepy hallway", "dark passage"],
  attic: ["dusty attic", "abandoned room", "old house interior", "dark room"],
  foggy: ["thick fog", "misty atmosphere", "fog rolling", "eerie mist"],
  rain: ["rain drops", "rainy night", "storm rain", "dark rain"],
};

// Scene/segment structure
interface StoryScene {
  text: string;
  startTime: number;
  endTime: number;
  keywords: string[];
  videoUrl?: string;
}

/**
 * Extract scene keywords for preview (without audio timestamps)
 * Uses estimated timing based on word count
 */
async function extractSceneKeywordsForPreview(
  openaiKey: string,
  story: string,
  estimatedDuration: number,
  visualPreset: string
): Promise<StoryScene[]> {
  try {
    // Split story into sentences
    const sentences = story.match(/[^.!?]+[.!?]+/g) || [story];
    
    // Group sentences into 2-3 sentence scenes
    const sceneTexts: string[] = [];
    let currentScene = "";
    let sentenceCount = 0;
    
    for (const sentence of sentences) {
      currentScene += sentence;
      sentenceCount++;
      
      if (sentenceCount >= 2 || sentence === sentences[sentences.length - 1]) {
        sceneTexts.push(currentScene.trim());
        currentScene = "";
        sentenceCount = 0;
      }
    }
    
    console.log(`Split story into ${sceneTexts.length} scenes for preview`);
    
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
        sceneKeywords = Array.isArray(parsed) ? parsed : (parsed.scenes || []);
        
        if (!Array.isArray(sceneKeywords) || sceneKeywords.length === 0) {
          throw new Error("Invalid format");
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
 */
async function extractSceneKeywords(
  openaiKey: string,
  story: string,
  captions: Array<{ word: string; start: number; end: number }>,
  visualPreset: string,
  targetSceneCount: number = 4
): Promise<StoryScene[]> {
  try {
    // Split story into sentences
    const sentences = story.match(/[^.!?]+[.!?]+/g) || [story];
    
    // Calculate sentences per scene based on target count
    const sentencesPerScene = Math.max(1, Math.ceil(sentences.length / targetSceneCount));
    
    console.log(`[extractSceneKeywords] ${sentences.length} sentences, target ${targetSceneCount} scenes, ${sentencesPerScene} sentences/scene`);
    
    // Group sentences into scenes - ensure we create EXACTLY targetSceneCount scenes
    const sceneTexts: string[] = [];
    
    for (let i = 0; i < targetSceneCount; i++) {
      const startIdx = i * sentencesPerScene;
      const endIdx = (i === targetSceneCount - 1) 
        ? sentences.length  // Last scene gets all remaining sentences
        : Math.min((i + 1) * sentencesPerScene, sentences.length);
      
      if (startIdx < sentences.length) {
        const sceneSentences = sentences.slice(startIdx, endIdx);
        sceneTexts.push(sceneSentences.join('').trim());
      }
    }
    
    // Filter out any empty scenes
    const finalSceneTexts = sceneTexts.filter(text => text.length > 0);
    
    console.log(`[extractSceneKeywords] Created ${finalSceneTexts.length} scenes (target was ${targetSceneCount})`);
    
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

Return a JSON array with one object per scene:
[{"scene": 1, "keywords": ["dark bedroom night", "shadows wall"]}, ...]`,
          },
          {
            role: "user",
            content: `Scenes:\n${finalSceneTexts.map((s, i) => `Scene ${i + 1}: "${s}"`).join("\n")}`,
          },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      console.error("Failed to extract scene keywords, status:", response.status);
      // Return fallback instead of throwing
      return finalSceneTexts.map((text, i) => {
        const totalDuration = captions[captions.length - 1]?.end || 45;
        const sceneDuration = totalDuration / finalSceneTexts.length;
        return {
          text,
          startTime: i * sceneDuration,
          endTime: (i + 1) * sceneDuration,
          keywords: VISUAL_KEYWORDS[visualPreset] || ["dark atmospheric"],
        };
      });
    }

    const data = await response.json();
    let sceneKeywords: Array<{ scene: number; keywords: string[] }>;
    
    try {
      const content = data.choices[0].message.content;
      console.log("OpenAI scene keywords response:", content);
      const parsed = JSON.parse(content);
      // Handle both {"scenes": [...]} and direct array [...]
      sceneKeywords = Array.isArray(parsed) ? parsed : (parsed.scenes || []);
      
      // Validate the structure
      if (!Array.isArray(sceneKeywords) || sceneKeywords.length === 0) {
        throw new Error("Invalid scene keywords format");
      }
    } catch (parseError) {
      console.error("Failed to parse scene keywords:", parseError);
      sceneKeywords = finalSceneTexts.map((_, i) => ({
        scene: i + 1,
        keywords: VISUAL_KEYWORDS[visualPreset] || ["dark atmospheric"],
      }));
    }
    
    console.log("Scene keywords:", sceneKeywords);
    
    // Calculate timing for each scene based on word timestamps
    const scenes: StoryScene[] = [];
    let wordIndex = 0;
    const totalDuration = captions[captions.length - 1]?.end || 45;
    
    for (let i = 0; i < finalSceneTexts.length; i++) {
      const sceneText = finalSceneTexts[i];
      const sceneWordCount = sceneText.split(/\s+/).length;
      
      // Find start time (first word of this scene)
      const startTime = wordIndex < captions.length ? captions[wordIndex].start : (i * totalDuration / finalSceneTexts.length);
      
      // Move word index forward
      wordIndex += sceneWordCount;
      
      // Find end time (last word of this scene)
      const endTime = wordIndex < captions.length 
        ? captions[Math.min(wordIndex - 1, captions.length - 1)].end 
        : ((i + 1) * totalDuration / finalSceneTexts.length);
      
      scenes.push({
        text: sceneText,
        startTime: startTime,
        endTime: endTime,
        keywords: sceneKeywords[i]?.keywords || VISUAL_KEYWORDS[visualPreset] || ["dark atmospheric"],
      });
    }
    
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

/**
 * Search Pexels for a single video matching keywords
 */
async function searchPexelsForKeywords(
  pexelsKey: string,
  keywords: string[],
  usedVideoIds: Set<number> = new Set()
): Promise<{ name: string; source_url: string; videoId: number } | null> {
  for (const keyword of keywords) {
    try {
      console.log(`Searching Pexels for: "${keyword}"`);
      
      const response = await fetch(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(keyword)}&orientation=portrait&per_page=20`,
        {
          headers: {
            "Authorization": pexelsKey,
          },
        }
      );

      if (!response.ok) {
        console.error(`Pexels search failed for "${keyword}":`, response.status);
        continue;
      }

      const data = await response.json();
      
      if (data.videos && data.videos.length > 0) {
        // Filter out already used videos and prefer longer ones
        let suitableVideos = data.videos.filter((v: any) => 
          !usedVideoIds.has(v.id) && v.duration >= 5
        );
        
        if (suitableVideos.length === 0) {
          suitableVideos = data.videos.filter((v: any) => !usedVideoIds.has(v.id));
        }
        
        if (suitableVideos.length > 0) {
          // Pick from top results
          const randomIndex = Math.floor(Math.random() * Math.min(suitableVideos.length, 3));
          const video = suitableVideos[randomIndex];
          
          // Get the best video file
          const videoFile = video.video_files.find((f: any) => 
            f.quality === "hd" && f.height > f.width
          ) || video.video_files.find((f: any) => 
            f.quality === "hd"
          ) || video.video_files.find((f: any) =>
            f.quality === "sd" && f.height > f.width
          ) || video.video_files[0];
          
          if (videoFile?.link) {
            console.log(`Found video for "${keyword}": ${video.id}`);
            return {
              name: `Pexels: ${keyword}`,
              source_url: videoFile.link,
              videoId: video.id,
            };
          }
        }
      }
    } catch (error) {
      console.error(`Pexels search error for "${keyword}":`, error);
    }
  }
  return null;
}

/**
 * Search Pexels videos for all scenes
 */
async function searchVideosForScenes(
  pexelsKey: string,
  scenes: StoryScene[],
  visualPreset: string
): Promise<StoryScene[]> {
  const usedVideoIds = new Set<number>();
  const fallbackKeywords = VISUAL_KEYWORDS[visualPreset] || ["dark atmospheric", "shadows", "night"];
  
  for (const scene of scenes) {
    // Try scene-specific keywords first, then fallbacks
    const allKeywords = [...scene.keywords, ...fallbackKeywords];
    const result = await searchPexelsForKeywords(pexelsKey, allKeywords, usedVideoIds);
    
    if (result) {
      scene.videoUrl = result.source_url;
      usedVideoIds.add(result.videoId);
    } else {
      // Last resort: any dark video
      const fallback = await searchPexelsForKeywords(pexelsKey, ["dark room", "shadows", "night sky"], usedVideoIds);
      if (fallback) {
        scene.videoUrl = fallback.source_url;
        usedVideoIds.add(fallback.videoId);
      }
    }
  }
  
  // If any scene still has no video, use the first scene's video or a default
  const firstVideoUrl = scenes.find(s => s.videoUrl)?.videoUrl;
  // Fallback to a generic dark video if all searches failed
  const defaultVideoUrl = "https://videos.pexels.com/video-files/3571264/3571264-uhd_2560_1440_30fps.mp4"; // Dark clouds
  
  for (const scene of scenes) {
    if (!scene.videoUrl) {
      scene.videoUrl = firstVideoUrl || defaultVideoUrl;
    }
  }
  
  return scenes;
}

// =====================================================
// DALL-E IMAGE GENERATION FOR SCENES (Story Anchor Method)
// Based on best practices for consistent horror imagery
// =====================================================

// =====================================================
// UPGRADED ANCHOR SYSTEM: Content + Style + Character
// =====================================================

/**
 * Scene Visual Contract - LITERAL frame-by-frame visual requirements
 * This is the missing layer that converts prose → concrete visuals
 */
interface SceneVisualContract {
  sceneIndex: number;
  location: string;              // exact physical place (bedroom, bathroom, hallway)
  characterPose: string;         // what the body is doing (sitting, standing, running)
  facialExpression: string;      // visible emotion (fear, confusion, shock)
  visibleObjects: string[];      // MUST be present in image
  supernaturalElement: string | null;  // the horror element, if any
  cameraDistance: "extreme-close-up" | "close-up" | "medium" | "wide";
  lightingSource: string;        // where light comes from
  actionFrozen: string;          // the exact moment captured
  // NEW: Anti-drift fields
  forbiddenElements: string[];   // "stairs", "hallway", "extra people" - things that MUST NOT appear
  continuityFromPrev: string;    // "same bedroom as scene 1", "same outfit" - link to previous
  evidenceRule: string;          // "shadows must be visible on bedroom wall" - proof the scene is correct
}

/**
 * Character Lock - ensures same face/outfit across ALL scenes
 */
interface CharacterLock {
  id: string;           // stable hash like "char_8f3a"
  face: string;         // hair color/style, eye color, skin tone, age range, facial features
  outfit: string;       // exact clothing description
  silhouette: string;   // body type, height, build
  doNotChange: string[];// list of things that must stay constant
}

/**
 * Content Anchor - WHAT is in the scene (no style info)
 */
interface ContentAnchor {
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
interface StyleAnchor {
  name: string;
  renderStyle: string;      // art style description
  colorPalette: string;     // color rules
  technique: string;        // rendering technique
  negativePrompt: string;   // things to avoid
}

/**
 * Combined Story Anchor (backward compatible + new fields)
 */
interface StoryAnchor {
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
  
  // NEW: Structured anchors
  contentAnchor?: ContentAnchor;
  styleAnchor?: StyleAnchor;
  characterLock?: CharacterLock;
}

/**
 * Enhanced Visual Beat with mirror/reality rules
 */
interface VisualBeat {
  sceneIndex: number;
  visualBeat: string;
  cameraAngle: string;
  focus: string;
  moodLevel: number;
  // NEW: Horror-specific rules
  mirrorBehavior?: string;  // "reflection lags", "reflection smiles", etc
  realityRule?: string;     // "door is locked", "hallway extends infinitely"
  compositionHint?: string; // "centered", "rule of thirds", etc
  // NEW: Visual contract (filled by createSceneVisualContracts)
  visualContract?: SceneVisualContract;
}

// Deterministic mood level to descriptor mapping
const MOOD_DESCRIPTORS: Record<number, string> = {
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
const ORIENTATION_LOCK = `ORIENTATION LOCK:
Upright portrait 9:16, not rotated.
Top=ceiling/sky, bottom=floor/ground.
No dutch angle. No tilted horizon.`;

// Terms that contaminate custom styles (RENDERING keywords only, not horror tone words)
const FORBIDDEN_STYLE_TERMS = [
  "cinematic", "film grain", "depth of field", "dof", "bokeh",
  "photoreal", "photo-real", "photorealistic", "dslr", "macro", "ultra detailed",
  "noir", "graphic novel", "crosshatch", "crosshatching", "engraving", "etching",
  "realistic lighting", "dramatic lighting", "moody lighting",
  "ink shading", "hatching", "stippling", "woodcut",
  "concept art", "matte painting", "digital painting",
  "volumetric", "ray tracing", "subsurface scattering",
  "unreal engine", "octane render", "artstation",
  // NOTE: Removed "cosmic dread", "visceral terror" - these are valid horror tone words
];

/**
 * Strip forbidden style terms from anchor/beat text
 */
function stripForbiddenStyleTerms(input: string): string {
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
function rewriteToContentOnly(input: string, preset: string): string {
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

/**
 * Sanitize camera angles to be portrait-safe
 * Replaces landscape-implying terms with vertical equivalents
 */
function sanitizeCameraAngleForPortrait(cameraAngle: string): string {
  // Map of landscape-implying terms to portrait-safe equivalents
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
function buildFinalDallePrompt(
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
    
    const mustNotItems = contract.forbiddenElements?.length > 0
      ? contract.forbiddenElements
      : ["stairs", "hallway", "extra people", "mirror"];
    
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

/**
 * Create a "Story Anchor" - the visual bible for the entire story
 * This ensures all images share the same visual universe
 */
async function createStoryAnchor(
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
}

/**
 * Create visual beats with escalating mood for each scene
 */
async function createVisualBeats(
  openaiKey: string,
  scenes: StoryScene[],
  storyAnchor: StoryAnchor
): Promise<VisualBeat[]> {
  try {
    const sceneTexts = scenes.map((s, i) => `Scene ${i + 1}: "${s.text}"`).join("\n\n");
    
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

The story takes place in: ${storyAnchor.environment}
Horror tone: ${storyAnchor.horrorTone}

For EACH scene, create a visual beat with these fields:
1. VISUAL_BEAT: Specific visual moment to capture. Be CINEMATIC not literal. Use horror cinematography language.
2. CAMERA_ANGLE: wide establishing shot, medium shot, close-up, extreme close-up, low angle, high angle, POV shot, over-the-shoulder
3. FOCUS: What the viewer's eye should be drawn to (be specific)
4. MOOD_LEVEL: 1-10 escalating intensity (MUST increase or stay same, never decrease)
5. MIRROR_BEHAVIOR: How reflections/mirrors behave (pick one): "none" | "reflection shows different expression" | "something in reflection that isn't there" | "reflection delayed" | "no reflection at all"
6. REALITY_RULE: What's wrong with reality (pick one): "normal" | "shadows wrong direction" | "too many fingers" | "eyes follow camera" | "background subtly wrong" | "time seems frozen"
7. COMPOSITION_HINT: Framing suggestion (pick one): "centered subject" | "rule of thirds" | "negative space left" | "negative space right" | "claustrophobic tight" | "vast empty"

CRITICAL RULES:
- KEEP THE SAME ENVIRONMENT unless story EXPLICITLY changes location
- Use horror visual language: "barely visible", "partially obscured", "emerging from shadow", "something watching", "unnatural stillness"
- ESCALATE tension - each beat more unsettling than the last
- Avoid showing monster/threat directly - use silhouettes, shadows, implications
- Focus on ATMOSPHERE over explicit horror
- Mirror/reality rules should be "none"/"normal" for early scenes, getting stranger as mood escalates

Return JSON:
{"beats": [{"sceneIndex": 0, "visualBeat": "description", "cameraAngle": "angle type", "focus": "focus point", "moodLevel": 3, "mirrorBehavior": "none", "realityRule": "normal", "compositionHint": "centered subject"}, ...]}`,
          },
          {
            role: "user",
            content: `Scenes:\n${sceneTexts}`,
          },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to create visual beats");
    }

    const data = await response.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    const beats = parsed.beats || parsed.scenes || (Array.isArray(parsed) ? parsed : []);
    
    console.log(`Visual beats created: ${beats.length} beats`);
    return beats;
  } catch (error) {
    console.error("Failed to create visual beats:", error);
    // Fallback: create escalating beats with default mirror/reality rules
    return scenes.map((scene, i) => ({
      sceneIndex: i,
      visualBeat: `atmospheric horror scene: ${scene.text.substring(0, 50)}`,
      cameraAngle: i === 0 ? "wide establishing shot" : i === scenes.length - 1 ? "close-up" : "medium shot",
      focus: "the growing darkness",
      moodLevel: Math.min(3 + (i * 2), 10),
      mirrorBehavior: i < 2 ? "none" : i < 4 ? "reflection shows different expression" : "something in reflection that isn't there",
      realityRule: i < 3 ? "normal" : i < 5 ? "shadows wrong direction" : "eyes follow camera",
      compositionHint: "centered subject",
    }));
  }
}

/**
 * Create Scene Visual Contracts - converts prose → literal frame descriptions
 * This is the critical layer that makes images follow the story
 */
async function createSceneVisualContracts(
  openaiKey: string,
  scenes: StoryScene[],
  storyAnchor: StoryAnchor,
  visualBeats: VisualBeat[]
): Promise<SceneVisualContract[]> {
  try {
    const sceneData = scenes.map((s, i) => ({
      index: i,
      text: s.text,
      beat: visualBeats[i]?.visualBeat || "atmospheric moment",
      mood: visualBeats[i]?.moodLevel || 5
    }));
    
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
            content: `You are a storyboard artist converting story scenes into LITERAL visual frames.

ENVIRONMENT CONTEXT:
${storyAnchor.environment}
${storyAnchor.characterDescription ? `CHARACTER: ${storyAnchor.characterDescription}` : ""}

YOUR JOB: Convert each scene into a single FROZEN visual frame.

RULES:
1. Be LITERAL and CONCRETE - no symbolism, no abstraction
2. Everything you describe MUST be visible in a single image
3. Location must be a SPECIFIC physical place (bedroom, bathroom, hallway, kitchen)
4. Character pose must describe EXACTLY what the body is doing
5. Visible objects must be items that PHYSICALLY APPEAR in frame
6. Supernatural element should be VISUAL, not conceptual (not "feeling of dread" but "shadow with too many limbs")
7. MAINTAIN LOCATION CONTINUITY - don't jump to forest if story is in bedroom

For each scene, return:
{
  "sceneIndex": number,
  "location": "exact physical place - BE SPECIFIC (bedroom, bathroom, kitchen, hallway)",
  "characterPose": "specific body position and action",
  "facialExpression": "visible emotion on face",
  "visibleObjects": ["object1", "object2", "object3"],
  "supernaturalElement": "the horror visual, or null if none",
  "cameraDistance": "close-up" | "medium" | "wide",
  "lightingSource": "where light comes from",
  "actionFrozen": "the exact moment in time being captured",
  "forbiddenElements": ["things that must NOT appear - stairs, hallway, forest, extra people, mirrors, candles - unless story mentions them"],
  "continuityFromPrev": "what must match previous scene (same room, same outfit, same lighting)",
  "evidenceRule": "VISUAL PROOF this is the right scene - a specific detail that MUST be visible"
}

CRITICAL RULES FOR forbiddenElements:
- If story is in a BEDROOM, forbid: stairs, hallway, forest, outdoors, kitchen
- If story has ONE character, forbid: extra people, crowd, multiple figures
- If story has NO mirrors mentioned, forbid: mirrors, reflections
- Default forbid list: stairs, hallway, extra people (unless story needs them)

Return JSON array: {"contracts": [...]}`,
          },
          {
            role: "user",
            content: `Convert these scenes to visual contracts:\n\n${sceneData.map(s => 
              `Scene ${s.index + 1} (mood ${s.mood}/10):\nText: "${s.text}"\nBeat: ${s.beat}`
            ).join("\n\n")}`,
          },
        ],
        temperature: 0.4, // Lower temperature for more literal/consistent output
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to create visual contracts");
    }

    const data = await response.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    const contracts = parsed.contracts || parsed.scenes || (Array.isArray(parsed) ? parsed : []);
    
    console.log(`[VISUAL CONTRACTS] Created ${contracts.length} contracts`);
    
    // Log first contract for debugging
    if (contracts.length > 0) {
      console.log(`[VISUAL CONTRACTS] Scene 1 contract:`, JSON.stringify(contracts[0], null, 2));
    }
    
    return contracts;
  } catch (error) {
    console.error("Failed to create visual contracts:", error);
    // Fallback: create basic contracts from scene text
    const baseLocation = storyAnchor.environment.split(",")[0] || "dark room";
    return scenes.map((scene, i) => ({
      sceneIndex: i,
      location: baseLocation,
      characterPose: "standing, tense posture",
      facialExpression: "fear, wide eyes",
      visibleObjects: ["walls", "shadows"],
      supernaturalElement: i > 1 ? "unnatural shadows" : null,
      cameraDistance: i === 0 ? "wide" : "medium",
      lightingSource: "dim ambient light",
      actionFrozen: scene.text.substring(0, 50),
      forbiddenElements: ["stairs", "hallway", "extra people", "forest", "outdoors"],
      continuityFromPrev: i === 0 ? "establishing shot" : `same ${baseLocation} as scene 1`,
      evidenceRule: `scene must clearly show ${baseLocation}`,
    }));
  }
}

/**
 * Determine which image model to use
 * - dall-e-3: High quality, $0.12/image (default)
 * - gpt-4o: Good quality, ~$0.03/image (75% cheaper)
 * - flux: FLUX.1 Dev via Replicate, ~$0.025/image + reference conditioning
 */
function getImageModel(): "dall-e-3" | "gpt-4o" | "flux" {
  const model = Deno.env.get("IMAGE_MODEL");
  if (model === "gpt-4o" || model === "gpt-image-1") {
    return "gpt-4o";
  }
  if (model === "flux" || model === "replicate") {
    return "flux";
  }
  // Default to DALL-E 3 for now (most stable)
  return "dall-e-3";
}

// =====================================================
// REPLICATE / FLUX IMAGE GENERATION
// =====================================================

// =====================================================
// REPLICATE / FLUX IMAGE GENERATION
// Two-model approach for consistency:
// - Scene 1: flux-1.1-pro (text→image, best quality)
// - Scene 2+: flux-redux-dev (image→image with reference)
// =====================================================

/**
 * Generate image using FLUX 1.1 Pro (Scene 1 - Master Frame)
 * $0.04/image, best quality + prompt adherence
 */
async function generateFluxProImage(
  replicateKey: string,
  prompt: string,
  sceneIndex: number
): Promise<string | null> {
  try {
    console.log(`[FLUX-PRO] Generating scene ${sceneIndex + 1} (master frame)...`);
    
    // Use models endpoint for official models
    const response = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${replicateKey}`,
        "Content-Type": "application/json",
        "Prefer": "wait",  // Wait for result (up to 60s)
      },
      body: JSON.stringify({
        input: {
          prompt: prompt,
          width: 768,              // Explicit 9:16 portrait dimensions
          height: 1344,            // (768 * 16/9 ≈ 1365, using 1344 for compatibility)
          aspect_ratio: "9:16",    // Also specify ratio as backup
          output_format: "webp",
          output_quality: 90,
          safety_tolerance: 5,     // Allow horror content
          prompt_upsampling: false // CRITICAL: Disable to prevent style drift
        }
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[FLUX-PRO] API error:", response.status, error);
      return null;
    }

    const result = await response.json();
    
    // Handle both sync (Prefer: wait) and async responses
    if (result.output) {
      // Sync response - output is directly available
      const imageUrl = typeof result.output === 'string' ? result.output : result.output[0];
      if (imageUrl) {
        console.log(`[FLUX-PRO] ✓ Scene ${sceneIndex + 1} master frame generated`);
        return imageUrl;
      }
    }
    
    // If we got a prediction ID, poll for it
    if (result.id) {
      return await pollReplicatePrediction(replicateKey, result.id, sceneIndex, "FLUX-PRO");
    }
    
    console.error("[FLUX-PRO] Unexpected response format:", result);
    return null;
  } catch (error) {
    console.error("[FLUX-PRO] Generation error:", error);
    return null;
  }
}

/**
 * Generate image using FLUX Redux (Scenes 2+ - Reference-based)
 * Uses Scene 1 as style/character reference for consistency
 */
async function generateFluxReduxImage(
  replicateKey: string,
  prompt: string,
  sceneIndex: number,
  referenceImageUrl: string
): Promise<string | null> {
  try {
    console.log(`[FLUX-REDUX] Generating scene ${sceneIndex + 1} with reference...`);
    console.log(`[FLUX-REDUX] Reference: ${referenceImageUrl.substring(0, 80)}...`);
    
    // FLUX Redux Dev - img2img with reference conditioning
    const response = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-redux-dev/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${replicateKey}`,
        "Content-Type": "application/json",
        "Prefer": "wait",
      },
      body: JSON.stringify({
        input: {
          prompt: prompt,
          redux_image: referenceImageUrl,  // Reference image for style/character
          width: 768,
          height: 1344,
          aspect_ratio: "9:16",
          num_outputs: 1,
          output_format: "webp",
          output_quality: 90,
          megapixels: "1",           // Keep consistent resolution
          guidance: 3.5,             // Lower guidance = more reference adherence
          num_inference_steps: 28,
        }
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[FLUX-REDUX] API error:", response.status, error);
      // Fall back to FLUX Pro if Redux fails
      console.log("[FLUX-REDUX] Falling back to FLUX Pro...");
      return await generateFluxProImage(replicateKey, prompt, sceneIndex);
    }

    const result = await response.json();
    
    if (result.output) {
      const imageUrl = Array.isArray(result.output) ? result.output[0] : result.output;
      if (imageUrl) {
        console.log(`[FLUX-REDUX] ✓ Scene ${sceneIndex + 1} generated with reference`);
        return imageUrl;
      }
    }
    
    if (result.id) {
      return await pollReplicatePrediction(replicateKey, result.id, sceneIndex, "FLUX-REDUX");
    }
    
    console.error("[FLUX-REDUX] Unexpected response:", result);
    return null;
  } catch (error) {
    console.error("[FLUX-REDUX] Generation error:", error);
    return null;
  }
}

/**
 * Poll Replicate prediction until complete
 */
async function pollReplicatePrediction(
  replicateKey: string,
  predictionId: string,
  sceneIndex: number,
  modelName: string
): Promise<string | null> {
  const maxWait = 120000;
  const pollInterval = 2000;
  let elapsed = 0;
  
  console.log(`[${modelName}] Polling prediction ${predictionId}...`);
  
  while (elapsed < maxWait) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    elapsed += pollInterval;
    
    const statusResponse = await fetch(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      {
        headers: { "Authorization": `Bearer ${replicateKey}` },
      }
    );
    
    if (!statusResponse.ok) {
      console.error(`[${modelName}] Status check failed:`, statusResponse.status);
      continue;
    }
    
    const status = await statusResponse.json();
    
    if (status.status === "succeeded") {
      const imageUrl = Array.isArray(status.output) ? status.output[0] : status.output;
      if (imageUrl) {
        console.log(`[${modelName}] ✓ Scene ${sceneIndex + 1} generated`);
        return imageUrl;
      }
      console.error(`[${modelName}] No output URL`);
      return null;
    }
    
    if (status.status === "failed" || status.status === "canceled") {
      console.error(`[${modelName}] Prediction ${status.status}:`, status.error);
      return null;
    }
    
    console.log(`[${modelName}] Status: ${status.status} (${elapsed/1000}s)`);
  }
  
  console.error(`[${modelName}] Timed out after 120s`);
  return null;
}

/**
 * Main FLUX generation function - routes to Pro or Redux based on scene
 * Scene 1: flux-1.1-pro (text→image)
 * Scene 2+: flux-redux-dev (img2img with reference)
 */
async function generateFluxImage(
  replicateKey: string,
  prompt: string,
  sceneIndex: number,
  referenceImageUrl?: string
): Promise<string | null> {
  // Scene 1 (index 0): Use FLUX Pro for master frame
  if (sceneIndex === 0 || !referenceImageUrl) {
    return await generateFluxProImage(replicateKey, prompt, sceneIndex);
  }
  
  // Scenes 2+: Use FLUX Redux with reference for consistency
  return await generateFluxReduxImage(replicateKey, prompt, sceneIndex, referenceImageUrl);
}

/**
 * Generate image using GPT-4o's image generation capability
 * ~60-80% cheaper than DALL-E 3, better character consistency
 */
async function generateGPT4oImage(
  openaiKey: string,
  prompt: string,
  sceneIndex: number
): Promise<string | null> {
  try {
    console.log(`[GPT-4o] Generating scene ${sceneIndex + 1} image...`);
    
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",  // GPT-4o image generation model
        prompt: prompt,
        n: 1,
        size: "1024x1792",  // Portrait for vertical video
        quality: "high",
        response_format: "url",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[GPT-4o] Image API error:", response.status, error);
      // Fall back to DALL-E 3 on error
      console.log("[GPT-4o] Falling back to DALL-E 3...");
      return null;
    }

    const data = await response.json();
    const imageUrl = data.data?.[0]?.url;
    
    if (imageUrl) {
      console.log(`[GPT-4o] ✓ Scene ${sceneIndex + 1} image generated`);
      return imageUrl;
    }
    
    return null;
  } catch (error) {
    console.error("[GPT-4o] Generation error:", error);
    return null;
  }
}

/**
 * Generate image using Story Anchor + Visual Beat
 * Supports DALL-E 3, GPT-4o, and FLUX via Replicate
 */
async function generateDalleImageWithAnchor(
  openaiKey: string,
  storyAnchor: StoryAnchor,
  beat: VisualBeat,
  sceneIndex: number,
  totalScenes: number,
  styleConfig?: { name: string; negativePrompt?: string; basePrompt?: string; colorOverride?: string; technicalStyle?: string },
  isCustomStyle: boolean = false,
  visualPreset: string = "dalle",
  referenceImageUrl?: string  // For FLUX: pass scene 0's URL for character consistency
): Promise<string | null> {
  try {
    // Build the complete prompt using the deterministic template function
    const prompt = buildFinalDallePrompt(
      storyAnchor,
      beat,
      sceneIndex,
      totalScenes,
      styleConfig || { name: "Cinematic Dark", negativePrompt: "text, words, letters, watermarks" },
      isCustomStyle,
      visualPreset
    );
    
    // Add technical requirements at the end
    // CRITICAL: When custom style is active, do NOT append storyAnchor.cameraStyle (it contaminates the style)
    let fullPrompt: string;
    if (isCustomStyle && styleConfig?.technicalStyle) {
      // Custom style: use ONLY the custom technicalStyle, not anchor's cameraStyle
      fullPrompt = `${prompt}\n\nCRITICAL: Portrait orientation (9:16 aspect ratio). Absolutely NO text, NO words, NO letters, NO writing anywhere in the image.`;
      console.log(`[IMAGE] Custom style active - NOT appending anchor.cameraStyle`);
    } else {
      // Built-in style: use anchor's camera style and palette
      fullPrompt = `${prompt}\n\nTechnical: ${storyAnchor.cameraStyle}\nColors: ${storyAnchor.colorPalette}\nRecurring elements: ${storyAnchor.recurringMotifs}\n\nCRITICAL: Portrait orientation (9:16 aspect ratio). Absolutely NO text, NO words, NO letters, NO writing, NO symbols with text anywhere in the image.`;
    }

    console.log(`Scene ${sceneIndex + 1} prompt (mood ${beat.moodLevel}/10):`, beat.visualBeat);
    console.log(`[IMAGE] Full prompt length: ${fullPrompt.length} chars`);

    // Check which model to use
    const imageModel = getImageModel();
    console.log(`[IMAGE] Using model: ${imageModel}`);
    
    // Try FLUX first if configured
    if (imageModel === "flux") {
      const replicateKey = Deno.env.get("REPLICATE_API_TOKEN");
      if (replicateKey) {
        const fluxResult = await generateFluxImage(
          replicateKey, 
          fullPrompt, 
          sceneIndex,
          referenceImageUrl  // Pass reference for character consistency
        );
        if (fluxResult) {
          return fluxResult;
        }
        console.log(`[IMAGE] FLUX failed, falling back to DALL-E 3...`);
      } else {
        console.log(`[IMAGE] REPLICATE_API_TOKEN not set, falling back to DALL-E 3...`);
      }
    }
    
    // Try GPT-4o if configured
    if (imageModel === "gpt-4o") {
      const gpt4oResult = await generateGPT4oImage(openaiKey, fullPrompt, sceneIndex);
      if (gpt4oResult) {
        return gpt4oResult;
      }
      console.log(`[IMAGE] GPT-4o failed, falling back to DALL-E 3...`);
    }
    
    // Use DALL-E 3 (default or fallback)
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: fullPrompt,
        n: 1,
        size: "1024x1792",
        quality: "hd",
        response_format: "url",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[DALL-E] API error:", response.status, error);
      return null;
    }

    const data = await response.json();
    const imageUrl = data.data?.[0]?.url;
    
    if (imageUrl) {
      console.log(`[DALL-E] ✓ Scene ${sceneIndex + 1} image generated`);
      return imageUrl;
    }
    
    return null;
  } catch (error) {
    console.error("[IMAGE] Generation error:", error);
    return null;
  }
}

/**
 * Generate DALL-E images for all scenes using Story Anchor method
 * This creates visually consistent, story-accurate images
 */
async function generateImagesForScenes(
  openaiKey: string,
  scenes: StoryScene[],
  visualPreset: string,
  artStyle: string = "cinematic-dark",
  fullStory?: string,
  supabase?: any,
  jobId?: string,
  customStyle?: any
): Promise<StoryScene[]> {
  // Get the full story text (combine scene texts if not provided)
  const storyText = fullStory || scenes.map(s => s.text).join(" ");
  
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
    console.log(`Using custom style: ${styleConfig.name}`);
  } else {
    styleConfig = ART_STYLE_CONFIG[artStyle] || ART_STYLE_CONFIG["cinematic-dark"];
  }
  
  // Helper to update progress
  const updateProgress = async (progress: number) => {
    if (supabase && jobId) {
      await supabase.from("jobs").update({ progress }).eq("id", jobId);
    }
  };
  
  console.log("=== DALL-E Story Anchor Method ===");
  console.log(`Art Style: ${styleConfig.name}`);
  console.log("Step 1: Creating Story Anchor (visual bible)...");
  
  // Step 1: Create the Story Anchor - the visual bible for consistency (with art style!)
  const storyAnchor = await createStoryAnchor(openaiKey, storyText, visualPreset, artStyle, customStyle);
  
  await updateProgress(62);
  
  // Step 2: Create visual beats with escalating mood
  console.log("Step 2: Creating visual beats with mood escalation...");
  const visualBeats = await createVisualBeats(openaiKey, scenes, storyAnchor);
  
  await updateProgress(63);
  
  // Step 2.5: Create Visual Contracts (CRITICAL - converts prose to literal frames)
  console.log("Step 2.5: Creating visual contracts (prose → literal frames)...");
  const visualContracts = await createSceneVisualContracts(openaiKey, scenes, storyAnchor, visualBeats);
  
  // Attach contracts to beats
  for (let i = 0; i < visualBeats.length; i++) {
    if (visualContracts[i]) {
      visualBeats[i].visualContract = visualContracts[i];
    }
  }
  console.log(`[VISUAL CONTRACTS] Attached ${visualContracts.length} contracts to beats`);
  
  await updateProgress(64);
  
  // Step 3: Generate images using anchor + beats + contracts
  console.log("Step 3: Generating images with visual contracts...");
  
  // Determine if this is a custom style (affects prompt building)
  const isCustomStyle = artStyle.startsWith('custom-') && !!customStyle;
  console.log(`[IMAGES] isCustomStyle: ${isCustomStyle}`);
  
  // Track first scene's image URL for FLUX reference conditioning
  let referenceImageUrl: string | undefined = undefined;
  
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const beat = visualBeats[i] || {
      sceneIndex: i,
      visualBeat: scene.text.substring(0, 100),
      cameraAngle: "medium shot",
      focus: "the atmosphere",
      moodLevel: 5,
    };
    
    console.log(`\nGenerating scene ${i + 1}/${scenes.length}...`);
    if (beat.visualContract) {
      console.log(`[CONTRACT] Location: ${beat.visualContract.location}`);
      console.log(`[CONTRACT] Pose: ${beat.visualContract.characterPose}`);
      console.log(`[CONTRACT] Objects: ${beat.visualContract.visibleObjects?.join(", ")}`);
    }
    
    // Build the prompt using deterministic template function (pass isCustomStyle flag)
    const dallePrompt = buildFinalDallePrompt(
      storyAnchor,
      beat,
      i,
      scenes.length,
      styleConfig,
      isCustomStyle,
      visualPreset
    );
    
    console.log(`[PROMPT] Scene ${i + 1} final prompt (${dallePrompt.length} chars)`);
    
    // Store prompt info on scene for later retrieval
    (scene as any).dallePrompt = dallePrompt;
    (scene as any).visualBeat = beat.visualBeat;
    (scene as any).moodLevel = beat.moodLevel;
    (scene as any).cameraAngle = beat.cameraAngle;
    (scene as any).visualContract = beat.visualContract;
    
    let imageUrl: string | null = null;
    try {
      imageUrl = await generateDalleImageWithAnchor(
        openaiKey,
        storyAnchor,
        beat,
        i,
        scenes.length,
        styleConfig,
        isCustomStyle,
        visualPreset,
        referenceImageUrl  // Pass scene 0's URL for FLUX character consistency
      );
      
      // Store first scene's URL as reference for subsequent scenes (FLUX only)
      if (i === 0 && imageUrl && getImageModel() === "flux") {
        referenceImageUrl = imageUrl;
        console.log(`[FLUX] Scene 1 stored as reference for character consistency`);
      }
    } catch (imgError) {
      console.error(`Scene ${i + 1} DALL-E error:`, imgError);
      imageUrl = null;
    }
    
    if (imageUrl) {
      scene.videoUrl = imageUrl;
      
      // IMMEDIATELY save to database for real-time frontend updates
      if (supabase && jobId) {
        try {
          const { error: insertError } = await supabase.from("job_assets").insert({
            job_id: jobId,
            type: "dalle_image",
            storage_path: imageUrl,
            meta: { 
              scene_index: i, 
              scene_text: scene.text,
              keywords: scene.keywords,
              start_time: scene.startTime,
              end_time: scene.endTime,
              source: "dalle",
              art_style: styleConfig.name,
              dalle_prompt: dallePrompt,
              visual_beat: beat.visualBeat,
              mood_level: beat.moodLevel,
              camera_angle: beat.cameraAngle,
              generated_at: new Date().toISOString(),
            },
          });
          if (insertError) {
            console.error(`Scene ${i + 1} DB insert error:`, insertError);
          } else {
            console.log(`✓ Scene ${i + 1} saved to database`);
          }
        } catch (dbError) {
          console.error(`Scene ${i + 1} DB error:`, dbError);
        }
      }
    } else {
      console.warn(`⚠ Failed to generate image for scene ${i + 1}`);
    }
    
    // Update progress: 63-69 spread across images
    const imageProgress = 63 + Math.floor((i + 1) / scenes.length * 6);
    await updateProgress(imageProgress);
    
    // Rate limiting delay between API calls
    if (i < scenes.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
  }
  
  // Fill any missing images with a fallback Pexels video
  console.log("\nStep 4: Checking for missing images...");
  const defaultVideoUrl = "https://videos.pexels.com/video-files/3571264/3571264-uhd_2560_1440_30fps.mp4";
  for (const scene of scenes) {
    if (!scene.videoUrl) {
      scene.videoUrl = defaultVideoUrl;
    }
  }
  
  return scenes;
}

// =====================================================
// STEP 5: Assemble Video with Creatomate (Multiple Scenes)
// =====================================================

// Scary words to highlight
const SCARY_WORDS = new Set([
  "dead", "death", "die", "dying", "kill", "killed", "murder", "blood", "scream", "screaming",
  "fear", "terror", "horror", "nightmare", "demon", "ghost", "monster", "creature", "evil",
  "dark", "darkness", "shadow", "shadows", "whisper", "whispers", "haunted", "cursed",
  "grave", "corpse", "body", "flesh", "bone", "bones", "skull", "eyes", "watching",
  "behind", "door", "basement", "attic", "mirror", "reflection", "breathing", "footsteps",
  "alone", "trapped", "escape", "run", "hide", "follow", "followed", "stalking",
]);

// Caption style configurations
const CAPTION_STYLES: Record<string, any> = {
  bold: {
    font_family: "Montserrat",
    font_weight: "800",
    font_size: "8 vmin",
  },
  typewriter: {
    font_family: "Courier New",
    font_weight: "400",
    font_size: "7 vmin",
  },
  horror: {
    font_family: "Times New Roman",
    font_weight: "700",
    font_size: "8 vmin",
    font_style: "italic",
  },
  glitch: {
    font_family: "Impact",
    font_weight: "400",
    font_size: "8 vmin",
  },
};

interface VideoOptions {
  filter: boolean;
  kenburns: boolean;
  transitions: boolean;
  vignette: boolean;
  music: boolean;
  sfx: boolean;
  captionStyle: string;
  highlightScary: boolean;
}

async function assembleVideo(
  creatomateKey: string,
  audioUrl: string,
  captionsData: Array<{ word: string; start: number; end: number }>,
  scenes: StoryScene[],
  durationSec: number,
  options: VideoOptions,
  visualSource: string = "pexels"
): Promise<string> {
  const isUsingImages = visualSource === "dalle";
  
  // Build background elements for each scene (video or image)
  const backgroundElements = scenes.map((scene, index) => {
    const element: any = {
      type: isUsingImages ? "image" : "video",
      source: scene.videoUrl,
      time: scene.startTime,
      duration: scene.endTime - scene.startTime + 0.5,
      fit: "cover",
      // Ensure full coverage for portrait videos (9:16)
      width: "100%",
      height: "100%",
    };
    
    // Video-specific properties
    if (!isUsingImages) {
      element.loop = true;
      element.volume = options.music ? "15%" : "0%";
    }

    // Add Ken Burns effect (slow zoom/pan) - especially important for static images!
    if (options.kenburns) {
      if (isUsingImages) {
        // More dramatic Ken Burns for static images
        const zoomDirection = index % 2 === 0 ? "in" : "out"; // Alternate zoom direction
        const startScale = zoomDirection === "in" ? "100%" : "120%";
        const endScale = zoomDirection === "in" ? "120%" : "100%";
        
        element.animations = [
          {
            type: "scale",
            start_scale: startScale,
            end_scale: endScale,
            easing: "linear",
          },
          // Add subtle pan for more life
          {
            type: "pan",
            start_x: index % 2 === 0 ? "0%" : "5%",
            end_x: index % 2 === 0 ? "5%" : "0%",
            easing: "linear",
          },
        ];
      } else {
        // Subtle Ken Burns for videos
        element.animations = [
          {
            type: "scale",
            start_scale: "100%",
            end_scale: "115%",
            easing: "linear",
          },
        ];
      }
    }

    // Add fade transition between scenes
    if (options.transitions && index > 0) {
      element.animations = [
        ...(element.animations || []),
        {
          type: "fade",
          fade: true,
          duration: 0.5,
        },
      ];
    }

    return element;
  });

  // Get caption style settings
  const captionStyleConfig = CAPTION_STYLES[options.captionStyle] || CAPTION_STYLES.bold;

  // Build caption elements (word-by-word animation)
  const captionElements = captionsData.map((caption) => {
    const word = caption.word.toLowerCase().replace(/[^a-z]/g, '');
    const isScary = options.highlightScary && SCARY_WORDS.has(word);
    
    return {
      type: "text",
      text: caption.word,
      time: caption.start,
      duration: caption.end - caption.start + 0.1,
      y: "75%",
      width: "90%",
      height: "20%",
      x_alignment: "50%",
      y_alignment: "50%",
      ...captionStyleConfig,
      fill_color: isScary ? "#ff0000" : "#ffffff",
      stroke_color: "#000000",
      stroke_width: "1.5 vmin",
      shadow_color: "rgba(0,0,0,0.8)",
      shadow_blur: "2 vmin",
      animations: [
        {
          type: "scale",
          start_scale: isScary ? "90%" : "80%",
          end_scale: isScary ? "110%" : "100%",
          fade: true,
          time: "start",
          duration: 0.1,
        },
      ],
    };
  });

  // Add 1 second buffer to ensure audio completes fully
  const videoDuration = durationSec + 1;
  
  // Build elements array
  const elements: any[] = [
    // Background videos for each scene (layered with transitions)
    ...backgroundElements,
  ];

  // Horror filter (color grading + grain)
  if (options.filter) {
    elements.push({
      type: "shape",
      shape: "rectangle",
      fill_color: "rgba(0,0,0,0.3)",
      width: "100%",
      height: "100%",
      blend_mode: "multiply",
    });
    // Slight desaturation/color tint
    elements.push({
      type: "shape", 
      shape: "rectangle",
      fill_color: "rgba(20,0,30,0.15)",
      width: "100%",
      height: "100%",
      blend_mode: "overlay",
    });
  }

  // Vignette effect
  if (options.vignette) {
    elements.push({
      type: "shape",
      shape: "ellipse",
      fill: "radial-gradient(circle, transparent 30%, rgba(0,0,0,0.7) 100%)",
      width: "100%",
      height: "100%",
    });
  }

  // Dark overlay for text visibility (always on but lighter if filter is enabled)
  elements.push({
    type: "shape",
    shape: "rectangle",
    fill_color: options.filter ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.4)",
    width: "100%",
    height: "100%",
  });

  // Audio narration (full volume)
  elements.push({
    type: "audio",
    source: audioUrl,
    volume: "100%",
  });

  // Background music (if enabled)
  // NOTE: Upload your own royalty-free horror music to Supabase Storage bucket "story-videos" as "music/background.mp3"
  if (options.music) {
    // Try to use user-uploaded music from Supabase storage
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const musicUrl = `${supabaseUrl}/storage/v1/object/public/story-videos/music/background.mp3`;
    
    elements.push({
      type: "audio",
      source: musicUrl,
      volume: "10%",
      duration: videoDuration,
      audio_fade_out: 2,
    });
  }

  // Captions
  elements.push(...captionElements);

  const source = {
    output_format: "mp4",
    width: 1080,
    height: 1920,
    duration: videoDuration,
    elements,
  };

  console.log("Sending source to Creatomate:", JSON.stringify(source, null, 2));

  const response = await fetch("https://api.creatomate.com/v2/renders", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${creatomateKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(source),
  });

  const responseText = await response.text();
  console.log("Creatomate response status:", response.status);
  console.log("Creatomate response:", responseText);

  if (!response.ok) {
    throw new Error(`Creatomate API error: ${response.status} - ${responseText}`);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    throw new Error(`Failed to parse Creatomate response: ${responseText}`);
  }
  
  // Creatomate v2 returns an array of renders
  console.log("Parsed Creatomate data:", JSON.stringify(data));
  
  // Check if it's an array
  if (Array.isArray(data) && data[0] && data[0].id) {
    console.log("Render ID (array):", data[0].id);
    return data[0].id;
  }
  
  // Or if it's a single object
  if (data && data.id) {
    console.log("Render ID (object):", data.id);
    return data.id;
  }
  
  throw new Error(`Failed to start Creatomate render. Response: ${JSON.stringify(data)}`);
}

// =====================================================
// STEP 6: Poll Creatomate for completion
// =====================================================
// Helper to check Creatomate render status
async function checkCreatomateRender(
  creatomateKey: string,
  renderId: string
): Promise<{ status: string; url?: string; progress?: number; error_message?: string }> {
  const response = await fetch(
    `https://api.creatomate.com/v2/renders/${renderId}`,
    {
      headers: {
        "Authorization": `Bearer ${creatomateKey}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to check render status: ${response.status}`);
  }

  const data = await response.json();
  return {
    status: data.status,
    url: data.url,
    progress: data.progress,
    error_message: data.error_message,
  };
}

async function waitForRender(
  creatomateKey: string,
  renderId: string,
  maxAttempts: number = 60
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(
      `https://api.creatomate.com/v2/renders/${renderId}`,
      {
        headers: {
          "Authorization": `Bearer ${creatomateKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to check render status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.status === "succeeded") {
      return data.url; // The final video URL
    } else if (data.status === "failed") {
      throw new Error(`Render failed: ${data.error_message || "Unknown error"}`);
    }

    // Wait 3 seconds before next check
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error("Render timed out");
}

// =====================================================
// FFMPEG RENDERER (Creatomate Replacement)
// =====================================================
// Use this when Creatomate credits run out

/**
 * Render video using FFmpeg service (self-hosted)
 * Deploy video-renderer service to Render.com/Railway/Fly.io
 */
async function renderWithFFmpeg(
  audioUrl: string,
  scenes: StoryScene[],
  durationSec: number,
  options: VideoOptions
): Promise<{ renderId: string; status: string }> {
  const FFMPEG_RENDERER_URL = Deno.env.get("FFMPEG_RENDERER_URL");
  
  if (!FFMPEG_RENDERER_URL) {
    throw new Error("FFMPEG_RENDERER_URL not configured. Deploy video-renderer service and set env var.");
  }
  
  // Extract image URLs and durations from scenes
  const imageUrls = scenes.map(s => s.videoUrl);
  const durations = scenes.map(s => Math.ceil(s.endTime - s.startTime));
  
  console.log(`[FFMPEG] Starting render with ${imageUrls.length} images`);
  console.log(`[FFMPEG] Durations: ${durations.join(", ")} seconds`);
  
  // Retry logic for cold start handling (Render.com free tier takes 30-60s to wake)
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[FFMPEG] Render attempt ${attempt}/3...`);
      
      const response = await fetch(`${FFMPEG_RENDERER_URL}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: imageUrls,
          audio_url: audioUrl,
          durations: durations,
          effects: {
            kenBurns: options.kenburns,
            fadeTransitions: options.transitions,
            vignette: options.vignette,
            horrorGrade: options.filter,
          },
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`FFmpeg renderer error: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      console.log(`[FFMPEG] Render job started: ${data.job_id}`);
      
      return {
        renderId: data.job_id,
        status: "processing",
      };
    } catch (err) {
      lastError = err as Error;
      console.log(`[FFMPEG] Attempt ${attempt} failed: ${lastError.message}`);
      if (attempt < 3) {
        // Wait before retry (cold start can take 30-60s)
        console.log(`[FFMPEG] Waiting 20s before retry...`);
        await new Promise(r => setTimeout(r, 20000));
      }
    }
  }
  
  throw new Error(`FFmpeg render failed after 3 attempts: ${lastError?.message}`);
}

/**
 * Check FFmpeg render status (with retry for cold start)
 */
async function checkFFmpegRender(
  renderId: string
): Promise<{ status: string; url?: string; progress?: number; error?: string }> {
  const FFMPEG_RENDERER_URL = Deno.env.get("FFMPEG_RENDERER_URL");
  
  if (!FFMPEG_RENDERER_URL) {
    throw new Error("FFMPEG_RENDERER_URL not configured");
  }
  
  // Retry logic for cold start handling
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(`${FFMPEG_RENDERER_URL}/status/${renderId}`);
      
      if (!response.ok) {
        throw new Error(`Failed to check FFmpeg render: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Map FFmpeg status to Creatomate-compatible format
      return {
        status: data.status === "complete" ? "succeeded" : data.status === "failed" ? "failed" : "processing",
        url: data.url ? `${FFMPEG_RENDERER_URL}${data.url}` : undefined,
        progress: data.progress,
        error: data.error,
      };
    } catch (err) {
      lastError = err as Error;
      console.log(`[FFMPEG] Status check attempt ${attempt} failed: ${lastError.message}`);
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 10000));
      }
    }
  }
  
  // Return "processing" status on error so polling continues
  console.log(`[FFMPEG] Status check failed, returning processing state`);
  return { status: "processing", progress: 0 };
}

/**
 * Determine which renderer to use (Creatomate or FFmpeg)
 */
function shouldUseFFmpegRenderer(): boolean {
  const useFFmpeg = Deno.env.get("USE_FFMPEG_RENDERER");
  const ffmpegUrl = Deno.env.get("FFMPEG_RENDERER_URL");
  
  // Use FFmpeg if explicitly enabled or if Creatomate key is missing/empty
  if (useFFmpeg === "true" || useFFmpeg === "1") {
    return true;
  }
  
  const creatomateKey = Deno.env.get("CREATOMATE_API_KEY");
  if (!creatomateKey || creatomateKey === "" || creatomateKey === "none") {
    return ffmpegUrl ? true : false;
  }
  
  return false;
}

// =====================================================
// MAIN HANDLER - Staged Processing
// =====================================================
// Supports phases: "audio", "images", "assemble", or null (auto)

// Declare EdgeRuntime for TypeScript
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<any>) => void;
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Get API keys from environment
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
  const elevenLabsKey = Deno.env.get("ELEVENLABS_API_KEY")!;
  const creatomateKey = Deno.env.get("CREATOMATE_API_KEY")!;
  const pexelsKey = Deno.env.get("PEXELS_API_KEY")!;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let job_id: string | null = null;
  
  try {
    const body = await req.json();
    job_id = body.job_id;
    const previewOnly = body.preview_only === true;
    const phase = body.phase || null; // "audio", "images", "assemble", or null for auto

    if (!job_id) {
      throw new Error("job_id is required");
    }

    // Fetch job
    const { data: job, error: fetchError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (fetchError || !job) {
      throw new Error(`Job not found: ${job_id}`);
    }

    // Get effect options (with defaults from job meta or request)
    const jobMeta = job.meta || {};
    const effectOptions = {
      filter: body.effect_filter ?? jobMeta.effect_filter ?? true,
      kenburns: body.effect_kenburns ?? jobMeta.effect_kenburns ?? true,
      transitions: body.effect_transitions ?? jobMeta.effect_transitions ?? true,
      vignette: body.effect_vignette ?? jobMeta.effect_vignette ?? true,
      music: body.audio_music ?? jobMeta.audio_music ?? false,
      sfx: body.audio_sfx ?? jobMeta.audio_sfx ?? false,
      captionStyle: body.caption_style ?? jobMeta.caption_style ?? "bold",
      highlightScary: body.highlight_scary ?? jobMeta.highlight_scary ?? true,
      voiceSpeed: jobMeta.voice_speed ?? "1.0",
    };

    // Determine visual source and art style
    const visualSource = jobMeta.visual_source || body.visual_source || "pexels";
    const artStyle = jobMeta.art_style || body.art_style || "cinematic-dark";
    const customStyle = jobMeta.custom_style || body.custom_style || null;

    console.log(`Starting job ${job_id} (preview: ${previewOnly}, phase: ${phase || 'auto'})`);
    console.log("Options:", effectOptions);
    console.log("Visual source:", visualSource, "Art style:", artStyle);

    // =====================================================
    // PREVIEW MODE: Run synchronously (quick)
    // =====================================================
    if (previewOnly) {
      return await runPreviewMode(
        supabase, openaiKey, job, job_id, jobMeta
      );
    }

    // =====================================================
    // PHASED GENERATION
    // =====================================================
    // Determine which phase to run based on job state
    let currentPhase = phase;
    
    if (!currentPhase) {
      // Auto-detect phase based on job progress
      const progress = job.progress || 0;
      if (progress < 50) {
        currentPhase = "audio";
      } else if (progress < 70) {
        currentPhase = "images";
      } else {
        currentPhase = "assemble";
      }
      console.log(`Auto-detected phase: ${currentPhase} (progress: ${progress}%)`);
    }

    await updateJob(supabase, job_id, { status: "generating" });

    let result;
    
    if (currentPhase === "audio") {
      // Phase 1: Generate story + audio
      result = await runAudioPhase(
        supabase, openaiKey, elevenLabsKey, job, job_id, jobMeta
      );
    } else if (currentPhase === "images") {
      // Phase 2: Generate images
      result = await runImagesPhase(
        supabase, openaiKey, pexelsKey, job, job_id, jobMeta, 
        visualSource, artStyle, customStyle
      );
    } else if (currentPhase === "assemble") {
      // Phase 3: Assemble video
      result = await runAssemblePhase(
        supabase, creatomateKey, job, job_id, jobMeta, effectOptions
      );
    } else {
      throw new Error(`Unknown phase: ${currentPhase}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        job_id: job_id,
        phase: currentPhase,
        next_phase: result?.nextPhase || null,
        status: result?.status || "generating",
        message: result?.message || "Phase complete",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error) {
    console.error("Job failed:", error);

    // Try to update job as failed
    if (job_id) {
      try {
        await updateJob(supabase, job_id, {
          status: "failed",
          error: error.message,
        });
      } catch (updateError) {
        console.error("Failed to update job status:", updateError);
      }
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

// =====================================================
// PREVIEW MODE (Synchronous - returns story quickly)
// =====================================================
async function runPreviewMode(
  supabase: any,
  openaiKey: string,
  job: any,
  job_id: string,
  jobMeta: any
) {
  await updateJob(supabase, job_id, { status: "generating", progress: 5 });

  console.log("Generating story...");
  const storyData = await generateStory(
    openaiKey,
    job.vibe_preset,
    job.length_preset
  );

  const wordCount = storyData.story.split(/\s+/).length;
  const estimatedDuration = Math.round((wordCount / 150) * 60);

  await updateJob(supabase, job_id, {
    progress: 25,
    title: storyData.title,
    story_text: storyData.story,
    story_word_count: wordCount,
    duration_sec: estimatedDuration,
  });

  // Save story JSON
  const storyJson = JSON.stringify(storyData, null, 2);
  await supabase.storage
    .from("story-videos")
    .upload(`${job_id}/story.json`, new Blob([storyJson]), {
      contentType: "application/json",
    });

  // Extract scene keywords for preview
  console.log("Extracting scene keywords...");
  const estimatedScenes = await extractSceneKeywordsForPreview(
    openaiKey,
    storyData.story,
    estimatedDuration,
    job.visual_preset || "forest"
  );

  // Save scene data
  for (let i = 0; i < estimatedScenes.length; i++) {
    const scene = estimatedScenes[i];
    await supabase.from("job_assets").insert({
      job_id: job_id,
      type: "bg_video",
      storage_path: "",
      meta: { 
        scene_index: i, 
        scene_text: scene.text,
        keywords: scene.keywords,
        start_time: scene.startTime,
        end_time: scene.endTime
      },
    });
  }

  await updateJob(supabase, job_id, { status: "preview", progress: 30 });

  return new Response(
    JSON.stringify({
      success: true,
      status: "preview",
      job_id: job_id,
      title: storyData.title,
      story_text: storyData.story,
      word_count: wordCount,
      duration_sec: estimatedDuration,
      scenes: estimatedScenes.map((s, i) => ({
        index: i,
        text: s.text,
        keywords: s.keywords,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    }
  );
}

// =====================================================
// PHASE 1: Generate Audio
// =====================================================
async function runAudioPhase(
  supabase: any,
  openaiKey: string,
  elevenLabsKey: string,
  job: any,
  job_id: string,
  jobMeta: any
) {
  console.log(`[AUDIO] Starting audio phase for job ${job_id}`);
  
  // Get story (should exist from preview)
  let storyData: { title: string; story: string };
  if (job.story_text && job.title) {
    storyData = { title: job.title, story: job.story_text };
  } else {
    console.log("[AUDIO] Generating new story...");
    storyData = await generateStory(openaiKey, job.vibe_preset, job.length_preset);
    await updateJob(supabase, job_id, {
      progress: 25,
      title: storyData.title,
      story_text: storyData.story,
    });
  }

  const wordCount = storyData.story.split(/\s+/).length;
  const estimatedDuration = Math.round((wordCount / 150) * 60);

  // Generate audio
  console.log("[AUDIO] Generating audio with word timestamps...");
  await updateJob(supabase, job_id, { progress: 30 });

  const audioResult = await generateAudio(
    elevenLabsKey,
    storyData.story,
    job.voice_id || ELEVENLABS_VOICE_ID
  );

  const actualDuration = audioResult.actualDuration || estimatedDuration;
  
  await updateJob(supabase, job_id, {
    progress: 45,
    duration_sec: actualDuration,
  });

  // Save captions
  const captionsData = { captions: audioResult.wordTimestamps };
  await supabase.storage
    .from("story-videos")
    .upload(`${job_id}/captions.json`, new Blob([JSON.stringify(captionsData)]), {
      contentType: "application/json",
      upsert: true,
    });

  // Upload audio
  await supabase.storage
    .from("story-videos")
    .upload(`${job_id}/audio.mp3`, audioResult.audioBuffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });

  // Extract scene keywords with actual timestamps
  const sceneCount = jobMeta.scene_count || 4;
  console.log(`[AUDIO] Extracting scene keywords (target: ${sceneCount} scenes)...`);
  const scenes = await extractSceneKeywords(
    openaiKey,
    storyData.story,
    audioResult.wordTimestamps,
    job.visual_preset || "forest",
    sceneCount
  );

  // Save scenes to job_assets
  console.log(`[AUDIO] Saving ${scenes.length} scenes to database...`);
  for (let i = 0; i < scenes.length; i++) {
    // Delete existing scene_data for this index first (in case of retry)
    await supabase.from("job_assets")
      .delete()
      .eq("job_id", job_id)
      .eq("type", "scene_data")
      .eq("storage_path", `scene_${i}`);
    
    const { error: sceneError } = await supabase.from("job_assets").insert({
      job_id: job_id,
      type: "scene_data",
      storage_path: `scene_${i}`,
      meta: { 
        scene_index: i, 
        scene_text: scenes[i].text,
        keywords: scenes[i].keywords,
        start_time: scenes[i].startTime,
        end_time: scenes[i].endTime
      },
    });
    
    if (sceneError) {
      console.error(`[AUDIO] Failed to save scene ${i}:`, sceneError);
    } else {
      console.log(`[AUDIO] ✓ Scene ${i} saved`);
    }
  }

  // Keep the original scene_count from user settings, just mark audio as ready
  await updateJob(supabase, job_id, { 
    progress: 50,
    meta: { ...jobMeta, audio_ready: true, scenes_created: scenes.length }
  });

  console.log(`[AUDIO] Audio phase complete, ${scenes.length} scenes ready for images (user requested: ${sceneCount})`);
  
  // Verify we created the right number of scenes
  if (scenes.length !== sceneCount) {
    console.warn(`[AUDIO] WARNING: Created ${scenes.length} scenes but user requested ${sceneCount}`);
  }
  return { status: "generating", nextPhase: "images", message: "Audio ready, starting images" };
}

// =====================================================
// PHASE 2: Generate Images (one at a time for reliability)
// =====================================================
async function runImagesPhase(
  supabase: any,
  openaiKey: string,
  pexelsKey: string,
  job: any,
  job_id: string,
  jobMeta: any,
  visualSource: string,
  artStyle: string,
  customStyle: any
) {
  console.log(`[IMAGES] Starting images phase for job ${job_id}`);
  
  // Check if images phase is already running (prevent concurrent runs)
  if (jobMeta.images_phase_running) {
    const startedAt = new Date(jobMeta.images_phase_started_at || 0).getTime();
    const elapsed = Date.now() - startedAt;
    // If started less than 2 minutes ago, skip
    if (elapsed < 2 * 60 * 1000) {
      console.log(`[IMAGES] Phase already running (started ${elapsed/1000}s ago), skipping`);
      return { status: "generating", nextPhase: "images", message: "Images phase already in progress" };
    }
  }
  
  // Mark phase as running to prevent concurrent triggers
  await updateJob(supabase, job_id, {
    progress: 55, // Move past 50 to prevent immediate re-trigger
    meta: { 
      ...jobMeta, 
      images_phase_running: true,
      images_phase_started_at: new Date().toISOString()
    }
  });
  
  // Get scene data
  const { data: sceneAssets } = await supabase
    .from("job_assets")
    .select("*")
    .eq("job_id", job_id)
    .eq("type", "scene_data")
    .order("meta->scene_index", { ascending: true });

  let scenes: StoryScene[];
  
  if (!sceneAssets || sceneAssets.length === 0) {
    console.log("[IMAGES] No scene data found, creating from story text...");
    
    // Fallback: create scenes from story text
    if (!job.story_text) {
      throw new Error("No scene data and no story text. Run audio phase first.");
    }
    
    // Split story into scenes - USE REQUESTED SCENE COUNT
    const sentences = job.story_text.match(/[^.!?]+[.!?]+/g) || [job.story_text];
    const requestedSceneCount = jobMeta.scene_count || 4;
    const sceneCount = Math.min(requestedSceneCount, sentences.length); // Don't exceed sentence count
    const sentencesPerScene = Math.ceil(sentences.length / sceneCount);
    const duration = job.duration_sec || 60;
    const sceneDuration = duration / sceneCount;
    
    console.log(`[IMAGES] Fallback scene creation: ${sentences.length} sentences -> ${sceneCount} scenes (requested: ${requestedSceneCount})`);
    
    scenes = [];
    for (let i = 0; i < sceneCount; i++) {
      const start = i * sentencesPerScene;
      const end = Math.min(start + sentencesPerScene, sentences.length);
      const sceneText = sentences.slice(start, end).join(' ').trim();
      
      scenes.push({
        text: sceneText,
        keywords: [],
        startTime: i * sceneDuration,
        endTime: (i + 1) * sceneDuration,
        videoUrl: "",
      });
    }
    
    console.log(`[IMAGES] Created ${scenes.length} scenes from story text`);
  } else {
    // Convert from database format
    scenes = sceneAssets.map((a: any) => ({
      text: a.meta.scene_text,
      keywords: a.meta.keywords || [],
      startTime: a.meta.start_time,
      endTime: a.meta.end_time,
      videoUrl: "",
    }));
    console.log(`[IMAGES] Loaded ${scenes.length} scenes from database`);
  }

  // IMPORTANT: Limit scenes to the user's requested count
  const requestedSceneCount = jobMeta.scene_count || 4;
  if (scenes.length > requestedSceneCount) {
    console.log(`[IMAGES] WARNING: Found ${scenes.length} scenes but user requested ${requestedSceneCount}. Limiting to requested count.`);
    scenes = scenes.slice(0, requestedSceneCount);
  }

  // Check how many images already generated
  const { data: existingImages } = await supabase
    .from("job_assets")
    .select("*")
    .eq("job_id", job_id)
    .eq("type", "dalle_image");

  const imagesGenerated = existingImages?.length || 0;
  console.log(`[IMAGES] ${imagesGenerated}/${scenes.length} images already generated`);

  if (imagesGenerated >= scenes.length) {
    // All images done
    await updateJob(supabase, job_id, { progress: 70 });
    return { status: "generating", nextPhase: "assemble", message: "All images ready" };
  }

  // Generate images based on source
  if (visualSource === "dalle") {
    // DALL-E: Generate ONE image at a time for reliability
    // This way if we timeout, we've at least saved some images
    
    // Get art style config
    let styleConfig;
    if (artStyle.startsWith('custom-') && customStyle) {
      styleConfig = {
        name: customStyle.name || "Custom Style",
        basePrompt: customStyle.basePrompt || "",
      };
    } else {
      styleConfig = ART_STYLE_CONFIG[artStyle] || ART_STYLE_CONFIG["cinematic-dark"];
    }
    
    // Check if we have a story anchor already
    let storyAnchor = jobMeta.story_anchor;
    if (!storyAnchor) {
      console.log("[IMAGES] Creating Story Anchor...");
      const storyText = job.story_text || scenes.map(s => s.text).join(" ");
      storyAnchor = await createStoryAnchor(openaiKey, storyText, job.visual_preset || "forest", artStyle, customStyle);
      
      // Save anchor to meta for future phases
      await updateJob(supabase, job_id, { 
        meta: { ...jobMeta, story_anchor: storyAnchor }
      });
      console.log("[IMAGES] Story Anchor created and saved");
    }
    
    // Get visual beats if not cached
    let visualBeats = jobMeta.visual_beats;
    if (!visualBeats) {
      console.log("[IMAGES] Creating visual beats...");
      visualBeats = await createVisualBeats(openaiKey, scenes, storyAnchor);
      
      await updateJob(supabase, job_id, { 
        meta: { ...jobMeta, story_anchor: storyAnchor, visual_beats: visualBeats }
      });
      console.log("[IMAGES] Visual beats created");
    }
    
    // Get visual contracts if not cached (NEW - CRITICAL for story accuracy)
    let visualContracts = jobMeta.visual_contracts;
    if (!visualContracts) {
      console.log("[IMAGES] Creating visual contracts (prose → literal frames)...");
      visualContracts = await createSceneVisualContracts(openaiKey, scenes, storyAnchor, visualBeats);
      
      // Attach contracts to beats
      for (let i = 0; i < visualBeats.length; i++) {
        if (visualContracts[i]) {
          visualBeats[i].visualContract = visualContracts[i];
        }
      }
      
      await updateJob(supabase, job_id, { 
        meta: { ...jobMeta, story_anchor: storyAnchor, visual_beats: visualBeats, visual_contracts: visualContracts }
      });
      console.log(`[IMAGES] Visual contracts created: ${visualContracts.length}`);
    } else {
      // Re-attach contracts to beats from cache
      for (let i = 0; i < visualBeats.length; i++) {
        if (visualContracts[i]) {
          visualBeats[i].visualContract = visualContracts[i];
        }
      }
    }
    
    await updateJob(supabase, job_id, { progress: 62 });
    
    // For FLUX: Get reference image URL from scene 0 (if already generated)
    let referenceImageUrl: string | undefined = undefined;
    if (getImageModel() === "flux" && imagesGenerated > 0) {
      // Fetch scene 0's image URL from database
      const { data: scene0Asset } = await supabase
        .from("job_assets")
        .select("storage_path")
        .eq("job_id", job_id)
        .eq("type", "dalle_image")
        .eq("meta->>scene_index", "0")
        .single();
      
      if (scene0Asset?.storage_path) {
        referenceImageUrl = scene0Asset.storage_path;
        console.log(`[FLUX] Retrieved scene 0 as reference for character consistency`);
      }
    }
    
    // Generate remaining images one at a time
    for (let i = imagesGenerated; i < scenes.length; i++) {
      const scene = scenes[i];
      const beat = visualBeats[i] || {
        sceneIndex: i,
        visualBeat: scene.text.substring(0, 100),
        cameraAngle: "medium shot",
        focus: "the atmosphere",
        moodLevel: 5,
      };
      
      console.log(`[IMAGES] Generating scene ${i + 1}/${scenes.length}...`);
      if (beat.visualContract) {
        console.log(`[CONTRACT] Location: ${beat.visualContract.location}`);
        console.log(`[CONTRACT] Pose: ${beat.visualContract.characterPose}`);
      }
      
      const isCustomStyle = artStyle.startsWith('custom-');
      const visualPreset = job.visual_preset || "forest";
      
      let imageUrl: string | null = null;
      try {
        imageUrl = await generateDalleImageWithAnchor(
          openaiKey,
          storyAnchor,
          beat,
          i,
          scenes.length,
          styleConfig,
          isCustomStyle,
          visualPreset,
          referenceImageUrl  // Pass reference for FLUX character consistency
        );
        
        // Store first scene as reference if FLUX
        if (i === 0 && imageUrl && getImageModel() === "flux") {
          referenceImageUrl = imageUrl;
          console.log(`[FLUX] Scene 1 stored as reference for character consistency`);
        }
      } catch (imgError) {
        console.error(`[IMAGES] Scene ${i + 1} DALL-E error:`, imgError);
        // Fallback to Pexels
        try {
          const fallbackQuery = scene.keywords.join(" ") || "dark forest";
          const fallbackVideos = await searchPexelsForKeywords(pexelsKey, [fallbackQuery]);
          imageUrl = fallbackVideos[0] || "https://videos.pexels.com/video-files/3571264/3571264-uhd_2560_1440_30fps.mp4";
          console.log(`[IMAGES] Scene ${i + 1} using Pexels fallback`);
        } catch (pexError) {
          imageUrl = "https://videos.pexels.com/video-files/3571264/3571264-uhd_2560_1440_30fps.mp4";
        }
      }
      
      // Build prompt using deterministic template function
      const dallePrompt = buildFinalDallePrompt(
        storyAnchor,
        beat,
        i,
        scenes.length,
        styleConfig,
        isCustomStyle,
        visualPreset
      );
      
      console.log(`[IMAGES] Scene ${i + 1} prompt built (${dallePrompt.length} chars)`);
      
      // Save to database IMMEDIATELY
      const { error: insertError } = await supabase.from("job_assets").insert({
        job_id: job_id,
        type: "dalle_image",
        storage_path: imageUrl,
        meta: { 
          scene_index: i, 
          scene_text: scene.text,
          keywords: scene.keywords,
          start_time: scene.startTime,
          end_time: scene.endTime,
          source: "dalle",
          art_style: styleConfig.name,
          dalle_prompt: dallePrompt,
          visual_beat: beat.visualBeat,
          mood_level: beat.moodLevel,
          camera_angle: beat.cameraAngle,
          continuity_rules: storyAnchor.continuityRules || null,
          character_description: storyAnchor.characterDescription || null,
          generated_at: new Date().toISOString(),
        },
      });
      
      if (insertError) {
        console.error(`[IMAGES] Scene ${i + 1} DB insert error:`, insertError);
      } else {
        console.log(`[IMAGES] ✓ Scene ${i + 1} saved to database`);
      }
      
      // Update progress
      const imageProgress = 63 + Math.floor((i + 1) / scenes.length * 6);
      await updateJob(supabase, job_id, { progress: imageProgress });
      
      // Rate limiting delay
      if (i < scenes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }
    
    // Check final count
    const { data: allImages } = await supabase
      .from("job_assets")
      .select("*")
      .eq("job_id", job_id)
      .eq("type", "dalle_image");

    if (allImages?.length >= scenes.length) {
      await updateJob(supabase, job_id, { 
        progress: 70,
        meta: { ...jobMeta, images_phase_running: false, images_complete: true }
      });
      return { status: "generating", nextPhase: "assemble", message: "All images ready" };
    } else {
      // More images still needed (shouldn't happen but just in case)
      await updateJob(supabase, job_id, { 
        meta: { ...jobMeta, images_phase_running: false }
      });
      return { status: "generating", nextPhase: "images", message: `${allImages?.length || 0}/${scenes.length} images generated` };
    }
  } else {
    // Pexels videos - fast, can do all at once
    const scenesWithVisuals = await searchVideosForScenes(pexelsKey, scenes, job.visual_preset || "forest");
    
    for (let i = 0; i < scenesWithVisuals.length; i++) {
      await supabase.from("job_assets").insert({
        job_id: job_id,
        type: "bg_video",
        storage_path: scenesWithVisuals[i].videoUrl || "",
        meta: { scene_index: i, source: "pexels" },
      });
    }

    await updateJob(supabase, job_id, { progress: 70 });
    return { status: "generating", nextPhase: "assemble", message: "Videos ready" };
  }
}

// =====================================================
// PHASE 3: Assemble Video
// =====================================================
async function runAssemblePhase(
  supabase: any,
  creatomateKey: string,
  job: any,
  job_id: string,
  jobMeta: any,
  options: any
) {
  console.log(`[ASSEMBLE] Starting assemble phase for job ${job_id}`);

  // Determine renderer to use
  const useFFmpeg = shouldUseFFmpegRenderer();
  console.log(`[ASSEMBLE] Using ${useFFmpeg ? "FFmpeg" : "Creatomate"} renderer`);

  // Check if assemble phase is already running
  if (jobMeta.assemble_phase_running) {
    const startedAt = new Date(jobMeta.assemble_phase_started_at || 0).getTime();
    const elapsed = Date.now() - startedAt;
    if (elapsed < 3 * 60 * 1000) {
      console.log(`[ASSEMBLE] Phase already running (started ${elapsed/1000}s ago), skipping`);
      return { status: "rendering", nextPhase: "assemble", message: "Assemble phase already in progress" };
    }
  }
  
  // Mark phase as running
  await updateJob(supabase, job_id, {
    progress: 72,
    meta: { 
      ...jobMeta, 
      assemble_phase_running: true,
      assemble_phase_started_at: new Date().toISOString(),
      renderer: useFFmpeg ? "ffmpeg" : "creatomate"
    }
  });

  // Get audio URL
  const { data: audioUrlData } = supabase.storage
    .from("story-videos")
    .getPublicUrl(`${job_id}/audio.mp3`);

  // Get captions
  const { data: captionsBlob } = await supabase.storage
    .from("story-videos")
    .download(`${job_id}/captions.json`);
  
  const captionsText = await captionsBlob.text();
  const captionsData = JSON.parse(captionsText);

  // Get images/videos
  const { data: imageAssets } = await supabase
    .from("job_assets")
    .select("*")
    .eq("job_id", job_id)
    .in("type", ["dalle_image", "bg_video"])
    .order("meta->scene_index", { ascending: true });

  // Get scene data
  const { data: sceneAssets } = await supabase
    .from("job_assets")
    .select("*")
    .eq("job_id", job_id)
    .eq("type", "scene_data")
    .order("meta->scene_index", { ascending: true });

  if (!imageAssets?.length || !sceneAssets?.length) {
    throw new Error("Missing images or scene data");
  }

  // Build scenes with visuals
  const scenes: StoryScene[] = sceneAssets.map((s: any, i: number) => ({
    text: s.meta.scene_text,
    keywords: s.meta.keywords || [],
    startTime: s.meta.start_time,
    endTime: s.meta.end_time,
    videoUrl: imageAssets[i]?.storage_path || "",
  }));

  const visualSource = imageAssets[0]?.type === "dalle_image" ? "dalle" : "pexels";
  
  let renderId: string;
  
  if (useFFmpeg) {
    // Use FFmpeg renderer
    console.log("[ASSEMBLE] Calling FFmpeg renderer...");
    const result = await renderWithFFmpeg(
      audioUrlData.publicUrl,
      scenes,
      job.duration_sec || 60,
      options
    );
    renderId = result.renderId;
  } else {
    // Use Creatomate
    console.log("[ASSEMBLE] Calling Creatomate...");
    renderId = await assembleVideo(
      creatomateKey,
      audioUrlData.publicUrl,
      captionsData.captions,
      scenes,
      job.duration_sec || 60,
      options,
      visualSource
    );
  }

  // Save render job info
  await supabase.from("job_assets").upsert({
    job_id: job_id,
    type: "render_job",
    storage_path: renderId,
    meta: { 
      render_id: renderId, 
      status: "rendering", 
      started_at: new Date().toISOString(),
      renderer: useFFmpeg ? "ffmpeg" : "creatomate"
    },
  }, {
    onConflict: "job_id,type"
  });

  await updateJob(supabase, job_id, { 
    status: "rendering",
    progress: 75,
    meta: { ...jobMeta, render_id: renderId, renderer: useFFmpeg ? "ffmpeg" : "creatomate" }
  });

  // Poll for completion (shorter timeout since we can be called again)
  const maxWaitTime = 2 * 60 * 1000; // 2 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    let renderStatus;
    if (useFFmpeg) {
      renderStatus = await checkFFmpegRender(renderId);
    } else {
      renderStatus = await checkCreatomateRender(creatomateKey, renderId);
    }
    
    if (renderStatus.status === "succeeded" && renderStatus.url) {
      // Save final video (delete existing then insert to avoid constraint issues)
      await supabase.from("job_assets")
        .delete()
        .eq("job_id", job_id)
        .eq("type", "final_mp4");
      
      const { error: insertError } = await supabase.from("job_assets").insert({
        job_id: job_id,
        type: "final_mp4",
        storage_path: renderStatus.url,
        public_url: renderStatus.url,
        meta: { render_id: renderId, status: "complete", renderer: useFFmpeg ? "ffmpeg" : "creatomate" },
      });
      
      if (insertError) {
        console.error("[ASSEMBLE] Failed to save final_mp4:", insertError);
      } else {
        console.log(`[ASSEMBLE] Final video saved: ${renderStatus.url}`);
      }

      await updateJob(supabase, job_id, {
        status: "complete",
        progress: 100,
      });

      console.log(`[ASSEMBLE] Job ${job_id} complete!`);
      return { status: "complete", nextPhase: null, message: "Video ready!" };
    } else if (renderStatus.status === "failed") {
      const errorMsg = (renderStatus as any).error || (renderStatus as any).error_message || "Unknown error";
      throw new Error(`Render failed: ${errorMsg}`);
    }

    // Update progress
    const progress = 75 + Math.floor((renderStatus.progress || 0) * 0.25);
    await updateJob(supabase, job_id, { progress });
  }

  // Still rendering, will continue on next poll
  return { status: "rendering", nextPhase: "assemble", message: "Still rendering..." };
}

// =====================================================
// FULL GENERATION (Legacy - kept for reference)
// =====================================================
async function runFullGeneration(
  supabase: any,
  openaiKey: string,
  elevenLabsKey: string,
  creatomateKey: string,
  pexelsKey: string,
  job: any,
  job_id: string,
  jobMeta: any,
  options: any,
  visualSource: string,
  artStyle: string,
  customStyle: any
) {
  try {
    console.log(`[BG] Starting full generation for job ${job_id}`);

    // =====================================================
    // STEP 1: Get or generate story (5% -> 25%)
    // =====================================================
    let storyData: { title: string; story: string };
    
    // Check if story already exists (from preview)
    if (job.story_text && job.title) {
      console.log("[BG] Using existing story from preview");
      storyData = { title: job.title, story: job.story_text };
    } else {
      console.log("[BG] Generating new story...");
      storyData = await generateStory(openaiKey, job.vibe_preset, job.length_preset);
      
      await updateJob(supabase, job_id, {
        progress: 25,
        title: storyData.title,
        story_text: storyData.story,
      });
    }

    const wordCount = storyData.story.split(/\s+/).length;
    const estimatedDuration = Math.round((wordCount / 150) * 60);

    // =====================================================
    // STEP 2: Generate Audio with ElevenLabs (25% -> 50%)
    // =====================================================
    console.log("[BG] Generating audio with word timestamps...");
    await updateJob(supabase, job_id, { progress: 30 });

    const audioResult = await generateAudio(
      elevenLabsKey,
      storyData.story,
      job.voice_id || ELEVENLABS_VOICE_ID
    );

    const actualDuration = audioResult.actualDuration || estimatedDuration;
    
    await updateJob(supabase, job_id, {
      progress: 45,
      duration_sec: actualDuration,
    });

    // Save captions
    const captionsData = { captions: audioResult.wordTimestamps };
    const captionsJson = JSON.stringify(captionsData, null, 2);
    await supabase.storage
      .from("story-videos")
      .upload(`${job_id}/captions.json`, new Blob([captionsJson]), {
        contentType: "application/json",
        upsert: true,
      });

    // Upload audio
    const { error: audioError } = await supabase.storage
      .from("story-videos")
      .upload(`${job_id}/audio.mp3`, audioResult.audioBuffer, {
        contentType: "audio/mpeg",
        upsert: true,
      });

    if (audioError) {
      throw new Error(`Failed to upload audio: ${audioError.message}`);
    }

    const { data: audioUrlData } = supabase.storage
      .from("story-videos")
      .getPublicUrl(`${job_id}/audio.mp3`);

    await updateJob(supabase, job_id, { progress: 50 });

    // =====================================================
    // STEP 3: Extract Scene Keywords (50% -> 55%)
    // =====================================================
    const targetSceneCount = jobMeta.scene_count || 4;
    console.log(`[BG] Extracting scene keywords (target: ${targetSceneCount} scenes)...`);
    const scenes = await extractSceneKeywords(
      openaiKey,
      storyData.story,
      audioResult.wordTimestamps,
      job.visual_preset || "forest",
      targetSceneCount
    );
    console.log(`[BG] Created ${scenes.length} scenes (requested: ${targetSceneCount})`);

    await updateJob(supabase, job_id, { progress: 55 });

    // =====================================================
    // STEP 4: Generate Visuals (55% -> 70%)
    // =====================================================
    let scenesWithVisuals: StoryScene[];
    
    if (visualSource === "dalle") {
      console.log("[BG] Generating DALL-E images...");
      try {
        scenesWithVisuals = await generateImagesForScenes(
          openaiKey, 
          scenes, 
          job.visual_preset || "forest",
          artStyle,
          storyData.story,
          supabase,
          job_id,
          customStyle
        );
      } catch (dalleError) {
        console.error("[BG] DALL-E generation failed:", dalleError);
        // Fall back to Pexels if DALL-E fails completely
        console.log("[BG] Falling back to Pexels videos...");
        scenesWithVisuals = await searchVideosForScenes(pexelsKey, scenes, job.visual_preset || "forest");
        for (let i = 0; i < scenesWithVisuals.length; i++) {
          const scene = scenesWithVisuals[i] as any;
          await supabase.from("job_assets").insert({
            job_id: job_id,
            type: "bg_video",
            storage_path: scene.videoUrl || "",
            meta: { scene_index: i, source: "pexels_fallback" },
          });
        }
      }
    } else {
      console.log("[BG] Searching Pexels for videos...");
      scenesWithVisuals = await searchVideosForScenes(pexelsKey, scenes, job.visual_preset || "forest");
      
      // Save Pexels assets
      for (let i = 0; i < scenesWithVisuals.length; i++) {
        const scene = scenesWithVisuals[i] as any;
        await supabase.from("job_assets").insert({
          job_id: job_id,
          type: "bg_video",
          storage_path: scene.videoUrl || "",
          meta: { 
            scene_index: i, 
            scene_text: scene.text,
            keywords: scene.keywords,
            start_time: scene.startTime,
            end_time: scene.endTime,
            source: "pexels",
          },
        });
      }
    }

    await updateJob(supabase, job_id, { progress: 70 });

    // =====================================================
    // STEP 5: Assemble Video with Creatomate (70% -> 95%)
    // =====================================================
    console.log("[BG] Assembling video with Creatomate...");

    const renderId = await assembleVideo(
      creatomateKey,
      audioUrlData.publicUrl,
      audioResult.wordTimestamps,
      scenesWithVisuals,
      actualDuration,
      options,
      visualSource
    );

    // Save render job info
    await supabase.from("job_assets").insert({
      job_id: job_id,
      type: "render_job",
      storage_path: "",
      meta: { 
        creatomate_render_id: renderId,
        started_at: new Date().toISOString(),
      },
    });

    await updateJob(supabase, job_id, { 
      progress: 75,
      meta: { ...jobMeta, creatomate_render_id: renderId }
    });

    // =====================================================
    // STEP 6: Wait for Render (75% -> 100%)
    // =====================================================
    console.log(`[BG] Waiting for render ${renderId}...`);

    // Poll Creatomate for completion (with timeout)
    const maxWaitTime = 5 * 60 * 1000; // 5 minutes max
    const startTime = Date.now();
    let finalVideoUrl: string | null = null;

    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5 sec intervals

      const renderStatus = await checkCreatomateRender(creatomateKey, renderId);
      
      if (renderStatus.status === "succeeded") {
        finalVideoUrl = renderStatus.url;
        console.log(`[BG] Render complete: ${finalVideoUrl}`);
        break;
      } else if (renderStatus.status === "failed") {
        throw new Error(`Render failed: ${renderStatus.error_message || "Unknown error"}`);
      }

      // Update progress
      const renderProgress = renderStatus.progress || 0;
      const overallProgress = 75 + Math.floor(renderProgress * 0.25);
      await updateJob(supabase, job_id, { progress: overallProgress });
    }

    if (!finalVideoUrl) {
      // Render still in progress - mark as rendering, check-job will continue polling
      await updateJob(supabase, job_id, { status: "rendering", progress: 85 });
      console.log(`[BG] Render still in progress, job marked as rendering`);
      return { status: "rendering", message: "Video is rendering, please poll for status" };
    }

    // Save final video reference
    await supabase.from("job_assets").upsert({
      job_id: job_id,
      type: "final_mp4",
      storage_path: finalVideoUrl,
      meta: { 
        creatomate_render_id: renderId,
        completed_at: new Date().toISOString(),
      },
    }, {
      onConflict: "job_id,type"
    });

    await updateJob(supabase, job_id, {
      status: "complete",
      progress: 100,
    });

    console.log(`[BG] Job ${job_id} completed successfully!`);
    return { status: "complete", message: "Video generation complete" };

  } catch (error) {
    console.error(`[BG] Job ${job_id} failed:`, error);
    
    await updateJob(supabase, job_id, {
      status: "failed",
      error: error.message,
    });
    
    return { status: "failed", message: error.message };
  }
}
