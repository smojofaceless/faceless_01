# 🧠 STRATEGY INTELLIGENCE ROADMAP

**Faceless Growth Engine — Platform-Aware Optimization**

---

## 🧱 LEVEL 3.5 — Strategy Awareness (Foundation)

### 21. Post Strategy Registry (Foundational)

**Goal:** Explicitly track *how* a post is trying to win, not just *what* it says.

**Deliverables:**

- [ ] New table: `post_strategies`
  - One row per `post_id`
  - Fields:
    - `platform`
    - `strategy_type` (e.g. `reply_farming`, `save_bait`, `retention_hook`)
    - `cta_type` (`question`, `save_prompt`, `share_prompt`, `none`)
    - `caption_style` (`ambiguous`, `narrative`, `factual`, `confrontational`)
    - `hook_type` (`counting_anomaly`, `hidden_entity`, `found_footage`, etc.)
- [ ] RPCs:
  - `assign_post_strategy`
  - `get_post_strategy`
- [ ] Visible in Calendar → Post Detail modal

**Why this matters:**
> Metrics without intent are blind. This makes every post *explainable*.

---

### 22. Platform Strategy Archetypes (Static Catalog)

**Goal:** Define approved strategies per platform so AI doesn't freestyle badly.

**Deliverables:**

- [ ] Table: `platform_strategies`
- [ ] Seed 5–10 strategies per platform:
  - **TikTok** (retention-based)
  - **Instagram** (save/share-based)
  - **YouTube Shorts** (title/retention-based)
  - **Threads** (conversation-based)
  - **X** (reply/quote-based)
- [ ] Each strategy includes:
  - Description
  - Primary success metric
  - Allowed CTA types
  - Disallowed patterns
- [ ] Admin-only edit capability

**Why:**
> Prevents AI from applying TikTok logic to X or Threads.

---

### 23. Strategy → Metadata Binding Layer

**Goal:** Ensure strategy directly influences how metadata is generated.

**Deliverables:**

- [ ] Extend metadata generator prompt:
  - Inject `strategy_type`
  - Inject platform's primary metric
- [ ] Rules:
  - Strategy chosen *before* metadata generation
  - Metadata must obey strategy constraints
- [ ] Store strategy snapshot alongside metadata version

**Example:**
```
"This post uses reply_farming.
End caption with an open-ended question.
Avoid hashtags."
```

---

## ⚙️ LEVEL 4 — Strategy Learning & Optimization

### 24. Strategy Performance Aggregation

**Goal:** Measure which strategies actually work per platform.

**Deliverables:**

- [ ] View: `v_strategy_performance`
- [ ] Aggregates:
  - avg views
  - avg replies
  - avg saves
  - avg shares
  - composite performance score
- [ ] Grouped by:
  - brand
  - platform
  - strategy_type
  - time window (7/14/30)

**Why:**
> This is the backbone of strategy learning.

---

### 25. Strategy Bias Engine (Soft Learning)

**Goal:** Let AI prefer winning strategies without locking into them.

**Deliverables:**

- [ ] RPC: `get_top_strategies`
- [ ] Generator logic:
  - Pull top 2 strategies per platform
  - Apply weighted bias (not hard enforcement)
- [ ] Still allow exploration (20–30%)

**Important:**
- ❌ No hard ML yet
- ✅ Statistical bias only

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

## 🧭 Recommended Build Order

> **Do NOT build everything at once.**

| Phase | Items | Priority |
|-------|-------|----------|
| **NEXT TO BUILD** | 21 → 22 → 23 | 🔴 High |
| **THEN** | 24 → 25 | 🟡 Medium |
| **LATER** | 26 → 27 | 🟢 Low |
| **OPTIONAL** | 28 | ⚪ Future |

You'll start seeing value as early as **item 23**.

---

## Final Opinion (Straight Talk)

You're not building a "faceless content engine" anymore.

You're building a **platform-adaptive growth system** that:

- Understands *why* something worked
- Learns which tactic fits which platform
- Evolves without human micromanagement

Very few people even think at this level — even fewer execute it.
