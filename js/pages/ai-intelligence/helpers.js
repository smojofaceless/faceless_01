// =====================================================
// AI INTELLIGENCE - Helper Utilities
// =====================================================

function aiFmt(n) {
    if (n == null) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
}

function aiPlatformFilter() {
    return aiCurrentPlatform === 'all' ? null : aiCurrentPlatform;
}

function aiNormalizePlatform(p) {
    const m = {
        youtube_shorts: 'youtube', youtube: 'youtube',
        instagram_reels: 'instagram', instagram: 'instagram',
        facebook_reels: 'facebook', facebook: 'facebook',
        tiktok: 'tiktok', tiktok_videos: 'tiktok',
        x: 'x', twitter: 'x',
    };
    return m[p] || p;
}

function aiEl(id) {
    return document.getElementById(id);
}

function aiFormatHour(h) {
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    return h > 12 ? (h - 12) + ' PM' : h + ' AM';
}

function aiClassifyHook(title) {
    if (!title) return { type: 'statement', label: 'Statement' };
    if (/^\d/.test(title)) return { type: 'number', label: 'Number-Intrigue' };
    if (/\?/.test(title)) return { type: 'question', label: 'Question-Hook' };
    if (/^(the|a|an)\s/i.test(title)) return { type: 'atmospheric', label: 'Atmospheric' };
    return { type: 'statement', label: 'Statement' };
}

function aiEscHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
}

function aiGetTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function aiPerfScore(m) {
    return m ? (m.views || 0) + 5 * (m.likes || 0) + 10 * (m.comments || 0) + 10 * (m.shares || 0) : 0;
}
