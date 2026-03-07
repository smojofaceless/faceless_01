// =====================================================
// CALENDAR PAGE CONTROLLER
// Handles calendar page initialization and interactions
// =====================================================

(function() {
    'use strict';

    // Page state
    let calendar = null;
    let currentView = 'month';
    let selectedPost = null;
    let activeBrandFilter = null; // null = All Brands, string = specific brand ID
    let allBrands = []; // Cached list of all brands

    // DOM Elements
    const elements = {
        calendarContainer: null,
        calendarTitle: null,
        todayBtn: null,
        prevBtn: null,
        nextBtn: null,
        viewToggleBtns: null,
        platformFilter: null,
        statusFilter: null,
        postModal: null,
        postModalBody: null,
        createPostBtn: null,
        brandFilterBar: null
    };

    /**
     * Initialize the calendar page
     */
    function init() {
        console.log('📅 Initializing Calendar Page');
        
        // Cache DOM elements
        cacheElements();
        
        // Initialize sidebar
        if (typeof Sidebar !== 'undefined') {
            new Sidebar();
        }

        // Initialize brand switcher
        if (typeof BrandSwitcher !== 'undefined') {
            const brandSwitcher = new BrandSwitcher({
                onSelect: handleBrandChange
            });
            brandSwitcher.init();
        }

        // Wait for ContentEngine to be ready
        if (typeof contentEngine !== 'undefined' && contentEngine.initialized) {
            initCalendar();
        } else {
            window.addEventListener('contentengine:ready', initCalendar);
        }
    }

    /**
     * Cache DOM element references
     */
    function cacheElements() {
        elements.calendarContainer = document.getElementById('calendar-container');
        elements.calendarTitle = document.getElementById('calendar-title');
        elements.todayBtn = document.getElementById('today-btn');
        elements.prevBtn = document.getElementById('prev-btn');
        elements.nextBtn = document.getElementById('next-btn');
        elements.viewToggleBtns = document.querySelectorAll('.view-toggle__btn');
        elements.platformFilter = document.getElementById('platform-filter');
        elements.statusFilter = document.getElementById('status-filter');
        elements.postModal = document.getElementById('post-modal');
        elements.postModalBody = document.getElementById('post-modal-body');
        elements.createPostBtn = document.getElementById('create-post-btn');
        elements.brandFilterBar = document.getElementById('brand-filter-bar');
    }

    /**
     * Initialize the calendar component
     */
    async function initCalendar() {
        console.log('📅 Creating Calendar instance');

        // Initialize metrics service
        if (typeof MetricsService !== 'undefined' && typeof metricsService !== 'undefined') {
            await metricsService.init();
        }

        // Initialize time slot service
        if (typeof TimeSlotService !== 'undefined' && typeof timeSlotService !== 'undefined') {
            await timeSlotService.init();
        }

        // Initialize metadata version service
        if (typeof MetadataVersionService !== 'undefined' && typeof metadataVersionService !== 'undefined') {
            await metadataVersionService.init();
        }

        // Build brand filter bar and brand map
        await buildBrandFilterBar();

        // Create calendar instance — start with no brand filter (all brands)
        calendar = new Calendar({
            container: elements.calendarContainer,
            view: currentView,
            onDateClick: handleDateClick,
            onPostClick: handlePostClick,
            onSlotClick: handleSlotClick,
            onNavigate: handleNavigate
        });

        // Set the brand map so calendar can show brand indicators
        calendar.setBrandMap(buildBrandMap());

        // Initialize calendar (async — loads data from Supabase)
        await calendar.init();

        // Enrich posted items with metrics badges
        await enrichCalendarMetrics();

        // Set up page controls
        setupToolbar();
        setupFilters();
        setupBestTimes();
        setupModal();

        // Update title initially
        updateCalendarTitle();

        console.log('✅ Calendar initialized');
    }

    /**
     * Build the brand lookup map for the calendar component
     * @returns {Map} brandId → { name, color }
     */
    function buildBrandMap() {
        const map = new Map();
        if (typeof brandManager !== 'undefined') {
            const brands = brandManager.getAll();
            for (const brand of brands) {
                map.set(brand.id, {
                    name: brand.name,
                    color: brand.theme?.primaryColor || '#8b5cf6'
                });
            }
        }
        return map;
    }

    /**
     * Build the brand filter pill bar at the top of the calendar
     */
    async function buildBrandFilterBar() {
        if (!elements.brandFilterBar || typeof brandManager === 'undefined') return;

        allBrands = brandManager.getAll();

        // Only show the filter bar if there's more than 1 brand
        if (allBrands.length <= 1) {
            elements.brandFilterBar.style.display = 'none';
            // If only one brand, just set the filter to that brand
            if (allBrands.length === 1) {
                activeBrandFilter = allBrands[0].id;
            }
            return;
        }

        // Build brand pills HTML (the "All Brands" pill is already in HTML)
        const pillsHTML = allBrands.map(brand => {
            const color = brand.theme?.primaryColor || '#8b5cf6';
            return `
                <button class="brand-filter-pill" data-brand-id="${brand.id}">
                    <span class="brand-filter-pill__dot" style="background: ${color}"></span>
                    <span>${escapeHtml(brand.name)}</span>
                </button>
            `;
        }).join('');

        // Append brand pills after the "All Brands" pill
        elements.brandFilterBar.insertAdjacentHTML('beforeend', pillsHTML);

        // Set up click handlers
        elements.brandFilterBar.addEventListener('click', async (e) => {
            const pill = e.target.closest('.brand-filter-pill');
            if (!pill) return;

            const brandId = pill.dataset.brandId || null; // empty string = all brands

            // Update active state
            elements.brandFilterBar.querySelectorAll('.brand-filter-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');

            // Update filter
            activeBrandFilter = brandId || null;

            if (calendar) {
                await calendar.setFilters({ brandId: activeBrandFilter });
                await enrichCalendarMetrics();
            }
        });

        // Listen for brand changes from the brand manager (e.g., new brands created)
        brandManager.on('brand:created', () => rebuildBrandFilterBar());
        brandManager.on('brand:deleted', () => rebuildBrandFilterBar());
        brandManager.on('brand:updated', () => rebuildBrandFilterBar());
    }

    /**
     * Rebuild the brand filter bar (e.g., when brands change)
     */
    async function rebuildBrandFilterBar() {
        if (!elements.brandFilterBar) return;

        // Clear existing brand pills (keep the "All Brands" pill)
        const allPill = elements.brandFilterBar.querySelector('.brand-filter-pill--all');
        elements.brandFilterBar.innerHTML = '';
        if (allPill) elements.brandFilterBar.appendChild(allPill);

        await buildBrandFilterBar();

        // Update the calendar's brand map
        if (calendar) {
            calendar.setBrandMap(buildBrandMap());
        }
    }

    /**
     * Enrich rendered calendar items with metrics data
     * Fetches latest metrics for posted items and re-renders with badges
     */
    async function enrichCalendarMetrics() {
        if (typeof metricsService === 'undefined' || !calendar || !calendar._cachedItems) return;

        try {
            // Collect ALL post IDs including from consolidated platform sub-items
            const allPostIds = new Set();
            for (const item of calendar._cachedItems) {
                if (item.id && (item.status === 'posted' || (item.isConsolidated && item.platforms))) {
                    allPostIds.add(item.id);
                    // Also collect sub-platform IDs for consolidated items
                    if (item.isConsolidated && item.platforms) {
                        for (const p of item.platforms) {
                            if (p.id && p.status === 'posted') allPostIds.add(p.id);
                        }
                    }
                }
            }

            if (allPostIds.size === 0) return;

            const metricsMap = await metricsService.getLatestMetricsBatch([...allPostIds]);

            if (metricsMap.size === 0) return;

            // Attach metrics to cached items
            let enriched = 0;
            for (const item of calendar._cachedItems) {
                if (item.isConsolidated && item.platforms) {
                    // For consolidated items: attach per-platform metrics + aggregate for badge
                    const totals = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, collected_at: null };
                    let hasAny = false;
                    for (const p of item.platforms) {
                        const pm = metricsMap.get(p.id);
                        if (pm) {
                            p.metrics = pm;
                            hasAny = true;
                            totals.views += pm.views || 0;
                            totals.likes += pm.likes || 0;
                            totals.comments += pm.comments || 0;
                            totals.shares += pm.shares || 0;
                            totals.saves += pm.saves || 0;
                            if (!totals.collected_at || new Date(pm.collected_at) > new Date(totals.collected_at)) {
                                totals.collected_at = pm.collected_at;
                            }
                        }
                    }
                    if (hasAny) {
                        item.metrics = totals; // Aggregate for badge display
                        enriched++;
                    }
                } else {
                    const m = metricsMap.get(item.id);
                    if (m) {
                        item.metrics = m;
                        enriched++;
                    }
                }
            }

            if (enriched > 0) {
                console.log(`📊 Calendar: Enriched ${enriched} posts with metrics (${allPostIds.size} total IDs)`);
                // Re-render to show badges
                await calendar.render();
            }
        } catch (e) {
            console.warn('Calendar metrics enrichment failed (non-fatal):', e);
        }
    }

    /**
     * Set up toolbar controls
     */
    function setupToolbar() {
        // Today button
        if (elements.todayBtn) {
            elements.todayBtn.addEventListener('click', () => {
                calendar.today();
            });
        }

        // Previous button
        if (elements.prevBtn) {
            elements.prevBtn.addEventListener('click', () => {
                calendar.prev();
            });
        }

        // Next button
        if (elements.nextBtn) {
            elements.nextBtn.addEventListener('click', () => {
                calendar.next();
            });
        }

        // View toggle buttons
        elements.viewToggleBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                if (view && view !== currentView) {
                    // Update active state
                    elements.viewToggleBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    
                    // Switch view
                    currentView = view;
                    calendar.setView(view);
                }
            });
        });

        // Create post button
        if (elements.createPostBtn) {
            elements.createPostBtn.addEventListener('click', () => {
                // Navigate to create page or open modal
                window.location.href = 'create.html';
            });
        }
    }

    /**
     * Set up filter controls
     */
    function setupFilters() {
        // Platform filter
        if (elements.platformFilter) {
            elements.platformFilter.addEventListener('change', (e) => {
                const platformId = e.target.value || null;
                calendar.setFilters({ platformId });
            });
        }

        // Status filter
        if (elements.statusFilter) {
            elements.statusFilter.addEventListener('change', (e) => {
                const status = e.target.value || null;
                calendar.setFilters({ status });
            });
        }
    }

    // ==================== Best Times Panel ====================

    let bestTimesOpen = false;
    let bestTimesPlatform = 'youtube';
    let bestTimesWindow = 30;

    /**
     * Set up Best Times toggle and panel controls
     */
    function setupBestTimes() {
        const toggleBtn = document.getElementById('best-times-toggle');
        const panel = document.getElementById('best-times-panel');
        if (!toggleBtn || !panel) return;

        // Toggle panel
        toggleBtn.addEventListener('click', () => {
            bestTimesOpen = !bestTimesOpen;
            panel.style.display = bestTimesOpen ? 'block' : 'none';
            toggleBtn.classList.toggle('active', bestTimesOpen);
            if (bestTimesOpen) {
                loadBestTimes();
            }
        });

        // Platform selector
        const platformSelect = document.getElementById('best-times-platform');
        if (platformSelect) {
            platformSelect.addEventListener('change', (e) => {
                bestTimesPlatform = e.target.value;
                timeSlotService.clearCache();
                loadBestTimes();
            });
        }

        // Window toggle buttons
        const windowBtns = panel.querySelectorAll('.best-times-panel__window-btn');
        windowBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                windowBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                bestTimesWindow = parseInt(btn.dataset.window, 10);
                timeSlotService.clearCache();
                loadBestTimes();
            });
        });
    }

    /**
     * Load and render best time slots
     */
    async function loadBestTimes() {
        const container = document.getElementById('best-times-content');
        if (!container || typeof timeSlotService === 'undefined') return;

        // Get current brand
        const brandId = calendar?._filters?.brandId || null;
        if (!brandId) {
            container.innerHTML = '<div class="best-times__empty"><span>Select a brand to see best posting times</span></div>';
            return;
        }

        container.innerHTML = '<div class="best-times__empty"><span>Loading...</span></div>';

        try {
            const slots = await timeSlotService.getBestTimeSlots(brandId, bestTimesPlatform, bestTimesWindow, 5);
            container.innerHTML = timeSlotService.buildBestTimesHTML(slots);
        } catch (e) {
            console.warn('Failed to load best times:', e);
            container.innerHTML = '<div class="best-times__empty"><span>Failed to load data</span></div>';
        }
    }

    /**
     * Set up modal
     */
    function setupModal() {
        if (!elements.postModal) return;

        // Move modal to body to avoid parent constraints
        if (elements.postModal.parentElement !== document.body) {
            document.body.appendChild(elements.postModal);
        }

        // Close button handlers
        const closeBtn = elements.postModal.querySelector('.modal__close');
        const closeBtnFooter = document.getElementById('modal-close-btn');
        const overlay = elements.postModal.querySelector('.modal__overlay');
        const editBtn = document.getElementById('modal-edit-btn');

        [closeBtn, closeBtnFooter, overlay].forEach(el => {
            if (el) {
                el.addEventListener('click', closeModal);
            }
        });

        // Edit button
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                if (selectedPost) {
                    window.location.href = `posts.html?edit=${selectedPost.id}`;
                }
            });
        }

        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && elements.postModal.classList.contains('active')) {
                closeModal();
            }
        });
    }

    /**
     * Handle brand change from brand switcher (header dropdown)
     * Syncs the pill filter bar and updates the calendar
     * @param {Object} brand - Selected brand
     */
    async function handleBrandChange(brand) {
        const brandId = brand?.id || null;
        activeBrandFilter = brandId;

        // Sync the brand pill bar
        if (elements.brandFilterBar) {
            elements.brandFilterBar.querySelectorAll('.brand-filter-pill').forEach(p => {
                const pillBrandId = p.dataset.brandId || null;
                p.classList.toggle('active', pillBrandId === (brandId || ''));
            });

            // If a specific brand is selected from the header, activate its pill
            // If no brand matches (shouldn't happen), activate "All Brands"
            const activePill = elements.brandFilterBar.querySelector(`.brand-filter-pill[data-brand-id="${brandId || ''}"]`);
            if (activePill) {
                elements.brandFilterBar.querySelectorAll('.brand-filter-pill').forEach(p => p.classList.remove('active'));
                activePill.classList.add('active');
            }
        }

        if (calendar) {
            await calendar.setFilters({ brandId: brandId });
            await enrichCalendarMetrics();
        }
    }

    /**
     * Handle calendar navigation
     * @param {Object} info - Navigation info
     */
    function handleNavigate(info) {
        updateCalendarTitle(info.title);
    }

    /**
     * Update the calendar title display
     * @param {string} title - Title text (optional, will get from calendar if not provided)
     */
    function updateCalendarTitle(title) {
        if (elements.calendarTitle) {
            if (title) {
                elements.calendarTitle.textContent = title;
            } else if (calendar) {
                elements.calendarTitle.textContent = calendar.getCurrentTitle();
            }
        }
    }

    /**
     * Handle date click
     * @param {Date} date - Clicked date
     * @param {Array} posts - Posts for that date (optional)
     */
    function handleDateClick(date, posts) {
        console.log('Date clicked:', date, posts);
        
        // Could show a quick-create modal or day detail view
        // For now, just log it
        if (posts && posts.length > 0) {
            // Show a day detail modal with all posts
            showDayDetailModal(date, posts);
        }
    }

    /**
     * Handle post click
     * @param {Object} post - Clicked post
     */
    function handlePostClick(post) {
        console.log('Post clicked:', post);
        selectedPost = post;
        showPostModal(post);
    }

    /**
     * Handle slot click (available scheduling slot)
     * @param {Date} time - Slot time
     */
    function handleSlotClick(time) {
        console.log('Slot clicked:', time);
        
        // Could open a quick-schedule modal
        // For now, navigate to create page with time param
        const timeStr = time.toISOString();
        window.location.href = `create.html?scheduledAt=${encodeURIComponent(timeStr)}`;
    }

    /**
     * Show post detail modal with Metadata Control Center
     * Supports consolidated items (multi-platform) with tabs
     * @param {Object} post - Post to display (unified calendar item, may be consolidated)
     * @param {string} [activePlatformId] - Which platform tab to show first
     */
    function showPostModal(post, activePlatformId) {
        if (!elements.postModal || !elements.postModalBody) return;

        // Reset modal title
        const modalTitle = elements.postModal.querySelector('.modal__title');
        if (modalTitle) modalTitle.textContent = 'Post Details';

        // Determine if this is a consolidated (multi-platform) item
        const isConsolidated = post.isConsolidated && post.platforms && post.platforms.length > 1;
        const activePost = isConsolidated
            ? (post.platforms.find(p => p.platformId === activePlatformId) || post.platforms[0])
            : post;

        const isJob = activePost.type === 'job';
        const isJobComplete = isJob && (activePost.status === 'scheduled' || activePost.raw?.status === 'complete');
        const statusLabel = isJob 
            ? (activePost.status === 'pending' ? 'Pending Generation' 
               : isJobComplete ? 'Complete' 
               : activePost.status === 'failed' ? 'Failed' 
               : 'Generating...') 
            : activePost.status;

        const meta = activePost.metadata || null;

        // Build platform tabs HTML (only for consolidated items)
        const tabsHtml = isConsolidated ? `
            <div class="platform-tabs" id="platform-tabs">
                ${post.platforms.map(p => {
                    const isActive = p.platformId === activePost.platformId;
                    const pColor = calendar ? calendar.getPlatformColor(p.platformId) : '#666';
                    const pName = getPlatformDisplayName(p.platformId);
                    const pStatus = p.status || 'unknown';
                    return `
                        <button class="platform-tab ${isActive ? 'platform-tab--active' : ''}"
                                data-platform-id="${p.platformId}"
                                style="--tab-color: ${pColor}">
                            <span class="platform-tab__dot"></span>
                            <span class="platform-tab__name">${pName}</span>
                            <span class="platform-tab__status badge badge--${getStatusClass(pStatus)} badge--xs">${pStatus}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        ` : '';

        // Platform badge for the active platform
        const platform = typeof getPlatform === 'function' 
            ? getPlatform(activePost.platformId) 
            : { name: activePost.platformId };

        // Build modal content
        elements.postModalBody.innerHTML = `
            <div class="post-detail">
                ${tabsHtml}

                <div class="post-detail__header">
                    ${isJob ? `
                        <span class="badge badge--info" style="font-size: 11px;">
                            &#9881; Job
                        </span>
                    ` : ''}
                    ${!isConsolidated ? `
                        <span class="platform-badge platform-badge--${activePost.platformId}">
                            ${platform?.name || activePost.platformId}
                        </span>
                    ` : ''}
                    <span class="badge badge--${getStatusClass(activePost.status)}">
                        ${statusLabel}
                    </span>
                </div>
                
                <h4 class="post-detail__title">
                    ${escapeHtml(activePost.content?.title || 'Untitled')}
                </h4>
                
                ${activePost.content?.description ? `
                    <p class="post-detail__desc">
                        ${escapeHtml(activePost.content.description)}
                    </p>
                ` : ''}
                
                <div class="post-detail__meta">
                    <div class="meta-item">
                        <strong>Scheduled:</strong>
                        <span>${formatDateTime(activePost.scheduledAt)}</span>
                    </div>
                    
                    ${activePost.publishedAt ? `
                        <div class="meta-item">
                            <strong>Published:</strong>
                            <span>${formatDateTime(activePost.publishedAt)}</span>
                        </div>
                    ` : ''}
                    
                    ${activePost.content?.duration ? `
                        <div class="meta-item">
                            <strong>Duration:</strong>
                            <span>${formatDuration(activePost.content.duration)}</span>
                        </div>
                    ` : ''}

                    ${activePost.batchId ? `
                        <div class="meta-item">
                            <strong>Campaign:</strong>
                            <span style="font-family: monospace; font-size: 11px;">${activePost.batchId.substring(0, 8)}...</span>
                        </div>
                    ` : ''}
                    
                    ${activePost.lastError ? `
                        <div class="meta-item meta-item--error">
                            <strong>Error:</strong>
                            <span>${escapeHtml(activePost.lastError)}</span>
                        </div>
                    ` : ''}
                </div>
                
                ${activePost.content?.videoUrl ? `
                    <div class="post-detail__preview">
                        <video 
                            src="${activePost.content.videoUrl}" 
                            poster="${activePost.content.thumbnailUrl || ''}"
                            controls
                            preload="metadata"
                            style="max-width: 100%; border-radius: 8px;">
                        </video>
                    </div>
                ` : isJob ? `
                    <div class="post-detail__preview" style="text-align: center; padding: 24px; background: var(--surface-secondary); border-radius: 8px; color: var(--text-muted);">
                        <div style="font-size: 32px; margin-bottom: 8px;">${isJobComplete ? '&#10003;' : '&#9881;'}</div>
                        <p style="margin: 0;">${isJobComplete ? 'Video complete — ready to publish' : 'Video is being generated...'}</p>
                    </div>
                ` : ''}

                ${!isJob ? buildMetadataSection(activePost, meta) : `
                    <div class="metadata-section" style="opacity: 0.6;">
                        <div class="metadata-section__header">
                            <h5 class="metadata-section__title">AI Metadata</h5>
                            <span class="metadata-badge metadata-badge--none">N/A</span>
                        </div>
                        <div class="metadata-section__empty">
                            <p>AI metadata will be generated once this job is imported as a post.</p>
                            ${isJobComplete ? '<p style="margin-top: 8px; font-size: 12px; color: var(--text-muted);">This job is complete — click <strong>Edit Post</strong> to import it, then metadata will auto-generate.</p>' : ''}
                        </div>
                    </div>
                `}

                <!-- Metrics section (loaded async) -->
                <div id="post-metrics-section"></div>
            </div>
        `;

        // Attach metadata event handlers
        if (!isJob) {
            attachMetadataHandlers(activePost);
        }

        // Load metrics for posted items (pass full post for consolidated per-platform view)
        if (!isJob && (activePost.status === 'posted' || (isConsolidated && post.platforms.some(p => p.status === 'posted')))) {
            loadPostMetrics(isConsolidated ? post : activePost);
        }

        // Attach platform tab click handlers
        if (isConsolidated) {
            const tabContainer = document.getElementById('platform-tabs');
            if (tabContainer) {
                tabContainer.addEventListener('click', (e) => {
                    const tab = e.target.closest('.platform-tab');
                    if (!tab) return;
                    const pid = tab.dataset.platformId;
                    if (pid && pid !== activePost.platformId) {
                        // Store the consolidated post reference, re-render modal with new active tab
                        selectedPost = post;
                        showPostModal(post, pid);
                    }
                });
            }
        }

        // Show modal
        elements.postModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Get human-readable display name for a platform
     * @param {string} platformId
     * @returns {string}
     */
    function getPlatformDisplayName(platformId) {
        const names = {
            youtube_shorts: 'YouTube Shorts',
            tiktok: 'TikTok',
            instagram_reels: 'Instagram Reels',
            facebook_reels: 'Facebook Reels',
            youtube: 'YouTube',
            instagram: 'Instagram',
            facebook: 'Facebook',
            twitter: 'Twitter',
            threads: 'Threads'
        };
        return names[platformId] || platformId;
    }

    // ==================== Metrics Section ====================

    /**
     * Load and display metrics for a post in the modal
     * @param {Object} post - Calendar item (must be posted)
     */
    async function loadPostMetrics(post) {
        const container = document.getElementById('post-metrics-section');
        if (!container || typeof metricsService === 'undefined') return;

        // Show loading
        container.innerHTML = `
            <div class="metrics-detail">
                <div class="metrics-detail__header">
                    <h5>Engagement Metrics</h5>
                    <span class="badge badge--muted badge--xs">loading...</span>
                </div>
            </div>
        `;

        try {
            // Determine if this is a consolidated multi-platform post
            const isConsolidated = post.isConsolidated && post.platforms && post.platforms.length > 1;
            const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

            if (isConsolidated) {
                // Fetch metrics for ALL platforms in parallel
                const platformMetrics = [];
                const fetchPromises = post.platforms
                    .filter(p => p.status === 'posted' && p.id)
                    .map(async (p) => {
                        const [latest, history] = await Promise.all([
                            metricsService.getLatestMetrics(p.id),
                            metricsService.getPostMetrics(p.id, { since, limit: 5 }),
                        ]);
                        return {
                            platformId: p.platformId,
                            platformName: getPlatformDisplayName(p.platformId),
                            platformUrl: p.raw?.platform_url || null,
                            latest,
                            history
                        };
                    });

                const results = await Promise.all(fetchPromises);
                container.innerHTML = buildPerPlatformMetricsHTML(results);
            } else {
                // Single platform — existing behavior
                const postId = post.id || post.raw?.id;
                if (!postId) {
                    container.innerHTML = '';
                    return;
                }

                const [latest, history] = await Promise.all([
                    metricsService.getLatestMetrics(postId),
                    metricsService.getPostMetrics(postId, { since, limit: 10 }),
                ]);

                // Wrap single-platform in per-platform display too
                const platId = post.platformId || 'unknown';
                const platResults = [{
                    platformId: platId,
                    platformName: getPlatformDisplayName(platId),
                    platformUrl: post.raw?.platform_url || null,
                    latest,
                    history
                }];
                container.innerHTML = buildPerPlatformMetricsHTML(platResults);
            }
        } catch (e) {
            console.warn('Failed to load post metrics:', e);
            container.innerHTML = metricsService.buildDetailHTML(null, []);
        }
    }

    /**
     * Build per-platform metrics breakdown HTML
     * Shows aggregate totals + per-platform cards with stats and history
     * @param {Array} platformResults - [{platformId, platformName, platformUrl, latest, history}]
     * @returns {string} HTML
     */
    function buildPerPlatformMetricsHTML(platformResults) {
        if (!platformResults || platformResults.length === 0) {
            return metricsService.buildDetailHTML(null, []);
        }

        // Filter to platforms that have data
        const withData = platformResults.filter(p => p.latest);
        const withoutData = platformResults.filter(p => !p.latest);

        if (withData.length === 0) {
            return metricsService.buildDetailHTML(null, []);
        }

        // Compute aggregate totals across all platforms
        const totals = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
        let latestCollected = null;
        for (const p of withData) {
            totals.views += p.latest.views || 0;
            totals.likes += p.latest.likes || 0;
            totals.comments += p.latest.comments || 0;
            totals.shares += p.latest.shares || 0;
            totals.saves += p.latest.saves || 0;
            if (!latestCollected || new Date(p.latest.collected_at) > new Date(latestCollected)) {
                latestCollected = p.latest.collected_at;
            }
        }

        const collectedLabel = latestCollected ? metricsService.formatTimeAgo(latestCollected) : 'N/A';

        // Aggregate totals section
        const aggregateHTML = `
            <div class="metrics-detail">
                <div class="metrics-detail__header">
                    <h5>Engagement Metrics</h5>
                    <span class="badge badge--success badge--xs" title="Last collected: ${collectedLabel}">
                        &#128200; ${collectedLabel}
                    </span>
                </div>
                <div class="metrics-stats">
                    <div class="metrics-stat">
                        <span class="metrics-stat__value">${metricsService.formatCount(totals.views)}</span>
                        <span class="metrics-stat__label">Total Views</span>
                    </div>
                    <div class="metrics-stat">
                        <span class="metrics-stat__value">${metricsService.formatCount(totals.likes)}</span>
                        <span class="metrics-stat__label">Total Likes</span>
                    </div>
                    <div class="metrics-stat">
                        <span class="metrics-stat__value">${metricsService.formatCount(totals.comments)}</span>
                        <span class="metrics-stat__label">Total Comments</span>
                    </div>
                    <div class="metrics-stat">
                        <span class="metrics-stat__value">${metricsService.formatCount(totals.shares)}</span>
                        <span class="metrics-stat__label">Total Shares</span>
                    </div>
                    ${totals.saves > 0 ? `
                    <div class="metrics-stat">
                        <span class="metrics-stat__value">${metricsService.formatCount(totals.saves)}</span>
                        <span class="metrics-stat__label">Total Saves</span>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;

        // Per-platform breakdown cards
        const platformCardsHTML = withData.map(p => {
            const m = p.latest;
            const perfScore = (m.views || 0) + 5 * (m.likes || 0) + 10 * (m.comments || 0) + 10 * (m.shares || 0);
            const perfClass = perfScore > 100 ? 'perf--high' : perfScore > 20 ? 'perf--mid' : 'perf--low';
            const platformLink = p.platformUrl
                ? `<a href="${p.platformUrl}" target="_blank" class="metrics-platform__link" title="View on ${p.platformName}">&#8599;</a>`
                : '';

            // Mini history (last 3 entries)
            const historyRows = (p.history || []).slice(0, 3).map(h => `
                <tr>
                    <td>${metricsService.formatTimeAgo(h.collected_at)}</td>
                    <td>${metricsService.formatCount(h.views)}</td>
                    <td>${metricsService.formatCount(h.likes)}</td>
                    <td>${metricsService.formatCount(h.comments)}</td>
                </tr>
            `).join('');

            return `
                <div class="metrics-platform-card">
                    <div class="metrics-platform-card__header">
                        <span class="metrics-platform-card__name platform-badge platform-badge--${p.platformId}">
                            ${p.platformName}
                        </span>
                        <span class="metrics-platform-card__perf ${perfClass}" title="Performance score">
                            ${perfScore}
                        </span>
                        ${platformLink}
                    </div>
                    <div class="metrics-platform-card__stats">
                        <span title="Views">&#128065; ${metricsService.formatCount(m.views)}</span>
                        <span title="Likes">&#10084; ${metricsService.formatCount(m.likes)}</span>
                        <span title="Comments">&#128172; ${metricsService.formatCount(m.comments)}</span>
                        <span title="Shares">&#128257; ${metricsService.formatCount(m.shares)}</span>
                        ${(m.saves || 0) > 0 ? `<span title="Saves">&#128278; ${metricsService.formatCount(m.saves)}</span>` : ''}
                    </div>
                    ${historyRows ? `
                    <table class="metrics-platform-card__history">
                        <thead><tr><th>When</th><th>Views</th><th>Likes</th><th>Comments</th></tr></thead>
                        <tbody>${historyRows}</tbody>
                    </table>
                    ` : ''}
                </div>
            `;
        }).join('');

        // Platforms with no data
        const noDataHTML = withoutData.length > 0 ? `
            <div class="metrics-platform-nodata">
                ${withoutData.map(p => `<span class="badge badge--muted badge--xs">${p.platformName}: no data</span>`).join(' ')}
            </div>
        ` : '';

        return `
            ${aggregateHTML}
            <div class="metrics-platform-breakdown">
                <h6 class="metrics-platform-breakdown__title">Per-Platform Breakdown</h6>
                <div class="metrics-platform-cards">
                    ${platformCardsHTML}
                </div>
                ${noDataHTML}
            </div>
        `;
    }

    // ==================== Metadata Control Center ====================

    /**
     * Build the metadata control center section HTML
     * @param {Object} post - Calendar item
     * @param {Object|null} meta - Metadata object from postQueue enrichment
     * @returns {string} HTML string
     */
    function buildMetadataSection(post, meta) {
        const status = meta?.status || 'none';
        const fields = meta?.finalMetadata || meta?.aiMetadata || null;
        const error = meta?.error || null;
        const attemptCount = meta?.attemptCount || 0;
        const failureClass = meta?.failureClass || null;
        const nextRetry = meta?.nextRetryAt ? new Date(meta.nextRetryAt) : null;
        const generatedAt = meta?.generatedAt ? formatDateTime(meta.generatedAt) : null;
        const editedAt = meta?.editedAt ? formatDateTime(meta.editedAt) : null;

        // Determine what fields to show based on platform
        const fieldConfig = getMetadataFieldConfig(post.platformId);

        return `
            <div class="metadata-section" id="metadata-section">
                <div class="metadata-section__header">
                    <h5 class="metadata-section__title">AI Metadata</h5>
                    <span class="metadata-badge metadata-badge--${status}">
                        ${getMetadataStatusLabel(status)}
                    </span>
                </div>

                ${status === 'failed' ? `
                    <div class="metadata-section__error">
                        <div class="metadata-error-info">
                            <span class="metadata-error-class metadata-error-class--${failureClass || 'transient'}">${failureClass || 'unknown'}</span>
                            <span class="metadata-error-text">${escapeHtml(error || 'Unknown error')}</span>
                        </div>
                        <div class="metadata-error-meta">
                            Attempt ${attemptCount}/3
                            ${nextRetry ? ` · Next retry: ${formatDateTime(nextRetry)}` : ' · No more retries'}
                        </div>
                    </div>
                ` : ''}

                ${status === 'generating' ? `
                    <div class="metadata-section__generating">
                        <div class="spinner-small"></div>
                        <span>Generating metadata...</span>
                    </div>
                ` : ''}

                ${(status === 'ready' || status === 'edited') && fields ? `
                    <div class="metadata-section__fields" id="metadata-fields">
                        ${fieldConfig.map(fc => {
                            const value = fields[fc.key];
                            if (fc.type === 'array') {
                                const arr = Array.isArray(value) ? value : [];
                                return `
                                    <div class="metadata-field">
                                        <label class="metadata-field__label">${fc.label}</label>
                                        <input type="text" 
                                            class="metadata-field__input" 
                                            data-field="${fc.key}" 
                                            data-type="array"
                                            value="${escapeHtml(arr.join(', '))}"
                                            placeholder="${fc.placeholder || ''}"
                                            ${fc.maxLength ? `maxlength="${fc.maxLength}"` : ''}>
                                        ${fc.hint ? `<span class="metadata-field__hint">${fc.hint}</span>` : ''}
                                    </div>
                                `;
                            }
                            return `
                                <div class="metadata-field">
                                    <label class="metadata-field__label">${fc.label}</label>
                                    ${fc.multiline ? `
                                        <textarea 
                                            class="metadata-field__textarea" 
                                            data-field="${fc.key}" 
                                            data-type="string"
                                            rows="3"
                                            placeholder="${fc.placeholder || ''}"
                                            ${fc.maxLength ? `maxlength="${fc.maxLength}"` : ''}
                                        >${escapeHtml(String(value || ''))}</textarea>
                                    ` : `
                                        <input type="text" 
                                            class="metadata-field__input" 
                                            data-field="${fc.key}" 
                                            data-type="string"
                                            value="${escapeHtml(String(value || ''))}"
                                            placeholder="${fc.placeholder || ''}"
                                            ${fc.maxLength ? `maxlength="${fc.maxLength}"` : ''}>
                                    `}
                                    ${fc.hint ? `<span class="metadata-field__hint">${fc.hint}</span>` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>

                    <div class="metadata-section__timestamps">
                        ${generatedAt ? `<span>Generated: ${generatedAt}</span>` : ''}
                        ${editedAt ? `<span>Edited: ${editedAt}</span>` : ''}
                    </div>
                ` : ''}

                ${status === 'none' || status === 'not_started' ? `
                    <div class="metadata-section__empty">
                        <p>No AI metadata generated yet.</p>
                    </div>
                ` : ''}

                <div class="metadata-section__actions">
                    ${(status === 'ready' || status === 'edited') ? `
                        <button class="btn btn--sm btn--primary" id="metadata-save-btn" disabled>
                            Save Changes
                        </button>
                    ` : ''}
                    
                    ${(status === 'failed' || status === 'none' || status === 'not_started') ? `
                        <button class="btn btn--sm btn--primary" id="metadata-generate-btn">
                            ${status === 'failed' ? 'Retry Generation' : 'Generate Metadata'}
                        </button>
                    ` : ''}

                    ${(status === 'ready' || status === 'edited') ? `
                        <button class="btn btn--sm btn--outline" id="metadata-regenerate-btn">
                            Regenerate
                        </button>
                    ` : ''}
                </div>

                <!-- Version History (loaded async) -->
                <div id="metadata-version-history" class="metadata-version-history" style="display: none;">
                    <div class="metadata-version-history__header" id="version-history-toggle">
                        <span class="metadata-version-history__title">Version History</span>
                        <span class="metadata-version-history__chevron">&#9660;</span>
                    </div>
                    <div class="metadata-version-history__body" id="version-history-body" style="display: none;">
                        <div class="metadata-version-history__loading">Loading versions...</div>
                    </div>
                </div>

                <div class="metadata-section__feedback" id="metadata-feedback" style="display: none;"></div>
            </div>
        `;
    }

    /**
     * Get field configuration for a platform's metadata editor
     * @param {string} platformId
     * @returns {Array} Field configs
     */
    function getMetadataFieldConfig(platformId) {
        const configs = {
            youtube_shorts: [
                { key: 'title', label: 'Title', type: 'string', maxLength: 100, hint: 'Max 100 chars. Hook in first 3 words.' },
                { key: 'description', label: 'Description', type: 'string', multiline: true, maxLength: 5000, hint: 'Tease the story. End with a CTA.' },
                { key: 'tags', label: 'Tags', type: 'array', hint: 'Comma-separated. 8-15 tags recommended.' },
            ],
            tiktok: [
                { key: 'caption', label: 'Caption', type: 'string', maxLength: 2200, hint: 'Max 150 chars ideal. Short punchy hook.' },
                { key: 'hashtags', label: 'Hashtags', type: 'array', hint: 'Comma-separated. 5-8 recommended.' },
                { key: 'cover_text', label: 'Cover Text', type: 'string', maxLength: 40, hint: 'Max 40 chars. Attention-grabbing overlay text.' },
            ],
            instagram_reels: [
                { key: 'caption', label: 'Caption', type: 'string', multiline: true, maxLength: 2200, hint: 'Story-style with line breaks.' },
                { key: 'hashtags', label: 'Hashtags', type: 'array', hint: 'Comma-separated. 10-15 recommended.' },
                { key: 'alt_text', label: 'Alt Text', type: 'string', maxLength: 125, hint: 'Accessibility description. Max 125 chars.' },
            ],
        };
        // Default to youtube if unknown
        return configs[platformId] || configs.youtube_shorts;
    }

    /**
     * Get human-readable label for metadata status
     * @param {string} status
     * @returns {string}
     */
    function getMetadataStatusLabel(status) {
        const labels = {
            ready: 'AI Ready',
            edited: 'Edited',
            generating: 'Generating...',
            failed: 'Failed',
            not_started: 'Not Started',
            none: 'No Metadata'
        };
        return labels[status] || status;
    }

    /**
     * Attach event handlers for metadata section
     * @param {Object} post - Calendar item
     */
    function attachMetadataHandlers(post) {
        // Track field changes for save button
        const fieldsContainer = document.getElementById('metadata-fields');
        const saveBtn = document.getElementById('metadata-save-btn');
        const generateBtn = document.getElementById('metadata-generate-btn');
        const regenerateBtn = document.getElementById('metadata-regenerate-btn');
        const feedback = document.getElementById('metadata-feedback');

        if (fieldsContainer && saveBtn) {
            // Enable save button on any field change
            fieldsContainer.addEventListener('input', () => {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Changes';
            });

            // Save handler
            saveBtn.addEventListener('click', async () => {
                saveBtn.disabled = true;
                saveBtn.textContent = 'Saving...';
                showMetadataFeedback('Saving...', 'info');

                try {
                    const fields = collectMetadataFields();
                    await postQueueService.updatePostMetadata(
                        post.id, 
                        post.platformId, 
                        fields
                    );
                    showMetadataFeedback('Metadata saved successfully', 'success');
                    saveBtn.textContent = 'Saved';
                    
                    // Update local post metadata cache
                    if (post.metadata) {
                        post.metadata.finalMetadata = fields;
                        post.metadata.status = 'edited';
                    }

                    // Record edit version (non-blocking)
                    if (typeof metadataVersionService !== 'undefined') {
                        metadataVersionService.recordEditVersion(post.id, post.platformId, fields)
                            .then(() => loadVersionHistory(post))
                            .catch(err => console.warn('Version recording failed:', err));
                    }
                } catch (err) {
                    showMetadataFeedback(`Save failed: ${err.message}`, 'error');
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save Changes';
                }
            });
        }

        // Generate / Retry handler
        if (generateBtn) {
            generateBtn.addEventListener('click', async () => {
                generateBtn.disabled = true;
                generateBtn.textContent = 'Generating...';
                showMetadataFeedback('Triggering metadata generation...', 'info');

                try {
                    const result = await postQueueService.regenerateMetadata(
                        post.id, 
                        post.platformId, 
                        false
                    );
                    if (result?.success) {
                        showMetadataFeedback('Metadata generated! Refreshing...', 'success');
                        // Reload the modal with fresh data
                        setTimeout(() => refreshPostModal(post), 1000);
                    } else {
                        showMetadataFeedback(`Generation failed: ${result?.results?.[0]?.error || 'Unknown'}`, 'error');
                        generateBtn.disabled = false;
                        generateBtn.textContent = 'Retry Generation';
                    }
                } catch (err) {
                    showMetadataFeedback(`Generation failed: ${err.message}`, 'error');
                    generateBtn.disabled = false;
                    generateBtn.textContent = 'Retry Generation';
                }
            });
        }

        // Regenerate handler (force)
        if (regenerateBtn) {
            regenerateBtn.addEventListener('click', async () => {
                if (!confirm('Regenerate will overwrite current metadata. Continue?')) return;
                
                regenerateBtn.disabled = true;
                regenerateBtn.textContent = 'Regenerating...';
                showMetadataFeedback('Regenerating metadata...', 'info');

                try {
                    const result = await postQueueService.regenerateMetadata(
                        post.id, 
                        post.platformId, 
                        true // force
                    );
                    if (result?.success) {
                        showMetadataFeedback('Metadata regenerated! Refreshing...', 'success');
                        setTimeout(() => refreshPostModal(post), 1000);
                    } else {
                        showMetadataFeedback(`Regeneration failed: ${result?.results?.[0]?.error || 'Unknown'}`, 'error');
                        regenerateBtn.disabled = false;
                        regenerateBtn.textContent = 'Regenerate';
                    }
                } catch (err) {
                    showMetadataFeedback(`Regeneration failed: ${err.message}`, 'error');
                    regenerateBtn.disabled = false;
                    regenerateBtn.textContent = 'Regenerate';
                }
            });
        }

        // Load version history (async, non-blocking)
        loadVersionHistory(post);

        // Version history toggle
        const vhToggle = document.getElementById('version-history-toggle');
        if (vhToggle) {
            vhToggle.addEventListener('click', () => {
                const body = document.getElementById('version-history-body');
                const chevron = vhToggle.querySelector('.metadata-version-history__chevron');
                if (body) {
                    const isHidden = body.style.display === 'none';
                    body.style.display = isHidden ? 'block' : 'none';
                    if (chevron) chevron.textContent = isHidden ? '\u25B2' : '\u25BC';
                }
            });
        }
    }

    /**
     * Load and render version history for a post
     * @param {Object} post
     */
    async function loadVersionHistory(post) {
        if (typeof metadataVersionService === 'undefined') return;

        const container = document.getElementById('metadata-version-history');
        const body = document.getElementById('version-history-body');
        if (!container || !body) return;

        try {
            const versions = await metadataVersionService.getVersions(post.id, post.platformId);
            if (!versions || versions.length === 0) {
                container.style.display = 'none';
                return;
            }

            container.style.display = 'block';
            body.innerHTML = versions.map(v => {
                const typeInfo = metadataVersionService.formatVersionType(v.version_type);
                const perfInfo = metadataVersionService.formatPerformance(v.performance_value);
                const date = v.created_at ? new Date(v.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                }) : '';

                return `
                    <div class="version-entry" data-version-id="${v.id}">
                        <div class="version-entry__header">
                            <span class="version-badge ${typeInfo.cssClass}">v${v.version_number} · ${typeInfo.label}</span>
                            ${v.variant_key ? `<span class="version-variant-badge">🧪 ${escapeHtml(v.variant_key)}</span>` : ''}
                            <span class="version-perf ${perfInfo.cssClass}">${perfInfo.text}</span>
                            <span class="version-date">${date}</span>
                        </div>
                        <div class="version-entry__detail" style="display: none;">
                            <pre class="version-fields-json">${escapeHtml(JSON.stringify(v.fields, null, 2))}</pre>
                        </div>
                    </div>
                `;
            }).join('');

            // Click-to-expand each version entry
            body.querySelectorAll('.version-entry').forEach(entry => {
                entry.querySelector('.version-entry__header')?.addEventListener('click', () => {
                    const detail = entry.querySelector('.version-entry__detail');
                    if (detail) {
                        detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
                    }
                });
            });
        } catch (err) {
            console.warn('Failed to load version history:', err);
            container.style.display = 'none';
        }
    }

    /**
     * Collect current field values from the metadata editor
     * @returns {Object} Field values
     */
    function collectMetadataFields() {
        const fields = {};
        const inputs = document.querySelectorAll('#metadata-fields [data-field]');
        inputs.forEach(input => {
            const key = input.dataset.field;
            const type = input.dataset.type;
            const value = input.tagName === 'TEXTAREA' ? input.value : input.value;
            
            if (type === 'array') {
                fields[key] = value.split(',').map(s => s.trim()).filter(Boolean);
            } else {
                fields[key] = value;
            }
        });
        return fields;
    }

    /**
     * Show feedback message in the metadata section
     * @param {string} message
     * @param {'info'|'success'|'error'} type
     */
    function showMetadataFeedback(message, type) {
        const feedback = document.getElementById('metadata-feedback');
        if (!feedback) return;
        feedback.textContent = message;
        feedback.className = `metadata-section__feedback metadata-section__feedback--${type}`;
        feedback.style.display = 'block';
        if (type === 'success') {
            setTimeout(() => { feedback.style.display = 'none'; }, 3000);
        }
    }

    /**
     * Refresh the post modal with fresh data
     * @param {Object} post - Calendar item
     */
    async function refreshPostModal(post) {
        // Re-fetch metadata
        if (typeof postQueueService !== 'undefined') {
            try {
                // If this is a consolidated item, refresh the active platform post
                const targetPost = post.isConsolidated ? post.platforms.find(p => p.platformId === post.platformId) || post : post;
                const freshMeta = await postQueueService.getPostMetadata(targetPost.id, targetPost.platformId);
                if (freshMeta) {
                    targetPost.metadata = {
                        status: freshMeta.status,
                        aiMetadata: freshMeta.ai_metadata,
                        finalMetadata: freshMeta.final_metadata,
                        error: freshMeta.error,
                        attemptCount: freshMeta.attempt_count,
                        failureClass: freshMeta.failure_class,
                        nextRetryAt: freshMeta.next_retry_at,
                        generatedAt: freshMeta.generated_at,
                        editedAt: freshMeta.edited_at,
                        platform: freshMeta.platform
                    };
                }
            } catch (e) {
                console.warn('Failed to refresh metadata:', e);
            }
        }
        showPostModal(post, post.platformId);
    }

    /**
     * Show day detail modal with all posts for a date
     * @param {Date} date - The date
     * @param {Array} posts - Posts for that date
     */
    function showDayDetailModal(date, posts) {
        if (!elements.postModal || !elements.postModalBody) return;

        const dateStr = date.toLocaleDateString('en-US', { 
            weekday: 'long',
            month: 'long', 
            day: 'numeric',
            year: 'numeric'
        });

        // Consolidate posts by sourceJobId for the day overview
        const consolidated = calendar ? calendar.consolidateByJob(posts) : posts;

        elements.postModalBody.innerHTML = `
            <div class="day-detail">
                <h4 class="day-detail__date">${dateStr}</h4>
                <p class="day-detail__count">${posts.length} post${posts.length !== 1 ? 's' : ''}${consolidated.length < posts.length ? ` (${consolidated.length} video${consolidated.length !== 1 ? 's' : ''})` : ''}</p>
                
                <div class="day-detail__posts">
                    ${consolidated.map(post => {
                        // Brand indicator
                        const postBrandInfo = calendar ? calendar.getBrandInfo(post.brandId) : null;
                        const brandChip = postBrandInfo && !activeBrandFilter
                            ? `<span class="day-detail__brand-chip" style="--chip-color: ${postBrandInfo.color}">
                                <span class="calendar__brand-dot" style="background: ${postBrandInfo.color}"></span>
                                ${escapeHtml(postBrandInfo.name)}
                               </span>`
                            : '';
                        // Platform chips for consolidated or single badge
                        const platformHtml = post.isConsolidated
                            ? `<div class="day-detail__platforms">
                                ${post.platformIds.map(pid => {
                                    const pColor = calendar ? calendar.getPlatformColor(pid) : '#666';
                                    const pName = getPlatformDisplayName(pid);
                                    const platformPost = post.platforms.find(p => p.platformId === pid);
                                    const pStatus = platformPost?.status || '';
                                    return `<span class="day-detail__platform-chip" style="--chip-color: ${pColor}" title="${pName}: ${pStatus}">${getPlatformShortLabel(pid)}</span>`;
                                }).join('')}
                               </div>`
                            : `<span class="day-detail__post-platform">
                                ${getPlatformDisplayName(post.platformId)}
                               </span>`;

                        return `
                            <div class="day-detail__post ${post.isConsolidated ? 'day-detail__post--consolidated' : ''}" data-post-id="${post.id}">
                                <div class="day-detail__post-time">
                                    ${formatTime(post.scheduledAt)}
                                </div>
                                <div class="day-detail__post-info">
                                    ${brandChip}
                                    <span class="day-detail__post-title">
                                        ${escapeHtml(post.content?.title || 'Untitled')}
                                    </span>
                                    ${platformHtml}
                                </div>
                                <span class="badge badge--${getStatusClass(post.status)} badge--sm">
                                    ${post.status}
                                </span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        // Add click handlers for individual posts → open post modal with tabs
        elements.postModalBody.querySelectorAll('[data-post-id]').forEach(el => {
            el.addEventListener('click', () => {
                const postId = el.dataset.postId;
                const item = consolidated.find(p => p.id === postId);
                if (item) {
                    selectedPost = item;
                    showPostModal(item);
                }
            });
        });

        // Update modal title
        const modalTitle = elements.postModal.querySelector('.modal__title');
        if (modalTitle) {
            modalTitle.textContent = 'Day Overview';
        }

        // Show modal
        elements.postModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Get short label for platform chip
     * @param {string} platformId
     * @returns {string}
     */
    function getPlatformShortLabel(platformId) {
        const labels = {
            youtube_shorts: 'YT',
            tiktok: 'TT',
            instagram_reels: 'IG',
            facebook_reels: 'FB',
            youtube: 'YT',
            instagram: 'IG',
            facebook: 'FB',
            twitter: 'X',
            threads: 'TH'
        };
        return labels[platformId] || platformId?.substring(0, 2)?.toUpperCase() || '??';
    }

    /**
     * Close the modal
     */
    function closeModal() {
        if (elements.postModal) {
            elements.postModal.classList.remove('active');
            document.body.style.overflow = '';
        }
        selectedPost = null;

        // Reset modal title
        const modalTitle = elements.postModal?.querySelector('.modal__title');
        if (modalTitle) {
            modalTitle.textContent = 'Post Details';
        }
    }

    // ==================== Utility Functions ====================

    /**
     * Get CSS class for post status
     * @param {string} status - Post status
     * @returns {string} CSS class suffix
     */
    function getStatusClass(status) {
        const classes = {
            published: 'success',
            posted: 'success',
            complete: 'success',
            scheduled: 'warning',
            failed: 'error',
            draft: 'default',
            queued: 'info',
            publishing: 'info',
            posting: 'info',
            pending: 'default',
            generating: 'info',
            approved: 'warning',
            cancelled: 'default'
        };
        return classes[status] || 'default';
    }

    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Format date and time
     * @param {Date|string} date - Date to format
     * @returns {string} Formatted date string
     */
    function formatDateTime(date) {
        if (!date) return 'Not set';
        const d = new Date(date);
        return d.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    /**
     * Format time only
     * @param {Date|string} date - Date to format
     * @returns {string} Formatted time string
     */
    function formatTime(date) {
        if (!date) return '';
        const d = new Date(date);
        return d.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    /**
     * Format duration in seconds to readable string
     * @param {number} seconds - Duration in seconds
     * @returns {string} Formatted duration
     */
    function formatDuration(seconds) {
        if (!seconds) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Export for testing/debugging
    window.CalendarPage = {
        init,
        getCalendar: () => calendar,
        getSelectedPost: () => selectedPost,
        
        /**
         * Create demo posts for testing
         * @param {number} count - Number of posts to create
         */
        createDemoPosts: (count = 10) => {
            if (typeof postManager === 'undefined' || typeof Post === 'undefined') {
                console.error('postManager or Post not available');
                return;
            }

            const platforms = ['instagram', 'tiktok', 'youtube', 'facebook', 'twitter'];
            const statuses = ['scheduled', 'published', 'failed', 'draft'];
            const titles = [
                'Top 10 Travel Destinations',
                'Morning Routine Tips',
                'Fitness Motivation',
                'Cooking Made Easy',
                'Tech Review 2025',
                'Life Hacks You Need',
                'Budget Travel Guide',
                'Productivity Secrets',
                'Home Workout',
                'Digital Marketing Tips'
            ];

            const now = new Date();
            const activeBrand = typeof brandManager !== 'undefined' 
                ? brandManager.getActiveBrand() 
                : null;

            for (let i = 0; i < count; i++) {
                // Random date within -7 to +14 days
                const daysOffset = Math.floor(Math.random() * 21) - 7;
                const hoursOffset = Math.floor(Math.random() * 12) + 8; // 8am to 8pm
                const scheduledAt = new Date(now);
                scheduledAt.setDate(scheduledAt.getDate() + daysOffset);
                scheduledAt.setHours(hoursOffset, Math.floor(Math.random() * 60), 0, 0);

                const status = daysOffset < 0 
                    ? (Math.random() > 0.2 ? 'published' : 'failed')
                    : (Math.random() > 0.3 ? 'scheduled' : 'draft');

                const post = postManager.create({
                    brandId: activeBrand?.id || 'demo-brand',
                    platformId: platforms[Math.floor(Math.random() * platforms.length)],
                    status: status,
                    scheduledAt: scheduledAt,
                    publishedAt: status === 'published' ? scheduledAt : null,
                    content: {
                        title: titles[Math.floor(Math.random() * titles.length)],
                        caption: 'This is a demo post caption with some #hashtags #content #demo',
                        duration: 30 + Math.floor(Math.random() * 30),
                        aspectRatio: '9:16'
                    }
                });

                console.log(`Created demo post: ${post.content.title}`);
            }

            // Re-render calendar
            if (calendar) {
                calendar.render();
            }

            console.log(`✅ Created ${count} demo posts`);
        },

        /**
         * Clear all demo/test posts
         */
        clearDemoPosts: () => {
            if (typeof postManager === 'undefined') {
                console.error('postManager not available');
                return;
            }

            const posts = postManager.getAll();
            let cleared = 0;
            posts.forEach(post => {
                postManager.delete(post.id);
                cleared++;
            });

            // Re-render calendar
            if (calendar) {
                calendar.render();
            }

            console.log(`✅ Cleared ${cleared} posts`);
        }
    };

})();
