// =====================================================
// POST EDITOR COMPONENT
// Modal for editing platform-specific post content
// =====================================================

class PostEditor {
    constructor(options = {}) {
        this.onSave = options.onSave || null;
        this.onClose = options.onClose || null;
        this.post = null;
        this.currentPlatform = 'youtube';
        this.isDirty = false;
        this.isGenerating = false;
        this.modal = null;
    }

    /**
     * Open the editor with a post
     */
    async open(post) {
        this.post = { ...post };
        this.post.platform_content = this.post.platform_content || {};
        this.isDirty = false;
        
        // Ensure all platforms have default content
        for (const platform of (this.post.platforms || ['youtube'])) {
            if (!this.post.platform_content[platform]) {
                this.post.platform_content[platform] = getDefaultPlatformContent(platform);
            }
        }
        
        this.currentPlatform = this.post.platforms?.[0] || 'youtube';
        
        this.render();
        this.bindEvents();
        this.modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Generate content if not already generated
        if (!this.post.content_generated) {
            await this.generateAllContent();
        }
    }

    /**
     * Close the editor
     */
    close() {
        if (this.isDirty) {
            if (!confirm('You have unsaved changes. Discard them?')) {
                return;
            }
        }
        
        this.modal?.classList.remove('active');
        document.body.style.overflow = '';
        
        if (this.onClose) {
            this.onClose();
        }
    }

    /**
     * Render the editor modal
     */
    render() {
        // Remove existing modal if any
        document.getElementById('post-editor-modal')?.remove();
        
        const platforms = this.post.platforms || ['youtube'];
        
        const html = `
            <div class="modal" id="post-editor-modal">
                <div class="modal__overlay"></div>
                <div class="modal__content modal__content--xl post-editor">
                    <div class="modal__header">
                        <h3 class="modal__title">
                            <span class="post-editor__title-icon">✏️</span>
                            Edit Post Details
                        </h3>
                        <button class="modal__close" id="editor-close">&times;</button>
                    </div>
                    
                    <div class="post-editor__body">
                        <!-- Video Preview Sidebar -->
                        <div class="post-editor__sidebar">
                            <div class="post-editor__preview">
                                ${this.post.video_url ? 
                                    `<video src="${this.post.video_url}" controls muted class="post-editor__video"></video>` :
                                    `<div class="post-editor__video-placeholder">No video</div>`
                                }
                            </div>
                            <div class="post-editor__meta">
                                <div class="post-editor__meta-item">
                                    <span class="label">Duration</span>
                                    <span class="value">${this.formatDuration(this.post.duration_seconds)}</span>
                                </div>
                                <div class="post-editor__meta-item">
                                    <span class="label">Theme</span>
                                    <span class="value">${this.post.theme || 'Not set'}</span>
                                </div>
                                <div class="post-editor__meta-item">
                                    <span class="label">Status</span>
                                    <span class="value badge badge--${this.getStatusColor(this.post.status)}">${this.post.status}</span>
                                </div>
                            </div>
                            
                            <!-- AI Generation -->
                            <div class="post-editor__ai-section">
                                <button class="btn btn--secondary btn--block" id="generate-all-btn" ${this.isGenerating ? 'disabled' : ''}>
                                    <span class="btn__icon">🤖</span>
                                    ${this.isGenerating ? 'Generating...' : 'Generate All Content'}
                                </button>
                                <p class="text-muted text-sm">AI will create optimized content for all platforms</p>
                            </div>
                            
                            <!-- Platform Selection -->
                            <div class="post-editor__platforms-section">
                                <h4 class="text-sm" style="margin-bottom: var(--space-2);">Post To Platforms</h4>
                                ${this.renderPlatformToggles()}
                            </div>
                        </div>
                        
                        <!-- Platform Tabs & Content -->
                        <div class="post-editor__main">
                            <!-- Platform Tabs -->
                            <div class="post-editor__tabs">
                                ${platforms.map(p => {
                                    const config = getPlatformConfig(p);
                                    const isActive = p === this.currentPlatform;
                                    const content = this.post.platform_content[p] || {};
                                    const hasContent = content.ai_generated || content.manually_edited;
                                    
                                    return `
                                        <button class="post-editor__tab ${isActive ? 'post-editor__tab--active' : ''}" 
                                                data-platform="${p}"
                                                style="--platform-color: ${config?.color || '#666'}">
                                            <span class="post-editor__tab-icon">${config?.icon || '📱'}</span>
                                            <span class="post-editor__tab-name">${config?.name || p}</span>
                                            ${hasContent ? '<span class="post-editor__tab-check">✓</span>' : ''}
                                        </button>
                                    `;
                                }).join('')}
                            </div>
                            
                            <!-- Platform Content Forms -->
                            <div class="post-editor__content">
                                ${this.renderPlatformForm(this.currentPlatform)}
                            </div>
                        </div>
                    </div>
                    
                    <div class="modal__footer">
                        <div class="post-editor__footer-left">
                            ${this.post.content_generated ? 
                                `<span class="text-muted text-sm">✓ AI content generated</span>` : 
                                `<span class="text-muted text-sm">⚠️ Content not yet generated</span>`
                            }
                        </div>
                        <div class="post-editor__footer-right">
                            <button class="btn btn--secondary" id="editor-cancel">Cancel</button>
                            <button class="btn btn--primary" id="editor-save-draft">Save Draft</button>
                            <button class="btn btn--success" id="editor-approve">
                                <span class="btn__icon">✓</span>
                                Approve & Schedule
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', html);
        this.modal = document.getElementById('post-editor-modal');
    }

    /**
     * Render platform toggle checkboxes
     */
    renderPlatformToggles() {
        const allPlatforms = ['youtube', 'instagram', 'facebook', 'tiktok'];
        const currentPlatforms = this.post.platforms || ['youtube'];
        
        return allPlatforms.map(p => {
            const config = getPlatformConfig(p);
            const isChecked = currentPlatforms.includes(p);
            
            return `
                <label class="platform-toggle" style="--platform-color: ${config?.color || '#666'}">
                    <input type="checkbox" 
                           class="platform-toggle__input" 
                           data-platform-toggle="${p}"
                           ${isChecked ? 'checked' : ''}>
                    <span class="platform-toggle__box">
                        <span class="platform-toggle__icon">${config?.icon || '📱'}</span>
                        <span class="platform-toggle__name">${config?.name || p}</span>
                        <span class="platform-toggle__check">✓</span>
                    </span>
                </label>
            `;
        }).join('');
    }

    /**
     * Handle platform toggle change
     */
    togglePlatform(platformId, enabled) {
        const currentPlatforms = this.post.platforms || ['youtube'];
        
        if (enabled && !currentPlatforms.includes(platformId)) {
            // Add platform
            this.post.platforms = [...currentPlatforms, platformId];
            
            // Initialize content for new platform
            if (!this.post.platform_content[platformId]) {
                this.post.platform_content[platformId] = getDefaultPlatformContent(platformId);
            }
            
            this.isDirty = true;
            this.refreshTabs();
            
            // Switch to the newly added platform
            this.switchPlatform(platformId);
            
        } else if (!enabled && currentPlatforms.includes(platformId)) {
            // Remove platform (must keep at least one)
            if (currentPlatforms.length <= 1) {
                Toast.warning('Must have at least one platform');
                // Re-check the checkbox
                const checkbox = this.modal.querySelector(`[data-platform-toggle="${platformId}"]`);
                if (checkbox) checkbox.checked = true;
                return;
            }
            
            this.post.platforms = currentPlatforms.filter(p => p !== platformId);
            this.isDirty = true;
            this.refreshTabs();
            
            // If we removed the current platform, switch to first available
            if (this.currentPlatform === platformId) {
                this.switchPlatform(this.post.platforms[0]);
            }
        }
    }

    /**
     * Refresh platform tabs after adding/removing platforms
     */
    refreshTabs() {
        const tabsContainer = this.modal.querySelector('.post-editor__tabs');
        if (tabsContainer) {
            const platforms = this.post.platforms || ['youtube'];
            
            tabsContainer.innerHTML = platforms.map(p => {
                const config = getPlatformConfig(p);
                const isActive = p === this.currentPlatform;
                const content = this.post.platform_content[p] || {};
                const hasContent = content.ai_generated || content.manually_edited;
                
                return `
                    <button class="post-editor__tab ${isActive ? 'post-editor__tab--active' : ''}" 
                            data-platform="${p}"
                            style="--platform-color: ${config?.color || '#666'}">
                        <span class="post-editor__tab-icon">${config?.icon || '📱'}</span>
                        <span class="post-editor__tab-name">${config?.name || p}</span>
                        ${hasContent ? '<span class="post-editor__tab-check">✓</span>' : ''}
                    </button>
                `;
            }).join('');
            
            // Re-bind tab click events
            tabsContainer.querySelectorAll('.post-editor__tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    this.switchPlatform(tab.dataset.platform);
                });
            });
        }
    }

    /**
     * Render form for a specific platform
     */
    renderPlatformForm(platformId) {
        const config = getPlatformConfig(platformId);
        if (!config) return '<p>Unknown platform</p>';
        
        const content = this.post.platform_content[platformId] || {};
        
        console.log(`📋 Rendering form for ${platformId}:`, content);
        
        let formHtml = `<div class="post-editor__form" data-platform="${platformId}">`;
        
        // Render each field
        for (const [fieldId, fieldConfig] of Object.entries(config.fields)) {
            const value = content[fieldId] ?? fieldConfig.default ?? '';
            formHtml += this.renderField(platformId, fieldId, fieldConfig, value);
        }
        
        // AI regenerate button for this platform
        formHtml += `
            <div class="post-editor__form-actions">
                <button class="btn btn--sm btn--secondary" data-regenerate="${platformId}">
                    🤖 Regenerate ${config.name} Content
                </button>
                ${platformId === 'tiktok' ? `
                    <button class="btn btn--sm btn--primary" id="tiktok-review-btn" style="margin-left:8px;background:#000;border-color:#000;">
                        🎵 Review TikTok Settings
                    </button>
                    <p class="text-muted text-sm" style="margin-top:8px">
                        TikTok requires you to review privacy, interactions, and commercial content settings before publishing.
                        ${content.user_reviewed ? '<span style="color:var(--color-success)">✓ Settings reviewed</span>' : '<span style="color:var(--color-warning)">⚠ Not yet reviewed</span>'}
                    </p>
                ` : ''}
            </div>
        `;
        
        formHtml += '</div>';
        return formHtml;
    }

    /**
     * Render a single form field
     */
    renderField(platformId, fieldId, config, value) {
        const fieldName = `${platformId}_${fieldId}`;
        const charCount = typeof value === 'string' ? formatCharCount(value.length, config.maxLength || 9999) : null;
        
        let fieldHtml = `<div class="form-group post-editor__field">`;
        
        // Label with character counter
        fieldHtml += `
            <div class="post-editor__field-header">
                <label class="form-label" for="${fieldName}">${config.label}</label>
                ${config.maxLength ? `
                    <span class="char-counter char-counter--${charCount?.status || 'ok'}">
                        ${charCount?.display || ''}
                    </span>
                ` : ''}
                ${config.aiPrompt ? `
                    <button class="btn btn--xs btn--ghost" data-regenerate-field="${platformId}:${fieldId}" title="Regenerate with AI">
                        🤖
                    </button>
                ` : ''}
            </div>
        `;
        
        // Field input based on type
        switch (config.type) {
            case 'text':
                fieldHtml += `
                    <input type="text" 
                           class="form-control" 
                           id="${fieldName}" 
                           name="${fieldName}"
                           value="${this.escapeHtml(value || '')}"
                           placeholder="${config.placeholder || ''}"
                           maxlength="${config.maxLength || ''}"
                           ${config.required ? 'required' : ''}>
                `;
                break;
                
            case 'textarea':
                fieldHtml += `
                    <textarea class="form-control post-editor__textarea" 
                              id="${fieldName}" 
                              name="${fieldName}"
                              placeholder="${config.placeholder || ''}"
                              maxlength="${config.maxLength || ''}"
                              ${config.required ? 'required' : ''}>${this.escapeHtml(value || '')}</textarea>
                `;
                break;
                
            case 'tags':
                const tags = Array.isArray(value) ? value : [];
                fieldHtml += `
                    <div class="tags-input" id="${fieldName}-container">
                        <div class="tags-input__tags">
                            ${tags.map(tag => `
                                <span class="tags-input__tag">
                                    ${this.escapeHtml(tag)}
                                    <button type="button" class="tags-input__remove" data-tag="${this.escapeHtml(tag)}">&times;</button>
                                </span>
                            `).join('')}
                        </div>
                        <input type="text" 
                               class="tags-input__input" 
                               id="${fieldName}" 
                               placeholder="${config.placeholder || 'Add tag and press Enter'}"
                               data-tags-for="${fieldName}">
                        <input type="hidden" name="${fieldName}" value="${tags.join(',')}">
                    </div>
                    ${config.maxCount ? `<span class="text-muted text-sm">${tags.length}/${config.maxCount} tags</span>` : ''}
                `;
                break;
                
            case 'select':
                fieldHtml += `
                    <select class="form-control select" id="${fieldName}" name="${fieldName}">
                        <option value="">${config.placeholder || 'Select...'}</option>
                        ${(config.options || []).map(opt => `
                            <option value="${opt.value}" ${value === opt.value ? 'selected' : ''}>${opt.label}</option>
                        `).join('')}
                    </select>
                `;
                break;
                
            case 'radio':
                fieldHtml += `<div class="radio-group">`;
                for (const opt of (config.options || [])) {
                    fieldHtml += `
                        <label class="radio-wrapper">
                            <input type="radio" name="${fieldName}" value="${opt.value}" ${value === opt.value ? 'checked' : ''}>
                            <span class="radio-label">${opt.icon || ''} ${opt.label}</span>
                        </label>
                    `;
                }
                fieldHtml += `</div>`;
                break;
                
            case 'checkbox':
                fieldHtml += `
                    <label class="checkbox-wrapper">
                        <input type="checkbox" id="${fieldName}" name="${fieldName}" ${value ? 'checked' : ''}>
                        <span class="checkbox-label">${config.hint || ''}</span>
                    </label>
                `;
                break;
        }
        
        // Hint text
        if (config.hint && config.type !== 'checkbox') {
            fieldHtml += `<p class="form-hint">${config.hint}</p>`;
        }
        
        fieldHtml += '</div>';
        return fieldHtml;
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        const modal = this.modal;
        
        // Close handlers
        modal.querySelector('#editor-close')?.addEventListener('click', () => this.close());
        modal.querySelector('#editor-cancel')?.addEventListener('click', () => this.close());
        modal.querySelector('.modal__overlay')?.addEventListener('click', () => this.close());
        
        // Save handlers
        modal.querySelector('#editor-save-draft')?.addEventListener('click', () => this.save('draft'));
        modal.querySelector('#editor-approve')?.addEventListener('click', () => this.save('approved'));
        
        // Generate all content
        modal.querySelector('#generate-all-btn')?.addEventListener('click', () => this.generateAllContent());
        
        // Platform toggle handlers
        modal.querySelectorAll('[data-platform-toggle]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                this.togglePlatform(e.target.dataset.platformToggle, e.target.checked);
            });
        });
        
        // Platform tab switching
        modal.querySelectorAll('.post-editor__tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.switchPlatform(tab.dataset.platform);
            });
        });
        
        // Regenerate platform content
        modal.querySelectorAll('[data-regenerate]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.generatePlatformContent(btn.dataset.regenerate);
            });
        });
        
        // Regenerate single field
        modal.querySelectorAll('[data-regenerate-field]').forEach(btn => {
            btn.addEventListener('click', () => {
                const [platform, field] = btn.dataset.regenerateField.split(':');
                this.generatePlatformContent(platform, field);
            });
        });
        
        // Form change tracking
        modal.querySelectorAll('input, textarea, select').forEach(input => {
            input.addEventListener('change', () => {
                this.isDirty = true;
                this.updateContent();
            });
            input.addEventListener('input', () => {
                this.isDirty = true;
                this.updateCharCounter(input);
            });
        });
        
        // Tags input handling
        this.bindTagsInput();

        // TikTok review button
        modal.querySelector('#tiktok-review-btn')?.addEventListener('click', () => {
            this.updateContent();
            this.close();
            if (typeof tiktokPublishReview !== 'undefined') {
                tiktokPublishReview.open(this.post, {
                    onPublished: () => { if (this.onSave) this.onSave(this.post); },
                    onCancel: () => {}
                });
            } else {
                window.location.href = `pages/tiktok-publish.html?post_id=${this.post.id}`;
            }
        });
        
        // Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal?.classList.contains('modal--open')) {
                this.close();
            }
        });
    }

    /**
     * Bind tags input behavior
     */
    bindTagsInput() {
        this.modal.querySelectorAll('.tags-input__input').forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    const tag = input.value.trim().replace(/,/g, '');
                    if (tag) {
                        this.addTag(input.dataset.tagsFor, tag);
                        input.value = '';
                    }
                }
            });
        });
        
        this.modal.querySelectorAll('.tags-input__remove').forEach(btn => {
            btn.addEventListener('click', () => {
                this.removeTag(btn.closest('.tags-input').querySelector('input[type="hidden"]').name, btn.dataset.tag);
            });
        });
    }

    /**
     * Add a tag
     */
    addTag(fieldName, tag) {
        const container = this.modal.querySelector(`#${fieldName}-container`);
        const hiddenInput = container.querySelector('input[type="hidden"]');
        const tagsContainer = container.querySelector('.tags-input__tags');
        
        const currentTags = hiddenInput.value ? hiddenInput.value.split(',') : [];
        if (!currentTags.includes(tag)) {
            currentTags.push(tag);
            hiddenInput.value = currentTags.join(',');
            
            const tagEl = document.createElement('span');
            tagEl.className = 'tags-input__tag';
            tagEl.innerHTML = `${this.escapeHtml(tag)}<button type="button" class="tags-input__remove" data-tag="${this.escapeHtml(tag)}">&times;</button>`;
            tagEl.querySelector('.tags-input__remove').addEventListener('click', () => this.removeTag(fieldName, tag));
            tagsContainer.appendChild(tagEl);
            
            this.isDirty = true;
            this.updateContent();
        }
    }

    /**
     * Remove a tag
     */
    removeTag(fieldName, tag) {
        const container = this.modal.querySelector(`#${fieldName}-container`);
        const hiddenInput = container.querySelector('input[type="hidden"]');
        
        const currentTags = hiddenInput.value ? hiddenInput.value.split(',') : [];
        const index = currentTags.indexOf(tag);
        if (index > -1) {
            currentTags.splice(index, 1);
            hiddenInput.value = currentTags.join(',');
            
            // Remove tag element
            container.querySelectorAll('.tags-input__tag').forEach(el => {
                if (el.textContent.trim().startsWith(tag)) {
                    el.remove();
                }
            });
            
            this.isDirty = true;
            this.updateContent();
        }
    }

    /**
     * Switch between platform tabs
     * @param {string} platformId - The platform to switch to
     * @param {boolean} skipSave - If true, don't save current form values (used after AI generation)
     */
    switchPlatform(platformId, skipSave = false) {
        // Save current platform content first (unless we're refreshing with new AI content)
        if (!skipSave) {
            this.updateContent();
        }
        
        this.currentPlatform = platformId;
        
        // Update tab styles
        this.modal.querySelectorAll('.post-editor__tab').forEach(tab => {
            tab.classList.toggle('post-editor__tab--active', tab.dataset.platform === platformId);
        });
        
        // Render new platform form
        const contentContainer = this.modal.querySelector('.post-editor__content');
        contentContainer.innerHTML = this.renderPlatformForm(platformId);
        
        // Rebind events for new content
        this.bindFormEvents();
    }

    /**
     * Bind events for form elements
     */
    bindFormEvents() {
        const form = this.modal.querySelector('.post-editor__form');
        if (!form) return;
        
        form.querySelectorAll('input, textarea, select').forEach(input => {
            input.addEventListener('change', () => {
                this.isDirty = true;
                this.updateContent();
            });
            input.addEventListener('input', () => {
                this.isDirty = true;
                this.updateCharCounter(input);
            });
        });
        
        form.querySelectorAll('[data-regenerate]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.generatePlatformContent(btn.dataset.regenerate);
            });
        });
        
        form.querySelectorAll('[data-regenerate-field]').forEach(btn => {
            btn.addEventListener('click', () => {
                const [platform, field] = btn.dataset.regenerateField.split(':');
                this.generatePlatformContent(platform, field);
            });
        });
        
        this.bindTagsInput();
    }

    /**
     * Update character counter for an input
     */
    updateCharCounter(input) {
        const fieldName = input.name || input.id;
        const [platform, field] = fieldName.split('_');
        const config = getPlatformConfig(platform)?.fields[field];
        
        if (config?.maxLength) {
            const counter = input.closest('.post-editor__field')?.querySelector('.char-counter');
            if (counter) {
                const count = formatCharCount(input.value.length, config.maxLength);
                counter.textContent = count.display;
                counter.className = `char-counter char-counter--${count.status}`;
            }
        }
    }

    /**
     * Update post content from form
     */
    updateContent() {
        const form = this.modal.querySelector('.post-editor__form');
        if (!form) return;
        
        const platformId = form.dataset.platform;
        const config = getPlatformConfig(platformId);
        if (!config) return;
        
        const content = this.post.platform_content[platformId] || {};
        
        for (const [fieldId, fieldConfig] of Object.entries(config.fields)) {
            const fieldName = `${platformId}_${fieldId}`;
            const input = form.querySelector(`[name="${fieldName}"]`);
            
            if (!input) continue;
            
            if (fieldConfig.type === 'checkbox') {
                content[fieldId] = input.checked;
            } else if (fieldConfig.type === 'radio') {
                const checked = form.querySelector(`[name="${fieldName}"]:checked`);
                content[fieldId] = checked?.value || fieldConfig.default;
            } else if (fieldConfig.type === 'tags') {
                content[fieldId] = input.value ? input.value.split(',').filter(t => t) : [];
            } else {
                content[fieldId] = input.value;
            }
        }
        
        content.manually_edited = true;
        this.post.platform_content[platformId] = content;
    }

    /**
     * Generate content for all platforms
     */
    async generateAllContent() {
        if (this.isGenerating) return;
        
        this.isGenerating = true;
        this.updateGenerateButton();
        
        try {
            Toast.info('Generating AI content for all platforms...');
            
            const response = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/generate-post-content`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    post_id: this.post.id,
                    platforms: this.post.platforms,
                    force: true  // Force regeneration even if manually edited
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to generate content');
            }
            
            const result = await response.json();
            
            console.log('🤖 AI Content Generated:', result);
            
            if (!result.platform_content) {
                console.error('No platform_content in response:', result);
                throw new Error('No platform_content in response');
            }
            
            // Update local post data
            this.post.platform_content = result.platform_content;
            this.post.content_generated = true;
            
            console.log('📝 Updated post.platform_content:', this.post.platform_content);
            console.log('📝 Current platform:', this.currentPlatform);
            console.log('📝 Content for current platform:', this.post.platform_content[this.currentPlatform]);
            
            // Re-render current platform form (skipSave=true to not overwrite new AI content)
            this.switchPlatform(this.currentPlatform, true);
            
            Toast.success('AI content generated!');
            
        } catch (error) {
            console.error('Content generation failed:', error);
            Toast.error(`Generation failed: ${error.message}`);
        } finally {
            this.isGenerating = false;
            this.updateGenerateButton();
        }
    }

    /**
     * Generate content for a specific platform
     */
    async generatePlatformContent(platformId, field = null) {
        try {
            Toast.info(`Generating ${field || platformId} content...`);
            
            const response = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/generate-post-content`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    post_id: this.post.id,
                    platforms: [platformId],
                    regenerate_field: field
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to generate content');
            }
            
            const result = await response.json();
            
            // Update local post data
            this.post.platform_content[platformId] = result.platform_content[platformId];
            
            // Re-render if on this platform (skipSave=true to not overwrite new AI content)
            if (this.currentPlatform === platformId) {
                this.switchPlatform(platformId, true);
            }
            
            Toast.success('Content regenerated!');
            
        } catch (error) {
            console.error('Content generation failed:', error);
            Toast.error(`Generation failed: ${error.message}`);
        }
    }

    /**
     * Update generate button state
     */
    updateGenerateButton() {
        const btn = this.modal.querySelector('#generate-all-btn');
        if (btn) {
            btn.disabled = this.isGenerating;
            btn.innerHTML = this.isGenerating 
                ? '<span class="btn__icon spinner-sm"></span> Generating...'
                : '<span class="btn__icon">🤖</span> Generate All Content';
        }
    }

    /**
     * Save the post
     */
    async save(newStatus = null) {
        this.updateContent();
        
        // Validate required fields for approval
        if (newStatus === 'approved') {
            for (const platform of (this.post.platforms || ['youtube'])) {
                const validation = validatePlatformContent(platform, this.post.platform_content[platform] || {});
                if (!validation.valid) {
                    Toast.error(`${getPlatformConfig(platform).name}: ${validation.errors[0]}`);
                    this.switchPlatform(platform);
                    return;
                }
            }

            // If TikTok is included, check if user has reviewed TikTok settings
            if ((this.post.platforms || []).includes('tiktok')) {
                const ttContent = this.post.platform_content?.tiktok || {};
                if (!ttContent.user_reviewed) {
                    Toast.info('Please review TikTok settings before approving.');
                    this.close();
                    // Open TikTok publish review
                    if (typeof tiktokPublishReview !== 'undefined') {
                        tiktokPublishReview.open(this.post, {
                            onPublished: () => { if (this.onSave) this.onSave(this.post); },
                            onCancel: () => {}
                        });
                    } else {
                        window.location.href = `pages/tiktok-publish.html?post_id=${this.post.id}`;
                    }
                    return;
                }
            }
        }
        
        try {
            Toast.info('Saving...');
            
            const updates = {
                platforms: this.post.platforms || ['youtube'],
                platform_content: this.post.platform_content,
                title: this.post.platform_content.youtube?.title || this.post.title,
                description: this.post.platform_content.youtube?.description || this.post.description,
                tags: this.post.platform_content.youtube?.tags || this.post.tags
            };
            
            if (newStatus) {
                updates.status = newStatus;
            }
            
            const { error } = await supabaseClient
                .from('posts')
                .update(updates)
                .eq('id', this.post.id);
            
            if (error) throw error;
            
            this.isDirty = false;
            Toast.success(newStatus === 'approved' ? 'Post approved!' : 'Draft saved!');
            
            if (this.onSave) {
                this.onSave({ ...this.post, ...updates });
            }
            
            this.close();
            
        } catch (error) {
            console.error('Save failed:', error);
            Toast.error(`Save failed: ${error.message}`);
        }
    }

    // Utility methods
    formatDuration(seconds) {
        if (!seconds) return 'Unknown';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
    }

    getStatusColor(status) {
        const colors = {
            draft: 'info',
            approved: 'success',
            scheduled: 'warning',
            posting: 'warning',
            posted: 'success',
            failed: 'error'
        };
        return colors[status] || 'info';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for browser
window.PostEditor = PostEditor;
