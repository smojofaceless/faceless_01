// Quick test: Instagram Reels insights API
// Tests both old metrics (impressions) and new Reels metrics

const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDc0NzksImV4cCI6MjA4NTEyMzQ3OX0.5lEiAP6PS4yY3WwAL5v4XWFHWJS5hzBWPXQxuxWe5d4';
const MEDIA_ID = '18528365665067210'; // First IG Reel

async function main() {
    // Get IG token from Supabase
    const tokenResp = await fetch(
        `${SUPABASE_URL}/rest/v1/platform_tokens?select=access_token&platform=eq.instagram&is_valid=eq.true&limit=1`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const tokens = await tokenResp.json();
    if (!tokens.length) { console.log('No valid IG token'); return; }
    const accessToken = tokens[0].access_token;
    console.log('✅ Got IG token');

    // Step 1: Media info
    const mediaResp = await fetch(
        `https://graph.facebook.com/v21.0/${MEDIA_ID}?fields=like_count,comments_count,timestamp,media_type,media_product_type&access_token=${accessToken}`
    );
    const media = await mediaResp.json();
    console.log('\n📷 Media info:', JSON.stringify(media, null, 2));

    // Step 2: Test various metric combinations to see what works for Reels on v21.0+
    const testMetrics = [
        'views,reach,saved,shares',
        'views,likes,comments,saved,shares,reach',
        'total_interactions,reach',
        'reach,saved,shares',
        'views',
    ];

    for (const metrics of testMetrics) {
        console.log(`\n--- Testing: ${metrics} ---`);
        const resp = await fetch(
            `https://graph.facebook.com/v21.0/${MEDIA_ID}/insights?metric=${metrics}&access_token=${accessToken}`
        );
        const data = await resp.json();
        console.log('Status:', resp.status);
        if (data.error) {
            console.log('Error:', data.error.message.substring(0, 120));
        } else if (data.data) {
            data.data.forEach(m => console.log(`  ${m.name}: ${m.values?.[0]?.value}`));
        }
    }
}

main().catch(console.error);
