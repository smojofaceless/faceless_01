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
        createPostBtn: null
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
    }

    /**
     * Initialize the calendar component
     */
    async function initCalendar() {
        console.log('📅 Creating Calendar instance');

        // Create calendar instance
        calendar = new Calendar({
            container: elements.calendarContainer,
            view: currentView,
            onDateClick: handleDateClick,
            onPostClick: handlePostClick,
            onSlotClick: handleSlotClick,
            onNavigate: handleNavigate
        });

        // Initialize calendar (async — loads data from Supabase)
        await calendar.init();

        // Set up page controls
        setupToolbar();
        setupFilters();
        setupModal();

        // Update title initially
        updateCalendarTitle();

        console.log('✅ Calendar initialized');
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
     * Handle brand change from brand switcher
     * @param {Object} brand - Selected brand
     */
    async function handleBrandChange(brand) {
        if (calendar) {
            await calendar.setFilters({ brandId: brand?.id || null });
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
     * Show post detail modal
     * @param {Object} post - Post to display (unified calendar item)
     */
    function showPostModal(post) {
        if (!elements.postModal || !elements.postModalBody) return;

        // Get platform info
        const platform = typeof getPlatform === 'function' 
            ? getPlatform(post.platformId) 
            : { name: post.platformId };

        const isJob = post.type === 'job';
        const isJobComplete = isJob && (post.status === 'scheduled' || post.raw?.status === 'complete');
        const statusLabel = isJob 
            ? (post.status === 'pending' ? 'Pending Generation' 
               : isJobComplete ? 'Complete' 
               : post.status === 'failed' ? 'Failed' 
               : 'Generating...') 
            : post.status;

        // Build modal content
        elements.postModalBody.innerHTML = `
            <div class="post-detail">
                <div class="post-detail__header">
                    ${isJob ? `
                        <span class="badge badge--info" style="font-size: 11px;">
                            &#9881; Job
                        </span>
                    ` : ''}
                    <span class="platform-badge platform-badge--${post.platformId}">
                        ${platform?.name || post.platformId}
                    </span>
                    <span class="badge badge--${getStatusClass(post.status)}">
                        ${statusLabel}
                    </span>
                </div>
                
                <h4 class="post-detail__title">
                    ${escapeHtml(post.content?.title || 'Untitled')}
                </h4>
                
                ${post.content?.description ? `
                    <p class="post-detail__desc">
                        ${escapeHtml(post.content.description)}
                    </p>
                ` : ''}
                
                ${post.content?.caption ? `
                    <div class="post-detail__caption">
                        <strong>Caption:</strong>
                        <p>${escapeHtml(post.content.caption)}</p>
                    </div>
                ` : ''}
                
                <div class="post-detail__meta">
                    <div class="meta-item">
                        <strong>Scheduled:</strong>
                        <span>${formatDateTime(post.scheduledAt)}</span>
                    </div>
                    
                    ${post.publishedAt ? `
                        <div class="meta-item">
                            <strong>Published:</strong>
                            <span>${formatDateTime(post.publishedAt)}</span>
                        </div>
                    ` : ''}
                    
                    ${post.content?.duration ? `
                        <div class="meta-item">
                            <strong>Duration:</strong>
                            <span>${formatDuration(post.content.duration)}</span>
                        </div>
                    ` : ''}

                    ${post.batchId ? `
                        <div class="meta-item">
                            <strong>Campaign:</strong>
                            <span style="font-family: monospace; font-size: 11px;">${post.batchId.substring(0, 8)}...</span>
                        </div>
                    ` : ''}
                    
                    ${post.lastError ? `
                        <div class="meta-item meta-item--error">
                            <strong>Error:</strong>
                            <span>${escapeHtml(post.lastError)}</span>
                        </div>
                    ` : ''}
                </div>
                
                ${post.content?.videoUrl ? `
                    <div class="post-detail__preview">
                        <video 
                            src="${post.content.videoUrl}" 
                            poster="${post.content.thumbnailUrl || ''}"
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
            </div>
        `;

        // Show modal
        elements.postModal.classList.add('active');
        document.body.style.overflow = 'hidden';
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

        elements.postModalBody.innerHTML = `
            <div class="day-detail">
                <h4 class="day-detail__date">${dateStr}</h4>
                <p class="day-detail__count">${posts.length} post${posts.length !== 1 ? 's' : ''}</p>
                
                <div class="day-detail__posts">
                    ${posts.map(post => {
                        const platform = typeof getPlatform === 'function' 
                            ? getPlatform(post.platformId) 
                            : { name: post.platformId };
                        
                        return `
                            <div class="day-detail__post" data-post-id="${post.id}">
                                <div class="day-detail__post-time">
                                    ${formatTime(post.scheduledAt)}
                                </div>
                                <div class="day-detail__post-info">
                                    <span class="day-detail__post-title">
                                        ${escapeHtml(post.content?.title || 'Untitled')}
                                    </span>
                                    <span class="day-detail__post-platform">
                                        ${platform?.name || post.platformId}
                                    </span>
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

        // Add click handlers for individual posts
        elements.postModalBody.querySelectorAll('[data-post-id]').forEach(el => {
            el.addEventListener('click', () => {
                const postId = el.dataset.postId;
                const post = posts.find(p => p.id === postId);
                if (post) {
                    showPostModal(post);
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
