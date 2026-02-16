// Recollect Facebook Reels metrics using video_insights + direct fields
// Uses fb_reels_total_plays (matches FB UI play count) + likes/comments from fields
const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDc0NzksImV4cCI6MjA4NTEyMzQ3OX0.5lEiAP6PS4yY3WwAL5v4XWFHWJS5hzBWPXQxuxWe5d4';
const FB_API = 'https://graph.facebook.com/v21.0';

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

async function main() {
  // 1. Get FB page token from DB
  const tokenRes = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_tokens?select=*&platform=eq.facebook&limit=1`,
    { headers: sbHeaders }
  );
  const [token] = await tokenRes.json();
  if (!token) { console.log('No Facebook token found'); return; }

  const pageToken = token.metadata?.page_access_token || token.access_token;
  console.log(`Using page token for: ${token.platform_channel_name}\n`);

  // 2. Get all posted FB reels
  const postsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/posts?select=id,title,platform_post_id,brand_id&platform=eq.facebook_reels&status=eq.posted`,
    { headers: sbHeaders }
  );
  const posts = await postsRes.json();
  console.log(`Found ${posts.length} posted Facebook Reels\n`);

  let totalPlays = 0;
  let successCount = 0;

  for (const post of posts) {
    const videoId = post.platform_post_id;
    process.stdout.write(`${post.title} (${videoId})... `);

    try {
      // Fetch video_insights for play count
      const insightsRes = await fetch(
        `${FB_API}/${videoId}/video_insights?metric=fb_reels_total_plays,fb_reels_replay_count,blue_reels_play_count&access_token=${pageToken}`
      );

      let plays = 0;
      let insightsRaw = null;
      if (insightsRes.ok) {
        const insightsData = await insightsRes.json();
        insightsRaw = insightsData;
        for (const ins of insightsData.data || []) {
          if (ins.name === 'fb_reels_total_plays') {
            plays = ins.values?.[0]?.value ?? 0;
          }
        }
      }

      // Fetch direct fields for likes/comments
      const fieldsRes = await fetch(
        `${FB_API}/${videoId}?fields=id,views,likes.summary(true),comments.summary(true)&access_token=${pageToken}`
      );

      if (!fieldsRes.ok) {
        console.log(`ERROR ${fieldsRes.status}`);
        continue;
      }

      const fieldsData = await fieldsRes.json();
      const views = plays > 0 ? plays : (fieldsData.views ?? 0);
      const likes = fieldsData.likes?.summary?.total_count ?? 0;
      const comments = fieldsData.comments?.summary?.total_count ?? 0;

      console.log(`plays=${plays}, views=${fieldsData.views ?? 0}, likes=${likes}, comments=${comments}`);
      totalPlays += views;

      // Record via RPC
      const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_post_metrics`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          p_post_id: post.id,
          p_platform: 'facebook_reels',
          p_views: views,
          p_likes: likes,
          p_comments: comments,
          p_shares: 0,
          p_saves: 0,
          p_raw_payload: { insights: insightsRaw, fields: fieldsData },
          p_source: 'backfill',
          p_collector_id: 'fb-backfill-insights',
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
      } else {
        const err = await rpcRes.text();
        console.log(`  RPC error: ${err}`);
      }

      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.log(`Network error: ${e.message}`);
    }
  }

  console.log(`\nDone: ${successCount}/${posts.length} posts updated`);
  console.log(`Total plays across all FB Reels: ${totalPlays}`);
}

main().catch(console.error);
