// =====================================================
// CAMPAIGN PRESETS — Gallery, weights, AI suggestions
// =====================================================

const CampaignPresets = {

    /** Bind preset gallery DOM elements */
    bindElements() {
        const s = CampaignState;
        s.els.presetGallery     = document.getElementById('preset-gallery');
        s.els.presetGalleryGrid = document.getElementById('preset-gallery-grid');
    },

    /** Bind preset gallery events */
    bindEvents() {
        const s = CampaignState;
        s.els.presetGalleryGrid?.addEventListener('click', (e) => {
            const card = e.target.closest('.cp-preset-card');
            if (card) CampaignModal.showPresetDetail(card.dataset.preset);
        });
    },

    /** Get brand catalog key from current brand slug */
    getBrandCatalogKey() {
        if (!CampaignState.currentBrand) return null;
        const slug = CampaignState.currentBrand.slug || '';
        return BRAND_SLUG_MAP[slug] || slug.replace(/-/g, '_');
    },

    /** Format preset name: "urban_legend" -> "Urban Legend" */
    formatPresetName(preset) {
        if (!preset) return 'Unknown';
        return preset.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    },

    /** Load preset weights from brand_templates */
    async loadPresetWeights() {
        const s = CampaignState;
        if (!s.currentBrand?.id) {
            s.presetWeights = {};
            s.presetWeightsDirty = false;
            CampaignPresets.renderPresetWeights();
            return;
        }

        try {
            if (typeof brandManager !== 'undefined') {
                s.brandPresets = await brandManager.getVibePresets(s.currentBrand.id);
                if (s.brandPresets && s.brandPresets.length > 0) {
                    s.presetWeights = {};
                    for (const p of s.brandPresets) {
                        const raw = parseFloat(p.weight) || 0;
                        s.presetWeights[p.template_type] = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
                    }
                    const total = Object.values(s.presetWeights).reduce((a, b) => a + b, 0);
                    if (total > 0 && total !== 100) {
                        for (const key of Object.keys(s.presetWeights)) {
                            s.presetWeights[key] = Math.round((s.presetWeights[key] / total) * 100);
                        }
                    }
                } else {
                    s.brandPresets = [];
                    s.presetWeights = CampaignPresets._getDefaultPresetWeights();
                }
            } else {
                s.brandPresets = [];
                s.presetWeights = CampaignPresets._getDefaultPresetWeights();
            }
            s.presetWeightsDirty = false;
            CampaignPresets.renderPresetWeights();
        } catch (error) {
            console.error('Failed to load preset weights:', error);
            s.brandPresets = [];
            s.presetWeights = CampaignPresets._getDefaultPresetWeights();
            s.presetWeightsDirty = false;
            CampaignPresets.renderPresetWeights();
        }
    },

    /** Default weights fallback */
    _getDefaultPresetWeights() {
        const brandKey = CampaignPresets.getBrandCatalogKey();
        const brandPresets = Object.keys(PRESET_CATALOG).filter(
            id => PRESET_CATALOG[id].brand === brandKey
        );
        if (brandPresets.length > 0) {
            const w = Math.round(100 / brandPresets.length);
            const weights = {};
            brandPresets.forEach(id => { weights[id] = w; });
            return weights;
        }
        return { urban_legend: 60, one_too_many: 40 };
    },

    /** Render the horizontal preset carousel */
    renderPresetGallery() {
        const grid = CampaignState.els.presetGalleryGrid;
        if (!grid) return;

        const activePresets = Object.keys(CampaignState.presetWeights);
        const brandKey = CampaignPresets.getBrandCatalogKey();

        const presetIds = Object.keys(PRESET_CATALOG).filter(id => {
            const preset = PRESET_CATALOG[id];
            if (activePresets.includes(id)) return true;
            if (preset.brand === brandKey) return true;
            if (preset.brand === '_universal') return true;
            return false;
        });

        grid.innerHTML = presetIds.map(id => {
            const preset = PRESET_CATALOG[id];
            if (!preset) return '';

            const weight = CampaignState.presetWeights[id];
            const isActive = weight > 0;
            const displayWeight = Math.min(100, Math.max(0, Math.round(weight || 0)));

            return `
                <div class="cp-preset-card ${isActive ? 'cp-preset-card--active' : ''}"
                     data-preset="${id}" tabindex="0" role="button"
                     aria-label="View ${preset.name} preset details">
                    <div class="cp-preset-card__bg" style="background: ${preset.visual.gradient}">
                        <div class="cp-preset-card__overlay" style="background: ${preset.visual.overlay}"></div>
                        <div class="cp-preset-card__scanlines"></div>
                    </div>
                    <div class="cp-preset-card__body">
                        <span class="cp-preset-card__icon">${preset.icon}</span>
                        <h4 class="cp-preset-card__name">${preset.name}</h4>
                        <p class="cp-preset-card__tagline">${preset.tagline}</p>
                        ${isActive ? '<span class="cp-preset-card__weight" style="color:' + preset.visual.accentColor + '">' + displayWeight + '%</span>' : ''}
                    </div>
                    ${isActive ? '<div class="cp-preset-card__bar" style="background:' + preset.visual.accentColor + '"></div>' : ''}
                </div>
            `;
        }).join('');
    },

    /** Render weight sliders in advanced panel */
    renderPresetWeights() {
        const container = CampaignState.els.presetWeightsContainer;
        if (!container) return;

        container.innerHTML = '';
        const presets = Object.entries(CampaignState.presetWeights);
        if (presets.length === 0) {
            container.innerHTML = '<div class="cp-weight-empty">No presets configured</div>';
            return;
        }

        presets.forEach(([preset, weight]) => {
            const item = document.createElement('div');
            item.className = 'cp-weight-item';
            item.innerHTML = '<div class="cp-weight-header">' +
                '<span class="cp-weight-name">' + CampaignPresets.formatPresetName(preset) + '</span>' +
                '<span class="cp-weight-value">' + weight + '%</span>' +
                '</div>' +
                '<input type="range" class="cp-weight-slider" data-preset="' + preset + '" ' +
                'min="0" max="100" value="' + weight + '"' +
                (CampaignState.isAdvancedMode ? '' : ' disabled') + '>';

            const slider = item.querySelector('.cp-weight-slider');
            const valueDisplay = item.querySelector('.cp-weight-value');

            slider.addEventListener('input', (e) => {
                valueDisplay.textContent = e.target.value + '%';
                CampaignState.presetWeights[preset] = parseInt(e.target.value);
                CampaignState.presetWeightsDirty = true;
                CampaignPresets.normalizePresetWeights(preset);
                CampaignForm.onFormChange();
            });
            container.appendChild(item);
        });

        // Save to Brand button (advanced mode only)
        if (CampaignState.isAdvancedMode && presets.length > 0) {
            const saveRow = document.createElement('div');
            saveRow.className = 'cp-weight-actions';
            saveRow.innerHTML = '<button class="btn btn--sm btn--secondary" id="save-weights-to-brand"' +
                (!CampaignState.presetWeightsDirty ? ' disabled' : '') + '>Save to Brand</button>' +
                '<span class="cp-weight-hint" id="save-weights-hint">' +
                (CampaignState.presetWeightsDirty ? 'Unsaved changes' : 'Weights match brand defaults') + '</span>';
            container.appendChild(saveRow);
            saveRow.querySelector('#save-weights-to-brand').addEventListener('click', () => CampaignPresets.saveWeightsToBrand());
        }

        // AI Suggestion row (advanced mode only)
        if (CampaignState.isAdvancedMode && presets.length > 1 && CampaignState.currentBrand?.id) {
            const aiRow = document.createElement('div');
            aiRow.className = 'cp-weight-actions cp-weight-actions--ai';
            aiRow.innerHTML = '<button class="btn btn--sm btn--outline" id="suggest-ai-weights">' +
                '<span class="ai-icon">🧠</span> Suggest from AI</button>' +
                '<span class="cp-weight-hint" id="ai-weights-hint">Uses performance data from posted content</span>';
            container.appendChild(aiRow);
            aiRow.querySelector('#suggest-ai-weights').addEventListener('click', () => CampaignPresets.applyAISuggestedWeights());
        }
    },

    /** Normalize weights so they sum to 100 */
    normalizePresetWeights(changedPreset) {
        const weights = CampaignState.presetWeights;
        const total = Object.values(weights).reduce((a, b) => a + b, 0);
        if (total === 100) return;

        const otherPresets = Object.keys(weights).filter(p => p !== changedPreset);
        const changedValue = weights[changedPreset];
        const remainingWeight = 100 - changedValue;
        const otherTotal = otherPresets.reduce((a, p) => a + weights[p], 0);

        if (otherTotal > 0) {
            otherPresets.forEach(p => {
                weights[p] = Math.round((weights[p] / otherTotal) * remainingWeight);
            });
        }
        CampaignPresets.renderPresetWeights();
    },

    /** Fetch performance data for AI-suggested weights */
    async fetchPresetPerformance() {
        const sb = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
        if (!sb || !CampaignState.currentBrand?.id) return null;

        const { data, error } = await sb
            .from('winning_metadata_patterns')
            .select('vibe_preset, avg_performance, sample_count')
            .eq('brand_id', CampaignState.currentBrand.id)
            .not('vibe_preset', 'is', null)
            .gt('sample_count', 0);

        if (error || !data?.length) return null;

        const perfMap = {};
        for (const row of data) {
            if (!perfMap[row.vibe_preset]) perfMap[row.vibe_preset] = { totalPerf: 0, totalSamples: 0 };
            perfMap[row.vibe_preset].totalPerf += (row.avg_performance || 0) * (row.sample_count || 0);
            perfMap[row.vibe_preset].totalSamples += row.sample_count || 0;
        }

        const result = {};
        for (const [preset, agg] of Object.entries(perfMap)) {
            result[preset] = agg.totalSamples > 0 ? agg.totalPerf / agg.totalSamples : 0;
        }
        return result;
    },

    /** Apply AI-suggested weights */
    async applyAISuggestedWeights() {
        const btn = document.getElementById('suggest-ai-weights');
        const hint = document.getElementById('ai-weights-hint');

        try {
            if (btn) { btn.disabled = true; btn.innerHTML = '<span class="ai-icon">🧠</span> Analyzing...'; }

            const perfData = await CampaignPresets.fetchPresetPerformance();
            if (!perfData || Object.keys(perfData).length === 0) {
                if (hint) hint.textContent = 'Not enough performance data yet';
                if (btn) { btn.disabled = false; btn.innerHTML = '<span class="ai-icon">🧠</span> Suggest from AI'; }
                return;
            }

            const currentPresets = Object.keys(CampaignState.presetWeights);
            const scores = {};
            let hasMatch = false;

            for (const preset of currentPresets) {
                if (perfData[preset] !== undefined && perfData[preset] > 0) {
                    scores[preset] = perfData[preset];
                    hasMatch = true;
                } else {
                    scores[preset] = 0.1;
                }
            }

            if (!hasMatch) {
                if (hint) hint.textContent = 'No matching preset performance data found';
                if (btn) { btn.disabled = false; btn.innerHTML = '<span class="ai-icon">🧠</span> Suggest from AI'; }
                return;
            }

            const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
            const suggestedWeights = {};
            let assigned = 0;
            const sortedPresets = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);

            for (let i = 0; i < sortedPresets.length; i++) {
                const p = sortedPresets[i];
                if (i === sortedPresets.length - 1) {
                    suggestedWeights[p] = 100 - assigned;
                } else {
                    suggestedWeights[p] = Math.round((scores[p] / totalScore) * 100);
                    assigned += suggestedWeights[p];
                }
            }

            CampaignState.presetWeights = suggestedWeights;
            CampaignState.presetWeightsDirty = true;
            CampaignPresets.renderPresetWeights();
            CampaignForm.onFormChange();

            const newHint = document.getElementById('ai-weights-hint');
            if (newHint) {
                const topPreset = sortedPresets[0];
                newHint.textContent = '\u2705 Applied \u2014 ' + CampaignPresets.formatPresetName(topPreset) + ' leads at ' + suggestedWeights[topPreset] + '%';
            }
            if (typeof toast !== 'undefined') toast.success('AI-suggested weights applied');
        } catch (e) {
            console.error('Failed to fetch AI suggestions:', e);
            if (hint) hint.textContent = 'Failed to load AI data';
            if (btn) { btn.disabled = false; btn.innerHTML = '<span class="ai-icon">🧠</span> Suggest from AI'; }
        }
    },

    /** Save weights to brand_templates in DB */
    async saveWeightsToBrand() {
        const s = CampaignState;
        if (!s.currentBrand?.id || !s.brandPresets?.length) return;

        const btn = document.getElementById('save-weights-to-brand');
        const hint = document.getElementById('save-weights-hint');

        try {
            if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

            const updates = s.brandPresets.map(p => ({
                id: p.id,
                weight: s.presetWeights[p.template_type] || 0
            }));

            await brandManager.updateVibePresetWeights(s.currentBrand.id, updates);
            s.presetWeightsDirty = false;

            if (hint) hint.textContent = 'Saved!';
            if (btn) { btn.textContent = 'Save to Brand'; btn.disabled = true; }
            if (typeof toast !== 'undefined') toast.success('Preset weights saved to brand');
        } catch (e) {
            console.error('Failed to save weights to brand:', e);
            if (hint) hint.textContent = 'Save failed: ' + e.message;
            if (btn) { btn.disabled = false; btn.textContent = 'Save to Brand'; }
            if (typeof toast !== 'undefined') toast.error('Failed to save weights');
        }
    }
};
