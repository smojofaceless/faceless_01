// Auto-Poster Edge Function
// Runs on a cron schedule (every 15 minutes) to post scheduled content
// Cron: */15 * * * * (configure in supabase/config.toml or dashboard)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

// Types
interface Post {
  id: string;
  brand_id: string;
  user_id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  platforms: string[];
  tags: string[];
  status: string;
  scheduled_at: string;
  privacy_status: string;
  metadata: Record<string, unknown>;
}

interface PlatformToken {
  id: string;
  brand_id: string;
  platform: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  channel_id: string | null;
  channel_name: string | null;
  metadata: Record<string, unknown>;
}

interface YouTubeUploadResult {
  id: string;
  url: string;
  status: string;
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('[Auto-Poster] Starting scheduled post check...');

    // Get posts due for posting
    const postsDue = await getPostsDueForPosting(supabase);

    if (postsDue.length === 0) {
      console.log('[Auto-Poster] No posts due for posting');
      return new Response(
        JSON.stringify({ success: true, message: 'No posts due', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Auto-Poster] Found ${postsDue.length} posts due for posting`);

    // Process each post
    const results = [];
    for (const post of postsDue) {
      const result = await processPost(supabase, post);
      results.push(result);
      
      // Small delay between posts to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`[Auto-Poster] Complete: ${successful} succeeded, ${failed} failed`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        processed: results.length,
        successful,
        failed,
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Auto-Poster] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function getPostsDueForPosting(supabase: SupabaseClient): Promise<Post[]> {
  // Get scheduled posts where scheduled_at is in the past (with 5 min buffer)
  const bufferMinutes = 5;
  const cutoffTime = new Date(Date.now() + bufferMinutes * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', cutoffTime)
    .order('scheduled_at', { ascending: true })
    .limit(10); // Process max 10 at a time

  if (error) {
    console.error('[Auto-Poster] Error fetching posts:', error);
    throw error;
  }

  return data || [];
}

async function processPost(supabase: SupabaseClient, post: Post): Promise<{ id: string; success: boolean; error?: string; result?: unknown }> {
  console.log(`[Auto-Poster] Processing post: ${post.id} - "${post.title}"`);

  try {
    // Mark as posting
    await supabase
      .from('posts')
      .update({ 
        status: 'posting',
        updated_at: new Date().toISOString()
      })
      .eq('id', post.id);

    const platformResults: Record<string, unknown> = {};
    const errors: string[] = [];

    // Process each platform
    for (const platform of post.platforms) {
      try {
        switch (platform) {
          case 'youtube':
            const ytResult = await postToYouTube(supabase, post);
            platformResults.youtube = ytResult;
            break;
          case 'tiktok':
            // TikTok implementation placeholder
            console.log(`[Auto-Poster] TikTok posting not yet implemented`);
            platformResults.tiktok = { status: 'not_implemented' };
            break;
          case 'instagram':
            // Instagram implementation placeholder
            console.log(`[Auto-Poster] Instagram posting not yet implemented`);
            platformResults.instagram = { status: 'not_implemented' };
            break;
          default:
            console.log(`[Auto-Poster] Unknown platform: ${platform}`);
        }
      } catch (e) {
        console.error(`[Auto-Poster] Error posting to ${platform}:`, e);
        errors.push(`${platform}: ${e.message}`);
        platformResults[platform] = { error: e.message };
      }
    }

    // Determine final status
    const hasSuccess = Object.values(platformResults).some(r => (r as any).id);
    const allFailed = errors.length === post.platforms.length;

    if (allFailed) {
      await supabase
        .from('posts')
        .update({
          status: 'failed',
          error_message: errors.join('; '),
          platform_results: platformResults,
          updated_at: new Date().toISOString()
        })
        .eq('id', post.id);

      return { id: post.id, success: false, error: errors.join('; ') };
    }

    // Mark as posted
    await supabase
      .from('posts')
      .update({
        status: 'posted',
        posted_at: new Date().toISOString(),
        platform_results: platformResults,
        error_message: errors.length > 0 ? errors.join('; ') : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', post.id);

    // Create initial analytics record
    if (platformResults.youtube?.id) {
      await supabase.from('post_analytics').upsert({
        post_id: post.id,
        platform: 'youtube',
        platform_video_id: platformResults.youtube.id,
        snapshot_date: new Date().toISOString().split('T')[0],
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0
      });
    }

    return { id: post.id, success: true, result: platformResults };

  } catch (error) {
    console.error(`[Auto-Poster] Failed to process post ${post.id}:`, error);
    
    await supabase
      .from('posts')
      .update({
        status: 'failed',
        error_message: error.message,
        updated_at: new Date().toISOString()
      })
      .eq('id', post.id);

    return { id: post.id, success: false, error: error.message };
  }
}

async function postToYouTube(supabase: SupabaseClient, post: Post): Promise<YouTubeUploadResult> {
  console.log(`[Auto-Poster] Posting to YouTube: ${post.title}`);

  // Get platform token for this brand
  const { data: tokenData, error: tokenError } = await supabase
    .from('platform_tokens')
    .select('*')
    .eq('brand_id', post.brand_id)
    .eq('platform', 'youtube')
    .single();

  if (tokenError || !tokenData) {
    throw new Error('YouTube not connected for this brand');
  }

  // Check if token needs refresh
  let accessToken = tokenData.access_token;
  if (new Date(tokenData.expires_at) <= new Date()) {
    accessToken = await refreshYouTubeToken(supabase, tokenData);
  }

  // Download video from storage
  console.log(`[Auto-Poster] Downloading video from: ${post.video_url}`);
  const videoResponse = await fetch(post.video_url);
  if (!videoResponse.ok) {
    throw new Error(`Failed to fetch video: ${videoResponse.status}`);
  }
  const videoBlob = await videoResponse.blob();

  // Prepare metadata
  const metadata = {
    snippet: {
      title: post.title,
      description: post.description || '',
      tags: post.tags || [],
      categoryId: '22' // People & Blogs
    },
    status: {
      privacyStatus: post.privacy_status || 'public',
      selfDeclaredMadeForKids: false,
      // For Shorts
      ...(post.metadata?.isShort && { 
        madeForKids: false 
      })
    }
  };

  // Initiate resumable upload
  console.log('[Auto-Poster] Initiating YouTube upload...');
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
      body: JSON.stringify(metadata)
    }
  );

  if (!initResponse.ok) {
    const errorBody = await initResponse.text();
    console.error('[Auto-Poster] YouTube init error:', errorBody);
    throw new Error(`YouTube upload init failed: ${initResponse.status}`);
  }

  const uploadUrl = initResponse.headers.get('Location');
  if (!uploadUrl) {
    throw new Error('No upload URL returned from YouTube');
  }

  // Upload video data
  console.log('[Auto-Poster] Uploading video data...');
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
    console.error('[Auto-Poster] YouTube upload error:', errorBody);
    throw new Error(`YouTube upload failed: ${uploadResponse.status}`);
  }

  const result = await uploadResponse.json();
  console.log(`[Auto-Poster] YouTube upload complete! Video ID: ${result.id}`);

  return {
    id: result.id,
    url: `https://youtube.com/shorts/${result.id}`,
    status: result.status?.uploadStatus || 'uploaded'
  };
}

async function refreshYouTubeToken(supabase: SupabaseClient, tokenData: PlatformToken): Promise<string> {
  console.log('[Auto-Poster] Refreshing YouTube token...');

  const clientId = Deno.env.get('YOUTUBE_CLIENT_ID');
  const clientSecret = Deno.env.get('YOUTUBE_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error('YouTube OAuth credentials not configured');
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
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const tokens = await response.json();

  // Update token in database
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  
  await supabase
    .from('platform_tokens')
    .update({
      access_token: tokens.access_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString()
    })
    .eq('id', tokenData.id);

  console.log('[Auto-Poster] Token refreshed successfully');
  return tokens.access_token;
}
