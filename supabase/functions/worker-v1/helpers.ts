// =====================================================
// WORKER V1 HELPERS
// Idempotency, lease management, and utility functions
// v1.0 - 2026-02-20
// =====================================================

import { SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

// =====================================================
// TYPES
// =====================================================

export interface Job {
  id: string;
  brand_id: string;
  batch_id: string | null;
  status: string;
  title: string | null;
  story_text: string | null;
  video_url: string | null;
  scheduled_post_at: string | null;
  current_step: string | null;
  attempt_count: number;
  vibe_preset: string | null;
  length_preset: string | null;
  visual_preset: string | null;
  meta: Record<string, unknown>;
}

export interface StepResult {
  success: boolean;
  skipped?: boolean;
  continuation_needed?: boolean;  // Time budget exhausted, re-invoke to continue
  requeue?: boolean;              // Renderer busy — release job back to queued for next cycle
  error?: string;
  statusCode?: number;  // HTTP status code if applicable (for error classification)
  elapsed_ms?: number;  // Step execution duration in milliseconds
  data?: Record<string, unknown>;
}

// Wall-clock budget for the entire Edge Function invocation (Supabase limit = 400s on paid)
// Leave 60s buffer for cleanup, self-re-invocation, and overhead
export const WALL_CLOCK_BUDGET_MS = 340_000; // 340 seconds
// Minimum time needed to generate + upload one image (be conservative)
// Also serves as reserve for the assembly step to submit a render + return continuation
export const IMAGE_RESERVE_MS = 90_000; // 90 seconds (was 30s — caused assembly timeout)

export interface AssetRecord {
  id: string;
  job_id: string;
  type: string;
  idempotency_key: string;
  storage_path: string;
  public_url: string | null;
  meta: Record<string, unknown>;
}

export interface HeartbeatResult {
  success: boolean;
  error_message?: string;
}

// =====================================================
// CONSTANTS
// =====================================================

export const DEFAULT_LEASE_SECONDS = 900; // 15 minutes

// ElevenLabs voice ID
export const ELEVENLABS_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam

// OpenAI TTS config
export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
export const OPENAI_TTS_VOICE = "ash"; // Deep/warm — good for horror narration
export const OPENAI_TTS_INSTRUCTIONS = "Speak in a dark, atmospheric, storytelling tone. Pace yourself deliberately, with measured pauses for tension. This is horror narration.";

// Preset-specific voice configurations for OpenAI TTS
// Different presets benefit from different voice timbres and delivery styles
// Now supports brand-level overrides from config_overrides.voice
export function getPresetVoiceConfig(vibePreset: string, brandVoiceConfig?: { voice?: string; instructions?: string; speed?: number } | null): { voice: string; instructions: string; speed?: number } {
  // Brand-level override takes priority
  if (brandVoiceConfig && (brandVoiceConfig.voice || brandVoiceConfig.instructions)) {
    return {
      voice: brandVoiceConfig.voice || OPENAI_TTS_VOICE,
      instructions: brandVoiceConfig.instructions || OPENAI_TTS_INSTRUCTIONS,
      ...(brandVoiceConfig.speed && brandVoiceConfig.speed !== 1.0 ? { speed: brandVoiceConfig.speed } : {}),
    };
  }

  // Preset-specific defaults
  if (vibePreset === 'dark_origins') {
    return {
      voice: 'onyx', // Deep, authoritative — perfect for documentary narration
      instructions: 'Speak as a calm, authoritative true crime documentary narrator. Deliver facts with measured gravitas, like the host of Dateline or Investigation Discovery. Pace yourself slowly and deliberately with firm pauses between key revelations. Let shocking facts land with silence after them. This is not fiction narration — this is documentary presentation of disturbing historical events. Channel the energy of Keith Morrison or Peter Thomas.',
    };
  }
  return {
    voice: OPENAI_TTS_VOICE,
    instructions: OPENAI_TTS_INSTRUCTIONS,
  };
}

// TTS Provider type
export type TtsProvider = 'openai' | 'elevenlabs';

// Storage bucket name
export const STORAGE_BUCKET = 'story-videos';

// Step progress mapping (approximate percentages)
export const STEP_PROGRESS: Record<string, number> = {
  story: 10,
  uniqueness: 15,
  scenes: 20,
  voice: 35,
  music: 40,
  images: 70,
  subtitles: 75,
  assemble: 90,
  upload: 95,
  schedule: 100,
};

// =====================================================
// STORAGE PATH BUILDERS
// Canonical path convention: brands/{brand_id}/jobs/{job_id}/{category}/{file}
// See: docs/ASSET_NAMING_CONVENTION.md
// =====================================================

/**
 * Build storage path for a scene image
 * @param brandId Brand UUID
 * @param jobId Job UUID
 * @param sceneIndex Zero-based scene index
 * @returns Path like "brands/abc/jobs/xyz/images/scene_000.png"
 */
export function pathForImage(brandId: string, jobId: string, sceneIndex: number): string {
  const paddedIndex = sceneIndex.toString().padStart(3, '0');
  return `brands/${brandId}/jobs/${jobId}/images/scene_${paddedIndex}.png`;
}

/**
 * Build storage path for narration audio
 * @returns Path like "brands/abc/jobs/xyz/audio/narration.mp3"
 */
export function pathForAudio(brandId: string, jobId: string): string {
  return `brands/${brandId}/jobs/${jobId}/audio/narration.mp3`;
}

/**
 * Build storage path for subtitle file
 * @returns Path like "brands/abc/jobs/xyz/subtitles/captions.srt"
 */
export function pathForSubtitles(brandId: string, jobId: string): string {
  return `brands/${brandId}/jobs/${jobId}/subtitles/captions.srt`;
}

/**
 * Build storage path for assembled video (from renderer)
 * @returns Path like "brands/abc/jobs/xyz/video/assembled.mp4"
 */
export function pathForAssembledVideo(brandId: string, jobId: string): string {
  return `brands/${brandId}/jobs/${jobId}/video/assembled.mp4`;
}

/**
 * Build storage path for final uploaded video
 * @returns Path like "brands/abc/jobs/xyz/video/final.mp4"
 */
export function pathForFinalVideo(brandId: string, jobId: string): string {
  return `brands/${brandId}/jobs/${jobId}/video/final.mp4`;
}

/**
 * Build storage path for brand-level music track
 * @returns Path like "brands/abc/music/ambient_dark_01.mp3"
 */
export function pathForBrandMusic(brandId: string, trackId: string): string {
  return `brands/${brandId}/music/${trackId}.mp3`;
}

/**
 * Build storage path for per-job music copy (cached for renderer)
 * @returns Path like "brands/abc/jobs/xyz/audio/music.mp3"
 */
export function pathForJobMusic(brandId: string, jobId: string): string {
  return `brands/${brandId}/jobs/${jobId}/audio/music.mp3`;
}

/**
 * Build storage path for brand-level gameplay clip
 * @returns Path like "brands/abc/gameplay/minecraft_01.mp4"
 */
export function pathForBrandGameplay(brandId: string, clipId: string): string {
  return `brands/${brandId}/gameplay/${clipId}.mp4`;
}

// =====================================================
// TELEMETRY LOGGING
// Structured logs for debugging and monitoring
// =====================================================

interface StepTelemetry {
  job_id: string;
  step: string;
  status: 'running' | 'complete' | 'failed' | 'skipped';
  worker_id?: string;
  duration_ms?: number;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Log structured telemetry for step events
 * Makes debugging 10x easier by providing consistent, parseable logs
 */
export function logStepTelemetry(telemetry: StepTelemetry): void {
  const timestamp = new Date().toISOString();
  const emoji = telemetry.status === 'complete' ? '✓' :
                telemetry.status === 'failed' ? '✗' :
                telemetry.status === 'skipped' ? '⊘' : '▶';
  
  // Structured JSON log line (for log aggregation)
  const logLine = JSON.stringify({
    ts: timestamp,
    ...telemetry,
  });
  
  // Human-readable log (for console viewing)
  const humanLog = `[STEP:${telemetry.step}] ${emoji} ${telemetry.status.toUpperCase()}` +
    (telemetry.duration_ms ? ` (${telemetry.duration_ms}ms)` : '') +
    (telemetry.error ? ` - ${telemetry.error}` : '');
  
  console.log(humanLog);
  console.log(`[TELEMETRY] ${logLine}`);
}

/**
 * Wrapper to execute a step with telemetry logging
 */
export async function executeWithTelemetry<T>(
  jobId: string,
  stepName: string,
  workerId: string,
  stepFn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  
  logStepTelemetry({
    job_id: jobId,
    step: stepName,
    status: 'running',
    worker_id: workerId,
  });
  
  try {
    const result = await stepFn();
    const duration = Date.now() - startTime;
    
    // Check if result has skipped property (for StepResult)
    const status = (result as Record<string, unknown>)?.skipped ? 'skipped' : 'complete';
    
    logStepTelemetry({
      job_id: jobId,
      step: stepName,
      status: status,
      worker_id: workerId,
      duration_ms: duration,
    });
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    logStepTelemetry({
      job_id: jobId,
      step: stepName,
      status: 'failed',
      worker_id: workerId,
      duration_ms: duration,
      error: errorMsg,
    });
    
    throw error;
  }
}

// =====================================================
// LEASE MANAGEMENT
// =====================================================

/**
 * Heartbeat to extend lease. Returns success status.
 * CRITICAL: If this fails, we must STOP processing to avoid conflicts.
 */
export async function heartbeatJob(
  supabase: SupabaseClient,
  jobId: string,
  workerId: string,
  progress?: number,
  newStatus?: string
): Promise<HeartbeatResult> {
  const { data, error } = await supabase.rpc('heartbeat_job', {
    p_job_id: jobId,
    p_locked_by: workerId,
    p_lease_seconds: DEFAULT_LEASE_SECONDS,
    p_progress: progress ?? null,
    p_new_status: newStatus ?? 'generating'
  });

  if (error) {
    console.error(`[HEARTBEAT] RPC error: ${error.message}`);
    return { success: false, error_message: error.message };
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.success) {
    console.error(`[HEARTBEAT] Failed: ${result?.error_message}`);
    return { success: false, error_message: result?.error_message || 'Heartbeat rejected' };
  }

  return { success: true };
}

/**
 * Check if we still own the lease. Throws if not.
 * Use this before long operations.
 */
export async function requireLeaseOwner(
  supabase: SupabaseClient,
  jobId: string,
  workerId: string,
  stepName: string
): Promise<void> {
  const result = await heartbeatJob(supabase, jobId, workerId);
  if (!result.success) {
    throw new Error(`Lost lease ownership during ${stepName}: ${result.error_message}`);
  }
  console.log(`[LEASE] ✓ Lease confirmed for step ${stepName}`);
}

// Minimum seconds of lease remaining before making expensive external calls
const LEASE_GRACE_SECONDS = 30;

/**
 * Check if we have enough lease time remaining before an expensive operation.
 * Returns true if safe to proceed, false if lease is expiring soon.
 * 
 * This prevents "lost lease but still burning money" scenarios where:
 * - Worker loses lease mid-API-call
 * - Another worker picks up and starts from beginning
 * - Original call completes but result is orphaned
 * 
 * Usage: Before DALL-E, ElevenLabs, or video renderer calls
 */
export async function checkLeaseGrace(
  supabase: SupabaseClient,
  jobId: string,
  workerId: string,
  operationName: string
): Promise<{ safe: boolean; remainingSeconds?: number; error?: string }> {
  const { data, error } = await supabase
    .from('jobs')
    .select('locked_by, lease_expires_at')
    .eq('id', jobId)
    .single();

  if (error || !data) {
    return { safe: false, error: `Failed to check lease: ${error?.message || 'Job not found'}` };
  }

  // Check ownership
  if (data.locked_by !== workerId) {
    return { safe: false, error: `Lease owned by ${data.locked_by}, not ${workerId}` };
  }

  // Check time remaining
  const expiresAt = new Date(data.lease_expires_at).getTime();
  const now = Date.now();
  const remainingSeconds = Math.floor((expiresAt - now) / 1000);

  if (remainingSeconds < LEASE_GRACE_SECONDS) {
    console.warn(`[LEASE] ⚠️ Only ${remainingSeconds}s remaining before ${operationName}, need ${LEASE_GRACE_SECONDS}s`);
    return { safe: false, remainingSeconds, error: `Insufficient lease time (${remainingSeconds}s < ${LEASE_GRACE_SECONDS}s)` };
  }

  console.log(`[LEASE] ✓ ${remainingSeconds}s remaining, safe to proceed with ${operationName}`);
  return { safe: true, remainingSeconds };
}

/**
 * Require lease grace before expensive operation. Throws if unsafe.
 * 
 * @param refreshLease If true, attempt to extend lease first (recommended)
 */
export async function requireLeaseGrace(
  supabase: SupabaseClient,
  jobId: string,
  workerId: string,
  operationName: string,
  refreshLease: boolean = true
): Promise<void> {
  // Optionally refresh lease first
  if (refreshLease) {
    const heartbeat = await heartbeatJob(supabase, jobId, workerId);
    if (!heartbeat.success) {
      throw new Error(`Lost lease before ${operationName}: ${heartbeat.error_message}`);
    }
  }

  // Then check grace period
  const check = await checkLeaseGrace(supabase, jobId, workerId, operationName);
  if (!check.safe) {
    throw new Error(`Aborting ${operationName}: ${check.error} (retryable)`);
  }
}

// =====================================================
// FINALIZATION BARRIER
// Verify all required assets before marking job complete
// =====================================================

export interface FinalizationResult {
  ready: boolean;
  missing: string[];
  warnings: string[];
}

/**
 * Verify all required assets exist before releasing job as 'complete'.
 * 
 * Checks:
 * 1. Voice audio exists and quality_ok
 * 2. All scene images exist and quality_ok
 * 3. Subtitles SRT exists
 * 4. Final video exists (video_url populated)
 * 5. Posts scheduled for requested platforms
 * 
 * This prevents "complete" jobs missing something due to silent partial failures.
 */
export async function verifyJobReadyForComplete(
  supabase: SupabaseClient,
  jobId: string
): Promise<FinalizationResult> {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Load job data
  const job = await loadJob(supabase, jobId);
  if (!job) {
    return { ready: false, missing: ['job_not_found'], warnings: [] };
  }

  // 1. Check voice audio
  const voiceAsset = await getAssetByKey(supabase, jobId, `${jobId}:voice_synthesis`);
  if (!voiceAsset?.public_url) {
    missing.push('voice_audio');
  } else if (voiceAsset.meta?.quality_ok === false) {
    missing.push('voice_audio_quality_bad');
  }

  // 2. Check scene images
  const sceneAsset = await getAssetByKey(supabase, jobId, `${jobId}:scenes_subtitles`);
  const expectedSceneCount = (sceneAsset?.meta?.scene_count as number) || 0;
  
  if (expectedSceneCount === 0) {
    missing.push('scenes_data');
  } else {
    const imageAssets = await getAssetsByPrefix(supabase, jobId, `${jobId}:image_generate:`);
    const goodImages = imageAssets.filter(a => a.public_url && a.meta?.quality_ok !== false);
    
    if (goodImages.length < expectedSceneCount) {
      missing.push(`images_incomplete:${goodImages.length}/${expectedSceneCount}`);
    }
  }

  // 3. Check subtitles
  const srtAsset = await getAssetByKey(supabase, jobId, `${jobId}:subtitle_generation`);
  if (!srtAsset?.public_url) {
    missing.push('subtitles_srt');
  }

  // 4. Check final video URL
  if (!job.video_url) {
    missing.push('video_url');
  }

  // 5. Check posts scheduled
  const { data: posts, error: postsError } = await supabase
    .from('posts')
    .select('platform, status')
    .eq('job_id', jobId);

  if (postsError) {
    warnings.push(`posts_query_error: ${postsError.message}`);
  } else if (!posts || posts.length === 0) {
    missing.push('no_posts_scheduled');
  } else {
    // Check for any failed posts
    const failedPosts = posts.filter(p => p.status === 'failed');
    if (failedPosts.length > 0) {
      warnings.push(`${failedPosts.length}_posts_failed`);
    }
  }

  const ready = missing.length === 0;
  
  if (!ready) {
    console.warn(`[FINALIZE] ✗ Job ${jobId} not ready: missing=[${missing.join(', ')}]`);
  } else {
    console.log(`[FINALIZE] ✓ Job ${jobId} ready for complete${warnings.length > 0 ? ` (warnings: ${warnings.join(', ')})` : ''}`);
  }

  return { ready, missing, warnings };
}

/**
 * Release the job with final status
 */
export async function releaseJob(
  supabase: SupabaseClient,
  jobId: string,
  workerId: string,
  finalStatus: string,
  errorMessage?: string,
  progress?: number
): Promise<void> {
  const { error } = await supabase.rpc('release_job', {
    p_job_id: jobId,
    p_locked_by: workerId,
    p_new_status: finalStatus,
    p_error: errorMessage ?? null,
    p_progress: progress ?? null
  });

  if (error) {
    console.error(`[RELEASE] RPC error: ${error.message}`);
    throw new Error(`Failed to release job: ${error.message}`);
  }

  console.log(`[RELEASE] Job ${jobId} released with status: ${finalStatus}`);
}

// =====================================================
// IDEMPOTENCY HELPERS
// =====================================================

/**
 * Get an asset by idempotency key. Returns null if not found.
 * 
 * @param requireQualityOk If true, only returns asset if meta.quality_ok !== false
 *                         This prevents reuse of known-bad artifacts (blurry images, etc.)
 */
export async function getAssetByKey(
  supabase: SupabaseClient,
  jobId: string,
  idempotencyKey: string,
  requireQualityOk: boolean = false
): Promise<AssetRecord | null> {
  const { data, error } = await supabase
    .from('job_assets')
    .select('*')
    .eq('job_id', jobId)
    .eq('idempotency_key', idempotencyKey)
    .single();

  if (error || !data) {
    return null;
  }

  // Quality guard: don't reuse assets marked as bad
  if (requireQualityOk && data.meta?.quality_ok === false) {
    console.log(`[ASSETS] Skipping asset ${idempotencyKey} - marked as quality_ok=false`);
    return null;
  }

  return data as AssetRecord;
}

/**
 * Upsert an asset with idempotency. Returns the asset ID and whether it was inserted.
 * Automatically adds quality_ok: true for new assets (can be updated later if bad).
 */
export async function upsertAsset(
  supabase: SupabaseClient,
  jobId: string,
  idempotencyKey: string,
  type: string,
  storagePath: string,
  publicUrl: string | null,
  meta: Record<string, unknown> = {}
): Promise<{ assetId: string; wasInserted: boolean }> {
  // Add quality_ok: true by default (can be overridden if explicitly passed)
  const enrichedMeta = {
    quality_ok: true,
    created_at: new Date().toISOString(),
    ...meta
  };

  const { data, error } = await supabase.rpc('upsert_job_asset', {
    p_job_id: jobId,
    p_idempotency_key: idempotencyKey,
    p_type: type,
    p_storage_path: storagePath,
    p_public_url: publicUrl,
    p_meta: enrichedMeta
  });

  if (error) {
    throw new Error(`upsert_job_asset failed: ${error.message}`);
  }

  const result = Array.isArray(data) ? data[0] : data;
  return {
    assetId: result?.asset_id,
    wasInserted: result?.was_inserted ?? false
  };
}

/**
 * Mark an asset as bad quality (prevents future reuse via hash lookup)
 */
export async function markAssetBadQuality(
  supabase: SupabaseClient,
  assetId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase
    .from('job_assets')
    .update({
      meta: supabase.rpc('jsonb_set', {
        target: (supabase as any).raw('meta'),
        path: '{quality_ok}',
        new_value: false
      })
    })
    .eq('id', assetId);

  // Simpler approach: fetch, modify, update
  const { data: asset } = await supabase
    .from('job_assets')
    .select('meta')
    .eq('id', assetId)
    .single();

  if (asset) {
    const updatedMeta = {
      ...asset.meta,
      quality_ok: false,
      quality_fail_reason: reason,
      quality_marked_at: new Date().toISOString()
    };

    await supabase
      .from('job_assets')
      .update({ meta: updatedMeta })
      .eq('id', assetId);

    console.log(`[ASSETS] Marked asset ${assetId} as bad quality: ${reason}`);
  }
}

/**
 * Check assets matching a prefix pattern
 */
export async function getAssetsByPrefix(
  supabase: SupabaseClient,
  jobId: string,
  prefix: string
): Promise<AssetRecord[]> {
  const { data, error } = await supabase
    .from('job_assets')
    .select('*')
    .eq('job_id', jobId)
    .like('idempotency_key', `${prefix}%`);

  if (error) {
    console.error(`[ASSETS] Error fetching by prefix: ${error.message}`);
    return [];
  }

  return (data || []) as AssetRecord[];
}

// =====================================================
// STEP STATUS MANAGEMENT
// =====================================================

/**
 * Get the status of a step from jobs.meta.steps
 */
export async function getStepStatus(
  supabase: SupabaseClient,
  jobId: string,
  stepName: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_step_status', {
    p_job_id: jobId,
    p_step_name: stepName
  });

  if (error || !data || data.length === 0) {
    return null;
  }

  return data[0]?.status ?? null;
}

/**
 * Update step status with optional metadata.
 * 
 * Automatically tracks:
 * - attempts: incremented on 'running' status
 * - last_error: set on 'failed' status
 * - last_error_at: timestamp when error occurred
 * 
 * This makes retries observable and enables "auto-cancel after N" logic.
 */
export async function updateStepStatus(
  supabase: SupabaseClient,
  jobId: string,
  stepName: string,
  status: string,
  meta: Record<string, unknown> = {}
): Promise<void> {
  const progress = STEP_PROGRESS[stepName] || 0;
  
  // Build enriched meta based on status
  let enrichedMeta = { ...meta };
  
  if (status === 'running') {
    // Increment attempts counter, clear last error
    const currentStep = await getStepMeta(supabase, jobId, stepName);
    const currentAttempts = (currentStep?.attempts as number) || 0;
    enrichedMeta = {
      ...enrichedMeta,
      attempts: currentAttempts + 1,
      last_error: null,
      last_error_at: null,
      started_at: new Date().toISOString(),
    };
  } else if (status === 'failed') {
    // Record error details
    enrichedMeta = {
      ...enrichedMeta,
      last_error: meta.error || 'Unknown error',
      last_error_at: new Date().toISOString(),
      failed_at: new Date().toISOString(),
    };
  } else if (status === 'complete' || status === 'skipped') {
    enrichedMeta = {
      ...enrichedMeta,
      completed_at: new Date().toISOString(),
    };
  }

  const { error } = await supabase.rpc('update_job_step', {
    p_job_id: jobId,
    p_step_name: stepName,
    p_status: status,
    p_step_meta: enrichedMeta
  });

  if (error) {
    console.warn(`[STEP] Failed to update ${stepName} to ${status}: ${error.message}`);
  }
}

/**
 * Get current step metadata (for reading attempts count, etc.)
 */
async function getStepMeta(
  supabase: SupabaseClient,
  jobId: string,
  stepName: string
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('meta')
    .eq('id', jobId)
    .single();

  if (error || !data?.meta) {
    return null;
  }

  const steps = (data.meta as Record<string, unknown>)?.steps as Record<string, Record<string, unknown>> | undefined;
  return steps?.[stepName] || null;
}

// =====================================================
// JOB LOADING AND UPDATING
// =====================================================

/**
 * Load full job data
 */
export async function loadJob(
  supabase: SupabaseClient,
  jobId: string
): Promise<Job | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Job;
}

/**
 * Update job fields directly
 */
export async function updateJobFields(
  supabase: SupabaseClient,
  jobId: string,
  updates: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from('jobs')
    .update(updates)
    .eq('id', jobId);

  if (error) {
    throw new Error(`Failed to update job: ${error.message}`);
  }
}

/**
 * Update job meta (merge with existing)
 */
export async function updateJobMeta(
  supabase: SupabaseClient,
  jobId: string,
  metaUpdates: Record<string, unknown>
): Promise<void> {
  // First load existing meta
  const job = await loadJob(supabase, jobId);
  if (!job) {
    throw new Error('Job not found for meta update');
  }

  const newMeta = { ...(job.meta || {}), ...metaUpdates };

  await updateJobFields(supabase, jobId, { meta: newMeta });
}

// =====================================================
// STORAGE HELPERS
// =====================================================

/**
 * Upload content to storage bucket with upsert
 */
export async function uploadToStorage(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  content: Uint8Array | Blob | string,
  contentType: string
): Promise<string> {
  // Convert string to blob if needed
  let uploadContent: Uint8Array | Blob;
  if (typeof content === 'string') {
    uploadContent = new TextEncoder().encode(content);
  } else {
    uploadContent = content;
  }

  const { error } = await supabase.storage.from(bucket).upload(path, uploadContent, {
    contentType,
    upsert: true,
  });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Download remote URL and upload to storage
 */
export async function uploadRemoteToStorage(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  remoteUrl: string
): Promise<string> {
  // Handle base64 data URLs
  if (remoteUrl.startsWith('data:')) {
    const matches = remoteUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) throw new Error('Invalid base64 data URL format');

    const contentType = matches[1];
    const base64Data = matches[2];
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return uploadToStorage(supabase, bucket, path, bytes, contentType);
  }

  // Fetch remote URL
  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch remote URL: ${response.status} ${response.statusText}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || 'application/octet-stream';

  return uploadToStorage(supabase, bucket, path, bytes, contentType);
}

// =====================================================
// HASH UTILITIES
// =====================================================

/**
 * Compute SHA-256 hash of a string
 */
export async function computeHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute a pipeline hash for the entire job configuration.
 * This makes debugging "why did this re-render?" trivial.
 * 
 * Canonical input: brand_id|vibe|duration|story_hash|art_style|visual_preset|voice_canonical|music_track
 */
export async function computePipelineHash(params: {
  brandId: string;
  vibePreset: string;
  duration: number;
  storyHash: string;
  artStyle: string;
  visualPreset: string;
  voiceId: string;
  voiceModel: string;
  musicTrackId: string;
}): Promise<string> {
  const canonical = [
    params.brandId,
    params.vibePreset,
    params.duration.toString(),
    params.storyHash,
    params.artStyle,
    params.visualPreset,
    params.voiceId,
    params.voiceModel,
    params.musicTrackId
  ].join('|');
  
  return computeHash(canonical);
}

// =====================================================
// API HELPERS
// =====================================================

/**
 * Fetch with error handling - throws on non-ok response
 */
export async function fetchWithError(
  url: string,
  options: RequestInit,
  context: string
): Promise<Response> {
  const response = await fetch(url, options);
  
  if (!response.ok) {
    const bodyText = await response.text().catch(() => 'Unable to read response body');
    throw new Error(`${context} failed: ${response.status} ${response.statusText} - ${bodyText}`);
  }
  
  return response;
}

// =====================================================
// EFFECTS CONFIG HELPER (Roadmap #15 — Controlled Motion)
// =====================================================

/**
 * Effects config shape returned by get_effects_config_for_job() RPC.
 * See: supabase/migrations/20260211_effects_config.sql
 */
export interface EffectsConfig {
  enabled: boolean;
  intensity: number;  // 0-1 master knob
  kenburns: {
    enabled: boolean;
    zoom_range: [number, number];
    pan_speed: number;
    direction: 'in' | 'out' | 'alternate' | 'random';
  };
  grain: {
    enabled: boolean;
    intensity: number;
    size: number;
  };
  flicker: {
    enabled: boolean;
    intensity: number;
    frequency: number;
  };
  vignette: {
    enabled: boolean;
    intensity: number;
  };
  color_grade: {
    enabled: boolean;
    preset: string;
    intensity: number;
  };
  fade: {
    fade_in: boolean;
    fade_out: boolean;
    duration: number;
  };
}

/**
 * Resolve the final effects_config for a job by calling the DB RPC
 * which deep-merges: system defaults → preset profile → brand overrides → job meta.
 *
 * Falls back to a hardcoded minimal config if the RPC is unavailable
 * (soft failure — never blocks rendering).
 *
 * @param supabase - Supabase client
 * @param brandId  - Brand UUID
 * @param vibePreset - e.g. 'urban_legend', 'one_too_many'
 * @param jobMeta  - job.meta (may contain effects_config overrides)
 * @returns EffectsConfig or null on error
 */
export async function getEffectsConfigForJob(
  supabase: SupabaseClient,
  brandId: string,
  vibePreset: string | null,
  jobMeta: Record<string, unknown> = {}
): Promise<EffectsConfig | null> {
  try {
    const { data, error } = await supabase.rpc('get_effects_config_for_job', {
      p_brand_id: brandId,
      p_vibe_preset: vibePreset || 'urban_legend',
      p_job_meta: jobMeta,
    });

    if (error) {
      console.warn(`[EFFECTS] RPC get_effects_config_for_job failed: ${error.message}`);
      // Soft fallback: return null → renderer will use legacy pipeline
      return null;
    }

    if (data && typeof data === 'object') {
      console.log(`[EFFECTS] ✓ Resolved effects_config: enabled=${data.enabled}, intensity=${data.intensity}`);
      return data as EffectsConfig;
    }

    console.warn('[EFFECTS] RPC returned unexpected data shape, using fallback');
    return null;
  } catch (err) {
    console.warn(`[EFFECTS] getEffectsConfigForJob exception: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// =====================================================
// SUBTITLE CONFIG (DB-driven, follows effects pattern)
// Roadmap #14 — Subtitle System v1 (Styles Per Brand)
// =====================================================

export interface SubtitleConfig {
  style: string;             // CAPTION_STYLES key: bold, horror, glitch, minimal, neon, vintage, blood, typewriter, shadow, comic
  font_size: number;         // ASS font size (48-120)
  position: string;          // 'bottom' | 'center' | 'top'
  highlight_scary: boolean;  // Whether to red-highlight scary words
  words_per_chunk: number;   // Words per subtitle chunk (2-5)
  highlight_color: string;   // ASS BGR color for active word highlight
  scary_color: string;       // ASS BGR color for scary words
  emphasis_scale: number;    // Active word scale factor (100-130)
}

/**
 * Resolve the final subtitle config for a job by calling the DB RPC
 * which merges: system defaults → preset profile → brand overrides → job meta.
 *
 * Falls back to null if the RPC is unavailable
 * (soft failure — renderer will use its hardcoded bold defaults).
 */
export async function getSubtitleConfigForJob(
  supabase: SupabaseClient,
  brandId: string,
  vibePreset: string | null,
  jobMeta: Record<string, unknown> = {}
): Promise<SubtitleConfig | null> {
  try {
    const { data, error } = await supabase.rpc('get_subtitle_config_for_job', {
      p_brand_id: brandId,
      p_vibe_preset: vibePreset || 'urban_legend',
      p_job_meta: jobMeta,
    });

    if (error) {
      console.warn(`[SUBTITLES] RPC get_subtitle_config_for_job failed: ${error.message}`);
      return null;
    }

    if (data && typeof data === 'object') {
      console.log(`[SUBTITLES] ✓ Resolved config: style=${data.style}, fontSize=${data.font_size}, position=${data.position}, scary=${data.highlight_scary}`);
      return data as SubtitleConfig;
    }

    console.warn('[SUBTITLES] RPC returned unexpected data shape, using fallback');
    return null;
  } catch (err) {
    console.warn(`[SUBTITLES] getSubtitleConfigForJob exception: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
// =====================================================
// IMAGE PROMPT CONFIG (DB-driven, follows effects pattern)
// =====================================================

export interface ImagePromptConfig {
  art_style: string;
  style_prompt: string;
  environment: string;
  color_palette: string;
  lighting: string;
  mood: string;
  camera_angles: string[];
  tension_escalation: boolean;
  negative_prompt: string;
  suffix: string;
}

/**
 * Resolve the final image_prompt config for a job by calling the DB RPC
 * which merges: system defaults → preset profile → brand overrides → job meta.
 *
 * Falls back to a hardcoded minimal config if the RPC is unavailable
 * (soft failure — never blocks image generation).
 */
export async function getImagePromptConfigForJob(
  supabase: SupabaseClient,
  brandId: string,
  vibePreset: string | null,
  jobMeta: Record<string, unknown> = {}
): Promise<ImagePromptConfig | null> {
  try {
    const { data, error } = await supabase.rpc('get_image_prompt_config_for_job', {
      p_brand_id: brandId,
      p_vibe_preset: vibePreset || 'urban_legend',
      p_job_meta: jobMeta,
    });

    if (error) {
      console.warn(`[IMAGE_PROMPT] RPC get_image_prompt_config_for_job failed: ${error.message}`);
      return null;
    }

    if (data && typeof data === 'object') {
      console.log(`[IMAGE_PROMPT] ✓ Resolved config: art_style=${data.art_style}, tension=${data.tension_escalation}`);
      return data as ImagePromptConfig;
    }

    console.warn('[IMAGE_PROMPT] RPC returned unexpected data shape, using fallback');
    return null;
  } catch (err) {
    console.warn(`[IMAGE_PROMPT] getImagePromptConfigForJob exception: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
