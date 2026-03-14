// Subtitle config modal — caption style, preview, save
// Extracted from brands.html inline script

const CAPTION_STYLE_INFO = {
    bold:       { font: 'Impact',          color: '#FFFFFF', bg: '#000000' },
    horror:     { font: 'Times New Roman',  color: '#DC2626', bg: '#000000' },
    glitch:     { font: 'Impact',           color: '#00FFFF', bg: '#FF00FF' },
    minimal:    { font: 'Arial',            color: '#EBE5E7', bg: '#000000' },
    neon:       { font: 'Arial',            color: '#F0ABFC', bg: '#EF46D3' },
    vintage:    { font: 'Georgia',          color: '#FEF3C7', bg: '#78350F' },
    blood:      { font: 'Impact',           color: '#7F1D1D', bg: '#450A0A' },
    typewriter: { font: 'Courier New',      color: '#D1D5DB', bg: '#000000' },
    shadow:     { font: 'Arial',            color: '#FFFFFF', bg: '#000000' },
    comic:      { font: 'Comic Sans MS',    color: '#FBB724', bg: '#000000' },
};

let subtitleBrandId = null;
let subtitleOriginal = null;
let subtitlePresetType = null;

async function openSubtitleModal(brandId) {
    subtitleBrandId = brandId;
    document.getElementById('subtitle-modal').classList.add('active');
    document.getElementById('sub-status').textContent = 'Loading presets...';

    // Build preset tabs
    const defaultType = await buildPresetTabBar('sub-preset-tabs', brandId, async (templateType) => {
        subtitlePresetType = templateType;
        await loadSubtitleForPreset(brandId, templateType);
    });
    subtitlePresetType = defaultType;
    await loadSubtitleForPreset(brandId, defaultType);
    setupSubtitleListeners();
}

async function loadSubtitleForPreset(brandId, templateType) {
    document.getElementById('sub-status').textContent = 'Loading...';
    try {
        const cfg = await brandManager.getPresetConfigSection(brandId, templateType, 'subtitles');
        populateSubtitleForm(cfg);
        subtitleOriginal = JSON.stringify(cfg);
        document.getElementById('sub-status').textContent = cfg
            ? 'Editing: ' + templateType
            : 'No subtitle config for ' + templateType + ' — using defaults';
    } catch (e) {
        document.getElementById('sub-status').textContent = 'Failed to load config';
        console.error(e);
    }
}

function closeSubtitleModal() {
    document.getElementById('subtitle-modal').classList.remove('active');
    subtitleBrandId = null;
    subtitleOriginal = null;
    subtitlePresetType = null;
}

function populateSubtitleForm(cfg) {
    if (!cfg) {
        // System defaults
        document.getElementById('sub-style').value = 'bold';
        document.getElementById('sub-font-size').value = 85;
        document.getElementById('sub-font-size-val').textContent = '85';
        document.getElementById('sub-position').value = 'bottom';
        document.getElementById('sub-words-per-chunk').value = 3;
        document.getElementById('sub-words-per-chunk-val').textContent = '3';
        document.getElementById('sub-emphasis-scale').value = 110;
        document.getElementById('sub-emphasis-scale-val').textContent = '110%';
        document.getElementById('sub-highlight-scary').checked = true;
        updateSubtitlePreview();
        return;
    }

    document.getElementById('sub-style').value = cfg.style || 'bold';
    setSlider('sub-font-size', cfg.font_size ?? 85, v => String(Math.round(v)));
    document.getElementById('sub-position').value = cfg.position || 'bottom';
    setSlider('sub-words-per-chunk', cfg.words_per_chunk ?? 3, v => String(Math.round(v)));
    setSlider('sub-emphasis-scale', cfg.emphasis_scale ?? 110, v => Math.round(v) + '%');
    document.getElementById('sub-highlight-scary').checked = cfg.highlight_scary !== false;
    updateSubtitlePreview();
}

function updateSubtitlePreview() {
    const style = document.getElementById('sub-style').value;
    const fontSize = Number(document.getElementById('sub-font-size').value);
    const highlightScary = document.getElementById('sub-highlight-scary').checked;
    const wordsPerChunk = Number(document.getElementById('sub-words-per-chunk').value);
    const emphasisScale = Number(document.getElementById('sub-emphasis-scale').value);
    const position = document.getElementById('sub-position').value;
    const info = CAPTION_STYLE_INFO[style] || CAPTION_STYLE_INFO.bold;

    // Build sample words — pick a chunk that matches wordsPerChunk
    const sampleWords = ['The', 'shadow', 'crept', 'closer', 'in', 'the', 'darkness', 'tonight'];
    const scarySet = new Set(['shadow', 'darkness', 'blood', 'death', 'scream']);
    const chunk = sampleWords.slice(0, Math.min(wordsPerChunk, sampleWords.length));
    const activeIdx = Math.min(1, chunk.length - 1); // highlight 2nd word (or 1st if only 1)

    const previewText = document.getElementById('sub-preview-text');
    const previewScreen = document.getElementById('sub-preview-screen');
    if (!previewText || !previewScreen) return;

    // Scale font size relative to preview container
    const scaledSize = Math.max(12, Math.round(fontSize / 5));
    previewText.style.fontFamily = `"${info.font}", sans-serif`;
    previewText.style.fontSize = scaledSize + 'px';
    previewText.style.color = info.color;
    previewText.style.textShadow = `2px 2px 4px ${info.bg}, -1px -1px 2px ${info.bg}`;

    // Build chunk HTML with active word highlighted
    const parts = chunk.map((word, idx) => {
        const isActive = idx === activeIdx;
        const isScary = highlightScary && scarySet.has(word.toLowerCase());
        const scale = isActive ? (emphasisScale / 100) : 1;
        const color = isActive
            ? (isScary ? '#FF1D1D' : '#FFFF00')
            : (isScary ? '#FF1D1D' : info.color);
        return `<span style="color:${color};display:inline-block;transform:scale(${scale});transform-origin:center bottom;">${word}</span>`;
    });
    previewText.innerHTML = parts.join(' ');

    // Position: align text in the preview screen
    if (position === 'top') {
        previewScreen.style.alignItems = 'flex-start';
    } else if (position === 'center') {
        previewScreen.style.alignItems = 'center';
    } else {
        previewScreen.style.alignItems = 'flex-end';
    }
}

function setupSubtitleListeners() {
    // Slider live-update labels
    const sliders = [
        { id: 'sub-font-size', fmt: v => String(Math.round(v)) },
        { id: 'sub-words-per-chunk', fmt: v => String(Math.round(v)) },
        { id: 'sub-emphasis-scale', fmt: v => Math.round(v) + '%' },
    ];
    sliders.forEach(({ id, fmt }) => {
        const el = document.getElementById(id);
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
        clone.addEventListener('input', () => {
            document.getElementById(id + '-val').textContent = fmt(Number(clone.value));
            updateSubtitlePreview();
        });
    });

    // Style dropdown → update preview
    const styleEl = document.getElementById('sub-style');
    const styleClone = styleEl.cloneNode(true);
    styleEl.parentNode.replaceChild(styleClone, styleEl);
    styleClone.addEventListener('change', updateSubtitlePreview);

    // Scary toggle → update preview
    const scaryEl = document.getElementById('sub-highlight-scary');
    const scaryClone = scaryEl.cloneNode(true);
    scaryEl.parentNode.replaceChild(scaryClone, scaryEl);
    scaryClone.addEventListener('change', updateSubtitlePreview);

    // Position dropdown → update preview
    const posEl = document.getElementById('sub-position');
    const posClone = posEl.cloneNode(true);
    posEl.parentNode.replaceChild(posClone, posEl);
    posClone.addEventListener('change', updateSubtitlePreview);

    // Save button
    const saveBtn = document.getElementById('sub-save-btn');
    const saveClone = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(saveClone, saveBtn);
    saveClone.addEventListener('click', saveSubtitleConfig);

    // Reset button
    const resetBtn = document.getElementById('sub-reset-btn');
    const resetClone = resetBtn.cloneNode(true);
    resetBtn.parentNode.replaceChild(resetClone, resetBtn);
    resetClone.addEventListener('click', async () => {
        if (!confirm('Remove subtitle config for "' + subtitlePresetType + '"? It will use preset defaults.')) return;
        try {
            await brandManager.savePresetConfigSection(subtitleBrandId, subtitlePresetType, 'subtitles', null);
            toast.success('Subtitle config removed for ' + subtitlePresetType);
            closeSubtitleModal();
        } catch (e) {
            toast.error('Failed to reset subtitle config');
        }
    });
}

function buildSubtitleConfigFromForm() {
    return {
        style: document.getElementById('sub-style').value,
        font_size: Number(document.getElementById('sub-font-size').value),
        position: document.getElementById('sub-position').value,
        words_per_chunk: Number(document.getElementById('sub-words-per-chunk').value),
        emphasis_scale: Number(document.getElementById('sub-emphasis-scale').value),
        highlight_scary: document.getElementById('sub-highlight-scary').checked,
    };
}

async function saveSubtitleConfig() {
    const cfg = buildSubtitleConfigFromForm();
    const btn = document.getElementById('sub-save-btn') || document.querySelector('#subtitle-modal .btn--primary');
    
    try {
        if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
        await brandManager.savePresetConfigSection(subtitleBrandId, subtitlePresetType, 'subtitles', cfg);
        toast.success('Subtitles saved for ' + subtitlePresetType);
        closeSubtitleModal();
    } catch (e) {
        toast.error('Failed to save subtitle config: ' + e.message);
        console.error(e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Subtitles'; }
    }
}

// =========================================================
// IMAGE PROMPT CONFIG MODAL (per-preset)
// =========================================================
