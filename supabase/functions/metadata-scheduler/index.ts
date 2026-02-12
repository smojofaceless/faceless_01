// =============================================================================
// metadata-scheduler — Cron scheduler that triggers metadata generation
// =============================================================================
// Runs every 2 minutes via pg_cron.
// Finds posts missing metadata → calls generate-post-metadata for each.
// =============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Max posts to process per scheduler run (prevent runaway)
const MAX_BATCH_SIZE = 20;

// Timeout for each metadata generation call (30 seconds)
const GENERATION_TIMEOUT_MS = 30_000;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  const headers = { ...CORS_HEADERS, "Content-Type": "application/json" };
  const startTime = Date.now();

  try {
    // ---- Environment ----
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing Supabase env vars" }),
        { status: 500, headers }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ---- Kill Switch ----
    const { data: killSwitchActive } = await supabase.rpc("is_kill_switch_active");
    if (killSwitchActive) {
      console.log("⛔ Kill switch active — skipping metadata scheduler");
      return new Response(
        JSON.stringify({ success: false, error: "Kill switch active", skipped: true }),
        { status: 503, headers }
      );
    }

    // ---- Global Budget Check ----
    try {
      const { data: budgetOk } = await supabase.rpc("check_global_budget");
      if (budgetOk === false) {
        console.log("💰 Global budget exceeded — skipping metadata scheduler");
        return new Response(
          JSON.stringify({ success: false, error: "Budget exceeded", skipped: true }),
          { status: 429, headers }
        );
      }
    } catch (budgetErr) {
      // Non-fatal — proceed if budget check fails
      console.warn("Budget check failed (proceeding):", budgetErr);
    }

    // ---- Find Posts Needing Metadata ----
    const { data: postsNeedingMetadata, error: findErr } = await supabase.rpc(
      "find_posts_needing_metadata",
      { p_limit: MAX_BATCH_SIZE }
    );

    if (findErr) {
      throw new Error(`find_posts_needing_metadata failed: ${findErr.message}`);
    }

    if (!postsNeedingMetadata || postsNeedingMetadata.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No posts need metadata",
          processed: 0,
          duration_ms: Date.now() - startTime,
        }),
        { status: 200, headers }
      );
    }

    console.log(`📝 Found ${postsNeedingMetadata.length} posts needing metadata`);

    // ---- Process Each Post ----
    const results: Array<{
      post_id: string;
      platform: string;
      status: string;
      error?: string;
    }> = [];

    for (const post of postsNeedingMetadata) {
      try {
        // Call generate-post-metadata Edge Function
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

        const genResponse = await fetch(
          `${supabaseUrl}/functions/v1/generate-post-metadata`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${supabaseServiceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              post_id: post.post_id,
              platform: post.platform,
            }),
            signal: controller.signal,
          }
        );

        clearTimeout(timeout);

        const genResult = await genResponse.json();

        if (genResult.success) {
          const r = genResult.results?.[0];
          results.push({
            post_id: post.post_id,
            platform: post.platform,
            status: r?.status || "unknown",
          });
          console.log(
            `  ✅ ${post.title || post.post_id} (${post.platform}): ${r?.status}`
          );
        } else {
          results.push({
            post_id: post.post_id,
            platform: post.platform,
            status: "failed",
            error: genResult.error,
          });
          console.error(
            `  ❌ ${post.title || post.post_id} (${post.platform}): ${genResult.error}`
          );
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({
          post_id: post.post_id,
          platform: post.platform,
          status: "failed",
          error: errMsg,
        });
        console.error(
          `  ❌ ${post.title || post.post_id} (${post.platform}): ${errMsg}`
        );
      }
    }

    // ---- Summary ----
    const succeeded = results.filter((r) => r.status === "ready").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const durationMs = Date.now() - startTime;

    console.log(
      `📝 Metadata scheduler complete: ${succeeded} ready, ${failed} failed, ${skipped} skipped (${durationMs}ms)`
    );

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        summary: { succeeded, failed, skipped },
        duration_ms: durationMs,
        results,
      }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("metadata-scheduler error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers }
    );
  }
});
