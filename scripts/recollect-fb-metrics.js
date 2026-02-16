// Recollect Facebook Reels metrics using direct video-node fields
// (bypasses video_insights which requires read_insights permission)
const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDc0NzksImV4cCI6MjA4NTEyMzQ3OX0.5lEiAP6PS4yY3WwAL5v4XWFHWJS5hzBWPXQxuxWe5d4';
const FB_API = 'https://graph.facebook.com/v21.0';

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

async function main() {
  // 1. Get FB page token
  const tokenRes = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_tokens?select=*&platform=eq.facebook&limit=1`,
    { headers }
  );
  const [token] = await tokenRes.json();
  if (!token) { console.log('No Facebook token found'); return; }

  const pageToken = token.metadata?.page_access_token || token.access_token;
  console.log(`Using page token for: ${token.platform_channel_name}`);

  // 2. Get all posted FB reels
  const postsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/posts?select=id,title,platform_post_id,brand_id&platform=eq.facebook_reels&status=eq.posted`,
    { headers }
  );
  const posts = await postsRes.json();
  console.log(`Found ${posts.length} posted Facebook Reels\n`);

  let totalViews = 0;
  let successCount = 0;

  for (const post of posts) {
    const videoId = post.platform_post_id;
    console.log(`Fetching: ${post.title} (${videoId})`);

    try {
      const res = await fetch(
        `${FB_API}/${videoId}?fields=id,views,likes.summary(true),comments.summary(true)&access_token=${pageToken}`
      );

      if (!res.ok) {
        const err = await res.json();
        console.log(`  ERROR ${res.status}: ${err.error?.message || 'Unknown'}`);
        continue;
      }

      const data = await res.json();
      const views = data.views ?? 0;
      const likes = data.likes?.summary?.total_count ?? 0;
      const comments = data.comments?.summary?.total_count ?? 0;

      console.log(`  views=${views}, likes=${likes}, comments=${comments}`);
      totalViews += views;

      // 3. Record via RPC (full signature)
      const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_post_metrics`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_post_id: post.id,
          p_platform: 'facebook_reels',
          p_views: views,
          p_likes: likes,
          p_comments: comments,
          p_shares: 0,
          p_saves: 0,
          p_raw_payload: data,
          p_source: 'backfill',
          p_collector_id: 'fb-backfill-script',
          p_error: null,
          p_avg_view_duration: 0,
          p_avg_view_pct: 0,
          p_watch_time_seconds: 0,
          p_subscribers_gained: 0,
          p_subscribers_lost: 0,
        }),
      });

      if (rpcRes.ok) {
        successCount++;
        console.log(`  ✓ recorded`);
      } else {
        const rpcErr = await rpcRes.text();
        console.log(`  ✗ RPC error: ${rpcErr}`);
      }

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.log(`  Network error: ${e.message}`);
    }
  }

  console.log(`\nDone: ${successCount}/${posts.length} posts updated`);
  console.log(`Total views across all FB Reels: ${totalViews}`);

  // 4. Clear the stale error on the token
  const clearRes = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_tokens?id=eq.${token.id}`,
    {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ is_valid: true, last_error: null }),
    }
  );
  console.log(`Token error cleared: ${clearRes.ok ? 'yes' : 'no'}`);
}

main().catch(console.error);
