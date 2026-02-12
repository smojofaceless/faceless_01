// =====================================================
// CALENDAR COMPONENT
// Month/week views with post indicators
// =====================================================

class Calendar {
    constructor(options = {}) {
        // Support both container element and selector
        this.container = options.container || null;
        this.selector = options.selector || '#calendar-container';
        this.view = options.view || 'month'; // 'month' or 'week'
        this.currentDate = new Date();
        this.selectedDate = null;
        this.filters = {
            brandId: null,
            platformId: null,
            status: null
        };
        
        // Callbacks
        this.onDateClick = options.onDateClick || null;
        this.onDateSelect = options.onDateSelect || null;
        this.onPostClick = options.onPostClick || null;
        this.onSlotClick = options.onSlotClick || null;
        this.onNavigate = options.onNavigate || null;
        
        // State
        this.isLoading = false;
        this.posts = [];
        this._cachedItems = []; // Cached calendar items from Supabase
        this._useSupabase = false;
    }

    /**
     * Initialize the calendar
     */
    async init() {
        // Use provided container or find by selector
        if (!this.container) {
            this.container = document.querySelector(this.selector);
        }
        
        if (!this.container) {
            console.warn('Calendar container not found:', this.selector);
            return;
        }

        // Detect if postQueueService is available (Supabase-backed)
        this._useSupabase = typeof postQueueService !== 'undefined';
        if (this._useSupabase) {
            await postQueueService.init();
            console.log('📅 Calendar: Using Supabase via PostQueueService');
        }

        await this.render();
        return this; // Allow chaining
    }

    /**
     * Set filters
     * @param {Object} filters - Filters to apply
     */
    async setFilters(filters) {
        this.filters = { ...this.filters, ...filters };
        await this.render();
    }

    /**
     * Get current filters
     * @returns {Object} Current filter state
     */
    getFilters() {
        return { ...this.filters };
    }

    /**
     * Navigate to previous period
     */
    async prev() {
        if (this.view === 'month') {
            this.currentDate.setMonth(this.currentDate.getMonth() - 1);
        } else {
            this.currentDate.setDate(this.currentDate.getDate() - 7);
        }
        await this.render();
        this.notifyNavigation();
    }

    /**
     * Navigate to next period
     */
    async next() {
        if (this.view === 'month') {
            this.currentDate.setMonth(this.currentDate.getMonth() + 1);
        } else {
            this.currentDate.setDate(this.currentDate.getDate() + 7);
        }
        await this.render();
        this.notifyNavigation();
    }

    /**
     * Go to today
     */
    async today() {
        this.currentDate = new Date();
        await this.render();
        this.notifyNavigation();
    }

    /**
     * Go to specific date
     * @param {Date} date - Date to navigate to
     */
    async goToDate(date) {
        this.currentDate = new Date(date);
        await this.render();
        this.notifyNavigation();
    }

    /**
     * Notify navigation callback
     */
    notifyNavigation() {
        if (this.onNavigate) {
            this.onNavigate({
                view: this.view,
                date: new Date(this.currentDate),
                title: this.getCurrentTitle()
            });
        }
    }

    /**
     * Switch view mode
     * @param {string} view - 'month' or 'week'
     */
    async setView(view) {
        if (this.view !== view) {
            this.view = view;
            await this.render();
            this.notifyNavigation();
        }
    }

    /**
     * Get current view mode
     * @returns {string} 'month' or 'week'
     */
    getView() {
        return this.view;
    }

    /**
     * Get current title string
     * @returns {string} Formatted title
     */
    getCurrentTitle() {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
        
        if (this.view === 'month') {
            return `${monthNames[this.currentDate.getMonth()]} ${this.currentDate.getFullYear()}`;
        } else {
            return this.getWeekRangeString();
        }
    }

    /**
     * Render the calendar
     */
    async render() {
        if (!this.container) return;

        // Show loading state while fetching data
        if (this._useSupabase) {
            this.isLoading = true;
            this.container.innerHTML = `
                <div class="calendar calendar--loading">
                    <div class="calendar__loading">
                        <div class="spinner"></div>
                        <span>Loading calendar...</span>
                    </div>
                </div>
            `;

            // Calculate the date range we need
            const { start, end } = this._getViewDateRange();
            
            try {
                this._cachedItems = await postQueueService.getCalendarItems(start, end, {
                    brandId: this.filters.brandId,
                    status: this.filters.status,
                    platformId: this.filters.platformId
                });
                console.log(`📅 Calendar: Loaded ${this._cachedItems.length} items for ${start.toLocaleDateString()} - ${end.toLocaleDateString()}`);
            } catch (e) {
                console.error('Failed to load calendar data:', e);
                this._cachedItems = [];
            }
            this.isLoading = false;
        }

        // Render appropriate view (no header - controlled by page)
        const body = this.view === 'month' ? this.renderMonth() : this.renderWeek();

        this.container.innerHTML = `
            <div class="calendar calendar--${this.view}">
                ${body}
            </div>
        `;

        this.setupEventListeners();
        
        // Notify navigation after render
        this.notifyNavigation();
    }

    /**
     * Get the date range for the current view
     * @returns {{ start: Date, end: Date }}
     */
    _getViewDateRange() {
        if (this.view === 'month') {
            const firstDay = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
            const start = new Date(firstDay);
            start.setDate(start.getDate() - firstDay.getDay());
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setDate(end.getDate() + 42);
            end.setHours(23, 59, 59, 999);
            return { start, end };
        } else {
            const start = this.getWeekStart(this.currentDate);
            const end = new Date(start);
            end.setDate(end.getDate() + 7);
            end.setHours(23, 59, 59, 999);
            return { start, end };
        }
    }

    /**
     * Render month view
     */
    renderMonth() {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const firstDay = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
        const lastDay = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 0);
        const startDate = new Date(firstDay);
        startDate.setDate(startDate.getDate() - firstDay.getDay());

        // Get posts for this month (include padding days)
        const monthStart = new Date(startDate);
        const monthEnd = new Date(startDate);
        monthEnd.setDate(monthEnd.getDate() + 42); // 6 weeks
        monthEnd.setHours(23, 59, 59, 999);
        
        const posts = this.getFilteredPosts(monthStart, monthEnd);
        const postsByDate = this.groupPostsByDate(posts);

        let html = `
            <div class="calendar__grid calendar__grid--month">
                <div class="calendar__day-names">
                    ${dayNames.map(day => `<div class="calendar__day-name">${day}</div>`).join('')}
                </div>
                <div class="calendar__days">
        `;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let currentDate = new Date(startDate);
        for (let i = 0; i < 42; i++) { // 6 weeks max
            const dateKey = this.getDateKey(currentDate);
            const dayPosts = postsByDate[dateKey] || [];
            const isCurrentMonth = currentDate.getMonth() === this.currentDate.getMonth();
            const isToday = currentDate.getTime() === today.getTime();
            const isPast = currentDate < today;

            html += `
                <div class="calendar__day ${!isCurrentMonth ? 'calendar__day--other-month' : ''} 
                            ${isToday ? 'calendar__day--today' : ''} 
                            ${isPast ? 'calendar__day--past' : ''}"
                     data-date="${dateKey}">
                    <span class="calendar__day-number">${currentDate.getDate()}</span>
                    ${dayPosts.length > 0 ? `
                        <div class="calendar__day-posts">
                            ${dayPosts.slice(0, 3).map(post => `
                                <div class="calendar__post calendar__post--${post.status}" 
                                     data-post-id="${post.id}"
                                     style="--platform-color: ${this.getPlatformColor(post.platformId)}"
                                     title="${this.escapeHtml(post.content?.title || 'Untitled')} - ${this.formatTime(post.scheduledAt)}">
                                    <span class="calendar__post-dot"></span>
                                    <span class="calendar__post-title">${this.escapeHtml(post.content?.title || 'Untitled')}</span>
                                </div>
                            `).join('')}
                            ${dayPosts.length > 3 ? `
                                <button class="calendar__more" data-date="${dateKey}">
                                    +${dayPosts.length - 3} more
                                </button>
                            ` : ''}
                        </div>
                    ` : ''}
                </div>
            `;

            currentDate.setDate(currentDate.getDate() + 1);
        }

        html += `</div></div>`;
        return html;
    }

    /**
     * Render week view
     */
    renderWeek() {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const weekStart = this.getWeekStart(this.currentDate);
        
        // Get posts for this week
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);
        weekEnd.setHours(23, 59, 59, 999);
        
        const posts = this.getFilteredPosts(weekStart, weekEnd);
        const postsByDate = this.groupPostsByDate(posts);

        // Get scheduled slots (if scheduler is available)
        let slots = [];
        if (typeof scheduler !== 'undefined') {
            try {
                slots = scheduler.getSlotsInRange(weekStart, weekEnd, this.filters);
            } catch (e) {
                console.warn('Could not get scheduled slots:', e);
            }
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let html = `<div class="calendar__grid calendar__grid--week">`;

        let currentDate = new Date(weekStart);
        for (let i = 0; i < 7; i++) {
            const dateKey = this.getDateKey(currentDate);
            const dayPosts = postsByDate[dateKey] || [];
            const daySlots = slots.filter(s => this.getDateKey(s.time) === dateKey);
            const isToday = currentDate.getTime() === today.getTime();
            const isPast = currentDate < today;

            html += `
                <div class="calendar__week-day ${isToday ? 'calendar__week-day--today' : ''} 
                            ${isPast ? 'calendar__week-day--past' : ''}"
                     data-date="${dateKey}">
                    <div class="calendar__week-day-header">
                        <span class="calendar__week-day-name">${dayNames[currentDate.getDay()]}</span>
                        <span class="calendar__week-day-date">${currentDate.getDate()}</span>
                    </div>
                    <div class="calendar__week-day-content">
                        ${dayPosts.length > 0 ? dayPosts.map(post => `
                            <div class="calendar__post-card calendar__post-card--${post.status}" 
                                 data-post-id="${post.id}"
                                 style="--platform-color: ${this.getPlatformColor(post.platformId)}">
                                <div class="calendar__post-card-header">
                                    <span class="calendar__post-time">${this.formatTime(post.scheduledAt)}</span>
                                    <span class="calendar__post-status">${post.status}</span>
                                </div>
                                <div class="calendar__post-platform">
                                    <span class="calendar__platform-dot"></span>
                                    ${this.escapeHtml(post.platformId)}
                                </div>
                                <div class="calendar__post-title">${this.escapeHtml(post.content?.title || 'Untitled')}</div>
                            </div>
                        `).join('') : ''}
                        ${daySlots.filter(slot => !dayPosts.some(p => 
                            p.scheduledAt && p.scheduledAt.getTime() === slot.time.getTime()
                        )).map(slot => `
                            <div class="calendar__slot calendar__slot--empty" 
                                 data-slot-time="${slot.time.toISOString()}"
                                 data-date="${dateKey}">
                                <span class="calendar__slot-time">${this.formatTime(slot.time)}</span>
                                <span class="calendar__slot-label">Available slot</span>
                            </div>
                        `).join('')}
                        ${dayPosts.length === 0 && daySlots.length === 0 ? `
                            <div class="calendar__empty-day">
                                <span>No posts</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;

            currentDate.setDate(currentDate.getDate() + 1);
        }

        html += `</div>`;
        return html;
    }

    /**
     * Set up event listeners
     */
    setupEventListeners() {
        // Single delegated click handler
        this.container.addEventListener('click', (e) => {
            // Post click (both month indicators and week cards)
            const postElement = e.target.closest('[data-post-id]');
            if (postElement) {
                const postId = postElement.dataset.postId;
                const post = this.findPostById(postId);
                if (post && this.onPostClick) {
                    this.onPostClick(post);
                }
                return;
            }

            // "More" button click
            const moreBtn = e.target.closest('.calendar__more');
            if (moreBtn && moreBtn.dataset.date) {
                const parts = moreBtn.dataset.date.split('-');
                const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                this.handleMoreClick(date);
                return;
            }

            // Slot click (available time slots)
            const slot = e.target.closest('[data-slot-time]');
            if (slot && this.onSlotClick) {
                const time = new Date(slot.dataset.slotTime);
                this.onSlotClick(time);
                return;
            }

            // Day click (for creating new posts)
            const day = e.target.closest('[data-date]');
            if (day) {
                // Don't trigger day click if clicking on a post or more button
                if (!e.target.closest('[data-post-id]') && !e.target.closest('.calendar__more')) {
                    // Parse YYYY-MM-DD as local date (not UTC)
                    const parts = day.dataset.date.split('-');
                    const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                    this.selectedDate = date;
                    
                    // Support both callback names
                    if (this.onDateClick) {
                        this.onDateClick(date);
                    } else if (this.onDateSelect) {
                        this.onDateSelect(date);
                    }
                }
                return;
            }
        });
    }

    /**
     * Handle "more posts" button click
     * @param {Date} date - Date to show all posts for
     */
    handleMoreClick(date) {
        const dateKey = this.getDateKey(date);
        const posts = this.getFilteredPosts(date, new Date(date.getTime() + 86400000))
            .filter(p => this.getDateKey(p.scheduledAt) === dateKey);
        
        // If there's an onDateClick handler, use it to show the day detail
        if (this.onDateClick) {
            this.onDateClick(date, posts);
        }
    }

    /**
     * Find a post by ID from cached items or postManager  
     * @param {string} postId - Post ID to find
     * @returns {Object|null} Post object or null
     */
    findPostById(postId) {
        // Check cached Supabase items first
        if (this._useSupabase && this._cachedItems.length > 0) {
            return this._cachedItems.find(item => item.id === postId) || null;
        }
        // Fall back to postManager
        if (typeof postManager !== 'undefined') {
            return postManager.get(postId);
        }
        return null;
    }

    /**
     * Get filtered posts from cache (Supabase) or postManager (localStorage)
     * @param {Date} start - Start date
     * @param {Date} end - End date
     * @returns {Array} Filtered posts
     */
    getFilteredPosts(start, end) {
        // If using Supabase, return from pre-loaded cache
        if (this._useSupabase) {
            let items = this._cachedItems.filter(item => {
                if (!item.scheduledAt) return false;
                return item.scheduledAt >= start && item.scheduledAt <= end;
            });

            // Apply status filter if set (already applied at query time, but double-check)
            if (this.filters.status) {
                items = items.filter(item => item.status === this.filters.status);
            }

            return items;
        }

        // Legacy: localStorage via postManager
        if (typeof postManager === 'undefined') {
            console.warn('postManager not available');
            return [];
        }

        try {
            let posts = postManager.getScheduledInRange(start, end, {
                brandId: this.filters.brandId,
                platformId: this.filters.platformId
            });

            if (this.filters.status) {
                posts = posts.filter(p => p.status === this.filters.status);
            }

            return posts;
        } catch (e) {
            console.warn('Error getting posts:', e);
            return [];
        }
    }

    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==================== Helper Methods ====================

    getDateKey(date) {
        // Use LOCAL date components to avoid UTC offset shifting days
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        d.setDate(d.getDate() - day);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    getWeekRangeString() {
        const start = this.getWeekStart(this.currentDate);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);

        const options = { month: 'short', day: 'numeric' };
        return `${start.toLocaleDateString(undefined, options)} - ${end.toLocaleDateString(undefined, options)}, ${end.getFullYear()}`;
    }

    groupPostsByDate(posts) {
        const grouped = {};
        posts.forEach(post => {
            if (!post.scheduledAt) return;
            const key = this.getDateKey(post.scheduledAt);
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(post);
        });
        return grouped;
    }

    formatTime(date) {
        return new Date(date).toLocaleTimeString(undefined, { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        });
    }

    getPlatformColor(platformId) {
        const colors = {
            instagram: '#E4405F',
            tiktok: '#000000',
            youtube: '#FF0000',
            facebook: '#1877F2',
            threads: '#000000',
            twitter: '#1DA1F2'
        };
        return colors[platformId] || '#666666';
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Calendar };
}
