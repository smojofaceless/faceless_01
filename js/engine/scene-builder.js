/**
 * Scene Builder
 * Handles scene creation, editing, and management
 */

class SceneBuilder {
    constructor() {
        this.scenes = [];
        this.listeners = new Map();
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

    emit(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(cb => cb(data));
        }
    }

    /**
     * Set scenes from story
     */
    setScenes(scenes) {
        this.scenes = scenes.map((scene, index) => ({
            id: scene.id || index + 1,
            text: scene.text || scene,
            imagePrompt: scene.imagePrompt || null,
            imageUrl: scene.imageUrl || null,
            duration: scene.duration || null,
            mood: scene.mood || 'neutral',
            cameraAngle: scene.cameraAngle || 'medium'
        }));
        this.emit('scenesUpdated', this.scenes);
    }

    /**
     * Parse story text into scenes
     */
    parseStoryIntoScenes(storyText, count = 6) {
        // Split by sentences
        const sentences = storyText.match(/[^.!?]+[.!?]+/g) || [storyText];
        const sentencesPerScene = Math.ceil(sentences.length / count);
        
        const scenes = [];
        for (let i = 0; i < count; i++) {
            const start = i * sentencesPerScene;
            const end = start + sentencesPerScene;
            const text = sentences.slice(start, end).join(' ').trim();
            
            if (text) {
                scenes.push({
                    id: i + 1,
                    text,
                    imagePrompt: null,
                    imageUrl: null,
                    mood: this.detectMood(text),
                    cameraAngle: this.suggestCameraAngle(i, count)
                });
            }
        }
        
        this.scenes = scenes;
        this.emit('scenesUpdated', this.scenes);
        return scenes;
    }

    /**
     * Detect mood from text
     */
    detectMood(text) {
        const lowerText = text.toLowerCase();
        
        const moodKeywords = {
            tense: ['suddenly', 'heard', 'noticed', 'strange', 'wrong', 'felt'],
            scary: ['scream', 'blood', 'dead', 'ghost', 'creature', 'monster', 'dark'],
            calm: ['peaceful', 'quiet', 'normal', 'walked', 'sat', 'looked'],
            suspense: ['waiting', 'silence', 'watching', 'slowly', 'crept', 'behind']
        };

        for (const [mood, keywords] of Object.entries(moodKeywords)) {
            if (keywords.some(kw => lowerText.includes(kw))) {
                return mood;
            }
        }
        
        return 'neutral';
    }

    /**
     * Suggest camera angle based on scene position
     */
    suggestCameraAngle(index, total) {
        // Opening: establish shot
        if (index === 0) return 'wide';
        // Climax: close-up
        if (index === total - 2) return 'close-up';
        // Ending: wide or medium
        if (index === total - 1) return 'medium';
        // Middle scenes: vary
        const angles = ['medium', 'close-up', 'over-shoulder', 'low-angle'];
        return angles[index % angles.length];
    }

    /**
     * Update a specific scene
     */
    updateScene(sceneId, updates) {
        const index = this.scenes.findIndex(s => s.id === sceneId);
        if (index !== -1) {
            this.scenes[index] = { ...this.scenes[index], ...updates };
            this.emit('sceneUpdated', { scene: this.scenes[index], index });
        }
    }

    /**
     * Reorder scenes
     */
    reorderScenes(fromIndex, toIndex) {
        const scene = this.scenes.splice(fromIndex, 1)[0];
        this.scenes.splice(toIndex, 0, scene);
        
        // Re-number scenes
        this.scenes.forEach((scene, index) => {
            scene.id = index + 1;
        });
        
        this.emit('scenesReordered', this.scenes);
    }

    /**
     * Add a new scene
     */
    addScene(afterIndex = -1) {
        const newScene = {
            id: this.scenes.length + 1,
            text: '',
            imagePrompt: null,
            imageUrl: null,
            mood: 'neutral',
            cameraAngle: 'medium'
        };

        if (afterIndex >= 0 && afterIndex < this.scenes.length) {
            this.scenes.splice(afterIndex + 1, 0, newScene);
        } else {
            this.scenes.push(newScene);
        }

        // Re-number scenes
        this.scenes.forEach((scene, index) => {
            scene.id = index + 1;
        });

        this.emit('sceneAdded', { scene: newScene, scenes: this.scenes });
        return newScene;
    }

    /**
     * Remove a scene
     */
    removeScene(sceneId) {
        const index = this.scenes.findIndex(s => s.id === sceneId);
        if (index !== -1) {
            this.scenes.splice(index, 1);
            
            // Re-number scenes
            this.scenes.forEach((scene, i) => {
                scene.id = i + 1;
            });
            
            this.emit('sceneRemoved', { sceneId, scenes: this.scenes });
        }
    }

    /**
     * Split a scene into two
     */
    splitScene(sceneId, splitPoint) {
        const index = this.scenes.findIndex(s => s.id === sceneId);
        if (index === -1) return;

        const scene = this.scenes[index];
        const text1 = scene.text.substring(0, splitPoint).trim();
        const text2 = scene.text.substring(splitPoint).trim();

        // Update current scene
        scene.text = text1;

        // Insert new scene after
        const newScene = {
            id: index + 2,
            text: text2,
            imagePrompt: null,
            imageUrl: null,
            mood: this.detectMood(text2),
            cameraAngle: 'medium'
        };

        this.scenes.splice(index + 1, 0, newScene);

        // Re-number scenes
        this.scenes.forEach((s, i) => {
            s.id = i + 1;
        });

        this.emit('sceneSplit', { originalScene: scene, newScene, scenes: this.scenes });
    }

    /**
     * Merge two adjacent scenes
     */
    mergeScenes(sceneId1, sceneId2) {
        const index1 = this.scenes.findIndex(s => s.id === sceneId1);
        const index2 = this.scenes.findIndex(s => s.id === sceneId2);

        if (index1 === -1 || index2 === -1 || Math.abs(index1 - index2) !== 1) {
            return;
        }

        const first = Math.min(index1, index2);
        const scene1 = this.scenes[first];
        const scene2 = this.scenes[first + 1];

        // Merge text
        scene1.text = `${scene1.text} ${scene2.text}`.trim();

        // Remove second scene
        this.scenes.splice(first + 1, 1);

        // Re-number scenes
        this.scenes.forEach((s, i) => {
            s.id = i + 1;
        });

        this.emit('scenesMerged', { mergedScene: scene1, scenes: this.scenes });
    }

    /**
     * Generate image prompts for all scenes
     */
    generateImagePrompts(template, settings) {
        const storyAnchor = this.buildStoryAnchor(template, settings);
        
        this.scenes.forEach((scene, index) => {
            scene.imagePrompt = this.buildScenePrompt(scene, index, template, settings, storyAnchor);
        });

        this.emit('promptsGenerated', this.scenes);
        return this.scenes;
    }

    /**
     * Build story anchor (visual consistency)
     */
    buildStoryAnchor(template, settings) {
        if (template.buildStoryAnchor) {
            return template.buildStoryAnchor(settings);
        }

        return {
            environment: settings.visualPreset || 'default',
            mood: settings.theme || 'neutral',
            artStyle: settings.artStyle || 'cinematic'
        };
    }

    /**
     * Build prompt for a single scene
     */
    buildScenePrompt(scene, index, template, settings, storyAnchor) {
        if (template.buildImagePrompt) {
            return template.buildImagePrompt(scene, index, settings, storyAnchor);
        }

        // Default prompt builder
        const artStyles = {
            'cinematic-dark': 'cinematic dark photography, moody lighting, film grain',
            'analog-horror': 'VHS aesthetic, grainy, analog horror, glitch artifacts',
            'horror-anime': 'dark anime style, manga inspired, dramatic shadows'
        };

        const artStyle = artStyles[settings.artStyle] || 'cinematic photography';
        
        return `${scene.text}. ${artStyle}. ${storyAnchor.environment}. ${storyAnchor.mood} atmosphere.`;
    }

    /**
     * Get scenes ready for API
     */
    getScenesForAPI() {
        return this.scenes.map(scene => ({
            id: scene.id,
            text: scene.text,
            imagePrompt: scene.imagePrompt,
            mood: scene.mood,
            cameraAngle: scene.cameraAngle,
            duration: scene.duration
        }));
    }

    /**
     * Render scene cards HTML
     */
    renderSceneCards(containerId, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const { editable = true, showImagePrompt = false, onEdit = null } = options;

        container.innerHTML = this.scenes.map((scene, index) => `
            <div class="scene-card" data-scene-id="${scene.id}">
                <div class="scene-card__header">
                    <span class="scene-card__number">Scene ${scene.id}</span>
                    <span class="scene-card__mood">${scene.mood}</span>
                </div>
                <div class="scene-card__body">
                    ${editable 
                        ? `<textarea class="scene-card__text" data-scene-id="${scene.id}">${scene.text}</textarea>`
                        : `<p class="scene-card__text">${scene.text}</p>`
                    }
                    ${scene.imageUrl 
                        ? `<img src="${scene.imageUrl}" class="scene-card__image" alt="Scene ${scene.id}">`
                        : `<div class="scene-card__image-placeholder">Image will appear here</div>`
                    }
                </div>
                ${showImagePrompt ? `
                    <div class="scene-card__prompt">
                        <label>Image Prompt:</label>
                        <textarea data-scene-id="${scene.id}" class="scene-card__prompt-input">${scene.imagePrompt || ''}</textarea>
                    </div>
                ` : ''}
            </div>
        `).join('');

        // Add event listeners for editable scenes
        if (editable && onEdit) {
            container.querySelectorAll('.scene-card__text').forEach(textarea => {
                textarea.addEventListener('input', (e) => {
                    const sceneId = parseInt(e.target.dataset.sceneId);
                    this.updateScene(sceneId, { text: e.target.value });
                    if (onEdit) onEdit(sceneId, 'text', e.target.value);
                });
            });
        }
    }
}

// Export for use
window.SceneBuilder = SceneBuilder;
