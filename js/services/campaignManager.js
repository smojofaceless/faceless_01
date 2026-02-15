// =====================================================
// CAMPAIGN MANAGER SERVICE
// Handles campaign creation, scheduling, and lifecycle
// 
// Reference: CAMPAIGN_SYSTEM.md v1.2
// =====================================================

/**
 * Campaign Manager - handles campaign CRUD and scheduling logic
 * 
 * Core principle: "Campaigns PLAN. Workers EXECUTE."
 * - Campaign creation is synchronous and fast
 * - No external API calls during campaign creation
 * - All scheduling is pre-computed
 */
class CampaignManager {
    constructor() {
        this.initialized = false;
        
        // Default scheduling configuration (EST timezone)
        this.defaults = {
            timezone: 'America/New_York',
            windowA: '12:00',      // 12:00 PM EST
            windowB: '18:00',      // 6:00 PM EST
            jitterRangeMinutes: 30,
            generationLeadTimeHours: 24,
            platformOffsets: {
                youtube: 0,
                instagram: 15,
                tiktok: 45
            },
            duration: {
                minSeconds: 60,
                maxSeconds: 90
            }
        };
    }

    // ==================== Initialization ====================

    async init() {
        if (this.initialized) return;
        
        // Check Supabase availability
        if (typeof supabaseClient === 'undefined' || !supabaseClient) {
            console.warn('CampaignManager: Supabase not available');
            return;
        }
        
        this.initialized = true;
        console.log('📋 CampaignManager: Initialized');
    }

    // ==================== Campaign CRUD ====================

    /**
     * Create a campaign with N jobs atomically
     * Uses Supabase RPC for transaction safety
     * 
     * @param {Object} options - Campaign options
     * @param {string} options.brandId - Brand ID (required)
     * @param {string} options.name - Campaign name (optional)
     * @param {number} options.videoCount - Number of videos (1-100)
     * @param {string[]} options.platforms - Target platforms
     * @param {Date} options.startDate - Start date
     * @param {number} options.postsPerDay - Posts per day (1-3)
     * @param {Object} options.config - Advanced configuration
     * @returns {Promise<{campaignId: string, jobs: Array}>}
     */
    async createCampaign(options) {
        const {
            brandId,
            name,
            videoCount,
            platforms,
            startDate,
            postsPerDay = 1,
            presetWeights = null, // null = use brand_templates defaults
            precomputedSchedule = null, // Reuse preview schedule to preserve preset selections
            config = {}
        } = options;

        // Validate inputs
        this._validateCampaignInputs(options);

        console.log('[CampaignManager] Creating campaign:', { brandId, videoCount, platforms, startDate });

        // Load preset weights from brand_templates if not overridden
        const weights = presetWeights || config.presetWeights || await this._loadPresetWeights(brandId);
        console.log('[CampaignManager] Using preset weights:', weights);

        // Support both formats: windowA/windowB or windows array
        let windowA, windowB;
        if (config.windows && Array.isArray(config.windows) && config.windows.length > 0) {
            windowA = config.windows[0] || this.defaults.windowA;
            windowB = config.windows[1] || config.windows[0] || this.defaults.windowB;
        } else {
            windowA = config.windowA || this.defaults.windowA;
            windowB = config.windowB || this.defaults.windowB;
        }
        
        // Support both jitter names
        const jitterRange = config.jitterRangeMinutes ?? config.jitterMinutes ?? this.defaults.jitterRangeMinutes;
        
        // Support both platform offset names
        const platformOffsets = config.platformOffsets ?? config.platformOffsetMinutes ?? this.defaults.platformOffsets;

        // Reuse preview schedule if available (preserves exact preset selections user saw)
        // Normalize property names: preview uses scheduledAt/preset, schedule uses scheduled_post_at/vibe_preset
        let schedule;
        if (precomputedSchedule && precomputedSchedule.length === videoCount) {
            schedule = precomputedSchedule.map((item, i) => ({
                index: i,
                scheduled_post_at: item.scheduled_post_at || item.scheduledAt,
                generate_by: item.generate_by || new Date(new Date(item.scheduled_post_at || item.scheduledAt).getTime() - (config.generationLeadTimeHours || this.defaults.generationLeadTimeHours) * 3600000).toISOString(),
                window_used: item.window_used || 'preview',
                jitter_applied_minutes: item.jitter_applied_minutes ?? 0,
                platform_offsets: item.platform_offsets || {},
                vibe_preset: item.vibe_preset || item.preset,
                preset_selection_method: 'weighted_random',
                asap_mode: item.asap_mode || false
            }));
            console.log('[CampaignManager] Reusing preview schedule:', schedule.length, 'jobs (presets preserved)');
        } else {
            schedule = this._generateSchedule({
                videoCount,
                startDate: new Date(startDate),
                postsPerDay,
                windowA,
                windowB,
                jitterRange,
                platforms,
                platformOffsets,
                presetWeights: weights,
                generationLeadTimeHours: config.generationLeadTimeHours || this.defaults.generationLeadTimeHours,
                duration: config.duration || this.defaults.duration,
                asapMode: config.asapMode || false
            });
            console.log('[CampaignManager] Generated new schedule:', schedule.length, 'jobs');
        }

        // Build campaign config (use resolved values)
        const campaignConfig = {
            mode: config.mode || 'auto',
            start_date: startDate,
            posts_per_day: postsPerDay,
            platforms,
            timezone: this.defaults.timezone,
            windows: {
                window_a: windowA,
                window_b: windowB,
                jitter_range_minutes: jitterRange
            },
            platform_offsets: platformOffsets,
            preset_weights: weights,
            duration: config.duration || this.defaults.duration,
            generation_lead_time_hours: config.generationLeadTimeHours || this.defaults.generationLeadTimeHours,
            computed_schedule: schedule.map((s, i) => ({
                index: i,
                scheduled_post_at: s.scheduled_post_at,
                generate_by: s.generate_by,
                window_used: s.window_used,
                jitter_minutes: s.jitter_applied_minutes,
                vibe_preset: s.vibe_preset
            }))
        };

        // Build jobs array for RPC
        const sceneCountOverride = config.sceneCount || 0; // 0 = auto
        const jobs = schedule.map((s, index) => ({
            vibe_preset: s.vibe_preset,
            scheduled_post_at: s.scheduled_post_at,
            meta: {
                campaign_index: index,
                window_used: s.window_used,
                jitter_applied_minutes: s.jitter_applied_minutes,
                platforms,
                platform_offsets: s.platform_offsets,
                preset_selection_method: 'weighted_random',
                duration: config.duration || this.defaults.duration,
                generate_by: s.generate_by,
                ...(sceneCountOverride > 0 ? { scene_count: sceneCountOverride } : {})
            }
        }));

        // Call RPC for atomic creation
        const { data, error } = await supabaseClient.rpc('create_campaign', {
            p_brand_id: brandId,
            p_name: name || null,
            p_video_count: videoCount,
            p_config: campaignConfig,
            p_jobs: jobs
        });

        if (error) {
            console.error('[CampaignManager] RPC error:', error);
            throw new Error(`Failed to create campaign: ${error.message}`);
        }

        console.log('[CampaignManager] ✅ Campaign created:', data);

        return {
            campaignId: data,
            schedule
        };
    }

    /**
     * Get campaign by ID with summary stats
     */
    async getCampaign(campaignId) {
        const { data, error } = await supabaseClient.rpc('get_campaign_summary', {
            p_campaign_id: campaignId
        });

        if (error) {
            throw new Error(`Failed to get campaign: ${error.message}`);
        }

        return data;
    }

    /**
     * Get all campaigns for a brand with statistics
     * Uses RPC for enriched data with job/post counts
     */
    async getCampaignsByBrand(brandId, options = {}) {
        const { limit = 20, status = null } = options;

        // Try to use the enriched RPC first
        const { data: rpcData, error: rpcError } = await supabaseClient.rpc(
            'get_campaign_stats_by_brand',
            {
                p_brand_id: brandId,
                p_limit: limit,
                p_status: status
            }
        );

        // If RPC works, return enriched data
        if (!rpcError && rpcData) {
            console.log('[CampaignManager] Loaded campaigns with stats:', rpcData.length);
            return rpcData;
        }

        // Fallback to basic query if RPC not available
        console.warn('[CampaignManager] RPC not available, using fallback:', rpcError?.message);
        
        let query = supabaseClient
            .from('generation_batches')
            .select('*')
            .eq('brand_id', brandId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (status) {
            query = query.eq('status', status);
        }

        const { data, error } = await query;

        if (error) {
            throw new Error(`Failed to get campaigns: ${error.message}`);
        }

        return data;
    }

    /**
     * Get jobs for a campaign
     */
    async getCampaignJobs(campaignId) {
        // Fetch jobs with their video URLs from job_assets
        const { data, error } = await supabaseClient
            .from('jobs')
            .select(`
                *,
                job_assets!job_assets_job_id_fkey (
                    public_url,
                    type
                )
            `)
            .eq('batch_id', campaignId)
            .order('scheduled_post_at', { ascending: true });

        if (error) {
            throw new Error(`Failed to get campaign jobs: ${error.message}`);
        }

        // Map video_url from job_assets to each job
        return data.map(job => {
            const videoAsset = job.job_assets?.find(a => a.type === 'final_mp4');
            return {
                ...job,
                video_url: videoAsset?.public_url || null,
                job_assets: undefined // Remove the raw assets from the response
            };
        });
    }

    // ==================== Campaign Lifecycle ====================

    /**
     * Pause a campaign - workers skip jobs from this campaign
     */
    async pauseCampaign(campaignId) {
        const { data, error } = await supabaseClient.rpc('update_campaign_status', {
            p_campaign_id: campaignId,
            p_new_status: 'paused',
            p_cancel_pending_jobs: false
        });

        if (error) {
            throw new Error(`Failed to pause campaign: ${error.message}`);
        }

        console.log('[CampaignManager] Campaign paused:', campaignId);
        return true;
    }

    /**
     * Resume a paused campaign
     */
    async resumeCampaign(campaignId) {
        const { data, error } = await supabaseClient.rpc('update_campaign_status', {
            p_campaign_id: campaignId,
            p_new_status: 'active',
            p_cancel_pending_jobs: false
        });

        if (error) {
            throw new Error(`Failed to resume campaign: ${error.message}`);
        }

        console.log('[CampaignManager] Campaign resumed:', campaignId);
        return true;
    }

    /**
     * Cancel a campaign - marks pending jobs as cancelled
     */
    async cancelCampaign(campaignId) {
        const { data, error } = await supabaseClient.rpc('update_campaign_status', {
            p_campaign_id: campaignId,
            p_new_status: 'cancelled',
            p_cancel_pending_jobs: true
        });

        if (error) {
            throw new Error(`Failed to cancel campaign: ${error.message}`);
        }

        console.log('[CampaignManager] Campaign cancelled:', campaignId);
        return true;
    }

    // ==================== Scheduling Logic ====================

    /**
     * Generate a schedule preview (no DB writes)
     * Returns array of scheduled items for UI preview
     */
    generateSchedulePreview(options) {
        return this._generateSchedule(options);
    }

    /**
     * Internal: Generate full schedule
     * Implements CAMPAIGN_SYSTEM.md Section 5 scheduling algorithm
     */
    _generateSchedule(options) {
        const {
            videoCount,
            startDate,
            postsPerDay,
            windowA,
            windowB,
            windows,  // Alternative: array of window times
            jitterRange,
            jitterMinutes,  // Alternative name
            platforms,
            platformOffsets,
            platformOffsetMinutes,  // Alternative name
            presetWeights,
            generationLeadTimeHours = 24,
            duration,
            asapMode = false,         // Test mode: schedule first post ~5 min from now
            asapIntervalMinutes = 10  // Interval between ASAP posts
        } = options;

        const schedule = [];
        const daysNeeded = Math.ceil(videoCount / postsPerDay);
        
        // Support both formats: windowA/windowB or windows array
        let windowATime, windowBTime;
        if (windows && Array.isArray(windows) && windows.length > 0) {
            windowATime = windows[0] || '12:00';
            windowBTime = windows[1] || windows[0] || '18:00';
        } else {
            windowATime = windowA || '12:00';
            windowBTime = windowB || '18:00';
        }
        
        // Parse window times (HH:mm format)
        const [windowAHour, windowAMin] = windowATime.split(':').map(Number);
        const [windowBHour, windowBMin] = windowBTime.split(':').map(Number);
        
        // Support both jitter names
        const jitter = jitterRange ?? jitterMinutes ?? 15;
        
        // Support both platform offset names
        const offsets = platformOffsets ?? platformOffsetMinutes ?? 5;

        // Parse startDate - handle both Date objects and string inputs
        // String dates like "2026-02-10" need 'T00:00:00' to be parsed as local time
        // Without it, JS parses as UTC which shifts the date in local timezone
        let currentDate;
        if (startDate instanceof Date) {
            currentDate = new Date(startDate);
        } else if (typeof startDate === 'string') {
            // Add time component if missing to ensure local timezone parsing
            currentDate = startDate.includes('T') 
                ? new Date(startDate) 
                : new Date(startDate + 'T00:00:00');
        } else {
            currentDate = new Date(startDate);
        }
        let videoIndex = 0;
        
        // Track "now" for skipping past times when start date is today
        const now = new Date();
        
        // ASAP mode: schedule posts starting ~5 min from now, spaced by asapIntervalMinutes
        if (asapMode) {
            console.log('[CampaignManager] 🚀 ASAP mode enabled - scheduling from now');
            const asapStart = new Date(now.getTime() + 5 * 60 * 1000); // 5 min from now
            
            for (let i = 0; i < videoCount; i++) {
                const scheduledTime = new Date(asapStart.getTime() + i * asapIntervalMinutes * 60 * 1000);
                const generateBy = new Date(scheduledTime.getTime() - 60 * 1000); // 1 min before (for ASAP)
                
                // Calculate platform-specific offsets
                const platformTimes = {};
                const appliedOffsets = {};
                for (const platform of platforms) {
                    const maxOffset = typeof offsets === 'object' ? (offsets[platform] || 0) : offsets;
                    const offset = this._randomInt(0, maxOffset);
                    appliedOffsets[platform] = offset;
                    
                    const platformTime = new Date(scheduledTime);
                    platformTime.setMinutes(platformTime.getMinutes() + offset);
                    platformTimes[platform] = platformTime.toISOString();
                }
                
                const vibePreset = this._selectPreset(presetWeights);
                
                schedule.push({
                    index: i,
                    scheduled_post_at: scheduledTime.toISOString(),
                    generate_by: generateBy.toISOString(),
                    window_used: 'ASAP',
                    jitter_applied_minutes: 0,
                    platform_times: platformTimes,
                    platform_offsets: appliedOffsets,
                    vibe_preset: vibePreset,
                    preset_selection_method: 'weighted_random',
                    asap_mode: true
                });
            }
            
            return schedule;
        }
        
        // Use while loop instead - we may need more days if we skip past times
        let day = 0;
        const maxDays = daysNeeded + 7; // Safety limit: allow up to a week of overflow

        while (videoIndex < videoCount && day < maxDays) {
            // Determine windows for this day
            const windowsForDay = this._getWindowsForDay(postsPerDay, day);

            for (const windowId of windowsForDay) {
                if (videoIndex >= videoCount) break;

                // Get base time for this window
                const windowHour = windowId === 'A' ? windowAHour : windowBHour;
                const windowMin = windowId === 'A' ? windowAMin : windowBMin;

                // Apply jitter
                const appliedJitter = this._randomInt(-jitter, jitter);
                
                // Calculate scheduled time
                const scheduledTime = new Date(currentDate);
                scheduledTime.setHours(windowHour, windowMin, 0, 0);
                scheduledTime.setMinutes(scheduledTime.getMinutes() + appliedJitter);

                // Skip times that are in the past (for same-day scheduling)
                if (scheduledTime <= now) {
                    // Don't count this as a scheduled video, we'll schedule it later
                    continue;
                }

                // Calculate generate_by time
                const generateBy = new Date(scheduledTime);
                generateBy.setHours(generateBy.getHours() - generationLeadTimeHours);

                // Calculate platform-specific offsets
                const platformTimes = {};
                const appliedOffsets = {};
                for (const platform of platforms) {
                    // offsets can be a number (uniform) or object (per-platform)
                    const maxOffset = typeof offsets === 'object' ? (offsets[platform] || 0) : offsets;
                    const offset = this._randomInt(0, maxOffset);
                    appliedOffsets[platform] = offset;
                    
                    const platformTime = new Date(scheduledTime);
                    platformTime.setMinutes(platformTime.getMinutes() + offset);
                    platformTimes[platform] = platformTime.toISOString();
                }

                // Select preset using weighted random
                const vibePreset = this._selectPreset(presetWeights);

                schedule.push({
                    index: videoIndex,
                    scheduled_post_at: scheduledTime.toISOString(),
                    generate_by: generateBy.toISOString(),
                    window_used: windowId,
                    jitter_applied_minutes: appliedJitter,
                    platform_times: platformTimes,
                    platform_offsets: appliedOffsets,
                    vibe_preset: vibePreset,
                    preset_selection_method: 'weighted_random'
                });

                videoIndex++;
            }

            // Move to next day
            currentDate.setDate(currentDate.getDate() + 1);
            day++;
        }

        return schedule;
    }

    /**
     * Get windows to use for a given day
     * Based on posts_per_day setting
     */
    _getWindowsForDay(postsPerDay, dayIndex) {
        if (postsPerDay === 1) {
            // Alternate between A and B
            return [dayIndex % 2 === 0 ? 'A' : 'B'];
        } else if (postsPerDay === 2) {
            // Both windows each day
            return ['A', 'B'];
        } else if (postsPerDay === 3) {
            // A, B, A (with different jitter ensuring separation)
            return ['A', 'B', 'A'];
        } else {
            // postsPerDay > 3: distribute evenly (simplified)
            const windows = [];
            for (let i = 0; i < postsPerDay; i++) {
                windows.push(i % 2 === 0 ? 'A' : 'B');
            }
            return windows;
        }
    }

    /**
     * Select a preset using weighted random selection
     */
    _selectPreset(weights) {
        if (!weights || Object.keys(weights).length === 0) {
            // Fallback to urban_legend if no weights
            return 'urban_legend';
        }

        // Build cumulative distribution
        const entries = Object.entries(weights);
        const totalWeight = entries.reduce((sum, [_, w]) => sum + w, 0);
        
        // Roll random number
        let roll = Math.random() * totalWeight;
        
        // Find which preset was selected
        for (const [preset, weight] of entries) {
            roll -= weight;
            if (roll <= 0) {
                return preset;
            }
        }
        
        // Fallback to first preset
        return entries[0][0];
    }

    /**
     * Load preset weights from brand_templates
     */
    async _loadPresetWeights(brandId) {
        try {
            const { data, error } = await supabaseClient
                .from('brand_templates')
                .select('template_type, weight')
                .eq('brand_id', brandId);

            if (error || !data || data.length === 0) {
                console.warn('[CampaignManager] No brand_templates found, using defaults');
                return { urban_legend: 60, one_too_many: 40 };
            }

            // Convert to weights object
            const weights = {};
            for (const row of data) {
                weights[row.template_type] = parseFloat(row.weight) || 1.0;
            }

            return weights;
        } catch (err) {
            console.error('[CampaignManager] Error loading preset weights:', err);
            return { urban_legend: 60, one_too_many: 40 };
        }
    }

    // ==================== Validation ====================

    _validateCampaignInputs(options) {
        const { brandId, videoCount, platforms, startDate } = options;

        if (!brandId) {
            throw new Error('brandId is required');
        }

        if (!videoCount || videoCount < 1 || videoCount > 100) {
            throw new Error('videoCount must be between 1 and 100');
        }

        if (!platforms || platforms.length === 0) {
            throw new Error('At least one platform is required');
        }

        if (!startDate) {
            throw new Error('startDate is required');
        }

        const start = new Date(startDate);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        
        if (start < now) {
            throw new Error('startDate cannot be in the past');
        }
    }

    // ==================== Utilities ====================

    _randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    /**
     * Format schedule for UI display
     */
    formatScheduleForDisplay(schedule) {
        return schedule.map(item => ({
            ...item,
            displayDate: new Date(item.scheduled_post_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            }),
            displayTime: new Date(item.scheduled_post_at).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            }),
            presetLabel: this._getPresetLabel(item.vibe_preset)
        }));
    }

    _getPresetLabel(preset) {
        const labels = {
            urban_legend: 'Urban Legend',
            one_too_many: 'One Too Many',
            reddit_trending_horror: 'Reddit Trending Horror',
            dark_origins: 'Dark Origins',
            slow_creepy: 'Slow Creepy',
            atmospheric: 'Atmospheric',
            punchy_shock: 'Punchy Shock'
        };
        return labels[preset] || preset;
    }
}

// Export as singleton
window.campaignManager = new CampaignManager();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.campaignManager.init();
    });
} else {
    window.campaignManager.init();
}
