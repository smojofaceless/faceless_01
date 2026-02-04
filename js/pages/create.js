/**
 * Create Page Controller
 * Handles the unified content creation interface
 */

class CreatePageController {
    constructor() {
        this.generator = null;
        this.sceneBuilder = null;
        this.template = null;
        this.currentStep = 1;
        this.formData = {};

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
        this.generator.on('imagesUpdate', (images) => this.updateImageGrid(images));
        this.generator.on('generationComplete', (result) => this.showResult(result));
        this.generator.on('error', (error) => this.showError(error.message));
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
                        <input type="range" id="sceneCount" min="3" max="12" value="${this.template.defaults.sceneCount}">
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
        
        container.innerHTML = `
            <div class="create-card">
                <h2 class="create-card__title">📖 Review & Edit Content</h2>
                
                <div class="form-group">
                    <label class="form-label">📝 Title</label>
                    <input type="text" id="content-title" class="form-control" value="${this.formData.title || ''}">
                </div>

                <div class="form-group">
                    <label class="form-label">📜 Content <span class="form-label__hint">(editable)</span></label>
                    <textarea id="content-text" class="form-control" rows="6">${this.formData.content || ''}</textarea>
                </div>

                <div class="form-group">
                    <label class="form-label">🎬 Scene Breakdown</label>
                    <div id="scene-breakdown" class="scene-breakdown">
                        ${this.sceneBuilder.scenes.length === 0 ? '<p class="text-muted">No scenes generated yet</p>' : ''}
                    </div>
                </div>
            </div>
        `;

        // Render scenes
        if (this.sceneBuilder && this.sceneBuilder.scenes && this.sceneBuilder.scenes.length > 0) {
            console.log('Rendering scene cards...');
            this.sceneBuilder.renderSceneCards('scene-breakdown', {
                editable: true,
                onEdit: (sceneId, field, value) => {
                    console.log('Scene edited:', sceneId, field, value);
                }
            });
        } else {
            console.log('No scenes to render');
        }
    }

    renderImagesStep(container) {
        container.innerHTML = `
            <div class="create-card">
                <h2 class="create-card__title">🎨 Image Generation</h2>
                <p>Your images will be generated in the next step.</p>
                <div id="image-preview-grid" class="image-preview-grid">
                    ${this.sceneBuilder.scenes.map((scene, i) => `
                        <div class="image-preview-card">
                            <div class="image-preview-card__placeholder">Scene ${i + 1}</div>
                            <p class="image-preview-card__text">${scene.text.substring(0, 50)}...</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    renderGenerateStep(container) {
        container.innerHTML = `
            <div class="create-card">
                <h2 class="create-card__title">🎬 Ready to Generate</h2>
                <div class="generate-summary">
                    <div class="generate-summary__item">
                        <span class="generate-summary__label">Template</span>
                        <span class="generate-summary__value">${this.template.name}</span>
                    </div>
                    <div class="generate-summary__item">
                        <span class="generate-summary__label">Scenes</span>
                        <span class="generate-summary__value">${this.sceneBuilder.scenes.length || this.formData.sceneCount || 6}</span>
                    </div>
                    <div class="generate-summary__item">
                        <span class="generate-summary__label">Visual Source</span>
                        <span class="generate-summary__value">${this.formData.visualSource === 'ai' ? 'AI Generated' : 'Stock (Pexels)'}</span>
                    </div>
                </div>
                <button id="btn-generate" class="btn btn--primary btn--lg btn--full">
                    ✨ Generate Video
                </button>
            </div>
        `;

        document.getElementById('btn-generate')?.addEventListener('click', () => this.startGeneration());
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
            // For step 1 -> 2, generate content first
            if (this.currentStep === 1) {
                await this.generateContent();
            }
            
            this.currentStep++;
            this.updateStepIndicators();
            this.renderCurrentStep();
        } else {
            // Last step - start generation
            await this.startGeneration();
        }
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

    // ==================== Generation ====================

    async generateContent() {
        try {
            this.addLog('Generating content...', 'info');
            
            // Build settings payload
            const settings = this.generator.buildSettingsPayload(this.formData);
            
            // Generate content via API
            const response = await this.generator.generateContent();
            
            console.log('generateContent response:', response);
            
            // Set scenes from normalized response
            if (response.scenes && response.scenes.length > 0) {
                this.sceneBuilder.setScenes(response.scenes);
            } else if (response.story) {
                this.sceneBuilder.parseStoryIntoScenes(response.story, settings.sceneCount || 6);
            }

            // Store in formData for rendering
            this.formData.title = response.title || '';
            this.formData.content = response.story || '';
            
            this.addLog('Content generated successfully!', 'success');
            
        } catch (error) {
            this.showError('Failed to generate content: ' + error.message);
            throw error;
        }
    }

    async startGeneration() {
        this.collectAndSaveFormData();
        
        // Hide create interface, show progress
        document.getElementById('create-interface').classList.add('hidden');
        document.getElementById('generation-progress').classList.remove('hidden');
        
        try {
            await this.generator.startGeneration();
        } catch (error) {
            this.showError('Generation failed: ' + error.message);
        }
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
    }

    updateImageGrid(images) {
        const container = document.getElementById('image-grid');
        if (!container) return;

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
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
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
        document.getElementById('generation-log').innerHTML = '<p>Waiting to start...</p>';
        
        this.showCreateInterface();
        this.renderStepIndicators();
        this.renderCurrentStep();
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.createController = new CreatePageController();
});
