// =====================================================
// REDDIT SOURCE SERVICE
// Fetches and scores trending horror posts from Reddit
// for transformation into original horror scripts.
//
// NOTE: Uses Reddit's public JSON API (no OAuth required).
// Rate-limited to ~30 req/min without auth.
// =====================================================

const RedditSource = (() => {
    // =====================================================
    // CONFIGURATION
    // =====================================================

    /** Target subreddits ordered by story quality */
    const SUBREDDITS = [
        'nosleep',
        'shortscarystories',
        'creepypasta',
        'letsnotmeet',
        'paranormal',
        'glitch_in_the_matrix',
    ];

    /** Sort modes to cycle through */
    const SORT_MODES = ['top', 'hot', 'rising'];

    /** Time filters for "top" sort */
    const TIME_FILTERS = ['day', 'week'];

    /** Keywords that boost horror relevance score */
    const HORROR_KEYWORDS = [
        'true story', 'this happened', 'last night', 'woke up',
        'can\'t explain', 'nobody believes', 'still terrified',
        'no explanation', 'happened to me', 'we never went back',
        'disappeared', 'shadow', 'figure', 'noise', 'door',
        'basement', 'attic', 'woods', 'cabin', 'alone',
        'dark', 'watched', 'followed', 'missing', 'dead',
        'scream', 'blood', 'mirror', 'dream', 'sleep',
        'haunted', 'ghost', 'creature', 'stranger', 'message',
    ];

    /** Content types to EXCLUDE (not story-based) */
    const EXCLUDE_PATTERNS = [
        /\.(jpg|jpeg|png|gif|mp4|webm)$/i,     // Direct media links
        /\b(news|article|bbc|cnn|nytimes)\b/i,  // News articles
        /\b(meme|funny|lol|lmao)\b/i,           // Memes
        /\b(podcast|youtube\.com|youtu\.be)\b/i, // External media
        /\[meta\]|\[mod\]/i,                     // Meta/mod posts
    ];

    /** Minimum post requirements */
    const MIN_UPVOTES = 50;
    const MIN_BODY_LENGTH = 200;   // Characters - ensures it's an actual story
    const MAX_BODY_LENGTH = 15000; // Skip extremely long posts

    // =====================================================
    // REDDIT HORROR SCORE SYSTEM
    // Ranks posts by engagement + horror fitness
    // =====================================================

    /**
     * Calculate a "Horror Score" for a Reddit post (0-100).
     *
     * Factors:
     *   - Engagement (upvotes, comments, upvote ratio)  — 40%
     *   - Keyword match density                         — 30%
     *   - Story structure signals                       — 20%
     *   - Freshness bonus                               — 10%
     */
    function calculateHorrorScore(post) {
        let score = 0;

        // --- Engagement (0-40) ---
        const upvotes = post.ups || 0;
        const comments = post.num_comments || 0;
        const ratio = post.upvote_ratio || 0.5;

        // Log-scale engagement (diminishing returns above 1k)
        const engagementRaw = Math.log10(Math.max(1, upvotes)) * 8
            + Math.log10(Math.max(1, comments)) * 4
            + (ratio * 10);
        score += Math.min(40, engagementRaw);

        // --- Keyword horror relevance (0-30) ---
        const text = `${post.title} ${post.selftext || ''}`.toLowerCase();
        let keywordHits = 0;
        for (const kw of HORROR_KEYWORDS) {
            if (text.includes(kw)) keywordHits++;
        }
        // Diminishing returns: 5 keyword hits ≈ max score
        score += Math.min(30, (keywordHits / 5) * 30);

        // --- Story structure signals (0-20) ---
        const body = post.selftext || '';
        const paragraphs = body.split(/\n\n+/).filter(p => p.trim().length > 20);
        const sentences = body.split(/[.!?]+/).filter(s => s.trim().length > 5);

        if (paragraphs.length >= 3) score += 5;  // Multi-paragraph = structured
        if (sentences.length >= 5) score += 5;    // Enough sentences for a narrative
        if (body.length >= 500) score += 5;       // Substantial content
        if (/^I |^My |^We |^It was/i.test(body.trim())) score += 5; // First-person opening = story

        // --- Freshness bonus (0-10) ---
        const ageHours = (Date.now() / 1000 - (post.created_utc || 0)) / 3600;
        if (ageHours < 6) score += 10;
        else if (ageHours < 24) score += 7;
        else if (ageHours < 72) score += 4;
        else if (ageHours < 168) score += 2;

        return Math.round(Math.min(100, score));
    }

    // =====================================================
    // FETCHING
    // =====================================================

    /**
     * Fetch posts from a single subreddit/sort/time combo.
     * Uses Reddit's public JSON API.
     *
     * @param {string} subreddit
     * @param {string} sort - 'top' | 'hot' | 'rising'
     * @param {string} time - 'day' | 'week' (only for sort=top)
     * @param {number} limit - Max posts to fetch (max 100)
     * @returns {Promise<Object[]>} Raw Reddit post objects
     */
    async function fetchSubreddit(subreddit, sort = 'hot', time = 'day', limit = 25) {
        const timeParam = sort === 'top' ? `&t=${time}` : '';
        const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}${timeParam}&raw_json=1`;

        try {
            const resp = await fetch(url, {
                headers: { 'User-Agent': 'ContentEngine/1.0 (Horror Story Aggregator)' },
            });

            if (!resp.ok) {
                console.warn(`[RedditSource] ${subreddit}/${sort} returned ${resp.status}`);
                return [];
            }

            const json = await resp.json();
            return (json?.data?.children || []).map(c => c.data);
        } catch (err) {
            console.error(`[RedditSource] Fetch failed for r/${subreddit}:`, err.message);
            return [];
        }
    }

    /**
     * Check if a post should be excluded.
     */
    function shouldExclude(post) {
        // Must be a self-post (text, not link)
        if (!post.is_self) return true;
        // Must have enough body content
        if (!post.selftext || post.selftext.length < MIN_BODY_LENGTH) return true;
        if (post.selftext.length > MAX_BODY_LENGTH) return true;
        // Must meet minimum engagement
        if ((post.ups || 0) < MIN_UPVOTES) return true;
        // Check exclude patterns against title + url
        const combined = `${post.title} ${post.url || ''}`;
        if (EXCLUDE_PATTERNS.some(rx => rx.test(combined))) return true;
        // Removed/deleted posts
        if (post.selftext === '[removed]' || post.selftext === '[deleted]') return true;

        return false;
    }

    // =====================================================
    // PUBLIC API
    // =====================================================

    /**
     * Fetch trending horror posts across all configured subreddits.
     * Returns posts sorted by Horror Score (highest first).
     *
     * @param {Object} [options]
     * @param {string[]} [options.subreddits] - Override default subreddit list
     * @param {string}   [options.sort]       - Force a specific sort ('top'|'hot'|'rising')
     * @param {string}   [options.time]       - Time filter for top ('day'|'week')
     * @param {number}   [options.limit]      - Max results to return (default 10)
     * @returns {Promise<Object[]>} Scored and filtered posts
     */
    async function fetchTrending(options = {}) {
        const subs = options.subreddits || SUBREDDITS;
        const sort = options.sort || null; // null = cycle through all
        const time = options.time || 'week';
        const limit = options.limit || 10;

        console.log(`[RedditSource] Fetching trending horror from ${subs.length} subreddits...`);

        const allPosts = [];
        const seen = new Set(); // Deduplicate by ID

        // If a specific sort is requested, use it. Otherwise cycle through all.
        const sortModes = sort ? [sort] : SORT_MODES;

        for (const sub of subs) {
            for (const s of sortModes) {
                const times = s === 'top' ? TIME_FILTERS : [null];
                for (const t of times) {
                    const posts = await fetchSubreddit(sub, s, t, 25);
                    for (const p of posts) {
                        if (seen.has(p.id)) continue;
                        seen.add(p.id);
                        if (!shouldExclude(p)) {
                            allPosts.push(p);
                        }
                    }
                    // Small delay to avoid rate-limiting
                    await new Promise(r => setTimeout(r, 200));
                }
            }
        }

        console.log(`[RedditSource] Collected ${allPosts.length} qualifying posts`);

        // Score and sort
        const scored = allPosts.map(p => ({
            id: p.id,
            subreddit: p.subreddit,
            title: p.title,
            body: p.selftext,
            upvotes: p.ups,
            comments: p.num_comments,
            upvoteRatio: p.upvote_ratio,
            createdUtc: p.created_utc,
            permalink: `https://reddit.com${p.permalink}`,
            horrorScore: calculateHorrorScore(p),
            wordCount: (p.selftext || '').split(/\s+/).length,
        }));

        scored.sort((a, b) => b.horrorScore - a.horrorScore);

        return scored.slice(0, limit);
    }

    /**
     * Fetch a single top-scoring post ready for transformation.
     * Convenience wrapper around fetchTrending.
     *
     * @param {Object} [options] - Same as fetchTrending options
     * @returns {Promise<Object|null>} Best-scoring post or null
     */
    async function fetchTopPost(options = {}) {
        const results = await fetchTrending({ ...options, limit: 1 });
        return results[0] || null;
    }

    /**
     * Build the Reddit-to-story transformation prompt.
     * This is what gets sent to the AI to transform

     * a Reddit post into an original horror script.
     *
     * @param {Object} redditPost - Scored Reddit post object
     * @param {Object} [options]
     * @param {number} [options.wordTarget=155] - Target word count
     * @param {string} [options.voiceStyle='third_person_dramatic'] - Narration style
     * @returns {string} System/user prompt for AI transformation
     */
    function buildTransformationPrompt(redditPost, options = {}) {
        const wordTarget = options.wordTarget || 155;
        const wordMin = Math.round(wordTarget * 0.85);
        const wordMax = Math.round(wordTarget * 1.15);

        return `You are transforming a Reddit horror post into an ORIGINAL short horror script for a 60-90 second animated video.

SOURCE MATERIAL (for inspiration ONLY — do NOT copy):
"""
${redditPost.title}

${(redditPost.body || '').substring(0, 2000)}
"""

TRANSFORMATION RULES:
- Extract the CORE FEAR CONCEPT only. Do not copy sentences, names, or specific details.
- No usernames, no "OP said", no Reddit references, no real names.
- Rewrite as a COMPLETELY ORIGINAL dramatic horror narrative.
- Third-person dramatic storyteller voice — calm, deliberate, chilling.
- Single main horror concept per story.
- End on an UNRESOLVED note. No explanations. No comfort.

STRUCTURE (MANDATORY):
[HOOK] — First 1-2 sentences. Must create immediate unease within 5 seconds of narration.
[ESCALATION] — Build tension around one central disturbing concept.
[CLIMAX] — Peak moment of horror or realization.
[ENDING] — Sharp, unsettling. Unresolved. Leaves the viewer disturbed.

CONSTRAINTS:
- Word count: ${wordMin}-${wordMax} words (STRICT)
- No gore or explicit violence — psychological horror only
- Every sentence must be visually filmable (describe scenes, not abstractions)
- Include at least ONE specific sensory detail per beat (sound, smell, texture, visual)

OUTPUT FORMAT:
Return ONLY the story text, no titles, no labels, no explanations.
The story must stand alone without any context about Reddit.`;
    }

    /**
     * Build an image prompt template for a scene from a reddit-sourced story.
     *
     * @param {string} sceneText - The scene/beat text
     * @param {number} sceneIndex - Scene position (0-based)
     * @param {number} totalScenes - Total number of scenes
     * @returns {string} Image generation prompt
     */
    function buildImagePromptTemplate(sceneText, sceneIndex, totalScenes) {
        const tensionLevel = Math.min(10, Math.floor((sceneIndex / totalScenes) * 10) + 3);

        const cameraAngles = [
            'wide establishing shot',
            'medium shot',
            'close-up detail',
            'over-the-shoulder',
            'dutch angle low',
            'extreme close-up',
        ];
        const camera = cameraAngles[Math.min(sceneIndex, cameraAngles.length - 1)];

        return `${sceneText}

Style: Digital horror illustration, 2D animated, thick outlines, expressive character faces, slightly exaggerated emotions, clean shading, cartoon style with dark themes
Environment: Dark and moody, possible settings: dark forests, suburban homes at night, dimly lit hallways, bedrooms, campgrounds, abandoned buildings
Color Palette: Muted greens, dark forest tones, deep shadows, soft skin tones, slightly desaturated
Lighting: Dim, moonlit, soft rim lighting, shadow-heavy background
Camera: ${camera}
Tension: ${tensionLevel}/10
Mood: Childlike animation style hiding deeply unsettling fear

Horror illustration, cinematic composition, no text, no watermarks, no logos`;
    }

    /**
     * Build metadata for a generated video from a reddit-sourced story.
     *
     * @param {string} storyTitle - Generated story title
     * @param {string} storyHook - First line / hook of the story
     * @returns {Object} Platform metadata templates
     */
    function buildMetadataTemplates(storyTitle, storyHook) {
        return {
            youtube: {
                titleTemplate: `${storyTitle} #shorts #horror #scary`,
                descriptionTemplate: `${storyHook}\n\nA chilling animated horror story.\n\n⚠️ This is a work of fiction. Any resemblance to real events is coincidental.\n\n#horror #scary #creepy #animation #shorts #storytime #scarystories #trending`,
                tags: [
                    'horror', 'scary', 'creepy', 'horror stories', 'scary stories',
                    'animated horror', 'horror animation', 'shorts', 'short horror',
                    'creepypasta', 'true scary stories', 'horror shorts',
                    'scary animation', 'trending horror'
                ],
            },
            tiktok: {
                captionTemplate: `${storyHook} 😱\n\n#horror #scary #creepy #storytime #fyp #viral #animation #horrorstory #scarystory #trending #foryou #horrortok`,
            },
            instagram: {
                captionTemplate: `${storyHook}\n\nFull story in the video 👆\nWould you survive this? 💀\n\nFollow for more horror stories every day 🔪`,
                hashtags: [
                    'horror', 'scary', 'creepy', 'horrorstories', 'scarystories',
                    'animation', 'horrorreels', 'reels', 'reelsinstagram',
                    'creepypasta', 'horrorcommunity', 'darkaesthetic',
                    'horrorart', 'scaryart', 'animatedhorror',
                    'horrorshorts', 'trending', 'explore', 'viral'
                ],
            },
        };
    }

    // =====================================================
    // EXPOSE PUBLIC API
    // =====================================================
    return {
        fetchTrending,
        fetchTopPost,
        calculateHorrorScore,
        buildTransformationPrompt,
        buildImagePromptTemplate,
        buildMetadataTemplates,
        SUBREDDITS,
        HORROR_KEYWORDS,
    };
})();

// Export to global scope
window.RedditSource = RedditSource;
