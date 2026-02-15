/**
 * Backfill post_metadata_versions from existing post_metadata records.
 * 
 * This creates version 1 (type='ai') entries for all existing post_metadata
 * rows that don't already have a version record, enabling the learning loop
 * to correlate metadata with collected metrics.
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDc0NzksImV4cCI6MjA4NTEyMzQ3OX0.5lEiAP6PS4yY3WwAL5v4XWFHWJS5hzBWPXQxuxWe5d4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function backfill() {
  console.log('=== Backfilling post_metadata_versions ===\n');

  // 1. Get all post_metadata entries
  const { data: allMeta, error: metaErr } = await supabase
    .from('post_metadata')
    .select('id,post_id,platform,ai_metadata,final_metadata,generation_model,schema_version,generated_at,generated_by,status')
    .order('created_at', { ascending: true });

  if (metaErr) {
    console.error('Failed to fetch post_metadata:', metaErr.message);
    process.exit(1);
  }

  console.log(`Found ${allMeta.length} post_metadata rows`);

  // 2. Get existing version records to avoid duplicates
  const { data: existingVersions } = await supabase
    .from('post_metadata_versions')
    .select('post_id,platform');

  const existingSet = new Set(
    (existingVersions || []).map(v => `${v.post_id}:${v.platform}`)
  );
  console.log(`Existing versions: ${existingSet.size}`);

  // 3. Filter to only metadata that needs backfill
  const needsBackfill = allMeta.filter(m => {
    // Only backfill if has actual metadata
    if (!m.final_metadata && !m.ai_metadata) return false;
    if (m.status !== 'ready') return false;
    // Skip if already has a version
    return !existingSet.has(`${m.post_id}:${m.platform}`);
  });

  console.log(`Need to backfill: ${needsBackfill.length}\n`);

  let success = 0;
  let errors = 0;

  for (const meta of needsBackfill) {
    // Build the fields JSONB from final_metadata or ai_metadata
    const fields = meta.final_metadata || meta.ai_metadata;
    const idempKey = `backfill:${meta.post_id}:${meta.platform}:v1`;

    const { data, error } = await supabase.rpc('record_post_metadata_version', {
      p_post_id: meta.post_id,
      p_platform: meta.platform,
      p_version_type: 'ai',
      p_variant_key: null,
      p_fields: fields,
      p_generation_model: meta.generation_model || 'gpt-4o',
      p_schema_version: meta.schema_version || 1,
      p_idempotency_key: idempKey,
      p_created_by: 'backfill'
    });

    if (error) {
      console.log(`  ❌ ${meta.platform} post=${meta.post_id}: ${error.message}`);
      errors++;
    } else {
      console.log(`  ✅ ${meta.platform} post=${meta.post_id.substring(0, 8)}...`);
      success++;
    }
  }

  console.log(`\n=== Backfill Complete ===`);
  console.log(`  Success: ${success}`);
  console.log(`  Errors: ${errors}`);

  // 4. Verify — check how many versions now have performance data
  console.log('\n=== Verification ===');
  const { data: perfData } = await supabase
    .from('v_post_variant_performance')
    .select('post_id,platform,performance_value,version_type')
    .gt('performance_value', 0);

  console.log(`Versions with performance_value > 0: ${perfData?.length || 0}`);
  if (perfData && perfData.length > 0) {
    // Sort by performance and show top 5
    const sorted = perfData.sort((a, b) => b.performance_value - a.performance_value);
    console.log('\nTop 5 performers:');
    sorted.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.platform} | perf=${p.performance_value}`);
    });
  }

  // 5. Now recompute winning patterns
  console.log('\n=== Recomputing winning patterns ===');
  const { data: rc, error: rcErr } = await supabase.rpc('recompute_all_winning_patterns');
  if (rcErr) {
    console.log('  ERROR: ' + rcErr.message);
  } else {
    console.log('  Groups processed: ' + JSON.stringify(rc));
  }

  // 6. Check the cache
  const { data: cache } = await supabase
    .from('winning_metadata_patterns')
    .select('*')
    .gt('sample_count', 0)
    .order('avg_performance', { ascending: false });

  console.log(`  Cache rows with data: ${cache?.length || 0}`);
  if (cache) {
    cache.forEach(r => {
      console.log(`\n  ${r.platform} | vibe=${r.vibe_preset || 'brand-wide'} | samples=${r.sample_count} | avg_perf=${r.avg_performance}`);
      if (r.top_hooks?.length > 0) {
        console.log('  Top hooks:');
        r.top_hooks.slice(0, 5).forEach(h => console.log(`    "${h.hook}" (perf=${h.perf})`));
      }
      if (r.top_hashtags?.length > 0) {
        console.log('  Top hashtags:');
        r.top_hashtags.slice(0, 5).forEach(t => console.log(`    #${t.tag} (${t.count} uses, avg_perf=${t.avg_perf})`));
      }
      if (r.top_ctas?.length > 0) {
        console.log('  Top CTAs:');
        r.top_ctas.forEach(c => console.log(`    "${c.cta}" (${c.count})`));
      }
      if (r.length_stats) {
        console.log(`  Length stats: title~${r.length_stats.avg_title_len}c, desc~${r.length_stats.avg_desc_len}c, tags~${r.length_stats.avg_tag_count}`);
      }
    });
  }

  // 7. Check exemplars now
  console.log('\n=== Exemplars (after backfill) ===');
  const { data: brands } = await supabase.from('brands').select('id,name');
  for (const brand of brands) {
    for (const plat of ['youtube_shorts', 'instagram_reels', 'tiktok', 'facebook_reels']) {
      const { data: ex } = await supabase.rpc('get_generation_exemplars', {
        p_brand_id: brand.id, p_platform: plat, p_vibe_preset: null,
        p_limit: 3, p_preset_name: null, p_window_days: 30
      });
      if (ex && ex.length > 0) {
        console.log(`  ${brand.name}/${plat}: ${ex.length} exemplar(s)`);
        ex.forEach(e => {
          const title = e.fields?.title || e.fields?.caption || '';
          console.log(`    perf=${e.performance_value} | "${title.substring(0, 60)}"`);
        });
      }
    }
  }
}

backfill().catch(err => { console.error('Fatal:', err); process.exit(1); });
