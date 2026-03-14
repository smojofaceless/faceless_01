// =====================================================
// CALENDAR PAGE - Init & Bootstrap
// Page initialization, calendar setup, and demo utilities
// =====================================================

/**
 * Initialize the calendar page
 */
function calendarInit() {
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
        let calStarted = false;
        window.addEventListener('contentengine:ready', () => {
            if (!calStarted) {
                calStarted = true;
                initCalendar();
            }
        });
        // Fallback: if contentEngine never fires, init anyway after 5s
        setTimeout(() => {
            if (!calStarted) {
                console.warn('ContentEngine timeout — starting calendar anyway');
                calStarted = true;
                initCalendar();
            }
        }, 5000);
    }
}

/**
 * Initialize the calendar component (async)
 */
async function initCalendar() {
    try {
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

        // Create calendar instance
        calendarInstance = new Calendar({
            container: calElements.calendarContainer,
            view: currentView,
            onDateClick: handleDateClick,
            onPostClick: handlePostClick,
            onSlotClick: handleSlotClick,
            onNavigate: handleNavigate
        });

        // Set the brand map so calendar can show brand indicators
        calendarInstance.setBrandMap(buildBrandMap());

        // Initialize calendar (async — loads data from Supabase)
        await calendarInstance.init();

        // Enrich posted items with metrics badges
        await enrichCalendarMetrics();

        // Set up page controls
        setupToolbar();
        setupFilters();
        setupBestTimes();
        setupModal();

        // Update title initially
        updateCalendarTitle();
    } catch (err) {
        console.error('❌ Calendar init failed:', err);
        // Remove loading spinner so the user sees the error
        if (calElements.calendarContainer) {
            calElements.calendarContainer.innerHTML = `
                <div style="padding:2rem;text-align:center;color:#ef4444;">
                    <p>Failed to load calendar</p>
                    <p style="font-size:0.85rem;color:#888;margin-top:0.5rem;">${err.message || err}</p>
                    <button onclick="location.reload()" style="margin-top:1rem;padding:0.5rem 1rem;background:#ef4444;color:#fff;border:none;border-radius:0.5rem;cursor:pointer;">Retry</button>
                </div>`;
        }
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', calendarInit);
} else {
    calendarInit();
}

// Export for testing/debugging
window.CalendarPage = {
    init: calendarInit,
    getCalendar: () => calendarInstance,
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
            const daysOffset = Math.floor(Math.random() * 21) - 7;
            const hoursOffset = Math.floor(Math.random() * 12) + 8;
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

        if (calendarInstance) {
            calendarInstance.render();
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

        if (calendarInstance) {
            calendarInstance.render();
        }

        console.log(`✅ Cleared ${cleared} posts`);
    }
};
