// Fix and apply the mark_post_posted RPC
// The original migration references 'meta' column but posts has 'ai_metadata'

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.log('Set SUPABASE_SERVICE_ROLE_KEY first');
  process.exit(1);
}

const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';

// Fixed mark_post_posted that uses ai_metadata instead of meta
const fixedFunction = `
CREATE OR REPLACE FUNCTION mark_post_posted(
  p_post_id UUID,
  p_worker_id TEXT,
  p_platform_post_id TEXT,
  p_platform_url TEXT,
  p_meta JSONB DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status TEXT;
  v_current_locker TEXT;
BEGIN
  -- Get current state
  SELECT status, locked_by INTO v_current_status, v_current_locker
  FROM posts WHERE id = p_post_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Post not found'::TEXT;
    RETURN;
  END IF;
  
  -- Already posted is success (idempotent)
  IF v_current_status = 'posted' THEN
    RETURN QUERY SELECT TRUE, 'Already posted'::TEXT;
    RETURN;
  END IF;
  
  -- Validate ownership (if we have a lease)
  IF v_current_locker IS NOT NULL AND v_current_locker != p_worker_id THEN
    RETURN QUERY SELECT FALSE, format('Post locked by different worker: %s', v_current_locker)::TEXT;
    RETURN;
  END IF;
  
  -- Update to posted (use ai_metadata instead of meta)
  UPDATE posts
  SET 
    status = 'posted',
    platform_post_id = p_platform_post_id,
    platform_url = p_platform_url,
    posted_at = NOW(),
    locked_by = NULL,
    locked_at = NULL,
    lease_expires_at = NULL,
    error = NULL,
    ai_metadata = COALESCE(ai_metadata, '{}'::jsonb) || COALESCE(p_meta, '{}'::jsonb),
    updated_at = NOW()
  WHERE id = p_post_id;
  
  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_post_posted(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;
`;

async function applyFix() {
  console.log('Applying fixed mark_post_posted function...');
  
  // We can't run raw SQL via REST, but we can try via the supabase management API
  // For now, just output the SQL to run manually
  console.log('\n⚠️ Cannot apply SQL directly via REST API.');
  console.log('\nPlease run this SQL in Supabase Dashboard > SQL Editor:\n');
  console.log('━'.repeat(60));
  console.log(fixedFunction);
  console.log('━'.repeat(60));
  
  // Test the current RPC
  console.log('\nTesting current mark_post_posted...');
  const postId = '460decd9-5de9-403a-8b2b-572d9f9d41a0';
  
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_post_posted`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_post_id: postId,
      p_worker_id: 'manual-test',
      p_platform_post_id: 'stub_123',
      p_platform_url: 'https://stub.com'
    })
  });
  
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text);
}

applyFix();
