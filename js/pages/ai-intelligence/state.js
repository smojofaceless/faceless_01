// =====================================================
// AI INTELLIGENCE - Shared State
// =====================================================

let aiSupabase = null;
let aiBrandId = null;
let aiCurrentPlatform = 'all';
let aiCurrentTab = 'overview';

const AI_PLATFORMS = [
    { key: 'all', label: 'All Platforms' },
    { key: 'youtube_shorts', label: 'YouTube' },
    { key: 'instagram_reels', label: 'Instagram' },
    { key: 'facebook_reels', label: 'Facebook' },
];

const AI_PLATFORM_LABELS = {
    youtube_shorts: 'YouTube', youtube: 'YouTube',
    instagram_reels: 'Instagram', instagram: 'Instagram',
    facebook_reels: 'Facebook', facebook: 'Facebook',
    tiktok: 'TikTok', tiktok_videos: 'TikTok',
    x: 'X', twitter: 'X', threads: 'Threads',
};

const AI_PLATFORM_SHORT = {
    youtube_shorts: 'YT', instagram_reels: 'IG',
    facebook_reels: 'FB', tiktok: 'TT',
};

const AI_PLATFORM_COLORS = {
    youtube_shorts: '#ff0000', instagram_reels: '#e1306c',
    facebook_reels: '#1877f2', tiktok: '#00f2ea',
    threads: '#000000',
};

const AI_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
