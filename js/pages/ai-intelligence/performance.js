// =====================================================
// AI INTELLIGENCE - Performance Trend
// =====================================================

async function aiLoadPerformanceTrend() {
    const container = aiEl('performance-trend');
    if (!container) return;
    container.innerHTML = '<div class="ai-loading">Loading performance data…</div>';

    let query = aiSupabase
        .from('v_post_metrics_latest')
        .select('post_id, platform, views, likes, comments, shares, collected_at')
        .order('views', { ascending: false });

    if (aiPlatformFilter()) {
        query = query.eq('platform', aiPlatformFilter());
    }

    const { data: metrics, error } = await query;
    if (error || !metrics?.length) {
        container.innerHTML = '<div class="ai-empty">No performance data yet. Posts need to be published and metrics collected.</div>';
        return;
    }

    const totalViews = metrics.reduce((s, m) => s + (m.views || 0), 0);
    const totalLikes = metrics.reduce((s, m) => s + (m.likes || 0), 0);
    const totalComments = metrics.reduce((s, m) => s + (m.comments || 0), 0);
    const avgViews = Math.round(totalViews / metrics.length);

    const sorted = [...metrics].sort((a, b) => (b.views || 0) - (a.views || 0));
    const maxViews = sorted[0]?.views || 1;

    let html = `
        <div class="trend-summary">
            <div class="trend-stat">
                <span class="trend-stat__value">${aiFmt(totalViews)}</span>
                <span class="trend-stat__label">Total Views</span>
            </div>
            <div class="trend-stat">
                <span class="trend-stat__value">${aiFmt(totalLikes)}</span>
                <span class="trend-stat__label">Total Likes</span>
            </div>
            <div class="trend-stat">
                <span class="trend-stat__value">${aiFmt(totalComments)}</span>
                <span class="trend-stat__label">Total Comments</span>
            </div>
            <div class="trend-stat">
                <span class="trend-stat__value">${aiFmt(avgViews)}</span>
                <span class="trend-stat__label">Avg Views/Post</span>
            </div>
        </div>
        <div class="trend-chart">
    `;

    const displayPosts = sorted.slice(0, 30);
    for (const p of displayPosts) {
        const viewH = Math.max(2, ((p.views || 0) / maxViews) * 150);
        const likeH = Math.max(0, ((p.likes || 0) / Math.max(maxViews * 0.05, 1)) * 30);
        const platLabel = (p.platform || '').replace('_reels', '').replace('_shorts', '');
        html += `
            <div class="trend-bar-group">
                <div class="trend-bar trend-bar--views" style="height:${viewH}px" title="${p.views} views">
                    <span class="ai-tooltip">${aiFmt(p.views)} views · ${p.likes} likes</span>
                </div>
                <div class="trend-bar trend-bar--likes" style="height:${likeH}px"></div>
                <span class="trend-bar__label">${AI_PLATFORM_SHORT[p.platform] || platLabel.charAt(0).toUpperCase()}</span>
            </div>
        `;
    }

    html += `
        </div>
        <div class="trend-legend">
            <span class="trend-legend__item"><span class="trend-legend__dot trend-legend__dot--views"></span> Views</span>
            <span class="trend-legend__item"><span class="trend-legend__dot trend-legend__dot--likes"></span> Likes</span>
        </div>
    `;
    container.innerHTML = html;
}
