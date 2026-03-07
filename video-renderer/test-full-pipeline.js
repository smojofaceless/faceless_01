/**
 * Full Pipeline Test: ComfyUI txt2img → SVD img2vid → Render with img2vid clips
 * Tests the complete local pipeline end-to-end.
 * 
 * Since Supabase isn't configured on the local video-renderer, we use ComfyUI's
 * native API to generate images and serve them directly, then test img2vid + render.
 */
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3001';
const COMFYUI = 'http://127.0.0.1:8188';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Generate an image directly via ComfyUI API (bypassing server_clean.js)
 * Returns the filename accessible via COMFYUI /view endpoint
 */
async function generateImageDirect(prompt, negPrompt, seed) {
  // Load workflow template
  const workflowPath = path.join(__dirname, 'comfyui', 'workflows', 'txt2img_sdxl.json');
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

  // Configure
  if (workflow['6']?.inputs) workflow['6'].inputs.text = prompt;         // positive
  if (workflow['7']?.inputs) workflow['7'].inputs.text = negPrompt;      // negative
  if (workflow['3']?.inputs) {
    workflow['3'].inputs.seed = seed;
    workflow['3'].inputs.steps = 20;
    workflow['3'].inputs.cfg = 5.5;
  }
  if (workflow['5']?.inputs) {
    workflow['5'].inputs.width = 768;
    workflow['5'].inputs.height = 1024;
  }

  // Queue prompt
  const resp = await fetch(`${COMFYUI}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  }).then(r => r.json());

  const promptId = resp.prompt_id;
  console.log(`    Queued: ${promptId}`);

  // Poll for completion
  const start = Date.now();
  while (Date.now() - start < 300000) {
    await sleep(3000);
    const history = await fetch(`${COMFYUI}/history/${promptId}`).then(r => r.json());
    const entry = history[promptId];
    if (!entry) continue;

    if (entry.status?.status_str === 'error') {
      const msg = entry.status?.messages
        ?.filter(m => m[0] === 'execution_error')
        ?.map(m => m[1]?.exception_message || JSON.stringify(m[1]))
        .join('; ');
      throw new Error(`ComfyUI error: ${msg}`);
    }

    if (entry.outputs) {
      for (const nodeId of Object.keys(entry.outputs)) {
        const nodeOut = entry.outputs[nodeId];
        if (nodeOut.images && nodeOut.images.length > 0) {
          const img = nodeOut.images[0];
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          console.log(`    ✓ Generated in ${elapsed}s: ${img.filename}`);
          return {
            filename: img.filename,
            subfolder: img.subfolder || '',
            type: img.type || 'output',
            url: `${COMFYUI}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${img.subfolder || ''}&type=${img.type || 'output'}`,
          };
        }
      }
    }
  }
  throw new Error('Image generation timed out');
}

async function pollImg2Vid(comfyJobId, maxWaitS = 600) {
  const start = Date.now();
  while (Date.now() - start < maxWaitS * 1000) {
    await sleep(5000);
    const data = await fetch(`${BASE}/comfyui-status/${comfyJobId}`).then(r => r.json());
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`    [${elapsed}s] ${data.status} frames:${data.frame_count}`);
    if (data.status === 'complete') return data;
    if (data.status === 'error') throw new Error(`img2vid error: ${JSON.stringify(data.errors)}`);
  }
  throw new Error(`img2vid timeout after ${maxWaitS}s`);
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  FULL PIPELINE TEST: txt2img → SVD → Render');
  console.log('═══════════════════════════════════════════\n');

  // ── Step 0: Health check ──
  console.log('▶ Step 0: Health check');
  const health = await fetch(`${BASE}/comfyui-health`).then(r => r.json());
  console.log(`  GPU: ${health.gpu}, VRAM free: ${health.gpu_vram_free_mb} MB`);
  if (!health.available) throw new Error('ComfyUI not available');
  console.log('  ✓ ComfyUI ready\n');

  // ── Step 1: Generate 2 images via ComfyUI txt2img (direct API) ──
  console.log('▶ Step 1: Generate 2 images via ComfyUI txt2img');
  const prompts = [
    {
      pos: 'A dark abandoned hospital corridor at night, moonlight streaming through broken windows, eerie atmosphere, horror, photorealistic, cinematic lighting, 4k',
      neg: 'blurry, low quality, text, watermark, deformed, cartoon, anime',
    },
    {
      pos: 'A shadowy figure standing at the end of a foggy forest path, silhouetted against pale moonlight, horror atmosphere, photorealistic, cinematic, 4k',
      neg: 'blurry, low quality, text, watermark, deformed, cartoon, anime',
    },
  ];

  const generatedImages = [];
  for (let i = 0; i < prompts.length; i++) {
    console.log(`  Image ${i + 1}/${prompts.length}:`);
    const img = await generateImageDirect(prompts[i].pos, prompts[i].neg, 42000 + i);
    generatedImages.push(img);
  }
  console.log('');

  // ── Step 2: SVD img2vid for each image ──
  console.log('▶ Step 2: SVD img2vid for each image');

  // Free VRAM (SDXL model from txt2img is loaded)
  console.log('  Freeing VRAM from txt2img...');
  await fetch(`${COMFYUI}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  });
  await sleep(3000);
  const h2 = await fetch(`${BASE}/comfyui-health`).then(r => r.json());
  console.log(`  VRAM after free: ${h2.gpu_vram_free_mb} MB\n`);

  const vidResults = [];
  for (let i = 0; i < generatedImages.length; i++) {
    console.log(`  Scene ${i}: SVD img2vid`);

    const resp = await fetch(`${BASE}/comfyui-img2vid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: `pipeline_test`,
        scene_index: i,
        image_url: generatedImages[i].url,
        workflow: 'svd',
        motion_strength: 0.5,
        fps: 8,
        video_frames: 14,
        width: 768,
        height: 1024,
      }),
    }).then(r => r.json());

    if (resp.error) {
      console.log(`    REJECTED: ${resp.error} (VRAM: ${resp.gpu_vram_free_mb}MB)`);
      vidResults.push(null);
      continue;
    }

    console.log(`    Dispatched: ${resp.comfy_job_id}`);
    try {
      const result = await pollImg2Vid(resp.comfy_job_id, 600);
      console.log(`    ✓ ${result.frame_count} frames, ${result.video_duration_seconds}s, ${result.metadata?.generation_time_ms}ms`);
      vidResults.push(result);
    } catch (err) {
      console.log(`    ✗ ${err.message}`);
      vidResults.push(null);
    }

    // Free VRAM between scenes
    if (i < generatedImages.length - 1) {
      console.log('    Freeing VRAM...');
      await fetch(`${COMFYUI}/free`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
      });
      await sleep(3000);
    }
  }
  console.log('');

  // ── Step 3: Render video with img2vid clips ──
  console.log('▶ Step 3: Render final video with img2vid clips');

  // Build img2vid_clips map   { "0": { url, duration }, ... }
  const img2vidClips = {};
  for (let i = 0; i < vidResults.length; i++) {
    if (vidResults[i] && vidResults[i].video_url) {
      img2vidClips[String(i)] = {
        url: `${BASE}${vidResults[i].video_url}`,
        duration: vidResults[i].video_duration_seconds,
      };
    }
  }

  // Image URLs (from ComfyUI view API — render will download these as fallback stills)
  const imageUrls = generatedImages.map(img => img.url);

  console.log(`  img2vid clips available: ${Object.keys(img2vidClips).length}/${generatedImages.length}`);

  const renderResp = await fetch(`${BASE}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      images: imageUrls,
      durations: [4, 4],
      captions: [],
      effects: { kenBurns: true },
      img2vid_clips: img2vidClips,
    }),
  }).then(r => r.json());

  if (!renderResp.success) {
    console.log(`  ✗ Render dispatch failed: ${renderResp.error}`);
    return;
  }

  console.log(`  Render dispatched: ${renderResp.job_id}`);

  // Poll render
  const renderStart = Date.now();
  while (Date.now() - renderStart < 120000) {
    await sleep(3000);
    const status = await fetch(`${BASE}/status/${renderResp.job_id}`).then(r => r.json());
    const elapsed = ((Date.now() - renderStart) / 1000).toFixed(0);
    console.log(`    [${elapsed}s] ${status.status} progress:${status.progress}%`);
    if (status.status === 'completed' || status.status === 'done') {
      console.log(`  ✓ Render complete!`);
      console.log(`  Video: ${status.url || 'local file'}`);
      break;
    }
    if (status.status === 'error') {
      console.log(`  ✗ Render error: ${status.error}`);
      break;
    }
  }

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════');
  console.log('  PIPELINE TEST RESULTS');
  console.log('═══════════════════════════════════════════');
  console.log(`  Images generated:  ${generatedImages.length}`);
  console.log(`  img2vid clips:     ${Object.keys(img2vidClips).length}`);
  for (const [idx, clip] of Object.entries(img2vidClips)) {
    console.log(`    Scene ${idx}: ${clip.duration}s clip`);
  }
  console.log(`  Render job:        ${renderResp.job_id}`);
  console.log('═══════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\n✗ PIPELINE FAILED:', err.message);
  process.exit(1);
});
