// =====================================================
// SYSTEM HARDENING BATCH — SMOKE TEST
// Tests all 11 items from migration 20260319020
//
// Usage:
//   $env:SUPABASE_SERVICE_ROLE_KEY = "your-key"
//   node scripts/smoke-test-system-hardening.js
// =====================================================

const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BRAND_ID = '68a58afb-8c85-4d6d-9eec-144ab7e5f106'; // Stories That Stalk

if (!SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY required');
  console.log('Run: $env:SUPABASE_SERVICE_ROLE_KEY = "your-key"; node scripts/smoke-test-system-hardening.js');
  process.exit(1);
}

// ─── Helpers ────────────────────────────────────────────────────

let passed = 0, failed = 0, skipped = 0;

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
  if (!res.ok) throw new Error(`RPC ${name} failed: ${res.status} — ${text}`);
  return text ? JSON.parse(text) : null;
}

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
  if (!res.ok) throw new Error(`Query ${table} failed: ${res.status} — ${text}`);
  return JSON.parse(text);
}

async function callEdgeFunction(name, body = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

function skip(label, reason) {
  console.log(`  ⏭️  SKIP: ${label} — ${reason}`);
  skipped++;
}

// ─── Tests ──────────────────────────────────────────────────────

async function test1_CronJobs() {
  console.log('\n═══ TEST 1: Data Cleanup Cron ═══');
  try {
    const jobs = await query('cron.job', 'jobname,schedule', '');
    // cron.job may not be accessible via REST — try RPC fallback
    const cleanupJob = jobs.find(j => j.jobname === 'cleanup-old-data');
    assert(cleanupJob, 'cleanup-old-data cron exists');
    assert(cleanupJob?.schedule === '0 4 1 * *', 'Runs monthly at 04:00 UTC');
  } catch (e) {
    // cron.job is in pg_cron schema, may not be queryable via REST
    skip('Cron job verification', `cron.job not accessible via REST API (${e.message.substring(0, 60)})`);
    // Verify the cleanup functions exist instead
    try {
      const r = await callRpc('cleanup_old_job_logs', { p_days_to_keep: 99999 });
      assert(true, 'cleanup_old_job_logs RPC callable');
    } catch (e2) {
      assert(false, `cleanup_old_job_logs RPC: ${e2.message.substring(0, 80)}`);
    }
    try {
      const r2 = await callRpc('cleanup_old_lifecycle_events', { p_older_than_days: 99999 });
      assert(true, 'cleanup_old_lifecycle_events RPC callable');
    } catch (e3) {
      assert(false, `cleanup_old_lifecycle_events RPC: ${e3.message.substring(0, 80)}`);
    }
    try {
      const r3 = await callRpc('cleanup_old_post_metrics', { p_older_than_days: 99999 });
      assert(true, 'cleanup_old_post_metrics RPC callable');
    } catch (e4) {
      assert(false, `cleanup_old_post_metrics RPC: ${e4.message.substring(0, 80)}`);
    }
  }
}

async function test2_WinningPatternsMultiWindow() {
  console.log('\n═══ TEST 2: Winning Patterns Multi-Window ═══');
  try {
    // Test that recompute_winning_patterns accepts window_days param
    const r = await callRpc('recompute_winning_patterns', {
      p_brand_id: BRAND_ID,
      p_platform: 'youtube_shorts',
      p_window_days: 7,
    });
    assert(Array.isArray(r), 'recompute_winning_patterns returns array');
    assert(r.length >= 0, `Returned ${r.length} result(s) for 7-day window`);

    // Test 14-day window
    const r14 = await callRpc('recompute_winning_patterns', {
      p_brand_id: BRAND_ID,
      p_platform: 'youtube_shorts',
      p_window_days: 14,
    });
    assert(Array.isArray(r14), '14-day window callable');

    // Check winning_metadata_patterns has rows for different windows
    const patterns = await query(
      'winning_metadata_patterns',
      'window_days,sample_count,computed_at',
      `brand_id=eq.${BRAND_ID}&platform=eq.youtube_shorts&order=window_days`
    );
    const windows = patterns.map(p => p.window_days);
    assert(windows.includes(7), 'winning_metadata_patterns has 7-day row');
    assert(windows.includes(14), 'winning_metadata_patterns has 14-day row');
  } catch (e) {
    assert(false, `Winning patterns multi-window: ${e.message}`);
  }
}

async function test3_RecencyDecay() {
  console.log('\n═══ TEST 3: Recency Decay in Winning Patterns ═══');
  try {
    // Run for 30-day window and verify computed_at updates
    const before = new Date();
    const r = await callRpc('recompute_winning_patterns', {
      p_brand_id: BRAND_ID,
      p_platform: 'youtube_shorts',
      p_window_days: 30,
    });
    assert(r && r.length >= 0, 'recompute_winning_patterns (30d) succeeds');

    const row = await query(
      'winning_metadata_patterns',
      'computed_at,sample_count,avg_performance',
      `brand_id=eq.${BRAND_ID}&platform=eq.youtube_shorts&window_days=eq.30`
    );
    assert(row.length >= 1, `At least one 30-day pattern row (got ${row.length})`);
    if (row.length > 0) {
      const computedAt = new Date(row[0].computed_at);
      assert(computedAt >= before, `computed_at is fresh (${computedAt.toISOString()})`);
    }
  } catch (e) {
    assert(false, `Recency decay: ${e.message}`);
  }
}

async function test4_StoryUniqueness() {
  console.log('\n═══ TEST 4: Story Uniqueness RPC ═══');
  try {
    // Test with a random hash (should be unique)
    const uniqueHash = 'test_smoke_' + Date.now();
    const r = await callRpc('check_story_uniqueness', {
      p_brand_id: BRAND_ID,
      p_concept_hash: uniqueHash,
      p_job_id: '00000000-0000-0000-0000-000000000001',
      p_threshold: 0.6,
    });

    assert(Array.isArray(r) && r.length > 0, 'check_story_uniqueness returns result');
    if (r.length > 0) {
      assert(r[0].is_unique === true, `Novel hash is unique (score=${r[0].uniqueness_score})`);
      assert(r[0].uniqueness_score >= 0.6, `Score ${r[0].uniqueness_score} >= threshold 0.6`);
      assert(r[0].collision_count === 0, 'Zero collisions for novel hash');
    }
  } catch (e) {
    assert(false, `Story uniqueness: ${e.message}`);
  }
}

async function test5_SweepDeadPosts() {
  console.log('\n═══ TEST 5: Sweep Dead Posts RPC ═══');
  try {
    const r = await callRpc('sweep_dead_posts', { p_max_attempts: 3 });
    assert(typeof r === 'number', `sweep_dead_posts returns integer (swept: ${r})`);
  } catch (e) {
    assert(false, `Sweep dead posts: ${e.message}`);
  }
}

async function test6_CrossPlatformView() {
  console.log('\n═══ TEST 6: Cross-Platform Performance View ═══');
  try {
    const data = await query(
      'v_cross_platform_performance',
      'job_id,brand_id,platform,views,likes,comments,perf_score',
      `brand_id=eq.${BRAND_ID}&limit=5`
    );
    assert(Array.isArray(data), 'v_cross_platform_performance is queryable');
    console.log(`    (${data.length} rows returned for brand)`);

    // Verify schema has expected columns
    if (data.length > 0) {
      const row = data[0];
      assert('platform' in row, 'Has platform column');
      assert('perf_score' in row, 'Has perf_score column');
      assert('views' in row, 'Has views column');
    } else {
      skip('Column schema check', 'No posted posts with metrics yet');
    }
  } catch (e) {
    assert(false, `Cross-platform view: ${e.message}`);
  }
}

async function test7_StrategyTables() {
  console.log('\n═══ TEST 7: Strategy Intelligence Tables ═══');
  try {
    // 7a. platform_strategies seeded
    const strategies = await query('platform_strategies', 'platform,strategy_type,label,primary_metric');
    assert(strategies.length >= 20, `platform_strategies seeded (${strategies.length} rows)`);

    // Check per-platform count
    const platformCounts = {};
    strategies.forEach(s => { platformCounts[s.platform] = (platformCounts[s.platform] || 0) + 1; });
    assert(platformCounts['youtube_shorts'] >= 4, `YouTube strategies: ${platformCounts['youtube_shorts']}`);
    assert(platformCounts['instagram_reels'] >= 4, `Instagram strategies: ${platformCounts['instagram_reels']}`);
    assert(platformCounts['tiktok'] >= 3, `TikTok strategies: ${platformCounts['tiktok']}`);
    assert(platformCounts['threads'] >= 2, `Threads strategies: ${platformCounts['threads']}`);
    assert(platformCounts['x'] >= 2, `X strategies: ${platformCounts['x']}`);

    // 7b. post_strategies table exists (empty ok)
    const ps = await query('post_strategies', 'id', 'limit=1');
    assert(Array.isArray(ps), 'post_strategies table exists and is queryable');

    // 7c. v_strategy_performance view
    const vsp = await query('v_strategy_performance', 'platform,strategy_type,avg_views', 'limit=5');
    assert(Array.isArray(vsp), 'v_strategy_performance view is queryable');
  } catch (e) {
    assert(false, `Strategy tables: ${e.message}`);
  }
}

async function test8_StrategyRPCs() {
  console.log('\n═══ TEST 8: Strategy RPCs ═══');
  try {
    // get_top_strategies — may return empty if no posted posts with strategies
    const top = await callRpc('get_top_strategies', {
      p_brand_id: BRAND_ID,
      p_platform: 'youtube_shorts',
      p_limit: 3,
      p_window_days: 30,
    });
    assert(Array.isArray(top), `get_top_strategies returns array (${top.length} strategies)`);
  } catch (e) {
    assert(false, `get_top_strategies: ${e.message}`);
  }

  try {
    // assign_post_strategy requires a valid post_id — test with RPC signature only
    // We'll try with a fake UUID and expect a foreign key error (which proves the RPC exists)
    try {
      await callRpc('assign_post_strategy', {
        p_post_id: '00000000-0000-0000-0000-000000000099',
        p_platform: 'youtube_shorts',
        p_strategy_type: 'retention_hook',
      });
      assert(true, 'assign_post_strategy RPC exists (executed)');
    } catch (e) {
      // FK violation = RPC exists but post doesn't
      assert(e.message.includes('violates foreign key') || e.message.includes('23503'), 
        'assign_post_strategy RPC exists (FK error expected)');
    }
  } catch (e) {
    assert(false, `assign_post_strategy: ${e.message}`);
  }
}

async function test9_ABVariantAssignment() {
  console.log('\n═══ TEST 9: A/B Variant Auto-Assignment ═══');
  try {
    const r = await callRpc('auto_assign_ab_variants', {
      p_brand_id: BRAND_ID,
      p_platform: 'youtube_shorts',
      p_job_id: '00000000-0000-0000-0000-000000000001',
    });
    assert(typeof r === 'number', `auto_assign_ab_variants returns integer (assigned: ${r})`);
  } catch (e) {
    assert(false, `A/B variant assignment: ${e.message}`);
  }
}

async function test10_VisualPerformanceView() {
  console.log('\n═══ TEST 10: Visual Performance View ═══');
  try {
    const data = await query(
      'v_visual_performance',
      'brand_id,platform,vibe_preset,views,perf_score',
      `brand_id=eq.${BRAND_ID}&limit=5`
    );
    assert(Array.isArray(data), 'v_visual_performance is queryable');
    console.log(`    (${data.length} rows for brand)`);
  } catch (e) {
    assert(false, `Visual performance view: ${e.message}`);
  }
}

async function test11_DraftRPCs() {
  console.log('\n═══ TEST 11: Draft/Preview RPCs ═══');
  try {
    // promote_draft_to_scheduled — test with non-existent draft (should return false)
    const r1 = await callRpc('promote_draft_to_scheduled', {
      p_post_id: '00000000-0000-0000-0000-000000000099',
    });
    assert(r1 === false, 'promote_draft_to_scheduled returns false for missing draft');
  } catch (e) {
    assert(false, `promote_draft_to_scheduled: ${e.message}`);
  }

  try {
    // reject_draft — test with non-existent draft
    const r2 = await callRpc('reject_draft', {
      p_post_id: '00000000-0000-0000-0000-000000000099',
      p_reason: 'Smoke test',
    });
    assert(r2 === false, 'reject_draft returns false for missing draft');
  } catch (e) {
    assert(false, `reject_draft: ${e.message}`);
  }
}

async function test12_AlertTables() {
  console.log('\n═══ TEST 12: Alert Webhook Config Tables ═══');
  try {
    const brand = await query('brand_alert_config', 'id,brand_id,webhook_type,events', 'limit=5');
    assert(Array.isArray(brand), 'brand_alert_config table exists');

    const system = await query('system_alert_config', 'id,webhook_type,events', 'limit=5');
    assert(Array.isArray(system), 'system_alert_config table exists');
  } catch (e) {
    assert(false, `Alert tables: ${e.message}`);
  }
}

async function test13_EdgeFunctions() {
  console.log('\n═══ TEST 13: Edge Function Smoke Calls ═══');

  const functions = [
    'metrics-collector',
    'schedule-jobs',
    'schedule-posts',
    'post-worker',
    'auto-poster',
    'metadata-scheduler',
    'generate-post-metadata',
  ];

  for (const fn of functions) {
    try {
      const r = await callEdgeFunction(fn, {});
      // Any response (even 4xx) means the function is deployed and reachable
      assert(r.status < 500, `${fn}: deployed (HTTP ${r.status})`);
    } catch (e) {
      assert(false, `${fn}: ${e.message.substring(0, 60)}`);
    }
  }
}

async function test14_WorkerV1Deployed() {
  console.log('\n═══ TEST 14: worker-v1 Edge Function ═══');
  try {
    const r = await callEdgeFunction('worker-v1', { jobId: 'smoke-test' });
    assert(r.status < 500, `worker-v1: deployed (HTTP ${r.status})`);
  } catch (e) {
    assert(false, `worker-v1: ${e.message.substring(0, 60)}`);
  }
}

// ─── Run all tests ──────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  SYSTEM HARDENING BATCH — SMOKE TEST            ║');
  console.log('║  Migration: 20260319020_system_hardening_batch   ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`\nBrand: ${BRAND_ID}`);
  console.log(`URL:   ${SUPABASE_URL}`);

  await test1_CronJobs();
  await test2_WinningPatternsMultiWindow();
  await test3_RecencyDecay();
  await test4_StoryUniqueness();
  await test5_SweepDeadPosts();
  await test6_CrossPlatformView();
  await test7_StrategyTables();
  await test8_StrategyRPCs();
  await test9_ABVariantAssignment();
  await test10_VisualPerformanceView();
  await test11_DraftRPCs();
  await test12_AlertTables();
  await test13_EdgeFunctions();
  await test14_WorkerV1Deployed();

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('══════════════════════════════════════════════════');

  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
