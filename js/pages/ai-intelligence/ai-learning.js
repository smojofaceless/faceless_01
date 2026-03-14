// =====================================================
// AI INTELLIGENCE - AI Learning & Growth
// =====================================================

async function aiLoadAILearningGrowth() {
    const container = aiEl('ai-learning-container');
    if (!container) return;
    container.innerHTML = '<div class="ai-loading">Analyzing AI learning growth…</div>';

    try {
        const plat = aiPlatformFilter() || 'youtube_shorts';
        const [
            postsRes, pmvRes, metadataRes, metricsRes,
            patternsRes, exemplarsRes, negExemplarsRes
        ] = await Promise.all([
            aiSupabase.from('posts')
                .select('id, title, tags, platform, posted_at, meta, job_id')
                .eq('brand_id', aiBrandId)
                .eq('status', 'posted')
                .order('posted_at', { ascending: true }),
            aiSupabase.from('post_metadata_versions')
                .select('post_id, platform, version_type, created_at, fields')
                .order('created_at', { ascending: true }),
            aiSupabase.from('post_metadata')
                .select('post_id, platform, status, error, attempt_count, created_at')
                .order('created_at', { ascending: true }),
            aiSupabase.from('v_post_metrics_latest')
                .select('post_id, platform, views, likes, comments, shares')
                .order('views', { ascending: false }),
            aiSupabase.rpc('get_winning_patterns', {
                p_brand_id: aiBrandId, p_platform: plat, p_vibe_preset: null,
            }),
            aiSupabase.rpc('get_generation_exemplars', {
                p_brand_id: aiBrandId, p_platform: plat, p_limit: 10, p_window_days: 90,
            }),
            aiSupabase.rpc('get_negative_exemplars', {
                p_brand_id: aiBrandId, p_platform: plat, p_limit: 10, p_window_days: 90,
            }),
        ]);

        const posts = postsRes.data || [];
        const pmvEntries = pmvRes.data || [];
        const metadataEntries = metadataRes.data || [];
        const allMetrics = metricsRes.data || [];
        const patterns = patternsRes.data?.[0] || null;
        const exemplars = Array.isArray(exemplarsRes.data) ? exemplarsRes.data : [];
        const negExemplars = Array.isArray(negExemplarsRes.data) ? negExemplarsRes.data : [];

        if (!posts.length) {
            container.innerHTML = '<div class="ai-empty">No posted content yet. The AI will start learning once posts go live and metrics are collected.</div>';
            return;
        }

        /* ── Build lookup maps ── */
        const metricsMap = {};
        for (const m of allMetrics) metricsMap[m.post_id] = m;

        const mdStatusMap = {};
        for (const md of metadataEntries) mdStatusMap[md.post_id + ':' + md.platform] = md;

        const pmvByPost = {};
        for (const pv of pmvEntries) { if (!pmvByPost[pv.post_id]) pmvByPost[pv.post_id] = []; pmvByPost[pv.post_id].push(pv); }

        /* ── Core Stats ── */
        const totalPosts = posts.length;
        const postsWithMetrics = posts.filter(p => metricsMap[p.id]).length;
        const postsWithAIMeta = metadataEntries.filter(md => md.status === 'ready' || md.status === 'edited').length;
        const failedMeta = metadataEntries.filter(md => md.status === 'failed').length;
        const pendingMeta = metadataEntries.filter(md => md.status === 'not_started' || md.status === 'pending').length;
        const uniqueVibes = new Set(posts.map(p => p.meta?.vibe_preset).filter(Boolean));
        const uniquePlatforms = new Set(posts.map(p => p.platform));
        const totalExemplars = exemplars.length;
        const totalNegExemplars = negExemplars.length;
        const winningHooks = patterns?.top_hooks?.length || 0;
        const winningTags = patterns?.top_hashtags?.length || 0;
        const winningCtas = patterns?.top_ctas?.length || 0;

        /* ── Global perf stats ── */
        const allPerfs = posts.map(p => aiPerfScore(metricsMap[p.id])).filter(v => v > 0);
        const avgPerf = allPerfs.length ? Math.round(allPerfs.reduce((a, b) => a + b, 0) / allPerfs.length) : 0;
        const totalViews = allMetrics.reduce((s, m) => s + (m.views || 0), 0);
        const totalLikes = allMetrics.reduce((s, m) => s + (m.likes || 0), 0);
        const totalComments = allMetrics.reduce((s, m) => s + (m.comments || 0), 0);
        const totalShares = allMetrics.reduce((s, m) => s + (m.shares || 0), 0);
        const engagementRate = totalViews > 0 ? ((totalLikes + totalComments + totalShares) / totalViews * 100).toFixed(2) : '0';

        /* ── Weekly Buckets ── */
        const weekBuckets = {};
        for (const p of posts) {
            const d = new Date(p.posted_at);
            const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay());
            const key = weekStart.toISOString().slice(0, 10);
            if (!weekBuckets[key]) weekBuckets[key] = { views: 0, likes: 0, comments: 0, shares: 0, perf: 0, count: 0, withAI: 0, perfArr: [] };
            const m = metricsMap[p.id];
            if (m) {
                weekBuckets[key].views += m.views || 0;
                weekBuckets[key].likes += m.likes || 0;
                weekBuckets[key].comments += m.comments || 0;
                weekBuckets[key].shares += m.shares || 0;
                weekBuckets[key].perf += aiPerfScore(m);
                weekBuckets[key].perfArr.push(aiPerfScore(m));
            }
            weekBuckets[key].count++;
            const mdKey = p.id + ':' + p.platform;
            if (mdStatusMap[mdKey] && (mdStatusMap[mdKey].status === 'ready' || mdStatusMap[mdKey].status === 'edited')) {
                weekBuckets[key].withAI++;
            }
        }
        const weeks = Object.entries(weekBuckets).sort((a, b) => a[0].localeCompare(b[0]));
        const maxWeekViews = Math.max(...weeks.map(([, w]) => w.count > 0 ? w.views / w.count : 0), 1);
        const maxWeekPerf = Math.max(...weeks.map(([, w]) => w.count > 0 ? w.perf / w.count : 0), 1);

        /* ── First/Second half comparison (learning acceleration) ── */
        const MATURITY_DAYS = 7;
        const now = Date.now();
        const maturePosts = posts.filter(p => {
            const age = (now - new Date(p.posted_at).getTime()) / 86400000;
            return age >= MATURITY_DAYS;
        });
        const immatureCount = posts.length - maturePosts.length;

        const midIdx = Math.floor(maturePosts.length / 2);
        const firstHalf = maturePosts.slice(0, midIdx);
        const secondHalf = maturePosts.slice(midIdx);
        const halfPerf = (arr) => {
            const perfs = arr.map(p => aiPerfScore(metricsMap[p.id])).filter(v => v > 0);
            return perfs.length ? Math.round(perfs.reduce((a, b) => a + b, 0) / perfs.length) : 0;
        };
        const firstHalfPerf = halfPerf(firstHalf);
        const secondHalfPerf = halfPerf(secondHalf);
        const perfDelta = firstHalfPerf > 0 ? Math.round(((secondHalfPerf - firstHalfPerf) / firstHalfPerf) * 100) : 0;
        const accelDataTooFresh = maturePosts.length < 6;

        // Per-platform acceleration (mature posts only)
        const platAccel = {};
        for (const p of maturePosts) {
            const plt = p.platform || 'unknown';
            if (!platAccel[plt]) platAccel[plt] = { first: [], second: [] };
        }
        for (const p of firstHalf) {
            const plt = p.platform || 'unknown';
            const perf = aiPerfScore(metricsMap[p.id]);
            if (perf > 0 && platAccel[plt]) platAccel[plt].first.push(perf);
        }
        for (const p of secondHalf) {
            const plt = p.platform || 'unknown';
            const perf = aiPerfScore(metricsMap[p.id]);
            if (perf > 0 && platAccel[plt]) platAccel[plt].second.push(perf);
        }
        const platAccelArr = Object.entries(platAccel)
            .filter(([, v]) => v.first.length >= 2 && v.second.length >= 2)
            .map(([plt, v]) => {
                const avg1 = Math.round(v.first.reduce((a, b) => a + b, 0) / v.first.length);
                const avg2 = Math.round(v.second.reduce((a, b) => a + b, 0) / v.second.length);
                const delta = avg1 > 0 ? Math.round(((avg2 - avg1) / avg1) * 100) : 0;
                return { plat: plt, avg1, avg2, delta };
            })
            .sort((a, b) => b.delta - a.delta);

        /* ── Tag Evolution ── */
        const tagUsage = {};
        for (const p of posts) {
            const tags = p.tags || [];
            const m = metricsMap[p.id];
            const perf = aiPerfScore(m);
            for (const t of tags) {
                const tl = t.toLowerCase();
                if (!tagUsage[tl]) tagUsage[tl] = { count: 0, totalPerf: 0, firstSeen: p.posted_at, lastSeen: p.posted_at };
                tagUsage[tl].count++;
                tagUsage[tl].totalPerf += perf;
                tagUsage[tl].lastSeen = p.posted_at;
            }
        }
        const topTags = Object.entries(tagUsage)
            .map(([tag, data]) => ({ tag, ...data, avgPerf: data.count > 0 ? Math.round(data.totalPerf / data.count) : 0 }))
            .filter(t => t.count >= 2)
            .sort((a, b) => b.avgPerf - a.avgPerf);

        /* ── Platform Knowledge Depth ── */
        const platStats = {};
        for (const p of posts) {
            if (!platStats[p.platform]) platStats[p.platform] = { posts: 0, withMetrics: 0, withAI: 0, totalViews: 0, totalPerf: 0 };
            platStats[p.platform].posts++;
            if (metricsMap[p.id]) {
                platStats[p.platform].withMetrics++;
                platStats[p.platform].totalViews += metricsMap[p.id].views || 0;
                platStats[p.platform].totalPerf += aiPerfScore(metricsMap[p.id]);
            }
            const mdKey = p.id + ':' + p.platform;
            if (mdStatusMap[mdKey] && (mdStatusMap[mdKey].status === 'ready' || mdStatusMap[mdKey].status === 'edited')) {
                platStats[p.platform].withAI++;
            }
        }

        /* ── Vibe stats ── */
        const vibeStats = {};
        for (const p of posts) {
            const v = p.meta?.vibe_preset || 'unknown';
            if (!vibeStats[v]) vibeStats[v] = { count: 0, totalPerf: 0, totalViews: 0 };
            vibeStats[v].count++;
            const m = metricsMap[p.id];
            if (m) {
                vibeStats[v].totalPerf += aiPerfScore(m);
                vibeStats[v].totalViews += m.views || 0;
            }
        }

        /* ── Learning Milestones Timeline ── */
        const milestones = [];
        if (posts.length > 0)
            milestones.push({ date: posts[0].posted_at, icon: '🚀', label: 'First Post Published', detail: `"${posts[0].title}"` });
        const firstAIMeta = metadataEntries.find(md => md.status === 'ready' || md.status === 'edited');
        if (firstAIMeta)
            milestones.push({ date: firstAIMeta.created_at, icon: '🤖', label: 'AI Metadata Online', detail: `First AI-optimized ${firstAIMeta.platform} post` });
        if (posts.length >= 10)
            milestones.push({ date: posts[9].posted_at, icon: '📊', label: '10 Posts — Pattern Seed', detail: 'Enough data for basic pattern recognition' });
        if (exemplars.length > 0)
            milestones.push({ date: pmvEntries[0]?.created_at || posts[0].posted_at, icon: '⭐', label: 'Exemplars Active', detail: `AI identified ${exemplars.length} top performer${exemplars.length !== 1 ? 's' : ''} to learn from` });
        if (negExemplars.length > 0)
            milestones.push({ date: pmvEntries[0]?.created_at || posts[0].posted_at, icon: '🚫', label: 'Anti-Patterns Found', detail: `${negExemplars.length} underperformer${negExemplars.length !== 1 ? 's' : ''} identified — AI now avoids these styles` });
        if (posts.length >= 25)
            milestones.push({ date: posts[24].posted_at, icon: '🧠', label: '25 Posts — Deep Learning', detail: 'Robust pattern data across vibes, hooks, and tag combos' });
        if (posts.length >= 50)
            milestones.push({ date: posts[49].posted_at, icon: '🎓', label: '50 Posts — Expert Mode', detail: 'Full exemplar pool, negative patterns, optimized content lengths' });
        if (winningHooks > 0 || winningTags > 0)
            milestones.push({ date: patterns?.updated_at || new Date().toISOString(), icon: '🏆', label: 'Winning Patterns Computed', detail: `${winningHooks} hooks, ${winningTags} tags, ${winningCtas} CTAs locked in` });
        const nowISO = new Date().toISOString();
        milestones.push({ date: nowISO, icon: '📍', label: 'Now', detail: `${totalPosts} posts, ${totalExemplars} exemplars, ${winningTags} winning tags` });
        milestones.sort((a, b) => a.date.localeCompare(b.date));

        /* ── AI Intelligence Score (granular breakdown) ── */
        const iqBreakdown = [
            { label: 'Post Volume', pts: Math.min(totalPosts, 50), max: 50, tip: `${totalPosts} posted (need 50 for max)` },
            { label: 'Metric Coverage', pts: Math.min(postsWithMetrics, 50), max: 50, tip: `${postsWithMetrics}/${totalPosts} posts have performance data` },
            { label: 'AI Metadata', pts: Math.min(postsWithAIMeta, 30), max: 30, tip: `${postsWithAIMeta} posts have AI-generated metadata` },
            { label: 'Exemplars', pts: Math.min(totalExemplars, 10) * 3, max: 30, tip: `${totalExemplars}/10 positive exemplars discovered` },
            { label: 'Anti-Patterns', pts: Math.min(totalNegExemplars, 5) * 4, max: 20, tip: `${totalNegExemplars}/5 negative exemplars identified` },
            { label: 'Hook Patterns', pts: Math.min(winningHooks, 10) * 2, max: 20, tip: `${winningHooks}/10 winning hook styles learned` },
            { label: 'Winning Tags', pts: Math.min(winningTags, 15), max: 15, tip: `${winningTags}/15 top-performing tags identified` },
            { label: 'Vibe Diversity', pts: Math.min(uniqueVibes.size, 5) * 3, max: 15, tip: `${uniqueVibes.size}/5 unique vibes explored` },
            { label: 'Platform Spread', pts: Math.min(uniquePlatforms.size, 5) * 4, max: 20, tip: `${uniquePlatforms.size}/5 platforms covered` },
        ];
        const iqScore = Math.min(iqBreakdown.reduce((s, b) => s + b.pts, 0), 250);
        const iqMax = 250;
        const iqPct = Math.round((iqScore / iqMax) * 100);
        let iqLevel, iqColor;
        if (iqPct >= 80) { iqLevel = 'Expert'; iqColor = '#10b981'; }
        else if (iqPct >= 60) { iqLevel = 'Advanced'; iqColor = '#3b82f6'; }
        else if (iqPct >= 40) { iqLevel = 'Intermediate'; iqColor = '#f59e0b'; }
        else if (iqPct >= 20) { iqLevel = 'Learning'; iqColor = '#f97316'; }
        else { iqLevel = 'Beginner'; iqColor = '#ef4444'; }

        /* ── PROJECTION ── */
        const weekPerfs = weeks.map(([k, w]) => ({
            week: k,
            avgPerf: w.count > 0 ? w.perf / w.count : 0,
            avgViews: w.count > 0 ? w.views / w.count : 0,
            postRate: w.count,
        }));
        const projWeeks = 8;
        let slope = 0, intercept = 0;
        if (weekPerfs.length >= 2) {
            const n = weekPerfs.length;
            const xs = weekPerfs.map((_, i) => i);
            const ys = weekPerfs.map(w => w.avgPerf);
            const xMean = xs.reduce((a, b) => a + b, 0) / n;
            const yMean = ys.reduce((a, b) => a + b, 0) / n;
            const num = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - yMean), 0);
            const den = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
            slope = den > 0 ? num / den : 0;
            intercept = yMean - slope * xMean;
        }
        const projected = [];
        for (let i = 0; i < projWeeks; i++) {
            const weekIdx = weekPerfs.length + i;
            const d = new Date(weeks.length ? weeks[weeks.length - 1][0] : now);
            d.setDate(d.getDate() + (i + 1) * 7);
            projected.push({
                week: d.toISOString().slice(0, 10),
                projPerf: Math.max(0, Math.round(slope * weekIdx + intercept)),
                projViews: Math.max(0, Math.round(slope > 0 ? weekPerfs[weekPerfs.length - 1]?.avgViews * (1 + 0.05 * (i + 1)) : weekPerfs[weekPerfs.length - 1]?.avgViews || 0)),
            });
        }

        const avgPostsPerWeek = totalPosts / Math.max(weeks.length, 1);
        const weeksToMaxPosts = Math.max(0, Math.ceil((50 - totalPosts) / Math.max(avgPostsPerWeek, 0.1)));
        const projectedIqIn4w = Math.min(250, iqScore + Math.round(avgPostsPerWeek * 4) + (winningHooks === 0 ? 20 : 0));
        const projectedIqIn8w = Math.min(250, iqScore + Math.round(avgPostsPerWeek * 8) + (winningHooks === 0 ? 40 : 0));

        /* ── WHAT'S LACKING: gaps analysis ── */
        const gaps = [];
        const noMetrics = posts.filter(p => !metricsMap[p.id]);
        if (noMetrics.length > 0) {
            gaps.push({
                severity: noMetrics.length > 10 ? 'high' : 'medium',
                icon: '📉',
                title: `${noMetrics.length} posts missing metrics`,
                detail: `These posts are invisible to the learning loop. The AI can't learn from posts without views/likes/comments data.`,
                action: 'Connect platform analytics or wait for metrics sync to run.',
            });
        }
        if (failedMeta > 0) {
            gaps.push({
                severity: 'high',
                icon: '❌',
                title: `${failedMeta} failed AI metadata generations`,
                detail: 'These posts didn\'t receive AI-optimized titles, tags, and descriptions.',
                action: 'Retry failed metadata from the post editor or scripts.',
            });
        }
        if (pendingMeta > 0) {
            gaps.push({
                severity: 'low',
                icon: '⏳',
                title: `${pendingMeta} pending AI metadata`,
                detail: 'Metadata generation is queued but hasn\'t completed yet.',
                action: 'These will process automatically. Check back soon.',
            });
        }
        if (winningHooks === 0 && winningTags === 0 && winningCtas === 0) {
            gaps.push({
                severity: 'high',
                icon: '🏆',
                title: 'No winning patterns computed yet',
                detail: 'The nightly cron job (03:00 UTC) hasn\'t run yet, or there wasn\'t enough metric data. Winning patterns power the AI\'s strategy layer — hooks, tags, CTAs.',
                action: 'This will populate automatically tonight. If it persists, check the cron schedule in Supabase.',
            });
        }
        if (totalExemplars < 3) {
            gaps.push({
                severity: totalExemplars === 0 ? 'high' : 'medium',
                icon: '⭐',
                title: `Only ${totalExemplars} exemplar${totalExemplars !== 1 ? 's' : ''} (need 3+ for strong patterns)`,
                detail: 'Exemplars are high-performing posts the AI studies to learn winning styles. More exemplars = more diverse learning.',
                action: `Post ${3 - totalExemplars} more high-quality content and wait for metrics.`,
            });
        }
        if (totalNegExemplars === 0) {
            gaps.push({
                severity: 'medium',
                icon: '🚫',
                title: 'No anti-patterns identified yet',
                detail: 'The AI hasn\'t flagged any underperforming styles to avoid. It needs a wider range of performance data.',
                action: 'Keep posting. The AI will identify anti-patterns as the performance spread widens.',
            });
        }
        const knownPlatforms = ['youtube_shorts', 'instagram_reels', 'facebook_reels', 'tiktok', 'threads'];
        const missingPlatforms = knownPlatforms.filter(p => !platStats[p]);
        if (missingPlatforms.length > 0) {
            gaps.push({
                severity: 'low',
                icon: '🌐',
                title: `${missingPlatforms.length} platform${missingPlatforms.length !== 1 ? 's' : ''} with zero data`,
                detail: `Not posting to: ${missingPlatforms.map(p => AI_PLATFORM_LABELS[p] || p).join(', ')}. The AI can\'t learn platform-specific patterns without data.`,
                action: 'Add these platforms to your posting schedule for broader AI learning.',
            });
        }
        for (const [p, s] of Object.entries(platStats)) {
            if (s.posts < 5 && s.posts > 0) {
                gaps.push({
                    severity: 'low',
                    icon: '📊',
                    title: `${AI_PLATFORM_LABELS[p] || p}: only ${s.posts} post${s.posts !== 1 ? 's' : ''}`,
                    detail: `Need at least 5 posts for reliable platform-specific patterns. Currently at ${s.posts}.`,
                    action: `Post ${5 - s.posts} more on ${AI_PLATFORM_LABELS[p] || p}.`,
                });
            }
        }
        if (uniqueVibes.size < 3) {
            gaps.push({
                severity: 'medium',
                icon: '🎨',
                title: `Only ${uniqueVibes.size} vibe preset${uniqueVibes.size !== 1 ? 's' : ''} explored`,
                detail: 'More vibe diversity helps the AI understand what tone works best for different content.',
                action: 'Try additional vibe presets in your next campaign.',
            });
        }
        if (totalPosts < 50) {
            gaps.push({
                severity: totalPosts < 20 ? 'medium' : 'low',
                icon: '📚',
                title: `${totalPosts}/50 posts toward Expert mode`,
                detail: `The AI reaches full pattern confidence around 50 posts. You're ${Math.round(totalPosts / 50 * 100)}% there.`,
                action: `Keep posting! ~${weeksToMaxPosts} week${weeksToMaxPosts !== 1 ? 's' : ''} at current pace.`,
            });
        }
        const sevOrder = { high: 0, medium: 1, low: 2 };
        gaps.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

        // ══════════════════════════════════════════════════
        //  BUILD HTML
        // ══════════════════════════════════════════════════

        let html = '<div class="ai-learn">';

        /* ── AI Intelligence Score ── */
        html += `
        <div class="ai-learn__iq">
            <div class="ai-learn__iq-ring" style="--iq-pct:${iqPct};--iq-color:${iqColor}">
                <div class="ai-learn__iq-inner">
                    <span class="ai-learn__iq-score">${iqScore}</span>
                    <span class="ai-learn__iq-max">/ ${iqMax}</span>
                </div>
            </div>
            <div class="ai-learn__iq-info">
                <h3 class="ai-learn__iq-level" style="color:${iqColor}">${iqLevel}</h3>
                <p class="ai-learn__iq-desc">Your AI has analyzed <strong>${totalPosts} posts</strong> across <strong>${uniquePlatforms.size} platform${uniquePlatforms.size !== 1 ? 's' : ''}</strong> and <strong>${uniqueVibes.size} vibe${uniqueVibes.size !== 1 ? 's' : ''}</strong>. It knows <strong>${winningTags} winning tag pattern${winningTags !== 1 ? 's' : ''}</strong>, <strong>${winningHooks} top hook style${winningHooks !== 1 ? 's' : ''}</strong>, and has <strong>${totalExemplars} active exemplar${totalExemplars !== 1 ? 's' : ''}</strong> guiding future content.</p>
                <div class="ai-learn__iq-breakdown">`;
        for (const b of iqBreakdown) {
            const bPct = Math.round((b.pts / b.max) * 100);
            const bColor = bPct >= 80 ? '#10b981' : bPct >= 50 ? '#3b82f6' : bPct >= 25 ? '#f59e0b' : '#ef4444';
            html += `<div class="ai-learn__iq-bar-row" title="${aiEscHtml(b.tip)}">
                <span class="ai-learn__iq-bar-label">${b.label}</span>
                <div class="ai-learn__iq-bar-bg"><div class="ai-learn__iq-bar-fill" style="width:${bPct}%;background:${bColor}"></div></div>
                <span class="ai-learn__iq-bar-pts">${b.pts}/${b.max}</span>
            </div>`;
        }
        html += `</div></div></div>`;

        /* ── Key Numbers Strip ── */
        html += `
        <div class="ai-learn__stats">
            <div class="ai-learn__stat">
                <span class="ai-learn__stat-value">${aiFmt(totalViews)}</span>
                <span class="ai-learn__stat-label">Total Views</span>
            </div>
            <div class="ai-learn__stat">
                <span class="ai-learn__stat-value">${engagementRate}%</span>
                <span class="ai-learn__stat-label">Engagement Rate</span>
            </div>
            <div class="ai-learn__stat">
                <span class="ai-learn__stat-value">${aiFmt(avgPerf)}</span>
                <span class="ai-learn__stat-label">Avg Perf Score</span>
            </div>
            <div class="ai-learn__stat ${perfDelta >= 0 ? 'ai-learn__stat--up' : 'ai-learn__stat--down'}">
                <span class="ai-learn__stat-value">${perfDelta >= 0 ? '+' : ''}${perfDelta}%</span>
                <span class="ai-learn__stat-label">${perfDelta >= 0 ? 'Improving' : 'Declining'} (2nd half)</span>
            </div>
            <div class="ai-learn__stat">
                <span class="ai-learn__stat-value">${postsWithAIMeta}</span>
                <span class="ai-learn__stat-label">AI-Optimized</span>
            </div>
            <div class="ai-learn__stat">
                <span class="ai-learn__stat-value">${totalExemplars + totalNegExemplars}</span>
                <span class="ai-learn__stat-label">Training Signals</span>
            </div>
        </div>`;

        /* ── Learning Acceleration ── */
        html += `
        <div class="ai-learn__acceleration">
            <h4 class="ai-learn__section-title">⚡ Learning Acceleration</h4>`;
        if (accelDataTooFresh) {
            html += `
            <div class="ai-learn__accel-fresh-notice">
                <span class="ai-learn__accel-fresh-icon">⏳</span>
                <div class="ai-learn__accel-fresh-body">
                    <strong>Not enough mature data yet</strong>
                    <p>Only <b>${maturePosts.length}</b> of your ${posts.length} posts are older than ${MATURITY_DAYS} days.
                    ${immatureCount > 0 ? `<b>${immatureCount}</b> recent posts are excluded because their metrics are still accumulating — comparing them would make it look like performance is declining when it isn't.` : ''}
                    Check back once more posts have had a week to gather views, likes, and comments.</p>
                </div>
            </div>`;
        } else {
            html += `
            <p class="ai-learn__section-sub">Comparing first ${firstHalf.length} vs most recent ${secondHalf.length} posts — only includes posts older than ${MATURITY_DAYS} days so metrics are fair.${immatureCount > 0 ? ` <span class="ai-learn__accel-excluded">(${immatureCount} recent posts excluded — too new for accurate metrics)</span>` : ''}</p>
            <div class="ai-learn__accel-grid">
                <div class="ai-learn__accel-card">
                    <div class="ai-learn__accel-label">First Half (older)</div>
                    <div class="ai-learn__accel-val">${aiFmt(firstHalfPerf)}</div>
                    <div class="ai-learn__accel-sub">avg perf score</div>
                </div>
                <div class="ai-learn__accel-arrow ${perfDelta >= 0 ? 'ai-learn__accel-arrow--up' : 'ai-learn__accel-arrow--down'}">
                    <span>${perfDelta >= 0 ? '↑' : '↓'} ${Math.abs(perfDelta)}%</span>
                </div>
                <div class="ai-learn__accel-card ai-learn__accel-card--highlight">
                    <div class="ai-learn__accel-label">Second Half (recent)</div>
                    <div class="ai-learn__accel-val">${aiFmt(secondHalfPerf)}</div>
                    <div class="ai-learn__accel-sub">avg perf score</div>
                </div>
            </div>`;
            if (platAccelArr.length > 0) {
                html += `
                <div class="ai-learn__accel-platforms">
                    <h5 class="ai-learn__accel-plat-title">Per-Platform Acceleration</h5>
                    <div class="ai-learn__accel-plat-grid">`;
                for (const pa of platAccelArr) {
                    const platLabel = pa.plat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    html += `
                        <div class="ai-learn__accel-plat-row">
                            <span class="ai-learn__accel-plat-name">${platLabel}</span>
                            <span class="ai-learn__accel-plat-vals">${aiFmt(pa.avg1)} → ${aiFmt(pa.avg2)}</span>
                            <span class="ai-learn__accel-plat-delta ${pa.delta >= 0 ? 'ai-learn__stat--up' : 'ai-learn__stat--down'}">${pa.delta >= 0 ? '↑' : '↓'} ${Math.abs(pa.delta)}%</span>
                        </div>`;
                }
                html += `</div></div>`;
            }
        }
        html += `</div>`;

        /* ── Projection Section ── */
        html += `
        <div class="ai-learn__projection">
            <h4 class="ai-learn__section-title">🔮 Intelligence Projection (Next ${projWeeks} Weeks)</h4>
            <p class="ai-learn__section-sub">Based on current posting rate (${avgPostsPerWeek.toFixed(1)} posts/week) and performance trend (slope: ${slope >= 0 ? '+' : ''}${slope.toFixed(1)}/week).</p>
            <div class="ai-learn__proj-chart">`;
        const allChartWeeks = [
            ...weeks.map(([k, w]) => ({ week: k, avgPerf: w.count > 0 ? Math.round(w.perf / w.count) : 0, type: 'actual', count: w.count })),
            ...projected.map(p => ({ week: p.week, avgPerf: p.projPerf, type: 'projected', count: 0 })),
        ];
        const chartMax = Math.max(...allChartWeeks.map(w => w.avgPerf), 1);
        for (const cw of allChartWeeks) {
            const pct = Math.round((cw.avgPerf / chartMax) * 100);
            const weekLabel = new Date(cw.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            html += `<div class="ai-learn__proj-col ${cw.type === 'projected' ? 'ai-learn__proj-col--future' : ''}">
                <div class="ai-learn__proj-bar-wrap">
                    <div class="ai-learn__proj-bar ${cw.type === 'projected' ? 'ai-learn__proj-bar--dashed' : ''}" style="height:${Math.max(pct, 4)}%">
                        <span class="ai-learn__proj-bar-val">${aiFmt(cw.avgPerf)}</span>
                    </div>
                </div>
                <span class="ai-learn__proj-label">${weekLabel}</span>
                <span class="ai-learn__proj-type">${cw.type === 'projected' ? 'proj' : cw.count + 'p'}</span>
            </div>`;
        }
        html += `</div>`;

        html += `
            <div class="ai-learn__proj-cards">
                <div class="ai-learn__proj-card">
                    <span class="ai-learn__proj-card-when">In 4 Weeks</span>
                    <span class="ai-learn__proj-card-val">${projectedIqIn4w}</span>
                    <span class="ai-learn__proj-card-label">Projected IQ</span>
                </div>
                <div class="ai-learn__proj-card">
                    <span class="ai-learn__proj-card-when">In 8 Weeks</span>
                    <span class="ai-learn__proj-card-val">${projectedIqIn8w}</span>
                    <span class="ai-learn__proj-card-label">Projected IQ</span>
                </div>
                <div class="ai-learn__proj-card">
                    <span class="ai-learn__proj-card-when">Expert Mode</span>
                    <span class="ai-learn__proj-card-val">~${weeksToMaxPosts}w</span>
                    <span class="ai-learn__proj-card-label">${weeksToMaxPosts > 0 ? 'weeks away' : 'REACHED!'}</span>
                </div>
            </div>
        </div>`;

        /* ── Gaps & Actions ── */
        html += `
        <div class="ai-learn__gaps">
            <h4 class="ai-learn__section-title">⚠️ What's Lacking — Gaps & Actions</h4>
            <p class="ai-learn__section-sub">${gaps.length === 0 ? 'No major gaps detected! Your AI is running at full capacity.' : `Found ${gaps.length} gap${gaps.length !== 1 ? 's' : ''} that are limiting AI intelligence.`}</p>`;
        if (gaps.length === 0) {
            html += `<div class="ai-learn__gap-empty">✅ All systems optimal — your AI has everything it needs to generate high-quality metadata.</div>`;
        } else {
            html += `<div class="ai-learn__gap-list">`;
            for (const g of gaps) {
                html += `<div class="ai-learn__gap ai-learn__gap--${g.severity}">
                    <div class="ai-learn__gap-icon">${g.icon}</div>
                    <div class="ai-learn__gap-body">
                        <div class="ai-learn__gap-title">${aiEscHtml(g.title)}</div>
                        <div class="ai-learn__gap-detail">${aiEscHtml(g.detail)}</div>
                        <div class="ai-learn__gap-action">💡 ${aiEscHtml(g.action)}</div>
                    </div>
                    <div class="ai-learn__gap-sev">${g.severity.toUpperCase()}</div>
                </div>`;
            }
            html += `</div>`;
        }
        html += `</div>`;

        /* ── Learning Timeline ── */
        html += `<div class="ai-learn__timeline">
            <h4 class="ai-learn__section-title">🧬 Learning Timeline</h4>
            <div class="ai-learn__timeline-track">`;
        for (const ms of milestones) {
            const d = new Date(ms.date);
            const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const isNow = ms.label === 'Now';
            html += `<div class="ai-learn__milestone ${isNow ? 'ai-learn__milestone--now' : ''}">
                <div class="ai-learn__milestone-dot">${ms.icon}</div>
                <div class="ai-learn__milestone-content">
                    <strong>${ms.label}</strong>
                    <span class="ai-learn__milestone-date">${dateStr}</span>
                    <span class="ai-learn__milestone-detail">${aiEscHtml(ms.detail)}</span>
                </div>
            </div>`;
        }
        html += `</div></div>`;

        /* ── Weekly Performance Chart ── */
        html += `<div class="ai-learn__perf-chart">
            <h4 class="ai-learn__section-title">📈 Weekly Performance (avg views/post)</h4>
            <div class="ai-learn__bars">`;
        for (const [weekKey, w] of weeks) {
            const avgViews = w.count > 0 ? Math.round(w.views / w.count) : 0;
            const pct = Math.round((avgViews / maxWeekViews) * 100);
            const aiPct = w.count > 0 ? Math.round((w.withAI / w.count) * 100) : 0;
            const weekLabel = new Date(weekKey).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            html += `<div class="ai-learn__bar-col">
                <div class="ai-learn__bar-wrapper">
                    <div class="ai-learn__bar" style="height:${Math.max(pct, 4)}%">
                        <span class="ai-learn__bar-value">${aiFmt(avgViews)}</span>
                    </div>
                </div>
                <span class="ai-learn__bar-label">${weekLabel}</span>
                <span class="ai-learn__bar-sub">${w.count}p · ${aiPct}% AI</span>
            </div>`;
        }
        html += `</div></div>`;

        /* ── Vibe Performance ── */
        const vibeEntries = Object.entries(vibeStats).sort((a, b) => b[1].totalPerf - a[1].totalPerf);
        if (vibeEntries.length > 1) {
            html += `<div class="ai-learn__vibes">
                <h4 class="ai-learn__section-title">🎭 Vibe Performance Breakdown</h4>
                <div class="ai-learn__vibe-grid">`;
            const maxVibePerf = vibeEntries[0][1].count > 0 ? vibeEntries[0][1].totalPerf / vibeEntries[0][1].count : 1;
            for (const [vibe, vs] of vibeEntries) {
                const vAvg = vs.count > 0 ? Math.round(vs.totalPerf / vs.count) : 0;
                const barW = Math.max(Math.round((vAvg / maxVibePerf) * 100), 5);
                html += `<div class="ai-learn__vibe-row">
                    <span class="ai-learn__vibe-name">${aiEscHtml(vibe)}</span>
                    <div class="ai-learn__tag-bar-bg"><div class="ai-learn__tag-bar" style="width:${barW}%"></div></div>
                    <span class="ai-learn__tag-meta">${vs.count} posts · avg ${aiFmt(vAvg)}</span>
                </div>`;
            }
            html += `</div></div>`;
        }

        /* ── Tag Intelligence ── */
        html += `<div class="ai-learn__tags">
            <h4 class="ai-learn__section-title">🏷️ Tag Intelligence (used 2+×, ranked by avg perf)</h4>
            <div class="ai-learn__tag-grid">`;
        const maxTagPerf = topTags.length ? topTags[0].avgPerf : 1;
        for (const t of topTags.slice(0, 20)) {
            const barW = Math.max(Math.round((t.avgPerf / maxTagPerf) * 100), 5);
            const isWinning = (patterns?.top_hashtags || []).some(wt => wt.tag?.toLowerCase() === t.tag);
            html += `<div class="ai-learn__tag-row">
                <span class="ai-learn__tag-name ${isWinning ? 'ai-learn__tag-name--winning' : ''}">#${aiEscHtml(t.tag)}</span>
                <div class="ai-learn__tag-bar-bg"><div class="ai-learn__tag-bar" style="width:${barW}%"></div></div>
                <span class="ai-learn__tag-meta">${t.count}× · avg ${aiFmt(t.avgPerf)}</span>
            </div>`;
        }
        html += `</div></div>`;

        /* ── Platform Knowledge Depth ── */
        html += `<div class="ai-learn__platforms">
            <h4 class="ai-learn__section-title">🌐 Knowledge Depth by Platform</h4>
            <div class="ai-learn__plat-grid">`;
        for (const [p, stats] of Object.entries(platStats).sort((a, b) => b[1].posts - a[1].posts)) {
            const platLabel = AI_PLATFORM_LABELS[p] || p;
            const platColor = AI_PLATFORM_COLORS[p] || '#6b7280';
            const metricCoverage = stats.posts > 0 ? Math.round((stats.withMetrics / stats.posts) * 100) : 0;
            const aiCoverage = stats.posts > 0 ? Math.round((stats.withAI / stats.posts) * 100) : 0;
            const avgPlatPerf = stats.withMetrics > 0 ? Math.round(stats.totalPerf / stats.withMetrics) : 0;
            const confidence = stats.posts >= 20 ? 'High' : stats.posts >= 10 ? 'Medium' : stats.posts >= 5 ? 'Low' : 'Insufficient';
            html += `<div class="ai-learn__plat-card" style="border-top:3px solid ${platColor}">
                <div class="ai-learn__plat-name" style="color:${platColor}">${platLabel}</div>
                <div class="ai-learn__plat-stats">
                    <div class="ai-learn__plat-row"><span>Posts</span><strong>${stats.posts}</strong></div>
                    <div class="ai-learn__plat-row"><span>Metric Coverage</span><strong>${metricCoverage}%</strong></div>
                    <div class="ai-learn__plat-row"><span>AI Metadata</span><strong>${aiCoverage}%</strong></div>
                    <div class="ai-learn__plat-row"><span>Avg Perf Score</span><strong>${aiFmt(avgPlatPerf)}</strong></div>
                    <div class="ai-learn__plat-row"><span>Total Views</span><strong>${aiFmt(stats.totalViews)}</strong></div>
                    <div class="ai-learn__plat-row"><span>AI Confidence</span><strong>${confidence}</strong></div>
                </div>
                <div class="ai-learn__plat-coverage">
                    <div class="ai-learn__plat-coverage-bar" style="width:${aiCoverage}%;background:${platColor}"></div>
                </div>
            </div>`;
        }
        html += `</div></div>`;

        /* ── What the AI Currently Knows (Brain) ── */
        html += `<div class="ai-learn__brain">
            <h4 class="ai-learn__section-title">🧠 What Your AI Currently Knows</h4>
            <div class="ai-learn__brain-grid">`;

        const topHooks = patterns?.top_hooks || [];
        if (topHooks.length) {
            html += `<div class="ai-learn__brain-card">
                <div class="ai-learn__brain-card-title">Top Hook Patterns</div>
                <ul class="ai-learn__brain-list">`;
            for (const h of topHooks.slice(0, 5)) {
                html += `<li><span class="ai-learn__brain-hook">"${aiEscHtml(h.hook?.slice(0, 60) || '—')}"</span> <span class="ai-learn__brain-perf">${aiFmt(h.perf)}</span></li>`;
            }
            html += `</ul></div>`;
        }

        const topCtas = patterns?.top_ctas || [];
        if (topCtas.length) {
            html += `<div class="ai-learn__brain-card">
                <div class="ai-learn__brain-card-title">Top CTA Patterns</div>
                <ul class="ai-learn__brain-list">`;
            for (const c of topCtas.slice(0, 5)) {
                html += `<li><span class="ai-learn__brain-hook">"${aiEscHtml(c.cta?.slice(0, 60) || '—')}"</span> <span class="ai-learn__brain-perf">${aiFmt(c.perf)}</span></li>`;
            }
            html += `</ul></div>`;
        }

        if (patterns?.length_stats) {
            const ls = patterns.length_stats;
            html += `<div class="ai-learn__brain-card">
                <div class="ai-learn__brain-card-title">Optimal Content Lengths</div>
                <ul class="ai-learn__brain-list">
                    <li>Title: <strong>~${Math.round(ls.avg_title_len || 0)} chars</strong></li>
                    <li>Description: <strong>~${Math.round(ls.avg_desc_len || 0)} chars</strong></li>
                    <li>Tags: <strong>~${Math.round(ls.avg_tag_count || 0)} per post</strong></li>
                </ul>
            </div>`;
        }

        if (exemplars.length) {
            html += `<div class="ai-learn__brain-card">
                <div class="ai-learn__brain-card-title">Active Exemplars (style guides)</div>
                <ul class="ai-learn__brain-list">`;
            for (const e of exemplars.slice(0, 5)) {
                const title = e.fields?.title || e.fields?.caption || e.metadata_snapshot?.title || '—';
                html += `<li><span class="ai-learn__brain-hook">"${aiEscHtml(String(title).slice(0, 50))}"</span> <span class="ai-learn__brain-perf">${aiFmt(e.performance_value)}</span></li>`;
            }
            html += `</ul></div>`;
        }

        if (negExemplars.length) {
            html += `<div class="ai-learn__brain-card ai-learn__brain-card--neg">
                <div class="ai-learn__brain-card-title">Anti-Patterns (avoid these)</div>
                <ul class="ai-learn__brain-list">`;
            for (const e of negExemplars.slice(0, 3)) {
                const title = e.fields?.title || e.fields?.caption || e.metadata_snapshot?.title || '—';
                html += `<li><span class="ai-learn__brain-hook">"${aiEscHtml(String(title).slice(0, 50))}"</span> <span class="ai-learn__brain-perf ai-learn__brain-perf--neg">${aiFmt(e.performance_value)}</span></li>`;
            }
            html += `</ul></div>`;
        }

        if (!topHooks.length && !topCtas.length && !patterns?.length_stats && !exemplars.length && !negExemplars.length) {
            html += `<div class="ai-learn__brain-card ai-learn__brain-card--empty">
                <div class="ai-learn__brain-card-title">Brain is still learning…</div>
                <p style="color:var(--color-text-muted);font-size:0.8rem;margin:0">The AI hasn't accumulated enough data yet to show concrete patterns. Keep posting and collecting metrics — patterns will emerge within the next few days.</p>
            </div>`;
        }

        html += `</div></div>`;  // close brain

        html += '</div>'; // close ai-learn
        container.innerHTML = html;

    } catch (err) {
        console.error('[AI Intelligence] loadAILearningGrowth error:', err);
        container.innerHTML = '<div class="ai-empty">Failed to load AI learning data.</div>';
    }
}
