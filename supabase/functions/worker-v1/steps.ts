// =====================================================
// WORKER V1 STEP IMPLEMENTATIONS
// Real work for each pipeline step
// v1.2 - 2026-02-22 (Standardized asset paths)
// v1.1 - 2026-02-22 (Added step logging)
// v1.0 - 2026-02-20
// =====================================================

import { SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";
import {
  Job,
  StepResult,
  getAssetByKey,
  getAssetsByPrefix,
  upsertAsset,
  updateJobFields,
  updateJobMeta,
  loadJob,
  requireLeaseOwner,
  requireLeaseGrace,
  heartbeatJob,
  uploadToStorage,
  uploadRemoteToStorage,
  computeHash,
  computePipelineHash,
  fetchWithError,
  ELEVENLABS_VOICE_ID,
  STORAGE_BUCKET,
  updateStepStatus,
  // Path builders for canonical storage paths
  pathForImage,
  pathForAudio,
  pathForSubtitles,
  pathForAssembledVideo,
  pathForFinalVideo,
} from "./helpers.ts";

import { StepLogger } from "./stepLogger.ts";

// =====================================================
// STEP 1: STORY GENERATION
// =====================================================

export async function executeStoryStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:story_generate`;

  // Check if story already exists
  if (job.story_text && job.title) {
    console.log(`[STORY] Story already exists: "${job.title}"`);
    
    // Ensure asset record exists for idempotency
    const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
    if (!existingAsset) {
      const contentHash = await computeHash(job.story_text);
      await upsertAsset(supabase, job.id, idempotencyKey, 'story', '', null, {
        title: job.title,
        content_hash: contentHash,
        word_count: job.story_text.split(/\s+/).length,
        source: 'existing'
      });
    }
    
    return { success: true, skipped: true, data: { title: job.title } };
  }

  // Check if asset exists (previous partial run)
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.meta?.title && existingAsset?.meta?.story_text) {
    console.log(`[STORY] Restoring from asset: "${existingAsset.meta.title}"`);
    await updateJobFields(supabase, job.id, {
      title: existingAsset.meta.title,
      story_text: existingAsset.meta.story_text,
    });
    return { success: true, skipped: true, data: { title: existingAsset.meta.title } };
  }

  // Generate story directly via OpenAI
  const openaiKey = env.OPENAI_API_KEY;
  if (!openaiKey) {
    return { success: false, error: 'OPENAI_API_KEY not configured' };
  }
  
  const vibePreset = job.vibe_preset || (job.meta?.vibe_preset as string) || 'urban_legend';
  const duration = (job.meta?.duration as { min?: number; max?: number } | number) || 60;
  const targetDuration = typeof duration === 'object' ? (duration.min || 60) : duration;

  // Calculate target word count (roughly 2.5 words per second for narration)
  const targetWords = Math.round(targetDuration * 2.5);
  const wordRange = { min: Math.round(targetWords * 0.85), max: Math.round(targetWords * 1.15) };

  console.log(`[STORY] Generating story for vibe=${vibePreset}, duration=${targetDuration}s (~${targetWords} words)`);

  try {
    // Build story prompt based on vibe preset
    const storyPrompt = buildStoryPrompt(vibePreset, wordRange);

    // Log prompt snapshot
    await logger.snapshot('story', 'prompt', storyPrompt, `OpenAI prompt for ${vibePreset} story`);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a master storyteller specializing in short-form horror and mystery content. You create gripping, atmospheric stories perfect for TikTok/Reels narration. Your stories are ALWAYS first-person narration that feels personal and immediate.`
          },
          {
            role: 'user',
            content: storyPrompt
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.9,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    const parsed = JSON.parse(content);
    const title = parsed.title || 'Untitled Story';
    const storyText = parsed.story || parsed.content || parsed.text;

    if (!storyText) {
      throw new Error('Story generation returned no story text');
    }

    const contentHash = await computeHash(storyText);

    // Log response snapshot (truncated story)
    await logger.snapshot('story', 'response', { title, story_preview: storyText.slice(0, 300), word_count: storyText.split(/\s+/).length }, 'Generated story');

    // Update job
    await updateJobFields(supabase, job.id, {
      title: title,
      story_text: storyText,
      story_word_count: storyText.split(/\s+/).length,
    });

    // Store asset for idempotency
    await upsertAsset(supabase, job.id, idempotencyKey, 'story', '', null, {
      title: title,
      story_text: storyText,
      content_hash: contentHash,
      word_count: storyText.split(/\s+/).length,
      vibe_preset: vibePreset,
      generated_at: new Date().toISOString(),
    });

    console.log(`[STORY] ✓ Generated: "${title}" (${storyText.split(/\s+/).length} words)`);
    return { success: true, data: { title, word_count: storyText.split(/\s+/).length } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[STORY] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Build story prompt based on vibe preset
 */
function buildStoryPrompt(vibePreset: string, wordRange: { min: number; max: number }): string {
  const vibeDescriptions: Record<string, string> = {
    urban_legend: 'an urban legend or creepy internet story, featuring unexplained phenomena, "that one weird thing that happened", or local folklore that turns out to be true',
    one_too_many: 'a chilling "one too many" counting horror story where a group realizes there\'s an extra person/item that shouldn\'t exist (e.g., "there were 4 of us on that camping trip... but in every photo, there are 5 people")',
    backrooms: 'a liminal space or "backrooms" style horror about accidentally entering wrong places, glitches in reality, or spaces that shouldn\'t exist',
    nosleep: 'a first-person creepypasta/NoSleep style horror that starts mundane but escalates into something terrifying',
    glitch: 'a glitch in the matrix story about strange repetitions, déjà vu, NPCs acting weird, or reality not working right',
  };

  const vibeDesc = vibeDescriptions[vibePreset] || vibeDescriptions.urban_legend;

  return `Create ${vibeDesc}.

REQUIREMENTS:
- Word count: ${wordRange.min}-${wordRange.max} words (this is critical for video timing)
- First-person narration, past tense
- Start with an engaging hook that grabs attention in the first 3 seconds
- Build tension throughout
- End with a chilling revelation or unresolved mystery
- Use vivid sensory details
- Keep sentences punchy for narration pacing

Respond in JSON format:
{
  "title": "Short catchy title (3-6 words)",
  "story": "The full story text..."
}`;
}

// =====================================================
// STEP 2: UNIQUENESS CHECK
// =====================================================

export async function executeUniquenessStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:uniqueness_check`;

  // Check if already done
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.meta?.checked) {
    console.log(`[UNIQUENESS] Already checked (hash: ${existingAsset.meta.story_hash})`);
    return { success: true, skipped: true, data: existingAsset.meta as Record<string, unknown> };
  }

  if (!job.story_text) {
    return { success: false, error: 'No story_text available for uniqueness check' };
  }

  const storyHash = await computeHash(job.story_text);
  console.log(`[UNIQUENESS] Checking story hash: ${storyHash.substring(0, 16)}...`);

  try {
    // Check if story_dna entry exists for this job
    const { data: existingDna } = await supabase
      .from('story_dna')
      .select('id, concept_hash')
      .eq('job_id', job.id)
      .single();

    if (existingDna) {
      console.log(`[UNIQUENESS] story_dna already exists for job`);
      await upsertAsset(supabase, job.id, idempotencyKey, 'uniqueness_check', '', null, {
        checked: true,
        story_hash: storyHash,
        existing_dna_id: existingDna.id,
        source: 'existing_dna'
      });
      return { success: true, skipped: true, data: { story_hash: storyHash } };
    }

    // Insert into story_dna (basic uniqueness tracking)
    const { error: insertError } = await supabase
      .from('story_dna')
      .upsert({
        job_id: job.id,
        brand_id: job.brand_id,
        concept_hash: storyHash,
        created_at: new Date().toISOString(),
      }, { onConflict: 'job_id' });

    if (insertError) {
      console.warn(`[UNIQUENESS] story_dna insert warning: ${insertError.message}`);
      // Non-fatal - continue anyway
    }

    // Check for similar stories (basic collision check)
    const { data: similarStories } = await supabase
      .from('story_dna')
      .select('id, job_id, concept_hash')
      .eq('brand_id', job.brand_id)
      .eq('concept_hash', storyHash)
      .neq('job_id', job.id)
      .limit(5);

    const hasCollision = (similarStories?.length || 0) > 0;
    const uniquenessScore = hasCollision ? 0.5 : 0.95;

    // Store result
    await upsertAsset(supabase, job.id, idempotencyKey, 'uniqueness_check', '', null, {
      checked: true,
      story_hash: storyHash,
      uniqueness_score: uniquenessScore,
      has_collision: hasCollision,
      collision_count: similarStories?.length || 0,
    });

    console.log(`[UNIQUENESS] ✓ Score: ${uniquenessScore}, collisions: ${similarStories?.length || 0}`);
    return { success: true, data: { story_hash: storyHash, uniqueness_score: uniquenessScore } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[UNIQUENESS] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// =====================================================
// STEP 3: SCENES + SUBTITLES GENERATION
// =====================================================

export async function executeScenesStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:scenes_subtitles`;

  // Check if already done - ensure we have actual scenes, not just an empty array
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.meta?.scenes && (existingAsset.meta.scenes as unknown[]).length > 0) {
    const scenes = existingAsset.meta.scenes as unknown[];
    console.log(`[SCENES] Already generated: ${scenes.length} scenes`);
    return { success: true, skipped: true, data: { scene_count: scenes.length } };
  }

  if (!job.story_text) {
    return { success: false, error: 'No story_text available for scene generation' };
  }

  // Handle duration - can be a number or { minSeconds, maxSeconds } object
  const rawDuration = job.meta?.duration;
  let duration: number;
  if (typeof rawDuration === 'number') {
    duration = rawDuration;
    console.log(`[SCENES] Duration from number: ${duration}s`);
  } else if (rawDuration && typeof rawDuration === 'object') {
    // Use average of min/max, or min, or max, or default to 60
    const durObj = rawDuration as { minSeconds?: number; maxSeconds?: number; min?: number; max?: number };
    const minSec = durObj.minSeconds ?? durObj.min ?? 60;
    const maxSec = durObj.maxSeconds ?? durObj.max ?? 90;
    duration = Math.round((minSec + maxSec) / 2);
    console.log(`[SCENES] Duration from object: min=${minSec}, max=${maxSec}, avg=${duration}s`);
  } else {
    duration = 60;
    console.log(`[SCENES] Duration defaulted to: ${duration}s`);
  }
  
  const sceneCount = (job.meta?.scene_count as number) || Math.ceil(duration / 10);
  console.log(`[SCENES] Calculated sceneCount=${sceneCount} for duration=${duration}s`);

  console.log(`[SCENES] Generating ${sceneCount} scenes for ${duration}s video`);

  try {
    // Split story into sentences
    const sentences = job.story_text
      .split(/(?<=[.!?])\s+/)
      .filter(s => s.trim().length > 0);

    // Distribute sentences across scenes
    const scenesPerSentence = Math.max(1, Math.floor(sentences.length / sceneCount));
    const scenes: Array<{
      index: number;
      text: string;
      startTime: number;
      endTime: number;
      keywords: string[];
    }> = [];

    const sceneDuration = duration / sceneCount;

    for (let i = 0; i < sceneCount; i++) {
      const startIdx = i * scenesPerSentence;
      const endIdx = i === sceneCount - 1 ? sentences.length : (i + 1) * scenesPerSentence;
      const sceneText = sentences.slice(startIdx, endIdx).join(' ');

      // Extract basic keywords (nouns/adjectives)
      const words = sceneText.toLowerCase().split(/\s+/);
      const keywords = words
        .filter(w => w.length > 4)
        .slice(0, 5);

      scenes.push({
        index: i,
        text: sceneText || sentences[0] || 'Scene',
        startTime: i * sceneDuration,
        endTime: (i + 1) * sceneDuration,
        keywords: keywords,
      });
    }

    // Generate subtitle cues (word-level timing approximation)
    const wordCount = job.story_text.split(/\s+/).length;
    const wordsPerSecond = wordCount / duration;
    const words = job.story_text.split(/\s+/);
    
    const subtitleCues: Array<{ start: number; end: number; text: string }> = [];
    let currentTime = 0;

    for (const word of words) {
      const wordDuration = 1 / wordsPerSecond;
      subtitleCues.push({
        start: currentTime,
        end: currentTime + wordDuration,
        text: word,
      });
      currentTime += wordDuration;
    }

    // Store asset
    await upsertAsset(supabase, job.id, idempotencyKey, 'scene_data', '', null, {
      scenes: scenes,
      subtitle_cues: subtitleCues,
      scene_count: scenes.length,
      duration: duration,
      word_count: wordCount,
    });

    // === PIPELINE HASH: Compute once for entire job config ===
    // This makes debugging "why did this re-render?" trivial
    const storyHash = await computeHash(job.story_text);
    const artStyle = (job.meta?.art_style as string) || 'cinematic-dark';
    const visualPreset = job.visual_preset || (job.meta?.visual_preset as string) || 'forest';
    const musicTrackId = (job.meta?.music_track_id as string) || 'ambient_dark_01';
    const vibePreset = job.vibe_preset || (job.meta?.vibe_preset as string) || 'urban_legend';
    
    const pipelineHash = await computePipelineHash({
      brandId: job.brand_id,
      vibePreset: vibePreset,
      duration: duration,
      storyHash: storyHash,
      artStyle: artStyle,
      visualPreset: visualPreset,
      voiceId: ELEVENLABS_VOICE_ID,
      voiceModel: 'eleven_turbo_v2_5',
      musicTrackId: musicTrackId,
    });

    // Also update job meta with scene data + pipeline hash
    await updateJobMeta(supabase, job.id, {
      scenes: scenes,
      subtitle_cues: subtitleCues,
      pipeline_hash: pipelineHash,
      pipeline_hash_inputs: {
        brand_id: job.brand_id,
        vibe_preset: vibePreset,
        duration: duration,
        story_hash: storyHash.slice(0, 16),
        art_style: artStyle,
        visual_preset: visualPreset,
        voice_id: ELEVENLABS_VOICE_ID,
        voice_model: 'eleven_turbo_v2_5',
        music_track_id: musicTrackId,
      },
    });

    console.log(`[SCENES] ✓ Generated ${scenes.length} scenes, ${subtitleCues.length} subtitle cues, pipeline_hash=${pipelineHash.slice(0, 12)}...`);
    
    // Validate we actually generated scenes
    if (scenes.length === 0) {
      return { success: false, error: `Scene generation produced 0 scenes (duration=${duration}, sceneCount=${sceneCount}, sentences=${job.story_text?.split(/(?<=[.!?])\s+/).length || 0})` };
    }
    
    return { success: true, data: { scene_count: scenes.length, subtitle_count: subtitleCues.length, pipeline_hash: pipelineHash } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[SCENES] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// =====================================================
// STEP 4: VOICE SYNTHESIS (ElevenLabs)
// =====================================================

export async function executeVoiceStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:voice_synthesis`;

  // Check if already done
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.public_url) {
    console.log(`[VOICE] Already generated: ${existingAsset.public_url}`);
    return { success: true, skipped: true, data: { audio_url: existingAsset.public_url } };
  }

  if (!job.story_text) {
    return { success: false, error: 'No story_text available for voice synthesis' };
  }

  const elevenLabsKey = env.ELEVENLABS_API_KEY;
  if (!elevenLabsKey) {
    return { success: false, error: 'ELEVENLABS_API_KEY not configured' };
  }

  // === EXTERNAL IDEMPOTENCY: Hash includes voice_id+model+text to avoid cross-config collisions ===
  const voiceModel = 'eleven_turbo_v2_5';
  const voiceStability = '0.5';
  const voiceSimilarity = '0.75';
  const canonicalVoiceInput = `${ELEVENLABS_VOICE_ID}|${voiceModel}|${voiceStability}|${voiceSimilarity}|${job.story_text}`;
  const storyHash = await computeHash(canonicalVoiceInput);
  const storyHashKey = `voice_hash:${storyHash}`;
  // Quality guard: only reuse if quality_ok !== false
  const existingHashAsset = await getAssetByKey(supabase, job.id, storyHashKey, true);
  if (existingHashAsset?.public_url) {
    console.log(`[VOICE] Story hash match (billing protection): ${storyHash.slice(0, 8)}...`);
    // Copy existing asset to job's voice key
    await upsertAsset(supabase, job.id, idempotencyKey, 'voice', 
      existingHashAsset.storage_path, existingHashAsset.public_url, {
        story_hash: storyHash,
        copied_from: existingHashAsset.idempotency_key,
        timestamps: existingHashAsset.meta?.timestamps,
        duration_ms: existingHashAsset.meta?.duration_ms,
      });
    // Update job meta
    await updateJobMeta(supabase, job.id, {
      audio_url: existingHashAsset.public_url,
      audio_duration_ms: existingHashAsset.meta?.duration_ms,
    });
    return { success: true, skipped: true, data: { 
      audio_url: existingHashAsset.public_url, 
      billing_protected: true 
    } };
  }

  console.log(`[VOICE] Synthesizing ${job.story_text.split(/\s+/).length} words with ElevenLabs`);

  try {
    // === LEASE GRACE CHECK: Verify enough time before expensive API call ===
    await requireLeaseGrace(supabase, job.id, workerId, 'ElevenLabs TTS');

    // Snapshot voice request params
    await logger.snapshot('voice', 'payload', {
      voice_id: ELEVENLABS_VOICE_ID,
      model: voiceModel,
      text_length: job.story_text.length,
      word_count: job.story_text.split(/\s+/).length,
      text_preview: job.story_text.slice(0, 200),
    }, 'ElevenLabs TTS request params');

    // Call ElevenLabs with timestamps
    const response = await fetchWithError(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/with-timestamps`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': elevenLabsKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: job.story_text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      },
      'ElevenLabs TTS'
    );

    const data = await response.json();
    
    if (!data.audio_base64) {
      throw new Error('ElevenLabs returned no audio data');
    }

    // Decode base64 audio
    const audioBase64 = data.audio_base64;
    const binaryString = atob(audioBase64);
    const audioBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      audioBytes[i] = binaryString.charCodeAt(i);
    }

    // Upload to storage (using standardized path)
    const storagePath = pathForAudio(job.brand_id, job.id);
    const publicUrl = await uploadToStorage(
      supabase,
      STORAGE_BUCKET,
      storagePath,
      audioBytes,
      'audio/mpeg'
    );

    // Parse timestamps if available
    let timestamps: Array<{ word: string; start: number; end: number }> = [];
    let durationMs = 0;

    if (data.alignment?.characters) {
      // Parse character-level timestamps into word timestamps
      const chars = data.alignment.characters;
      const charStarts = data.alignment.character_start_times_seconds;
      const charEnds = data.alignment.character_end_times_seconds;

      let currentWord = '';
      let wordStart = 0;
      let wordEnd = 0;

      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        if (char === ' ' || i === chars.length - 1) {
          if (i === chars.length - 1 && char !== ' ') {
            currentWord += char;
            wordEnd = charEnds[i];
          }
          if (currentWord.trim().length > 0) {
            timestamps.push({
              word: currentWord.trim(),
              start: wordStart,
              end: wordEnd,
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

      durationMs = (charEnds[charEnds.length - 1] || 0) * 1000;
    }

    // Store asset
    await upsertAsset(supabase, job.id, idempotencyKey, 'voice_audio', storagePath, publicUrl, {
      duration_ms: durationMs,
      word_count: timestamps.length,
      has_timestamps: timestamps.length > 0,
      story_hash: storyHash,
      timestamps: timestamps,
    });
    
    // Also store with hash key for external idempotency (billing protection)
    await upsertAsset(supabase, job.id, storyHashKey, 'voice_audio', storagePath, publicUrl, {
      duration_ms: durationMs,
      word_count: timestamps.length,
      has_timestamps: timestamps.length > 0,
      story_hash: storyHash,
      timestamps: timestamps,
    });

    // Update job meta with timestamps
    await updateJobMeta(supabase, job.id, {
      audio_url: publicUrl,
      audio_timestamps: timestamps,
      audio_duration_ms: durationMs,
    });

    console.log(`[VOICE] ✓ Generated ${durationMs}ms audio, ${timestamps.length} word timestamps`);
    
    // Snapshot voice response summary
    await logger.snapshot('voice', 'response', {
      duration_ms: durationMs,
      word_count: timestamps.length,
      has_timestamps: timestamps.length > 0,
      audio_url: publicUrl,
    }, 'ElevenLabs TTS result');

    return { success: true, data: { audio_url: publicUrl, duration_ms: durationMs } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[VOICE] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// =====================================================
// STEP 5: MUSIC SELECTION
// =====================================================

export async function executeMusicStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:music_select`;

  // Check if already done
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.meta?.track_id) {
    console.log(`[MUSIC] Already selected: ${existingAsset.meta.track_id}`);
    return { success: true, skipped: true, data: existingAsset.meta as Record<string, unknown> };
  }

  // Check if job already has music track
  if (job.meta?.music_track_id) {
    console.log(`[MUSIC] Track already set in job meta: ${job.meta.music_track_id}`);
    await upsertAsset(supabase, job.id, idempotencyKey, 'music', '', null, {
      track_id: job.meta.music_track_id,
      source: 'job_meta'
    });
    return { success: true, skipped: true, data: { track_id: job.meta.music_track_id } };
  }

  const vibePreset = job.vibe_preset || (job.meta?.vibe_preset as string) || 'urban_legend';
  
  // Deterministic track selection based on vibe preset
  const trackMap: Record<string, string> = {
    'urban_legend': 'ambient_dark_01',
    'slow_creepy': 'ambient_creepy_01',
    'punchy_shock': 'tension_pulse_01',
    'atmospheric': 'ambient_fog_01',
    'one_too_many': 'uncanny_drone_01',
  };

  const trackId = trackMap[vibePreset] || 'ambient_dark_01';

  console.log(`[MUSIC] Selected track: ${trackId} for vibe: ${vibePreset}`);

  // Update job meta
  await updateJobMeta(supabase, job.id, {
    music_track_id: trackId,
  });

  // Store asset
  await upsertAsset(supabase, job.id, idempotencyKey, 'music', '', null, {
    track_id: trackId,
    vibe_preset: vibePreset,
  });

  return { success: true, data: { track_id: trackId } };
}

// =====================================================
// STEP 6: IMAGE GENERATION
// Supports gpt-image-1 (cheapest), dall-e-2, and dall-e-3 (highest quality)
// =====================================================

// Image model configuration - can be overridden via job.meta.image_model or env
type ImageModel = 'gpt-image-1' | 'dall-e-2' | 'dall-e-3';
const DEFAULT_IMAGE_MODEL: ImageModel = 'gpt-image-1'; // Cheapest: ~$0.016/image at low quality

export async function executeImagesStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  // Load scene data
  const sceneAsset = await getAssetByKey(supabase, job.id, `${job.id}:scenes_subtitles`);
  if (!sceneAsset?.meta?.scenes) {
    return { success: false, error: 'No scene data found - run scenes step first' };
  }

  const scenes = sceneAsset.meta.scenes as Array<{
    index: number;
    text: string;
    keywords: string[];
  }>;

  const openaiKey = env.OPENAI_API_KEY;
  if (!openaiKey) {
    return { success: false, error: 'OPENAI_API_KEY not configured' };
  }

  const artStyle = (job.meta?.art_style as string) || 'cinematic-dark';
  const visualPreset = job.visual_preset || (job.meta?.visual_preset as string) || 'forest';
  
  // Determine which image model to use (job meta > env > default)
  const imageModel: ImageModel = (job.meta?.image_model as ImageModel) || 
                                  (env.IMAGE_MODEL as ImageModel) || 
                                  DEFAULT_IMAGE_MODEL;

  console.log(`[IMAGES] Generating ${scenes.length} images (model: ${imageModel}, style: ${artStyle})`);

  let generatedCount = 0;
  let skippedCount = 0;
  const scenesCompleted: number[] = [];

  try {
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const idempotencyKey = `${job.id}:image_generate:scene_${i}`;

      // Check if this scene image already exists
      const existingImage = await getAssetByKey(supabase, job.id, idempotencyKey);
      if (existingImage?.public_url) {
        console.log(`[IMAGES] Scene ${i} already generated, skipping`);
        skippedCount++;
        scenesCompleted.push(i);
        continue;
      }

      // Heartbeat before each image (they can be slow)
      await requireLeaseOwner(supabase, job.id, workerId, `images:scene_${i}`);

      // Build prompt (deterministic based on inputs)
      const scenePrompt = buildImagePrompt(scene.text, scene.keywords, artStyle, visualPreset);
      
      // === EXTERNAL IDEMPOTENCY: Hash includes model+size+prompt to avoid cross-config collisions ===
      // Note: imageModel is defined at function scope from job.meta or env
      // gpt-image-1: 1024x1536 portrait, dall-e-3: 1024x1792 portrait, dall-e-2: 1024x1024 square
      const imageSize = imageModel === 'gpt-image-1' ? '1024x1536' : 
                        imageModel === 'dall-e-3' ? '1024x1792' : '1024x1024';
      const imageQuality = 'standard';
      const canonicalImageInput = `${imageModel}|${imageSize}|${imageQuality}|${scenePrompt}`;
      const promptHash = await computeHash(canonicalImageInput);
      const promptHashKey = `${job.id}:image_prompt_hash:${promptHash}`;
      // Quality guard: only reuse if quality_ok !== false
      const existingPromptHash = await getAssetByKey(supabase, job.id, promptHashKey, true);
      if (existingPromptHash?.public_url) {
        console.log(`[IMAGES] Scene ${i} prompt hash match (billing protection), copying existing asset`);
        // Copy the existing asset to the scene key
        await upsertAsset(supabase, job.id, idempotencyKey, 'dalle_image', 
          existingPromptHash.storage_path, existingPromptHash.public_url, {
            scene_index: i,
            prompt: scenePrompt,
            prompt_hash: promptHash,
            art_style: artStyle,
            image_model: imageModel,
            copied_from: existingPromptHash.idempotency_key,
          });
        skippedCount++;
        scenesCompleted.push(i);
        continue;
      }

      // === RUNNING CHECKPOINT: Update step status with progress ===
      await updateStepStatus(supabase, job.id, 'images', 'running', {
        scenes_done: scenesCompleted,
        current_scene: i,
        total_scenes: scenes.length,
        progress_pct: Math.round((scenesCompleted.length / scenes.length) * 100),
        image_model: imageModel,
      });

      // Log progress event
      await logger.progress('images', i + 1, scenes.length, 
        `scene ${i + 1}/${scenes.length} generating (model=${imageModel}, ${imageSize})`,
        { model: imageModel, scene_index: i }
      );

      console.log(`[IMAGES] Generating scene ${i + 1}/${scenes.length} with ${imageModel} (hash: ${promptHash.slice(0, 8)}...)`);

      // Log prompt snapshot (first scene only to limit storage)
      if (i === 0) {
        await logger.snapshot('images', 'prompt', { 
          scene_index: i, 
          prompt: scenePrompt.slice(0, 800), 
          model: imageModel, 
          size: imageSize 
        }, 'First scene prompt (sample)');
      }

      // === LEASE GRACE CHECK: Verify enough time before expensive API call ===
      await requireLeaseGrace(supabase, job.id, workerId, `${imageModel} scene ${i}`);

      // Generate image using selected model
      let imageUrl: string;
      
      if (imageModel === 'gpt-image-1') {
        // === GPT-IMAGE-1 (Cheapest: ~$0.016/image at low quality) ===
        const response = await fetchWithError(
          'https://api.openai.com/v1/images/generations',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-image-1',
              prompt: scenePrompt,
              n: 1,
              size: '1024x1536', // Portrait format for vertical video
              quality: 'low',    // Cheapest option
              output_format: 'webp',
            }),
          },
          `gpt-image-1 scene ${i}`
        );

        const result = await response.json();
        // gpt-image-1 returns base64 by default
        if (result.data?.[0]?.b64_json) {
          imageUrl = `data:image/webp;base64,${result.data[0].b64_json}`;
        } else if (result.data?.[0]?.url) {
          imageUrl = result.data[0].url;
        } else {
          throw new Error(`gpt-image-1 returned no image for scene ${i}`);
        }
      } else if (imageModel === 'dall-e-2') {
        // === DALL-E 2 IMAGE GENERATION (Cheaper) ===
        const response = await fetchWithError(
          'https://api.openai.com/v1/images/generations',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'dall-e-2',
              prompt: scenePrompt,
              n: 1,
              size: '1024x1024', // DALL-E 2 square format
            }),
          },
          `DALL-E 2 scene ${i}`
        );

        const result = await response.json();
        imageUrl = result.data?.[0]?.url;
        
        if (!imageUrl) {
          throw new Error(`DALL-E 2 returned no image for scene ${i}`);
        }
      } else {
        // === DALL-E 3 IMAGE GENERATION (Higher quality) ===
        const response = await fetchWithError(
          'https://api.openai.com/v1/images/generations',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'dall-e-3',
              prompt: scenePrompt,
              n: 1,
              size: '1024x1792', // Portrait 9:16 for DALL-E 3
              quality: 'standard',
              response_format: 'url',
            }),
          },
          `DALL-E 3 scene ${i}`
        );

        const result = await response.json();
        imageUrl = result.data?.[0]?.url;

        if (!imageUrl) {
          throw new Error(`DALL-E 3 returned no image for scene ${i}`);
        }
      }

      // Upload to storage (using standardized path)
      const storagePath = pathForImage(job.brand_id, job.id, i);
      const publicUrl = await uploadRemoteToStorage(
        supabase,
        STORAGE_BUCKET,
        storagePath,
        imageUrl
      );

      // Store asset with scene key
      await upsertAsset(supabase, job.id, idempotencyKey, 'dalle_image', storagePath, publicUrl, {
        scene_index: i,
        prompt: scenePrompt,
        prompt_hash: promptHash,
        art_style: artStyle,
        image_model: imageModel,
      });
      
      // Also store asset with prompt hash key (for external idempotency)
      await upsertAsset(supabase, job.id, promptHashKey, 'dalle_image', storagePath, publicUrl, {
        scene_index: i,
        prompt: scenePrompt,
        prompt_hash: promptHash,
        art_style: artStyle,
        image_model: imageModel,
      });

      generatedCount++;
      scenesCompleted.push(i);
      console.log(`[IMAGES] ✓ Scene ${i + 1} uploaded (${imageModel}): ${publicUrl}`);
    }

    // Update job meta with image URLs
    const allImageAssets = await getAssetsByPrefix(supabase, job.id, `${job.id}:image_generate:`);
    const imageUrls = allImageAssets
      .sort((a, b) => {
        const aIdx = parseInt(a.idempotency_key.split('scene_')[1] || '0');
        const bIdx = parseInt(b.idempotency_key.split('scene_')[1] || '0');
        return aIdx - bIdx;
      })
      .map(a => a.public_url)
      .filter(Boolean);

    await updateJobMeta(supabase, job.id, {
      image_urls: imageUrls,
      image_model: imageModel,
    });

    console.log(`[IMAGES] ✓ Complete: ${generatedCount} generated, ${skippedCount} skipped`);
    return { success: true, data: { generated: generatedCount, skipped: skippedCount, total: scenes.length } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[IMAGES] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Build a DALL-E prompt for a scene
 */
function buildImagePrompt(
  sceneText: string,
  keywords: string[],
  artStyle: string,
  visualPreset: string
): string {
  // Base style templates
  const styleTemplates: Record<string, string> = {
    'cinematic-dark': 'Cinematic dark photography, moody desaturated colors, deep shadows, film grain, A24 horror aesthetic.',
    'analog-horror': 'Analog horror VHS aesthetic, heavy static, glitch artifacts, scanlines, found footage style.',
    'uncanny-illustrated': 'Editorial cartoon illustration, cel-shaded horror, bold black ink outlines, flat colors, uncanny faces.',
  };

  const styleBase = styleTemplates[artStyle] || styleTemplates['cinematic-dark'];

  // Environment hints
  const envHints: Record<string, string> = {
    'forest': 'dark misty forest, twisted trees',
    'hallway': 'abandoned corridor, peeling walls',
    'attic': 'dusty attic, cobwebs, old furniture',
    'urban': 'empty city streets at night',
  };

  const envHint = envHints[visualPreset] || envHints['forest'];

  // Compose prompt
  const keywordStr = keywords.slice(0, 3).join(', ');
  const prompt = `${styleBase} Scene: ${sceneText.substring(0, 200)}. Environment: ${envHint}. Keywords: ${keywordStr}. Portrait orientation 9:16. No text, no words, no letters.`;

  return prompt;
}

// =====================================================
// STEP 7: SUBTITLE GENERATION
// =====================================================

export async function executeSubtitlesStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:subtitle_generation`;

  // Check if already done
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.public_url) {
    console.log(`[SUBTITLES] Already generated: ${existingAsset.public_url}`);
    return { success: true, skipped: true, data: { subtitle_url: existingAsset.public_url } };
  }

  // Get subtitle cues from scene data or audio timestamps
  let subtitleCues: Array<{ start: number; end: number; text: string }> = [];

  // First try audio timestamps (most accurate)
  if (job.meta?.audio_timestamps) {
    subtitleCues = job.meta.audio_timestamps as typeof subtitleCues;
  } else {
    // Fall back to scene data
    const sceneAsset = await getAssetByKey(supabase, job.id, `${job.id}:scenes_subtitles`);
    if (sceneAsset?.meta?.subtitle_cues) {
      subtitleCues = sceneAsset.meta.subtitle_cues as typeof subtitleCues;
    }
  }

  if (subtitleCues.length === 0) {
    console.log(`[SUBTITLES] No subtitle cues available, skipping`);
    return { success: true, skipped: true, data: { reason: 'no_cues' } };
  }

  console.log(`[SUBTITLES] Generating SRT from ${subtitleCues.length} cues`);

  try {
    // Generate SRT content
    let srtContent = '';
    for (let i = 0; i < subtitleCues.length; i++) {
      const cue = subtitleCues[i];
      const startTime = formatSrtTime(cue.start);
      const endTime = formatSrtTime(cue.end);
      srtContent += `${i + 1}\n${startTime} --> ${endTime}\n${cue.text}\n\n`;
    }

    // Upload to storage (using standardized path)
    const storagePath = pathForSubtitles(job.brand_id, job.id);
    const publicUrl = await uploadToStorage(
      supabase,
      STORAGE_BUCKET,
      storagePath,
      srtContent,
      'text/srt'
    );

    // Store asset
    await upsertAsset(supabase, job.id, idempotencyKey, 'subtitles', storagePath, publicUrl, {
      cue_count: subtitleCues.length,
      format: 'srt',
    });

    // Update job meta
    await updateJobMeta(supabase, job.id, {
      subtitle_url: publicUrl,
    });

    console.log(`[SUBTITLES] ✓ Generated SRT with ${subtitleCues.length} cues`);
    return { success: true, data: { subtitle_url: publicUrl, cue_count: subtitleCues.length } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[SUBTITLES] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Format seconds to SRT timestamp (HH:MM:SS,mmm)
 */
function formatSrtTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
}

// =====================================================
// STEP 8: VIDEO ASSEMBLY
// =====================================================

export async function executeAssembleStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:video_assemble`;

  // Check if already done
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.public_url) {
    console.log(`[ASSEMBLE] Already assembled: ${existingAsset.public_url}`);
    return { success: true, skipped: true, data: { video_url: existingAsset.public_url } };
  }

  // Support both VIDEO_RENDERER_URL and FFMPEG_RENDERER_URL (run-job uses FFMPEG_RENDERER_URL)
  const videoRendererUrl = env.VIDEO_RENDERER_URL || env.FFMPEG_RENDERER_URL;
  const creatomateKey = env.CREATOMATE_API_KEY;

  console.log(`[ASSEMBLE] Env check: VIDEO_RENDERER_URL=${env.VIDEO_RENDERER_URL ? 'SET' : 'UNSET'}, FFMPEG_RENDERER_URL=${env.FFMPEG_RENDERER_URL ? 'SET' : 'UNSET'}, CREATOMATE_API_KEY=${creatomateKey ? 'SET' : 'UNSET'}`);
  console.log(`[ASSEMBLE] Will use: ${videoRendererUrl ? 'FFmpeg @ ' + videoRendererUrl : (creatomateKey ? 'Creatomate' : 'NONE!')}`);

  // Gather required assets
  const audioAsset = await getAssetByKey(supabase, job.id, `${job.id}:voice_synthesis`);
  if (!audioAsset?.public_url) {
    return { success: false, error: 'No audio asset found - run voice step first' };
  }

  const imageAssets = await getAssetsByPrefix(supabase, job.id, `${job.id}:image_generate:`);
  if (imageAssets.length === 0) {
    return { success: false, error: 'No image assets found - run images step first' };
  }

  const imageUrls = imageAssets
    .sort((a, b) => {
      const aIdx = parseInt(a.idempotency_key.split('scene_')[1] || '0');
      const bIdx = parseInt(b.idempotency_key.split('scene_')[1] || '0');
      return aIdx - bIdx;
    })
    .map(a => a.public_url)
    .filter(Boolean) as string[];

  const audioUrl = audioAsset.public_url;
  
  // Handle duration - can be number or object {minSeconds, maxSeconds}
  let duration: number;
  const rawDuration = job.meta?.duration;
  if (typeof rawDuration === 'number') {
    duration = rawDuration;
  } else if (rawDuration && typeof rawDuration === 'object') {
    const durObj = rawDuration as { minSeconds?: number; maxSeconds?: number };
    const minSec = durObj.minSeconds || 60;
    const maxSec = durObj.maxSeconds || 90;
    duration = Math.round((minSec + maxSec) / 2);
  } else {
    duration = 60; // Default
  }

  console.log(`[ASSEMBLE] Assembling video: ${imageUrls.length} images, ${duration}s duration`);

  try {
    let videoUrl: string;

    // === LEASE GRACE CHECK: Verify enough time before expensive rendering ===
    await requireLeaseGrace(supabase, job.id, workerId, 'video assembly');

    // Prefer VIDEO_RENDERER_URL if available
    if (videoRendererUrl) {
      console.log(`[ASSEMBLE] Using video-renderer at ${videoRendererUrl}`);
      
      // Snapshot the assembly input before rendering
      await logger.snapshot('assemble', 'payload', {
        renderer: 'ffmpeg',
        image_count: imageUrls.length,
        audio_url: audioUrl.slice(0, 100),
        duration: duration,
        has_music: !!job.meta?.music_url,
      }, 'Video assembly input');

      videoUrl = await assembleWithRenderer(
        videoRendererUrl,
        job.id,
        imageUrls,
        audioUrl,
        duration,
        job.meta
      );
    } else if (creatomateKey) {
      console.log(`[ASSEMBLE] Using Creatomate`);
      videoUrl = await assembleWithCreatomate(
        creatomateKey,
        job.id,
        imageUrls,
        audioUrl,
        duration,
        job.meta
      );
    } else {
      return { success: false, error: 'No video assembly service configured (CREATOMATE_API_KEY or VIDEO_RENDERER_URL)' };
    }

    // Store asset
    await upsertAsset(supabase, job.id, idempotencyKey, 'final_mp4', '', videoUrl, {
      image_count: imageUrls.length,
      duration: duration,
      assembly_method: videoRendererUrl ? 'video-renderer' : 'creatomate',
    });

    // Snapshot assembly output
    await logger.snapshot('assemble', 'output', {
      video_url: videoUrl.slice(0, 200),
      method: videoRendererUrl ? 'ffmpeg' : 'creatomate',
      image_count: imageUrls.length,
      duration: duration,
    }, 'Final video assembled');

    console.log(`[ASSEMBLE] ✓ Video assembled: ${videoUrl}`);
    return { success: true, data: { video_url: videoUrl } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ASSEMBLE] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Assemble video using video-renderer service (FFmpeg)
 * The renderer is async - we start a job, then poll for completion
 */
async function assembleWithRenderer(
  rendererUrl: string,
  jobId: string,
  imageUrls: string[],
  audioUrl: string,
  duration: number,
  meta: Record<string, unknown>
): Promise<string> {
  // Calculate durations per scene (equal distribution)
  const sceneDuration = duration / imageUrls.length;
  const durations = imageUrls.map(() => sceneDuration);

  // Start the render job
  const response = await fetchWithError(
    `${rendererUrl}/render`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        images: imageUrls,
        audio_url: audioUrl,
        durations: durations,
        captions: [], // Captions handled separately
        effects: {
          kenBurns: true,
          fadeTransitions: true,
          fadeIn: true,
          fadeOut: true,
          filmGrain: true,
          vignette: true,
          horrorGrade: true,
          captionStyle: 'bold',
        },
        music_url: meta?.music_url as string || null,
        music_volume: 15,
        low_memory: true, // Safe for cloud deployment
      }),
    },
    'Video renderer'
  );

  const startResult = await response.json();
  const renderJobId = startResult.job_id;
  
  if (!renderJobId) {
    throw new Error('Video renderer did not return a job_id');
  }

  console.log(`[ASSEMBLE] Render job started: ${renderJobId}, polling for completion...`);

  // Poll for completion (max 5 minutes)
  const maxWaitMs = 5 * 60 * 1000;
  const pollIntervalMs = 5000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));

    try {
      const statusResponse = await fetch(`${rendererUrl}/status/${renderJobId}`);
      if (!statusResponse.ok) {
        console.log(`[ASSEMBLE] Status check returned ${statusResponse.status}, retrying...`);
        continue;
      }

      const statusData = await statusResponse.json();
      console.log(`[ASSEMBLE] Render status: ${statusData.status}, progress: ${statusData.progress || 0}%`);

      if (statusData.status === 'complete' || statusData.status === 'succeeded') {
        // Prefer supabase_url (permanent) over local URL
        const videoUrl = statusData.supabase_url || (statusData.url ? `${rendererUrl}${statusData.url}` : null);
        if (!videoUrl) {
          throw new Error('Render complete but no video URL returned');
        }
        console.log(`[ASSEMBLE] ✓ Video ready: ${videoUrl}`);
        return videoUrl;
      }

      if (statusData.status === 'failed') {
        throw new Error(`Video render failed: ${statusData.error || 'Unknown error'}`);
      }

      // Still processing, continue polling
    } catch (pollError) {
      console.log(`[ASSEMBLE] Poll error: ${pollError instanceof Error ? pollError.message : pollError}`);
      // Continue polling on transient errors
    }
  }

  throw new Error(`Video render timed out after ${maxWaitMs / 1000}s`);
}

/**
 * Assemble video using Creatomate
 */
async function assembleWithCreatomate(
  creatomateKey: string,
  jobId: string,
  imageUrls: string[],
  audioUrl: string,
  duration: number,
  meta: Record<string, unknown>
): Promise<string> {
  const sceneDuration = duration / imageUrls.length;

  // Build Creatomate source
  const elements: unknown[] = [];

  // Background images
  for (let i = 0; i < imageUrls.length; i++) {
    elements.push({
      type: 'image',
      source: imageUrls[i],
      time: i * sceneDuration,
      duration: sceneDuration + 0.5, // Overlap for transitions
      fit: 'cover',
      animations: [
        {
          type: 'scale',
          start_scale: '100%',
          end_scale: '115%',
          easing: 'linear',
        },
      ],
    });
  }

  // Audio
  elements.push({
    type: 'audio',
    source: audioUrl,
    volume: '100%',
  });

  const source = {
    output_format: 'mp4',
    width: 1080,
    height: 1920,
    frame_rate: 30,
    duration: duration,
    elements: elements,
  };

  // Start render
  const response = await fetchWithError(
    'https://api.creatomate.com/v1/renders',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creatomateKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source }),
    },
    'Creatomate render start'
  );

  const renderJob = await response.json();
  const renderId = renderJob[0]?.id;

  if (!renderId) {
    throw new Error('Creatomate returned no render ID');
  }

  // Poll for completion
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes max

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second poll

    const statusResponse = await fetchWithError(
      `https://api.creatomate.com/v1/renders/${renderId}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${creatomateKey}` },
      },
      'Creatomate status check'
    );

    const status = await statusResponse.json();

    if (status.status === 'succeeded') {
      return status.url;
    }

    if (status.status === 'failed') {
      throw new Error(`Creatomate render failed: ${status.error_message || 'Unknown error'}`);
    }

    attempts++;
  }

  throw new Error('Creatomate render timed out');
}

// =====================================================
// STEP 9: UPLOAD TO STORAGE
// =====================================================

export async function executeUploadStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:upload_storage`;

  // Check if already done
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.public_url) {
    console.log(`[UPLOAD] Already uploaded: ${existingAsset.public_url}`);
    return { success: true, skipped: true, data: { video_url: existingAsset.public_url } };
  }

  // Check if job already has video_url set
  if (job.video_url) {
    console.log(`[UPLOAD] Job already has video_url: ${job.video_url}`);
    await upsertAsset(supabase, job.id, idempotencyKey, 'final_mp4', '', job.video_url, {
      source: 'existing_job_video_url'
    });
    return { success: true, skipped: true, data: { video_url: job.video_url } };
  }

  // Get assembled video
  const videoAsset = await getAssetByKey(supabase, job.id, `${job.id}:video_assemble`);
  if (!videoAsset?.public_url) {
    return { success: false, error: 'No assembled video found - run assemble step first' };
  }

  const sourceVideoUrl = videoAsset.public_url;
  console.log(`[UPLOAD] Uploading video to permanent storage`);

  try {
    // Upload to permanent storage location (using standardized path)
    const storagePath = pathForFinalVideo(job.brand_id, job.id);
    const publicUrl = await uploadRemoteToStorage(
      supabase,
      STORAGE_BUCKET,
      storagePath,
      sourceVideoUrl
    );

    // Update job.video_url
    await updateJobFields(supabase, job.id, {
      video_url: publicUrl,
    });

    // Store asset
    await upsertAsset(supabase, job.id, idempotencyKey, 'final_mp4', storagePath, publicUrl, {
      source_url: sourceVideoUrl,
      uploaded_at: new Date().toISOString(),
    });

    // Snapshot final output
    await logger.snapshot('upload', 'output', {
      video_url: publicUrl,
      storage_path: storagePath,
      source: sourceVideoUrl.slice(0, 100),
    }, 'Final video uploaded to storage');

    console.log(`[UPLOAD] ✓ Video uploaded: ${publicUrl}`);
    return { success: true, data: { video_url: publicUrl } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[UPLOAD] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// =====================================================
// STEP 10: SCHEDULE POST
// =====================================================

export async function executeScheduleStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:schedule_post`;

  // Check if already done
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.meta?.scheduled) {
    console.log(`[SCHEDULE] Already scheduled`);
    return { success: true, skipped: true, data: existingAsset.meta as Record<string, unknown> };
  }

  // Refresh job to get latest video_url
  const freshJob = await loadJob(supabase, job.id);
  if (!freshJob) {
    return { success: false, error: 'Could not reload job for scheduling' };
  }

  if (!freshJob.video_url) {
    return { success: false, error: 'No video_url set on job - upload step may have failed' };
  }

  if (!freshJob.brand_id) {
    return { success: false, error: 'No brand_id on job' };
  }

  // Determine platforms
  const platforms = (freshJob.meta?.platforms as string[]) || ['tiktok'];
  
  // Determine scheduled time
  const scheduledAt = freshJob.scheduled_post_at
    ? new Date(freshJob.scheduled_post_at)
    : new Date(Date.now() + 24 * 60 * 60 * 1000); // Default: 24 hours from now

  console.log(`[SCHEDULE] Scheduling post for ${platforms.length} platforms at ${scheduledAt.toISOString()}`);

  const results: Record<string, { post_id: string | null; was_inserted: boolean; error?: string }> = {};

  try {
    for (const platform of platforms) {
      // Call idempotent RPC
      const { data, error } = await supabase.rpc('schedule_post_idempotent', {
        p_job_id: freshJob.id,
        p_brand_id: freshJob.brand_id,
        p_platform: platform,
        p_scheduled_at: scheduledAt.toISOString(),
        p_video_url: freshJob.video_url,
        p_title: freshJob.title,
        p_description: null,
        p_tags: null,
        p_meta: { source: 'worker-v1', vibe_preset: freshJob.vibe_preset }
      });

      if (error) {
        console.error(`[SCHEDULE] RPC error for ${platform}: ${error.message}`);
        results[platform] = { post_id: null, was_inserted: false, error: error.message };
        continue;
      }

      const result = Array.isArray(data) ? data[0] : data;
      results[platform] = {
        post_id: result?.post_id,
        was_inserted: result?.was_inserted ?? false,
      };

      if (result?.was_inserted) {
        console.log(`[SCHEDULE] ✓ Created post for ${platform}: ${result.post_id}`);
      } else {
        console.log(`[SCHEDULE] Post already exists for ${platform}: ${result?.post_id}`);
      }
    }

    // Store asset - using story_json type for schedule data
    await upsertAsset(supabase, job.id, idempotencyKey, 'story_json', '', null, {
      asset_subtype: 'post_schedule',
      scheduled: true,
      scheduled_at: scheduledAt.toISOString(),
      platforms: platforms,
      results: results,
    });

    // Check if any platform failed
    const failures = Object.entries(results).filter(([_, r]) => r.error);
    if (failures.length === platforms.length) {
      return { success: false, error: `All platforms failed: ${failures.map(([p, r]) => `${p}: ${r.error}`).join(', ')}` };
    }

    // Snapshot schedule results
    await logger.snapshot('schedule', 'output', {
      scheduled_at: scheduledAt.toISOString(),
      platforms: platforms,
      successes: platforms.length - failures.length,
      failures: failures.length,
      post_ids: Object.entries(results).filter(([_, r]) => r.post_id).map(([p, r]) => ({ platform: p, post_id: r.post_id })),
    }, 'Posts scheduled');

    console.log(`[SCHEDULE] ✓ Scheduled for ${platforms.length - failures.length}/${platforms.length} platforms`);
    return { success: true, data: { scheduled_at: scheduledAt.toISOString(), platforms: platforms, results: results } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[SCHEDULE] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}
