// Connections page — TikTok card, connect, disconnect, test
// Extracted from connections.html

function renderTikTokCard(platform, brand) {
    const isConnected = brand ? tiktokService.isBrandConnected(brand.id) : false;
    const connectionInfo = brand ? tiktokService.getConnectionInfo() : null;

    return `
        <div class="cn-card ${isConnected ? 'cn-card--connected' : ''}">
            <div class="cn-card__header" style="--platform-color: #000000; background: #000">
                <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15.2a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.93a8.26 8.26 0 0 0 4.82 1.56V7.04a4.84 4.84 0 0 1-1.06-.35z"/>
                </svg>
                <div class="cn-card__status-dot ${isConnected ? 'cn-card__status-dot--on' : ''}"></div>
            </div>
            <div class="cn-card__body">
                <h3 class="cn-card__name">TikTok</h3>
                <div class="cn-card__status">
                    ${!brand ? `<span class="cn-status cn-status--warn">Select a brand first</span>` :
                      isConnected ? `<span class="cn-status cn-status--success">Connected</span>${connectionInfo?.displayName ? `<span class="cn-status__handle">@${connectionInfo.displayName}</span>` : ''}` :
                      `<span class="cn-status">Not connected</span>`}
                </div>
                <div class="cn-card__meta">
                    <div class="cn-meta-row"><span>Max video</span><span>10min</span></div>
                    <div class="cn-meta-row"><span>Auth</span><span>OAuth 2.0</span></div>
                </div>
            </div>
            <div class="cn-card__footer">
                ${isConnected ? `
                    <button class="cn-btn cn-btn--secondary" onclick="testTikTokConnection()">Test</button>
                    <button class="cn-btn cn-btn--danger" onclick="disconnectTikTok()">Disconnect</button>
                ` : `
                    <button class="cn-btn cn-btn--primary" onclick="connectTikTok()" ${!brand ? 'disabled' : ''}>Connect with TikTok</button>
                `}
            </div>
            ${!TIKTOK_CONFIG.clientKey ? `<div class="cn-card__setup"><button class="cn-btn cn-btn--setup" onclick="openTikTokSetup()">⚙️ Setup API Keys</button></div>` : ''}
        </div>
    `;
}

function connectTikTok() {
    const brand = brandManager.getActiveBrand();
    if (!brand) { Toast.error('Please select a brand first'); return; }
    if (!TIKTOK_CONFIG.clientKey) { openTikTokSetup(); return; }

    tiktokService.init(TIKTOK_CONFIG.clientKey, TIKTOK_CONFIG.clientSecret);
    tiktokService.setBrand(brand.id);

    const csrfState = JSON.stringify({
        brandId: brand.id,
        platform: 'tiktok',
        nonce: Math.random().toString(36).substring(7)
    });

    const params = new URLSearchParams({
        client_key: TIKTOK_CONFIG.clientKey,
        response_type: 'code',
        scope: 'user.info.basic,video.upload,video.publish',
        redirect_uri: TIKTOK_CONFIG.redirectUri,
        state: csrfState
    });

    window.location.href = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

async function disconnectTikTok() {
    const brand = brandManager.getActiveBrand();
    if (!brand) { Toast.error('Please select a brand first'); return; }

    if (confirm(`Disconnect TikTok from "${brand.name}"? You'll need to reconnect to upload videos.`)) {
        await tiktokService.disconnect();
        brand.disconnectPlatform('tiktok');
        await brandManager.update(brand.id, { connectedPlatforms: brand.connectedPlatforms });
        loadPlatforms();
        Toast.success('TikTok disconnected');
    }
}

async function testTikTokConnection() {
    Toast.info('Testing TikTok connection...');
    try {
        const connectionInfo = tiktokService.getConnectionInfo();
        if (connectionInfo?.openId) {
            Toast.success(`TikTok connected: ${connectionInfo.displayName || connectionInfo.openId}`);
        } else {
            Toast.warning('TikTok connection status unknown');
        }
    } catch (error) {
        Toast.error(`Test failed: ${error.message}`);
    }
}

function openTikTokSetup() {
    const clientKey = prompt('Enter your TikTok Client Key (App Key):', TIKTOK_CONFIG.clientKey);
    if (clientKey === null) return;
    const clientSecret = prompt('Enter your TikTok Client Secret (App Secret):', TIKTOK_CONFIG.clientSecret);
    if (clientSecret === null) return;

    localStorage.setItem('tiktok_client_key', clientKey);
    localStorage.setItem('tiktok_client_secret', clientSecret);
    TIKTOK_CONFIG.clientKey = clientKey;
    TIKTOK_CONFIG.clientSecret = clientSecret;
    Toast.success('TikTok API credentials saved!');
    loadPlatforms();
}

async function completeTikTokAuth(code, brandId) {
    try {
        Toast.info('Completing TikTok connection...');
        if (!TIKTOK_CONFIG.clientKey || !TIKTOK_CONFIG.clientSecret) {
            throw new Error('TikTok API credentials not configured');
        }

        tiktokService.init(TIKTOK_CONFIG.clientKey, TIKTOK_CONFIG.clientSecret);
        await tiktokService.setBrand(brandId);

        const result = await tiktokService.handleCallback(code, TIKTOK_CONFIG.redirectUri);

        const brand = brandManager.get(brandId);
        if (brand && !brand.hasPlatform('tiktok')) {
            brand.connectPlatform('tiktok');
            await brandManager.update(brandId, { connectedPlatforms: brand.connectedPlatforms });
        }

        Toast.success(`TikTok connected: ${result.displayName}`);
        loadPlatforms();
    } catch (error) {
        console.error('TikTok auth error:', error);
        Toast.error(`TikTok connection failed: ${error.message}`);
    }
}
