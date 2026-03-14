// =====================================================
// AI INTELLIGENCE - Latest Post Deep Dive (Modal)
// =====================================================

// Stores the full deep-dive HTML so the modal can display it on demand
let _aiDeepDiveHtml = '';
let _aiDeepDiveSubtitle = '';

function aiOpenDeepDiveModal() {
    const modal = document.getElementById('deep-dive-modal');
    const body = document.getElementById('deep-dive-modal-body');
    const subtitle = document.getElementById('deep-dive-modal-subtitle');
    if (!modal) return;
    body.innerHTML = _aiDeepDiveHtml || '<div class="ai-loading">No analysis available yet.</div>';
    if (subtitle && _aiDeepDiveSubtitle) subtitle.textContent = _aiDeepDiveSubtitle;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function aiCloseDeepDiveModal() {
    const modal = document.getElementById('deep-dive-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
}

// Close on Escape key
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') aiCloseDeepDiveModal();
});

async function aiLoadLatestPostDive() {
    const summaryBody = aiEl('latest-post-summary-body');
    if (!summaryBody) return;
    summaryBody.innerHTML = '<div class="ai-loading">Analyzing your latest post…</div>';

    try {
        let latestQuery = aiSupabase.from('posts')
            .select('id, title, description, tags, platform, status, posted_at, video_url, job_id, meta, platform_post_id, platform_url, ai_metadata, platform_content')
            .eq('brand_id', aiBrandId)
            .eq('status', 'posted')
            .order('posted_at', { ascending: false })
            .limit(1);
        if (aiPlatformFilter()) latestQuery = latestQuery.eq('platform', aiPlatformFilter());

        const { data: latestPosts } = await latestQuery;
        if (!latestPosts?.length) {
            summaryBody.innerHTML = '<p class="text-xs text-white/30">No posted content yet</p>';
            _aiDeepDiveHtml = '';
            return;
        }
        const latest = latestPosts[0];
        const jobId = latest.job_id;

        const { data: siblings } = await aiSupabase.from('posts')
            .select('id, title, description, tags, platform, status, posted_at, video_url, platform_post_id, platform_url, ai_metadata, platform_content')
            .eq('brand_id', aiBrandId)
            .eq('job_id', jobId)
            .eq('status', 'posted')
            .order('platform');

        const allPosts = siblings?.length ? siblings : [latest];
        const allPostIds = allPosts.map(p => p.id);

        const plat = aiPlatformFilter() || 'youtube_shorts';
        const [metricsRes, metadataRes, patternsRes, exemplarsRes, timeSlotsRes, avgRes] = await Promise.all([
            aiSupabase.from('v_post_metrics_latest')
                .select('post_id, platform, views, likes, comments, shares, saves, collected_at')
                .in('post_id', allPostIds),
            aiSupabase.from('post_metadata')
                .select('post_id, platform, status, final_metadata, ai_metadata, error, attempt_count, failure_class')
                .in('post_id', allPostIds),
            aiSupabase.rpc('get_winning_patterns', {
                p_brand_id: aiBrandId, p_platform: plat, p_vibe_preset: null,
            }),
            aiSupabase.rpc('get_generation_exemplars', {
                p_brand_id: aiBrandId, p_platform: plat, p_limit: 5,
            }),
            aiSupabase.from('time_slot_scores')
                .select('day_of_week, hour, score, post_count')
                .eq('brand_id', aiBrandId)
                .eq('platform', plat)
                .order('score', { ascending: false })
                .limit(5),
            aiSupabase.from('v_post_metrics_latest')
                .select('post_id, views, likes, comments, shares')
                .order('views', { ascending: false })
                .limit(200),
        ]);

        const metricsMap = {};
        for (const m of (metricsRes.data || [])) metricsMap[m.post_id] = m;

        const metadataMap = {};
        for (const md of (metadataRes.data || [])) {
            const key = md.post_id + ':' + md.platform;
            metadataMap[key] = md;
        }

        const patterns = patternsRes.data?.[0] || null;
        const exemplars = Array.isArray(exemplarsRes.data) ? exemplarsRes.data : [];
        const topTimeSlots = timeSlotsRes.data || [];

        const allMetrics = avgRes.data || [];
        const brandAvg = {
            views: allMetrics.length ? Math.round(allMetrics.reduce((s, m) => s + (m.views || 0), 0) / allMetrics.length) : 0,
            likes: allMetrics.length ? Math.round(allMetrics.reduce((s, m) => s + (m.likes || 0), 0) / allMetrics.length) : 0,
            comments: allMetrics.length ? Math.round(allMetrics.reduce((s, m) => s + (m.comments || 0), 0) / allMetrics.length) : 0,
            shares: allMetrics.length ? Math.round(allMetrics.reduce((s, m) => s + (m.shares || 0), 0) / allMetrics.length) : 0,
        };

        const exemplarPerfs = exemplars.map(e => e.performance_value).sort((a, b) => b - a);
        const exemplarThreshold = exemplarPerfs.length >= 5 ? exemplarPerfs[exemplarPerfs.length - 1] : 0;

        let totalViews = 0, totalLikes = 0, totalComments = 0, totalShares = 0, totalSaves = 0;
        for (const p of allPosts) {
            const m = metricsMap[p.id];
            if (m) {
                totalViews += m.views || 0;
                totalLikes += m.likes || 0;
                totalComments += m.comments || 0;
                totalShares += m.shares || 0;
                totalSaves += m.saves || 0;
            }
        }
        const perfScore = totalViews + 5 * totalLikes + 10 * totalComments + 10 * totalShares;
        const avgPerfScore = brandAvg.views + 5 * brandAvg.likes + 10 * brandAvg.comments + 10 * brandAvg.shares;

        let perfTier, perfClass, perfEmoji;
        if (avgPerfScore === 0 || perfScore >= avgPerfScore * 1.3) {
            perfTier = 'Above Average'; perfClass = 'perf--high'; perfEmoji = '🔥';
        } else if (perfScore >= avgPerfScore * 0.7) {
            perfTier = 'Average'; perfClass = 'perf--mid'; perfEmoji = '➖';
        } else {
            perfTier = 'Below Average'; perfClass = 'perf--low'; perfEmoji = '📉';
        }

        const hasMetrics = totalViews > 0 || totalLikes > 0;
        const posted = new Date(latest.posted_at);
        const vibePreset = latest.meta?.vibe_preset || 'default';
        const vibeLabel = vibePreset.replace(/_/g, ' ');
        const postedAgo = aiGetTimeAgo(posted);

        // ── Compact Summary (rendered inline) ──
        const summaryHtml = `
            <div class="flex items-center justify-between gap-4 flex-wrap">
                <div class="flex items-center gap-3 min-w-0">
                    <div>
                        <p class="text-sm font-semibold text-white/90 truncate">${aiEscHtml(latest.title)}</p>
                        <p class="text-xs text-white/40 mt-0.5">${allPosts.length} platform${allPosts.length > 1 ? 's' : ''} · ${vibeLabel} · ${postedAgo}</p>
                    </div>
                </div>
                <div class="flex items-center gap-4 text-xs shrink-0">
                    ${hasMetrics ? `
                        <span class="tabular-nums text-white/60"><strong class="text-white/90">${aiFmt(totalViews)}</strong> views</span>
                        <span class="tabular-nums text-white/60"><strong class="text-white/90">${aiFmt(totalLikes)}</strong> likes</span>
                    ` : '<span class="text-white/40">Metrics pending…</span>'}
                    <span class="latest-dive__perf ${perfClass} text-xs">${perfEmoji} ${perfTier}</span>
                </div>
            </div>`;
        summaryBody.innerHTML = summaryHtml;

        // Store subtitle for modal header
        _aiDeepDiveSubtitle = `Posted ${postedAgo} · ${allPosts.length} platform${allPosts.length > 1 ? 's' : ''}`;

        // ── Full Deep Dive (stored for modal) ──
        let html = `<div class="latest-dive">`;

        html += `
            <div class="latest-dive__header">
                <div class="latest-dive__title-row">
                    <div class="latest-dive__icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 16v-4"/><path d="M12 8h.01"/>
                        </svg>
                    </div>
                    <div>
                        <h3 class="latest-dive__title">Latest Post Deep Dive</h3>
                        <p class="latest-dive__subtitle">Your most recent story — posted ${postedAgo}</p>
                    </div>
                </div>
                <span class="latest-dive__perf ${perfClass}">
                    ${perfEmoji} ${perfTier}
                </span>
            </div>`;

        html += `
            <div class="latest-dive__story">
                <div class="latest-dive__story-info">
                    <h4 class="latest-dive__story-title">${aiEscHtml(latest.title)}</h4>
                    <div class="latest-dive__story-meta">
                        <span class="latest-dive__vibe">${aiEscHtml(vibeLabel)}</span>
                        <span class="latest-dive__date">${posted.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${posted.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                    </div>`;

        const tags = latest.tags || [];
        if (tags.length) {
            html += `<div class="latest-dive__tags">${tags.map(t => `<span class="latest-dive__tag">#${aiEscHtml(t)}</span>`).join('')}</div>`;
        }

        html += `</div>`;

        if (latest.video_url) {
            html += `<div class="latest-dive__thumb">
                <video src="${aiEscHtml(latest.video_url)}" muted preload="metadata" class="latest-dive__video"></video>
            </div>`;
        }

        html += `</div>`;

        // Metadata alert
        const failedMeta = allPosts.filter(p => {
            const mdKey = p.id + ':' + p.platform;
            const md = metadataMap[mdKey];
            return md && md.status === 'failed';
        });
        if (failedMeta.length > 0) {
            const sample = metadataMap[failedMeta[0].id + ':' + failedMeta[0].platform];
            const errSnippet = sample?.error ? aiEscHtml(sample.error.split('\n')[0].slice(0, 120)) : 'Unknown error';
            html += `<div class="latest-dive__alert latest-dive__alert--warning">
                <div class="latest-dive__alert-header">
                    <span class="latest-dive__alert-icon">⚠️</span>
                    <strong>AI Metadata Failed for ${failedMeta.length} Platform${failedMeta.length > 1 ? 's' : ''}</strong>
                </div>
                <p class="latest-dive__alert-body">This post was published <strong>without AI-optimized titles, tags, or descriptions</strong> because the metadata generation failed.</p>
                <div class="latest-dive__alert-detail">
                    <span class="latest-dive__alert-label">Error:</span> <code>${errSnippet}</code>
                </div>
            </div>`;
        }

        // Per-platform breakdown
        html += `<div class="latest-dive__platforms">`;
        for (const post of allPosts) {
            const m = metricsMap[post.id];
            const mdKey = post.id + ':' + post.platform;
            const md = metadataMap[mdKey];
            const aiMd = md ? (md.final_metadata || md.ai_metadata) : null;
            const platLabel = AI_PLATFORM_LABELS[post.platform] || post.platform;
            const platColor = AI_PLATFORM_COLORS[post.platform] || '#6b7280';
            const mdStatus = md?.status || 'none';
            const metaSource = post.platform_content?.metadata_source || post.ai_metadata?.metadata_source || null;

            let metaBadge = '';
            if (mdStatus === 'ready' || mdStatus === 'edited' || metaSource === 'ready' || metaSource === 'edited' || metaSource === 'ai_backfill') {
                metaBadge = '<span class="latest-dive__plat-meta-source latest-dive__plat-meta-source--ai">🤖 AI Metadata</span>';
            } else if (mdStatus === 'failed') {
                metaBadge = '<span class="latest-dive__plat-meta-source latest-dive__plat-meta-source--failed">❌ Metadata Failed</span>';
            } else if (mdStatus === 'generating' || mdStatus === 'not_started') {
                metaBadge = '<span class="latest-dive__plat-meta-source latest-dive__plat-meta-source--pending">⏳ Generating…</span>';
            } else {
                metaBadge = '<span class="latest-dive__plat-meta-source latest-dive__plat-meta-source--fallback">📝 Raw Fallback</span>';
            }

            html += `<div class="latest-dive__plat-card" style="border-left: 3px solid ${platColor}">
                <div class="latest-dive__plat-header">
                    <span class="latest-dive__plat-name" style="color:${platColor}">${platLabel}</span>
                    ${metaBadge}
                    ${post.platform_url ? `<a href="${aiEscHtml(post.platform_url)}" target="_blank" rel="noopener noreferrer" class="latest-dive__plat-link">View ↗</a>` : ''}
                </div>`;

            if (m) {
                html += `<div class="latest-dive__plat-metrics">
                    <span class="latest-dive__plat-stat"><strong>${aiFmt(m.views)}</strong> views</span>
                    <span class="latest-dive__plat-stat"><strong>${aiFmt(m.likes)}</strong> likes</span>
                    <span class="latest-dive__plat-stat"><strong>${aiFmt(m.comments)}</strong> comments</span>
                    <span class="latest-dive__plat-stat"><strong>${aiFmt(m.shares)}</strong> shares</span>
                    ${m.saves ? `<span class="latest-dive__plat-stat"><strong>${aiFmt(m.saves)}</strong> saves</span>` : ''}
                </div>`;
            } else {
                html += `<div class="latest-dive__plat-metrics latest-dive__plat-metrics--pending">Metrics pending — next collection cycle</div>`;
            }

            if (aiMd) {
                const aiTitle = aiMd.title || aiMd.caption || null;
                const aiTags = aiMd.tags || aiMd.hashtags || [];
                html += `<div class="latest-dive__plat-ai">
                    <span class="latest-dive__plat-ai-label">AI-Optimized:</span>
                    ${aiTitle ? `<div class="latest-dive__plat-ai-title">${aiEscHtml(aiTitle)}</div>` : ''}
                    ${aiTags.length ? `<div class="latest-dive__plat-ai-tags">${aiTags.slice(0, 8).map(t => `<span class="latest-dive__tag latest-dive__tag--ai">#${aiEscHtml(t)}</span>`).join('')}</div>` : ''}
                </div>`;
            }

            html += `</div>`;
        }
        html += `</div>`;

        // Aggregate metrics
        html += `<div class="latest-dive__metrics-grid">
            <div class="latest-dive__metric">
                <span class="latest-dive__metric-value">${aiFmt(totalViews)}</span>
                <span class="latest-dive__metric-label">Total Views</span>
                ${hasMetrics && brandAvg.views > 0 ? `<span class="latest-dive__metric-vs ${totalViews >= brandAvg.views ? 'latest-dive__metric-vs--up' : 'latest-dive__metric-vs--down'}">${totalViews >= brandAvg.views ? '+' : ''}${Math.round((totalViews / brandAvg.views - 1) * 100)}% vs avg</span>` : ''}
            </div>
            <div class="latest-dive__metric">
                <span class="latest-dive__metric-value">${aiFmt(totalLikes)}</span>
                <span class="latest-dive__metric-label">Total Likes</span>
            </div>
            <div class="latest-dive__metric">
                <span class="latest-dive__metric-value">${aiFmt(totalComments)}</span>
                <span class="latest-dive__metric-label">Total Comments</span>
            </div>
            <div class="latest-dive__metric">
                <span class="latest-dive__metric-value">${aiFmt(totalShares)}</span>
                <span class="latest-dive__metric-label">Total Shares</span>
            </div>
            <div class="latest-dive__metric latest-dive__metric--score">
                <span class="latest-dive__metric-value">${aiFmt(perfScore)}</span>
                <span class="latest-dive__metric-label">Perf Score</span>
                ${hasMetrics ? `<span class="latest-dive__metric-vs">${perfScore >= exemplarThreshold ? '✓ Exemplar' : `Need ${aiFmt(exemplarThreshold)}`}</span>` : ''}
            </div>
        </div>`;

        // AI Analysis
        const strengths = [];
        const improvements = [];
        const insights = [];

        if (hasMetrics) {
            const viewRatio = brandAvg.views > 0 ? totalViews / brandAvg.views : 0;
            if (viewRatio >= 1.3) {
                strengths.push(`Views are <strong>${Math.round((viewRatio - 1) * 100)}% above average</strong> (${aiFmt(totalViews)} vs brand avg ${aiFmt(brandAvg.views)}).`);
            } else if (viewRatio >= 0.7) {
                insights.push(`Views are within normal range — ${aiFmt(totalViews)} total vs brand avg ${aiFmt(brandAvg.views)}.`);
            } else if (viewRatio > 0) {
                improvements.push(`Views are <strong>${Math.round((1 - viewRatio) * 100)}% below average</strong> (${aiFmt(totalViews)} vs avg ${aiFmt(brandAvg.views)}).`);
            }

            const engRate = totalViews > 0 ? ((totalLikes + totalComments) / totalViews * 100) : 0;
            const avgEngRate = brandAvg.views > 0 ? ((brandAvg.likes + brandAvg.comments) / brandAvg.views * 100) : 0;
            if (engRate > 0) {
                if (engRate > avgEngRate * 1.3) {
                    strengths.push(`Engagement rate is <strong>${engRate.toFixed(1)}%</strong> (brand avg ${avgEngRate.toFixed(1)}%) — viewers are highly engaged.`);
                } else if (engRate < avgEngRate * 0.7 && avgEngRate > 0) {
                    improvements.push(`Engagement rate is <strong>${engRate.toFixed(1)}%</strong> (brand avg ${avgEngRate.toFixed(1)}%) — the hook may attract views but not keep attention.`);
                }
            }

            if (totalShares > brandAvg.shares * 1.5 && totalShares > 0) {
                strengths.push(`<strong>${totalShares} shares</strong> — content is being actively redistributed.`);
            }

            if (perfScore >= exemplarThreshold && exemplarThreshold > 0) {
                strengths.push(`Performance score <strong>${aiFmt(perfScore)}</strong> qualifies for the exemplar pool.`);
            } else if (exemplarThreshold > 0) {
                improvements.push(`Performance score ${aiFmt(perfScore)} is below the exemplar threshold (${aiFmt(exemplarThreshold)}).`);
            }
        } else {
            insights.push(`Metrics haven't been collected yet — analysis will be more detailed after the first collection cycle.`);
        }

        // Hook analysis
        const hookInfo = aiClassifyHook(latest.title);
        const hookPatternPerf = {};
        for (const h of (patterns?.top_hooks || [])) {
            const cls = aiClassifyHook(h.hook);
            if (!hookPatternPerf[cls.type]) hookPatternPerf[cls.type] = { label: cls.label, total: 0, count: 0 };
            hookPatternPerf[cls.type].total += h.perf || 0;
            hookPatternPerf[cls.type].count++;
        }
        for (const p of Object.values(hookPatternPerf)) p.avg = Math.round(p.total / p.count);

        let bestHookType = null;
        for (const [type, data] of Object.entries(hookPatternPerf)) {
            if (!bestHookType || data.avg > hookPatternPerf[bestHookType].avg) bestHookType = type;
        }

        if (bestHookType) {
            const thisHookData = hookPatternPerf[hookInfo.type];
            const bestHookData = hookPatternPerf[bestHookType];
            if (hookInfo.type === bestHookType) {
                strengths.push(`Title uses <strong>${hookInfo.label}</strong> pattern — this IS the top-performing hook format.`);
            } else if (thisHookData && bestHookData && thisHookData.avg < bestHookData.avg * 0.7) {
                improvements.push(`Title uses <strong>${hookInfo.label}</strong> pattern (avg ${aiFmt(thisHookData.avg)}). Data shows <strong>${bestHookData.label}</strong> outperforms at avg ${aiFmt(bestHookData.avg)}.`);
            } else {
                insights.push(`Title uses <strong>${hookInfo.label}</strong> pattern. Top format is <strong>${bestHookData.label}</strong> (avg ${aiFmt(bestHookData.avg)}).`);
            }
        }

        // Tag analysis
        const allTagsSet = new Set((tags || []).map(t => t.toLowerCase()));
        for (const post of allPosts) {
            const mdKey = post.id + ':' + post.platform;
            const md = metadataMap[mdKey];
            const postAiMd = md?.final_metadata || md?.ai_metadata || post.ai_metadata || null;
            if (postAiMd) {
                for (const t of (postAiMd.tags || postAiMd.hashtags || [])) allTagsSet.add(t.toLowerCase());
            }
            for (const t of (post.tags || [])) allTagsSet.add(t.toLowerCase());
        }
        const postTagSet = allTagsSet;
        const winningTags = (patterns?.top_hashtags || []).slice(0, 8);
        const matchedTags = winningTags.filter(wt => postTagSet.has(wt.tag.toLowerCase()));
        const missedTags = winningTags.filter(wt => !postTagSet.has(wt.tag.toLowerCase()));

        if (winningTags.length > 0) {
            if (postTagSet.size === 0) {
                improvements.push(`<strong>No tags at all</strong> — this post was published without any hashtags.`);
            } else if (matchedTags.length >= winningTags.length * 0.6) {
                strengths.push(`Strong tag alignment — <strong>${matchedTags.length}/${winningTags.length}</strong> top-performing tags present.`);
            } else if (matchedTags.length <= winningTags.length * 0.3) {
                improvements.push(`Low tag alignment — only <strong>${matchedTags.length}/${winningTags.length}</strong> top-performing tags present.`);
            } else {
                insights.push(`Tag alignment: ${matchedTags.length}/${winningTags.length} winning tags present.`);
            }
        }

        // Description length
        const descLen = (latest.description || '').length;
        const isRawNarration = failedMeta.length > 0 && descLen > 400;
        if (isRawNarration) {
            improvements.push(`Description is <strong>raw story narration</strong> (${descLen} chars) — the AI caption generator failed.`);
        } else if (patterns?.length_stats?.avg_desc_len) {
            const optLen = Math.round(patterns.length_stats.avg_desc_len);
            const pctDelta = optLen > 0 ? Math.abs(descLen - optLen) / optLen * 100 : 0;
            if (pctDelta <= 20) {
                strengths.push(`Description length <strong>${descLen} chars</strong> is within optimal range (~${optLen}).`);
            } else if (descLen > optLen) {
                improvements.push(`Description is <strong>${Math.round(pctDelta)}% longer</strong> than top performers (${descLen} vs ~${optLen} chars).`);
            } else {
                improvements.push(`Description is <strong>${Math.round(pctDelta)}% shorter</strong> than top performers (${descLen} vs ~${optLen} chars).`);
            }
        }

        // Posting time
        const dow = posted.getDay();
        const hour = posted.getHours();
        const bestSlot = topTimeSlots[0];
        const matchedSlot = topTimeSlots.find(s => s.day_of_week === dow && s.hour === hour);

        if (bestSlot) {
            if (matchedSlot) {
                strengths.push(`Posted during a <strong>top time slot</strong> — ${AI_DAY_NAMES[dow]} ${aiFormatHour(hour)}.`);
            } else {
                improvements.push(`Posted at ${AI_DAY_NAMES[dow]} ${aiFormatHour(hour)}. Best slot: <strong>${AI_DAY_NAMES[bestSlot.day_of_week]} ${aiFormatHour(bestSlot.hour)}</strong>.`);
            }
        }

        // Vibe
        if (vibePreset !== 'default') {
            if (hasMetrics && perfTier === 'Above Average') {
                strengths.push(`Vibe preset <strong>"${vibeLabel}"</strong> is performing well.`);
            } else if (hasMetrics && perfTier === 'Below Average') {
                improvements.push(`Vibe preset <strong>"${vibeLabel}"</strong> may not be connecting. Consider testing alternatives.`);
            }
        }

        // Build analysis HTML
        html += `<div class="latest-dive__analysis">`;

        if (strengths.length) {
            html += `<div class="latest-dive__analysis-section latest-dive__analysis-section--strengths">
                <div class="latest-dive__analysis-header">
                    <span class="latest-dive__analysis-icon">✅</span>
                    <span class="latest-dive__analysis-title">What's Working</span>
                </div>
                <ul class="latest-dive__analysis-list">
                    ${strengths.map(s => `<li>${s}</li>`).join('')}
                </ul>
            </div>`;
        }

        if (improvements.length) {
            html += `<div class="latest-dive__analysis-section latest-dive__analysis-section--improvements">
                <div class="latest-dive__analysis-header">
                    <span class="latest-dive__analysis-icon">💡</span>
                    <span class="latest-dive__analysis-title">What Could Improve</span>
                </div>
                <ul class="latest-dive__analysis-list">
                    ${improvements.map(s => `<li>${s}</li>`).join('')}
                </ul>
            </div>`;
        }

        if (insights.length) {
            html += `<div class="latest-dive__analysis-section latest-dive__analysis-section--neutral">
                <div class="latest-dive__analysis-header">
                    <span class="latest-dive__analysis-icon">📊</span>
                    <span class="latest-dive__analysis-title">Observations</span>
                </div>
                <ul class="latest-dive__analysis-list">
                    ${insights.map(s => `<li>${s}</li>`).join('')}
                </ul>
            </div>`;
        }

        if (!strengths.length && !improvements.length && !insights.length) {
            html += `<div class="latest-dive__analysis-section latest-dive__analysis-section--neutral">
                <div class="latest-dive__analysis-header">
                    <span class="latest-dive__analysis-icon">⏳</span>
                    <span class="latest-dive__analysis-title">Awaiting Data</span>
                </div>
                <p style="color:rgba(255,255,255,0.5);font-size:0.8rem">Metrics haven't been collected yet. Check back after the next collection cycle.</p>
            </div>`;
        }

        html += `</div>`;

        // AI decision summary
        const decisions = [];
        if (hasMetrics) {
            if (perfScore >= exemplarThreshold && exemplarThreshold > 0) {
                decisions.push({ badge: '✓ EXEMPLAR', cls: 'promote', text: `Qualifies for exemplar pool — AI will learn from this post's style.` });
            }
            if (perfTier === 'Below Average') {
                decisions.push({ badge: '✗ NEGATIVE', cls: 'demote', text: `Flagged for "patterns to avoid" pool.` });
            }
            if (hookInfo.type !== bestHookType && bestHookType) {
                decisions.push({ badge: '⟳ ADAPT', cls: 'adjust', text: `AI will shift future hooks toward ${hookPatternPerf[bestHookType]?.label || 'top-performing'} patterns.` });
            }
            if (missedTags.length > 0) {
                decisions.push({ badge: '⟳ TAGS', cls: 'adjust', text: `AI will inject missing top tags: ${missedTags.slice(0, 3).map(t => '#' + t.tag).join(', ')}.` });
            }
        }

        if (decisions.length) {
            html += `<div class="latest-dive__decisions">
                <h4 class="latest-dive__decisions-title">⚡ AI Learning Decisions</h4>
                <div class="latest-dive__decisions-list">
                    ${decisions.map(d => `<div class="latest-dive__decision latest-dive__decision--${d.cls}">
                        <span class="latest-dive__decision-badge">${d.badge}</span>
                        <span>${d.text}</span>
                    </div>`).join('')}
                </div>
            </div>`;
        }

        html += `</div>`;
        _aiDeepDiveHtml = html;

    } catch (err) {
        console.error('[AI Intelligence] loadLatestPostDive error:', err);
        summaryBody.innerHTML = '<div class="ai-empty">Failed to load latest post analysis.</div>';
        _aiDeepDiveHtml = '<div class="ai-empty">Failed to load latest post analysis.</div>';
    }
}
