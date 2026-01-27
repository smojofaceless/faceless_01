import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// =====================================================
// CONFIGURATION
// =====================================================
const ELEVENLABS_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam

// Story length targets (approximate word counts for target durations)
const LENGTH_CONFIG = {
  "30": { minWords: 70, maxWords: 90, targetSeconds: 30 },
  "45": { minWords: 100, maxWords: 130, targetSeconds: 45 },
  "60": { minWords: 140, maxWords: 170, targetSeconds: 60 },
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
- Must have a twist or scary ending
- No real person names (use "I", "my friend", "the man", etc.)
- No "based on true story" claims
- Present tense preferred
- Simple, punchy sentences

Return JSON format:
{
  "title": "Short catchy title (3-5 words)",
  "hook": "The attention-grabbing first line",
  "story": "The complete story including the hook"
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
        
        if (currentWord.trim()) {
          wordTimestamps.push({
            word: currentWord.trim(),
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
// STEP 4: Select Background Video
// =====================================================
async function selectBackgroundVideo(
  supabase: any,
  visualPreset: string
): Promise<{ name: string; source_url: string }> {
  const { data: videos, error } = await supabase
    .from("background_videos")
    .select("*")
    .eq("category", visualPreset)
    .eq("is_active", true);

  if (error || !videos || videos.length === 0) {
    throw new Error(`No background videos found for category: ${visualPreset}`);
  }

  // Pick random video from category
  const randomIndex = Math.floor(Math.random() * videos.length);
  return videos[randomIndex];
}

// =====================================================
// STEP 5: Assemble Video with Creatomate
// =====================================================
async function assembleVideo(
  creatomateKey: string,
  audioUrl: string,
  captionsData: Array<{ word: string; start: number; end: number }>,
  backgroundVideo: { source_url: string },
  durationSec: number
): Promise<string> {
  // Build caption elements for Creatomate (word-by-word animation)
  const captionElements = captionsData.map((caption, index) => ({
    type: "text",
    text: caption.word,
    time: caption.start,
    duration: caption.end - caption.start + 0.1, // Slight overlap
    y: "75%",
    width: "90%",
    height: "20%",
    x_alignment: "50%",
    y_alignment: "50%",
    font_family: "Montserrat",
    font_weight: "800",
    font_size: "8 vmin",
    fill_color: "#ffffff",
    stroke_color: "#000000",
    stroke_width: "1.5 vmin",
    shadow_color: "rgba(0,0,0,0.8)",
    shadow_blur: "2 vmin",
    animations: [
      {
        type: "scale",
        start_scale: "80%",
        end_scale: "100%",
        fade: true,
        time: "start",
        duration: 0.1,
      },
    ],
  }));

  const source = {
    output_format: "mp4",
    width: 1080,
    height: 1920,
    duration: durationSec,
    elements: [
      // Background video (loop if needed)
      {
        type: "video",
        source: backgroundVideo.source_url,
        duration: durationSec,
        loop: true,
        fit: "cover",
      },
      // Dark overlay for better text visibility
      {
        type: "shape",
        shape: "rectangle",
        fill_color: "rgba(0,0,0,0.4)",
        width: "100%",
        height: "100%",
      },
      // Audio narration
      {
        type: "audio",
        source: audioUrl,
        duration: durationSec,
      },
      // Captions
      ...captionElements,
    ],
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

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let job_id: string | null = null;
  
  try {
    const body = await req.json();
    job_id = body.job_id;

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

    console.log(`Starting job ${job_id}`);

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
    // STEP 2 & 3: Generate Audio WITH Captions (25% -> 55%)
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
    // STEP 4: Select Background Video (55% -> 70%)
    // =====================================================
    console.log("Selecting background video...");
    const bgVideo = await selectBackgroundVideo(supabase, job.visual_preset);

    // Save asset reference
    await supabase.from("job_assets").insert({
      job_id: job_id,
      type: "bg_video",
      storage_path: bgVideo.source_url,
      meta: { name: bgVideo.name },
    });

    await updateJob(supabase, job_id, { status: "assembling", progress: 70 });

    // =====================================================
    // STEP 5: Assemble Video (70% -> 95%)
    // =====================================================
    console.log("Assembling video with Creatomate...");
    const renderId = await assembleVideo(
      creatomateKey,
      audioUrlData.publicUrl,
      captionsData.captions,
      bgVideo,
      actualDuration
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
