// =====================================================
// DASHBOARD APPLICATION
// Main entry point for the dashboard/hub page
// =====================================================

class Dashboard {
    constructor() {
        this.sidebar = null;
        this.stats = {
            totalVideos: 0,
            totalBrands: 1, // Starting with horror
            pendingJobs: 0,
            todayViews: 0
        };
        this.recentActivity = [];
    }

    /**
     * Initialize the dashboard
     */
    async init() {
        console.log('🚀 Initializing ContentEngine Dashboard');

        // Initialize sidebar
        this.sidebar = new Sidebar({
            selector: '.sidebar',
            toggleSelector: '.sidebar-toggle'
        });

        // Load stats from Supabase
        await this.loadStats();

        // Load recent activity
        await this.loadRecentActivity();

        // Set up event listeners
        this.setupEventListeners();

        console.log('✅ Dashboard initialized');
    }

    /**
     * Load statistics from Supabase
     */
    async loadStats() {
        try {
            if (typeof supabase === 'undefined' || !supabase) {
                console.warn('Supabase not available, using placeholder stats');
                this.updateStatsUI();
                return;
            }

            // Get total completed videos
            const { count: totalVideos } = await supabase
                .from('jobs')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'complete');

            // Get pending jobs
            const { count: pendingJobs } = await supabase
                .from('jobs')
                .select('*', { count: 'exact', head: true })
                .in('status', ['pending', 'processing']);

            this.stats.totalVideos = totalVideos || 0;
            this.stats.pendingJobs = pendingJobs || 0;

            this.updateStatsUI();
        } catch (error) {
            console.error('Failed to load stats:', error);
            this.updateStatsUI();
        }
    }

    /**
     * Update stats UI elements
     */
    updateStatsUI() {
        const statsElements = {
            'stat-total-videos': this.stats.totalVideos,
            'stat-total-brands': this.stats.totalBrands,
            'stat-pending-jobs': this.stats.pendingJobs,
            'stat-today-views': this.stats.todayViews
        };

        Object.entries(statsElements).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = value.toLocaleString();
            }
        });
    }

    /**
     * Load recent activity
     */
    async loadRecentActivity() {
        const activityContainer = document.getElementById('recent-activity');
        if (!activityContainer) return;

        try {
            if (typeof supabase === 'undefined' || !supabase) {
                activityContainer.innerHTML = `
                    <div class="empty-state">
                        <p>No recent activity</p>
                    </div>
                `;
                return;
            }

            const { data: jobs, error } = await supabase
                .from('jobs')
                .select('id, brand, status, created_at, story_title')
                .order('created_at', { ascending: false })
                .limit(5);

            if (error) throw error;

            if (!jobs || jobs.length === 0) {
                activityContainer.innerHTML = `
                    <div class="empty-state">
                        <p>No recent activity</p>
                        <p class="text-muted">Generate your first video to get started!</p>
                    </div>
                `;
                return;
            }

            activityContainer.innerHTML = jobs.map(job => `
                <div class="activity-item">
                    <div class="activity-item__icon activity-item__icon--${job.status}">
                        ${this.getStatusIcon(job.status)}
                    </div>
                    <div class="activity-item__content">
                        <div class="activity-item__title">${job.story_title || 'Untitled Video'}</div>
                        <div class="activity-item__meta">
                            <span class="badge badge--${job.brand || 'default'}">${job.brand || 'horror'}</span>
                            <span class="text-muted">${formatRelativeTime(job.created_at)}</span>
                        </div>
                    </div>
                    <span class="badge badge--${this.getStatusClass(job.status)}">${job.status}</span>
                </div>
            `).join('');

        } catch (error) {
            console.error('Failed to load activity:', error);
            activityContainer.innerHTML = `
                <div class="empty-state">
                    <p>Failed to load activity</p>
                </div>
            `;
        }
    }

    /**
     * Get status icon SVG
     */
    getStatusIcon(status) {
        const icons = {
            complete: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 6L9 17l-5-5"/>
            </svg>`,
            processing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
            </svg>`,
            pending: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 8v4M12 16h.01"/>
            </svg>`,
            error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M15 9l-6 6M9 9l6 6"/>
            </svg>`
        };
        return icons[status] || icons.pending;
    }

    /**
     * Get status badge class
     */
    getStatusClass(status) {
        const classes = {
            complete: 'success',
            processing: 'warning',
            pending: 'info',
            error: 'error'
        };
        return classes[status] || 'default';
    }

    /**
     * Set up event listeners
     */
    setupEventListeners() {
        // Refresh stats button
        const refreshBtn = document.getElementById('refresh-stats');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.disabled = true;
                refreshBtn.innerHTML = '<span class="spinner spinner--small"></span>';
                await this.loadStats();
                await this.loadRecentActivity();
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = 'Refresh';
            });
        }

        // Brand card clicks
        document.querySelectorAll('.brand-card:not(.brand-card--disabled)').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('a')) return; // Let links work normally
                const link = card.querySelector('a');
                if (link) {
                    window.location.href = link.href;
                }
            });
        });
    }
}

// Utility function (in case not loaded from utils.js)
if (typeof formatRelativeTime === 'undefined') {
    function formatRelativeTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;
        
        return date.toLocaleDateString();
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new Dashboard();
    window.dashboard.init();
});
