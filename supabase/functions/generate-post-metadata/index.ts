// =============================================================================
// generate-post-metadata — AI-generates platform-specific metadata for a post
// =============================================================================
// Input:  { post_id: UUID, platform?: string, force?: boolean }
// Output: { success, results: [{ post_id, platform, status, metadata }] }
// =============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Platform prompt configurations
// ---------------------------------------------------------------------------

interface PlatformPromptConfig {
  platform: string;
  systemSuffix: string;
  outputSchema: Record<string, string>;
  example: Record<string, unknown>;
  guidance: string;
}

const PLATFORM_CONFIGS: Record<string, PlatformPromptConfig> = {
  youtube_shorts: {
    platform: "YouTube Shorts",
    systemSuffix: "Optimize for YouTube search discovery and click-through rate.",
    outputSchema: {
      title: "string — max 100 chars. Hook in first 3 words. Include 1-2 keywords.",
      description: "string — max 500 chars for Shorts. Tease the story without spoiling. End with a CTA (Subscribe, Like).",
      tags: "string[] — 8-15 tags, mix broad ('horror','scary') + niche ('counting horror'). No # prefix. Max 500 chars total.",
      category_id: "integer — 24 (Entertainment) or 1 (Film & Animation)",
      made_for_kids: "boolean — always false for horror content",
    },
    example: {
      title: "They Counted 6 People. There Were 7. 😨",
      description: "Six strangers shelter in a convenience store during a storm. But every headcount comes back as seven. Who is the extra person?\n\n🔔 Subscribe for more horror stories.",
      tags: ["horror", "scary", "shorts", "counting horror", "creepy story", "horror shorts", "one too many", "mystery"],
      category_id: 24,
      made_for_kids: false,
    },
    guidance: `
- Title MUST hook in first 3 words — use numbers, questions, or shock
- Title length: 40-80 chars ideal (max 100)
- Description: tease mystery, NO full spoilers, end with subscribe CTA
- Tags: first 3-4 should be high-volume ("horror", "scary", "shorts"), rest niche
- NEVER include slurs, explicit gore descriptions, or self-harm references
`,
  },

  tiktok: {
    platform: "TikTok",
    systemSuffix: "Optimize for TikTok's For You Page algorithm and viral potential.",
    outputSchema: {
      caption: "string — max 150 chars (excluding hashtags). Short punchy hook. Hashtags appended at end.",
      hashtags: "string[] — 5-8 hashtags. Mix trending + niche. No # prefix in array.",
      cover_text: "string — max 40 chars. Attention-grabbing overlay text for video thumbnail.",
    },
    example: {
      caption: "They counted six people. There were seven. 😰",
      hashtags: ["horror", "creepy", "countinghorror", "scarystory", "storytime", "fyp", "horrortok"],
      cover_text: "There Were Seven",
    },
    guidance: `
- Caption: ultra-short hook, emoji OK, curiosity gap
- Hashtags: include 1-2 trending general ones (fyp, storytime) + 3-5 niche
- Cover text: 2-6 words that make people stop scrolling, ALL CAPS OK for 1-2 words max
- NEVER include slurs, explicit gore, or self-harm references
`,
  },

  instagram_reels: {
    platform: "Instagram Reels",
    systemSuffix: "Optimize for Instagram's Explore page and Reels tab.",
    outputSchema: {
      caption: "string — max 300 chars. Story-style with line breaks for readability. Hashtags go at the very end after a line break.",
      hashtags: "string[] — 10-15 hashtags. Curated mix of community + discovery tags. No # prefix in array.",
      alt_text: "string — max 125 chars. Accessibility description of the video content/thumbnail.",
    },
    example: {
      caption: "Six strangers. One store. Seven headcounts.\n\nThey counted again. And again.\nThe number never changed.\n\nWho is the seventh?",
      hashtags: ["horror", "creepy", "countinghorror", "scarystory", "paranormal", "horrorreels", "creepystory", "spooky", "mysterystory", "darktok", "horrorstory", "scaryshorts"],
      alt_text: "Dark convenience store interior with shadowy figures during a storm",
    },
    guidance: `
- Caption: narrative/poetic style, use line breaks for rhythm, build suspense
- Hashtags: SEPARATE from caption body, 10-15 is optimal
- Alt text: describe the visual scene for accessibility, be specific about mood/setting
- NEVER include slurs, explicit gore, or self-harm references
`,
  },
};

// ---------------------------------------------------------------------------
// System prompt (shared across platforms)
// ---------------------------------------------------------------------------

function buildSystemPrompt(platformConfig: PlatformPromptConfig): string {
  return `You are a social media metadata specialist for short-form horror and mystery video content.

Your job: Generate platform-optimized metadata that maximizes discoverability, engagement, and click-through rate for ${platformConfig.platform}.

${platformConfig.systemSuffix}

Rules:
1. Output ONLY valid JSON matching the exact schema — no markdown fences, no explanation.
2. Every string field must respect its character limit STRICTLY.
3. Content must be safe for the platform: no slurs, no explicit gore descriptions, no self-harm references, no content targeting minors.
4. Titles/captions should create curiosity gaps — tease the mystery without spoiling it.
5. Tags/hashtags should mix high-volume discovery terms with niche community terms.
6. Match the tone of the video's vibe/genre (horror → eerie, suspenseful, unsettling — NOT comedic).`;
}

// ---------------------------------------------------------------------------
// User prompt (per post)
// ---------------------------------------------------------------------------

function buildUserPrompt(
  platformConfig: PlatformPromptConfig,
  data: {
    title: string;
    storyText: string;
    vibePreset: string;
    brandName?: string;
    brandVoice?: string;
  }
): string {
  // Truncate story to first 600 chars for context (avoid token waste)
  const storySummary = data.storyText?.substring(0, 600) || "No story available.";

  const schemaBlock = Object.entries(platformConfig.outputSchema)
    .map(([key, desc]) => `  "${key}": ${desc}`)
    .join("\n");

  const exampleBlock = JSON.stringify(platformConfig.example, null, 2);

  return `Generate ${platformConfig.platform} metadata for this horror short video.

VIDEO TITLE: ${data.title || "Untitled"}
VIBE/GENRE: ${data.vibePreset || "horror"}
${data.brandName ? `BRAND: ${data.brandName}` : ""}
${data.brandVoice ? `BRAND VOICE: ${data.brandVoice}` : ""}

STORY SUMMARY:
"${storySummary}"

OUTPUT JSON SCHEMA:
{
${schemaBlock}
}

EXAMPLE OUTPUT:
${exampleBlock}

PLATFORM-SPECIFIC GUIDANCE:
${platformConfig.guidance}

Generate the metadata JSON now. Output ONLY the JSON object.`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidationResult {
  valid: boolean;
  errors: string[];
  cleaned: Record<string, unknown>;
}

function validateMetadata(
  metadata: Record<string, unknown>,
  platform: string
): ValidationResult {
  const errors: string[] = [];
  const cleaned = { ...metadata };

  if (platform === "youtube_shorts") {
    // Title
    if (typeof cleaned.title === "string") {
      if (cleaned.title.length > 100) {
        cleaned.title = (cleaned.title as string).substring(0, 97) + "...";
        errors.push("Title truncated to 100 chars");
      }
    } else {
      errors.push("Missing title");
    }
    // Description
    if (typeof cleaned.description === "string" && (cleaned.description as string).length > 5000) {
      cleaned.description = (cleaned.description as string).substring(0, 4997) + "...";
    }
    // Tags
    if (Array.isArray(cleaned.tags)) {
      cleaned.tags = (cleaned.tags as string[]).slice(0, 30);
      const totalChars = (cleaned.tags as string[]).join(",").length;
      if (totalChars > 500) {
        // Trim tags until under 500 chars
        while ((cleaned.tags as string[]).join(",").length > 500 && (cleaned.tags as string[]).length > 1) {
          (cleaned.tags as string[]).pop();
        }
        errors.push("Tags trimmed to fit 500 char limit");
      }
    }
    // made_for_kids — force false for horror
    cleaned.made_for_kids = false;
    // category_id default
    if (!cleaned.category_id) cleaned.category_id = 24;
  }

  if (platform === "tiktok") {
    // Caption
    if (typeof cleaned.caption === "string" && (cleaned.caption as string).length > 2200) {
      cleaned.caption = (cleaned.caption as string).substring(0, 2197) + "...";
    }
    // Hashtags
    if (Array.isArray(cleaned.hashtags)) {
      cleaned.hashtags = (cleaned.hashtags as string[]).slice(0, 8);
    }
    // Cover text
    if (typeof cleaned.cover_text === "string" && (cleaned.cover_text as string).length > 40) {
      cleaned.cover_text = (cleaned.cover_text as string).substring(0, 37) + "...";
    }
  }

  if (platform === "instagram_reels") {
    // Caption
    if (typeof cleaned.caption === "string" && (cleaned.caption as string).length > 2200) {
      cleaned.caption = (cleaned.caption as string).substring(0, 2197) + "...";
    }
    // Hashtags
    if (Array.isArray(cleaned.hashtags)) {
      cleaned.hashtags = (cleaned.hashtags as string[]).slice(0, 30);
    }
    // Alt text
    if (typeof cleaned.alt_text === "string" && (cleaned.alt_text as string).length > 125) {
      cleaned.alt_text = (cleaned.alt_text as string).substring(0, 122) + "...";
    }
  }

  return { valid: errors.length === 0, errors, cleaned };
}

// ---------------------------------------------------------------------------
// OpenAI call
// ---------------------------------------------------------------------------

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  openaiKey: string
): Promise<Record<string, unknown>> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.8,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");

  return JSON.parse(content);
}

// ---------------------------------------------------------------------------
// Generate metadata for a single post + platform
// ---------------------------------------------------------------------------

interface GenerationResult {
  post_id: string;
  platform: string;
  status: "ready" | "failed" | "skipped";
  metadata?: Record<string, unknown>;
  error?: string;
}

async function generateForPost(
  supabase: SupabaseClient,
  postId: string,
  platform: string,
  force: boolean,
  openaiKey: string
): Promise<GenerationResult> {
  const result: GenerationResult = { post_id: postId, platform, status: "ready" };

  try {
    // 1. Check if already generated (unless force)
    if (!force) {
      const { data: existing } = await supabase
        .from("post_metadata")
        .select("status")
        .eq("post_id", postId)
        .eq("platform", platform)
        .single();

      if (existing && ["ready", "edited"].includes(existing.status)) {
        return { ...result, status: "skipped" };
      }
    }

    // 2. Claim for generation (atomic)
    const { data: claimed } = await supabase.rpc("claim_metadata_generation", {
      p_post_id: postId,
      p_platform: platform,
    });

    if (!claimed) {
      return { ...result, status: "skipped", error: "Already being generated" };
    }

    // 3. Fetch post data
    const { data: post, error: postErr } = await supabase
      .from("posts")
      .select("id, job_id, platform, brand_id, title")
      .eq("id", postId)
      .single();

    if (postErr || !post) {
      throw new Error(`Post not found: ${postErr?.message || "null"}`);
    }

    // 4. Fetch job data (story text, vibe preset)
    let storyText = "";
    let vibePreset = "horror";
    let jobTitle = post.title || "Untitled";

    if (post.job_id) {
      const { data: job } = await supabase
        .from("jobs")
        .select("title, story_text, vibe_preset")
        .eq("id", post.job_id)
        .single();

      if (job) {
        storyText = job.story_text || "";
        vibePreset = job.vibe_preset || "horror";
        jobTitle = job.title || jobTitle;
      }
    }

    // 5. Fetch brand config (optional — for brand voice)
    let brandName: string | undefined;
    let brandVoice: string | undefined;

    if (post.brand_id) {
      const { data: brand } = await supabase
        .from("brands")
        .select("name, config")
        .eq("id", post.brand_id)
        .single();

      if (brand) {
        brandName = brand.name;
        brandVoice = brand.config?.voice_description || brand.config?.tone;
      }
    }

    // 6. Get platform config
    const platformConfig = PLATFORM_CONFIGS[platform];
    if (!platformConfig) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    // 7. Build prompts
    const systemPrompt = buildSystemPrompt(platformConfig);
    const userPrompt = buildUserPrompt(platformConfig, {
      title: jobTitle,
      storyText,
      vibePreset,
      brandName,
      brandVoice,
    });

    // 8. Call OpenAI
    const rawMetadata = await callOpenAI(systemPrompt, userPrompt, openaiKey);

    // 9. Validate and clean
    const validation = validateMetadata(rawMetadata, platform);
    if (validation.errors.length > 0) {
      console.warn(`Validation warnings for ${postId}/${platform}:`, validation.errors);
    }

    // 10. Store via RPC (idempotent)
    const idempotencyKey = `${postId}:metadata:${platform}:v1`;
    const { data: metaId, error: upsertErr } = await supabase.rpc("upsert_post_metadata", {
      p_post_id: postId,
      p_platform: platform,
      p_ai_metadata: validation.cleaned,
      p_model: "gpt-4o",
      p_idempotency_key: idempotencyKey,
    });

    if (upsertErr) {
      throw new Error(`Upsert failed: ${upsertErr.message}`);
    }

    // 11. Record cost usage (openai_text)
    try {
      await supabase.rpc("record_api_usage", {
        p_service: "openai_text",
        p_idempotency_key: `${postId}:metadata:${platform}`,
        p_job_id: post.job_id,
        p_brand_id: post.brand_id,
        p_units: 1,
        p_estimated_cost: 0.01, // ~1k tokens in + 500 out ≈ $0.01
        p_meta: { step: "metadata", platform, model: "gpt-4o" },
      });
    } catch (costErr) {
      console.warn("Cost recording failed (non-fatal):", costErr);
    }

    return { ...result, status: "ready", metadata: validation.cleaned };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Metadata generation failed for ${postId}/${platform}:`, errorMsg);

    // Mark as failed
    try {
      await supabase.rpc("mark_metadata_failed", {
        p_post_id: postId,
        p_platform: platform,
        p_error: errorMsg.substring(0, 500),
      });
    } catch (_) {
      // Best-effort
    }

    return { ...result, status: "failed", error: errorMsg };
  }
}

// ---------------------------------------------------------------------------
// HTTP Handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  const headers = { ...CORS_HEADERS, "Content-Type": "application/json" };

  try {
    // Validate env
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing Supabase env vars" }),
        { status: 500, headers }
      );
    }
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing OPENAI_API_KEY" }),
        { status: 500, headers }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request
    const body = await req.json().catch(() => ({}));
    const { post_id, platform, force = false } = body as {
      post_id?: string;
      platform?: string;
      force?: boolean;
    };

    if (!post_id) {
      return new Response(
        JSON.stringify({ success: false, error: "post_id is required" }),
        { status: 400, headers }
      );
    }

    // Determine platforms to generate for
    let platforms: string[] = [];
    if (platform) {
      platforms = [platform];
    } else {
      // Get platform from the post itself
      const { data: post } = await supabase
        .from("posts")
        .select("platform")
        .eq("id", post_id)
        .single();

      if (post?.platform) {
        platforms = [post.platform];
      } else {
        // Default all configured platforms
        platforms = Object.keys(PLATFORM_CONFIGS);
      }
    }

    // Generate for each platform
    const results: GenerationResult[] = [];
    for (const p of platforms) {
      const result = await generateForPost(supabase, post_id, p, force, openaiKey);
      results.push(result);
    }

    const succeeded = results.filter((r) => r.status === "ready").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    return new Response(
      JSON.stringify({
        success: true,
        post_id,
        summary: { succeeded, failed, skipped },
        results,
      }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("generate-post-metadata error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers }
    );
  }
});
