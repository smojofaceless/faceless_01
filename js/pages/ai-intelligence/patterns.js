// =====================================================
// AI INTELLIGENCE - Winning Patterns
// =====================================================

async function aiLoadWinningPatterns() {
    const container = aiEl('winning-patterns');
    if (!container) return;
    container.innerHTML = '<div class="ai-loading">Loading winning patterns…</div>';

    const platform = aiPlatformFilter() || 'youtube_shorts';
    const { data, error } = await aiSupabase.rpc('get_winning_patterns', {
        p_brand_id: aiBrandId,
        p_platform: platform,
        p_vibe_preset: null,
    });

    if (error || !data?.length) {
        container.innerHTML = '<div class="ai-empty">No winning patterns computed yet. The system needs published posts with metrics.</div>';
        return;
    }

    const patterns = data[0];
    let html = '';

    if (patterns.top_hooks?.length) {
        html += `<div class="pattern-section">
            <h4 class="pattern-section__title">Top-Performing Hooks</h4>
            <p style="font-size:0.72rem;color:rgba(255,255,255,0.4);margin-bottom:8px">Injected into AI prompts as style references</p>
            <ul class="hook-list">`;
        for (let i = 0; i < Math.min(patterns.top_hooks.length, 5); i++) {
            const h = patterns.top_hooks[i];
            html += `
                <li class="hook-item">
                    <span class="hook-item__rank">#${i + 1}</span>
                    <span class="hook-item__text">${aiEscHtml(h.hook)}</span>
                    <span class="hook-item__perf">${aiFmt(h.perf)} score</span>
                </li>`;
        }
        html += '</ul></div>';
    }

    if (patterns.top_hashtags?.length) {
        html += `<div class="pattern-section">
            <h4 class="pattern-section__title">Best Hashtags</h4>
            <div class="tag-cloud">`;
        for (const t of patterns.top_hashtags.slice(0, 12)) {
            html += `<span class="tag-cloud__item">#${aiEscHtml(t.tag)} <span class="tag-cloud__count">&times;${t.count}</span> <span class="tag-cloud__perf">avg ${aiFmt(t.avg_perf)}</span></span>`;
        }
        html += '</div></div>';
    }

    if (patterns.length_stats) {
        const ls = patterns.length_stats;
        html += `<div class="pattern-section">
            <h4 class="pattern-section__title">Optimal Content Lengths</h4>
            <div class="length-stats">
                <div class="length-stat">
                    <span class="length-stat__value">${Math.round(ls.avg_title_len || 0)}</span>
                    <span class="length-stat__label">Avg Title Chars</span>
                </div>
                <div class="length-stat">
                    <span class="length-stat__value">${Math.round(ls.avg_desc_len || 0)}</span>
                    <span class="length-stat__label">Avg Desc Chars</span>
                </div>
                <div class="length-stat">
                    <span class="length-stat__value">${Math.round(ls.avg_tag_count || 0)}</span>
                    <span class="length-stat__label">Avg Tag Count</span>
                </div>
            </div>
        </div>`;
    }

    html += `<p style="font-size:0.72rem;color:rgba(255,255,255,0.35);margin-top:12px">
        Based on ${patterns.sample_count || 0} posts &middot; Avg performance: ${aiFmt(patterns.avg_performance || 0)} &middot;
        Last computed: ${patterns.computed_at ? new Date(patterns.computed_at).toLocaleDateString() : 'N/A'}
    </p>`;

    container.innerHTML = html;
}
