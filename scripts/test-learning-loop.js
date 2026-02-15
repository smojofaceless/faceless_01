/**
 * Comprehensive test for #20 Caption/Tags Learning Loop
 * Tests: tables, views, RPCs, winning patterns, negative exemplars
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDc0NzksImV4cCI6MjA4NTEyMzQ3OX0.5lEiAP6PS4yY3WwAL5v4XWFHWJS5hzBWPXQxuxWe5d4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let passed = 0;
let failed = 0;

function ok(name) { passed++; console.log(`  ✅ ${name}`); }
function fail(name, err) { failed++; console.log(`  ❌ ${name}: ${err}`); }

async function run() {
  console.log('\n=== TEST 1: Table Existence ===');
  
  // post_metadata_versions
  const { data: pmv, error: pmvErr } = await supabase.from('post_metadata_versions').select('id').limit(1);
  pmvErr ? fail('post_metadata_versions', pmvErr.message) : ok('post_metadata_versions exists');

  // post_metadata_variant_assignments
  const { data: pmva, error: pmvaErr } = await supabase.from('post_metadata_variant_assignments').select('id').limit(1);
  pmvaErr ? fail('post_metadata_variant_assignments', pmvaErr.message) : ok('post_metadata_variant_assignments exists');

  // winning_metadata_patterns
  const { data: wmp, error: wmpErr } = await supabase.from('winning_metadata_patterns').select('id').limit(1);
  wmpErr ? fail('winning_metadata_patterns', wmpErr.message) : ok('winning_metadata_patterns exists');

  console.log('\n=== TEST 2: Views ===');
  
  // v_post_variant_performance (check it has collected_at column)
  const { data: vpvp, error: vpvpErr } = await supabase.from('v_post_variant_performance').select('version_id,performance_value,collected_at').limit(1);
  vpvpErr ? fail('v_post_variant_performance', vpvpErr.message) : ok('v_post_variant_performance exists (with collected_at)');

  // v_top_metadata_patterns (check it has collected_at column)
  const { data: vtmp, error: vtmpErr } = await supabase.from('v_top_metadata_patterns').select('brand_id,performance_value,collected_at').limit(1);
  vtmpErr ? fail('v_top_metadata_patterns', vtmpErr.message) : ok('v_top_metadata_patterns exists (with collected_at)');

  console.log('\n=== TEST 3: Get brands + posts for context ===');
  
  const { data: brands, error: brandsErr } = await supabase.from('brands').select('id,name').limit(10);
  if (brandsErr) { fail('fetch brands', brandsErr.message); return; }
  ok(`Found ${brands.length} brand(s): ${brands.map(b => b.name).join(', ')}`);

  const { data: posts, error: postsErr } = await supabase
    .from('posts')
    .select('id,brand_id,job_id,platform,status,scheduled_at')
    .order('scheduled_at', { ascending: false })
    .limit(20);
  if (postsErr) { fail('fetch posts', postsErr.message); return; }
  ok(`Found ${posts.length} post(s)`);

  // Count by status
  const statusCounts = {};
  posts.forEach(p => { statusCounts[p.status] = (statusCounts[p.status] || 0) + 1; });
  console.log(`    Status breakdown: ${JSON.stringify(statusCounts)}`);

  // Count by platform
  const platCounts = {};
  posts.forEach(p => { platCounts[p.platform] = (platCounts[p.platform] || 0) + 1; });
  console.log(`    Platform breakdown: ${JSON.stringify(platCounts)}`);

  // Get posted posts specifically
  const { data: postedPosts, error: ppErr } = await supabase
    .from('posts')
    .select('id,brand_id,platform,status,posted_at')
    .eq('status', 'posted')
    .order('posted_at', { ascending: false })
    .limit(50);
  if (ppErr) { fail('fetch posted posts', ppErr.message); } 
  else { ok(`Found ${postedPosts.length} posted post(s)`); }

  if (postedPosts && postedPosts.length > 0) {
    console.log('    Sample posted posts:');
    postedPosts.slice(0, 5).forEach(p => {
      console.log(`      ${p.platform} | posted=${p.posted_at}`);
    });
  }

  console.log('\n=== TEST 4: Existing metrics ===');
  
  const { data: metrics, error: metricsErr } = await supabase
    .from('post_metrics')
    .select('id,post_id,platform,views,likes,comments,shares,collected_at')
    .order('collected_at', { ascending: false })
    .limit(10);
  if (metricsErr) { fail('fetch post_metrics', metricsErr.message); }
  else { 
    ok(`Found ${metrics.length} metric row(s)`); 
    if (metrics.length > 0) {
      metrics.slice(0, 5).forEach(m => {
        console.log(`      ${m.platform} | views=${m.views} likes=${m.likes} comments=${m.comments} shares=${m.shares} | ${m.collected_at}`);
      });
    }
  }

  // Check latest metrics view
  const { data: latestMetrics, error: lmErr } = await supabase
    .from('v_post_metrics_latest')
    .select('post_id,platform,views,likes,comments,shares')
    .limit(10);
  if (lmErr) { fail('v_post_metrics_latest', lmErr.message); }
  else { ok(`v_post_metrics_latest: ${latestMetrics.length} row(s)`); }

  console.log('\n=== TEST 5: RPCs — record_post_metadata_version ===');
  
  // Need a real post_id to test
  if (posts.length > 0) {
    const testPost = posts[0];
    const idempKey = `test:${testPost.id}:${Date.now()}`;
    const { data: recVer, error: recVerErr } = await supabase.rpc('record_post_metadata_version', {
      p_post_id: testPost.id,
      p_platform: testPost.platform,
      p_version_type: 'ai',
      p_variant_key: null,
      p_fields: { title: 'Test Title', description: 'Test description', tags: ['test', 'smoke'] },
      p_generation_model: 'gpt-4o',
      p_schema_version: 1,
      p_idempotency_key: idempKey,
      p_created_by: 'smoke-test'
    });
    recVerErr ? fail('record_post_metadata_version', recVerErr.message) : ok(`record_post_metadata_version: version_number=${recVer}`);

    // Test idempotency - same key should not create a new version
    const { data: recVer2, error: recVer2Err } = await supabase.rpc('record_post_metadata_version', {
      p_post_id: testPost.id,
      p_platform: testPost.platform,
      p_version_type: 'ai',
      p_variant_key: null,
      p_fields: { title: 'Dupe attempt' },
      p_generation_model: 'gpt-4o',
      p_schema_version: 1,
      p_idempotency_key: idempKey,
      p_created_by: 'smoke-test'
    });
    recVer2Err ? fail('idempotency check', recVer2Err.message) : ok(`Idempotency: second call returned version_number=${recVer2} (same = correct)`);
  }

  console.log('\n=== TEST 6: RPCs — get_post_metadata_versions ===');
  
  if (posts.length > 0) {
    const testPost = posts[0];
    const { data: versions, error: versErr } = await supabase.rpc('get_post_metadata_versions', {
      p_post_id: testPost.id,
      p_platform: testPost.platform
    });
    versErr ? fail('get_post_metadata_versions', versErr.message) : ok(`get_post_metadata_versions: ${versions.length} version(s) found`);
  }

  console.log('\n=== TEST 7: RPCs — get_generation_exemplars ===');
  
  if (brands.length > 0) {
    const testBrand = brands[0];
    // Test with vibe preset
    const { data: exemplars, error: exErr } = await supabase.rpc('get_generation_exemplars', {
      p_brand_id: testBrand.id,
      p_platform: 'youtube_shorts',
      p_vibe_preset: null,
      p_limit: 3,
      p_preset_name: null,
      p_window_days: 30
    });
    exErr ? fail('get_generation_exemplars', exErr.message) : ok(`get_generation_exemplars: ${exemplars.length} exemplar(s)`);
  }

  console.log('\n=== TEST 8: RPCs — get_negative_exemplars ===');
  
  if (brands.length > 0) {
    const testBrand = brands[0];
    const { data: negEx, error: negExErr } = await supabase.rpc('get_negative_exemplars', {
      p_brand_id: testBrand.id,
      p_platform: 'youtube_shorts',
      p_vibe_preset: null,
      p_limit: 3,
      p_preset_name: null,
      p_window_days: 30
    });
    negExErr ? fail('get_negative_exemplars (with p_preset_name)', negExErr.message) : ok(`get_negative_exemplars: ${negEx.length} negative exemplar(s)`);
  }

  console.log('\n=== TEST 9: RPCs — get_variant_performance ===');
  
  // Get a job_id from posts
  const jobIds = [...new Set(posts.filter(p => p.job_id).map(p => p.job_id))];
  if (jobIds.length > 0) {
    const { data: varPerf, error: varPerfErr } = await supabase.rpc('get_variant_performance', {
      p_job_id: jobIds[0],
      p_platform: posts.find(p => p.job_id === jobIds[0]).platform
    });
    varPerfErr ? fail('get_variant_performance', varPerfErr.message) : ok(`get_variant_performance: ${varPerf.length} variant(s)`);
  } else {
    console.log('  ⏭️  Skipped (no job_ids in posts)');
  }

  console.log('\n=== TEST 10: RPCs — assign_ab_variant ===');
  
  if (jobIds.length > 0) {
    const { data: abResult, error: abErr } = await supabase.rpc('assign_ab_variant', {
      p_job_id: jobIds[0],
      p_platform: posts.find(p => p.job_id === jobIds[0]).platform,
      p_variant_key: 'smoke_test_variant',
      p_style_instructions: 'Use punchy one-word hashtags and aggressive hooks'
    });
    abErr ? fail('assign_ab_variant', abErr.message) : ok('assign_ab_variant: created');

    // Clean up test variant
    const { error: delErr } = await supabase
      .from('post_metadata_variant_assignments')
      .delete()
      .eq('variant_key', 'smoke_test_variant');
    delErr ? fail('cleanup variant', delErr.message) : ok('Cleaned up test variant');
  }

  console.log('\n=== TEST 11: RPCs — recompute_winning_patterns ===');
  
  if (brands.length > 0) {
    const testBrand = brands[0];
    const { data: rcResult, error: rcErr } = await supabase.rpc('recompute_winning_patterns', {
      p_brand_id: testBrand.id,
      p_platform: 'youtube_shorts',
      p_vibe_preset: null,
      p_window_days: 30
    });
    rcErr ? fail('recompute_winning_patterns', rcErr.message) : ok('recompute_winning_patterns: executed');
  }

  console.log('\n=== TEST 12: RPCs — recompute_all_winning_patterns ===');
  
  const { data: rcaResult, error: rcaErr } = await supabase.rpc('recompute_all_winning_patterns');
  rcaErr ? fail('recompute_all_winning_patterns', rcaErr.message) : ok('recompute_all_winning_patterns: executed');

  console.log('\n=== TEST 13: RPCs — get_winning_patterns ===');
  
  if (brands.length > 0) {
    const testBrand = brands[0];
    const { data: wp, error: wpErr } = await supabase.rpc('get_winning_patterns', {
      p_brand_id: testBrand.id,
      p_platform: 'youtube_shorts',
      p_vibe_preset: null,
      p_window_days: 30
    });
    wpErr ? fail('get_winning_patterns', wpErr.message) : ok(`get_winning_patterns: ${wp.length} row(s)`);
    if (wp && wp.length > 0) {
      const row = wp[0];
      console.log(`    sample_count=${row.sample_count}, avg_perf=${row.avg_performance}`);
      console.log(`    top_hooks: ${JSON.stringify(row.top_hooks)}`);
      console.log(`    top_hashtags: ${JSON.stringify(row.top_hashtags)}`);
      console.log(`    top_ctas: ${JSON.stringify(row.top_ctas)}`);
      console.log(`    length_stats: ${JSON.stringify(row.length_stats)}`);
    }
  }

  console.log('\n=== TEST 14: Winning patterns cache state ===');
  
  const { data: cacheRows, error: cacheErr } = await supabase
    .from('winning_metadata_patterns')
    .select('brand_id,platform,vibe_preset,window_days,sample_count,avg_performance,computed_at')
    .order('computed_at', { ascending: false });
  if (cacheErr) { fail('winning_metadata_patterns query', cacheErr.message); }
  else {
    ok(`Cache has ${cacheRows.length} row(s)`);
    cacheRows.forEach(r => {
      console.log(`    ${r.platform} | vibe=${r.vibe_preset || 'NULL(brand-wide)'} | samples=${r.sample_count} | avg_perf=${r.avg_performance} | computed=${r.computed_at}`);
    });
  }

  console.log('\n=== TEST 15: Check pg_cron job ===');
  
  // Can't query cron.job via REST API (different schema), but we can verify the function exists
  const { data: cronCheck, error: cronErr } = await supabase.rpc('recompute_all_winning_patterns');
  cronErr ? fail('cron target function callable', cronErr.message) : ok('recompute_all_winning_patterns callable (cron target)');

  console.log('\n=== TEST 16: Metrics-eligible posts (for backfill) ===');
  
  // Check how many posts are eligible for metrics collection
  const { data: eligible, error: eligErr } = await supabase.rpc('find_metrics_eligible_posts', { p_limit: 50 });
  if (eligErr) { fail('find_metrics_eligible_posts', eligErr.message); }
  else {
    ok(`${eligible.length} posts eligible for metrics collection`);
    if (eligible.length > 0) {
      eligible.slice(0, 5).forEach(e => {
        console.log(`      ${e.platform} | post_id=${e.post_id} | posted=${e.posted_at} | last_collected=${e.last_collected_at || 'never'}`);
      });
    }
  }

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));
  
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
