// =====================================================
// CAMPAIGN INIT — Bootstrap & brand manager wiring
// =====================================================

document.addEventListener('DOMContentLoaded', () => {
    // Init brand switcher
    const brandSwitcher = new BrandSwitcher({ selector: '#brand-switcher' });
    brandSwitcher.init();

    // Bind all module elements
    CampaignForm.bindElements();
    CampaignPresets.bindElements();
    CampaignSchedule.bindElements();
    CampaignList.bindElements();
    CampaignTemplates.bindElements();
    CampaignModal.bindElements();

    // Bind states
    CampaignState.els.loadingState  = document.getElementById('loading-state');
    CampaignState.els.noBrandState  = document.getElementById('no-brand-state');
    CampaignState.els.campaignForm  = document.getElementById('campaign-form');

    // Bind all module events
    CampaignForm.bindEvents();
    CampaignPresets.bindEvents();
    CampaignSchedule.bindEvents();
    CampaignTemplates.bindEvents();
    CampaignModal.bindEvents();

    // Listen for brand changes
    if (typeof brandManager !== 'undefined') {
        brandManager.on('brand:activated', (brand) => loadBrand(brand));
    }

    // Init
    initPage();
});

/** Hide all content states */
function hideAllStates() {
    const e = CampaignState.els;
    e.loadingState?.classList.add('hidden');
    e.noBrandState?.classList.add('hidden');
    e.campaignForm?.classList.add('hidden');
    e.campaignsListSection?.classList.add('hidden');
    e.presetGallery?.classList.add('hidden');
}

/** Show no-brand state */
function showNoBrandState() {
    hideAllStates();
    CampaignState.els.noBrandState?.classList.remove('hidden');
}

/** Load a brand and populate the form */
async function loadBrand(brand) {
    if (!brand || !brand.id) {
        showNoBrandState();
        return;
    }

    console.log('\uD83C\uDFF7\uFE0F Loading brand:', brand.name);
    CampaignState.currentBrand = brand;

    // Update brand display
    const e = CampaignState.els;
    if (e.brandEmoji) e.brandEmoji.textContent = brand?.emoji || '\uD83D\uDC7B';
    if (e.brandName) e.brandName.textContent = brand?.name || 'Unknown Brand';

    // Render platform pills based on brand connections
    CampaignForm.renderPlatforms();

    await CampaignPresets.loadPresetWeights();

    hideAllStates();
    e.campaignsListSection?.classList.remove('hidden');

    try {
        CampaignPresets.renderPresetGallery();
    } catch (err) {
        console.error('renderPresetGallery error:', err);
    }

    CampaignForm.onFormChange();

    await CampaignList.loadCampaignsList();
    await CampaignTemplates.loadTemplates();
}

/** Main page init */
async function initPage() {
    console.log('\uD83D\uDCC5 Initializing Campaign Page');

    if (typeof brandManager !== 'undefined') {
        await brandManager.init();
    }

    CampaignForm.initializeFormDefaults();

    const activeBrand = (typeof brandManager !== 'undefined') ? brandManager.getActiveBrand() : null;
    if (activeBrand) {
        try { await loadBrand(activeBrand); } catch (err) { console.error('loadBrand error:', err); }
    } else {
        showNoBrandState();
    }

    CampaignForm.applyClonedConfig();

    if (!CampaignState._campaignsLoaded) {
        await CampaignTemplates.loadTemplates();
        await CampaignList.loadCampaignsList();
    }
}
