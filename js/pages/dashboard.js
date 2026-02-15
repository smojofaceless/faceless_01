// =====================================================
// DASHBOARD PAGE CONTROLLER
// Live dashboard with real Supabase data
// =====================================================

(function() {
    'use strict';

    let sb = null; // Supabase client
    let activeBrandId = null;
    let refreshTimer = null;

    // ── Helpers ──────────────────────────────────────
    function fmt(n) {
        if (n == null) return '0';
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toLocaleString();
    }

    function platformLabel(p) {
        const m = {
            youtube_shorts: 'YouTube', instagram_reels: 'Instagram',
            facebook_reels: 'Facebook', tiktok: 'TikTok',
            youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook'
        };
        return m[p] || p;
    }

    function platformColor(p) {
        const m = {
            youtube_shorts: '#FF4444', youtube: '#FF4444',
            instagram_reels: '#E1306C', instagram: '#E1306C',
            facebook_reels: '#1877F2', facebook: '#1877F2',
            tiktok: '#00f2ea', tiktok_videos: '#00f2ea'
        };
        return m[p] || '#8b5cf6';
    }

    function platformBadgeClass(p) {
        const m = {
            youtube_shorts: 'youtube', youtube: 'youtube',
            instagram_reels: 'instagram', instagram: 'instagram',
            facebook_reels: 'facebook', facebook: 'facebook',
            tiktok: 'tiktok'
        };
        return m[p] || '';
    }

    function statusBadgeClass(s) {
        return { posted: 'success', scheduled: 'warning', approved: 'info',
                 posting: 'warning', failed: 'error', draft: 'default',
                 cancelled: 'default' }[s] || 'default';
    }

    function statusIcon(s) {
        const icons = {
            posted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
            scheduled: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
            approved: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
            posting: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
            failed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'
        };
        return icons[s] || icons.approved;
    }

    function timeStr(ts) {
        if (!ts) return '--';
        const d = new Date(ts);
        const now = new Date();
        const diff = d - now;
        const abs = Math.abs(diff);
        const past = diff < 0;
        const mins = Math.floor(abs / 60000);
        const hrs = Math.floor(mins / 60);
        const days = Math.floor(hrs / 24);
        if (mins < 1) return past ? 'Just now' : 'Now';
        if (mins < 60) return past ? `${mins}m ago` : `In ${mins}m`;
        if (hrs < 24) return past ? `${hrs}h ago` : `In ${hrs}h`;
        if (days < 7) return past ? `${days}d ago` : `In ${days}d`;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function scheduleStr(ts) {
        if (!ts) return '--';
        const d = new Date(ts);
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const isToday = d.toDateString() === today.toDateString();
        const isTomorrow = d.toDateString() === tomorrow.toDateString();
        const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        if (isToday) return `Today ${time}`;
        if (isTomorrow) return `Tomorrow ${time}`;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + time;
    }

    // ── Init ────────────────────────────────────────
    async function init() {
        console.log('🚀 Initializing Dashboard');

        // Sidebar
        if (typeof Sidebar !== 'undefined') new Sidebar();

        // Wait for Supabase
        sb = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
        if (!sb) {
            console.warn('Dashboard: No Supabase client');
            showError('Unable to connect to database');
            return;
        }

        // Initialize brand manager (needs Supabase ready)
        if (typeof brandManager !== 'undefined' && brandManager.init) {
            await brandManager.init();
        }

        // Brand switcher (needs brandManager initialized)
        if (typeof BrandSwitcher !== 'undefined') {
            const switcher = new BrandSwitcher({ onSelect: onBrandChange });
            switcher.init();
        }

        // Get active brand
        await resolveActiveBrand();

        // Load everything
        await loadDashboard();

        // Auto-refresh every 60s
        refreshTimer = setInterval(() => loadDashboard(), 60000);

        console.log('✅ Dashboard ready');
    }

    async function resolveActiveBrand() {
        try {
            const { data } = await sb.from('brands').select('id').eq('is_active', true).limit(1);
            if (data && data.length) {
                activeBrandId = data[0].id;
            } else {
                const { data: any } = await sb.from('brands').select('id').limit(1);
                if (any && any.length) activeBrandId = any[0].id;
            }
        } catch (e) {
            console.error('resolveActiveBrand:', e);
        }
    }

    function onBrandChange(brand) {
        activeBrandId = brand?.id || brand;
        loadDashboard();
    }

    async function loadDashboard() {
        await Promise.all([
            loadStats(),
            loadUpcomingPosts(),
            loadPlatformStatus(),
            loadBrandOverview(),
            loadRecentActivity(),
            loadPerformanceOverview()
        ]);
    }

    function showError(msg) {
        const el = document.querySelector('.content');
        if (el) el.innerHTML = `<div class="empty-state"><p>${msg}</p></div>`;
    }

    // ── Stats Cards ─────────────────────────────────
    async function loadStats() {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString();

        const brandFilter = activeBrandId ? `&brand_id=eq.${activeBrandId}` : '';

        try {
            // Parallel queries
            const [todayRes, weekRes, scheduledRes, failedRes, queueRes, nextPostRes] = await Promise.all([
                // Posted today
                sb.from('posts').select('id', { count: 'exact', head: true })
                    .eq('status', 'posted')
                    .gte('posted_at', todayStart)
                    .then(r => r),
                // Posted this week
                sb.from('posts').select('id', { count: 'exact', head: true })
                    .eq('status', 'posted')
                    .gte('posted_at', weekStart)
                    .then(r => r),
                // Scheduled
                sb.from('posts').select('id', { count: 'exact', head: true })
                    .in('status', ['scheduled', 'approved'])
                    .then(r => r),
                // Failed
                sb.from('posts').select('id', { count: 'exact', head: true })
                    .eq('status', 'failed')
                    .then(r => r),
                // Queue total for status bar
                sb.from('posts').select('id', { count: 'exact', head: true })
                    .in('status', ['scheduled', 'approved', 'posting'])
                    .then(r => r),
                // Next scheduled post
                sb.from('posts').select('scheduled_at')
                    .in('status', ['scheduled', 'approved'])
                    .not('scheduled_at', 'is', null)
                    .gte('scheduled_at', now.toISOString())
                    .order('scheduled_at', { ascending: true })
                    .limit(1)
                    .then(r => r)
            ]);

            setText('stat-posts-today', todayRes.count || 0);
            setText('stat-week', weekRes.count || 0);
            setText('stat-scheduled', scheduledRes.count || 0);
            setText('stat-failed', failedRes.count || 0);
            setText('queue-count', `${queueRes.count || 0} posts`);

            const qBadge = document.getElementById('queue-badge');
            if (qBadge) qBadge.textContent = queueRes.count || '';

            // Next post
            const nextEl = document.getElementById('next-post-status');
            if (nextEl) {
                const nextPost = nextPostRes.data?.[0];
                nextEl.querySelector('.status-bar__value').textContent =
                    nextPost ? scheduleStr(nextPost.scheduled_at) : 'None scheduled';
            }
        } catch (e) {
            console.error('loadStats:', e);
        }
    }

    function setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = typeof val === 'number' ? val.toLocaleString() : val;
    }

    // ── Upcoming Posts ───────────────────────────────
    async function loadUpcomingPosts() {
        const container = document.getElementById('upcoming-posts');
        if (!container) return;

        try {
            const { data: posts, error } = await sb
                .from('posts')
                .select('id, title, platform, scheduled_at, status, brand_id')
                .in('status', ['scheduled', 'approved'])
                .not('scheduled_at', 'is', null)
                .order('scheduled_at', { ascending: true })
                .limit(6);

            if (error) throw error;

            if (!posts || posts.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <p>No scheduled posts</p>
                        <p class="text-muted">Create content and schedule it to see it here</p>
                    </div>`;
                return;
            }

            container.innerHTML = posts.map(p => `
                <div class="post-item" data-post-id="${p.id}">
                    <div class="post-item__time">${scheduleStr(p.scheduled_at)}</div>
                    <div class="post-item__content">
                        <div class="post-item__title">${p.title || 'Untitled'}</div>
                        <div class="post-item__meta">
                            <span class="platform-badge platform-badge--${platformBadgeClass(p.platform)}">${platformLabel(p.platform)}</span>
                        </div>
                    </div>
                    <span class="badge badge--${statusBadgeClass(p.status)}">${p.status}</span>
                </div>
            `).join('');
        } catch (e) {
            console.error('loadUpcomingPosts:', e);
            container.innerHTML = '<div class="empty-state"><p>Failed to load posts</p></div>';
        }
    }

    // ── Platform Status ─────────────────────────────
    async function loadPlatformStatus() {
        const container = document.getElementById('platform-status');
        if (!container) return;
        const list = container.querySelector('.platform-list') || container;

        try {
            const { data: tokens, error } = await sb
                .from('platform_tokens')
                .select('platform, is_valid, platform_channel_name, last_used_at, last_error')
                .order('platform');

            if (error) throw error;

            // All known platforms
            const allPlatforms = [
                { id: 'youtube', name: 'YouTube Shorts', color: '#FF4444' },
                { id: 'instagram', name: 'Instagram Reels', color: '#E1306C' },
                { id: 'facebook', name: 'Facebook Reels', color: '#1877F2' },
                { id: 'tiktok', name: 'TikTok', color: '#00f2ea' }
            ];

            const tokenMap = {};
            if (tokens) tokens.forEach(t => tokenMap[t.platform] = t);

            list.innerHTML = allPlatforms.map(p => {
                const tok = tokenMap[p.id];
                const connected = tok?.is_valid === true;
                const channelName = tok?.platform_channel_name || '';
                const lastError = tok && !tok.is_valid && tok.last_error ? tok.last_error : '';
                const statusLabel = connected ? 'Connected' : (tok ? 'Disconnected' : 'Not set up');

                return `
                    <div class="platform-item">
                        <div class="platform-item__icon" style="background: ${p.color}15; color: ${p.color}">
                            ${p.name.charAt(0)}
                        </div>
                        <div class="platform-item__info">
                            <span class="platform-item__name">${p.name}</span>
                            ${channelName ? `<span class="platform-item__channel">${channelName}</span>` : ''}
                            ${lastError ? `<span class="platform-item__error">${lastError.slice(0, 50)}</span>` : ''}
                        </div>
                        <div class="platform-item__status-wrap">
                            <span class="platform-item__status ${connected ? 'platform-item__status--connected' : 'platform-item__status--disconnected'}">
                                ${connected ? '●' : '○'}
                            </span>
                            <span class="platform-item__status-label ${connected ? 'text-success' : 'text-muted'}">${statusLabel}</span>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (e) {
            console.error('loadPlatformStatus:', e);
            list.innerHTML = '<div class="empty-state"><p>Failed to load platforms</p></div>';
        }
    }

    // ── Brand Overview ──────────────────────────────
    async function loadBrandOverview() {
        const container = document.getElementById('brand-overview');
        if (!container) return;

        try {
            // Get brands
            const { data: brands, error } = await sb
                .from('brands')
                .select('id, name, niche, slug, is_active, theme')
                .order('is_active', { ascending: false });

            if (error) throw error;

            if (!brands || brands.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <p>No brands configured</p>
                        <a href="pages/brands.html" class="btn btn--sm btn--primary">Add Brand</a>
                    </div>`;
                return;
            }

            // Get post counts per brand in parallel
            const countPromises = brands.map(b =>
                sb.from('posts').select('id', { count: 'exact', head: true })
                    .eq('brand_id', b.id).eq('status', 'posted')
            );
            const counts = await Promise.all(countPromises);

            container.innerHTML = brands.map((b, i) => {
                const color = b.theme?.primaryColor || '#8b5cf6';
                const postCount = counts[i]?.count || 0;
                return `
                    <div class="brand-item ${b.is_active ? 'brand-item--active' : ''}">
                        <div class="brand-item__indicator" style="background: ${color}"></div>
                        <div class="brand-item__info">
                            <span class="brand-item__name">${b.name}</span>
                            <span class="brand-item__niche">${b.niche || 'General'}</span>
                        </div>
                        <div class="brand-item__stats">
                            <span>${postCount} posted</span>
                            ${b.is_active ? '<span class="badge badge--success" style="margin-left:6px">Active</span>' : ''}
                        </div>
                    </div>
                `;
            }).join('');
        } catch (e) {
            console.error('loadBrandOverview:', e);
            container.innerHTML = '<div class="empty-state"><p>Failed to load brands</p></div>';
        }
    }

    // ── Recent Activity ─────────────────────────────
    async function loadRecentActivity() {
        const container = document.getElementById('recent-activity');
        if (!container) return;

        try {
            const { data: posts, error } = await sb
                .from('posts')
                .select('id, title, platform, status, posted_at, failed_at, updated_at, scheduled_at')
                .in('status', ['posted', 'failed', 'scheduled', 'posting', 'approved'])
                .order('updated_at', { ascending: false })
                .limit(8);

            if (error) throw error;

            if (!posts || posts.length === 0) {
                container.innerHTML = '<div class="empty-state"><p>No recent activity</p><p class="text-muted">Posts will appear here as they are created and published</p></div>';
                return;
            }

            container.innerHTML = `<div class="activity-list">${posts.map(p => {
                const ts = p.posted_at || p.failed_at || p.updated_at;
                return `
                    <div class="activity-item">
                        <div class="activity-item__icon activity-item__icon--${p.status}">
                            ${statusIcon(p.status)}
                        </div>
                        <div class="activity-item__content">
                            <div class="activity-item__title">${p.title || 'Untitled'}</div>
                            <div class="activity-item__meta">
                                <span class="platform-badge platform-badge--${platformBadgeClass(p.platform)}">${platformLabel(p.platform)}</span>
                                <span class="text-muted">${timeStr(ts)}</span>
                            </div>
                        </div>
                        <span class="badge badge--${statusBadgeClass(p.status)}">${p.status}</span>
                    </div>
                `;
            }).join('')}</div>`;
        } catch (e) {
            console.error('loadRecentActivity:', e);
            container.innerHTML = '<div class="empty-state"><p>Failed to load activity</p></div>';
        }
    }

    // ── Performance Overview ────────────────────────
    async function loadPerformanceOverview() {
        const container = document.getElementById('performance-overview');
        if (!container) return;

        try {
            // Get latest metrics for all posted posts
            const { data: metrics, error } = await sb
                .from('v_post_metrics_latest')
                .select('post_id, platform, views, likes, comments, shares, saves');

            if (error) throw error;

            if (!metrics || metrics.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <p>No performance data yet</p>
                        <p class="text-muted">Metrics appear after posts are published</p>
                    </div>`;
                return;
            }

            // Aggregate totals
            const totals = metrics.reduce((acc, m) => ({
                views: acc.views + (m.views || 0),
                likes: acc.likes + (m.likes || 0),
                comments: acc.comments + (m.comments || 0),
                shares: acc.shares + (m.shares || 0),
                saves: acc.saves + (m.saves || 0)
            }), { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 });

            const engagement = totals.likes + totals.comments + totals.shares + totals.saves;

            // Per-platform breakdown
            const byPlatform = {};
            metrics.forEach(m => {
                if (!byPlatform[m.platform]) byPlatform[m.platform] = { views: 0, likes: 0, posts: 0 };
                byPlatform[m.platform].views += m.views || 0;
                byPlatform[m.platform].likes += m.likes || 0;
                byPlatform[m.platform].posts++;
            });

            // Top 3 posts by views
            const topPosts = [...metrics].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 3);

            // Get titles for top posts
            let topWithTitles = topPosts;
            if (topPosts.length > 0) {
                const postIds = topPosts.map(p => p.post_id);
                const { data: postData } = await sb
                    .from('posts')
                    .select('id, title')
                    .in('id', postIds);
                if (postData) {
                    const titleMap = {};
                    postData.forEach(p => titleMap[p.id] = p.title);
                    topWithTitles = topPosts.map(p => ({ ...p, title: titleMap[p.post_id] || 'Untitled' }));
                }
            }

            container.innerHTML = `
                <!-- Totals Row -->
                <div class="perf-totals">
                    <div class="perf-total">
                        <span class="perf-total__value">${fmt(totals.views)}</span>
                        <span class="perf-total__label">Total Views</span>
                    </div>
                    <div class="perf-total">
                        <span class="perf-total__value">${fmt(engagement)}</span>
                        <span class="perf-total__label">Engagements</span>
                    </div>
                    <div class="perf-total">
                        <span class="perf-total__value">${metrics.length}</span>
                        <span class="perf-total__label">Posts Tracked</span>
                    </div>
                    <div class="perf-total">
                        <span class="perf-total__value">${totals.views > 0 ? Math.round(totals.views / metrics.length) : 0}</span>
                        <span class="perf-total__label">Avg Views</span>
                    </div>
                </div>

                <!-- Platform Breakdown -->
                <div class="perf-platforms">
                    ${Object.entries(byPlatform).map(([plat, d]) => `
                        <div class="perf-platform-row">
                            <span class="platform-badge platform-badge--${platformBadgeClass(plat)}">${platformLabel(plat)}</span>
                            <div class="perf-platform-bar-wrap">
                                <div class="perf-platform-bar" style="width: ${totals.views > 0 ? Math.round(d.views / totals.views * 100) : 0}%; background: ${platformColor(plat)}"></div>
                            </div>
                            <span class="perf-platform-stat">${fmt(d.views)} views</span>
                        </div>
                    `).join('')}
                </div>

                <!-- Top Posts -->
                ${topWithTitles.length > 0 ? `
                    <div class="perf-top-label">Top Performing</div>
                    <div class="perf-top-posts">
                        ${topWithTitles.map((p, i) => `
                            <div class="perf-top-post">
                                <span class="perf-top-post__rank">#${i + 1}</span>
                                <div class="perf-top-post__info">
                                    <span class="perf-top-post__title">${p.title || 'Untitled'}</span>
                                    <span class="platform-badge platform-badge--${platformBadgeClass(p.platform)}" style="font-size:10px">${platformLabel(p.platform)}</span>
                                </div>
                                <span class="perf-top-post__views">${fmt(p.views)} views</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            `;
        } catch (e) {
            console.error('loadPerformanceOverview:', e);
            container.innerHTML = '<div class="empty-state"><p>Failed to load performance data</p></div>';
        }
    }

    // ── Kick off ────────────────────────────────────
    document.addEventListener('DOMContentLoaded', init);

})();
