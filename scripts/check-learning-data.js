const base = 'https://ustmetegzisztqqcjigt.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTU0NzQ3OSwiZXhwIjoyMDg1MTIzNDc5fQ.01lwYvZ-DG8zLMgJfCW4zHVXyegAOaXGf2XPsHpIOn8';
const hd = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
const bid = '68a58afb-8c85-4d6d-9eec-144ab7e5f106';

async function run() {
    const [wp, ex, neg, wpTbl] = await Promise.all([
        fetch(base + '/rest/v1/rpc/get_winning_patterns', { method: 'POST', headers: hd, body: JSON.stringify({ p_brand_id: bid, p_platform: 'youtube_shorts', p_vibe_preset: null }) }).then(r => r.json()),
        fetch(base + '/rest/v1/rpc/get_generation_exemplars', { method: 'POST', headers: hd, body: JSON.stringify({ p_brand_id: bid, p_platform: 'youtube_shorts', p_limit: 10, p_window_days: 90 }) }).then(r => r.json()),
        fetch(base + '/rest/v1/rpc/get_negative_exemplars', { method: 'POST', headers: hd, body: JSON.stringify({ p_brand_id: bid, p_platform: 'youtube_shorts', p_limit: 10, p_window_days: 90 }) }).then(r => r.json()),
        fetch(base + '/rest/v1/winning_metadata_patterns?select=brand_id,platform,vibe_preset,updated_at,top_hooks,top_hashtags,top_ctas,length_stats', { headers: hd }).then(r => r.json()),
    ]);
    
    console.log('\n=== Winning Patterns RPC (youtube_shorts) ===');
    if (Array.isArray(wp)) {
        console.log('Rows:', wp.length);
        wp.forEach(r => {
            console.log('  hooks:', (r.top_hooks || []).length, 'tags:', (r.top_hashtags || []).length, 'ctas:', (r.top_ctas || []).length);
            if (r.length_stats) console.log('  length_stats:', JSON.stringify(r.length_stats));
        });
    } else {
        console.log('Result:', JSON.stringify(wp).slice(0, 500));
    }

    console.log('\n=== Exemplars (youtube_shorts) ===');
    console.log('Count:', ex?.length || 0);
    if (ex?.length) {
        ex.slice(0, 3).forEach(e => {
            console.log('  perf:', e.performance_value, 'title:', (e.fields?.title || e.metadata_snapshot?.title || '—').slice(0, 60));
        });
    }

    console.log('\n=== Negative Exemplars ===');
    console.log('Count:', neg?.length || 0);
    if (neg?.length) {
        neg.slice(0, 3).forEach(e => {
            console.log('  perf:', e.performance_value, 'title:', (e.fields?.title || '—').slice(0, 60));
        });
    }

    console.log('\n=== Winning Patterns Table (all rows) ===');
    console.log('Rows:', wpTbl?.length || 0);
    (wpTbl || []).forEach(r => {
        console.log('  brand=' + (r.brand_id || 'NULL').toString().slice(0, 8), 'plat=' + (r.platform || 'NULL'), 'vibe=' + (r.vibe_preset || 'NULL'),
            'hooks=' + (r.top_hooks || []).length, 'tags=' + (r.top_hashtags || []).length, 'ctas=' + (r.top_ctas || []).length,
            'updated=' + r.updated_at);
        if (r.length_stats) console.log('    length_stats:', JSON.stringify(r.length_stats));
    });
}
const fs = require('fs');
const lines = [];
const origLog = console.log.bind(console);
console.log = (...a) => { lines.push(a.join(' ')); origLog(...a); };
run().then(() => {
    fs.writeFileSync('d:\\SMOJO\\Online\\Buisness\\faceless_01\\check-learning-output.txt', lines.join('\n'));
}).catch(e => {
    lines.push('ERROR: ' + e.message);
    fs.writeFileSync('d:\\SMOJO\\Online\\Buisness\\faceless_01\\check-learning-output.txt', lines.join('\n'));
});
