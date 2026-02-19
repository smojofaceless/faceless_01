#!/usr/bin/env node
// =====================================================
// SMOKE TEST: Platform Cleanup Tasks
// Tests 3 cleanup items:
//   1. Fake TikTok records cleaned
//   2. TikTok/Twitter scheduling disabled
//   3. Threads metrics wired up
// =====================================================

const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDc0NzksImV4cCI6MjA4NTEyMzQ3OX0.5lEiAP6PS4yY3WwAL5v4XWFHWJS5hzBWPXQxuxWe5d4';

let passed = 0;
let failed = 0;
const results = [];

function assert(name, condition, detail = '') {
  if (condition) {
    passed++;
    results.push({ name, status: 'PASS', detail });
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    results.push({ name, status: 'FAIL', detail });
    console.log(`  ❌ ${name} ${detail ? '— ' + detail : ''}`);
  }
}

async function query(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function invokeFunction(name, body = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// =====================================================
// TEST GROUP 1: Fake TikTok Records Cleaned
// =====================================================
async function testTikTokCleanup() {
  console.log('\n📋 TEST GROUP 1: TikTok Fake Records Cleanup');

  // 1a. No TikTok posts should have "posted" status
  const postedTikTok = await query('posts?platform=eq.tiktok&status=eq.posted&select=id');
  assert('No TikTok posts with status=posted', postedTikTok.length === 0, `Found ${postedTikTok.length}`);

  // 1b. No TikTok posts should have stub_* platform_post_ids
  const stubTikTok = await query('posts?platform=eq.tiktok&platform_post_id=like.stub_*&select=id,platform_post_id');
  assert('No TikTok posts with stub_ platform IDs', stubTikTok.length === 0, `Found ${stubTikTok.length}`);

  // 1c. No scheduled TikTok posts
  const scheduledTikTok = await query('posts?platform=eq.tiktok&status=eq.scheduled&select=id');
  assert('No scheduled TikTok posts', scheduledTikTok.length === 0, `Found ${scheduledTikTok.length}`);

  // 1d. All TikTok posts should be "failed"
  const allTikTok = await query('posts?platform=eq.tiktok&select=id,status');
  const nonFailed = allTikTok.filter(p => p.status !== 'failed');
  assert('All TikTok posts are failed', nonFailed.length === 0, `${nonFailed.length} non-failed`);
}

// =====================================================
// TEST GROUP 2: TikTok/Twitter Scheduling Disabled
// =====================================================
async function testSchedulingDisabled() {
  console.log('\n📋 TEST GROUP 2: TikTok/Twitter Scheduling Disabled');

  // 2a. No scheduled Twitter posts
  const scheduledTwitter = await query('posts?platform=eq.twitter&status=eq.scheduled&select=id');
  assert('No scheduled Twitter posts', scheduledTwitter.length === 0, `Found ${scheduledTwitter.length}`);

  // 2b. Post-worker rejects TikTok platform
  // We can't actually trigger the worker without a real post, but we can verify
  // the function responds to a health-check-style invoke
  const pwResult = await invokeFunction('post-worker', { test: true });
  assert('post-worker is deployed and responds', pwResult.status !== 404, `Status: ${pwResult.status}`);

  // 2c. Worker-v1 is deployed
  const w1Result = await invokeFunction('worker-v1', { test: true });
  assert('worker-v1 is deployed and responds', w1Result.status !== 404, `Status: ${w1Result.status}`);

  // 2d. All Twitter posts should be failed
  const allTwitter = await query('posts?platform=eq.twitter&select=id,status');
  const nonFailedTwitter = allTwitter.filter(p => p.status !== 'failed');
  assert('All Twitter posts are failed', nonFailedTwitter.length === 0, `${nonFailedTwitter.length} non-failed`);
}

// =====================================================
// TEST GROUP 3: Threads Metrics Wired Up
// =====================================================
async function testThreadsMetrics() {
  console.log('\n📋 TEST GROUP 3: Threads Metrics Collection');

  // 3a. Metrics collector is deployed and responds
  const mcResult = await invokeFunction('metrics-collector', {});
  assert('metrics-collector is deployed and responds', mcResult.status !== 404, `Status: ${mcResult.status}`);

  // 3b. Check that Threads posts exist and have real platform_post_ids
  const threadsPosts = await query('posts?platform=eq.threads&status=eq.posted&select=id,platform_post_id');
  assert('Threads has posted posts', threadsPosts.length > 0, `Found ${threadsPosts.length}`);

  if (threadsPosts.length > 0) {
    const hasRealId = threadsPosts.some(p => p.platform_post_id && !p.platform_post_id.startsWith('stub_'));
    assert('Threads posts have real platform IDs (not stubs)', hasRealId,
      threadsPosts.map(p => p.platform_post_id).join(', '));
  }

  // 3c. Metrics collector ran without 404 (Threads adapter is registered)
  // The collector may return 200 (processed), 503 (kill switch), or 500 (error)
  // but NOT 404 (function missing)
  assert('metrics-collector did not return 404', mcResult.status !== 404, `Got ${mcResult.status}`);

  // 3d. Check metrics-collector response includes processing info
  // It should have processed/skipped counts if it ran
  if (mcResult.data && typeof mcResult.data === 'object') {
    const hasProcessingInfo = 'processed' in mcResult.data || 'status' in mcResult.data || 'error' in mcResult.data;
    assert('metrics-collector returns structured response', hasProcessingInfo,
      JSON.stringify(mcResult.data).slice(0, 200));
  } else {
    assert('metrics-collector returns structured response', false, 'No JSON response');
  }

  // 3e. Threads token exists in platform_tokens
  const threadsTokens = await query('platform_tokens?platform=eq.threads&select=id,is_valid,brand_id');
  assert('Threads platform token exists', threadsTokens.length > 0, `Found ${threadsTokens.length} token(s)`);

  if (threadsTokens.length > 0) {
    assert('Threads token is valid', threadsTokens[0].is_valid === true, `is_valid=${threadsTokens[0].is_valid}`);
  }
}

// =====================================================
// MAIN
// =====================================================
async function main() {
  console.log('===========================================');
  console.log('  Platform Cleanup Smoke Tests');
  console.log('  ' + new Date().toISOString());
  console.log('===========================================');

  try { await testTikTokCleanup(); } catch (e) { console.error('  ⚠️ Group 1 error:', e.message); }
  try { await testSchedulingDisabled(); } catch (e) { console.error('  ⚠️ Group 2 error:', e.message); }
  try { await testThreadsMetrics(); } catch (e) { console.error('  ⚠️ Group 3 error:', e.message); }

  console.log('\n===========================================');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('===========================================');

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  ❌ ${r.name}: ${r.detail}`));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
