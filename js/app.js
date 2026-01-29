// =====================================================
// SCARY STORY GENERATOR - MAIN APP
// Step-by-step wizard workflow
// =====================================================

// Global state
let currentJobId = null;
let currentScenes = [];
let pollInterval = null;

// =====================================================
// INITIALIZATION
// =====================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('Scary Story Generator initialized');
    
    // Scene count slider
    const sceneSlider = document.getElementById('scene-count');
    if (sceneSlider) {
        sceneSlider.addEventListener('input', (e) => {
            document.getElementById('scene-count-display').textContent = e.target.value;
            updateCostEstimate();
        });
    }
    
    // Visual source change
    document.querySelectorAll('input[name="visual-source"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            updateCostEstimate();
            // Show/hide art style and AI model based on visual source
            const artStyleContainer = document.getElementById('art-style-container');
            const aiModelContainer = document.getElementById('ai-model-container');
            const isAI = e.target.value === 'ai';
            if (artStyleContainer) {
                artStyleContainer.style.display = isAI ? 'block' : 'none';
            }
            if (aiModelContainer) {
                aiModelContainer.style.display = isAI ? 'block' : 'none';
            }
        });
    });
    
    // AI model change
    const aiModelSelect = document.getElementById('ai-model');
    if (aiModelSelect) {
        aiModelSelect.addEventListener('change', updateCostEstimate);
    }
    
    // Art style preview
    const artStyleSelect = document.getElementById('art-style');
    if (artStyleSelect) {
        artStyleSelect.addEventListener('change', updateArtStylePreview);
        updateArtStylePreview(); // Initialize
    }
    
    // Load custom art styles into dropdown
    updateCustomStyleDropdown();
    
    // Initialize caption style selector
    initCaptionStyleSelector();
    
    // Initialize cost
    updateCostEstimate();
});

// =====================================================
// ART STYLE PREVIEWS
// =====================================================

const ART_STYLE_INFO = {
    "cinematic-dark": {
        icon: "🎬",
        name: "Cinematic Dark Photography",
        desc: "A24 horror film aesthetic. Moody desaturated colors, deep shadows, film grain, shallow depth of field, realistic but atmospheric."
    },
    "analog-horror": {
        icon: "📼",
        name: "Analog Horror / VHS Glitch",
        desc: "Heavy VHS static, glitch artifacts, scanlines, digital noise. Shadow entities with glowing eyes, low exposure, found-footage style, deeply unsettling."
    },
    "editorial-cartoon": {
        icon: "📰",
        name: "Editorial Cartoon / Satirical Comic",
        desc: "Clean bold linework, exaggerated expressions, large expressive eyes. Web-comic style with soft gradients, satirical and slightly unsettling humor."
    },
    "horror-anime": {
        icon: "🎌",
        name: "Dark Anime / Manga Style",
        desc: "Junji Ito / Berserk inspired. Detailed manga linework, heavy cross-hatching, dramatic poses, high contrast black and white with color accents."
    },
    "oil-painting": {
        icon: "🖼️",
        name: "Classic Oil Painting",
        desc: "Renaissance masters meets dark romanticism. Caravaggio chiaroscuro, Goya's Black Paintings style. Rich textures, dramatic lighting, timeless."
    },
    "found-footage": {
        icon: "📹",
        name: "Found Footage / Grainy",
        desc: "Blair Witch aesthetic. Grainy VHS quality, security camera look, night vision green, analog distortion. Accidental capture feel."
    },
    "surreal-nightmare": {
        icon: "🌀",
        name: "Surreal Nightmare",
        desc: "Beksiński / H.R. Giger style. Impossible geometry, melting forms, biomechanical horror, dream logic. Subconscious terror made visible."
    }
};

function updateArtStylePreview() {
    const style = document.getElementById('art-style')?.value || 'cinematic-dark';
    
    // Check built-in styles first, then custom styles
    let info = ART_STYLE_INFO[style];
    if (!info && style.startsWith('custom-')) {
        const customStyle = customArtStyles[style];
        if (customStyle) {
            info = {
                icon: customStyle.icon || '🎨',
                name: customStyle.name,
                desc: customStyle.basePrompt.substring(0, 150) + '...'
            };
        }
    }
    if (!info) info = ART_STYLE_INFO['cinematic-dark'];
    
    const iconEl = document.getElementById('art-style-icon');
    const nameEl = document.getElementById('art-style-name');
    const descEl = document.getElementById('art-style-desc');
    
    if (iconEl) iconEl.textContent = info.icon;
    if (nameEl) nameEl.textContent = info.name;
    if (descEl) descEl.textContent = info.desc;
}

// =====================================================
// COST ESTIMATION
// =====================================================

// AI model pricing per image (updated 2026-01-29 for low/standard quality)
const AI_MODEL_COSTS = {
    'dall-e-3': 0.08,   // 1024x1792 standard quality
    'gpt-4o': 0.044,    // 1024x1536 low quality (was $0.167 with high!)
    'flux': 0.04        // Average: Scene 1 = $0.04, Scenes 2+ = ~$0.025
};

const AI_MODEL_NAMES = {
    'dall-e-3': 'DALL-E 3',
    'gpt-4o': 'GPT-4o',
    'flux': 'FLUX'
};

function updateCostEstimate() {
    const sceneCount = parseInt(document.getElementById('scene-count')?.value || 4);
    const visualSource = document.querySelector('input[name="visual-source"]:checked')?.value || 'ai';
    const aiModel = document.getElementById('ai-model')?.value || 'gpt-4o';
    
    const isAI = visualSource === 'ai';
    const costPerImage = AI_MODEL_COSTS[aiModel] || 0.03;
    const imageCost = isAI ? sceneCount * costPerImage : 0;
    const totalCost = 0.01 + 0.05 + imageCost;
    
    const costImages = document.getElementById('cost-images');
    if (costImages) {
        costImages.textContent = isAI ? `~$${imageCost.toFixed(2)}` : 'Free';
        costImages.className = isAI ? 'font-bold text-purple-400' : 'font-bold text-green-400';
    }
    
    const costTotal = document.getElementById('cost-total');
    if (costTotal) {
        costTotal.textContent = `~$${totalCost.toFixed(2)}`;
    }
    
    return totalCost;
}

// =====================================================
// TAB NAVIGATION
// =====================================================

function showTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('bg-primary/20', 'text-primary');
        btn.classList.add('text-gray-400');
    });
    
    const activeTab = document.getElementById(`tab-${tab}`);
    if (activeTab) {
        activeTab.classList.add('bg-primary/20', 'text-primary');
        activeTab.classList.remove('text-gray-400');
    }
    
    document.getElementById('tab-content-create')?.classList.toggle('hidden', tab !== 'create');
    document.getElementById('tab-content-styles')?.classList.toggle('hidden', tab !== 'styles');
    document.getElementById('tab-content-history')?.classList.toggle('hidden', tab !== 'history');
    
    if (tab === 'history') {
        loadHistory();
    }
    
    if (tab === 'styles') {
        loadStylesEditor();
    }
}

// =====================================================
// ART STYLE EDITOR
// =====================================================

// Full art style data for editor
const BUILTIN_ART_STYLES = {
    "cinematic-dark": {
        name: "Cinematic Dark Photography",
        icon: "🎬",
        basePrompt: "Cinematic dark photography. Moody desaturated colors, deep shadows, film grain, A24 horror film aesthetic. Realistic but atmospheric, shallow depth of field, dramatic lighting.",
        colorOverride: "muted colors, deep shadows, film grain, desaturated with selective color",
        technicalStyle: "cinematic horror, film grain, shallow depth of field, realistic lighting, professional photography",
        negativePrompt: "cartoon, anime, illustration, bright colors, cheerful, text, words, letters, symbols"
    },
    "analog-horror": {
        name: "Analog Horror / VHS Glitch",
        icon: "📼",
        basePrompt: "Dark analog horror image with heavy VHS static, glitch artifacts, scanlines, and digital noise distorting the scene. Figures are mostly obscured by shadow with possible glowing eyes or unnatural grins barely visible. Low exposure, eerie dim lighting, muted washed-out colors.",
        colorOverride: "washed out colors, VHS grain, digital artifacts, scanlines, low exposure, muted greens and grays",
        technicalStyle: "analog horror, VHS aesthetic, glitch art, scanlines, digital noise, found footage, surveillance camera, lo-fi horror",
        negativePrompt: "high quality, clean, professional, sharp, colorful, cartoon, anime, bright, text, words, letters"
    },
    "editorial-cartoon": {
        name: "Editorial Cartoon / Satirical Comic",
        icon: "📰",
        basePrompt: "Editorial cartoon illustration in a modern web-comic style. Clean, bold linework with smooth confident outlines. Semi-flat digital coloring with soft gradients and minimal texture.",
        colorOverride: "saturated but controlled color palette, clean digital colors, soft gradients, no painterly texture",
        technicalStyle: "editorial cartoon, satirical comic illustration, modern digital comic, bold outlines, clean vector-style shading",
        negativePrompt: "photorealism, oil painting, watercolor, anime style, sketchy lines, hyper realism, text, words, letters"
    },
    "horror-anime": {
        name: "Dark Anime / Manga Style",
        icon: "🎌",
        basePrompt: "Dark anime horror illustration. Detailed manga-style linework with heavy cross-hatching for shadows. Style of Junji Ito or Berserk manga.",
        colorOverride: "high contrast, dramatic blacks, selective color accents, manga shading",
        technicalStyle: "dark anime, horror manga, detailed linework, dramatic lighting, Japanese horror aesthetic",
        negativePrompt: "cute, chibi, kawaii, bright happy colors, simple cartoon, text, words, letters"
    },
    "oil-painting": {
        name: "Classic Oil Painting",
        icon: "🖼️",
        basePrompt: "Classic oil painting horror art. Renaissance masters meets dark romanticism. Rich textures, dramatic chiaroscuro lighting. Style of Caravaggio, Goya's Black Paintings.",
        colorOverride: "rich deep colors, warm shadows, golden highlights, classical palette",
        technicalStyle: "oil painting, fine art, chiaroscuro, baroque lighting, museum quality, painterly brushstrokes",
        negativePrompt: "digital art, cartoon, anime, modern, photography, text, words, letters"
    },
    "found-footage": {
        name: "Found Footage / Grainy",
        icon: "📹",
        basePrompt: "Found footage horror aesthetic. Grainy VHS quality, security camera look, analog distortion. Night vision green or washed out colors.",
        colorOverride: "washed out colors, VHS grain, night vision green, analog artifacts",
        technicalStyle: "found footage, VHS aesthetic, security camera, analog horror, lo-fi, grainy",
        negativePrompt: "high quality, clean, professional, sharp, colorful, text, words, letters"
    },
    "surreal-nightmare": {
        name: "Surreal Nightmare",
        icon: "🌀",
        basePrompt: "Surrealist nightmare horror. Impossible geometry, melting forms, dream logic. Style of Zdzisław Beksiński, H.R. Giger, or Salvador Dali.",
        colorOverride: "muted earth tones, sepia, burnt oranges, biomechanical grays",
        technicalStyle: "surrealist art, nightmare imagery, biomechanical horror, Beksiński style, dreamlike",
        negativePrompt: "realistic, normal, cheerful, bright colors, cartoon, text, words, letters"
    }
};

// Custom styles stored in localStorage
let customArtStyles = JSON.parse(localStorage.getItem('customArtStyles') || '{}');

function loadStylesEditor() {
    renderBuiltinStyles();
    renderCustomStyles();
}

function renderBuiltinStyles() {
    const container = document.getElementById('builtin-styles-grid');
    if (!container) return;
    
    container.innerHTML = Object.entries(BUILTIN_ART_STYLES).map(([key, style]) => `
        <div class="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div class="flex items-center gap-2 mb-2">
                <span class="text-2xl">${style.icon}</span>
                <h4 class="font-semibold text-sm">${style.name}</h4>
            </div>
            <div class="text-xs space-y-2">
                <p><strong class="text-purple-400">Base:</strong> <span class="text-gray-400">${style.basePrompt.substring(0, 80)}...</span></p>
                <p><strong class="text-blue-400">Colors:</strong> <span class="text-gray-400">${style.colorOverride.substring(0, 50)}...</span></p>
                <p><strong class="text-green-400">Technical:</strong> <span class="text-gray-400">${style.technicalStyle.substring(0, 50)}...</span></p>
            </div>
        </div>
    `).join('');
}

function renderCustomStyles() {
    const container = document.getElementById('custom-styles-container');
    if (!container) return;
    
    const customKeys = Object.keys(customArtStyles);
    
    if (customKeys.length === 0) {
        container.innerHTML = `
            <div class="bg-gray-800/30 rounded-xl p-6 border border-dashed border-gray-700 text-center">
                <p class="text-gray-500">No custom styles yet. Click "+ Add Custom Style" to create one!</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = customKeys.map(key => {
        const style = customArtStyles[key];
        return `
            <div class="bg-gray-800/50 rounded-xl p-4 border border-purple-800/50">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                        <span class="text-2xl">${style.icon || '🎨'}</span>
                        <h4 class="font-semibold">${style.name}</h4>
                        <span class="bg-purple-900/50 text-purple-400 px-2 py-0.5 rounded text-xs">Custom</span>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="editCustomStyle('${key}')" class="text-blue-400 hover:text-blue-300 text-sm">Edit</button>
                        <button onclick="deleteCustomStyle('${key}')" class="text-red-400 hover:text-red-300 text-sm">Delete</button>
                    </div>
                </div>
                <div class="text-xs space-y-1 text-gray-400">
                    <p><strong class="text-purple-400">Base:</strong> ${style.basePrompt.substring(0, 100)}...</p>
                    <p><strong class="text-blue-400">Colors:</strong> ${style.colorOverride}</p>
                </div>
            </div>
        `;
    }).join('');
}

function addNewCustomStyle() {
    const styleId = 'custom-' + Date.now();
    openStyleEditor(styleId, {
        name: 'New Custom Style',
        icon: '🎨',
        basePrompt: '',
        colorOverride: '',
        technicalStyle: '',
        negativePrompt: 'text, words, letters, symbols'
    });
}

function editCustomStyle(key) {
    const style = customArtStyles[key];
    if (style) {
        openStyleEditor(key, style);
    }
}

function deleteCustomStyle(key) {
    if (confirm('Delete this custom style?')) {
        delete customArtStyles[key];
        localStorage.setItem('customArtStyles', JSON.stringify(customArtStyles));
        renderCustomStyles();
        updateCustomStyleDropdown();
    }
}

function openStyleEditor(styleId, style) {
    const modal = document.createElement('div');
    modal.id = 'style-editor-modal';
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
        <div class="bg-gray-900 rounded-2xl border border-gray-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div class="p-6">
                <h3 class="text-xl font-bold mb-4">🎨 Edit Art Style</h3>
                
                <div class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-semibold mb-1">Style Name</label>
                            <input type="text" id="style-name" value="${escapeHtml(style.name)}" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold mb-1">Icon (emoji)</label>
                            <input type="text" id="style-icon" value="${style.icon || '🎨'}" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" maxlength="4">
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold mb-1">Base Prompt <span class="text-purple-400">(main style description)</span></label>
                        <textarea id="style-base" rows="3" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">${escapeHtml(style.basePrompt)}</textarea>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold mb-1">Color Override <span class="text-blue-400">(color palette)</span></label>
                        <input type="text" id="style-colors" value="${escapeHtml(style.colorOverride)}" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold mb-1">Technical Style <span class="text-green-400">(rendering keywords)</span></label>
                        <input type="text" id="style-technical" value="${escapeHtml(style.technicalStyle)}" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold mb-1">Negative Prompt <span class="text-red-400">(what to avoid)</span></label>
                        <input type="text" id="style-negative" value="${escapeHtml(style.negativePrompt)}" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                    </div>
                </div>
                
                <div class="flex justify-end gap-3 mt-6">
                    <button onclick="closeStyleEditor()" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">Cancel</button>
                    <button onclick="saveCustomStyle('${styleId}')" class="px-4 py-2 bg-primary hover:bg-primary/80 rounded-lg text-sm font-semibold">Save Style</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function closeStyleEditor() {
    document.getElementById('style-editor-modal')?.remove();
}

function saveCustomStyle(styleId) {
    const style = {
        name: document.getElementById('style-name').value,
        icon: document.getElementById('style-icon').value || '🎨',
        basePrompt: document.getElementById('style-base').value,
        colorOverride: document.getElementById('style-colors').value,
        technicalStyle: document.getElementById('style-technical').value,
        negativePrompt: document.getElementById('style-negative').value
    };
    
    customArtStyles[styleId] = style;
    localStorage.setItem('customArtStyles', JSON.stringify(customArtStyles));
    
    closeStyleEditor();
    renderCustomStyles();
    updateCustomStyleDropdown();
}

function updateCustomStyleDropdown() {
    const select = document.getElementById('art-style');
    if (!select) return;
    
    // Remove existing custom options
    Array.from(select.options).forEach(opt => {
        if (opt.value.startsWith('custom-')) {
            select.removeChild(opt);
        }
    });
    
    // Add custom styles
    Object.entries(customArtStyles).forEach(([key, style]) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = `${style.icon} ${style.name} (Custom)`;
        select.appendChild(option);
    });
}

// =====================================================
// STEP NAVIGATION
// =====================================================

function goToStep(step) {
    // Update indicators
    for (let i = 1; i <= 4; i++) {
        const indicator = document.getElementById(`step-${i}-indicator`);
        if (!indicator) continue;
        
        indicator.classList.remove('active', 'completed');
        indicator.classList.add('bg-gray-700');
        
        if (i < step) {
            indicator.classList.remove('bg-gray-700');
            indicator.classList.add('completed');
        } else if (i === step) {
            indicator.classList.remove('bg-gray-700');
            indicator.classList.add('active');
        }
    }
    
    // Show/hide content
    document.querySelectorAll('.step-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(`step-${step}`)?.classList.remove('hidden');
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetGenerator() {
    currentJobId = null;
    currentScenes = [];
    if (pollInterval) clearInterval(pollInterval);
    
    // Clear the rendered scene cache to allow fresh renders
    Object.keys(renderedSceneUrls).forEach(key => delete renderedSceneUrls[key]);
    
    document.getElementById('story-title').value = '';
    document.getElementById('story-text').value = '';
    document.getElementById('scene-breakdown').innerHTML = '';
    document.getElementById('image-generation-grid').innerHTML = '';
    document.getElementById('generation-log').innerHTML = '<p>Waiting to start...</p>';
    
    goToStep(1);
}

// =====================================================
// STEP 1 -> 2: Generate Story Preview
// =====================================================

async function generateStoryPreview() {
    const btn = document.getElementById('btn-generate-story');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin inline-block">⏳</span> Generating Story...';
    
    try {
        const settings = getSettings();
        
        // If using custom style, include the custom style data
        if (settings.art_style?.startsWith('custom-')) {
            settings.custom_style = customArtStyles[settings.art_style];
        }
        
        // Create job in preview mode - this returns the story immediately!
        const result = await createJob({
            ...settings,
            preview_only: true
        });
        
        console.log('Preview result:', result);
        
        if (!result.success) {
            throw new Error(result.error || 'Failed to create job');
        }
        
        currentJobId = result.job_id;
        
        // Check if story is already in the response (it should be!)
        if (result.status === 'preview' && result.title && result.story_text) {
            // Story came back immediately - use it!
            displayStoryPreview(result);
            goToStep(2);
        } else {
            // Fallback: poll for story (shouldn't happen normally)
            console.log('Story not in response, polling...');
            let attempts = 0;
            const maxAttempts = 30;
            
            while (attempts < maxAttempts) {
                await sleep(2000);
                const status = await checkJob(currentJobId);
                console.log('Preview status:', status);
                
                if (status.status === 'preview' || status.status === 'complete') {
                    displayStoryPreview(status);
                    goToStep(2);
                    break;
                } else if (status.status === 'error' || status.status === 'failed') {
                    throw new Error(status.error || 'Story generation failed');
                }
                
                attempts++;
            }
            
            if (attempts >= maxAttempts) {
                throw new Error('Timeout waiting for story generation');
            }
        }
        
    } catch (error) {
        console.error('Story preview error:', error);
        showError(error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '✨ Generate Story Preview';
    }
}

// Store generation details globally for copy function
let currentGenerationDetails = null;

function displayStoryPreview(data) {
    document.getElementById('story-title').value = data.title || 'Untitled Story';
    document.getElementById('story-text').value = data.story_text || '';
    
    // Parse scenes from the response
    currentScenes = data.scenes || [];
    
    // If no scenes, create placeholder scenes based on story
    if (currentScenes.length === 0 && data.story_text) {
        const sceneCount = parseInt(document.getElementById('scene-count').value);
        const sentences = data.story_text.match(/[^.!?]+[.!?]+/g) || [data.story_text];
        const sentencesPerScene = Math.ceil(sentences.length / sceneCount);
        
        for (let i = 0; i < sceneCount; i++) {
            const start = i * sentencesPerScene;
            const end = Math.min(start + sentencesPerScene, sentences.length);
            const sceneText = sentences.slice(start, end).join(' ').trim();
            
            currentScenes.push({
                index: i,
                text: sceneText,
                keywords: [],
                startTime: 0,
                endTime: 0
            });
        }
    }
    
    // Display generation details if available
    if (data.generation_details) {
        displayGenerationDetails(data.generation_details);
    }
    
    // Render scene breakdown
    renderSceneBreakdown(currentScenes);
    
    // Update cost
    const cost = updateCostEstimate();
    document.getElementById('step2-cost').textContent = `~$${cost.toFixed(2)}`;
}

function renderSceneBreakdown(scenes) {
    const container = document.getElementById('scene-breakdown');
    if (!container) return;
    
    const visualSource = document.querySelector('input[name="visual-source"]:checked')?.value || 'ai';
    const aiModel = document.getElementById('ai-model')?.value || 'gpt-4o';
    const modelName = AI_MODEL_NAMES[aiModel] || 'AI';
    
    container.innerHTML = scenes.map((scene, i) => `
        <div class="scene-card bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div class="flex gap-4">
                <div class="w-20 h-28 flex-shrink-0 image-placeholder rounded-lg flex items-center justify-center text-gray-500">
                    <span class="text-2xl">🖼️</span>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-2">
                        <span class="bg-primary/20 text-primary px-2 py-0.5 rounded text-xs font-semibold">Scene ${i + 1}</span>
                        <span class="text-xs text-gray-500">${visualSource === 'ai' ? `🎨 ${modelName}` : '📹 Pexels'}</span>
                    </div>
                    <p class="text-sm text-gray-300 line-clamp-3">${escapeHtml(scene.text)}</p>
                </div>
            </div>
        </div>
    `).join('');
}

// =====================================================
// GENERATION DETAILS DISPLAY
// =====================================================

// Friendly names for presets
const VIBE_NAMES = {
    'slow_creepy': 'Slow Creepy',
    'punchy_shock': 'Punchy Shock',
    'atmospheric': 'Atmospheric'
};

const VISUAL_NAMES = {
    'forest': 'Dark Forest',
    'urban': 'Urban Decay',
    'house': 'Haunted House',
    'hospital': 'Abandoned Hospital',
    'ocean': 'Deep Ocean',
    'space': 'Space/Cosmic'
};

function displayGenerationDetails(details) {
    currentGenerationDetails = details;
    
    // Update all the detail fields
    const vibeEl = document.getElementById('detail-vibe');
    const durationEl = document.getElementById('detail-duration');
    const wordsEl = document.getElementById('detail-words');
    const visualEl = document.getElementById('detail-visual');
    const artStyleEl = document.getElementById('detail-art-style');
    const modelEl = document.getElementById('detail-model');
    const vibeDescEl = document.getElementById('detail-vibe-desc');
    const promptEl = document.getElementById('detail-prompt');
    const storyModelEl = document.getElementById('detail-story-model');
    const tempEl = document.getElementById('detail-temp');
    const scenesEl = document.getElementById('detail-scenes');
    
    if (vibeEl) vibeEl.textContent = VIBE_NAMES[details.vibe_preset] || details.vibe_preset;
    if (durationEl) durationEl.textContent = `${details.target_duration_sec}s`;
    if (wordsEl) wordsEl.textContent = details.word_range;
    if (visualEl) visualEl.textContent = VISUAL_NAMES[details.visual_preset] || details.visual_preset;
    if (artStyleEl) artStyleEl.textContent = details.art_style_name || details.art_style;
    if (modelEl) modelEl.textContent = AI_MODEL_NAMES[details.image_model] || details.image_model;
    if (vibeDescEl) vibeDescEl.textContent = `"${details.vibe_description}"`;
    if (promptEl) promptEl.textContent = details.story_prompt;
    if (storyModelEl) storyModelEl.textContent = details.story_model;
    if (tempEl) tempEl.textContent = details.story_temperature;
    if (scenesEl) scenesEl.textContent = details.scene_count;
}

function toggleGenerationDetails() {
    const panel = document.getElementById('generation-details');
    const arrow = document.getElementById('gen-details-arrow');
    if (panel && arrow) {
        panel.classList.toggle('hidden');
        arrow.style.transform = panel.classList.contains('hidden') ? '' : 'rotate(180deg)';
    }
}

function copyStoryPrompt() {
    if (currentGenerationDetails?.story_prompt) {
        navigator.clipboard.writeText(currentGenerationDetails.story_prompt).then(() => {
            showToast('Prompt copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    }
}

// Simple toast notification
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-in';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 2000);
}

// =====================================================
// STEP 2 -> 3 -> 4: Generate Images & Video
// =====================================================

// Debug panel toggle
function toggleDebugPanel() {
    const panel = document.getElementById('debug-panel');
    if (panel) {
        panel.classList.toggle('hidden');
    }
}

// Update debug info
function updateDebugInfo(data) {
    const jobIdEl = document.getElementById('debug-job-id');
    const selectedModelEl = document.getElementById('debug-selected-model');
    const backendModelEl = document.getElementById('debug-backend-model');
    const resolvedModelEl = document.getElementById('debug-resolved-model');
    const visualSourceEl = document.getElementById('debug-visual-source');
    const backendLogsEl = document.getElementById('debug-backend-logs');
    const replicateInputsEl = document.getElementById('debug-replicate-inputs');
    
    if (jobIdEl && currentJobId) {
        jobIdEl.textContent = currentJobId;
    }
    
    // Show what the user selected
    const aiModel = document.getElementById('ai-model')?.value || 'gpt-4o';
    const visualSource = document.querySelector('input[name="visual-source"]:checked')?.value || 'ai';
    
    if (selectedModelEl) {
        selectedModelEl.textContent = `${AI_MODEL_NAMES[aiModel] || aiModel} (${aiModel})`;
    }
    if (visualSourceEl) {
        visualSourceEl.textContent = visualSource;
    }
    
    // Show what the backend is reporting
    if (data) {
        if (backendModelEl && data.image_model) {
            backendModelEl.textContent = data.image_model;
            backendModelEl.className = data.image_model === aiModel 
                ? 'text-green-400 bg-gray-800 rounded px-2 py-1'  // Matches!
                : 'text-red-400 bg-gray-800 rounded px-2 py-1';   // Mismatch!
        }
        
        // Show resolved model (what's actually used)
        if (resolvedModelEl && data.resolved_image_model) {
            resolvedModelEl.textContent = data.resolved_image_model;
            resolvedModelEl.className = data.resolved_image_model === aiModel 
                ? 'text-green-400 bg-gray-800 rounded px-2 py-1'
                : 'text-orange-400 bg-gray-800 rounded px-2 py-1';
        }
        
        // Backend logs
        if (backendLogsEl && data.logs && data.logs.length > 0) {
            backendLogsEl.innerHTML = data.logs.map(log => 
                `<p class="${log.includes('ERROR') ? 'text-red-400' : log.includes('FLUX') ? 'text-purple-400' : 'text-green-400'}">${escapeHtml(log)}</p>`
            ).join('');
        }
        
        // Replicate inputs (FLUX debugging)
        if (replicateInputsEl && data.replicate_inputs && data.replicate_inputs.length > 0) {
            window.lastReplicateInputs = data.replicate_inputs; // Store for copy function
            replicateInputsEl.innerHTML = data.replicate_inputs.map((input, i) => `
                <div class="mb-3 pb-3 border-b border-gray-700 last:border-0">
                    <p class="text-purple-400 font-bold">[${i + 1}] ${input.model}</p>
                    <p class="text-gray-500 text-xs">${input.timestamp}</p>
                    <p class="text-gray-400 text-xs truncate">Endpoint: ${input.endpoint}</p>
                    <pre class="text-green-300 text-xs mt-1 whitespace-pre-wrap">${JSON.stringify(input.input, null, 2)}</pre>
                </div>
            `).join('');
        } else if (replicateInputsEl && aiModel === 'flux') {
            replicateInputsEl.innerHTML = '<p class="text-yellow-500">Waiting for FLUX API calls...</p>';
        }
        
        // Also log meta info
        if (data.meta?.image_model) {
            addLog(`📊 Job image_model in meta: ${data.meta.image_model}`);
        }
        if (data.meta?.resolved_image_model) {
            addLog(`📊 Resolved image_model: ${data.meta.resolved_image_model}`);
        }
    }
}

// Copy Replicate inputs to clipboard
function copyReplicateInputs() {
    if (window.lastReplicateInputs && window.lastReplicateInputs.length > 0) {
        const text = JSON.stringify(window.lastReplicateInputs, null, 2);
        navigator.clipboard.writeText(text).then(() => {
            alert('Replicate inputs copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy:', err);
            // Fallback: show in alert
            prompt('Copy this:', text.substring(0, 1000) + '...');
        });
    } else {
        alert('No Replicate inputs available yet.');
    }
}

// Copy debug logs to clipboard
function copyDebugLogs() {
    const logsEl = document.getElementById('debug-backend-logs');
    if (logsEl) {
        const text = logsEl.innerText;
        navigator.clipboard.writeText(text).then(() => {
            alert('Debug logs copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy:', err);
            prompt('Copy this:', text);
        });
    }
}

// Toggle between gallery and detailed scene view
function toggleScenesView() {
    const gallery = document.getElementById('result-scenes-gallery');
    const detailed = document.getElementById('result-scenes-detailed');
    const btn = document.getElementById('scenes-view-toggle');
    
    if (gallery && detailed && btn) {
        const showingGallery = !gallery.classList.contains('hidden');
        gallery.classList.toggle('hidden', showingGallery);
        detailed.classList.toggle('hidden', !showingGallery);
        btn.textContent = showingGallery ? '🖼️ Show Gallery' : '📋 Show Details';
    }
}

async function generateImages() {
    const btn = document.getElementById('btn-generate-images');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin inline-block">⏳</span> Starting...';
    
    goToStep(3);
    
    // Setup image generation grid
    const sceneCount = currentScenes.length;
    const visualSource = document.querySelector('input[name="visual-source"]:checked')?.value || 'ai';
    const aiModel = document.getElementById('ai-model')?.value || 'gpt-4o';
    
    // Initialize debug panel
    updateDebugInfo(null);
    addLog(`🎯 Selected model: ${AI_MODEL_NAMES[aiModel]} (${aiModel})`);
    addLog(`🎯 Visual source: ${visualSource}`);
    
    const grid = document.getElementById('image-generation-grid');
    grid.innerHTML = currentScenes.map((scene, i) => `
        <div id="scene-image-${i}" class="bg-gray-800/50 rounded-xl overflow-hidden border border-gray-700">
            <div class="aspect-[9/16] image-placeholder flex items-center justify-center">
                <span class="text-gray-500">⏳</span>
            </div>
            <div class="p-2">
                <p class="text-xs text-gray-400 truncate">Scene ${i + 1}</p>
                <p class="text-xs text-gray-600 truncate">Waiting...</p>
            </div>
        </div>
    `).join('');
    
    try {
        // Get updated story text (user may have edited it)
        const storyTitle = document.getElementById('story-title').value;
        const storyText = document.getElementById('story-text').value;
        
        // Run the full job
        addLog('Starting full video generation...');
        updateProgress(5, 'Initializing...');
        
        const result = await runJob(currentJobId, {
            title: storyTitle,
            story_text: storyText
        });
        
        if (!result.success) {
            throw new Error(result.error || 'Failed to start generation');
        }
        
        addLog('Job started, polling for progress...');
        
        // Poll for completion
        pollForCompletion();
        
    } catch (error) {
        console.error('Generation error:', error);
        addLog(`Error: ${error.message}`);
        showError(error.message);
        btn.disabled = false;
        btn.innerHTML = '🎨 Generate Images & Video';
    }
}

function pollForCompletion() {
    if (pollInterval) clearInterval(pollInterval);
    
    pollInterval = setInterval(async () => {
        try {
            const status = await checkJob(currentJobId);
            console.log('Poll result:', status);
            
            // Update debug panel with backend info
            updateDebugInfo(status);
            
            // Update progress
            const progress = status.progress || 0;
            updateProgress(progress, getProgressLabel(progress, status.status));
            
            // Log image model info when in images phase
            if (progress >= 55 && progress < 70 && status.image_model) {
                addLog(`🔧 Backend using: ${status.image_model}`);
            }
            
            // Update scenes if available
            if (status.scenes && status.scenes.length > 0) {
                updateSceneImages(status.scenes);
            }
            
            // Check completion
            if (status.status === 'complete') {
                clearInterval(pollInterval);
                addLog('✓ Video generation complete!');
                displayFinalResult(status);
                goToStep(4);
            } else if (status.status === 'error' || status.status === 'failed') {
                clearInterval(pollInterval);
                throw new Error(status.error || 'Generation failed');
            }
            
        } catch (error) {
            console.error('Poll error:', error);
            clearInterval(pollInterval);
            addLog(`Error: ${error.message}`);
            showError(error.message);
        }
    }, 3000);
}

function getProgressLabel(progress, status) {
    if (progress < 20) return 'Generating story...';
    if (progress < 40) return 'Creating voiceover...';
    if (progress < 60) return 'Processing audio...';
    if (progress < 70) return 'Generating images...';
    if (progress < 80) return 'Assembling video...';
    if (progress < 100) return 'Rendering final video...';
    return 'Complete!';
}

function updateProgress(percent, label) {
    document.getElementById('progress-bar').style.width = `${percent}%`;
    document.getElementById('progress-percent').textContent = `${percent}%`;
    document.getElementById('progress-label').textContent = label;
    document.getElementById('generation-status').textContent = label;
}

// Track which scenes have been rendered to avoid flickering
const renderedSceneUrls = {};

function updateSceneImages(scenes) {
    scenes.forEach((scene) => {
        // Use scene.index (from backend) to match the correct placeholder
        // This handles cases where scenes might arrive out of order or with gaps
        const sceneIndex = scene.index ?? 0;
        const card = document.getElementById(`scene-image-${sceneIndex}`);
        if (!card) {
            console.log(`[UI] No card found for scene-image-${sceneIndex}`);
            return;
        }
        
        const imageUrl = scene.videoUrl;
        if (!imageUrl) {
            console.log(`[UI] Scene ${sceneIndex} has no videoUrl`);
            return;
        }
        
        // OPTIMIZATION: Skip re-render if this scene's image hasn't changed
        if (renderedSceneUrls[sceneIndex] === imageUrl) {
            return; // Already rendered this exact image
        }
        
        // Mark this scene as rendered with this URL
        renderedSceneUrls[sceneIndex] = imageUrl;
        console.log(`[UI] Updating scene ${sceneIndex + 1} with new image`);
        
        // Better image/video detection:
        // 1. Check source field (most reliable - set by backend)
        // 2. Check file extension
        // 3. Check URL patterns as fallback
        const isImageBySource = scene.source === 'ai' || scene.source === 'dalle' || scene.source === 'flux';
        const isImageByExtension = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(imageUrl);
        const isVideoByExtension = /\.(mp4|webm|mov)(\?|$)/i.test(imageUrl);
        const isImageByUrl = imageUrl.includes('oaidalleapi') || 
                            imageUrl.includes('replicate.delivery') ||
                            imageUrl.includes('/images/');
        
        // Decide: image if any image indicator, video only if explicit video extension
        const isImage = isImageBySource || isImageByExtension || (isImageByUrl && !isVideoByExtension);
        
        // Build the prompt HTML - show full prompt with expand/collapse
        let promptHtml = '';
        if (scene.dallePrompt) {
            const promptId = `prompt-${sceneIndex}`;
            const shortPrompt = scene.dallePrompt.substring(0, 50);
            promptHtml = `
                <div class="mt-2 border-t border-gray-700 pt-2">
                    <p class="text-xs text-gray-500 mb-1">Prompt used:</p>
                    <div id="${promptId}-short" class="cursor-pointer" onclick="togglePrompt(${sceneIndex})">
                        <p class="text-xs text-blue-400">${escapeHtml(shortPrompt)}... <span class="text-gray-500">[click to expand]</span></p>
                    </div>
                    <div id="${promptId}-full" class="hidden">
                        <pre class="text-xs text-blue-300 whitespace-pre-wrap max-h-48 overflow-y-auto bg-gray-900 p-2 rounded">${escapeHtml(scene.dallePrompt)}</pre>
                        <button onclick="togglePrompt(${sceneIndex})" class="text-xs text-gray-500 mt-1">[collapse]</button>
                        <button onclick="copyPrompt(${sceneIndex})" class="text-xs text-purple-400 mt-1 ml-2">[copy]</button>
                    </div>
                </div>
            `;
            // Store prompt for copy function
            window.scenePrompts = window.scenePrompts || {};
            window.scenePrompts[sceneIndex] = scene.dallePrompt;
        }
        
        // Build visual beat HTML
        let visualBeatHtml = '';
        if (scene.visualBeat) {
            visualBeatHtml = '<p class="text-xs text-purple-400" title="' + escapeHtml(scene.visualBeat) + '">' + escapeHtml(scene.visualBeat) + '</p>';
        }
        
        card.innerHTML = `
            <div class="aspect-[9/16] bg-gray-900">
                ${isImage 
                    ? `<img src="${escapeHtml(imageUrl)}" class="w-full h-full object-cover" onerror="this.src='https://via.placeholder.com/200x350?text=Error'" loading="lazy">`
                    : `<video src="${escapeHtml(imageUrl)}" class="w-full h-full object-cover" muted loop onmouseenter="this.play()" onmouseleave="this.pause()"></video>`
                }
            </div>
            <div class="p-2">
                <p class="text-xs text-green-400">✓ Scene ${sceneIndex + 1} (${scene.source || 'unknown'})</p>
                ${visualBeatHtml}
                ${promptHtml}
            </div>
        `;
    });
}

// Toggle prompt visibility
function togglePrompt(sceneIndex) {
    const shortEl = document.getElementById(`prompt-${sceneIndex}-short`);
    const fullEl = document.getElementById(`prompt-${sceneIndex}-full`);
    if (shortEl && fullEl) {
        shortEl.classList.toggle('hidden');
        fullEl.classList.toggle('hidden');
    }
}

// Copy prompt to clipboard
function copyPrompt(sceneIndex) {
    const prompt = window.scenePrompts?.[sceneIndex];
    if (prompt) {
        navigator.clipboard.writeText(prompt).then(() => {
            alert('Prompt copied to clipboard!');
        });
    }
}

function addLog(message) {
    const log = document.getElementById('generation-log');
    const time = new Date().toLocaleTimeString();
    log.innerHTML += `<p>[${time}] ${escapeHtml(message)}</p>`;
    log.scrollTop = log.scrollHeight;
}

// =====================================================
// STEP 4: Display Final Result
// =====================================================

function displayFinalResult(data) {
    document.getElementById('result-video').src = data.video_url;
    document.getElementById('download-btn').href = data.video_url;
    document.getElementById('result-title').textContent = data.title || 'Untitled';
    document.getElementById('result-duration').textContent = data.duration_sec || 0;
    document.getElementById('result-scenes').textContent = data.scenes?.length || 0;
    document.getElementById('result-story').textContent = data.story_text || '';
    
    // Scene gallery - improved detection (consistent with updateSceneImages)
    const gallery = document.getElementById('result-scenes-gallery');
    const detailed = document.getElementById('result-scenes-detailed');
    
    if (data.scenes && gallery) {
        gallery.innerHTML = data.scenes.map((scene, i) => {
            const url = scene.videoUrl || scene.storage_path || '';
            if (!url) {
                return `<div class="aspect-[9/16] bg-gray-800 rounded-lg flex items-center justify-center text-gray-500 text-xs">No image</div>`;
            }
            
            // Better image/video detection (same logic as updateSceneImages)
            const isImageBySource = scene.source === 'ai' || scene.source === 'dalle' || scene.source === 'flux';
            const isImageByExtension = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url);
            const isVideoByExtension = /\.(mp4|webm|mov)(\?|$)/i.test(url);
            const isImageByUrl = url.includes('oaidalleapi') || 
                                url.includes('replicate.delivery') ||
                                url.includes('openai') ||
                                url.includes('/images/');
            const isImage = isImageBySource || isImageByExtension || (isImageByUrl && !isVideoByExtension);
            
            return `
                <div class="aspect-[9/16] bg-gray-900 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all" onclick="showImageModal('${escapeHtml(url)}')">
                    ${isImage 
                        ? `<img src="${escapeHtml(url)}" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'flex items-center justify-center h-full text-gray-500 text-xs\\'>Failed</div>'">`
                        : `<video src="${escapeHtml(url)}" class="w-full h-full object-cover" muted></video>`
                    }
                </div>
            `;
        }).join('');
    }
    
    // Detailed scene view with text and prompt info
    if (data.scenes && detailed) {
        detailed.innerHTML = data.scenes.map((scene, i) => {
            const url = scene.videoUrl || scene.storage_path || '';
            const text = scene.text || scene.scene_text || 'No text';
            const prompt = scene.dalle_prompt || scene.prompt || '';
            const model = scene.image_model || scene.source || 'Unknown';
            const startTime = scene.startTime !== undefined ? formatTime(scene.startTime) : '?';
            const endTime = scene.endTime !== undefined ? formatTime(scene.endTime) : '?';
            
            return `
                <div class="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
                    <div class="flex gap-3">
                        <div class="w-16 h-24 flex-shrink-0 bg-gray-800 rounded overflow-hidden">
                            ${url 
                                ? `<img src="${escapeHtml(url)}" class="w-full h-full object-cover" loading="lazy" onerror="this.src=''">`
                                : `<div class="flex items-center justify-center h-full text-gray-600 text-xs">No img</div>`
                            }
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 mb-1">
                                <span class="bg-primary/20 text-primary px-2 py-0.5 rounded text-xs font-bold">Scene ${i + 1}</span>
                                <span class="text-xs text-gray-500">${startTime} - ${endTime}</span>
                                <span class="text-xs text-purple-400">${escapeHtml(model)}</span>
                            </div>
                            <p class="text-xs text-gray-300 mb-2 line-clamp-2">${escapeHtml(text)}</p>
                            ${prompt ? `
                                <details class="text-xs">
                                    <summary class="text-purple-400 cursor-pointer hover:text-purple-300">View Prompt</summary>
                                    <p class="mt-1 text-gray-500 text-xs bg-gray-800 p-2 rounded max-h-24 overflow-y-auto">${escapeHtml(prompt.substring(0, 500))}${prompt.length > 500 ? '...' : ''}</p>
                                </details>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    // Cost breakdown
    const sceneCount = data.scenes?.length || 4;
    const visualSource = document.querySelector('input[name="visual-source"]:checked')?.value || 'ai';
    const aiModel = document.getElementById('ai-model')?.value || 'gpt-4o';
    const isAI = visualSource === 'ai';
    const costPerImage = AI_MODEL_COSTS[aiModel] || 0.03;
    const imageCost = isAI ? sceneCount * costPerImage : 0;
    const totalCost = 0.01 + 0.05 + imageCost;
    
    // Update detailed cost elements
    const imageCountEl = document.getElementById('result-image-count');
    const imageModelEl = document.getElementById('result-image-model');
    const imageCostEl = document.getElementById('result-image-cost');
    const totalCostEl = document.getElementById('result-cost');
    
    if (imageCountEl) imageCountEl.textContent = sceneCount;
    if (imageModelEl) imageModelEl.textContent = isAI ? AI_MODEL_NAMES[aiModel] : 'Pexels';
    if (imageCostEl) {
        if (isAI) {
            imageCostEl.textContent = `~$${imageCost.toFixed(2)}`;
            imageCostEl.className = 'text-purple-400';
        } else {
            imageCostEl.textContent = 'Free';
            imageCostEl.className = 'text-green-400';
        }
    }
    if (totalCostEl) totalCostEl.textContent = `~$${totalCost.toFixed(2)}`;
}

// =====================================================
// ERROR HANDLING
// =====================================================

function showError(message) {
    document.getElementById('error-message').textContent = message;
    document.getElementById('error-modal').classList.remove('hidden');
}

function closeErrorModal() {
    document.getElementById('error-modal').classList.add('hidden');
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

function getSettings() {
    return {
        theme: document.getElementById('theme')?.value || 'general',
        visual_source: document.querySelector('input[name="visual-source"]:checked')?.value || 'ai',
        image_model: document.getElementById('ai-model')?.value || 'gpt-4o',
        art_style: document.getElementById('art-style')?.value || 'cinematic-dark',
        visual_preset: document.getElementById('visual-preset')?.value || 'forest',
        duration: document.getElementById('duration')?.value || 'medium',
        caption_style: document.getElementById('caption-style')?.value || 'bold',
        scene_count: parseInt(document.getElementById('scene-count')?.value || 4),
        skip_video_assembly: document.getElementById('skip-video-assembly')?.checked || false,
        effects: {
            filter: document.getElementById('effect-filter')?.checked ?? true,
            kenburns: document.getElementById('effect-kenburns')?.checked ?? true,
            vignette: document.getElementById('effect-vignette')?.checked ?? true,
            filmGrain: document.getElementById('effect-filmgrain')?.checked ?? false,
            highlight: document.getElementById('effect-highlight')?.checked ?? true,
            transitions: document.getElementById('effect-transitions')?.checked ?? true
        }
    };
}

// =====================================================
// CAPTION STYLE SELECTOR
// =====================================================
function initCaptionStyleSelector() {
    const grid = document.getElementById('caption-style-grid');
    const hiddenInput = document.getElementById('caption-style');
    
    if (!grid || !hiddenInput) return;
    
    grid.addEventListener('click', (e) => {
        const btn = e.target.closest('.caption-style-btn');
        if (!btn) return;
        
        // Remove active from all buttons
        grid.querySelectorAll('.caption-style-btn').forEach(b => b.classList.remove('active'));
        
        // Add active to clicked button
        btn.classList.add('active');
        
        // Update hidden input value
        hiddenInput.value = btn.dataset.style;
        
        console.log('[UI] Caption style selected:', btn.dataset.style);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
