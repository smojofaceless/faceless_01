/**
 * Twitter / X Service
 * Handles OAuth 2.0 with PKCE authentication and tweet posting via X API v2
 * API Docs: https://developer.x.com/en/docs/twitter-api
 *
 * NOTE: X uses OAuth 2.0 with PKCE (Proof Key for Code Exchange).
 * This means we do NOT need a client secret for the browser auth flow.
 * We DO need the client secret server-side for token refresh (post-worker).
 */

class TwitterService {
    constructor() {
        this.clientId = null;
        this._initialized = false;

        // Brand-aware state
        this.brandId = null;
        this.accessToken = null;
        this.refreshToken = null;
        this.userId = null;
        this.username = null;

        // X API endpoints
        this.AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
        this.TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
        this.API_BASE = 'https://api.twitter.com/2';

        // Scopes — tweet.read + tweet.write + users.read + offline.access (for refresh tokens)
        this.SCOPES = 'tweet.read tweet.write users.read offline.access';

        // Storage keys
        this.STORAGE_KEYS = {
            ACCESS_TOKEN: 'twitter_access_token',
            REFRESH_TOKEN: 'twitter_refresh_token',
            USER_ID: 'twitter_user_id',
            USERNAME: 'twitter_username',
            CODE_VERIFIER: 'twitter_code_verifier',
        };
    }

    /**
     * Initialize the Twitter service
     */
    init(clientId) {
        if (this._initialized && this.clientId === clientId) {
            return;
        }
        this.clientId = clientId;

        if (!this._initialized) {
            this._loadFromStorage();
        }
        this._initialized = true;
        console.log('🐦 Twitter/X Service initialized');
    }

    /**
     * Set active brand
     */
    async setBrand(brandId) {
        if (this.brandId === brandId) return;
        this.brandId = brandId;
        this._loadFromStorage();
        console.log(`🐦 Twitter/X Service: Brand set to ${brandId}`);
    }

    /**
     * Check if current brand is connected
     */
    isBrandConnected(brandId) {
        const key = `twitter_connected_${brandId || this.brandId}`;
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
     * Generate PKCE code verifier + challenge
     * X requires S256 challenge method
     */
    async _generatePKCE() {
        // Generate random code verifier (43-128 chars)
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        const codeVerifier = this._base64UrlEncode(array);

        // Generate code challenge (SHA-256 hash of verifier, base64url encoded)
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const hash = await crypto.subtle.digest('SHA-256', data);
        const codeChallenge = this._base64UrlEncode(new Uint8Array(hash));

        return { codeVerifier, codeChallenge };
    }

    /**
     * Base64url encode (no padding)
     */
    _base64UrlEncode(buffer) {
        const str = String.fromCharCode(...buffer);
        return btoa(str)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    /**
     * Get OAuth authorization URL (with PKCE)
     */
    async getAuthUrl(redirectUri, state) {
        if (!this.clientId) {
            throw new Error('Twitter Client ID not configured');
        }

        // Generate PKCE pair
        const { codeVerifier, codeChallenge } = await this._generatePKCE();

        // Store code verifier for callback (needed to exchange code for token)
        localStorage.setItem(this.STORAGE_KEYS.CODE_VERIFIER, codeVerifier);

        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.clientId,
            redirect_uri: redirectUri,
            scope: this.SCOPES,
            state: state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        });

        return `${this.AUTH_URL}?${params.toString()}`;
    }

    /**
     * Exchange authorization code for tokens via server-side proxy
     * (Twitter's token endpoint doesn't support CORS from browsers)
     */
    async handleCallback(code, redirectUri, clientSecret) {
        if (!this.clientId) {
            throw new Error('Twitter credentials not configured');
        }

        const codeVerifier = localStorage.getItem(this.STORAGE_KEYS.CODE_VERIFIER);
        if (!codeVerifier) {
            throw new Error('PKCE code verifier not found — please try connecting again');
        }

        console.log('🐦 Exchanging code for tokens via server proxy...');

        // Use Supabase Edge Function proxy (Twitter doesn't allow CORS from browsers)
        const SUPABASE_URL = typeof supabaseClient !== 'undefined' && supabaseClient.supabaseUrl
            ? supabaseClient.supabaseUrl
            : 'https://ustmetegzisztqqcjigt.supabase.co';
        const SUPABASE_ANON_KEY = typeof supabaseClient !== 'undefined' && supabaseClient.supabaseKey
            ? supabaseClient.supabaseKey
            : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDc0NzksImV4cCI6MjA4NTEyMzQ3OX0.5lEiAP6PS4yY3WwAL5v4XWFHWJS5hzBWPXQxuxWe5d4';

        const proxyResponse = await fetch(`${SUPABASE_URL}/functions/v1/twitter-auth`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
                action: 'exchange',
                code: code,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier,
            }),
        });

        if (!proxyResponse.ok) {
            const err = await proxyResponse.text();
            console.error('🐦 Token exchange failed:', err);
            throw new Error(`Token exchange failed: ${err}`);
        }

        const tokenData = await proxyResponse.json();
        console.log('🐦 Tokens obtained. Expires in:', tokenData.expires_in, 'seconds');

        this.accessToken = tokenData.access_token;
        this.refreshToken = tokenData.refresh_token || null;

        // Clean up code verifier
        localStorage.removeItem(this.STORAGE_KEYS.CODE_VERIFIER);

        // Use user from proxy response (already fetched server-side)
        if (tokenData.user) {
            this.userId = tokenData.user.id;
            this.username = tokenData.user.username;
            console.log(`🐦 Connected as @${this.username} (${this.userId})`);
        }

        // Save to localStorage
        this._saveToStorage();

        // Save to Supabase
        await this._saveToSupabase(tokenData);

        return {
            userId: this.userId,
            username: this.username,
            displayName: this.username || this.userId,
        };
    }

    /**
     * Disconnect X
     */
    async disconnect() {
        this.accessToken = null;
        this.refreshToken = null;
        this.userId = null;
        this.username = null;

        // Clear localStorage
        const brandKey = this.brandId || 'default';
        Object.values(this.STORAGE_KEYS).forEach(key => {
            localStorage.removeItem(`${key}_${brandKey}`);
        });
        localStorage.removeItem(`twitter_connected_${this.brandId}`);
        localStorage.removeItem(this.STORAGE_KEYS.CODE_VERIFIER);

        // Remove from Supabase
        if (this.brandId && typeof supabaseClient !== 'undefined') {
            try {
                await supabaseClient
                    .from('platform_tokens')
                    .delete()
                    .eq('brand_id', this.brandId)
                    .eq('platform', 'twitter');
                console.log('🐦 Removed Twitter tokens from Supabase');
            } catch (err) {
                console.error('🐦 Error removing tokens:', err);
            }
        }

        console.log('🐦 X disconnected');
    }

    /**
     * Test connection by fetching user profile
     */
    async testConnection() {
        if (!this.accessToken) {
            return { success: false, error: 'No access token' };
        }

        try {
            const response = await fetch(`${this.API_BASE}/users/me`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` },
            });

            if (!response.ok) {
                return { success: false, error: `API returned ${response.status}` };
            }

            const data = await response.json();
            return {
                success: true,
                username: data.data?.username,
                userId: data.data?.id,
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
            this.refreshToken = localStorage.getItem(`${this.STORAGE_KEYS.REFRESH_TOKEN}_${brandKey}`);
            this.userId = localStorage.getItem(`${this.STORAGE_KEYS.USER_ID}_${brandKey}`);
            this.username = localStorage.getItem(`${this.STORAGE_KEYS.USERNAME}_${brandKey}`);
        } catch (err) {
            console.error('🐦 Error loading from storage:', err);
        }
    }

    _saveToStorage() {
        const brandKey = this.brandId || 'default';
        try {
            if (this.accessToken) localStorage.setItem(`${this.STORAGE_KEYS.ACCESS_TOKEN}_${brandKey}`, this.accessToken);
            if (this.refreshToken) localStorage.setItem(`${this.STORAGE_KEYS.REFRESH_TOKEN}_${brandKey}`, this.refreshToken);
            if (this.userId) localStorage.setItem(`${this.STORAGE_KEYS.USER_ID}_${brandKey}`, this.userId);
            if (this.username) localStorage.setItem(`${this.STORAGE_KEYS.USERNAME}_${brandKey}`, this.username);
            localStorage.setItem(`twitter_connected_${this.brandId}`, 'true');
        } catch (err) {
            console.error('🐦 Error saving to storage:', err);
        }
    }

    async _saveToSupabase(tokenData) {
        if (!this.brandId || typeof supabaseClient === 'undefined') {
            console.warn('🐦 Cannot save to Supabase: missing brandId or client');
            return;
        }

        try {
            const expiresAt = new Date(Date.now() + (tokenData.expires_in || 7200) * 1000).toISOString();

            const tokenRecord = {
                brand_id: this.brandId,
                platform: 'twitter',
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token || null,
                token_expires_at: expiresAt,
                platform_channel_id: this.userId,
                platform_channel_name: this.username ? `@${this.username}` : null,
                is_valid: true,
                last_error: null,
                updated_at: new Date().toISOString(),
            };

            const { error } = await supabaseClient
                .from('platform_tokens')
                .upsert(tokenRecord, { onConflict: 'brand_id,platform' });

            if (error) {
                console.error('🐦 Supabase upsert error:', error);
            } else {
                console.log('🐦 Saved Twitter tokens to Supabase');
            }
        } catch (err) {
            console.error('🐦 Error saving to Supabase:', err);
        }
    }
}

// Singleton
const twitterService = new TwitterService();
