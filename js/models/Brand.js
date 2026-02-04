// =====================================================
// BRAND MODEL
// Represents a faceless content brand with its configuration
// =====================================================

/**
 * @typedef {Object} BrandConfig
 * @property {string} id - Unique brand identifier
 * @property {string} name - Display name
 * @property {string} slug - URL-safe identifier
 * @property {string} niche - Content niche (horror, crime, mystery, etc.)
 * @property {string} description - Brand description
 * @property {Object} theme - Brand theme configuration
 * @property {Object} settings - Brand-specific settings
 * @property {Object} posting - Default posting configuration
 * @property {string[]} connectedPlatforms - Array of connected platform IDs
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

class Brand {
    constructor(data = {}) {
        this.id = data.id || generateUUID();
        this.name = data.name || '';
        this.slug = data.slug || this.generateSlug(this.name);
        this.niche = data.niche || '';
        this.description = data.description || '';
        this.status = data.status || 'active'; // active, paused, archived
        
        // Theme configuration
        this.theme = {
            primaryColor: data.theme?.primaryColor || '#ef4444',
            secondaryColor: data.theme?.secondaryColor || '#7f1d1d',
            accentColor: data.theme?.accentColor || '#dc2626',
            ...data.theme
        };
        
        // Brand-specific settings
        this.settings = {
            defaultVoice: data.settings?.defaultVoice || null,
            defaultMusic: data.settings?.defaultMusic || null,
            contentStyle: data.settings?.contentStyle || 'dramatic',
            targetDuration: data.settings?.targetDuration || 60,
            ...data.settings
        };
        
        // Default posting configuration
        this.posting = {
            timezone: data.posting?.timezone || 'America/New_York',
            defaultTimes: data.posting?.defaultTimes || ['18:00', '21:00'],
            frequency: data.posting?.frequency || 'daily',
            autoPost: data.posting?.autoPost || false,
            requireApproval: data.posting?.requireApproval || true,
            ...data.posting
        };
        
        // Connected platform account IDs
        this.connectedPlatforms = data.connectedPlatforms || [];
        
        // Metadata
        this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
        this.updatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date();
    }

    generateSlug(name) {
        return name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
    }

    /**
     * Check if brand has a platform connected
     * @param {string} platformId - Platform identifier
     * @returns {boolean}
     */
    hasPlatform(platformId) {
        return this.connectedPlatforms.includes(platformId);
    }

    /**
     * Add a platform connection
     * @param {string} platformId - Platform identifier
     */
    connectPlatform(platformId) {
        if (!this.hasPlatform(platformId)) {
            this.connectedPlatforms.push(platformId);
            this.updatedAt = new Date();
        }
    }

    /**
     * Remove a platform connection
     * @param {string} platformId - Platform identifier
     */
    disconnectPlatform(platformId) {
        this.connectedPlatforms = this.connectedPlatforms.filter(id => id !== platformId);
        this.updatedAt = new Date();
    }

    /**
     * Update brand settings
     * @param {Object} updates - Settings to update
     */
    update(updates) {
        Object.keys(updates).forEach(key => {
            if (key in this && key !== 'id' && key !== 'createdAt') {
                if (typeof this[key] === 'object' && !Array.isArray(this[key])) {
                    this[key] = { ...this[key], ...updates[key] };
                } else {
                    this[key] = updates[key];
                }
            }
        });
        this.updatedAt = new Date();
    }

    /**
     * Serialize to plain object
     * @returns {Object}
     */
    toJSON() {
        return {
            id: this.id,
            name: this.name,
            slug: this.slug,
            niche: this.niche,
            description: this.description,
            status: this.status,
            theme: this.theme,
            settings: this.settings,
            posting: this.posting,
            connectedPlatforms: this.connectedPlatforms,
            createdAt: this.createdAt.toISOString(),
            updatedAt: this.updatedAt.toISOString()
        };
    }

    /**
     * Create Brand from stored data
     * @param {Object} data - Stored brand data
     * @returns {Brand}
     */
    static fromJSON(data) {
        return new Brand(data);
    }
}

// Default brand configurations by niche
const BRAND_PRESETS = {
    horror: {
        niche: 'horror',
        theme: {
            primaryColor: '#ef4444',
            secondaryColor: '#7f1d1d',
            accentColor: '#dc2626'
        },
        settings: {
            contentStyle: 'dramatic',
            targetDuration: 60
        }
    },
    crime: {
        niche: 'crime',
        theme: {
            primaryColor: '#f59e0b',
            secondaryColor: '#78350f',
            accentColor: '#fbbf24'
        },
        settings: {
            contentStyle: 'documentary',
            targetDuration: 90
        }
    },
    mystery: {
        niche: 'mystery',
        theme: {
            primaryColor: '#8b5cf6',
            secondaryColor: '#4c1d95',
            accentColor: '#a78bfa'
        },
        settings: {
            contentStyle: 'suspenseful',
            targetDuration: 75
        }
    },
    scifi: {
        niche: 'scifi',
        theme: {
            primaryColor: '#06b6d4',
            secondaryColor: '#0e7490',
            accentColor: '#22d3ee'
        },
        settings: {
            contentStyle: 'cinematic',
            targetDuration: 60
        }
    }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Brand, BRAND_PRESETS };
}
