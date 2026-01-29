// =====================================================
// PHASE RUNNERS MODULE
// runPreviewMode, runAudioPhase, runImagesPhase, runAssemblePhase, runFullGeneration
// =====================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  corsHeaders,
  ELEVENLABS_VOICE_ID,
  ART_STYLE_CONFIG,
  updateJob,
  getImageModel,
  getFreshJob,
  updateJobMeta,
  type StoryScene,
  type VideoOptions,
} from "./config.ts";

import { generateStory, extractSceneKeywordsForPreview, extractSceneKeywords, createStoryAnchor, createVisualBeats, createSceneVisualContracts, buildFinalDallePrompt, buildFluxPrompt } from "./openai.ts";
import { generateAudio } from "./audio.ts";
import { searchPexelsForKeywords, searchVideosForScenes } from "./pexels.ts";
import { generateImage, getLastReplicateInputs, uploadRemoteImageToStorage } from "./images.ts";
import { assembleVideoWithCreatomate, checkCreatomateRender, renderWithFFmpeg, checkFFmpegRender, shouldUseFFmpegRenderer } from "./video.ts";

// =====================================================
// PREVIEW MODE (Synchronous - returns story quickly)
// =====================================================
export async function runPreviewMode(
  supabase: any,
  openaiKey: string,
  job: any,
  job_id: string,
  jobMeta: any
): Promise<Response> {
  await updateJob(supabase, job_id, { status: "generating", progress: 5 });

  console.log("Generating story...");
  const storyData = await generateStory(
    openaiKey,
    job.vibe_preset,
    job.length_preset
  );

  const wordCount = storyData.story.split(/\s+/).length;
  const estimatedDuration = Math.round((wordCount / 150) * 60);

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

  // Extract scene keywords for preview
  console.log("Extracting scene keywords...");
  const estimatedScenes = await extractSceneKeywordsForPreview(
    openaiKey,
    storyData.story,
    estimatedDuration,
    job.visual_preset || "forest"
  );

  // Save scene data (using scene_data type for consistency with audio phase)
  for (let i = 0; i < estimatedScenes.length; i++) {
    const scene = estimatedScenes[i];
    await supabase.from("job_assets").insert({
      job_id: job_id,
      type: "scene_data",
      storage_path: `scene_${i}`,
      meta: { 
        scene_index: i, 
        scene_text: scene.text,
        keywords: scene.keywords,
        start_time: scene.startTime,
        end_time: scene.endTime
      },
    });
  }

  await updateJob(supabase, job_id, { status: "preview", progress: 30 });

  return new Response(
    JSON.stringify({
      success: true,
      status: "preview",
      job_id: job_id,
      title: storyData.title,
      story_text: storyData.story,
      word_count: wordCount,
      duration_sec: estimatedDuration,
      scenes: estimatedScenes.map((s, i) => ({
        index: i,
        text: s.text,
        keywords: s.keywords,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    }
  );
}

// =====================================================
// PHASE 1: Generate Audio
// =====================================================
export async function runAudioPhase(
  supabase: any,
  openaiKey: string,
  elevenLabsKey: string,
  job: any,
  job_id: string,
  jobMeta: any
): Promise<{ status: string; nextPhase: string; message: string }> {
  console.log(`[AUDIO] Starting audio phase for job ${job_id}`);
  
  // Get story (should exist from preview)
  let storyData: { title: string; story: string };
  if (job.story_text && job.title) {
    storyData = { title: job.title, story: job.story_text };
  } else {
    console.log("[AUDIO] Generating new story...");
    storyData = await generateStory(openaiKey, job.vibe_preset, job.length_preset);
    await updateJob(supabase, job_id, {
      progress: 25,
      title: storyData.title,
      story_text: storyData.story,
    });
  }

  const wordCount = storyData.story.split(/\s+/).length;
  const estimatedDuration = Math.round((wordCount / 150) * 60);

  // Generate audio
  console.log("[AUDIO] Generating audio with word timestamps...");
  await updateJob(supabase, job_id, { progress: 30 });

  const audioResult = await generateAudio(
    elevenLabsKey,
    storyData.story,
    job.voice_id || ELEVENLABS_VOICE_ID
  );

  const actualDuration = audioResult.actualDuration || estimatedDuration;
  
  await updateJob(supabase, job_id, {
    progress: 45,
    duration_sec: actualDuration,
  });

  // Save captions
  const captionsData = { captions: audioResult.wordTimestamps };
  await supabase.storage
    .from("story-videos")
    .upload(`${job_id}/captions.json`, new Blob([JSON.stringify(captionsData)]), {
      contentType: "application/json",
      upsert: true,
    });

  // Upload audio
  await supabase.storage
    .from("story-videos")
    .upload(`${job_id}/audio.mp3`, audioResult.audioBuffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });

  // Extract scene keywords with actual timestamps
  const sceneCount = jobMeta.scene_count || 4;
  console.log(`[AUDIO] Extracting scene keywords (target: ${sceneCount} scenes from jobMeta.scene_count=${jobMeta.scene_count})...`);
  const scenes = await extractSceneKeywords(
    openaiKey,
    storyData.story,
    audioResult.wordTimestamps,
    job.visual_preset || "forest",
    sceneCount
  );
  
  // Warn if GPT returned wrong number of scenes
  if (scenes.length !== sceneCount) {
    console.warn(`[AUDIO] ⚠️ GPT returned ${scenes.length} scenes but we requested ${sceneCount}!`);
  }

  // Save scenes to job_assets
  console.log(`[AUDIO] Saving ${scenes.length} scenes to database...`);
  for (let i = 0; i < scenes.length; i++) {
    // Delete existing scene_data for this index first (in case of retry)
    await supabase.from("job_assets")
      .delete()
      .eq("job_id", job_id)
      .eq("type", "scene_data")
      .eq("storage_path", `scene_${i}`);
    
    const { error: sceneError } = await supabase.from("job_assets").insert({
      job_id: job_id,
      type: "scene_data",
      storage_path: `scene_${i}`,
      meta: { 
        scene_index: i, 
        scene_text: scenes[i].text,
        keywords: scenes[i].keywords,
        start_time: scenes[i].startTime,
        end_time: scenes[i].endTime
      },
    });
    
    if (sceneError) {
      console.error(`[AUDIO] Failed to save scene ${i}:`, sceneError);
    } else {
      console.log(`[AUDIO] ✓ Scene ${i} saved`);
    }
  }

  // Keep the original scene_count from user settings, just mark audio as ready
  await updateJob(supabase, job_id, { 
    progress: 50,
    meta: { ...jobMeta, audio_ready: true, scenes_created: scenes.length }
  });

  console.log(`[AUDIO] Audio phase complete, ${scenes.length} scenes ready for images (user requested: ${sceneCount})`);
  
  // Verify we created the right number of scenes
  if (scenes.length !== sceneCount) {
    console.warn(`[AUDIO] WARNING: Created ${scenes.length} scenes but user requested ${sceneCount}`);
  }
  return { status: "generating", nextPhase: "images", message: "Audio ready, starting images" };
}

// =====================================================
// PHASE 2: Generate Images (one at a time for reliability)
// =====================================================
export async function runImagesPhase(
  supabase: any,
  openaiKey: string,
  pexelsKey: string,
  job: any,
  job_id: string,
  jobMeta: any,
  visualSource: string,
  artStyle: string,
  customStyle: any,
  imageModel?: string | null  // Optional: specific model selection from job
): Promise<{ status: string; nextPhase: string; message: string }> {
  console.log(`[IMAGES] Starting images phase for job ${job_id}`);
  
  // =====================================================
  // LEASE-BASED LOCK CHECK
  // =====================================================
  // Re-fetch job meta to get the LATEST state (not stale from caller)
  const { data: freshJob, error: fetchError } = await supabase
    .from("jobs")
    .select("meta")
    .eq("id", job_id)
    .single();
  
  if (fetchError) {
    console.error(`[IMAGES] Failed to fetch job:`, fetchError);
    throw new Error("Failed to fetch job for images phase");
  }
  
  const freshMeta = freshJob?.meta || {};
  const leaseMs = 15 * 60 * 1000; // 15 minutes - extended for rate-limited API calls
  const now = Date.now();
  const existingLease = new Date(freshMeta.images_phase_lease_until || 0).getTime();
  
  // If another instance has an active lease, exit immediately
  if (freshMeta.images_phase_running && existingLease > now) {
    const remaining = Math.round((existingLease - now) / 1000);
    console.log(`[IMAGES] ⚠️ BLOCKED - Another instance has active lease (${remaining}s remaining). Exiting.`);
    return { status: "generating", nextPhase: "images", message: "Images phase already in progress" };
  }
  
  // Acquire lease (simple update - the check above handles race conditions well enough)
  const leaseUntil = new Date(now + leaseMs).toISOString();
  const { error: lockError } = await supabase
    .from("jobs")
    .update({ 
      meta: { 
        ...freshMeta, 
        images_phase_running: true,
        images_phase_lease_until: leaseUntil,
        images_phase_started_at: new Date().toISOString()
      }
    })
    .eq("id", job_id);
  
  if (lockError) {
    console.error(`[IMAGES] Failed to acquire lock:`, lockError);
    return { status: "generating", nextPhase: "images", message: "Lock acquisition failed" };
  }
  
  console.log(`[IMAGES] ✓ Lock acquired, lease until ${leaseUntil}`);
  
  // CRITICAL: Preserve scene_count from original jobMeta parameter
  // The freshMeta from DB might not have it if it wasn't saved properly
  const originalSceneCount = jobMeta.scene_count;
  
  // Update jobMeta to use our freshly locked state, but preserve scene_count
  jobMeta = { 
    ...freshMeta, 
    images_phase_running: true, 
    images_phase_lease_until: leaseUntil,
    // Preserve scene_count: use original param > freshMeta > default 4
    scene_count: originalSceneCount || freshMeta.scene_count || 4
  };
  
  console.log(`[IMAGES] Scene count: ${jobMeta.scene_count} (original: ${originalSceneCount}, db: ${freshMeta.scene_count})`);
  
  const resolvedImageModel = getImageModel(imageModel || undefined);
  
  // Log model selection for debugging
  console.log(`[IMAGES] 🔧 Model selection debug:`);
  console.log(`[IMAGES]   - imageModel param: ${imageModel}`);
  console.log(`[IMAGES]   - jobMeta.image_model: ${jobMeta.image_model}`);
  console.log(`[IMAGES]   - ENV IMAGE_MODEL: ${Deno.env.get("IMAGE_MODEL")}`);
  console.log(`[IMAGES]   - Resolved to: ${resolvedImageModel}`);
  
  // Store generation logs in job meta for frontend debug panel
  const generationLogs: string[] = jobMeta.generation_logs || [];
  generationLogs.push(`[${new Date().toISOString()}] Image model: ${resolvedImageModel} (param: ${imageModel || 'null'}, meta: ${jobMeta.image_model || 'null'})`);

  // Update progress to show images phase started
  await updateJob(supabase, job_id, {
    progress: 55,
    meta: { 
      ...jobMeta, 
      resolved_image_model: resolvedImageModel,
      generation_logs: generationLogs,
    }
  });
  
  // Get scene data
  const { data: sceneAssets } = await supabase
    .from("job_assets")
    .select("*")
    .eq("job_id", job_id)
    .eq("type", "scene_data")
    .order("meta->scene_index", { ascending: true });

  let scenes: StoryScene[];
  
  if (!sceneAssets || sceneAssets.length === 0) {
    console.log("[IMAGES] No scene data found, creating from story text...");
    
    // Fallback: create scenes from story text
    if (!job.story_text) {
      throw new Error("No scene data and no story text. Run audio phase first.");
    }
    
    // Split story into scenes - USE REQUESTED SCENE COUNT
    const sentences = job.story_text.match(/[^.!?]+[.!?]+/g) || [job.story_text];
    const requestedSceneCount = jobMeta.scene_count || 4;
    const sceneCount = Math.min(requestedSceneCount, sentences.length); // Don't exceed sentence count
    const sentencesPerScene = Math.ceil(sentences.length / sceneCount);
    const duration = job.duration_sec || 60;
    const sceneDuration = duration / sceneCount;
    
    console.log(`[IMAGES] Fallback scene creation: ${sentences.length} sentences -> ${sceneCount} scenes (requested: ${requestedSceneCount})`);
    
    scenes = [];
    for (let i = 0; i < sceneCount; i++) {
      const start = i * sentencesPerScene;
      const end = Math.min(start + sentencesPerScene, sentences.length);
      const sceneText = sentences.slice(start, end).join(' ').trim();
      
      scenes.push({
        text: sceneText,
        keywords: [],
        startTime: i * sceneDuration,
        endTime: (i + 1) * sceneDuration,
        videoUrl: "",
      });
    }
    
    console.log(`[IMAGES] Created ${scenes.length} scenes from story text`);
  } else {
    // Convert from database format
    scenes = sceneAssets.map((a: any) => ({
      text: a.meta.scene_text,
      keywords: a.meta.keywords || [],
      startTime: a.meta.start_time,
      endTime: a.meta.end_time,
      videoUrl: "",
    }));
    console.log(`[IMAGES] Loaded ${scenes.length} scenes from database`);
  }

  // Get the target scene count - use what was actually created in audio phase
  // This ensures we generate all scenes even if there's a mismatch with user request
  const requestedSceneCount = jobMeta.scene_count || 4;
  const actualSceneCount = scenes.length;
  
  // Only limit if we have MORE scenes than requested (shouldn't normally happen)
  // But NEVER reduce below what was created - always generate all existing scenes
  if (actualSceneCount > requestedSceneCount) {
    console.log(`[IMAGES] WARNING: Found ${actualSceneCount} scenes but user requested ${requestedSceneCount}. Limiting to requested count.`);
    scenes = scenes.slice(0, requestedSceneCount);
  } else if (actualSceneCount < requestedSceneCount) {
    console.log(`[IMAGES] NOTE: Only ${actualSceneCount} scenes exist (user requested ${requestedSceneCount}). Will generate all ${actualSceneCount}.`);
  }
  
  const targetSceneCount = scenes.length;
  console.log(`[IMAGES] Target: ${targetSceneCount} images`);

  // Check how many images already generated
  const { data: existingImages } = await supabase
    .from("job_assets")
    .select("*")
    .eq("job_id", job_id)
    .eq("type", "dalle_image");

  const imagesGenerated = existingImages?.length || 0;
  console.log(`[IMAGES] ${imagesGenerated}/${scenes.length} images already generated, using model: ${resolvedImageModel}`);

  if (imagesGenerated >= scenes.length) {
    // All images done
    await updateJob(supabase, job_id, { progress: 70 });
    return { status: "generating", nextPhase: "assemble", message: "All images ready" };
  }

  // Generate images based on source
  // Support both legacy "dalle" and new "ai" visual source
  if (visualSource === "dalle" || visualSource === "ai") {
    // AI IMAGE GENERATION: Generate ONE image at a time for reliability
    // This way if we timeout, we've at least saved some images
    
    // Get art style config
    let styleConfig;
    if (artStyle.startsWith('custom-') && customStyle) {
      styleConfig = {
        name: customStyle.name || "Custom Style",
        basePrompt: customStyle.basePrompt || "",
      };
    } else {
      styleConfig = ART_STYLE_CONFIG[artStyle] || ART_STYLE_CONFIG["cinematic-dark"];
    }
    
    // Check if we have a story anchor already
    let storyAnchor = jobMeta.story_anchor;
    if (!storyAnchor) {
      console.log("[IMAGES] Creating Story Anchor...");
      const storyText = job.story_text || scenes.map(s => s.text).join(" ");
      storyAnchor = await createStoryAnchor(openaiKey, storyText, job.visual_preset || "forest", artStyle, customStyle);
      
      // Save anchor to meta for future phases
      await updateJob(supabase, job_id, { 
        meta: { ...jobMeta, story_anchor: storyAnchor }
      });
      console.log("[IMAGES] Story Anchor created and saved");
    }
    
    // Get visual beats if not cached
    let visualBeats = jobMeta.visual_beats;
    if (!visualBeats) {
      console.log("[IMAGES] Creating visual beats...");
      visualBeats = await createVisualBeats(openaiKey, scenes, storyAnchor);
      
      await updateJob(supabase, job_id, { 
        meta: { ...jobMeta, story_anchor: storyAnchor, visual_beats: visualBeats }
      });
      console.log("[IMAGES] Visual beats created");
    }
    
    // Get visual contracts if not cached (CRITICAL for story accuracy)
    let visualContracts = jobMeta.visual_contracts;
    if (!visualContracts) {
      console.log("[IMAGES] Creating visual contracts (prose → literal frames)...");
      visualContracts = await createSceneVisualContracts(openaiKey, scenes, storyAnchor, visualBeats);
      
      // Attach contracts to beats
      for (let i = 0; i < visualBeats.length; i++) {
        if (visualContracts[i]) {
          visualBeats[i].visualContract = visualContracts[i];
        }
      }
      
      await updateJob(supabase, job_id, { 
        meta: { ...jobMeta, story_anchor: storyAnchor, visual_beats: visualBeats, visual_contracts: visualContracts }
      });
      console.log(`[IMAGES] Visual contracts created: ${visualContracts.length}`);
    } else {
      // Re-attach contracts to beats from cache
      for (let i = 0; i < visualBeats.length; i++) {
        if (visualContracts[i]) {
          visualBeats[i].visualContract = visualContracts[i];
        }
      }
    }
    
    await updateJob(supabase, job_id, { progress: 62 });
    
    // For FLUX: Get reference image URL from scene 0 (if already generated)
    let referenceImageUrl: string | undefined = undefined;
    if (resolvedImageModel === "flux" && imagesGenerated > 0) {
      // Fetch scene 0's image URL from database
      const { data: scene0Asset } = await supabase
        .from("job_assets")
        .select("storage_path")
        .eq("job_id", job_id)
        .eq("type", "dalle_image")
        .eq("meta->>scene_index", "0")
        .single();
      
      if (scene0Asset?.storage_path) {
        referenceImageUrl = scene0Asset.storage_path;
        console.log(`[FLUX] Retrieved scene 0 as reference for character consistency`);
      }
    }
    
    // Generate remaining images one at a time
    for (let i = imagesGenerated; i < scenes.length; i++) {
      const scene = scenes[i];
      const beat = visualBeats[i] || {
        sceneIndex: i,
        visualBeat: scene.text.substring(0, 100),
        cameraAngle: "medium shot",
        focus: "the atmosphere",
        moodLevel: 5,
      };
      
      // DEBUG: Log scene text and beat to verify uniqueness
      console.log(`[IMAGES] === Scene ${i + 1}/${scenes.length} ===`);
      console.log(`[IMAGES] Scene text: "${scene.text.substring(0, 80)}..."`);
      console.log(`[IMAGES] Visual beat: "${beat.visualBeat?.substring(0, 80)}..."`);
      console.log(`[IMAGES] Generating with ${resolvedImageModel}...`);
      
      if (beat.visualContract) {
        console.log(`[CONTRACT] Location: ${beat.visualContract.location}`);
        console.log(`[CONTRACT] Pose: ${beat.visualContract.characterPose}`);
      }
      
      const isCustomStyle = artStyle.startsWith('custom-');
      const visualPreset = job.visual_preset || "forest";
      
      // Refresh lease for each image (heartbeat) - use fresh meta to avoid stale overwrites
      await updateJobMeta(supabase, job_id, (currentMeta) => ({
        ...currentMeta,
        generation_logs: [
          ...(currentMeta.generation_logs || []),
          `[${new Date().toISOString()}] Generating scene ${i + 1}/${scenes.length} with ${resolvedImageModel}`
        ],
        images_phase_lease_until: new Date(Date.now() + leaseMs).toISOString() // Refresh lease
      }));
      
      // Build prompt - use FLUX-specific prompt for FLUX model (shorter, simpler)
      let imagePrompt: string;
      if (resolvedImageModel === "flux") {
        imagePrompt = buildFluxPrompt(
          storyAnchor,
          beat,
          i,
          scenes.length,
          styleConfig,
          isCustomStyle
        );
      } else {
        // DALL-E 3 / GPT-4o use the full detailed prompt
        imagePrompt = buildFinalDallePrompt(
          storyAnchor,
          beat,
          i,
          scenes.length,
          styleConfig,
          isCustomStyle,
          visualPreset
        );
      }
      
      console.log(`[IMAGES] Scene ${i + 1} prompt built (${imagePrompt.length} chars, model: ${resolvedImageModel})`);
      
      // Debug: log contract details to verify uniqueness per scene
      if (beat.visualContract) {
        console.log(`[IMAGES] Scene ${i + 1} contract: location="${beat.visualContract.location}", pose="${beat.visualContract.characterPose}"`);
      } else {
        console.log(`[IMAGES] Scene ${i + 1} has NO contract - using fallback prompt`);
      }
      
      // CRITICAL: Check if this scene's image already exists BEFORE generating
      // This prevents duplicate API calls when phase is triggered multiple times
      const { data: existingSceneImages } = await supabase
        .from("job_assets")
        .select("id, storage_path, meta")
        .eq("job_id", job_id)
        .eq("type", "dalle_image");
      
      // Filter by scene_index manually (JSON path queries can be unreliable)
      const existingSceneImage = existingSceneImages?.find(
        (img: any) => img.meta?.scene_index === i
      );
      
      if (existingSceneImage?.storage_path) {
        console.log(`[IMAGES] Scene ${i + 1} already has image, SKIPPING generation: ${existingSceneImage.storage_path.substring(0, 50)}...`);
        continue;
      }
      
      // Strict mode: fail if model unavailable instead of silently falling back
      // Set to false in job meta if you want automatic fallback to DALL-E 3
      const strictImageModel = jobMeta.strict_image_model ?? true;
      
      let imageUrl: string | null = null;
      try {
        const rawImageUrl = await generateImage(
          openaiKey,
          imagePrompt,
          i,
          resolvedImageModel,
          referenceImageUrl,  // Pass reference for FLUX character consistency
          strictImageModel    // Pass strict mode flag
        );
        
        // Upload to Supabase Storage to prevent URL expiry issues
        if (rawImageUrl) {
          try {
            imageUrl = await uploadRemoteImageToStorage(
              supabase,
              "story-videos",
              `${job_id}/images/scene_${i}.webp`,
              rawImageUrl
            );
          } catch (uploadErr) {
            console.warn(`[IMAGES] Storage upload failed, using original URL:`, uploadErr);
            imageUrl = rawImageUrl; // Fallback to original URL
          }
        }
        
        // Store first scene as reference if FLUX (use stored URL for stability)
        if (i === 0 && imageUrl && resolvedImageModel === "flux") {
          referenceImageUrl = imageUrl;
          console.log(`[FLUX] Scene 1 stored as reference for character consistency`);
          await updateJobMeta(supabase, job_id, (meta) => ({
            ...meta,
            generation_logs: [
              ...(meta.generation_logs || []),
              `[${new Date().toISOString()}] [FLUX] Scene 1 stored as reference for consistency`
            ]
          }));
        }
      } catch (imgError: any) {
        const errorMessage = imgError?.message || String(imgError);
        console.error(`[IMAGES] Scene ${i + 1} generation error:`, errorMessage);
        
        // Log the error to job meta for UI visibility
        await updateJobMeta(supabase, job_id, (meta) => ({
          ...meta,
          generation_logs: [
            ...(meta.generation_logs || []),
            `[${new Date().toISOString()}] [ERROR] Scene ${i + 1}: ${errorMessage.substring(0, 200)}`
          ]
        }));
        
        // Fallback to Pexels PHOTO (not video) for image assets
        try {
          const fallbackQuery = scene.keywords.join(" ") || "dark forest";
          const { searchPexelsPhoto } = await import("./pexels.ts");
          const fallbackPhotoUrl = await searchPexelsPhoto(pexelsKey, fallbackQuery);
          imageUrl = fallbackPhotoUrl || "https://images.pexels.com/photos/1591382/pexels-photo-1591382.jpeg?auto=compress&cs=tinysrgb&w=1260";
          console.log(`[IMAGES] Scene ${i + 1} using Pexels PHOTO fallback: ${fallbackQuery}`);
        } catch (pexError) {
          console.error(`[IMAGES] Pexels photo fallback failed:`, pexError);
          imageUrl = "https://images.pexels.com/photos/1591382/pexels-photo-1591382.jpeg?auto=compress&cs=tinysrgb&w=1260";
        }
      }
      
      // Save to database IMMEDIATELY
      // Determine correct source/type based on actual model used
      const assetSource = resolvedImageModel === "flux" ? "ai" : 
                          resolvedImageModel === "gpt-4o" ? "ai" : "dalle";
      
      // Check if URL is from Supabase Storage (permanent) vs temporary
      const isSupabaseUrl = imageUrl?.includes('supabase.co');
      
      const { error: insertError } = await supabase.from("job_assets").insert({
        job_id: job_id,
        type: "dalle_image",  // Keep type for backward compatibility with queries
        storage_path: imageUrl,
        public_url: isSupabaseUrl ? imageUrl : null,  // Only set if permanent URL
        meta: { 
          scene_index: i, 
          scene_text: scene.text,
          keywords: scene.keywords,
          start_time: scene.startTime,
          end_time: scene.endTime,
          source: assetSource,
          image_model: resolvedImageModel,  // ✅ Actual model used
          art_style: styleConfig.name,
          dalle_prompt: imagePrompt,
          visual_beat: beat.visualBeat,
          mood_level: beat.moodLevel,
          camera_angle: beat.cameraAngle,
          continuity_rules: storyAnchor.continuityRules || null,
          character_description: storyAnchor.characterDescription || null,
          generated_at: new Date().toISOString(),
          is_permanent: isSupabaseUrl,  // Flag for UI to know if URL will expire
        },
      });
      
      if (insertError) {
        console.error(`[IMAGES] Scene ${i + 1} DB insert error:`, insertError);
      } else {
        console.log(`[IMAGES] ✓ Scene ${i + 1} saved to database`);
      }
      
      // Update progress
      const imageProgress = 63 + Math.floor((i + 1) / scenes.length * 6);
      await updateJob(supabase, job_id, { progress: imageProgress });
      
      // =====================================================
      // CRITICAL: Generate ONE image per function call to avoid timeout
      // Edge functions have 60-150s timeout, but image generation can take 30-60s each
      // Release the lock and return - check-job will trigger another run for next scene
      // =====================================================
      if (i < scenes.length - 1) {
        console.log(`[IMAGES] ✓ Scene ${i + 1}/${scenes.length} done. Releasing lock for next poll cycle.`);
        
        // Release lock but keep images_complete false so check-job triggers next run
        await updateJobMeta(supabase, job_id, (meta) => ({
          ...meta,
          images_phase_running: false,
          images_phase_lease_until: new Date(0).toISOString(), // Expired lease
          last_image_generated: i + 1,
        }));
        
        // Return immediately - check-job will see more images needed and trigger another run
        return { 
          status: "generating", 
          nextPhase: "images", 
          message: `Image ${i + 1}/${scenes.length} generated, releasing for next cycle` 
        };
      }
    }
    
    // Check final count
    const { data: allImages } = await supabase
      .from("job_assets")
      .select("*")
      .eq("job_id", job_id)
      .eq("type", "dalle_image");

    // Store Replicate inputs in job meta for debugging (using fresh meta)
    const replicateInputs = getLastReplicateInputs();
    
    if (allImages?.length >= scenes.length) {
      await updateJobMeta(supabase, job_id, (meta) => ({
        ...meta,
        images_phase_running: false, 
        images_complete: true,
        replicate_inputs: replicateInputs.length > 0 ? replicateInputs : undefined
      }));
      await updateJob(supabase, job_id, { progress: 70 });
      return { status: "generating", nextPhase: "assemble", message: "All images ready" };
    } else {
      // More images still needed (shouldn't happen but just in case)
      await updateJobMeta(supabase, job_id, (meta) => ({
        ...meta,
        images_phase_running: false,
        replicate_inputs: replicateInputs.length > 0 ? replicateInputs : undefined
      }));
      return { status: "generating", nextPhase: "images", message: `${allImages?.length || 0}/${scenes.length} images generated` };
    }
  } else {
    // Pexels videos - fast, can do all at once
    const scenesWithVisuals = await searchVideosForScenes(pexelsKey, scenes, job.visual_preset || "forest");
    
    for (let i = 0; i < scenesWithVisuals.length; i++) {
      await supabase.from("job_assets").insert({
        job_id: job_id,
        type: "bg_video",
        storage_path: scenesWithVisuals[i].videoUrl || "",
        meta: { scene_index: i, source: "pexels" },
      });
    }

    await updateJob(supabase, job_id, { progress: 70 });
    return { status: "generating", nextPhase: "assemble", message: "Videos ready" };
  }
}

// =====================================================
// PHASE 3: Assemble Video
// =====================================================
export async function runAssemblePhase(
  supabase: any,
  creatomateKey: string,
  job: any,
  job_id: string,
  jobMeta: any,
  options: VideoOptions
): Promise<{ status: string; nextPhase: string | null; message: string }> {
  console.log(`[ASSEMBLE] Starting assemble phase for job ${job_id}`);

  // Determine renderer to use
  const useFFmpeg = shouldUseFFmpegRenderer();
  console.log(`[ASSEMBLE] Using ${useFFmpeg ? "FFmpeg" : "Creatomate"} renderer`);

  // Check if assemble phase is already running
  if (jobMeta.assemble_phase_running) {
    const startedAt = new Date(jobMeta.assemble_phase_started_at || 0).getTime();
    const elapsed = Date.now() - startedAt;
    if (elapsed < 3 * 60 * 1000) {
      console.log(`[ASSEMBLE] Phase already running (started ${elapsed/1000}s ago), skipping`);
      return { status: "rendering", nextPhase: "assemble", message: "Assemble phase already in progress" };
    }
  }
  
  // Mark phase as running
  await updateJob(supabase, job_id, {
    progress: 72,
    meta: { 
      ...jobMeta, 
      assemble_phase_running: true,
      assemble_phase_started_at: new Date().toISOString(),
      renderer: useFFmpeg ? "ffmpeg" : "creatomate"
    }
  });

  // Get audio URL
  const { data: audioUrlData } = supabase.storage
    .from("story-videos")
    .getPublicUrl(`${job_id}/audio.mp3`);

  // Get captions
  const { data: captionsBlob } = await supabase.storage
    .from("story-videos")
    .download(`${job_id}/captions.json`);
  
  const captionsText = await captionsBlob.text();
  const captionsData = JSON.parse(captionsText);

  // Get images/videos
  const { data: imageAssets } = await supabase
    .from("job_assets")
    .select("*")
    .eq("job_id", job_id)
    .in("type", ["dalle_image", "bg_video"])
    .order("meta->scene_index", { ascending: true });

  // Get scene data
  const { data: sceneAssets } = await supabase
    .from("job_assets")
    .select("*")
    .eq("job_id", job_id)
    .eq("type", "scene_data")
    .order("meta->scene_index", { ascending: true });

  if (!imageAssets?.length || !sceneAssets?.length) {
    throw new Error("Missing images or scene data");
  }

  // Build scenes with visuals
  const scenes: StoryScene[] = sceneAssets.map((s: any, i: number) => ({
    text: s.meta.scene_text,
    keywords: s.meta.keywords || [],
    startTime: s.meta.start_time,
    endTime: s.meta.end_time,
    videoUrl: imageAssets[i]?.storage_path || "",
  }));

  const visualSource = imageAssets[0]?.type === "dalle_image" ? "dalle" : "pexels";
  
  let renderId: string;
  
  if (useFFmpeg) {
    // Use FFmpeg renderer
    console.log("[ASSEMBLE] Calling FFmpeg renderer...");
    const result = await renderWithFFmpeg(
      audioUrlData.publicUrl,
      scenes,
      job.duration_sec || 60,
      options,
      job_id, // Pass job_id for direct Supabase upload
      captionsData.captions // Pass captions for text overlay
    );
    renderId = result.renderId;
  } else {
    // Use Creatomate
    console.log("[ASSEMBLE] Calling Creatomate...");
    renderId = await assembleVideoWithCreatomate(
      creatomateKey,
      audioUrlData.publicUrl,
      captionsData.captions,
      scenes,
      job.duration_sec || 60,
      options,
      visualSource
    );
  }

  // Save render job info
  await supabase.from("job_assets").upsert({
    job_id: job_id,
    type: "render_job",
    storage_path: renderId,
    meta: { 
      render_id: renderId, 
      status: "rendering", 
      started_at: new Date().toISOString(),
      renderer: useFFmpeg ? "ffmpeg" : "creatomate"
    },
  }, {
    onConflict: "job_id,type"
  });

  await updateJob(supabase, job_id, { 
    status: "rendering",
    progress: 75,
    meta: { ...jobMeta, render_id: renderId, renderer: useFFmpeg ? "ffmpeg" : "creatomate" }
  });

  // Poll for completion (shorter timeout since we can be called again)
  const maxWaitTime = 2 * 60 * 1000; // 2 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    let renderStatus;
    if (useFFmpeg) {
      renderStatus = await checkFFmpegRender(renderId);
    } else {
      renderStatus = await checkCreatomateRender(creatomateKey, renderId);
    }
    
    if (renderStatus.status === "succeeded" && renderStatus.url) {
      // Save final video (delete existing then insert to avoid constraint issues)
      await supabase.from("job_assets")
        .delete()
        .eq("job_id", job_id)
        .eq("type", "final_mp4");
      
      const { error: insertError } = await supabase.from("job_assets").insert({
        job_id: job_id,
        type: "final_mp4",
        storage_path: renderStatus.url,
        public_url: renderStatus.url,
        meta: { render_id: renderId, status: "complete", renderer: useFFmpeg ? "ffmpeg" : "creatomate" },
      });
      
      if (insertError) {
        console.error("[ASSEMBLE] Failed to save final_mp4:", insertError);
      } else {
        console.log(`[ASSEMBLE] Final video saved: ${renderStatus.url}`);
      }

      await updateJob(supabase, job_id, {
        status: "complete",
        progress: 100,
      });

      console.log(`[ASSEMBLE] Job ${job_id} complete!`);
      return { status: "complete", nextPhase: null, message: "Video ready!" };
    } else if (renderStatus.status === "failed") {
      const errorMsg = (renderStatus as any).error || (renderStatus as any).error_message || "Unknown error";
      throw new Error(`Render failed: ${errorMsg}`);
    }

    // Update progress
    const progress = 75 + Math.floor((renderStatus.progress || 0) * 0.25);
    await updateJob(supabase, job_id, { progress });
  }

  // Still rendering, will continue on next poll
  return { status: "rendering", nextPhase: "assemble", message: "Still rendering..." };
}

// =====================================================
// FULL GENERATION (Legacy - kept for backward compatibility)
// =====================================================
export async function runFullGeneration(
  supabase: any,
  openaiKey: string,
  elevenLabsKey: string,
  creatomateKey: string,
  pexelsKey: string,
  job: any,
  job_id: string,
  jobMeta: any,
  options: VideoOptions,
  visualSource: string,
  artStyle: string,
  customStyle: any
): Promise<{ status: string; message: string }> {
  try {
    console.log(`[BG] Starting full generation for job ${job_id}`);

    // Run audio phase
    await runAudioPhase(supabase, openaiKey, elevenLabsKey, job, job_id, jobMeta);
    
    // Refresh job data
    const { data: refreshedJob } = await supabase.from("jobs").select("*").eq("id", job_id).single();
    const refreshedMeta = refreshedJob?.meta || jobMeta;
    
    // Run images phase
    await runImagesPhase(supabase, openaiKey, pexelsKey, refreshedJob || job, job_id, refreshedMeta, visualSource, artStyle, customStyle);
    
    // Refresh again
    const { data: refreshedJob2 } = await supabase.from("jobs").select("*").eq("id", job_id).single();
    const refreshedMeta2 = refreshedJob2?.meta || refreshedMeta;
    
    // Run assemble phase
    const result = await runAssemblePhase(supabase, creatomateKey, refreshedJob2 || job, job_id, refreshedMeta2, options);
    
    return { status: result.status, message: result.message };

  } catch (error) {
    console.error(`[BG] Job ${job_id} failed:`, error);
    
    await updateJob(supabase, job_id, {
      status: "failed",
      error: (error as Error).message,
    });
    
    return { status: "failed", message: (error as Error).message };
  }
}
