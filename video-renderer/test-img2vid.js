/**
 * Test img2vid endpoint — SVD-XT and AnimateDiff
 */
const IMAGE_URL = 'https://ustmetegzisztqqcjigt.supabase.co/storage/v1/object/public/story-videos/brands/68a58afb-8c85-4d6d-9eec-144ab7e5f106/jobs/484e737f-878b-4dcf-8e95-76d80b30e703/images/scene_000.png';
const RENDERER = 'http://localhost:3001';

async function testImg2Vid(workflow) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Testing img2vid: ${workflow}`);
  console.log(`${'='.repeat(60)}\n`);

  const body = {
    job_id: `test_${workflow}_${Date.now()}`,
    scene_index: 0,
    image_url: IMAGE_URL,
    workflow: workflow,           // 'svd' or 'animatediff'
    motion_strength: 0.5,
    fps: 8,
    video_frames: workflow === 'svd' ? 25 : 16,
    width: 768,
    height: 1024,
  };

  console.log('Dispatching:', JSON.stringify(body, null, 2));

  const startTime = Date.now();

  // Step 1: Dispatch
  const dispatchResp = await fetch(`${RENDERER}/comfyui-img2vid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!dispatchResp.ok) {
    const text = await dispatchResp.text();
    console.error(`DISPATCH FAILED (${dispatchResp.status}):`, text);
    return;
  }

  const dispatch = await dispatchResp.json();
  console.log('Dispatched:', dispatch);
  const statusUrl = dispatch.status_url;

  if (!statusUrl) {
    console.error('No status_url in response');
    return;
  }

  // Step 2: Poll for completion
  const timeout = 5 * 60 * 1000; // 5 min
  const pollInterval = 5000;
  let polls = 0;

  while (Date.now() - startTime < timeout) {
    await new Promise(r => setTimeout(r, pollInterval));
    polls++;

    try {
      const statusResp = await fetch(`${RENDERER}${statusUrl}`);
      const status = await statusResp.json();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[${elapsed}s] Poll #${polls}: status=${status.status}, images=${status.images?.length || 0}`);

      if (status.status === 'complete') {
        console.log(`\n✅ ${workflow.toUpperCase()} COMPLETE in ${elapsed}s`);
        console.log(`   Images: ${status.images?.length || 0}`);
        console.log(`   Metadata:`, JSON.stringify(status.metadata || {}, null, 2).substring(0, 500));
        
        // Save result
        const fs = require('fs');
        fs.writeFileSync(`test-img2vid-${workflow}-result.json`, JSON.stringify(status, null, 2));
        console.log(`   Saved to test-img2vid-${workflow}-result.json`);
        return true;
      }

      if (status.status === 'error') {
        console.error(`\n❌ ${workflow.toUpperCase()} ERROR:`, status.error);
        return false;
      }
    } catch (err) {
      console.warn(`Poll #${polls} failed:`, err.message);
    }
  }

  console.error(`\n⏰ ${workflow.toUpperCase()} TIMED OUT after ${timeout / 1000}s`);
  return false;
}

async function main() {
  // Check health first
  const health = await fetch(`${RENDERER}/comfyui-health`).then(r => r.json());
  console.log('ComfyUI Health:', JSON.stringify(health, null, 2));

  if (!health.available) {
    console.error('ComfyUI not available:', health.fallback_reason);
    return;
  }

  if (health.gpu_vram_free_mb < health.vram_floor_img2vid_mb) {
    console.error(`VRAM too low: ${health.gpu_vram_free_mb}MB < ${health.vram_floor_img2vid_mb}MB floor`);
    return;
  }

  console.log(`✓ VRAM OK: ${health.gpu_vram_free_mb}MB free (floor: ${health.vram_floor_img2vid_mb}MB)`);

  // Test SVD first
  const svdOk = await testImg2Vid('svd');

  // Check VRAM between tests
  const health2 = await fetch(`${RENDERER}/comfyui-health`).then(r => r.json());
  console.log(`\nVRAM after SVD: ${health2.gpu_vram_free_mb}MB free`);

  // Test AnimateDiff
  const animOk = await testImg2Vid('animatediff');

  console.log('\n' + '='.repeat(60));
  console.log('  RESULTS');
  console.log('='.repeat(60));
  console.log(`  SVD-XT:      ${svdOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  AnimateDiff: ${animOk ? '✅ PASS' : '❌ FAIL'}`);
}

main().catch(e => console.error('FATAL:', e));
