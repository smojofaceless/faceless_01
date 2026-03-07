/**
 * ComfyUI Integration — Workflow Loader, Prompt Translation & API Client
 * 
 * This module handles all ComfyUI interactions for the video-renderer:
 *   1. Loading workflow JSON templates and injecting runtime parameters
 *   2. Translating cloud-style prompts (gpt-image-1/DALL-E) into ComfyUI-native syntax
 *   3. Communicating with the ComfyUI API (queue prompt, poll status, fetch images)
 *   4. GPU health checks (VRAM, queue depth)
 * 
 * The edge function sends the original cloud prompt; this module translates it locally.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const WebSocket = require('ws');

// ─── Configuration ───────────────────────────────────────────────────────

const COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const COMFYUI_TIMEOUT_MS = parseInt(process.env.COMFYUI_TIMEOUT_MS || '300000', 10);
const COMFYUI_MAX_QUEUE = parseInt(process.env.COMFYUI_MAX_QUEUE || '6', 10);
// ComfyUI auto-manages VRAM via CPU offloading, so thresholds are kept low.
// With other apps using GPU memory, free VRAM is often 3-4 GB — that's fine.
const COMFYUI_MIN_VRAM_MB = parseInt(process.env.COMFYUI_MIN_VRAM_MB || '2048', 10);
const COMFYUI_MIN_VRAM_MB_IMG2VID = parseInt(process.env.COMFYUI_MIN_VRAM_MB_IMG2VID || '4096', 10);
const COMFYUI_MAX_QUEUE_IMG2VID = parseInt(process.env.COMFYUI_MAX_QUEUE_IMG2VID || '2', 10);
const COMFYUI_DEFAULT_WORKFLOW = process.env.COMFYUI_DEFAULT_WORKFLOW || 'txt2img_sdxl';
const COMFYUI_DEFAULT_CHECKPOINT = process.env.COMFYUI_DEFAULT_CHECKPOINT || '';

const WORKFLOWS_DIR = path.join(__dirname, 'workflows');

// ─── FallbackReason Enum ─────────────────────────────────────────────────
// Consistent across renderer responses, edge function logs, and job_assets.metadata
const FALLBACK_REASONS = {
  OFFLINE: 'offline',
  QUEUE_FULL: 'queue_full',
  VRAM_LOW: 'vram_low',
  TIMEOUT: 'timeout',
  ERROR: 'error',
};

// ─── Workflow Loading ────────────────────────────────────────────────────

/**
 * Load a workflow template from disk and inject runtime parameters.
 * 
 * @param {string} workflowName - e.g. 'txt2img_sdxl', 'txt2img_flux'
 * @param {object} params - Runtime parameters to inject
 * @param {string} params.positive - Translated positive prompt
 * @param {string} params.negative - Translated negative prompt
 * @param {number} params.seed - Deterministic seed
 * @param {number} [params.width=1024] - Image width
 * @param {number} [params.height=1536] - Image height
 * @param {string} [params.checkpoint] - Override checkpoint model
 * @param {number} [params.cfg=5.5] - CFG scale
 * @param {number} [params.steps=28] - Sampling steps
 * @returns {object} Ready-to-submit ComfyUI prompt object
 */
function loadWorkflow(workflowName, params) {
  const workflowPath = path.join(WORKFLOWS_DIR, `${workflowName}.json`);
  
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`ComfyUI workflow not found: ${workflowPath}`);
  }

  // Deep-clone the template so we don't mutate the original
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

  // Inject parameters into the workflow nodes
  // The workflow templates use standardized node IDs for injection points:
  //   "3"  = KSampler (seed, steps, cfg, sampler_name, scheduler)
  //   "4"  = CheckpointLoaderSimple (ckpt_name)
  //   "6"  = CLIPTextEncode positive (text)
  //   "7"  = CLIPTextEncode negative (text)
  //   "5"  = EmptyLatentImage (width, height, batch_size)

  // Positive prompt
  if (workflow['6']?.inputs) {
    workflow['6'].inputs.text = params.positive;
  }

  // Negative prompt
  if (workflow['7']?.inputs) {
    workflow['7'].inputs.text = params.negative;
  }

  // KSampler settings
  if (workflow['3']?.inputs) {
    workflow['3'].inputs.seed = params.seed;
    if (params.steps) workflow['3'].inputs.steps = params.steps;
    if (params.cfg) workflow['3'].inputs.cfg = params.cfg;
  }

  // Resolution
  if (workflow['5']?.inputs) {
    workflow['5'].inputs.width = params.width || 1024;
    workflow['5'].inputs.height = params.height || 1536;
    workflow['5'].inputs.batch_size = 1;
  }

  // Checkpoint override
  if (params.checkpoint && workflow['4']?.inputs) {
    workflow['4'].inputs.ckpt_name = params.checkpoint;
  }

  return workflow;
}

// ─── Image-to-Video Workflow Loading ─────────────────────────────────────

const COMFYUI_TIMEOUT_MS_IMG2VID = parseInt(process.env.COMFYUI_TIMEOUT_MS_IMG2VID || '2400000', 10);
const COMFYUI_INPUT_DIR = process.env.COMFYUI_INPUT_DIR
  || path.join(process.env.COMFYUI_DIR || 'D:\\ComfyUI_windows_portable\\ComfyUI', 'input');

/**
 * Download an image from a URL and save it to ComfyUI's input directory.
 * Returns the filename (relative to ComfyUI input/) for use in LoadImage nodes.
 *
 * @param {string} imageUrl - Public URL of the source image
 * @param {string} jobId - Job ID for unique filename
 * @param {number} sceneIndex - Scene index for unique filename
 * @returns {Promise<string>} Filename saved in ComfyUI input directory
 */
async function downloadImageForComfyUI(imageUrl, jobId, sceneIndex) {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to download image: ${response.status} ${imageUrl}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = imageUrl.includes('.webp') ? '.webp' : imageUrl.includes('.jpg') ? '.jpg' : '.png';
  const filename = `img2vid_${jobId.slice(0, 8)}_s${sceneIndex}${ext}`;
  const savePath = path.join(COMFYUI_INPUT_DIR, filename);

  // Ensure input dir exists
  if (!fs.existsSync(COMFYUI_INPUT_DIR)) {
    fs.mkdirSync(COMFYUI_INPUT_DIR, { recursive: true });
  }

  fs.writeFileSync(savePath, buffer);
  console.log(`[COMFYUI-IMG2VID] Downloaded source image → ${savePath} (${Math.round(buffer.length / 1024)}KB)`);
  return filename;
}

/**
 * Load an img2vid workflow template and inject runtime parameters.
 *
 * SVD workflow node IDs:
 *   "4" = ImageOnlyCheckpointLoader (ckpt_name)
 *   "5" = LoadImage (image = filename in ComfyUI input/)
 *   "6" = SVD_img2vid_Conditioning (width, height, video_frames, motion_bucket_id, fps)
 *   "3" = KSampler (seed, steps, cfg)
 *   "12" = VideoLinearCFGGuidance (min_cfg)
 *
 * AnimateDiff workflow node IDs:
 *   "4" = CheckpointLoaderSimple (ckpt_name)
 *   "5" = LoadImage (image)
 *   "6" = CLIPTextEncode positive (text = motion prompt)
 *   "7" = CLIPTextEncode negative (text)
 *   "3" = KSampler (seed, steps, cfg, denoise)
 *   "15" = ADE_AnimateDiffLoaderWithContext (model_name = motion module)
 *
 * AnimateDiff + IP-Adapter workflow node IDs (inherits AnimateDiff + adds):
 *   "20" = IPAdapterUnifiedLoader (preset = auto-loads IPA model + CLIP vision)
 *   "21" = PrepImageForClipVision (preprocesses source image for CLIP)
 *   "22" = IPAdapter (weight, weight_type, start_at, end_at)
 *   Model chain: Checkpoint → IPAdapterUnifiedLoader → IPAdapter → AnimateDiff → KSampler
 *
 * @param {string} workflowName - 'img2vid_svd', 'img2vid_animatediff', or 'img2vid_animatediff_ipa'
 * @param {object} params
 * @param {string} params.inputImageFilename - Filename in ComfyUI input/
 * @param {number} params.seed - Deterministic seed
 * @param {number} [params.width=768] - Output width
 * @param {number} [params.height=1024] - Output height
 * @param {number} [params.motionStrength=0.5] - 0.0–1.0, mapped to model params
 * @param {number} [params.fps=8] - Frames per second
 * @param {number} [params.videoFrames=25] - Total frames (SVD default 25)
 * @param {string} [params.checkpoint] - Override checkpoint/model
 * @param {number} [params.steps] - Override sampling steps
 * @param {number} [params.cfg] - Override CFG scale
 * @param {string} [params.motionPrompt] - Motion description (AnimateDiff only)
 * @returns {object} Ready-to-submit ComfyUI prompt object
 */
function loadImg2VidWorkflow(workflowName, params) {
  // Normalize: accept both 'svd' and 'img2vid_svd' (brand UI stores short name)
  const normalizedName = workflowName.startsWith('img2vid_') ? workflowName : `img2vid_${workflowName}`;
  const workflowPath = path.join(WORKFLOWS_DIR, `${normalizedName}.json`);
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`ComfyUI img2vid workflow not found: ${workflowPath}`);
  }

  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  delete workflow._meta; // ComfyUI API rejects non-node keys

  // v8.2: Defaults bumped to match new render resolution (640x960 portrait)
  const width = params.width || 640;
  const height = params.height || 960;
  const motionStrength = Math.max(0, Math.min(1, params.motionStrength ?? 0.5));

  // ── LoadImage node (common to both) ──
  if (workflow['5']?.inputs) {
    workflow['5'].inputs.image = params.inputImageFilename;
  }

  // ── KSampler (common to both) ──
  if (workflow['3']?.inputs) {
    workflow['3'].inputs.seed = params.seed;
    if (params.steps) workflow['3'].inputs.steps = params.steps;
    if (params.cfg) workflow['3'].inputs.cfg = params.cfg;
  }

  // ── SVD-specific nodes ──
  if (normalizedName === 'img2vid_svd') {
    // SVD_img2vid_Conditioning
    if (workflow['6']?.inputs) {
      workflow['6'].inputs.width = width;
      workflow['6'].inputs.height = height;
      workflow['6'].inputs.video_frames = params.videoFrames || 25;
      // Map motionStrength 0.0–1.0 → motion_bucket_id 80–255
      // Higher = more dramatic motion (snow falling, trees swaying, characters walking)
      workflow['6'].inputs.motion_bucket_id = Math.round(80 + motionStrength * 175);
      workflow['6'].inputs.fps = params.fps || 8;
      // augmentation_level: noise added to conditioning image
      // 0.0 = nearly static, 0.12 = significant motion (fire, water, walking)
      // This is the KEY parameter for visible animation
      workflow['6'].inputs.augmentation_level = Math.round(motionStrength * 0.12 * 1000) / 1000;
    }
    // VideoLinearCFGGuidance min_cfg (lower = more creative motion in later frames)
    if (workflow['12']?.inputs) {
      workflow['12'].inputs.min_cfg = 0.5 + (1 - motionStrength) * 2.0; // 0.5–2.5
    }
    // Bump sampling steps for better motion quality
    if (workflow['3']?.inputs && !params.steps) {
      workflow['3'].inputs.steps = 25;
    }
    // Checkpoint override (SVD model)
    if (params.checkpoint && workflow['4']?.inputs) {
      workflow['4'].inputs.ckpt_name = params.checkpoint;
    }
  }

  // ── AnimateDiff-specific nodes ──
  if (normalizedName === 'img2vid_animatediff') {
    // Motion prompt
    if (workflow['6']?.inputs) {
      workflow['6'].inputs.text = params.motionPrompt || 'cinematic motion, slow camera drift, atmospheric movement';
    }
    // AnimateDiff motion_scale: amplifies temporal attention
    // Range: 1.05 (subtle) → 1.30 (strong visible motion)
    if (workflow['15']?.inputs) {
      workflow['15'].inputs.motion_scale = 1.05 + motionStrength * 0.25;
    }
    // Denoise: controls how much the image changes per frame
    // 0.45 = gentle motion, 0.70 = strong visible motion
    if (workflow['3']?.inputs) {
      workflow['3'].inputs.denoise = 0.45 + motionStrength * 0.25; // 0.45–0.70
    }
    // RepeatLatentBatch: replicate single-frame latent across batch dimension
    if (workflow['16']?.inputs) {
      workflow['16'].inputs.amount = params.videoFrames || 16;
    }
    // Checkpoint override
    if (params.checkpoint && workflow['4']?.inputs) {
      workflow['4'].inputs.ckpt_name = params.checkpoint;
    }
    // Motion module override
    if (params.motionModule && workflow['15']?.inputs) {
      workflow['15'].inputs.model_name = params.motionModule;
    }
    // Resize node
    if (workflow['10']?.inputs) {
      workflow['10'].inputs.width = width;
      workflow['10'].inputs.height = height;
    }
  }

  // ── AnimateDiff + IP-Adapter-specific nodes ──
  if (normalizedName === 'img2vid_animatediff_ipa') {
    // Motion prompt (positive)
    if (workflow['6']?.inputs) {
      workflow['6'].inputs.text = params.motionPrompt || 'cinematic motion, slow camera drift, atmospheric movement';
    }
    // IP-Adapter weight: controls visual fidelity to source image
    // "linear" weight_type gives AnimateDiff temporal freedom (vs "style transfer" which freezes frames)
    // v8.1: Re-rebalanced — v8.0 fixed motion but introduced blur.
    // Root cause: denoise too high (0.50-0.70) + IPA end_at too low (0.55-0.75) meant
    // frames diverged heavily from source AND had no image reference in late denoising steps.
    // Fix: motion comes from motion_scale (temporal attention), NOT denoise.
    // So: keep motion_scale high, bring IPA end_at + weight back up, reduce denoise.
    // v8.2 range: 0.62–0.82 (was v8.1: 0.60-0.82, v8.0: 0.55-0.80, v7.0: 0.65-0.90)
    if (workflow['22']?.inputs) {
      workflow['22'].inputs.weight = Math.max(0.62, 0.82 - motionStrength * 0.20);
      workflow['22'].inputs.weight_type = 'standard';
      // end_at: controls how long IPA constrains denoising.
      // Too high (v7.0: 0.80-0.95) = IPA active entire time = zero motion
      // Too low (v8.0: 0.55-0.75) = late steps have zero image reference = blur
      // v8.2: Floor raised to 0.70 — never releases IPA before 70% of denoising.
      // Range: 0.70–0.80. At motion_strength=0.65 → end_at=0.72
      // If still soft, push floor to 0.75 before touching denoise.
      workflow['22'].inputs.end_at = Math.max(0.70, 0.80 - motionStrength * 0.10);
    }
    // AnimateDiff motion_scale: amplifies temporal attention
    // This is the PRIMARY motion driver — higher = more frame-to-frame variation
    // v8.1: Slightly increased (1.15–1.45) to compensate for tighter IPA grip
    if (workflow['15']?.inputs) {
      workflow['15'].inputs.motion_scale = 1.15 + motionStrength * 0.30;
    }
    // Denoise: controls how much each frame can change from the source
    // v8.0's 0.50-0.70 caused blur by letting frames drift too far.
    // v8.1: Reduced to 0.42–0.58 — keeps frames closer to source.
    // Motion still comes from motion_scale (temporal attention), not denoise.
    if (workflow['3']?.inputs) {
      workflow['3'].inputs.denoise = 0.42 + motionStrength * 0.16; // 0.42–0.58
      // v8.2: Increase steps to 32 for even better per-step quality (smaller changes per step)
      if (!params.steps) workflow['3'].inputs.steps = 32;
    }
    // RepeatLatentBatch: frame count
    if (workflow['16']?.inputs) {
      workflow['16'].inputs.amount = params.videoFrames || 16;
    }
    // Checkpoint override
    if (params.checkpoint && workflow['4']?.inputs) {
      workflow['4'].inputs.ckpt_name = params.checkpoint;
    }
    // Motion module override
    if (params.motionModule && workflow['15']?.inputs) {
      workflow['15'].inputs.model_name = params.motionModule;
    }
    // Resize node
    if (workflow['10']?.inputs) {
      workflow['10'].inputs.width = width;
      workflow['10'].inputs.height = height;
    }
    // v7.0: Pre-sharpen CLIP vision input to preserve detail through encoding
    if (workflow['21']?.inputs) {
      workflow['21'].inputs.sharpening = 0.15;
    }
  }

  // ── CogVideoX-specific nodes (handles both GGUF Q4 and fp8 runtime quant workflows) ──
  if (normalizedName === 'img2vid_cogvideox' || normalizedName === 'img2vid_cogvideox_fp8') {
    // LoadImage node (node "4" in CogVideoX workflow)
    if (workflow['4']?.inputs) {
      workflow['4'].inputs.image = params.inputImageFilename;
    }

    // ImageScale resize node (node "10") — resize to target render dimensions
    if (workflow['10']?.inputs) {
      workflow['10'].inputs.width = width;
      workflow['10'].inputs.height = height;
    }

    // CogVideoTextEncode positive (node "2")
    if (workflow['2']?.inputs) {
      workflow['2'].inputs.prompt = params.motionPrompt || 'cinematic motion, gentle camera movement, atmospheric lighting';
    }
    // CogVideoTextEncode negative (node "3")
    if (workflow['3']?.inputs) {
      workflow['3'].inputs.prompt = 'static, blurry, distorted, low quality, jittery, flickering, watermark';
    }

    // CogVideoImageEncode (node "5") — noise_aug_strength controls motion amount
    // Override from request params takes priority, otherwise compute from motionStrength
    if (workflow['5']?.inputs) {
      workflow['5'].inputs.noise_aug_strength = params.noiseAugStrength != null
        ? params.noiseAugStrength
        : 0.005 + motionStrength * 0.025; // 0.005–0.03 (was 0.01–0.05, tightened to reduce blur)
    }

    // CogVideoSampler (node "6") — steps, cfg, seed, num_frames
    if (workflow['6']?.inputs) {
      workflow['6'].inputs.seed = params.seed;
      workflow['6'].inputs.steps = params.steps || 30;
      workflow['6'].inputs.cfg = params.cfg || 7.5;
      workflow['6'].inputs.num_frames = params.videoFrames || 25; // 25 frames = ~3s at 8fps (fewer = less temporal drift)
    }

    // CogVideoX has its own LoadImage at node "4", skip the common node "5" LoadImage
    return workflow;
  }

  // ── Wan2.1-specific nodes ──
  if (normalizedName === 'img2vid_wan') {
    // LoadImage node (node "6" in Wan workflow)
    if (workflow['6']?.inputs) {
      workflow['6'].inputs.image = params.inputImageFilename;
    }

    // WanVideoTextEncode (node "5") — positive and negative prompts
    if (workflow['5']?.inputs) {
      workflow['5'].inputs.positive_prompt = params.motionPrompt || 'cinematic motion, gentle camera movement, atmospheric lighting';
      workflow['5'].inputs.negative_prompt = 'static, blurry, distorted, low quality, jittery, flickering, watermark';
    }

    // WanVideoImageToVideoEncode (node "9") — resolution, frames, motion control
    if (workflow['9']?.inputs) {
      // Use params width/height if provided, otherwise default to 832x480/480x832
      // Round to nearest multiple of 16 for Wan2.1
      const round16 = (v) => Math.round(v / 16) * 16;
      const isPortrait = height > width;
      const defaultW = isPortrait ? 480 : 832;
      const defaultH = isPortrait ? 832 : 480;
      workflow['9'].inputs.width = round16(width || defaultW);
      workflow['9'].inputs.height = round16(height || defaultH);
      workflow['9'].inputs.num_frames = params.videoFrames || 81; // 81 frames = ~5s at 16fps
      // noise_aug_strength: higher = more motion freedom (0.0 = static, 0.05 = lots of motion)
      workflow['9'].inputs.noise_aug_strength = motionStrength * 0.05; // 0.0–0.05
      // start_latent_strength: lower = more motion (1.0 = preserve image, 0.7 = more freedom)
      workflow['9'].inputs.start_latent_strength = Math.max(0.7, 1.0 - motionStrength * 0.3);
    }

    // WanVideoSampler (node "10") — steps, cfg, shift, seed
    if (workflow['10']?.inputs) {
      workflow['10'].inputs.seed = params.seed;
      workflow['10'].inputs.steps = params.steps || 30;
      workflow['10'].inputs.cfg = params.cfg || 6.0;
      // shift controls noise schedule; higher = sharper but less creative motion
      workflow['10'].inputs.shift = 5.0;
    }

    // Wan has its own LoadImage at node "6", skip the common node "5" LoadImage
    return workflow;
  }

  return workflow;
}

/**
 * Complete img2vid flow: queue prompt → poll → fetch ALL frames → return as Buffer[].
 * The caller (server_clean.js) combines frames into MP4 with FFmpeg.
 *
 * @param {object} workflow - Ready-to-submit workflow
 * @param {number} [timeoutMs] - Override timeout
 * @param {function} [onProgress] - Optional callback: (progress) => void, called with { step, max_steps, percentage, node, stage }
 * @returns {Promise<{ prompt_id: string, frames: Buffer[], metadata: object }>}
 */
async function generateVideo(workflow, timeoutMs = COMFYUI_TIMEOUT_MS_IMG2VID, onProgress = null) {
  const startTime = Date.now();
  const promptId = await queuePrompt(workflow);
  console.log(`[COMFYUI-IMG2VID] Queued prompt: ${promptId}`);

  // ── WebSocket progress listener ──
  // ComfyUI broadcasts real-time progress via WebSocket:
  //   { type: 'progress', data: { value, max, prompt_id, node } }
  //   { type: 'executing', data: { node, prompt_id } }  (node=null when done)
  let wsProgress = { step: 0, max_steps: 0, percentage: 0, node: null, stage: 'queued' };
  let ws = null;
  let lastLoggedPct = -1;
  try {
    const wsUrl = COMFYUI_URL.replace('http', 'ws') + '/ws?clientId=video-renderer-progress';
    ws = new WebSocket(wsUrl);
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'progress' && msg.data?.prompt_id === promptId) {
          wsProgress.step = msg.data.value || 0;
          wsProgress.max_steps = msg.data.max || 0;
          wsProgress.percentage = wsProgress.max_steps > 0
            ? Math.round((wsProgress.step / wsProgress.max_steps) * 100) : 0;
          wsProgress.node = msg.data.node || wsProgress.node;
          wsProgress.stage = 'generating';

          // Console progress bar — log every 10% or on completion
          if (wsProgress.percentage >= lastLoggedPct + 10 || wsProgress.percentage === 100) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const filled = Math.round(wsProgress.percentage / 4);
            const bar = '█'.repeat(filled) + '░'.repeat(25 - filled);
            const rate = wsProgress.step > 0 ? (wsProgress.step / ((Date.now() - startTime) / 1000)).toFixed(2) : '0.00';
            console.log(`[COMFYUI-IMG2VID] ${wsProgress.percentage}% |${bar}| ${wsProgress.step}/${wsProgress.max_steps} [${elapsed}s, ${rate}it/s]`);
            lastLoggedPct = wsProgress.percentage;
          }

          if (onProgress) onProgress({ ...wsProgress });
        } else if (msg.type === 'executing' && msg.data?.prompt_id === promptId) {
          if (msg.data.node === null) {
            wsProgress.stage = 'complete';
            wsProgress.percentage = 100;
          } else {
            wsProgress.node = msg.data.node;
            wsProgress.stage = 'generating';
          }
          if (onProgress) onProgress({ ...wsProgress });
        }
      } catch { /* ignore parse errors */ }
    });
    ws.on('error', () => { /* non-fatal — fall back to poll-only */ });
  } catch {
    // WebSocket not available — progress tracking degrades gracefully
    console.log('[COMFYUI-IMG2VID] WebSocket unavailable — progress tracking disabled');
  }

  try {
    const pollInterval = 3000; // 3s (video gen is slower)
    while (Date.now() - startTime < timeoutMs) {
      await new Promise(r => setTimeout(r, pollInterval));

      const history = await getPromptStatus(promptId);
      if (!history) continue;

      // Check for errors
      if (history.status?.status_str === 'error') {
        const errorMsg = history.status?.messages
          ?.filter(m => m[0] === 'execution_error')
          ?.map(m => {
            const detail = m[1];
            if (typeof detail === 'string') return detail;
            return detail?.exception_message || detail?.message || JSON.stringify(detail);
          })
          .join('; ') || 'unknown error';
        throw new Error(`ComfyUI img2vid error: ${errorMsg}`);
      }

      // Extract ALL output frames (SaveImage outputs multiple images for video)
      if (history.outputs) {
        const frames = [];
        for (const nodeId of Object.keys(history.outputs)) {
          const nodeOutput = history.outputs[nodeId];
          if (nodeOutput.images) {
            for (const img of nodeOutput.images) {
              const buffer = await fetchImage(img.filename, img.subfolder || '', img.type || 'output');
              frames.push(buffer);
            }
          }
        }

        if (frames.length > 0) {
          const elapsed = Date.now() - startTime;
          console.log(`[COMFYUI-IMG2VID] ✓ Generated ${frames.length} frames in ${(elapsed / 1000).toFixed(1)}s`);
          return {
            prompt_id: promptId,
            frames,
            metadata: {
              comfyui_prompt_id: promptId,
              generation_time_ms: elapsed,
              frame_count: frames.length,
            },
          };
        }
      }
    }

    throw new Error(`ComfyUI img2vid timed out after ${timeoutMs}ms (prompt_id: ${promptId})`);
  } finally {
    // Always close WebSocket
    if (ws) try { ws.close(); } catch { /* ignore */ }
  }
}

/**
 * Health check specifically for img2vid — uses higher VRAM threshold and separate queue limit.
 * @returns {Promise<object>} Health status with img2vid availability
 */
async function checkHealthImg2Vid() {
  const gpuInfo = await getGpuInfoAccurate();
  const queueInfo = await getComfyUIQueueInfo();

  if (!queueInfo) {
    return {
      available: false,
      fallback_reason: FALLBACK_REASONS.OFFLINE,
      gpu: gpuInfo?.gpu || 'unknown',
      gpu_vram_free_mb: gpuInfo?.vram_free_mb || 0,
      queue_size: -1,
    };
  }

  const vramFree = gpuInfo?.vram_free_mb || 0;
  const queueFull = queueInfo.queue_size >= COMFYUI_MAX_QUEUE_IMG2VID;
  const vramLow = gpuInfo && vramFree < COMFYUI_MIN_VRAM_MB_IMG2VID;

  let fallbackReason = null;
  if (queueFull) fallbackReason = FALLBACK_REASONS.QUEUE_FULL;
  else if (vramLow) fallbackReason = FALLBACK_REASONS.VRAM_LOW;

  return {
    available: !queueFull && !vramLow,
    fallback_reason: fallbackReason,
    gpu: gpuInfo?.gpu || 'unknown',
    gpu_vram_total_mb: gpuInfo?.vram_total_mb || 0,
    gpu_vram_free_mb: vramFree,
    queue_size: queueInfo.queue_size,
    queue_limit_img2vid: COMFYUI_MAX_QUEUE_IMG2VID,
    vram_floor_img2vid_mb: COMFYUI_MIN_VRAM_MB_IMG2VID,
    timeout_img2vid_ms: COMFYUI_TIMEOUT_MS_IMG2VID,
  };
}

// ─── Prompt Translation ──────────────────────────────────────────────────

/**
 * Style map: brand art_style → ComfyUI weighted tokens.
 * These translate high-level creative direction into checkpoint-friendly syntax.
 */
const STYLE_MAP = {
  'cinematic': '(cinematic lighting:1.3)',
  'cinematic-dark': '(cinematic lighting:1.3), (dark atmosphere:1.2), (film grain:1.1)',
  'horror': '(dark horror atmosphere:1.2), (shadows:1.1)',
  'noir': '(film noir:1.3), (high contrast:1.2)',
  'documentary': '(documentary photography:1.2), (naturalistic:1.1)',
  'analog-horror': '(VHS aesthetic:1.2), (analog distortion:1.1), (scanlines:1.0)',
  'found-footage': '(found footage:1.2), (VHS grain:1.1), (surveillance camera:1.0)',
  'surreal-nightmare': '(surrealist:1.3), (nightmare imagery:1.2), (impossible geometry:1.1)',
  'oil-painting': '(oil painting:1.3), (painterly brushstrokes:1.2), (chiaroscuro:1.1)',
  'horror-anime': '(dark anime:1.3), (manga horror:1.2), (detailed linework:1.1)',
  'editorial-cartoon': '(editorial cartoon:1.3), (bold linework:1.2), (digital illustration:1.1)',
  'rnmort': '(adult cartoon:1.3), (bold black outlines:1.2), (cel shading:1.2), (flat colors:1.1), (exaggerated proportions:1.1)',
};

/**
 * Camera/lighting token normalization for ComfyUI checkpoints.
 * Cloud prompts use natural language; SD/FLUX models prefer weighted tags.
 */
const CAMERA_REPLACEMENTS = [
  [/shot from a low angle/gi, '(low-angle shot:1.2)'],
  [/low[\s-]?angle/gi, '(low-angle shot:1.2)'],
  [/close[\s-]?up/gi, '(close-up:1.3)'],
  [/extreme close[\s-]?up/gi, '(extreme close-up:1.4)'],
  [/wide shot/gi, '(wide-angle:1.2)'],
  [/wide[\s-]?angle/gi, '(wide-angle:1.2)'],
  [/over[\s-]?the[\s-]?shoulder/gi, '(over-the-shoulder shot:1.2)'],
  [/bird'?s?[\s-]?eye/gi, '(bird\'s eye view:1.2)'],
  [/top[\s-]?down/gi, '(top-down view:1.2)'],
  [/dramatic lighting/gi, '(dramatic lighting:1.3)'],
  [/harsh lighting/gi, '(harsh lighting:1.2)'],
  [/soft lighting/gi, '(soft lighting:1.2)'],
  [/backlit/gi, '(backlit:1.2)'],
  [/silhouette/gi, '(silhouette:1.3)'],
];

/**
 * Translate a cloud-style prompt into ComfyUI-native syntax.
 * 
 * Cloud prompts (designed for gpt-image-1 / DALL-E 3) use narrative descriptions
 * and STYLE LOCK headers. ComfyUI checkpoints work better with weighted tag-style
 * prompts. This function:
 *   1. Strips narrative wrappers ("In this chilling scene...")
 *   2. Extracts style keywords → weighted tokens
 *   3. Normalizes camera/lighting tokens → ComfyUI syntax
 *   4. Injects LoRA trigger words when checkpoint requires them
 *   5. Builds negative prompt (brand-controlled quality + safety split)
 *   6. Enforces approximate token limit
 * 
 * @param {string} prompt - Original cloud prompt
 * @param {object} [brandDNA={}] - Brand DNA config
 * @param {string} [workflow='txt2img_sdxl'] - Target workflow
 * @returns {{ positive: string, negative: string }}
 */
function translatePromptForComfyUI(prompt, brandDNA = {}, workflow = 'txt2img_sdxl') {
  // ── Step 1: Parse structured sections from the multi-line prompt ──
  // The image prompt uses "Label: content" format. The UNIQUE scene description
  // is the unlabeled line(s) — e.g. "A close-up of hands on a kitchen counter..."
  // These are the MOST important part and must be preserved first.
  //
  // BUG FIX (March 2026): Previously, the regex `^(A\s)[^.]*\.` stripped lines
  // starting with "A " — which removed the unique scene descriptions (e.g.
  // "A close-up of hands nervously tapping..."). Combined with boilerplate
  // Style/Environment/Lighting sections consuming the 150-token budget, every
  // scene in a video got essentially the same prompt → same image.

  const lines = prompt.split('\n').map(l => l.trim()).filter(Boolean);

  // Known labeled sections to parse out (boilerplate that repeats across scenes)
  const SECTION_LABELS = /^(FOCUS|THUMBNAIL PRIORITY|Scene context|Style|Environment|Mood|Camera|Lighting|Color|Visual motifs|Keywords|Character|GROUP|No text|ABSOLUTELY NO|Portrait orientation|Horror photography)/i;

  const sections = {};
  const sceneDescriptionLines = [];

  for (const line of lines) {
    const match = line.match(SECTION_LABELS);
    if (match) {
      const label = match[1].toLowerCase().replace(/\s+/g, '_');
      sections[label] = line.substring(match[0].length).replace(/^[:\s]+/, '').trim();
    } else {
      // Unlabeled lines = unique scene description (preserve these!)
      sceneDescriptionLines.push(line);
    }
  }

  // ── Step 2: Extract the unique scene description (highest priority) ──
  // Strip narrative wrappers only from the description, not from structured fields.
  let sceneDesc = sceneDescriptionLines.join(' ').trim()
    .replace(/^(In this|This scene|We see|The camera)\b[^,]*,\s*/gi, '')  // Strip narrative openers only up to first comma
    .replace(/STYLE LOCK:[\s\S]*?(?=\n|$)/gi, '')
    .replace(/GLOBAL NEGATIVE PROMPT:[^\n]*/gi, '')
    .replace(/SCENE \d+[:\s]*/gi, '')
    .trim();

  // ── Step 3: Build camera/mood/keywords (scene-varying content) ──
  const camera = sections['camera'] || '';
  const mood = sections['mood'] || '';
  const keywords = sections['keywords'] || '';
  const sceneContext = sections['scene_context'] || '';
  const focus = sections['focus'] || '';

  // ── Step 4: Condense style for ComfyUI ──
  // The full Style: block is 50+ words designed for cloud models. ComfyUI checkpoints
  // work better with concise style tags. Extract the essential style keywords.
  const styleRaw = sections['style'] || '';
  let styleCondensed = '';
  if (styleRaw) {
    // Extract key style phrases, skip filler
    const styleKeywords = [];
    // Helper: match keyword only when NOT preceded by "NOT"
    const hasStyle = (pattern, notPattern) => pattern.test(styleRaw) && (!notPattern || !notPattern.test(styleRaw));
    if (hasStyle(/cartoon/i))                                                     styleKeywords.push('cartoon style');
    if (hasStyle(/anime/i, /NOT\s+anime/i))                                      styleKeywords.push('anime style');
    if (hasStyle(/cel[\s-]?shad/i))                                              styleKeywords.push('cel-shaded');
    if (hasStyle(/oil paint/i, /NOT\s+oil\s+paint/i))                             styleKeywords.push('oil painting');
    if (hasStyle(/photograph/i, /NOT\s+photograph/i))                             styleKeywords.push('photography');
    if (hasStyle(/horror/i))                                                     styleKeywords.push('horror');
    if (hasStyle(/noir/i))                                                       styleKeywords.push('film noir');
    if (hasStyle(/cinematic/i))                                                  styleKeywords.push('cinematic');
    if (hasStyle(/documentary/i))                                                styleKeywords.push('documentary');
    if (hasStyle(/illustrat/i))                                                  styleKeywords.push('illustration');
    if (hasStyle(/realistic/i, /NOT\s+realistic/i))                              styleKeywords.push('realistic');
    if (hasStyle(/VHS/i))                                                        styleKeywords.push('VHS aesthetic');
    if (hasStyle(/found footage/i))                                              styleKeywords.push('found footage');
    if (hasStyle(/surreal/i))                                                    styleKeywords.push('surrealist');
    if (hasStyle(/thick.*outline|black outline/i))                               styleKeywords.push('thick black outlines');
    if (hasStyle(/bright.*color|saturated/i))                                    styleKeywords.push('bright saturated colors');
    if (hasStyle(/watercolor/i))                                                 styleKeywords.push('watercolor');
    styleCondensed = styleKeywords.join(', ');
  }

  // ── Step 5: Art style weighted tokens ──
  // v7.0 — Issue #7: Prefer DB-sourced comfyui_tokens from brand_dna payload over hardcoded STYLE_MAP
  const artStyle = brandDNA?.art_style || '';
  const styleSuffix = brandDNA?.comfyui_tokens || STYLE_MAP[artStyle.toLowerCase()] || '';

  // ── Step 6: Normalize camera/lighting tokens ──
  // Apply camera replacements but avoid double-wrapping (e.g. ((wide-angle:1.2):1.2))
  let descWithCamera = [sceneDesc, camera ? `${camera} shot` : ''].filter(Boolean).join(', ');
  for (const [pattern, replacement] of CAMERA_REPLACEMENTS) {
    descWithCamera = descWithCamera.replace(pattern, replacement);
  }
  // Clean up any double-nested weights from overlapping replacements
  // e.g. ((wide-angle:1.2):1.2) → (wide-angle:1.2), or (wide-angle:1.2:1.2) → (wide-angle:1.2)
  descWithCamera = descWithCamera
    .replace(/\(\(([^()]+)\):([0-9.]+)\)/g, '($1)')   // ((text:1.2):1.2) → (text:1.2)
    .replace(/\(([^():]+):([0-9.]+):([0-9.]+)\)/g, '($1:$2)');  // (text:1.2:1.2) → (text:1.2)

  // ── Step 7: Inject LoRA tokens ──
  const loras = brandDNA?.comfyui_loras || [];
  const loraTags = loras
    .map(l => `<lora:${l.name}:${l.weight}>`)
    .join(' ');

  // ── Step 8: Build negative prompt ──
  // Quality terms always present. Safety terms gated by block_nsfw (default: true).
  // "NOT photography", "ABSOLUTELY NO: groups" belong in NEGATIVE, not positive.
  const negParts = ['text, watermark, logo, blurry, deformed, extra limbs, bad anatomy'];
  if (brandDNA?.block_nsfw !== false) negParts.push('nsfw');
  if (brandDNA?.comfyui_negative_prompt) negParts.push(brandDNA.comfyui_negative_prompt);
  // Move "NOT X" and "ABSOLUTELY NO" directives to negative prompt
  if (focus.includes('Do NOT show groups')) negParts.push('groups of people, crowds, multiple people');
  if (sections['absolutely_no']) negParts.push(sections['absolutely_no']);
  // Extract "NOT X" from style into negative
  const notMatches = styleRaw.match(/NOT\s+\w+/gi) || [];
  for (const notPhrase of notMatches) {
    negParts.push(notPhrase.replace(/^NOT\s+/i, '').toLowerCase());
  }
  const negative = negParts.filter(Boolean).join(', ');

  // ── Step 9: Assemble positive prompt (priority order) ──
  // 1. Scene description (unique per scene — most important!)
  // 2. Mood extract (varies per scene)
  // 3. Scene context keywords (varies per scene)
  // 4. Condensed style (same but concise)
  // 5. Art style tokens (weighted)
  // 6. Keywords
  // 7. LoRAs
  const moodCondensed = mood
    .replace(/tension level \d+\/\d+/i, '')
    .replace(/,\s*,/g, ',')
    .trim()
    .replace(/,\s*$/, '');
  const contextBrief = sceneContext.length > 60
    ? sceneContext.substring(0, 60).replace(/\s\S*$/, '')
    : sceneContext;

  const positiveParts = [
    descWithCamera,                              // unique scene: "close-up of hands on counter, crumpled paper"
    moodCondensed,                               // "focused detail, true-crime dread"
    contextBrief ? `(${contextBrief}:0.8)` : '', // light context grounding
    styleCondensed,                              // "cartoon style, cel-shaded, horror"
    styleSuffix,                                 // "(dark horror atmosphere:1.2)"
    keywords ? keywords : '',                    // "proof, nights, storm"
    loraTags,                                    // "<lora:add_detail:0.8>"
  ].filter(Boolean).join(', ');

  // Rough token limit enforcement (~75 tokens for SD 1.5, ~150 for SDXL/FLUX)
  const isSDXL = workflow.includes('sdxl') || workflow.includes('flux');
  const maxTokens = isSDXL ? 150 : 75;
  const words = positiveParts.split(/\s+/);
  const trimmedPositive = words.length > maxTokens
    ? words.slice(0, maxTokens).join(' ')
    : positiveParts;

  return { positive: trimmedPositive, negative };
}

// ─── Deterministic Seed ──────────────────────────────────────────────────

/**
 * Generate a deterministic seed from job ID + scene index.
 * Ensures same prompt + scene always gets the same image (reproducibility).
 */
function hashSeed(jobId, sceneIndex) {
  const hash = crypto.createHash('sha256').update(`${jobId}:scene_${sceneIndex}`).digest();
  // Use first 4 bytes as a 32-bit unsigned integer (ComfyUI seeds are typically 0 to 2^32-1)
  return hash.readUInt32BE(0);
}

/**
 * Compute a short hash of the prompt for idempotency/dedup.
 */
function promptHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// ─── GPU Health Check ────────────────────────────────────────────────────

/**
 * Query GPU info via nvidia-smi.
 * Returns { gpu, vram_total_mb, vram_free_mb } or null if unavailable.
 */
function getGpuInfo() {
  try {
    const csvOutput = execSync(
      'nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits',
      { timeout: 5000, encoding: 'utf8' }
    ).trim();

    const [name, totalStr, freeStr] = csvOutput.split(',').map(s => s.trim());
    return {
      gpu: name,
      vram_total_mb: parseInt(totalStr, 10),
      vram_free_mb: parseInt(freeStr, 10),
    };
  } catch (err) {
    console.warn('[COMFYUI] nvidia-smi not available:', err.message);
    return null;
  }
}

/**
 * Query ComfyUI's /system_stats for accurate VRAM info.
 * nvidia-smi can report stale VRAM because CUDA's caching allocator holds freed memory.
 * ComfyUI's system_stats reports the actual usable VRAM via torch.cuda.mem_get_info().
 * Returns the max of nvidia-smi and system_stats to avoid false "VRAM low" skips.
 */
async function getGpuInfoAccurate() {
  const smiInfo = getGpuInfo();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${COMFYUI_URL}/system_stats`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return smiInfo;
    const data = await res.json();
    const device = data.devices?.[0];
    if (!device) return smiInfo;
    const comfyVramFreeMb = Math.round(device.vram_free / (1024 * 1024));
    const comfyVramTotalMb = Math.round(device.vram_total / (1024 * 1024));
    const smiVramFree = smiInfo?.vram_free_mb || 0;
    // Use the higher value — nvidia-smi can under-report when CUDA cache holds freed memory
    const bestVramFree = Math.max(smiVramFree, comfyVramFreeMb);
    if (Math.abs(smiVramFree - comfyVramFreeMb) > 1000) {
      console.log(`[COMFYUI] VRAM discrepancy: nvidia-smi=${smiVramFree}MB, comfyui=${comfyVramFreeMb}MB → using ${bestVramFree}MB`);
    }
    return {
      gpu: smiInfo?.gpu || device.name || 'unknown',
      vram_total_mb: smiInfo?.vram_total_mb || comfyVramTotalMb,
      vram_free_mb: bestVramFree,
    };
  } catch (err) {
    // Fall back to nvidia-smi if ComfyUI is unreachable
    return smiInfo;
  }
}

/**
 * Query ComfyUI's queue depth.
 * Returns { queue_size } or null if ComfyUI is unreachable.
 */
async function getComfyUIQueueInfo() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${COMFYUI_URL}/prompt`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    return {
      queue_size: data.exec_info?.queue_remaining || 0,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Build full health response combining GPU info + ComfyUI queue.
 * Used by GET /comfyui-health endpoint.
 */
async function checkHealth() {
  const gpuInfo = await getGpuInfoAccurate();
  const queueInfo = await getComfyUIQueueInfo();

  if (!queueInfo) {
    return {
      available: false,
      fallback_reason: FALLBACK_REASONS.OFFLINE,
      gpu: gpuInfo?.gpu || 'unknown',
      gpu_vram_total_mb: gpuInfo?.vram_total_mb || 0,
      gpu_vram_free_mb: gpuInfo?.vram_free_mb || 0,
      queue_size: -1,
      queue_limit: COMFYUI_MAX_QUEUE,
      vram_floor_mb: COMFYUI_MIN_VRAM_MB,
      vram_floor_img2vid_mb: COMFYUI_MIN_VRAM_MB_IMG2VID,
    };
  }

  const vramFree = gpuInfo?.vram_free_mb || 0;
  const queueFull = queueInfo.queue_size >= COMFYUI_MAX_QUEUE;
  const vramLow = gpuInfo && vramFree < COMFYUI_MIN_VRAM_MB;

  let fallbackReason = null;
  if (queueFull) fallbackReason = FALLBACK_REASONS.QUEUE_FULL;
  else if (vramLow) fallbackReason = FALLBACK_REASONS.VRAM_LOW;

  return {
    available: !queueFull && !vramLow,
    fallback_reason: fallbackReason,
    gpu: gpuInfo?.gpu || 'unknown',
    gpu_vram_total_mb: gpuInfo?.vram_total_mb || 0,
    gpu_vram_free_mb: vramFree,
    queue_size: queueInfo.queue_size,
    queue_limit: COMFYUI_MAX_QUEUE,
    vram_floor_mb: COMFYUI_MIN_VRAM_MB,
    vram_floor_img2vid_mb: COMFYUI_MIN_VRAM_MB_IMG2VID,
  };
}

// ─── ComfyUI API Client ─────────────────────────────────────────────────

/**
 * Submit a prompt to ComfyUI and return the prompt ID.
 * 
 * @param {object} workflow - Ready-to-submit workflow (from loadWorkflow)
 * @returns {Promise<string>} ComfyUI prompt_id
 */
async function queuePrompt(workflow) {
  const res = await fetch(`${COMFYUI_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`ComfyUI queue prompt failed: ${res.status} ${errorText.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.prompt_id;
}

/**
 * Poll ComfyUI for prompt completion.
 * Returns the history entry when done, or null if still running.
 * 
 * @param {string} promptId - ComfyUI prompt_id
 * @returns {Promise<object|null>}
 */
async function getPromptStatus(promptId) {
  try {
    const res = await fetch(`${COMFYUI_URL}/history/${promptId}`);
    if (!res.ok) return null;

    const data = await res.json();
    const entry = data[promptId];
    if (!entry) return null;

    return entry;
  } catch {
    return null;
  }
}

/**
 * Fetch a generated image from ComfyUI's output.
 * 
 * @param {string} filename - Image filename from ComfyUI output
 * @param {string} subfolder - Subfolder (usually '')
 * @param {string} type - 'output' or 'temp'
 * @returns {Promise<Buffer>}
 */
async function fetchImage(filename, subfolder = '', type = 'output') {
  const params = new URLSearchParams({ filename, subfolder, type });
  const res = await fetch(`${COMFYUI_URL}/view?${params}`);

  if (!res.ok) {
    throw new Error(`ComfyUI fetch image failed: ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * Complete generation flow: queue prompt → poll until done → fetch images.
 * Now includes WebSocket progress tracking (mirrors generateVideo behavior).
 * 
 * @param {object} workflow - Ready-to-submit workflow
 * @param {number} [timeoutMs] - Override timeout
 * @param {function} [onProgress] - Optional callback: (progress) => void, called with { step, max_steps, percentage, node, stage, elapsed_s }
 * @returns {Promise<{ prompt_id: string, images: Buffer[], metadata: object }>}
 */
async function generateImage(workflow, timeoutMs = COMFYUI_TIMEOUT_MS, onProgress = null) {
  const startTime = Date.now();
  const promptId = await queuePrompt(workflow);
  console.log(`[COMFYUI] Queued prompt: ${promptId}`);

  // ── WebSocket progress listener (same as generateVideo) ──
  // ComfyUI broadcasts real-time progress via WebSocket:
  //   { type: 'progress', data: { value, max, prompt_id, node } }
  //   { type: 'executing', data: { node, prompt_id } }  (node=null when done)
  let wsProgress = { step: 0, max_steps: 0, percentage: 0, node: null, stage: 'queued', elapsed_s: 0 };
  let ws = null;
  let lastLoggedPct = -1;
  try {
    const wsUrl = COMFYUI_URL.replace('http', 'ws') + '/ws?clientId=video-renderer-img-progress';
    ws = new WebSocket(wsUrl);
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'progress' && msg.data?.prompt_id === promptId) {
          wsProgress.step = msg.data.value || 0;
          wsProgress.max_steps = msg.data.max || 0;
          wsProgress.percentage = wsProgress.max_steps > 0
            ? Math.round((wsProgress.step / wsProgress.max_steps) * 100) : 0;
          wsProgress.node = msg.data.node || wsProgress.node;
          wsProgress.stage = 'generating';
          wsProgress.elapsed_s = ((Date.now() - startTime) / 1000);

          // Console progress bar — log every 10% or on completion
          if (wsProgress.percentage >= lastLoggedPct + 10 || wsProgress.percentage === 100) {
            const elapsed = wsProgress.elapsed_s.toFixed(1);
            const filled = Math.round(wsProgress.percentage / 4); // 25-char bar
            const bar = '█'.repeat(filled) + '░'.repeat(25 - filled);
            const rate = wsProgress.step > 0 ? (wsProgress.step / wsProgress.elapsed_s).toFixed(2) : '0.00';
            console.log(`[COMFYUI] ${wsProgress.percentage}% |${bar}| ${wsProgress.step}/${wsProgress.max_steps} [${elapsed}s, ${rate}it/s]`);
            lastLoggedPct = wsProgress.percentage;
          }

          if (onProgress) onProgress({ ...wsProgress });
        } else if (msg.type === 'executing' && msg.data?.prompt_id === promptId) {
          if (msg.data.node === null) {
            wsProgress.stage = 'complete';
            wsProgress.percentage = 100;
          } else {
            wsProgress.node = msg.data.node;
            wsProgress.stage = 'generating';
          }
          if (onProgress) onProgress({ ...wsProgress });
        }
      } catch { /* ignore parse errors */ }
    });
    ws.on('error', () => { /* non-fatal — fall back to poll-only */ });
  } catch {
    console.log('[COMFYUI] WebSocket unavailable — progress tracking disabled');
  }

  try {
    // Poll for completion
    const pollInterval = 2000; // 2s between polls
    while (Date.now() - startTime < timeoutMs) {
      await new Promise(r => setTimeout(r, pollInterval));

      const history = await getPromptStatus(promptId);
      if (!history) continue;

      // Check for errors
      if (history.status?.status_str === 'error') {
        const errorMsg = history.status?.messages
          ?.filter(m => m[0] === 'execution_error')
          ?.map(m => {
            const detail = m[1];
            if (typeof detail === 'string') return detail;
            return detail?.exception_message || detail?.message || JSON.stringify(detail);
          })
          .join('; ') || 'unknown error';
        throw new Error(`ComfyUI generation error: ${errorMsg}`);
      }

      // Extract output images
      if (history.outputs) {
        const images = [];
        for (const nodeId of Object.keys(history.outputs)) {
          const nodeOutput = history.outputs[nodeId];
          if (nodeOutput.images) {
            for (const img of nodeOutput.images) {
              const buffer = await fetchImage(img.filename, img.subfolder || '', img.type || 'output');
              images.push(buffer);
            }
          }
        }

        if (images.length > 0) {
          const elapsed = Date.now() - startTime;
          console.log(`[COMFYUI] ✓ Generated ${images.length} image(s) in ${(elapsed / 1000).toFixed(1)}s`);
          return {
            prompt_id: promptId,
            images,
            metadata: {
              comfyui_prompt_id: promptId,
              generation_time_ms: elapsed,
            },
          };
        }
      }
    }

    // Timeout
    throw new Error(`ComfyUI generation timed out after ${timeoutMs}ms (prompt_id: ${promptId})`);
  } finally {
    // Clean up WebSocket
    if (ws) try { ws.close(); } catch { /* ignore */ }
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────

module.exports = {
  // Config
  COMFYUI_URL,
  COMFYUI_TIMEOUT_MS,
  COMFYUI_TIMEOUT_MS_IMG2VID,
  COMFYUI_MAX_QUEUE,
  COMFYUI_MAX_QUEUE_IMG2VID,
  COMFYUI_MIN_VRAM_MB,
  COMFYUI_MIN_VRAM_MB_IMG2VID,
  COMFYUI_DEFAULT_WORKFLOW,
  COMFYUI_DEFAULT_CHECKPOINT,
  COMFYUI_INPUT_DIR,
  FALLBACK_REASONS,

  // Core functions (txt2img)
  loadWorkflow,
  translatePromptForComfyUI,
  hashSeed,
  promptHash,
  checkHealth,
  queuePrompt,
  getPromptStatus,
  fetchImage,
  generateImage,
  getGpuInfo,
  getComfyUIQueueInfo,

  // img2vid functions (Phase 2)
  loadImg2VidWorkflow,
  downloadImageForComfyUI,
  generateVideo,
  checkHealthImg2Vid,
};
