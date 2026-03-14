// =====================================================
// CALENDAR PAGE - Utility Functions
// Shared helpers used across calendar modules
// =====================================================

/**
 * Get CSS class for post status
 * @param {string} status
 * @returns {string} CSS class suffix
 */
function getStatusClass(status) {
    const classes = {
        published: 'success',
        posted: 'success',
        complete: 'success',
        scheduled: 'warning',
        failed: 'error',
        draft: 'default',
        queued: 'info',
        publishing: 'info',
        posting: 'info',
        pending: 'default',
        generating: 'info',
        approved: 'warning',
        cancelled: 'default'
    };
    return classes[status] || 'default';
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Format date and time
 * @param {Date|string} date
 * @returns {string}
 */
function formatDateTime(date) {
    if (!date) return 'Not set';
    const d = new Date(date);
    return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

/**
 * Format time only
 * @param {Date|string} date
 * @returns {string}
 */
function formatTime(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

/**
 * Format duration in seconds to readable string
 * @param {number} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get human-readable display name for a platform
 * @param {string} platformId
 * @returns {string}
 */
function getPlatformDisplayName(platformId) {
    const names = {
        youtube_shorts: 'YouTube Shorts',
        tiktok: 'TikTok',
        instagram_reels: 'Instagram Reels',
        facebook_reels: 'Facebook Reels',
        youtube: 'YouTube',
        instagram: 'Instagram',
        facebook: 'Facebook',
        twitter: 'Twitter',
        threads: 'Threads'
    };
    return names[platformId] || platformId;
}

/**
 * Get short label for platform chip
 * @param {string} platformId
 * @returns {string}
 */
function getPlatformShortLabel(platformId) {
    const labels = {
        youtube_shorts: 'YT',
        tiktok: 'TT',
        instagram_reels: 'IG',
        facebook_reels: 'FB',
        youtube: 'YT',
        instagram: 'IG',
        facebook: 'FB',
        twitter: 'X',
        threads: 'TH'
    };
    return labels[platformId] || platformId?.substring(0, 2)?.toUpperCase() || '??';
}
