import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
};

// Helper to trigger next phase (fire-and-forget, don't wait)
async function triggerNextPhase(supabaseUrl: string, job_id: string, phase: string) {
  try {
    console.log(`[CHECK] Triggering phase: ${phase} for job ${job_id}`);
    // Fire and forget - don't await the full response
    fetch(`${supabaseUrl}/functions/v1/run-job`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ job_id, phase }),
    }).catch(err => console.error(`[CHECK] Phase trigger error:`, err));
    
    // Return immediately - don't wait for run-job to complete
    return { success: true, triggered: true };
  } catch (error) {
    console.error(`[CHECK] Failed to trigger phase ${phase}:`, error);
    return null;
  }
}

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

      // Get scene background videos/images
      const { data: sceneAssets } = await supabase
        .from("job_assets")
        .select("*")
        .eq("job_id", job_id)
        .in("type", ["bg_video", "dalle_image"])
        .order("created_at", { ascending: true });

      // Format scenes for timeline with full metadata
      const scenes = sceneAssets?.map((asset: any) => ({
        index: asset.meta?.scene_index ?? 0,
        text: asset.meta?.scene_text || '',
        keywords: asset.meta?.keywords || [],
        startTime: asset.meta?.start_time ?? 0,
        endTime: asset.meta?.end_time ?? 0,
        videoUrl: asset.storage_path,
        source: asset.meta?.source || 'pexels',
        // DALL-E specific data
        dallePrompt: asset.meta?.dalle_prompt || null,
        visualBeat: asset.meta?.visual_beat || null,
        moodLevel: asset.meta?.mood_level || null,
        cameraAngle: asset.meta?.camera_angle || null,
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
          video_url: assets?.storage_path || assets?.public_url || null,
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
    // Note: run-job sets status to 'rendering', but we also check 'assembling' for backwards compatibility
    if ((job.status === "rendering" || job.status === "assembling") && job.meta?.render_id) {
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

          // Save final video (delete existing then insert to avoid constraint issues)
          await supabase.from("job_assets")
            .delete()
            .eq("job_id", job_id)
            .eq("type", "final_mp4");
          
          const { error: assetError } = await supabase.from("job_assets").insert({
            job_id: job_id,
            type: "final_mp4",
            storage_path: renderData.url,
            public_url: renderData.url,
            meta: { render_id: renderId, status: "complete" }
          });
          
          if (assetError) {
            console.error("[CHECK] Failed to save final_mp4 asset:", assetError);
          } else {
            console.log(`[CHECK] Final video saved: ${renderData.url}`);
          }

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
    // Also include any images that have been generated so far
    const { data: partialAssets } = await supabase
      .from("job_assets")
      .select("*")
      .eq("job_id", job_id)
      .in("type", ["bg_video", "dalle_image"])
      .order("created_at", { ascending: true });

    // Get scene data count
    const { data: sceneDataAssets, count: sceneCount } = await supabase
      .from("job_assets")
      .select("*", { count: "exact" })
      .eq("job_id", job_id)
      .eq("type", "scene_data");

    const partialScenes = partialAssets?.map((asset: any) => ({
      index: asset.meta?.scene_index ?? 0,
      text: asset.meta?.scene_text || '',
      keywords: asset.meta?.keywords || [],
      startTime: asset.meta?.start_time ?? 0,
      endTime: asset.meta?.end_time ?? 0,
      videoUrl: asset.storage_path,
      source: asset.meta?.source || 'pexels',
      dallePrompt: asset.meta?.dalle_prompt || null,
      visualBeat: asset.meta?.visual_beat || null,
      moodLevel: asset.meta?.mood_level || null,
      artStyle: asset.meta?.art_style || null,
    })) || [];

    // =====================================================
    // AUTO-CONTINUE: Trigger next phase if job is stuck
    // =====================================================
    const progress = job.progress || 0;
    const status = job.status;
    
    // Check if we need to trigger the next phase
    // Only trigger if job is "generating" and has been for a while
    let nextPhase: string | null = null;
    let phaseTriggered = false;
    
    // Get job meta to check phase locks
    const jobMeta = job.meta || {};
    const totalScenes = jobMeta.scene_count || sceneCount || 4;
    const imagesReady = partialAssets?.length || 0;
    
    console.log(`[CHECK] Job ${job_id}: progress=${progress}, images=${imagesReady}/${totalScenes}, meta.scene_count=${jobMeta.scene_count}`);
    
    if (status === "generating") {
      // Phase 1 complete: Audio ready (progress = 50), trigger images
      // Only trigger if not already running
      if (progress >= 50 && progress < 70 && !jobMeta.images_phase_running && !jobMeta.images_complete) {
        if (imagesReady < totalScenes) {
          // Trigger images phase
          nextPhase = "images";
          console.log(`[CHECK] Triggering images phase (scenes: ${totalScenes}, images: ${imagesReady})`);
          const result = await triggerNextPhase(supabaseUrl, job_id, "images");
          phaseTriggered = result?.success === true;
          console.log(`[CHECK] Images phase triggered: ${phaseTriggered}`);
        }
      }
      
      // Phase 2 complete: Images ready, trigger assemble
      // Trigger if progress >= 70 OR all images are ready
      const allImagesReady = imagesReady >= totalScenes;
      console.log(`[CHECK] allImagesReady=${allImagesReady}, assemble_phase_running=${jobMeta.assemble_phase_running}`);
      
      if ((progress >= 70 && progress < 75) || (allImagesReady && progress >= 55 && progress < 75)) {
        if (!jobMeta.assemble_phase_running) {
          nextPhase = "assemble";
          console.log(`[CHECK] Triggering assemble phase (images: ${imagesReady}/${totalScenes}, progress: ${progress})`);
          const result = await triggerNextPhase(supabaseUrl, job_id, "assemble");
          phaseTriggered = result?.success === true;
        }
      }
    }

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
        // Include partial scenes/images generated so far
        scenes: partialScenes,
        images_generated: partialScenes.length,
        // Phase continuation info
        next_phase: nextPhase,
        phase_triggered: phaseTriggered,
        scene_count: sceneCount || 0,
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
