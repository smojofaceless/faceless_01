// =====================================================
// JOB LEASE MANAGEMENT
// Claim, heartbeat, and release functions for job locking
// 
// Reference: JOB_SCHEDULER.md, CAMPAIGN_SYSTEM.md
// 
// v1.0 - 2026-02-08
// =====================================================

import { SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

// =====================================================
// CONFIGURATION
// =====================================================

// Default lease duration (seconds)
export const DEFAULT_LEASE_SECONDS = 900; // 15 minutes

// =====================================================
// TYPES
// =====================================================

export interface ClaimResult {
  claimed: boolean;
  job_id: string | null;
  job_status: string | null;
  brand_id: string | null;
  batch_id: string | null;
  generate_by: string | null;
  scheduled_post_at: string | null;
  attempt_count: number | null;
  error_message: string | null;
}

export interface HeartbeatResult {
  success: boolean;
  new_lease_expires_at: string | null;
  error_message: string | null;
}

export interface ReleaseResult {
  success: boolean;
  final_status: string | null;
  error_message: string | null;
}

// =====================================================
// WORKER ID GENERATION
// =====================================================

/**
 * Generate a unique worker ID for this run-job instance.
 * Used for lock ownership verification.
 */
export function generateWorkerId(): string {
  return `worker-${crypto.randomUUID()}`;
}

// =====================================================
// CLAIM JOB
// =====================================================

/**
 * Attempt to claim a job for processing.
 * 
 * This is used when run-job is called directly (not via scheduler).
 * If the scheduler already claimed the job, this will verify the job
 * is in 'generating' status and we can proceed.
 * 
 * @param supabase - Supabase client
 * @param jobId - Job ID to claim
 * @param workerId - Unique identifier for this worker
 * @param leaseSeconds - Lease duration in seconds
 * @returns ClaimResult with success status and job details
 */
export async function claimJob(
  supabase: SupabaseClient,
  jobId: string,
  workerId: string,
  leaseSeconds: number = DEFAULT_LEASE_SECONDS
): Promise<ClaimResult> {
  console.log(`[LEASE] Claiming job ${jobId} (worker=${workerId}, lease=${leaseSeconds}s)`);
  
  const { data, error } = await supabase.rpc('claim_job', {
    p_job_id: jobId,
    p_locked_by: workerId,
    p_lease_seconds: leaseSeconds
  });
  
  if (error) {
    console.error(`[LEASE] claim_job RPC error: ${error.message}`);
    return {
      claimed: false,
      job_id: jobId,
      job_status: null,
      brand_id: null,
      batch_id: null,
      generate_by: null,
      scheduled_post_at: null,
      attempt_count: null,
      error_message: error.message
    };
  }
  
  // RPC returns a single row
  const result = Array.isArray(data) ? data[0] : data;
  
  if (!result) {
    return {
      claimed: false,
      job_id: jobId,
      job_status: null,
      brand_id: null,
      batch_id: null,
      generate_by: null,
      scheduled_post_at: null,
      attempt_count: null,
      error_message: 'No result from claim_job RPC'
    };
  }
  
  console.log(`[LEASE] Claim result: claimed=${result.claimed}, status=${result.job_status}, attempt=${result.attempt_count}`);
  
  return {
    claimed: result.claimed,
    job_id: result.job_id,
    job_status: result.job_status,
    brand_id: result.brand_id,
    batch_id: result.batch_id,
    generate_by: result.generate_by,
    scheduled_post_at: result.scheduled_post_at,
    attempt_count: result.attempt_count,
    error_message: result.error_message
  };
}

/**
 * Check if a job can be processed by verifying its current state.
 * This is a lighter check than claiming - used when the scheduler 
 * already claimed the job.
 * 
 * Returns true if job is in a processable state (generating, assembling, rendering).
 * Returns false if job is already complete, failed, cancelled, or doesn't exist.
 */
export async function canProcessJob(
  supabase: SupabaseClient,
  jobId: string
): Promise<{ canProcess: boolean; status: string | null; error?: string }> {
  console.log(`[LEASE] Checking if job ${jobId} can be processed`);
  
  const { data, error } = await supabase
    .from('jobs')
    .select('status, locked_by, lease_expires_at')
    .eq('id', jobId)
    .single();
  
  if (error) {
    console.error(`[LEASE] Error checking job: ${error.message}`);
    return { canProcess: false, status: null, error: error.message };
  }
  
  if (!data) {
    return { canProcess: false, status: null, error: 'Job not found' };
  }
  
  const processableStatuses = ['pending', 'queued', 'generating', 'assembling', 'rendering'];
  const canProcess = processableStatuses.includes(data.status);
  
  console.log(`[LEASE] Job ${jobId} status=${data.status}, canProcess=${canProcess}`);
  
  return { canProcess, status: data.status };
}

// =====================================================
// HEARTBEAT JOB
// =====================================================

/**
 * Extend the lease for an in-progress job.
 * Should be called periodically during long-running operations.
 * 
 * @param supabase - Supabase client
 * @param jobId - Job ID
 * @param workerId - Must match the locked_by value
 * @param leaseSeconds - New lease duration
 * @param progress - Optional: update progress percentage
 * @param newStatus - Optional: update status (e.g., 'assembling')
 */
export async function heartbeatJob(
  supabase: SupabaseClient,
  jobId: string,
  workerId: string,
  leaseSeconds: number = DEFAULT_LEASE_SECONDS,
  progress?: number,
  newStatus?: string
): Promise<HeartbeatResult> {
  console.log(`[LEASE] Heartbeat job ${jobId} (worker=${workerId}, lease=${leaseSeconds}s, progress=${progress}, status=${newStatus})`);
  
  const { data, error } = await supabase.rpc('heartbeat_job', {
    p_job_id: jobId,
    p_locked_by: workerId,
    p_lease_seconds: leaseSeconds,
    p_progress: progress ?? null,
    p_new_status: newStatus ?? null
  });
  
  if (error) {
    console.error(`[LEASE] heartbeat_job RPC error: ${error.message}`);
    return {
      success: false,
      new_lease_expires_at: null,
      error_message: error.message
    };
  }
  
  const result = Array.isArray(data) ? data[0] : data;
  
  if (!result) {
    return {
      success: false,
      new_lease_expires_at: null,
      error_message: 'No result from heartbeat_job RPC'
    };
  }
  
  if (!result.success) {
    console.warn(`[LEASE] Heartbeat failed: ${result.error_message}`);
  }
  
  return {
    success: result.success,
    new_lease_expires_at: result.new_lease_expires_at,
    error_message: result.error_message
  };
}

// =====================================================
// RELEASE JOB
// =====================================================

/**
 * Release a job lock and set final status.
 * Called when processing completes (success or failure).
 * 
 * @param supabase - Supabase client
 * @param jobId - Job ID
 * @param workerId - Must match the locked_by value
 * @param newStatus - Final status: 'complete', 'failed', 'pending' (retry), 'cancelled'
 * @param errorMessage - Error message (for failed status)
 * @param progress - Final progress value
 */
export async function releaseJob(
  supabase: SupabaseClient,
  jobId: string,
  workerId: string,
  newStatus: string,
  errorMessage?: string,
  progress?: number
): Promise<ReleaseResult> {
  console.log(`[LEASE] Releasing job ${jobId} -> ${newStatus} (worker=${workerId})`);
  
  const { data, error } = await supabase.rpc('release_job', {
    p_job_id: jobId,
    p_locked_by: workerId,
    p_new_status: newStatus,
    p_error: errorMessage ?? null,
    p_progress: progress ?? null
  });
  
  if (error) {
    console.error(`[LEASE] release_job RPC error: ${error.message}`);
    return {
      success: false,
      final_status: null,
      error_message: error.message
    };
  }
  
  const result = Array.isArray(data) ? data[0] : data;
  
  if (!result) {
    return {
      success: false,
      final_status: null,
      error_message: 'No result from release_job RPC'
    };
  }
  
  console.log(`[LEASE] Release result: success=${result.success}, final_status=${result.final_status}`);
  
  return {
    success: result.success,
    final_status: result.final_status,
    error_message: result.error_message
  };
}

// =====================================================
// HELPER: TRY CLAIM OR VERIFY
// =====================================================

/**
 * Try to claim a job, or verify it's already in a processable state.
 * 
 * This handles the case where:
 * 1. Job is pending/queued - we need to claim it
 * 2. Job is already generating (claimed by scheduler) - we can proceed
 * 3. Job is complete/failed/cancelled - we should not proceed
 * 
 * @returns Object with canProceed flag, workerId to use, and current status
 */
export async function tryClaimOrVerify(
  supabase: SupabaseClient,
  jobId: string,
  preferredWorkerId?: string
): Promise<{ 
  canProceed: boolean; 
  workerId: string | null;
  status: string | null;
  error?: string;
  attemptCount?: number;
}> {
  const workerId = preferredWorkerId || generateWorkerId();
  
  // First, check current job state
  const { data: job, error: fetchError } = await supabase
    .from('jobs')
    .select('status, locked_by, lease_expires_at')
    .eq('id', jobId)
    .single();
  
  if (fetchError || !job) {
    return {
      canProceed: false,
      workerId: null,
      status: null,
      error: fetchError?.message || 'Job not found'
    };
  }
  
  // If job is already terminal, cannot proceed
  if (['complete', 'failed', 'cancelled'].includes(job.status)) {
    console.log(`[LEASE] Job ${jobId} is already terminal (${job.status}), cannot proceed`);
    return {
      canProceed: false,
      workerId: null,
      status: job.status,
      error: `Job already in terminal state: ${job.status}`
    };
  }
  
  // If job is in-progress with active lease from someone else, REJECT (no takeovers)
  if (['generating', 'assembling', 'rendering'].includes(job.status)) {
    const now = new Date();
    const leaseExpires = job.lease_expires_at ? new Date(job.lease_expires_at) : null;
    
    if (job.locked_by && leaseExpires && leaseExpires > now) {
      // Someone else has active (unexpired) lease - we must NOT interfere
      // This prevents double-processing and race conditions
      console.log(`[LEASE] Job ${jobId} has active lease by ${job.locked_by} (expires ${leaseExpires.toISOString()}), rejecting`);
      return {
        canProceed: false,
        workerId: null,
        status: job.status,
        error: `Job locked by another worker (${job.locked_by}), lease expires ${leaseExpires.toISOString()}`
      };
    }
    
    // Lease expired OR no lock - claim via RPC
    if (!job.locked_by || (leaseExpires && leaseExpires <= now)) {
      console.log(`[LEASE] Job ${jobId} lease expired or unlocked, claiming`);
      const claimResult = await claimJob(supabase, jobId, workerId);
      return {
        canProceed: claimResult.claimed,
        workerId: claimResult.claimed ? workerId : null,
        status: claimResult.job_status,
        error: claimResult.error_message || undefined,
        attemptCount: claimResult.attempt_count || undefined
      };
    }
    
    // Should not reach here, but safety return
    return {
      canProceed: false,
      workerId: null,
      status: job.status,
      error: 'Unexpected state in tryClaimOrVerify'
    };
  }
  
  // Job is pending/queued - try to claim it
  const claimResult = await claimJob(supabase, jobId, workerId);
  
  return {
    canProceed: claimResult.claimed,
    workerId: claimResult.claimed ? workerId : null,
    status: claimResult.job_status,
    error: claimResult.error_message || undefined,
    attemptCount: claimResult.attempt_count || undefined
  };
}
