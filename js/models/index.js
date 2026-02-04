// =====================================================
// MODELS INDEX
// Central export for all data models
// =====================================================

// Import models (for environments that support it)
// In browser, these are loaded via script tags

/**
 * Model Registry - provides access to all models
 */
const Models = {
    // Brand management
    Brand: typeof Brand !== 'undefined' ? Brand : null,
    BRAND_PRESETS: typeof BRAND_PRESETS !== 'undefined' ? BRAND_PRESETS : {},

    // Platform definitions
    Platform: typeof Platform !== 'undefined' ? Platform : null,
    PLATFORMS: typeof PLATFORMS !== 'undefined' ? PLATFORMS : {},
    getAllPlatforms: typeof getAllPlatforms !== 'undefined' ? getAllPlatforms : () => [],
    getPlatform: typeof getPlatform !== 'undefined' ? getPlatform : () => null,

    // Post management
    Post: typeof Post !== 'undefined' ? Post : null,
    POST_STATUS: typeof POST_STATUS !== 'undefined' ? POST_STATUS : {},

    // Scheduling
    Schedule: typeof Schedule !== 'undefined' ? Schedule : null,
    SCHEDULE_FREQUENCY: typeof SCHEDULE_FREQUENCY !== 'undefined' ? SCHEDULE_FREQUENCY : {},
    DAYS_OF_WEEK: typeof DAYS_OF_WEEK !== 'undefined' ? DAYS_OF_WEEK : [],
    PlatformAccount: typeof PlatformAccount !== 'undefined' ? PlatformAccount : null
};

// Helper function to generate UUID (if not available from utils)
if (typeof generateUUID === 'undefined') {
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

// Helper function to format bytes (if not available from utils)
if (typeof formatBytes === 'undefined') {
    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Models;
}
