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
  visualPreset: string
): Promise<StoryScene[]> {
  try {
    // Split story into sentences
    const sentences = story.match(/[^.!?]+[.!?]+/g) || [story];
    
    // Group sentences into 2-3 sentence scenes (for ~10-15 second segments)
    const sceneTexts: string[] = [];
    let currentScene = "";
    let sentenceCount = 0;
    
    for (const sentence of sentences) {
      currentScene += sentence;
      sentenceCount++;
      
      // Create a new scene every 2 sentences, or if it's the last
      if (sentenceCount >= 2 || sentence === sentences[sentences.length - 1]) {
        sceneTexts.push(currentScene.trim());
        currentScene = "";
        sentenceCount = 0;
      }
    }
    
    // If we only have 1-2 scenes, that's fine
    console.log(`Split story into ${sceneTexts.length} scenes`);
    
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
            content: `Scenes:\n${sceneTexts.map((s, i) => `Scene ${i + 1}: "${s}"`).join("\n")}`,
          },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      console.error("Failed to extract scene keywords, status:", response.status);
      // Return fallback instead of throwing
      return sceneTexts.map((text, i) => {
        const totalDuration = captions[captions.length - 1]?.end || 45;
        const sceneDuration = totalDuration / sceneTexts.length;
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
      sceneKeywords = sceneTexts.map((_, i) => ({
        scene: i + 1,
        keywords: VISUAL_KEYWORDS[visualPreset] || ["dark atmospheric"],
      }));
    }
    
    console.log("Scene keywords:", sceneKeywords);
    
    // Calculate timing for each scene based on word timestamps
    const scenes: StoryScene[] = [];
    let wordIndex = 0;
    const totalDuration = captions[captions.length - 1]?.end || 45;
    
    for (let i = 0; i < sceneTexts.length; i++) {
      const sceneText = sceneTexts[i];
      const sceneWordCount = sceneText.split(/\s+/).length;
      
      // Find start time (first word of this scene)
      const startTime = wordIndex < captions.length ? captions[wordIndex].start : (i * totalDuration / sceneTexts.length);
      
      // Move word index forward
      wordIndex += sceneWordCount;
      
      // Find end time (last word of this scene)
      const endTime = wordIndex < captions.length 
        ? captions[Math.min(wordIndex - 1, captions.length - 1)].end 
        : ((i + 1) * totalDuration / sceneTexts.length);
      
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
// DALL-E IMAGE GENERATION FOR SCENES
// =====================================================

/**
 * Generate DALL-E image for a scene
 */
async function generateDalleImage(
  openaiKey: string,
  sceneText: string,
  keywords: string[]
): Promise<string | null> {
  try {
    const keywordString = keywords.join(", ");
    
    const prompt = `Cinematic horror scene: ${keywordString}. 
Dark, atmospheric, moody lighting. 
Style: Photorealistic horror cinematography, vertical 9:16 aspect ratio for social media.
The scene suggests: "${sceneText.substring(0, 200)}"
NO text, NO words, NO letters in the image.
Focus on atmosphere, shadows, and dread.`;

    console.log(`Generating DALL-E image with prompt: ${prompt.substring(0, 100)}...`);

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: prompt,
        n: 1,
        size: "1024x1792", // Portrait for 9:16 video
        quality: "standard",
        response_format: "url",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("DALL-E API error:", response.status, error);
      return null;
    }

    const data = await response.json();
    const imageUrl = data.data?.[0]?.url;
    
    if (imageUrl) {
      console.log(`DALL-E image generated successfully`);
      return imageUrl;
    }
    
    return null;
  } catch (error) {
    console.error("DALL-E generation error:", error);
    return null;
  }
}

/**
 * Generate DALL-E images for all scenes
 */
async function generateImagesForScenes(
  openaiKey: string,
  scenes: StoryScene[],
  visualPreset: string
): Promise<StoryScene[]> {
  const fallbackKeywords = VISUAL_KEYWORDS[visualPreset] || ["dark atmospheric", "horror", "shadows"];
  
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    console.log(`Generating DALL-E image for scene ${i + 1}/${scenes.length}...`);
    
    // Combine scene keywords with fallback
    const keywords = [...scene.keywords, ...fallbackKeywords.slice(0, 1)];
    
    const imageUrl = await generateDalleImage(openaiKey, scene.text, keywords);
    
    if (imageUrl) {
      // Store as imageUrl (we'll handle differently in video assembly)
      scene.videoUrl = imageUrl;
    } else {
      console.warn(`Failed to generate DALL-E image for scene ${i + 1}, will use fallback`);
    }
    
    // Add a small delay between API calls to avoid rate limiting
    if (i < scenes.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Fill any missing images with a fallback Pexels video
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

  // Background music (if enabled) - Using Incompetech royalty-free horror ambient
  // Alternative: Upload your own music to Supabase Storage for reliability
  if (options.music) {
    elements.push({
      type: "audio",
      // Dark ambient music from Free Music Archive (CC0)
      source: "https://files.freemusicarchive.org/storage-freemusicarchive-org/music/no_curator/Kevin_MacLeod/Horror/Kevin_MacLeod_-_Darkness_is_Coming.mp3",
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
// MAIN HANDLER
// =====================================================
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

    // Get effect options (with defaults from job meta or request)
    const effectOptions = {
      filter: body.effect_filter,
      kenburns: body.effect_kenburns,
      transitions: body.effect_transitions,
      vignette: body.effect_vignette,
      music: body.audio_music,
      sfx: body.audio_sfx,
      captionStyle: body.caption_style,
      highlightScary: body.highlight_scary,
    };

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

    // Merge options from job meta with request overrides
    const jobMeta = job.meta || {};
    const options = {
      filter: effectOptions.filter ?? jobMeta.effect_filter ?? true,
      kenburns: effectOptions.kenburns ?? jobMeta.effect_kenburns ?? true,
      transitions: effectOptions.transitions ?? jobMeta.effect_transitions ?? true,
      vignette: effectOptions.vignette ?? jobMeta.effect_vignette ?? true,
      music: effectOptions.music ?? jobMeta.audio_music ?? true,
      sfx: effectOptions.sfx ?? jobMeta.audio_sfx ?? false,
      captionStyle: effectOptions.captionStyle ?? jobMeta.caption_style ?? "bold",
      highlightScary: effectOptions.highlightScary ?? jobMeta.highlight_scary ?? true,
      voiceSpeed: jobMeta.voice_speed ?? "1.0",
    };

    console.log(`Starting job ${job_id} (preview: ${previewOnly})`);
    console.log("Options:", options);

    // =====================================================
    // STEP 1: Generate Story (5% -> 25%)
    // =====================================================
    await updateJob(supabase, job_id, { status: "generating", progress: 5 });

    console.log("Generating story...");
    const storyData = await generateStory(
      openaiKey,
      job.vibe_preset,
      job.length_preset
    );

    const wordCount = storyData.story.split(/\s+/).length;
    const config = LENGTH_CONFIG[job.length_preset as keyof typeof LENGTH_CONFIG];
    const estimatedDuration = Math.round((wordCount / 150) * 60); // ~150 words per minute

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

    // =====================================================
    // STEP 1.5: Extract Scene Keywords for Preview
    // =====================================================
    console.log("Extracting scene keywords...");
    
    // For preview, estimate scene timing without actual audio
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
        storage_path: "", // Will be filled when searching Pexels
        meta: { 
          scene_index: i, 
          scene_text: scene.text,
          keywords: scene.keywords,
          start_time: scene.startTime,
          end_time: scene.endTime
        },
      });
    }

    // If preview only, return here with story and scene data
    if (previewOnly) {
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
    // STEP 2 & 3: Generate Audio WITH Captions (25% -> 55%)
    // ElevenLabs returns both audio and word-level timestamps
    // =====================================================
    // ElevenLabs returns both audio and word-level timestamps
    // =====================================================
    console.log("Generating audio with word timestamps...");
    await updateJob(supabase, job_id, { progress: 30 });

    const audioResult = await generateAudio(
      elevenLabsKey,
      storyData.story,
      job.voice_id || ELEVENLABS_VOICE_ID
    );

    // Use actual duration from audio timestamps
    const actualDuration = audioResult.actualDuration || estimatedDuration;
    
    // Update job with actual duration
    await updateJob(supabase, job_id, {
      progress: 40,
      duration_sec: actualDuration,
    });

    // Save captions JSON (from ElevenLabs timestamps)
    const captionsData = { captions: audioResult.wordTimestamps };
    const captionsJson = JSON.stringify(captionsData, null, 2);
    await supabase.storage
      .from("story-videos")
      .upload(`${job_id}/captions.json`, new Blob([captionsJson]), {
        contentType: "application/json",
      });

    // Upload audio to storage
    const { data: audioUpload, error: audioError } = await supabase.storage
      .from("story-videos")
      .upload(`${job_id}/audio.mp3`, audioResult.audioBuffer, {
        contentType: "audio/mpeg",
      });

    if (audioError) {
      throw new Error(`Failed to upload audio: ${audioError.message}`);
    }

    // Get public URL for audio
    const { data: audioUrlData } = supabase.storage
      .from("story-videos")
      .getPublicUrl(`${job_id}/audio.mp3`);

    await updateJob(supabase, job_id, { progress: 55 });

    // =====================================================
    // STEP 4: Extract Scene Keywords & Get Backgrounds (55% -> 70%)
    // =====================================================
    console.log("Extracting scene keywords...");
    const scenes = await extractSceneKeywords(
      openaiKey,
      storyData.story,
      audioResult.wordTimestamps,
      job.visual_preset || "forest"
    );
    console.log(`Created ${scenes.length} scenes with keywords`);

    await updateJob(supabase, job_id, { progress: 60 });

    // Determine visual source from job meta
    const visualSource = jobMeta.visual_source || body.visual_source || "pexels";
    console.log(`Using visual source: ${visualSource}`);
    
    let scenesWithVisuals: StoryScene[];
    
    if (visualSource === "dalle") {
      // Use DALL-E for AI-generated images
      console.log("Generating DALL-E images for scenes...");
      scenesWithVisuals = await generateImagesForScenes(openaiKey, scenes, job.visual_preset || "forest");
    } else {
      // Use Pexels for stock videos (default)
      console.log("Searching Pexels for scene-specific videos...");
      scenesWithVisuals = await searchVideosForScenes(pexelsKey, scenes, job.visual_preset || "forest");
    }

    // Save asset references for all backgrounds
    for (let i = 0; i < scenesWithVisuals.length; i++) {
      const scene = scenesWithVisuals[i];
      await supabase.from("job_assets").insert({
        job_id: job_id,
        type: visualSource === "dalle" ? "dalle_image" : "bg_video",
        storage_path: scene.videoUrl || "",
        meta: { 
          scene_index: i, 
          scene_text: scene.text,
          keywords: scene.keywords,
          start_time: scene.startTime,
          end_time: scene.endTime,
          source: visualSource,
        },
      });
    }

    await updateJob(supabase, job_id, { status: "assembling", progress: 70 });

    // =====================================================
    // STEP 5: Assemble Video with Multiple Scenes (70% -> 95%)
    // =====================================================
    console.log("Assembling video with Creatomate (multiple scenes)...");
    console.log("Rendering with options:", options);
    console.log("Visual source:", visualSource);
    const renderId = await assembleVideo(
      creatomateKey,
      audioUrlData.publicUrl,
      captionsData.captions,
      scenesWithVisuals,
      actualDuration,
      options,
      visualSource // Pass visual source to handle images vs videos differently
    );

    // Store the render ID so we can check it later
    await supabase.from("job_assets").insert({
      job_id: job_id,
      type: "final_mp4",
      storage_path: renderId, // Store render ID temporarily
      public_url: null,
      meta: { render_id: renderId, status: "rendering" },
    });

    await updateJob(supabase, job_id, { 
      progress: 80,
      meta: { render_id: renderId }
    });

    // Wait for render to complete (with shorter timeout)
    console.log("Waiting for render...");
    try {
      const finalVideoUrl = await waitForRender(creatomateKey, renderId, 40); // 40 attempts * 3 sec = 2 min max

      // Update asset with final URL
      await supabase.from("job_assets")
        .update({ 
          storage_path: finalVideoUrl,
          public_url: finalVideoUrl,
          meta: { render_id: renderId, status: "complete" }
        })
        .eq("job_id", job_id)
        .eq("type", "final_mp4");

      await updateJob(supabase, job_id, {
        status: "complete",
        progress: 100,
      });

      console.log(`Job ${job_id} completed successfully!`);

      return new Response(
        JSON.stringify({
          success: true,
          job_id: job_id,
          video_url: finalVideoUrl,
          title: storyData.title,
          duration_sec: estimatedDuration,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    } catch (renderError) {
      // If render times out, return partial success - frontend will poll
      console.log("Render still in progress, returning partial success");
      return new Response(
        JSON.stringify({
          success: true,
          job_id: job_id,
          status: "rendering",
          message: "Video is rendering. Poll for status.",
          title: storyData.title,
          duration_sec: estimatedDuration,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }
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
