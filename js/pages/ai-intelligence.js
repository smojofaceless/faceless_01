/**
 * AI Intelligence Dashboard — Controller
 * Shows how the AI learns from post performance and adapts content generation.
 *
 * Data sources:
 *  - winning_metadata_patterns (cached hooks/tags/CTAs/lengths)
 *  - get_generation_exemplars  (top performers injected into prompts)
 *  - get_negative_exemplars    (bottom performers — patterns to avoid)
 *  - v_post_metrics_latest     (per-post engagement)
 *  - post_metadata_versions    (generation history timeline)
 *  - time_slot_scores          (7×24 engagement heatmap)
 *  - story_dna                 (theme/concept diversity tracking)
 */

const AIIntelligence = (() => {
    let supabase = null;
    let currentBrandId = null;
    let currentPlatform = 'all';

    const PLATFORMS = [
        { key: 'all', label: 'All Platforms' },
        { key: 'youtube_shorts', label: 'YouTube' },
        { key: 'instagram_reels', label: 'Instagram' },
        { key: 'facebook_reels', label: 'Facebook' },
    ];

    // ─── Initialisation ──────────────────────────────────────────────

    async function init() {
        supabase = getSupabaseClient();

        // Initialize sidebar
        if (typeof Sidebar !== 'undefined') {
            new Sidebar();
        }

        // Initialize brand manager
        if (typeof brandManager !== 'undefined' && brandManager.init) {
            await brandManager.init();
        }

        // Resolve active brand
        const activeBrand = brandManager.getActiveBrand();
        currentBrandId = activeBrand?.id;
        if (!currentBrandId) {
            const brands = brandManager.getAll();
            if (brands.length) {
                currentBrandId = brands[0].id;
            }
        }

        // Brand switcher
        if (typeof BrandSwitcher !== 'undefined') {
            const switcher = new BrandSwitcher({
                onSelect: (brandId) => {
                    currentBrandId = brandId;
                    loadAll();
                }
            });
            switcher.init();
        }

        renderPlatformTabs();
        await loadAll();
    }

    function renderPlatformTabs() {
        const container = document.getElementById('platform-tabs');
        if (!container) return;
        container.innerHTML = PLATFORMS.map(p =>
            `<button class="platform-tab${p.key === currentPlatform ? ' platform-tab--active' : ''}"
                     data-platform="${p.key}">${p.label}</button>`
        ).join('');
        container.addEventListener('click', e => {
            const btn = e.target.closest('.platform-tab');
            if (!btn) return;
            currentPlatform = btn.dataset.platform;
            container.querySelectorAll('.platform-tab').forEach(b => b.classList.remove('platform-tab--active'));
            btn.classList.add('platform-tab--active');
            loadAll();
        });
    }

    async function loadAll() {
        if (!currentBrandId) return;
        // load all sections in parallel
        await Promise.all([
            loadStatusBar(),
            loadPerformanceTrend(),
            loadWinningPatterns(),
            loadExemplars(),
            loadTimeSlotHeatmap(),
            loadThemePerformance(),
            loadGenerationHistory(),
        ]);
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    function fmt(n) {
        if (n == null) return '0';
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
        if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
        return String(Math.round(n));
    }

    function platformFilter() {
        return currentPlatform === 'all' ? null : currentPlatform;
    }

    function normalizePlatform(p) {
        if (!p) return p;
        if (p.startsWith('youtube')) return 'youtube_shorts';
        if (p.startsWith('instagram')) return 'instagram_reels';
        if (p.startsWith('facebook')) return 'facebook_reels';
        return p;
    }

    function el(id) {
        return document.getElementById(id);
    }

    // ─── 1. Status Bar ──────────────────────────────────────────────

    async function loadStatusBar() {
        // Count metadata versions (generations)
        let versionQuery = supabase.from('post_metadata_versions').select('id', { count: 'exact', head: true });
        // Count story_dna entries
        let dnaQuery = supabase.from('story_dna').select('id', { count: 'exact', head: true });
        // Count winning patterns
        let patternsQuery = supabase.from('winning_metadata_patterns').select('id', { count: 'exact', head: true })
            .eq('brand_id', currentBrandId);

        const [vRes, dRes, pRes] = await Promise.all([versionQuery, dnaQuery, patternsQuery]);

        const totalGens = vRes.count || 0;
        const totalDna = dRes.count || 0;
        const totalPatterns = pRes.count || 0;

        // Get latest pattern compute time
        const { data: latestPattern } = await supabase
            .from('winning_metadata_patterns')
            .select('computed_at')
            .eq('brand_id', currentBrandId)
            .order('computed_at', { ascending: false })
            .limit(1);

        const lastComputed = latestPattern?.[0]?.computed_at;
        const computedLabel = lastComputed
            ? new Date(lastComputed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : 'Never';

        const bar = el('ai-status-bar');
        if (!bar) return;
        bar.innerHTML = `
            <div class="ai-status-item">
                <svg class="ai-status-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
                <span class="ai-status-item__label">Learning Status</span>
                <span class="ai-status-item__value ai-status-item__value--live">● Active</span>
            </div>
            <div class="ai-status-item">
                <span class="ai-status-item__label">Generations</span>
                <span class="ai-status-item__value">${totalGens}</span>
            </div>
            <div class="ai-status-item">
                <span class="ai-status-item__label">Stories Tracked</span>
                <span class="ai-status-item__value">${totalDna}</span>
            </div>
            <div class="ai-status-item">
                <span class="ai-status-item__label">Pattern Groups</span>
                <span class="ai-status-item__value">${totalPatterns}</span>
            </div>
            <div class="ai-status-item">
                <span class="ai-status-item__label">Last Computed</span>
                <span class="ai-status-item__value">${computedLabel}</span>
            </div>
        `;
    }

    // ─── 2. Performance Trend ────────────────────────────────────────

    async function loadPerformanceTrend() {
        const container = el('performance-trend');
        if (!container) return;
        container.innerHTML = '<div class="ai-loading">Loading performance data…</div>';

        let query = supabase
            .from('v_post_metrics_latest')
            .select('post_id, platform, views, likes, comments, shares, collected_at')
            .order('views', { ascending: false });

        if (platformFilter()) {
            query = query.eq('platform', platformFilter());
        }

        const { data: metrics, error } = await query;
        if (error || !metrics?.length) {
            container.innerHTML = '<div class="ai-empty">No performance data yet. Posts need to be published and metrics collected.</div>';
            return;
        }

        // Compute aggregates
        const totalViews = metrics.reduce((s, m) => s + (m.views || 0), 0);
        const totalLikes = metrics.reduce((s, m) => s + (m.likes || 0), 0);
        const totalComments = metrics.reduce((s, m) => s + (m.comments || 0), 0);
        const avgViews = Math.round(totalViews / metrics.length);

        // Sort by views descending for the bar chart
        const sorted = [...metrics].sort((a, b) => (b.views || 0) - (a.views || 0));
        const maxViews = sorted[0]?.views || 1;

        // Build summary + bar chart
        let html = `
            <div class="trend-summary">
                <div class="trend-stat">
                    <span class="trend-stat__value">${fmt(totalViews)}</span>
                    <span class="trend-stat__label">Total Views</span>
                </div>
                <div class="trend-stat">
                    <span class="trend-stat__value">${fmt(totalLikes)}</span>
                    <span class="trend-stat__label">Total Likes</span>
                </div>
                <div class="trend-stat">
                    <span class="trend-stat__value">${fmt(totalComments)}</span>
                    <span class="trend-stat__label">Total Comments</span>
                </div>
                <div class="trend-stat">
                    <span class="trend-stat__value">${fmt(avgViews)}</span>
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
                        <span class="ai-tooltip">${fmt(p.views)} views · ${p.likes} likes</span>
                    </div>
                    <div class="trend-bar trend-bar--likes" style="height:${likeH}px"></div>
                    <span class="trend-bar__label">${platLabel.charAt(0).toUpperCase()}</span>
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

    // ─── 3. Winning Patterns ─────────────────────────────────────────

    async function loadWinningPatterns() {
        const container = el('winning-patterns');
        if (!container) return;
        container.innerHTML = '<div class="ai-loading">Loading winning patterns…</div>';

        const platform = platformFilter() || 'youtube_shorts';
        const { data, error } = await supabase.rpc('get_winning_patterns', {
            p_brand_id: currentBrandId,
            p_platform: platform,
            p_vibe_preset: null,
        });

        if (error || !data?.length) {
            container.innerHTML = '<div class="ai-empty">No winning patterns computed yet. The system needs published posts with metrics.</div>';
            return;
        }

        const patterns = data[0];
        let html = '';

        // Top Hooks
        if (patterns.top_hooks?.length) {
            html += `<div class="pattern-section">
                <h4 class="pattern-section__title">🎣 Top-Performing Hooks</h4>
                <p style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-2)">Injected into AI prompts as style references</p>
                <ul class="hook-list">`;
            for (let i = 0; i < Math.min(patterns.top_hooks.length, 5); i++) {
                const h = patterns.top_hooks[i];
                html += `
                    <li class="hook-item">
                        <span class="hook-item__rank">#${i + 1}</span>
                        <span class="hook-item__text">${escHtml(h.hook)}</span>
                        <span class="hook-item__perf">${fmt(h.perf)} score</span>
                    </li>`;
            }
            html += '</ul></div>';
        }

        // Top Hashtags
        if (patterns.top_hashtags?.length) {
            html += `<div class="pattern-section">
                <h4 class="pattern-section__title">🏷️ Best Hashtags</h4>
                <div class="tag-cloud">`;
            for (const t of patterns.top_hashtags.slice(0, 12)) {
                html += `<span class="tag-cloud__item">#${escHtml(t.tag)} <span class="tag-cloud__count">×${t.count}</span> <span class="tag-cloud__perf">avg ${fmt(t.avg_perf)}</span></span>`;
            }
            html += '</div></div>';
        }

        // Optimal Lengths
        if (patterns.length_stats) {
            const ls = patterns.length_stats;
            html += `<div class="pattern-section">
                <h4 class="pattern-section__title">📐 Optimal Content Lengths</h4>
                <div class="length-stats">
                    <div class="length-stat">
                        <span class="length-stat__value">${Math.round(ls.avg_title_len || 0)}</span>
                        <span class="length-stat__label">Avg Title Chars</span>
                    </div>
                    <div class="length-stat">
                        <span class="length-stat__value">${Math.round(ls.avg_desc_len || 0)}</span>
                        <span class="length-stat__label">Avg Desc Chars</span>
                    </div>
                    <div class="length-stat">
                        <span class="length-stat__value">${Math.round(ls.avg_tag_count || 0)}</span>
                        <span class="length-stat__label">Avg Tag Count</span>
                    </div>
                </div>
            </div>`;
        }

        // Meta
        html += `<p style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-3)">
            Based on ${patterns.sample_count || 0} posts · Avg performance: ${fmt(patterns.avg_performance || 0)} · 
            Last computed: ${patterns.computed_at ? new Date(patterns.computed_at).toLocaleDateString() : 'N/A'}
        </p>`;

        container.innerHTML = html;
    }

    // ─── 4. Exemplar Library ─────────────────────────────────────────

    async function loadExemplars() {
        const container = el('exemplar-library');
        if (!container) return;
        container.innerHTML = '<div class="ai-loading">Loading exemplars…</div>';

        const platform = platformFilter() || 'youtube_shorts';

        // Fetch top exemplars
        const { data: topExemplars } = await supabase.rpc('get_generation_exemplars', {
            p_brand_id: currentBrandId,
            p_platform: platform,
            p_limit: 5,
        });

        if (!topExemplars?.length) {
            container.innerHTML = '<div class="ai-empty">No exemplars yet. AI needs published posts with engagement data to learn from.</div>';
            return;
        }

        let html = `<p style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:var(--space-3)">
            These posts are injected into every AI prompt as "do this" examples. The AI learns your best-performing style.
        </p>
        <div class="exemplar-list">`;

        // Top performers
        for (const ex of topExemplars.slice(0, 5)) {
            const title = ex.fields?.title || 'Untitled';
            const desc = ex.fields?.description || '';
            const perf = ex.performance_value;
            const tags = ex.fields?.tags?.slice(0, 5)?.join(', ') || '';
            html += `
                <div class="exemplar-card exemplar-card--positive">
                    <div class="exemplar-card__title">
                        ${escHtml(title)}
                        <span class="exemplar-card__badge exemplar-card__badge--top">DO THIS</span>
                    </div>
                    <div class="exemplar-card__desc">${escHtml(desc)}</div>
                    <div class="exemplar-card__meta">
                        ${perf != null ? `<span class="exemplar-card__meta-item">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                            Score: ${fmt(perf)}
                        </span>` : ''}
                        ${tags ? `<span class="exemplar-card__meta-item">${escHtml(tags)}</span>` : ''}
                    </div>
                </div>`;
        }

        html += '</div>';
        container.innerHTML = html;
    }

    // ─── 5. Time Slot Heatmap ────────────────────────────────────────

    async function loadTimeSlotHeatmap() {
        const container = el('timeslot-heatmap');
        if (!container) return;
        container.innerHTML = '<div class="ai-loading">Loading time slot data…</div>';

        const platform = platformFilter() || 'youtube_shorts';

        // Fetch heatmap data
        const { data: slots, error } = await supabase.rpc('get_time_slot_scores', {
            p_brand_id: currentBrandId,
            p_platform: platform,
            p_window_days: 30,
        });

        // Also get best times
        const { data: bestTimes } = await supabase.rpc('get_best_time_slots', {
            p_brand_id: currentBrandId,
            p_platform: platform,
            p_window_days: 30,
            p_limit: 5,
        });

        if (error || !slots?.length) {
            container.innerHTML = '<div class="ai-empty">No time slot data yet. Need published posts with measured engagement.</div>';
            return;
        }

        // Build score map
        const scoreMap = {};
        let maxScore = 1;
        for (const s of slots) {
            const key = `${s.day_of_week}-${s.hour}`;
            scoreMap[key] = s.score || 0;
            if (s.score > maxScore) maxScore = s.score;
        }

        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        // Render heatmap grid — show hours 6-23 (6 AM to 11 PM)
        const startHour = 6;
        const endHour = 23;
        let html = '<div class="heatmap-container"><div class="heatmap" style="grid-template-columns: 60px repeat(' + (endHour - startHour + 1) + ', 1fr)">';

        // Header row
        html += '<div class="heatmap__header"></div>';
        for (let h = startHour; h <= endHour; h++) {
            const label = h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p';
            html += `<div class="heatmap__header">${label}</div>`;
        }

        // Data rows
        for (let d = 0; d < 7; d++) {
            html += `<div class="heatmap__row-label">${days[d]}</div>`;
            for (let h = startHour; h <= endHour; h++) {
                const score = scoreMap[`${d}-${h}`] || 0;
                const ratio = score / maxScore;
                let level = 'empty';
                if (ratio > 0.8) level = 'l5';
                else if (ratio > 0.5) level = 'l4';
                else if (ratio > 0.3) level = 'l3';
                else if (ratio > 0.1) level = 'l2';
                else if (score > 0) level = 'l1';
                const label = h === 0 ? '12 AM' : h < 12 ? h + ' AM' : h === 12 ? '12 PM' : (h - 12) + ' PM';
                html += `<div class="heatmap__cell heatmap__cell--${level}"><span class="ai-tooltip">${days[d]} ${label}: ${Math.round(score)}</span></div>`;
            }
        }

        html += '</div></div>';

        // Legend
        html += `
            <div class="heatmap-legend">
                <span>Less</span>
                <div class="heatmap-legend__scale">
                    <div class="heatmap-legend__block heatmap__cell--empty" style="width:14px;height:14px"></div>
                    <div class="heatmap-legend__block heatmap__cell--l1" style="width:14px;height:14px"></div>
                    <div class="heatmap-legend__block heatmap__cell--l2" style="width:14px;height:14px"></div>
                    <div class="heatmap-legend__block heatmap__cell--l3" style="width:14px;height:14px"></div>
                    <div class="heatmap-legend__block heatmap__cell--l4" style="width:14px;height:14px"></div>
                    <div class="heatmap-legend__block heatmap__cell--l5" style="width:14px;height:14px"></div>
                </div>
                <span>More</span>
            </div>
        `;

        // Best times
        if (bestTimes?.length) {
            html += '<div class="best-times">';
            for (const bt of bestTimes) {
                html += `<span class="best-time-badge">
                    <span class="best-time-badge__day">${bt.day_name}</span>
                    ${bt.hour_label}
                    <span class="best-time-badge__score">score ${Math.round(bt.score)}</span>
                </span>`;
            }
            html += '</div>';
        }

        container.innerHTML = html;
    }

    // ─── 6. Theme / Story DNA Performance ────────────────────────────

    async function loadThemePerformance() {
        const container = el('theme-performance');
        if (!container) return;
        container.innerHTML = '<div class="ai-loading">Loading story DNA…</div>';

        // Get story DNA with vibe preset usage
        const { data: dna, error } = await supabase
            .from('story_dna')
            .select('vibe_preset, threat_type, escalation_type, era_label, brand_id')
            .eq('brand_id', currentBrandId)
            .order('created_at', { ascending: false })
            .limit(200);

        if (error || !dna?.length) {
            container.innerHTML = '<div class="ai-empty">No story DNA data yet. Stories need to be generated first.</div>';
            return;
        }

        // Count vibes
        const vibeCounts = {};
        const threatCounts = {};
        for (const d of dna) {
            const vibe = d.vibe_preset || 'default';
            vibeCounts[vibe] = (vibeCounts[vibe] || 0) + 1;
            const threat = d.threat_type || 'unknown';
            threatCounts[threat] = (threatCounts[threat] || 0) + 1;
        }

        const maxVibe = Math.max(...Object.values(vibeCounts));
        const maxThreat = Math.max(...Object.values(threatCounts));

        let html = '';

        // Vibe presets
        html += '<div class="pattern-section"><h4 class="pattern-section__title">🎭 Vibe Presets Used</h4><div class="theme-list">';
        const sortedVibes = Object.entries(vibeCounts).sort((a, b) => b[1] - a[1]);
        for (const [vibe, count] of sortedVibes) {
            const pct = (count / maxVibe) * 100;
            html += `<div class="theme-row">
                <span class="theme-row__label">${escHtml(vibe.replace(/_/g, ' '))}</span>
                <div class="theme-row__bar-wrap"><div class="theme-row__bar" style="width:${pct}%"></div></div>
                <span class="theme-row__count">${count} stories</span>
            </div>`;
        }
        html += '</div></div>';

        // Threat types
        if (Object.keys(threatCounts).length > 1) {
            html += '<div class="pattern-section"><h4 class="pattern-section__title">⚡ Threat Types</h4><div class="theme-list">';
            const sortedThreats = Object.entries(threatCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
            for (const [threat, count] of sortedThreats) {
                const pct = (count / maxThreat) * 100;
                html += `<div class="theme-row">
                    <span class="theme-row__label">${escHtml(threat.replace(/_/g, ' '))}</span>
                    <div class="theme-row__bar-wrap"><div class="theme-row__bar" style="width:${pct}%"></div></div>
                    <span class="theme-row__count">${count}</span>
                </div>`;
            }
            html += '</div></div>';
        }

        html += `<p style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-top:var(--space-3)">
            ${dna.length} stories analyzed · AI avoids recent themes to maintain diversity
        </p>`;

        container.innerHTML = html;
    }

    // ─── 7. Generation History ───────────────────────────────────────

    async function loadGenerationHistory() {
        const container = el('generation-history');
        if (!container) return;
        container.innerHTML = '<div class="ai-loading">Loading generation history…</div>';

        let query = supabase
            .from('post_metadata_versions')
            .select('id, post_id, platform, version_number, version_type, variant_key, fields, generation_model, created_at')
            .order('created_at', { ascending: false })
            .limit(15);

        if (platformFilter()) {
            query = query.eq('platform', platformFilter());
        }

        const { data: versions, error } = await query;

        if (error || !versions?.length) {
            container.innerHTML = '<div class="ai-empty">No generation history yet.</div>';
            return;
        }

        let html = '<div class="gen-timeline">';
        for (const v of versions) {
            const isEdit = v.version_type === 'manual' || v.version_type === 'edit';
            const title = v.fields?.title || 'Untitled';
            const date = new Date(v.created_at);
            const timeStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
                date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const platLabel = (v.platform || '').replace('_reels', '').replace('_shorts', '');
            const typeLabel = isEdit ? 'Manual edit' : `AI generated${v.generation_model ? ' · ' + v.generation_model : ''}`;
            const variantLabel = v.variant_key ? ` · Variant: ${v.variant_key}` : '';

            html += `
                <div class="gen-event">
                    <div class="gen-event__dot${isEdit ? ' gen-event__dot--edit' : ''}"></div>
                    <div class="gen-event__time">${timeStr} · ${platLabel}${variantLabel}</div>
                    <div class="gen-event__title">${escHtml(title)}</div>
                    <div class="gen-event__detail">v${v.version_number} · ${typeLabel}</div>
                </div>`;
        }
        html += '</div>';

        container.innerHTML = html;
    }

    // ─── Utilities ───────────────────────────────────────────────────

    function escHtml(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // ─── Public API ──────────────────────────────────────────────────

    return { init };
})();

document.addEventListener('DOMContentLoaded', () => AIIntelligence.init());
