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

    // ─── 8. Recent Post Insights ─────────────────────────────────────

    async function loadRecentPostInsights() {
        const container = el('recent-posts-container');
        if (!container) return;
        container.innerHTML = '<div class="ai-loading">Loading recent post insights…</div>';

        try {
            // 1. Fetch recent posted posts for this brand (all platforms)
            let postQuery = supabase
                .from('posts')
                .select('id, title, description, tags, platform, status, posted_at, video_url, job_id, meta, batch_id')
                .eq('brand_id', currentBrandId)
                .eq('status', 'posted')
                .order('posted_at', { ascending: false })
                .limit(20);

            if (platformFilter()) {
                postQuery = postQuery.eq('platform', platformFilter());
            }

            const { data: posts, error: postErr } = await postQuery;
            if (postErr || !posts?.length) {
                container.innerHTML = '<div class="ai-empty">No posted content yet. Publish some posts to see insights here.</div>';
                return;
            }

            // 2. Fetch metrics for all these posts in one batch
            const postIds = posts.map(p => p.id);
            const { data: allMetrics } = await supabase
                .from('v_post_metrics_latest')
                .select('post_id, platform, views, likes, comments, shares, saves, collected_at')
                .in('post_id', postIds);

            const metricsMap = {};
            for (const m of (allMetrics || [])) {
                metricsMap[m.post_id] = m;
            }

            // 3. Deduplicate by job_id to get "per-story" groups
            const jobGroups = {};
            for (const p of posts) {
                const key = p.job_id || p.id;
                if (!jobGroups[key]) {
                    jobGroups[key] = { title: p.title, posts: [], totalViews: 0, totalLikes: 0, totalComments: 0, totalShares: 0, earliestPosted: p.posted_at, meta: p.meta };
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

            // 4. Fetch winning patterns for AI comparison
            const plat = platformFilter() || 'youtube_shorts';
            const { data: patternsData } = await supabase.rpc('get_winning_patterns', {
                p_brand_id: currentBrandId,
                p_platform: plat,
                p_vibe_preset: null,
            });
            const patterns = patternsData?.[0] || null;

            // 5. Compute brand-wide averages from all metrics
            const allPosts = Object.values(jobGroups);
            const postsWithMetrics = allPosts.filter(g => g.totalViews > 0 || g.totalLikes > 0);
            const brandAvg = {
                views: postsWithMetrics.length ? Math.round(postsWithMetrics.reduce((s, g) => s + g.totalViews, 0) / postsWithMetrics.length) : 0,
                likes: postsWithMetrics.length ? Math.round(postsWithMetrics.reduce((s, g) => s + g.totalLikes, 0) / postsWithMetrics.length) : 0,
                comments: postsWithMetrics.length ? Math.round(postsWithMetrics.reduce((s, g) => s + g.totalComments, 0) / postsWithMetrics.length) : 0,
            };

            // 6. Build HTML
            const sortedGroups = Object.entries(jobGroups).sort((a, b) => {
                return new Date(b[1].earliestPosted) - new Date(a[1].earliestPosted);
            });

            let html = '';

            // Summary header
            html += `
                <div class="insights-summary">
                    <div class="insights-summary__stat">
                        <span class="insights-summary__value">${sortedGroups.length}</span>
                        <span class="insights-summary__label">Recent Stories</span>
                    </div>
                    <div class="insights-summary__stat">
                        <span class="insights-summary__value">${fmt(brandAvg.views)}</span>
                        <span class="insights-summary__label">Avg Views/Story</span>
                    </div>
                    <div class="insights-summary__stat">
                        <span class="insights-summary__value">${fmt(brandAvg.likes)}</span>
                        <span class="insights-summary__label">Avg Likes/Story</span>
                    </div>
                    <div class="insights-summary__stat">
                        <span class="insights-summary__value">${fmt(brandAvg.comments)}</span>
                        <span class="insights-summary__label">Avg Comments/Story</span>
                    </div>
                </div>
            `;

            // Per-story insight cards
            html += '<div class="insights-list">';
            for (const [jobId, group] of sortedGroups) {
                const postedDate = new Date(group.earliestPosted);
                const dateStr = postedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const timeStr = postedDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                const vibePreset = group.meta?.vibe_preset || 'default';

                // Performance score (views + 5*likes + 10*comments + 10*shares)
                const perfScore = group.totalViews + 5 * group.totalLikes + 10 * group.totalComments + 10 * group.totalShares;
                const avgPerfScore = brandAvg.views + 5 * brandAvg.likes + 10 * brandAvg.comments;

                // Determine performance tier
                let perfTier, perfClass, perfIcon;
                if (avgPerfScore === 0 || perfScore >= avgPerfScore * 1.3) {
                    perfTier = 'Above Average';
                    perfClass = 'perf--high';
                    perfIcon = '&#9650;'; // ▲
                } else if (perfScore >= avgPerfScore * 0.7) {
                    perfTier = 'Average';
                    perfClass = 'perf--mid';
                    perfIcon = '&#9644;'; // ▬
                } else {
                    perfTier = 'Below Average';
                    perfClass = 'perf--low';
                    perfIcon = '&#9660;'; // ▼
                }

                // What went well / what didn't
                const wellList = [];
                const poorList = [];
                const learnedList = [];
                const forwardList = [];

                // Analyze views relative to average
                if (brandAvg.views > 0) {
                    const viewRatio = group.totalViews / brandAvg.views;
                    if (viewRatio >= 1.3) {
                        wellList.push(`Strong reach — ${fmt(group.totalViews)} views (${Math.round((viewRatio - 1) * 100)}% above avg)`);
                        learnedList.push('This story had high discoverability; the hook/title drew attention');
                    } else if (viewRatio < 0.7) {
                        poorList.push(`Low reach — ${fmt(group.totalViews)} views (${Math.round((1 - viewRatio) * 100)}% below avg)`);
                        learnedList.push('The title or thumbnail may not be grabbing attention. Consider more curiosity-driven hooks');
                    }
                }

                // Analyze engagement rate (likes+comments per view)
                if (group.totalViews > 0) {
                    const engRate = ((group.totalLikes + group.totalComments) / group.totalViews) * 100;
                    const avgEngRate = brandAvg.views > 0 ? ((brandAvg.likes + brandAvg.comments) / brandAvg.views) * 100 : 0;
                    if (engRate >= avgEngRate * 1.3 || engRate > 5) {
                        wellList.push(`High engagement rate — ${engRate.toFixed(1)}% (${group.totalLikes} likes, ${group.totalComments} comments)`);
                        learnedList.push('Viewers are connecting with this content style');
                    } else if (engRate < avgEngRate * 0.7 && group.totalViews > 50) {
                        poorList.push(`Low engagement rate — ${engRate.toFixed(1)}%`);
                        learnedList.push('Views without engagement may indicate clickbait or story didn\'t hold interest');
                    }
                }

                // Analyze shares
                if (group.totalShares > 0) {
                    wellList.push(`${group.totalShares} shares — content is being recommended`);
                }

                // Check vibe_preset influence
                if (vibePreset !== 'default') {
                    const vibeLabel = vibePreset.replace(/_/g, ' ');
                    if (perfTier === 'Above Average') {
                        wellList.push(`"${vibeLabel}" vibe preset resonated well with the audience`);
                        forwardList.push(`Continue using "${vibeLabel}" style for similar stories`);
                    } else if (perfTier === 'Below Average') {
                        poorList.push(`"${vibeLabel}" vibe underperformed compared to other presets`);
                        forwardList.push(`Consider testing different vibe presets instead of "${vibeLabel}"`);
                    }
                }

                // AI influence section
                let aiInfluenceHTML = '';
                if (patterns) {
                    const topHook = patterns.top_hooks?.[0]?.hook;
                    const topTags = patterns.top_hashtags?.slice(0, 3).map(t => '#' + t.tag).join(', ');
                    aiInfluenceHTML = `
                        <div class="insight-influence">
                            <h5 class="insight-influence__title">How AI Data Influenced This Post</h5>
                            <ul class="insight-influence__list">
                                ${topHook ? `<li><span class="insight-influence__tag">Top Hook</span> The winning hook pattern "${escHtml(topHook.slice(0, 80))}…" was injected as an exemplar for the AI to learn from</li>` : ''}
                                ${topTags ? `<li><span class="insight-influence__tag">Top Tags</span> Best-performing tags ${topTags} were used as reference patterns</li>` : ''}
                                ${patterns.length_stats ? `<li><span class="insight-influence__tag">Optimal Length</span> AI targeted ~${Math.round(patterns.length_stats.avg_desc_len || 0)} char descriptions based on top performers</li>` : ''}
                                <li><span class="insight-influence__tag">Diversity</span> Story DNA system ensured unique theme/threat/setting combo</li>
                            </ul>
                        </div>
                    `;
                }

                // Forward strategy
                if (forwardList.length === 0) {
                    if (perfTier === 'Above Average') {
                        forwardList.push('Replicate this content style in upcoming posts');
                        forwardList.push('This post\'s metadata will be promoted as an exemplar for AI generation');
                    } else if (perfTier === 'Below Average') {
                        forwardList.push('AI will deprioritize patterns from this post in future generations');
                        forwardList.push('Testing different hook styles and posting times');
                    } else {
                        forwardList.push('Continue monitoring as metrics accumulate');
                        forwardList.push('The AI learning loop will incorporate these results at the next pattern refresh');
                    }
                }

                // Platform badges
                const platformBadges = group.posts.map(p => {
                    const m = p.metrics;
                    const views = m ? fmt(m.views) : '—';
                    const platName = (p.platform || '').replace('_reels', '').replace('_shorts', '');
                    return `<span class="insight-platform-badge insight-platform-badge--${p.platform}" title="${m ? `Views: ${m.views}, Likes: ${m.likes}, Comments: ${m.comments}` : 'No metrics yet'}">
                        ${platName} <span class="insight-platform-badge__views">${views}</span>
                    </span>`;
                }).join('');

                html += `
                    <div class="insight-card">
                        <div class="insight-card__header">
                            <div class="insight-card__title-row">
                                <h4 class="insight-card__title">${escHtml(group.title)}</h4>
                                <span class="insight-card__perf ${perfClass}" title="Performance: ${perfScore}">
                                    ${perfIcon} ${perfTier}
                                </span>
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

                        ${aiInfluenceHTML}

                        <div class="insight-card__analysis">
                            ${wellList.length ? `
                                <div class="insight-section insight-section--well">
                                    <h5 class="insight-section__title">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                                        What Went Well
                                    </h5>
                                    <ul class="insight-section__list">${wellList.map(w => `<li>${w}</li>`).join('')}</ul>
                                </div>
                            ` : ''}

                            ${poorList.length ? `
                                <div class="insight-section insight-section--poor">
                                    <h5 class="insight-section__title">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                                        What Didn't Go Well
                                    </h5>
                                    <ul class="insight-section__list">${poorList.map(w => `<li>${w}</li>`).join('')}</ul>
                                </div>
                            ` : ''}

                            ${learnedList.length ? `
                                <div class="insight-section insight-section--learned">
                                    <h5 class="insight-section__title">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                                        What Was Learned
                                    </h5>
                                    <ul class="insight-section__list">${learnedList.map(w => `<li>${w}</li>`).join('')}</ul>
                                </div>
                            ` : ''}

                            <div class="insight-section insight-section--forward">
                                <h5 class="insight-section__title">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                                    Going Forward
                                </h5>
                                <ul class="insight-section__list">${forwardList.map(w => `<li>${w}</li>`).join('')}</ul>
                            </div>
                        </div>
                    </div>
                `;
            }

            html += '</div>';
            container.innerHTML = html;

        } catch (err) {
            console.error('[AI Intelligence] loadRecentPostInsights error:', err);
            container.innerHTML = '<div class="ai-empty">Failed to load post insights. Please try again.</div>';
        }
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
