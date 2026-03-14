// =====================================================
// CAMPAIGN SCHEDULE — Preview generation & rendering
// =====================================================

const CampaignSchedule = {

    /** Bind schedule preview DOM elements */
    bindElements() {
        CampaignState.els.schedulePreviewContent = document.getElementById('schedule-preview-content');
        CampaignState.els.refreshPreviewBtn = document.getElementById('refresh-preview');
    },

    /** Bind refresh event */
    bindEvents() {
        CampaignState.els.refreshPreviewBtn?.addEventListener('click', () => CampaignSchedule.refreshSchedulePreview());
    },

    /** Generate & display the schedule preview */
    async refreshSchedulePreview() {
        const content = CampaignState.els.schedulePreviewContent;
        if (!content) return;

        content.innerHTML = '<div class="cp-schedule-loading"><div class="spinner"></div><p>Generating schedule...</p></div>';

        try {
            const config = CampaignForm.getFormConfig();

            if (typeof campaignManager !== 'undefined') {
                CampaignState.schedulePreview = await campaignManager.generateSchedulePreview(config);
            } else {
                CampaignState.schedulePreview = CampaignSchedule.generateSimplePreview(config);
            }

            CampaignState._scheduleUsesAI = CampaignState.schedulePreview.some(item => item.time_source === 'ai');
            CampaignState._scheduleAICount = CampaignState.schedulePreview.filter(item => item.time_source === 'ai').length;

            CampaignSchedule.renderSchedulePreview();
        } catch (error) {
            console.error('Failed to generate schedule preview:', error);
            content.innerHTML = '<div class="cp-schedule-loading"><p style="color:var(--color-error)">Failed to generate preview</p></div>';
        }
    },

    /** Fallback client-side schedule generation */
    generateSimplePreview(config) {
        const preview = [];
        const startDate = new Date(config.startDate + 'T00:00:00');
        const weights = config.presetWeights || {};

        for (let i = 0; i < config.videoCount; i++) {
            const dayOffset = Math.floor(i / config.postsPerDay);
            const windowIndex = i % config.postsPerDay;

            const scheduledDate = new Date(startDate);
            scheduledDate.setDate(scheduledDate.getDate() + dayOffset);

            const parts = (config.windows[windowIndex] || '12:00').split(':');
            scheduledDate.setHours(parseInt(parts[0]), parseInt(parts[1]), 0, 0);

            const preset = CampaignSchedule._weightedRandomPreset(weights);
            preview.push({ scheduledAt: scheduledDate.toISOString(), preset: preset, platforms: config.platforms });
        }
        return preview;
    },

    /** Weighted random preset selection */
    _weightedRandomPreset(weights) {
        const entries = Object.entries(weights);
        if (entries.length === 0) return 'urban_legend';
        const totalWeight = entries.reduce((sum, e) => sum + e[1], 0);
        let roll = Math.random() * totalWeight;
        for (const [preset, weight] of entries) {
            roll -= weight;
            if (roll <= 0) return preset;
        }
        return entries[0][0];
    },

    /** Platform icon SVG map */
    _platformSvgs: {
        youtube_shorts: { icon: '<svg viewBox="0 0 24 24" fill="#FF0000" width="14" height="14"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><polygon fill="#FFF" points="9.545 15.568 15.818 12 9.545 8.432"/></svg>', label: 'YouTube Shorts' },
        youtube: { icon: '<svg viewBox="0 0 24 24" fill="#FF0000" width="14" height="14"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><polygon fill="#FFF" points="9.545 15.568 15.818 12 9.545 8.432"/></svg>', label: 'YouTube' },
        tiktok: { icon: '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/></svg>', label: 'TikTok' },
        instagram_reels: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="#E4405F" stroke-width="2" width="14" height="14"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>', label: 'Instagram Reels' },
        instagram: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="#E4405F" stroke-width="2" width="14" height="14"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>', label: 'Instagram' },
        facebook_reels: { icon: '<svg viewBox="0 0 24 24" fill="#1877F2" width="14" height="14"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>', label: 'Facebook Reels' },
        facebook: { icon: '<svg viewBox="0 0 24 24" fill="#1877F2" width="14" height="14"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>', label: 'Facebook' },
        threads: { icon: '<svg viewBox="0 0 192 192" fill="currentColor" width="14" height="14"><path d="M141.537 88.988a66.6 66.6 0 00-2.518-1.143c-1.482-27.307-16.403-42.94-41.457-43.1h-.335c-14.986 0-27.449 6.396-35.12 18.028l13.661 9.427c5.587-8.586 14.217-13.014 21.459-13.014h.118c8.803.052 15.462 2.952 19.809 8.588 3.275 4.253 5.489 9.848 6.605 17.649-6.728-1.189-13.959-1.658-21.616-1.407-21.15.636-34.74 12.417-33.798 28.355.481 8.054 4.522 15.108 11.324 19.886 5.84 3.879 13.319 5.848 21.101 5.481 10.414-.495 18.784-4.649 24.867-12.383 4.589-5.842 7.671-13.295 9.342-22.632 4.894 2.899 8.626 6.684 10.922 11.32 3.8 7.657 4.033 19.97-3.631 28.591-6.744 7.612-15.336 11.117-29.605 11.229-15.777-.123-27.576-5.002-35.246-14.521-7.239-8.993-10.98-21.803-11.299-38.053.319-16.251 4.06-29.061 11.127-38.067 7.67-9.518 19.469-14.397 35.246-14.52 15.916.124 27.905 5.004 35.816 14.603 3.862 4.682 6.828 10.445 8.826 17.154l13.437-3.767a63.7 63.7 0 00-11.079-21.305c-10.06-12.243-24.561-18.556-46.902-18.715h-.064c-22.242.159-36.639 6.479-46.53 18.575-8.916 11.096-13.612 26.369-13.959 46.063v.102c.347 19.694 5.043 34.967 13.959 46.063 9.891 12.096 24.288 18.416 46.53 18.576h.064c17.347-.133 28.81-4.863 37.445-14.547 10.952-12.239 10.592-28.26 5.44-38.797-3.549-7.272-9.48-13.296-17.39-17.608zm-47.893 34.655c-9.115.444-17.852-4.883-18.401-11.445-.408-4.801 2.61-13.516 21.502-14.168 2.287-.077 4.528-.114 6.73-.114 5.765 0 11.227.515 16.278 1.5-1.935 18.074-13.519 23.589-26.109 24.227z"/></svg>', label: 'Threads' },
        twitter: { icon: '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>', label: 'X' },
        x: { icon: '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>', label: 'X' }
    },

    /** Render the schedule preview as a timeline */
    renderSchedulePreview() {
        const content = CampaignState.els.schedulePreviewContent;
        const items = CampaignState.schedulePreview;
        if (!content || !items.length) {
            if (content) content.innerHTML = '<p class="cp-schedule-empty">No items to preview</p>';
            return;
        }

        // Group by day
        const grouped = {};
        items.forEach(item => {
            const itemTime = item.scheduledAt || item.scheduled_post_at;
            const date = new Date(itemTime);
            const dateKey = date.toDateString();
            if (!grouped[dateKey]) grouped[dateKey] = [];
            grouped[dateKey].push(item);
        });

        const aiCount = CampaignState._scheduleAICount || 0;
        const totalCount = items.length;
        const usesAI = CampaignState._scheduleUsesAI || false;

        let html = '<div class="cp-schedule-source">' +
            (usesAI
                ? '<span class="cp-schedule-badge cp-schedule-badge--ai">\uD83E\uDDE0 AI-Optimized</span>' +
                  '<span class="cp-schedule-detail">' + aiCount + '/' + totalCount + ' slots using learned best times</span>'
                : '<span class="cp-schedule-badge cp-schedule-badge--default">\uD83D\uDCD0 Default Windows</span>' +
                  '<span class="cp-schedule-detail">Not enough data yet \u2014 using fixed windows</span>') +
            '</div>';

        html += '<div class="cp-timeline">';

        Object.entries(grouped).forEach(([dateKey, dayItems]) => {
            const firstTime = dayItems[0].scheduledAt || dayItems[0].scheduled_post_at;
            const date = new Date(firstTime);
            const formattedDate = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

            html += '<div class="cp-timeline__day">';
            html += '<div class="cp-timeline__date">' + formattedDate + '</div>';
            html += '<div class="cp-timeline__items">';

            dayItems.forEach(item => {
                const itemTime = item.scheduledAt || item.scheduled_post_at;
                const time = new Date(itemTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                const presetName = item.preset || item.vibe_preset;
                const isAI = item.time_source === 'ai';
                const svgs = CampaignSchedule._platformSvgs;

                const platformsHtml = (item.platforms || []).map(p => {
                    const info = svgs[p];
                    return info
                        ? '<span class="cp-platform-icon" title="' + info.label + '">' + info.icon + '</span>'
                        : '<span class="cp-platform-icon" title="' + p + '">\uD83D\uDCFA</span>';
                }).join('');

                html += '<div class="cp-timeline__item' + (isAI ? ' cp-timeline__item--ai' : '') + '">' +
                    '<div class="cp-timeline__dot"></div>' +
                    '<div class="cp-timeline__content">' +
                    '<span class="cp-timeline__time">' + time + (isAI ? ' \uD83E\uDDE0' : '') + '</span>' +
                    '<span class="cp-timeline__preset">' + CampaignPresets.formatPresetName(presetName) + '</span>' +
                    '<span class="cp-timeline__platforms">' + platformsHtml + '</span>' +
                    '</div></div>';
            });

            html += '</div></div>';
        });

        html += '</div>';
        content.innerHTML = html;
    }
};
