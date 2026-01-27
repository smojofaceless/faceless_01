import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const creatomateKey = Deno.env.get("CREATOMATE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { job_id } = await req.json();

    if (!job_id) {
      throw new Error("job_id is required");
    }

    // Get job from database
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobError || !job) {
      throw new Error(`Job not found: ${job_id}`);
    }

    // If job is already complete or failed, return status
    if (job.status === "complete" || job.status === "failed") {
      // Get final video URL
      const { data: assets } = await supabase
        .from("job_assets")
        .select("*")
        .eq("job_id", job_id)
        .eq("type", "final_mp4")
        .single();

      // Get scene background videos
      const { data: sceneAssets } = await supabase
        .from("job_assets")
        .select("*")
        .eq("job_id", job_id)
        .eq("type", "bg_video")
        .order("created_at", { ascending: true });

      // Format scenes for timeline
      const scenes = sceneAssets?.map((asset: any) => ({
        index: asset.meta?.scene_index ?? 0,
        text: asset.meta?.scene_text || '',
        keywords: asset.meta?.keywords || [],
        startTime: asset.meta?.start_time ?? 0,
        endTime: asset.meta?.end_time ?? 0,
        videoUrl: asset.storage_path,
      })) || [];

      return new Response(
        JSON.stringify({
          success: true,
          job_id: job_id,
          status: job.status,
          progress: job.progress,
          title: job.title,
          story_text: job.story_text,
          duration_sec: job.duration_sec,
          video_url: assets?.public_url || null,
          scenes: scenes,
          error: job.error,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // If job is still rendering, check Creatomate status
    if (job.status === "assembling" && job.meta?.render_id) {
      const renderId = job.meta.render_id;
      
      const response = await fetch(
        `https://api.creatomate.com/v2/renders/${renderId}`,
        {
          headers: {
            "Authorization": `Bearer ${creatomateKey}`,
          },
        }
      );

      if (response.ok) {
        const renderData = await response.json();
        
        if (renderData.status === "succeeded") {
          // Update job as complete
          await supabase.from("jobs").update({
            status: "complete",
            progress: 100,
          }).eq("id", job_id);

          // Update asset with final URL
          await supabase.from("job_assets")
            .update({
              storage_path: renderData.url,
              public_url: renderData.url,
              meta: { render_id: renderId, status: "complete" }
            })
            .eq("job_id", job_id)
            .eq("type", "final_mp4");

          return new Response(
            JSON.stringify({
              success: true,
              job_id: job_id,
              status: "complete",
              progress: 100,
              title: job.title,
              story_text: job.story_text,
              duration_sec: job.duration_sec,
              video_url: renderData.url,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 200,
            }
          );
        } else if (renderData.status === "failed") {
          // Update job as failed
          await supabase.from("jobs").update({
            status: "failed",
            error: renderData.error_message || "Render failed",
          }).eq("id", job_id);

          return new Response(
            JSON.stringify({
              success: false,
              job_id: job_id,
              status: "failed",
              error: renderData.error_message || "Render failed",
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 200,
            }
          );
        }
        
        // Still rendering
        return new Response(
          JSON.stringify({
            success: true,
            job_id: job_id,
            status: "rendering",
            progress: job.progress,
            title: job.title,
            render_progress: renderData.progress || 0,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
    }

    // Return current status with actual progress
    return new Response(
      JSON.stringify({
        success: true,
        job_id: job_id,
        status: job.status,
        progress: job.progress || 0,
        title: job.title,
        story_text: job.story_text,
        duration_sec: job.duration_sec,
        error: job.error,
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
