// =====================================================
// VIDEO ASSEMBLY MODULE
// Creatomate + FFmpeg Rendering
// =====================================================

import { SCARY_WORDS, CAPTION_STYLES, type StoryScene, type VideoOptions } from "./config.ts";

// =====================================================
// CREATOMATE VIDEO ASSEMBLY
// =====================================================

/**
 * Assemble video using Creatomate API
 */
export async function assembleVideoWithCreatomate(
  creatomateKey: string,
  audioUrl: string,
  captionsData: Array<{ word: string; start: number; end: number }>,
  scenes: StoryScene[],
  durationSec: number,
  options: VideoOptions,
  visualSource: string = "pexels"
): Promise<string> {
  // Debug: Log received options
  console.log(`[CREATOMATE] Received options:`, JSON.stringify({
    music: options.music,
    musicTrack: options.musicTrack,
    musicVolume: options.musicVolume,
    filter: options.filter,
    kenburns: options.kenburns,
  }));
  
  // Support both legacy "dalle" and new "ai" visual source
  const isUsingImages = visualSource === "dalle" || visualSource === "ai";
  
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

  // Horror filter (color grading - REDUCED to avoid over-darkening)
  if (options.filter) {
    // Very subtle darkening (was 0.3, now 0.1)
    elements.push({
      type: "shape",
      shape: "rectangle",
      fill_color: "rgba(0,0,0,0.1)",
      width: "100%",
      height: "100%",
      blend_mode: "multiply",
    });
    // Slight color tint - keep subtle
    elements.push({
      type: "shape", 
      shape: "rectangle",
      fill_color: "rgba(20,0,30,0.08)",
      width: "100%",
      height: "100%",
      blend_mode: "overlay",
    });
  }

  // Vignette effect - REDUCED opacity (was 0.7, now 0.4)
  if (options.vignette) {
    elements.push({
      type: "shape",
      shape: "ellipse",
      fill: "radial-gradient(circle, transparent 40%, rgba(0,0,0,0.4) 100%)",
      width: "100%",
      height: "100%",
    });
  }

  // Dark overlay for text visibility - REDUCED (was 0.2/0.4, now 0.1/0.2)
  elements.push({
    type: "shape",
    shape: "rectangle",
    fill_color: options.filter ? "rgba(0,0,0,0.1)" : "rgba(0,0,0,0.2)",
    width: "100%",
    height: "100%",
  });

  // Audio narration (full volume)
  elements.push({
    type: "audio",
    source: audioUrl,
    volume: "100%",
  });

  // Background music (if enabled and track selected)
  if (options.music && options.musicTrack) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const musicUrl = `${supabaseUrl}/storage/v1/object/public/story-videos/music/${options.musicTrack}`;
    const musicVolume = options.musicVolume ?? 15; // Default 15%
    
    console.log(`[MUSIC] Adding background music: ${options.musicTrack} at ${musicVolume}%`);
    
    elements.push({
      type: "audio",
      source: musicUrl,
      volume: `${musicVolume}%`,
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
// CREATOMATE RENDER STATUS
// =====================================================

/**
 * Check Creatomate render status
 */
export async function checkCreatomateRender(
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

/**
 * Wait for Creatomate render to complete
 */
export async function waitForCreatomateRender(
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

/**
 * Render video using FFmpeg service (self-hosted)
 * Deploy video-renderer service to Render.com/Railway/Fly.io
 */
export async function renderWithFFmpeg(
  audioUrl: string,
  scenes: StoryScene[],
  durationSec: number,
  options: VideoOptions,
  jobId?: string, // Supabase job ID for direct upload
  captions?: Array<{ word: string; start: number; end: number }>, // Word-by-word captions
  moodLevels?: number[] // Per-scene mood intensity (1-10) for intelligent Ken Burns
): Promise<{ renderId: string; status: string }> {
  const FFMPEG_RENDERER_URL = Deno.env.get("FFMPEG_RENDERER_URL");
  
  if (!FFMPEG_RENDERER_URL) {
    throw new Error("FFMPEG_RENDERER_URL not configured. Deploy video-renderer service and set env var.");
  }
  
  // Extract image URLs and durations from scenes
  // CRITICAL: Use fractional seconds (not Math.ceil) to avoid timing drift!
  // With 24 scenes, rounding each to whole seconds can cause 5-10s of cumulative drift
  const imageUrls = scenes.map(s => s.videoUrl);
  const durations = scenes.map(s => {
    const duration = s.endTime - s.startTime;
    // Round to 2 decimal places for precision, minimum 0.5s
    return Math.max(0.5, Math.round(duration * 100) / 100);
  });
  
  console.log(`[FFMPEG] Starting render with ${imageUrls.length} images`);
  console.log(`[FFMPEG] Durations: ${durations.map(d => d.toFixed(2)).join(", ")} seconds`);
  console.log(`[FFMPEG] Total duration: ${durations.reduce((a, b) => a + b, 0).toFixed(2)}s`);
  console.log(`[FFMPEG] Captions: ${captions?.length || 0} words`);
  console.log(`[FFMPEG] 🎵 Music settings: enabled=${options.music}, track="${options.musicTrack}", volume=${options.musicVolume}%`);
  
  // Build music URL if enabled
  const musicUrl = options.music && options.musicTrack 
    ? `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/story-videos/music/${options.musicTrack}`
    : null;
  
  if (musicUrl) {
    console.log(`[FFMPEG] 🎵 Music URL: ${musicUrl}`);
  } else if (options.music) {
    console.log(`[FFMPEG] ⚠️ Music enabled but no track selected`);
  }
  
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
          captions: captions || [], // Word-by-word captions with timestamps
          effects: {
            kenBurns: options.kenburns,
            fadeTransitions: options.transitions,
            vignette: options.vignette,
            horrorGrade: options.filter,
            filmGrain: options.filmGrain, // Film grain/old film effect
            captionStyle: options.captionStyle || "bold", // Caption style
            highlightScary: options.highlightScary !== false, // Highlight scary words
          },
          // Per-scene mood intensity for intelligent Ken Burns effect selection
          // 1-4 = subtle effects, 5-7 = medium, 8-10 = dramatic
          mood_levels: moodLevels || [],
          // Background music settings (use pre-built URL)
          music_url: musicUrl,
          music_volume: options.musicVolume ?? 15,
          job_id: jobId, // Pass Supabase job ID for direct upload
          low_memory: Deno.env.get("FFMPEG_LOW_MEMORY") === "true",
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
export async function checkFFmpegRender(
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
      // Prefer supabase_url if available (permanent), otherwise use local URL
      const videoUrl = data.supabase_url || (data.url ? `${FFMPEG_RENDERER_URL}${data.url}` : undefined);
      
      return {
        status: data.status === "complete" ? "succeeded" : data.status === "failed" ? "failed" : "processing",
        url: videoUrl,
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

// =====================================================
// PARALLEL IMAGE GENERATION (via FFmpeg server)
// =====================================================

export interface ParallelImageScene {
  index: number;
  prompt: string;
  text: string;
  start_time: number;
  end_time: number;
}

export interface ParallelImageResult {
  success: boolean;
  index: number;
  url?: string;
  error?: string;
  meta?: {
    scene_index: number;
    scene_text: string;
    start_time: number;
    end_time: number;
    image_model: string;
    art_style: string;
    dalle_prompt: string;
    generated_at: string;
  };
}

export interface ParallelImageJobStatus {
  status: 'processing' | 'complete' | 'partial' | 'failed';
  total: number;
  completed: number;
  failed: number;
  progress?: number;
  images: ParallelImageResult[];
  errors: Array<{ index: number; error: string }>;
  model: string;
  started_at: string;
  completed_at?: string;
  total_time_seconds?: number;
  error?: string;
}

/**
 * Check if parallel image generation is available
 * Requires FFmpeg server to be configured
 */
export function canUseParallelImageGeneration(): boolean {
  const ffmpegUrl = Deno.env.get("FFMPEG_RENDERER_URL");
  const useParallel = Deno.env.get("USE_PARALLEL_IMAGES");
  
  // Must have FFmpeg URL and parallel images enabled (or not explicitly disabled)
  return !!ffmpegUrl && useParallel !== "false" && useParallel !== "0";
}

/**
 * Start parallel image generation on FFmpeg server
 * Returns job ID for polling
 */
export async function startParallelImageGeneration(
  jobId: string,
  scenes: ParallelImageScene[],
  imageModel: "gpt-4o" | "dall-e-3" | "flux",
  artStyle: string,
  storyAnchor?: any
): Promise<{ imageJobId: string; statusUrl: string }> {
  const FFMPEG_RENDERER_URL = Deno.env.get("FFMPEG_RENDERER_URL");
  
  if (!FFMPEG_RENDERER_URL) {
    throw new Error("FFMPEG_RENDERER_URL not configured");
  }
  
  console.log(`[PARALLEL-IMG] Starting parallel generation of ${scenes.length} images with ${imageModel}`);
  
  // Retry for cold start handling
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${FFMPEG_RENDERER_URL}/generate-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          scenes: scenes,
          model: imageModel,
          art_style: artStyle,
          story_anchor: storyAnchor,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`FFmpeg image generation error: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      console.log(`[PARALLEL-IMG] Job started: ${data.image_job_id}`);
      
      return {
        imageJobId: data.image_job_id,
        statusUrl: data.status_url,
      };
    } catch (err) {
      lastError = err as Error;
      console.log(`[PARALLEL-IMG] Attempt ${attempt} failed: ${lastError.message}`);
      if (attempt < 3) {
        console.log(`[PARALLEL-IMG] Waiting 20s before retry (cold start)...`);
        await new Promise(r => setTimeout(r, 20000));
      }
    }
  }
  
  throw new Error(`Failed to start parallel image generation: ${lastError?.message}`);
}

/**
 * Check parallel image generation job status
 */
export async function checkParallelImageStatus(
  imageJobId: string
): Promise<ParallelImageJobStatus> {
  const FFMPEG_RENDERER_URL = Deno.env.get("FFMPEG_RENDERER_URL");
  
  if (!FFMPEG_RENDERER_URL) {
    throw new Error("FFMPEG_RENDERER_URL not configured");
  }
  
  const response = await fetch(`${FFMPEG_RENDERER_URL}/images-status/${imageJobId}`);
  
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Image job not found: ${imageJobId}`);
    }
    throw new Error(`Failed to check image status: ${response.status}`);
  }
  
  return await response.json();
}

/**
 * Determine which renderer to use (Creatomate or FFmpeg)
 */
export function shouldUseFFmpegRenderer(): boolean {
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

// Re-export for convenience
export { assembleVideoWithCreatomate as assembleVideo };
