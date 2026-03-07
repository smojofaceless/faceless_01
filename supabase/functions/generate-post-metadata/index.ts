// =============================================================================
// generate-post-metadata — AI-generates platform-specific metadata for a post
// =============================================================================
// v3.0 — Caption/Tags Learning Loop (#20):
//   - Exemplar retrieval: top-performing metadata injected as style guidance
//   - A/B variant support: per-job variant instructions modulate prompts
//   - Version recording: every generation/edit appended to post_metadata_versions
//   - All prior features preserved (kill switch, cost control, error classification,
//     backoff, validation, idempotency, lease-safe claim)
//
// Input:  { post_id: UUID, platform?: string, force?: boolean }
// Output: { success, results: [{ post_id, platform, status, metadata }] }
// =============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

const VERSION = "3.0";

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
      "Optimize for YouTube Shorts discovery. The TITLE is the #1 signal for Shorts — keywords and hashtags in the title directly affect who sees the Short and what topics it's tested under.",
    outputSchema: {
      title:
        "string — max 100 chars. Hook phrase (40-60 chars) + 1-3 hashtags at the end. The hook MUST come first, hashtags LAST. Always include #shorts.",
      description:
        "string — max 500 chars. First 2 lines: expanded keywords and story context (these are indexed). Then a line break, then 3-6 secondary hashtags. End with a CTA (Subscribe, Like).",
      tags: "string[] — 8-12 tags for synonyms, alternate phrasing, and brand consistency. No # prefix. These support discovery but are NOT the primary driver.",
      category_id: "integer — 24 (Entertainment) or 1 (Film & Animation)",
      made_for_kids: "boolean — always false for horror content",
    },
    example: {
      title: "They Counted Six. There Were Seven. #shorts #horror",
      description:
        "Six strangers hide in a convenience store during a storm. They keep counting. The number never changes.\n\n#creepystory #scarystories #horrorstory #mystery #paranormal\n\n🔔 Subscribe for daily horror shorts.",
      tags: [
        "horror story",
        "scary short",
        "creepy narration",
        "nosleep style",
        "counting horror",
        "horror shorts",
        "scary stories",
        "mystery",
      ],
      category_id: 24,
      made_for_kids: false,
    },
    guidance: `
- TITLE is the #1 discovery signal for Shorts — treat it as the most important field
- Title structure: [Hook phrase] #shorts #[genre] — hook FIRST, hashtags LAST
- Hook should be 40-60 chars of natural, intriguing language — numbers, questions, or shock
- Include #shorts (helps categorization) + 1-2 niche hashtags (e.g. #horror, #creepystory)
- Total title max 100 chars including hashtags
- DO NOT keyword-stuff the title — natural language + intrigue wins
- Description first 2 lines: expanded context with keywords (these are indexed but weaker than title)
- Description should include 3-6 secondary hashtags after a line break
- Tags field: fill with synonyms and variations for quiet background support — don't obsess over these
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
    systemSuffix:
      "Optimize for Instagram Reels discovery: Explore page, Reels tab, and hashtag feeds. Instagram ranks by watch time, replays, and saves — caption hook and hashtag relevance are the primary text signals. Generate content people would SAVE or REPLAY.",
    outputSchema: {
      caption:
        "string — max 300 chars. Short hook in the first 1-2 lines (before 'more' cutoff). Use line breaks for rhythm. Build a curiosity gap. End with an open-ended question or ambiguous implication. Emojis OK sparingly. Hashtags are NOT included here — they go in the hashtags array.",
      hashtags:
        "string[] — 5-10 hashtags. Mix of broad (#horror), medium (#creepystories), and niche (#countinghorror). No # prefix in array. No keyword stuffing — quality over quantity.",
      alt_text:
        "string — max 125 chars. Describe the visual scene for accessibility: mood, setting, key visual elements. Instagram indexes this for topic understanding.",
    },
    example: {
      caption:
        "Six strangers took shelter from the storm.\nBut every time they counted, there were seven.\n\nWho didn't belong?",
      hashtags: [
        "horror",
        "creepystory",
        "scarystory",
        "paranormal",
        "countinghorror",
        "horrorreels",
        "spooky",
      ],
      alt_text:
        "Dark convenience store interior with shadowy figures during a storm",
    },
    guidance: `
- Caption: first 1-2 lines are CRITICAL — they show before the "more" cutoff
- Use a short hook, then an unsettling follow-up, then an open-ended question or ambiguous ending
- Saves and replays are the #1 ranking signals — write save-worthy phrasing ("You'll notice it on the second watch…")
- Hashtags: 5-10, mix of broad + medium + niche. Put at the bottom, NOT inline with caption
- Repeating the same hashtag block every post HURTS reach — vary them
- Alt text: describe the visual scene specifically (mood, setting, figures) — Instagram indexes this
- Emojis allowed (more than FB, less than TikTok)
- NEVER include slurs, explicit gore, or self-harm references
- DO NOT write SEO-style paragraphs or use 20+ hashtags — this is punished
`,
  },

  facebook_reels: {
    platform: "Facebook Reels",
    systemSuffix:
      "Optimize for Facebook Reels engagement. Facebook Reels have NO separate title field — the caption IS the entire text. CRITICAL: Facebook Reels SEVERELY penalizes long captions. Keep it UNDER 125 characters. Watch time, replays, and caption hook are the only signals that matter. Hashtags are secondary.",
    outputSchema: {
      caption:
        "string — MUST be under 125 chars. 1-2 SHORT punchy lines only. Curiosity gap or question. Facebook truncates aggressively — the ENTIRE caption must be visible without 'See more'. Do NOT write a description, story summary, or paragraph.",
      hashtags:
        "string[] — 3-5 hashtags max. Broad + niche mix. No # prefix. These get appended to the caption by the system. NEVER more than 5.",
    },
    example: {
      caption:
        "Six strangers. Seven shadows.\nWho was the extra one? 😰",
      hashtags: [
        "horror",
        "creepystory",
        "scarystory",
        "horrorstories",
      ],
    },
    guidance: `
- Facebook Reels have NO title field — the caption is everything
- KEEP CAPTION UNDER 125 CHARACTERS — this is non-negotiable
- The ENTIRE caption must be visible WITHOUT tapping "See more" — anything hidden is wasted
- 1-2 lines MAXIMUM. One hook line + one question or cliffhanger. That's it.
- DO NOT write descriptions, story summaries, context, or multi-paragraph text
- DO NOT keyword-stuff or write SEO-style — Facebook is engagement-first, not search-first
- Hashtags: 3-5 MAX. Overuse hurts reach. Put broad ones first (horror) then niche
- Facebook audience skews slightly older — tone can be more narrative/direct
- Emojis: 1 max, at the end
- NEVER include slurs, explicit gore, or self-harm references
- Think Twitter energy: if it wouldn't fit in a tweet, it's too long for FB Reels
`,
  },

  threads: {
    platform: "Threads",
    systemSuffix:
      "Optimize for Meta Threads (text-first, conversation-driven). Threads rewards brevity, personality, and engagement bait. Posts that feel conversational and opinion-provoking perform best. Video posts show the caption above the video.",
    outputSchema: {
      caption:
        "string — max 300 chars. Short, punchy, conversational. Should feel like a thought or observation, not an ad. Hook in the first line. Can be a question, hot take, or mysterious statement. Emojis OK.",
      hashtags:
        "string[] — 3-5 hashtags. Threads supports hashtags but they're secondary — keep minimal. No # prefix in array.",
    },
    example: {
      caption:
        "Six people hid in a store during the storm.\nEvery time they counted, there were seven.\n\nWho do you think the extra one was?",
      hashtags: [
        "horror",
        "creepystory",
        "threads",
        "scary",
      ],
    },
    guidance: `
- Threads is META's text-first platform — treat it like micro-blogging
- Caption should feel like a THOUGHT you'd share with friends, not a YouTube description
- First line is everything — Threads truncates early in feed
- Questions and open-ended hooks drive replies (which boost distribution)
- Keep hashtags minimal (3-5 max) — Threads is still building hashtag infrastructure
- Tone: conversational, slightly provocative, personal
- Emojis OK but don't overdo it (2-3 max)
- DO NOT write long descriptions or SEO-style text
- NEVER include slurs, explicit gore, or self-harm references
`,
  },

  twitter: {
    platform: "Twitter/X",
    systemSuffix:
      "Optimize for Twitter/X engagement. Tweets are capped at 280 chars. Thread-starters, hot takes, and curiosity gaps drive impressions. Video tweets show the text above the player — the text IS the hook.",
    outputSchema: {
      tweet_text:
        "string — max 240 chars (leave room for link/hashtags). Short, punchy, scroll-stopping. Can be a question, hot take, cliffhanger, or mysterious observation. Emojis OK sparingly.",
      hashtags:
        "string[] — 2-4 hashtags max. Mix broad + niche. No # prefix in array. Twitter penalizes over-hashtagging.",
    },
    example: {
      tweet_text:
        "They counted six people hiding from the storm.\nBut every time they checked, there were seven.\n\nWho was the extra one?",
      hashtags: [
        "horror",
        "creepystory",
        "scary",
      ],
    },
    guidance: `
- Twitter/X is ultra-short format — every character counts
- First line must hook IMMEDIATELY — users scroll fast
- Hot takes, mystery, and unanswered questions drive engagement
- Max 240 chars for tweet_text (system appends hashtags)
- Hashtags: 2-4 MAX. Twitter actively suppresses tweet reach for hashtag spam
- Emojis OK but sparingly (1-2 max)
- DO NOT write descriptions or long-form text
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

  // Quota exhausted → dependency (requires billing fix, not a simple retry)
  if (/insufficient.?quota|quota.?exceeded|billing/i.test(message)) {
    return { class: "dependency", message };
  }

  // Rate limits → transient
  if (/429|rate.?limit|too many requests/i.test(message)) {
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
    exemplars?: Array<{ fields: Record<string, unknown> }>;
    negativeExemplars?: Array<{ fields: Record<string, unknown> }>;
    winningPatterns?: {
      top_hooks?: Array<{ hook: string; perf: number }>;
      top_hashtags?: Array<{ tag: string; count: number; avg_perf: number }>;
      top_ctas?: Array<{ cta: string; count: number }>;
      length_stats?: { avg_title_len?: number; avg_desc_len?: number; avg_tag_count?: number };
    };
    variantInstructions?: string;
    scheduledAt?: string;
    strategyType?: string;
  }
): string {
  const storySummary =
    data.storyText?.substring(0, 600) || "No story available.";
  const schemaBlock = Object.entries(platformConfig.outputSchema)
    .map(([key, desc]) => `  "${key}": ${desc}`)
    .join("\n");
  const exampleBlock = JSON.stringify(platformConfig.example, null, 2);

  // Build exemplars section (if we have high-performing examples)
  let exemplarsSection = "";
  if (data.exemplars && data.exemplars.length > 0) {
    const exemplarEntries = data.exemplars
      .map((ex, i) => `Example ${i + 1}: ${JSON.stringify(ex.fields)}`)
      .join("\n");
    exemplarsSection = `

TOP-PERFORMING EXAMPLES (for style reference only — do NOT copy verbatim):
${exemplarEntries}

Use these as inspiration for tone, structure, and tag/hashtag strategy. Adapt the patterns to THIS video's content.`;
  }

  // Build negative exemplars section (patterns to avoid)
  let negativeSection = "";
  if (data.negativeExemplars && data.negativeExemplars.length > 0) {
    const negEntries = data.negativeExemplars
      .map((ex, i) => `Low-performer ${i + 1}: ${JSON.stringify(ex.fields)}`)
      .join("\n");
    negativeSection = `

LOW-PERFORMING EXAMPLES (avoid these patterns):
${negEntries}

These underperformed. Avoid similar title structures, tag choices, and phrasing.`;
  }

  // Build winning patterns section (cached insights)
  let patternsSection = "";
  if (data.winningPatterns) {
    const wp = data.winningPatterns;
    const parts: string[] = [];

    if (wp.top_hooks && wp.top_hooks.length > 0) {
      const hookList = wp.top_hooks
        .slice(0, 5)
        .map((h) => `  • "${h.hook}" (perf: ${h.perf})`)
        .join("\n");
      parts.push(`Top-performing hook styles:\n${hookList}`);
    }

    if (wp.top_hashtags && wp.top_hashtags.length > 0) {
      const tagList = wp.top_hashtags
        .slice(0, 10)
        .map((t) => `#${t.tag} (used ${t.count}×, avg perf: ${t.avg_perf})`)
        .join(", ");
      parts.push(`High-engagement tags: ${tagList}`);
    }

    if (wp.top_ctas && wp.top_ctas.length > 0) {
      const ctaList = wp.top_ctas
        .slice(0, 5)
        .map((c) => `"${c.cta}" (${c.count}×)`)
        .join(", ");
      parts.push(`Effective CTAs: ${ctaList}`);
    }

    if (wp.length_stats) {
      const ls = wp.length_stats;
      const statParts: string[] = [];
      if (ls.avg_title_len) statParts.push(`title ~${ls.avg_title_len} chars`);
      if (ls.avg_desc_len) statParts.push(`description ~${ls.avg_desc_len} chars`);
      if (ls.avg_tag_count) statParts.push(`~${ls.avg_tag_count} tags`);
      if (statParts.length > 0) {
        parts.push(`Optimal lengths: ${statParts.join(", ")}`);
      }
    }

    if (parts.length > 0) {
      patternsSection = `

WINNING PATTERNS (derived from top performers for this brand/platform):
${parts.join("\n")}

Use these insights to guide your choices — adapt, don't copy.`;
    }
  }

  // Build time-awareness section
  let timeSection = "";
  if (data.scheduledAt) {
    try {
      const schedDate = new Date(data.scheduledAt);
      const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][schedDate.getUTCDay()];
      const hour = schedDate.getUTCHours();
      const timeOfDay = hour < 6 ? 'late night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
      timeSection = `\n\nPOSTING CONTEXT:\nThis video will be posted on ${dayOfWeek} ${timeOfDay} (${hour}:00 UTC).\nTailor the tone, urgency, and CTA style to match when the audience will see it.\n- Morning: energetic hooks, share-worthy\n- Afternoon: curiosity-driven, snackable\n- Evening/Night: atmospheric, binge-worthy, "watch before sleep" energy`;
    } catch { /* non-fatal */ }
  }

  // Build strategy section
  let strategySection = "";
  if (data.strategyType) {
    const strategyGuide: Record<string, string> = {
      'hook_first': 'Lead with the most shocking or curiosity-inducing element. Front-load the hook in the first 5 words.',
      'emotional_arc': 'Build an emotional journey in the metadata — start mysterious, hint at revelation.',
      'question_hook': 'Frame the title/caption as a compelling question the viewer MUST answer by watching.',
      'list_format': 'Use numbered or list-style framing ("3 Signs...", "5 Things...") for high click-through.',
      'controversy': 'Take a mildly controversial angle to drive comments and debate.',
      'fomo': 'Create urgency and fear of missing out — limited time, exclusive angle.',
      'storytelling': 'Use narrative framing — "What happened next changed everything..."',
      'community': 'Speak directly to the community — "Only true horror fans..."',
      'authority': 'Position as expert/insider knowledge — "The truth about..."',
      'trend_ride': 'Reference current trends or popular formats while staying on brand.',
    };
    const guide = strategyGuide[data.strategyType] || `Use the "${data.strategyType}" content strategy approach.`;
    strategySection = `\n\nCONTENT STRATEGY: ${data.strategyType}\n${guide}`;
  }

  // Build A/B variant section (if assigned)
  let variantSection = "";
  if (data.variantInstructions) {
    variantSection = `\n\nA/B VARIANT INSTRUCTIONS:\n${data.variantInstructions}`;
  }

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
${platformConfig.guidance}${exemplarsSection}${negativeSection}${patternsSection}${timeSection}${strategySection}${variantSection}

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
    hashtags: { type: "array", max_items: 10 },
    alt_text: { type: "string", max_length: 125 },
  },
  facebook_reels: {
    caption: { type: "string", max_length: 300, required: true },
    hashtags: { type: "array", max_items: 6 },
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
  // Resolve legacy platform aliases FIRST — before any DB queries or RPCs
  const PLATFORM_ALIASES: Record<string, string> = {
    shorts: "youtube_shorts",
    youtube: "youtube_shorts",
    reels: "instagram_reels",
    instagram: "instagram_reels",
    facebook: "facebook_reels",
  };
  const originalPlatform = platform;
  platform = PLATFORM_ALIASES[platform] || platform;
  if (platform !== originalPlatform) {
    console.log(`[METADATA] Platform alias: ${originalPlatform} → ${platform}`);
  }

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
      .select("id, job_id, platform, brand_id, title, scheduled_at")
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

    // 7a. Fetch top-performing exemplars for this brand/platform/vibe
    let exemplars: Array<{ fields: Record<string, unknown> }> = [];
    let negativeExemplars: Array<{ fields: Record<string, unknown> }> = [];
    if (post.brand_id) {
      try {
        const { data: exData } = await supabase.rpc("get_generation_exemplars", {
          p_brand_id: post.brand_id,
          p_platform: platform,
          p_vibe_preset: vibePreset,
          p_preset_name: null,
          p_limit: 3,
          p_window_days: 30,
        });
        if (exData && exData.length > 0) {
          exemplars = exData.map((e: { fields: Record<string, unknown> }) => ({ fields: e.fields }));
          console.log(`[METADATA] 📚 Loaded ${exemplars.length} exemplar(s) for ${platform}/${vibePreset}`);
        }
      } catch (exErr) {
        // Non-fatal — continue without exemplars
        console.warn("[METADATA] Could not fetch exemplars:", exErr);
      }

      // 7a-ii. Fetch negative exemplars (bottom performers to avoid)
      try {
        const { data: negData } = await supabase.rpc("get_negative_exemplars", {
          p_brand_id: post.brand_id,
          p_platform: platform,
          p_vibe_preset: vibePreset,
          p_limit: 2,
          p_window_days: 30,
        });
        if (negData && negData.length > 0) {
          negativeExemplars = negData.map((e: { fields: Record<string, unknown> }) => ({ fields: e.fields }));
          console.log(`[METADATA] ⚠️ Loaded ${negativeExemplars.length} negative exemplar(s)`);
        }
      } catch (negErr) {
        // Non-fatal
        console.warn("[METADATA] Could not fetch negative exemplars:", negErr);
      }
    }

    // 7a-iii. Fetch cached winning patterns
    interface WinningPatterns {
      top_hooks?: Array<{ hook: string; perf: number }>;
      top_hashtags?: Array<{ tag: string; count: number; avg_perf: number }>;
      top_ctas?: Array<{ cta: string; count: number }>;
      length_stats?: { avg_title_len?: number; avg_desc_len?: number; avg_tag_count?: number };
    }
    let winningPatterns: WinningPatterns | undefined;
    if (post.brand_id) {
      try {
        const { data: wpData } = await supabase.rpc("get_winning_patterns", {
          p_brand_id: post.brand_id,
          p_platform: platform,
          p_vibe_preset: vibePreset,
          p_window_days: 30,
        });
        if (wpData && wpData.length > 0) {
          const wp = wpData[0];
          winningPatterns = {
            top_hooks: wp.top_hooks || [],
            top_hashtags: wp.top_hashtags || [],
            top_ctas: wp.top_ctas || [],
            length_stats: wp.length_stats || {},
          };
          console.log(`[METADATA] 🏆 Loaded winning patterns (${wp.sample_count} samples)`);
        }
      } catch (wpErr) {
        // Non-fatal
        console.warn("[METADATA] Could not fetch winning patterns:", wpErr);
      }
    }

    // 7b. Check A/B variant assignment for this job/platform
    let variantKey: string | null = null;
    let variantInstructions: string | undefined;
    if (post.job_id) {
      try {
        const { data: variants } = await supabase
          .from("post_metadata_variant_assignments")
          .select("variant_key, style_instructions")
          .eq("job_id", post.job_id)
          .eq("platform", platform)
          .eq("is_active", true)
          .order("created_at", { ascending: true })
          .limit(1);

        if (variants && variants.length > 0) {
          variantKey = variants[0].variant_key;
          variantInstructions = variants[0].style_instructions;
          console.log(`[METADATA] 🧪 A/B variant: ${variantKey} for ${postId}/${platform}`);
        }
      } catch (vErr) {
        // Non-fatal — continue as control
        console.warn("[METADATA] Could not fetch variant:", vErr);
      }
    }

    // 7c. Fetch strategy for this platform (from get_top_strategies)
    let strategyType: string | undefined;
    if (post.brand_id) {
      try {
        const { data: strategies } = await supabase.rpc("get_top_strategies", {
          p_brand_id: post.brand_id,
          p_platform: platform,
          p_limit: 3,
        });
        if (strategies && strategies.length > 0) {
          // Pick the top strategy probabilistically (weighted by avg_engagement)
          const totalEng = strategies.reduce((s: number, st: { avg_engagement: number }) => s + (st.avg_engagement || 1), 0);
          let roll = Math.random() * totalEng;
          for (const st of strategies as Array<{ strategy_type: string; avg_engagement: number }>) {
            roll -= st.avg_engagement || 1;
            if (roll <= 0) {
              strategyType = st.strategy_type;
              break;
            }
          }
          if (!strategyType) strategyType = strategies[0].strategy_type;
          console.log(`[METADATA] 🎯 Strategy: ${strategyType} for ${platform}`);
        }
      } catch (sErr) {
        // Non-fatal
        console.warn("[METADATA] Could not fetch strategies:", sErr);
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
      exemplars: exemplars.length > 0 ? exemplars : undefined,
      negativeExemplars: negativeExemplars.length > 0 ? negativeExemplars : undefined,
      winningPatterns,
      variantInstructions,
      scheduledAt: post.scheduled_at || undefined,
      strategyType,
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

    // 13. Record version in post_metadata_versions (append-only history)
    const versionType = force ? "regenerate" : "ai";
    const versionIdempotencyKey = `${postId}:meta-version:${platform}:${versionType}:${Date.now()}`;
    try {
      await supabase.rpc("record_post_metadata_version", {
        p_post_id: postId,
        p_platform: platform,
        p_version_type: versionType,
        p_variant_key: variantKey,
        p_fields: validation.cleaned,
        p_generation_model: "gpt-4o",
        p_schema_version: 1,
        p_idempotency_key: versionIdempotencyKey,
        p_created_by: generatedBy,
      });
      console.log(`[METADATA] 📝 Version recorded (${versionType}${variantKey ? `, variant=${variantKey}` : ""})`);
    } catch (versionErr) {
      // Non-fatal — metadata was already stored successfully
      console.warn("[METADATA] Could not record version:", versionErr);
    }

    // 14. Record cost (after success — idempotent via key)
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
    const supabaseServiceKey = Deno.env.get("SVC_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
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
