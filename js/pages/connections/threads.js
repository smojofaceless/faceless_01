// Connections page — Threads card, connect, disconnect, test
// Extracted from connections.html

function renderThreadsCard(platform, brand) {
    const isConnected = brand ? threadsService.isBrandConnected(brand.id) : false;
    const connectionInfo = brand ? threadsService.getConnectionInfo() : null;

    return `
        <div class="cn-card ${isConnected ? 'cn-card--connected' : ''}">
            <div class="cn-card__header" style="--platform-color: #000000; background: #000">
                <svg viewBox="0 0 192 192" fill="currentColor" width="32" height="32">
                    <path d="M141.537 88.9883C140.71 88.5919 139.87 88.2104 139.019 87.8451C137.537 60.5382 122.616 44.905 97.5619 44.745C97.4484 44.7443 97.3355 44.7443 97.222 44.745C82.2364 44.745 69.7731 51.1409 62.102 62.7728L75.763 72.1997C81.3498 63.6142 89.9802 59.186 97.222 59.186C97.2836 59.186 97.3458 59.186 97.4073 59.1867C106.21 59.2384 112.869 62.1384 117.216 67.7747C120.491 72.0266 122.705 77.8819 123.821 85.2655C117.093 84.0771 109.862 83.6085 102.205 83.8593C81.0545 84.4978 66.7649 96.2791 67.7071 112.217C68.188 120.271 72.2289 127.325 79.0312 132.103C84.871 135.982 92.3502 137.95 100.132 137.583C110.546 137.088 118.916 132.934 124.999 125.2C129.588 119.358 132.67 111.905 134.341 102.568C139.235 105.467 142.967 109.252 145.263 113.888C149.063 121.545 149.296 133.858 141.632 142.479C134.888 150.091 126.296 153.596 112.027 153.708C96.2504 153.585 84.4515 148.706 76.7809 139.187C69.5413 130.181 65.8003 117.371 65.4816 101.12C65.8003 84.869 69.5413 72.0591 76.7809 63.053C84.4515 53.5344 96.2504 48.6553 112.027 48.5323C127.943 48.6567 139.933 53.5767 147.844 63.1751C151.706 67.8571 154.672 73.6204 156.67 80.3288L170.107 76.5613C167.6 68.3224 163.905 61.2003 159.028 55.2565C148.969 43.0132 134.468 36.7504 112.127 36.5918C112.093 36.5918 112.06 36.5918 112.027 36.5918C89.7855 36.7504 75.3881 43.071 65.4975 55.1662C56.5816 66.1024 51.876 81.3753 51.5289 101.069C51.5282 101.086 51.5282 101.154 51.5289 101.171C51.876 120.865 56.5816 136.138 65.4975 147.074C75.3881 159.169 89.7855 165.49 112.027 165.648C112.06 165.648 112.093 165.648 112.127 165.648C129.474 165.515 140.937 160.785 149.572 151.101C160.524 138.862 160.164 122.841 155.012 112.304C151.463 105.032 145.532 99.0065 137.641 94.6984C137.641 94.6984 141.537 88.9883 141.537 88.9883ZM99.5088 123.642C90.3932 124.086 81.6568 118.779 81.107 112.217C80.6893 107.416 83.7068 98.7007 102.599 98.0482C104.886 97.9714 107.127 97.9339 109.329 97.9339C115.094 97.9339 120.556 98.4489 125.607 99.4338C123.672 117.508 112.088 123.023 99.5088 123.642Z"/>
                </svg>
                <div class="cn-card__status-dot ${isConnected ? 'cn-card__status-dot--on' : ''}"></div>
            </div>
            <div class="cn-card__body">
                <h3 class="cn-card__name">Threads</h3>
                <div class="cn-card__status">
                    ${!brand ? `<span class="cn-status cn-status--warn">Select a brand first</span>` :
                      isConnected ? `<span class="cn-status cn-status--success">Connected</span>${connectionInfo?.username ? `<span class="cn-status__handle">@${connectionInfo.username}</span>` : ''}` :
                      `<span class="cn-status">Not connected</span>`}
                </div>
                <div class="cn-card__meta">
                    <div class="cn-meta-row"><span>Max video</span><span>5min</span></div>
                    <div class="cn-meta-row"><span>Auth</span><span>Threads OAuth</span></div>
                </div>
            </div>
            <div class="cn-card__footer">
                ${isConnected ? `
                    <button class="cn-btn cn-btn--secondary" onclick="testThreadsConnection()">Test</button>
                    <button class="cn-btn cn-btn--danger" onclick="disconnectThreads()">Disconnect</button>
                ` : `
                    <button class="cn-btn cn-btn--primary" onclick="connectThreads()" ${!brand ? 'disabled' : ''}>Connect with Threads</button>
                `}
            </div>
            ${!THREADS_CONFIG.appId ? `<div class="cn-card__setup"><button class="cn-btn cn-btn--setup" onclick="openThreadsSetup()">⚙️ Setup API Keys</button></div>` : ''}
        </div>
    `;
}

function connectThreads() {
    const brand = brandManager.getActiveBrand();
    if (!brand) { Toast.error('Please select a brand first'); return; }
    if (!THREADS_CONFIG.appId) { openThreadsSetup(); return; }

    threadsService.init(THREADS_CONFIG.appId, THREADS_CONFIG.appSecret);
    threadsService.setBrand(brand.id);

    const csrfState = JSON.stringify({
        brandId: brand.id,
        platform: 'threads',
        nonce: Math.random().toString(36).substring(7)
    });

    const params = new URLSearchParams({
        client_id: THREADS_CONFIG.appId,
        redirect_uri: THREADS_CONFIG.redirectUri,
        scope: 'threads_basic,threads_content_publish',
        response_type: 'code',
        state: csrfState
    });

    window.location.href = `https://threads.net/oauth/authorize?${params.toString()}`;
}

async function completeThreadsAuth(code, brandId) {
    try {
        Toast.info('Completing Threads connection...');
        if (!THREADS_CONFIG.appId || !THREADS_CONFIG.appSecret) {
            throw new Error('Threads API credentials not configured. Use Setup button.');
        }

        threadsService.init(THREADS_CONFIG.appId, THREADS_CONFIG.appSecret);
        await threadsService.setBrand(brandId);

        const result = await threadsService.handleCallback(code, THREADS_CONFIG.redirectUri);

        const brand = brandManager.get(brandId);
        if (brand && !brand.hasPlatform('threads')) {
            brand.connectPlatform('threads');
            await brandManager.update(brandId, { connectedPlatforms: brand.connectedPlatforms });
        }

        Toast.success(`Threads connected: @${result.username || result.userId}`);
        loadPlatforms();
    } catch (error) {
        console.error('Threads auth error:', error);
        Toast.error(`Threads connection failed: ${error.message}`);
    }
}

async function disconnectThreads() {
    const brand = brandManager.getActiveBrand();
    if (!brand) { Toast.error('Please select a brand first'); return; }

    if (!confirm(`Disconnect Threads for ${brand.name}?`)) return;

    try {
        await threadsService.disconnect();
        if (brand.hasPlatform('threads')) {
            brand.disconnectPlatform('threads');
            await brandManager.update(brand.id, { connectedPlatforms: brand.connectedPlatforms });
        }
        Toast.success('Threads disconnected');
        loadPlatforms();
    } catch (error) {
        Toast.error(`Failed to disconnect: ${error.message}`);
    }
}

async function testThreadsConnection() {
    Toast.info('Testing Threads connection...');
    try {
        const result = await threadsService.testConnection();
        if (result.success) {
            Toast.success(`Threads working! Connected as @${result.username}`);
        } else {
            Toast.error(`Threads test failed: ${result.error}`);
        }
    } catch (error) {
        Toast.error(`Test failed: ${error.message}`);
    }
}

function openThreadsSetup() {
    const appId = prompt('Enter your Meta App ID (same as Instagram/Facebook):', THREADS_CONFIG.appId);
    if (appId === null) return;
    const appSecret = prompt('Enter your Meta App Secret:', THREADS_CONFIG.appSecret);
    if (appSecret === null) return;

    localStorage.setItem('threads_app_id', appId);
    localStorage.setItem('threads_app_secret', appSecret);
    THREADS_CONFIG.appId = appId;
    THREADS_CONFIG.appSecret = appSecret;
    Toast.success('Threads API credentials saved!');
    loadPlatforms();
}
