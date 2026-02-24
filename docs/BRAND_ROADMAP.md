# BRAND_ROADMAP.md

> **Document Version:** 2.0  
> **Created:** February 19, 2026  
> **Updated:** February 21, 2026  
> **Author:** System Architect  
> **Status:** Active — Phase 1 In Progress  
> **Depends On:** PRESET_SOURCE_OF_TRUTH.md, CAMPAIGN_SYSTEM.md, COST_CONTROLS.md

---

## Table of Contents

1. [Overview](#1-overview)
2. [Brand Catalog](#2-brand-catalog)
3. [Pipeline Modes](#3-pipeline-modes)
4. [Launch Phases](#4-launch-phases)
5. [Platform Strategy Summary](#5-platform-strategy-summary)
6. [Expansion Rules](#6-expansion-rules)
7. [Technical Risks & Lessons Learned](#7-technical-risks--lessons-learned)
8. [Future Extensions](#8-future-extensions)
9. [Changelog](#9-changelog)

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

### Current Status (as of February 21, 2026)

| Brand | DB Status | Pipeline Mode | Presets Verified | Notes |
|-------|-----------|---------------|-----------------|-------|
| Stories That Stalk | ✅ Live | Image-based | `urban_legend`, `reddit_trending_horror`, `dark_origins` | Flagship brand. Full pipeline operational. |
| Decide This Daily | ✅ Live | Gameplay | `two_doors`, `one_rule_one_power`, `no_good_choice` | All 3 presets verified end-to-end. Gameplay pipeline required 5 bug fixes (see §7). |
| Confessions & Choices | ⏳ Planned | Gameplay | — | Overlaps significantly with Decide This Daily (see §2.1 note). |
| Would You Rather | ⏳ Planned | TBD | — | Not yet created in database. |
| All others | ⏳ Planned | Image-based | — | Phases 2-3. Blocked on Phase 1 exit criteria. |

> **Key finding:** The `brand_templates` table currently has 0 rows. Presets are determined by `vibe_preset` on the `jobs` table and the template JS files in `js/templates/`. This diverges from the roadmap's assumption that `brand_templates` is the single source of truth. Either populate `brand_templates` or update dependent systems to use the actual source.

### Assumptions

1. **Brand count is fixed at 10 for planning purposes.** The system supports unlimited brands, but this roadmap scopes the first 10 (9 original + Decide This Daily).
2. **TikTok and X/Twitter API access is currently unavailable.** Phase 1 brands targeting these platforms will post to available platforms first and add TikTok/X when API access is granted.
3. **Restoration Time Lapse is the highest-risk brand.** Multi-image consistency is an unsolved problem in the current pipeline. Phase 3 placement allows time for research.
4. **Cost estimates are based on current OpenAI and ElevenLabs pricing** and validated against production data from Decide This Daily and Stories That Stalk.
5. **Gameplay-mode brands require sourced/licensed gameplay footage.** Clips are stored externally; the pipeline downloads and trims them at render time. Clips can exceed 100MB — streaming download is required (see §7).
6. **All brands share the same Supabase project and edge functions.** No per-brand infrastructure separation is planned.

---

## 2. Brand Catalog

### 2.1 Confessions & Choices

> **⚠️ Overlap Note:** This brand concept overlaps significantly with **Decide This Daily** (§2.10), which is already live in production with 3 verified presets. Both use gameplay-background footage with moral dilemma narration. Before launching Confessions & Choices, decide whether to: (a) merge its presets into Decide This Daily, (b) differentiate by making Confessions confession-only (no dilemma voting mechanic), or (c) proceed as separate brands targeting different audience segments.

| Attribute | Value |
|-----------|-------|
| **Concept** | Gameplay-background confessions and moral dilemma narration. Viewer watches satisfying gameplay footage while listening to anonymous confessions or "what would you do" scenarios. |
| **Primary Platforms** | TikTok, YouTube Shorts, Instagram Reels |
| **Core Engagement Mechanic** | 💬 Replies + ⏱ Retention (confession hooks drive comments; gameplay holds attention) |
| **Content Generation** | Text narration over sourced/licensed gameplay footage. No AI image generation required. Uses **gameplay pipeline mode** (see §3). |

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

### 2.10 Decide This Daily

> **Status:** ✅ LIVE — All presets verified in production (February 21, 2026)

| Attribute | Value |
|-----------|-------|
| **Brand ID** | `45c229a5-e647-49d2-8912-d5fa24f66fda` |
| **Concept** | Moral dilemma and ethical choice narration over gameplay footage. Presents impossible decisions, impossible rules, or binary choices with no good answer. Viewer engagement driven by voting/commenting on choices. |
| **Primary Platforms** | TikTok, YouTube Shorts, Instagram Reels |
| **Core Engagement Mechanic** | 💬 Replies + ⏱ Retention (dilemma hooks drive debate; gameplay holds attention through narration) |
| **Content Generation** | Text narration + voice (ElevenLabs) + background music (Suno) + gameplay footage (sourced/trimmed). Uses **gameplay pipeline mode** (see §3). No AI image generation. |

**Presets (All Verified ✅):**

- `two_doors` — Binary choice dilemma. "Door A or Door B?" Visual preset: `ai_images_contrast` / cinematic-contrast. Presents two options with hidden consequences.
- `one_rule_one_power` — Rule/power tradeoff. "You get one power, but there's one rule." Visual preset: `ai_images_moody` / surreal-contemplative. Escalating stakes.
- `no_good_choice` — Moral dilemma with no good answer. "What would you do?" Visual preset: `forest` / editorial-clean. Uses gameplay mode (`gameplay_mode=true` in job meta). Minecraft clips verified working.

**Production Metrics (from verified test runs):**

| Metric | Value |
|--------|-------|
| Avg. audio duration | ~25s |
| Avg. word count | ~60 words |
| Gameplay clip source | Minecraft (configurable) |
| Pipeline steps | story → voice → music → subtitles → assemble (skips scenes + images) |
| Avg. cost per post | ~$0.15-0.25 (voice + music + render, no image generation) |

---

## 3. Pipeline Modes

The engine supports two distinct rendering pipelines. Each brand uses one mode exclusively — the mode is determined by the preset configuration and stored as `gameplay_mode` in `job.meta`.

### 3.1 Image-Based Pipeline (Default)

**Used by:** Stories That Stalk, Lego History, Lego Bible Verses, Lego Bible Stories, Restoration Time Lapse, Space Facts, Forgotten Things

**Steps:** `story → uniqueness → scenes → voice → music → images → subtitles → assemble → upload → schedule`

- AI generates scene descriptions, then `gpt-image-1` renders each scene as an image
- Images are composited into a video with voice, music, subtitles, and effects
- Cost driven primarily by image generation ($0.10-1.50 per post depending on image count)
- Finalization verifies all images are present before marking complete

### 3.2 Gameplay Pipeline

**Used by:** Decide This Daily, Confessions & Choices (planned), Would You Rather (planned)

**Steps:** `story → voice → music → subtitles → assemble → upload → schedule`

- Skips `uniqueness`, `scenes`, and `images` steps entirely
- Background video is sourced gameplay footage (e.g., Minecraft parkour), downloaded and trimmed to match audio duration
- Voice narration + subtitles overlay the gameplay footage
- Cost driven by voice + music generation only (~$0.15-0.25 per post)

**Key Technical Differences:**

| Aspect | Image-Based | Gameplay |
|--------|-------------|----------|
| `job.meta.gameplay_mode` | `false` / absent | `true` |
| Image generation | Required (gpt-image-1) | Skipped |
| Background video | Composited from images | Downloaded gameplay clip |
| Download size | Small (individual images) | Large (100MB+ video files) |
| Download method | Standard HTTP | Streaming (`pipe()` to disk) |
| Finalization check | Verifies all images present | Skips image check |
| FFmpeg trim | N/A | Trims gameplay to `audio_duration` with 5-min timeout |
| Render duration | ~1-3 min | ~2-5 min (larger files) |
| Continuation risk | Low | Higher (large file processing) |

**Gameplay Pipeline Safeguards (added February 2026):**

1. **FFmpeg trim timeout** — 5-minute SIGKILL timeout prevents FFmpeg hangs during gameplay clip trimming
2. **Explicit audio duration** — Worker sends `audio_duration` in render payload; renderer trims gameplay to match instead of defaulting to 60s
3. **Continuation limit** — Max 20 render continuation attempts (~60 min); job fails gracefully if exceeded
4. **Streaming download** — Gameplay clips downloaded via streaming (`responseType: 'stream'`) instead of in-memory buffer, avoiding OOM on large files
5. **Finalization bypass** — `verifyJobReadyForComplete()` skips image completeness check when `gameplay_mode=true`

---

## 4. Launch Phases

### Phase 1 — Foundation (Weeks 1-4)

> **Current Status:** 🟡 In Progress — 2 of 4 brands live. Pipeline validated for both image-based and gameplay modes.

**Goal:** Validate the full production pipeline end-to-end across multiple brands. Prove that scheduling, posting, metrics collection, and the learning loop work reliably at scale before adding complexity.

**Brands:**

| Brand | Status | Reason |
|-------|--------|--------|
| **Stories That Stalk** | ✅ Live | Already live. Full image-based pipeline proven. Serves as the control brand for all system comparisons. |
| **Decide This Daily** | ✅ Live | Gameplay pipeline validated. All 3 presets verified. Tests gameplay mode, reply-driven engagement, and dilemma-format retention. |
| **Confessions & Choices** | ⏳ Pending | Low cost (gameplay, no AI images). High volume possible. Reply-driven — tests confession-based learning signals. May merge into Decide This Daily (see §2.1 note). |
| **Would You Rather** | ⏳ Pending | Lowest production cost. Pure text generation. Reply-farming mechanic tests engagement-driven metadata optimization fastest. |

**Why these brands first:**

1. **Stories That Stalk** is already operational — zero additional setup cost. It continues generating data for the learning loop.
2. **Decide This Daily** proved the gameplay pipeline viable and exposed 5 critical bugs that were fixed before any other gameplay brand can launch (see §7).
3. **Confessions & Choices** and **Would You Rather** require only text generation + sourced video backgrounds. No image pipeline dependency. Near-zero incremental API cost per video.
4. All four brands target different engagement mechanics (retention, replies, shares), so the strategy system and metadata learning loop get diverse training signals from day one.

**Target Posting Cadence:**

| Brand | Phase 1 Target | Scale Target | Notes |
|-------|---------------|-------------|-------|
| Stories That Stalk | 1/day | 2-3/day | Limited by image generation cost |
| Decide This Daily | 1/day | 2-3/day | Limited by gameplay clip variety |
| Confessions & Choices | 1-2/day | 3-4/day | Low cost enables higher volume |
| Would You Rather | 2-3/day | 4-6/day | Lowest cost; volume-first strategy |

**System Learns:**

- Multi-brand scheduling reliability (4 brands, different cadences)
- Gameplay vs. image-based pipeline cost comparison
- Cross-brand cost tracking accuracy
- Reply-driven vs. retention-driven posting time optimization
- Strategy selection with real A/B data across engagement types
- Winning patterns divergence between brand types

**Exit Criteria:**

- [x] Image-based pipeline validated end-to-end (Stories That Stalk)
- [x] Gameplay pipeline validated end-to-end (Decide This Daily)
- [ ] All 4 brands posting on schedule for 7+ consecutive days
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

## 5. Platform Strategy Summary

### Platform Prioritization by Brand

| Brand | YouTube Shorts | Instagram Reels | TikTok | Facebook Reels | Threads | X |
|-------|:-:|:-:|:-:|:-:|:-:|:-:|
| **Decide This Daily** | ● | ● | ★ | ○ | ○ | ○ |
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

**TikTok-first brands** (Decide This Daily, Confessions, Would You Rather, Space Facts):
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
| **Brands** | Decide This Daily, Confessions, Would You Rather, Space Facts | Stories That Stalk, Lego History, Lego Bible Stories, Restoration |
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

## 6. Expansion Rules

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

**Cost tiers (updated with production data):**

| Tier | Cost Profile | Brands | Notes |
|------|-------------|--------|-------|
| **Tier 1: Text + Gameplay** | ~$0.15-0.25 per post | Decide This Daily, Confessions & Choices, Would You Rather | Voice (ElevenLabs) + music (Suno) + render. No image generation. Original estimate of $0.01-0.03 was text-only and did not account for voice/music. |
| **Tier 2: Text + Images** | ~$0.10-0.30 per post | Lego History, Lego Bible Verses, Space Facts, Forgotten Things | Image generation is primary variable cost. |
| **Tier 3: Full Pipeline** | ~$0.30-0.80 per post | Stories That Stalk, Lego Bible Stories | Voice + music + multi-image + effects. |
| **Tier 4: Multi-Image Sequence** | ~$0.50-1.50 per post | Restoration Time Lapse | 4-6 images with consistency requirements. Highest cost tier. |

---

## 7. Technical Risks & Lessons Learned

### Known Infrastructure Risks

| Risk | Severity | Affected Brands | Mitigation |
|------|----------|-----------------|------------|
| **Renderer in-memory job storage** | P1 | All brands | Render.com restarts lose all in-flight render jobs. Jobs stuck mid-render will fail on continuation timeout. **Mitigation:** Continuation limit (20 attempts) catches this. **Future fix:** Persist render job state to Redis or Supabase. |
| **Free-tier RAM limits** | P2 | Gameplay brands | Render.com free tier has 512MB RAM. Large gameplay clips (700s+ video) may cause OOM during FFmpeg processing. **Mitigation:** Streaming download avoids loading full file into memory. **Future fix:** Upgrade to paid Render tier or add clip length validation. |
| **Gameplay clip sourcing** | P2 | Decide This Daily, Confessions & Choices | Currently using a small set of Minecraft clips. Repeated clips across videos will be noticed by audiences. **Future fix:** Build clip library with variety (multiple games, perspectives). |
| **Image consistency across frames** | P1 | Restoration Time Lapse | AI cannot reliably generate the same object at different restoration stages. This is an unsolved problem. **Mitigation:** Phase 3 placement allows time for research. |
| **ElevenLabs rate limits** | P2 | All voiced brands | High-volume posting may hit ElevenLabs API rate limits. **Mitigation:** Retry logic in worker. **Future fix:** Voice caching for re-renders. |
| **Supabase Edge Function timeout** | P2 | All brands | Edge functions have a 150s execution limit. Complex pipeline steps use continuation patterns to work around this. **Mitigation:** Continuation tracking with max attempts. |

### Lessons Learned from Production (February 2026)

These bugs were discovered and fixed during Decide This Daily gameplay pipeline validation:

| # | Bug | Root Cause | Fix | Commit | Files Modified |
|---|-----|-----------|-----|--------|----------------|
| 1 | FFmpeg gameplay trim hung forever | No timeout on FFmpeg `spawn()` for gameplay clip trimming | Added 5-minute SIGKILL timeout pattern | `e4d10bf` | `video-renderer/server.js` |
| 2 | Gameplay trimmed to 60s instead of audio length | Worker sent `durations: []` for gameplay; renderer defaulted to 60s | Added explicit `audio_duration` field to render payload | `e4d10bf` | `steps.ts`, `server.js` |
| 3 | Infinite continuation loop | No max continuation attempts on render polling | Added `render_continuation_count` in `job.meta` with MAX=20 | `e4d10bf` | `steps.ts` |
| 4 | Gameplay download OOM / size rejection | `downloadFile()` used `arraybuffer` with 100MB `maxContentLength` | Rewrote to streaming download (`pipe()` to `createWriteStream`) | `be86228` | `server.js` |
| 5 | Finalization rejected completed gameplay jobs | `verifyJobReadyForComplete()` required images even for gameplay mode | Added `gameplay_mode` check to skip image verification | `398adab` | `helpers.ts` |

**Pattern:** Bugs 1-3 were timeout/loop issues (no safety nets). Bugs 4-5 were mode-awareness issues (code assumed image-based pipeline). New pipeline modes should be tested with the same rigor before production use.

### Operational Runbook

**When a job gets stuck:**

1. Check job status: `GET /rest/v1/jobs?id=eq.<job_id>&select=status,current_step,error,updated_at`
2. If `updated_at` is >30 min old and `status=processing`, the job is stuck
3. Mark as failed: `PATCH /rest/v1/jobs?id=eq.<job_id>` with `{"status":"failed"}`
4. To retry: `PATCH` with `{"status":"queued","current_step":"<last_good_step>"}`, then invoke `POST /functions/v1/schedule-jobs` with `{"source":"manual"}`

**When the renderer is unresponsive:**

1. Check health: `GET https://faceless-renderer.onrender.com/health`
2. If no response, the free-tier instance has spun down — any request will cold-start it (~30s)
3. If health returns but jobs fail, check Render.com dashboard for OOM or crash logs
4. To force redeploy: `git push` to the repo (Render.com auto-deploys on push)

**When deploying changes:**

| Target | Command |
|--------|---------|
| Worker (Supabase Edge Function) | `npx -y supabase functions deploy worker-v1 --no-verify-jwt --project-ref ustmetegzisztqqcjigt` |
| DB migrations | `npx -y supabase db push --linked -p "<db_password>" --include-all --yes` |
| Video renderer | `git push` (auto-deploys on Render.com) |

### Failure Recovery Plan

| Scenario | Response |
|----------|----------|
| Brand failure rate >50% for 24h | Pause brand campaigns. Investigate last successful job vs. first failing job. Check for API key expiry, rate limits, or renderer issues. |
| Cost exceeds daily budget | Automatic throttle via cost controls system. If global budget exceeded, all campaigns pause. Investigate which brand/preset is over-spending. |
| Phase exit criteria unachievable | Extend phase timeline by 2 weeks. If still blocked after extension, evaluate whether the blocking criterion is realistic and adjust threshold. |
| Renderer crash loop | Switch to backup renderer URL if available. Otherwise, all assemble steps will fail gracefully via continuation timeout. Jobs can be retried after renderer recovery. |

---

## 8. Future Extensions

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

> **Note:** The Visual Roadmap Page UI specification has been moved to a separate document: `docs/BRAND_ROADMAP_UI_SPEC.md`. It contains the full page layout, component specs, interaction design, data requirements, and `brand_roadmap_config` table schema.

---

## 9. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2026-02-21 | Added Decide This Daily (brand 2.10) as live production brand. Added Pipeline Modes section (§3) documenting image-based vs. gameplay pipelines. Updated Phase 1 with live status, DTD inclusion, posting cadence targets. Updated cost tiers with production data. Added Technical Risks & Lessons Learned (§7) with 5 bug fixes, operational runbook, and failure recovery plan. Added Assumptions and Current Status to Overview. Annotated Confessions & Choices with DTD overlap note. Moved UI spec to separate file. |
| 1.0 | 2026-02-19 | Initial version. 9 brands across 3 phases. Platform strategy, expansion rules, future extensions, and visual roadmap page specification. |
