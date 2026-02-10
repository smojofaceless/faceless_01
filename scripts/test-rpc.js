// Quick test for mark_post_posted RPC
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const postId = '460decd9-5de9-403a-8b2b-572d9f9d41a0';

if (!key) {
  console.log('Set SUPABASE_SERVICE_ROLE_KEY first');
  process.exit(1);
}

async function test() {
  console.log('Testing mark_post_posted...');
  
  const res = await fetch('https://ustmetegzisztqqcjigt.supabase.co/rest/v1/rpc/mark_post_posted', {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_post_id: postId,
      p_worker_id: 'manual-test',  // Must match locked_by
      p_platform_post_id: 'stub_node_123',
      p_platform_url: 'https://node-test.com'
    })
  });
  
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text);
  
  // Check post status
  console.log('\nChecking post status...');
  const postRes = await fetch(`https://ustmetegzisztqqcjigt.supabase.co/rest/v1/posts?id=eq.${postId}&select=status,platform_post_id,platform_url`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });
  const posts = await postRes.json();
  console.log('Post:', JSON.stringify(posts, null, 2));
}

test();
