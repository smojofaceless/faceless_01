// =====================================================
// AI INTELLIGENCE - Video Retention & Watch Time
// =====================================================

async function aiLoadRetention() {
    const container = aiEl('retention-stats');
    if (!container) return;
    container.innerHTML = '<div class="ai-loading">Loading retention data…</div>';

    try {
        // Fetch posted videos with duration
        let postQuery = aiSupabase.from('posts')
            .select('id, title, platform, duration_seconds, posted_at')
            .eq('brand_id', aiBrandId).eq('status', 'posted')
            .not('duration_seconds', 'is', null)
            .order('posted_at', { ascending: false }).limit(50);
        if (aiPlatformFilter()) postQuery = postQuery.eq('platform', aiPlatformFilter());

        const { data: posts, error: postErr } = await postQuery;
        if (postErr || !posts?.length) {
            container.innerHTML = '<div class="ai-empty">No posted videos with duration data yet.</div>';
            return;
        }

        const postIds = posts.map(p => p.id);

        // Fetch latest metrics WITH watch time columns
        const { data: metrics } = await aiSupabase.from('v_post_metrics_latest')
            .select('post_id, platform, views, avg_view_duration_seconds, watch_time_seconds')
            .in('post_id', postIds);

        const metricsMap = {};
        for (const m of (metrics || [])) metricsMap[m.post_id] = m;

        // Build retention data per video
        const rows = [];
        for (const p of posts) {
            const m = metricsMap[p.id];
            if (!m || !m.views) continue;
            const duration = p.duration_seconds;
            const avgWatch = m.avg_view_duration_seconds;
            const completionPct = (avgWatch && duration && duration > 0)
                ? Math.min(100, Math.round((avgWatch / duration) * 100))
                : null;
            rows.push({
                title: p.title || 'Untitled',
                platform: p.platform,
                duration,
                views: m.views,
                avgWatch: avgWatch ? Math.round(avgWatch * 10) / 10 : null,
                completionPct,
                postedAt: p.posted_at,
            });
        }

        if (!rows.length) {
            container.innerHTML = '<div class="ai-empty">No watch time data collected yet. Metrics are pulled every 30 minutes after posting.</div>';
            return;
        }

        // Compute brand averages
        const withCompletion = rows.filter(r => r.completionPct !== null);
        const withWatch = rows.filter(r => r.avgWatch !== null);
        const avgCompletion = withCompletion.length
            ? Math.round(withCompletion.reduce((s, r) => s + r.completionPct, 0) / withCompletion.length)
            : null;
        const avgWatchTime = withWatch.length
            ? Math.round(withWatch.reduce((s, r) => s + r.avgWatch, 0) / withWatch.length * 10) / 10
            : null;
        const avgDuration = rows.length
            ? Math.round(rows.reduce((s, r) => s + (r.duration || 0), 0) / rows.length)
            : null;

        // Determine retention quality
        const retentionClass = avgCompletion === null ? '' :
            avgCompletion >= 60 ? 'retention-good' :
            avgCompletion >= 40 ? 'retention-ok' : 'retention-low';
        const retentionLabel = avgCompletion === null ? 'No data' :
            avgCompletion >= 60 ? 'Strong' :
            avgCompletion >= 40 ? 'Average' : 'Needs Work';

        // Summary stats
        let html = `
            <div class="retention-summary">
                <div class="retention-summary__stat">
                    <span class="retention-summary__value ${retentionClass}">${avgCompletion !== null ? avgCompletion + '%' : '—'}</span>
                    <span class="retention-summary__label">Avg Completion Rate</span>
                    <span class="retention-summary__tag ${retentionClass}">${retentionLabel}</span>
                </div>
                <div class="retention-summary__stat">
                    <span class="retention-summary__value">${avgWatchTime !== null ? avgWatchTime + 's' : '—'}</span>
                    <span class="retention-summary__label">Avg Watch Time</span>
                </div>
                <div class="retention-summary__stat">
                    <span class="retention-summary__value">${avgDuration !== null ? avgDuration + 's' : '—'}</span>
                    <span class="retention-summary__label">Avg Video Duration</span>
                </div>
                <div class="retention-summary__stat">
                    <span class="retention-summary__value">${rows.length}</span>
                    <span class="retention-summary__label">Videos Tracked</span>
                </div>
            </div>
        `;

        // Per-video bar chart (completion rate as horizontal bars)
        const displayRows = rows.filter(r => r.completionPct !== null).slice(0, 15);
        if (displayRows.length) {
            html += '<div class="retention-chart">';
            for (const r of displayRows) {
                const barWidth = Math.max(2, r.completionPct);
                const barClass = r.completionPct >= 60 ? 'retention-good' :
                    r.completionPct >= 40 ? 'retention-ok' : 'retention-low';
                const platTag = AI_PLATFORM_SHORT[r.platform] || r.platform?.replace(/_.*/, '').charAt(0).toUpperCase() || '?';
                const truncTitle = r.title.length > 30 ? r.title.slice(0, 28) + '…' : r.title;
                html += `
                    <div class="retention-row">
                        <span class="retention-row__label" title="${aiEscHtml(r.title)}">
                            <span class="retention-row__plat">${platTag}</span>
                            ${aiEscHtml(truncTitle)}
                        </span>
                        <div class="retention-row__bar-wrap">
                            <div class="retention-row__bar ${barClass}" style="width:${barWidth}%"></div>
                        </div>
                        <span class="retention-row__pct ${barClass}">${r.completionPct}%</span>
                        <span class="retention-row__watch">${r.avgWatch}s / ${r.duration}s</span>
                    </div>
                `;
            }
            html += '</div>';
        }

        // Videos with no retention data
        const noData = rows.filter(r => r.completionPct === null);
        if (noData.length) {
            html += `<div class="retention-note">${noData.length} video${noData.length > 1 ? 's' : ''} without watch time data (metric not yet available from platform)</div>`;
        }

        container.innerHTML = html;
    } catch (err) {
        console.error('[Retention]', err);
        container.innerHTML = '<div class="ai-empty">Error loading retention data.</div>';
    }
}
