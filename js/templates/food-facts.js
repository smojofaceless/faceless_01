/**
 * Food Facts Template
 * Configuration for food facts video generation
 * Demonstrates a DIFFERENT workflow than horror
 */

const FoodFactsTemplate = {
    id: 'food-facts',
    niche: 'food',
    name: 'Food Facts',
    icon: '🍕',
    description: 'Generate engaging food facts videos with appetizing visuals',

    // Theme configuration - bright and appetizing
    theme: {
        primary: '#22c55e',
        secondary: '#f59e0b',
        accent: '#ef4444',
        background: 'linear-gradient(135deg, #fefce8 0%, #ecfccb 50%, #fef3c7 100%)',
        vibe: 'light'
    },

    // SIMPLER workflow - no scene editing needed
    steps: [
        { id: 'topic', name: 'Topic', icon: '🍽️' },
        { id: 'facts', name: 'Facts', icon: '💡' },
        { id: 'generate', name: 'Generate', icon: '🎬' }
    ],

    // Default settings
    defaults: {
        factCount: 5,
        duration: 'short',
        visualSource: 'pexels', // Free stock for food
        captionStyle: 'bold-colored',
        musicStyle: 'upbeat'
    },

    // Settings configuration
    settings: {
        // Food categories
        categories: [
            { value: 'general', label: 'General Food Facts', icon: '🍽️' },
            { value: 'fruits', label: 'Fruits & Vegetables', icon: '🍎' },
            { value: 'cuisine', label: 'World Cuisines', icon: '🌍' },
            { value: 'history', label: 'Food History', icon: '📜' },
            { value: 'science', label: 'Food Science', icon: '🔬' },
            { value: 'weird', label: 'Weird Food Facts', icon: '🤯' },
            { value: 'healthy', label: 'Health & Nutrition', icon: '💪' }
        ],

        // Content styles
        contentStyles: [
            { 
                value: 'surprising', 
                label: '🤯 Mind-Blowing', 
                description: 'Shocking facts that surprise viewers',
                hook: 'Did you know...'
            },
            { 
                value: 'educational', 
                label: '📚 Educational', 
                description: 'Informative and teaches something new',
                hook: 'Here\'s why...'
            },
            { 
                value: 'listicle', 
                label: '📋 Countdown', 
                description: '5 facts about X format',
                hook: 'Number 5...'
            },
            { 
                value: 'debunk', 
                label: '❌ Myth Busters', 
                description: 'Common myths debunked',
                hook: 'You\'ve been lied to...'
            }
        ],

        // Visual styles (different from horror!)
        visualStyles: [
            {
                value: 'professional',
                label: '📸 Professional Food Photography',
                description: 'Clean, bright, appetizing shots',
                prompt: 'professional food photography, bright lighting, clean background, appetizing, 4K, shallow depth of field'
            },
            {
                value: 'rustic',
                label: '🪵 Rustic & Natural',
                description: 'Wooden boards, natural light, organic feel',
                prompt: 'rustic food photography, wooden table, natural light, organic ingredients, farm to table aesthetic'
            },
            {
                value: 'minimal',
                label: '⬜ Clean Minimal',
                description: 'White backgrounds, isolated subjects',
                prompt: 'minimalist food photography, white background, isolated subject, clean and modern, commercial style'
            },
            {
                value: 'colorful',
                label: '🌈 Vibrant & Colorful',
                description: 'Bold colors, eye-catching compositions',
                prompt: 'vibrant food photography, bold colors, eye-catching, Instagram style, saturated colors'
            }
        ],

        // Duration options
        durations: [
            { value: 'short', label: 'Short (~20 seconds)', facts: 3 },
            { value: 'medium', label: 'Medium (~35 seconds)', facts: 5 },
            { value: 'long', label: 'Long (~50 seconds)', facts: 7 }
        ],

        // Caption styles (food-appropriate)
        captionStyles: [
            { value: 'bold-colored', label: 'BOLD', class: 'caption-food-bold' },
            { value: 'clean', label: 'Clean', class: 'caption-food-clean' },
            { value: 'playful', label: 'Playful!', class: 'caption-food-playful' },
            { value: 'elegant', label: 'Elegant', class: 'caption-food-elegant' }
        ]
    },

    // Simpler effects for food content
    effects: [
        {
            category: 'transitions',
            label: '🎬 TRANSITIONS',
            color: 'green',
            items: [
                { id: 'fade', label: 'Smooth Fades', time: '+0s', default: true },
                { id: 'zoom', label: 'Zoom Transitions', time: '+0s', default: true },
                { id: 'slide', label: 'Slide Transitions', time: '+0s', default: false }
            ]
        },
        {
            category: 'motion',
            label: '✨ MOTION',
            color: 'amber',
            items: [
                { id: 'kenburns', label: 'Ken Burns (Slow Pan)', time: '+0s', default: true },
                { id: 'bounce', label: 'Bounce on Facts', time: '+1s', default: false },
                { id: 'pop', label: 'Pop-in Numbers', time: '+1s', default: true }
            ]
        },
        {
            category: 'enhancement',
            label: '🎨 ENHANCEMENT',
            color: 'emerald',
            items: [
                { id: 'saturation', label: 'Boost Saturation', time: '+2s', default: true },
                { id: 'warmth', label: 'Warm Color Grade', time: '+2s', default: false },
                { id: 'sharpness', label: 'Extra Sharpness', time: '+1s', default: false }
            ]
        }
    ],

    // Music options (upbeat, not scary!)
    musicStyles: [
        { value: 'upbeat', label: '🎵 Upbeat & Fun' },
        { value: 'jazzy', label: '🎷 Jazzy Lounge' },
        { value: 'acoustic', label: '🎸 Acoustic Chill' },
        { value: 'electronic', label: '🎹 Upbeat Electronic' }
    ],

    /**
     * Build the content generation prompt (DIFFERENT from horror)
     */
    buildContentPrompt(settings) {
        const category = this.settings.categories.find(c => c.value === settings.category) || this.settings.categories[0];
        const style = this.settings.contentStyles.find(s => s.value === settings.contentStyle) || this.settings.contentStyles[0];
        const duration = this.settings.durations.find(d => d.value === settings.duration) || this.settings.durations[1];

        const factCount = duration.facts;
        const topic = settings.topic || category.label;

        return `Generate ${factCount} fascinating facts about "${topic}" for a short video.

REQUIREMENTS:
- Category: ${category.label}
- Style: ${style.description}
- Each fact should be 1-2 sentences (15-25 words max)
- Facts should be surprising, engaging, and shareable
- Use the hook style: "${style.hook}"
- Facts should flow naturally from one to the next
- End with the most mind-blowing fact

FORMAT (return as JSON):
{
  "title": "Short catchy title",
  "hook": "Opening hook line",
  "facts": [
    { "number": 1, "text": "Fact text here", "visualSuggestion": "what to show" },
    ...
  ],
  "outro": "Call to action or teaser for next video"
}`;
    },

    /**
     * Build prompts object for the job
     */
    buildPrompts(settings) {
        const visualStyle = this.settings.visualStyles.find(v => v.value === settings.visualStyle) || this.settings.visualStyles[0];

        return {
            visualStyle: visualStyle.prompt,
            negativePrompt: 'ugly, unappetizing, rotten, moldy, blurry, low quality, text, watermark'
        };
    },

    /**
     * Build image prompt for a fact (DIFFERENT logic from horror)
     */
    buildImagePrompt(fact, index, settings) {
        const visualStyle = this.settings.visualStyles.find(v => v.value === settings.visualStyle) || this.settings.visualStyles[0];

        // Use the visual suggestion from the fact if available
        const subject = fact.visualSuggestion || fact.text;

        return `${subject}

Style: ${visualStyle.prompt}
Mood: bright, appetizing, engaging
Lighting: professional studio lighting or natural daylight
Composition: centered subject, clean background

High quality food photography, commercial style, no text, no watermarks`;
    },

    /**
     * Parse facts from API response
     */
    parseFacts(response) {
        // Handle both string and object responses
        if (typeof response === 'string') {
            try {
                response = JSON.parse(response);
            } catch {
                // If not JSON, split by newlines
                const lines = response.split('\n').filter(l => l.trim());
                return lines.map((text, i) => ({
                    number: i + 1,
                    text: text.replace(/^\d+\.\s*/, ''),
                    visualSuggestion: text
                }));
            }
        }

        return response.facts || [];
    },

    /**
     * Calculate cost estimate
     */
    calculateCost(settings) {
        const factCount = settings.factCount || 5;
        
        let imageCost = 0;
        if (settings.visualSource === 'ai') {
            imageCost = 0.016 * factCount; // GPT-4o default
        }
        // Pexels is free!
        
        return {
            story: 0.005, // Shorter prompts
            voice: 0.03,  // Shorter audio
            images: imageCost,
            video: 0,
            total: 0.005 + 0.03 + imageCost
        };
    }
};

// Register template
if (window.templateLoader) {
    window.templateLoader.register(FoodFactsTemplate);
}

// Export
window.FoodFactsTemplate = FoodFactsTemplate;
