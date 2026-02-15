// =====================================================
// TIME SLOT SERVICE
// Frontend service for time slot scoring data
// Wraps Supabase RPCs from time slot scoring (#19)
// =====================================================

class TimeSlotService {
    constructor() {
        this._initialized = false;
        this._supabase = null;
        this._cache = new Map(); // key → { data, fetchedAt }
        this._cacheTTL = 10 * 60 * 1000; // 10 min cache (scores update every 6h)
    }

    async init() {
        if (this._initialized) return;

        // Use the module-level supabaseClient variable or getSupabaseClient()
        if (typeof getSupabaseClient === 'function') {
            this._supabase = getSupabaseClient();
        } else if (typeof supabaseClient !== 'undefined' && supabaseClient !== null) {
            this._supabase = supabaseClient;
        }

        if (!this._supabase) {
            console.warn('TimeSlotService: No Supabase client available');
            return;
        }

        this._initialized = true;
        console.log('🕐 TimeSlotService initialized');
    }

    /**
     * Get best time slots for a brand/platform
     * @param {string} brandId
     * @param {string} platform
     * @param {number} windowDays - 7, 14, or 30
     * @param {number} limit - max results (default 5)
     * @returns {Promise<Array>}
     */
    async getBestTimeSlots(brandId, platform, windowDays = 30, limit = 5) {
        if (!this._supabase) return [];

        const cacheKey = `best_${brandId}_${platform}_${windowDays}_${limit}`;
        const cached = this._cache.get(cacheKey);
        if (cached && Date.now() - cached.fetchedAt < this._cacheTTL) {
            return cached.data;
        }

        try {
            const { data, error } = await this._supabase
                .rpc('get_best_time_slots', {
                    p_brand_id: brandId,
                    p_platform: platform,
                    p_window_days: windowDays,
                    p_limit: limit,
                });

            if (error) {
                console.error('TimeSlotService.getBestTimeSlots error:', error.message);
                return [];
            }

            const result = data || [];
            this._cache.set(cacheKey, { data: result, fetchedAt: Date.now() });
            return result;
        } catch (e) {
            console.error('TimeSlotService.getBestTimeSlots error:', e);
            return [];
        }
    }

    /**
     * Get full time slot grid for a brand/platform
     * @param {string} brandId
     * @param {string} platform
     * @param {number} windowDays
     * @returns {Promise<Array>}
     */
    async getTimeSlotScores(brandId, platform, windowDays = 30) {
        if (!this._supabase) return [];

        const cacheKey = `grid_${brandId}_${platform}_${windowDays}`;
        const cached = this._cache.get(cacheKey);
        if (cached && Date.now() - cached.fetchedAt < this._cacheTTL) {
            return cached.data;
        }

        try {
            const { data, error } = await this._supabase
                .rpc('get_time_slot_scores', {
                    p_brand_id: brandId,
                    p_platform: platform,
                    p_window_days: windowDays,
                });

            if (error) {
                console.error('TimeSlotService.getTimeSlotScores error:', error.message);
                return [];
            }

            const result = data || [];
            this._cache.set(cacheKey, { data: result, fetchedAt: Date.now() });
            return result;
        } catch (e) {
            console.error('TimeSlotService.getTimeSlotScores error:', e);
            return [];
        }
    }

    /**
     * Build a "Best Times" chip HTML for a slot
     * @param {Object} slot - { day_name, hour_label, avg_views, sample_size, score }
     * @returns {string}
     */
    buildSlotChipHTML(slot) {
        const avgViews = this._formatCount(slot.avg_views);
        return `
            <div class="best-times__chip" title="Score: ${Math.round(slot.score)} · ${slot.sample_size} posts">
                <span class="best-times__chip-time">${slot.day_name} ${slot.hour_label}</span>
                <span class="best-times__chip-stat">${avgViews} avg views · ${slot.sample_size} posts</span>
            </div>
        `;
    }

    /**
     * Build the full Best Times panel content
     * @param {Array} slots - Array from getBestTimeSlots
     * @returns {string}
     */
    buildBestTimesHTML(slots) {
        if (!slots || slots.length === 0) {
            return `
                <div class="best-times__empty">
                    <span>Not enough data — need at least 3 posts per time slot</span>
                </div>
            `;
        }

        return `
            <div class="best-times__results">
                ${slots.map(s => this.buildSlotChipHTML(s)).join('')}
            </div>
        `;
    }

    /**
     * Format a number for display (1234 → "1.2K")
     */
    _formatCount(num) {
        if (num == null || isNaN(num)) return '0';
        num = Math.round(num);
        if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
        return String(num);
    }

    clearCache() {
        this._cache.clear();
    }
}

// Export global singleton
window.timeSlotService = new TimeSlotService();
