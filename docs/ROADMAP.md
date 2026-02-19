# Project Roadmap

> **Document Version:** 4.2  
> **Last Updated:** February 19, 2026  
> **Author:** System Architect  
> **Status:** Active Development

---

## Change Log

| Date | Version | Changes |
|------|---------|--------|
| Feb 19, 2026 | 4.2 | **Brand Profiles Fully Automated (#24)**: Voice config modal on brands page (9 OpenAI voices, custom instructions, speed slider) with brand-level override in `config_overrides.voice` — worker reads from DB with preset fallback. Schedule windows modal (posting hours, active days, max posts/day, min gap, blackout hours) stored in `config_overrides.schedule`. Music advanced settings (enable/disable toggle, ducking volume/attack/release, fade in/out durations) surfaced in collapsible panel. brandManager service: `getVoiceConfig/saveVoiceConfig`, `getScheduleConfig/saveScheduleConfig`. worker-v1 `getPresetVoiceConfig()` now accepts brand override. Smoke tests: 32/32 pass. |
| Feb 19, 2026 | 4.1 | **Kill Switch UI + Presets + Quality Gates**: Kill switch admin toggle on settings page (System Controls section, badge with ACTIVE/OFF/ERROR, reason input, reads `system_config`, calls `set_kill_switch` RPC). Presets finalized at 4: urban_legend (default), one_too_many, reddit_trending_horror, dark_origins. Quality gates for 3 presets in worker-v1 `steps.ts`: `gateOneToMany()` (counting language + numbers + reveal moment), `gateRedditTrendingHorror()` (first-person + mundane grounding + dialogue), `gateDarkOrigins()` (third-person + dates + locations + unresolved ending). Up to 2 retries before accepting. Platform cleanup verified (15/15 tests). Smoke tests: 37/37 pass (kill switch toggle, 4 presets, quality gate unit tests). Level 1 complete (11/11). Level 2: 12-16 complete. |
| Feb 19, 2026 | 4.0 | **System Hardening Batch (20 improvements)**: Data cleanup cron (monthly: job_logs 30d, lifecycle 90d, metrics 365d). Winning patterns multi-window (7/14/30d) with exponential recency decay (`EXP(-0.03 * days_old)`). Story uniqueness threshold RPC (`check_story_uniqueness`). Dead post sweeper (`sweep_dead_posts`). Cross-platform performance view (`v_cross_platform_performance`). Strategy intelligence system: `post_strategies` + `platform_strategies` tables (20 seeded strategies across 6 platforms), `v_strategy_performance` view, `assign_post_strategy` + `get_top_strategies` RPCs, strategy-driven metadata generation with probabilistic selection. A/B variant auto-assignment RPC (`auto_assign_ab_variants`). Visual performance tracking (`v_visual_performance`). Draft/preview mode RPCs (`promote_draft_to_scheduled`, `reject_draft`). Alert webhook tables (`brand_alert_config`, `system_alert_config`) + Discord/Slack/generic webhook sender in schedule-jobs. metrics-collector: stub platform skipping + Instagram token refresh (proactive 7-day-before-expiry + 401/403 retry). post-worker: per-platform rate limiting + optimistic lock claim. worker-v1: uniqueness threshold enforcement (0.6). generate-post-metadata: time-awareness + strategy-driven prompts. Video renderer: auth middleware (`RENDERER_AUTH_KEY`) + graceful shutdown (SIGTERM/SIGINT). CORS tightened on 6 internal edge functions. Mobile responsive CSS (`responsive.css`) linked in 13 pages. Dashboard N+1 query fix. Cross-Platform & Strategy tab on AI Intelligence page. Migrations: `20260319020` + `20260319021`. |
| Feb 16, 2026 | 3.5 | **Caption/Tags Learning Loop**: `post_metadata_versions` append-only version history table, `post_metadata_variant_assignments` A/B test config table, `v_post_variant_performance` + `v_top_metadata_patterns` views, 5 RPCs (`record_post_metadata_version`, `get_post_metadata_versions`, `get_variant_performance`, `assign_ab_variant`, `get_generation_exemplars`), `generate-post-metadata` v3.0 with exemplar injection + A/B variant prompting + version recording, `metadataVersionService.js` frontend service, Calendar version history panel (collapsible, expandable entries, performance badges). Level 3 scope — no ML, no auto-optimization. **Hardened**: `get_generation_exemplars` with exemplar bucketing (vibe_preset→brand-wide fallback cascade, `p_window_days` time scope, `p_preset_name` priority), `get_negative_exemplars` RPC (bottom performers injected as "avoid these patterns", fixed: added `p_preset_name` param), `v_post_variant_performance` + `v_top_metadata_patterns` views now include `collected_at`. **Winning Patterns Cache**: `winning_metadata_patterns` table (derived cache per brand/platform/vibe), `recompute_winning_patterns` + `recompute_all_winning_patterns` RPCs, `get_winning_patterns` RPC (vibe→brand-wide fallback), pg_cron nightly 03:00 UTC, generator injects top hooks/hashtags/CTAs/length stats into prompt. Migration: `20260317003`. |
| Feb 15, 2026 | 3.4 | **Time Slot Scoring**: `time_slot_scores` table (7×24 grid per brand/platform/window), weighted engagement formula (`views + 5*likes + 10*comments + 10*shares`), timezone-aware bucketing via `AT TIME ZONE`, 4 RPCs (`recompute_time_slot_scores`, `recompute_all_time_slot_scores`, `get_time_slot_scores`, `get_best_time_slots`), pg_cron every 6h, `timeSlotService.js` frontend service, Calendar "Best Times" panel (toggle, platform/window selectors, top-5 chips). Analytics-only — no auto-scheduling. |
| Feb 15, 2026 | 3.3 | **Metrics Collection v1**: Replaced unused `post_analytics` scaffold with proper append-only `post_metrics` time-series table. Decay-based collection schedule (30min→weekly over 90 days). `metrics-collector` Edge Function with platform adapters (YouTube real API, Instagram Graph API, Facebook Graph API, TikTok stub). `find_metrics_eligible_posts` RPC respects decay schedule + terminal posts. 7 RPCs (`record_post_metrics`, `get_post_metrics`, `get_latest_metrics`, `get_latest_metrics_batch`, `get_job_metrics`, `get_campaign_metrics`, `cleanup_old_post_metrics`). 3 views (`v_post_metrics_latest`, `v_post_metrics_summary`, `v_metrics_collection_status`). UI: metrics badges on calendar posted items, engagement stats + collection history in post detail modals (calendar + posts pages). `metricsService.js` frontend service. New doc: POST_ANALYTICS_SYSTEM.md. |
| Feb 15, 2026 | 3.2 | **Post Registry (Anchor Table for Metrics)**: `post_lifecycle_events` append-only audit trail for state transitions, lifecycle timestamp columns on `posts` (`posting_started_at`, `failed_at`), `v_post_registry` clean view (no queue internals), `v_job_post_summary` per-job platform aggregation, 5 RPCs (`get_post_registry`, `get_posts_for_job`, `get_post_lifecycle`, `get_batch_post_summary`, `cleanup_old_lifecycle_events`), trigger-based auto-recording on status changes, backfill for existing posts, patched `claim_due_posts`/`mark_post_failed` with lifecycle timestamps, UI: platform links + lifecycle timeline in post detail modal, `postQueueService` registry methods. |
| Feb 12, 2026 | 3.1 | **Story Generation v2 + Bug Fixes**: (1) Rich one_too_many prompt with randomized trope packs (18 containers, 11 evidence sources, 10 glitches, 8 witnesses, 8 group types, 5 group sizes); (2) Storytelling toolkit enhancements (spatial grounding, named characters, time-skip epilogue, multi-layer evidence stacking, environmental disturbance scattering, uncanny valley descriptions); (3) Cinematography-driven shot selection (removed hardcoded group scene limits); (4) Campaign detail UI fixes (uniqueness score nested path, art style fallback, platform array handling); (5) Snapshot data extraction fix (meta.payload vs meta.data in 8 renderers). |
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
| **Brand Profiles Fully Automated** | Feb 19, 2026 | Voice config modal (9 voices, instructions, speed), schedule windows modal (posting hours, active days, max posts/day, gap, blackout), music advanced panel (enable/disable, ducking, fade). All config in `brand_templates.config_overrides`. Worker voice loading from DB. 32/32 tests pass. |
| **Kill Switch UI + Presets + Quality Gates** | Feb 19, 2026 | Kill switch admin toggle on settings page. 4 active presets finalized (urban_legend, one_too_many, reddit_trending_horror, dark_origins). Quality gates for 3 presets (one_too_many, reddit_trending_horror, dark_origins) with up to 2 retries. Platform cleanup verified (15/15). All smoke tests pass (37/37). Level 1: 11/11 complete. |
| **System Hardening Batch** | Feb 19, 2026 | 20 improvements in one batch. Data cleanup cron, multi-window winning patterns with recency decay, story uniqueness RPC, dead post sweeper, cross-platform view, strategy intelligence (20 seeded strategies), A/B variant auto-assignment, visual performance view, draft/preview RPCs, alert webhook system. Edge function hardening: stub platform skip, Instagram token refresh, per-platform rate limiting, optimistic lock, uniqueness enforcement, time-aware + strategy-driven metadata, renderer auth + graceful shutdown, CORS tightening. Frontend: responsive.css on all pages, dashboard N+1 fix, cross-platform tab. Migrations: `20260319020` + `20260319021`. |
| **Caption/Tags Learning Loop** | Feb 16, 2026 | `post_metadata_versions` (append-only version history) + `post_metadata_variant_assignments` (A/B test config). Views: `v_post_variant_performance`, `v_top_metadata_patterns`. 9 RPCs (incl. `get_negative_exemplars`, `recompute_winning_patterns`, `recompute_all_winning_patterns`, `get_winning_patterns`). `winning_metadata_patterns` derived cache table (top hooks, hashtags, CTAs, length stats per brand/platform/vibe). pg_cron nightly 03:00 UTC. `generate-post-metadata` v3.0: exemplar bucketing (vibe→brand-wide fallback, 30d window), negative exemplar injection, winning patterns injection, A/B variant prompting, automatic version recording. `metadataVersionService.js`. Calendar: collapsible version history panel, performance badges, expandable field snapshots. Migrations: `20260317001` + `20260317002` + `20260317003`. |
| **Time Slot Scoring** | Feb 15, 2026 | `time_slot_scores` table (7×24 grid, UNIQUE per brand/platform/tz/window/dow/hour), weighted engagement scoring formula, timezone-aware bucketing, 4 RPCs, pg_cron every 6h, `timeSlotService.js`, Calendar Best Times panel (top-5 chips, platform/window selectors). Analytics-only. Migration: `20260316001_time_slot_scoring.sql`. |
| **Metrics Collection v1** | Feb 15, 2026 | `post_metrics` append-only time-series (replaces unused `post_analytics`), `metrics-collector` Edge Function with YouTube/Instagram/Facebook/TikTok adapters, decay-based collection schedule, 7 RPCs, 3 views, `metricsService.js`, metrics badges on calendar + post detail modals. Migration: `20260315001_metrics_collection_v1.sql`. |
| **Post Registry (Anchor Table)** | Feb 15, 2026 | `post_lifecycle_events` table (append-only audit trail), lifecycle timestamps on `posts`, `v_post_registry` + `v_job_post_summary` views, 5 RPCs, trigger-based auto-recording, UI lifecycle timeline in post detail modal. Migration: `20260309001_post_registry.sql`. |
| **Story Generation v2** | Feb 12, 2026 | Rich one_too_many prompt engine: randomized trope packs (18 containers, 11 evidence sources, 10 glitches, 8 witnesses, 6 dialogue lines), flexible narrative voice (any POV), soft storytelling toolkit (spatial grounding, named characters, time-skip epilogues, multi-layer evidence, environmental disturbance scattering, uncanny valley descriptions). Cinematography-driven shot selection (replaced hardcoded group scene limits). |
| **Campaign Detail UI Fixes** | Feb 12, 2026 | Fixed uniqueness score nested path (`meta.meta.uniqueness_score` + 0-1→percentage), art style fallback to `'auto (from preset)'`, platform handling for `meta.platforms` array. Fixed snapshot data extraction in 8 renderers (`meta.payload` vs `meta.data`). |
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

> **Status:** ✅ FIXED + UPGRADED (February 12, 2026)

**Phase 1 — Pipeline Fix (Feb 8):**
1. RLS policies missing service_role access
2. Legacy columns (`threat_id`, `ending_id`) were NOT NULL but code uses split columns
3. `visual_dna` table missing `brand_id` column

**Phase 2 — Tables Populating Fix (Feb 12, commit af1aabc):**
1. worker-v1 never wrote to `stories` table → added insert in `executeStoryStep()`
2. `story_dna` upsert silently failed (11 NOT NULL columns) → migration made them nullable
3. Missing `brand_id`/`genre` columns on `story_dna` → added via migration

**Phase 3 — Thematic Uniqueness (Feb 12, commit b07d044):**
Problem: `concept_hash` was just hash(full_text), so two elevator stories with different
words passed as "unique." 3 of 6 test stories were about elevators, 3 about passengers.

Fix (three layers):
1. **Avoidance prompt:** Query last 20 stories (same preset) + story_dna settings, include
   in GPT prompt as "DO NOT REPEAT" list with settings/titles
2. **Concept extraction:** GPT returns `setting` and `concept` fields (e.g. "elevator",
   "Extra person in stopped elevator"). Stored in story asset meta.
3. **Concept hashing:** `concept_hash = SHA-256(setting|concept)` separate from
   `full_hash = SHA-256(story_text)`. Collision check uses concept_hash for thematic dedup.
   `story_dna.meta` stores `{title, setting, concept}` for future avoidance queries.

Also expanded `one_too_many` setting suggestions from ~10 to 30+ (cave tour, gym, aquarium,
karaoke, funeral, zoo, bowling alley, etc.)

**Test results (post-Phase 3):** cave tour, 24-hour gym, library — zero thematic overlap.

**Phase 4 — Rich Story Generation (Feb 12, commits af36930, new):**
Problem: Production worker-v1 had bare-bones prompt ("write a counting horror story").
Sophisticated contract system existed in run-job but was never used.

Fix (two iterations):
1. **v1 — Trope Pack Engine** (commit af36930): `buildOneToManyPrompt()` with randomized
   story seeds. Arrays: groupSizes (5), groupTypes (8), containers (18), evidenceSources (11),
   glitches (10), witnesses (8), dialogueLines (6). Flexible narrative voice via
   `getStorySystemPrompt()`. Separate return path for one_too_many (no forced "first-person").
2. **v2 — Enhanced Storytelling Toolkit**: 8 toolkit dimensions (up from 6):
   - SPATIAL GROUNDING: Physical arrangement of bodies in space
   - NAMED CHARACTERS: At least the noticer gets a name
   - MULTI-LAYER EVIDENCE: External confirmation + failed investigation + delayed proof
   - ENVIRONMENTAL DISTURBANCE: 2-3 scattered wrongnesses (not dumped at once)
   - UNCANNY VALLEY ("ALMOST RIGHT"): Specific off-ness descriptions
   - AFTERMATH WITH TIME-SKIP: Weeks/months later epilogue
   - Plus: RECOUNTS, VISUAL PROOF (carried from v1)

**Test results (post-Phase 4 v1):** "The Seventh Shopper" — 6 strangers in convenience store
during storm, count keeps showing 7, passing traveler confirms, handprint on glass. All counting
horror elements present with variety from trope randomization.

**Design principle:** "Don't make it too strict or each story will feel the same" — all toolkit
items are suggestions, not requirements. Randomized seeds ensure fresh raw material each generation.

**Tables now populating:**
- [x] `stories` — title, text, content_hash, title_hash, hook, vibe_preset, source_job_id
- [x] `story_dna` — concept_hash (thematic), full_hash (exact), meta (title/setting/concept)
- [ ] `visual_dna` — not yet populated by worker-v1

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
- [x] Fix story_dna nullable columns (migration 20260234001)
- [x] Add story_dna brand_id/genre columns (migration 20260234002)
- [x] Thematic avoidance prompt + concept hashing
- [ ] Add "Uniqueness test" button (admin-only) — deferred
- [ ] Backfill existing stories — deferred
- [ ] Populate `visual_dna` — deferred

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

### 11. ✅ Kill Switch — COMPLETE

> **Status:** ✅ COMPLETE (February 19, 2026)

**Backend (already existed from #4 Failure Cluster Protection):**
- [x] `system_config` table with `kill_switch` key (JSONB value: enabled, reason, enabled_at, disabled_at, updated_by)
- [x] `is_kill_switch_active()` RPC — returns boolean
- [x] `set_kill_switch(p_enabled, p_reason, p_updated_by)` RPC — returns updated state
- [x] Checked in 7 edge functions: schedule-jobs, worker-v1, post-worker, schedule-posts, metrics-collector, metadata-scheduler, generate-post-metadata

**Admin UI (new):**
- [x] System Controls section on settings page (before Danger Zone)
- [x] Kill switch toggle with badge (ACTIVE red pulse / OFF green / ERROR amber)
- [x] Status display: reason, enabled/disabled timestamp
- [x] Reason input with confirm/cancel flow on enable
- [x] JS controller: `initKillSwitch()`, `refreshKillSwitchState()`, `setKillSwitch()`
- [x] Reads `system_config` table directly, calls `set_kill_switch` RPC

**Smoke Tests:** 12/12 pass — toggle on/off, reason preserved, timestamps set, edge function returns 503 when active

**Files:**
- `pages/settings.html` (System Controls section + JS controller)
- `css/settings.css` (kill switch badge, status, toggle styles)
- `scripts/smoke-test-kill-presets-gates.js` (37 tests total)

---

## ⚙️ LEVEL 2 — QUALITY & SCALE (Next Priority)

### 12. ✅ Active Presets (4 Total) — COMPLETE

> **Status:** ✅ COMPLETE (February 19, 2026)

| Preset | Status | Weight | Description |
|--------|--------|--------|-------------|
| `urban_legend` | ✅ Active (default) | 4 | Documentary folklore style |
| `one_too_many` | ✅ Active | 4 | Counting horror — rich trope pack engine with 8-dimension storytelling toolkit |
| `reddit_trending_horror` | ✅ Active | 4 | First-person Reddit nosleep style |
| `dark_origins` | ✅ Active | 4 | Third-person true crime / unsolved mystery |

**Scope Change:** Originally planned for 7 presets. Reduced to 4 active presets to focus on quality over quantity. Deprecated presets removed: faux_true_crime, historical_case_file, psychological_descent, analog_broadcast, innocence_horror.

**Verified:** DB (`brand_templates`) has exactly 4 rows. `js/templates/horror.js` has matching 4 presets. All equal weight (4).

---

### 13. ✅ Preset-Aware Quality Gates — COMPLETE

> **Status:** ✅ COMPLETE (February 19, 2026)

Quality gates run after story generation, before hash computation. Each preset has pattern-matching rules. Up to 2 retries before accepting story anyway.

- [x] `gateOneToMany(text)`: Counting/number language patterns, specific number mentions, reveal moment (photo/count/recount)
- [x] `gateRedditTrendingHorror(text)`: First-person voice (3+ "I"), mundane details in first third (coffee/phone/apartment etc.), dialogue (quoted speech)
- [x] `gateDarkOrigins(text)`: Third-person (no "I" outside quotes), dates/years/time periods, location/authority references, unresolved ending pattern
- [x] `runQualityGate(vibePreset, storyText, title)` — dispatcher, returns `{ passed, failures[] }`
- [x] Retry logic: `job.meta.quality_gate_attempts` counter, max 2 retries, then accept with logged warning
- [x] All gate results logged via `logger.snapshot('story', 'quality_gate_*', ...)`

**Note:** `urban_legend` has no quality gate (most flexible preset). Gates target the 3 presets with strongest structural expectations.

**Smoke Tests:** 10/10 unit tests pass — good stories accepted, bad stories rejected, empty strings fail all gates

**Files:**
- `supabase/functions/worker-v1/steps.ts` (quality gate functions + integration in story step)
- `scripts/smoke-test-kill-presets-gates.js`

---

### 14. ✅ Subtitle System v1 (Styles Per Brand) — COMPLETE

> **Status:** ✅ COMPLETE (March 8, 2026)

- [x] Font / style selection per brand — 10 caption styles (bold, horror, glitch, minimal, neon, vintage, blood, typewriter, shadow, comic)
- [x] Position configuration — bottom / center / top, mapped to ASS MarginV + Alignment
- [x] Red emphasis rules (controlled, not overused) — `highlightScary` toggle, configurable `highlightColor` / `scaryColor`, `emphasisScale` slider (100-130%)
- [x] Store subtitle config in `brand_templates` — `config_overrides.subtitles` JSONB key
- [x] 4-layer merge hierarchy — system defaults → preset profile → brand overrides → job meta (reuses effects pattern)
- [x] 3 Supabase RPCs — `get_subtitle_system_defaults()`, `get_subtitle_preset_profile(preset)`, `get_subtitle_config_for_job(brand_id, preset, meta)`
- [x] Renderer accepts full `subtitleConfig` — `createASSSubtitles()` parametrized (style, fontSize, position, wordsPerChunk, emphasis)
- [x] Worker resolves config — `getSubtitleConfigForJob()` in helpers.ts, soft-fail returns null
- [x] Brand Subtitle Config UI — modal on brands page with live ASS-style preview, all params editable

**Reference:** [EFFECTS_SYSTEM.md](EFFECTS_SYSTEM.md) (same merge pattern), brands.html subtitle modal

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

### 16. Content Safety Filters ✅

- [x] Platform constraints enforcement — `content_safety_rules` table with `platform:youtube_shorts`, `platform:tiktok` scopes
- [x] Preset forbidden word lists — DB-driven rules per preset (`preset:one_too_many`, `preset:analog_horror`)
- [x] Auto-reject unsafe content — proactive pre-filter in both worker-v1 (DB-driven) and run-job (hardcoded) BEFORE first API attempt; covers 9 categories: violence, abuse, weapons, body_horror, children, panic, self_harm, scary_descriptors, pursuit
- [x] Logging of filtered content — step logger snapshots with categories filtered, change count, lengths; `log_safety_filter_event()` RPC for structured DB logging

---

## 📊 LEVEL 3 — METRICS & LEARNING (Mid Priority)

### 17. ✅ Post Registry (Anchor Table for Metrics) — COMPLETE

> **Status:** ✅ COMPLETE (February 15, 2026)

**Design Decision:** The existing `posts` table already serves as the per-platform anchor (one row per job+platform). Rather than creating a redundant registry table, we extended `posts` with lifecycle timestamps and added an append-only `post_lifecycle_events` table for audit/analytics.

**Delivered:**
- [x] `posting_started_at`, `failed_at` columns on `posts` — lifecycle timestamps
- [x] `post_lifecycle_events` table — append-only audit trail for every state transition
- [x] Trigger `trg_post_lifecycle` — auto-records events on INSERT and UPDATE (status changes)
- [x] `v_post_registry` view — clean registry: job→post→platform mapping with lifecycle state, timing metrics, retry eligibility. No queue internals.
- [x] `v_job_post_summary` view — per-job platform aggregation (total/posted/failed/scheduled counts, aggregate status, platform details JSONB)
- [x] `get_post_registry` RPC — query with filters (brand, batch, job, platform, status) + pagination
- [x] `get_posts_for_job` RPC — all platform posts for a specific job
- [x] `get_post_lifecycle` RPC — lifecycle event history for a single post
- [x] `get_batch_post_summary` RPC — campaign-level post summary
- [x] `cleanup_old_lifecycle_events` RPC — maintenance (default 90 days)
- [x] Patched `claim_due_posts` — sets `posting_started_at` on claim
- [x] Patched `mark_post_failed` — sets `failed_at` for permanent failures
- [x] Backfill — existing posts get lifecycle events (scheduled, posted, failed)
- [x] UI: Platform links + lifecycle timeline in post detail modal
- [x] `postQueueService` — 4 new methods: `getPostsForJob()`, `getPostLifecycle()`, `getPostRegistry()`, `getBatchPostSummary()`

**Integration:**
- **post-worker**: No code changes needed — the trigger on `posts` auto-captures every status transition when `claim_due_posts`, `mark_post_posted`, and `mark_post_failed` RPCs are called
- **worker-v1**: `schedule_post_idempotent` INSERT triggers initial lifecycle event
- **UI**: Post detail modal shows posted_at, platform_url, platform_post_id, and lifecycle timeline

**Future-proofing:**
- `post_lifecycle_events` is the JOIN point for `post_analytics` (Roadmap #18) — time-to-post, failure patterns, retry timing
- `v_post_registry.posting_duration_seconds` and `queue_wait_seconds` ready for time slot scoring (#19)
- `v_job_post_summary.platform_details` JSONB ready for caption learning (#20)
- Lifecycle events have `meta` JSONB for arbitrary future data attachment

**Database Objects:**
- Table: `post_lifecycle_events`
- Views: `v_post_registry`, `v_job_post_summary`
- RPCs: `get_post_registry`, `get_posts_for_job`, `get_post_lifecycle`, `get_batch_post_summary`, `cleanup_old_lifecycle_events`
- Trigger: `trg_post_lifecycle` → `fn_record_post_lifecycle_event()`
- Migration: `20260309001_post_registry.sql`

---

### 18. ✅ Metrics Collection v1 (`post_metrics`) — COMPLETE

> **Status:** ✅ COMPLETE (February 15, 2026)

**Design Decision:** Replaced the unused `post_analytics` scaffold table (which used `UNIQUE(post_id, platform, snapshot_type)` — overwrite semantics) with a proper append-only `post_metrics` time-series table. Each collection event creates a new row, enabling true historical tracking.

**Delivered:**
- [x] `post_metrics` table — append-only time-series with views, likes, comments, shares, saves, watch metrics
- [x] Decay-based collection schedule — 30min (fresh) → 2h → 6h → 12h → 24h → 7d (90d cap)
- [x] `metrics-collector` Edge Function — cron every 30 min, kill switch, batch processing
- [x] Platform adapters: YouTube (real API via Data API v3), Instagram (Graph API), Facebook (Graph API), TikTok (stub)
- [x] Token refresh handling — reuses `platform_tokens` OAuth pattern from post-worker
- [x] Error classification: transient/dependency/misconfig/permanent (permanent → `metrics_terminal` flag)
- [x] `find_metrics_eligible_posts` RPC — decay schedule, skips terminal/retired posts
- [x] `record_post_metrics` RPC — inserts with computed `post_age_hours`
- [x] `get_post_metrics` RPC — time-series with date range filtering
- [x] `get_latest_metrics` / `get_latest_metrics_batch` RPCs — for UI display
- [x] `get_job_metrics` RPC — aggregate across platforms for a job
- [x] `get_campaign_metrics` RPC — campaign-level aggregates with platform breakdown
- [x] `cleanup_old_post_metrics` RPC — retention cleanup (default 365 days, not scheduled)
- [x] `v_post_metrics_latest` — DISTINCT ON most recent per post
- [x] `v_post_metrics_summary` — latest values + collection stats
- [x] `v_metrics_collection_status` — eligible/active/terminal/retired states
- [x] `metricsService.js` — frontend service with caching, formatting, badge/detail HTML builders
- [x] Calendar: metrics badges on posted items (views count), metrics detail in post modal
- [x] Posts page: metrics section in post detail modal (stats + history table)

**Integration:**
- post-worker: No changes needed — `post_metrics` is independent of posting pipeline
- metrics-collector: Reads `platform_tokens` for API access (same as post-worker)
- Calendar: `enrichCalendarMetrics()` batch-fetches metrics after render, attaches to items
- Post modal: `loadPostMetrics()` / `loadPostDetailMetrics()` lazy-loads on modal open

**Database Objects:**
- Table: `post_metrics` (replaces `post_analytics`)
- Views: `v_post_metrics_latest`, `v_post_metrics_summary`, `v_metrics_collection_status`
- RPCs: `find_metrics_eligible_posts`, `record_post_metrics`, `get_post_metrics`, `get_latest_metrics`, `get_latest_metrics_batch`, `get_job_metrics`, `get_campaign_metrics`, `cleanup_old_post_metrics`
- Migration: `20260315001_metrics_collection_v1.sql`

**Reference:** [POST_ANALYTICS_SYSTEM.md](POST_ANALYTICS_SYSTEM.md)

---

### 19. ✅ Time Slot Scoring (`time_slot_scores`) — COMPLETE

> **Status:** ✅ COMPLETE (February 15, 2026)

**Design Decision:** Weighted engagement formula (`views + 5*likes + 10*comments + 10*shares`) provides a simple, stable, monotonic score that degrades gracefully when some metrics are zero. Posts must be ≥ 6 hours old (maturity threshold) to be included. Timezone-aware bucketing via `AT TIME ZONE` handles DST correctly. UPSERT semantics keep row count stable across recomputes.

**Delivered:**
- [x] `time_slot_scores` table — 7×24 grid per brand/platform/tz/window
- [x] UNIQUE constraint: `(brand_id, platform, tz, window_days, day_of_week, hour)`
- [x] CHECK constraints: dow 0-6, hour 0-23, window_days IN (7,14,30)
- [x] `recompute_time_slot_scores` RPC — per brand/platform/window, timezone resolution chain
- [x] `recompute_all_time_slot_scores` RPC — loops active brands × platforms
- [x] `get_time_slot_scores` RPC — full 7×24 grid sorted by dow, hour
- [x] `get_best_time_slots` RPC — top N by score, `sample_size >= 3` threshold, human labels
- [x] pg_cron job every 6h (`recompute-time-slot-scores`)
- [x] `timeSlotService.js` — frontend service with 10-min cache
- [x] Calendar "Best Times" panel — toggle button, platform/window selectors, top-5 chips
- [x] Brand timezone support via `brands.settings.timezone` JSONB

**Scoring Formula:**
```
performance_value = views + 5×likes + 10×comments + 10×shares
score = AVG(performance_value) per (brand, platform, tz, dow, hour)
```

**Database Objects:**
- Table: `time_slot_scores`
- RPCs: `recompute_time_slot_scores`, `recompute_all_time_slot_scores`, `get_time_slot_scores`, `get_best_time_slots`
- Cron: `recompute-time-slot-scores` (every 6h)
- Migration: `20260316001_time_slot_scoring.sql`

**Reference:** [TIME_SLOT_SCORING.md](TIME_SLOT_SCORING.md)

---

### 20. Caption/Tags Learning Loop ✅

- [x] Store caption/title/tags versions — `post_metadata_versions` append-only table with version_number, version_type (ai/edit/regenerate), variant_key, fields JSONB
- [x] Correlate with performance metrics — `v_post_variant_performance` view joins versions with `v_post_metrics_latest`, computes `performance_value` using weighted formula
- [x] Bias future choices toward high performers — `get_generation_exemplars` RPC fetches top-N metadata patterns; injected into generation prompt as style guidance
- [x] A/B testing capability — `post_metadata_variant_assignments` table, `assign_ab_variant` RPC, variant instructions injected into prompt, variant_key recorded per version
- [x] Exemplar bucketing — `get_generation_exemplars` cascades: exact vibe_preset match → brand-wide fallback; `p_preset_name` priority, `p_window_days` time scope (default 30d)
- [x] Negative exemplars — `get_negative_exemplars` RPC fetches bottom performers (performance_value < 20); injected as "avoid these patterns" in prompt
- [x] View hardening — `v_post_variant_performance` + `v_top_metadata_patterns` now include `collected_at` from metrics
- [x] Fix `get_negative_exemplars` — added missing `p_preset_name` param with COALESCE cascade (matches `get_generation_exemplars` behavior)
- [x] Winning patterns cache — `winning_metadata_patterns` table caches derived patterns (top hooks, hashtag sets, CTA phrases, length stats) per brand/platform/vibe
- [x] Pattern computation RPCs — `recompute_winning_patterns` (single combo), `recompute_all_winning_patterns` (iterates all combos + brand-wide NULL vibe rows)
- [x] Pattern retrieval — `get_winning_patterns` RPC with vibe→brand-wide fallback cascade
- [x] Nightly cron — pg_cron `recompute-winning-patterns` at 03:00 UTC
- [x] Generator integration — winning patterns injected into prompt (hooks as bullets, hashtags with counts, CTAs, optimal lengths)

**Reference:** [CAPTION_TAGS_LEARNING.md](CAPTION_TAGS_LEARNING.md)

---

## 🧪 LEVEL 4 — ADVANCED AUTOMATION (Later)

### 21. Multi-Worker Scaling (2–3 Max)

- [ ] Concurrency limits by phase
- [ ] Worker identification
- [ ] Load balancing
- [ ] Conflict resolution

---

### 22. ✅ Story Uniqueness Threshold Enforcement — COMPLETE

> **Status:** ✅ COMPLETE (February 19, 2026)

- [x] `check_story_uniqueness` RPC — brand-level collision check with configurable threshold
- [x] Worker-v1 enforcement — rejects stories below 0.6 uniqueness score
- [x] Rejection metadata stored (similar_job_ids, score)
- [x] Forces regeneration on uniqueness failure
- [ ] Embeddings + cooldown logic (future)
- [ ] Story reuse scoring (future)

**Reference:** [STORY_UNIQUENESS.md](STORY_UNIQUENESS.md)

---

### 23. Human Review Mode (Partial)

> **Status:** 🟡 Foundation laid (February 19, 2026)

- [x] Draft status support — posts can be created as 'draft'
- [x] `promote_draft_to_scheduled` RPC — approve draft → scheduled
- [x] `reject_draft` RPC — reject draft → cancelled with reason
- [ ] Review queue UI
- [ ] Batch approval
- [ ] Generate but don't post until approved (full pipeline integration)

---

### 24. ✅ Brand Profiles Fully Automated — COMPLETE

> **Status:** ✅ COMPLETE (February 19, 2026)

All brand configuration is now in `brand_templates.config_overrides` JSONB with full UI on the brands page.

**Already Complete (from prior work):**
- [x] Presets per brand — Vibe Presets modal (add/remove/weight sliders/distribution preview)
- [x] Music selection per brand — Music modal (upload MP3, per-track volume/mood/energy, play preview)
- [x] Subtitle styles per brand — Subtitle modal (10 styles, font size, position, emphasis, live preview)
- [x] Effects per brand — Effects modal (Ken Burns, grain, flicker, vignette, color grade, fade, brand ceilings)
- [x] Image prompts per brand — Image Prompt modal (art style, environment, palette, lighting, mood, cameras)

**New in this update:**
- [x] Voice config per brand — Voice modal (9 OpenAI TTS voices, custom instructions, speed multiplier)
  - Worker reads `config_overrides.voice` with preset-level fallback
  - `getPresetVoiceConfig(vibePreset, brandVoiceConfig)` — brand override > preset default
- [x] Schedule windows per brand — Schedule modal (posting hours, active days, max posts/day, min gap, blackout)
  - Stored in `config_overrides.schedule` JSONB
- [x] Music advanced settings — Collapsible panel (enable/disable toggle, ducking volume/attack/release, fade in/out)
  - Was in DB but lacked UI — now fully surfaced
- [x] All config in `brand_templates.config_overrides` — Keys: music, effects, subtitles, image_prompt, voice, schedule

**Config Override Keys (all per-brand):**
| Key | UI | Worker | Notes |
|-----|-----|--------|-------|
| `music` | Music modal | `get_brand_music_config` RPC | Volume, ducking, fade |
| `effects` | Effects modal | `get_effects_config_for_job` RPC | 4-layer merge |
| `subtitles` | Subtitle modal | `get_subtitle_config_for_job` RPC | 4-layer merge |
| `image_prompt` | Image Prompt modal | `get_image_prompt_config_for_job` RPC | 4-layer merge |
| `voice` | Voice modal | Direct DB read in steps.ts | Preset fallback |
| `schedule` | Schedule modal | Read by scheduler (planned) | Posting windows |

**Smoke Tests:** 32/32 pass — voice CRUD, schedule CRUD, music advanced CRUD, config completeness

**Files:**
- `pages/brands.html` (Voice + Schedule modals, music advanced panel, JS controllers)
- `css/brands.css` (voice preview, schedule days/time/summary, music advanced, slider rows)
- `js/services/brandManager.js` (getVoiceConfig, saveVoiceConfig, getScheduleConfig, saveScheduleConfig)
- `supabase/functions/worker-v1/helpers.ts` (getPresetVoiceConfig with brand override param)
- `supabase/functions/worker-v1/steps.ts` (brand voice config loading in scene + voice steps)
- `scripts/smoke-test-brand-profiles.js`

---

### 25. Campaign Templates

- [ ] One-click recurring plans
- [ ] Template library
- [ ] Clone existing campaigns
- [ ] Seasonal templates

---

## 🏁 LEVEL 5 — FULLY COMPLETE SYSTEM

### 26. Cross-Platform Optimization Engine (Partial)

> **Status:** 🟡 Foundation laid (February 19, 2026)

- [x] `v_cross_platform_performance` view — per-platform metrics with perf_score
- [x] Strategy intelligence system — `post_strategies` + `platform_strategies` tables, 20 seeded strategies
- [x] `v_strategy_performance` view — strategy effectiveness by platform/brand
- [x] `get_top_strategies` RPC — probabilistic weighted selection
- [x] Strategy-driven metadata generation — strategy type injected into AI prompts
- [x] Time-aware metadata generation — day/time of posting influences prompt tone
- [x] Cross-Platform & Strategy tab on AI Intelligence page
- [ ] Preset weights adapt by performance
- [ ] Schedule adapts by performance
- [ ] ML-driven recommendations

---

### 27. Dashboard (Partial)

> **Status:** 🟡 Progress (February 19, 2026)

- [x] `v_visual_performance` view — image pipeline stats linked to metrics
- [x] Dashboard N+1 fix — bulk queries for brand overview
- [x] Mobile responsive design — all 13 pages responsive
- [ ] Costs per video
- [ ] Failure rates
- [ ] Performance by preset
- [ ] Best time windows
- [ ] Brand comparisons
- [ ] Trend analysis

---

### 28. ✅ Alerts/Notifications — COMPLETE

> **Status:** ✅ COMPLETE (February 19, 2026)

- [x] `brand_alert_config` table — per-brand webhook URLs
- [x] `system_alert_config` table — global alert webhooks
- [x] `sendAlertWebhooks()` in schedule-jobs — fires on kill switch, budget exceeded, campaign paused
- [x] Discord webhook support — color-coded embeds by severity
- [x] Slack webhook support — attachments with fields
- [x] Generic JSON webhook support
- [x] Configurable events per webhook (token_expired, campaign_paused, budget_exceeded, renderer_down, etc.)
- [ ] Daily/weekly summaries
- [ ] Campaign complete notifications

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
└── 11. ✅ Kill Switch (DONE)

NEXT (Level 2)
├── 12. ✅ 4 Active Presets (DONE)
├── 13. ✅ Quality Gates (DONE)
├── 14. ✅ Subtitles (DONE)
├── 15. ✅ Effects (DONE)
└── 16. ✅ Safety Filters (DONE)

MID (Level 3)
├── 17. ✅ Post Registry (DONE)
├── 18. ✅ Metrics Collection (DONE)
├── 19. ✅ Time Slot Scoring (DONE)
└── 20. ✅ Caption Learning (DONE)

LATER (Level 4)
├── 21. Multi-Worker
├── 22. ✅ Similarity Thresholds (DONE)
├── 23. 🟡 Human Review (Foundation)
├── 24. ✅ Brand Automation (DONE)
└── 25. Campaign Templates

FINAL (Level 5)
├── 26. 🟡 Optimization Engine (Foundation)
├── 27. 🟡 Dashboard (Partial)
└── 28. ✅ Alerts (DONE)
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
- [STRATEGY_INTELLIGENCE_ROADMAP.md](STRATEGY_INTELLIGENCE_ROADMAP.md) — Strategy intelligence system
- [POST_ANALYTICS_SYSTEM.md](POST_ANALYTICS_SYSTEM.md) — Metrics collection
- [FAILURE_PROTECTION_DLQ.md](FAILURE_PROTECTION_DLQ.md) — Failure protection & DLQ
- [POST_METADATA_SYSTEM.md](POST_METADATA_SYSTEM.md) — AI metadata generation
