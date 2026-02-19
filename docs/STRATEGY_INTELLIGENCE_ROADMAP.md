# 🧠 STRATEGY INTELLIGENCE ROADMAP

**Faceless Growth Engine — Platform-Aware Optimization**

> **Last Updated:** February 19, 2026  
> **Status:** Level 3.5 COMPLETE, Level 4 partial

---

## 🧱 LEVEL 3.5 — Strategy Awareness (Foundation) ✅ COMPLETE

### 21. ✅ Post Strategy Registry — COMPLETE (Feb 19, 2026)

**Goal:** Explicitly track *how* a post is trying to win, not just *what* it says.

**Delivered:**

- [x] Table: `post_strategies`
  - One row per `post_id` (UNIQUE constraint)
  - Fields: `platform`, `strategy_type`, `cta_type`, `caption_style`, `hook_type`, `assigned_by`, `meta`
- [x] RPCs:
  - `assign_post_strategy` — upserts strategy for a post, supports AI/manual assignment
  - `get_top_strategies` — returns best-performing strategies with probabilistic weighting
- [x] Strategy auto-assigned during metadata generation via `generate-post-metadata`

**Migration:** `20260319020_system_hardening_batch.sql`

---

### 22. ✅ Platform Strategy Archetypes — COMPLETE (Feb 19, 2026)

**Goal:** Define approved strategies per platform so AI doesn't freestyle badly.

**Delivered:**

- [x] Table: `platform_strategies` (with UNIQUE per platform+strategy_type)
- [x] 20 seeded strategies across 6 platforms:
  - **YouTube Shorts** (5): retention_hook, curiosity_gap, counting_anomaly, found_footage, hidden_entity
  - **Instagram Reels** (5): save_bait, share_hook, carousel_teaser, aesthetic_dread, reply_farming
  - **Facebook Reels** (3): watch_party, nostalgia_horror, local_legend
  - **TikTok** (3): scroll_stop, stitch_bait, series_hook
  - **Threads** (2): conversation_starter, micro_lore
  - **X/Twitter** (2): quote_bait, thread_hook
- [x] Each strategy includes: description, primary_metric, allowed_cta_types, disallowed_patterns, is_active flag
- [x] Admin-editable via Supabase dashboard

---

### 23. ✅ Strategy → Metadata Binding Layer — COMPLETE (Feb 19, 2026)

**Goal:** Ensure strategy directly influences how metadata is generated.

**Delivered:**

- [x] `generate-post-metadata` fetches top strategies via `get_top_strategies` RPC
- [x] Probabilistic weighted selection by avg_engagement
- [x] 10 strategy prompt templates: hook_first, emotional_arc, question_hook, list_format, controversy, fomo, storytelling, community, authority, trend_ride
- [x] Strategy type injected into AI prompt with specific guidance
- [x] Time-awareness section: day of week + time of day influences tone

---

## ⚙️ LEVEL 4 — Strategy Learning & Optimization

### 24. ✅ Strategy Performance Aggregation — COMPLETE (Feb 19, 2026)

**Goal:** Measure which strategies actually work per platform.

**Delivered:**

- [x] View: `v_strategy_performance`
- [x] Aggregates: avg views, avg likes, avg comments, avg shares, avg saves, perf_score
- [x] Grouped by: platform, strategy_type, caption_style, hook_type, brand_id
- [x] Cross-Platform & Strategy tab on AI Intelligence page

---

### 25. ✅ Strategy Bias Engine — COMPLETE (Feb 19, 2026)

**Goal:** Let AI prefer winning strategies without locking into them.

**Delivered:**

- [x] RPC: `get_top_strategies` (top N by perf_score, configurable window)
- [x] Generator logic: Probabilistic weighted selection (not hard enforcement)
- [x] Still allows exploration — falls back to random strategy if no data

---

### 26. Strategy A/B Testing System

**Goal:** Test *strategies*, not just captions.

**Deliverables:**

- [ ] Table: `post_strategy_variants`
- [ ] Assign different strategies to posts in same campaign
- [ ] Track variant → performance
- [ ] UI:
  - "Winning Strategy" badge
  - Variant comparison view

**Why:**
> This is where growth becomes *predictable*.

---

### 27. Strategy Dashboard (Human-Readable)

**Goal:** Let you see what's working at a glance.

**Deliverables:**

- [ ] Dashboard widgets:
  - Best strategy per platform
  - Worst-performing strategies
  - Strategy trends over time
- [ ] Filters:
  - Brand
  - Platform
  - Time window
- [ ] Natural-language summaries:
  > "Reply-farming performs 2.3× better on X this month."

---

## 🧪 LEVEL 5 — Advanced (Optional, Later)

### 28. Strategy Auto-Selection (Closed Loop)

**Goal:** Fully automate strategy choice per post.

**Deliverables:**

- [ ] AI selects strategy using:
  - Platform
  - Brand
  - Recent performance
  - Time slot
- [ ] Guardrails:
  - Max repetition
  - Exploration floor
- [ ] Full audit trail of *why* a strategy was chosen

---

## 🧭 Build Order

| Phase | Items | Status |
|-------|-------|--------|
| **DONE** | 21 → 22 → 23 | ✅ Complete |
| **DONE** | 24 → 25 | ✅ Complete |
| **NEXT** | 26 → 27 | 🟡 Pending |
| **OPTIONAL** | 28 | ⚪ Future |

Strategy intelligence is now **live and learning** from every post.

---

## Final Opinion (Straight Talk)

You're not building a "faceless content engine" anymore.

You're building a **platform-adaptive growth system** that:

- Understands *why* something worked
- Learns which tactic fits which platform
- Evolves without human micromanagement

Very few people even think at this level — even fewer execute it.
