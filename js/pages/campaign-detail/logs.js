// =====================================================
// CAMPAIGN DETAIL — LOGS & REALTIME
// =====================================================
(function() {
    const CD = window.campaignDetailPage;

    CD.populateJobSelect = function() {
        if (!CD.el.logJobSelect || !CD.jobs?.length) return;
        CD.el.logJobSelect.innerHTML = '<option value="">Select a job to view logs...</option>';

        const sortedJobs = [...CD.jobs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        sortedJobs.forEach((job, index) => {
            const option = document.createElement('option');
            option.value = job.id;
            const statusIcon = CD.getJobStatusIcon(job.status);
            const title = job.story_seed?.substring(0, 40) || `Job ${index + 1}`;
            option.textContent = `${statusIcon} ${title}${title.length >= 40 ? '...' : ''} (${job.status})`;
            CD.el.logJobSelect.appendChild(option);
        });

        const activeStatuses = ['generating', 'assembling', 'rendering', 'processing'];
        const activeJob = sortedJobs.find(j => activeStatuses.includes(j.status));
        if (!CD.selectedJobId) {
            const defaultJob = activeJob || sortedJobs[0];
            if (defaultJob) {
                CD.el.logJobSelect.value = defaultJob.id;
                CD.loadJobLogs(defaultJob.id);
                CD.renderJobs();
            }
        }
    };

    CD.getJobStatusIcon = function(status) {
        return { pending: '⏳', processing: '⚡', complete: '✅', failed: '❌', cancelled: '🚫' }[status] || '❓';
    };

    CD.loadJobLogs = async function(jobId) {
        if (!jobId) {
            CD.currentLogs = [];
            CD.selectedJobId = null;
            CD.renderStepTimeline([]);
            CD.renderLogs();
            if (CD.logsSubscription) {
                supabaseClient.removeChannel(CD.logsSubscription);
                CD.logsSubscription = null;
            }
            return;
        }

        CD.selectedJobId = jobId;
        CD.subscribeToJobLogs(jobId);

        if (CD.el.logsContent) {
            CD.el.logsContent.innerHTML = '<div class="term-log--empty">loading logs...</div>';
        }

        try {
            const { data, error } = await supabaseClient.rpc('get_job_step_logs', { p_job_id: jobId });
            if (error) throw error;
            CD.currentLogs = data || [];
            const currentJob = CD.jobs?.find(j => j.id === jobId);
            CD.renderStepTimeline(CD.currentLogs, currentJob?.status);
            CD.renderLogs();
        } catch (error) {
            console.error('Failed to load job logs:', error);
            try {
                const { data, error: queryError } = await supabaseClient
                    .from('job_step_logs')
                    .select('*')
                    .eq('job_id', jobId)
                    .order('created_at', { ascending: true });
                if (queryError) throw queryError;
                CD.currentLogs = data || [];
                const currentJob = CD.jobs?.find(j => j.id === jobId);
                CD.renderStepTimeline(CD.currentLogs, currentJob?.status);
                CD.renderLogs();
            } catch (fallbackError) {
                console.error('Fallback query also failed:', fallbackError);
                CD.currentLogs = [];
                if (CD.el.logsContent) {
                    CD.el.logsContent.innerHTML = '<div class="term-log--empty">error: failed to load logs — check console</div>';
                }
            }
        }
    };

    CD.renderStepTimeline = function(logs, jobStatus) {
        if (!CD.el.stepTimeline) return;

        const jobIsComplete = jobStatus === 'complete' || jobStatus === 'completed';
        const stepStatus = {};
        const stepDuration = {};

        (logs || []).forEach(log => {
            const step = log.step_name;
            if (!step) return;
            const eventType = log.event_type || log.log_type;
            if (eventType === 'completed') {
                stepStatus[step] = 'completed';
                if (log.meta?.duration_ms || log.duration_ms) stepDuration[step] = log.meta?.duration_ms || log.duration_ms;
            } else if (eventType === 'started' && !stepStatus[step]) {
                stepStatus[step] = 'running';
            } else if (eventType === 'failed') {
                stepStatus[step] = 'failed';
            }
        });

        if (jobIsComplete) {
            CD.pipelineSteps.forEach(step => {
                if (!stepStatus[step] || stepStatus[step] === 'running' || stepStatus[step] === 'pending') {
                    stepStatus[step] = 'completed';
                }
            });
        }

        const statusIcons = {
            pending: '○',
            running: '⟳',
            completed: CD.getStepIcon ? null : '●',
            failed: '✕'
        };

        const timelineHtml = CD.pipelineSteps.map((step, index) => {
            const status = stepStatus[step] || 'pending';
            const duration = stepDuration[step];
            const durationText = duration ? CD.formatDuration(duration) : '';
            const nextStep = CD.pipelineSteps[index + 1];
            const connectorActive = status === 'completed' || status === 'running';
            const icon = status === 'completed' ? (CD.getStepIcon(step) || '●')
                       : status === 'failed' ? '✕'
                       : status === 'running' ? CD.getStepIcon(step) || '⟳'
                       : '○';

            return `
                <div class="step-timeline__step step-timeline__step--${status} ${CD.selectedStepName === step ? 'step-timeline__step--selected' : ''}"
                     title="${step}${durationText ? ` (${durationText})` : ''}"
                     data-step="${step}" onclick="window.campaignDetailPage.openStepDetail('${step}')">
                    <div class="step-timeline__icon">${icon}</div>
                    <div class="step-timeline__name">${step}</div>
                    ${durationText ? `<div class="step-timeline__duration">${durationText}</div>` : ''}
                </div>
                ${nextStep ? `<div class="step-timeline__connector ${connectorActive ? 'step-timeline__connector--active' : ''}"></div>` : ''}
            `;
        }).join('');

        CD.el.stepTimeline.innerHTML = timelineHtml || '<div class="step-timeline__empty">select a job to view pipeline status</div>';
    };

    CD.renderLogs = function() {
        if (!CD.el.logsContent) return;
        if (CD.el.btnCopyLogs) CD.el.btnCopyLogs.disabled = !CD.currentLogs?.length;

        if (!CD.currentLogs?.length) {
            CD.el.logsContent.innerHTML = '<div class="term-log--empty">no logs available for this job</div>';
            return;
        }

        const showSnapshots = CD.el.logShowSnapshots?.checked ?? true;
        const showProgress = CD.el.logShowProgress?.checked ?? true;

        const filteredLogs = CD.currentLogs.filter(log => {
            const eventType = log.event_type || log.log_type;
            if (!showSnapshots && eventType === 'snapshot') return false;
            if (!showProgress && eventType === 'progress') return false;
            return true;
        });

        if (!filteredLogs.length) {
            CD.el.logsContent.innerHTML = '<div class="term-log--empty">no logs match current filters</div>';
            return;
        }

        CD.el.logsContent.innerHTML = filteredLogs.map((log, idx) => CD.renderLogEntry(log, idx + 1)).join('');
        CD.el.logsContent.scrollTop = CD.el.logsContent.scrollHeight;
    };

    CD.renderLogEntry = function(log, lineNum) {
        const dt = new Date(log.created_at);
        const timestamp = dt.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const eventType = log.event_type || log.log_type;
        const levelLabel = CD.getLogTypeLabel(eventType);
        const levelClass = CD.getLogTypeClass(eventType);
        const stepName = log.step_name || 'sys';

        let message = log.message || '';
        if (eventType === 'started') {
            message = `→ starting ${log.step_name || 'step'}`;
        } else if (eventType === 'completed') {
            const dur = log.meta?.duration_ms ? CD.formatDuration(log.meta.duration_ms) : null;
            message = dur ? `✓ completed (${dur})` : '✓ completed';
        } else if (eventType === 'failed') {
            message = `✕ ${log.meta?.error || log.meta?.last_error || message}`;
        } else if (eventType === 'progress') {
            const pct = log.meta?.progress_pct;
            const done = log.meta?.scenes_done || log.meta?.current;
            const total = log.meta?.total_scenes || log.meta?.total;
            if (pct != null) message = `${message} [${Math.round(pct)}%]`;
            else if (done != null && total != null) message = `${message} [${done}/${total}]`;
        }

        const rowClass = eventType === 'failed' ? ' term-log--failed' : (eventType === 'completed' ? ' term-log--completed' : '');

        let metaHtml = '';
        const metaData = log.meta || log.details;
        if (metaData && eventType !== 'started' && eventType !== 'completed') {
            try {
                const obj = typeof metaData === 'string' ? JSON.parse(metaData) : metaData;
                if (Object.keys(obj).length > 0) {
                    metaHtml = `<div class="term-log__meta">${CD.syntaxHighlightJSON(JSON.stringify(obj, null, 2))}</div>`;
                }
            } catch {
                metaHtml = `<div class="term-log__meta">${CD.escapeHtml(String(metaData))}</div>`;
            }
        }

        return `<div class="term-log${rowClass}"><span class="term-log__line">${lineNum}</span><span class="term-log__time">${timestamp}</span><span class="term-log__level term-log__level--${levelClass}">${levelLabel}</span><span class="term-log__step">[${stepName}]</span><span class="term-log__msg">${CD.escapeHtml(message)}</span></div>${metaHtml}`;
    };

    CD.syntaxHighlightJSON = function(json) {
        return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
            let cls = 'json-number';
            if (/^"/.test(match)) { cls = /:$/.test(match) ? 'json-key' : 'json-string'; }
            else if (/true|false/.test(match)) { cls = 'json-bool'; }
            else if (/null/.test(match)) { cls = 'json-null'; }
            return `<span class="${cls}">${match}</span>`;
        });
    };

    CD.getLogTypeClass = function(eventType) {
        return { started: 'started', completed: 'completed', progress: 'progress', snapshot: 'snapshot', failed: 'failed', warning: 'warning', info: 'info' }[eventType] || 'info';
    };

    CD.getLogTypeLabel = function(eventType) {
        return { started: 'START', completed: 'DONE ', progress: 'PROG ', snapshot: 'SNAP ', failed: 'ERROR', warning: 'WARN ', info: 'INFO ' }[eventType] || 'LOG  ';
    };

    CD.copyLogsToClipboard = async function() {
        if (!CD.currentLogs?.length) { CD.showToast('No logs to copy', 'warning'); return; }

        const formattedLogs = CD.currentLogs.map(log => {
            if (log.log_line) return log.log_line;
            const time = new Date(log.created_at).toISOString();
            const eventType = log.event_type || 'LOG';
            const step = log.step_name || 'system';
            const message = log.message || eventType;
            let line = `[${time}] [${eventType.toUpperCase()}] [${step}] ${message}`;
            if (log.details) {
                try {
                    const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                    line += `\n    ${JSON.stringify(details, null, 2).replace(/\n/g, '\n    ')}`;
                } catch { line += `\n    ${log.details}`; }
            }
            return line;
        }).join('\n');

        try {
            await navigator.clipboard.writeText(formattedLogs);
            CD.showToast('Logs copied to clipboard', 'success');
        } catch (error) {
            console.error('Failed to copy logs:', error);
            CD.showToast('Failed to copy logs', 'error');
        }
    };

    // === Real-time subscriptions ===

    CD.subscribeToJobLogs = function(jobId) {
        if (CD.logsSubscription) {
            supabaseClient.removeChannel(CD.logsSubscription);
            CD.logsSubscription = null;
        }
        if (!jobId || typeof supabaseClient === 'undefined') return;

        CD.logsSubscription = supabaseClient
            .channel(`logs-${jobId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_step_logs', filter: `job_id=eq.${jobId}` }, (payload) => {
                if (payload.new) {
                    CD.currentLogs.push(payload.new);
                    CD.renderStepTimeline(CD.currentLogs);
                    CD.renderLogs();
                }
            })
            .subscribe();
    };

    CD.handleJobUpdate = function(payload) {
        const { eventType, new: newJob, old: oldJob } = payload;
        if (eventType === 'INSERT') {
            CD.jobs.push(newJob);
        } else if (eventType === 'UPDATE') {
            const index = CD.jobs.findIndex(j => j.id === newJob.id);
            if (index !== -1) CD.jobs[index] = newJob;
            if (CD.selectedJobId === newJob.id) CD.renderStepTimeline(CD.currentLogs, newJob.status);
        } else if (eventType === 'DELETE') {
            CD.jobs = CD.jobs.filter(j => j.id !== oldJob.id);
        }
        CD.renderJobs();
        CD.populateJobSelect();
        CD.updateStats();
        CD.updateProgress();
    };

    CD.startAutoRefresh = function() {
        if (CD.refreshInterval) clearInterval(CD.refreshInterval);
        const hasProcessingJobs = CD.jobs?.some(j => ['pending', 'queued', 'generating', 'assembling', 'rendering'].includes(j.status));
        if (CD.campaign?.status === 'active' || CD.campaign?.status === 'processing' || hasProcessingJobs) {
            CD.refreshInterval = setInterval(() => CD.loadCampaign(), 15000);
        }
    };

    CD.stopAutoRefresh = function() {
        if (CD.refreshInterval) { clearInterval(CD.refreshInterval); CD.refreshInterval = null; }
    };

    CD.setupRealtimeSubscriptions = function() {
        if (typeof supabaseClient === 'undefined') {
            CD.updateRealtimeIndicator(false);
            return;
        }

        CD.campaignSubscription = supabaseClient
            .channel(`campaign-${CD.campaignId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'generation_batches', filter: `id=eq.${CD.campaignId}` }, (payload) => {
                if (payload.new) { CD.campaign = payload.new; CD.renderCampaign(); }
            })
            .subscribe((status) => CD.updateRealtimeIndicator(status === 'SUBSCRIBED'));

        CD.jobsSubscription = supabaseClient
            .channel(`jobs-${CD.campaignId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `batch_id=eq.${CD.campaignId}` }, (payload) => CD.handleJobUpdate(payload))
            .subscribe();
    };

    CD.updateRealtimeIndicator = function(connected) {
        const indicator = document.getElementById('realtime-indicator');
        if (!indicator) return;
        if (connected) {
            indicator.textContent = '🟢 LIVE';
            indicator.classList.add('connected');
            indicator.title = 'Live updates active - logs will appear automatically';
        } else {
            indicator.textContent = '⚫ OFFLINE';
            indicator.classList.remove('connected');
            indicator.title = 'Live updates unavailable - use refresh button';
        }
    };

    CD.cleanupSubscriptions = function() {
        if (CD.campaignSubscription) { supabaseClient.removeChannel(CD.campaignSubscription); CD.campaignSubscription = null; }
        if (CD.jobsSubscription) { supabaseClient.removeChannel(CD.jobsSubscription); CD.jobsSubscription = null; }
        if (CD.logsSubscription) { supabaseClient.removeChannel(CD.logsSubscription); CD.logsSubscription = null; }
    };
})();
