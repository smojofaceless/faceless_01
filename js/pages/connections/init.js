// Connections page — bootstrap and initialization
// Extracted from connections.html

document.addEventListener('DOMContentLoaded', () => {
    const sidebar = new Sidebar();

    const brandSwitcher = new BrandSwitcher({
        onSelect: () => {
            updateBrandHeader();
            loadPlatforms();
        }
    });
    brandSwitcher.init();

    // Re-render when brands finish loading from Supabase
    brandManager.on('brands:loaded', () => {
        updateBrandHeader();
        loadPlatforms();
    });

    window.addEventListener('contentengine:ready', init);
    if (typeof contentEngine !== 'undefined' && contentEngine.initialized) {
        init();
    }
});

async function init() {
    updateBrandHeader();

    // Initialize services (synchronous)
    if (YOUTUBE_CONFIG.clientId) youtubeService.init(YOUTUBE_CONFIG.clientId);
    if (META_CONFIG.appId) metaService.init(META_CONFIG.appId, META_CONFIG.appSecret);
    if (TIKTOK_CONFIG.clientKey) tiktokService.init(TIKTOK_CONFIG.clientKey, TIKTOK_CONFIG.clientSecret);
    if (THREADS_CONFIG.appId) threadsService.init(THREADS_CONFIG.appId, THREADS_CONFIG.appSecret);
    if (TWITTER_CONFIG.clientId) twitterService.init(TWITTER_CONFIG.clientId);

    // Set brand context (some are async)
    await Promise.all([
        updateTikTokBrandContext(),
        updateThreadsBrandContext(),
        updateTwitterBrandContext(),
    ]);
    updateYouTubeBrandContext();
    updateMetaBrandContext();

    // Render — all services have loaded their tokens
    loadPlatforms();
    setupModal();

    // Handle OAuth callbacks (must run after init)
    handleOAuthCallback();

    // Auto-sync Meta tokens to Supabase
    setTimeout(() => syncMetaTokensToSupabase(), 2000);
}
