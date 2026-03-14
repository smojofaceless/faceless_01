// Connections page — Twitter/X card, connect, disconnect, test
// Extracted from connections.html

function renderTwitterCard(platform, brand) {
    const isConnected = brand ? twitterService.isBrandConnected(brand.id) : false;
    const connectionInfo = brand ? twitterService.getConnectionInfo() : null;

    return `
        <div class="cn-card ${isConnected ? 'cn-card--connected' : ''}">
            <div class="cn-card__header" style="--platform-color: #000000; background: #000">
                <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                <div class="cn-card__status-dot ${isConnected ? 'cn-card__status-dot--on' : ''}"></div>
            </div>
            <div class="cn-card__body">
                <h3 class="cn-card__name">X (Twitter)</h3>
                <div class="cn-card__status">
                    ${!brand ? `<span class="cn-status cn-status--warn">Select a brand first</span>` :
                      isConnected ? `<span class="cn-status cn-status--success">Connected</span>${connectionInfo?.username ? `<span class="cn-status__handle">@${connectionInfo.username}</span>` : ''}` :
                      `<span class="cn-status">Not connected</span>`}
                </div>
                <div class="cn-card__meta">
                    <div class="cn-meta-row"><span>Max caption</span><span>280 chars</span></div>
                    <div class="cn-meta-row"><span>Auth</span><span>OAuth 2.0 PKCE</span></div>
                </div>
            </div>
            <div class="cn-card__footer">
                ${isConnected ? `
                    <button class="cn-btn cn-btn--secondary" onclick="testTwitterConnection()">Test</button>
                    <button class="cn-btn cn-btn--danger" onclick="disconnectTwitter()">Disconnect</button>
                ` : `
                    <button class="cn-btn cn-btn--primary" onclick="connectTwitter()" ${!brand ? 'disabled' : ''}>Connect with X</button>
                `}
            </div>
            ${!TWITTER_CONFIG.clientId ? `<div class="cn-card__setup"><button class="cn-btn cn-btn--setup" onclick="openTwitterSetup()">⚙️ Setup API Keys</button></div>` : ''}
        </div>
    `;
}

async function connectTwitter() {
    const brand = brandManager.getActiveBrand();
    if (!brand) { Toast.error('Please select a brand first'); return; }
    if (!TWITTER_CONFIG.clientId) { openTwitterSetup(); return; }

    twitterService.init(TWITTER_CONFIG.clientId);
    twitterService.setBrand(brand.id);

    const csrfState = JSON.stringify({
        brandId: brand.id,
        platform: 'twitter',
        nonce: Math.random().toString(36).substring(7)
    });
    const encodedState = btoa(csrfState);

    try {
        const authUrl = await twitterService.getAuthUrl(TWITTER_CONFIG.redirectUri, encodedState);
        window.location.href = authUrl;
    } catch (error) {
        Toast.error(`Failed to generate auth URL: ${error.message}`);
    }
}

async function completeTwitterAuth(code, brandId) {
    try {
        Toast.info('Completing X connection...');
        if (!TWITTER_CONFIG.clientId) {
            throw new Error('Twitter API credentials not configured. Use Setup button.');
        }

        twitterService.init(TWITTER_CONFIG.clientId);
        await twitterService.setBrand(brandId);

        const result = await twitterService.handleCallback(code, TWITTER_CONFIG.redirectUri, TWITTER_CONFIG.clientSecret);

        const brand = brandManager.get(brandId);
        if (brand && !brand.hasPlatform('twitter')) {
            brand.connectPlatform('twitter');
            await brandManager.update(brandId, { connectedPlatforms: brand.connectedPlatforms });
        }

        Toast.success(`X connected: @${result.username || result.userId}`);
        loadPlatforms();
    } catch (error) {
        console.error('Twitter auth error:', error);
        Toast.error(`X connection failed: ${error.message}`);
    }
}

async function disconnectTwitter() {
    const brand = brandManager.getActiveBrand();
    if (!brand) { Toast.error('Please select a brand first'); return; }

    if (!confirm(`Disconnect X (Twitter) for ${brand.name}?`)) return;

    try {
        await twitterService.disconnect();
        if (brand.hasPlatform('twitter')) {
            brand.disconnectPlatform('twitter');
            await brandManager.update(brand.id, { connectedPlatforms: brand.connectedPlatforms });
        }
        Toast.success('X disconnected');
        loadPlatforms();
    } catch (error) {
        Toast.error(`Failed to disconnect: ${error.message}`);
    }
}

async function testTwitterConnection() {
    Toast.info('Testing X connection...');
    try {
        const result = await twitterService.testConnection();
        if (result.success) {
            Toast.success(`X working! Connected as @${result.username}`);
        } else {
            Toast.error(`X test failed: ${result.error}`);
        }
    } catch (error) {
        Toast.error(`Test failed: ${error.message}`);
    }
}

function openTwitterSetup() {
    const clientId = prompt('Enter your X (Twitter) OAuth 2.0 Client ID:', TWITTER_CONFIG.clientId);
    if (clientId === null) return;
    const clientSecret = prompt('Enter your X Client Secret (for token refresh):', TWITTER_CONFIG.clientSecret);
    if (clientSecret === null) return;

    localStorage.setItem('twitter_client_id', clientId);
    localStorage.setItem('twitter_client_secret', clientSecret);
    TWITTER_CONFIG.clientId = clientId;
    TWITTER_CONFIG.clientSecret = clientSecret;
    Toast.success('X API credentials saved!');
    loadPlatforms();
}
