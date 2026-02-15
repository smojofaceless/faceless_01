// =====================================================
// METADATA VERSION SERVICE
// Frontend service for caption/tags learning loop (#20)
// Wraps Supabase RPCs for version history & A/B variants
// =====================================================

class MetadataVersionService {
    constructor() {
        this._initialized = false;
        this._supabase = null;
        this._cache = new Map(); // key -> { data, fetchedAt }
        this._cacheTTL = 2 * 60 * 1000; // 2 min cache
    }

    /**
     * Initialize the service
     */
    async init() {
        if (this._initialized) return;
        
        if (typeof window.supabaseClient !== 'undefined') {
            this._supabase = window.supabaseClient;
        } else if (typeof supabase !== 'undefined') {
            this._supabase = supabase;
        }

        if (!this._supabase) {
            console.warn('MetadataVersionService: No Supabase client available');
            return;
        }

        this._initialized = true;
        console.log('📝 MetadataVersionService initialized');
    }

    /**
     * Get version history for a post/platform
     * @param {string} postId
     * @param {string} platform
     * @returns {Promise<Array>}
     */
    async getVersions(postId, platform) {
        if (!this._supabase) return [];

        const cacheKey = `${postId}:${platform}`;
        const cached = this._cache.get(cacheKey);
        if (cached && Date.now() - cached.fetchedAt < this._cacheTTL) {
            return cached.data;
        }

        try {
            const { data, error } = await this._supabase
                .rpc('get_post_metadata_versions', {
                    p_post_id: postId,
                    p_platform: platform,
                });

            if (error) {
                console.error('MetadataVersionService.getVersions error:', error.message);
                return [];
            }

            const versions = data || [];
            this._cache.set(cacheKey, { data: versions, fetchedAt: Date.now() });
            return versions;
        } catch (err) {
            console.error('MetadataVersionService.getVersions exception:', err);
            return [];
        }
    }

    /**
     * Record a user-edit version
     * @param {string} postId
     * @param {string} platform
     * @param {Object} fields - metadata fields snapshot
     * @returns {Promise<Object|null>}
     */
    async recordEditVersion(postId, platform, fields) {
        if (!this._supabase) return null;

        try {
            const { data, error } = await this._supabase
                .rpc('record_post_metadata_version', {
                    p_post_id: postId,
                    p_platform: platform,
                    p_version_type: 'edit',
                    p_variant_key: null,
                    p_fields: fields,
                    p_generation_model: null,
                    p_schema_version: 1,
                    p_idempotency_key: `${postId}:meta-version:${platform}:edit:${Date.now()}`,
                    p_created_by: 'manual',
                });

            if (error) {
                console.error('MetadataVersionService.recordEditVersion error:', error.message);
                return null;
            }

            // Invalidate cache
            this._cache.delete(`${postId}:${platform}`);
            return data?.[0] || null;
        } catch (err) {
            console.error('MetadataVersionService.recordEditVersion exception:', err);
            return null;
        }
    }

    /**
     * Get variant performance for a job
     * @param {string} jobId
     * @param {string} platform
     * @returns {Promise<Array>}
     */
    async getVariantPerformance(jobId, platform) {
        if (!this._supabase) return [];

        try {
            const { data, error } = await this._supabase
                .rpc('get_variant_performance', {
                    p_job_id: jobId,
                    p_platform: platform,
                });

            if (error) {
                console.error('MetadataVersionService.getVariantPerformance error:', error.message);
                return [];
            }

            return data || [];
        } catch (err) {
            console.error('MetadataVersionService.getVariantPerformance exception:', err);
            return [];
        }
    }

    /**
     * Format a version type badge
     * @param {string} versionType - 'ai', 'edit', 'regenerate'
     * @returns {{ label: string, cssClass: string }}
     */
    formatVersionType(versionType) {
        const types = {
            ai:         { label: 'AI',    cssClass: 'version-badge--ai' },
            edit:       { label: 'Edit',  cssClass: 'version-badge--edit' },
            regenerate: { label: 'Regen', cssClass: 'version-badge--regen' },
        };
        return types[versionType] || { label: versionType, cssClass: '' };
    }

    /**
     * Format performance value with color class
     * @param {number} value
     * @returns {{ text: string, cssClass: string }}
     */
    formatPerformance(value) {
        if (!value || value === 0) {
            return { text: '—', cssClass: 'perf--none' };
        }
        if (value >= 100) {
            return { text: value.toLocaleString(), cssClass: 'perf--high' };
        }
        if (value >= 20) {
            return { text: value.toLocaleString(), cssClass: 'perf--mid' };
        }
        return { text: value.toLocaleString(), cssClass: 'perf--low' };
    }
}

// =====================================================
// SINGLETON
// =====================================================
window.metadataVersionService = new MetadataVersionService();
