// =====================================================
// CAMPAIGN TEMPLATE SERVICE
// CRUD for reusable campaign configurations
// =====================================================

class CampaignTemplateService {
    constructor() {
        this._sb = null;
    }

    /** Lazy Supabase client */
    get sb() {
        if (!this._sb) {
            this._sb = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
        }
        return this._sb;
    }

    // ── Read ────────────────────────────────────────

    /**
     * Get all active templates for a brand (plus system-wide templates)
     * @param {string|null} brandId  — filter brand; NULL returns system-wide only
     * @returns {Array} templates sorted by usage desc
     */
    async getTemplates(brandId) {
        if (!this.sb) return [];

        let query = this.sb
            .from('campaign_templates')
            .select('*')
            .eq('is_active', true)
            .order('usage_count', { ascending: false });

        if (brandId) {
            query = query.or(`brand_id.eq.${brandId},brand_id.is.null`);
        }

        const { data, error } = await query;
        if (error) { console.error('[TemplateService] getTemplates:', error); return []; }
        return data || [];
    }

    // ── Create ──────────────────────────────────────

    /**
     * Save the current campaign form config as a named template
     * @param {{ brandId: string|null, name: string, description?: string, config: object, tags?: string[] }} tpl
     * @returns {object} the created row
     */
    async saveTemplate(tpl) {
        if (!this.sb) throw new Error('No database connection');

        const { data, error } = await this.sb
            .from('campaign_templates')
            .insert({
                brand_id:    tpl.brandId || null,
                name:        tpl.name,
                description: tpl.description || '',
                config:      tpl.config,
                tags:        tpl.tags || []
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    // ── Delete (soft) ───────────────────────────────

    /**
     * Soft-delete a template
     */
    async deleteTemplate(id) {
        if (!this.sb) throw new Error('No database connection');

        const { error } = await this.sb
            .from('campaign_templates')
            .update({ is_active: false })
            .eq('id', id);

        if (error) throw error;
    }

    // ── Increment usage ─────────────────────────────

    /**
     * Bump usage counter via RPC
     */
    async incrementUsage(id) {
        if (!this.sb) return;
        await this.sb.rpc('increment_template_usage', { p_template_id: id });
    }

    // ── Helpers ─────────────────────────────────────

    /**
     * Human-readable summary of a template config
     */
    configSummary(config) {
        const parts = [];
        if (config.videoCount) parts.push(`${config.videoCount} videos`);
        if (config.postsPerDay) parts.push(`${config.postsPerDay}/day`);
        if (config.platforms?.length) parts.push(`${config.platforms.length} platforms`);
        if (config.asapMode) parts.push('ASAP');
        return parts.join(' · ') || 'Custom config';
    }

    /**
     * Tag color map (CSS class suffix)
     */
    tagColor(tag) {
        const map = {
            starter: 'primary', weekly: 'info', daily: 'info',
            'high-volume': 'warning', blitz: 'warning',
            monthly: 'success', sustained: 'success', drip: 'success'
        };
        return map[tag] || 'default';
    }
}

// Singleton
const campaignTemplateService = new CampaignTemplateService();
