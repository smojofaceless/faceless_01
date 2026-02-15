// =====================================================
// METRICS COLLECTOR — Edge Function
// Roadmap #18: Metrics Collection v1
//
// Cron-triggered (every 30 min). Fetches engagement metrics
// (views, likes, comments, shares) from platform APIs for
// posted content. Stores append-only time-series in post_metrics.
//
// Flow:
//   1. Kill switch check
//   2. Find eligible posts (decay schedule)
//   3. For each post: adapter.getMetrics() → record_post_metrics
//   4. Handle partial failures gracefully
// =====================================================

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =====================================================
// TYPES
// =====================================================

interface MetricsResult {
  success: boolean;
  metrics?: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    watch_time_seconds?: number;
    avg_view_duration_seconds?: number;
    avg_view_percentage?: number;
    subscribers_gained?: number;
    subscribers_lost?: number;
  };
  raw?: Record<string, unknown>;
  error_class?: 'transient' | 'dependency' | 'misconfig' | 'permanent';
  error_message?: string;
}

interface EligiblePost {
  post_id: string;
  platform: string;
  platform_post_id: string;
  brand_id: string;
  batch_id: string | null;
  posted_at: string;
  post_age_hours: number;
  last_collected_at: string | null;
  interval_hours: number;
}

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

// =====================================================
// PLATFORM ADAPTERS
// =====================================================

interface MetricsAdapter {
  name: string;
  getMetrics(
    platformPostId: string,
    supabase: SupabaseClient,
    brandId: string
  ): Promise<MetricsResult>;
}

// ─────────────────────────────────────────────────────
// YouTube Shorts Metrics Adapter
// Uses YouTube Data API v3 /videos?part=statistics
// ─────────────────────────────────────────────────────
class YouTubeMetricsAdapter implements MetricsAdapter {
  name = 'youtube';

  async getMetrics(
    platformPostId: string,
    supabase: SupabaseClient,
    brandId: string
  ): Promise<MetricsResult> {
    console.log(`[YouTube Metrics] Fetching for video: ${platformPostId}`);

    // Get OAuth token
    const { data: tokenData, error: tokenError } = await supabase
      .from('platform_tokens')
      .select('*')
      .eq('brand_id', brandId)
      .eq('platform', 'youtube')
      .single();

    if (tokenError || !tokenData) {
      return {
        success: false,
        error_class: 'misconfig',
        error_message: 'YouTube not connected for this brand',
      };
    }

    if (!tokenData.is_valid) {
      return {
        success: false,
        error_class: 'misconfig',
        error_message: 'YouTube token is invalid. Please reconnect.',
      };
    }

    let accessToken = tokenData.access_token;

    // Check if token needs refresh
    const expiresAt = new Date(tokenData.token_expires_at);
    if (expiresAt <= new Date(Date.now() + 60_000)) {
      try {
        accessToken = await this.refreshToken(supabase, tokenData as PlatformToken);
      } catch (e) {
        return {
          success: false,
          error_class: 'misconfig',
          error_message: `Token refresh failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }

    // Extract video ID (handle full URLs or bare IDs)
    const videoId = this.extractVideoId(platformPostId);

    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=statistics,contentDetails`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        }
      );

      if (response.status === 401 || response.status === 403) {
        // Try refresh once
        try {
          accessToken = await this.refreshToken(supabase, tokenData as PlatformToken);
          const retryResponse = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=statistics,contentDetails`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
              },
            }
          );
          if (!retryResponse.ok) {
            return {
              success: false,
              error_class: 'misconfig',
              error_message: `YouTube API error after token refresh: ${retryResponse.status}`,
            };
          }
          const retryData = await retryResponse.json();
          return this.parseResponse(retryData, platformPostId);
        } catch {
          return {
            success: false,
            error_class: 'misconfig',
            error_message: 'YouTube token expired and refresh failed',
          };
        }
      }

      if (response.status === 404) {
        return {
          success: false,
          error_class: 'permanent',
          error_message: 'Video not found (deleted or private)',
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          error_class: 'dependency',
          error_message: 'YouTube API rate limit exceeded',
        };
      }

      if (!response.ok) {
        const errBody = await response.text();
        return {
          success: false,
          error_class: 'transient',
          error_message: `YouTube API error: ${response.status} - ${errBody.slice(0, 200)}`,
        };
      }

      const data = await response.json();
      return this.parseResponse(data, platformPostId);
    } catch (e) {
      return {
        success: false,
        error_class: 'transient',
        error_message: `Network error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  private parseResponse(data: Record<string, unknown>, platformPostId: string): MetricsResult {
    const items = (data as { items?: Array<Record<string, unknown>> }).items;
    if (!items || items.length === 0) {
      return {
        success: false,
        error_class: 'permanent',
        error_message: `Video ${platformPostId} not found in response`,
      };
    }

    const item = items[0];
    const stats = item.statistics as Record<string, string> | undefined;

    if (!stats) {
      return {
        success: false,
        error_class: 'transient',
        error_message: 'No statistics in YouTube response',
      };
    }

    return {
      success: true,
      metrics: {
        views: parseInt(stats.viewCount || '0', 10),
        likes: parseInt(stats.likeCount || '0', 10),
        comments: parseInt(stats.commentCount || '0', 10),
        shares: 0, // YouTube doesn't expose shares via Data API
        saves: parseInt(stats.favoriteCount || '0', 10),
      },
      raw: data,
    };
  }

  private extractVideoId(input: string): string {
    // Handle YouTube URLs
    if (input.includes('youtube.com') || input.includes('youtu.be')) {
      const url = new URL(input);
      if (url.hostname === 'youtu.be') return url.pathname.slice(1);
      return url.searchParams.get('v') || url.pathname.split('/').pop() || input;
    }
    return input;
  }

  private async refreshToken(supabase: SupabaseClient, tokenData: PlatformToken): Promise<string> {
    console.log('[YouTube Metrics] Refreshing access token...');

    const clientId = Deno.env.get('YOUTUBE_CLIENT_ID');
    const clientSecret = Deno.env.get('YOUTUBE_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new Error('YouTube OAuth credentials not configured');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenData.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      await supabase
        .from('platform_tokens')
        .update({ is_valid: false, last_error: `Metrics: token refresh failed ${response.status}` })
        .eq('id', tokenData.id);
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const tokens = await response.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

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

    return tokens.access_token;
  }
}

// ─────────────────────────────────────────────────────
// Instagram Reels Metrics Adapter
// Uses Instagram Graph API
// ─────────────────────────────────────────────────────
class InstagramMetricsAdapter implements MetricsAdapter {
  name = 'instagram_reels';
  private API_BASE = 'https://graph.facebook.com/v21.0';

  async getMetrics(
    platformPostId: string,
    supabase: SupabaseClient,
    brandId: string
  ): Promise<MetricsResult> {
    console.log(`[Instagram Metrics] Fetching for media: ${platformPostId}`);

    const { data: tokenData, error: tokenError } = await supabase
      .from('platform_tokens')
      .select('*')
      .eq('brand_id', brandId)
      .eq('platform', 'instagram')
      .single();

    if (tokenError || !tokenData) {
      return {
        success: false,
        error_class: 'misconfig',
        error_message: 'Instagram not connected for this brand',
      };
    }

    if (!tokenData.is_valid) {
      return {
        success: false,
        error_class: 'misconfig',
        error_message: 'Instagram token is invalid. Please reconnect.',
      };
    }

    const accessToken = tokenData.access_token;

    try {
      // Fetch basic metrics
      const mediaResponse = await fetch(
        `${this.API_BASE}/${platformPostId}?fields=like_count,comments_count,timestamp,media_type&access_token=${accessToken}`
      );

      if (mediaResponse.status === 404 || mediaResponse.status === 400) {
        const errData = await mediaResponse.json().catch(() => ({}));
        const errCode = (errData as { error?: { code?: number } })?.error?.code;
        // Code 100 = invalid media ID, treat as permanent
        if (errCode === 100 || mediaResponse.status === 404) {
          return {
            success: false,
            error_class: 'permanent',
            error_message: 'Media not found (deleted or unavailable)',
          };
        }
      }

      if (mediaResponse.status === 429) {
        return {
          success: false,
          error_class: 'dependency',
          error_message: 'Instagram API rate limit exceeded',
        };
      }

      if (mediaResponse.status === 401 || mediaResponse.status === 403) {
        return {
          success: false,
          error_class: 'misconfig',
          error_message: `Instagram token error: ${mediaResponse.status}`,
        };
      }

      if (!mediaResponse.ok) {
        return {
          success: false,
          error_class: 'transient',
          error_message: `Instagram API error: ${mediaResponse.status}`,
        };
      }

      const mediaData = await mediaResponse.json();

      // Try to fetch insights (reach, impressions, saved, shares)
      let insightsData: Record<string, unknown> | null = null;
      try {
        const insightsResponse = await fetch(
          `${this.API_BASE}/${platformPostId}/insights?metric=reach,impressions,saved,shares&access_token=${accessToken}`
        );
        if (insightsResponse.ok) {
          insightsData = await insightsResponse.json();
        }
      } catch {
        // Insights are optional — don't fail the whole collection
        console.log('[Instagram Metrics] Insights fetch failed (non-fatal)');
      }

      // Parse insights
      let saves = 0;
      let shares = 0;
      let views = 0;
      if (insightsData && (insightsData as { data?: Array<{ name: string; values: Array<{ value: number }> }> }).data) {
        const insights = (insightsData as { data: Array<{ name: string; values: Array<{ value: number }> }> }).data;
        for (const insight of insights) {
          const value = insight.values?.[0]?.value || 0;
          switch (insight.name) {
            case 'saved': saves = value; break;
            case 'shares': shares = value; break;
            case 'impressions': views = value; break;
            case 'reach': break; // stored in raw but not primary
          }
        }
      }

      return {
        success: true,
        metrics: {
          views: views,
          likes: (mediaData as { like_count?: number }).like_count || 0,
          comments: (mediaData as { comments_count?: number }).comments_count || 0,
          shares: shares,
          saves: saves,
        },
        raw: { media: mediaData, insights: insightsData },
      };
    } catch (e) {
      return {
        success: false,
        error_class: 'transient',
        error_message: `Network error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}

// ─────────────────────────────────────────────────────
// Facebook Reels Metrics Adapter
// Uses Facebook Graph API
// ─────────────────────────────────────────────────────
class FacebookMetricsAdapter implements MetricsAdapter {
  name = 'facebook_reels';
  private API_BASE = 'https://graph.facebook.com/v21.0';

  async getMetrics(
    platformPostId: string,
    supabase: SupabaseClient,
    brandId: string
  ): Promise<MetricsResult> {
    console.log(`[Facebook Metrics] Fetching for video: ${platformPostId}`);

    const { data: tokenData, error: tokenError } = await supabase
      .from('platform_tokens')
      .select('*')
      .eq('brand_id', brandId)
      .eq('platform', 'facebook')
      .single();

    if (tokenError || !tokenData) {
      return {
        success: false,
        error_class: 'misconfig',
        error_message: 'Facebook not connected for this brand',
      };
    }

    if (!tokenData.is_valid) {
      return {
        success: false,
        error_class: 'misconfig',
        error_message: 'Facebook token is invalid. Please reconnect.',
      };
    }

    const accessToken = tokenData.access_token;

    try {
      // Fetch video insights
      const response = await fetch(
        `${this.API_BASE}/${platformPostId}/video_insights?metric=total_video_impressions,total_video_views,total_video_reactions_by_type_total,total_video_stories_by_action_type&access_token=${accessToken}`
      );

      if (response.status === 404) {
        return {
          success: false,
          error_class: 'permanent',
          error_message: 'Facebook video not found (deleted)',
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          error_class: 'dependency',
          error_message: 'Facebook API rate limit exceeded',
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          error_class: 'misconfig',
          error_message: `Facebook token error: ${response.status}`,
        };
      }

      if (!response.ok) {
        return {
          success: false,
          error_class: 'transient',
          error_message: `Facebook API error: ${response.status}`,
        };
      }

      const data = await response.json();
      const insights = (data as { data?: Array<{ name: string; values: Array<{ value: number | Record<string, number> }> }> }).data || [];

      let views = 0;
      let likes = 0;
      let comments = 0;
      let shares = 0;

      for (const insight of insights) {
        const value = insight.values?.[0]?.value;
        switch (insight.name) {
          case 'total_video_views':
            views = typeof value === 'number' ? value : 0;
            break;
          case 'total_video_reactions_by_type_total':
            if (typeof value === 'object' && value !== null) {
              likes = Object.values(value).reduce((sum: number, v: unknown) => sum + (typeof v === 'number' ? v : 0), 0);
            }
            break;
          case 'total_video_stories_by_action_type':
            if (typeof value === 'object' && value !== null) {
              const actions = value as Record<string, number>;
              comments = actions.comment || 0;
              shares = actions.share || 0;
            }
            break;
        }
      }

      return {
        success: true,
        metrics: {
          views,
          likes,
          comments,
          shares,
          saves: 0, // Facebook doesn't expose saves for reels
        },
        raw: data,
      };
    } catch (e) {
      return {
        success: false,
        error_class: 'transient',
        error_message: `Network error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}

// ─────────────────────────────────────────────────────
// TikTok Metrics Adapter (STUB)
// TikTok API access is very limited — returns zeros
// ─────────────────────────────────────────────────────
class TikTokMetricsAdapter implements MetricsAdapter {
  name = 'tiktok';

  async getMetrics(
    platformPostId: string,
    _supabase: SupabaseClient,
    _brandId: string
  ): Promise<MetricsResult> {
    console.log(`[TikTok Metrics] Stub — returning zeros for: ${platformPostId}`);

    return {
      success: true,
      metrics: {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
      },
      raw: { stub: true, platformPostId, note: 'TikTok API not yet integrated' },
    };
  }
}

// ─────────────────────────────────────────────────────
// Adapter Registry
// ─────────────────────────────────────────────────────
function getMetricsAdapter(platform: string): MetricsAdapter {
  switch (platform) {
    case 'youtube':
    case 'youtube_shorts':
      return new YouTubeMetricsAdapter();
    case 'instagram':
    case 'instagram_reels':
      return new InstagramMetricsAdapter();
    case 'facebook':
    case 'facebook_reels':
      return new FacebookMetricsAdapter();
    case 'tiktok':
      return new TikTokMetricsAdapter();
    default:
      console.log(`[Metrics] No adapter for platform: ${platform}, using stub`);
      return new TikTokMetricsAdapter(); // Fallback stub
  }
}

// =====================================================
// MAIN HANDLER
// =====================================================

const BATCH_LIMIT = 50;

Deno.serve(async (req: Request) => {
  // CORS handling
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  const startTime = Date.now();
  const collectorId = `mc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  console.log(`\n========================================`);
  console.log(`[Metrics Collector] Starting run: ${collectorId}`);
  console.log(`========================================\n`);

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[Metrics Collector] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return new Response(
        JSON.stringify({ error: 'Missing environment variables' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ─── Step 1: Kill switch check ───
    const { data: killSwitchActive, error: ksError } = await supabase.rpc('is_kill_switch_active');
    if (ksError) {
      console.error('[Metrics Collector] Kill switch check failed:', ksError.message);
    }
    if (killSwitchActive) {
      console.log('[Metrics Collector] Kill switch is ACTIVE — aborting');
      return new Response(
        JSON.stringify({ status: 'aborted', reason: 'kill_switch_active' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ─── Step 2: Find eligible posts ───
    const { data: eligiblePosts, error: eligibleError } = await supabase
      .rpc('find_metrics_eligible_posts', { p_limit: BATCH_LIMIT });

    if (eligibleError) {
      console.error('[Metrics Collector] Failed to find eligible posts:', eligibleError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to find eligible posts', detail: eligibleError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const posts = (eligiblePosts || []) as EligiblePost[];
    console.log(`[Metrics Collector] Found ${posts.length} eligible posts`);

    if (posts.length === 0) {
      return new Response(
        JSON.stringify({
          status: 'complete',
          collector_id: collectorId,
          processed: 0,
          success: 0,
          errors: 0,
          duration_ms: Date.now() - startTime,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ─── Step 3: Process each post ───
    let successCount = 0;
    let errorCount = 0;
    let terminalCount = 0;
    const errors: Array<{ post_id: string; platform: string; error: string }> = [];

    for (const post of posts) {
      try {
        console.log(`\n[Metrics Collector] Processing: ${post.platform} | ${post.platform_post_id} | age=${post.post_age_hours}h`);

        // Get adapter
        const adapter = getMetricsAdapter(post.platform);

        // Fetch metrics
        const result = await adapter.getMetrics(post.platform_post_id, supabase, post.brand_id);

        if (result.success && result.metrics) {
          // Insert metrics
          const { error: insertError } = await supabase.rpc('record_post_metrics', {
            p_post_id: post.post_id,
            p_platform: post.platform,
            p_views: result.metrics.views,
            p_likes: result.metrics.likes,
            p_comments: result.metrics.comments,
            p_shares: result.metrics.shares,
            p_saves: result.metrics.saves,
            p_watch_time_seconds: result.metrics.watch_time_seconds || null,
            p_avg_view_duration: result.metrics.avg_view_duration_seconds || null,
            p_avg_view_pct: result.metrics.avg_view_percentage || null,
            p_subscribers_gained: result.metrics.subscribers_gained || 0,
            p_subscribers_lost: result.metrics.subscribers_lost || 0,
            p_source: adapter.name === 'tiktok' ? 'stub' : 'api',
            p_collector_id: collectorId,
            p_raw_payload: result.raw || {},
          });

          if (insertError) {
            console.error(`[Metrics Collector] Insert failed for ${post.post_id}:`, insertError.message);
            errorCount++;
            errors.push({ post_id: post.post_id, platform: post.platform, error: insertError.message });
          } else {
            successCount++;
            console.log(`[Metrics Collector] ✓ ${post.platform} | views=${result.metrics.views} likes=${result.metrics.likes}`);
          }
        } else {
          // Handle failure
          const errMsg = result.error_message || 'Unknown error';
          console.error(`[Metrics Collector] ✗ ${post.platform} | ${result.error_class}: ${errMsg}`);

          if (result.error_class === 'permanent') {
            // Mark post as metrics-terminal
            console.log(`[Metrics Collector] Marking post ${post.post_id} as metrics-terminal`);
            await supabase
              .from('posts')
              .update({
                meta: supabase.rpc ? undefined : undefined, // Can't merge JSONB in supabase-js easily
              })
              .eq('id', post.post_id);

            // Use raw SQL to merge the meta flag
            await supabase.rpc('record_post_metrics', {
              p_post_id: post.post_id,
              p_platform: post.platform,
              p_views: 0,
              p_likes: 0,
              p_comments: 0,
              p_shares: 0,
              p_saves: 0,
              p_source: 'api',
              p_collector_id: collectorId,
              p_raw_payload: result.raw || {},
              p_error: `[${result.error_class}] ${errMsg}`,
            });

            // Set metrics_terminal flag via direct update
            const { data: existingPost } = await supabase
              .from('posts')
              .select('meta')
              .eq('id', post.post_id)
              .single();

            const updatedMeta = { ...(existingPost?.meta || {}), metrics_terminal: true, metrics_terminal_reason: errMsg };
            await supabase
              .from('posts')
              .update({ meta: updatedMeta })
              .eq('id', post.post_id);

            terminalCount++;
          } else {
            // Record the error in metrics for tracking
            await supabase.rpc('record_post_metrics', {
              p_post_id: post.post_id,
              p_platform: post.platform,
              p_views: 0,
              p_likes: 0,
              p_comments: 0,
              p_shares: 0,
              p_saves: 0,
              p_source: 'api',
              p_collector_id: collectorId,
              p_raw_payload: result.raw || {},
              p_error: `[${result.error_class}] ${errMsg}`,
            });
          }

          errorCount++;
          errors.push({ post_id: post.post_id, platform: post.platform, error: errMsg });
        }
      } catch (e) {
        // Per-post error — don't crash the batch
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[Metrics Collector] Unhandled error for ${post.post_id}:`, errMsg);
        errorCount++;
        errors.push({ post_id: post.post_id, platform: post.platform, error: errMsg });
      }
    }

    // ─── Step 4: Summary ───
    const durationMs = Date.now() - startTime;
    const summary = {
      status: 'complete',
      collector_id: collectorId,
      processed: posts.length,
      success: successCount,
      errors: errorCount,
      terminal: terminalCount,
      duration_ms: durationMs,
      error_details: errors.length > 0 ? errors.slice(0, 10) : undefined,
    };

    console.log(`\n========================================`);
    console.log(`[Metrics Collector] Run complete: ${collectorId}`);
    console.log(`  Processed: ${posts.length}`);
    console.log(`  Success: ${successCount}`);
    console.log(`  Errors: ${errorCount}`);
    console.log(`  Terminal: ${terminalCount}`);
    console.log(`  Duration: ${durationMs}ms`);
    console.log(`========================================\n`);

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[Metrics Collector] Fatal error:`, errMsg);
    return new Response(
      JSON.stringify({ error: 'Fatal error', detail: errMsg, collector_id: collectorId }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
