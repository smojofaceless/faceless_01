// =====================================================
// METRICS SERVICE
// Frontend service for post engagement metrics
// Wraps Supabase RPCs from metrics collection v1
// =====================================================

class MetricsService {
    constructor() {
        this._initialized = false;
        this._supabase = null;
        this._cache = new Map(); // postId -> { data, fetchedAt }
        this._cacheTTL = 5 * 60 * 1000; // 5 min cache
    }

    /**
     * Initialize the service
     */
    async init() {
        if (this._initialized) return;
        
        if (typeof window.supabaseClient !== 'undefined') {
            this._supabase = window.supabaseClient;
        } else if (typeof supabase !== 'undefined') {
            this._supabase = supabase;
        }

        if (!this._supabase) {
            console.warn('MetricsService: No Supabase client available');
            return;
        }

        this._initialized = true;
        console.log('📊 MetricsService initialized');
    }

    /**
     * Get latest metrics for a single post
     * @param {string} postId
     * @returns {Promise<Object|null>}
     */
    async getLatestMetrics(postId) {
        if (!this._supabase) return null;

        // Check cache
        const cached = this._cache.get(postId);
        if (cached && Date.now() - cached.fetchedAt < this._cacheTTL) {
            return cached.data;
        }

        try {
            const { data, error } = await this._supabase
                .rpc('get_latest_metrics', { p_post_id: postId });

            if (error) {
                console.error('MetricsService.getLatestMetrics error:', error.message);
                return null;
            }

            const result = data && data.length > 0 ? data[0] : null;
            this._cache.set(postId, { data: result, fetchedAt: Date.now() });
            return result;
        } catch (e) {
            console.error('MetricsService.getLatestMetrics error:', e);
            return null;
        }
    }

    /**
     * Get latest metrics for multiple posts (batch)
     * @param {string[]} postIds
     * @returns {Promise<Map<string, Object>>}
     */
    async getLatestMetricsBatch(postIds) {
        if (!this._supabase || !postIds || postIds.length === 0) return new Map();

        // Filter out cached results
        const uncached = [];
        const result = new Map();

        for (const id of postIds) {
            const cached = this._cache.get(id);
            if (cached && Date.now() - cached.fetchedAt < this._cacheTTL) {
                if (cached.data) result.set(id, cached.data);
            } else {
                uncached.push(id);
            }
        }

        if (uncached.length === 0) return result;

        try {
            const { data, error } = await this._supabase
                .rpc('get_latest_metrics_batch', { p_post_ids: uncached });

            if (error) {
                console.error('MetricsService.getLatestMetricsBatch error:', error.message);
                return result;
            }

            if (data) {
                for (const row of data) {
                    result.set(row.post_id, row);
                    this._cache.set(row.post_id, { data: row, fetchedAt: Date.now() });
                }
            }

            // Cache null for posts with no metrics
            for (const id of uncached) {
                if (!result.has(id)) {
                    this._cache.set(id, { data: null, fetchedAt: Date.now() });
                }
            }

            return result;
        } catch (e) {
            console.error('MetricsService.getLatestMetricsBatch error:', e);
            return result;
        }
    }

    /**
     * Get metrics time-series for a post
     * @param {string} postId
     * @param {Object} options - { since, until, limit }
     * @returns {Promise<Array>}
     */
    async getPostMetrics(postId, options = {}) {
        if (!this._supabase) return [];

        try {
            const { data, error } = await this._supabase
                .rpc('get_post_metrics', {
                    p_post_id: postId,
                    p_since: options.since || null,
                    p_until: options.until || null,
                    p_limit: options.limit || 100,
                });

            if (error) {
                console.error('MetricsService.getPostMetrics error:', error.message);
                return [];
            }

            return data || [];
        } catch (e) {
            console.error('MetricsService.getPostMetrics error:', e);
            return [];
        }
    }

    /**
     * Get aggregate metrics for a job (all platforms)
     * @param {string} jobId
     * @returns {Promise<Object|null>}
     */
    async getJobMetrics(jobId) {
        if (!this._supabase) return null;

        try {
            const { data, error } = await this._supabase
                .rpc('get_job_metrics', { p_job_id: jobId });

            if (error) {
                console.error('MetricsService.getJobMetrics error:', error.message);
                return null;
            }

            return data && data.length > 0 ? data[0] : null;
        } catch (e) {
            console.error('MetricsService.getJobMetrics error:', e);
            return null;
        }
    }

    /**
     * Get aggregate metrics for a campaign
     * @param {string} batchId
     * @returns {Promise<Object|null>}
     */
    async getCampaignMetrics(batchId) {
        if (!this._supabase) return null;

        try {
            const { data, error } = await this._supabase
                .rpc('get_campaign_metrics', { p_batch_id: batchId });

            if (error) {
                console.error('MetricsService.getCampaignMetrics error:', error.message);
                return null;
            }

            return data && data.length > 0 ? data[0] : null;
        } catch (e) {
            console.error('MetricsService.getCampaignMetrics error:', e);
            return null;
        }
    }

    /**
     * Format a number for display (1234 → "1.2K")
     * @param {number} num
     * @returns {string}
     */
    formatCount(num) {
        if (num == null || isNaN(num)) return '0';
        if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
        return String(num);
    }

    /**
     * Format "time ago" from a timestamp
     * @param {string|Date} timestamp
     * @returns {string}
     */
    formatTimeAgo(timestamp) {
        if (!timestamp) return 'never';
        const diff = Date.now() - new Date(timestamp).getTime();
        const mins = Math.floor(diff / 60_000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    /**
     * Build a compact metrics badge HTML string
     * @param {Object} metrics - { views, likes, comments }
     * @returns {string}
     */
    buildBadgeHTML(metrics) {
        if (!metrics) return '';
        const views = this.formatCount(metrics.views);
        return `<span class="metrics-badge" title="Views: ${metrics.views || 0} | Likes: ${metrics.likes || 0} | Comments: ${metrics.comments || 0}">&#128065; ${views}</span>`;
    }

    /**
     * Build a metrics detail section HTML for modals
     * @param {Object} latest - Latest metrics snapshot
     * @param {Array} history - Time-series data
     * @returns {string}
     */
    buildDetailHTML(latest, history = []) {
        if (!latest && history.length === 0) {
            return `
                <div class="metrics-detail">
                    <div class="metrics-detail__header">
                        <h5>Engagement Metrics</h5>
                        <span class="badge badge--muted badge--xs">no data</span>
                    </div>
                    <p class="metrics-detail__empty">Metrics will appear after the post has been collected.</p>
                </div>
            `;
        }

        const m = latest || {};
        const collectedLabel = m.collected_at ? this.formatTimeAgo(m.collected_at) : 'N/A';

        // Stats cards
        const statsHTML = `
            <div class="metrics-stats">
                <div class="metrics-stat">
                    <span class="metrics-stat__value">${this.formatCount(m.views)}</span>
                    <span class="metrics-stat__label">Views</span>
                </div>
                <div class="metrics-stat">
                    <span class="metrics-stat__value">${this.formatCount(m.likes)}</span>
                    <span class="metrics-stat__label">Likes</span>
                </div>
                <div class="metrics-stat">
                    <span class="metrics-stat__value">${this.formatCount(m.comments)}</span>
                    <span class="metrics-stat__label">Comments</span>
                </div>
                <div class="metrics-stat">
                    <span class="metrics-stat__value">${this.formatCount(m.shares)}</span>
                    <span class="metrics-stat__label">Shares</span>
                </div>
                ${m.saves > 0 ? `
                <div class="metrics-stat">
                    <span class="metrics-stat__value">${this.formatCount(m.saves)}</span>
                    <span class="metrics-stat__label">Saves</span>
                </div>
                ` : ''}
            </div>
        `;

        // History table (last 10 entries)
        let historyHTML = '';
        if (history.length > 0) {
            historyHTML = `
                <div class="metrics-history">
                    <h6 class="metrics-history__title">Collection History</h6>
                    <table class="metrics-history__table">
                        <thead>
                            <tr>
                                <th>Collected</th>
                                <th>Age</th>
                                <th>Views</th>
                                <th>Likes</th>
                                <th>Comments</th>
                                <th>Shares</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${history.slice(0, 10).map(h => `
                                <tr${h.error ? ' class="metrics-history__row--error"' : ''}>
                                    <td>${this.formatTimeAgo(h.collected_at)}</td>
                                    <td>${h.post_age_hours ? Math.round(h.post_age_hours) + 'h' : '—'}</td>
                                    <td>${this.formatCount(h.views)}</td>
                                    <td>${this.formatCount(h.likes)}</td>
                                    <td>${this.formatCount(h.comments)}</td>
                                    <td>${this.formatCount(h.shares)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        return `
            <div class="metrics-detail">
                <div class="metrics-detail__header">
                    <h5>Engagement Metrics</h5>
                    <span class="badge badge--success badge--xs" title="Last collected: ${collectedLabel}">
                        &#128200; ${collectedLabel}
                    </span>
                </div>
                ${statsHTML}
                ${historyHTML}
            </div>
        `;
    }

    /**
     * Clear the metrics cache
     */
    clearCache() {
        this._cache.clear();
    }
}

// Export global singleton
window.metricsService = new MetricsService();
