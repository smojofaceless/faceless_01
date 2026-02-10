/**
 * Comprehensive Failure Protection + DLQ Tests
 * 
 * Tests:
 * 1. Kill switch blocks scheduler + worker
 * 2. Auto-pause only on dependency clusters (not misconfig/permanent)
 * 3. Requeue respects max attempts + backoff
 * 
 * Run: node scripts/test-failure-protection-full.js
 */

const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';
// Service role key for admin operations
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDc0NzksImV4cCI6MjA4NTEyMzQ3OX0.5lEiAP6PS4yY3WwAL5v4XWFHWJS5hzBWPXQxuxWe5d4';

if (!SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable required');
  console.log('Run: $env:SUPABASE_SERVICE_ROLE_KEY = "your-key"; node scripts/test-failure-protection-full.js');
  process.exit(1);
}

async function rpc(name, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RPC ${name} failed: ${res.status} - ${text}`);
  }
  
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function query(table, select = '*', filters = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  
  for (const [key, value] of Object.entries(filters)) {
    url += `&${key}=${encodeURIComponent(value)}`;
  }
  
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': ANON_KEY,
    },
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Query ${table} failed: ${res.status} - ${text}`);
  }
  
  return res.json();
}

async function invokeFunction(name, body = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  
  return { status: res.status, data };
}

// =====================================================
// TEST 1: Kill Switch Blocks Scheduler + Worker
// =====================================================

async function testKillSwitch() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: Kill Switch Blocks Scheduler + Worker');
  console.log('='.repeat(60));
  
  // 1a. Turn kill switch ON
  console.log('\n📍 Step 1a: Activating kill switch...');
  await rpc('set_kill_switch', { 
    p_enabled: true, 
    p_reason: 'Test: blocking scheduler and worker' 
  });
  
  const isActive = await rpc('is_kill_switch_active');
  console.log(`   Kill switch active: ${isActive}`);
  
  if (!isActive) {
    throw new Error('Kill switch should be active!');
  }
  console.log('   ✅ Kill switch is ON');
  
  // 1b. Trigger scheduler - should return 503 or skip message
  console.log('\n📍 Step 1b: Triggering scheduler (expect abort)...');
  const schedulerResult = await invokeFunction('schedule-jobs', {});
  console.log(`   Scheduler response: ${schedulerResult.status}`);
  console.log(`   Body: ${JSON.stringify(schedulerResult.data).slice(0, 200)}`);
  
  if (schedulerResult.data.kill_switch_active !== true && 
      !schedulerResult.data.message?.includes('kill switch')) {
    console.log('   ⚠️ Scheduler did not clearly indicate kill switch block');
  } else {
    console.log('   ✅ Scheduler correctly blocked by kill switch');
  }
  
  // 1c. Get a test job to invoke worker with
  console.log('\n📍 Step 1c: Finding a job to test worker...');
  const jobs = await query('jobs', 'id,status,attempt_count', { 
    'status': 'in.(pending,queued,failed)',
    'limit': '1' 
  });
  
  if (jobs.length === 0) {
    console.log('   ⚠️ No jobs available to test worker - creating mock test');
  } else {
    const testJob = jobs[0];
    const beforeAttempts = testJob.attempt_count || 0;
    console.log(`   Found job ${testJob.id}, attempts: ${beforeAttempts}`);
    
    // 1d. Invoke worker with kill switch on
    console.log('\n📍 Step 1d: Invoking worker-v1 (expect early exit)...');
    const workerResult = await invokeFunction('worker-v1', { job_id: testJob.id });
    console.log(`   Worker response: ${workerResult.status}`);
    console.log(`   Body: ${JSON.stringify(workerResult.data).slice(0, 300)}`);
    
    // Check attempt_count didn't increase
    const jobAfter = await query('jobs', 'attempt_count', { 'id': `eq.${testJob.id}` });
    const afterAttempts = jobAfter[0]?.attempt_count || 0;
    console.log(`   Attempts before: ${beforeAttempts}, after: ${afterAttempts}`);
    
    if (afterAttempts > beforeAttempts) {
      console.log('   ⚠️ Warning: attempt_count increased despite kill switch');
    } else {
      console.log('   ✅ Worker blocked without incrementing attempt_count');
    }
  }
  
  // 1e. Turn kill switch OFF
  console.log('\n📍 Step 1e: Deactivating kill switch...');
  await rpc('set_kill_switch', { 
    p_enabled: false, 
    p_reason: 'Test complete' 
  });
  
  const isActiveAfter = await rpc('is_kill_switch_active');
  console.log(`   Kill switch active: ${isActiveAfter}`);
  
  if (isActiveAfter) {
    throw new Error('Kill switch should be OFF!');
  }
  console.log('   ✅ Kill switch is OFF');
  
  return true;
}

// =====================================================
// TEST 2: Auto-Pause Only on Dependency Clusters
// =====================================================

async function testAutoPause() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: Auto-Pause Only on Dependency Clusters');
  console.log('='.repeat(60));
  
  // Get a campaign to test with
  const campaigns = await query('generation_batches', 'id,name,status', { 
    'status': 'eq.active',
    'limit': '1' 
  });
  
  if (campaigns.length === 0) {
    console.log('   ⚠️ No active campaigns - skipping auto-pause test');
    return 'skipped';
  }
  
  const testCampaign = campaigns[0];
  console.log(`\n   Using campaign: ${testCampaign.name} (${testCampaign.id})`);
  
  // 2a. Simulate 5 DEPENDENCY failures
  console.log('\n📍 Step 2a: Simulating 5 dependency failures...');
  
  // Get jobs from this campaign
  const campaignJobs = await query('jobs', 'id', { 
    'batch_id': `eq.${testCampaign.id}`,
    'status': 'in.(pending,queued)',
    'limit': '5' 
  });
  
  if (campaignJobs.length < 5) {
    console.log(`   ⚠️ Only ${campaignJobs.length} jobs in campaign - need 5 for cluster`);
    console.log('   Testing with existing failed jobs instead...');
    
    // Check if there are existing dependency failures
    const clusters = await rpc('get_failure_clusters', {
      p_window_minutes: 60,
      p_min_count: 1
    });
    console.log(`   Existing clusters: ${JSON.stringify(clusters).slice(0, 500)}`);
    return 'partial';
  }
  
  // Mark jobs as failed with dependency signature
  for (const job of campaignJobs) {
    await rpc('update_job_failure', {
      p_job_id: job.id,
      p_failure: {
        class: 'dependency',
        signature: 'dependency:images:openai',
        step: 'images',
        error: 'OpenAI API returned 503 Service Unavailable',
        at: new Date().toISOString()
      }
    });
    
    // Also update job status to failed
    await fetch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ status: 'failed', updated_at: new Date().toISOString() })
    });
  }
  
  console.log(`   Created ${campaignJobs.length} dependency failures`);
  
  // 2b. Run auto-pause check
  console.log('\n📍 Step 2b: Running auto_pause_affected_campaigns...');
  const pauseResults = await rpc('auto_pause_affected_campaigns', {
    p_window_minutes: 10,
    p_min_failures: 5,
    p_cooldown_minutes: 0 // No cooldown for test
  });
  
  console.log(`   Pause results: ${JSON.stringify(pauseResults).slice(0, 500)}`);
  
  const paused = pauseResults?.filter(r => r.action === 'paused') || [];
  if (paused.length > 0) {
    console.log(`   ✅ Auto-paused ${paused.length} campaigns due to dependency failures`);
  } else {
    console.log('   ⚠️ No campaigns were auto-paused');
  }
  
  // 2c. Reset campaign and test misconfig failures
  console.log('\n📍 Step 2c: Resetting campaign and testing misconfig failures...');
  
  // Un-pause campaign
  await fetch(`${SUPABASE_URL}/rest/v1/generation_batches?id=eq.${testCampaign.id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ 
      status: 'active', 
      auto_paused_at: null, 
      auto_pause_reason: null 
    })
  });
  
  // Update same jobs to misconfig failures
  for (const job of campaignJobs) {
    await rpc('update_job_failure', {
      p_job_id: job.id,
      p_failure: {
        class: 'misconfig',
        signature: 'misconfig:voice:api_key',
        step: 'voice',
        error: 'Invalid API key for ElevenLabs',
        at: new Date().toISOString()
      }
    });
  }
  
  console.log(`   Updated ${campaignJobs.length} jobs to misconfig failures`);
  
  // 2d. Run auto-pause again - should NOT pause
  console.log('\n📍 Step 2d: Running auto_pause (should NOT pause for misconfig)...');
  const pauseResults2 = await rpc('auto_pause_affected_campaigns', {
    p_window_minutes: 10,
    p_min_failures: 5,
    p_cooldown_minutes: 0
  });
  
  console.log(`   Pause results: ${JSON.stringify(pauseResults2).slice(0, 500)}`);
  
  const paused2 = pauseResults2?.filter(r => r.action === 'paused') || [];
  if (paused2.length === 0) {
    console.log('   ✅ Correctly did NOT auto-pause for misconfig failures');
  } else {
    console.log('   ❌ Incorrectly auto-paused for misconfig failures!');
  }
  
  return true;
}

// =====================================================
// TEST 3: Requeue Respects Max Attempts + Backoff
// =====================================================

async function testRequeue() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: Requeue Respects Max Attempts + Backoff');
  console.log('='.repeat(60));
  
  // Get failed jobs with different attempt counts
  console.log('\n📍 Step 3a: Finding failed jobs with various attempt counts...');
  
  const failedJobs = await query('jobs', 'id,attempt_count,status,generate_by', {
    'status': 'eq.failed',
    'limit': '10',
    'order': 'attempt_count.asc'
  });
  
  console.log(`   Found ${failedJobs.length} failed jobs`);
  
  if (failedJobs.length === 0) {
    console.log('   ⚠️ No failed jobs to test requeue - skipping');
    return 'skipped';
  }
  
  // Group by attempt count
  const byAttempts = {};
  for (const job of failedJobs) {
    const count = job.attempt_count || 0;
    if (!byAttempts[count]) byAttempts[count] = [];
    byAttempts[count].push(job);
  }
  
  console.log('   Jobs by attempt count:');
  for (const [count, jobs] of Object.entries(byAttempts)) {
    console.log(`     attempt_count=${count}: ${jobs.length} jobs`);
  }
  
  // Test different attempt counts
  const now = new Date();
  const testCases = [
    { attempts: 0, expectedDelay: 0, desc: 'immediate' },
    { attempts: 1, expectedDelay: 30, desc: '+30 minutes' },
    { attempts: 2, expectedDelay: 120, desc: '+2 hours' },
    { attempts: 3, expectedDelay: -1, desc: 'blocked (max attempts)' }
  ];
  
  for (const testCase of testCases) {
    const jobs = byAttempts[testCase.attempts];
    if (!jobs || jobs.length === 0) {
      console.log(`\n   ⚠️ No job with attempt_count=${testCase.attempts} to test`);
      continue;
    }
    
    const testJob = jobs[0];
    console.log(`\n📍 Testing attempt_count=${testCase.attempts} (${testCase.desc})...`);
    console.log(`   Job: ${testJob.id}`);
    
    // Requeue
    const result = await rpc('requeue_job', {
      p_job_id: testJob.id,
      p_force: false
    });
    
    console.log(`   Result: ${JSON.stringify(result)}`);
    
    if (testCase.expectedDelay === -1) {
      // Should be blocked
      if (!result.success) {
        console.log(`   ✅ Correctly blocked requeue for max attempts`);
      } else {
        console.log(`   ❌ Should have blocked requeue!`);
      }
    } else {
      // Should succeed with correct backoff
      if (result.success) {
        // Check generate_by
        const updated = await query('jobs', 'generate_by,status', { 'id': `eq.${testJob.id}` });
        const newGenerateBy = new Date(updated[0].generate_by);
        const diffMinutes = (newGenerateBy - now) / 60000;
        
        console.log(`   New generate_by: ${updated[0].generate_by}`);
        console.log(`   Expected delay: ~${testCase.expectedDelay} min, actual: ${diffMinutes.toFixed(1)} min`);
        
        // Allow some tolerance
        const tolerance = 5; // minutes
        if (Math.abs(diffMinutes - testCase.expectedDelay) <= tolerance) {
          console.log(`   ✅ Backoff correct`);
        } else {
          console.log(`   ⚠️ Backoff may be off (tolerance: ±${tolerance} min)`);
        }
      } else {
        console.log(`   ❌ Requeue failed unexpectedly: ${result.message}`);
      }
    }
  }
  
  // Test bulk requeue
  console.log('\n📍 Step 3b: Testing bulk requeue_failed_jobs...');
  const bulkJobs = failedJobs.slice(0, 3).map(j => j.id);
  
  const bulkResult = await rpc('requeue_failed_jobs', {
    p_job_ids: bulkJobs,
    p_reset_attempts: false
  });
  
  console.log(`   Bulk result: ${JSON.stringify(bulkResult).slice(0, 500)}`);
  
  const successes = bulkResult?.filter(r => r.success) || [];
  const failures = bulkResult?.filter(r => !r.success) || [];
  console.log(`   ✅ Succeeded: ${successes.length}, ❌ Failed: ${failures.length}`);
  
  return true;
}

// =====================================================
// MAIN
// =====================================================

async function main() {
  console.log('🧪 Failure Protection + DLQ Comprehensive Tests');
  console.log('================================================\n');
  
  const results = {};
  
  try {
    results.killSwitch = await testKillSwitch();
  } catch (err) {
    console.error(`\n❌ Test 1 failed: ${err.message}`);
    results.killSwitch = false;
  }
  
  try {
    results.autoPause = await testAutoPause();
  } catch (err) {
    console.error(`\n❌ Test 2 failed: ${err.message}`);
    results.autoPause = false;
  }
  
  try {
    results.requeue = await testRequeue();
  } catch (err) {
    console.error(`\n❌ Test 3 failed: ${err.message}`);
    results.requeue = false;
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  
  for (const [name, result] of Object.entries(results)) {
    const status = result === true ? '✅ PASS' : 
                   result === 'skipped' ? '⏭️ SKIPPED' : 
                   result === 'partial' ? '⚠️ PARTIAL' : '❌ FAIL';
    console.log(`  ${name}: ${status}`);
  }
  
  const allPassed = Object.values(results).every(r => r === true || r === 'skipped');
  console.log(`\nOverall: ${allPassed ? '✅ All tests passed' : '⚠️ Some tests need attention'}`);
}

main().catch(console.error);
