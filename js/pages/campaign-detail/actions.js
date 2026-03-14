// =====================================================
// CAMPAIGN DETAIL — ACTIONS
// =====================================================
(function() {
    const CD = window.campaignDetailPage;

    CD.cloneCampaign = function() {
        if (!CD.campaign) return;
        const stored = CD.campaign.config || {};
        const config = {
            videoCount: CD.campaign.video_count || stored.videoCount || 7,
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
    };

    CD.confirmAction = function(action) {
        const messages = {
            pause: { title: 'Pause Campaign?', message: 'Pending jobs will not be executed until the campaign is resumed. Jobs currently processing will complete.' },
            resume: { title: 'Resume Campaign?', message: 'Pending jobs will begin executing according to their scheduled times.' },
            cancel: { title: 'Cancel Campaign?', message: 'This will cancel all pending jobs. Completed jobs will not be affected. This action cannot be undone.' }
        };
        const config = messages[action];
        if (!config) return;

        CD.el.confirmTitle.textContent = config.title;
        CD.el.confirmMessage.textContent = config.message;
        CD.confirmCallback = () => CD.executeAction(action);
        CD.openModal();
    };

    CD.executeConfirmedAction = async function() {
        CD.closeModal();
        if (CD.confirmCallback) {
            await CD.confirmCallback();
            CD.confirmCallback = null;
        }
    };

    CD.executeAction = async function(action) {
        try {
            if (typeof campaignManager === 'undefined') throw new Error('Campaign manager not available');
            switch (action) {
                case 'pause':
                    await campaignManager.pauseCampaign(CD.campaignId);
                    CD.showToast('Campaign paused', 'success');
                    break;
                case 'resume':
                    await campaignManager.resumeCampaign(CD.campaignId);
                    CD.showToast('Campaign resumed', 'success');
                    break;
                case 'cancel':
                    await campaignManager.cancelCampaign(CD.campaignId, true);
                    CD.showToast('Campaign cancelled', 'success');
                    break;
            }
            await CD.loadCampaign();
        } catch (error) {
            console.error(`Failed to ${action} campaign:`, error);
            CD.showToast(`Failed to ${action} campaign: ${error.message}`, 'error');
        }
    };

    CD.retryJob = async function(jobId, force = false) {
        try {
            const { data, error } = await supabaseClient.rpc('requeue_failed_job', { p_job_id: jobId, p_force: force });
            if (error) throw error;

            if (!data?.success) {
                const errorMsg = data?.error || 'Unknown error';
                const recommendation = data?.recommendation;
                CD.showToast(recommendation ? `Cannot retry: ${errorMsg}. ${recommendation}` : `Cannot retry: ${errorMsg}`, 'error');
                return;
            }

            const generateBy = data.generate_by ? new Date(data.generate_by) : null;
            const now = new Date();
            if (generateBy && generateBy > now) {
                const waitMinutes = Math.round((generateBy - now) / 60000);
                CD.showToast(`Job requeued (attempt #${data.attempt_count}). Will retry in ~${waitMinutes} min`, 'success');
            } else {
                CD.showToast(`Job requeued for immediate retry (attempt #${data.attempt_count})`, 'success');
            }
            await CD.loadCampaign();
        } catch (error) {
            console.error('Failed to retry job:', error);
            CD.showToast(`Failed to retry job: ${error.message}`, 'error');
        }
    };

    CD.forceRetryJob = async function(jobId) {
        if (!confirm('Force retry bypasses retry policies. The job may fail again immediately. Continue?')) return;
        await CD.retryJob(jobId, true);
    };

    CD.redoJob = async function(jobId) {
        if (!confirm('This will redo the job from scratch — all generated images, audio, and video will be regenerated. Continue?')) return;
        try {
            const { data, error } = await supabaseClient.rpc('redo_job', { p_job_id: jobId });
            if (error) throw error;
            if (!data?.success) {
                CD.showToast(`Cannot redo: ${data?.error || 'Unknown error'}`, 'error');
                return;
            }
            const cleared = data.assets_cleared || 0;
            const posts = data.posts_reset || 0;
            CD.showToast(`Job queued for redo (${cleared} assets cleared, ${posts} posts reset)`, 'success');
            await CD.loadCampaign();
        } catch (error) {
            console.error('Failed to redo job:', error);
            CD.showToast(`Failed to redo job: ${error.message}`, 'error');
        }
    };

    CD.showFailureHistory = async function(jobId) {
        const failures = await CD.getJobFailures(jobId);
        if (failures.length === 0) {
            CD.showToast('No failure history found', 'info');
            return;
        }

        const failuresHtml = failures.map((f, i) => {
            const time = new Date(f.created_at).toLocaleString();
            const classEmoji = { transient: '⚡', dependency: '🔌', misconfig: '⚙️', permanent: '🚫', unknown: '❓' }[f.failure_class] || '❓';
            return `
                <div class="failure-entry">
                    <div class="failure-entry__header">
                        <span class="failure-entry__num">#${failures.length - i}</span>
                        <span class="failure-entry__step">@ ${f.step_name}</span>
                        <span class="failure-entry__class">${classEmoji} ${f.failure_class}</span>
                        <span class="failure-entry__time">${time}</span>
                    </div>
                    <div class="failure-entry__body">
                        <div class="failure-entry__error">${CD.escapeHtml(f.error_message || 'No error message')}</div>
                        ${f.error_signature ? `<div class="failure-entry__signature">Signature: ${f.error_signature}</div>` : ''}
                        <div class="failure-entry__meta">
                            Job attempt: ${f.job_attempt_number} | Step attempt: ${f.step_attempt_number}
                            ${f.retry_eligible ? ' | ✅ Retryable' : ' | ❌ Not retryable'}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        CD.el.confirmTitle.textContent = '📋 Failure History';
        CD.el.confirmMessage.innerHTML = `
            <div class="failure-history">
                <div class="failure-history__summary">Total failures: ${failures.length}</div>
                <div class="failure-history__list">${failuresHtml}</div>
            </div>
        `;
        CD.el.confirmOkBtn.classList.add('hidden');
        CD.el.confirmCancelBtn.textContent = 'Close';
        CD.confirmCallback = null;
        CD.openModal();
    };

    CD.previewVideo = function(videoUrl) {
        if (!videoUrl) { CD.showToast('No video available', 'warning'); return; }
        window.open(videoUrl, '_blank');
    };

    CD.openModal = function() {
        CD.el.confirmModal?.classList.remove('hidden');
    };

    CD.closeModal = function() {
        CD.el.confirmModal?.classList.add('hidden');
        CD.el.confirmOkBtn?.classList.remove('hidden');
        if (CD.el.confirmCancelBtn) CD.el.confirmCancelBtn.textContent = 'Cancel';
    };
})();
