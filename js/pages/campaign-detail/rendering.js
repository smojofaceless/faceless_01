// =====================================================
// CAMPAIGN DETAIL — RENDERING
// =====================================================
(function() {
    const CD = window.campaignDetailPage;

    // Tailwind status config for the header badge
    const statusConfig = {
        active:    { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Active' },
        planned:   { bg: 'bg-blue-500/10',    text: 'text-blue-400',    dot: 'bg-blue-400',    label: 'Planned' },
        paused:    { bg: 'bg-amber-500/10',    text: 'text-amber-400',   dot: 'bg-amber-400',   label: 'Paused' },
        completed: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Completed' },
        complete:  { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Complete' },
        cancelled: { bg: 'bg-gray-500/10',    text: 'text-gray-400',    dot: 'bg-gray-400',    label: 'Cancelled' },
        failed:    { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400',     label: 'Failed' },
        draft:     { bg: 'bg-gray-500/10',    text: 'text-gray-400',    dot: 'bg-gray-400',    label: 'Draft' },
        processing:{ bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400',   label: 'Processing' }
    };

    // Tailwind job status badge classes
    const jobStatusStyles = {
        pending:    'bg-amber-500/10 text-amber-400',
        processing: 'bg-blue-500/10 text-blue-400',
        generating: 'bg-blue-500/10 text-blue-400',
        assembling: 'bg-blue-500/10 text-blue-400',
        rendering:  'bg-blue-500/10 text-blue-400',
        complete:   'bg-emerald-500/10 text-emerald-400',
        completed:  'bg-emerald-500/10 text-emerald-400',
        failed:     'bg-red-500/10 text-red-400',
        cancelled:  'bg-gray-500/10 text-gray-400'
    };

    const jobStatusNames = {
        pending: 'Pending', processing: 'Processing', generating: 'Generating',
        assembling: 'Assembling', rendering: 'Rendering',
        complete: 'Complete', completed: 'Complete',
        failed: 'Failed', cancelled: 'Cancelled'
    };

    CD.showNotFoundState = function() {
        CD.hideAllStates();
        CD.el.notFoundState?.classList.remove('hidden');
    };

    CD.hideAllStates = function() {
        CD.el.loadingState?.classList.add('hidden');
        CD.el.notFoundState?.classList.add('hidden');
        CD.el.campaignDetail?.classList.add('hidden');
    };

    CD.renderCampaign = function() {
        const c = CD.campaign;
        if (!c) return;

        CD.el.campaignTitle.textContent = `Campaign #${c.id.slice(0, 8)}`;
        CD.updateStatusBadge(c.status);

        CD.el.metaCreated.textContent = new Date(c.created_at).toLocaleString();

        let brandName = c.brand_name;
        if (!brandName && c.brand_id && typeof brandManager !== 'undefined') {
            const brand = brandManager.get(c.brand_id);
            brandName = brand?.name;
        }
        CD.el.metaBrand.textContent = brandName || c.brand_id?.slice(0, 8) || 'Unknown';

        CD.updateControls(c.status);
        CD.updateStats();
        CD.updateProgress();
    };

    CD.updateStatusBadge = function(status) {
        const badge = CD.el.statusBadge;
        if (!badge) return;
        const cfg = statusConfig[status] || statusConfig.draft;
        badge.className = `inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`;
        const dot = badge.querySelector('#status-dot');
        if (dot) dot.className = `w-2 h-2 rounded-full ${cfg.dot}`;
        const text = badge.querySelector('#status-text');
        if (text) text.textContent = cfg.label;
    };

    CD.updateControls = function(status) {
        const canPause = ['active', 'planned'].includes(status);
        const canResume = status === 'paused';
        const canCancel = ['draft', 'planned', 'active', 'paused'].includes(status);

        CD.el.pauseBtn?.classList.toggle('hidden', !canPause);
        CD.el.resumeBtn?.classList.toggle('hidden', !canResume);
        CD.el.cancelBtn?.classList.toggle('hidden', !canCancel);
    };

    CD.updateStats = function() {
        if (CD.stats && CD.stats.total !== undefined) {
            CD.el.statTotal.textContent = CD.stats.total || 0;
            CD.el.statPending.textContent = (CD.stats.pending || 0) + (CD.stats.generating || 0);
            CD.el.statCompleted.textContent = CD.stats.complete || 0;
            CD.el.statFailed.textContent = CD.stats.failed || 0;
            return;
        }
        const jobs = CD.jobs || [];
        CD.el.statTotal.textContent = jobs.length;
        CD.el.statPending.textContent = jobs.filter(j => ['pending', 'queued'].includes(j.status)).length + jobs.filter(j => ['generating', 'assembling', 'rendering'].includes(j.status)).length;
        CD.el.statCompleted.textContent = jobs.filter(j => j.status === 'complete').length;
        CD.el.statFailed.textContent = jobs.filter(j => j.status === 'failed').length;
    };

    CD.updateProgress = function() {
        const total = CD.stats?.total || CD.jobs?.length || 0;
        if (total === 0) {
            CD.el.progressPercentage.textContent = '0%';
            CD.el.progressCompleted.style.width = '0%';
            CD.el.progressProcessing.style.width = '0%';
            return;
        }
        let completed, processing;
        if (CD.stats && CD.stats.complete !== undefined) {
            completed = CD.stats.complete || 0;
            processing = CD.stats.generating || 0;
        } else {
            const jobs = CD.jobs || [];
            completed = jobs.filter(j => j.status === 'complete').length;
            processing = jobs.filter(j => ['generating', 'assembling', 'rendering'].includes(j.status)).length;
        }
        const completedPct = Math.round((completed / total) * 100);
        const processingPct = Math.round((processing / total) * 100);
        CD.el.progressPercentage.textContent = `${completedPct}%`;
        CD.el.progressCompleted.style.width = `${completedPct}%`;
        CD.el.progressProcessing.style.width = `${processingPct}%`;
    };

    CD.renderJobs = function() {
        if (!CD.el.jobsTbody) return;

        let filteredJobs = CD.jobs || [];
        if (CD.statusFilter) {
            filteredJobs = filteredJobs.filter(j => j.status === CD.statusFilter);
        }
        if (filteredJobs.length === 0) {
            CD.el.jobsTbody.innerHTML = '';
            CD.el.noJobsMsg?.classList.remove('hidden');
            return;
        }
        CD.el.noJobsMsg?.classList.add('hidden');

        filteredJobs.sort((a, b) => {
            const timeA = new Date(a.scheduled_post_at || a.created_at);
            const timeB = new Date(b.scheduled_post_at || b.created_at);
            return timeA - timeB;
        });

        const btnBase = 'px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer';

        CD.el.jobsTbody.innerHTML = filteredJobs.map(job => {
            const scheduledAt = job.scheduled_post_at
                ? new Date(job.scheduled_post_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
                : 'Not scheduled';

            const preset = job.vibe_preset || job.meta?.vibe_preset || 'Unknown';
            const platforms = job.meta?.platforms || [];

            const platformsHtml = platforms.map(p => {
                const info = CD.platformSvgs[p];
                return info
                    ? `<span class="inline-block" title="${info.label}">${info.icon}</span>`
                    : `<span class="inline-block" title="${p}">📺</span>`;
            }).join(' ');

            const failureInfo = CD.failureInfoMap?.[job.id];

            const actions = [];
            if (job.video_url) {
                actions.push(`<button class="${btnBase} bg-surface-light hover:bg-surface-lighter text-gray-300" onclick="window.campaignDetailPage.previewVideo('${job.video_url}')" title="Watch Video">▶️</button>`);
            }
            if (job.status === 'failed') {
                actions.push(`<button class="${btnBase} bg-surface-light hover:bg-surface-lighter text-gray-300" onclick="window.campaignDetailPage.showFailureHistory('${job.id}')" title="View failure history">📋</button>`);
                if (failureInfo?.canRetry) {
                    actions.push(`<button class="${btnBase} bg-brand/20 hover:bg-brand/30 text-brand-light" onclick="window.campaignDetailPage.retryJob('${job.id}')">Requeue</button>`);
                } else {
                    actions.push(`<button class="${btnBase} bg-amber-500/10 hover:bg-amber-500/20 text-amber-400" onclick="window.campaignDetailPage.forceRetryJob('${job.id}')" title="Force retry (bypasses policies)">⚠️ Force</button>`);
                }
            }
            if (job.status === 'complete' || job.status === 'completed' || job.status === 'failed') {
                actions.push(`<button class="${btnBase} bg-surface-light hover:bg-surface-lighter text-gray-300" onclick="window.campaignDetailPage.redoJob('${job.id}')" title="Redo job from scratch">🔄 Redo</button>`);
            }

            let statusHtml = CD.renderJobStatus(job.status);
            if (job.status === 'failed' && failureInfo) {
                const stepLabel = failureInfo.step ? `@ ${failureInfo.step}` : '';
                const classEmoji = { transient: '⚡', dependency: '🔌', misconfig: '⚙️', permanent: '🚫', unknown: '❓' }[failureInfo.failureClass] || '❓';
                statusHtml += `<div class="failure-info">
                    <span class="failure-info__class" title="${failureInfo.failureClass}">${classEmoji} ${failureInfo.failureClass}</span>
                    ${stepLabel ? `<span class="failure-info__step">${stepLabel}</span>` : ''}
                    <span class="failure-info__attempts">#${failureInfo.attemptCount || 1}</span>
                </div>`;
            }

            const isSelected = CD.selectedJobId === job.id;
            return `
                <tr class="cursor-pointer transition-colors ${isSelected ? 'bg-brand/[0.08] border-l-2 border-l-brand' : 'hover:bg-white/[0.03]'} ${job.status === 'failed' && !isSelected ? 'bg-red-500/[0.04]' : ''}"
                    data-job-id="${job.id}" onclick="window.campaignDetailPage.selectJob('${job.id}')">
                    <td class="px-4 py-3 text-sm text-gray-300">${scheduledAt}</td>
                    <td class="px-4 py-3 text-sm text-gray-300">${CD.formatPresetName(preset)}</td>
                    <td class="px-4 py-3 text-sm">${platformsHtml || '-'}</td>
                    <td class="px-4 py-3 text-sm">${statusHtml}</td>
                    <td class="px-4 py-3 text-sm">
                        <div class="flex items-center gap-1.5" onclick="event.stopPropagation()">${actions.length ? actions.join('') : '-'}</div>
                    </td>
                </tr>
            `;
        }).join('');
    };

    CD.renderJobStatus = function(status) {
        const styles = jobStatusStyles[status] || 'bg-gray-500/10 text-gray-400';
        const name = jobStatusNames[status] || status;
        return `<span class="inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${styles}">${name}</span>`;
    };

    CD.formatPresetName = function(preset) {
        return preset.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    };

    CD.selectJob = function(jobId) {
        // Update dropdown to match
        if (CD.el.logJobSelect) CD.el.logJobSelect.value = jobId;
        // Load logs (this sets CD.selectedJobId)
        CD.loadJobLogs(jobId);
        // Re-render jobs to update selected row styling
        CD.renderJobs();
        // Scroll pipeline into view
        const logsSection = document.getElementById('job-logs-section');
        if (logsSection) logsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
})();
