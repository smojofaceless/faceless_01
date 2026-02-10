// Test script for Failure Protection + DLQ system
// Run with: node scripts/test-failure-protection.js

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDc0NzksImV4cCI6MjA4NTEyMzQ3OX0.5lEiAP6PS4yY3WwAL5v4XWFHWJS5hzBWPXQxuxWe5d4';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testFailureProtection() {
  console.log('=== Testing Failure Protection + DLQ System ===\n');

  // Test 1: Check kill switch
  console.log('1. Testing is_kill_switch_active()...');
  const { data: killSwitch, error: err1 } = await supabase.rpc('is_kill_switch_active');
  if (err1) {
    console.log('   ❌ Error:', err1.message);
  } else {
    console.log('   ✓ Kill switch active:', killSwitch);
  }

  // Test 2: Check system_config table
  console.log('\n2. Checking system_config table...');
  const { data: config, error: err2 } = await supabase
    .from('system_config')
    .select('*');
  if (err2) {
    console.log('   ❌ Error:', err2.message);
  } else {
    console.log('   ✓ Found', config?.length || 0, 'config entries:');
    config?.forEach(c => console.log(`     - ${c.key}: ${JSON.stringify(c.value)}`));
  }

  // Test 3: Check DLQ view
  console.log('\n3. Checking v_failed_jobs_dlq view...');
  const { data: dlq, error: err3 } = await supabase
    .from('v_failed_jobs_dlq')
    .select('*')
    .limit(5);
  if (err3) {
    console.log('   ❌ Error:', err3.message);
  } else {
    console.log('   ✓ Found', dlq?.length || 0, 'failed jobs in DLQ');
    if (dlq && dlq.length > 0) {
      dlq.forEach(j => console.log(`     - ${j.job_id}: ${j.failure_class} @ ${j.failed_step}`));
    }
  }

  // Test 4: Check failure clusters
  console.log('\n4. Checking get_failure_clusters()...');
  const { data: clusters, error: err4 } = await supabase.rpc('get_failure_clusters', {
    p_window_minutes: 60,
    p_min_count: 1
  });
  if (err4) {
    console.log('   ❌ Error:', err4.message);
  } else {
    console.log('   ✓ Found', clusters?.length || 0, 'failure clusters');
    if (clusters && clusters.length > 0) {
      clusters.forEach(c => console.log(`     - ${c.failure_class}: ${c.job_count} jobs @ ${c.step}`));
    }
  }

  // Test 5: Test set_kill_switch (just toggle to true then back to false)
  console.log('\n5. Testing set_kill_switch()...');
  const { data: setResult, error: err5 } = await supabase.rpc('set_kill_switch', {
    p_enabled: true,
    p_reason: 'Test toggle',
    p_updated_by: 'test-script'
  });
  if (err5) {
    console.log('   ❌ Error:', err5.message);
  } else {
    console.log('   ✓ Kill switch enabled:', setResult);
    
    // Turn it back off
    await supabase.rpc('set_kill_switch', {
      p_enabled: false,
      p_reason: null,
      p_updated_by: 'test-script'
    });
    console.log('   ✓ Kill switch disabled again');
  }

  console.log('\n=== Tests Complete ===');
}

testFailureProtection().catch(console.error);
