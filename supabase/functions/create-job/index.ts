import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
};

interface CreateJobRequest {
  // Content settings
  theme?: string;
  vibe_preset?: "slow_creepy" | "punchy_shock" | "atmospheric" | "urban_legend";
  length_preset?: "short" | "medium" | "long" | "30" | "45" | "60" | "90";
  visual_preset?: "forest" | "hallway" | "attic" | "foggy" | "rain";
  visual_source?: "pexels" | "ai";
  image_model?: "dall-e-3" | "gpt-4o" | "flux";  // AI image model selection
  art_style?: string; // Built-in style key or "custom-*" for custom styles
  custom_style?: {    // Custom style data (only when art_style starts with "custom-")
    name: string;
    basePrompt: string;
    colorOverride: string;
    technicalStyle: string;
    negativePrompt: string;
  };
  scene_count?: number;
  // Preview mode
  preview_only?: boolean;
  // Debug mode - skip video assembly
  skip_video_assembly?: boolean;
  // Effects
  effect_filter?: boolean;
  effect_kenburns?: boolean;
  effect_transitions?: boolean;
  effect_vignette?: boolean;
  // Audio
  audio_music?: boolean;
  audio_sfx?: boolean;
  // Captions
  caption_style?: string;
  highlight_scary?: boolean;
}

// Map duration presets
function mapDuration(preset: string): string {
  const map: Record<string, string> = {
    'short': '30',
    'medium': '45',
    'long': '60',
    '30': '30',
    '45': '45',
    '60': '60',
    '90': '90',
  };
  return map[preset] || '45';
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const body: CreateJobRequest = await req.json().catch(() => ({}));

    // Build options meta object
    const optionsMeta: Record<string, any> = {
      theme: body.theme || "general",
      visual_source: body.visual_source || "ai",
      image_model: body.image_model || "gpt-4o",  // Default to GPT-4o for balanced cost/quality
      art_style: body.art_style || "cinematic-dark",
      scene_count: body.scene_count || 4,
      skip_video_assembly: body.skip_video_assembly === true,
      effect_filter: body.effect_filter !== false,
      effect_kenburns: body.effect_kenburns !== false,
      effect_transitions: body.effect_transitions !== false,
      effect_vignette: body.effect_vignette !== false,
      audio_music: body.audio_music === true,
      audio_sfx: body.audio_sfx === true,
      caption_style: body.caption_style || "bold",
      highlight_scary: body.highlight_scary !== false,
    };
    
    // If custom style, include the custom style data in meta
    if (body.art_style?.startsWith('custom-') && body.custom_style) {
      optionsMeta.custom_style = body.custom_style;
    }

    const lengthPreset = mapDuration(body.length_preset || 'medium');
    const isPreview = body.preview_only === true;

    console.log(`Creating job: length=${lengthPreset}, preview=${isPreview}`);
    console.log(`Options meta:`, JSON.stringify(optionsMeta));

    // Create job
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        status: isPreview ? "generating" : "queued",
        progress: isPreview ? 5 : 0,
        length_preset: lengthPreset,
        vibe_preset: body.vibe_preset || "slow_creepy",
        visual_preset: body.visual_preset || "forest",
        voice_id: "pNInz6obpgDQGcFmaJgB", // Adam voice
        prompt_version: "v1",
        meta: optionsMeta,
      })
      .select()
      .single();

    if (error) {
      console.error("Job creation error:", error);
      throw new Error(`Failed to create job: ${error.message} (code: ${error.code})`);
    }
    
    console.log(`Job created: ${job.id}`);

    // If preview mode, call run-job to generate story (which has all the vibe-specific prompts)
    if (isPreview) {
      console.log(`[PREVIEW] Calling run-job for story generation (vibe: ${body.vibe_preset || 'slow_creepy'})...`);
      
      // Get the run-job URL (same project, different function)
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const runJobUrl = `${supabaseUrl}/functions/v1/run-job`;
      
      try {
        const runJobResponse = await fetch(runJobUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            job_id: job.id,
            preview_only: true,
          }),
        });
        
        if (!runJobResponse.ok) {
          const errorText = await runJobResponse.text();
          console.error(`run-job error: ${runJobResponse.status} - ${errorText}`);
          throw new Error(`Failed to generate story: ${runJobResponse.status}`);
        }
        
        // Return the run-job response directly (it has all the story data)
        const runJobData = await runJobResponse.json();
        console.log(`[PREVIEW] Story generated via run-job: ${runJobData.title || 'untitled'}`);
        
        return new Response(
          JSON.stringify(runJobData),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
        
      } catch (storyError: any) {
        console.error(`Story generation failed:`, storyError);
        // Update job to failed state
        await supabase.from("jobs").update({
          status: "failed",
          error: storyError.message,
        }).eq("id", job.id);
        
        throw storyError;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        job_id: job.id,
        message: "Job created successfully. Call run-job to start generation.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
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
