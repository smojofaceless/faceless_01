// =====================================================
// DASHBOARD - Preset Performance
// =====================================================

async function dbLoadPresets() {
    const container = document.getElementById('preset-performance');
    if (!container) return;

    try {
        let jobQuery = dbSupabase.from('jobs')
            .select('id, vibe_preset, status')
            .not('vibe_preset', 'is', null);

        if (dbActiveBrandId) jobQuery = jobQuery.eq('brand_id', dbActiveBrandId);

        const { data: jobs, error } = await jobQuery;
        if (error) throw error;

        if (!jobs || jobs.length === 0) {
            container.innerHTML = '<div class="db-empty"><span>No preset data yet</span><span class="db-empty__sub">Complete jobs to see performance</span></div>';
            return;
        }

        const jobIds = jobs.map(j => j.id);
        const { data: posts } = await dbSupabase.from('posts').select('id, job_id').in('job_id', jobIds);
        const jobToPost = {};
        (posts || []).forEach(p => { jobToPost[p.job_id] = p.id; });

        const postIds = Object.values(jobToPost);
        let metricsMap = {};
        if (postIds.length > 0) {
            const { data: metrics } = await dbSupabase
                .from('v_post_metrics_latest')
                .select('post_id, views, likes')
                .in('post_id', postIds);
            if (metrics) metrics.forEach(m => { metricsMap[m.post_id] = m; });
        }

        const byPreset = {};
        jobs.forEach(j => {
            const key = j.vibe_preset;
            if (!byPreset[key]) byPreset[key] = { jobs: 0, completed: 0, views: 0, likes: 0 };
            byPreset[key].jobs++;
            if (j.status === 'complete' || j.status === 'completed') byPreset[key].completed++;
            const postId = jobToPost[j.id];
            const m = postId ? metricsMap[postId] : null;
            if (m) {
                byPreset[key].views += (m.views || 0);
                byPreset[key].likes += (m.likes || 0);
            }
        });

        const sorted = Object.entries(byPreset).sort((a, b) => b[1].views - a[1].views);
        const maxViews = Math.max(...sorted.map(([, d]) => d.views), 1);

        container.innerHTML = `<div class="db-presets">${sorted.map(([preset, d]) => {
            const pct = Math.round((d.views / maxViews) * 100);
            const name = preset.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            return `
                <div class="db-preset">
                    <div class="db-preset__header">
                        <span class="db-preset__name">${name}</span>
                        <span class="db-preset__stat">${dbFmt(d.views)} views &middot; ${d.jobs} jobs</span>
                    </div>
                    <div class="db-preset__track">
                        <div class="db-preset__fill" style="width:${Math.max(pct, 3)}%"></div>
                    </div>
                </div>`;
        }).join('')}</div>`;
    } catch (e) {
        console.error('dbLoadPresets:', e);
        container.innerHTML = '<div class="db-empty"><span>Failed to load</span></div>';
    }
}
