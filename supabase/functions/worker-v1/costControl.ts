/**
 * Cost Controls Helper for Worker-v1
 * 
 * Provides budget checking and usage recording for expensive API calls.
 * Integrates with the cost_limits/api_usage/api_slots tables.
 * 
 * Usage:
 *   const costHelper = new CostControlHelper(supabase, jobId, workerId);
 *   
 *   // Before expensive call:
 *   const canProceed = await costHelper.checkAndAcquire('openai_image', 'scene_3');
 *   if (!canProceed.allowed) {
 *     // Handle limit reached - fail step with 'cost_limit' class
 *   }
 *   
 *   // After successful call:
 *   await costHelper.recordUsage('openai_image', idempotencyKey, { image_count: 1 });
 *   await costHelper.releaseSlot('openai_image', 'scene_3');
 * 
 * Related: ROADMAP.md Item #6 "Cost Controls / Rate Limits"
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type ServiceType = 'openai_text' | 'openai_image' | 'elevenlabs' | 'ffmpeg_renderer' | 'creatomate';

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  slotId?: string;
  checksFailed?: Array<{
    check: string;
    limit: number;
    current: number;
    message: string;
  }>;
  estimatedCostCents?: number;
}

export interface UsageRecordResult {
  success: boolean;
  idempotencyHit: boolean;
  usageId?: string;
  estimatedCostCents?: number;
}

export interface UsageMetrics {
  units?: number;
  tokens_input?: number;
  tokens_output?: number;
  chars_processed?: number;
  render_seconds?: number;  // For ffmpeg_renderer
  image_count?: number;
  estimated_cost_cents?: number;
  model?: string;           // e.g., 'gpt-image-1', 'gpt-4o', 'eleven_turbo_v2_5'
  request_id?: string;      // Provider's request ID
}

export class CostControlHelper {
  private supabase: SupabaseClient;
  private jobId: string;
  private workerId: string;
  private acquiredSlots: Map<string, string> = new Map(); // service:operation -> slotId

  constructor(supabase: SupabaseClient, jobId: string, workerId: string) {
    this.supabase = supabase;
    this.jobId = jobId;
    this.workerId = workerId;
  }

  /**
   * Check budget and acquire concurrency slot in one call.
   * Use this before making an expensive API call.
   */
  async checkAndAcquire(
    service: ServiceType,
    operation?: string,
    unitsNeeded: number = 1
  ): Promise<BudgetCheckResult> {
    // Step 1: Check budget
    const { data: budgetCheck, error: budgetError } = await this.supabase
      .rpc('check_budget', {
        p_service: service,
        p_job_id: this.jobId,
        p_units_needed: unitsNeeded,
      });

    if (budgetError) {
      console.error(`[CostControl] Budget check failed:`, budgetError);
      return {
        allowed: false,
        reason: `Budget check error: ${budgetError.message}`,
      };
    }

    if (!budgetCheck.can_proceed) {
      return {
        allowed: false,
        reason: budgetCheck.checks_failed?.[0]?.message || 'Budget limit reached',
        checksFailed: budgetCheck.checks_failed,
        estimatedCostCents: budgetCheck.estimated_cost_cents,
      };
    }

    // Step 2: Acquire concurrency slot
    const { data: slotResult, error: slotError } = await this.supabase
      .rpc('acquire_api_slot', {
        p_service: service,
        p_job_id: this.jobId,
        p_worker_id: this.workerId,
        p_operation: operation || null,
        p_lease_seconds: 300, // 5 minutes
      });

    if (slotError) {
      console.error(`[CostControl] Slot acquisition failed:`, slotError);
      return {
        allowed: false,
        reason: `Slot acquisition error: ${slotError.message}`,
      };
    }

    if (!slotResult.acquired) {
      return {
        allowed: false,
        reason: slotResult.message || 'Could not acquire concurrency slot',
      };
    }

    // Track acquired slot for cleanup
    const slotKey = `${service}:${operation || 'default'}`;
    if (slotResult.slot_id) {
      this.acquiredSlots.set(slotKey, slotResult.slot_id);
    }

    return {
      allowed: true,
      slotId: slotResult.slot_id,
      estimatedCostCents: budgetCheck.estimated_cost_cents,
    };
  }

  /**
   * Record API usage after a successful call.
   * Handles idempotency - won't double-count if same key already recorded.
   */
  async recordUsage(
    service: ServiceType,
    idempotencyKey: string,
    metrics: UsageMetrics = {},
    stepName?: string,
    operation?: string
  ): Promise<UsageRecordResult> {
    const { data, error } = await this.supabase
      .rpc('record_api_usage', {
        p_service: service,
        p_idempotency_key: idempotencyKey,
        p_job_id: this.jobId,
        p_step_name: stepName || null,
        p_operation: operation || null,
        p_units: metrics.units || 1,
        p_tokens_input: metrics.tokens_input || null,
        p_tokens_output: metrics.tokens_output || null,
        p_chars_processed: metrics.chars_processed || null,
        p_image_count: metrics.image_count || null,
        p_render_seconds: metrics.render_seconds || null,
        p_estimated_cost_cents: metrics.estimated_cost_cents || null,
        p_model: metrics.model || null,
        p_request_id: metrics.request_id || null,
      });

    if (error) {
      console.error(`[CostControl] Usage recording failed:`, error);
      return { success: false, idempotencyHit: false };
    }

    return {
      success: data.success,
      idempotencyHit: data.idempotency_hit,
      usageId: data.usage_id,
      estimatedCostCents: data.estimated_cost_cents,
    };
  }

  /**
   * Release a concurrency slot after the operation completes.
   */
  async releaseSlot(service: ServiceType, operation?: string): Promise<boolean> {
    const slotKey = `${service}:${operation || 'default'}`;
    const slotId = this.acquiredSlots.get(slotKey);

    const { error } = await this.supabase
      .rpc('release_api_slot', {
        p_slot_id: slotId || null,
        p_service: service,
        p_job_id: this.jobId,
        p_worker_id: this.workerId,
        p_operation: operation || null,
      });

    if (error) {
      console.error(`[CostControl] Slot release failed:`, error);
      return false;
    }

    this.acquiredSlots.delete(slotKey);
    return true;
  }

  /**
   * Release all acquired slots (cleanup on job completion/failure).
   */
  async releaseAllSlots(): Promise<void> {
    for (const [slotKey, slotId] of this.acquiredSlots) {
      const [service, operation] = slotKey.split(':');
      await this.releaseSlot(service as ServiceType, operation === 'default' ? undefined : operation);
    }
  }

  /**
   * Generate idempotency key for an operation.
   * Format: job:{jobId}:{service}:{stepName}:{operationId}
   */
  static generateIdempotencyKey(
    jobId: string,
    service: ServiceType,
    stepName: string,
    operationId?: string | number
  ): string {
    const parts = ['job', jobId, service, stepName];
    if (operationId !== undefined) {
      parts.push(String(operationId));
    }
    return parts.join(':');
  }

  /**
   * Generate idempotency key from content hash (for external API deduplication).
   * Use this when you want to skip API calls for identical content.
   */
  static generateContentIdempotencyKey(
    service: ServiceType,
    contentHash: string
  ): string {
    return `content:${service}:${contentHash}`;
  }
}

/**
 * Classify a cost-limit failure for DLQ recording.
 * Returns 'misconfig' for budget/rate issues - this is NOT auto-retried
 * because it requires operator action (raise budget, wait for daily reset).
 * 
 * From user spec: "I recommend failure_class = 'misconfig' with a clear error like:
 * 'cost_limit_exceeded: openai_image daily budget reached'
 * This prevents auto-pauses meant for outages and keeps it from being retried forever
 * unless you explicitly requeue/raise budgets."
 */
export function classifyCostFailure(reason: string): 'misconfig' {
  // Cost limits are operator-actionable, not auto-retryable
  // Use 'misconfig' so DLQ doesn't auto-retry or auto-pause campaigns
  return 'misconfig';
}

/**
 * Throws an error if cost budget is exceeded.
 * Use this as a guard before expensive API calls.
 * 
 * Example:
 *   await assertCanSpend(costHelper, 'openai_image', 'scene_3', 1);
 *   // ... make API call ...
 */
export async function assertCanSpend(
  helper: CostControlHelper,
  service: ServiceType,
  operation: string,
  unitsNeeded: number = 1
): Promise<{ slotId?: string }> {
  const check = await helper.checkAndAcquire(service, operation, unitsNeeded);
  if (!check.allowed) {
    const errorMsg = `cost_limit_exceeded: ${service} ${check.reason || 'budget reached'}`;
    const error = new Error(errorMsg);
    (error as unknown as { costLimitExceeded: boolean; service: string; reason: string }).costLimitExceeded = true;
    (error as unknown as { costLimitExceeded: boolean; service: string; reason: string }).service = service;
    (error as unknown as { costLimitExceeded: boolean; service: string; reason: string }).reason = check.reason || '';
    throw error;
  }
  return { slotId: check.slotId };
}

/**
 * Check if an error is a cost-limit error.
 */
export function isCostLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    return (error as unknown as { costLimitExceeded?: boolean }).costLimitExceeded === true ||
           error.message.includes('cost_limit_exceeded');
  }
  return false;
}

/**
 * Helper to wrap an expensive operation with cost controls.
 * 
 * Example:
 *   const result = await withCostControl(
 *     costHelper,
 *     'openai_image',
 *     'scene_3',
 *     async () => {
 *       // Make the API call
 *       const image = await generateImage(prompt);
 *       return { result: image, metrics: { image_count: 1, model: 'gpt-image-1' } };
 *     },
 *     idempotencyKey,
 *     'images'
 *   );
 */
export async function withCostControl<T>(
  helper: CostControlHelper,
  service: ServiceType,
  operation: string,
  fn: () => Promise<{ result: T; metrics?: UsageMetrics }>,
  idempotencyKey: string,
  stepName?: string,
  unitsNeeded: number = 1
): Promise<{ success: true; result: T; idempotencyHit: boolean } | { success: false; reason: string; retryable: boolean }> {
  // Check budget and acquire slot
  const check = await helper.checkAndAcquire(service, operation, unitsNeeded);
  if (!check.allowed) {
    return {
      success: false,
      reason: check.reason || 'Cost limit reached',
      retryable: true, // Cost limits are retryable after backoff
    };
  }

  try {
    // Execute the operation
    const { result, metrics } = await fn();

    // Record usage
    const usage = await helper.recordUsage(service, idempotencyKey, metrics, stepName, operation);

    return {
      success: true,
      result,
      idempotencyHit: usage.idempotencyHit,
    };
  } finally {
    // Always release slot
    await helper.releaseSlot(service, operation);
  }
}
