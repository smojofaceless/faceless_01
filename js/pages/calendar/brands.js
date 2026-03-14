// =====================================================
// CALENDAR PAGE - Brand Filtering
// Brand map, filter bar, and brand change handling
// =====================================================

/**
 * Build the brand lookup map for the calendar component
 * @returns {Map} brandId → { name, color }
 */
function buildBrandMap() {
    const map = new Map();
    if (typeof brandManager !== 'undefined') {
        const brands = brandManager.getAll();
        for (const brand of brands) {
            map.set(brand.id, {
                name: brand.name,
                color: brand.theme?.primaryColor || '#8b5cf6'
            });
        }
    }
    return map;
}

/**
 * Build the brand filter pill bar at the top of the calendar
 */
async function buildBrandFilterBar() {
    if (!calElements.brandFilterBar || typeof brandManager === 'undefined') return;

    allBrands = brandManager.getAll();

    // Only show the filter bar if there's more than 1 brand
    if (allBrands.length <= 1) {
        calElements.brandFilterBar.style.display = 'none';
        if (allBrands.length === 1) {
            activeBrandFilter = allBrands[0].id;
        }
        return;
    }

    // Build brand pills HTML (the "All Brands" pill is already in HTML)
    const pillsHTML = allBrands.map(brand => {
        const color = brand.theme?.primaryColor || '#8b5cf6';
        return `
            <button class="brand-filter-pill" data-brand-id="${brand.id}">
                <span class="brand-filter-pill__dot" style="background: ${color}"></span>
                <span>${escapeHtml(brand.name)}</span>
            </button>
        `;
    }).join('');

    calElements.brandFilterBar.insertAdjacentHTML('beforeend', pillsHTML);

    // Set up click handlers
    calElements.brandFilterBar.addEventListener('click', async (e) => {
        const pill = e.target.closest('.brand-filter-pill');
        if (!pill) return;

        const brandId = pill.dataset.brandId || null;

        calElements.brandFilterBar.querySelectorAll('.brand-filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');

        activeBrandFilter = brandId || null;

        if (calendarInstance) {
            await calendarInstance.setFilters({ brandId: activeBrandFilter });
            await enrichCalendarMetrics();
        }
        if (bestTimesOpen) {
            timeSlotService.clearCache();
            loadBestTimes();
        }
    });

    // Listen for brand changes from the brand manager
    brandManager.on('brand:created', () => rebuildBrandFilterBar());
    brandManager.on('brand:deleted', () => rebuildBrandFilterBar());
    brandManager.on('brand:updated', () => rebuildBrandFilterBar());
}

/**
 * Rebuild the brand filter bar (e.g., when brands change)
 */
async function rebuildBrandFilterBar() {
    if (!calElements.brandFilterBar) return;

    const allPill = calElements.brandFilterBar.querySelector('.brand-filter-pill--all');
    calElements.brandFilterBar.innerHTML = '';
    if (allPill) calElements.brandFilterBar.appendChild(allPill);

    await buildBrandFilterBar();

    if (calendarInstance) {
        calendarInstance.setBrandMap(buildBrandMap());
    }
}

/**
 * Handle brand change from brand switcher (header dropdown)
 * @param {Object} brand - Selected brand
 */
async function handleBrandChange(brand) {
    const brandId = brand?.id || null;
    activeBrandFilter = brandId;

    if (calElements.brandFilterBar) {
        calElements.brandFilterBar.querySelectorAll('.brand-filter-pill').forEach(p => {
            const pillBrandId = p.dataset.brandId || null;
            p.classList.toggle('active', pillBrandId === (brandId || ''));
        });

        const activePill = calElements.brandFilterBar.querySelector(`.brand-filter-pill[data-brand-id="${brandId || ''}"]`);
        if (activePill) {
            calElements.brandFilterBar.querySelectorAll('.brand-filter-pill').forEach(p => p.classList.remove('active'));
            activePill.classList.add('active');
        }
    }

    if (calendarInstance) {
        await calendarInstance.setFilters({ brandId: brandId });
        await enrichCalendarMetrics();
    }
    if (bestTimesOpen) {
        timeSlotService.clearCache();
        loadBestTimes();
    }
}
