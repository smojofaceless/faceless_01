// =====================================================
// DASHBOARD - Platform Status
// =====================================================

async function dbLoadPlatforms() {
    const container = document.getElementById('platform-status');
    if (!container) return;

    try {
        const { data: tokens, error } = await dbSupabase
            .from('platform_tokens')
            .select('platform, is_valid, platform_channel_name')
            .order('platform');

        if (error) throw error;

        const platforms = [
            { id: 'youtube', name: 'YouTube', icon: 'Y', color: '#FF4444' },
            { id: 'instagram', name: 'Instagram', icon: 'I', color: '#E1306C' },
            { id: 'facebook', name: 'Facebook', icon: 'F', color: '#1877F2' },
            { id: 'tiktok', name: 'TikTok', icon: 'T', color: '#00f2ea' },
            { id: 'threads', name: 'Threads', icon: 'Th', color: '#a0a0b8' },
            { id: 'x', name: 'X', icon: 'X', color: '#a0a0b8' }
        ];

        const tokenMap = {};
        if (tokens) tokens.forEach(t => tokenMap[t.platform] = t);

        container.innerHTML = `<div class="db-platforms">${platforms.map(p => {
            const tok = tokenMap[p.id];
            const connected = tok?.is_valid === true;
            const channel = tok?.platform_channel_name || '';
            return `
                <div class="db-platform ${connected ? 'db-platform--on' : ''}">
                    <div class="db-platform__icon" style="--plat-color: ${p.color}">${p.icon}</div>
                    <div class="db-platform__info">
                        <span class="db-platform__name">${p.name}</span>
                        ${channel ? `<span class="db-platform__channel">${escapeHtml(channel)}</span>` : ''}
                    </div>
                    <span class="db-platform__dot ${connected ? 'db-platform__dot--on' : ''}"></span>
                </div>`;
        }).join('')}</div>`;
    } catch (e) {
        console.error('dbLoadPlatforms:', e);
        container.innerHTML = '<div class="db-empty"><span>Failed to load</span></div>';
    }
}
