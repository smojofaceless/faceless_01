// =====================================================
// CAMPAIGN PAGE CONTROLLER
// Campaign creation interface with auto/advanced modes
// =====================================================

/**
 * Campaign Page Controller
 * Handles campaign creation UI, schedule preview, and form submission
 */
class CampaignPage {
    constructor() {
        this.currentBrand = null;
        this.presetWeights = {};
        this.schedulePreview = [];
        this.debounceTimer = null;
        this.isAdvancedMode = false;
        
        // Default config (per CAMPAIGN_SYSTEM.md Section 5)
        this.defaultConfig = {
            videoCount: 7,
            platforms: ['tiktok', 'reels', 'shorts'],
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
        this.campaignForm.classList.remove('hidden');
        this.campaignsListSection.classList.remove('hidden');
        
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
            this.renderPresetWeights();
            return;
        }
        
        try {
            // Use campaignManager to load weights
            if (typeof campaignManager !== 'undefined') {
                this.presetWeights = await campaignManager._loadPresetWeights(this.currentBrand.id);
            } else {
                // Fallback to defaults
                this.presetWeights = { urban_legend: 60, one_too_many: 40 };
            }
            
            this.renderPresetWeights();
        } catch (error) {
            console.error('Failed to load preset weights:', error);
            this.presetWeights = { urban_legend: 60, one_too_many: 40 };
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
                this.normalizePresetWeights(preset);
                this.onFormChange();
            });
            
            container.appendChild(item);
        });
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
        const presets = Object.keys(config.presetWeights);
        
        for (let i = 0; i < config.videoCount; i++) {
            const dayOffset = Math.floor(i / config.postsPerDay);
            const windowIndex = i % config.postsPerDay;
            
            const scheduledDate = new Date(startDate);
            scheduledDate.setDate(scheduledDate.getDate() + dayOffset);
            
            const [hours, minutes] = (config.windows[windowIndex] || '12:00').split(':');
            scheduledDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
            
            // Random preset selection
            const preset = presets[Math.floor(Math.random() * presets.length)];
            
            preview.push({
                scheduledAt: scheduledDate.toISOString(),
                preset: preset,
                platforms: config.platforms
            });
        }
        
        return preview;
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
                
                const platformIcons = {
                    tiktok: '🎵',
                    reels: '📱',
                    shorts: '▶️'
                };
                
                const platformsHtml = (item.platforms || []).map(p => 
                    `<span class="platform-icon active">${platformIcons[p] || '📺'}</span>`
                ).join('');
                
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
                    config: {
                        windows: config.windows,
                        jitterMinutes: config.jitterMinutes,
                        platformOffsetMinutes: config.platformOffsetMinutes,
                        presetWeights: config.presetWeights,
                        asapMode: config.asapMode
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
