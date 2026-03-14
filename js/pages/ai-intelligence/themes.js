// =====================================================
// AI INTELLIGENCE - Story DNA & Themes
// =====================================================

async function aiLoadThemePerformance() {
    const container = aiEl('theme-performance');
    if (!container) return;
    container.innerHTML = '<div class="ai-loading">Loading story DNA…</div>';

    const { data: dna, error } = await aiSupabase
        .from('story_dna')
        .select('genre, threat_id, escalation_id, era_label, brand_id')
        .eq('brand_id', aiBrandId)
        .order('created_at', { ascending: false })
        .limit(200);

    if (error) {
        console.error('[AI Intelligence] Story DNA query error:', error);
        container.innerHTML = '<div class="ai-empty">Error loading story DNA data.</div>';
        return;
    }
    if (!dna?.length) {
        container.innerHTML = '<div class="ai-empty">No story DNA data yet. Stories need to be generated first.</div>';
        return;
    }

    const vibeCounts = {};
    const threatCounts = {};
    for (const d of dna) {
        const vibe = d.genre || 'default';
        vibeCounts[vibe] = (vibeCounts[vibe] || 0) + 1;
        const threat = d.threat_id || 'unknown';
        threatCounts[threat] = (threatCounts[threat] || 0) + 1;
    }

    const maxVibe = Math.max(...Object.values(vibeCounts));
    const maxThreat = Math.max(...Object.values(threatCounts));

    let html = '';

    html += '<div class="pattern-section"><h4 class="pattern-section__title">Vibe Presets Used</h4><div class="theme-list">';
    const sortedVibes = Object.entries(vibeCounts).sort((a, b) => b[1] - a[1]);
    for (const [vibe, count] of sortedVibes) {
        const pct = (count / maxVibe) * 100;
        html += `<div class="theme-row">
            <span class="theme-row__label">${aiEscHtml(vibe.replace(/_/g, ' '))}</span>
            <div class="theme-row__bar-wrap"><div class="theme-row__bar" style="width:${pct}%"></div></div>
            <span class="theme-row__count">${count} stories</span>
        </div>`;
    }
    html += '</div></div>';

    if (Object.keys(threatCounts).length > 1) {
        html += '<div class="pattern-section"><h4 class="pattern-section__title">Threat Types</h4><div class="theme-list">';
        const sortedThreats = Object.entries(threatCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
        for (const [threat, count] of sortedThreats) {
            const pct = (count / maxThreat) * 100;
            html += `<div class="theme-row">
                <span class="theme-row__label">${aiEscHtml(threat.replace(/_/g, ' '))}</span>
                <div class="theme-row__bar-wrap"><div class="theme-row__bar" style="width:${pct}%"></div></div>
                <span class="theme-row__count">${count}</span>
            </div>`;
        }
        html += '</div></div>';
    }

    html += `<p style="font-size:0.72rem;color:rgba(255,255,255,0.35);margin-top:12px">
        ${dna.length} stories analyzed &middot; AI avoids recent themes to maintain diversity
    </p>`;

    container.innerHTML = html;
}
