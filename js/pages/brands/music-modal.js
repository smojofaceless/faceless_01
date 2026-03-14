// Music tracks modal — upload, preview, volume, advanced config
// Extracted from brands.html inline script

let musicBrandId = null;
let pendingMusicFile = null;
let currentAudioPreview = null;

function openMusicModal(brandId) {
    musicBrandId = brandId;
    document.getElementById('music-modal').classList.add('active');
    document.getElementById('music-upload-form').style.display = 'none';
    pendingMusicFile = null;
    loadMusicTracks();
    loadMusicVolume();
    loadMusicAdvanced();
    setupMusicDropzone();
}

function closeMusicModal() {
    document.getElementById('music-modal').classList.remove('active');
    musicBrandId = null;
    pendingMusicFile = null;
    stopPreview();
}

function setupMusicDropzone() {
    const dropzone = document.getElementById('music-dropzone');
    const fileInput = document.getElementById('music-file-input');
    const modal = document.getElementById('music-modal');

    // Show dropzone when dragging over the modal
    modal.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });

    // Drag & drop
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
        if (file && file.type === 'audio/mpeg') {
            prepareUpload(file);
        } else {
            toast.error('Please drop an MP3 file');
        }
    });

    // Click to browse
    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) prepareUpload(e.target.files[0]);
    });

    // Upload confirm/cancel
    document.getElementById('music-upload-confirm').addEventListener('click', confirmUpload);
    document.getElementById('music-upload-cancel').addEventListener('click', () => {
        document.getElementById('music-upload-form').style.display = 'none';
        pendingMusicFile = null;
    });
}

function prepareUpload(file) {
    if (file.size > 10 * 1024 * 1024) {
        toast.error('File too large (max 10MB)');
        return;
    }
    pendingMusicFile = file;
    const baseName = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    document.getElementById('music-track-name').value = baseName;
    document.getElementById('music-upload-form').style.display = 'block';
}

async function confirmUpload() {
    if (!pendingMusicFile || !musicBrandId) return;

    const displayName = document.getElementById('music-track-name').value.trim() || pendingMusicFile.name;
    const mood = document.getElementById('music-track-mood').value;
    const energy = document.getElementById('music-track-energy').value;
    const loopable = document.getElementById('music-track-loopable').checked;

    const progressEl = document.getElementById('music-upload-progress');
    const filenameEl = document.getElementById('music-upload-filename');
    progressEl.style.display = 'block';
    filenameEl.textContent = pendingMusicFile.name;

    try {
        await brandManager.uploadMusicTrack(musicBrandId, pendingMusicFile, {
            display_name: displayName,
            mood,
            energy,
            loopable,
        });
        toast.success(`Uploaded "${displayName}"`);
        pendingMusicFile = null;
        document.getElementById('music-upload-form').style.display = 'none';
        document.getElementById('music-file-input').value = '';
        loadMusicTracks();
    } catch (e) {
        console.error('Upload failed:', e);
        toast.error(`Upload failed: ${e.message}`);
    } finally {
        progressEl.style.display = 'none';
    }
}

async function loadMusicTracks() {
    const container = document.getElementById('music-tracks-list');
    if (!musicBrandId) return;

    try {
        const tracks = await brandManager.getMusicTracks(musicBrandId);
        if (tracks.length === 0) {
            container.innerHTML = `
                <div class="music-empty">
                    <p class="text-gray-400">No music tracks yet</p>
                    <p class="text-gray-500 text-xs">Upload an MP3 above to add background music to your videos</p>
                </div>
            `;
            return;
        }

        container.innerHTML = tracks.map(track => renderMusicTrack(track)).join('');

        // Show track count header
        const listHeader = document.getElementById('music-list-header');
        if (listHeader) {
            listHeader.style.display = 'flex';
            document.getElementById('music-track-count').textContent = `${tracks.length} track${tracks.length !== 1 ? 's' : ''}`;
        }

        // Attach listeners
        container.querySelectorAll('.music-track__toggle').forEach(btn => {
            btn.addEventListener('click', async () => {
                const trackId = btn.dataset.trackId;
                const isActive = btn.dataset.active === 'true';
                try {
                    await brandManager.toggleMusicTrack(musicBrandId, trackId, !isActive);
                    toast.success(isActive ? 'Track disabled' : 'Track enabled');
                    loadMusicTracks();
                } catch (e) {
                    toast.error('Failed to toggle track');
                }
            });
        });

        container.querySelectorAll('.music-track__delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const trackId = btn.dataset.trackId;
                const name = btn.dataset.trackName;
                if (!confirm(`Delete track "${name}"? This cannot be undone.`)) return;
                try {
                    await brandManager.deleteMusicTrack(musicBrandId, trackId);
                    await brandManager.removeMusicFile(musicBrandId, trackId);
                    toast.success('Track deleted');
                    loadMusicTracks();
                } catch (e) {
                    toast.error('Failed to delete track');
                }
            });
        });

        container.querySelectorAll('.mt-card__play').forEach(btn => {
            btn.addEventListener('click', () => {
                const url = btn.dataset.url;
                const playIcon = '<svg class="mt-card__play-icon" viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="6,4 20,12 6,20"/></svg>';
                const pauseIcon = '<svg class="mt-card__play-icon" viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
                if (currentAudioPreview && !currentAudioPreview.paused) {
                    stopPreview();
                    btn.innerHTML = playIcon;
                } else {
                    stopPreview();
                    currentAudioPreview = new Audio(url);
                    currentAudioPreview.volume = 0.4;
                    currentAudioPreview.play().catch(() => {});
                    btn.innerHTML = pauseIcon;
                    btn.classList.add('mt-card__play--active');
                    currentAudioPreview.addEventListener('ended', () => {
                        btn.innerHTML = playIcon;
                        btn.classList.remove('mt-card__play--active');
                    });
                }
            });
        });

        // Per-track volume: live label update on slide
        container.querySelectorAll('.mt-card__vol-slider').forEach(slider => {
            slider.addEventListener('input', () => {
                const valEl = container.querySelector(`.mt-card__vol-val[data-track-id="${slider.dataset.trackId}"]`);
                if (valEl) valEl.textContent = slider.value + '%';
            });
        });

        // Per-track volume: save button
        container.querySelectorAll('.music-track__volume-save').forEach(btn => {
            btn.addEventListener('click', async () => {
                const trackId = btn.dataset.trackId;
                const slider = container.querySelector(`.mt-card__vol-slider[data-track-id="${trackId}"]`);
                const volume = parseInt(slider.value, 10) / 100;
                try {
                    await brandManager.updateTrackVolume(musicBrandId, trackId, volume);
                    toast.success(`Track volume set to ${slider.value}%`);
                    loadMusicTracks();
                } catch (e) {
                    toast.error('Failed to save track volume');
                }
            });
        });

        // Per-track volume: reset to brand default
        container.querySelectorAll('.music-track__volume-reset').forEach(btn => {
            btn.addEventListener('click', async () => {
                const trackId = btn.dataset.trackId;
                try {
                    await brandManager.updateTrackVolume(musicBrandId, trackId, null);
                    toast.success('Track volume reset to brand default');
                    loadMusicTracks();
                } catch (e) {
                    toast.error('Failed to reset track volume');
                }
            });
        });
    } catch (e) {
        console.error('Failed to load tracks:', e);
        container.innerHTML = `<div class="text-red-400 text-center py-4">Failed to load tracks</div>`;
    }
}

function stopPreview() {
    if (currentAudioPreview) {
        currentAudioPreview.pause();
        currentAudioPreview = null;
    }
    const playIcon = '<svg class="mt-card__play-icon" viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="6,4 20,12 6,20"/></svg>';
    document.querySelectorAll('.mt-card__play').forEach(b => {
        b.innerHTML = playIcon;
        b.classList.remove('mt-card__play--active');
    });
}

// =====================================================
// MUSIC VOLUME CONTROL
// =====================================================

async function loadMusicVolume() {
    if (!musicBrandId) return;
    const slider = document.getElementById('music-volume-slider');
    const valueEl = document.getElementById('music-volume-value');
    try {
        const config = await brandManager.getMusicConfig(musicBrandId);
        const vol = config?.default_volume ?? 0.18;
        const pct = Math.round(vol * 100);
        slider.value = pct;
        valueEl.textContent = pct + '%';
    } catch (e) {
        console.warn('Could not load music config, using default', e);
        slider.value = 18;
        valueEl.textContent = '18%';
    }

    // Live update label on slide
    slider.oninput = () => {
        valueEl.textContent = slider.value + '%';
    };

    // Save button
    const saveBtn = document.getElementById('music-volume-save');
    const clone = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(clone, saveBtn);
    clone.addEventListener('click', saveMusicVolume);
}

async function saveMusicVolume() {
    if (!musicBrandId) return;
    const slider = document.getElementById('music-volume-slider');
    const volume = parseInt(slider.value, 10) / 100;
    try {
        await brandManager.saveMusicConfig(musicBrandId, { default_volume: volume });
        toast.success(`Music volume set to ${slider.value}%`);
    } catch (e) {
        console.error('Failed to save music volume:', e);
        toast.error('Failed to save volume: ' + e.message);
    }
}

// =====================================================
// MUSIC ADVANCED AUDIO SETTINGS
// =====================================================

async function loadMusicAdvanced() {
    if (!musicBrandId) return;
    try {
        const cfg = await brandManager.getMusicConfig(musicBrandId);
        const enabled = cfg?.enabled ?? true;
        document.getElementById('music-enabled-toggle').checked = enabled;

        const duckVol = Math.round((cfg?.ducking?.duck_volume ?? 0.08) * 100);
        document.getElementById('music-duck-volume').value = duckVol;
        document.getElementById('music-duck-volume-value').textContent = duckVol + '%';

        const attack = cfg?.ducking?.attack_ms ?? 150;
        document.getElementById('music-duck-attack').value = attack;
        document.getElementById('music-duck-attack-value').textContent = attack + 'ms';

        const release = cfg?.ducking?.release_ms ?? 250;
        document.getElementById('music-duck-release').value = release;
        document.getElementById('music-duck-release-value').textContent = release + 'ms';

        const fadeIn = cfg?.fade?.in_ms ?? 800;
        document.getElementById('music-fade-in').value = fadeIn;
        document.getElementById('music-fade-in-value').textContent = fadeIn + 'ms';

        const fadeOut = cfg?.fade?.out_ms ?? 1200;
        document.getElementById('music-fade-out').value = fadeOut;
        document.getElementById('music-fade-out-value').textContent = fadeOut + 'ms';
    } catch (e) {
        console.warn('Could not load advanced music settings:', e);
    }

    // Bind slider live update
    ['music-duck-volume', 'music-duck-attack', 'music-duck-release', 'music-fade-in', 'music-fade-out'].forEach(id => {
        const el = document.getElementById(id);
        const valEl = document.getElementById(id + '-value');
        el.oninput = () => {
            const suffix = id.includes('volume') ? '%' : 'ms';
            valEl.textContent = el.value + suffix;
        };
    });

    // Save button
    const saveBtn = document.getElementById('music-advanced-save');
    const clone = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(clone, saveBtn);
    clone.addEventListener('click', saveMusicAdvanced);
}

async function saveMusicAdvanced() {
    if (!musicBrandId) return;
    const cfg = {
        enabled: document.getElementById('music-enabled-toggle').checked,
        ducking: {
            enabled: true,
            duck_volume: parseInt(document.getElementById('music-duck-volume').value) / 100,
            attack_ms: parseInt(document.getElementById('music-duck-attack').value),
            release_ms: parseInt(document.getElementById('music-duck-release').value),
        },
        fade: {
            in_ms: parseInt(document.getElementById('music-fade-in').value),
            out_ms: parseInt(document.getElementById('music-fade-out').value),
        },
    };
    try {
        await brandManager.saveMusicConfig(musicBrandId, cfg);
        toast.success('Audio settings saved');
    } catch (e) {
        toast.error('Failed to save: ' + e.message);
    }
}

function renderMusicTrack(track) {
    const url = brandManager.getMusicTrackUrl(musicBrandId, track.id);
    const moodColors = {
        dark: '#8B5CF6', tense: '#EF4444', eerie: '#10B981',
        ambient: '#3B82F6', dramatic: '#F97316', melancholic: '#6366F1',
        upbeat: '#FBBF24', calm: '#06B6D4'
    };
    const moodColor = moodColors[track.mood] || '#6B7280';
    const isActive = track.is_active;
    const trackVol = track.volume != null ? Math.round(track.volume * 100) : null;
    const trackVolDisplay = trackVol != null ? trackVol + '%' : 'default';
    const sliderVal = trackVol != null ? trackVol : 18;
    const hasCustomVol = trackVol != null;
    const durationStr = track.duration_seconds ? `${Math.floor(track.duration_seconds/60)}:${String(track.duration_seconds%60).padStart(2,'0')}` : '';

    return `
        <div class="mt-card ${!isActive ? 'mt-card--disabled' : ''}" data-track-id="${track.id}">
            <div class="mt-card__left">
                <button class="mt-card__play" data-url="${url}" title="Preview">
                    <svg class="mt-card__play-icon" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                        <polygon points="6,4 20,12 6,20"/>
                    </svg>
                </button>
                <div class="mt-card__info">
                    <div class="mt-card__name">${escapeHtml(track.display_name)}</div>
                    <div class="mt-card__tags">
                        <span class="mt-card__tag mt-card__tag--mood" style="--tag-color:${moodColor}">${track.mood}</span>
                        <span class="mt-card__tag mt-card__tag--energy">${track.energy}</span>
                        ${durationStr ? `<span class="mt-card__tag mt-card__tag--dur">${durationStr}</span>` : ''}
                        ${track.loopable ? '<span class="mt-card__tag mt-card__tag--loop" title="Loopable">&#8734;</span>' : ''}
                        ${!isActive ? '<span class="mt-card__tag mt-card__tag--off">off</span>' : ''}
                    </div>
                </div>
            </div>
            <div class="mt-card__right">
                <div class="mt-card__vol">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" class="mt-card__vol-icon"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                    <input type="range" class="mt-card__vol-slider ${hasCustomVol ? 'mt-card__vol-slider--custom' : ''}" data-track-id="${track.id}" min="0" max="50" step="1" value="${sliderVal}">
                    <span class="mt-card__vol-val ${hasCustomVol ? 'mt-card__vol-val--custom' : ''}" data-track-id="${track.id}">${trackVolDisplay}</span>
                    <button class="mt-card__vol-save music-track__volume-save" data-track-id="${track.id}" title="Save volume">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                    ${hasCustomVol ? `<button class="mt-card__vol-reset music-track__volume-reset" data-track-id="${track.id}" title="Reset to default">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                    </button>` : ''}
                </div>
                <div class="mt-card__actions">
                    <button class="mt-card__btn music-track__toggle" data-track-id="${track.id}" data-active="${isActive}" title="${isActive ? 'Disable' : 'Enable'}">
                        ${isActive ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>'}
                    </button>
                    <button class="mt-card__btn mt-card__btn--danger music-track__delete" data-track-id="${track.id}" data-track-name="${escapeHtml(track.display_name)}" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
        </div>
    `;
}

function escapeHtml(str) {
    // Use global if available (from utils.js), else simple fallback
    if (typeof window.escapeHtml === 'function' && window.escapeHtml !== escapeHtml) {
        return window.escapeHtml(str);
    }
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

