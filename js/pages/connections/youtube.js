// Connections page — YouTube card, connect, disconnect, test
// Extracted from connections.html

function renderYouTubeCard(platform, brand) {
    const isConnected = brand ? youtubeService.isBrandConnected(brand.id) : false;
    const status = brand ? youtubeService.getBrandStatus(brand.id) : { channels: [], selectedChannel: null };
    const selectedChannel = status.selectedChannel;

    return `
        <div class="cn-card ${isConnected ? 'cn-card--connected' : ''}">
            <div class="cn-card__header" style="--platform-color: #FF0000">
                <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                <div class="cn-card__status-dot ${isConnected ? 'cn-card__status-dot--on' : ''}"></div>
            </div>
            <div class="cn-card__body">
                <h3 class="cn-card__name">${platform.name}</h3>
                <div class="cn-card__status">
                    ${!brand ? `<span class="cn-status cn-status--warn">Select a brand first</span>` :
                      isConnected ? `<span class="cn-status cn-status--success">Connected</span>${selectedChannel ? `<span class="cn-status__handle">${selectedChannel.title}</span>` : ''}` :
                      `<span class="cn-status">Not connected</span>`}
                </div>
                ${isConnected && status.channels.length > 0 ? `
                    <div class="cn-card__channel">
                        <label class="cn-label">Channel</label>
                        <select class="cn-select" onchange="selectYouTubeChannel(this.value)">
                            ${status.channels.map(ch => `
                                <option value="${ch.id}" ${ch.id === selectedChannel?.id ? 'selected' : ''}>
                                    ${ch.title} (${ch.subscriberCount || 0} subs)
                                </option>
                            `).join('')}
                        </select>
                    </div>
                ` : ''}
                <div class="cn-card__meta">
                    <div class="cn-meta-row"><span>Max video</span><span>60s (Shorts)</span></div>
                    <div class="cn-meta-row"><span>Auth</span><span>OAuth 2.0</span></div>
                </div>
            </div>
            <div class="cn-card__footer">
                ${isConnected ? `
                    <button class="cn-btn cn-btn--secondary" onclick="testYouTubeConnection()">Test</button>
                    <button class="cn-btn cn-btn--danger" onclick="disconnectYouTube()">Disconnect</button>
                ` : `
                    <button class="cn-btn cn-btn--primary" onclick="connectYouTube()" ${!brand ? 'disabled' : ''}>Connect with Google</button>
                `}
            </div>
            ${!YOUTUBE_CONFIG.clientId ? `
                <div class="cn-card__setup">
                    <button class="cn-btn cn-btn--setup" onclick="openYouTubeSetup()">⚙️ Setup API Keys</button>
                </div>
            ` : ''}
        </div>
    `;
}

function connectYouTube() {
    const brand = brandManager.getActiveBrand();
    if (!brand) { Toast.error('Please select a brand first'); return; }
    if (!YOUTUBE_CONFIG.clientId) { openYouTubeSetup(); return; }

    youtubeService.init(YOUTUBE_CONFIG.clientId);
    youtubeService.setBrand(brand.id);
    const authUrl = youtubeService.getAuthUrl(YOUTUBE_CONFIG.redirectUri);
    window.location.href = authUrl;
}

function disconnectYouTube() {
    const brand = brandManager.getActiveBrand();
    if (!brand) { Toast.error('Please select a brand first'); return; }

    if (confirm(`Disconnect YouTube from "${brand.name}"?`)) {
        youtubeService.disconnect();
        brand.disconnectPlatform('youtube');
        brandManager.save();
        loadPlatforms();
        Toast.success('YouTube disconnected');
    }
}

function selectYouTubeChannel(channelId) {
    youtubeService.selectChannel(channelId);
    Toast.success('Channel selected');
}

async function testYouTubeConnection() {
    Toast.info('Testing YouTube connection...');
    try {
        const channels = await youtubeService.fetchChannels();
        if (channels.length > 0) {
            Toast.success(`Connected! Found ${channels.length} channel(s)`);
            loadPlatforms();
        } else {
            Toast.warning('Connected but no channels found');
        }
    } catch (error) {
        Toast.error(`Test failed: ${error.message}`);
    }
}

function openYouTubeSetup() {
    const clientId = prompt('Enter your Google OAuth Client ID:', YOUTUBE_CONFIG.clientId);
    if (clientId === null) return;
    const clientSecret = prompt('Enter your Google OAuth Client Secret:', YOUTUBE_CONFIG.clientSecret);
    if (clientSecret === null) return;

    localStorage.setItem('youtube_client_id', clientId);
    localStorage.setItem('youtube_client_secret', clientSecret);
    YOUTUBE_CONFIG.clientId = clientId;
    YOUTUBE_CONFIG.clientSecret = clientSecret;
    Toast.success('YouTube API credentials saved!');
    loadPlatforms();
}

async function completeYouTubeAuth(code, brandId) {
    try {
        Toast.info('Completing YouTube connection...');
        if (!YOUTUBE_CONFIG.clientId || !YOUTUBE_CONFIG.clientSecret) {
            throw new Error('YouTube API credentials not configured');
        }
        youtubeService.init(YOUTUBE_CONFIG.clientId);
        await youtubeService.exchangeCodeForTokens(code, YOUTUBE_CONFIG.redirectUri, YOUTUBE_CONFIG.clientSecret, brandId);

        const brand = brandManager.get(brandId);
        if (brand && !brand.hasPlatform('youtube')) {
            brand.connectPlatform('youtube');
            await brandManager.update(brandId, { connectedPlatforms: brand.connectedPlatforms });
        }
        Toast.success('YouTube connected successfully!');
        loadPlatforms();
    } catch (error) {
        console.error('YouTube auth error:', error);
        Toast.error(`YouTube connection failed: ${error.message}`);
    }
}
