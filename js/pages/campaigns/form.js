// =====================================================
// CAMPAIGN FORM — Form controls, summary, config
// =====================================================

/** Maps connection platform IDs → campaign checkbox values + display info */
const PLATFORM_REGISTRY = {
    youtube:   { value: 'youtube_shorts',   label: 'YT',  icon: '<svg viewBox="0 0 24 24" fill="#FF0000" width="14" height="14"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><polygon fill="#FFF" points="9.545 15.568 15.818 12 9.545 8.432"/></svg>' },
    instagram: { value: 'instagram_reels',  label: 'IG',  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="#E4405F" stroke-width="2" width="14" height="14"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>' },
    facebook:  { value: 'facebook_reels',   label: 'FB',  icon: '<svg viewBox="0 0 24 24" fill="#1877F2" width="14" height="14"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>' },
    tiktok:    { value: 'tiktok',           label: 'TT',  icon: '<svg viewBox="0 0 24 24" fill="#00f2ea" width="14" height="14"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/></svg>' },
    threads:   { value: 'threads',          label: 'Th',  icon: '🧵' },
    twitter:   { value: 'twitter',          label: 'X',   icon: '<svg viewBox="0 0 24 24" fill="#fff" width="14" height="14"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' }
};

const CampaignForm = {

    /** Bind all form-related DOM elements */
    bindElements() {
        const s = CampaignState;
        s.els.videoCountInput     = document.getElementById('video-count');
        s.els.videoCountMinus     = document.getElementById('video-count-minus');
        s.els.videoCountPlus      = document.getElementById('video-count-plus');
        s.els.startDateInput      = document.getElementById('start-date');
        s.els.postsPerDaySelect   = document.getElementById('posts-per-day');
        s.els.platformCheckboxes  = document.querySelectorAll('input[name="platform"]');
        s.els.advancedModeCheckbox = document.getElementById('advanced-mode-checkbox');
        s.els.advancedSettings    = document.getElementById('advanced-settings');
        s.els.timeWindowInputs    = document.querySelectorAll('.cp-time-input');
        s.els.jitterInput         = document.getElementById('jitter-minutes');
        s.els.platformOffsetInput = document.getElementById('platform-offset');
        s.els.presetWeightsContainer = document.getElementById('preset-weights');
        s.els.summaryVideoCount   = document.getElementById('summary-video-count');
        s.els.summaryDays         = document.getElementById('summary-days');
        s.els.summaryPlatforms    = document.getElementById('summary-platforms');
        s.els.summaryTotalPosts   = document.getElementById('summary-total-posts');
        s.els.cancelBtn           = document.getElementById('btn-cancel');
        s.els.createCampaignBtn   = document.getElementById('btn-create-campaign');
        s.els.newCampaignBtn      = document.getElementById('btn-new-campaign');
        s.els.sceneCountInput     = document.getElementById('scene-count-override');
        s.els.sceneCountMinus     = document.getElementById('scene-count-minus');
        s.els.sceneCountPlus      = document.getElementById('scene-count-plus');
        s.els.asapModeCheckbox    = document.getElementById('asap-mode');
        s.els.brandEmoji          = document.getElementById('brand-emoji');
        s.els.brandName           = document.getElementById('brand-name');
        s.els.platformContainer   = document.getElementById('platform-pills-container');
    },

    /** Bind form event listeners */
    bindEvents() {
        const s = CampaignState;
        const e = s.els;

        e.advancedModeCheckbox?.addEventListener('change', (ev) => {
            CampaignForm.toggleAdvancedMode(ev.target.checked);
        });

        e.videoCountMinus?.addEventListener('click', () => {
            const cur = parseInt(e.videoCountInput.value) || 1;
            if (cur > 1) { e.videoCountInput.value = cur - 1; CampaignForm.onFormChange(); }
        });
        e.videoCountPlus?.addEventListener('click', () => {
            const cur = parseInt(e.videoCountInput.value) || 1;
            if (cur < 30) { e.videoCountInput.value = cur + 1; CampaignForm.onFormChange(); }
        });
        e.sceneCountMinus?.addEventListener('click', () => {
            const cur = parseInt(e.sceneCountInput.value) || 0;
            if (cur > 0) e.sceneCountInput.value = cur - 1;
        });
        e.sceneCountPlus?.addEventListener('click', () => {
            const cur = parseInt(e.sceneCountInput.value) || 0;
            if (cur < 30) e.sceneCountInput.value = cur + 1;
        });

        e.videoCountInput?.addEventListener('change', () => CampaignForm.onFormChange());
        e.startDateInput?.addEventListener('change', () => CampaignForm.onFormChange());
        e.postsPerDaySelect?.addEventListener('change', () => CampaignForm.onFormChange());

        e.platformCheckboxes.forEach(cb => {
            cb.addEventListener('change', () => CampaignForm.onFormChange());
        });

        e.timeWindowInputs.forEach(input => {
            input.addEventListener('change', () => CampaignForm.onFormChange());
        });

        e.jitterInput?.addEventListener('change', () => CampaignForm.onFormChange());
        e.platformOffsetInput?.addEventListener('change', () => CampaignForm.onFormChange());
        e.asapModeCheckbox?.addEventListener('change', () => CampaignForm.onFormChange());

        e.cancelBtn?.addEventListener('click', () => CampaignForm.cancel());
        e.createCampaignBtn?.addEventListener('click', () => CampaignForm.createCampaign());
        e.newCampaignBtn?.addEventListener('click', () => CampaignForm.showCreateForm());
    },

    /** Render platform pills based on brand's connected platforms */
    async renderPlatforms() {
        const container = CampaignState.els.platformContainer;
        if (!container) return;

        const brand = CampaignState.currentBrand;
        let connected = brand?.connectedPlatforms || [];

        // If in-memory list is empty, check platform_tokens via brandManager
        if (connected.length === 0 && brand?.id && typeof brandManager !== 'undefined') {
            try {
                const creds = await brandManager.getAllCredentials(brand.id);
                connected = creds
                    .filter(c => c.is_connected)
                    .map(c => c.platform);
            } catch (e) {
                console.warn('Could not fetch platform credentials:', e);
            }
        }

        if (connected.length === 0) {
            container.innerHTML = '<span class="text-[10px] text-gray-500 italic">No platforms connected — <a href="connections.html" class="text-brand underline">connect one</a></span>';
            CampaignState.els.platformCheckboxes = document.querySelectorAll('input[name="platform"]');
            CampaignForm.onFormChange();
            return;
        }

        container.innerHTML = connected.map(pid => {
            const p = PLATFORM_REGISTRY[pid];
            if (!p) return '';
            return '<label class="cp-platform-pill">' +
                '<input type="checkbox" name="platform" value="' + p.value + '" checked>' +
                '<span class="cp-platform-pill__chip">' + p.icon + ' ' + p.label + '</span>' +
            '</label>';
        }).join('');

        // Re-bind checkbox references and events
        CampaignState.els.platformCheckboxes = document.querySelectorAll('input[name="platform"]');
        CampaignState.els.platformCheckboxes.forEach(cb => {
            cb.addEventListener('change', () => CampaignForm.onFormChange());
        });
        CampaignForm.onFormChange();
    },

    /** Set form defaults */
    initializeFormDefaults() {
        const s = CampaignState;
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        s.els.startDateInput.value = tomorrow.toISOString().split('T')[0];
        s.els.videoCountInput.value = s.defaultConfig.videoCount;
        s.els.postsPerDaySelect.value = s.defaultConfig.postsPerDay;
    },

    /** Toggle advanced settings panel */
    toggleAdvancedMode(enabled) {
        CampaignState.isAdvancedMode = enabled;
        const panel = CampaignState.els.advancedSettings;
        if (enabled) {
            panel?.classList.remove('hidden');
        } else {

            panel?.classList.add('hidden');
        }
        // Re-render weights so sliders enable/disable
        CampaignPresets.renderPresetWeights();
    },

    /** Debounced form change handler */
    onFormChange() {
        clearTimeout(CampaignState.debounceTimer);
        CampaignState.debounceTimer = setTimeout(() => {
            CampaignForm.updateSummary();
            CampaignSchedule.refreshSchedulePreview();
        }, 300);
    },

    /** Update the 4 summary stats */
    updateSummary() {
        const s = CampaignState;
        const videoCount = parseInt(s.els.videoCountInput.value) || 1;
        const platforms = CampaignForm.getSelectedPlatforms();
        const postsPerDay = parseInt(s.els.postsPerDaySelect.value) || 3;
        const days = Math.ceil(videoCount / postsPerDay);
        const totalPosts = videoCount * platforms.length;

        if (s.els.summaryVideoCount) s.els.summaryVideoCount.textContent = videoCount;
        if (s.els.summaryDays)       s.els.summaryDays.textContent = days;
        if (s.els.summaryPlatforms)  s.els.summaryPlatforms.textContent = platforms.length;
        if (s.els.summaryTotalPosts) s.els.summaryTotalPosts.textContent = totalPosts;
    },

    /** Get selected platform values */
    getSelectedPlatforms() {
        const selected = [];
        CampaignState.els.platformCheckboxes.forEach(cb => {
            if (cb.checked) selected.push(cb.value);
        });
        return selected;
    },

    /** Get time window values */
    getTimeWindows() {
        const windows = [];
        CampaignState.els.timeWindowInputs.forEach(input => {
            windows.push(input.value);
        });
        return windows;
    },

    /** Collect all form values into a config object */
    getFormConfig() {
        const s = CampaignState;
        return {
            brandId: s.currentBrand?.id,
            videoCount: parseInt(s.els.videoCountInput.value) || 1,
            platforms: CampaignForm.getSelectedPlatforms(),
            startDate: s.els.startDateInput.value,
            postsPerDay: parseInt(s.els.postsPerDaySelect.value) || 3,
            sceneCount: parseInt(s.els.sceneCountInput?.value) || 0,
            windows: CampaignForm.getTimeWindows(),
            jitterMinutes: parseInt(s.els.jitterInput?.value) || 15,
            platformOffsetMinutes: parseInt(s.els.platformOffsetInput?.value) || 5,
            presetWeights: s.presetWeights,
            asapMode: s.els.asapModeCheckbox?.checked || false
        };
    },

    /** Apply a config object to form fields */
    applyConfigToForm(config) {
        if (!config) return;
        const e = CampaignState.els;
        if (config.videoCount && e.videoCountInput) e.videoCountInput.value = config.videoCount;
        if (config.postsPerDay && e.postsPerDaySelect) e.postsPerDaySelect.value = config.postsPerDay;
        if (config.platforms && e.platformCheckboxes) {
            e.platformCheckboxes.forEach(cb => { cb.checked = config.platforms.includes(cb.value); });
        }
        if (config.sceneCount !== undefined && e.sceneCountInput) e.sceneCountInput.value = config.sceneCount;
        if (config.asapMode !== undefined && e.asapModeCheckbox) e.asapModeCheckbox.checked = config.asapMode;
        if (config.windows && e.timeWindowInputs) {
            config.windows.forEach((w, i) => { if (e.timeWindowInputs[i]) e.timeWindowInputs[i].value = w; });
        }
        if (config.jitterMinutes !== undefined && e.jitterInput) e.jitterInput.value = config.jitterMinutes;
        if (config.platformOffsetMinutes !== undefined && e.platformOffsetInput) e.platformOffsetInput.value = config.platformOffsetMinutes;
        CampaignForm.onFormChange();
    },

    /** Check sessionStorage for cloned campaign config */
    applyClonedConfig() {
        try {
            const raw = sessionStorage.getItem('cloneCampaignConfig');
            if (!raw) return;
            sessionStorage.removeItem('cloneCampaignConfig');
            const config = JSON.parse(raw);
            CampaignForm.applyConfigToForm(config);
            CampaignForm.showToast('Cloned campaign config loaded — adjust and create!', 'info');
        } catch (e) {
            console.error('applyClonedConfig:', e);
        }
    },

    /** Show create form, hide campaigns list */
    showCreateForm() {
        const e = CampaignState.els;
        e.campaignsListSection?.classList.add('hidden');
        e.campaignForm?.classList.remove('hidden');
        e.presetGallery?.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    /** Cancel creation, return to campaigns list */
    cancel() {
        const e = CampaignState.els;
        e.campaignForm?.classList.add('hidden');
        e.presetGallery?.classList.add('hidden');
        e.campaignsListSection?.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    /** Create the campaign */
    async createCampaign() {
        const s = CampaignState;
        if (!s.currentBrand?.id) {
            CampaignForm.showToast('Please select a brand first', 'error');
            return;
        }

        const config = CampaignForm.getFormConfig();

        if (config.platforms.length === 0) {
            CampaignForm.showToast('Please select at least one platform', 'error');
            return;
        }
        if (!config.startDate) {
            CampaignForm.showToast('Please select a start date', 'error');
            return;
        }

        const btn = s.els.createCampaignBtn;
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:18px;height:18px;"></div> Creating...';

        try {
            let campaign;
            if (typeof campaignManager !== 'undefined') {
                campaign = await campaignManager.createCampaign({
                    brandId: config.brandId,
                    videoCount: config.videoCount,
                    platforms: config.platforms,
                    startDate: config.startDate,
                    postsPerDay: config.postsPerDay,
                    precomputedSchedule: s.schedulePreview || null,
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

            CampaignForm.showToast('Campaign created successfully!', 'success');
            const campaignId = campaign.campaignId || campaign.id;
            setTimeout(() => {
                window.location.href = 'campaign-detail.html?id=' + encodeURIComponent(campaignId);
            }, 1000);
        } catch (error) {
            console.error('Failed to create campaign:', error);
            CampaignForm.showToast('Failed to create campaign: ' + error.message, 'error');
            btn.disabled = false;
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Launch Campaign';
        }
    },

    /** Show toast notification */
    showToast(message, type) {
        if (typeof toast !== 'undefined') {
            (toast[type] || toast.show).call(toast, message, type);
        } else {
            console.log('[' + type.toUpperCase() + '] ' + message);
            alert(message);
        }
    }
};
