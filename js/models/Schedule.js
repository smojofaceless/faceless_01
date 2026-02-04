// =====================================================
// SCHEDULE MODEL
// Represents posting schedules and time slots
// =====================================================

/**
 * Schedule frequency options
 */
const SCHEDULE_FREQUENCY = {
    ONCE: 'once',           // One-time post
    DAILY: 'daily',         // Every day
    WEEKDAYS: 'weekdays',   // Monday-Friday
    WEEKENDS: 'weekends',   // Saturday-Sunday
    WEEKLY: 'weekly',       // Specific days of week
    CUSTOM: 'custom'        // Custom schedule
};

/**
 * Days of week
 */
const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

class Schedule {
    constructor(data = {}) {
        this.id = data.id || generateUUID();
        this.brandId = data.brandId || null;
        this.platformId = data.platformId || null; // null means all platforms
        this.name = data.name || 'Default Schedule';
        this.enabled = data.enabled !== false;
        
        // Frequency settings
        this.frequency = data.frequency || SCHEDULE_FREQUENCY.DAILY;
        this.days = data.days || []; // For weekly: ['monday', 'wednesday', 'friday']
        
        // Time slots (24h format)
        this.timeSlots = data.timeSlots || ['18:00'];
        
        // Timezone
        this.timezone = data.timezone || 'America/New_York';
        
        // Constraints
        this.maxPostsPerDay = data.maxPostsPerDay || 3;
        this.minHoursBetweenPosts = data.minHoursBetweenPosts || 4;
        
        // Date range (optional)
        this.startDate = data.startDate ? new Date(data.startDate) : null;
        this.endDate = data.endDate ? new Date(data.endDate) : null;
        
        // Metadata
        this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
        this.updatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date();
    }

    /**
     * Get next available posting slot
     * @param {Date} after - Start looking after this time
     * @returns {Date|null} Next available slot
     */
    getNextSlot(after = new Date()) {
        if (!this.enabled) return null;
        
        // Check date range
        if (this.endDate && after > this.endDate) return null;
        
        const startFrom = this.startDate && after < this.startDate 
            ? this.startDate 
            : after;
        
        // Find next valid day and time
        let checkDate = new Date(startFrom);
        const maxDaysToCheck = 14; // Don't look more than 2 weeks ahead
        
        for (let d = 0; d < maxDaysToCheck; d++) {
            if (this.isDayValid(checkDate)) {
                for (const timeSlot of this.timeSlots) {
                    const slotDate = this.getSlotDateTime(checkDate, timeSlot);
                    if (slotDate > startFrom) {
                        return slotDate;
                    }
                }
            }
            // Move to next day
            checkDate.setDate(checkDate.getDate() + 1);
            checkDate.setHours(0, 0, 0, 0);
        }
        
        return null;
    }

    /**
     * Get all slots for a date range
     * @param {Date} start - Start date
     * @param {Date} end - End date
     * @returns {Date[]} Array of slot times
     */
    getSlotsInRange(start, end) {
        if (!this.enabled) return [];
        
        const slots = [];
        let checkDate = new Date(start);
        checkDate.setHours(0, 0, 0, 0);
        
        while (checkDate <= end) {
            if (this.isDayValid(checkDate)) {
                for (const timeSlot of this.timeSlots) {
                    const slotDate = this.getSlotDateTime(checkDate, timeSlot);
                    if (slotDate >= start && slotDate <= end) {
                        slots.push(slotDate);
                    }
                }
            }
            checkDate.setDate(checkDate.getDate() + 1);
        }
        
        return slots;
    }

    /**
     * Check if a day is valid for this schedule
     * @param {Date} date - Date to check
     * @returns {boolean}
     */
    isDayValid(date) {
        const dayOfWeek = DAYS_OF_WEEK[date.getDay()];
        
        switch (this.frequency) {
            case SCHEDULE_FREQUENCY.ONCE:
                return true; // Handled separately
            case SCHEDULE_FREQUENCY.DAILY:
                return true;
            case SCHEDULE_FREQUENCY.WEEKDAYS:
                return date.getDay() >= 1 && date.getDay() <= 5;
            case SCHEDULE_FREQUENCY.WEEKENDS:
                return date.getDay() === 0 || date.getDay() === 6;
            case SCHEDULE_FREQUENCY.WEEKLY:
            case SCHEDULE_FREQUENCY.CUSTOM:
                return this.days.includes(dayOfWeek);
            default:
                return true;
        }
    }

    /**
     * Convert date and time slot to full datetime
     * @param {Date} date - Date
     * @param {string} timeSlot - Time in HH:MM format
     * @returns {Date}
     */
    getSlotDateTime(date, timeSlot) {
        const [hours, minutes] = timeSlot.split(':').map(Number);
        const slotDate = new Date(date);
        slotDate.setHours(hours, minutes, 0, 0);
        return slotDate;
    }

    /**
     * Add a time slot
     * @param {string} time - Time in HH:MM format
     */
    addTimeSlot(time) {
        if (!this.timeSlots.includes(time)) {
            this.timeSlots.push(time);
            this.timeSlots.sort();
            this.updatedAt = new Date();
        }
    }

    /**
     * Remove a time slot
     * @param {string} time - Time to remove
     */
    removeTimeSlot(time) {
        this.timeSlots = this.timeSlots.filter(t => t !== time);
        this.updatedAt = new Date();
    }

    /**
     * Set posting days
     * @param {string[]} days - Array of day names
     */
    setDays(days) {
        this.days = days.filter(d => DAYS_OF_WEEK.includes(d));
        this.updatedAt = new Date();
    }

    /**
     * Enable/disable schedule
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        this.updatedAt = new Date();
    }

    toJSON() {
        return {
            id: this.id,
            brandId: this.brandId,
            platformId: this.platformId,
            name: this.name,
            enabled: this.enabled,
            frequency: this.frequency,
            days: this.days,
            timeSlots: this.timeSlots,
            timezone: this.timezone,
            maxPostsPerDay: this.maxPostsPerDay,
            minHoursBetweenPosts: this.minHoursBetweenPosts,
            startDate: this.startDate?.toISOString() || null,
            endDate: this.endDate?.toISOString() || null,
            createdAt: this.createdAt.toISOString(),
            updatedAt: this.updatedAt.toISOString()
        };
    }

    static fromJSON(data) {
        return new Schedule(data);
    }

    /**
     * Create a default daily schedule
     * @param {string} brandId - Brand ID
     * @param {string} timezone - Timezone
     * @returns {Schedule}
     */
    static createDefault(brandId, timezone = 'America/New_York') {
        return new Schedule({
            brandId,
            name: 'Default Schedule',
            frequency: SCHEDULE_FREQUENCY.DAILY,
            timeSlots: ['18:00', '21:00'],
            timezone
        });
    }
}

/**
 * Account connection model - stores platform credentials per brand
 */
class PlatformAccount {
    constructor(data = {}) {
        this.id = data.id || generateUUID();
        this.brandId = data.brandId || null;
        this.platformId = data.platformId || null;
        
        // Account info
        this.accountName = data.accountName || '';
        this.accountId = data.accountId || '';      // Platform's user/page ID
        this.accountUrl = data.accountUrl || '';
        this.profileImage = data.profileImage || '';
        
        // Connection status
        this.status = data.status || 'disconnected'; // disconnected, connected, expired, error
        this.lastError = data.lastError || null;
        
        // OAuth tokens (encrypted in storage)
        this.accessToken = data.accessToken || null;
        this.refreshToken = data.refreshToken || null;
        this.tokenExpiry = data.tokenExpiry ? new Date(data.tokenExpiry) : null;
        this.scopes = data.scopes || [];
        
        // Metadata
        this.connectedAt = data.connectedAt ? new Date(data.connectedAt) : null;
        this.lastUsed = data.lastUsed ? new Date(data.lastUsed) : null;
        this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
        this.updatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date();
    }

    /**
     * Check if token is expired
     * @returns {boolean}
     */
    isTokenExpired() {
        if (!this.tokenExpiry) return true;
        return new Date() > this.tokenExpiry;
    }

    /**
     * Check if account is usable for posting
     * @returns {boolean}
     */
    isActive() {
        return this.status === 'connected' && !this.isTokenExpired();
    }

    /**
     * Update tokens after refresh
     * @param {Object} tokens - New token data
     */
    updateTokens(tokens) {
        this.accessToken = tokens.accessToken;
        if (tokens.refreshToken) {
            this.refreshToken = tokens.refreshToken;
        }
        this.tokenExpiry = tokens.expiresIn 
            ? new Date(Date.now() + tokens.expiresIn * 1000)
            : null;
        this.status = 'connected';
        this.lastError = null;
        this.updatedAt = new Date();
    }

    /**
     * Mark as connected
     * @param {Object} accountInfo - Account information
     * @param {Object} tokens - OAuth tokens
     */
    connect(accountInfo, tokens) {
        this.accountName = accountInfo.name || '';
        this.accountId = accountInfo.id || '';
        this.accountUrl = accountInfo.url || '';
        this.profileImage = accountInfo.profileImage || '';
        this.updateTokens(tokens);
        this.connectedAt = new Date();
        this.status = 'connected';
    }

    /**
     * Mark as disconnected
     */
    disconnect() {
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiry = null;
        this.status = 'disconnected';
        this.updatedAt = new Date();
    }

    /**
     * Mark as error state
     * @param {string} error - Error message
     */
    markError(error) {
        this.lastError = error;
        this.status = 'error';
        this.updatedAt = new Date();
    }

    /**
     * Record usage
     */
    recordUsage() {
        this.lastUsed = new Date();
        this.updatedAt = new Date();
    }

    toJSON() {
        return {
            id: this.id,
            brandId: this.brandId,
            platformId: this.platformId,
            accountName: this.accountName,
            accountId: this.accountId,
            accountUrl: this.accountUrl,
            profileImage: this.profileImage,
            status: this.status,
            lastError: this.lastError,
            // Don't serialize tokens directly - should be encrypted
            hasTokens: !!(this.accessToken),
            tokenExpiry: this.tokenExpiry?.toISOString() || null,
            scopes: this.scopes,
            connectedAt: this.connectedAt?.toISOString() || null,
            lastUsed: this.lastUsed?.toISOString() || null,
            createdAt: this.createdAt.toISOString(),
            updatedAt: this.updatedAt.toISOString()
        };
    }

    static fromJSON(data) {
        return new PlatformAccount(data);
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Schedule, SCHEDULE_FREQUENCY, DAYS_OF_WEEK, PlatformAccount };
}
