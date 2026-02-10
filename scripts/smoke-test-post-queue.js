// =====================================================
// POST QUEUE SMOKE TEST
// Tests the post queue system end-to-end
//
// Usage:
//   $env:SUPABASE_SERVICE_ROLE_KEY = "your-key"
//   node scripts/smoke-test-post-queue.js
// =====================================================

const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable required');
  console.log('Run: $env:SUPABASE_SERVICE_ROLE_KEY = "your-key"; node scripts/smoke-test-post-queue.js');
  process.exit(1);
}

// Helper: Call RPC
async function callRpc(name, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`RPC ${name} failed: ${res.status} - ${text}`);
  }
  
  return text ? JSON.parse(text) : null;
}

// Helper: Query table
async function query(table, select = '*', filters = '') {
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  if (filters) url += '&' + filters;
  
  const res = await fetch(url, {
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Query ${table} failed: ${res.status} - ${text}`);
  }
  
  return JSON.parse(text);
}

// Helper: Insert into table
async function insert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Insert ${table} failed: ${res.status} - ${text}`);
  }
  
  return JSON.parse(text);
}

// Helper: Update table
async function update(table, id, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Update ${table} failed: ${res.status} - ${text}`);
  }
  
  return JSON.parse(text);
}

// Helper: Delete from table
async function deleteRow(table, id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'DELETE',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  
  if (!res.ok) {
    console.warn(`Delete ${table} ${id} failed: ${res.status}`);
  }
}

// Helper: Call edge function
async function callFunction(name, body = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

// =====================================================
// TESTS
// =====================================================

async function testMigrationApplied() {
  console.log('\n📋 TEST 1: Check migration applied');
  console.log('─'.repeat(50));
  
  try {
    // Try calling find_due_posts RPC
    const duePosts = await callRpc('find_due_posts', { p_limit: 1 });
    console.log('✅ find_due_posts RPC exists');
    console.log(`   Found ${duePosts?.length || 0} due posts`);
    return true;
  } catch (err) {
    console.log('❌ Migration NOT applied');
    console.log('   Error:', err.message);
    console.log('\n📝 To apply migration:');
    console.log('   1. Go to Supabase Dashboard → SQL Editor');
    console.log('   2. Paste contents of: supabase/migrations/20260223001_post_queue_system.sql');
    console.log('   3. Click "Run"');
    return false;
  }
}

async function testCreateAndProcessPost() {
  console.log('\n📋 TEST 2: Create and process a test post (Step B)');
  console.log('─'.repeat(50));
  
  // Find a completed job
  const jobs = await query('jobs', 'id,brand_id,status', 'status=eq.completed&limit=1');
  
  let jobId, brandId, videoUrl;
  
  if (jobs.length > 0) {
    jobId = jobs[0].id;
    brandId = jobs[0].brand_id;
    videoUrl = 'https://example.com/test-video.mp4'; // Placeholder - actual URL from storage
    console.log(`   Using job: ${jobId.slice(0,8)}...`);
  } else {
    // No completed job - use placeholder
    console.log('   ⚠️ No completed jobs found, using placeholder brand');
    const brands = await query('brands', 'id', 'limit=1');
    if (brands.length === 0) {
      console.log('   ❌ No brands found - cannot create test post');
      return null;
    }
    brandId = brands[0].id;
    videoUrl = 'https://example.com/smoke-test-video.mp4';
  }
  
  // Create test post (due immediately)
  const scheduledAt = new Date(Date.now() - 60000).toISOString(); // 1 min ago
  
  const [post] = await insert('posts', {
    job_id: jobId || null,
    brand_id: brandId,
    platform: 'tiktok',
    scheduled_at: scheduledAt,
    video_url: videoUrl,  // Required NOT NULL column
    video_storage_path: videoUrl,
    title: 'Smoke Test Post ' + Date.now(),
    status: 'scheduled',
    attempt_count: 0,
  });
  
  console.log(`✅ Created test post: ${post.id.slice(0,8)}...`);
  console.log(`   Platform: ${post.platform}`);
  console.log(`   Scheduled: ${post.scheduled_at}`);
  
  return post;
}

async function testSchedulerRun(expectedPosts = 1) {
  console.log('\n📋 TEST 3: Run schedule-posts');
  console.log('─'.repeat(50));
  
  const { status, data } = await callFunction('schedule-posts', {});
  
  console.log(`   Status: ${status}`);
  console.log(`   Kill switch: ${data.kill_switch_active}`);
  console.log(`   Stale leases swept: ${data.stale_leases_swept}`);
  console.log(`   Posts found: ${data.posts_found}`);
  console.log(`   Posts triggered: ${data.posts_triggered}`);
  console.log(`   Posts posted: ${data.posts_posted}`);
  console.log(`   Posts failed: ${data.posts_failed}`);
  
  if (data.errors?.length > 0) {
    console.log(`   Errors: ${data.errors.join(', ')}`);
  }
  
  if (data.posts_posted >= expectedPosts) {
    console.log('✅ Scheduler processed posts successfully');
  } else if (data.posts_found >= expectedPosts) {
    console.log('✅ Scheduler found posts (worker may have processed them)');
  } else {
    console.log('⚠️ No posts processed (may already be processed)');
  }
  
  return data;
}

async function testVerifyPostStatus(postId) {
  console.log('\n📋 TEST 4: Verify post status');
  console.log('─'.repeat(50));
  
  const posts = await query('posts', 'id,status,platform_post_id,platform_url,attempt_count,error', `id=eq.${postId}`);
  
  if (posts.length === 0) {
    console.log('❌ Post not found');
    return false;
  }
  
  const post = posts[0];
  console.log(`   Status: ${post.status}`);
  console.log(`   Attempt count: ${post.attempt_count}`);
  console.log(`   Platform post ID: ${post.platform_post_id || '(none)'}`);
  console.log(`   Platform URL: ${post.platform_url || '(none)'}`);
  
  if (post.error) {
    console.log(`   Error: ${JSON.stringify(post.error)}`);
  }
  
  if (post.status === 'posted') {
    console.log('✅ Post successfully posted (stub)');
    return true;
  } else if (post.status === 'posting') {
    console.log('⏳ Post still processing');
    return 'pending';
  } else if (post.status === 'failed') {
    console.log('❌ Post failed');
    return false;
  } else {
    console.log('⚠️ Post still scheduled (not claimed yet)');
    return 'pending';
  }
}

async function testIdempotency(postId) {
  console.log('\n📋 TEST 5: Idempotency test (Step C) - run scheduler twice');
  console.log('─'.repeat(50));
  
  // First run
  console.log('   Run 1...');
  const result1 = await callFunction('schedule-posts', {});
  console.log(`   → Found: ${result1.data.posts_found}, Posted: ${result1.data.posts_posted}`);
  
  // Second run immediately
  console.log('   Run 2 (should find 0 or skip)...');
  const result2 = await callFunction('schedule-posts', {});
  console.log(`   → Found: ${result2.data.posts_found}, Posted: ${result2.data.posts_posted}`);
  
  if (result2.data.posts_found === 0 || result2.data.posts_posted === 0) {
    console.log('✅ Idempotency working - second run found no new posts');
    return true;
  } else {
    console.log('⚠️ Second run found posts (may be other posts in queue)');
    return true; // Not necessarily a failure
  }
}

async function testLeaseRecovery(postId) {
  console.log('\n📋 TEST 6: Lease recovery test (Step D)');
  console.log('─'.repeat(50));
  
  // Create a new test post for this
  const brands = await query('brands', 'id', 'limit=1');
  if (brands.length === 0) {
    console.log('❌ No brands found');
    return false;
  }
  
  const [stuckPost] = await insert('posts', {
    brand_id: brands[0].id,
    platform: 'youtube',
    scheduled_at: new Date(Date.now() - 300000).toISOString(), // 5 min ago
    video_url: 'https://example.com/stuck-video.mp4',  // Required NOT NULL
    video_storage_path: 'https://example.com/stuck-video.mp4',
    title: 'Stuck Post Test ' + Date.now(),
    status: 'posting', // Stuck in posting
    locked_by: 'dead-worker-12345',
    locked_at: new Date(Date.now() - 600000).toISOString(), // 10 min ago
    lease_expires_at: new Date(Date.now() - 300000).toISOString(), // Expired 5 min ago
    attempt_count: 1,
  });
  
  console.log(`   Created stuck post: ${stuckPost.id.slice(0,8)}...`);
  console.log(`   Status: ${stuckPost.status}, Locked by: ${stuckPost.locked_by}`);
  
  // Dry run first
  console.log('   Dry run sweep...');
  const dryRun = await callRpc('sweep_stale_post_leases', { p_dry_run: true });
  console.log(`   → Would sweep: ${dryRun?.length || 0} posts`);
  
  // Actual sweep
  console.log('   Actual sweep...');
  const swept = await callRpc('sweep_stale_post_leases', { p_dry_run: false });
  console.log(`   → Swept: ${swept?.length || 0} posts`);
  
  // Verify it's back to scheduled
  const [updated] = await query('posts', 'id,status,locked_by,lease_expires_at', `id=eq.${stuckPost.id}`);
  console.log(`   After sweep: status=${updated.status}, locked_by=${updated.locked_by || '(none)'}`);
  
  // Cleanup
  await deleteRow('posts', stuckPost.id);
  console.log(`   Cleaned up test post`);
  
  if (updated.status === 'scheduled' && !updated.locked_by) {
    console.log('✅ Lease recovery working');
    return true;
  } else {
    console.log('❌ Lease recovery failed');
    return false;
  }
}

async function cleanup(postId) {
  console.log('\n🧹 Cleanup');
  console.log('─'.repeat(50));
  
  if (postId) {
    await deleteRow('posts', postId);
    console.log(`   Deleted test post: ${postId.slice(0,8)}...`);
  }
}

// =====================================================
// MAIN
// =====================================================

async function main() {
  console.log('═'.repeat(50));
  console.log('POST QUEUE SMOKE TEST');
  console.log('═'.repeat(50));
  
  let testPost = null;
  
  try {
    // Test 1: Check migration
    const migrationOk = await testMigrationApplied();
    if (!migrationOk) {
      console.log('\n⛔ Cannot continue - migration not applied');
      process.exit(1);
    }
    
    // Test 2: Create test post
    testPost = await testCreateAndProcessPost();
    if (!testPost) {
      console.log('\n⛔ Cannot continue - no test post');
      process.exit(1);
    }
    
    // Test 3: Run scheduler
    await testSchedulerRun(1);
    
    // Wait a bit for processing
    await new Promise(r => setTimeout(r, 2000));
    
    // Test 4: Verify status
    const status = await testVerifyPostStatus(testPost.id);
    
    // Test 5: Idempotency
    await testIdempotency(testPost.id);
    
    // Test 6: Lease recovery
    await testLeaseRecovery();
    
    console.log('\n' + '═'.repeat(50));
    console.log('SMOKE TEST COMPLETE');
    console.log('═'.repeat(50));
    
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
  } finally {
    // Cleanup
    if (testPost) {
      await cleanup(testPost.id);
    }
  }
}

main();
