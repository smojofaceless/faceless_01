// Brand create/edit/delete modal
// Extracted from brands.html inline script

function setupModal() {
    console.log('setupModal() called');
    const modal = document.getElementById('brand-modal');
    console.log('Modal element:', modal);
    
    // Move modal to body to ensure no parent constraints
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
        console.log('Modal moved to body');
    }
    
    const closeBtn = modal.querySelector('.modal__close');
    const cancelBtn = document.getElementById('modal-cancel');
    const saveBtn = document.getElementById('modal-save');
    const overlay = modal.querySelector('.modal__overlay');
    
    const createBtn = document.getElementById('create-brand-btn');
    console.log('Create brand button:', createBtn);
    
    if (createBtn) {
        createBtn.addEventListener('click', () => {
            console.log('Create brand button clicked!');
            openCreateModal();
        });
        console.log('Create brand button listener attached');
    } else {
        console.error('Create brand button not found!');
    }

    [closeBtn, cancelBtn, overlay].forEach(el => {
        if (el) el.addEventListener('click', closeModal);
    });

    if (saveBtn) saveBtn.addEventListener('click', saveBrand);
    
    // Auto-apply preset when niche is selected
    const nicheSelect = document.getElementById('brand-niche');
    if (nicheSelect) {
        nicheSelect.addEventListener('change', (e) => {
            const niche = e.target.value;
            if (THEME_PRESETS[niche]) {
                applyPreset(niche);
            }
        });
    }
}

function applyPreset(presetName) {
    const preset = THEME_PRESETS[presetName];
    if (!preset) return;
    
    document.getElementById('brand-primary').value = preset.primary;
    document.getElementById('brand-primary-text').value = preset.primary;
    document.getElementById('brand-secondary').value = preset.secondary;
    document.getElementById('brand-secondary-text').value = preset.secondary;
    document.getElementById('brand-accent').value = preset.accent;
    document.getElementById('brand-accent-text').value = preset.accent;
}

function setupColorInputs() {
    ['primary', 'secondary', 'accent'].forEach(color => {
        const picker = document.getElementById(`brand-${color}`);
        const text = document.getElementById(`brand-${color}-text`);

        picker.addEventListener('input', (e) => {
            text.value = e.target.value;
        });

        text.addEventListener('input', (e) => {
            if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                picker.value = e.target.value;
            }
        });
    });
}

function setupPresets() {
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const presetName = btn.dataset.preset;
            applyPreset(presetName);
            
            // Also set niche if preset matches a niche and niche isn't set
            const nicheSelect = document.getElementById('brand-niche');
            if (!nicheSelect.value && THEME_PRESETS[presetName]) {
                // Check if this preset name is a valid niche option
                const option = nicheSelect.querySelector(`option[value="${presetName}"]`);
                if (option) {
                    nicheSelect.value = presetName;
                }
            }
        });
    });
}

function openCreateModal() {
    console.log('openCreateModal() called');
    editingBrandId = null;
    document.getElementById('modal-title').textContent = 'Create Brand';
    document.getElementById('brand-form').reset();
    
    // Set default colors
    const defaults = THEME_PRESETS.tech; // Default neutral preset
    document.getElementById('brand-primary').value = defaults.primary;
    document.getElementById('brand-primary-text').value = defaults.primary;
    document.getElementById('brand-secondary').value = defaults.secondary;
    document.getElementById('brand-secondary-text').value = defaults.secondary;
    document.getElementById('brand-accent').value = defaults.accent;
    document.getElementById('brand-accent-text').value = defaults.accent;

    document.getElementById('brand-modal').classList.add('active');
}

function openEditModal(brand) {
    editingBrandId = brand.id;
    document.getElementById('modal-title').textContent = 'Edit Brand';

    document.getElementById('brand-name').value = brand.name;
    document.getElementById('brand-niche').value = brand.niche;
    document.getElementById('brand-description').value = brand.description || '';
    document.getElementById('brand-timezone').value = brand.settings?.timezone || 'America/New_York';
    document.getElementById('brand-max-posts').value = brand.settings?.postingConfig?.maxPostsPerDay || 3;

    document.getElementById('brand-primary').value = brand.theme.primaryColor;
    document.getElementById('brand-primary-text').value = brand.theme.primaryColor;
    document.getElementById('brand-secondary').value = brand.theme.secondaryColor;
    document.getElementById('brand-secondary-text').value = brand.theme.secondaryColor;
    document.getElementById('brand-accent').value = brand.theme.accentColor;
    document.getElementById('brand-accent-text').value = brand.theme.accentColor;

    document.getElementById('brand-modal').classList.add('active');
}

function closeModal() {
    document.getElementById('brand-modal').classList.remove('active');
    editingBrandId = null;
}

async function saveBrand() {
    const name = document.getElementById('brand-name').value.trim();
    const niche = document.getElementById('brand-niche').value;

    if (!name || !niche) {
        toast.error('Please fill in required fields');
        return;
    }

    const brandData = {
        name,
        niche,
        description: document.getElementById('brand-description').value.trim(),
        theme: {
            primaryColor: document.getElementById('brand-primary').value,
            secondaryColor: document.getElementById('brand-secondary').value,
            accentColor: document.getElementById('brand-accent').value
        },
        settings: {
            timezone: document.getElementById('brand-timezone').value,
            postingConfig: {
                maxPostsPerDay: parseInt(document.getElementById('brand-max-posts').value) || 3
            }
        }
    };

    try {
        if (editingBrandId) {
            await brandManager.update(editingBrandId, brandData);
            toast.success('Brand updated!');
        } else {
            await brandManager.create(brandData);
            toast.success('Brand created!');
        }

        closeModal();
        loadBrands();
    } catch (e) {
        console.error('Failed to save brand:', e);
        toast.error('Failed to save brand');
    }
}

async function deleteBrand(id) {
    const brand = brandManager.get(id);
    if (!brand) return;

    if (confirm(`Are you sure you want to delete "${brand.name}"? This cannot be undone.`)) {
        await brandManager.delete(id);
        loadBrands();
        toast.success('Brand deleted');
    }
}

// =====================================================
// MUSIC TRACKS MODAL
// =====================================================

