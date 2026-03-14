// =====================================================
// AI INTELLIGENCE - Learning Delta Dashboard
// Shows week-over-week improvements in AI learning
// =====================================================

async function aiLoadLearningDelta() {
    const container = aiEl('learning-delta');
    if (!container) return;
    container.innerHTML = '<div class="ai-loading">Computing learning deltas…</div>';

    try {
        const plat = aiPlatformFilter();
        const now = new Date();
        const oneWeekAgo = new Date(now - 7 * 86400000);
        const twoWeeksAgo = new Date(now - 14 * 86400000);

        // Fetch posts from this week and last week
        let thisWeekQ = aiSupabase.from('posts')
            .select('id, title, description, tags, platform, posted_at, platform_content, meta')
            .eq('brand_id', aiBrandId)
            .eq('status', 'posted')
            .gte('posted_at', oneWeekAgo.toISOString())
            .order('posted_at', { ascending: false });
        let lastWeekQ = aiSupabase.from('posts')
            .select('id, title, description, tags, platform, posted_at, platform_content, meta')
            .eq('brand_id', aiBrandId)
            .eq('status', 'posted')
            .gte('posted_at', twoWeeksAgo.toISOString())
            .lt('posted_at', oneWeekAgo.toISOString())
            .order('posted_at', { ascending: false });

        if (plat) {
            thisWeekQ = thisWeekQ.eq('platform', plat);
            lastWeekQ = lastWeekQ.eq('platform', plat);
        }

        // Fetch metrics + preset weights in parallel
        const [thisWeekRes, lastWeekRes, metricsRes, presetsRes] = await Promise.all([
            thisWeekQ,
            lastWeekQ,
            aiSupabase.from('v_post_metrics_latest')
                .select('post_id, platform, views, likes, comments, shares'),
            aiSupabase.from('brand_templates')
                .select('template_type, weight')
                .eq('brand_id', aiBrandId)
                .order('weight', { ascending: false }),
        ]);

        const thisWeek = thisWeekRes.data || [];
        const lastWeek = lastWeekRes.data || [];
        const allMetrics = metricsRes.data || [];
        const presets = presetsRes.data || [];

        if (!thisWeek.length && !lastWeek.length) {
            container.innerHTML = '<p class="text-white/40 text-sm">Not enough data yet — need at least 2 weeks of posts to show learning deltas.</p>';
            return;
        }

        // Build metrics map
        const metricsMap = {};
        for (const m of allMetrics) metricsMap[m.post_id] = m;

        // Compute stats for a set of posts
        function computeStats(posts) {
            const descLens = posts.map(p => (p.description || '').length).filter(l => l > 0);
            const tagCounts = posts.map(p => (p.tags || []).length);
            const fallbacks = posts.filter(p => p.platform_content?.metadata_source?.startsWith?.('fallback')).length;
            const zeroTags = posts.filter(p => !p.tags || p.tags.length === 0).length;
            const perfs = posts.map(p => aiPerfScore(metricsMap[p.id])).filter(v => v > 0);
            const vibes = {};
            for (const p of posts) {
                const v = p.meta?.vibe_preset || 'unknown';
                vibes[v] = (vibes[v] || 0) + 1;
            }

            return {
                count: posts.length,
                avgDescLen: descLens.length ? Math.round(descLens.reduce((a, b) => a + b, 0) / descLens.length) : 0,
                avgTags: tagCounts.length ? +(tagCounts.reduce((a, b) => a + b, 0) / tagCounts.length).toFixed(1) : 0,
                fallbackRate: posts.length ? Math.round(fallbacks / posts.length * 100) : 0,
                zeroTagRate: posts.length ? Math.round(zeroTags / posts.length * 100) : 0,
                avgPerf: perfs.length ? Math.round(perfs.reduce((a, b) => a + b, 0) / perfs.length) : 0,
                vibes,
            };
        }

        const tw = computeStats(thisWeek);
        const lw = computeStats(lastWeek);

        // Delta helper
        function delta(current, previous, lowerIsBetter = false) {
            if (!previous || previous === 0) return { val: 0, dir: 'neutral', pct: 0 };
            const pct = Math.round(((current - previous) / previous) * 100);
            let dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral';
            if (lowerIsBetter) dir = dir === 'up' ? 'down' : dir === 'down' ? 'up' : 'neutral';
            return { val: pct, dir, pct: Math.abs(pct) };
        }

        const descDelta = delta(tw.avgDescLen, lw.avgDescLen, true);
        const tagDelta = delta(tw.avgTags, lw.avgTags);
        const fallbackDelta = delta(tw.fallbackRate, lw.fallbackRate, true);
        const zeroTagDelta = delta(tw.zeroTagRate, lw.zeroTagRate, true);
        const perfDelta = delta(tw.avgPerf, lw.avgPerf);

        // Arrow/color helper
        function arrow(d) {
            if (d.dir === 'up') return '<span class="text-emerald-400">▲</span>';
            if (d.dir === 'down') return '<span class="text-red-400">▼</span>';
            return '<span class="text-white/30">—</span>';
        }
        function deltaColor(d) {
            if (d.dir === 'up') return 'text-emerald-400';
            if (d.dir === 'down') return 'text-red-400';
            return 'text-white/40';
        }

        // Top vibe this week
        const topVibeThisWeek = Object.entries(tw.vibes).sort((a, b) => b[1] - a[1])[0];
        const topVibeLastWeek = Object.entries(lw.vibes).sort((a, b) => b[1] - a[1])[0];

        // Preset weight info
        const presetHtml = presets.length > 0
            ? presets.map(p => `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.06] text-xs text-white/70">${aiEscHtml(p.template_type)} <span class="text-brand-light font-medium">${p.weight}%</span></span>`).join(' ')
            : '<span class="text-white/30 text-xs">No presets configured</span>';

        container.innerHTML = `
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                ${[
                    { label: 'Avg Description', thisVal: `${tw.avgDescLen}ch`, lastVal: `${lw.avgDescLen}ch`, d: descDelta },
                    { label: 'Avg Tags', thisVal: tw.avgTags, lastVal: lw.avgTags, d: tagDelta },
                    { label: 'Fallback Rate', thisVal: `${tw.fallbackRate}%`, lastVal: `${lw.fallbackRate}%`, d: fallbackDelta },
                    { label: 'Zero-Tag Posts', thisVal: `${tw.zeroTagRate}%`, lastVal: `${lw.zeroTagRate}%`, d: zeroTagDelta },
                    { label: 'Avg Performance', thisVal: aiFmt(tw.avgPerf), lastVal: aiFmt(lw.avgPerf), d: perfDelta },
                ].map(m => `
                    <div class="rounded-xl bg-white/[0.04] border border-white/[0.06] p-3 text-center">
                        <div class="text-[10px] text-white/40 uppercase tracking-wider mb-1">${m.label}</div>
                        <div class="text-lg font-semibold text-white/90">${m.thisVal}</div>
                        <div class="text-xs ${deltaColor(m.d)} mt-0.5">
                            ${arrow(m.d)} ${m.d.pct}% vs last week
                        </div>
                        <div class="text-[10px] text-white/25 mt-0.5">was ${m.lastVal}</div>
                    </div>
                `).join('')}
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="rounded-xl bg-white/[0.04] border border-white/[0.06] p-3">
                    <div class="text-xs text-white/40 uppercase tracking-wider mb-2">Top Vibe Preset</div>
                    <div class="flex items-center gap-2">
                        <span class="text-white/80 text-sm font-medium">${topVibeThisWeek ? aiEscHtml(topVibeThisWeek[0]) : '—'}</span>
                        <span class="text-white/30 text-xs">(${topVibeThisWeek ? topVibeThisWeek[1] : 0} posts)</span>
                    </div>
                    ${topVibeLastWeek && topVibeLastWeek[0] !== topVibeThisWeek?.[0]
                        ? `<div class="text-[10px] text-white/25 mt-1">Last week: ${aiEscHtml(topVibeLastWeek[0])} (${topVibeLastWeek[1]})</div>`
                        : ''}
                </div>
                <div class="rounded-xl bg-white/[0.04] border border-white/[0.06] p-3">
                    <div class="text-xs text-white/40 uppercase tracking-wider mb-2">Current Preset Weights</div>
                    <div class="flex flex-wrap gap-1.5">${presetHtml}</div>
                </div>
            </div>

            <div class="mt-3 text-[10px] text-white/20 text-right">
                This week: ${tw.count} posts · Last week: ${lw.count} posts
            </div>
        `;
    } catch (err) {
        console.error('[AI-INTELLIGENCE] Learning delta error:', err);
        container.innerHTML = `<p class="text-red-400/60 text-sm">Failed to load learning deltas: ${aiEscHtml(err.message)}</p>`;
    }
}
