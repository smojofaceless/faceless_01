// =====================================================
// CAMPAIGN MODAL — Preset detail overlay
// =====================================================

const CampaignModal = {

    /** Bind modal DOM elements */
    bindElements() {
        const s = CampaignState;
        s.els.presetDetailModal = document.getElementById('preset-detail-modal');
        s.els.presetModalContent = document.getElementById('preset-modal-content');
        s.els.presetModalClose = document.getElementById('preset-modal-close');
    },

    /** Bind modal events */
    bindEvents() {
        const s = CampaignState;
        s.els.presetModalClose?.addEventListener('click', () => CampaignModal.closePresetModal());
        s.els.presetDetailModal?.querySelector('.cp-modal__overlay')?.addEventListener('click', () => CampaignModal.closePresetModal());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') CampaignModal.closePresetModal();
        });
    },

    /** Show preset detail modal */
    showPresetDetail(presetId) {
        const preset = PRESET_CATALOG[presetId];
        const modal = CampaignState.els.presetDetailModal;
        const content = CampaignState.els.presetModalContent;
        if (!preset || !modal || !content) return;

        const weight = CampaignState.presetWeights[presetId];
        const isActive = weight > 0;
        const displayWeight = Math.round(weight || 0);

        content.innerHTML =
            '<div class="cp-detail">' +
                '<div class="cp-detail__hero" style="background:' + preset.visual.gradient + '">' +
                    '<div class="cp-detail__hero-overlay" style="background:' + preset.visual.overlay + '"></div>' +
                    '<div class="cp-detail__hero-scan"></div>' +
                    '<div class="cp-detail__hero-body">' +
                        '<span class="cp-detail__icon">' + preset.icon + '</span>' +
                        '<h2 class="cp-detail__name">' + preset.name + '</h2>' +
                        '<span class="cp-detail__tagline">' + preset.tagline + '</span>' +
                        (isActive
                            ? '<span class="cp-detail__badge" style="background:' + preset.visual.accentBg + ';color:' + preset.visual.accentColor + '">Active \u00B7 ' + displayWeight + '% weight</span>'
                            : '<span class="cp-detail__badge cp-detail__badge--off">Inactive</span>') +
                    '</div>' +
                '</div>' +
                '<div class="cp-detail__section"><p class="cp-detail__desc">' + preset.description + '</p></div>' +
                '<div class="cp-detail__section">' +
                    '<h4 class="cp-detail__heading"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg> Visual DNA</h4>' +
                    '<div class="cp-detail__dna">' +
                        '<div class="cp-dna"><span class="cp-dna__label">Art Style</span><span class="cp-dna__val" style="color:' + preset.visual.accentColor + '">' + preset.visual.artStyle + '</span></div>' +
                        '<div class="cp-dna"><span class="cp-dna__label">Colors</span><span class="cp-dna__val" style="color:' + preset.visual.accentColor + '">' + preset.visual.colorPalette + '</span></div>' +
                        '<div class="cp-dna"><span class="cp-dna__label">Motion</span><span class="cp-dna__val" style="color:' + preset.visual.accentColor + '">' + preset.visual.motionProfile + '</span></div>' +
                        '<div class="cp-dna"><span class="cp-dna__label">Era</span><span class="cp-dna__val" style="color:' + preset.visual.accentColor + '">' + preset.details.era + '</span></div>' +
                        '<div class="cp-dna"><span class="cp-dna__label">Ending</span><span class="cp-dna__val" style="color:' + preset.visual.accentColor + '">' + preset.details.ending + '</span></div>' +
                    '</div>' +
                '</div>' +
                '<div class="cp-detail__section">' +
                    '<h4 class="cp-detail__heading"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Effects Stack</h4>' +
                    '<div class="cp-detail__effects">' +
                        preset.details.effects.map(e =>
                            '<span class="cp-effect" style="border-color:' + preset.visual.accentColor + '40;color:' + preset.visual.accentColor + '">' + e + '</span>'
                        ).join('') +
                    '</div>' +
                '</div>' +
                '<div class="cp-detail__section">' +
                    '<h4 class="cp-detail__heading"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Best For</h4>' +
                    '<p class="cp-detail__best">' + preset.details.bestFor + '</p>' +
                '</div>' +
                '<div class="cp-detail__section cp-detail__section--hook">' +
                    '<h4 class="cp-detail__heading"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> Example Hook</h4>' +
                    '<blockquote class="cp-detail__hook" style="border-left-color:' + preset.visual.accentColor + '">' + preset.details.exampleHook + '</blockquote>' +
                '</div>' +
            '</div>';

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    },

    /** Close preset detail modal */
    closePresetModal() {
        CampaignState.els.presetDetailModal?.classList.remove('active');
        document.body.style.overflow = '';
    }
};
