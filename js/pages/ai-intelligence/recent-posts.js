// =====================================================
// AI INTELLIGENCE - Recent Post Insights
// =====================================================

async function aiLoadRecentPostInsights() {
    const container = aiEl('recent-posts-container');
    if (!container) return;
    container.innerHTML = '<div class="ai-loading">Analyzing post performance data…</div>';

    try {
        let postQuery = aiSupabase.from('posts')
            .select('id, title, description, tags, platform, status, posted_at, video_url, job_id, meta, batch_id')
            .eq('brand_id', aiBrandId).eq('status', 'posted')
            .order('posted_at', { ascending: false }).limit(90);
        if (aiPlatformFilter()) postQuery = postQuery.eq('platform', aiPlatformFilter());

        const { data: posts, error: postErr } = await postQuery;
        if (postErr || !posts?.length) {
            container.innerHTML = '<div class="ai-empty">No posted content yet. Publish some posts to see the AI brain at work.</div>';
            return;
        }

        const postIds = posts.map(p => p.id);
        const plat = aiPlatformFilter() || 'youtube_shorts';

        const [metricsRes, patternsRes, exemplarsRes, timeSlotsRes] = await Promise.all([
            aiSupabase.from('v_post_metrics_latest')
                .select('post_id, platform, views, likes, comments, shares, saves, collected_at')
                .in('post_id', postIds),
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
        ]);

        const metricsMap = {};
        for (const m of (metricsRes.data || [])) metricsMap[m.post_id] = m;

        // Build story groups (by job_id)
        const jobGroups = {};
        for (const p of posts) {
            const key = p.job_id || p.id;
            if (!jobGroups[key]) {
                jobGroups[key] = {
                    title: p.title, description: p.description || '',
                    tags: p.tags || [], posts: [],
                    totalViews: 0, totalLikes: 0, totalComments: 0, totalShares: 0,
                    earliestPosted: p.posted_at, meta: p.meta,
                };
            }
            const m = metricsMap[p.id];
            jobGroups[key].posts.push({ ...p, metrics: m || null });
            if (m) {
                jobGroups[key].totalViews += m.views || 0;
                jobGroups[key].totalLikes += m.likes || 0;
                jobGroups[key].totalComments += m.comments || 0;
                jobGroups[key].totalShares += m.shares || 0;
            }
        }

        const patterns = patternsRes.data?.[0] || null;
        const exemplars = Array.isArray(exemplarsRes.data) ? exemplarsRes.data : [];
        const topTimeSlots = timeSlotsRes.data || [];

        // Brand-wide averages
        const allGroups = Object.values(jobGroups);
        const withMetrics = allGroups.filter(g => g.totalViews > 0 || g.totalLikes > 0);
        const brandAvg = {
            views: withMetrics.length ? Math.round(withMetrics.reduce((s, g) => s + g.totalViews, 0) / withMetrics.length) : 0,
            likes: withMetrics.length ? Math.round(withMetrics.reduce((s, g) => s + g.totalLikes, 0) / withMetrics.length) : 0,
            comments: withMetrics.length ? Math.round(withMetrics.reduce((s, g) => s + g.totalComments, 0) / withMetrics.length) : 0,
        };

        // Hook pattern stats
        const hookPatternPerf = {};
        for (const h of (patterns?.top_hooks || [])) {
            const cls = aiClassifyHook(h.hook);
            if (!hookPatternPerf[cls.type]) hookPatternPerf[cls.type] = { label: cls.label, total: 0, count: 0, best: null };
            hookPatternPerf[cls.type].total += h.perf || 0;
            hookPatternPerf[cls.type].count++;
            if (!hookPatternPerf[cls.type].best || h.perf > hookPatternPerf[cls.type].best.perf) {
                hookPatternPerf[cls.type].best = h;
            }
        }
        for (const p of Object.values(hookPatternPerf)) p.avg = Math.round(p.total / p.count);
        let bestHookType = null;
        for (const [type, data] of Object.entries(hookPatternPerf)) {
            if (!bestHookType || data.avg > hookPatternPerf[bestHookType].avg) bestHookType = type;
        }

        const exemplarPerfs = exemplars.map(e => e.performance_value).sort((a, b) => b - a);
        const exemplarThreshold = exemplarPerfs.length >= 5 ? exemplarPerfs[exemplarPerfs.length - 1] : 0;

        const winTagMap = {};
        for (const wt of (patterns?.top_hashtags || [])) {
            winTagMap[wt.tag.toLowerCase()] = wt;
        }

        // ═══════════════════════════════════════════
        //  LAYER 1: DAILY PERFORMANCE CHART
        // ═══════════════════════════════════════════

        const dailyData = {};
        const platformsSeen = new Set();

        for (const p of posts) {
            if (!p.posted_at) continue;
            const dateKey = p.posted_at.split('T')[0];
            const m = metricsMap[p.id];
            const views = m ? (m.views || 0) : 0;
            const plf = p.platform || 'unknown';
            platformsSeen.add(plf);
            if (!dailyData[dateKey]) dailyData[dateKey] = {};
            dailyData[dateKey][plf] = (dailyData[dateKey][plf] || 0) + views;
        }

        const allDates = Object.keys(dailyData).sort();
        const chartDates = allDates.slice(-30);
        const platformList = [...platformsSeen].sort();

        let maxDayTotal = 0;
        let grandTotal = 0;
        for (const d of chartDates) {
            const dayTotal = Object.values(dailyData[d]).reduce((s, v) => s + v, 0);
            if (dayTotal > maxDayTotal) maxDayTotal = dayTotal;
            grandTotal += dayTotal;
        }

        let html = '';

        // Summary bar
        html += `
            <div class="insights-summary">
                <div class="insights-summary__stat">
                    <span class="insights-summary__value">${allGroups.length}</span>
                    <span class="insights-summary__label">Stories Analyzed</span>
                </div>
                <div class="insights-summary__stat">
                    <span class="insights-summary__value">${aiFmt(brandAvg.views)}</span>
                    <span class="insights-summary__label">Avg Views</span>
                </div>
                <div class="insights-summary__stat">
                    <span class="insights-summary__value">${exemplars.length}/5</span>
                    <span class="insights-summary__label">Exemplar Pool</span>
                </div>
                <div class="insights-summary__stat">
                    <span class="insights-summary__value">${aiFmt(exemplarThreshold)}</span>
                    <span class="insights-summary__label">Exemplar Min</span>
                </div>
            </div>`;

        // Daily chart
        html += `<div class="daily-perf">
            <div class="daily-perf__header">
                <h3 class="daily-perf__title">Daily Views by Platform</h3>
                <span class="daily-perf__total">Last ${chartDates.length} days &middot; <strong>${aiFmt(grandTotal)}</strong> total views</span>
            </div>`;

        if (chartDates.length === 0 || maxDayTotal === 0) {
            html += '<div class="daily-perf__no-data">No view data available yet. Metrics are collected after posts are published.</div>';
        } else {
            html += '<div class="daily-perf__chart">';
            for (const date of chartDates) {
                const dayData = dailyData[date];
                const dayTotal = Object.values(dayData).reduce((s, v) => s + v, 0);
                const d = new Date(date + 'T12:00:00');
                const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                let tooltipRows = `<div class="daily-perf__tooltip-row"><strong>${dateLabel}</strong> — ${aiFmt(dayTotal)} views</div>`;
                for (const plf of platformList) {
                    const v = dayData[plf] || 0;
                    if (v >= 0 && dailyData[date][plf] !== undefined) {
                        const color = AI_PLATFORM_COLORS[plf] || '#6b7280';
                        const label = AI_PLATFORM_LABELS[plf] || plf;
                        tooltipRows += `<div class="daily-perf__tooltip-row">
                            <span class="daily-perf__tooltip-dot" style="background:${color}"></span>
                            ${label}: ${v > 0 ? aiFmt(v) : '0 views (posted)'}
                        </div>`;
                    }
                }

                let segmentsHTML = '';
                for (const plf of platformList) {
                    const v = dayData[plf] || 0;
                    if (dailyData[date][plf] !== undefined) {
                        const h = v > 0 ? Math.max(4, (v / maxDayTotal) * 160) : 3;
                        const opacity = v === 0 ? ' opacity:0.4;' : '';
                        segmentsHTML += `<div class="daily-perf__segment daily-perf__segment--${plf}" style="height:${h}px;${opacity}" title="${AI_PLATFORM_LABELS[plf] || plf}: ${v > 0 ? aiFmt(v) : '0 views'}"></div>`;
                    }
                }

                html += `
                    <div class="daily-perf__bar-group">
                        <div class="daily-perf__tooltip">${tooltipRows}</div>
                        <div class="daily-perf__bar-stack">${segmentsHTML}</div>
                        <span class="daily-perf__date">${dateLabel}</span>
                    </div>`;
            }
            html += '</div>';

            html += '<div class="daily-perf__legend">';
            for (const plf of platformList) {
                html += `<span class="daily-perf__legend-item">
                    <span class="daily-perf__legend-dot daily-perf__legend-dot--${plf}"></span>
                    ${AI_PLATFORM_LABELS[plf] || plf}
                </span>`;
            }
            html += '</div>';
        }

        html += '</div>';

        // ═══════════════════════════════════════════
        //  LAYER 2: TOP 5 PERFORMERS
        // ═══════════════════════════════════════════

        const scoredGroups = Object.entries(jobGroups).map(([jobId, group]) => {
            const perfScore = group.totalViews + 5 * group.totalLikes + 10 * group.totalComments + 10 * group.totalShares;
            return { jobId, group, perfScore };
        }).filter(g => g.perfScore > 0)
          .sort((a, b) => b.perfScore - a.perfScore)
          .slice(0, 5);

        const avgPerfScore = brandAvg.views + 5 * brandAvg.likes + 10 * brandAvg.comments;

        html += `<div class="top-performers">
            <div class="top-performers__header">
                <h3 class="top-performers__title">&#127942; Top Performers</h3>
                <span class="top-performers__subtitle">Ranked by composite performance score &middot; AI brain analysis per story</span>
            </div>`;

        if (!scoredGroups.length) {
            html += '<div class="ai-empty">No performance data yet. Posts need metrics before ranking.</div>';
        }

        html += '<div class="insights-list">';

        for (let rank = 0; rank < scoredGroups.length; rank++) {
            const { jobId, group, perfScore } = scoredGroups[rank];
            const posted = new Date(group.earliestPosted);
            const dateStr = posted.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = posted.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const vibePreset = group.meta?.vibe_preset || 'default';

            let perfTier, perfClass, perfIcon;
            if (avgPerfScore === 0 || perfScore >= avgPerfScore * 1.3) {
                perfTier = 'Above Average'; perfClass = 'perf--high'; perfIcon = '&#9650;';
            } else if (perfScore >= avgPerfScore * 0.7) {
                perfTier = 'Average'; perfClass = 'perf--mid'; perfIcon = '&#9644;';
            } else {
                perfTier = 'Below Average'; perfClass = 'perf--low'; perfIcon = '&#9660;';
            }

            const multiplier = avgPerfScore > 0 ? (perfScore / avgPerfScore) : 0;
            const outlierBadge = multiplier >= 1.5
                ? `<span class="outlier-badge">${multiplier.toFixed(1)}× avg</span>`
                : '';

            // AI BRAIN: per-story analysis
            const postHook = aiClassifyHook(group.title);
            const postTagSet = new Set((group.tags).map(t => t.toLowerCase()));
            const postDescLen = group.description.length;

            // 1. AI SIGNAL
            let signalHTML = '';
            const viewRatio = brandAvg.views > 0 ? group.totalViews / brandAvg.views : 0;
            const engRate = group.totalViews > 0
                ? ((group.totalLikes + group.totalComments) / group.totalViews * 100) : 0;
            const avgEngRate = brandAvg.views > 0
                ? ((brandAvg.likes + brandAvg.comments) / brandAvg.views * 100) : 0;

            if (group.totalViews > 0 || group.totalLikes > 0) {
                const viewPct = brandAvg.views > 0
                    ? (viewRatio >= 1 ? `+${Math.round((viewRatio - 1) * 100)}%` : `${Math.round((viewRatio - 1) * 100)}%`)
                    : 'no baseline';
                signalHTML = `
                    <div class="ai-brain-block ai-brain-block--signal">
                        <div class="ai-brain-block__header">
                            <span class="ai-brain-block__icon">◉</span>
                            <span class="ai-brain-block__title">AI Signal</span>
                        </div>
                        <div class="ai-brain-block__content">
                            <span class="ai-brain-datum">${aiFmt(group.totalViews)} views <em>(${viewPct} vs brand avg ${aiFmt(brandAvg.views)})</em></span>
                            <span class="ai-brain-datum">Engagement rate: ${engRate.toFixed(1)}%${avgEngRate > 0 ? ` <em>(brand avg ${avgEngRate.toFixed(1)}%)</em>` : ''}</span>
                            ${group.totalShares > 0 ? `<span class="ai-brain-datum">${group.totalShares} shares — content is being redistributed by viewers</span>` : ''}
                            <span class="ai-brain-datum">Perf score: ${aiFmt(perfScore)} · Exemplar entry: ${aiFmt(exemplarThreshold)} → ${perfScore >= exemplarThreshold ? '<strong class="ai-brain-hit">QUALIFIES</strong>' : '<strong class="ai-brain-miss">BELOW THRESHOLD</strong>'}</span>
                        </div>
                    </div>`;
            } else {
                signalHTML = `
                    <div class="ai-brain-block ai-brain-block--signal">
                        <div class="ai-brain-block__header">
                            <span class="ai-brain-block__icon">◉</span>
                            <span class="ai-brain-block__title">AI Signal</span>
                        </div>
                        <div class="ai-brain-block__content">
                            <span class="ai-brain-datum ai-brain-datum--dim">Awaiting first metrics collection cycle. No signal to process yet.</span>
                        </div>
                    </div>`;
            }

            // 2. PATTERN ANALYSIS
            const patternItems = [];
            const thisPatternData = hookPatternPerf[postHook.type];
            const bestPatternData = bestHookType ? hookPatternPerf[bestHookType] : null;

            if (thisPatternData && bestPatternData) {
                if (postHook.type === bestHookType) {
                    patternItems.push(`<div class="ai-brain-pattern ai-brain-pattern--match">
                        <strong>HOOK →</strong> "${aiEscHtml(group.title.slice(0, 70))}" uses <em>${postHook.label}</em> pattern.
                        This IS the top-performing format — avg ${aiFmt(thisPatternData.avg)} views across ${thisPatternData.count} tracked posts.
                    </div>`);
                } else {
                    patternItems.push(`<div class="ai-brain-pattern ai-brain-pattern--mismatch">
                        <strong>HOOK →</strong> "${aiEscHtml(group.title.slice(0, 70))}" uses <em>${postHook.label}</em> pattern (avg ${aiFmt(thisPatternData.avg)} views).
                        The data shows <em>${bestPatternData.label}</em> outperforms at avg ${aiFmt(bestPatternData.avg)} views.
                    </div>`);
                }
            } else if (patterns?.top_hooks?.length) {
                const topHook = patterns.top_hooks[0];
                patternItems.push(`<div class="ai-brain-pattern ai-brain-pattern--neutral">
                    <strong>HOOK →</strong> "${aiEscHtml(group.title.slice(0, 70))}" uses <em>${postHook.label}</em> pattern.
                    No historical data for this style yet. Current #1 hook: "${aiEscHtml(topHook.hook.slice(0, 60))}" at ${aiFmt(topHook.perf)} views.
                </div>`);
            }

            // Tag overlap
            const matchedTags = [];
            const missedTopTags = [];
            for (const wt of (patterns?.top_hashtags || []).slice(0, 8)) {
                if (postTagSet.has(wt.tag.toLowerCase())) {
                    matchedTags.push(wt);
                } else {
                    missedTopTags.push(wt);
                }
            }
            const topTagCount = (patterns?.top_hashtags || []).slice(0, 8).length;
            if (topTagCount > 0) {
                let tagLine = `<div class="ai-brain-pattern${matchedTags.length >= topTagCount * 0.6 ? ' ai-brain-pattern--match' : matchedTags.length <= topTagCount * 0.3 ? ' ai-brain-pattern--mismatch' : ' ai-brain-pattern--neutral'}">
                    <strong>TAGS →</strong> ${matchedTags.length}/${topTagCount} top-performing tags present.`;
                if (matchedTags.length) {
                    tagLine += `<br><span class="ai-tag-label ai-tag-label--hit">Using:</span> ${matchedTags.map(t => `<code>#${t.tag}</code> <em>(avg ${aiFmt(t.avg_perf)})</em>`).join(', ')}`;
                }
                if (missedTopTags.length) {
                    tagLine += `<br><span class="ai-tag-label ai-tag-label--miss">Missing:</span> ${missedTopTags.slice(0, 3).map(t => `<code>#${t.tag}</code> <em>(avg ${aiFmt(t.avg_perf)})</em>`).join(', ')}`;
                }
                tagLine += '</div>';
                patternItems.push(tagLine);
            }

            // Description length
            if (patterns?.length_stats?.avg_desc_len) {
                const optLen = Math.round(patterns.length_stats.avg_desc_len);
                const delta = postDescLen - optLen;
                const pct = optLen > 0 ? Math.round(Math.abs(delta) / optLen * 100) : 0;
                let descClass = Math.abs(pct) <= 20 ? 'ai-brain-pattern--match' : 'ai-brain-pattern--mismatch';
                patternItems.push(`<div class="ai-brain-pattern ${descClass}">
                    <strong>LENGTH →</strong> Description: ${postDescLen} chars (winning avg: ~${optLen}).
                    ${pct <= 20 ? 'Within optimal range.' :
                      delta > 0 ? `${pct}% longer than top performers.` :
                      `${pct}% shorter than top performers.`}
                </div>`);
            }

            // Posting time
            const dow = posted.getDay();
            const hour = posted.getHours();
            const bestSlot = topTimeSlots[0];
            const thisSlot = topTimeSlots.find(s => s.day_of_week === dow && s.hour === hour);
            if (bestSlot) {
                if (thisSlot) {
                    patternItems.push(`<div class="ai-brain-pattern ai-brain-pattern--match">
                        <strong>TIMING →</strong> Posted ${AI_DAY_NAMES[dow]} ${aiFormatHour(hour)} —
                        top-performing time slot (score: ${thisSlot.score}).
                    </div>`);
                } else {
                    patternItems.push(`<div class="ai-brain-pattern ai-brain-pattern--mismatch">
                        <strong>TIMING →</strong> Posted ${AI_DAY_NAMES[dow]} ${aiFormatHour(hour)}.
                        Best slot: <strong>${AI_DAY_NAMES[bestSlot.day_of_week]} ${aiFormatHour(bestSlot.hour)}</strong> (score: ${bestSlot.score}).
                    </div>`);
                }
            }

            const patternHTML = patternItems.length ? `
                <div class="ai-brain-block ai-brain-block--patterns">
                    <div class="ai-brain-block__header">
                        <span class="ai-brain-block__icon">⧉</span>
                        <span class="ai-brain-block__title">Pattern Analysis</span>
                    </div>
                    <div class="ai-brain-block__content">${patternItems.join('')}</div>
                </div>` : '';

            // 3. AI DECISION LOG
            const decisions = [];

            if (perfScore > 0) {
                if (perfScore >= exemplarThreshold || exemplars.length < 5) {
                    const rankInPool = exemplarPerfs.filter(p => p >= perfScore).length + 1;
                    decisions.push(`<div class="ai-brain-decision ai-brain-decision--promote">
                        <span class="ai-brain-badge ai-brain-badge--promote">✓ PROMOTE TO EXEMPLAR</span>
                        Qualifies for exemplar pool at rank #${rankInPool}/${exemplars.length} (perf ${aiFmt(perfScore)} exceeds threshold ${aiFmt(exemplarThreshold)}).
                    </div>`);
                } else {
                    decisions.push(`<div class="ai-brain-decision ai-brain-decision--demote">
                        <span class="ai-brain-badge ai-brain-badge--demote">↓ BELOW EXEMPLAR THRESHOLD</span>
                        Perf score ${aiFmt(perfScore)} below pool minimum (${aiFmt(exemplarThreshold)}).
                    </div>`);
                }

                if (perfTier === 'Below Average') {
                    decisions.push(`<div class="ai-brain-decision ai-brain-decision--negative">
                        <span class="ai-brain-badge ai-brain-badge--negative">✗ NEGATIVE SIGNAL</span>
                        Flagged for "patterns to avoid" pool.
                    </div>`);
                }
            }

            if (postHook.type !== bestHookType && bestPatternData && thisPatternData) {
                decisions.push(`<div class="ai-brain-decision ai-brain-decision--adjust">
                    <span class="ai-brain-badge ai-brain-badge--adjust">⟳ HOOK STYLE SHIFT</span>
                    ${postHook.label} hooks avg ${aiFmt(thisPatternData.avg)} views vs ${bestPatternData.label} at ${aiFmt(bestPatternData.avg)}.
                </div>`);
            } else if (postHook.type === bestHookType && perfTier === 'Above Average') {
                decisions.push(`<div class="ai-brain-decision ai-brain-decision--reinforce">
                    <span class="ai-brain-badge ai-brain-badge--reinforce">↑ PATTERN REINFORCED</span>
                    ${postHook.label} pattern confirmed as dominant performer.
                </div>`);
            }

            if (missedTopTags.length > 0) {
                const topMissed = missedTopTags.sort((a, b) => (b.avg_perf || 0) - (a.avg_perf || 0)).slice(0, 3);
                decisions.push(`<div class="ai-brain-decision ai-brain-decision--adjust">
                    <span class="ai-brain-badge ai-brain-badge--adjust">⟳ TAG INJECTION</span>
                    Missing: ${topMissed.map(t => `<code>#${t.tag}</code> (avg ${aiFmt(t.avg_perf)})`).join(', ')}.
                </div>`);
            }

            if (bestSlot && !thisSlot) {
                decisions.push(`<div class="ai-brain-decision ai-brain-decision--adjust">
                    <span class="ai-brain-badge ai-brain-badge--adjust">⟳ SCHEDULE SHIFT</span>
                    Recommend ${AI_DAY_NAMES[bestSlot.day_of_week]} ${aiFormatHour(bestSlot.hour)} (score: ${bestSlot.score}).
                </div>`);
            }

            const decisionHTML = decisions.length ? `
                <div class="ai-brain-block ai-brain-block--decisions">
                    <div class="ai-brain-block__header">
                        <span class="ai-brain-block__icon">⚡</span>
                        <span class="ai-brain-block__title">Decision Log</span>
                    </div>
                    <div class="ai-brain-block__content">${decisions.join('')}</div>
                </div>` : '';

            // 4. NEXT GEN STRATEGY
            const actions = [];

            if (bestPatternData) {
                const keepHook = postHook.type === bestHookType && perfTier !== 'Below Average';
                actions.push(keepHook
                    ? `<strong>Hook:</strong> Continue ${postHook.label} pattern — dominant with avg ${aiFmt(bestPatternData.avg)} views.`
                    : `<strong>Hook:</strong> Shift to ${bestPatternData.label}. Model: "${aiEscHtml(bestPatternData.best.hook.slice(0, 55))}…" (${aiFmt(bestPatternData.best.perf)} views).`
                );
            }

            if (patterns?.length_stats) {
                actions.push(`<strong>Description:</strong> Target ~${Math.round(patterns.length_stats.avg_desc_len)} chars with ~${Math.round(patterns.length_stats.avg_tag_count)} tags.`);
            }

            if (matchedTags.length || missedTopTags.length) {
                const priorityTags = [...matchedTags, ...missedTopTags]
                    .sort((a, b) => (b.avg_perf || 0) - (a.avg_perf || 0)).slice(0, 5);
                actions.push(`<strong>Priority tags:</strong> ${priorityTags.map(t => `<code>#${t.tag}</code>`).join(' ')}`);
            }

            if (bestSlot) {
                actions.push(`<strong>Optimal posting:</strong> ${AI_DAY_NAMES[bestSlot.day_of_week]} ${aiFormatHour(bestSlot.hour)}${topTimeSlots.length > 1 ? `, or ${AI_DAY_NAMES[topTimeSlots[1].day_of_week]} ${aiFormatHour(topTimeSlots[1].hour)}` : ''}.`);
            }

            if (vibePreset !== 'default') {
                const vibeLabel = vibePreset.replace(/_/g, ' ');
                actions.push(perfTier === 'Below Average'
                    ? `<strong>Vibe:</strong> "${vibeLabel}" underperformed — test alternatives next batch.`
                    : `<strong>Vibe:</strong> "${vibeLabel}" ${perfTier === 'Above Average' ? 'performing well — keep.' : 'at baseline — monitoring.'}`
                );
            }

            const strategyHTML = actions.length ? `
                <div class="ai-brain-block ai-brain-block--strategy">
                    <div class="ai-brain-block__header">
                        <span class="ai-brain-block__icon">→</span>
                        <span class="ai-brain-block__title">Next Gen Strategy</span>
                    </div>
                    <div class="ai-brain-block__content">
                        ${actions.map(a => `<div class="ai-brain-action">${a}</div>`).join('')}
                    </div>
                </div>` : '';

            // Platform badges
            const platformBadges = group.posts.map(p => {
                const m = p.metrics;
                const views = m ? aiFmt(m.views) : '—';
                const platLabel = AI_PLATFORM_LABELS[p.platform] || p.platform || '?';
                return `<span class="insight-platform-badge insight-platform-badge--${p.platform}"
                    title="${m ? `Views: ${m.views}, Likes: ${m.likes}, Comments: ${m.comments}` : 'No metrics yet'}">
                    ${platLabel} <span class="insight-platform-badge__views">${views}</span></span>`;
            }).join('');

            html += `
                <div class="insight-card">
                    <div class="insight-card__header">
                        <div class="insight-card__title-row">
                            <span class="top-performers__rank top-performers__rank--${rank + 1}">${rank + 1}</span>
                            <h4 class="insight-card__title">${aiEscHtml(group.title)}</h4>
                            <span class="insight-card__perf ${perfClass}" title="Performance: ${perfScore}">
                                ${perfIcon} ${perfTier}
                            </span>
                            ${outlierBadge}
                        </div>
                        <div class="insight-card__meta">
                            <span class="insight-card__date">${dateStr} at ${timeStr}</span>
                            <span class="insight-card__vibe">${aiEscHtml(vibePreset.replace(/_/g, ' '))}</span>
                        </div>
                        <div class="insight-card__platforms">${platformBadges}</div>
                    </div>

                    <div class="insight-card__metrics">
                        <div class="insight-metric">
                            <span class="insight-metric__value">${aiFmt(group.totalViews)}</span>
                            <span class="insight-metric__label">Views</span>
                        </div>
                        <div class="insight-metric">
                            <span class="insight-metric__value">${aiFmt(group.totalLikes)}</span>
                            <span class="insight-metric__label">Likes</span>
                        </div>
                        <div class="insight-metric">
                            <span class="insight-metric__value">${aiFmt(group.totalComments)}</span>
                            <span class="insight-metric__label">Comments</span>
                        </div>
                        <div class="insight-metric">
                            <span class="insight-metric__value">${aiFmt(group.totalShares)}</span>
                            <span class="insight-metric__label">Shares</span>
                        </div>
                        <div class="insight-metric insight-metric--score">
                            <span class="insight-metric__value">${aiFmt(perfScore)}</span>
                            <span class="insight-metric__label">Perf Score</span>
                        </div>
                    </div>

                    <div class="insight-card__brain">
                        ${signalHTML}
                        ${patternHTML}
                        ${decisionHTML}
                        ${strategyHTML}
                    </div>
                </div>`;
        }

        html += '</div>';  // close insights-list
        html += '</div>';  // close top-performers
        container.innerHTML = html;

    } catch (err) {
        console.error('[AI Intelligence] loadRecentPostInsights error:', err);
        container.innerHTML = '<div class="ai-empty">Failed to load post insights. Please try again.</div>';
    }
}
