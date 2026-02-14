// =====================================================
// CAMPAIGN PAGE CONTROLLER
// Campaign creation interface with auto/advanced modes
// =====================================================

/**
 * Preset metadata for the gallery
 * Each preset has: id, name, icon, tagline, description, defaults, visual theme
 */
const PRESET_CATALOG = {
    urban_legend: {
        id: 'urban_legend',
        name: 'Urban Legend',
        icon: '📜',
        tagline: 'Documentary folklore',
        description: 'Classic creepypasta with authority denial, repeating motifs, and ambiguous endings. Stories feel like suppressed local news — the kind whispered about at gas stations late at night.',
        defaults: {
            vibe_preset: 'urban_legend',
            era: '1990s',
            tone: 0.6,
            ending: 'unresolved',
            visual_style: 'VHS_degraded',
            color_palette: 'sickly_green',
            motion_profile: 'micro_jitter'
        },
        visual: {
            gradient: 'linear-gradient(145deg, #1a2a1a 0%, #0d1f0d 30%, #2d1b00 70%, #0a0a0a 100%)',
            overlay: 'radial-gradient(ellipse at 30% 80%, rgba(34, 197, 94, 0.15), transparent 60%)',
            accentColor: '#22c55e',
            accentBg: 'rgba(34, 197, 94, 0.15)',
            artStyle: 'VHS Degraded',
            colorPalette: 'Sickly Green',
            motionProfile: 'Micro Jitter'
        },
        details: {
            era: '1990s',
            ending: 'Unresolved',
            effects: ['Strong edge vignette', 'Subtle film grain', 'Cool night tones', 'Moderate Ken Burns'],
            bestFor: 'Folklore retellings, "based on true events" stories, small-town mysteries',
            exampleHook: '"In 1997, a gas station attendant in rural Ohio started keeping a logbook..."'
        }
    },
    one_too_many: {
        id: 'one_too_many',
        name: 'One Too Many',
        icon: '👥',
        tagline: 'Counting horror',
        description: 'N friends went on a trip... but the photo shows N+1. The extra person is never explained. Stories exploit the uncanny valley of group dynamics.',
        defaults: {
            vibe_preset: 'one_too_many',
            era: 'modern',
            tone: 0.7,
            ending: 'unresolved',
            art_style: 'uncanny-illustrated',
            visual_style: 'documentary',
            color_palette: 'cold_blue',
            motion_profile: 'static_tension'
        },
        visual: {
            gradient: 'linear-gradient(145deg, #0c1929 0%, #1a0a2e 40%, #0d1b2a 70%, #050510 100%)',
            overlay: 'radial-gradient(ellipse at 70% 20%, rgba(99, 102, 241, 0.2), transparent 60%)',
            accentColor: '#6366f1',
            accentBg: 'rgba(99, 102, 241, 0.15)',
            artStyle: 'Uncanny Illustrated',
            colorPalette: 'Cold Blue',
            motionProfile: 'Static Tension'
        },
        details: {
            era: 'Modern',
            ending: 'Unresolved',
            effects: ['Uncanny illustration style', 'Cold blue grading', 'Static tension motion', 'Documentary feel'],
            bestFor: 'Group photos gone wrong, counting anomalies, "who is the extra person" mysteries',
            exampleHook: '"Six of us went camping that weekend. But when we got the photos developed..."'
        }
    },
    custom: {
        id: 'custom',
        name: 'Custom DNA',
        icon: '🧬',
        tagline: 'Full control',
        description: 'Advanced users only. Define your own visual DNA parameters — art style, color palette, motion profile, era, and ending type.',
        defaults: {},
        visual: {
            gradient: 'linear-gradient(145deg, #1a1a2e 0%, #16213e 40%, #0f3460 70%, #1a1a2e 100%)',
            overlay: 'radial-gradient(ellipse at 50% 50%, rgba(139, 92, 246, 0.15), transparent 60%)',
            accentColor: '#8b5cf6',
            accentBg: 'rgba(139, 92, 246, 0.15)',
            artStyle: 'User Defined',
            colorPalette: 'User Defined',
            motionProfile: 'User Defined'
        },
        details: {
            era: 'Any',
            ending: 'Any',
            effects: ['Fully customizable effect stack'],
            bestFor: 'Experienced creators who want complete narrative and visual control',
            exampleHook: '"Your story, your rules."'
        }
    },
    reddit_trending_horror: {
        id: 'reddit_trending_horror',
        name: 'Reddit Trending Horror',
        icon: '🔥',
        tagline: 'Internet nightmares retold',
        description: 'Pulls trending horror posts from Reddit (r/nosleep, r/creepypasta, r/letsnotmeet, etc.), extracts the core fear concept, and transforms them into original 60–90 second animated horror scripts. No copying — cinematic retellings that feel like chilling animated shorts.',
        defaults: {
            vibe_preset: 'reddit_trending_horror',
            era: 'modern',
            tone: 0.65,
            ending: 'unresolved',
            visual_style: 'cinematic_dark',
            color_palette: 'muted_forest',
            motion_profile: 'subtle_kenburns'
        },
        visual: {
            gradient: 'linear-gradient(145deg, #0d1f0d 0%, #1a0f0a 30%, #0a1a0a 60%, #050a05 100%)',
            overlay: 'radial-gradient(ellipse at 40% 70%, rgba(239, 68, 68, 0.20), transparent 60%)',
            accentColor: '#ef4444',
            accentBg: 'rgba(239, 68, 68, 0.15)',
            artStyle: 'Uncanny Illustrated Horror',
            colorPalette: 'Muted Forest',
            motionProfile: 'Subtle Ken Burns'
        },
        details: {
            era: 'Modern',
            ending: 'Unresolved',
            effects: ['Subtle Ken Burns zoom', 'Light vignette', 'Minimal film grain', 'Cool color grade'],
            bestFor: 'Reddit-sourced horror retellings, internet creepypasta adaptations, viral horror shorts',
            exampleHook: '"The post had 4,000 upvotes. The comments were all begging OP to move out immediately."'
        }
    }
};

/**
 * Campaign Page Controller
 * Handles campaign creation UI, schedule preview, and form submission
 */
class CampaignPage {
    constructor() {
        this.currentBrand = null;
        this.presetWeights = {};
        this.brandPresets = [];
        this.presetWeightsDirty = false;
        this.schedulePreview = [];
        this.debounceTimer = null;
        this.isAdvancedMode = false;
        
        // Default config (per CAMPAIGN_SYSTEM.md Section 5)
        this.defaultConfig = {
            videoCount: 7,
            platforms: ['youtube_shorts', 'instagram_reels', 'facebook_reels'],
            postsPerDay: 3,
            windows: [
                { time: '08:00', label: 'Morning' },
                { time: '12:00', label: 'Midday' },
                { time: '18:00', label: 'Evening' }
            ],
            jitterMinutes: 15,
            platformOffsetMinutes: 5
        };
    }

    /**
     * Initialize the page
     */
    async init() {
        console.log('📅 Initializing Campaign Page');
        
        // Wait for brand manager to load
        if (typeof brandManager !== 'undefined') {
            await brandManager.init();
        }
        
        this.bindElements();
        this.bindEvents();
        this.initializeFormDefaults();
        
        // Check for active brand
        const activeBrand = this.getActiveBrand();
        if (activeBrand) {
            await this.loadBrand(activeBrand);
        } else {
            this.showNoBrandState();
        }
        
        // Load existing campaigns
        await this.loadCampaignsList();
    }

    /**
     * Bind DOM elements
     */
    bindElements() {
        // States
        this.loadingState = document.getElementById('loading-state');
        this.noBrandState = document.getElementById('no-brand-state');
        this.campaignForm = document.getElementById('campaign-form');
        this.campaignsListSection = document.getElementById('campaigns-list');
        
        // Preset gallery
        this.presetGallery = document.getElementById('preset-gallery');
        this.presetGalleryGrid = document.getElementById('preset-gallery-grid');
        this.presetDetailModal = document.getElementById('preset-detail-modal');
        this.presetModalContent = document.getElementById('preset-modal-content');
        this.presetModalClose = document.getElementById('preset-modal-close');
        
        // Brand display
        this.brandEmoji = document.getElementById('brand-emoji');
        this.brandName = document.getElementById('brand-name');
        
        // Basic form inputs
        this.videoCountInput = document.getElementById('video-count');
        this.videoCountMinus = document.getElementById('video-count-minus');
        this.videoCountPlus = document.getElementById('video-count-plus');
        this.startDateInput = document.getElementById('start-date');
        this.postsPerDaySelect = document.getElementById('posts-per-day');
        this.platformCheckboxes = document.querySelectorAll('input[name="platform"]');
        
        // Advanced settings
        this.advancedModeCheckbox = document.getElementById('advanced-mode-checkbox');
        this.advancedSettings = document.getElementById('advanced-settings');
        this.timeWindowInputs = document.querySelectorAll('.input--time');
        this.jitterInput = document.getElementById('jitter-minutes');
        this.platformOffsetInput = document.getElementById('platform-offset');
        this.presetWeightsContainer = document.getElementById('preset-weights');
        
        // Summary
        this.summaryVideoCount = document.getElementById('summary-video-count');
        this.summaryDays = document.getElementById('summary-days');
        this.summaryPlatforms = document.getElementById('summary-platforms');
        this.summaryTotalPosts = document.getElementById('summary-total-posts');
        
        // Schedule preview
        this.schedulePreviewContent = document.getElementById('schedule-preview-content');
        this.refreshPreviewBtn = document.getElementById('refresh-preview');
        
        // Actions
        this.cancelBtn = document.getElementById('btn-cancel');
        this.createCampaignBtn = document.getElementById('btn-create-campaign');
        this.newCampaignBtn = document.getElementById('btn-new-campaign');
        
        // Scene count override
        this.sceneCountInput = document.getElementById('scene-count-override');
        this.sceneCountMinus = document.getElementById('scene-count-minus');
        this.sceneCountPlus = document.getElementById('scene-count-plus');

        // ASAP test mode
        this.asapModeCheckbox = document.getElementById('asap-mode');
        
        // Campaigns list
        this.campaignsTbody = document.getElementById('campaigns-tbody');
        this.noCampaignsMsg = document.getElementById('no-campaigns');
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Advanced mode toggle
        this.advancedModeCheckbox?.addEventListener('change', (e) => {
            this.toggleAdvancedMode(e.target.checked);
        });
        
        // Video count +/- buttons
        this.videoCountMinus?.addEventListener('click', () => {
            const current = parseInt(this.videoCountInput.value) || 1;
            if (current > 1) {
                this.videoCountInput.value = current - 1;
                this.onFormChange();
            }
        });
        
        this.videoCountPlus?.addEventListener('click', () => {
            const current = parseInt(this.videoCountInput.value) || 1;
            if (current < 30) {
                this.videoCountInput.value = current + 1;
                this.onFormChange();
            }
        });
        
        // Scene count +/- buttons
        this.sceneCountMinus?.addEventListener('click', () => {
            const current = parseInt(this.sceneCountInput.value) || 0;
            if (current > 0) {
                this.sceneCountInput.value = current - 1;
            }
        });
        
        this.sceneCountPlus?.addEventListener('click', () => {
            const current = parseInt(this.sceneCountInput.value) || 0;
            if (current < 30) {
                this.sceneCountInput.value = current + 1;
            }
        });
        
        // Form inputs
        this.videoCountInput?.addEventListener('change', () => this.onFormChange());
        this.startDateInput?.addEventListener('change', () => this.onFormChange());
        this.postsPerDaySelect?.addEventListener('change', () => this.onFormChange());
        
        this.platformCheckboxes.forEach(cb => {
            cb.addEventListener('change', () => this.onFormChange());
        });
        
        // Advanced inputs
        this.timeWindowInputs.forEach(input => {
            input.addEventListener('change', () => this.onFormChange());
        });
        
        this.jitterInput?.addEventListener('change', () => this.onFormChange());
        this.platformOffsetInput?.addEventListener('change', () => this.onFormChange());
        this.asapModeCheckbox?.addEventListener('change', () => this.onFormChange());
        
        // Actions
        this.refreshPreviewBtn?.addEventListener('click', () => this.refreshSchedulePreview());
        this.cancelBtn?.addEventListener('click', () => this.cancel());
        this.createCampaignBtn?.addEventListener('click', () => this.createCampaign());
        this.newCampaignBtn?.addEventListener('click', () => this.showCreateForm());
        
        // Preset gallery click
        this.presetGalleryGrid?.addEventListener('click', (e) => {
            const card = e.target.closest('.preset-card');
            if (card) {
                const presetId = card.dataset.preset;
                this.showPresetDetail(presetId);
            }
        });
        
        // Preset modal close
        this.presetModalClose?.addEventListener('click', () => this.closePresetModal());
        this.presetDetailModal?.querySelector('.preset-modal__overlay')?.addEventListener('click', () => this.closePresetModal());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closePresetModal();
        });
        
        // Listen for brand changes
        if (typeof brandManager !== 'undefined') {
            brandManager.on('brand:activated', (brand) => this.loadBrand(brand));
        }
    }

    /**
     * Initialize form with defaults
     */
    initializeFormDefaults() {
        // Set default start date to tomorrow
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        this.startDateInput.value = tomorrow.toISOString().split('T')[0];
        
        // Set default video count
        this.videoCountInput.value = this.defaultConfig.videoCount;
        
        // Set default posts per day
        this.postsPerDaySelect.value = this.defaultConfig.postsPerDay;
    }

    /**
     * Get the active brand from brand manager
     */
    getActiveBrand() {
        if (typeof brandManager !== 'undefined') {
            // Use getActiveBrand() to get the selected brand (not getActive() which returns all brands with status=active)
            return brandManager.getActiveBrand();
        }
        return null;
    }

    /**
     * Load brand data and show form
     */
    async loadBrand(brand) {
        // Guard against undefined/null brand
        if (!brand || !brand.id) {
            console.log('🏷️ No valid brand to load, showing no-brand state');
            this.showNoBrandState();
            return;
        }
        
        console.log('🏷️ Loading brand:', brand.name);
        this.currentBrand = brand;
        
        // Update brand display
        this.brandEmoji.textContent = brand?.emoji || '👻';
        this.brandName.textContent = brand?.name || 'Unknown Brand';
        
        // Load preset weights from DB
        await this.loadPresetWeights();
        
        // Show form and hide loading
        this.hideAllStates();
        this.presetGallery?.classList.remove('hidden');
        this.campaignForm.classList.remove('hidden');
        this.campaignsListSection.classList.remove('hidden');
        
        // Render preset gallery
        this.renderPresetGallery();
        
        // Generate initial preview
        this.onFormChange();
    }

    /**
     * Show no brand selected state
     */
    showNoBrandState() {
        this.hideAllStates();
        this.noBrandState.classList.remove('hidden');
    }

    /**
     * Hide all states
     */
    hideAllStates() {
        this.loadingState?.classList.add('hidden');
        this.noBrandState?.classList.add('hidden');
        this.campaignForm?.classList.add('hidden');
        this.campaignsListSection?.classList.add('hidden');
        this.presetGallery?.classList.add('hidden');
    }

    /**
     * Toggle advanced mode
     */
    toggleAdvancedMode(enabled) {
        this.isAdvancedMode = enabled;
        
        if (enabled) {
            this.advancedSettings.classList.remove('hidden');
        } else {
            this.advancedSettings.classList.add('hidden');
        }
        
        console.log(`⚙️ Advanced mode: ${enabled ? 'ON' : 'OFF'}`);
    }

    /**
     * Load preset weights from brand_templates
     */
    async loadPresetWeights() {
        if (!this.currentBrand?.id) {
            this.presetWeights = { urban_legend: 60, one_too_many: 40 };
            this.presetWeightsDirty = false;
            this.renderPresetWeights();
            return;
        }
        
        try {
            // Use brandManager to load full preset data (includes IDs for saving)
            if (typeof brandManager !== 'undefined') {
                this.brandPresets = await brandManager.getVibePresets(this.currentBrand.id);
                if (this.brandPresets && this.brandPresets.length > 0) {
                    // Weights are stored as integers (1-100); use directly
                    // If legacy decimals (<=1.0), convert to integer
                    this.presetWeights = {};
                    for (const p of this.brandPresets) {
                        const raw = parseFloat(p.weight) || 0;
                        this.presetWeights[p.template_type] = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
                    }
                    // Normalize so they sum to 100
                    const total = Object.values(this.presetWeights).reduce((a, b) => a + b, 0);
                    if (total > 0 && total !== 100) {
                        for (const key of Object.keys(this.presetWeights)) {
                            this.presetWeights[key] = Math.round((this.presetWeights[key] / total) * 100);
                        }
                    }
                } else {
                    this.brandPresets = [];
                    this.presetWeights = { urban_legend: 60, one_too_many: 40 };
                }
            } else {
                this.brandPresets = [];
                this.presetWeights = { urban_legend: 60, one_too_many: 40 };
            }
            
            this.presetWeightsDirty = false;
            this.renderPresetWeights();
        } catch (error) {
            console.error('Failed to load preset weights:', error);
            this.brandPresets = [];
            this.presetWeights = { urban_legend: 60, one_too_many: 40 };
            this.presetWeightsDirty = false;
            this.renderPresetWeights();
        }
    }

    /**
     * Render preset weight sliders
     */
    renderPresetWeights() {
        const container = this.presetWeightsContainer;
        if (!container) return;
        
        container.innerHTML = '';
        
        const presets = Object.entries(this.presetWeights);
        if (presets.length === 0) {
            container.innerHTML = '<div class="preset-weight-loading">No presets configured</div>';
            return;
        }
        
        presets.forEach(([preset, weight]) => {
            const item = document.createElement('div');
            item.className = 'preset-weight-item';
            item.innerHTML = `
                <div class="preset-weight-header">
                    <span class="preset-weight-name">${this.formatPresetName(preset)}</span>
                    <span class="preset-weight-value">${weight}%</span>
                </div>
                <input type="range" 
                    class="preset-weight-slider" 
                    data-preset="${preset}" 
                    min="0" max="100" 
                    value="${weight}"
                    ${this.isAdvancedMode ? '' : 'disabled'}>
            `;
            
            const slider = item.querySelector('.preset-weight-slider');
            const valueDisplay = item.querySelector('.preset-weight-value');
            
            slider.addEventListener('input', (e) => {
                valueDisplay.textContent = `${e.target.value}%`;
                this.presetWeights[preset] = parseInt(e.target.value);
                this.presetWeightsDirty = true;
                this.normalizePresetWeights(preset);
                this.onFormChange();
            });
            
            container.appendChild(item);
        });

        // Add "Save to Brand" button if in advanced mode and presets exist
        if (this.isAdvancedMode && presets.length > 0) {
            const saveRow = document.createElement('div');
            saveRow.className = 'preset-weight-save-row';
            saveRow.innerHTML = `
                <button class="btn btn--sm btn--secondary preset-weight-save-btn" id="save-weights-to-brand" ${!this.presetWeightsDirty ? 'disabled' : ''}>
                    Save to Brand
                </button>
                <span class="preset-weight-save-hint" id="save-weights-hint">
                    ${this.presetWeightsDirty ? 'Unsaved changes' : 'Weights match brand defaults'}
                </span>
            `;
            container.appendChild(saveRow);

            saveRow.querySelector('#save-weights-to-brand').addEventListener('click', () => this.saveWeightsToBrand());
        }
    }

    /**
     * Format preset name for display
     */
    formatPresetName(preset) {
        if (!preset) return 'Unknown';
        return preset.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    /**
     * Normalize preset weights to sum to 100
     */
    normalizePresetWeights(changedPreset) {
        const total = Object.values(this.presetWeights).reduce((a, b) => a + b, 0);
        if (total === 100) return;
        
        // Adjust other weights proportionally
        const otherPresets = Object.keys(this.presetWeights).filter(p => p !== changedPreset);
        const changedValue = this.presetWeights[changedPreset];
        const remainingWeight = 100 - changedValue;
        
        const otherTotal = otherPresets.reduce((a, p) => a + this.presetWeights[p], 0);
        
        if (otherTotal > 0) {
            otherPresets.forEach(p => {
                this.presetWeights[p] = Math.round((this.presetWeights[p] / otherTotal) * remainingWeight);
            });
        }
        
        // Re-render to show updated values
        this.renderPresetWeights();
    }

    /**
     * Save current preset weights back to brand_templates in DB
     */
    async saveWeightsToBrand() {
        if (!this.currentBrand?.id || !this.brandPresets?.length) return;

        const btn = document.getElementById('save-weights-to-brand');
        const hint = document.getElementById('save-weights-hint');

        try {
            if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

            // Save raw integer weights (1-100) directly
            const updates = this.brandPresets.map(p => ({
                id: p.id,
                weight: this.presetWeights[p.template_type] || 0
            }));

            await brandManager.updateVibePresetWeights(this.currentBrand.id, updates);
            this.presetWeightsDirty = false;

            if (hint) hint.textContent = 'Saved!';
            if (btn) { btn.textContent = 'Save to Brand'; btn.disabled = true; }

            // Show success toast if available
            if (typeof toast !== 'undefined') toast.success('Preset weights saved to brand');
        } catch (e) {
            console.error('Failed to save weights to brand:', e);
            if (hint) hint.textContent = 'Save failed: ' + e.message;
            if (btn) { btn.disabled = false; btn.textContent = 'Save to Brand'; }
            if (typeof toast !== 'undefined') toast.error('Failed to save weights');
        }
    }

    /**
     * Handle form changes - debounced
     */
    onFormChange() {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.updateSummary();
            this.refreshSchedulePreview();
        }, 300);
    }

    /**
     * Update the summary stats
     */
    updateSummary() {
        const videoCount = parseInt(this.videoCountInput.value) || 1;
        const platforms = this.getSelectedPlatforms();
        const postsPerDay = parseInt(this.postsPerDaySelect.value) || 3;
        
        // Calculate days needed
        const days = Math.ceil(videoCount / postsPerDay);
        
        // Total posts = videos × platforms
        const totalPosts = videoCount * platforms.length;
        
        this.summaryVideoCount.textContent = videoCount;
        this.summaryDays.textContent = days;
        this.summaryPlatforms.textContent = platforms.length;
        this.summaryTotalPosts.textContent = totalPosts;
    }

    /**
     * Get selected platforms
     */
    getSelectedPlatforms() {
        const selected = [];
        this.platformCheckboxes.forEach(cb => {
            if (cb.checked) selected.push(cb.value);
        });
        return selected;
    }

    /**
     * Get time windows from form
     */
    getTimeWindows() {
        const windows = [];
        this.timeWindowInputs.forEach(input => {
            windows.push(input.value);
        });
        return windows;
    }

    /**
     * Refresh schedule preview
     */
    async refreshSchedulePreview() {
        const content = this.schedulePreviewContent;
        if (!content) return;
        
        // Show loading
        content.innerHTML = `
            <div class="schedule-preview__loading">
                <div class="spinner"></div>
                <p>Generating schedule...</p>
            </div>
        `;
        
        try {
            const config = this.getFormConfig();
            
            // Generate preview using campaignManager
            if (typeof campaignManager !== 'undefined') {
                this.schedulePreview = await campaignManager.generateSchedulePreview(config);
            } else {
                // Fallback to simple preview
                this.schedulePreview = this.generateSimplePreview(config);
            }
            
            this.renderSchedulePreview();
        } catch (error) {
            console.error('Failed to generate schedule preview:', error);
            content.innerHTML = `
                <div class="schedule-preview__loading">
                    <p style="color: var(--color-error);">Failed to generate preview</p>
                </div>
            `;
        }
    }

    /**
     * Get form configuration
     */
    getFormConfig() {
        return {
            brandId: this.currentBrand?.id,
            videoCount: parseInt(this.videoCountInput.value) || 1,
            platforms: this.getSelectedPlatforms(),
            startDate: this.startDateInput.value,
            postsPerDay: parseInt(this.postsPerDaySelect.value) || 3,
            sceneCount: parseInt(this.sceneCountInput?.value) || 0,
            windows: this.getTimeWindows(),
            jitterMinutes: parseInt(this.jitterInput?.value) || 15,
            platformOffsetMinutes: parseInt(this.platformOffsetInput?.value) || 5,
            presetWeights: this.presetWeights,
            asapMode: this.asapModeCheckbox?.checked || false
        };
    }

    /**
     * Generate simple preview (fallback)
     */
    generateSimplePreview(config) {
        const preview = [];
        const startDate = new Date(config.startDate + 'T00:00:00');
        const weights = config.presetWeights || {};
        
        for (let i = 0; i < config.videoCount; i++) {
            const dayOffset = Math.floor(i / config.postsPerDay);
            const windowIndex = i % config.postsPerDay;
            
            const scheduledDate = new Date(startDate);
            scheduledDate.setDate(scheduledDate.getDate() + dayOffset);
            
            const [hours, minutes] = (config.windows[windowIndex] || '12:00').split(':');
            scheduledDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
            
            // Weighted random preset selection
            const preset = this._weightedRandomPreset(weights);
            
            preview.push({
                scheduledAt: scheduledDate.toISOString(),
                preset: preset,
                platforms: config.platforms
            });
        }
        
        return preview;
    }

    /**
     * Select a preset using weighted random (same algorithm as campaignManager)
     */
    _weightedRandomPreset(weights) {
        const entries = Object.entries(weights);
        if (entries.length === 0) return 'urban_legend';
        
        const totalWeight = entries.reduce((sum, [_, w]) => sum + w, 0);
        let roll = Math.random() * totalWeight;
        
        for (const [preset, weight] of entries) {
            roll -= weight;
            if (roll <= 0) return preset;
        }
        return entries[0][0];
    }

    /**
     * Render schedule preview
     */
    renderSchedulePreview() {
        const content = this.schedulePreviewContent;
        if (!content || !this.schedulePreview.length) {
            content.innerHTML = '<p style="padding: 20px; text-align: center; color: var(--color-text-secondary);">No items to preview</p>';
            return;
        }
        
        // Group by day (support both scheduledAt and scheduled_post_at)
        const grouped = {};
        this.schedulePreview.forEach(item => {
            const itemTime = item.scheduledAt || item.scheduled_post_at;
            const date = new Date(itemTime);
            const dateKey = date.toDateString();
            if (!grouped[dateKey]) grouped[dateKey] = [];
            grouped[dateKey].push(item);
        });
        
        let html = '';
        
        Object.entries(grouped).forEach(([dateKey, items]) => {
            // Support both scheduledAt and scheduled_post_at
            const firstItemTime = items[0].scheduledAt || items[0].scheduled_post_at;
            const date = new Date(firstItemTime);
            const formattedDate = date.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric'
            });
            
            html += `
                <div class="schedule-day">
                    <div class="schedule-day__header">${formattedDate}</div>
                    <div class="schedule-day__items">
            `;
            
            items.forEach(item => {
                const itemTime = item.scheduledAt || item.scheduled_post_at;
                const time = new Date(itemTime).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                });
                
                const platformSvgs = {
                    youtube_shorts: { icon: `<svg viewBox="0 0 24 24" fill="#FF0000" width="14" height="14"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><polygon fill="#FFF" points="9.545 15.568 15.818 12 9.545 8.432"/></svg>`, label: 'YouTube Shorts' },
                    youtube: { icon: `<svg viewBox="0 0 24 24" fill="#FF0000" width="14" height="14"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><polygon fill="#FFF" points="9.545 15.568 15.818 12 9.545 8.432"/></svg>`, label: 'YouTube' },
                    tiktok: { icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/></svg>`, label: 'TikTok' },
                    instagram_reels: { icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#E4405F" stroke-width="2" width="14" height="14"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`, label: 'Instagram Reels' },
                    instagram: { icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#E4405F" stroke-width="2" width="14" height="14"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`, label: 'Instagram' },
                    facebook_reels: { icon: `<svg viewBox="0 0 24 24" fill="#1877F2" width="14" height="14"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`, label: 'Facebook Reels' },
                    facebook: { icon: `<svg viewBox="0 0 24 24" fill="#1877F2" width="14" height="14"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`, label: 'Facebook' }
                };
                
                const platformsHtml = (item.platforms || []).map(p => {
                    const info = platformSvgs[p];
                    if (info) {
                        return `<span class="platform-icon active" title="${info.label}">${info.icon}</span>`;
                    }
                    return `<span class="platform-icon active" title="${p}">📺</span>`;
                }).join('');
                
                // Support both preset and vibe_preset property names
                const presetName = item.preset || item.vibe_preset;
                
                html += `
                    <div class="schedule-item">
                        <span class="schedule-item__time">${time}</span>
                        <span class="schedule-item__preset">${this.formatPresetName(presetName)}</span>
                        <span class="schedule-item__platforms">${platformsHtml}</span>
                    </div>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        });
        
        content.innerHTML = html;
    }

    /**
     * Show create form (hide list)
     */
    showCreateForm() {
        // Already showing form, just scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ==================== Preset Gallery ====================

    /**
     * Render the preset gallery cards
     */
    renderPresetGallery() {
        const grid = this.presetGalleryGrid;
        if (!grid) return;

        // Get active presets from weight data (or defaults)
        const activePresets = Object.keys(this.presetWeights);
        
        // Build cards for all presets in catalog
        const presetIds = Object.keys(PRESET_CATALOG);
        
        grid.innerHTML = presetIds.map(id => {
            const preset = PRESET_CATALOG[id];
            if (!preset) return '';
            
            const weight = this.presetWeights[id];
            const isActive = weight > 0;
            // Weights are already percentages (60, 40). Clamp to 0-100 as safety.
            const displayWeight = Math.min(100, Math.max(0, Math.round(weight || 0)));
            console.log(`[PRESET] ${id}: raw weight=${weight}, display=${displayWeight}%`);
            
            return `
                <div class="preset-card ${isActive ? 'preset-card--active' : ''}" 
                     data-preset="${id}" 
                     tabindex="0"
                     role="button"
                     aria-label="View ${preset.name} preset details">
                    <div class="preset-card__bg" style="background: ${preset.visual.gradient}">
                        <div class="preset-card__overlay" style="background: ${preset.visual.overlay}"></div>
                        <div class="preset-card__scanlines"></div>
                        <div class="preset-card__noise"></div>
                    </div>
                    <div class="preset-card__content">
                        <div class="preset-card__icon">${preset.icon}</div>
                        <h3 class="preset-card__name">${preset.name}</h3>
                        <p class="preset-card__tagline">${preset.tagline}</p>
                        ${isActive ? `<div class="preset-card__weight" style="color: ${preset.visual.accentColor}">${displayWeight}%</div>` : ''}
                    </div>
                    ${isActive ? `<div class="preset-card__active-indicator" style="background: ${preset.visual.accentColor}"></div>` : ''}
                </div>
            `;
        }).join('');
    }

    /**
     * Show preset detail modal
     */
    showPresetDetail(presetId) {
        const preset = PRESET_CATALOG[presetId];
        if (!preset || !this.presetDetailModal) return;

        const weight = this.presetWeights[presetId];
        const isActive = weight > 0;
        const displayWeight = Math.round(weight || 0);
        
        this.presetModalContent.innerHTML = `
            <div class="preset-detail">
                <!-- Header with background -->
                <div class="preset-detail__hero" style="background: ${preset.visual.gradient}">
                    <div class="preset-detail__hero-overlay" style="background: ${preset.visual.overlay}"></div>
                    <div class="preset-detail__hero-scanlines"></div>
                    <div class="preset-detail__hero-content">
                        <span class="preset-detail__icon">${preset.icon}</span>
                        <h2 class="preset-detail__name">${preset.name}</h2>
                        <span class="preset-detail__tagline">${preset.tagline}</span>
                        ${isActive ? `<span class="preset-detail__weight-badge" style="background: ${preset.visual.accentBg}; color: ${preset.visual.accentColor}">
                            Active · ${displayWeight}% weight
                        </span>` : `<span class="preset-detail__weight-badge preset-detail__weight-badge--inactive">Inactive</span>`}
                    </div>
                </div>

                <!-- Description -->
                <div class="preset-detail__section">
                    <p class="preset-detail__description">${preset.description}</p>
                </div>

                <!-- Visual DNA -->
                <div class="preset-detail__section">
                    <h4 class="preset-detail__section-title">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                        </svg>
                        Visual DNA
                    </h4>
                    <div class="preset-detail__dna-grid">
                        <div class="dna-item">
                            <span class="dna-item__label">Art Style</span>
                            <span class="dna-item__value" style="color: ${preset.visual.accentColor}">${preset.visual.artStyle}</span>
                        </div>
                        <div class="dna-item">
                            <span class="dna-item__label">Color Palette</span>
                            <span class="dna-item__value" style="color: ${preset.visual.accentColor}">${preset.visual.colorPalette}</span>
                        </div>
                        <div class="dna-item">
                            <span class="dna-item__label">Motion</span>
                            <span class="dna-item__value" style="color: ${preset.visual.accentColor}">${preset.visual.motionProfile}</span>
                        </div>
                        <div class="dna-item">
                            <span class="dna-item__label">Era</span>
                            <span class="dna-item__value" style="color: ${preset.visual.accentColor}">${preset.details.era}</span>
                        </div>
                        <div class="dna-item">
                            <span class="dna-item__label">Ending</span>
                            <span class="dna-item__value" style="color: ${preset.visual.accentColor}">${preset.details.ending}</span>
                        </div>
                    </div>
                </div>

                <!-- Effects Stack -->
                <div class="preset-detail__section">
                    <h4 class="preset-detail__section-title">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                        Effects Stack
                    </h4>
                    <div class="preset-detail__effects">
                        ${preset.details.effects.map(e => `
                            <span class="effect-tag" style="border-color: ${preset.visual.accentColor}40; color: ${preset.visual.accentColor}">
                                ${e}
                            </span>
                        `).join('')}
                    </div>
                </div>

                <!-- Best For -->
                <div class="preset-detail__section">
                    <h4 class="preset-detail__section-title">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                        Best For
                    </h4>
                    <p class="preset-detail__best-for">${preset.details.bestFor}</p>
                </div>

                <!-- Example Hook -->
                <div class="preset-detail__section preset-detail__section--hook">
                    <h4 class="preset-detail__section-title">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                        </svg>
                        Example Hook
                    </h4>
                    <blockquote class="preset-detail__hook" style="border-left-color: ${preset.visual.accentColor}">
                        ${preset.details.exampleHook}
                    </blockquote>
                </div>
            </div>
        `;

        this.presetDetailModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Close preset detail modal
     */
    closePresetModal() {
        this.presetDetailModal?.classList.remove('active');
        document.body.style.overflow = '';
    }

    /**
     * Cancel and go back
     */
    cancel() {
        window.location.href = 'campaign.html';
    }

    /**
     * Create the campaign
     */
    async createCampaign() {
        if (!this.currentBrand?.id) {
            this.showToast('Please select a brand first', 'error');
            return;
        }
        
        const config = this.getFormConfig();
        
        // Validate
        if (config.platforms.length === 0) {
            this.showToast('Please select at least one platform', 'error');
            return;
        }
        
        if (!config.startDate) {
            this.showToast('Please select a start date', 'error');
            return;
        }
        
        // Disable button and show loading
        this.createCampaignBtn.disabled = true;
        this.createCampaignBtn.innerHTML = `
            <div class="spinner" style="width: 18px; height: 18px;"></div>
            Creating...
        `;
        
        try {
            let campaign;
            
            if (typeof campaignManager !== 'undefined') {
                campaign = await campaignManager.createCampaign({
                    brandId: config.brandId,
                    videoCount: config.videoCount,
                    platforms: config.platforms,
                    startDate: config.startDate,
                    postsPerDay: config.postsPerDay,
                    precomputedSchedule: this.schedulePreview || null,
                    config: {
                        windows: config.windows,
                        jitterMinutes: config.jitterMinutes,
                        platformOffsetMinutes: config.platformOffsetMinutes,
                        presetWeights: config.presetWeights,
                        asapMode: config.asapMode,
                        sceneCount: config.sceneCount || 0
                    }
                });
            } else {
                throw new Error('Campaign manager not available');
            }
            
            this.showToast('Campaign created successfully!', 'success');
            
            // Navigate to campaign detail
            // campaign returns { campaignId, schedule }
            const campaignId = campaign.campaignId || campaign.id;
            setTimeout(() => {
                window.location.href = `campaign-detail.html?id=${campaignId}`;
            }, 1000);
            
        } catch (error) {
            console.error('Failed to create campaign:', error);
            this.showToast(`Failed to create campaign: ${error.message}`, 'error');
            
            // Re-enable button
            this.createCampaignBtn.disabled = false;
            this.createCampaignBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                Create Campaign
            `;
        }
    }

    /**
     * Load existing campaigns list
     */
    async loadCampaignsList() {
        if (!this.currentBrand?.id) return;
        
        try {
            let campaigns = [];
            
            if (typeof campaignManager !== 'undefined') {
                campaigns = await campaignManager.getCampaignsByBrand(this.currentBrand.id);
            }
            
            this.renderCampaignsList(campaigns);
        } catch (error) {
            console.error('Failed to load campaigns:', error);
        }
    }

    /**
     * Render campaigns list with enriched statistics
     */
    renderCampaignsList(campaigns) {
        if (!this.campaignsTbody) return;
        
        if (!campaigns || campaigns.length === 0) {
            this.campaignsTbody.innerHTML = '';
            this.noCampaignsMsg?.classList.remove('hidden');
            return;
        }
        
        this.noCampaignsMsg?.classList.add('hidden');
        
        // Status badge helper
        const statusBadge = (status) => {
            const statusConfig = {
                setup: { class: 'job-status--pending', icon: '⚙️', label: 'Setup' },
                stories: { class: 'job-status--pending', icon: '📖', label: 'Stories' },
                planned: { class: 'job-status--pending', icon: '📋', label: 'Planned' },
                active: { class: 'job-status--processing', icon: '▶️', label: 'Active' },
                generating: { class: 'job-status--processing', icon: '🔄', label: 'Generating' },
                reviewing: { class: 'job-status--processing', icon: '👁️', label: 'Reviewing' },
                scheduling: { class: 'job-status--processing', icon: '📅', label: 'Scheduling' },
                paused: { class: 'job-status--pending', icon: '⏸️', label: 'Paused' },
                completed: { class: 'job-status--completed', icon: '✅', label: 'Completed' },
                cancelled: { class: 'job-status--cancelled', icon: '❌', label: 'Cancelled' }
            };
            const config = statusConfig[status] || { class: '', icon: '❓', label: status };
            return `<span class="job-status ${config.class}">${config.icon} ${config.label}</span>`;
        };
        
        // Job stats helper - handles both RPC data and fallback data
        const jobStats = (c) => {
            // If using fallback (no RPC), we don't have job counts
            // Check if we have the enriched data
            const hasStats = c.total_jobs !== undefined;
            
            if (!hasStats) {
                // Fallback mode - just show video count as indicator
                return `<span class="stat-muted">${c.video_count || 0} planned</span>`;
            }
            
            const total = c.total_jobs || 0;
            const complete = c.complete_jobs || 0;
            const processing = c.processing_jobs || 0;
            const failed = c.failed_jobs || 0;
            
            if (total === 0) return `<span class="stat-muted">No jobs</span>`;
            
            const parts = [];
            if (complete > 0) parts.push(`<span class="stat-success">${complete}✓</span>`);
            if (processing > 0) parts.push(`<span class="stat-processing">${processing}⏳</span>`);
            if (failed > 0) parts.push(`<span class="stat-error">${failed}✗</span>`);
            
            const pending = total - complete - processing - failed;
            if (pending > 0) parts.push(`<span class="stat-muted">${pending}○</span>`);
            
            return `<div class="stats-inline">${parts.join(' ')}</div>`;
        };
        
        // Post stats helper  
        const postStats = (c) => {
            // If using fallback, we don't have post counts
            const hasStats = c.total_posts !== undefined;
            if (!hasStats) return `<span class="stat-muted">—</span>`;
            
            const published = c.published_posts || 0;
            const scheduled = c.scheduled_posts || 0;
            const queued = c.queued_posts || 0;
            const draft = c.draft_posts || 0;
            const failed = c.failed_posts || 0;
            const total = c.total_posts || 0;
            
            if (total === 0) return `<span class="stat-muted">—</span>`;
            
            const parts = [];
            if (published > 0) parts.push(`<span class="stat-success">${published}📤</span>`);
            if (scheduled > 0) parts.push(`<span class="stat-info">${scheduled}📅</span>`);
            if (queued > 0) parts.push(`<span class="stat-processing">${queued}🔜</span>`);
            if (draft > 0) parts.push(`<span class="stat-muted">${draft}📝</span>`);
            if (failed > 0) parts.push(`<span class="stat-error">${failed}✗</span>`);
            
            return `<div class="stats-inline">${parts.join(' ')}</div>`;
        };
        
        // Progress bar helper
        const progressBar = (c) => {
            // Check if we have enriched data
            const hasStats = c.total_jobs !== undefined;
            
            // Use progress_percent from RPC, or calculate from complete_jobs/total_jobs
            let percent = c.progress_percent || 0;
            if (!percent && hasStats && c.total_jobs > 0) {
                percent = Math.round(((c.complete_jobs || 0) / c.total_jobs) * 100);
            }
            
            // In fallback mode without stats, show placeholder
            if (!hasStats) {
                return `<span class="stat-muted">—</span>`;
            }
            
            const progressClass = percent >= 100 ? 'mini-progress--complete' :
                                  percent >= 50 ? 'mini-progress--half' : '';
            
            return `
                <div class="mini-progress ${progressClass}">
                    <div class="mini-progress__bar" style="width: ${percent}%"></div>
                </div>
                <span class="progress-label">${percent}%</span>
            `;
        };
        
        // Next scheduled helper
        const nextScheduled = (c) => {
            if (!c.next_scheduled_at) {
                if (c.status === 'completed') return `<span class="stat-muted">Done</span>`;
                return `<span class="stat-muted">—</span>`;
            }
            
            const next = new Date(c.next_scheduled_at);
            const now = new Date();
            const diffMs = next - now;
            const diffHours = Math.round(diffMs / (1000 * 60 * 60));
            
            if (diffHours < 0) {
                return `<span class="stat-warning">Overdue</span>`;
            } else if (diffHours < 1) {
                const diffMins = Math.round(diffMs / (1000 * 60));
                return `<span class="stat-info">${diffMins}m</span>`;
            } else if (diffHours < 24) {
                return `<span class="stat-info">${diffHours}h</span>`;
            } else {
                const diffDays = Math.round(diffHours / 24);
                return `<span class="stat-muted">${diffDays}d</span>`;
            }
        };
        
        this.campaignsTbody.innerHTML = campaigns.map(c => {
            const created = new Date(c.created_at).toLocaleDateString();
            
            return `
                <tr data-campaign-id="${c.id}" class="campaign-row campaign-row--${c.status}">
                    <td class="campaign-cell--name">
                        <a href="campaign-detail.html?id=${c.id}" class="campaign-link">
                            Campaign #${c.id.slice(0, 8)}
                        </a>
                        <div class="campaign-meta">
                            ${c.video_count || 0} videos • ${created}
                        </div>
                    </td>
                    <td class="campaign-cell--status">${statusBadge(c.status)}</td>
                    <td class="campaign-cell--jobs">${jobStats(c)}</td>
                    <td class="campaign-cell--posts">${postStats(c)}</td>
                    <td class="campaign-cell--progress">${progressBar(c)}</td>
                    <td class="campaign-cell--next">${nextScheduled(c)}</td>
                    <td class="campaign-cell--actions">
                        <a href="campaign-detail.html?id=${c.id}" class="btn btn--ghost btn--sm">View</a>
                    </td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        if (typeof toast !== 'undefined') {
            toast[type]?.(message) || toast.show?.(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
            alert(message);
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize brand switcher in navbar (matches other pages)
    const brandSwitcher = new BrandSwitcher({
        selector: '#brand-switcher'
    });
    brandSwitcher.init();
    
    // Initialize page controller
    window.campaignPage = new CampaignPage();
    window.campaignPage.init();
});
