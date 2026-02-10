// =====================================================
// STEP LOGGER - Visual Logs + Timeline Integration
// =====================================================
// 
// Provides lightweight logging for worker steps:
// - started: When step begins
// - progress: During long operations (images loop)
// - completed: After step success
// - failed: On step failure
// - snapshot: Prompts/outputs for debugging
// 
// Features:
// - Copy/paste friendly messages
// - Auto-truncation of large data (max 4KB)
// - Structured meta for UI parsing
// =====================================================

import { SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

// =====================================================
// TYPES
// =====================================================

export type LogEventType = 'started' | 'progress' | 'completed' | 'failed' | 'snapshot';

export interface LogMeta {
  // Progress tracking
  current?: number;
  total?: number;
  progress_pct?: number;
  
  // Snapshot data (truncated)
  snapshot_type?: 'prompt' | 'response' | 'payload' | 'output';
  prompt?: string;
  response?: string;
  payload?: Record<string, unknown>;
  output_url?: string;
  output_urls?: string[];
  
  // Error details
  error_code?: string;
  error_class?: string;
  stack?: string;
  
  // Step-specific data
  model?: string;
  service?: string;
  duration_ms?: number;
  
  // Generic extras
  [key: string]: unknown;
}

// =====================================================
// CONSTANTS
// =====================================================

const MAX_META_SIZE = 4096; // 4KB max for meta
const MAX_STRING_LENGTH = 1000; // Truncate individual strings
const MAX_ARRAY_ITEMS = 10; // Max items in arrays

// =====================================================
// STEP LOGGER CLASS
// =====================================================

export class StepLogger {
  private supabase: SupabaseClient;
  private jobId: string;
  private workerId: string | null;
  private attempt: number;
  private enabled: boolean;

  constructor(
    supabase: SupabaseClient, 
    jobId: string, 
    workerId: string | null = null,
    attempt: number = 1,
    enabled: boolean = true
  ) {
    this.supabase = supabase;
    this.jobId = jobId;
    this.workerId = workerId;
    this.attempt = attempt;
    this.enabled = enabled;
  }

  /**
   * Log step started
   */
  async started(stepName: string, message?: string, meta?: LogMeta): Promise<void> {
    const msg = message || `Starting ${stepName} step`;
    await this.log(stepName, 'started', msg, meta);
  }

  /**
   * Log progress during long operations
   */
  async progress(
    stepName: string, 
    current: number, 
    total: number, 
    message?: string,
    meta?: LogMeta
  ): Promise<void> {
    const pct = Math.round((current / total) * 100);
    const msg = message || `${stepName} progress: ${current}/${total} (${pct}%)`;
    await this.log(stepName, 'progress', msg, {
      current,
      total,
      progress_pct: pct,
      ...meta
    });
  }

  /**
   * Log step completed
   */
  async completed(stepName: string, message?: string, meta?: LogMeta): Promise<void> {
    const msg = message || `Completed ${stepName} step`;
    await this.log(stepName, 'completed', msg, meta);
  }

  /**
   * Log step failed
   */
  async failed(
    stepName: string, 
    error: Error | string, 
    meta?: LogMeta
  ): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : error;
    const msg = `Failed: ${errorMsg}`;
    
    const errorMeta: LogMeta = {
      error_code: meta?.error_code,
      error_class: meta?.error_class,
      ...meta
    };
    
    // Include stack trace (truncated)
    if (error instanceof Error && error.stack) {
      errorMeta.stack = this.truncateString(error.stack, 500);
    }
    
    await this.log(stepName, 'failed', msg, errorMeta);
  }

  /**
   * Log a snapshot (prompt/response/payload)
   */
  async snapshot(
    stepName: string,
    snapshotType: 'prompt' | 'response' | 'payload' | 'output',
    data: unknown,
    message?: string
  ): Promise<void> {
    const msg = message || `${snapshotType} snapshot for ${stepName}`;
    
    const meta: LogMeta = {
      snapshot_type: snapshotType
    };
    
    // Handle different data types
    if (typeof data === 'string') {
      if (snapshotType === 'prompt') {
        meta.prompt = this.truncateString(data);
      } else if (snapshotType === 'response') {
        meta.response = this.truncateString(data);
      } else if (snapshotType === 'output') {
        meta.output_url = data;
      }
    } else if (Array.isArray(data)) {
      meta.output_urls = data.slice(0, MAX_ARRAY_ITEMS).map(String);
    } else if (typeof data === 'object' && data !== null) {
      meta.payload = this.truncateObject(data as Record<string, unknown>);
    }
    
    await this.log(stepName, 'snapshot', msg, meta);
  }

  /**
   * Core logging function
   */
  private async log(
    stepName: string,
    eventType: LogEventType,
    message: string,
    meta?: LogMeta
  ): Promise<void> {
    if (!this.enabled) return;
    
    try {
      const truncatedMeta = meta ? this.truncateMeta(meta) : {};
      
      const { error } = await this.supabase.rpc('log_job_step_event', {
        p_job_id: this.jobId,
        p_step_name: stepName,
        p_event_type: eventType,
        p_message: message.slice(0, 500), // Max 500 chars for message
        p_meta: truncatedMeta,
        p_attempt: this.attempt,
        p_worker_id: this.workerId
      });
      
      if (error) {
        // Don't throw - logging should never break the worker
        console.warn(`[LOGGER] Failed to log event: ${error.message}`);
      }
    } catch (err) {
      // Silently fail - logging is non-critical
      console.warn(`[LOGGER] Exception logging event: ${err}`);
    }
  }

  /**
   * Truncate meta object to max size
   */
  private truncateMeta(meta: LogMeta): LogMeta {
    const result: LogMeta = {};
    
    for (const [key, value] of Object.entries(meta)) {
      if (value === undefined || value === null) continue;
      
      if (typeof value === 'string') {
        result[key] = this.truncateString(value);
      } else if (Array.isArray(value)) {
        result[key] = value.slice(0, MAX_ARRAY_ITEMS);
      } else if (typeof value === 'object') {
        result[key] = this.truncateObject(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    
    // Final size check
    const json = JSON.stringify(result);
    if (json.length > MAX_META_SIZE) {
      // If still too large, keep only essential fields
      return {
        truncated: true,
        snapshot_type: result.snapshot_type,
        error_code: result.error_code,
        error_class: result.error_class,
        current: result.current,
        total: result.total,
        progress_pct: result.progress_pct
      };
    }
    
    return result;
  }

  /**
   * Truncate a string to max length
   */
  private truncateString(str: string, maxLength: number = MAX_STRING_LENGTH): string {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 20) + '... [truncated]';
  }

  /**
   * Truncate an object (shallow)
   */
  private truncateObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let size = 0;
    const maxSize = 2000; // 2KB per object
    
    for (const [key, value] of Object.entries(obj)) {
      if (size > maxSize) {
        result._truncated = true;
        break;
      }
      
      if (typeof value === 'string') {
        result[key] = this.truncateString(value, 500);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        result[key] = value;
      } else if (Array.isArray(value)) {
        result[key] = value.slice(0, 5);
      } else if (value === null || value === undefined) {
        // Skip
      } else {
        result[key] = '[object]';
      }
      
      size += JSON.stringify(result[key] || '').length;
    }
    
    return result;
  }
}

// =====================================================
// HELPER FUNCTIONS FOR FORMATTED MESSAGES
// =====================================================

/**
 * Format image generation progress message
 */
export function formatImageProgress(
  sceneIndex: number, 
  totalScenes: number, 
  model: string,
  dimensions: string
): string {
  return `scene ${sceneIndex}/${totalScenes} generated (model=${model}, ${dimensions})`;
}

/**
 * Format voice synthesis message
 */
export function formatVoiceMessage(
  voiceId: string,
  durationMs: number,
  charCount: number
): string {
  const durationSec = (durationMs / 1000).toFixed(1);
  return `voice synthesized (voice=${voiceId}, ${durationSec}s, ${charCount} chars)`;
}

/**
 * Format video assembly message
 */
export function formatAssemblyMessage(
  renderer: string,
  scenes: number,
  durationSec: number
): string {
  return `video assembled (renderer=${renderer}, ${scenes} scenes, ${durationSec.toFixed(1)}s)`;
}

/**
 * Format upload message
 */
export function formatUploadMessage(
  assetType: string,
  sizeMB: number,
  path: string
): string {
  const shortPath = path.split('/').slice(-2).join('/');
  return `${assetType} uploaded (${sizeMB.toFixed(2)}MB) → ${shortPath}`;
}

/**
 * Format error message with classification
 */
export function formatErrorMessage(
  error: string,
  errorClass?: string,
  service?: string
): string {
  let msg = error.slice(0, 200);
  if (errorClass) msg += ` [${errorClass}]`;
  if (service) msg += ` (${service})`;
  return msg;
}
