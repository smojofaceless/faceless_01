/**
 * Backfill Retention Metrics Script
 * 
 * Triggers the metrics-collector edge function to re-collect metrics
 * for all eligible posts. The updated edge function now fetches:
 * - YouTube: averageViewDuration, averageViewPercentage, estimatedMinutesWatched (via Analytics API)
 * - Instagram Reels: ig_reels_avg_watch_time, ig_reels_video_view_total_time (via Insights API)
 * 
 * Posts that were recently collected will be picked up in subsequent runs
 * as their collection intervals elapse.
 * 
 * Usage: node scripts/backfill-retention-metrics.js [--rounds N] [--delay-ms MS]
 * 
 * Options:
 *   --rounds N       Number of times to invoke the collector (default: 3)
 *   --delay-ms MS    Delay between rounds in ms (default: 5000)
 */

const SUPABASE_URL = 'https://ustmetegzisztqqcjigt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDc0NzksImV4cCI6MjA4NTEyMzQ3OX0.5lEiAP6PS4yY3WwAL5v4XWFHWJS5hzBWPXQxuxWe5d4';

async function invokeCollector() {
    const url = `${SUPABASE_URL}/functions/v1/metrics-collector`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: 'backfill' }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Edge function error ${response.status}: ${text}`);
    }

    return await response.json();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    const args = process.argv.slice(2);
    let rounds = 3;
    let delayMs = 5000;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--rounds' && args[i + 1]) rounds = parseInt(args[i + 1]);
        if (args[i] === '--delay-ms' && args[i + 1]) delayMs = parseInt(args[i + 1]);
    }

    console.log(`\n=== Retention Metrics Backfill ===`);
    console.log(`Rounds: ${rounds}`);
    console.log(`Delay between rounds: ${delayMs}ms`);
    console.log(`Edge function: ${SUPABASE_URL}/functions/v1/metrics-collector`);
    console.log(`\nThis will invoke the metrics-collector edge function ${rounds} times.`);
    console.log(`The updated collector now fetches YouTube Analytics (watch time, avg view duration)`);
    console.log(`and Instagram Reels retention metrics (avg watch time, total view time).\n`);

    let totalSuccess = 0;
    let totalErrors = 0;
    let totalProcessed = 0;

    for (let round = 1; round <= rounds; round++) {
        console.log(`\n--- Round ${round}/${rounds} ---`);
        
        try {
            const result = await invokeCollector();
            console.log(`  Status: ${result.status}`);
            console.log(`  Processed: ${result.processed}`);
            console.log(`  Success: ${result.success}`);
            console.log(`  Errors: ${result.errors}`);
            console.log(`  Duration: ${result.duration_ms}ms`);
            
            if (result.error_details && result.error_details.length > 0) {
                console.log(`  Error details:`);
                result.error_details.forEach(e => {
                    console.log(`    - ${e.platform} | ${e.post_id}: ${e.error}`);
                });
            }

            totalProcessed += result.processed || 0;
            totalSuccess += result.success || 0;
            totalErrors += result.errors || 0;

            // If no posts were processed, no point continuing
            if (result.processed === 0) {
                console.log(`\n  No more eligible posts — stopping early.`);
                break;
            }

        } catch (err) {
            console.error(`  Error: ${err.message}`);
            totalErrors++;
        }

        if (round < rounds) {
            console.log(`  Waiting ${delayMs}ms before next round...`);
            await sleep(delayMs);
        }
    }

    console.log(`\n=== Backfill Summary ===`);
    console.log(`Total processed: ${totalProcessed}`);
    console.log(`Total success: ${totalSuccess}`);
    console.log(`Total errors: ${totalErrors}`);
    console.log(`\nRetention data will continue to be collected by the regular`);
    console.log(`30-minute cron schedule. All posts within the 90-day window`);
    console.log(`will receive retention data within their next collection cycle.\n`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
