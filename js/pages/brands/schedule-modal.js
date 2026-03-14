// Schedule windows modal — posting windows, blackout hours
// Extracted from brands.html inline script

let scheduleBrandId = null;

async function openScheduleModal(brandId) {
    scheduleBrandId = brandId;
    document.getElementById('schedule-modal').classList.add('active');

    // Load existing config
    try {
        const cfg = await brandManager.getScheduleConfig(brandId);
        populateScheduleForm(cfg);
    } catch (e) {
        console.error('Failed to load schedule config:', e);
        populateScheduleForm(null);
    }

    bindScheduleEvents();
}

function closeScheduleModal() {
    document.getElementById('schedule-modal').classList.remove('active');
    scheduleBrandId = null;
}

function populateScheduleForm(cfg) {
    document.getElementById('schedule-start-hour').value = cfg?.posting_window?.start ?? 8;
    document.getElementById('schedule-end-hour').value = cfg?.posting_window?.end ?? 22;

    const activeDays = cfg?.active_days ?? [0,1,2,3,4,5,6];
    document.querySelectorAll('#schedule-days .schedule-day-btn').forEach(btn => {
        const day = parseInt(btn.dataset.day);
        btn.classList.toggle('active', activeDays.includes(day));
    });

    const maxPosts = cfg?.max_posts_per_day ?? 3;
    document.getElementById('schedule-max-posts').value = maxPosts;
    document.getElementById('schedule-max-posts-value').textContent = maxPosts;

    const minGap = cfg?.min_gap_hours ?? 4;
    document.getElementById('schedule-min-gap').value = minGap;
    document.getElementById('schedule-min-gap-value').textContent = minGap + 'h';

    document.getElementById('schedule-blackout-start').value = cfg?.blackout?.start ?? '';
    document.getElementById('schedule-blackout-end').value = cfg?.blackout?.end ?? '';

    updateScheduleSummary();
}

function bindScheduleEvents() {
    // Day toggles
    document.querySelectorAll('#schedule-days .schedule-day-btn').forEach(btn => {
        const clone = btn.cloneNode(true);
        btn.parentNode.replaceChild(clone, btn);
        clone.addEventListener('click', () => {
            clone.classList.toggle('active');
            updateScheduleSummary();
        });
    });

    // Sliders
    const maxSlider = document.getElementById('schedule-max-posts');
    maxSlider.oninput = () => {
        document.getElementById('schedule-max-posts-value').textContent = maxSlider.value;
        updateScheduleSummary();
    };

    const gapSlider = document.getElementById('schedule-min-gap');
    gapSlider.oninput = () => {
        document.getElementById('schedule-min-gap-value').textContent = gapSlider.value + 'h';
        updateScheduleSummary();
    };

    // Save
    const saveBtn = document.getElementById('schedule-save-btn');
    const clone = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(clone, saveBtn);
    clone.addEventListener('click', saveScheduleConfig);

    // Reset
    const resetBtn = document.getElementById('schedule-reset-btn');
    const resetClone = resetBtn.cloneNode(true);
    resetBtn.parentNode.replaceChild(resetClone, resetBtn);
    resetClone.addEventListener('click', async () => {
        try {
            await brandManager.saveScheduleConfig(scheduleBrandId, null);
            toast.success('Schedule config reset to defaults');
            closeScheduleModal();
        } catch (e) {
            toast.error('Failed to reset: ' + e.message);
        }
    });

    // Update summary on dropdown changes
    ['schedule-start-hour', 'schedule-end-hour', 'schedule-blackout-start', 'schedule-blackout-end'].forEach(id => {
        document.getElementById(id).onchange = updateScheduleSummary;
    });
}

function updateScheduleSummary() {
    const start = parseInt(document.getElementById('schedule-start-hour').value);
    const end = parseInt(document.getElementById('schedule-end-hour').value);
    const activeDays = [];
    document.querySelectorAll('#schedule-days .schedule-day-btn.active').forEach(btn => {
        activeDays.push(parseInt(btn.dataset.day));
    });
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dayStr = activeDays.length === 7 ? 'every day' :
        activeDays.length === 0 ? 'no days' :
        activeDays.map(d => dayNames[d]).join(', ');
    const maxPosts = document.getElementById('schedule-max-posts').value;
    const gap = document.getElementById('schedule-min-gap').value;

    const blackoutStart = document.getElementById('schedule-blackout-start').value;
    const blackoutEnd = document.getElementById('schedule-blackout-end').value;
    let blackoutStr = '';
    if (blackoutStart !== '' && blackoutEnd !== '') {
        blackoutStr = ` · Blackout ${String(blackoutStart).padStart(2,'0')}:00–${String(blackoutEnd).padStart(2,'0')}:00`;
    }

    const text = `${dayStr}, ${String(start).padStart(2,'0')}:00–${String(end).padStart(2,'0')}:00 · Up to ${maxPosts}/day · ${gap}h apart${blackoutStr}`;
    document.getElementById('schedule-summary-text').textContent = text;
}

async function saveScheduleConfig() {
    if (!scheduleBrandId) return;

    const activeDays = [];
    document.querySelectorAll('#schedule-days .schedule-day-btn.active').forEach(btn => {
        activeDays.push(parseInt(btn.dataset.day));
    });

    const cfg = {
        posting_window: {
            start: parseInt(document.getElementById('schedule-start-hour').value),
            end: parseInt(document.getElementById('schedule-end-hour').value),
        },
        active_days: activeDays,
        max_posts_per_day: parseInt(document.getElementById('schedule-max-posts').value),
        min_gap_hours: parseFloat(document.getElementById('schedule-min-gap').value),
    };

    const blackoutStart = document.getElementById('schedule-blackout-start').value;
    const blackoutEnd = document.getElementById('schedule-blackout-end').value;
    if (blackoutStart !== '' && blackoutEnd !== '') {
        cfg.blackout = {
            start: parseInt(blackoutStart),
            end: parseInt(blackoutEnd),
        };
    }

    const btn = document.getElementById('schedule-save-btn');
    try {
        if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
        await brandManager.saveScheduleConfig(scheduleBrandId, cfg);
        toast.success('Schedule config saved');
        closeScheduleModal();
    } catch (e) {
        toast.error('Failed to save: ' + e.message);
        console.error(e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Schedule'; }
    }
}
