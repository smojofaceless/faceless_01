/**
 * Create Page Controller
 * Handles the unified content creation interface with phased generation
 * 
 * Flow:
 * Step 1: Settings - User chooses options
 * Step 2: Story + Audio - Generate story (preview mode) + voice audio
 * Step 3: Images - Generate images (show real-time progress)
 * Step 4: Video - Assemble final video
 */

class CreatePageController {
    constructor() {
        this.generator = null;
        this.sceneBuilder = null;
        this.template = null;
        this.currentStep = 1;
        this.formData = {};
        
        // Job state
        this.jobId = null;
        this.jobStatus = null;
        
        // Debug state
        this.debugMode = false;
        this.verboseMode = false;
        this.apiLogs = [];

        this.init();
    }

    async init() {
        console.log('CreatePageController: Initializing...');
        
        try {
            // Initialize components
            this.sceneBuilder = new SceneBuilder();
            
            // Set up event listeners
            this.setupEventListeners();
            
            // Check if brandManager exists
            if (typeof brandManager === 'undefined') {
                console.error('CreatePageController: brandManager is not defined');
                this.showNoBrandState();
                return;
            }
            
            // Initialize brand switcher
            await this.initBrandSwitcher();
            
            // Check for active brand
            await this.loadActiveBrand();
            
        } catch (error) {
            console.error('CreatePageController: Init error:', error);
            this.showNoBrandState();
        }
    }

    setupEventListeners() {
        // Navigation buttons
        document.getElementById('btn-prev')?.addEventListener('click', () => this.prevStep());
        document.getElementById('btn-next')?.addEventListener('click', () => this.nextStep());
        
        // Create another button
        document.getElementById('btn-create-another')?.addEventListener('click', () => this.reset());
        
        // Debug toggle
        document.getElementById('btn-toggle-debug')?.addEventListener('click', () => this.toggleDebug());
        
        // Verbose toggle
        document.getElementById('btn-toggle-verbose')?.addEventListener('click', () => this.toggleVerbose());
        
        // Error modal
        document.getElementById('btn-close-error')?.addEventListener('click', () => this.closeErrorModal());
        document.querySelector('#error-modal .modal__close')?.addEventListener('click', () => this.closeErrorModal());
        document.querySelector('#error-modal .modal__overlay')?.addEventListener('click', () => this.closeErrorModal());
    }

    async initBrandSwitcher() {
        console.log('initBrandSwitcher: Starting...', {
            BrandSwitcher: !!window.BrandSwitcher,
            brandManager: typeof brandManager !== 'undefined'
        });
        
        // Initialize brand switcher component if available
        if (window.BrandSwitcher && typeof brandManager !== 'undefined') {
            console.log('initBrandSwitcher: Creating BrandSwitcher instance');
            const switcher = new BrandSwitcher({
                selector: '#brand-switcher',
                onSelect: (brand) => this.onBrandChange(brand)
            });
            switcher.init();
            console.log('initBrandSwitcher: BrandSwitcher initialized');
            
            // Listen for brand changes from the brand manager
            brandManager.on('brand:activated', (brand) => this.onBrandChange(brand));
        } else {
            console.warn('initBrandSwitcher: BrandSwitcher or brandManager not available');
        }
    }

    async loadActiveBrand() {
        console.log('CreatePageController: Loading active brand...');
        
        try {
            // Use the global brandManager if available
            if (typeof brandManager !== 'undefined') {
                // Get active brand
                let brand = brandManager.getActiveBrand();
                console.log('CreatePageController: Active brand:', brand);
                
                if (brand) {
                    await this.loadTemplate(brand);
                    return;
                }
                
                // No active brand - try to get the first available brand
                const allBrands = brandManager.getAll();
                console.log('CreatePageController: All brands:', allBrands);
                
                if (allBrands.length > 0) {
                    // Auto-select first brand
                    brand = allBrands[0];
                    brandManager.setActive(brand.id);
                    await this.loadTemplate(brand);
                    return;
                }
            }
            
            // No brands available - show selection prompt
            console.log('CreatePageController: No brands found, showing no-brand state');
            this.showNoBrandState();
            
        } catch (error) {
            console.error('Error loading active brand:', error);
            this.showNoBrandState();
        }
    }

    async onBrandChange(brand) {
        if (!brand) {
            this.showNoBrandState();
            return;
        }
        
        // Reset state for new brand
        this.currentStep = 1;
        this.formData = {};
        
        await this.loadTemplate(brand);
    }

    async loadTemplate(brand) {
        console.log('CreatePageController: Loading template for brand:', brand);
        this.showLoading();
        
        try {
            // Check if templateLoader exists
            if (typeof templateLoader === 'undefined') {
                throw new Error('templateLoader is not defined');
            }
            
            // Load template based on brand's niche
            console.log('CreatePageController: Brand niche:', brand.niche);
            this.template = await templateLoader.loadByBrand(brand);
            console.log('CreatePageController: Template loaded:', this.template);
            
            if (!this.template) {
                throw new Error('No template returned for niche: ' + brand.niche);
            }
            
            // Initialize generator with template
            console.log('CreatePageController: Creating VideoGenerator...');
            this.generator = new VideoGenerator(this.template);
            console.log('CreatePageController: VideoGenerator created');
            
            this.setupGeneratorEvents();
            console.log('CreatePageController: Generator events set up');
            
            // Update UI
            console.log('CreatePageController: Updating page branding...');
            this.updatePageBranding();
            console.log('CreatePageController: Rendering step indicators...');
            this.renderStepIndicators();
            console.log('CreatePageController: Rendering current step...');
            this.renderCurrentStep();
            
            // Show create interface
            console.log('CreatePageController: Showing create interface...');
            this.showCreateInterface();
            console.log('CreatePageController: Done!');
            
        } catch (error) {
            console.error('Error loading template:', error);
            this.showError('Failed to load template: ' + error.message);
        }
    }

    setupGeneratorEvents() {
        this.generator.on('log', (data) => this.addLog(data.message, data.type));
        this.generator.on('progress', (data) => this.updateProgress(data));
        this.generator.on('phaseChange', (data) => this.updatePhase(data));
        this.generator.on('imagesUpdate', (images) => this.updateImageGrid(images));
        this.generator.on('generationComplete', (result) => this.showResult(result));
        this.generator.on('error', (error) => this.handleGenerationError(error));
        this.generator.on('stepChange', (data) => this.onStepChange(data));
    }

    updatePageBranding() {
        if (!this.template) return;
        
        // Update title
        document.getElementById('page-title').textContent = this.template.name;
        document.getElementById('template-icon').textContent = this.template.icon;
        document.title = `${this.template.name} - ContentEngine`;
        
        // Update favicon
        const favicon = document.getElementById('favicon');
        favicon.href = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${this.template.icon}</text></svg>`;
    }

    // ==================== Step Management ====================

    renderStepIndicators() {
        const container = document.getElementById('step-indicators');
        if (!container || !this.template?.steps) return;

        container.innerHTML = this.template.steps.map((step, index) => `
            <div class="step-indicator ${index === 0 ? 'active' : ''}" data-step="${index + 1}">
                <div class="step-indicator__number">${index + 1}</div>
                <span class="step-indicator__label">${step.name}</span>
            </div>
            ${index < this.template.steps.length - 1 ? '<div class="step-indicator__line"></div>' : ''}
        `).join('');
    }

    renderCurrentStep() {
        const container = document.getElementById('step-content');
        if (!container || !this.template?.steps) return;

        const stepConfig = this.template.steps[this.currentStep - 1];
        
        // Render based on step type
        switch (stepConfig.id) {
            case 'settings':
            case 'topic':
                this.renderSettingsStep(container);
                break;
            case 'story':
            case 'facts':
            case 'content':
                this.renderContentStep(container);
                break;
            case 'images':
                this.renderImagesStep(container);
                break;
            case 'generate':
            case 'video':
                this.renderGenerateStep(container);
                break;
            default:
                this.renderSettingsStep(container);
        }

        // Update navigation buttons
        this.updateNavigationButtons();
    }

    renderSettingsStep(container) {
        const settings = this.template.settings;
        
        let html = `
            <div class="create-card">
                <h2 class="create-card__title">${this.template.steps[0].icon} Configure Your Video</h2>
                <div class="create-form">
        `;

        // Topic input (if applicable)
        if (this.template.niche === 'food' || this.template.id === 'generic') {
            html += `
                <div class="form-group">
                    <label class="form-label">📝 Topic</label>
                    <input type="text" id="topic" class="form-control" placeholder="Enter your topic...">
                </div>
            `;
        }

        // Theme/Category selection
        const categories = settings.themes || settings.categories || settings.contentTypes;
        if (categories) {
            const label = settings.themes ? 'Theme' : 'Category';
            html += `
                <div class="form-group">
                    <label class="form-label">🎭 ${label}</label>
                    <select id="category" class="form-control select">
                        ${categories.map(c => `<option value="${c.value}">${c.icon || ''} ${c.label}</option>`).join('')}
                    </select>
                </div>
            `;
        }

        // Style/Vibe selection
        const styles = settings.vibes || settings.contentStyles;
        if (styles) {
            html += `
                <div class="form-group">
                    <label class="form-label">📖 Style</label>
                    <select id="style" class="form-control select">
                        ${styles.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
                    </select>
                    <p class="form-hint" id="style-hint">${styles[0].description || ''}</p>
                </div>
            `;
        }

        // Visual source
        html += `
            <div class="form-group">
                <label class="form-label">🖼️ Visual Source</label>
                <div class="visual-source-options">
                    <label class="visual-source-option">
                        <input type="radio" name="visualSource" value="ai" ${this.template.defaults.visualSource === 'ai' ? 'checked' : ''}>
                        <div class="visual-source-option__content">
                            <span class="visual-source-option__icon">🎨</span>
                            <span class="visual-source-option__label">AI Generated</span>
                            <span class="visual-source-option__cost">~$0.02-0.08/image</span>
                        </div>
                    </label>
                    <label class="visual-source-option">
                        <input type="radio" name="visualSource" value="pexels" ${this.template.defaults.visualSource === 'pexels' ? 'checked' : ''}>
                        <div class="visual-source-option__content">
                            <span class="visual-source-option__icon">📹</span>
                            <span class="visual-source-option__label">Stock (Pexels)</span>
                            <span class="visual-source-option__cost">Free</span>
                        </div>
                    </label>
                </div>
            </div>
        `;

        // AI Model selection (shown when AI is selected)
        html += `
            <div class="form-group" id="ai-model-group">
                <label class="form-label">🤖 AI Image Model</label>
                <select id="imageModel" class="form-control select">
                    <option value="gpt-4o">GPT-4o - Best value (~$0.016/img) ⭐</option>
                    <option value="dall-e-3">DALL-E 3 - Best for illustrations (~$0.08/img)</option>
                    <option value="flux">FLUX Pro - Best for realistic (~$0.04/img)</option>
                </select>
            </div>
        `;

        // Art style (for AI images)
        const artStyles = settings.artStyles || settings.visualStyles;
        if (artStyles) {
            html += `
                <div class="form-group" id="art-style-group">
                    <label class="form-label">🎨 Art Style</label>
                    <select id="artStyle" class="form-control select">
                        ${artStyles.map(a => `<option value="${a.value}">${a.label}</option>`).join('')}
                    </select>
                    <div class="art-style-preview" id="art-style-preview">
                        <p>${artStyles[0].description}</p>
                    </div>
                </div>
            `;
        }

        // Duration
        if (settings.durations) {
            html += `
                <div class="form-group">
                    <label class="form-label">⏱️ Duration</label>
                    <select id="duration" class="form-control select">
                        ${settings.durations.map(d => `<option value="${d.value}" ${d.value === this.template.defaults.duration ? 'selected' : ''}>${d.label}</option>`).join('')}
                    </select>
                </div>
            `;
        }

        // Scene count (for templates that use it)
        if (this.template.defaults.sceneCount) {
            html += `
                <div class="form-group">
                    <label class="form-label">📷 Number of Scenes</label>
                    <div class="range-input">
                        <input type="range" id="sceneCount" min="3" max="24" value="${this.template.defaults.sceneCount}">
                        <span id="sceneCount-display" class="range-input__value">${this.template.defaults.sceneCount}</span>
                    </div>
                </div>
            `;
        }

        // Caption style
        if (settings.captionStyles) {
            html += `
                <div class="form-group">
                    <label class="form-label">💬 Caption Style</label>
                    <div class="caption-style-grid">
                        ${settings.captionStyles.map(c => `
                            <button type="button" class="caption-style-btn ${c.value === this.template.defaults.captionStyle ? 'active' : ''}" data-style="${c.value}">
                                <span class="caption-preview ${c.class}">${c.label}</span>
                            </button>
                        `).join('')}
                    </div>
                    <input type="hidden" id="captionStyle" value="${this.template.defaults.captionStyle}">
                </div>
            `;
        }

        // Effects (collapsible)
        if (this.template.effects) {
            html += `
                <div class="form-group">
                    <label class="form-label">✨ Video Effects</label>
                    <div class="effects-container">
                        ${this.template.effects.map(category => `
                            <div class="effects-category">
                                <div class="effects-category__header" style="color: var(--color-${category.color || 'primary'})">
                                    ${category.label}
                                    ${category.subtitle ? `<span class="effects-category__subtitle">${category.subtitle}</span>` : ''}
                                </div>
                                <div class="effects-category__items">
                                    ${category.items.map(effect => `
                                        <label class="effect-item">
                                            <input type="checkbox" id="effect-${effect.id}" ${effect.default ? 'checked' : ''}>
                                            <span class="effect-item__label">${effect.label}</span>
                                            <span class="effect-item__time">${effect.time}</span>
                                        </label>
                                    `).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Cost estimate
        html += `
            <div class="cost-estimate">
                <h3 class="cost-estimate__title">💰 Estimated Cost</h3>
                <div id="cost-breakdown" class="cost-estimate__breakdown">
                    <!-- Updated by JS -->
                </div>
            </div>
        `;

        html += `
                </div>
            </div>
        `;

        container.innerHTML = html;
        this.setupSettingsListeners();
        this.updateCostEstimate();
    }

    setupSettingsListeners() {
        // Style hint update
        document.getElementById('style')?.addEventListener('change', (e) => {
            const styles = this.template.settings.vibes || this.template.settings.contentStyles;
            const selected = styles?.find(s => s.value === e.target.value);
            if (selected) {
                document.getElementById('style-hint').textContent = selected.description || '';
            }
        });

        // Art style preview
        document.getElementById('artStyle')?.addEventListener('change', (e) => {
            const styles = this.template.settings.artStyles || this.template.settings.visualStyles;
            const selected = styles?.find(s => s.value === e.target.value);
            if (selected) {
                document.getElementById('art-style-preview').innerHTML = `<p>${selected.description}</p>`;
            }
        });

        // Visual source toggle
        document.querySelectorAll('input[name="visualSource"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const isAI = e.target.value === 'ai';
                document.getElementById('ai-model-group')?.classList.toggle('hidden', !isAI);
                document.getElementById('art-style-group')?.classList.toggle('hidden', !isAI);
                this.updateCostEstimate();
            });
        });

        // Scene count slider
        document.getElementById('sceneCount')?.addEventListener('input', (e) => {
            document.getElementById('sceneCount-display').textContent = e.target.value;
            this.updateCostEstimate();
        });

        // Caption style selection
        document.querySelectorAll('.caption-style-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.caption-style-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('captionStyle').value = btn.dataset.style;
            });
        });

        // Update cost on model change
        document.getElementById('imageModel')?.addEventListener('change', () => this.updateCostEstimate());
    }

    updateCostEstimate() {
        const settings = this.collectFormData();
        const cost = this.template.calculateCost(settings);
        
        const container = document.getElementById('cost-breakdown');
        if (!container) return;

        container.innerHTML = `
            <div class="cost-item">
                <span>Story/Script</span>
                <span>~$${cost.story.toFixed(2)}</span>
            </div>
            <div class="cost-item">
                <span>Voice</span>
                <span>~$${cost.voice.toFixed(2)}</span>
            </div>
            <div class="cost-item">
                <span>Images</span>
                <span>~$${cost.images.toFixed(2)}</span>
            </div>
            <div class="cost-item cost-item--total">
                <span>Total</span>
                <span>~$${cost.total.toFixed(2)}</span>
            </div>
        `;
    }

    renderContentStep(container) {
        console.log('renderContentStep - formData:', this.formData);
        console.log('renderContentStep - sceneBuilder.scenes:', this.sceneBuilder.scenes);
        
        // Generate a title if not set
        const title = this.formData.title || this.generateTitle();
        
        // Get the content - handle array case
        let content = this.formData.content || '';
        if (Array.isArray(content)) {
            content = content.map(s => typeof s === 'string' ? s : s.text || '').join(' ');
        }
        
        container.innerHTML = `
            <div class="create-card">
                <h2 class="create-card__title">📖 Review & Edit Content</h2>
                
                <div class="form-group">
                    <label class="form-label">📝 Title</label>
                    <input type="text" id="content-title" class="form-control" value="${title}" placeholder="Enter a title for your video...">
                </div>

                <div class="form-group">
                    <label class="form-label">🎬 Scene Breakdown <span class="form-label__hint">(${this.sceneBuilder.scenes.length} scenes)</span></label>
                    <div id="scene-breakdown" class="scene-breakdown scene-breakdown--columns">
                        ${this.sceneBuilder.scenes.length === 0 ? '<p class="text-muted">No scenes generated yet</p>' : ''}
                    </div>
                </div>
            </div>
        `;

        // Render scenes with improved layout
        if (this.sceneBuilder && this.sceneBuilder.scenes && this.sceneBuilder.scenes.length > 0) {
            console.log('Rendering scene cards...');
            this.renderSceneCardsColumnar('scene-breakdown');
        } else {
            console.log('No scenes to render');
        }
    }

    /**
     * Generate a title based on template and settings
     */
    generateTitle() {
        const theme = this.formData.category || '';
        const templateName = this.template?.name || 'Story';
        
        // Generate based on first scene text if available
        if (this.sceneBuilder.scenes.length > 0) {
            const firstScene = this.sceneBuilder.scenes[0].text;
            // Take first few words as title
            const words = firstScene.split(' ').slice(0, 5).join(' ');
            return words + '...';
        }
        
        return `${templateName} - ${theme || 'Untitled'}`;
    }

    /**
     * Render scene cards in columnar layout (scene # on left, text on right)
     */
    renderSceneCardsColumnar(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = this.sceneBuilder.scenes.map((scene, index) => `
            <div class="scene-card scene-card--columnar" data-scene-id="${scene.id}">
                <div class="scene-card__left">
                    <div class="scene-card__number-badge">Scene ${scene.id}</div>
                    <span class="scene-card__mood">${scene.mood || 'neutral'}</span>
                </div>
                <div class="scene-card__right">
                    <textarea class="scene-card__text" data-scene-id="${scene.id}" rows="3">${scene.text}</textarea>
                </div>
            </div>
        `).join('');

        // Add event listeners
        container.querySelectorAll('.scene-card__text').forEach(textarea => {
            textarea.addEventListener('input', (e) => {
                const sceneId = parseInt(e.target.dataset.sceneId);
                this.sceneBuilder.updateScene(sceneId, { text: e.target.value });
            });
        });
    }

    renderImagesStep(container) {
        // Check if images have already been generated
        const hasImages = this.sceneBuilder.scenes.some(s => s.imageUrl);
        
        container.innerHTML = `
            <div class="create-card">
                <h2 class="create-card__title">🎨 ${hasImages ? 'Generated Images' : 'Generate Images'}</h2>
                <p class="create-card__subtitle">${hasImages ? 'Your images are ready!' : 'Click Continue to generate images for each scene'}</p>
                
                <div class="image-generation-controls">
                    <div class="image-source-info">
                        <span class="image-source-badge">
                            ${this.formData.visualSource === 'ai' ? '🎨 AI Generated' : '📹 Stock (Pexels)'}
                        </span>
                        ${this.formData.visualSource === 'ai' ? 
                            `<span class="image-model-badge">${this.getModelDisplayName(this.formData.imageModel || 'gpt-4o')}</span>` : ''}
                    </div>
                    <div class="image-cost-estimate">
                        <span class="text-muted">Est. cost: </span>
                        <span class="text-primary">~$${this.calculateImageCost().toFixed(2)}</span>
                    </div>
                </div>
                
                <div id="image-preview-grid" class="image-preview-grid">
                    ${this.sceneBuilder.scenes.map((scene, i) => `
                        <div class="image-preview-card ${scene.imageUrl ? 'image-preview-card--loaded' : ''}" data-scene-id="${scene.id}">
                            ${scene.imageUrl 
                                ? `<img src="${scene.imageUrl}" class="image-preview-card__img" alt="Scene ${i + 1}">`
                                : `<div class="image-preview-card__placeholder">
                                    <span class="image-preview-card__placeholder-icon">🎬</span>
                                    <span>Scene ${i + 1}</span>
                                </div>`
                            }
                            <div class="image-preview-card__overlay">
                                <span class="image-preview-card__number">Scene ${i + 1}</span>
                            </div>
                            <p class="image-preview-card__text">${scene.text.substring(0, 80)}${scene.text.length > 80 ? '...' : ''}</p>
                        </div>
                    `).join('')}
                </div>
                
                ${!hasImages ? `
                <div class="image-step-note">
                    <span class="note-icon">⚡</span>
                    <span>Click "Continue" to start generating images. You'll see them appear in real-time!</span>
                </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Get display name for AI model
     */
    getModelDisplayName(model) {
        const names = {
            'gpt-4o': 'GPT-4o',
            'dall-e-3': 'DALL-E 3',
            'flux': 'FLUX Pro'
        };
        return names[model] || model;
    }

    /**
     * Calculate estimated image generation cost
     */
    calculateImageCost() {
        const sceneCount = this.sceneBuilder.scenes.length;
        if (this.formData.visualSource !== 'ai') return 0;
        
        const costs = {
            'gpt-4o': 0.016,
            'dall-e-3': 0.08,
            'flux': 0.04
        };
        const costPer = costs[this.formData.imageModel] || 0.016;
        return sceneCount * costPer;
    }

    renderGenerateStep(container) {
        // Show generated images and final summary
        const hasImages = this.sceneBuilder.scenes.some(s => s.imageUrl);
        
        container.innerHTML = `
            <div class="create-card">
                <h2 class="create-card__title">🎬 Ready to Assemble Video</h2>
                <p class="create-card__subtitle">Your story and images are ready. Click below to create the final video.</p>
                
                <div class="generate-summary">
                    <div class="generate-summary__item">
                        <span class="generate-summary__label">📖 Title</span>
                        <span class="generate-summary__value">${this.formData.title || 'Untitled'}</span>
                    </div>
                    <div class="generate-summary__item">
                        <span class="generate-summary__label">🎬 Scenes</span>
                        <span class="generate-summary__value">${this.sceneBuilder.scenes.length}</span>
                    </div>
                    <div class="generate-summary__item">
                        <span class="generate-summary__label">🖼️ Images</span>
                        <span class="generate-summary__value">${hasImages ? '✅ Generated' : '⏳ Pending'}</span>
                    </div>
                    <div class="generate-summary__item">
                        <span class="generate-summary__label">🔊 Audio</span>
                        <span class="generate-summary__value">✅ Generated</span>
                    </div>
                </div>
                
                ${hasImages ? `
                <div class="generate-preview">
                    <h3>Preview Images</h3>
                    <div class="generate-preview__images">
                        ${this.sceneBuilder.scenes.slice(0, 4).map((scene, i) => `
                            <img src="${scene.imageUrl}" alt="Scene ${i + 1}" class="generate-preview__img">
                        `).join('')}
                        ${this.sceneBuilder.scenes.length > 4 ? `<span class="generate-preview__more">+${this.sceneBuilder.scenes.length - 4} more</span>` : ''}
                    </div>
                </div>
                ` : ''}
                
                <button id="btn-generate" class="btn btn--primary btn--lg btn--full">
                    🎬 Assemble Video
                </button>
                
                <div class="generate-note">
                    <span>💡</span>
                    <span>This will combine your images, audio, and captions into the final video.</span>
                </div>
            </div>
        `;

        document.getElementById('btn-generate')?.addEventListener('click', () => this.executeVideoAssemblyPhase());
    }

    updateNavigationButtons() {
        const prevBtn = document.getElementById('btn-prev');
        const nextBtn = document.getElementById('btn-next');
        const totalSteps = this.template?.steps?.length || 1;

        if (prevBtn) {
            prevBtn.disabled = this.currentStep <= 1;
        }

        if (nextBtn) {
            const isLastStep = this.currentStep >= totalSteps;
            nextBtn.textContent = isLastStep ? 'Generate →' : 'Continue →';
        }
    }

    prevStep() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this.updateStepIndicators();
            this.renderCurrentStep();
        }
    }

    async nextStep() {
        const totalSteps = this.template?.steps?.length || 1;
        
        // Collect form data
        this.collectAndSaveFormData();
        
        if (this.currentStep < totalSteps) {
            try {
                // Execute phase-specific actions BEFORE advancing step
                const stepId = this.template.steps[this.currentStep - 1]?.id;
                this.debugLog('nextStep', `Current step: ${this.currentStep} (${stepId}), advancing...`);
                
                // Step 1 -> 2: Create job + Generate story + Generate audio
                if (this.currentStep === 1) {
                    await this.executeStoryAndAudioPhase();
                }
                // Step 2 -> 3: Generate images
                else if (this.currentStep === 2) {
                    await this.executeImagesPhase();
                }
                // Step 3 -> 4: Just advance, video assembly happens on Generate click
                
                this.currentStep++;
                this.updateStepIndicators();
                this.renderCurrentStep();
                
            } catch (error) {
                console.error('Phase execution failed:', error);
                this.addLog(`❌ Failed: ${error.message}`, 'error');
                this.showError(error.message);
            }
        } else {
            // Last step - start video assembly
            await this.executeVideoAssemblyPhase();
        }
    }

    /**
     * Phase 1: Create job + Story generation + Audio generation
     */
    async executeStoryAndAudioPhase() {
        const stepContent = document.getElementById('step-content');
        
        // Show loading state
        this.showStepLoading(stepContent, 'Generating story and audio...');
        
        try {
            // === Step 1: Create the job ===
            this.addLog('📝 Creating job on server...', 'info');
            this.debugLog('createJob', 'Building payload...');
            
            const payload = this.buildJobPayload();
            this.debugLog('createJob', `Payload: ${JSON.stringify(payload, null, 2)}`);
            
            const startCreate = performance.now();
            const createResponse = await createJob(payload);
            const createTime = ((performance.now() - startCreate) / 1000).toFixed(2);
            
            this.jobId = createResponse.job_id || createResponse.jobId;
            this.debugLog('createJob', `Job created in ${createTime}s: ${this.jobId}`);
            this.addLog(`✅ Job created: ${this.jobId.substring(0, 8)}...`, 'success');
            
            // === Step 2: Run preview mode (story generation) ===
            this.addLog('📖 Generating story...', 'info');
            this.updateStepLoadingMessage(stepContent, 'AI is writing your story...');
            
            const startPreview = performance.now();
            const previewResponse = await runPreviewMode(this.jobId);
            const previewTime = ((performance.now() - startPreview) / 1000).toFixed(2);
            
            this.debugLog('runPreviewMode', `Preview completed in ${previewTime}s`);
            this.debugLog('runPreviewMode', `Response: ${JSON.stringify(previewResponse, null, 2)}`);
            
            // Store story data from preview response (it has the scenes)
            this.formData.title = previewResponse.title || '';
            this.formData.content = previewResponse.story_text || '';
            this.formData.sceneCount = previewResponse.scenes?.length || previewResponse.generation_details?.scene_count || 6;
            
            this.debugLog('runPreviewMode', `Title: ${this.formData.title}`);
            this.debugLog('runPreviewMode', `Scenes: ${previewResponse.scenes?.length || 0}`);
            
            // Parse scenes from PREVIEW response (not checkJob which doesn't have them yet)
            if (previewResponse.scenes && previewResponse.scenes.length > 0) {
                this.sceneBuilder.setScenes(previewResponse.scenes.map((s, i) => ({
                    id: i + 1,
                    text: s.text || '',
                    imagePrompt: s.keywords?.join(', ') || s.image_prompt || '',
                    mood: 'neutral',
                    startTime: s.startTime || 0,
                    endTime: s.endTime || 0
                })));
                this.addLog(`✅ Story generated: ${previewResponse.scenes.length} scenes`, 'success');
                this.debugLog('runPreviewMode', `Stored ${this.sceneBuilder.scenes.length} scenes in sceneBuilder`);
            } else {
                this.debugLog('runPreviewMode', 'WARNING: No scenes in preview response!');
            }
            
            // === Step 3: Run audio phase ===
            this.addLog('🔊 Generating voice audio...', 'info');
            this.updateStepLoadingMessage(stepContent, 'Creating voice narration...');
            
            const startAudio = performance.now();
            const audioResponse = await runJobPhase(this.jobId, 'audio');
            const audioTime = ((performance.now() - startAudio) / 1000).toFixed(2);
            
            this.debugLog('runJobPhase:audio', `Audio phase completed in ${audioTime}s`);
            this.debugLog('runJobPhase:audio', `Response: ${JSON.stringify(audioResponse, null, 2)}`);
            
            this.addLog(`✅ Audio generated in ${audioTime}s`, 'success');
            
            // Update job status
            this.jobStatus = await checkJob(this.jobId);
            this.debugLog('checkJob', `Final status: ${this.jobStatus.status}, progress: ${this.jobStatus.progress}%`);
            
        } catch (error) {
            this.debugLog('executeStoryAndAudioPhase', `ERROR: ${error.message}`);
            throw error;
        }
    }

    /**
     * Phase 2: Image generation with real-time updates
     */
    async executeImagesPhase() {
        const stepContent = document.getElementById('step-content');
        
        if (!this.jobId) {
            throw new Error('No job ID - please go back and regenerate the story');
        }
        
        this.addLog('🎨 Starting image generation...', 'info');
        this.debugLog('executeImagesPhase', `Job ID: ${this.jobId}`);
        
        // Show the image grid with loading states
        this.renderImagesStepWithProgress(stepContent);
        
        try {
            // Start the images phase
            const startImages = performance.now();
            
            // Trigger image generation
            const imageResponse = await runJobPhase(this.jobId, 'images');
            this.debugLog('runJobPhase:images', `Initial response: ${JSON.stringify(imageResponse, null, 2)}`);
            
            // Poll for image updates
            await this.pollForImages();
            
            const imageTime = ((performance.now() - startImages) / 1000).toFixed(2);
            this.addLog(`✅ Images generated in ${imageTime}s`, 'success');
            
        } catch (error) {
            this.debugLog('executeImagesPhase', `ERROR: ${error.message}`);
            throw error;
        }
    }

    /**
     * Poll for images as they generate
     */
    async pollForImages() {
        const maxPolls = 180; // 6 minutes max (images can take a while)
        const pollInterval = 3000; // Check every 3 seconds
        let polls = 0;
        let lastImageCount = 0;
        const totalExpected = this.formData.sceneCount || this.sceneBuilder.scenes.length || 6;
        
        this.debugLog('pollForImages', `Starting image polling... expecting ${totalExpected} images`);
        this.addVisualDebug(`Polling for ${totalExpected} images...`);
        
        while (polls < maxPolls) {
            try {
                const status = await checkJob(this.jobId);
                
                // check-job returns scenes array with videoUrl/imageUrl for each generated image
                // Also check images_generated count from meta
                const scenes = status.scenes || [];
                const imagesGenerated = status.images_generated || scenes.filter(s => s.videoUrl || s.url).length;
                
                this.addVisualDebug(`Poll ${polls + 1}: status=${status.status}, progress=${status.progress}%, images=${imagesGenerated}/${totalExpected}`);
                
                // Update the counter
                const countEl = document.getElementById('images-generated-count');
                if (countEl) countEl.textContent = imagesGenerated;
                
                // Update image cards for any new images
                if (imagesGenerated > lastImageCount) {
                    this.debugLog('pollForImages', `New images detected: ${imagesGenerated} (was ${lastImageCount})`);
                    
                    // Update each scene that has an image
                    scenes.forEach((scene, idx) => {
                        const imageUrl = scene.videoUrl || scene.url || scene.imageUrl;
                        if (imageUrl) {
                            this.updateImageCard(scene.index ?? idx, { url: imageUrl });
                            // Also update sceneBuilder
                            if (this.sceneBuilder.scenes[idx]) {
                                this.sceneBuilder.updateScene(idx + 1, { imageUrl: imageUrl });
                            }
                        }
                    });
                    
                    lastImageCount = imagesGenerated;
                    this.addLog(`🖼️ ${imagesGenerated}/${totalExpected} images generated`, 'info');
                }
                
                // Check if images phase is complete
                if (imagesGenerated >= totalExpected || status.progress >= 70 || status.status === 'completed') {
                    this.debugLog('pollForImages', `Images complete! ${imagesGenerated}/${totalExpected}`);
                    this.addVisualDebug(`✅ All ${imagesGenerated} images generated!`);
                    break;
                }
                
                // Check for errors
                if (status.status === 'failed') {
                    this.addVisualDebug(`❌ Error: ${status.error}`);
                    throw new Error(status.error || 'Image generation failed');
                }
                
            } catch (pollError) {
                this.addVisualDebug(`⚠️ Poll error: ${pollError.message}`);
                console.error('Poll error:', pollError);
            }
            
            await new Promise(r => setTimeout(r, pollInterval));
            polls++;
            
            if (polls % 10 === 0) {
                this.addLog(`⏳ Generating images... (${polls * 3}s elapsed)`, 'info');
            }
        }
        
        // Final update
        const finalStatus = await checkJob(this.jobId);
        const finalScenes = finalStatus.scenes || [];
        this.debugLog('pollForImages', `Final check: ${finalScenes.length} scenes with images`);
        
        finalScenes.forEach((scene, idx) => {
            const imageUrl = scene.videoUrl || scene.url || scene.imageUrl;
            if (imageUrl && this.sceneBuilder.scenes[idx]) {
                this.sceneBuilder.updateScene(idx + 1, { imageUrl: imageUrl });
            }
        });
    }
    
    /**
     * Add message to visual debug panel
     */
    addVisualDebug(message) {
        const panel = document.getElementById('visual-debug-content');
        if (!panel) return;
        
        const timestamp = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.className = 'visual-debug-entry';
        entry.innerHTML = `<span class="visual-debug-time">[${timestamp}]</span> ${message}`;
        panel.appendChild(entry);
        panel.scrollTop = panel.scrollHeight;
    }

    /**
     * Phase 3: Video assembly
     */
    async executeVideoAssemblyPhase() {
        if (!this.jobId) {
            throw new Error('No job ID - please start from the beginning');
        }
        
        // Hide create interface, show progress
        document.getElementById('create-interface').classList.add('hidden');
        document.getElementById('generation-progress').classList.remove('hidden');
        
        // Reset phase indicators
        this.resetPhaseIndicators();
        this.updatePhase({ phase: 'video', status: 'active', message: 'Assembling video...' });
        
        // Mark previous phases as complete
        this.updatePhase({ phase: 'story', status: 'completed' });
        this.updatePhase({ phase: 'audio', status: 'completed' });
        this.updatePhase({ phase: 'images', status: 'completed' });
        
        this.addLog('🎬 Starting video assembly...', 'info');
        
        try {
            const startAssemble = performance.now();
            
            // Trigger assemble phase - this might timeout but still be working on server
            try {
                const assembleResponse = await runJobPhase(this.jobId, 'assemble');
                this.debugLog('runJobPhase:assemble', `Response: ${JSON.stringify(assembleResponse, null, 2)}`);
                this.addLog('✅ Assembly phase started', 'success');
            } catch (phaseError) {
                // If the edge function times out (500), the job might still be running
                this.debugLog('runJobPhase:assemble', `Phase call failed: ${phaseError.message}`);
                this.addLog(`⚠️ Assembly call returned error (may still be processing): ${phaseError.message}`, 'warning');
                // Continue to polling - job might have started
            }
            
            // Poll for completion regardless of initial response
            await this.pollForVideoCompletion();
            
            const assembleTime = ((performance.now() - startAssemble) / 1000).toFixed(2);
            this.addLog(`✅ Video assembled in ${assembleTime}s`, 'success');
            
        } catch (error) {
            this.debugLog('executeVideoAssemblyPhase', `ERROR: ${error.message}`);
            this.addLog(`❌ Video assembly failed: ${error.message}`, 'error');
            this.updatePhase({ phase: 'video', status: 'error' });
            this.showError(`Video assembly failed: ${error.message}`);
        }
    }

    /**
     * Poll for video completion
     */
    async pollForVideoCompletion() {
        const maxPolls = 180; // 6 minutes max
        const pollInterval = 2000;
        let polls = 0;
        
        while (polls < maxPolls) {
            const status = await checkJob(this.jobId);
            
            // Update progress
            this.updateProgress({
                percent: status.progress || 0,
                label: status.message || 'Assembling...'
            });
            
            if (status.status === 'completed') {
                this.debugLog('pollForVideoCompletion', 'Video complete!');
                this.updatePhase({ phase: 'video', status: 'completed' });
                this.showResult(status);
                return;
            }
            
            if (status.status === 'failed') {
                throw new Error(status.error || 'Video assembly failed');
            }
            
            await new Promise(r => setTimeout(r, pollInterval));
            polls++;
            
            if (polls % 10 === 0) {
                this.addLog(`⏳ Assembling video... (${polls * 2}s)`, 'verbose');
            }
        }
        
        throw new Error('Video assembly timed out');
    }

    collectFormData() {
        const data = {};
        
        // Collect all form inputs
        document.querySelectorAll('#step-content input, #step-content select, #step-content textarea').forEach(el => {
            if (el.type === 'checkbox') {
                data[el.id] = el.checked;
            } else if (el.type === 'radio') {
                if (el.checked) data[el.name] = el.value;
            } else if (el.id) {
                data[el.id] = el.value;
            }
        });

        return data;
    }

    collectAndSaveFormData() {
        this.formData = { ...this.formData, ...this.collectFormData() };
    }

    updateStepIndicators() {
        document.querySelectorAll('.step-indicator').forEach((indicator, index) => {
            indicator.classList.remove('active', 'completed');
            if (index + 1 < this.currentStep) {
                indicator.classList.add('completed');
            } else if (index + 1 === this.currentStep) {
                indicator.classList.add('active');
            }
        });
    }

    onStepChange(data) {
        this.currentStep = data.step;
        this.updateStepIndicators();
        this.renderCurrentStep();
    }

    // ==================== Helper Methods ====================

    /**
     * Build job payload from form data
     */
    buildJobPayload() {
        const settings = this.formData;
        
        // Map UI duration values to backend length_preset values
        const durationMap = {
            'short': '30',
            'medium': '45',
            'long': '60',
            'extended': '90',
            'full': '120'
        };
        const lengthPreset = durationMap[settings.duration] || '45';
        
        return {
            theme: settings.category || 'general',
            vibe_preset: settings.style || 'slow_creepy',
            length_preset: lengthPreset,
            visual_preset: settings.visualPreset || 'forest',
            visual_source: settings.visualSource || 'ai',
            image_model: settings.imageModel || 'gpt-4o',
            art_style: settings.artStyle || 'cinematic-dark',
            scene_count: parseInt(settings.sceneCount) || 6,
            preview_only: false,
            // Effects
            effect_fade_in: settings['effect-fadeIn'] ?? true,
            effect_fade_out: settings['effect-fadeOut'] ?? true,
            effect_transitions: settings['effect-transitions'] ?? true,
            effect_kenburns: settings['effect-kenburns'] ?? true,
            effect_filter: settings['effect-filter'] ?? true,
            effect_vignette: settings['effect-vignette'] ?? true,
            // Caption
            caption_style: settings.captionStyle || 'bold',
        };
    }

    /**
     * Show loading state for a step
     */
    showStepLoading(container, message) {
        container.innerHTML = `
            <div class="step-loading">
                <div class="step-loading__spinner"></div>
                <p class="step-loading__message">${message}</p>
                
                <!-- Visual Debug Panel -->
                <div id="visual-debug-panel" class="visual-debug-panel">
                    <div class="visual-debug-panel__header">
                        <span>🔧 Debug Log</span>
                        <button type="button" class="btn btn--sm" onclick="document.getElementById('visual-debug-panel').classList.toggle('collapsed')">Toggle</button>
                    </div>
                    <div class="visual-debug-panel__content" id="visual-debug-content"></div>
                </div>
                
                <div class="step-loading__debug" id="step-debug-panel">
                    <!-- Debug info appears here -->
                </div>
            </div>
        `;
    }

    /**
     * Update loading message
     */
    updateStepLoadingMessage(container, message) {
        const msgEl = container.querySelector('.step-loading__message');
        if (msgEl) msgEl.textContent = message;
    }

    /**
     * Render images step with progress grid
     */
    renderImagesStepWithProgress(container) {
        // Use stored sceneCount from form data or sceneBuilder
        const sceneCount = this.formData.sceneCount || this.sceneBuilder.scenes.length || 6;
        const hasScenes = this.sceneBuilder.scenes.length > 0;
        
        this.debugLog('renderImagesStepWithProgress', `sceneCount: ${sceneCount}, hasScenes: ${hasScenes}`);
        
        container.innerHTML = `
            <div class="create-card">
                <h2 class="create-card__title">🎨 Generating Images</h2>
                <p class="create-card__subtitle">Watch your scenes come to life!</p>
                
                <div class="image-generation-status">
                    <div class="image-generation-status__progress">
                        <span id="images-generated-count">0</span> / <span id="images-total-count">${sceneCount}</span> images
                    </div>
                    <div class="image-generation-status__spinner"></div>
                </div>
                
                <!-- Visual Debug Panel -->
                <div id="visual-debug-panel" class="visual-debug-panel">
                    <div class="visual-debug-panel__header">
                        <span>🔧 Debug Log</span>
                        <button type="button" class="btn btn--sm" onclick="document.getElementById('visual-debug-panel').classList.toggle('collapsed')">Toggle</button>
                    </div>
                    <div class="visual-debug-panel__content" id="visual-debug-content"></div>
                </div>
                
                <div id="image-preview-grid" class="image-preview-grid image-preview-grid--generating">
                    ${hasScenes ? this.sceneBuilder.scenes.map((scene, i) => `
                        <div class="image-preview-card image-preview-card--loading" data-scene-id="${scene.id}" data-index="${i}">
                            <div class="image-preview-card__loader">
                                <div class="image-preview-card__loader-spinner"></div>
                                <span>Scene ${i + 1}</span>
                            </div>
                            <p class="image-preview-card__text">${(scene.text || '').substring(0, 60)}...</p>
                        </div>
                    `).join('') : Array.from({length: sceneCount}, (_, i) => `
                        <div class="image-preview-card image-preview-card--loading" data-scene-id="${i+1}" data-index="${i}">
                            <div class="image-preview-card__loader">
                                <div class="image-preview-card__loader-spinner"></div>
                                <span>Scene ${i + 1}</span>
                            </div>
                            <p class="image-preview-card__text">Generating...</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Update a single image card when image is ready
     */
    updateImageCard(index, image) {
        const card = document.querySelector(`.image-preview-card[data-index="${index}"]`);
        if (!card) return;
        
        card.classList.remove('image-preview-card--loading');
        card.classList.add('image-preview-card--loaded');
        
        const loader = card.querySelector('.image-preview-card__loader');
        if (loader && image.url) {
            loader.outerHTML = `<img src="${image.url}" class="image-preview-card__img" alt="Scene ${index + 1}">`;
        }
        
        // Update count
        const countEl = document.getElementById('images-generated-count');
        if (countEl) {
            countEl.textContent = parseInt(countEl.textContent) + 1;
        }
    }

    /**
     * Reset phase indicators to waiting state
     */
    resetPhaseIndicators() {
        document.querySelectorAll('.generation-phase').forEach(el => {
            el.classList.remove('active', 'completed', 'error');
            const badge = el.querySelector('.generation-phase__badge');
            if (badge) badge.textContent = 'Waiting';
        });
    }

    /**
     * Debug logging - always shows in visual panel
     */
    debugLog(context, message) {
        const timestamp = new Date().toISOString().substring(11, 23);
        const logEntry = `[${timestamp}] [${context}] ${message}`;
        
        console.log(`🔧 ${logEntry}`);
        this.apiLogs.push({ timestamp, context, message });
        
        // Add to debug panel if visible
        if (this.debugMode) {
            this.addLog(`🔧 [${context}] ${message}`, 'debug');
        }
        
        // Update step debug panel if present
        const stepDebug = document.getElementById('step-debug-panel');
        if (stepDebug) {
            const entry = document.createElement('div');
            entry.className = 'step-debug-entry';
            entry.textContent = logEntry;
            stepDebug.appendChild(entry);
            stepDebug.scrollTop = stepDebug.scrollHeight;
        }
        
        // Also update visual debug panel (always visible)
        this.addVisualDebug(`[${context}] ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);
    }

    // ==================== UI State Management ====================

    showLoading() {
        document.getElementById('loading-state')?.classList.remove('hidden');
        document.getElementById('no-brand-state')?.classList.add('hidden');
        document.getElementById('create-interface')?.classList.add('hidden');
    }

    showNoBrandState() {
        document.getElementById('loading-state')?.classList.add('hidden');
        document.getElementById('no-brand-state')?.classList.remove('hidden');
        document.getElementById('create-interface')?.classList.add('hidden');
    }

    showCreateInterface() {
        const loadingEl = document.getElementById('loading-state');
        const noBrandEl = document.getElementById('no-brand-state');
        const createEl = document.getElementById('create-interface');
        
        console.log('showCreateInterface - Elements found:', {
            loading: !!loadingEl,
            noBrand: !!noBrandEl,
            create: !!createEl
        });
        
        loadingEl?.classList.add('hidden');
        noBrandEl?.classList.add('hidden');
        createEl?.classList.remove('hidden');
        
        console.log('showCreateInterface - Classes after:', {
            loadingClasses: loadingEl?.className,
            noBrandClasses: noBrandEl?.className,
            createClasses: createEl?.className
        });
    }

    updateProgress(data) {
        document.getElementById('progress-bar').style.width = `${data.percent}%`;
        document.getElementById('progress-percent').textContent = `${Math.round(data.percent)}%`;
        document.getElementById('progress-label').textContent = data.label;
        
        // Update phase if provided
        if (data.phase) {
            this.updatePhase({ phase: data.phase, status: 'active' });
        }
    }

    /**
     * Update phase indicator status
     */
    updatePhase(data) {
        const { phase, status, message } = data;
        
        // Reset all phases first if starting a new phase
        if (status === 'active') {
            document.querySelectorAll('.generation-phase').forEach(el => {
                if (el.dataset.phase !== phase && !el.classList.contains('completed')) {
                    el.classList.remove('active');
                }
            });
        }
        
        const phaseEl = document.querySelector(`.generation-phase[data-phase="${phase}"]`);
        if (!phaseEl) return;
        
        // Remove previous status classes
        phaseEl.classList.remove('active', 'completed', 'error');
        
        // Apply new status
        if (status === 'active' || status === 'in-progress') {
            phaseEl.classList.add('active');
            const badge = phaseEl.querySelector('.generation-phase__badge');
            if (badge) badge.textContent = message || 'In Progress...';
        } else if (status === 'completed' || status === 'complete') {
            phaseEl.classList.add('completed');
            const badge = phaseEl.querySelector('.generation-phase__badge');
            if (badge) badge.textContent = '✓ Complete';
        } else if (status === 'error') {
            phaseEl.classList.add('error');
            const badge = phaseEl.querySelector('.generation-phase__badge');
            if (badge) badge.textContent = '✗ Failed';
        }
        
        // Update description if provided
        if (message && status === 'active') {
            const desc = phaseEl.querySelector('.generation-phase__desc');
            if (desc) desc.textContent = message;
        }
        
        // Add phase change to log
        if (status === 'active') {
            this.addPhaseLog(phase);
        }
    }

    /**
     * Add a phase separator to the log
     */
    addPhaseLog(phase) {
        const phaseNames = {
            story: '📖 STORY GENERATION',
            images: '🎨 IMAGE GENERATION',
            audio: '🔊 AUDIO GENERATION',
            video: '🎬 VIDEO ASSEMBLY'
        };
        
        const log = document.getElementById('generation-log');
        if (!log) return;
        
        const separator = document.createElement('div');
        separator.className = 'log-phase-separator';
        separator.textContent = phaseNames[phase] || phase.toUpperCase();
        log.appendChild(separator);
        log.scrollTop = log.scrollHeight;
    }

    updateImageGrid(images) {
        const container = document.getElementById('image-grid');
        if (!container) return;

        // Update image count in phase
        const imagesDesc = document.getElementById('images-desc');
        if (imagesDesc) {
            const completed = images.filter(img => img.url).length;
            imagesDesc.textContent = `Generated ${completed}/${images.length} images`;
        }

        container.innerHTML = images.map((img, i) => `
            <div class="image-grid__item ${img.url ? 'loaded' : 'loading'}">
                ${img.url 
                    ? `<img src="${img.url}" alt="Scene ${i + 1}">`
                    : `<div class="image-grid__placeholder">Scene ${i + 1}</div>`
                }
            </div>
        `).join('');
    }

    addLog(message, type = 'info') {
        const log = document.getElementById('generation-log');
        if (!log) return;

        const entry = document.createElement('p');
        entry.className = `log-entry log-entry--${type}`;
        
        const timestamp = new Date().toLocaleTimeString();
        const icon = {
            info: 'ℹ️',
            success: '✅',
            error: '❌',
            warning: '⚠️',
            debug: '🔧',
            verbose: '📝'
        }[type] || 'ℹ️';
        
        entry.innerHTML = `<span class="log-time">[${timestamp}]</span> ${icon} ${message}`;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
        
        // Also update the status text
        if (type !== 'debug' && type !== 'verbose') {
            document.getElementById('progress-status').textContent = message.substring(0, 30) + (message.length > 30 ? '...' : '');
        }
    }

    /**
     * Handle generation errors with better UI feedback
     */
    handleGenerationError(error) {
        console.error('Generation error:', error);
        
        // Update current phase to error state
        const phases = ['story', 'images', 'audio', 'video'];
        phases.forEach(phase => {
            const phaseEl = document.querySelector(`.generation-phase[data-phase="${phase}"]`);
            if (phaseEl?.classList.contains('active')) {
                this.updatePhase({ phase, status: 'error' });
            }
        });
        
        this.addLog(`Error: ${error.message}`, 'error');
        this.showError(error.message);
    }

    showResult(result) {
        document.getElementById('generation-progress').classList.add('hidden');
        document.getElementById('result-view').classList.remove('hidden');

        // Populate result
        document.getElementById('result-video').src = result.videoUrl;
        document.getElementById('btn-download').href = result.videoUrl;
        document.getElementById('result-title').textContent = result.title || this.formData.title;
        document.getElementById('result-duration').textContent = `${result.duration || 0}s`;
        document.getElementById('result-scenes').textContent = result.scenes?.length || this.sceneBuilder.scenes.length;
        document.getElementById('result-content').textContent = this.formData.content;

        // Add to post queue automatically
        this.addToPostQueue(result);

        // Scenes gallery
        const gallery = document.getElementById('result-scenes-gallery');
        if (gallery && result.images) {
            gallery.innerHTML = result.images.map((img, i) => `
                <img src="${img}" alt="Scene ${i + 1}" class="result-scene-thumb">
            `).join('');
        }

        // Cost breakdown
        const cost = this.template.calculateCost(this.formData);
        document.getElementById('result-cost-breakdown').innerHTML = `
            <div class="cost-item"><span>Story</span><span>~$${cost.story.toFixed(2)}</span></div>
            <div class="cost-item"><span>Voice</span><span>~$${cost.voice.toFixed(2)}</span></div>
            <div class="cost-item"><span>Images</span><span>~$${cost.images.toFixed(2)}</span></div>
            <div class="cost-item cost-item--total"><span>Total</span><span>~$${cost.total.toFixed(2)}</span></div>
        `;
    }

    /**
     * Add generated video to the post queue
     */
    async addToPostQueue(result) {
        try {
            // Initialize postQueueService if not already
            if (typeof postQueueService !== 'undefined') {
                await postQueueService.init();
                
                const brand = brandManager.getActiveBrand();
                if (!brand) {
                    console.warn('No active brand, skipping post queue');
                    return;
                }

                const post = await postQueueService.addPost({
                    brandId: brand.id,
                    videoUrl: result.videoUrl,
                    thumbnailUrl: result.images?.[0] || null,
                    duration: result.duration || 60,
                    title: result.title || this.formData.title || 'Untitled Video',
                    description: this.formData.content || '',
                    tags: this.formData.hashtags || [],
                    theme: this.formData.theme || 'default',
                    niche: brand.niche || 'general',
                    platforms: ['youtube'],
                    status: 'draft',
                    aiMetadata: {
                        generatedAt: new Date().toISOString(),
                        settings: this.formData
                    }
                });

                console.log('📮 Video added to post queue:', post.id);
                this.addLog('Video added to post queue as draft', 'success');
            }
        } catch (e) {
            console.error('Failed to add to post queue:', e);
            // Non-blocking - don't fail the UI if queue fails
        }
    }

    showError(message) {
        document.getElementById('error-message').textContent = message;
        document.getElementById('error-modal').classList.add('active');
    }

    closeErrorModal() {
        document.getElementById('error-modal').classList.remove('active');
    }

    toggleDebug() {
        document.getElementById('debug-panel')?.classList.toggle('hidden');
        document.getElementById('generation-log')?.classList.toggle('show-debug');
        document.getElementById('btn-toggle-debug')?.classList.toggle('active');
    }

    toggleVerbose() {
        document.getElementById('generation-log')?.classList.toggle('show-verbose');
        document.getElementById('btn-toggle-verbose')?.classList.toggle('active');
    }

    reset() {
        this.currentStep = 1;
        this.formData = {};
        this.sceneBuilder.scenes = [];
        
        if (this.generator) {
            this.generator.reset();
        }

        document.getElementById('result-view').classList.add('hidden');
        document.getElementById('generation-progress').classList.add('hidden');
        document.getElementById('generation-log').innerHTML = '<p class="log-entry log-entry--info">[--:--:--] Waiting to start...</p>';
        
        // Reset phase indicators
        document.querySelectorAll('.generation-phase').forEach(el => {
            el.classList.remove('active', 'completed', 'error');
            const badge = el.querySelector('.generation-phase__badge');
            if (badge) badge.textContent = 'Waiting';
            const desc = el.querySelector('.generation-phase__desc');
            if (desc) {
                const phase = el.dataset.phase;
                const defaultDescs = {
                    story: 'AI creates your script',
                    images: 'Creating visuals for each scene',
                    audio: 'Voice narration & music',
                    video: 'Combining everything together'
                };
                desc.textContent = defaultDescs[phase] || '';
            }
        });
        
        // Reset progress
        document.getElementById('progress-bar').style.width = '0%';
        document.getElementById('progress-percent').textContent = '0%';
        document.getElementById('progress-label').textContent = 'Starting...';
        document.getElementById('progress-status').textContent = 'Preparing...';
        
        this.showCreateInterface();
        this.renderStepIndicators();
        this.renderCurrentStep();
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.createController = new CreatePageController();
});
