// =====================================================
// POST-WORKER EDGE FUNCTION
// Processes posts from the queue and uploads to platforms
// 
// Reference: POST_QUEUE.md, ROADMAP.md Item #9
// 
// v1.0 - 2026-02-23: Initial implementation with stub adapters
// 
// This function:
// 1. Checks global kill switch
// 2. Receives post_id (or claims from queue)
// 3. Validates post ownership (lease)
// 4. Calls platform adapter (stubbed for now)
// 5. Updates post status (posted/failed)
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

// =====================================================
// VERSION
// =====================================================
const VERSION = "1.0";

// =====================================================
// CONFIGURATION
// =====================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Default lease duration (seconds)
const DEFAULT_LEASE_SECONDS = 300; // 5 minutes

// =====================================================
// TYPES
// =====================================================

interface PostToClaim {
  post_id: string;
  job_id: string | null;
  brand_id: string;
  batch_id: string | null;
  platform: string;
  video_url: string;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  scheduled_at: string;
  attempt_count: number;
  meta: Record<string, unknown> | null;
}

interface PlatformResult {
  success: boolean;
  platform_post_id?: string;
  platform_url?: string;
  error_class?: 'transient' | 'dependency' | 'misconfig' | 'permanent';
  error_message?: string;
}

interface PostWorkerResult {
  success: boolean;
  version: string;
  worker_id: string;
  posts_processed: number;
  posts_posted: number;
  posts_failed: number;
  posts_skipped: number;
  errors: string[];
  details: {
    post_id: string;
    platform: string;
    status: 'posted' | 'failed' | 'skipped';
    platform_post_id?: string;
    platform_url?: string;
    error?: string;
  }[];
}

// =====================================================
// PLATFORM ADAPTERS (STUBBED)
// =====================================================

/**
 * Platform adapter interface
 */
interface PlatformAdapter {
  name: string;
  post(
    videoUrl: string,
    title: string,
    description: string | null,
    tags: string[] | null,
    meta: Record<string, unknown>
  ): Promise<PlatformResult>;
}

/**
 * Stub adapter that simulates successful posting
 * In production, this would make actual API calls
 */
class StubAdapter implements PlatformAdapter {
  name: string;
  
  constructor(platform: string) {
    this.name = platform;
  }
  
  async post(
    videoUrl: string,
    title: string,
    description: string | null,
    tags: string[] | null,
    meta: Record<string, unknown>
  ): Promise<PlatformResult> {
    // Simulate network delay
    await new Promise(r => setTimeout(r, 500));
    
    // Generate fake platform IDs
    const fakeId = `stub_${this.name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fakeUrl = `https://${this.name}.com/v/${fakeId}`;
    
    console.log(`[STUB:${this.name}] Posted video: ${title?.slice(0, 50)}`);
    console.log(`[STUB:${this.name}] Platform ID: ${fakeId}`);
    console.log(`[STUB:${this.name}] Platform URL: ${fakeUrl}`);
    
    return {
      success: true,
      platform_post_id: fakeId,
      platform_url: fakeUrl,
    };
  }
}

/**
 * TikTok adapter (stubbed)
 */
class TikTokAdapter extends StubAdapter {
  constructor() {
    super('tiktok');
  }
  
  async post(
    videoUrl: string,
    title: string,
    description: string | null,
    tags: string[] | null,
    meta: Record<string, unknown>
  ): Promise<PlatformResult> {
    // TikTok-specific validation
    if (!videoUrl) {
      return {
        success: false,
        error_class: 'misconfig',
        error_message: 'TikTok requires a video URL',
      };
    }
    
    // Delegate to stub
    return super.post(videoUrl, title, description, tags, meta);
  }
}

/**
 * YouTube adapter (stubbed)
 */
class YouTubeAdapter extends StubAdapter {
  constructor() {
    super('youtube');
  }
  
  async post(
    videoUrl: string,
    title: string,
    description: string | null,
    tags: string[] | null,
    meta: Record<string, unknown>
  ): Promise<PlatformResult> {
    // YouTube-specific validation
    if (!title || title.length > 100) {
      return {
        success: false,
        error_class: 'misconfig',
        error_message: 'YouTube requires a title under 100 characters',
      };
    }
    
    return super.post(videoUrl, title, description, tags, meta);
  }
}

/**
 * Instagram adapter (stubbed)
 */
class InstagramAdapter extends StubAdapter {
  constructor() {
    super('instagram');
  }
}

/**
 * Get adapter for platform
 */
function getAdapter(platform: string): PlatformAdapter {
  switch (platform.toLowerCase()) {
    case 'tiktok':
      return new TikTokAdapter();
    case 'youtube':
      return new YouTubeAdapter();
    case 'instagram':
      return new InstagramAdapter();
    default:
      // Generic stub for unknown platforms
      return new StubAdapter(platform);
  }
}

// =====================================================
// KILL SWITCH CHECK
// =====================================================

async function isKillSwitchActive(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_kill_switch_active');
  
  if (error) {
    console.warn(`[POST-WORKER] Kill switch check failed: ${error.message}, assuming inactive`);
    return false;
  }
  
  return data === true;
}

// =====================================================
// POST PROCESSING
// =====================================================

/**
 * Process a single post
 */
async function processPost(
  supabase: SupabaseClient,
  post: PostToClaim,
  workerId: string
): Promise<{ status: 'posted' | 'failed' | 'skipped'; result: PlatformResult }> {
  // Idempotency key for debugging
  const idempotencyKey = `${post.job_id || 'no-job'}:${post.platform}`;
  
  console.log(`[POST-WORKER] Processing post ${post.post_id} [${idempotencyKey}]`);
  console.log(`[POST-WORKER] Video: ${post.video_url?.slice(0, 80)}...`);
  console.log(`[POST-WORKER] Title: ${post.title?.slice(0, 50)}`);
  console.log(`[POST-WORKER] Attempt: ${post.attempt_count}`);
  
  try {
    // Get platform adapter
    const adapter = getAdapter(post.platform);
    
    // Call platform API (stubbed)
    const result = await adapter.post(
      post.video_url,
      post.title || 'Untitled',
      post.description,
      post.tags,
      post.meta || {}
    );
    
    if (result.success) {
      // Mark as posted
      const { data, error } = await supabase.rpc('mark_post_posted', {
        p_post_id: post.post_id,
        p_worker_id: workerId,
        p_platform_post_id: result.platform_post_id,
        p_platform_url: result.platform_url,
        p_meta: {
          posted_by: workerId,
          adapter: adapter.name,
          adapter_version: 'stub_1.0',
        },
      });
      
      if (error) {
        console.error(`[POST-WORKER] mark_post_posted error: ${error.message}`);
        return {
          status: 'failed',
          result: {
            success: false,
            error_class: 'transient',
            error_message: `DB update failed: ${error.message}`,
          },
        };
      }
      
      console.log(`[POST-WORKER] ✓ Posted: ${result.platform_url}`);
      return { status: 'posted', result };
    } else {
      // Platform returned failure - build error signature for cluster detection
      const errorSig = `${result.error_class || 'transient'}:${post.platform}:${result.error_message?.slice(0, 30).replace(/[^a-z0-9_]/gi, '_') || 'unknown'}`;
      
      const { error } = await supabase.rpc('mark_post_failed', {
        p_post_id: post.post_id,
        p_worker_id: workerId,
        p_error_class: result.error_class || 'transient',
        p_error_message: result.error_message || 'Unknown platform error',
        p_retryable: result.error_class !== 'permanent' && result.error_class !== 'misconfig',
        p_error_signature: errorSig,
      });
      
      if (error) {
        console.error(`[POST-WORKER] mark_post_failed error: ${error.message}`);
      }
      
      console.log(`[POST-WORKER] ✗ Failed: ${result.error_message}`);
      return { status: 'failed', result };
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[POST-WORKER] Exception: ${errorMessage}`);
    
    // Build error signature for cluster detection
    const errorSig = `transient:${post.platform}:exception`;
    
    // Mark as failed (transient by default for exceptions)
    await supabase.rpc('mark_post_failed', {
      p_post_id: post.post_id,
      p_worker_id: workerId,
      p_error_class: 'transient',
      p_error_message: errorMessage,
      p_retryable: true,
      p_error_signature: errorSig,
    });
    
    return {
      status: 'failed',
      result: {
        success: false,
        error_class: 'transient',
        error_message: errorMessage,
      },
    };
  }
}

// =====================================================
// MAIN HANDLER
// =====================================================

serve(async (req: Request) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const workerId = `post-worker-${crypto.randomUUID().slice(0, 8)}`;
  
  console.log(`[POST-WORKER] v${VERSION} Starting (worker_id=${workerId})`);

  // Initialize result
  const result: PostWorkerResult = {
    success: true,
    version: VERSION,
    worker_id: workerId,
    posts_processed: 0,
    posts_posted: 0,
    posts_failed: 0,
    posts_skipped: 0,
    errors: [],
    details: [],
  };

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check kill switch
    if (await isKillSwitchActive(supabase)) {
      console.log(`[POST-WORKER] Kill switch active, aborting`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Kill switch active',
          version: VERSION,
          worker_id: workerId,
        }),
        { 
          status: 503, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // Parse request body
    let postIds: string[] = [];
    let claimFromQueue = false;
    let claimLimit = 5;
    
    if (req.method === "POST") {
      try {
        const body = await req.json();
        
        if (body.post_id) {
          postIds = [body.post_id];
        } else if (Array.isArray(body.post_ids)) {
          postIds = body.post_ids;
        } else if (body.claim_from_queue) {
          claimFromQueue = true;
          claimLimit = body.limit || 5;
        }
      } catch {
        // Empty body = claim from queue
        claimFromQueue = true;
      }
    } else {
      // GET request = claim from queue
      claimFromQueue = true;
    }

    // Get posts to process
    let postsToProcess: PostToClaim[] = [];
    
    if (claimFromQueue) {
      // Claim posts from queue
      console.log(`[POST-WORKER] Claiming up to ${claimLimit} posts from queue`);
      
      const { data: claimed, error: claimError } = await supabase.rpc('claim_due_posts', {
        p_worker_id: workerId,
        p_limit: claimLimit,
        p_lease_seconds: DEFAULT_LEASE_SECONDS,
      });
      
      if (claimError) {
        throw new Error(`Failed to claim posts: ${claimError.message}`);
      }
      
      postsToProcess = (claimed || []) as PostToClaim[];
      console.log(`[POST-WORKER] Claimed ${postsToProcess.length} posts`);
    } else if (postIds.length > 0) {
      // Load specific posts (for targeted retry/manual trigger)
      // Note: These should already be claimed by the caller
      console.log(`[POST-WORKER] Loading ${postIds.length} specific posts`);
      
      for (const postId of postIds) {
        const { data: post, error } = await supabase
          .from('posts')
          .select('id, job_id, brand_id, batch_id, platform, video_url, title, description, tags, scheduled_at, attempt_count, meta, locked_by, status')
          .eq('id', postId)
          .single();
        
        if (error || !post) {
          result.errors.push(`Post ${postId}: not found`);
          result.details.push({
            post_id: postId,
            platform: 'unknown',
            status: 'skipped',
            error: 'Post not found',
          });
          result.posts_skipped++;
          continue;
        }
        
        // Check status - prevent double-post
        if (post.status === 'posted') {
          console.log(`[POST-WORKER] Post ${postId} already posted, skipping`);
          result.details.push({
            post_id: postId,
            platform: post.platform,
            status: 'skipped',
            error: 'Already posted',
          });
          result.posts_skipped++;
          continue;
        }
        
        // Check for active lease by another worker
        if (post.status === 'posting' && post.locked_by && post.locked_by !== workerId) {
          console.log(`[POST-WORKER] Post ${postId} owned by different worker ${post.locked_by}, skipping`);
          result.details.push({
            post_id: postId,
            platform: post.platform,
            status: 'skipped',
            error: `Owned by worker ${post.locked_by}`,
          });
          result.posts_skipped++;
          continue;
        }
        
        // Claim if not already owned
        if (post.locked_by !== workerId && post.status === 'scheduled') {
          const { data: claimResult } = await supabase.rpc('claim_due_posts', {
            p_worker_id: workerId,
            p_limit: 1,
            p_lease_seconds: DEFAULT_LEASE_SECONDS,
          });
          
          // Verify we claimed this specific post
          const claimed = claimResult?.find((c: PostToClaim) => c.post_id === postId);
          if (!claimed) {
            result.errors.push(`Post ${postId}: could not claim`);
            result.details.push({
              post_id: postId,
              platform: post.platform,
              status: 'skipped',
              error: 'Could not claim',
            });
            result.posts_skipped++;
            continue;
          }
        }
        
        postsToProcess.push({
          post_id: post.id,
          job_id: post.job_id,
          brand_id: post.brand_id,
          batch_id: post.batch_id,
          platform: post.platform,
          video_url: post.video_url,
          title: post.title,
          description: post.description,
          tags: post.tags,
          scheduled_at: post.scheduled_at,
          attempt_count: post.attempt_count || 0,
          meta: post.meta,
        });
      }
    }

    // Process each post
    for (const post of postsToProcess) {
      result.posts_processed++;
      
      const { status, result: platformResult } = await processPost(supabase, post, workerId);
      
      result.details.push({
        post_id: post.post_id,
        platform: post.platform,
        status,
        platform_post_id: platformResult.platform_post_id,
        platform_url: platformResult.platform_url,
        error: platformResult.error_message,
      });
      
      if (status === 'posted') {
        result.posts_posted++;
      } else if (status === 'failed') {
        result.posts_failed++;
        result.errors.push(`${post.platform}:${post.post_id}: ${platformResult.error_message}`);
      } else {
        result.posts_skipped++;
      }
    }

    // Determine overall success
    result.success = result.posts_failed === 0 || result.posts_posted > 0;

    const duration = Date.now() - startTime;
    console.log(`[POST-WORKER] Completed in ${duration}ms: ${result.posts_posted} posted, ${result.posts_failed} failed, ${result.posts_skipped} skipped`);

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[POST-WORKER] Fatal error: ${errorMessage}`);
    
    result.success = false;
    result.errors.push(errorMessage);

    return new Response(
      JSON.stringify(result),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
