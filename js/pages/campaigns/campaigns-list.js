// =====================================================
// CAMPAIGN LIST — Load & render existing campaigns
// =====================================================

const CampaignList = {

    /** Bind campaigns list DOM elements */
    bindElements() {
        const s = CampaignState;
        s.els.campaignsListSection = document.getElementById('campaigns-list');
        s.els.campaignsGrid        = document.getElementById('campaigns-grid');
        s.els.noCampaignsMsg       = document.getElementById('no-campaigns');
    },

    /** Load campaigns from DB */
    async loadCampaignsList() {
        const s = CampaignState;
        if (!s.currentBrand?.id) return;

        try {
            let campaigns = [];
            if (typeof campaignManager !== 'undefined') {
                campaigns = await campaignManager.getCampaignsByBrand(s.currentBrand.id);
            }
            CampaignList.renderCampaignsList(campaigns);
            s._campaignsLoaded = true;
        } catch (error) {
            console.error('Failed to load campaigns:', error);
        }
    },

    /** Status badge config */
    _statusConfig: {
        setup:      { cls: 'setup',      icon: '\u2699\uFE0F',  label: 'Setup' },
        stories:    { cls: 'stories',    icon: '\uD83D\uDCD6',  label: 'Stories' },
        planned:    { cls: 'planned',    icon: '\uD83D\uDCCB',  label: 'Planned' },
        active:     { cls: 'active',     icon: '\u25B6\uFE0F',  label: 'Active' },
        generating: { cls: 'generating', icon: '\uD83D\uDD04',  label: 'Generating' },
        reviewing:  { cls: 'reviewing',  icon: '\uD83D\uDC41\uFE0F',  label: 'Reviewing' },
        scheduling: { cls: 'scheduling', icon: '\uD83D\uDCC5',  label: 'Scheduling' },
        paused:     { cls: 'paused',     icon: '\u23F8\uFE0F',  label: 'Paused' },
        completed:  { cls: 'completed',  icon: '\u2705',        label: 'Completed' },
        cancelled:  { cls: 'cancelled',  icon: '\u274C',        label: 'Cancelled' }
    },

    /** Render campaigns as kanban-style cards */
    renderCampaignsList(campaigns) {
        const grid = CampaignState.els.campaignsGrid;
        const empty = CampaignState.els.noCampaignsMsg;
        if (!grid) return;

        if (!campaigns || campaigns.length === 0) {
            grid.innerHTML = '';
            empty?.classList.remove('hidden');
            return;
        }
        empty?.classList.add('hidden');

        grid.innerHTML = campaigns.map(c => {
            const created = new Date(c.created_at).toLocaleDateString();
            const sc = CampaignList._statusConfig[c.status] || { cls: '', icon: '\u2753', label: c.status };

            // Progress
            const hasStats = c.total_jobs !== undefined;
            let percent = c.progress_percent || 0;
            if (!percent && hasStats && c.total_jobs > 0) {
                percent = Math.round(((c.complete_jobs || 0) / c.total_jobs) * 100);
            }

            // Job counts
            const total = c.total_jobs || 0;
            const complete = c.complete_jobs || 0;
            const processing = c.processing_jobs || 0;
            const failed = c.failed_jobs || 0;
            const pending = total - complete - processing - failed;

            // Next scheduled
            let nextHtml = '<span class="cp-card-meta__val">\u2014</span>';
            if (c.next_scheduled_at) {
                const next = new Date(c.next_scheduled_at);
                const diffMs = next - new Date();
                const diffH = Math.round(diffMs / 3600000);
                if (diffH < 0) nextHtml = '<span class="cp-card-meta__val cp-card-meta__val--warn">Overdue</span>';
                else if (diffH < 1) nextHtml = '<span class="cp-card-meta__val cp-card-meta__val--info">' + Math.round(diffMs / 60000) + 'm</span>';
                else if (diffH < 24) nextHtml = '<span class="cp-card-meta__val cp-card-meta__val--info">' + diffH + 'h</span>';
                else nextHtml = '<span class="cp-card-meta__val">' + Math.round(diffH / 24) + 'd</span>';
            } else if (c.status === 'completed') {
                nextHtml = '<span class="cp-card-meta__val cp-card-meta__val--done">Done</span>';
            }

            return '<a href="campaign-detail.html?id=' + encodeURIComponent(c.id) + '" class="cp-campaign-card cp-campaign-card--' + sc.cls + '">' +
                '<div class="cp-campaign-card__header">' +
                    '<span class="cp-campaign-card__id">Campaign #' + c.id.slice(0, 8) + '</span>' +
                    '<span class="cp-campaign-card__badge cp-campaign-card__badge--' + sc.cls + '">' + sc.icon + ' ' + sc.label + '</span>' +
                '</div>' +
                (hasStats ? '<div class="cp-campaign-card__progress">' +
                    '<div class="cp-campaign-card__bar"><div class="cp-campaign-card__fill" style="width:' + percent + '%"></div></div>' +
                    '<span class="cp-campaign-card__pct">' + percent + '%</span>' +
                '</div>' : '') +
                '<div class="cp-campaign-card__stats">' +
                    (complete > 0 ? '<span class="cp-stat cp-stat--success">' + complete + '\u2713</span>' : '') +
                    (processing > 0 ? '<span class="cp-stat cp-stat--warn">' + processing + '\u23F3</span>' : '') +
                    (failed > 0 ? '<span class="cp-stat cp-stat--error">' + failed + '\u2717</span>' : '') +
                    (pending > 0 ? '<span class="cp-stat cp-stat--muted">' + pending + '\u25CB</span>' : '') +
                    (!hasStats ? '<span class="cp-stat cp-stat--muted">' + (c.video_count || 0) + ' planned</span>' : '') +
                '</div>' +
                '<div class="cp-campaign-card__meta">' +
                    '<div class="cp-card-meta">' +
                        '<span class="cp-card-meta__label">Videos</span>' +
                        '<span class="cp-card-meta__val">' + (c.video_count || 0) + '</span>' +
                    '</div>' +
                    '<div class="cp-card-meta">' +
                        '<span class="cp-card-meta__label">Created</span>' +
                        '<span class="cp-card-meta__val">' + created + '</span>' +
                    '</div>' +
                    '<div class="cp-card-meta">' +
                        '<span class="cp-card-meta__label">Next</span>' +
                        nextHtml +
                    '</div>' +
                '</div>' +
            '</a>';
        }).join('');
    }
};
