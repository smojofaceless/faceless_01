// =====================================================
// DASHBOARD - Upcoming Posts
// =====================================================

async function dbLoadUpcoming() {
    const container = document.getElementById('upcoming-posts');
    if (!container) return;

    try {
        const { data: posts, error } = await dbSupabase
            .from('posts')
            .select('id, title, platform, scheduled_at, status, brand_id')
            .in('status', ['scheduled', 'approved'])
            .not('scheduled_at', 'is', null)
            .order('scheduled_at', { ascending: true })
            .limit(8);

        if (error) throw error;

        if (!posts || posts.length === 0) {
            container.innerHTML = '<div class="db-empty"><span>No scheduled posts</span><span class="db-empty__sub">Create content to see it here</span></div>';
            return;
        }

        container.innerHTML = posts.map(p => `
            <div class="db-post">
                <div class="db-post__time">${dbScheduleStr(p.scheduled_at)}</div>
                <div class="db-post__info">
                    <span class="db-post__title">${escapeHtml(p.title || 'Untitled')}</span>
                    <span class="db-badge db-badge--${dbPlatformBadge(p.platform)}">${dbPlatformLabel(p.platform)}</span>
                </div>
                <span class="db-badge db-badge--${dbStatusBadge(p.status)}">${p.status}</span>
            </div>
        `).join('');
    } catch (e) {
        console.error('dbLoadUpcoming:', e);
        container.innerHTML = '<div class="db-empty"><span>Failed to load</span></div>';
    }
}
