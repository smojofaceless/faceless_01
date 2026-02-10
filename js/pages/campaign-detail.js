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
            
            this.renderCampaign();
            this.renderJobs();
            this.populateJobSelect();
            
            // Hide loading, show detail
            this.hideAllStates();
            this.campaignDetail.classList.remove('hidden');
            
        } catch (error) {
            console.error('Failed to load campaign:', error);
            this.showNotFoundState();
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
            
            // Build action buttons
            const actions = [];
            if (job.video_url) {
                actions.push(`<button class="btn btn--ghost btn--sm" onclick="campaignDetailPage.previewVideo('${job.video_url}')" title="Watch Video">▶️</button>`);
            }
            if (job.status === 'failed') {
                actions.push(`<button class="btn btn--ghost btn--sm" onclick="campaignDetailPage.retryJob('${job.id}')">Retry</button>`);
            }
            
            return `
                <tr>
                    <td>${scheduledAt}</td>
                    <td>${this.formatPresetName(preset)}</td>
                    <td>${platformsHtml || '-'}</td>
                    <td>${this.renderJobStatus(job.status)}</td>
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
     * Retry a failed job
     */
    async retryJob(jobId) {
        try {
            // Reset job status to pending
            const { error } = await supabaseClient
                .from('jobs')
                .update({ status: 'pending', error_message: null })
                .eq('id', jobId);
            
            if (error) throw error;
            
            this.showToast('Job queued for retry', 'success');
            await this.loadCampaign();
            
        } catch (error) {
            console.error('Failed to retry job:', error);
            this.showToast(`Failed to retry job: ${error.message}`, 'error');
        }
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
     * Close modal
     */
    closeModal() {
        this.confirmModal?.classList.remove('active');
    }

    /**
     * Start auto-refresh for active campaigns
     */
    startAutoRefresh() {
        // Clear existing interval
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        // Only auto-refresh for active campaigns
        if (this.campaign?.status === 'active' || this.campaign?.status === 'processing') {
            this.refreshInterval = setInterval(() => {
                this.loadCampaign();
            }, 30000); // Refresh every 30 seconds
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
                <div class="step-timeline__step step-timeline__step--${status}" title="${step}: ${status}${durationText ? ` (${durationText})` : ''}">
                    <div class="step-timeline__icon">${statusIcons[status]}</div>
                    <div class="step-timeline__name">${step}</div>
                    ${durationText ? `<div class="step-timeline__duration">${durationText}</div>` : ''}
                </div>
                ${nextStep ? `<div class="step-timeline__connector ${connectorActive ? 'step-timeline__connector--active' : ''}">→</div>` : ''}
            `;
        }).join('');
        
        this.stepTimeline.innerHTML = timelineHtml || '<div class="step-timeline__empty">Select a job to view pipeline status</div>';
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
