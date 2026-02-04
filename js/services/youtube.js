/**
 * YouTube Service
 * Handles OAuth 2.0 authentication and video uploads to YouTube
 * BRAND-AWARE: Each brand can have its own YouTube channel connection
 * SUPABASE-INTEGRATED: Tokens stored securely in Supabase
 */

class YouTubeService {
    constructor() {
        this.clientId = null;
        this.clientSecret = null;
        this.currentBrandId = null;
        
        // Local cache of brand connections (loaded from Supabase)
        this.brandConnections = {};
        
        // Track if we're using Supabase or localStorage fallback
        this.useSupabase = false;
        
        // Storage keys for localStorage fallback
        this.STORAGE_KEYS = {
            CLIENT_ID: 'youtube_client_id',
            CLIENT_SECRET: 'youtube_client_secret',
            BRAND_CONNECTIONS: 'youtube_brand_connections'
        };
        
        // API endpoints
        this.API_BASE = 'https://www.googleapis.com/youtube/v3';
        this.OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
        this.TOKEN_URL = 'https://oauth2.googleapis.com/token';
        
        // API endpoints for analytics
        this.ANALYTICS_API_BASE = 'https://youtubeanalytics.googleapis.com/v2';
        
        // Scopes needed
        this.SCOPES = [
            'https://www.googleapis.com/auth/youtube.upload',
            'https://www.googleapis.com/auth/youtube.readonly',
            'https://www.googleapis.com/auth/youtube.force-ssl',
            'https://www.googleapis.com/auth/yt-analytics.readonly'  // For detailed analytics
        ].join(' ');
    }

    /**
     * Initialize the YouTube service
     * @param {string} clientId - OAuth client ID
     * @param {string} clientSecret - OAuth client secret (optional, for token exchange)
     */
    async init(clientId, clientSecret = null) {
        // Only do full init once
        if (this._initialized && this.clientId === clientId) {
            return;
        }
        
        this.clientId = clientId;
        this.clientSecret = clientSecret || localStorage.getItem(this.STORAGE_KEYS.CLIENT_SECRET);
        
        // Check if Supabase is available
        this.useSupabase = typeof supabaseClient !== 'undefined' && supabaseClient !== null;
        
        // Only load from localStorage on first init (don't overwrite in-memory tokens)
        if (!this._initialized) {
            this.loadFromLocalStorage();
        }
        
        this._initialized = true;
        
        if (this.useSupabase) {
            console.log('📺 YouTube Service: Using Supabase storage');
        } else {
            console.log('📺 YouTube Service: Using localStorage fallback');
        }
        
        console.log('📺 YouTube Service initialized');
    }

    /**
     * Set the current brand context and load its tokens
     * @param {string} brandId - The brand to work with
     */
    async setBrand(brandId) {
        if (!brandId) {
            console.warn('YouTube Service: No brand ID provided');
            return;
        }
        
        this.currentBrandId = brandId;
        
        // Load tokens for this brand
        if (!this.brandConnections[brandId]) {
            if (this.useSupabase) {
                await this.loadBrandTokensFromSupabase(brandId);
            }
            
            // If still not found, try localStorage as fallback (migration support)
            if (!this.brandConnections[brandId]) {
                this.loadFromLocalStorage();
                
                // If found in localStorage but Supabase is available, sync to Supabase
                if (this.brandConnections[brandId] && this.useSupabase) {
                    console.log('📺 Migrating YouTube tokens from localStorage to Supabase');
                    await this.saveTokensToSupabase();
                }
            }
        }
        
        console.log(`📺 YouTube Service: Brand set to ${brandId}`);
    }

    /**
     * Load tokens from Supabase for a specific brand
     */
    async loadBrandTokensFromSupabase(brandId) {
        try {
            const { data, error } = await supabaseClient
                .from('platform_tokens')
                .select('*')
                .eq('brand_id', brandId)
                .eq('platform', 'youtube')
                .single();

            if (error && error.code !== 'PGRST116') {
                // PGRST116 = no rows found, which is fine
                console.error('Error loading YouTube tokens:', error);
                return;
            }

            if (data) {
                this.brandConnections[brandId] = {
                    accessToken: data.access_token,
                    refreshToken: data.refresh_token,
                    tokenExpiry: data.token_expires_at ? new Date(data.token_expires_at).getTime() : null,
                    channelId: data.platform_channel_id,
                    channelName: data.platform_channel_name,
                    channelThumbnail: data.platform_channel_thumbnail,
                    channels: [], // Will be fetched separately
                    selectedChannelId: data.platform_channel_id,
                    isValid: data.is_valid
                };
                
                console.log(`📺 Loaded YouTube tokens for brand ${brandId}`);
            }
        } catch (e) {
            console.error('Failed to load YouTube tokens from Supabase:', e);
        }
    }

    /**
     * Save tokens to Supabase for current brand
     */
    async saveTokensToSupabase() {
        if (!this.useSupabase || !this.currentBrandId) return;

        const conn = this.brandConnections[this.currentBrandId];
        if (!conn) return;

        try {
            const tokenData = {
                brand_id: this.currentBrandId,
                platform: 'youtube',
                access_token: conn.accessToken,
                refresh_token: conn.refreshToken,
                token_expires_at: conn.tokenExpiry ? new Date(conn.tokenExpiry).toISOString() : null,
                platform_channel_id: conn.selectedChannelId || conn.channelId,
                platform_channel_name: conn.channelName,
                platform_channel_thumbnail: conn.channelThumbnail,
                scopes: this.SCOPES.split(' '),
                is_valid: true,
                last_used_at: new Date().toISOString()
            };

            const { error } = await supabaseClient
                .from('platform_tokens')
                .upsert(tokenData, { onConflict: 'brand_id,platform' });

            if (error) throw error;
            console.log('📺 YouTube tokens saved to Supabase');
        } catch (e) {
            console.error('Failed to save YouTube tokens to Supabase:', e);
            // Fallback to localStorage
            this.saveToLocalStorage();
        }
    }

    /**
     * Load from localStorage (fallback)
     */
    loadFromLocalStorage() {
        try {
            const connectionsJson = localStorage.getItem(this.STORAGE_KEYS.BRAND_CONNECTIONS);
            if (connectionsJson) {
                const storedConnections = JSON.parse(connectionsJson);
                // MERGE with existing in-memory connections (don't replace!)
                // In-memory tokens take priority over localStorage
                for (const brandId in storedConnections) {
                    if (!this.brandConnections[brandId]) {
                        this.brandConnections[brandId] = storedConnections[brandId];
                    }
                }
            }
            
            // Check for expired tokens
            for (const brandId in this.brandConnections) {
                const conn = this.brandConnections[brandId];
                if (conn.tokenExpiry && Date.now() > conn.tokenExpiry) {
                    console.log(`YouTube token expired for brand ${brandId}`);
                    conn.accessToken = null;
                }
            }
        } catch (e) {
            console.error('Error loading YouTube data from storage:', e);
            // Don't reset brandConnections on error - keep existing in-memory tokens
        }
    }

    /**
     * Save to localStorage (fallback)
     */
    saveToLocalStorage() {
        try {
            localStorage.setItem(
                this.STORAGE_KEYS.BRAND_CONNECTIONS, 
                JSON.stringify(this.brandConnections)
            );
        } catch (e) {
            console.error('Error saving YouTube data:', e);
        }
    }

    /**
     * Get the current brand's connection data
     */
    getCurrentBrandConnection() {
        if (!this.currentBrandId) return null;
        return this.brandConnections[this.currentBrandId] || null;
    }

    /**
     * Check if current brand is connected
     */
    isConnected() {
        const conn = this.getCurrentBrandConnection();
        return conn && !!conn.accessToken && conn.isValid !== false;
    }

    /**
     * Check if a specific brand is connected
     */
    isBrandConnected(brandId) {
        const conn = this.brandConnections[brandId];
        return conn && !!conn.accessToken && conn.isValid !== false;
    }

    /**
     * Get all brands with YouTube connections
     */
    getConnectedBrands() {
        return Object.keys(this.brandConnections).filter(brandId => {
            const conn = this.brandConnections[brandId];
            return conn && conn.accessToken;
        });
    }

    /**
     * Get the OAuth authorization URL
     */
    getAuthUrl(redirectUri) {
        if (!this.clientId) {
            throw new Error('YouTube client ID not configured');
        }
        
        if (!this.currentBrandId) {
            throw new Error('No brand selected. Please select a brand first.');
        }
        
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: this.SCOPES,
            access_type: 'offline',
            prompt: 'consent',
            state: `youtube_auth:${this.currentBrandId}`
        });
        
        return `${this.OAUTH_URL}?${params.toString()}`;
    }

    /**
     * Parse the OAuth state to get brand ID
     */
    parseOAuthState(state) {
        if (state && state.startsWith('youtube_auth:')) {
            return state.replace('youtube_auth:', '');
        }
        return null;
    }

    /**
     * Exchange authorization code for tokens
     */
    async exchangeCodeForTokens(code, redirectUri, clientSecret, brandId) {
        if (brandId) {
            this.currentBrandId = brandId;
        }
        
        if (!this.currentBrandId) {
            throw new Error('No brand context for YouTube connection');
        }

        const response = await fetch(this.TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                code,
                client_id: this.clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error_description || 'Failed to exchange code for tokens');
        }

        const data = await response.json();
        
        // Initialize brand connection
        this.brandConnections[this.currentBrandId] = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            tokenExpiry: Date.now() + ((data.expires_in || 3600) * 1000),
            channels: [],
            selectedChannelId: null,
            isValid: true
        };
        
        // Save to Supabase
        await this.saveTokensToSupabase();
        
        // Also save to localStorage as backup
        this.saveToLocalStorage();
        
        // Fetch channels after connecting
        await this.fetchChannels();
        
        return data;
    }

    /**
     * Refresh the access token for current brand
     */
    async refreshAccessToken() {
        const conn = this.getCurrentBrandConnection();
        if (!conn || !conn.refreshToken) {
            throw new Error('No refresh token available');
        }

        const clientSecret = this.clientSecret || localStorage.getItem(this.STORAGE_KEYS.CLIENT_SECRET);
        
        const response = await fetch(this.TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: clientSecret,
                refresh_token: conn.refreshToken,
                grant_type: 'refresh_token'
            })
        });

        if (!response.ok) {
            const error = await response.json();
            conn.isValid = false;
            await this.saveTokensToSupabase();
            throw new Error(error.error_description || 'Failed to refresh token');
        }

        const data = await response.json();
        
        conn.accessToken = data.access_token;
        conn.tokenExpiry = Date.now() + ((data.expires_in || 3600) * 1000);
        conn.isValid = true;
        
        await this.saveTokensToSupabase();
        this.saveToLocalStorage();
        
        return data;
    }

    /**
     * Get access token for current brand (auto-refresh if needed)
     */
    async getAccessToken() {
        console.log('📺 getAccessToken called, currentBrandId:', this.currentBrandId);
        console.log('📺 brandConnections keys:', Object.keys(this.brandConnections));
        
        const conn = this.getCurrentBrandConnection();
        console.log('📺 getCurrentBrandConnection result:', conn ? 'found' : 'null', conn?.accessToken ? 'has token' : 'no token');
        
        if (!conn) return null;
        
        // Check if token is expired or about to expire (5 min buffer)
        if (conn.tokenExpiry && Date.now() > conn.tokenExpiry - 300000) {
            console.log('📺 Access token expired, refreshing...');
            try {
                await this.refreshAccessToken();
            } catch (e) {
                console.error('Failed to refresh token:', e);
                return null;
            }
        }
        
        return conn.accessToken;
    }

    /**
     * Make an authenticated API request
     */
    async apiRequest(endpoint, options = {}) {
        const accessToken = await this.getAccessToken();
        if (!accessToken) {
            throw new Error('Not authenticated with YouTube for this brand');
        }

        const url = endpoint.startsWith('http') ? endpoint : `${this.API_BASE}${endpoint}`;
        
        const response = await fetch(url, {
            ...options,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...options.headers
            }
        });

        if (response.status === 401) {
            // Mark connection as invalid
            const conn = this.getCurrentBrandConnection();
            if (conn) {
                conn.isValid = false;
                await this.saveTokensToSupabase();
            }
            throw new Error('YouTube token expired. Please reconnect.');
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || `API error: ${response.status}`);
        }

        return response.json();
    }

    /**
     * Fetch user's YouTube channels for current brand
     */
    async fetchChannels() {
        const data = await this.apiRequest('/channels?part=snippet,contentDetails,statistics&mine=true');
        
        const channels = (data.items || []).map(channel => ({
            id: channel.id,
            title: channel.snippet.title,
            description: channel.snippet.description,
            thumbnail: channel.snippet.thumbnails?.default?.url,
            subscriberCount: channel.statistics?.subscriberCount,
            videoCount: channel.statistics?.videoCount
        }));
        
        const conn = this.getCurrentBrandConnection();
        if (conn) {
            conn.channels = channels;
            
            // Auto-select first channel if none selected
            if (channels.length > 0 && !conn.selectedChannelId) {
                conn.selectedChannelId = channels[0].id;
                conn.channelName = channels[0].title;
                conn.channelThumbnail = channels[0].thumbnail;
            }
            
            await this.saveTokensToSupabase();
            this.saveToLocalStorage();
        }
        
        return channels;
    }

    /**
     * Get connected channels for current brand
     */
    getChannels() {
        const conn = this.getCurrentBrandConnection();
        return conn ? conn.channels || [] : [];
    }

    /**
     * Select a channel for uploads
     */
    async selectChannel(channelId) {
        const conn = this.getCurrentBrandConnection();
        if (!conn) {
            throw new Error('No YouTube connection for this brand');
        }
        
        const channel = (conn.channels || []).find(c => c.id === channelId);
        if (!channel) {
            throw new Error('Channel not found');
        }
        
        conn.selectedChannelId = channelId;
        conn.channelName = channel.title;
        conn.channelThumbnail = channel.thumbnail;
        
        await this.saveTokensToSupabase();
        this.saveToLocalStorage();
        
        return channel;
    }

    /**
     * Get selected channel for current brand
     */
    getSelectedChannel() {
        const conn = this.getCurrentBrandConnection();
        if (!conn) return null;
        return (conn.channels || []).find(c => c.id === conn.selectedChannelId);
    }

    /**
     * Upload a video to YouTube
     */
    async uploadVideo(videoFile, metadata) {
        const accessToken = await this.getAccessToken();
        if (!accessToken) {
            throw new Error('Not authenticated with YouTube for this brand');
        }

        const { 
            title, 
            description = '', 
            tags = [], 
            categoryId = '22', // People & Blogs
            privacyStatus = 'private',
            madeForKids = false,
            isShort = true
        } = metadata;

        const videoResource = {
            snippet: {
                title: isShort ? `${title} #Shorts` : title,
                description,
                tags: isShort ? [...tags, 'Shorts'] : tags,
                categoryId
            },
            status: {
                privacyStatus,
                selfDeclaredMadeForKids: madeForKids
            }
        };

        const uploadUrl = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

        // Step 1: Initialize resumable upload
        const initResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-Upload-Content-Length': videoFile.size,
                'X-Upload-Content-Type': videoFile.type || 'video/mp4'
            },
            body: JSON.stringify(videoResource)
        });

        if (!initResponse.ok) {
            const error = await initResponse.json().catch(() => ({}));
            throw new Error(error.error?.message || 'Failed to initialize upload');
        }

        const uploadUri = initResponse.headers.get('Location');
        
        if (!uploadUri) {
            throw new Error('No upload URI returned');
        }

        // Step 2: Upload the video file
        const uploadResponse = await fetch(uploadUri, {
            method: 'PUT',
            headers: {
                'Content-Type': videoFile.type || 'video/mp4',
                'Content-Length': videoFile.size
            },
            body: videoFile
        });

        if (!uploadResponse.ok) {
            const error = await uploadResponse.json().catch(() => ({}));
            throw new Error(error.error?.message || 'Failed to upload video');
        }

        const video = await uploadResponse.json();
        
        // Update last_used_at in Supabase
        if (this.useSupabase && this.currentBrandId) {
            await supabaseClient
                .from('platform_tokens')
                .update({ last_used_at: new Date().toISOString() })
                .eq('brand_id', this.currentBrandId)
                .eq('platform', 'youtube');
        }
        
        return {
            id: video.id,
            title: video.snippet.title,
            url: `https://youtube.com/shorts/${video.id}`,
            thumbnail: video.snippet.thumbnails?.default?.url
        };
    }

    /**
     * Upload video with progress tracking
     */
    async uploadVideoWithProgress(videoFile, metadata, onProgress) {
        const accessToken = await this.getAccessToken();
        if (!accessToken) {
            throw new Error('Not authenticated with YouTube for this brand');
        }

        const { 
            title, 
            description = '', 
            tags = [], 
            categoryId = '22',
            privacyStatus = 'public',
            madeForKids = false,
            isShort = true,
            notifySubscribers = true,
            allowComments = 'all',
            allowEmbedding = true,
            license = 'youtube'
        } = metadata;

        const videoResource = {
            snippet: {
                title: isShort ? `${title} #Shorts` : title,
                description,
                tags: isShort ? [...tags, 'Shorts'] : tags,
                categoryId
            },
            status: {
                privacyStatus,
                selfDeclaredMadeForKids: madeForKids === true || madeForKids === 'true',
                embeddable: allowEmbedding,
                license: license,
                publicStatsViewable: true
            }
        };

        // Add notify subscribers setting (only applies to public videos)
        if (privacyStatus === 'public') {
            // notifySubscribers is controlled via the upload URL parameter
        }

        const notifyParam = notifySubscribers ? '&notifySubscribers=true' : '&notifySubscribers=false';
        const uploadUrl = `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status${notifyParam}`;
        
        const initResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-Upload-Content-Length': videoFile.size,
                'X-Upload-Content-Type': videoFile.type || 'video/mp4'
            },
            body: JSON.stringify(videoResource)
        });

        if (!initResponse.ok) {
            const errorData = await initResponse.json().catch(() => ({}));
            throw new Error(errorData.error?.message || 'Failed to initialize upload');
        }

        const uploadUri = initResponse.headers.get('Location');

        // Upload with XMLHttpRequest for progress tracking
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable && onProgress) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    onProgress(percent);
                }
            });

            xhr.addEventListener('load', async () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    const video = JSON.parse(xhr.responseText);
                    
                    // Update last_used_at
                    if (this.useSupabase && this.currentBrandId) {
                        await supabaseClient
                            .from('platform_tokens')
                            .update({ last_used_at: new Date().toISOString() })
                            .eq('brand_id', this.currentBrandId)
                            .eq('platform', 'youtube');
                    }
                    
                    resolve({
                        videoId: video.id,  // For analytics lookup
                        id: video.id,       // Keep for backwards compatibility
                        title: video.snippet.title,
                        url: `https://youtube.com/shorts/${video.id}`,
                        thumbnail: video.snippet.thumbnails?.default?.url
                    });
                } else {
                    reject(new Error(`Upload failed: ${xhr.status}`));
                }
            });

            xhr.addEventListener('error', () => reject(new Error('Upload failed')));
            xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

            xhr.open('PUT', uploadUri);
            xhr.setRequestHeader('Content-Type', videoFile.type || 'video/mp4');
            xhr.send(videoFile);
        });
    }

    /**
     * Disconnect current brand from YouTube
     */
    async disconnect() {
        if (!this.currentBrandId) {
            console.warn('No brand selected for disconnect');
            return;
        }
        
        // Remove from Supabase
        if (this.useSupabase) {
            try {
                await supabaseClient
                    .from('platform_tokens')
                    .delete()
                    .eq('brand_id', this.currentBrandId)
                    .eq('platform', 'youtube');
            } catch (e) {
                console.error('Failed to delete tokens from Supabase:', e);
            }
        }
        
        // Remove from local cache
        delete this.brandConnections[this.currentBrandId];
        this.saveToLocalStorage();
        
        console.log(`📺 Disconnected brand ${this.currentBrandId} from YouTube`);
    }

    /**
     * Get connection status for current brand
     */
    getStatus() {
        const conn = this.getCurrentBrandConnection();
        const selectedChannel = this.getSelectedChannel();
        
        return {
            connected: this.isConnected(),
            brandId: this.currentBrandId,
            channelCount: conn ? (conn.channels || []).length : 0,
            selectedChannel: selectedChannel,
            channels: conn ? conn.channels || [] : [],
            isValid: conn ? conn.isValid !== false : false
        };
    }

    /**
     * Get connection status for a specific brand
     */
    getBrandStatus(brandId) {
        const conn = this.brandConnections[brandId];
        if (!conn) {
            return {
                connected: false,
                brandId: brandId,
                channelCount: 0,
                selectedChannel: null,
                channels: [],
                isValid: false
            };
        }
        
        const selectedChannel = (conn.channels || []).find(c => c.id === conn.selectedChannelId) || {
            id: conn.selectedChannelId,
            title: conn.channelName,
            thumbnail: conn.channelThumbnail
        };
        
        return {
            connected: !!conn.accessToken && conn.isValid !== false,
            brandId: brandId,
            channelCount: (conn.channels || []).length,
            selectedChannel: selectedChannel,
            channels: conn.channels || [],
            isValid: conn.isValid !== false
        };
    }

    // ==================== ANALYTICS METHODS ====================

    /**
     * Get basic statistics for a single video
     * Uses YouTube Data API (no additional scope needed beyond youtube.readonly)
     * @param {string} videoId - The YouTube video ID
     * @returns {Object} Video statistics
     */
    async getVideoStats(videoId) {
        if (!videoId) {
            throw new Error('Video ID is required');
        }

        const data = await this.apiRequest(`/videos?part=snippet,statistics,contentDetails&id=${videoId}`);
        
        if (!data.items || data.items.length === 0) {
            return null;
        }

        const video = data.items[0];
        const stats = video.statistics || {};
        
        return {
            videoId: video.id,
            title: video.snippet?.title,
            publishedAt: video.snippet?.publishedAt,
            duration: video.contentDetails?.duration,
            thumbnail: video.snippet?.thumbnails?.medium?.url || video.snippet?.thumbnails?.default?.url,
            views: parseInt(stats.viewCount || 0),
            likes: parseInt(stats.likeCount || 0),
            comments: parseInt(stats.commentCount || 0),
            favorites: parseInt(stats.favoriteCount || 0)
        };
    }

    /**
     * Get statistics for multiple videos at once
     * @param {string[]} videoIds - Array of YouTube video IDs (max 50)
     * @returns {Object[]} Array of video statistics
     */
    async getMultipleVideoStats(videoIds) {
        if (!videoIds || videoIds.length === 0) {
            return [];
        }

        // YouTube API allows max 50 IDs per request
        const chunks = [];
        for (let i = 0; i < videoIds.length; i += 50) {
            chunks.push(videoIds.slice(i, i + 50));
        }

        const results = [];
        for (const chunk of chunks) {
            const ids = chunk.join(',');
            const data = await this.apiRequest(`/videos?part=snippet,statistics,contentDetails&id=${ids}`);
            
            if (data.items) {
                for (const video of data.items) {
                    const stats = video.statistics || {};
                    results.push({
                        videoId: video.id,
                        title: video.snippet?.title,
                        publishedAt: video.snippet?.publishedAt,
                        duration: video.contentDetails?.duration,
                        thumbnail: video.snippet?.thumbnails?.medium?.url,
                        views: parseInt(stats.viewCount || 0),
                        likes: parseInt(stats.likeCount || 0),
                        comments: parseInt(stats.commentCount || 0),
                        favorites: parseInt(stats.favoriteCount || 0)
                    });
                }
            }
        }

        return results;
    }

    /**
     * Get detailed analytics for a video
     * Uses YouTube Analytics API (requires yt-analytics.readonly scope)
     * @param {string} videoId - The YouTube video ID
     * @param {string} startDate - Start date (YYYY-MM-DD)
     * @param {string} endDate - End date (YYYY-MM-DD)
     * @returns {Object} Detailed analytics
     */
    async getVideoAnalytics(videoId, startDate = null, endDate = null) {
        if (!videoId) {
            throw new Error('Video ID is required');
        }

        // Default to last 30 days if no dates provided
        if (!endDate) {
            endDate = new Date().toISOString().split('T')[0];
        }
        if (!startDate) {
            const start = new Date();
            start.setDate(start.getDate() - 30);
            startDate = start.toISOString().split('T')[0];
        }

        // Get access token (handles refresh automatically)
        const accessToken = await this.getAccessToken();
        if (!accessToken) {
            throw new Error('Not authenticated with YouTube');
        }

        const metrics = [
            'views',
            'estimatedMinutesWatched',
            'averageViewDuration',
            'averageViewPercentage',
            'likes',
            'dislikes',
            'comments',
            'shares',
            'subscribersGained',
            'subscribersLost'
        ].join(',');

        const url = `${this.ANALYTICS_API_BASE}/reports?` +
            `ids=channel==MINE` +
            `&startDate=${startDate}` +
            `&endDate=${endDate}` +
            `&metrics=${metrics}` +
            `&dimensions=video` +
            `&filters=video==${videoId}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('Analytics API error:', error);
            throw new Error(error.error?.message || 'Failed to fetch analytics');
        }

        const data = await response.json();
        
        // Parse the response
        if (!data.rows || data.rows.length === 0) {
            return {
                videoId,
                startDate,
                endDate,
                views: 0,
                watchTimeMinutes: 0,
                avgViewDuration: 0,
                avgViewPercentage: 0,
                likes: 0,
                dislikes: 0,
                comments: 0,
                shares: 0,
                subscribersGained: 0,
                subscribersLost: 0,
                netSubscribers: 0
            };
        }

        const row = data.rows[0];
        const columnHeaders = data.columnHeaders.map(h => h.name);
        
        const getValue = (name) => {
            const idx = columnHeaders.indexOf(name);
            return idx >= 0 ? row[idx] : 0;
        };

        return {
            videoId,
            startDate,
            endDate,
            views: getValue('views'),
            watchTimeMinutes: Math.round(getValue('estimatedMinutesWatched')),
            avgViewDuration: Math.round(getValue('averageViewDuration')),
            avgViewPercentage: Math.round(getValue('averageViewPercentage') * 10) / 10,
            likes: getValue('likes'),
            dislikes: getValue('dislikes'),
            comments: getValue('comments'),
            shares: getValue('shares'),
            subscribersGained: getValue('subscribersGained'),
            subscribersLost: getValue('subscribersLost'),
            netSubscribers: getValue('subscribersGained') - getValue('subscribersLost')
        };
    }

    /**
     * Get analytics over time for a video (for charts)
     * @param {string} videoId - The YouTube video ID
     * @param {string} startDate - Start date (YYYY-MM-DD)
     * @param {string} endDate - End date (YYYY-MM-DD)
     * @returns {Object} Daily analytics data
     */
    async getVideoAnalyticsTimeSeries(videoId, startDate = null, endDate = null) {
        if (!videoId) {
            throw new Error('Video ID is required');
        }

        // Default to last 30 days
        if (!endDate) {
            endDate = new Date().toISOString().split('T')[0];
        }
        if (!startDate) {
            const start = new Date();
            start.setDate(start.getDate() - 30);
            startDate = start.toISOString().split('T')[0];
        }

        const accessToken = await this.getAccessToken();
        if (!accessToken) {
            throw new Error('Not authenticated with YouTube');
        }

        const url = `${this.ANALYTICS_API_BASE}/reports?` +
            `ids=channel==MINE` +
            `&startDate=${startDate}` +
            `&endDate=${endDate}` +
            `&metrics=views,estimatedMinutesWatched,likes` +
            `&dimensions=day` +
            `&filters=video==${videoId}` +
            `&sort=day`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Failed to fetch analytics');
        }

        const data = await response.json();
        
        const timeSeries = {
            dates: [],
            views: [],
            watchTimeMinutes: [],
            likes: []
        };

        if (data.rows) {
            for (const row of data.rows) {
                timeSeries.dates.push(row[0]);
                timeSeries.views.push(row[1]);
                timeSeries.watchTimeMinutes.push(Math.round(row[2]));
                timeSeries.likes.push(row[3]);
            }
        }

        return timeSeries;
    }

    /**
     * Get traffic sources for a video
     * @param {string} videoId - The YouTube video ID
     * @param {string} startDate - Start date (YYYY-MM-DD)
     * @param {string} endDate - End date (YYYY-MM-DD)
     * @returns {Object[]} Traffic source breakdown
     */
    async getVideoTrafficSources(videoId, startDate = null, endDate = null) {
        if (!videoId) {
            throw new Error('Video ID is required');
        }

        if (!endDate) {
            endDate = new Date().toISOString().split('T')[0];
        }
        if (!startDate) {
            const start = new Date();
            start.setDate(start.getDate() - 30);
            startDate = start.toISOString().split('T')[0];
        }

        const accessToken = await this.getAccessToken();
        if (!accessToken) {
            throw new Error('Not authenticated with YouTube');
        }

        const url = `${this.ANALYTICS_API_BASE}/reports?` +
            `ids=channel==MINE` +
            `&startDate=${startDate}` +
            `&endDate=${endDate}` +
            `&metrics=views,estimatedMinutesWatched` +
            `&dimensions=insightTrafficSourceType` +
            `&filters=video==${videoId}` +
            `&sort=-views`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Failed to fetch traffic sources');
        }

        const data = await response.json();
        
        const sources = [];
        const sourceLabels = {
            'YT_SEARCH': 'YouTube Search',
            'SUGGESTED': 'Suggested Videos',
            'BROWSE': 'Browse Features',
            'EXT_URL': 'External',
            'YT_CHANNEL': 'Channel Page',
            'YT_OTHER_PAGE': 'Other YouTube',
            'NO_LINK_OTHER': 'Direct/Unknown',
            'NOTIFICATION': 'Notifications',
            'END_SCREEN': 'End Screens',
            'YT_PLAYLIST_PAGE': 'Playlists',
            'SUBSCRIBER': 'Subscribers',
            'SHORTS': 'Shorts Feed'
        };

        if (data.rows) {
            for (const row of data.rows) {
                sources.push({
                    source: row[0],
                    label: sourceLabels[row[0]] || row[0],
                    views: row[1],
                    watchTimeMinutes: Math.round(row[2])
                });
            }
        }

        return sources;
    }
}

// Export singleton
window.youtubeService = new YouTubeService();
