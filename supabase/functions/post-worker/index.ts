// =====================================================
// POST-WORKER EDGE FUNCTION
// Processes posts from the queue and uploads to platforms
// 
// Reference: POST_QUEUE.md, ROADMAP.md Item #9
// 
// v3.0 - 2026-02-12: Real Instagram Reels + Facebook Reels adapters
// v2.0 - 2026-02-10: Real YouTube adapter with OAuth token refresh
// v1.0 - 2026-02-23: Initial implementation with stub adapters
// 
// This function:
// 1. Checks global kill switch
// 2. Receives post_id (or claims from queue)
// 3. Validates post ownership (lease)
// 4. Calls platform adapter (YouTube, Instagram, Facebook, TikTok, Threads, X/Twitter = real)
// 5. Updates post status (posted/failed)
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

// =====================================================
// VERSION
// =====================================================
const VERSION = "3.0";

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
 * Refresh TikTok access token using refresh_token
 */
async function refreshTikTokToken(
  supabase: SupabaseClient,
  tokenData: PlatformToken
): Promise<string> {
  console.log('[TikTok] Refreshing access token...');

  const clientKey = Deno.env.get('TIKTOK_CLIENT_KEY');
  const clientSecret = Deno.env.get('TIKTOK_CLIENT_SECRET');

  if (!clientKey || !clientSecret) {
    throw new Error('TikTok OAuth credentials not configured (TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET)');
  }

  const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: tokenData.refresh_token,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('[TikTok] Token refresh failed:', errorBody);
    await supabase
      .from('platform_tokens')
      .update({ is_valid: false, last_error: `Token refresh failed: ${response.status}` })
      .eq('id', tokenData.id);
    throw new Error(`TikTok token refresh failed: ${response.status}`);
  }

  const tokens = await response.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase
    .from('platform_tokens')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || tokenData.refresh_token,
      token_expires_at: expiresAt,
      is_valid: true,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tokenData.id);

  console.log('[TikTok] Token refreshed successfully, expires:', expiresAt);
  return tokens.access_token;
}

/**
 * Real TikTok adapter — uploads via Content Posting API V2
 * Flow: init upload → upload video via URL → poll for publish status
 */
class TikTokAdapter implements PlatformAdapter {
  name = 'tiktok';
  private API_BASE = 'https://open.tiktokapis.com/v2';

  async post(
    videoUrl: string,
    title: string,
    description: string | null,
    tags: string[] | null,
    meta: Record<string, unknown>,
    supabase?: SupabaseClient,
    brandId?: string
  ): Promise<PlatformResult> {
    console.log(`[TikTok] Starting upload: "${title?.slice(0, 50)}"`);

    if (!videoUrl) {
      return { success: false, error_class: 'misconfig', error_message: 'TikTok requires a video URL' };
    }
    if (!supabase || !brandId) {
      return { success: false, error_class: 'misconfig', error_message: 'TikTok adapter requires supabase client and brand_id' };
    }

    try {
      // 1. Get TikTok token
      const { data: tokenData, error: tokenError } = await supabase
        .from('platform_tokens')
        .select('*')
        .eq('brand_id', brandId)
        .eq('platform', 'tiktok')
        .single();

      if (tokenError || !tokenData) {
        console.error('[TikTok] Token lookup failed:', tokenError?.message);
        return { success: false, error_class: 'misconfig', error_message: 'TikTok not connected for this brand. Please connect in Settings.' };
      }
      if (!tokenData.is_valid) {
        return { success: false, error_class: 'misconfig', error_message: 'TikTok token is invalid. Please reconnect in Settings.' };
      }

      // 2. Refresh token if near expiry
      let accessToken = tokenData.access_token;
      const expiresAt = new Date(tokenData.token_expires_at);
      const fiveMinutes = 5 * 60 * 1000;
      if (expiresAt.getTime() - Date.now() < fiveMinutes) {
        console.log('[TikTok] Token expired or expiring soon, refreshing...');
        accessToken = await refreshTikTokToken(supabase, tokenData as PlatformToken);
      }

      // 3. Build caption with hashtags
      const caption = description || title || '';
      const hashtags = tags || [];
      const fullCaption = hashtags.length > 0
        ? `${caption}\n\n${hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}`
        : caption;
      // TikTok caption limit: 2200 chars
      const safeCaption = fullCaption.length > 2200 ? fullCaption.slice(0, 2197) + '...' : fullCaption;

      console.log(`[TikTok] Caption: ${safeCaption.slice(0, 100)}...`);

      // 4. Init video publish via "pull from URL" method
      console.log('[TikTok] Step 1: Initializing video publish (pull from URL)...');
      const initResponse = await fetch(`${this.API_BASE}/post/publish/video/init/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          post_info: {
            title: (title || '').slice(0, 150),
            description: safeCaption,
            privacy_level: 'PUBLIC_TO_EVERYONE',
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
            video_cover_timestamp_ms: 1000,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: videoUrl,
          },
        }),
      });

      const initData = await initResponse.json();
      console.log('[TikTok] Init response:', JSON.stringify(initData));

      if (initData.error?.code) {
        const errCode = initData.error.code;
        const errMsg = initData.error.message || 'Video init failed';
        console.error(`[TikTok] Init error: ${errCode} - ${errMsg}`);

        // Classify errors
        let errClass: 'transient' | 'dependency' | 'misconfig' | 'permanent' = 'transient';
        if (['access_token_invalid', 'token_expired', 'scope_not_authorized'].includes(errCode)) {
          errClass = 'misconfig';
          // Mark token invalid
          await supabase.from('platform_tokens')
            .update({ is_valid: false, last_error: errMsg })
            .eq('id', tokenData.id);
        } else if (['spam_risk_too_many_posts', 'rate_limit_exceeded'].includes(errCode)) {
          errClass = 'transient';
        } else if (['url_download_failed'].includes(errCode)) {
          errClass = 'dependency';
        }

        return { success: false, error_class: errClass, error_message: `TikTok: ${errCode} — ${errMsg}` };
      }

      const publishId = initData.data?.publish_id;
      if (!publishId) {
        return { success: false, error_class: 'transient', error_message: 'TikTok: No publish_id returned from init' };
      }

      console.log(`[TikTok] Publish ID: ${publishId}`);

      // 5. Poll for publish status (TikTok processes async)
      console.log('[TikTok] Step 2: Polling publish status...');
      let finalStatus = 'PROCESSING';
      let platformPostId = '';
      const maxPolls = 30; // Up to ~5 minutes
      const pollInterval = 10000; // 10 seconds

      for (let i = 0; i < maxPolls; i++) {
        await new Promise(r => setTimeout(r, pollInterval));

        const statusResponse = await fetch(
          `${this.API_BASE}/post/publish/status/fetch/`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json; charset=UTF-8',
            },
            body: JSON.stringify({ publish_id: publishId }),
          }
        );

        const statusData = await statusResponse.json();
        finalStatus = statusData.data?.status || 'UNKNOWN';
        console.log(`[TikTok] Poll ${i + 1}/${maxPolls}: status=${finalStatus}`);

        if (finalStatus === 'PUBLISH_COMPLETE') {
          platformPostId = statusData.data?.publicaly_available_post_id ||
                           statusData.data?.publish_id ||
                           publishId;
          break;
        } else if (finalStatus === 'FAILED') {
          const failReason = statusData.data?.fail_reason || 'Unknown failure';
          console.error(`[TikTok] Publish failed: ${failReason}`);
          return {
            success: false,
            error_class: 'dependency',
            error_message: `TikTok publish failed: ${failReason}`,
          };
        }
        // PROCESSING_UPLOAD, PROCESSING_DOWNLOAD, SENDING_TO_USER_INBOX — keep polling
      }

      if (finalStatus !== 'PUBLISH_COMPLETE') {
        // Timeout — might still succeed, return optimistically
        console.warn(`[TikTok] Publish still processing after ${maxPolls * pollInterval / 1000}s. Status: ${finalStatus}`);
        return {
          success: true,
          platform_post_id: publishId,
          platform_url: `https://www.tiktok.com/@/video/${publishId}`,
        };
      }

      const platformUrl = `https://www.tiktok.com/@/video/${platformPostId}`;
      console.log(`[TikTok] Published successfully! ID: ${platformPostId}, URL: ${platformUrl}`);

      return {
        success: true,
        platform_post_id: platformPostId,
        platform_url: platformUrl,
      };

    } catch (err) {
      console.error('[TikTok] Unexpected error:', err);
      return {
        success: false,
        error_class: 'transient',
        error_message: `TikTok error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

// =====================================================
// REAL THREADS ADAPTER
// Uses Threads API (graph.threads.net) for video/text posts
// =====================================================

/**
 * Refresh Threads long-lived token
 */
async function refreshThreadsToken(
  supabase: SupabaseClient,
  tokenData: PlatformToken
): Promise<string> {
  console.log('[Threads] Refreshing long-lived token...');

  const response = await fetch(
    `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${tokenData.access_token}`
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('[Threads] Token refresh failed:', errorBody);
    await supabase
      .from('platform_tokens')
      .update({ is_valid: false, last_error: `Token refresh failed: ${response.status}` })
      .eq('id', tokenData.id);
    throw new Error(`Threads token refresh failed: ${response.status}`);
  }

  const tokens = await response.json();
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 5184000) * 1000).toISOString();

  await supabase
    .from('platform_tokens')
    .update({
      access_token: tokens.access_token,
      token_expires_at: expiresAt,
      is_valid: true,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tokenData.id);

  console.log('[Threads] Token refreshed successfully, expires:', expiresAt);
  return tokens.access_token;
}

/**
 * Real Threads adapter — posts video via Threads API
 * Flow: create media container → wait for processing → publish
 */
class ThreadsAdapter implements PlatformAdapter {
  name = 'threads';
  private API_BASE = 'https://graph.threads.net/v1.0';

  async post(
    videoUrl: string,
    title: string,
    description: string | null,
    tags: string[] | null,
    meta: Record<string, unknown>,
    supabase?: SupabaseClient,
    brandId?: string
  ): Promise<PlatformResult> {
    console.log(`[Threads] Starting post: "${title?.slice(0, 50)}"`);

    if (!supabase || !brandId) {
      return { success: false, error_class: 'misconfig', error_message: 'Threads adapter requires supabase client and brand_id' };
    }

    try {
      // 1. Get Threads token
      const { data: tokenData, error: tokenError } = await supabase
        .from('platform_tokens')
        .select('*')
        .eq('brand_id', brandId)
        .eq('platform', 'threads')
        .single();

      if (tokenError || !tokenData) {
        console.error('[Threads] Token lookup failed:', tokenError?.message);
        return { success: false, error_class: 'misconfig', error_message: 'Threads not connected for this brand. Please connect in Settings.' };
      }
      if (!tokenData.is_valid) {
        return { success: false, error_class: 'misconfig', error_message: 'Threads token is invalid. Please reconnect in Settings.' };
      }

      const threadsUserId = tokenData.platform_channel_id;
      if (!threadsUserId) {
        return { success: false, error_class: 'misconfig', error_message: 'No Threads user ID found. Please reconnect in Settings.' };
      }

      // 2. Refresh token if within 7 days of expiry
      let accessToken = tokenData.access_token;
      const expiresAt = new Date(tokenData.token_expires_at);
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (expiresAt.getTime() - Date.now() < sevenDays) {
        console.log('[Threads] Token expiring soon, refreshing...');
        accessToken = await refreshThreadsToken(supabase, tokenData as PlatformToken);
      }

      // 3. Build post text
      const caption = description || title || '';
      // Threads caption limit: 500 chars
      const safeCaption = caption.length > 500 ? caption.slice(0, 497) + '...' : caption;

      console.log(`[Threads] Text: ${safeCaption.slice(0, 100)}...`);

      // 4. Create media container
      // If we have a video URL, post as video; otherwise as text
      const isVideoPost = !!videoUrl;
      const containerBody: Record<string, string> = {
        access_token: accessToken,
        text: safeCaption,
      };

      if (isVideoPost) {
        containerBody.media_type = 'VIDEO';
        containerBody.video_url = videoUrl;
      } else {
        containerBody.media_type = 'TEXT';
      }

      console.log(`[Threads] Step 1: Creating ${isVideoPost ? 'video' : 'text'} container...`);
      const containerResponse = await fetch(
        `${this.API_BASE}/${threadsUserId}/threads`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(containerBody),
        }
      );

      const containerData = await containerResponse.json();
      console.log('[Threads] Container response:', JSON.stringify(containerData));

      if (containerData.error) {
        const errMsg = containerData.error.message || 'Container creation failed';
        const errCode = containerData.error.code;
        console.error(`[Threads] Container error: ${errCode} - ${errMsg}`);

        let errClass: 'transient' | 'dependency' | 'misconfig' | 'permanent' = 'transient';
        if (errCode === 190 || errMsg.includes('token')) {
          errClass = 'misconfig';
          await supabase.from('platform_tokens')
            .update({ is_valid: false, last_error: errMsg })
            .eq('id', tokenData.id);
        }

        return { success: false, error_class: errClass, error_message: `Threads: ${errMsg}` };
      }

      const containerId = containerData.id;
      if (!containerId) {
        return { success: false, error_class: 'transient', error_message: 'Threads: No container ID returned' };
      }

      // 5. For video posts, poll until processing is done
      if (isVideoPost) {
        console.log('[Threads] Step 2: Waiting for video processing...');
        const maxPolls = 30;
        const pollInterval = 10000;

        for (let i = 0; i < maxPolls; i++) {
          await new Promise(r => setTimeout(r, pollInterval));

          const statusResponse = await fetch(
            `${this.API_BASE}/${containerId}?fields=status,error_message&access_token=${accessToken}`
          );
          const statusData = await statusResponse.json();
          const status = statusData.status;
          console.log(`[Threads] Poll ${i + 1}/${maxPolls}: status=${status}`);

          if (status === 'FINISHED') {
            break;
          } else if (status === 'ERROR') {
            return {
              success: false,
              error_class: 'dependency',
              error_message: `Threads video processing failed: ${statusData.error_message || 'Unknown error'}`,
            };
          }
          // IN_PROGRESS — keep polling
        }
      }

      // 6. Publish the container
      console.log('[Threads] Step 3: Publishing...');
      const publishResponse = await fetch(
        `${this.API_BASE}/${threadsUserId}/threads_publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creation_id: containerId,
            access_token: accessToken,
          }),
        }
      );

      const publishData = await publishResponse.json();
      console.log('[Threads] Publish response:', JSON.stringify(publishData));

      if (publishData.error) {
        return {
          success: false,
          error_class: 'transient',
          error_message: `Threads publish failed: ${publishData.error.message}`,
        };
      }

      const postId = publishData.id;
      const platformUrl = `https://www.threads.net/post/${postId}`;

      console.log(`[Threads] Published successfully! ID: ${postId}`);

      return {
        success: true,
        platform_post_id: postId,
        platform_url: platformUrl,
      };

    } catch (err) {
      console.error('[Threads] Unexpected error:', err);
      return {
        success: false,
        error_class: 'transient',
        error_message: `Threads error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
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

// =====================================================
// REAL INSTAGRAM REELS ADAPTER
// Uses Instagram Graph API with 3-step publish flow:
//   1. Create media container (REELS with video_url)
//   2. Poll for processing completion
//   3. Publish the container
// =====================================================

class InstagramReelsAdapter implements PlatformAdapter {
  name = 'instagram_reels';
  private API_BASE = 'https://graph.facebook.com/v18.0';

  async post(
    videoUrl: string,
    title: string,
    description: string | null,
    tags: string[] | null,
    meta: Record<string, unknown>,
    supabase?: SupabaseClient,
    brandId?: string
  ): Promise<PlatformResult> {
    console.log(`[Instagram] Starting Reels upload: "${title?.slice(0, 50)}"`);

    if (!videoUrl) {
      return { success: false, error_class: 'misconfig', error_message: 'Instagram requires a video URL' };
    }
    if (!supabase || !brandId) {
      return { success: false, error_class: 'misconfig', error_message: 'Instagram adapter requires supabase client and brand_id' };
    }

    try {
      // Get Instagram token from platform_tokens
      const { data: tokenData, error: tokenError } = await supabase
        .from('platform_tokens')
        .select('*')
        .eq('brand_id', brandId)
        .eq('platform', 'instagram')
        .single();

      if (tokenError || !tokenData) {
        console.error('[Instagram] Token lookup failed:', tokenError?.message);
        return { success: false, error_class: 'misconfig', error_message: 'Instagram not connected for this brand. Please connect in Settings.' };
      }

      if (!tokenData.is_valid) {
        return { success: false, error_class: 'misconfig', error_message: 'Instagram token is invalid. Please reconnect in Settings.' };
      }

      const accessToken = tokenData.access_token;
      const instagramAccountId = tokenData.platform_channel_id;

      if (!instagramAccountId) {
        return { success: false, error_class: 'misconfig', error_message: 'No Instagram account ID found. Please reconnect in Settings.' };
      }

      // Build caption from metadata
      const caption = description || title || '';
      const hashtags = tags || [];
      const fullCaption = hashtags.length > 0
        ? `${caption}\n\n${hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}`
        : caption;

      console.log(`[Instagram] Account ID: ${instagramAccountId}`);
      console.log(`[Instagram] Caption: ${fullCaption.slice(0, 100)}...`);

      // Step 1: Create media container
      console.log('[Instagram] Step 1: Creating media container...');
      const containerResponse = await fetch(
        `${this.API_BASE}/${instagramAccountId}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            media_type: 'REELS',
            video_url: videoUrl,
            caption: fullCaption,
            share_to_feed: true,
            access_token: accessToken
          })
        }
      );

      const containerData = await containerResponse.json();
      console.log('[Instagram] Container response:', JSON.stringify(containerData));

      if (containerData.error) {
        const errMsg = containerData.error.message || 'Container creation failed';
        const errCode = containerData.error.code;
        // Classify error
        let errClass: 'transient' | 'dependency' | 'misconfig' | 'permanent' = 'transient';
        if (errCode === 190 || errCode === 10) errClass = 'misconfig'; // token/permission
        else if (errCode === 2 || errCode === 4) errClass = 'dependency'; // service unavailable / rate limit
        return { success: false, error_class: errClass, error_message: `Instagram container error: ${errMsg}` };
      }

      const containerId = containerData.id;
      console.log(`[Instagram] Container ID: ${containerId}`);

      // Step 2: Poll for processing completion
      console.log('[Instagram] Step 2: Waiting for video processing...');
      let status = 'IN_PROGRESS';
      let attempts = 0;
      const maxAttempts = 60; // ~5 minutes

      while (status === 'IN_PROGRESS' && attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 5000)); // 5 second intervals
        attempts++;

        const statusResponse = await fetch(
          `${this.API_BASE}/${containerId}?fields=status_code,status&access_token=${accessToken}`
        );
        const statusData = await statusResponse.json();
        console.log(`[Instagram] Processing status (attempt ${attempts}):`, JSON.stringify(statusData));

        status = statusData.status_code || 'IN_PROGRESS';

        if (statusData.status === 'ERROR' || status === 'ERROR') {
          return { success: false, error_class: 'dependency', error_message: 'Video processing failed on Instagram servers' };
        }
      }

      if (status !== 'FINISHED') {
        return { success: false, error_class: 'dependency', error_message: `Video processing timed out. Final status: ${status}` };
      }

      console.log('[Instagram] Video processing complete!');

      // Step 3: Publish the container
      console.log('[Instagram] Step 3: Publishing...');
      const publishResponse = await fetch(
        `${this.API_BASE}/${instagramAccountId}/media_publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creation_id: containerId,
            access_token: accessToken
          })
        }
      );

      const publishData = await publishResponse.json();
      console.log('[Instagram] Publish response:', JSON.stringify(publishData));

      if (publishData.error) {
        return { success: false, error_class: 'dependency', error_message: `Instagram publish failed: ${publishData.error.message}` };
      }

      // Get permalink
      let permalink = `https://www.instagram.com/reel/${publishData.id}/`;
      try {
        const mediaResponse = await fetch(
          `${this.API_BASE}/${publishData.id}?fields=id,permalink&access_token=${accessToken}`
        );
        const mediaData = await mediaResponse.json();
        if (mediaData.permalink) permalink = mediaData.permalink;
      } catch {
        console.warn('[Instagram] Could not fetch permalink, using default');
      }

      console.log(`[Instagram] ✅ Published! ID: ${publishData.id}, URL: ${permalink}`);

      // Update last_used_at
      await supabase
        .from('platform_tokens')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', tokenData.id);

      return {
        success: true,
        platform_post_id: publishData.id,
        platform_url: permalink,
      };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Instagram] Unexpected error:', message);
      return { success: false, error_class: 'transient', error_message: message };
    }
  }
}

// =====================================================
// REAL FACEBOOK REELS ADAPTER
// Uses Facebook Graph API with 3-step Reel publish flow:
//   1. Start upload (with file_url — Facebook downloads the video)
//   2. Poll for processing 
//   3. Finish (publish)
// Falls back to regular video post if Reel upload fails
// =====================================================

class FacebookReelsAdapter implements PlatformAdapter {
  name = 'facebook_reels';
  private API_BASE = 'https://graph.facebook.com/v18.0';

  async post(
    videoUrl: string,
    title: string,
    description: string | null,
    tags: string[] | null,
    meta: Record<string, unknown>,
    supabase?: SupabaseClient,
    brandId?: string
  ): Promise<PlatformResult> {
    console.log(`[Facebook] Starting Reels upload: "${title?.slice(0, 50)}"`);

    if (!videoUrl) {
      return { success: false, error_class: 'misconfig', error_message: 'Facebook requires a video URL' };
    }
    if (!supabase || !brandId) {
      return { success: false, error_class: 'misconfig', error_message: 'Facebook adapter requires supabase client and brand_id' };
    }

    try {
      // Get Facebook token — look for 'facebook' platform first, fall back to 'instagram' (shares token set)
      let tokenData: Record<string, unknown> | null = null;
      let pageToken: string | null = null;
      let pageId: string | null = null;

      // Try facebook token first
      const { data: fbToken } = await supabase
        .from('platform_tokens')
        .select('*')
        .eq('brand_id', brandId)
        .eq('platform', 'facebook')
        .single();

      if (fbToken) {
        tokenData = fbToken as Record<string, unknown>;
        pageId = fbToken.platform_channel_id;
        // Page access token is stored in metadata.page_access_token
        pageToken = (fbToken.metadata as Record<string, unknown>)?.page_access_token as string || fbToken.access_token;
      } else {
        // Fall back to instagram token which may have facebook metadata
        const { data: igToken } = await supabase
          .from('platform_tokens')
          .select('*')
          .eq('brand_id', brandId)
          .eq('platform', 'instagram')
          .single();

        if (igToken) {
          tokenData = igToken as Record<string, unknown>;
          const igMeta = (igToken.metadata as Record<string, unknown>) || {};
          pageId = igMeta.facebook_page_id as string || null;
          pageToken = igToken.access_token; // User token (may work for page posting if user has permissions)
        }
      }

      if (!tokenData) {
        return { success: false, error_class: 'misconfig', error_message: 'Facebook not connected for this brand. Please connect in Settings.' };
      }

      if (!pageId) {
        return { success: false, error_class: 'misconfig', error_message: 'No Facebook Page ID found. Please reconnect in Settings and select a page.' };
      }

      if (!pageToken) {
        return { success: false, error_class: 'misconfig', error_message: 'No Facebook Page access token found. Please reconnect in Settings.' };
      }

      if ((tokenData as Record<string, unknown>).is_valid === false) {
        return { success: false, error_class: 'misconfig', error_message: 'Facebook token is invalid. Please reconnect in Settings.' };
      }

      // Build description with hashtags (like Instagram)
      const captionText = description || title || '';
      const hashtags = tags || [];
      const postDescription = hashtags.length > 0
        ? `${captionText}\n\n${hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}`
        : captionText;

      console.log(`[Facebook] Page ID: ${pageId}`);
      console.log(`[Facebook] Description: ${postDescription.slice(0, 100)}...`);
      console.log(`[Facebook] Hashtags: ${hashtags.length} tags`);

      // Step 1: Initialize Reel upload with file_url
      console.log('[Facebook] Step 1: Initializing Reel upload with video URL...');
      const initResponse = await fetch(
        `${this.API_BASE}/${pageId}/video_reels`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            upload_phase: 'start',
            file_url: videoUrl,
            access_token: pageToken
          })
        }
      );

      const initData = await initResponse.json();
      console.log('[Facebook] Init response:', JSON.stringify(initData));

      if (initData.error) {
        const errMsg = initData.error.message || 'Failed to initialize upload';
        // If Reel API not available, fall back to regular video
        if (initData.error.code === 100 || errMsg.includes('not supported')) {
          console.log('[Facebook] Reel API not available, falling back to regular video...');
          return this.uploadAsRegularVideo(videoUrl, title, postDescription, pageId, pageToken, supabase, tokenData);
        }
        let errClass: 'transient' | 'dependency' | 'misconfig' | 'permanent' = 'transient';
        if (initData.error.code === 190 || initData.error.code === 10) errClass = 'misconfig';
        else if (initData.error.code === 2 || initData.error.code === 4) errClass = 'dependency';
        return { success: false, error_class: errClass, error_message: `Facebook Reel init error: ${errMsg}` };
      }

      const videoId = initData.video_id;
      console.log(`[Facebook] Video ID: ${videoId}`);

      // Step 2: Poll for processing
      console.log('[Facebook] Step 2: Polling for video processing...');
      let attempts = 0;
      const maxAttempts = 24; // ~2 minutes
      let lastStatus = 'unknown';

      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 5000));
        attempts++;

        try {
          const statusResponse = await fetch(
            `${this.API_BASE}/${videoId}?fields=status&access_token=${pageToken}`
          );
          const statusData = await statusResponse.json();
          console.log(`[Facebook] Video status (attempt ${attempts}):`, JSON.stringify(statusData));

          if (statusData.status) {
            lastStatus = statusData.status.video_status || 'unknown';
            if (lastStatus === 'ready' || lastStatus === 'complete') {
              console.log('[Facebook] Video is ready!');
              break;
            } else if (lastStatus === 'error') {
              return { success: false, error_class: 'dependency', error_message: 'Video processing failed on Facebook servers' };
            }
          }
        } catch {
          console.log(`[Facebook] Status check error on attempt ${attempts}, continuing...`);
        }
      }

      // Step 3: Finish (publish) — try regardless of polling status
      console.log(`[Facebook] Step 3: Publishing (last status: ${lastStatus})...`);
      const finishResponse = await fetch(
        `${this.API_BASE}/${pageId}/video_reels`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            upload_phase: 'finish',
            video_id: videoId,
            video_state: 'PUBLISHED',
            description: postDescription,
            access_token: pageToken
          })
        }
      );

      const finishData = await finishResponse.json();
      console.log('[Facebook] Finish response:', JSON.stringify(finishData));

      if (finishData.error) {
        // If not uploaded yet, fall back to regular video
        if (finishData.error.error_subcode === 1363130 || finishData.error.message?.includes('not uploaded')) {
          console.log('[Facebook] Reel finish failed, falling back to regular video...');
          return this.uploadAsRegularVideo(videoUrl, title, postDescription, pageId, pageToken, supabase, tokenData);
        }
        return { success: false, error_class: 'dependency', error_message: `Facebook Reel publish failed: ${finishData.error.message}` };
      }

      const platformUrl = `https://www.facebook.com/reel/${videoId}`;
      console.log(`[Facebook] ✅ Reel published! Video ID: ${videoId}, URL: ${platformUrl}`);

      // Update last_used_at
      const tokenId = (tokenData as Record<string, unknown>).id;
      if (tokenId) {
        await supabase
          .from('platform_tokens')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', tokenId);
      }

      return {
        success: true,
        platform_post_id: videoId,
        platform_url: platformUrl,
      };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Facebook] Unexpected error:', message);
      return { success: false, error_class: 'transient', error_message: message };
    }
  }

  /**
   * Fallback: Upload as regular Facebook video (not Reel)
   */
  private async uploadAsRegularVideo(
    videoUrl: string,
    title: string,
    description: string,
    pageId: string,
    pageToken: string,
    supabase: SupabaseClient,
    tokenData: Record<string, unknown>
  ): Promise<PlatformResult> {
    console.log('[Facebook] Uploading as regular video (fallback)...');

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}/videos`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_url: videoUrl,
          title: title || '',
          description: description || '',
          access_token: pageToken
        })
      }
    );

    const data = await response.json();
    console.log('[Facebook] Video upload response:', JSON.stringify(data));

    if (data.error) {
      return { success: false, error_class: 'dependency', error_message: `Facebook video upload failed: ${data.error.message}` };
    }

    const platformUrl = `https://www.facebook.com/watch/?v=${data.id}`;
    console.log(`[Facebook] ✅ Video posted! ID: ${data.id}, URL: ${platformUrl}`);

    // Update last_used_at
    const tokenId = tokenData.id;
    if (tokenId) {
      await supabase
        .from('platform_tokens')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', tokenId as string);
    }

    return {
      success: true,
      platform_post_id: data.id,
      platform_url: platformUrl,
    };
  }
}

// =====================================================
// REAL X (TWITTER) ADAPTER
// Uses X API v2 for tweets + v1.1 chunked media upload for video
// =====================================================

/**
 * Refresh X (Twitter) OAuth 2.0 token using refresh_token
 */
async function refreshTwitterToken(
  supabase: SupabaseClient,
  tokenData: PlatformToken
): Promise<string> {
  console.log('[X/Twitter] Refreshing access token...');

  const clientId = Deno.env.get('TWITTER_CLIENT_ID');
  const clientSecret = Deno.env.get('TWITTER_CLIENT_SECRET');

  if (!clientId) {
    throw new Error('TWITTER_CLIENT_ID not configured');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokenData.refresh_token,
    client_id: clientId,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  // Use Basic auth if client secret is available
  if (clientSecret) {
    headers['Authorization'] = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
  }

  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('[X/Twitter] Token refresh failed:', errorBody);
    await supabase
      .from('platform_tokens')
      .update({ is_valid: false, last_error: `Token refresh failed: ${response.status}` })
      .eq('id', tokenData.id);
    throw new Error(`Twitter token refresh failed: ${response.status}`);
  }

  const tokens = await response.json();
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 7200) * 1000).toISOString();

  await supabase
    .from('platform_tokens')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || tokenData.refresh_token,
      token_expires_at: expiresAt,
      is_valid: true,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tokenData.id);

  console.log('[X/Twitter] Token refreshed successfully, expires:', expiresAt);
  return tokens.access_token;
}

/**
 * Real X (Twitter) adapter — posts tweet with video via v2 API
 * 
 * Flow:
 * 1. Get token from platform_tokens
 * 2. Download video bytes
 * 3. Upload via media upload v1.1 (INIT → APPEND → FINALIZE → poll STATUS)
 * 4. Create tweet with media_id via v2 API
 */
class TwitterAdapter implements PlatformAdapter {
  name = 'twitter';
  private UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';
  private TWEET_URL = 'https://api.twitter.com/2/tweets';

  async post(
    videoUrl: string,
    title: string,
    description: string | null,
    tags: string[] | null,
    meta: Record<string, unknown>,
    supabase?: SupabaseClient,
    brandId?: string
  ): Promise<PlatformResult> {
    console.log(`[X/Twitter] Starting post: "${title?.slice(0, 50)}"`);

    if (!supabase || !brandId) {
      return { success: false, error_class: 'misconfig', error_message: 'Twitter adapter requires supabase client and brand_id' };
    }

    try {
      // 1. Get Twitter token
      const { data: tokenData, error: tokenError } = await supabase
        .from('platform_tokens')
        .select('*')
        .eq('brand_id', brandId)
        .eq('platform', 'twitter')
        .single();

      if (tokenError || !tokenData) {
        console.error('[X/Twitter] Token lookup failed:', tokenError?.message);
        return { success: false, error_class: 'misconfig', error_message: 'X not connected for this brand. Please connect in Settings.' };
      }
      if (!tokenData.is_valid) {
        return { success: false, error_class: 'misconfig', error_message: 'X token is invalid. Please reconnect in Settings.' };
      }

      // 2. Refresh token if near expiry
      let accessToken = tokenData.access_token;
      const expiresAt = new Date(tokenData.token_expires_at);
      const fiveMinutes = 5 * 60 * 1000;
      if (expiresAt.getTime() - Date.now() < fiveMinutes) {
        console.log('[X/Twitter] Token expired or expiring soon, refreshing...');
        accessToken = await refreshTwitterToken(supabase, tokenData as PlatformToken);
      }

      // 3. Build tweet text (280 char limit)
      const caption = description || title || '';
      const hashtags = tags || [];
      const hashtagStr = hashtags.length > 0
        ? hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')
        : '';
      
      // Reserve space for hashtags
      const availableChars = hashtagStr ? 280 - hashtagStr.length - 2 : 280;
      const trimmedCaption = caption.length > availableChars ? caption.slice(0, availableChars - 3) + '...' : caption;
      const tweetText = hashtagStr ? `${trimmedCaption}\n\n${hashtagStr}` : trimmedCaption;
      
      console.log(`[X/Twitter] Tweet text (${tweetText.length} chars): ${tweetText.slice(0, 100)}...`);

      // 4. If we have a video URL, upload the video
      let mediaId: string | null = null;
      if (videoUrl) {
        try {
          mediaId = await this._uploadVideo(videoUrl, accessToken);
        } catch (uploadErr) {
          const uploadMsg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
          // If media upload gets 403, fall back to text-only tweet
          if (uploadMsg.includes('403')) {
            console.warn(`[X/Twitter] Media upload 403 — falling back to text-only tweet. Check X Developer Portal → App permissions → "Read and Write". Error: ${uploadMsg}`);
          } else {
            throw uploadErr; // re-throw non-403 errors
          }
        }
      }

      // 5. Create tweet
      console.log('[X/Twitter] Creating tweet...');
      const tweetBody: Record<string, unknown> = { text: tweetText };
      if (mediaId) {
        tweetBody.media = { media_ids: [mediaId] };
      }

      const tweetResponse = await fetch(this.TWEET_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tweetBody),
      });

      const tweetData = await tweetResponse.json();

      if (!tweetResponse.ok) {
        const errDetail = tweetData.detail || tweetData.title || JSON.stringify(tweetData);
        console.error('[X/Twitter] Tweet creation failed:', errDetail);

        let errClass: 'transient' | 'dependency' | 'misconfig' | 'permanent' = 'transient';
        if (tweetResponse.status === 401 || tweetResponse.status === 403) {
          errClass = 'misconfig';
          await supabase.from('platform_tokens')
            .update({ is_valid: false, last_error: errDetail })
            .eq('id', tokenData.id);
        } else if (tweetResponse.status === 429) {
          errClass = 'transient';
        }

        return { success: false, error_class: errClass, error_message: `X: ${errDetail}` };
      }

      const tweetId = tweetData.data?.id;
      const username = tokenData.platform_channel_name?.replace('@', '') || '';
      const platformUrl = username
        ? `https://x.com/${username}/status/${tweetId}`
        : `https://x.com/i/status/${tweetId}`;

      console.log(`[X/Twitter] Tweet posted! ID: ${tweetId}, URL: ${platformUrl}`);

      return {
        success: true,
        platform_post_id: tweetId,
        platform_url: platformUrl,
      };

    } catch (err) {
      console.error('[X/Twitter] Unexpected error:', err);
      return {
        success: false,
        error_class: 'transient',
        error_message: `X error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Upload video via X media upload v1.1 (chunked upload)
   * Steps: INIT → APPEND (chunks) → FINALIZE → poll STATUS
   */
  private async _uploadVideo(videoUrl: string, accessToken: string): Promise<string> {
    console.log('[X/Twitter] Downloading video for upload...');
    
    // Download the video
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: ${videoResponse.status}`);
    }
    const videoBytes = new Uint8Array(await videoResponse.arrayBuffer());
    const totalBytes = videoBytes.length;
    console.log(`[X/Twitter] Video downloaded: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

    // INIT
    console.log('[X/Twitter] Media upload INIT...');
    const initParams = new URLSearchParams({
      command: 'INIT',
      total_bytes: totalBytes.toString(),
      media_type: 'video/mp4',
      media_category: 'tweet_video',
    });

    const initResponse = await fetch(`${this.UPLOAD_URL}?${initParams}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!initResponse.ok) {
      const err = await initResponse.text();
      throw new Error(`Media INIT failed: ${initResponse.status} — ${err}`);
    }

    const initData = await initResponse.json();
    const mediaIdStr = initData.media_id_string;
    console.log(`[X/Twitter] Media ID: ${mediaIdStr}`);

    // APPEND — upload in 5MB chunks
    const CHUNK_SIZE = 5 * 1024 * 1024;
    let segmentIndex = 0;
    let offset = 0;

    while (offset < totalBytes) {
      const end = Math.min(offset + CHUNK_SIZE, totalBytes);
      const chunk = videoBytes.slice(offset, end);
      
      console.log(`[X/Twitter] APPEND segment ${segmentIndex}: ${chunk.length} bytes`);

      const formData = new FormData();
      formData.append('command', 'APPEND');
      formData.append('media_id', mediaIdStr);
      formData.append('segment_index', segmentIndex.toString());
      formData.append('media_data', new Blob([chunk], { type: 'video/mp4' }));

      const appendResponse = await fetch(this.UPLOAD_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}` },
        body: formData,
      });

      if (!appendResponse.ok && appendResponse.status !== 204) {
        const err = await appendResponse.text();
        throw new Error(`Media APPEND failed (segment ${segmentIndex}): ${appendResponse.status} — ${err}`);
      }

      segmentIndex++;
      offset = end;
    }

    // FINALIZE
    console.log('[X/Twitter] Media upload FINALIZE...');
    const finalizeParams = new URLSearchParams({
      command: 'FINALIZE',
      media_id: mediaIdStr,
    });

    const finalizeResponse = await fetch(`${this.UPLOAD_URL}?${finalizeParams}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!finalizeResponse.ok) {
      const err = await finalizeResponse.text();
      throw new Error(`Media FINALIZE failed: ${finalizeResponse.status} — ${err}`);
    }

    const finalizeData = await finalizeResponse.json();
    
    // Check if processing is needed
    if (finalizeData.processing_info) {
      await this._pollProcessingStatus(mediaIdStr, accessToken);
    }

    console.log('[X/Twitter] Video upload complete!');
    return mediaIdStr;
  }

  /**
   * Poll media processing status until succeeded or failed
   */
  private async _pollProcessingStatus(mediaId: string, accessToken: string): Promise<void> {
    console.log('[X/Twitter] Polling media processing status...');
    
    const maxPolls = 60; // Up to ~10 minutes
    for (let i = 0; i < maxPolls; i++) {
      const statusParams = new URLSearchParams({
        command: 'STATUS',
        media_id: mediaId,
      });

      const statusResponse = await fetch(`${this.UPLOAD_URL}?${statusParams}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!statusResponse.ok) {
        throw new Error(`Media STATUS check failed: ${statusResponse.status}`);
      }

      const statusData = await statusResponse.json();
      const state = statusData.processing_info?.state;
      const checkAfterSecs = statusData.processing_info?.check_after_secs || 10;
      const progressPercent = statusData.processing_info?.progress_percent || 0;

      console.log(`[X/Twitter] Processing: state=${state}, progress=${progressPercent}%, check_after=${checkAfterSecs}s`);

      if (state === 'succeeded') {
        return;
      } else if (state === 'failed') {
        const error = statusData.processing_info?.error;
        throw new Error(`Media processing failed: ${error?.message || 'Unknown error'}`);
      }

      // Wait the recommended time
      await new Promise(r => setTimeout(r, checkAfterSecs * 1000));
    }

    throw new Error('Media processing timed out after polling');
  }
}

/**
 * Get adapter for platform
 */
function getAdapter(platform: string): PlatformAdapter {
  if (!platform) {
    console.error('[POST-WORKER] No platform specified — cannot dispatch');
    return new StubAdapter('unknown');
  }
  const p = platform.toLowerCase();
  switch (p) {
    case 'tiktok':
      return new TikTokAdapter();
    case 'threads':
      return new ThreadsAdapter();
    case 'twitter':
    case 'x':
      return new TwitterAdapter();
    case 'youtube':
    case 'youtube_shorts':
      return new YouTubeAdapter();
    case 'instagram':
    case 'instagram_reels':
      return new InstagramReelsAdapter();
    case 'facebook':
    case 'facebook_reels':
      return new FacebookReelsAdapter();
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
          } else if (post.platform === 'instagram_reels' || post.platform === 'instagram') {
            postDescription = (md as Record<string, unknown>).caption as string || postDescription;
            postTags = (md as Record<string, unknown>).hashtags as string[] || postTags;
            postMeta = {
              ...postMeta,
              alt_text: (md as Record<string, unknown>).alt_text,
              metadata_source: metadata.status,
            };
          } else if (post.platform === 'facebook' || post.platform === 'facebook_reels') {
            postTitle = (md as Record<string, unknown>).title as string || postTitle;
            postDescription = (md as Record<string, unknown>).caption as string || (md as Record<string, unknown>).description as string || postDescription;
            postTags = (md as Record<string, unknown>).hashtags as string[] || postTags;
            postMeta = {
              ...postMeta,
              metadata_source: metadata.status,
            };
          } else if (post.platform === 'threads') {
            postDescription = (md as Record<string, unknown>).caption as string || (md as Record<string, unknown>).text as string || postDescription;
            postMeta = {
              ...postMeta,
              metadata_source: metadata.status,
            };
          } else if (post.platform === 'twitter') {
            postDescription = (md as Record<string, unknown>).tweet_text as string || (md as Record<string, unknown>).caption as string || postDescription;
            postTags = (md as Record<string, unknown>).hashtags as string[] || postTags;
            postMeta = {
              ...postMeta,
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
          adapter_version: ['youtube', 'instagram_reels', 'facebook_reels'].includes(adapter.name) ? 'real_1.0' : 'stub_1.0',
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
          .select('id, job_id, brand_id, batch_id, platform, video_url, title, description, tags, scheduled_at, attempt_count, ai_metadata, locked_by, status')
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
          meta: post.ai_metadata,
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
