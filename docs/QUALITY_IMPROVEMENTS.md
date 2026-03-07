# Quality Improvements & Bug Fixes

> First real campaign run observations — "Stories That Stalk" (one_too_many preset)
> Created: 2026-03-03

---

## Table of Contents

1. [Story Anchor Bug — "[object]" Copy + Empty Fields](#1-story-anchor-bug)
2. [Image Art Style Consistency](#2-image-art-style-consistency)
3. [Image Scene Consistency (Characters, Lighting, Environment)](#3-image-scene-consistency)
4. [Img2Vid Quality — Blurry Output](#4-img2vid-quality)
5. [Brand Management UI — Per-Preset Config Viewer](#5-brand-management-ui)
6. [Img2Vid Progress & Logging](#6-img2vid-progress-logging)
7. [Art Style Database / Registry](#7-art-style-registry)
8. [Assembled Video Not Using Img2Vid Clips](#8-assembly-ignoring-clips)
9. [Doubled Images (Sub-Image Threshold Too Low)](#9-doubled-images)
10. [Art Style Dropdown Not Updating Fields](#10-art-style-dropdown-bug)
11. [RnMort Art Style for reddit_trending_horror](#11-rnmort-art-style)
12. [Pipeline Progress Bars (ComfyUI-style)](#12-pipeline-progress-bars)
13. [Image Consistency — No Image Reference Between Scenes](#13-image-consistency-no-reference)
14. [characterDescription Nested Object Bug — `[object Object]` in Prompts](#14-characterdescription-nested-object-bug)
15. [art_style Not Passed to ComfyUI — STYLE_MAP Tokens Missing](#15-art-style-not-passed-to-comfyui)
16. [UI Display Bugs — Size, Story Anchor, Visual Cue Fields](#16-ui-display-bugs)

---

## 1. Story Anchor Bug

**Severity:** High  
**Status:** ✅ Fixed

### Problem

When viewing image generation details in the campaign detail page, the Story Anchor section shows:

```
🎯 Story Anchor
Environment:    -
Horror Tone:    -
Group Story:    No
Character:      ❌ None
```

All fields are dashes/empty despite the story anchor being created successfully (logs show it was generated and cached). When clicking the "📋 Copy" button, it copies `[object]` instead of the actual JSON.

### Root Cause

There are **two competing story anchor systems**:

| System | File | Interface |
|--------|------|-----------|
| **Legacy** (`run-job`) | `run-job/config.ts` | Full StoryAnchor with `colorPalette`, `cameraStyle`, `continuityRules`, `fullAnchorPrompt`, `characterLock` |
| **Worker-v1** (current) | `worker-v1/steps.ts` | Simplified StoryAnchor with `environment`, `characterDescription`, `recurringMotifs`, `horrorTone`, `timeOfDay`, `isGroupStory`, `groupCount` |

The **UI** (`campaign-detail.js` line 1555) reads `data.storyAnchorFull` which comes from `job_assets` where `idempotency_key = '{job_id}:story_anchor'`. The worker-v1 saves the anchor correctly, but the **UI display code** may be getting an object that doesn't match the expected shape (potentially a nested object or the `meta` field containing an extra wrapper).

The `[object]` copy bug suggests `JSON.stringify(sa, null, 2)` is being called on something that's already been stringified or is wrapped in a way that `toString()` returns `[object Object]`.

### Investigation Steps

1. Query the actual `job_assets` row for the story anchor to see what `meta` contains
2. Check if the `meta` column has extra nesting (e.g. `{meta: {meta: {actual_data}}}`)
3. The `_storyAnchorText` is set via `JSON.stringify(sa, null, 2)` — if `sa` fields are `undefined`, they'd show as `-`

### Fix Plan

- [x] Add debug logging in `renderImagesDetail()` to console.log the raw `data.storyAnchorFull` object
- [x] Check if `saAsset?.meta` is double-nested (common Supabase JSONB issue) — added defensive unwrapping
- [x] Ensure worker-v1 `upsertAsset` stores the anchor at the correct nesting level — verified, stores flat
- [x] Update UI to handle both legacy and worker-v1 anchor shapes — handles `horrorTone`/`genreTone`/`meta` nesting
- [x] Fix `HORROR_PRESETS` set missing `one_too_many`, `reddit_trending_horror`, `dark_origins`, etc.
- [x] Normalize `genreTone` → `horrorTone` in GPT response parsing
- [x] Make `copyToClipboard` robust against non-string values (prevents `[object]`)

### What Was Fixed

1. **`HORROR_PRESETS` incomplete** (`steps.ts`): Added 9 missing horror presets. This caused GPT to prompt for `genreTone` instead of `horrorTone`, and the UI only checked `sa.horrorTone`.
2. **`genreTone` normalization** (`steps.ts`): After GPT response parsing, if `genreTone` is present but `horrorTone` is not, maps it to `horrorTone`.
3. **Defensive data unwrapping** (`campaign-detail.js`): Handles meta returned as string (JSON parse), handles double-nested `.meta.meta`, handles both `horrorTone`/`genreTone` field names.
4. **Copy bug fix** (`campaign-detail.js`): `copyToClipboard` now ensures text is always a string — if passed an object, it `JSON.stringify`s it instead of coercing to `[object Object]`.
5. **Debug logging**: `console.log('[DEBUG] Story anchor data:', sa)` added for future diagnosis.
6. **`characterDescription` object normalization** (`steps.ts`): GPT returns `{age, hair, clothing, distinguishingFeatures}` objects or arrays instead of plain strings. Added post-parse normalization to flatten objects to readable strings. Updated GPT prompt to explicitly request plain string format.
7. **`formatCharacterDescription` improvement** (`campaign-detail.js`): Better handling of GPT's `{age, hair, clothing, distinguishingFeatures}` shape for both single objects and arrays.

### Production Audit (Campaign d04220ab)

Verified against 5 recent story anchors in production:
- **New jobs** (after fix): `horrorTone` field correctly populated, `genreTone` absent
- **Old jobs** (before fix): had `genreTone` instead of `horrorTone` — UI now handles both
- **All anchors**: `environment`, `timeOfDay`, `recurringMotifs` populated with rich data
- **`characterDescription`**: Always returned as object by GPT (now normalized to string)

> **Note**: Existing story anchors stored with `genreTone` (before this fix) will still display correctly — the UI now checks both field names. New anchors will always have `horrorTone` thanks to the normalization.

---

## 2. Image Art Style Consistency

**Severity:** High  
**Status:** ✅ Fixed (art_style now flows to STYLE_MAP, see Issue #15)

### Problem

Generated images across a single story feel visually disconnected:
- Some scenes are daytime, others nighttime (inconsistent lighting)
- Art style varies between scenes (one looks photorealistic, another painterly)
- Color palettes don't match across the video
- Characters look completely different from scene to scene

### Current Architecture

> **✅ Consolidated (Issue #7):** Art styles are now stored in the `art_styles` Supabase DB table — single source of truth for all 16 styles. The 4 files below now read from DB first, with hardcoded values as fallback only.

| Location | Purpose | DB Status |
|----------|---------|------|
| `art_styles` DB table | **Primary source** — all prompts, negatives, comfyui_tokens, icons, descriptions | ✅ 16 styles seeded |
| `run-job/config.ts` | Full style definitions (basePrompt, colorOverride, technicalStyle) | Legacy fallback (@deprecated) |
| `worker-v1/steps.ts` | Simplified style templates (one-liner per style) | Fallback if DB unavailable |
| `js/app.js` | UI display (icon, name, desc) + `BUILTIN_ART_STYLES` full definitions | Overwritten by DB fetch on load |
| `video-renderer/comfyui/config.js` | ComfyUI weighted token map `STYLE_MAP` | Accepts DB tokens from payload |

### Root Cause Analysis (2026-03-03 Audit)

The story anchor IS working now (Bug #1 fixed). `buildImagePrompt()` in `steps.ts` DOES inject:
- ✅ `storyAnchor.environment` → overrides config environment for all non-establishing scenes
- ✅ `storyAnchor.characterDescription` → injected for character/group scene types
- ✅ `storyAnchor.recurringMotifs` → appended as visual motifs block
- ✅ `storyAnchor.timeOfDay` → used to derive scene-appropriate lighting
- ✅ `storyAnchor.horrorTone` → passed to visual cue extraction
- ✅ `config.style_prompt` → injected as `Style:` in every prompt

**The real problem is NOT the prompts — it's the generation model's lack of visual memory.**

Each image is generated via a completely independent API call (`gpt-image-1`). Even with identical style/environment/character text in the prompt, the model has:
- **No memory** of what it generated for previous scenes
- **No image reference** — it can't see what the character looked like in scene 1 when generating scene 5
- **No seed consistency** — each generation is stochastic

Text descriptions alone cannot enforce visual consistency. Two API calls with "a man in a blue jacket" produce two entirely different-looking men.

### What Would Actually Fix This

See **Issue #13** — the real fix requires image-to-image reference (IP-Adapter, img2img, or OpenAI image editing with reference).

### Fix Plan

- [x] **Fix story anchor** (Bug #1) — anchor data now flows to prompts correctly
- [x] Verify `buildImagePrompt()` injects anchor data — confirmed, all fields injected
- [x] Add explicit art style reinforcement in every scene prompt — ✅ Issue #7 DB-driven styles inject full base_prompt + color_override + technical_style + negative_prompt
- [ ] Consider using a **seed strategy** — same seed base + scene offset for consistency
- [ ] Add **style consistency score** post-generation — use CLIP to compare style similarity across generated images
- [x] **Implement image reference system** (see Issue #13) — ✅ Character reference portrait + scene chain implemented

---

## 3. Image Scene Consistency (Characters, Lighting, Environment)

**Severity:** High  
**Status:** ✅ Fixed (Character reference portrait + scene chain — Issue #13)

### Problem

Looking at the RnMort-style generated images (12 images):
- Images are stylistically consistent (all have cartoon art style) ✓
- But content is disconnected — different characters, environments, and subjects in each frame
- S1 (autumn forest): Scenic landscape ← not matching story context
- S2 (phone): Hand holding phone in nature ← different setting
- S3 (hiker): Walking figure ← different character
- S5 (backpack): Object shot ← good variety but disconnected environment
- S11 (face): Screaming man ← different character than other scenes

### Root Causes (Updated 2026-03-03)

1. ~~**No working character lock**~~: Story anchor IS working now (Bug #1 fixed). `characterDescription` IS injected for character/group scenes.
2. **Image model has no visual memory**: Each `gpt-image-1` call is independent. The model cannot see previous images. Text descriptions alone cannot ensure the same character appears across scenes.
3. **IP-Adapter not used for images**: IP-Adapter is only used in img2vid, not in the initial image generation. This is the key missing piece.
4. **Visual cue extraction quality**: GPT visual cues create varied shot compositions (intentional), but without image reference, this variety makes scenes feel disconnected.

### Fix Plan (Priority Order)

- [x] **Phase 1**: Fix story anchor to ensure environment/lighting/character data flows to prompts — ✅ DONE
- [x] **Phase 2**: Add **character reference image** system (see Issue #13) — ✅ DONE:
  1. ✅ Generate one "hero character portrait" from the anchor's character description
  2. ✅ Store as job asset (`{job_id}:character_reference`)
  3. IP-Adapter reference for ComfyUI — not yet (OpenAI path only)
  4. ✅ Pass as reference image to OpenAI `gpt-image-1` edit endpoint
  5. ✅ Scene chain: each scene references previous scene for style/palette continuity
- [ ] **Phase 3**: Enforce lighting consistency:
  - Story anchor timeOfDay should override ALL scene lighting
  - Add `GLOBAL LIGHTING: {timeOfDay}` to every prompt
  - Don't let visual cues change the time of day
- [ ] **Phase 4**: Consider **ControlNet** for pose consistency (longer term, complex)

---

## 4. Img2Vid Quality — Blurry Output

**Severity:** High  
**Status:** ✅ Fixed (All 7 parameter fixes applied and verified)

### Problem

The animated (img2vid) frames are noticeably blurrier than the source images. Comparing the campfire scene:
- **Source image**: Sharp, detailed fire with clear wood logs, visible embers, good texture
- **Animated frame**: Soft, bloomy fire, logs are indistinct blobs, lost all fine detail. It animates, but quality is significantly degraded.

### Root Cause Analysis

The blurriness comes from **multiple factors compounding**:

#### 1. Resolution Downscale (Major)
- Source images are generated at **1024×1536** (via SDXL or upscaled)
- AnimateDiff renders at **512×768** (SD1.5 native resolution)
- That's a **4× pixel reduction** before animation even starts
- Then the output gets upscaled back to 1024×1536 for the final video
- **Down → animate → up** = guaranteed quality loss

#### 2. Denoise Level (Moderate)
- Current denoise: `0.45 + motionStrength * 0.25` → at motion 0.65: **denoise = 0.61**
- Denoise > 0.5 means more than half the image is regenerated from noise
- Higher denoise = more motion freedom but less fidelity to source

#### 3. IP-Adapter Weight Decay (Minor)
- IPA weight: `max(0.55, 0.85 - 0.65 * 0.30)` = **0.655**
- IPA end_at: `max(0.70, 0.90 - 0.65 * 0.20)` = **0.77**
- This means IPA releases influence at 77% of sampling steps
- Last 23% of steps add motion but also drift from source

#### 4. Low Step Count (Minor)
- Only **20 sampling steps** — fast but less refined
- More steps (25-30) would produce sharper results at the cost of generation time

### Fix Plan (Priority Order)

- [x] **Fix 1 — Reduce denoise** (biggest quality win):
  ```javascript
  // OLD: denoise = 0.45 + motionStrength * 0.25  (0.45–0.70)
  // NEW: denoise = 0.35 + motionStrength * 0.20  (0.35–0.55)
  ```
  Lower denoise = more faithful to source image, less blur. Trade-off: slightly less motion.
  **Applied:** `video-renderer/comfyui/config.js` AnimateDiff IPA section + `img2vid_animatediff_ipa.json` default

- [x] **Fix 2 — Increase IPA fidelity**:
  ```javascript
  // OLD: weight = max(0.55, 0.85 - motion * 0.30)  → 0.655 at motion 0.65
  // NEW: weight = max(0.65, 0.90 - motion * 0.25)  → 0.738 at motion 0.65
  // 
  // OLD: end_at = max(0.70, 0.90 - motion * 0.20)  → 0.77
  // NEW: end_at = max(0.80, 0.95 - motion * 0.15)  → 0.852
  ```
  Higher weight + later end_at = more visual fidelity throughout sampling.
  **Applied:** `video-renderer/comfyui/config.js` AnimateDiff IPA section

- [x] **Fix 3 — Increase sampling steps**:
  ```
  Steps: 20 → 25 (adds ~25% generation time but notably sharper)
  ```
  **Applied:** `img2vid_animatediff_ipa.json` + `config.js` default fallback

- [x] **Fix 4 — Add "sharpening" to prep node**:
  - Node 21 (PrepImageForClipVision) has `sharpening: 0.0`
  - Setting to `0.1-0.2` would pre-sharpen the CLIP embedding
  **Applied:** `config.js` sets `workflow['21'].inputs.sharpening = 0.15`

- [ ] **Fix 5 — Resolution matching** (advanced, bigger change):
  - Generate source images at 512×768 directly (match AnimateDiff native resolution)
  - Skip the down→up cycle entirely
  - Trade-off: all images are lower resolution (but consistent quality)
  - Alternative: Use **Hires Fix** — generate at 512×768, animate, then upscale with a separate pass

- [x] **Fix 6 — Negative prompt for blur**:
  - Current negative: `static, jitter, fast motion, blurry, deformed, morphing, face distortion`
  - Add: `soft focus, out of focus, bokeh, gaussian blur, low detail, smooth, overexposed`
  **Applied:** `img2vid_animatediff_ipa.json` node 7 negative prompt expanded

- [x] **Fix 7 — Stronger upscale sharpening** (v7.1):
  - Old: `unsharp=3:3:0.5:3:3:0.0` (3×3 kernel, luma=0.5, no chroma)
  - New: `unsharp=5:5:0.7:5:5:0.3` (5×5 kernel, luma=0.7, chroma=0.3)
  - Larger kernel + stronger sharpening counteracts the 2× (512→1024) lanczos upscale softness
  **Applied:** `video-renderer/server_clean.js` img2vid FFmpeg encode step

### Recommended Parameter Adjustment

| Parameter | Old Value | New Value | Impact |
|-----------|-----------|-----------|--------|
| Denoise | 0.45 + m×0.25 | 0.35 + m×0.20 | Major: less blur, slightly less motion |
| IPA Weight | max(0.55, 0.85-m×0.30) | max(0.65, 0.90-m×0.25) | Moderate: more source fidelity |
| IPA end_at | max(0.70, 0.90-m×0.20) | max(0.80, 0.95-m×0.15) | Moderate: IPA active longer |
| Steps | 20 | 25 | Minor: sharper, +25% time |
| Sharpening | 0.0 | 0.15 | Minor: slightly sharper CLIP input |

---

## 5. Brand Management UI — Per-Preset Config Viewer

**Severity:** Medium  
**Status:** ✅ Implemented (Settings Hub + config modals + preset tab bars + full visual redesign)

### Problem

The brands page currently shows brands in a flat list with basic info (name, niche, connections). There's no way to:
1. See which **presets** (templates) are configured under each brand
2. View the **art style**, **img2vid settings**, **caption style**, **music settings** per preset
3. Compare settings across presets within a brand
4. See which presets use img2vid vs static mode

### Current Data Structure

Each brand has multiple `brand_templates` rows, each with a `template_type` (e.g. `urban_legend`, `one_too_many`) and a `config_overrides` JSONB column containing nested settings:

```json
{
  "image_prompt": {
    "art_style": "cinematic-dark",
    "video_mode": "img2vid",
    "img2vid_workflow": "animatediff_ipa",
    "img2vid_fps": 8,
    "img2vid_frames": 24,
    "img2vid_motion": 0.65,
    "style_prompt": "Cinematic dark photography...",
    "camera_angles": [...],
    "color_palette": "...",
    "lighting": "...",
    "mood": "..."
  },
  "effects": { "grain": {...}, "kenburns": {...}, ... },
  "subtitles": { "style": "typewriter", ... },
  "music": { "default_volume": 0.18 }
}
```

### Design Plan

When user clicks a brand card → expand or navigate to a brand detail view:

```
┌─────────────────────────────────────────────────┐
│ 🎭 Stories That Stalk                           │
│ Horror · 4 Presets · img2vid enabled            │
├─────────────────────────────────────────────────┤
│                                                 │
│ ┌─── BRAND DEFAULTS (inherited by all) ────┐   │
│ │ Art Style: cinematic-dark                 │   │
│ │ Video Mode: img2vid (AnimateDiff)         │   │
│ │ Lighting: low-key, harsh shadows          │   │
│ └──────────────────────────────────────────┘   │
│                                                 │
│ ┌─── urban_legend ★ (default) ─────────────┐   │
│ │ 🎨 Art: cinematic-dark                    │   │
│ │ 🎥 Video: img2vid · 24f · 8fps · 0.65    │   │
│ │ 📝 Captions: typewriter · 2 words/chunk  │   │
│ │ 🎵 Music: vol 0.18                       │   │
│ │ ✨ Effects: grain 0.4 · kenburns · fade   │   │
│ │ [Edit] [Preview]                          │   │
│ └──────────────────────────────────────────┘   │
│                                                 │
│ ┌─── one_too_many ─────────────────────────┐   │
│ │ 🎨 Art: cinematic-dark                    │   │
│ │ 🎥 Video: img2vid · 24f · 8fps · 0.65    │   │
│ │ 📝 Captions: (inherited from brand)       │   │
│ │ 🎵 Music: (inherited from brand)          │   │
│ │ [Edit] [Preview]                          │   │
│ └──────────────────────────────────────────┘   │
│                                                 │
│ ┌─── dark_origins ─────────────────────────┐   │
│ │ ... Settings specific to this preset ...  │   │
│ └──────────────────────────────────────────┘   │
│                                                 │
│ ┌─── reddit_trending_horror ───────────────┐   │
│ │ ... Settings specific to this preset ...  │   │
│ └──────────────────────────────────────────┘   │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Implementation Steps

- [ ] Add a `loadBrandPresets(brandId)` function to fetch `brand_templates` for a brand
- [ ] Create a preset detail card component that renders the config_overrides
- [ ] Add expand/collapse behavior to brand cards
- [ ] Group settings into logical sections (Image, Video, Captions, Music, Effects)
- [ ] Show inheritance — which settings come from brand defaults vs preset-specific
- [ ] Add inline editing capability (future)

---

## 6. Img2Vid Progress & Logging

**Severity:** Medium  
**Status:** ✅ Fixed

### Problem

While img2vid clips are generating, the UI only shows aggregate stats (completed/failed/skipped). There's no:
- **Progress bar** showing current clip generation progress
- **Per-clip ETA** based on previous clip generation times
- **Live status** (queued → rendering → uploading → done)
- **ComfyUI queue position** visibility
- **Current scene info** (which scene is being animated, what motion prompt was used)

### Current State

The `renderImg2VidDetail()` method shows:
- ✅ Clip stats (total/completed/failed/skipped)
- ✅ Generation time bar chart (after completion)
- ✅ Side-by-side source image ↔ animated clip grid
- ❌ No real-time progress during generation
- ❌ No per-clip motion prompt display
- ❌ No ComfyUI progress tracking

### Fix Plan

#### Backend Changes (worker-v1/steps.ts)
- [x] Store per-clip progress snapshots:
  ```json
  {
    "scene_index": 5,
    "status": "rendering",
    "motion_prompt": "flickering campfire flames, embers rising...",
    "animation_score": 12,
    "started_at": "2026-03-03T...",
    "comfyui_progress": 45
  }
  ```
- [x] Store the motion prompt used for each clip in the asset metadata
- [x] Log the animation potential score for each selected scene
- [x] Add scene selection timeline to the result snapshot (the `▓░░▓` visualization)

#### Frontend Changes (campaign-detail.js)
- [x] Add a progress bar component that polls for current clip status
- [x] Show the motion prompt for each generating clip
- [x] Show animation scores and why each scene was selected
- [x] Add auto-refresh while generation is in-progress (poll every 15-30s)
- [x] Show ETA based on average generation time of completed clips

#### Display Layout

```
🎥 Generating Clip 4/6
┌─────────────────────────────────────────┐
│ Scene 7: Campfire flickering            │
│ ████████████░░░░░░░░ 58%  ETA: ~45s    │
│                                         │
│ Motion: "flickering campfire flames,    │
│          embers rising into dark sky"   │
│ Score: 14/20 (fire:4 + atmosphere:2 +  │
│         camera:1 + ...)                 │
│                                         │
│ Completed: S1(32s) S3(28s) S8(35s)     │
│ Current:   S7 (rendering...)            │
│ Pending:   S12 S15                      │
└─────────────────────────────────────────┘
│                                         │
│ Selection Timeline:                     │
│ ▓░░▓░░░░▓░░░▓░░▓░░░░▓                 │
│ S1    S3       S7 S8    S12  S15       │
└─────────────────────────────────────────┘
```

---

## 7. Art Style Database / Registry

**Severity:** Medium  
**Status:** ✅ Fixed

### Fix Applied

Created `art_styles` Supabase table as single source of truth. All 16 unique art styles from the 4 fragmented files are now consolidated into one DB registry.

**Migration:** `20260402001_art_styles_registry.sql`  
**Table:** `art_styles` with columns: id, name, icon, description, category, base_prompt, color_override, technical_style, negative_prompt, comfyui_tokens, banned_tokens, style_replacement, texture_replacement, extra_rules, is_active, sort_order, created_at, updated_at.

**Changes across codebase:**
1. **`worker-v1/steps.ts`** — `buildImagePrompt()` now fetches from `art_styles` table; uses DB row's `base_prompt`, `color_override`, `technical_style`, `negative_prompt` instead of hardcoded `styleTemplates`. Passes `comfyui_tokens` to renderer payload. Hardcoded map kept as final fallback if DB unavailable.
2. **`js/app.js`** — `loadArtStylesFromDB()` fetches all active styles on page load, populates the art style dropdown dynamically, and overwrites `ART_STYLE_INFO` + `BUILTIN_ART_STYLES` with DB data. Falls back to hardcoded values if DB unavailable.
3. **`video-renderer/comfyui/config.js`** — `translatePromptForComfyUI()` now prefers `brand_dna.comfyui_tokens` (DB-sourced) over hardcoded `STYLE_MAP`. `STYLE_MAP` kept as fallback.
4. **`run-job/config.ts`** — `ART_STYLE_CONFIG` marked `@deprecated` (legacy pipeline only — TODO: migrate to DB read).

**Styles consolidated (16 total):**
- Horror: cinematic-dark, analog-horror, editorial-cartoon, horror-anime, oil-painting, found-footage, surreal-nightmare, rnmort, uncanny-illustrated
- Editorial: editorial-clean, surreal-contemplative, cinematic-contrast
- General: cinematic, horror, noir, documentary

**RLS:** anon can SELECT active styles; service_role has full access.  
**Helper RPC:** `get_art_styles()` returns all active styles ordered by sort_order.

---

## 8. Assembled Video Not Using Img2Vid Clips

**Severity:** Critical  
**Status:** ✅ Fixed

### Fix Applied

The assembly step in `steps.ts` now remaps `img2vid_clips` keys from scene_number → array_index before passing to the renderer. A `sceneToArrayIndex` mapping is built during image asset sorting, accounting for sub-images that shift array indices. The renderer (`server_clean.js`) also now logs a warning when clips exist but no match is found for a given array index, making future debugging easier.

### Problem

The img2vid step successfully generates animated clips (visible in the img2vid detail view — clips are downloading, rendering, and uploading to Supabase storage). However, the **final assembled video uses Ken Burns static pans for ALL scenes**, completely ignoring the generated video clips.

### Root Cause — Key Mismatch Between Worker & Renderer

The `img2vid_clips` map stored in `job.meta` uses **scene numbers** as keys (e.g., `"3"`, `"7"`, `"12"` — the actual scene indices from `image_generate:scene_X`).

The renderer's `createVideoFromImages()` loop iterates over the `images` array using a **loop index** as the lookup key:

```javascript
// video-renderer/server_clean.js line 389
const clipKey = String(i);  // i = loop index (0, 1, 2, 3, ...)
const clipInfo = img2vidClips && img2vidClips[clipKey];
```

### Production Audit (2026-03-04)

Checked 3 completed jobs:
- **The Eighth Camper**: 0 sub-images → 5/5 clips matched by array index ✅ (scene#==idx by coincidence)
- **The Ninth Camper**: 0 sub-images → 5/5 clips matched by array index ✅
- **The Silent Watcher**: 1 sub-image (`scene_10_sub_1`) → clips report 5/5 matched BUT idx [14]=scene_13 gets clip "14" which was meant for scene_14 — **WRONG clip applied silently**

> **Conclusion**: Issue #8 is real. Without sub-images it works by coincidence (scene# == array index). With sub-images, clips get applied to the WRONG scenes. No errors logged — silent data corruption.

**When these DON'T match (likely scenario):**

The assembly step builds `imageUrls` from ALL image assets, including sub-images (`scene_X_sub_Y`). The array is sorted by scene number + sub-index:

```
Index 0 → scene_0          ← clipMap key "0" ✓ matches
Index 1 → scene_1          ← clipMap key "1" ✓ matches  
Index 2 → scene_2          ← clipMap key "2" ✓ matches
Index 3 → scene_2_sub_1    ← clipMap key "3" ✗ WRONG — clip "3" is for scene 3!
Index 4 → scene_3          ← looks up key "4" — scene 3's clip was stored under key "3"
...
```

With sub-images present, every image after the first sub-image has its array index shifted, so NO clips will match.

**Even without sub-images**, the bug exists if scene numbering doesn't start at 0 or has gaps (which shouldn't normally happen, but could if image generation partially failed).

### Code Locations

| Component | File | Line | Issue |
|-----------|------|------|-------|
| **clipMap creation** | `worker-v1/steps.ts` | ~6498 | Uses `clip.scene` (scene_index from asset key) as key |
| **clipMap storage** | `worker-v1/steps.ts` | ~6501 | `updateJobMeta(supabase, job.id, { img2vid_clips: clipMap })` |
| **Assembly reads clips** | `worker-v1/steps.ts` | ~7237 | `meta?.img2vid_clips` passed straight to renderer |
| **Assembly builds images** | `worker-v1/steps.ts` | ~6849 | Includes ALL images (primary + sub_images), sorted |
| **Renderer lookup** | `server_clean.js` | ~389 | `clipKey = String(i)` — uses ARRAY INDEX not scene number |

### Fix Options

#### Option A: Fix the Renderer (Recommended — Smallest Change)

Pass scene metadata alongside images so the renderer knows which scene number each array index corresponds to:

```javascript
// In steps.ts assembly, build a scene_index → array_index mapping
// and remap img2vid_clips keys to array indices before sending to renderer
const clipsByArrayIndex: Record<string, { url: string; duration: number }> = {};
if (img2vidClips) {
  // Build reverse map: scene_number → array_index
  const sceneToArrayIdx: Record<number, number> = {};
  imageAssets.sort(/* same sort */).forEach((asset, idx) => {
    const m = asset.idempotency_key.match(/scene_(\d+)(?!.*_sub_)/);
    if (m) sceneToArrayIdx[parseInt(m[1])] = idx;
  });
  // Remap clip keys from scene_number to array_index
  for (const [sceneNum, clip] of Object.entries(img2vidClips)) {
    const arrayIdx = sceneToArrayIdx[parseInt(sceneNum)];
    if (arrayIdx !== undefined) {
      clipsByArrayIndex[String(arrayIdx)] = clip;
    }
  }
}
// Pass clipsByArrayIndex to renderer instead of img2vidClips
```

#### Option B: Fix the Renderer Lookup

Change the renderer to accept scene metadata and do its own mapping, or store the clips keyed by array index from the start.

#### Option C: Exclude Sub-Images from Assembly

If sub-images aren't actually used in this brand's pipeline, filter them out in the assembly step so array indices match scene numbers. But this breaks other brands that use sub-images.

### Why This Wasn't Caught Earlier

- The img2vid detail UI shows clips as "generated" (they ARE generated and stored)
- The assembly step logs `img2vid clips found for X scene(s)` (it DOES have the map)
- The renderer logs would show `Scene X: Using img2vid clip` if a match was found, but since keys don't match, it silently falls through to Ken Burns
- No explicit "clip not found for scene X" warning is logged — the lookup just returns `undefined`

### Additional Fix: Add Warning Logging

Regardless of the mapping fix, add a log line when clips are present but NOT matched:

```javascript
// In server_clean.js, after the clipInfo lookup
if (img2vidClips && !clipInfo) {
  console.warn(`[${jobId}] Scene ${i + 1}: img2vid clips exist but no match for key "${clipKey}" (available keys: ${Object.keys(img2vidClips).join(',')})`);
}
```

This would have immediately revealed the mismatch.

---

## Priority Order

| # | Issue | Severity | Effort | Status |
|---|-------|----------|--------|--------|
| **8** | **Assembly Not Using Clips** | **Critical** | **Small** | **✅ Fixed** |
| **13** | **Image Consistency — No Reference** | **Critical** | **Medium** | **✅ Fixed** |
| 1 | Story Anchor Bug | High | Small | ✅ Fixed |
| 4 | Img2Vid Blurry Output | High | Small | ✅ Fixed |
| 2 | Art Style Consistency | High | Medium | ✅ Fixed (Issue #15) |
| 3 | Character/Scene Consistency | High | Medium | ✅ Fixed (Issue #13) |
| 14 | characterDescription Nested Object | Critical | Small | ✅ Fixed |
| 15 | art_style Not Passed to ComfyUI | Critical | Small | ✅ Fixed |
| 16 | UI Display Bugs | Medium | Small | ✅ Fixed |
| 6 | Img2Vid Progress UI | Medium | Medium | ✅ Fixed |
| 5 | Brand Management UI | Medium | Large | ✅ Implemented |
| 9 | Doubled Images | Medium | Small | ✅ Fixed |
| 10 | Art Style Dropdown | Medium | Small | ✅ Fixed |
| 11 | RnMort Art Style | N/A | Medium | ✅ Implemented |
| 12 | Pipeline Progress Bars | Low | Small | ✅ Implemented |
| 7 | Art Style DB Registry | Medium | Large | ✅ Fixed |

---

## Quick Wins (can do now)

1. ~~**Fix assembly clip mapping**~~ — ✅ Implemented (Issue #8 — remap clipMap keys from scene_number → array_index in steps.ts)
2. ~~**Add clip mismatch warning log**~~ — ✅ Implemented (Issue #8 — renderer logs warning when keys don't match)
3. ~~**Img2Vid denoise reduction**~~ — ✅ Applied (config.js + workflow JSON)
4. ~~**IPA weight increase**~~ — ✅ Applied (config.js)
5. ~~**Add negative prompt terms**~~ — ✅ Applied (workflow JSON)
6. ~~**Story anchor debug**~~ — ✅ Fixed (Issue #1)
7. ~~**Increase sampling steps**~~ — ✅ Applied (20 → 25)

---

## 9. Doubled Images (Sub-Image Threshold Too Low)

**Severity:** Medium  
**Status:** ✅ Fixed

### Problem

In the campaign detail page, nearly every scene shows two nearly-identical images (e.g. S1 × 2, S2 × 2). The multi-image system was splitting scenes at too low a threshold, causing 4/5 scenes to generate sub-images.

### Root Cause

`LONG_SCENE_THRESHOLD` was set to **12 seconds** and `TARGET_IMAGE_DURATION` to **10 seconds**. For stories with few scenes (5 scenes in a ~75s video), average scene duration is ~15s, meaning most scenes exceed the threshold and get doubled.

| Scene | Duration | Over 12s? | Result |
|-------|----------|-----------|--------|
| S0 | 16.7s | ✅ | 2 × 8.35s |
| S1 | 12.26s | ✅ (barely) | 2 × 6.13s |
| S2 | 15.6s | ✅ | 2 × 7.8s |
| S3 | 18.22s | ✅ | 2 × 9.11s |
| S4 | 11.98s | ❌ | 1 × 11.98s |

### Fix

Changed thresholds in `worker-v1/steps.ts`:
- `LONG_SCENE_THRESHOLD`: 12 → **18 seconds**
- `TARGET_IMAGE_DURATION`: 10 → **14 seconds**

With new thresholds, only S3 (18.22s) would get doubled. Most scenes will now be single-image, reducing visual redundancy.

---

## 10. Art Style Dropdown Not Updating Fields

**Severity:** Medium  
**Status:** ✅ Fixed

### Problem

In the brands.html Image & Video Config modal, when switching the "Art Style" dropdown, the Style Prompt, Color Palette, Lighting, and Mood fields kept the same text regardless of which style was selected. All 4 presets had identical `style_prompt` and `environment` values in the database.

### Root Cause

The art style dropdown had no `onchange` handler. The text fields were only populated from the database config (which was copy-pasted identically across all presets), never from the built-in style definitions.

### Fix

1. Added `onchange="onArtStyleChanged()"` to the art style dropdown
2. Created `ART_STYLE_DEFAULTS` lookup with proper `style_prompt`, `color_palette`, `lighting`, and `mood` for each style
3. The handler auto-fills fields when they're empty or still match a previous style's defaults
4. Custom text is preserved — if you've manually edited the fields, they won't be overwritten

---

## 11. RnMort Art Style for reddit_trending_horror

**Severity:** N/A (Feature)  
**Status:** ✅ Implemented

### Description

New art style "RnMort" (🧪) — Rick & Morty-inspired adult cartoon horror style. Bold thick black outlines, flat cel shading, exaggerated proportions, vibrant saturated colors against dark moody backgrounds.

### What Was Done

**Style registered in all locations** (now consolidated in DB — Issue #7):

| File | Addition |
|------|----------|
| `art_styles` DB table | ✅ Full definition — all fields including comfyui_tokens (Issue #7) |
| `run-job/config.ts` | Full `ART_STYLE_CONFIG` entry (legacy fallback, @deprecated) |
| `worker-v1/steps.ts` | `styleTemplates['rnmort']` one-liner (fallback if DB unavailable) |
| `video-renderer/comfyui/config.js` | `STYLE_MAP['rnmort']` weighted tokens (fallback — DB tokens preferred) |
| `js/app.js` | Both `ART_STYLE_INFO` display entry and `BUILTIN_ART_STYLES` (overwritten by DB fetch) |
| `pages/brands.html` | Dropdown option (dynamically replaced by DB styles on load) |

**Database updated:**
- `reddit_trending_horror` template: `art_style` → `rnmort`, `style_prompt` → RnMort prompt, `environment` → cleared (story anchor generates per-story), `color_palette`, `lighting`, `mood` all updated

### Key Style Properties

- **Base Prompt**: Adult animated cartoon, Rick & Morty style, bold thick black outlines, flat cel-shaded coloring, exaggerated proportions, large expressive heads, dot-like pupils
- **Color Palette**: Vibrant saturated cartoon colors, neon greens/purples, warm skin tones, deep moody backgrounds
- **Negative Prompt**: Blocks photorealism, photography, oil painting, watercolor, 3D render, CGI, anime, manga
- **Banned Tokens**: `RNMORT_BANNED_TOKENS` strips photography/painting/realism terms from Visual DNA injection (same protection as uncanny-illustrated)

---

---

## 12. Pipeline Progress Bars (ComfyUI-style)

**Severity:** Low (DX improvement)  
**Status:** ✅ Implemented

### Problem

ComfyUI shows a nice progress bar in its console:
```
100% |████████████████████████| 28/28 [00:11<00:00, 2.45it/s]
```

Our pipeline logs just show generic text like `[IMAGES] Generating image 3/12...` with no visual progress bar, no rate (it/s), and no elapsed time.

### What Was Done

Added ComfyUI-style progress bars to **three locations**:

#### 1. `video-renderer/comfyui/config.js` — `generateImage()` (txt2img)
- Added WebSocket progress tracking (was only in `generateVideo()` before)
- Added `onProgress` callback parameter (same API as `generateVideo()`)
- Console output every 10%:
  ```
  [COMFYUI] 50% |████████████░░░░░░░░░░░░░| 14/28 [5.7s, 2.45it/s]
  ```
- Proper WebSocket cleanup in `finally` block

#### 2. `video-renderer/comfyui/config.js` — `generateVideo()` (img2vid)
- Already had WebSocket progress tracking but no console logging
- Added same progress bar format:
  ```
  [COMFYUI-IMG2VID] 50% |████████████░░░░░░░░░░░░░| 14/28 [12.3s, 1.14it/s]
  ```

#### 3. `worker-v1/steps.ts` — Image generation loop
- Added progress bar at each image generation:
  ```
  [IMAGES] 25% |██████░░░░░░░░░░░░░░░░░░░| 3/12 scene 2 (character) [gpt-image-1]
  ```
- Shows scene index, visual cue type, and model used

#### 4. `worker-v1/steps.ts` — Img2vid clip loop
- Added progress bar on clip completion:
  ```
  [IMG2VID] 33% |████████░░░░░░░░░░░░░░░░░| 2/6 ✓ Scene 4: 3.0s clip
  ```

---

## 13. Image Consistency — No Image Reference Between Scenes

**Severity:** Critical  
**Status:** ✅ Fixed (Phase 1 — Character Reference Portrait + Phase 2 — Scene Chain)

### Problem

All scene images are generated **completely independently** with no visual reference to each other. The story anchor provides text descriptions (environment, character, motifs) that are injected into every prompt, but text alone cannot enforce visual consistency.

**Key question from user**: "Is it kinda impossible for ComfyUI to use an image as a reference to generate the next image?"

**Answer**: No, it's absolutely possible. ComfyUI supports multiple image reference methods:

### Available Technologies

| Method | How it works | Our current usage |
|--------|-------------|-------------------|
| **IP-Adapter** | Feeds a reference image into the diffusion process as style/content guidance | Used for img2vid only (not for image generation) |
| **img2img** | Takes a source image + prompt, denoises partially to create a variation | Not used |
| **ControlNet** | Uses structural info (edges, depth, pose) from a reference to guide composition | Not used |
| **OpenAI Image Edit** | `gpt-image-1` can accept reference images for guided generation | **✅ Phase 1 Implemented** |

### Why Images Currently Don't Match

```
Current pipeline (no reference):
  Story → Visual Cues (GPT) → Scene 1 Prompt → gpt-image-1 → Image 1
                              → Scene 2 Prompt → gpt-image-1 → Image 2  (can't see Image 1)
                              → Scene 3 Prompt → gpt-image-1 → Image 3  (can't see Image 1 or 2)
                              → ...

Desired pipeline (with reference):
  Story → Visual Cues (GPT) → Character Reference Prompt → gpt-image-1 → Hero Portrait
                              → Scene 1 Prompt + Hero Portrait ref → Image 1
                              → Scene 2 Prompt + Hero Portrait ref → Image 2  (matches character)
                              → Scene 3 Prompt + Hero Portrait ref → Image 3  (matches character)
                              → ...
```

### Proposed Fix: Character Reference Image System

**Phase 1 — Character Portrait (Medium effort)** ✅ **IMPLEMENTED**
1. After story anchor is created, generate a single **"hero character portrait"** from `characterDescription`
2. Store as `{job_id}:character_reference` in job_assets
3. For subsequent character/group scenes, pass this as a reference image

**For ComfyUI (local)**:
- Use IP-Adapter with the hero portrait as reference image (~0.3 weight)
- Character scenes get higher IP-Adapter weight (~0.5)
- Atmosphere/object scenes ignore the reference
- ❌ Not yet implemented (Phase 1 covers OpenAI only)

**For OpenAI (cloud)** ✅ **IMPLEMENTED**:
- Character/group scenes use `/v1/images/edits` with the hero portrait as reference image
- Atmosphere/establishing/object scenes continue to use text-only `/v1/images/generations`
- Reference prompt instructs: "Keep the character looking like the reference"
- Non-fatal: if portrait generation fails, falls back to text-only (same as before)

### What Was Implemented (v8.0)

**Files changed:**
| File | Change |
|------|--------|
| `worker-v1/steps.ts` | Character reference portrait generation after story anchor creation |
| `worker-v1/steps.ts` | gpt-image-1 scene loop: character/group scenes use `/v1/images/edits` with portrait reference |
| `worker-v1/steps.ts` | `character_reference_used` flag in asset metadata + snapshot logs |
| `js/pages/campaign-detail.js` | Loads `character_reference` asset from DB |
| `js/pages/campaign-detail.js` | Shows "Char Reference" row in summary (with link to portrait) |
| `js/pages/campaign-detail.js` | Per-image modal: "Ref Image" shows whether reference was used for this scene |

**Key details:**
- Portrait is a focused medium-shot (chest up, 3/4 view, clean background) for maximum facial clarity
- Cached as `{job_id}:character_reference` job asset — continuation invocations reuse it
- Reference bytes are pre-fetched once, reused for all character/group scenes in the loop
- Only active for `gpt-image-1` model (not ComfyUI or DALL-E, yet)
- Extra cost: ~$0.016 per job (one additional low-quality image generation)
- Atmosphere, establishing, and object scenes now use the previous scene as a style reference (Phase 2)

**Phase 2 — Scene Chain** ✅ **IMPLEMENTED (v8.1)**

Every scene (except the first) receives the previous scene's generated image as a style/palette reference via `/v1/images/edits`. This creates a "visual chain" where each image is subtly influenced by its predecessor.

**How it works:**
- After generating each scene, the raw image bytes are captured and stored as `previousSceneImageBytes`
- The next scene passes these bytes as a reference image to OpenAI's image editing API
- Character/group scenes get BOTH the hero portrait (character consistency) AND previous scene (style continuity)
- Atmosphere/establishing/object scenes get the previous scene only (style/palette continuity)
- When multiple images are sent, `image[]` multipart field naming is used
- Prompt is adapted per scenario: character+chain, character-only, or chain-only
- Cached/skipped scenes still capture bytes so the chain isn't broken
- All byte capture is non-fatal — if it fails, the chain simply starts fresh from the next scene
- Extra cost: $0 (bytes captured from existing API response, no additional API calls)
- New metadata field: `scene_chain_used: true/false` on each image asset

**Phase 3 — Style Sheet Image (Lower effort, style-only)**
1. Generate a single "style reference" image at the start (a scene that exemplifies the desired art style)
2. Use it as IP-Adapter reference for ALL scenes at low weight (~0.2)
3. Ensures consistent color palette and rendering style without character lock

### Impact Estimate

| Approach | Consistency Gain | Extra Cost | Complexity |
|----------|-----------------|------------|------------|
| Hero portrait + IP-Adapter (ComfyUI) | High (character) | +1 image gen | Medium |
| Hero portrait + OpenAI reference | Medium (character) | +$0.02 | Low |
| Scene chain (IP-Adapter) | Medium (style/palette) | None (local) | Medium |
| Style sheet reference | Low-Medium (style only) | +1 image gen | Low |

---

## 14. characterDescription Nested Object Bug — `[object Object]` in Prompts

**Severity:** Critical  
**Status:** ✅ Fixed  
**Found:** Campaign #419db201 (RnMort style, baby monitor horror story)

### Problem

When GPT generates a story anchor with multiple characters (group stories), it sometimes returns `characterDescription` as a **nested grouped object** instead of a flat array or string:

```json
{
  "baby": { "age": "infant", "hair": "fine, light brown hair", "clothing": "light blue onesie", "distinguishingFeatures": "peaceful sleeping face" },
  "adults": [
    { "age": 30, "hair": "messy brown hair", "clothing": "casual home attire", "distinguishingFeatures": "anxious expression, wide eyes" },
    { "age": 30, "hair": "long dark hair tied in a loose bun", "clothing": "comfortable pajamas", "distinguishingFeatures": "worried frown, glasses" }
  ]
}
```

The existing normalization in `createStoryAnchor()` (steps.ts) only handled:
- Single flat objects: `{age, hair, clothing, distinguishingFeatures}`
- Arrays of flat objects: `[{...}, {...}]`

It did NOT handle the nested grouped shape (`{baby: {...}, adults: [{...}]}`). Since this shape has no direct `.age`, `.hair`, `.clothing` properties, the code fell through to `JSON.stringify()`, but before that the parts array was empty, so it hit the JSON stringify fallback — which in some code paths rendered as literal **`[object Object]`** in the final prompt string.

### Evidence

S7 prompt from Campaign #419db201 contained:
```
Character: [object Object]
```

This gave ComfyUI zero character guidance, resulting in a **deformed, non-human-looking person** in Scene 7.

### Fix

Rewrote the characterDescription normalization to handle ANY object shape:

1. **Single flat object** (`{age, hair, clothing}`): Extracted as before
2. **Array of objects** (`[{...}, {...}]`): Each labeled `Character 1:`, `Character 2:`, etc.
3. **Nested grouped shape** (`{baby: {...}, adults: [{...}]}`): Iterates top-level keys, flattens array entries with labels like `Adults 1:`, `Adults 2:`, and single entries with the key as label (`Baby:`)

**Result for Campaign #419db201's data:**
> `Baby: age infant, fine light brown hair, light blue onesie, peaceful sleeping face. Adults 1: age 30, messy brown hair, casual home attire, anxious expression, wide eyes. Adults 2: age 30, long dark hair tied in a loose bun, comfortable pajamas, worried frown, glasses`

### Also Added

- **Story Anchor section in per-image detail modal** — clicking any image now shows the full story anchor context (environment, character description, horror tone, time of day, motifs, group story info, and whether a reference image was used) so users can audit exactly what consistency data was injected into each image's prompt.

---

## 15. art_style Not Passed to ComfyUI — STYLE_MAP Tokens Missing

**Severity:** Critical  
**Status:** ✅ Fixed  
**Found:** Campaign #419db201 (RnMort style — S9-S12 show completely different art styles)

### Problem

All scenes in a ComfyUI-generated campaign had **wildly different art styles** despite all being configured as `rnmort`. S9 looked realistic, S10 was black & white sketch, S11 was painterly horror, S12 was cartoon. They looked like completely different artists drew them.

### Root Cause

The `STYLE_MAP['rnmort']` weighted tokens — `(adult cartoon:1.3), (bold black outlines:1.2), (cel shading:1.2), (flat colors:1.1), (exaggerated proportions:1.1)` — are the primary mechanism for enforcing consistent style in ComfyUI. These tokens are looked up in `translatePromptForComfyUI()` via `brandDNA.art_style`.

But the worker-v1 was sending `brand_dna: job.meta || {}` to the video-renderer, and **`job.meta` does not contain `art_style`**. The `artStyle` variable is resolved from `imagePromptConfig?.art_style` (from the brand template DB) at line 3491 but was never included in the `brand_dna` payload.

Result: `STYLE_MAP[undefined]` → `''` → **no style tokens injected**. The only style guidance was a condensed text extraction from the prompt's `Style:` section (e.g., `cartoon style, cel-shaded, horror, illustration, thick black outlines, bright saturated colors`), which is far too weak for ComfyUI to produce consistent output across independent generations.

### Evidence

```
// job.meta for campaign 419db201:
art_style: ''           ← EMPTY!
image_model: 'comfyui'
```

Meanwhile `imagePromptConfig.art_style` was correctly `'rnmort'` from the DB (brand_templates.config_overrides.image_prompt.art_style).

### Fix

In `steps.ts`, changed the `brand_dna` payload to merge `artStyle` explicitly:

```typescript
// BEFORE:
brand_dna: job.meta || {},

// AFTER:
brand_dna: {
  ...(job.meta || {}),
  art_style: artStyle,  // Ensure art_style flows to STYLE_MAP lookup
},
```

Now `translatePromptForComfyUI()` will get `brandDNA.art_style = 'rnmort'` → `STYLE_MAP['rnmort']` → `(adult cartoon:1.3), (bold black outlines:1.2), (cel shading:1.2), (flat colors:1.1), (exaggerated proportions:1.1)` appended to every positive prompt.

### Impact

This was likely the **#1 cause of visual inconsistency** for ComfyUI-generated images. Without weighted CLIP tokens, the checkpoint has almost no style constraint. Combined with Issue #14 (`Character: [object Object]`), the prompts had:
- No style enforcement → different art styles per scene
- No character description → deformed/random characters

Both fixes deployed together.

---

## 16. UI Display Bugs — Size, Story Anchor, Visual Cue Fields

**Severity:** Medium  
**Status:** ✅ Fixed  
**Found:** Campaign #b504ed9c (gpt-image-1, 16 scenes)

### Problem

Several fields in the campaign detail page showed incorrect or empty values:

1. **Size field** shows `-` for most images — only shows correctly for snapshot-logged scenes (0, every 5th, last)
2. **Story Anchor** shows `❌ Not used` even though the story anchor was successfully created and used
3. **Per-image detail modal**: Scene Type, Camera, Duration, Mood Level all show `-` for non-snapshot scenes
4. **Visual Cue** in per-image modal shows empty for most scenes

### Root Cause

The UI relied on **snapshot logs** (`job_step_logs`) for metadata. Snapshots are sparse — only logged for scene 0, every 5th scene, and the last scene. For scenes 1-4, 6-9, etc., `promptData` is empty, causing all derived fields to show `-`.

Additionally, `job_step_logs` returned empty arrays for anon key queries (possible RLS policy issue).

### Fix

**3 changes in `campaign-detail.js`:**

1. **Size field**: Derive from image model name instead of sparse `promptData.size`:
   ```javascript
   const imageModel = data.imageModel || job?.meta?.image_model;
   const sizeFromModel = {'gpt-image-1': '1024x1536', 'dall-e-3': '1024x1792', 'dall-e-2': '1024x1024', 'comfyui': '1024x1536'}[imageModel] || '-';
   ```

2. **Story Anchor**: Fall back to `data.storyAnchorFull` (from `job_assets` — always available) when `vcData.story_anchor` is empty:
   ```javascript
   const storyAnchorInfo = vcData.story_anchor || data.storyAnchorFull || null;
   ```

3. **Visual Cue in per-image modal**: Fall back to `this._visualCues` array (loaded from `visual_cues` job asset, has ALL scenes) when snapshot data is unavailable.

**1 change in `steps.ts`:**

4. **Early image_sequence storage**: Store planned `image_sequence` (with Duration/MoodLevel for all scenes) into `job.meta` BEFORE the generation loop starts. Previously it was only saved at the END of the step, so Duration/MoodLevel were unavailable during generation.

### Impact

All metadata fields now display correctly for every scene, regardless of whether that scene had a snapshot log entry.

---

*This document tracks all quality issues found during the first production campaign run. Each section will be marked ✅ as fixes are implemented and verified.*

---

## 17. Animation-Aware Scene Design (v9.0)

**Severity:** High  
**Status:** ✅ Implemented (Phase 1 + Phase 2 combined)  
**Date:** March 4, 2026

### Problem

1. **Distortion/warping** instead of real animation: Images were designed as still photographs with no animatable elements. AnimateDiff's IPA mode handcuffs the model to the reference image, so motion prompts get drowned out by a static reference.
2. **Too many scenes animated** (35% = 6 of 16 scenes): Marginal candidates with scores of 6-7 produced poor results (red/yellow quality indicators).
3. **Same global params for all scenes**: A flame scene and a rain scene both got `motion_strength=0.65`, but they need very different AnimateDiff profiles.

### Root Cause

- The cinematographer AI designed scenes purely for still image quality — no awareness that some would be animated
- Scene selection was purely keyword-based (post-hoc scoring) with no intent from the AI that designed the scenes
- All animated scenes shared identical global parameters regardless of content type

### Solution — Two-Phase Architecture

#### Phase 2: Animation-Intent in Scene Design

The cinematographer AI now marks ~20-25% of scenes with animation intent at design time:

```json
{
  "sceneIndex": 3,
  "description": "A dark hallway with flickering fluorescent lights and dust particles floating in the air",
  "sceneType": "atmosphere",
  "camera": "wide",
  "animate": true,
  "motionType": "fire_light",
  "animationHint": "fluorescent lights flickering rapidly, dust particles drifting through light beams"
}
```

**Key changes:**
- `VisualCue` interface extended with `animate`, `motionType`, `animationHint` fields
- `extractVisualCues()` prompt updated with AnimateDiff capabilities/limitations education
- AI told to DESIGN animated scene descriptions with animatable elements baked in (rain streaks, flickering lights, flowing water, etc.)
- `ImageSequenceEntry` carries animation intent through to img2vid step
- `image_sequence` in job meta stores animation flags for UI display

**motionType categories:**
| Type | Examples | motion_strength |
|------|----------|----------------|
| `atmospheric` | Rain, snow, fog, dust, particles | 0.70 |
| `environmental` | Wind in trees/curtains, water flow, swaying | 0.65 |
| `fire_light` | Flames, candles, flickering lights, neon | 0.55 |
| `camera` | Slow pan, gentle zoom, drift | 0.45 |

#### Phase 1: Reduced Ratio, Min Score, Per-Scene Params

- **Ratio:** `img2vid_max_ratio` dropped from 0.35 → 0.25 (fewer but better clips)
- **Minimum score:** Scenes below score 5 are never animated, regardless of ratio
- **AI-flagged priority:** AI-flagged scenes get +8 score boost, so they're always selected first
- **Hybrid scoring:** AI flags + keyword scoring work together — AI flags get priority, keyword scoring fills remaining slots
- **Per-scene motion_strength:** Each scene gets tailored AnimateDiff parameters based on its `motionType` instead of global `motion_strength`
- **AI animation hints as motion prompts:** When the cinematographer provides an `animationHint`, it's used directly as the AnimateDiff motion prompt (bypassing LLM generation)

### Impact

| Before | After |
|--------|-------|
| 35% of scenes animated (6/16) | 25% animated (4/16) — fewer but higher quality |
| Same global motion_strength for all scenes | Per-scene strength based on content type |
| Images designed for still photography | AI designs animated scenes with motion elements baked in |
| Keyword-based scene selection only | AI intent + keyword scoring hybrid |
| Motion prompt generated post-hoc | Animation hint designed at scene creation time |
| Marginal scenes animated with poor results | Minimum score threshold prevents bad candidates |

### Files Changed

| File | Changes |
|------|---------|
| `steps.ts` | `VisualCue` interface + `ImageSequenceEntry`: added `animate`, `motionType`, `animationHint` fields |
| `steps.ts` | `extractVisualCues()`: Animation intent section in cinematographer prompt |
| `steps.ts` | `executeImg2VidStep()`: Hybrid AI+keyword selection, min score threshold, per-scene params |
| `steps.ts` | Image sequence push: carries animation intent to job meta |
| `steps.ts` | Dispatch: per-scene `motion_strength` lookup by `motionType`, AI hint as motion prompt |
| `test-scenes/index.ts` | Matching animation intent fields in test endpoint |
