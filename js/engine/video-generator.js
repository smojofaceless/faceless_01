/**
 * Video Generator Engine
 * Core generation logic shared across all brand templates
 */

class VideoGenerator {
    constructor(template) {
        this.template = template;
        this.currentStep = 1;
        this.jobId = null;
        this.state = {
            settings: {},
            story: null,
            scenes: [],
            images: [],
            audio: null,
            video: null
        };
        this.listeners = new Map();
    }

    /**
     * Set the active template
     */
    setTemplate(template) {
        this.template = template;
        this.reset();
    }

    /**
     * Reset generator state
     */
    reset() {
        this.currentStep = 1;
        this.jobId = null;
        this.state = {
            settings: {},
            story: null,
            scenes: [],
            images: [],
            audio: null,
            video: null
        };
        this.emit('reset');
    }

    /**
     * Event system
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    off(event, callback) {
        if (this.listeners.has(event)) {
            const callbacks = this.listeners.get(event);
            const index = callbacks.indexOf(callback);
            if (index > -1) callbacks.splice(index, 1);
        }
    }

    emit(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(cb => cb(data));
        }
    }

    /**
     * Navigate to a step
     */
    goToStep(step) {
        if (step < 1 || step > this.template.steps.length) return;
        this.currentStep = step;
        this.emit('stepChange', { step, stepConfig: this.template.steps[step - 1] });
    }

    /**
     * Get current step config
     */
    getCurrentStepConfig() {
        return this.template.steps[this.currentStep - 1];
    }

    /**
     * Update settings
     */
    updateSettings(key, value) {
        this.state.settings[key] = value;
        this.emit('settingsUpdate', { key, value, settings: this.state.settings });
    }

    /**
     * Build the settings payload from form
     */
    buildSettingsPayload(formData) {
        const settings = { ...formData };
        
        // Apply template defaults
        if (this.template.defaults) {
            for (const [key, value] of Object.entries(this.template.defaults)) {
                if (settings[key] === undefined) {
                    settings[key] = value;
                }
            }
        }

        // Add template metadata
        settings._template = this.template.id;
        settings._niche = this.template.niche;

        this.state.settings = settings;
        return settings;
    }

    /**
     * Generate story/content
     */
    async generateContent() {
        this.emit('log', { message: 'Generating content...', type: 'info' });
        
        try {
            const settings = this.state.settings;
            
            // Check if template has buildContentPrompt method
            if (!this.template.buildContentPrompt) {
                throw new Error('Template does not have buildContentPrompt method');
            }
            
            const prompt = this.template.buildContentPrompt(settings);
            
            this.emit('log', { message: 'Sending request to API...', type: 'info' });
            
            const response = await API.generateStory({
                prompt,
                niche: this.template.niche || this.template._nicheConfig?.name || 'general',
                settings
            });

            // Validate response
            if (!response) {
                throw new Error('No response received from API');
            }
            
            // Handle different response formats
            // Food-facts returns: { facts: [...], hook, outro }
            // Horror/generic returns: { story, scenes: [...] }
            // Some templates return story as array of scene objects
            if (response.facts && Array.isArray(response.facts)) {
                // Convert facts format to scenes format
                this.state.story = response.hook + ' ' + response.facts.map(f => f.text).join(' ') + ' ' + (response.outro || '');
                this.state.scenes = response.facts.map((fact, i) => ({
                    id: i + 1,
                    text: fact.text,
                    imagePrompt: fact.visualSuggestion || fact.text
                }));
            } else if (Array.isArray(response.story)) {
                // Story returned as array of scene objects
                console.log('[VideoGenerator] Story is an array, converting to scenes...');
                this.state.scenes = response.story.map((scene, i) => ({
                    id: i + 1,
                    text: scene.text || scene.narration || scene,
                    imagePrompt: scene.imagePrompt || scene.image_prompt || scene.visual || scene.text || ''
                }));
                this.state.story = this.state.scenes.map(s => s.text).join(' ');
            } else if (response.scenes && Array.isArray(response.scenes) && response.scenes.length > 0) {
                // Scenes array provided directly
                console.log('[VideoGenerator] Using provided scenes array');
                this.state.scenes = response.scenes.map((scene, i) => ({
                    id: scene.id || i + 1,
                    text: scene.text || scene.narration || '',
                    imagePrompt: scene.imagePrompt || scene.image_prompt || scene.visual || scene.text || ''
                }));
                this.state.story = typeof response.story === 'string' ? response.story : this.state.scenes.map(s => s.text).join(' ');
            } else {
                // Standard story string format
                this.state.story = typeof response.story === 'string' ? response.story : '';
                this.state.scenes = this.state.story ? this.parseScenes(this.state.story) : [];
            }
            
            // Ensure we have content
            if (!this.state.story && this.state.scenes.length === 0) {
                throw new Error('API returned empty content. Check your API key in Settings.');
            }
            
            // Build normalized response
            const normalizedResponse = {
                success: true,
                title: response.title,
                story: this.state.story,
                scenes: this.state.scenes,
                hook: response.hook
            };
            
            this.emit('contentGenerated', normalizedResponse);

            return normalizedResponse;
        } catch (error) {
            console.error('Content generation error:', error);
            this.emit('error', { message: error.message, phase: 'content' });
            throw error;
        }
    }

    /**
     * Parse story into scenes (fallback if not provided by API)
     */
    parseScenes(story) {
        // Handle undefined/empty story
        if (!story || typeof story !== 'string') {
            console.warn('parseScenes: Invalid story input, returning empty scenes');
            return [];
        }
        
        // Split by sentences, group into scenes
        const sentences = story.match(/[^.!?]+[.!?]+/g) || [story];
        const scenesCount = this.state.settings.sceneCount || 6;
        const sentencesPerScene = Math.ceil(sentences.length / scenesCount);
        
        const scenes = [];
        for (let i = 0; i < scenesCount; i++) {
            const start = i * sentencesPerScene;
            const end = start + sentencesPerScene;
            const text = sentences.slice(start, end).join(' ').trim();
            if (text) {
                scenes.push({
                    id: i + 1,
                    text,
                    imagePrompt: null
                });
            }
        }
        
        return scenes;
    }

    /**
     * Create job and start generation pipeline
     */
    async startGeneration() {
        this.emit('generationStart');
        this.emit('log', { message: '🚀 Starting video generation pipeline...', type: 'info' });
        this.emit('log', { message: `Template: ${this.template.name} (${this.template.niche})`, type: 'verbose' });

        try {
            // Build complete payload
            const payload = this.buildJobPayload();
            this.emit('log', { message: `Scenes: ${payload.scenes?.length || 0}`, type: 'verbose' });
            this.emit('log', { message: `Visual Source: ${payload.settings?.visualSource || 'ai'}`, type: 'verbose' });
            
            // Create job
            this.emit('log', { message: '📝 Creating job on server...', type: 'info' });
            const createResponse = await API.createJob(payload);
            
            // Handle both job_id (from API) and jobId (camelCase)
            this.jobId = createResponse.job_id || createResponse.jobId;
            
            if (!this.jobId) {
                throw new Error('No job ID returned from createJob');
            }
            
            this.emit('jobCreated', { jobId: this.jobId });
            this.emit('log', { message: `✅ Job created: ${this.jobId.substring(0, 8)}...`, type: 'success' });
            this.emit('log', { message: `Full Job ID: ${this.jobId}`, type: 'debug' });

            // Start the job
            await this.runJob();
            
        } catch (error) {
            this.emit('log', { message: `❌ Job creation failed: ${error.message}`, type: 'error' });
            this.emit('error', { message: error.message, phase: 'creation' });
            throw error;
        }
    }

    /**
     * Build the job payload
     */
    buildJobPayload() {
        const settings = this.state.settings;
        
        return {
            niche: this.template.niche,
            template: this.template.id,
            title: this.state.story?.title || settings.title || 'Untitled',
            story: this.state.story?.text || this.state.story,
            scenes: this.state.scenes,
            settings: {
                ...settings,
                effects: this.getSelectedEffects(),
                captionStyle: settings.captionStyle,
                duration: settings.duration,
                visualSource: settings.visualSource,
                imageModel: settings.imageModel
            },
            // Template-specific prompt builders
            prompts: this.template.buildPrompts(settings)
        };
    }

    /**
     * Get selected effects from settings
     */
    getSelectedEffects() {
        const effects = [];
        const settings = this.state.settings;
        
        // Iterate through template effects
        if (this.template.effects) {
            for (const category of this.template.effects) {
                for (const effect of category.items) {
                    if (settings[`effect-${effect.id}`]) {
                        effects.push(effect.id);
                    }
                }
            }
        }
        
        return effects;
    }

    /**
     * Run the job and poll for status
     */
    async runJob() {
        this.emit('log', { message: '▶️ Starting job execution...', type: 'info' });
        this.emit('phaseChange', { phase: 'story', status: 'active', message: 'Initializing...' });
        
        try {
            // Trigger job run
            this.emit('log', { message: 'Sending run request to edge function...', type: 'verbose' });
            await API.runJob(this.jobId);
            this.emit('log', { message: 'Job started successfully', type: 'verbose' });
            
            // Poll for status
            await this.pollJobStatus();
            
        } catch (error) {
            this.emit('log', { message: `❌ Execution failed: ${error.message}`, type: 'error' });
            this.emit('error', { message: error.message, phase: 'execution' });
            throw error;
        }
    }

    /**
     * Poll job status until complete
     */
    async pollJobStatus() {
        const pollInterval = 2000; // 2 seconds
        const maxPolls = 300; // 10 minutes max
        let polls = 0;
        let lastPhase = '';

        this.emit('log', { message: '🔄 Starting status polling...', type: 'verbose' });

        while (polls < maxPolls) {
            try {
                const status = await API.checkJob(this.jobId);
                
                this.emit('statusUpdate', status);
                
                // Log phase changes
                if (status.phase && status.phase !== lastPhase) {
                    this.emit('log', { message: `Phase changed: ${lastPhase || 'init'} → ${status.phase}`, type: 'debug' });
                    lastPhase = status.phase;
                }
                
                this.updateProgress(status);

                if (status.status === 'completed') {
                    this.emit('log', { message: '🎉 Video generation complete!', type: 'success' });
                    this.emit('phaseChange', { phase: 'video', status: 'completed' });
                    this.state.video = status.result;
                    this.emit('generationComplete', status.result);
                    return;
                }

                if (status.status === 'failed') {
                    throw new Error(status.error || 'Job failed');
                }

                // Update images as they come in
                if (status.images && status.images.length > this.state.images.length) {
                    const newCount = status.images.length - this.state.images.length;
                    this.emit('log', { message: `🖼️ ${newCount} new image(s) generated (${status.images.length} total)`, type: 'info' });
                    this.state.images = status.images;
                    this.emit('imagesUpdate', status.images);
                }

                await this.sleep(pollInterval);
                polls++;
                
                // Log poll count periodically
                if (polls % 10 === 0) {
                    this.emit('log', { message: `Still processing... (${polls * 2}s elapsed)`, type: 'verbose' });
                }
                
            } catch (error) {
                this.emit('log', { message: `Polling error: ${error.message}`, type: 'debug' });
                this.emit('error', { message: error.message, phase: 'polling' });
                throw error;
            }
        }

        throw new Error('Job timed out after 10 minutes');
    }

    /**
     * Update progress based on status
     */
    updateProgress(status) {
        const phase = status.phase || 'unknown';
        const progress = status.progress || 0;
        
        let label = 'Processing...';
        let phaseMessage = '';
        
        switch (phase) {
            case 'story':
                label = '📖 Generating story script...';
                phaseMessage = 'Creating your narrative...';
                this.emit('phaseChange', { phase: 'story', status: 'active', message: phaseMessage });
                break;
            case 'images':
                const imgComplete = status.imagesComplete || 0;
                const imgTotal = status.imagesTotal || 0;
                label = `🎨 Generating images (${imgComplete}/${imgTotal})...`;
                phaseMessage = `Creating scene ${imgComplete + 1} of ${imgTotal}`;
                this.emit('phaseChange', { phase: 'images', status: 'active', message: phaseMessage });
                // Mark story as complete when images start
                if (imgComplete === 0) {
                    this.emit('phaseChange', { phase: 'story', status: 'completed' });
                }
                break;
            case 'audio':
                label = '🔊 Generating voice narration...';
                phaseMessage = 'Creating audio track...';
                this.emit('phaseChange', { phase: 'images', status: 'completed' });
                this.emit('phaseChange', { phase: 'audio', status: 'active', message: phaseMessage });
                break;
            case 'video':
                label = '🎬 Assembling final video...';
                phaseMessage = 'Rendering video frames...';
                this.emit('phaseChange', { phase: 'audio', status: 'completed' });
                this.emit('phaseChange', { phase: 'video', status: 'active', message: phaseMessage });
                break;
            case 'upload':
                label = '☁️ Uploading video...';
                phaseMessage = 'Saving to cloud storage...';
                break;
            case 'complete':
                label = '✅ Generation complete!';
                this.emit('phaseChange', { phase: 'video', status: 'completed' });
                break;
        }

        this.emit('progress', { percent: progress, label, phase });
        this.emit('log', { message: label, type: 'info' });
    }

    /**
     * Sleep helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Calculate cost estimate
     */
    calculateCost() {
        const settings = this.state.settings;
        const sceneCount = settings.sceneCount || 6;
        
        let imageCost = 0;
        if (settings.visualSource === 'ai') {
            const modelCosts = {
                'dall-e-3': 0.08,
                'gpt-4o': 0.016,
                'flux': 0.04
            };
            imageCost = (modelCosts[settings.imageModel] || 0.04) * sceneCount;
        }
        
        const storyCost = 0.01;
        const voiceCost = 0.05;
        
        return {
            story: storyCost,
            voice: voiceCost,
            images: imageCost,
            total: storyCost + voiceCost + imageCost
        };
    }
}

// Export for use
window.VideoGenerator = VideoGenerator;
