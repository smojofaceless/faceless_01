// Image prompt config modal + test image generation
// Extracted from brands.html inline script

let ipBrandId = null;
let ipCurrentConfig = null;
let ipPresetType = null;

async function openImagePromptModal(brandId) {
    ipBrandId = brandId;
    const modal = document.getElementById('imgprompt-modal');
    if (modal.parentElement !== document.body) document.body.appendChild(modal);

    // Find brand name
    // Build preset tabs (replaces old vibe dropdown)
    const defaultType = await buildPresetTabBar('ip-preset-tabs', brandId, async (templateType) => {
        ipPresetType = templateType;
        // Also sync the old vibe dropdown (kept for "Load Preset Defaults" button)
        const vibeSelect = document.getElementById('ip-vibe-preset');
        if (vibeSelect) vibeSelect.value = templateType;
        await loadImagePromptConfig(brandId, templateType);
    });
    ipPresetType = defaultType;

    // Also populate the old dropdown (in case it's still visible) and sync
    const vibeSelect = document.getElementById('ip-vibe-preset');
    await populateVibeDropdown(vibeSelect, brandId);
    if (vibeSelect && defaultType) vibeSelect.value = defaultType;

    await loadImagePromptConfig(brandId, defaultType);

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// Icon map for known preset types
const VIBE_ICONS = {
    urban_legend: '📜', one_too_many: '👥', backrooms: '🚪',
    nosleep: '😱', glitch: '⚡', analog_horror: '📼'
};

async function populateVibeDropdown(selectEl, brandId) {
    try {
        const presets = await brandManager.getVibePresets(brandId);
        selectEl.innerHTML = '';
        if (presets && presets.length > 0) {
            // Show brand's configured presets (sorted by weight desc)
            for (const p of presets) {
                const icon = VIBE_ICONS[p.template_type] || '🎭';
                const opt = document.createElement('option');
                opt.value = p.template_type;
                opt.textContent = `${icon} ${p.name}`;
                if (p.is_default) opt.selected = true;
                selectEl.appendChild(opt);
            }
        } else {
            // Fallback: show system defaults
            selectEl.innerHTML = `
                <option value="urban_legend">📜 Urban Legend</option>
                <option value="one_too_many">👥 One Too Many</option>
            `;
        }
    } catch (e) {
        console.error('Failed to populate vibe dropdown:', e);
        selectEl.innerHTML = `
            <option value="urban_legend">📜 Urban Legend</option>
            <option value="one_too_many">👥 One Too Many</option>
        `;
    }
}

function closeImagePromptModal() {
    const modal = document.getElementById('imgprompt-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
    ipBrandId = null;
    ipPresetType = null;
}

// Track whether the current preset is in gameplay mode
let ipCurrentVisualType = null;

async function loadImagePromptConfig(brandId, vibePreset) {
    try {
        const statusEl = document.getElementById('ip-status');
        if (statusEl) statusEl.textContent = 'Loading...';
        // Load the full config_overrides (to get visual_type at the top level)
        const fullConfig = await brandManager.getPresetConfigSection(brandId, vibePreset, null);
        ipCurrentVisualType = fullConfig?.visual_type || null;
        
        // Load image_prompt section
        const raw = fullConfig?.image_prompt || null;
        ipCurrentConfig = raw;
        populateImagePromptForm(raw);
        
        // Show/hide gameplay banner and image settings
        updateGameplayBanner(ipCurrentVisualType === 'gameplay');
        
        if (statusEl) statusEl.textContent = raw
            ? 'Editing: ' + vibePreset
            : ipCurrentVisualType === 'gameplay'
                ? '🎮 Gameplay preset — ' + vibePreset
                : 'No image prompt config for ' + vibePreset + ' — using defaults';
    } catch (e) {
        const statusEl = document.getElementById('ip-status');
        if (statusEl) statusEl.textContent = 'Failed to load config';
        console.error(e);
    }
}

function updateGameplayBanner(isGameplay) {
    const banner = document.getElementById('ip-gameplay-banner');
    const container = document.getElementById('ip-image-settings-container');
    const toggle = document.getElementById('ip-gameplay-toggle');
    const track = document.getElementById('ip-gameplay-track');
    const thumb = document.getElementById('ip-gameplay-thumb');
    const title = document.getElementById('ip-gameplay-title');

    if (!banner || !toggle || !track || !thumb || !title || !container) {
        console.warn('[updateGameplayBanner] Missing elements, skipping', { banner: !!banner, toggle: !!toggle, container: !!container });
        return;
    }
    
    console.log('[updateGameplayBanner] isGameplay=', isGameplay);
    
    // Always show banner so user can toggle
    banner.style.display = 'block';
    toggle.checked = isGameplay;
    
    const descEl = document.getElementById('ip-gameplay-desc');

    if (isGameplay) {
        title.textContent = 'Background Video Mode';
        title.style.color = '#34d399';
        track.style.background = 'rgba(34,197,94,0.4)';
        thumb.style.transform = 'translateX(20px)';
        container.style.display = 'none';
        banner.style.background = 'linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.10))';
        banner.style.borderColor = 'rgba(34,197,94,0.25)';
        if (descEl) descEl.textContent = 'This preset uses gameplay/background video instead of AI-generated images. Image settings below are hidden.';
    } else {
        title.textContent = 'AI Image Mode';
        title.style.color = '#60a5fa';
        track.style.background = 'rgba(96,165,250,0.3)';
        thumb.style.transform = 'translateX(0)';
        container.style.display = '';
        container.style.removeProperty('display');
        banner.style.background = 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(139,92,246,0.06))';
        banner.style.borderColor = 'rgba(59,130,246,0.2)';
        if (descEl) descEl.textContent = 'This preset generates AI images for each scene. Toggle to switch to background video mode.';
    }
}

async function onGameplayToggle() {
    const toggle = document.getElementById('ip-gameplay-toggle');
    const isGameplay = toggle.checked;
    
    updateGameplayBanner(isGameplay);
    
    // Save the visual_type change to the DB
    if (ipBrandId && ipPresetType) {
        try {
            const fullConfig = await brandManager.getPresetConfigSection(ipBrandId, ipPresetType, null);
            const overrides = fullConfig || {};
            overrides.visual_type = isGameplay ? 'gameplay' : 'ai_images';
            if (isGameplay) {
                overrides.art_style = 'none';
            }
            
            // Save directly to brand_templates config_overrides
            const { error } = await supabaseClient
                .from('brand_templates')
                .update({ config_overrides: overrides, updated_at: new Date().toISOString() })
                .eq('brand_id', ipBrandId)
                .eq('template_type', ipPresetType);
            
            if (error) throw error;
            
            ipCurrentVisualType = isGameplay ? 'gameplay' : 'ai_images';
            const status = document.getElementById('ip-status');
            status.textContent = isGameplay 
                ? '✓ Switched to gameplay mode' 
                : '✓ Switched to AI image mode';
            
            if (typeof toast !== 'undefined') {
                toast.success(isGameplay ? 'Preset set to gameplay mode' : 'Preset set to AI image mode');
            }
        } catch (e) {
            console.error('Failed to update visual_type:', e);
            // Revert toggle
            toggle.checked = !isGameplay;
            updateGameplayBanner(!isGameplay);
            if (typeof toast !== 'undefined') toast.error('Failed to save mode change');
        }
    }
}

function populateImagePromptForm(cfg) {
    if (!cfg) return;
    if (!document.getElementById('ip-image-model')) return;
    document.getElementById('ip-image-model').value = cfg.image_model || 'gpt-image-1';
    // ComfyUI-specific fields
    document.getElementById('ip-comfyui-workflow').value = cfg.comfyui_workflow || 'txt2img_sdxl';
    document.getElementById('ip-comfyui-checkpoint').value = cfg.comfyui_checkpoint || '';
    document.getElementById('ip-comfyui-steps').value = cfg.comfyui_steps || 28;
    document.getElementById('ip-comfyui-cfg').value = cfg.comfyui_cfg || 5.5;
    // img2vid fields
    document.getElementById('ip-video-mode').value = cfg.video_mode || 'static';
    document.getElementById('ip-img2vid-workflow').value = cfg.img2vid_workflow || 'animatediff_ipa';
    document.getElementById('ip-img2vid-motion').value = cfg.img2vid_motion ?? 0.5;
    document.getElementById('ip-img2vid-motion-label').textContent = cfg.img2vid_motion ?? 0.5;
    document.getElementById('ip-img2vid-fps').value = cfg.img2vid_fps || 8;
    document.getElementById('ip-img2vid-frames').value = cfg.img2vid_frames || 25;
    toggleComfyUISettings();
    toggleImg2VidSettings();
    document.getElementById('ip-art-style').value = cfg.art_style || 'cinematic-dark';
    document.getElementById('ip-style-prompt').value = cfg.style_prompt || '';
    document.getElementById('ip-environment').value = cfg.environment || '';
    document.getElementById('ip-color-palette').value = cfg.color_palette || '';
    document.getElementById('ip-lighting').value = cfg.lighting || '';
    document.getElementById('ip-mood').value = cfg.mood || '';
    document.getElementById('ip-camera-angles').value = (cfg.camera_angles || []).join('\n');
    document.getElementById('ip-tension').checked = cfg.tension_escalation !== false;
    document.getElementById('ip-negative').value = cfg.negative_prompt || '';
    document.getElementById('ip-suffix').value = cfg.suffix || '';
    updateImagePromptPreview();
}

// ── Art Style Change Handler ──
// When the art style dropdown changes, auto-populate the style_prompt
// and color palette from the built-in style definition if the fields
// are empty or still match the previous style's defaults.
const ART_STYLE_DEFAULTS = {
    'cinematic-dark': {
        style_prompt: 'Cinematic dark photography. Moody desaturated colors, deep shadows, film grain, A24 horror film aesthetic. Realistic but atmospheric, shallow depth of field, dramatic lighting.',
        color_palette: 'muted colors, deep shadows, film grain, desaturated with selective color',
        lighting: 'low-key, harsh directional shadows, rim lighting',
        mood: 'dread, tension, atmospheric unease',
    },
    'analog-horror': {
        style_prompt: 'Dark analog horror image with heavy VHS static, glitch artifacts, scanlines, and digital noise. Low exposure, eerie dim lighting, muted washed-out colors. Found-footage style.',
        color_palette: 'washed out colors, VHS grain, digital artifacts, scanlines, muted greens and grays',
        lighting: 'low exposure, flickering, dim ambient glow',
        mood: 'eerie, unsettling, creeping dread',
    },
    'uncanny-illustrated': {
        style_prompt: 'Editorial cartoon illustration in graphic novel style. Cel-shaded horror scene with bold black ink outlines. Flat shading with varied color palette. Posterized tones like a vintage comic panel. Uncanny faces with smiles too wide, eyes too white.',
        color_palette: 'warm natural skin tones, varied clothing colors, rich environment colors, VHS chromatic aberration',
        lighting: 'flat cartoon lighting with dramatic shadows',
        mood: 'uncanny, disturbing, lo-fi horror cartoon',
    },
    'horror-anime': {
        style_prompt: 'Dark anime horror illustration. Detailed manga-style linework with heavy cross-hatching for shadows. Dramatic poses, expressive characters. Style of Junji Ito or Berserk manga. High contrast with color accents.',
        color_palette: 'high contrast, dramatic blacks, selective color accents, manga shading',
        lighting: 'dramatic anime lighting, stark contrasts',
        mood: 'intense, visceral, psychological horror',
    },
    'oil-painting': {
        style_prompt: 'Classic oil painting horror art. Renaissance masters meets dark romanticism. Rich textures, dramatic chiaroscuro lighting, painterly brushstrokes. Style of Caravaggio, Goya\'s Black Paintings.',
        color_palette: 'rich deep colors, warm shadows, golden highlights, classical palette',
        lighting: 'chiaroscuro, baroque candlelight, dramatic',
        mood: 'timeless, dark romantic, ominous grandeur',
    },
    'found-footage': {
        style_prompt: 'Found footage horror aesthetic. Grainy VHS quality, security camera look, analog distortion. Night vision green or washed out colors. Blair Witch Project aesthetic.',
        color_palette: 'washed out colors, VHS grain, night vision green, analog artifacts',
        lighting: 'surveillance camera, night vision, harsh flash',
        mood: 'paranoia, voyeuristic dread, accidental capture',
    },
    'surreal-nightmare': {
        style_prompt: 'Surrealist nightmare horror. Impossible geometry, melting forms, dream logic. Style of Zdzisław Beksiński, H.R. Giger, or Salvador Dali. Organic meets mechanical.',
        color_palette: 'muted earth tones, sepia, burnt oranges, biomechanical grays',
        lighting: 'otherworldly glow, no natural light source',
        mood: 'subconscious terror, fever dream, existential dread',
    },
    'rnmort': {
        style_prompt: 'Adult animated cartoon illustration in the style of Rick and Morty. Bold thick black outlines on every character and object. Flat cel-shaded coloring with vibrant saturated hues. Exaggerated character proportions — large expressive heads, dot-like pupils, wide mouths. Dark horror atmosphere but rendered in colorful cartoon style. Fluid organic shapes, slightly wobbly linework for hand-drawn feel.',
        color_palette: 'vibrant saturated cartoon colors, neon greens and purples, warm skin tones, deep moody backgrounds with bright character colors',
        lighting: 'flat cartoon lighting with dramatic color contrast, neon accent glows',
        mood: 'darkly humorous, unsettling cartoon horror, absurd dread',
    },
    'manga-horror': {
        style_prompt: 'Dark horror manga illustration in the style of Junji Ito. Heavy black ink linework, obsessive cross-hatching, extreme detail on faces and hands showing dread. High contrast monochrome with selective blood-red accents. Panel-like compositions, dramatic foreshortening, spiral and repetitive motifs suggesting counting obsession. Thick bold outlines, deep pure blacks, white negative space used for horror emphasis.',
        color_palette: 'monochrome with selective blood-red accents, pure deep blacks, stark whites, ink wash greys, no warm tones except blood',
        lighting: 'harsh directional manga lighting, pure black shadows with no gradient, single dramatic light source, spotlight isolation on faces, rim lighting for silhouettes',
        mood: 'obsessive counting dread, something extra that should not be there, Junji Ito spiral madness, uncanny wrongness in numbers and faces',
    },
    'vhs-horror': {
        style_prompt: 'Eerie horror photography with VHS tape degradation, warped distorted realism, analog video artifacts, grainy surveillance quality, chromatic aberration, found-footage documentary aesthetic.',
        color_palette: 'washed-out sickly green and yellow undertones, VHS color bleeding, crushed blacks, sodium vapor orange, desaturated flesh tones',
        lighting: 'harsh overhead fluorescent, security camera angles, single-source interrogation lighting, flickering CRT glow',
        mood: 'documentary unease, archival dread, something wrong in old footage',
    },
    // ── Decide This Daily art styles ──
    'editorial-clean': {
        style_prompt: 'Clean editorial photography with crisp focus and modern composition. Bright, well-lit scenes with natural color grading. Studio-quality lighting, professional portrait style. Warm neutral tones with selective vibrant accents. Contemporary magazine aesthetic.',
        color_palette: 'warm neutrals, clean whites, soft earth tones, selective vibrant accent colors, natural skin tones',
        lighting: 'soft key light, subtle fill, natural window light, studio three-point setup',
        mood: 'thoughtful, approachable, inviting contemplation',
    },
    'surreal-contemplative': {
        style_prompt: 'Surreal contemplative art blending dreamlike imagery with philosophical undertones. Soft focus transitions, ethereal atmosphere, impossible but beautiful compositions. Muted pastels meeting deep saturated accents. Magritte meets modern conceptual photography.',
        color_palette: 'muted pastels, deep indigo, amber highlights, twilight purples, smoky blues with warm gold accents',
        lighting: 'diffused ambient glow, golden hour warmth, ethereal backlight, soft shadows',
        mood: 'introspective, philosophically unsettling, dreamlike wonder, quiet tension',
    },
    'cinematic-contrast': {
        style_prompt: 'High-contrast cinematic photography with bold visual drama. Sharp blacks and bright highlights, dramatic color blocking. Split lighting, strong compositional lines. Blockbuster poster aesthetic with editorial precision. Vivid color pops against dark backgrounds.',
        color_palette: 'bold contrast, deep blacks, vivid reds and blues, neon highlights against dark backgrounds, silver metallics',
        lighting: 'hard directional key light, strong shadows, rim lighting for separation, dramatic split lighting',
        mood: 'high stakes, decisive tension, dramatic confrontation, bold choices',
    },
};

function onArtStyleChanged() {
    const style = document.getElementById('ip-art-style').value;
    const defaults = ART_STYLE_DEFAULTS[style];
    if (!defaults) return;

    // Check if current style_prompt is empty or matches any known default
    const currentPrompt = document.getElementById('ip-style-prompt').value.trim();
    const isDefaultPrompt = !currentPrompt || Object.values(ART_STYLE_DEFAULTS).some(d => 
        currentPrompt === d.style_prompt || currentPrompt.startsWith(d.style_prompt.substring(0, 40))
    );

    if (isDefaultPrompt) {
        document.getElementById('ip-style-prompt').value = defaults.style_prompt;
    }

    // Same for color palette
    const currentPalette = document.getElementById('ip-color-palette').value.trim();
    const isDefaultPalette = !currentPalette || Object.values(ART_STYLE_DEFAULTS).some(d =>
        currentPalette === d.color_palette || currentPalette.startsWith(d.color_palette.substring(0, 30))
    );
    if (isDefaultPalette) {
        document.getElementById('ip-color-palette').value = defaults.color_palette;
    }

    // Same for lighting
    const currentLighting = document.getElementById('ip-lighting').value.trim();
    const isDefaultLighting = !currentLighting || Object.values(ART_STYLE_DEFAULTS).some(d =>
        currentLighting === d.lighting || currentLighting.startsWith(d.lighting.substring(0, 20))
    );
    if (isDefaultLighting) {
        document.getElementById('ip-lighting').value = defaults.lighting;
    }

    // Same for mood
    const currentMood = document.getElementById('ip-mood').value.trim();
    const isDefaultMood = !currentMood || Object.values(ART_STYLE_DEFAULTS).some(d =>
        currentMood === d.mood || currentMood.startsWith(d.mood.substring(0, 20))
    );
    if (isDefaultMood) {
        document.getElementById('ip-mood').value = defaults.mood;
    }

    updateImagePromptPreview();
}

// ── ComfyUI Settings Toggle ──
function toggleComfyUISettings() {
    const model = document.getElementById('ip-image-model').value;
    const panel = document.getElementById('comfyui-settings');
    if (panel) {
        panel.style.display = model === 'comfyui' ? 'block' : 'none';
    }
    // Also toggle img2vid visibility since it depends on ComfyUI
    toggleImg2VidSettings();
}

// ── img2vid Settings Toggle ──
function toggleImg2VidSettings() {
    const videoMode = document.getElementById('ip-video-mode')?.value;
    const panel = document.getElementById('img2vid-settings');
    if (panel) {
        panel.style.display = videoMode === 'img2vid' ? 'block' : 'none';
    }
}

// ── ComfyUI Health Check ──
async function checkComfyUIHealth() {
    const dot = document.getElementById('comfyui-health-dot');
    const info = document.getElementById('comfyui-health-info');
    if (!dot || !info) return;

    dot.style.background = '#d29922'; // yellow = checking
    info.textContent = 'Checking...';

    try {
        // Try video-renderer's comfyui-health endpoint
        const rendererUrl = window.appConfig?.VIDEO_RENDERER_URL
            || window.appConfig?.FFMPEG_RENDERER_URL
            || 'http://localhost:3001';
        const res = await fetch(`${rendererUrl}/comfyui-health`, { signal: AbortSignal.timeout(5000) });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.available) {
            dot.style.background = '#3fb950'; // green
            info.innerHTML = `<strong style="color:#3fb950">✓ Online</strong> — ${data.gpu || 'GPU'} | VRAM: ${data.gpu_vram_free_mb || '?'}MB free / ${data.gpu_vram_total_mb || '?'}MB | Queue: ${data.queue_size ?? '?'}/${data.queue_limit ?? '?'}`;
        } else {
            dot.style.background = '#d29922'; // yellow
            const reason = data.fallback_reason || 'unavailable';
            info.innerHTML = `<strong style="color:#d29922">⚠ ${reason}</strong> — ${data.gpu || 'GPU'} | VRAM: ${data.gpu_vram_free_mb || '?'}MB free | Queue: ${data.queue_size ?? '?'}/${data.queue_limit ?? '?'}`;
        }
    } catch (err) {
        dot.style.background = '#f85149'; // red
        info.innerHTML = `<strong style="color:#f85149">✗ Offline</strong> — Could not reach video renderer. Make sure <code>server_clean.js</code> and ComfyUI are running.`;
    }
}

function buildImagePromptConfigFromForm() {
    const imageModel = document.getElementById('ip-image-model').value;
    const cfg = {
        image_model: imageModel,
        art_style: document.getElementById('ip-art-style').value,
        style_prompt: document.getElementById('ip-style-prompt').value.trim(),
        environment: document.getElementById('ip-environment').value.trim(),
        color_palette: document.getElementById('ip-color-palette').value.trim(),
        lighting: document.getElementById('ip-lighting').value.trim(),
        mood: document.getElementById('ip-mood').value.trim(),
        camera_angles: document.getElementById('ip-camera-angles').value.trim().split('\n').filter(l => l.trim()),
        tension_escalation: document.getElementById('ip-tension').checked,
        negative_prompt: document.getElementById('ip-negative').value.trim(),
        suffix: document.getElementById('ip-suffix').value.trim(),
    };
    // Include ComfyUI settings only when ComfyUI is selected
    if (imageModel === 'comfyui') {
        cfg.comfyui_workflow = document.getElementById('ip-comfyui-workflow').value;
        cfg.comfyui_checkpoint = document.getElementById('ip-comfyui-checkpoint').value.trim() || null;
        cfg.comfyui_steps = parseInt(document.getElementById('ip-comfyui-steps').value) || 28;
        cfg.comfyui_cfg = parseFloat(document.getElementById('ip-comfyui-cfg').value) || 5.5;
        // img2vid settings
        cfg.video_mode = document.getElementById('ip-video-mode').value || 'static';
        if (cfg.video_mode === 'img2vid') {
            cfg.img2vid_workflow = document.getElementById('ip-img2vid-workflow').value || 'animatediff_ipa';
            cfg.img2vid_motion = parseFloat(document.getElementById('ip-img2vid-motion').value) ?? 0.5;
            cfg.img2vid_fps = parseInt(document.getElementById('ip-img2vid-fps').value) || 8;
            cfg.img2vid_frames = parseInt(document.getElementById('ip-img2vid-frames').value) || 25;
        }
    }
    return cfg;
}

function updateImagePromptPreview() {
    const cfg = buildImagePromptConfigFromForm();
    const tensionLevel = cfg.tension_escalation ? 3 : 5;
    const camera = (cfg.camera_angles || [])[0] || '';
    const parts = [
        '[Scene text would appear here]',
        '',
        `Style: ${cfg.style_prompt}`,
        `Environment: ${cfg.environment}`,
        `Mood: ${cfg.mood}, tension level ${tensionLevel}/10`,
        camera ? `Camera: ${camera}` : '',
        `Lighting: ${cfg.lighting}`,
        `Color: ${cfg.color_palette}`,
        '',
        cfg.negative_prompt,
        cfg.suffix,
    ].filter(Boolean);
    document.getElementById('ip-preview').textContent = parts.join('\n');
}

// Wire up live preview on all inputs
document.addEventListener('DOMContentLoaded', () => {
    const ipFields = ['ip-image-model', 'ip-art-style', 'ip-style-prompt', 'ip-environment', 'ip-color-palette',
                      'ip-lighting', 'ip-mood', 'ip-camera-angles', 'ip-tension',
                      'ip-negative', 'ip-suffix',
                      'ip-comfyui-workflow', 'ip-comfyui-checkpoint', 'ip-comfyui-steps', 'ip-comfyui-cfg'];
    ipFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateImagePromptPreview);
        if (el) el.addEventListener('change', updateImagePromptPreview);
    });

    // Load Preset Defaults button (reloads current preset's config)
    document.getElementById('ip-load-preset').addEventListener('click', async () => {
        const vibe = ipPresetType || document.getElementById('ip-vibe-preset').value;
        if (ipBrandId) await loadImagePromptConfig(ipBrandId, vibe);
    });

    // Vibe preset dropdown change syncs with tabs
    document.getElementById('ip-vibe-preset').addEventListener('change', async () => {
        const vibe = document.getElementById('ip-vibe-preset').value;
        ipPresetType = vibe;
        // Sync tab bar highlight
        const tabBar = document.getElementById('ip-preset-tabs');
        if (tabBar) {
            tabBar.querySelectorAll('.preset-tab').forEach(t => {
                t.classList.toggle('preset-tab--active', t.dataset.type === vibe);
            });
        }
        if (ipBrandId) await loadImagePromptConfig(ipBrandId, vibe);
    });

    // Save button
    const ipSaveClone = document.getElementById('ip-save-btn');
    ipSaveClone.addEventListener('click', saveImagePromptConfig);

    // Reset button
    document.getElementById('ip-reset-btn').addEventListener('click', async () => {
        const presetType = ipPresetType || getActivePresetType('ip-preset-tabs');
        if (!confirm('Remove image prompt config for "' + presetType + '"? It will use system defaults.')) return;
        try {
            await brandManager.savePresetConfigSection(ipBrandId, presetType, 'image_prompt', null);
            toast.success('Image config reset for ' + presetType);
            await loadImagePromptConfig(ipBrandId, presetType);
        } catch (e) {
            toast.error('Failed to reset: ' + e.message);
        }
    });
});

// =========================================================
// TEST IMAGE GENERATION
// =========================================================
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('ip-generate-btn').addEventListener('click', generateTestImage);
});

async function generateTestImage() {
    const btn = document.getElementById('ip-generate-btn');
    const statusEl = document.getElementById('ip-generate-status');
    const container = document.getElementById('ip-test-image-container');
    const imgEl = document.getElementById('ip-test-image');
    const promptUsedEl = document.getElementById('ip-test-prompt-used');

    // Get OpenAI key
    const openaiKey = window.apiKeys?.get('openai');
    if (!openaiKey) {
        toast.error('OpenAI API key not configured. Add it in Settings first.');
        return;
    }

    // Build the prompt using current form settings
    const cfg = buildImagePromptConfigFromForm();
    const sceneTextarea = document.getElementById('ip-test-scene');
    const sceneText = sceneTextarea.value.trim() 
        || 'A group of friends sit around a campfire near their parked van, laughing and talking under a starry night sky';

    // Get visual cue metadata if available
    const cueType = sceneTextarea.dataset.cueType || 'character';
    const cueCamera = sceneTextarea.dataset.cueCamera || '';

    // Determine camera angle — use cue camera if available, else config default
    const cameraMap = {
        'wide': 'wide establishing shot showing the full scene',
        'medium': 'medium shot at eye level',
        'close-up': 'close-up shot focusing on the main subject',
        'extreme-close-up': 'extreme close-up on fine details, textures, and surfaces',
        'overhead': 'overhead bird\'s-eye view looking down',
        'low-angle': 'low angle looking up, dramatic perspective',
    };
    const camera = cueCamera && cameraMap[cueCamera] 
        ? cameraMap[cueCamera] 
        : (cfg.camera_angles || [])[0] || '';

    // Determine mood based on scene type
    const moodMap = {
        'establishing': 'atmospheric establishing shot, cinematic and expansive',
        'object': 'eerie stillness, focus on the uncanny detail of this object',
        'atmosphere': 'thick dread, something is deeply wrong with this place',
        'character': cfg.mood || 'uneasy tension',
        'group': cfg.mood || 'uneasy group gathering, everyone looks normal but something feels wrong',
    };
    const mood = moodMap[cueType] || cfg.mood || 'uneasy tension';

    // Determine environment based on scene type
    const envNote = cueType === 'establishing' || cueType === 'atmosphere' || cueType === 'object'
        ? 'Match the environment described in the scene — do NOT default to generic group settings'
        : cfg.environment;

    const tensionLevel = Math.min(10, cfg.tension_escalation ? 3 : 5);
    const parts = [
        sceneText,
        '',
        `Style: ${cfg.style_prompt}`,
        `Environment: ${envNote}`,
        `Mood: ${mood}, tension level ${tensionLevel}/10`,
        camera ? `Camera: ${camera}` : '',
        `Lighting: ${cfg.lighting}`,
        `Color: ${cfg.color_palette}`,
        '',
        cfg.negative_prompt,
        cfg.suffix,
    ].filter(Boolean);
    const fullPrompt = parts.join('\n');

    // Build debug display showing what came from where
    const debugParts = [
        `📤 PROMPT SENT TO gpt-image-1:`,
        `────────────────────────────`,
        `🎬 VISUAL CUE (scene type: ${cueType}, camera: ${cueCamera || 'config default'}):`,
        sceneText,
        ``,
        `🎨 FROM IMAGE CONFIG:`,
        `  Style: ${cfg.style_prompt?.substring(0, 80)}...`,
        `  Environment: ${envNote?.substring(0, 80)}...`,
        `  Mood: ${mood}`,
        `  Camera: ${camera}`,
        `  Lighting: ${cfg.lighting?.substring(0, 80)}...`,
        `  Color: ${cfg.color_palette?.substring(0, 80)}...`,
        ``,
        `🚫 NEGATIVE: ${cfg.negative_prompt?.substring(0, 100)}...`,
    ];

    // Show what we're sending
    container.style.display = 'block';
    imgEl.src = '';
    imgEl.style.display = 'none';
    promptUsedEl.textContent = debugParts.join('\n');

    btn.disabled = true;
    statusEl.textContent = '⏳ Generating image...';
    statusEl.style.color = 'var(--text-secondary)';

    try {
        const response = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-image-1',
                prompt: fullPrompt,
                n: 1,
                size: '1024x1536',
                quality: 'low'
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: { message: response.statusText } }));
            throw new Error(err.error?.message || `API error: ${response.status}`);
        }

        const data = await response.json();
        const imageData = data.data?.[0];
        
        if (!imageData) throw new Error('No image returned from API');

        // gpt-image-1 returns base64
        if (imageData.b64_json) {
            imgEl.src = `data:image/png;base64,${imageData.b64_json}`;
        } else if (imageData.url) {
            imgEl.src = imageData.url;
        } else {
            throw new Error('Unexpected response format');
        }

        imgEl.style.display = 'block';
        statusEl.textContent = '✅ Generated (~$0.02)';
        statusEl.style.color = '#10B981';
    } catch (e) {
        statusEl.textContent = '❌ ' + e.message;
        statusEl.style.color = '#EF4444';
        console.error('[TestImage]', e);
    } finally {
        btn.disabled = false;
    }
}

// =========================================================
// TEST STORY GENERATION — DNA-DRIVEN (matches production)
// =========================================================

// ---- All 13 DNA dimensions (mirrored from run-job/story_dna.ts) ----


// saveImagePromptConfig — displaced from original position
async function saveImagePromptConfig() {
    const cfg = buildImagePromptConfigFromForm();
    const btn = document.getElementById('ip-save-btn');
    const presetType = ipPresetType || getActivePresetType('ip-preset-tabs');
    try {
        if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
        await brandManager.savePresetConfigSection(ipBrandId, presetType, 'image_prompt', cfg);
        toast.success('Image config saved for ' + presetType);
        closeImagePromptModal();
    } catch (e) {
        toast.error('Failed to save: ' + e.message);
        console.error(e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Image Config'; }
    }
}

// =====================================================
// VOICE CONFIG MODAL (per-preset)
// =====================================================

