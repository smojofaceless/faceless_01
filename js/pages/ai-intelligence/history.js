// =====================================================
// AI INTELLIGENCE - Generation History
// =====================================================

async function aiLoadGenerationHistory() {
    const container = aiEl('generation-history');
    if (!container) return;
    container.innerHTML = '<div class="ai-loading">Loading generation history…</div>';

    let query = aiSupabase
        .from('post_metadata_versions')
        .select('id, post_id, platform, version_number, version_type, variant_key, fields, generation_model, created_at')
        .order('created_at', { ascending: false })
        .limit(15);

    if (aiPlatformFilter()) {
        query = query.eq('platform', aiPlatformFilter());
    }

    const { data: versions, error } = await query;

    if (error || !versions?.length) {
        container.innerHTML = '<div class="ai-empty">No generation history yet.</div>';
        return;
    }

    let html = '<div class="gen-timeline">';
    for (const v of versions) {
        const isEdit = v.version_type === 'manual' || v.version_type === 'edit';
        const title = v.fields?.title || 'Untitled';
        const date = new Date(v.created_at);
        const timeStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
            date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const platLabel = AI_PLATFORM_LABELS[v.platform] || (v.platform || '').replace('_reels', '').replace('_shorts', '');
        const typeLabel = isEdit ? 'Manual edit' : `AI generated${v.generation_model ? ' · ' + v.generation_model : ''}`;
        const variantLabel = v.variant_key ? ` · Variant: ${v.variant_key}` : '';

        html += `
            <div class="gen-event">
                <div class="gen-event__dot${isEdit ? ' gen-event__dot--edit' : ''}"></div>
                <div class="gen-event__time">${timeStr} · ${platLabel}${variantLabel}</div>
                <div class="gen-event__title">${aiEscHtml(title)}</div>
                <div class="gen-event__detail">v${v.version_number} · ${typeLabel}</div>
            </div>`;
    }
    html += '</div>';

    container.innerHTML = html;
}
