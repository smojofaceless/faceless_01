// Shared preset tab bar builder
// Extracted from brands.html inline script

async function buildPresetTabBar(containerId, brandId, onSelect) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    const presets = await brandManager.getVibePresets(brandId);
    container.innerHTML = '<span class="preset-tab-bar__label">Preset:</span>';
    let defaultType = null;
    (presets || []).forEach(p => {
        const tab = document.createElement('button');
        const isGameplay = p.config_overrides?.visual_type === 'gameplay';
        tab.className = 'preset-tab' + (p.is_default ? ' preset-tab--active' : '');
        tab.dataset.type = p.template_type;
        tab.innerHTML = (p.is_default ? '<span class="preset-tab__star">★</span> ' : '') 
            + escapeHtml(p.name) 
            + (isGameplay ? ' <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(34,197,94,0.2);color:#34d399;font-weight:700;margin-left:4px;">🎮</span>' : '');
        tab.addEventListener('click', () => {
            container.querySelectorAll('.preset-tab').forEach(t => t.classList.remove('preset-tab--active'));
            tab.classList.add('preset-tab--active');
            onSelect(p.template_type);
        });
        container.appendChild(tab);
        if (p.is_default) defaultType = p.template_type;
    });
    if (!defaultType && presets?.length) defaultType = presets[0].template_type;
    return defaultType;
}

function getActivePresetType(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    const active = container.querySelector('.preset-tab--active');
    return active?.dataset?.type || null;
}

// =====================================================
// EFFECTS CONFIG MODAL (per-preset)
// =====================================================

