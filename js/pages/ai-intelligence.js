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

    let currentTab = 'overview';

    const PLATFORMS = [
        { key: 'all', label: 'All Platforms' },
        { key: 'youtube_shorts', label: 'YouTube' },
        { key: 'instagram_reels', label: 'Instagram' },
        { key: 'facebook_reels', label: 'Facebook' },
    ];

    const PLATFORM_LABELS = {
        youtube_shorts: 'YouTube', youtube: 'YouTube',
        instagram_reels: 'Instagram', instagram: 'Instagram',
        facebook_reels: 'Facebook', facebook: 'Facebook',
        tiktok: 'TikTok', threads: 'Threads',
    };

    const PLATFORM_SHORT = {
        youtube_shorts: 'YT', youtube: 'YT',
        instagram_reels: 'IG', instagram: 'IG',
        facebook_reels: 'FB', facebook: 'FB',
        tiktok: 'TT', threads: 'TH',
    };

    const PLATFORM_COLORS = {
        youtube_shorts: '#cc0000', youtube: '#cc0000',
        instagram_reels: '#c13584', instagram: '#c13584',
        facebook_reels: '#1877f2', facebook: '#1877f2',
        tiktok: '#ff0050', threads: '#6b7280',
    };

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
        renderSectionTabs();
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

    function renderSectionTabs() {
        const container = document.getElementById('ai-section-tabs');
        if (!container) return;
        container.addEventListener('click', e => {
            const btn = e.target.closest('.ai-section-tab');
            if (!btn) return;
            const tab = btn.dataset.tab;
            if (tab === currentTab) return;
            currentTab = tab;
            container.querySelectorAll('.ai-section-tab').forEach(b => b.classList.remove('ai-section-tab--active'));
            btn.classList.add('ai-section-tab--active');
            document.querySelectorAll('.ai-tab-panel').forEach(p => p.classList.remove('ai-tab-panel--active'));
            const panel = document.getElementById('tab-' + tab);
            if (panel) panel.classList.add('ai-tab-panel--active');
            loadAll();
        });
    }

    async function loadAll() {
        if (!currentBrandId) return;

        // Always load status bar
        await loadStatusBar();

        if (currentTab === 'overview') {
            await Promise.all([
                loadPerformanceTrend(),
                loadWinningPatterns(),
                loadExemplars(),
                loadTimeSlotHeatmap(),
                loadThemePerformance(),
                loadGenerationHistory(),
            ]);
        } else if (currentTab === 'recent-posts') {
            await loadRecentPostInsights();
        } else if (currentTab === 'cross-platform') {
            await Promise.all([
                loadCrossPlatformComparison(),
                loadStrategyPerformance(),
            ]);
        }
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
                    <span class="trend-bar__label">${PLATFORM_SHORT[p.platform] || platLabel.charAt(0).toUpperCase()}</span>
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

        // Get story DNA with genre (vibe preset) usage
        // Columns: genre (not vibe_preset), threat_id (not threat_type),
        //          escalation_id (not escalation_type), era_label, brand_id
        const { data: dna, error } = await supabase
            .from('story_dna')
            .select('genre, threat_id, escalation_id, era_label, brand_id')
            .eq('brand_id', currentBrandId)
            .order('created_at', { ascending: false })
            .limit(200);

        if (error) {
            console.error('[AI Intelligence] Story DNA query error:', error);
            container.innerHTML = '<div class="ai-empty">Error loading story DNA data.</div>';
            return;
        }
        if (!dna?.length) {
            container.innerHTML = '<div class="ai-empty">No story DNA data yet. Stories need to be generated first.</div>';
            return;
        }

        // Count vibes (genre column stores the vibe preset value)
        const vibeCounts = {};
        const threatCounts = {};
        for (const d of dna) {
            const vibe = d.genre || 'default';
            vibeCounts[vibe] = (vibeCounts[vibe] || 0) + 1;
            const threat = d.threat_id || 'unknown';
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
            const platLabel = PLATFORM_LABELS[v.platform] || (v.platform || '').replace('_reels', '').replace('_shorts', '');
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

    // ─── AI Brain Helpers ────────────────────────────────────────────

    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    function formatHour(h) {
        if (h === 0) return '12am';
        if (h < 12) return h + 'am';
        if (h === 12) return '12pm';
        return (h - 12) + 'pm';
    }

    function classifyHook(title) {
        if (!title) return { type: 'unknown', label: 'Unknown' };
        const t = title.trim();
        if (/^\d+\s/.test(t)) return { type: 'number', label: 'Number-Intrigue' };
        if (/^(why|what|who|how|where|when)\b/i.test(t) || /\?\s*\S{0,4}$/.test(t))
            return { type: 'question', label: 'Question-Hook' };
        if (/^(whisper|shadow|the\s+(un|dark|last|forgotten|lost|hidden))/i.test(t))
            return { type: 'atmospheric', label: 'Atmospheric' };
        return { type: 'statement', label: 'Statement' };
    }

    function escHtml(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // ─── 8. Recent Post Insights (AI Brain View) ─────────────────────

    async function loadRecentPostInsights() {
        const container = el('recent-posts-container');
        if (!container) return;
        container.innerHTML = '<div class="ai-loading">Analyzing post performance data…</div>';

        try {
            // ── Fetch posts (last 90 posts to cover ~30 days) ──
            let postQuery = supabase.from('posts')
                .select('id, title, description, tags, platform, status, posted_at, video_url, job_id, meta, batch_id')
                .eq('brand_id', currentBrandId).eq('status', 'posted')
                .order('posted_at', { ascending: false }).limit(90);
            if (platformFilter()) postQuery = postQuery.eq('platform', platformFilter());

            const { data: posts, error: postErr } = await postQuery;
            if (postErr || !posts?.length) {
                container.innerHTML = '<div class="ai-empty">No posted content yet. Publish some posts to see the AI brain at work.</div>';
                return;
            }

            // ── Parallel data fetch: metrics + patterns + exemplars + time slots ──
            const postIds = posts.map(p => p.id);
            const plat = platformFilter() || 'youtube_shorts';

            const [metricsRes, patternsRes, exemplarsRes, timeSlotsRes] = await Promise.all([
                supabase.from('v_post_metrics_latest')
                    .select('post_id, platform, views, likes, comments, shares, saves, collected_at')
                    .in('post_id', postIds),
                supabase.rpc('get_winning_patterns', {
                    p_brand_id: currentBrandId, p_platform: plat, p_vibe_preset: null,
                }),
                supabase.rpc('get_generation_exemplars', {
                    p_brand_id: currentBrandId, p_platform: plat, p_limit: 5,
                }),
                supabase.from('time_slot_scores')
                    .select('day_of_week, hour, score, post_count')
                    .eq('brand_id', currentBrandId)
                    .eq('platform', plat)
                    .order('score', { ascending: false })
                    .limit(5),
            ]);

            const metricsMap = {};
            for (const m of (metricsRes.data || [])) metricsMap[m.post_id] = m;

            // ── Build story groups (by job_id) ──
            const jobGroups = {};
            for (const p of posts) {
                const key = p.job_id || p.id;
                if (!jobGroups[key]) {
                    jobGroups[key] = {
                        title: p.title, description: p.description || '',
                        tags: p.tags || [], posts: [],
                        totalViews: 0, totalLikes: 0, totalComments: 0, totalShares: 0,
                        earliestPosted: p.posted_at, meta: p.meta,
                    };
                }
                const m = metricsMap[p.id];
                jobGroups[key].posts.push({ ...p, metrics: m || null });
                if (m) {
                    jobGroups[key].totalViews += m.views || 0;
                    jobGroups[key].totalLikes += m.likes || 0;
                    jobGroups[key].totalComments += m.comments || 0;
                    jobGroups[key].totalShares += m.shares || 0;
                }
            }

            const patterns = patternsRes.data?.[0] || null;
            const exemplars = Array.isArray(exemplarsRes.data) ? exemplarsRes.data : [];
            const topTimeSlots = timeSlotsRes.data || [];

            // ── Brand-wide averages ──
            const allGroups = Object.values(jobGroups);
            const withMetrics = allGroups.filter(g => g.totalViews > 0 || g.totalLikes > 0);
            const brandAvg = {
                views: withMetrics.length ? Math.round(withMetrics.reduce((s, g) => s + g.totalViews, 0) / withMetrics.length) : 0,
                likes: withMetrics.length ? Math.round(withMetrics.reduce((s, g) => s + g.totalLikes, 0) / withMetrics.length) : 0,
                comments: withMetrics.length ? Math.round(withMetrics.reduce((s, g) => s + g.totalComments, 0) / withMetrics.length) : 0,
            };

            // ── Hook pattern stats ──
            const hookPatternPerf = {};
            for (const h of (patterns?.top_hooks || [])) {
                const cls = classifyHook(h.hook);
                if (!hookPatternPerf[cls.type]) hookPatternPerf[cls.type] = { label: cls.label, total: 0, count: 0, best: null };
                hookPatternPerf[cls.type].total += h.perf || 0;
                hookPatternPerf[cls.type].count++;
                if (!hookPatternPerf[cls.type].best || h.perf > hookPatternPerf[cls.type].best.perf) {
                    hookPatternPerf[cls.type].best = h;
                }
            }
            for (const p of Object.values(hookPatternPerf)) p.avg = Math.round(p.total / p.count);
            let bestHookType = null;
            for (const [type, data] of Object.entries(hookPatternPerf)) {
                if (!bestHookType || data.avg > hookPatternPerf[bestHookType].avg) bestHookType = type;
            }

            // Exemplar pool threshold
            const exemplarPerfs = exemplars.map(e => e.performance_value).sort((a, b) => b - a);
            const exemplarThreshold = exemplarPerfs.length >= 5 ? exemplarPerfs[exemplarPerfs.length - 1] : 0;

            // Tag performance lookup
            const winTagMap = {};
            for (const wt of (patterns?.top_hashtags || [])) {
                winTagMap[wt.tag.toLowerCase()] = wt;
            }

            // ╔══════════════════════════════════════════════════════════╗
            // ║  LAYER 1: DAILY PERFORMANCE CHART (last 30 days)       ║
            // ╚══════════════════════════════════════════════════════════╝

            // Aggregate views by date + platform
            const dailyData = {};  // { 'YYYY-MM-DD': { youtube_shorts: N, instagram_reels: N, ... } }
            const platformsSeen = new Set();

            for (const p of posts) {
                if (!p.posted_at) continue;
                const dateKey = p.posted_at.split('T')[0];
                const m = metricsMap[p.id];
                const views = m ? (m.views || 0) : 0;
                const plf = p.platform || 'unknown';
                platformsSeen.add(plf);

                if (!dailyData[dateKey]) dailyData[dateKey] = {};
                dailyData[dateKey][plf] = (dailyData[dateKey][plf] || 0) + views;
            }

            // Build sorted date range (last 30 days that have data, or all dates)
            const allDates = Object.keys(dailyData).sort();
            const chartDates = allDates.slice(-30);
            const platformList = [...platformsSeen].sort();

            // Find max daily total for scaling
            let maxDayTotal = 0;
            let grandTotal = 0;
            for (const d of chartDates) {
                const dayTotal = Object.values(dailyData[d]).reduce((s, v) => s + v, 0);
                if (dayTotal > maxDayTotal) maxDayTotal = dayTotal;
                grandTotal += dayTotal;
            }

            let html = '';

            // Summary bar
            html += `
                <div class="insights-summary">
                    <div class="insights-summary__stat">
                        <span class="insights-summary__value">${allGroups.length}</span>
                        <span class="insights-summary__label">Stories Analyzed</span>
                    </div>
                    <div class="insights-summary__stat">
                        <span class="insights-summary__value">${fmt(brandAvg.views)}</span>
                        <span class="insights-summary__label">Avg Views</span>
                    </div>
                    <div class="insights-summary__stat">
                        <span class="insights-summary__value">${exemplars.length}/5</span>
                        <span class="insights-summary__label">Exemplar Pool</span>
                    </div>
                    <div class="insights-summary__stat">
                        <span class="insights-summary__value">${fmt(exemplarThreshold)}</span>
                        <span class="insights-summary__label">Exemplar Min</span>
                    </div>
                </div>`;

            // Daily chart
            html += `<div class="daily-perf">
                <div class="daily-perf__header">
                    <h3 class="daily-perf__title">Daily Views by Platform</h3>
                    <span class="daily-perf__total">Last ${chartDates.length} days &middot; <strong>${fmt(grandTotal)}</strong> total views</span>
                </div>`;

            if (chartDates.length === 0 || maxDayTotal === 0) {
                html += '<div class="daily-perf__no-data">No view data available yet. Metrics are collected after posts are published.</div>';
            } else {
                html += '<div class="daily-perf__chart">';
                for (const date of chartDates) {
                    const dayData = dailyData[date];
                    const dayTotal = Object.values(dayData).reduce((s, v) => s + v, 0);
                    const d = new Date(date + 'T12:00:00');
                    const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                    // Tooltip content
                    let tooltipRows = `<div class="daily-perf__tooltip-row"><strong>${dateLabel}</strong> — ${fmt(dayTotal)} views</div>`;
                    for (const plf of platformList) {
                        const v = dayData[plf] || 0;
                        if (v > 0) {
                            const color = PLATFORM_COLORS[plf] || '#6b7280';
                            const label = PLATFORM_LABELS[plf] || plf;
                            tooltipRows += `<div class="daily-perf__tooltip-row">
                                <span class="daily-perf__tooltip-dot" style="background:${color}"></span>
                                ${label}: ${fmt(v)}
                            </div>`;
                        }
                    }

                    // Bar segments (bottom-to-top)
                    let segmentsHTML = '';
                    for (const plf of platformList) {
                        const v = dayData[plf] || 0;
                        if (v > 0) {
                            const h = Math.max(2, (v / maxDayTotal) * 160);
                            segmentsHTML += `<div class="daily-perf__segment daily-perf__segment--${plf}" style="height:${h}px" title="${PLATFORM_LABELS[plf] || plf}: ${fmt(v)}"></div>`;
                        }
                    }

                    html += `
                        <div class="daily-perf__bar-group">
                            <div class="daily-perf__tooltip">${tooltipRows}</div>
                            <div class="daily-perf__bar-stack">${segmentsHTML}</div>
                            <span class="daily-perf__date">${dateLabel}</span>
                        </div>`;
                }
                html += '</div>';  // close chart

                // Legend
                html += '<div class="daily-perf__legend">';
                for (const plf of platformList) {
                    html += `<span class="daily-perf__legend-item">
                        <span class="daily-perf__legend-dot daily-perf__legend-dot--${plf}"></span>
                        ${PLATFORM_LABELS[plf] || plf}
                    </span>`;
                }
                html += '</div>';
            }

            html += '</div>';  // close daily-perf

            // ╔══════════════════════════════════════════════════════════╗
            // ║  LAYER 2: TOP 5 PERFORMERS (sorted by perf score)      ║
            // ╚══════════════════════════════════════════════════════════╝

            const scoredGroups = Object.entries(jobGroups).map(([jobId, group]) => {
                const perfScore = group.totalViews + 5 * group.totalLikes + 10 * group.totalComments + 10 * group.totalShares;
                return { jobId, group, perfScore };
            }).filter(g => g.perfScore > 0)
              .sort((a, b) => b.perfScore - a.perfScore)
              .slice(0, 5);

            const avgPerfScore = brandAvg.views + 5 * brandAvg.likes + 10 * brandAvg.comments;

            html += `<div class="top-performers">
                <div class="top-performers__header">
                    <h3 class="top-performers__title">&#127942; Top Performers</h3>
                    <span class="top-performers__subtitle">Ranked by composite performance score &middot; AI brain analysis per story</span>
                </div>`;

            if (!scoredGroups.length) {
                html += '<div class="ai-empty">No performance data yet. Posts need metrics before ranking.</div>';
            }

            html += '<div class="insights-list">';

            for (let rank = 0; rank < scoredGroups.length; rank++) {
                const { jobId, group, perfScore } = scoredGroups[rank];
                const posted = new Date(group.earliestPosted);
                const dateStr = posted.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const timeStr = posted.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                const vibePreset = group.meta?.vibe_preset || 'default';

                let perfTier, perfClass, perfIcon;
                if (avgPerfScore === 0 || perfScore >= avgPerfScore * 1.3) {
                    perfTier = 'Above Average'; perfClass = 'perf--high'; perfIcon = '&#9650;';
                } else if (perfScore >= avgPerfScore * 0.7) {
                    perfTier = 'Average'; perfClass = 'perf--mid'; perfIcon = '&#9644;';
                } else {
                    perfTier = 'Below Average'; perfClass = 'perf--low'; perfIcon = '&#9660;';
                }

                // Outlier multiplier
                const multiplier = avgPerfScore > 0 ? (perfScore / avgPerfScore) : 0;
                const outlierBadge = multiplier >= 1.5
                    ? `<span class="outlier-badge">${multiplier.toFixed(1)}× avg</span>`
                    : '';

                // ──────────────────────────────────────────────────────────
                // AI BRAIN: per-story analysis
                // ──────────────────────────────────────────────────────────
                const postHook = classifyHook(group.title);
                const postTagSet = new Set((group.tags).map(t => t.toLowerCase()));
                const postDescLen = group.description.length;

                // ── 1. AI SIGNAL ──
                let signalHTML = '';
                const viewRatio = brandAvg.views > 0 ? group.totalViews / brandAvg.views : 0;
                const engRate = group.totalViews > 0
                    ? ((group.totalLikes + group.totalComments) / group.totalViews * 100) : 0;
                const avgEngRate = brandAvg.views > 0
                    ? ((brandAvg.likes + brandAvg.comments) / brandAvg.views * 100) : 0;

                if (group.totalViews > 0 || group.totalLikes > 0) {
                    const viewPct = brandAvg.views > 0
                        ? (viewRatio >= 1 ? `+${Math.round((viewRatio - 1) * 100)}%` : `${Math.round((viewRatio - 1) * 100)}%`)
                        : 'no baseline';
                    signalHTML = `
                        <div class="ai-brain-block ai-brain-block--signal">
                            <div class="ai-brain-block__header">
                                <span class="ai-brain-block__icon">◉</span>
                                <span class="ai-brain-block__title">AI Signal</span>
                            </div>
                            <div class="ai-brain-block__content">
                                <span class="ai-brain-datum">${fmt(group.totalViews)} views <em>(${viewPct} vs brand avg ${fmt(brandAvg.views)})</em></span>
                                <span class="ai-brain-datum">Engagement rate: ${engRate.toFixed(1)}%${avgEngRate > 0 ? ` <em>(brand avg ${avgEngRate.toFixed(1)}%)</em>` : ''}</span>
                                ${group.totalShares > 0 ? `<span class="ai-brain-datum">${group.totalShares} shares — content is being redistributed by viewers</span>` : ''}
                                <span class="ai-brain-datum">Perf score: ${fmt(perfScore)} · Exemplar entry: ${fmt(exemplarThreshold)} → ${perfScore >= exemplarThreshold ? '<strong class="ai-brain-hit">QUALIFIES</strong>' : '<strong class="ai-brain-miss">BELOW THRESHOLD</strong>'}</span>
                            </div>
                        </div>`;
                } else {
                    signalHTML = `
                        <div class="ai-brain-block ai-brain-block--signal">
                            <div class="ai-brain-block__header">
                                <span class="ai-brain-block__icon">◉</span>
                                <span class="ai-brain-block__title">AI Signal</span>
                            </div>
                            <div class="ai-brain-block__content">
                                <span class="ai-brain-datum ai-brain-datum--dim">Awaiting first metrics collection cycle. No signal to process yet.</span>
                            </div>
                        </div>`;
                }

                // ── 2. PATTERN ANALYSIS ──
                const patternItems = [];
                const thisPatternData = hookPatternPerf[postHook.type];
                const bestPatternData = bestHookType ? hookPatternPerf[bestHookType] : null;

                if (thisPatternData && bestPatternData) {
                    if (postHook.type === bestHookType) {
                        patternItems.push(`<div class="ai-brain-pattern ai-brain-pattern--match">
                            <strong>HOOK →</strong> "${escHtml(group.title.slice(0, 70))}" uses <em>${postHook.label}</em> pattern.
                            This IS the top-performing format — avg ${fmt(thisPatternData.avg)} views across ${thisPatternData.count} tracked posts.
                        </div>`);
                    } else {
                        patternItems.push(`<div class="ai-brain-pattern ai-brain-pattern--mismatch">
                            <strong>HOOK →</strong> "${escHtml(group.title.slice(0, 70))}" uses <em>${postHook.label}</em> pattern (avg ${fmt(thisPatternData.avg)} views).
                            The data shows <em>${bestPatternData.label}</em> outperforms at avg ${fmt(bestPatternData.avg)} views.
                        </div>`);
                    }
                } else if (patterns?.top_hooks?.length) {
                    const topHook = patterns.top_hooks[0];
                    patternItems.push(`<div class="ai-brain-pattern ai-brain-pattern--neutral">
                        <strong>HOOK →</strong> "${escHtml(group.title.slice(0, 70))}" uses <em>${postHook.label}</em> pattern.
                        No historical data for this style yet. Current #1 hook: "${escHtml(topHook.hook.slice(0, 60))}" at ${fmt(topHook.perf)} views.
                    </div>`);
                }

                // Tag overlap
                const matchedTags = [];
                const missedTopTags = [];
                for (const wt of (patterns?.top_hashtags || []).slice(0, 8)) {
                    if (postTagSet.has(wt.tag.toLowerCase())) {
                        matchedTags.push(wt);
                    } else {
                        missedTopTags.push(wt);
                    }
                }
                const topTagCount = (patterns?.top_hashtags || []).slice(0, 8).length;
                if (topTagCount > 0) {
                    let tagLine = `<div class="ai-brain-pattern${matchedTags.length >= topTagCount * 0.6 ? ' ai-brain-pattern--match' : matchedTags.length <= topTagCount * 0.3 ? ' ai-brain-pattern--mismatch' : ' ai-brain-pattern--neutral'}">
                        <strong>TAGS →</strong> ${matchedTags.length}/${topTagCount} top-performing tags present.`;
                    if (matchedTags.length) {
                        tagLine += `<br><span class="ai-tag-label ai-tag-label--hit">Using:</span> ${matchedTags.map(t => `<code>#${t.tag}</code> <em>(avg ${fmt(t.avg_perf)})</em>`).join(', ')}`;
                    }
                    if (missedTopTags.length) {
                        tagLine += `<br><span class="ai-tag-label ai-tag-label--miss">Missing:</span> ${missedTopTags.slice(0, 3).map(t => `<code>#${t.tag}</code> <em>(avg ${fmt(t.avg_perf)})</em>`).join(', ')}`;
                    }
                    tagLine += '</div>';
                    patternItems.push(tagLine);
                }

                // Description length
                if (patterns?.length_stats?.avg_desc_len) {
                    const optLen = Math.round(patterns.length_stats.avg_desc_len);
                    const delta = postDescLen - optLen;
                    const pct = optLen > 0 ? Math.round(Math.abs(delta) / optLen * 100) : 0;
                    let descClass = Math.abs(pct) <= 20 ? 'ai-brain-pattern--match' : 'ai-brain-pattern--mismatch';
                    patternItems.push(`<div class="ai-brain-pattern ${descClass}">
                        <strong>LENGTH →</strong> Description: ${postDescLen} chars (winning avg: ~${optLen}).
                        ${pct <= 20 ? 'Within optimal range.' :
                          delta > 0 ? `${pct}% longer than top performers.` :
                          `${pct}% shorter than top performers.`}
                    </div>`);
                }

                // Posting time
                const dow = posted.getDay();
                const hour = posted.getHours();
                const bestSlot = topTimeSlots[0];
                const thisSlot = topTimeSlots.find(s => s.day_of_week === dow && s.hour === hour);
                if (bestSlot) {
                    if (thisSlot) {
                        patternItems.push(`<div class="ai-brain-pattern ai-brain-pattern--match">
                            <strong>TIMING →</strong> Posted ${DAY_NAMES[dow]} ${formatHour(hour)} —
                            top-performing time slot (score: ${thisSlot.score}).
                        </div>`);
                    } else {
                        patternItems.push(`<div class="ai-brain-pattern ai-brain-pattern--mismatch">
                            <strong>TIMING →</strong> Posted ${DAY_NAMES[dow]} ${formatHour(hour)}.
                            Best slot: <strong>${DAY_NAMES[bestSlot.day_of_week]} ${formatHour(bestSlot.hour)}</strong> (score: ${bestSlot.score}).
                        </div>`);
                    }
                }

                const patternHTML = patternItems.length ? `
                    <div class="ai-brain-block ai-brain-block--patterns">
                        <div class="ai-brain-block__header">
                            <span class="ai-brain-block__icon">⧉</span>
                            <span class="ai-brain-block__title">Pattern Analysis</span>
                        </div>
                        <div class="ai-brain-block__content">${patternItems.join('')}</div>
                    </div>` : '';

                // ── 3. AI DECISION LOG ──
                const decisions = [];

                if (perfScore > 0) {
                    if (perfScore >= exemplarThreshold || exemplars.length < 5) {
                        const rankInPool = exemplarPerfs.filter(p => p >= perfScore).length + 1;
                        decisions.push(`<div class="ai-brain-decision ai-brain-decision--promote">
                            <span class="ai-brain-badge ai-brain-badge--promote">✓ PROMOTE TO EXEMPLAR</span>
                            Qualifies for exemplar pool at rank #${rankInPool}/${exemplars.length} (perf ${fmt(perfScore)} exceeds threshold ${fmt(exemplarThreshold)}).
                        </div>`);
                    } else {
                        decisions.push(`<div class="ai-brain-decision ai-brain-decision--demote">
                            <span class="ai-brain-badge ai-brain-badge--demote">↓ BELOW EXEMPLAR THRESHOLD</span>
                            Perf score ${fmt(perfScore)} below pool minimum (${fmt(exemplarThreshold)}).
                        </div>`);
                    }

                    if (perfTier === 'Below Average') {
                        decisions.push(`<div class="ai-brain-decision ai-brain-decision--negative">
                            <span class="ai-brain-badge ai-brain-badge--negative">✗ NEGATIVE SIGNAL</span>
                            Flagged for "patterns to avoid" pool.
                        </div>`);
                    }
                }

                if (postHook.type !== bestHookType && bestPatternData && thisPatternData) {
                    decisions.push(`<div class="ai-brain-decision ai-brain-decision--adjust">
                        <span class="ai-brain-badge ai-brain-badge--adjust">⟳ HOOK STYLE SHIFT</span>
                        ${postHook.label} hooks avg ${fmt(thisPatternData.avg)} views vs ${bestPatternData.label} at ${fmt(bestPatternData.avg)}.
                    </div>`);
                } else if (postHook.type === bestHookType && perfTier === 'Above Average') {
                    decisions.push(`<div class="ai-brain-decision ai-brain-decision--reinforce">
                        <span class="ai-brain-badge ai-brain-badge--reinforce">↑ PATTERN REINFORCED</span>
                        ${postHook.label} pattern confirmed as dominant performer.
                    </div>`);
                }

                if (missedTopTags.length > 0) {
                    const topMissed = missedTopTags.sort((a, b) => (b.avg_perf || 0) - (a.avg_perf || 0)).slice(0, 3);
                    decisions.push(`<div class="ai-brain-decision ai-brain-decision--adjust">
                        <span class="ai-brain-badge ai-brain-badge--adjust">⟳ TAG INJECTION</span>
                        Missing: ${topMissed.map(t => `<code>#${t.tag}</code> (avg ${fmt(t.avg_perf)})`).join(', ')}.
                    </div>`);
                }

                if (bestSlot && !thisSlot) {
                    decisions.push(`<div class="ai-brain-decision ai-brain-decision--adjust">
                        <span class="ai-brain-badge ai-brain-badge--adjust">⟳ SCHEDULE SHIFT</span>
                        Recommend ${DAY_NAMES[bestSlot.day_of_week]} ${formatHour(bestSlot.hour)} (score: ${bestSlot.score}).
                    </div>`);
                }

                const decisionHTML = decisions.length ? `
                    <div class="ai-brain-block ai-brain-block--decisions">
                        <div class="ai-brain-block__header">
                            <span class="ai-brain-block__icon">⚡</span>
                            <span class="ai-brain-block__title">Decision Log</span>
                        </div>
                        <div class="ai-brain-block__content">${decisions.join('')}</div>
                    </div>` : '';

                // ── 4. NEXT GEN STRATEGY ──
                const actions = [];

                if (bestPatternData) {
                    const keepHook = postHook.type === bestHookType && perfTier !== 'Below Average';
                    actions.push(keepHook
                        ? `<strong>Hook:</strong> Continue ${postHook.label} pattern — dominant with avg ${fmt(bestPatternData.avg)} views.`
                        : `<strong>Hook:</strong> Shift to ${bestPatternData.label}. Model: "${escHtml(bestPatternData.best.hook.slice(0, 55))}…" (${fmt(bestPatternData.best.perf)} views).`
                    );
                }

                if (patterns?.length_stats) {
                    actions.push(`<strong>Description:</strong> Target ~${Math.round(patterns.length_stats.avg_desc_len)} chars with ~${Math.round(patterns.length_stats.avg_tag_count)} tags.`);
                }

                if (matchedTags.length || missedTopTags.length) {
                    const priorityTags = [...matchedTags, ...missedTopTags]
                        .sort((a, b) => (b.avg_perf || 0) - (a.avg_perf || 0)).slice(0, 5);
                    actions.push(`<strong>Priority tags:</strong> ${priorityTags.map(t => `<code>#${t.tag}</code>`).join(' ')}`);
                }

                if (bestSlot) {
                    actions.push(`<strong>Optimal posting:</strong> ${DAY_NAMES[bestSlot.day_of_week]} ${formatHour(bestSlot.hour)}${topTimeSlots.length > 1 ? `, or ${DAY_NAMES[topTimeSlots[1].day_of_week]} ${formatHour(topTimeSlots[1].hour)}` : ''}.`);
                }

                if (vibePreset !== 'default') {
                    const vibeLabel = vibePreset.replace(/_/g, ' ');
                    actions.push(perfTier === 'Below Average'
                        ? `<strong>Vibe:</strong> "${vibeLabel}" underperformed — test alternatives next batch.`
                        : `<strong>Vibe:</strong> "${vibeLabel}" ${perfTier === 'Above Average' ? 'performing well — keep.' : 'at baseline — monitoring.'}`
                    );
                }

                const strategyHTML = actions.length ? `
                    <div class="ai-brain-block ai-brain-block--strategy">
                        <div class="ai-brain-block__header">
                            <span class="ai-brain-block__icon">→</span>
                            <span class="ai-brain-block__title">Next Gen Strategy</span>
                        </div>
                        <div class="ai-brain-block__content">
                            ${actions.map(a => `<div class="ai-brain-action">${a}</div>`).join('')}
                        </div>
                    </div>` : '';

                // Platform badges (FIXED: proper labels)
                const platformBadges = group.posts.map(p => {
                    const m = p.metrics;
                    const views = m ? fmt(m.views) : '—';
                    const platLabel = PLATFORM_LABELS[p.platform] || p.platform || '?';
                    return `<span class="insight-platform-badge insight-platform-badge--${p.platform}"
                        title="${m ? `Views: ${m.views}, Likes: ${m.likes}, Comments: ${m.comments}` : 'No metrics yet'}">
                        ${platLabel} <span class="insight-platform-badge__views">${views}</span></span>`;
                }).join('');

                html += `
                    <div class="insight-card">
                        <div class="insight-card__header">
                            <div class="insight-card__title-row">
                                <span class="top-performers__rank top-performers__rank--${rank + 1}">${rank + 1}</span>
                                <h4 class="insight-card__title">${escHtml(group.title)}</h4>
                                <span class="insight-card__perf ${perfClass}" title="Performance: ${perfScore}">
                                    ${perfIcon} ${perfTier}
                                </span>
                                ${outlierBadge}
                            </div>
                            <div class="insight-card__meta">
                                <span class="insight-card__date">${dateStr} at ${timeStr}</span>
                                <span class="insight-card__vibe">${escHtml(vibePreset.replace(/_/g, ' '))}</span>
                            </div>
                            <div class="insight-card__platforms">${platformBadges}</div>
                        </div>

                        <div class="insight-card__metrics">
                            <div class="insight-metric">
                                <span class="insight-metric__value">${fmt(group.totalViews)}</span>
                                <span class="insight-metric__label">Views</span>
                            </div>
                            <div class="insight-metric">
                                <span class="insight-metric__value">${fmt(group.totalLikes)}</span>
                                <span class="insight-metric__label">Likes</span>
                            </div>
                            <div class="insight-metric">
                                <span class="insight-metric__value">${fmt(group.totalComments)}</span>
                                <span class="insight-metric__label">Comments</span>
                            </div>
                            <div class="insight-metric">
                                <span class="insight-metric__value">${fmt(group.totalShares)}</span>
                                <span class="insight-metric__label">Shares</span>
                            </div>
                            <div class="insight-metric insight-metric--score">
                                <span class="insight-metric__value">${fmt(perfScore)}</span>
                                <span class="insight-metric__label">Perf Score</span>
                            </div>
                        </div>

                        <div class="insight-card__brain">
                            ${signalHTML}
                            ${patternHTML}
                            ${decisionHTML}
                            ${strategyHTML}
                        </div>
                    </div>`;
            }

            html += '</div>';  // close insights-list
            html += '</div>';  // close top-performers
            container.innerHTML = html;

        } catch (err) {
            console.error('[AI Intelligence] loadRecentPostInsights error:', err);
            container.innerHTML = '<div class="ai-empty">Failed to load post insights. Please try again.</div>';
        }
    }

    // ─── Cross-Platform Comparison ─────────────────────────────────

    async function loadCrossPlatformComparison() {
        const container = el('cross-platform-comparison');
        if (!container) return;
        container.innerHTML = '<div class="ai-loading">Loading platform comparison…</div>';

        try {
            const { data, error } = await supabase
                .from('v_cross_platform_performance')
                .select('*')
                .eq('brand_id', currentBrandId);

            if (error || !data?.length) {
                container.innerHTML = '<div class="ai-empty">No cross-platform data yet. Post to multiple platforms to see comparisons.</div>';
                return;
            }

            // Build comparison table
            const maxViews = Math.max(...data.map(d => d.avg_views || 0), 1);

            let html = `
                <div class="ai-comparison-table">
                    <table style="width:100%; border-collapse:collapse;">
                        <thead>
                            <tr style="border-bottom:1px solid var(--border-subtle);">
                                <th style="text-align:left; padding:8px;">Platform</th>
                                <th style="text-align:right; padding:8px;">Posts</th>
                                <th style="text-align:right; padding:8px;">Avg Views</th>
                                <th style="text-align:right; padding:8px;">Avg Likes</th>
                                <th style="text-align:right; padding:8px;">Avg Comments</th>
                                <th style="text-align:right; padding:8px;">Engagement %</th>
                                <th style="padding:8px; width:30%;">Performance</th>
                            </tr>
                        </thead>
                        <tbody>`;

            for (const row of data.sort((a, b) => (b.avg_views || 0) - (a.avg_views || 0))) {
                const platformLabel = {
                    youtube_shorts: '🎬 YouTube',
                    instagram_reels: '📸 Instagram',
                    facebook_reels: '📘 Facebook',
                    tiktok: '🎵 TikTok',
                    twitter: '🐦 Twitter/X',
                    threads: '🧵 Threads',
                }[row.platform] || row.platform;

                const barWidth = Math.round(((row.avg_views || 0) / maxViews) * 100);
                const engRate = row.avg_views > 0 ? (((row.avg_likes || 0) + (row.avg_comments || 0)) / row.avg_views * 100).toFixed(2) : '0.00';

                html += `
                    <tr style="border-bottom:1px solid var(--border-subtle);">
                        <td style="padding:8px; font-weight:600;">${platformLabel}</td>
                        <td style="text-align:right; padding:8px;">${row.total_posts || 0}</td>
                        <td style="text-align:right; padding:8px;">${fmt(row.avg_views)}</td>
                        <td style="text-align:right; padding:8px;">${fmt(row.avg_likes)}</td>
                        <td style="text-align:right; padding:8px;">${fmt(row.avg_comments)}</td>
                        <td style="text-align:right; padding:8px; color:${parseFloat(engRate) > 5 ? 'var(--success)' : 'var(--text-secondary)'};">${engRate}%</td>
                        <td style="padding:8px;">
                            <div style="background:var(--surface-secondary); border-radius:4px; height:20px; overflow:hidden;">
                                <div style="background:linear-gradient(90deg, var(--primary), var(--primary-light, #a78bfa)); height:100%; width:${barWidth}%; border-radius:4px; transition:width 0.3s;"></div>
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

    // ─── Strategy Performance ────────────────────────────────────────

    async function loadStrategyPerformance() {
        const container = el('strategy-performance');
        if (!container) return;
        container.innerHTML = '<div class="ai-loading">Loading strategy data…</div>';

        try {
            const { data, error } = await supabase
                .from('v_strategy_performance')
                .select('*')
                .eq('brand_id', currentBrandId)
                .order('avg_perf_score', { ascending: false });

            if (error || !data?.length) {
                container.innerHTML = '<div class="ai-empty">No strategy data yet. Strategies are assigned automatically during content generation.</div>';
                return;
            }

            const maxScore = Math.max(...data.map(d => d.avg_perf_score || 0), 1);

            let html = '<div class="ai-strategy-grid" style="display:grid; gap:12px;">';

            for (const s of data) {
                const barWidth = Math.round(((s.avg_perf_score || 0) / maxScore) * 100);
                const engColor = barWidth > 70 ? 'var(--color-success)' : barWidth > 40 ? '#eab308' : 'var(--color-text-tertiary)';
                const platLabel = PLATFORM_LABELS[s.platform] || s.platform || '';
                const platformBadge = platLabel ? `<span class="ai-card__badge" style="font-size:0.7rem;">${platLabel}</span>` : '';

                html += `
                    <div style="background:var(--color-bg-surface); border-radius:var(--radius-lg); padding:12px 16px; display:flex; align-items:center; gap:12px;">
                        <div style="flex:1;">
                            <div style="font-weight:600; color:var(--color-text-primary); font-size:0.9rem;">
                                ${(s.strategy_type || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                ${platformBadge}
                            </div>
                            <div style="font-size:0.8rem; color:var(--color-text-secondary); margin-top:2px;">
                                ${s.post_count || 0} posts · Avg Views: ${fmt(s.avg_views)} · Score: ${fmt(s.avg_perf_score)}
                            </div>
                        </div>
                        <div style="width:120px;">
                            <div style="background:var(--color-bg-elevated); border-radius:4px; height:16px; overflow:hidden;">
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

    // ─── Public API ──────────────────────────────────────────────────

    return { init };
})();

document.addEventListener('DOMContentLoaded', () => AIIntelligence.init());
