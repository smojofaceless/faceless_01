// =====================================================
// CALENDAR PAGE - Best Times Panel
// Best posting times panel toggle, controls, and data loading
// =====================================================

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

    const brandId = activeBrandFilter || calendarInstance?._filters?.brandId || null;
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
