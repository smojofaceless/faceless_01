// =====================================================
// AI INTELLIGENCE - Time Slot Heatmap
// =====================================================

async function aiLoadTimeSlotHeatmap() {
    const container = aiEl('timeslot-heatmap');
    if (!container) return;
    container.innerHTML = '<div class="ai-loading">Loading time slot data…</div>';

    const platform = aiPlatformFilter() || 'youtube_shorts';

    // Try RPC first, fall back to direct table
    let slots = null, bestTimes = null;
    try {
        const res = await aiSupabase.rpc('get_time_slot_scores', {
            p_brand_id: aiBrandId, p_platform: platform, p_window_days: 30,
        });
        slots = res.data;
    } catch (e) { /* RPC may not exist */ }

    if (!slots?.length) {
        // Fall back to direct table query
        const { data } = await aiSupabase.from('time_slot_scores')
            .select('day_of_week, hour, score, post_count')
            .eq('brand_id', aiBrandId)
            .eq('platform', platform);
        slots = data;
    }

    try {
        const res = await aiSupabase.rpc('get_best_time_slots', {
            p_brand_id: aiBrandId, p_platform: platform, p_window_days: 30, p_limit: 5,
        });
        bestTimes = res.data;
    } catch (e) { /* RPC may not exist */ }

    if (!slots?.length) {
        container.innerHTML = '<div class="ai-empty">No time slot data yet. Need published posts with measured engagement.</div>';
        return;
    }

    const scoreMap = {};
    let maxScore = 1;
    for (const s of slots) {
        const key = `${s.day_of_week}-${s.hour}`;
        scoreMap[key] = s.score || 0;
        if (s.score > maxScore) maxScore = s.score;
    }

    const days = AI_DAY_NAMES;
    const startHour = 6;
    const endHour = 23;

    let html = '<div class="heatmap-container"><div class="heatmap" style="grid-template-columns: 60px repeat(' + (endHour - startHour + 1) + ', 1fr)">';

    html += '<div class="heatmap__header"></div>';
    for (let h = startHour; h <= endHour; h++) {
        const label = h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p';
        html += `<div class="heatmap__header">${label}</div>`;
    }

    for (let d = 0; d < 7; d++) {
        html += `<div class="heatmap__row-label">${days[d]}</div>`;
        for (let h = startHour; h <= endHour; h++) {
            const score = scoreMap[`${d}-${h}`] || 0;
            const ratio = score / maxScore;
            let level = 'empty';
            if (ratio > 0.8) level = 'l5';
            else if (ratio > 0.5) level = 'l4';
            else if (ratio > 0.3) level = 'l3';
            else if (ratio > 0.1) level = 'l2';
            else if (score > 0) level = 'l1';
            const label = h === 0 ? '12 AM' : h < 12 ? h + ' AM' : h === 12 ? '12 PM' : (h - 12) + ' PM';
            html += `<div class="heatmap__cell heatmap__cell--${level}"><span class="ai-tooltip">${days[d]} ${label}: ${Math.round(score)}</span></div>`;
        }
    }

    html += '</div></div>';

    html += `
        <div class="heatmap-legend">
            <span>Less</span>
            <div class="heatmap-legend__scale">
                <div class="heatmap-legend__block heatmap__cell--empty" style="width:14px;height:14px"></div>
                <div class="heatmap-legend__block heatmap__cell--l1" style="width:14px;height:14px"></div>
                <div class="heatmap-legend__block heatmap__cell--l2" style="width:14px;height:14px"></div>
                <div class="heatmap-legend__block heatmap__cell--l3" style="width:14px;height:14px"></div>
                <div class="heatmap-legend__block heatmap__cell--l4" style="width:14px;height:14px"></div>
                <div class="heatmap-legend__block heatmap__cell--l5" style="width:14px;height:14px"></div>
            </div>
            <span>More</span>
        </div>
    `;

    if (bestTimes?.length) {
        html += '<div class="best-times">';
        for (const bt of bestTimes) {
            html += `<span class="best-time-badge">
                <span class="best-time-badge__day">${bt.day_name}</span>
                ${bt.hour_label}
                <span class="best-time-badge__score">score ${Math.round(bt.score)}</span>
            </span>`;
        }
        html += '</div>';
    }

    container.innerHTML = html;
}
