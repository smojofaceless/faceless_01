// Connections page — Generic connect modal + disconnect/test helpers
// Extracted from connections.html

function setupModal() {
    const modal = document.getElementById('connect-modal');
    if (!modal) return;

    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }

    const closeBtn = modal.querySelector('.modal__close');
    const cancelBtn = document.getElementById('modal-cancel');
    const connectBtn = document.getElementById('modal-connect');
    const overlay = modal.querySelector('.modal__overlay');

    [closeBtn, cancelBtn, overlay].forEach(el => {
        if (el) el.addEventListener('click', closeModal);
    });

    if (connectBtn) connectBtn.addEventListener('click', connectPlatform);
}

function openConnectModal(platformId) {
    if (platformId === 'youtube') { connectYouTube(); return; }

    const platform = getPlatform(platformId);
    if (!platform) return;

    selectedPlatform = platform;
    document.getElementById('platform-name').textContent = platform.name;
    document.getElementById('platform-name-2').textContent = platform.name;
    document.getElementById('connect-form').reset();
    document.getElementById('connect-modal').classList.add('active');
}

function closeModal() {
    document.getElementById('connect-modal').classList.remove('active');
    selectedPlatform = null;
}

function connectPlatform() {
    if (!selectedPlatform) return;

    const brand = brandManager.getActiveBrand();
    if (!brand) { Toast.error('Please select a brand first'); return; }

    const handle = document.getElementById('connect-handle').value.trim();
    const apiKey = document.getElementById('connect-api-key').value.trim();
    const apiSecret = document.getElementById('connect-api-secret').value.trim();
    const accessToken = document.getElementById('connect-access-token').value.trim();

    if (!apiKey) { Toast.error('API Key is required'); return; }

    const account = new PlatformAccount({
        platformId: selectedPlatform.id,
        brandId: brand.id,
        handle: handle,
        credentials: { apiKey, apiSecret, accessToken },
        accessToken: accessToken,
        tokenExpiry: accessToken ? new Date(Date.now() + 3600000) : null
    });

    accountManager.add(account);
    brand.connectPlatform(selectedPlatform.id, { accountId: account.id });
    brandManager.save();

    closeModal();
    loadPlatforms();
    Toast.success(`${selectedPlatform.name} connected!`);
}

function disconnectPlatform(platformId) {
    if (platformId === 'youtube') { disconnectYouTube(); return; }

    const brand = brandManager.getActiveBrand();
    if (!brand) return;

    if (confirm(`Disconnect ${getPlatform(platformId)?.name}? You'll need to reconnect to post again.`)) {
        const account = accountManager.getAll().find(a =>
            a.platformId === platformId && a.brandId === brand.id
        );
        if (account) accountManager.remove(account.id);

        brand.disconnectPlatform(platformId);
        brandManager.save();

        loadPlatforms();
        Toast.success('Platform disconnected');
    }
}

async function testConnection(platformId) {
    if (platformId === 'youtube') { testYouTubeConnection(); return; }

    const brand = brandManager.getActiveBrand();
    const account = accountManager.getAll().find(a =>
        a.platformId === platformId && a.brandId === brand?.id
    );

    if (!account) { Toast.error('No account found'); return; }

    Toast.info('Testing connection...');
    try {
        const api = PlatformAPIFactory.getAPI(platformId);
        const result = await api.testConnection(account);
        if (result.success) {
            Toast.success('Connection working!');
        } else {
            Toast.error(result.error || 'Connection failed');
        }
    } catch (error) {
        Toast.error(`Test failed: ${error.message}`);
    }
}
