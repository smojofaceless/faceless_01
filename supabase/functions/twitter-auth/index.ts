// =====================================================
// TWITTER AUTH PROXY
// Proxies OAuth 2.0 token exchange for X/Twitter
// (Twitter's token endpoint doesn't support CORS from browsers)
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { code, redirect_uri, code_verifier, action } = await req.json();

    const clientId = Deno.env.get('TWITTER_CLIENT_ID');
    const clientSecret = Deno.env.get('TWITTER_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      return new Response(
        JSON.stringify({ error: 'Twitter credentials not configured on server' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Basic auth header for Twitter
    const basicAuth = btoa(`${clientId}:${clientSecret}`);

    if (action === 'exchange') {
      // Exchange authorization code for tokens
      if (!code || !redirect_uri || !code_verifier) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: code, redirect_uri, code_verifier' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[twitter-auth] Exchanging code for tokens...');

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri,
        client_id: clientId,
        code_verifier,
      });

      const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`,
        },
        body: body.toString(),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error('[twitter-auth] Token exchange failed:', JSON.stringify(tokenData));
        return new Response(
          JSON.stringify({ error: tokenData.error_description || tokenData.error || 'Token exchange failed', details: tokenData }),
          { status: tokenResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[twitter-auth] Token exchange successful');

      // Also fetch user profile
      let user = null;
      try {
        const userResponse = await fetch('https://api.twitter.com/2/users/me', {
          headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
        });
        if (userResponse.ok) {
          const userData = await userResponse.json();
          user = userData.data;
          console.log(`[twitter-auth] User: @${user?.username} (${user?.id})`);
        }
      } catch (e) {
        console.warn('[twitter-auth] Could not fetch user profile:', e);
      }

      return new Response(
        JSON.stringify({ ...tokenData, user }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (action === 'refresh') {
      // Refresh token
      const { refresh_token } = await req.json().catch(() => ({}));
      
      // We already parsed the body above, so get refresh_token from initial parse
      return new Response(
        JSON.stringify({ error: 'Use the post-worker for token refresh' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use "exchange".' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (err) {
    console.error('[twitter-auth] Error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
