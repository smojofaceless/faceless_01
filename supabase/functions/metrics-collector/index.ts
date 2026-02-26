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
          const retryResult = this.parseResponse(retryData, platformPostId);
          // Enrich with Analytics API after token refresh
          if (retryResult.success && retryResult.metrics) {
            try {
              const analyticsData = await this.fetchAnalytics(videoId, accessToken);
              if (analyticsData) {
                retryResult.metrics.watch_time_seconds = analyticsData.watchTimeSeconds;
                retryResult.metrics.avg_view_duration_seconds = analyticsData.avgViewDuration;
                retryResult.metrics.avg_view_percentage = analyticsData.avgViewPercentage;
                retryResult.metrics.shares = analyticsData.shares || retryResult.metrics.shares;
                retryResult.metrics.subscribers_gained = analyticsData.subscribersGained || 0;
                retryResult.metrics.subscribers_lost = analyticsData.subscribersLost || 0;
              }
            } catch { /* Analytics is best-effort */ }
          }
          return retryResult;
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
      const result = this.parseResponse(data, platformPostId);

      // Enrich with YouTube Analytics API (watch time / retention)
      if (result.success && result.metrics) {
        try {
          const analyticsData = await this.fetchAnalytics(videoId, accessToken);
          if (analyticsData) {
            result.metrics.watch_time_seconds = analyticsData.watchTimeSeconds;
            result.metrics.avg_view_duration_seconds = analyticsData.avgViewDuration;
            result.metrics.avg_view_percentage = analyticsData.avgViewPercentage;
            result.metrics.shares = analyticsData.shares || result.metrics.shares;
            result.metrics.subscribers_gained = analyticsData.subscribersGained || 0;
            result.metrics.subscribers_lost = analyticsData.subscribersLost || 0;
            console.log(`[YouTube Metrics] Analytics enrichment: avgDur=${analyticsData.avgViewDuration}s, avgPct=${analyticsData.avgViewPercentage}%, watchTime=${analyticsData.watchTimeSeconds}s`);
          }
        } catch (analyticsErr) {
          // Analytics is best-effort — don't fail the whole metric collection
          console.warn(`[YouTube Metrics] Analytics enrichment failed (non-fatal): ${analyticsErr instanceof Error ? analyticsErr.message : String(analyticsErr)}`);
        }
      }

      return result;
    } catch (e) {
      return {
        success: false,
        error_class: 'transient',
        error_message: `Network error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  /**
   * Fetch YouTube Analytics API data for a video (watch time, retention, shares)
   * Requires yt-analytics.readonly scope
   */
  private async fetchAnalytics(
    videoId: string,
    accessToken: string
  ): Promise<{
    watchTimeSeconds: number;
    avgViewDuration: number;
    avgViewPercentage: number;
    shares: number;
    subscribersGained: number;
    subscribersLost: number;
  } | null> {
    // Use wide date range to capture lifetime stats for this video
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = '2020-01-01'; // far enough back to capture any video

    const metrics = [
      'views',
      'estimatedMinutesWatched',
      'averageViewDuration',
      'averageViewPercentage',
      'shares',
      'subscribersGained',
      'subscribersLost',
    ].join(',');

    const url =
      `https://youtubeanalytics.googleapis.com/v2/reports?` +
      `ids=channel==MINE` +
      `&startDate=${startDate}` +
      `&endDate=${endDate}` +
      `&metrics=${metrics}` +
      `&dimensions=video` +
      `&filters=video==${videoId}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[YouTube Analytics] API error ${response.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await response.json();
    if (!data.rows || data.rows.length === 0) {
      console.log(`[YouTube Analytics] No analytics data yet for video ${videoId}`);
      return null;
    }

    const row = data.rows[0];
    const columnHeaders = (data.columnHeaders || []).map(
      (h: { name: string }) => h.name
    );

    const getValue = (name: string): number => {
      const idx = columnHeaders.indexOf(name);
      return idx >= 0 ? (row[idx] as number) : 0;
    };

    return {
      watchTimeSeconds: Math.round(getValue('estimatedMinutesWatched') * 60),
      avgViewDuration: Math.round(getValue('averageViewDuration')),
      avgViewPercentage: Math.round(getValue('averageViewPercentage') * 10) / 10,
      shares: getValue('shares'),
      subscribersGained: getValue('subscribersGained'),
      subscribersLost: getValue('subscribersLost'),
    };
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

    // Check if token needs refresh (Instagram long-lived tokens last 60 days)
    if (tokenData.token_expires_at) {
      const expiresAt = new Date(tokenData.token_expires_at);
      if (expiresAt <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) {
        // Token expires within 7 days — proactively refresh
        try {
          const newToken = await this.refreshToken(supabase, tokenData as PlatformToken);
          return this.fetchMetrics(platformPostId, newToken, supabase, brandId, tokenData as PlatformToken);
        } catch (e) {
          console.log(`[Instagram Metrics] Proactive refresh failed, using current token: ${e}`);
        }
      }
    }

    return this.fetchMetrics(platformPostId, accessToken, supabase, brandId, tokenData as PlatformToken);
  }

  private async fetchMetrics(
    platformPostId: string,
    accessToken: string,
    supabase: SupabaseClient,
    brandId: string,
    tokenData: PlatformToken
  ): Promise<MetricsResult> {
    try {
      // Fetch basic metrics (include media_product_type to detect Reels)
      const mediaResponse = await fetch(
        `${this.API_BASE}/${platformPostId}?fields=like_count,comments_count,timestamp,media_type,media_product_type&access_token=${accessToken}`
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
        // Try token refresh before giving up
        try {
          console.log(`[Instagram Metrics] Got ${mediaResponse.status}, attempting token refresh...`);
          const newToken = await this.refreshToken(supabase, tokenData);
          const retryResponse = await fetch(
            `${this.API_BASE}/${platformPostId}?fields=like_count,comments_count,timestamp,media_type,media_product_type&access_token=${newToken}`
          );
          if (retryResponse.ok) {
            // Retry succeeded — parse this response
            const retryMediaData = await retryResponse.json();
            // Continue with refreshed token for insights
            return this.fetchInsightsAndBuild(platformPostId, newToken, retryMediaData);
          }
        } catch (refreshErr) {
          console.log(`[Instagram Metrics] Token refresh failed: ${refreshErr}`);
        }

        // Refresh failed or retry failed — mark token invalid
        await supabase
          .from('platform_tokens')
          .update({ is_valid: false, last_error: `Metrics: Instagram token error ${mediaResponse.status}` })
          .eq('brand_id', brandId)
          .eq('platform', 'instagram');

        return {
          success: false,
          error_class: 'misconfig',
          error_message: `Instagram token error: ${mediaResponse.status}. Token marked invalid.`,
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

      // Fetch insights (views, likes, comments, saved, shares, reach)
      // v21.0+ uses unified metric names for all media types including Reels
      let insightsData: Record<string, unknown> | null = null;
      try {
        const insightsResponse = await fetch(
          `${this.API_BASE}/${platformPostId}/insights?metric=views,likes,comments,saved,shares,reach,ig_reels_avg_watch_time,ig_reels_video_view_total_time&access_token=${accessToken}`
        );
        if (insightsResponse.ok) {
          insightsData = await insightsResponse.json();
        } else {
          // Fallback for older media: try legacy metric names
          console.log(`[Instagram Metrics] v21 metrics failed (${insightsResponse.status}), trying legacy`);
          const fallbackResponse = await fetch(
            `${this.API_BASE}/${platformPostId}/insights?metric=reach,impressions,saved,shares&access_token=${accessToken}`
          );
          if (fallbackResponse.ok) {
            insightsData = await fallbackResponse.json();
          }
        }
      } catch {
        // Insights are optional — don't fail the whole collection
        console.log('[Instagram Metrics] Insights fetch failed (non-fatal)');
      }

      // Parse insights
      let saves = 0;
      let shares = 0;
      let views = 0;
      let insightLikes = -1; // -1 = not from insights (use media endpoint value)
      let insightComments = -1;
      let avgWatchTimeMs = 0;  // ig_reels_avg_watch_time (milliseconds)
      let totalWatchTimeMs = 0; // ig_reels_video_view_total_time (milliseconds)
      if (insightsData && (insightsData as { data?: Array<{ name: string; values: Array<{ value: number }> }> }).data) {
        const insights = (insightsData as { data: Array<{ name: string; values: Array<{ value: number }> }> }).data;
        for (const insight of insights) {
          const value = insight.values?.[0]?.value || 0;
          switch (insight.name) {
            case 'saved': saves = value; break;
            case 'shares': shares = value; break;
            case 'views': views = value; break;
            case 'impressions': views = value; break; // legacy fallback
            case 'likes': insightLikes = value; break;
            case 'comments': insightComments = value; break;
            case 'reach': break; // stored in raw but not primary
            case 'ig_reels_avg_watch_time': avgWatchTimeMs = value; break;
            case 'ig_reels_video_view_total_time': totalWatchTimeMs = value; break;
          }
        }
      }

      // Use insights likes/comments if available (more accurate), otherwise fall back to media endpoint
      const finalLikes = insightLikes >= 0 ? insightLikes : ((mediaData as { like_count?: number }).like_count || 0);
      const finalComments = insightComments >= 0 ? insightComments : ((mediaData as { comments_count?: number }).comments_count || 0);

      // Calculate retention metrics from Reels data
      const avgWatchTimeSec = avgWatchTimeMs > 0 ? Math.round(avgWatchTimeMs / 1000 * 100) / 100 : undefined;
      const totalWatchTimeSec = totalWatchTimeMs > 0 ? Math.round(totalWatchTimeMs / 1000) : undefined;

      return {
        success: true,
        metrics: {
          views: views,
          likes: finalLikes,
          comments: finalComments,
          shares: shares,
          saves: saves,
          watch_time_seconds: totalWatchTimeSec,
          avg_view_duration_seconds: avgWatchTimeSec,
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

  // Fetch insights and build result (used after token refresh retry)
  private async fetchInsightsAndBuild(
    platformPostId: string,
    accessToken: string,
    mediaData: Record<string, unknown>
  ): Promise<MetricsResult> {
    let insightsData: Record<string, unknown> | null = null;
    try {
      const insightsResponse = await fetch(
        `${this.API_BASE}/${platformPostId}/insights?metric=views,likes,comments,saved,shares,reach,ig_reels_avg_watch_time,ig_reels_video_view_total_time&access_token=${accessToken}`
      );
      if (insightsResponse.ok) {
        insightsData = await insightsResponse.json();
      }
    } catch { /* non-fatal */ }

    let saves = 0, shares = 0, views = 0, insightLikes = -1, insightComments = -1;
    let avgWatchTimeMs = 0, totalWatchTimeMs = 0;
    if (insightsData && (insightsData as { data?: Array<{ name: string; values: Array<{ value: number }> }> }).data) {
      const insights = (insightsData as { data: Array<{ name: string; values: Array<{ value: number }> }> }).data;
      for (const insight of insights) {
        const value = insight.values?.[0]?.value || 0;
        switch (insight.name) {
          case 'saved': saves = value; break;
          case 'shares': shares = value; break;
          case 'views': views = value; break;
          case 'impressions': views = value; break;
          case 'likes': insightLikes = value; break;
          case 'comments': insightComments = value; break;
          case 'ig_reels_avg_watch_time': avgWatchTimeMs = value; break;
          case 'ig_reels_video_view_total_time': totalWatchTimeMs = value; break;
        }
      }
    }

    const finalLikes = insightLikes >= 0 ? insightLikes : ((mediaData as { like_count?: number }).like_count || 0);
    const finalComments = insightComments >= 0 ? insightComments : ((mediaData as { comments_count?: number }).comments_count || 0);

    const avgWatchTimeSec = avgWatchTimeMs > 0 ? Math.round(avgWatchTimeMs / 1000 * 100) / 100 : undefined;
    const totalWatchTimeSec = totalWatchTimeMs > 0 ? Math.round(totalWatchTimeMs / 1000) : undefined;

    return {
      success: true,
      metrics: {
        views, likes: finalLikes, comments: finalComments, shares, saves,
        watch_time_seconds: totalWatchTimeSec,
        avg_view_duration_seconds: avgWatchTimeSec,
      },
      raw: { media: mediaData, insights: insightsData },
    };
  }

  // Refresh Instagram long-lived token (valid 60 days, refreshable if not expired)
  private async refreshToken(supabase: SupabaseClient, tokenData: PlatformToken): Promise<string> {
    console.log('[Instagram Metrics] Refreshing long-lived token...');

    // Instagram Graph API long-lived token refresh
    // GET /oauth/access_token?grant_type=ig_refresh_token&access_token={token}
    const response = await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${tokenData.access_token}`
    );

    if (!response.ok) {
      // Fallback: try Facebook token exchange (for IG Business via Facebook Login)
      const fbAppSecret = Deno.env.get('FACEBOOK_APP_SECRET');
      const fbAppId = Deno.env.get('FACEBOOK_APP_ID');
      if (fbAppId && fbAppSecret) {
        console.log('[Instagram Metrics] IG refresh failed, trying FB token exchange...');
        const fbResponse = await fetch(
          `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${fbAppId}&client_secret=${fbAppSecret}&fb_exchange_token=${tokenData.access_token}`
        );
        if (fbResponse.ok) {
          const fbData = await fbResponse.json();
          const expiresAt = new Date(Date.now() + (fbData.expires_in || 5184000) * 1000).toISOString();
          await supabase
            .from('platform_tokens')
            .update({
              access_token: fbData.access_token,
              token_expires_at: expiresAt,
              is_valid: true,
              last_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', tokenData.id);
          return fbData.access_token;
        }
      }
      throw new Error(`Instagram token refresh failed: ${response.status}`);
    }

    const data = await response.json();
    const expiresAt = new Date(Date.now() + (data.expires_in || 5184000) * 1000).toISOString();

    await supabase
      .from('platform_tokens')
      .update({
        access_token: data.access_token,
        token_expires_at: expiresAt,
        is_valid: true,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tokenData.id);

    console.log(`[Instagram Metrics] Token refreshed, expires: ${expiresAt}`);
    return data.access_token;
  }
}

// ─────────────────────────────────────────────────────
// Facebook Reels Metrics Adapter
// Uses Facebook Graph API — video_insights for plays + direct fields for engagement
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

    // Use page_access_token for page-owned content (Reels are page videos)
    const accessToken = tokenData.metadata?.page_access_token || tokenData.access_token;

    try {
      // --- 1. Fetch Reel play counts via video_insights (requires read_insights) ---
      const insightsUrl = `${this.API_BASE}/${platformPostId}/video_insights?metric=fb_reels_total_plays,fb_reels_replay_count,blue_reels_play_count&access_token=${accessToken}`;
      const insightsRes = await fetch(insightsUrl);

      let totalPlays = 0;
      let initialPlays = 0;
      let replays = 0;
      let insightsRaw: unknown = null;
      let usedInsights = false;

      if (insightsRes.ok) {
        const insightsData = await insightsRes.json() as {
          data?: Array<{ name: string; values: Array<{ value: number }> }>;
        };
        insightsRaw = insightsData;

        for (const insight of insightsData.data || []) {
          const val = insight.values?.[0]?.value ?? 0;
          switch (insight.name) {
            case 'fb_reels_total_plays':
              totalPlays = val;
              usedInsights = true;
              break;
            case 'blue_reels_play_count':
              initialPlays = val;
              break;
            case 'fb_reels_replay_count':
              replays = val;
              break;
          }
        }
        console.log(`[Facebook Metrics] Insights: total_plays=${totalPlays}, initial=${initialPlays}, replays=${replays}`);
      } else {
        console.log(`[Facebook Metrics] video_insights returned ${insightsRes.status}, falling back to direct fields`);
      }

      // --- 2. Fetch engagement via direct video-node fields ---
      const fieldsUrl = `${this.API_BASE}/${platformPostId}?fields=id,views,likes.summary(true),comments.summary(true)&access_token=${accessToken}`;
      const fieldsRes = await fetch(fieldsUrl);

      if (fieldsRes.status === 404) {
        return {
          success: false,
          error_class: 'permanent',
          error_message: 'Facebook video not found (deleted)',
        };
      }

      if (fieldsRes.status === 429) {
        return {
          success: false,
          error_class: 'dependency',
          error_message: 'Facebook API rate limit exceeded',
        };
      }

      if (fieldsRes.status === 401 || fieldsRes.status === 403) {
        await supabase
          .from('platform_tokens')
          .update({ is_valid: false, last_error: `Metrics: Facebook token error ${fieldsRes.status}` })
          .eq('brand_id', brandId)
          .eq('platform', 'facebook');

        return {
          success: false,
          error_class: 'misconfig',
          error_message: `Facebook token error: ${fieldsRes.status}. Token marked invalid.`,
        };
      }

      if (!fieldsRes.ok) {
        return {
          success: false,
          error_class: 'transient',
          error_message: `Facebook API error: ${fieldsRes.status}`,
        };
      }

      const fieldsData = await fieldsRes.json() as {
        id: string;
        views?: number;
        likes?: { summary?: { total_count?: number } };
        comments?: { summary?: { total_count?: number } };
      };

      // Use fb_reels_total_plays if available (matches FB UI), otherwise fall
      // back to the direct `views` field (3-second views).
      const views = usedInsights ? totalPlays : (fieldsData.views ?? 0);
      const likes = fieldsData.likes?.summary?.total_count ?? 0;
      const comments = fieldsData.comments?.summary?.total_count ?? 0;

      return {
        success: true,
        metrics: {
          views,
          likes,
          comments,
          shares: 0, // Not available on Video node
          saves: 0,  // Facebook doesn't expose saves for reels
        },
        raw: { insights: insightsRaw, fields: fieldsData },
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
// Threads Metrics Adapter
// Uses Threads API — insights endpoint for views, likes, replies, reposts, quotes
// API: graph.threads.net/v1.0/{media_id}/insights?metric=views,likes,replies,reposts,quotes
// ─────────────────────────────────────────────────────
class ThreadsMetricsAdapter implements MetricsAdapter {
  name = 'threads';
  private API_BASE = 'https://graph.threads.net/v1.0';

  async getMetrics(
    platformPostId: string,
    supabase: SupabaseClient,
    brandId: string
  ): Promise<MetricsResult> {
    console.log(`[Threads Metrics] Fetching for media: ${platformPostId}`);

    // 1. Get token
    const { data: tokenData, error: tokenError } = await supabase
      .from('platform_tokens')
      .select('*')
      .eq('brand_id', brandId)
      .eq('platform', 'threads')
      .single();

    if (tokenError || !tokenData) {
      return {
        success: false,
        error_class: 'misconfig',
        error_message: 'Threads not connected for this brand',
      };
    }

    if (!tokenData.is_valid) {
      return {
        success: false,
        error_class: 'misconfig',
        error_message: 'Threads token is invalid. Please reconnect.',
      };
    }

    let accessToken = tokenData.access_token;

    // 2. Proactively refresh token if expiring within 7 days
    if (tokenData.token_expires_at) {
      const expiresAt = new Date(tokenData.token_expires_at);
      if (expiresAt.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000) {
        try {
          accessToken = await this.refreshToken(supabase, tokenData as PlatformToken);
        } catch (e) {
          console.log(`[Threads Metrics] Proactive refresh failed, using current token: ${e}`);
        }
      }
    }

    return this.fetchMetrics(platformPostId, accessToken, supabase, brandId, tokenData as PlatformToken);
  }

  private async fetchMetrics(
    platformPostId: string,
    accessToken: string,
    supabase: SupabaseClient,
    brandId: string,
    tokenData: PlatformToken
  ): Promise<MetricsResult> {
    try {
      // Threads Insights API — fetch all available metrics
      // Available metrics: views, likes, replies, reposts, quotes
      const insightsUrl = `${this.API_BASE}/${platformPostId}/insights?metric=views,likes,replies,reposts,quotes&access_token=${accessToken}`;
      const insightsRes = await fetch(insightsUrl);

      if (insightsRes.status === 404 || insightsRes.status === 400) {
        const errData = await insightsRes.json().catch(() => ({}));
        const errMsg = (errData as { error?: { message?: string } })?.error?.message || '';
        // Invalid media ID or deleted post
        if (insightsRes.status === 404 || errMsg.includes('does not exist')) {
          return {
            success: false,
            error_class: 'permanent',
            error_message: 'Threads post not found (deleted or unavailable)',
          };
        }
        // Some posts may not have insights yet (too new)
        return {
          success: false,
          error_class: 'transient',
          error_message: `Threads insights error ${insightsRes.status}: ${errMsg}`,
        };
      }

      if (insightsRes.status === 429) {
        return {
          success: false,
          error_class: 'dependency',
          error_message: 'Threads API rate limit exceeded',
        };
      }

      if (insightsRes.status === 401 || insightsRes.status === 403) {
        // Try token refresh
        try {
          console.log(`[Threads Metrics] Got ${insightsRes.status}, attempting token refresh...`);
          const newToken = await this.refreshToken(supabase, tokenData);
          const retryRes = await fetch(
            `${this.API_BASE}/${platformPostId}/insights?metric=views,likes,replies,reposts,quotes&access_token=${newToken}`
          );
          if (retryRes.ok) {
            return this.parseInsights(await retryRes.json());
          }
        } catch (refreshErr) {
          console.log(`[Threads Metrics] Token refresh failed: ${refreshErr}`);
        }

        // Refresh failed — mark token invalid
        await supabase
          .from('platform_tokens')
          .update({ is_valid: false, last_error: `Metrics: Threads token error ${insightsRes.status}` })
          .eq('brand_id', brandId)
          .eq('platform', 'threads');

        return {
          success: false,
          error_class: 'misconfig',
          error_message: `Threads token error: ${insightsRes.status}. Token marked invalid.`,
        };
      }

      if (!insightsRes.ok) {
        return {
          success: false,
          error_class: 'transient',
          error_message: `Threads API error: ${insightsRes.status}`,
        };
      }

      const insightsData = await insightsRes.json();
      return this.parseInsights(insightsData);

    } catch (e) {
      return {
        success: false,
        error_class: 'transient',
        error_message: `Network error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  private parseInsights(insightsData: unknown): MetricsResult {
    // Threads insights response format:
    // { data: [ { name: "views", values: [{ value: N }] }, ... ] }
    let views = 0;
    let likes = 0;
    let replies = 0;  // maps to comments
    let reposts = 0;  // maps to shares
    let quotes = 0;

    const data = (insightsData as { data?: Array<{ name: string; values: Array<{ value: number }> }> })?.data;
    if (data) {
      for (const insight of data) {
        const value = insight.values?.[0]?.value ?? 0;
        switch (insight.name) {
          case 'views': views = value; break;
          case 'likes': likes = value; break;
          case 'replies': replies = value; break;
          case 'reposts': reposts = value; break;
          case 'quotes': quotes = value; break;
        }
      }
    }

    console.log(`[Threads Metrics] views=${views}, likes=${likes}, replies=${replies}, reposts=${reposts}, quotes=${quotes}`);

    return {
      success: true,
      metrics: {
        views,
        likes,
        comments: replies,       // Threads "replies" = our "comments"
        shares: reposts + quotes, // Threads "reposts" + "quotes" = our "shares"
        saves: 0,                 // Threads doesn't expose saves
      },
      raw: insightsData as Record<string, unknown>,
    };
  }

  // Refresh Threads long-lived token (valid 60 days, refreshable)
  private async refreshToken(supabase: SupabaseClient, tokenData: PlatformToken): Promise<string> {
    console.log('[Threads Metrics] Refreshing long-lived token...');

    const response = await fetch(
      `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${tokenData.access_token}`
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[Threads Metrics] Token refresh failed:', errorBody);
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

    console.log(`[Threads Metrics] Token refreshed, expires: ${expiresAt}`);
    return tokens.access_token;
  }
}

// ─────────────────────────────────────────────────────
// Adapter Registry
// Returns null for platforms without real API adapters
// so we skip them instead of recording fake zeros
// ─────────────────────────────────────────────────────
const STUB_PLATFORMS = new Set(['tiktok', 'twitter', 'x']);

function getMetricsAdapter(platform: string): MetricsAdapter | null {
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
    case 'threads':
      return new ThreadsMetricsAdapter();
    case 'tiktok':
    case 'twitter':
    case 'x':
      console.log(`[Metrics] Skipping stub platform: ${platform} (no API adapter yet)`);
      return null;
    default:
      console.log(`[Metrics] No adapter for platform: ${platform}, skipping`);
      return null;
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
        'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://smojofaceless.github.io',
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
    let skippedCooldown = 0;
    let skippedStub = 0;
    const errors: Array<{ post_id: string; platform: string; error: string }> = [];

    // Per-platform 429 cooldown: skip remaining posts on a platform after rate limit hit
    const platformCooldown = new Set<string>();

    for (const post of posts) {
      try {
        // Skip stub platforms entirely — no fake zeros
        if (STUB_PLATFORMS.has(post.platform)) {
          console.log(`[Metrics Collector] Skipping stub platform ${post.platform} | ${post.platform_post_id}`);
          skippedStub++;
          continue;
        }

        // Skip if this platform hit a rate limit earlier in this batch
        if (platformCooldown.has(post.platform)) {
          console.log(`[Metrics Collector] Skipping ${post.platform} | ${post.platform_post_id} (platform cooldown)`);
          skippedCooldown++;
          continue;
        }

        console.log(`\n[Metrics Collector] Processing: ${post.platform} | ${post.platform_post_id} | age=${post.post_age_hours}h`);

        // Get adapter
        const adapter = getMetricsAdapter(post.platform);

        if (!adapter) {
          console.log(`[Metrics Collector] No adapter for ${post.platform}, skipping`);
          skippedStub++;
          continue;
        }

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

          // On rate limit (dependency), cool down the entire platform for this batch
          if (result.error_class === 'dependency') {
            platformCooldown.add(post.platform);
            console.log(`[Metrics Collector] Platform ${post.platform} added to cooldown (429/rate-limit)`);
          }

          if (result.error_class === 'permanent') {
            // Mark post as metrics-terminal
            console.log(`[Metrics Collector] Marking post ${post.post_id} as metrics-terminal`);

            // Record the terminal error snapshot
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
      skipped_cooldown: skippedCooldown,
      skipped_stub: skippedStub,
      cooled_platforms: platformCooldown.size > 0 ? Array.from(platformCooldown) : undefined,
      duration_ms: durationMs,
      error_details: errors.length > 0 ? errors.slice(0, 10) : undefined,
    };

    console.log(`\n========================================`);
    console.log(`[Metrics Collector] Run complete: ${collectorId}`);
    console.log(`  Processed: ${posts.length}`);
    console.log(`  Success: ${successCount}`);
    console.log(`  Errors: ${errorCount}`);
    console.log(`  Terminal: ${terminalCount}`);
    console.log(`  Skipped (stub): ${skippedStub}`);
    console.log(`  Skipped (cooldown): ${skippedCooldown}`);
    console.log(`  Cooled platforms: ${platformCooldown.size > 0 ? Array.from(platformCooldown).join(', ') : 'none'}`);
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
