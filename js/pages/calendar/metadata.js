// =====================================================
// CALENDAR PAGE - Metadata Control Center
// AI metadata section builder, field config, handlers, version history
// =====================================================

/**
 * Build the metadata control center section HTML
 * @param {Object} post - Calendar item
 * @param {Object|null} meta - Metadata object from postQueue enrichment
 * @returns {string} HTML string
 */
function buildMetadataSection(post, meta) {
    const status = meta?.status || 'none';
    const fields = meta?.finalMetadata || meta?.aiMetadata || null;
    const error = meta?.error || null;
    const attemptCount = meta?.attemptCount || 0;
    const failureClass = meta?.failureClass || null;
    const nextRetry = meta?.nextRetryAt ? new Date(meta.nextRetryAt) : null;
    const generatedAt = meta?.generatedAt ? formatDateTime(meta.generatedAt) : null;
    const editedAt = meta?.editedAt ? formatDateTime(meta.editedAt) : null;

    const fieldConfig = getMetadataFieldConfig(post.platformId);

    return `
        <div class="metadata-section" id="metadata-section">
            <div class="metadata-section__header">
                <h5 class="metadata-section__title">AI Metadata</h5>
                <span class="metadata-badge metadata-badge--${status}">
                    ${getMetadataStatusLabel(status)}
                </span>
            </div>

            ${status === 'failed' ? `
                <div class="metadata-section__error">
                    <div class="metadata-error-info">
                        <span class="metadata-error-class metadata-error-class--${failureClass || 'transient'}">${failureClass || 'unknown'}</span>
                        <span class="metadata-error-text">${escapeHtml(error || 'Unknown error')}</span>
                    </div>
                    <div class="metadata-error-meta">
                        Attempt ${attemptCount}/3
                        ${nextRetry ? ` · Next retry: ${formatDateTime(nextRetry)}` : ' · No more retries'}
                    </div>
                </div>
            ` : ''}

            ${status === 'generating' ? `
                <div class="metadata-section__generating">
                    <div class="spinner-small"></div>
                    <span>Generating metadata...</span>
                </div>
            ` : ''}

            ${(status === 'ready' || status === 'edited') && fields ? `
                <div class="metadata-section__fields" id="metadata-fields">
                    ${fieldConfig.map(fc => {
                        const value = fields[fc.key];
                        if (fc.type === 'array') {
                            const arr = Array.isArray(value) ? value : [];
                            return `
                                <div class="metadata-field">
                                    <label class="metadata-field__label">${fc.label}</label>
                                    <input type="text" 
                                        class="metadata-field__input" 
                                        data-field="${fc.key}" 
                                        data-type="array"
                                        value="${escapeHtml(arr.join(', '))}"
                                        placeholder="${fc.placeholder || ''}"
                                        ${fc.maxLength ? `maxlength="${fc.maxLength}"` : ''}>
                                    ${fc.hint ? `<span class="metadata-field__hint">${fc.hint}</span>` : ''}
                                </div>
                            `;
                        }
                        return `
                            <div class="metadata-field">
                                <label class="metadata-field__label">${fc.label}</label>
                                ${fc.multiline ? `
                                    <textarea 
                                        class="metadata-field__textarea" 
                                        data-field="${fc.key}" 
                                        data-type="string"
                                        rows="3"
                                        placeholder="${fc.placeholder || ''}"
                                        ${fc.maxLength ? `maxlength="${fc.maxLength}"` : ''}
                                    >${escapeHtml(String(value || ''))}</textarea>
                                ` : `
                                    <input type="text" 
                                        class="metadata-field__input" 
                                        data-field="${fc.key}" 
                                        data-type="string"
                                        value="${escapeHtml(String(value || ''))}"
                                        placeholder="${fc.placeholder || ''}"
                                        ${fc.maxLength ? `maxlength="${fc.maxLength}"` : ''}>
                                `}
                                ${fc.hint ? `<span class="metadata-field__hint">${fc.hint}</span>` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>

                <div class="metadata-section__timestamps">
                    ${generatedAt ? `<span>Generated: ${generatedAt}</span>` : ''}
                    ${editedAt ? `<span>Edited: ${editedAt}</span>` : ''}
                </div>
            ` : ''}

            ${status === 'none' || status === 'not_started' ? `
                <div class="metadata-section__empty">
                    <p>No AI metadata generated yet.</p>
                </div>
            ` : ''}

            <div class="metadata-section__actions">
                ${(status === 'ready' || status === 'edited') ? `
                    <button class="btn btn--sm btn--primary" id="metadata-save-btn" disabled>
                        Save Changes
                    </button>
                ` : ''}
                
                ${(status === 'failed' || status === 'none' || status === 'not_started') ? `
                    <button class="btn btn--sm btn--primary" id="metadata-generate-btn">
                        ${status === 'failed' ? 'Retry Generation' : 'Generate Metadata'}
                    </button>
                ` : ''}

                ${(status === 'ready' || status === 'edited') ? `
                    <button class="btn btn--sm btn--outline" id="metadata-regenerate-btn">
                        Regenerate
                    </button>
                ` : ''}
            </div>

            <!-- Version History (loaded async) -->
            <div id="metadata-version-history" class="metadata-version-history" style="display: none;">
                <div class="metadata-version-history__header" id="version-history-toggle">
                    <span class="metadata-version-history__title">Version History</span>
                    <span class="metadata-version-history__chevron">&#9660;</span>
                </div>
                <div class="metadata-version-history__body" id="version-history-body" style="display: none;">
                    <div class="metadata-version-history__loading">Loading versions...</div>
                </div>
            </div>

            <div class="metadata-section__feedback" id="metadata-feedback" style="display: none;"></div>
        </div>
    `;
}

/**
 * Get field configuration for a platform's metadata editor
 * @param {string} platformId
 * @returns {Array} Field configs
 */
function getMetadataFieldConfig(platformId) {
    const configs = {
        youtube_shorts: [
            { key: 'title', label: 'Title', type: 'string', maxLength: 100, hint: 'Max 100 chars. Hook in first 3 words.' },
            { key: 'description', label: 'Description', type: 'string', multiline: true, maxLength: 5000, hint: 'Tease the story. End with a CTA.' },
            { key: 'tags', label: 'Tags', type: 'array', hint: 'Comma-separated. 8-15 tags recommended.' },
        ],
        tiktok: [
            { key: 'caption', label: 'Caption', type: 'string', maxLength: 2200, hint: 'Max 150 chars ideal. Short punchy hook.' },
            { key: 'hashtags', label: 'Hashtags', type: 'array', hint: 'Comma-separated. 5-8 recommended.' },
            { key: 'cover_text', label: 'Cover Text', type: 'string', maxLength: 40, hint: 'Max 40 chars. Attention-grabbing overlay text.' },
        ],
        instagram_reels: [
            { key: 'caption', label: 'Caption', type: 'string', multiline: true, maxLength: 2200, hint: 'Story-style with line breaks.' },
            { key: 'hashtags', label: 'Hashtags', type: 'array', hint: 'Comma-separated. 10-15 recommended.' },
            { key: 'alt_text', label: 'Alt Text', type: 'string', maxLength: 125, hint: 'Accessibility description. Max 125 chars.' },
        ],
    };
    return configs[platformId] || configs.youtube_shorts;
}

/**
 * Get human-readable label for metadata status
 * @param {string} status
 * @returns {string}
 */
function getMetadataStatusLabel(status) {
    const labels = {
        ready: 'AI Ready',
        edited: 'Edited',
        generating: 'Generating...',
        failed: 'Failed',
        not_started: 'Not Started',
        none: 'No Metadata'
    };
    return labels[status] || status;
}

/**
 * Attach event handlers for metadata section
 * @param {Object} post - Calendar item
 */
function attachMetadataHandlers(post) {
    const fieldsContainer = document.getElementById('metadata-fields');
    const saveBtn = document.getElementById('metadata-save-btn');
    const generateBtn = document.getElementById('metadata-generate-btn');
    const regenerateBtn = document.getElementById('metadata-regenerate-btn');

    if (fieldsContainer && saveBtn) {
        fieldsContainer.addEventListener('input', () => {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
        });

        saveBtn.addEventListener('click', async () => {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
            showMetadataFeedback('Saving...', 'info');

            try {
                const fields = collectMetadataFields();
                await postQueueService.updatePostMetadata(
                    post.id, 
                    post.platformId, 
                    fields
                );
                showMetadataFeedback('Metadata saved successfully', 'success');
                saveBtn.textContent = 'Saved';
                
                if (post.metadata) {
                    post.metadata.finalMetadata = fields;
                    post.metadata.status = 'edited';
                }

                if (typeof metadataVersionService !== 'undefined') {
                    metadataVersionService.recordEditVersion(post.id, post.platformId, fields)
                        .then(() => loadVersionHistory(post))
                        .catch(err => console.warn('Version recording failed:', err));
                }
            } catch (err) {
                showMetadataFeedback(`Save failed: ${err.message}`, 'error');
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Changes';
            }
        });
    }

    // Generate / Retry handler
    if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
            generateBtn.disabled = true;
            generateBtn.textContent = 'Generating...';
            showMetadataFeedback('Triggering metadata generation...', 'info');

            try {
                const result = await postQueueService.regenerateMetadata(
                    post.id, 
                    post.platformId, 
                    false
                );
                if (result?.success) {
                    showMetadataFeedback('Metadata generated! Refreshing...', 'success');
                    setTimeout(() => refreshPostModal(post), 1000);
                } else {
                    showMetadataFeedback(`Generation failed: ${result?.results?.[0]?.error || 'Unknown'}`, 'error');
                    generateBtn.disabled = false;
                    generateBtn.textContent = 'Retry Generation';
                }
            } catch (err) {
                showMetadataFeedback(`Generation failed: ${err.message}`, 'error');
                generateBtn.disabled = false;
                generateBtn.textContent = 'Retry Generation';
            }
        });
    }

    // Regenerate handler (force)
    if (regenerateBtn) {
        regenerateBtn.addEventListener('click', async () => {
            if (!confirm('Regenerate will overwrite current metadata. Continue?')) return;
            
            regenerateBtn.disabled = true;
            regenerateBtn.textContent = 'Regenerating...';
            showMetadataFeedback('Regenerating metadata...', 'info');

            try {
                const result = await postQueueService.regenerateMetadata(
                    post.id, 
                    post.platformId, 
                    true
                );
                if (result?.success) {
                    showMetadataFeedback('Metadata regenerated! Refreshing...', 'success');
                    setTimeout(() => refreshPostModal(post), 1000);
                } else {
                    showMetadataFeedback(`Regeneration failed: ${result?.results?.[0]?.error || 'Unknown'}`, 'error');
                    regenerateBtn.disabled = false;
                    regenerateBtn.textContent = 'Regenerate';
                }
            } catch (err) {
                showMetadataFeedback(`Regeneration failed: ${err.message}`, 'error');
                regenerateBtn.disabled = false;
                regenerateBtn.textContent = 'Regenerate';
            }
        });
    }

    // Load version history (async, non-blocking)
    loadVersionHistory(post);

    // Version history toggle
    const vhToggle = document.getElementById('version-history-toggle');
    if (vhToggle) {
        vhToggle.addEventListener('click', () => {
            const body = document.getElementById('version-history-body');
            const chevron = vhToggle.querySelector('.metadata-version-history__chevron');
            if (body) {
                const isHidden = body.style.display === 'none';
                body.style.display = isHidden ? 'block' : 'none';
                if (chevron) chevron.textContent = isHidden ? '\u25B2' : '\u25BC';
            }
        });
    }
}

/**
 * Load and render version history for a post
 * @param {Object} post
 */
async function loadVersionHistory(post) {
    if (typeof metadataVersionService === 'undefined') return;

    const container = document.getElementById('metadata-version-history');
    const body = document.getElementById('version-history-body');
    if (!container || !body) return;

    try {
        const versions = await metadataVersionService.getVersions(post.id, post.platformId);
        if (!versions || versions.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        body.innerHTML = versions.map(v => {
            const typeInfo = metadataVersionService.formatVersionType(v.version_type);
            const perfInfo = metadataVersionService.formatPerformance(v.performance_value);
            const date = v.created_at ? new Date(v.created_at).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            }) : '';

            return `
                <div class="version-entry" data-version-id="${v.id}">
                    <div class="version-entry__header">
                        <span class="version-badge ${typeInfo.cssClass}">v${v.version_number} · ${typeInfo.label}</span>
                        ${v.variant_key ? `<span class="version-variant-badge">🧪 ${escapeHtml(v.variant_key)}</span>` : ''}
                        <span class="version-perf ${perfInfo.cssClass}">${perfInfo.text}</span>
                        <span class="version-date">${date}</span>
                    </div>
                    <div class="version-entry__detail" style="display: none;">
                        <pre class="version-fields-json">${escapeHtml(JSON.stringify(v.fields, null, 2))}</pre>
                    </div>
                </div>
            `;
        }).join('');

        body.querySelectorAll('.version-entry').forEach(entry => {
            entry.querySelector('.version-entry__header')?.addEventListener('click', () => {
                const detail = entry.querySelector('.version-entry__detail');
                if (detail) {
                    detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
                }
            });
        });
    } catch (err) {
        console.warn('Failed to load version history:', err);
        container.style.display = 'none';
    }
}

/**
 * Collect current field values from the metadata editor
 * @returns {Object} Field values
 */
function collectMetadataFields() {
    const fields = {};
    const inputs = document.querySelectorAll('#metadata-fields [data-field]');
    inputs.forEach(input => {
        const key = input.dataset.field;
        const type = input.dataset.type;
        const value = input.tagName === 'TEXTAREA' ? input.value : input.value;
        
        if (type === 'array') {
            fields[key] = value.split(',').map(s => s.trim()).filter(Boolean);
        } else {
            fields[key] = value;
        }
    });
    return fields;
}

/**
 * Show feedback message in the metadata section
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 */
function showMetadataFeedback(message, type) {
    const feedback = document.getElementById('metadata-feedback');
    if (!feedback) return;
    feedback.textContent = message;
    feedback.className = `metadata-section__feedback metadata-section__feedback--${type}`;
    feedback.style.display = 'block';
    if (type === 'success') {
        setTimeout(() => { feedback.style.display = 'none'; }, 3000);
    }
}

/**
 * Refresh the post modal with fresh data
 * @param {Object} post - Calendar item
 */
async function refreshPostModal(post) {
    if (typeof postQueueService !== 'undefined') {
        try {
            const targetPost = post.isConsolidated ? post.platforms.find(p => p.platformId === post.platformId) || post : post;
            const freshMeta = await postQueueService.getPostMetadata(targetPost.id, targetPost.platformId);
            if (freshMeta) {
                targetPost.metadata = {
                    status: freshMeta.status,
                    aiMetadata: freshMeta.ai_metadata,
                    finalMetadata: freshMeta.final_metadata,
                    error: freshMeta.error,
                    attemptCount: freshMeta.attempt_count,
                    failureClass: freshMeta.failure_class,
                    nextRetryAt: freshMeta.next_retry_at,
                    generatedAt: freshMeta.generated_at,
                    editedAt: freshMeta.edited_at,
                    platform: freshMeta.platform
                };
            }
        } catch (e) {
            console.warn('Failed to refresh metadata:', e);
        }
    }
    showPostModal(post, post.platformId);
}
