// =====================================================
// DASHBOARD - Init & Orchestration
// =====================================================

(function () {
    'use strict';

    async function dbInit() {
        console.log('Dashboard: init');

        // Sidebar
        if (typeof Sidebar !== 'undefined') new Sidebar();

        // Supabase
        dbSupabase = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
        if (!dbSupabase) {
            console.warn('Dashboard: No Supabase client');
            return;
        }

        // Brand manager
        if (typeof brandManager !== 'undefined' && brandManager.init) {
            await brandManager.init();
        }

        // Brand switcher
        if (typeof BrandSwitcher !== 'undefined') {
            new BrandSwitcher({
                onSelect: (brand) => {
                    dbActiveBrandId = brand?.id || brand;
                    dbLoadAll();
                }
            }).init();
        }

        // Resolve active brand
        try {
            const { data } = await dbSupabase.from('brands').select('id').eq('is_active', true).limit(1);
            if (data && data.length) {
                dbActiveBrandId = data[0].id;
            } else {
                const { data: any } = await dbSupabase.from('brands').select('id').limit(1);
                if (any && any.length) dbActiveBrandId = any[0].id;
            }
        } catch (e) {
            console.error('resolveActiveBrand:', e);
        }

        // Header date
        const dateEl = document.getElementById('header-date');
        if (dateEl) {
            dateEl.textContent = new Date().toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric'
            });
        }

        // Initial load
        await dbLoadAll();

        // Auto-refresh every 60s
        dbRefreshTimer = setInterval(() => dbLoadAll(), 60000);

        console.log('Dashboard: ready');
    }

    async function dbLoadAll() {
        await Promise.all([
            dbLoadStats(),
            dbLoadUpcoming(),
            dbLoadPlatforms(),
            dbLoadPerformance(),
            dbLoadCosts(),
            dbLoadPresets(),
            dbLoadBrands(),
            dbLoadActivity(),
            dbLoadBestTimes()
        ]);
    }

    // Make dbLoadAll available globally for brand switch
    window.dbLoadAll = dbLoadAll;

    document.addEventListener('DOMContentLoaded', dbInit);
})();
