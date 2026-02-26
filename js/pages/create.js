/**
 * Create Page Controller
 * Handles the unified content creation interface with phased generation
 * 
 * Flow (6 steps):
 * Step 0: Preset - Choose genre/vibe preset (auto-fills settings)
 * Step 1: Settings - Define intent & constraints (DNA handles execution)
 * Step 2: Story - Review narrative, approve to lock visual world
 * Step 3: Visual DNA - Style derived, optional safe rotations
 * Step 4: Images - Approve frames, regenerate individual scenes
 * Step 5: Assemble - Platform-tuned render + final preview
 * 
 * INDEX CONVENTION (IMPORTANT):
 * - API/Backend: Always returns 0-based scene.index (0, 1, 2, ...)
 * - SceneBuilder: Uses 1-based sceneId (1, 2, 3, ...)
 * - Conversion: sceneId = sceneIndex + 1
 * - Array access: this.sceneBuilder.scenes[sceneIndex]
 * - SceneBuilder methods: this.sceneBuilder.updateScene(sceneId, data)
 */

// Step-to-phase mapping for progress UI
const STEP_TO_PHASE = {
    preset: [],
    settings: ['story', 'audio'],
    story: [],
    'visual-dna': ['dna'],
    images: ['images'],
    assemble: ['video']
};

// =====================================================
// PACING SYSTEM CONSTANTS
// =====================================================

// Pacing presets (seconds per scene)
const PACE_PRESETS = {
    slow: { secPerScene: 3.2, label: 'Slow', description: 'Creepy, atmospheric' },
    balanced: { secPerScene: 2.5, label: 'Balanced', description: 'Modern horror reels' },
    fast: { secPerScene: 2.0, label: 'Fast', description: 'Punchy, quick cuts' }
};

// Platform-specific scene clamps
const PLATFORM_SCENE_CLAMPS = {
    reels: { 60: { min: 12, max: 24 }, 90: { min: 18, max: 36 } },
    tiktok: { 60: { min: 12, max: 24 }, 120: { min: 18, max: 48 } },
    shorts: { 60: { min: 12, max: 24 } }
};

// Narration and readability constants
const PACING_CONSTANTS = {
    wps: 2.3,              // Words per second (TTS safe avg)
    minSceneSec: 1.6,      // Minimum scene duration
    maxSceneSec: 4.0,      // Maximum scene duration  
    maxCharsPerLine: 32,   // Caption line length (vertical safe)
    maxCaptionLines: 2,    // Max caption lines
    maxCaptionChars: 70,   // Total caption chars (safe)
    wpsWarning: 2.8,       // WPS threshold for warning
    wpsCritical: 3.1       // WPS threshold for critical
};

class CreatePageController {
    constructor() {
        this.generator = null;
        this.sceneBuilder = null;
        this.template = null;
        this.currentStep = 0; // Now starts at 0 (Preset)
        this.formData = {};
        
        // Job state
        this.jobId = null;
        this.jobStatus = null;
        
        // NEW: Advanced mode state
        this.advancedMode = false;
        
        // NEW: Selected preset
        this.selectedPreset = null;
        
        // NEW: Platform selection
        this.targetPlatform = 'reels';
        
        // NEW: Visual DNA state (for soft overrides)
        this.visualDNA = null;
        this.dnaLocked = false;
        
        // NEW: Lockpoint states
        this.storyLocked = false;
        this.imagesLocked = false;
        
        // NEW: Transition debounce (prevents double-click issues)
        this._stepTransitionInProgress = false;
        
        // NEW: System confidence tracking
        this.systemConfidence = 'high'; // high, medium, low
        
        // NEW: Console timing
        this.startTime = null;
        
        // NEW: Preset source tracking (DB-driven vs hardcoded fallback)
        // See docs/PRESET_SOURCE_OF_TRUTH.md for rationale
        this.presetSource = 'unknown'; // 'database' | 'fallback' | 'unknown'
        this.dbPresets = null; // Presets loaded from brand_templates
        
        // Debug state - check URL param or localStorage
        this.debugMode = this._checkDebugMode();
        this.verboseMode = false;
        this.apiLogs = [];

        this.init();
    }
    
    /**
     * Check if debug mode is enabled via URL param or localStorage
     */
    _checkDebugMode() {
        // Check URL param first
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('debug') === 'true') {
            console.log('[DEBUG] Debug mode enabled via URL param');
            return true;
        }
        
        // Check localStorage
        try {
            if (localStorage.getItem('DEBUG_STORY') === 'true') {
                console.log('[DEBUG] Debug mode enabled via localStorage');
                return true;
            }
        } catch (e) {
            // localStorage may not be available
        }
        
        return false;
    }
    
    /**
     * Toggle debug mode (can be called from console)
     */
    toggleStoryDebug(enable) {
        if (enable === undefined) {
            enable = !this.debugMode;
        }
        
        this.debugMode = enable;
        
        try {
            if (enable) {
                localStorage.setItem('DEBUG_STORY', 'true');
                console.log('[DEBUG] Story debug mode ENABLED. Reload to see debug panel.');
            } else {
                localStorage.removeItem('DEBUG_STORY');
                console.log('[DEBUG] Story debug mode DISABLED.');
            }
        } catch (e) {
            console.warn('[DEBUG] Could not persist debug state to localStorage');
        }
        
        return this.debugMode;
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
        
        // NEW: Advanced mode toggle
        document.getElementById('advanced-mode-checkbox')?.addEventListener('change', (e) => {
            this.advancedMode = e.target.checked;
            document.body.classList.toggle('advanced-mode', this.advancedMode);
            this.renderCurrentStep(); // Re-render to show/hide advanced controls
        });
        
        // NEW: Platform selector
        document.getElementById('platform-select')?.addEventListener('change', (e) => {
            this.targetPlatform = e.target.value;
            this.formData.platform = this.targetPlatform;
        });
        
        // NEW: Console toggle
        document.getElementById('toggle-console')?.addEventListener('click', () => this.toggleConsole());
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
        
        // Reset state for new brand (0-indexed for 6-step flow)
        this.currentStep = 0;
        this.formData = {};
        this.selectedPreset = null;
        this.visualDNA = null;
        this.dnaLocked = false;
        
        // Reset preset source tracking (will be set by loadPresetsFromDB)
        this.presetSource = 'unknown';
        this.dbPresets = null;
        
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
            
            // =====================================================
            // DB-DRIVEN PRESETS (Option 1 Implementation)
            // Load presets from brand_templates, fallback to hardcoded
            // See docs/PRESET_SOURCE_OF_TRUTH.md for rationale
            // =====================================================
            await this.loadPresetsFromDB(brand);
            
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

    /**
     * Load presets from brand_templates (DB source of truth)
     * Falls back to hardcoded template.presets if DB returns no rows
     * 
     * INVARIANT: The presets shown in UI must come from brand_templates when available.
     * This ensures manual generation and campaign generation use the same preset logic.
     * 
     * See docs/PRESET_SOURCE_OF_TRUTH.md for architecture rationale.
     * 
     * @param {Brand} brand - The active brand
     */
    async loadPresetsFromDB(brand) {
        // Reset preset source state
        this.presetSource = 'unknown';
        this.dbPresets = null;
        
        // Check if Supabase is available
        if (typeof supabaseClient === 'undefined' || !supabaseClient) {
            console.warn('[PRESETS] Supabase not available, using hardcoded fallback');
            this.presetSource = 'fallback';
            return;
        }
        
        try {
            console.log(`[PRESETS] Loading presets from brand_templates for brand: ${brand.id}`);
            
            const { data: templates, error } = await supabaseClient
                .from('brand_templates')
                .select('*')
                .eq('brand_id', brand.id)
                .order('is_default', { ascending: false })  // Default first
                .order('name', { ascending: true });        // Then alphabetical
            
            if (error) {
                console.error('[PRESETS] DB query failed:', error);
                this.presetSource = 'fallback';
                return;
            }
            
            if (!templates || templates.length === 0) {
                // No templates in DB for this brand - use fallback
                console.warn(`[PRESETS] No templates found in brand_templates for brand "${brand.name}". Using hardcoded fallback.`);
                this.presetSource = 'fallback';
                return;
            }
            
            // Transform DB rows to preset format expected by UI
            console.log(`[PRESETS] Found ${templates.length} templates in DB:`, templates.map(t => t.template_type));
            
            // Get hardcoded presets for metadata (icons, descriptions, defaults)
            const hardcodedPresets = this.template.presets || [];
            
            // Map DB templates to UI presets
            this.dbPresets = templates.map(dbTemplate => {
                // Find matching hardcoded preset for metadata
                const hardcoded = hardcodedPresets.find(p => p.id === dbTemplate.template_type);
                
                return {
                    id: dbTemplate.template_type,
                    name: dbTemplate.name,
                    icon: hardcoded?.icon || '🎯',
                    tagline: hardcoded?.tagline || dbTemplate.name,
                    description: hardcoded?.description || `${dbTemplate.name} preset`,
                    weight: (parseFloat(dbTemplate.weight) || 0) <= 1 ? Math.round(parseFloat(dbTemplate.weight) * 100) || 50 : Math.round(parseFloat(dbTemplate.weight)) || 50,
                    is_default: dbTemplate.is_default,
                    // Merge config_overrides with hardcoded defaults
                    defaults: {
                        ...hardcoded?.defaults,
                        ...(dbTemplate.config_overrides || {}),
                        vibe_preset: dbTemplate.template_type
                    },
                    requiresAdvanced: hardcoded?.requiresAdvanced || false,
                    // Mark source for UI
                    _source: 'database',
                    _dbId: dbTemplate.id
                };
            });
            
            // Always include Custom DNA option if advanced mode exists in hardcoded
            const customPreset = hardcodedPresets.find(p => p.id === 'custom');
            if (customPreset) {
                this.dbPresets.push({
                    ...customPreset,
                    _source: 'system'
                });
            }
            
            // Replace template.presets with DB-driven presets
            this.template.presets = this.dbPresets;
            this.presetSource = 'database';
            
            console.log(`[PRESETS] ✅ Loaded ${this.dbPresets.length} presets from database`);
            
        } catch (err) {
            console.error('[PRESETS] Unexpected error loading from DB:', err);
            this.presetSource = 'fallback';
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
            <div class="step-indicator ${index === this.currentStep ? 'active' : ''} ${index < this.currentStep ? 'completed' : ''}" data-step="${index}">
                <div class="step-indicator__number">${index}</div>
                <span class="step-indicator__label">${step.name}</span>
            </div>
            ${index < this.template.steps.length - 1 ? '<div class="step-indicator__line"></div>' : ''}
        `).join('');
    }

    updateStepHeader() {
        const stepConfig = this.template?.steps?.[this.currentStep];
        if (!stepConfig) return;
        
        const titleEl = document.getElementById('step-title');
        const subtitleEl = document.getElementById('step-subtitle');
        
        if (titleEl) titleEl.textContent = `${stepConfig.icon} ${stepConfig.name}`;
        if (subtitleEl) subtitleEl.textContent = stepConfig.subtitle || '';
    }

    renderCurrentStep() {
        const container = document.getElementById('step-content');
        if (!container || !this.template?.steps) return;

        const stepConfig = this.template.steps[this.currentStep];
        
        // Defensive check: if step is out of bounds, reset to valid step
        if (!stepConfig) {
            console.error(`[renderCurrentStep] Invalid step ${this.currentStep}, steps.length=${this.template.steps.length}. Resetting to step 0.`);
            this.currentStep = 0;
            const fallbackConfig = this.template.steps[0];
            if (!fallbackConfig) {
                console.error('[renderCurrentStep] No steps defined in template!');
                return;
            }
            this.renderStepIndicators();
        }
        
        const safeStepConfig = this.template.steps[this.currentStep];
        
        // Update step header
        this.updateStepHeader();
        
        // Render based on step type (new 6-step flow)
        switch (safeStepConfig.id) {
            case 'preset':
                this.renderPresetStep(container);
                break;
            case 'settings':
                this.renderSettingsStep(container);
                break;
            case 'story':
            case 'facts':
            case 'content':
                this.renderStoryStep(container);
                break;
            case 'visual-dna':
                this.renderVisualDNAStep(container);
                break;
            case 'images':
                this.renderImagesStep(container);
                break;
            case 'assemble':
            case 'generate':
            case 'video':
                this.renderAssembleStep(container);
                break;
            default:
                this.renderPresetStep(container);
        }
        
        // Render job summary strip for steps 2-5
        if (this.currentStep >= 2) {
            this.renderJobSummaryStrip();
        }
        
        // Render Inspector Panel for all steps
        this.renderInspectorPanel();

        // Update navigation buttons
        this.updateNavigationButtons();
    }
    
    /**
     * Render the right-side Inspector Panel (always visible)
     */
    renderInspectorPanel() {
        // Remove existing panel
        document.getElementById('inspector-panel')?.remove();
        
        const genDetails = this.formData.generationDetails || {};
        const visualDNA = genDetails.visual_dna || this.visualDNA || {};
        const similarity = genDetails.similarity || null;
        const isUnique = similarity ? similarity.is_likely_unique !== false : true;
        const hasSimData = similarity && typeof similarity.score === 'number';
        
        // Current step info
        const stepConfig = this.template?.steps?.[this.currentStep];
        const stepName = stepConfig?.name || stepConfig?.title || 'Unknown';
        const totalSteps = this.template?.steps?.length || 1;
        
        // Calculate costs
        const imageCost = this.calculateImageCost();
        const audioCost = 0.02;
        const renderCost = 0.02;
        const totalCost = imageCost + audioCost + renderCost;
        
        // Warnings
        const warnings = [];
        if (!isUnique) warnings.push('Similarity detected - consider rotating palette');
        if (genDetails.forced_variety) warnings.push('Variety was forced for uniqueness');
        if (this.sceneBuilder.scenes.some(s => !s.approved && s.imageUrl)) warnings.push('Some images not yet approved');
        
        const panel = document.createElement('div');
        panel.id = 'inspector-panel';
        panel.className = 'inspector-panel';
        panel.innerHTML = `
            <div class="inspector-panel__header">
                <span class="inspector-panel__title">🔍 Inspector</span>
                <button type="button" class="inspector-panel__toggle" id="toggle-inspector">−</button>
            </div>
            
            <div class="inspector-panel__content" id="inspector-content">
                <!-- Current Step -->
                <div class="inspector-section">
                    <span class="inspector-section__title">📍 Current Step</span>
                    <div class="inspector-section__value">${stepName}</div>
                    <div class="inspector-progress">
                        <div class="inspector-progress__bar" style="width: ${((this.currentStep + 1) / totalSteps) * 100}%"></div>
                    </div>
                    <div class="inspector-section__hint">Step ${this.currentStep + 1} of ${totalSteps}</div>
                </div>
                
                <!-- Lockpoints -->
                <div class="inspector-section">
                    <span class="inspector-section__title">🔐 Lockpoints</span>
                    <div class="inspector-lockpoints">
                        <span class="inspector-lockpoint ${this.storyLocked ? 'inspector-lockpoint--active' : ''}">${this.storyLocked ? '🔒' : '🔓'} Story</span>
                        <span class="inspector-lockpoint ${this.dnaLocked ? 'inspector-lockpoint--active' : ''}">${this.dnaLocked ? '🔒' : '🔓'} DNA</span>
                        <span class="inspector-lockpoint ${this.imagesLocked ? 'inspector-lockpoint--active' : ''}">${this.imagesLocked ? '🔒' : '🔓'} Images</span>
                    </div>
                </div>
                
                <!-- Uniqueness HUD -->
                <div class="inspector-section">
                    <span class="inspector-section__title">🧬 Uniqueness</span>
                    <div class="inspector-hud-grid">
                        <div class="inspector-hud-item">
                            <span class="inspector-hud-item__label">Score</span>
                            <span class="inspector-hud-item__value ${!hasSimData ? 'inspector-hud-item__value--muted' : (isUnique ? '' : 'inspector-hud-item__value--warning')}">${hasSimData ? (similarity.score * 100).toFixed(0) + '%' : 'Not checked'}</span>
                        </div>
                        <div class="inspector-hud-item">
                            <span class="inspector-hud-item__label">Status</span>
                            <span class="inspector-hud-item__value ${!hasSimData ? 'inspector-hud-item__value--muted' : (isUnique ? 'inspector-hud-item__value--good' : 'inspector-hud-item__value--warning')}">${hasSimData ? (isUnique ? 'Unique' : 'Too Close') : '—'}</span>
                        </div>
                    </div>
                </div>
                
                <!-- Job Summary -->
                <div class="inspector-section">
                    <span class="inspector-section__title">📋 Job Summary</span>
                    <div class="inspector-summary">
                        <div class="inspector-summary__row">
                            <span>Brand</span>
                            <span>${this.template?.name || '—'}</span>
                        </div>
                        <div class="inspector-summary__row">
                            <span>Preset</span>
                            <span>${this.selectedPreset?.name || '—'}</span>
                        </div>
                        <div class="inspector-summary__row">
                            <span>Platform</span>
                            <span>${this.targetPlatform}</span>
                        </div>
                        <div class="inspector-summary__row">
                            <span>Scenes</span>
                            <span>${this.sceneBuilder.scenes.length || '—'}</span>
                        </div>
                    </div>
                </div>
                
                <!-- Estimated Cost -->
                <div class="inspector-section">
                    <span class="inspector-section__title">💰 Est. Cost</span>
                    <div class="inspector-cost">
                        <span class="inspector-cost__value">~$${totalCost.toFixed(2)}</span>
                        <span class="inspector-cost__breakdown">Images: $${imageCost.toFixed(2)} + Audio: $${audioCost.toFixed(2)}</span>
                    </div>
                </div>
                
                <!-- Warnings -->
                ${warnings.length > 0 ? `
                <div class="inspector-section inspector-section--warnings">
                    <span class="inspector-section__title">⚠️ Warnings</span>
                    <ul class="inspector-warnings">
                        ${warnings.map(w => `<li>${w}</li>`).join('')}
                    </ul>
                </div>
                ` : ''}
            </div>
        `;
        
        // Add to create interface
        const createInterface = document.getElementById('create-interface');
        if (createInterface) {
            createInterface.appendChild(panel);
        }
        
        // Setup toggle
        document.getElementById('toggle-inspector')?.addEventListener('click', () => {
            const content = document.getElementById('inspector-content');
            const btn = document.getElementById('toggle-inspector');
            if (content && btn) {
                content.classList.toggle('hidden');
                btn.textContent = content.classList.contains('hidden') ? '+' : '−';
            }
        });
    }
    
    /**
     * Render a pinned job summary strip showing key state + Uniqueness HUD + Lockpoints
     */
    renderJobSummaryStrip() {
        // Remove existing strip if present
        document.getElementById('job-summary-strip')?.remove();
        
        const genDetails = this.formData.generationDetails || {};
        const visualDNA = genDetails.visual_dna || this.visualDNA || {};
        const similarity = genDetails.similarity || null;
        const isUnique = similarity ? similarity.is_likely_unique !== false : true;
        const hasSimData = similarity && typeof similarity.score === 'number';
        
        // Calculate estimated cost
        const imageCost = this.calculateImageCost();
        const audioCost = 0.02;
        const renderCost = 0.02;
        const totalCost = imageCost + audioCost + renderCost;
        
        // Determine culprit dimension (what's causing similarity)
        let culpritDimension = 'Not checked';
        if (similarity && similarity.breakdown) {
            const dims = Object.entries(similarity.breakdown);
            const highest = dims.sort((a, b) => b[1] - a[1])[0];
            if (highest && highest[1] > 0.5) {
                culpritDimension = highest[0].replace('_', ' ');
            } else {
                culpritDimension = '—';
            }
        }
        
        // Sequence health (based on recent video count and variety)
        const recentCount = genDetails.recent_videos_checked || 0;
        let sequenceHealth = 'Healthy';
        let healthClass = 'healthy';
        if (genDetails.forced_variety) {
            sequenceHealth = 'Warning';
            healthClass = 'warning';
        } else if (recentCount > 10 && hasSimData && similarity.score > 0.6) {
            sequenceHealth = 'Critical';
            healthClass = 'critical';
        }
        
        const strip = document.createElement('div');
        strip.id = 'job-summary-strip';
        strip.className = 'job-summary-strip';
        strip.innerHTML = `
            <!-- Primary Info Row -->
            <div class="job-summary-strip__row job-summary-strip__row--primary">
                <div class="job-summary-strip__item">
                    <span class="job-summary-strip__label">Brand</span>
                    <span class="job-summary-strip__value">${this.template?.name || 'Unknown'}</span>
                </div>
                <div class="job-summary-strip__item">
                    <span class="job-summary-strip__label">Preset</span>
                    <span class="job-summary-strip__value">${this.selectedPreset?.icon || ''} ${this.selectedPreset?.name || 'None'}</span>
                </div>
                <div class="job-summary-strip__item">
                    <span class="job-summary-strip__label">Platform</span>
                    <span class="job-summary-strip__value">${this.targetPlatform === 'reels' ? '📱' : this.targetPlatform === 'tiktok' ? '🎵' : '▶️'} ${this.targetPlatform}</span>
                </div>
                <div class="job-summary-strip__item">
                    <span class="job-summary-strip__label">Duration</span>
                    <span class="job-summary-strip__value">${this.formData.duration || '45'}s</span>
                </div>
                <div class="job-summary-strip__item">
                    <span class="job-summary-strip__label">Est. Cost</span>
                    <span class="job-summary-strip__value">~$${totalCost.toFixed(2)}</span>
                </div>
            </div>
            
            <!-- Lockpoints Row -->
            <div class="job-summary-strip__row job-summary-strip__row--lockpoints">
                <div class="lockpoint ${this.storyLocked ? 'lockpoint--locked' : 'lockpoint--unlocked'}">
                    <span class="lockpoint__icon">${this.storyLocked ? '🔒' : '🔓'}</span>
                    <span class="lockpoint__label">Story</span>
                </div>
                <div class="lockpoint ${this.dnaLocked ? 'lockpoint--locked' : 'lockpoint--unlocked'}">
                    <span class="lockpoint__icon">${this.dnaLocked ? '🔒' : '🔓'}</span>
                    <span class="lockpoint__label">Visual DNA</span>
                </div>
                <div class="lockpoint ${this.imagesLocked ? 'lockpoint--locked' : 'lockpoint--unlocked'}">
                    <span class="lockpoint__icon">${this.imagesLocked ? '🔒' : '🔓'}</span>
                    <span class="lockpoint__label">Images</span>
                </div>
            </div>
            
            <!-- Uniqueness HUD Row -->
            <div class="job-summary-strip__row job-summary-strip__row--uniqueness">
                <div class="uniqueness-hud__item">
                    <span class="uniqueness-hud__label">Similarity</span>
                    <span class="uniqueness-hud__value ${!hasSimData ? 'uniqueness-hud__value--muted' : (isUnique ? 'uniqueness-hud__value--good' : 'uniqueness-hud__value--warning')}">${hasSimData ? (similarity.score * 100).toFixed(0) + '%' : 'Not checked'}</span>
                </div>
                <div class="uniqueness-hud__item">
                    <span class="uniqueness-hud__label">Culprit</span>
                    <span class="uniqueness-hud__value ${!hasSimData ? 'uniqueness-hud__value--muted' : ''}">${culpritDimension}</span>
                </div>
                <div class="uniqueness-hud__item">
                    <span class="uniqueness-hud__label">Contamination</span>
                    <span class="uniqueness-hud__value ${!hasSimData ? 'uniqueness-hud__value--muted' : (isUnique ? 'uniqueness-hud__value--pass' : 'uniqueness-hud__value--fail')}">${hasSimData ? (isUnique ? 'PASS' : 'FAIL') : '—'}</span>
                </div>
                <div class="uniqueness-hud__item">
                    <span class="uniqueness-hud__label">Sequence</span>
                    <span class="uniqueness-hud__value uniqueness-hud__value--${healthClass}">${sequenceHealth}</span>
                </div>
            </div>
        `;
        
        // Insert after step header
        const stepHeader = document.getElementById('step-header');
        if (stepHeader) {
            stepHeader.after(strip);
        }
    }

    // ==================== STEP 0: PRESET ====================
    
    renderPresetStep(container) {
        const presets = this.template.presets || [];
        const isFallback = this.presetSource === 'fallback';
        const isDatabase = this.presetSource === 'database';
        
        container.innerHTML = `
            <div class="create-card create-card--preset">
                ${isFallback ? `
                <div class="preset-fallback-warning">
                    <span class="preset-fallback-warning__icon">⚠️</span>
                    <span class="preset-fallback-warning__text">
                        This brand has no templates configured. Using system defaults.
                        <a href="/pages/brands.html" class="preset-fallback-warning__link">Configure templates →</a>
                    </span>
                </div>
                ` : ''}
                
                ${isDatabase ? `
                <div class="preset-source-info">
                    <span class="preset-source-info__badge preset-source-info__badge--db">🏷️ Brand Presets</span>
                </div>
                ` : ''}
                
                <div class="preset-grid">
                    ${presets.map(preset => {
                        const sourceClass = preset._source === 'database' ? 'preset-card--brand' : 'preset-card--system';
                        const sourceBadge = preset._source === 'database' 
                            ? `<span class="preset-card__source" title="Configured for this brand">Brand</span>`
                            : preset._source === 'system' || isFallback
                                ? `<span class="preset-card__source preset-card__source--system" title="System default">System</span>`
                                : '';
                        // Normalize weight to percentage of total
                        const totalWeight = presets.filter(p => p._source === 'database').reduce((s, p) => s + (p.weight || 0), 0) || 100;
                        const weightPct = preset.weight && preset._source === 'database'
                            ? Math.round((preset.weight / totalWeight) * 100)
                            : 0;
                        const weightBadge = weightPct > 0
                            ? `<span class="preset-card__weight" title="Campaign selection weight">${weightPct}%</span>`
                            : '';
                        
                        return `
                        <button type="button" 
                            class="preset-card ${sourceClass} ${this.selectedPreset?.id === preset.id ? 'preset-card--selected' : ''} ${preset.requiresAdvanced && !this.advancedMode ? 'preset-card--locked' : ''}"
                            data-preset="${preset.id}"
                            ${preset.requiresAdvanced && !this.advancedMode ? 'disabled' : ''}>
                            <div class="preset-card__icon">${preset.icon}</div>
                            <div class="preset-card__content">
                                <h3 class="preset-card__name">${preset.name}</h3>
                                <span class="preset-card__tagline">${preset.tagline}</span>
                            </div>
                            <div class="preset-card__badges">
                                ${sourceBadge}
                                ${weightBadge}
                                ${preset.is_default ? '<span class="preset-card__default" title="Default preset">★</span>' : ''}
                            </div>
                            ${preset.requiresAdvanced ? '<span class="preset-card__lock" title="Enable Advanced Mode to unlock">🔒</span>' : ''}
                            ${this.selectedPreset?.id === preset.id ? '<span class="preset-card__check">✓</span>' : ''}
                        </button>
                    `}).join('')}
                </div>
                
                ${this.selectedPreset ? `
                <div class="preset-preview">
                    <h4 class="preset-preview__title">${this.selectedPreset.icon} ${this.selectedPreset.name}</h4>
                    <p class="preset-preview__description">${this.selectedPreset.description}</p>
                    ${this.selectedPreset.defaults ? `
                    <div class="preset-preview__defaults">
                        <span class="preset-preview__badge">Era: ${this.selectedPreset.defaults.era || 'Any'}</span>
                        <span class="preset-preview__badge">Tone: ${this.getToneLabel(this.selectedPreset.defaults.tone)}</span>
                        <span class="preset-preview__badge">Ending: ${this.selectedPreset.defaults.ending || 'Any'}</span>
                    </div>
                    ` : ''}
                </div>
                ` : `
                <div class="preset-preview preset-preview--empty">
                    <p>Select a preset to see details and auto-fill settings</p>
                </div>
                `}
            </div>
        `;
        
        // Setup preset selection listeners
        container.querySelectorAll('.preset-card:not([disabled])').forEach(card => {
            card.addEventListener('click', () => {
                const presetId = card.dataset.preset;
                this.selectPreset(presetId);
            });
        });
    }
    
    selectPreset(presetId) {
        const preset = this.template.presets?.find(p => p.id === presetId);
        if (!preset) return;
        
        this.selectedPreset = preset;
        
        // Auto-fill form data with preset defaults
        if (preset.defaults) {
            this.formData = { ...this.formData, ...preset.defaults, preset: presetId };
        }
        
        // Re-render to show selection
        this.renderCurrentStep();
        
        this.addConsoleLog(`Preset selected: ${preset.name}`, 'info');
    }
    
    getToneLabel(tone) {
        if (tone === undefined) return 'Balanced';
        if (tone < 0.3) return 'Calm';
        if (tone < 0.5) return 'Moderate';
        if (tone < 0.7) return 'Tense';
        return 'Intense';
    }

    /**
     * Calculate pacing info based on pace preset and duration
     * Returns scene count, avg duration, readability risk, and render load
     */
    calculatePaceInfo(pace = 'balanced', durationSec = 60) {
        const pacePreset = PACE_PRESETS[pace] || PACE_PRESETS.balanced;
        const platform = this.targetPlatform || 'reels';
        
        // Get platform clamps for this duration
        const platformClamps = PLATFORM_SCENE_CLAMPS[platform] || PLATFORM_SCENE_CLAMPS.reels;
        const durationClamp = platformClamps[durationSec] || platformClamps[60] || { min: 12, max: 30 };
        
        // Calculate raw scene count from pace
        const rawSceneCount = Math.round(durationSec / pacePreset.secPerScene);
        
        // Clamp to platform limits
        const sceneCount = Math.max(durationClamp.min, Math.min(durationClamp.max, rawSceneCount));
        
        // Calculate actual avg duration
        const avgDuration = (durationSec / sceneCount).toFixed(1);
        
        // Calculate WPS risk (words per second based on typical scene text)
        const avgWordsPerScene = 12; // typical horror narration
        const estimatedWps = avgWordsPerScene / parseFloat(avgDuration);
        
        let readabilityRisk = 'ok';
        let readabilityLabel = '✅ Good';
        let warning = null;
        
        if (estimatedWps >= PACING_CONSTANTS.wpsCritical) {
            readabilityRisk = 'critical';
            readabilityLabel = '🔴 Fast';
            warning = 'Captions may be hard to read at this pace. Consider fewer scenes or shorter narration.';
        } else if (estimatedWps >= PACING_CONSTANTS.wpsWarning) {
            readabilityRisk = 'warning';
            readabilityLabel = '🟡 Tight';
            warning = 'Pacing is on the edge. Watch for long sentences.';
        }
        
        // Calculate render load (more scenes = more images = more cost/time)
        let renderLoad = 'Normal';
        if (sceneCount > 25) {
            renderLoad = '⚡ Heavy';
        } else if (sceneCount > 20) {
            renderLoad = '📊 Moderate';
        } else {
            renderLoad = '🍃 Light';
        }
        
        return {
            sceneCount,
            avgDuration,
            readabilityRisk,
            readabilityLabel,
            renderLoad,
            warning,
            clamp: durationClamp,
            estimatedWps: estimatedWps.toFixed(2)
        };
    }

    /**
     * Split story text into scenes using greedy packing algorithm
     * @param {string} text - The story text to split
     * @param {object} options - Pacing options
     * @returns {array} Array of scene objects with text, wordCount, estimatedDuration, readabilityInfo
     */
    splitIntoScenes(text, options = {}) {
        const {
            durationSec = 60,
            targetScenes = null,
            pace = 'balanced',
            wps = PACING_CONSTANTS.wps,
            minSceneSec = PACING_CONSTANTS.minSceneSec,
            maxSceneSec = PACING_CONSTANTS.maxSceneSec
        } = options;

        // Calculate target scene count if not provided
        const pacePreset = PACE_PRESETS[pace] || PACE_PRESETS.balanced;
        const numScenes = targetScenes || Math.round(durationSec / pacePreset.secPerScene);
        
        // Log entry
        console.log(`[splitIntoScenes] Input: ${text.split(/\s+/).filter(w=>w).length} words, targetScenes=${numScenes}, pace=${pace}`);
        
        // Split text into sentences (story beats)
        const sentences = this.splitIntoSentences(text);
        if (sentences.length === 0) return [];
        
        console.log(`[splitIntoScenes] Split into ${sentences.length} sentences`);
        
        // Calculate words per sentence
        const sentenceData = sentences.map(s => ({
            text: s,
            words: s.split(/\s+/).filter(w => w.length > 0).length
        }));
        
        const totalWords = sentenceData.reduce((sum, s) => sum + s.words, 0);
        const idealWordsPerScene = Math.ceil(totalWords / numScenes);
        
        console.log(`[splitIntoScenes] Total words: ${totalWords}, idealWordsPerScene: ${idealWordsPerScene}`);
        
        // Greedy packing: pack sentences into scenes
        const scenes = [];
        let currentScene = { texts: [], words: 0 };
        
        for (const sentence of sentenceData) {
            // Check if adding this sentence would exceed ideal words
            const wouldExceed = currentScene.words + sentence.words > idealWordsPerScene * 1.3;
            const isSceneFull = currentScene.words >= idealWordsPerScene;
            const scenesRemaining = numScenes - scenes.length;
            const sentencesRemaining = sentenceData.length - sentenceData.indexOf(sentence);
            
            // Start new scene if:
            // 1. Current scene is full AND we have enough scenes remaining for remaining sentences
            // 2. Adding would exceed threshold significantly
            const shouldStartNew = (isSceneFull && scenesRemaining > 1 && sentencesRemaining > 1) ||
                                   (wouldExceed && currentScene.words > 0 && scenesRemaining > 1);
            
            if (shouldStartNew) {
                scenes.push(this.finalizeScene(currentScene, durationSec, numScenes, wps));
                currentScene = { texts: [], words: 0 };
            }
            
            currentScene.texts.push(sentence.text);
            currentScene.words += sentence.words;
        }
        
        // Push final scene
        if (currentScene.texts.length > 0) {
            scenes.push(this.finalizeScene(currentScene, durationSec, numScenes, wps));
        }
        
        console.log(`[splitIntoScenes] Greedy packing produced ${scenes.length} scenes (target: ${numScenes})`);
        
        // Post-process: merge short scenes, split long scenes to hit exact target
        const adjusted = this.adjustScenesToTarget(scenes, numScenes, durationSec, wps, minSceneSec, maxSceneSec);
        console.log(`[splitIntoScenes] After adjustment: ${adjusted.length} scenes`);
        return adjusted;
    }

    /**
     * Split text into segments at various granularity levels
     * @param {string} text - Text to split
     * @param {string} level - 'sentence' (default), 'clause', 'phrase', or 'word'
     * @returns {array} Array of text segments
     */
    splitIntoSentences(text, level = 'sentence') {
        if (level === 'word') {
            // Finest granularity: split into word groups (2-4 words each)
            const words = text.split(/\s+/).filter(w => w.length > 0);
            if (words.length <= 4) {
                // Can't split further meaningfully
                return [text.trim()];
            }
            // Split into roughly equal halves at word boundaries
            const midpoint = Math.ceil(words.length / 2);
            return [
                words.slice(0, midpoint).join(' '),
                words.slice(midpoint).join(' ')
            ];
        } else if (level === 'phrase') {
            // Fine granularity: split on commas, semicolons, colons, dashes, and sentence endings
            // Also handle punctuation at the end by trimming
            const raw = text.split(/(?<=[.!?;:,—–-])\s+/);
            const result = raw.filter(s => s.trim().length > 0).map(s => s.trim());
            // If only one segment (no splits possible), return as-is
            return result.length >= 2 ? result : [text.trim()];
        } else if (level === 'clause') {
            // Medium granularity: split on semicolons, colons, and sentence endings
            const raw = text.split(/(?<=[.!?;:])\s+/);
            return raw.filter(s => s.trim().length > 0).map(s => s.trim());
        } else {
            // Default: sentence level (split on .!?)
            const raw = text.split(/(?<=[.!?])\s+/);
            return raw.filter(s => s.trim().length > 0).map(s => s.trim());
        }
    }

    /**
     * Finalize a scene with metadata
     */
    finalizeScene(sceneData, totalDuration, numScenes, wps) {
        const text = sceneData.texts.join(' ');
        const avgSceneDuration = totalDuration / numScenes;
        const estimatedDuration = sceneData.words / wps;
        const actualWps = sceneData.words / avgSceneDuration;
        
        let readabilityStatus = 'ok';
        if (actualWps >= PACING_CONSTANTS.wpsCritical) {
            readabilityStatus = 'critical';
        } else if (actualWps >= PACING_CONSTANTS.wpsWarning) {
            readabilityStatus = 'warning';
        }
        
        return {
            text,
            wordCount: sceneData.words,
            estimatedDuration: estimatedDuration.toFixed(1),
            avgSceneDuration: avgSceneDuration.toFixed(1),
            wps: actualWps.toFixed(2),
            readabilityStatus
        };
    }

    /**
     * Adjust scenes to hit exact target count
     * Uses progressive granularity: sentence -> clause -> phrase -> word
     * Never produces 0-word scenes
     * 
     * ALGORITHM v2.1:
     * - For each split attempt, try all granularity levels on the current longest scene
     * - Only move on when a split succeeds
     * - 'word' level can always split scenes with >4 words
     * - Log detailed progress for debugging
     */
    adjustScenesToTarget(scenes, targetCount, totalDuration, wps, minSceneSec, maxSceneSec) {
        // Generate unique ID for this adjustment session
        const adjustId = `adj_${Date.now().toString(36)}`;
        console.log(`[${adjustId}] adjustScenesToTarget: current=${scenes.length}, target=${targetCount}`);
        
        // If we have exactly the right count, return as-is
        if (scenes.length === targetCount) {
            console.log(`[${adjustId}] Already at target, returning`);
            return scenes;
        }
        
        const avgSceneDuration = totalDuration / targetCount;
        const minWords = Math.max(1, Math.floor(minSceneSec * wps));
        const maxWords = Math.ceil(maxSceneSec * wps);
        
        // Track granularity levels - 'word' is the finest (can always split if >4 words)
        const granularityLevels = ['sentence', 'clause', 'phrase', 'word'];
        
        // Too few scenes: split the longest ones with increasing granularity
        let splitAttempts = 0;
        const MAX_SPLIT_ATTEMPTS = 100; // Safety limit
        
        while (scenes.length < targetCount && splitAttempts < MAX_SPLIT_ATTEMPTS) {
            splitAttempts++;
            const prevLength = scenes.length;
            
            // Find longest scene that hasn't been marked as unsplittable
            let maxIdx = -1;
            let maxWordCount = 0;
            scenes.forEach((s, i) => {
                if (!s._cannotSplit && s.wordCount > maxWordCount) {
                    maxWordCount = s.wordCount;
                    maxIdx = i;
                }
            });
            
            // If no splittable scene found, we're done
            if (maxIdx === -1) {
                console.warn(`[${adjustId}] No more splittable scenes. Target: ${targetCount}, Achieved: ${scenes.length}`);
                break;
            }
            
            const toSplit = scenes[maxIdx];
            console.log(`[${adjustId}] Attempt ${splitAttempts}: trying to split scene ${maxIdx} (${toSplit.wordCount} words)`);
            
            // Try ALL granularity levels for THIS scene, starting from finest
            // (phrase is most likely to succeed for dense text)
            let splitSuccess = false;
            
            for (let g = granularityLevels.length - 1; g >= 0 && !splitSuccess; g--) {
                const level = granularityLevels[g];
                const segments = this.splitIntoSentences(toSplit.text, level);
                
                if (segments.length >= 2) {
                    // Split into two parts, trying to balance word counts
                    const segmentWords = segments.map(s => ({
                        text: s,
                        words: s.split(/\s+/).filter(w => w.length > 0).length
                    }));
                    
                    // Find optimal split point (closest to half)
                    const totalWords = segmentWords.reduce((sum, s) => sum + s.words, 0);
                    const targetHalf = totalWords / 2;
                    
                    let bestSplit = 1;
                    let bestDiff = Infinity;
                    let runningSum = 0;
                    
                    for (let i = 0; i < segmentWords.length - 1; i++) {
                        runningSum += segmentWords[i].words;
                        const diff = Math.abs(runningSum - targetHalf);
                        if (diff < bestDiff) {
                            bestDiff = diff;
                            bestSplit = i + 1;
                        }
                    }
                    
                    const firstHalf = segmentWords.slice(0, bestSplit).map(s => s.text).join(' ');
                    const secondHalf = segmentWords.slice(bestSplit).map(s => s.text).join(' ');
                    
                    const firstWords = firstHalf.split(/\s+/).filter(w => w.length > 0).length;
                    const secondWords = secondHalf.split(/\s+/).filter(w => w.length > 0).length;
                    
                    // Only split if both parts have at least 1 word
                    if (firstWords >= 1 && secondWords >= 1) {
                        scenes.splice(maxIdx, 1, 
                            this.finalizeScene({ texts: [firstHalf], words: firstWords }, totalDuration, targetCount, wps),
                            this.finalizeScene({ texts: [secondHalf], words: secondWords }, totalDuration, targetCount, wps)
                        );
                        splitSuccess = true;
                        console.log(`[${adjustId}] ✅ Split success at '${level}': ${toSplit.wordCount} → ${firstWords} + ${secondWords}. Scenes: ${scenes.length}/${targetCount}`);
                    }
                }
            }
            
            // Check if we made ANY progress
            if (!splitSuccess) {
                console.warn(`[${adjustId}] ❌ Could not split scene ${maxIdx} (${toSplit.wordCount} words) at any granularity`);
                console.warn(`[${adjustId}] Scene text: "${toSplit.text.substring(0, 100)}..."`);
                // Mark this scene as "unsplittable" and try another
                toSplit._cannotSplit = true;
            }
        }
        
        if (splitAttempts >= MAX_SPLIT_ATTEMPTS) {
            console.warn(`[${adjustId}] Hit max split attempts (${MAX_SPLIT_ATTEMPTS}). Target: ${targetCount}, Achieved: ${scenes.length}`);
        }
        
        // Clean up internal markers
        scenes.forEach(s => delete s._cannotSplit);
        
        // Too many scenes: merge the shortest adjacent pairs
        while (scenes.length > targetCount) {
            // Find shortest adjacent pair
            let minSum = Infinity;
            let mergeIdx = 0;
            
            for (let i = 0; i < scenes.length - 1; i++) {
                const sum = scenes[i].wordCount + scenes[i + 1].wordCount;
                if (sum < minSum) {
                    minSum = sum;
                    mergeIdx = i;
                }
            }
            
            // Merge scenes at mergeIdx and mergeIdx + 1
            const merged = {
                texts: [scenes[mergeIdx].text, scenes[mergeIdx + 1].text],
                words: scenes[mergeIdx].wordCount + scenes[mergeIdx + 1].wordCount
            };
            
            scenes.splice(mergeIdx, 2, this.finalizeScene(merged, totalDuration, targetCount, wps));
            console.log(`[${adjustId}] Merged scenes ${mergeIdx} and ${mergeIdx + 1}. Scenes: ${scenes.length}/${targetCount}`);
        }
        
        console.log(`[${adjustId}] FINAL: ${scenes.length} scenes (target was ${targetCount})`);
        return scenes;
    }

    /**
     * Auto-adjust scene count based on story word density
     * Returns recommendation and action
     * 
     * Key formulas:
     * - idealWordsPerScene = secPerScene * wps (e.g., 2.5s * 2.3wps = 5.75 words/scene)
     * - recommendedScenes = ceil(storyWords / idealWordsPerScene)
     * - For dense stories: INCREASE scenes to distribute words
     * - For sparse stories: DECREASE scenes to fill time
     */
    autoAdjustSceneCount(options = {}) {
        const {
            storyWords,
            currentSceneCount = null,
            durationSec = 60,
            pace = 'balanced',
            platform = 'reels'
        } = options;
        
        const pacePreset = PACE_PRESETS[pace] || PACE_PRESETS.balanced;
        const platformClamps = PLATFORM_SCENE_CLAMPS[platform] || PLATFORM_SCENE_CLAMPS.reels;
        const clamp = platformClamps[durationSec] || platformClamps[60] || { min: 6, max: 40 };
        
        // Ideal words per scene at target pace
        const idealWordsPerScene = pacePreset.secPerScene * PACING_CONSTANTS.wps;
        
        // Calculate recommended scene count based on word count
        // This is the key fix: we compute from words, not by scaling idealSceneCount
        const recommendedFromWords = Math.ceil(storyWords / idealWordsPerScene);
        
        // Ideal scene count from pace (for reference)
        const idealSceneCount = Math.round(durationSec / pacePreset.secPerScene);
        
        // Calculate ideal total words for this duration at target WPS
        const idealTotalWords = durationSec * PACING_CONSTANTS.wps;
        
        // Calculate density ratio (for display/diagnostics)
        const densityRatio = storyWords / idealTotalWords;
        
        // Determine action and adjusted count
        let action = 'ok';
        let adjustedSceneCount = idealSceneCount;
        let message = null;
        let atClampLimit = false;
        
        if (densityRatio < 0.7) {
            // Story is TOO SPARSE (short) - need FEWER scenes
            action = 'story_short';
            // Reduce scene count: fewer scenes = longer per scene = fill time better
            adjustedSceneCount = recommendedFromWords;
            message = `Story is sparse (${storyWords} words for ${durationSec}s). Reducing scenes to improve pacing.`;
        } else if (densityRatio > 1.3) {
            // Story is TOO DENSE (long) - need MORE scenes
            action = 'story_long';
            // Increase scene count: more scenes = faster cuts = handle more words
            adjustedSceneCount = recommendedFromWords;
            message = `Story is dense (${storyWords} words for ${durationSec}s). Increasing scenes for better pacing.`;
        }
        
        // Store unclamped value for comparison
        const unclampedSceneCount = adjustedSceneCount;
        
        // Enforce minimum and maximum scene bounds (6-40)
        const MIN_SCENES = 6;
        const MAX_SCENES = 40;
        adjustedSceneCount = Math.max(MIN_SCENES, Math.min(MAX_SCENES, adjustedSceneCount));
        
        // Also respect platform clamps
        adjustedSceneCount = Math.max(clamp.min, Math.min(clamp.max, adjustedSceneCount));
        
        // Check if we hit a clamp limit
        if (action === 'story_long' && adjustedSceneCount < unclampedSceneCount) {
            atClampLimit = true;
            message = `Story is very dense (${storyWords} words for ${durationSec}s). Already at max ${clamp.max} scenes for this platform.`;
        } else if (action === 'story_short' && adjustedSceneCount > unclampedSceneCount) {
            atClampLimit = true;
            message = `Story is very sparse (${storyWords} words for ${durationSec}s). Already at min ${clamp.min} scenes for this platform.`;
        }
        
        // If adjusted equals current AND we're at a clamp limit, mark action as 'at_limit'
        if (adjustedSceneCount === currentSceneCount && atClampLimit) {
            action = 'at_limit';
        }
        
        // Debug info
        const debugInfo = {
            storyWords,
            idealTotalWords: Math.round(idealTotalWords),
            idealWordsPerScene: idealWordsPerScene.toFixed(1),
            idealSceneCount,
            recommendedFromWords,
            unclampedSceneCount,
            densityRatio: densityRatio.toFixed(2),
            currentSceneCount,
            adjustedSceneCount,
            atClampLimit,
            clamp
        };
        
        return {
            action,
            originalSceneCount: idealSceneCount,
            adjustedSceneCount,
            densityRatio: densityRatio.toFixed(2),
            message,
            storyWords,
            idealTotalWords: Math.round(idealTotalWords),
            clamp,
            debugInfo
        };
    }

    /**
     * Build caption for a scene with readability checks
     * Auto-summarizes if text is too dense for the scene duration
     * @param {string} voiceText - The narration text for the scene
     * @param {number} sceneSec - The scene duration in seconds
     * @param {object} options - Caption options
     * @returns {object} Caption with text, lines, readability info, and any warnings
     */
    buildCaption(voiceText, sceneSec, options = {}) {
        const {
            maxChars = PACING_CONSTANTS.maxCaptionChars,
            maxCharsPerLine = PACING_CONSTANTS.maxCharsPerLine,
            maxLines = PACING_CONSTANTS.maxCaptionLines,
            maxWps = PACING_CONSTANTS.wpsWarning
        } = options;

        const words = voiceText.split(/\s+/).filter(w => w.length > 0);
        const wordCount = words.length;
        const charCount = voiceText.length;
        const wps = wordCount / sceneSec;
        
        let captionText = voiceText;
        let lines = [];
        let readabilityStatus = 'ok';
        let warnings = [];
        let wasSummarized = false;

        // Check WPS threshold
        if (wps > PACING_CONSTANTS.wpsCritical) {
            readabilityStatus = 'critical';
            warnings.push(`Reading speed ${wps.toFixed(1)} wps is very fast`);
        } else if (wps > PACING_CONSTANTS.wpsWarning) {
            readabilityStatus = 'warning';
            warnings.push(`Reading speed ${wps.toFixed(1)} wps is tight`);
        }

        // Check char count
        if (charCount > maxChars) {
            warnings.push(`Caption exceeds ${maxChars} chars (${charCount})`);
            // Attempt to summarize by removing filler words and shortening
            captionText = this.summarizeCaption(voiceText, maxChars);
            wasSummarized = true;
        }

        // Split into lines respecting maxCharsPerLine
        lines = this.splitCaptionIntoLines(captionText, maxCharsPerLine, maxLines);
        
        // Check line count
        if (lines.length > maxLines) {
            warnings.push(`Caption has ${lines.length} lines (max ${maxLines})`);
            // Truncate to max lines and add ellipsis
            lines = lines.slice(0, maxLines);
            lines[maxLines - 1] = lines[maxLines - 1].slice(0, -3) + '...';
        }

        return {
            original: voiceText,
            text: captionText,
            lines,
            lineCount: lines.length,
            wordCount,
            charCount: captionText.length,
            wps: wps.toFixed(2),
            sceneSec,
            readabilityStatus,
            warnings,
            wasSummarized
        };
    }

    /**
     * Summarize caption text to fit within maxChars
     * Removes filler words and shortens phrases
     */
    summarizeCaption(text, maxChars) {
        // Remove common filler words while preserving meaning
        const fillerWords = [
            'very', 'really', 'actually', 'basically', 'literally',
            'just', 'quite', 'somewhat', 'perhaps', 'maybe',
            'suddenly', 'slowly', 'quickly', 'softly', 'quietly'
        ];
        
        let result = text;
        
        // First pass: remove filler words
        for (const filler of fillerWords) {
            const regex = new RegExp(`\\b${filler}\\b\\s*`, 'gi');
            result = result.replace(regex, '');
        }
        
        // Clean up double spaces
        result = result.replace(/\s+/g, ' ').trim();
        
        // If still too long, truncate at last complete word before maxChars
        if (result.length > maxChars) {
            result = result.substring(0, maxChars);
            const lastSpace = result.lastIndexOf(' ');
            if (lastSpace > maxChars * 0.7) {
                result = result.substring(0, lastSpace);
            }
            result = result.trim() + '...';
        }
        
        return result;
    }

    /**
     * Split caption into lines respecting maxCharsPerLine
     */
    splitCaptionIntoLines(text, maxCharsPerLine, maxLines) {
        const words = text.split(/\s+/);
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            
            if (testLine.length <= maxCharsPerLine) {
                currentLine = testLine;
            } else {
                if (currentLine) {
                    lines.push(currentLine);
                }
                currentLine = word;
                
                // Stop if we've reached max lines
                if (lines.length >= maxLines - 1) {
                    // Add remaining words to last line with truncation
                    const remaining = words.slice(words.indexOf(word)).join(' ');
                    if (remaining.length > maxCharsPerLine) {
                        currentLine = remaining.substring(0, maxCharsPerLine - 3) + '...';
                    } else {
                        currentLine = remaining;
                    }
                    break;
                }
            }
        }
        
        if (currentLine) {
            lines.push(currentLine);
        }
        
        return lines;
    }

    /**
     * Check readability of all scenes and return summary
     */
    checkScenesReadability(scenes, durationSec) {
        const avgSceneDuration = durationSec / scenes.length;
        const results = [];
        let criticalCount = 0;
        let warningCount = 0;
        
        for (const scene of scenes) {
            const caption = this.buildCaption(scene.text || '', avgSceneDuration);
            results.push({
                scene,
                caption,
                status: caption.readabilityStatus
            });
            
            if (caption.readabilityStatus === 'critical') criticalCount++;
            else if (caption.readabilityStatus === 'warning') warningCount++;
        }
        
        let overallStatus = 'ok';
        if (criticalCount > 0) {
            overallStatus = 'critical';
        } else if (warningCount > scenes.length * 0.3) {
            overallStatus = 'warning';
        }
        
        return {
            results,
            summary: {
                total: scenes.length,
                ok: scenes.length - criticalCount - warningCount,
                warning: warningCount,
                critical: criticalCount,
                overallStatus
            }
        };
    }

    // ==================== STEP 1: SETTINGS ====================

    renderSettingsStep(container) {
        const settings = this.template.settings;
        const preset = this.selectedPreset;
        
        // Initialize defaults from template if not already set
        if (!this.formData.duration) {
            this.formData.duration = this.template?.defaults?.duration || 'medium';
        }
        if (!this.formData.category) {
            this.formData.category = preset?.defaults?.vibe_preset || settings?.themes?.[0]?.value || 'general';
        }
        
        // Determine if genre should be locked
        const genreLocked = preset && preset.id !== 'neutral' && preset.id !== 'custom';
        
        let html = `
            <div class="create-card">
                <div class="create-form">
                    
                    <!-- Section A: Narrative Intent (Required) -->
                    <div class="settings-section settings-section--open">
                        <button type="button" class="settings-section__header" data-section="narrative">
                            <span class="settings-section__icon">🧩</span>
                            <span class="settings-section__title">Narrative Intent</span>
                            <span class="settings-section__badge">Required</span>
                            <span class="settings-section__arrow">▼</span>
                        </button>
                        <div class="settings-section__content" id="section-narrative">
        `;

        // Genre (locked if preset chosen)
        if (settings.themes) {
            html += `
                <div class="form-group">
                    <label class="form-label">🎭 Genre ${genreLocked ? '<span class="form-label__lock" title="Locked by preset">🔒</span>' : ''}</label>
                    <select id="category" class="form-control select" ${genreLocked ? 'disabled' : ''}>
                        ${settings.themes.map(c => `<option value="${c.value}" ${this.formData.category === c.value ? 'selected' : ''}>${c.icon || ''} ${c.label}</option>`).join('')}
                    </select>
                    ${genreLocked ? `<p class="form-hint">Preset: ${preset.name}</p>` : ''}
                </div>
            `;
        }

        // Era selection
        if (settings.eras) {
            html += `
                <div class="form-group">
                    <label class="form-label">📅 Era</label>
                    <select id="era" class="form-control select">
                        ${settings.eras.map(e => `<option value="${e.value}" ${this.formData.era === e.value ? 'selected' : ''}>${e.label}</option>`).join('')}
                    </select>
                </div>
            `;
        }

        // Tone slider
        html += `
            <div class="form-group">
                <label class="form-label">🎚️ Tone</label>
                <div class="tone-slider-wrapper">
                    <input type="range" id="tone" min="0" max="1" step="0.1" value="${this.formData.tone || 0.5}" class="tone-slider">
                    <div class="tone-slider-labels">
                        <span>Calm</span>
                        <span>Intense</span>
                    </div>
                </div>
                <div class="tone-slider__value" id="tone-value">${this.getToneLabel(this.formData.tone || 0.5)}</div>
            </div>
        `;

        // Ending type
        if (settings.endings) {
            html += `
                <div class="form-group">
                    <label class="form-label">🔚 Ending Type</label>
                    <select id="ending" class="form-control select">
                        ${settings.endings.map(e => `<option value="${e.value}" ${this.formData.ending === e.value ? 'selected' : ''}>${e.label} - ${e.description}</option>`).join('')}
                    </select>
                </div>
            `;
        }

        // Duration
        if (settings.durations) {
            html += `
                <div class="form-group">
                    <label class="form-label">⏱️ Duration</label>
                    <select id="duration" class="form-control select">
                        ${settings.durations.map(d => `<option value="${d.value}" ${d.value === (this.formData.duration || this.template.defaults.duration) ? 'selected' : ''}>${d.label}</option>`).join('')}
                    </select>
                </div>
            `;
        }

        // Pace Slider (Scene Pacing Control)
        const currentPace = this.formData.pace || 'balanced';
        const currentDurationRaw = this.formData.duration || this.template?.defaults?.duration || 'medium';
        const currentDuration = this.durationToSeconds(currentDurationRaw);
        const paceInfo = this.calculatePaceInfo(currentPace, currentDuration);
        
        html += `
            <div class="form-group">
                <label class="form-label">🎬 Scene Pacing</label>
                <div class="pace-slider">
                    <div class="pace-slider__track">
                        <button type="button" class="pace-slider__option ${currentPace === 'slow' ? 'pace-slider__option--active' : ''}" data-pace="slow">
                            <span class="pace-slider__option-icon">🐢</span>
                            <span class="pace-slider__option-label">${PACE_PRESETS.slow.label}</span>
                            <span class="pace-slider__option-desc">${PACE_PRESETS.slow.description}</span>
                        </button>
                        <button type="button" class="pace-slider__option ${currentPace === 'balanced' ? 'pace-slider__option--active' : ''}" data-pace="balanced">
                            <span class="pace-slider__option-icon">⚖️</span>
                            <span class="pace-slider__option-label">${PACE_PRESETS.balanced.label}</span>
                            <span class="pace-slider__option-desc">${PACE_PRESETS.balanced.description}</span>
                        </button>
                        <button type="button" class="pace-slider__option ${currentPace === 'fast' ? 'pace-slider__option--active' : ''}" data-pace="fast">
                            <span class="pace-slider__option-icon">⚡</span>
                            <span class="pace-slider__option-label">${PACE_PRESETS.fast.label}</span>
                            <span class="pace-slider__option-desc">${PACE_PRESETS.fast.description}</span>
                        </button>
                    </div>
                </div>
                <input type="hidden" id="pace" value="${currentPace}">
            </div>
            
            <!-- Pacing Info Panel -->
            <div class="pacing-info-panel" id="pacing-info">
                <div class="pacing-info-grid">
                    <div class="pacing-info-item">
                        <span class="pacing-info-item__label">Scenes</span>
                        <span class="pacing-info-item__value" id="pacing-scene-count">${paceInfo.sceneCount}</span>
                    </div>
                    <div class="pacing-info-item">
                        <span class="pacing-info-item__label">Avg/Scene</span>
                        <span class="pacing-info-item__value" id="pacing-avg-duration">${paceInfo.avgDuration}s</span>
                    </div>
                    <div class="pacing-info-item">
                        <span class="pacing-info-item__label">Readability</span>
                        <span class="pacing-info-item__value pacing-info-item__value--${paceInfo.readabilityRisk}" id="pacing-readability">${paceInfo.readabilityLabel}</span>
                    </div>
                    <div class="pacing-info-item">
                        <span class="pacing-info-item__label">Render Load</span>
                        <span class="pacing-info-item__value" id="pacing-render-load">${paceInfo.renderLoad}</span>
                    </div>
                </div>
                ${paceInfo.warning ? `<div class="pacing-info-warning"><span class="pacing-info-warning__icon">⚠️</span> ${paceInfo.warning}</div>` : ''}
            </div>
            
            <!-- Advanced: Manual Scene Count (only in Advanced Mode) -->
            ${this.advancedMode ? `
            <div class="form-group form-group--advanced">
                <label class="form-label">🎯 Manual Scene Count <span class="form-label__badge">Override</span></label>
                <div class="scene-count-slider">
                    <input type="range" id="manualSceneCount" min="${paceInfo.clamp.min}" max="${paceInfo.clamp.max}" value="${paceInfo.sceneCount}" class="scene-count-slider__input">
                    <span class="scene-count-slider__value" id="manual-scene-value">${paceInfo.sceneCount}</span>
                </div>
                <p class="form-hint">Platform limit: ${paceInfo.clamp.min}-${paceInfo.clamp.max} scenes for ${currentDuration}s ${this.targetPlatform}</p>
            </div>
            ` : ''}`;

        html += `
                        </div>
                    </div>
                    
                    <!-- Section B: Visual Identity (Preview) -->
                    <div class="settings-section">
                        <button type="button" class="settings-section__header" data-section="visual">
                            <span class="settings-section__icon">🎨</span>
                            <span class="settings-section__title">Visual Identity</span>
                            <span class="settings-section__badge settings-section__badge--preview">Preview</span>
                            <span class="settings-section__arrow">▼</span>
                        </button>
                        <div class="settings-section__content hidden" id="section-visual">
                            <div class="visual-preview-card">
                                <p class="visual-preview-card__note">Visual DNA will be derived from your story. These are the expected defaults:</p>
                                <div class="visual-preview-grid">
                                    <div class="visual-preview-item">
                                        <span class="visual-preview-item__label">Style</span>
                                        <span class="visual-preview-item__value">${preset?.defaults?.visual_style || 'Auto-derived'}</span>
                                    </div>
                                    <div class="visual-preview-item">
                                        <span class="visual-preview-item__label">Palette</span>
                                        <span class="visual-preview-item__value">${preset?.defaults?.color_palette || 'Auto-derived'}</span>
                                    </div>
                                    <div class="visual-preview-item">
                                        <span class="visual-preview-item__label">Motion</span>
                                        <span class="visual-preview-item__value">${preset?.defaults?.motion_profile || 'Auto-derived'}</span>
                                    </div>
                                </div>
                                <div class="visual-preview-tooltip">
                                    <span class="visual-preview-tooltip__icon">ⓘ</span>
                                    <span class="visual-preview-tooltip__text">Why these visuals? Visual DNA is derived from your story DNA to keep the style consistent and prevent drift.</span>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label">🔄 Allow Visual Variation</label>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="allowVariation" checked>
                                    <span class="toggle-switch__slider"></span>
                                    <span class="toggle-switch__label">Auto-rotate safe traits to keep content fresh</span>
                                </label>
                            </div>
                            
                            ${settings.uniquenessModes ? `
                            <div class="form-group">
                                <label class="form-label">🎯 Uniqueness Mode</label>
                                <select id="uniquenessMode" class="form-control select">
                                    ${settings.uniquenessModes.map(m => `<option value="${m.value}">${m.label} - ${m.description}</option>`).join('')}
                                </select>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                    
                    <!-- Section C: Advanced Controls (Collapsed, requires Advanced Mode) -->
                    <div class="settings-section settings-section--advanced ${!this.advancedMode ? 'settings-section--locked' : ''}">
                        <button type="button" class="settings-section__header" data-section="advanced" ${!this.advancedMode ? 'disabled' : ''}>
                            <span class="settings-section__icon">⚙️</span>
                            <span class="settings-section__title">Advanced Controls</span>
                            ${!this.advancedMode ? '<span class="settings-section__badge settings-section__badge--locked">🔒 Advanced Mode</span>' : '<span class="settings-section__badge settings-section__badge--advanced">Power User</span>'}
                            <span class="settings-section__arrow">▼</span>
                        </button>
                        <div class="settings-section__content hidden" id="section-advanced">
                            ${this.advancedMode ? `
                            <div class="form-group">
                                <label class="form-label">🎲 Rarity Bias</label>
                                <select id="rarityBias" class="form-control select">
                                    ${(settings.rarityBias || []).map(r => `<option value="${r.value}">${r.label} - ${r.description}</option>`).join('')}
                                </select>
                                <p class="form-hint">Controls how often rare DNA combinations are selected</p>
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label">🔁 Max DNA Attempts</label>
                                <input type="number" id="maxAttempts" class="form-control" value="5" min="1" max="10">
                                <p class="form-hint">Number of retries if DNA collision detected</p>
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label">🔒 Lock Visual Identity</label>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="lockVisualDNA">
                                    <span class="toggle-switch__slider"></span>
                                    <span class="toggle-switch__label">Prevent re-derivation after generation</span>
                                </label>
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label">📜 Legacy Generation</label>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="useLegacy">
                                    <span class="toggle-switch__slider"></span>
                                    <span class="toggle-switch__label">Use legacy mode (no uniqueness guarantees)</span>
                                </label>
                            </div>
                            ` : `
                            <p class="settings-section__locked-message">Enable Advanced Mode in the header to access power-user controls.</p>
                            `}
                        </div>
                    </div>
        `;

        // Visual source (keep from original)
        html += `
                    <!-- Visual Source Selection -->
                    <div class="form-group">
                        <label class="form-label">🖼️ Visual Source</label>
                        <div class="visual-source-options">
                            <label class="visual-source-option">
                                <input type="radio" name="visualSource" value="ai" ${(this.formData.visualSource || this.template.defaults.visualSource) === 'ai' ? 'checked' : ''}>
                                <div class="visual-source-option__content">
                                    <span class="visual-source-option__icon">🎨</span>
                                    <span class="visual-source-option__label">AI Generated</span>
                                    <span class="visual-source-option__cost">~$0.02-0.08/image</span>
                                </div>
                            </label>
                            <label class="visual-source-option">
                                <input type="radio" name="visualSource" value="pexels" ${(this.formData.visualSource || this.template.defaults.visualSource) === 'pexels' ? 'checked' : ''}>
                                <div class="visual-source-option__content">
                                    <span class="visual-source-option__icon">📹</span>
                                    <span class="visual-source-option__label">Stock (Pexels)</span>
                                    <span class="visual-source-option__cost">Free</span>
                                </div>
                            </label>
                        </div>
                    </div>

                    <!-- AI Model (shown when AI is selected) -->
                    <div class="form-group" id="ai-model-group">
                        <label class="form-label">🤖 AI Image Model</label>
                        <select id="imageModel" class="form-control select">
                            <option value="gpt-4o">GPT-4o - Best value (~$0.016/img) ⭐</option>
                            <option value="dall-e-3">DALL-E 3 - Best for illustrations (~$0.08/img)</option>
                            <option value="flux">FLUX Pro - Best for realistic (~$0.04/img)</option>
                        </select>
                    </div>
        `;

        // Cost estimate
        html += `
                    <div class="cost-estimate">
                        <h3 class="cost-estimate__title">💰 Estimated Cost</h3>
                        <div id="cost-breakdown" class="cost-estimate__breakdown"></div>
                    </div>
                    
                    <!-- Effects Intensity Controls -->
                    <div class="effects-intensity-card">
                        <div class="effects-intensity-card__header">
                            <div class="effects-intensity-card__title">
                                <span class="effects-intensity-card__icon">🎛️</span>
                                <span>Effect Intensity</span>
                            </div>
                            <!-- Auto/Custom Toggle -->
                            <div class="effects-mode-toggle">
                                <button type="button" id="effects-mode-auto" class="effects-mode-btn effects-mode-btn--active" data-mode="auto">
                                    Auto
                                </button>
                                <button type="button" id="effects-mode-custom" class="effects-mode-btn" data-mode="custom">
                                    Custom
                                </button>
                            </div>
                        </div>
                        
                        <!-- Auto Mode: Preset Summary -->
                        <div id="effects-auto-summary" class="effects-auto-summary">
                            <p class="effects-auto-summary__note">Effects for <strong id="effects-preset-name">Slow Creepy</strong>:</p>
                            <div id="effects-preset-tags" class="effects-preset-tags">
                                <!-- Tags populated by JS -->
                            </div>
                        </div>
                        
                        <!-- Custom Mode: Sliders -->
                        <div id="effects-custom-sliders" class="effects-custom-sliders hidden">
                            <!-- Vignette -->
                            <div class="effects-slider">
                                <label class="effects-slider__label">Vignette</label>
                                <input type="range" id="slider-vignette" min="0" max="100" value="50" class="effects-slider__input">
                                <span id="label-vignette" class="effects-slider__value">Medium</span>
                            </div>
                            <!-- Film Grain -->
                            <div class="effects-slider">
                                <label class="effects-slider__label">Film Grain</label>
                                <input type="range" id="slider-film_grain" min="0" max="100" value="0" class="effects-slider__input">
                                <span id="label-film_grain" class="effects-slider__value">Off</span>
                            </div>
                            <!-- VHS -->
                            <div class="effects-slider">
                                <label class="effects-slider__label">VHS Effect</label>
                                <input type="range" id="slider-vhs" min="0" max="100" value="0" class="effects-slider__input effects-slider__input--red">
                                <span id="label-vhs" class="effects-slider__value">Off</span>
                            </div>
                            <!-- Glitch -->
                            <div class="effects-slider">
                                <label class="effects-slider__label">Glitch</label>
                                <input type="range" id="slider-glitch" min="0" max="100" value="0" class="effects-slider__input effects-slider__input--red">
                                <span id="label-glitch" class="effects-slider__value">Off</span>
                            </div>
                            <!-- Scanlines -->
                            <div class="effects-slider">
                                <label class="effects-slider__label">Scanlines</label>
                                <input type="range" id="slider-scanlines" min="0" max="100" value="0" class="effects-slider__input effects-slider__input--red">
                                <span id="label-scanlines" class="effects-slider__value">Off</span>
                            </div>
                            <!-- Color Grade -->
                            <div class="effects-slider">
                                <label class="effects-slider__label">Color Grade</label>
                                <select id="slider-color_grade" class="effects-slider__select">
                                    <option value="none">None</option>
                                    <option value="cold">Cold Blue</option>
                                    <option value="warm">Warm Sepia</option>
                                    <option value="desaturated">Desaturated</option>
                                    <option value="high_contrast">High Contrast</option>
                                    <option value="horror_cold">Horror Cold</option>
                                    <option value="cinematic">Cinematic</option>
                                    <option value="vhs_degraded">VHS Degraded</option>
                                    <option value="found_footage">Found Footage</option>
                                    <option value="urban_night">Urban Night</option>
                                    <option value="psychological">Psychological</option>
                                    <option value="cosmic_void">Cosmic Void</option>
                                </select>
                            </div>
                            <!-- Ken Burns -->
                            <div class="effects-slider">
                                <label class="effects-slider__label">Ken Burns</label>
                                <input type="range" id="slider-kenburns" min="0" max="100" value="60" class="effects-slider__input effects-slider__input--blue">
                                <span id="label-kenburns" class="effects-slider__value">Medium</span>
                            </div>
                        </div>
                        
                        <input type="hidden" id="effects-mode" value="auto">
                    </div>
                    
                    <!-- Generation Plan Preview -->
                    <div class="generation-plan-card">
                        <h3 class="generation-plan-card__title">📋 Generation Plan</h3>
                        <p class="generation-plan-card__subtitle">What happens when you click Continue:</p>
                        <div class="generation-plan-grid">
                            <div class="generation-plan-item">
                                <span class="generation-plan-item__check">✅</span>
                                <span class="generation-plan-item__label">Story</span>
                                <span class="generation-plan-item__value">DNA v2.1 (genre-aware)</span>
                            </div>
                            <div class="generation-plan-item">
                                <span class="generation-plan-item__check">✅</span>
                                <span class="generation-plan-item__label">Audio</span>
                                <span class="generation-plan-item__value">ElevenLabs (${this.template?.defaults?.voice || 'Auto-selected'})</span>
                            </div>
                            <div class="generation-plan-item">
                                <span class="generation-plan-item__check">✅</span>
                                <span class="generation-plan-item__label">Visual DNA</span>
                                <span class="generation-plan-item__value">Derived + anti-clone checks</span>
                            </div>
                            <div class="generation-plan-item">
                                <span class="generation-plan-item__check">✅</span>
                                <span class="generation-plan-item__label">Images</span>
                                <span class="generation-plan-item__value">${this.template?.defaults?.sceneCount || 6} frames (${this.formData.visualSource === 'pexels' ? 'Stock' : this.formData.imageModel || 'gpt-4o'})</span>
                            </div>
                            <div class="generation-plan-item">
                                <span class="generation-plan-item__check">✅</span>
                                <span class="generation-plan-item__label">Render</span>
                                <span class="generation-plan-item__value">${this.targetPlatform === 'reels' ? 'Reels' : this.targetPlatform === 'tiktok' ? 'TikTok' : 'Shorts'}-tuned output</span>
                            </div>
                        </div>
                        <div class="generation-plan-note">
                            <span class="generation-plan-note__icon">💡</span>
                            <span>Visual DNA is derived from your genre + era choices to keep style consistent and unique.</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;
        this.setupSettingsListeners();
        this.setupEffectsIntensityListeners();
        this.updateCostEstimate();
        
        // Update navigation buttons now that formData has defaults
        this.updateNavigationButtons();
    }

    setupSettingsListeners() {
        // Section toggle listeners
        document.querySelectorAll('.settings-section__header').forEach(header => {
            header.addEventListener('click', (e) => {
                if (header.disabled) return;
                const section = header.dataset.section;
                const content = document.getElementById(`section-${section}`);
                const parent = header.closest('.settings-section');
                if (content && parent) {
                    content.classList.toggle('hidden');
                    parent.classList.toggle('settings-section--open');
                }
            });
        });

        // Tone slider
        document.getElementById('tone')?.addEventListener('input', (e) => {
            document.getElementById('tone-value').textContent = this.getToneLabel(parseFloat(e.target.value));
        });

        // Pace slider buttons
        document.querySelectorAll('.pace-slider__option').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const pace = btn.dataset.pace;
                
                // Update active state
                document.querySelectorAll('.pace-slider__option').forEach(b => b.classList.remove('pace-slider__option--active'));
                btn.classList.add('pace-slider__option--active');
                
                // Update hidden input
                document.getElementById('pace').value = pace;
                this.formData.pace = pace;
                
                // Update pacing info panel
                this.updatePacingInfo();
                this.updateCostEstimate();
            });
        });

        // Duration change also updates pacing info
        document.getElementById('duration')?.addEventListener('change', (e) => {
            this.formData.duration = parseInt(e.target.value);
            this.updatePacingInfo();
            this.updateCostEstimate();
        });

        // Manual scene count slider (Advanced Mode)
        document.getElementById('manualSceneCount')?.addEventListener('input', (e) => {
            const count = parseInt(e.target.value);
            document.getElementById('manual-scene-value').textContent = count;
            this.formData.manualSceneCount = count;
            
            // Update pacing info to reflect manual override
            const duration = this.formData.duration || 60;
            const avgDuration = (duration / count).toFixed(1);
            document.getElementById('pacing-scene-count').textContent = count;
            document.getElementById('pacing-avg-duration').textContent = `${avgDuration}s`;
        });

        // Visual source toggle
        document.querySelectorAll('input[name="visualSource"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const isAI = e.target.value === 'ai';
                document.getElementById('ai-model-group')?.classList.toggle('hidden', !isAI);
                this.updateCostEstimate();
            });
        });

        // Update cost on model change
        document.getElementById('imageModel')?.addEventListener('change', () => this.updateCostEstimate());
    }

    /**
     * Setup Effects Intensity Controls listeners
     */
    setupEffectsIntensityListeners() {
        // Mode toggle buttons
        document.querySelectorAll('.effects-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                this.setEffectsMode(mode);
            });
        });
        
        // Slider listeners for real-time label updates
        ['vignette', 'film_grain', 'vhs', 'glitch', 'scanlines', 'kenburns'].forEach(key => {
            const slider = document.getElementById(`slider-${key}`);
            if (slider) {
                slider.addEventListener('input', () => this.updateEffectsSliderLabel(key));
            }
        });
        
        // Initialize effects based on genre/tone
        this.updateEffectsPresetSummary();
        this.syncEffectsSlidersFromPreset();
    }

    /**
     * Set effects mode (auto/custom)
     */
    setEffectsMode(mode) {
        this.formData.effectsMode = mode;
        
        const modeInput = document.getElementById('effects-mode');
        const autoBtn = document.getElementById('effects-mode-auto');
        const customBtn = document.getElementById('effects-mode-custom');
        const autoSummary = document.getElementById('effects-auto-summary');
        const customSliders = document.getElementById('effects-custom-sliders');
        
        if (modeInput) modeInput.value = mode;
        
        if (mode === 'auto') {
            autoBtn?.classList.add('effects-mode-btn--active');
            customBtn?.classList.remove('effects-mode-btn--active');
            autoSummary?.classList.remove('hidden');
            customSliders?.classList.add('hidden');
            this.syncEffectsSlidersFromPreset();
        } else {
            customBtn?.classList.add('effects-mode-btn--active');
            autoBtn?.classList.remove('effects-mode-btn--active');
            autoSummary?.classList.add('hidden');
            customSliders?.classList.remove('hidden');
        }
        
        console.log('[Effects] Mode switched to:', mode);
    }

    /**
     * Get the current vibe preset name based on genre/category
     */
    getVibePresetFromGenre() {
        const genre = this.formData.category || document.getElementById('category')?.value || 'general';
        const vibeMap = {
            'paranormal': 'slow_creepy',
            'psychological': 'atmospheric', 
            'creature': 'punchy_shock',
            'folklore': 'urban_legend',
            'cosmic': 'atmospheric',
            'general': 'slow_creepy'
        };
        return vibeMap[genre] || 'slow_creepy';
    }

    /**
     * Update effects preset summary tags from actual preset data
     */
    updateEffectsPresetSummary() {
        const tagsEl = document.getElementById('effects-preset-tags');
        const presetNameEl = document.getElementById('effects-preset-name');
        if (!tagsEl) return;
        
        const vibePreset = this.getVibePresetFromGenre();
        
        // Get preset info from effects-presets.js if available
        const presetInfo = typeof PRESET_EFFECT_SUMMARY !== 'undefined' 
            ? PRESET_EFFECT_SUMMARY[vibePreset] 
            : null;
        
        // Update preset name display
        if (presetNameEl && presetInfo) {
            presetNameEl.textContent = presetInfo.label || vibePreset;
        }
        
        let tags = [];
        
        if (presetInfo && presetInfo.activeEffects) {
            // Use actual preset data
            for (const effect of presetInfo.activeEffects) {
                const intensity = effect.intensity || 0;
                let color = 'gray';
                
                // Color based on intensity
                if (intensity > 0.6) color = 'red';
                else if (intensity > 0.4) color = 'amber';
                else if (intensity > 0.2) color = 'blue';
                
                // Special colors for certain effects
                if (effect.key === 'vhs' || effect.key === 'glitch') color = 'red';
                if (effect.key === 'color_grade') color = 'purple';
                
                // Show percentage for clarity
                const pct = Math.round(intensity * 100);
                const label = `${effect.name} ${pct}%`;
                tags.push({ name: label, color });
            }
            
            // Add mood tag
            if (presetInfo.mood) {
                tags.push({ name: `🎭 ${presetInfo.mood}`, color: 'purple' });
            }
        } else {
            // Fallback
            tags.push({ name: 'Standard effects', color: 'gray' });
        }
        
        tagsEl.innerHTML = tags.map(t => 
            `<span class="effects-preset-tag effects-preset-tag--${t.color}">${t.name}</span>`
        ).join('');
    }

    /**
     * Sync sliders from preset/genre defaults
     */
    syncEffectsSlidersFromPreset() {
        const vibePreset = this.getVibePresetFromGenre();
        
        // Get slider values based on vibe preset
        let sliderValues;
        if (typeof getSlidersFromPreset === 'function') {
            sliderValues = getSlidersFromPreset(vibePreset);
        } else {
            // Fallback defaults (0-100 range)
            sliderValues = {
                vignette: 45,
                film_grain: 0,
                vhs: 0,
                glitch: 0,
                scanlines: 0,
                color_grade: 'none',
                kenburns: 30
            };
        }
        
        console.log('[Effects] Syncing sliders from preset:', vibePreset, sliderValues);
        
        // Apply to sliders
        Object.entries(sliderValues).forEach(([key, value]) => {
            const slider = document.getElementById(`slider-${key}`);
            if (slider) {
                if (key === 'color_grade') {
                    console.log(`[Effects] Setting color_grade select to: "${value}"`, 
                        'Current value:', slider.value,
                        'Available options:', Array.from(slider.options).map(o => o.value));
                }
                slider.value = value;
                this.updateEffectsSliderLabel(key);
                if (key === 'color_grade') {
                    console.log(`[Effects] After setting, color_grade value is: "${slider.value}"`);
                }
            }
        });
        
        this.formData.effectsSliders = sliderValues;
    }

    /**
     * Update slider label with intensity description
     */
    updateEffectsSliderLabel(effectKey) {
        const slider = document.getElementById(`slider-${effectKey}`);
        const label = document.getElementById(`label-${effectKey}`);
        
        if (!slider || !label || slider.tagName === 'SELECT') return;
        
        const value = parseInt(slider.value);
        
        // Use effects-presets.js helper if available
        if (typeof getIntensityLabel === 'function') {
            label.textContent = getIntensityLabel(effectKey, value);
        } else {
            // Fallback
            if (value === 0) label.textContent = 'Off';
            else if (value < 30) label.textContent = 'Low';
            else if (value < 70) label.textContent = 'Medium';
            else label.textContent = 'High';
        }
        
        // Update label color
        label.className = 'effects-slider__value';
        if (value === 0) label.classList.add('effects-slider__value--off');
        else if (value < 30) label.classList.add('effects-slider__value--low');
        else if (value < 70) label.classList.add('effects-slider__value--medium');
        else label.classList.add('effects-slider__value--high');
    }

    /**
     * Convert duration preset string to seconds
     */
    durationToSeconds(duration) {
        const durationMap = {
            'short': 30,
            'medium': 45,
            'long': 60,
            'extended': 90,
            'full': 120
        };
        // If it's already a number, return it
        if (typeof duration === 'number' && !isNaN(duration)) {
            return duration;
        }
        // If it's a string number like '60', parse it
        if (typeof duration === 'string' && !isNaN(parseInt(duration))) {
            return parseInt(duration);
        }
        // If it's a preset string like 'medium', map it
        return durationMap[duration] || 60;
    }
    
    /**
     * Update pacing info panel when pace or duration changes
     */
    updatePacingInfo() {
        const pace = this.formData.pace || document.getElementById('pace')?.value || 'balanced';
        const durationRaw = this.formData.duration || document.getElementById('duration')?.value || 'medium';
        const duration = this.durationToSeconds(durationRaw);
        
        const paceInfo = this.calculatePaceInfo(pace, duration);
        
        // Update displays
        const sceneCountEl = document.getElementById('pacing-scene-count');
        const avgDurationEl = document.getElementById('pacing-avg-duration');
        const readabilityEl = document.getElementById('pacing-readability');
        const renderLoadEl = document.getElementById('pacing-render-load');
        const warningPanel = document.querySelector('.pacing-info-warning');
        
        if (sceneCountEl) sceneCountEl.textContent = paceInfo.sceneCount;
        if (avgDurationEl) avgDurationEl.textContent = `${paceInfo.avgDuration}s`;
        if (readabilityEl) {
            readabilityEl.textContent = paceInfo.readabilityLabel;
            readabilityEl.className = `pacing-info-item__value pacing-info-item__value--${paceInfo.readabilityRisk}`;
        }
        if (renderLoadEl) renderLoadEl.textContent = paceInfo.renderLoad;
        
        // Update warning
        const pacingPanel = document.getElementById('pacing-info');
        if (pacingPanel) {
            const existingWarning = pacingPanel.querySelector('.pacing-info-warning');
            if (existingWarning) existingWarning.remove();
            
            if (paceInfo.warning) {
                const warningEl = document.createElement('div');
                warningEl.className = 'pacing-info-warning';
                warningEl.innerHTML = `<span class="pacing-info-warning__icon">⚠️</span> ${paceInfo.warning}`;
                pacingPanel.appendChild(warningEl);
            }
        }
        
        // Update manual scene count slider bounds if it exists
        const manualSlider = document.getElementById('manualSceneCount');
        if (manualSlider) {
            manualSlider.min = paceInfo.clamp.min;
            manualSlider.max = paceInfo.clamp.max;
            manualSlider.value = paceInfo.sceneCount;
            document.getElementById('manual-scene-value').textContent = paceInfo.sceneCount;
            
            // Update hint
            const hint = manualSlider.closest('.form-group')?.querySelector('.form-hint');
            if (hint) {
                hint.textContent = `Platform limit: ${paceInfo.clamp.min}-${paceInfo.clamp.max} scenes for ${duration}s ${this.targetPlatform}`;
            }
        }
        
        // Store derived scene count
        this.formData.derivedSceneCount = paceInfo.sceneCount;
    }

    updateCostEstimate() {
        const settings = this.collectFormData();
        const cost = this.template.calculateCost?.(settings) || { story: 0.01, voice: 0.05, images: 0, total: 0.06 };
        
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

    // ==================== STEP 2: STORY ====================

    renderStoryStep(container) {
        console.log('renderStoryStep - formData:', this.formData);
        console.log('renderStoryStep - sceneBuilder.scenes:', this.sceneBuilder.scenes);
        
        // Generate a title if not set
        const title = this.formData.title || this.generateTitle();
        
        // Get the content - handle array case
        let content = this.formData.content || '';
        if (Array.isArray(content)) {
            content = content.map(s => typeof s === 'string' ? s : s.text || '').join(' ');
        }
        
        // Get generation details for display
        const genDetails = this.formData.generationDetails || {};
        const storyPrompt = genDetails.story_prompt || 'No prompt available';
        
        // Calculate total duration estimate
        const totalWords = this.sceneBuilder.scenes.reduce((sum, s) => sum + (s.text?.split(' ').length || 0), 0);
        const estimatedDuration = Math.round(totalWords / 2.5); // ~2.5 words per second
        
        // Check for density warning
        const densityWarning = this.formData.densityWarning;
        const currentSceneCount = this.sceneBuilder.scenes.length;
        
        // Determine if auto-adjust button should be shown
        const showAutoAdjustButton = densityWarning && 
            densityWarning.action !== 'at_limit' && 
            densityWarning.action !== 'ok' &&
            densityWarning.adjustedSceneCount !== currentSceneCount;
        
        container.innerHTML = `
            <div class="create-card story-review-card">
                <!-- Density Warning (if applicable) -->
                ${densityWarning && densityWarning.action !== 'ok' ? `
                <div class="density-warning density-warning--${densityWarning.action}">
                    <span class="density-warning__icon">${densityWarning.action === 'story_short' ? '📉' : densityWarning.action === 'at_limit' ? '⚠️' : '📈'}</span>
                    <div class="density-warning__content">
                        <strong>${densityWarning.action === 'story_short' ? 'Story is too sparse' : densityWarning.action === 'at_limit' ? 'At scene limit' : 'Story is too dense'}</strong>
                        <p>${densityWarning.message}</p>
                        <div class="density-warning__stats">
                            <span>Words: ${densityWarning.storyWords}</span>
                            <span>Ideal: ~${densityWarning.idealTotalWords}</span>
                            <span>Density: ${(densityWarning.densityRatio * 100).toFixed(0)}%</span>
                            <span>Current: ${currentSceneCount} scenes</span>
                        </div>
                    </div>
                    ${showAutoAdjustButton ? `
                    <button type="button" class="btn btn--sm btn--outline" id="btn-auto-adjust-scenes">
                        🔧 Auto-Adjust (${currentSceneCount} → ${densityWarning.adjustedSceneCount} scenes)
                    </button>
                    ` : densityWarning.action === 'at_limit' ? `
                    <span class="density-warning__limit-badge">🔒 Max scenes</span>
                    ` : ''}
                </div>
                ` : ''}
                
                <!-- Story Header -->
                <div class="story-header">
                    <div class="story-header__title">
                        <input type="text" id="content-title" class="story-title-input" value="${this.escapeHtml(title)}" placeholder="Enter a title...">
                    </div>
                    <div class="story-header__meta">
                        <span class="story-meta-badge story-meta-badge--scenes">🎬 ${this.sceneBuilder.scenes.length} scenes</span>
                        <span class="story-meta-badge story-meta-badge--words">📝 ~${totalWords} words</span>
                        <span class="story-meta-badge story-meta-badge--duration">⏱️ ~${estimatedDuration}s</span>
                    </div>
                </div>
                
                <!-- Full Story Text (collapsible) -->
                <div class="full-story-panel">
                    <button type="button" class="full-story-toggle" id="toggle-full-story">
                        <span class="full-story-toggle__icon">📜</span>
                        <span class="full-story-toggle__text">Full Story Text</span>
                        <span class="full-story-toggle__hint">Click to view complete narration</span>
                        <span class="full-story-toggle__arrow" id="full-story-arrow">▼</span>
                    </button>
                    <div class="full-story-content" id="full-story-content" style="display: none;">
                        <div class="full-story-text">
                            ${this.escapeHtml(content || this.sceneBuilder.scenes.map(s => s.text).join(' '))}
                        </div>
                        <button type="button" class="btn btn--sm btn--outline" id="btn-copy-story">
                            📋 Copy Story Text
                        </button>
                    </div>
                </div>
                
                <!-- Scene Timeline View -->
                <div class="scene-timeline">
                    <div class="scene-timeline__header">
                        <span class="scene-timeline__col scene-timeline__col--num">#</span>
                        <span class="scene-timeline__col scene-timeline__col--duration">Duration</span>
                        <span class="scene-timeline__col scene-timeline__col--voice">Voice Line</span>
                        <span class="scene-timeline__col scene-timeline__col--readability">📖</span>
                        <span class="scene-timeline__col scene-timeline__col--visual">Visual Beat</span>
                    </div>
                    <div class="scene-timeline__body" id="scene-timeline-body">
                        ${this.sceneBuilder.scenes.map((scene, i) => {
                            const wordCount = scene.text?.split(/\s+/).filter(w => w).length || 0;
                            // Calculate scene duration from actual word count (not target duration)
                            // Using ~2.3 words per second (average TTS speaking rate)
                            const sceneDuration = (wordCount / PACING_CONSTANTS.wps).toFixed(1);
                            const visualBeat = this.extractVisualBeat(scene);
                            
                            // Build caption and get readability status
                            const caption = this.buildCaption(scene.text || '', parseFloat(sceneDuration));
                            const readabilityIcon = caption.readabilityStatus === 'critical' ? '🔴' : 
                                                   caption.readabilityStatus === 'warning' ? '🟡' : '✅';
                            const readabilityTitle = caption.warnings.length > 0 ? caption.warnings.join(', ') : 'Good readability';
                            
                            return `
                            <div class="scene-timeline__row scene-timeline__row--${caption.readabilityStatus}" data-scene-id="${scene.id}">
                                <span class="scene-timeline__num">${i + 1}</span>
                                <span class="scene-timeline__duration">${sceneDuration}s</span>
                                <div class="scene-timeline__voice">
                                    <textarea class="scene-voice-input" data-scene-id="${scene.id}" rows="2">${this.escapeHtml(scene.text || '')}</textarea>
                                </div>
                                <span class="scene-timeline__readability" title="${readabilityTitle}">${readabilityIcon}</span>
                                <span class="scene-timeline__visual">${visualBeat}</span>
                            </div>
                            `;
                        }).join('')}
                    </div>
                </div>
                
                <!-- Readability Summary -->
                ${(() => {
                    const durationSec = parseInt(this.formData.duration) || 60;
                    const readabilityCheck = this.checkScenesReadability(this.sceneBuilder.scenes, durationSec);
                    const summary = readabilityCheck.summary;
                    if (summary.overallStatus !== 'ok') {
                        return `
                        <div class="readability-summary readability-summary--${summary.overallStatus}">
                            <span class="readability-summary__icon">${summary.overallStatus === 'critical' ? '⚠️' : '💡'}</span>
                            <span class="readability-summary__text">
                                ${summary.critical > 0 ? `${summary.critical} scenes have fast pacing.` : ''}
                                ${summary.warning > 0 ? `${summary.warning} scenes have tight timing.` : ''}
                                Consider shortening text or adjusting scene count.
                            </span>
                            <button type="button" class="btn btn--sm btn--outline" id="btn-resplit-scenes" title="Re-split scenes using smart algorithm">
                                🔄 Re-split
                            </button>
                        </div>
                        `;
                    }
                    return '';
                })()}
                
                <!-- Story DNA Panel (collapsed by default) -->
                <div class="story-dna-panel">
                    <button type="button" class="story-dna-toggle" id="toggle-story-dna">
                        <span class="story-dna-toggle__icon">🧠</span>
                        <span class="story-dna-toggle__text">Story DNA</span>
                        <span class="story-dna-toggle__hint">Narrative fingerprint</span>
                        <span class="story-dna-toggle__arrow" id="story-dna-arrow">▼</span>
                    </button>
                    <div class="story-dna-content" id="story-dna-content" style="display: none;">
                        <div class="story-dna-grid">
                            <div class="story-dna-item">
                                <span class="story-dna-label">Weird Axis</span>
                                <span class="story-dna-value">${genDetails.weird_axis || 'Environmental'}</span>
                            </div>
                            <div class="story-dna-item">
                                <span class="story-dna-label">Repeating Detail</span>
                                <span class="story-dna-value">${genDetails.repeating_detail || 'Scratching sounds'}</span>
                            </div>
                            <div class="story-dna-item">
                                <span class="story-dna-label">Authority Mode</span>
                                <span class="story-dna-value">${genDetails.authority_mode || 'First-person witness'}</span>
                            </div>
                            <div class="story-dna-item">
                                <span class="story-dna-label">Era</span>
                                <span class="story-dna-value">${genDetails.era || this.formData.era || '1990s'}</span>
                            </div>
                            <div class="story-dna-item">
                                <span class="story-dna-label">Ending Type</span>
                                <span class="story-dna-value">${genDetails.ending || this.formData.ending || 'Unresolved'}</span>
                            </div>
                            <div class="story-dna-item">
                                <span class="story-dna-label">Tone</span>
                                <span class="story-dna-value">${this.getToneLabel(genDetails.tone || this.formData.tone || 0.6)}</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Generation Prompt Section (always visible, collapsed by default) -->
                <div class="generation-prompt-panel">
                    <button type="button" class="generation-prompt-toggle" id="toggle-generation-prompt">
                        <span class="generation-prompt-toggle__icon">📝</span>
                        <span class="generation-prompt-toggle__text">Story Generation Prompt</span>
                        <span class="generation-prompt-toggle__hint">View the prompt used to generate this story</span>
                        <span class="generation-prompt-toggle__arrow" id="generation-prompt-arrow">▼</span>
                    </button>
                    <div class="generation-prompt-content" id="generation-prompt-content" style="display: none;">
                        <pre class="generation-prompt-display">${this.escapeHtml(storyPrompt)}</pre>
                        <div class="generation-prompt-actions">
                            <button type="button" class="btn btn--sm btn--outline" id="btn-copy-generation-prompt">
                                📋 Copy Prompt
                            </button>
                            ${this.advancedMode ? `
                            <button type="button" class="btn btn--sm btn--outline" id="btn-edit-generation-prompt">
                                ✏️ Edit Prompt
                            </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
                
                <!-- Story Actions -->
                <div class="story-actions">
                    <button type="button" class="btn btn--outline" id="btn-regenerate-story" title="Generate a new story with same settings">
                        🔄 Regenerate Story
                    </button>
                    ${this.advancedMode ? `
                    <button type="button" class="btn btn--outline" id="btn-edit-prompt" title="Edit the generation prompt">
                        ✏️ Edit Prompt
                    </button>
                    ` : ''}
                    <button type="button" class="btn btn--primary" id="btn-approve-story" title="Lock story and proceed to Visual DNA">
                        ✅ Approve Story
                    </button>
                </div>
                
                <!-- Story Debug Panel (shown when debug mode enabled) -->
                <div id="story-debug-panel-container"></div>
            </div>
        `;

        // Setup story step listeners
        this.setupStoryStepListeners();
        
        // Render debug panel if enabled
        this.renderDebugPanel(genDetails);
    }
    
    /**
     * Render the Story Debug Panel if debug mode is enabled
     */
    renderDebugPanel(genDetails) {
        // Check if debug is enabled
        const isDebugEnabled = StoryDebugPanel?.isDebugEnabled?.() || this.debugMode;
        
        // Also auto-show if there's a compliance failure or legacy fallback
        const storyDebug = genDetails?.story_debug;
        const hasFailure = storyDebug && (
            !storyDebug.compliance?.passed ||
            storyDebug.method?.generation_method === 'legacy_fallback' ||
            storyDebug.compliance?.hard_failures?.length > 0
        );
        
        if (!isDebugEnabled && !hasFailure) {
            return;
        }
        
        const container = document.getElementById('story-debug-panel-container');
        if (!container) return;
        
        try {
            // Create debug panel
            const panel = new StoryDebugPanel(genDetails, {
                autoExpand: hasFailure,
                showCopyButtons: true
            });
            
            // Render and append
            const panelElement = panel.render();
            container.appendChild(panelElement);
            
            // Setup interactivity (tabs, copy buttons, etc.)
            panel.setupInteractivity();
            
            // Log to console for debug
            if (this.debugMode) {
                console.log('[DEBUG] Story Debug Panel rendered', {
                    debugEnabled: isDebugEnabled,
                    hasFailure,
                    storyDebug,
                    visualReadiness: genDetails?.visual_readiness
                });
            }
        } catch (error) {
            console.error('[DEBUG] Failed to render debug panel:', error);
            // Fail soft - don't break the UI
            container.innerHTML = `
                <div class="story-debug-panel" style="padding: 1rem; border: 1px solid #ef4444; border-radius: 8px; margin-top: 1rem;">
                    <p style="color: #ef4444;">⚠️ Debug panel failed to render: ${error.message}</p>
                </div>
            `;
        }
    }
    
    extractVisualBeat(scene) {
        // Extract visual beat from scene - could be mood, setting, or generated description
        if (scene.visualBeat) return scene.visualBeat;
        if (scene.mood) return scene.mood;
        // Generate from first few words
        const words = (scene.text || '').split(' ').slice(0, 4).join(' ');
        return words ? words + '...' : 'Visual pending';
    }
    
    setupStoryStepListeners() {
        // Scene voice input changes
        document.querySelectorAll('.scene-voice-input').forEach(textarea => {
            textarea.addEventListener('input', (e) => {
                const sceneId = parseInt(e.target.dataset.sceneId);
                this.sceneBuilder.updateScene(sceneId, { text: e.target.value });
            });
        });
        
        // Title input
        document.getElementById('content-title')?.addEventListener('input', (e) => {
            this.formData.title = e.target.value;
        });
        
        // Full story toggle
        document.getElementById('toggle-full-story')?.addEventListener('click', () => {
            const content = document.getElementById('full-story-content');
            const arrow = document.getElementById('full-story-arrow');
            if (content) {
                const isHidden = content.style.display === 'none';
                content.style.display = isHidden ? 'block' : 'none';
                if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
            }
        });
        
        // Copy story text
        document.getElementById('btn-copy-story')?.addEventListener('click', () => {
            const storyText = this.sceneBuilder.scenes.map(s => s.text).join('\n\n');
            navigator.clipboard.writeText(storyText).then(() => {
                this.addConsoleLog('📋 Story text copied to clipboard!', 'success');
            }).catch(err => {
                console.error('Copy failed:', err);
                this.addConsoleLog('❌ Failed to copy story text', 'error');
            });
        });
        
        // Story DNA toggle
        document.getElementById('toggle-story-dna')?.addEventListener('click', () => {
            const content = document.getElementById('story-dna-content');
            const arrow = document.getElementById('story-dna-arrow');
            if (content) {
                const isHidden = content.style.display === 'none';
                content.style.display = isHidden ? 'block' : 'none';
                if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
            }
        });
        
        // Generation Prompt toggle
        document.getElementById('toggle-generation-prompt')?.addEventListener('click', () => {
            const content = document.getElementById('generation-prompt-content');
            const arrow = document.getElementById('generation-prompt-arrow');
            if (content) {
                const isHidden = content.style.display === 'none';
                content.style.display = isHidden ? 'block' : 'none';
                if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
            }
        });
        
        // Copy generation prompt
        document.getElementById('btn-copy-generation-prompt')?.addEventListener('click', () => {
            const genDetails = this.formData.generationDetails || {};
            const storyPrompt = genDetails.story_prompt || 'No prompt available';
            navigator.clipboard.writeText(storyPrompt).then(() => {
                this.addConsoleLog('📋 Story prompt copied to clipboard!', 'success');
            }).catch(err => {
                console.error('Copy failed:', err);
                this.addConsoleLog('❌ Failed to copy story prompt', 'error');
            });
        });
        
        // Regenerate story
        document.getElementById('btn-regenerate-story')?.addEventListener('click', () => {
            this.regenerateStory();
        });
        
        // Approve story (locks and advances)
        document.getElementById('btn-approve-story')?.addEventListener('click', () => {
            this.approveStory();
        });
        
        // Edit prompt (advanced)
        document.getElementById('btn-edit-prompt')?.addEventListener('click', () => {
            this.showPromptEditor();
        });
        
        // Re-split scenes using smart algorithm
        document.getElementById('btn-resplit-scenes')?.addEventListener('click', () => {
            this.resplitScenes();
        });
        
        // Auto-adjust scenes based on density warning
        document.getElementById('btn-auto-adjust-scenes')?.addEventListener('click', () => {
            this.autoAdjustScenesFromWarning();
        });
    }
    
    /**
     * Auto-adjust scenes based on the density warning recommendation
     * Shows before/after scene count and debug info
     */
    autoAdjustScenesFromWarning() {
        const densityWarning = this.formData.densityWarning;
        if (!densityWarning) {
            this.showError('No density adjustment needed');
            return;
        }
        
        const currentSceneCount = this.sceneBuilder.scenes.length;
        const targetSceneCount = densityWarning.adjustedSceneCount;
        
        // Log debug info
        this.addConsoleLog(`🔧 Auto-Adjust Debug:`, 'info');
        this.addConsoleLog(`   Words: ${densityWarning.storyWords}`, 'info');
        this.addConsoleLog(`   Ideal words: ${densityWarning.idealTotalWords}`, 'info');
        this.addConsoleLog(`   Density: ${(densityWarning.densityRatio * 100).toFixed(0)}%`, 'info');
        this.addConsoleLog(`   Current scenes: ${currentSceneCount}`, 'info');
        this.addConsoleLog(`   Target scenes: ${targetSceneCount}`, 'info');
        this.addConsoleLog(`   Action: ${densityWarning.action}`, 'info');
        
        // Sanity check for "too dense" - ensure we INCREASE scenes
        if (densityWarning.action === 'story_long' && targetSceneCount <= currentSceneCount) {
            this.addConsoleLog(`⚠️ Warning: Dense story but target (${targetSceneCount}) <= current (${currentSceneCount}). Forcing increase.`, 'warning');
            // Force at least +50% more scenes for dense stories
            const forcedTarget = Math.max(targetSceneCount, Math.ceil(currentSceneCount * 1.5));
            densityWarning.adjustedSceneCount = Math.min(40, forcedTarget); // Cap at 40
        }
        
        // Sanity check for "too sparse" - ensure we DECREASE scenes
        if (densityWarning.action === 'story_short' && targetSceneCount >= currentSceneCount) {
            this.addConsoleLog(`⚠️ Warning: Sparse story but target (${targetSceneCount}) >= current (${currentSceneCount}). Forcing decrease.`, 'warning');
            // Force fewer scenes for sparse stories
            const forcedTarget = Math.min(targetSceneCount, Math.ceil(currentSceneCount * 0.7));
            densityWarning.adjustedSceneCount = Math.max(6, forcedTarget); // Min of 6
        }
        
        const finalTargetScenes = densityWarning.adjustedSceneCount;
        this.addConsoleLog(`🔧 Adjusting: ${currentSceneCount} → ${finalTargetScenes} scenes...`, 'info');
        
        // Combine all scene text into one story
        const fullText = this.sceneBuilder.scenes
            .map(s => s.text || '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        // Use the splitting algorithm with adjusted scene count
        const pace = this.formData.pace || 'balanced';
        const durationSec = parseInt(this.formData.duration) || 60;
        
        const newScenes = this.splitIntoScenes(fullText, {
            durationSec,
            targetScenes: finalTargetScenes,
            wps: PACING_CONSTANTS.wps,
            minSceneSec: PACING_CONSTANTS.minSceneSec,
            maxSceneSec: PACING_CONSTANTS.maxSceneSec
        });
        
        // SAFETY GUARD: For dense stories, result must increase
        if (densityWarning.action === 'story_long' && newScenes.length <= currentSceneCount) {
            const errorDetail = {
                action: densityWarning.action,
                storyWords: densityWarning.storyWords,
                densityRatio: densityWarning.densityRatio,
                currentSceneCount,
                targetSceneCount: finalTargetScenes,
                actualResult: newScenes.length,
                fullTextWords: fullText.split(/\s+/).filter(w => w).length
            };
            console.error(`[AUTO-ADJUST FAILURE] Dense story but scene count did not increase!`, errorDetail);
            this.addConsoleLog(`❌ ERROR: Dense story but scenes decreased! ${currentSceneCount} → ${newScenes.length} (target was ${finalTargetScenes})`, 'error');
            this.addConsoleLog(`   Debug: ${JSON.stringify(errorDetail)}`, 'error');
            // Don't apply the change - it's wrong
            this.showError('Auto-adjust failed - could not increase scenes. Check console for details.');
            return;
        }
        
        // SAFETY GUARD: For sparse stories, result must decrease
        if (densityWarning.action === 'story_short' && newScenes.length >= currentSceneCount) {
            const errorDetail = {
                action: densityWarning.action,
                storyWords: densityWarning.storyWords,
                densityRatio: densityWarning.densityRatio,
                currentSceneCount,
                targetSceneCount: finalTargetScenes,
                actualResult: newScenes.length,
                fullTextWords: fullText.split(/\s+/).filter(w => w).length
            };
            console.error(`[AUTO-ADJUST FAILURE] Sparse story but scene count did not decrease!`, errorDetail);
            this.addConsoleLog(`❌ ERROR: Sparse story but scenes increased! ${currentSceneCount} → ${newScenes.length} (target was ${finalTargetScenes})`, 'error');
            this.addConsoleLog(`   Debug: ${JSON.stringify(errorDetail)}`, 'error');
            // Don't apply the change - it's wrong
            this.showError('Auto-adjust failed - could not decrease scenes. Check console for details.');
            return;
        }
        
        // Convert to scene builder format
        this.sceneBuilder.scenes = newScenes.map((scene, i) => ({
            id: i + 1,
            text: scene.text,
            mood: 'neutral',
            wordCount: scene.wordCount
        }));
        
        // Clear the warning since we addressed it
        this.formData.densityWarning = null;
        
        // Show result with before/after
        const resultMsg = `✅ Adjusted: ${currentSceneCount} → ${newScenes.length} scenes`;
        this.addConsoleLog(resultMsg, 'success');
        
        // Re-render the story step
        const container = document.getElementById('step-content');
        if (container) {
            this.renderStoryStep(container);
        }
    }
    
    /**
     * Re-split the story into scenes using the smart pacing algorithm
     */
    resplitScenes() {
        this.addConsoleLog('🔄 Re-splitting scenes...', 'info');
        
        // Combine all scene text into one story
        const fullText = this.sceneBuilder.scenes
            .map(s => s.text || '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        if (!fullText) {
            this.showError('No story text to re-split');
            return;
        }
        
        // Get pacing settings
        const pace = this.formData.pace || 'balanced';
        const durationSec = parseInt(this.formData.duration) || 60;
        
        // Use the smart splitting algorithm
        const newScenes = this.splitIntoScenes(fullText, {
            durationSec,
            pace,
            wps: PACING_CONSTANTS.wps,
            minSceneSec: PACING_CONSTANTS.minSceneSec,
            maxSceneSec: PACING_CONSTANTS.maxSceneSec
        });
        
        // Convert to scene builder format
        this.sceneBuilder.scenes = newScenes.map((scene, i) => ({
            id: i + 1,
            text: scene.text,
            mood: 'neutral', // Will be re-derived
            wordCount: scene.wordCount
        }));
        
        this.addConsoleLog(`✅ Re-split into ${newScenes.length} scenes`, 'success');
        
        // Re-render the story step
        const container = document.getElementById('step-content');
        if (container) {
            this.renderStoryStep(container);
        }
    }
    
    async regenerateStory() {
        if (!this.jobId) {
            this.showError('No job found — please start a new content creation first.');
            return;
        }

        // Confirm before regenerating
        if (!confirm('This will generate a completely new story. Your current story text will be replaced. Continue?')) {
            return;
        }

        this.addConsoleLog('🔄 Regenerating story with same settings...', 'info');
        const stepContent = document.getElementById('step-content');

        try {
            // Show loading state
            this.showStepLoading(stepContent, 'Regenerating story...');

            // Re-run preview mode on the same job — server generates a fresh story
            const startTime = performance.now();
            const previewResponse = await runPreviewMode(this.jobId);
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

            // Update stored data with new story
            this.formData.title = previewResponse.title || this.formData.title;
            this.formData.content = previewResponse.story_text || '';
            this.formData.sceneCount = previewResponse.scenes?.length || this.formData.sceneCount;
            this.formData.generationDetails = previewResponse.generation_details || this.formData.generationDetails;

            // Update visual DNA if returned
            if (previewResponse.generation_details?.visual_dna) {
                this.visualDNA = previewResponse.generation_details.visual_dna;
            }

            // Rebuild scene list
            if (previewResponse.scenes && previewResponse.scenes.length > 0) {
                this.sceneBuilder.scenes = previewResponse.scenes.map((scene, i) => ({
                    id: i + 1,
                    text: scene.text || scene,
                    mood: scene.mood || 'neutral',
                    wordCount: (scene.text || scene).split(' ').length,
                    imagePrompt: scene.image_prompt || null,
                    imageUrl: null  // Clear old images — they belong to old story
                }));
            }

            // Unlock story for further editing
            this.storyLocked = false;
            this.formData.storyApproved = false;

            this.addConsoleLog(`✅ Story regenerated in ${elapsed}s — ${this.sceneBuilder.scenes.length} scenes`, 'success');
            if (typeof toast !== 'undefined') toast.success('Story regenerated successfully');

            // Re-render the story step
            if (stepContent) this.renderStoryStep(stepContent);
        } catch (error) {
            console.error('Story regeneration failed:', error);
            this.addConsoleLog(`❌ Regeneration failed: ${error.message}`, 'error');
            this.showError(`Story regeneration failed: ${error.message}`);
            // Re-render to recover from loading state
            if (stepContent) this.renderStoryStep(stepContent);
        }
    }
    
    approveStory() {
        this.addConsoleLog('✅ Story approved, locking visual world', 'success');
        this.formData.storyApproved = true;
        this.storyLocked = true; // Lock story after approval
        // Auto-advance to Visual DNA step
        this.nextStep();
    }
    
    showPromptEditor() {
        const genDetails = this.formData.generationDetails || {};
        const currentPrompt = genDetails.story_prompt || 'No prompt available';

        // Create a simple modal overlay for editing the prompt
        const overlay = document.createElement('div');
        overlay.className = 'prompt-editor-overlay';
        overlay.innerHTML = `
            <div class="prompt-editor-modal">
                <div class="prompt-editor-header">
                    <h3>Story Generation Prompt</h3>
                    <button class="prompt-editor-close" id="close-prompt-editor">&times;</button>
                </div>
                <textarea class="prompt-editor-textarea" id="prompt-editor-text" rows="18">${this.escapeHtml(currentPrompt)}</textarea>
                <div class="prompt-editor-footer">
                    <span class="prompt-editor-hint">Edit the prompt, then regenerate the story to use it.</span>
                    <div class="prompt-editor-actions">
                        <button class="btn btn--sm btn--secondary" id="prompt-editor-cancel">Cancel</button>
                        <button class="btn btn--sm btn--primary" id="prompt-editor-save">Save Prompt</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Close handler
        const close = () => overlay.remove();
        overlay.querySelector('#close-prompt-editor').addEventListener('click', close);
        overlay.querySelector('#prompt-editor-cancel').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        // Save handler
        overlay.querySelector('#prompt-editor-save').addEventListener('click', () => {
            const newPrompt = document.getElementById('prompt-editor-text').value.trim();
            if (newPrompt) {
                if (!this.formData.generationDetails) this.formData.generationDetails = {};
                this.formData.generationDetails.story_prompt = newPrompt;
                this.addConsoleLog('✏️ Prompt updated — regenerate story to apply changes', 'info');
                if (typeof toast !== 'undefined') toast.success('Prompt saved');
            }
            close();
        });
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
        const approvedCount = this.sceneBuilder.scenes.filter(s => s.approved).length;
        const totalScenes = this.sceneBuilder.scenes.length;
        const approvalPercent = totalScenes > 0 ? Math.round((approvedCount / totalScenes) * 100) : 0;
        
        container.innerHTML = `
            <div class="create-card">
                <h2 class="create-card__title">🎨 ${hasImages ? 'Review & Approve Images' : 'Generate Images'}</h2>
                <p class="create-card__subtitle">${hasImages ? 'Review each image and approve or regenerate as needed' : 'Click Continue to generate images for each scene'}</p>
                
                <!-- Image Approval Progress -->
                ${hasImages ? `
                <div class="image-approval-progress">
                    <div class="image-approval-progress__header">
                        <span class="image-approval-progress__label">Approved: ${approvedCount}/${totalScenes}</span>
                        <span class="image-approval-progress__percent">${approvalPercent}%</span>
                    </div>
                    <div class="image-approval-progress__bar">
                        <div class="image-approval-progress__fill" style="width: ${approvalPercent}%"></div>
                    </div>
                    <div class="image-approval-progress__actions">
                        <button type="button" class="btn btn--outline btn--small" id="btn-approve-all">
                            ✅ Approve All
                        </button>
                        <button type="button" class="btn btn--outline btn--small" id="btn-lock-all-images">
                            🔒 Lock All Approved
                        </button>
                    </div>
                </div>
                ` : ''}
                
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
                        <div class="image-preview-card ${scene.imageUrl ? 'image-preview-card--loaded' : ''} ${scene.approved ? 'image-preview-card--approved' : ''} ${scene.locked ? 'image-preview-card--locked' : ''}" data-scene-id="${scene.id}">
                            ${scene.imageUrl 
                                ? `<img src="${scene.imageUrl}" class="image-preview-card__img" alt="Scene ${i + 1}">`
                                : `<div class="image-preview-card__placeholder">
                                    <span class="image-preview-card__placeholder-icon">🎬</span>
                                    <span>Scene ${i + 1}</span>
                                </div>`
                            }
                            <div class="image-preview-card__overlay">
                                <span class="image-preview-card__number">Scene ${i + 1}</span>
                                ${scene.locked ? '<span class="image-preview-card__lock-badge">🔒</span>' : ''}
                                ${scene.approved ? '<span class="image-preview-card__approved-badge">✅</span>' : ''}
                            </div>
                            ${scene.imageUrl ? `
                            <div class="image-preview-card__actions">
                                <button type="button" class="image-action-btn image-action-btn--approve ${scene.approved ? 'image-action-btn--active' : ''}" data-action="approve" title="Approve this image">
                                    ✅
                                </button>
                                <button type="button" class="image-action-btn image-action-btn--regenerate" data-action="regenerate" title="Regenerate this image">
                                    🔄
                                </button>
                                ${this.advancedMode ? `
                                <button type="button" class="image-action-btn image-action-btn--edit" data-action="edit" title="Edit prompt (Advanced)">
                                    ✏️
                                </button>
                                ` : ''}
                                <button type="button" class="image-action-btn image-action-btn--lock ${scene.locked ? 'image-action-btn--active' : ''}" data-action="lock" title="Lock this image">
                                    🔒
                                </button>
                            </div>
                            ` : ''}
                            <p class="image-preview-card__text">${scene.text.substring(0, 80)}${scene.text.length > 80 ? '...' : ''}</p>
                        </div>
                    `).join('')}
                </div>
                
                <!-- Image Prompts Log (collapsible) -->
                <div class="image-log-panel">
                    <button type="button" class="image-log-toggle" id="toggle-image-log">
                        <span class="image-log-toggle__icon">📋</span>
                        <span class="image-log-toggle__text">Image Prompts Log</span>
                        <span class="image-log-toggle__hint">View narration & prompts for each scene</span>
                        <span class="image-log-toggle__arrow" id="image-log-arrow">▼</span>
                    </button>
                    <div class="image-log-content" id="image-log-content" style="display: none;">
                        <div class="image-log-list">
                            ${this.sceneBuilder.scenes.map((scene, i) => `
                                <div class="image-log-item">
                                    <div class="image-log-item__header">
                                        <span class="image-log-item__number">Scene ${i + 1}</span>
                                        ${scene.imageUrl ? '<span class="image-log-item__status image-log-item__status--done">✅</span>' : '<span class="image-log-item__status image-log-item__status--pending">⏳</span>'}
                                    </div>
                                    <div class="image-log-item__section">
                                        <span class="image-log-item__label">Narration:</span>
                                        <p class="image-log-item__text">${this.escapeHtml(scene.text || '')}</p>
                                    </div>
                                    <div class="image-log-item__section">
                                        <span class="image-log-item__label">Image Prompt:</span>
                                        <p class="image-log-item__prompt ${scene.promptMode?.includes('fallback') || scene.promptMode?.includes('keywords') ? 'prompt-fallback' : ''}">${this.escapeHtml(scene.imagePrompt || scene.image_prompt || scene.visual || 'Not yet generated')}</p>
                                        ${scene.promptMode && scene.promptLen ? `<p class="image-log-item__meta" style="font-size: 0.75rem; color: #888; margin-top: 4px;">📊 Mode: <code>${scene.promptMode}</code> | Length: <code>${scene.promptLen}</code> chars${scene.imageDetails?.relevance_score ? ` | Relevance: <code style="color: ${scene.imageDetails.relevance_score >= 0.65 ? '#22c55e' : '#f59e0b'}">${(scene.imageDetails.relevance_score * 100).toFixed(0)}%</code>${scene.imageDetails.relevance_repaired ? ' 🔧' : ''}` : ''}</p>` : scene.promptMode === 'keywords_fallback' ? `<p class="image-log-item__meta" style="font-size: 0.75rem; color: #f59e0b; margin-top: 4px;">⚠️ Using keywords only (full prompt pending)</p>` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                        <button type="button" class="btn btn--sm btn--outline" id="btn-copy-image-log">
                            📋 Copy All to Clipboard
                        </button>
                    </div>
                </div>
                
                ${!hasImages ? `
                <div class="image-step-note">
                    <span class="note-icon">⚡</span>
                    <span>Click "Continue" to start generating images. You'll see them appear in real-time!</span>
                </div>
                ` : `
                <div class="image-step-note">
                    <span class="note-icon">💡</span>
                    <span>${approvedCount >= Math.ceil(totalScenes * 0.8) ? 'Ready to proceed! You have 80%+ images approved.' : `Approve at least ${Math.ceil(totalScenes * 0.8)} images to continue.`}</span>
                </div>
                `}
            </div>
        `;
        
        // Setup image step listeners
        this.setupImageStepListeners();
    }
    
    setupImageStepListeners() {
        // Per-scene action buttons
        document.querySelectorAll('.image-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const card = e.target.closest('[data-scene-id]');
                const sceneId = parseInt(card.dataset.sceneId);
                const action = e.target.dataset.action;
                
                switch (action) {
                    case 'approve':
                        this.toggleSceneApproval(sceneId);
                        break;
                    case 'regenerate':
                        this.regenerateSceneImage(sceneId);
                        break;
                    case 'edit':
                        this.editScenePrompt(sceneId);
                        break;
                    case 'lock':
                        this.toggleSceneLock(sceneId);
                        break;
                }
            });
        });
        
        // Approve all button
        document.getElementById('btn-approve-all')?.addEventListener('click', () => this.approveAllImages());
        
        // Lock all approved button
        document.getElementById('btn-lock-all-images')?.addEventListener('click', () => this.lockAllApprovedImages());
        
        // Image log toggle
        document.getElementById('toggle-image-log')?.addEventListener('click', () => {
            const content = document.getElementById('image-log-content');
            const arrow = document.getElementById('image-log-arrow');
            if (content) {
                const isHidden = content.style.display === 'none';
                content.style.display = isHidden ? 'block' : 'none';
                if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
            }
        });
        
        // Copy image log button
        document.getElementById('btn-copy-image-log')?.addEventListener('click', () => {
            // Debug: log what we have
            console.log('[COPY-LOG] Scenes data:', this.sceneBuilder.scenes.map(s => ({
                id: s.id,
                hasImageDetails: !!s.imageDetails,
                imageDetailsKeys: s.imageDetails ? Object.keys(s.imageDetails) : [],
                art_style: s.imageDetails?.art_style,
                art_style_override: s.imageDetails?.art_style_override,
                visual_dna_suppressed: s.imageDetails?.visual_dna_suppressed,
            })));
            
            const logText = this.sceneBuilder.scenes.map((scene, i) => {
                const prompt = scene.imagePrompt || scene.image_prompt || scene.visual || 'Not yet generated';
                const modeInfo = scene.promptMode && scene.promptLen ? `\n[Mode: ${scene.promptMode} | Length: ${scene.promptLen} chars]` : '';
                
                // v5.6: Add diagnostic info from imageDetails
                let diagnosticBlock = '';
                const details = scene.imageDetails || {};
                
                // Debug: always show what we have
                console.log(`[COPY-LOG] Scene ${i+1} details:`, details);
                
                if (details.art_style || details.art_style_override || details.visual_dna_suppressed !== undefined) {
                    const lines = [
                        '',
                        '--- STYLE CONTROL DIAGNOSTICS ---',
                        `Art Style: ${details.art_style || 'default'}`,
                    ];
                    if (details.art_style_override) {
                        lines.push(`Art Style Override: ${details.art_style_override} (FORCED)`);
                    }
                    if (details.style_config) {
                        lines.push(`Style Config: ${details.style_config.name || 'unknown'}`);
                        if (details.style_config.basePrompt_preview) {
                            lines.push(`  basePrompt: ${details.style_config.basePrompt_preview}...`);
                        }
                        if (details.style_config.colorOverride_preview) {
                            lines.push(`  colorOverride: ${details.style_config.colorOverride_preview}...`);
                        }
                    }
                    if (details.visual_dna) {
                        lines.push(`Visual DNA: style=${details.visual_dna.style}, palette=${details.visual_dna.palette}`);
                    }
                    if (details.visual_dna_suppressed) {
                        lines.push(`⚠️ Visual DNA SUPPRESSED: ${details.visual_dna_suppressed_reason || 'art style override'}`);
                    }
                    if (details.model) {
                        lines.push(`Image Model: ${details.model}`);
                    }
                    if (details.relevance_score !== null && details.relevance_score !== undefined) {
                        const pct = (details.relevance_score * 100).toFixed(0);
                        lines.push(`Relevance Score: ${pct}%${details.relevance_repaired ? ' (repaired)' : ''}`);
                    }
                    lines.push('--- END DIAGNOSTICS ---');
                    diagnosticBlock = lines.join('\n');
                }
                
                return `=== Scene ${i + 1} ===\nNarration:\n${scene.text}\n\nImage Prompt:\n${prompt}${modeInfo}${diagnosticBlock}`;
            }).join('\n\n' + '='.repeat(40) + '\n\n');
            
            navigator.clipboard.writeText(logText).then(() => {
                this.addConsoleLog('📋 Image log copied to clipboard!', 'success');
            }).catch(err => {
                console.error('Copy failed:', err);
                this.addConsoleLog('❌ Failed to copy image log', 'error');
            });
        });
    }
    
    toggleSceneApproval(sceneId) {
        const scene = this.sceneBuilder.scenes.find(s => s.id === sceneId);
        if (scene && scene.imageUrl) {
            scene.approved = !scene.approved;
            this.addConsoleLog(`${scene.approved ? '✅' : '❌'} Scene ${sceneId} ${scene.approved ? 'approved' : 'unapproved'}`, 'info');
            this.renderCurrentStep();
        }
    }
    
    approveAllImages() {
        this.sceneBuilder.scenes.forEach(scene => {
            if (scene.imageUrl) scene.approved = true;
        });
        this.addConsoleLog('✅ All images approved', 'success');
        this.renderCurrentStep();
    }
    
    lockAllApprovedImages() {
        this.sceneBuilder.scenes.forEach(scene => {
            if (scene.approved) scene.locked = true;
        });
        this.imagesLocked = true;
        this.addConsoleLog('🔒 All approved images locked', 'success');
        this.renderCurrentStep();
    }
    
    editScenePrompt(sceneId) {
        const scene = this.sceneBuilder.scenes.find(s => s.id === sceneId);
        if (!scene) return;
        
        const newPrompt = prompt('Edit image prompt for this scene:', scene.imagePrompt || scene.text);
        if (newPrompt && newPrompt !== scene.imagePrompt) {
            scene.imagePrompt = newPrompt;
            this.addConsoleLog(`✏️ Scene ${sceneId} prompt updated`, 'info');
        }
    }
    
    async regenerateSceneImage(sceneId) {
        if (!this.jobId) {
            this.showError('No job found — please start content creation first.');
            return;
        }

        const scene = this.sceneBuilder.scenes.find(s => s.id === sceneId);
        if (!scene) {
            this.showError(`Scene ${sceneId} not found`);
            return;
        }

        if (scene.locked) {
            this.showError('Scene is locked — unlock it first to regenerate.');
            return;
        }

        this.addConsoleLog(`🔄 Regenerating image for scene ${sceneId}...`, 'info');

        // Show loading state on this scene's image card
        const imgEl = document.getElementById(`scene-image-${sceneId}`);
        if (imgEl) {
            imgEl.style.opacity = '0.4';
            imgEl.style.filter = 'blur(2px)';
        }

        try {
            // Re-run the full images phase — backend generates all pending images
            // We clear just this scene's URL so the backend treats it as needing generation
            scene.imageUrl = null;

            const imageResponse = await runJobPhase(this.jobId, 'images');
            this.addConsoleLog(`🎨 Image generation triggered for scene ${sceneId}`, 'info');

            // Poll briefly for the updated image
            let attempts = 0;
            const maxAttempts = 30;
            while (attempts < maxAttempts) {
                await new Promise(r => setTimeout(r, 3000));
                const status = await checkJob(this.jobId);

                if (status?.scenes) {
                    const updatedScene = status.scenes.find(s => (s.scene_number || s.id) === sceneId);
                    if (updatedScene?.image_url) {
                        scene.imageUrl = updatedScene.image_url;
                        this.addConsoleLog(`✅ Scene ${sceneId} image regenerated`, 'success');
                        if (typeof toast !== 'undefined') toast.success(`Scene ${sceneId} image updated`);
                        break;
                    }
                }
                attempts++;
            }

            if (!scene.imageUrl) {
                this.addConsoleLog(`⚠️ Scene ${sceneId} image not yet ready — check back shortly`, 'warning');
            }

            this.renderCurrentStep();
        } catch (error) {
            console.error(`Scene ${sceneId} image regeneration failed:`, error);
            this.addConsoleLog(`❌ Scene ${sceneId} image failed: ${error.message}`, 'error');
            this.showError(`Image regeneration failed: ${error.message}`);
            // Restore visual
            if (imgEl) { imgEl.style.opacity = '1'; imgEl.style.filter = 'none'; }
        }
    }
    
    toggleSceneLock(sceneId) {
        const scene = this.sceneBuilder.scenes.find(s => s.id === sceneId);
        if (scene) {
            scene.locked = !scene.locked;
            this.addConsoleLog(`${scene.locked ? '🔒' : '🔓'} Scene ${sceneId} ${scene.locked ? 'locked' : 'unlocked'}`, 'info');
            this.renderCurrentStep();
        }
    }

    // ==================== STEP 3: VISUAL DNA ====================

    /**
     * Format DNA field value - handles arrays, objects, and strings
     */
    formatDNAValue(value, fallback = 'Auto-selected') {
        if (!value) return fallback;
        if (Array.isArray(value)) return value.join(', ');
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    renderVisualDNAStep(container) {
        const genDetails = this.formData.generationDetails || {};
        const visualDNA = genDetails.visual_dna || this.visualDNA || {};
        const similarity = genDetails.similarity || {};
        
        // Store visualDNA for potential overrides
        if (!this.visualDNA && genDetails.visual_dna) {
            this.visualDNA = { ...genDetails.visual_dna };
        }
        
        // Determine DNA method
        const dnaMethod = genDetails.generation_method || (visualDNA.visual_style ? 'dna' : 'legacy');
        const isUnique = similarity.is_likely_unique !== false;
        
        // Format all DNA values (handles arrays)
        const styleVal = this.formatDNAValue(visualDNA.visual_style);
        const paletteVal = this.formatDNAValue(visualDNA.color_palette);
        const motionVal = this.formatDNAValue(visualDNA.motion_profile);
        const lightingVal = this.formatDNAValue(visualDNA.lighting_profile);
        const textureVal = this.formatDNAValue(visualDNA.texture_artifacts);
        const cameraVal = this.formatDNAValue(visualDNA.camera_language);
        
        container.innerHTML = `
            <div class="create-card visual-dna-card">
                <!-- DNA Status Header -->
                <div class="dna-status-header">
                    <div class="dna-method-badge dna-method-badge--${dnaMethod}">
                        ${dnaMethod === 'dna' ? '🧬 DNA Active' : '📝 Legacy Mode'}
                    </div>
                    <div class="dna-uniqueness-badge ${isUnique ? 'dna-uniqueness-badge--unique' : 'dna-uniqueness-badge--warning'}">
                        ${isUnique ? '✅ Unique' : '⚠️ Too Close'}
                    </div>
                    ${genDetails.forced_variety ? '<div class="dna-variety-badge">🎲 Variety Forced</div>' : ''}
                    <div class="dna-similarity-score" title="Higher means this looks like recent outputs. We auto-rotate safe traits to keep your feed fresh.">
                        Score: <strong>${typeof similarity.score === 'number' ? (similarity.score * 100).toFixed(1) + '%' : 'N/A'}</strong>
                        ${similarity.most_similar_title ? `
                        <span class="dna-similarity-hint" title="Most similar to: ${similarity.most_similar_title}">ℹ️</span>
                        ` : ''}
                    </div>
                </div>
                
                <!-- Live Preview Tile -->
                <div class="dna-live-preview">
                    <div class="dna-live-preview__frame">
                        ${this.sceneBuilder.scenes[0]?.imageUrl 
                            ? `<img src="${this.sceneBuilder.scenes[0].imageUrl}" alt="Preview" class="dna-live-preview__img">`
                            : `<div class="dna-live-preview__placeholder">
                                <span>🎬</span>
                                <span>Frame Preview</span>
                                <span class="dna-live-preview__placeholder-note">Available after image generation</span>
                            </div>`
                        }
                        <div class="dna-live-preview__overlay">
                            <span class="dna-live-preview__filter-label">Active Filters</span>
                        </div>
                    </div>
                    <div class="dna-live-preview__info">
                        <div class="dna-live-preview__filter-stack">
                            <h5>Filter Stack Preview</h5>
                            <ul>
                                <li><span class="filter-chip">🎨 ${styleVal}</span></li>
                                <li><span class="filter-chip">🎭 ${paletteVal}</span></li>
                                <li><span class="filter-chip">🎥 ${motionVal}</span></li>
                                <li><span class="filter-chip">💡 ${lightingVal}</span></li>
                            </ul>
                        </div>
                        <div class="dna-live-preview__budget">
                            <span class="dna-live-preview__budget-label">Render Budget Score</span>
                            <div class="dna-live-preview__budget-bar">
                                <div class="dna-live-preview__budget-fill" style="width: ${this.calculateRenderBudgetScore()}0%"></div>
                            </div>
                            <span class="dna-live-preview__budget-value">${this.calculateRenderBudgetScore()}/10</span>
                        </div>
                        <div id="dna-change-feedback" class="dna-change-feedback hidden">
                            <span class="dna-change-feedback__icon">✅</span>
                            <span class="dna-change-feedback__text">Safe change — uniqueness preserved</span>
                        </div>
                    </div>
                </div>
                
                <!-- Visual DNA Grid -->
                <div class="dna-fingerprint-grid">
                    <div class="dna-fingerprint-item dna-fingerprint-item--style">
                        <div class="dna-fingerprint-item__header">
                            <span class="dna-fingerprint-item__icon">🎨</span>
                            <span class="dna-fingerprint-item__label">Visual Style</span>
                            <span class="dna-fingerprint-item__weight">35%</span>
                        </div>
                        <span class="dna-fingerprint-item__value">${styleVal}</span>
                    </div>
                    
                    <div class="dna-fingerprint-item dna-fingerprint-item--palette">
                        <div class="dna-fingerprint-item__header">
                            <span class="dna-fingerprint-item__icon">🎭</span>
                            <span class="dna-fingerprint-item__label">Color Palette</span>
                            <span class="dna-fingerprint-item__weight">25%</span>
                        </div>
                        <span class="dna-fingerprint-item__value">${paletteVal}</span>
                    </div>
                    
                    <div class="dna-fingerprint-item dna-fingerprint-item--motion">
                        <div class="dna-fingerprint-item__header">
                            <span class="dna-fingerprint-item__icon">🎥</span>
                            <span class="dna-fingerprint-item__label">Motion Profile</span>
                            <span class="dna-fingerprint-item__weight">15%</span>
                        </div>
                        <span class="dna-fingerprint-item__value">${motionVal}</span>
                    </div>
                    
                    <div class="dna-fingerprint-item dna-fingerprint-item--lighting">
                        <div class="dna-fingerprint-item__header">
                            <span class="dna-fingerprint-item__icon">💡</span>
                            <span class="dna-fingerprint-item__label">Lighting Profile</span>
                            <span class="dna-fingerprint-item__weight">10%</span>
                        </div>
                        <span class="dna-fingerprint-item__value">${lightingVal}</span>
                    </div>
                    
                    <div class="dna-fingerprint-item dna-fingerprint-item--texture">
                        <div class="dna-fingerprint-item__header">
                            <span class="dna-fingerprint-item__icon">📺</span>
                            <span class="dna-fingerprint-item__label">Texture Artifacts</span>
                            <span class="dna-fingerprint-item__weight">15%</span>
                        </div>
                        <span class="dna-fingerprint-item__value">${textureVal}</span>
                    </div>
                    
                    <div class="dna-fingerprint-item dna-fingerprint-item--camera">
                        <div class="dna-fingerprint-item__header">
                            <span class="dna-fingerprint-item__icon">📷</span>
                            <span class="dna-fingerprint-item__label">Camera Language</span>
                            <span class="dna-fingerprint-item__weight">—</span>
                        </div>
                        <span class="dna-fingerprint-item__value">${cameraVal}</span>
                    </div>
                </div>
                
                <!-- Why Unique Explanation -->
                <div class="dna-explanation">
                    <button type="button" class="dna-explanation-toggle" id="toggle-why-unique">
                        <span>❓ Why is this unique?</span>
                        <span class="dna-explanation-arrow" id="why-unique-arrow">▼</span>
                    </button>
                    <div class="dna-explanation-content" id="why-unique-content" style="display: none;">
                        <p>The Visual DNA system ensures uniqueness through:</p>
                        <ul>
                            <li><strong>Weighted Similarity:</strong> Style (35%) + Palette (25%) + Motion (15%) + Lighting (10%) + Texture (15%)</li>
                            <li><strong>Half-life Decay:</strong> Recent videos have more influence (48h = 50% decay)</li>
                            <li><strong>Variety Forcing:</strong> After 3 failed attempts, rare combinations are selected</li>
                            ${genDetails.forced_variety ? '<li><strong>⚠️ Variety Forced:</strong> This video used forced variety selection</li>' : ''}
                        </ul>
                    </div>
                </div>
                
                <!-- Soft Override Buttons -->
                <div class="dna-overrides">
                    <h4 class="dna-overrides__title">🔧 Safe Adjustments</h4>
                    <p class="dna-overrides__hint">These won't break uniqueness - just subtle shifts</p>
                    <div class="dna-override-buttons">
                        <button type="button" class="btn btn--outline btn--small" id="btn-rotate-palette" title="Changes only color family within your genre's allowed range.">
                            🎨 Rotate Palette
                        </button>
                        <button type="button" class="btn btn--outline btn--small" id="btn-increase-motion" title="Adds subtle movement. Safe for Reels/TikTok compression.">
                            📈 Increase Motion
                        </button>
                        <button type="button" class="btn btn--outline btn--small" id="btn-reduce-texture" title="Removes grain/noise to improve readability and reduce Render cost.">
                            📉 Reduce Texture
                        </button>
                        ${this.advancedMode ? `
                        <button type="button" class="btn btn--outline btn--small btn--warning" id="btn-force-regen" title="Force complete DNA regeneration">
                            🔄 Force Regenerate DNA
                        </button>
                        ` : ''}
                    </div>
                </div>
                
                ${this.dnaLocked ? `
                <div class="dna-locked-notice">
                    <span class="dna-locked-notice__icon">🔒</span>
                    <span>Visual DNA is locked. Images will match this fingerprint.</span>
                </div>
                ` : ''}
            </div>
        `;
        
        // Setup Visual DNA step listeners
        this.setupVisualDNAStepListeners();
    }
    
    setupVisualDNAStepListeners() {
        // Why unique toggle
        document.getElementById('toggle-why-unique')?.addEventListener('click', () => {
            const content = document.getElementById('why-unique-content');
            const arrow = document.getElementById('why-unique-arrow');
            if (content) {
                const isHidden = content.style.display === 'none';
                content.style.display = isHidden ? 'block' : 'none';
                if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
            }
        });
        
        // Soft override buttons
        document.getElementById('btn-rotate-palette')?.addEventListener('click', () => this.rotatePalette());
        document.getElementById('btn-increase-motion')?.addEventListener('click', () => this.increaseMotion());
        document.getElementById('btn-reduce-texture')?.addEventListener('click', () => this.reduceTexture());
        document.getElementById('btn-force-regen')?.addEventListener('click', () => this.forceRegenerateDNA());
    }
    
    /**
     * Initialize visualDNA from generation details if not already set
     */
    ensureVisualDNA() {
        if (!this.visualDNA && this.formData.generationDetails?.visual_dna) {
            this.visualDNA = { ...this.formData.generationDetails.visual_dna };
        }
        if (!this.visualDNA) {
            this.visualDNA = {};
        }
        return this.visualDNA;
    }
    
    /**
     * Available palette options for rotation
     */
    getPaletteOptions() {
        return [
            'sickly_green', 'cold_blue', 'broadcast_amber', 'deep_purple',
            'sepia_wash', 'crimson_tint', 'monochrome', 'neon_glow'
        ];
    }
    
    /**
     * Available motion profile options
     */
    getMotionOptions() {
        return [
            'static', 'micro_jitter', 'slow_drift', 'tracking_wobble',
            'slow_pulse', 'handheld_shake', 'smooth_pan'
        ];
    }
    
    rotatePalette() {
        this.ensureVisualDNA();
        const palettes = this.getPaletteOptions();
        const currentIdx = palettes.indexOf(this.visualDNA.color_palette);
        const nextIdx = (currentIdx + 1) % palettes.length;
        const newPalette = palettes[nextIdx];
        
        this.visualDNA.color_palette = newPalette;
        this.addConsoleLog(`🎨 Rotated palette: ${newPalette}`, 'success');
        
        // Show feedback and re-render
        this.showDNAChangeFeedback();
        this.renderCurrentStep();
    }
    
    increaseMotion() {
        this.ensureVisualDNA();
        const motions = this.getMotionOptions();
        const currentIdx = motions.indexOf(this.visualDNA.motion_profile);
        // Move up in intensity (static → micro_jitter → slow_drift etc)
        const nextIdx = Math.min(currentIdx + 1, motions.length - 1);
        const newMotion = motions[nextIdx];
        
        if (newMotion === this.visualDNA.motion_profile) {
            this.addConsoleLog('📈 Already at max motion intensity', 'warning');
            return;
        }
        
        this.visualDNA.motion_profile = newMotion;
        this.addConsoleLog(`📈 Increased motion: ${newMotion}`, 'success');
        
        this.showDNAChangeFeedback();
        this.renderCurrentStep();
    }
    
    reduceTexture() {
        this.ensureVisualDNA();
        
        // Get current textures as array
        let textures = this.visualDNA.texture_artifacts;
        if (typeof textures === 'string') {
            textures = textures.split(',').map(t => t.trim()).filter(Boolean);
        } else if (!Array.isArray(textures)) {
            textures = [];
        }
        
        if (textures.length === 0) {
            this.addConsoleLog('📉 No textures to reduce', 'warning');
            return;
        }
        
        // Remove one texture artifact
        const removed = textures.pop();
        this.visualDNA.texture_artifacts = textures.length > 0 ? textures : 'none';
        
        this.addConsoleLog(`📉 Removed texture: ${removed}`, 'success');
        this.showDNAChangeFeedback();
        this.renderCurrentStep();
    }
    
    async forceRegenerateDNA() {
        if (!this.jobId) {
            this.showError('No job found — please start content creation first.');
            return;
        }

        if (!confirm('This will regenerate the Visual DNA from scratch. Your current DNA tweaks will be lost. Continue?')) {
            return;
        }

        this.addConsoleLog('🔄 Forcing complete DNA regeneration...', 'info');

        // Clear current DNA to force server to regenerate
        this.visualDNA = null;
        this.dnaLocked = false;

        const stepContent = document.getElementById('step-content');

        try {
            this.showStepLoading(stepContent, 'Regenerating Visual DNA...');

            // Re-run preview mode — server will generate fresh Visual DNA
            const startTime = performance.now();
            const previewResponse = await runPreviewMode(this.jobId);
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

            // Extract the new Visual DNA
            if (previewResponse.generation_details?.visual_dna) {
                this.visualDNA = previewResponse.generation_details.visual_dna;
                this.formData.generationDetails = previewResponse.generation_details;
                this.addConsoleLog(`✅ Visual DNA regenerated in ${elapsed}s`, 'success');

                const vdna = this.visualDNA;
                this.addConsoleLog(`🧬 New DNA: ${vdna.visual_style} / ${vdna.color_palette} / ${vdna.motion_profile}`, 'info');

                if (typeof toast !== 'undefined') toast.success('Visual DNA regenerated');
            } else {
                this.addConsoleLog('⚠️ Server did not return new Visual DNA', 'warning');
            }

            this.renderCurrentStep();
        } catch (error) {
            console.error('DNA regeneration failed:', error);
            this.addConsoleLog(`❌ DNA regeneration failed: ${error.message}`, 'error');
            this.showError(`DNA regeneration failed: ${error.message}`);
            this.renderCurrentStep();
        }
    }
    
    /**
     * Show feedback that DNA change was safe
     */
    showDNAChangeFeedback() {
        const feedback = document.getElementById('dna-change-feedback');
        if (feedback) {
            feedback.classList.remove('hidden');
            setTimeout(() => feedback.classList.add('hidden'), 3000);
        }
    }
    
    /**
     * Calculate render budget score (1-10)
     * Lower complexity = higher score (cheaper render)
     */
    calculateRenderBudgetScore() {
        const visualDNA = this.visualDNA || this.formData.generationDetails?.visual_dna || {};
        let score = 10;
        
        // Deduct for complex motion
        const motion = visualDNA.motion_profile;
        if (motion === 'aggressive' || motion === 'chaotic') score -= 2;
        else if (motion === 'building' || motion === 'sudden_bursts') score -= 1;
        
        // Deduct for heavy textures
        let textures = visualDNA.texture_artifacts;
        if (Array.isArray(textures)) {
            score -= Math.min(textures.length, 3);
        } else if (textures && textures !== 'none') {
            score -= 1;
        }
        
        // Deduct for complex visual style
        const style = visualDNA.visual_style;
        if (style === 'found_footage' || style === 'vhs_static') score -= 1;
        
        return Math.max(1, Math.min(10, score));
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

    // ==================== STEP 5: ASSEMBLE ====================

    renderAssembleStep(container) {
        const hasImages = this.sceneBuilder.scenes.some(s => s.imageUrl);
        const genDetails = this.formData.generationDetails || {};
        const visualDNA = genDetails.visual_dna || {};
        
        // Calculate estimates
        const totalWords = this.sceneBuilder.scenes.reduce((sum, s) => sum + (s.text?.split(' ').length || 0), 0);
        const estimatedDuration = Math.round(totalWords / 2.5);
        const estimatedFileSize = Math.round(estimatedDuration * 0.8); // ~0.8MB per second for 1080p
        
        // Platform tuning configurations
        const platformConfigs = {
            reels: { name: 'Instagram Reels', icon: '📱', maxDuration: 90, aspectRatio: '9:16', codec: 'H.264' },
            tiktok: { name: 'TikTok', icon: '🎵', maxDuration: 180, aspectRatio: '9:16', codec: 'H.264' },
            shorts: { name: 'YouTube Shorts', icon: '📺', maxDuration: 60, aspectRatio: '9:16', codec: 'H.264' }
        };
        const currentPlatform = platformConfigs[this.targetPlatform] || platformConfigs.reels;
        
        container.innerHTML = `
            <div class="create-card assemble-card">
                <!-- Assemble Header -->
                <div class="assemble-header">
                    <h2 class="assemble-header__title">🎬 Ready to Render</h2>
                    <div class="assemble-header__badges">
                        <span class="assemble-badge assemble-badge--platform">${currentPlatform.icon} ${currentPlatform.name}</span>
                        <span class="assemble-badge assemble-badge--duration">⏱️ ~${estimatedDuration}s</span>
                        <span class="assemble-badge assemble-badge--size">💾 ~${estimatedFileSize}MB</span>
                    </div>
                </div>
                
                <!-- Ready Status Grid -->
                <div class="assemble-status-grid">
                    <div class="assemble-status-item ${this.formData.storyApproved ? 'assemble-status-item--ready' : 'assemble-status-item--pending'}">
                        <span class="assemble-status-item__icon">${this.formData.storyApproved ? '✅' : '⏳'}</span>
                        <span class="assemble-status-item__label">Story</span>
                    </div>
                    <div class="assemble-status-item ${this.dnaLocked || visualDNA.visual_style ? 'assemble-status-item--ready' : 'assemble-status-item--pending'}">
                        <span class="assemble-status-item__icon">${this.dnaLocked || visualDNA.visual_style ? '✅' : '⏳'}</span>
                        <span class="assemble-status-item__label">Visual DNA</span>
                    </div>
                    <div class="assemble-status-item ${hasImages ? 'assemble-status-item--ready' : 'assemble-status-item--pending'}">
                        <span class="assemble-status-item__icon">${hasImages ? '✅' : '⏳'}</span>
                        <span class="assemble-status-item__label">Images</span>
                    </div>
                    <div class="assemble-status-item ${this.formData.audioGenerated ? 'assemble-status-item--ready' : 'assemble-status-item--pending'}">
                        <span class="assemble-status-item__icon">${this.formData.audioGenerated ? '✅' : '⏳'}</span>
                        <span class="assemble-status-item__label">Audio</span>
                    </div>
                </div>
                
                <!-- Platform Selector -->
                <div class="assemble-platform-selector">
                    <h4 class="assemble-section-title">📱 Target Platform</h4>
                    <div class="platform-buttons">
                        ${Object.entries(platformConfigs).map(([key, config]) => `
                            <button type="button" 
                                class="platform-btn ${this.targetPlatform === key ? 'platform-btn--active' : ''}"
                                data-platform="${key}">
                                <span class="platform-btn__icon">${config.icon}</span>
                                <span class="platform-btn__name">${config.name}</span>
                                <span class="platform-btn__detail">${config.maxDuration}s max</span>
                            </button>
                        `).join('')}
                    </div>
                </div>
                
                <!-- Render Settings -->
                <div class="assemble-render-settings">
                    <h4 class="assemble-section-title">⚙️ Render Settings</h4>
                    <div class="render-settings-grid">
                        <div class="render-setting-item">
                            <span class="render-setting-item__label">Aspect Ratio</span>
                            <span class="render-setting-item__value">${currentPlatform.aspectRatio}</span>
                        </div>
                        <div class="render-setting-item">
                            <span class="render-setting-item__label">Codec</span>
                            <span class="render-setting-item__value">${currentPlatform.codec}</span>
                        </div>
                        <div class="render-setting-item">
                            <span class="render-setting-item__label">Resolution</span>
                            <span class="render-setting-item__value">1080×1920</span>
                        </div>
                        <div class="render-setting-item">
                            <span class="render-setting-item__label">FPS</span>
                            <span class="render-setting-item__value">30</span>
                        </div>
                    </div>
                </div>
                
                <!-- Preview Images -->
                ${hasImages ? `
                <div class="assemble-preview">
                    <h4 class="assemble-section-title">🖼️ Frame Preview</h4>
                    <div class="assemble-preview__images">
                        ${this.sceneBuilder.scenes.slice(0, 6).map((scene, i) => `
                            <img src="${scene.imageUrl}" alt="Scene ${i + 1}" class="assemble-preview__img">
                        `).join('')}
                        ${this.sceneBuilder.scenes.length > 6 ? `
                        <span class="assemble-preview__more">+${this.sceneBuilder.scenes.length - 6} more</span>
                        ` : ''}
                    </div>
                </div>
                ` : ''}
                
                <!-- Render Budget -->
                <div class="assemble-budget">
                    <h4 class="assemble-section-title">💰 Render Budget</h4>
                    <div class="budget-breakdown">
                        <div class="budget-item">
                            <span class="budget-item__label">Video render</span>
                            <span class="budget-item__value">~$0.02</span>
                        </div>
                        <div class="budget-item">
                            <span class="budget-item__label">Storage (30 days)</span>
                            <span class="budget-item__value">Free</span>
                        </div>
                        <div class="budget-item budget-item--total">
                            <span class="budget-item__label">Total</span>
                            <span class="budget-item__value">~$0.02</span>
                        </div>
                    </div>
                </div>
                
                <!-- Post Plan (Autoscheduler) -->
                <div class="assemble-post-plan">
                    <h4 class="assemble-section-title">📅 Post Plan</h4>
                    <div class="post-plan-grid">
                        <div class="post-plan-item">
                            <label class="toggle-switch">
                                <input type="checkbox" id="addToQueue" ${this.formData.addToQueue ? 'checked' : ''}>
                                <span class="toggle-switch__slider"></span>
                                <span class="toggle-switch__label">Add to queue after render</span>
                            </label>
                        </div>
                        <div class="post-plan-item">
                            <label class="form-label">Target Platform(s)</label>
                            <div class="platform-checkboxes">
                                <label class="platform-checkbox">
                                    <input type="checkbox" name="postPlatform" value="youtube_shorts" ${!this.formData.postPlatforms || this.formData.postPlatforms?.includes('youtube_shorts') ? 'checked' : ''}>
                                    <span>▶️ YouTube Shorts</span>
                                </label>
                                <label class="platform-checkbox">
                                    <input type="checkbox" name="postPlatform" value="instagram_reels" ${!this.formData.postPlatforms || this.formData.postPlatforms?.includes('instagram_reels') ? 'checked' : ''}>
                                    <span>📱 Instagram Reels</span>
                                </label>
                                <label class="platform-checkbox">
                                    <input type="checkbox" name="postPlatform" value="facebook_reels" ${!this.formData.postPlatforms || this.formData.postPlatforms?.includes('facebook_reels') ? 'checked' : ''}>
                                    <span>📘 Facebook Reels</span>
                                </label>
                                <label class="platform-checkbox">
                                    <input type="checkbox" name="postPlatform" value="tiktok" ${this.formData.postPlatforms?.includes('tiktok') ? 'checked' : ''}>
                                    <span>🎵 TikTok</span>
                                </label>
                            </div>
                        </div>
                        <div class="post-plan-item">
                            <label class="form-label">Schedule</label>
                            <select id="postSchedule" class="form-control select">
                                <option value="next" ${this.formData.postSchedule === 'next' ? 'selected' : ''}>Next available slot</option>
                                <option value="custom" ${this.formData.postSchedule === 'custom' ? 'selected' : ''}>Pick specific time</option>
                                <option value="manual" ${this.formData.postSchedule === 'manual' ? 'selected' : ''}>Manual (don't schedule)</option>
                            </select>
                        </div>
                        <div class="post-plan-item post-plan-item--full">
                            <label class="form-label">Caption</label>
                            <textarea id="postCaption" class="form-control" rows="2" placeholder="Add your caption...">${this.formData.postCaption || ''}</textarea>
                        </div>
                        <div class="post-plan-item post-plan-item--full">
                            <label class="form-label">Hashtag Preset</label>
                            <select id="hashtagPreset" class="form-control select">
                                <option value="auto">Auto (genre-based)</option>
                                <option value="horror">#horror #scary #creepy #paranormal</option>
                                <option value="mystery">#mystery #truecrime #unsolved</option>
                                <option value="custom">Custom...</option>
                            </select>
                        </div>
                    </div>
                    <p class="post-plan-note">
                        <span class="note-icon">💡</span>
                        <span>Posts will appear in your queue for final review before publishing.</span>
                    </p>
                </div>
                
                <!-- Render Actions -->
                <div class="assemble-actions">
                    <button id="btn-generate" class="btn btn--primary btn--lg btn--full">
                        🎬 Render Video
                    </button>
                    <p class="assemble-actions__hint">
                        This will combine your ${this.sceneBuilder.scenes.length} images, audio, and captions into a ${currentPlatform.name}-ready video.
                    </p>
                </div>
                
                ${this.advancedMode ? `
                <!-- Advanced: FFmpeg Preset -->
                <div class="assemble-ffmpeg-preview">
                    <button type="button" class="ffmpeg-toggle" id="toggle-ffmpeg">
                        <span>🔧 View FFmpeg Command</span>
                        <span class="ffmpeg-toggle__arrow" id="ffmpeg-arrow">▼</span>
                    </button>
                    <div class="ffmpeg-content" id="ffmpeg-content" style="display: none;">
                        <pre class="ffmpeg-command">ffmpeg -i concat.txt -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k -movflags +faststart -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" output.mp4</pre>
                    </div>
                </div>
                ` : ''}
            </div>
        `;
        
        // Setup assemble step listeners
        this.setupAssembleStepListeners();
    }
    
    setupAssembleStepListeners() {
        // Platform selection
        document.querySelectorAll('.platform-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const platform = e.currentTarget.dataset.platform;
                this.targetPlatform = platform;
                this.formData.platform = platform;
                this.renderCurrentStep();
            });
        });
        
        // Generate button
        document.getElementById('btn-generate')?.addEventListener('click', () => this.executeVideoAssemblyPhase());
        
        // FFmpeg toggle (advanced)
        document.getElementById('toggle-ffmpeg')?.addEventListener('click', () => {
            const content = document.getElementById('ffmpeg-content');
            const arrow = document.getElementById('ffmpeg-arrow');
            if (content) {
                const isHidden = content.style.display === 'none';
                content.style.display = isHidden ? 'block' : 'none';
                if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
            }
        });
        
        // Post Plan listeners
        document.getElementById('addToQueue')?.addEventListener('change', (e) => {
            this.formData.addToQueue = e.target.checked;
        });
        
        document.querySelectorAll('input[name="postPlatform"]').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.formData.postPlatforms = Array.from(
                    document.querySelectorAll('input[name="postPlatform"]:checked')
                ).map(cb => cb.value);
            });
        });
        
        document.getElementById('postSchedule')?.addEventListener('change', (e) => {
            this.formData.postSchedule = e.target.value;
        });
        
        document.getElementById('postCaption')?.addEventListener('input', (e) => {
            this.formData.postCaption = e.target.value;
        });
        
        document.getElementById('hashtagPreset')?.addEventListener('change', (e) => {
            this.formData.hashtagPreset = e.target.value;
        });
    }

    // Keep old method as alias for backwards compatibility
    renderGenerateStep(container) {
        this.renderAssembleStep(container);
    }

    updateNavigationButtons() {
        const prevBtn = document.getElementById('btn-prev');
        const nextBtn = document.getElementById('btn-next');
        const totalSteps = this.template?.steps?.length || 1;

        if (prevBtn) {
            // Can go back if not on first step (step 0)
            prevBtn.disabled = this.currentStep <= 0;
        }

        if (nextBtn) {
            // Last step is totalSteps - 1 (0-indexed)
            const isLastStep = this.currentStep >= totalSteps - 1;
            nextBtn.textContent = isLastStep ? 'Render →' : 'Continue →';
            
            // Step gating: disable Continue if prerequisites not met
            nextBtn.disabled = !this.canProceedFromStep(this.currentStep);
        }
    }
    
    /**
     * Check if user can proceed from current step (step gating)
     */
    canProceedFromStep(step) {
        const stepConfig = this.template?.steps?.[step];
        if (!stepConfig) return false;
        
        switch (stepConfig.id) {
            case 'preset':
                // Require a preset to be selected
                return !!this.selectedPreset;
                
            case 'settings':
                // Require category and duration at minimum
                return !!(this.formData.category || this.selectedPreset?.defaults?.vibe_preset) 
                    && !!this.formData.duration;
                
            case 'story':
                // Require scenes to exist
                return this.sceneBuilder.scenes.length > 0;
                
            case 'visual-dna':
                // Require visual DNA to be present (from generation or override)
                return !!(this.formData.generationDetails?.visual_dna || this.visualDNA);
                
            case 'images':
                // Triple gating: check sceneBuilder, check-job status, AND backend phase
                // This prevents advancing if phase/step mismatch occurs
                const scenesWithImages = this.sceneBuilder.scenes.filter(s => s.imageUrl).length;
                const totalScenes = this.sceneBuilder.scenes.length;
                const sceneBuilderPassed = totalScenes > 0 && (scenesWithImages / totalScenes) >= 0.8;
                
                // Also check last check-job status as fallback (handle undefined)
                const checkJobStatus = this.lastCheckJobStatus || {};
                const imagesGen = checkJobStatus.images_generated || 0;
                const totalImg = checkJobStatus.total_images || totalScenes || 1;
                const checkJobPassed = imagesGen > 0 && imagesGen >= (totalImg * 0.8);
                
                // Phase-based gating: only allow leaving images if backend phase >= images
                // This prevents weird cases where UI step doesn't match backend state
                const backendPhase = checkJobStatus.phase || 'unknown';
                const validPhases = ['images', 'assemble', 'rendering', 'complete', 'completed'];
                const phaseGatePassed = validPhases.includes(backendPhase) || 
                                        (imagesGen > 0); // Fallback if phase not set
                
                console.log(`[canProceedFromStep:images] scenesWithImages=${scenesWithImages}/${totalScenes}, sceneBuilderPassed=${sceneBuilderPassed}, checkJobPassed=${checkJobPassed}, phaseGatePassed=${phaseGatePassed}, backendPhase=${backendPhase}`);
                
                // Show sync banner if backend passed but UI didn't
                if (checkJobPassed && !sceneBuilderPassed) {
                    this.showImagesSyncBanner(checkJobStatus.images_generated, checkJobStatus.total_images);
                } else {
                    this.hideImagesSyncBanner();
                }
                
                // Pass if either UI or backend says ready, AND phase is valid
                return (sceneBuilderPassed || checkJobPassed) && phaseGatePassed;
                
            case 'assemble':
                // Require images and audio
                const hasImages = this.sceneBuilder.scenes.some(s => s.imageUrl);
                const hasAudio = !!this.formData.audioGenerated || !!this.formData.generationDetails?.audio_url;
                return hasImages && hasAudio;
                
            default:
                return true;
        }
    }

    prevStep() {
        if (this.currentStep > 0) {
            this.currentStep--;
            this.renderStepIndicators();
            this.renderCurrentStep();
            this.addConsoleLog(`◀️ Back to Step ${this.currentStep}`, 'info');
        }
    }

    async nextStep() {
        // Debounce: prevent rapid double-clicks
        if (this._stepTransitionInProgress) {
            this.debugLog('nextStep', 'Transition already in progress, ignoring');
            return;
        }
        this._stepTransitionInProgress = true;
        
        try {
            const totalSteps = this.template?.steps?.length || 1;
            
            // Collect form data
            this.collectAndSaveFormData();
            
            // Get current step config (0-indexed)
            const stepConfig = this.template.steps[this.currentStep];
            const stepId = stepConfig?.id;
            
            this.debugLog('nextStep', `Current step: ${this.currentStep} (${stepId}), total: ${totalSteps}`);
            
            // Not on last step - execute phase and advance
            if (this.currentStep < totalSteps - 1) {
                try {
                    // Execute phase-specific actions BEFORE advancing step
                    // Step 0 (Preset) -> Step 1 (Settings): No action needed
                    if (stepId === 'preset') {
                        if (!this.selectedPreset) {
                            this.showError('Please select a preset to continue');
                            return;
                        }
                        this.addConsoleLog(`✅ Preset: ${this.selectedPreset.name}`, 'success');
                    }
                    
                    // Step 1 (Settings) -> Step 2 (Story): Create job + Generate story + audio
                    else if (stepId === 'settings') {
                        await this.executeStoryAndAudioPhase();
                    }
                    
                    // Step 2 (Story) -> Step 3 (Visual DNA): Lock story, no generation needed
                    else if (stepId === 'story') {
                        this.formData.storyApproved = true;
                        this.storyLocked = true;
                        this.addConsoleLog('✅ Story approved and locked', 'success');
                    }
                    
                    // Step 3 (Visual DNA) -> Step 4 (Images): Generate images
                    else if (stepId === 'visual-dna') {
                        this.dnaLocked = true;
                        // Guard: skip if images already locked, complete, or in progress
                        if (this.imagesLocked) {
                            this.addConsoleLog('✅ Images already locked, skipping', 'info');
                        } else if (this._imagesPhaseInProgress) {
                            this.addConsoleLog('⏳ Images phase already in progress', 'info');
                        } else {
                            // Check if images already exist before regenerating
                            const hasImages = this.sceneBuilder.scenes.some(s => s.imageUrl);
                            const imagesGenerated = this.lastCheckJobStatus?.images_generated || 0;
                            const totalImages = this.lastCheckJobStatus?.total_images || this.sceneBuilder.scenes.length;
                            const backendComplete = imagesGenerated >= totalImages * 0.8;
                            
                            if (hasImages || backendComplete) {
                                this.addConsoleLog(`✅ Images already generated (${imagesGenerated}/${totalImages}), skipping regeneration`, 'success');
                            } else {
                                await this.executeImagesPhase();
                            }
                        }
                    }
                    
                    // Step 4 (Images) -> Step 5 (Assemble): Lock images
                    else if (stepId === 'images') {
                        this.imagesLocked = true;
                        this.addConsoleLog('✅ Images locked and ready for assembly', 'success');
                    }
                    
                    this.currentStep++;
                    this.renderStepIndicators();
                    this.renderCurrentStep();
                    
                } catch (error) {
                    console.error('Phase execution failed:', error);
                    this.addLog(`❌ Failed: ${error.message}`, 'error');
                    this.addConsoleLog(`❌ ${error.message}`, 'error');
                    this.showError(error.message);
                }
            } else {
                // Last step (Assemble) - start video assembly
                await this.executeVideoAssemblyPhase();
            }
        } finally {
            // Always reset debounce flag after short delay (allows UI to update)
            setTimeout(() => { this._stepTransitionInProgress = false; }, 300);
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
            
            // Store generation details including the prompt for display
            this.formData.generationDetails = previewResponse.generation_details || {};
            
            this.debugLog('runPreviewMode', `Title: ${this.formData.title}`);
            this.debugLog('runPreviewMode', `Scenes: ${previewResponse.scenes?.length || 0}`);
            this.debugLog('runPreviewMode', `Generation details stored: ${Object.keys(this.formData.generationDetails).join(', ')}`);
            
            // Log Visual DNA info if available
            if (this.formData.generationDetails.visual_dna) {
                const vdna = this.formData.generationDetails.visual_dna;
                this.addLog(`🧬 Visual DNA: ${vdna.visual_style} / ${vdna.color_palette}`, 'info');
                this.debugLog('Visual DNA', `Style: ${vdna.visual_style}, Palette: ${vdna.color_palette}, Motion: ${vdna.motion_profile}`);
                
                // Log similarity info if available
                if (this.formData.generationDetails.similarity) {
                    const sim = this.formData.generationDetails.similarity;
                    const simIcon = sim.is_likely_unique ? '✅' : '⚠️';
                    this.addLog(`${simIcon} Uniqueness: ${(sim.score * 100).toFixed(1)}% similarity`, sim.is_likely_unique ? 'success' : 'warning');
                }
            }
            
            // Parse scenes from PREVIEW response (not checkJob which doesn't have them yet)
            if (previewResponse.scenes && previewResponse.scenes.length > 0) {
                this.sceneBuilder.setScenes(previewResponse.scenes.map((s, i) => {
                    // Determine best prompt to display:
                    // Priority: image_details.prompt > image_details.prompt_preview_start > keywords
                    const details = s.image_details || {};
                    let displayPrompt = '';
                    let promptMode = 'none';
                    let promptLen = 0;
                    
                    if (details.prompt && details.prompt.length > 50) {
                        // Full prompt available
                        displayPrompt = details.prompt;
                        promptMode = details.prompt_mode || 'final_prompt';
                        promptLen = details.prompt.length;
                    } else if (details.prompt_preview_start) {
                        // Preview available
                        displayPrompt = `${details.prompt_preview_start}... [${details.prompt_len || '?'} chars]`;
                        promptMode = details.prompt_mode || 'preview';
                        promptLen = details.prompt_len || 0;
                    } else {
                        // Fallback to keywords (explicitly labeled)
                        const keywordsText = s.keywords?.join(', ') || s.image_prompt || '';
                        displayPrompt = keywordsText ? `[KEYWORDS] ${keywordsText}` : '(pending image generation)';
                        promptMode = 'keywords_fallback';
                        promptLen = 0;
                    }
                    
                    return {
                        id: i + 1,
                        text: s.text || '',
                        imagePrompt: displayPrompt,
                        promptMode: promptMode,
                        promptLen: promptLen,
                        imageDetails: details,
                        mood: 'neutral',
                        startTime: s.startTime || 0,
                        endTime: s.endTime || 0
                    };
                }));
                this.addLog(`✅ Story generated: ${previewResponse.scenes.length} scenes`, 'success');
                this.debugLog('runPreviewMode', `Stored ${this.sceneBuilder.scenes.length} scenes in sceneBuilder`);
                
                // Check story density and auto-adjust recommendation
                const totalWords = this.sceneBuilder.scenes.reduce((sum, s) => sum + (s.text?.split(' ').length || 0), 0);
                const durationSec = parseInt(this.formData.duration) || 60;
                const pace = this.formData.pace || 'balanced';
                const currentSceneCount = this.sceneBuilder.scenes.length;
                
                const densityCheck = this.autoAdjustSceneCount({
                    storyWords: totalWords,
                    currentSceneCount,
                    durationSec,
                    pace,
                    platform: this.targetPlatform || 'reels'
                });
                
                this.debugLog('autoAdjust', `Density: ${densityCheck.densityRatio}, Action: ${densityCheck.action}`);
                this.debugLog('autoAdjust', `Current: ${currentSceneCount} scenes, Recommended: ${densityCheck.adjustedSceneCount} scenes`);
                
                if (densityCheck.action !== 'ok') {
                    this.addLog(`⚠️ ${densityCheck.message}`, 'warning');
                    // Store the recommendation for display in story step
                    this.formData.densityWarning = densityCheck;
                }
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
        
        // Guard: prevent multiple simultaneous executions
        if (this._imagesPhaseInProgress) {
            this.addConsoleLog('⚠️ Images phase already running, skipping duplicate call', 'warning');
            return;
        }
        this._imagesPhaseInProgress = true;
        
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
        } finally {
            // Always reset the in-progress flag
            this._imagesPhaseInProgress = false;
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
                
                // check-job returns images_generated count (includes parallel progress)
                // Also check parallel_in_progress flag for accurate counting
                const scenes = status.scenes || [];
                const parallelInProgress = status.parallel_in_progress || false;
                const parallelProgress = status.parallel_progress || 0;
                
                // Use images_generated from response (it already accounts for parallel progress)
                const imagesGenerated = status.images_generated || scenes.filter(s => s.videoUrl || s.url).length;
                
                // Use total_images from response if available
                const actualTotal = status.total_images || totalExpected;
                
                // Update total display if it changed
                const totalEl = document.getElementById('images-total-count');
                if (totalEl) totalEl.textContent = actualTotal;
                
                const statusMsg = parallelInProgress 
                    ? `parallel: ${parallelProgress}/${actualTotal}` 
                    : `${imagesGenerated}/${actualTotal}`;
                this.addVisualDebug(`Poll ${polls + 1}: status=${status.status}, progress=${status.progress}%, images=${statusMsg}`);
                
                // Scene integrity check: warn if returned count doesn't match expected
                const expectedScenes = status.scene_count_expected || actualTotal;
                const returnedScenes = status.scene_count_returned || scenes.length;
                if (returnedScenes > 0 && returnedScenes < expectedScenes && !parallelInProgress) {
                    this.debugLog('pollForImages', `⚠️ Scene integrity: expected ${expectedScenes}, got ${returnedScenes}`);
                }
                
                // Update the counter
                const countEl = document.getElementById('images-generated-count');
                if (countEl) countEl.textContent = imagesGenerated;
                
                // Update image cards for any new images
                if (imagesGenerated > lastImageCount || scenes.length > 0) {
                    const imageSource = status.source || (status.parallel_in_progress ? 'parallel' : 'database');
                    const sourceDetail = status.source_detail || (status.parallel_in_progress ? 'parallel_status_poll' : 'job_assets_db');
                    this.debugLog('pollForImages', `New images: ${imagesGenerated} (was ${lastImageCount}), source=${imageSource}, detail=${sourceDetail}`);
                    
                    // Track if we were in parallel mode (for finalization re-poll)
                    if (status.parallel_in_progress) {
                        this._wasParallelMode = true;
                    }
                    
                    // Update source indicator in UI
                    this.updateImageSourceIndicator(imageSource, imagesGenerated, actualTotal);
                    
                    // Helper: clamp and floor index to valid range
                    const clampIndex = (n, max) => Math.max(0, Math.min(Math.floor(n), max - 1));
                    
                    // Update each scene that has an image
                    scenes.forEach((scene, idx) => {
                        // Canonicalize URL - prefer imageUrl, fallback to others for compatibility
                        const imageUrl = scene.imageUrl || scene.videoUrl || scene.url;
                        if (imageUrl) {
                            // INDEX CONVENTION: API returns 0-based scene.index
                            // Safely normalize index with clamp+floor to prevent -1 or overflow
                            const rawIndex = Number.isFinite(scene.index) ? Number(scene.index) : idx;
                            const sceneIndex = clampIndex(rawIndex, this.sceneBuilder.scenes.length || 100);
                            this.updateImageCard(sceneIndex, { url: imageUrl, source: imageSource });
                            // Convert 0-based API index → 1-based SceneBuilder ID
                            const sceneId = sceneIndex + 1;
                            if (this.sceneBuilder.scenes[sceneIndex]) {
                                // Build update object with URL and prompt info if available
                                const details = scene.image_details || {};
                                let updateObj = { imageUrl: imageUrl };
                                
                                // v5.14: ALWAYS store imageDetails for extended info display
                                if (Object.keys(details).length > 0) {
                                    updateObj.imageDetails = details;
                                }
                                
                                // Extract prompt from image_details if available
                                if (details.prompt && details.prompt.length > 50) {
                                    updateObj.imagePrompt = details.prompt;
                                    updateObj.promptMode = details.prompt_mode || 'final_prompt';
                                    updateObj.promptLen = details.prompt.length;
                                } else if (details.prompt_preview_start) {
                                    updateObj.imagePrompt = `${details.prompt_preview_start}... [${details.prompt_len || '?'} chars]`;
                                    updateObj.promptMode = details.prompt_mode || 'preview';
                                    updateObj.promptLen = details.prompt_len || 0;
                                } else if (details.prompt_len || details.prompt_mode) {
                                    updateObj.promptMode = details.prompt_mode || 'metadata_only';
                                    updateObj.promptLen = details.prompt_len || 0;
                                }
                                
                                this.sceneBuilder.updateScene(sceneId, updateObj);
                            }
                        }
                    });
                    
                    if (imagesGenerated > lastImageCount) {
                        lastImageCount = imagesGenerated;
                        this.addLog(`🖼️ ${imagesGenerated}/${actualTotal} images generated`, 'info');
                        // Refresh the image prompts log to show actual prompts
                        this.refreshImagePromptsLog();
                        
                        // Update lastCheckJobStatus during polling so canProceedFromStep works
                        this.lastCheckJobStatus = {
                            images_generated: imagesGenerated,
                            total_images: actualTotal,
                            source: imageSource,
                            source_detail: sourceDetail,
                            phase: status.phase || 'images',
                            scene_count_expected: expectedScenes,
                            scene_count_returned: returnedScenes
                        };
                        
                        // Update nav buttons so Continue enables when ready
                        this.updateNavigationButtons();
                    }
                }
                
                // Check if images phase is complete (use actualTotal from response)
                if (imagesGenerated >= actualTotal || status.progress >= 70 || status.status === 'completed') {
                    this.debugLog('pollForImages', `Images complete! ${imagesGenerated}/${actualTotal}`);
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
        
        // Finalization re-poll: only needed when parallel mode was used
        // This ensures DB truth is loaded after parallel server finishes
        let finalStatus = null;
        let finalScenes = [];
        
        if (this._wasParallelMode) {
            this.debugLog('pollForImages', 'Parallel mode detected - doing finalization re-poll');
            for (let retry = 0; retry < 3; retry++) {
                await new Promise(r => setTimeout(r, 2000)); // Wait for DB write
                finalStatus = await checkJob(this.jobId);
                finalScenes = finalStatus.scenes || [];
                const dbSource = finalStatus.source || 'database';
                this.debugLog('pollForImages', `Final check ${retry + 1}/3: ${finalScenes.length} scenes, source=${dbSource}`);
                
                // If we got scenes from database (not parallel), we're done
                if (dbSource === 'database' && finalScenes.length > 0) {
                    this.addVisualDebug(`✅ Images finalized from database (${finalScenes.length} scenes)`);
                    break;
                }
            }
            this._wasParallelMode = false; // Reset flag
        } else {
            // Non-parallel flow: single check is sufficient
            finalStatus = await checkJob(this.jobId);
            finalScenes = finalStatus.scenes || [];
        }
        
        // Store last check-job status for dual gating
        this.lastCheckJobStatus = {
            images_generated: finalStatus?.images_generated || 0,
            total_images: finalStatus?.total_images || totalExpected,
            source: finalStatus?.source || 'database',
            source_detail: finalStatus?.source_detail || 'job_assets_db',
            phase: finalStatus?.phase || 'unknown',
            scene_count_expected: finalStatus?.scene_count_expected || totalExpected,
            scene_count_returned: finalStatus?.scene_count_returned || 0
        };
        
        // Update source indicator to "Saved"
        this.updateImageSourceIndicator('database', finalStatus?.images_generated || 0, finalStatus?.total_images || totalExpected);
        
        // Helper: clamp and floor index to valid range
        const clampIndex = (n, max) => Math.max(0, Math.min(Math.floor(n), max - 1));
        
        // Track URL rewrites (parallel → database URLs may differ)
        let urlRewrites = 0;
        
        finalScenes.forEach((scene, idx) => {
            // Canonicalize URL - prefer imageUrl
            const imageUrl = scene.imageUrl || scene.videoUrl || scene.url;
            // Safely normalize index with clamp+floor
            // INDEX CONVENTION: API returns 0-based scene.index, convert to 1-based sceneId for SceneBuilder
            const rawIndex = Number.isFinite(scene.index) ? Number(scene.index) : idx;
            const sceneIndex = clampIndex(rawIndex, this.sceneBuilder.scenes.length || 100);
            const sceneId = sceneIndex + 1; // Convert 0-based API index → 1-based SceneBuilder ID
            
            if (imageUrl && this.sceneBuilder.scenes[sceneIndex]) {
                // Detect URL rewrites (parallel URL → final DB URL)
                const existingUrl = this.sceneBuilder.scenes[sceneIndex].imageUrl;
                if (existingUrl && existingUrl !== imageUrl) {
                    urlRewrites++;
                    this.debugLog('pollForImages', `URL rewrite scene ${sceneIndex}: ${existingUrl.slice(-30)} → ${imageUrl.slice(-30)}`);
                }
                
                // Extract real prompt info from image_details if available
                const details = scene.image_details || {};
                let updateObj = { imageUrl: imageUrl };
                
                // v5.14: ALWAYS store imageDetails for extended info display (model, art_style, visual_dna, etc.)
                // Even if prompt is not available, there's valuable metadata to display
                if (Object.keys(details).length > 0) {
                    updateObj.imageDetails = details;
                }
                
                if (details.prompt && details.prompt.length > 50) {
                    // Full prompt available from server
                    updateObj.imagePrompt = details.prompt;
                    updateObj.promptMode = details.prompt_mode || 'final_prompt';
                    updateObj.promptLen = details.prompt.length;
                } else if (details.prompt_preview_start) {
                    // Preview available
                    updateObj.imagePrompt = `${details.prompt_preview_start}... [${details.prompt_len || '?'} chars]`;
                    updateObj.promptMode = details.prompt_mode || 'preview';
                    updateObj.promptLen = details.prompt_len || 0;
                } else if (details.prompt_len || details.prompt_mode) {
                    // Metadata available but no prompt text
                    updateObj.promptMode = details.prompt_mode || 'metadata_only';
                    updateObj.promptLen = details.prompt_len || 0;
                }
                
                this.sceneBuilder.updateScene(sceneId, updateObj);
            }
        });
        
        if (urlRewrites > 0) {
            this.debugLog('pollForImages', `📝 ${urlRewrites} URL rewrites applied (parallel → database)`);
        }
        
        // Refresh UI after images complete
        this.refreshImagePromptsLog();
        this.updateNavigationButtons();
    }
    
    /**
     * Refresh the Image Prompts Log with actual prompts from sceneBuilder
     * Called after images are generated to replace [KEYWORDS] placeholders
     */
    refreshImagePromptsLog() {
        const logList = document.querySelector('.image-log-list');
        if (!logList) return;
        
        logList.innerHTML = this.sceneBuilder.scenes.map((scene, i) => {
            const details = scene.imageDetails || {};
            
            // =====================================================
            // BUILD COMPREHENSIVE DIAGNOSTICS - ALL GENERATION DETAILS
            // =====================================================
            let diagnosticsHtml = '';
            
            // Section 1: Model & Style
            const modelStyleLines = [];
            modelStyleLines.push(`<strong>🖼️ Model:</strong> <code>${details.model || 'unknown'}</code>`);
            modelStyleLines.push(`<strong>🎨 Art Style:</strong> <code>${details.art_style || 'default'}</code>`);
            if (details.art_style_override) {
                modelStyleLines.push(`<strong>⚡ Override:</strong> <span style="color: #f59e0b; font-weight: bold;">${details.art_style_override} (FORCED)</span>`);
            }
            if (details.generation_source) {
                modelStyleLines.push(`<strong>📡 Source:</strong> <code>${details.generation_source}</code>`);
            }
            if (details.generated_at) {
                modelStyleLines.push(`<strong>🕐 Generated:</strong> <code>${new Date(details.generated_at).toLocaleString()}</code>`);
            }
            
            // Section 2: Style Config Details
            const styleConfigLines = [];
            if (details.style_config) {
                styleConfigLines.push(`<strong>📋 Config Name:</strong> <code>${details.style_config.name || '?'}</code>`);
                if (details.style_config.basePrompt_preview) {
                    styleConfigLines.push(`<strong>Base Prompt:</strong> <span style="color: #888; font-style: italic;">"${details.style_config.basePrompt_preview}..."</span>`);
                }
                if (details.style_config.colorOverride_preview) {
                    styleConfigLines.push(`<strong>Color Override:</strong> <span style="color: #888; font-style: italic;">"${details.style_config.colorOverride_preview}..."</span>`);
                }
                if (details.style_config.technicalStyle_preview) {
                    styleConfigLines.push(`<strong>Technical Style:</strong> <span style="color: #888; font-style: italic;">"${details.style_config.technicalStyle_preview}..."</span>`);
                }
            }
            
            // Section 3: Visual DNA
            const visualDnaLines = [];
            if (details.visual_dna) {
                const dna = details.visual_dna;
                visualDnaLines.push(`<strong>🧬 Style:</strong> <code>${dna.style || '?'}</code>`);
                visualDnaLines.push(`<strong>🎨 Palette:</strong> <code>${dna.palette || '?'}</code>`);
                if (dna.lighting) visualDnaLines.push(`<strong>💡 Lighting:</strong> <code>${dna.lighting}</code>`);
                if (dna.composition) visualDnaLines.push(`<strong>📐 Composition:</strong> <code>${dna.composition}</code>`);
                if (dna.camera) visualDnaLines.push(`<strong>📷 Camera:</strong> <code>${dna.camera}</code>`);
                if (dna.motion) visualDnaLines.push(`<strong>🎬 Motion:</strong> <code>${dna.motion}</code>`);
                if (dna.textures?.length > 0) visualDnaLines.push(`<strong>🧱 Textures:</strong> <code>${dna.textures.join(', ')}</code>`);
            }
            if (details.visual_dna_suppressed) {
                visualDnaLines.push(`<span style="color: #f59e0b; font-weight: bold;">⚠️ VISUAL DNA SUPPRESSED</span>`);
                if (details.visual_dna_suppressed_reason) {
                    visualDnaLines.push(`<span style="color: #888; font-size: 0.7rem;">Reason: ${details.visual_dna_suppressed_reason}</span>`);
                }
            }
            
            // Section 4: Visual Contract
            const contractLines = [];
            if (details.visual_contract) {
                const contract = details.visual_contract;
                if (contract.location) contractLines.push(`<strong>📍 Location:</strong> <code>${contract.location}</code>`);
                if (contract.characterPose) contractLines.push(`<strong>🧍 Pose:</strong> <code>${contract.characterPose}</code>`);
                if (contract.actionFrozen) contractLines.push(`<strong>⚡ Action:</strong> <span style="color: #888;">"${contract.actionFrozen.substring(0, 80)}${contract.actionFrozen.length > 80 ? '...' : ''}"</span>`);
                if (contract.visibleObjects?.length > 0) contractLines.push(`<strong>👁️ Objects:</strong> <code>${contract.visibleObjects.join(', ')}</code>`);
                if (contract.forbiddenElements?.length > 0) contractLines.push(`<strong>🚫 Forbidden:</strong> <code style="color: #ef4444;">${contract.forbiddenElements.join(', ')}</code>`);
                if (contract.evidenceRule) contractLines.push(`<strong>📜 Evidence:</strong> <span style="color: #888;">${contract.evidenceRule}</span>`);
                if (contract.group_count) {
                    contractLines.push(`<strong>👥 Group Count:</strong> <code style="color: #22c55e;">${contract.group_count.expected} people (${contract.group_count.is_wrong ? 'WRONG COUNT STORY' : 'normal'})</code>`);
                }
            }
            
            // Section 5: Continuity & Character
            const continuityLines = [];
            if (details.character_description) {
                continuityLines.push(`<strong>👤 Character:</strong> <span style="color: #888;">"${details.character_description.substring(0, 100)}${details.character_description.length > 100 ? '...' : ''}"</span>`);
            }
            if (details.continuity_rules) {
                continuityLines.push(`<strong>🔗 Continuity:</strong> <span style="color: #888;">"${details.continuity_rules.substring(0, 100)}${details.continuity_rules.length > 100 ? '...' : ''}"</span>`);
            }
            if (details.camera_angle) continuityLines.push(`<strong>📷 Camera:</strong> <code>${details.camera_angle}</code>`);
            if (details.mood_level !== null && details.mood_level !== undefined) continuityLines.push(`<strong>😰 Mood Level:</strong> <code>${details.mood_level}/10</code>`);
            if (details.visual_beat) continuityLines.push(`<strong>🎬 Beat:</strong> <span style="color: #888;">"${details.visual_beat.substring(0, 80)}${details.visual_beat.length > 80 ? '...' : ''}"</span>`);
            
            // Section 6: Relevance Scoring
            const relevanceLines = [];
            if (details.relevance_score !== null && details.relevance_score !== undefined) {
                const scoreColor = details.relevance_score >= 0.65 ? '#22c55e' : details.relevance_score >= 0.4 ? '#f59e0b' : '#ef4444';
                relevanceLines.push(`<strong>📊 Score:</strong> <code style="color: ${scoreColor}; font-weight: bold;">${(details.relevance_score * 100).toFixed(0)}%</code>`);
            }
            if (details.relevance_failure_type && details.relevance_failure_type !== 'ok') {
                relevanceLines.push(`<strong>❌ Failure Type:</strong> <code style="color: #ef4444;">${details.relevance_failure_type}</code>`);
            }
            if (details.relevance_repaired) {
                relevanceLines.push(`<span style="color: #f59e0b;">🔧 PROMPT WAS AUTO-REPAIRED</span>`);
            }
            if (details.relevance_matched_objects?.length > 0) {
                relevanceLines.push(`<strong>✅ Matched:</strong> <code style="color: #22c55e;">${details.relevance_matched_objects.join(', ')}</code>`);
            }
            if (details.relevance_missing?.length > 0) {
                relevanceLines.push(`<strong>❌ Missing:</strong> <code style="color: #ef4444;">${details.relevance_missing.join(', ')}</code>`);
            }
            if (details.relevance_reason) {
                relevanceLines.push(`<strong>📝 Reason:</strong> <span style="color: #888;">${details.relevance_reason}</span>`);
            }
            
            // Section 7: Prompt Verification (Ground Truth)
            const promptVerifyLines = [];
            if (details.prompt_mode) {
                const modeColor = details.prompt_mode === 'final_prompt' ? '#22c55e' : '#f59e0b';
                promptVerifyLines.push(`<strong>📋 Mode:</strong> <code style="color: ${modeColor};">${details.prompt_mode}</code>`);
            }
            if (details.prompt_len) promptVerifyLines.push(`<strong>📏 Length:</strong> <code>${details.prompt_len} chars</code>`);
            if (details.prompt_hash) promptVerifyLines.push(`<strong>🔐 Hash:</strong> <code style="font-size: 0.65rem;">${details.prompt_hash}</code>`);
            
            // Build the full diagnostics HTML
            const buildSection = (title, icon, lines, borderColor) => {
                if (lines.length === 0) return '';
                return `
                    <div style="margin-top: 6px; padding: 6px 8px; background: #1a1a2e; border-radius: 4px; border-left: 3px solid ${borderColor};">
                        <div style="font-size: 0.7rem; color: ${borderColor}; font-weight: bold; margin-bottom: 4px;">${icon} ${title}</div>
                        <div style="font-size: 0.7rem; color: #a0a0a0; line-height: 1.5;">
                            ${lines.join('<br>')}
                        </div>
                    </div>
                `;
            };
            
            diagnosticsHtml = `
                <div class="image-log-item__diagnostics" style="margin-top: 10px;">
                    <details style="cursor: pointer;">
                        <summary style="font-size: 0.8rem; color: #6366f1; font-weight: bold; padding: 4px 0;">
                            🔍 Full Generation Details (click to expand)
                        </summary>
                        <div style="margin-top: 8px;">
                            ${buildSection('Model & Style', '🎨', modelStyleLines, '#6366f1')}
                            ${styleConfigLines.length > 0 ? buildSection('Style Config', '⚙️', styleConfigLines, '#8b5cf6') : ''}
                            ${visualDnaLines.length > 0 ? buildSection('Visual DNA', '🧬', visualDnaLines, details.visual_dna_suppressed ? '#f59e0b' : '#10b981') : ''}
                            ${contractLines.length > 0 ? buildSection('Visual Contract', '📜', contractLines, '#3b82f6') : ''}
                            ${continuityLines.length > 0 ? buildSection('Continuity & Character', '🔗', continuityLines, '#ec4899') : ''}
                            ${relevanceLines.length > 0 ? buildSection('Relevance Scoring', '📊', relevanceLines, details.relevance_score >= 0.65 ? '#22c55e' : '#f59e0b') : ''}
                            ${promptVerifyLines.length > 0 ? buildSection('Prompt Verification', '🔐', promptVerifyLines, '#14b8a6') : ''}
                        </div>
                    </details>
                </div>
            `;
            
            // Quick status badges (always visible)
            let quickBadges = '';
            const badges = [];
            if (details.art_style_override) badges.push(`<span style="background: #f59e0b; color: #000; padding: 1px 4px; border-radius: 2px; font-size: 0.65rem; font-weight: bold;">⚡ ${details.art_style_override}</span>`);
            if (details.visual_dna_suppressed) badges.push(`<span style="background: #ef4444; color: #fff; padding: 1px 4px; border-radius: 2px; font-size: 0.65rem;">DNA OFF</span>`);
            if (details.relevance_repaired) badges.push(`<span style="background: #8b5cf6; color: #fff; padding: 1px 4px; border-radius: 2px; font-size: 0.65rem;">🔧 REPAIRED</span>`);
            if (details.model) badges.push(`<span style="background: #1e40af; color: #fff; padding: 1px 4px; border-radius: 2px; font-size: 0.65rem;">${details.model}</span>`);
            if (details.generation_source) badges.push(`<span style="background: #065f46; color: #fff; padding: 1px 4px; border-radius: 2px; font-size: 0.65rem;">${details.generation_source}</span>`);
            if (badges.length > 0) {
                quickBadges = `<div style="margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px;">${badges.join('')}</div>`;
            }
            
            return `
            <div class="image-log-item">
                <div class="image-log-item__header">
                    <span class="image-log-item__number">Scene ${i + 1}</span>
                    ${scene.imageUrl ? '<span class="image-log-item__status image-log-item__status--done">✅</span>' : '<span class="image-log-item__status image-log-item__status--pending">⏳</span>'}
                </div>
                <div class="image-log-item__section">
                    <span class="image-log-item__label">Narration:</span>
                    <p class="image-log-item__text">${this.escapeHtml(scene.text || '')}</p>
                </div>
                <div class="image-log-item__section">
                    <span class="image-log-item__label">Image Prompt:</span>
                    <p class="image-log-item__prompt ${scene.promptMode?.includes('fallback') || scene.promptMode?.includes('keywords') ? 'prompt-fallback' : ''}">${this.escapeHtml(scene.imagePrompt || scene.image_prompt || scene.visual || 'Not yet generated')}</p>
                    ${scene.promptMode && scene.promptLen ? `<p class="image-log-item__meta" style="font-size: 0.75rem; color: #888; margin-top: 4px;">📊 Mode: <code>${scene.promptMode}</code> | Length: <code>${scene.promptLen}</code> chars${details.relevance_score ? ` | Relevance: <code style="color: ${details.relevance_score >= 0.65 ? '#22c55e' : '#f59e0b'}">${(details.relevance_score * 100).toFixed(0)}%</code>${details.relevance_repaired ? ' 🔧' : ''}` : ''}</p>` : scene.promptMode === 'keywords_fallback' ? `<p class="image-log-item__meta" style="font-size: 0.75rem; color: #f59e0b; margin-top: 4px;">⚠️ Using keywords only (full prompt pending)</p>` : ''}
                    ${quickBadges}
                </div>
                ${diagnosticsHtml}
            </div>
        `}).join('');
        
        this.debugLog('refreshImagePromptsLog', `Updated log with ${this.sceneBuilder.scenes.length} scenes`);
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
        // Extended timeout for video rendering (render.com free tier can be slow)
        // 30 scenes + effects can take 30-45 minutes
        const sceneCount = this.sceneBuilder.scenes.length || 6;
        const baseTimeout = 900; // 15 minutes minimum
        const perSceneExtra = sceneCount > 10 ? (sceneCount - 10) * 45 : 0; // 45s per scene over 10
        const maxPolls = Math.min(1500, Math.ceil((baseTimeout + perSceneExtra) / 2)); // Max 50 minutes
        const pollInterval = 2000;
        let polls = 0;
        
        // For 30 scenes: 900 + (20 * 45) = 1800s = 30 min
        // For 12 scenes: 900 + (2 * 45) = 990s = 16.5 min
        this.debugLog('pollForVideoCompletion', `Polling with timeout=${maxPolls * 2}s (${Math.round(maxPolls * 2 / 60)}min) for ${sceneCount} scenes`);
        
        while (polls < maxPolls) {
            const status = await checkJob(this.jobId);
            
            // Update progress
            this.updateProgress({
                percent: status.progress || 0,
                label: status.message || 'Assembling...'
            });
            
            // Handle both 'complete' (FFmpeg server) and 'completed' (skip_video_assembly path)
            if (status.status === 'completed' || status.status === 'complete') {
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
        // Fixed for 0-indexed step flow
        document.querySelectorAll('.step-indicator').forEach((indicator, index) => {
            indicator.classList.remove('active', 'completed');
            if (index < this.currentStep) {
                indicator.classList.add('completed');
            } else if (index === this.currentStep) {
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
        
        // Determine vibe_preset from preset defaults or category fallback
        const vibePreset = this.selectedPreset?.defaults?.vibe_preset 
            || settings.category 
            || 'slow_creepy';
        
        // Calculate scene count from pacing (priority: manual override > derived > default)
        const pace = settings.pace || 'balanced';
        const durationSec = parseInt(lengthPreset) || 60;
        const paceInfo = this.calculatePaceInfo(pace, durationSec);
        const derivedSceneCount = settings.manualSceneCount 
            ? parseInt(settings.manualSceneCount)
            : paceInfo.sceneCount;
        
        // Build effects profile based on mode
        const effectsMode = settings.effectsMode || document.getElementById('effects-mode')?.value || 'auto';
        let effectsProfile = null;
        
        if (effectsMode === 'custom' && typeof buildEffectsProfileFromSliders === 'function') {
            effectsProfile = buildEffectsProfileFromSliders();
            console.log('[Create] Using custom effects profile:', effectsProfile);
        }
        
        return {
            theme: settings.category || 'general',
            vibe_preset: vibePreset,
            length_preset: lengthPreset,
            visual_preset: settings.visualPreset || 'forest',
            visual_source: settings.visualSource || 'ai',
            image_model: settings.imageModel || 'gpt-4o',
            art_style: settings.artStyle || 'cinematic-dark',
            scene_count: derivedSceneCount,
            pace: pace,
            preview_only: false,
            // Era & Narrative settings
            era: settings.era || this.selectedPreset?.defaults?.era || 'modern',
            tone: parseFloat(settings.tone) || this.selectedPreset?.defaults?.tone || 0.5,
            ending: settings.ending || this.selectedPreset?.defaults?.ending || 'open',
            // Visual DNA override (if user made soft adjustments)
            visual_dna_override: this.visualDNA || null,
            // Effects mode and profile (v3.2)
            effects_mode: effectsMode,
            effects_profile: effectsProfile,
            // Legacy effects flags - MUST derive from profile when custom mode
            // This ensures the video-renderer respects disabled effects
            effect_fade_in: effectsProfile ? effectsProfile.fade?.fade_in !== false : (settings['effect-fadeIn'] ?? true),
            effect_fade_out: effectsProfile ? effectsProfile.fade?.fade_out !== false : (settings['effect-fadeOut'] ?? true),
            effect_transitions: effectsProfile ? effectsProfile.transitions?.enabled !== false : (settings['effect-transitions'] ?? true),
            effect_kenburns: effectsProfile ? effectsProfile.kenburns?.enabled === true : (settings['effect-kenburns'] ?? true),
            effect_filter: effectsProfile ? (effectsProfile.color_grade?.enabled === true || effectsProfile.film_grain?.enabled === true) : (settings['effect-filter'] ?? true),
            effect_vignette: effectsProfile ? effectsProfile.vignette?.enabled === true : (settings['effect-vignette'] ?? true),
            // Caption
            caption_style: settings.captionStyle || 'bold',
            // Platform targeting
            platform: this.targetPlatform || 'reels',
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
                
                <!-- Image Prompts Log (collapsible) - will be populated after generation -->
                <div class="image-log-panel">
                    <button type="button" class="image-log-toggle" id="toggle-image-log">
                        <span class="image-log-toggle__icon">📋</span>
                        <span class="image-log-toggle__text">Image Prompts Log</span>
                        <span class="image-log-toggle__hint">View narration & prompts for each scene</span>
                        <span class="image-log-toggle__arrow" id="image-log-arrow">▼</span>
                    </button>
                    <div class="image-log-content" id="image-log-content" style="display: none;">
                        <div class="image-log-list">
                            <p class="text-muted">Prompts will appear here as images are generated...</p>
                        </div>
                        <button type="button" class="btn btn--sm btn--outline" id="btn-copy-image-log">
                            📋 Copy All to Clipboard
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Setup Image Log toggle
        document.getElementById('toggle-image-log')?.addEventListener('click', () => {
            const content = document.getElementById('image-log-content');
            const arrow = document.getElementById('image-log-arrow');
            if (content && arrow) {
                const isHidden = content.style.display === 'none';
                content.style.display = isHidden ? 'block' : 'none';
                arrow.textContent = isHidden ? '▲' : '▼';
            }
        });
    }

    /**
     * Update a single image card when image is ready
     */
    updateImageCard(index, image) {
        const card = document.querySelector(`.image-preview-card[data-index="${index}"]`);
        if (!card) return;
        
        // Only count if not already loaded (prevent double counting)
        const wasLoading = card.classList.contains('image-preview-card--loading');
        
        card.classList.remove('image-preview-card--loading');
        card.classList.add('image-preview-card--loaded');
        
        const loader = card.querySelector('.image-preview-card__loader');
        if (loader && image.url) {
            loader.outerHTML = `<img src="${image.url}" class="image-preview-card__img" alt="Scene ${index + 1}">`;
        }
        
        // Update count ONLY if this card was previously loading (prevent double counting)
        if (wasLoading) {
            const countEl = document.getElementById('images-generated-count');
            if (countEl) {
                countEl.textContent = parseInt(countEl.textContent) + 1;
            }
        }
    }
    
    /**
     * Update image source indicator (Live/Parallel vs Saved/Database)
     */
    updateImageSourceIndicator(source, generated, total) {
        let indicator = document.getElementById('image-source-indicator');
        
        // Create indicator if it doesn't exist
        if (!indicator) {
            const countSection = document.querySelector('.images-progress-count');
            if (countSection) {
                indicator = document.createElement('span');
                indicator.id = 'image-source-indicator';
                indicator.className = 'image-source-badge';
                countSection.appendChild(indicator);
            }
        }
        
        if (indicator) {
            const isParallel = source === 'parallel';
            indicator.className = `image-source-badge ${isParallel ? 'image-source-badge--live' : 'image-source-badge--saved'}`;
            indicator.innerHTML = isParallel 
                ? '<span class="pulse-dot"></span> Live' 
                : '✓ Saved';
            indicator.title = isParallel 
                ? `Streaming from parallel server (${generated}/${total})` 
                : `Finalized in database (${generated}/${total})`;
        }
    }
    
    /**
     * Show banner when backend has images but UI thumbnails are missing
     */
    showImagesSyncBanner(generated, total) {
        let banner = document.getElementById('images-sync-banner');
        if (!banner) {
            const imagesStep = document.querySelector('.step-content[data-step="images"]') || 
                              document.querySelector('.images-generation-section');
            if (imagesStep) {
                banner = document.createElement('div');
                banner.id = 'images-sync-banner';
                banner.className = 'images-sync-banner';
                imagesStep.insertBefore(banner, imagesStep.firstChild);
            }
        }
        if (banner) {
            banner.innerHTML = `
                <span class="images-sync-banner__icon">ℹ️</span>
                <span class="images-sync-banner__text">
                    <strong>${generated}/${total} images are ready</strong>, but thumbnails are still syncing. 
                    You can continue anyway.
                </span>
            `;
            banner.style.display = 'flex';
        }
    }
    
    /**
     * Hide the images sync banner
     */
    hideImagesSyncBanner() {
        const banner = document.getElementById('images-sync-banner');
        if (banner) {
            banner.style.display = 'none';
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

    // ==================== BOTTOM CONSOLE ====================
    
    /**
     * Add message to the bottom console
     */
    addConsoleLog(message, type = 'info') {
        const consoleContent = document.getElementById('console-content');
        if (!consoleContent) return;
        
        const timestamp = new Date().toLocaleTimeString('en-US', { 
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
        
        // Calculate elapsed time if startTime is set
        let elapsed = '';
        if (this.startTime) {
            const elapsedMs = Date.now() - this.startTime;
            const elapsedSec = Math.floor(elapsedMs / 1000);
            elapsed = ` (+${elapsedSec}s)`;
        }
        
        const entry = document.createElement('div');
        entry.className = `console-entry console-entry--${type}`;
        entry.innerHTML = `
            <span class="console-entry__time">${timestamp}${elapsed}</span>
            <span class="console-entry__message">${message}</span>
        `;
        
        consoleContent.appendChild(entry);
        consoleContent.scrollTop = consoleContent.scrollHeight;
        
        // Update console badge count
        const badge = document.getElementById('console-badge');
        if (badge) {
            const count = consoleContent.children.length;
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline-block' : 'none';
        }
    }
    
    /**
     * Toggle the bottom console visibility
     */
    toggleConsole() {
        const console = document.getElementById('bottom-console');
        if (console) {
            console.classList.toggle('bottom-console--collapsed');
            const arrow = document.getElementById('console-arrow');
            if (arrow) {
                arrow.textContent = console.classList.contains('bottom-console--collapsed') ? '▲' : '▼';
            }
        }
    }
    
    /**
     * Clear the console
     */
    clearConsole() {
        const consoleContent = document.getElementById('console-content');
        if (consoleContent) {
            consoleContent.innerHTML = '';
        }
        const badge = document.getElementById('console-badge');
        if (badge) {
            badge.textContent = '0';
            badge.style.display = 'none';
        }
    }
    
    /**
     * Start console timing
     */
    startConsoleTiming() {
        this.startTime = Date.now();
        this.addConsoleLog('⏱️ Timer started', 'info');
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
            dna: '🧬 VISUAL DNA ANALYSIS',
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

        // Normalize result data (handle both snake_case from API and camelCase)
        const videoUrl = result.videoUrl || result.video_url;
        const duration = result.duration || result.duration_sec || 0;
        const storyText = result.story_text || result.storyText || this.formData.content;
        
        // Debug log
        console.log('[showResult] Raw result:', { 
            hasVideoUrl: !!result.videoUrl, 
            hasVideo_url: !!result.video_url, 
            resolvedUrl: videoUrl,
            duration,
            title: result.title
        });

        // Populate result
        document.getElementById('result-video').src = videoUrl || '';
        document.getElementById('btn-download').href = videoUrl || '#';
        document.getElementById('result-title').textContent = result.title || this.formData.title;
        document.getElementById('result-duration').textContent = `${duration}s`;
        document.getElementById('result-scenes').textContent = result.scenes?.length || this.sceneBuilder.scenes.length;
        document.getElementById('result-content').textContent = storyText;

        // Normalize result for addToPostQueue (ensure camelCase)
        const normalizedResult = {
            ...result,
            videoUrl: videoUrl,
            duration: duration,
            storyText: storyText
        };

        // Add to post queue automatically
        this.addToPostQueue(normalizedResult);

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

        // Visual DNA display (if available)
        const visualDna = this.formData.generationDetails?.visual_dna;
        const dnaContainer = document.getElementById('result-visual-dna');
        const dnaContent = document.getElementById('result-dna-content');
        
        if (visualDna && dnaContainer && dnaContent) {
            dnaContainer.style.display = 'block';
            dnaContent.innerHTML = `
                <div class="dna-result-grid">
                    <div class="dna-result-item">
                        <span class="dna-result-item__label">🎨 Visual Style</span>
                        <span class="dna-result-item__value dna-result-item__value--style">${visualDna.visual_style || '-'}</span>
                    </div>
                    <div class="dna-result-item">
                        <span class="dna-result-item__label">🎭 Color Palette</span>
                        <span class="dna-result-item__value dna-result-item__value--palette">${visualDna.color_palette || '-'}</span>
                    </div>
                    <div class="dna-result-item">
                        <span class="dna-result-item__label">🎥 Motion Profile</span>
                        <span class="dna-result-item__value dna-result-item__value--motion">${visualDna.motion_profile || '-'}</span>
                    </div>
                    <div class="dna-result-item">
                        <span class="dna-result-item__label">💡 Lighting</span>
                        <span class="dna-result-item__value dna-result-item__value--lighting">${visualDna.lighting_profile || '-'}</span>
                    </div>
                    <div class="dna-result-item">
                        <span class="dna-result-item__label">📺 Texture</span>
                        <span class="dna-result-item__value dna-result-item__value--texture">${visualDna.texture_artifacts || '-'}</span>
                    </div>
                    <div class="dna-result-item">
                        <span class="dna-result-item__label">📷 Camera</span>
                        <span class="dna-result-item__value dna-result-item__value--camera">${visualDna.camera_language || '-'}</span>
                    </div>
                </div>
                ${this.formData.generationDetails?.similarity ? `
                <div class="dna-result-similarity">
                    <span class="dna-result-similarity__badge ${this.formData.generationDetails.similarity.is_likely_unique ? 'dna-result-similarity__badge--unique' : 'dna-result-similarity__badge--warning'}">
                        ${this.formData.generationDetails.similarity.is_likely_unique ? '✅ Unique' : '⚠️ Similar'}
                    </span>
                    <span class="dna-result-similarity__score">
                        Similarity: ${(this.formData.generationDetails.similarity.score * 100).toFixed(1)}%
                    </span>
                </div>
                ` : ''}
            `;
        }
    }

    /**
     * Add generated video to the post queue
     */
    async addToPostQueue(result) {
        try {
            // Validate video URL
            if (!result.videoUrl) {
                console.warn('⚠️ No videoUrl in result, skipping post queue. Result keys:', Object.keys(result));
                return;
            }

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
                    platforms: this.formData.postPlatforms?.length > 0 ? [...this.formData.postPlatforms] : ['youtube_shorts', 'instagram_reels', 'facebook_reels'],
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

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Toggle the prompt section visibility
     */
    togglePromptSection() {
        const section = document.getElementById('prompt-section');
        const arrow = document.getElementById('prompt-arrow');
        if (section) {
            section.classList.toggle('prompt-section--hidden');
            if (arrow) {
                arrow.textContent = section.classList.contains('prompt-section--hidden') ? '▼' : '▲';
            }
        }
    }

    /**
     * Toggle the Visual DNA section visibility
     */
    toggleDNASection() {
        const section = document.getElementById('dna-section');
        const arrow = document.getElementById('dna-arrow');
        if (section) {
            section.classList.toggle('dna-section--hidden');
            if (arrow) {
                arrow.textContent = section.classList.contains('dna-section--hidden') ? '▼' : '▲';
            }
        }
    }

    /**
     * Copy the story prompt to clipboard
     */
    async copyPrompt() {
        const promptEl = document.getElementById('story-prompt-display');
        if (promptEl) {
            try {
                await navigator.clipboard.writeText(promptEl.textContent);
                this.addLog('📋 Prompt copied to clipboard', 'success');
            } catch (e) {
                console.error('Failed to copy prompt:', e);
            }
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
        this.currentStep = 0; // Start at Preset step (0-indexed)
        this.formData = {};
        this.selectedPreset = null;
        this.visualDNA = null;
        this.dnaLocked = false;
        this.storyLocked = false;
        this.imagesLocked = false;
        this.sceneBuilder.scenes = [];
        
        // Clear console and restart timing
        this.clearConsole();
        this.startTime = null;
        
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
                    dna: 'Fingerprinting visual uniqueness',
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
