# Campaign System Architecture & Scheduling Design

> **Document Version:** 2.4  
> **Last Updated:** February 8, 2026  
> **Author:** System Architect  
> **Status:** ✅ V1 COMPLETE (with Job Scheduler + Claim/Lease System)

---

## Change Log

| Date | Version | Changes |
|------|---------|--------|
| Feb 8, 2026 | 2.4 | UI compatibility fixes: schedule preview, brand loading, campaign detail page |
| Feb 8, 2026 | 2.3 | Job Claim + Lease system integrated: atomic claims, heartbeat, stale sweeper |
| Feb 8, 2026 | 2.2 | Status canonicalization: `pending` is canonical not-started; `queued` for backwards compatibility |
| Feb 10, 2026 | 2.1 | Added Job Scheduler - automatic job triggering based on `generate_by` time |
| Feb 10, 2026 | 2.0 | **V1 IMPLEMENTED** - UI, RPCs, scheduling, all delivered. Worker gating pending. |
| Feb 8, 2026 | 1.2 | Added DB-driven configuration note (brand_templates is source of truth) |
| Feb 8, 2026 | 1.1 | Added "Preset Immutability" invariant (Gap 2 clarification) |
| Feb 8, 2026 | 1.1 | Added `schedule_seed` recommendation (Gap 3: deterministic randomness) |
| Feb 8, 2026 | 1.1 | Added "Metrics Feedback Boundary" rule (Gap 4 clarification) |
| Feb 8, 2026 | 1.1 | Added Section 8.7 "Story Uniqueness Collision Handling" (Gap 5 clarification) |
| Feb 8, 2026 | 1.0 | Initial document |

---

## Implementation Status (V1)

| Component | Status | Location |
|-----------|--------|----------|
| Campaign Creation UI | ✅ Done | `/pages/campaign.html`, `/js/pages/campaign.js` |
| Campaign Detail UI | ✅ Done | `/pages/campaign-detail.html`, `/js/pages/campaign-detail.js` |
| Campaign Manager Service | ✅ Done | `/js/services/campaignManager.js` |
| Campaign CSS | ✅ Done | `/css/campaign.css` |
| `create_campaign` RPC | ✅ Done | `20260210_campaign_system_v1.sql`, `20260211_job_scheduler.sql` |
| `update_campaign_status` RPC | ✅ Done | `20260210_campaign_system_v1.sql` |
| `get_campaign_summary` RPC | ✅ Done | `20260210_campaign_system_v1.sql` |
| DB Schema (batches, jobs) | ✅ Done | `20260210_campaign_system_v1.sql` |
| **Job Scheduler** | ✅ Done | `supabase/functions/schedule-jobs/` |
| **`generate_by` Column** | ✅ Done | `20260211_job_scheduler.sql` |
| **Scheduler RPCs** | ✅ Done | `find_eligible_jobs`, `claim_job`, `release_job` |
| **Job Claim + Lease** | ✅ Done | `20260219_job_claim_lease_system.sql` |
| **Stale Job Sweeper** | ✅ Done | `sweep_stale_jobs` RPC |
| **run-job Integration** | ✅ Done | Heartbeat, release on complete/fail |
| Sidebar Integration | ✅ Done | All admin pages have Campaigns link |
| BrandSwitcher Integration | ✅ Done | Navbar brand dropdown functional |
| Smoke Tests | ✅ Done | `/docs/CAMPAIGN_SMOKE_TESTS.md` |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Context & Constraints](#2-system-context--constraints)
3. [Campaign Concept](#3-campaign-concept)
4. [Campaign UI Design](#4-campaign-ui-design)
5. [Scheduling Logic](#5-scheduling-logic)
6. [Database Behavior](#6-database-behavior)
7. [Worker Interaction](#7-worker-interaction)
8. [Failure, Control & Safety](#8-failure-control--safety)
9. [Future Evolution](#9-future-evolution)
10. [Appendix: Glossary & Reference](#10-appendix-glossary--reference)

---

## 1. Executive Summary

### Purpose

The **Campaign System** is a planning layer that sits above the existing job-based video generation pipeline. It enables batch scheduling of multiple videos with intelligent time distribution, while delegating all actual generation work to existing workers.

### Core Principle

**Campaigns PLAN. Workers EXECUTE.**

A Campaign is essentially a "work order" that:
- Creates N jobs immediately (synchronously)
- Pre-computes `scheduled_post_at` for each job
- Writes everything to the database in one transaction
- Returns control to the user instantly
- Never touches OpenAI, ElevenLabs, FFmpeg, or any generation API

### Why This Architecture?

| Concern | Solution |
|---------|----------|
| Avoid wasted API spend | Jobs are scheduled first; generation happens only when needed |
| Predictable capacity | Workers process jobs at their own pace |
| Failure isolation | One failed job doesn't affect others in the campaign |
| Schedule visibility | All post times are known before any generation starts |
| User experience | Campaign creation is instant (< 1 second) |

---

## 2. System Context & Constraints

### 2.1 Existing Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CURRENT SYSTEM                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐                 │
│   │  brands  │───▶│   jobs   │───▶│  posts   │                 │
│   └──────────┘    └──────────┘    └──────────┘                 │
│        │               │               │                        │
│        ▼               ▼               ▼                        │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐                 │
│   │ templates│    │job_assets│    │analytics │                 │
│   └──────────┘    └──────────┘    └──────────┘                 │
│                                                                 │
│   ┌─────────────────────────────────────────────┐              │
│   │              WORKERS (Edge Functions)        │              │
│   │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │              │
│   │  │story│▶│image│▶│voice│▶│music│▶│assem│   │              │
│   └─────────────────────────────────────────────┘              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Immutable Constraints

These constraints MUST be respected by the Campaign System:

1. **One Job = One Video**
   - A job produces exactly one video asset
   - Jobs are the atomic unit of work
   - Jobs cannot be split or merged

2. **Workers Process Jobs Independently**
   - Workers pull jobs from a queue
   - Workers process one job at a time (per worker instance)
   - Workers are stateless and idempotent
   - Parallelism exists INSIDE jobs (e.g., parallel image generation), not across jobs

3. **Scheduling is Per-Job**
   - Each job has exactly ONE `scheduled_post_at` timestamp
   - Platform-specific posting inherits from job time + offset
   - The same video can post to multiple platforms with time offsets

4. **Admin-Only System**
   - No customer-facing UI or API
   - No multi-tenancy concerns
   - No rate limiting for the admin user
   - Trust the operator

5. **Existing Tables Must Be Respected**
   - `generation_batches` exists and can represent campaigns
   - `jobs` table is the source of truth for work items
   - `posts` table tracks per-platform posting
   - Schema changes should be additive, not destructive

### 2.3 Current Gaps (What Campaign System Solves)

| Gap | Current State | Campaign Solution |
|-----|---------------|-------------------|
| Batch planning | Manual job creation | Auto-create N jobs |
| Schedule distribution | Random or manual | Intelligent time slots |
| Platform coordination | Ad-hoc | Systematic offsets |
| Visibility | No aggregate view | Campaign dashboard |
| Control | Job-by-job | Campaign-level pause/resume |

---

## 3. Campaign Concept

### 3.1 Definition

A **Campaign** is a logical grouping of jobs that share:
- A common brand
- A common creation intent (e.g., "horror content for February")
- A coordinated posting schedule
- Shared configuration parameters

A Campaign is **NOT**:
- A generation engine
- A scheduler daemon
- A content template
- A platform-specific construct

### 3.2 Campaign Lifecycle

```
┌──────────────────────────────────────────────────────────────────────┐
│                      CAMPAIGN LIFECYCLE                               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐          │
│   │ DRAFT   │───▶│ PLANNED │───▶│ ACTIVE  │───▶│COMPLETE │          │
│   └─────────┘    └─────────┘    └─────────┘    └─────────┘          │
│       │              │              │              │                  │
│       │              │              │              │                  │
│   User fills     Jobs created   Workers pick   All jobs done         │
│   form inputs    in database    up jobs        (success/fail)        │
│                  with schedule                                        │
│                                                                       │
│   ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│                                                                       │
│   ALTERNATIVE PATHS:                                                  │
│                                                                       │
│   ┌─────────┐    ┌─────────┐                                         │
│   │ PAUSED  │◀──▶│ ACTIVE  │  (bidirectional - can pause/resume)    │
│   └─────────┘    └─────────┘                                         │
│                                                                       │
│   ┌─────────┐                                                        │
│   │CANCELLED│  (terminal state - unprocessed jobs are cancelled)     │
│   └─────────┘                                                        │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.3 Campaign States

| State | Description | Transitions To |
|-------|-------------|----------------|
| `draft` | UI form is being filled, not yet submitted | `planned`, (discard) |
| `planned` | Jobs created, waiting for first worker pickup | `active`, `paused`, `cancelled` |
| `active` | At least one job has started processing | `paused`, `complete`, `cancelled` |
| `paused` | Workers skip jobs in this campaign | `active`, `cancelled` |
| `complete` | All jobs finished (success or permanent failure) | (terminal) |
| `cancelled` | Campaign was aborted; unstarted jobs marked cancelled | (terminal) |

### 3.4 What Campaign Creation Does

When the user clicks "Create Campaign", the system performs these steps **synchronously** (in a single request):

```
1. VALIDATE inputs
   ├── Brand exists and is active
   ├── Platform tokens are valid
   ├── Date range is in the future
   └── Video count is reasonable (1-100)

2. COMPUTE schedule
   ├── Distribute N videos across date range
   ├── Assign time windows (12pm / 6pm EST)
   ├── Apply jitter within windows
   └── Calculate platform offsets

3. CREATE campaign record
   └── Insert into generation_batches

4. CREATE job records
   ├── Insert N rows into jobs table
   ├── Each job has scheduled_post_at
   ├── Each job references campaign
   └── All jobs start in 'pending' status

5. RETURN to user
   └── Campaign ID + summary (< 1 second total)
```

**Critical**: Steps 3-4 should be in a database transaction to ensure atomicity.

### 3.5 What Campaign Creation Does NOT Do

- ❌ Generate stories
- ❌ Generate images
- ❌ Generate audio
- ❌ Call OpenAI, ElevenLabs, or any external API
- ❌ Upload anything to storage
- ❌ Create posts (posts are created when jobs complete)
- ❌ Wait for any async operation

---

## 4. Campaign UI Design

### 4.1 Page Structure

The Campaign UI (`/pages/campaign.html`) follows the existing admin panel aesthetic and consists of:

```
┌─────────────────────────────────────────────────────────────────────┐
│  CAMPAIGN CREATION                                          [?] Help │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  MODE TOGGLE                                                    │ │
│  │  ┌─────────────┐  ┌─────────────┐                              │ │
│  │  │ ◉ AUTO MODE │  │ ○ ADVANCED  │                              │ │
│  │  └─────────────┘  └─────────────┘                              │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────┐  ┌─────────────────────────────────┐  │
│  │  REQUIRED INPUTS        │  │  SCHEDULE PREVIEW               │  │
│  │                         │  │                                  │  │
│  │  Brand: ● Stories That  │  │  ┌──────────────────────────┐   │  │
│  │         Stalk (horror)  │  │  │                          │   │  │
│  │         [from navbar]   │  │  │                          │   │  │
│  │                         │  │  │ Feb 10 │ 12:04 PM │ YT+IG │   │  │
│  │  Videos: [  7  ]        │  │  │ Feb 10 │  6:12 PM │ YT+IG │   │  │
│  │                         │  │  │ Feb 11 │ 12:18 PM │ YT+IG │   │  │
│  │  Platforms:             │  │  │ Feb 11 │  5:47 PM │ YT+IG │   │  │
│  │  ☑ YouTube Shorts       │  │  │ Feb 12 │ 12:31 PM │ YT+IG │   │  │
│  │  ☑ Instagram Reels      │  │  │ Feb 12 │  6:22 PM │ YT+IG │   │  │
│  │  ☐ TikTok               │  │  │ Feb 13 │ 11:55 AM │ YT+IG │   │  │
│  │                         │  │  └──────────────────────────┘   │  │
│  │  Start Date: [Feb 10]   │  │                                  │  │
│  │                         │  │  7 videos over 7 days            │  │
│  │  Posts/Day: [ 1 ▼]      │  │  Avg 1/day                       │  │
│  │                         │  │                                  │  │
│  └─────────────────────────┘  └─────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  [  PREVIEW SCHEDULE  ]        [  CREATE CAMPAIGN  ]           │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Auto Mode (Default)

Auto Mode is designed for the common case: "I want to post regularly without thinking about it."

#### Required Inputs (Auto Mode)

| Input | Type | Default | Notes |
|-------|------|---------|-------|
| Brand | Read-only display | Current navbar selection | Uses active brand context (see [BRAND_SELECTION.md](./BRAND_SELECTION.md)) |
| Number of Videos | Number input | 7 | Range: 1-100 |
| Platforms | Checkboxes | All enabled | At least one required |
| Start Date | Date picker | Tomorrow | Cannot be in the past |
| Posts per Day | Dropdown | 1 | Options: 1, 2, 3 (2/day is long-term goal) |

> **Note**: The campaign page does NOT include a brand dropdown. Instead, it reads from the **current brand context** set via the navbar brand switcher. This ensures consistency across all pages and prevents accidentally creating campaigns for the wrong brand. The brand name and color indicator are displayed as read-only information.

> **Preset Immutability Invariant**: The `vibe_preset` assigned to each job is decided **once** during campaign creation (based on weighted random selection) and is then **immutable**. Workers executing the job **must** use `jobs.vibe_preset`—they cannot re-draw or override it. This ensures reproducibility: the same campaign creation inputs with the same seed will always produce the same preset distribution.

#### Auto Mode Defaults

When in Auto Mode, these values are automatically determined:

| Parameter | Auto Value | Reasoning |
|-----------|------------|-----------|
| Time Windows | 12:00 PM, 6:00 PM EST | Peak engagement times for short-form content |
| Window Jitter | ±30 minutes | Prevents predictability, appears organic |
| Platform Offset | 0-90 minutes | Staggers cross-posting, avoids simultaneous uploads |
| Preset Weights | Brand defaults | Uses `brand_templates.weight` (DB source of truth) |
| Timezone | EST (America/New_York) | Consistent baseline; locked for V1 |

> **DB-Driven Configuration:** Preset weights are stored in the `brand_templates` table, not hardcoded. Each brand has its own templates with weights (e.g., Horror Stories: urban_legend 60%, one_too_many 40%). See [DNA_AND_DB_OPTION1_IMPLEMENTATION_PLAN.md](DNA_AND_DB_OPTION1_IMPLEMENTATION_PLAN.md).

> **V1.1 Enhancement Recommendation**: Add optional `schedule_seed` field to `generation_batches` configuration. When provided, all random decisions (time jitter, window selection, preset assignment) are derived from this seed via a PRNG. This enables:
> - **Reproducibility**: Re-running campaign creation with same inputs + same seed = identical schedule
> - **Debugging**: Support can reproduce exact schedule a user saw
> - **Testing**: Deterministic test cases for scheduling logic

#### Auto Mode Behavior

1. User selects brand, video count, platforms, start date, posts/day
2. System computes schedule immediately (client-side preview)
3. User sees preview panel update in real-time
4. User clicks "Create Campaign"
5. Campaign and jobs are created in < 1 second
6. User is redirected to campaign detail page

### 4.3 Advanced Mode

Advanced Mode reveals additional controls for power users who want fine-grained control.

#### Additional Inputs (Advanced Mode Only)

| Input | Type | Default | Notes |
|-------|------|---------|-------|
| Time Window A | Time picker | 12:00 PM | First daily posting window |
| Time Window B | Time picker | 6:00 PM | Second daily posting window (optional) |
| Window Jitter | Range slider | ±30 min | 0-60 minute range |
| Platform Offsets | Per-platform sliders | | e.g., YouTube: 0 min, Instagram: +15 min |
| Preset Weights | Weight sliders | | Override brand default preset distribution |
| Window Weighting | Dropdown | Alternate | "Alternate", "Prefer A", "Prefer B", "Random" |
| Video Duration | Range selector | 60-90 sec | Target video length (affects story pacing) |
| Generation Lead Time | Number input | 24 hours | How far ahead workers should generate |

#### Advanced Mode UI Extension

```
┌─────────────────────────────────────────────────────────────────────┐
│  ADVANCED OPTIONS (expanded)                                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  TIME WINDOWS                           PLATFORM OFFSETS             │
│  ┌───────────────────────────────┐     ┌───────────────────────────┐│
│  │ Window A: [ 12:00 PM ▼]       │     │ YouTube:   [  0 min ]     ││
│  │ Window B: [  6:00 PM ▼]       │     │ Instagram: [ 15 min ]     ││
│  │           ☑ Enable Window B   │     │ TikTok:    [ 45 min ]     ││
│  │                               │     │                           ││
│  │ Jitter:   [──●──────] ±30min  │     │ Max offset: 90 min        ││
│  └───────────────────────────────┘     └───────────────────────────┘│
│                                                                      │
│  WINDOW DISTRIBUTION                   PRESET WEIGHTS                │
│  ┌───────────────────────────────┐     ┌───────────────────────────┐│
│  │ ○ Alternate (A, B, A, B...)   │     │ urban_legend:  [────●─] 60%│
│  │ ◉ Weighted (60% A, 40% B)     │     │ one_too_many:  [───●──] 40%│
│  │ ○ Random                      │     │                           ││
│  │                               │     │                           ││
│  │ A Weight: [────●──] 60%       │     │ [Reset to Brand Defaults] ││
│  └───────────────────────────────┘     └───────────────────────────┘│
│                                                                      │
│  VIDEO DURATION                        GENERATION LEAD TIME          │
│  ┌───────────────────────────────┐     ┌───────────────────────────┐│
│  │ Target: [ 60 ] - [ 90 ] sec   │     │ Generate [ 24 ] hours     ││
│  │                               │     │ before scheduled post     ││
│  │ Affects: story length,        │     │                           ││
│  │ scene count, pacing           │     │ (ensures content ready)   ││
│  └───────────────────────────────┘     └───────────────────────────┘│
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.4 Schedule Preview

The Schedule Preview panel is crucial for user confidence. It updates in real-time as inputs change.

#### Preview Display

```
┌─────────────────────────────────────────────────────────────────────┐
│  SCHEDULE PREVIEW                                    [↻ Regenerate] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────┬───────────┬────────────────┬────────────────────────┐  │
│  │  DATE   │   TIME    │   PLATFORMS    │   PRESET (if shown)    │  │
│  ├─────────┼───────────┼────────────────┼────────────────────────┤  │
│  │ Feb 10  │ 12:04 PM  │ 🎬 YT  📸 IG   │   one_too_many         │  │
│  │ Feb 10  │  6:12 PM  │ 🎬 YT  📸 IG   │   slow_creepy          │  │
│  │ Feb 11  │ 12:18 PM  │ 🎬 YT  📸 IG   │   one_too_many         │  │
│  │ Feb 11  │  5:47 PM  │ 🎬 YT  📸 IG   │   urban_legend         │  │
│  │ Feb 12  │ 12:31 PM  │ 🎬 YT  📸 IG   │   slow_creepy          │  │
│  │ Feb 12  │  6:22 PM  │ 🎬 YT  📸 IG   │   one_too_many         │  │
│  │ Feb 13  │ 11:55 AM  │ 🎬 YT  📸 IG   │   one_too_many         │  │
│  └─────────┴───────────┴────────────────┴────────────────────────┘  │
│                                                                      │
│  SUMMARY                                                             │
│  ─────────────────────────────────────────────────────────────────  │
│  Total Videos:     7                                                 │
│  Date Range:       Feb 10 - Feb 16 (7 days)                         │
│  Avg per Day:      1 video                                           │
│  Time Distribution: 57% Window A, 43% Window B                       │
│                                                                      │
│  ⚠️ Note: Times shown are EST. Platform posting may vary by offset. │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### Preview Regeneration

- Preview regenerates when any input changes
- "Regenerate" button re-rolls the random elements (jitter, presets)
- Same inputs can produce different schedules due to controlled randomness
- This is intentional and expected

### 4.5 Post-Creation Flow

After campaign creation:

1. **Success Toast**: "Campaign created: 7 videos scheduled Feb 10-13"
2. **Redirect**: Navigate to `/pages/campaign-detail.html?id={campaign_id}`
3. **Detail Page Shows**:
   - Campaign status (planned → active → complete)
   - List of all jobs with status
   - Aggregate progress (0/7 generated, 0/7 posted)
   - Pause/Resume/Cancel controls

---

## 5. Scheduling Logic

### 5.1 Core Philosophy

The scheduling system must balance multiple concerns:

| Concern | Solution |
|---------|----------|
| **Consistency** | Post regularly, build audience expectations |
| **Variety** | Don't post at exactly the same time daily |
| **Platform optimization** | Respect platform-specific best practices |
| **Organic appearance** | Avoid obviously automated patterns |
| **Predictability** | Admin can see full schedule before committing |
| **Adaptability** | System can evolve to data-driven scheduling |

### 5.2 Scheduling Unit: The Job

**Critical Design Decision**: Scheduling happens at the **job level**, not the platform level.

```
                    ┌──────────────────┐
                    │       JOB        │
                    │                  │
                    │ scheduled_post_at│
                    │ = Feb 10, 12:04pm│
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ YouTube  │  │Instagram │  │  TikTok  │
        │ +0 min   │  │ +15 min  │  │ +45 min  │
        │ 12:04 PM │  │ 12:19 PM │  │ 12:49 PM │
        └──────────┘  └──────────┘  └──────────┘
```

**Why job-level scheduling?**

1. **Simplicity**: One timestamp per job, offsets are additive
2. **Atomicity**: Job either posts everywhere or nowhere (can retry)
3. **Consistency**: Video content is identical across platforms
4. **Debuggability**: Easy to trace "when should this have posted?"

### 5.3 Time Window System

#### Window Definition

A **Time Window** is an anchor point in the day around which posts are scheduled.

```
       Window A (12:00 PM)              Window B (6:00 PM)
            │                                │
    ◄───────┼───────►                ◄───────┼───────►
    -30min  │  +30min                -30min  │  +30min
            │                                │
   [11:30 ──┼── 12:30]              [5:30 ──┼── 6:30]
            │                                │
        Jitter Range                     Jitter Range
```

#### Window Selection

When distributing N posts across D days with P posts/day:

```
Algorithm: ASSIGN_WINDOWS(posts_per_day, total_videos)

IF posts_per_day = 1:
    Alternate between Window A and Window B
    Day 1 → A
    Day 2 → B
    Day 3 → A
    ...

IF posts_per_day = 2:
    Each day gets both windows
    Day 1 → A, B
    Day 2 → A, B
    ...

IF posts_per_day = 3:
    Each day gets: A, B, A (with jitter ensuring A₁ ≠ A₂)
    OR use weighted random selection

IF posts_per_day > 3:
    Distribute evenly across the day
    Consider adding Window C (9:00 PM) or dynamic window calculation
```

### 5.4 Jitter Application

Jitter prevents mechanical posting patterns.

#### Jitter Algorithm

```
Function: APPLY_JITTER(window_time, jitter_range)

1. jitter_minutes = random_int(-jitter_range, +jitter_range)
2. final_time = window_time + jitter_minutes
3. RETURN final_time

Example:
  window_time = 12:00 PM
  jitter_range = 30 minutes
  jitter_minutes = random(-30, +30) = -8
  final_time = 11:52 AM
```

#### Jitter Constraints

- Jitter is applied per-job, not per-platform
- Jitter is computed at campaign creation (deterministic after creation)
- Jitter should never push time outside reasonable hours (e.g., 6 AM - 11 PM)
- Jitter values are stored for auditability

### 5.5 Platform Offset System

Platform offsets stagger cross-posting to:
1. Avoid simultaneous API calls
2. Allow platform-specific timing optimization (future)
3. Prevent "simultaneous post" detection by platforms

#### Offset Application

```
Function: CALCULATE_PLATFORM_TIME(job_scheduled_time, platform, offsets)

1. base_offset = offsets[platform] OR default_offset(platform)
2. random_offset = random_int(0, base_offset)
3. platform_time = job_scheduled_time + random_offset
4. RETURN platform_time

Example:
  job_scheduled_time = 12:04 PM
  platform = "instagram"
  offsets = { youtube: 0, instagram: 15, tiktok: 45 }
  random_offset = random(0, 15) = 11
  platform_time = 12:15 PM
```

#### Default Platform Offsets

| Platform | Default Offset Range | Reasoning |
|----------|---------------------|-----------|
| YouTube | 0 min | Primary platform, posts first |
| Instagram | 0-30 min | Secondary, slight delay |
| TikTok | 0-60 min | Tertiary, larger window |
| Facebook | 0-45 min | If added in future |

### 5.6 Complete Scheduling Algorithm

```
Algorithm: GENERATE_CAMPAIGN_SCHEDULE(
    video_count,
    start_date,
    posts_per_day,
    window_a,
    window_b,
    jitter_range,
    platform_offsets
)

1. CALCULATE date range
   days_needed = CEIL(video_count / posts_per_day)
   end_date = start_date + days_needed - 1

2. INITIALIZE schedule = []

3. FOR each day FROM start_date TO end_date:
   
   a. DETERMINE windows for this day
      IF posts_per_day = 1:
         windows = [ALTERNATE(window_a, window_b, day_index)]
      ELSE IF posts_per_day = 2:
         windows = [window_a, window_b]
      ELSE:
         windows = DISTRIBUTE_WINDOWS(posts_per_day, window_a, window_b)
   
   b. FOR each window IN windows:
      IF schedule.length >= video_count:
         BREAK
      
      i.   base_time = COMBINE(day, window)
      ii.  jitter = RANDOM(-jitter_range, +jitter_range)
      iii. scheduled_time = base_time + jitter
      iv.  platform_times = {}
      
      v.   FOR each platform IN selected_platforms:
           offset = RANDOM(0, platform_offsets[platform])
           platform_times[platform] = scheduled_time + offset
      
      vi.  schedule.APPEND({
             scheduled_post_at: scheduled_time,
             jitter_applied: jitter,
             platform_times: platform_times
           })

4. RETURN schedule
```

### 5.7 Schedule Data Structure

Each scheduled item contains:

```javascript
{
  // Core timing
  scheduled_post_at: "2026-02-10T12:04:00-05:00",  // EST
  
  // Audit trail
  window_used: "A",                                 // Which window
  jitter_applied_minutes: -8,                       // For debugging
  
  // Platform-specific (computed, may be stored separately)
  platform_times: {
    youtube: "2026-02-10T12:04:00-05:00",
    instagram: "2026-02-10T12:15:00-05:00",
    tiktok: "2026-02-10T12:38:00-05:00"
  },
  
  // Content selection (if using presets)
  vibe_preset: "one_too_many",
  preset_selection_method: "weighted_random"
}
```

### 5.8 Timezone Handling

**V1 Decision**: All scheduling uses EST (America/New_York).

Reasoning:
- Single admin user in EST timezone
- Simplifies implementation
- Target audience is primarily US-based
- Platform analytics typically normalize to viewer timezone anyway

Future consideration:
- Add `campaign.timezone` field
- Store all times in UTC internally
- Display in user-selected timezone
- Allow per-platform timezone targeting

---

## 6. Database Behavior

### 6.1 Table Relationships

```
┌─────────────────────────────────────────────────────────────────────┐
│                     DATABASE RELATIONSHIPS                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌──────────────────┐                                              │
│   │      brands      │                                              │
│   │                  │                                              │
│   │ id               │◄─────────────────────┐                       │
│   │ name             │                      │                       │
│   │ slug             │                      │                       │
│   └──────────────────┘                      │                       │
│            │                                │                       │
│            │ 1:N                            │                       │
│            ▼                                │                       │
│   ┌──────────────────┐                      │                       │
│   │generation_batches│ (campaigns)          │                       │
│   │                  │                      │                       │
│   │ id               │◄──────────┐          │                       │
│   │ brand_id         │───────────┼──────────┘                       │
│   │ status           │           │                                  │
│   │ config (JSONB)   │           │                                  │
│   │ created_at       │           │                                  │
│   └──────────────────┘           │                                  │
│            │                     │                                  │
│            │ 1:N                 │                                  │
│            ▼                     │                                  │
│   ┌──────────────────┐           │                                  │
│   │      jobs        │           │                                  │
│   │                  │           │                                  │
│   │ id               │           │                                  │
│   │ batch_id         │───────────┘                                  │
│   │ brand_id         │                                              │
│   │ status           │                                              │
│   │ scheduled_post_at│◄── KEY FIELD                                 │
│   │ vibe_preset      │                                              │
│   │ meta (JSONB)     │                                              │
│   └──────────────────┘                                              │
│            │                                                        │
│            │ 1:N                                                    │
│            ▼                                                        │
│   ┌──────────────────┐                                              │
│   │      posts       │                                              │
│   │                  │                                              │
│   │ id               │                                              │
│   │ job_id           │                                              │
│   │ platform         │                                              │
│   │ scheduled_at     │◄── job.scheduled_post_at + offset            │
│   │ posted_at        │                                              │
│   │ platform_post_id │                                              │
│   └──────────────────┘                                              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 Campaign Record (generation_batches)

When a campaign is created, a row is inserted into `generation_batches`:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| id | UUID | Primary key | `550e8400-e29b-41d4-a716-446655440000` |
| brand_id | UUID | FK to brands | `(horror brand id)` |
| status | TEXT | Campaign state | `planned` |
| video_count | INT | Number of jobs | `7` |
| created_at | TIMESTAMP | Creation time | `2026-02-08T10:30:00Z` |
| config | JSONB | Full configuration | See below |

#### Config JSONB Structure

```json
{
  "mode": "auto",
  "start_date": "2026-02-10",
  "posts_per_day": 1,
  "platforms": ["youtube", "instagram"],
  "timezone": "America/New_York",
  
  "windows": {
    "window_a": "12:00",
    "window_b": "18:00",
    "jitter_range_minutes": 30
  },
  
  "platform_offsets": {
    "youtube": 0,
    "instagram": 15,
    "tiktok": 45
  },
  
  "preset_weights": {
    "urban_legend": 0.6,
    "one_too_many": 0.4
  },
  
  "duration": {
    "target_min_seconds": 60,
    "target_max_seconds": 90,
    "affects": ["story_word_count", "scene_count", "audio_pacing"]
  },
  
  "generation_lead_time_hours": 24,
  
  "computed_schedule": [
    {
      "index": 0,
      "scheduled_post_at": "2026-02-10T12:04:00-05:00",
      "generate_by": "2026-02-09T12:04:00-05:00",
      "window_used": "A",
      "jitter_minutes": 4,
      "vibe_preset": "one_too_many"
    }
  ]
}
```

> **Note**: The `computed_schedule` array in config is **optional** and serves as an audit trail. The **jobs table is the source of truth** for the schedule. If `computed_schedule` exists, it should match job records, but workers always read from jobs, never from campaign config.

### 6.3 Job Records

For each video in the campaign, a job row is created:

| Field | Type | Set At Creation | Description |
|-------|------|-----------------|-------------|
| id | UUID | ✅ | Primary key |
| batch_id | UUID | ✅ | FK to campaign |
| brand_id | UUID | ✅ | FK to brand |
| status | TEXT | ✅ | `pending` |
| scheduled_post_at | TIMESTAMP | ✅ | Pre-computed time |
| vibe_preset | TEXT | ✅ | Pre-selected preset |
| progress | INT | ❌ | Updated by workers |
| video_url | TEXT | ❌ | Set when generated |
| error | TEXT | ❌ | Set on failure |
| meta | JSONB | ✅ | Scheduling metadata |

#### Job Meta JSONB

```json
{
  "campaign_index": 0,
  "window_used": "A",
  "jitter_applied_minutes": 4,
  "platforms": ["youtube", "instagram"],
  "platform_offsets": {
    "youtube": 0,
    "instagram": 11
  },
  "preset_selection_method": "weighted_random",
  "duration": {
    "target_min_seconds": 60,
    "target_max_seconds": 90
  },
  "generate_by": "2026-02-09T12:04:00-05:00"
}
```

#### How Duration Affects Generation

The `duration` object influences multiple aspects of video generation:

| Component | Effect of Duration Setting |
|-----------|---------------------------|
| **Story Generation** | Word count target: ~2.5 words/second → 60-90 sec = 150-225 words |
| **Scene Count** | More scenes for longer videos (typically 4-6 for 60-90 sec) |
| **Audio Pacing** | ElevenLabs speed/stability settings adjusted for target length |
| **Image Hold Time** | Calculated as `duration / scene_count` with transitions |
| **Music Selection** | Loop count or track selection based on duration |

Workers read `duration` from job meta and pass it to the story generation prompt and assembly configuration.

### 6.4 What Is Precomputed vs Computed Later

| Data | When Computed | By Whom |
|------|---------------|---------|
| `scheduled_post_at` | Campaign creation | Campaign UI |
| `vibe_preset` | Campaign creation | Campaign UI |
| `platform_offsets` | Campaign creation | Campaign UI |
| Story content | Job processing | Worker |
| Image prompts | Job processing | Worker |
| Audio | Job processing | Worker |
| Video assembly | Job processing | Worker |
| `video_url` | Job completion | Worker |
| Post records | Job completion | Worker |
| Analytics | Post-posting | Analytics worker |

### 6.5 Transaction Boundaries

Campaign creation must be atomic:

```
BEGIN TRANSACTION

  1. INSERT INTO generation_batches (campaign record)
  2. INSERT INTO jobs (N job records)
  3. All jobs reference the campaign via batch_id

COMMIT

-- If any step fails, entire campaign creation fails
-- No partial campaigns should exist
```

---

## 7. Worker Interaction

### 7.0 Job Scheduler (NEW)

> **Reference**: Full documentation in [JOB_SCHEDULER.md](JOB_SCHEDULER.md)

The **Job Scheduler** is a cron-style Edge Function that bridges campaign planning and worker execution. It automatically triggers `run-job` for campaign jobs when their `generate_by` time is reached.

```
Campaign Creation          Scheduler (cron)           Worker
      │                         │                        │
      │  Create jobs with       │                        │
      │  status='pending'       │                        │
      │  generate_by=T-24h      │                        │
      │                         │                        │
      └─────────────────────────┤                        │
                                │                        │
      (Time passes...)          │                        │
                                │                        │
                                │  Every 15 min:         │
                                │  Query eligible jobs   │
                                │  WHERE generate_by     │
                                │    <= NOW()            │
                                │  AND campaign.status   │
                                │    NOT IN ('paused')   │
                                │                        │
                                │  Claim job atomically  │
                                │  (status='generating') │
                                │                        │
                                │─────────────────────────▶
                                │  POST /run-job         │
                                │  { job_id: X }         │
                                │                        │
                                                         │  Generate video
                                                         │  status='complete'
```

**Key Features**:
- **Atomic claim**: Uses `UPDATE ... WHERE status IN ('pending', 'queued') RETURNING` to prevent double-triggers
- **Campaign gating**: Respects pause/cancel status
- **Stampede prevention**: Max 3 jobs per scheduler run
- **Failure recovery**: Reverts claim to `pending` if `run-job` fails to start

**Note on Status**:
- `pending` = canonical not-started status (campaign-created jobs)
- `queued` = legacy status (direct creation, backwards compatibility)
- Scheduler treats both identically

**Files**:
- `supabase/functions/schedule-jobs/index.ts` - Scheduler function
- `supabase/migrations/20260218_job_scheduler.sql` - RPCs and schema

### 7.1 Separation of Concerns

```
┌────────────────────────────────────────────────────────────────────┐
│                    RESPONSIBILITY BOUNDARIES                        │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   CAMPAIGN SYSTEM                    WORKER SYSTEM                  │
│   (Planning)                         (Execution)                    │
│   ─────────────────                  ──────────────                 │
│                                                                     │
│   • Create campaigns                 • Poll for pending jobs        │
│   • Compute schedules                • Generate stories             │
│   • Create job records               • Generate images              │
│   • Set scheduled_post_at            • Generate audio               │
│   • Select presets                   • Assemble video               │
│   • Store platform offsets           • Upload to storage            │
│   • Provide aggregate views          • Update job status            │
│   • Pause/Resume campaigns           • Create post records          │
│   • Cancel unstarted jobs            • Call platform APIs           │
│   • Report campaign status           • Handle retries               │
│                                                                     │
│   DOES NOT:                          DOES NOT:                      │
│   • Call generation APIs             • Know about campaigns         │
│   • Upload content                   • Compute schedules            │
│   • Create posts                     • Modify other jobs            │
│   • Process jobs                     • Care about batch context     │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### 7.2 Worker Job Selection

Workers select jobs based on:

```sql
-- Conceptual query (not actual implementation)
SELECT * FROM jobs
WHERE status = 'pending'
  AND (batch_id IS NULL OR batch.status NOT IN ('paused', 'cancelled'))
  AND (
    meta->>'generate_by' IS NULL 
    OR (meta->>'generate_by')::timestamptz <= NOW()
  )
ORDER BY scheduled_post_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED  -- Prevent race conditions
```

**Key Points**:
- Workers don't know they're processing "campaign jobs"
- `batch_id` is just a reference field
- Campaign status (paused/cancelled) affects job eligibility
- Jobs are processed in scheduled order (FIFO by `scheduled_post_at`)
- `generate_by` ensures jobs start processing with adequate lead time

### 7.2.1 Generation Lead Time

**Problem**: If a job is scheduled to post at 12:00 PM, we don't want to start generating it at 11:55 AM.

**Solution**: Each job has a `generate_by` timestamp in meta that is `scheduled_post_at - lead_time`.

```
Example:
  scheduled_post_at: Feb 10, 12:00 PM
  generation_lead_time_hours: 24
  generate_by: Feb 9, 12:00 PM
  
  Workers see this job as "eligible" starting Feb 9 at noon.
  This gives 24 hours buffer for:
  - Generation queue delays
  - API rate limiting
  - Retry attempts
  - Manual review (if desired)
```

**Lead Time Defaults**:

| Scenario | Lead Time | Reasoning |
|----------|-----------|----------|
| Default | 24 hours | Full day buffer for retries |
| Urgent | 6 hours | Same-day posting |
| Batch (many jobs) | 48 hours | Account for queue depth |
| Testing | 0 hours | Immediate generation |

### 7.3 Worker Idempotency

Workers must be idempotent because:
- Edge functions can timeout
- Network failures happen
- Workers may be killed mid-process

**Idempotency Guarantees**:

| Operation | Idempotency Mechanism |
|-----------|----------------------|
| Story generation | Check if story_text already exists |
| Image generation | Check if images exist in job_assets |
| Audio generation | Check if audio_url is set |
| Video assembly | Check if video_url is set |
| Post creation | Check if post record exists for platform |

### 7.4 Campaign Status Derivation

Campaign status is derived from aggregate job status:

```
Function: DERIVE_CAMPAIGN_STATUS(jobs[])

counts = {
  pending: jobs.count(status = 'pending'),
  generating: jobs.count(status IN ['generating', 'assembling', 'rendering']),
  completed: jobs.count(status = 'complete'),
  failed: jobs.count(status = 'failed'),
  cancelled: jobs.count(status = 'cancelled')
}

IF counts.cancelled = jobs.length:
  RETURN 'cancelled'

IF counts.pending = jobs.length:
  RETURN 'planned'

IF counts.completed + counts.failed + counts.cancelled = jobs.length:
  RETURN 'complete'

IF counts.generating > 0 OR counts.completed > 0:
  RETURN 'active'

RETURN 'planned'
```

### 7.5 Campaign Progress Calculation

```
Function: CALCULATE_CAMPAIGN_PROGRESS(jobs[])

total = jobs.length
completed = jobs.count(status = 'complete')
in_progress = jobs.count(status IN ['generating', 'assembling', 'rendering'])

// Simple percentage
overall_progress = (completed / total) * 100

// Weighted progress including partial jobs
weighted_progress = jobs.sum(job.progress) / (total * 100) * 100

RETURN {
  jobs_total: total,
  jobs_completed: completed,
  jobs_in_progress: in_progress,
  jobs_pending: total - completed - in_progress,
  progress_percent: overall_progress,
  weighted_progress_percent: weighted_progress
}
```

---

## 8. Failure, Control & Safety

### 8.1 Failure Handling Philosophy

**Principle**: Failures are isolated. One bad job doesn't ruin a campaign.

```
Campaign: 7 videos
├── Job 1: ✅ Complete
├── Job 2: ✅ Complete  
├── Job 3: ❌ Failed (API error)     ← Isolated failure
├── Job 4: ✅ Complete
├── Job 5: ✅ Complete
├── Job 6: 🔄 Generating
└── Job 7: ⏳ Pending

Campaign Status: Active (5/7 complete, 1 failed, 1 in progress)
```

### 8.2 Job-Level Retry Logic

Retries happen at the job level, managed by workers:

```
Job Retry Logic:

1. Job fails with retriable error (API timeout, rate limit)
2. Worker updates: status = 'pending', retry_count += 1, error = null
3. Job becomes eligible for re-pickup
4. Next worker iteration picks it up

Retry Limits:
- Max retries: 3
- Backoff: exponential (1min, 5min, 15min)
- After max retries: status = 'failed', requires manual intervention

Non-Retriable Errors:
- Content policy violation (OpenAI refusal)
- Invalid configuration
- Missing required data

Retriable Errors:
- API timeout
- Rate limiting
- Temporary service unavailability
- Network errors
```

### 8.3 Campaign-Level Controls

#### Pause Campaign

**Action**: Set `generation_batches.status = 'paused'`

**Effect**:
- Workers skip jobs where `batch.status = 'paused'`
- Jobs currently processing continue (graceful)
- No new jobs from this campaign start
- Schedule remains intact

**Use Case**: "I need to fix something, don't process more jobs"

#### Resume Campaign

**Action**: Set `generation_batches.status = 'active'`

**Effect**:
- Jobs become eligible for processing again
- Processing resumes from where it left off
- No schedule changes

**Use Case**: "Issue fixed, continue processing"

#### Cancel Campaign

**Action**: 
1. Set `generation_batches.status = 'cancelled'`
2. Set all jobs with `status = 'pending'` to `status = 'cancelled'`

**Effect**:
- No new processing starts
- Completed jobs remain completed
- In-progress jobs may complete (race condition is acceptable)
- Cancelled jobs are permanently skipped

**Use Case**: "This campaign was a mistake, stop everything"

### 8.4 Why Schedule-First Prevents Cascading Failures

Traditional approach (generate-then-schedule):
```
❌ PROBLEM: Generate → Schedule

1. Generate Job 1 (spend $0.50 API)
2. Generate Job 2 (spend $0.50 API)
3. Generate Job 3 (spend $0.50 API)
4. Try to schedule... ERROR: Invalid date range!
5. $1.50 wasted, no recoverable output
```

Campaign approach (schedule-then-generate):
```
✅ SOLUTION: Schedule → Generate

1. Validate all inputs
2. Compute full schedule
3. Create all job records (free, instant)
4. User reviews and confirms
5. Workers generate only scheduled jobs
6. If API fails, job is retried or marked failed
7. No wasted spend on unschedulable content
```

### 8.5 API Spend Protection

| Protection | Mechanism |
|------------|-----------|
| Pre-validation | Check brand, platforms, dates before job creation |
| Deferred generation | Jobs exist before any API calls |
| Pause capability | Stop spending instantly |
| Cancel capability | Prevent future spend |
| Retry limits | Cap spend on problematic jobs |
| Per-job isolation | One failure ≠ campaign failure |

### 8.6 Audit Trail

All campaign operations are logged:

```json
// Example audit log entry (stored in campaign config or separate table)
{
  "timestamp": "2026-02-08T10:30:00Z",
  "action": "campaign_created",
  "actor": "admin",
  "details": {
    "video_count": 7,
    "date_range": "Feb 10-13"
  }
},
{
  "timestamp": "2026-02-10T14:00:00Z",
  "action": "campaign_paused",
  "actor": "admin",
  "reason": "Investigating quality issue"
},
{
  "timestamp": "2026-02-10T14:30:00Z",
  "action": "campaign_resumed",
  "actor": "admin"
}
```

### 8.7 Story Uniqueness Collision Handling

The Story Uniqueness module (see [STORY_UNIQUENESS.md](./STORY_UNIQUENESS.md)) may reject generated stories that are too similar to recent content. This affects campaign jobs as follows:

#### Behavior on Collision

```
Job Processing → Story Generated → Uniqueness Check
                                         │
                            ┌────────────┴────────────┐
                            ▼                         ▼
                      UNIQUE ENOUGH             TOO SIMILAR
                            │                         │
                      Continue to                Regenerate
                      image/audio               with new seed
                            │                         │
                            ▼                         ▼
                       Complete              Retry counter++
                                                      │
                                     ┌────────────────┴───────────────┐
                                     ▼                                ▼
                              retries < 3                      retries >= 3
                                     │                                │
                              Loop back                         Mark FAILED
                              to generation                           │
                                                                      ▼
                                                    error: "duplicate_story_exhausted"
```

#### Key Rules

| Rule | Description |
|------|-------------|
| **Retry Cap** | Max 3 uniqueness retries per job (same as API retries) |
| **Error Type** | `duplicate_story_exhausted` — non-retriable, requires manual intervention |
| **Isolation** | Uniqueness failures affect only that job, not the campaign |
| **Theme Bucket** | Each retry attempts a different theme bucket (forced rotation) |
| **Logging** | Each collision is logged with similarity score for debugging |

#### Manual Resolution

When a job fails with `duplicate_story_exhausted`:

1. **Option A**: Admin manually resets job with `forced_theme_bucket` override
2. **Option B**: Wait for theme bucket rotation (24h cycle) and retry
3. **Option C**: Mark job as `skipped` and accept reduced campaign output

> **Note**: This failure type is expected to be rare (< 1%) with proper theme bucket rotation. High collision rates indicate the uniqueness lookback window may need adjustment or more theme buckets are needed.

---

## 9. Future Evolution

### 9.1 Evolution Principles

The Campaign System is designed to evolve **without UI redesign**:

1. **UI inputs remain stable** — Brand, count, platforms, dates
2. **Backend logic becomes smarter** — Auto mode improves over time
3. **New options appear in Advanced mode** — Power users get new controls
4. **Defaults improve automatically** — Auto mode learns from data

> **Metrics Feedback Boundary Rule**: Performance metrics (view counts, engagement rates, optimal posting times) may influence **future** campaign defaults and recommendations, but they **never** retroactively modify existing campaigns or scheduled jobs. Once a campaign is created, its configuration and schedule are immutable. This separation ensures:
> - Predictable behavior (what you planned is what runs)
> - No "spooky action at a distance" modifying scheduled posts
> - Clear audit trail for compliance
> - Users can safely plan campaigns knowing they won't change

### 9.2 Scaling Posts Per Day

**Current**: 1-2 posts/day default

**Future**: 3+ posts/day

**Evolution Path**:
1. Add "Window C" (e.g., 9:00 PM) when posts_per_day > 2
2. Add dropdown option: "3 posts/day"
3. Auto mode automatically uses 3 windows
4. No UI redesign needed

```
posts_per_day = 1  →  Alternate A, B
posts_per_day = 2  →  Both A, B each day
posts_per_day = 3  →  A, B, C each day
posts_per_day = 4+ →  Dynamic window calculation
```

### 9.3 Performance-Based Scheduling

**Current**: Random jitter within fixed windows

**Future**: Data-driven optimal times

**Data Sources**:
- `post_analytics`: Views, likes, comments per post
- `time_slot_scores`: Aggregated performance by time slot (future table)
- Platform insights APIs (if available)

**Evolution Path**:

```
PHASE 1 (Current):
  Windows = [12:00 PM, 6:00 PM]
  Selection = Random alternation

PHASE 2 (Data Collection):
  Continue random scheduling
  Collect analytics per time slot
  Build time_slot_scores table

PHASE 3 (Weighted Random):
  Windows = [12:00 PM, 6:00 PM]
  Selection = Weighted by historical performance
  Better slots get more posts

PHASE 4 (Optimal Scheduling):
  Windows = Dynamic (based on data)
  Selection = Maximize predicted engagement
  Per-platform optimization

PHASE 5 (ML-Based):
  Windows = Continuous (not discrete)
  Selection = Model predicts optimal time
  Considers day-of-week, holidays, content type
```

### 9.4 Time Slot Scores Table Design

Future table to enable data-driven scheduling:

```
time_slot_scores:
  id: UUID
  brand_id: UUID (FK)
  platform: TEXT
  day_of_week: INT (0=Sunday, 6=Saturday)
  hour_utc: INT (0-23)
  sample_count: INT (number of posts in this slot)
  avg_views: FLOAT
  avg_engagement_rate: FLOAT
  score: FLOAT (computed: engagement * views weight)
  last_updated: TIMESTAMP
```

**Usage**:
```
When scheduling, query:
  SELECT hour_utc, score 
  FROM time_slot_scores 
  WHERE brand_id = X AND platform = Y AND day_of_week = Z
  ORDER BY score DESC

Top slots become weighted windows.
```

### 9.5 Platform-Specific Optimization

**Current**: Same windows for all platforms

**Future**: Per-platform optimal times

**Evolution Path**:
1. Collect platform-specific analytics
2. Build per-platform time_slot_scores
3. Auto mode queries best times per platform
4. Platform offsets become "optimal time deltas"

```
Example Future State:
  YouTube optimal: 3:00 PM (kids home from school)
  TikTok optimal: 9:00 PM (late-night scrolling)
  Instagram optimal: 12:00 PM (lunch break)
  
  Job scheduled_post_at: 3:00 PM (YouTube primary)
  TikTok offset: +6 hours (posts at 9 PM)
  Instagram offset: -3 hours (posts at 12 PM)
```

### 9.6 Preset Weight Adaptation

**Current**: Fixed weights or brand defaults

**Future**: Weights adapt to performance

> **Note (Feb 2026):** Currently only two presets are active: `urban_legend` and `one_too_many`. The adaptation system will work with these two presets initially.

**Evolution Path**:
1. Track engagement by preset
2. Compute "preset performance score"
3. Auto mode weights presets by performance
4. Underperforming presets get reduced weight
5. Optional: sunset poorly-performing presets

```
Example:
  Initial weights: urban_legend=60%, one_too_many=40%
  
  After 100 posts:
    urban_legend: 2.1M avg views
    one_too_many: 1.8M avg views
  
  Adapted weights: urban_legend=55%, one_too_many=45%
  (weights adjust toward equal as both perform well)
```

### 9.7 Advanced Mode Evolution

As the system learns, Advanced mode gains new controls:

| Version | New Advanced Options |
|---------|---------------------|
| V1 | Window times, jitter range, platform offsets |
| V2 | View time_slot_scores, override optimal times |
| V3 | Preset performance graphs, manual weight adjustment |
| V4 | A/B testing mode (split campaign into variants) |
| V5 | Content-aware scheduling (thriller at night, comedy at noon) |

### 9.8 Backward Compatibility

All evolution must maintain:

1. **Existing campaigns continue working** — No schema breaks
2. **Auto mode always works** — Even with no historical data
3. **Advanced mode is optional** — Defaults are always available
4. **Graceful degradation** — If analytics unavailable, fall back to random

---

## 10. Appendix: Glossary & Reference

### 10.1 Glossary

| Term | Definition |
|------|------------|
| **Campaign** | A planned batch of video generation jobs with coordinated scheduling |
| **Job** | A single unit of work that produces one video |
| **Batch** | Database term for campaign (uses `generation_batches` table) |
| **Window** | A target time of day for posting (e.g., 12:00 PM) |
| **Jitter** | Random variation applied to window time (e.g., ±30 min) |
| **Offset** | Per-platform time delay from job scheduled time |
| **Preset** | A video generation style/template (e.g., "one_too_many") |
| **Worker** | Background process that executes jobs |
| **Idempotent** | Operation can be repeated safely without side effects |

### 10.2 Status Definitions

#### Campaign Statuses

| Status | Meaning | Can Transition To |
|--------|---------|-------------------|
| `draft` | Being configured, not submitted | `planned` |
| `planned` | Jobs created, no processing started | `active`, `paused`, `cancelled` |
| `active` | At least one job processing | `paused`, `complete`, `cancelled` |
| `paused` | Processing suspended | `active`, `cancelled` |
| `complete` | All jobs finished | (terminal) |
| `cancelled` | Aborted by user | (terminal) |

#### Job Statuses

| Status | Meaning |
|--------|---------|
| `pending` | Waiting for worker pickup |
| `generating` | Story/content generation in progress |
| `assembling` | Video assembly in progress |
| `rendering` | FFmpeg processing |
| `complete` | Video ready, may or may not be posted |
| `failed` | Permanent failure after retries |
| `cancelled` | Cancelled by campaign cancellation |

### 10.3 Time Formats

All times in this system use:
- **Storage**: ISO 8601 with timezone (`2026-02-10T12:04:00-05:00`)
- **Display**: 12-hour format with AM/PM (`12:04 PM EST`)
- **Internal**: All comparisons in UTC
- **Default Timezone**: America/New_York (EST/EDT)

### 10.4 Configuration Defaults

```yaml
# Default campaign configuration
scheduling:
  timezone: "America/New_York"
  window_a: "12:00"
  window_b: "18:00"
  jitter_range_minutes: 30
  posts_per_day: 1  # Conservative default; 2/day is long-term goal
  generation_lead_time_hours: 24
  
platform_offsets:
  youtube: 0
  instagram: 15
  tiktok: 45

video_duration:
  target_min_seconds: 60
  target_max_seconds: 90
  
limits:
  max_videos_per_campaign: 100
  max_posts_per_day: 5
  min_gap_between_posts_minutes: 60
```

### 10.5 Related Documentation

- [BRAND_SELECTION.md](./BRAND_SELECTION.md) - Brand context and selection system
- [EFFECTS_SYSTEM.md](./EFFECTS_SYSTEM.md) - Video effects and presets
- [STORY_PROFILE.md](./STORY_PROFILE.md) - Story generation parameters
- [STORY_UNIQUENESS.md](./STORY_UNIQUENESS.md) - Duplicate prevention

### 10.6 Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-08 | Initial design specification |

---

## Document End

This document serves as the authoritative design specification for the Campaign System. Implementation should follow this specification. Any deviations should be documented and this specification updated accordingly.

**Next Steps**:
1. Review and approve design
2. Create database migration for any new fields
3. Implement campaign creation endpoint
4. Implement campaign UI
5. Add campaign status to worker job selection query
6. Build campaign detail/management page
