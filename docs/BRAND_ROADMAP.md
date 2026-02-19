# BRAND_ROADMAP.md

> **Document Version:** 1.0  
> **Created:** February 19, 2026  
> **Author:** System Architect  
> **Status:** Active Planning  
> **Depends On:** PRESET_SOURCE_OF_TRUTH.md, CAMPAIGN_SYSTEM.md, COST_CONTROLS.md

---

## Table of Contents

1. [Overview](#1-overview)
2. [Brand Catalog](#2-brand-catalog)
3. [Launch Phases](#3-launch-phases)
4. [Platform Strategy Summary](#4-platform-strategy-summary)
5. [Expansion Rules](#5-expansion-rules)
6. [Future Extensions](#6-future-extensions)

---

## 1. Overview

### Purpose

This document defines the order, rationale, and evolution plan for every brand in the faceless AI content engine. It answers three questions for each brand:

1. **When does it launch?** (phase assignment)
2. **Why that phase?** (risk/complexity/cost justification)
3. **How does it grow?** (preset, strategy, and platform expansion over time)

### Fit Within the Multi-Brand Engine

The engine already supports:

- `brand_templates` as the single source of truth for presets per brand
- `config_overrides` for voice, schedule, music, effects, and subtitles per brand
- `platform_strategies` registry with 20 seeded strategies across 6 platforms
- `generate-post-metadata` v3.0 with exemplar retrieval, winning patterns, A/B variants, and strategy-driven prompts
- `time_slot_scores` and `winning_metadata_patterns` for per-brand/platform learning
- Campaign system with templates, scheduling windows, and batch orchestration
- Cost controls with per-job caps, per-campaign budgets, and global throttles

Each brand plugs into this infrastructure via a single `brands` row, its `brand_templates` entries, and its `config_overrides`. No code changes are required to add a new brand — only configuration.

### How Phases Reduce Risk

| Phase | Risk Profile | Learning Goal |
|-------|-------------|---------------|
| Phase 1 | Low cost, proven format, text-only generation | Validate scheduling, posting, metrics collection, and learning loop end-to-end |
| Phase 2 | Moderate cost, new content types, image generation | Validate cross-genre presets, multi-brand scheduling, and strategy diversification |
| Phase 3 | Higher cost, video-heavy or niche audiences | Validate expensive pipelines, niche audience retention, and brand portfolio optimization |

Each phase must achieve its learning goal before the next phase unlocks. This prevents wasted spend on brands that depend on infrastructure not yet validated.

---

## 2. Brand Catalog

### 2.1 Confessions & Choices

| Attribute | Value |
|-----------|-------|
| **Concept** | Gameplay-background confessions and moral dilemma narration. Viewer watches satisfying gameplay footage while listening to anonymous confessions or "what would you do" scenarios. |
| **Primary Platforms** | TikTok, YouTube Shorts, Instagram Reels |
| **Core Engagement Mechanic** | 💬 Replies + ⏱ Retention (confession hooks drive comments; gameplay holds attention) |
| **Content Generation** | Text narration over sourced/licensed gameplay footage. No AI image generation required. |

**Presets:**

- `confession_storytime` — Anonymous confession with moral ambiguity. First-person narration, escalating stakes.
- `moral_dilemma` — "What would you do?" scenario with no clear right answer. Ends with open question.
- `relationship_confession` — Relationship-specific confessions (cheating, secrets, breakups). High emotional charge.
- `workplace_chaos` — Office/job confessions. Relatable frustration + absurd escalation.

---

### 2.2 Would You Rather

| Attribute | Value |
|-----------|-------|
| **Concept** | Rapid-fire "Would You Rather" dilemmas with escalating difficulty. Text on screen + voiceover. Designed for maximum reply engagement. |
| **Primary Platforms** | TikTok, Instagram Reels, Threads |
| **Core Engagement Mechanic** | 💬 Replies (every post is a direct question that demands an answer) |
| **Content Generation** | Text generation + simple visual overlay. No AI image generation. |

**Presets:**

- `wyr_horror` — Horror-themed dilemmas. "Would you rather be hunted by X or trapped in Y?"
- `wyr_impossible` — Impossible everyday choices. High shareability.
- `wyr_escalating` — Series of 3-5 dilemmas that get progressively harder. Retention-focused.
- `wyr_viral_debate` — Deliberately polarizing choices designed to split the audience 50/50.

---

### 2.3 Stories That Stalk (Horror)

| Attribute | Value |
|-----------|-------|
| **Concept** | AI-generated horror short stories with narration, AI images, music, and effects. Full pipeline brand — the engine's flagship. |
| **Primary Platforms** | YouTube Shorts, Instagram Reels, Facebook Reels, Threads |
| **Core Engagement Mechanic** | ⏱ Retention + 💾 Saves (atmospheric horror drives watch-through; save-worthy lore) |
| **Content Generation** | Full pipeline: story → scenes → voice → images → music → subtitles → video assembly. Highest cost per unit. |

**Presets (Active):**

- `urban_legend` — Documentary folklore. Neutral narrator, archival tone.
- `one_too_many` — Counting horror (N+1 trope). Mathematical dread.
- `reddit_trending_horror` — First-person viral narration. Mundane-to-terrifying arc.
- `dark_origins` — Origin-story folklore. Third-person, date/location anchored, slow-burn.

**Presets (Planned):**

- `security_cam` — Surveillance-footage framing. Found-footage aesthetic.
- `creepypasta_classic` — Classic internet horror. Self-aware narrator, meta-horror elements.

---

### 2.4 Lego History

| Attribute | Value |
|-----------|-------|
| **Concept** | Historical events narrated over AI-generated Lego-style scene images. Educational + entertaining. Surprisingly high retention due to visual novelty. |
| **Primary Platforms** | YouTube Shorts, TikTok, Instagram Reels |
| **Core Engagement Mechanic** | ⏱ Retention + 🔄 Shares (visual novelty holds attention; educational content is share-worthy) |
| **Content Generation** | Story generation + AI image generation (Lego-style scenes). Moderate cost — images are the primary expense. |

**Presets:**

- `lego_war` — Major battles and military history recreated in Lego.
- `lego_disaster` — Natural disasters and catastrophic events. Visual spectacle.
- `lego_ancient` — Ancient civilizations and mythology. Pyramids, Rome, Vikings.
- `lego_modern` — 20th/21st century events. Moon landing, Berlin Wall, tech revolutions.

---

### 2.5 Lego Bible Verses

| Attribute | Value |
|-----------|-------|
| **Concept** | Bible verses visualized as Lego dioramas. Short, contemplative, highly shareable within faith communities. |
| **Primary Platforms** | Instagram Reels, Facebook Reels, YouTube Shorts |
| **Core Engagement Mechanic** | 💾 Saves + 🔄 Shares (devotional content gets saved for revisiting and shared within communities) |
| **Content Generation** | Verse selection + AI image generation (Lego-style). Low text complexity, moderate image cost. |

**Presets:**

- `lego_verse_daily` — Daily verse with single Lego scene. Clean, minimal narration.
- `lego_verse_thematic` — Themed verse collections (hope, strength, peace). 3-5 verses per video.
- `lego_verse_storytelling` — Verse embedded in a short narrative. More cinematic framing.

---

### 2.6 Lego Bible Stories

| Attribute | Value |
|-----------|-------|
| **Concept** | Full Bible stories (David & Goliath, Noah's Ark, Exodus) retold with Lego visuals and narration. Longer-form than verses — mini episodes. |
| **Primary Platforms** | YouTube Shorts, Facebook Reels, Instagram Reels |
| **Core Engagement Mechanic** | ⏱ Retention + 💾 Saves (narrative arc drives watch-through; parents save for kids) |
| **Content Generation** | Full pipeline: story adaptation → multi-scene Lego images → voice → music → assembly. High cost — multiple images per video. |

**Presets:**

- `lego_bible_epic` — Grand-scale stories (Exodus, Creation, Revelation). Cinematic narration.
- `lego_bible_parable` — Jesus's parables. Shorter, moral-focused. Warm narration.
- `lego_bible_hero` — Character-focused (Moses, David, Esther). Action-oriented.

---

### 2.7 Restoration Time Lapse

| Attribute | Value |
|-----------|-------|
| **Concept** | AI-generated restoration time-lapse sequences. Rusty tools, old furniture, abandoned cars — shown being restored step by step. Satisfying visual content. |
| **Primary Platforms** | TikTok, Instagram Reels, YouTube Shorts |
| **Core Engagement Mechanic** | ⏱ Retention + 💾 Saves (satisfying progression holds attention; viewers save to rewatch) |
| **Content Generation** | AI image sequence generation (before → during → after states). Requires multi-image consistency. Experimental — image coherence across frames is the primary technical challenge. |

**Presets:**

- `tool_restoration` — Hand tools, knives, vintage equipment. Close-up focus.
- `furniture_restoration` — Chairs, tables, dressers. Before/after drama.
- `vehicle_restoration` — Cars, motorcycles, tractors. Larger scale, more frames.
- `oddly_satisfying` — Mixed restoration with emphasis on the most satisfying transformations.

---

### 2.8 Space Facts (Parody-Style)

| Attribute | Value |
|-----------|-------|
| **Concept** | Real space/science facts delivered with absurdist, deadpan humor. Factual content wrapped in parody narration. Think "Kurzgesagt meets shitposting." |
| **Primary Platforms** | TikTok, YouTube Shorts, Threads |
| **Core Engagement Mechanic** | 🔄 Shares + 💬 Replies (humor drives shares; controversial framing drives debates) |
| **Content Generation** | Script generation + AI images (space scenes, diagrams). Moderate cost. Humor calibration is the primary quality challenge. |

**Presets:**

- `space_unhinged` — Real facts delivered like conspiracy theories. Deadpan absurdism.
- `space_comparison` — "X is bigger than Y" scale comparisons. Visual shock value.
- `space_what_if` — "What if the Sun disappeared?" hypotheticals. Science + drama.
- `space_tier_list` — Ranking planets, moons, or phenomena. Engagement bait format.

---

### 2.9 Forgotten / Lost Things

| Attribute | Value |
|-----------|-------|
| **Concept** | Forgotten history, lost cities, abandoned places, discontinued products, dead technology. Nostalgia + mystery. |
| **Primary Platforms** | YouTube Shorts, Instagram Reels, Facebook Reels |
| **Core Engagement Mechanic** | 💾 Saves + 💬 Replies (nostalgia drives saves; "I remember this!" drives comments) |
| **Content Generation** | Story generation + AI images (historical/abandoned aesthetics). Moderate cost. |

**Presets:**

- `forgotten_places` — Abandoned cities, ghost towns, derelict buildings. Atmospheric narration.
- `lost_technology` — Dead tech (LaserDisc, Zune, Google Glass). "Why did this fail?" framing.
- `discontinued_products` — Foods, toys, services people miss. Nostalgia-heavy.
- `erased_history` — Events/people deliberately erased from records. Conspiracy-adjacent but factual.

---

## 3. Launch Phases

### Phase 1 — Foundation (Weeks 1-4)

**Goal:** Validate the full production pipeline end-to-end across multiple brands. Prove that scheduling, posting, metrics collection, and the learning loop work reliably at scale before adding complexity.

**Brands:**

| Brand | Reason |
|-------|--------|
| **Stories That Stalk** | Already live. Full pipeline proven. Serves as the control brand for all system comparisons. |
| **Confessions & Choices** | Low cost (text-only, no AI images). High volume possible. Reply-driven — tests comment-based learning signals. |
| **Would You Rather** | Lowest production cost. Pure text generation. Reply-farming mechanic tests engagement-driven metadata optimization fastest. |

**Why these brands first:**

1. **Stories That Stalk** is already operational — zero additional setup cost. It continues generating data for the learning loop.
2. **Confessions & Choices** and **Would You Rather** require only text generation + sourced video backgrounds. No image pipeline dependency. This means near-zero incremental API cost per video.
3. All three brands target different engagement mechanics (retention, replies, shares), so the strategy system and metadata learning loop get diverse training signals from day one.

**System Learns:**

- Multi-brand scheduling reliability (3 brands, different cadences)
- Cross-brand cost tracking accuracy
- Reply-driven vs. retention-driven posting time optimization
- Strategy selection with real A/B data across engagement types
- Winning patterns divergence between brand types

**Exit Criteria:**

- [ ] All 3 brands posting on schedule for 7+ consecutive days
- [ ] Metrics collection running for all brands (even if some platforms return stubs)
- [ ] `winning_metadata_patterns` populated for at least 2 brands
- [ ] `time_slot_scores` have ≥20 samples per brand/platform
- [ ] No manual intervention required for 48+ hours

---

### Phase 2 — Expansion (Weeks 5-10)

**Goal:** Introduce image-generation brands. Validate AI image pipelines for non-horror genres. Test audience response to visual novelty formats. Scale to 6+ brands without scheduling conflicts or cost overruns.

**Brands:**

| Brand | Reason |
|-------|--------|
| **Lego History** | Strong visual hook. Educational content has proven retention. Image generation is the only new pipeline element — story/voice/assembly are reused from Phase 1. |
| **Lego Bible Verses** | Simplest Lego variant (single image per video). Low cost entry point for the Lego visual style. Tests faith-community engagement patterns. |
| **Space Facts** | Different audience entirely. Tests whether the strategy system can handle humor-calibrated metadata. Text-heavy with supporting images. |
| **Forgotten / Lost Things** | Nostalgia + mystery overlaps with horror audience but is distinctly different. Tests cross-audience learning (do horror viewers also engage with nostalgia?). |

**Why these brands in Phase 2:**

1. **Lego brands** require AI image generation (gpt-image-1), which is the most expensive API call in the pipeline. Phase 1's cost tracking must be validated before this scales.
2. **Space Facts** introduces humor — a fundamentally different tone from horror/confessions. The metadata learning loop needs enough Phase 1 data to avoid polluting humor prompts with horror patterns.
3. **Forgotten / Lost Things** is the bridge brand — thematically adjacent to horror but appeals to a broader audience. It tests whether per-brand learning isolation works correctly.

**System Learns:**

- Image generation cost per brand (gpt-image-1 usage patterns)
- Multi-genre preset management (horror vs. educational vs. humor vs. nostalgia)
- Strategy effectiveness across audience types
- Cross-brand platform scheduling at 6+ brands (conflict avoidance)
- Whether Lego-style images maintain consistency across batches
- Humor calibration in metadata generation (Space Facts)

**Exit Criteria:**

- [ ] Image pipeline stable for Lego brands (≥50 images generated without failures)
- [ ] Per-brand cost stays within configured budgets for 14+ consecutive days
- [ ] Strategy performance data shows measurable divergence between brand types
- [ ] No cross-brand data leakage in winning patterns or exemplars
- [ ] Concurrent campaign scheduling works for 6 brands without overlap issues

---

### Phase 3 — Scale (Weeks 11-16)

**Goal:** Launch the remaining high-cost and experimentally complex brands. Prove the system can run 9 brands autonomously. Begin cross-brand portfolio optimization.

**Brands:**

| Brand | Reason |
|-------|--------|
| **Lego Bible Stories** | Full multi-scene Lego pipeline. Highest image cost per video (5-8 images). Requires Phase 2's Lego image consistency to be proven. |
| **Restoration Time Lapse** | Most technically challenging brand. Requires multi-image consistency (before → during → after states of the same object). Experimental — may require custom prompt engineering or model fine-tuning. |

**Why these brands last:**

1. **Lego Bible Stories** generates the most images per video in the entire catalog. Without Phase 2's cost data and image pipeline stability proof, this brand could blow through budgets.
2. **Restoration Time Lapse** has an unsolved technical challenge: AI image consistency across a transformation sequence. The same object must be recognizable in 4-6 frames at different restoration stages. This may require prompt engineering techniques learned from Phase 2's Lego image generation.

**System Learns:**

- Multi-image-per-video cost optimization
- Image consistency techniques (same subject across frames)
- Full portfolio scheduling (9 brands, multiple platforms each)
- Cross-brand audience overlap analysis
- Which brands to scale vs. pause based on engagement ROI

**Exit Criteria:**

- [ ] All 9 brands posting autonomously
- [ ] Restoration brand achieves acceptable image consistency (≥70% viewer-perceived continuity)
- [ ] Total daily cost stays under global budget ceiling
- [ ] Learning loop shows measurable improvement in metadata quality (A/B test data)
- [ ] Strategy system has ≥100 data points per platform for statistical significance

---

## 4. Platform Strategy Summary

### Platform Prioritization by Brand

| Brand | YouTube Shorts | Instagram Reels | TikTok | Facebook Reels | Threads | X |
|-------|:-:|:-:|:-:|:-:|:-:|:-:|
| Confessions & Choices | ● | ● | ★ | ○ | ○ | ○ |
| Would You Rather | ○ | ● | ★ | ○ | ● | ○ |
| Stories That Stalk | ★ | ● | ● | ● | ● | ○ |
| Lego History | ★ | ● | ● | ○ | ○ | ○ |
| Lego Bible Verses | ○ | ★ | ○ | ● | ○ | ○ |
| Lego Bible Stories | ★ | ● | ○ | ● | ○ | ○ |
| Restoration Time Lapse | ● | ★ | ● | ○ | ○ | ○ |
| Space Facts | ● | ○ | ★ | ○ | ● | ○ |
| Forgotten / Lost Things | ★ | ● | ○ | ● | ○ | ○ |

**Legend:** ★ = primary platform, ● = active, ○ = not prioritized (may add later)

### Why Some Brands Prioritize Different Platforms

**TikTok-first brands** (Confessions, Would You Rather, Space Facts):
- Reply-driven and share-driven mechanics align with TikTok's algorithm, which rewards comment velocity and shares.
- Short text-overlay format is native to TikTok's content style.
- TikTok's "scroll stop" strategy maps directly to these brands' hook-first content.

**YouTube Shorts-first brands** (Stories That Stalk, Lego History, Lego Bible Stories, Forgotten Things):
- Retention-driven mechanics align with YouTube's algorithm, which rewards watch-through rate.
- Higher production value (voice + images + music) is more valued on YouTube than TikTok.
- YouTube's subscriber model supports series-based content (Lego Bible Stories episodes).

**Instagram-first brands** (Lego Bible Verses, Restoration Time Lapse):
- Save-driven mechanics align with Instagram's algorithm, which weights saves heavily.
- Aesthetic-focused content (Lego dioramas, restoration before/afters) fits Instagram's visual-first culture.
- Faith communities and DIY/restoration communities are heavily concentrated on Instagram.

### Reply-Driven vs. Retention-Driven Brands

| Characteristic | Reply-Driven | Retention-Driven |
|---------------|-------------|-----------------|
| **Primary metric** | Comments, shares | Watch time, saves |
| **Content structure** | Open question at end | Narrative arc with payoff |
| **Optimal length** | Shorter (15-30s) | Moderate (30-60s) |
| **Strategy types** | `reply_farming`, `stitch_bait`, `conversation_starter` | `retention_hook`, `curiosity_gap`, `save_bait` |
| **Metadata style** | Provocative, polarizing, question-based | Atmospheric, curiosity-driven, cliffhanger |
| **Learning signal** | Comment count + reply depth | Average view duration + save rate |
| **Brands** | Confessions, Would You Rather, Space Facts | Stories That Stalk, Lego History, Lego Bible Stories, Restoration |
| **Hybrid** | Forgotten Things (nostalgia replies + save-worthy content) | — |

### How Learning Improves Over Time

```
Week 1-2:  Default strategies, random A/B assignment
           → Baseline data collected across all platforms
           
Week 3-4:  get_winning_patterns returns first results (30-day window)
           → Metadata generation starts adapting hooks, hashtags, CTAs
           
Week 5-8:  get_top_strategies has ≥2 posts per strategy type
           → Probabilistic strategy selection kicks in (engagement-weighted)
           → Negative exemplars start pruning underperforming patterns
           
Week 9-12: time_slot_scores accumulate ≥20 samples per slot
           → Smart scheduling begins replacing fixed time windows
           → Cross-platform comparison reveals per-brand platform ROI
           
Week 13+:  Full learning loop operational
           → Each brand/platform/preset combination has its own optimized:
              - Hook style
              - Hashtag set
              - CTA type
              - Posting time
              - Content strategy
```

---

## 5. Expansion Rules

### When to Add a New Preset

A new preset is warranted when:

1. **Audience signal detected** — Comments, DMs, or search trends indicate demand for a content subtype not covered by existing presets (e.g., "do more surveillance footage style" → `security_cam` preset).
2. **Strategy saturation** — All existing presets have ≥50 posts and winning patterns are converging (diminishing returns on optimization). A new preset introduces fresh variation.
3. **A/B testing reveals a gap** — Variant performance data shows a specific hook/tone combination outperforming all presets, but it doesn't fit any existing preset's style guide.

**Process:**

1. Add row to `brand_templates` (via admin UI or migration)
2. Add quality gate function in `worker-v1/steps.ts` (if narrative constraints are needed)
3. Add preset metadata in `js/templates/{genre}.js` (icon, tagline, description)
4. Run 10 test generations before enabling in campaigns
5. No code deploy required — `brand_templates` is the source of truth

### When to Add a New Brand

A new brand is warranted when:

1. **Content gap identified** — A content category with proven audience demand (validated externally via competitor analysis or trend data) is not served by any existing brand.
2. **Pipeline capability unlocked** — A new technical capability (e.g., video-to-video, real-time generation) enables a brand type that was previously impossible.
3. **Portfolio diversification needed** — Over 60% of total engagement comes from ≤2 brands. Adding a brand reduces concentration risk.

**Process:**

1. Create `brands` row (name, slug, theme colors)
2. Add `brand_templates` entries (at least 2 presets)
3. Configure `config_overrides` (voice, schedule, music, effects)
4. Connect platform tokens
5. Create first campaign (use "Daily" or "Twice Daily" template)
6. Monitor for 7 days before increasing cadence

### Brand Validation Status

| Status | Definition | Criteria |
|--------|-----------|----------|
| **Experimental** | Brand is live but unproven. May be paused or pivoted. | < 30 posts, < 14 days of data, no winning patterns |
| **Validated** | Brand has proven engagement and stable metrics. Safe to scale. | ≥ 30 posts, ≥ 14 days, winning patterns populated, cost within budget, no manual intervention for 7+ days |
| **Scaling** | Brand is validated and being expanded (more platforms, higher cadence, new presets). | All "Validated" criteria + positive engagement trend over 30 days + per-post cost declining |
| **Paused** | Brand is temporarily stopped for investigation or optimization. | Engagement declining for 14+ days OR cost per engagement exceeds 2× the portfolio average |

### When Expensive Brands Should Unlock

Brands requiring AI image generation (gpt-image-1) are gated by:

1. **Cost tracking accuracy** — `api_usage` ledger must show ≤5% variance between tracked and actual billing for 14+ consecutive days.
2. **Budget headroom** — Global daily budget must have ≥40% unused capacity after all Phase 1 brands are at target cadence.
3. **Image pipeline stability** — Worker-v1 image generation step must have ≤2% failure rate over the last 50 jobs.
4. **Previous phase exit criteria met** — All checkboxes from the preceding phase must be checked.

**Cost tiers:**

| Tier | Cost Profile | Brands |
|------|-------------|--------|
| **Tier 1: Text-only** | ~$0.01-0.03 per post | Confessions & Choices, Would You Rather |
| **Tier 2: Text + Images** | ~$0.10-0.30 per post | Lego History, Lego Bible Verses, Space Facts, Forgotten Things |
| **Tier 3: Full Pipeline** | ~$0.30-0.80 per post | Stories That Stalk, Lego Bible Stories |
| **Tier 4: Multi-Image Sequence** | ~$0.50-1.50 per post | Restoration Time Lapse |

---

## 6. Future Extensions

### Analytics Integration

The brand roadmap is designed to feed into future analytics dashboards:

- **Brand health scores** — Derived from `winning_metadata_patterns` population rate, `time_slot_scores` sample depth, post failure rate, and engagement trend direction. No new tables required — all data exists.
- **Portfolio-level ROI** — Cross-brand comparison of cost-per-engagement using `api_usage` + `post_metrics`. Queryable today via `v_cross_platform_performance` joined with cost data.
- **Phase progression tracking** — Exit criteria can be evaluated programmatically by querying existing tables (post counts, pattern counts, time slot samples, consecutive uptime).

### Dashboard Compatibility

The roadmap structure (phases, brands, statuses, presets) is designed to be rendered in a visual dashboard page (see specification below). All data points are either:

- Already in the database (`brands`, `brand_templates`, `posts`, `post_metrics`, `winning_metadata_patterns`, `time_slot_scores`)
- Derivable from existing views (`v_strategy_performance`, `v_cross_platform_performance`, `v_post_metrics_latest`)
- Configurable via a lightweight `brand_roadmap_config` table (phase assignments, target dates, dependencies)

No Level 3 metrics implementation is required. The roadmap operates on Level 1-2 data that already exists.

### Automation Hooks

As the system matures, the roadmap supports:

- **Auto-promotion** — Brand moves from "experimental" → "validated" when criteria are met (queryable)
- **Auto-pause** — Brand pauses when engagement drops below threshold (alert webhook system already exists)
- **Auto-unlock** — Phase 2/3 brands auto-launch when preceding phase exit criteria pass
- **Budget rebalancing** — Shift daily budget allocation toward higher-ROI brands based on `v_strategy_performance`

These are future capabilities. The current roadmap is a manual planning document that structures the data needed to automate these decisions later.

---
---

# Visual Roadmap Page Specification

> **Page:** `/pages/brand-roadmap.html`  
> **CSS:** `/css/brand-roadmap.css`  
> **JS:** `/js/pages/brand-roadmap.js`  
> **Status:** Specification Only (no implementation)

---

## Page Purpose

A single admin dashboard page that visualizes brand progression, launch status, and system learning across all phases. Replaces the need to read this markdown document for day-to-day operational decisions.

**Primary user:** System operator (you). Not a marketing dashboard — an engineering control surface.

---

## Layout Sections

### Section 1: Phase Timeline (Top)

A horizontal three-column layout showing Phase 1 → Phase 2 → Phase 3.

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   PHASE 1        │  │   PHASE 2        │  │   PHASE 3        │
│   Foundation     │  │   Expansion      │  │   Scale          │
│                  │  │                  │  │                  │
│  Weeks 1-4       │  │  Weeks 5-10      │  │  Weeks 11-16     │
│  ██████████ 100% │  │  ████░░░░░░  40% │  │  ░░░░░░░░░░   0% │
│                  │  │                  │  │                  │
│  3 brands        │  │  4 brands        │  │  2 brands        │
│  ✅ All live     │  │  🔄 2 launching  │  │  ⏳ Pending      │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

**Each phase column shows:**

- Phase name and subtitle
- Date range (configurable)
- Progress bar (% of exit criteria met)
- Brand count
- Status summary (all live / launching / pending)

**Interaction:** Hover a phase → tooltip shows:
- Goals (bullet list)
- Exit criteria with ✅/❌ status
- Learning focus

---

### Section 2: Brand Cards (Main Content)

A responsive grid of brand cards, organized by phase. Each card is a compact summary.

```
┌─────────────────────────────────────────┐
│  📜 Stories That Stalk          ACTIVE  │
│  ─────────────────────────────────────  │
│  Horror short stories                   │
│                                         │
│  Presets: 4 active, 2 planned           │
│  Platforms: YT IG FB TH                 │
│  Posts: 127  │  Engagement: ↑ 12%       │
│                                         │
│  Health: ████████░░  82%                │
│  ⏱ Retention-driven  │  💾 Save-driven │
└─────────────────────────────────────────┘
```

**Card fields:**

| Field | Source | Description |
|-------|--------|-------------|
| Brand name + icon | `brands` table | Display name |
| Status badge | `brand_roadmap_config` or derived | `planned` / `active` / `scaling` / `paused` |
| Core concept | Static config | One-line description |
| Preset count | `brand_templates` count | "N active, M planned" |
| Platforms | `platform_tokens` + `posts` | Icons for each connected platform |
| Post count | `COUNT(posts)` | Total posts to date |
| Engagement trend | `v_post_metrics_latest` 7-day delta | ↑/↓/→ with percentage |
| Health indicator | Composite score | Based on: failure rate, metric collection rate, winning pattern population, cost efficiency |
| Engagement type icons | Static config | 💬 replies, ⏱ retention, 💾 saves, 🔄 shares |

**Card colors by status:**

| Status | Color | Opacity |
|--------|-------|---------|
| Active | Green border-left | 100% |
| Scaling | Blue border-left | 100% |
| Planned | Gray border-left | 60% |
| Paused | Orange border-left | 80% |

---

### Section 3: Brand Detail Panel (Right Sidebar / Modal)

Clicking a brand card opens a detail panel showing:

**Presets sub-section:**

```
Presets (4 active)
├── urban_legend      ██████████ 60%  (weight)  │ 45 posts │ ↑ perf
├── one_too_many      ████░░░░░░ 20%            │ 28 posts │ → perf
├── reddit_trending   ███░░░░░░░ 15%            │ 31 posts │ ↑ perf
└── dark_origins      █░░░░░░░░░  5%            │ 23 posts │ ↓ perf
```

**Strategy types sub-section:**

```
Top Strategies (last 30 days)
1. retention_hook     avg_perf: 847    posts: 12
2. curiosity_gap      avg_perf: 723    posts: 8
3. save_bait          avg_perf: 691    posts: 15
```

**Learning status sub-section:**

```
Learning Loop Status
├── Winning Patterns:  ✅ Populated (last: 2h ago)
├── Time Slot Scores:  ✅ 47 samples
├── Strategy Data:     ✅ 35 posts with strategy assignments
├── Exemplars:         ✅ 8 positive, 3 negative
└── A/B Variants:      🔄 2 active tests
```

---

### Section 4: Learning Focus (Bottom)

A compact per-phase summary of what the system is currently learning.

```
Phase 1 Learning                    Phase 2 Learning
├── Multi-brand scheduling: ✅     ├── Image cost tracking: 🔄
├── Reply vs retention: 🔄        ├── Cross-genre presets: ⏳
├── Cross-brand cost: ✅           ├── Humor calibration: ⏳
└── Strategy baseline: 🔄         └── 6-brand scheduling: ⏳
```

---

### Section 5: Dependencies (Collapsible)

A collapsible section showing what must be true before each brand/phase unlocks.

```
Phase 2 Dependencies
├── ✅ Cost tracking ≤5% variance (14 days)
├── ✅ Budget headroom ≥40%
├── 🔄 Image pipeline ≤2% failure rate (need 12 more jobs)
└── ❌ Phase 1 exit criteria not all met (time_slot_scores < 20)
```

---

## Interactions

| Action | Result |
|--------|--------|
| Click brand card | Opens detail panel (presets, strategies, learning status) |
| Hover phase column | Tooltip with goals, exit criteria, learning focus |
| Filter by platform | Shows only brands active on selected platform. Dropdown: All / YouTube / Instagram / TikTok / Facebook / Threads / X |
| Filter by engagement type | Shows only brands matching: 💬 Replies / ⏱ Retention / 💾 Saves / 🔄 Shares |
| Filter by status | Shows only: All / Active / Scaling / Planned / Paused |
| Click "Dependencies" | Expands collapsible dependency checklist per phase |
| Click preset row | Navigates to AI Intelligence page filtered to that preset |
| Click engagement trend | Navigates to brand's post metrics page |

---

## Visual Style Notes

### Design Language

- **Aesthetic:** System-oriented, engineering dashboard. Inspired by Linear, Vercel, and Notion's project views.
- **Typography:** Monospace for data values (counts, percentages, dates). Sans-serif for labels and descriptions.
- **Density:** High information density. No hero images, no decorative elements. Every pixel conveys data.
- **Color palette:** Dark background (`--bg-primary`), muted borders, color used only for status and engagement type indicators.

### Color Coding

| Element | Color Token | Usage |
|---------|------------|-------|
| Phase 1 | `--phase-1: #3b82f6` (blue) | Phase column bg tint, brand card phase indicator |
| Phase 2 | `--phase-2: #8b5cf6` (purple) | Phase column bg tint |
| Phase 3 | `--phase-3: #f59e0b` (amber) | Phase column bg tint |
| Active | `--status-active: #22c55e` (green) | Status badge, health bar fill |
| Scaling | `--status-scaling: #3b82f6` (blue) | Status badge |
| Planned | `--status-planned: #6b7280` (gray) | Status badge, reduced opacity |
| Paused | `--status-paused: #f97316` (orange) | Status badge |

### Engagement Type Icons

| Mechanic | Icon | Color |
|----------|------|-------|
| Replies | 💬 | `--engagement-replies: #60a5fa` |
| Retention | ⏱ | `--engagement-retention: #a78bfa` |
| Saves | 💾 | `--engagement-saves: #34d399` |
| Shares | 🔄 | `--engagement-shares: #fbbf24` |

### Responsive Behavior

| Breakpoint | Layout |
|-----------|--------|
| ≥1200px | 3-column phase timeline + 3-column brand grid + right sidebar detail |
| 768-1199px | 3-column phase timeline (compressed) + 2-column brand grid + modal detail |
| <768px | Stacked phases + single-column brand cards + full-screen modal detail |

---

## Data Requirements

All data for this page is available from existing tables and views:

| Data Point | Source |
|-----------|--------|
| Brand list | `brands` table |
| Preset count per brand | `brand_templates` table |
| Platform connections | `platform_tokens` table |
| Post counts | `posts` table (GROUP BY brand_id) |
| Engagement metrics | `v_post_metrics_latest` view |
| Winning patterns status | `winning_metadata_patterns` table |
| Time slot sample count | `time_slot_scores` table (COUNT) |
| Strategy performance | `v_strategy_performance` view |
| Exemplar count | `get_generation_exemplars` RPC |
| Cost data | `api_usage` table |
| Phase config | New: `brand_roadmap_config` table (lightweight — phase assignment, target dates, dependencies) |

**New table required:** `brand_roadmap_config` — a simple configuration table mapping brands to phases with metadata. ~10 rows, no complex logic.

```sql
CREATE TABLE brand_roadmap_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID REFERENCES brands(id),
  phase INTEGER NOT NULL CHECK (phase IN (1, 2, 3)),
  target_launch_date DATE,
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'scaling', 'paused')),
  dependencies JSONB DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Assumptions

1. **Brand count is fixed at 9 for planning purposes.** The system supports unlimited brands, but this roadmap scopes the first 9.
2. **TikTok and X/Twitter API access is currently unavailable.** Phase 1 brands targeting these platforms will post to available platforms first and add TikTok/X when API access is granted.
3. **Restoration Time Lapse is the highest-risk brand.** Multi-image consistency is an unsolved problem in the current pipeline. Phase 3 placement allows time for research.
4. **Cost estimates are based on current OpenAI and ElevenLabs pricing.** Actual costs will be validated during Phase 1 and may shift brand phase assignments.
5. **"Confessions & Choices" and "Would You Rather" assume access to licensed/sourced gameplay footage or simple visual overlays.** The AI engine generates text; video backgrounds are sourced separately.
6. **All brands share the same Supabase project and edge functions.** No per-brand infrastructure separation is planned.
