// =============================================================================
// retry-failed-metadata.js — Re-trigger AI metadata generation for failed posts
// =============================================================================
// Usage:
//   node scripts/retry-failed-metadata.js                      # dry-run (shows what would retry)
//   node scripts/retry-failed-metadata.js --execute             # actually triggers regeneration
//   node scripts/retry-failed-metadata.js --execute --limit=5   # retry only 5 posts
//   node scripts/retry-failed-metadata.js --execute --post-id=UUID  # retry specific post
// =============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ustmetegzisztqqcjigt.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const GENERATE_FN_URL = `${SUPABASE_URL}/functions/v1/generate-post-metadata`;

if (!SUPABASE_KEY) {
  console.error('ERROR: Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY env var');
  process.exit(1);
}

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 100;
const postIdArg = args.find(a => a.startsWith('--post-id='));
const specificPostId = postIdArg ? postIdArg.split('=')[1] : null;

async function fetchFailedMetadata() {
  let url = `${SUPABASE_URL}/rest/v1/post_metadata?status=eq.failed&select=id,post_id,platform,error,attempt_count,failure_class,created_at&order=created_at.desc&limit=${limit}`;
  if (specificPostId) {
    url = `${SUPABASE_URL}/rest/v1/post_metadata?status=eq.failed&post_id=eq.${specificPostId}&select=id,post_id,platform,error,attempt_count,failure_class,created_at&order=created_at.desc`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch metadata: ${res.status} ${text}`);
  }
  return res.json();
}

async function triggerRegeneration(postId, platform) {
  const res = await fetch(GENERATE_FN_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      post_id: postId,
      platform: platform,
      force: true,
      source: 'retry-script',
    }),
  });

  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function main() {
  console.log('=== Retry Failed Metadata ===');
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Limit: ${limit}`);
  if (specificPostId) console.log(`Post ID: ${specificPostId}`);
  console.log('');

  const failed = await fetchFailedMetadata();
  console.log(`Found ${failed.length} failed metadata records\n`);

  if (failed.length === 0) {
    console.log('Nothing to retry!');
    return;
  }

  // Group by error type
  const byError = {};
  for (const f of failed) {
    const errType = f.error?.includes('insufficient_quota') ? 'OpenAI Quota'
      : f.error?.includes('429') ? 'Rate Limit'
      : f.error?.includes('Unsupported platform') ? 'Unsupported Platform'
      : f.error?.includes('500') ? 'Server Error'
      : 'Other';
    byError[errType] = (byError[errType] || 0) + 1;
  }
  console.log('Failure breakdown:');
  for (const [type, count] of Object.entries(byError)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log('');

  // List each failed record
  for (const f of failed) {
    const errSnippet = (f.error || 'Unknown').split('\n')[0].slice(0, 80);
    console.log(`  ${f.post_id} | ${f.platform} | attempts=${f.attempt_count} | ${f.failure_class} | ${errSnippet}`);
  }
  console.log('');

  if (!execute) {
    console.log('DRY RUN — pass --execute to actually trigger regeneration');
    return;
  }

  // Execute retries
  let success = 0, fail = 0;
  for (const f of failed) {
    process.stdout.write(`Retrying ${f.post_id}/${f.platform}... `);
    try {
      const result = await triggerRegeneration(f.post_id, f.platform);
      if (result.ok) {
        console.log(`✓ ${JSON.stringify(result.data?.results?.[0]?.status || 'ok')}`);
        success++;
      } else {
        console.log(`✗ HTTP ${result.status}: ${JSON.stringify(result.data)}`);
        fail++;
      }
    } catch (err) {
      console.log(`✗ ${err.message}`);
      fail++;
    }
    // Small delay to avoid hammering the API
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nDone: ${success} succeeded, ${fail} failed`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
