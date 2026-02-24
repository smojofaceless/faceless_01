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
                loadLatestPostDive(),
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
        } else if (currentTab === 'ai-learning') {
            await loadAILearningGrowth();
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

    // ─── 8a. Latest Post Deep Dive (Overview) ───────────────────────

    async function loadLatestPostDive() {
        const container = el('latest-post-dive');
        if (!container) return;
        container.innerHTML = '<div class="ai-loading">Analyzing your latest post…</div>';

        try {
            // 1. Fetch the most recent posted post (any platform) for this brand
            let latestQuery = supabase.from('posts')
                .select('id, title, description, tags, platform, status, posted_at, video_url, job_id, meta, platform_post_id, platform_url, ai_metadata, platform_content')
                .eq('brand_id', currentBrandId)
                .eq('status', 'posted')
                .order('posted_at', { ascending: false })
                .limit(1);
            if (platformFilter()) latestQuery = latestQuery.eq('platform', platformFilter());

            const { data: latestPosts } = await latestQuery;
            if (!latestPosts?.length) {
                container.innerHTML = '';
                return;
            }
            const latest = latestPosts[0];
            const jobId = latest.job_id;

            // 2. All sibling posts for this story (across platforms)
            const { data: siblings } = await supabase.from('posts')
                .select('id, title, description, tags, platform, status, posted_at, video_url, platform_post_id, platform_url, ai_metadata, platform_content')
                .eq('brand_id', currentBrandId)
                .eq('job_id', jobId)
                .eq('status', 'posted')
                .order('platform');

            const allPosts = siblings?.length ? siblings : [latest];
            const allPostIds = allPosts.map(p => p.id);

            // 3. Parallel fetch: metrics, post_metadata (AI generated), patterns, exemplars, time-slots, brand avg
            const plat = platformFilter() || 'youtube_shorts';
            const [metricsRes, metadataRes, patternsRes, exemplarsRes, timeSlotsRes, avgRes] = await Promise.all([
                supabase.from('v_post_metrics_latest')
                    .select('post_id, platform, views, likes, comments, shares, saves, collected_at')
                    .in('post_id', allPostIds),
                supabase.from('post_metadata')
                    .select('post_id, platform, status, final_metadata, ai_metadata, error, attempt_count, failure_class')
                    .in('post_id', allPostIds),
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
                // Brand avg from all posted last 90 days
                supabase.from('v_post_metrics_latest')
                    .select('post_id, views, likes, comments, shares')
                    .order('views', { ascending: false })
                    .limit(200),
            ]);

            const metricsMap = {};
            for (const m of (metricsRes.data || [])) metricsMap[m.post_id] = m;

            const metadataMap = {};
            for (const md of (metadataRes.data || [])) {
                const key = md.post_id + ':' + md.platform;
                metadataMap[key] = md;
            }

            const patterns = patternsRes.data?.[0] || null;
            const exemplars = Array.isArray(exemplarsRes.data) ? exemplarsRes.data : [];
            const topTimeSlots = timeSlotsRes.data || [];

            // Brand averages
            const allMetrics = avgRes.data || [];
            const brandAvg = {
                views: allMetrics.length ? Math.round(allMetrics.reduce((s, m) => s + (m.views || 0), 0) / allMetrics.length) : 0,
                likes: allMetrics.length ? Math.round(allMetrics.reduce((s, m) => s + (m.likes || 0), 0) / allMetrics.length) : 0,
                comments: allMetrics.length ? Math.round(allMetrics.reduce((s, m) => s + (m.comments || 0), 0) / allMetrics.length) : 0,
                shares: allMetrics.length ? Math.round(allMetrics.reduce((s, m) => s + (m.shares || 0), 0) / allMetrics.length) : 0,
            };

            // Exemplar threshold
            const exemplarPerfs = exemplars.map(e => e.performance_value).sort((a, b) => b - a);
            const exemplarThreshold = exemplarPerfs.length >= 5 ? exemplarPerfs[exemplarPerfs.length - 1] : 0;

            // ── Aggregate totals across all platforms for this story ──
            let totalViews = 0, totalLikes = 0, totalComments = 0, totalShares = 0, totalSaves = 0;
            for (const p of allPosts) {
                const m = metricsMap[p.id];
                if (m) {
                    totalViews += m.views || 0;
                    totalLikes += m.likes || 0;
                    totalComments += m.comments || 0;
                    totalShares += m.shares || 0;
                    totalSaves += m.saves || 0;
                }
            }
            const perfScore = totalViews + 5 * totalLikes + 10 * totalComments + 10 * totalShares;
            const avgPerfScore = brandAvg.views + 5 * brandAvg.likes + 10 * brandAvg.comments + 10 * brandAvg.shares;

            // ── Determine performance tier ──
            let perfTier, perfClass, perfEmoji;
            if (avgPerfScore === 0 || perfScore >= avgPerfScore * 1.3) {
                perfTier = 'Above Average'; perfClass = 'perf--high'; perfEmoji = '🔥';
            } else if (perfScore >= avgPerfScore * 0.7) {
                perfTier = 'Average'; perfClass = 'perf--mid'; perfEmoji = '➖';
            } else {
                perfTier = 'Below Average'; perfClass = 'perf--low'; perfEmoji = '📉';
            }

            const hasMetrics = totalViews > 0 || totalLikes > 0;
            const posted = new Date(latest.posted_at);
            const vibePreset = latest.meta?.vibe_preset || 'default';
            const vibeLabel = vibePreset.replace(/_/g, ' ');
            const postedAgo = getTimeAgo(posted);

            // ══════════════════════════════════════════════════════════
            //  BUILD HTML
            // ══════════════════════════════════════════════════════════

            let html = `<div class="latest-dive">`;

            // ── Header ──
            html += `
                <div class="latest-dive__header">
                    <div class="latest-dive__title-row">
                        <div class="latest-dive__icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <path d="M12 16v-4"/><path d="M12 8h.01"/>
                            </svg>
                        </div>
                        <div>
                            <h3 class="latest-dive__title">Latest Post Deep Dive</h3>
                            <p class="latest-dive__subtitle">Your most recent story — posted ${postedAgo}</p>
                        </div>
                    </div>
                    <span class="latest-dive__perf ${perfClass}">
                        ${perfEmoji} ${perfTier}
                    </span>
                </div>`;

            // ── Story header ──
            html += `
                <div class="latest-dive__story">
                    <div class="latest-dive__story-info">
                        <h4 class="latest-dive__story-title">${escHtml(latest.title)}</h4>
                        <div class="latest-dive__story-meta">
                            <span class="latest-dive__vibe">${escHtml(vibeLabel)}</span>
                            <span class="latest-dive__date">${posted.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${posted.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                        </div>`;

            // Tags
            const tags = latest.tags || [];
            if (tags.length) {
                html += `<div class="latest-dive__tags">${tags.map(t => `<span class="latest-dive__tag">#${escHtml(t)}</span>`).join('')}</div>`;
            }

            html += `</div>`;

            // Video thumbnail (if available)
            if (latest.video_url) {
                html += `<div class="latest-dive__thumb">
                    <video src="${escHtml(latest.video_url)}" muted preload="metadata" class="latest-dive__video"></video>
                </div>`;
            }

            html += `</div>`; // close story

            // ── Metadata alert (if any platform has failed metadata) ──
            const failedMeta = allPosts.filter(p => {
                const mdKey = p.id + ':' + p.platform;
                const md = metadataMap[mdKey];
                return md && md.status === 'failed';
            });
            if (failedMeta.length > 0) {
                const sample = metadataMap[failedMeta[0].id + ':' + failedMeta[0].platform];
                const errSnippet = sample?.error ? escHtml(sample.error.split('\n')[0].slice(0, 120)) : 'Unknown error';
                html += `<div class="latest-dive__alert latest-dive__alert--warning">
                    <div class="latest-dive__alert-header">
                        <span class="latest-dive__alert-icon">⚠️</span>
                        <strong>AI Metadata Failed for ${failedMeta.length} Platform${failedMeta.length > 1 ? 's' : ''}</strong>
                    </div>
                    <p class="latest-dive__alert-body">This post was published <strong>without AI-optimized titles, tags, or descriptions</strong> because the metadata generation failed. The raw story narration was used as a fallback.</p>
                    <div class="latest-dive__alert-detail">
                        <span class="latest-dive__alert-label">Error:</span> <code>${errSnippet}</code>
                    </div>
                    <p class="latest-dive__alert-hint">💡 Check your OpenAI billing/quota. Failed metadata can be regenerated with <code>force: true</code> via the generate-post-metadata edge function.</p>
                </div>`;
            }

            // ── Per-platform breakdown ──
            html += `<div class="latest-dive__platforms">`;
            for (const post of allPosts) {
                const m = metricsMap[post.id];
                const mdKey = post.id + ':' + post.platform;
                const md = metadataMap[mdKey];
                const aiMd = md ? (md.final_metadata || md.ai_metadata) : null;
                const platLabel = PLATFORM_LABELS[post.platform] || post.platform;
                const platColor = PLATFORM_COLORS[post.platform] || '#6b7280';
                const mdStatus = md?.status || 'none';
                const metaSource = post.platform_content?.metadata_source || post.ai_metadata?.metadata_source || null;

                let metaBadge = '';
                if (mdStatus === 'ready' || mdStatus === 'edited' || metaSource === 'ready' || metaSource === 'edited' || metaSource === 'ai_backfill') {
                    metaBadge = '<span class="latest-dive__plat-meta-source latest-dive__plat-meta-source--ai">🤖 AI Metadata</span>';
                } else if (mdStatus === 'failed') {
                    metaBadge = '<span class="latest-dive__plat-meta-source latest-dive__plat-meta-source--failed">❌ Metadata Failed</span>';
                } else if (mdStatus === 'generating' || mdStatus === 'not_started') {
                    metaBadge = '<span class="latest-dive__plat-meta-source latest-dive__plat-meta-source--pending">⏳ Generating…</span>';
                } else {
                    metaBadge = '<span class="latest-dive__plat-meta-source latest-dive__plat-meta-source--fallback">📝 Raw Fallback</span>';
                }

                html += `<div class="latest-dive__plat-card" style="border-left: 3px solid ${platColor}">
                    <div class="latest-dive__plat-header">
                        <span class="latest-dive__plat-name" style="color:${platColor}">${platLabel}</span>
                        ${metaBadge}
                        ${post.platform_url ? `<a href="${escHtml(post.platform_url)}" target="_blank" class="latest-dive__plat-link">View ↗</a>` : ''}
                    </div>`;

                // Metrics row
                if (m) {
                    html += `<div class="latest-dive__plat-metrics">
                        <span class="latest-dive__plat-stat"><strong>${fmt(m.views)}</strong> views</span>
                        <span class="latest-dive__plat-stat"><strong>${fmt(m.likes)}</strong> likes</span>
                        <span class="latest-dive__plat-stat"><strong>${fmt(m.comments)}</strong> comments</span>
                        <span class="latest-dive__plat-stat"><strong>${fmt(m.shares)}</strong> shares</span>
                        ${m.saves ? `<span class="latest-dive__plat-stat"><strong>${fmt(m.saves)}</strong> saves</span>` : ''}
                    </div>`;
                } else {
                    html += `<div class="latest-dive__plat-metrics latest-dive__plat-metrics--pending">Metrics pending — next collection cycle</div>`;
                }

                // AI metadata comparison
                if (aiMd) {
                    const aiTitle = aiMd.title || aiMd.caption || null;
                    const aiTags = aiMd.tags || aiMd.hashtags || [];
                    html += `<div class="latest-dive__plat-ai">
                        <span class="latest-dive__plat-ai-label">AI-Optimized:</span>
                        ${aiTitle ? `<div class="latest-dive__plat-ai-title">${escHtml(aiTitle)}</div>` : ''}
                        ${aiTags.length ? `<div class="latest-dive__plat-ai-tags">${aiTags.slice(0, 8).map(t => `<span class="latest-dive__tag latest-dive__tag--ai">#${escHtml(t)}</span>`).join('')}</div>` : ''}
                    </div>`;
                }

                html += `</div>`; // close plat-card
            }
            html += `</div>`; // close platforms

            // ── Aggregate metrics ──
            html += `<div class="latest-dive__metrics-grid">
                <div class="latest-dive__metric">
                    <span class="latest-dive__metric-value">${fmt(totalViews)}</span>
                    <span class="latest-dive__metric-label">Total Views</span>
                    ${hasMetrics && brandAvg.views > 0 ? `<span class="latest-dive__metric-vs ${totalViews >= brandAvg.views ? 'latest-dive__metric-vs--up' : 'latest-dive__metric-vs--down'}">${totalViews >= brandAvg.views ? '+' : ''}${Math.round((totalViews / brandAvg.views - 1) * 100)}% vs avg</span>` : ''}
                </div>
                <div class="latest-dive__metric">
                    <span class="latest-dive__metric-value">${fmt(totalLikes)}</span>
                    <span class="latest-dive__metric-label">Total Likes</span>
                </div>
                <div class="latest-dive__metric">
                    <span class="latest-dive__metric-value">${fmt(totalComments)}</span>
                    <span class="latest-dive__metric-label">Total Comments</span>
                </div>
                <div class="latest-dive__metric">
                    <span class="latest-dive__metric-value">${fmt(totalShares)}</span>
                    <span class="latest-dive__metric-label">Total Shares</span>
                </div>
                <div class="latest-dive__metric latest-dive__metric--score">
                    <span class="latest-dive__metric-value">${fmt(perfScore)}</span>
                    <span class="latest-dive__metric-label">Perf Score</span>
                    ${hasMetrics ? `<span class="latest-dive__metric-vs">${perfScore >= exemplarThreshold ? '✓ Exemplar' : `Need ${fmt(exemplarThreshold)}`}</span>` : ''}
                </div>
            </div>`;

            // ══════════════════════════════════════════════════════════
            //  AI ANALYSIS: What went well / What could improve
            // ══════════════════════════════════════════════════════════

            const strengths = [];
            const improvements = [];
            const insights = [];

            // 1. View performance comparison
            if (hasMetrics) {
                const viewRatio = brandAvg.views > 0 ? totalViews / brandAvg.views : 0;
                if (viewRatio >= 1.3) {
                    strengths.push(`Views are <strong>${Math.round((viewRatio - 1) * 100)}% above average</strong> (${fmt(totalViews)} vs brand avg ${fmt(brandAvg.views)}). This content is a strong performer.`);
                } else if (viewRatio >= 0.7) {
                    insights.push(`Views are within normal range — ${fmt(totalViews)} total vs brand avg ${fmt(brandAvg.views)}. Solid but has room for potential breakout.`);
                } else if (viewRatio > 0) {
                    improvements.push(`Views are <strong>${Math.round((1 - viewRatio) * 100)}% below average</strong> (${fmt(totalViews)} vs avg ${fmt(brandAvg.views)}). The content may not be reaching its audience effectively.`);
                }

                // Engagement rate
                const engRate = totalViews > 0 ? ((totalLikes + totalComments) / totalViews * 100) : 0;
                const avgEngRate = brandAvg.views > 0 ? ((brandAvg.likes + brandAvg.comments) / brandAvg.views * 100) : 0;
                if (engRate > 0) {
                    if (engRate > avgEngRate * 1.3) {
                        strengths.push(`Engagement rate is <strong>${engRate.toFixed(1)}%</strong> (brand avg ${avgEngRate.toFixed(1)}%) — viewers who see this content are highly engaged.`);
                    } else if (engRate < avgEngRate * 0.7 && avgEngRate > 0) {
                        improvements.push(`Engagement rate is <strong>${engRate.toFixed(1)}%</strong> (brand avg ${avgEngRate.toFixed(1)}%) — the hook may attract views but not keep attention.`);
                    }
                }

                // Shares
                if (totalShares > brandAvg.shares * 1.5 && totalShares > 0) {
                    strengths.push(`<strong>${totalShares} shares</strong> — content is being actively redistributed. This is the strongest growth signal.`);
                }

                // Exemplar qualification
                if (perfScore >= exemplarThreshold && exemplarThreshold > 0) {
                    strengths.push(`Performance score <strong>${fmt(perfScore)}</strong> qualifies for the exemplar pool (threshold: ${fmt(exemplarThreshold)}). The AI will use this post's style as a reference for future content.`);
                } else if (exemplarThreshold > 0) {
                    improvements.push(`Performance score ${fmt(perfScore)} is below the exemplar threshold (${fmt(exemplarThreshold)}). A ${Math.round((exemplarThreshold / Math.max(perfScore, 1) - 1) * 100)}% improvement would enter the learning pool.`);
                }
            } else {
                insights.push(`Metrics haven't been collected yet — the system checks every 30 minutes. Analysis will be more detailed after the first collection cycle.`);
            }

            // 2. Hook pattern analysis
            const hookInfo = classifyHook(latest.title);
            const hookPatternPerf = {};
            for (const h of (patterns?.top_hooks || [])) {
                const cls = classifyHook(h.hook);
                if (!hookPatternPerf[cls.type]) hookPatternPerf[cls.type] = { label: cls.label, total: 0, count: 0 };
                hookPatternPerf[cls.type].total += h.perf || 0;
                hookPatternPerf[cls.type].count++;
            }
            for (const p of Object.values(hookPatternPerf)) p.avg = Math.round(p.total / p.count);

            let bestHookType = null;
            for (const [type, data] of Object.entries(hookPatternPerf)) {
                if (!bestHookType || data.avg > hookPatternPerf[bestHookType].avg) bestHookType = type;
            }

            if (bestHookType) {
                const thisHookData = hookPatternPerf[hookInfo.type];
                const bestHookData = hookPatternPerf[bestHookType];
                if (hookInfo.type === bestHookType) {
                    strengths.push(`Title uses <strong>${hookInfo.label}</strong> pattern — this IS the top-performing hook format (avg ${fmt(bestHookData.avg)} views).`);
                } else if (thisHookData && bestHookData && thisHookData.avg < bestHookData.avg * 0.7) {
                    improvements.push(`Title uses <strong>${hookInfo.label}</strong> pattern (avg ${fmt(thisHookData.avg)} views). Data shows <strong>${bestHookData.label}</strong> outperforms at avg ${fmt(bestHookData.avg)} views. Consider reformatting.`);
                } else {
                    insights.push(`Title uses <strong>${hookInfo.label}</strong> pattern. Top-performing format is <strong>${bestHookData.label}</strong> (avg ${fmt(bestHookData.avg)} views).`);
                }
            }

            // 3. Tag analysis — merge top-level tags + AI-generated per-platform tags
            const allTagsSet = new Set((tags || []).map(t => t.toLowerCase()));
            for (const post of allPosts) {
                const mdKey = post.id + ':' + post.platform;
                const md = metadataMap[mdKey];
                const aiMd = md?.final_metadata || md?.ai_metadata || post.ai_metadata || null;
                if (aiMd) {
                    for (const t of (aiMd.tags || aiMd.hashtags || [])) {
                        allTagsSet.add(t.toLowerCase());
                    }
                }
                // Also include post-level tags from siblings
                for (const t of (post.tags || [])) {
                    allTagsSet.add(t.toLowerCase());
                }
            }
            const postTagSet = allTagsSet;
            const winningTags = (patterns?.top_hashtags || []).slice(0, 8);
            const matchedTags = winningTags.filter(wt => postTagSet.has(wt.tag.toLowerCase()));
            const missedTags = winningTags.filter(wt => !postTagSet.has(wt.tag.toLowerCase()));

            if (winningTags.length > 0) {
                if (postTagSet.size === 0) {
                    // No tags at all — this is the fallback/failed metadata case
                    improvements.push(`<strong>No tags at all</strong> — this post was published without any hashtags. ${failedMeta.length > 0 ? 'AI metadata generation failed (see above).' : 'Check the metadata pipeline.'} Missing top tags: ${missedTags.slice(0, 4).map(t => `<code>#${t.tag}</code>`).join(', ')}.`);
                } else if (matchedTags.length >= winningTags.length * 0.6) {
                    strengths.push(`Strong tag alignment — <strong>${matchedTags.length}/${winningTags.length}</strong> top-performing tags present: ${matchedTags.slice(0, 4).map(t => `<code>#${t.tag}</code>`).join(', ')}.`);
                } else if (matchedTags.length <= winningTags.length * 0.3) {
                    improvements.push(`Low tag alignment — only <strong>${matchedTags.length}/${winningTags.length}</strong> top-performing tags present. Missing: ${missedTags.slice(0, 3).map(t => `<code>#${t.tag}</code> (avg ${fmt(t.avg_perf)})`).join(', ')}.`);
                } else {
                    insights.push(`Tag alignment: ${matchedTags.length}/${winningTags.length} winning tags present. Consider adding: ${missedTags.slice(0, 2).map(t => `<code>#${t.tag}</code>`).join(', ')}.`);
                }
            }

            // 4. Description length
            const descLen = (latest.description || '').length;
            const isRawNarration = failedMeta.length > 0 && descLen > 400;
            if (isRawNarration) {
                improvements.push(`Description is <strong>raw story narration</strong> (${descLen} chars) — the AI caption generator failed, so the full story text was used as a fallback. Optimal captions are typically 100-300 chars.`);
            } else if (patterns?.length_stats?.avg_desc_len) {
                const optLen = Math.round(patterns.length_stats.avg_desc_len);
                const pctDelta = optLen > 0 ? Math.abs(descLen - optLen) / optLen * 100 : 0;
                if (pctDelta <= 20) {
                    strengths.push(`Description length <strong>${descLen} chars</strong> is within optimal range (~${optLen} for top performers).`);
                } else if (descLen > optLen) {
                    improvements.push(`Description is <strong>${Math.round(pctDelta)}% longer</strong> than top performers (${descLen} vs ~${optLen} chars). Shorter, punchier descriptions tend to perform better.`);
                } else {
                    improvements.push(`Description is <strong>${Math.round(pctDelta)}% shorter</strong> than top performers (${descLen} vs ~${optLen} chars). Adding more context could help discovery.`);
                }
            }

            // 5. Posting time analysis
            const dow = posted.getDay();
            const hour = posted.getHours();
            const bestSlot = topTimeSlots[0];
            const matchedSlot = topTimeSlots.find(s => s.day_of_week === dow && s.hour === hour);

            if (bestSlot) {
                if (matchedSlot) {
                    strengths.push(`Posted during a <strong>top time slot</strong> — ${DAY_NAMES[dow]} ${formatHour(hour)} (score: ${matchedSlot.score}). Good timing.`);
                } else {
                    improvements.push(`Posted at ${DAY_NAMES[dow]} ${formatHour(hour)}. Data shows <strong>${DAY_NAMES[bestSlot.day_of_week]} ${formatHour(bestSlot.hour)}</strong> (score: ${bestSlot.score}) as the highest-performing slot.`);
                }
            }

            // 6. Vibe preset analysis
            if (vibePreset !== 'default') {
                if (hasMetrics && perfTier === 'Above Average') {
                    strengths.push(`Vibe preset <strong>"${vibeLabel}"</strong> is performing well for this content type.`);
                } else if (hasMetrics && perfTier === 'Below Average') {
                    improvements.push(`Vibe preset <strong>"${vibeLabel}"</strong> may not be connecting with the audience. Consider testing alternative vibes for this type of content.`);
                }
            }

            // Build analysis HTML
            html += `<div class="latest-dive__analysis">`;

            // Strengths
            if (strengths.length) {
                html += `<div class="latest-dive__analysis-section latest-dive__analysis-section--strengths">
                    <div class="latest-dive__analysis-header">
                        <span class="latest-dive__analysis-icon">✅</span>
                        <span class="latest-dive__analysis-title">What's Working</span>
                    </div>
                    <ul class="latest-dive__analysis-list">
                        ${strengths.map(s => `<li>${s}</li>`).join('')}
                    </ul>
                </div>`;
            }

            // Improvements
            if (improvements.length) {
                html += `<div class="latest-dive__analysis-section latest-dive__analysis-section--improvements">
                    <div class="latest-dive__analysis-header">
                        <span class="latest-dive__analysis-icon">💡</span>
                        <span class="latest-dive__analysis-title">What Could Improve</span>
                    </div>
                    <ul class="latest-dive__analysis-list">
                        ${improvements.map(s => `<li>${s}</li>`).join('')}
                    </ul>
                </div>`;
            }

            // Neutral insights
            if (insights.length) {
                html += `<div class="latest-dive__analysis-section latest-dive__analysis-section--neutral">
                    <div class="latest-dive__analysis-header">
                        <span class="latest-dive__analysis-icon">📊</span>
                        <span class="latest-dive__analysis-title">Observations</span>
                    </div>
                    <ul class="latest-dive__analysis-list">
                        ${insights.map(s => `<li>${s}</li>`).join('')}
                    </ul>
                </div>`;
            }

            // No analysis available
            if (!strengths.length && !improvements.length && !insights.length) {
                html += `<div class="latest-dive__analysis-section latest-dive__analysis-section--neutral">
                    <div class="latest-dive__analysis-header">
                        <span class="latest-dive__analysis-icon">⏳</span>
                        <span class="latest-dive__analysis-title">Awaiting Data</span>
                    </div>
                    <p style="color:var(--color-text-secondary);font-size:var(--text-sm)">Metrics haven't been collected yet. Check back after the next collection cycle (every 30 minutes).</p>
                </div>`;
            }

            html += `</div>`; // close analysis

            // ── AI decision summary ──
            const decisions = [];
            if (hasMetrics) {
                if (perfScore >= exemplarThreshold && exemplarThreshold > 0) {
                    decisions.push({ badge: '✓ EXEMPLAR', cls: 'promote', text: `Qualifies for exemplar pool — AI will learn from this post's style.` });
                }
                if (perfTier === 'Below Average') {
                    decisions.push({ badge: '✗ NEGATIVE', cls: 'demote', text: `Flagged for "patterns to avoid" pool — AI will steer away from this approach.` });
                }
                if (hookInfo.type !== bestHookType && bestHookType) {
                    decisions.push({ badge: '⟳ ADAPT', cls: 'adjust', text: `AI will shift future hooks toward ${hookPatternPerf[bestHookType]?.label || 'top-performing'} patterns.` });
                }
                if (missedTags.length > 0) {
                    decisions.push({ badge: '⟳ TAGS', cls: 'adjust', text: `AI will inject missing top tags: ${missedTags.slice(0, 3).map(t => '#' + t.tag).join(', ')}.` });
                }
            }

            if (decisions.length) {
                html += `<div class="latest-dive__decisions">
                    <h4 class="latest-dive__decisions-title">⚡ AI Learning Decisions</h4>
                    <div class="latest-dive__decisions-list">
                        ${decisions.map(d => `<div class="latest-dive__decision latest-dive__decision--${d.cls}">
                            <span class="latest-dive__decision-badge">${d.badge}</span>
                            <span>${d.text}</span>
                        </div>`).join('')}
                    </div>
                </div>`;
            }

            html += `</div>`; // close latest-dive

            container.innerHTML = html;

        } catch (err) {
            console.error('[AI Intelligence] loadLatestPostDive error:', err);
            container.innerHTML = '<div class="ai-empty">Failed to load latest post analysis.</div>';
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  AI Learning Growth
    // ═══════════════════════════════════════════════════════════════

    async function loadAILearningGrowth() {
        const container = el('ai-learning-container');
        if (!container) return;
        container.innerHTML = '<div class="ai-loading">Analyzing AI learning growth…</div>';

        try {
            /* ── Parallel data fetch ── */
            const plat = platformFilter() || 'youtube_shorts';
            const [
                postsRes, pmvRes, metadataRes, metricsRes,
                patternsRes, exemplarsRes, negExemplarsRes
            ] = await Promise.all([
                supabase.from('posts')
                    .select('id, title, tags, platform, posted_at, meta, job_id')
                    .eq('brand_id', currentBrandId)
                    .eq('status', 'posted')
                    .order('posted_at', { ascending: true }),
                supabase.from('post_metadata_versions')
                    .select('post_id, platform, version_type, created_at, fields')
                    .order('created_at', { ascending: true }),
                supabase.from('post_metadata')
                    .select('post_id, platform, status, error, attempt_count, created_at')
                    .order('created_at', { ascending: true }),
                supabase.from('v_post_metrics_latest')
                    .select('post_id, platform, views, likes, comments, shares')
                    .order('views', { ascending: false }),
                supabase.rpc('get_winning_patterns', {
                    p_brand_id: currentBrandId, p_platform: plat, p_vibe_preset: null,
                }),
                supabase.rpc('get_generation_exemplars', {
                    p_brand_id: currentBrandId, p_platform: plat, p_limit: 10, p_window_days: 90,
                }),
                supabase.rpc('get_negative_exemplars', {
                    p_brand_id: currentBrandId, p_platform: plat, p_limit: 10, p_window_days: 90,
                }),
            ]);

            const posts = postsRes.data || [];
            const pmvEntries = pmvRes.data || [];
            const metadataEntries = metadataRes.data || [];
            const allMetrics = metricsRes.data || [];
            const patterns = patternsRes.data?.[0] || null;
            const exemplars = Array.isArray(exemplarsRes.data) ? exemplarsRes.data : [];
            const negExemplars = Array.isArray(negExemplarsRes.data) ? negExemplarsRes.data : [];

            if (!posts.length) {
                container.innerHTML = '<div class="ai-empty">No posted content yet. The AI will start learning once posts go live and metrics are collected.</div>';
                return;
            }

            /* ── Build lookup maps ── */
            const metricsMap = {};
            for (const m of allMetrics) metricsMap[m.post_id] = m;

            const mdStatusMap = {};
            for (const md of metadataEntries) mdStatusMap[md.post_id + ':' + md.platform] = md;

            const pmvByPost = {};
            for (const pv of pmvEntries) { if (!pmvByPost[pv.post_id]) pmvByPost[pv.post_id] = []; pmvByPost[pv.post_id].push(pv); }

            /* ── Core Stats ── */
            const totalPosts = posts.length;
            const postsWithMetrics = posts.filter(p => metricsMap[p.id]).length;
            const postsWithAIMeta = metadataEntries.filter(md => md.status === 'ready' || md.status === 'edited').length;
            const failedMeta = metadataEntries.filter(md => md.status === 'failed').length;
            const pendingMeta = metadataEntries.filter(md => md.status === 'not_started' || md.status === 'pending').length;
            const uniqueVibes = new Set(posts.map(p => p.meta?.vibe_preset).filter(Boolean));
            const uniquePlatforms = new Set(posts.map(p => p.platform));
            const totalExemplars = exemplars.length;
            const totalNegExemplars = negExemplars.length;
            const winningHooks = patterns?.top_hooks?.length || 0;
            const winningTags = patterns?.top_hashtags?.length || 0;
            const winningCtas = patterns?.top_ctas?.length || 0;

            /* ── Performance formula helper ── */
            const perfScore = (m) => m ? (m.views || 0) + 5 * (m.likes || 0) + 10 * (m.comments || 0) + 10 * (m.shares || 0) : 0;

            /* ── Global perf stats ── */
            const allPerfs = posts.map(p => perfScore(metricsMap[p.id])).filter(v => v > 0);
            const avgPerf = allPerfs.length ? Math.round(allPerfs.reduce((a, b) => a + b, 0) / allPerfs.length) : 0;
            const totalViews = allMetrics.reduce((s, m) => s + (m.views || 0), 0);
            const totalLikes = allMetrics.reduce((s, m) => s + (m.likes || 0), 0);
            const totalComments = allMetrics.reduce((s, m) => s + (m.comments || 0), 0);
            const totalShares = allMetrics.reduce((s, m) => s + (m.shares || 0), 0);
            const engagementRate = totalViews > 0 ? ((totalLikes + totalComments + totalShares) / totalViews * 100).toFixed(2) : '0';

            /* ── Weekly Buckets ── */
            const weekBuckets = {};
            for (const p of posts) {
                const d = new Date(p.posted_at);
                const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay());
                const key = weekStart.toISOString().slice(0, 10);
                if (!weekBuckets[key]) weekBuckets[key] = { views: 0, likes: 0, comments: 0, shares: 0, perf: 0, count: 0, withAI: 0, perfArr: [] };
                const m = metricsMap[p.id];
                if (m) {
                    weekBuckets[key].views += m.views || 0;
                    weekBuckets[key].likes += m.likes || 0;
                    weekBuckets[key].comments += m.comments || 0;
                    weekBuckets[key].shares += m.shares || 0;
                    weekBuckets[key].perf += perfScore(m);
                    weekBuckets[key].perfArr.push(perfScore(m));
                }
                weekBuckets[key].count++;
                const mdKey = p.id + ':' + p.platform;
                if (mdStatusMap[mdKey] && (mdStatusMap[mdKey].status === 'ready' || mdStatusMap[mdKey].status === 'edited')) {
                    weekBuckets[key].withAI++;
                }
            }
            const weeks = Object.entries(weekBuckets).sort((a, b) => a[0].localeCompare(b[0]));
            const maxWeekViews = Math.max(...weeks.map(([, w]) => w.count > 0 ? w.views / w.count : 0), 1);
            const maxWeekPerf = Math.max(...weeks.map(([, w]) => w.count > 0 ? w.perf / w.count : 0), 1);

            /* ── First/Second half comparison (learning acceleration) ── */
            // Only compare "mature" posts (>7 days old) so newer posts with
            // incomplete metrics don't drag down the recent-half average.
            const MATURITY_DAYS = 7;
            const now = Date.now();
            const maturePosts = posts.filter(p => {
                const age = (now - new Date(p.posted_at).getTime()) / 86400000;
                return age >= MATURITY_DAYS;
            });
            const immatureCount = posts.length - maturePosts.length;

            const midIdx = Math.floor(maturePosts.length / 2);
            const firstHalf = maturePosts.slice(0, midIdx);
            const secondHalf = maturePosts.slice(midIdx);
            const halfPerf = (arr) => {
                const perfs = arr.map(p => perfScore(metricsMap[p.id])).filter(v => v > 0);
                return perfs.length ? Math.round(perfs.reduce((a, b) => a + b, 0) / perfs.length) : 0;
            };
            const firstHalfPerf = halfPerf(firstHalf);
            const secondHalfPerf = halfPerf(secondHalf);
            const perfDelta = firstHalfPerf > 0 ? Math.round(((secondHalfPerf - firstHalfPerf) / firstHalfPerf) * 100) : 0;
            const accelDataTooFresh = maturePosts.length < 6; // need at least 3 per half

            // Per-platform acceleration (mature posts only)
            const platAccel = {};
            for (const p of maturePosts) {
                const plat = p.platform || 'unknown';
                if (!platAccel[plat]) platAccel[plat] = { first: [], second: [] };
            }
            for (const p of firstHalf) {
                const plat = p.platform || 'unknown';
                const perf = perfScore(metricsMap[p.id]);
                if (perf > 0 && platAccel[plat]) platAccel[plat].first.push(perf);
            }
            for (const p of secondHalf) {
                const plat = p.platform || 'unknown';
                const perf = perfScore(metricsMap[p.id]);
                if (perf > 0 && platAccel[plat]) platAccel[plat].second.push(perf);
            }
            const platAccelArr = Object.entries(platAccel)
                .filter(([, v]) => v.first.length >= 2 && v.second.length >= 2)
                .map(([plat, v]) => {
                    const avg1 = Math.round(v.first.reduce((a, b) => a + b, 0) / v.first.length);
                    const avg2 = Math.round(v.second.reduce((a, b) => a + b, 0) / v.second.length);
                    const delta = avg1 > 0 ? Math.round(((avg2 - avg1) / avg1) * 100) : 0;
                    return { plat, avg1, avg2, delta };
                })
                .sort((a, b) => b.delta - a.delta);

            /* ── Tag Evolution ── */
            const tagUsage = {};
            for (const p of posts) {
                const tags = p.tags || [];
                const m = metricsMap[p.id];
                const perf = perfScore(m);
                for (const t of tags) {
                    const tl = t.toLowerCase();
                    if (!tagUsage[tl]) tagUsage[tl] = { count: 0, totalPerf: 0, firstSeen: p.posted_at, lastSeen: p.posted_at };
                    tagUsage[tl].count++;
                    tagUsage[tl].totalPerf += perf;
                    tagUsage[tl].lastSeen = p.posted_at;
                }
            }
            const topTags = Object.entries(tagUsage)
                .map(([tag, data]) => ({ tag, ...data, avgPerf: data.count > 0 ? Math.round(data.totalPerf / data.count) : 0 }))
                .filter(t => t.count >= 2)
                .sort((a, b) => b.avgPerf - a.avgPerf);

            /* ── Platform Knowledge Depth ── */
            const platStats = {};
            for (const p of posts) {
                if (!platStats[p.platform]) platStats[p.platform] = { posts: 0, withMetrics: 0, withAI: 0, totalViews: 0, totalPerf: 0 };
                platStats[p.platform].posts++;
                if (metricsMap[p.id]) {
                    platStats[p.platform].withMetrics++;
                    platStats[p.platform].totalViews += metricsMap[p.id].views || 0;
                    platStats[p.platform].totalPerf += perfScore(metricsMap[p.id]);
                }
                const mdKey = p.id + ':' + p.platform;
                if (mdStatusMap[mdKey] && (mdStatusMap[mdKey].status === 'ready' || mdStatusMap[mdKey].status === 'edited')) {
                    platStats[p.platform].withAI++;
                }
            }

            /* ── Vibe stats ── */
            const vibeStats = {};
            for (const p of posts) {
                const v = p.meta?.vibe_preset || 'unknown';
                if (!vibeStats[v]) vibeStats[v] = { count: 0, totalPerf: 0, totalViews: 0 };
                vibeStats[v].count++;
                const m = metricsMap[p.id];
                if (m) {
                    vibeStats[v].totalPerf += perfScore(m);
                    vibeStats[v].totalViews += m.views || 0;
                }
            }

            /* ── Learning Milestones Timeline ── */
            const milestones = [];
            if (posts.length > 0)
                milestones.push({ date: posts[0].posted_at, icon: '🚀', label: 'First Post Published', detail: `"${posts[0].title}"` });
            const firstAIMeta = metadataEntries.find(md => md.status === 'ready' || md.status === 'edited');
            if (firstAIMeta)
                milestones.push({ date: firstAIMeta.created_at, icon: '🤖', label: 'AI Metadata Online', detail: `First AI-optimized ${firstAIMeta.platform} post` });
            if (posts.length >= 10)
                milestones.push({ date: posts[9].posted_at, icon: '📊', label: '10 Posts — Pattern Seed', detail: 'Enough data for basic pattern recognition' });
            if (exemplars.length > 0)
                milestones.push({ date: pmvEntries[0]?.created_at || posts[0].posted_at, icon: '⭐', label: 'Exemplars Active', detail: `AI identified ${exemplars.length} top performer${exemplars.length !== 1 ? 's' : ''} to learn from` });
            if (negExemplars.length > 0)
                milestones.push({ date: pmvEntries[0]?.created_at || posts[0].posted_at, icon: '🚫', label: 'Anti-Patterns Found', detail: `${negExemplars.length} underperformer${negExemplars.length !== 1 ? 's' : ''} identified — AI now avoids these styles` });
            if (posts.length >= 25)
                milestones.push({ date: posts[24].posted_at, icon: '🧠', label: '25 Posts — Deep Learning', detail: 'Robust pattern data across vibes, hooks, and tag combos' });
            if (posts.length >= 50)
                milestones.push({ date: posts[49].posted_at, icon: '🎓', label: '50 Posts — Expert Mode', detail: 'Full exemplar pool, negative patterns, optimized content lengths' });
            if (winningHooks > 0 || winningTags > 0)
                milestones.push({ date: patterns?.updated_at || new Date().toISOString(), icon: '🏆', label: 'Winning Patterns Computed', detail: `${winningHooks} hooks, ${winningTags} tags, ${winningCtas} CTAs locked in` });
            const nowISO = new Date().toISOString();
            milestones.push({ date: nowISO, icon: '📍', label: 'Now', detail: `${totalPosts} posts, ${totalExemplars} exemplars, ${winningTags} winning tags` });
            milestones.sort((a, b) => a.date.localeCompare(b.date));

            /* ── AI Intelligence Score (granular breakdown) ── */
            const iqBreakdown = [
                { label: 'Post Volume', pts: Math.min(totalPosts, 50), max: 50, tip: `${totalPosts} posted (need 50 for max)` },
                { label: 'Metric Coverage', pts: Math.min(postsWithMetrics, 50), max: 50, tip: `${postsWithMetrics}/${totalPosts} posts have performance data` },
                { label: 'AI Metadata', pts: Math.min(postsWithAIMeta, 30), max: 30, tip: `${postsWithAIMeta} posts have AI-generated metadata` },
                { label: 'Exemplars', pts: Math.min(totalExemplars, 10) * 3, max: 30, tip: `${totalExemplars}/10 positive exemplars discovered` },
                { label: 'Anti-Patterns', pts: Math.min(totalNegExemplars, 5) * 4, max: 20, tip: `${totalNegExemplars}/5 negative exemplars identified` },
                { label: 'Hook Patterns', pts: Math.min(winningHooks, 10) * 2, max: 20, tip: `${winningHooks}/10 winning hook styles learned` },
                { label: 'Winning Tags', pts: Math.min(winningTags, 15), max: 15, tip: `${winningTags}/15 top-performing tags identified` },
                { label: 'Vibe Diversity', pts: Math.min(uniqueVibes.size, 5) * 3, max: 15, tip: `${uniqueVibes.size}/5 unique vibes explored` },
                { label: 'Platform Spread', pts: Math.min(uniquePlatforms.size, 5) * 4, max: 20, tip: `${uniquePlatforms.size}/5 platforms covered` },
            ];
            const iqScore = Math.min(iqBreakdown.reduce((s, b) => s + b.pts, 0), 250);
            const iqMax = 250;
            const iqPct = Math.round((iqScore / iqMax) * 100);
            let iqLevel, iqColor;
            if (iqPct >= 80) { iqLevel = 'Expert'; iqColor = '#10b981'; }
            else if (iqPct >= 60) { iqLevel = 'Advanced'; iqColor = '#3b82f6'; }
            else if (iqPct >= 40) { iqLevel = 'Intermediate'; iqColor = '#f59e0b'; }
            else if (iqPct >= 20) { iqLevel = 'Learning'; iqColor = '#f97316'; }
            else { iqLevel = 'Beginner'; iqColor = '#ef4444'; }

            /* ── PROJECTION: Extrapolate weekly growth ── */
            const weekPerfs = weeks.map(([k, w]) => ({
                week: k,
                avgPerf: w.count > 0 ? w.perf / w.count : 0,
                avgViews: w.count > 0 ? w.views / w.count : 0,
                postRate: w.count,
            }));
            // Simple linear regression on weekly avg perf
            const projWeeks = 8; // project 8 weeks ahead
            let slope = 0, intercept = 0;
            if (weekPerfs.length >= 2) {
                const n = weekPerfs.length;
                const xs = weekPerfs.map((_, i) => i);
                const ys = weekPerfs.map(w => w.avgPerf);
                const xMean = xs.reduce((a, b) => a + b, 0) / n;
                const yMean = ys.reduce((a, b) => a + b, 0) / n;
                const num = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - yMean), 0);
                const den = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
                slope = den > 0 ? num / den : 0;
                intercept = yMean - slope * xMean;
            }
            const projected = [];
            for (let i = 0; i < projWeeks; i++) {
                const weekIdx = weekPerfs.length + i;
                const d = new Date(weeks.length ? weeks[weeks.length - 1][0] : now);
                d.setDate(d.getDate() + (i + 1) * 7);
                projected.push({
                    week: d.toISOString().slice(0, 10),
                    projPerf: Math.max(0, Math.round(slope * weekIdx + intercept)),
                    projViews: Math.max(0, Math.round(slope > 0 ? weekPerfs[weekPerfs.length - 1]?.avgViews * (1 + 0.05 * (i + 1)) : weekPerfs[weekPerfs.length - 1]?.avgViews || 0)),
                });
            }

            /* Also project IQ: estimate when each gap would close */
            const avgPostsPerWeek = totalPosts / Math.max(weeks.length, 1);
            const weeksToMaxPosts = Math.max(0, Math.ceil((50 - totalPosts) / Math.max(avgPostsPerWeek, 0.1)));
            const weeksTo100 = Math.max(0, Math.ceil((100 - totalPosts) / Math.max(avgPostsPerWeek, 0.1)));
            const projectedIqIn4w = Math.min(250, iqScore + Math.round(avgPostsPerWeek * 4) + (winningHooks === 0 ? 20 : 0));
            const projectedIqIn8w = Math.min(250, iqScore + Math.round(avgPostsPerWeek * 8) + (winningHooks === 0 ? 40 : 0));

            /* ── WHAT'S LACKING: gaps analysis ── */
            const gaps = [];
            // Metric gaps
            const noMetrics = posts.filter(p => !metricsMap[p.id]);
            if (noMetrics.length > 0) {
                gaps.push({
                    severity: noMetrics.length > 10 ? 'high' : 'medium',
                    icon: '📉',
                    title: `${noMetrics.length} posts missing metrics`,
                    detail: `These posts are invisible to the learning loop. The AI can't learn from posts without views/likes/comments data.`,
                    action: 'Connect platform analytics or wait for metrics sync to run.',
                });
            }
            // AI metadata gaps
            if (failedMeta > 0) {
                gaps.push({
                    severity: 'high',
                    icon: '❌',
                    title: `${failedMeta} failed AI metadata generations`,
                    detail: 'These posts didn\'t receive AI-optimized titles, tags, and descriptions.',
                    action: 'Retry failed metadata from the post editor or scripts.',
                });
            }
            if (pendingMeta > 0) {
                gaps.push({
                    severity: 'low',
                    icon: '⏳',
                    title: `${pendingMeta} pending AI metadata`,
                    detail: 'Metadata generation is queued but hasn\'t completed yet.',
                    action: 'These will process automatically. Check back soon.',
                });
            }
            // Winning patterns gap
            if (winningHooks === 0 && winningTags === 0 && winningCtas === 0) {
                gaps.push({
                    severity: 'high',
                    icon: '🏆',
                    title: 'No winning patterns computed yet',
                    detail: 'The nightly cron job (03:00 UTC) hasn\'t run yet, or there wasn\'t enough metric data. Winning patterns power the AI\'s strategy layer — hooks, tags, CTAs.',
                    action: 'This will populate automatically tonight. If it persists, check the cron schedule in Supabase.',
                });
            }
            // Exemplar gap
            if (totalExemplars < 3) {
                gaps.push({
                    severity: totalExemplars === 0 ? 'high' : 'medium',
                    icon: '⭐',
                    title: `Only ${totalExemplars} exemplar${totalExemplars !== 1 ? 's' : ''} (need 3+ for strong patterns)`,
                    detail: 'Exemplars are high-performing posts the AI studies to learn winning styles. More exemplars = more diverse learning.',
                    action: `Post ${3 - totalExemplars} more high-quality content and wait for metrics.`,
                });
            }
            // Neg exemplar gap
            if (totalNegExemplars === 0) {
                gaps.push({
                    severity: 'medium',
                    icon: '🚫',
                    title: 'No anti-patterns identified yet',
                    detail: 'The AI hasn\'t flagged any underperforming styles to avoid. It needs a wider range of performance data.',
                    action: 'Keep posting. The AI will identify anti-patterns as the performance spread widens.',
                });
            }
            // Platform coverage gaps
            const knownPlatforms = ['youtube_shorts', 'instagram_reels', 'facebook_reels', 'tiktok', 'threads'];
            const missingPlatforms = knownPlatforms.filter(p => !platStats[p]);
            if (missingPlatforms.length > 0) {
                gaps.push({
                    severity: 'low',
                    icon: '🌐',
                    title: `${missingPlatforms.length} platform${missingPlatforms.length !== 1 ? 's' : ''} with zero data`,
                    detail: `Not posting to: ${missingPlatforms.map(p => PLATFORM_LABELS[p] || p).join(', ')}. The AI can\'t learn platform-specific patterns without data.`,
                    action: 'Add these platforms to your posting schedule for broader AI learning.',
                });
            }
            // Thin platforms (< 5 posts)
            for (const [p, s] of Object.entries(platStats)) {
                if (s.posts < 5 && s.posts > 0) {
                    gaps.push({
                        severity: 'low',
                        icon: '📊',
                        title: `${PLATFORM_LABELS[p] || p}: only ${s.posts} post${s.posts !== 1 ? 's' : ''}`,
                        detail: `Need at least 5 posts for reliable platform-specific patterns. Currently at ${s.posts}.`,
                        action: `Post ${5 - s.posts} more on ${PLATFORM_LABELS[p] || p}.`,
                    });
                }
            }
            // Vibe diversity gap
            if (uniqueVibes.size < 3) {
                gaps.push({
                    severity: 'medium',
                    icon: '🎨',
                    title: `Only ${uniqueVibes.size} vibe preset${uniqueVibes.size !== 1 ? 's' : ''} explored`,
                    detail: 'More vibe diversity helps the AI understand what tone works best for different content.',
                    action: 'Try additional vibe presets in your next campaign.',
                });
            }
            // Post volume gap
            if (totalPosts < 50) {
                gaps.push({
                    severity: totalPosts < 20 ? 'medium' : 'low',
                    icon: '📚',
                    title: `${totalPosts}/50 posts toward Expert mode`,
                    detail: `The AI reaches full pattern confidence around 50 posts. You're ${Math.round(totalPosts / 50 * 100)}% there.`,
                    action: `Keep posting! ~${weeksToMaxPosts} week${weeksToMaxPosts !== 1 ? 's' : ''} at current pace.`,
                });
            }
            // Sort gaps by severity
            const sevOrder = { high: 0, medium: 1, low: 2 };
            gaps.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

            // ══════════════════════════════════════════════════
            //  BUILD HTML
            // ══════════════════════════════════════════════════

            let html = '<div class="ai-learn">';

            /* ── AI Intelligence Score (enhanced with breakdown) ── */
            html += `
            <div class="ai-learn__iq">
                <div class="ai-learn__iq-ring" style="--iq-pct:${iqPct};--iq-color:${iqColor}">
                    <div class="ai-learn__iq-inner">
                        <span class="ai-learn__iq-score">${iqScore}</span>
                        <span class="ai-learn__iq-max">/ ${iqMax}</span>
                    </div>
                </div>
                <div class="ai-learn__iq-info">
                    <h3 class="ai-learn__iq-level" style="color:${iqColor}">${iqLevel}</h3>
                    <p class="ai-learn__iq-desc">Your AI has analyzed <strong>${totalPosts} posts</strong> across <strong>${uniquePlatforms.size} platform${uniquePlatforms.size !== 1 ? 's' : ''}</strong> and <strong>${uniqueVibes.size} vibe${uniqueVibes.size !== 1 ? 's' : ''}</strong>. It knows <strong>${winningTags} winning tag pattern${winningTags !== 1 ? 's' : ''}</strong>, <strong>${winningHooks} top hook style${winningHooks !== 1 ? 's' : ''}</strong>, and has <strong>${totalExemplars} active exemplar${totalExemplars !== 1 ? 's' : ''}</strong> guiding future content.</p>
                    <div class="ai-learn__iq-breakdown">`;
            for (const b of iqBreakdown) {
                const bPct = Math.round((b.pts / b.max) * 100);
                const bColor = bPct >= 80 ? '#10b981' : bPct >= 50 ? '#3b82f6' : bPct >= 25 ? '#f59e0b' : '#ef4444';
                html += `<div class="ai-learn__iq-bar-row" title="${escHtml(b.tip)}">
                    <span class="ai-learn__iq-bar-label">${b.label}</span>
                    <div class="ai-learn__iq-bar-bg"><div class="ai-learn__iq-bar-fill" style="width:${bPct}%;background:${bColor}"></div></div>
                    <span class="ai-learn__iq-bar-pts">${b.pts}/${b.max}</span>
                </div>`;
            }
            html += `</div></div></div>`;

            /* ── Key Numbers Strip ── */
            html += `
            <div class="ai-learn__stats">
                <div class="ai-learn__stat">
                    <span class="ai-learn__stat-value">${fmt(totalViews)}</span>
                    <span class="ai-learn__stat-label">Total Views</span>
                </div>
                <div class="ai-learn__stat">
                    <span class="ai-learn__stat-value">${engagementRate}%</span>
                    <span class="ai-learn__stat-label">Engagement Rate</span>
                </div>
                <div class="ai-learn__stat">
                    <span class="ai-learn__stat-value">${fmt(avgPerf)}</span>
                    <span class="ai-learn__stat-label">Avg Perf Score</span>
                </div>
                <div class="ai-learn__stat ${perfDelta >= 0 ? 'ai-learn__stat--up' : 'ai-learn__stat--down'}">
                    <span class="ai-learn__stat-value">${perfDelta >= 0 ? '+' : ''}${perfDelta}%</span>
                    <span class="ai-learn__stat-label">${perfDelta >= 0 ? 'Improving' : 'Declining'} (2nd half)</span>
                </div>
                <div class="ai-learn__stat">
                    <span class="ai-learn__stat-value">${postsWithAIMeta}</span>
                    <span class="ai-learn__stat-label">AI-Optimized</span>
                </div>
                <div class="ai-learn__stat">
                    <span class="ai-learn__stat-value">${totalExemplars + totalNegExemplars}</span>
                    <span class="ai-learn__stat-label">Training Signals</span>
                </div>
            </div>`;

            /* ── Learning Acceleration (first half vs second half) ── */
            html += `
            <div class="ai-learn__acceleration">
                <h4 class="ai-learn__section-title">⚡ Learning Acceleration</h4>`;
            if (accelDataTooFresh) {
                html += `
                <div class="ai-learn__accel-fresh-notice">
                    <span class="ai-learn__accel-fresh-icon">⏳</span>
                    <div class="ai-learn__accel-fresh-body">
                        <strong>Not enough mature data yet</strong>
                        <p>Only <b>${maturePosts.length}</b> of your ${posts.length} posts are older than ${MATURITY_DAYS} days.
                        ${immatureCount > 0 ? `<b>${immatureCount}</b> recent posts are excluded because their metrics are still accumulating — comparing them would make it look like performance is declining when it isn't.` : ''}
                        Check back once more posts have had a week to gather views, likes, and comments.</p>
                    </div>
                </div>`;
            } else {
                html += `
                <p class="ai-learn__section-sub">Comparing first ${firstHalf.length} vs most recent ${secondHalf.length} posts — only includes posts older than ${MATURITY_DAYS} days so metrics are fair.${immatureCount > 0 ? ` <span class="ai-learn__accel-excluded">(${immatureCount} recent posts excluded — too new for accurate metrics)</span>` : ''}</p>
                <div class="ai-learn__accel-grid">
                    <div class="ai-learn__accel-card">
                        <div class="ai-learn__accel-label">First Half (older)</div>
                        <div class="ai-learn__accel-val">${fmt(firstHalfPerf)}</div>
                        <div class="ai-learn__accel-sub">avg perf score</div>
                    </div>
                    <div class="ai-learn__accel-arrow ${perfDelta >= 0 ? 'ai-learn__accel-arrow--up' : 'ai-learn__accel-arrow--down'}">
                        <span>${perfDelta >= 0 ? '↑' : '↓'} ${Math.abs(perfDelta)}%</span>
                    </div>
                    <div class="ai-learn__accel-card ai-learn__accel-card--highlight">
                        <div class="ai-learn__accel-label">Second Half (recent)</div>
                        <div class="ai-learn__accel-val">${fmt(secondHalfPerf)}</div>
                        <div class="ai-learn__accel-sub">avg perf score</div>
                    </div>
                </div>`;
                // Per-platform acceleration breakdown
                if (platAccelArr.length > 0) {
                    html += `
                    <div class="ai-learn__accel-platforms">
                        <h5 class="ai-learn__accel-plat-title">Per-Platform Acceleration</h5>
                        <div class="ai-learn__accel-plat-grid">`;
                    for (const pa of platAccelArr) {
                        const platLabel = pa.plat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                        html += `
                            <div class="ai-learn__accel-plat-row">
                                <span class="ai-learn__accel-plat-name">${platLabel}</span>
                                <span class="ai-learn__accel-plat-vals">${fmt(pa.avg1)} → ${fmt(pa.avg2)}</span>
                                <span class="ai-learn__accel-plat-delta ${pa.delta >= 0 ? 'ai-learn__stat--up' : 'ai-learn__stat--down'}">${pa.delta >= 0 ? '↑' : '↓'} ${Math.abs(pa.delta)}%</span>
                            </div>`;
                    }
                    html += `</div></div>`;
                }
            }
            html += `</div>`;

            /* ── Projection Section ── */
            html += `
            <div class="ai-learn__projection">
                <h4 class="ai-learn__section-title">🔮 Intelligence Projection (Next ${projWeeks} Weeks)</h4>
                <p class="ai-learn__section-sub">Based on current posting rate (${avgPostsPerWeek.toFixed(1)} posts/week) and performance trend (slope: ${slope >= 0 ? '+' : ''}${slope.toFixed(1)}/week).</p>
                <div class="ai-learn__proj-chart">`;
            // Combine actual + projected in one bar chart
            const allChartWeeks = [
                ...weeks.map(([k, w]) => ({ week: k, avgPerf: w.count > 0 ? Math.round(w.perf / w.count) : 0, type: 'actual', count: w.count })),
                ...projected.map(p => ({ week: p.week, avgPerf: p.projPerf, type: 'projected', count: 0 })),
            ];
            const chartMax = Math.max(...allChartWeeks.map(w => w.avgPerf), 1);
            for (const cw of allChartWeeks) {
                const pct = Math.round((cw.avgPerf / chartMax) * 100);
                const weekLabel = new Date(cw.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                html += `<div class="ai-learn__proj-col ${cw.type === 'projected' ? 'ai-learn__proj-col--future' : ''}">
                    <div class="ai-learn__proj-bar-wrap">
                        <div class="ai-learn__proj-bar ${cw.type === 'projected' ? 'ai-learn__proj-bar--dashed' : ''}" style="height:${Math.max(pct, 4)}%">
                            <span class="ai-learn__proj-bar-val">${fmt(cw.avgPerf)}</span>
                        </div>
                    </div>
                    <span class="ai-learn__proj-label">${weekLabel}</span>
                    <span class="ai-learn__proj-type">${cw.type === 'projected' ? 'proj' : cw.count + 'p'}</span>
                </div>`;
            }
            html += `</div>`;

            // IQ projection cards
            html += `
                <div class="ai-learn__proj-cards">
                    <div class="ai-learn__proj-card">
                        <span class="ai-learn__proj-card-when">In 4 Weeks</span>
                        <span class="ai-learn__proj-card-val">${projectedIqIn4w}</span>
                        <span class="ai-learn__proj-card-label">Projected IQ</span>
                    </div>
                    <div class="ai-learn__proj-card">
                        <span class="ai-learn__proj-card-when">In 8 Weeks</span>
                        <span class="ai-learn__proj-card-val">${projectedIqIn8w}</span>
                        <span class="ai-learn__proj-card-label">Projected IQ</span>
                    </div>
                    <div class="ai-learn__proj-card">
                        <span class="ai-learn__proj-card-when">Expert Mode</span>
                        <span class="ai-learn__proj-card-val">~${weeksToMaxPosts}w</span>
                        <span class="ai-learn__proj-card-label">${weeksToMaxPosts > 0 ? 'weeks away' : 'REACHED!'}</span>
                    </div>
                </div>
            </div>`;

            /* ── What's Lacking (Gaps & Actions) ── */
            html += `
            <div class="ai-learn__gaps">
                <h4 class="ai-learn__section-title">⚠️ What's Lacking — Gaps & Actions</h4>
                <p class="ai-learn__section-sub">${gaps.length === 0 ? 'No major gaps detected! Your AI is running at full capacity.' : `Found ${gaps.length} gap${gaps.length !== 1 ? 's' : ''} that are limiting AI intelligence.`}</p>`;
            if (gaps.length === 0) {
                html += `<div class="ai-learn__gap-empty">✅ All systems optimal — your AI has everything it needs to generate high-quality metadata.</div>`;
            } else {
                html += `<div class="ai-learn__gap-list">`;
                for (const g of gaps) {
                    html += `<div class="ai-learn__gap ai-learn__gap--${g.severity}">
                        <div class="ai-learn__gap-icon">${g.icon}</div>
                        <div class="ai-learn__gap-body">
                            <div class="ai-learn__gap-title">${escHtml(g.title)}</div>
                            <div class="ai-learn__gap-detail">${escHtml(g.detail)}</div>
                            <div class="ai-learn__gap-action">💡 ${escHtml(g.action)}</div>
                        </div>
                        <div class="ai-learn__gap-sev">${g.severity.toUpperCase()}</div>
                    </div>`;
                }
                html += `</div>`;
            }
            html += `</div>`;

            /* ── Learning Timeline ── */
            html += `<div class="ai-learn__timeline">
                <h4 class="ai-learn__section-title">🧬 Learning Timeline</h4>
                <div class="ai-learn__timeline-track">`;
            for (const ms of milestones) {
                const d = new Date(ms.date);
                const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const isNow = ms.label === 'Now';
                html += `<div class="ai-learn__milestone ${isNow ? 'ai-learn__milestone--now' : ''}">
                    <div class="ai-learn__milestone-dot">${ms.icon}</div>
                    <div class="ai-learn__milestone-content">
                        <strong>${ms.label}</strong>
                        <span class="ai-learn__milestone-date">${dateStr}</span>
                        <span class="ai-learn__milestone-detail">${escHtml(ms.detail)}</span>
                    </div>
                </div>`;
            }
            html += `</div></div>`;

            /* ── Performance Trend by Week ── */
            html += `<div class="ai-learn__perf-chart">
                <h4 class="ai-learn__section-title">📈 Weekly Performance (avg views/post)</h4>
                <div class="ai-learn__bars">`;
            for (const [weekKey, w] of weeks) {
                const avgViews = w.count > 0 ? Math.round(w.views / w.count) : 0;
                const pct = Math.round((avgViews / maxWeekViews) * 100);
                const aiPct = w.count > 0 ? Math.round((w.withAI / w.count) * 100) : 0;
                const weekLabel = new Date(weekKey).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                html += `<div class="ai-learn__bar-col">
                    <div class="ai-learn__bar-wrapper">
                        <div class="ai-learn__bar" style="height:${Math.max(pct, 4)}%">
                            <span class="ai-learn__bar-value">${fmt(avgViews)}</span>
                        </div>
                    </div>
                    <span class="ai-learn__bar-label">${weekLabel}</span>
                    <span class="ai-learn__bar-sub">${w.count}p · ${aiPct}% AI</span>
                </div>`;
            }
            html += `</div></div>`;

            /* ── Vibe Performance ── */
            const vibeEntries = Object.entries(vibeStats).sort((a, b) => b[1].totalPerf - a[1].totalPerf);
            if (vibeEntries.length > 1) {
                html += `<div class="ai-learn__vibes">
                    <h4 class="ai-learn__section-title">🎭 Vibe Performance Breakdown</h4>
                    <div class="ai-learn__vibe-grid">`;
                const maxVibePerf = vibeEntries[0][1].count > 0 ? vibeEntries[0][1].totalPerf / vibeEntries[0][1].count : 1;
                for (const [vibe, vs] of vibeEntries) {
                    const vAvg = vs.count > 0 ? Math.round(vs.totalPerf / vs.count) : 0;
                    const barW = Math.max(Math.round((vAvg / maxVibePerf) * 100), 5);
                    html += `<div class="ai-learn__vibe-row">
                        <span class="ai-learn__vibe-name">${escHtml(vibe)}</span>
                        <div class="ai-learn__tag-bar-bg"><div class="ai-learn__tag-bar" style="width:${barW}%"></div></div>
                        <span class="ai-learn__tag-meta">${vs.count} posts · avg ${fmt(vAvg)}</span>
                    </div>`;
                }
                html += `</div></div>`;
            }

            /* ── Tag Intelligence ── */
            html += `<div class="ai-learn__tags">
                <h4 class="ai-learn__section-title">🏷️ Tag Intelligence (used 2+×, ranked by avg perf)</h4>
                <div class="ai-learn__tag-grid">`;
            const maxTagPerf = topTags.length ? topTags[0].avgPerf : 1;
            for (const t of topTags.slice(0, 20)) {
                const barW = Math.max(Math.round((t.avgPerf / maxTagPerf) * 100), 5);
                const isWinning = (patterns?.top_hashtags || []).some(wt => wt.tag?.toLowerCase() === t.tag);
                html += `<div class="ai-learn__tag-row">
                    <span class="ai-learn__tag-name ${isWinning ? 'ai-learn__tag-name--winning' : ''}">#${escHtml(t.tag)}</span>
                    <div class="ai-learn__tag-bar-bg"><div class="ai-learn__tag-bar" style="width:${barW}%"></div></div>
                    <span class="ai-learn__tag-meta">${t.count}× · avg ${fmt(t.avgPerf)}</span>
                </div>`;
            }
            html += `</div></div>`;

            /* ── Platform Knowledge Depth ── */
            html += `<div class="ai-learn__platforms">
                <h4 class="ai-learn__section-title">🌐 Knowledge Depth by Platform</h4>
                <div class="ai-learn__plat-grid">`;
            for (const [p, stats] of Object.entries(platStats).sort((a, b) => b[1].posts - a[1].posts)) {
                const platLabel = PLATFORM_LABELS[p] || p;
                const platColor = PLATFORM_COLORS[p] || '#6b7280';
                const metricCoverage = stats.posts > 0 ? Math.round((stats.withMetrics / stats.posts) * 100) : 0;
                const aiCoverage = stats.posts > 0 ? Math.round((stats.withAI / stats.posts) * 100) : 0;
                const avgPlatPerf = stats.withMetrics > 0 ? Math.round(stats.totalPerf / stats.withMetrics) : 0;
                const confidence = stats.posts >= 20 ? 'High' : stats.posts >= 10 ? 'Medium' : stats.posts >= 5 ? 'Low' : 'Insufficient';
                html += `<div class="ai-learn__plat-card" style="border-top:3px solid ${platColor}">
                    <div class="ai-learn__plat-name" style="color:${platColor}">${platLabel}</div>
                    <div class="ai-learn__plat-stats">
                        <div class="ai-learn__plat-row"><span>Posts</span><strong>${stats.posts}</strong></div>
                        <div class="ai-learn__plat-row"><span>Metric Coverage</span><strong>${metricCoverage}%</strong></div>
                        <div class="ai-learn__plat-row"><span>AI Metadata</span><strong>${aiCoverage}%</strong></div>
                        <div class="ai-learn__plat-row"><span>Avg Perf Score</span><strong>${fmt(avgPlatPerf)}</strong></div>
                        <div class="ai-learn__plat-row"><span>Total Views</span><strong>${fmt(stats.totalViews)}</strong></div>
                        <div class="ai-learn__plat-row"><span>AI Confidence</span><strong>${confidence}</strong></div>
                    </div>
                    <div class="ai-learn__plat-coverage">
                        <div class="ai-learn__plat-coverage-bar" style="width:${aiCoverage}%;background:${platColor}"></div>
                    </div>
                </div>`;
            }
            html += `</div></div>`;

            /* ── What the AI Currently Knows (Brain) ── */
            html += `<div class="ai-learn__brain">
                <h4 class="ai-learn__section-title">🧠 What Your AI Currently Knows</h4>
                <div class="ai-learn__brain-grid">`;

            // Hook knowledge
            const topHooks = patterns?.top_hooks || [];
            if (topHooks.length) {
                html += `<div class="ai-learn__brain-card">
                    <div class="ai-learn__brain-card-title">Top Hook Patterns</div>
                    <ul class="ai-learn__brain-list">`;
                for (const h of topHooks.slice(0, 5)) {
                    html += `<li><span class="ai-learn__brain-hook">"${escHtml(h.hook?.slice(0, 60) || '—')}"</span> <span class="ai-learn__brain-perf">${fmt(h.perf)}</span></li>`;
                }
                html += `</ul></div>`;
            }

            // CTA knowledge
            const topCtas = patterns?.top_ctas || [];
            if (topCtas.length) {
                html += `<div class="ai-learn__brain-card">
                    <div class="ai-learn__brain-card-title">Top CTA Patterns</div>
                    <ul class="ai-learn__brain-list">`;
                for (const c of topCtas.slice(0, 5)) {
                    html += `<li><span class="ai-learn__brain-hook">"${escHtml(c.cta?.slice(0, 60) || '—')}"</span> <span class="ai-learn__brain-perf">${fmt(c.perf)}</span></li>`;
                }
                html += `</ul></div>`;
            }

            // Optimal lengths
            if (patterns?.length_stats) {
                const ls = patterns.length_stats;
                html += `<div class="ai-learn__brain-card">
                    <div class="ai-learn__brain-card-title">Optimal Content Lengths</div>
                    <ul class="ai-learn__brain-list">
                        <li>Title: <strong>~${Math.round(ls.avg_title_len || 0)} chars</strong></li>
                        <li>Description: <strong>~${Math.round(ls.avg_desc_len || 0)} chars</strong></li>
                        <li>Tags: <strong>~${Math.round(ls.avg_tag_count || 0)} per post</strong></li>
                    </ul>
                </div>`;
            }

            // Exemplar details
            if (exemplars.length) {
                html += `<div class="ai-learn__brain-card">
                    <div class="ai-learn__brain-card-title">Active Exemplars (style guides)</div>
                    <ul class="ai-learn__brain-list">`;
                for (const e of exemplars.slice(0, 5)) {
                    const title = e.fields?.title || e.fields?.caption || e.metadata_snapshot?.title || '—';
                    html += `<li><span class="ai-learn__brain-hook">"${escHtml(String(title).slice(0, 50))}"</span> <span class="ai-learn__brain-perf">${fmt(e.performance_value)}</span></li>`;
                }
                html += `</ul></div>`;
            }

            // Anti-patterns
            if (negExemplars.length) {
                html += `<div class="ai-learn__brain-card ai-learn__brain-card--neg">
                    <div class="ai-learn__brain-card-title">Anti-Patterns (avoid these)</div>
                    <ul class="ai-learn__brain-list">`;
                for (const e of negExemplars.slice(0, 3)) {
                    const title = e.fields?.title || e.fields?.caption || e.metadata_snapshot?.title || '—';
                    html += `<li><span class="ai-learn__brain-hook">"${escHtml(String(title).slice(0, 50))}"</span> <span class="ai-learn__brain-perf ai-learn__brain-perf--neg">${fmt(e.performance_value)}</span></li>`;
                }
                html += `</ul></div>`;
            }

            // If brain is empty
            if (!topHooks.length && !topCtas.length && !patterns?.length_stats && !exemplars.length && !negExemplars.length) {
                html += `<div class="ai-learn__brain-card ai-learn__brain-card--empty">
                    <div class="ai-learn__brain-card-title">Brain is still learning…</div>
                    <p style="color:var(--color-text-muted);font-size:0.8rem;margin:0">The AI hasn't accumulated enough data yet to show concrete patterns. Keep posting and collecting metrics — patterns will emerge within the next few days.</p>
                </div>`;
            }

            html += `</div></div>`; // close brain

            html += '</div>'; // close ai-learn
            container.innerHTML = html;

        } catch (err) {
            console.error('[AI Intelligence] loadAILearningGrowth error:', err);
            container.innerHTML = '<div class="ai-empty">Failed to load AI learning data.</div>';
        }
    }

    function getTimeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const mins = Math.floor(diffMs / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days === 1) return 'yesterday';
        if (days < 7) return `${days} days ago`;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

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
                        if (v >= 0 && dailyData[date][plf] !== undefined) {
                            const color = PLATFORM_COLORS[plf] || '#6b7280';
                            const label = PLATFORM_LABELS[plf] || plf;
                            tooltipRows += `<div class="daily-perf__tooltip-row">
                                <span class="daily-perf__tooltip-dot" style="background:${color}"></span>
                                ${label}: ${v > 0 ? fmt(v) : '0 views (posted)'}
                            </div>`;
                        }
                    }

                    // Bar segments (bottom-to-top)
                    let segmentsHTML = '';
                    for (const plf of platformList) {
                        const v = dayData[plf] || 0;
                        if (dailyData[date][plf] !== undefined) {
                            const h = v > 0 ? Math.max(4, (v / maxDayTotal) * 160) : 3;
                            const opacity = v === 0 ? ' opacity:0.4;' : '';
                            segmentsHTML += `<div class="daily-perf__segment daily-perf__segment--${plf}" style="height:${h}px;${opacity}" title="${PLATFORM_LABELS[plf] || plf}: ${v > 0 ? fmt(v) : '0 views'}"></div>`;
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
            const { data: rawData, error } = await supabase
                .from('v_cross_platform_performance')
                .select('*')
                .eq('brand_id', currentBrandId);

            if (error || !rawData?.length) {
                container.innerHTML = '<div class="ai-empty">No cross-platform data yet. Post to multiple platforms to see comparisons.</div>';
                return;
            }

            // Aggregate per-post rows into per-platform summaries
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
