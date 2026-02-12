# Project Roadmap

> **Document Version:** 3.0  
> **Last Updated:** February 11, 2026  
> **Author:** System Architect  
> **Status:** Active Development

---

## Change Log

| Date | Version | Changes |
|------|---------|--------|
| Feb 11, 2026 | 3.0 | **Scene & Image Pipeline v2**: Voice-aligned scene transitions, multi-image for long scenes (>10s), climax awareness in visual cues, per-shot mood levels for Ken Burns, micro-scene merge (<3s), story anchor group count fix, per-scene durations in assembler (no more uniform distribution). New doc: IMAGE_STORY_PIPELINE.md. Enhanced campaign detail UI with copy-paste, image sequence visualization. Weight display fix on create page. |
| Feb 10, 2026 | 2.9 | **Background Music V1.2**: loudness_lufs/peak_db metadata, music fingerprint (config_hash) in job_assets.meta, alimiter (anti-clip), music status badge in job detail UI, Brand Music Management UI (view/upload/toggle/delete tracks per brand on brands page) |
| Feb 10, 2026 | 2.8 | **Background Music V1 Complete**: music_tracks table, 3 RPCs, DB-driven track selection, sidechain ducking, fade in/out, brand music config in brand_templates, renderer v3.2, worker-v1 v2.7 |
| Feb 10, 2026 | 2.7 | **Cost Controls / Rate Limits Complete**: Per-job caps, per-campaign budgets, global throttles, concurrency slots, api_usage ledger with idempotency, 11 RPCs, worker-v1 v2.6 + schedule-jobs v2.2 |
| Feb 10, 2026 | 2.6 | **Step-Level Retries + DLQ Complete**: Per-step retry policies, job_failures table, requeue RPC with lease safety, admin UI (requeue button, failure history modal), worker-v1 v2.5 |
| Feb 10, 2026 | 2.5 | **End-to-End Verified**: worker-v1 auth fix (--no-verify-jwt), subtitles fix (captions passed to renderer), auto-import trigger (video→posts), UI auto-refresh, video preview button fix |
| Feb 23, 2026 | 2.4 | **Post Queue System Complete**: Automated posting pipeline, claim/lease mechanism, platform adapters (stubbed), retry with backoff, campaign gating |
| Feb 22, 2026 | 2.3 | **Asset Storage + Naming Convention Complete**: Standardized paths to `brands/{brand_id}/jobs/{job_id}/{category}/`, path builder helpers, ASSET_NAMING_CONVENTION.md documentation |
| Feb 22, 2026 | 2.2 | **Visual Logs + Step Timeline Complete**: job_step_logs table, timeline view, snapshot logging, StepLogger class, worker-v1 v2.3 |
| Feb 22, 2026 | 2.1 | **Failure Cluster Protection + DLQ Complete**: Error classification, failure clusters, auto-pause, kill switch, DLQ view, bulk requeue with backoff |
| Feb 10, 2026 | 2.0 | **Worker V1 Production Ready**: FFmpeg renderer integration, duration format fix, async polling, end-to-end pipeline verified |
| Feb 20, 2026 | 1.9 | Worker V1 hardening v1.2: step attempt counters, lease grace checks, finalization barrier |
| Feb 20, 2026 | 1.8 | Worker V1 hardening: running checkpoints for long steps; external idempotency (billing protection) |
| Feb 20, 2026 | 1.7 | Worker V1 infrastructure: schema, RPCs, orchestrator stub; lease.ts safety fix (no takeovers) |
| Feb 8, 2026 | 1.6 | Campaign UI fixes: schedule preview, brand loading, campaign-detail page rendering |
| Feb 8, 2026 | 1.5 | Job Claim + Lease System complete: atomic claims, heartbeat, stale sweeper, run-job integration |
| Feb 8, 2026 | 1.4 | Status canonicalization verified; generate_by column is source of truth; UI shell verified |
| Feb 10, 2026 | 1.3 | Job Scheduler complete; Campaign System fully automated |
| Feb 10, 2026 | 1.2 | Campaign System V1 complete; added Worker Gating to backlog; UI shell integrated |
| Feb 8, 2026 | 1.1 | Marked DNA fix + preset source of truth as complete; added tracked risks |
| Feb 8, 2026 | 1.0 | Initial roadmap with 5 priority levels |

---

## ✅ Recently Completed

| Item | Date | Notes |
|------|------|-------|
| **Scene & Image Pipeline v2** | Feb 11, 2026 | 6 improvements: (1) Voice-aligned scene transitions via `alignScenesToVoice()` — syncs image changes to actual spoken word timing from ElevenLabs timestamps; (2) Multi-image for long scenes (>10s) — up to 3 images per scene with varied camera angles; (3) Climax awareness — `isClimax: true` in visual cues for last 1-2 scenes, mood boost; (4) Per-shot mood levels via `computeMoodLevel()` — 1-10 scale controlling Ken Burns intensity; (5) Micro-scene merge (<3s scenes merged into neighbors); (6) Group count fix in story anchor prompt. CRITICAL FIX: assembler now reads image_sequence manifest for per-scene durations instead of uniform distribution. |
| **Enhanced Campaign Detail Logs** | Feb 11, 2026 | Per-section copy buttons (story text, prompts, scenes, visual cues), image sequence visualization (duration bars + mood levels), voice alignment status in images detail, micro-scene merge indicators in scenes detail. |
| **Weight Display Fix** | Feb 11, 2026 | Fixed vibe preset weights showing 9900% on create page — column migrated from DECIMAL(3,2) to INTEGER but JS still multiplied by 100. |
| **Comprehensive Pipeline Documentation** | Feb 11, 2026 | New IMAGE_STORY_PIPELINE.md documenting all 10 pipeline steps, data flow, storage paths, idempotency, cost controls, debugging guide. Replaces outdated IMAGE_GENERATION_DEBUG.md (which described old run-job architecture). |
| **Effects Refinement (Controlled Motion)** | Feb 10, 2026 | DB-driven, intensity-scaled, deterministic effects. 4-layer merge (system->preset->brand->job). `normalizeEffectsConfig()` centralized clamping. Brand-level ceilings (`limits`). Hardened: soft-fail, effects OFF by default, legacy pipeline always reachable. Brand Effects UI on brands page. |
| **Background Music V1.2** | Feb 10, 2026 | V1.2 hardening: loudness_lufs/peak_db columns for per-track gain tuning, music_config_hash fingerprint in job_assets.meta for debugging, alimiter anti-clipping filter in renderer, music status badge in job detail modal, **Brand Music Management UI** on brands page (view tracks, upload MP3, preview playback, toggle active/inactive, delete). |
| **Background Music V1** | Feb 10, 2026 | music_tracks table (3 default tracks per brand), brand music config in config_overrides, 3 RPCs, deterministic selection (hash-based), sidechain ducking + fade in/out in FFmpeg renderer v3.2, worker-v1 v2.7. |
| **Cost Controls / Rate Limits** | Feb 10, 2026 | Per-job caps, per-campaign/global budgets, concurrency slots, api_usage ledger (idempotent), 11 RPCs. Services: openai_text, openai_image (gpt-image-1), elevenlabs, ffmpeg_renderer, creatomate. Worker-v1 v2.6, schedule-jobs v2.2. |
| **Step-Level Retries + DLQ** | Feb 10, 2026 | Per-step retry policies (images=2, others=3), job_failures DLQ table, requeue RPC with lease safety, admin UI (requeue button, failure history). Worker-v1 v2.5. |
| **End-to-End Pipeline Verified** | Feb 10, 2026 | Full automated flow working: schedule-jobs → worker-v1 → video-renderer → auto-import to posts. Subtitles rendering, UI updates, video preview all functional. |
| **Auto-Import Trigger** | Feb 10, 2026 | Database trigger `auto_import_video_to_posts` creates posts automatically when video completes (on `job_assets` INSERT where type='final_mp4') |
| **Subtitles/Captions Fix** | Feb 10, 2026 | `audio_timestamps` (word-level timing) now passed to video-renderer as captions. Videos render with burned-in subtitles. |
| **Worker-v1 Auth Fix** | Feb 10, 2026 | Deployed with `--no-verify-jwt` to allow service-to-service calls from schedule-jobs |
| **Campaign UI Auto-Refresh** | Feb 10, 2026 | Campaign detail page auto-refreshes every 15s while jobs are processing. Realtime subscription configured. |
| **Video Preview Button** | Feb 10, 2026 | Fixed `getCampaignJobs()` to fetch `video_url` from `job_assets` (JOIN with type='final_mp4'). Preview button now appears for completed jobs. |
| **Post Queue System** | Feb 23, 2026 | Automated posting: claim_due_posts, mark_post_posted/failed, schedule-posts + post-worker functions, retry backoff, DLQ view. |
| **Asset Storage + Naming Convention** | Feb 22, 2026 | Standardized paths: `brands/{brand_id}/jobs/{job_id}/{category}/`. Path builder helpers. ASSET_NAMING_CONVENTION.md. Worker-v1 v1.2. |
| **Visual Logs + Step Timeline** | Feb 22, 2026 | Per-job step logs, timeline view, snapshot logging, copy-friendly output. Worker-v1 v2.3. |
| **Failure Cluster Protection + DLQ** | Feb 22, 2026 | Error classification, auto-pause, kill switch, DLQ view, bulk requeue. Worker-v1 v2.2, schedule-jobs v2.1. |
| **Worker V1 End-to-End** | Feb 10, 2026 | Full pipeline verified: Story→Scenes→Voice→Music→Images→Subtitles→Assemble→Upload. FFmpeg renderer working. |

**Reference:** [PRESET_SOURCE_OF_TRUTH.md](PRESET_SOURCE_OF_TRUTH.md), [DNA_AND_DB_OPTION1_IMPLEMENTATION_PLAN.md](DNA_AND_DB_OPTION1_IMPLEMENTATION_PLAN.md), [CAMPAIGN_SYSTEM.md](CAMPAIGN_SYSTEM.md), [JOB_SCHEDULER.md](JOB_SCHEDULER.md), [COST_CONTROLS.md](COST_CONTROLS.md), [BACKGROUND_MUSIC.md](BACKGROUND_MUSIC.md)

---

## ⚠️ Tracked Risks

### Risk 1: Brand Template Presence (Fallback Drift)

| Attribute | Value |
|-----------|-------|
| **Priority** | High (non-blocking) |
| **Status** | Mitigated (partial) |
| **Description** | Brands with no templates in `brand_templates` fall back to hardcoded presets. This is intended for bootstrap/safety, but long-term can cause drift between manual and campaign flows if brands remain unconfigured. |
| **Current Mitigation** | Warning UI banner + console log when fallback is active (implemented Feb 8, 2026) |
| **Future Mitigation** | Brand health indicator, campaign soft warning, dashboard visibility for unconfigured brands |
| **Owner** | System Architect |

### Risk 2: Dual Job "Not-Started" Statuses

| Attribute | Value |
|-----------|-------|
| **Priority** | High (non-blocking) |
| **Status** | Tracked (not yet mitigated) |
| **Description** | Jobs have two "not-started" statuses: `pending` (campaign-created) and `queued` (legacy/direct). Currently treated identically by the scheduler, but future features (claiming, retries, dashboard filters, analytics, admin actions) may accidentally filter only one status and miss jobs. |
| **Current Mitigation** | Scheduler uses `status IN ('pending', 'queued')` everywhere; documented in JOB_SCHEDULER.md |
| **Future Mitigation** | 1) One-time migration to convert `queued` → `pending`; 2) Deprecate `queued` in docs/UI; 3) After burn-in period, remove `queued` from allowed enum/constraints |
| **Owner** | System Architect |
| **Added** | Feb 8, 2026 |

### Risk 3: Failure Cluster + No DLQ

| Attribute | Value |
|-----------|-------|
| **Priority** | High (non-blocking) |
| **Status** | ✅ MITIGATED (Feb 22, 2026) |
| **Description** | With "FAIL stale by default" policy, an upstream dependency outage (OpenAI/ElevenLabs/FFmpeg/storage) could fail many jobs rapidly. Campaigns look "dead" with no easy recovery path. No Dead Letter Queue (DLQ) exists to review/requeue failed jobs. |
| **Mitigation Delivered** | 1) Failure cluster detection (`get_failure_clusters` RPC); 2) Auto-pause campaign via `auto_pause_affected_campaigns`; 3) Global kill switch (`is_kill_switch_active`/`set_kill_switch`); 4) DLQ view (`v_failed_jobs_dlq`); 5) Bulk requeue with backoff (`requeue_failed_jobs`); 6) Error classification in worker-v1 (`classifyError.ts`) |
| **Owner** | System Architect |
| **Added** | Feb 8, 2026 |
| **Resolved** | Feb 22, 2026 |
| **Related** | Item #4 in Level 1 (now complete) |

---

## Overview

This roadmap organizes all pending work into 5 priority levels, from critical core functionality to advanced automation features.

| Level | Focus | Items |
|-------|-------|-------|
| 🧱 Level 1 | Absolute Core | Must do now — foundation for everything |
| ⚙️ Level 2 | Quality & Scale | Next priority — presets, subtitles, effects |
| 📊 Level 3 | Metrics & Learning | Mid priority — analytics and optimization |
| 🧪 Level 4 | Advanced Automation | Later — multi-worker, similarity, review |
| 🏁 Level 5 | Fully Complete System | Final — dashboards, alerts, cross-platform optimization |

---

## 🧱 LEVEL 1 — ABSOLUTE CORE (Must Do Now)

### 1. ✅ Campaign System V1 — COMPLETE

> **Status:** ✅ COMPLETE (February 10, 2026)

**Delivered:**
- [x] `/pages/campaign.html` - Campaign creation UI with Auto/Advanced modes
- [x] `/pages/campaign-detail.html` - Campaign monitoring, pause/resume/cancel
- [x] `generation_batches` extended with `status`, `config`, `video_count`
- [x] `jobs` extended with `batch_id`, `scheduled_post_at`, `brand_id`
- [x] `create_campaign` RPC (atomic transaction)
- [x] `update_campaign_status` RPC (pause/resume/cancel)
- [x] `get_campaign_summary` RPC (stats aggregation)
- [x] Preset weights loaded from `brand_templates` (DB-driven with fallback)
- [x] Real-time schedule preview
- [x] Configurable posting windows, jitter, platform offset
- [x] Sidebar link added to all admin pages
- [x] BrandSwitcher integrated in navbar

**Reference:** [CAMPAIGN_SYSTEM.md](CAMPAIGN_SYSTEM.md), [CAMPAIGN_SMOKE_TESTS.md](CAMPAIGN_SMOKE_TESTS.md)

---

### 1b. ✅ Job Scheduler (Campaign Automation) — COMPLETE

> **Status:** ✅ COMPLETE (February 10, 2026)

**Delivered:**
- [x] `schedule-jobs` Edge Function - queries eligible jobs, triggers run-job
- [x] `find_eligible_jobs` RPC - finds jobs where `generate_by <= NOW()`
- [x] `claim_job_for_scheduler` RPC - atomic claim to prevent double-trigger
- [x] `generate_by` column on jobs table
- [x] Job status constraint extended with `pending`, `cancelled`
- [x] Campaign pause/cancel gating (paused campaigns = jobs wait)
- [x] Stampede prevention (max 3 jobs per scheduler run)
- [x] Failure recovery (revert claim if run-job fails)

**Key Concepts:**
- `generate_by = scheduled_post_at - lead_time_hours` (default 24h)
- Scheduler runs on cron (every 15 min recommended)
- Jobs flow: `pending` → `generating` → `complete`

**Reference:** [JOB_SCHEDULER.md](JOB_SCHEDULER.md)

---

### 2. ✅ Job Queue + Locking (Prevent Duplicates) — COMPLETE

> **Status:** ✅ COMPLETE (February 19, 2026)

**Delivered:**
- [x] `locked_at`, `locked_by`, `lease_expires_at`, `attempt_count` columns on `jobs`
- [x] `claim_job` RPC - atomic claim with lease, campaign gating, `FOR UPDATE` row lock
- [x] `heartbeat_job` RPC - extend lease, update progress/status during processing
- [x] `release_job` RPC - clear lock, set final status (complete/failed)
- [x] `sweep_stale_jobs` RPC - find expired leases, mark as failed (not auto-requeue)
- [x] `find_eligible_jobs` updated to respect lease (skip actively locked jobs)
- [x] `schedule-jobs` rewritten (v2.0) to use claim/release RPCs
- [x] `run-job` integrated (v78.0) with claim verification, heartbeat between phases, release on completion/error

**Key Design Decisions:**
- **Default Lease:** 15 minutes (900 seconds)
- **Stale Handling:** FAIL (not auto-requeue) - prevents infinite retry loops
- **Worker Takeover:** run-job takes over scheduler's lease atomically
- **Both statuses:** `pending` and `queued` treated as claimable for backwards compatibility

**Reference:** [JOB_SCHEDULER.md](JOB_SCHEDULER.md) (v2.0)

---

### 3. Worker v1 (1 Job End-to-End) — COMPLETE

> **Status:** ✅ PRODUCTION READY (February 10, 2026)

**Delivered:**
- [x] Schema: `idempotency_key` on job_assets, unique constraints
- [x] Schema: `job_id`, `platform` on posts with unique index
- [x] Schema: `current_step` on jobs
- [x] RPC: `upsert_job_asset` (idempotent asset creation)
- [x] RPC: `update_job_step` (step status with merge semantics)
- [x] RPC: `get_step_status` (check step completion)
- [x] RPC: `schedule_post_idempotent` (no double-post)
- [x] Fixed `lease.ts` - no takeovers, exit 409 if locked by another
- [x] `worker-v1` Edge Function deployed (orchestrator + full step logic)
- [x] Story generation (generate-post-content endpoint)
- [x] Uniqueness check (story_dna hash integration)
- [x] Scene breakdown + subtitle cues generation
- [x] Voice synthesis (ElevenLabs integration)
- [x] Music selection (deterministic per-vibe)
- [x] Image generation (gpt-image-1/DALL-E, per-scene with heartbeat)
- [x] Subtitle generation (SRT from cues)
- [x] Video assembly (**FFmpeg renderer preferred**, Creatomate fallback)
- [x] Upload to permanent storage
- [x] Schedule post (idempotent, multi-platform)

**Bug Fixes (Feb 10, 2026):**
- [x] Duration format: Now handles both `number` (60) and `object` ({minSeconds: 60, maxSeconds: 90}) formats
- [x] FFmpeg env var: Added `FFMPEG_RENDERER_URL` support (same as run-job uses)
- [x] Async rendering: Implemented polling loop for FFmpeg renderer (5-second intervals, 5-minute timeout)
- [x] Empty scenes fix: Added validation to fail step if 0 scenes generated

**Key Design:**
- Atomic claim (no takeovers - 409 if locked)
- Heartbeat between steps AND within long operations (images loop)
- Idempotent steps via unique constraints + RPCs
- No double-post guarantee via `idx_posts_job_platform`
- Storage uploads use `upsert: true`
- schedule_post uses `job.video_url` (refreshed before call)

**Files:**
- `supabase/functions/worker-v1/index.ts` - Orchestrator
- `supabase/functions/worker-v1/helpers.ts` - Utilities
- `supabase/functions/worker-v1/steps.ts` - Step implementations

**Hardening (v1.1):**

1. **Running Checkpoints (UI Visibility + Resume)**
   - Long steps (images) now call `updateStepStatus(... 'running', { scenes_done, current_scene, total_scenes, progress_pct })`
   - UI/debugger can display "running: 7/10 images done"
   - If worker dies mid-loop, restart can skip completed scenes

2. **External Idempotency (Billing Protection)**
   - **Images:** Prompt content is hashed via `computeHash(scenePrompt)`. Before calling DALL-E, we check if an asset with that prompt hash already exists. If so, we copy the existing image URL instead of re-generating (saves API cost).
   - **Voice:** Story text is hashed via `computeHash(job.story_text)`. Before calling ElevenLabs, we check if an asset with that story hash exists. If so, we copy the existing audio URL instead of re-synthesizing (saves API cost).
   - Both patterns: DB asset lookup → skip external API → copy existing asset

**Hardening (v1.2):**

3. **Step Attempt Counters + Error Tracking**
   - Each step now tracks: `attempts`, `last_error`, `last_error_at` in `jobs.meta.steps[step]`
   - On step start: `attempts += 1`, clear error fields
   - On step fail: record `last_error`, `last_error_at`
   - Enables future "auto-cancel after N attempts" logic and retry observability

4. **Lease Grace Check Before Expensive Calls**
   - Before DALL-E, ElevenLabs, video renderer: verify `lease_expires_at > now + 30s`
   - If insufficient time: abort with retryable error (prevents "lost lease but still burning money")
   - New helper: `requireLeaseGrace(supabase, jobId, workerId, operationName)`

5. **Finalization Barrier on Complete**
   - Before releasing as 'complete', `verifyJobReadyForComplete()` checks:
     - Voice audio exists + quality_ok
     - All scene images exist + quality_ok
     - Subtitles SRT exists
     - Final video_url populated
     - Posts scheduled for all platforms
   - If any missing: fails with detailed list instead of marking complete
   - Prevents "complete" jobs missing assets due to silent partial failures

**Reference:** [JOB_SCHEDULER.md](JOB_SCHEDULER.md), Migration `20260220_worker_v1_*.sql`

---

### 4. ✅ Failure Cluster Protection + DLQ — COMPLETE

> **Status:** ✅ COMPLETE (February 22, 2026)  
> **Related Risk:** Risk 3 in Tracked Risks section → MITIGATED

**Problem Statement:**
With "FAIL stale by default" policy, upstream dependency outages (OpenAI/ElevenLabs/FFmpeg/storage) can fail many jobs rapidly. Campaigns appear "dead" with no easy recovery.

**Delivered:**
- [x] **Failure Classification:** `classifyError.ts` helper categorizes errors as `transient`/`dependency`/`misconfig`/`permanent`
- [x] **Failure Cluster Detection:** `get_failure_clusters` RPC detects X failures within Y minutes of same error signature
- [x] **Auto-Pause Campaign:** `auto_pause_affected_campaigns` RPC pauses campaigns with dependency/service failures
- [x] **Global Kill Switch:** `system_config` table + `is_kill_switch_active`/`set_kill_switch` RPCs
- [x] **DLQ View:** `v_failed_jobs_dlq` view shows failed jobs with failure class, error, retry eligibility
- [x] **Bulk Requeue:** `requeue_failed_jobs`/`requeue_job` RPCs with safety checks (max 3 attempts, not permanent)
- [x] **Retry Policies:** Backoff logic (immediate → +30m → +2h → +4h)

**Integration:**
- `worker-v1` (v2.2): Records failure classification in `jobs.meta.last_failure`, checks kill switch before starting
- `schedule-jobs` (v2.1): Checks kill switch at start (aborts with 503), runs auto-pause for failure clusters

**Key Design:**
- **Error Signatures:** `{error_class}:{step}:{service}` for clustering (e.g. `dependency:images:openai`)
- **Auto-Pause Threshold:** 5+ failures within 10 minutes of same signature
- **Max Retries:** 3 attempts per job, then permanently failed
- **Backoff Schedule:** Attempt 1=immediate, 2=+30min, 3=+2hours, beyond=+4hours

**Database Objects:**
- Table: `system_config` (key-value for kill_switch, feature flags)
- View: `v_failed_jobs_dlq`
- RPCs: `update_job_failure`, `get_failure_clusters`, `is_kill_switch_active`, `set_kill_switch`, `auto_pause_affected_campaigns`, `requeue_failed_jobs`, `requeue_job`
- Columns: `generation_batches.auto_paused_at`, `generation_batches.auto_pause_reason`

**Reference:** Migration `20260222_failure_protection_dlq.sql`, `worker-v1/classifyError.ts`

---

### 5. ✅ FIX STORY UNIQUENESS PIPELINE — COMPLETE

> **Status:** ✅ FIXED (February 8, 2026)

**Root causes found and fixed:**
1. RLS policies missing service_role access
2. Legacy columns (`threat_id`, `ending_id`) were NOT NULL but code uses split columns
3. `visual_dna` table missing `brand_id` column

**Tables now populating:**
- [x] `stories`
- [x] `story_dna`
- [x] `visual_dna`

**Reference:** [DNA_AND_DB_OPTION1_IMPLEMENTATION_PLAN.md](DNA_AND_DB_OPTION1_IMPLEMENTATION_PLAN.md)

<details>
<summary>Original requirements (for reference)</summary>

Goal: Every generated story should produce records in:
- `stories`
- `story_dna` / `story_dna_component_frequency` / `story_dna_concept_usage` / `story_dna_daily_stats`
- `story_similarity_cache` (optional)
- Update views like `v_stories_with_weights`, `v_story_stats`

To-do inside this item:
- [x] Trace where story inserts happen
- [x] Find exact place in code that writes to `stories`
- [x] Identify the uniqueness "write step"
- [x] Check RLS / permissions
- [x] Check if uniqueness runs in all paths
- [x] Add hard logging
- [ ] Add "Uniqueness test" button (admin-only) — deferred
- [ ] Backfill existing stories — deferred

</details>

---

### 5b. ✅ Step-Level Retries + Dead-Letter Queue (DLQ) — COMPLETE

> **Status:** ✅ COMPLETE (February 10, 2026)

**Problem Statement:**
Need per-step retry policies (expensive steps like images get fewer retries), proper backoff scheduling, a DLQ for failure analysis, and admin UI to requeue failed jobs.

**Delivered:**
- [x] `job_step_retry_policies` table - configurable per-step max attempts and backoff schedules
- [x] `job_failures` table - DLQ with step awareness, failure classification, retry eligibility
- [x] `v_failed_jobs_dlq_step` view - admin view with `can_retry`, `recommended_action`
- [x] `record_job_step_failure` RPC - records both job-level and row-level failure info
- [x] `requeue_failed_job` RPC - respects active leases, applies backoff, preserves `current_step`
- [x] `get_failed_jobs_dlq` RPC - query DLQ with filters
- [x] `get_job_failures` RPC - get failure history for a job
- [x] Admin UI: "Requeue" button (can_retry=true) and "Force Retry" (can_retry=false)
- [x] Admin UI: Failure history modal (📋 button)
- [x] Admin UI: Failure info badges (step, class, attempts) on job rows
- [x] Worker-v1 v2.5 calls `record_job_step_failure` on pipeline failure

**Step Retry Policies (Default):**
| Step | Max Attempts | Backoff (min) | Notes |
|------|--------------|---------------|-------|
| story | 3 | [10, 30, 120] | Moderate cost |
| uniqueness | 3 | [5, 15, 60] | Cheap, quick |
| scenes | 3 | [10, 30, 120] | Moderate cost |
| voice | 3 | [10, 30, 120] | ElevenLabs |
| music | 3 | [5, 15, 60] | Cheap/local |
| **images** | **2** | [30, 120] | **EXPENSIVE** (DALL-E) |
| subtitles | 3 | [5, 15, 60] | Cheap/local |
| assemble | 3 | [10, 30, 120] | External renderer |
| upload | 3 | [5, 15, 60] | Storage |
| schedule | 3 | [5, 15, 60] | Post scheduling |

**Failure Classes:**
| Class | Retryable | Example |
|-------|-----------|---------|
| `transient` | ✅ Yes | Network timeout, 500 error |
| `dependency` | ✅ Yes | OpenAI down, ElevenLabs rate limit |
| `misconfig` | ❌ No | Invalid API key, 401 error |
| `permanent` | ❌ No | Content policy violation |

**Key Design:**
- **Lease Safety:** `requeue_failed_job` refuses if job has active lease (unless force=true)
- **Step Resume:** `current_step` preserved; worker checks step completion and resumes
- **DLQ Dedupe:** Unique constraint on `(job_id, job_attempt_number, step_name, step_attempt_number)`
- **Dual Recording:** `record_job_step_failure` writes both `job_failures` row AND `jobs.meta.last_failure`
- **UI Refresh:** After requeue, UI reloads campaign which refreshes failure info map

**Database Objects:**
- Table: `job_step_retry_policies`
- Table: `job_failures` (DLQ)
- View: `v_failed_jobs_dlq_step`
- RPCs: `record_job_step_failure`, `requeue_failed_job`, `get_failed_jobs_dlq`, `get_job_failures`, `get_step_retry_policies`

**Files:**
- Migration: `20260210002_step_retry_dlq.sql`
- Worker: `supabase/functions/worker-v1/index.ts` (v2.5)
- UI: `js/pages/campaign-detail.js` (requeue, failure history)
- CSS: `css/campaign.css` (failure-info, failure-history styles)

---

### 6. ✅ Cost Controls / Rate Limits — COMPLETE

> **Status:** ✅ COMPLETE (February 10, 2026)

**Delivered:**
- [x] `cost_limits` table with scope hierarchy (system → brand → campaign → job)
- [x] `api_usage` ledger with idempotency (prevents double-counting retries)
- [x] `api_slots` concurrency throttle (semaphore-style with lease expiry)
- [x] `mv_daily_usage` materialized view for fast budget aggregation
- [x] 11 RPCs: `get_effective_limits`, `check_budget`, `record_api_usage`, `acquire_api_slot`, `release_api_slot`, `sweep_stale_api_slots`, `get_usage_summary`, `check_campaign_budget`, `refresh_daily_usage`, `check_global_budget`, `get_campaigns_over_budget`
- [x] Default limits for 5 services + global aggregate
- [x] `CostControlHelper` TypeScript class for worker integration
- [x] Worker-v1 v2.6: `assertCanSpend()` before images, voice, assemble steps; `recordUsage()` after
- [x] Schedule-jobs v2.2: Global budget gate (`check_global_budget`) after kill switch check
- [x] Cost limit failures classified as `misconfig` (operator-actionable, not auto-retried)
- [x] ~~Pause/Resume campaign functionality~~ → Delivered in Campaign System V1

**Services Tracked:**
| Service | Model | Daily Budget | Max/Job | Concurrent |
|---------|-------|-------------|---------|------------|
| `openai_text` | gpt-4o | $50 | 5 | 10 |
| `openai_image` | **gpt-image-1** (NOT DALL-E) | $100 | 20 | 5 |
| `elevenlabs` | eleven_turbo_v2_5 | $30 | 3 | 3 |
| `ffmpeg_renderer` | (self-hosted) | $10 | 3 | 3 |
| `creatomate` | (cloud API) | $25 | 2 | 2 |
| **Global** | All services | **$200** | — | — |

**Database Objects:**
- Tables: `cost_limits`, `api_usage`, `api_slots`
- Materialized View: `mv_daily_usage`
- RPCs: 11 total (9 core + 2 scheduler integration)
- Migration: `20260210008_cost_controls_FULL.sql`

**Files:**
- `supabase/migrations/20260210008_cost_controls_FULL.sql`
- `supabase/functions/worker-v1/costControl.ts`
- `supabase/functions/worker-v1/steps.ts` (updated with cost control hooks)
- `supabase/functions/schedule-jobs/index.ts` (updated with global budget gate)

**Reference:** [COST_CONTROLS.md](COST_CONTROLS.md), [COST_CONTROLS_SMOKE_TESTS.md](COST_CONTROLS_SMOKE_TESTS.md)

---

### 7. ✅ Visual Logs + Copy/Paste + Step Timeline — COMPLETE

> **Status:** ✅ COMPLETE (February 22, 2026)

**Delivered:**
- [x] `job_step_logs` table for per-job step logs with timestamps
- [x] `v_job_step_timeline` view - timeline summary per step (duration, status, errors)
- [x] `v_job_logs_formatted` view - copy/paste friendly log lines (`HH:MM:SS [TYPE] [step] message`)
- [x] `log_job_step_event` RPC - lightweight logging (started/progress/completed/failed/snapshot)
- [x] `get_job_step_logs` RPC - query logs with filters (step_name, event_types)
- [x] `get_job_timeline` RPC - get timeline summary for a job
- [x] `get_job_snapshots` RPC - get prompt/output snapshots for debugging
- [x] `cleanup_old_job_logs` RPC - maintenance cleanup (default: 30 days)
- [x] `StepLogger` class in worker-v1 with auto-truncation (max 4KB meta)
- [x] Snapshot logging for key steps: story (prompt/response), images (prompts), voice (request/response), assemble (input/output), upload (output), schedule (output)
- [x] Progress logging for images step (scene-by-scene)

**Integration:**
- `worker-v1` (v2.3): Logger initialized after job load, logs started/completed/failed for each step, passes logger to all step functions

**Database Objects:**
- Table: `job_step_logs` (id, job_id, step_name, event_type, message, meta, created_at)
- Views: `v_job_step_timeline`, `v_job_logs_formatted`
- RPCs: `log_job_step_event`, `get_job_step_logs`, `get_job_timeline`, `get_job_snapshots`, `cleanup_old_job_logs`

**Log Event Types:**
- `started` - Step begins
- `progress` - During long operations (images loop)
- `completed` - Step succeeds
- `failed` - Step fails (includes error_class)
- `snapshot` - Prompt/response/payload capture

**Example Queries:**
```sql
-- Get timeline for a job
SELECT * FROM get_job_timeline('job-uuid');

-- Get copy-friendly logs
SELECT log_line FROM get_job_step_logs('job-uuid');

-- Get snapshots for debugging
SELECT * FROM get_job_snapshots('job-uuid', 'story');
```

**Reference:** Migration `20260222003_job_step_logs.sql`, `worker-v1/stepLogger.ts`

---

### 8. ✅ Asset Storage + Naming Convention — COMPLETE

> **Status:** ✅ COMPLETE (February 22, 2026)

**Delivered:**
- [x] `job_assets` consistently populated with predictable keys
- [x] Standardized storage paths: `brands/{brand_id}/jobs/{job_id}/{category}/`
- [x] Path builder helpers: `pathForImage()`, `pathForAudio()`, `pathForSubtitles()`, `pathForAssembledVideo()`, `pathForFinalVideo()`
- [x] `STORAGE_BUCKET` constant eliminates hardcoded bucket names
- [x] ASSET_NAMING_CONVENTION.md documentation

**Storage Paths:**
```
brands/{brand_id}/jobs/{job_id}/images/scene_00.png   (zero-padded)
brands/{brand_id}/jobs/{job_id}/audio/narration.mp3
brands/{brand_id}/jobs/{job_id}/subtitles/captions.srt
brands/{brand_id}/jobs/{job_id}/video/assembled.mp4   (temporary)
brands/{brand_id}/jobs/{job_id}/video/final.mp4
```

**Asset Types:**
| Type | Idempotency Key | Description |
|------|-----------------|-------------|
| `story` | `{job_id}:story_generation` | Generated story text |
| `uniqueness_check` | `{job_id}:uniqueness_check` | Story DNA hash result |
| `scene_data` | `{job_id}:scenes_subtitles` | Scene breakdown + cues |
| `voice_audio` | `{job_id}:voice_synthesis` | Narration MP3 |
| `music` | `{job_id}:music_selection` | Background music URL |
| `scene_image` | `{job_id}:image_generate:{N}` | Scene images (per-scene) |
| `subtitles` | `{job_id}:subtitle_generation` | SRT file |
| `assembled_video` | `{job_id}:video_assemble` | Pre-upload video |
| `final_video` | `{job_id}:upload_storage` | Permanent video URL |
| `post_schedule` | `{job_id}:post_schedule` | Post scheduling result |

**Files:**
- `supabase/functions/worker-v1/helpers.ts` - Path builders + STORAGE_BUCKET constant
- `supabase/functions/worker-v1/steps.ts` - Updated to use path builders (v1.2)
- `docs/ASSET_NAMING_CONVENTION.md` - Full documentation

**Reference:** [ASSET_NAMING_CONVENTION.md](ASSET_NAMING_CONVENTION.md)

---

### 9. ✅ Auto Schedule → Post Queue (No Manual Import) — COMPLETE

> **Status:** ✅ COMPLETE (February 23, 2026)  
> **Verified:** ✅ Smoke Tests Passed (February 10, 2026)

**Delivered:**
- [x] Worker-v1 writes directly into `posts` table via `schedule_post_idempotent()`
- [x] Posts auto-created with `scheduled_at` from job's `scheduled_post_at`
- [x] `batch_id` propagated from job for campaign gating
- [x] No manual import step required

**Post Queue System:**
- [x] `claim_due_posts` RPC - atomic claim with FOR UPDATE SKIP LOCKED
- [x] `mark_post_posted` RPC - idempotent success recording
- [x] `mark_post_failed` RPC - with retry backoff (30m → 2h → permanent)
- [x] `sweep_stale_post_leases` RPC - recover stuck posts
- [x] `requeue_failed_post` RPC - manual retry with safety checks
- [x] `find_due_posts` RPC - read-only query for scheduler
- [x] `v_failed_posts_dlq` view - failed posts for review

**Edge Functions:**
- [x] `schedule-posts` - cron scheduler (every 5-15 min)
  - Checks kill switch
  - Sweeps stale leases
  - Finds due posts (respects campaign status)
  - Triggers post-worker
- [x] `post-worker` - processes posts
  - Claims from queue or specific IDs
  - Platform adapters (stubbed for TikTok/YouTube/Instagram)
  - Updates status with platform IDs/URLs
  - Handles retries with backoff

**Status Lifecycle:**
```
scheduled → posting → posted
              ↓
           failed (after 3 attempts or permanent error)
```

**Retry Policy:**
| Attempt | Backoff |
|---------|----------|
| 1 → 2 | +30 min |
| 2 → 3 | +2 hours |
| 3 | Permanent fail |

**Schema Additions:**
- `posts.locked_by`, `locked_at`, `lease_expires_at` (claim mechanism)
- `posts.platform_post_id`, `platform_url` (platform results)
- `posts.attempt_count`, `error` (retry tracking)
- `posts.batch_id` (campaign gating)

**Files:**
- `supabase/migrations/20260223001_post_queue_system.sql`
- `supabase/functions/schedule-posts/index.ts`
- `supabase/functions/post-worker/index.ts`
- `docs/POST_QUEUE.md`

**Reference:** [POST_QUEUE.md](POST_QUEUE.md)

---

### 10. ✅ Background Music v1 — COMPLETE

> **Status:** ✅ COMPLETE (February 10, 2026)

**Delivered:**
- [x] `music_tracks` table — per-brand track catalog with mood, energy, vibe preset associations
- [x] 3 default tracks seeded per brand (`ambient_dark_01`, `tension_pulse_01`, `eerie_piano_01`)
- [x] Music preferences in `brand_templates.config_overrides.music` (volume, ducking, fades)
- [x] `get_brand_music_config` RPC — merged defaults + brand overrides
- [x] `get_brand_music_tracks` RPC — filtered by vibe preset, ordered deterministically
- [x] `select_music_track_deterministic` RPC — hash(job_id+brand_id) % count
- [x] Worker music step v2 — DB-driven, idempotent, with hardcoded fallback
- [x] Audio ducking via FFmpeg `sidechaincompress` — music lowers during narration
- [x] Fade in/out via FFmpeg `afade` filters — configurable per brand
- [x] Renderer v3.2 accepts `music_config` with ducking + fade parameters
- [x] Music failures are soft (video renders without music, no job failure)
- [x] No API cost for music (pre-licensed tracks, no generation)

**Architecture:**
- Tracks stored at `brands/{brand_id}/music/{track_id}.mp3` (brand-level, no per-job copies)
- Selection is deterministic: same job always gets the same track
- Music step stores config in `jobs.meta.music_config` → assemble step reads it
- Renderer builds FFmpeg filter chain: volume → fade-in → fade-out → sidechaincompress → amix

**Non-Goals (v1):** No adaptive music, no multi-track layering, no per-scene switching, no user uploads, no music generation APIs.

**Database Objects:**
- Table: `music_tracks` (PK: id + brand_id)
- RPCs: `get_brand_music_config`, `get_brand_music_tracks`, `select_music_track_deterministic`
- Migration: `20260210009_background_music_v1.sql`

**Files:**
- `supabase/migrations/20260210009_background_music_v1.sql`
- `supabase/functions/worker-v1/steps.ts` (v1.4)
- `supabase/functions/worker-v1/helpers.ts` (`pathForBrandMusic`, `pathForJobMusic`)
- `supabase/functions/worker-v1/index.ts` (v2.7)
- `video-renderer/server.js` (v3.2)

**Reference:** [BACKGROUND_MUSIC.md](BACKGROUND_MUSIC.md), [BACKGROUND_MUSIC_SMOKE_TESTS.md](BACKGROUND_MUSIC_SMOKE_TESTS.md)

---

### 11. Kill Switch

- [ ] Stop worker from taking new jobs
- [ ] Stop posting new items
- [ ] Pause all campaigns safely
- [ ] Admin UI toggle

---

## ⚙️ LEVEL 2 — QUALITY & SCALE (Next Priority)

### 12. Finish 5 More Presets (Total: 7)

| Preset | Status | Description |
|--------|--------|-------------|
| `urban_legend` | ✅ Active | Documentary folklore style |
| `one_too_many` | ✅ Active | Counting horror style |
| `faux_true_crime` | ⬜ Planned | True crime documentary style |
| `historical_case_file` | ⬜ Planned | Archive/historical aesthetic |
| `psychological_descent` | ⬜ Planned | Mental deterioration narrative |
| `analog_broadcast` | ⬜ Planned | VHS/broadcast horror |
| `innocence_horror` | ⬜ Planned | Childhood/innocence corruption |

---

### 13. Preset-Aware Quality Gates (Auto Reject/Regenerate)

- [ ] `one_too_many`: Enforce exactly ONE anomaly
- [ ] `innocence_horror`: Subtle constraint enforcement
- [ ] `analog_broadcast`: Controlled blur/noise rules
- [ ] Auto-regenerate on quality gate failure

---

### 14. Subtitle System v1 (Styles Per Brand)

- [ ] Font selection per brand
- [ ] Position configuration
- [ ] Red emphasis rules (controlled, not overused)
- [ ] Store subtitle config in `brand_templates`

---

### 15. ✅ Effects Refinement (Controlled Motion) — COMPLETE

> **Status:** ✅ COMPLETE (February 10, 2026)

- [x] Subtle pan/zoom (Ken Burns) — deterministic direction via djb2 hash seed
- [x] Grain/flicker per preset — DB-driven profiles (urban_legend, one_too_many, analog_horror, clean)
- [x] Effect intensity controls — master intensity knob (0-1) scales all sub-effects
- [x] Per-preset effect profiles — 4-layer merge (system → preset → brand → job)
- [x] `normalizeEffectsConfig()` — centralized clamping, NaN-safe, two-pass (system + brand ceilings)
- [x] Brand-level ceilings (`limits`) — cap effects regardless of preset
- [x] Hardening: enabled=false doesn't kill legacy, soft-fail on filter build, effects OFF by default
- [x] Brand Effects UI on brands page — toggle, sliders, ceilings, per-brand config

**Reference:** [EFFECTS_REFINEMENT.md](EFFECTS_REFINEMENT.md), [EFFECTS_SYSTEM.md](EFFECTS_SYSTEM.md), [EFFECTS_SMOKE_TESTS.md](EFFECTS_SMOKE_TESTS.md)

---

### 16. Content Safety Filters

- [ ] Platform constraints enforcement (`platform_constraints`)
- [ ] Preset forbidden word lists
- [ ] Auto-reject unsafe content
- [ ] Logging of filtered content

---

## 📊 LEVEL 3 — METRICS & LEARNING (Mid Priority)

### 17. Post Registry (Anchor Table for Metrics)

- [ ] Map `job_id` → `posts` → platform `post_id`/`url`
- [ ] Status tracking per platform
- [ ] Post lifecycle states

---

### 18. Metrics Collection v1 (`post_analytics`)

- [ ] Pull views/likes/comments/shares from platforms
- [ ] Store time series data
- [ ] Historical tracking
- [ ] Platform API integrations

---

### 19. Time Slot Scoring (`time_slot_scores`)

- [ ] Simple stats: best hour/day per platform per brand
- [ ] Score calculation
- [ ] Feed into scheduling recommendations

---

### 20. Caption/Tags Learning Loop

- [ ] Store caption/title/tags versions
- [ ] Correlate with performance metrics
- [ ] Bias future choices toward high performers
- [ ] A/B testing capability

---

## 🧪 LEVEL 4 — ADVANCED AUTOMATION (Later)

### 21. Multi-Worker Scaling (2–3 Max)

- [ ] Concurrency limits by phase
- [ ] Worker identification
- [ ] Load balancing
- [ ] Conflict resolution

---

### 22. Story Reuse Weighting / Similarity Thresholds

- [ ] Finalize `story_uniqueness_config`
- [ ] Embeddings + cooldown logic
- [ ] Similarity threshold tuning
- [ ] Story reuse scoring

**Reference:** [STORY_UNIQUENESS.md](STORY_UNIQUENESS.md)

---

### 23. Human Review Mode (Optional)

- [ ] Generate but don't post until approved
- [ ] Review queue UI
- [ ] Approve/Reject/Edit workflow
- [ ] Batch approval

---

### 24. Brand Profiles Fully Automated

- [ ] Presets per brand
- [ ] Music selection per brand
- [ ] Subtitle styles per brand
- [ ] Schedule windows per brand
- [ ] All config in `brand_templates`

---

### 25. Campaign Templates

- [ ] One-click recurring plans
- [ ] Template library
- [ ] Clone existing campaigns
- [ ] Seasonal templates

---

## 🏁 LEVEL 5 — FULLY COMPLETE SYSTEM

### 26. Cross-Platform Optimization Engine

- [ ] Preset weights adapt by performance
- [ ] Schedule adapts by performance
- [ ] Platform-specific optimization
- [ ] ML-driven recommendations

---

### 27. Dashboard

- [ ] Costs per video
- [ ] Failure rates
- [ ] Performance by preset
- [ ] Best time windows
- [ ] Brand comparisons
- [ ] Trend analysis

---

### 28. Alerts/Notifications

- [ ] Job failed alerts
- [ ] Posting failed alerts
- [ ] Spend spike warnings
- [ ] Campaign complete notifications
- [ ] Daily/weekly summaries
- [ ] Configurable thresholds

---

## Quick Reference: Priority Order

```
MUST DO NOW (Level 1)
├── 1. ✅ Campaign System (DONE)
├── 2. ✅ Job Queue + Locking (DONE)
├── 3. ✅ Worker v1 (DONE)
├── 4. ✅ Failure Cluster Protection (DONE)
├── 5. ✅ Story Uniqueness (DONE)
├── 5b. ✅ Step-Level Retries + DLQ (DONE)
├── 6. ✅ Cost Controls (DONE)
├── 7. ✅ Visual Logs (DONE)
├── 8. ✅ Asset Storage (DONE)
├── 9. ✅ Auto Schedule → Post Queue (DONE)
├── 10. ✅ Background Music (DONE)
└── 11. Kill Switch

NEXT (Level 2)
├── 12. 5 More Presets
├── 13. Quality Gates
├── 14. Subtitles
├── 15. Effects
└── 16. Safety Filters

MID (Level 3)
├── 17. Post Registry
├── 18. Metrics Collection
├── 19. Time Slot Scoring
└── 20. Caption Learning

LATER (Level 4)
├── 21. Multi-Worker
├── 22. Similarity Thresholds
├── 23. Human Review
├── 24. Brand Automation
└── 25. Campaign Templates

FINAL (Level 5)
├── 26. Optimization Engine
├── 27. Dashboard
└── 28. Alerts
```

---

## Related Documentation

- [CAMPAIGN_SYSTEM.md](CAMPAIGN_SYSTEM.md) — Campaign architecture
- [STORY_UNIQUENESS.md](STORY_UNIQUENESS.md) — Story DNA system
- [EFFECTS_SYSTEM.md](EFFECTS_SYSTEM.md) — Effects profiles
- [DNA_AND_DB_OPTION1_IMPLEMENTATION_PLAN.md](DNA_AND_DB_OPTION1_IMPLEMENTATION_PLAN.md) — DB-driven config
- [PRESET_SOURCE_OF_TRUTH.md](PRESET_SOURCE_OF_TRUTH.md) — Preset loading architecture
- [BRAND_SELECTION.md](BRAND_SELECTION.md) — Brand system
- [BACKGROUND_MUSIC.md](BACKGROUND_MUSIC.md) — Background music system
