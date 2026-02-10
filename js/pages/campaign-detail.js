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
        
        // Start auto-refresh for active campaigns
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
            
            return `
                <tr>
                    <td>${scheduledAt}</td>
                    <td>${this.formatPresetName(preset)}</td>
                    <td>${platformsHtml || '-'}</td>
                    <td>${this.renderJobStatus(job.status)}</td>
                    <td>
                        ${job.status === 'failed' 
                            ? `<button class="btn btn--ghost btn--sm" onclick="campaignDetailPage.retryJob('${job.id}')">Retry</button>`
                            : '-'
                        }
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
            completed: 'job-status--completed',
            failed: 'job-status--failed',
            cancelled: 'job-status--cancelled'
        };
        
        return `<span class="job-status ${statusClasses[status] || ''}">${status}</span>`;
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

    /**
     * Cleanup on page unload
     */
    destroy() {
        this.stopAutoRefresh();
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
