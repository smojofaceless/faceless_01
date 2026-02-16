/**
 * TikTok Service
 * Handles OAuth 2.0 authentication and video uploads via TikTok Content Posting API
 * BRAND-AWARE: Each brand can have its own TikTok connection
 * SUPABASE-INTEGRATED: Tokens stored securely in Supabase
 * 
 * Requirements:
 * - TikTok for Developers app with Content Posting API approved
 * - Login Kit enabled
 * 
 * OAuth Flow:
 * 1. User clicks "Connect TikTok" → redirects to TikTok authorization
 * 2. User approves → redirected back with auth code
 * 3. Code exchanged for access_token + refresh_token
 * 4. Tokens stored in Supabase platform_tokens table
 */

class TikTokService {
    constructor() {
        this.clientKey = null;
        this.clientSecret = null;
        this.currentBrandId = null;

        // Local cache of brand connections
        this.brandConnections = {};

        // Track if we're using Supabase
        this.useSupabase = false;

        // Storage keys
        this.STORAGE_KEYS = {
            CLIENT_KEY: 'tiktok_client_key',
            CLIENT_SECRET: 'tiktok_client_secret',
            BRAND_CONNECTIONS: 'tiktok_brand_connections'
        };

        // API endpoints
        this.AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
        this.TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
        this.USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
        this.UPLOAD_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';

        // Scopes — start with Login Kit only; add video.upload,video.publish after Content Posting API is approved
        this.SCOPES = 'user.info.basic';

        this._initialized = false;
    }

    /**
     * Initialize the TikTok service
     */
    init(clientKey, clientSecret = null) {
        if (this._initialized && this.clientKey === clientKey) {
            return;
        }

        this.clientKey = clientKey;
        this.clientSecret = clientSecret || localStorage.getItem(this.STORAGE_KEYS.CLIENT_SECRET);

        // Check if Supabase is available
        this.useSupabase = typeof supabaseClient !== 'undefined' && supabaseClient !== null;

        // Load from localStorage on first init
        if (!this._initialized) {
            this.loadFromLocalStorage();
        }

        this._initialized = true;
        console.log('🎵 TikTok Service initialized');
    }

    /**
     * Set the current brand context and load its tokens
     */
    async setBrand(brandId) {
        if (!brandId) {
            console.warn('TikTok Service: No brand ID provided');
            return;
        }

        this.currentBrandId = brandId;

        // Try loading from Supabase first
        if (this.useSupabase) {
            try {
                const { data, error } = await supabaseClient
                    .from('platform_tokens')
                    .select('*')
                    .eq('brand_id', brandId)
                    .eq('platform', 'tiktok')
                    .single();

                if (data && !error) {
                    this.brandConnections[brandId] = {
                        accessToken: data.access_token,
                        refreshToken: data.refresh_token,
                        tokenExpiry: data.token_expires_at ? new Date(data.token_expires_at).getTime() : null,
                        openId: data.platform_channel_id,
                        displayName: data.platform_channel_name,
                        isValid: data.is_valid
                    };
                    console.log(`🎵 Loaded TikTok tokens from Supabase for brand ${brandId}`);
                }
            } catch (e) {
                console.warn('🎵 Failed to load TikTok tokens from Supabase:', e.message);
            }
        }
    }

    /**
     * Save tokens to Supabase
     */
    async saveTokensToSupabase() {
        if (!this.useSupabase || !this.currentBrandId) return;

        const connection = this.brandConnections[this.currentBrandId];
        if (!connection) return;

        try {
            const { error } = await supabaseClient
                .from('platform_tokens')
                .upsert({
                    brand_id: this.currentBrandId,
                    platform: 'tiktok',
                    access_token: connection.accessToken,
                    refresh_token: connection.refreshToken,
                    token_expires_at: connection.tokenExpiry
                        ? new Date(connection.tokenExpiry).toISOString()
                        : null,
                    platform_channel_id: connection.openId,
                    platform_channel_name: connection.displayName,
                    is_valid: true,
                    last_used_at: new Date().toISOString(),
                    metadata: {
                        auth_method: 'oauth2',
                        scopes: this.SCOPES
                    }
                }, {
                    onConflict: 'brand_id,platform'
                });

            if (error) throw error;
            console.log('🎵 Saved TikTok tokens to Supabase');
        } catch (e) {
            console.error('Failed to save TikTok tokens to Supabase:', e);
        }
    }

    /**
     * Load from localStorage (fallback)
     */
    loadFromLocalStorage() {
        try {
            const clientKey = localStorage.getItem(this.STORAGE_KEYS.CLIENT_KEY);
            const clientSecret = localStorage.getItem(this.STORAGE_KEYS.CLIENT_SECRET);
            const connections = localStorage.getItem(this.STORAGE_KEYS.BRAND_CONNECTIONS);

            if (clientKey && !this.clientKey) this.clientKey = clientKey;
            if (clientSecret && !this.clientSecret) this.clientSecret = clientSecret;
            if (connections) {
                const parsed = JSON.parse(connections);
                for (const [brandId, conn] of Object.entries(parsed)) {
                    if (!this.brandConnections[brandId]) {
                        this.brandConnections[brandId] = conn;
                    }
                }
            }
        } catch (e) {
            console.error('Failed to load TikTok data from localStorage:', e);
        }
    }

    /**
     * Save to localStorage (fallback)
     */
    saveToLocalStorage() {
        try {
            if (this.clientKey) localStorage.setItem(this.STORAGE_KEYS.CLIENT_KEY, this.clientKey);
            if (this.clientSecret) localStorage.setItem(this.STORAGE_KEYS.CLIENT_SECRET, this.clientSecret);
            localStorage.setItem(
                this.STORAGE_KEYS.BRAND_CONNECTIONS,
                JSON.stringify(this.brandConnections)
            );
        } catch (e) {
            console.error('Failed to save TikTok data to localStorage:', e);
        }
    }

    // =====================================================
    // OAUTH FLOW
    // =====================================================

    /**
     * Check if TikTok is connected for current brand
     */
    isConnected() {
        const connection = this.brandConnections[this.currentBrandId];
        return connection?.accessToken && connection?.isValid !== false;
    }

    /**
     * Check if brand is connected
     */
    isBrandConnected(brandId) {
        const connection = this.brandConnections[brandId || this.currentBrandId];
        return connection?.accessToken && connection?.isValid !== false;
    }

    /**
     * Get connection info for current brand
     */
    getConnectionInfo() {
        const connection = this.brandConnections[this.currentBrandId];
        if (!connection) return null;

        return {
            openId: connection.openId,
            displayName: connection.displayName,
            isValid: connection.isValid
        };
    }

    /**
     * Generate OAuth URL for TikTok Login Kit
     */
    getAuthUrl(redirectUri) {
        if (!this.clientKey) {
            throw new Error('TikTok Client Key not configured');
        }

        // CSRF state token with brand ID
        const csrfState = JSON.stringify({
            brandId: this.currentBrandId,
            nonce: Math.random().toString(36).substring(7)
        });

        // TikTok uses comma-separated scopes
        const params = new URLSearchParams({
            client_key: this.clientKey,
            response_type: 'code',
            scope: this.SCOPES,
            redirect_uri: redirectUri,
            state: csrfState
        });

        return `${this.AUTH_URL}?${params.toString()}`;
    }

    /**
     * Parse OAuth state to extract brand ID
     */
    parseOAuthState(state) {
        try {
            const parsed = JSON.parse(state);
            return parsed.brandId;
        } catch {
            return null;
        }
    }

    /**
     * Handle OAuth callback — exchange code for tokens
     */
    async handleCallback(code, redirectUri) {
        if (!this.clientKey || !this.clientSecret) {
            throw new Error('TikTok credentials not configured');
        }

        // Exchange auth code for tokens
        const response = await fetch(this.TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_key: this.clientKey,
                client_secret: this.clientSecret,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri
            })
        });

        const data = await response.json();

        if (data.error || !data.access_token) {
            const errMsg = data.error_description || data.error || 'Token exchange failed';
            throw new Error(errMsg);
        }

        const accessToken = data.access_token;
        const refreshToken = data.refresh_token;
        const expiresIn = data.expires_in || 86400; // Default 24 hours
        const openId = data.open_id;

        // Fetch user info
        let displayName = openId;
        try {
            const userInfo = await this.fetchUserInfo(accessToken);
            displayName = userInfo.display_name || userInfo.username || openId;
        } catch (e) {
            console.warn('🎵 Could not fetch TikTok user info:', e.message);
        }

        // Store connection
        this.brandConnections[this.currentBrandId] = {
            accessToken,
            refreshToken,
            tokenExpiry: Date.now() + (expiresIn * 1000),
            openId,
            displayName,
            isValid: true
        };

        this.saveToLocalStorage();
        await this.saveTokensToSupabase();

        return {
            success: true,
            openId,
            displayName
        };
    }

    /**
     * Fetch TikTok user info
     */
    async fetchUserInfo(accessToken) {
        const response = await fetch(
            `${this.USER_INFO_URL}?fields=open_id,display_name,avatar_url,username`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );

        const data = await response.json();
        if (data.error?.code) {
            throw new Error(data.error.message || 'Failed to fetch user info');
        }

        return data.data?.user || {};
    }

    /**
     * Refresh access token using refresh token
     */
    async refreshAccessToken() {
        const connection = this.brandConnections[this.currentBrandId];
        if (!connection?.refreshToken) {
            throw new Error('No refresh token available');
        }

        const response = await fetch(this.TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_key: this.clientKey,
                client_secret: this.clientSecret,
                grant_type: 'refresh_token',
                refresh_token: connection.refreshToken
            })
        });

        const data = await response.json();
        if (data.error || !data.access_token) {
            connection.isValid = false;
            this.saveToLocalStorage();
            throw new Error(data.error_description || 'Token refresh failed');
        }

        connection.accessToken = data.access_token;
        connection.refreshToken = data.refresh_token || connection.refreshToken;
        connection.tokenExpiry = Date.now() + ((data.expires_in || 86400) * 1000);
        connection.isValid = true;

        this.saveToLocalStorage();
        await this.saveTokensToSupabase();

        return data.access_token;
    }

    /**
     * Disconnect TikTok for current brand
     */
    async disconnect() {
        if (this.currentBrandId) {
            delete this.brandConnections[this.currentBrandId];
            this.saveToLocalStorage();

            // Remove from Supabase
            if (this.useSupabase) {
                try {
                    await supabaseClient
                        .from('platform_tokens')
                        .delete()
                        .eq('brand_id', this.currentBrandId)
                        .eq('platform', 'tiktok');
                } catch (e) {
                    console.warn('Failed to delete TikTok token from Supabase:', e.message);
                }
            }
        }
    }
}

// Global instance
const tiktokService = new TikTokService();
