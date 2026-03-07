/**
 * Quick ComfyUI end-to-end test
 * Usage: node test-comfyui.js
 */
const SERVER = 'http://localhost:3001';

async function main() {
  // 1. Health check
  console.log('=== ComfyUI Health Check ===');
  const health = await fetch(`${SERVER}/comfyui-health`).then(r => r.json());
  console.log(JSON.stringify(health, null, 2));

  if (!health.available) {
    console.log('ComfyUI not available — aborting test');
    process.exit(1);
  }

  // 2. Dispatch generation
  console.log('\n=== Dispatching ComfyUI Generation ===');
  const body = {
    job_id: 'test-comfyui-' + Date.now(),
    scenes: [{
      index: 0,
      prompt: 'A shadowy figure standing in a dimly lit Victorian hallway, horror atmosphere, cinematic lighting, detailed, 8k',
    }],
    workflow: 'txt2img_sdxl',
    steps: 28,
    cfg: 5.5,
  };

  const dispatch = await fetch(`${SERVER}/comfyui-generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());

  console.log('Dispatch result:', JSON.stringify(dispatch, null, 2));

  if (!dispatch.comfy_job_id) {
    console.log('Dispatch failed — aborting');
    process.exit(1);
  }

  // 3. Poll for completion
  console.log('\n=== Polling for completion ===');
  const statusUrl = `${SERVER}${dispatch.status_url}`;
  let done = false;
  while (!done) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await fetch(statusUrl).then(r => r.json());
    console.log(`Status: ${status.status} (${status.completed}/${status.total})`);

    if (status.status === 'complete' || status.status === 'partial' || status.status === 'error') {
      done = true;
      console.log('\n=== Final Result ===');
      const fs = require('fs');
      fs.writeFileSync('D:/SMOJO/Online/Buisness/faceless_01/comfy-test-result.json', JSON.stringify(status, null, 2));
      console.log('Result saved to comfy-test-result.json');
      if (status.images && status.images.length > 0) {
        console.log('\n✅ SUCCESS — Image generated!');
        console.log('Image URL:', status.images[0].url || '(local only)');
      }
      if (status.errors && status.errors.length > 0) {
        console.log('\n❌ ERRORS:', JSON.stringify(status.errors, null, 2));
      }
    }
  }
}

main().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
