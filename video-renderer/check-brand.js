const BRAND_ID = '68a58afb-8c85-4d6d-9eec-144ab7e5f106';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTU0NzQ3OSwiZXhwIjoyMDg1MTIzNDc5fQ.01lwYvZ-DG8zLMgJfCW4zHVXyegAOaXGf2XPsHpIOn8';

async function main() {
  const res = await fetch(`https://ustmetegzisztqqcjigt.supabase.co/rest/v1/brands?id=eq.${BRAND_ID}&select=*`, {
    headers: { 'apikey': KEY }
  });
  const data = await res.json();
  if (!data.length) { console.log('No brand found'); return; }
  const brand = data[0];
  console.log('Columns:', Object.keys(brand).join(', '));
  // Find image_prompt config
  for (const [k, v] of Object.entries(brand)) {
    if (v && typeof v === 'object') {
      const str = JSON.stringify(v);
      if (str.includes('image_model') || str.includes('video_mode') || str.includes('img2vid')) {
        console.log(`\n=== ${k} (contains image config) ===`);
        console.log(JSON.stringify(v, null, 2).substring(0, 3000));
      }
    }
  }
}
main();
