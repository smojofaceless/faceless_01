// Connections page — brand header and context updates
// Extracted from connections.html

function updateBrandHeader() {
    const brand = brandManager.getActiveBrand();
    const nameEl = document.getElementById('active-brand-name');

    if (brand) {
        if (nameEl) nameEl.textContent = brand.name;
        updateYouTubeBrandContext();
        updateTwitterBrandContext();
    } else {
        if (nameEl) nameEl.textContent = 'No brand selected';
    }
}

function updateYouTubeBrandContext() {
    const brand = brandManager.getActiveBrand();
    if (brand) youtubeService.setBrand(brand.id);
}

function updateMetaBrandContext() {
    const brand = brandManager.getActiveBrand();
    if (brand) metaService.setBrand(brand.id);
}

async function updateTikTokBrandContext() {
    const brand = brandManager.getActiveBrand();
    if (brand) await tiktokService.setBrand(brand.id);
}

async function updateThreadsBrandContext() {
    const brand = brandManager.getActiveBrand();
    if (brand) await threadsService.setBrand(brand.id);
}

async function updateTwitterBrandContext() {
    const brand = brandManager.getActiveBrand();
    if (brand) await twitterService.setBrand(brand.id);
}
