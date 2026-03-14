// Brand card rendering, grid, and summary stats
// Extracted from brands.html inline script

const NICHE_EMOJIS = {
    horror: '🎃', crime: '🔍', mystery: '🕵️', scifi: '🚀',
    gaming: '🎮', food: '🍳', fitness: '💪', travel: '✈️',
    fashion: '👗', diy: '🔨', science: '🔬', tech: '💻',
    finance: '💰', history: '📜', cars: '🚗', motorcycles: '🏍️',
    pets: '🐾', motivation: '🌟', other: '📝'
};

// All supported platforms for badge display
const PLATFORM_DEFS = [
    { key: 'youtube',   label: 'YT', title: 'YouTube' },
    { key: 'tiktok',    label: 'TT', title: 'TikTok' },
    { key: 'instagram', label: 'IG', title: 'Instagram' },
    { key: 'twitter',   label: 'X',  title: 'Twitter / X' }
];

async function loadBrands() {
    const container = document.getElementById('brands-grid');
    const brands = brandManager.getAll();

    if (brands.length === 0) {
        container.innerHTML = `
            <div class="b2-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                    <line x1="7" y1="7" x2="7.01" y2="7"/>
                </svg>
                <h3>No Brands Yet</h3>
                <p>Create your first brand to start building your content empire</p>
                <button class="b2-header__btn" onclick="openCreateModal()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Create Your First Brand
                </button>
            </div>
        `;
        renderSummary(brands, {});
        return;
    }

    // Show loading skeleton while fetching
    container.innerHTML = brands.map(() => `<div class="b2-skeleton"></div>`).join('');

    // Fetch enrichment data (credentials, music counts, post stats)
    // Pre-fetch ALL post stats in 2 bulk queries (not N+1 per brand)
    const brandIds = brands.map(b => b.id);
    const [allPosts, scheduledPosts] = await Promise.all([
        supabaseClient.from('posts').select('brand_id').in('brand_id', brandIds),
        supabaseClient.from('posts').select('brand_id').in('brand_id', brandIds).eq('status', 'scheduled'),
    ]);
    const totalCountMap = {};
    const scheduledCountMap = {};
    (allPosts.data || []).forEach(p => { totalCountMap[p.brand_id] = (totalCountMap[p.brand_id] || 0) + 1; });
    (scheduledPosts.data || []).forEach(p => { scheduledCountMap[p.brand_id] = (scheduledCountMap[p.brand_id] || 0) + 1; });

    const enrichments = {};
    await Promise.all(brands.map(async (brand) => {
        try {
            const [creds, tracks] = await Promise.all([
                brandManager.getAllCredentials(brand.id).catch(() => []),
                brandManager.getMusicTracks(brand.id).catch(() => []),
            ]);
            enrichments[brand.id] = {
                credentials: creds || [],
                musicCount: (tracks || []).length,
                totalPosts: totalCountMap[brand.id] || 0,
                scheduledPosts: scheduledCountMap[brand.id] || 0,
            };
        } catch (e) {
            enrichments[brand.id] = { credentials: [], musicCount: 0, totalPosts: 0, scheduledPosts: 0 };
        }
    }));

    container.innerHTML = brands.map(brand => renderBrandCard(brand, enrichments[brand.id] || { credentials: [], musicCount: 0, totalPosts: 0, scheduledPosts: 0 })).join('');
    renderSummary(brands, enrichments);

    // Attach event listeners
    container.querySelectorAll('.brand-card__action--edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const brand = brandManager.get(btn.dataset.id);
            if (brand) openEditModal(brand);
        });
    });

    container.querySelectorAll('.brand-card__action--delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteBrand(btn.dataset.id);
        });
    });

    container.querySelectorAll('.brand-card__action--activate').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            brandManager.setActive(btn.dataset.id);
            loadBrands();
            toast.success('Brand activated');
        });
    });

    container.querySelectorAll('.brand-card__action--configure').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSettingsHub(btn.dataset.id);
        });
    });
}

function renderSummary(brands, enrichments) {
    const summaryEl = document.getElementById('brands-summary');
    if (!summaryEl || brands.length === 0) {
        if (summaryEl) summaryEl.innerHTML = '';
        return;
    }

    let totalPosts = 0;
    let totalScheduled = 0;
    let totalPlatforms = 0;
    let totalMusic = 0;

    brands.forEach(brand => {
        const enr = enrichments[brand.id];
        if (enr) {
            totalPosts += enr.totalPosts || 0;
            totalScheduled += enr.scheduledPosts || 0;
            totalPlatforms += enr.credentials.filter(c => c.is_connected).length;
            totalMusic += enr.musicCount;
        }
    });

    summaryEl.innerHTML = `
        <div class="b2-stat">
            <span class="b2-stat__icon">📦</span>
            <div class="b2-stat__value">${brands.length}</div>
            <div class="b2-stat__label">Total Brands</div>
        </div>
        <div class="b2-stat">
            <span class="b2-stat__icon">📝</span>
            <div class="b2-stat__value">${totalPosts}</div>
            <div class="b2-stat__label">Total Posts</div>
        </div>
        <div class="b2-stat">
            <span class="b2-stat__icon">🔗</span>
            <div class="b2-stat__value">${totalPlatforms}</div>
            <div class="b2-stat__label">Connected</div>
        </div>
        <div class="b2-stat">
            <span class="b2-stat__icon">🎵</span>
            <div class="b2-stat__value">${totalMusic}</div>
            <div class="b2-stat__label">Music Tracks</div>
        </div>
    `;
}

// Niche labels with emojis
const NICHE_LABELS = {
    horror: '🎃 Horror',
    crime: '🔍 True Crime',
    mystery: '🕵️ Mystery',
    scifi: '🚀 Sci-Fi',
    gaming: '🎮 Gaming',
    food: '🍳 Food',
    fitness: '💪 Fitness',
    travel: '✈️ Travel',
    fashion: '👗 Fashion',
    diy: '🔨 DIY',
    science: '🔬 Science',
    tech: '💻 Tech',
    finance: '💰 Finance',
    history: '📜 History',
    cars: '🚗 Cars',
    motorcycles: '🏍️ Motorcycles',
    pets: '🐾 Pets',
    motivation: '🌟 Motivation',
    other: '📝 Other'
};

function renderBrandCard(brand, enrichment) {
    const isActive = brandManager.getActiveBrand()?.id === brand.id;
    const nicheLabel = NICHE_LABELS[brand.niche] || brand.niche;
    const nicheEmoji = NICHE_EMOJIS[brand.niche] || '📝';
    const { credentials = [], musicCount = 0, totalPosts = 0, scheduledPosts = 0 } = enrichment || {};

    // Build a set of connected platform keys
    const connectedSet = new Set(
        credentials.filter(c => c.is_connected).map(c => c.platform)
    );
    const connectedCount = connectedSet.size;

    // Platform badges HTML — new glass style
    const platformBadges = PLATFORM_DEFS.map(p => {
        const connected = connectedSet.has(p.key);
        if (!connected) return '';
        return `<span class="b2-badge b2-badge--${p.key}" title="${p.title} — Connected">
            <span class="b2-badge__dot"></span>${p.label}
        </span>`;
    }).filter(Boolean).join('');

    const noConnections = connectedCount === 0 
        ? '<span class="b2-badge" style="opacity:0.4">No platforms linked</span>' 
        : '';

    return `
        <div class="b2-card ${isActive ? 'b2-card--active' : ''}" data-brand="${brand.id}" style="--brand-primary:${brand.theme.primaryColor};--brand-accent:${brand.theme.accentColor || brand.theme.secondaryColor}">
            <div class="b2-card__gradient"></div>
            ${isActive ? '<div class="b2-card__active-badge"><span class="b2-card__active-dot"></span>Active</div>' : ''}
            <div class="b2-card__body">
                <div class="b2-card__top">
                    <div class="b2-card__avatar">${nicheEmoji}</div>
                    <div class="b2-card__info">
                        <h3 class="b2-card__name">${escapeHtml(brand.name)}</h3>
                        <span class="b2-card__niche" style="color:${brand.theme.primaryColor};background:${brand.theme.primaryColor}15;border:1px solid ${brand.theme.primaryColor}30">${nicheLabel}</span>
                    </div>
                </div>
                ${brand.description ? `<p class="b2-card__desc">${escapeHtml(brand.description)}</p>` : ''}

                <div class="b2-card__platforms">
                    ${platformBadges}${noConnections}
                    <a href="connections.html" class="b2-badge" title="Manage connections" style="cursor:pointer;text-decoration:none">+ Add</a>
                </div>

                <div class="b2-card__stats">
                    <div class="b2-card__stat-item">
                        <div class="b2-card__stat-val">${totalPosts}</div>
                        <div class="b2-card__stat-lbl">Posts</div>
                    </div>
                    <div class="b2-card__stat-item">
                        <div class="b2-card__stat-val">${scheduledPosts}</div>
                        <div class="b2-card__stat-lbl">Scheduled</div>
                    </div>
                    <div class="b2-card__stat-item">
                        <div class="b2-card__stat-val">${connectedCount}</div>
                        <div class="b2-card__stat-lbl">Platforms</div>
                    </div>
                    <div class="b2-card__stat-item">
                        <div class="b2-card__stat-val">${musicCount}</div>
                        <div class="b2-card__stat-lbl">Tracks</div>
                    </div>
                </div>
            </div>
            <div class="b2-card__footer">
                <button class="b2-card__config-btn brand-card__action--configure" data-id="${brand.id}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                    Configure
                </button>
                ${!isActive ? `
                    <button class="b2-card__config-btn b2-card__activate-btn brand-card__action--activate" data-id="${brand.id}">Set Active</button>
                ` : `
                    <span class="b2-card__active-pill">✓ Active Brand</span>
                `}
                <div class="b2-card__actions">
                    <button class="b2-card__action brand-card__action--edit" data-id="${brand.id}" title="Edit Brand">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="b2-card__action b2-card__action--danger brand-card__action--delete" data-id="${brand.id}" title="Delete Brand">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    `;
}

