// =============================================================================
// generate-post-metadata — AI-generates platform-specific metadata for a post
// =============================================================================
// v2.0 — Production version with:
//   - Kill switch check
//   - Cost control lifecycle (check_budget → acquire_slot → API → record → release)
//   - Error classification (transient/dependency/misconfig/permanent)
//   - Backoff-aware failure marking
//   - Dynamic platform constraint validation
//   - Idempotency protection
//   - Lease-safe claim pattern
//
// Input:  { post_id: UUID, platform?: string, force?: boolean }
// Output: { success, results: [{ post_id, platform, status, metadata }] }
// =============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

const VERSION = "2.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Platform prompt configurations (unchanged — battle-tested)
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
    systemSuffix:
      "Optimize for YouTube search discovery and click-through rate.",
    outputSchema: {
      title:
        "string — max 100 chars. Hook in first 3 words. Include 1-2 keywords.",
      description:
        "string — max 500 chars for Shorts. Tease the story without spoiling. End with a CTA (Subscribe, Like).",
      tags: "string[] — 8-15 tags, mix broad ('horror','scary') + niche ('counting horror'). No # prefix. Max 500 chars total.",
      category_id: "integer — 24 (Entertainment) or 1 (Film & Animation)",
      made_for_kids: "boolean — always false for horror content",
    },
    example: {
      title: "They Counted 6 People. There Were 7. 😨",
      description:
        "Six strangers shelter in a convenience store during a storm. But every headcount comes back as seven. Who is the extra person?\n\n🔔 Subscribe for more horror stories.",
      tags: [
        "horror",
        "scary",
        "shorts",
        "counting horror",
        "creepy story",
        "horror shorts",
        "one too many",
        "mystery",
      ],
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
    systemSuffix:
      "Optimize for TikTok's For You Page algorithm and viral potential.",
    outputSchema: {
      caption:
        "string — max 150 chars (excluding hashtags). Short punchy hook. Hashtags appended at end.",
      hashtags:
        "string[] — 5-8 hashtags. Mix trending + niche. No # prefix in array.",
      cover_text:
        "string — max 40 chars. Attention-grabbing overlay text for video thumbnail.",
    },
    example: {
      caption: "They counted six people. There were seven. 😰",
      hashtags: [
        "horror",
        "creepy",
        "countinghorror",
        "scarystory",
        "storytime",
        "fyp",
        "horrortok",
      ],
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
      caption:
        "string — max 300 chars. Story-style with line breaks for readability. Hashtags go at the very end after a line break.",
      hashtags:
        "string[] — 10-15 hashtags. Curated mix of community + discovery tags. No # prefix in array.",
      alt_text:
        "string — max 125 chars. Accessibility description of the video content/thumbnail.",
    },
    example: {
      caption:
        "Six strangers. One store. Seven headcounts.\n\nThey counted again. And again.\nThe number never changed.\n\nWho is the seventh?",
      hashtags: [
        "horror",
        "creepy",
        "countinghorror",
        "scarystory",
        "paranormal",
        "horrorreels",
        "creepystory",
        "spooky",
        "mysterystory",
        "darktok",
        "horrorstory",
        "scaryshorts",
      ],
      alt_text:
        "Dark convenience store interior with shadowy figures during a storm",
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
// Error Classification (inline — mirrors worker-v1/classifyError.ts patterns)
// ---------------------------------------------------------------------------

type FailureClass = "transient" | "dependency" | "misconfig" | "permanent";

function classifyMetadataError(err: unknown): {
  class: FailureClass;
  message: string;
} {
  const message =
    err instanceof Error ? err.message : String(err || "Unknown error");

  // Cost limit exceeded → misconfig (operator must raise limits)
  if (/cost_limit_exceeded|budget.*reached|budget.*exceeded/i.test(message)) {
    return { class: "misconfig", message };
  }

  // Missing API keys → misconfig
  if (
    /missing.*key|api.?key|credentials|unauthorized|forbidden|not.*configured/i.test(
      message
    )
  ) {
    return { class: "misconfig", message };
  }
  if (/env.*missing|env.*not.*set|OPENAI_API_KEY/i.test(message)) {
    return { class: "misconfig", message };
  }

  // Auth failures → misconfig
  if (/\b(401|403)\b/.test(message)) {
    return { class: "misconfig", message };
  }

  // OpenAI 5xx → dependency
  if (/openai.*5\d{2}|5\d{2}.*openai/i.test(message)) {
    return { class: "dependency", message };
  }
  if (/openai.*unavailable|openai.*down/i.test(message)) {
    return { class: "dependency", message };
  }

  // Rate limits → transient
  if (/429|rate.?limit|too many requests|quota exceeded/i.test(message)) {
    return { class: "transient", message };
  }

  // Network issues → transient
  if (
    /ECONNRESET|ETIMEDOUT|ENOTFOUND|timeout|timed out|network|socket/i.test(
      message
    )
  ) {
    return { class: "transient", message };
  }

  // Gateway errors → transient
  if (/\b(502|503|504)\b/.test(message)) {
    return { class: "transient", message };
  }

  // Content policy → permanent
  if (/content.*policy|safety.*system|moderation/i.test(message)) {
    return { class: "permanent", message };
  }

  // Bad request / validation → permanent
  if (/\b400\b|invalid.*request|validation.*fail/i.test(message)) {
    return { class: "permanent", message };
  }

  // JSON parse errors → permanent (prompt issue)
  if (/invalid.*json|parse.*error|syntax.*error/i.test(message)) {
    return { class: "permanent", message };
  }

  // Post not found → permanent
  if (/post.*not.*found|not.*found/i.test(message)) {
    return { class: "permanent", message };
  }

  // Default: transient (safe for retry)
  return { class: "transient", message };
}

// ---------------------------------------------------------------------------
// Cost Control Helpers (lightweight — follows CostControlHelper patterns)
// ---------------------------------------------------------------------------

interface CostCheck {
  allowed: boolean;
  reason?: string;
}

async function checkBudget(
  supabase: SupabaseClient,
  jobId: string | null
): Promise<CostCheck> {
  try {
    const { data, error } = await supabase.rpc("check_budget", {
      p_service: "openai_text",
      p_job_id: jobId,
      p_units_needed: 1,
    });
    if (error) {
      console.warn("[METADATA] Budget check RPC failed:", error.message);
      return { allowed: true }; // Fail open — don't block on budget check errors
    }
    if (data && !data.can_proceed) {
      return {
        allowed: false,
        reason:
          data.checks_failed?.[0]?.message ||
          "Budget limit reached for openai_text",
      };
    }
    return { allowed: true };
  } catch (e) {
    console.warn("[METADATA] Budget check exception:", e);
    return { allowed: true }; // Fail open
  }
}

async function acquireSlot(
  supabase: SupabaseClient,
  jobId: string | null,
  workerId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("acquire_api_slot", {
      p_service: "openai_text",
      p_job_id: jobId,
      p_worker_id: workerId,
      p_operation: "metadata",
      p_lease_seconds: 120,
    });
    if (error) {
      console.warn("[METADATA] Slot acquisition failed:", error.message);
      return true; // Fail open
    }
    return data?.acquired !== false;
  } catch {
    return true; // Fail open
  }
}

async function releaseSlot(
  supabase: SupabaseClient,
  jobId: string | null,
  workerId: string
): Promise<void> {
  try {
    await supabase.rpc("release_api_slot", {
      p_slot_id: null,
      p_service: "openai_text",
      p_job_id: jobId,
      p_worker_id: workerId,
      p_operation: "metadata",
    });
  } catch {
    // Best-effort release
  }
}

async function recordCost(
  supabase: SupabaseClient,
  postId: string,
  platform: string,
  jobId: string | null,
  brandId: string | null,
  tokensInput: number,
  tokensOutput: number
): Promise<void> {
  try {
    await supabase.rpc("record_api_usage", {
      p_service: "openai_text",
      p_idempotency_key: `${postId}:metadata:${platform}`,
      p_job_id: jobId,
      p_brand_id: brandId,
      p_step_name: "metadata",
      p_operation: "metadata",
      p_units: 1,
      p_tokens_input: tokensInput,
      p_tokens_output: tokensOutput,
      p_estimated_cost_cents: Math.ceil(
        (tokensInput * 0.25 + tokensOutput * 1.0) / 100
      ),
      p_model: "gpt-4o",
    });
  } catch (e) {
    console.warn("[METADATA] Cost recording failed (non-fatal):", e);
  }
}

// ---------------------------------------------------------------------------
// Prompts
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
  const storySummary =
    data.storyText?.substring(0, 600) || "No story available.";
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
// Validation — fetches constraints from DB with hardcoded fallback
// ---------------------------------------------------------------------------

interface PlatformConstraints {
  [field: string]: {
    type: string;
    max_length?: number;
    max_items?: number;
    max_total_chars?: number;
    required?: boolean;
    format?: string;
    default_value?: unknown;
  };
}

const FALLBACK_CONSTRAINTS: Record<string, PlatformConstraints> = {
  youtube_shorts: {
    title: { type: "string", max_length: 100, required: true },
    description: { type: "string", max_length: 5000 },
    tags: { type: "array", max_items: 30, max_total_chars: 500 },
    category_id: { type: "integer", default_value: 24 },
    made_for_kids: { type: "boolean", default_value: false },
  },
  tiktok: {
    caption: { type: "string", max_length: 2200, required: true },
    hashtags: { type: "array", max_items: 8 },
    cover_text: { type: "string", max_length: 40 },
  },
  instagram_reels: {
    caption: { type: "string", max_length: 2200, required: true },
    hashtags: { type: "array", max_items: 30 },
    alt_text: { type: "string", max_length: 125 },
  },
};

// Current hardcoded constraints version. Bump when FALLBACK_CONSTRAINTS change.
const FALLBACK_CONSTRAINTS_VERSION = 1;

interface ConstraintsResult {
  constraints: PlatformConstraints;
  version: number;
}

async function fetchConstraints(
  supabase: SupabaseClient,
  platform: string
): Promise<ConstraintsResult> {
  try {
    const { data, error } = await supabase
      .from("platform_field_constraints")
      .select("fields, version")
      .eq("platform", platform)
      .single();
    if (!error && data?.fields) {
      return {
        constraints: data.fields as PlatformConstraints,
        version: (data.version as number) || FALLBACK_CONSTRAINTS_VERSION,
      };
    }
  } catch {
    // Fall through to hardcoded
  }
  return {
    constraints: FALLBACK_CONSTRAINTS[platform] || {},
    version: FALLBACK_CONSTRAINTS_VERSION,
  };
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  cleaned: Record<string, unknown>;
}

function validateMetadata(
  metadata: Record<string, unknown>,
  constraints: PlatformConstraints
): ValidationResult {
  const errors: string[] = [];
  const cleaned = { ...metadata };

  for (const [field, rule] of Object.entries(constraints)) {
    const value = cleaned[field];

    // Required check
    if (
      rule.required &&
      (value === undefined || value === null || value === "")
    ) {
      errors.push(`Missing required field: ${field}`);
      continue;
    }

    if (value === undefined || value === null) continue;

    // String validation
    if (rule.type === "string" && typeof value === "string") {
      if (rule.max_length && value.length > rule.max_length) {
        cleaned[field] = value.substring(0, rule.max_length - 3) + "...";
        errors.push(`${field} truncated to ${rule.max_length} chars`);
      }
    }

    // Array validation
    if (rule.type === "array" && Array.isArray(value)) {
      if (rule.max_items && value.length > rule.max_items) {
        cleaned[field] = value.slice(0, rule.max_items);
        errors.push(`${field} trimmed to ${rule.max_items} items`);
      }
      if (rule.max_total_chars) {
        let arr = cleaned[field] as string[];
        while (arr.join(",").length > rule.max_total_chars && arr.length > 1) {
          arr = arr.slice(0, -1);
        }
        cleaned[field] = arr;
      }
      // Strip # prefixes from hashtags
      if (field === "hashtags" || field === "tags") {
        cleaned[field] = (cleaned[field] as string[]).map((t: string) =>
          t.replace(/^#/, "")
        );
      }
    }

    // Boolean defaults
    if (rule.type === "boolean" && rule.default_value !== undefined) {
      cleaned[field] = rule.default_value;
    }

    // Integer defaults
    if (rule.type === "integer" && !value && rule.default_value !== undefined) {
      cleaned[field] = rule.default_value;
    }
  }

  return {
    valid: errors.filter((e) => e.startsWith("Missing")).length === 0,
    errors,
    cleaned,
  };
}

// ---------------------------------------------------------------------------
// OpenAI call
// ---------------------------------------------------------------------------

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  openaiKey: string
): Promise<{ metadata: Record<string, unknown>; usage: OpenAIUsage }> {
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
    throw new Error(
      `OpenAI API error ${response.status}: ${errText.slice(0, 300)}`
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");

  const usage: OpenAIUsage = data.usage || {
    prompt_tokens: 0,
    completion_tokens: 0,
  };

  return { metadata: JSON.parse(content), usage };
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
  failure_class?: FailureClass;
}

async function generateForPost(
  supabase: SupabaseClient,
  postId: string,
  platform: string,
  force: boolean,
  openaiKey: string,
  workerId: string,
  generatedBy: string = 'scheduler'
): Promise<GenerationResult> {
  const result: GenerationResult = {
    post_id: postId,
    platform,
    status: "ready",
  };

  let slotAcquired = false;
  let jobId: string | null = null;
  let brandId: string | null = null;

  try {
    // 1. Skip check (unless force)
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

    // 2. Atomic claim (prevents double-generation)
    const { data: claimed } = await supabase.rpc(
      "claim_metadata_generation",
      { p_post_id: postId, p_platform: platform }
    );

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

    jobId = post.job_id;
    brandId = post.brand_id;

    // 4. Cost control pre-check
    const budgetCheck = await checkBudget(supabase, jobId);
    if (!budgetCheck.allowed) {
      throw new Error(`cost_limit_exceeded: ${budgetCheck.reason}`);
    }

    // 5. Acquire concurrency slot
    slotAcquired = await acquireSlot(supabase, jobId, workerId);

    // 6. Fetch job data (story text, vibe)
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

    // 7. Fetch brand config
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
        brandVoice =
          (brand.config as Record<string, string>)?.voice_description ||
          (brand.config as Record<string, string>)?.tone;
      }
    }

    // 8. Platform config
    const platformConfig = PLATFORM_CONFIGS[platform];
    if (!platformConfig) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    // 9. Build prompts
    const systemPrompt = buildSystemPrompt(platformConfig);
    const userPrompt = buildUserPrompt(platformConfig, {
      title: jobTitle,
      storyText,
      vibePreset,
      brandName,
      brandVoice,
    });

    // 10. Call OpenAI (the expensive part — budget/slot checked above)
    const { metadata: rawMetadata, usage } = await callOpenAI(
      systemPrompt,
      userPrompt,
      openaiKey
    );

    // 11. Fetch constraints from DB and validate
    const { constraints, version: constraintsVersion } = await fetchConstraints(supabase, platform);
    const validation = validateMetadata(rawMetadata, constraints);
    if (validation.errors.length > 0) {
      console.warn(
        `[METADATA] Validation notes for ${postId}/${platform}:`,
        validation.errors
      );
    }

    if (!validation.valid) {
      throw new Error(
        `Validation failed: ${validation.errors
          .filter((e) => e.startsWith("Missing"))
          .join(", ")}`
      );
    }

    // 12. Store via RPC (idempotent upsert)
    const idempotencyKey = `${postId}:metadata:${platform}:v1`;
    const { error: upsertErr } = await supabase.rpc("upsert_post_metadata", {
      p_post_id: postId,
      p_platform: platform,
      p_ai_metadata: validation.cleaned,
      p_model: "gpt-4o",
      p_idempotency_key: idempotencyKey,
      p_generated_by: generatedBy,
      p_worker_id: workerId,
      p_schema_version: 1,
      p_constraints_version: constraintsVersion,
    });

    if (upsertErr) {
      throw new Error(`Upsert failed: ${upsertErr.message}`);
    }

    // 13. Record cost (after success — idempotent via key)
    await recordCost(
      supabase,
      postId,
      platform,
      jobId,
      brandId,
      usage.prompt_tokens,
      usage.completion_tokens
    );

    console.log(
      `[METADATA] ✅ Generated ${platform} metadata for ${postId} ` +
        `(${usage.prompt_tokens}+${usage.completion_tokens} tokens)`
    );

    return { ...result, status: "ready", metadata: validation.cleaned };
  } catch (err) {
    // Classify the error for backoff & DLQ
    const classified = classifyMetadataError(err);
    const errorMsg = classified.message.slice(0, 500);

    console.error(
      `[METADATA] ❌ ${postId}/${platform} [${classified.class}]: ${errorMsg}`
    );

    // Mark as failed with classification — RPC computes backoff
    try {
      await supabase.rpc("mark_metadata_failed", {
        p_post_id: postId,
        p_platform: platform,
        p_error: errorMsg,
        p_failure_class: classified.class,
      });
    } catch (_markErr) {
      console.error("[METADATA] Could not mark failure:", _markErr);
    }

    return {
      ...result,
      status: "failed",
      error: errorMsg,
      failure_class: classified.class,
    };
  } finally {
    // ALWAYS release concurrency slot
    if (slotAcquired) {
      await releaseSlot(supabase, jobId, workerId);
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP Handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  const headers = { ...CORS_HEADERS, "Content-Type": "application/json" };
  const workerId = `metadata-${crypto.randomUUID().slice(0, 8)}`;

  try {
    // ---- Environment ----
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

    // ---- Kill Switch ----
    const { data: killActive } = await supabase.rpc("is_kill_switch_active");
    if (killActive) {
      console.log("[METADATA] ⛔ Kill switch active — aborting");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Kill switch active",
          skipped: true,
        }),
        { status: 503, headers }
      );
    }

    // ---- Parse request ----
    const body = await req.json().catch(() => ({}));
    const { post_id, platform, force = false, source = 'scheduler' } = body as {
      post_id?: string;
      platform?: string;
      force?: boolean;
      source?: string; // 'scheduler' | 'manual' | 'api'
    };

    if (!post_id) {
      return new Response(
        JSON.stringify({ success: false, error: "post_id is required" }),
        { status: 400, headers }
      );
    }

    // ---- Determine platforms ----
    let platforms: string[] = [];
    if (platform) {
      platforms = [platform];
    } else {
      const { data: post } = await supabase
        .from("posts")
        .select("platform")
        .eq("id", post_id)
        .single();

      platforms = post?.platform
        ? [post.platform]
        : Object.keys(PLATFORM_CONFIGS);
    }

    // ---- Generate for each platform ----
    const results: GenerationResult[] = [];
    for (const p of platforms) {
      const genResult = await generateForPost(
        supabase,
        post_id,
        p,
        force,
        openaiKey,
        workerId,
        source
      );
      results.push(genResult);
    }

    const succeeded = results.filter((r) => r.status === "ready").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    return new Response(
      JSON.stringify({
        success: failed === 0,
        version: VERSION,
        post_id,
        summary: { succeeded, failed, skipped },
        results,
      }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("[METADATA] Fatal error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers }
    );
  }
});
