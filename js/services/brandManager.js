// =====================================================
// BRAND MANAGER SERVICE
// Handles brand CRUD with Supabase sync
// =====================================================

/**
 * Brand Manager - central service for managing brands
 * Syncs with Supabase when available, falls back to localStorage
 */
class BrandManager {
    constructor() {
        this.brands = new Map();
        this.activeBrandId = null;
        this.listeners = new Map();
        this.initialized = false;
        this.useSupabase = false;
    }

    // ==================== Initialization ====================

    /**
     * Initialize the brand manager
     * Determines if Supabase is available and loads brands
     */
    async init() {
        if (this.initialized) return;

        // Check if Supabase client is available
        this.useSupabase = typeof supabaseClient !== 'undefined' && supabaseClient !== null;
        
        if (this.useSupabase) {
            console.log('🏷️ BrandManager: Using Supabase storage');
            await this.loadFromSupabase();
        } else {
            console.log('🏷️ BrandManager: Using localStorage (Supabase not available)');
            this.loadFromLocalStorage();
        }

        this.initialized = true;
    }

    // ==================== CRUD Operations ====================

    /**
     * Create a new brand
     * @param {Object} data - Brand data
     * @returns {Promise<Brand>}
     */
    async create(data) {
        // Apply preset if niche is specified
        if (data.niche && BRAND_PRESETS[data.niche]) {
            data = { ...BRAND_PRESETS[data.niche], ...data };
        }

        const brand = new Brand(data);

        if (this.useSupabase) {
            try {
                const { data: inserted, error } = await supabaseClient
                    .from('brands')
                    .insert({
                        id: brand.id,
                        name: brand.name,
                        slug: brand.slug,
                        niche: brand.niche,
                        description: brand.description,
                        theme: {
                            primaryColor: brand.theme.primaryColor,
                            secondaryColor: brand.theme.secondaryColor,
                            accentColor: brand.theme.accentColor
                        },
                        settings: brand.settings,
                        is_active: false
                    })
                    .select()
                    .single();

                if (error) throw error;
                console.log('🏷️ Brand created in Supabase:', brand.name);
            } catch (e) {
                console.error('Failed to create brand in Supabase:', e);
                // Still add to local cache
            }
        }

        this.brands.set(brand.id, brand);
        this.emit('brand:created', brand);
        this.persistToLocalStorage(); // Always keep localStorage in sync
        return brand;
    }

    /**
     * Get a brand by ID
     * @param {string} id - Brand ID
     * @returns {Brand|null}
     */
    get(id) {
        return this.brands.get(id) || null;
    }

    /**
     * Get brand by slug
     * @param {string} slug - Brand slug
     * @returns {Brand|null}
     */
    getBySlug(slug) {
        return this.getAll().find(b => b.slug === slug) || null;
    }

    /**
     * Update a brand
     * @param {string} id - Brand ID
     * @param {Object} updates - Updates to apply
     * @returns {Promise<Brand|null>}
     */
    async update(id, updates) {
        const brand = this.brands.get(id);
        if (!brand) return null;

        brand.update(updates);

        if (this.useSupabase) {
            try {
                const { error } = await supabaseClient
                    .from('brands')
                    .update({
                        name: brand.name,
                        slug: brand.slug,
                        niche: brand.niche,
                        description: brand.description,
                        theme: {
                            primaryColor: brand.theme.primaryColor,
                            secondaryColor: brand.theme.secondaryColor,
                            accentColor: brand.theme.accentColor
                        },
                        settings: brand.settings,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', id);

                if (error) throw error;
                console.log('🏷️ Brand updated in Supabase:', brand.name);
            } catch (e) {
                console.error('Failed to update brand in Supabase:', e);
            }
        }

        this.emit('brand:updated', brand);
        this.persistToLocalStorage();
        return brand;
    }

    /**
     * Delete a brand
     * @param {string} id - Brand ID
     * @returns {Promise<boolean>}
     */
    async delete(id) {
        const brand = this.brands.get(id);
        if (!brand) return false;

        if (this.useSupabase) {
            try {
                const { error } = await supabaseClient
                    .from('brands')
                    .delete()
                    .eq('id', id);

                if (error) throw error;
                console.log('🏷️ Brand deleted from Supabase:', brand.name);
            } catch (e) {
                console.error('Failed to delete brand from Supabase:', e);
            }
        }

        this.brands.delete(id);
        
        // If this was active brand, clear it
        if (this.activeBrandId === id) {
            this.activeBrandId = null;
            localStorage.removeItem('contentengine_active_brand');
        }

        this.emit('brand:deleted', { id, brand });
        this.persistToLocalStorage();
        return true;
    }

    // ==================== Query Methods ====================

    /**
     * Get all brands
     * @returns {Brand[]}
     */
    getAll() {
        return Array.from(this.brands.values());
    }

    /**
     * Get active brands
     * @returns {Brand[]}
     */
    getActive() {
        return this.getAll().filter(b => b.status === 'active');
    }

    /**
     * Get brands by niche
     * @param {string} niche - Niche type
     * @returns {Brand[]}
     */
    getByNiche(niche) {
        return this.getAll().filter(b => b.niche === niche);
    }

    // ==================== Active Brand ====================

    /**
     * Set the active/selected brand
     * @param {string} id - Brand ID
     */
    async setActive(id) {
        const brand = this.get(id);
        if (!brand) return;

        this.activeBrandId = id;

        if (this.useSupabase) {
            try {
                // Deactivate all other brands
                await supabaseClient
                    .from('brands')
                    .update({ is_active: false })
                    .neq('id', id);

                // Activate this brand
                await supabaseClient
                    .from('brands')
                    .update({ is_active: true })
                    .eq('id', id);

                console.log('🏷️ Switched to brand:', brand.name);
            } catch (e) {
                console.error('Failed to set active brand in Supabase:', e);
            }
        }

        this.emit('brand:activated', brand);
        
        // Store preference locally too
        localStorage.setItem('contentengine_active_brand', id);

        // Update UI theme if applicable
        this.applyBrandTheme(brand);
    }

    /**
     * Get the active brand
     * @returns {Brand|null}
     */
    getActiveBrand() {
        return this.activeBrandId ? this.get(this.activeBrandId) : null;
    }

    /**
     * Apply brand theme to document
     * @param {Brand} brand - Brand to apply
     */
    applyBrandTheme(brand) {
        if (!brand) return;

        document.documentElement.setAttribute('data-brand', brand.niche);
        
        // Apply custom theme colors
        const root = document.documentElement;
        if (brand.theme.primaryColor) {
            root.style.setProperty('--brand-primary', brand.theme.primaryColor);
        }
        if (brand.theme.secondaryColor) {
            root.style.setProperty('--brand-secondary', brand.theme.secondaryColor);
        }
        if (brand.theme.accentColor) {
            root.style.setProperty('--brand-accent', brand.theme.accentColor);
        }
    }

    // ==================== Credentials Management ====================

    /**
     * Save platform credentials for a brand
     * @param {string} brandId - Brand ID
     * @param {string} platform - Platform name (youtube, tiktok, etc.)
     * @param {Object} credentials - Platform credentials
     * @returns {Promise<boolean>}
     */
    async saveCredentials(brandId, platform, credentials) {
        if (!this.useSupabase) {
            console.warn('Credentials storage requires Supabase');
            return false;
        }

        try {
            const { error } = await supabaseClient
                .from('brand_credentials')
                .upsert({
                    brand_id: brandId,
                    platform: platform,
                    credentials: credentials,
                    is_connected: true,
                    last_verified_at: new Date().toISOString()
                }, {
                    onConflict: 'brand_id,platform'
                });

            if (error) throw error;
            console.log(`🔑 Saved ${platform} credentials for brand`);
            return true;
        } catch (e) {
            console.error('Failed to save credentials:', e);
            return false;
        }
    }

    /**
     * Get platform credentials for a brand
     * @param {string} brandId - Brand ID
     * @param {string} platform - Platform name
     * @returns {Promise<Object|null>}
     */
    async getCredentials(brandId, platform) {
        if (!this.useSupabase) {
            console.warn('Credentials storage requires Supabase');
            return null;
        }

        try {
            const { data, error } = await supabaseClient
                .from('brand_credentials')
                .select('credentials, is_connected, last_verified_at')
                .eq('brand_id', brandId)
                .eq('platform', platform)
                .single();

            if (error) {
                if (error.code === 'PGRST116') return null; // Not found
                throw error;
            }
            return data;
        } catch (e) {
            console.error('Failed to get credentials:', e);
            return null;
        }
    }

    /**
     * Get all credentials for a brand
     * @param {string} brandId - Brand ID
     * @returns {Promise<Object[]>}
     */
    async getAllCredentials(brandId) {
        if (!this.useSupabase) {
            console.warn('Credentials storage requires Supabase');
            return [];
        }

        try {
            const { data, error } = await supabaseClient
                .from('brand_credentials')
                .select('platform, is_connected, last_verified_at')
                .eq('brand_id', brandId);

            if (error) throw error;
            return data || [];
        } catch (e) {
            console.error('Failed to get credentials:', e);
            return [];
        }
    }

    /**
     * Delete platform credentials for a brand
     * @param {string} brandId - Brand ID
     * @param {string} platform - Platform name
     * @returns {Promise<boolean>}
     */
    async deleteCredentials(brandId, platform) {
        if (!this.useSupabase) {
            console.warn('Credentials storage requires Supabase');
            return false;
        }

        try {
            const { error } = await supabaseClient
                .from('brand_credentials')
                .delete()
                .eq('brand_id', brandId)
                .eq('platform', platform);

            if (error) throw error;
            console.log(`🗑️ Deleted ${platform} credentials for brand`);
            return true;
        } catch (e) {
            console.error('Failed to delete credentials:', e);
            return false;
        }
    }

    // ==================== Platform Connections ====================

    /**
     * Connect a platform to a brand
     * @param {string} brandId - Brand ID
     * @param {string} platformId - Platform ID
     */
    connectPlatform(brandId, platformId) {
        const brand = this.get(brandId);
        if (!brand) return;

        brand.connectPlatform(platformId);
        this.emit('brand:platform:connected', { brand, platformId });
        this.persistToLocalStorage();
    }

    /**
     * Disconnect a platform from a brand
     * @param {string} brandId - Brand ID
     * @param {string} platformId - Platform ID
     */
    disconnectPlatform(brandId, platformId) {
        const brand = this.get(brandId);
        if (!brand) return;

        brand.disconnectPlatform(platformId);
        this.emit('brand:platform:disconnected', { brand, platformId });
        this.persistToLocalStorage();
    }

    // ==================== Statistics ====================

    /**
     * Get brand statistics
     * @param {string} brandId - Brand ID
     * @returns {Object}
     */
    getStats(brandId) {
        const brand = this.get(brandId);
        if (!brand) return null;

        // Check if dependent services exist
        const posts = typeof postManager !== 'undefined' ? postManager.getByBrand(brandId) : [];
        const postStats = typeof postManager !== 'undefined' ? postManager.getStats({ brandId }) : {};
        const accounts = typeof accountManager !== 'undefined' ? accountManager.getForBrand(brandId) : [];
        const schedules = typeof scheduler !== 'undefined' ? scheduler.getSchedulesForBrand(brandId) : [];

        return {
            brand,
            totalPosts: posts.length,
            ...postStats,
            connectedPlatforms: brand.connectedPlatforms?.length || 0,
            activeAccounts: accounts.filter(a => a.isActive?.()).length,
            totalAccounts: accounts.length,
            schedules: schedules.length,
            activeSchedules: schedules.filter(s => s.enabled).length
        };
    }

    // ==================== Persistence ====================

    /**
     * Load brands from Supabase
     */
    async loadFromSupabase() {
        try {
            const { data: brands, error } = await supabaseClient
                .from('brands')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            this.brands.clear();
            
            let activeFound = false;
            brands?.forEach(b => {
                const brand = new Brand({
                    id: b.id,
                    name: b.name,
                    slug: b.slug,
                    niche: b.niche,
                    description: b.description,
                    theme: {
                        primaryColor: b.theme?.primaryColor || '#8B5CF6',
                        secondaryColor: b.theme?.secondaryColor || '#1E1E2E',
                        accentColor: b.theme?.accentColor || '#EC4899'
                    },
                    settings: b.settings || {},
                    status: 'active',
                    createdAt: b.created_at,
                    updatedAt: b.updated_at
                });
                this.brands.set(brand.id, brand);

                if (b.is_active) {
                    this.activeBrandId = brand.id;
                    activeFound = true;
                }
            });

            // If no active brand in DB, check localStorage
            if (!activeFound) {
                const localActive = localStorage.getItem('contentengine_active_brand');
                if (localActive && this.brands.has(localActive)) {
                    this.activeBrandId = localActive;
                }
            }

            // Apply theme if we have an active brand
            if (this.activeBrandId) {
                this.applyBrandTheme(this.get(this.activeBrandId));
            }

            console.log(`🏷️ Loaded ${this.brands.size} brands from Supabase`);
            
            // Keep localStorage in sync
            this.persistToLocalStorage();
            
            // Emit loaded event so components can re-render
            this.emit('brands:loaded', { count: this.brands.size });
        } catch (e) {
            console.error('Failed to load brands from Supabase:', e);
            // Fallback to localStorage
            this.loadFromLocalStorage();
        }
    }

    /**
     * Load brands from localStorage
     */
    loadFromLocalStorage() {
        try {
            const data = localStorage.getItem('contentengine_brands');
            if (data) {
                const brands = JSON.parse(data);
                brands.forEach(b => {
                    const brand = Brand.fromJSON(b);
                    this.brands.set(brand.id, brand);
                });
            }

            // Restore active brand
            const activeBrandId = localStorage.getItem('contentengine_active_brand');
            if (activeBrandId && this.brands.has(activeBrandId)) {
                this.activeBrandId = activeBrandId;
                this.applyBrandTheme(this.get(activeBrandId));
            }

            console.log(`🏷️ Loaded ${this.brands.size} brands from localStorage`);
            
            // Emit loaded event so components can re-render
            this.emit('brands:loaded', { count: this.brands.size });
        } catch (e) {
            console.error('Failed to load brands from localStorage:', e);
        }
    }

    /**
     * Persist to localStorage (backup/cache)
     */
    persistToLocalStorage() {
        try {
            const data = this.getAll().map(b => b.toJSON());
            localStorage.setItem('contentengine_brands', JSON.stringify(data));
        } catch (e) {
            console.error('Failed to persist brands to localStorage:', e);
        }
    }

    /**
     * Sync local brands to Supabase (for migration)
     */
    async syncToSupabase() {
        if (!this.useSupabase) {
            console.warn('Supabase not available');
            return;
        }

        const brands = this.getAll();
        console.log(`🔄 Syncing ${brands.length} brands to Supabase...`);

        for (const brand of brands) {
            try {
                const { error } = await supabaseClient
                    .from('brands')
                    .upsert({
                        id: brand.id,
                        name: brand.name,
                        slug: brand.slug,
                        niche: brand.niche,
                        description: brand.description,
                        theme: {
                            primaryColor: brand.theme.primaryColor,
                            secondaryColor: brand.theme.secondaryColor,
                            accentColor: brand.theme.accentColor
                        },
                        settings: brand.settings,
                        is_active: brand.id === this.activeBrandId
                    }, {
                        onConflict: 'id'
                    });

                if (error) throw error;
                console.log(`✅ Synced brand: ${brand.name}`);
            } catch (e) {
                console.error(`Failed to sync brand ${brand.name}:`, e);
            }
        }

        console.log('🔄 Sync complete');
    }

    /**
     * Initialize with default brands if empty
     */
    async initializeDefaults() {
        if (this.brands.size > 0) return;

        // Create default horror brand
        await this.create({
            name: 'Horror Stories',
            niche: 'horror',
            description: 'Terrifying tales and dark narratives',
            status: 'active'
        });
    }

    // Legacy sync method for compatibility
    load() {
        // This is now handled by init()
        // Keep for backwards compatibility
        if (!this.initialized) {
            this.loadFromLocalStorage();
        }
    }

    persist() {
        // Legacy method - now auto-persists
        this.persistToLocalStorage();
    }

    // ==================== Events ====================

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    off(event, callback) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) callbacks.splice(index, 1);
        }
    }

    emit(event, data) {
        const callbacks = this.listeners.get(event) || [];
        callbacks.forEach(cb => {
            try {
                cb(data);
            } catch (e) {
                console.error(`Error in ${event} listener:`, e);
            }
        });
    }

    // ==================== Music Track Management ====================

    /**
     * Get all music tracks for a brand
     * @param {string} brandId
     * @returns {Promise<Array>}
     */
    async getMusicTracks(brandId) {
        if (!this.useSupabase) {
            console.warn('Music tracks require Supabase');
            return [];
        }
        const { data, error } = await supabaseClient
            .from('music_tracks')
            .select('*')
            .eq('brand_id', brandId)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Failed to load music tracks:', error);
            throw error;
        }
        return data || [];
    }

    /**
     * Add a music track record to the DB (file should already be uploaded to storage)
     * @param {string} brandId
     * @param {Object} trackData - { id, display_name, file_path, duration_seconds, loopable, mood, energy, tags, vibe_presets }
     * @returns {Promise<Object>}
     */
    async addMusicTrack(brandId, trackData) {
        if (!this.useSupabase) throw new Error('Music tracks require Supabase');

        const row = {
            id: trackData.id,
            brand_id: brandId,
            display_name: trackData.display_name,
            file_path: trackData.file_path,
            duration_seconds: trackData.duration_seconds || 0,
            loopable: trackData.loopable !== false,
            mood: trackData.mood || 'dark',
            energy: trackData.energy || 'low',
            tags: trackData.tags || [],
            vibe_presets: trackData.vibe_presets || [],
            is_active: true,
        };

        const { data, error } = await supabaseClient
            .from('music_tracks')
            .upsert(row, { onConflict: 'id,brand_id' })
            .select()
            .single();

        if (error) {
            console.error('Failed to add music track:', error);
            throw error;
        }
        this.emit('musicTrackChanged', { brandId, track: data });
        return data;
    }

    /**
     * Toggle a music track active/inactive (soft delete)
     * @param {string} brandId
     * @param {string} trackId
     * @param {boolean} isActive
     */
    async toggleMusicTrack(brandId, trackId, isActive) {
        if (!this.useSupabase) throw new Error('Music tracks require Supabase');

        const { error } = await supabaseClient
            .from('music_tracks')
            .update({ is_active: isActive, updated_at: new Date().toISOString() })
            .eq('id', trackId)
            .eq('brand_id', brandId);

        if (error) {
            console.error('Failed to toggle music track:', error);
            throw error;
        }
        this.emit('musicTrackChanged', { brandId, trackId, isActive });
    }

    /**
     * Delete a music track from DB (does NOT remove storage file)
     * @param {string} brandId
     * @param {string} trackId
     */
    async deleteMusicTrack(brandId, trackId) {
        if (!this.useSupabase) throw new Error('Music tracks require Supabase');

        const { error } = await supabaseClient
            .from('music_tracks')
            .delete()
            .eq('id', trackId)
            .eq('brand_id', brandId);

        if (error) {
            console.error('Failed to delete music track:', error);
            throw error;
        }
        this.emit('musicTrackChanged', { brandId, trackId, deleted: true });
    }

    /**
     * Upload a music file to Supabase Storage and create/update the DB record
     * @param {string} brandId
     * @param {File} file - The audio file
     * @param {Object} meta - Additional metadata { display_name, mood, energy, loopable, tags, vibe_presets }
     * @returns {Promise<Object>} The created track record
     */
    async uploadMusicTrack(brandId, file, meta = {}) {
        if (!this.useSupabase) throw new Error('Music tracks require Supabase');

        // Generate track ID from filename (sanitize)
        const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        const trackId = baseName;
        const storagePath = `brands/${brandId}/music/${trackId}.mp3`;

        // 1. Upload file to storage
        const { error: uploadError } = await supabaseClient.storage
            .from('story-videos')
            .upload(storagePath, file, {
                cacheControl: '3600',
                upsert: true,
                contentType: file.type || 'audio/mpeg',
            });

        if (uploadError) {
            console.error('Failed to upload music file:', uploadError);
            throw new Error(`Upload failed: ${uploadError.message}`);
        }

        // 2. Create DB record
        const trackData = {
            id: trackId,
            display_name: meta.display_name || baseName.replace(/_/g, ' '),
            file_path: storagePath,
            duration_seconds: meta.duration_seconds || 0,
            loopable: meta.loopable !== false,
            mood: meta.mood || 'dark',
            energy: meta.energy || 'low',
            tags: meta.tags || [],
            vibe_presets: meta.vibe_presets || [],
        };

        return await this.addMusicTrack(brandId, trackData);
    }

    /**
     * Remove a music file from Storage (call after deleteMusicTrack if you want to clean up)
     * @param {string} brandId
     * @param {string} trackId
     */
    async removeMusicFile(brandId, trackId) {
        if (!this.useSupabase) throw new Error('Music tracks require Supabase');

        const path = `brands/${brandId}/music/${trackId}.mp3`;
        const { error } = await supabaseClient.storage
            .from('story-videos')
            .remove([path]);

        if (error) {
            console.error('Failed to remove music file from storage:', error);
            // Don't throw — DB record is already deleted
        }
    }

    /**
     * Get the public URL for a music track
     * @param {string} brandId
     * @param {string} trackId
     * @returns {string}
     */
    getMusicTrackUrl(brandId, trackId) {
        const supabaseUrl = typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_URL : '';
        return `${supabaseUrl}/storage/v1/object/public/story-videos/brands/${brandId}/music/${trackId}.mp3`;
    }
}

// Create singleton instance
const brandManager = new BrandManager();

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BrandManager, brandManager };
}
