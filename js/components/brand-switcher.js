// =====================================================
// BRAND SWITCHER COMPONENT
// Quick brand selection dropdown for the header
// =====================================================

class BrandSwitcher {
    constructor(options = {}) {
        this.container = null;
        this.selector = options.selector || '#brand-switcher';
        this.onSelect = options.onSelect || null;
    }

    /**
     * Initialize the brand switcher
     */
    init() {
        this.container = document.querySelector(this.selector);
        if (!this.container) {
            console.warn('Brand switcher container not found');
            return;
        }

        this.render();
        this.setupEventListeners();

        // Listen for brand changes
        brandManager.on('brand:created', () => this.render());
        brandManager.on('brand:deleted', () => this.render());
        brandManager.on('brand:updated', () => this.render());
        brandManager.on('brand:activated', () => this.updateSelection());
        brandManager.on('brands:loaded', () => this.render());
    }

    /**
     * Render the brand switcher
     */
    render() {
        const brands = brandManager.getAll();
        const activeBrand = brandManager.getActiveBrand();

        this.container.innerHTML = `
            <div class="brand-switcher">
                <button class="brand-switcher__toggle" aria-expanded="false" aria-haspopup="listbox">
                    <div class="brand-switcher__current">
                        ${activeBrand ? `
                            <span class="brand-switcher__indicator" style="background: ${activeBrand.theme.primaryColor}"></span>
                            <span class="brand-switcher__name">${activeBrand.name}</span>
                        ` : `
                            <span class="brand-switcher__name">Select Brand</span>
                        `}
                    </div>
                    <svg class="brand-switcher__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M6 9l6 6 6-6"/>
                    </svg>
                </button>
                <div class="brand-switcher__dropdown" role="listbox">
                    <div class="brand-switcher__list">
                        ${brands.map(brand => `
                            <button 
                                class="brand-switcher__item ${brand.id === activeBrand?.id ? 'brand-switcher__item--active' : ''}"
                                data-brand-id="${brand.id}"
                                role="option"
                                aria-selected="${brand.id === activeBrand?.id}"
                            >
                                <span class="brand-switcher__indicator" style="background: ${brand.theme.primaryColor}"></span>
                                <span class="brand-switcher__item-name">${brand.name}</span>
                                <span class="brand-switcher__item-niche">${brand.niche}</span>
                                ${brand.id === activeBrand?.id ? `
                                    <svg class="brand-switcher__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M20 6L9 17l-5-5"/>
                                    </svg>
                                ` : ''}
                            </button>
                        `).join('')}
                    </div>
                    <div class="brand-switcher__footer">
                        <a href="${window.location.pathname.includes('/pages/') ? '' : 'pages/'}brands.html" class="brand-switcher__manage">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="3"/>
                                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
                            </svg>
                            Manage Brands
                        </a>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Set up event listeners
     */
    setupEventListeners() {
        this.container.addEventListener('click', (e) => {
            const toggle = e.target.closest('.brand-switcher__toggle');
            if (toggle) {
                this.toggleDropdown();
                return;
            }

            const item = e.target.closest('.brand-switcher__item');
            if (item) {
                const brandId = item.dataset.brandId;
                this.selectBrand(brandId);
                this.closeDropdown();
                return;
            }
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.closeDropdown();
            }
        });

        // Keyboard navigation
        this.container.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeDropdown();
            }
        });
    }

    /**
     * Toggle dropdown visibility
     */
    toggleDropdown() {
        const dropdown = this.container.querySelector('.brand-switcher__dropdown');
        const toggle = this.container.querySelector('.brand-switcher__toggle');
        const isOpen = dropdown.classList.contains('brand-switcher__dropdown--open');

        if (isOpen) {
            this.closeDropdown();
        } else {
            dropdown.classList.add('brand-switcher__dropdown--open');
            toggle.setAttribute('aria-expanded', 'true');
        }
    }

    /**
     * Close the dropdown
     */
    closeDropdown() {
        const dropdown = this.container.querySelector('.brand-switcher__dropdown');
        const toggle = this.container.querySelector('.brand-switcher__toggle');
        
        if (dropdown) {
            dropdown.classList.remove('brand-switcher__dropdown--open');
        }
        if (toggle) {
            toggle.setAttribute('aria-expanded', 'false');
        }
    }

    /**
     * Select a brand
     * @param {string} brandId - Brand ID to select
     */
    selectBrand(brandId) {
        brandManager.setActive(brandId);
        this.updateSelection();

        if (this.onSelect) {
            this.onSelect(brandManager.get(brandId));
        }
    }

    /**
     * Update the current selection display
     */
    updateSelection() {
        this.render();
        this.setupEventListeners();
    }
}

// Export for browser
window.BrandSwitcher = BrandSwitcher;

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BrandSwitcher };
}
