/**
 * Generic Template
 * Smart fallback template that adapts to any niche
 * Uses NicheConfigs for niche-specific settings
 */

const GenericTemplate = {
    id: 'generic',
    niche: 'general',
    name: 'Content Generator',
    icon: '🎬',
    description: 'Generate engaging short-form video content',

    // Neutral theme (overridden by niche config)
    theme: {
        primary: '#8b5cf6',
        secondary: '#6366f1',
        accent: '#a855f7',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #1a1a2e 100%)',
        vibe: 'dark'
    },

    // Standard workflow
    steps: [
        { id: 'settings', name: 'Settings', icon: '⚙️' },
        { id: 'content', name: 'Content', icon: '📝' },
        { id: 'generate', name: 'Generate', icon: '🎬' }
    ],

    // Default settings
    defaults: {
        duration: 'medium',
        sceneCount: 5,
        captionStyle: 'bold',
        visualSource: 'ai',
        imageModel: 'gpt-4o'
    },

    /**
     * Get settings configured for a specific niche
     * This allows the generic template to adapt to any niche
     */
    getSettingsForNiche(niche) {
        const config = window.getNicheConfig ? window.getNicheConfig(niche) : null;
        
        if (config) {
            return {
                contentTypes: config.contentTypes,
                visualStyles: config.visualStyles.map(style => ({
                    value: style.value,
                    label: style.label,
                    description: style.prompt,
                    prompt: style.prompt
                })),
                durations: this.settings.durations,
                captionStyles: this.settings.captionStyles,
                _nicheConfig: config // Store for prompt building
            };
        }
        
        return this.settings;
    },

    // Basic settings (fallback)
    settings: {
        contentTypes: [
            { value: 'story', label: 'Story / Narrative', icon: '📖' },
            { value: 'facts', label: 'Facts / Educational', icon: '💡' },
            { value: 'tips', label: 'Tips & Tricks', icon: '✨' },
            { value: 'review', label: 'Review / Opinion', icon: '⭐' }
        ],

        visualStyles: [
            {
                value: 'cinematic',
                label: '🎬 Cinematic',
                description: 'Professional, film-like quality',
                prompt: 'cinematic photography, professional lighting, shallow depth of field, 4K quality'
            },
            {
                value: 'clean',
                label: '✨ Clean Modern',
                description: 'Minimalist and professional',
                prompt: 'clean modern photography, minimalist, professional, well-lit'
            },
            {
                value: 'vibrant',
                label: '🌈 Vibrant',
                description: 'Bold and eye-catching',
                prompt: 'vibrant colorful photography, bold colors, eye-catching, saturated'
            }
        ],

        durations: [
            { value: 'short', label: 'Short (~30 seconds)', words: [80, 120] },
            { value: 'medium', label: 'Medium (~45 seconds)', words: [120, 180] },
            { value: 'long', label: 'Long (~60 seconds)', words: [180, 250] }
        ],

        captionStyles: [
            { value: 'bold', label: 'BOLD', class: 'caption-bold' },
            { value: 'clean', label: 'Clean', class: 'caption-clean' },
            { value: 'minimal', label: 'minimal', class: 'caption-minimal' }
        ]
    },

    // Basic effects
    effects: [
        {
            category: 'transitions',
            label: '🎬 TRANSITIONS',
            color: 'purple',
            items: [
                { id: 'fade-in', label: 'Fade In', time: '+2s', default: true },
                { id: 'fade-out', label: 'Fade Out', time: '+2s', default: true },
                { id: 'transitions', label: 'Scene Transitions', time: '+0s', default: true }
            ]
        },
        {
            category: 'motion',
            label: '✨ MOTION',
            color: 'blue',
            items: [
                { id: 'kenburns', label: 'Ken Burns Motion', time: '+0s', default: true },
                { id: 'zoom', label: 'Subtle Zoom', time: '+1s', default: false }
            ]
        }
    ],

    musicStyles: [
        { value: 'ambient', label: '🎵 Ambient' },
        { value: 'upbeat', label: '🎶 Upbeat' },
        { value: 'chill', label: '😌 Chill' }
    ],

    buildContentPrompt(settings) {
        const contentType = this.settings.contentTypes.find(c => c.value === settings.contentType) || this.settings.contentTypes[0];
        const duration = this.settings.durations.find(d => d.value === settings.duration) || this.settings.durations[1];
        const wordRange = duration.words;

        return `Create engaging ${contentType.label.toLowerCase()} content for a short video.

Topic: ${settings.topic || 'general interest topic'}

REQUIREMENTS:
- Length: ${wordRange[0]}-${wordRange[1]} words
- Style: ${contentType.label}
- Engaging and shareable
- Clear beginning, middle, and end
- Will be split into ${settings.sceneCount || 5} scenes

Return only the content text.`;
    },

    buildPrompts(settings) {
        const visualStyle = this.settings.visualStyles.find(v => v.value === settings.visualStyle) || this.settings.visualStyles[0];

        return {
            visualStyle: visualStyle.prompt,
            negativePrompt: 'blurry, low quality, text, watermark, ugly'
        };
    },

    buildImagePrompt(scene, index, settings) {
        const visualStyle = this.settings.visualStyles.find(v => v.value === settings.visualStyle) || this.settings.visualStyles[0];

        return `${scene.text}

Style: ${visualStyle.prompt}
Composition: professional, well-composed
No text, no watermarks`;
    },

    calculateCost(settings) {
        const sceneCount = settings.sceneCount || 5;
        let imageCost = settings.visualSource === 'ai' ? 0.016 * sceneCount : 0;
        
        return {
            story: 0.01,
            voice: 0.05,
            images: imageCost,
            total: 0.01 + 0.05 + imageCost
        };
    }
};

// Register template
if (window.templateLoader) {
    window.templateLoader.register(GenericTemplate);
}

window.GenericTemplate = GenericTemplate;
