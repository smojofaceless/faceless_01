// =====================================================
// DASHBOARD - Performance Overview
// =====================================================

async function dbLoadPerformance() {
    const container = document.getElementById('performance-overview');
    if (!container) return;

    try {
        const { data: metrics, error } = await dbSupabase
            .from('v_post_metrics_latest')
            .select('post_id, platform, views, likes, comments, shares, saves');

        if (error) throw error;

        if (!metrics || metrics.length === 0) {
            container.innerHTML = '<div class="db-empty"><span>No performance data yet</span><span class="db-empty__sub">Metrics appear after posts are published</span></div>';
            return;
        }

        const totals = metrics.reduce((acc, m) => ({
            views: acc.views + (m.views || 0),
            likes: acc.likes + (m.likes || 0),
            comments: acc.comments + (m.comments || 0),
            shares: acc.shares + (m.shares || 0),
            saves: acc.saves + (m.saves || 0)
        }), { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 });

        const engagement = totals.likes + totals.comments + totals.shares + totals.saves;

        const byPlatform = {};
        metrics.forEach(m => {
            const key = dbNormalizePlatform(m.platform);
            if (!byPlatform[key]) byPlatform[key] = { views: 0, likes: 0, posts: 0 };
            byPlatform[key].views += m.views || 0;
            byPlatform[key].likes += m.likes || 0;
            byPlatform[key].posts++;
        });

        // Top 3 posts by views
        const topPosts = [...metrics].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 3);
        let topWithTitles = topPosts;
        if (topPosts.length > 0) {
            const postIds = topPosts.map(p => p.post_id);
            const { data: postData } = await dbSupabase.from('posts').select('id, title').in('id', postIds);
            if (postData) {
                const titleMap = {};
                postData.forEach(p => titleMap[p.id] = p.title);
                topWithTitles = topPosts.map(p => ({ ...p, title: titleMap[p.post_id] || 'Untitled' }));
            }
        }

        container.innerHTML = `
            <div class="db-perf-stats">
                <div class="db-perf-stat">
                    <span class="db-perf-stat__val">${dbFmt(totals.views)}</span>
                    <span class="db-perf-stat__label">Views</span>
                </div>
                <div class="db-perf-stat">
                    <span class="db-perf-stat__val">${dbFmt(engagement)}</span>
                    <span class="db-perf-stat__label">Engagements</span>
                </div>
                <div class="db-perf-stat">
                    <span class="db-perf-stat__val">${metrics.length}</span>
                    <span class="db-perf-stat__label">Tracked</span>
                </div>
                <div class="db-perf-stat">
                    <span class="db-perf-stat__val">${totals.views > 0 ? dbFmt(Math.round(totals.views / metrics.length)) : 0}</span>
                    <span class="db-perf-stat__label">Avg Views</span>
                </div>
            </div>
            <div class="db-perf-bars">
                ${Object.entries(byPlatform).map(([plat, d]) => {
                    const pct = totals.views > 0 ? Math.round(d.views / totals.views * 100) : 0;
                    return `
                    <div class="db-perf-bar-row">
                        <span class="db-badge db-badge--${dbPlatformBadge(plat)}">${dbPlatformLabel(plat)}</span>
                        <div class="db-perf-bar-track">
                            <div class="db-perf-bar-fill" style="width:${pct}%;background:${dbPlatformColor(plat)}"></div>
                        </div>
                        <span class="db-perf-bar-val">${dbFmt(d.views)}</span>
                    </div>`;
                }).join('')}
            </div>
            ${topWithTitles.length > 0 ? `
            <div class="db-perf-top-label">Top Performing</div>
            <div class="db-perf-top">
                ${topWithTitles.map((p, i) => `
                <div class="db-perf-top-row">
                    <span class="db-perf-top-rank">#${i + 1}</span>
                    <div class="db-perf-top-info">
                        <span class="db-perf-top-title">${escapeHtml(p.title || 'Untitled')}</span>
                        <span class="db-badge db-badge--${dbPlatformBadge(p.platform)}" style="font-size:10px">${dbPlatformLabel(p.platform)}</span>
                    </div>
                    <span class="db-perf-top-views">${dbFmt(p.views)}</span>
                </div>`).join('')}
            </div>` : ''}
        `;
    } catch (e) {
        console.error('dbLoadPerformance:', e);
        container.innerHTML = '<div class="db-empty"><span>Failed to load</span></div>';
    }
}
