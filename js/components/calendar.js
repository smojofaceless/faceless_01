// =====================================================
// CALENDAR COMPONENT
// Month/week views with post indicators
// =====================================================

class Calendar {
    constructor(options = {}) {
        this.container = null;
        this.selector = options.selector || '#calendar';
        this.view = options.view || 'month'; // 'month' or 'week'
        this.currentDate = new Date();
        this.selectedDate = null;
        this.filters = {
            brandId: null,
            platformId: null
        };
        this.onDateSelect = options.onDateSelect || null;
        this.onSlotClick = options.onSlotClick || null;
    }

    /**
     * Initialize the calendar
     */
    init() {
        this.container = document.querySelector(this.selector);
        if (!this.container) {
            console.warn('Calendar container not found');
            return;
        }

        this.render();
    }

    /**
     * Set filters
     * @param {Object} filters - Filters to apply
     */
    setFilters(filters) {
        this.filters = { ...this.filters, ...filters };
        this.render();
    }

    /**
     * Navigate to previous period
     */
    prev() {
        if (this.view === 'month') {
            this.currentDate.setMonth(this.currentDate.getMonth() - 1);
        } else {
            this.currentDate.setDate(this.currentDate.getDate() - 7);
        }
        this.render();
    }

    /**
     * Navigate to next period
     */
    next() {
        if (this.view === 'month') {
            this.currentDate.setMonth(this.currentDate.getMonth() + 1);
        } else {
            this.currentDate.setDate(this.currentDate.getDate() + 7);
        }
        this.render();
    }

    /**
     * Go to today
     */
    today() {
        this.currentDate = new Date();
        this.render();
    }

    /**
     * Switch view mode
     * @param {string} view - 'month' or 'week'
     */
    setView(view) {
        this.view = view;
        this.render();
    }

    /**
     * Render the calendar
     */
    render() {
        const header = this.renderHeader();
        const body = this.view === 'month' ? this.renderMonth() : this.renderWeek();

        this.container.innerHTML = `
            <div class="calendar">
                ${header}
                ${body}
            </div>
        `;

        this.setupEventListeners();
    }

    /**
     * Render calendar header
     */
    renderHeader() {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
        
        const title = this.view === 'month'
            ? `${monthNames[this.currentDate.getMonth()]} ${this.currentDate.getFullYear()}`
            : this.getWeekRangeString();

        return `
            <div class="calendar__header">
                <div class="calendar__nav">
                    <button class="calendar__nav-btn" data-action="prev" title="Previous">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M15 18l-6-6 6-6"/>
                        </svg>
                    </button>
                    <button class="calendar__nav-btn" data-action="today">Today</button>
                    <button class="calendar__nav-btn" data-action="next" title="Next">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 18l6-6-6-6"/>
                        </svg>
                    </button>
                </div>
                <h3 class="calendar__title">${title}</h3>
                <div class="calendar__view-toggle">
                    <button class="calendar__view-btn ${this.view === 'month' ? 'calendar__view-btn--active' : ''}" 
                            data-view="month">Month</button>
                    <button class="calendar__view-btn ${this.view === 'week' ? 'calendar__view-btn--active' : ''}" 
                            data-view="week">Week</button>
                </div>
            </div>
        `;
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

        // Get posts for this month
        const monthStart = new Date(firstDay);
        const monthEnd = new Date(lastDay);
        monthEnd.setHours(23, 59, 59, 999);
        const posts = postManager.getScheduledInRange(monthStart, monthEnd, this.filters);
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
                                <div class="calendar__post-indicator" 
                                     style="background: ${this.getPlatformColor(post.platformId)}"
                                     title="${post.content.title || 'Scheduled post'} - ${this.formatTime(post.scheduledAt)}">
                                </div>
                            `).join('')}
                            ${dayPosts.length > 3 ? `<span class="calendar__more">+${dayPosts.length - 3}</span>` : ''}
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
        const posts = postManager.getScheduledInRange(weekStart, weekEnd, this.filters);
        const postsByDate = this.groupPostsByDate(posts);

        // Get scheduled slots
        const slots = scheduler.getSlotsInRange(weekStart, weekEnd, this.filters);

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
                        ${dayPosts.map(post => `
                            <div class="calendar__post-card" data-post-id="${post.id}">
                                <div class="calendar__post-time">${this.formatTime(post.scheduledAt)}</div>
                                <div class="calendar__post-platform" style="color: ${this.getPlatformColor(post.platformId)}">
                                    ${post.platformId}
                                </div>
                                <div class="calendar__post-title">${post.content.title || 'Untitled'}</div>
                                <span class="calendar__post-status calendar__post-status--${post.status}">${post.status}</span>
                            </div>
                        `).join('')}
                        ${daySlots.filter(slot => !dayPosts.some(p => 
                            p.scheduledAt.getTime() === slot.time.getTime()
                        )).map(slot => `
                            <div class="calendar__slot calendar__slot--empty" data-slot-time="${slot.time.toISOString()}">
                                <span class="calendar__slot-time">${this.formatTime(slot.time)}</span>
                                <span class="calendar__slot-label">Available slot</span>
                            </div>
                        `).join('')}
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
        // Navigation
        this.container.addEventListener('click', (e) => {
            const navBtn = e.target.closest('[data-action]');
            if (navBtn) {
                const action = navBtn.dataset.action;
                if (action === 'prev') this.prev();
                if (action === 'next') this.next();
                if (action === 'today') this.today();
                return;
            }

            const viewBtn = e.target.closest('[data-view]');
            if (viewBtn) {
                this.setView(viewBtn.dataset.view);
                return;
            }

            const day = e.target.closest('[data-date]');
            if (day && this.onDateSelect) {
                const date = new Date(day.dataset.date);
                this.selectedDate = date;
                this.onDateSelect(date);
                return;
            }

            const slot = e.target.closest('[data-slot-time]');
            if (slot && this.onSlotClick) {
                const time = new Date(slot.dataset.slotTime);
                this.onSlotClick(time);
                return;
            }

            const postCard = e.target.closest('[data-post-id]');
            if (postCard) {
                const postId = postCard.dataset.postId;
                // Could emit event or navigate to post details
                console.log('Post clicked:', postId);
                return;
            }
        });
    }

    // ==================== Helper Methods ====================

    getDateKey(date) {
        return date.toISOString().split('T')[0];
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
