// =====================================================
// DASHBOARD - Best Posting Times
// Ranks time slots by average views per post, which is the
// true measure of "best time" — when your audience engages most.
// Joins posts with v_post_metrics_latest for real performance data.
// =====================================================

async function dbLoadBestTimes() {
    const container = document.getElementById('best-times');
    if (!container) return;

    try {
        // Fetch posted posts with their metrics
        let query = dbSupabase
            .from('posts')
            .select('id, posted_at, scheduled_at, v_post_metrics_latest(views, likes, comments, shares)')
            .eq('status', 'posted')
            .not('posted_at', 'is', null)
            .order('posted_at', { ascending: false })
            .limit(500);

        if (dbActiveBrandId) {
            query = query.eq('brand_id', dbActiveBrandId);
        }

        const { data: posts, error } = await query;

        // If the join fails (view may not exist), fall back to posts-only
        if (error) {
            console.warn('dbLoadBestTimes: metrics join failed, falling back to post counts', error.message);
            return dbLoadBestTimesFallback(container);
        }

        if (!posts || posts.length === 0) {
            container.innerHTML = '<div class="db-empty"><span>Not enough data yet</span><span class="db-empty__sub">Post more content to see best times</span></div>';
            return;
        }

        // Bucket by day-of-week + hour, tracking views
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const slotMap = {}; // key: "dow-hour"
        posts.forEach(p => {
            const ts = p.posted_at || p.scheduled_at;
            if (!ts) return;
            const d = new Date(ts);
            const dow = d.getDay();
            const hour = d.getHours();
            const key = `${dow}-${hour}`;

            // Get views from the metrics join (array of metric rows)
            const metrics = p.v_post_metrics_latest || [];
            const totalViews = Array.isArray(metrics)
                ? metrics.reduce((s, m) => s + (m.views || 0), 0)
                : (metrics.views || 0);

            if (!slotMap[key]) slotMap[key] = { dow, hour, totalViews: 0, postCount: 0 };
            slotMap[key].totalViews += totalViews;
            slotMap[key].postCount++;
        });

        // Rank by average views per post in that slot
        const slots = Object.values(slotMap)
            .filter(s => s.postCount > 0)
            .map(s => ({ ...s, avgViews: Math.round(s.totalViews / s.postCount) }))
            .sort((a, b) => b.avgViews - a.avgViews)
            .slice(0, 8);

        if (slots.length === 0 || slots[0].avgViews === 0) {
            // No metrics data yet — fall back to post counts
            return dbLoadBestTimesFallback(container);
        }

        const maxViews = Math.max(...slots.map(s => s.avgViews));

        container.innerHTML = `<div class="db-times">${slots.map(s => {
            const h = s.hour;
            const timeLabel = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
            const label = `${dayNames[s.dow]} ${timeLabel}`;
            const pct = Math.round((s.avgViews / maxViews) * 100);
            const viewsStr = s.avgViews >= 1000 ? (s.avgViews / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(s.avgViews);
            return `
                <div class="db-time-row" title="Avg ${viewsStr} views from ${s.postCount} post${s.postCount !== 1 ? 's' : ''} on ${dayNames[s.dow]}s at ${timeLabel}">
                    <span class="db-time-row__hour">${label}</span>
                    <div class="db-time-row__track">
                        <div class="db-time-row__fill" style="width:${Math.max(pct, 8)}%"></div>
                    </div>
                    <span class="db-time-row__val">${viewsStr}</span>
                </div>`;
        }).join('')}</div>`;
    } catch (e) {
        console.error('dbLoadBestTimes:', e);
        container.innerHTML = '<div class="db-empty"><span>Failed to load</span></div>';
    }
}

// Fallback: when no metrics data exists, show post frequency
async function dbLoadBestTimesFallback(container) {
    try {
        let query = dbSupabase
            .from('posts')
            .select('posted_at, scheduled_at')
            .in('status', ['posted', 'scheduled', 'posting'])
            .order('created_at', { ascending: false })
            .limit(500);

        if (dbActiveBrandId) query = query.eq('brand_id', dbActiveBrandId);

        const { data: posts } = await query;
        if (!posts || posts.length === 0) {
            container.innerHTML = '<div class="db-empty"><span>Not enough data yet</span><span class="db-empty__sub">Post more content to see best times</span></div>';
            return;
        }

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const slotMap = {};
        posts.forEach(p => {
            const ts = p.posted_at || p.scheduled_at;
            if (!ts) return;
            const d = new Date(ts);
            const key = `${d.getDay()}-${d.getHours()}`;
            if (!slotMap[key]) slotMap[key] = { dow: d.getDay(), hour: d.getHours(), count: 0 };
            slotMap[key].count++;
        });

        const slots = Object.values(slotMap).sort((a, b) => b.count - a.count).slice(0, 8);
        const maxCount = Math.max(...slots.map(s => s.count));

        container.innerHTML = `
            <div class="db-times-note">Based on post frequency (no view data yet)</div>
            <div class="db-times">${slots.map(s => {
            const h = s.hour;
            const timeLabel = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
            const label = `${dayNames[s.dow]} ${timeLabel}`;
            const pct = Math.round((s.count / maxCount) * 100);
            return `
                <div class="db-time-row" title="${s.count} posts on ${dayNames[s.dow]}s at ${timeLabel}">
                    <span class="db-time-row__hour">${label}</span>
                    <div class="db-time-row__track">
                        <div class="db-time-row__fill" style="width:${Math.max(pct, 8)}%"></div>
                    </div>
                    <span class="db-time-row__val">${s.count}</span>
                </div>`;
        }).join('')}</div>`;
    } catch (e) {
        console.error('dbLoadBestTimesFallback:', e);
        container.innerHTML = '<div class="db-empty"><span>Failed to load</span></div>';
    }
}
