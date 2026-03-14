// =====================================================
// DASHBOARD - Helper Utilities
// =====================================================

function dbFmt(n) {
    if (n == null) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
}

function dbNormalizePlatform(p) {
    const m = {
        youtube_shorts: 'youtube', youtube: 'youtube',
        instagram_reels: 'instagram', instagram: 'instagram',
        facebook_reels: 'facebook', facebook: 'facebook',
        tiktok: 'tiktok', tiktok_videos: 'tiktok',
        x: 'x', twitter: 'x'
    };
    return m[p] || p;
}

function dbPlatformLabel(p) {
    const m = {
        youtube_shorts: 'YouTube', youtube: 'YouTube',
        instagram_reels: 'Instagram', instagram: 'Instagram',
        facebook_reels: 'Facebook', facebook: 'Facebook',
        tiktok: 'TikTok', tiktok_videos: 'TikTok',
        x: 'X', twitter: 'X', threads: 'Threads'
    };
    return m[p] || p;
}

function dbPlatformColor(p) {
    const m = {
        youtube_shorts: '#FF4444', youtube: '#FF4444',
        instagram_reels: '#E1306C', instagram: '#E1306C',
        facebook_reels: '#1877F2', facebook: '#1877F2',
        tiktok: '#00f2ea', tiktok_videos: '#00f2ea',
        x: '#a0a0b8', twitter: '#a0a0b8', threads: '#a0a0b8'
    };
    return m[p] || '#8b5cf6';
}

function dbPlatformBadge(p) {
    const m = {
        youtube_shorts: 'youtube', youtube: 'youtube',
        instagram_reels: 'instagram', instagram: 'instagram',
        facebook_reels: 'facebook', facebook: 'facebook',
        tiktok: 'tiktok', tiktok_videos: 'tiktok',
        x: 'x', twitter: 'x', threads: 'threads'
    };
    return m[p] || '';
}

function dbStatusBadge(s) {
    return { posted: 'success', scheduled: 'warning', approved: 'info',
             posting: 'warning', failed: 'error', draft: 'default',
             cancelled: 'default' }[s] || 'default';
}

function dbStatusIcon(s) {
    const icons = {
        posted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
        scheduled: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
        approved: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
        posting: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
        failed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'
    };
    return icons[s] || icons.approved;
}

function dbTimeAgo(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    const now = new Date();
    const diff = d - now;
    const abs = Math.abs(diff);
    const past = diff < 0;
    const mins = Math.floor(abs / 60000);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);
    if (mins < 1) return past ? 'Just now' : 'Now';
    if (mins < 60) return past ? `${mins}m ago` : `In ${mins}m`;
    if (hrs < 24) return past ? `${hrs}h ago` : `In ${hrs}h`;
    if (days < 7) return past ? `${days}d ago` : `In ${days}d`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dbScheduleStr(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isToday = d.toDateString() === today.toDateString();
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (isToday) return `Today ${time}`;
    if (isTomorrow) return `Tomorrow ${time}`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + time;
}

function dbSetText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = typeof val === 'number' ? val.toLocaleString() : val;
}
