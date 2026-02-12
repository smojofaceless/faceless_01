// =====================================================
// CLASSIFY ERROR - Failure Classification System
// =====================================================
// Categorizes errors for:
// - Retry decisions (transient vs permanent)
// - Cluster detection (grouping by signature)
// - DLQ analysis (operator review)
// =====================================================

export type FailureClass = 'transient' | 'dependency' | 'misconfig' | 'permanent';

export interface ClassifiedFailure {
  step: string;
  class: FailureClass;
  error: string;
  message?: string; // Human-readable error message
  error_code?: string;
  at: string; // ISO timestamp
  signature: string; // Hash for clustering
}

interface ErrorContext {
  step: string;
  statusCode?: number;
  errorCode?: string;
  message?: string;
}

/**
 * Classification rules (order matters - first match wins):
 * 
 * DEPENDENCY (external service down) - Check FIRST for known services:
 *   - HTTP 5xx from known services (OpenAI, ElevenLabs, FFmpeg, storage)
 *   - Service-specific error patterns
 *   - Storage upload failures
 * 
 * TRANSIENT (auto-retry safe) - Network/rate issues:
 *   - HTTP 429 (rate limit) without service context
 *   - Network timeouts, ECONNRESET, ETIMEDOUT
 *   - Generic connection issues (no known service)
 * 
 * MISCONFIG (operator action required):
 *   - HTTP 401/403 (auth failures)
 *   - Missing API keys
 *   - Invalid credentials
 *   - Missing env vars
 * 
 * PERMANENT (do not retry):
 *   - HTTP 400 (bad request - our bug)
 *   - Content policy violations
 *   - Invalid job data
 *   - Schema validation failures
 * 
 * IMPORTANT: 5xx errors from external services → DEPENDENCY (clusters trigger auto-pause)
 *            5xx from unknown/generic sources → TRANSIENT (simple retry)
 */
export function classifyError(err: Error | unknown, context: Partial<ErrorContext>): ClassifiedFailure {
  const message = err instanceof Error ? err.message : String(err);
  const step = context.step || 'unknown';
  const statusCode = context.statusCode || extractStatusCode(err);
  const errorCode = context.errorCode || extractErrorCode(err);

  let failureClass: FailureClass = 'permanent'; // Default to safest option

  // Known external services (case-insensitive check)
  const isKnownService = /openai|elevenlabs|ffmpeg|renderer|creatomate|supabase.*storage|dall-?e|gpt-image/i.test(message);
  
  // Step-based service inference (if message doesn't mention service)
  const isServiceStep = ['images', 'voice', 'assemble', 'upload'].includes(step);

  // === DEPENDENCY (external service issue) - CHECK FIRST ===
  // 5xx from known services = dependency (triggers auto-pause)
  if (statusCode && statusCode >= 500 && statusCode < 600 && (isKnownService || isServiceStep)) {
    failureClass = 'dependency';
  } else if (/openai|elevenlabs|ffmpeg|renderer|creatomate/i.test(message) && 
             /fail|error|unavailable|down|5\d{2}/i.test(message)) {
    failureClass = 'dependency';
  } else if (/supabase.*storage|upload.*fail|storage.*error|bucket.*not.*found/i.test(message)) {
    failureClass = 'dependency';
  } else if (/render.*fail|video.*generation.*fail/i.test(message)) {
    failureClass = 'dependency';
  }

  // === TRANSIENT (can auto-retry) - Network/rate issues ===
  else if (statusCode === 429) {
    failureClass = 'transient';
  } else if (statusCode && [502, 503, 504].includes(statusCode)) {
    // Generic gateway errors (not from known service) = transient
    failureClass = 'transient';
  } else if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|timeout|timed out/i.test(message)) {
    failureClass = 'transient';
  } else if (/rate.?limit|too many requests|quota exceeded/i.test(message)) {
    failureClass = 'transient';
  } else if (/network|connection refused|socket hang up/i.test(message)) {
    failureClass = 'transient';
  }

  // === MISCONFIG (operator needs to fix) ===
  else if (statusCode && [401, 403].includes(statusCode)) {
    failureClass = 'misconfig';
  } else if (/api.?key|credentials|unauthorized|forbidden|not.*configured/i.test(message)) {
    failureClass = 'misconfig';
  } else if (/env.*missing|env.*not.*set|secret.*not.*found/i.test(message)) {
    failureClass = 'misconfig';
  } else if (/missing.*OPENAI|missing.*ELEVENLABS|missing.*SUPABASE/i.test(message)) {
    failureClass = 'misconfig';
  }

  // === PERMANENT (do not retry) ===
  else if (statusCode === 400) {
    failureClass = 'permanent';
  } else if (/content.*policy|safety.*system|invalid.*request|validation.*fail/i.test(message)) {
    failureClass = 'permanent';
  } else if (/job.*not.*found|brand.*not.*found|missing.*required/i.test(message)) {
    failureClass = 'permanent';
  } else if (/invalid.*json|parse.*error|syntax.*error/i.test(message)) {
    failureClass = 'permanent';
  } else if (/0 scenes generated|no scenes|empty scenes/i.test(message)) {
    failureClass = 'permanent';
  }

  // Generate signature for clustering (normalize message)
  const signature = generateErrorSignature(step, failureClass, message, errorCode);

  return {
    step,
    class: failureClass,
    error: message.slice(0, 500), // Truncate for storage
    error_code: errorCode,
    at: new Date().toISOString(),
    signature,
  };
}

/**
 * Generate a stable signature for error clustering.
 * Removes variable parts (IDs, timestamps) to group similar errors.
 */
function generateErrorSignature(step: string, failureClass: FailureClass, message: string, errorCode?: string): string {
  // Normalize message: remove UUIDs, numbers, timestamps
  const normalized = message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '<timestamp>')
    .replace(/\d+/g, '<n>')
    .trim()
    .slice(0, 100);

  // Simple hash (for grouping, not security)
  const input = `${step}:${failureClass}:${errorCode || ''}:${normalized}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Helper to extract status code from various error formats
 */
export function extractStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  
  const e = err as Record<string, unknown>;
  
  // Direct status
  if (typeof e.status === 'number') return e.status;
  if (typeof e.statusCode === 'number') return e.statusCode;
  
  // Nested response
  if (e.response && typeof e.response === 'object') {
    const resp = e.response as Record<string, unknown>;
    if (typeof resp.status === 'number') return resp.status;
  }
  
  // Parse from message
  const msg = e.message;
  if (typeof msg === 'string') {
    const match = msg.match(/\b(4\d{2}|5\d{2})\b/);
    if (match) return parseInt(match[1], 10);
  }
  
  return undefined;
}

/**
 * Extract error code from error object
 */
function extractErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  
  const e = err as Record<string, unknown>;
  
  if (typeof e.code === 'string') return e.code;
  if (typeof e.error_code === 'string') return e.error_code;
  if (typeof e.errorCode === 'string') return e.errorCode;
  
  // Nested error
  if (e.error && typeof e.error === 'object') {
    const nested = e.error as Record<string, unknown>;
    if (typeof nested.code === 'string') return nested.code;
  }
  
  return undefined;
}

/**
 * Check if a failure class is retryable
 */
export function isRetryable(failureClass: FailureClass): boolean {
  return failureClass === 'transient' || failureClass === 'dependency';
}

/**
 * Get recommended action for a failure class
 */
export function getRecommendedAction(failureClass: FailureClass): string {
  switch (failureClass) {
    case 'transient':
      return 'Auto-requeue with short backoff (30 min)';
    case 'dependency':
      return 'Wait for dependency recovery, then requeue';
    case 'misconfig':
      return 'Fix configuration/credentials, then requeue';
    case 'permanent':
      return 'Review job data, may need manual intervention';
    default:
      return 'Unknown - review manually';
  }
}
