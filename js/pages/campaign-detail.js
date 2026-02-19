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
        this.cloneBtn = document.getElementById('btn-clone');
        
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
        this.cloneBtn?.addEventListener('click', () => this.cloneCampaign());
        
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
            
            const platformSvgs = {
                youtube_shorts: { icon: `<svg viewBox="0 0 24 24" fill="#FF0000" width="16" height="16"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><polygon fill="#FFF" points="9.545 15.568 15.818 12 9.545 8.432"/></svg>`, label: 'YouTube Shorts' },
                youtube: { icon: `<svg viewBox="0 0 24 24" fill="#FF0000" width="16" height="16"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><polygon fill="#FFF" points="9.545 15.568 15.818 12 9.545 8.432"/></svg>`, label: 'YouTube' },
                tiktok: { icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/></svg>`, label: 'TikTok' },
                instagram_reels: { icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#E4405F" stroke-width="2" width="16" height="16"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`, label: 'Instagram Reels' },
                instagram: { icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#E4405F" stroke-width="2" width="16" height="16"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`, label: 'Instagram' },
                facebook_reels: { icon: `<svg viewBox="0 0 24 24" fill="#1877F2" width="16" height="16"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`, label: 'Facebook Reels' },
                facebook: { icon: `<svg viewBox="0 0 24 24" fill="#1877F2" width="16" height="16"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`, label: 'Facebook' },
                threads: { icon: `<svg viewBox="0 0 192 192" fill="currentColor" width="16" height="16"><path d="M141.537 88.988a66.6 66.6 0 00-2.518-1.143c-1.482-27.307-16.403-42.94-41.457-43.1h-.335c-14.986 0-27.449 6.396-35.12 18.028l13.661 9.427c5.587-8.586 14.217-13.014 21.459-13.014h.118c8.803.052 15.462 2.952 19.809 8.588 3.275 4.253 5.489 9.848 6.605 17.649-6.728-1.189-13.959-1.658-21.616-1.407-21.15.636-34.74 12.417-33.798 28.355.481 8.054 4.522 15.108 11.324 19.886 5.84 3.879 13.319 5.848 21.101 5.481 10.414-.495 18.784-4.649 24.867-12.383 4.589-5.842 7.671-13.295 9.342-22.632 4.894 2.899 8.626 6.684 10.922 11.32 3.8 7.657 4.033 19.97-3.631 28.591-6.744 7.612-15.336 11.117-29.605 11.229-15.777-.123-27.576-5.002-35.246-14.521-7.239-8.993-10.98-21.803-11.299-38.053.319-16.251 4.06-29.061 11.127-38.067 7.67-9.518 19.469-14.397 35.246-14.52 15.916.124 27.905 5.004 35.816 14.603 3.862 4.682 6.828 10.445 8.826 17.154l13.437-3.767a63.7 63.7 0 00-11.079-21.305c-10.06-12.243-24.561-18.556-46.902-18.715h-.064c-22.242.159-36.639 6.479-46.53 18.575-8.916 11.096-13.612 26.369-13.959 46.063v.102c.347 19.694 5.043 34.967 13.959 46.063 9.891 12.096 24.288 18.416 46.53 18.576h.064c17.347-.133 28.81-4.863 37.445-14.547 10.952-12.239 10.592-28.26 5.44-38.797-3.549-7.272-9.48-13.296-17.39-17.608zm-47.893 34.655c-9.115.444-17.852-4.883-18.401-11.445-.408-4.801 2.61-13.516 21.502-14.168 2.287-.077 4.528-.114 6.73-.114 5.765 0 11.227.515 16.278 1.5-1.935 18.074-13.519 23.589-26.109 24.227z"/></svg>`, label: 'Threads' },
                twitter: { icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`, label: 'X' },
                x: { icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`, label: 'X' }
            };
            
            const platformsHtml = platforms.map(p => {
                const info = platformSvgs[p];
                if (info) {
                    return `<span class="platform-icon" title="${info.label}">${info.icon}</span>`;
                }
                return `<span class="platform-icon" title="${p}">📺</span>`;
            }).join(' ');
            
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
     * Clone this campaign — store config in sessionStorage and navigate to campaign creation page
     */
    cloneCampaign() {
        if (!this.campaign) return;

        // Build a config object from the campaign's stored config + top-level fields
        const stored = this.campaign.config || {};
        const config = {
            videoCount: this.campaign.video_count || stored.videoCount || 7,
            postsPerDay: stored.postsPerDay || 3,
            platforms: stored.platforms || ['youtube_shorts'],
            windows: stored.windows || ['12:00', '12:00', '12:00'],
            jitterMinutes: stored.jitterMinutes ?? 30,
            platformOffsetMinutes: stored.platformOffsetMinutes ?? 5,
            sceneCount: stored.sceneCount || 0,
            asapMode: stored.asapMode || false
        };

        sessionStorage.setItem('cloneCampaignConfig', JSON.stringify(config));
        window.location.href = 'campaign.html';
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
        
        // Auto-select the currently running/active job (if any)
        const activeStatuses = ['generating', 'assembling', 'rendering', 'processing'];
        const activeJob = sortedJobs.find(j => activeStatuses.includes(j.status));
        if (activeJob && !this.selectedJobId) {
            this.logJobSelect.value = activeJob.id;
            this.loadJobLogs(activeJob.id);
        }
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
            this.logsContent.innerHTML = '<div class="term-log--empty">loading logs...</div>';
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
                    this.logsContent.innerHTML = '<div class="term-log--empty">error: failed to load logs — check console</div>';
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
                pending: '○',
                running: '◉',
                completed: '●',
                failed: '✕'
            };
            
            const nextStep = this.pipelineSteps[index + 1];
            const nextStatus = nextStep ? (stepStatus[nextStep] || 'pending') : null;
            const connectorActive = status === 'completed' || status === 'running';
            
            return `
                <div class="step-timeline__step step-timeline__step--${status} ${this.selectedStepName === step ? 'step-timeline__step--selected' : ''}" 
                     title="${step}${durationText ? ` (${durationText})` : ''}"
                     data-step="${step}" onclick="window.campaignDetailPage.openStepDetail('${step}')">
                    <div class="step-timeline__icon">${statusIcons[status]}</div>
                    <div class="step-timeline__name">${step}</div>
                    ${durationText ? `<div class="step-timeline__duration">${durationText}</div>` : ''}
                </div>
                ${nextStep ? `<div class="step-timeline__connector ${connectorActive ? 'step-timeline__connector--active' : ''}">›</div>` : ''}
            `;
        }).join('');
        
        this.stepTimeline.innerHTML = timelineHtml || '<div class="step-timeline__empty">select a job to view pipeline status</div>';
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
        
        // Show loading state in the always-visible panel
        if (this.stepDetailTitle) this.stepDetailTitle.textContent = `${this.getStepIcon(stepName)} ${this.capitalize(stepName)} Details`;
        if (this.stepDetailContent) this.stepDetailContent.innerHTML = '<div style="text-align:center;padding:20px;color:#484f58">Loading step data...</div>';
        
        try {
            // Gather all data for this step from logs + job + assets
            const stepData = await this.gatherStepData(stepName);
            this.renderStepDetail(stepName, stepData);
        } catch (err) {
            console.error(`Failed to load ${stepName} details:`, err);
            if (this.stepDetailContent) this.stepDetailContent.innerHTML = `<div style="color:#f85149">Failed to load step details: ${err.message}</div>`;
        }
    }

    /**
     * Close the step detail panel (reset to empty)
     */
    closeStepDetail() {
        this.selectedStepName = null;
        if (this.stepDetailTitle) this.stepDetailTitle.textContent = 'Step Details';
        if (this.stepDetailContent) this.stepDetailContent.innerHTML = '<div class="step-detail__empty">click a pipeline step above</div>';
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
        
        // Read step metadata from jobs.meta.steps (stored by update_job_step RPC)
        try {
            const steps = jobRecord?.meta?.steps || {};
            data.stepMeta = steps[stepName] || {};
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
            
            // v3.0: Also load visual_cues and story_anchor for images step
            if (stepName === 'images') {
                try {
                    const { data: vcAsset } = await supabase
                        .from('job_assets')
                        .select('meta')
                        .eq('job_id', jobId)
                        .eq('idempotency_key', `${jobId}:visual_cues`)
                        .maybeSingle();
                    data.visualCues = vcAsset?.meta?.cues || [];
                    
                    const { data: saAsset } = await supabase
                        .from('job_assets')
                        .select('meta')
                        .eq('job_id', jobId)
                        .eq('idempotency_key', `${jobId}:story_anchor`)
                        .maybeSingle();
                    data.storyAnchorFull = saAsset?.meta || null;
                } catch { /* non-critical */ }
            }
        }
        
        // Load scenes data
        if (['scenes', 'images'].includes(stepName)) {
            const { data: scenesAsset } = await supabase
                .from('job_assets')
                .select('*')
                .eq('job_id', jobId)
                .eq('idempotency_key', `${jobId}:scenes_subtitles`)
                .maybeSingle();
            data.scenesData = scenesAsset?.meta?.scenes || [];
        }
        
        // Load uniqueness-specific data: uniqueness_check asset, story_generate meta, story_dna record
        if (stepName === 'uniqueness') {
            try {
                const { data: uqAsset } = await supabase
                    .from('job_assets')
                    .select('meta')
                    .eq('job_id', jobId)
                    .eq('idempotency_key', `${jobId}:uniqueness_check`)
                    .maybeSingle();
                data.uniquenessAsset = uqAsset?.meta || {};
                
                const { data: storyAsset } = await supabase
                    .from('job_assets')
                    .select('meta')
                    .eq('job_id', jobId)
                    .eq('idempotency_key', `${jobId}:story_generate`)
                    .maybeSingle();
                data.storyMeta = storyAsset?.meta || {};
                
                const { data: dnaRecord } = await supabase
                    .from('story_dna')
                    .select('*')
                    .eq('job_id', jobId)
                    .maybeSingle();
                data.storyDna = dnaRecord || {};
            } catch { /* non-critical */ }
        }
        
        // Load story anchor for story and images steps
        if (['story', 'images'].includes(stepName)) {
            try {
                const { data: saAsset } = await supabase
                    .from('job_assets')
                    .select('meta')
                    .eq('job_id', jobId)
                    .eq('idempotency_key', `${jobId}:story_anchor`)
                    .maybeSingle();
                data.storyAnchorFull = saAsset?.meta || null;
            } catch { /* non-critical */ }
        }
        
        return data;
    }

    /**
     * Render the detail panel content based on step type
     */
    renderStepDetail(stepName, data) {
        if (!this.stepDetailContent) return;
        
        // Store current step data for copy helpers
        this._currentStepData = data;
        
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
        const promptText = promptSnapshot?.meta?.payload || promptSnapshot?.meta?.data || promptSnapshot?.details || '';
        const responseData = responseSnapshot?.meta?.payload || responseSnapshot?.meta?.data || responseSnapshot?.meta || {};
        const storyPreview = responseData.story_preview || responseSnapshot?.meta?.story_preview || '';
        const wordCount = responseData.word_count || responseSnapshot?.meta?.word_count || job.story_word_count || '';
        
        let html = '';
        
        // Story settings
        html += `<div class="step-detail__section">
            <div class="step-detail__label">📋 Settings</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Vibe Preset</span>
                <span class="step-detail__kv-val">${job.vibe_preset || job.meta?.vibe_preset || '-'}</span>
                <span class="step-detail__kv-key">Duration</span>
                <span class="step-detail__kv-val">${this.formatMetaDuration(job.meta?.duration, job.meta?.length_preset, job.meta?.audio_duration_ms)}</span>
                <span class="step-detail__kv-key">Word Count</span>
                <span class="step-detail__kv-val">${wordCount || '-'} words</span>
                <span class="step-detail__kv-key">Model</span>
                <span class="step-detail__kv-val">gpt-4o</span>
                <span class="step-detail__kv-key">Art Style</span>
                <span class="step-detail__kv-val">${job.meta?.art_style || job.meta?.steps?.images?.meta?.art_style || 'auto (from preset)'}</span>
                <span class="step-detail__kv-key">Scene Count</span>
                <span class="step-detail__kv-val">${job.meta?.scene_count || 'auto'}</span>
                <span class="step-detail__kv-key">Platform</span>
                <span class="step-detail__kv-val">${job.meta?.platform && job.meta.platform !== 'default' ? job.meta.platform : (job.meta?.platforms?.length ? job.meta.platforms.join(', ') : '-')}</span>
            </div>
        </div>`;
        
        // Horror Scenario section (for reddit_trending_horror preset)
        const vibePreset = job.vibe_preset || job.meta?.vibe_preset || '';
        const scenarioCategory = job.meta?.scenario_category;
        const scenarioStyle = job.meta?.scenario_subreddit_style;
        const scenarioFear = job.meta?.scenario_fear_type;
        const scenarioSetting = job.meta?.scenario_setting_hint;
        
        if (scenarioCategory || vibePreset === 'reddit_trending_horror') {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎯 Horror Scenario</div>`;
            
            if (scenarioCategory) {
                const styleLabels = {
                    'nosleep': 'r/nosleep',
                    'letsnotmeet': 'r/letsnotmeet',
                    'creepypasta': 'r/creepypasta',
                    'paranormal': 'r/paranormal',
                    'shortscarystories': 'r/shortscarystories',
                };
                html += `<div class="step-detail__kv-grid">
                    <span class="step-detail__kv-key">Category</span>
                    <span class="step-detail__kv-val" style="text-transform:capitalize">${this.escapeHtml(scenarioCategory.replace(/_/g, ' '))}</span>
                    <span class="step-detail__kv-key">Style</span>
                    <span class="step-detail__kv-val" style="color:var(--color-primary)">${styleLabels[scenarioStyle] || this.escapeHtml(scenarioStyle || 'horror')}</span>
                    <span class="step-detail__kv-key">Core Fear</span>
                    <span class="step-detail__kv-val" style="text-transform:capitalize">${this.escapeHtml(scenarioFear || '-')}</span>
                    ${scenarioSetting ? `<span class="step-detail__kv-key">Setting Theme</span>
                    <span class="step-detail__kv-val" style="text-transform:capitalize">${this.escapeHtml(scenarioSetting)}</span>` : ''}
                    <span class="step-detail__kv-key">Source</span>
                    <span class="step-detail__kv-val">Reddit-inspired curated scenario</span>
                </div>`;
            } else {
                html += `<div style="padding:8px;font-size:12px;color:var(--text-secondary);background:var(--bg-primary);border-radius:4px">
                    ℹ️ Reddit-inspired preset — scenario data not available for this job (generated before scenario tracking was enabled)
                </div>`;
            }
            html += `</div>`;
        }
        
        // Story title & text
        if (job.title || job.story_text) {
            const storyId = `story-text-${Date.now()}`;
            html += `<div class="step-detail__section">
                <div class="step-detail__label">📖 Story: ${this.escapeHtml(job.title || 'Untitled')}
                    <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyToClipboard(document.getElementById('${storyId}').textContent, this)">📋 Copy</button>
                </div>
                <div class="step-detail__story" id="${storyId}">${this.escapeHtml(job.story_text || 'No story text available')}</div>
            </div>`;
        }
        
        // Story Anchor (loaded from job asset)  
        if (data.storyAnchorFull) {
            const sa = data.storyAnchorFull;
            this._storyAnchorText = JSON.stringify(sa, null, 2);
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎯 Story Anchor (Visual Bible)
                    <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyToClipboard(window.campaignDetailPage._storyAnchorText, this)">📋 Copy</button>
                </div>
                <div class="step-detail__kv-grid">
                    <span class="step-detail__kv-key">Environment</span>
                    <span class="step-detail__kv-val">${this.escapeHtml(sa.environment || '-')}</span>
                    <span class="step-detail__kv-key">Character(s)</span>
                    <span class="step-detail__kv-val">${this.escapeHtml(this.formatCharacterDescription(sa.characterDescription))}</span>
                    <span class="step-detail__kv-key">Recurring Motifs</span>
                    <span class="step-detail__kv-val">${this.escapeHtml(sa.recurringMotifs || '-')}</span>
                    <span class="step-detail__kv-key">Horror Tone</span>
                    <span class="step-detail__kv-val">${this.escapeHtml(sa.horrorTone || '-')}</span>
                    <span class="step-detail__kv-key">Time of Day</span>
                    <span class="step-detail__kv-val">${this.escapeHtml(sa.timeOfDay || '-')}</span>
                    <span class="step-detail__kv-key">Group Story</span>
                    <span class="step-detail__kv-val">${sa.isGroupStory ? `Yes (${sa.groupCount || '?'} people)` : 'No'}</span>
                </div>
            </div>`;
        }
        
        // Prompt used
        if (promptText) {
            const promptStr = typeof promptText === 'object' ? JSON.stringify(promptText, null, 2) : promptText;
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🧠 Story Prompt
                    <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyToClipboard(document.getElementById('story-prompt-pre').textContent, this)">📋 Copy</button>
                </div>
                <div class="step-detail__pre" id="story-prompt-pre">${this.escapeHtml(promptStr)}</div>
            </div>`;
        }
        
        return html;
    }

    renderUniquenessDetail(data) {
        const job = data.job || {};
        const meta = data.stepMeta || {};
        const innerMeta = meta.meta || {};
        const uqAsset = data.uniquenessAsset || {};
        const storyMeta = data.storyMeta || {};
        const dna = data.storyDna || {};
        
        // Score: 0-1 scale → percentage
        const rawScore = uqAsset.uniqueness_score ?? innerMeta.uniqueness_score ?? meta.uniqueness_score ?? job.uniqueness_score;
        const score = rawScore !== undefined && rawScore !== null
            ? Math.round(rawScore <= 1 ? rawScore * 100 : rawScore)
            : '-';
        const scoreColor = score !== '-' && score >= 70 ? '#3fb950' : score !== '-' && score >= 40 ? '#d29922' : '#f85149';
        const scoreLabel = score !== '-' && score >= 90 ? 'Highly Unique' : score !== '-' && score >= 70 ? 'Unique' : score !== '-' && score >= 40 ? 'Moderate' : 'Low Uniqueness';
        
        // Collision data
        const collisionCount = uqAsset.collision_count ?? innerMeta.collision_count ?? 0;
        const hasCollision = uqAsset.has_collision ?? innerMeta.has_collision ?? collisionCount > 0;
        const storyHash = uqAsset.story_hash || innerMeta.story_hash || meta.story_hash || '';
        
        // Concept data from story_generate asset and story_dna
        const conceptHash = dna.concept_hash || storyMeta.concept_hash || '';
        const fullHash = dna.full_hash || storyHash;
        const setting = storyMeta.setting || dna.meta?.setting || '';
        const concept = storyMeta.concept || dna.meta?.concept || '';
        const genre = dna.genre || job.vibe_preset || job.meta?.vibe_preset || '';
        const title = dna.meta?.title || job.title || '';
        
        // === Score Display ===
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🔍 Uniqueness Score</div>
            <div style="display:flex;align-items:baseline;gap:12px">
                <span style="font-size:32px;font-weight:700;color:${scoreColor};font-family:var(--font-mono)">${score}%</span>
                <span style="font-size:12px;color:${scoreColor};font-family:var(--font-mono)">${scoreLabel}</span>
            </div>
        </div>`;
        
        // === Score Breakdown ===
        html += `<div class="step-detail__section">
            <div class="step-detail__label">📊 How Score Was Generated</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Method</span>
                <span class="step-detail__kv-val">Concept hash collision check</span>
                <span class="step-detail__kv-key">Concept Collision</span>
                <span class="step-detail__kv-val">${hasCollision 
                    ? `<span class="step-detail__badge step-detail__badge--warning">⚠ ${collisionCount} similar found</span>` 
                    : '<span class="step-detail__badge step-detail__badge--success">✓ No collisions</span>'}</span>
                <span class="step-detail__kv-key">Score Logic</span>
                <span class="step-detail__kv-val" style="font-size:11px;color:#8b949e">${hasCollision 
                    ? 'Collision detected → score set to 50%' 
                    : 'No collision → score set to 95%'}</span>
            </div>
        </div>`;
        
        // === Story DNA / Concept Info ===
        if (setting || concept || genre) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🧬 Story DNA</div>
                <div class="step-detail__kv-grid">
                    ${title ? `<span class="step-detail__kv-key">Title</span>
                    <span class="step-detail__kv-val">${this.escapeHtml(title)}</span>` : ''}
                    ${setting ? `<span class="step-detail__kv-key">Setting</span>
                    <span class="step-detail__kv-val">${this.escapeHtml(setting)}</span>` : ''}
                    ${concept ? `<span class="step-detail__kv-key">Concept</span>
                    <span class="step-detail__kv-val">${this.escapeHtml(concept)}</span>` : ''}
                    ${genre ? `<span class="step-detail__kv-key">Genre / Preset</span>
                    <span class="step-detail__kv-val"><span class="step-detail__badge step-detail__badge--info">${this.escapeHtml(genre)}</span></span>` : ''}
                </div>
            </div>`;
        }
        
        // === Hash Details ===
        html += `<div class="step-detail__section">
            <div class="step-detail__label">🔐 Hash Fingerprints</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Concept Hash</span>
                <span class="step-detail__kv-val" style="font-family:var(--font-mono);font-size:11px;color:#58a6ff">${conceptHash ? conceptHash.substring(0, 24) + '...' : '-'}</span>
                <span class="step-detail__kv-key">Full Text Hash</span>
                <span class="step-detail__kv-val" style="font-family:var(--font-mono);font-size:11px;color:#58a6ff">${fullHash ? fullHash.substring(0, 24) + '...' : '-'}</span>
                <span class="step-detail__kv-key">Hash Match</span>
                <span class="step-detail__kv-val" style="font-size:11px">${conceptHash && fullHash 
                    ? (conceptHash === fullHash ? '<span style="color:#d29922">same (no concept meta)</span>' : '<span style="color:#3fb950">distinct concept & text hashes</span>') 
                    : '-'}</span>
            </div>
        </div>`;
        
        // === Collision Details ===
        if (collisionCount > 0) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">⚠️ Collision Details</div>
                <div style="font-size:12px;color:#d29922;line-height:1.6;padding:8px 12px;background:rgba(210,153,34,0.06);border:1px solid rgba(210,153,34,0.2);border-radius:6px">
                    ${collisionCount} other stor${collisionCount === 1 ? 'y' : 'ies'} in the same brand share the same concept hash (setting + concept).
                    This means the story theme/premise is similar to existing content.
                </div>
            </div>`;
        }

        // === Uniqueness Improvement Tips ===
        const tips = [];
        if (score !== '-') {
            // Concept-level checks
            if (!storyConcept && !setting) {
                tips.push({ icon: '🎯', area: 'Concept Metadata', tip: 'Story has no extracted setting or concept — the uniqueness check fell back to full-text hashing. Richer concept metadata would enable smarter thematic comparison.' });
            }
            if (hasCollision) {
                tips.push({ icon: '🔄', area: 'Theme Overlap', tip: `${collisionCount} other story shares the same setting + concept combination. Use a completely different location or premise to avoid thematic repetition.` });
            }
            // Dimensional improvement suggestions (the "missing 5%")
            if (!hasCollision) {
                tips.push({ icon: '📐', area: 'Title Similarity', tip: 'The system currently checks concept-level collisions but doesn\'t compare title phrasing across stories. Varying your title structure (e.g. question vs. statement vs. fragment) adds another layer of differentiation.' });
                tips.push({ icon: '🪝', area: 'Hook Variation', tip: 'Try varying the opening hook style — alternate between "Did you know..." factual hooks, cold-open immersion ("The door was already open."), or counting/number hooks. Diverse hooks prevent audience pattern fatigue.' });
                tips.push({ icon: '🧩', area: 'Narrative Structure', tip: 'Rotate between story structures: linear chronological, dual-timeline (then vs. now), reverse reveal, or documentary reconstruction. Same concept with different structure feels like a different story.' });
                tips.push({ icon: '👥', area: 'Character Archetypes', tip: 'Swap character archetypes between posts — unreliable narrator, reluctant investigator, oblivious bystander, calm documentarian. Each archetype changes how the same horror lands.' });
                tips.push({ icon: '🌡️', area: 'Tone Spectrum', tip: 'Shift tone across posts: clinical/factual → confessional/intimate → sardonic/dark humor → slow-burn dread. Keeps the brand unpredictable even within the same genre.' });
            }
        }

        if (tips.length > 0) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">💡 How to Reach 100% Uniqueness</div>
                <div style="font-size:12px;line-height:1.7;display:flex;flex-direction:column;gap:8px">
                    ${score !== '-' && !hasCollision ? `<div style="color:#8b949e;margin-bottom:4px">Score is <strong style="color:#3fb950">${score}%</strong> — no concept collisions detected. The remaining <strong>${100 - score}%</strong> represents dimensions the system doesn't yet measure automatically. Here's what would push it higher:</div>` : ''}
                    ${tips.map(t => `
                        <div style="padding:8px 12px;background:rgba(88,166,255,0.04);border:1px solid rgba(88,166,255,0.12);border-radius:6px">
                            <div style="font-weight:600;color:#c9d1d9;margin-bottom:2px">${t.icon} ${t.area}</div>
                            <div style="color:#8b949e">${t.tip}</div>
                        </div>
                    `).join('')}
                </div>
            </div>`;
        }
        
        return html;
    }

    renderScenesDetail(data) {
        const scenes = data.scenesData || [];
        const job = data.job || {};
        const totalDuration = parseFloat(job.meta?.duration || job.meta?.audio_duration || 60);
        const hasTimestamps = !!job.meta?.audio_timestamps?.length;
        
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🎬 Scene Breakdown (${scenes.length} scenes)
                <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyScenesData(this)">📋 Copy All</button>
            </div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Scene Count</span>
                <span class="step-detail__kv-val">${scenes.length}</span>
                <span class="step-detail__kv-key">Duration</span>
                <span class="step-detail__kv-val">${totalDuration}s</span>
                <span class="step-detail__kv-key">Pace</span>
                <span class="step-detail__kv-val">${job.meta?.pace || 'balanced'}</span>
                <span class="step-detail__kv-key">Voice Aligned</span>
                <span class="step-detail__kv-val">${hasTimestamps 
                    ? '<span class="voice-aligned-badge voice-aligned-badge--yes">🎙️ Yes</span>' 
                    : '<span class="voice-aligned-badge voice-aligned-badge--no">— No timestamps</span>'}</span>
                <span class="step-detail__kv-key">Timing Mode</span>
                <span class="step-detail__kv-val">${hasTimestamps ? 'Voice-aligned' : 'Word-proportional'}</span>
            </div>
        </div>`;
        
        // Duration bar chart
        if (scenes.length > 0) {
            const maxDur = Math.max(...scenes.map(s => (s.endTime || 0) - (s.startTime || 0)), 1);
            html += `<div class="step-detail__section">
                <div class="step-detail__label">⏱️ Scene Duration Distribution</div>
                <div class="duration-bar-chart">
                    ${scenes.map((s, i) => {
                        const dur = ((s.endTime || 0) - (s.startTime || 0)).toFixed(1);
                        const pct = Math.max(10, (dur / maxDur) * 100);
                        const words = (s.text || '').split(/\s+/).filter(w => w).length;
                        const isMerged = dur > 8;
                        return `<div class="duration-bar" style="height:${pct}%;background:${isMerged ? '#F59E0B' : dur < 3.5 ? '#EF4444' : '#8B5CF6'}">
                            <div class="duration-bar__tooltip">Scene ${i+1}: ${dur}s (${words}w)${isMerged ? ' — long' : ''}</div>
                        </div>`;
                    }).join('')}
                </div>
                <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary);margin-top:2px">
                    <span>Scene 1</span><span>Scene ${scenes.length}</span>
                </div>
            </div>`;
        }
        
        if (scenes.length > 0) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">📝 Scenes</div>
                <div style="max-height:300px;overflow-y:auto">
                    ${scenes.map((s, i) => {
                        const dur = ((s.endTime || 0) - (s.startTime || 0)).toFixed(1);
                        const words = (s.text || '').split(/\s+/).filter(w => w).length;
                        const wps = dur > 0 ? (words / dur).toFixed(1) : 0;
                        return `
                        <div style="padding:8px;margin-bottom:4px;background:var(--bg-primary);border-radius:4px;border-left:3px solid var(--color-primary);font-size:12px">
                            <div style="display:flex;align-items:center;gap:6px">
                                <strong style="color:var(--text-secondary)">Scene ${i + 1}</strong>
                                <span style="color:var(--text-secondary);font-size:11px">(${(s.startTime || 0).toFixed(1)}s - ${(s.endTime || 0).toFixed(1)}s = ${dur}s)</span>
                                <span style="font-size:10px;color:var(--text-secondary)">${words}w · ${wps}w/s</span>
                                ${parseFloat(dur) > 10 ? '<span class="multi-image-badge">multi-img</span>' : ''}
                            </div>
                            <div style="margin-top:4px;color:var(--text-primary)">${this.escapeHtml((s.text || '').substring(0, 200))}${(s.text || '').length > 200 ? '...' : ''}</div>
                            ${s.keywords?.length ? `<div style="margin-top:4px;font-size:11px;color:var(--text-secondary)">Keywords: ${s.keywords.join(', ')}</div>` : ''}
                        </div>
                    `}).join('')}
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
        const payloadData = payload.payload || payload.data || payload;
        const resultData = result.payload || result.data || result;
        
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
        const job = data.job || {};
        const assets = data.assets || [];
        
        // Primary source: job_assets meta (richest data from music_select step)
        const musicAsset = assets.find(a => a.idempotency_key?.includes('music_select') || a.idempotency_key?.includes('music'));
        const assetMeta = musicAsset?.meta || {};
        
        // Secondary source: snapshot data
        const outputSnap = data.snapshots.find(s => s.message?.includes('Selected') || s.message?.includes('output') || s.message?.includes('snapshot'));
        const snapData = outputSnap?.meta?.payload || outputSnap?.meta?.data || outputSnap?.meta || {};
        
        // Tertiary source: job.meta
        const jobMeta = job.meta || {};
        
        // Resolve track info with fallback chain: asset meta → snapshot → job meta
        const trackName = assetMeta.display_name || assetMeta.track_id || snapData.display_name || snapData.track_id || snapData.track_name || snapData.selected_track || jobMeta.music_track_id || '-';
        const trackMood = assetMeta.mood || snapData.mood || '';
        const trackDuration = assetMeta.duration_seconds || snapData.duration_seconds || '';
        const trackLoopable = assetMeta.loopable ?? snapData.loopable ?? jobMeta.music_loopable;
        const volume = snapData.volume ?? assetMeta.volume ?? '';
        const duckingEnabled = snapData.ducking_enabled ?? assetMeta.ducking_enabled;
        const fadeIn = snapData.fade_in_ms ?? assetMeta.fade_in_ms ?? '';
        const fadeOut = snapData.fade_out_ms ?? assetMeta.fade_out_ms ?? '';
        const musicSource = assetMeta.source || snapData.source || '';
        const musicUrl = assetMeta.music_url || jobMeta.music_url || '';
        
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🎵 Track Selection</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Track</span>
                <span class="step-detail__kv-val" style="font-weight:600">${this.escapeHtml(String(trackName))}</span>
                ${trackMood ? `<span class="step-detail__kv-key">Mood</span>
                <span class="step-detail__kv-val">${this.escapeHtml(String(trackMood))}</span>` : ''}
                ${trackDuration ? `<span class="step-detail__kv-key">Duration</span>
                <span class="step-detail__kv-val">${Number(trackDuration).toFixed(1)}s</span>` : ''}
                ${trackLoopable !== undefined ? `<span class="step-detail__kv-key">Loopable</span>
                <span class="step-detail__kv-val">${trackLoopable ? '✅ Yes' : '❌ No'}</span>` : ''}
                ${musicSource ? `<span class="step-detail__kv-key">Source</span>
                <span class="step-detail__kv-val">${this.escapeHtml(String(musicSource))}</span>` : ''}
            </div>
        </div>`;
        
        // Mixing config
        if (volume !== '' || fadeIn !== '' || fadeOut !== '') {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎛️ Mixing</div>
                <div class="step-detail__kv-grid">
                    ${volume !== '' ? `<span class="step-detail__kv-key">Volume</span>
                    <span class="step-detail__kv-val">${volume}</span>` : ''}
                    ${duckingEnabled !== undefined ? `<span class="step-detail__kv-key">Voice Ducking</span>
                    <span class="step-detail__kv-val">${duckingEnabled ? '✅ Enabled' : '❌ Off'}</span>` : ''}
                    ${fadeIn !== '' ? `<span class="step-detail__kv-key">Fade In</span>
                    <span class="step-detail__kv-val">${fadeIn}ms</span>` : ''}
                    ${fadeOut !== '' ? `<span class="step-detail__kv-key">Fade Out</span>
                    <span class="step-detail__kv-val">${fadeOut}ms</span>` : ''}
                </div>
            </div>`;
        }
        
        // Audio player for the music track
        if (musicUrl) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🔊 Track Preview</div>
                <audio controls style="width:100%;margin-top:4px" src="${this.escapeHtml(musicUrl)}">Your browser does not support audio</audio>
            </div>`;
        }
        
        return html;
    }

    renderImagesDetail(data) {
        const promptSnap = data.snapshots.find(s => s.message?.includes('prompt'));
        const promptData = promptSnap?.meta?.payload || promptSnap?.meta?.data || promptSnap?.meta || {};
        const assets = data.assets || [];
        const progress = data.progress || [];
        const job = data.job || {};
        
        const imageAssets = assets
            .filter(a => a.public_url && a.idempotency_key?.includes('image_generate'))
            .sort((a, b) => {
                const aIdx = parseInt(a.idempotency_key?.split('scene_')[1] || '0');
                const bIdx = parseInt(b.idempotency_key?.split('scene_')[1] || '0');
                return aIdx - bIdx;
            });
        
        // Also look for visual_cues snapshot for type distribution info
        const vcSnap = data.snapshots.find(s => s.message?.includes('Visual cues'));
        const vcData = vcSnap?.meta?.payload || vcSnap?.meta?.data || vcSnap?.meta || {};
        const storyAnchorInfo = vcData.story_anchor || null;
        const sceneTypeDistribution = vcData.scene_type_distribution || null;
        
        // Image sequence manifest
        const imageSequence = job.meta?.image_sequence || [];
        const hasVoiceAlignment = !!job.meta?.audio_timestamps?.length;
        const multiImageCount = imageSequence.filter(e => e.subIndex > 0).length;
        
        const totalScenes = data.stepMeta?.total_scenes || progress[progress.length - 1]?.meta?.total || imageAssets.length || '?';
        
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🖼️ Image Generation
                <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyImageSummary(this)">📋 Copy Summary</button>
            </div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Model</span>
                <span class="step-detail__kv-val">${promptData.model || data.stepMeta?.image_model || job.meta?.image_model || '-'}</span>
                <span class="step-detail__kv-key">Size</span>
                <span class="step-detail__kv-val">${promptData.size || '-'}</span>
                <span class="step-detail__kv-key">Generated</span>
                <span class="step-detail__kv-val">${imageAssets.length} / ${totalScenes}</span>
                <span class="step-detail__kv-key">Story Anchor</span>
                <span class="step-detail__kv-val">${storyAnchorInfo ? '✅ Used' : '❌ Not used'}</span>
                <span class="step-detail__kv-key">Voice Aligned</span>
                <span class="step-detail__kv-val">${hasVoiceAlignment 
                    ? '<span class="voice-aligned-badge voice-aligned-badge--yes">🎙️ Yes</span>' 
                    : '<span class="voice-aligned-badge voice-aligned-badge--no">— No</span>'}</span>
                <span class="step-detail__kv-key">Multi-Image Scenes</span>
                <span class="step-detail__kv-val">${multiImageCount > 0 ? `${multiImageCount} extra images` : 'None (all ≤10s)'}</span>
            </div>
        </div>`;
        
        // Image Sequence Manifest — duration bars + mood levels
        if (imageSequence.length > 0) {
            const maxDur = Math.max(...imageSequence.map(e => e.duration || 0), 1);
            html += `<div class="step-detail__section">
                <div class="step-detail__label">📊 Image Sequence (${imageSequence.length} images)
                    <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyImageSequence(this)">📋 Copy</button>
                </div>
                <div class="duration-bar-chart">
                    ${imageSequence.map((entry, i) => {
                        const dur = (entry.duration || 0).toFixed(1);
                        const pct = Math.max(10, ((entry.duration || 0) / maxDur) * 100);
                        const mood = entry.moodLevel || 0;
                        const color = mood >= 7 ? '#EF4444' : mood >= 4 ? '#F59E0B' : '#3B82F6';
                        const isMulti = entry.subIndex > 0;
                        return `<div class="duration-bar" style="height:${pct}%;background:${color}${isMulti ? ';border:1px dashed rgba(255,255,255,0.3)' : ''}">
                            <div class="duration-bar__tooltip">S${entry.sceneIndex + 1}${isMulti ? '.' + (entry.subIndex + 1) : ''}: ${dur}s · mood ${mood}</div>
                        </div>`;
                    }).join('')}
                </div>
                <div style="display:flex;gap:12px;font-size:10px;color:var(--text-secondary);margin-top:4px">
                    <span style="display:flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:2px;background:#3B82F6"></span> Gentle (1-3)</span>
                    <span style="display:flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:2px;background:#F59E0B"></span> Building (4-6)</span>
                    <span style="display:flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:2px;background:#EF4444"></span> Intense (7-10)</span>
                </div>
            </div>`;
            
            // Mood level pills
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎭 Mood Levels (Ken Burns Intensity)</div>
                <div class="mood-pills">
                    ${imageSequence.map((entry, i) => {
                        const mood = entry.moodLevel || 0;
                        const cls = mood >= 7 ? 'mood-pill--high' : mood >= 4 ? 'mood-pill--mid' : 'mood-pill--low';
                        return `<span class="mood-pill ${cls}" title="Scene ${entry.sceneIndex + 1}${entry.subIndex > 0 ? '.' + (entry.subIndex + 1) : ''}: mood ${mood}">${mood}</span>`;
                    }).join('')}
                </div>
            </div>`;
        }
        
        // Story Anchor details (if available)
        if (storyAnchorInfo) {
            this._imagesStoryAnchorText = JSON.stringify(storyAnchorInfo, null, 2);
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎯 Story Anchor
                    <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyToClipboard(window.campaignDetailPage._imagesStoryAnchorText, this)">📋 Copy</button>
                </div>
                <div class="step-detail__kv-grid">
                    <span class="step-detail__kv-key">Environment</span>
                    <span class="step-detail__kv-val">${this.escapeHtml(storyAnchorInfo.environment || '-')}</span>
                    <span class="step-detail__kv-key">Horror Tone</span>
                    <span class="step-detail__kv-val">${storyAnchorInfo.horrorTone || '-'}</span>
                    <span class="step-detail__kv-key">Group Story</span>
                    <span class="step-detail__kv-val">${storyAnchorInfo.isGroupStory ? `Yes (${storyAnchorInfo.groupCount || '?'} people)` : 'No'}</span>
                    <span class="step-detail__kv-key">Character</span>
                    <span class="step-detail__kv-val">${storyAnchorInfo.hasCharacterDescription ? '✅ Described' : '❌ None'}</span>
                </div>
            </div>`;
        }
        
        // Visual Cues detail
        if (data.visualCues?.length) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">👁️ Visual Cues (${data.visualCues.length})
                    <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyVisualCues(this)">📋 Copy</button>
                </div>
                <div style="max-height:200px;overflow-y:auto">
                    ${data.visualCues.map((vc, i) => `
                        <div style="padding:4px 8px;margin-bottom:2px;font-size:11px;background:var(--bg-primary);border-radius:3px;display:flex;gap:8px;align-items:flex-start">
                            <strong style="color:var(--text-secondary);min-width:20px">S${(vc.sceneIndex ?? i) + 1}</strong>
                            <span style="color:var(--text-primary);flex:1">${this.escapeHtml(vc.description || '-')}</span>
                            <span style="font-size:10px;color:var(--text-secondary);white-space:nowrap">${vc.sceneType || '-'} · ${vc.camera || '-'}${vc.isClimax ? ' · 🔥' : ''}</span>
                        </div>
                    `).join('')}
                </div>
            </div>`;
        }
        
        // Scene type distribution
        if (sceneTypeDistribution) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">📊 Scene Type Distribution</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    ${Object.entries(sceneTypeDistribution).map(([type, count]) => {
                        const colors = { establishing: '#6366F1', object: '#F59E0B', atmosphere: '#10B981', character: '#3B82F6', group: '#EF4444' };
                        return `<span style="background:${colors[type] || '#6B7280'}20;color:${colors[type] || '#6B7280'};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">${type}: ${count}</span>`;
                    }).join('')}
                </div>
            </div>`;
        }
        
        // Sample prompt
        if (promptData.prompt) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🧠 Sample Prompt (Scene ${(promptData.scene_index || 0) + 1})
                    <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyToClipboard(document.getElementById('sample-prompt-pre').textContent, this)">📋 Copy</button>
                </div>
                <div class="step-detail__pre" id="sample-prompt-pre">${this.escapeHtml(promptData.prompt)}</div>
            </div>`;
        }
        
        // Image grid — clickable for detail modal
        if (imageAssets.length > 0) {
            // Store image assets for modal access
            this._imageAssets = imageAssets;
            this._imagePromptSnapshots = data.snapshots.filter(s => s.message?.includes('prompt'));
            this._imageScenes = data.scenesData || [];
            this._imageStoryAnchor = storyAnchorInfo;
            this._imageSequence = imageSequence;
            this._visualCues = data.visualCues || [];
            
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎨 Generated Images (${imageAssets.length}) <span style="font-size:11px;color:var(--text-secondary);font-weight:normal">— click for details</span></div>
                <div class="step-detail__image-grid">
                    ${imageAssets.map((a, i) => {
                        const sceneIdx = parseInt(a.idempotency_key?.split('scene_')[1] || i);
                        const seqEntry = imageSequence.find(e => e.sceneIndex === sceneIdx && (e.subIndex || 0) === 0);
                        const dur = seqEntry ? seqEntry.duration.toFixed(1) + 's' : '';
                        const mood = seqEntry ? seqEntry.moodLevel : '';
                        return `<div class="step-detail__image-item step-detail__image-item--clickable" data-scene-index="${sceneIdx}" onclick="window.campaignDetailPage.showImageDetail(${sceneIdx})">
                            <img src="${a.public_url}" alt="Scene ${sceneIdx + 1}" loading="lazy">
                            <div class="step-detail__image-item__label">S${sceneIdx + 1}${dur ? ' · ' + dur : ''}${mood ? ' · M' + mood : ''}</div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }
        
        // Progress log
        if (progress.length > 0) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">📈 Progress (${progress.length} updates)
                    <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyProgressLog(this)">📋 Copy</button>
                </div>
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

    /**
     * Show image detail modal for a specific scene
     */
    showImageDetail(sceneIndex) {
        const imageAssets = this._imageAssets || [];
        const asset = imageAssets.find(a => {
            const idx = parseInt(a.idempotency_key?.split('scene_')[1] || '-1');
            return idx === sceneIndex;
        });
        if (!asset) return;
        
        const meta = asset.meta || {};
        const scenes = this._imageScenes || [];
        const sceneData = scenes[sceneIndex] || {};
        
        // Find the prompt snapshot for this scene
        const promptSnaps = this._imagePromptSnapshots || [];
        const matchingSnap = promptSnaps.find(s => (s.meta?.payload?.scene_index ?? s.meta?.data?.scene_index ?? s.meta?.scene_index) === sceneIndex);
        const snapData = matchingSnap?.meta?.payload || matchingSnap?.meta?.data || matchingSnap?.meta || {};
        
        // Build prompt — from snapshot or from asset meta
        const prompt = snapData.prompt || meta.prompt || 'Prompt not recorded for this scene';
        const visualCue = snapData.visual_cue || null;
        const artStyle = meta.art_style || snapData.art_style || '-';
        const imageModel = meta.image_model || snapData.model || '-';
        
        // Get image sequence info for this scene
        const seqEntries = (this._imageSequence || []).filter(e => e.sceneIndex === sceneIndex);
        const seqEntry = seqEntries[0] || {};
        
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'image-detail-modal-overlay';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        
        overlay.innerHTML = `
            <div class="image-detail-modal">
                <div class="image-detail-modal__header">
                    <h3>Scene ${sceneIndex + 1} Image Details</h3>
                    <button class="image-detail-modal__close" onclick="this.closest('.image-detail-modal-overlay').remove()">✕</button>
                </div>
                <div class="image-detail-modal__body">
                    <div class="image-detail-modal__image-col">
                        <img src="${asset.public_url}" alt="Scene ${sceneIndex + 1}" />
                        <div class="image-detail-modal__image-actions">
                            <button onclick="window.open('${asset.public_url}', '_blank')" class="btn-secondary-sm">🔗 Open Full Size</button>
                        </div>
                    </div>
                    <div class="image-detail-modal__info-col">
                        <div class="image-detail-modal__section">
                            <div class="image-detail-modal__label">⚙️ Generation Config</div>
                            <div class="image-detail-modal__kv">
                                <span>Model</span><span>${this.escapeHtml(imageModel)}</span>
                                <span>Art Style</span><span>${this.escapeHtml(artStyle)}</span>
                                <span>Scene Type</span><span>${this.escapeHtml(visualCue?.type || visualCue?.sceneType || '-')}</span>
                                <span>Camera</span><span>${this.escapeHtml(visualCue?.camera || '-')}</span>
                                <span>Duration</span><span>${seqEntry.duration ? seqEntry.duration.toFixed(1) + 's' : '-'}</span>
                                <span>Mood Level</span><span>${seqEntry.moodLevel || '-'}</span>
                                <span>Multi-Image</span><span>${seqEntries.length > 1 ? seqEntries.length + ' images' : 'No'}</span>
                                ${visualCue?.isClimax ? '<span>Climax</span><span style="color:#EF4444;font-weight:600">🔥 YES</span>' : ''}
                                ${meta.prompt_hash ? `<span>Prompt Hash</span><span style="font-family:monospace;font-size:11px">${meta.prompt_hash.substring(0, 16)}...</span>` : ''}
                            </div>
                        </div>
                        ${visualCue ? `
                        <div class="image-detail-modal__section">
                            <div class="image-detail-modal__label">👁️ Visual Cue</div>
                            <p style="font-size:13px;color:var(--text-primary);line-height:1.5">${this.escapeHtml(visualCue.description || '-')}</p>
                        </div>` : ''}
                        ${sceneData.text ? `
                        <div class="image-detail-modal__section">
                            <div class="image-detail-modal__label">📖 Scene Narration</div>
                            <p style="font-size:13px;color:var(--text-primary);line-height:1.5">${this.escapeHtml(sceneData.text)}</p>
                            ${sceneData.keywords?.length ? `<div style="margin-top:6px;font-size:11px;color:var(--text-secondary)">Keywords: ${sceneData.keywords.join(', ')}</div>` : ''}
                        </div>` : ''}
                        <div class="image-detail-modal__section">
                            <div class="image-detail-modal__label" style="display:flex;justify-content:space-between;align-items:center">
                                🧠 Full Prompt
                                <button class="step-detail__copy-btn" onclick="navigator.clipboard.writeText(this.closest('.image-detail-modal__section').querySelector('pre').textContent).then(()=>{this.textContent='✓ Copied';setTimeout(()=>this.textContent='📋 Copy',1500)})">📋 Copy</button>
                            </div>
                            <pre class="image-detail-modal__prompt">${this.escapeHtml(prompt)}</pre>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // Close on Escape
        const escHandler = (e) => {
            if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
        };
        document.addEventListener('keydown', escHandler);
    }

    renderSubtitlesDetail(data) {
        const job = data.job || {};
        
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">📝 Subtitle Configuration</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Caption Style</span>
                <span class="step-detail__kv-val">${job.meta?.caption_style || 'default'}</span>
                <span class="step-detail__kv-key">Platform</span>
                <span class="step-detail__kv-val">${job.meta?.platform && job.meta.platform !== 'default' ? job.meta.platform : (job.meta?.platforms?.length ? job.meta.platforms.join(', ') : '-')}</span>
            </div>
        </div>`;
        
        return html;
    }

    renderAssembleDetail(data) {
        const payloadSnap = data.snapshots.find(s => s.message?.includes('payload'));
        const outputSnap = data.snapshots.find(s => s.message?.includes('output') || s.message?.includes('complete'));
        const payload = payloadSnap?.meta?.payload || payloadSnap?.meta?.data || payloadSnap?.meta || {};
        const output = outputSnap?.meta?.payload || outputSnap?.meta?.data || outputSnap?.meta || {};
        const job = data.job || {};
        const imageSeq = job.meta?.image_sequence || [];
        
        this._assemblePayloadText = JSON.stringify(payload, null, 2);
        
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🔧 Assembly Configuration
                <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyToClipboard(window.campaignDetailPage._assemblePayloadText, this)">📋 Copy Payload</button>
            </div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Renderer</span>
                <span class="step-detail__kv-val">${payload.renderer_url ? 'Video Renderer' : 'N/A'}</span>
                <span class="step-detail__kv-key">Images</span>
                <span class="step-detail__kv-val">${payload.scene_count || payload.total_scenes || imageSeq.length || '-'}</span>
                <span class="step-detail__kv-key">Effects Mode</span>
                <span class="step-detail__kv-val">${payload.effects_mode || job.meta?.effects_mode || '-'}</span>
                <span class="step-detail__kv-key">Controlled Motion</span>
                <span class="step-detail__kv-val">${payload.effects_config?.enabled ? '✅ Active' : '❌ Legacy'}</span>
                <span class="step-detail__kv-key">Per-Scene Durations</span>
                <span class="step-detail__kv-val">${imageSeq.length > 0 ? '✅ From image_sequence' : '⚠️ Uniform'}</span>
                <span class="step-detail__kv-key">Mood Levels</span>
                <span class="step-detail__kv-val">${imageSeq.length > 0 ? `✅ ${imageSeq.map(e => e.moodLevel).join(',')}` : '— N/A'}</span>
                <span class="step-detail__kv-key">Music</span>
                <span class="step-detail__kv-val">${payload.music_url ? '🎵 Included' : '— None'}</span>
                <span class="step-detail__kv-key">Captions</span>
                <span class="step-detail__kv-val">${payload.captions?.length ? `${payload.captions.length} words` : '— None'}</span>
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
        const output = outputSnap?.meta?.payload || outputSnap?.meta?.data || outputSnap?.meta || {};
        
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
        const output = outputSnap?.meta?.payload || outputSnap?.meta?.data || outputSnap?.meta || {};
        
        let html = `<div class="step-detail__section">
            <div class="step-detail__label">📅 Schedule Details</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Platform</span>
                <span class="step-detail__kv-val">${output.platform || output.platforms?.join(', ') || (data.job?.meta?.platform && data.job.meta.platform !== 'default' ? data.job.meta.platform : (data.job?.meta?.platforms?.length ? data.job.meta.platforms.join(', ') : '-'))}</span>
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
     * Copy text to clipboard with visual feedback on button
     */
    async copyToClipboard(text, buttonEl) {
        try {
            await navigator.clipboard.writeText(text);
            if (buttonEl) {
                const orig = buttonEl.innerHTML;
                buttonEl.innerHTML = '✓ Copied';
                buttonEl.classList.add('step-detail__copy-btn--copied');
                setTimeout(() => {
                    buttonEl.innerHTML = orig;
                    buttonEl.classList.remove('step-detail__copy-btn--copied');
                }, 1500);
            }
        } catch (err) {
            console.error('Copy failed:', err);
            this.showToast?.('Failed to copy', 'error');
        }
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
     * Format meta.duration which can be a number, string, or object like {minSeconds, maxSeconds}
     */
    formatMetaDuration(duration, lengthPreset, audioDurationMs) {
        // Prefer actual audio duration if available
        if (audioDurationMs && typeof audioDurationMs === 'number' && audioDurationMs > 0) {
            return `${(audioDurationMs / 1000).toFixed(1)}s (audio)`;
        }
        if (duration == null) {
            return lengthPreset ? `${lengthPreset}s` : '-';
        }
        if (typeof duration === 'number') {
            return `${duration}s`;
        }
        if (typeof duration === 'string') {
            return `${duration}s`;
        }
        if (typeof duration === 'object') {
            const min = duration.minSeconds || duration.min || null;
            const max = duration.maxSeconds || duration.max || null;
            if (min && max) return `${min}-${max}s`;
            if (min) return `${min}s+`;
            if (max) return `≤${max}s`;
            // Try target
            if (duration.target) return `~${duration.target}s`;
        }
        return lengthPreset ? `${lengthPreset}s` : '-';
    }

    /**
     * Format characterDescription which may be a string, null, or object
     */
    formatCharacterDescription(desc) {
        if (!desc) return 'None (atmospheric)';
        if (typeof desc === 'string') return desc;
        if (typeof desc === 'object') {
            // AI may return {name, description, appearance, ...}
            if (desc.description) return desc.description;
            if (desc.appearance) return desc.appearance;
            if (desc.name && desc.details) return `${desc.name}: ${desc.details}`;
            if (desc.name) return desc.name;
            // Array of characters
            if (Array.isArray(desc)) {
                return desc.map(c => {
                    if (typeof c === 'string') return c;
                    return c.description || c.name || JSON.stringify(c);
                }).join('; ');
            }
            // Last resort: readable key-value pairs
            const entries = Object.entries(desc).filter(([_, v]) => v);
            if (entries.length > 0) {
                return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
            }
        }
        return String(desc);
    }

    /**
     * Render log entries — Terminal style
     */
    renderLogs() {
        if (!this.logsContent) return;
        
        // Enable/disable copy button based on logs availability
        if (this.btnCopyLogs) {
            this.btnCopyLogs.disabled = !this.currentLogs?.length;
        }
        
        if (!this.currentLogs?.length) {
            this.logsContent.innerHTML = '<div class="term-log--empty">no logs available for this job</div>';
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
            this.logsContent.innerHTML = '<div class="term-log--empty">no logs match current filters</div>';
            return;
        }
        
        // Render terminal-style log entries
        const logsHtml = filteredLogs.map((log, idx) => this.renderLogEntry(log, idx + 1)).join('');
        this.logsContent.innerHTML = logsHtml;
        
        // Auto-scroll to bottom
        this.logsContent.scrollTop = this.logsContent.scrollHeight;
    }

    /**
     * Render a single terminal-style log entry
     */
    renderLogEntry(log, lineNum = 0) {
        const dt = new Date(log.created_at);
        const timestamp = dt.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const eventType = log.event_type || log.log_type;
        const levelLabel = this.getLogTypeLabel(eventType);
        const levelClass = this.getLogTypeClass(eventType);
        const stepName = log.step_name || 'sys';
        
        // Build rich message
        let message = log.message || '';
        if (eventType === 'started') {
            message = `→ starting ${log.step_name || 'step'}`;
        } else if (eventType === 'completed') {
            const dur = log.meta?.duration_ms ? this.formatDuration(log.meta.duration_ms) : null;
            message = dur ? `✓ completed (${dur})` : '✓ completed';
        } else if (eventType === 'failed') {
            const errMsg = log.meta?.error || log.meta?.last_error || message;
            message = `✕ ${errMsg}`;
        } else if (eventType === 'progress') {
            const pct = log.meta?.progress_pct;
            const done = log.meta?.scenes_done || log.meta?.current;
            const total = log.meta?.total_scenes || log.meta?.total;
            if (pct != null) {
                message = `${message} [${Math.round(pct)}%]`;
            } else if (done != null && total != null) {
                message = `${message} [${done}/${total}]`;
            }
        }
        
        // Row class based on type
        const rowClass = eventType === 'failed' ? ' term-log--failed' : (eventType === 'completed' ? ' term-log--completed' : '');
        
        // Build meta/details block
        let metaHtml = '';
        const metaData = log.meta || log.details;
        if (metaData && eventType !== 'started' && eventType !== 'completed') {
            try {
                const obj = typeof metaData === 'string' ? JSON.parse(metaData) : metaData;
                if (Object.keys(obj).length > 0) {
                    metaHtml = `<div class="term-log__meta">${this.syntaxHighlightJSON(JSON.stringify(obj, null, 2))}</div>`;
                }
            } catch {
                metaHtml = `<div class="term-log__meta">${this.escapeHtml(String(metaData))}</div>`;
            }
        }
        
        return `<div class="term-log${rowClass}"><span class="term-log__line">${lineNum}</span><span class="term-log__time">${timestamp}</span><span class="term-log__level term-log__level--${levelClass}">${levelLabel}</span><span class="term-log__step">[${stepName}]</span><span class="term-log__msg">${this.escapeHtml(message)}</span></div>${metaHtml}`;
    }

    /**
     * Syntax highlight JSON for terminal meta blocks
     */
    syntaxHighlightJSON(json) {
        return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
            let cls = 'json-number';
            if (/^"/.test(match)) {
                cls = /:$/.test(match) ? 'json-key' : 'json-string';
            } else if (/true|false/.test(match)) {
                cls = 'json-bool';
            } else if (/null/.test(match)) {
                cls = 'json-null';
            }
            return `<span class="${cls}">${match}</span>`;
        });
    }

    /**
     * Escape HTML entities
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
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
     * Get terminal-style label for log type
     */
    getLogTypeLabel(eventType) {
        const labels = {
            'started': 'START',
            'completed': 'DONE ',
            'progress': 'PROG ',
            'snapshot': 'SNAP ',
            'failed': 'ERROR',
            'warning': 'WARN ',
            'info': 'INFO '
        };
        return labels[eventType] || 'LOG  ';
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
     * Copy scenes data to clipboard
     */
    copyScenesData(btnEl) {
        const job = this._currentStepData?.job || {};
        const scenes = this._currentStepData?.scenesData || [];
        const lines = [`Scene Breakdown — ${scenes.length} scenes, ${job.meta?.duration || '?'}s total`, ''];
        scenes.forEach((s, i) => {
            const dur = ((s.endTime || 0) - (s.startTime || 0)).toFixed(1);
            const words = (s.text || '').split(/\s+/).filter(w => w).length;
            lines.push(`Scene ${i+1} (${(s.startTime||0).toFixed(1)}s-${(s.endTime||0).toFixed(1)}s = ${dur}s, ${words}w)`);
            lines.push(`  Text: ${s.text || ''}`);
            if (s.keywords?.length) lines.push(`  Keywords: ${s.keywords.join(', ')}`);
            lines.push('');
        });
        this.copyToClipboard(lines.join('\n'), btnEl);
    }

    /**
     * Copy image generation summary to clipboard
     */
    copyImageSummary(btnEl) {
        const job = this._currentStepData?.job || {};
        const seq = job.meta?.image_sequence || [];
        const assets = this._imageAssets || [];
        const cues = this._visualCues || [];
        const anchor = this._imageStoryAnchor;
        
        const lines = [`Image Generation Summary`, `Model: ${job.meta?.image_model || 'gpt-image-1'}`, `Images: ${assets.length}`, `Voice Aligned: ${job.meta?.audio_timestamps?.length ? 'Yes' : 'No'}`, ''];
        
        if (anchor) {
            lines.push('--- Story Anchor ---');
            lines.push(JSON.stringify(anchor, null, 2));
            lines.push('');
        }
        
        if (cues.length) {
            lines.push('--- Visual Cues ---');
            cues.forEach(vc => {
                lines.push(`S${(vc.sceneIndex ?? 0) + 1}: [${vc.sceneType}/${vc.camera}${vc.isClimax ? '/CLIMAX' : ''}] ${vc.description}`);
            });
            lines.push('');
        }
        
        if (seq.length) {
            lines.push('--- Image Sequence ---');
            seq.forEach(e => {
                lines.push(`S${e.sceneIndex + 1}${e.subIndex > 0 ? '.' + (e.subIndex + 1) : ''}: ${e.duration?.toFixed(1)}s, mood ${e.moodLevel}`);
            });
        }
        
        this.copyToClipboard(lines.join('\n'), btnEl);
    }

    /**
     * Copy image sequence manifest to clipboard
     */
    copyImageSequence(btnEl) {
        const job = this._currentStepData?.job || {};
        const seq = job.meta?.image_sequence || [];
        if (!seq.length) {
            this.copyToClipboard('No image sequence data available', btnEl);
            return;
        }
        const lines = ['Image Sequence Manifest', `Total: ${seq.length} images`, ''];
        lines.push('Scene | Sub | Duration | Mood | Asset Key');
        lines.push('------|-----|----------|------|----------');
        seq.forEach(e => {
            lines.push(`S${e.sceneIndex + 1}    | ${e.subIndex || 0}   | ${(e.duration||0).toFixed(1)}s     | ${e.moodLevel || 0}    | ${e.assetKey || '-'}`);
        });
        this.copyToClipboard(lines.join('\n'), btnEl);
    }

    /**
     * Copy visual cues to clipboard
     */
    copyVisualCues(btnEl) {
        const cues = this._visualCues || [];
        if (!cues.length) {
            this.copyToClipboard('No visual cues data available', btnEl);
            return;
        }
        const lines = [`Visual Cues (${cues.length} scenes)`, ''];
        cues.forEach(vc => {
            lines.push(`Scene ${(vc.sceneIndex ?? 0) + 1}:`);
            lines.push(`  Type: ${vc.sceneType || '-'}`);
            lines.push(`  Camera: ${vc.camera || '-'}`);
            lines.push(`  Climax: ${vc.isClimax ? 'YES' : 'no'}`);
            lines.push(`  Description: ${vc.description || '-'}`);
            lines.push('');
        });
        this.copyToClipboard(lines.join('\n'), btnEl);
    }

    /**
     * Copy progress log to clipboard
     */
    copyProgressLog(btnEl) {
        const data = this._currentStepData;
        if (!data?.progress?.length) {
            this.copyToClipboard('No progress log data', btnEl);
            return;
        }
        const lines = data.progress.map(p => {
            const time = new Date(p.created_at).toISOString();
            return `[${time}] ${p.message || ''}`;
        });
        this.copyToClipboard(lines.join('\n'), btnEl);
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
