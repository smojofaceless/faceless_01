// Run migration SQL against Supabase
// Usage: node run-migration.js

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';
// Get service role key from environment or .env file
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  console.log('Set it with: $env:SUPABASE_SERVICE_ROLE_KEY = "your-key"');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runMigration() {
  console.log('Running Failure Protection + DLQ migration...\n');

  // Step 1: Create system_config table
  console.log('1. Creating system_config table...');
  const { error: err1 } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        updated_by TEXT
      );
    `
  });
  if (err1 && !err1.message.includes('already exists')) {
    console.log('  Note:', err1.message);
  } else {
    console.log('  ✓ Done');
  }

  // Step 2: Insert default values
  console.log('2. Inserting default config values...');
  const { error: err2 } = await supabase
    .from('system_config')
    .upsert([
      {
        key: 'kill_switch',
        value: { enabled: false, reason: null, enabled_at: null },
        updated_by: 'system'
      },
      {
        key: 'failure_protection',
        value: {
          cluster_window_minutes: 10,
          cluster_threshold: 5,
          auto_pause_enabled: true,
          cooldown_minutes: 30
        },
        updated_by: 'system'
      }
    ], { onConflict: 'key' });
  
  if (err2) {
    console.log('  Error:', err2.message);
  } else {
    console.log('  ✓ Done');
  }

  // Step 3: Check if table exists
  console.log('\n3. Verifying system_config...');
  const { data, error: err3 } = await supabase
    .from('system_config')
    .select('*');
  
  if (err3) {
    console.log('  Error:', err3.message);
  } else {
    console.log('  ✓ Found', data.length, 'config entries');
    data.forEach(c => console.log(`    - ${c.key}: ${JSON.stringify(c.value)}`));
  }

  console.log('\nMigration complete!');
  console.log('\nNote: For full migration, run the SQL file in Supabase Dashboard:');
  console.log('  supabase/migrations/20260222_failure_protection_dlq.sql');
}

runMigration().catch(console.error);
