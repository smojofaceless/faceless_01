// Effects config modal — Ken Burns, grain, flicker, vignette, etc.
// Extracted from brands.html inline script

let effectsBrandId = null;
let effectsOriginal = null; // snapshot for dirty-check
let effectsPresetType = null;

async function openEffectsModal(brandId) {
    effectsBrandId = brandId;
    document.getElementById('effects-modal').classList.add('active');
    document.getElementById('fx-status').textContent = 'Loading presets...';

    // Build preset tabs
    const defaultType = await buildPresetTabBar('fx-preset-tabs', brandId, async (templateType) => {
        effectsPresetType = templateType;
        await loadEffectsForPreset(brandId, templateType);
    });
    effectsPresetType = defaultType;
    await loadEffectsForPreset(brandId, defaultType);
    setupEffectsListeners();
}

async function loadEffectsForPreset(brandId, templateType) {
    document.getElementById('fx-status').textContent = 'Loading...';
    try {
        const cfg = await brandManager.getPresetConfigSection(brandId, templateType, 'effects');
        populateEffectsForm(cfg);
        effectsOriginal = JSON.stringify(cfg);
        document.getElementById('fx-status').textContent = cfg
            ? 'Editing: ' + templateType
            : 'No effects config for ' + templateType + ' — using defaults';
    } catch (e) {
        document.getElementById('fx-status').textContent = 'Failed to load config';
        console.error(e);
    }
}

function closeEffectsModal() {
    document.getElementById('effects-modal').classList.remove('active');
    effectsBrandId = null;
    effectsOriginal = null;
    effectsPresetType = null;
}

function populateEffectsForm(cfg) {
    // If no config, leave defaults
    if (!cfg) {
        document.getElementById('fx-enabled').checked = false;
        document.getElementById('fx-intensity').value = 0.6;
        document.getElementById('fx-intensity-val').textContent = '60%';
        // KB defaults
        document.getElementById('fx-kb-enabled').checked = true;
        document.getElementById('fx-kb-pan').value = 0.4;
        document.getElementById('fx-kb-pan-val').textContent = '0.40';
        document.getElementById('fx-kb-zoom').value = 1.12;
        document.getElementById('fx-kb-zoom-val').textContent = '1.12';
        document.getElementById('fx-kb-direction').value = 'alternate';
        // Grain defaults
        document.getElementById('fx-grain-enabled').checked = false;
        document.getElementById('fx-grain-int').value = 0.2;
        document.getElementById('fx-grain-int-val').textContent = '20%';
        document.getElementById('fx-grain-size').value = 1.0;
        document.getElementById('fx-grain-size-val').textContent = '1.0';
        // Flicker defaults
        document.getElementById('fx-flicker-enabled').checked = false;
        document.getElementById('fx-flicker-int').value = 0.15;
        document.getElementById('fx-flicker-int-val').textContent = '15%';
        document.getElementById('fx-flicker-freq').value = 0.25;
        document.getElementById('fx-flicker-freq-val').textContent = '0.25';
        // Vignette defaults
        document.getElementById('fx-vignette-enabled').checked = false;
        document.getElementById('fx-vignette-int').value = 0.6;
        document.getElementById('fx-vignette-int-val').textContent = '60%';
        // Color Grade defaults
        document.getElementById('fx-cg-enabled').checked = false;
        document.getElementById('fx-cg-preset').value = 'auto';
        document.getElementById('fx-cg-int').value = 0.65;
        document.getElementById('fx-cg-int-val').textContent = '65%';
        // Fade defaults
        document.getElementById('fx-fade-in').checked = true;
        document.getElementById('fx-fade-out').checked = true;
        document.getElementById('fx-fade-dur').value = 1.5;
        document.getElementById('fx-fade-dur-val').textContent = '1.5s';
        // Ceilings at max (= no ceiling)
        resetCeilings();
        return;
    }

    // Master
    document.getElementById('fx-enabled').checked = cfg.enabled === true;
    setSlider('fx-intensity', cfg.intensity ?? 0.6, v => Math.round(v * 100) + '%');

    // Ken Burns
    const kb = cfg.kenburns || {};
    document.getElementById('fx-kb-enabled').checked = kb.enabled !== false;
    setSlider('fx-kb-pan', kb.pan_speed ?? 0.4, v => v.toFixed(2));
    const zoomMax = Array.isArray(kb.zoom_range) ? kb.zoom_range[1] : 1.12;
    setSlider('fx-kb-zoom', zoomMax, v => v.toFixed(2));
    document.getElementById('fx-kb-direction').value = kb.direction || 'alternate';

    // Grain
    const gr = cfg.grain || {};
    document.getElementById('fx-grain-enabled').checked = gr.enabled === true;
    setSlider('fx-grain-int', gr.intensity ?? 0.2, v => Math.round(v * 100) + '%');
    setSlider('fx-grain-size', gr.size ?? 1.0, v => v.toFixed(1));

    // Flicker
    const fl = cfg.flicker || {};
    document.getElementById('fx-flicker-enabled').checked = fl.enabled === true;
    setSlider('fx-flicker-int', fl.intensity ?? 0.15, v => Math.round(v * 100) + '%');
    setSlider('fx-flicker-freq', fl.frequency ?? 0.25, v => v.toFixed(2));

    // Vignette
    const vi = cfg.vignette || {};
    document.getElementById('fx-vignette-enabled').checked = vi.enabled === true;
    setSlider('fx-vignette-int', vi.intensity ?? 0.6, v => Math.round(v * 100) + '%');

    // Color Grade
    const cg = cfg.color_grade || {};
    document.getElementById('fx-cg-enabled').checked = cg.enabled === true;
    document.getElementById('fx-cg-preset').value = cg.preset || 'auto';
    setSlider('fx-cg-int', cg.intensity ?? 0.65, v => Math.round(v * 100) + '%');

    // Fade
    const fd = cfg.fade || {};
    document.getElementById('fx-fade-in').checked = fd.fade_in !== false;
    document.getElementById('fx-fade-out').checked = fd.fade_out !== false;
    setSlider('fx-fade-dur', fd.duration ?? 1.5, v => v.toFixed(1) + 's');

    // Ceilings
    const lim = cfg.limits || {};
    setCeiling('fx-ceil-pan', lim.kenburns?.max_pan_speed, 0.6);
    setCeiling('fx-ceil-grain', lim.grain?.max_intensity, 0.5);
    setCeiling('fx-ceil-flicker', lim.flicker?.max_intensity, 0.5);
}

function setSlider(id, value, formatter) {
    const slider = document.getElementById(id);
    const valEl = document.getElementById(id + '-val');
    slider.value = value;
    if (valEl) valEl.textContent = formatter(Number(value));
}

function setCeiling(id, value, defaultMax) {
    const slider = document.getElementById(id);
    const valEl = document.getElementById(id + '-val');
    if (value !== undefined && value !== null) {
        slider.value = value;
        valEl.textContent = Number(value).toFixed(2);
    } else {
        slider.value = defaultMax;
        valEl.textContent = '—';
    }
}

function resetCeilings() {
    setCeiling('fx-ceil-pan', undefined, 0.6);
    setCeiling('fx-ceil-grain', undefined, 0.5);
    setCeiling('fx-ceil-flicker', undefined, 0.5);
}

function setupEffectsListeners() {
    // Auto-enable master toggle when ANY sub-effect is turned on
    const subToggles = ['fx-kb-enabled', 'fx-grain-enabled', 'fx-flicker-enabled',
                        'fx-vignette-enabled', 'fx-cg-enabled', 'fx-fade-in', 'fx-fade-out'];
    subToggles.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const clone2 = el.cloneNode(true);
            el.parentNode.replaceChild(clone2, el);
            clone2.addEventListener('change', () => {
                if (clone2.checked) {
                    document.getElementById('fx-enabled').checked = true;
                }
            });
        }
    });

    // Slider live-update labels
    const sliders = [
        { id: 'fx-intensity', fmt: v => Math.round(v * 100) + '%' },
        { id: 'fx-kb-pan', fmt: v => v.toFixed(2) },
        { id: 'fx-kb-zoom', fmt: v => v.toFixed(2) },
        { id: 'fx-grain-int', fmt: v => Math.round(v * 100) + '%' },
        { id: 'fx-grain-size', fmt: v => v.toFixed(1) },
        { id: 'fx-flicker-int', fmt: v => Math.round(v * 100) + '%' },
        { id: 'fx-flicker-freq', fmt: v => v.toFixed(2) },
        { id: 'fx-vignette-int', fmt: v => Math.round(v * 100) + '%' },
        { id: 'fx-cg-int', fmt: v => Math.round(v * 100) + '%' },
        { id: 'fx-fade-dur', fmt: v => v.toFixed(1) + 's' },
        { id: 'fx-ceil-pan', fmt: v => v.toFixed(2) },
        { id: 'fx-ceil-grain', fmt: v => v.toFixed(2) },
        { id: 'fx-ceil-flicker', fmt: v => v.toFixed(2) },
    ];
    sliders.forEach(({ id, fmt }) => {
        const el = document.getElementById(id);
        // Remove old listeners by cloning
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
        clone.addEventListener('input', () => {
            document.getElementById(id + '-val').textContent = fmt(Number(clone.value));
        });
    });

    // Save button
    const saveBtn = document.getElementById('fx-save-btn');
    const saveClone = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(saveClone, saveBtn);
    saveClone.addEventListener('click', saveEffectsConfig);

    // Reset button
    const resetBtn = document.getElementById('fx-reset-btn');
    const resetClone = resetBtn.cloneNode(true);
    resetBtn.parentNode.replaceChild(resetClone, resetBtn);
    resetClone.addEventListener('click', async () => {
        if (!confirm('Remove effects config for "' + effectsPresetType + '"? It will use system defaults.')) return;
        try {
            await brandManager.savePresetConfigSection(effectsBrandId, effectsPresetType, 'effects', null);
            toast.success('Effects config removed for ' + effectsPresetType);
            closeEffectsModal();
        } catch (e) {
            toast.error('Failed to reset effects config');
        }
    });
}

function buildEffectsConfigFromForm() {
    const cfg = {
        enabled: document.getElementById('fx-enabled').checked,
        intensity: Number(document.getElementById('fx-intensity').value),
        kenburns: {
            enabled: document.getElementById('fx-kb-enabled').checked,
            zoom_range: [1.0, Number(document.getElementById('fx-kb-zoom').value)],
            pan_speed: Number(document.getElementById('fx-kb-pan').value),
            direction: document.getElementById('fx-kb-direction').value,
        },
        grain: {
            enabled: document.getElementById('fx-grain-enabled').checked,
            intensity: Number(document.getElementById('fx-grain-int').value),
            size: Number(document.getElementById('fx-grain-size').value),
        },
        flicker: {
            enabled: document.getElementById('fx-flicker-enabled').checked,
            intensity: Number(document.getElementById('fx-flicker-int').value),
            frequency: Number(document.getElementById('fx-flicker-freq').value),
        },
        vignette: {
            enabled: document.getElementById('fx-vignette-enabled').checked,
            intensity: Number(document.getElementById('fx-vignette-int').value),
        },
        color_grade: {
            enabled: document.getElementById('fx-cg-enabled').checked,
            preset: document.getElementById('fx-cg-preset').value,
            intensity: Number(document.getElementById('fx-cg-int').value),
        },
        fade: {
            fade_in: document.getElementById('fx-fade-in').checked,
            fade_out: document.getElementById('fx-fade-out').checked,
            duration: Number(document.getElementById('fx-fade-dur').value),
        },
    };

    // Build limits (only include if user set a ceiling below the system max)
    const limits = {};
    const ceilPan = Number(document.getElementById('fx-ceil-pan').value);
    const ceilGrain = Number(document.getElementById('fx-ceil-grain').value);
    const ceilFlicker = Number(document.getElementById('fx-ceil-flicker').value);
    if (ceilPan < 0.6) limits.kenburns = { max_pan_speed: ceilPan };
    if (ceilGrain < 0.5) limits.grain = { max_intensity: ceilGrain };
    if (ceilFlicker < 0.5) limits.flicker = { max_intensity: ceilFlicker };
    if (Object.keys(limits).length > 0) cfg.limits = limits;

    // Safety: auto-enable master if ANY sub-effect is turned on
    const anyActive = cfg.kenburns.enabled || cfg.grain.enabled || cfg.flicker.enabled
        || cfg.vignette.enabled || cfg.color_grade.enabled
        || cfg.fade.fade_in || cfg.fade.fade_out;
    if (anyActive && !cfg.enabled) {
        cfg.enabled = true;
        document.getElementById('fx-enabled').checked = true;
    }

    return cfg;
}

async function saveEffectsConfig() {
    const cfg = buildEffectsConfigFromForm();
    const btn = document.getElementById('fx-save-btn') || document.querySelector('#effects-modal .btn--primary');
    
    try {
        if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
        await brandManager.savePresetConfigSection(effectsBrandId, effectsPresetType, 'effects', cfg);
        toast.success('Effects saved for ' + effectsPresetType);
        closeEffectsModal();
    } catch (e) {
        toast.error('Failed to save effects config: ' + e.message);
        console.error(e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Effects'; }
    }
}

// =========================================================
// SUBTITLE CONFIG MODAL (Roadmap #14)
// =========================================================

// Caption style metadata for preview
