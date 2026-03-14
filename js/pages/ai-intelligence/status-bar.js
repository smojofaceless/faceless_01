// =====================================================
// AI INTELLIGENCE - Status Bar / Hero Stats
// =====================================================

async function aiLoadStatusBar() {
    try {
        let versionQuery = aiSupabase.from('post_metadata_versions').select('id', { count: 'exact', head: true });
        let dnaQuery = aiSupabase.from('story_dna').select('id', { count: 'exact', head: true });
        let patternsQuery = aiSupabase.from('winning_metadata_patterns').select('id', { count: 'exact', head: true })
            .eq('brand_id', aiBrandId);

        const [vRes, dRes, pRes] = await Promise.all([versionQuery, dnaQuery, patternsQuery]);

        const totalGens = vRes.count || 0;
        const totalDna = dRes.count || 0;
        const totalPatterns = pRes.count || 0;

        const { data: latestPattern } = await aiSupabase
            .from('winning_metadata_patterns')
            .select('computed_at')
            .eq('brand_id', aiBrandId)
            .order('computed_at', { ascending: false })
            .limit(1);

        const lastComputed = latestPattern?.[0]?.computed_at;
        const computedLabel = lastComputed
            ? new Date(lastComputed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : 'Never';

        const genEl = aiEl('stat-generations');
        const storiesEl = aiEl('stat-stories');
        const patternsEl = aiEl('stat-patterns');
        const lastEl = aiEl('stat-last-computed');

        if (genEl) genEl.textContent = aiFmt(totalGens);
        if (storiesEl) storiesEl.textContent = aiFmt(totalDna);
        if (patternsEl) patternsEl.textContent = aiFmt(totalPatterns);
        if (lastEl) lastEl.textContent = computedLabel;
    } catch (err) {
        console.error('[AI Intelligence] loadStatusBar error:', err);
    }
}
