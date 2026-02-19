#!/usr/bin/env node
// =====================================================
// SMOKE TEST: Kill Switch, Presets, Quality Gates
// Tests:
//   1. Kill Switch — toggle on/off via RPC, verify state
//   2. Presets — verify 4 active presets in DB
//   3. Quality Gates — unit-test gate logic locally
// =====================================================

const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDc0NzksImV4cCI6MjA4NTEyMzQ3OX0.5lEiAP6PS4yY3WwAL5v4XWFHWJS5hzBWPXQxuxWe5d4';

let passed = 0;
let failed = 0;
const results = [];

function assert(name, condition, detail = '') {
  if (condition) {
    passed++;
    results.push({ name, status: 'PASS', detail });
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    results.push({ name, status: 'FAIL', detail });
    console.log(`  ❌ ${name} ${detail ? '— ' + detail : ''}`);
  }
}

async function rpc(fnName, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, ok: res.ok };
}

async function query(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// =====================================================
// TEST GROUP 1: Kill Switch
// =====================================================
async function testKillSwitch() {
  console.log('\n🛑 TEST GROUP 1: Kill Switch');

  // 1a. Check current state (should be off)
  const { data: isActive } = await rpc('is_kill_switch_active');
  assert('Kill switch RPC exists and responds', isActive !== undefined, `Got: ${isActive}`);

  // 1b. Read system_config
  const config = await query("system_config?key=eq.kill_switch&select=value");
  assert('system_config has kill_switch row', config.length === 1);

  // 1c. Enable kill switch
  const enableResult = await rpc('set_kill_switch', {
    p_enabled: true,
    p_reason: 'Smoke test — testing kill switch toggle',
    p_updated_by: 'smoke_test'
  });
  assert('set_kill_switch(true) succeeds', enableResult.ok, `Status: ${enableResult.status}`);

  if (enableResult.ok && enableResult.data) {
    assert('Kill switch is now enabled', enableResult.data.enabled === true);
    assert('Reason is preserved', enableResult.data.reason === 'Smoke test — testing kill switch toggle');
    assert('enabled_at is set', !!enableResult.data.enabled_at);
  }

  // 1d. Verify is_kill_switch_active returns true
  const { data: shouldBeActive } = await rpc('is_kill_switch_active');
  assert('is_kill_switch_active returns true when enabled', shouldBeActive === true);

  // 1e. Edge functions should return 503 when kill switch is on
  const mcRes = await fetch(`${SUPABASE_URL}/functions/v1/metrics-collector`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert('metrics-collector returns 503 when kill switch active', mcRes.status === 503, `Got: ${mcRes.status}`);

  // 1f. Disable kill switch
  const disableResult = await rpc('set_kill_switch', {
    p_enabled: false,
    p_reason: null,
    p_updated_by: 'smoke_test'
  });
  assert('set_kill_switch(false) succeeds', disableResult.ok);

  if (disableResult.ok && disableResult.data) {
    assert('Kill switch is now disabled', disableResult.data.enabled === false);
    assert('disabled_at is set', !!disableResult.data.disabled_at);
  }

  // 1g. Verify is_kill_switch_active returns false
  const { data: shouldBeInactive } = await rpc('is_kill_switch_active');
  assert('is_kill_switch_active returns false when disabled', shouldBeInactive === false);
}

// =====================================================
// TEST GROUP 2: Presets (4 Active)
// =====================================================
async function testPresets() {
  console.log('\n🎭 TEST GROUP 2: Active Presets');

  const templates = await query('brand_templates?select=template_type,name,is_default,weight');

  assert('Exactly 4 presets in brand_templates', templates.length === 4, `Found ${templates.length}`);

  const presetNames = templates.map(t => t.template_type).sort();
  const expected = ['dark_origins', 'one_too_many', 'reddit_trending_horror', 'urban_legend'];

  assert('Preset list matches expected 4', JSON.stringify(presetNames) === JSON.stringify(expected),
    `Got: ${presetNames.join(', ')}`);

  // Check each preset exists
  for (const name of expected) {
    assert(`Preset "${name}" exists`, presetNames.includes(name));
  }

  // Check one is default
  const defaults = templates.filter(t => t.is_default);
  assert('Exactly one default preset', defaults.length === 1, `Found ${defaults.length} defaults`);
  if (defaults.length === 1) {
    assert('Default preset is urban_legend', defaults[0].template_type === 'urban_legend');
  }

  // Verify no deprecated presets exist
  const deprecated = ['faux_true_crime', 'historical_case_file', 'psychological_descent',
    'analog_broadcast', 'innocence_horror', 'cosmic_horror', 'analog_horror'];
  for (const d of deprecated) {
    assert(`No deprecated preset "${d}"`, !presetNames.includes(d));
  }
}

// =====================================================
// TEST GROUP 3: Quality Gates (Unit Tests)
// =====================================================
function testQualityGates() {
  console.log('\n🏗️ TEST GROUP 3: Quality Gates (Unit Tests)');

  // ─── Inline quality gate functions (mirror of steps.ts) ───

  function gateOneToMany(text) {
    const failures = [];
    const countingPatterns = /\b(count|counted|counting|number|numbered|extra|additional|one more|one too many|wasn't supposed|shouldn't have been|too many|more than|appeared|N\+1)\b/i;
    if (!countingPatterns.test(text)) failures.push('Missing counting/anomaly language');
    const numberMention = /\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i;
    if (!numberMention.test(text)) failures.push('No specific number');
    const softReveal = /\b(photo|picture|selfie|head count|recount|counted again|looked again|but .*(photo|count|show)|realized|noticed|something was wrong|didn't add up|one extra|wasn't right)\b/i;
    if (!softReveal.test(text)) failures.push('Missing reveal moment');
    return { passed: failures.length === 0, failures };
  }

  function gateRedditHorror(text) {
    const failures = [];
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    const firstPersonCount = (text.match(/\bI\b/g) || []).length;
    if (firstPersonCount < 3) failures.push('Weak first-person');
    const firstThird = sentences.slice(0, Math.ceil(sentences.length / 3)).join(' ');
    const mundane = /\b(coffee|grocery|phone|apartment|work|shift|car|bus|walk|morning|evening|routine|lunch|dinner|commute|alarm|shower|keys|door|parking|fridge)\b/i;
    if (!mundane.test(firstThird)) failures.push('Missing mundane detail');
    const dialogue = /[""].*?[""]|".*?"/;
    if (!dialogue.test(text)) failures.push('No dialogue');
    return { passed: failures.length === 0, failures };
  }

  function gateDarkOrigins(text) {
    const failures = [];
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    const textNoQuotes = text.replace(/[""].*?[""]|".*?"/g, '');
    const narratorI = (textNoQuotes.match(/\bI\b/g) || []).length;
    if (narratorI > 2) failures.push('First-person detected');
    const dates = /\b(19\d{2}|20[0-2]\d|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
    if (!dates.test(text)) failures.push('Missing dates');
    const location = /\b(county|state|town|city|street|avenue|highway|building|hospital|prison|police|sheriff|detective|officer|FBI|authorities)\b/i;
    if (!location.test(text)) failures.push('Missing location references');
    const lastTwo = sentences.slice(-2).join(' ').toLowerCase();
    const ending = /\b(never (found|explained|solved)|remains (open|unsolved)|still|to this day|nobody knows|case|was never)\b/i;
    if (!ending.test(lastTwo) && !lastTwo.includes('?')) failures.push('Bad ending');
    return { passed: failures.length === 0, failures };
  }

  // ─── one_too_many tests ───

  const otm_good = `Five friends went camping at Bear Lake last summer. They took a group selfie before the hike. When they looked at the photo later, there were six people in it. Nobody could explain who the extra person was. They counted again and again, but the math didn't add up.`;
  const otm_result = gateOneToMany(otm_good);
  assert('one_too_many: Good story passes', otm_result.passed, otm_result.failures.join('; '));

  const otm_bad = `The night was dark and stormy. Something lurked in the shadows. A creature emerged from the fog, its eyes glowing red.`;
  const otm_bad_result = gateOneToMany(otm_bad);
  assert('one_too_many: Generic horror rejected', !otm_bad_result.passed, `Failures: ${otm_bad_result.failures.join('; ')}`);

  // ─── reddit_trending_horror tests ───

  const reddit_good = `I was making coffee when I noticed the notification on my phone. Someone had tried to access my apartment door at 3 AM. I pulled up my Ring camera and saw myself standing at the door. "That's not possible," I whispered to nobody. My roommate walked in and said "Hey, rough morning?" I couldn't tell her what I saw.`;
  const reddit_result = gateRedditHorror(reddit_good);
  assert('reddit_trending_horror: Good story passes', reddit_result.passed, reddit_result.failures.join('; '));

  const reddit_bad = `He walked through the ancient forest. The trees whispered secrets of the old world. Something moved between the shadows of the canopy.`;
  const reddit_bad_result = gateRedditHorror(reddit_bad);
  assert('reddit_trending_horror: Third-person rejected', !reddit_bad_result.passed, `Failures: ${reddit_bad_result.failures.join('; ')}`);

  // ─── dark_origins tests ───

  const do_good = `In 1974, authorities in Milwaukee received a call about a strange smell coming from the building on Oxford Avenue. Detective Harrison arrived at the scene and found something that would haunt the department for decades. The man living there, Gerald Whitmore, had been a respected accountant in town since 1968. "He was quiet, always polite," neighbors recalled. The county sheriff ordered the basement excavated. What they found beneath the concrete changed everything. The case remains unsolved to this day.`;
  const do_result = gateDarkOrigins(do_good);
  assert('dark_origins: Good story passes', do_result.passed, do_result.failures.join('; '));

  const do_bad = `I remember the first time I saw the house. I walked up to the door and I felt something was wrong. I opened the door. I screamed.`;
  const do_bad_result = gateDarkOrigins(do_bad);
  assert('dark_origins: First-person rejected', !do_bad_result.passed, `Failures: ${do_bad_result.failures.join('; ')}`);

  // ─── Edge cases ───

  const otm_edge = `Three roommates rented a cabin for the weekend. On their second day, they found four sets of muddy footprints leading into the house. Nobody had left the cabin. They counted again — the extra tracks were fresh. Something was wrong.`;
  const otm_edge_result = gateOneToMany(otm_edge);
  assert('one_too_many: Edge case with footprints passes', otm_edge_result.passed, otm_edge_result.failures.join('; '));

  // Empty string should fail all gates
  const empty_otm = gateOneToMany('');
  assert('one_too_many: Empty string fails', !empty_otm.passed);
  const empty_reddit = gateRedditHorror('');
  assert('reddit_trending_horror: Empty string fails', !empty_reddit.passed);
  const empty_do = gateDarkOrigins('');
  assert('dark_origins: Empty string fails', !empty_do.passed);
}

// =====================================================
// MAIN
// =====================================================
async function main() {
  console.log('===========================================');
  console.log('  Kill Switch / Presets / Quality Gates');
  console.log('  Smoke Tests');
  console.log('  ' + new Date().toISOString());
  console.log('===========================================');

  try { await testKillSwitch(); } catch (e) { console.error('  ⚠️ Group 1 error:', e.message); }
  try { await testPresets(); } catch (e) { console.error('  ⚠️ Group 2 error:', e.message); }
  try { testQualityGates(); } catch (e) { console.error('  ⚠️ Group 3 error:', e.message); }

  console.log('\n===========================================');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('===========================================');

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  ❌ ${r.name}: ${r.detail}`));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
