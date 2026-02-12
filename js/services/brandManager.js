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

    // =================================================================
    // VIBE PRESETS (brand_templates CRUD)
    // =================================================================

    /**
     * Load all vibe presets for a brand from brand_templates.
     * Returns array of { id, template_type, name, weight, is_default, config_overrides }.
     * @param {string} brandId
     * @returns {Promise<Array>}
     */
    async getVibePresets(brandId) {
        if (!this.useSupabase) return [];
        const { data, error } = await supabaseClient
            .from('brand_templates')
            .select('id, template_type, name, weight, is_default, config_overrides')
            .eq('brand_id', brandId)
            .order('weight', { ascending: false });

        if (error) {
            console.error('Failed to load vibe presets:', error);
            return [];
        }
        return data || [];
    }

    /**
     * Add a vibe preset to a brand.
     * @param {string} brandId
     * @param {string} templateType - e.g. 'urban_legend', 'one_too_many'
     * @param {string} name - Display name e.g. 'Urban Legend'
     * @param {number} weight - Selection weight (0.00 - 1.00)
     * @param {boolean} isDefault - Whether this is the default template
     * @returns {Promise<Object>} The inserted row
     */
    async addVibePreset(brandId, templateType, name, weight = 50, isDefault = false) {
        if (!this.useSupabase) throw new Error('Vibe presets require Supabase');

        // If this is being set as default, unset previous defaults first
        if (isDefault) {
            await supabaseClient
                .from('brand_templates')
                .update({ is_default: false })
                .eq('brand_id', brandId)
                .eq('is_default', true);
        }

        const { data, error } = await supabaseClient
            .from('brand_templates')
            .insert({
                brand_id: brandId,
                template_type: templateType,
                name: name,
                weight: weight,
                is_default: isDefault,
                config_overrides: {}
            })
            .select()
            .single();

        if (error) {
            console.error('Failed to add vibe preset:', error);
            throw error;
        }
        console.log(`🎭 Vibe preset "${name}" added to brand ${brandId}`);
        return data;
    }

    /**
     * Update a vibe preset's weight and/or default status.
     * @param {string} presetId - brand_templates.id
     * @param {Object} updates - { weight?, is_default? }
     * @returns {Promise<void>}
     */
    async updateVibePreset(presetId, updates) {
        if (!this.useSupabase) throw new Error('Vibe presets require Supabase');

        const { error } = await supabaseClient
            .from('brand_templates')
            .update(updates)
            .eq('id', presetId);

        if (error) {
            console.error('Failed to update vibe preset:', error);
            throw error;
        }
    }

    /**
     * Update weights for all presets of a brand at once.
     * @param {string} brandId
     * @param {Array<{id: string, weight: number}>} presetWeights
     * @returns {Promise<void>}
     */
    async updateVibePresetWeights(brandId, presetWeights) {
        if (!this.useSupabase) throw new Error('Vibe presets require Supabase');

        // Update each preset's weight
        for (const { id, weight } of presetWeights) {
            const { error } = await supabaseClient
                .from('brand_templates')
                .update({ weight })
                .eq('id', id)
                .eq('brand_id', brandId);

            if (error) {
                console.error(`Failed to update weight for preset ${id}:`, error);
                throw error;
            }
        }
        console.log(`🎭 Updated ${presetWeights.length} preset weights for brand ${brandId}`);
    }

    /**
     * Remove a vibe preset from a brand.
     * @param {string} presetId - brand_templates.id
     * @returns {Promise<void>}
     */
    async removeVibePreset(presetId) {
        if (!this.useSupabase) throw new Error('Vibe presets require Supabase');

        const { error } = await supabaseClient
            .from('brand_templates')
            .delete()
            .eq('id', presetId);

        if (error) {
            console.error('Failed to remove vibe preset:', error);
            throw error;
        }
        console.log(`🎭 Vibe preset ${presetId} removed`);
    }

    // =================================================================
    // EFFECTS CONFIG (brand-level config_overrides.effects)
    // =================================================================

    /**
     * Get effects config from brand_templates for a brand.
     * Returns the effects object from the default template's config_overrides,
     * or null if no effects are configured.
     * @param {string} brandId
     * @returns {Promise<Object|null>}
     */
    async getEffectsConfig(brandId) {
        if (!this.useSupabase) {
            console.warn('Effects config requires Supabase');
            return null;
        }
        const { data, error } = await supabaseClient
            .from('brand_templates')
            .select('id, template_type, config_overrides, is_default')
            .eq('brand_id', brandId)
            .eq('is_default', true)
            .limit(1)
            .single();

        if (error) {
            // PGRST116 = no rows found — brand has no default template
            if (error.code === 'PGRST116') return null;
            console.error('Failed to load effects config:', error);
            throw error;
        }
        return data?.config_overrides?.effects || null;
    }

    /**
     * Save effects config to brand_templates for a brand.
     * Merges into config_overrides.effects on the default template.
     * If effectsConfig is null, removes the effects key entirely.
     * @param {string} brandId
     * @param {Object|null} effectsConfig
     * @returns {Promise<void>}
     */
    async saveEffectsConfig(brandId, effectsConfig) {
        if (!this.useSupabase) throw new Error('Effects config requires Supabase');

        // Find the default template for this brand
        const { data: template, error: fetchErr } = await supabaseClient
            .from('brand_templates')
            .select('id, config_overrides')
            .eq('brand_id', brandId)
            .eq('is_default', true)
            .limit(1)
            .single();

        if (fetchErr) {
            console.error('Failed to find default template:', fetchErr);
            throw fetchErr;
        }

        const overrides = template.config_overrides || {};

        if (effectsConfig === null) {
            // Remove effects key entirely
            delete overrides.effects;
        } else {
            overrides.effects = effectsConfig;
        }

        const { error: updateErr } = await supabaseClient
            .from('brand_templates')
            .update({ config_overrides: overrides })
            .eq('id', template.id);

        if (updateErr) {
            console.error('Failed to save effects config:', updateErr);
            throw updateErr;
        }
        console.log('🎛️ Effects config saved for brand:', brandId);
    }

    // =================================================
    // IMAGE PROMPT CONFIG
    // =================================================

    /**
     * Load the resolved image prompt config for a brand + vibe preset.
     * Uses the DB RPC which merges: system defaults → preset → brand overrides.
     * @param {string} brandId
     * @param {string} [vibePreset='urban_legend']
     * @returns {Promise<Object|null>}
     */
    async getImagePromptConfig(brandId, vibePreset = 'urban_legend') {
        if (!this.useSupabase) return null;
        try {
            const { data, error } = await supabaseClient.rpc('get_image_prompt_config_for_job', {
                p_brand_id: brandId,
                p_vibe_preset: vibePreset,
                p_job_meta: {},
            });
            if (error) {
                console.error('Failed to load image prompt config:', error);
                return null;
            }
            return data || null;
        } catch (err) {
            console.error('getImagePromptConfig exception:', err);
            return null;
        }
    }

    /**
     * Load only the brand-level image_prompt overrides (raw, not merged).
     * @param {string} brandId
     * @returns {Promise<Object|null>}
     */
    async getImagePromptConfigRaw(brandId) {
        if (!this.useSupabase) return null;
        const { data, error } = await supabaseClient
            .from('brand_templates')
            .select('id, template_type, config_overrides, is_default')
            .eq('brand_id', brandId)
            .eq('is_default', true)
            .limit(1)
            .single();
        if (error) {
            if (error.code === 'PGRST116') return null;
            console.error('Failed to load image prompt config:', error);
            throw error;
        }
        return data?.config_overrides?.image_prompt || null;
    }

    /**
     * Save image prompt config to brand_templates for a brand.
     * Merges into config_overrides.image_prompt on the default template.
     * @param {string} brandId
     * @param {Object|null} imagePromptConfig - null to remove overrides
     */
    async saveImagePromptConfig(brandId, imagePromptConfig) {
        if (!this.useSupabase) throw new Error('Image prompt config requires Supabase');

        const { data: template, error: fetchErr } = await supabaseClient
            .from('brand_templates')
            .select('id, config_overrides')
            .eq('brand_id', brandId)
            .eq('is_default', true)
            .limit(1)
            .single();

        if (fetchErr) {
            console.error('Failed to find default template:', fetchErr);
            throw fetchErr;
        }

        const overrides = template.config_overrides || {};

        if (imagePromptConfig === null) {
            delete overrides.image_prompt;
        } else {
            overrides.image_prompt = imagePromptConfig;
        }

        const { error: updateErr } = await supabaseClient
            .from('brand_templates')
            .update({ config_overrides: overrides })
            .eq('id', template.id);

        if (updateErr) {
            console.error('Failed to save image prompt config:', updateErr);
            throw updateErr;
        }
        console.log('🎨 Image prompt config saved for brand:', brandId);
    }
}

// Create singleton instance
const brandManager = new BrandManager();

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BrandManager, brandManager };
}
