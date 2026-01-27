import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
};

interface CreateJobRequest {
  length_preset?: "30" | "45" | "60" | "90";
  vibe_preset?: "slow_creepy" | "punchy_shock" | "atmospheric";
  visual_preset?: "forest" | "hallway" | "attic" | "foggy" | "rain";
  visual_source?: "pexels" | "dalle";
  voice_speed?: string;
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

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const body: CreateJobRequest = await req.json().catch(() => ({}));

    // Build options meta object
    const optionsMeta = {
      visual_source: body.visual_source || "pexels",
      voice_speed: body.voice_speed || "1.0",
      effect_filter: body.effect_filter !== false,
      effect_kenburns: body.effect_kenburns !== false,
      effect_transitions: body.effect_transitions !== false,
      effect_vignette: body.effect_vignette !== false,
      audio_music: body.audio_music === true, // Disabled by default - requires user to upload music
      audio_sfx: body.audio_sfx === true,
      caption_style: body.caption_style || "bold",
      highlight_scary: body.highlight_scary !== false,
    };

    // Create job with defaults
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        status: "queued",
        progress: 0,
        length_preset: body.length_preset || "45",
        vibe_preset: body.vibe_preset || "slow_creepy",
        visual_preset: body.visual_preset || "forest",
        voice_id: "pNInz6obpgDQGcFmaJgB", // Adam voice
        prompt_version: "v1",
        meta: optionsMeta,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create job: ${error.message}`);
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
