// =====================================================
// SERVICES INDEX
// Central initialization and export for all services
// =====================================================

/**
 * ContentEngine - Main application controller
 */
class ContentEngine {
    constructor() {
        this.initialized = false;
        this.version = '1.0.0';
    }

    /**
     * Initialize all services
     */
    async init() {
        if (this.initialized) return;

        try {
            // Initialize brand manager (with Supabase sync)
            await brandManager.init();
            
            // Load other persisted data
            accountManager.load();
            postManager.load();
            scheduler.load();

            // Initialize defaults if needed
            await brandManager.initializeDefaults();

            // Set up event listeners
            this.setupEventListeners();

            // Start scheduler (can be disabled in settings)
            if (this.shouldAutoSchedule()) {
                scheduler.start();
            }

            this.initialized = true;

            // Dispatch ready event
            window.dispatchEvent(new CustomEvent('contentengine:ready'));

        } catch (error) {
            console.error('ContentEngine init failed:', error);
            throw error;
        }
    }

    /**
     * Set up global event listeners
     */
    setupEventListeners() {
        // Persist on visibility change (user leaving page)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.persist();
            }
        });

        // Persist before unload
        window.addEventListener('beforeunload', () => {
            this.persist();
        });

        // Listen for brand changes
        brandManager.on('brand:activated', (brand) => {
            console.log(`🏷️ Switched to brand: ${brand.name}`);
        });

        // Listen for post events
        postManager.on('post:published', (post) => {
            console.log(`✅ Published: ${post.content.title} to ${post.platformId}`);
            if (typeof toast !== 'undefined') {
                toast.success(`Posted to ${post.platformId}!`);
            }
        });

        postManager.on('post:failed', ({ post, error }) => {
            console.error(`❌ Failed to post: ${error}`);
            if (typeof toast !== 'undefined') {
                toast.error(`Failed to post: ${error}`);
            }
        });
    }

    /**
     * Persist all data
     */
    persist() {
        brandManager.persist();
        accountManager.persist();
        postManager.persist();
        scheduler.persist();
    }

    /**
     * Check if auto-scheduling is enabled
     */
    shouldAutoSchedule() {
        const setting = localStorage.getItem('contentengine_auto_schedule');
        return setting !== 'false';
    }

    /**
     * Enable/disable auto-scheduling
     */
    setAutoSchedule(enabled) {
        localStorage.setItem('contentengine_auto_schedule', String(enabled));
        if (enabled) {
            scheduler.start();
        } else {
            scheduler.stop();
        }
    }

    /**
     * Get global statistics
     */
    getStats() {
        const brands = brandManager.getAll();
        const posts = postManager.getAll();
        const accounts = accountManager.getAll();

        return {
            totalBrands: brands.length,
            activeBrands: brands.filter(b => b.status === 'active').length,
            totalPosts: posts.length,
            postsToday: postManager.getStats().postsToday,
            postsThisWeek: postManager.getStats().postsThisWeek,
            queuedPosts: postManager.getQueued().length,
            scheduledPosts: postManager.getScheduled().length,
            failedPosts: postManager.getFailed().length,
            totalAccounts: accounts.length,
            activeAccounts: accounts.filter(a => a.isActive()).length,
            platforms: [...new Set(accounts.map(a => a.platformId))].length
        };
    }

    /**
     * Get upcoming posts for dashboard
     * @param {number} limit - Max posts to return
     */
    getUpcomingPosts(limit = 10) {
        return postManager.getScheduled().slice(0, limit);
    }

    /**
     * Get recent activity for dashboard
     * @param {number} limit - Max items to return
     */
    getRecentActivity(limit = 10) {
        const allPosts = postManager.getAll()
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, limit);

        return allPosts.map(post => ({
            type: 'post',
            status: post.status,
            title: post.content.title || 'Untitled',
            brandId: post.brandId,
            platformId: post.platformId,
            timestamp: post.updatedAt,
            post
        }));
    }
}

// Create singleton instance
const contentEngine = new ContentEngine();

// Expose to window for pages to check initialization
window.contentEngine = contentEngine;

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => contentEngine.init());
    } else {
        contentEngine.init();
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { 
        ContentEngine, 
        contentEngine,
        brandManager,
        accountManager,
        postManager,
        scheduler,
        PlatformAPIFactory
    };
}
