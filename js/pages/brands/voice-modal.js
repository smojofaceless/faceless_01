// Voice & narration config modal
// Extracted from brands.html inline script

let voiceBrandId = null;
let voicePresetType = null;

async function openVoiceModal(brandId) {
    voiceBrandId = brandId;
    document.getElementById('voice-modal').classList.add('active');

    // Build preset tabs
    const defaultType = await buildPresetTabBar('voice-preset-tabs', brandId, async (templateType) => {
        voicePresetType = templateType;
        await loadVoiceForPreset(brandId, templateType);
    });
    voicePresetType = defaultType;
    await loadVoiceForPreset(brandId, defaultType);

    // Bind events (clone to remove old listeners)
    bindVoiceEvents();
}

async function loadVoiceForPreset(brandId, templateType) {
    try {
        const cfg = await brandManager.getPresetConfigSection(brandId, templateType, 'voice');
        populateVoiceForm(cfg);
    } catch (e) {
        console.error('Failed to load voice config:', e);
        populateVoiceForm(null);
    }
}

function closeVoiceModal() {
    document.getElementById('voice-modal').classList.remove('active');
    voiceBrandId = null;
    voicePresetType = null;
}

function populateVoiceForm(cfg) {
    document.getElementById('voice-select').value = cfg?.voice || '';
    document.getElementById('voice-instructions').value = cfg?.instructions || '';
    const speed = cfg?.speed ?? 1.0;
    document.getElementById('voice-speed').value = speed;
    document.getElementById('voice-speed-value').textContent = speed.toFixed(2) + '×';
    updateVoicePreview(cfg);
}

function updateVoicePreview(cfg) {
    const statusEl = document.getElementById('voice-current-status');
    if (!cfg || (!cfg.voice && !cfg.instructions)) {
        statusEl.textContent = 'Using preset defaults (auto per vibe)';
        statusEl.className = 'voice-preview__status voice-preview__status--default';
    } else {
        const parts = [];
        if (cfg.voice) parts.push('Voice: ' + cfg.voice);
        if (cfg.instructions) parts.push('Custom instructions set');
        if (cfg.speed && cfg.speed !== 1.0) parts.push('Speed: ' + cfg.speed + '×');
        statusEl.textContent = parts.join(' · ');
        statusEl.className = 'voice-preview__status voice-preview__status--custom';
    }
}

function bindVoiceEvents() {
    const speedSlider = document.getElementById('voice-speed');
    speedSlider.oninput = () => {
        document.getElementById('voice-speed-value').textContent = parseFloat(speedSlider.value).toFixed(2) + '×';
    };

    const saveBtn = document.getElementById('voice-save-btn');
    const clone = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(clone, saveBtn);
    clone.addEventListener('click', saveVoiceConfig);

    const resetBtn = document.getElementById('voice-reset-btn');
    const resetClone = resetBtn.cloneNode(true);
    resetBtn.parentNode.replaceChild(resetClone, resetBtn);
    resetClone.addEventListener('click', async () => {
        try {
            await brandManager.savePresetConfigSection(voiceBrandId, voicePresetType, 'voice', null);
            toast.success('Voice config reset for ' + voicePresetType);
            closeVoiceModal();
        } catch (e) {
            toast.error('Failed to reset: ' + e.message);
        }
    });
}

async function saveVoiceConfig() {
    if (!voiceBrandId) return;
    const voice = document.getElementById('voice-select').value || null;
    const instructions = document.getElementById('voice-instructions').value.trim() || null;
    const speed = parseFloat(document.getElementById('voice-speed').value);

    const cfg = {};
    if (voice) cfg.voice = voice;
    if (instructions) cfg.instructions = instructions;
    if (speed !== 1.0) cfg.speed = speed;

    const finalCfg = Object.keys(cfg).length > 0 ? cfg : null;
    const btn = document.getElementById('voice-save-btn');
    try {
        if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
        await brandManager.savePresetConfigSection(voiceBrandId, voicePresetType, 'voice', finalCfg);
        toast.success('Voice saved for ' + voicePresetType);
        closeVoiceModal();
    } catch (e) {
        toast.error('Failed to save: ' + e.message);
        console.error(e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Voice Config'; }
    }
}

// =====================================================
// VIDEO OVERLAY MODAL
// =====================================================

