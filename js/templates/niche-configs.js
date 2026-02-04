/**
 * Niche Configurations
 * Defines content types, visual styles, prompts, and themes for each niche
 * Used by the generic template when a specific template doesn't exist
 */

const NicheConfigs = {
    // ====== HORROR & THRILLER ======
    horror: {
        name: 'Horror Stories',
        icon: '👻',
        theme: { vibe: 'dark', primary: '#ef4444', secondary: '#9b59b6', accent: '#ff6b6b' },
        contentTypes: [
            { value: 'scary-story', label: 'Scary Story', icon: '👻' },
            { value: 'urban-legend', label: 'Urban Legend', icon: '📜' },
            { value: 'creepypasta', label: 'Creepypasta', icon: '🕯️' },
            { value: 'true-crime', label: 'True Crime', icon: '🔍' }
        ],
        visualStyles: [
            { value: 'dark-cinematic', label: '🌑 Dark Cinematic', prompt: 'dark cinematic horror photography, moody lighting, shadows, atmospheric fog, 4K' },
            { value: 'found-footage', label: '📹 Found Footage', prompt: 'found footage style, grainy, night vision, VHS aesthetic, unsettling' },
            { value: 'gothic', label: '🏚️ Gothic', prompt: 'gothic horror aesthetic, victorian, dark romanticism, candlelight, haunting beauty' }
        ],
        promptPrefix: 'Create a terrifying short horror story that builds tension and ends with a disturbing twist.',
        imagePromptSuffix: ', horror atmosphere, dark and unsettling, cinematic lighting'
    },

    thriller: {
        name: 'Thriller',
        icon: '🔪',
        theme: { vibe: 'dark', primary: '#dc2626', secondary: '#7c3aed', accent: '#f97316' },
        contentTypes: [
            { value: 'suspense', label: 'Suspense Story', icon: '😰' },
            { value: 'mystery', label: 'Mystery', icon: '🔍' },
            { value: 'crime', label: 'Crime Thriller', icon: '🚨' }
        ],
        visualStyles: [
            { value: 'noir', label: '🎬 Film Noir', prompt: 'film noir style, high contrast, dramatic shadows, black and white tones, moody' },
            { value: 'gritty', label: '🌆 Gritty Urban', prompt: 'gritty urban photography, rain, neon reflections, dark alleyways, tense atmosphere' }
        ],
        promptPrefix: 'Create a gripping thriller narrative with suspense, unexpected twists, and a jaw-dropping ending.',
        imagePromptSuffix: ', thriller atmosphere, tense and suspenseful, dramatic lighting'
    },

    // ====== FOOD & COOKING ======
    food: {
        name: 'Food Facts',
        icon: '🍕',
        theme: { vibe: 'light', primary: '#22c55e', secondary: '#f59e0b', accent: '#ef4444' },
        contentTypes: [
            { value: 'food-facts', label: 'Food Facts', icon: '💡' },
            { value: 'recipe', label: 'Recipe Tips', icon: '📋' },
            { value: 'nutrition', label: 'Nutrition Info', icon: '🥗' },
            { value: 'food-history', label: 'Food History', icon: '📜' }
        ],
        visualStyles: [
            { value: 'appetizing', label: '🍽️ Appetizing', prompt: 'appetizing food photography, professional lighting, warm colors, mouth-watering, 4K' },
            { value: 'rustic', label: '🪵 Rustic', prompt: 'rustic food photography, wooden surfaces, natural light, cozy, artisan' },
            { value: 'bright-modern', label: '✨ Bright Modern', prompt: 'bright modern food photography, clean white background, vibrant colors, fresh' }
        ],
        promptPrefix: 'Create engaging food content that is informative and makes viewers hungry.',
        imagePromptSuffix: ', food photography, appetizing, professional lighting'
    },

    cooking: {
        name: 'Cooking',
        icon: '👨‍🍳',
        theme: { vibe: 'light', primary: '#f97316', secondary: '#ef4444', accent: '#fbbf24' },
        contentTypes: [
            { value: 'quick-recipe', label: 'Quick Recipe', icon: '⏱️' },
            { value: 'cooking-tips', label: 'Cooking Tips', icon: '💡' },
            { value: 'kitchen-hacks', label: 'Kitchen Hacks', icon: '🔧' }
        ],
        visualStyles: [
            { value: 'step-by-step', label: '📝 Step by Step', prompt: 'cooking process photography, clear shots, bright kitchen, step by step, instructional' },
            { value: 'overhead', label: '📸 Overhead Shot', prompt: 'overhead flat lay food photography, ingredients organized, clean presentation, bright' }
        ],
        promptPrefix: 'Create a quick, easy-to-follow cooking guide with practical tips.',
        imagePromptSuffix: ', cooking photography, bright kitchen, instructional'
    },

    // ====== SCIENCE & EDUCATION ======
    science: {
        name: 'Science Facts',
        icon: '🔬',
        theme: { vibe: 'dark', primary: '#06b6d4', secondary: '#8b5cf6', accent: '#22d3ee' },
        contentTypes: [
            { value: 'science-facts', label: 'Science Facts', icon: '🔬' },
            { value: 'space', label: 'Space & Astronomy', icon: '🚀' },
            { value: 'biology', label: 'Biology', icon: '🧬' },
            { value: 'physics', label: 'Physics', icon: '⚛️' }
        ],
        visualStyles: [
            { value: 'educational', label: '📚 Educational', prompt: 'educational scientific visualization, clean graphics, informative, professional, 4K' },
            { value: 'cosmic', label: '🌌 Cosmic', prompt: 'cosmic space photography, nebulas, stars, vast universe, awe-inspiring, 8K' },
            { value: 'microscopic', label: '🔬 Microscopic', prompt: 'microscopic photography, scientific, detailed, vibrant colors, high magnification' }
        ],
        promptPrefix: 'Create fascinating science content that makes complex topics accessible and mind-blowing.',
        imagePromptSuffix: ', scientific visualization, educational, stunning detail'
    },

    tech: {
        name: 'Tech & Gadgets',
        icon: '💻',
        theme: { vibe: 'dark', primary: '#3b82f6', secondary: '#10b981', accent: '#6366f1' },
        contentTypes: [
            { value: 'tech-facts', label: 'Tech Facts', icon: '💡' },
            { value: 'gadget-review', label: 'Gadget Review', icon: '📱' },
            { value: 'tech-news', label: 'Tech News', icon: '📰' },
            { value: 'how-it-works', label: 'How It Works', icon: '⚙️' }
        ],
        visualStyles: [
            { value: 'futuristic', label: '🚀 Futuristic', prompt: 'futuristic technology visualization, holographic, blue glow, sci-fi aesthetic, 4K' },
            { value: 'product-shot', label: '📸 Product Shot', prompt: 'premium product photography, sleek, minimalist, professional studio lighting' },
            { value: 'cyber', label: '💾 Cyberpunk', prompt: 'cyberpunk aesthetic, neon lights, digital rain, high-tech, urban future' }
        ],
        promptPrefix: 'Create engaging tech content that explains technology in an exciting and accessible way.',
        imagePromptSuffix: ', technology photography, sleek and modern, professional'
    },

    // ====== AUTOMOTIVE ======
    cars: {
        name: 'Cars & Automotive',
        icon: '🚗',
        theme: { vibe: 'dark', primary: '#ef4444', secondary: '#1e40af', accent: '#fbbf24' },
        contentTypes: [
            { value: 'car-facts', label: 'Car Facts', icon: '💡' },
            { value: 'car-review', label: 'Car Review', icon: '⭐' },
            { value: 'car-history', label: 'Car History', icon: '📜' },
            { value: 'supercars', label: 'Supercars', icon: '🏎️' }
        ],
        visualStyles: [
            { value: 'showroom', label: '🏪 Showroom', prompt: 'luxury car showroom photography, dramatic lighting, reflections, premium, 4K' },
            { value: 'action', label: '🏁 Action Shot', prompt: 'dynamic car photography, motion blur, speed, racing, cinematic' },
            { value: 'classic', label: '🎖️ Classic', prompt: 'classic vintage car photography, timeless elegance, chrome details, nostalgic' }
        ],
        promptPrefix: 'Create exciting automotive content for car enthusiasts with fascinating facts and details.',
        imagePromptSuffix: ', automotive photography, dramatic lighting, premium quality'
    },

    // ====== SPORTS & FITNESS ======
    sports: {
        name: 'Sports',
        icon: '⚽',
        theme: { vibe: 'vibrant', primary: '#22c55e', secondary: '#3b82f6', accent: '#f59e0b' },
        contentTypes: [
            { value: 'sports-facts', label: 'Sports Facts', icon: '💡' },
            { value: 'highlights', label: 'Highlights', icon: '🏆' },
            { value: 'player-profile', label: 'Player Profile', icon: '⭐' }
        ],
        visualStyles: [
            { value: 'action-sports', label: '🏃 Action', prompt: 'sports action photography, dynamic movement, frozen motion, intense, high speed' },
            { value: 'stadium', label: '🏟️ Stadium', prompt: 'stadium photography, crowd atmosphere, dramatic lighting, epic scale' }
        ],
        promptPrefix: 'Create exciting sports content with incredible facts and memorable moments.',
        imagePromptSuffix: ', sports photography, dynamic action, intense'
    },

    fitness: {
        name: 'Fitness & Health',
        icon: '💪',
        theme: { vibe: 'vibrant', primary: '#10b981', secondary: '#f59e0b', accent: '#ef4444' },
        contentTypes: [
            { value: 'workout-tips', label: 'Workout Tips', icon: '🏋️' },
            { value: 'health-facts', label: 'Health Facts', icon: '❤️' },
            { value: 'motivation', label: 'Motivation', icon: '🔥' }
        ],
        visualStyles: [
            { value: 'gym', label: '🏋️ Gym', prompt: 'fitness gym photography, athletic, energetic, dynamic lighting, motivational' },
            { value: 'outdoor', label: '🌲 Outdoor', prompt: 'outdoor fitness photography, natural light, healthy lifestyle, active' }
        ],
        promptPrefix: 'Create motivating fitness content with practical tips and health information.',
        imagePromptSuffix: ', fitness photography, energetic, motivational'
    },

    // ====== ENTERTAINMENT ======
    gaming: {
        name: 'Gaming',
        icon: '🎮',
        theme: { vibe: 'dark', primary: '#a855f7', secondary: '#ec4899', accent: '#22d3ee' },
        contentTypes: [
            { value: 'game-facts', label: 'Game Facts', icon: '💡' },
            { value: 'game-review', label: 'Game Review', icon: '⭐' },
            { value: 'gaming-news', label: 'Gaming News', icon: '📰' },
            { value: 'easter-eggs', label: 'Easter Eggs', icon: '🥚' }
        ],
        visualStyles: [
            { value: 'game-art', label: '🎨 Game Art', prompt: 'video game art style, colorful, stylized, digital art, fantasy' },
            { value: 'neon-gaming', label: '💜 Neon', prompt: 'neon gaming aesthetic, RGB lighting, purple and cyan, futuristic, gamer' }
        ],
        promptPrefix: 'Create engaging gaming content for gamers with interesting facts and insights.',
        imagePromptSuffix: ', gaming aesthetic, colorful, digital art style'
    },

    movies: {
        name: 'Movies & TV',
        icon: '🎬',
        theme: { vibe: 'dark', primary: '#fbbf24', secondary: '#ef4444', accent: '#8b5cf6' },
        contentTypes: [
            { value: 'movie-facts', label: 'Movie Facts', icon: '🎬' },
            { value: 'behind-scenes', label: 'Behind the Scenes', icon: '🎥' },
            { value: 'movie-review', label: 'Review', icon: '⭐' }
        ],
        visualStyles: [
            { value: 'cinematic', label: '🎥 Cinematic', prompt: 'cinematic film photography, movie poster style, dramatic lighting, Hollywood' },
            { value: 'retro-film', label: '📽️ Retro', prompt: 'retro vintage film aesthetic, classic Hollywood, film grain, nostalgic' }
        ],
        promptPrefix: 'Create fascinating movie content with behind-the-scenes facts and trivia.',
        imagePromptSuffix: ', cinematic photography, movie quality, dramatic'
    },

    music: {
        name: 'Music',
        icon: '🎵',
        theme: { vibe: 'vibrant', primary: '#ec4899', secondary: '#8b5cf6', accent: '#f59e0b' },
        contentTypes: [
            { value: 'music-facts', label: 'Music Facts', icon: '🎵' },
            { value: 'artist-profile', label: 'Artist Profile', icon: '🎤' },
            { value: 'song-meaning', label: 'Song Meaning', icon: '📝' }
        ],
        visualStyles: [
            { value: 'concert', label: '🎤 Concert', prompt: 'concert photography, stage lights, vibrant colors, music venue, energetic' },
            { value: 'vinyl', label: '💿 Vinyl', prompt: 'vinyl record aesthetic, retro music, warm tones, vintage audio equipment' }
        ],
        promptPrefix: 'Create engaging music content exploring artists, songs, and music history.',
        imagePromptSuffix: ', music photography, artistic, vibrant'
    },

    // ====== LIFESTYLE ======
    travel: {
        name: 'Travel',
        icon: '✈️',
        theme: { vibe: 'vibrant', primary: '#0ea5e9', secondary: '#22c55e', accent: '#f59e0b' },
        contentTypes: [
            { value: 'travel-tips', label: 'Travel Tips', icon: '💡' },
            { value: 'destination', label: 'Destination Guide', icon: '🗺️' },
            { value: 'hidden-gems', label: 'Hidden Gems', icon: '💎' }
        ],
        visualStyles: [
            { value: 'wanderlust', label: '🌍 Wanderlust', prompt: 'wanderlust travel photography, breathtaking landscapes, adventure, golden hour, 4K' },
            { value: 'local', label: '🏘️ Local', prompt: 'authentic local travel photography, culture, street scenes, genuine' }
        ],
        promptPrefix: 'Create inspiring travel content showcasing amazing destinations and travel tips.',
        imagePromptSuffix: ', travel photography, stunning landscape, wanderlust'
    },

    fashion: {
        name: 'Fashion',
        icon: '👗',
        theme: { vibe: 'light', primary: '#ec4899', secondary: '#a855f7', accent: '#fbbf24' },
        contentTypes: [
            { value: 'fashion-tips', label: 'Fashion Tips', icon: '👗' },
            { value: 'style-guide', label: 'Style Guide', icon: '📋' },
            { value: 'fashion-trends', label: 'Trends', icon: '📈' }
        ],
        visualStyles: [
            { value: 'editorial', label: '📸 Editorial', prompt: 'fashion editorial photography, high fashion, professional model, designer, vogue' },
            { value: 'street-style', label: '🚶 Street Style', prompt: 'street style fashion photography, urban, trendy, candid, authentic' }
        ],
        promptPrefix: 'Create stylish fashion content with tips and trend insights.',
        imagePromptSuffix: ', fashion photography, stylish, professional'
    },

    // ====== FINANCE & BUSINESS ======
    finance: {
        name: 'Finance',
        icon: '💰',
        theme: { vibe: 'dark', primary: '#22c55e', secondary: '#3b82f6', accent: '#fbbf24' },
        contentTypes: [
            { value: 'money-tips', label: 'Money Tips', icon: '💡' },
            { value: 'investing', label: 'Investing', icon: '📈' },
            { value: 'finance-facts', label: 'Finance Facts', icon: '💰' }
        ],
        visualStyles: [
            { value: 'professional', label: '💼 Professional', prompt: 'professional business photography, corporate, clean, trust-inspiring' },
            { value: 'wealth', label: '💎 Wealth', prompt: 'wealth aesthetic, luxury, gold, success, premium lifestyle' }
        ],
        promptPrefix: 'Create valuable finance content with practical money tips and investment insights.',
        imagePromptSuffix: ', professional business photography, wealth, success'
    },

    // ====== NATURE & ANIMALS ======
    animals: {
        name: 'Animals',
        icon: '🐾',
        theme: { vibe: 'vibrant', primary: '#f59e0b', secondary: '#22c55e', accent: '#3b82f6' },
        contentTypes: [
            { value: 'animal-facts', label: 'Animal Facts', icon: '🐾' },
            { value: 'wildlife', label: 'Wildlife', icon: '🦁' },
            { value: 'cute-animals', label: 'Cute Animals', icon: '🐱' }
        ],
        visualStyles: [
            { value: 'wildlife', label: '🦁 Wildlife', prompt: 'wildlife photography, nature documentary style, sharp detail, natural habitat, 4K' },
            { value: 'portrait', label: '📸 Portrait', prompt: 'animal portrait photography, stunning detail, expressive, professional' }
        ],
        promptPrefix: 'Create amazing animal content with fascinating facts about wildlife.',
        imagePromptSuffix: ', wildlife photography, stunning detail, nature'
    },

    nature: {
        name: 'Nature',
        icon: '🌿',
        theme: { vibe: 'light', primary: '#22c55e', secondary: '#0ea5e9', accent: '#fbbf24' },
        contentTypes: [
            { value: 'nature-facts', label: 'Nature Facts', icon: '🌿' },
            { value: 'environment', label: 'Environment', icon: '🌍' },
            { value: 'weather', label: 'Weather', icon: '🌤️' }
        ],
        visualStyles: [
            { value: 'landscape', label: '🏔️ Landscape', prompt: 'stunning landscape photography, nature, golden hour, breathtaking scenery, 4K' },
            { value: 'macro', label: '🔍 Macro', prompt: 'macro nature photography, incredible detail, dewdrops, textures, close-up' }
        ],
        promptPrefix: 'Create captivating nature content about the natural world.',
        imagePromptSuffix: ', nature photography, stunning landscape, natural beauty'
    },

    // ====== EDUCATIONAL ======
    history: {
        name: 'History',
        icon: '📜',
        theme: { vibe: 'dark', primary: '#a16207', secondary: '#78350f', accent: '#fbbf24' },
        contentTypes: [
            { value: 'history-facts', label: 'History Facts', icon: '📜' },
            { value: 'ancient', label: 'Ancient History', icon: '🏛️' },
            { value: 'wars', label: 'Wars & Conflicts', icon: '⚔️' }
        ],
        visualStyles: [
            { value: 'documentary', label: '📽️ Documentary', prompt: 'documentary photography, historical, sepia tones, archival, cinematic' },
            { value: 'ancient', label: '🏛️ Ancient', prompt: 'ancient civilization aesthetic, ruins, artifacts, timeless, epic' }
        ],
        promptPrefix: 'Create fascinating history content bringing the past to life.',
        imagePromptSuffix: ', historical photography, documentary style, archival'
    },

    psychology: {
        name: 'Psychology',
        icon: '🧠',
        theme: { vibe: 'dark', primary: '#8b5cf6', secondary: '#ec4899', accent: '#06b6d4' },
        contentTypes: [
            { value: 'psychology-facts', label: 'Psychology Facts', icon: '🧠' },
            { value: 'mindset', label: 'Mindset', icon: '💭' },
            { value: 'behavior', label: 'Human Behavior', icon: '🎭' }
        ],
        visualStyles: [
            { value: 'abstract', label: '🎨 Abstract', prompt: 'abstract psychological visualization, brain, mind, surreal, thought-provoking' },
            { value: 'conceptual', label: '💭 Conceptual', prompt: 'conceptual photography, symbolic, meaningful, artistic, deep' }
        ],
        promptPrefix: 'Create mind-blowing psychology content about human behavior and the mind.',
        imagePromptSuffix: ', conceptual photography, psychological, thought-provoking'
    },

    // ====== FALLBACK ======
    general: {
        name: 'General Content',
        icon: '🎬',
        theme: { vibe: 'dark', primary: '#8b5cf6', secondary: '#6366f1', accent: '#a855f7' },
        contentTypes: [
            { value: 'story', label: 'Story / Narrative', icon: '📖' },
            { value: 'facts', label: 'Facts / Educational', icon: '💡' },
            { value: 'tips', label: 'Tips & Tricks', icon: '✨' },
            { value: 'review', label: 'Review / Opinion', icon: '⭐' }
        ],
        visualStyles: [
            { value: 'cinematic', label: '🎬 Cinematic', prompt: 'cinematic photography, professional lighting, shallow depth of field, 4K quality' },
            { value: 'clean', label: '✨ Clean Modern', prompt: 'clean modern photography, minimalist, professional, well-lit' },
            { value: 'vibrant', label: '🌈 Vibrant', prompt: 'vibrant colorful photography, bold colors, eye-catching, saturated' }
        ],
        promptPrefix: 'Create engaging content that captures attention and provides value.',
        imagePromptSuffix: ', professional photography, high quality'
    }
};

/**
 * Get configuration for a specific niche
 * Falls back to 'general' if niche not found
 */
function getNicheConfig(niche) {
    const key = niche?.toLowerCase() || 'general';
    return NicheConfigs[key] || NicheConfigs.general;
}

/**
 * Get all available niches
 */
function getAllNiches() {
    return Object.keys(NicheConfigs).map(key => ({
        value: key,
        ...NicheConfigs[key]
    }));
}

// Export to window
window.NicheConfigs = NicheConfigs;
window.getNicheConfig = getNicheConfig;
window.getAllNiches = getAllNiches;
