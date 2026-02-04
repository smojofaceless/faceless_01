// =====================================================
// POST MODEL
// Represents a social media post with its content and status
// =====================================================

/**
 * Post status flow:
 * draft -> queued -> scheduled -> publishing -> published
 *                              -> failed (can retry)
 */
const POST_STATUS = {
    DRAFT: 'draft',           // Created but not ready to post
    QUEUED: 'queued',         // Ready to post, awaiting scheduling
    SCHEDULED: 'scheduled',   // Has a scheduled time
    PUBLISHING: 'publishing', // Currently being posted
    PUBLISHED: 'published',   // Successfully posted
    FAILED: 'failed',         // Failed to post
    CANCELLED: 'cancelled'    // Manually cancelled
};

/**
 * @typedef {Object} PostContent
 * @property {string} videoUrl - URL to the video file
 * @property {string} thumbnailUrl - URL to thumbnail image
 * @property {string} caption - Post caption text
 * @property {string[]} hashtags - Array of hashtags
 * @property {number} duration - Video duration in seconds
 * @property {string} aspectRatio - Video aspect ratio
 * @property {number} fileSize - File size in bytes
 */

class Post {
    constructor(data = {}) {
        this.id = data.id || generateUUID();
        this.brandId = data.brandId || null;
        this.platformId = data.platformId || null;
        this.contentId = data.contentId || null; // Reference to generated content
        
        // Post status
        this.status = data.status || POST_STATUS.DRAFT;
        this.statusHistory = data.statusHistory || [];
        
        // Content
        this.content = {
            videoUrl: data.content?.videoUrl || null,
            thumbnailUrl: data.content?.thumbnailUrl || null,
            caption: data.content?.caption || '',
            hashtags: data.content?.hashtags || [],
            duration: data.content?.duration || 0,
            aspectRatio: data.content?.aspectRatio || '9:16',
            fileSize: data.content?.fileSize || 0,
            title: data.content?.title || '',
            ...data.content
        };
        
        // Scheduling
        this.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
        this.publishedAt = data.publishedAt ? new Date(data.publishedAt) : null;
        this.timezone = data.timezone || 'America/New_York';
        
        // Platform-specific data
        this.platformPostId = data.platformPostId || null; // ID returned by platform after posting
        this.platformUrl = data.platformUrl || null;       // URL to the post on the platform
        
        // Error handling
        this.lastError = data.lastError || null;
        this.retryCount = data.retryCount || 0;
        this.maxRetries = data.maxRetries || 3;
        
        // Metadata
        this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
        this.updatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date();
        this.createdBy = data.createdBy || 'system';
        
        // Analytics (populated after publishing)
        this.analytics = data.analytics || {
            views: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            lastUpdated: null
        };
    }

    /**
     * Update post status with history tracking
     * @param {string} newStatus - New status
     * @param {string} reason - Reason for status change
     */
    setStatus(newStatus, reason = '') {
        const oldStatus = this.status;
        this.status = newStatus;
        this.updatedAt = new Date();
        
        this.statusHistory.push({
            from: oldStatus,
            to: newStatus,
            reason,
            timestamp: new Date().toISOString()
        });

        if (newStatus === POST_STATUS.PUBLISHED) {
            this.publishedAt = new Date();
        }
    }

    /**
     * Schedule post for a specific time
     * @param {Date|string} datetime - When to post
     * @param {string} timezone - Timezone
     */
    schedule(datetime, timezone = this.timezone) {
        this.scheduledAt = new Date(datetime);
        this.timezone = timezone;
        this.setStatus(POST_STATUS.SCHEDULED, `Scheduled for ${this.scheduledAt.toISOString()}`);
    }

    /**
     * Mark post as queued (ready for next available slot)
     */
    queue() {
        this.setStatus(POST_STATUS.QUEUED, 'Added to queue');
    }

    /**
     * Mark post as publishing
     */
    markPublishing() {
        this.setStatus(POST_STATUS.PUBLISHING, 'Publishing in progress');
    }

    /**
     * Mark post as successfully published
     * @param {Object} result - Platform response
     */
    markPublished(result = {}) {
        this.platformPostId = result.postId || null;
        this.platformUrl = result.url || null;
        this.setStatus(POST_STATUS.PUBLISHED, 'Successfully published');
    }

    /**
     * Mark post as failed
     * @param {Error|string} error - Error details
     */
    markFailed(error) {
        this.lastError = error instanceof Error ? error.message : error;
        this.retryCount++;
        this.setStatus(POST_STATUS.FAILED, this.lastError);
    }

    /**
     * Check if post can be retried
     * @returns {boolean}
     */
    canRetry() {
        return this.status === POST_STATUS.FAILED && this.retryCount < this.maxRetries;
    }

    /**
     * Reset for retry
     */
    retry() {
        if (this.canRetry()) {
            this.lastError = null;
            this.setStatus(POST_STATUS.QUEUED, `Retry attempt ${this.retryCount}`);
        }
    }

    /**
     * Cancel post
     */
    cancel() {
        this.setStatus(POST_STATUS.CANCELLED, 'Manually cancelled');
    }

    /**
     * Get formatted caption with hashtags
     * @returns {string}
     */
    getFullCaption() {
        let caption = this.content.caption || '';
        if (this.content.hashtags && this.content.hashtags.length > 0) {
            const tags = this.content.hashtags.map(tag => 
                tag.startsWith('#') ? tag : `#${tag}`
            ).join(' ');
            caption = caption ? `${caption}\n\n${tags}` : tags;
        }
        return caption;
    }

    /**
     * Check if post is editable
     * @returns {boolean}
     */
    isEditable() {
        return [POST_STATUS.DRAFT, POST_STATUS.QUEUED, POST_STATUS.SCHEDULED].includes(this.status);
    }

    /**
     * Check if post is pending (not yet published)
     * @returns {boolean}
     */
    isPending() {
        return [POST_STATUS.DRAFT, POST_STATUS.QUEUED, POST_STATUS.SCHEDULED, POST_STATUS.PUBLISHING].includes(this.status);
    }

    /**
     * Update content
     * @param {Object} updates - Content updates
     */
    updateContent(updates) {
        this.content = { ...this.content, ...updates };
        this.updatedAt = new Date();
    }

    toJSON() {
        return {
            id: this.id,
            brandId: this.brandId,
            platformId: this.platformId,
            contentId: this.contentId,
            status: this.status,
            statusHistory: this.statusHistory,
            content: this.content,
            scheduledAt: this.scheduledAt?.toISOString() || null,
            publishedAt: this.publishedAt?.toISOString() || null,
            timezone: this.timezone,
            platformPostId: this.platformPostId,
            platformUrl: this.platformUrl,
            lastError: this.lastError,
            retryCount: this.retryCount,
            maxRetries: this.maxRetries,
            createdAt: this.createdAt.toISOString(),
            updatedAt: this.updatedAt.toISOString(),
            createdBy: this.createdBy,
            analytics: this.analytics
        };
    }

    static fromJSON(data) {
        return new Post(data);
    }

    /**
     * Create a post from generated content
     * @param {Object} content - Generated content
     * @param {string} brandId - Brand ID
     * @param {string} platformId - Platform ID
     * @returns {Post}
     */
    static fromContent(content, brandId, platformId) {
        return new Post({
            brandId,
            platformId,
            contentId: content.id,
            content: {
                videoUrl: content.videoUrl,
                thumbnailUrl: content.thumbnailUrl,
                caption: content.caption || '',
                hashtags: content.hashtags || [],
                duration: content.duration,
                aspectRatio: content.aspectRatio || '9:16',
                fileSize: content.fileSize,
                title: content.title || ''
            }
        });
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Post, POST_STATUS };
}
