/**
 * Horror Stories Template
 * Full configuration for horror video generation
 * 
 * Features Visual DNA v2.1:
 * - Automated visual fingerprinting for uniqueness
 * - Weighted similarity scoring (style 35%, palette 25%, motion 15%, lighting 10%, texture 15%)
 * - Half-life decay (48h = 50% influence reduction)
 * - Genre-locked style forcing for analog_horror
 */

const HorrorTemplate = {
    id: 'horror',
    niche: 'horror',
    name: 'Horror Stories',
    icon: '👻',
    description: 'Generate terrifying short horror stories with atmospheric visuals',
    
    // Visual DNA configuration hints (used by backend)
    visualDNA: {
        enabled: true,
        version: '2.1',
        features: ['fingerprint', 'similarity', 'variety-forcing', 'shadow-profiles']
    },

    // Theme configuration
    theme: {
        primary: '#ef4444',
        secondary: '#9b59b6',
        accent: '#ff6b6b',
        background: 'linear-gradient(135deg, #0a0a0f 0%, #1a0a1a 50%, #0a0a0f 100%)',
        vibe: 'dark'
    },

    // NEW: 6-step workflow (0-5)
    steps: [
        { id: 'preset', name: 'Preset', icon: '🎯', subtitle: 'Pick a vibe. We\'ll auto-fill the engine settings.' },
        { id: 'settings', name: 'Settings', icon: '⚙️', subtitle: 'Define intent. DNA handles uniqueness + look.' },
        { id: 'story', name: 'Story', icon: '📖', subtitle: 'Review narrative. Approve to lock the visual world.' },
        { id: 'visual-dna', name: 'Visual DNA', icon: '🧬', subtitle: 'Style is derived. Optional safe rotations available.' },
        { id: 'images', name: 'Images', icon: '🎨', subtitle: 'Approve frames. Regenerate individual scenes if needed.' },
        { id: 'assemble', name: 'Assemble', icon: '🎬', subtitle: 'Platform-tuned render + final preview.' }
    ],

    // NEW: Genre presets (Step 0)
    // v4.0: Only two active story engines + custom option
    // Deprecated presets (true_crime, analog_horror, cosmic_horror, neutral) removed from UI
    presets: [
        {
            id: 'urban_legend',
            name: 'Urban Legend',
            icon: '📜',
            tagline: 'Documentary folklore',
            description: 'Classic creepypasta with authority denial, repeating motifs, and ambiguous endings.',
            defaults: {
                vibe_preset: 'urban_legend',
                era: '1990s',
                tone: 0.6,
                ending: 'unresolved',
                visual_style: 'VHS_degraded',
                color_palette: 'sickly_green',
                motion_profile: 'micro_jitter'
            }
        },
        {
            id: 'one_too_many',
            name: 'One Too Many',
            icon: '👥',
            tagline: 'Counting horror',
            description: 'N friends went on a trip... but the photo shows N+1. The extra is never explained.',
            defaults: {
                vibe_preset: 'one_too_many',
                era: 'modern',
                tone: 0.7,
                ending: 'unresolved',
                // CRITICAL: Force uncanny-illustrated style for this preset
                art_style: 'uncanny-illustrated',
                visual_style: 'documentary',
                color_palette: 'cold_blue',
                motion_profile: 'static_tension'
            }
        },
        {
            id: 'custom',
            name: 'Custom DNA',
            icon: '🧬',
            tagline: 'Full control',
            description: 'Advanced users only. Define your own DNA parameters.',
            requiresAdvanced: true,
            defaults: {}
        }
    ],

    // Default settings
    defaults: {
        duration: 'long',
        sceneCount: 12,
        captionStyle: 'bold',
        visualSource: 'ai',
        imageModel: 'gpt-4o',
        preset: 'urban_legend'
    },

    // Settings configuration for the UI
    settings: {
        // Horror themes
        themes: [
            { value: 'general', label: 'General Horror', icon: '👻' },
            { value: 'paranormal', label: 'Paranormal / Ghosts', icon: '👻' },
            { value: 'creature', label: 'Creature Horror', icon: '🦇' },
            { value: 'psychological', label: 'Psychological Horror', icon: '🧠' },
            { value: 'folklore', label: 'Folklore / Urban Legend', icon: '📜' },
            { value: 'cosmic', label: 'Cosmic Horror', icon: '🌌' }
        ],

        // NEW: Eras for narrative context
        eras: [
            { value: '1970s', label: '1970s', description: 'Analog era, rotary phones, station wagons' },
            { value: '1980s', label: '1980s', description: 'VHS tapes, malls, early computing' },
            { value: '1990s', label: '1990s', description: 'Early internet, camcorders, suburbs' },
            { value: '2000s', label: '2000s', description: 'Flip phones, forums, found footage' },
            { value: 'modern', label: 'Modern', description: 'Smartphones, social media, streaming' },
            { value: 'timeless', label: 'Timeless', description: 'No specific era, universal dread' }
        ],

        // NEW: Ending types
        endings: [
            { value: 'unresolved', label: 'Unresolved', description: 'Mystery remains, lingering dread' },
            { value: 'suppressed', label: 'Suppressed', description: 'Truth hidden, covered up' },
            { value: 'cyclical', label: 'Cyclical', description: 'It happens again, pattern repeats' },
            { value: 'open', label: 'Open', description: 'Viewer decides, ambiguous fate' },
            { value: 'reveal', label: 'Reveal', description: 'Truth exposed, final twist' }
        ],

        // NEW: Uniqueness modes
        uniquenessModes: [
            { value: 'normal', label: 'Normal', description: 'Balanced variety and consistency' },
            { value: 'strict', label: 'Strict', description: 'Maximum uniqueness enforcement' },
            { value: 'experimental', label: 'Experimental', description: 'Allow more similarity for testing' }
        ],

        // NEW: Rarity bias (Advanced)
        rarityBias: [
            { value: 'low', label: 'Low', description: 'Prefer common, reliable combinations' },
            { value: 'normal', label: 'Normal', description: 'Balanced rarity selection' },
            { value: 'aggressive', label: 'Aggressive', description: 'Prefer rare, unusual combinations' }
        ],

        // Story vibes
        vibes: [
            { 
                value: 'slow_creepy', 
                label: '🐢 Slow Creepy', 
                description: 'Atmospheric buildup with dread',
                pacing: 'slow',
                tension: 'gradual'
            },
            { 
                value: 'punchy_shock', 
                label: '⚡ Punchy Shock', 
                description: 'Fast-paced with twist ending',
                pacing: 'fast',
                tension: 'sudden'
            },
            { 
                value: 'atmospheric', 
                label: '🌫️ Atmospheric', 
                description: 'Mood-driven environmental dread',
                pacing: 'medium',
                tension: 'ambient'
            },
            { 
                value: 'urban_legend', 
                label: '📰 Urban Legend', 
                description: 'Faux true-crime documentary style',
                pacing: 'medium',
                tension: 'documentary'
            }
        ],

        // Visual environments
        visualPresets: [
            { value: 'forest', label: 'Dark Forest', icon: '🌲' },
            { value: 'hallway', label: 'Abandoned Hallway', icon: '🚪' },
            { value: 'attic', label: 'Dusty Attic', icon: '🏚️' },
            { value: 'foggy', label: 'Foggy Landscape', icon: '🌫️' },
            { value: 'rain', label: 'Rainy Night', icon: '🌧️' }
        ],

        // Art styles for AI image generation
        artStyles: [
            {
                value: 'cinematic-dark',
                label: '🎬 Cinematic Dark Photography',
                description: 'A24 horror film aesthetic. Moody desaturated colors, deep shadows, film grain.',
                prompt: 'cinematic dark photography, A24 horror film style, moody desaturated colors, deep shadows, film grain, shallow depth of field'
            },
            {
                value: 'analog-horror',
                label: '📼 Analog Horror / VHS Glitch',
                description: 'VHS static, tracking lines, found footage aesthetic.',
                prompt: 'analog horror VHS aesthetic, tracking distortion, grainy footage, retro horror, scanlines, glitch artifacts'
            },
            {
                value: 'editorial-cartoon',
                label: '📰 Editorial Cartoon / Satirical Comic',
                description: 'Bold lines, exaggerated expressions, newspaper illustration style.',
                prompt: 'editorial cartoon style, bold black outlines, exaggerated features, satirical illustration, newspaper comic aesthetic'
            },
            {
                value: 'horror-anime',
                label: '🎌 Dark Anime / Manga Style',
                description: 'Japanese horror manga aesthetic with dramatic shadows.',
                prompt: 'dark anime style, horror manga aesthetic, dramatic shadows, cel shaded, Japanese horror illustration'
            },
            {
                value: 'oil-painting',
                label: '🖼️ Classic Oil Painting',
                description: 'Renaissance horror, dramatic chiaroscuro lighting.',
                prompt: 'classical oil painting style, renaissance horror, dramatic chiaroscuro lighting, rich dark colors, baroque horror'
            },
            {
                value: 'found-footage',
                label: '📹 Found Footage / Grainy',
                description: 'Security camera aesthetic, low quality, unsettling.',
                prompt: 'found footage style, security camera quality, grainy low resolution, night vision green tint, disturbing documentary'
            },
            {
                value: 'surreal-nightmare',
                label: '🌀 Surreal Nightmare',
                description: 'Dreamlike horror, impossible geometry, unsettling.',
                prompt: 'surreal nightmare art, impossible geometry, dreamlike horror, Escher-inspired, uncanny valley, liminal spaces'
            }
        ],

        // Duration options
        durations: [
            { value: 'short', label: 'Short (~30 seconds)', words: [80, 120] },
            { value: 'medium', label: 'Medium (~45 seconds)', words: [120, 180] },
            { value: 'long', label: 'Long (~60 seconds)', words: [180, 250] },
            { value: 'extended', label: 'Extended (~90 seconds)', words: [250, 320] },
            { value: 'full', label: 'Full (~120 seconds)', words: [320, 400] }
        ],

        // Caption styles
        captionStyles: [
            { value: 'bold', label: 'BOLD', class: 'caption-bold' },
            { value: 'horror', label: 'HORROR', class: 'caption-horror' },
            { value: 'glitch', label: 'GLITCH', class: 'caption-glitch' },
            { value: 'minimal', label: 'minimal', class: 'caption-minimal' },
            { value: 'neon', label: 'NEON', class: 'caption-neon' },
            { value: 'vintage', label: 'Vintage', class: 'caption-vintage' },
            { value: 'blood', label: 'BLOOD', class: 'caption-blood' },
            { value: 'typewriter', label: 'typewriter', class: 'caption-typewriter' },
            { value: 'shadow', label: 'SHADOW', class: 'caption-shadow' },
            { value: 'comic', label: 'COMIC!', class: 'caption-comic' }
        ]
    },

    // Video effects configuration
    effects: [
        {
            category: 'transitions',
            label: '🎬 TRANSITIONS',
            color: 'purple',
            items: [
                { id: 'fade-in', label: 'Fade In from Black', time: '+2s', default: true },
                { id: 'fade-out', label: 'Fade Out to Black', time: '+2s', default: true },
                { id: 'transitions', label: 'Scene Transitions', time: '+0s', default: true }
            ]
        },
        {
            category: 'disturbance',
            label: '🩸 DISTURBANCE & GLITCH',
            subtitle: '(high retention)',
            color: 'red',
            items: [
                { id: 'glitch-flicker', label: 'Micro Glitch Flicker', time: '+3s', default: false },
                { id: 'vhs-tracking', label: 'VHS Tracking Wobble', time: '+4s', default: false },
                { id: 'scanlines', label: 'CRT Scanlines', time: '+3s', default: false },
                { id: 'filmgrain', label: 'Film Grain & Scratches', time: '+5s', default: false }
            ]
        },
        {
            category: 'atmospheric',
            label: '🌫️ ATMOSPHERIC HORROR',
            subtitle: '(slow dread)',
            color: 'blue',
            items: [
                { id: 'kenburns', label: 'Ken Burns Motion', time: '+0s', default: true },
                { id: 'filter', label: 'Horror Color Grading', time: '+3s', default: true },
                { id: 'vignette', label: 'Vignette', time: '+2s', default: true },
                { id: 'light-flicker', label: 'Light Flicker', time: '+3s', default: false },
                { id: 'cold-creep', label: 'Cold Color Creep', time: '+3s', default: false }
            ]
        },
        {
            category: 'psychological',
            label: '👁️ PSYCHOLOGICAL',
            subtitle: '(unease)',
            color: 'yellow',
            items: [
                { id: 'heartbeat-zoom', label: 'Heartbeat Zoom Pulse', time: '+4s', default: false },
                { id: 'negative-flash', label: 'Negative Flash (Subliminal)', time: '+3s', default: false },
                { id: 'edge-darkening', label: 'Edge Darkening Creep', time: '+3s', default: false },
                { id: 'highlight', label: 'Highlight Scary Words', time: '+0s', default: true }
            ]
        }
    ],

    // Effect presets
    effectPresets: {
        classic: {
            name: '🎬 Classic Horror',
            effects: ['fade-in', 'fade-out', 'transitions', 'kenburns', 'filter', 'vignette', 'highlight']
        },
        found: {
            name: '📼 Found Footage',
            effects: ['fade-in', 'fade-out', 'vhs-tracking', 'filmgrain', 'scanlines', 'glitch-flicker']
        },
        psycho: {
            name: '👁️ Psychological',
            effects: ['fade-in', 'fade-out', 'kenburns', 'vignette', 'heartbeat-zoom', 'negative-flash', 'edge-darkening', 'highlight']
        },
        none: {
            name: '✖️ Clear All',
            effects: []
        }
    },

    // Music options
    musicStyles: [
        { value: 'tension', label: '🎵 Tension Building' },
        { value: 'ambient-horror', label: '🌫️ Ambient Horror' },
        { value: 'dread', label: '😰 Creeping Dread' },
        { value: 'chase', label: '🏃 Chase Music' }
    ],

    /**
     * Build the story generation prompt
     */
    buildContentPrompt(settings) {
        const theme = this.settings.themes.find(t => t.value === settings.theme) || this.settings.themes[0];
        const vibe = this.settings.vibes.find(v => v.value === settings.vibe) || this.settings.vibes[0];
        const duration = this.settings.durations.find(d => d.value === settings.duration) || this.settings.durations[1];
        const visual = this.settings.visualPresets.find(v => v.value === settings.visualPreset) || this.settings.visualPresets[0];

        const wordRange = duration.words;

        return `Write a terrifying ${theme.label.toLowerCase()} horror story for a short video.

REQUIREMENTS:
- Length: ${wordRange[0]}-${wordRange[1]} words (this is critical for timing)
- Setting: ${visual.label}
- Pacing: ${vibe.pacing} buildup with ${vibe.tension} tension
- Style: ${vibe.description}
- Must have a clear beginning, escalating middle, and a twist or shock ending
- Write in second person ("You") to immerse the viewer
- Focus on atmosphere and dread, not gore
- End with something that will haunt the viewer

The story will be split into ${settings.sceneCount || 6} scenes for image generation.

Return ONLY the story text, no titles or explanations.`;
    },

    /**
     * Build prompts object for the job
     */
    buildPrompts(settings) {
        const artStyle = this.settings.artStyles.find(a => a.value === settings.artStyle) || this.settings.artStyles[0];
        const visual = this.settings.visualPresets.find(v => v.value === settings.visualPreset) || this.settings.visualPresets[0];

        return {
            artStyle: artStyle.prompt,
            environment: visual.label,
            negativePrompt: 'bright colors, happy, cheerful, cartoon, cute, anime eyes, text, watermark, signature, blurry'
        };
    },

    /**
     * Build story anchor for visual consistency
     */
    buildStoryAnchor(settings) {
        const artStyle = this.settings.artStyles.find(a => a.value === settings.artStyle) || this.settings.artStyles[0];
        const visual = this.settings.visualPresets.find(v => v.value === settings.visualPreset) || this.settings.visualPresets[0];
        const theme = this.settings.themes.find(t => t.value === settings.theme) || this.settings.themes[0];

        return {
            environment: visual.label,
            mood: `${theme.label} atmosphere`,
            artStyle: artStyle.prompt,
            colorPalette: 'dark, desaturated, moody colors with deep shadows',
            lighting: 'low-key lighting, dramatic shadows, occasional harsh light'
        };
    },

    /**
     * Build image prompt for a scene
     */
    buildImagePrompt(scene, index, settings, storyAnchor) {
        const totalScenes = settings.sceneCount || 6;
        const tensionLevel = Math.min(10, Math.floor((index / totalScenes) * 10) + 3);
        
        // Camera angles that escalate
        const cameraAngles = ['establishing wide shot', 'medium shot', 'close-up', 'dutch angle', 'low angle', 'extreme close-up'];
        const cameraAngle = cameraAngles[Math.min(index, cameraAngles.length - 1)];

        return `${scene.text}

Style: ${storyAnchor.artStyle}
Environment: ${storyAnchor.environment}
Mood: ${storyAnchor.mood}, tension level ${tensionLevel}/10
Camera: ${cameraAngle}
Lighting: ${storyAnchor.lighting}
Color: ${storyAnchor.colorPalette}

Horror photography, cinematic composition, no text, no watermarks`;
    },

    /**
     * Calculate cost estimate
     */
    calculateCost(settings) {
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
        
        return {
            story: 0.01,
            voice: 0.05,
            images: imageCost,
            video: 0, // Plan-based
            total: 0.01 + 0.05 + imageCost
        };
    }
};

// Register template
if (window.templateLoader) {
    window.templateLoader.register(HorrorTemplate);
}

// Export
window.HorrorTemplate = HorrorTemplate;
