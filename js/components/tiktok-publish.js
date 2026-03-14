// =====================================================
// TIKTOK PUBLISH REVIEW COMPONENT
// Implements TikTok Content Sharing UX Guidelines (Points 1-5)
// =====================================================

class TikTokPublishReview {
    constructor() {
        this.post = null;
        this.creatorInfo = null;
        this.settings = {
            title: '',
            privacyLevel: '',          // No default — user must select
            allowComment: false,       // Off by default
            allowDuet: false,          // Off by default
            allowStitch: false,        // Off by default
            commercialContent: false,  // Toggle off by default
            yourBrand: false,
            brandedContent: false,
        };
        this.container = null;
        this.onPublished = null;
        this.onCancel = null;
        this._loading = false;
        this._publishing = false;
        this._publishStatus = null;   // null | 'uploading' | 'processing' | 'success' | 'error'
        this._publishError = null;
        this._creatorError = null;
    }

    /**
     * Open the TikTok publish review for a post
     * @param {Object} post - Post object with video_url, title, description, tags, etc.
     * @param {Object} options - { onPublished, onCancel }
     */
    async open(post, options = {}) {
        this.post = post;
        this.onPublished = options.onPublished || null;
        this.onCancel = options.onCancel || null;
        this._loading = true;
        this._creatorError = null;

        // Pre-fill title from post
        this.settings.title = post.platform_content?.tiktok?.caption || post.title || '';

        // Reset all user-controlled settings (TikTok requires no defaults)
        this.settings.privacyLevel = '';
        this.settings.allowComment = false;
        this.settings.allowDuet = false;
        this.settings.allowStitch = false;
        this.settings.commercialContent = false;
        this.settings.yourBrand = false;
        this.settings.brandedContent = false;

        this.render();
        this.bindEvents();

        // Fetch creator info (Guideline Point 1)
        await this.fetchCreatorInfo();
    }

    /**
     * Fetch latest creator info from TikTok API (Point 1a, 1b, 1c)
     */
    async fetchCreatorInfo() {
        this._loading = true;
        this.updateLoadingState();

        try {
            const brand = typeof brandManager !== 'undefined' ? brandManager.getActiveBrand() : null;
            if (!brand) throw new Error('No active brand selected');

            await tiktokService.setBrand(brand.id);
            if (!tiktokService.isConnected()) {
                throw new Error('TikTok is not connected. Please connect in Settings first.');
            }

            // Ensure token is fresh
            const connection = tiktokService.brandConnections[brand.id];
            let accessToken = connection.accessToken;
            if (connection.tokenExpiry && connection.tokenExpiry - Date.now() < 5 * 60 * 1000) {
                accessToken = await tiktokService.refreshAccessToken();
            }

            // Query creator info
            const response = await fetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json; charset=UTF-8',
                },
            });

            const data = await response.json();

            if (data.error?.code) {
                throw new Error(data.error.message || `Creator info error: ${data.error.code}`);
            }

            this.creatorInfo = data.data || {};

            // Point 1b: Check if creator can post
            if (this.creatorInfo.creator_can_post === false) {
                this._creatorError = 'This TikTok account cannot make more posts at this moment. Please try again later.';
            }

            // Point 1c: Check video duration
            if (this.post.duration_seconds && this.creatorInfo.max_video_post_duration_sec) {
                if (this.post.duration_seconds > this.creatorInfo.max_video_post_duration_sec) {
                    this._creatorError = `Video duration (${this.post.duration_seconds}s) exceeds the maximum allowed (${this.creatorInfo.max_video_post_duration_sec}s).`;
                }
            }

            // Fetch user info for display name
            try {
                const userInfo = await tiktokService.fetchUserInfo(accessToken);
                this.creatorInfo.nickname = userInfo.display_name || userInfo.username || connection.displayName || 'TikTok User';
                this.creatorInfo.avatarUrl = userInfo.avatar_url || null;
            } catch (e) {
                this.creatorInfo.nickname = connection.displayName || 'TikTok User';
            }

        } catch (err) {
            console.error('[TikTok Publish] Creator info error:', err);
            this._creatorError = err.message;
            this.creatorInfo = null;
        }

        this._loading = false;
        this.renderContent();
    }

    /**
     * Main render — creates the overlay container
     */
    render() {
        document.getElementById('ttp-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'ttp-overlay';
        overlay.className = 'ttp';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;overflow-y:auto;background:var(--color-bg-darker)';
        overlay.innerHTML = `<div class="ttp__container" id="ttp-container"></div>`;
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';

        this.container = document.getElementById('ttp-container');
        this.renderContent();
    }

    /**
     * Render all content inside the container
     */
    renderContent() {
        if (!this.container) return;

        if (this._loading) {
            this.container.innerHTML = `
                <div class="ttp__header">
                    <button class="ttp__back" id="ttp-back">← Back</button>
                    <h2 class="ttp__title"><span class="ttp__title-icon">🎵</span>Post to TikTok</h2>
                </div>
                <div class="ttp__loading">
                    <div class="ttp__loading-spinner"></div>
                    <span class="ttp__loading-text">Loading creator info...</span>
                </div>
            `;
            this.container.querySelector('#ttp-back')?.addEventListener('click', () => this.close());
            return;
        }

        const ci = this.creatorInfo;
        const s = this.settings;
        const isPhoto = !this.post.video_url;

        // Privacy options from creator_info (Point 2b)
        const privacyOptions = ci?.privacy_level_options || [];
        const privacyLabels = {
            'PUBLIC_TO_EVERYONE': 'Public',
            'MUTUAL_FOLLOW_FRIENDS': 'Friends',
            'FOLLOWER_OF_CREATOR': 'Followers',
            'SELF_ONLY': 'Only Me',
        };

        // Interaction disabled states from creator_info (Point 2c)
        const commentDisabled = ci?.comment_disabled === true;
        const duetDisabled = ci?.duet_disabled === true || isPhoto;
        const stitchDisabled = ci?.stitch_disabled === true || isPhoto;

        // Commercial content logic (Point 3b)
        const brandedContentSelected = s.brandedContent;
        const privateDisabledByBranded = brandedContentSelected;

        // Determine available privacy options with branded content constraint
        const filteredPrivacy = privacyOptions.map(opt => {
            const disabled = opt === 'SELF_ONLY' && privateDisabledByBranded;
            return { value: opt, label: privacyLabels[opt] || opt, disabled };
        });

        // Auto-fix: if branded content is on and privacy is SELF_ONLY, clear it
        if (brandedContentSelected && s.privacyLevel === 'SELF_ONLY') {
            s.privacyLevel = '';
        }

        // Consent/declaration text (Point 4)
        let declarationText = 'By posting, you agree to TikTok\'s <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener">Music Usage Confirmation</a>.';
        if (s.commercialContent && s.brandedContent) {
            declarationText = 'By posting, you agree to TikTok\'s <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noopener">Branded Content Policy</a> and <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener">Music Usage Confirmation</a>.';
        } else if (s.commercialContent && !s.brandedContent && s.yourBrand) {
            declarationText = 'By posting, you agree to TikTok\'s <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener">Music Usage Confirmation</a>.';
        }

        // Label prompt text (Point 3a)
        let labelPrompt = '';
        if (s.yourBrand && s.brandedContent) {
            labelPrompt = 'Your video will be labeled as "Paid partnership"';
        } else if (s.brandedContent) {
            labelPrompt = 'Your video will be labeled as "Paid partnership"';
        } else if (s.yourBrand) {
            labelPrompt = 'Your video will be labeled as "Promotional content"';
        }

        // Publish button validation
        const canPublish = this.validateForm();

        // Disclosure error: toggle on but nothing selected
        const disclosureError = s.commercialContent && !s.yourBrand && !s.brandedContent;

        this.container.innerHTML = `
            <div class="ttp__header">
                <button class="ttp__back" id="ttp-back">← Back</button>
                <h2 class="ttp__title"><span class="ttp__title-icon">🎵</span>Post to TikTok</h2>
            </div>

            <!-- Point 1a: Creator Info -->
            ${ci ? `
            <div class="ttp__creator">
                <div class="ttp__creator-avatar">
                    ${ci.avatarUrl ? `<img src="${this.escapeAttr(ci.avatarUrl)}" alt="Avatar">` : '🎵'}
                </div>
                <div class="ttp__creator-info">
                    <div class="ttp__creator-name">${this.escapeHtml(ci.nickname)}</div>
                    <div class="ttp__creator-handle">Posting to this TikTok account</div>
                </div>
                <div class="ttp__creator-status ${this._creatorError ? 'ttp__creator-status--error' : 'ttp__creator-status--ok'}">
                    ${this._creatorError ? '⚠ Issue' : '✓ Ready to post'}
                </div>
            </div>
            ` : ''}

            <!-- Point 1b/1c: Error banner if can't post or duration exceeded -->
            ${this._creatorError ? `
            <div class="ttp__error-banner">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                <span>${this.escapeHtml(this._creatorError)}</span>
            </div>
            ` : ''}

            <div class="ttp__body">
                <!-- Point 5a: Content Preview -->
                <div class="ttp__preview">
                    ${this.post.video_url ? `
                        <div class="ttp__preview-video">
                            <video src="${this.escapeAttr(this.post.video_url)}" controls muted playsinline preload="metadata"></video>
                        </div>
                    ` : `
                        <div class="ttp__preview-placeholder">No video preview available</div>
                    `}
                    <div class="ttp__preview-meta">
                        <span>${this.post.duration_seconds ? `${this.post.duration_seconds}s` : 'Unknown duration'}</span>
                        <span>${ci?.max_video_post_duration_sec ? `Max: ${ci.max_video_post_duration_sec}s` : ''}</span>
                    </div>
                </div>

                <div class="ttp__form">
                    <!-- Point 2a & 5b: Title (editable) -->
                    <div class="ttp__section">
                        <div class="ttp__section-header">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            Content
                        </div>
                        <div class="ttp__section-body">
                            <div class="ttp__field">
                                <label class="ttp__label">Title / Caption <span class="ttp__label-required">*</span></label>
                                <textarea class="ttp__textarea" id="ttp-title" maxlength="2200" rows="4" placeholder="Write your caption...">${this.escapeHtml(s.title)}</textarea>
                                <div class="ttp__char-count" id="ttp-title-count">${s.title.length} / 2200</div>
                                <div class="ttp__hint">You can edit the title and hashtags before posting. Hashtags from your content are included above — feel free to modify them.</div>
                            </div>
                        </div>
                    </div>

                    <!-- Point 2b: Privacy Status -->
                    <div class="ttp__section">
                        <div class="ttp__section-header">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                            Privacy & Interactions
                        </div>
                        <div class="ttp__section-body">
                            <div class="ttp__field">
                                <label class="ttp__label">Who can view this video <span class="ttp__label-required">*</span></label>
                                <select class="ttp__select ${!s.privacyLevel ? 'ttp__select--unselected' : ''}" id="ttp-privacy">
                                    <option value="" ${!s.privacyLevel ? 'selected' : ''} disabled>— Select privacy level —</option>
                                    ${filteredPrivacy.map(opt => `
                                        <option value="${opt.value}" ${s.privacyLevel === opt.value ? 'selected' : ''} ${opt.disabled ? 'disabled' : ''}>
                                            ${opt.label}${opt.disabled ? ' (not available for branded content)' : ''}
                                        </option>
                                    `).join('')}
                                </select>
                                ${privateDisabledByBranded ? `
                                    <div class="ttp__hint" style="color: var(--color-warning);">Branded content visibility cannot be set to private.</div>
                                ` : ''}
                            </div>

                            <!-- Point 2c: Interaction Toggles -->
                            <div class="ttp__field">
                                <label class="ttp__label">Interaction Settings</label>
                                <div class="ttp__hint" style="margin-bottom: var(--space-2);">These are turned off by default. Enable the ones you want.</div>
                                <div class="ttp__toggles">
                                    <label class="ttp__toggle ${commentDisabled ? 'ttp__toggle--disabled' : ''}" ${commentDisabled ? 'data-disabled-reason="Comments disabled in TikTok app settings"' : ''}>
                                        <input type="checkbox" id="ttp-comment" ${s.allowComment ? 'checked' : ''} ${commentDisabled ? 'disabled' : ''}>
                                        <span class="ttp__toggle-switch"></span>
                                        <span class="ttp__toggle-label">Allow Comment</span>
                                    </label>
                                    ${!isPhoto ? `
                                    <label class="ttp__toggle ${duetDisabled ? 'ttp__toggle--disabled' : ''}" ${duetDisabled ? 'data-disabled-reason="Duet disabled in TikTok app settings"' : ''}>
                                        <input type="checkbox" id="ttp-duet" ${s.allowDuet ? 'checked' : ''} ${duetDisabled ? 'disabled' : ''}>
                                        <span class="ttp__toggle-switch"></span>
                                        <span class="ttp__toggle-label">Allow Duet</span>
                                    </label>
                                    <label class="ttp__toggle ${stitchDisabled ? 'ttp__toggle--disabled' : ''}" ${stitchDisabled ? 'data-disabled-reason="Stitch disabled in TikTok app settings"' : ''}>
                                        <input type="checkbox" id="ttp-stitch" ${s.allowStitch ? 'checked' : ''} ${stitchDisabled ? 'disabled' : ''}>
                                        <span class="ttp__toggle-switch"></span>
                                        <span class="ttp__toggle-label">Allow Stitch</span>
                                    </label>
                                    ` : `
                                    <div class="ttp__hint">Duet and Stitch are not applicable to photo posts.</div>
                                    `}
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Point 3: Commercial Content Disclosure -->
                    <div class="ttp__section">
                        <div class="ttp__section-header">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                            Commercial Content Disclosure
                        </div>
                        <div class="ttp__section-body">
                            <div class="ttp__disclosure">
                                <label class="ttp__disclosure-toggle">
                                    <input type="checkbox" id="ttp-commercial" ${s.commercialContent ? 'checked' : ''}>
                                    <span class="ttp__toggle-switch"></span>
                                    <div>
                                        <span class="ttp__toggle-label">This content promotes a brand, product, or service</span>
                                        <div class="ttp__toggle-sublabel">Indicate whether this content promotes yourself, a brand, product or service</div>
                                    </div>
                                </label>

                                <div class="ttp__disclosure-options ${s.commercialContent ? 'ttp__disclosure-options--visible' : ''}" id="ttp-disclosure-options">
                                    <label class="ttp__checkbox">
                                        <input type="checkbox" id="ttp-your-brand" ${s.yourBrand ? 'checked' : ''}>
                                        <div class="ttp__checkbox-text">
                                            <span class="ttp__checkbox-title">Your brand</span>
                                            <span class="ttp__checkbox-desc">You are promoting yourself or your own business. This content will be classified as Brand Organic.</span>
                                        </div>
                                    </label>
                                    <label class="ttp__checkbox ${s.privacyLevel === 'SELF_ONLY' ? 'ttp__checkbox--disabled' : ''}" 
                                           ${s.privacyLevel === 'SELF_ONLY' ? 'data-disabled-reason="Branded content visibility cannot be set to private"' : ''}
                                           id="ttp-branded-label">
                                        <input type="checkbox" id="ttp-branded" ${s.brandedContent ? 'checked' : ''} ${s.privacyLevel === 'SELF_ONLY' ? 'disabled' : ''}>
                                        <div class="ttp__checkbox-text">
                                            <span class="ttp__checkbox-title">Branded content</span>
                                            <span class="ttp__checkbox-desc">You are promoting another brand or a third party. This content will be classified as Branded Content.</span>
                                        </div>
                                    </label>

                                    ${labelPrompt ? `<div class="ttp__label-prompt ttp__label-prompt--visible">${this.escapeHtml(labelPrompt)}</div>` : ''}

                                    <div class="ttp__disclosure-error ${disclosureError ? 'ttp__disclosure-error--visible' : ''}">
                                        You need to indicate if your content promotes yourself, a third party, or both.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Point 4 & 5c: Consent Declaration -->
                    <div class="ttp__consent">
                        <label class="ttp__consent-check">
                            <input type="checkbox" id="ttp-consent">
                            <span class="ttp__consent-text">${declarationText}</span>
                        </label>
                    </div>

                    <!-- Point 5d: Processing Notice -->
                    <div class="ttp__processing-notice">
                        ℹ️ After publishing, it may take a few minutes for your content to process and become visible on your TikTok profile. We will track the upload status and notify you when it's ready.
                    </div>

                    <!-- Actions -->
                    <div class="ttp__actions">
                        <button class="ttp__btn ttp__btn--secondary" id="ttp-cancel">Cancel</button>
                        <button class="ttp__btn ttp__btn--publish" id="ttp-publish" ${!canPublish ? 'disabled' : ''} ${!canPublish ? 'title="Complete all required fields above"' : ''}>
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15.2a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.93a8.26 8.26 0 0 0 4.82 1.56V7.04a4.84 4.84 0 0 1-1.06-.35z"/></svg>
                            Post to TikTok
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents();
    }

    /**
     * Bind all event handlers
     */
    bindEvents() {
        const $ = (id) => this.container?.querySelector(`#${id}`);

        $('ttp-back')?.addEventListener('click', () => this.close());
        $('ttp-cancel')?.addEventListener('click', () => this.close());

        // Title editing
        $('ttp-title')?.addEventListener('input', (e) => {
            this.settings.title = e.target.value;
            const count = this.container.querySelector('#ttp-title-count');
            if (count) {
                count.textContent = `${e.target.value.length} / 2200`;
                count.classList.toggle('ttp__char-count--over', e.target.value.length > 2200);
            }
            this.updatePublishButton();
        });

        // Privacy selection
        $('ttp-privacy')?.addEventListener('change', (e) => {
            this.settings.privacyLevel = e.target.value;
            e.target.classList.remove('ttp__select--unselected');
            this.renderContent(); // Re-render to update branded content constraints
        });

        // Interaction toggles
        $('ttp-comment')?.addEventListener('change', (e) => {
            this.settings.allowComment = e.target.checked;
        });
        $('ttp-duet')?.addEventListener('change', (e) => {
            this.settings.allowDuet = e.target.checked;
        });
        $('ttp-stitch')?.addEventListener('change', (e) => {
            this.settings.allowStitch = e.target.checked;
        });

        // Commercial content toggle
        $('ttp-commercial')?.addEventListener('change', (e) => {
            this.settings.commercialContent = e.target.checked;
            if (!e.target.checked) {
                this.settings.yourBrand = false;
                this.settings.brandedContent = false;
            }
            this.renderContent();
        });

        $('ttp-your-brand')?.addEventListener('change', (e) => {
            this.settings.yourBrand = e.target.checked;
            this.renderContent();
        });

        $('ttp-branded')?.addEventListener('change', (e) => {
            this.settings.brandedContent = e.target.checked;
            // Point 3b: If branded content is selected, can't use SELF_ONLY
            if (e.target.checked && this.settings.privacyLevel === 'SELF_ONLY') {
                this.settings.privacyLevel = '';
            }
            this.renderContent();
        });

        // Consent checkbox
        $('ttp-consent')?.addEventListener('change', () => {
            this.updatePublishButton();
        });

        // Publish button
        $('ttp-publish')?.addEventListener('click', () => this.publish());
    }

    /**
     * Validate form completeness
     */
    validateForm() {
        const s = this.settings;

        // Must have title
        if (!s.title.trim()) return false;

        // Must have privacy selected
        if (!s.privacyLevel) return false;

        // If commercial toggle is on, must have at least one option
        if (s.commercialContent && !s.yourBrand && !s.brandedContent) return false;

        // Must not have creator error (can't post, duration exceeded)
        if (this._creatorError) return false;

        // Must have consent checked
        const consent = this.container?.querySelector('#ttp-consent');
        if (consent && !consent.checked) return false;

        return true;
    }

    /**
     * Update publish button state
     */
    updatePublishButton() {
        const btn = this.container?.querySelector('#ttp-publish');
        if (btn) {
            const valid = this.validateForm();
            btn.disabled = !valid;
            if (!valid) {
                btn.title = 'Complete all required fields above';
            } else {
                btn.title = '';
            }
        }
    }

    updateLoadingState() {
        if (!this.container) return;
        this.container.innerHTML = `
            <div class="ttp__header">
                <button class="ttp__back" id="ttp-back">← Back</button>
                <h2 class="ttp__title"><span class="ttp__title-icon">🎵</span>Post to TikTok</h2>
            </div>
            <div class="ttp__loading">
                <div class="ttp__loading-spinner"></div>
                <span class="ttp__loading-text">Loading creator info...</span>
            </div>
        `;
        this.container.querySelector('#ttp-back')?.addEventListener('click', () => this.close());
    }

    /**
     * Point 5c & 5e: Publish — send content to TikTok with user consent
     */
    async publish() {
        if (!this.validateForm()) return;

        this._publishing = true;
        this.showStatusModal('uploading', 'Uploading to TikTok...', 'Your content is being sent to TikTok. Please wait.');

        try {
            const brand = brandManager.getActiveBrand();
            if (!brand) throw new Error('No active brand');

            const connection = tiktokService.brandConnections[brand.id];
            let accessToken = connection.accessToken;

            // Build the post settings that will be saved
            const tiktokSettings = {
                title: this.settings.title,
                privacy_level: this.settings.privacyLevel,
                disable_comment: !this.settings.allowComment,
                disable_duet: !this.settings.allowDuet,
                disable_stitch: !this.settings.allowStitch,
                brand_organic_toggle: this.settings.commercialContent && this.settings.yourBrand,
                brand_content_toggle: this.settings.commercialContent && this.settings.brandedContent,
            };

            // Save user's TikTok settings to the post record in Supabase
            const existingContent = this.post.platform_content || {};
            existingContent.tiktok = {
                ...(existingContent.tiktok || {}),
                ...tiktokSettings,
                user_reviewed: true,
                reviewed_at: new Date().toISOString(),
            };

            await supabaseClient
                .from('posts')
                .update({
                    platform_content: existingContent,
                    status: 'approved',
                })
                .eq('id', this.post.id);

            // Now trigger the actual upload via the post-worker edge function
            const workerUrl = `${window.SUPABASE_URL || 'https://ustmetegzisztqqcjigt.supabase.co'}/functions/v1/post-worker`;
            const response = await fetch(workerUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${window.SUPABASE_SERVICE_KEY || supabaseClient.supabaseKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    post_id: this.post.id,
                    platform: 'tiktok',
                    tiktok_settings: tiktokSettings,
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Upload failed: ${errText}`);
            }

            const result = await response.json();

            if (result.success) {
                // Point 5e: Show success with processing notice
                this.showStatusModal('success', 'Posted to TikTok!', 
                    'Your content has been sent to TikTok. It may take a few minutes to process and become visible on your profile.');
                if (this.onPublished) this.onPublished(result);
            } else {
                throw new Error(result.error_message || 'Upload failed');
            }
        } catch (err) {
            console.error('[TikTok Publish] Error:', err);
            this.showStatusModal('error', 'Upload Failed', err.message);
        }

        this._publishing = false;
    }

    /**
     * Point 5e: Show status modal (uploading → processing → success/error)
     */
    showStatusModal(status, title, message) {
        document.getElementById('ttp-status-modal')?.remove();

        let iconHtml = '';
        if (status === 'uploading' || status === 'processing') {
            iconHtml = '<div class="ttp__status-spinner"></div>';
        } else if (status === 'success') {
            iconHtml = '<div class="ttp__status-icon ttp__status-icon--success">✓</div>';
        } else if (status === 'error') {
            iconHtml = '<div class="ttp__status-icon ttp__status-icon--error">✕</div>';
        }

        const html = `
            <div class="ttp__status-overlay" id="ttp-status-modal">
                <div class="ttp__status-card">
                    ${iconHtml}
                    <div class="ttp__status-title">${this.escapeHtml(title)}</div>
                    <div class="ttp__status-message">${this.escapeHtml(message)}</div>
                    ${status === 'success' || status === 'error' ? `
                        <button class="ttp__btn ttp__btn--secondary ttp__status-close" id="ttp-status-close">
                            ${status === 'success' ? 'Done' : 'Close'}
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('ttp-status-close')?.addEventListener('click', () => {
            document.getElementById('ttp-status-modal')?.remove();
            if (status === 'success') this.close();
        });
    }

    /**
     * Close the review overlay
     */
    close() {
        document.getElementById('ttp-overlay')?.remove();
        document.getElementById('ttp-status-modal')?.remove();
        document.body.style.overflow = '';
        if (this.onCancel) this.onCancel();
    }

    // Utilities
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    escapeAttr(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}

// Global instance
const tiktokPublishReview = new TikTokPublishReview();
