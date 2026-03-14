// =====================================================
// AI INTELLIGENCE - Cross-Platform Comparison & Strategy
// =====================================================

async function aiLoadCrossPlatformComparison() {
    const container = aiEl('cross-platform-comparison');
    if (!container) return;
    container.innerHTML = '<div class="ai-loading">Loading platform comparison…</div>';

    try {
        const { data: rawData, error } = await aiSupabase
            .from('v_cross_platform_performance')
            .select('*')
            .eq('brand_id', aiBrandId);

        if (error || !rawData?.length) {
            container.innerHTML = '<div class="ai-empty">No cross-platform data yet. Post to multiple platforms to see comparisons.</div>';
            return;
        }

        const platformMap = {};
        for (const row of rawData) {
            const p = row.platform;
            if (!platformMap[p]) platformMap[p] = { platform: p, total_posts: 0, sum_views: 0, sum_likes: 0, sum_comments: 0, sum_shares: 0 };
            platformMap[p].total_posts++;
            platformMap[p].sum_views += (row.views || 0);
            platformMap[p].sum_likes += (row.likes || 0);
            platformMap[p].sum_comments += (row.comments || 0);
            platformMap[p].sum_shares += (row.shares || 0);
        }
        const data = Object.values(platformMap).map(p => ({
            platform: p.platform,
            total_posts: p.total_posts,
            avg_views: Math.round(p.sum_views / p.total_posts),
            avg_likes: Math.round((p.sum_likes / p.total_posts) * 10) / 10,
            avg_comments: Math.round((p.sum_comments / p.total_posts) * 10) / 10,
        }));

        const maxViews = Math.max(...data.map(d => d.avg_views || 0), 1);

        let html = `
            <div class="ai-comparison-table">
                <table style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                            <th style="text-align:left; padding:8px; color:rgba(255,255,255,0.6);">Platform</th>
                            <th style="text-align:right; padding:8px; color:rgba(255,255,255,0.6);">Posts</th>
                            <th style="text-align:right; padding:8px; color:rgba(255,255,255,0.6);">Avg Views</th>
                            <th style="text-align:right; padding:8px; color:rgba(255,255,255,0.6);">Avg Likes</th>
                            <th style="text-align:right; padding:8px; color:rgba(255,255,255,0.6);">Avg Comments</th>
                            <th style="text-align:right; padding:8px; color:rgba(255,255,255,0.6);">Engagement %</th>
                            <th style="padding:8px; width:30%; color:rgba(255,255,255,0.6);">Performance</th>
                        </tr>
                    </thead>
                    <tbody>`;

        for (const row of data.sort((a, b) => (b.avg_views || 0) - (a.avg_views || 0))) {
            const platformLabel = AI_PLATFORM_LABELS[row.platform] || row.platform;
            const platColor = AI_PLATFORM_COLORS[row.platform] || '#6b7280';
            const barWidth = Math.round(((row.avg_views || 0) / maxViews) * 100);
            const engRate = row.avg_views > 0 ? (((row.avg_likes || 0) + (row.avg_comments || 0)) / row.avg_views * 100).toFixed(2) : '0.00';

            html += `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                    <td style="padding:8px; font-weight:600; color:${platColor};">${platformLabel}</td>
                    <td style="text-align:right; padding:8px;">${row.total_posts || 0}</td>
                    <td style="text-align:right; padding:8px;">${aiFmt(row.avg_views)}</td>
                    <td style="text-align:right; padding:8px;">${aiFmt(row.avg_likes)}</td>
                    <td style="text-align:right; padding:8px;">${aiFmt(row.avg_comments)}</td>
                    <td style="text-align:right; padding:8px; color:${parseFloat(engRate) > 5 ? '#10b981' : 'rgba(255,255,255,0.5)'};">${engRate}%</td>
                    <td style="padding:8px;">
                        <div style="background:rgba(255,255,255,0.06); border-radius:4px; height:20px; overflow:hidden;">
                            <div style="background:${platColor}; height:100%; width:${barWidth}%; border-radius:4px; transition:width 0.3s; opacity:0.8;"></div>
                        </div>
                    </td>
                </tr>`;
        }

        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (err) {
        console.error('[AI Intelligence] loadCrossPlatformComparison error:', err);
        container.innerHTML = '<div class="ai-empty">Failed to load platform comparison.</div>';
    }
}

async function aiLoadStrategyPerformance() {
    const container = aiEl('strategy-performance');
    if (!container) return;
    container.innerHTML = '<div class="ai-loading">Loading strategy data…</div>';

    try {
        const { data, error } = await aiSupabase
            .from('v_strategy_performance')
            .select('*')
            .eq('brand_id', aiBrandId)
            .order('avg_perf_score', { ascending: false });

        if (error || !data?.length) {
            container.innerHTML = '<div class="ai-empty">No strategy data yet. Strategies are assigned automatically during content generation.</div>';
            return;
        }

        const maxScore = Math.max(...data.map(d => d.avg_perf_score || 0), 1);

        let html = '<div class="ai-strategy-grid" style="display:grid; gap:12px;">';

        for (const s of data) {
            const barWidth = Math.round(((s.avg_perf_score || 0) / maxScore) * 100);
            const engColor = barWidth > 70 ? '#10b981' : barWidth > 40 ? '#eab308' : 'rgba(255,255,255,0.4)';
            const platLabel = AI_PLATFORM_LABELS[s.platform] || s.platform || '';
            const platformBadge = platLabel ? `<span style="font-size:0.7rem; padding:2px 6px; background:rgba(255,255,255,0.06); border-radius:4px; margin-left:6px;">${platLabel}</span>` : '';

            html += `
                <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:12px; padding:12px 16px; display:flex; align-items:center; gap:12px;">
                    <div style="flex:1;">
                        <div style="font-weight:600; color:rgba(255,255,255,0.9); font-size:0.9rem;">
                            ${(s.strategy_type || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            ${platformBadge}
                        </div>
                        <div style="font-size:0.8rem; color:rgba(255,255,255,0.5); margin-top:2px;">
                            ${s.post_count || 0} posts · Avg Views: ${aiFmt(s.avg_views)} · Score: ${aiFmt(s.avg_perf_score)}
                        </div>
                    </div>
                    <div style="width:120px;">
                        <div style="background:rgba(255,255,255,0.06); border-radius:4px; height:16px; overflow:hidden;">
                            <div style="background:${engColor}; height:100%; width:${barWidth}%; border-radius:4px;"></div>
                        </div>
                    </div>
                </div>`;
        }

        html += '</div>';
        container.innerHTML = html;
    } catch (err) {
        console.error('[AI Intelligence] loadStrategyPerformance error:', err);
        container.innerHTML = '<div class="ai-empty">Failed to load strategy data.</div>';
    }
}
