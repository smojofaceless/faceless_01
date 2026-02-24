# Visual Roadmap Page Specification

> **Extracted from:** BRAND_ROADMAP.md v1.0  
> **Page:** `/pages/brand-roadmap.html`  
> **CSS:** `/css/brand-roadmap.css`  
> **JS:** `/js/pages/brand-roadmap.js`  
> **Status:** Specification Only (no implementation)

---

## Page Purpose

A single admin dashboard page that visualizes brand progression, launch status, and system learning across all phases. Replaces the need to read the BRAND_ROADMAP.md document for day-to-day operational decisions.

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

**AI Intelligence summary sub-section:**

```
AI Intelligence (from AI Intelligence page)
├── IQ Score:          72 / 100  (9-dimension breakdown)
├── Learning Accel.:   ↑ +14% (age-normalized, mature posts only)
├── 8-Week Projection: IQ 78 → 85
├── Active Gaps:       2 HIGH, 1 MEDIUM
├── Top Vibe:          urban_legend (perf: 847)
├── Platform Depth:    YT 139 avg │ IG 90 avg │ FB 1 avg
└── Caption Tuning:    FB capped at 125 chars (v2.1)
```

> **Cross-reference:** Per-platform data originates from the AI Intelligence page (`/js/pages/ai-intelligence.js`). The Learning Acceleration metric only compares posts older than 7 days (`MATURITY_DAYS`) to avoid metrics-recency bias. Facebook Reels captions were tightened to 125 chars (prompt) / 300 chars (post-worker hard cap) in v2.1 of the Post Metadata System — see `POST_METADATA_SYSTEM.md`.

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
