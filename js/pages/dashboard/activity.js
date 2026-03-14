// =====================================================
// DASHBOARD - Recent Activity
// =====================================================

async function dbLoadActivity() {
    const container = document.getElementById('recent-activity');
    if (!container) return;

    try {
        const { data: posts, error } = await dbSupabase
            .from('posts')
            .select('id, title, platform, status, posted_at, failed_at, updated_at, scheduled_at')
            .in('status', ['posted', 'failed', 'scheduled', 'posting', 'approved'])
            .order('updated_at', { ascending: false })
            .limit(10);

        if (error) throw error;

        if (!posts || posts.length === 0) {
            container.innerHTML = '<div class="db-empty"><span>No recent activity</span><span class="db-empty__sub">Posts appear here as they are created</span></div>';
            return;
        }

        container.innerHTML = posts.map(p => {
            const ts = p.posted_at || p.failed_at || p.updated_at;
            return `
                <div class="db-activity">
                    <div class="db-activity__icon db-activity__icon--${p.status}">
                        ${dbStatusIcon(p.status)}
                    </div>
                    <div class="db-activity__info">
                        <span class="db-activity__title">${escapeHtml(p.title || 'Untitled')}</span>
                        <div class="db-activity__meta">
                            <span class="db-badge db-badge--${dbPlatformBadge(p.platform)}">${dbPlatformLabel(p.platform)}</span>
                            <span class="db-activity__time">${dbTimeAgo(ts)}</span>
                        </div>
                    </div>
                    <span class="db-badge db-badge--${dbStatusBadge(p.status)}">${p.status}</span>
                </div>`;
        }).join('');
    } catch (e) {
        console.error('dbLoadActivity:', e);
        container.innerHTML = '<div class="db-empty"><span>Failed to load</span></div>';
    }
}
