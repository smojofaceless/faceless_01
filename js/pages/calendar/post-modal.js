// =====================================================
// CALENDAR PAGE - Post Modal
// Post detail modal, day detail, cross-post picker
// =====================================================

/**
 * Set up modal close handlers
 */
function setupModal() {
    if (!calElements.postModal) return;

    // Move modal to body to avoid parent constraints
    if (calElements.postModal.parentElement !== document.body) {
        document.body.appendChild(calElements.postModal);
    }

    // Close button handlers
    const closeBtn = calElements.postModal.querySelector('.modal__close');
    const closeBtnFooter = document.getElementById('modal-close-btn');
    const overlay = calElements.postModal.querySelector('.modal__overlay');

    [closeBtn, closeBtnFooter, overlay].forEach(el => {
        if (el) {
            el.addEventListener('click', closeModal);
        }
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && calElements.postModal.classList.contains('active')) {
            closeModal();
        }
    });
}

/**
 * Close the modal
 */
function closeModal() {
    if (calElements.postModal) {
        calElements.postModal.classList.remove('active');
        document.body.style.overflow = '';
    }
    selectedPost = null;

    const modalTitle = calElements.postModal?.querySelector('.modal__title');
    if (modalTitle) {
        modalTitle.textContent = 'Post Details';
    }
}

/**
 * Handle post click from calendar
 * @param {Object} post - Clicked post
 */
function handlePostClick(post) {
    console.log('Post clicked:', post);
    selectedPost = post;
    showPostModal(post);
}

/**
 * Handle date click from calendar
 * @param {Date} date - Clicked date
 * @param {Array} posts - Posts for that date
 */
function handleDateClick(date, posts) {
    console.log('Date clicked:', date, posts);
    if (posts && posts.length > 0) {
        showDayDetailModal(date, posts);
    }
}

/**
 * Handle slot click (available scheduling slot)
 * @param {Date} time - Slot time
 */
function handleSlotClick(time) {
    console.log('Slot clicked:', time);
    const timeStr = time.toISOString();
    window.location.href = `campaign.html?scheduledAt=${encodeURIComponent(timeStr)}`;
}

/**
 * Show post detail modal with Metadata Control Center
 * Supports consolidated items (multi-platform) with tabs
 * @param {Object} post - Post to display
 * @param {string} [activePlatformId] - Which platform tab to show first
 */
function showPostModal(post, activePlatformId) {
    if (!calElements.postModal || !calElements.postModalBody) return;

    // Reset modal title
    const modalTitle = calElements.postModal.querySelector('.modal__title');
    if (modalTitle) modalTitle.textContent = 'Post Details';

    // Determine if this is a consolidated (multi-platform) item
    const isConsolidated = post.isConsolidated && post.platforms && post.platforms.length > 1;
    const activePost = isConsolidated
        ? (post.platforms.find(p => p.platformId === activePlatformId) || post.platforms[0])
        : post;

    const isJob = activePost.type === 'job';
    const isJobComplete = isJob && (activePost.status === 'scheduled' || activePost.raw?.status === 'complete');
    const statusLabel = isJob 
        ? (activePost.status === 'pending' ? 'Pending Generation' 
           : isJobComplete ? 'Complete' 
           : activePost.status === 'failed' ? 'Failed' 
           : 'Generating...') 
        : activePost.status;

    const meta = activePost.metadata || null;

    // Build platform tabs HTML (only for consolidated items)
    const tabsHtml = isConsolidated ? `
        <div class="platform-tabs" id="platform-tabs">
            ${post.platforms.map(p => {
                const isActive = p.platformId === activePost.platformId;
                const pColor = calendarInstance ? calendarInstance.getPlatformColor(p.platformId) : '#666';
                const pName = getPlatformDisplayName(p.platformId);
                const pStatus = p.status || 'unknown';
                return `
                    <button class="platform-tab ${isActive ? 'platform-tab--active' : ''}"
                            data-platform-id="${p.platformId}"
                            style="--tab-color: ${pColor}">
                        <span class="platform-tab__dot"></span>
                        <span class="platform-tab__name">${pName}</span>
                        <span class="platform-tab__status badge badge--${getStatusClass(pStatus)} badge--xs">${pStatus}</span>
                    </button>
                `;
            }).join('')}
        </div>
    ` : '';

    // Platform badge for the active platform
    const platform = typeof getPlatform === 'function' 
        ? getPlatform(activePost.platformId) 
        : { name: activePost.platformId };

    // Build modal content
    calElements.postModalBody.innerHTML = `
        <div class="post-detail">
            ${tabsHtml}

            <div class="post-detail__header">
                ${isJob ? `
                    <span class="badge badge--info" style="font-size: 11px;">
                        &#9881; Job
                    </span>
                ` : ''}
                ${!isConsolidated ? `
                    <span class="platform-badge platform-badge--${activePost.platformId}">
                        ${platform?.name || activePost.platformId}
                    </span>
                ` : ''}
                <span class="badge badge--${getStatusClass(activePost.status)}">
                    ${statusLabel}
                </span>
            </div>
            
            <h4 class="post-detail__title">
                ${escapeHtml(activePost.content?.title || 'Untitled')}
            </h4>
            
            ${activePost.content?.description ? `
                <p class="post-detail__desc">
                    ${escapeHtml(activePost.content.description)}
                </p>
            ` : ''}
            
            <div class="post-detail__meta">
                <div class="meta-item">
                    <strong>Scheduled:</strong>
                    <span>${formatDateTime(activePost.scheduledAt)}</span>
                </div>
                
                ${activePost.publishedAt ? `
                    <div class="meta-item">
                        <strong>Published:</strong>
                        <span>${formatDateTime(activePost.publishedAt)}</span>
                    </div>
                ` : ''}
                
                ${activePost.content?.duration ? `
                    <div class="meta-item">
                        <strong>Duration:</strong>
                        <span>${formatDuration(activePost.content.duration)}</span>
                    </div>
                ` : ''}

                ${activePost.batchId ? `
                    <div class="meta-item">
                        <strong>Campaign:</strong>
                        <span style="font-family: monospace; font-size: 11px;">${activePost.batchId.substring(0, 8)}...</span>
                    </div>
                ` : ''}
                
                ${activePost.lastError ? `
                    <div class="meta-item meta-item--error">
                        <strong>Error:</strong>
                        <span>${escapeHtml(activePost.lastError)}</span>
                    </div>
                ` : ''}
            </div>
            
            ${activePost.content?.videoUrl ? `
                <div class="post-detail__preview">
                    <video 
                        src="${activePost.content.videoUrl}" 
                        poster="${activePost.content.thumbnailUrl || ''}"
                        controls
                        preload="metadata"
                        style="max-width: 100%; border-radius: 8px;">
                    </video>
                </div>
            ` : isJob ? `
                <div class="post-detail__preview" style="text-align: center; padding: 24px; background: var(--surface-secondary); border-radius: 8px; color: var(--text-muted);">
                    <div style="font-size: 32px; margin-bottom: 8px;">${isJobComplete ? '&#10003;' : '&#9881;'}</div>
                    <p style="margin: 0;">${isJobComplete ? 'Video complete — ready to publish' : 'Video is being generated...'}</p>
                </div>
            ` : ''}

            ${!isJob ? buildMetadataSection(activePost, meta) : `
                <div class="metadata-section" style="opacity: 0.6;">
                    <div class="metadata-section__header">
                        <h5 class="metadata-section__title">AI Metadata</h5>
                        <span class="metadata-badge metadata-badge--none">N/A</span>
                    </div>
                    <div class="metadata-section__empty">
                        <p>AI metadata will be generated once this job is imported as a post.</p>
                        ${isJobComplete ? '<p style="margin-top: 8px; font-size: 12px; color: var(--text-muted);">This job is complete — click <strong>Edit Post</strong> to import it, then metadata will auto-generate.</p>' : ''}
                    </div>
                </div>
            `}

            <!-- Metrics section (loaded async) -->
            <div id="post-metrics-section"></div>
        </div>
    `;

    // Attach metadata event handlers
    if (!isJob) {
        attachMetadataHandlers(activePost);
    }

    // Load metrics for posted items
    if (!isJob && (activePost.status === 'posted' || (isConsolidated && post.platforms.some(p => p.status === 'posted')))) {
        loadPostMetrics(isConsolidated ? post : activePost);
    }

    // Attach platform tab click handlers
    if (isConsolidated) {
        const tabContainer = document.getElementById('platform-tabs');
        if (tabContainer) {
            tabContainer.addEventListener('click', (e) => {
                const tab = e.target.closest('.platform-tab');
                if (!tab) return;
                const pid = tab.dataset.platformId;
                if (pid && pid !== activePost.platformId) {
                    selectedPost = post;
                    showPostModal(post, pid);
                }
            });
        }
    }

    // Build dynamic footer actions
    const footer = document.getElementById('post-modal-footer');
    if (footer) {
        const actions = [];
        actions.push('<button class="btn btn--secondary" id="modal-close-btn">Close</button>');

        if (!isJob) {
            // Retry button for failed posts
            if (activePost.status === 'failed') {
                actions.push('<button class="btn btn--primary" id="modal-retry-btn">&#x21bb; Retry Post</button>');
            }

            // Cross-post button for posts with video content
            if (activePost.content?.videoUrl && activePost.status !== 'failed') {
                actions.push('<button class="btn btn--outline" id="modal-crosspost-btn">&#x2795; Post to More Platforms</button>');
            }
        }

        footer.innerHTML = actions.join('');

        // Re-bind close button
        const closeBtn = footer.querySelector('#modal-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);

        // Retry handler
        const retryBtn = footer.querySelector('#modal-retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', async () => {
                retryBtn.disabled = true;
                retryBtn.textContent = 'Retrying...';
                try {
                    await postQueueService.retryPost(activePost.id);
                    retryBtn.textContent = 'Queued!';
                    retryBtn.classList.remove('btn--primary');
                    retryBtn.classList.add('btn--success');
                    setTimeout(() => {
                        closeModal();
                        if (calendarInstance) calendarInstance.render();
                    }, 800);
                } catch (err) {
                    retryBtn.disabled = false;
                    retryBtn.textContent = '↻ Retry Post';
                    console.error('Retry failed:', err);
                }
            });
        }

        // Cross-post handler
        const crosspostBtn = footer.querySelector('#modal-crosspost-btn');
        if (crosspostBtn) {
            crosspostBtn.addEventListener('click', () => {
                showCrossPostPicker(activePost, post);
            });
        }
    }

    // Show modal
    calElements.postModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

/**
 * Show a platform picker for cross-posting content
 */
function showCrossPostPicker(activePost, consolidatedPost) {
    const allPlatforms = ['youtube_shorts', 'tiktok', 'instagram_reels', 'facebook_reels'];
    const existingPlatforms = consolidatedPost?.platforms
        ? consolidatedPost.platforms.map(p => p.platformId)
        : [activePost.platformId];

    const available = allPlatforms.filter(p => !existingPlatforms.includes(p));

    if (available.length === 0) {
        alert('This post is already scheduled for all available platforms.');
        return;
    }

    const pickerHtml = `
        <div class="crosspost-picker" style="padding: 16px; background: var(--surface-light, #1e1e2a); border-radius: 8px; margin-top: 12px;">
            <h5 style="margin: 0 0 12px; color: var(--text-primary, #f1f5f9); font-size: 14px;">Select platforms to cross-post:</h5>
            <div style="display: flex; flex-direction: column; gap: 8px;">
                ${available.map(p => `
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px; border-radius: 6px; background: rgba(255,255,255,0.04);">
                        <input type="checkbox" value="${p}" class="crosspost-platform-cb" style="accent-color: #8b5cf6;">
                        <span style="color: var(--text-primary, #f1f5f9); font-size: 13px;">${getPlatformDisplayName(p)}</span>
                    </label>
                `).join('')}
            </div>
            <div style="display: flex; gap: 8px; margin-top: 12px;">
                <button class="btn btn--primary btn--sm" id="crosspost-confirm">Cross-Post</button>
                <button class="btn btn--secondary btn--sm" id="crosspost-cancel">Cancel</button>
            </div>
        </div>
    `;

    // Insert picker into modal body
    const existingPicker = document.querySelector('.crosspost-picker');
    if (existingPicker) existingPicker.remove();

    calElements.postModalBody.insertAdjacentHTML('beforeend', pickerHtml);

    document.getElementById('crosspost-cancel')?.addEventListener('click', () => {
        document.querySelector('.crosspost-picker')?.remove();
    });

    document.getElementById('crosspost-confirm')?.addEventListener('click', async () => {
        const selected = [...document.querySelectorAll('.crosspost-platform-cb:checked')].map(cb => cb.value);
        if (selected.length === 0) return;

        const confirmBtn = document.getElementById('crosspost-confirm');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Creating...';

        try {
            const sourcePost = await postQueueService.getPost(activePost.id || activePost.raw?.id);
            if (!sourcePost) throw new Error('Source post not found');

            const currentPlatforms = sourcePost.platforms || [];
            const updatedPlatforms = [...new Set([...currentPlatforms, ...selected])];

            await postQueueService.updatePost(sourcePost.id, {
                platforms: updatedPlatforms
            });

            confirmBtn.textContent = 'Done!';
            confirmBtn.classList.remove('btn--primary');
            confirmBtn.classList.add('btn--success');

            setTimeout(() => {
                closeModal();
                if (calendarInstance) calendarInstance.render();
            }, 800);
        } catch (err) {
            console.error('Cross-post failed:', err);
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Cross-Post';
            alert(`Cross-post failed: ${err.message}`);
        }
    });
}

/**
 * Show day detail modal with all posts for a date
 * @param {Date} date - The date
 * @param {Array} posts - Posts for that date
 */
function showDayDetailModal(date, posts) {
    if (!calElements.postModal || !calElements.postModalBody) return;

    const dateStr = date.toLocaleDateString('en-US', { 
        weekday: 'long',
        month: 'long', 
        day: 'numeric',
        year: 'numeric'
    });

    // Consolidate posts by sourceJobId for the day overview
    const consolidated = calendarInstance ? calendarInstance.consolidateByJob(posts) : posts;

    calElements.postModalBody.innerHTML = `
        <div class="day-detail">
            <h4 class="day-detail__date">${dateStr}</h4>
            <p class="day-detail__count">${posts.length} post${posts.length !== 1 ? 's' : ''}${consolidated.length < posts.length ? ` (${consolidated.length} video${consolidated.length !== 1 ? 's' : ''})` : ''}</p>
            
            <div class="day-detail__posts">
                ${consolidated.map(post => {
                    const postBrandInfo = calendarInstance ? calendarInstance.getBrandInfo(post.brandId) : null;
                    const brandChip = postBrandInfo && !activeBrandFilter
                        ? `<span class="day-detail__brand-chip" style="--chip-color: ${postBrandInfo.color}">
                            <span class="calendar__brand-dot" style="background: ${postBrandInfo.color}"></span>
                            ${escapeHtml(postBrandInfo.name)}
                           </span>`
                        : '';
                    const platformHtml = post.isConsolidated
                        ? `<div class="day-detail__platforms">
                            ${post.platformIds.map(pid => {
                                const pColor = calendarInstance ? calendarInstance.getPlatformColor(pid) : '#666';
                                const pName = getPlatformDisplayName(pid);
                                const platformPost = post.platforms.find(p => p.platformId === pid);
                                const pStatus = platformPost?.status || '';
                                return `<span class="day-detail__platform-chip" style="--chip-color: ${pColor}" title="${pName}: ${pStatus}">${getPlatformShortLabel(pid)}</span>`;
                            }).join('')}
                           </div>`
                        : `<span class="day-detail__post-platform">
                            ${getPlatformDisplayName(post.platformId)}
                           </span>`;

                    return `
                        <div class="day-detail__post ${post.isConsolidated ? 'day-detail__post--consolidated' : ''}" data-post-id="${post.id}">
                            <div class="day-detail__post-time">
                                ${formatTime(post.scheduledAt)}
                            </div>
                            <div class="day-detail__post-info">
                                ${brandChip}
                                <span class="day-detail__post-title">
                                    ${escapeHtml(post.content?.title || 'Untitled')}
                                </span>
                                ${platformHtml}
                            </div>
                            <span class="badge badge--${getStatusClass(post.status)} badge--sm">
                                ${post.status}
                            </span>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;

    // Add click handlers for individual posts
    calElements.postModalBody.querySelectorAll('[data-post-id]').forEach(el => {
        el.addEventListener('click', () => {
            const postId = el.dataset.postId;
            const item = consolidated.find(p => p.id === postId);
            if (item) {
                selectedPost = item;
                showPostModal(item);
            }
        });
    });

    // Update modal title
    const modalTitle = calElements.postModal.querySelector('.modal__title');
    if (modalTitle) {
        modalTitle.textContent = 'Day Overview';
    }

    // Show modal
    calElements.postModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}
