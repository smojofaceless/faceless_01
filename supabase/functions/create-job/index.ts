import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateJobRequest {
  length_preset?: "30" | "45" | "60";
  vibe_preset?: "slow_creepy" | "punchy_shock" | "atmospheric";
  visual_preset?: "forest" | "hallway" | "attic" | "foggy" | "rain";
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
