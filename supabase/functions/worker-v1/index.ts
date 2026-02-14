// =====================================================
// WORKER V1 - END-TO-END VIDEO PIPELINE ORCHESTRATOR
// Processes jobs through: Story → Uniqueness → Scenes → Voice → 
//                         Music → Images → Subtitles → Assemble → Upload → Schedule
// 
// v4.0 - 2026-02-14 (waitUntil background processing: beat 150s HTTP idle timeout)
// v3.0 - 2026-02-13 (Time-budget continuation: auto-pause + self-re-invoke at 340s wall clock)
// v2.9 - 2026-02-12 (DB-driven image prompt config per vibe preset)\n// v2.8 - 2026-02-10 (503 retry: wait + retry when renderer busy during campaigns)
// v2.7 - 2026-02-10 (Background Music V1: DB-driven tracks, ducking, fades)
// v2.5 - 2026-02-10 (Step-level DLQ + retry eligibility tracking)
// v2.4 - 2026-02-22 (Logger hardening: attempt + worker_id correlation)
// v2.3 - 2026-02-22 (Visual logs + step timeline)
// v2.2 - 2026-02-10 (Failure classification + DLQ support)
// 
// Key Features:
// - Atomic claim (no takeovers - returns 409 if locked)
// - Heartbeat between steps (extends lease)
// - Idempotent steps (via RPCs + unique constraints)
// - No double-post guarantee (via schedule_post_idempotent)
// - Async FFmpeg renderer with polling for completion
// - Failure classification (transient/dependency/misconfig/permanent)
// - Step-level failure tracking with retry eligibility (record_job_step_failure)
// - Step logging with attempt correlation and worker_id
// - Global kill switch support
// - Visual step logs with timeline (job_step_logs table)
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

import { classifyError, extractStatusCode, ClassifiedFailure } from "./classifyError.ts";
import { StepLogger, formatErrorMessage } from "./stepLogger.ts";

import {
  Job,
  StepResult,
  loadJob,
  getStepStatus,
  updateStepStatus,
  heartbeatJob,
  releaseJob,
  verifyJobReadyForComplete,
  DEFAULT_LEASE_SECONDS,
  STEP_PROGRESS,
  logStepTelemetry,
  WALL_CLOCK_BUDGET_MS,
  IMAGE_RESERVE_MS,
} from "./helpers.ts";

import {
  executeStoryStep,
  executeUniquenessStep,
  executeScenesStep,
  executeVoiceStep,
  executeMusicStep,
  executeImagesStep,
  executeSubtitlesStep,
  executeAssembleStep,
  executeUploadStep,
  executeScheduleStep,
} from "./steps.ts";

// Declare EdgeRuntime global (Supabase Edge Functions background processing)
declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

// =====================================================
// CONSTANTS
// =====================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type StepName = 'story' | 'uniqueness' | 'scenes' | 'voice' | 'music' | 'images' | 'subtitles' | 'assemble' | 'upload' | 'schedule';

const STEP_ORDER: StepName[] = [
  'story',
  'uniqueness',
  'scenes',
  'voice',
  'music',
  'images',
  'subtitles',
  'assemble',
  'upload',
  'schedule'
];

// Step to job status mapping
const STEP_JOB_STATUS: Record<StepName, string> = {
  'story': 'generating',
  'uniqueness': 'generating',
  'scenes': 'generating',
  'voice': 'generating',
  'music': 'generating',
  'images': 'generating',
  'subtitles': 'generating',
  'assemble': 'assembling',
  'upload': 'rendering',
  'schedule': 'rendering',
};

// =====================================================
// SHUTDOWN HANDLER
// Log if Supabase kills the function (wall-clock or memory limit)
// =====================================================
addEventListener('beforeunload', (ev: any) => {
  console.warn(`[WORKER-V1] ⚠️ Function shutting down: ${ev?.detail?.reason || 'unknown reason'}`);
});

// =====================================================
// MAIN HANDLER
// =====================================================

serve(async (req) => {
  console.log(`[WORKER-V1] Request: ${req.method} at ${new Date().toISOString()}`);
  
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  const workerId = `worker-v1-${crypto.randomUUID()}`;
  const functionStartTime = Date.now(); // Track wall-clock for time-budget
  let claimedJobId: string | null = null;
  let supabase: SupabaseClient | null = null;

  try {
    // =========================================
    // ENVIRONMENT VALIDATION
    // =========================================
    
    const env = {
      SUPABASE_URL: Deno.env.get("SUPABASE_URL") || '',
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || '',
      OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY") || '',
      ELEVENLABS_API_KEY: Deno.env.get("ELEVENLABS_API_KEY") || '',
      CREATOMATE_API_KEY: Deno.env.get("CREATOMATE_API_KEY") || '',
      PEXELS_API_KEY: Deno.env.get("PEXELS_API_KEY") || '',
      VIDEO_RENDERER_URL: Deno.env.get("VIDEO_RENDERER_URL") || '',
      FFMPEG_RENDERER_URL: Deno.env.get("FFMPEG_RENDERER_URL") || '',  // Also support FFMPEG_RENDERER_URL (used by run-job)
    };
    
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    
    supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // =========================================
    // GLOBAL KILL SWITCH CHECK
    // =========================================
    
    const { data: killSwitchActive } = await supabase.rpc('is_kill_switch_active');
    if (killSwitchActive) {
      console.log('[WORKER-V1] ⛔ Kill switch is ACTIVE - refusing to process job');
      return new Response(
        JSON.stringify({ success: false, error: 'Kill switch active', reason: 'kill_switch' }),
        { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // =========================================
    // PARSE REQUEST
    // =========================================
    
    const body = await req.json();
    const jobId = body.job_id;
    
    if (!jobId) {
      return new Response(
        JSON.stringify({ success: false, error: "job_id is required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    console.log(`[WORKER-V1] Processing job ${jobId} (worker=${workerId})`);

    // =========================================
    // CLAIM JOB (ATOMIC, NO TAKEOVERS)
    // =========================================
    
    const claimResult = await claimJobRpc(supabase, jobId, workerId);
    
    if (!claimResult.claimed) {
      console.log(`[WORKER-V1] Could not claim job ${jobId}: ${claimResult.error_message}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: claimResult.error_message || "Could not claim job",
          reason: "claim_failed"
        }),
        { status: 409, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
    
    claimedJobId = jobId;
    const attemptCount = claimResult.attempt_count || 1;
    console.log(`[WORKER-V1] ✓ Claimed job ${jobId} (attempt #${attemptCount})`);

    // =========================================
    // BACKGROUND PIPELINE (via EdgeRuntime.waitUntil)
    // Return HTTP 202 immediately so the 150s HTTP idle timeout
    // doesn't kill the function. Pipeline processes in background
    // with full 400s wall-clock budget (paid plan).
    // =========================================
    const pipelinePromise = (async () => {
      try {

    // =========================================
    // LOAD JOB DATA
    // =========================================
    
    let job = await loadJob(supabase, jobId);
    if (!job) {
      await releaseJob(supabase, jobId, workerId, 'failed', 'Job not found after claim');
      return new Response(
        JSON.stringify({ success: false, error: "Job not found" }),
        { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Initialize step logger for visual timeline (with worker_id and attempt for correlation)
    const logger = new StepLogger(supabase, jobId, workerId, attemptCount);

    // =========================================
    // RUN PIPELINE
    // =========================================
    
    let lastCompletedStep: StepName | null = null;
    let currentStep: StepName | null = null;
    let pipelineError: string | null = null;
    let classifiedFailure: ClassifiedFailure | null = null;
    const stepResults: Record<string, StepResult> = {};
    
    for (const stepName of STEP_ORDER) {
      currentStep = stepName;
      
      // Check if step already complete (idempotency)
      const stepStatus = await getStepStatus(supabase, jobId, stepName);
      
      if (stepStatus === 'complete') {
        console.log(`[WORKER-V1] Step ${stepName} already complete, skipping`);
        lastCompletedStep = stepName;
        stepResults[stepName] = { success: true, skipped: true };
        continue;
      }
      
      if (stepStatus === 'skipped') {
        console.log(`[WORKER-V1] Step ${stepName} was previously skipped, continuing`);
        stepResults[stepName] = { success: true, skipped: true };
        continue;
      }

      // Heartbeat before step (extend lease + update job status)
      const jobStatus = STEP_JOB_STATUS[stepName] || 'generating';
      const progress = STEP_PROGRESS[stepName] || 0;
      
      const heartbeatResult = await heartbeatJob(supabase, jobId, workerId, progress, jobStatus);
      if (!heartbeatResult.success) {
        // Lost lease ownership - another worker may have taken over
        pipelineError = `Lost lease during heartbeat before ${stepName}: ${heartbeatResult.error_message}`;
        console.error(`[WORKER-V1] ${pipelineError}`);
        // Return 409 - don't try to release since we don't own the lock
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: pipelineError,
            reason: "lease_lost",
            last_completed_step: lastCompletedStep
          }),
          { status: 409, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }
      
      // Mark step as running
      await updateStepStatus(supabase, jobId, stepName, 'running');
      
      // Log step started
      await logger.started(stepName, `Starting ${stepName} step`);
      
      // Execute step with telemetry
      logStepTelemetry({ job_id: jobId, step: stepName, status: 'running', worker_id: workerId });
      const startTime = Date.now();
      
      const stepResult = await executeStep(supabase, job, stepName, workerId, env, logger, functionStartTime);
      
      const elapsedMs = Date.now() - startTime;
      
      // Log telemetry based on result
      logStepTelemetry({
        job_id: jobId,
        step: stepName,
        status: stepResult.success ? (stepResult.skipped ? 'skipped' : 'complete') : 'failed',
        worker_id: workerId,
        duration_ms: elapsedMs,
        error: stepResult.error,
      });
      
      stepResults[stepName] = stepResult;
      
      if (!stepResult.success) {
        // =========================================
        // RE-QUEUE: Renderer busy — release back to queued for next scheduler cycle
        // This is NOT a permanent failure, just a resource contention issue
        // =========================================
        if (stepResult.requeue) {
          console.log(`[WORKER-V1] 🔄 Step ${stepName} requested re-queue (renderer busy). Releasing job for next cycle.`);
          
          await updateStepStatus(supabase, jobId, stepName, 'pending', {
            requeued: true,
            reason: 'renderer_busy',
            elapsed_ms: elapsedMs
          });
          
          await logger.snapshot(stepName, 'requeued', {
            reason: 'renderer_busy',
            elapsed_ms: elapsedMs,
            function_elapsed_ms: Date.now() - functionStartTime,
          }, `Renderer busy — re-queued for next scheduler cycle`);
          
          // Release job as 'queued' (not 'failed') so scheduler picks it up again
          await releaseJob(supabase, jobId, workerId, 'queued', undefined);
          
          return new Response(
            JSON.stringify({
              success: true,
              requeued: true,
              job_id: jobId,
              step: stepName,
              reason: 'renderer_busy',
              message: 'Job released back to queue — will retry on next scheduler cycle',
            }),
            { status: 202, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
          );
        }
        
        pipelineError = `Step ${stepName} failed: ${stepResult.error}`;
        
        // Classify the failure for DLQ
        classifiedFailure = classifyError(
          new Error(stepResult.error || 'Unknown error'),
          { step: stepName, statusCode: stepResult.statusCode }
        );
        console.log(`[WORKER-V1] Failure classified as: ${classifiedFailure.class} (signature: ${classifiedFailure.signature})`);
        
        // Log step failed
        await logger.failed(stepName, stepResult.error || 'Unknown error', {
          error_class: classifiedFailure.class,
          duration_ms: elapsedMs
        });
        
        await updateStepStatus(supabase, jobId, stepName, 'failed', { 
          error: stepResult.error,
          elapsed_ms: elapsedMs,
          failure_class: classifiedFailure.class
        });
        break;
      }
      
      // =========================================
      // CONTINUATION: Time budget exhausted
      // Release job as 'queued' so it can be re-claimed, then self-invoke
      // =========================================
      if (stepResult.continuation_needed) {
        console.log(`[WORKER-V1] ⏰ Step ${stepName} needs continuation (time budget). ${stepResult.data?.completed || '?'}/${stepResult.data?.total || '?'} done.`);
        
        // Mark step as running (not complete) so it resumes on next invocation
        await updateStepStatus(supabase, jobId, stepName, 'running', {
          continuation_needed: true,
          ...(stepResult.data || {}),
          elapsed_ms: elapsedMs
        });
        
        // Log continuation event
        await logger.snapshot(stepName, 'continuation_pause', {
          reason: 'wall_clock_budget',
          elapsed_ms: elapsedMs,
          function_elapsed_ms: Date.now() - functionStartTime,
          ...(stepResult.data || {})
        }, `Pausing for continuation: ${stepResult.data?.completed || '?'}/${stepResult.data?.total || '?'} scenes`);
        
        // Release job as 'queued' so next invocation can claim it
        await releaseJob(supabase, jobId, workerId, 'queued', undefined);
        
        // Self-invoke for continuation — await the HTTP response (not the pipeline)
        // to confirm the new invocation was accepted. Previous fire-and-forget approach
        // silently swallowed failures, leaving jobs stuck on "assemble" indefinitely.
        try {
          const selfUrl = `${env.SUPABASE_URL}/functions/v1/worker-v1`;
          console.log(`[WORKER-V1] 🔄 Self-invoking for continuation: ${selfUrl}`);
          
          const selfResp = await fetch(selfUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ job_id: jobId }),
          });
          console.log(`[WORKER-V1] Self-invoke response: ${selfResp.status}`);
          if (!selfResp.ok) {
            const errBody = await selfResp.text().catch(() => '');
            console.warn(`[WORKER-V1] Self-invoke returned ${selfResp.status}: ${errBody.slice(0, 200)}`);
          }
        } catch (invokeErr) {
          console.warn(`[WORKER-V1] Self-invoke error (non-fatal, scheduler will retry): ${invokeErr}`);
        }
        
        return new Response(
          JSON.stringify({
            success: true,
            continuation: true,
            job_id: jobId,
            paused_step: stepName,
            step_results: stepResults,
            message: `Time budget reached at ${stepName}. Re-invoked for continuation.`
          }),
          { status: 202, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }
      
      // Log step completed
      await logger.completed(stepName, `Completed ${stepName} in ${(elapsedMs / 1000).toFixed(1)}s`, {
        duration_ms: elapsedMs
      });
      
      // Mark step complete
      await updateStepStatus(supabase, jobId, stepName, stepResult.skipped ? 'skipped' : 'complete', {
        ...(stepResult.data || {}),
        elapsed_ms: elapsedMs
      });
      lastCompletedStep = stepName;
      
      // Refresh job data if step may have produced new data
      if (stepResult.data) {
        const updatedJob = await loadJob(supabase, jobId);
        if (updatedJob) {
          job = updatedJob;
        }
      }
    }

    // =========================================
    // RELEASE JOB
    // =========================================
    
    if (pipelineError) {
      console.log(`[WORKER-V1] ✗ Pipeline failed: ${pipelineError}`);
      
      // Record step-level failure to DLQ using new RPC
      if (classifiedFailure && currentStep) {
        const stepResult = stepResults[currentStep];
        const failurePayload = {
          failure_class: classifiedFailure.class,
          error_message: classifiedFailure.message || pipelineError,
          error_signature: classifiedFailure.signature,
          worker_id: workerId,
          http_status: stepResult?.statusCode || null,
          duration_ms: stepResult?.elapsed_ms || null,
          step_progress: stepResult?.data?.progress || null
        };
        
        console.log(`[WORKER-V1] Recording step failure: ${currentStep} (${classifiedFailure.class})`);
        
        const { data: dlqResult, error: dlqError } = await supabase.rpc('record_job_step_failure', {
          p_job_id: jobId,
          p_step_name: currentStep,
          p_failure: failurePayload
        });
        
        if (dlqError) {
          console.warn(`[WORKER-V1] Failed to record to DLQ: ${dlqError.message}`);
        } else {
          console.log(`[WORKER-V1] DLQ record: retry_eligible=${dlqResult?.retry_eligible}, next_retry_at=${dlqResult?.next_retry_at}`);
        }
      }
      
      await releaseJob(supabase, jobId, workerId, 'failed', pipelineError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: pipelineError,
          failure_class: classifiedFailure?.class,
          failure_step: currentStep,
          last_completed_step: lastCompletedStep,
          step_results: stepResults
        }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
    
    // =========================================
    // FINALIZATION BARRIER
    // Verify all required assets before marking complete
    // =========================================
    
    const finalization = await verifyJobReadyForComplete(supabase, jobId);
    
    if (!finalization.ready) {
      const missingStr = finalization.missing.join(', ');
      const errorMsg = `Finalization failed: missing [${missingStr}]`;
      console.error(`[WORKER-V1] ✗ ${errorMsg}`);
      
      // Classify finalization failure (usually permanent - missing assets)
      const finalFailure = classifyError(
        new Error(errorMsg),
        { step: 'finalization' }
      );
      
      // Record to step-level DLQ
      const { data: dlqResult } = await supabase.rpc('record_job_step_failure', {
        p_job_id: jobId,
        p_step_name: 'finalization',
        p_failure: {
          failure_class: finalFailure.class,
          error_message: errorMsg,
          error_signature: finalFailure.signature,
          worker_id: workerId,
          step_progress: { missing: finalization.missing }
        }
      });
      
      console.log(`[WORKER-V1] Finalization DLQ: retry_eligible=${dlqResult?.retry_eligible}`);
      
      await releaseJob(supabase, jobId, workerId, 'failed', errorMsg);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: errorMsg,
          failure_class: finalFailure.class,
          failure_step: 'finalization',
          finalization: finalization,
          step_results: stepResults
        }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
    
    // Log warnings if any
    if (finalization.warnings.length > 0) {
      console.warn(`[WORKER-V1] ⚠️ Completing with warnings: ${finalization.warnings.join(', ')}`);
    }
    
    console.log(`[WORKER-V1] ✓ Pipeline complete for job ${jobId}`);
    await releaseJob(supabase, jobId, workerId, 'complete', undefined, 100);

      } catch (bgError) {
        // Background pipeline fatal error handler
        const msg = bgError instanceof Error ? bgError.message : String(bgError);
        console.error(`[WORKER-V1] ✗ Background pipeline error: ${msg}`);
        const classified = classifyError(bgError, { step: 'fatal' });
        try {
          await supabase!.rpc('record_job_step_failure', {
            p_job_id: jobId,
            p_step_name: 'fatal',
            p_failure: {
              failure_class: classified.class,
              error_message: msg,
              error_signature: classified.signature,
              worker_id: workerId
            }
          });
          await releaseJob(supabase!, jobId, workerId, 'failed', msg);
        } catch (releaseErr) {
          console.error(`[WORKER-V1] Failed to release after background error: ${releaseErr}`);
        }
      }
    })();

    // Return 202 immediately; pipeline continues in background via waitUntil
    EdgeRuntime.waitUntil(pipelinePromise);

    return new Response(
      JSON.stringify({ 
        success: true, 
        job_id: jobId,
        message: 'Pipeline started in background',
        worker_id: workerId
      }),
      { status: 202, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[WORKER-V1] ✗ Fatal error: ${errorMessage}`);
    
    // Classify the fatal error
    const fatalFailure = classifyError(error, { step: 'fatal' });
    
    // Try to release job if we claimed it
    if (claimedJobId && supabase) {
      try {
        // Record to step-level DLQ
        await supabase.rpc('record_job_step_failure', {
          p_job_id: claimedJobId,
          p_step_name: 'fatal',
          p_failure: {
            failure_class: fatalFailure.class,
            error_message: errorMessage,
            error_signature: fatalFailure.signature,
            worker_id: workerId
          }
        });
        
        await releaseJob(supabase, claimedJobId, workerId, 'failed', errorMessage);
      } catch (releaseError) {
        console.error(`[WORKER-V1] Failed to release job after error: ${releaseError}`);
      }
    }
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage, failure_class: fatalFailure.class }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});

// =====================================================
// CLAIM JOB (Using existing RPC)
// =====================================================

async function claimJobRpc(
  supabase: SupabaseClient, 
  jobId: string, 
  workerId: string
): Promise<{ claimed: boolean; attempt_count?: number; error_message?: string }> {
  const { data, error } = await supabase.rpc('claim_job', {
    p_job_id: jobId,
    p_locked_by: workerId,
    p_lease_seconds: DEFAULT_LEASE_SECONDS
  });
  
  if (error) {
    return { claimed: false, error_message: error.message };
  }
  
  const result = Array.isArray(data) ? data[0] : data;
  return {
    claimed: result?.claimed ?? false,
    attempt_count: result?.attempt_count,
    error_message: result?.error_message
  };
}

// =====================================================
// STEP DISPATCHER
// =====================================================

async function executeStep(
  supabase: SupabaseClient,
  job: Job,
  stepName: StepName,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger,
  functionStartTime: number
): Promise<StepResult> {
  switch (stepName) {
    case 'story':
      return executeStoryStep(supabase, job, workerId, env, logger);
    case 'uniqueness':
      return executeUniquenessStep(supabase, job, workerId, env, logger);
    case 'scenes':
      return executeScenesStep(supabase, job, workerId, env, logger);
    case 'voice':
      return executeVoiceStep(supabase, job, workerId, env, logger);
    case 'music':
      return executeMusicStep(supabase, job, workerId, env, logger);
    case 'images':
      return executeImagesStep(supabase, job, workerId, env, logger, functionStartTime);
    case 'subtitles':
      return executeSubtitlesStep(supabase, job, workerId, env, logger);
    case 'assemble':
      return executeAssembleStep(supabase, job, workerId, env, logger, functionStartTime);
    case 'upload':
      return executeUploadStep(supabase, job, workerId, env, logger);
    case 'schedule':
      return executeScheduleStep(supabase, job, workerId, env, logger);
    default:
      return { success: false, error: `Unknown step: ${stepName}` };
  }
}
