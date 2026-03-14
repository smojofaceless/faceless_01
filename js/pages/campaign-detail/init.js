// =====================================================
// CAMPAIGN DETAIL — INIT, DOM BINDING & DATA LOADING
// =====================================================
(function() {
    const CD = window.campaignDetailPage;

    // --- Initialization ---
    CD.init = async function() {
        console.log('📊 Initializing Campaign Detail Page');

        const params = new URLSearchParams(window.location.search);
        CD.campaignId = params.get('id');

        if (!CD.campaignId) {
            CD.showNotFoundState();
            return;
        }

        if (typeof brandManager !== 'undefined') {
            await brandManager.init();
        }

        CD.bindElements();
        CD.bindEvents();

        await CD.loadCampaign();

        CD.setupRealtimeSubscriptions();
        CD.startAutoRefresh();
    };

    // --- DOM Element Binding ---
    CD.bindElements = function() {
        CD.el.loadingState      = document.getElementById('loading-state');
        CD.el.notFoundState     = document.getElementById('not-found-state');
        CD.el.campaignDetail    = document.getElementById('campaign-detail');

        CD.el.campaignTitle     = document.getElementById('campaign-title');

        CD.el.statusBadge       = document.getElementById('status-badge');
        CD.el.metaCreated       = document.getElementById('meta-created');
        CD.el.metaBrand         = document.getElementById('meta-brand');

        CD.el.pauseBtn          = document.getElementById('btn-pause');
        CD.el.resumeBtn         = document.getElementById('btn-resume');
        CD.el.cancelBtn         = document.getElementById('btn-cancel');
        CD.el.cloneBtn          = document.getElementById('btn-clone');

        CD.el.statTotal         = document.getElementById('stat-total');
        CD.el.statPending       = document.getElementById('stat-pending');
        CD.el.statCompleted     = document.getElementById('stat-completed');
        CD.el.statFailed        = document.getElementById('stat-failed');

        CD.el.progressPercentage = document.getElementById('progress-percentage');
        CD.el.progressCompleted  = document.getElementById('progress-completed');
        CD.el.progressProcessing = document.getElementById('progress-processing');

        CD.el.filterStatus      = document.getElementById('filter-status');
        CD.el.jobsTbody         = document.getElementById('jobs-tbody');
        CD.el.noJobsMsg         = document.getElementById('no-jobs');

        CD.el.logJobSelect      = document.getElementById('log-job-select');
        CD.el.btnCopyLogs       = document.getElementById('btn-copy-logs');
        CD.el.btnRefreshLogs    = document.getElementById('btn-refresh-logs');
        CD.el.stepTimeline      = document.getElementById('step-timeline');
        CD.el.logsContent       = document.getElementById('logs-content');
        CD.el.logShowSnapshots  = document.getElementById('log-show-snapshots');
        CD.el.logShowProgress   = document.getElementById('log-show-progress');

        CD.el.stepDetailTitle   = document.getElementById('step-detail-title');
        CD.el.stepDetailContent = document.getElementById('step-detail-content');
        CD.el.stepDetailClose   = document.getElementById('step-detail-close');

        CD.el.confirmModal      = document.getElementById('confirm-modal');
        CD.el.confirmTitle      = document.getElementById('confirm-title');
        CD.el.confirmMessage    = document.getElementById('confirm-message');
        CD.el.confirmOkBtn      = document.getElementById('confirm-ok');
        CD.el.confirmCancelBtn  = document.getElementById('confirm-cancel');
    };

    // --- Event Binding ---
    CD.bindEvents = function() {
        CD.el.pauseBtn?.addEventListener('click', () => CD.confirmAction('pause'));
        CD.el.resumeBtn?.addEventListener('click', () => CD.confirmAction('resume'));
        CD.el.cancelBtn?.addEventListener('click', () => CD.confirmAction('cancel'));
        CD.el.cloneBtn?.addEventListener('click', () => CD.cloneCampaign());

        CD.el.filterStatus?.addEventListener('change', (e) => {
            CD.statusFilter = e.target.value;
            CD.renderJobs();
        });

        CD.el.logJobSelect?.addEventListener('change', (e) => CD.loadJobLogs(e.target.value));
        CD.el.btnCopyLogs?.addEventListener('click', () => CD.copyLogsToClipboard());
        CD.el.btnRefreshLogs?.addEventListener('click', () => CD.loadJobLogs(CD.selectedJobId));
        CD.el.logShowSnapshots?.addEventListener('change', () => CD.renderLogs());
        CD.el.logShowProgress?.addEventListener('change', () => CD.renderLogs());

        CD.el.stepDetailClose?.addEventListener('click', () => CD.closeStepDetail());

        CD.el.confirmOkBtn?.addEventListener('click', () => CD.executeConfirmedAction());
        CD.el.confirmCancelBtn?.addEventListener('click', () => CD.closeModal());
        CD.el.confirmModal?.querySelector('.modal__overlay')?.addEventListener('click', () => CD.closeModal());
        CD.el.confirmModal?.querySelector('.modal__close')?.addEventListener('click', () => CD.closeModal());
    };

    // --- Data Loading ---
    CD.loadCampaign = async function() {
        try {
            if (typeof campaignManager !== 'undefined') {
                const result = await campaignManager.getCampaign(CD.campaignId);
                CD.campaign = result?.campaign || result;
                CD.stats = result?.stats || {};
                CD.jobs = await campaignManager.getCampaignJobs(CD.campaignId);
            } else {
                throw new Error('Campaign manager not available');
            }

            if (!CD.campaign) {
                CD.showNotFoundState();
                return;
            }

            await CD.loadFailureInfo();

            CD.renderCampaign();
            CD.renderJobs();
            CD.populateJobSelect();
            CD.updateStats();
            CD.updateProgress();

            CD.startAutoRefresh();

            CD.hideAllStates();
            CD.el.campaignDetail.classList.remove('hidden');

        } catch (error) {
            console.error('Failed to load campaign:', error);
            CD.showNotFoundState();
        }
    };

    // --- Failure Info Loading ---
    CD.loadFailureInfo = async function() {
        const failedJobs = CD.jobs.filter(j => j.status === 'failed');
        if (failedJobs.length === 0) {
            CD.failureInfoMap = {};
            return;
        }

        try {
            const { data, error } = await supabaseClient
                .rpc('get_failed_jobs_dlq', {
                    p_limit: 100,
                    p_offset: 0,
                    p_filters: { campaign_id: CD.campaignId }
                });

            if (error) {
                console.warn('Failed to load failure info:', error);
                CD.failureInfoMap = {};
                return;
            }

            CD.failureInfoMap = {};
            for (const row of (data || [])) {
                CD.failureInfoMap[row.job_id] = {
                    step: row.last_failure_step,
                    failureClass: row.last_failure_class,
                    error: row.last_failure_error,
                    failedAt: row.failed_at,
                    canRetry: row.can_retry,
                    recommendedAction: row.recommended_action,
                    attemptCount: row.attempt_count,
                    stepAttempts: row.step_attempt_number,
                    stepMaxAttempts: row.step_max_attempts,
                    failureCount: row.total_failure_count
                };
            }
        } catch (err) {
            console.warn('Error loading failure info:', err);
            CD.failureInfoMap = {};
        }
    };

    // --- Get Job Failures ---
    CD.getJobFailures = async function(jobId) {
        try {
            const { data, error } = await supabaseClient
                .rpc('get_job_failures', { p_job_id: jobId });
            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('Failed to get job failures:', err);
            return [];
        }
    };

    // --- Cleanup ---
    CD.destroy = function() {
        CD.stopAutoRefresh();
        CD.cleanupSubscriptions();
    };

})();

// --- Bootstrap ---
document.addEventListener('DOMContentLoaded', () => {
    const brandSwitcher = new BrandSwitcher({ selector: '#brand-switcher' });
    brandSwitcher.init();

    window.campaignDetailPage.init();
});

window.addEventListener('beforeunload', () => {
    window.campaignDetailPage?.destroy();
});
