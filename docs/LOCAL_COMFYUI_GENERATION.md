# Local ComfyUI Image & Video Generation

> **Implementation Status:** Phase 1 COMPLETE (v5.1). Phase 2 FULLY VALIDATED — img2vid pipeline (SVD-XT 1.1 workflow, worker step, render integration, brand UI). **Integration test PASSED: 17/17 clips generated in ~68 minutes** (March 2026). SVD-XT model installed. Cloudflare tunnel auto-start configured. Production networking via `COMFYUI_RENDERER_URL` env var. Brand settings save bug fixed (writes to all presets). **ComfyUI generation fully working** — 7 production bugs fixed across multiple sessions (VRAM threshold, edge timeout, storage bucket, dotenv/warmup, VRAM stale reporting, attempt_count exhaustion on continuations, MAX_IMG2VID_ATTEMPTS too low). SVD timeout increased to 600s. Test generation: 4s per image at 512×512, ~15s at 1024×1536. ~4 min per SVD clip after model load.
>
> **⚠️ img2vid DISABLED (March 5, 2026):** The img2vid step has been removed from `STEP_ORDER` in `index.ts`. Generated clips were not being used in the final assembled video due to renderer fallback issues on the 4070 Ti. All code remains intact — to re-enable, uncomment `'img2vid'` in `STEP_ORDER` and its entry in `STEP_JOB_STATUS`. **Future plan:** Re-enable when upgrading to RTX 5090 for local generation, or when budget allows a video generation API (e.g., Runway, Kling).

## Overview

Use ComfyUI running on the local machine to generate images (and image-to-video) instead of paying per-call cloud APIs (OpenAI gpt-image-1, DALL-E 3, Replicate FLUX). When the local machine is offline or ComfyUI is unreachable, the system automatically falls back to the existing cloud pipeline — zero manual intervention required.

---

## Motivation

| Model | Current cost/image | Notes |
|---|---|---|
| gpt-image-1 (low) | $0.016 | Default model |
| gpt-image-1 (medium) | $0.063 | |
| DALL-E 3 (standard) | $0.080 | Fallback |
| FLUX Pro (Replicate) | ~$0.05 | Character consistency |
| **ComfyUI (local)** | **$0.00** | Electricity only |

At 14 videos/campaign × 6 images/video × multiple campaigns, cloud costs add up fast. Running Stable Diffusion / FLUX / SVD locally eliminates per-image charges entirely.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Supabase Edge Functions (Deno Deploy)                      │
│                                                             │
│  schedule-jobs ──► worker-v1 ──► steps.ts                   │
│                                      │                      │
│                          ┌───────────┴───────────┐          │
│                          │                       │          │
│                  COMFYUI_RENDERER_URL    FFMPEG_RENDERER_URL │
│                  (ComfyUI + img2vid)     (FFmpeg assembly)   │
│                          │                       │          │
└──────────────────────────┼───────────────────────┼──────────┘
                           │                       │
              Cloudflare Tunnel              Render.com
              (auto-start on login)          (always-on)
                           │                       │
                           ▼                       ▼
              ┌────────────────────────┐  ┌──────────────────┐
              │  LOCAL MACHINE         │  │ Render.com       │
              │  video-renderer:3001   │  │ FFmpeg server    │
              │                        │  │ /render-video    │
              │  /comfyui-health       │  └──────────────────┘
              │  /comfyui-generate     │
              │  /comfyui-status/:id   │
              │  /comfyui-img2vid      │
              │         │              │
              │         ▼              │
              │  ComfyUI API           │
              │  (localhost:8188)       │
              │  RTX 4070 Ti (12GB)    │
              └────────────────────────┘
```

### Two-Renderer Architecture

The system uses **two separate renderer servers**:

| Server | Env Var | Purpose | Location |
|--------|---------|---------|----------|
| Local GPU | `COMFYUI_RENDERER_URL` | ComfyUI image gen + img2vid | Your machine via Cloudflare tunnel |
| Render.com | `FFMPEG_RENDERER_URL` | FFmpeg video assembly | Always-on cloud server |

The worker prefers `COMFYUI_RENDERER_URL` for all ComfyUI operations and uses `FFMPEG_RENDERER_URL` for the final video assembly step.

### Key Design Decisions

1. **ComfyUI sits behind video-renderer** — same pattern as existing `/generate-images`. The edge function never talks to ComfyUI directly.
2. **Health-check gate** — before dispatching to ComfyUI, the edge function pings `GET /comfyui-health`. If it fails, queue is too deep, or VRAM is too low → cloud fallback, no delay.
3. **Per-job model override** — brand DNA or campaign config can set `image_model: "comfyui"`. If left as default, the scheduler uses whatever the brand's preset says.
4. **Image-to-video** — same ComfyUI instance can run SVD / AnimateDiff workflows. Exposed as `POST /comfyui-img2vid`.

---

## Phase 1 — Local Image Generation

### 1.1 ComfyUI Setup (Local Machine)

| Item | Details |
|---|---|
| Runtime | ComfyUI + Python 3.10+ |
| GPU | NVIDIA GPU w/ CUDA (RTX 3060+ recommended, 8GB+ VRAM). Tested: RTX 4070 Ti (12GB) |
| API | ComfyUI native API on `localhost:8188` |
| Models | SDXL, FLUX.1-dev, or any .safetensors checkpoint |
| Output | PNG/WebP images returned via websocket or polling |

```bash
# Install ComfyUI (one-time)
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI
pip install -r requirements.txt

# Download a model (example: FLUX.1-dev or SDXL)
# Place .safetensors in ComfyUI/models/checkpoints/

# Start ComfyUI with API enabled
python main.py --listen 0.0.0.0 --port 8188
```

### Auto-Start Script (Recommended)

A startup script is provided at `video-renderer/start-local-gpu.bat` that launches both ComfyUI and the video-renderer server together:

```
video-renderer/start-local-gpu.bat
```

**What it does:**
1. Checks for NVIDIA GPU via `nvidia-smi`
2. Starts ComfyUI (tries `run_nvidia_gpu.bat` → `run_cpu.bat` → `python main.py`)
3. Waits up to 90s for ComfyUI to load models into VRAM
4. Starts the video-renderer (`node server_clean.js`)
5. Skips any service that's already running

**To auto-start on Windows login:**
1. Open Task Scheduler (`taskschd.msc`)
2. Create Basic Task → "Local GPU Server"
3. Trigger: "When I log on"
4. Action: Start a program → browse to `start-local-gpu.bat`
5. Check "Open the Properties dialog" → set "Run whether user is logged on or not" (optional)

**Configuration:** Edit the top of the `.bat` file to set your ComfyUI install path:
```bat
SET COMFYUI_DIR=D:\ComfyUI_windows_portable\ComfyUI   # Your ComfyUI folder
SET COMFYUI_PORT=8188                # Default ComfyUI port
SET VIDEO_RENDERER_PORT=3001         # Default renderer port
```

### 1.2 Workflow Templates

ComfyUI uses JSON workflow files. We'll store reusable templates:

```
video-renderer/
  comfyui/
    workflows/
      txt2img_sdxl.json        # SDXL text-to-image (1024×1536 portrait)
      txt2img_flux.json        # FLUX.1-dev text-to-image
      img2img_refine.json      # Image refinement / upscale
      img2vid_svd.json         # Stable Video Diffusion (Phase 2)
      img2vid_animatediff.json # AnimateDiff (Phase 2)
    config.js                  # Workflow loader + parameter injection
```

Each workflow template has placeholder nodes for:
- **Prompt** — injected at runtime from the scene prompt
- **Negative prompt** — injected from brand DNA or defaults
- **Seed** — deterministic from `hashSeed(jobId + sceneIndex)`
- **Resolution** — 1024×1536 (portrait 9:16) by default
- **Checkpoint** — configurable per brand

### 1.3 Video-Renderer Endpoints

Add to `video-renderer/server.js`:

```javascript
// ─── ComfyUI Integration ───

const COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';

/**
 * GET /comfyui-health
 * Returns detailed availability info for smart fallback decisions.
 *
 * Response:
 * {
 *   "available": true,          // master flag (false if ComfyUI unreachable)
 *   "gpu": "NVIDIA RTX 4090",
 *   "gpu_vram_total_mb": 24576,
 *   "gpu_vram_free_mb": 18200,   // current free VRAM
 *   "queue_size": 2,             // jobs queued in ComfyUI prompt queue
 *   "queue_limit": 6,            // COMFYUI_MAX_QUEUE — if exceeded → cloud
 *   "vram_floor_mb": 2048,       // COMFYUI_MIN_VRAM_MB — if free < this → cloud
 *   "vram_floor_img2vid_mb": 4096 // COMFYUI_MIN_VRAM_MB_IMG2VID — higher for video
 * }
 *
 * Data sources:
 *   queue_size:       GET http://COMFYUI_URL/prompt → response.exec_info.queue_remaining
 *                     (ComfyUI's internal prompt queue, NOT our application queue)
 *   gpu_vram_free_mb: getGpuInfoAccurate() — queries BOTH nvidia-smi AND ComfyUI /system_stats,
 *                     returns max(nvidia-smi, ComfyUI) to avoid CUDA caching allocator under-reporting.
 *                     nvidia-smi: --query-gpu=memory.total,memory.free --format=csv,noheader,nounits
 *                     ComfyUI:    GET /system_stats → devices[0].vram_free (torch.cuda.mem_get_info)
 *   gpu:              nvidia-smi --query-gpu=name --format=csv,noheader
 *
 * Gating rules (checked by edge function):
 *   1. available === false        → cloud fallback
 *   2. queue_size >= queue_limit  → cloud fallback (GPU backlog)
 *   3. gpu_vram_free_mb < vram_floor_mb → cloud fallback (OOM risk)
 */
app.get('/comfyui-health', async (req, res) => { ... });

/**
 * POST /comfyui-generate
 * Body: {
 *   job_id: string,
 *   scenes: [{ index, prompt, negative_prompt? }],
 *   workflow: 'txt2img_sdxl' | 'txt2img_flux',
 *   checkpoint?: string,  // override model
 *   width?: number,       // default 1024
 *   height?: number,      // default 1536
 * }
 * Returns: { comfy_job_id, status_url }
 */
app.post('/comfyui-generate', requireAuth, async (req, res) => { ... });

/**
 * GET /comfyui-status/:id
 * Returns: { status, completed, total, images: [{ index, url }] }
 */
app.get('/comfyui-status/:id', async (req, res) => { ... });

/**
 * POST /comfyui-img2vid  (Phase 2)
 * Body: { image_url, duration_seconds, motion_strength, workflow }
 * Returns: { comfy_job_id, status_url }
 */
app.post('/comfyui-img2vid', requireAuth, async (req, res) => { ... });
```

### 1.4 Prompt Translation Layer

Cloud prompts (designed for gpt-image-1 / DALL-E 3) do **not** work well when sent raw to SDXL/FLUX checkpoints. A dedicated translation layer converts them:

```typescript
/**
 * translatePromptForComfyUI(prompt, brandDNA, workflow)
 *
 * Responsibilities:
 *   1. Strip marketing fluff & narrative text ("In this chilling scene...")
 *   2. Extract and relocate STYLE LOCK directives to the end as weight tokens
 *   3. Normalize camera/lighting tokens → ComfyUI-native syntax
 *      e.g. "shot from a low angle" → "(low-angle shot:1.2)"
 *   4. Inject LoRA trigger words when checkpoint requires them
 *      e.g. "<lora:add_detail:0.8>" for detail LoRA
 *   5. Build negative prompt from brand DNA defaults + safety terms
 *   6. Enforce token limit (~75 tokens for SD 1.5, ~150 for SDXL)
 */
function translatePromptForComfyUI(
  prompt: string,
  brandDNA: Record<string, any>,
  workflow: string
): { positive: string; negative: string } {

  // ── Step 1: Strip narrative wrappers ──
  // Cloud prompts start with "STYLE LOCK:" headers and scene descriptions.
  // ComfyUI models work better with tag-style prompts.
  let cleaned = prompt
    .replace(/STYLE LOCK:[\s\S]*?(?=SCENE|GLOBAL NEGATIVE|$)/i, '')
    .replace(/^(In this|This scene|We see|The camera)[^.]*\.\s*/gm, '')
    .trim();

  // ── Step 2: Extract style keywords → weighted tokens ──
  const styleMap: Record<string, string> = {
    'cinematic': '(cinematic lighting:1.3)',
    'horror': '(dark horror atmosphere:1.2), (shadows:1.1)',
    'noir': '(film noir:1.3), (high contrast:1.2)',
    'documentary': '(documentary photography:1.2), (naturalistic:1.1)',
  };
  const artStyle = brandDNA?.art_style || '';
  const styleSuffix = styleMap[artStyle.toLowerCase()] || '';

  // ── Step 3: Normalize camera/lighting tokens ──
  cleaned = cleaned
    .replace(/shot from a low angle/gi, '(low-angle shot:1.2)')
    .replace(/close-?up/gi, '(close-up:1.3)')
    .replace(/wide shot/gi, '(wide-angle:1.2)')
    .replace(/dramatic lighting/gi, '(dramatic lighting:1.3)');

  // ── Step 4: Inject LoRA tokens ──
  const loras = brandDNA?.comfyui_loras || [];
  const loraTags = loras.map(
    (l: { name: string; weight: number }) => `<lora:${l.name}:${l.weight}>`
  ).join(' ');

  // ── Step 5: Build negative prompt (brand-controlled) ──
  // Quality terms are always included. Safety terms (nsfw) are opt-in
  // via brandDNA to avoid over-filtering legitimate content (beach,
  // shirtless, swimwear) that reduces realism on some checkpoints.
  const defaultNegQuality = 'text, watermark, logo, blurry, deformed, extra limbs, bad anatomy';
  const defaultNegSafety = brandDNA?.block_nsfw !== false ? 'nsfw' : '';  // on by default, brand can disable
  const brandNeg = brandDNA?.comfyui_negative_prompt || '';
  const negative = [defaultNegQuality, defaultNegSafety, brandNeg]
    .filter(Boolean)
    .join(', ');

  // ── Step 6: Assemble ──
  const positive = [cleaned, styleSuffix, loraTags]
    .filter(Boolean)
    .join(', ');

  return { positive, negative };
}
```

This runs inside `video-renderer/comfyui/config.js` before injecting prompts into the workflow JSON. The edge function sends the original cloud prompt; the renderer translates it locally.

> **Note on `block_nsfw`:** Defaults to `true` (nsfw added to negative prompt). Set to `false` in brand DNA only if the checkpoint needs it disabled for realism. The quality-focused negative terms (`text, watermark, blurry, deformed, ...`) are always present regardless.

### 1.5 Idempotency & Caching

Every ComfyUI render stores a `prompt_hash` in `job_assets.metadata`. Before generating, the edge function checks for an existing asset with a matching composite key:

```
Cache key = (job_id, scene_index, prompt_hash, checkpoint, seed, workflow)
```

**If a match exists** → return the existing asset URL immediately (no GPU time spent).

This matters because:
- **Workers retry** — step-level retries re-enter `generateImage()` for the same scene
- **Edge functions can double-submit** — network timeouts cause the scheduler to re-invoke
- **ComfyUI jobs can time out and re-run** — the polling loop may expire, but ComfyUI finishes later

```typescript
// In generateComfyUIImage(), before dispatching to renderer:
const cacheKey = `comfyui:${jobId}:scene_${sceneIndex}:${promptHash}:${checkpoint}:${seed}:${workflow}`;
const existing = await getAssetByKey(supabase, jobId, cacheKey, true); // quality_ok=true
if (existing?.public_url) {
  console.log(`[IMAGE] ComfyUI cache hit: ${cacheKey.slice(0, 40)}...`);
  return existing.public_url; // Skip generation entirely
}
```

The cache is automatically invalidated if any parameter changes (different prompt → different hash → different key). This keeps outputs consistent across retries while allowing intentional re-renders with new settings.

### 1.6 Scene-Level Job Lease (Double-Generation Prevention)

To prevent two workers from generating the same scene simultaneously, each scene render is protected by an asset-level lease:

```
1. Before rendering:  INSERT job_assets row with status="rendering", lease_expires_at = NOW() + timeout
2. Render completes:  UPDATE status="complete", set public_url + metadata
3. If worker crashes:  Another worker can reclaim after lease_expires_at has passed
4. If lease expired:   DELETE the stale row → re-enter from step 1
```

**Implementation in `job_assets`:**

| Column | Usage |
|--------|-------|
| `status` | `"pending"` → `"rendering"` → `"complete"` (or `"failed"`) |
| `locked_by` | Worker ID that claimed the render |
| `lease_expires_at` | `NOW() + COMFYUI_TIMEOUT_MS` — auto-expires if worker dies |

This follows the same lease pattern used by the job queue (`claim_job` / `heartbeat_job` / `release_job`) but at the individual scene/asset level. The edge function checks for an active lease before dispatching to the renderer and skips if another worker already owns it.

### 1.7 Edge Function Changes (`run-job/images.ts`)

Update `generateImage()` to support `comfyui` as a model:

```typescript
export async function generateImage(
  openaiKey: string,
  prompt: string,
  sceneIndex: number,
  imageModel: "dall-e-3" | "gpt-4o" | "gpt-image-1" | "flux" | "comfyui",
  referenceImageUrl?: string,
  strict: boolean = true
): Promise<string | null> {

  // ── ComfyUI (local) ──
  if (imageModel === "comfyui") {
    const rendererUrl = Deno.env.get("VIDEO_RENDERER_URL")
                     || Deno.env.get("FFMPEG_RENDERER_URL");
    if (rendererUrl) {
      const health = await checkComfyUIHealth(rendererUrl);
      if (health.available && !health.queue_full && !health.vram_low) {
        try {
          return await generateComfyUIImage(rendererUrl, prompt, sceneIndex);
        } catch (err) {
          console.warn(`[IMAGE] ComfyUI failed, falling back to cloud: ${err}`);
        }
      } else {
        const reason = !health.available ? 'offline'
          : health.queue_full ? `queue full (${health.queue_size}/${health.queue_limit})`
          : `low VRAM (${health.gpu_vram_free_mb}MB < ${health.vram_floor_mb}MB)`;
        console.warn(`[IMAGE] ComfyUI skipped: ${reason} → cloud fallback`);
      }
    }
    // Fallback: use gpt-image-1
    imageModel = "gpt-4o";
  }

  // ... existing cloud logic unchanged ...
}
```

### 1.6 Fallback Logic

```
Is model "comfyui"?
  │
  ├─ YES → Ping GET /comfyui-health (2s timeout)
  │         │
  │         ├─ available=false OR timeout  → cloud fallback
  │         ├─ queue_size >= queue_limit   → cloud fallback (GPU backlog)
  │         ├─ gpu_vram_free_mb < floor    → cloud fallback (OOM risk)
  │         │
  │         └─ All checks pass → POST /comfyui-generate
  │                               │
  │                               ├─ poll /comfyui-status/:id
  │                               │    ├─ Success → upload to Supabase Storage → done
  │                               │    └─ Failure → fall through to cloud
  │                               │
  │                               └─ Prompt translated via translatePromptForComfyUI()
  │
  └─ NO → existing cloud pipeline (gpt-image-1 / DALL-E 3 / FLUX)
```

**Health check timeout**: 2 seconds. If your machine is off, the scheduler doesn't wait — it immediately uses the cloud model tied to the brand's fallback preset.

**Edge function poll timeout**: 6 minutes (360s) for txt2img. **10 minutes (600s) for img2vid** (SVD-XT cold start + 32-frame generation can exceed 5 minutes). The first generation after a cold start can take 2-3 minutes for checkpoint loading alone. Subsequent txt2img generations typically complete in 5-15s; SVD clips take ~4 minutes each after model load.

**Fallback model order**: `comfyui` → `gpt-image-1` → `dall-e-3`

**Queue gating**: If `queue_size >= COMFYUI_MAX_QUEUE` (default 6), the system assumes the GPU is backlogged and skips to cloud. This prevents pile-ups when multiple campaigns generate simultaneously.

**VRAM gating**: If `gpu_vram_free_mb < COMFYUI_MIN_VRAM_MB` (default 2048), the system skips to cloud. The threshold is intentionally low because ComfyUI auto-manages VRAM via CPU offloading — it will use system RAM when GPU memory is constrained. This prevents false rejections when desktop apps consume GPU memory.

---

## Phase 2 — Local Image-to-Video Generation

### 2.1 Supported Workflows

| Workflow | Model | Input | Output | VRAM |
|---|---|---|---|---|
| SVD (Stable Video Diffusion) | SVD-XT 1.1 | Image + motion cfg | 32-frame video (~4 min render) | 12GB (RTX 4070 Ti tested) |
| AnimateDiff | SD 1.5 + motion LoRA | Image + prompt | 16-frame video (~2s) | 8GB+ |
| FLUX Video (future) | FLUX-based video | Image + prompt | Variable | TBD |

### 2.1b Image-to-Video Resource Guardrails

Image-to-video is significantly heavier than txt2img. To prevent a few clips from hogging the entire GPU and forcing all other work to cloud, img2vid has **separate** resource limits:

| Setting | Default | Purpose |
|---------|---------|--------|
| `COMFYUI_MIN_VRAM_MB_IMG2VID` | `4096` | Higher VRAM floor (SVD/AnimateDiff need more headroom than txt2img) |
| `COMFYUI_MAX_QUEUE_IMG2VID` | `2` | Separate, tighter queue limit (each clip is 10-30× slower than an image) |
| `COMFYUI_TIMEOUT_MS_IMG2VID` | `600000` | 10 min per clip (increased from 300s — SVD-XT cold start + inference needs headroom) |

**Gating logic for img2vid:**
```
health.gpu_vram_free_mb < COMFYUI_MIN_VRAM_MB_IMG2VID → cloud fallback
health.queue_size >= COMFYUI_MAX_QUEUE_IMG2VID         → cloud fallback
clip_render_time > COMFYUI_TIMEOUT_MS_IMG2VID          → timeout, cloud fallback
```

The health endpoint returns both `vram_floor_mb` (for images) and `vram_floor_img2vid_mb` (for video). The edge function picks the appropriate threshold based on whether it's calling `/comfyui-generate` or `/comfyui-img2vid`.

**VRAM Reporting Accuracy:** The health endpoint uses `getGpuInfoAccurate()` which queries both `nvidia-smi` AND ComfyUI's `/system_stats` endpoint, then takes the **maximum** of the two values. This is critical because CUDA's caching allocator holds freed memory, causing `nvidia-smi` to under-report available VRAM by up to 8GB. The ComfyUI `/system_stats` endpoint uses `torch.cuda.mem_get_info()` which reports the true allocatable memory.

**Continuation Budget:** With 17 scenes at ~4 min each and a 340s wall-clock budget per worker invocation, a full img2vid run requires ~17+ self-invocations (continuations). The step-level `MAX_IMG2VID_ATTEMPTS` is set to **40** to accommodate this. On each continuation, the worker resets `attempt_count` to 0 in the `jobs` table to avoid hitting the DB-level `enforce_max_attempts` safeguard (hardcoded at 12).

### 2.2 Endpoint: `POST /comfyui-img2vid`

```javascript
// Body
{
  "image_url": "https://...supabase.co/.../scene_1.webp",
  "duration_seconds": 4,
  "motion_strength": 0.5,    // 0.0 = still, 1.0 = maximum motion (brand default: 0.5)
  "workflow": "img2vid_svd",  // or "img2vid_animatediff"
  "fps": 16,
  "width": 1024,
  "height": 1536
}

// Response
{
  "comfy_job_id": "vid_abc123",
  "status_url": "/comfyui-status/vid_abc123",
  "estimated_seconds": 45
}
```

### 2.3 Integration Point

The video-renderer already does FFmpeg compositing. Image-to-video clips would replace static Ken Burns pans for selected scenes:

```
Scene 1: static image → Ken Burns (default)
Scene 2: image → SVD video clip (4s) → composited into timeline
Scene 3: static image → Ken Burns (default)
```

This is opt-in per brand/campaign via `video_mode: "img2vid"` in brand DNA.

---

## Phase 3 — Brand-Level Configuration

### 3.1 Brand DNA Extension

```jsonc
// Stored in brand_templates.config_overrides.image_prompt
// Set via Brands → Image Prompt Config modal
{
  "image_model": "comfyui",              // activates local generation
  "comfyui_workflow": "txt2img_sdxl",    // SDXL or FLUX workflow template
  "comfyui_checkpoint": "epicrealismxl.safetensors",  // checkpoint file (blank = default)
  "comfyui_steps": 28,                   // sampling steps (10-80)
  "comfyui_cfg": 5.5,                    // CFG scale (1-20)
  "comfyui_fallback": "gpt-image-1",     // auto-fallback when local is offline
  "block_nsfw": true,                    // adds "nsfw" to negative prompt (default: true)
  "art_style": "cinematic-dark",         // translated to weighted tokens for ComfyUI
  "video_mode": "static",                // "static" | "img2vid" (Phase 2)
  "img2vid_workflow": "img2vid_svd",      // Phase 2
  "img2vid_motion": 0.6                  // Phase 2
}
```

### 3.2 Brand UI — Image Prompt Config Modal

The Image Model selector is in **Brands → (brand card) → Image Prompt Config**:

| Control | Description |
|---------|-------------|
| **Image Model** dropdown | `GPT Image 1`, `DALL·E 3`, or `ComfyUI (Local GPU)` |
| **Workflow Template** dropdown | `SDXL` or `FLUX.1-dev` (shown when ComfyUI selected) |
| **Checkpoint Model** text input | `.safetensors` filename from ComfyUI/models/checkpoints/ |
| **Steps** number input | Sampling steps (default: 28) |
| **CFG Scale** number input | Prompt adherence (default: 5.5) |
| **ComfyUI Status** indicator | Live health check — shows GPU, VRAM, queue depth |

All settings are saved to the brand's image prompt config and flow through to job execution: brand config → `worker-v1` → video-renderer → ComfyUI.

### 3.3 How to Choose a Workflow & Checkpoint

**Workflow Templates:**

| Workflow | Best For | Speed | Quality | Notes |
|----------|----------|-------|---------|-------|
| `txt2img_sdxl` | Cinematic, horror, atmospheric | Fast (~5-15s/img) | Very good | Default. Works with most SDXL checkpoints. |
| `txt2img_flux` | Photorealistic, high detail | Slower (~15-30s/img) | Excellent | Better prompt adherence, needs FLUX checkpoint. |

**Popular Checkpoints (place in `ComfyUI/models/checkpoints/`):**

| Checkpoint | Type | Good For |
|-----------|------|----------|
| `epicrealismxl.safetensors` | SDXL | Photorealistic horror, cinematic |
| `juggernautXL.safetensors` | SDXL | General purpose, very versatile |
| `dreamshaperXL.safetensors` | SDXL | Artistic, stylized, painterly |
| `realvisxl.safetensors` | SDXL | Ultra-realistic, documentary-style |
| `flux1-dev-fp8.safetensors` | FLUX | Maximum detail, best prompt accuracy |

**Sampling Settings:**

| Setting | Low Quality (Fast) | Balanced (Default) | High Quality (Slow) |
|---------|-------------------|-------------------|--------------------|
| Steps | 15-20 | 25-30 | 40-60 |
| CFG | 3.0-4.0 | 5.0-7.0 | 7.0-12.0 |
| Time/img | ~3-8s | ~10-15s | ~20-45s |

> **Tip:** Start with the defaults (SDXL, 28 steps, 5.5 CFG). Generate a test campaign. If images look good, you're done. If too blurry → increase steps. If too literal/stiff → lower CFG. If style doesn't match → try a different checkpoint.

---

## Configuration & Environment Variables

### Video-Renderer (`video-renderer/.env`)

```env
# ComfyUI connection
COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_TIMEOUT_MS=300000          # 5 min per image max (cold checkpoint load can take 2-3 min)
COMFYUI_MAX_QUEUE=6                # if ComfyUI queue >= this → cloud fallback
COMFYUI_MIN_VRAM_MB=2048           # if free VRAM < this → cloud fallback (low because ComfyUI auto-offloads to system RAM)
COMFYUI_DEFAULT_WORKFLOW=txt2img_sdxl
COMFYUI_DEFAULT_CHECKPOINT=         # blank = ComfyUI's default
COMFYUI_SKIP_WARMUP=0              # set to 1 to skip startup checkpoint pre-load

# Supabase (needed for uploading ComfyUI-generated images to Storage)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# Image-to-video (Phase 2) — separate limits
COMFYUI_MIN_VRAM_MB_IMG2VID=4096   # higher VRAM floor for video generation
COMFYUI_MAX_QUEUE_IMG2VID=2        # tighter queue limit (video is 10-30× slower)
COMFYUI_TIMEOUT_MS_IMG2VID=600000  # 10 min per clip (SVD needs headroom for cold start)
```

### Supabase Edge Functions (Secrets)

```env
# ComfyUI access via Cloudflare tunnel (auto-updated by start-comfyui-tunnel.ps1)
COMFYUI_RENDERER_URL=https://<random>.trycloudflare.com

# FFmpeg video assembly (Render.com, rarely changes)
FFMPEG_RENDERER_URL=https://your-render-server.onrender.com

# Legacy — may still be referenced in some code paths
VIDEO_RENDERER_URL=<same as FFMPEG_RENDERER_URL>
```

**URL resolution order in worker-v1:**
- ComfyUI calls (images, img2vid): `COMFYUI_RENDERER_URL` → `VIDEO_RENDERER_URL` → `FFMPEG_RENDERER_URL`
- Assemble (FFmpeg): `VIDEO_RENDERER_URL` → `FFMPEG_RENDERER_URL`

> **Important:** `COMFYUI_RENDERER_URL` is auto-updated by the startup script on login. The tunnel URL changes each restart but this is handled automatically.

---

## Implementation Checklist

### Phase 1: Image Generation
- [x] Install ComfyUI on local machine with a checkpoint model
- [x] Create workflow JSON templates (`txt2img_sdxl.json`, `txt2img_flux.json`)
- [x] Build `video-renderer/comfyui/config.js` — workflow loader + prompt injection
- [x] Build `translatePromptForComfyUI()` in config.js — strip narrative, normalize tokens, inject LoRAs
- [x] Negative prompt: brand-controlled split (quality vs. safety/nsfw via `block_nsfw`)
- [x] Add `GET /comfyui-health` endpoint (queue from ComfyUI prompt API + VRAM from `nvidia-smi`)
- [x] Add `POST /comfyui-generate` endpoint to `server_clean.js`
- [x] Add `GET /comfyui-status/:id` endpoint to `server_clean.js`
- [x] Add render metadata persistence (save seed, cfg, steps, checkpoint, prompt_hash per image)
- [x] Add idempotency cache: skip generation if `(job_id, scene, prompt_hash, checkpoint, seed, workflow)` asset exists
- [x] Add scene-level job lease: `requireLeaseOwner()` + idempotency check prevents double-generation
- [x] Add ComfyUI generation branch in `worker-v1/steps.ts` with health check → dispatch → poll
- [x] Add auto-fallback to `gpt-image-1` when ComfyUI is offline/busy
- [x] Enforce `FallbackReason` enum (`offline|queue_full|vram_low|timeout|error`) across all code paths
- [x] Add `image_model` field to `ImagePromptConfig` interface
- [x] Add Image Model selector to Brands → Image Prompt Config modal
- [x] Add ComfyUI workflow/checkpoint/steps/cfg selectors (shown when ComfyUI selected)
- [x] Add ComfyUI live health check button in brand UI
- [x] Fix `run-job` model lock to defer to brand config (v5.1)
- [x] Create `start-local-gpu.bat` auto-start script
- [x] Pass workflow/checkpoint/steps/cfg from brand config → worker → renderer
- [ ] Test: generate a full campaign with ComfyUI model
- [ ] Test: shut down ComfyUI mid-campaign → verify cloud fallback works
- [ ] Test: flood queue → verify cloud fallback triggers at queue limit

### Phase 2: Image-to-Video
- [x] Download SVD-XT model and create workflow template (`img2vid_svd.json`)
- [x] Create AnimateDiff workflow template (`img2vid_animatediff.json`)
- [x] Add `POST /comfyui-img2vid` endpoint to `server_clean.js`
- [x] Add img2vid functions to `comfyui/config.js` (downloadImage, loadWorkflow, generateVideo, healthCheck)
- [x] Create `executeImg2VidStep` in worker-v1/steps.ts (between images & subtitles)
- [x] Register img2vid step in worker-v1/index.ts (StepName, STEP_ORDER, switch)
- [x] Integrate video clips into FFmpeg render pipeline (`createVideoFromImages` handles img2vid clips)
- [x] Add `video_mode` / `img2vid_workflow` / `img2vid_motion` / `img2vid_fps` / `img2vid_frames` to brand DNA schema
- [x] Add img2vid fields to `ImagePromptConfig` interface in helpers.ts
- [x] Add separate img2vid resource limits (`COMFYUI_MIN_VRAM_MB_IMG2VID`, `COMFYUI_MAX_QUEUE_IMG2VID`, `COMFYUI_TIMEOUT_MS_IMG2VID`)
- [x] Health endpoint returns `vram_floor_img2vid_mb` alongside `vram_floor_mb`
- [x] Add img2vid UI controls to Brand Image Prompt Config modal (video mode, workflow, motion strength, fps, frames)
- [x] Deploy worker-v1 with img2vid step
- [x] Download SVD-XT 1.1 model (~4.5GB) — installed at `ComfyUI/models/checkpoints/svd_xt_1_1.safetensors`
- [ ] Install AnimateDiff custom node + motion modules
- [x] Set up Cloudflare tunnel for production networking (`COMFYUI_RENDERER_URL`)
- [x] Create auto-start script (`scripts/start-comfyui-tunnel.ps1`)
- [x] Register Windows Task Scheduler task (`ComfyUI-Tunnel-Startup`) for auto-start on login
- [x] Fix brand settings save bug — `saveImagePromptConfig()` now writes to ALL brand templates, not just default
- [x] Fix `getImagePromptConfigRaw()` to accept vibePreset parameter
- [x] Add `COMFYUI_RENDERER_URL` env var to worker-v1 (separate from `FFMPEG_RENDERER_URL`)
- [x] Debug ComfyUI image generation timeout — **4 bugs fixed**: VRAM threshold too high (4096→2048), edge timeout too short (150s→360s), wrong storage bucket (`story-images`→`story-videos`), missing dotenv/Supabase credentials
- [x] Add startup checkpoint warmup (64×64 1-step image forces model load into VRAM)
- [x] Add `dotenv` to video-renderer for `.env` file support (Supabase credentials)
- [x] Fix storage bucket name (`story-images` → `story-videos`) in all `/comfyui-generate` and `/comfyui-img2vid` upload paths
- [x] Test: generate campaign with img2vid scenes — **17/17 clips generated in ~68 min** (March 2026 integration test)
- [x] Test: img2vid under VRAM pressure → verified VRAM reporting fix (nvidia-smi vs ComfyUI `/system_stats`)

### Phase 3: Configuration UI
- [x] Add Image Model selector to Brand Image Prompt Config modal
- [x] Add ComfyUI workflow/checkpoint/steps/cfg controls (conditional show/hide)
- [x] Add ComfyUI health indicator with live check button
- [x] Create auto-start script (`start-local-gpu.bat`)
- [x] Fix brands.html to pass vibePreset to `getImagePromptConfigRaw()` for correct status display
- [ ] Add test-generate button (generate single image from modal)

### Phase 4: Production Networking
- [x] Install cloudflared (npm global)
- [x] Create `scripts/start-comfyui-tunnel.ps1` — auto-starts tunnel + updates Supabase secret
- [x] Register Windows Task Scheduler task `ComfyUI-Tunnel-Startup` (runs on login)
- [x] Add `COMFYUI_RENDERER_URL` to `worker-v1/index.ts` env object
- [x] Update images step in `worker-v1/steps.ts` to prefer `COMFYUI_RENDERER_URL`
- [x] Update img2vid step in `worker-v1/steps.ts` to prefer `COMFYUI_RENDERER_URL`
- [x] Verify tunnel reachable from edge function (health check passes through tunnel)
- [x] Debug generation timeout — **FIXED** (4 bugs: VRAM threshold, edge timeout, storage bucket, dotenv/warmup)

---

## Render Metadata Persistence

Every ComfyUI render saves its parameters to `job_assets.metadata` for debugging, re-rendering, and quality auditing:

```jsonc
// Stored in job_assets.metadata.comfyui
{
  "renderer": "comfyui",
  "job_id": "32cd5a85-3d1a-4b09-a35f-43e116b56048",
  "scene": 3,
  "workflow": "txt2img_sdxl",
  "checkpoint": "epicrealismxl.safetensors",
  "seed": 12345678,
  "cfg": 5.5,
  "steps": 28,
  "sampler": "euler_ancestral",
  "scheduler": "normal",
  "width": 1024,
  "height": 1536,
  "prompt_hash": "a1b2c3d4",         // SHA-256 truncated — for dedup & audit
  "prompt_positive": "(cinematic...",  // first 200 chars of translated prompt
  "prompt_negative": "text, watermark...",
  "loras": [
    { "name": "add_detail", "weight": 0.8 }
  ],
  "generation_time_ms": 14200,
  "vram_used_mb": 8400,
  "comfyui_prompt_id": "abc-123",     // ComfyUI internal ID for tracing
  "fallback_used": false,             // true if cloud was used instead
  "fallback_reason": null             // see FallbackReason enum below
}
```

### FallbackReason Enum

A consistent enum used across renderer responses, edge function logs, and `job_assets.metadata`:

| Value | Meaning | Where Set |
|-------|---------|----------|
| `"offline"` | ComfyUI unreachable (health check failed/timeout) | Edge function |
| `"queue_full"` | `queue_size >= queue_limit` | Edge function |
| `"vram_low"` | `gpu_vram_free_mb < vram_floor_mb` | Edge function |
| `"timeout"` | ComfyUI accepted the job but didn't complete within `COMFYUI_TIMEOUT_MS` | Renderer polling |
| `"error"` | ComfyUI returned an error (bad workflow, OOM during render, etc.) | Renderer / Edge function |

All code paths that fall back to cloud **must** set `fallback_reason` to one of these values. This enables:
- Dashboard widgets showing local vs. cloud ratio
- Alerting on repeated `vram_low` (upgrade GPU) or `queue_full` (add parallel capacity)
- Per-job audit trail for cost analysis

```typescript
// Type definition (shared)
type FallbackReason = 'offline' | 'queue_full' | 'vram_low' | 'timeout' | 'error';
```
```

### What This Enables

| Use Case | How |
|---|---|
| **Debug quality regressions** | Compare seed + cfg + checkpoint across renders to find what changed |
| **Re-render with new model** | Load exact params, swap checkpoint, re-run same workflow |
| **Audit brand consistency** | Query all renders for a brand → check checkpoint + LoRA drift |
| **Cost tracking** | `fallback_used=true` means cloud was charged — track local vs cloud ratio |
| **Prompt iteration** | `prompt_hash` lets you find all images generated from the same prompt |

### Storage

Metadata is written to the existing `job_assets` table's `metadata` JSONB column. No schema migration needed — the column already exists and accepts arbitrary JSON.

The video-renderer returns metadata in the `/comfyui-status/:id` response, and the edge function persists it when uploading the image to Supabase Storage.

---

## Production Networking — Cloudflare Tunnel

### The Problem

Supabase Edge Functions run on Deno Deploy (cloud). ComfyUI runs on your local machine (`localhost:3001`). The edge function needs a public URL to reach your video-renderer's ComfyUI proxy endpoints (`/comfyui-health`, `/comfyui-generate`, `/comfyui-img2vid`, etc.).

### Solution: Cloudflare Quick Tunnel + Auto-Update

A **Cloudflare Quick Tunnel** creates a public HTTPS URL (e.g. `https://random-words.trycloudflare.com`) that routes traffic to `localhost:3001`. No account required.

The tunnel URL changes on each restart, but an auto-start script handles this by:
1. Starting the video-renderer (if not already running)
2. Starting a new Cloudflare tunnel
3. Parsing the new tunnel URL
4. Automatically updating the `COMFYUI_RENDERER_URL` Supabase secret

### Environment Variable

| Secret | Purpose | Set By |
|--------|---------|--------|
| `COMFYUI_RENDERER_URL` | Cloudflare tunnel URL → localhost:3001 (ComfyUI proxy) | Auto-start script |
| `FFMPEG_RENDERER_URL` | Render.com server (FFmpeg video assembly only) | Manual, rarely changes |

The worker prefers `COMFYUI_RENDERER_URL` for ComfyUI calls and falls back to `FFMPEG_RENDERER_URL` for video assembly.

### Auto-Start Script

**Location:** `scripts/start-comfyui-tunnel.ps1`

**What it does:**
1. Checks if video-renderer is running on port 3001; starts it if not
2. Kills any stale cloudflared processes
3. Starts `cloudflared tunnel --url http://localhost:3001`
4. Parses the tunnel URL from cloudflared stderr
5. Runs `npx supabase secrets set COMFYUI_RENDERER_URL=<url>`
6. Verifies the tunnel by hitting `/comfyui-health` through it

**Run manually:**
```powershell
powershell -ExecutionPolicy Bypass -File "D:\SMOJO\Online\Buisness\faceless_01\scripts\start-comfyui-tunnel.ps1"
```

**Logs:**
- Startup log: `logs/tunnel-startup.log`
- Current URL: `logs/current-tunnel-url.txt`
- Cloudflared stderr: `%TEMP%\cloudflared-tunnel.log`

### Windows Task Scheduler (Auto-Start on Login)

A scheduled task **"ComfyUI-Tunnel-Startup"** runs the script on every Windows login:

| Setting | Value |
|---------|-------|
| Task Name | `ComfyUI-Tunnel-Startup` |
| Trigger | At logon (user: Justin) |
| Action | `powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "...\start-comfyui-tunnel.ps1"` |
| Time Limit | 5 minutes |

**Manage the task:**
```powershell
# Check status
schtasks /query /TN "ComfyUI-Tunnel-Startup" /FO LIST

# Disable
Disable-ScheduledTask -TaskName "ComfyUI-Tunnel-Startup"

# Enable
Enable-ScheduledTask -TaskName "ComfyUI-Tunnel-Startup"

# Run manually
Start-ScheduledTask -TaskName "ComfyUI-Tunnel-Startup"

# Delete
Unregister-ScheduledTask -TaskName "ComfyUI-Tunnel-Startup" -Confirm:$false
```

### Important Notes

- **ComfyUI must be running first** — the video-renderer checks for it at `localhost:8188`. Start ComfyUI before or alongside the tunnel script.
- **Quick tunnels have no uptime SLA** — Cloudflare may throttle or disconnect them. For production reliability, consider upgrading to a named tunnel (requires free Cloudflare account + domain).
- **The tunnel URL changes on restart** — but the script auto-updates the Supabase secret, so no manual intervention needed.
- **If tunnel stops mid-session**, generation falls back to cloud (gpt-image-1) automatically. No jobs will fail.

---

## Startup Checkpoint Warmup

When the video-renderer starts, it automatically generates a tiny warmup image (64×64, 1 step) to force ComfyUI to load the default SDXL checkpoint into VRAM. This eliminates the 2-3 minute cold-load penalty on the first real generation request.

**How it works:**
1. On `app.listen()`, if ComfyUI integration is loaded, the server queues a minimal generation
2. ComfyUI loads the checkpoint from disk → GPU/system RAM (takes 30s-180s depending on available VRAM)
3. Subsequent requests use the cached model (~5s per image instead of 2+ minutes)

**Configuration:**
- Set `COMFYUI_SKIP_WARMUP=1` in `.env` to disable warmup (e.g., for testing)
- Warmup is non-blocking — the server is ready to accept requests immediately, warmup runs in background
- If warmup fails, it logs a warning but does not prevent normal operation

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Machine is off | Jobs can't generate locally | Auto-fallback to cloud within 2s |
| VRAM OOM on large batches | ComfyUI crashes mid-batch | VRAM floor check in health endpoint + `COMFYUI_MAX_PARALLEL=2` |
| GPU backlog from multiple campaigns | Queue piles up, all jobs slow | Queue size gating: `queue_size >= COMFYUI_MAX_QUEUE` → cloud |
| Slow generation (2-5 min/img on older GPU) | Jobs time out | Increase `COMFYUI_TIMEOUT_MS`, scheduler already handles long-running workers |
| ComfyUI API changes | Endpoints break | Pin ComfyUI version, test on updates |
| Quality differs from cloud models | Brand consistency | Per-brand checkpoint tuning, A/B comparison in UI |
| Prompt format differs | Bad images from raw cloud prompts | `translatePromptForComfyUI()` strips narrative, normalizes tokens, injects LoRAs |

---

## Cost Projection

| Scenario | Monthly Images | Cloud Cost | Local Cost | Savings |
|---|---|---|---|---|
| 2 campaigns × 14 videos × 6 imgs | 168 | $2.69 (gpt-image-1 low) | $0 | 100% |
| 5 campaigns × 14 videos × 6 imgs | 420 | $6.72 | $0 | 100% |
| 10 campaigns × 14 videos × 6 imgs | 840 | $13.44 | $0 | 100% |
| Same + img2vid (cloud would be Runway ~$0.50/clip) | 840 imgs + 840 clips | $433 | $0 | 100% |

The biggest savings come from image-to-video — cloud services like Runway charge $0.50+/clip. Running SVD locally makes video generation essentially free.

---

## File Changes Summary

| File | Change |
|---|---|
| `video-renderer/server_clean.js` | Added `/comfyui-health`, `/comfyui-generate`, `/comfyui-status/:id`, `/comfyui-img2vid` endpoints. Startup warmup. `dotenv` loading. Fixed storage bucket to `story-videos`. |
| `video-renderer/.env` | NEW — Supabase credentials + ComfyUI config for local dev |
| `video-renderer/comfyui/config.js` | NEW — workflow loader, `translatePromptForComfyUI()`, ComfyUI API client, GPU health, img2vid. VRAM thresholds: 2048 (txt2img), 4096 (img2vid). SVD timeout: 600s. Added `getGpuInfoAccurate()` — queries both nvidia-smi and ComfyUI `/system_stats`, uses max VRAM to fix CUDA caching allocator under-reporting. |
| `video-renderer/comfyui/workflows/*.json` | NEW — SDXL, FLUX, SVD-XT, AnimateDiff workflow templates |
| `video-renderer/start-local-gpu.bat` | NEW — Auto-start script for ComfyUI + video-renderer |
| `scripts/start-comfyui-tunnel.ps1` | NEW — Auto-start Cloudflare tunnel + update Supabase secret on login |
| `supabase/functions/worker-v1/index.ts` | Added `COMFYUI_RENDERER_URL` env var, img2vid step registration, `attempt_count` reset to 0 on continuation (prevents `enforce_max_attempts` DB safeguard from killing multi-scene jobs) |
| `supabase/functions/worker-v1/steps.ts` | ComfyUI generation + img2vid steps, auto-fallback, `COMFYUI_RENDERER_URL` preference. `MAX_IMG2VID_ATTEMPTS` = 40. SVD timeout 600s. `queue_full`/`vram_low` → `continuation_needed` (not break). 45s backoff + VRAM free on queue_full. VRAM check returns `continuation_needed` on continuation with clips > 0. 404 3-strike detection in poll loop. |
| `supabase/functions/worker-v1/helpers.ts` | Added `image_model`, `video_mode`, img2vid fields to `ImagePromptConfig` interface |
| `supabase/functions/run-job/index.ts` | Fixed model lock to defer to brand config when no explicit model |
| `supabase/functions/run-job/config.ts` | Added `"comfyui"` / `"local"` to `getImageModel()` |
| `js/services/brandManager.js` | Fixed `saveImagePromptConfig()` to write to ALL templates; `getImagePromptConfigRaw()` accepts vibePreset |
| `pages/brands.html` | Image Model selector + ComfyUI controls + health check + vibePreset pass-through |

---

## Installed Models (Current)

| Model File | Type | Size | Location |
|---|---|---|---|
| `epicrealismXL_pureFix.safetensors` | SDXL checkpoint | 6.6 GB | `checkpoints/` |
| `RealVisXL_V5.0_fp16.safetensors` | SDXL checkpoint | 6.6 GB | `checkpoints/` |
| `sd_xl_base_1.0.safetensors` | SDXL base | 6.6 GB | `checkpoints/` |
| `realisticVisionV51_sd15.safetensors` | SD 1.5 checkpoint | 2.0 GB | `checkpoints/` |
| `svd_xt_1_1.safetensors` | SVD-XT (img2vid) | 4.5 GB | `checkpoints/` |
| `z_image_turbo_bf16.safetensors` | Turbo/FLUX | 11.7 GB | `checkpoints/` |
| `qwen_3_4b.safetensors` | LLM (Qwen) | 7.7 GB | `checkpoints/` |
| `ae.safetensors` | VAE | 320 MB | `checkpoints/` |

## Known Issues

| Issue | Status | Notes |
|---|---|---|
| ComfyUI image generation times out in production | **FIXED** | Root cause: 4 compounding bugs — (1) VRAM threshold 4096 MB rejected GPU with only 3.7 GB free (lowered to 2048), (2) edge function 150s timeout too short for cold SDXL checkpoint load (increased to 360s), (3) storage bucket `story-images` didn't exist (fixed to `story-videos`), (4) no `.env` / dotenv so Supabase credentials were null (added dotenv + `.env`). Also added checkpoint warmup on startup. |
| Brand settings only saved to default template | **FIXED** | `saveImagePromptConfig()` now writes to all brand templates |
| `FFMPEG_RENDERER_URL` pointed to Render.com (no ComfyUI) | **FIXED** | Added `COMFYUI_RENDERER_URL` env var for Cloudflare tunnel to local machine |
| ComfyUI never worked in production (all images were gpt-image-1 fallbacks) | **FIXED** | Root cause: edge functions had no route to local ComfyUI. Tunnel + new env var resolves this. |
| nvidia-smi under-reports VRAM (CUDA caching allocator) | **FIXED** | `nvidia-smi` showed 2539MB while ComfyUI `/system_stats` (torch.cuda.mem_get_info) showed 10957MB. Added `getGpuInfoAccurate()` that queries both sources and takes `Math.max()`. Both `checkHealth()` and `checkHealthImg2Vid()` updated. |
| `attempt_count` exhaustion on img2vid continuations | **FIXED** | `claim_job` RPC increments `attempt_count` on every invocation. With 17 scenes needing ~17+ self-invocations, always exceeded DB max of 12. Fixed by resetting `attempt_count` to 0 in the continuation handler (`index.ts`). |
| `MAX_IMG2VID_ATTEMPTS` too low (was 10) | **FIXED** | Increased to 40 in `steps.ts`. With 17 scenes each taking ~4 min and a 340s wall-clock budget, ~25+ invocations needed. |
| SVD-XT timeout too short (was 300s) | **FIXED** | Increased `COMFYUI_TIMEOUT_MS_IMG2VID` to 600s (10 min). SVD cold-start + inference occasionally exceeded 5 min. |
| `queue_full`/`vram_low` dispatch errors caused `break` | **FIXED** | Changed to return `continuation_needed` so the worker self-invokes after a 45s backoff + VRAM free, instead of aborting the entire img2vid step. |
| VRAM health check skipped continuation with clips | **FIXED** | When VRAM was low on a continuation (with clips already generated), the step returned `skipped` which halted img2vid. Changed to return `continuation_needed` to retry later. |
