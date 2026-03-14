// =====================================================
// AI INTELLIGENCE - Exemplar Library
// =====================================================

async function aiLoadExemplars() {
    const container = aiEl('exemplar-library');
    if (!container) return;
    container.innerHTML = '<div class="ai-loading">Loading exemplars…</div>';

    const platform = aiPlatformFilter() || 'youtube_shorts';

    const { data: topExemplars } = await aiSupabase.rpc('get_generation_exemplars', {
        p_brand_id: aiBrandId,
        p_platform: platform,
        p_limit: 5,
    });

    if (!topExemplars?.length) {
        container.innerHTML = '<div class="ai-empty">No exemplars yet. AI needs published posts with engagement data to learn from.</div>';
        return;
    }

    let html = `<p style="font-size:0.72rem;color:rgba(255,255,255,0.4);margin-bottom:12px">
        These posts are injected into every AI prompt as "do this" examples. The AI learns your best-performing style.
    </p>
    <div class="exemplar-list">`;

    for (const ex of topExemplars.slice(0, 5)) {
        const title = ex.fields?.title || 'Untitled';
        const desc = ex.fields?.description || '';
        const perf = ex.performance_value;
        const tags = ex.fields?.tags?.slice(0, 5)?.join(', ') || '';
        html += `
            <div class="exemplar-card exemplar-card--positive">
                <div class="exemplar-card__title">
                    ${aiEscHtml(title)}
                    <span class="exemplar-card__badge exemplar-card__badge--top">DO THIS</span>
                </div>
                <div class="exemplar-card__desc">${aiEscHtml(desc)}</div>
                <div class="exemplar-card__meta">
                    ${perf != null ? `<span class="exemplar-card__meta-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                        Score: ${aiFmt(perf)}
                    </span>` : ''}
                    ${tags ? `<span class="exemplar-card__meta-item">${aiEscHtml(tags)}</span>` : ''}
                </div>
            </div>`;
    }

    html += '</div>';
    container.innerHTML = html;
}
