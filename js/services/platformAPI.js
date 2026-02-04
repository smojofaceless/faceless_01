// =====================================================
// PLATFORM API SERVICE
// Abstract interface for platform-specific API integrations
// =====================================================

/**
 * Base class for platform API integrations
 * Each platform extends this with specific implementation
 */
class PlatformAPIBase {
    constructor(platform, account) {
        this.platform = platform;   // Platform model
        this.account = account;     // PlatformAccount model
    }

    /**
     * Check if the connection is valid
     * @returns {Promise<boolean>}
     */
    async isConnected() {
        throw new Error('Must implement isConnected()');
    }

    /**
     * Refresh OAuth token
     * @returns {Promise<Object>} New tokens
     */
    async refreshToken() {
        throw new Error('Must implement refreshToken()');
    }

    /**
     * Upload and publish content
     * @param {Post} post - Post to publish
     * @returns {Promise<Object>} Platform response with postId and url
     */
    async publish(post) {
        throw new Error('Must implement publish()');
    }

    /**
     * Get post analytics
     * @param {string} platformPostId - Platform's post ID
     * @returns {Promise<Object>} Analytics data
     */
    async getAnalytics(platformPostId) {
        throw new Error('Must implement getAnalytics()');
    }

    /**
     * Delete a post
     * @param {string} platformPostId - Platform's post ID
     * @returns {Promise<boolean>}
     */
    async deletePost(platformPostId) {
        throw new Error('Must implement deletePost()');
    }

    /**
     * Get account info
     * @returns {Promise<Object>} Account information
     */
    async getAccountInfo() {
        throw new Error('Must implement getAccountInfo()');
    }

    /**
     * Build OAuth authorization URL
     * @param {string} redirectUri - Callback URL
     * @param {string} state - State parameter
     * @returns {string} Authorization URL
     */
    static getAuthUrl(redirectUri, state) {
        throw new Error('Must implement getAuthUrl()');
    }

    /**
     * Exchange authorization code for tokens
     * @param {string} code - Authorization code
     * @param {string} redirectUri - Callback URL
     * @returns {Promise<Object>} Token response
     */
    static async exchangeCode(code, redirectUri) {
        throw new Error('Must implement exchangeCode()');
    }
}

/**
 * Platform API Factory - creates appropriate API instance
 */
class PlatformAPIFactory {
    static adapters = new Map();

    /**
     * Register a platform adapter
     * @param {string} platformId - Platform ID
     * @param {class} adapterClass - Adapter class extending PlatformAPIBase
     */
    static register(platformId, adapterClass) {
        this.adapters.set(platformId, adapterClass);
    }

    /**
     * Create API instance for a platform account
     * @param {Platform} platform - Platform model
     * @param {PlatformAccount} account - Account model
     * @returns {PlatformAPIBase}
     */
    static create(platform, account) {
        const AdapterClass = this.adapters.get(platform.id);
        if (!AdapterClass) {
            console.warn(`No adapter registered for platform: ${platform.id}`);
            return new MockPlatformAPI(platform, account);
        }
        return new AdapterClass(platform, account);
    }

    /**
     * Get auth URL for a platform
     * @param {string} platformId - Platform ID
     * @param {string} redirectUri - Callback URL
     * @param {string} state - State parameter
     * @returns {string|null}
     */
    static getAuthUrl(platformId, redirectUri, state) {
        const AdapterClass = this.adapters.get(platformId);
        if (!AdapterClass || !AdapterClass.getAuthUrl) {
            return null;
        }
        return AdapterClass.getAuthUrl(redirectUri, state);
    }
}

/**
 * Mock Platform API for development/testing
 */
class MockPlatformAPI extends PlatformAPIBase {
    async isConnected() {
        return this.account?.status === 'connected';
    }

    async refreshToken() {
        console.log(`[Mock] Refreshing token for ${this.platform.id}`);
        return {
            accessToken: 'mock_access_token_' + Date.now(),
            expiresIn: 3600
        };
    }

    async publish(post) {
        console.log(`[Mock] Publishing to ${this.platform.id}:`, post.content.title);
        
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
        
        // Simulate occasional failures (10% chance)
        if (Math.random() < 0.1) {
            throw new Error('Mock API: Simulated posting failure');
        }

        return {
            postId: 'mock_post_' + Date.now(),
            url: `https://${this.platform.id}.com/p/mock_${Date.now()}`
        };
    }

    async getAnalytics(platformPostId) {
        return {
            views: Math.floor(Math.random() * 10000),
            likes: Math.floor(Math.random() * 500),
            comments: Math.floor(Math.random() * 50),
            shares: Math.floor(Math.random() * 100),
            lastUpdated: new Date().toISOString()
        };
    }

    async deletePost(platformPostId) {
        console.log(`[Mock] Deleting post ${platformPostId} from ${this.platform.id}`);
        return true;
    }

    async getAccountInfo() {
        return {
            id: 'mock_account_123',
            name: `Mock ${this.platform.name} Account`,
            url: `https://${this.platform.id}.com/mock_user`,
            profileImage: null
        };
    }

    static getAuthUrl(redirectUri, state) {
        return `https://mock-auth.example.com/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    }

    static async exchangeCode(code, redirectUri) {
        return {
            accessToken: 'mock_access_token_' + Date.now(),
            refreshToken: 'mock_refresh_token_' + Date.now(),
            expiresIn: 3600
        };
    }
}

// Register mock adapter for all platforms by default
['instagram', 'tiktok', 'youtube', 'facebook', 'threads', 'twitter'].forEach(platformId => {
    PlatformAPIFactory.register(platformId, MockPlatformAPI);
});

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PlatformAPIBase, PlatformAPIFactory, MockPlatformAPI };
}
