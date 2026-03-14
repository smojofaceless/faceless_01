// Gameplay clips modal — upload, manage clips
// Extracted from brands.html inline script

let gameplayBrandId = null;
let pendingGameplayFile = null;

function openGameplayModal(brandId) {
    gameplayBrandId = brandId;
    document.getElementById('gameplay-modal').classList.add('active');
    document.getElementById('gameplay-upload-form').style.display = 'none';
    pendingGameplayFile = null;
    loadGameplayClips();
    setupGameplayDropzone();
}

function closeGameplayModal() {
    document.getElementById('gameplay-modal').classList.remove('active');
    gameplayBrandId = null;
    pendingGameplayFile = null;
}

function setupGameplayDropzone() {
    const dropzone = document.getElementById('gameplay-dropzone');
    const fileInput = document.getElementById('gameplay-file-input');
    const modal = document.getElementById('gameplay-modal');

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
        if (file && (file.type === 'video/mp4' || file.name.endsWith('.mp4'))) {
            prepareGameplayUpload(file);
        } else {
            toast.error('Please drop an MP4 file');
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) prepareGameplayUpload(e.target.files[0]);
    });

    document.getElementById('gameplay-upload-confirm').addEventListener('click', confirmGameplayUpload);
    document.getElementById('gameplay-upload-cancel').addEventListener('click', () => {
        document.getElementById('gameplay-upload-form').style.display = 'none';
        pendingGameplayFile = null;
    });
}

function prepareGameplayUpload(file) {
    // 500MB max for gameplay videos
    if (file.size > 500 * 1024 * 1024) {
        toast.error('File too large (max 500MB). Consider 720p resolution for smaller files.');
        return;
    }
    pendingGameplayFile = file;
    const baseName = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    document.getElementById('gameplay-clip-name').value = baseName;
    document.getElementById('gameplay-upload-form').style.display = 'block';

    // Try to detect duration via video element
    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    tempVideo.onloadedmetadata = () => {
        URL.revokeObjectURL(tempVideo.src);
        const dur = Math.round(tempVideo.duration);
        if (dur > 0) {
            document.getElementById('gameplay-clip-duration').value = dur;
        }
    };
    tempVideo.src = URL.createObjectURL(file);
}

async function confirmGameplayUpload() {
    if (!pendingGameplayFile || !gameplayBrandId) return;

    const displayName = document.getElementById('gameplay-clip-name').value.trim() || pendingGameplayFile.name;
    const game = document.getElementById('gameplay-clip-game').value;
    const durationSeconds = parseInt(document.getElementById('gameplay-clip-duration').value, 10) || 0;
    const mood = document.getElementById('gameplay-clip-mood').value;
    const energy = document.getElementById('gameplay-clip-energy').value;
    const orientation = document.getElementById('gameplay-clip-orientation').value;

    if (durationSeconds < 30) {
        toast.error('Please enter the clip duration (at least 30 seconds)');
        return;
    }

    const progressEl = document.getElementById('gameplay-upload-progress');
    const filenameEl = document.getElementById('gameplay-upload-filename');
    const progressBar = document.getElementById('gameplay-progress-bar');
    const progressPct = document.getElementById('gameplay-progress-pct');
    progressEl.style.display = 'block';
    filenameEl.textContent = pendingGameplayFile.name;
    progressBar.style.width = '0%';
    progressPct.textContent = '0';

    const onProgress = (pct) => {
        progressBar.style.width = pct + '%';
        progressPct.textContent = pct;
    };

    try {
        await brandManager.uploadGameplayClip(gameplayBrandId, pendingGameplayFile, {
            display_name: displayName,
            game,
            duration_seconds: durationSeconds,
            mood,
            energy,
            orientation,
        }, onProgress);
        toast.success(`Uploaded "${displayName}"`);
        pendingGameplayFile = null;
        document.getElementById('gameplay-upload-form').style.display = 'none';
        document.getElementById('gameplay-file-input').value = '';
        loadGameplayClips();
    } catch (e) {
        console.error('Gameplay upload failed:', e);
        toast.error(`Upload failed: ${e.message}`);
    } finally {
        progressEl.style.display = 'none';
    }
}

async function loadGameplayClips() {
    const container = document.getElementById('gameplay-clips-list');
    if (!gameplayBrandId) return;

    try {
        const clips = await brandManager.getGameplayClips(gameplayBrandId);
        if (clips.length === 0) {
            container.innerHTML = `
                <div class="music-empty">
                    <p class="text-gray-400">No gameplay clips yet</p>
                    <p class="text-gray-500 text-xs">Upload an MP4 above to add background gameplay to your videos</p>
                </div>
            `;
            return;
        }

        container.innerHTML = clips.map(clip => renderGameplayClip(clip)).join('');

        // Toggle buttons
        container.querySelectorAll('.gameplay-clip__toggle').forEach(btn => {
            btn.addEventListener('click', async () => {
                const clipId = btn.dataset.clipId;
                const isActive = btn.dataset.active === 'true';
                try {
                    await brandManager.toggleGameplayClip(gameplayBrandId, clipId, !isActive);
                    toast.success(isActive ? 'Clip disabled' : 'Clip enabled');
                    loadGameplayClips();
                } catch (e) {
                    toast.error('Failed to toggle clip');
                }
            });
        });

        // Delete buttons
        container.querySelectorAll('.gameplay-clip__delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const clipId = btn.dataset.clipId;
                const name = btn.dataset.clipName;
                if (!confirm(`Delete clip "${name}"? This cannot be undone.`)) return;
                try {
                    await brandManager.deleteGameplayClip(gameplayBrandId, clipId);
                    await brandManager.removeGameplayFile(gameplayBrandId, clipId);
                    toast.success('Clip deleted');
                    loadGameplayClips();
                } catch (e) {
                    toast.error('Failed to delete clip');
                }
            });
        });
    } catch (e) {
        console.error('Failed to load gameplay clips:', e);
        container.innerHTML = `<div class="text-red-400 text-center py-4">Failed to load clips</div>`;
    }
}

function renderGameplayClip(clip) {
    const isActive = clip.is_active;
    const sizeMb = clip.file_size_mb ? `${clip.file_size_mb}MB` : '';
    const durationMin = clip.duration_seconds ? `${Math.floor(clip.duration_seconds / 60)}m ${clip.duration_seconds % 60}s` : 'unknown';
    const gameColors = {
        minecraft: '#4CAF50', subway_surfers: '#FF9800', satisfying: '#E91E63',
        gta: '#9C27B0', cooking: '#FF5722', puzzle: '#2196F3', generic: '#607D8B'
    };
    const gameColor = gameColors[clip.game] || '#607D8B';

    return `
        <div class="mt-card ${!isActive ? 'mt-card--disabled' : ''}" data-clip-id="${clip.id}">
            <div class="mt-card__left">
                <div style="width:36px;height:36px;border-radius:6px;background:var(--gray-800);display:flex;align-items:center;justify-content:center;flex-shrink:0">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="2" y="6" width="20" height="12" rx="2"/><polygon points="10 9 10 15 15 12"/></svg>
                </div>
                <div class="mt-card__info">
                    <div class="mt-card__name">${escapeHtml(clip.display_name)}</div>
                    <div class="mt-card__tags">
                        <span class="mt-card__tag mt-card__tag--mood" style="--tag-color:${gameColor}">${clip.game}</span>
                        <span class="mt-card__tag mt-card__tag--energy">${clip.energy}</span>
                        <span class="mt-card__tag mt-card__tag--dur">${durationMin}</span>
                        <span class="mt-card__tag" style="font-size:10px;color:var(--gray-500)">${clip.orientation || 'portrait'}</span>
                        ${sizeMb ? `<span class="mt-card__tag" style="font-size:10px;color:var(--gray-500)">${sizeMb}</span>` : ''}
                        ${!isActive ? '<span class="mt-card__tag mt-card__tag--off">off</span>' : ''}
                    </div>
                </div>
            </div>
            <div class="mt-card__right">
                <div class="mt-card__actions">
                    <button class="mt-card__btn gameplay-clip__toggle" data-clip-id="${clip.id}" data-active="${isActive}" title="${isActive ? 'Disable' : 'Enable'}">
                        ${isActive ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'}
                    </button>
                    <button class="mt-card__btn mt-card__btn--danger gameplay-clip__delete" data-clip-id="${clip.id}" data-clip-name="${escapeHtml(clip.display_name)}" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// =====================================================
// EFFECTS CONFIG MODAL
// =====================================================
// SHARED: Build Preset Tab Bar for config modals
// =====================================================
