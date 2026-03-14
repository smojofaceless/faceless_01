// =====================================================
// CALENDAR PAGE - Toolbar & Filters
// Navigation controls, view toggles, and filter dropdowns
// =====================================================

/**
 * Set up toolbar controls (nav, view toggle, create button)
 */
function setupToolbar() {
    // Today button
    if (calElements.todayBtn) {
        calElements.todayBtn.addEventListener('click', () => {
            calendarInstance.today();
        });
    }

    // Previous button
    if (calElements.prevBtn) {
        calElements.prevBtn.addEventListener('click', () => {
            calendarInstance.prev();
        });
    }

    // Next button
    if (calElements.nextBtn) {
        calElements.nextBtn.addEventListener('click', () => {
            calendarInstance.next();
        });
    }

    // View toggle buttons
    calElements.viewToggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            if (view && view !== currentView) {
                calElements.viewToggleBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentView = view;
                calendarInstance.setView(view);
            }
        });
    });

    // Create post button
    if (calElements.createPostBtn) {
        calElements.createPostBtn.addEventListener('click', () => {
            window.location.href = 'campaign.html';
        });
    }
}

/**
 * Set up filter controls (platform, status)
 */
function setupFilters() {
    // Platform filter
    if (calElements.platformFilter) {
        calElements.platformFilter.addEventListener('change', (e) => {
            const platformId = e.target.value || null;
            calendarInstance.setFilters({ platformId });
        });
    }

    // Status filter
    if (calElements.statusFilter) {
        calElements.statusFilter.addEventListener('change', (e) => {
            const status = e.target.value || null;
            calendarInstance.setFilters({ status });
        });
    }
}

/**
 * Handle calendar navigation
 * @param {Object} info - Navigation info with title
 */
function handleNavigate(info) {
    updateCalendarTitle(info.title);
}

/**
 * Update the calendar title display
 * @param {string} title - Title text (optional)
 */
function updateCalendarTitle(title) {
    if (calElements.calendarTitle) {
        if (title) {
            calElements.calendarTitle.textContent = title;
        } else if (calendarInstance) {
            calElements.calendarTitle.textContent = calendarInstance.getCurrentTitle();
        }
    }
}
