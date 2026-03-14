// Settings hub modal — tile grid navigation
// Extracted from brands.html inline script

let settingsHubBrandId = null;

function openSettingsHub(brandId) {
    settingsHubBrandId = brandId;
    const brand = brandManager.get(brandId);
    document.getElementById('settings-hub-brand-name').textContent = brand?.name || 'Brand Settings';
    const modal = document.getElementById('settings-hub-modal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeSettingsHub() {
    document.getElementById('settings-hub-modal').classList.remove('active');
    document.body.style.overflow = '';
    settingsHubBrandId = null;
}

// Hub tile click → open corresponding config modal
document.getElementById('settings-hub-modal').addEventListener('click', (e) => {
    const tile = e.target.closest('.settings-hub__tile');
    if (!tile || !settingsHubBrandId) return;
    const action = tile.dataset.action;
    const brandId = settingsHubBrandId;
    closeSettingsHub();
    switch (action) {
        case 'images':    openImagePromptModal(brandId); break;
        case 'effects':   openEffectsModal(brandId); break;
        case 'subtitles': openSubtitleModal(brandId); break;
        case 'voice':     openVoiceModal(brandId); break;
        case 'music':     openMusicModal(brandId); break;
        case 'gameplay':  openGameplayModal(brandId); break;
        case 'schedule':  openScheduleModal(brandId); break;
        case 'presets':   openVibePresetsModal(brandId); break;
        case 'overlay':   openOverlayModal(brandId); break;
    }
});

// Navigate back to Settings Hub from any config modal
function backToHub(from) {
    let brandId;
    switch (from) {
        case 'music':     brandId = musicBrandId; closeMusicModal(); break;
        case 'gameplay':  brandId = gameplayBrandId; closeGameplayModal(); break;
        case 'effects':   brandId = effectsBrandId; closeEffectsModal(); break;
        case 'subtitles': brandId = subtitleBrandId; closeSubtitleModal(); break;
        case 'images':    brandId = ipBrandId; closeImagePromptModal(); break;
        case 'voice':     brandId = voiceBrandId; closeVoiceModal(); break;
        case 'schedule':  brandId = scheduleBrandId; closeScheduleModal(); break;
        case 'presets':   brandId = vibesBrandId; closeVibePresetsModal(); break;
        case 'overlay':   brandId = overlayBrandId; closeOverlayModal(); break;
    }
    if (brandId) openSettingsHub(brandId);
}


// =====================================================
// VIBE PRESETS MODAL
// =====================================================

