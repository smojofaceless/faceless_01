// Test both RPCs after applying fix
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.log('Set SUPABASE_SERVICE_ROLE_KEY first');
  process.exit(1);
}

const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';

async function testClaimDuePosts() {
  console.log('Testing claim_due_posts...');
  
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_due_posts`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_worker_id: 'test-claim-worker',
      p_limit: 5
    })
  });
  
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text);
  return res.ok;
}

async function testMarkPosted(postId, workerId) {
  console.log(`\nTesting mark_post_posted for ${postId}...`);
  
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_post_posted`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_post_id: postId,
      p_worker_id: workerId,
      p_platform_post_id: 'stub_final_' + Date.now(),
      p_platform_url: 'https://final-test.com/' + Date.now()
    })
  });
  
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text);
  return res.ok;
}

async function checkPost(postId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=id,status,platform_post_id,platform_url,locked_by`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });
  const posts = await res.json();
  console.log('\nPost status:', JSON.stringify(posts[0], null, 2));
  return posts[0];
}

async function main() {
  console.log('='.repeat(50));
  console.log('POST QUEUE RPC TEST');
  console.log('='.repeat(50));
  
  // Test claim_due_posts
  const claimOk = await testClaimDuePosts();
  
  if (!claimOk) {
    console.log('\n⚠️ claim_due_posts failed. Apply the fix SQL first:');
    console.log('   Run scripts/fix-post-queue-meta.sql in Supabase SQL Editor');
    return;
  }
  
  // Check if any posts were claimed
  // For now, check the existing test post
  const postId = '460decd9-5de9-403a-8b2b-572d9f9d41a0';
  const post = await checkPost(postId);
  
  if (post && post.status === 'posting' && post.locked_by) {
    // Try to mark it as posted
    await testMarkPosted(postId, post.locked_by);
    await checkPost(postId);
  }
  
  console.log('\n' + '='.repeat(50));
}

main().catch(console.error);
