// Direct IG metrics re-collection bypassing cooldown
// Calls Instagram Graph API directly for each post, then records via record_post_metrics RPC
const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDc0NzksImV4cCI6MjA4NTEyMzQ3OX0.5lEiAP6PS4yY3WwAL5v4XWFHWJS5hzBWPXQxuxWe5d4';
const FB_API = 'https://graph.facebook.com/v21.0';
const h = { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY };

async function run() {
    // Get IG token
    const tokenResp = await fetch(
        `${SUPABASE_URL}/rest/v1/platform_tokens?select=access_token&platform=eq.instagram&is_valid=eq.true&limit=1`,
        { headers: h }
    );
    const tokens = await tokenResp.json();
    if (!tokens.length) { console.log('No valid IG token'); return; }
    const accessToken = tokens[0].access_token;
    console.log('✅ Got IG token\n');

    // Get all IG Reel posts
    const postsResp = await fetch(
        `${SUPABASE_URL}/rest/v1/posts?select=id,platform_post_id,posted_at&platform=eq.instagram_reels&status=eq.posted`,
        { headers: h }
    );
    const posts = await postsResp.json();
    console.log(`Found ${posts.length} Instagram Reels posts\n`);

    let success = 0, errors = 0;
    for (const post of posts) {
        try {
            // Fetch media info
            const mediaResp = await fetch(
                `${FB_API}/${post.platform_post_id}?fields=like_count,comments_count,timestamp,media_type,media_product_type&access_token=${accessToken}`
            );
            if (!mediaResp.ok) {
                const errBody = await mediaResp.text();
                console.log(`  ❌ ${post.platform_post_id}: media fetch ${mediaResp.status} - ${errBody.slice(0,120)}`);
                errors++;
                continue;
            }
            const media = await mediaResp.json();

            // Fetch insights with v21.0+ metric names
            let views = 0, saves = 0, shares = 0;
            const insightsResp = await fetch(
                `${FB_API}/${post.platform_post_id}/insights?metric=views,likes,comments,saved,shares,reach&access_token=${accessToken}`
            );
            if (insightsResp.ok) {
                const insightsData = await insightsResp.json();
                if (insightsData.data) {
                    for (const insight of insightsData.data) {
                        const val = insight.values?.[0]?.value || 0;
                        if (insight.name === 'views') views = val;
                        if (insight.name === 'saved') saves = val;
                        if (insight.name === 'shares') shares = val;
                    }
                }
            } else {
                console.log(`  ⚠️  ${post.platform_post_id}: insights ${insightsResp.status} (using media counts only)`);
            }

            const likes = media.like_count || 0;
            const comments = media.comments_count || 0;

            // Record via RPC (this INSERTs a new row, doesn't need DELETE)
            const rpcResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_post_metrics`, {
                method: 'POST',
                headers: { ...h, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    p_post_id: post.id,
                    p_platform: 'instagram_reels',
                    p_views: views,
                    p_likes: likes,
                    p_comments: comments,
                    p_shares: shares,
                    p_saves: saves,
                    p_source: 'backfill',
                    p_collector_id: 'ig_recollect_v21',
                    p_raw_payload: { media, insights_used: 'v21_views_likes_comments_saved_shares_reach' }
                })
            });

            if (rpcResp.ok) {
                console.log(`  ✅ ${post.platform_post_id}: views=${views}, likes=${likes}, comments=${comments}, shares=${shares}, saves=${saves}`);
                success++;
            } else {
                const err = await rpcResp.json();
                console.log(`  ❌ ${post.platform_post_id}: RPC error - ${JSON.stringify(err).slice(0,150)}`);
                errors++;
            }

            // Small delay to avoid rate limits
            await new Promise(r => setTimeout(r, 200));
        } catch (e) {
            console.log(`  ❌ ${post.platform_post_id}: ${e.message}`);
            errors++;
        }
    }

    console.log(`\n🏁 Done: ${success} success, ${errors} errors out of ${posts.length} posts`);

    // Summary: check latest metrics
    const metricsResp = await fetch(
        `${SUPABASE_URL}/rest/v1/post_metrics?select=views,likes,comments,shares,saves&platform=eq.instagram_reels&order=collected_at.desc&limit=${posts.length}`,
        { headers: h }
    );
    const latest = await metricsResp.json();
    const totals = latest.reduce((acc, m) => ({
        views: acc.views + (m.views || 0),
        likes: acc.likes + (m.likes || 0),
        comments: acc.comments + (m.comments || 0),
    }), { views: 0, likes: 0, comments: 0 });
    console.log(`\n📊 Latest IG Reels totals: ${totals.views} views, ${totals.likes} likes, ${totals.comments} comments`);
}

run().catch(e => console.error('FATAL:', e));
