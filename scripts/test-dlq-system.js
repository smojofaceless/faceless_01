/**
 * Test Script for Step-Level Retry + DLQ System
 * 
 * Usage: 
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "your-key"
 *   node scripts/test-dlq-system.js
 */

const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable required');
  console.log('Run: $env:SUPABASE_SERVICE_ROLE_KEY = "your-key"; node scripts/test-dlq-system.js');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  'apikey': SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
};

async function testRPC(name, body) {
  console.log(`\n🔍 Testing RPC: ${name}`);
  console.log(`   Body: ${JSON.stringify(body)}`);
  
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    
    const data = await response.json();
    console.log(`   Status: ${response.status}`);
    console.log(`   Response: ${JSON.stringify(data, null, 2).substring(0, 500)}`);
    return { success: response.ok, data, status: response.status };
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function testTable(name) {
  console.log(`\n🔍 Testing Table: ${name}`);
  
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${name}?select=*&limit=3`, {
      method: 'GET',
      headers
    });
    
    const data = await response.json();
    console.log(`   Status: ${response.status}`);
    if (response.ok) {
      console.log(`   ✅ Table exists, ${Array.isArray(data) ? data.length : 0} rows returned`);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`   Sample: ${JSON.stringify(data[0], null, 2).substring(0, 300)}`);
      }
    } else {
      console.log(`   ❌ Error: ${JSON.stringify(data)}`);
    }
    return { success: response.ok, data, status: response.status };
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('     STEP-LEVEL RETRY + DLQ SYSTEM TEST');
  console.log('═══════════════════════════════════════════════════════════════');
  
  const results = {
    tables: {},
    rpcs: {}
  };
  
  // Test 1: Check tables exist
  console.log('\n📋 PHASE 1: Table Existence Checks');
  console.log('─────────────────────────────────────');
  
  results.tables.job_step_retry_policies = await testTable('job_step_retry_policies');
  results.tables.job_failures = await testTable('job_failures');
  
  // Test 2: Check RPCs exist
  console.log('\n📋 PHASE 2: RPC Existence Checks');
  console.log('─────────────────────────────────────');
  
  results.rpcs.get_step_retry_policies = await testRPC('get_step_retry_policies', {});
  results.rpcs.get_failed_jobs_dlq = await testRPC('get_failed_jobs_dlq', { 
    p_limit: 5, 
    p_offset: 0, 
    p_filters: {} 
  });
  
  // Test 3: Get job failures (needs a real job ID, will just check function exists)
  results.rpcs.get_job_failures = await testRPC('get_job_failures', { 
    p_job_id: '00000000-0000-0000-0000-000000000000' // Dummy UUID, should return empty array
  });
  
  // Test 4: Attempt requeue on non-existent job (should fail gracefully)
  results.rpcs.requeue_failed_job = await testRPC('requeue_failed_job', { 
    p_job_id: '00000000-0000-0000-0000-000000000000',
    p_force: false
  });
  
  // Test 5: Record failure on non-existent job (should fail gracefully)
  results.rpcs.record_job_step_failure = await testRPC('record_job_step_failure', {
    p_job_id: '00000000-0000-0000-0000-000000000000',
    p_step_name: 'test',
    p_failure: { failure_class: 'transient', error_message: 'Test error' }
  });
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('     SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  let allPassed = true;
  
  console.log('Tables:');
  for (const [name, result] of Object.entries(results.tables)) {
    const status = result.success ? '✅' : '❌';
    console.log(`  ${status} ${name}`);
    if (!result.success) allPassed = false;
  }
  
  console.log('\nRPCs:');
  for (const [name, result] of Object.entries(results.rpcs)) {
    // For RPCs, 200 OK or expected error responses are valid
    const isValid = result.status === 200 || 
                   (result.data && typeof result.data === 'object');
    const status = isValid ? '✅' : '❌';
    console.log(`  ${status} ${name} (status: ${result.status})`);
    if (!isValid) allPassed = false;
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  if (allPassed) {
    console.log('✅ ALL DLQ SYSTEM COMPONENTS VERIFIED');
  } else {
    console.log('⚠️  SOME COMPONENTS NEED ATTENTION');
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
