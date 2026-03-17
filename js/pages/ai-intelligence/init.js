// =====================================================
// AI INTELLIGENCE - Init & Tab Orchestration
// =====================================================

(async function aiIntelligenceInit() {
    // Initialize Supabase
    aiSupabase = getSupabaseClient();

    // Initialize sidebar
    if (typeof Sidebar !== 'undefined') {
        new Sidebar();
    }

    // Initialize brand manager
    if (typeof brandManager !== 'undefined' && brandManager.init) {
        await brandManager.init();
    }

    // Resolve active brand
    const activeBrand = brandManager.getActiveBrand();
    aiBrandId = activeBrand?.id;
    if (!aiBrandId) {
        const brands = brandManager.getAll();
        if (brands.length) {
            aiBrandId = brands[0].id;
        }
    }

    // Brand switcher
    if (typeof BrandSwitcher !== 'undefined') {
        const switcher = new BrandSwitcher({
            onSelect: (brandId) => {
                aiBrandId = brandId;
                aiLoadAll();
            }
        });
        switcher.init();
    }

    aiRenderPlatformTabs();
    aiRenderSectionTabs();
    await aiLoadAll();
})();

function aiRenderPlatformTabs() {
    const container = document.getElementById('platform-tabs');
    if (!container) return;
    container.innerHTML = AI_PLATFORMS.map(p =>
        `<button class="ai-pill${p.key === aiCurrentPlatform ? ' ai-pill--active' : ''}"
                 data-platform="${p.key}">${p.label}</button>`
    ).join('');
    container.addEventListener('click', e => {
        const btn = e.target.closest('.ai-pill');
        if (!btn) return;
        aiCurrentPlatform = btn.dataset.platform;
        container.querySelectorAll('.ai-pill').forEach(b => b.classList.remove('ai-pill--active'));
        btn.classList.add('ai-pill--active');
        aiLoadAll();
    });
}

function aiRenderSectionTabs() {
    const container = document.getElementById('ai-section-tabs');
    if (!container) return;
    container.addEventListener('click', e => {
        const btn = e.target.closest('.ai-tab-btn');
        if (!btn) return;
        const tab = btn.dataset.tab;
        if (tab === aiCurrentTab) return;
        aiCurrentTab = tab;
        container.querySelectorAll('.ai-tab-btn').forEach(b => b.classList.remove('ai-tab-btn--active'));
        btn.classList.add('ai-tab-btn--active');
        document.querySelectorAll('.ai-tab-panel').forEach(p => p.classList.remove('ai-tab-panel--active'));
        const panel = document.getElementById('tab-' + tab);
        if (panel) panel.classList.add('ai-tab-panel--active');
        aiLoadAll();
    });
}

async function aiLoadAll() {
    if (!aiBrandId) return;

    await aiLoadStatusBar();

    if (aiCurrentTab === 'overview') {
        await Promise.all([
            aiLoadLatestPostDive(),
            aiLoadPerformanceTrend(),
            aiLoadRetention(),
            aiLoadWinningPatterns(),
            aiLoadExemplars(),
            aiLoadTimeSlotHeatmap(),
            aiLoadThemePerformance(),
            aiLoadGenerationHistory(),
        ]);
    } else if (aiCurrentTab === 'recent-posts') {
        await aiLoadRecentPostInsights();
    } else if (aiCurrentTab === 'cross-platform') {
        await Promise.all([
            aiLoadCrossPlatformComparison(),
            aiLoadStrategyPerformance(),
        ]);
    } else if (aiCurrentTab === 'ai-learning') {
        await Promise.all([
            aiLoadLearningDelta(),
            aiLoadAILearningGrowth(),
        ]);
    }
}
