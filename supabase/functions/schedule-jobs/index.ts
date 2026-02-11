// =====================================================
// SCHEDULE-JOBS EDGE FUNCTION
// Cron-triggered scheduler that claims eligible jobs and triggers run-job
// 
// Reference: JOB_SCHEDULER.md, CAMPAIGN_SYSTEM.md
// 
// v2.1 - 2026-02-10: Added kill switch + auto-pause for failure clusters
// v2.0 - 2026-02-08: Uses claim_job RPC with lease-based locking
// 
// This function:
// 1. Checks global kill switch (aborts if active)
// 2. Runs auto-pause for failure clusters (dependency outages)
// 3. Queries for jobs where generate_by <= NOW() (via find_eligible_jobs RPC)
// 4. Atomically claims each job via claim_job RPC (handles campaign gating, lease)
// 5. Triggers run-job for each claimed job
// 6. On trigger failure, releases claim via release_job RPC
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

// =====================================================
// CONFIGURATION
// =====================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Default generation lead time (hours before scheduled_post_at to trigger generation)
const DEFAULT_LEAD_TIME_HOURS = 24;

// Maximum jobs to process per scheduler run (prevent stampedes)
const MAX_JOBS_PER_RUN = 3;

// Default lease duration for claimed jobs (seconds)
const DEFAULT_LEASE_SECONDS = 900; // 15 minutes

// Timeout for run-job call (ms) - we don't wait for completion, but log quick failures
const RUN_JOB_TIMEOUT_MS = 30000;

// =====================================================
// TYPES
// =====================================================

interface EligibleJob {
  id: string;
  brand_id: string;
  batch_id: string | null;
  scheduled_post_at: string;
  generate_by: string;
  meta: Record<string, unknown>;
  vibe_preset: string | null;
  campaign_status?: string;
}

interface ClaimResult {
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

interface SchedulerResult {
  success: boolean;
  jobs_found: number;
  jobs_claimed: number;
  jobs_triggered: number;
  errors: string[];
  details: {
    job_id: string;
    claimed: boolean;
    triggered: boolean;
    attempt_count?: number;
    error?: string;
  }[];
}

// =====================================================
// DATABASE QUERIES
// =====================================================

/**
 * Find jobs eligible for scheduling via RPC.
 * The RPC handles:
 * - status IN ('pending', 'queued')
 * - No active lease (lease_expires_at IS NULL OR expired)
 * - generate_by <= NOW()
 * - Campaign not paused/cancelled
 */
async function findEligibleJobs(
  supabase: SupabaseClient,
  leadTimeHours: number = DEFAULT_LEAD_TIME_HOURS
): Promise<EligibleJob[]> {
  console.log(`[SCHEDULER] Finding eligible jobs (lead_time=${leadTimeHours}h, max=${MAX_JOBS_PER_RUN})`);
  
  const { data, error } = await supabase.rpc('find_eligible_jobs', {
    p_lead_time_hours: leadTimeHours,
    p_max_jobs: MAX_JOBS_PER_RUN
  });
  
  if (error) {
    console.error(`[SCHEDULER] find_eligible_jobs RPC error: ${error.message}`);
    throw new Error(`Failed to find eligible jobs: ${error.message}`);
  }
  
  console.log(`[SCHEDULER] Found ${data?.length || 0} eligible jobs`);
  return data || [];
}

/**
 * Claim a job using the claim_job RPC.
 * This atomically:
 * - Validates job is claimable (status, lease, campaign status)
 * - Sets status='generating'
 * - Sets lock fields (locked_at, locked_by, lease_expires_at)
 * - Increments attempt_count
 */
async function claimJob(
  supabase: SupabaseClient,
  jobId: string,
  lockedBy: string,
  leaseSeconds: number = DEFAULT_LEASE_SECONDS
): Promise<ClaimResult> {
  console.log(`[SCHEDULER] Claiming job ${jobId} (locked_by=${lockedBy}, lease=${leaseSeconds}s)`);
  
  const { data, error } = await supabase.rpc('claim_job', {
    p_job_id: jobId,
    p_locked_by: lockedBy,
    p_lease_seconds: leaseSeconds
  });
  
  if (error) {
    console.error(`[SCHEDULER] claim_job RPC error: ${error.message}`);
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
  
  console.log(`[SCHEDULER] Claim result: claimed=${result.claimed}, status=${result.job_status}, attempt=${result.attempt_count}`);
  
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
 * Release a job claim using the release_job RPC.
 * Used when run-job fails to start.
 */
async function releaseJob(
  supabase: SupabaseClient,
  jobId: string,
  lockedBy: string,
  newStatus: string,
  errorMessage: string | null = null
): Promise<{ success: boolean; error?: string }> {
  console.log(`[SCHEDULER] Releasing job ${jobId} -> ${newStatus}`);
  
  const { data, error } = await supabase.rpc('release_job', {
    p_job_id: jobId,
    p_locked_by: lockedBy,
    p_new_status: newStatus,
    p_error: errorMessage
  });
  
  if (error) {
    console.error(`[SCHEDULER] release_job RPC error: ${error.message}`);
    return { success: false, error: error.message };
  }
  
  const result = Array.isArray(data) ? data[0] : data;
  
  if (!result?.success) {
    return { success: false, error: result?.error_message || 'Release failed' };
  }
  
  return { success: true };
}

/**
 * Trigger worker-v1 for a claimed job.
 * This is a fire-and-forget call - we don't wait for completion.
 * worker-v1 will handle its own claim verification and heartbeats.
 */
async function triggerRunJob(
  supabaseUrl: string,
  supabaseAnonKey: string,
  supabaseServiceKey: string,
  jobId: string
): Promise<{ success: boolean; error?: string }> {
  console.log(`[SCHEDULER] Triggering worker-v1 for ${jobId}`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RUN_JOB_TIMEOUT_MS);
    
    // Use worker-v1 (the new step-based pipeline) instead of run-job
    const response = await fetch(`${supabaseUrl}/functions/v1/worker-v1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'apikey': supabaseAnonKey
      },
      body: JSON.stringify({ job_id: jobId }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`[SCHEDULER] worker-v1 failed for ${jobId}: ${response.status} - ${errorText}`);
      return { 
        success: false, 
        error: `HTTP ${response.status}: ${errorText.substring(0, 200)}` 
      };
    }
    
    console.log(`[SCHEDULER] worker-v1 triggered successfully for ${jobId}`);
    return { success: true };
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    
    if (errorMsg.includes('aborted')) {
      // Timeout is OK - worker-v1 is long-running, we just need to know it started
      console.log(`[SCHEDULER] worker-v1 call timed out for ${jobId} (expected for long jobs)`);
      return { success: true };
    }
    
    console.error(`[SCHEDULER] Error triggering worker-v1 for ${jobId}: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// =====================================================
// MAIN HANDLER
// =====================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();
  const schedulerRunId = `scheduler-${crypto.randomUUID()}`;
  
  console.log(`[SCHEDULER] ========================================`);
  console.log(`[SCHEDULER] Starting scheduler run: ${schedulerRunId}`);
  console.log(`[SCHEDULER] Time: ${new Date().toISOString()}`);
  
  try {
    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      throw new Error('Missing required environment variables');
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // =========================================
    // GLOBAL KILL SWITCH CHECK
    // =========================================
    
    const { data: killSwitchActive, error: killError } = await supabase.rpc('is_kill_switch_active');
    
    if (killError) {
      console.warn(`[SCHEDULER] ⚠️ Could not check kill switch: ${killError.message}`);
    } else if (killSwitchActive) {
      console.log(`[SCHEDULER] ⛔ Kill switch is ACTIVE - aborting scheduler run`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Kill switch active - scheduler skipped',
          kill_switch_active: true,
          scheduler_run_id: schedulerRunId,
          duration_ms: Date.now() - startTime
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // =========================================
    // GLOBAL BUDGET CHECK (Cost Controls)
    // =========================================
    
    const { data: globalBudget, error: budgetError } = await supabase.rpc('check_global_budget');
    
    if (budgetError) {
      console.warn(`[SCHEDULER] ⚠️ Could not check global budget: ${budgetError.message}`);
      // Continue anyway - budget check is a guardrail, not a hard gate
    } else if (globalBudget && !globalBudget.can_proceed) {
      console.log(`[SCHEDULER] 💰 Global budget exceeded ($${(globalBudget.daily_spend_cents / 100).toFixed(2)}/$${(globalBudget.daily_budget_cents / 100).toFixed(2)}) - pausing scheduler`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Global daily budget exceeded - scheduler paused',
          budget_exceeded: true,
          daily_spend_cents: globalBudget.daily_spend_cents,
          daily_budget_cents: globalBudget.daily_budget_cents,
          pct_used: globalBudget.pct_used,
          scheduler_run_id: schedulerRunId,
          duration_ms: Date.now() - startTime
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else if (globalBudget?.reason) {
      // Log warning if approaching limit
      console.log(`[SCHEDULER] 💰 Budget warning: ${globalBudget.reason} (${globalBudget.pct_used}% used)`);
    }
    
    // =========================================
    // AUTO-PAUSE FAILURE CLUSTERS
    // =========================================
    
    const { data: pauseResults, error: pauseError } = await supabase.rpc('auto_pause_affected_campaigns', {
      p_window_minutes: 10,
      p_min_failures: 5,
      p_cooldown_minutes: 30
    });
    
    if (pauseError) {
      console.warn(`[SCHEDULER] ⚠️ Could not check failure clusters: ${pauseError.message}`);
    } else if (pauseResults && pauseResults.length > 0) {
      const paused = pauseResults.filter((r: { action: string }) => r.action === 'paused');
      if (paused.length > 0) {
        console.log(`[SCHEDULER] 🛑 Auto-paused ${paused.length} campaigns due to failure clusters:`);
        paused.forEach((p: { campaign_name: string; failure_class: string; failure_count: number }) => {
          console.log(`  - ${p.campaign_name} (${p.failure_class}: ${p.failure_count} failures)`);
        });
      }
    }
    
    // =========================================
    let leadTimeHours = DEFAULT_LEAD_TIME_HOURS;
    let leaseSeconds = DEFAULT_LEASE_SECONDS;
    let dryRun = false;
    
    try {
      const body = await req.json();
      if (body.lead_time_hours) {
        leadTimeHours = parseInt(body.lead_time_hours, 10);
      }
      if (body.lease_seconds) {
        leaseSeconds = parseInt(body.lease_seconds, 10);
      }
      if (body.dry_run === true) {
        dryRun = true;
      }
    } catch {
      // No body or invalid JSON - use defaults
    }
    
    // Initialize result
    const result: SchedulerResult = {
      success: true,
      jobs_found: 0,
      jobs_claimed: 0,
      jobs_triggered: 0,
      errors: [],
      details: []
    };
    
    // Find eligible jobs
    const eligibleJobs = await findEligibleJobs(supabase, leadTimeHours);
    result.jobs_found = eligibleJobs.length;
    
    if (eligibleJobs.length === 0) {
      console.log(`[SCHEDULER] No eligible jobs found`);
      return new Response(
        JSON.stringify({ 
          ...result, 
          message: 'No eligible jobs found',
          scheduler_run_id: schedulerRunId,
          duration_ms: Date.now() - startTime
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`[SCHEDULER] Processing ${eligibleJobs.length} eligible jobs`);
    
    // Process each eligible job
    for (const job of eligibleJobs) {
      const jobDetail: SchedulerResult['details'][0] = {
        job_id: job.id,
        claimed: false,
        triggered: false
      };
      
      try {
        // Dry run: just report what would be done
        if (dryRun) {
          console.log(`[SCHEDULER] DRY RUN: Would claim and trigger job ${job.id}`);
          jobDetail.claimed = true;
          jobDetail.triggered = true;
          result.jobs_claimed++;
          result.jobs_triggered++;
          result.details.push(jobDetail);
          continue;
        }
        
        // Claim the job using RPC
        const claimResult = await claimJob(supabase, job.id, schedulerRunId, leaseSeconds);
        
        if (!claimResult.claimed) {
          console.log(`[SCHEDULER] Failed to claim job ${job.id}: ${claimResult.error_message}`);
          jobDetail.error = claimResult.error_message || 'Claim failed';
          result.details.push(jobDetail);
          continue;
        }
        
        jobDetail.claimed = true;
        jobDetail.attempt_count = claimResult.attempt_count || 1;
        result.jobs_claimed++;
        
        // Trigger run-job
        const triggerResult = await triggerRunJob(
          supabaseUrl,
          supabaseAnonKey,
          supabaseServiceKey,
          job.id
        );
        
        if (!triggerResult.success) {
          console.error(`[SCHEDULER] Failed to trigger run-job for ${job.id}: ${triggerResult.error}`);
          jobDetail.error = triggerResult.error;
          result.errors.push(`Job ${job.id}: ${triggerResult.error}`);
          
          // Release claim back to 'pending' with error
          const releaseResult = await releaseJob(
            supabase, 
            job.id, 
            schedulerRunId, 
            'pending',
            `Scheduler trigger failed: ${triggerResult.error}`
          );
          
          if (!releaseResult.success) {
            console.error(`[SCHEDULER] Failed to release job ${job.id}: ${releaseResult.error}`);
          }
          
          jobDetail.claimed = false;
          result.jobs_claimed--;
        } else {
          jobDetail.triggered = true;
          result.jobs_triggered++;
        }
        
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[SCHEDULER] Error processing job ${job.id}: ${errorMsg}`);
        jobDetail.error = errorMsg;
        result.errors.push(`Job ${job.id}: ${errorMsg}`);
      }
      
      result.details.push(jobDetail);
    }
    
    // Set overall success based on errors
    result.success = result.errors.length === 0;
    
    const duration = Date.now() - startTime;
    console.log(`[SCHEDULER] ========================================`);
    console.log(`[SCHEDULER] Run complete: ${schedulerRunId}`);
    console.log(`[SCHEDULER] Duration: ${duration}ms`);
    console.log(`[SCHEDULER] Found: ${result.jobs_found}, Claimed: ${result.jobs_claimed}, Triggered: ${result.jobs_triggered}`);
    
    return new Response(
      JSON.stringify({ 
        ...result, 
        scheduler_run_id: schedulerRunId,
        duration_ms: duration
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[SCHEDULER] Fatal error: ${errorMsg}`);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMsg,
        scheduler_run_id: schedulerRunId,
        duration_ms: Date.now() - startTime
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
