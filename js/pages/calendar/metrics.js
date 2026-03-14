// =====================================================
// CALENDAR PAGE - Metrics
// Post metrics loading, per-platform breakdown, calendar enrichment
// =====================================================

/**
 * Enrich rendered calendar items with metrics data
 * Fetches latest metrics for posted items and re-renders with badges
 */
async function enrichCalendarMetrics() {
    if (typeof metricsService === 'undefined' || !calendarInstance || !calendarInstance._cachedItems) return;

    try {
        const allPostIds = new Set();
        for (const item of calendarInstance._cachedItems) {
            if (item.id && (item.status === 'posted' || (item.isConsolidated && item.platforms))) {
                allPostIds.add(item.id);
                if (item.isConsolidated && item.platforms) {
                    for (const p of item.platforms) {
                        if (p.id && p.status === 'posted') allPostIds.add(p.id);
                    }
                }
            }
        }

        if (allPostIds.size === 0) return;

        const metricsMap = await metricsService.getLatestMetricsBatch([...allPostIds]);
        if (metricsMap.size === 0) return;

        let enriched = 0;
        for (const item of calendarInstance._cachedItems) {
            if (item.isConsolidated && item.platforms) {
                const totals = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, collected_at: null };
                let hasAny = false;
                for (const p of item.platforms) {
                    const pm = metricsMap.get(p.id);
                    if (pm) {
                        p.metrics = pm;
                        hasAny = true;
                        totals.views += pm.views || 0;
                        totals.likes += pm.likes || 0;
                        totals.comments += pm.comments || 0;
                        totals.shares += pm.shares || 0;
                        totals.saves += pm.saves || 0;
                        if (!totals.collected_at || new Date(pm.collected_at) > new Date(totals.collected_at)) {
                            totals.collected_at = pm.collected_at;
                        }
                    }
                }
                if (hasAny) {
                    item.metrics = totals;
                    enriched++;
                }
            } else {
                const m = metricsMap.get(item.id);
                if (m) {
                    item.metrics = m;
                    enriched++;
                }
            }
        }

        if (enriched > 0) {
            console.log(`📊 Calendar: Enriched ${enriched} posts with metrics (${allPostIds.size} total IDs)`);
            await calendarInstance.render();
        }
    } catch (e) {
        console.warn('Calendar metrics enrichment failed (non-fatal):', e);
    }
}

/**
 * Load and display metrics for a post in the modal
 * @param {Object} post - Calendar item (must be posted)
 */
async function loadPostMetrics(post) {
    const container = document.getElementById('post-metrics-section');
    if (!container || typeof metricsService === 'undefined') return;

    container.innerHTML = `
        <div class="metrics-detail">
            <div class="metrics-detail__header">
                <h5>Engagement Metrics</h5>
                <span class="badge badge--muted badge--xs">loading...</span>
            </div>
        </div>
    `;

    try {
        const isConsolidated = post.isConsolidated && post.platforms && post.platforms.length > 1;
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        if (isConsolidated) {
            const fetchPromises = post.platforms
                .filter(p => p.status === 'posted' && p.id)
                .map(async (p) => {
                    const [latest, history] = await Promise.all([
                        metricsService.getLatestMetrics(p.id),
                        metricsService.getPostMetrics(p.id, { since, limit: 5 }),
                    ]);
                    return {
                        platformId: p.platformId,
                        platformName: getPlatformDisplayName(p.platformId),
                        platformUrl: p.raw?.platform_url || null,
                        latest,
                        history
                    };
                });

            const results = await Promise.all(fetchPromises);
            container.innerHTML = buildPerPlatformMetricsHTML(results);
        } else {
            const postId = post.id || post.raw?.id;
            if (!postId) {
                container.innerHTML = '';
                return;
            }

            const [latest, history] = await Promise.all([
                metricsService.getLatestMetrics(postId),
                metricsService.getPostMetrics(postId, { since, limit: 10 }),
            ]);

            const platId = post.platformId || 'unknown';
            const platResults = [{
                platformId: platId,
                platformName: getPlatformDisplayName(platId),
                platformUrl: post.raw?.platform_url || null,
                latest,
                history
            }];
            container.innerHTML = buildPerPlatformMetricsHTML(platResults);
        }
    } catch (e) {
        console.warn('Failed to load post metrics:', e);
        container.innerHTML = metricsService.buildDetailHTML(null, []);
    }
}

/**
 * Build per-platform metrics breakdown HTML
 * @param {Array} platformResults - [{platformId, platformName, platformUrl, latest, history}]
 * @returns {string} HTML
 */
function buildPerPlatformMetricsHTML(platformResults) {
    if (!platformResults || platformResults.length === 0) {
        return metricsService.buildDetailHTML(null, []);
    }

    const withData = platformResults.filter(p => p.latest);
    const withoutData = platformResults.filter(p => !p.latest);

    if (withData.length === 0) {
        return metricsService.buildDetailHTML(null, []);
    }

    // Compute aggregate totals
    const totals = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
    let latestCollected = null;
    for (const p of withData) {
        totals.views += p.latest.views || 0;
        totals.likes += p.latest.likes || 0;
        totals.comments += p.latest.comments || 0;
        totals.shares += p.latest.shares || 0;
        totals.saves += p.latest.saves || 0;
        if (!latestCollected || new Date(p.latest.collected_at) > new Date(latestCollected)) {
            latestCollected = p.latest.collected_at;
        }
    }

    const collectedLabel = latestCollected ? metricsService.formatTimeAgo(latestCollected) : 'N/A';

    const aggregateHTML = `
        <div class="metrics-detail">
            <div class="metrics-detail__header">
                <h5>Engagement Metrics</h5>
                <span class="badge badge--success badge--xs" title="Last collected: ${collectedLabel}">
                    &#128200; ${collectedLabel}
                </span>
            </div>
            <div class="metrics-stats">
                <div class="metrics-stat">
                    <span class="metrics-stat__value">${metricsService.formatCount(totals.views)}</span>
                    <span class="metrics-stat__label">Total Views</span>
                </div>
                <div class="metrics-stat">
                    <span class="metrics-stat__value">${metricsService.formatCount(totals.likes)}</span>
                    <span class="metrics-stat__label">Total Likes</span>
                </div>
                <div class="metrics-stat">
                    <span class="metrics-stat__value">${metricsService.formatCount(totals.comments)}</span>
                    <span class="metrics-stat__label">Total Comments</span>
                </div>
                <div class="metrics-stat">
                    <span class="metrics-stat__value">${metricsService.formatCount(totals.shares)}</span>
                    <span class="metrics-stat__label">Total Shares</span>
                </div>
                ${totals.saves > 0 ? `
                <div class="metrics-stat">
                    <span class="metrics-stat__value">${metricsService.formatCount(totals.saves)}</span>
                    <span class="metrics-stat__label">Total Saves</span>
                </div>
                ` : ''}
            </div>
        </div>
    `;

    const platformCardsHTML = withData.map(p => {
        const m = p.latest;
        const perfScore = (m.views || 0) + 5 * (m.likes || 0) + 10 * (m.comments || 0) + 10 * (m.shares || 0);
        const perfClass = perfScore > 100 ? 'perf--high' : perfScore > 20 ? 'perf--mid' : 'perf--low';
        const platformLink = p.platformUrl
            ? `<a href="${p.platformUrl}" target="_blank" class="metrics-platform__link" title="View on ${p.platformName}">&#8599;</a>`
            : '';

        const historyRows = (p.history || []).slice(0, 3).map(h => `
            <tr>
                <td>${metricsService.formatTimeAgo(h.collected_at)}</td>
                <td>${metricsService.formatCount(h.views)}</td>
                <td>${metricsService.formatCount(h.likes)}</td>
                <td>${metricsService.formatCount(h.comments)}</td>
            </tr>
        `).join('');

        return `
            <div class="metrics-platform-card">
                <div class="metrics-platform-card__header">
                    <span class="metrics-platform-card__name platform-badge platform-badge--${p.platformId}">
                        ${p.platformName}
                    </span>
                    <span class="metrics-platform-card__perf ${perfClass}" title="Performance score">
                        ${perfScore}
                    </span>
                    ${platformLink}
                </div>
                <div class="metrics-platform-card__stats">
                    <span title="Views">&#128065; ${metricsService.formatCount(m.views)}</span>
                    <span title="Likes">&#10084; ${metricsService.formatCount(m.likes)}</span>
                    <span title="Comments">&#128172; ${metricsService.formatCount(m.comments)}</span>
                    <span title="Shares">&#128257; ${metricsService.formatCount(m.shares)}</span>
                    ${(m.saves || 0) > 0 ? `<span title="Saves">&#128278; ${metricsService.formatCount(m.saves)}</span>` : ''}
                </div>
                ${historyRows ? `
                <table class="metrics-platform-card__history">
                    <thead><tr><th>When</th><th>Views</th><th>Likes</th><th>Comments</th></tr></thead>
                    <tbody>${historyRows}</tbody>
                </table>
                ` : ''}
            </div>
        `;
    }).join('');

    const noDataHTML = withoutData.length > 0 ? `
        <div class="metrics-platform-nodata">
            ${withoutData.map(p => `<span class="badge badge--muted badge--xs">${p.platformName}: no data</span>`).join(' ')}
        </div>
    ` : '';

    return `
        ${aggregateHTML}
        <div class="metrics-platform-breakdown">
            <h6 class="metrics-platform-breakdown__title">Per-Platform Breakdown</h6>
            <div class="metrics-platform-cards">
                ${platformCardsHTML}
            </div>
            ${noDataHTML}
        </div>
    `;
}
