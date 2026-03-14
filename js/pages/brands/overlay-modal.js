// Video overlay modal — upload, opacity, per-preset overlays
// Extracted from brands.html inline script

let overlayBrandId = null;
let overlayCurrentConfig = null;
let overlayCurrentPreset = null;

function setupOverlayDropzone() {
    const dropzone = document.getElementById('overlay-dropzone');
    const fileInput = document.getElementById('overlay-file-input');
    const modal = document.getElementById('overlay-modal');
    if (!dropzone || !fileInput || !modal) return;

    // Show active state when dragging over the entire modal
    modal.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && (file.type === 'video/mp4' || file.type === 'video/webm')) {
            handleOverlayFileSelect({ target: { files: [file] } });
        } else {
            if (typeof toast !== 'undefined') toast.error('Please drop an MP4 or WebM video file');
            else alert('Please drop an MP4 or WebM video file');
        }
    });

    // Click dropzone to open file picker
    dropzone.addEventListener('click', () => fileInput.click());
}

// Init dropzone once DOM is ready
setupOverlayDropzone();

async function openOverlayModal(brandId) {
    overlayBrandId = brandId;
    overlayCurrentConfig = null;
    overlayCurrentPreset = null;
    document.getElementById('overlay-modal').classList.add('active');
    document.getElementById('overlay-current-status').style.display = 'none';
    document.getElementById('overlay-opacity-section').style.display = 'none';
    document.getElementById('overlay-upload-progress').style.display = 'none';

    // Populate preset selector
    const select = document.getElementById('overlay-preset-select');
    select.innerHTML = '<option value="">Select a preset...</option>';
    try {
        const presets = await brandManager.getVibePresets(brandId);
        for (const p of presets) {
            const opt = document.createElement('option');
            opt.value = p.template_type;
            opt.textContent = p.name || p.template_type;
            select.appendChild(opt);
        }
    } catch (err) {
        console.error('Failed to load presets for overlay modal:', err);
    }
}

function closeOverlayModal() {
    document.getElementById('overlay-modal').classList.remove('active');
    overlayBrandId = null;
    overlayCurrentConfig = null;
    overlayCurrentPreset = null;
}

async function loadOverlayForPreset() {
    const select = document.getElementById('overlay-preset-select');
    const presetName = select?.value;
    if (!presetName || !overlayBrandId) {
        document.getElementById('overlay-current-status').style.display = 'none';
        document.getElementById('overlay-opacity-section').style.display = 'none';
        overlayCurrentPreset = null;
        overlayCurrentConfig = null;
        return;
    }
    overlayCurrentPreset = presetName;
    try {
        const config = await brandManager.getOverlayConfig(overlayBrandId, presetName);
        overlayCurrentConfig = config;
        if (config && config.enabled) {
            showOverlayActive(config);
        } else {
            document.getElementById('overlay-current-status').style.display = 'none';
            document.getElementById('overlay-opacity-section').style.display = 'none';
        }
    } catch (err) {
        console.error('Failed to load overlay config:', err);
        document.getElementById('overlay-current-status').style.display = 'none';
        document.getElementById('overlay-opacity-section').style.display = 'none';
    }
}

function showOverlayActive(config) {
    document.getElementById('overlay-current-status').style.display = 'block';
    document.getElementById('overlay-current-filename').textContent = config.display_name || 'overlay.mp4';
    document.getElementById('overlay-opacity-section').style.display = 'block';
    const slider = document.getElementById('overlay-opacity-slider');
    const label = document.getElementById('overlay-opacity-value');
    slider.value = Math.round((config.opacity || 0.4) * 100);
    label.textContent = Math.round((config.opacity || 0.4) * 100) + '%';
}

async function handleOverlayFileSelect(event) {
    const files = event.target?.files || event.dataTransfer?.files;
    const file = files?.[0];
    if (!file) return;
    if (!overlayCurrentPreset) {
        if (typeof toast !== 'undefined') toast.error('Please select a preset first');
        else alert('Please select a preset first');
        if (event.target) event.target.value = '';
        return;
    }
    if (!file.type.startsWith('video/')) {
        if (typeof toast !== 'undefined') toast.error('Please select a video file (MP4 or WebM)');
        else alert('Please select a video file (MP4 or WebM)');
        if (event.target) event.target.value = '';
        return;
    }

    const progressEl = document.getElementById('overlay-upload-progress');
    const bar = document.getElementById('overlay-progress-bar');
    const pct = document.getElementById('overlay-progress-pct');
    progressEl.style.display = 'block';
    bar.style.width = '30%';
    pct.textContent = '30';

    try {
        const opacitySlider = document.getElementById('overlay-opacity-slider');
        const opacity = opacitySlider ? parseInt(opacitySlider.value) / 100 : 0.4;

        const config = await brandManager.uploadOverlayVideo(
            overlayBrandId,
            overlayCurrentPreset,
            file,
            { opacity, display_name: file.name }
        );

        bar.style.width = '100%';
        pct.textContent = '100';
        overlayCurrentConfig = config;
        showOverlayActive(config);
        if (typeof toast !== 'undefined') toast.success('Overlay uploaded!');

        setTimeout(() => { progressEl.style.display = 'none'; bar.style.width = '0%'; }, 1200);
    } catch (err) {
        console.error('Overlay upload failed:', err);
        alert('Upload failed: ' + err.message);
        progressEl.style.display = 'none';
    }
    if (event.target) event.target.value = '';
}

async function removeCurrentOverlay() {
    if (!overlayCurrentPreset || !overlayBrandId) return;
    if (!confirm('Remove overlay video from "' + overlayCurrentPreset + '"?')) return;
    try {
        await brandManager.removeOverlayVideo(overlayBrandId, overlayCurrentPreset);
        overlayCurrentConfig = null;
        document.getElementById('overlay-current-status').style.display = 'none';
        document.getElementById('overlay-opacity-section').style.display = 'none';
        if (typeof toast !== 'undefined') toast.success('Overlay removed');
    } catch (err) {
        console.error('Failed to remove overlay:', err);
        alert('Failed to remove: ' + err.message);
    }
}

function onOverlayOpacityChange() {
    const slider = document.getElementById('overlay-opacity-slider');
    const label = document.getElementById('overlay-opacity-value');
    if (!slider || !label) return;
    label.textContent = slider.value + '%';

    clearTimeout(onOverlayOpacityChange._t);
    onOverlayOpacityChange._t = setTimeout(async () => {
        if (!overlayCurrentPreset || !overlayBrandId || !overlayCurrentConfig) return;
        try {
            await brandManager.updateOverlayOpacity(overlayBrandId, overlayCurrentPreset, parseInt(slider.value) / 100);
        } catch (err) {
            console.error('Failed to update overlay opacity:', err);
        }
    }, 600);
}

// =====================================================
// SCHEDULE WINDOWS MODAL
// =====================================================

