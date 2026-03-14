// Vibe presets modal — catalog, weights, distribution
// Extracted from brands.html inline script

let vibesBrandId = null;
let vibesPresets = [];  // current brand_templates rows
let vibesModifiedWeights = {};  // { presetId: newWeight }

// Catalog of all known presets
const VIBE_PRESET_CATALOG = {
    urban_legend: {
        id: 'urban_legend',
        name: 'Urban Legend',
        icon: '📜',
        tagline: 'Documentary folklore — VHS degraded, sickly green, micro jitter',
        color: '#22c55e'
    },
    one_too_many: {
        id: 'one_too_many',
        name: 'One Too Many',
        icon: '👥',
        tagline: 'Counting horror — cold blue, static tension, uncanny illustrated',
        color: '#6366f1'
    },
    dark_origins: {
        id: 'dark_origins',
        name: 'Dark Origins',
        icon: '🕯️',
        tagline: 'Documentary dark biographies — chiaroscuro, film grain, period settings',
        color: '#d97706'
    }
};

async function openVibePresetsModal(brandId) {
    vibesBrandId = brandId;
    vibesModifiedWeights = {};

    const modal = document.getElementById('vibes-modal');
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Setup save button
    const saveBtn = document.getElementById('vibes-save-btn');
    const saveClone = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(saveClone, saveBtn);
    saveClone.addEventListener('click', saveVibePresetWeights);

    await loadVibePresets();
}

function closeVibePresetsModal() {
    const modal = document.getElementById('vibes-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
    vibesBrandId = null;
    vibesPresets = [];
    vibesModifiedWeights = {};
}

async function loadVibePresets() {
    const listEl = document.getElementById('vibe-active-list');
    const catalogEl = document.getElementById('vibe-catalog');
    const statusEl = document.getElementById('vibes-status');

    listEl.innerHTML = '<div class="vibe-loading">Loading...</div>';

    try {
        vibesPresets = await brandManager.getVibePresets(vibesBrandId);
        renderVibesCatalog(catalogEl);
        renderVibesActiveList(listEl);
        renderVibesDistribution();

        statusEl.textContent = vibesPresets.length > 0
            ? `${vibesPresets.length} preset(s) configured`
            : 'No presets — campaigns will use system defaults';
    } catch (e) {
        listEl.innerHTML = '<div class="vibe-loading" style="color:var(--color-error)">Failed to load presets</div>';
        statusEl.textContent = 'Error: ' + e.message;
        console.error(e);
    }
}

function renderVibesCatalog(container) {
    const existingTypes = new Set(vibesPresets.map(p => p.template_type));

    container.innerHTML = Object.values(VIBE_PRESET_CATALOG).map(preset => {
        const exists = existingTypes.has(preset.id);
        return `
            <div class="vibe-catalog-item ${exists ? 'vibe-catalog-item--added' : ''}">
                <div class="vibe-catalog-item__info">
                    <span class="vibe-catalog-item__icon">${preset.icon}</span>
                    <div>
                        <div class="vibe-catalog-item__name">${preset.name}</div>
                        <div class="vibe-catalog-item__tagline">${preset.tagline}</div>
                    </div>
                </div>
                ${exists
                    ? '<span class="vibe-catalog-item__status">Added</span>'
                    : `<button class="btn btn--sm btn--primary" onclick="addVibePreset('${preset.id}', '${preset.name}')">+ Add</button>`
                }
            </div>
        `;
    }).join('');
}

function renderVibesActiveList(container) {
    if (vibesPresets.length === 0) {
        container.innerHTML = `
            <div class="vibe-empty">
                <p>No vibe presets configured for this brand.</p>
                <p style="font-size:12px;color:var(--text-secondary)">Add presets from the catalog above. Campaigns will use system defaults (Urban Legend 60%, One Too Many 40%) until configured.</p>
            </div>
        `;
        return;
    }

    // Calculate total weight for percentage display
    const totalWeight = vibesPresets.reduce((sum, p) => {
        const w = vibesModifiedWeights[p.id] !== undefined ? vibesModifiedWeights[p.id] : parseFloat(p.weight);
        return sum + w;
    }, 0);

    container.innerHTML = vibesPresets.map(preset => {
        const weight = vibesModifiedWeights[preset.id] !== undefined
            ? vibesModifiedWeights[preset.id]
            : parseFloat(preset.weight);
        const pct = totalWeight > 0 ? Math.round((weight / totalWeight) * 100) : 0;
        const catalogInfo = VIBE_PRESET_CATALOG[preset.template_type];
        const icon = catalogInfo?.icon || '🎭';
        const color = catalogInfo?.color || '#6B7280';

        return `
            <div class="vibe-active-item" data-id="${preset.id}">
                <div class="vibe-active-item__header">
                    <div class="vibe-active-item__info">
                        <span class="vibe-active-item__icon" style="color:${color}">${icon}</span>
                        <span class="vibe-active-item__name">${escapeHtml(preset.name)}</span>
                        ${preset.is_default ? '<span class="vibe-active-item__badge">Default</span>' : ''}
                    </div>
                    <div class="vibe-active-item__controls">
                        <span class="vibe-active-item__pct" id="vibe-pct-${preset.id}">${pct}%</span>
                        <button class="btn btn--icon btn--xs vibe-remove-btn" onclick="removeVibePreset('${preset.id}', '${escapeHtml(preset.name)}')" title="Remove preset">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="vibe-active-item__slider-row">
                    <input type="range" class="vibe-weight-slider" data-id="${preset.id}"
                        min="1" max="100" step="1" value="${Math.round(weight)}"
                        style="--slider-color: ${color}">
                    <span class="vibe-active-item__weight-val" id="vibe-val-${preset.id}">${Math.round(weight)}</span>
                </div>
            </div>
        `;
    }).join('');

    // Attach slider listeners
    container.querySelectorAll('.vibe-weight-slider').forEach(slider => {
        slider.addEventListener('input', (e) => {
            const presetId = e.target.dataset.id;
            const rawVal = parseInt(e.target.value);
            vibesModifiedWeights[presetId] = rawVal;

            // Update value display
            const valEl = document.getElementById(`vibe-val-${presetId}`);
            if (valEl) valEl.textContent = rawVal;

            // Update all percentages
            updateVibePercentages();
            renderVibesDistribution();
        });
    });
}

function updateVibePercentages() {
    const totalWeight = vibesPresets.reduce((sum, p) => {
        const w = vibesModifiedWeights[p.id] !== undefined ? vibesModifiedWeights[p.id] : parseFloat(p.weight);
        return sum + w;
    }, 0);

    vibesPresets.forEach(p => {
        const w = vibesModifiedWeights[p.id] !== undefined ? vibesModifiedWeights[p.id] : parseFloat(p.weight);
        const pct = totalWeight > 0 ? Math.round((w / totalWeight) * 100) : 0;
        const pctEl = document.getElementById(`vibe-pct-${p.id}`);
        if (pctEl) pctEl.textContent = `${pct}%`;
    });
}

function renderVibesDistribution() {
    const distEl = document.getElementById('vibe-distribution');
    if (vibesPresets.length === 0) {
        distEl.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:12px;padding:8px">No presets to visualize</div>';
        return;
    }

    const totalWeight = vibesPresets.reduce((sum, p) => {
        const w = vibesModifiedWeights[p.id] !== undefined ? vibesModifiedWeights[p.id] : parseFloat(p.weight);
        return sum + w;
    }, 0);

    if (totalWeight === 0) {
        distEl.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:12px;padding:8px">All weights are zero</div>';
        return;
    }

    const bars = vibesPresets.map(p => {
        const w = vibesModifiedWeights[p.id] !== undefined ? vibesModifiedWeights[p.id] : parseFloat(p.weight);
        const pct = Math.round((w / totalWeight) * 100);
        const catalogInfo = VIBE_PRESET_CATALOG[p.template_type];
        const color = catalogInfo?.color || '#6B7280';
        const icon = catalogInfo?.icon || '🎭';
        return `<div class="vibe-dist-bar" style="width:${Math.max(pct, 2)}%;background:${color}" title="${p.name}: ${pct}%">
            <span class="vibe-dist-bar__label">${icon} ${pct}%</span>
        </div>`;
    }).join('');

    distEl.innerHTML = `<div class="vibe-dist-track">${bars}</div>`;
}

async function addVibePreset(templateType, name) {
    if (!vibesBrandId) return;
    const statusEl = document.getElementById('vibes-status');

    try {
        statusEl.textContent = `Adding ${name}...`;
        const isFirst = vibesPresets.length === 0;
        // Default weight: 50 (integer scale, used for weighted-random selection)
        await brandManager.addVibePreset(vibesBrandId, templateType, name, 50, isFirst);
        toast.success(`Added ${name} preset`);
        vibesModifiedWeights = {}; // reset local changes
        await loadVibePresets();
    } catch (e) {
        toast.error(`Failed to add preset: ${e.message}`);
        statusEl.textContent = 'Error: ' + e.message;
        console.error(e);
    }
}

async function removeVibePreset(presetId, presetName) {
    if (!confirm(`Remove "${presetName}" from this brand?`)) return;
    const statusEl = document.getElementById('vibes-status');

    try {
        statusEl.textContent = `Removing ${presetName}...`;
        await brandManager.removeVibePreset(presetId);
        delete vibesModifiedWeights[presetId];
        toast.success(`Removed ${presetName}`);
        await loadVibePresets();
    } catch (e) {
        toast.error(`Failed to remove: ${e.message}`);
        statusEl.textContent = 'Error: ' + e.message;
    }
}

async function saveVibePresetWeights() {
    if (!vibesBrandId || vibesPresets.length === 0) {
        closeVibePresetsModal();
        return;
    }

    const btn = document.getElementById('vibes-save-btn') || document.querySelector('#vibes-modal .btn--primary');
    const statusEl = document.getElementById('vibes-status');

    try {
        if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

        const updates = vibesPresets.map(p => ({
            id: p.id,
            weight: vibesModifiedWeights[p.id] !== undefined ? vibesModifiedWeights[p.id] : parseFloat(p.weight)
        }));

        await brandManager.updateVibePresetWeights(vibesBrandId, updates);
        toast.success('Preset weights saved');
        closeVibePresetsModal();
        // Refresh brand cards to reflect changes
        loadBrands();
    } catch (e) {
        toast.error('Failed to save weights: ' + e.message);
        statusEl.textContent = 'Error: ' + e.message;
        console.error(e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Weights'; }
    }
}

