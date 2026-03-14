// Connections page — platform grid rendering + generic card
// Extracted from connections.html

async function loadPlatforms() {
    // Update brand contexts before loading
    updateYouTubeBrandContext();
    updateMetaBrandContext();
    await Promise.all([
        updateTikTokBrandContext(),
        updateThreadsBrandContext(),
        updateTwitterBrandContext(),
    ]);

    const container = document.getElementById('platforms-grid');
    const platforms = getAllPlatforms();
    const brand = brandManager.getActiveBrand();
    const accounts = accountManager.getAll();

    container.innerHTML = platforms.map(platform => {
        if (platform.id === 'youtube')   return renderYouTubeCard(platform, brand);
        if (platform.id === 'instagram') return renderInstagramCard(platform, brand);
        if (platform.id === 'facebook')  return renderFacebookCard(platform, brand);
        if (platform.id === 'tiktok')    return renderTikTokCard(platform, brand);
        if (platform.id === 'threads')   return renderThreadsCard(platform, brand);
        if (platform.id === 'twitter')   return renderTwitterCard(platform, brand);

        // Generic fallback card
        const account = brand ?
            accounts.find(a => a.platformId === platform.id && a.brandId === brand.id) :
            null;
        const isConnected = account?.isActive();

        return `
            <div class="cn-card ${isConnected ? 'cn-card--connected' : ''}">
                <div class="cn-card__header" style="--platform-color: ${platform.color}">
                    <span class="cn-card__icon">${platform.name.charAt(0)}</span>
                    <div class="cn-card__status-dot ${isConnected ? 'cn-card__status-dot--on' : ''}"></div>
                </div>
                <div class="cn-card__body">
                    <h3 class="cn-card__name">${platform.name}</h3>
                    <div class="cn-card__status">
                        ${isConnected ? `
                            <span class="cn-status cn-status--success">Connected</span>
                            ${account.handle ? `<span class="cn-status__handle">${account.handle}</span>` : ''}
                        ` : `
                            <span class="cn-status">Not connected</span>
                        `}
                    </div>
                    <div class="cn-card__meta">
                        <div class="cn-meta-row"><span>Max video</span><span>${platform.constraints.maxVideoDuration}s</span></div>
                        <div class="cn-meta-row"><span>Hashtags</span><span>${platform.constraints.maxHashtags}</span></div>
                    </div>
                </div>
                <div class="cn-card__footer">
                    ${isConnected ? `
                        <button class="cn-btn cn-btn--secondary" onclick="testConnection('${platform.id}')">Test</button>
                        <button class="cn-btn cn-btn--danger" onclick="disconnectPlatform('${platform.id}')">Disconnect</button>
                    ` : `
                        <button class="cn-btn cn-btn--primary" onclick="openConnectModal('${platform.id}')" ${!brand ? 'disabled title="Select a brand first"' : ''}>Connect</button>
                    `}
                </div>
            </div>
        `;
    }).join('');
}
