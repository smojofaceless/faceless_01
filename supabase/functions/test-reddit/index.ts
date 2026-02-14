/**
 * TEST ENDPOINT: Reddit OAuth Fetch Verification
 * Tests if Reddit OAuth API is accessible from Supabase Edge Functions.
 * Requires REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET env vars.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const clientId = Deno.env.get('REDDIT_CLIENT_ID');
  const clientSecret = Deno.env.get('REDDIT_CLIENT_SECRET');
  
  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ 
      error: 'Missing REDDIT_CLIENT_ID or REDDIT_CLIENT_SECRET env vars',
      has_client_id: !!clientId,
      has_client_secret: !!clientSecret,
    }, null, 2), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any = { oauth: {}, subreddits: [] };
  
  // Step 1: Get OAuth token
  try {
    const authString = btoa(`${clientId}:${clientSecret}`);
    const tokenResp = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'StoryEngine/1.0 (by /u/StoryEngineBot)',
      },
      body: 'grant_type=client_credentials',
    });
    
    results.oauth.status = tokenResp.status;
    if (!tokenResp.ok) {
      results.oauth.error = await tokenResp.text().catch(() => '');
      return new Response(JSON.stringify(results, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    const tokenData = await tokenResp.json();
    results.oauth.has_token = !!tokenData.access_token;
    results.oauth.expires_in = tokenData.expires_in;
    results.oauth.token_type = tokenData.token_type;
    
    if (!tokenData.access_token) {
      results.oauth.error = 'No access_token in response';
      return new Response(JSON.stringify(results, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    // Step 2: Test fetching from subreddits with OAuth
    const subreddits = ['nosleep', 'shortscarystories'];
    for (const sub of subreddits) {
      const url = `https://oauth.reddit.com/r/${sub}/hot?limit=3&raw_json=1`;
      const entry: any = { subreddit: sub, url, status: null, error: null, postCount: 0, firstTitle: null };
      
      try {
        const resp = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'User-Agent': 'StoryEngine/1.0 (by /u/StoryEngineBot)',
          },
        });
        
        entry.status = resp.status;
        if (resp.ok) {
          const json = await resp.json();
          const posts = json?.data?.children || [];
          entry.postCount = posts.length;
          if (posts.length > 0) {
            entry.firstTitle = posts[0].data?.title?.substring(0, 100);
            entry.firstUpvotes = posts[0].data?.ups;
            entry.isSelf = posts[0].data?.is_self;
            entry.textLength = posts[0].data?.selftext?.length || 0;
          }
        } else {
          entry.error = (await resp.text().catch(() => '')).substring(0, 300);
        }
      } catch (e) {
        entry.error = e instanceof Error ? e.message : String(e);
      }
      
      results.subreddits.push(entry);
    }
  } catch (e) {
    results.oauth.error = e instanceof Error ? e.message : String(e);
  }
  
  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
