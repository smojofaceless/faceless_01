// =====================================================
// DASHBOARD - Stats Cards
// =====================================================

async function dbLoadStats() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString();

    try {
        const [todayRes, weekRes, scheduledRes, failedRes, queueRes, nextPostRes] = await Promise.all([
            dbSupabase.from('posts').select('id', { count: 'exact', head: true })
                .eq('status', 'posted').gte('posted_at', todayStart),
            dbSupabase.from('posts').select('id', { count: 'exact', head: true })
                .eq('status', 'posted').gte('posted_at', weekStart),
            dbSupabase.from('posts').select('id', { count: 'exact', head: true })
                .in('status', ['scheduled', 'approved']),
            dbSupabase.from('posts').select('id', { count: 'exact', head: true })
                .eq('status', 'failed'),
            dbSupabase.from('posts').select('id', { count: 'exact', head: true })
                .in('status', ['scheduled', 'approved', 'posting']),
            dbSupabase.from('posts').select('scheduled_at')
                .in('status', ['scheduled', 'approved'])
                .not('scheduled_at', 'is', null)
                .gte('scheduled_at', now.toISOString())
                .order('scheduled_at', { ascending: true }).limit(1)
        ]);

        dbSetText('stat-posts-today', todayRes.count || 0);
        dbSetText('stat-week', weekRes.count || 0);
        dbSetText('stat-scheduled', scheduledRes.count || 0);
        dbSetText('stat-failed', failedRes.count || 0);
        dbSetText('queue-count', queueRes.count || 0);

        const nextEl = document.getElementById('next-post-status');
        if (nextEl) {
            const next = nextPostRes.data?.[0];
            const valEl = nextEl.querySelector('.db-ticker__value');
            if (valEl) valEl.textContent = next ? dbScheduleStr(next.scheduled_at) : 'None';
        }
    } catch (e) {
        console.error('dbLoadStats:', e);
    }
}
