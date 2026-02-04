// =====================================================
// PLATFORM MODEL
// Represents a social media platform and its capabilities
// =====================================================

/**
 * @typedef {Object} PlatformConfig
 * @property {string} id - Platform identifier (instagram, tiktok, youtube, etc.)
 * @property {string} name - Display name
 * @property {string} icon - Icon identifier
 * @property {Object} constraints - Platform-specific constraints
 * @property {Object} features - Supported features
 * @property {Object} apiConfig - API configuration
 */

class Platform {
    constructor(data = {}) {
        this.id = data.id || '';
        this.name = data.name || '';
        this.icon = data.icon || 'default';
        this.color = data.color || '#666666';
        this.enabled = data.enabled !== false;
        
        // Platform constraints
        this.constraints = {
            maxVideoDuration: data.constraints?.maxVideoDuration || 60,
            minVideoDuration: data.constraints?.minVideoDuration || 3,
            maxFileSize: data.constraints?.maxFileSize || 100 * 1024 * 1024, // 100MB default
            aspectRatios: data.constraints?.aspectRatios || ['9:16', '1:1', '16:9'],
            preferredRatio: data.constraints?.preferredRatio || '9:16',
            maxCaptionLength: data.constraints?.maxCaptionLength || 2200,
            maxHashtags: data.constraints?.maxHashtags || 30,
            allowedFormats: data.constraints?.allowedFormats || ['mp4'],
            ...data.constraints
        };
        
        // Supported features
        this.features = {
            scheduling: data.features?.scheduling !== false,
            stories: data.features?.stories || false,
            reels: data.features?.reels || false,
            shorts: data.features?.shorts || false,
            captions: data.features?.captions !== false,
            hashtags: data.features?.hashtags !== false,
            thumbnails: data.features?.thumbnails || false,
            analytics: data.features?.analytics || false,
            ...data.features
        };
        
        // Rate limits
        this.rateLimits = {
            postsPerDay: data.rateLimits?.postsPerDay || 25,
            postsPerHour: data.rateLimits?.postsPerHour || 5,
            minTimeBetweenPosts: data.rateLimits?.minTimeBetweenPosts || 3600, // seconds
            ...data.rateLimits
        };
        
        // API configuration (template, actual credentials stored separately)
        this.apiConfig = {
            authType: data.apiConfig?.authType || 'oauth2',
            baseUrl: data.apiConfig?.baseUrl || '',
            scopes: data.apiConfig?.scopes || [],
            ...data.apiConfig
        };
    }

    /**
     * Validate content against platform constraints
     * @param {Object} content - Content to validate
     * @returns {Object} Validation result
     */
    validateContent(content) {
        const errors = [];
        const warnings = [];

        // Video duration
        if (content.duration) {
            if (content.duration > this.constraints.maxVideoDuration) {
                errors.push(`Video exceeds max duration of ${this.constraints.maxVideoDuration}s`);
            }
            if (content.duration < this.constraints.minVideoDuration) {
                errors.push(`Video is shorter than min duration of ${this.constraints.minVideoDuration}s`);
            }
        }

        // File size
        if (content.fileSize && content.fileSize > this.constraints.maxFileSize) {
            errors.push(`File exceeds max size of ${formatBytes(this.constraints.maxFileSize)}`);
        }

        // Caption length
        if (content.caption && content.caption.length > this.constraints.maxCaptionLength) {
            errors.push(`Caption exceeds ${this.constraints.maxCaptionLength} characters`);
        }

        // Hashtag count
        if (content.hashtags && content.hashtags.length > this.constraints.maxHashtags) {
            warnings.push(`${content.hashtags.length} hashtags may be too many (max recommended: ${this.constraints.maxHashtags})`);
        }

        // Aspect ratio
        if (content.aspectRatio && !this.constraints.aspectRatios.includes(content.aspectRatio)) {
            warnings.push(`Aspect ratio ${content.aspectRatio} may not be optimal for ${this.name}`);
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Check if posting is allowed based on rate limits
     * @param {Object} recentPosts - Recent post counts
     * @returns {Object} Rate limit status
     */
    checkRateLimits(recentPosts) {
        const { postsToday = 0, postsThisHour = 0, lastPostTime = null } = recentPosts;
        
        const issues = [];
        let canPost = true;

        if (postsToday >= this.rateLimits.postsPerDay) {
            issues.push(`Daily limit reached (${this.rateLimits.postsPerDay} posts)`);
            canPost = false;
        }

        if (postsThisHour >= this.rateLimits.postsPerHour) {
            issues.push(`Hourly limit reached (${this.rateLimits.postsPerHour} posts)`);
            canPost = false;
        }

        if (lastPostTime) {
            const timeSinceLastPost = (Date.now() - new Date(lastPostTime).getTime()) / 1000;
            if (timeSinceLastPost < this.rateLimits.minTimeBetweenPosts) {
                const waitTime = this.rateLimits.minTimeBetweenPosts - timeSinceLastPost;
                issues.push(`Must wait ${Math.ceil(waitTime / 60)} minutes before next post`);
                canPost = false;
            }
        }

        return { canPost, issues };
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            icon: this.icon,
            color: this.color,
            enabled: this.enabled,
            constraints: this.constraints,
            features: this.features,
            rateLimits: this.rateLimits,
            apiConfig: this.apiConfig
        };
    }

    static fromJSON(data) {
        return new Platform(data);
    }
}

// Pre-configured platform definitions
const PLATFORMS = {
    instagram: new Platform({
        id: 'instagram',
        name: 'Instagram',
        icon: 'instagram',
        color: '#E4405F',
        constraints: {
            maxVideoDuration: 90, // Reels
            minVideoDuration: 3,
            maxFileSize: 250 * 1024 * 1024,
            aspectRatios: ['9:16', '1:1', '4:5'],
            preferredRatio: '9:16',
            maxCaptionLength: 2200,
            maxHashtags: 30
        },
        features: {
            scheduling: true,
            reels: true,
            stories: true,
            captions: true,
            hashtags: true,
            thumbnails: true,
            analytics: true
        },
        rateLimits: {
            postsPerDay: 25,
            postsPerHour: 5,
            minTimeBetweenPosts: 1800
        },
        apiConfig: {
            authType: 'oauth2',
            baseUrl: 'https://graph.instagram.com',
            scopes: ['instagram_basic', 'instagram_content_publish']
        }
    }),

    tiktok: new Platform({
        id: 'tiktok',
        name: 'TikTok',
        icon: 'tiktok',
        color: '#000000',
        constraints: {
            maxVideoDuration: 180,
            minVideoDuration: 3,
            maxFileSize: 287 * 1024 * 1024,
            aspectRatios: ['9:16'],
            preferredRatio: '9:16',
            maxCaptionLength: 2200,
            maxHashtags: 100
        },
        features: {
            scheduling: true,
            captions: true,
            hashtags: true,
            thumbnails: false,
            analytics: true
        },
        rateLimits: {
            postsPerDay: 50,
            postsPerHour: 10,
            minTimeBetweenPosts: 300
        },
        apiConfig: {
            authType: 'oauth2',
            baseUrl: 'https://open.tiktokapis.com',
            scopes: ['video.upload', 'video.publish']
        }
    }),

    youtube: new Platform({
        id: 'youtube',
        name: 'YouTube Shorts',
        icon: 'youtube',
        color: '#FF0000',
        constraints: {
            maxVideoDuration: 60,
            minVideoDuration: 3,
            maxFileSize: 256 * 1024 * 1024,
            aspectRatios: ['9:16'],
            preferredRatio: '9:16',
            maxCaptionLength: 5000,
            maxHashtags: 60
        },
        features: {
            scheduling: true,
            shorts: true,
            captions: true,
            hashtags: true,
            thumbnails: true,
            analytics: true
        },
        rateLimits: {
            postsPerDay: 50,
            postsPerHour: 10,
            minTimeBetweenPosts: 60
        },
        apiConfig: {
            authType: 'oauth2',
            baseUrl: 'https://www.googleapis.com/youtube/v3',
            scopes: ['youtube.upload', 'youtube.readonly']
        }
    }),

    facebook: new Platform({
        id: 'facebook',
        name: 'Facebook Reels',
        icon: 'facebook',
        color: '#1877F2',
        constraints: {
            maxVideoDuration: 90,
            minVideoDuration: 3,
            maxFileSize: 1024 * 1024 * 1024,
            aspectRatios: ['9:16', '1:1', '16:9'],
            preferredRatio: '9:16',
            maxCaptionLength: 63206,
            maxHashtags: 30
        },
        features: {
            scheduling: true,
            reels: true,
            captions: true,
            hashtags: true,
            thumbnails: false,
            analytics: true
        },
        rateLimits: {
            postsPerDay: 25,
            postsPerHour: 5,
            minTimeBetweenPosts: 1800
        },
        apiConfig: {
            authType: 'oauth2',
            baseUrl: 'https://graph.facebook.com',
            scopes: ['pages_manage_posts', 'pages_read_engagement']
        }
    }),

    threads: new Platform({
        id: 'threads',
        name: 'Threads',
        icon: 'threads',
        color: '#000000',
        constraints: {
            maxVideoDuration: 300,
            minVideoDuration: 1,
            maxFileSize: 250 * 1024 * 1024,
            aspectRatios: ['9:16', '1:1', '16:9'],
            preferredRatio: '9:16',
            maxCaptionLength: 500,
            maxHashtags: 0 // No hashtags on Threads
        },
        features: {
            scheduling: false, // Not yet available
            captions: true,
            hashtags: false,
            thumbnails: false,
            analytics: false
        },
        rateLimits: {
            postsPerDay: 100,
            postsPerHour: 20,
            minTimeBetweenPosts: 60
        },
        apiConfig: {
            authType: 'oauth2',
            baseUrl: 'https://graph.threads.net',
            scopes: ['threads_basic', 'threads_content_publish']
        }
    }),

    twitter: new Platform({
        id: 'twitter',
        name: 'X (Twitter)',
        icon: 'twitter',
        color: '#000000',
        constraints: {
            maxVideoDuration: 140,
            minVideoDuration: 0.5,
            maxFileSize: 512 * 1024 * 1024,
            aspectRatios: ['9:16', '1:1', '16:9'],
            preferredRatio: '16:9',
            maxCaptionLength: 280,
            maxHashtags: 10
        },
        features: {
            scheduling: true,
            captions: true,
            hashtags: true,
            thumbnails: false,
            analytics: true
        },
        rateLimits: {
            postsPerDay: 100,
            postsPerHour: 25,
            minTimeBetweenPosts: 60
        },
        apiConfig: {
            authType: 'oauth2',
            baseUrl: 'https://api.twitter.com/2',
            scopes: ['tweet.read', 'tweet.write', 'users.read']
        }
    })
};

// Helper to get all platforms as array
function getAllPlatforms() {
    return Object.values(PLATFORMS);
}

// Helper to get platform by ID
function getPlatform(id) {
    return PLATFORMS[id] || null;
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Platform, PLATFORMS, getAllPlatforms, getPlatform };
}
