// =====================================================
// SCHEDULE-POSTS EDGE FUNCTION
// Cron-triggered scheduler that finds due posts and triggers post-worker
// 
// Reference: POST_QUEUE.md, ROADMAP.md Item #9
// 
// v1.0 - 2026-02-23: Initial implementation
// v1.1 - 2026-02-10: Per-platform throttling, failure cluster check
// 
// This function:
// 1. Checks global kill switch (aborts if active)
// 2. Sweeps stale post leases (stuck posts from crashed workers)
// 3. Checks for failure clusters (auto-throttle on platform outages)
// 4. Finds posts where scheduled_at <= NOW() and status = 'scheduled'
// 5. Applies per-platform throttle limits
// 6. Respects campaign gating (skips paused/cancelled campaigns)
// 7. Triggers post-worker with batch of due posts
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

// =====================================================
// VERSION
// =====================================================
const VERSION = "1.1";

// =====================================================
// CONFIGURATION
// =====================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Maximum posts to process per scheduler run (prevent stampedes)
const MAX_POSTS_PER_RUN = 10;

// Per-platform limits per run (prevent hammering failing platforms)
const MAX_PER_PLATFORM: Record<string, number> = {
  tiktok: 5,
  youtube: 5,
  instagram: 5,
  facebook: 5,
  default: 3, // Unknown platforms get lower limit
};

// Timeout for post-worker call (ms)
const POST_WORKER_TIMEOUT_MS = 60000;

// =====================================================
// TYPES
// =====================================================

interface DuePost {
  post_id: string;
  job_id: string | null;
  brand_id: string;
  batch_id: string | null;
  platform: string;
  scheduled_at: string;
  attempt_count: number;
  campaign_status: string | null;
}

interface StalePost {
  post_id: string;
  platform: string;
  job_id: string | null;
  stale_worker: string;
  lease_expired_at: string;
  action_taken: string;
}

interface FailureCluster {
  error_signature: string;
  platform: string;
  failure_count: number;
  first_failure: string;
  last_failure: string;
  sample_message: string;
}

interface SchedulerResult {
  success: boolean;
  version: string;
  scheduler_id: string;
  kill_switch_active: boolean;
  stale_leases_swept: number;
  posts_found: number;
  posts_throttled: number;
  posts_triggered: number;
  posts_posted: number;
  posts_failed: number;
  platform_limits: Record<string, number>;
  failing_platforms: string[];
  errors: string[];
  details: {
    post_id: string;
    platform: string;
    status: string;
    error?: string;
  }[];
}

// =====================================================
// KILL SWITCH CHECK
// =====================================================

async function isKillSwitchActive(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_kill_switch_active');
  
  if (error) {
    console.warn(`[SCHEDULE-POSTS] Kill switch check failed: ${error.message}, assuming inactive`);
    return false;
  }
  
  return data === true;
}

// =====================================================
// STALE LEASE SWEEPER
// =====================================================

async function sweepStaleLeases(supabase: SupabaseClient): Promise<StalePost[]> {
  console.log(`[SCHEDULE-POSTS] Sweeping stale post leases...`);
  
  const { data, error } = await supabase.rpc('sweep_stale_post_leases', {
    p_dry_run: false,
  });
  
  if (error) {
    console.error(`[SCHEDULE-POSTS] Sweep error: ${error.message}`);
    return [];
  }
  
  const swept = (data || []) as StalePost[];
  if (swept.length > 0) {
    console.log(`[SCHEDULE-POSTS] Swept ${swept.length} stale leases:`);
    for (const post of swept) {
      console.log(`  - ${post.post_id} (${post.platform}): was locked by ${post.stale_worker}`);
    }
  } else {
    console.log(`[SCHEDULE-POSTS] No stale leases found`);
  }
  
  return swept;
}

// =====================================================
// CHECK FAILURE CLUSTERS (Auto-throttle)
// =====================================================

async function getFailingPlatforms(supabase: SupabaseClient): Promise<string[]> {
  console.log(`[SCHEDULE-POSTS] Checking for failure clusters...`);
  
  const { data, error } = await supabase.rpc('get_post_failure_clusters', {
    p_window_minutes: 10,
    p_min_failures: 5,
  });
  
  if (error) {
    console.warn(`[SCHEDULE-POSTS] Failure cluster check failed: ${error.message}`);
    return [];
  }
  
  const clusters = (data || []) as FailureCluster[];
  
  if (clusters.length > 0) {
    console.warn(`[SCHEDULE-POSTS] ⚠️ Failure clusters detected:`);
    for (const cluster of clusters) {
      console.warn(`  - ${cluster.platform}: ${cluster.failure_count} failures (${cluster.error_signature})`);
    }
  }
  
  // Return unique platforms with active failure clusters
  return [...new Set(clusters.map(c => c.platform))];
}

// =====================================================
// APPLY PLATFORM THROTTLING
// =====================================================

function applyPlatformThrottles(
  posts: DuePost[],
  failingPlatforms: string[]
): { throttled: DuePost[]; skipped: number } {
  const platformCounts: Record<string, number> = {};
  const throttled: DuePost[] = [];
  let skipped = 0;
  
  for (const post of posts) {
    const platform = post.platform.toLowerCase();
    
    // Skip platforms with active failure clusters entirely
    if (failingPlatforms.includes(platform)) {
      console.log(`[SCHEDULE-POSTS] Skipping ${post.post_id} - ${platform} has active failures`);
      skipped++;
      continue;
    }
    
    // Check per-platform limit
    const limit = MAX_PER_PLATFORM[platform] || MAX_PER_PLATFORM.default;
    const currentCount = platformCounts[platform] || 0;
    
    if (currentCount >= limit) {
      console.log(`[SCHEDULE-POSTS] Throttled ${post.post_id} - ${platform} limit (${limit}) reached`);
      skipped++;
      continue;
    }
    
    platformCounts[platform] = currentCount + 1;
    throttled.push(post);
  }
  
  return { throttled, skipped };
}

// =====================================================
// FIND DUE POSTS
// =====================================================

async function findDuePosts(
  supabase: SupabaseClient,
  limit: number = MAX_POSTS_PER_RUN
): Promise<DuePost[]> {
  console.log(`[SCHEDULE-POSTS] Finding due posts (limit=${limit})`);
  
  const { data, error } = await supabase.rpc('find_due_posts', {
    p_limit: limit,
  });
  
  if (error) {
    console.error(`[SCHEDULE-POSTS] find_due_posts error: ${error.message}`);
    throw new Error(`Failed to find due posts: ${error.message}`);
  }
  
  const posts = (data || []) as DuePost[];
  console.log(`[SCHEDULE-POSTS] Found ${posts.length} due posts`);
  
  return posts;
}

// =====================================================
// TRIGGER POST-WORKER
// =====================================================

async function triggerPostWorker(
  supabaseUrl: string,
  supabaseKey: string,
  postIds: string[]
): Promise<{
  success: boolean;
  posts_posted: number;
  posts_failed: number;
  details: Record<string, unknown>[];
  error?: string;
}> {
  if (postIds.length === 0) {
    return { success: true, posts_posted: 0, posts_failed: 0, details: [] };
  }
  
  const postWorkerUrl = `${supabaseUrl}/functions/v1/post-worker`;
  console.log(`[SCHEDULE-POSTS] Triggering post-worker for ${postIds.length} posts`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), POST_WORKER_TIMEOUT_MS);
    
    const response = await fetch(postWorkerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        post_ids: postIds,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[SCHEDULE-POSTS] post-worker returned ${response.status}: ${errorText}`);
      return {
        success: false,
        posts_posted: 0,
        posts_failed: postIds.length,
        details: [],
        error: `post-worker returned ${response.status}: ${errorText.slice(0, 200)}`,
      };
    }
    
    const result = await response.json();
    console.log(`[SCHEDULE-POSTS] post-worker result: ${result.posts_posted} posted, ${result.posts_failed} failed`);
    
    return {
      success: result.success,
      posts_posted: result.posts_posted || 0,
      posts_failed: result.posts_failed || 0,
      details: result.details || [],
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[SCHEDULE-POSTS] post-worker call failed: ${errorMessage}`);
    return {
      success: false,
      posts_posted: 0,
      posts_failed: postIds.length,
      details: [],
      error: errorMessage,
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
  const schedulerId = `schedule-posts-${crypto.randomUUID().slice(0, 8)}`;
  
  console.log(`[SCHEDULE-POSTS] v${VERSION} Starting (scheduler_id=${schedulerId})`);

  // Initialize result
  const result: SchedulerResult = {
    success: true,
    version: VERSION,
    scheduler_id: schedulerId,
    kill_switch_active: false,
    stale_leases_swept: 0,
    posts_found: 0,
    posts_throttled: 0,
    posts_triggered: 0,
    posts_posted: 0,
    posts_failed: 0,
    platform_limits: MAX_PER_PLATFORM,
    failing_platforms: [],
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

    // 1. Check kill switch
    const killSwitchActive = await isKillSwitchActive(supabase);
    result.kill_switch_active = killSwitchActive;
    
    if (killSwitchActive) {
      console.log(`[SCHEDULE-POSTS] Kill switch active, aborting`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Kill switch active - posting paused',
          version: VERSION,
          scheduler_id: schedulerId,
          kill_switch_active: true,
        }),
        { 
          status: 503, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // 2. Sweep stale leases first
    const sweptLeases = await sweepStaleLeases(supabase);
    result.stale_leases_swept = sweptLeases.length;

    // 3. Check for failure clusters (auto-throttle)
    const failingPlatforms = await getFailingPlatforms(supabase);
    result.failing_platforms = failingPlatforms;

    // 4. Parse optional parameters
    let limit = MAX_POSTS_PER_RUN;
    let dryRun = false;
    
    if (req.method === "POST") {
      try {
        const body = await req.json();
        limit = body.limit || MAX_POSTS_PER_RUN;
        dryRun = body.dry_run === true;
      } catch {
        // Empty body is fine
      }
    }

    // 5. Find due posts
    const duePosts = await findDuePosts(supabase, limit);
    result.posts_found = duePosts.length;

    if (duePosts.length === 0) {
      console.log(`[SCHEDULE-POSTS] No due posts found`);
      const duration = Date.now() - startTime;
      console.log(`[SCHEDULE-POSTS] Completed in ${duration}ms (no work)`);
      return new Response(
        JSON.stringify(result),
        { 
          status: 200, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // 6. Apply per-platform throttling
    const { throttled: throttledPosts, skipped: throttledCount } = applyPlatformThrottles(
      duePosts,
      failingPlatforms
    );
    result.posts_throttled = throttledCount;

    if (throttledPosts.length === 0) {
      console.log(`[SCHEDULE-POSTS] All posts throttled (${throttledCount} skipped)`);
      result.details = duePosts.map(p => ({
        post_id: p.post_id,
        platform: p.platform,
        status: failingPlatforms.includes(p.platform.toLowerCase()) ? 'skipped_failing_platform' : 'throttled',
      }));
      return new Response(
        JSON.stringify(result),
        { 
          status: 200, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // Log posts to process
    console.log(`[SCHEDULE-POSTS] Posts to process (${throttledPosts.length} of ${duePosts.length}):`);
    for (const post of throttledPosts) {
      console.log(`  - ${post.post_id} (${post.platform}): scheduled=${post.scheduled_at}, attempts=${post.attempt_count}`);
    }

    // 7. Dry run mode
    if (dryRun) {
      console.log(`[SCHEDULE-POSTS] Dry run mode - not triggering post-worker`);
      result.details = throttledPosts.map(p => ({
        post_id: p.post_id,
        platform: p.platform,
        status: 'would_trigger',
      }));
      return new Response(
        JSON.stringify({ ...result, dry_run: true }),
        { 
          status: 200, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // 8. Trigger post-worker
    // Note: post-worker will claim the posts itself
    const postIds = throttledPosts.map(p => p.post_id);
    result.posts_triggered = postIds.length;
    
    const workerResult = await triggerPostWorker(supabaseUrl, supabaseKey, postIds);
    
    result.posts_posted = workerResult.posts_posted;
    result.posts_failed = workerResult.posts_failed;
    result.details = workerResult.details.map((d: Record<string, unknown>) => ({
      post_id: d.post_id as string,
      platform: d.platform as string,
      status: d.status as string,
      error: d.error as string | undefined,
    }));
    
    if (workerResult.error) {
      result.errors.push(workerResult.error);
    }
    
    // Determine overall success
    result.success = !workerResult.error || workerResult.posts_posted > 0;

    const duration = Date.now() - startTime;
    console.log(`[SCHEDULE-POSTS] Completed in ${duration}ms: ${result.posts_posted} posted, ${result.posts_failed} failed`);

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[SCHEDULE-POSTS] Fatal error: ${errorMessage}`);
    
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
