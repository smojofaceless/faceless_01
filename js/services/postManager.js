// =====================================================
// POST MANAGER SERVICE
// Handles post creation, queue management, and publishing
// =====================================================

/**
 * Post Manager - central service for managing posts
 */
class PostManager {
    constructor() {
        this.posts = new Map();       // In-memory post store
        this.listeners = new Map();    // Event listeners
        this.publishingQueue = [];     // Posts currently being published
        this.isProcessing = false;
    }

    // ==================== CRUD Operations ====================

    /**
     * Create a new post
     * @param {Object} data - Post data
     * @returns {Post}
     */
    create(data) {
        const post = new Post(data);
        this.posts.set(post.id, post);
        this.emit('post:created', post);
        this.persist();
        return post;
    }

    /**
     * Get a post by ID
     * @param {string} id - Post ID
     * @returns {Post|null}
     */
    get(id) {
        return this.posts.get(id) || null;
    }

    /**
     * Update a post
     * @param {string} id - Post ID
     * @param {Object} updates - Updates to apply
     * @returns {Post|null}
     */
    update(id, updates) {
        const post = this.posts.get(id);
        if (!post) return null;
        
        Object.keys(updates).forEach(key => {
            if (key === 'content') {
                post.updateContent(updates.content);
            } else if (key in post && key !== 'id') {
                post[key] = updates[key];
            }
        });
        post.updatedAt = new Date();
        
        this.emit('post:updated', post);
        this.persist();
        return post;
    }

    /**
     * Delete a post
     * @param {string} id - Post ID
     * @returns {boolean}
     */
    delete(id) {
        const post = this.posts.get(id);
        if (!post) return false;
        
        this.posts.delete(id);
        this.emit('post:deleted', { id, post });
        this.persist();
        return true;
    }

    // ==================== Query Methods ====================

    /**
     * Get all posts
     * @returns {Post[]}
     */
    getAll() {
        return Array.from(this.posts.values());
    }

    /**
     * Get posts by brand
     * @param {string} brandId - Brand ID
     * @returns {Post[]}
     */
    getByBrand(brandId) {
        return this.getAll().filter(p => p.brandId === brandId);
    }

    /**
     * Get posts by platform
     * @param {string} platformId - Platform ID
     * @returns {Post[]}
     */
    getByPlatform(platformId) {
        return this.getAll().filter(p => p.platformId === platformId);
    }

    /**
     * Get posts by status
     * @param {string} status - Post status
     * @returns {Post[]}
     */
    getByStatus(status) {
        return this.getAll().filter(p => p.status === status);
    }

    /**
     * Get queued posts
     * @returns {Post[]}
     */
    getQueued() {
        return this.getByStatus(POST_STATUS.QUEUED);
    }

    /**
     * Get scheduled posts
     * @returns {Post[]}
     */
    getScheduled() {
        return this.getByStatus(POST_STATUS.SCHEDULED)
            .sort((a, b) => a.scheduledAt - b.scheduledAt);
    }

    /**
     * Get posts scheduled for a date range
     * @param {Date} start - Start date
     * @param {Date} end - End date
     * @param {Object} filters - Optional filters (brandId, platformId)
     * @returns {Post[]}
     */
    getScheduledInRange(start, end, filters = {}) {
        return this.getAll().filter(post => {
            if (!post.scheduledAt) return false;
            if (post.scheduledAt < start || post.scheduledAt > end) return false;
            if (filters.brandId && post.brandId !== filters.brandId) return false;
            if (filters.platformId && post.platformId !== filters.platformId) return false;
            return true;
        }).sort((a, b) => a.scheduledAt - b.scheduledAt);
    }

    /**
     * Get failed posts
     * @returns {Post[]}
     */
    getFailed() {
        return this.getByStatus(POST_STATUS.FAILED);
    }

    /**
     * Get recent posts (last N days)
     * @param {number} days - Number of days
     * @returns {Post[]}
     */
    getRecent(days = 7) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        return this.getAll()
            .filter(p => p.publishedAt && p.publishedAt >= cutoff)
            .sort((a, b) => b.publishedAt - a.publishedAt);
    }

    // ==================== Post Actions ====================

    /**
     * Queue a post for publishing
     * @param {string} id - Post ID
     */
    queue(id) {
        const post = this.get(id);
        if (!post) return;
        
        post.queue();
        this.emit('post:queued', post);
        this.persist();
    }

    /**
     * Schedule a post
     * @param {string} id - Post ID
     * @param {Date|string} datetime - Scheduled time
     * @param {string} timezone - Timezone
     */
    schedule(id, datetime, timezone) {
        const post = this.get(id);
        if (!post) return;
        
        post.schedule(datetime, timezone);
        this.emit('post:scheduled', post);
        this.persist();
    }

    /**
     * Cancel a post
     * @param {string} id - Post ID
     */
    cancel(id) {
        const post = this.get(id);
        if (!post) return;
        
        post.cancel();
        this.emit('post:cancelled', post);
        this.persist();
    }

    /**
     * Retry a failed post
     * @param {string} id - Post ID
     */
    retry(id) {
        const post = this.get(id);
        if (!post || !post.canRetry()) return;
        
        post.retry();
        this.emit('post:retry', post);
        this.persist();
    }

    // ==================== Publishing ====================

    /**
     * Publish a post immediately
     * @param {string} id - Post ID
     * @param {PlatformAccount} account - Platform account to use
     * @returns {Promise<Object>} Publish result
     */
    async publish(id, account) {
        const post = this.get(id);
        if (!post) throw new Error('Post not found');

        const platform = getPlatform(post.platformId);
        if (!platform) throw new Error('Platform not found');

        // Validate content
        const validation = platform.validateContent(post.content);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Mark as publishing
        post.markPublishing();
        this.emit('post:publishing', post);
        this.persist();

        try {
            // Get API adapter
            const api = PlatformAPIFactory.create(platform, account);
            
            // Publish
            const result = await api.publish(post);
            
            // Mark as published
            post.markPublished(result);
            this.emit('post:published', post);
            this.persist();
            
            return { success: true, post, result };
        } catch (error) {
            // Mark as failed
            post.markFailed(error);
            this.emit('post:failed', { post, error });
            this.persist();
            
            return { success: false, post, error: error.message };
        }
    }

    /**
     * Process scheduled posts that are due
     * @param {Function} getAccount - Function to get account for brandId/platformId
     */
    async processScheduledPosts(getAccount) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const now = new Date();
            const duePosts = this.getScheduled().filter(p => p.scheduledAt <= now);

            for (const post of duePosts) {
                const account = getAccount(post.brandId, post.platformId);
                if (!account || !account.isActive()) {
                    post.markFailed('No active account for publishing');
                    this.persist();
                    continue;
                }

                await this.publish(post.id, account);
            }
        } finally {
            this.isProcessing = false;
        }
    }

    // ==================== Persistence ====================

    /**
     * Save posts to localStorage
     */
    persist() {
        try {
            const data = this.getAll().map(p => p.toJSON());
            localStorage.setItem('contentengine_posts', JSON.stringify(data));
        } catch (e) {
            console.error('Failed to persist posts:', e);
        }
    }

    /**
     * Load posts from localStorage
     */
    load() {
        try {
            const data = localStorage.getItem('contentengine_posts');
            if (data) {
                const posts = JSON.parse(data);
                posts.forEach(p => {
                    const post = Post.fromJSON(p);
                    this.posts.set(post.id, post);
                });
            }
        } catch (e) {
            console.error('Failed to load posts:', e);
        }
    }

    // ==================== Events ====================

    /**
     * Subscribe to events
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    /**
     * Unsubscribe from events
     * @param {string} event - Event name
     * @param {Function} callback - Callback to remove
     */
    off(event, callback) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) callbacks.splice(index, 1);
        }
    }

    /**
     * Emit an event
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    emit(event, data) {
        const callbacks = this.listeners.get(event) || [];
        callbacks.forEach(cb => {
            try {
                cb(data);
            } catch (e) {
                console.error(`Error in ${event} listener:`, e);
            }
        });
    }

    // ==================== Statistics ====================

    /**
     * Get post statistics
     * @param {Object} filters - Optional filters
     * @returns {Object}
     */
    getStats(filters = {}) {
        let posts = this.getAll();
        
        if (filters.brandId) {
            posts = posts.filter(p => p.brandId === filters.brandId);
        }
        if (filters.platformId) {
            posts = posts.filter(p => p.platformId === filters.platformId);
        }

        const byStatus = {};
        Object.values(POST_STATUS).forEach(status => {
            byStatus[status] = posts.filter(p => p.status === status).length;
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const postsToday = posts.filter(p => 
            p.publishedAt && p.publishedAt >= today
        ).length;

        const thisWeek = new Date();
        thisWeek.setDate(thisWeek.getDate() - 7);
        const postsThisWeek = posts.filter(p =>
            p.publishedAt && p.publishedAt >= thisWeek
        ).length;

        return {
            total: posts.length,
            byStatus,
            postsToday,
            postsThisWeek,
            queued: byStatus[POST_STATUS.QUEUED] || 0,
            scheduled: byStatus[POST_STATUS.SCHEDULED] || 0,
            published: byStatus[POST_STATUS.PUBLISHED] || 0,
            failed: byStatus[POST_STATUS.FAILED] || 0
        };
    }
}

// Create singleton instance
const postManager = new PostManager();

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PostManager, postManager };
}
