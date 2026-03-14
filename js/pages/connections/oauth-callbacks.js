// Connections page — OAuth callback router
// Dispatches to platform-specific auth completion handlers

function handleOAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    if (!code || !state) return;

    // YouTube uses a prefixed state string
    if (state.startsWith('youtube_auth:')) {
        const brandId = youtubeService.parseOAuthState(state);
        console.log('YouTube OAuth callback received for brand:', brandId);
        completeYouTubeAuth(code, brandId);
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
    }

    // TikTok, Threads, Twitter, Meta use JSON state (possibly base64-encoded)
    let stateData = null;
    try {
        stateData = JSON.parse(state);
    } catch (_) {
        try {
            stateData = JSON.parse(atob(state));
            console.log('🔑 Decoded base64 state:', stateData);
        } catch (_2) {
            console.warn('⚠️ Could not parse OAuth state:', state);
        }
    }

    if (!stateData || !stateData.brandId) return;

    console.log('🔑 OAuth callback — platform:', stateData.platform, 'brand:', stateData.brandId);

    const handlers = {
        tiktok:  () => completeTikTokAuth(code, stateData.brandId),
        threads: () => completeThreadsAuth(code, stateData.brandId),
        twitter: () => completeTwitterAuth(code, stateData.brandId)
    };

    const handler = handlers[stateData.platform];
    if (handler) {
        handler();
    } else {
        // Default to Meta
        completeMetaAuth(code, stateData.brandId);
    }

    window.history.replaceState({}, document.title, window.location.pathname);
}
