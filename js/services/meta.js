/**
 * Meta Service (Instagram & Facebook)
 * Handles OAuth 2.0 authentication and video uploads to Instagram Reels and Facebook
 * BRAND-AWARE: Each brand can have its own Meta connection
 * SUPABASE-INTEGRATED: Tokens stored securely in Supabase
 * 
 * Requirements:
 * - Instagram Business or Creator account
 * - Facebook Page linked to Instagram account
 * - Meta App with required permissions
 */

class MetaService {
    constructor() {
        this.appId = null;
        this.appSecret = null;
        this.currentBrandId = null;
        
        // Local cache of brand connections
        this.brandConnections = {};
        
        // Track if we're using Supabase or localStorage fallback
        this.useSupabase = false;
        
        // Storage keys for localStorage fallback
        this.STORAGE_KEYS = {
            APP_ID: 'meta_app_id',
            APP_SECRET: 'meta_app_secret',
            BRAND_CONNECTIONS: 'meta_brand_connections'
        };
        
        // API endpoints
        this.API_BASE = 'https://graph.facebook.com/v18.0';
        this.OAUTH_URL = 'https://www.facebook.com/v18.0/dialog/oauth';
        this.TOKEN_URL = 'https://graph.facebook.com/v18.0/oauth/access_token';
        
        // Scopes needed for Instagram and Facebook posting
        this.SCOPES = [
            'instagram_basic',
            'instagram_content_publish',
            'pages_show_list',
            'pages_read_engagement',
            'pages_manage_posts',
            'business_management'
        ].join(',');
    }

    /**
     * Initialize the Meta service
     * @param {string} appId - Meta App ID
     * @param {string} appSecret - Meta App Secret
     */
    async init(appId, appSecret = null) {
        if (this._initialized && this.appId === appId) {
            return;
        }
        
        this.appId = appId;
        this.appSecret = appSecret || localStorage.getItem(this.STORAGE_KEYS.APP_SECRET);
        
        // Check if Supabase is available
        this.useSupabase = typeof supabaseClient !== 'undefined' && supabaseClient !== null;
        
        // Only load from localStorage on first init
        if (!this._initialized) {
            this.loadFromLocalStorage();
        }
        
        this._initialized = true;
        
        console.log('📸 Meta Service initialized');
    }

    /**
     * Set the current brand context and load its tokens
     */
    async setBrand(brandId) {
        if (!brandId) {
            console.warn('Meta Service: No brand ID provided');
            return;
        }
        
        this.currentBrandId = brandId;
        
        // Load tokens for this brand
        if (!this.brandConnections[brandId]) {
            if (this.useSupabase) {
                await this.loadBrandTokensFromSupabase(brandId);
            }
            
            if (!this.brandConnections[brandId]) {
                this.loadFromLocalStorage();
                
                if (this.brandConnections[brandId] && this.useSupabase) {
                    console.log('📸 Migrating Meta tokens from localStorage to Supabase');
                    await this.saveTokensToSupabase();
                }
            }
        }
        
        console.log(`📸 Meta Service: Brand set to ${brandId}`);
    }

    /**
     * Load tokens from Supabase
     */
    async loadBrandTokensFromSupabase(brandId) {
        try {
            // Load both Instagram and Facebook tokens
            const { data, error } = await supabaseClient
                .from('platform_tokens')
                .select('*')
                .eq('brand_id', brandId)
                .in('platform', ['instagram', 'facebook']);

            if (error && error.code !== 'PGRST116') {
                console.error('Error loading Meta tokens:', error);
                return;
            }

            if (data && data.length > 0) {
                // Initialize connection object
                this.brandConnections[brandId] = {
                    accessToken: null,
                    tokenExpiry: null,
                    userId: null,
                    pages: [],
                    selectedPageId: null,
                    instagramAccountId: null,
                    instagramUsername: null,
                    facebookPageId: null,
                    facebookPageName: null,
                    isValid: false
                };

                // Process each token record
                for (const record of data) {
                    if (record.platform === 'instagram') {
                        this.brandConnections[brandId].instagramAccountId = record.platform_channel_id;
                        this.brandConnections[brandId].instagramUsername = record.platform_channel_name;
                        this.brandConnections[brandId].accessToken = record.access_token;
                        this.brandConnections[brandId].tokenExpiry = record.token_expires_at 
                            ? new Date(record.token_expires_at).getTime() 
                            : null;
                        this.brandConnections[brandId].isValid = record.is_valid;
                    } else if (record.platform === 'facebook') {
                        this.brandConnections[brandId].facebookPageId = record.platform_channel_id;
                        this.brandConnections[brandId].facebookPageName = record.platform_channel_name;
                        // Facebook uses Page Access Token (stored in metadata)
                        if (record.metadata?.page_access_token) {
                            this.brandConnections[brandId].facebookPageToken = record.metadata.page_access_token;
                        }
                    }
                }
                
                console.log(`📸 Loaded Meta tokens for brand ${brandId}`);
            }
        } catch (e) {
            console.error('Failed to load Meta tokens from Supabase:', e);
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
            // Save Instagram token
            if (connection.instagramAccountId) {
                const { error: igError } = await supabaseClient
                    .from('platform_tokens')
                    .upsert({
                        brand_id: this.currentBrandId,
                        platform: 'instagram',
                        access_token: connection.accessToken,
                        token_expires_at: connection.tokenExpiry 
                            ? new Date(connection.tokenExpiry).toISOString() 
                            : null,
                        platform_channel_id: connection.instagramAccountId,
                        platform_channel_name: connection.instagramUsername,
                        is_valid: true,
                        last_used_at: new Date().toISOString(),
                        metadata: {
                            facebook_page_id: connection.facebookPageId,
                            facebook_page_name: connection.facebookPageName
                        }
                    }, {
                        onConflict: 'brand_id,platform'
                    });
                if (igError) throw igError;
            }

            // Save Facebook token
            if (connection.facebookPageId) {
                const { error: fbError } = await supabaseClient
                    .from('platform_tokens')
                    .upsert({
                        brand_id: this.currentBrandId,
                        platform: 'facebook',
                        access_token: connection.accessToken,
                        token_expires_at: connection.tokenExpiry 
                            ? new Date(connection.tokenExpiry).toISOString() 
                            : null,
                        platform_channel_id: connection.facebookPageId,
                        platform_channel_name: connection.facebookPageName,
                        is_valid: true,
                        last_used_at: new Date().toISOString(),
                        metadata: {
                            page_access_token: connection.facebookPageToken,
                            instagram_account_id: connection.instagramAccountId,
                            instagram_username: connection.instagramUsername
                        }
                    }, {
                        onConflict: 'brand_id,platform'
                    });
                if (fbError) throw fbError;
            }

            console.log('📸 Saved Meta tokens to Supabase');
        } catch (e) {
            console.error('Failed to save Meta tokens to Supabase:', e);
        }
    }

    /**
     * Load from localStorage (fallback)
     */
    loadFromLocalStorage() {
        try {
            const appId = localStorage.getItem(this.STORAGE_KEYS.APP_ID);
            const appSecret = localStorage.getItem(this.STORAGE_KEYS.APP_SECRET);
            const connections = localStorage.getItem(this.STORAGE_KEYS.BRAND_CONNECTIONS);
            
            if (appId && !this.appId) this.appId = appId;
            if (appSecret && !this.appSecret) this.appSecret = appSecret;
            if (connections) {
                const parsed = JSON.parse(connections);
                for (const [brandId, conn] of Object.entries(parsed)) {
                    if (!this.brandConnections[brandId]) {
                        this.brandConnections[brandId] = conn;
                    }
                }
            }
        } catch (e) {
            console.error('Failed to load Meta data from localStorage:', e);
        }
    }

    /**
     * Save to localStorage (fallback)
     */
    saveToLocalStorage() {
        try {
            if (this.appId) localStorage.setItem(this.STORAGE_KEYS.APP_ID, this.appId);
            if (this.appSecret) localStorage.setItem(this.STORAGE_KEYS.APP_SECRET, this.appSecret);
            localStorage.setItem(
                this.STORAGE_KEYS.BRAND_CONNECTIONS, 
                JSON.stringify(this.brandConnections)
            );
        } catch (e) {
            console.error('Failed to save Meta data to localStorage:', e);
        }
    }

    // =====================================================
    // OAUTH FLOW
    // =====================================================

    /**
     * Check if Meta is connected for current brand
     */
    isConnected() {
        const connection = this.brandConnections[this.currentBrandId];
        return connection?.accessToken && connection?.isValid !== false;
    }

    /**
     * Check if Instagram specifically is connected
     */
    isInstagramConnected() {
        const connection = this.brandConnections[this.currentBrandId];
        return connection?.accessToken && connection?.instagramAccountId && connection?.isValid !== false;
    }

    /**
     * Check if Facebook specifically is connected
     */
    isFacebookConnected() {
        const connection = this.brandConnections[this.currentBrandId];
        return connection?.accessToken && connection?.facebookPageId && connection?.isValid !== false;
    }

    /**
     * Get current connection info
     */
    getConnectionInfo() {
        const connection = this.brandConnections[this.currentBrandId];
        if (!connection) return null;
        
        return {
            instagram: connection.instagramAccountId ? {
                accountId: connection.instagramAccountId,
                username: connection.instagramUsername
            } : null,
            facebook: connection.facebookPageId ? {
                pageId: connection.facebookPageId,
                pageName: connection.facebookPageName
            } : null,
            isValid: connection.isValid
        };
    }

    /**
     * Generate OAuth URL for Facebook Login
     */
    getAuthUrl(redirectUri) {
        if (!this.appId) {
            throw new Error('Meta App ID not configured');
        }
        
        // Create state for security (includes brand ID for callback)
        const state = JSON.stringify({
            brandId: this.currentBrandId,
            nonce: Math.random().toString(36).substring(7)
        });
        
        const params = new URLSearchParams({
            client_id: this.appId,
            redirect_uri: redirectUri,
            state: state,
            scope: this.SCOPES,
            response_type: 'code',
            // Enable re-requesting declined permissions
            auth_type: 'rerequest'
        });
        
        return `${this.OAUTH_URL}?${params.toString()}`;
    }

    /**
     * Handle OAuth callback - exchange code for token
     */
    async handleCallback(code, redirectUri) {
        if (!this.appId || !this.appSecret) {
            throw new Error('Meta App credentials not configured');
        }

        // Exchange code for short-lived token
        const tokenUrl = `${this.TOKEN_URL}?` + new URLSearchParams({
            client_id: this.appId,
            client_secret: this.appSecret,
            redirect_uri: redirectUri,
            code: code
        });

        const tokenResponse = await fetch(tokenUrl);
        const tokenData = await tokenResponse.json();

        if (tokenData.error) {
            throw new Error(tokenData.error.message || 'Failed to exchange code for token');
        }

        // Exchange short-lived token for long-lived token (60 days)
        const longLivedTokenData = await this.exchangeForLongLivedToken(tokenData.access_token);
        const accessToken = longLivedTokenData.access_token;
        const expiresIn = longLivedTokenData.expires_in || 5184000; // Default 60 days

        // Get user info and connected pages
        const userInfo = await this.fetchUserInfo(accessToken);
        const pages = await this.fetchPages(accessToken);

        // Store connection
        this.brandConnections[this.currentBrandId] = {
            accessToken: accessToken,
            tokenExpiry: Date.now() + (expiresIn * 1000),
            userId: userInfo.id,
            userName: userInfo.name,
            pages: pages,
            selectedPageId: null,
            instagramAccountId: null,
            instagramUsername: null,
            facebookPageId: null,
            facebookPageName: null,
            isValid: true
        };

        this.saveToLocalStorage();
        
        return {
            success: true,
            pages: pages,
            needsPageSelection: pages.length > 0
        };
    }

    /**
     * Exchange short-lived token for long-lived token
     */
    async exchangeForLongLivedToken(shortLivedToken) {
        const url = `${this.API_BASE}/oauth/access_token?` + new URLSearchParams({
            grant_type: 'fb_exchange_token',
            client_id: this.appId,
            client_secret: this.appSecret,
            fb_exchange_token: shortLivedToken
        });

        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || 'Failed to exchange for long-lived token');
        }

        return data;
    }

    /**
     * Fetch user info
     */
    async fetchUserInfo(accessToken) {
        const response = await fetch(
            `${this.API_BASE}/me?fields=id,name&access_token=${accessToken}`
        );
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || 'Failed to fetch user info');
        }

        return data;
    }

    /**
     * Fetch user's Facebook Pages
     */
    async fetchPages(accessToken) {
        const response = await fetch(
            `${this.API_BASE}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url}&access_token=${accessToken}`
        );
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || 'Failed to fetch pages');
        }

        return (data.data || []).map(page => ({
            id: page.id,
            name: page.name,
            accessToken: page.access_token, // Page-specific access token
            instagram: page.instagram_business_account ? {
                id: page.instagram_business_account.id,
                username: page.instagram_business_account.username,
                profilePicture: page.instagram_business_account.profile_picture_url
            } : null
        }));
    }

    /**
     * Select a Facebook Page (and linked Instagram account) to use
     */
    async selectPage(pageId) {
        const connection = this.brandConnections[this.currentBrandId];
        if (!connection || !connection.pages) {
            throw new Error('No pages available');
        }

        const page = connection.pages.find(p => p.id === pageId);
        if (!page) {
            throw new Error('Page not found');
        }

        console.log('📸 Selected page:', page);
        console.log('📸 Instagram linked:', page.instagram);

        // Update connection with selected page
        connection.selectedPageId = page.id;
        connection.facebookPageId = page.id;
        connection.facebookPageName = page.name;
        connection.facebookPageToken = page.accessToken;

        if (page.instagram) {
            connection.instagramAccountId = page.instagram.id;
            connection.instagramUsername = page.instagram.username;
            console.log('📸 Instagram account ID set:', connection.instagramAccountId);
        } else {
            console.log('📸 No Instagram Business account linked to this page');
        }

        this.saveToLocalStorage();
        await this.saveTokensToSupabase();

        return {
            facebook: {
                pageId: page.id,
                pageName: page.name
            },
            instagram: page.instagram ? {
                accountId: page.instagram.id,
                username: page.instagram.username
            } : null
        };
    }

    /**
     * Get access token (refresh if needed)
     */
    async getAccessToken() {
        const connection = this.brandConnections[this.currentBrandId];
        if (!connection?.accessToken) {
            throw new Error('Not connected to Meta');
        }

        // Check if token is expired (with 5 min buffer)
        if (connection.tokenExpiry && Date.now() > connection.tokenExpiry - 300000) {
            // Token is expired or about to expire
            // For Meta, we'd need to prompt re-auth as refresh tokens aren't straightforward
            console.warn('Meta access token is expired or expiring soon');
            connection.isValid = false;
            throw new Error('Meta access token expired. Please reconnect.');
        }

        return connection.accessToken;
    }

    /**
     * Disconnect from Meta
     */
    async disconnect() {
        delete this.brandConnections[this.currentBrandId];
        this.saveToLocalStorage();

        // Remove from Supabase
        if (this.useSupabase) {
            try {
                await supabaseClient
                    .from('platform_tokens')
                    .delete()
                    .eq('brand_id', this.currentBrandId)
                    .in('platform', ['instagram', 'facebook']);
            } catch (e) {
                console.error('Failed to delete Meta tokens from Supabase:', e);
            }
        }

        console.log('📸 Disconnected from Meta');
    }

    // =====================================================
    // INSTAGRAM REELS UPLOAD
    // =====================================================

    /**
     * Upload video to Instagram Reels
     * Uses a 2-step process: create container, then publish
     * 
     * @param {string} videoUrl - Public URL of the video (must be accessible by Instagram)
     * @param {object} metadata - Caption and other settings
     * @param {function} onProgress - Progress callback
     */
    async uploadToInstagramReels(videoUrl, metadata, onProgress = () => {}) {
        const connection = this.brandConnections[this.currentBrandId];
        
        console.log('📸 Instagram Upload - Starting');
        console.log('📸 Connection:', { 
            hasToken: !!connection?.accessToken,
            instagramAccountId: connection?.instagramAccountId 
        });
        console.log('📸 Video URL:', videoUrl);

        if (!connection?.instagramAccountId) {
            throw new Error('Instagram not connected');
        }

        if (!connection?.accessToken) {
            throw new Error('Instagram access token missing');
        }

        const { caption = '', hashtags = [], shareToFeed = true } = metadata;

        // Combine caption and hashtags
        const fullCaption = hashtags.length > 0 
            ? `${caption}\n\n${hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}`
            : caption;

        console.log('📸 Caption:', fullCaption.substring(0, 100) + '...');

        onProgress(10, 'Creating media container...');

        // Step 1: Create media container
        console.log('📸 Step 1: Creating media container...');
        const containerPayload = {
            media_type: 'REELS',
            video_url: videoUrl,
            caption: fullCaption,
            share_to_feed: shareToFeed,
            access_token: connection.accessToken
        };
        console.log('📸 Container payload:', { ...containerPayload, access_token: '[REDACTED]' });

        const containerResponse = await fetch(
            `${this.API_BASE}/${connection.instagramAccountId}/media`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(containerPayload)
            }
        );

        const containerData = await containerResponse.json();
        console.log('📸 Container response:', containerData);

        if (containerData.error) {
            console.error('📸 Container creation failed:', containerData.error);
            throw new Error(containerData.error.message || 'Failed to create media container');
        }

        const containerId = containerData.id;
        console.log('📸 Container ID:', containerId);
        onProgress(30, 'Processing video...');

        // Step 2: Wait for container to be ready (video processing)
        console.log('📸 Step 2: Waiting for video processing...');
        let status = 'IN_PROGRESS';
        let attempts = 0;
        const maxAttempts = 60; // 5 minutes max

        while (status === 'IN_PROGRESS' && attempts < maxAttempts) {
            await this.sleep(5000); // Wait 5 seconds
            
            const statusResponse = await fetch(
                `${this.API_BASE}/${containerId}?fields=status_code,status&access_token=${connection.accessToken}`
            );
            const statusData = await statusResponse.json();
            
            console.log(`📸 Processing status (attempt ${attempts + 1}):`, statusData);
            
            status = statusData.status_code;
            attempts++;
            
            // Check for error status
            if (statusData.status === 'ERROR' || status === 'ERROR') {
                throw new Error('Video processing failed on Instagram servers');
            }
            
            // Update progress (30-80%)
            const progress = 30 + Math.min(attempts * 1.5, 50);
            onProgress(progress, `Processing video... ${Math.round((attempts / maxAttempts) * 100)}%`);
        }

        if (status !== 'FINISHED') {
            console.error('📸 Processing did not finish. Final status:', status);
            throw new Error(`Video processing failed. Status: ${status}`);
        }

        console.log('📸 Video processing complete!');
        onProgress(85, 'Publishing...');

        // Step 3: Publish the container
        console.log('📸 Step 3: Publishing...');
        const publishResponse = await fetch(
            `${this.API_BASE}/${connection.instagramAccountId}/media_publish`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    creation_id: containerId,
                    access_token: connection.accessToken
                })
            }
        );

        const publishData = await publishResponse.json();
        console.log('📸 Publish response:', publishData);

        if (publishData.error) {
            console.error('📸 Publish failed:', publishData.error);
            throw new Error(publishData.error.message || 'Failed to publish Reel');
        }

        onProgress(95, 'Getting permalink...');

        // Get permalink
        console.log('📸 Getting permalink...');
        const mediaInfo = await this.getMediaInfo(publishData.id);
        console.log('📸 Media info:', mediaInfo);

        console.log('📸 Instagram upload complete!', {
            id: publishData.id,
            permalink: mediaInfo.permalink
        });

        onProgress(100, 'Complete!');

        return {
            id: publishData.id,
            mediaId: publishData.id,
            permalink: mediaInfo.permalink,
            url: mediaInfo.permalink
        };
    }

    /**
     * Get media info including permalink
     */
    async getMediaInfo(mediaId) {
        const connection = this.brandConnections[this.currentBrandId];
        
        const response = await fetch(
            `${this.API_BASE}/${mediaId}?fields=id,permalink,media_type,timestamp&access_token=${connection.accessToken}`
        );
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || 'Failed to get media info');
        }

        return data;
    }

    // =====================================================
    // FACEBOOK VIDEO UPLOAD
    // =====================================================

    /**
     * Upload video to Facebook Page (as Reel or regular video)
     * 
     * @param {string} videoUrl - Public URL of the video (must be accessible by Facebook)
     * @param {object} metadata - Title, description, and settings
     * @param {function} onProgress - Progress callback
     */
    async uploadToFacebook(videoUrl, metadata, onProgress = () => {}) {
        const connection = this.brandConnections[this.currentBrandId];
        
        console.log('📘 Facebook Upload - Starting');
        console.log('📘 Connection:', { 
            hasPageToken: !!connection?.facebookPageToken,
            facebookPageId: connection?.facebookPageId 
        });
        console.log('📘 Video URL:', videoUrl);

        if (!connection?.facebookPageId || !connection?.facebookPageToken) {
            throw new Error('Facebook Page not connected');
        }

        const { 
            title = '', 
            description = '', 
            isReel = true 
        } = metadata;

        // Use Page Access Token for posting
        const pageToken = connection.facebookPageToken;
        console.log('📘 Uploading as:', isReel ? 'Reel' : 'Video');

        if (isReel) {
            return await this.uploadFacebookReelByUrl(videoUrl, { title, description }, pageToken, onProgress);
        } else {
            return await this.uploadFacebookVideoByUrl(videoUrl, { title, description }, pageToken, onProgress);
        }
    }

    /**
     * Upload Facebook Reel using URL (avoids CORS issues)
     * Facebook Reels API only has START and FINISH phases
     * file_url must be provided in the START phase
     */
    async uploadFacebookReelByUrl(videoUrl, metadata, pageToken, onProgress) {
        const connection = this.brandConnections[this.currentBrandId];
        const { description = '' } = metadata;

        console.log('📘 Facebook Reel Upload (URL method) - Starting');
        console.log('📘 Video URL:', videoUrl);
        onProgress(10, 'Initializing upload...');

        // Step 1: Initialize upload with file_url (Facebook downloads from URL)
        console.log('📘 Step 1: Creating reel with video URL...');
        const initResponse = await fetch(
            `${this.API_BASE}/${connection.facebookPageId}/video_reels`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    upload_phase: 'start',
                    file_url: videoUrl,
                    access_token: pageToken
                })
            }
        );

        const initData = await initResponse.json();
        console.log('📘 Init response:', initData);

        if (initData.error) {
            console.error('📘 Init failed:', initData.error);
            throw new Error(initData.error.message || 'Failed to initialize upload');
        }

        const videoId = initData.video_id;
        console.log('📘 Video ID:', videoId);
        onProgress(30, 'Uploading to Facebook...');

        // Step 2: Poll for video upload status - but with smarter exit conditions
        console.log('📘 Step 2: Polling for video upload status...');
        let attempts = 0;
        const maxWaitAttempts = 24; // 2 minutes max wait (5 sec intervals)
        let lastStatus = 'unknown';

        while (attempts < maxWaitAttempts) {
            await this.sleep(5000); // Wait 5 seconds between polls
            attempts++;
            
            // Check video status
            const statusResponse = await fetch(
                `${this.API_BASE}/${videoId}?fields=status&access_token=${pageToken}`
            );
            const statusData = await statusResponse.json();
            console.log(`📘 Video status (attempt ${attempts}):`, statusData);

            if (statusData.error) {
                console.log('📘 Status check error, continuing...');
            } else if (statusData.status) {
                lastStatus = statusData.status.video_status || 'unknown';
                console.log(`📘 Video status: ${lastStatus}`);
                
                // Update progress
                const progress = Math.min(30 + (attempts * 2), 75);
                onProgress(progress, `Processing... ${lastStatus}`);
                
                // Check for completion statuses
                if (lastStatus === 'ready' || lastStatus === 'complete') {
                    console.log('📘 Video is ready!');
                    break;
                } else if (lastStatus === 'error') {
                    throw new Error('Video processing failed on Facebook servers');
                }
                // For "uploading" or "processing" - continue waiting up to max
            }
        }

        // Step 3: Try to finish regardless of status (Facebook sometimes accepts it)
        onProgress(80, 'Publishing...');
        console.log(`📘 Step 3: Attempting to finish (last status: ${lastStatus})...`);
        
        const finishResponse = await fetch(
            `${this.API_BASE}/${connection.facebookPageId}/video_reels`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    upload_phase: 'finish',
                    video_id: videoId,
                    video_state: 'PUBLISHED',
                    description: description,
                    access_token: pageToken
                })
            }
        );

        const finishData = await finishResponse.json();
        console.log('📘 Finish response:', finishData);

        if (finishData.error) {
            console.error('📘 Finish failed:', finishData.error);
            
            // If still uploading, the file_url method isn't working well
            // Fall back to regular video post
            if (finishData.error.error_subcode === 1363130 || 
                finishData.error.message.includes('not uploaded')) {
                console.log('📘 Reel upload failed, trying regular video post...');
                return await this.uploadFacebookVideoByUrl(videoUrl, metadata, pageToken, onProgress);
            }
            
            throw new Error(finishData.error.message || 'Failed to publish Reel');
        }

        onProgress(100, 'Complete!');

        console.log('📘 Facebook Reel upload complete!', {
            videoId: videoId,
            success: finishData.success
        });

        return {
            id: videoId,
            videoId: videoId,
            success: finishData.success,
            url: `https://www.facebook.com/reel/${videoId}`
        };
    }

    /**
     * Upload regular Facebook Video by URL (avoids CORS)
     */
    async uploadFacebookVideoByUrl(videoUrl, metadata, pageToken, onProgress) {
        const connection = this.brandConnections[this.currentBrandId];
        const { title = '', description = '' } = metadata;

        console.log('📘 Facebook Video Upload (URL method) - Starting');
        onProgress(10, 'Uploading video...');

        const response = await fetch(
            `${this.API_BASE}/${connection.facebookPageId}/videos`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    file_url: videoUrl,
                    title: title,
                    description: description,
                    access_token: pageToken
                })
            }
        );

        const data = await response.json();
        console.log('📘 Video upload response:', data);

        if (data.error) {
            console.error('📘 Video upload failed:', data.error);
            throw new Error(data.error.message || 'Failed to upload video');
        }

        onProgress(100, 'Complete!');

        return {
            id: data.id,
            videoId: data.id,
            url: `https://www.facebook.com/watch/?v=${data.id}`
        };
    }

    // =====================================================
    // ANALYTICS
    // =====================================================

    /**
     * Get Instagram media insights
     */
    async getInstagramInsights(mediaId) {
        const connection = this.brandConnections[this.currentBrandId];
        if (!connection?.accessToken) {
            throw new Error('Not connected to Meta');
        }

        const metrics = [
            'impressions',
            'reach',
            'likes',
            'comments',
            'shares',
            'saved',
            'plays',
            'total_interactions'
        ].join(',');

        const response = await fetch(
            `${this.API_BASE}/${mediaId}/insights?metric=${metrics}&access_token=${connection.accessToken}`
        );
        const data = await response.json();

        if (data.error) {
            // Some metrics might not be available yet
            console.warn('Instagram insights error:', data.error.message);
            return null;
        }

        // Parse insights into a more usable format
        const insights = {};
        for (const item of (data.data || [])) {
            insights[item.name] = item.values?.[0]?.value || 0;
        }

        return insights;
    }

    /**
     * Get Instagram account insights
     */
    async getInstagramAccountInsights(period = 'day') {
        const connection = this.brandConnections[this.currentBrandId];
        if (!connection?.instagramAccountId) {
            throw new Error('Instagram not connected');
        }

        const metrics = [
            'impressions',
            'reach',
            'profile_views',
            'follower_count'
        ].join(',');

        const response = await fetch(
            `${this.API_BASE}/${connection.instagramAccountId}/insights?metric=${metrics}&period=${period}&access_token=${connection.accessToken}`
        );
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || 'Failed to fetch account insights');
        }

        const insights = {};
        for (const item of (data.data || [])) {
            insights[item.name] = item.values?.[0]?.value || 0;
        }

        return insights;
    }

    // =====================================================
    // UTILITY
    // =====================================================

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Validate video requirements for Instagram Reels
     */
    validateVideoForInstagram(file, durationSeconds) {
        const errors = [];

        // File size (max 1GB for Reels via API)
        const maxSizeMB = 1024;
        const fileSizeMB = file.size / (1024 * 1024);
        if (fileSizeMB > maxSizeMB) {
            errors.push(`File size (${fileSizeMB.toFixed(1)}MB) exceeds maximum of ${maxSizeMB}MB`);
        }

        // Duration (3-90 seconds for Reels)
        if (durationSeconds < 3) {
            errors.push('Video must be at least 3 seconds long');
        }
        if (durationSeconds > 90) {
            errors.push('Video must be 90 seconds or less for Reels');
        }

        // Format (mp4 recommended)
        const validTypes = ['video/mp4', 'video/quicktime'];
        if (!validTypes.includes(file.type)) {
            errors.push('Video format should be MP4 or MOV');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Validate video requirements for Facebook Reels
     */
    validateVideoForFacebook(file, durationSeconds) {
        const errors = [];

        // File size (max 4GB for Facebook)
        const maxSizeMB = 4096;
        const fileSizeMB = file.size / (1024 * 1024);
        if (fileSizeMB > maxSizeMB) {
            errors.push(`File size (${fileSizeMB.toFixed(1)}MB) exceeds maximum of ${maxSizeMB}MB`);
        }

        // Duration for Reels (3-90 seconds)
        if (durationSeconds < 3) {
            errors.push('Video must be at least 3 seconds long');
        }
        if (durationSeconds > 90) {
            errors.push('Video must be 90 seconds or less for Reels');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}

// Create singleton instance
const metaService = new MetaService();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MetaService, metaService };
}

// Export for browser
window.MetaService = MetaService;
window.metaService = metaService;
