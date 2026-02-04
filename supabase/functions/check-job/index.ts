import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
};

// Helper to trigger next phase (fire-and-forget, don't wait)
async function triggerNextPhase(supabaseUrl: string, supabaseServiceKey: string, job_id: string, phase: string) {
  try {
    console.log(`[CHECK] Triggering phase: ${phase} for job ${job_id}`);
    // Fire and forget - don't await the full response
    fetch(`${supabaseUrl}/functions/v1/run-job`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseServiceKey}`,
        "apikey": supabaseServiceKey,
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

// Helper to convert asset to scene object with proper URL and source inference
function toScene(asset: any) {
  // Always pick the best available URL (public_url first, then storage_path)
  const url = asset.public_url || asset.storage_path || "";
  const index = asset.meta?.scene_index ?? 0;
  const sceneText = asset.meta?.scene_text || "";
  const wordCount = sceneText.split(/\s+/).filter((w: string) => w.length > 0).length;

  // Infer source from meta or asset type for correct image/video rendering
  const inferredSource =
    asset.meta?.source ||
    (asset.type === "dalle_image" ? "dalle" :
     asset.type?.includes("flux") || asset.type?.includes("replicate") ? "ai" :
     asset.type === "bg_video" ? "pexels" : "pexels");

  return {
    index,
    text: sceneText,
    word_count: wordCount,
    keywords: asset.meta?.keywords || [],
    startTime: asset.meta?.start_time ?? 0,
    endTime: asset.meta?.end_time ?? 0,
    videoUrl: url,
    source: inferredSource,
    // Image generation details (for "show details" view)
    image_details: {
      prompt: asset.meta?.dalle_prompt || null,
      model: asset.meta?.image_model || null,
      art_style: asset.meta?.art_style || null,
      visual_beat: asset.meta?.visual_beat || null,
      mood_level: asset.meta?.mood_level || null,
      camera_angle: asset.meta?.camera_angle || null,
      character_description: asset.meta?.character_description || null,
      continuity_rules: asset.meta?.continuity_rules || null,
      generated_at: asset.meta?.generated_at || null,
    },
    // Legacy fields for backward compatibility
    dallePrompt: asset.meta?.dalle_prompt || null,
    visualBeat: asset.meta?.visual_beat || null,
    moodLevel: asset.meta?.mood_level || null,
    cameraAngle: asset.meta?.camera_angle || null,
    artStyle: asset.meta?.art_style || null,
  };
}

serve(async (req) => {
  // Handle CORS preflight - MUST return CORS headers
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Wrap EVERYTHING in try-catch to ensure CORS headers are always returned
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const creatomateKey = Deno.env.get("CREATOMATE_API_KEY");
    
    // Validate required env vars
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[CHECK] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Safely parse JSON body
    let job_id: string | undefined;
    try {
      const body = await req.json();
      job_id = body?.job_id;
    } catch (parseError) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    if (!job_id) {
      return new Response(
        JSON.stringify({ success: false, error: "job_id is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
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
      // Get job meta for debug info
      const jobMeta = job.meta || {};
      
      // Get final video URL
      const { data: assets } = await supabase
        .from("job_assets")
        .select("*")
        .eq("job_id", job_id)
        .eq("type", "final_mp4")
        .single();

      // Get scene background videos/images (include all AI image types)
      const { data: sceneAssets } = await supabase
        .from("job_assets")
        .select("*")
        .eq("job_id", job_id)
        .in("type", ["bg_video", "dalle_image", "flux_image", "replicate_image", "ai_image"]);

      // Format scenes using helper and sort by scene_index (not created_at)
      const scenes = (sceneAssets || []).map(toScene).sort((a, b) => a.index - b.index);
      
      // Calculate scene analysis
      const totalWords = job.story_word_count || (job.story_text?.split(/\s+/).length || 0);
      const avgWordsPerScene = scenes.length > 0 ? Math.round(totalWords / scenes.length) : 0;
      const recommendedMaxScenes = Math.floor(totalWords / 15);
      const warnings: string[] = [];
      if (avgWordsPerScene < 8 && scenes.length > 0) {
        warnings.push(`⚠️ ${scenes.length} scenes have < 8 words avg (likely word-level fragments)`);
      }
      if (scenes.length > recommendedMaxScenes) {
        warnings.push(`⚠️ Too many scenes (${scenes.length}) for story length (~${totalWords} words). Recommend ≤ ${recommendedMaxScenes} scenes.`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          job_id: job_id,
          status: job.status,
          progress: job.progress,
          title: job.title,
          story_text: job.story_text,
          duration_sec: job.duration_sec,
          video_url: assets?.public_url || assets?.storage_path || null,
          scenes: scenes,
          scene_analysis: {
            total_scenes: scenes.length,
            total_words: totalWords,
            avg_words_per_scene: avgWordsPerScene,
            recommended_max_scenes: recommendedMaxScenes,
            warnings: warnings,
          },
          error: job.error,
          // Include debug info even for complete/failed jobs
          image_model: jobMeta.image_model || null,
          resolved_image_model: jobMeta.resolved_image_model || null,
          visual_source: jobMeta.visual_source || null,
          logs: jobMeta.generation_logs || [],
          replicate_inputs: jobMeta.replicate_inputs || [],
          meta: {
            image_model: jobMeta.image_model,
            resolved_image_model: jobMeta.resolved_image_model,
            visual_source: jobMeta.visual_source,
            art_style: jobMeta.art_style,
            scene_count: jobMeta.scene_count,
          },
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // If job is still rendering, check render status (FFmpeg or Creatomate)
    // Note: run-job sets status to 'rendering', but we also check 'assembling' for backwards compatibility
    if ((job.status === "rendering" || job.status === "assembling") && job.meta?.render_id) {
      const renderId = job.meta.render_id;
      const renderer = job.meta?.renderer || "creatomate"; // Default to creatomate for backwards compat
      const ffmpegRendererUrl = Deno.env.get("FFMPEG_RENDERER_URL");
      
      console.log(`[CHECK] Checking ${renderer} render status for ${renderId}`);
      
      // ========== FFMPEG RENDERER ==========
      if (renderer === "ffmpeg") {
        if (!ffmpegRendererUrl) {
          console.warn("[CHECK] FFMPEG_RENDERER_URL not set, cannot check render status");
          return new Response(
            JSON.stringify({
              success: true,
              job_id: job_id,
              status: job.status,
              progress: job.progress || 85,
              title: job.title,
              story_text: job.story_text,
              error: null,
              message: "Render in progress (FFmpeg URL not configured)"
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
          );
        }
        
        try {
          const ffmpegResponse = await fetch(`${ffmpegRendererUrl}/status/${renderId}`);
          
          if (ffmpegResponse.ok) {
            const renderData = await ffmpegResponse.json();
            console.log(`[CHECK] FFmpeg status: ${renderData.status}, progress: ${renderData.progress || 0}%`);
            
            if (renderData.status === "complete") {
              // Prefer supabase_url if available (permanent), otherwise use local URL
              const videoUrl = renderData.supabase_url || (renderData.url ? `${ffmpegRendererUrl}${renderData.url}` : null);
              
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
                storage_path: videoUrl,
                public_url: videoUrl,
                meta: { render_id: renderId, status: "complete", renderer: "ffmpeg" }
              });
              
              if (assetError) {
                console.error("[CHECK] Failed to save final_mp4 asset:", assetError);
              } else {
                console.log(`[CHECK] ✅ FFmpeg video complete: ${videoUrl}`);
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
                  video_url: videoUrl,
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
              );
            } else if (renderData.status === "failed") {
              // Update job as failed
              await supabase.from("jobs").update({
                status: "failed",
                error: renderData.error || "FFmpeg render failed",
              }).eq("id", job_id);

              return new Response(
                JSON.stringify({
                  success: false,
                  job_id: job_id,
                  status: "failed",
                  error: renderData.error || "FFmpeg render failed",
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
              );
            }
            
            // Still rendering - return progress
            const renderProgress = renderData.progress || 0;
            const overallProgress = 75 + Math.floor(renderProgress * 0.25); // 75-100%
            
            return new Response(
              JSON.stringify({
                success: true,
                job_id: job_id,
                status: "rendering",
                progress: overallProgress,
                title: job.title,
                render_progress: renderProgress,
                message: `FFmpeg rendering: ${renderProgress}%`
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
            );
          }
        } catch (fetchErr) {
          console.error("[CHECK] Failed to fetch FFmpeg status:", fetchErr);
          return new Response(
            JSON.stringify({
              success: true,
              job_id: job_id,
              status: job.status,
              progress: job.progress || 85,
              title: job.title,
              story_text: job.story_text,
              error: null,
              message: "FFmpeg render in progress (status check failed temporarily)"
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
          );
        }
      }
      
      // ========== CREATOMATE RENDERER ==========
      // Guard: skip Creatomate check if API key is missing
      if (!creatomateKey) {
        console.warn("[CHECK] CREATOMATE_API_KEY not set, cannot check render status");
        return new Response(
          JSON.stringify({
            success: true,
            job_id: job_id,
            status: job.status,
            progress: job.progress || 85,
            title: job.title,
            story_text: job.story_text,
            error: null,
            message: "Render in progress, cannot check status (API key missing)"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      
      let response;
      try {
        response = await fetch(
          `https://api.creatomate.com/v2/renders/${renderId}`,
          {
            headers: {
              "Authorization": `Bearer ${creatomateKey}`,
            },
          }
        );
      } catch (fetchErr) {
        console.error("[CHECK] Failed to fetch Creatomate status:", fetchErr);
        // Return current status instead of crashing
        return new Response(
          JSON.stringify({
            success: true,
            job_id: job_id,
            status: job.status,
            progress: job.progress || 85,
            title: job.title,
            story_text: job.story_text,
            error: null,
            message: "Render in progress, status check failed temporarily"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

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
      .in("type", ["bg_video", "dalle_image", "flux_image", "replicate_image", "ai_image"])
      .order("created_at", { ascending: false });  // Get newest first

    // Get scene data count
    const { data: sceneDataAssets, count: sceneCount } = await supabase
      .from("job_assets")
      .select("*", { count: "exact" })
      .eq("job_id", job_id)
      .eq("type", "scene_data");

    // CRITICAL: Deduplicate scenes by index - keep only the LATEST image for each scene
    // This handles cases where duplicate API calls created multiple images per scene
    const sceneMap = new Map<number, any>();
    for (const asset of (partialAssets || [])) {
      const idx = asset.meta?.scene_index ?? -1;
      if (idx >= 0 && !sceneMap.has(idx)) {
        sceneMap.set(idx, asset);  // First one wins (newest due to order)
      }
    }
    
    // Convert to array and sort by index
    const partialScenes = Array.from(sceneMap.values())
      .map(toScene)
      .sort((a, b) => a.index - b.index);

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
    
    // Check if parallel image generation is in progress (tracked via parallel_last_status)
    const parallelInProgress = jobMeta.parallel_image_in_progress === true;
    const parallelStatus = jobMeta.parallel_last_status || 0;
    
    console.log(`[CHECK] Job ${job_id}: progress=${progress}, images=${imagesReady}/${totalScenes}, parallelInProgress=${parallelInProgress}, parallelStatus=${parallelStatus}`);
    
    if (status === "generating") {
      // CRITICAL: If parallel generation is in progress, DON'T trigger another images phase
      if (parallelInProgress) {
        console.log(`[CHECK] Parallel generation in progress (${parallelStatus}/${totalScenes}), skipping trigger`);
        // Return status with parallel progress info
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
            scenes: partialScenes,
            images_generated: parallelStatus, // Show parallel progress instead of DB count
            total_images: totalScenes,
            message: `Generating images: ${parallelStatus}/${totalScenes}`,
            parallel_in_progress: true,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
      
      // Phase 1 complete: Audio ready (progress = 50), trigger images
      // Only trigger if not already running and not already complete
      // CRITICAL: Also check lease to prevent duplicate triggers
      const imagesLease = new Date(jobMeta.images_phase_lease_until || 0).getTime();
      const leaseActive = imagesLease > Date.now();
      
      // STUCK JOB DETECTION: If phase started >90s ago but no progress, force release
      const phaseStartedAt = new Date(jobMeta.images_phase_started_at || 0).getTime();
      const timeSincePhaseStart = Date.now() - phaseStartedAt;
      const lastImageGenerated = jobMeta.last_image_generated || 0;
      const isStuckJob = jobMeta.images_phase_running && 
                         timeSincePhaseStart > 90 * 1000 && // Started >90s ago
                         imagesReady === lastImageGenerated; // No new images since start
      
      if (isStuckJob) {
        console.log(`[CHECK] ⚠️ STUCK JOB DETECTED - Phase started ${Math.round(timeSincePhaseStart/1000)}s ago with no new images. Force releasing lock.`);
        // Force release the lock so next poll can retry
        await supabase
          .from("jobs")
          .update({ 
            meta: { 
              ...jobMeta, 
              images_phase_running: false, 
              images_phase_lease_until: new Date(0).toISOString(),
              stuck_recovery_count: (jobMeta.stuck_recovery_count || 0) + 1
            },
            updated_at: new Date().toISOString()
          })
          .eq("id", job_id);
      }
      
      // Rate limiting: don't trigger images more than once per 15 seconds
      const lastImageTime = new Date(jobMeta.last_image_time || 0).getTime();
      const timeSinceLastImage = Date.now() - lastImageTime;
      const rateLimitCooldown = 15000; // 15 seconds between image generations
      
      if (progress >= 50 && progress < 70 && !jobMeta.images_complete) {
        if (imagesReady < totalScenes) {
          // Only trigger if not running OR lease expired OR stuck job was just released
          if (!jobMeta.images_phase_running || !leaseActive || isStuckJob) {
            // Check rate limit cooldown
            if (timeSinceLastImage < rateLimitCooldown && imagesReady > 0) {
              console.log(`[CHECK] Rate limit cooldown - ${Math.ceil((rateLimitCooldown - timeSinceLastImage) / 1000)}s remaining`);
            } else {
              nextPhase = "images";
              console.log(`[CHECK] Triggering images phase (scenes: ${totalScenes}, images: ${imagesReady}, running: ${jobMeta.images_phase_running}, leaseActive: ${leaseActive})`);
              
              // Update last_image_time BEFORE triggering to prevent rapid-fire
              await supabase
                .from("jobs")
                .update({ 
                  meta: { ...jobMeta, last_image_time: new Date().toISOString() },
                  updated_at: new Date().toISOString()
                })
                .eq("id", job_id);
              
              const result = await triggerNextPhase(supabaseUrl, supabaseServiceKey, job_id, "images");
              phaseTriggered = result?.success === true;
              console.log(`[CHECK] Images phase triggered: ${phaseTriggered}`);
            }
          } else {
            console.log(`[CHECK] Skipping images trigger - lease still active (expires: ${jobMeta.images_phase_lease_until})`);
          }
        }
      }
      
      // Phase 2 complete: Images ready, trigger assemble
      // Trigger if progress >= 70 OR all images are ready
      const allImagesReady = imagesReady >= totalScenes || jobMeta.images_complete === true;
      console.log(`[CHECK] allImagesReady=${allImagesReady}, imagesReady=${imagesReady}, images_complete=${jobMeta.images_complete}, assemble_phase_running=${jobMeta.assemble_phase_running}`);
      
      // Check if user wants to skip video assembly (for debugging)
      const skipVideoAssembly = jobMeta.skip_video_assembly === true;
      console.log(`[CHECK] skipVideoAssembly=${skipVideoAssembly}`);
      
      // Check if assemble phase previously failed and needs retry
      const assembleError = jobMeta.assemble_error;
      const assembleRetryCount = jobMeta.assemble_retry_count || 0;
      const maxAssembleRetries = 3;
      
      if (assembleError && assembleRetryCount < maxAssembleRetries) {
        console.log(`[CHECK] Previous assemble attempt failed: ${assembleError} (retry ${assembleRetryCount}/${maxAssembleRetries})`);
        // Wait a bit before retry (based on retry count)
        const waitTime = assembleRetryCount * 30; // 30s, 60s, 90s
        console.log(`[CHECK] Will retry assemble after ${waitTime}s delay on next poll`);
      }
      
      // Also trigger if images_complete is true but progress wasn't updated (edge case)
      // OR if there was an assemble error and we haven't exceeded retries
      const shouldTriggerAssemble = (progress >= 70 && progress < 75) || 
                                     (allImagesReady && progress >= 50 && progress < 75) ||
                                     (assembleError && !jobMeta.assemble_phase_running && assembleRetryCount < maxAssembleRetries);
      
      if (shouldTriggerAssemble) {
        if (!jobMeta.assemble_phase_running) {
          if (skipVideoAssembly) {
            // Skip assembly - mark job as complete with images only
            console.log(`[CHECK] skip_video_assembly=true, marking job complete without video`);
            nextPhase = null;
            
            // Update job to completed state and await it
            const { error: updateError } = await supabase
              .from("jobs")
              .update({ 
                status: "completed", 
                progress: 100,
                updated_at: new Date().toISOString()
              })
              .eq("id", job_id);
            
            if (updateError) {
              console.error(`[CHECK] Failed to mark job complete:`, updateError);
            } else {
              // Return immediately with completed status
              return new Response(
                JSON.stringify({
                  success: true,
                  job_id: job_id,
                  status: "completed",
                  progress: 100,
                  title: job.title,
                  story_text: job.story_text,
                  duration_sec: job.duration_sec,
                  audio_url: audioUrl || null,
                  scenes: deduplicatedScenes,
                  video_url: null, // No video when skipping assembly
                  meta: jobMeta,
                  message: "Job completed (video assembly skipped)",
                }),
                { 
                  status: 200, 
                  headers: { ...corsHeaders, "Content-Type": "application/json" }
                }
              );
            }
          } else {
            nextPhase = "assemble";
            const retryInfo = assembleError ? ` (retry ${assembleRetryCount + 1}/${maxAssembleRetries})` : '';
            console.log(`[CHECK] Triggering assemble phase${retryInfo} (images: ${imagesReady}/${totalScenes}, progress: ${progress})`);
            const result = await triggerNextPhase(supabaseUrl, supabaseServiceKey, job_id, "assemble");
            phaseTriggered = result?.success === true;
          }
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
        // Show parallel progress if available, otherwise DB count
        images_generated: parallelInProgress ? (parallelStatus || 0) : partialScenes.length,
        total_images: totalScenes,
        // Phase continuation info
        next_phase: nextPhase,
        phase_triggered: phaseTriggered,
        scene_count: sceneCount || 0,
        // Parallel generation status
        parallel_in_progress: parallelInProgress,
        parallel_progress: parallelStatus || 0,
        // Debug info - image model being used
        image_model: jobMeta.image_model || null,
        visual_source: jobMeta.visual_source || null,
        resolved_image_model: jobMeta.resolved_image_model || null,
        meta: {
          image_model: jobMeta.image_model,
          visual_source: jobMeta.visual_source,
          art_style: jobMeta.art_style,
          scene_count: jobMeta.scene_count,
          images_phase_running: jobMeta.images_phase_running,
          resolved_image_model: jobMeta.resolved_image_model,
          skip_video_assembly: jobMeta.skip_video_assembly,
          parallel_image_in_progress: jobMeta.parallel_image_in_progress,
          parallel_last_status: jobMeta.parallel_last_status,
        },
        // Backend logs (if any)
        logs: jobMeta.generation_logs || [],
        // Replicate inputs for debugging (FLUX model)
        replicate_inputs: jobMeta.replicate_inputs || [],
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error) {
    // Log the full error for debugging
    console.error("[CHECK] Unhandled error:", error);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
