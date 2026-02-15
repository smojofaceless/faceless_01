/**
 * Test winning patterns after backfill
 */
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
  'https://ustmetegzisztqqcjigt.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDc0NzksImV4cCI6MjA4NTEyMzQ3OX0.5lEiAP6PS4yY3WwAL5v4XWFHWJS5hzBWPXQxuxWe5d4'
);

async function test() {
  console.log('=== Recompute All Winning Patterns ===');
  const { data: rc, error: rcErr } = await sb.rpc('recompute_all_winning_patterns');
  if (rcErr) { console.log('ERROR: ' + rcErr.message); return; }
  console.log('Groups processed: ' + JSON.stringify(rc));

  console.log('\n=== Winning Patterns Cache ===');
  const { data: cache } = await sb.from('winning_metadata_patterns')
    .select('*')
    .order('avg_performance', { ascending: false });
  console.log('Total cache rows: ' + cache.length);
  cache.forEach(r => {
    console.log('\n--- ' + r.platform + ' | vibe=' + (r.vibe_preset || 'brand-wide') +
      ' | samples=' + r.sample_count + ' | avg_perf=' + r.avg_performance);
    if (r.sample_count > 0) {
      if (r.top_hooks && r.top_hooks.length > 0) {
        console.log('  Hooks:');
        r.top_hooks.forEach(h => console.log('    "' + h.hook + '" (perf=' + h.perf + ')'));
      }
      if (r.top_hashtags && r.top_hashtags.length > 0) {
        console.log('  Hashtags:');
        r.top_hashtags.forEach(t => console.log('    #' + t.tag + ' (' + t.count + ' uses, avg_perf=' + t.avg_perf + ')'));
      }
      if (r.top_ctas && r.top_ctas.length > 0) {
        console.log('  CTAs:');
        r.top_ctas.forEach(c => console.log('    "' + c.cta + '" (' + c.count + ')'));
      }
      if (r.length_stats) {
        console.log('  Lengths: title~' + r.length_stats.avg_title_len + 'c, desc~' +
          r.length_stats.avg_desc_len + 'c, tags~' + r.length_stats.avg_tag_count);
      }
    }
  });

  console.log('\n=== get_winning_patterns (generator view) ===');
  const { data: brands } = await sb.from('brands').select('id,name');
  for (const brand of brands) {
    for (const plat of ['youtube_shorts', 'instagram_reels', 'tiktok', 'facebook_reels']) {
      const { data: wp } = await sb.rpc('get_winning_patterns', {
        p_brand_id: brand.id, p_platform: plat, p_vibe_preset: null, p_window_days: 30
      });
      if (wp && wp.length > 0) {
        console.log('  ' + brand.name + '/' + plat + ': samples=' + wp[0].sample_count +
          ' avg_perf=' + wp[0].avg_performance);
      }
    }
  }

  // Final full test suite
  console.log('\n=== Final System Test ===');
  const { data: ex } = await sb.rpc('get_generation_exemplars', {
    p_brand_id: brands[0].id, p_platform: 'youtube_shorts', p_vibe_preset: null,
    p_limit: 3, p_preset_name: null, p_window_days: 30
  });
  console.log('  Exemplars (YT Shorts): ' + (ex ? ex.length : 0));
  if (ex && ex.length > 0) {
    ex.forEach(e => {
      const title = e.fields?.title || e.fields?.caption || '';
      console.log('    perf=' + e.performance_value + ' | "' + title.substring(0, 60) + '"');
    });
  }

  const { data: neg } = await sb.rpc('get_negative_exemplars', {
    p_brand_id: brands[0].id, p_platform: 'youtube_shorts', p_vibe_preset: null,
    p_limit: 2, p_preset_name: null, p_window_days: 30
  });
  console.log('  Negative Exemplars (YT Shorts): ' + (neg ? neg.length : 0));
  if (neg && neg.length > 0) {
    neg.forEach(e => console.log('    perf=' + e.performance_value));
  }

  console.log('\n=== ALL TESTS COMPLETE ===');
}

test().catch(err => { console.error('Fatal:', err); process.exit(1); });
