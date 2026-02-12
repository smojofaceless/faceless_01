// =====================================================
// POST-WORKER EDGE FUNCTION
// Processes posts from the queue and uploads to platforms
// 
// Reference: POST_QUEUE.md, ROADMAP.md Item #9
// 
// v2.0 - 2026-02-10: Real YouTube adapter with OAuth token refresh
// v1.0 - 2026-02-23: Initial implementation with stub adapters
// 
// This function:
// 1. Checks global kill switch
// 2. Receives post_id (or claims from queue)
// 3. Validates post ownership (lease)
// 4. Calls platform adapter (YouTube = real, others = stubbed)
// 5. Updates post status (posted/failed)
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

// =====================================================
// VERSION
// =====================================================
const VERSION = "2.0";

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
    meta: Record<string, unknown>,
    supabase?: SupabaseClient,
    brandId?: string
  ): Promise<PlatformResult>;
}

/**
 * Stub adapter that simulates successful posting
 * Used for platforms not yet implemented
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
    meta: Record<string, unknown>,
    _supabase?: SupabaseClient,
    _brandId?: string
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
    meta: Record<string, unknown>,
    supabase?: SupabaseClient,
    brandId?: string
  ): Promise<PlatformResult> {
    // TikTok-specific validation
    if (!videoUrl) {
      return {
        success: false,
        error_class: 'misconfig',
        error_message: 'TikTok requires a video URL',
      };
    }
    
    // Delegate to stub (TODO: implement real TikTok upload)
    return super.post(videoUrl, title, description, tags, meta, supabase, brandId);
  }
}

// =====================================================
// REAL YOUTUBE ADAPTER
// Uses YouTube Data API v3 with resumable uploads
// =====================================================

interface PlatformToken {
  id: string;
  brand_id: string;
  platform: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  platform_channel_id: string | null;
  platform_channel_name: string | null;
  is_valid: boolean;
}

/**
 * Refresh YouTube access token using refresh_token
 */
async function refreshYouTubeToken(
  supabase: SupabaseClient,
  tokenData: PlatformToken
): Promise<string> {
  console.log('[YouTube] Refreshing access token...');

  const clientId = Deno.env.get('YOUTUBE_CLIENT_ID');
  const clientSecret = Deno.env.get('YOUTUBE_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error('YouTube OAuth credentials not configured (YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET)');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenData.refresh_token,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('[YouTube] Token refresh failed:', errorBody);
    
    // Mark token as invalid
    await supabase
      .from('platform_tokens')
      .update({ is_valid: false, last_error: `Token refresh failed: ${response.status}` })
      .eq('id', tokenData.id);
    
    throw new Error(`YouTube token refresh failed: ${response.status}`);
  }

  const tokens = await response.json();

  // Update token in database
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  
  await supabase
    .from('platform_tokens')
    .update({
      access_token: tokens.access_token,
      token_expires_at: expiresAt,
      is_valid: true,
      last_error: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', tokenData.id);

  console.log('[YouTube] Token refreshed successfully, expires:', expiresAt);
  return tokens.access_token;
}

/**
 * Real YouTube adapter - uploads to YouTube via Data API v3
 */
class YouTubeAdapter implements PlatformAdapter {
  name = 'youtube';
  
  async post(
    videoUrl: string,
    title: string,
    description: string | null,
    tags: string[] | null,
    meta: Record<string, unknown>,
    supabase?: SupabaseClient,
    brandId?: string
  ): Promise<PlatformResult> {
    console.log(`[YouTube] Starting upload: "${title?.slice(0, 50)}"`);
    
    // Validation
    if (!videoUrl) {
      return {
        success: false,
        error_class: 'misconfig',
        error_message: 'YouTube requires a video URL',
      };
    }
    
    if (!title) {
      return {
        success: false,
        error_class: 'misconfig',
        error_message: 'YouTube requires a title',
      };
    }
    
    // Title length limit (100 chars)
    const safeTitle = title.length > 100 ? title.slice(0, 97) + '...' : title;
    
    if (!supabase || !brandId) {
      return {
        success: false,
        error_class: 'misconfig',
        error_message: 'YouTube adapter requires supabase client and brand_id',
      };
    }
    
    try {
      // Get platform token for this brand
      const { data: tokenData, error: tokenError } = await supabase
        .from('platform_tokens')
        .select('*')
        .eq('brand_id', brandId)
        .eq('platform', 'youtube')
        .single();

      if (tokenError || !tokenData) {
        console.error('[YouTube] Token lookup failed:', tokenError?.message);
        return {
          success: false,
          error_class: 'misconfig',
          error_message: 'YouTube not connected for this brand. Please connect in Settings.',
        };
      }
      
      if (!tokenData.is_valid) {
        return {
          success: false,
          error_class: 'misconfig',
          error_message: 'YouTube token is invalid. Please reconnect in Settings.',
        };
      }

      // Check if token needs refresh (expired or within 5 min of expiry)
      let accessToken = tokenData.access_token;
      const expiresAt = new Date(tokenData.token_expires_at);
      const now = new Date();
      const fiveMinutes = 5 * 60 * 1000;
      
      if (expiresAt.getTime() - now.getTime() < fiveMinutes) {
        console.log('[YouTube] Token expired or expiring soon, refreshing...');
        accessToken = await refreshYouTubeToken(supabase, tokenData as PlatformToken);
      }

      // Download video from storage
      console.log(`[YouTube] Downloading video from: ${videoUrl.slice(0, 80)}...`);
      const videoResponse = await fetch(videoUrl);
      if (!videoResponse.ok) {
        return {
          success: false,
          error_class: 'dependency',
          error_message: `Failed to fetch video: ${videoResponse.status}`,
        };
      }
      
      const videoBlob = await videoResponse.blob();
      console.log(`[YouTube] Video size: ${(videoBlob.size / 1024 / 1024).toFixed(2)} MB`);

      // Prepare metadata
      const isShort = meta?.isShort === true || (videoBlob.size < 60 * 1024 * 1024); // Assume short if < 60MB
      const youtubeMetadata = {
        snippet: {
          title: safeTitle,
          description: description || '',
          tags: tags || [],
          categoryId: '22' // People & Blogs (good for stories)
        },
        status: {
          privacyStatus: (meta?.privacyStatus as string) || 'public',
          selfDeclaredMadeForKids: false,
          madeForKids: false
        }
      };

      console.log('[YouTube] Initiating resumable upload...');
      console.log('[YouTube] Metadata:', JSON.stringify(youtubeMetadata, null, 2));
      
      // Initiate resumable upload
      const initResponse = await fetch(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': 'video/mp4',
            'X-Upload-Content-Length': videoBlob.size.toString()
          },
          body: JSON.stringify(youtubeMetadata)
        }
      );

      if (!initResponse.ok) {
        const errorBody = await initResponse.text();
        console.error('[YouTube] Upload init error:', errorBody);
        
        // Parse error for classification
        let errorClass: 'transient' | 'dependency' | 'misconfig' | 'permanent' = 'transient';
        if (initResponse.status === 401 || initResponse.status === 403) {
          errorClass = 'misconfig'; // Token issue
        } else if (initResponse.status === 400) {
          errorClass = 'permanent'; // Bad request, won't retry
        } else if (initResponse.status >= 500) {
          errorClass = 'dependency'; // YouTube is down
        }
        
        return {
          success: false,
          error_class: errorClass,
          error_message: `YouTube upload init failed: ${initResponse.status} - ${errorBody.slice(0, 200)}`,
        };
      }

      const uploadUrl = initResponse.headers.get('Location');
      if (!uploadUrl) {
        return {
          success: false,
          error_class: 'dependency',
          error_message: 'No upload URL returned from YouTube',
        };
      }

      // Upload video data
      console.log('[YouTube] Uploading video data...');
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': videoBlob.size.toString()
        },
        body: videoBlob
      });

      if (!uploadResponse.ok) {
        const errorBody = await uploadResponse.text();
        console.error('[YouTube] Upload error:', errorBody);
        
        return {
          success: false,
          error_class: uploadResponse.status >= 500 ? 'dependency' : 'transient',
          error_message: `YouTube upload failed: ${uploadResponse.status}`,
        };
      }

      const result = await uploadResponse.json();
      const videoId = result.id;
      const platformUrl = isShort 
        ? `https://youtube.com/shorts/${videoId}`
        : `https://youtube.com/watch?v=${videoId}`;
      
      console.log(`[YouTube] ✅ Upload complete! Video ID: ${videoId}`);
      console.log(`[YouTube] URL: ${platformUrl}`);
      
      // Update last_used_at
      await supabase
        .from('platform_tokens')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', tokenData.id);

      return {
        success: true,
        platform_post_id: videoId,
        platform_url: platformUrl,
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[YouTube] Unexpected error:', message);
      
      return {
        success: false,
        error_class: 'transient',
        error_message: message,
      };
    }
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

    // ---- Metadata Gating ----
    // Fetch AI-generated metadata if available; override post fields
    let postTitle = post.title || 'Untitled';
    let postDescription = post.description;
    let postTags = post.tags;
    let postMeta = post.meta || {};

    try {
      const { data: metadata } = await supabase
        .from('post_metadata')
        .select('status, final_metadata, ai_metadata, platform, failure_class, attempt_count')
        .eq('post_id', post.post_id)
        .eq('platform', post.platform)
        .single();

      if (metadata && ['ready', 'edited'].includes(metadata.status)) {
        const md = metadata.final_metadata || metadata.ai_metadata;
        if (md && typeof md === 'object') {
          // Platform-specific field mapping
          if (post.platform === 'youtube_shorts') {
            postTitle = (md as Record<string, unknown>).title as string || postTitle;
            postDescription = (md as Record<string, unknown>).description as string || postDescription;
            postTags = (md as Record<string, unknown>).tags as string[] || postTags;
            postMeta = {
              ...postMeta,
              category_id: (md as Record<string, unknown>).category_id ?? 24,
              made_for_kids: (md as Record<string, unknown>).made_for_kids ?? false,
              metadata_source: metadata.status,
            };
          } else if (post.platform === 'tiktok') {
            postTitle = (md as Record<string, unknown>).caption as string || postTitle;
            postTags = (md as Record<string, unknown>).hashtags as string[] || postTags;
            postMeta = {
              ...postMeta,
              cover_text: (md as Record<string, unknown>).cover_text,
              metadata_source: metadata.status,
            };
          } else if (post.platform === 'instagram_reels') {
            postDescription = (md as Record<string, unknown>).caption as string || postDescription;
            postTags = (md as Record<string, unknown>).hashtags as string[] || postTags;
            postMeta = {
              ...postMeta,
              alt_text: (md as Record<string, unknown>).alt_text,
              metadata_source: metadata.status,
            };
          }
          console.log(`[POST-WORKER] Using ${metadata.status} metadata for ${post.platform}`);
        }
      } else if (metadata && metadata.status === 'generating') {
        // Metadata is being generated — retryable wait
        console.log(`[POST-WORKER] Metadata still generating for ${post.post_id}/${post.platform} — retrying later`);
        await supabase.rpc('mark_post_failed', {
          p_post_id: post.post_id,
          p_worker_id: workerId,
          p_error_class: 'transient',
          p_error_message: 'Metadata still generating — will retry',
          p_retryable: true,
          p_error_signature: `transient:${post.platform}:metadata_generating`,
        });
        return {
          status: 'failed',
          result: {
            success: false,
            error_class: 'transient',
            error_message: 'Metadata still generating',
          },
        };
      } else if (metadata && metadata.status === 'not_started') {
        // Metadata queued but not started — retryable wait
        console.log(`[POST-WORKER] Metadata not started for ${post.post_id}/${post.platform} — retrying later`);
        await supabase.rpc('mark_post_failed', {
          p_post_id: post.post_id,
          p_worker_id: workerId,
          p_error_class: 'transient',
          p_error_message: 'Metadata not ready — will retry',
          p_retryable: true,
          p_error_signature: `transient:${post.platform}:metadata_not_ready`,
        });
        return {
          status: 'failed',
          result: {
            success: false,
            error_class: 'transient',
            error_message: 'Metadata not ready',
          },
        };
      } else if (metadata && metadata.status === 'failed') {
        // Metadata failed — check if retryable (scheduler will retry) or permanent
        const fc = (metadata as Record<string, unknown>).failure_class as string;
        const isRetryable = !fc || fc === 'transient' || fc === 'dependency';
        const attempts = (metadata as Record<string, unknown>).attempt_count as number || 0;
        if (isRetryable && attempts < 3) {
          console.log(`[POST-WORKER] Metadata failed but retryable (${fc}, attempt ${attempts}) for ${post.post_id}/${post.platform} — retrying later`);
          await supabase.rpc('mark_post_failed', {
            p_post_id: post.post_id,
            p_worker_id: workerId,
            p_error_class: 'transient',
            p_error_message: `Metadata failed (${fc}) — scheduler will retry, post-worker waiting`,
            p_retryable: true,
            p_error_signature: `transient:${post.platform}:metadata_failed_retryable`,
          });
          return {
            status: 'failed',
            result: {
              success: false,
              error_class: 'transient',
              error_message: `Metadata failed (retryable): ${fc}`,
            },
          };
        }
        // Permanent/misconfig or max retries — fall through with original post fields
        console.warn(`[POST-WORKER] Metadata permanently failed for ${post.post_id}/${post.platform} — posting with original fields`);
      }
      // If no metadata record exists (legacy post) or permanently failed, fall through with original fields
    } catch (metaErr) {
      // Metadata lookup failed — continue with original post fields
      console.warn(`[POST-WORKER] Metadata lookup failed (using post fields):`, metaErr);
    }

    // Call platform API (passes supabase and brandId for real adapters)
    const result = await adapter.post(
      post.video_url,
      postTitle,
      postDescription,
      postTags,
      postMeta,
      supabase,
      post.brand_id
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
          adapter_version: adapter.name === 'youtube' ? 'real_1.0' : 'stub_1.0',
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
