/**
 * Threads Service
 * Handles OAuth 2.0 authentication and content posting via Threads API
 * API Docs: https://developers.facebook.com/docs/threads
 */

class ThreadsService {
    constructor() {
        this.appId = null;
        this.appSecret = null;
        this._initialized = false;

        // Brand-aware state
        this.brandId = null;
        this.accessToken = null;
        this.userId = null;
        this.username = null;

        // Threads API endpoints
        this.AUTH_URL = 'https://threads.net/oauth/authorize';
        this.TOKEN_URL = 'https://graph.threads.net/oauth/access_token';
        this.LONG_LIVED_TOKEN_URL = 'https://graph.threads.net/access_token';
        this.API_BASE = 'https://graph.threads.net/v1.0';

        // Scopes
        this.SCOPES = 'threads_basic,threads_content_publish';

        // Storage keys
        this.STORAGE_KEYS = {
            ACCESS_TOKEN: 'threads_access_token',
            USER_ID: 'threads_user_id',
            USERNAME: 'threads_username',
        };
    }

    /**
     * Initialize the Threads service
     */
    init(appId, appSecret = null) {
        if (this._initialized && this.appId === appId) {
            return;
        }
        this.appId = appId;
        this.appSecret = appSecret;

        if (!this._initialized) {
            this._loadFromStorage();
        }
        this._initialized = true;
        console.log('🧵 Threads Service initialized');
    }

    /**
     * Set active brand
     */
    async setBrand(brandId) {
        if (this.brandId === brandId) return;
        this.brandId = brandId;
        this._loadFromStorage();
        console.log(`🧵 Threads Service: Brand set to ${brandId}`);
    }

    /**
     * Check if current brand is connected
     */
    isBrandConnected(brandId) {
        const key = `threads_connected_${brandId || this.brandId}`;
        return localStorage.getItem(key) === 'true' && !!this.accessToken;
    }

    /**
     * Get connection info
     */
    getConnectionInfo() {
        return {
            userId: this.userId,
            username: this.username,
            isConnected: this.isBrandConnected(),
        };
    }

    /**
     * Get OAuth authorization URL
     */
    getAuthUrl(redirectUri, state) {
        if (!this.appId) {
            throw new Error('Threads App ID not configured');
        }

        const params = new URLSearchParams({
            client_id: this.appId,
            redirect_uri: redirectUri,
            scope: this.SCOPES,
            response_type: 'code',
            state: state,
        });

        return `${this.AUTH_URL}?${params.toString()}`;
    }

    /**
     * Exchange authorization code for tokens
     */
    async handleCallback(code, redirectUri) {
        if (!this.appId || !this.appSecret) {
            throw new Error('Threads credentials not configured');
        }

        // Step 1: Exchange code for short-lived token
        console.log('🧵 Exchanging code for short-lived token...');
        const tokenResponse = await fetch(this.TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: this.appId,
                client_secret: this.appSecret,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri,
                code: code,
            }),
        });

        if (!tokenResponse.ok) {
            const err = await tokenResponse.text();
            throw new Error(`Token exchange failed: ${err}`);
        }

        const tokenData = await tokenResponse.json();
        console.log('🧵 Short-lived token obtained');

        // Step 2: Exchange for long-lived token (60 days)
        console.log('🧵 Exchanging for long-lived token...');
        const longLivedResponse = await fetch(
            `${this.LONG_LIVED_TOKEN_URL}?grant_type=th_exchange_token&client_secret=${this.appSecret}&access_token=${tokenData.access_token}`
        );

        let accessToken = tokenData.access_token;
        let expiresIn = tokenData.expires_in || 3600;

        if (longLivedResponse.ok) {
            const longLivedData = await longLivedResponse.json();
            accessToken = longLivedData.access_token;
            expiresIn = longLivedData.expires_in || 5184000; // 60 days
            console.log('🧵 Long-lived token obtained, expires in:', expiresIn, 'seconds');
        } else {
            console.warn('🧵 Could not get long-lived token, using short-lived');
        }

        this.accessToken = accessToken;

        // Step 3: Get user profile
        console.log('🧵 Fetching user profile...');
        const profileResponse = await fetch(
            `${this.API_BASE}/me?fields=id,username,threads_profile_picture_url&access_token=${accessToken}`
        );

        if (profileResponse.ok) {
            const profile = await profileResponse.json();
            this.userId = profile.id;
            this.username = profile.username;
            console.log(`🧵 Connected as @${this.username} (${this.userId})`);
        }

        // Step 4: Save to localStorage
        this._saveToStorage();

        // Step 5: Save to Supabase
        await this._saveToSupabase(accessToken, expiresIn);

        return {
            userId: this.userId,
            username: this.username,
            displayName: this.username || this.userId,
        };
    }

    /**
     * Refresh long-lived token (before it expires)
     */
    async refreshToken() {
        if (!this.accessToken) {
            throw new Error('No access token to refresh');
        }

        const response = await fetch(
            `${this.LONG_LIVED_TOKEN_URL}?grant_type=th_refresh_token&access_token=${this.accessToken}`
        );

        if (!response.ok) {
            throw new Error('Token refresh failed');
        }

        const data = await response.json();
        this.accessToken = data.access_token;
        this._saveToStorage();
        await this._saveToSupabase(data.access_token, data.expires_in || 5184000);

        console.log('🧵 Token refreshed successfully');
        return data.access_token;
    }

    /**
     * Disconnect Threads
     */
    async disconnect() {
        this.accessToken = null;
        this.userId = null;
        this.username = null;

        // Clear localStorage
        const brandKey = this.brandId || 'default';
        Object.values(this.STORAGE_KEYS).forEach(key => {
            localStorage.removeItem(`${key}_${brandKey}`);
        });
        localStorage.removeItem(`threads_connected_${this.brandId}`);

        // Remove from Supabase
        if (this.brandId && typeof supabaseClient !== 'undefined') {
            try {
                await supabaseClient
                    .from('platform_tokens')
                    .delete()
                    .eq('brand_id', this.brandId)
                    .eq('platform', 'threads');
                console.log('🧵 Removed Threads tokens from Supabase');
            } catch (err) {
                console.error('🧵 Error removing tokens:', err);
            }
        }

        console.log('🧵 Threads disconnected');
    }

    /**
     * Test connection by fetching user profile
     */
    async testConnection() {
        if (!this.accessToken) {
            return { success: false, error: 'No access token' };
        }

        try {
            const response = await fetch(
                `${this.API_BASE}/me?fields=id,username&access_token=${this.accessToken}`
            );

            if (!response.ok) {
                return { success: false, error: `API returned ${response.status}` };
            }

            const data = await response.json();
            return {
                success: true,
                username: data.username,
                userId: data.id,
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // ── Private helpers ──

    _loadFromStorage() {
        const brandKey = this.brandId || 'default';
        try {
            this.accessToken = localStorage.getItem(`${this.STORAGE_KEYS.ACCESS_TOKEN}_${brandKey}`);
            this.userId = localStorage.getItem(`${this.STORAGE_KEYS.USER_ID}_${brandKey}`);
            this.username = localStorage.getItem(`${this.STORAGE_KEYS.USERNAME}_${brandKey}`);
        } catch (err) {
            console.error('🧵 Error loading from storage:', err);
        }
    }

    _saveToStorage() {
        const brandKey = this.brandId || 'default';
        try {
            if (this.accessToken) localStorage.setItem(`${this.STORAGE_KEYS.ACCESS_TOKEN}_${brandKey}`, this.accessToken);
            if (this.userId) localStorage.setItem(`${this.STORAGE_KEYS.USER_ID}_${brandKey}`, this.userId);
            if (this.username) localStorage.setItem(`${this.STORAGE_KEYS.USERNAME}_${brandKey}`, this.username);
            localStorage.setItem(`threads_connected_${this.brandId}`, 'true');
        } catch (err) {
            console.error('🧵 Error saving to storage:', err);
        }
    }

    async _saveToSupabase(accessToken, expiresIn) {
        if (!this.brandId || typeof supabaseClient === 'undefined') {
            console.warn('🧵 Cannot save to Supabase: missing brandId or client');
            return;
        }

        try {
            const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

            const tokenRecord = {
                brand_id: this.brandId,
                platform: 'threads',
                access_token: accessToken,
                refresh_token: null, // Threads uses token refresh via GET, not refresh_token
                token_expires_at: expiresAt,
                platform_channel_id: this.userId,
                platform_channel_name: this.username ? `@${this.username}` : null,
                is_valid: true,
                last_error: null,
                updated_at: new Date().toISOString(),
            };

            // Upsert — update if exists for this brand+platform
            const { error } = await supabaseClient
                .from('platform_tokens')
                .upsert(tokenRecord, { onConflict: 'brand_id,platform' });

            if (error) {
                console.error('🧵 Supabase upsert error:', error);
            } else {
                console.log('🧵 Saved Threads tokens to Supabase');
            }
        } catch (err) {
            console.error('🧵 Error saving to Supabase:', err);
        }
    }
}

// Singleton
const threadsService = new ThreadsService();
