// =====================================================
// CAMPAIGN DETAIL — STEP DETAILS PANEL
// =====================================================
(function() {
    const CD = window.campaignDetailPage;

    CD.openStepDetail = async function(stepName) {
        if (!CD.selectedJobId) return;
        CD.selectedStepName = stepName;
        const currentJob = CD.jobs?.find(j => j.id === CD.selectedJobId);
        CD.renderStepTimeline(CD.currentLogs, currentJob?.status);
        if (CD.el.stepDetailTitle) CD.el.stepDetailTitle.textContent = `${CD.getStepIcon(stepName)} ${CD.capitalize(stepName)} Details`;
        if (CD.el.stepDetailContent) CD.el.stepDetailContent.innerHTML = '<div style="text-align:center;padding:20px;color:#484f58">Loading step data...</div>';
        try {
            const stepData = await CD.gatherStepData(stepName);
            CD.renderStepDetail(stepName, stepData);
        } catch (err) {
            console.error(`Failed to load ${stepName} details:`, err);
            if (CD.el.stepDetailContent) CD.el.stepDetailContent.innerHTML = `<div style="color:#f85149">Failed to load step details: ${err.message}</div>`;
        }
    };

    CD.closeStepDetail = function() {
        CD.selectedStepName = null;
        if (CD.el.stepDetailTitle) CD.el.stepDetailTitle.textContent = 'Step Details';
        if (CD.el.stepDetailContent) CD.el.stepDetailContent.innerHTML = '<div class="step-detail__empty">click a pipeline step above</div>';
        const currentJob = CD.jobs?.find(j => j.id === CD.selectedJobId);
        CD.renderStepTimeline(CD.currentLogs, currentJob?.status);
    };

    CD.gatherStepData = async function(stepName) {
        const supabase = window.supabaseClient || (typeof getSupabaseClient === 'function' ? getSupabaseClient() : null);
        if (!supabase) throw new Error('Supabase client not available');
        const jobId = CD.selectedJobId;
        const data = { snapshots: [], progress: [], status: null, duration: null, error: null };

        CD.currentLogs.forEach(log => {
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
            const started = CD.currentLogs.find(l => l.step_name === stepName && (l.event_type === 'started' || l.log_type === 'started'));
            if (started) data.status = 'running';
        }

        const { data: jobRecord } = await supabase.from('jobs').select('*').eq('id', jobId).single();
        data.job = jobRecord;
        try { data.stepMeta = (jobRecord?.meta?.steps || {})[stepName] || {}; } catch { data.stepMeta = {}; }

        if (['images', 'img2vid', 'voice', 'music', 'subtitles', 'assemble'].includes(stepName)) {
            const prefix = stepName === 'images' ? `${jobId}:image_generate`
                         : stepName === 'img2vid' ? `${jobId}:img2vid`
                         : stepName === 'voice' ? `${jobId}:voice`
                         : stepName === 'music' ? `${jobId}:music`
                         : stepName === 'subtitles' ? `${jobId}:subtitle`
                         : `${jobId}:assemble`;
            const { data: assets } = await supabase.from('job_assets').select('*').eq('job_id', jobId).like('idempotency_key', `${prefix}%`).order('created_at', { ascending: true });
            data.assets = assets || [];

            if (stepName === 'img2vid') {
                const { data: srcImages } = await supabase.from('job_assets').select('*').eq('job_id', jobId).like('idempotency_key', `${jobId}:image_generate%`).order('created_at', { ascending: true });
                data.sourceImages = srcImages || [];
            }
            if (stepName === 'images') {
                try {
                    const { data: vcAsset } = await supabase.from('job_assets').select('meta').eq('job_id', jobId).eq('idempotency_key', `${jobId}:visual_cues`).maybeSingle();
                    data.visualCues = vcAsset?.meta?.cues || [];
                    const { data: saAsset } = await supabase.from('job_assets').select('meta').eq('job_id', jobId).eq('idempotency_key', `${jobId}:story_anchor`).maybeSingle();
                    data.storyAnchorFull = saAsset?.meta || null;
                    const { data: charRefAsset } = await supabase.from('job_assets').select('meta, public_url').eq('job_id', jobId).eq('idempotency_key', `${jobId}:character_reference`).maybeSingle();
                    data.characterReference = charRefAsset ? { url: charRefAsset.public_url, ...charRefAsset.meta } : null;
                } catch { /* non-critical */ }
            }
        }

        if (['scenes', 'images'].includes(stepName)) {
            const { data: scenesAsset } = await supabase.from('job_assets').select('*').eq('job_id', jobId).eq('idempotency_key', `${jobId}:scenes_subtitles`).maybeSingle();
            data.scenesData = scenesAsset?.meta?.scenes || [];
        }

        if (stepName === 'uniqueness') {
            try {
                const { data: uqAsset } = await supabase.from('job_assets').select('meta').eq('job_id', jobId).eq('idempotency_key', `${jobId}:uniqueness_check`).maybeSingle();
                data.uniquenessAsset = uqAsset?.meta || {};
                const { data: storyAsset } = await supabase.from('job_assets').select('meta').eq('job_id', jobId).eq('idempotency_key', `${jobId}:story_generate`).maybeSingle();
                data.storyMeta = storyAsset?.meta || {};
                const { data: dnaRecord } = await supabase.from('story_dna').select('*').eq('job_id', jobId).maybeSingle();
                data.storyDna = dnaRecord || {};
            } catch { /* non-critical */ }
        }

        if (['story', 'images'].includes(stepName)) {
            try {
                const { data: saAsset } = await supabase.from('job_assets').select('meta').eq('job_id', jobId).eq('idempotency_key', `${jobId}:story_anchor`).maybeSingle();
                data.storyAnchorFull = saAsset?.meta || null;
            } catch { /* non-critical */ }
        }

        return data;
    };

    CD.renderStepDetail = function(stepName, data) {
        if (!CD.el.stepDetailContent) return;
        CD._currentStepData = data;

        const statusBadge = data.status
            ? `<span class="step-detail__badge step-detail__badge--${data.status === 'completed' ? 'success' : data.status === 'failed' ? 'error' : 'warning'}">${data.status}</span>`
            : '';
        const durationText = data.duration ? CD.formatDuration(data.duration) : '';

        let html = `<div class="step-detail__section">
            <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
                ${statusBadge}
                ${durationText ? `<span style="font-size:12px;color:var(--text-secondary)">Duration: ${durationText}</span>` : ''}
            </div>
        </div>`;

        switch (stepName) {
            case 'story': html += CD.renderStoryDetail(data); break;
            case 'uniqueness': html += CD.renderUniquenessDetail(data); break;
            case 'scenes': html += CD.renderScenesDetail(data); break;
            case 'voice': html += CD.renderVoiceDetail(data); break;
            case 'music': html += CD.renderMusicDetail(data); break;
            case 'images': html += CD.renderImagesDetail(data); break;
            case 'img2vid': html += CD.renderImg2VidDetail(data); break;
            case 'subtitles': html += CD.renderSubtitlesDetail(data); break;
            case 'assemble': html += CD.renderAssembleDetail(data); break;
            case 'upload': html += CD.renderUploadDetail(data); break;
            case 'schedule': html += CD.renderScheduleDetail(data); break;
            default: html += CD.renderGenericDetail(data); break;
        }

        if (data.error) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">⚠️ Error</div>
                <div class="step-detail__pre" style="border-color:var(--color-error);color:var(--color-error)">${CD.escapeHtml(data.error)}</div>
            </div>`;
        }
        if (data.snapshots.length > 0) {
            html += `<details style="margin-top:12px">
                <summary style="font-size:12px;color:var(--text-secondary);cursor:pointer">📋 Raw Snapshots (${data.snapshots.length})</summary>
                <div class="step-detail__pre" style="margin-top:8px">${CD.escapeHtml(JSON.stringify(data.snapshots.map(s => ({ label: s.message, meta: s.meta || s.details })), null, 2))}</div>
            </details>`;
        }

        CD.el.stepDetailContent.innerHTML = html;
    };

    // =============================================
    // Per-Step Detail Renderers
    // =============================================

    CD.renderStoryDetail = function(data) {
        const job = data.job || {};
        const promptSnapshot = data.snapshots.find(s => s.message?.includes('prompt'));
        const responseSnapshot = data.snapshots.find(s => s.message?.includes('Generated') || s.message?.includes('response'));
        const promptText = promptSnapshot?.meta?.payload || promptSnapshot?.meta?.data || promptSnapshot?.details || '';
        const responseData = responseSnapshot?.meta?.payload || responseSnapshot?.meta?.data || responseSnapshot?.meta || {};
        const wordCount = responseData.word_count || responseSnapshot?.meta?.word_count || job.story_word_count || '';

        let html = '';

        // Settings
        html += `<div class="step-detail__section">
            <div class="step-detail__label">📋 Settings</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Vibe Preset</span>
                <span class="step-detail__kv-val">${job.vibe_preset || job.meta?.vibe_preset || '-'}</span>
                <span class="step-detail__kv-key">Duration</span>
                <span class="step-detail__kv-val">${CD.formatMetaDuration(job.meta?.duration, job.meta?.length_preset, job.meta?.audio_duration_ms)}</span>
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

        // Horror Scenario
        const vibePreset = job.vibe_preset || job.meta?.vibe_preset || '';
        const scenarioCategory = job.meta?.scenario_category;
        const scenarioStyle = job.meta?.scenario_subreddit_style;
        const scenarioFear = job.meta?.scenario_fear_type;
        const scenarioSetting = job.meta?.scenario_setting_hint;

        if (scenarioCategory || vibePreset === 'reddit_trending_horror') {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎯 Horror Scenario</div>`;
            if (scenarioCategory) {
                const styleLabels = { nosleep: 'r/nosleep', letsnotmeet: 'r/letsnotmeet', creepypasta: 'r/creepypasta', paranormal: 'r/paranormal', shortscarystories: 'r/shortscarystories' };
                html += `<div class="step-detail__kv-grid">
                    <span class="step-detail__kv-key">Category</span>
                    <span class="step-detail__kv-val" style="text-transform:capitalize">${CD.escapeHtml(scenarioCategory.replace(/_/g, ' '))}</span>
                    <span class="step-detail__kv-key">Style</span>
                    <span class="step-detail__kv-val" style="color:var(--color-primary)">${styleLabels[scenarioStyle] || CD.escapeHtml(scenarioStyle || 'horror')}</span>
                    <span class="step-detail__kv-key">Core Fear</span>
                    <span class="step-detail__kv-val" style="text-transform:capitalize">${CD.escapeHtml(scenarioFear || '-')}</span>
                    ${scenarioSetting ? `<span class="step-detail__kv-key">Setting Theme</span>
                    <span class="step-detail__kv-val" style="text-transform:capitalize">${CD.escapeHtml(scenarioSetting)}</span>` : ''}
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
                <div class="step-detail__label">📖 Story: ${CD.escapeHtml(job.title || 'Untitled')}
                    <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyToClipboard(document.getElementById('${storyId}').textContent, this)">📋 Copy</button>
                </div>
                <div class="step-detail__story" id="${storyId}">${CD.escapeHtml(job.story_text || 'No story text available')}</div>
            </div>`;
        }

        // Story Anchor
        if (data.storyAnchorFull) {
            let sa = data.storyAnchorFull;
            if (typeof sa === 'string') { try { sa = JSON.parse(sa); } catch { sa = {}; } }
            if (!sa.environment && sa.meta && typeof sa.meta === 'object' && sa.meta.environment) sa = sa.meta;
            try { CD._storyAnchorText = JSON.stringify(sa, null, 2); } catch { CD._storyAnchorText = '{error: "Could not serialize story anchor"}'; }
            const tone = sa.horrorTone || sa.genreTone || sa.horror_tone || sa.genre_tone || '-';
            const toneLabel = sa.horrorTone ? 'Horror Tone' : (sa.genreTone ? 'Genre Tone' : 'Tone');
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎯 Story Anchor (Visual Bible)
                    <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyToClipboard(window.campaignDetailPage._storyAnchorText, this)">📋 Copy</button>
                </div>
                <div class="step-detail__kv-grid">
                    <span class="step-detail__kv-key">Environment</span>
                    <span class="step-detail__kv-val">${CD.escapeHtml(sa.environment || '-')}</span>
                    <span class="step-detail__kv-key">Character(s)</span>
                    <span class="step-detail__kv-val">${CD.escapeHtml(CD.formatCharacterDescription(sa.characterDescription))}</span>
                    <span class="step-detail__kv-key">Recurring Motifs</span>
                    <span class="step-detail__kv-val">${CD.escapeHtml(sa.recurringMotifs || '-')}</span>
                    <span class="step-detail__kv-key">${toneLabel}</span>
                    <span class="step-detail__kv-val">${CD.escapeHtml(tone)}</span>
                    <span class="step-detail__kv-key">Time of Day</span>
                    <span class="step-detail__kv-val">${CD.escapeHtml(sa.timeOfDay || '-')}</span>
                    <span class="step-detail__kv-key">Group Story</span>
                    <span class="step-detail__kv-val">${sa.isGroupStory ? `Yes (${sa.groupCount || '?'} people)` : 'No'}</span>
                </div>
            </div>`;
        }

        // Prompt
        if (promptText) {
            const promptStr = typeof promptText === 'object' ? JSON.stringify(promptText, null, 2) : promptText;
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🧠 Story Prompt
                    <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyToClipboard(document.getElementById('story-prompt-pre').textContent, this)">📋 Copy</button>
                </div>
                <div class="step-detail__pre" id="story-prompt-pre">${CD.escapeHtml(promptStr)}</div>
            </div>`;
        }

        return html;
    };

    CD.renderUniquenessDetail = function(data) {
        const job = data.job || {};
        const meta = data.stepMeta || {};
        const innerMeta = meta.meta || {};
        const uqAsset = data.uniquenessAsset || {};
        const storyMeta = data.storyMeta || {};
        const dna = data.storyDna || {};

        const rawScore = uqAsset.uniqueness_score ?? innerMeta.uniqueness_score ?? meta.uniqueness_score ?? job.uniqueness_score;
        const score = rawScore !== undefined && rawScore !== null ? Math.round(rawScore <= 1 ? rawScore * 100 : rawScore) : '-';
        const scoreColor = score !== '-' && score >= 70 ? '#3fb950' : score !== '-' && score >= 40 ? '#d29922' : '#f85149';
        const scoreLabel = score !== '-' && score >= 90 ? 'Highly Unique' : score !== '-' && score >= 70 ? 'Unique' : score !== '-' && score >= 40 ? 'Moderate' : 'Low Uniqueness';

        const collisionCount = uqAsset.collision_count ?? innerMeta.collision_count ?? 0;
        const hasCollision = uqAsset.has_collision ?? innerMeta.has_collision ?? collisionCount > 0;

        const conceptHash = dna.concept_hash || storyMeta.concept_hash || '';
        const fullHash = dna.full_hash || (uqAsset.story_hash || innerMeta.story_hash || meta.story_hash || '');
        const setting = storyMeta.setting || dna.meta?.setting || '';
        const concept = storyMeta.concept || dna.meta?.concept || '';
        const genre = dna.genre || job.vibe_preset || job.meta?.vibe_preset || '';
        const title = dna.meta?.title || job.title || '';

        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🔍 Uniqueness Score</div>
            <div style="display:flex;align-items:baseline;gap:12px">
                <span style="font-size:32px;font-weight:700;color:${scoreColor};font-family:var(--font-mono)">${score}%</span>
                <span style="font-size:12px;color:${scoreColor};font-family:var(--font-mono)">${scoreLabel}</span>
            </div>
        </div>`;

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
                <span class="step-detail__kv-val" style="font-size:11px;color:#8b949e">${hasCollision ? 'Collision detected → score set to 50%' : 'No collision → score set to 95%'}</span>
            </div>
        </div>`;

        if (setting || concept || genre) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🧬 Story DNA</div>
                <div class="step-detail__kv-grid">
                    ${title ? `<span class="step-detail__kv-key">Title</span><span class="step-detail__kv-val">${CD.escapeHtml(title)}</span>` : ''}
                    ${setting ? `<span class="step-detail__kv-key">Setting</span><span class="step-detail__kv-val">${CD.escapeHtml(setting)}</span>` : ''}
                    ${concept ? `<span class="step-detail__kv-key">Concept</span><span class="step-detail__kv-val">${CD.escapeHtml(concept)}</span>` : ''}
                    ${genre ? `<span class="step-detail__kv-key">Genre / Preset</span><span class="step-detail__kv-val"><span class="step-detail__badge step-detail__badge--info">${CD.escapeHtml(genre)}</span></span>` : ''}
                </div>
            </div>`;
        }

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

        if (collisionCount > 0) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">⚠️ Collision Details</div>
                <div style="font-size:12px;color:#d29922;line-height:1.6;padding:8px 12px;background:rgba(210,153,34,0.06);border:1px solid rgba(210,153,34,0.2);border-radius:6px">
                    ${collisionCount} other stor${collisionCount === 1 ? 'y' : 'ies'} in the same brand share the same concept hash (setting + concept).
                    This means the story theme/premise is similar to existing content.
                </div>
            </div>`;
        }

        const tips = [];
        if (score !== '-') {
            if (!concept && !setting) tips.push({ icon: '🎯', area: 'Concept Metadata', tip: 'Story has no extracted setting or concept — the uniqueness check fell back to full-text hashing. Richer concept metadata would enable smarter thematic comparison.' });
            if (hasCollision) tips.push({ icon: '🔄', area: 'Theme Overlap', tip: `${collisionCount} other story shares the same setting + concept combination. Use a completely different location or premise to avoid thematic repetition.` });
            if (!hasCollision) {
                tips.push({ icon: '📐', area: 'Title Similarity', tip: 'The system currently checks concept-level collisions but doesn\'t compare title phrasing across stories. Varying your title structure adds another layer of differentiation.' });
                tips.push({ icon: '🪝', area: 'Hook Variation', tip: 'Try varying the opening hook style — alternate between factual hooks, cold-open immersion, or counting/number hooks. Diverse hooks prevent audience pattern fatigue.' });
                tips.push({ icon: '🧩', area: 'Narrative Structure', tip: 'Rotate between story structures: linear chronological, dual-timeline, reverse reveal, or documentary reconstruction. Same concept with different structure feels like a different story.' });
                tips.push({ icon: '👥', area: 'Character Archetypes', tip: 'Swap character archetypes between posts — unreliable narrator, reluctant investigator, oblivious bystander, calm documentarian. Each archetype changes how the same horror lands.' });
                tips.push({ icon: '🌡️', area: 'Tone Spectrum', tip: 'Shift tone across posts: clinical/factual → confessional/intimate → sardonic/dark humor → slow-burn dread. Keeps the brand unpredictable even within the same genre.' });
            }
        }

        if (tips.length > 0) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">💡 How to Reach 100% Uniqueness</div>
                <div style="font-size:12px;line-height:1.7;display:flex;flex-direction:column;gap:8px">
                    ${score !== '-' && !hasCollision ? `<div style="color:#8b949e;margin-bottom:4px">Score is <strong style="color:#3fb950">${score}%</strong> — no concept collisions detected. The remaining <strong>${100 - score}%</strong> represents dimensions the system doesn't yet measure automatically. Here's what would push it higher:</div>` : ''}
                    ${tips.map(t => `<div style="padding:8px 12px;background:rgba(88,166,255,0.04);border:1px solid rgba(88,166,255,0.12);border-radius:6px">
                        <div style="font-weight:600;color:#c9d1d9;margin-bottom:2px">${t.icon} ${t.area}</div>
                        <div style="color:#8b949e">${t.tip}</div>
                    </div>`).join('')}
                </div>
            </div>`;
        }

        return html;
    };

    CD.renderScenesDetail = function(data) {
        const scenes = data.scenesData || [];
        const job = data.job || {};
        const totalDuration = parseFloat(job.meta?.duration || job.meta?.audio_duration || 60);
        const hasTimestamps = !!job.meta?.audio_timestamps?.length;

        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🎬 Scene Breakdown (${scenes.length} scenes)
                <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyScenesData(this)">📋 Copy All</button>
            </div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Scene Count</span><span class="step-detail__kv-val">${scenes.length}</span>
                <span class="step-detail__kv-key">Duration</span><span class="step-detail__kv-val">${totalDuration}s</span>
                <span class="step-detail__kv-key">Pace</span><span class="step-detail__kv-val">${job.meta?.pace || 'balanced'}</span>
                <span class="step-detail__kv-key">Voice Aligned</span>
                <span class="step-detail__kv-val">${hasTimestamps
                    ? '<span class="voice-aligned-badge voice-aligned-badge--yes">🎙️ Yes</span>'
                    : '<span class="voice-aligned-badge voice-aligned-badge--no">— No timestamps</span>'}</span>
                <span class="step-detail__kv-key">Timing Mode</span><span class="step-detail__kv-val">${hasTimestamps ? 'Voice-aligned' : 'Word-proportional'}</span>
            </div>
        </div>`;

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
                        return `<div style="padding:8px;margin-bottom:4px;background:var(--bg-primary);border-radius:4px;border-left:3px solid var(--color-primary);font-size:12px">
                            <div style="display:flex;align-items:center;gap:6px">
                                <strong style="color:var(--text-secondary)">Scene ${i + 1}</strong>
                                <span style="color:var(--text-secondary);font-size:11px">(${(s.startTime || 0).toFixed(1)}s - ${(s.endTime || 0).toFixed(1)}s = ${dur}s)</span>
                                <span style="font-size:10px;color:var(--text-secondary)">${words}w · ${wps}w/s</span>
                                ${parseFloat(dur) > 10 ? '<span class="multi-image-badge">multi-img</span>' : ''}
                            </div>
                            <div style="margin-top:4px;color:var(--text-primary)">${CD.escapeHtml((s.text || '').substring(0, 200))}${(s.text || '').length > 200 ? '...' : ''}</div>
                            ${s.keywords?.length ? `<div style="margin-top:4px;font-size:11px;color:var(--text-secondary)">Keywords: ${s.keywords.join(', ')}</div>` : ''}
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        return html;
    };

    CD.renderVoiceDetail = function(data) {
        const payloadSnap = data.snapshots.find(s => s.message?.includes('request') || s.message?.includes('payload'));
        const resultSnap = data.snapshots.find(s => s.message?.includes('result') || s.message?.includes('response'));
        const payload = payloadSnap?.meta || payloadSnap?.details || {};
        const result = resultSnap?.meta || resultSnap?.details || {};
        const payloadData = payload.payload || payload.data || payload;
        const resultData = result.payload || result.data || result;

        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🎙️ Voice Configuration</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Voice ID</span><span class="step-detail__kv-val">${payloadData.voice_id || '-'}</span>
                <span class="step-detail__kv-key">Model</span><span class="step-detail__kv-val">${payloadData.model || payloadData.model_id || 'eleven_turbo_v2'}</span>
                <span class="step-detail__kv-key">Stability</span><span class="step-detail__kv-val">${payloadData.stability ?? '-'}</span>
                <span class="step-detail__kv-key">Similarity</span><span class="step-detail__kv-val">${payloadData.similarity_boost ?? '-'}</span>
            </div>
        </div>`;

        if (resultData.duration_seconds || resultData.file_size_kb) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">📊 Output</div>
                <div class="step-detail__kv-grid">
                    <span class="step-detail__kv-key">Audio Duration</span><span class="step-detail__kv-val">${resultData.duration_seconds ? resultData.duration_seconds.toFixed(1) + 's' : '-'}</span>
                    <span class="step-detail__kv-key">File Size</span><span class="step-detail__kv-val">${resultData.file_size_kb ? resultData.file_size_kb + ' KB' : '-'}</span>
                </div>
            </div>`;
        }

        const voiceAsset = data.assets?.find(a => a.public_url);
        if (voiceAsset?.public_url) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🔊 Audio Preview</div>
                <audio controls style="width:100%;margin-top:4px" src="${voiceAsset.public_url}">Your browser does not support audio</audio>
            </div>`;
        }

        return html;
    };

    CD.renderMusicDetail = function(data) {
        const job = data.job || {};
        const assets = data.assets || [];
        const musicAsset = assets.find(a => a.idempotency_key?.includes('music_select') || a.idempotency_key?.includes('music'));
        const assetMeta = musicAsset?.meta || {};
        const outputSnap = data.snapshots.find(s => s.message?.includes('Selected') || s.message?.includes('output') || s.message?.includes('snapshot'));
        const snapData = outputSnap?.meta?.payload || outputSnap?.meta?.data || outputSnap?.meta || {};
        const jobMeta = job.meta || {};

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
                <span class="step-detail__kv-key">Track</span><span class="step-detail__kv-val" style="font-weight:600">${CD.escapeHtml(String(trackName))}</span>
                ${trackMood ? `<span class="step-detail__kv-key">Mood</span><span class="step-detail__kv-val">${CD.escapeHtml(String(trackMood))}</span>` : ''}
                ${trackDuration ? `<span class="step-detail__kv-key">Duration</span><span class="step-detail__kv-val">${Number(trackDuration).toFixed(1)}s</span>` : ''}
                ${trackLoopable !== undefined ? `<span class="step-detail__kv-key">Loopable</span><span class="step-detail__kv-val">${trackLoopable ? '✅ Yes' : '❌ No'}</span>` : ''}
                ${musicSource ? `<span class="step-detail__kv-key">Source</span><span class="step-detail__kv-val">${CD.escapeHtml(String(musicSource))}</span>` : ''}
            </div>
        </div>`;

        if (volume !== '' || fadeIn !== '' || fadeOut !== '') {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎛️ Mixing</div>
                <div class="step-detail__kv-grid">
                    ${volume !== '' ? `<span class="step-detail__kv-key">Volume</span><span class="step-detail__kv-val">${volume}</span>` : ''}
                    ${duckingEnabled !== undefined ? `<span class="step-detail__kv-key">Voice Ducking</span><span class="step-detail__kv-val">${duckingEnabled ? '✅ Enabled' : '❌ Off'}</span>` : ''}
                    ${fadeIn !== '' ? `<span class="step-detail__kv-key">Fade In</span><span class="step-detail__kv-val">${fadeIn}ms</span>` : ''}
                    ${fadeOut !== '' ? `<span class="step-detail__kv-key">Fade Out</span><span class="step-detail__kv-val">${fadeOut}ms</span>` : ''}
                </div>
            </div>`;
        }

        if (musicUrl) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🔊 Track Preview</div>
                <audio controls style="width:100%;margin-top:4px" src="${CD.escapeHtml(musicUrl)}">Your browser does not support audio</audio>
            </div>`;
        }

        return html;
    };

    CD.renderImagesDetail = function(data) {
        const promptSnap = data.snapshots.find(s => s.message?.includes('prompt'));
        const promptData = promptSnap?.meta?.payload || promptSnap?.meta?.data || promptSnap?.meta || {};
        const assets = data.assets || [];
        const progress = data.progress || [];
        const job = data.job || {};

        const imageAssets = assets.filter(a => a.public_url && a.idempotency_key?.includes('image_generate')).sort((a, b) => {
            const aIdx = parseInt(a.idempotency_key?.split('scene_')[1] || '0');
            const bIdx = parseInt(b.idempotency_key?.split('scene_')[1] || '0');
            return aIdx - bIdx;
        });

        const vcSnap = data.snapshots.find(s => s.message?.includes('Visual cues'));
        const vcData = vcSnap?.meta?.payload || vcSnap?.meta?.data || vcSnap?.meta || {};
        const storyAnchorInfo = vcData.story_anchor || data.storyAnchorFull || null;
        const sceneTypeDistribution = vcData.scene_type_distribution || null;

        const imageModel = promptData.model || data.stepMeta?.image_model || job.meta?.image_model || '-';
        const derivedSize = promptData.size || ({'gpt-image-1': '1024x1536', 'dall-e-3': '1024x1792', 'dall-e-2': '1024x1024', 'comfyui': '1024x1536'}[imageModel] || '-');
        const imageSequence = job.meta?.image_sequence || [];
        const hasVoiceAlignment = !!job.meta?.audio_timestamps?.length;
        const multiImageCount = imageSequence.filter(e => e.subIndex > 0).length;
        const totalScenes = data.stepMeta?.total_scenes || progress[progress.length - 1]?.meta?.total || imageAssets.length || '?';

        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🖼️ Image Generation
                <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyImageSummary(this)">📋 Copy Summary</button>
            </div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Model</span><span class="step-detail__kv-val">${imageModel}</span>
                <span class="step-detail__kv-key">Size</span><span class="step-detail__kv-val">${derivedSize}</span>
                <span class="step-detail__kv-key">Generated</span><span class="step-detail__kv-val">${imageAssets.length} / ${totalScenes}</span>
                <span class="step-detail__kv-key">Story Anchor</span><span class="step-detail__kv-val">${storyAnchorInfo ? '✅ Used' : '❌ Not used'}</span>
                <span class="step-detail__kv-key">Char Reference</span>
                <span class="step-detail__kv-val">${data.characterReference?.url
                    ? '✅ <a href="' + data.characterReference.url + '" target="_blank" style="color:var(--color-accent)">View Portrait</a>'
                    : '— None'}</span>
                <span class="step-detail__kv-key">Voice Aligned</span>
                <span class="step-detail__kv-val">${hasVoiceAlignment
                    ? '<span class="voice-aligned-badge voice-aligned-badge--yes">🎙️ Yes</span>'
                    : '<span class="voice-aligned-badge voice-aligned-badge--no">— No</span>'}</span>
                <span class="step-detail__kv-key">Multi-Image Scenes</span><span class="step-detail__kv-val">${multiImageCount > 0 ? `${multiImageCount} extra images` : 'None (all ≤10s)'}</span>
            </div>
        </div>`;

        // Image Sequence Manifest
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
                        const isAnimated = entry.animate === true;
                        const motionLabel = entry.motionType || '';
                        return `<div class="duration-bar${isAnimated ? ' duration-bar--animated' : ''}" style="height:${pct}%;background:${color}${isMulti ? ';border:1px dashed rgba(255,255,255,0.3)' : ''}">
                            <div class="duration-bar__tooltip">S${entry.sceneIndex + 1}${isMulti ? '.' + (entry.subIndex + 1) : ''}: ${dur}s · mood ${mood}${isAnimated ? ' · 🎬 ' + motionLabel : ''}</div>
                            ${isAnimated ? '<div class="duration-bar__anim-dot" title="Designed for animation: ' + motionLabel + '">🎬</div>' : ''}
                        </div>`;
                    }).join('')}
                </div>
                <div style="display:flex;gap:12px;font-size:10px;color:var(--text-secondary);margin-top:4px;flex-wrap:wrap">
                    <span style="display:flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:2px;background:#3B82F6"></span> Gentle (1-3)</span>
                    <span style="display:flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:2px;background:#F59E0B"></span> Building (4-6)</span>
                    <span style="display:flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:2px;background:#EF4444"></span> Intense (7-10)</span>
                    <span style="display:flex;align-items:center;gap:3px"><span style="font-size:10px">🎬</span> Animation Intent</span>
                </div>
            </div>`;

            // Mood level pills
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎭 Mood Levels (Ken Burns Intensity)</div>
                <div class="mood-pills">
                    ${imageSequence.map((entry, i) => {
                        const mood = entry.moodLevel || 0;
                        const cls = mood >= 7 ? 'mood-pill--high' : mood >= 4 ? 'mood-pill--mid' : 'mood-pill--low';
                        const animCls = entry.animate ? ' mood-pill--animate' : '';
                        const animTitle = entry.animate ? ` · 🎬 ${entry.motionType || 'animated'}` : '';
                        return `<span class="mood-pill ${cls}${animCls}" title="Scene ${entry.sceneIndex + 1}${entry.subIndex > 0 ? '.' + (entry.subIndex + 1) : ''}: mood ${mood}${animTitle}">${mood}</span>`;
                    }).join('')}
                </div>
            </div>`;
        }

        // Story Anchor details
        const anchorSource = data.storyAnchorFull || storyAnchorInfo;
        if (anchorSource) {
            let sa = anchorSource;
            if (typeof sa === 'string') { try { sa = JSON.parse(sa); } catch { sa = {}; } }
            if (!sa.environment && sa.meta && typeof sa.meta === 'object' && sa.meta.environment) sa = sa.meta;
            try { CD._imagesStoryAnchorText = JSON.stringify(sa, null, 2); } catch { CD._imagesStoryAnchorText = '{error: "Could not serialize"}'; }
            const tone = sa.horrorTone || sa.genreTone || sa.horror_tone || sa.genre_tone || '-';
            const toneLabel = sa.horrorTone ? 'Horror Tone' : (sa.genreTone ? 'Genre Tone' : 'Tone');
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎯 Story Anchor
                    <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyToClipboard(window.campaignDetailPage._imagesStoryAnchorText, this)">📋 Copy</button>
                </div>
                <div class="step-detail__kv-grid">
                    <span class="step-detail__kv-key">Environment</span><span class="step-detail__kv-val">${CD.escapeHtml(sa.environment || '-')}</span>
                    <span class="step-detail__kv-key">Character(s)</span><span class="step-detail__kv-val">${CD.escapeHtml(CD.formatCharacterDescription(sa.characterDescription))}</span>
                    <span class="step-detail__kv-key">Recurring Motifs</span><span class="step-detail__kv-val">${CD.escapeHtml(sa.recurringMotifs || '-')}</span>
                    <span class="step-detail__kv-key">${toneLabel}</span><span class="step-detail__kv-val">${CD.escapeHtml(tone)}</span>
                    <span class="step-detail__kv-key">Time of Day</span><span class="step-detail__kv-val">${CD.escapeHtml(sa.timeOfDay || '-')}</span>
                    <span class="step-detail__kv-key">Group Story</span><span class="step-detail__kv-val">${sa.isGroupStory ? `Yes (${sa.groupCount || '?'} people)` : 'No'}</span>
                </div>
            </div>`;
        }

        // Visual Cues
        if (data.visualCues?.length) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">👁️ Visual Cues (${data.visualCues.length})
                    <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyVisualCues(this)">📋 Copy</button>
                </div>
                <div style="max-height:200px;overflow-y:auto">
                    ${data.visualCues.map((vc, i) => {
                        const animBadge = vc.animate ? `<span class="vc-anim-badge" title="${CD.escapeHtml(vc.animationHint || vc.motionType || 'animated')}">🎬 ${CD.escapeHtml(vc.motionType || 'anim')}</span>` : '';
                        return `<div style="padding:4px 8px;margin-bottom:2px;font-size:11px;background:var(--bg-primary);border-radius:3px;display:flex;gap:8px;align-items:flex-start${vc.animate ? ';border-left:2px solid #A855F7' : ''}">
                            <strong style="color:var(--text-secondary);min-width:20px">S${(vc.sceneIndex ?? i) + 1}</strong>
                            <span style="color:var(--text-primary);flex:1">${CD.escapeHtml(vc.description || '-')}</span>
                            <span style="font-size:10px;color:var(--text-secondary);white-space:nowrap">${vc.sceneType || '-'} · ${vc.camera || '-'}${vc.isClimax ? ' · 🔥' : ''}${animBadge ? ' ' + animBadge : ''}</span>
                        </div>`;
                    }).join('')}
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

        // Consistency audit
        const consistencySnap = data.snapshots.find(s => s.message?.includes('Consistency audit') || s.message?.includes('consistency_audit'));
        const consistencyData = consistencySnap?.meta?.payload || consistencySnap?.meta?.data || consistencySnap?.meta || {};
        const consistencyFixes = consistencyData.fixes || [];
        if (consistencyFixes.length > 0) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🔧 Continuity Fixes (${consistencyFixes.length})</div>
                <div style="max-height:200px;overflow-y:auto">
                    ${consistencyFixes.map(f => `<div style="padding:6px 8px;margin-bottom:4px;font-size:11px;background:var(--bg-primary);border-radius:4px;border-left:3px solid #F59E0B">
                        <div style="font-weight:600;color:#F59E0B;margin-bottom:2px">S${(f.scene ?? 0) + 1}: ${CD.escapeHtml(f.issue || 'continuity fix')}</div>
                        <div style="color:var(--text-secondary)"><span style="text-decoration:line-through">${CD.escapeHtml((f.before || '').substring(0, 120))}</span></div>
                        <div style="color:var(--text-primary);margin-top:2px">→ ${CD.escapeHtml((f.after || '').substring(0, 120))}</div>
                    </div>`).join('')}
                </div>
            </div>`;
        }

        // Sample prompt
        if (promptData.prompt) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🧠 Sample Prompt (Scene ${(promptData.scene_index || 0) + 1})
                    <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyToClipboard(document.getElementById('sample-prompt-pre').textContent, this)">📋 Copy</button>
                </div>
                <div class="step-detail__pre" id="sample-prompt-pre">${CD.escapeHtml(promptData.prompt)}</div>
            </div>`;
        }

        // Image grid
        if (imageAssets.length > 0) {
            CD._imageAssets = imageAssets;
            CD._imagePromptSnapshots = data.snapshots.filter(s => s.message?.includes('prompt'));
            CD._imageScenes = data.scenesData || [];
            CD._imageStoryAnchor = data.storyAnchorFull || storyAnchorInfo;
            CD._imageSequence = imageSequence;
            CD._visualCues = data.visualCues || [];
            CD._characterReference = data.characterReference || null;

            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎨 Generated Images (${imageAssets.length}) <span style="font-size:11px;color:var(--text-secondary);font-weight:normal">— click for details</span></div>
                <div class="step-detail__image-grid">
                    ${imageAssets.map((a, i) => {
                        const sceneIdx = parseInt(a.idempotency_key?.split('scene_')[1] || i);
                        const seqEntry = imageSequence.find(e => e.sceneIndex === sceneIdx && (e.subIndex || 0) === 0);
                        const dur = seqEntry ? seqEntry.duration.toFixed(1) + 's' : '';
                        const mood = seqEntry ? seqEntry.moodLevel : '';
                        const isAnimIntent = seqEntry?.animate === true;
                        const motionType = seqEntry?.motionType || '';
                        return `<div class="step-detail__image-item step-detail__image-item--clickable${isAnimIntent ? ' step-detail__image-item--animate' : ''}" data-scene-index="${sceneIdx}" onclick="window.campaignDetailPage.showImageDetail(${sceneIdx})">
                            <img src="${a.public_url}" alt="Scene ${sceneIdx + 1}" loading="lazy">
                            ${isAnimIntent ? '<div class="step-detail__image-item__anim-badge" title="Designed for animation: ' + motionType + '">🎬 ' + motionType + '</div>' : ''}
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
    };

    CD.showImageDetail = function(sceneIndex) {
        const imageAssets = CD._imageAssets || [];
        const asset = imageAssets.find(a => parseInt(a.idempotency_key?.split('scene_')[1] || '-1') === sceneIndex);
        if (!asset) return;

        const meta = asset.meta || {};
        const scenes = CD._imageScenes || [];
        const sceneData = scenes[sceneIndex] || {};
        const promptSnaps = CD._imagePromptSnapshots || [];
        const matchingSnap = promptSnaps.find(s => (s.meta?.payload?.scene_index ?? s.meta?.data?.scene_index ?? s.meta?.scene_index) === sceneIndex);
        const snapData = matchingSnap?.meta?.payload || matchingSnap?.meta?.data || matchingSnap?.meta || {};
        const prompt = snapData.prompt || meta.prompt || 'Prompt not recorded for this scene';
        const allVisualCues = CD._visualCues || [];
        const assetVisualCue = allVisualCues.find(vc => vc.sceneIndex === sceneIndex);
        const visualCue = snapData.visual_cue || (assetVisualCue ? { type: assetVisualCue.sceneType, sceneType: assetVisualCue.sceneType, camera: assetVisualCue.camera, description: assetVisualCue.description, isClimax: assetVisualCue.isClimax } : null);
        const artStyle = meta.art_style || snapData.art_style || '-';
        const imageModel = meta.image_model || snapData.model || '-';
        const seqEntries = (CD._imageSequence || []).filter(e => e.sceneIndex === sceneIndex);
        const seqEntry = seqEntries[0] || {};

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
                                <span>Model</span><span>${CD.escapeHtml(imageModel)}</span>
                                <span>Art Style</span><span>${CD.escapeHtml(artStyle)}</span>
                                <span>Scene Type</span><span>${CD.escapeHtml(visualCue?.type || visualCue?.sceneType || '-')}</span>
                                <span>Camera</span><span>${CD.escapeHtml(visualCue?.camera || '-')}</span>
                                <span>Duration</span><span>${seqEntry.duration ? seqEntry.duration.toFixed(1) + 's' : '-'}</span>
                                <span>Mood Level</span><span>${seqEntry.moodLevel || '-'}</span>
                                <span>Multi-Image</span><span>${seqEntries.length > 1 ? seqEntries.length + ' images' : 'No'}</span>
                                ${visualCue?.isClimax ? '<span>Climax</span><span style="color:#EF4444;font-weight:600">🔥 YES</span>' : ''}
                                ${meta.prompt_hash ? `<span>Prompt Hash</span><span style="font-family:monospace;font-size:11px">${meta.prompt_hash.substring(0, 16)}...</span>` : ''}
                            </div>
                        </div>
                        ${(() => {
                            const anchor = CD._imageStoryAnchor;
                            if (!anchor) return '';
                            return `
                        <div class="image-detail-modal__section">
                            <div class="image-detail-modal__label">🎯 Story Anchor (Consistency Context)</div>
                            <div class="image-detail-modal__kv">
                                <span>Environment</span><span style="font-size:12px">${CD.escapeHtml(anchor.environment || '-')}</span>
                                <span>Character(s)</span><span style="font-size:12px">${CD.escapeHtml(anchor.characterDescription || '-')}</span>
                                <span>Horror Tone</span><span style="font-size:12px">${CD.escapeHtml(anchor.horrorTone || '-')}</span>
                                <span>Time of Day</span><span style="font-size:12px">${CD.escapeHtml(anchor.timeOfDay || '-')}</span>
                                <span>Motifs</span><span style="font-size:12px">${CD.escapeHtml(anchor.recurringMotifs || '-')}</span>
                                <span>Group Story</span><span>${anchor.isGroupStory ? 'Yes (' + (anchor.groupCount || '?') + ' characters)' : 'No (solo)'}</span>
                                <span>Ref Image</span><span>${CD._characterReference?.url
                                    ? (meta.character_reference_used
                                        ? '✅ <a href="' + CD._characterReference.url + '" target="_blank" style="color:var(--color-accent)">Used for this scene</a>'
                                        : '📷 <a href="' + CD._characterReference.url + '" target="_blank" style="color:var(--text-secondary)">Available (not used for ' + (visualCue?.sceneType || 'this') + ' scene)</a>')
                                    : '<span style="color:var(--text-secondary);font-style:italic">None — text-only anchoring</span>'}</span>
                            </div>
                        </div>`;
                        })()}
                        ${visualCue ? `
                        <div class="image-detail-modal__section">
                            <div class="image-detail-modal__label">👁️ Visual Cue</div>
                            <p style="font-size:13px;color:var(--text-primary);line-height:1.5">${CD.escapeHtml(visualCue.description || '-')}</p>
                        </div>` : ''}
                        ${sceneData.text ? `
                        <div class="image-detail-modal__section">
                            <div class="image-detail-modal__label">📖 Scene Narration</div>
                            <p style="font-size:13px;color:var(--text-primary);line-height:1.5">${CD.escapeHtml(sceneData.text)}</p>
                            ${sceneData.keywords?.length ? `<div style="margin-top:6px;font-size:11px;color:var(--text-secondary)">Keywords: ${sceneData.keywords.join(', ')}</div>` : ''}
                        </div>` : ''}
                        <div class="image-detail-modal__section">
                            <div class="image-detail-modal__label" style="display:flex;justify-content:space-between;align-items:center">
                                🧠 Full Prompt
                                <button class="step-detail__copy-btn" onclick="navigator.clipboard.writeText(this.closest('.image-detail-modal__section').querySelector('pre').textContent).then(()=>{this.textContent='✓ Copied';setTimeout(()=>this.textContent='📋 Copy',1500)})">📋 Copy</button>
                            </div>
                            <pre class="image-detail-modal__prompt">${CD.escapeHtml(prompt)}</pre>
                        </div>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        const escHandler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);
    };

    CD.renderSubtitlesDetail = function(data) {
        const job = data.job || {};
        return `<div class="step-detail__section">
            <div class="step-detail__label">📝 Subtitle Configuration</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Caption Style</span><span class="step-detail__kv-val">${job.meta?.caption_style || 'default'}</span>
                <span class="step-detail__kv-key">Platform</span><span class="step-detail__kv-val">${job.meta?.platform && job.meta.platform !== 'default' ? job.meta.platform : (job.meta?.platforms?.length ? job.meta.platforms.join(', ') : '-')}</span>
            </div>
        </div>`;
    };

    CD.renderImg2VidDetail = function(data) {
        const resultSnap = data.snapshots.find(s => s.message?.includes('img2vid') || s.message?.includes('result'));
        const configSnap = data.snapshots.find(s => s.message?.includes('config') || s.message?.includes('starting'));
        const resultData = resultSnap?.meta?.payload || resultSnap?.meta?.data || resultSnap?.meta || {};
        const configData = configSnap?.meta?.payload || configSnap?.meta?.data || configSnap?.meta || {};
        const job = data.job || {};
        const assets = data.assets || [];
        const sourceImages = data.sourceImages || [];
        const progress = data.progress || [];

        const videoMode = resultData.video_mode || configData.video_mode || job.meta?.video_mode || 'static';
        const workflow = resultData.workflow || configData.workflow || job.meta?.img2vid_workflow || '-';
        const motionStrength = resultData.motion_strength ?? configData.motion_strength ?? job.meta?.img2vid_motion ?? '-';
        const fps = configData.fps || resultData.fps || job.meta?.img2vid_fps || 8;
        const frames = configData.frames || resultData.frames || job.meta?.img2vid_frames || 25;
        const totalScenes = resultData.total_scenes || configData.total_scenes || '-';
        const completed = resultData.completed ?? '-';
        const failed = resultData.failed ?? '-';
        const skipped = resultData.skipped ?? resultData.clips_skipped ?? '-';

        const clipAssets = assets.filter(a => a.idempotency_key?.includes('img2vid')).sort((a, b) => {
            const aIdx = parseInt(a.idempotency_key?.match(/scene_(\d+)/)?.[1] || '0');
            const bIdx = parseInt(b.idempotency_key?.match(/scene_(\d+)/)?.[1] || '0');
            return aIdx - bIdx;
        });

        const srcImageMap = {};
        sourceImages.forEach(img => {
            if (!img.public_url || !img.idempotency_key?.includes('image_generate')) return;
            const m = img.idempotency_key.match(/scene_(\d+)/);
            if (m) srcImageMap[parseInt(m[1])] = img.public_url;
        });

        const wasSkipped = data.status === 'completed' && (
            videoMode !== 'img2vid' ||
            resultData.reason === 'static_mode' ||
            resultData.reason === 'vram_low' ||
            resultData.reason === 'comfyui_offline' ||
            resultData.reason === 'no_renderer_url' ||
            resultData.reason === 'health_check_failed'
        );

        const skipReasonLabels = {
            static_mode: 'Video mode is "static" (Ken Burns pans)',
            vram_low: `VRAM too low: ${resultData.vram_free || '?'}MB / ${resultData.vram_floor || '4096'}MB floor`,
            comfyui_offline: 'ComfyUI server not reachable',
            no_renderer_url: 'COMFYUI_RENDERER_URL not configured',
            health_check_failed: 'ComfyUI health check failed'
        };

        if (wasSkipped) {
            const reason = resultData.reason || 'static_mode';
            const reasonLabel = skipReasonLabels[reason] || reason;
            let html = `<div class="step-detail__section">
                <div class="step-detail__label">🎥 Image-to-Video (Skipped)</div>
                <div class="step-detail__kv-grid">
                    <span class="step-detail__kv-key">Status</span><span class="step-detail__kv-val"><span class="step-detail__badge step-detail__badge--warning">Skipped</span></span>
                    <span class="step-detail__kv-key">Reason</span><span class="step-detail__kv-val">${CD.escapeHtml(reasonLabel)}</span>
                    <span class="step-detail__kv-key">Video Mode</span><span class="step-detail__kv-val">${videoMode}</span>
                    <span class="step-detail__kv-key">Fallback</span><span class="step-detail__kv-val">Ken Burns pan/zoom (static)</span>
                </div>
            </div>`;
            if (reason === 'vram_low') {
                html += `<div class="step-detail__section"><div class="img2vid-tip"><strong>💡 Tip:</strong> Free VRAM by closing other GPU applications or restart ComfyUI before the next campaign. Required: ≥${resultData.vram_floor || 4096}MB free VRAM.</div></div>`;
            }
            return html;
        }

        const workflowLabel = workflow.includes('animatediff') ? 'AnimateDiff' : workflow.includes('svd') ? 'SVD-XT' : workflow;
        const statusLabel = completed > 0 && failed === 0 ? '✅ All clips generated'
            : completed > 0 && failed > 0 ? `⚠️ Partial (${failed} failed → Ken Burns fallback)`
            : failed > 0 ? '❌ All failed (Ken Burns fallback)'
            : '⏳ In progress...';

        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🎥 Image-to-Video Generation
                <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyImg2VidSummary(this)">📋 Copy Summary</button>
            </div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Video Mode</span><span class="step-detail__kv-val"><span class="img2vid-mode-badge">img2vid</span></span>
                <span class="step-detail__kv-key">Workflow</span><span class="step-detail__kv-val"><span class="img2vid-workflow-badge img2vid-workflow-badge--${workflow.includes('animatediff') ? 'animatediff' : 'svd'}">${workflowLabel}</span></span>
                <span class="step-detail__kv-key">Motion Strength</span><span class="step-detail__kv-val">${motionStrength}</span>
                <span class="step-detail__kv-key">FPS / Frames</span><span class="step-detail__kv-val">${fps} fps · ${frames} frames</span>
                <span class="step-detail__kv-key">Result</span><span class="step-detail__kv-val">${statusLabel}</span>
            </div>
        </div>`;

        // Clip stats
        html += `<div class="step-detail__section">
            <div class="step-detail__label">📊 Clip Statistics</div>
            <div class="img2vid-stats-grid">
                <div class="img2vid-stat img2vid-stat--total"><div class="img2vid-stat__value">${totalScenes}</div><div class="img2vid-stat__label">Total Scenes</div></div>
                <div class="img2vid-stat img2vid-stat--success"><div class="img2vid-stat__value">${completed}</div><div class="img2vid-stat__label">Clips Generated</div></div>
                <div class="img2vid-stat img2vid-stat--error"><div class="img2vid-stat__value">${failed}</div><div class="img2vid-stat__label">Failed</div></div>
                <div class="img2vid-stat img2vid-stat--skip"><div class="img2vid-stat__value">${skipped}</div><div class="img2vid-stat__label">Skipped</div></div>
            </div>
        </div>`;

        // Live progress
        const latestProgress = [...progress].reverse()[0];
        const isGenerating = data.status === 'running';

        if (isGenerating && latestProgress) {
            const lastMeta = latestProgress.meta || {};
            const currentScene = lastMeta.scene_index ?? '?';
            const stageName = lastMeta.stage || lastMeta.status || 'processing';
            const pctVal = lastMeta.progress_pct ?? 0;
            const stepCur = lastMeta.progress_step || 0;
            const stepMax = lastMeta.progress_max || 0;
            const motionPr = lastMeta.motion_prompt || '';
            const animScoreVal = lastMeta.animation_score;
            const elapsedMs = lastMeta.elapsed_ms || 0;

            const completedGenTimes = clipAssets.map(a => (a.meta || a.metadata || {}).generation_time_ms).filter(t => t && t > 0);
            const avgGenTime = completedGenTimes.length > 0 ? Math.round(completedGenTimes.reduce((a, b) => a + b, 0) / completedGenTimes.length) : 0;
            const etaStr = avgGenTime > 0 && elapsedMs > 0 ? `~${Math.max(0, Math.round((avgGenTime - elapsedMs) / 1000))}s` : avgGenTime > 0 ? `~${Math.round(avgGenTime / 1000)}s` : '';

            const stageLabels = { dispatching: '📤 Dispatching', loading_model: '⏳ Loading Model', generating: '🎬 Generating', upscaling: '🔍 Upscaling', uploading: '☁️ Uploading', running: '🔄 Running', rendering: '🎬 Rendering', queued: '📋 Queued' };
            const stageLabel = stageLabels[stageName] || `🔄 ${stageName}`;
            const completedScenesList = clipAssets.map(a => 'S' + ((a.meta || a.metadata || {}).scene_index + 1)).join(' ');

            html += `<div class="step-detail__section img2vid-live-progress">
                <div class="step-detail__label">🎥 Generating Clip ${typeof completed !== 'undefined' && completed !== '-' ? (completed + 1) : '?'}/${totalScenes}</div>
                <div class="img2vid-progress-card">
                    <div class="img2vid-progress-card__header"><span class="img2vid-progress-card__scene">Scene ${currentScene + 1}</span><span class="img2vid-progress-card__stage">${stageLabel}</span></div>
                    <div class="img2vid-progress-bar-container">
                        <div class="img2vid-progress-bar" style="width:${Math.max(2, pctVal)}%"></div>
                        <span class="img2vid-progress-bar__label">${pctVal > 0 ? `${pctVal}%` : stageName}${stepMax > 0 ? ` (${stepCur}/${stepMax})` : ''}${etaStr ? `  ETA: ${etaStr}` : ''}</span>
                    </div>
                    ${motionPr ? `<div class="img2vid-progress-card__motion"><span class="img2vid-progress-card__motion-label">Motion:</span><span class="img2vid-progress-card__motion-text">"${CD.escapeHtml(motionPr)}"</span></div>` : ''}
                    ${animScoreVal !== undefined ? `<div class="img2vid-progress-card__score"><span class="img2vid-progress-card__score-label">Animation Score:</span><span class="img2vid-progress-card__score-val">${animScoreVal}/20</span></div>` : ''}
                    <div class="img2vid-progress-card__footer">
                        ${completedScenesList ? `<span class="img2vid-progress-card__done">✅ ${completedScenesList}</span>` : ''}
                        <span class="img2vid-progress-card__current">🔄 S${currentScene + 1}</span>
                    </div>
                </div>
            </div>`;
        }

        // Scene selection timeline
        const selectionSnap = data.snapshots.find(s => s.message?.includes('scene_selection') || s.meta?.snapshot_type === 'scene_selection');
        const selectionMeta = selectionSnap?.meta?.payload || selectionSnap?.meta?.data || selectionSnap?.meta || {};
        const distribution = selectionMeta.distribution || job.meta?.img2vid_distribution || '';
        const selectedScenes = selectionMeta.selected_scenes || job.meta?.img2vid_scene_scores?.filter(s => (job.meta?.img2vid_selected_scenes || []).includes(s.scene)) || [];
        const sceneScores = job.meta?.img2vid_scene_scores || selectionMeta.selected_scenes?.concat(selectionMeta.skipped_scenes || []) || [];

        if (distribution || selectedScenes.length > 0) {
            html += `<div class="step-detail__section"><div class="step-detail__label">🎯 Scene Selection</div>`;
            if (distribution) {
                html += `<div class="img2vid-timeline"><div class="img2vid-timeline__bar">
                    ${distribution.split('').map((char, i) => {
                        const isSelected = char === '▓';
                        const scoreEntry = sceneScores.find(s => s.scene === i);
                        const tooltip = scoreEntry ? `S${i + 1}: score=${scoreEntry.score} [${(scoreEntry.reasons || []).join(', ')}]` : `S${i + 1}`;
                        return `<div class="img2vid-timeline__cell ${isSelected ? 'img2vid-timeline__cell--active' : ''}" title="${CD.escapeHtml(tooltip)}"><span class="img2vid-timeline__cell-label">S${i + 1}</span></div>`;
                    }).join('')}
                </div>
                <div class="img2vid-timeline__legend">
                    <span class="img2vid-timeline__legend-item"><span class="img2vid-timeline__legend-dot img2vid-timeline__legend-dot--active"></span> Animated</span>
                    <span class="img2vid-timeline__legend-item"><span class="img2vid-timeline__legend-dot img2vid-timeline__legend-dot--static"></span> Ken Burns</span>
                </div></div>`;
            }
            if (selectedScenes.length > 0) {
                html += `<div class="img2vid-scores">
                    ${selectedScenes.map(s => {
                        const score = s.score || 0;
                        const barPct = Math.min(100, (score / 20) * 100);
                        const color = score >= 12 ? '#10B981' : score >= 6 ? '#F59E0B' : '#EF4444';
                        return `<div class="img2vid-score-row">
                            <span class="img2vid-score-row__label">S${(s.scene ?? s.sceneIndex ?? 0) + 1}</span>
                            <div class="img2vid-score-row__bar-bg"><div class="img2vid-score-row__bar" style="width:${barPct}%;background:${color}"></div></div>
                            <span class="img2vid-score-row__val">${score}</span>
                            <span class="img2vid-score-row__reasons">${(s.reasons || []).slice(0, 3).join(', ')}</span>
                        </div>`;
                    }).join('')}
                </div>`;
            }
            html += `</div>`;
        }

        // Gen time bar chart
        if (clipAssets.length > 1) {
            const genTimes = clipAssets.map(a => {
                const meta = a.meta || a.metadata || {};
                return { sceneIndex: meta.scene_index ?? parseInt(a.idempotency_key?.match(/scene_(\d+)/)?.[1] || '0'), genTimeMs: meta.generation_time_ms || 0, duration: meta.duration_seconds || 0, frames: meta.frame_count || 0 };
            });
            const maxGenTime = Math.max(...genTimes.map(g => g.genTimeMs), 1);
            html += `<div class="step-detail__section">
                <div class="step-detail__label">⚡ Generation Time per Clip</div>
                <div class="duration-bar-chart">
                    ${genTimes.map(g => {
                        const secs = (g.genTimeMs / 1000).toFixed(1);
                        const pct = Math.max(10, (g.genTimeMs / maxGenTime) * 100);
                        const color = g.genTimeMs > 60000 ? '#EF4444' : g.genTimeMs > 30000 ? '#F59E0B' : '#10B981';
                        return `<div class="duration-bar" style="height:${pct}%;background:${color}"><div class="duration-bar__tooltip">S${g.sceneIndex + 1}: ${secs}s · ${g.frames}f · ${g.duration.toFixed(1)}s clip</div></div>`;
                    }).join('')}
                </div>
                <div style="display:flex;gap:12px;font-size:10px;color:var(--text-secondary);margin-top:4px">
                    <span style="display:flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:2px;background:#10B981"></span> Fast (&lt;30s)</span>
                    <span style="display:flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:2px;background:#F59E0B"></span> Medium (30-60s)</span>
                    <span style="display:flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:2px;background:#EF4444"></span> Slow (&gt;60s)</span>
                </div>
            </div>`;
        }

        // Side-by-side grid
        if (clipAssets.length > 0 || Object.keys(srcImageMap).length > 0) {
            CD._img2vidClipAssets = clipAssets;
            CD._img2vidSrcImageMap = srcImageMap;
            const allSceneIndices = new Set([
                ...clipAssets.map(a => { const m = a.idempotency_key?.match(/scene_(\d+)/); return m ? parseInt(m[1]) : -1; }).filter(i => i >= 0),
                ...Object.keys(srcImageMap).map(Number)
            ]);
            const sortedScenes = [...allSceneIndices].sort((a, b) => a - b);

            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎬 Scene Clips (${clipAssets.length} generated) <span style="font-size:11px;color:var(--text-secondary);font-weight:normal">— click for details</span></div>
                <div class="img2vid-card-grid">
                    ${sortedScenes.map(sceneIdx => {
                        const clip = clipAssets.find(a => { const m = a.idempotency_key?.match(/scene_(\d+)/); return m && parseInt(m[1]) === sceneIdx; });
                        const srcUrl = srcImageMap[sceneIdx];
                        const clipMeta = clip?.meta || clip?.metadata || {};
                        const duration = clipMeta.duration_seconds ? `${Number(clipMeta.duration_seconds).toFixed(1)}s` : '';
                        const genTime = clipMeta.generation_time_ms ? `${(clipMeta.generation_time_ms / 1000).toFixed(1)}s gen` : '';
                        const frameCount = clipMeta.frame_count ? `${clipMeta.frame_count}f` : '';
                        const hasClip = !!clip?.public_url;
                        return `<div class="img2vid-card ${hasClip ? 'img2vid-card--has-clip' : 'img2vid-card--pending'}" onclick="window.campaignDetailPage.showImg2VidDetail(${sceneIdx})">
                            <div class="img2vid-card__source">${srcUrl ? `<img src="${srcUrl}" alt="Source S${sceneIdx + 1}" loading="lazy">` : `<div class="img2vid-card__placeholder">No src</div>`}</div>
                            <div class="img2vid-card__arrow">${hasClip ? '▶' : '⏳'}</div>
                            <div class="img2vid-card__clip">${hasClip ? `<video src="${clip.public_url}" preload="metadata" muted loop onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"></video>` : `<div class="img2vid-card__placeholder">${data.status === 'running' ? '⏳ Generating...' : 'Ken Burns'}</div>`}</div>
                            <div class="img2vid-card__label"><span class="img2vid-card__scene-num">S${sceneIdx + 1}</span>${hasClip ? `<span class="img2vid-card__meta">${[duration, frameCount, genTime].filter(Boolean).join(' · ')}</span>` : `<span class="img2vid-card__meta img2vid-card__meta--pending">fallback</span>`}</div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        // Clip map fallback
        const clipMap = job.meta?.img2vid_clips || {};
        const clipMapEntries = Object.entries(clipMap);
        if (clipMapEntries.length > 0 && clipAssets.length === 0) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎬 Clip Map (${clipMapEntries.length} clips ready for render)</div>
                <div class="img2vid-clips-list">
                    ${clipMapEntries.map(([sceneIdx, clip]) => `<div class="img2vid-clip">
                        <div class="img2vid-clip__header"><span class="img2vid-clip__scene">Scene ${parseInt(sceneIdx) + 1}</span><span class="img2vid-clip__badge img2vid-clip__badge--success">✓ ready</span></div>
                        <div class="img2vid-clip__details"><span title="Duration">⏱ ${clip.duration ? clip.duration.toFixed(1) + 's' : '-'}</span></div>
                    </div>`).join('')}
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
                        const icon = p.message?.includes('✓') ? '✅' : p.message?.includes('✕') ? '❌' : '🔄';
                        return `<div style="padding:2px 0;color:var(--text-secondary)">${icon} ${time} — ${p.message || ''}</div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        CD._img2vidSummary = { video_mode: videoMode, workflow: workflowLabel, motion_strength: motionStrength, fps, frames, total_scenes: totalScenes, completed, failed, skipped, clips: clipAssets.map(a => ({ scene: a.meta?.scene_index, duration: a.meta?.duration_seconds, frames: a.meta?.frame_count, gen_time_ms: a.meta?.generation_time_ms })) };
        return html;
    };

    CD.copyImg2VidSummary = async function(buttonEl) {
        const s = CD._img2vidSummary || {};
        const text = `=== IMG2VID Summary ===\nVideo Mode: ${s.video_mode || '-'}\nWorkflow: ${s.workflow || '-'}\nMotion Strength: ${s.motion_strength || '-'}\nTotal Scenes: ${s.total_scenes || '-'}\nClips Generated: ${s.completed || 0}\nFailed: ${s.failed || 0}\nSkipped: ${s.skipped || 0}\n\nClips:\n${(s.clips || []).map((c, i) => `  Scene ${(c.scene ?? i) + 1}: ${c.duration ? c.duration.toFixed(1) + 's' : '-'}, ${c.frames || '-'} frames, gen ${c.gen_time_ms ? (c.gen_time_ms / 1000).toFixed(1) + 's' : '-'}`).join('\n')}`;
        await CD.copyToClipboard(text, buttonEl);
    };

    CD.showImg2VidDetail = function(sceneIndex) {
        const clipAssets = CD._img2vidClipAssets || [];
        const srcImageMap = CD._img2vidSrcImageMap || {};
        const clip = clipAssets.find(a => { const m = a.idempotency_key?.match(/scene_(\d+)/); return m && parseInt(m[1]) === sceneIndex; });
        const srcUrl = srcImageMap[sceneIndex];
        const clipMeta = clip?.meta || clip?.metadata || {};

        const duration = clipMeta.duration_seconds ? Number(clipMeta.duration_seconds).toFixed(1) + 's' : '-';
        const frameCount = clipMeta.frame_count || '-';
        const genTime = clipMeta.generation_time_ms ? (clipMeta.generation_time_ms / 1000).toFixed(1) + 's' : '-';
        const job = CD._currentStepData?.job || {};
        const wf = clipMeta.workflow || job.meta?.img2vid_workflow || '-';
        const wfLabel = wf.includes('animatediff') ? 'AnimateDiff' : wf.includes('svd') ? 'SVD-XT' : wf;
        const motion = clipMeta.motion_strength ?? job.meta?.img2vid_motion ?? '-';
        const fpsVal = clipMeta.fps || job.meta?.img2vid_fps || 8;
        const framesVal = clipMeta.frames || job.meta?.img2vid_frames || 25;
        const resolution = clipMeta.width && clipMeta.height ? `${clipMeta.width}×${clipMeta.height}` : '-';
        const hasClip = !!clip?.public_url;

        const scenes = job.meta?.scenes || [];
        const imageSeq = job.meta?.image_sequence || [];
        const sceneData = scenes[sceneIndex] || {};
        const seqEntry = imageSeq.find(s => s.sceneIndex === sceneIndex) || {};
        const visualCue = seqEntry.visualCue || sceneData.visualCue || {};

        const overlay = document.createElement('div');
        overlay.className = 'image-detail-modal-overlay';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        overlay.innerHTML = `
            <div class="image-detail-modal img2vid-detail-modal">
                <div class="image-detail-modal__header">
                    <h3>Scene ${sceneIndex + 1} — Img2Vid Details</h3>
                    <button class="image-detail-modal__close" onclick="this.closest('.image-detail-modal-overlay').remove()">✕</button>
                </div>
                <div class="image-detail-modal__body img2vid-detail-modal__body">
                    <div class="img2vid-detail-modal__media-col">
                        ${srcUrl ? `<div class="img2vid-detail-modal__media-section"><div class="img2vid-detail-modal__media-label">📷 Source Image</div><img src="${srcUrl}" alt="Source Scene ${sceneIndex + 1}" class="img2vid-detail-modal__source-img" /><button onclick="window.open('${srcUrl}', '_blank')" class="btn-secondary-sm" style="margin-top:6px">🔗 Open Full Size</button></div>` : ''}
                        ${hasClip ? `<div class="img2vid-detail-modal__media-section"><div class="img2vid-detail-modal__media-label">🎬 Generated Clip</div><video src="${clip.public_url}" controls autoplay loop muted class="img2vid-detail-modal__video"></video><button onclick="window.open('${clip.public_url}', '_blank')" class="btn-secondary-sm" style="margin-top:6px">🔗 Open Video</button></div>` : `<div class="img2vid-detail-modal__media-section"><div class="img2vid-detail-modal__media-label">🎬 Video Clip</div><div class="img2vid-detail-modal__no-clip">No clip generated — Ken Burns fallback</div></div>`}
                    </div>
                    <div class="image-detail-modal__info-col">
                        <div class="image-detail-modal__section">
                            <div class="image-detail-modal__label">⚙️ Generation Config</div>
                            <div class="image-detail-modal__kv">
                                <span>Workflow</span><span>${CD.escapeHtml(wfLabel)}</span>
                                <span>Motion</span><span>${motion}</span>
                                <span>FPS</span><span>${fpsVal}</span>
                                <span>Frames</span><span>${framesVal}</span>
                                <span>Duration</span><span>${duration}</span>
                                <span>Frame Count</span><span>${frameCount}</span>
                                <span>Resolution</span><span>${resolution}</span>
                                <span>Gen Time</span><span>${genTime}</span>
                                ${clipMeta.vram_used ? `<span>VRAM Used</span><span>${clipMeta.vram_used}MB</span>` : ''}
                                ${clipMeta.seed ? `<span>Seed</span><span style="font-family:monospace;font-size:11px">${clipMeta.seed}</span>` : ''}
                                ${clipMeta.animation_score !== undefined ? `<span>Anim Score</span><span>${clipMeta.animation_score}/20</span>` : ''}
                            </div>
                        </div>
                        ${clipMeta.motion_prompt ? `<div class="image-detail-modal__section"><div class="image-detail-modal__label">🎯 Motion Prompt</div><p style="font-size:13px;color:var(--text-primary);line-height:1.5;font-style:italic">"${CD.escapeHtml(clipMeta.motion_prompt)}"</p></div>` : ''}
                        ${clipMeta.animation_score !== undefined && clipMeta.animation_reasons?.length ? `<div class="image-detail-modal__section"><div class="image-detail-modal__label">📊 Animation Score: ${clipMeta.animation_score}/20</div><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${clipMeta.animation_reasons.map(r => `<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:var(--bg-secondary);font-size:11px;color:var(--text-secondary)">${CD.escapeHtml(r)}</span>`).join('')}</div></div>` : ''}
                        ${visualCue?.description ? `<div class="image-detail-modal__section"><div class="image-detail-modal__label">👁️ Visual Cue</div><p style="font-size:13px;color:var(--text-primary);line-height:1.5">${CD.escapeHtml(visualCue.description)}</p>${visualCue.camera ? `<div style="margin-top:4px;font-size:11px;color:var(--text-secondary)">Camera: ${CD.escapeHtml(visualCue.camera)}</div>` : ''}</div>` : ''}
                        ${sceneData.text ? `<div class="image-detail-modal__section"><div class="image-detail-modal__label">📖 Scene Narration</div><p style="font-size:13px;color:var(--text-primary);line-height:1.5">${CD.escapeHtml(sceneData.text)}</p>${sceneData.keywords?.length ? `<div style="margin-top:6px;font-size:11px;color:var(--text-secondary)">Keywords: ${sceneData.keywords.join(', ')}</div>` : ''}</div>` : ''}
                        ${seqEntry.moodLevel ? `<div class="image-detail-modal__section"><div class="image-detail-modal__label">🎭 Mood</div><div style="font-size:13px;color:var(--text-primary)">Level: ${seqEntry.moodLevel} ${seqEntry.isClimax ? '<span style="color:#EF4444;font-weight:600">🔥 Climax</span>' : ''}</div></div>` : ''}
                    </div>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        const escHandler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);
    };

    CD.renderAssembleDetail = function(data) {
        const payloadSnap = data.snapshots.find(s => s.message?.includes('payload'));
        const outputSnap = data.snapshots.find(s => s.message?.includes('output') || s.message?.includes('complete'));
        const payload = payloadSnap?.meta?.payload || payloadSnap?.meta?.data || payloadSnap?.meta || {};
        const output = outputSnap?.meta?.payload || outputSnap?.meta?.data || outputSnap?.meta || {};
        const job = data.job || {};
        const imageSeq = job.meta?.image_sequence || [];

        CD._assemblePayloadText = JSON.stringify(payload, null, 2);

        let html = `<div class="step-detail__section">
            <div class="step-detail__label">🔧 Assembly Configuration
                <button class="step-detail__copy-btn" onclick="window.campaignDetailPage.copyToClipboard(window.campaignDetailPage._assemblePayloadText, this)">📋 Copy Payload</button>
            </div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Renderer</span><span class="step-detail__kv-val">${payload.renderer_url || payload.renderer || 'N/A'}</span>
                <span class="step-detail__kv-key">Images</span><span class="step-detail__kv-val">${payload.image_count || payload.scene_count || payload.total_scenes || imageSeq.length || '-'}</span>
                <span class="step-detail__kv-key">img2vid Clips</span><span class="step-detail__kv-val">${payload.img2vid_clips_in_meta > 0 ? `✅ ${payload.img2vid_clips_in_meta} clips (scenes ${(payload.img2vid_clip_keys || []).join(',')})` : (job.meta?.img2vid_clips ? `✅ ${Object.keys(job.meta.img2vid_clips).length} clips (meta)` : '— None')}</span>
                <span class="step-detail__kv-key">Effects Mode</span><span class="step-detail__kv-val">${payload.effects_mode || job.meta?.effects_mode || '-'}</span>
                <span class="step-detail__kv-key">Controlled Motion</span><span class="step-detail__kv-val">${(payload.effects_config?.enabled || payload.effects_enabled === true) ? '✅ Active' : '❌ Legacy'}</span>
                <span class="step-detail__kv-key">Per-Scene Durations</span><span class="step-detail__kv-val">${imageSeq.length > 0 ? '✅ From image_sequence' : '⚠️ Uniform'}</span>
                <span class="step-detail__kv-key">Mood Levels</span><span class="step-detail__kv-val">${imageSeq.length > 0 ? `✅ ${imageSeq.map(e => e.moodLevel).join(',')}` : '— N/A'}</span>
                <span class="step-detail__kv-key">Music</span><span class="step-detail__kv-val">${(payload.music_url || payload.has_music) ? '🎵 Included' : '— None'}</span>
                <span class="step-detail__kv-key">Captions</span><span class="step-detail__kv-val">${payload.captions?.length ? `${payload.captions.length} words` : '— None'}</span>
            </div>
        </div>`;

        if (output.video_url || output.render_url) {
            html += `<div class="step-detail__section">
                <div class="step-detail__label">🎬 Output Video</div>
                <video controls style="width:100%;max-height:300px;border-radius:6px;background:#000" src="${output.video_url || output.render_url}"></video>
            </div>`;
        }

        return html;
    };

    CD.renderUploadDetail = function(data) {
        const outputSnap = data.snapshots.find(s => s.message?.includes('output'));
        const output = outputSnap?.meta?.payload || outputSnap?.meta?.data || outputSnap?.meta || {};
        return `<div class="step-detail__section">
            <div class="step-detail__label">☁️ Upload Details</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Final URL</span><span class="step-detail__kv-val" style="word-break:break-all">${output.final_url || output.video_url || data.job?.video_url || '-'}</span>
                <span class="step-detail__kv-key">File Size</span><span class="step-detail__kv-val">${output.file_size ? (output.file_size / 1024 / 1024).toFixed(1) + ' MB' : '-'}</span>
            </div>
        </div>`;
    };

    CD.renderScheduleDetail = function(data) {
        const outputSnap = data.snapshots.find(s => s.message?.includes('output'));
        const output = outputSnap?.meta?.payload || outputSnap?.meta?.data || outputSnap?.meta || {};
        return `<div class="step-detail__section">
            <div class="step-detail__label">📅 Schedule Details</div>
            <div class="step-detail__kv-grid">
                <span class="step-detail__kv-key">Platform</span><span class="step-detail__kv-val">${output.platform || output.platforms?.join(', ') || (data.job?.meta?.platform && data.job.meta.platform !== 'default' ? data.job.meta.platform : (data.job?.meta?.platforms?.length ? data.job.meta.platforms.join(', ') : '-'))}</span>
                <span class="step-detail__kv-key">Scheduled For</span><span class="step-detail__kv-val">${output.scheduled_at ? new Date(output.scheduled_at).toLocaleString() : '-'}</span>
                <span class="step-detail__kv-key">Post ID</span><span class="step-detail__kv-val">${output.post_id || '-'}</span>
            </div>
        </div>`;
    };

    CD.renderGenericDetail = function(data) {
        return `<div class="step-detail__section">
            <div class="step-detail__label">Step Data</div>
            <div class="step-detail__pre">${CD.escapeHtml(JSON.stringify(data.stepMeta, null, 2))}</div>
        </div>`;
    };

    // =============================================
    // Copy Helpers
    // =============================================

    CD.copyScenesData = function(btnEl) {
        const job = CD._currentStepData?.job || {};
        const scenes = CD._currentStepData?.scenesData || [];
        const lines = [`Scene Breakdown — ${scenes.length} scenes, ${job.meta?.duration || '?'}s total`, ''];
        scenes.forEach((s, i) => {
            const dur = ((s.endTime || 0) - (s.startTime || 0)).toFixed(1);
            const words = (s.text || '').split(/\s+/).filter(w => w).length;
            lines.push(`Scene ${i+1} (${(s.startTime||0).toFixed(1)}s-${(s.endTime||0).toFixed(1)}s = ${dur}s, ${words}w)`);
            lines.push(`  Text: ${s.text || ''}`);
            if (s.keywords?.length) lines.push(`  Keywords: ${s.keywords.join(', ')}`);
            lines.push('');
        });
        CD.copyToClipboard(lines.join('\n'), btnEl);
    };

    CD.copyImageSummary = function(btnEl) {
        const job = CD._currentStepData?.job || {};
        const seq = job.meta?.image_sequence || [];
        const assets = CD._imageAssets || [];
        const cues = CD._visualCues || [];
        const anchor = CD._imageStoryAnchor;
        const lines = [`Image Generation Summary`, `Model: ${job.meta?.image_model || 'gpt-image-1'}`, `Images: ${assets.length}`, `Voice Aligned: ${job.meta?.audio_timestamps?.length ? 'Yes' : 'No'}`, ''];
        if (anchor) { lines.push('--- Story Anchor ---'); lines.push(JSON.stringify(anchor, null, 2)); lines.push(''); }
        if (cues.length) { lines.push('--- Visual Cues ---'); cues.forEach(vc => lines.push(`S${(vc.sceneIndex ?? 0) + 1}: [${vc.sceneType}/${vc.camera}${vc.isClimax ? '/CLIMAX' : ''}] ${vc.description}`)); lines.push(''); }
        if (seq.length) { lines.push('--- Image Sequence ---'); seq.forEach(e => lines.push(`S${e.sceneIndex + 1}${e.subIndex > 0 ? '.' + (e.subIndex + 1) : ''}: ${e.duration?.toFixed(1)}s, mood ${e.moodLevel}`)); }
        CD.copyToClipboard(lines.join('\n'), btnEl);
    };

    CD.copyImageSequence = function(btnEl) {
        const job = CD._currentStepData?.job || {};
        const seq = job.meta?.image_sequence || [];
        if (!seq.length) { CD.copyToClipboard('No image sequence data available', btnEl); return; }
        const lines = ['Image Sequence Manifest', `Total: ${seq.length} images`, '', 'Scene | Sub | Duration | Mood | Asset Key', '------|-----|----------|------|----------'];
        seq.forEach(e => lines.push(`S${e.sceneIndex + 1}    | ${e.subIndex || 0}   | ${(e.duration||0).toFixed(1)}s     | ${e.moodLevel || 0}    | ${e.assetKey || '-'}`));
        CD.copyToClipboard(lines.join('\n'), btnEl);
    };

    CD.copyVisualCues = function(btnEl) {
        const cues = CD._visualCues || [];
        if (!cues.length) { CD.copyToClipboard('No visual cues data available', btnEl); return; }
        const lines = [`Visual Cues (${cues.length} scenes)`, ''];
        cues.forEach(vc => { lines.push(`Scene ${(vc.sceneIndex ?? 0) + 1}:`); lines.push(`  Type: ${vc.sceneType || '-'}`); lines.push(`  Camera: ${vc.camera || '-'}`); lines.push(`  Climax: ${vc.isClimax ? 'YES' : 'no'}`); lines.push(`  Description: ${vc.description || '-'}`); lines.push(''); });
        CD.copyToClipboard(lines.join('\n'), btnEl);
    };

    CD.copyProgressLog = function(btnEl) {
        const data = CD._currentStepData;
        if (!data?.progress?.length) { CD.copyToClipboard('No progress log data', btnEl); return; }
        const lines = data.progress.map(p => `[${new Date(p.created_at).toISOString()}] ${p.message || ''}`);
        CD.copyToClipboard(lines.join('\n'), btnEl);
    };

})();
