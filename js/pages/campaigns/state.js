// =====================================================
// CAMPAIGN STATE — Shared data & preset catalog
// =====================================================

const PRESET_CATALOG = {
    urban_legend: {
        id: 'urban_legend',
        brand: 'stories_that_stalk',
        name: 'Urban Legend',
        icon: '📜',
        tagline: 'Documentary folklore',
        description: 'Classic creepypasta with authority denial, repeating motifs, and ambiguous endings. Stories feel like suppressed local news — the kind whispered about at gas stations late at night.',
        defaults: {
            vibe_preset: 'urban_legend', era: '1990s', tone: 0.6, ending: 'unresolved',
            visual_style: 'VHS_degraded', color_palette: 'sickly_green', motion_profile: 'micro_jitter'
        },
        visual: {
            gradient: 'linear-gradient(145deg, #1a2a1a 0%, #0d1f0d 30%, #2d1b00 70%, #0a0a0a 100%)',
            overlay: 'radial-gradient(ellipse at 30% 80%, rgba(34, 197, 94, 0.15), transparent 60%)',
            accentColor: '#22c55e', accentBg: 'rgba(34, 197, 94, 0.15)',
            artStyle: 'VHS Degraded', colorPalette: 'Sickly Green', motionProfile: 'Micro Jitter'
        },
        details: {
            era: '1990s', ending: 'Unresolved',
            effects: ['Strong edge vignette', 'Subtle film grain', 'Cool night tones', 'Moderate Ken Burns'],
            bestFor: 'Folklore retellings, "based on true events" stories, small-town mysteries',
            exampleHook: '"In 1997, a gas station attendant in rural Ohio started keeping a logbook..."'
        }
    },
    one_too_many: {
        id: 'one_too_many',
        brand: 'stories_that_stalk',
        name: 'One Too Many',
        icon: '👥',
        tagline: 'Counting horror',
        description: 'N friends went on a trip... but the photo shows N+1. The extra person is never explained. Stories exploit the uncanny valley of group dynamics.',
        defaults: {
            vibe_preset: 'one_too_many', era: 'modern', tone: 0.7, ending: 'unresolved',
            art_style: 'uncanny-illustrated', visual_style: 'documentary', color_palette: 'cold_blue', motion_profile: 'static_tension'
        },
        visual: {
            gradient: 'linear-gradient(145deg, #0c1929 0%, #1a0a2e 40%, #0d1b2a 70%, #050510 100%)',
            overlay: 'radial-gradient(ellipse at 70% 20%, rgba(99, 102, 241, 0.2), transparent 60%)',
            accentColor: '#6366f1', accentBg: 'rgba(99, 102, 241, 0.15)',
            artStyle: 'Uncanny Illustrated', colorPalette: 'Cold Blue', motionProfile: 'Static Tension'
        },
        details: {
            era: 'Modern', ending: 'Unresolved',
            effects: ['Uncanny illustration style', 'Cold blue grading', 'Static tension motion', 'Documentary feel'],
            bestFor: 'Group photos gone wrong, counting anomalies, "who is the extra person" mysteries',
            exampleHook: '"Six of us went camping that weekend. But when we got the photos developed..."'
        }
    },
    reddit_trending_horror: {
        id: 'reddit_trending_horror',
        brand: 'stories_that_stalk',
        name: 'Reddit Trending Horror',
        icon: '🔥',
        tagline: 'Internet nightmares retold',
        description: 'Pulls trending horror posts from Reddit, extracts the core fear concept, and transforms them into original 60-90 second animated horror scripts.',
        defaults: {
            vibe_preset: 'reddit_trending_horror', era: 'modern', tone: 0.65, ending: 'unresolved',
            visual_style: 'cinematic_dark', color_palette: 'muted_forest', motion_profile: 'subtle_kenburns'
        },
        visual: {
            gradient: 'linear-gradient(145deg, #0d1f0d 0%, #1a0f0a 30%, #0a1a0a 60%, #050a05 100%)',
            overlay: 'radial-gradient(ellipse at 40% 70%, rgba(239, 68, 68, 0.20), transparent 60%)',
            accentColor: '#ef4444', accentBg: 'rgba(239, 68, 68, 0.15)',
            artStyle: 'Uncanny Illustrated Horror', colorPalette: 'Muted Forest', motionProfile: 'Subtle Ken Burns'
        },
        details: {
            era: 'Modern', ending: 'Unresolved',
            effects: ['Subtle Ken Burns zoom', 'Light vignette', 'Minimal film grain', 'Cool color grade'],
            bestFor: 'Reddit-sourced horror retellings, internet creepypasta adaptations, viral horror shorts',
            exampleHook: '"The post had 4,000 upvotes. The comments were all begging OP to move out immediately."'
        }
    },
    dark_origins: {
        id: 'dark_origins',
        brand: 'stories_that_stalk',
        name: 'Dark Origins',
        icon: '🕯️',
        tagline: 'Documentary dark biographies',
        description: 'True crime documentary style — dark biographies, horror icon origin stories. Photorealistic dark illustration with heavy chiaroscuro.',
        defaults: {
            vibe_preset: 'dark_origins', era: '1970s', tone: 0.75, ending: 'unresolved',
            visual_style: 'cinematic_dark', color_palette: 'deep_shadow_contrast', motion_profile: 'slow_pan'
        },
        visual: {
            gradient: 'linear-gradient(145deg, #1a1008 0%, #0d0a06 30%, #1c1410 60%, #080604 100%)',
            overlay: 'radial-gradient(ellipse at 50% 60%, rgba(217, 119, 6, 0.18), transparent 60%)',
            accentColor: '#d97706', accentBg: 'rgba(217, 119, 6, 0.15)',
            artStyle: 'Dark Realistic', colorPalette: 'Deep Shadow Contrast', motionProfile: 'Slow Pan'
        },
        details: {
            era: '1950s\u20131990s', ending: 'Unresolved',
            effects: ['Heavy chiaroscuro', 'Film grain', 'Vignette', 'Amber accent lighting'],
            bestFor: 'True crime deep dives, horror icon origins, dark biographies, serial killer documentaries',
            exampleHook: '"Edgar Holloway was the best taxidermist in Dane County. His private collection was not animals."'
        }
    },
    no_good_choice: {
        id: 'no_good_choice',
        brand: 'decide_this_daily',
        name: 'No Good Choice',
        icon: '⚖️',
        tagline: 'Lose-lose dilemmas',
        description: 'Both options suck — realistic scenarios where every path has a cost. The audience debates whether the power is worth the cost.',
        defaults: {
            vibe_preset: 'no_good_choice', era: 'modern', tone: 0.5, ending: 'open_question',
            visual_style: 'gameplay_clean', color_palette: 'neutral_warm', motion_profile: 'gentle_drift'
        },
        visual: {
            gradient: 'linear-gradient(145deg, #1f2937 0%, #111827 30%, #292524 70%, #0a0a0a 100%)',
            overlay: 'radial-gradient(ellipse at 50% 50%, rgba(245, 158, 11, 0.15), transparent 60%)',
            accentColor: '#f59e0b', accentBg: 'rgba(245, 158, 11, 0.15)',
            artStyle: 'Gameplay Clean', colorPalette: 'Neutral Warm', motionProfile: 'Gentle Drift'
        },
        details: {
            era: 'Modern', ending: 'Open Question',
            effects: ['Gentle Ken Burns drift', 'Very subtle vignette', 'Neutral warm grade'],
            bestFor: 'Moral dilemmas, trolley problems, impossible workplace/relationship choices',
            exampleHook: '"Your best friend confesses they hit someone with their car last night. They\'re asking you to stay quiet."'
        }
    },
    one_rule_one_power: {
        id: 'one_rule_one_power',
        brand: 'decide_this_daily',
        name: 'One Rule One Power',
        icon: '✨',
        tagline: 'Power with a catch',
        description: 'You get one extraordinary ability — but there\'s one rule that makes it complicated. The audience debates whether the power is worth the cost.',
        defaults: {
            vibe_preset: 'one_rule_one_power', era: 'modern', tone: 0.55, ending: 'open_question',
            visual_style: 'moody_surreal', color_palette: 'deep_blue_amber', motion_profile: 'slow_contemplative'
        },
        visual: {
            gradient: 'linear-gradient(145deg, #0c1929 0%, #1a0a2e 30%, #1e1b4b 60%, #0a0a1a 100%)',
            overlay: 'radial-gradient(ellipse at 60% 40%, rgba(139, 92, 246, 0.20), transparent 60%)',
            accentColor: '#8b5cf6', accentBg: 'rgba(139, 92, 246, 0.15)',
            artStyle: 'Surreal Contemplative', colorPalette: 'Deep Blue Amber', motionProfile: 'Slow Contemplative'
        },
        details: {
            era: 'Modern', ending: 'Open Question',
            effects: ['Slow contemplative zoom', 'Moderate vignette', 'Deep blue-amber grade', 'Barely-there grain'],
            bestFor: 'Power fantasies with restrictions, "would you accept?" debates, thought experiments',
            exampleHook: '"You can read anyone\'s mind \u2014 but only when they\'re lying to you."'
        }
    },
    two_doors: {
        id: 'two_doors',
        brand: 'decide_this_daily',
        name: 'Two Doors',
        icon: '🚪',
        tagline: 'Binary choices, big consequences',
        description: 'A framing device presents two options with unknown but permanent consequences. High-contrast cinematic visuals.',
        defaults: {
            vibe_preset: 'two_doors', era: 'modern', tone: 0.6, ending: 'open_question',
            visual_style: 'cinematic_contrast', color_palette: 'bold_contrast', motion_profile: 'dramatic_zoom'
        },
        visual: {
            gradient: 'linear-gradient(145deg, #18181b 0%, #1c1917 30%, #27272a 60%, #0a0a0a 100%)',
            overlay: 'radial-gradient(ellipse at 40% 60%, rgba(239, 68, 68, 0.18), transparent 60%)',
            accentColor: '#ef4444', accentBg: 'rgba(239, 68, 68, 0.15)',
            artStyle: 'Cinematic Contrast', colorPalette: 'Bold Contrast', motionProfile: 'Dramatic Zoom'
        },
        details: {
            era: 'Modern', ending: 'Open Question',
            effects: ['Moderate dramatic zoom', 'Focus vignette', 'Bold high-contrast grade', 'Minimal texture'],
            bestFor: 'Red pill/blue pill scenarios, door-choice mysteries, irreversible binary decisions',
            exampleHook: '"Two envelopes. One contains the date you die. The other contains the date everyone you love dies."'
        }
    },
    custom: {
        id: 'custom',
        brand: '_universal',
        name: 'Custom DNA',
        icon: '🧬',
        tagline: 'Full control',
        description: 'Advanced users only. Define your own visual DNA parameters — art style, color palette, motion profile, era, and ending type.',
        defaults: {},
        visual: {
            gradient: 'linear-gradient(145deg, #1a1a2e 0%, #16213e 40%, #0f3460 70%, #1a1a2e 100%)',
            overlay: 'radial-gradient(ellipse at 50% 50%, rgba(139, 92, 246, 0.15), transparent 60%)',
            accentColor: '#8b5cf6', accentBg: 'rgba(139, 92, 246, 0.15)',
            artStyle: 'User Defined', colorPalette: 'User Defined', motionProfile: 'User Defined'
        },
        details: {
            era: 'Any', ending: 'Any',
            effects: ['Fully customizable effect stack'],
            bestFor: 'Experienced creators who want complete narrative and visual control',
            exampleHook: '"Your story, your rules."'
        }
    }
};

const BRAND_SLUG_MAP = {
    'stories-that-stalk': 'stories_that_stalk',
    'decide-this-daily': 'decide_this_daily'
};

// Shared campaign page state
const CampaignState = {
    currentBrand: null,
    presetWeights: {},
    brandPresets: [],
    presetWeightsDirty: false,
    schedulePreview: [],
    debounceTimer: null,
    isAdvancedMode: false,
    _campaignsLoaded: false,
    _templates: [],
    _scheduleUsesAI: false,
    _scheduleAICount: 0,

    defaultConfig: {
        videoCount: 7,
        platforms: ['youtube_shorts', 'instagram_reels', 'facebook_reels'],
        postsPerDay: 3,
        windows: [
            { time: '08:00', label: 'Morning' },
            { time: '12:00', label: 'Midday' },
            { time: '18:00', label: 'Evening' }
        ],
        jitterMinutes: 15,
        platformOffsetMinutes: 5
    },

    // DOM element refs (populated by init)
    els: {}
};
