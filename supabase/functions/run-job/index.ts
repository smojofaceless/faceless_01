// =====================================================
// RUN-JOB EDGE FUNCTION - MAIN HANDLER (Slim)
// All heavy logic is in separate modules
// v77.4 - 2026-02-05 (check-job: clear parallel flag when complete, trigger images phase to save to DB)
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

// Import from modules
import { corsHeaders, updateJob, getImageModel } from "./config.ts";
import {
  runPreviewMode,
  runAudioPhase,
  runImagesPhase,
  runAssemblePhase,
} from "./phases.ts";

// Declare EdgeRuntime for TypeScript
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<any>) => void;
};

// =====================================================
// MAIN HTTP HANDLER
// =====================================================

// Define CORS headers locally to ensure they're always available
// (in case config.ts import fails for some reason)
const localCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
};

serve(async (req) => {
  // DEBUG: Log every request for CORS troubleshooting
  console.log(`[CORS] method: ${req.method}, origin: ${req.headers.get("origin")}`);
  
  // Handle CORS preflight - MUST be first, before ANY other logic
  if (req.method === "OPTIONS") {
    console.log(`[CORS] Returning preflight response with headers:`, localCorsHeaders);
    return new Response("ok", { 
      status: 200,
      headers: localCorsHeaders 
    });
  }

  // Wrap EVERYTHING in try-catch to ensure CORS headers on all responses
  try {
    // Get API keys from environment with validation
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const elevenLabsKey = Deno.env.get("ELEVENLABS_API_KEY");
    const creatomateKey = Deno.env.get("CREATOMATE_API_KEY");
    const pexelsKey = Deno.env.get("PEXELS_API_KEY");

    // Check for missing required environment variables
    const missingVars: string[] = [];
    if (!supabaseUrl) missingVars.push("SUPABASE_URL");
    if (!supabaseServiceKey) missingVars.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!openaiKey) missingVars.push("OPENAI_API_KEY");
    if (!elevenLabsKey) missingVars.push("ELEVENLABS_API_KEY");
    
    if (missingVars.length > 0) {
      console.error(`[RUN-JOB] Missing environment variables: ${missingVars.join(", ")}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Server configuration error: missing ${missingVars.join(", ")}`,
        }),
        {
          headers: { ...localCorsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

    // Parse request body
    let body: any;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error(`[RUN-JOB] JSON parse error:`, parseError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid JSON body",
        }),
        {
          headers: { ...localCorsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const job_id = body.job_id;
    const previewOnly = body.preview_only === true;
    const phase = body.phase || null; // "audio", "images", "assemble", or null for auto

    if (!job_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "job_id is required",
        }),
        {
          headers: { ...localCorsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Fetch job with retry (database can have transient failures)
    let job: any = null;
    let fetchError: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await supabase
        .from("jobs")
        .select("*")
        .eq("id", job_id)
        .single();
      
      if (result.data) {
        job = result.data;
        fetchError = null;
        break;
      }
      
      fetchError = result.error;
      if (attempt < 3) {
        console.log(`[RUN-JOB] Job fetch attempt ${attempt} failed, retrying in 500ms...`);
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (fetchError || !job) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Job not found: ${job_id}`,
        }),
        {
          headers: { ...localCorsHeaders, "Content-Type": "application/json" },
          status: 404,
        }
      );
    }

    // Get effect options (with defaults from job meta or request)
    const jobMeta = job.meta || {};
    const effectOptions = {
      // Transitions - explicit boolean check
      fadeIn: body.effect_fade_in === true || jobMeta.effect_fade_in === true,
      fadeOut: body.effect_fade_out === true || jobMeta.effect_fade_out === true,
      transitions: body.effect_transitions === true || jobMeta.effect_transitions === true,
      // Disturbance & Glitch
      glitchFlicker: body.effect_glitch_flicker === true || jobMeta.effect_glitch_flicker === true,
      vhsTracking: body.effect_vhs_tracking === true || jobMeta.effect_vhs_tracking === true,
      scanlines: body.effect_scanlines === true || jobMeta.effect_scanlines === true,
      filmGrain: body.effect_filmgrain === true || jobMeta.effect_filmgrain === true,
      // Atmospheric
      kenburns: body.effect_kenburns === true || jobMeta.effect_kenburns === true,
      filter: body.effect_filter === true || jobMeta.effect_filter === true,
      vignette: body.effect_vignette === true || jobMeta.effect_vignette === true,
      lightFlicker: body.effect_light_flicker === true || jobMeta.effect_light_flicker === true,
      coldColorCreep: body.effect_cold_creep === true || jobMeta.effect_cold_creep === true,
      // Psychological
      heartbeatZoom: body.effect_heartbeat_zoom === true || jobMeta.effect_heartbeat_zoom === true,
      negativeFlash: body.effect_negative_flash === true || jobMeta.effect_negative_flash === true,
      edgeDarkeningCreep: body.effect_edge_darkening === true || jobMeta.effect_edge_darkening === true,
      // Audio
      music: body.audio_music === true || jobMeta.audio_music === true,
      musicTrack: body.audio_track || jobMeta.audio_track || '',
      musicVolume: body.audio_volume ?? jobMeta.audio_volume ?? 15,
      sfx: body.audio_sfx === true || jobMeta.audio_sfx === true,
      // Captions
      captionStyle: body.caption_style || jobMeta.caption_style || "bold",
      highlightScary: body.highlight_scary !== false && jobMeta.highlight_scary !== false,
      voiceSpeed: jobMeta.voice_speed ?? "1.0",
    };

    // Determine visual source, image model, and art style
    const visualSource = jobMeta.visual_source || body.visual_source || "ai";
    const imageModel = jobMeta.image_model || body.image_model || null;
    const artStyle = jobMeta.art_style || body.art_style || "cinematic-dark";
    const customStyle = jobMeta.custom_style || body.custom_style || null;
    const resolvedImageModel = getImageModel(imageModel);

    console.log(`Starting job ${job_id} (preview: ${previewOnly}, phase: ${phase || "auto"})`);
    console.log("Options:", effectOptions);
    console.log("Visual source:", visualSource, "Image model:", resolvedImageModel, "Art style:", artStyle);

    // Lock the resolved model into job meta to ensure phase retries use the same model
    // This prevents check-job → run-job cycles from losing the model choice
    if (!jobMeta.image_model || jobMeta.image_model !== resolvedImageModel) {
      console.log(`[LOCK] Locking image_model=${resolvedImageModel} into job meta`);
      const updatedMeta = {
        ...jobMeta,
        image_model: resolvedImageModel,
        resolved_image_model: resolvedImageModel,
      };
      await updateJob(supabase, job_id, { meta: updatedMeta });
      // Update local reference so phase runners see the locked value
      Object.assign(jobMeta, updatedMeta);
    }

    // =====================================================
    // PREVIEW MODE: Run synchronously (quick)
    // =====================================================
    if (previewOnly) {
      try {
        return await runPreviewMode(supabase, openaiKey, job, job_id, jobMeta);
      } catch (previewError: any) {
        console.error("[RUN-JOB] Preview mode fatal error:", {
          job_id,
          message: previewError?.message,
          stack: previewError?.stack,
        });
        return new Response(
          JSON.stringify({
            success: false,
            job_id,
            phase: "preview",
            error: String(previewError?.message ?? previewError),
            stack: previewError?.stack?.split('\n').slice(0, 5).join('\n'),
          }),
          {
            headers: { ...localCorsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }
    }

    // =====================================================
    // PHASED GENERATION
    // =====================================================
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
      // Re-fetch job to ensure we have latest data (preview might have just updated it)
      console.log(`[RUN-JOB] Re-fetching job for audio phase to get latest story data...`);
      const { data: freshJob, error: freshError } = await supabase
        .from("jobs")
        .select("*")
        .eq("id", job_id)
        .single();
      
      if (freshError || !freshJob) {
        console.error(`[RUN-JOB] Failed to re-fetch job:`, freshError);
        return new Response(
          JSON.stringify({
            success: false,
            error: `Failed to fetch job for audio phase: ${freshError?.message || "Unknown error"}`,
          }),
          {
            headers: { ...localCorsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }
      
      console.log(`[RUN-JOB] Fresh job data: story_text=${!!freshJob.story_text}, title=${freshJob.title}`);
      result = await runAudioPhase(supabase, openaiKey, elevenLabsKey, freshJob, job_id, freshJob.meta || jobMeta);
    } else if (currentPhase === "images") {
      result = await runImagesPhase(
        supabase,
        openaiKey,
        pexelsKey,
        job,
        job_id,
        jobMeta,
        visualSource,
        artStyle,
        customStyle,
        imageModel
      );
    } else if (currentPhase === "assemble") {
      result = await runAssemblePhase(supabase, creatomateKey, job, job_id, jobMeta, effectOptions);
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Unknown phase: ${currentPhase}`,
        }),
        {
          headers: { ...localCorsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
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
        headers: { ...localCorsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error: any) {
    // Catch-all error handler - MUST include CORS headers
    console.error("[RUN-JOB] fatal", {
      message: error?.message,
      stack: error?.stack,
    });
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error?.stack?.split('\n').slice(0, 8).join('\n');

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        stack: errorStack,
      }),
      {
        headers: { ...localCorsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
