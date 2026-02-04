// =====================================================
// SCHEDULER SERVICE
// Handles automated scheduling and queue processing
// =====================================================

/**
 * Scheduler - manages automated posting schedules
 */
class Scheduler {
    constructor() {
        this.schedules = new Map();    // Schedule storage
        this.timers = new Map();       // Active timers
        this.isRunning = false;
        this.checkInterval = 60000;    // Check every minute
        this.mainTimer = null;
    }

    // ==================== Schedule Management ====================

    /**
     * Add a schedule
     * @param {Schedule} schedule - Schedule to add
     */
    addSchedule(schedule) {
        this.schedules.set(schedule.id, schedule);
        this.persist();
    }

    /**
     * Get a schedule
     * @param {string} id - Schedule ID
     * @returns {Schedule|null}
     */
    getSchedule(id) {
        return this.schedules.get(id) || null;
    }

    /**
     * Update a schedule
     * @param {string} id - Schedule ID
     * @param {Object} updates - Updates to apply
     */
    updateSchedule(id, updates) {
        const schedule = this.schedules.get(id);
        if (!schedule) return;

        Object.assign(schedule, updates);
        schedule.updatedAt = new Date();
        this.persist();
    }

    /**
     * Delete a schedule
     * @param {string} id - Schedule ID
     */
    deleteSchedule(id) {
        this.schedules.delete(id);
        this.persist();
    }

    /**
     * Get all schedules
     * @returns {Schedule[]}
     */
    getAllSchedules() {
        return Array.from(this.schedules.values());
    }

    /**
     * Get schedules for a brand
     * @param {string} brandId - Brand ID
     * @returns {Schedule[]}
     */
    getSchedulesForBrand(brandId) {
        return this.getAllSchedules().filter(s => s.brandId === brandId);
    }

    // ==================== Slot Calculation ====================

    /**
     * Get all available slots for a date range
     * @param {Date} start - Start date
     * @param {Date} end - End date
     * @param {Object} filters - Optional filters
     * @returns {Array} Array of slot objects
     */
    getSlotsInRange(start, end, filters = {}) {
        const slots = [];

        this.getAllSchedules()
            .filter(schedule => {
                if (!schedule.enabled) return false;
                if (filters.brandId && schedule.brandId !== filters.brandId) return false;
                if (filters.platformId && schedule.platformId && schedule.platformId !== filters.platformId) return false;
                return true;
            })
            .forEach(schedule => {
                const scheduleSlots = schedule.getSlotsInRange(start, end);
                scheduleSlots.forEach(slotTime => {
                    slots.push({
                        time: slotTime,
                        scheduleId: schedule.id,
                        brandId: schedule.brandId,
                        platformId: schedule.platformId,
                        scheduleName: schedule.name
                    });
                });
            });

        return slots.sort((a, b) => a.time - b.time);
    }

    /**
     * Get next available slot
     * @param {string} brandId - Brand ID
     * @param {string} platformId - Platform ID (optional)
     * @returns {Object|null} Next slot info
     */
    getNextSlot(brandId, platformId = null) {
        const now = new Date();
        const schedules = this.getSchedulesForBrand(brandId)
            .filter(s => s.enabled && (!platformId || !s.platformId || s.platformId === platformId));

        let nextSlot = null;

        schedules.forEach(schedule => {
            const slot = schedule.getNextSlot(now);
            if (slot && (!nextSlot || slot < nextSlot.time)) {
                nextSlot = {
                    time: slot,
                    scheduleId: schedule.id,
                    brandId: schedule.brandId,
                    platformId: schedule.platformId
                };
            }
        });

        return nextSlot;
    }

    /**
     * Find gaps in the posting schedule
     * @param {Date} start - Start date
     * @param {Date} end - End date
     * @param {string} brandId - Brand ID
     * @returns {Array} Array of gap periods
     */
    findGaps(start, end, brandId) {
        const slots = this.getSlotsInRange(start, end, { brandId });
        const gaps = [];
        
        if (slots.length === 0) {
            gaps.push({ start, end, duration: end - start });
            return gaps;
        }

        // Check gap at start
        if (slots[0].time - start > 24 * 60 * 60 * 1000) {
            gaps.push({ 
                start, 
                end: slots[0].time, 
                duration: slots[0].time - start 
            });
        }

        // Check gaps between slots
        for (let i = 0; i < slots.length - 1; i++) {
            const gapDuration = slots[i + 1].time - slots[i].time;
            if (gapDuration > 48 * 60 * 60 * 1000) { // More than 48 hours
                gaps.push({
                    start: slots[i].time,
                    end: slots[i + 1].time,
                    duration: gapDuration
                });
            }
        }

        // Check gap at end
        const lastSlot = slots[slots.length - 1];
        if (end - lastSlot.time > 24 * 60 * 60 * 1000) {
            gaps.push({
                start: lastSlot.time,
                end,
                duration: end - lastSlot.time
            });
        }

        return gaps;
    }

    // ==================== Auto-Scheduling ====================

    /**
     * Auto-schedule a post to the next available slot
     * @param {Post} post - Post to schedule
     * @returns {Date|null} Scheduled time
     */
    autoSchedule(post) {
        const slot = this.getNextSlot(post.brandId, post.platformId);
        if (!slot) return null;

        post.schedule(slot.time);
        return slot.time;
    }

    /**
     * Fill schedule with queued posts
     * @param {string} brandId - Brand ID
     * @param {Post[]} queuedPosts - Posts to schedule
     * @returns {number} Number of posts scheduled
     */
    fillSchedule(brandId, queuedPosts) {
        let scheduled = 0;
        const now = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 7); // Look 7 days ahead

        const slots = this.getSlotsInRange(now, endDate, { brandId });
        
        // Get already scheduled times to avoid conflicts
        const scheduledTimes = new Set(
            postManager.getScheduled()
                .filter(p => p.brandId === brandId)
                .map(p => p.scheduledAt.getTime())
        );

        // Filter available slots
        const availableSlots = slots.filter(s => !scheduledTimes.has(s.time.getTime()));

        // Assign posts to slots
        for (let i = 0; i < Math.min(queuedPosts.length, availableSlots.length); i++) {
            const post = queuedPosts[i];
            const slot = availableSlots[i];
            
            post.schedule(slot.time);
            scheduled++;
        }

        return scheduled;
    }

    // ==================== Scheduler Control ====================

    /**
     * Start the scheduler
     */
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        console.log('📅 Scheduler started');

        // Run immediately
        this.tick();

        // Set up interval
        this.mainTimer = setInterval(() => this.tick(), this.checkInterval);
    }

    /**
     * Stop the scheduler
     */
    stop() {
        this.isRunning = false;
        
        if (this.mainTimer) {
            clearInterval(this.mainTimer);
            this.mainTimer = null;
        }

        console.log('📅 Scheduler stopped');
    }

    /**
     * Main tick - check for posts to publish
     */
    async tick() {
        if (!this.isRunning) return;

        try {
            await postManager.processScheduledPosts((brandId, platformId) => {
                // Get account for this brand/platform combination
                return accountManager.getActiveAccount(brandId, platformId);
            });
        } catch (error) {
            console.error('Scheduler tick error:', error);
        }
    }

    // ==================== Persistence ====================

    persist() {
        try {
            const data = this.getAllSchedules().map(s => s.toJSON());
            localStorage.setItem('contentengine_schedules', JSON.stringify(data));
        } catch (e) {
            console.error('Failed to persist schedules:', e);
        }
    }

    load() {
        try {
            const data = localStorage.getItem('contentengine_schedules');
            if (data) {
                const schedules = JSON.parse(data);
                schedules.forEach(s => {
                    const schedule = Schedule.fromJSON(s);
                    this.schedules.set(schedule.id, schedule);
                });
            }
        } catch (e) {
            console.error('Failed to load schedules:', e);
        }
    }
}

/**
 * Account Manager - manages platform accounts
 */
class AccountManager {
    constructor() {
        this.accounts = new Map();
    }

    /**
     * Add an account
     * @param {PlatformAccount} account
     */
    add(account) {
        this.accounts.set(account.id, account);
        this.persist();
    }

    /**
     * Get account by ID
     * @param {string} id
     * @returns {PlatformAccount|null}
     */
    get(id) {
        return this.accounts.get(id) || null;
    }

    /**
     * Get all accounts
     * @returns {PlatformAccount[]}
     */
    getAll() {
        return Array.from(this.accounts.values());
    }

    /**
     * Get accounts for a brand
     * @param {string} brandId
     * @returns {PlatformAccount[]}
     */
    getForBrand(brandId) {
        return this.getAll().filter(a => a.brandId === brandId);
    }

    /**
     * Get account for brand/platform combination
     * @param {string} brandId
     * @param {string} platformId
     * @returns {PlatformAccount|null}
     */
    getAccount(brandId, platformId) {
        return this.getAll().find(a => 
            a.brandId === brandId && 
            a.platformId === platformId
        ) || null;
    }

    /**
     * Get active account for posting
     * @param {string} brandId
     * @param {string} platformId
     * @returns {PlatformAccount|null}
     */
    getActiveAccount(brandId, platformId) {
        const account = this.getAccount(brandId, platformId);
        return account?.isActive() ? account : null;
    }

    /**
     * Delete an account
     * @param {string} id
     */
    delete(id) {
        this.accounts.delete(id);
        this.persist();
    }

    persist() {
        try {
            const data = this.getAll().map(a => a.toJSON());
            localStorage.setItem('contentengine_accounts', JSON.stringify(data));
        } catch (e) {
            console.error('Failed to persist accounts:', e);
        }
    }

    load() {
        try {
            const data = localStorage.getItem('contentengine_accounts');
            if (data) {
                const accounts = JSON.parse(data);
                accounts.forEach(a => {
                    const account = PlatformAccount.fromJSON(a);
                    this.accounts.set(account.id, account);
                });
            }
        } catch (e) {
            console.error('Failed to load accounts:', e);
        }
    }
}

// Create singleton instances
const scheduler = new Scheduler();
const accountManager = new AccountManager();

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Scheduler, scheduler, AccountManager, accountManager };
}
