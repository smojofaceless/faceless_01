// =====================================================
// CAMPAIGN DETAIL PAGE CONTROLLER
// View and manage individual campaigns
// =====================================================

/**
 * Campaign Detail Page Controller
 * Handles campaign viewing, lifecycle controls, and job management
 */
class CampaignDetailPage {
    constructor() {
        this.campaignId = null;
        this.campaign = null;
        this.jobs = [];
        this.statusFilter = '';
        this.refreshInterval = null;
        this.confirmCallback = null;
        
        // Logs state
        this.selectedJobId = null;
        this.currentLogs = [];
        
        // Real-time subscriptions
        this.jobsSubscription = null;
        this.logsSubscription = null;
        this.campaignSubscription = null;
    }

    /**
     * Initialize the page
     */
    async init() {
        console.log('📊 Initializing Campaign Detail Page');
        
        // Get campaign ID from URL
        const params = new URLSearchParams(window.location.search);
        this.campaignId = params.get('id');
        
        if (!this.campaignId) {
            this.showNotFoundState();
            return;
        }
        
        // Wait for brand manager
        if (typeof brandManager !== 'undefined') {
            await brandManager.init();
        }
        
        this.bindElements();
        this.bindEvents();
        
        // Load campaign data
        await this.loadCampaign();
        
        // Start real-time subscriptions
        this.setupRealtimeSubscriptions();
        
        // Start auto-refresh for active campaigns (fallback)
        this.startAutoRefresh();
    }

    /**
     * Bind DOM elements
     */
    bindElements() {
        // States
        this.loadingState = document.getElementById('loading-state');
        this.notFoundState = document.getElementById('not-found-state');
        this.campaignDetail = document.getElementById('campaign-detail');
        
        // Header
        this.campaignTitle = document.getElementById('campaign-title');
        
        // Status bar
        this.statusBadge = document.getElementById('status-badge');
        this.metaCreated = document.getElementById('meta-created');
        this.metaBrand = document.getElementById('meta-brand');
        
        // Controls
        this.pauseBtn = document.getElementById('btn-pause');
        this.resumeBtn = document.getElementById('btn-resume');
        this.cancelBtn = document.getElementById('btn-cancel');
        
        // Stats
        this.statTotal = document.getElementById('stat-total');
        this.statPending = document.getElementById('stat-pending');
        this.statCompleted = document.getElementById('stat-completed');
        this.statFailed = document.getElementById('stat-failed');
        
        // Progress
        this.progressPercentage = document.getElementById('progress-percentage');
        this.progressCompleted = document.getElementById('progress-completed');
        this.progressProcessing = document.getElementById('progress-processing');
        
        // Jobs
        this.filterStatus = document.getElementById('filter-status');
        this.jobsTbody = document.getElementById('jobs-tbody');
        this.noJobsMsg = document.getElementById('no-jobs');
        
        // Job Logs
        this.logJobSelect = document.getElementById('log-job-select');
        this.btnCopyLogs = document.getElementById('btn-copy-logs');
        this.btnRefreshLogs = document.getElementById('btn-refresh-logs');
        this.stepTimeline = document.getElementById('step-timeline');
        this.logsContent = document.getElementById('logs-content');
        this.logShowSnapshots = document.getElementById('log-show-snapshots');
        this.logShowProgress = document.getElementById('log-show-progress');
        
        // Step Detail Panel
        this.stepDetailPanel = document.getElementById('step-detail-panel');
        this.stepDetailTitle = document.getElementById('step-detail-title');
        this.stepDetailContent = document.getElementById('step-detail-content');
        this.stepDetailClose = document.getElementById('step-detail-close');
        this.selectedStepName = null;
        
        // Modal
        this.confirmModal = document.getElementById('confirm-modal');
        this.confirmTitle = document.getElementById('confirm-title');
        this.confirmMessage = document.getElementById('confirm-message');
        this.confirmOkBtn = document.getElementById('confirm-ok');
        this.confirmCancelBtn = document.getElementById('confirm-cancel');
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Control buttons
        this.pauseBtn?.addEventListener('click', () => this.confirmAction('pause'));
        this.resumeBtn?.addEventListener('click', () => this.confirmAction('resume'));
        this.cancelBtn?.addEventListener('click', () => this.confirmAction('cancel'));
        
        // Filter
        this.filterStatus?.addEventListener('change', (e) => {
            this.statusFilter = e.target.value;
            this.renderJobs();
        });
        
        // Job Logs
        this.logJobSelect?.addEventListener('change', (e) => this.loadJobLogs(e.target.value));
        this.btnCopyLogs?.addEventListener('click', () => this.copyLogsToClipboard());
        this.btnRefreshLogs?.addEventListener('click', () => this.loadJobLogs(this.selectedJobId));
        this.logShowSnapshots?.addEventListener('change', () => this.renderLogs());
        this.logShowProgress?.addEventListener('change', () => this.renderLogs());
        
        // Step Detail Panel close
        this.stepDetailClose?.addEventListener('click', () => this.closeStepDetail());
        
        // Modal
        this.confirmOkBtn?.addEventListener('click', () => this.executeConfirmedAction());
        this.confirmCancelBtn?.addEventListener('click', () => this.closeModal());
        this.confirmModal?.querySelector('.modal__overlay')?.addEventListener('click', () => this.closeModal());
        this.confirmModal?.querySelector('.modal__close')?.addEventListener('click', () => this.closeModal());
    }

    /**
     * Load campaign data
     */
    async loadCampaign() {
        try {
            if (typeof campaignManager !== 'undefined') {
                const result = await campaignManager.getCampaign(this.campaignId);
                // getCampaign returns { campaign: {...}, stats: {...} }
                this.campaign = result?.campaign || result;
                this.stats = result?.stats || {};
                this.jobs = await campaignManager.getCampaignJobs(this.campaignId);
            } else {
                throw new Error('Campaign manager not available');
            }
            
            if (!this.campaign) {
                this.showNotFoundState();
                return;
            }
            
            // Fetch failure info for failed jobs (DLQ data)
            await this.loadFailureInfo();
            
            this.renderCampaign();
            this.renderJobs();
            this.populateJobSelect();
            this.updateStats();
            this.updateProgress();
            
            // Restart auto-refresh based on current job states
            this.startAutoRefresh();
            
            // Hide loading, show detail
            this.hideAllStates();
            this.campaignDetail.classList.remove('hidden');
            
        } catch (error) {
            console.error('Failed to load campaign:', error);
            this.showNotFoundState();
        }
    }

    /**
     * Load failure info for failed jobs from DLQ view
     */
    async loadFailureInfo() {
        const failedJobs = this.jobs.filter(j => j.status === 'failed');
        if (failedJobs.length === 0) {
            this.failureInfoMap = {};
            return;
        }

        try {
            // Query the DLQ view for this campaign's failed jobs
            const { data, error } = await supabaseClient
                .rpc('get_failed_jobs_dlq', {
                    p_limit: 100,
                    p_offset: 0,
                    p_filters: { campaign_id: this.campaignId }
                });

            if (error) {
                console.warn('Failed to load failure info:', error);
                this.failureInfoMap = {};
                return;
            }

            // Create a map of job_id -> failure info
            this.failureInfoMap = {};
            for (const row of (data || [])) {
                this.failureInfoMap[row.job_id] = {
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
            this.failureInfoMap = {};
        }
    }

    /**
     * Get failure history for a specific job
     */
    async getJobFailures(jobId) {
        try {
            const { data, error } = await supabaseClient
                .rpc('get_job_failures', { p_job_id: jobId });

            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('Failed to get job failures:', err);
            return [];
        }
    }

    /**
     * Show not found state
     */
    showNotFoundState() {
        this.hideAllStates();
        this.notFoundState?.classList.remove('hidden');
    }

    /**
     * Hide all states
     */
    hideAllStates() {
        this.loadingState?.classList.add('hidden');
        this.notFoundState?.classList.add('hidden');
        this.campaignDetail?.classList.add('hidden');
    }

    /**
     * Render campaign data
     */
    renderCampaign() {
        const c = this.campaign;
        if (!c) return;
        
        // Title
        this.campaignTitle.textContent = `Campaign #${c.id.slice(0, 8)}`;
        
        // Status badge
        this.updateStatusBadge(c.status);
        
        // Meta
        this.metaCreated.textContent = new Date(c.created_at).toLocaleString();
        
        // Get brand name from brandManager if available
        let brandName = c.brand_name;
        if (!brandName && c.brand_id && typeof brandManager !== 'undefined') {
            const brand = brandManager.get(c.brand_id);
            brandName = brand?.name;
        }
        this.metaBrand.textContent = brandName || c.brand_id?.slice(0, 8) || 'Unknown';
        
        // Update control visibility based on status
        this.updateControls(c.status);
        
        // Stats
        this.updateStats();
        
        // Progress
        this.updateProgress();
    }

    /**
     * Update status badge
     */
    updateStatusBadge(status) {
        const badge = this.statusBadge;
        if (!badge) return;
        
        // Remove all status classes
        badge.className = 'status-badge';
        
        // Add status class
        badge.classList.add(`status-badge--${status}`);
        
        // Update text
        const textEl = badge.querySelector('.status-badge__text');
        if (textEl) {
            textEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        }
    }

    /**
     * Update control buttons visibility
     */
    updateControls(status) {
        const canPause = ['active', 'planned'].includes(status);
        const canResume = status === 'paused';
        const canCancel = ['draft', 'planned', 'active', 'paused'].includes(status);
        
        if (this.pauseBtn) {
            this.pauseBtn.classList.toggle('hidden', !canPause);
        }
        if (this.resumeBtn) {
            this.resumeBtn.classList.toggle('hidden', !canResume);
        }
        if (this.cancelBtn) {
            this.cancelBtn.classList.toggle('hidden', !canCancel);
        }
    }

    /**
     * Update stats from jobs or pre-computed stats
     */
    updateStats() {
        // Use pre-computed stats from RPC if available
        if (this.stats && this.stats.total !== undefined) {
            this.statTotal.textContent = this.stats.total || 0;
            this.statPending.textContent = (this.stats.pending || 0) + (this.stats.generating || 0);
            this.statCompleted.textContent = this.stats.complete || 0;
            this.statFailed.textContent = this.stats.failed || 0;
            return;
        }
        
        // Fallback: compute from jobs array
        const jobs = this.jobs || [];
        
        const total = jobs.length;
        const pending = jobs.filter(j => ['pending', 'queued'].includes(j.status)).length;
        const processing = jobs.filter(j => ['generating', 'assembling', 'rendering'].includes(j.status)).length;
        const completed = jobs.filter(j => j.status === 'complete').length;
        const failed = jobs.filter(j => j.status === 'failed').length;
        
        this.statTotal.textContent = total;
        this.statPending.textContent = pending + processing;
        this.statCompleted.textContent = completed;
        this.statFailed.textContent = failed;
    }

    /**
     * Update progress bar
     */
    updateProgress() {
        // Use pre-computed stats if available
        const total = this.stats?.total || this.jobs?.length || 0;
        
        if (total === 0) {
            this.progressPercentage.textContent = '0%';
            this.progressCompleted.style.width = '0%';
            this.progressProcessing.style.width = '0%';
            return;
        }
        
        let completed, processing;
        if (this.stats && this.stats.complete !== undefined) {
            completed = this.stats.complete || 0;
            processing = this.stats.generating || 0;
        } else {
            const jobs = this.jobs || [];
            completed = jobs.filter(j => j.status === 'complete').length;
            processing = jobs.filter(j => ['generating', 'assembling', 'rendering'].includes(j.status)).length;
        }
        
        const completedPct = Math.round((completed / total) * 100);
        const processingPct = Math.round((processing / total) * 100);
        
        this.progressPercentage.textContent = `${completedPct}%`;
        this.progressCompleted.style.width = `${completedPct}%`;
        this.progressProcessing.style.width = `${processingPct}%`;
    }

    /**
     * Render jobs list
     */
    renderJobs() {
        if (!this.jobsTbody) return;
        
        let filteredJobs = this.jobs || [];
        
        // Apply filter
        if (this.statusFilter) {
            filteredJobs = filteredJobs.filter(j => j.status === this.statusFilter);
        }
        
        if (filteredJobs.length === 0) {
            this.jobsTbody.innerHTML = '';
            this.noJobsMsg?.classList.remove('hidden');
            return;
        }
        
        this.noJobsMsg?.classList.add('hidden');
        
        // Sort by scheduled time
        filteredJobs.sort((a, b) => {
            const timeA = new Date(a.scheduled_post_at || a.created_at);
            const timeB = new Date(b.scheduled_post_at || b.created_at);
            return timeA - timeB;
        });
        
        this.jobsTbody.innerHTML = filteredJobs.map(job => {
            const scheduledAt = job.scheduled_post_at 
                ? new Date(job.scheduled_post_at).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                  })
                : 'Not scheduled';
            
            const preset = job.vibe_preset || job.meta?.vibe_preset || 'Unknown';
            const platforms = job.meta?.platforms || [];
            
            const platformIcons = {
                tiktok: '🎵',
                reels: '📱',
                shorts: '▶️'
            };
            
            const platformsHtml = platforms.map(p => 
                `<span title="${p}">${platformIcons[p] || '📺'}</span>`
            ).join(' ');
            
            // Get failure info if this job is failed
            const failureInfo = this.failureInfoMap?.[job.id];
            
            // Build action buttons
            const actions = [];
            if (job.video_url) {
                actions.push(`<button class="btn btn--ghost btn--sm" onclick="campaignDetailPage.previewVideo('${job.video_url}')" title="Watch Video">▶️</button>`);
            }
            if (job.status === 'failed') {
                // Show failure history button
                actions.push(`<button class="btn btn--ghost btn--sm" onclick="campaignDetailPage.showFailureHistory('${job.id}')" title="View failure history">📋</button>`);
                
                if (failureInfo?.canRetry) {
                    // Can retry - show Requeue button
                    actions.push(`<button class="btn btn--primary btn--sm" onclick="campaignDetailPage.retryJob('${job.id}')">Requeue</button>`);
                } else {
                    // Cannot auto-retry - show Force Retry (with warning)
                    actions.push(`<button class="btn btn--ghost btn--sm btn--warning" onclick="campaignDetailPage.forceRetryJob('${job.id}')" title="Force retry (bypasses policies)">⚠️ Force</button>`);
                }
            }
            
            // Build status cell with failure info
            let statusHtml = this.renderJobStatus(job.status);
            if (job.status === 'failed' && failureInfo) {
                const stepLabel = failureInfo.step ? `@ ${failureInfo.step}` : '';
                const classEmoji = {
                    'transient': '⚡',
                    'dependency': '🔌',
                    'misconfig': '⚙️',
                    'permanent': '🚫',
                    'unknown': '❓'
                }[failureInfo.failureClass] || '❓';
                
                statusHtml += `<div class="failure-info">
                    <span class="failure-info__class" title="${failureInfo.failureClass}">${classEmoji} ${failureInfo.failureClass}</span>
                    ${stepLabel ? `<span class="failure-info__step">${stepLabel}</span>` : ''}
                    <span class="failure-info__attempts">#${failureInfo.attemptCount || 1}</span>
                </div>`;
            }
            
            return `
                <tr class="${job.status === 'failed' ? 'job-row--failed' : ''}">
                    <td>${scheduledAt}</td>
                    <td>${this.formatPresetName(preset)}</td>
                    <td>${platformsHtml || '-'}</td>
                    <td>${statusHtml}</td>
                    <td class="job-actions">
                        ${actions.length ? actions.join(' ') : '-'}
                    </td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Render job status badge
     */
    renderJobStatus(status) {
        const statusClasses = {
            pending: 'job-status--pending',
            processing: 'job-status--processing',
            complete: 'job-status--completed',
            completed: 'job-status--completed',
            failed: 'job-status--failed',
            cancelled: 'job-status--cancelled'
        };
        
        const displayNames = {
            pending: 'Pending',
            processing: 'Processing',
            complete: 'Complete',
            completed: 'Complete',
            failed: 'Failed',
            cancelled: 'Cancelled'
        };
        
        return `<span class="job-status ${statusClasses[status] || ''}">${displayNames[status] || status}</span>`;
    }

    /**
     * Format preset name
     */
    formatPresetName(preset) {
        return preset.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    /**
     * Confirm action before executing
     */
    confirmAction(action) {
        const messages = {
            pause: {
                title: 'Pause Campaign?',
                message: 'Pending jobs will not be executed until the campaign is resumed. Jobs currently processing will complete.'
            },
            resume: {
                title: 'Resume Campaign?',
                message: 'Pending jobs will begin executing according to their scheduled times.'
            },
            cancel: {
                title: 'Cancel Campaign?',
                message: 'This will cancel all pending jobs. Completed jobs will not be affected. This action cannot be undone.'
            }
        };
        
        const config = messages[action];
        if (!config) return;
        
        this.confirmTitle.textContent = config.title;
        this.confirmMessage.textContent = config.message;
        this.confirmCallback = () => this.executeAction(action);
        
        this.openModal();
    }

    /**
     * Execute confirmed action
     */
    async executeConfirmedAction() {
        this.closeModal();
        
        if (this.confirmCallback) {
            await this.confirmCallback();
            this.confirmCallback = null;
        }
    }

    /**
     * Execute campaign action
     */
    async executeAction(action) {
        try {
            if (typeof campaignManager === 'undefined') {
                throw new Error('Campaign manager not available');
            }
            
            switch (action) {
                case 'pause':
                    await campaignManager.pauseCampaign(this.campaignId);
                    this.showToast('Campaign paused', 'success');
                    break;
                case 'resume':
                    await campaignManager.resumeCampaign(this.campaignId);
                    this.showToast('Campaign resumed', 'success');
                    break;
                case 'cancel':
                    await campaignManager.cancelCampaign(this.campaignId, true);
                    this.showToast('Campaign cancelled', 'success');
                    break;
            }
            
            // Reload data
            await this.loadCampaign();
            
        } catch (error) {
            console.error(`Failed to ${action} campaign:`, error);
            this.showToast(`Failed to ${action} campaign: ${error.message}`, 'error');
        }
    }

    /**
     * Retry a failed job using the DLQ requeue RPC
     * Uses proper backoff and respects retry policies
     */
    async retryJob(jobId, force = false) {
        try {
            // Call the requeue_failed_job RPC
            const { data, error } = await supabaseClient
                .rpc('requeue_failed_job', {
                    p_job_id: jobId,
                    p_force: force
                });
            
            if (error) throw error;
            
            // Check RPC response
            if (!data?.success) {
                // RPC returned an error condition
                const errorMsg = data?.error || 'Unknown error';
                const recommendation = data?.recommendation;
                
                if (recommendation) {
                    this.showToast(`Cannot retry: ${errorMsg}. ${recommendation}`, 'error');
                } else {
                    this.showToast(`Cannot retry: ${errorMsg}`, 'error');
                }
                return;
            }
            
            // Success - show when job will run
            const generateBy = data.generate_by ? new Date(data.generate_by) : null;
            const now = new Date();
            
            if (generateBy && generateBy > now) {
                const waitMinutes = Math.round((generateBy - now) / 60000);
                this.showToast(`Job requeued (attempt #${data.attempt_count}). Will retry in ~${waitMinutes} min`, 'success');
            } else {
                this.showToast(`Job requeued for immediate retry (attempt #${data.attempt_count})`, 'success');
            }
            
            await this.loadCampaign();
            
        } catch (error) {
            console.error('Failed to retry job:', error);
            this.showToast(`Failed to retry job: ${error.message}`, 'error');
        }
    }

    /**
     * Force retry a job, bypassing retry policies
     * Used for permanent/misconfig errors when admin wants to override
     */
    async forceRetryJob(jobId) {
        if (!confirm('Force retry bypasses retry policies. The job may fail again immediately. Continue?')) {
            return;
        }
        await this.retryJob(jobId, true);
    }

    /**
     * Show failure history for a job in a modal/panel
     */
    async showFailureHistory(jobId) {
        const failures = await this.getJobFailures(jobId);
        
        if (failures.length === 0) {
            this.showToast('No failure history found', 'info');
            return;
        }
        
        // Build failure history HTML
        const failuresHtml = failures.map((f, i) => {
            const time = new Date(f.created_at).toLocaleString();
            const classEmoji = {
                'transient': '⚡',
                'dependency': '🔌',
                'misconfig': '⚙️',
                'permanent': '🚫',
                'unknown': '❓'
            }[f.failure_class] || '❓';
            
            return `
                <div class="failure-entry">
                    <div class="failure-entry__header">
                        <span class="failure-entry__num">#${failures.length - i}</span>
                        <span class="failure-entry__step">@ ${f.step_name}</span>
                        <span class="failure-entry__class">${classEmoji} ${f.failure_class}</span>
                        <span class="failure-entry__time">${time}</span>
                    </div>
                    <div class="failure-entry__body">
                        <div class="failure-entry__error">${this.escapeHtml(f.error_message || 'No error message')}</div>
                        ${f.error_signature ? `<div class="failure-entry__signature">Signature: ${f.error_signature}</div>` : ''}
                        <div class="failure-entry__meta">
                            Job attempt: ${f.job_attempt_number} | Step attempt: ${f.step_attempt_number}
                            ${f.retry_eligible ? ' | ✅ Retryable' : ' | ❌ Not retryable'}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        // Show in modal
        this.confirmTitle.textContent = '📋 Failure History';
        this.confirmMessage.innerHTML = `
            <div class="failure-history">
                <div class="failure-history__summary">
                    Total failures: ${failures.length}
                </div>
                <div class="failure-history__list">
                    ${failuresHtml}
                </div>
            </div>
        `;
        
        // Hide confirm button, just show close
        this.confirmOkBtn.classList.add('hidden');
        this.confirmCancelBtn.textContent = 'Close';
        
        this.confirmCallback = null;
        this.openModal();
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Preview video in modal or new tab
     */
    previewVideo(videoUrl) {
        if (!videoUrl) {
            this.showToast('No video available', 'warning');
            return;
        }
        
        // Open in new tab for now (can add modal player later)
        window.open(videoUrl, '_blank');
    }

    /**
     * Open modal
     */
    openModal() {
        this.confirmModal?.classList.add('active');
    }

    /**
     * Close modal and reset state
     */
    closeModal() {
        this.confirmModal?.classList.remove('active');
        
        // Reset confirm button visibility and text (in case failure history changed it)
        this.confirmOkBtn?.classList.remove('hidden');
        if (this.confirmCancelBtn) {
            this.confirmCancelBtn.textContent = 'Cancel';
        }
    }

    /**
     * Start auto-refresh for active campaigns
     */
    startAutoRefresh() {
        // Clear existing interval
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        // Auto-refresh if campaign is active OR any jobs are still processing
        const hasProcessingJobs = this.jobs?.some(j => 
            ['pending', 'queued', 'generating', 'assembling', 'rendering'].includes(j.status)
        );
        
        if (this.campaign?.status === 'active' || this.campaign?.status === 'processing' || hasProcessingJobs) {
            console.log('📡 Starting auto-refresh (30s interval)');
            this.refreshInterval = setInterval(() => {
                console.log('📡 Auto-refreshing campaign data...');
                this.loadCampaign();
            }, 15000); // Refresh every 15 seconds when jobs are processing
        }
    }

    /**
     * Stop auto-refresh
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    /**
     * Setup real-time subscriptions for live updates
     */
    setupRealtimeSubscriptions() {
        if (typeof supabaseClient === 'undefined') {
            console.warn('Supabase client not available for real-time');
            this.updateRealtimeIndicator(false);
            return;
        }
        
        console.log('📡 Setting up real-time subscriptions...');
        
        // Subscribe to campaign changes
        this.campaignSubscription = supabaseClient
            .channel(`campaign-${this.campaignId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'generation_batches',
                filter: `id=eq.${this.campaignId}`
            }, (payload) => {
                console.log('📡 Campaign updated:', payload);
                if (payload.new) {
                    this.campaign = payload.new;
                    this.renderCampaign();
                }
            })
            .subscribe((status) => {
                console.log('📡 Campaign subscription status:', status);
                this.updateRealtimeIndicator(status === 'SUBSCRIBED');
            });
        
        // Subscribe to job changes for this campaign
        this.jobsSubscription = supabaseClient
            .channel(`jobs-${this.campaignId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'jobs',
                filter: `batch_id=eq.${this.campaignId}`
            }, (payload) => {
                console.log('📡 Job updated:', payload);
                this.handleJobUpdate(payload);
            })
            .subscribe();
        
        console.log('✅ Real-time subscriptions active');
    }

    /**
     * Update the real-time indicator in the UI
     */
    updateRealtimeIndicator(connected) {
        const indicator = document.getElementById('realtime-indicator');
        if (indicator) {
            if (connected) {
                indicator.textContent = '🟢 LIVE';
                indicator.classList.add('connected');
                indicator.title = 'Live updates active - logs will appear automatically';
            } else {
                indicator.textContent = '⚫ OFFLINE';
                indicator.classList.remove('connected');
                indicator.title = 'Live updates unavailable - use refresh button';
            }
        }
    }

    /**
     * Subscribe to logs for a specific job
     */
    subscribeToJobLogs(jobId) {
        // Unsubscribe from previous job logs
        if (this.logsSubscription) {
            supabaseClient.removeChannel(this.logsSubscription);
            this.logsSubscription = null;
        }
        
        if (!jobId || typeof supabaseClient === 'undefined') return;
        
        console.log(`📡 Subscribing to logs for job ${jobId}`);
        
        this.logsSubscription = supabaseClient
            .channel(`logs-${jobId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'job_step_logs',
                filter: `job_id=eq.${jobId}`
            }, (payload) => {
                console.log('📡 New log entry:', payload);
                if (payload.new) {
                    // Add to current logs and re-render
                    this.currentLogs.push(payload.new);
                    this.renderStepTimeline(this.currentLogs);
                    this.renderLogs();
                }
            })
            .subscribe();
    }

    /**
     * Handle real-time job updates
     */
    handleJobUpdate(payload) {
        const { eventType, new: newJob, old: oldJob } = payload;
        
        if (eventType === 'INSERT') {
            // New job added
            this.jobs.push(newJob);
        } else if (eventType === 'UPDATE') {
            // Update existing job
            const index = this.jobs.findIndex(j => j.id === newJob.id);
            if (index !== -1) {
                this.jobs[index] = newJob;
            }
            
            // If this is the currently selected job, update the step timeline
            if (this.selectedJobId === newJob.id) {
                this.renderStepTimeline(this.currentLogs, newJob.status);
            }
        } else if (eventType === 'DELETE') {
            // Remove job
            this.jobs = this.jobs.filter(j => j.id !== oldJob.id);
        }
        
        // Re-render jobs and update stats
        this.renderJobs();
        this.populateJobSelect();
        this.updateStats();
        this.updateProgress();
    }

    /**
     * Cleanup all subscriptions
     */
    cleanupSubscriptions() {
        if (this.campaignSubscription) {
            supabaseClient.removeChannel(this.campaignSubscription);
            this.campaignSubscription = null;
        }
        if (this.jobsSubscription) {
            supabaseClient.removeChannel(this.jobsSubscription);
            this.jobsSubscription = null;
        }
        if (this.logsSubscription) {
            supabaseClient.removeChannel(this.logsSubscription);
            this.logsSubscription = null;
        }
        console.log('📡 Real-time subscriptions cleaned up');
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        if (typeof toast !== 'undefined') {
            toast[type]?.(message) || toast.show?.(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
            alert(message);
        }
    }

    // ==========================================
    // JOB LOGS SECTION
    // ==========================================

    /**
     * Pipeline steps in order
     */
    get pipelineSteps() {
        return ['story', 'uniqueness', 'scenes', 'voice', 'music', 'images', 'subtitles', 'assemble', 'upload', 'schedule'];
    }

    /**
     * Populate job select dropdown with jobs from current campaign
     */
    populateJobSelect() {
        if (!this.logJobSelect || !this.jobs?.length) return;
        
        // Clear existing options
        this.logJobSelect.innerHTML = '<option value="">Select a job to view logs...</option>';
        
        // Sort jobs by created_at descending (newest first)
        const sortedJobs = [...this.jobs].sort((a, b) => 
            new Date(b.created_at) - new Date(a.created_at)
        );
        
        // Add job options
        sortedJobs.forEach((job, index) => {
            const option = document.createElement('option');
            option.value = job.id;
            const statusIcon = this.getJobStatusIcon(job.status);
            const title = job.story_seed?.substring(0, 40) || `Job ${index + 1}`;
            option.textContent = `${statusIcon} ${title}${title.length >= 40 ? '...' : ''} (${job.status})`;
            this.logJobSelect.appendChild(option);
        });
    }

    /**
     * Get status icon for job
     */
    getJobStatusIcon(status) {
        const icons = {
            pending: '⏳',
            processing: '⚡',
            complete: '✅',
            failed: '❌',
            cancelled: '🚫'
        };
        return icons[status] || '❓';
    }

    /**
     * Load logs for a specific job
     */
    async loadJobLogs(jobId) {
        if (!jobId) {
            this.currentLogs = [];
            this.selectedJobId = null;
            this.renderStepTimeline([]);
            this.renderLogs();
            // Unsubscribe from logs
            if (this.logsSubscription) {
                supabaseClient.removeChannel(this.logsSubscription);
                this.logsSubscription = null;
            }
            return;
        }
        
        this.selectedJobId = jobId;
        
        // Subscribe to real-time log updates for this job
        this.subscribeToJobLogs(jobId);
        
        // Show loading state
        if (this.logsContent) {
            this.logsContent.innerHTML = '<div class="log-entry log-entry--info"><span class="log-entry__message">Loading logs...</span></div>';
        }
        
        try {
            // Try the RPC first
            const { data, error } = await supabaseClient.rpc('get_job_step_logs', { p_job_id: jobId });
            
            if (error) throw error;
            
            this.currentLogs = data || [];
            
            // Get current job status to handle completed jobs with incomplete logs
            const currentJob = this.jobs?.find(j => j.id === jobId);
            this.renderStepTimeline(this.currentLogs, currentJob?.status);
            this.renderLogs();
            
        } catch (error) {
            console.error('Failed to load job logs:', error);
            
            // Fallback: direct query
            try {
                const { data, error: queryError } = await supabaseClient
                    .from('job_step_logs')
                    .select('*')
                    .eq('job_id', jobId)
                    .order('created_at', { ascending: true });
                
                if (queryError) throw queryError;
                
                this.currentLogs = data || [];
                
                // Get current job status to handle completed jobs with incomplete logs
                const currentJob = this.jobs?.find(j => j.id === jobId);
                this.renderStepTimeline(this.currentLogs, currentJob?.status);
                this.renderLogs();
                
            } catch (fallbackError) {
                console.error('Fallback query also failed:', fallbackError);
                this.currentLogs = [];
                if (this.logsContent) {
                    this.logsContent.innerHTML = '<div class="log-entry log-entry--error"><span class="log-entry__message">Failed to load logs. Check console for details.</span></div>';
                }
            }
        }
    }

    /**
     * Render the step timeline visualization
     * @param {Array} logs - The step logs
     * @param {string} jobStatus - The overall job status (complete, failed, etc)
     */
    renderStepTimeline(logs, jobStatus = null) {
        if (!this.stepTimeline) return;
        
        // If job is complete/completed, mark all steps as completed
        const jobIsComplete = jobStatus === 'complete' || jobStatus === 'completed';
        
        // Build step status map
        const stepStatus = {};
        const stepDuration = {};
        
        logs.forEach(log => {
            const step = log.step_name;
            if (!step) return;
            
            // Track latest status per step (database uses event_type, not log_type)
            const eventType = log.event_type || log.log_type;
            if (eventType === 'completed') {
                stepStatus[step] = 'completed';
                if (log.meta?.duration_ms || log.duration_ms) {
                    stepDuration[step] = log.meta?.duration_ms || log.duration_ms;
                }
            } else if (eventType === 'started' && !stepStatus[step]) {
                stepStatus[step] = 'running';
            } else if (eventType === 'failed') {
                stepStatus[step] = 'failed';
            }
        });
        
        // If job is complete but some steps show as running/pending, mark them complete
        // This handles cases where the worker timed out but the video-renderer succeeded
        if (jobIsComplete) {
            this.pipelineSteps.forEach(step => {
                if (!stepStatus[step] || stepStatus[step] === 'running' || stepStatus[step] === 'pending') {
                    stepStatus[step] = 'completed';
                }
            });
        }
        
        // Generate timeline HTML using CSS classes
        const timelineHtml = this.pipelineSteps.map((step, index) => {
            const status = stepStatus[step] || 'pending';
            const duration = stepDuration[step];
            const durationText = duration ? this.formatDuration(duration) : '';
            
            const statusIcons = {
                pending: '⏸',
                running: '⚡',
                completed: '✓',
                failed: '✕'
            };
            
            const nextStep = this.pipelineSteps[index + 1];
            const nextStatus = nextStep ? (stepStatus[nextStep] || 'pending') : null;
            const connectorActive = status === 'completed' || status === 'running';
            
            return `
                <div class="step-timeline__step step-timeline__step--${status} ${this.selectedStepName === step ? 'step-timeline__step--selected' : ''}" 
                     title="Click for ${step} details${durationText ? ` (${durationText})` : ''}"
                     data-step="${step}" onclick="window.campaignDetailPage.openStepDetail('${step}')">
                    <div class="step-timeline__icon">${statusIcons[status]}</div>
                    <div class="step-timeline__name">${step}</div>
                    ${durationText ? `<div class="step-timeline__duration">${durationText}</div>` : ''}
                </div>
                ${nextStep ? `<div class="step-timeline__connector ${connectorActive ? 'step-timeline__connector--active' : ''}">→</div>` : ''}
            `;
        }).join('');
        
        this.stepTimeline.innerHTML = timelineHtml || '<div class="step-timeline__empty">Select a job to view pipeline status</div>';
    }

    // ==========================================
    // STEP DETAIL PANEL
    // ==========================================

    /**
     * Open the detail panel for a clicked step
     */
    async openStepDetail(stepName) {
        if (!this.selectedJobId) return;
        
        this.selectedStepName = stepName;
        
        // Re-render timeline to show selection
        const currentJob = this.jobs?.find(j => j.id === this.selectedJobId);
        this.renderStepTimeline(this.currentLogs, currentJob?.status);
        
        // Show panel with loading state
        if (this.stepDetailPanel) this.stepDetailPanel.style.display = 'block';
        if (this.stepDetailTitle) this.stepDetailTitle.textContent = `${this.getStepIcon(stepName)} ${this.capitalize(stepName)} Details`;
        if (this.stepDetailContent) this.stepDetailContent.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary)">Loading step data...</div>';
        
        try {
            // Gather all data for this step from logs + job + assets
            const stepData = await this.gatherStepData(stepName);
            this.renderStepDetail(stepName, stepData);
        } catch (err) {
            console.error(`Failed to load ${stepName} details:`, err);
            if (this.stepDetailContent) this.stepDetailContent.innerHTML = `<div style="color:var(--color-error)">Failed to load step details: ${err.message}</div>`;
        }
    }

    /**
     * Close the step detail panel
     */
    closeStepDetail() {
        this.selectedStepName = null;
        if (this.stepDetailPanel) this.stepDetailPanel.style.display = 'none';
        // Re-render timeline to remove selection
        const currentJob = this.jobs?.find(j => j.id === this.selectedJobId);
        this.renderStepTimeline(this.currentLogs, currentJob?.status);
    }

    /**
     * Gather all relevant data for a step from logs, job data, and assets
     */
    async gatherStepData(stepName) {
        const supabase = window.supabaseClient || (typeof getSupabaseClient === 'function' ? getSupabaseClient() : null);
        if (!supabase) throw new Error('Supabase client not available');
        
        const jobId = this.selectedJobId;
        const data = { snapshots: [], progress: [], status: null, duration: null, error: null };
        
        // Extract step-specific logs
        this.currentLogs.forEach(log => {
            if (log.step_name !== stepName) return;
            const eventType = log.event_type || log.log_type;
            if (eventType === 'snapshot') data.snapshots.push(log);
            if (eventType === 'progress') data.progress.push(log);
            if (eventType === 'completed') {
                data.status = 'completed';
                data.duration = log.meta?.duration_ms || log.duration_ms;
            }
            if (eventType === 'failed') {
                data.status = 'failed';
                data.error = log.message || log.meta?.error;
            }
        });
        if (!data.status) {
            const started = this.currentLogs.find(l => l.step_name === stepName && (l.event_type === 'started' || l.log_type === 'started'));
            if (started) data.status = 'running';
        }
        
        // Load job record for story_text, title, meta, etc.
        const { data: jobRecord } = await supabase
            .from('jobs')
            .select('*')
            .eq('id', jobId)
            .single();
        data.job = jobRecord;
        
        // Load step status record (has per-step metadata)
        try {
            const { data: stepStatus } = await supabase
                .from('job_step_status')
                .select('*')
                .eq('job_id', jobId)
                .eq('step_name', stepName)
                .single();
            data.stepMeta = stepStatus?.meta || stepStatus?.step_meta || {};
        } catch { data.stepMeta = {}; }
        
        // Load assets for specific steps
        if (['images', 'voice', 'music', 'subtitles', 'assemble'].includes(stepName)) {
            const prefix = stepName === 'images' ? `${jobId}:image_generate` 
                         : stepName === 'voice' ? `${jobId}:voice`
                         : stepName === 'music' ? `${jobId}:music`
                         : stepName === 'subtitles' ? `${jobId}:subtitle`
                         : `${jobId}:assemble`;
            
            const { data: assets } = await supabase
                .from('job_assets')
                .select('*')
                .eq('job_id', jobId)
                .like('idempotency_key', `${prefix}%`)
                .order('created_at', { ascending: true });
            data.assets = assets || [];
        }
        
        // Load scenes data
        if (['scenes', 'images'].includes(stepName)) {
            const { data: scenesAsset } = await supabase
                .from('job_assets')
                .select('*')
                .eq('job_id', jobId)
                .eq('idempotency_key', `${jobId}:scenes_subtitles`)
                .single();
            data.scenesData = scenesAsset?.meta?.scenes || [];
        }
        
        return data;
    }

    /**
     * Render the detail panel content based on step type
     */
    renderStepDetail(stepName, data) {
        if (!this.stepDetailContent) return;
        
        const statusBadge = data.status 
            ? `<span class="step-detail__badge step-detail__badge--${data.status === 'completed' ? 'success' : data.status === 'failed' ? 'error' : 'warning'}">${data.status}</span>`
            : '';
        const durationText = data.duration ? this.formatDuration(data.duration) : '';
        
        let html = `<div class="step-detail__section">
            <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
                ${statusBadge}
                ${durationText ? `<span style="font-size:12px;color:var(--text-secondary)">Duration: ${durationText}</span>` : ''}
            </div>
        </div>`;
        
        // Step-specific content
        switch (stepName) {
            case 'story': html += this.renderStoryDetail(data); break;
            case 'uniqueness': html += this.renderUniquenessDetail(data); break;
            case 'scenes': html += this.renderScenesDetail(data); break;
            case 'voice': html += this.renderVoiceDetail(data); break;
            case 'music': html += this.renderMusicDetail(data); break;
            case 'images': html += this.renderImagesDetail(data); break;
            case 'subtitles': html += this.renderSubtitlesDetail(data); break;
            case 'assemble': html += this.renderAssembleDetail(data); break;
            case 'upload': html += this.renderUploadDetail(data); break;
            case 'schedule': html += this.renderScheduleDetail(data); break;
            default: html += this.renderGenericDetail(data); break;
        }
        
        // Show error if failed
        if (data.error) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">⚠️ Error</div>
                <div class="step-detail__pre" style="border-color:var(--color-error);color:var(--color-error)">${this.escapeHtml(data.error)}</div>
            </div>`;
        }
        
        // Show raw snapshots toggle
        if (data.snapshots.length > 0) {
            html += `<details style="margin-top:12px">
                <summary style="font-size:12px;color:var(--text-secondary);cursor:pointer">📋 Raw Snapshots (${data.snapshots.length})</summary>
                <div class="step-detail__pre" style="margin-top:8px">${this.escapeHtml(JSON.stringify(data.snapshots.map(s => ({ label: s.message, meta: s.meta || s.details })), null, 2))}</div>
            </details>`;
        }
        
        this.stepDetailContent.innerHTML = html;
    }

    // === Per-Step Detail Renderers ===

    renderStoryDetail(data) {
        const job = data.job || {};
        const promptSnapshot = data.snapshots.find(s => s.message?.includes('prompt'));
        const responseSnapshot = data.snapshots.find(s => s.message?.includes('Generated') || s.message?.includes('response'));
        const promptText = promptSnapshot?.meta?.data || promptSnapshot?.details || '';
        const storyPreview = responseSnapshot?.meta?.story_preview || responseSnapshot?.meta?.data?.story_preview || '';
        const wordCount = responseSnapshot?.meta?.word_count || responseSnapshot?.meta?.data?.word_count || job.story_word_count || '';
        
        let html = '';
        
        // Story settings
        html += `<div class="step-detail__section">
            <div class="step-detail__label">📋 Settings</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Vibe Preset</span>
                <span class="step-detail__kv-val">${job.vibe_preset || job.meta?.vibe_preset || '-'}</span>
                <span class="step-detail__kv-key">Duration</span>
                <span class="step-detail__kv-val">${job.meta?.duration || job.meta?.length_preset || '-'}s</span>
                <span class="step-detail__kv-key">Word Count</span>
                <span class="step-detail__kv-val">${wordCount || '-'} words</span>
                <span class="step-detail__kv-key">Model</span>
                <span class="step-detail__kv-val">gpt-4o</span>
            </div>
        </div>`;
        
        // Story title & text
        if (job.title || job.story_text) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">📖 Story: ${this.escapeHtml(job.title || 'Untitled')}</div>
                <div class="step-detail__story">${this.escapeHtml(job.story_text || 'No story text available')}</div>
            </div>`;
        }
        
        // Prompt used
        if (promptText) {
            const promptStr = typeof promptText === 'object' ? JSON.stringify(promptText, null, 2) : promptText;
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🧠 Story Prompt</div>
                <div class="step-detail__pre">${this.escapeHtml(promptStr)}</div>
            </div>`;
        }
        
        return html;
    }

    renderUniquenessDetail(data) {
        const job = data.job || {};
        const meta = data.stepMeta || {};
        const score = job.uniqueness_score ?? meta.uniqueness_score ?? '-';
        
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🔍 Uniqueness Score</div>
            <div style="font-size:32px;font-weight:700;color:${score >= 70 ? '#10B981' : score >= 40 ? '#F59E0B' : '#EF4444'}">${score}%</div>
        </div>`;
        
        if (meta.similar_count !== undefined) {
            html += `<div class="step-detail__section">
                <div class="step-detail__kv-grid">
                    <span class="step-detail__kv-key">Similar Stories Found</span>
                    <span class="step-detail__kv-val">${meta.similar_count || 0}</span>
                    <span class="step-detail__kv-key">Threshold</span>
                    <span class="step-detail__kv-val">${meta.threshold || 'default'}</span>
                </div>
            </div>`;
        }
        
        return html;
    }

    renderScenesDetail(data) {
        const scenes = data.scenesData || [];
        const job = data.job || {};
        
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🎬 Scene Breakdown (${scenes.length} scenes)</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Scene Count</span>
                <span class="step-detail__kv-val">${scenes.length}</span>
                <span class="step-detail__kv-key">Duration</span>
                <span class="step-detail__kv-val">${job.meta?.duration || '60'}s</span>
                <span class="step-detail__kv-key">Pace</span>
                <span class="step-detail__kv-val">${job.meta?.pace || 'balanced'}</span>
            </div>
        </div>`;
        
        if (scenes.length > 0) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">📝 Scenes</div>
                <div style="max-height:300px;overflow-y:auto">
                    ${scenes.map((s, i) => `
                        <div style="padding:8px;margin-bottom:4px;background:var(--bg-primary);border-radius:4px;border-left:3px solid var(--color-primary);font-size:12px">
                            <strong style="color:var(--text-secondary)">Scene ${i + 1}</strong> <span style="color:var(--text-secondary);font-size:11px">(${(s.startTime || 0).toFixed(1)}s - ${(s.endTime || 0).toFixed(1)}s)</span>
                            <div style="margin-top:4px;color:var(--text-primary)">${this.escapeHtml((s.text || '').substring(0, 200))}${(s.text || '').length > 200 ? '...' : ''}</div>
                            ${s.keywords?.length ? `<div style="margin-top:4px;font-size:11px;color:var(--text-secondary)">Keywords: ${s.keywords.join(', ')}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>`;
        }
        
        return html;
    }

    renderVoiceDetail(data) {
        const payloadSnap = data.snapshots.find(s => s.message?.includes('request') || s.message?.includes('payload'));
        const resultSnap = data.snapshots.find(s => s.message?.includes('result') || s.message?.includes('response'));
        const payload = payloadSnap?.meta || payloadSnap?.details || {};
        const result = resultSnap?.meta || resultSnap?.details || {};
        const payloadData = payload.data || payload;
        const resultData = result.data || result;
        
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🎙️ Voice Configuration</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Voice ID</span>
                <span class="step-detail__kv-val">${payloadData.voice_id || '-'}</span>
                <span class="step-detail__kv-key">Model</span>
                <span class="step-detail__kv-val">${payloadData.model || payloadData.model_id || 'eleven_turbo_v2'}</span>
                <span class="step-detail__kv-key">Stability</span>
                <span class="step-detail__kv-val">${payloadData.stability ?? '-'}</span>
                <span class="step-detail__kv-key">Similarity</span>
                <span class="step-detail__kv-val">${payloadData.similarity_boost ?? '-'}</span>
            </div>
        </div>`;
        
        if (resultData.duration_seconds || resultData.file_size_kb) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">📊 Output</div>
                <div class="step-detail__kv-grid">
                    <span class="step-detail__kv-key">Audio Duration</span>
                    <span class="step-detail__kv-val">${resultData.duration_seconds ? resultData.duration_seconds.toFixed(1) + 's' : '-'}</span>
                    <span class="step-detail__kv-key">File Size</span>
                    <span class="step-detail__kv-val">${resultData.file_size_kb ? resultData.file_size_kb + ' KB' : '-'}</span>
                </div>
            </div>`;
        }
        
        // Audio player if we have the URL
        const voiceAsset = data.assets?.find(a => a.public_url);
        if (voiceAsset?.public_url) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🔊 Audio Preview</div>
                <audio controls style="width:100%;margin-top:4px" src="${voiceAsset.public_url}">Your browser does not support audio</audio>
            </div>`;
        }
        
        return html;
    }

    renderMusicDetail(data) {
        const outputSnap = data.snapshots.find(s => s.message?.includes('Selected') || s.message?.includes('output'));
        const snapData = outputSnap?.meta?.data || outputSnap?.meta || {};
        
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🎵 Track Selection</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Track</span>
                <span class="step-detail__kv-val">${snapData.track_name || snapData.selected_track || '-'}</span>
                <span class="step-detail__kv-key">Volume</span>
                <span class="step-detail__kv-val">${snapData.volume ?? snapData.ducking_volume ?? '-'}</span>
                <span class="step-detail__kv-key">Fade In</span>
                <span class="step-detail__kv-val">${snapData.fade_in_ms ? snapData.fade_in_ms + 'ms' : '-'}</span>
                <span class="step-detail__kv-key">Fade Out</span>
                <span class="step-detail__kv-val">${snapData.fade_out_ms ? snapData.fade_out_ms + 'ms' : '-'}</span>
            </div>
        </div>`;
        
        return html;
    }

    renderImagesDetail(data) {
        const promptSnap = data.snapshots.find(s => s.message?.includes('prompt'));
        const promptData = promptSnap?.meta?.data || promptSnap?.meta || {};
        const assets = data.assets || [];
        const progress = data.progress || [];
        
        const imageAssets = assets
            .filter(a => a.public_url && a.idempotency_key?.includes('image_generate'))
            .sort((a, b) => {
                const aIdx = parseInt(a.idempotency_key?.split('scene_')[1] || '0');
                const bIdx = parseInt(b.idempotency_key?.split('scene_')[1] || '0');
                return aIdx - bIdx;
            });
        
        const totalScenes = data.stepMeta?.total_scenes || progress[progress.length - 1]?.meta?.total || imageAssets.length || '?';
        
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🖼️ Image Generation</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Model</span>
                <span class="step-detail__kv-val">${promptData.model || data.stepMeta?.image_model || '-'}</span>
                <span class="step-detail__kv-key">Size</span>
                <span class="step-detail__kv-val">${promptData.size || '-'}</span>
                <span class="step-detail__kv-key">Generated</span>
                <span class="step-detail__kv-val">${imageAssets.length} / ${totalScenes}</span>
            </div>
        </div>`;
        
        // Sample prompt
        if (promptData.prompt) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🧠 Sample Prompt (Scene ${(promptData.scene_index || 0) + 1})</div>
                <div class="step-detail__pre">${this.escapeHtml(promptData.prompt)}</div>
            </div>`;
        }
        
        // Image grid
        if (imageAssets.length > 0) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎨 Generated Images (${imageAssets.length})</div>
                <div class="step-detail__image-grid">
                    ${imageAssets.map((a, i) => {
                        const sceneIdx = parseInt(a.idempotency_key?.split('scene_')[1] || i);
                        return `<div class="step-detail__image-item" onclick="window.open('${a.public_url}', '_blank')">
                            <img src="${a.public_url}" alt="Scene ${sceneIdx + 1}" loading="lazy">
                            <div class="step-detail__image-item__label">Scene ${sceneIdx + 1}</div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }
        
        // Progress log
        if (progress.length > 0) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">📈 Progress (${progress.length} updates)</div>
                <div style="max-height:200px;overflow-y:auto;font-size:12px">
                    ${progress.map(p => {
                        const time = new Date(p.created_at).toLocaleTimeString();
                        return `<div style="padding:2px 0;color:var(--text-secondary)">${time} — ${p.message || ''}</div>`;
                    }).join('')}
                </div>
            </div>`;
        }
        
        return html;
    }

    renderSubtitlesDetail(data) {
        const job = data.job || {};
        
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">📝 Subtitle Configuration</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Caption Style</span>
                <span class="step-detail__kv-val">${job.meta?.caption_style || 'default'}</span>
                <span class="step-detail__kv-key">Platform</span>
                <span class="step-detail__kv-val">${job.meta?.platform || '-'}</span>
            </div>
        </div>`;
        
        return html;
    }

    renderAssembleDetail(data) {
        const payloadSnap = data.snapshots.find(s => s.message?.includes('payload'));
        const outputSnap = data.snapshots.find(s => s.message?.includes('output') || s.message?.includes('complete'));
        const payload = payloadSnap?.meta?.data || payloadSnap?.meta || {};
        const output = outputSnap?.meta?.data || outputSnap?.meta || {};
        
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🔧 Assembly Configuration</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Renderer</span>
                <span class="step-detail__kv-val">${payload.renderer_url ? 'Video Renderer' : 'N/A'}</span>
                <span class="step-detail__kv-key">Scenes</span>
                <span class="step-detail__kv-val">${payload.scene_count || payload.total_scenes || '-'}</span>
                <span class="step-detail__kv-key">Effects Mode</span>
                <span class="step-detail__kv-val">${payload.effects_mode || data.job?.meta?.effects_mode || '-'}</span>
            </div>
        </div>`;
        
        if (output.video_url || output.render_url) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎬 Output Video</div>
                <video controls style="width:100%;max-height:300px;border-radius:6px;background:#000" src="${output.video_url || output.render_url}"></video>
            </div>`;
        }
        
        return html;
    }

    renderUploadDetail(data) {
        const outputSnap = data.snapshots.find(s => s.message?.includes('output'));
        const output = outputSnap?.meta?.data || outputSnap?.meta || {};
        
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">☁️ Upload Details</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Final URL</span>
                <span class="step-detail__kv-val" style="word-break:break-all">${output.final_url || output.video_url || data.job?.video_url || '-'}</span>
                <span class="step-detail__kv-key">File Size</span>
                <span class="step-detail__kv-val">${output.file_size ? (output.file_size / 1024 / 1024).toFixed(1) + ' MB' : '-'}</span>
            </div>
        </div>`;
        
        return html;
    }

    renderScheduleDetail(data) {
        const outputSnap = data.snapshots.find(s => s.message?.includes('output'));
        const output = outputSnap?.meta?.data || outputSnap?.meta || {};
        
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">📅 Schedule Details</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Platform</span>
                <span class="step-detail__kv-val">${output.platform || data.job?.meta?.platform || '-'}</span>
                <span class="step-detail__kv-key">Scheduled For</span>
                <span class="step-detail__kv-val">${output.scheduled_at ? new Date(output.scheduled_at).toLocaleString() : '-'}</span>
                <span class="step-detail__kv-key">Post ID</span>
                <span class="step-detail__kv-val">${output.post_id || '-'}</span>
            </div>
        </div>`;
        
        return html;
    }

    renderGenericDetail(data) {
        return `<div class="step-detail__section">
            <div class="step-detail__label">Step Data</div>
            <div class="step-detail__pre">${this.escapeHtml(JSON.stringify(data.stepMeta, null, 2))}</div>
        </div>`;
    }

    // Utility methods for step details
    getStepIcon(step) {
        const icons = { story: '📖', uniqueness: '🔍', scenes: '🎬', voice: '🎙️', music: '🎵', images: '🖼️', subtitles: '📝', assemble: '🔧', upload: '☁️', schedule: '📅' };
        return icons[step] || '⚙️';
    }
    capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
    escapeHtml(str) {
        if (!str) return '';
        if (typeof str !== 'string') str = String(str);
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Format duration from ms to human readable
     */
    formatDuration(ms) {
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        const mins = Math.floor(ms / 60000);
        const secs = Math.floor((ms % 60000) / 1000);
        return `${mins}m ${secs}s`;
    }

    /**
     * Render log entries
     */
    renderLogs() {
        if (!this.logsContent) return;
        
        // Enable/disable copy button based on logs availability
        if (this.btnCopyLogs) {
            this.btnCopyLogs.disabled = !this.currentLogs?.length;
        }
        
        if (!this.currentLogs?.length) {
            this.logsContent.innerHTML = '<div class="log-entry log-entry--info"><span class="log-entry__message">No logs available for this job.</span></div>';
            return;
        }
        
        // Apply filters
        const showSnapshots = this.logShowSnapshots?.checked ?? true;
        const showProgress = this.logShowProgress?.checked ?? true;
        
        const filteredLogs = this.currentLogs.filter(log => {
            const eventType = log.event_type || log.log_type;
            if (!showSnapshots && eventType === 'snapshot') return false;
            if (!showProgress && eventType === 'progress') return false;
            return true;
        });
        
        if (!filteredLogs.length) {
            this.logsContent.innerHTML = '<div class="log-entry log-entry--info"><span class="log-entry__message">No logs match current filters.</span></div>';
            return;
        }
        
        // Render logs
        const logsHtml = filteredLogs.map(log => this.renderLogEntry(log)).join('');
        this.logsContent.innerHTML = logsHtml;
        
        // Auto-scroll to bottom
        this.logsContent.scrollTop = this.logsContent.scrollHeight;
    }

    /**
     * Render a single log entry
     */
    renderLogEntry(log) {
        const timestamp = new Date(log.created_at).toLocaleTimeString();
        const eventType = log.event_type || log.log_type; // Database uses event_type
        const typeLabel = this.getLogTypeLabel(eventType);
        const typeClass = this.getLogTypeClass(eventType);
        
        // Format message - make it more readable
        let message = log.message || '';
        
        // Simplify common messages
        if (eventType === 'started') {
            message = `Starting ${log.step_name || 'step'}...`;
        } else if (eventType === 'completed') {
            const duration = log.meta?.duration_ms ? ` in ${this.formatDuration(log.meta.duration_ms)}` : '';
            message = `✓ Completed${duration}`;
        }
        
        let details = '';
        // Show meta data for non-trivial logs (use 'meta' from db, fallback to 'details')
        const metaData = log.meta || log.details;
        if (metaData && eventType !== 'started' && eventType !== 'completed') {
            try {
                const detailsObj = typeof metaData === 'string' ? JSON.parse(metaData) : metaData;
                // Only show non-empty details
                if (Object.keys(detailsObj).length > 0) {
                    details = `<div class="log-entry__meta">${JSON.stringify(detailsObj, null, 2)}</div>`;
                }
            } catch {
                details = `<div class="log-entry__meta">${metaData}</div>`;
            }
        }
        
        return `
            <div class="log-entry">
                <span class="log-entry__time">${timestamp}</span>
                <span class="log-entry__type log-entry__type--${typeClass}">${typeLabel}</span>
                <span class="log-entry__step">[${log.step_name || 'system'}]</span>
                <span class="log-entry__message">${message}</span>
                ${details}
            </div>
        `;
    }

    /**
     * Get CSS class for log type
     */
    getLogTypeClass(eventType) {
        const classes = {
            'started': 'started',
            'completed': 'completed',
            'progress': 'progress',
            'snapshot': 'snapshot',
            'failed': 'failed',
            'warning': 'warning',
            'info': 'info'
        };
        return classes[eventType] || 'info';
    }

    /**
     * Get human-readable label for log type
     */
    getLogTypeLabel(eventType) {
        const labels = {
            'started': 'STARTED',
            'completed': 'DONE',
            'progress': 'PROGRESS',
            'snapshot': 'SNAPSHOT',
            'failed': 'ERROR',
            'warning': 'WARN',
            'info': 'INFO'
        };
        return labels[eventType] || 'LOG';
    }

    /**
     * Copy logs to clipboard
     */
    async copyLogsToClipboard() {
        if (!this.currentLogs?.length) {
            this.showToast('No logs to copy', 'warning');
            return;
        }
        
        // Format logs for clipboard (use log_line from RPC if available, otherwise format manually)
        const formattedLogs = this.currentLogs.map(log => {
            // RPC provides pre-formatted log_line
            if (log.log_line) {
                return log.log_line;
            }
            
            const time = new Date(log.created_at).toISOString();
            const eventType = log.event_type || 'LOG';
            const step = log.step_name || 'system';
            const message = log.message || eventType;
            let line = `[${time}] [${eventType.toUpperCase()}] [${step}] ${message}`;
            
            if (log.details) {
                try {
                    const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                    line += `\n    ${JSON.stringify(details, null, 2).replace(/\n/g, '\n    ')}`;
                } catch {
                    line += `\n    ${log.details}`;
                }
            }
            
            return line;
        }).join('\n');
        
        try {
            await navigator.clipboard.writeText(formattedLogs);
            this.showToast('Logs copied to clipboard', 'success');
        } catch (error) {
            console.error('Failed to copy logs:', error);
            this.showToast('Failed to copy logs', 'error');
        }
    }

    /**
     * Cleanup on page unload
     */
    destroy() {
        this.stopAutoRefresh();
        this.cleanupSubscriptions();
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize brand switcher in navbar (matches other pages)
    const brandSwitcher = new BrandSwitcher({
        selector: '#brand-switcher'
    });
    brandSwitcher.init();
    
    // Initialize page controller
    window.campaignDetailPage = new CampaignDetailPage();
    window.campaignDetailPage.init();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    window.campaignDetailPage?.destroy();
});
