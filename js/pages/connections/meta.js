// Connections page — Meta (Instagram + Facebook) cards, connect, disconnect, test
// Extracted from connections.html

function renderInstagramCard(platform, brand) {
    const isConnected = brand ? metaService.isInstagramConnected() : false;
    const connectionInfo = brand ? metaService.getConnectionInfo() : null;

    return `
        <div class="cn-card ${isConnected ? 'cn-card--connected' : ''}">
            <div class="cn-card__header" style="--platform-color: #E4405F; background: linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)">
                <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                </svg>
                <div class="cn-card__status-dot ${isConnected ? 'cn-card__status-dot--on' : ''}"></div>
            </div>
            <div class="cn-card__body">
                <h3 class="cn-card__name">${platform.name}</h3>
                <div class="cn-card__status">
                    ${!brand ? `<span class="cn-status cn-status--warn">Select a brand first</span>` :
                      isConnected ? `<span class="cn-status cn-status--success">Connected</span>${connectionInfo?.instagram?.username ? `<span class="cn-status__handle">@${connectionInfo.instagram.username}</span>` : ''}` :
                      `<span class="cn-status">Not connected</span>`}
                </div>
                <div class="cn-card__meta">
                    <div class="cn-meta-row"><span>Max video</span><span>90s (Reels)</span></div>
                    <div class="cn-meta-row"><span>Auth</span><span>Meta OAuth</span></div>
                </div>
            </div>
            <div class="cn-card__footer">
                ${isConnected ? `
                    <button class="cn-btn cn-btn--secondary" onclick="testMetaConnection('instagram')">Test</button>
                    <button class="cn-btn cn-btn--danger" onclick="disconnectMeta()">Disconnect</button>
                ` : `
                    <button class="cn-btn cn-btn--primary" onclick="connectMeta()" ${!brand ? 'disabled' : ''}>Connect with Facebook</button>
                `}
            </div>
            ${!META_CONFIG.appId ? `<div class="cn-card__setup"><button class="cn-btn cn-btn--setup" onclick="openMetaSetup()">⚙️ Setup API Keys</button></div>` : ''}
        </div>
    `;
}

function renderFacebookCard(platform, brand) {
    const isConnected = brand ? metaService.isFacebookConnected() : false;
    const connectionInfo = brand ? metaService.getConnectionInfo() : null;

    return `
        <div class="cn-card ${isConnected ? 'cn-card--connected' : ''}">
            <div class="cn-card__header" style="--platform-color: #1877F2">
                <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>
                <div class="cn-card__status-dot ${isConnected ? 'cn-card__status-dot--on' : ''}"></div>
            </div>
            <div class="cn-card__body">
                <h3 class="cn-card__name">${platform.name}</h3>
                <div class="cn-card__status">
                    ${!brand ? `<span class="cn-status cn-status--warn">Select a brand first</span>` :
                      isConnected ? `<span class="cn-status cn-status--success">Connected</span>${connectionInfo?.facebook?.pageName ? `<span class="cn-status__handle">${connectionInfo.facebook.pageName}</span>` : ''}` :
                      `<span class="cn-status">Not connected</span>`}
                </div>
                <div class="cn-card__meta">
                    <div class="cn-meta-row"><span>Max video</span><span>90s (Reels)</span></div>
                    <div class="cn-meta-row"><span>Auth</span><span>Meta OAuth</span></div>
                </div>
            </div>
            <div class="cn-card__footer">
                ${isConnected ? `
                    <button class="cn-btn cn-btn--secondary" onclick="testMetaConnection('facebook')">Test</button>
                    <button class="cn-btn cn-btn--danger" onclick="disconnectMeta()">Disconnect</button>
                ` : `
                    <button class="cn-btn cn-btn--primary" onclick="connectMeta()" ${!brand ? 'disabled' : ''}>Connect with Facebook</button>
                `}
            </div>
            ${!META_CONFIG.appId ? `<div class="cn-card__setup"><button class="cn-btn cn-btn--setup" onclick="openMetaSetup()">⚙️ Setup API Keys</button></div>` : ''}
        </div>
    `;
}

function connectMeta() {
    const brand = brandManager.getActiveBrand();
    if (!brand) { Toast.error('Please select a brand first'); return; }
    if (!META_CONFIG.appId) { openMetaSetup(); return; }

    metaService.init(META_CONFIG.appId, META_CONFIG.appSecret);
    metaService.setBrand(brand.id);
    const authUrl = metaService.getAuthUrl(META_CONFIG.redirectUri);
    window.location.href = authUrl;
}

async function disconnectMeta() {
    const brand = brandManager.getActiveBrand();
    if (!brand) { Toast.error('Please select a brand first'); return; }

    if (confirm(`Disconnect Instagram & Facebook from "${brand.name}"?`)) {
        await metaService.disconnect();
        brand.disconnectPlatform('instagram');
        brand.disconnectPlatform('facebook');
        await brandManager.update(brand.id, { connectedPlatforms: brand.connectedPlatforms });
        loadPlatforms();
        Toast.success('Meta platforms disconnected');
    }
}

async function testMetaConnection(platform) {
    Toast.info(`Testing ${platform} connection...`);
    try {
        const connectionInfo = metaService.getConnectionInfo();
        if (platform === 'instagram' && connectionInfo?.instagram) {
            Toast.success(`Instagram connected: @${connectionInfo.instagram.username}`);
        } else if (platform === 'facebook' && connectionInfo?.facebook) {
            Toast.success(`Facebook Page connected: ${connectionInfo.facebook.pageName}`);
        } else {
            Toast.warning('Connection status unknown');
        }
        await syncMetaTokensToSupabase();
    } catch (error) {
        Toast.error(`Test failed: ${error.message}`);
    }
}

async function syncMetaTokensToSupabase() {
    try {
        if (!metaService.isConnected()) return;
        await metaService.saveTokensToSupabase();
        console.log('📸 Meta tokens synced to Supabase');
    } catch (e) {
        console.warn('📸 Meta token sync failed:', e.message);
    }
}

function openMetaSetup() {
    const appId = prompt('Enter your Meta App ID:', META_CONFIG.appId);
    if (appId === null) return;
    const appSecret = prompt('Enter your Meta App Secret:', META_CONFIG.appSecret);
    if (appSecret === null) return;

    localStorage.setItem('meta_app_id', appId);
    localStorage.setItem('meta_app_secret', appSecret);
    META_CONFIG.appId = appId;
    META_CONFIG.appSecret = appSecret;
    Toast.success('Meta API credentials saved!');
    loadPlatforms();
}

async function completeMetaAuth(code, brandId) {
    try {
        Toast.info('Completing Meta connection...');
        if (!META_CONFIG.appId || !META_CONFIG.appSecret) {
            throw new Error('Meta API credentials not configured');
        }
        metaService.init(META_CONFIG.appId, META_CONFIG.appSecret);
        await metaService.setBrand(brandId);

        const result = await metaService.handleCallback(code, META_CONFIG.redirectUri);

        if (result.needsPageSelection && result.pages.length > 0) {
            openMetaPageSelector(result.pages, brandId);
        } else if (result.pages.length === 0) {
            Toast.warning('Connected but no Facebook Pages found.');
        } else {
            await metaService.selectPage(result.pages[0].id);
            finalizeMetaConnection(brandId, result.pages[0]);
        }
    } catch (error) {
        console.error('Meta auth error:', error);
        Toast.error(`Meta connection failed: ${error.message}`);
    }
}

function openMetaPageSelector(pages, brandId) {
    let modal = document.getElementById('meta-page-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'meta-page-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal__overlay"></div>
            <div class="modal__content">
                <div class="modal__header">
                    <h3 class="modal__title">Select Facebook Page</h3>
                    <button class="modal__close">&times;</button>
                </div>
                <div class="modal__body">
                    <p style="margin-bottom:16px;color:var(--text-secondary)">Choose which Facebook Page to connect. The linked Instagram account will also be connected.</p>
                    <div id="meta-page-list" class="cn-page-list"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('.modal__close').addEventListener('click', () => modal.classList.remove('active'));
        modal.querySelector('.modal__overlay').addEventListener('click', () => modal.classList.remove('active'));
    }

    const pageList = modal.querySelector('#meta-page-list');
    pageList.innerHTML = pages.map(page => `
        <div class="cn-page-option" onclick="selectMetaPage('${page.id}', '${brandId}')">
            <div class="cn-page-option__info">
                <strong>${page.name}</strong>
                ${page.instagram ? `<span class="cn-page-option__sub">Instagram: @${page.instagram.username}</span>` :
                  `<span class="cn-page-option__sub cn-page-option__sub--warn">No Instagram account linked</span>`}
            </div>
            <button class="cn-btn cn-btn--primary cn-btn--sm">Select</button>
        </div>
    `).join('');

    modal.classList.add('active');
}

async function selectMetaPage(pageId, brandId) {
    try {
        const result = await metaService.selectPage(pageId);
        document.getElementById('meta-page-modal').classList.remove('active');
        finalizeMetaConnection(brandId, result);
    } catch (error) {
        Toast.error(`Failed to select page: ${error.message}`);
    }
}

async function finalizeMetaConnection(brandId, connectionInfo) {
    const brand = brandManager.get(brandId);
    console.log('📸 Finalizing Meta connection:', connectionInfo);

    if (connectionInfo.instagram && connectionInfo.instagram.accountId) {
        if (!brand.hasPlatform('instagram')) brand.connectPlatform('instagram');
        Toast.success(`Instagram connected: @${connectionInfo.instagram.username || connectionInfo.instagram.accountId}`);
    } else {
        Toast.warning('No Instagram Business account linked to this Facebook Page.');
    }

    if (connectionInfo.facebook && connectionInfo.facebook.pageId) {
        if (!brand.hasPlatform('facebook')) brand.connectPlatform('facebook');
        Toast.success(`Facebook Page connected: ${connectionInfo.facebook.pageName || connectionInfo.facebook.pageId}`);
    }

    await brandManager.update(brandId, { connectedPlatforms: brand.connectedPlatforms });
    await metaService.setBrand(brandId);
    loadPlatforms();
}
