// =====================================================
// RUN-JOB EDGE FUNCTION - MAIN HANDLER (Slim)
// All heavy logic is in separate modules
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      throw new Error(`Job not found: ${job_id}`);
    }

    // Get effect options (with defaults from job meta or request)
    const jobMeta = job.meta || {};
    const effectOptions = {
      filter: body.effect_filter ?? jobMeta.effect_filter ?? true,
      kenburns: body.effect_kenburns ?? jobMeta.effect_kenburns ?? true,
      transitions: body.effect_transitions ?? jobMeta.effect_transitions ?? true,
      vignette: body.effect_vignette ?? jobMeta.effect_vignette ?? true,
      filmGrain: body.effect_filmgrain ?? jobMeta.effect_filmgrain ?? false,
      music: body.audio_music ?? jobMeta.audio_music ?? false,
      musicTrack: body.audio_track ?? jobMeta.audio_track ?? '',
      musicVolume: body.audio_volume ?? jobMeta.audio_volume ?? 15,
      sfx: body.audio_sfx ?? jobMeta.audio_sfx ?? false,
      captionStyle: body.caption_style ?? jobMeta.caption_style ?? "bold",
      highlightScary: body.highlight_scary ?? jobMeta.highlight_scary ?? true,
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
      return await runPreviewMode(supabase, openaiKey, job, job_id, jobMeta);
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
      result = await runAudioPhase(supabase, openaiKey, elevenLabsKey, job, job_id, jobMeta);
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
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
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
