// =====================================================
// DASHBOARD - Brand Overview
// =====================================================

async function dbLoadBrands() {
    const container = document.getElementById('brand-overview');
    if (!container) return;

    try {
        const { data: brands, error } = await dbSupabase
            .from('brands')
            .select('id, name, niche, slug, is_active, theme')
            .order('is_active', { ascending: false });

        if (error) throw error;

        if (!brands || brands.length === 0) {
            container.innerHTML = '<div class="db-empty"><span>No brands configured</span><a href="pages/brands.html" class="db-empty__link">Add Brand</a></div>';
            return;
        }

        const brandIds = brands.map(b => b.id);
        const { data: postedPosts } = await dbSupabase
            .from('posts').select('brand_id').in('brand_id', brandIds).eq('status', 'posted');

        const countMap = {};
        (postedPosts || []).forEach(p => { countMap[p.brand_id] = (countMap[p.brand_id] || 0) + 1; });

        container.innerHTML = `<div class="db-brands">${brands.map(b => {
            const color = b.theme?.primaryColor || '#8b5cf6';
            const count = countMap[b.id] || 0;
            return `
                <div class="db-brand ${b.is_active ? 'db-brand--active' : ''}">
                    <div class="db-brand__bar" style="background:${color}"></div>
                    <div class="db-brand__info">
                        <span class="db-brand__name">${escapeHtml(b.name)}</span>
                        <span class="db-brand__niche">${escapeHtml(b.niche || 'General')}</span>
                    </div>
                    <div class="db-brand__meta">
                        <span class="db-brand__count">${count} posted</span>
                        ${b.is_active ? '<span class="db-badge db-badge--success">Active</span>' : ''}
                    </div>
                </div>`;
        }).join('')}</div>`;
    } catch (e) {
        console.error('dbLoadBrands:', e);
        container.innerHTML = '<div class="db-empty"><span>Failed to load</span></div>';
    }
}
