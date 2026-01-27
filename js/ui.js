// =====================================================
// UI UTILITIES
// =====================================================

// DOM Element references (cached for performance)
const DOM = {
    get generatorForm() { return document.getElementById('generator-form'); },
    get progressSection() { return document.getElementById('progress-section'); },
    get previewSection() { return document.getElementById('preview-section'); },
    get resultSection() { return document.getElementById('result-section'); },
    get errorSection() { return document.getElementById('error-section'); },
    get statusText() { return document.getElementById('status-text'); },
    get progressPercent() { return document.getElementById('progress-percent'); },
    get progressBar() { return document.getElementById('progress-bar'); },
    get videoTitle() { return document.getElementById('video-title'); },
    get videoDuration() { return document.getElementById('video-duration'); },
    get videoPlayer() { return document.getElementById('video-player'); },
    get downloadBtn() { return document.getElementById('download-btn'); },
    get errorMessage() { return document.getElementById('error-message'); },
    get lengthPreset() { return document.getElementById('length-preset'); },
    get vibePreset() { return document.getElementById('vibe-preset'); },
    get visualPreset() { return document.getElementById('visual-preset'); },
    get voiceSpeed() { return document.getElementById('voice-speed'); },
    get previewContent() { return document.getElementById('preview-content'); },
};

// Step IDs for progress tracking
const STEPS = ['step-story', 'step-captions', 'step-audio', 'step-visuals', 'step-render'];

// Progress thresholds for each step
const STEP_THRESHOLDS = {
    'step-story': 25,
    'step-captions': 40,
    'step-audio': 55,
    'step-visuals': 70,
    'step-render': 95,
};

/**
 * Toggle advanced options visibility
 */
function toggleAdvancedOptions() {
    const options = document.getElementById('advanced-options');
    const icon = document.getElementById('advanced-toggle-icon');
    
    if (options.classList.contains('hidden')) {
        options.classList.remove('hidden');
        icon.textContent = '▼';
    } else {
        options.classList.add('hidden');
        icon.textContent = '▶';
    }
}

/**
 * Get all form values including advanced options
 */
function getFormValues() {
    return {
        lengthPreset: DOM.lengthPreset.value,
        vibePreset: DOM.vibePreset.value,
        visualPreset: DOM.visualPreset.value,
        visualSource: document.getElementById('visual-source')?.value || 'pexels',
        voiceSpeed: DOM.voiceSpeed?.value || '1.0',
        // Video effects
        effectFilter: document.getElementById('effect-filter')?.checked ?? true,
        effectKenburns: document.getElementById('effect-kenburns')?.checked ?? true,
        effectTransitions: document.getElementById('effect-transitions')?.checked ?? true,
        effectVignette: document.getElementById('effect-vignette')?.checked ?? true,
        // Audio
        audioMusic: document.getElementById('audio-music')?.checked ?? true,
        audioSfx: document.getElementById('audio-sfx')?.checked ?? false,
        // Captions
        captionStyle: document.querySelector('input[name="caption-style"]:checked')?.value || 'bold',
        highlightScary: document.getElementById('highlight-scary')?.checked ?? true,
    };
}

/**
 * Show the preview/storyboard section
 */
function showPreview(data) {
    DOM.generatorForm.classList.add('opacity-50', 'pointer-events-none');
    DOM.previewSection.classList.remove('hidden');
    DOM.progressSection.classList.add('hidden');
    DOM.resultSection.classList.add('hidden');
    DOM.errorSection.classList.add('hidden');
    
    renderPreview(data);
}

/**
 * Render the storyboard preview
 */
function renderPreview(data) {
    const container = DOM.previewContent;
    if (!container) return;
    
    const scenes = data.scenes || [];
    const formValues = getFormValues();
    
    let html = `
        <!-- Story Title -->
        <div class="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
            <h3 class="text-2xl font-bold text-primary mb-2">${escapeHtml(data.title || 'Untitled')}</h3>
            <p class="text-gray-400 text-sm">
                ${data.word_count || '?'} words • ~${data.duration_sec || '?'} seconds • ${scenes.length} scenes
            </p>
        </div>
        
        <!-- Full Story -->
        <div class="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
            <h4 class="text-lg font-semibold mb-3">📖 Full Story</h4>
            <p class="text-gray-200 leading-relaxed">${escapeHtml(data.story_text || '')}</p>
        </div>
        
        <!-- Scene Breakdown -->
        <div>
            <h4 class="text-lg font-semibold mb-3">🎬 Scene Breakdown</h4>
            <div class="space-y-3">
    `;
    
    scenes.forEach((scene, i) => {
        html += `
            <div class="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                <div class="flex items-center gap-3 mb-2">
                    <span class="bg-primary/20 text-primary px-2 py-1 rounded text-sm font-semibold">
                        Scene ${i + 1}
                    </span>
                    <span class="text-gray-500 text-sm">
                        ${formatTime(scene.startTime)} - ${formatTime(scene.endTime)}
                    </span>
                </div>
                <p class="text-gray-200 text-sm mb-2">${escapeHtml(scene.text || '')}</p>
                <div class="flex flex-wrap gap-2">
                    ${(scene.keywords || []).map(kw => `
                        <span class="bg-gray-700 text-gray-400 px-2 py-1 rounded text-xs">🔍 ${escapeHtml(kw)}</span>
                    `).join('')}
                </div>
            </div>
        `;
    });
    
    html += `
            </div>
        </div>
        
        <!-- Active Effects Preview -->
        <div class="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
            <h4 class="text-lg font-semibold mb-3">✨ Active Effects</h4>
            <div class="flex flex-wrap gap-2">
                ${formValues.visualSource === 'dalle' 
                    ? '<span class="bg-yellow-900/50 text-yellow-300 px-3 py-1 rounded-full text-sm">🎨 DALL-E Images</span>' 
                    : '<span class="bg-cyan-900/50 text-cyan-300 px-3 py-1 rounded-full text-sm">📹 Pexels Videos</span>'}
                ${formValues.effectFilter ? '<span class="bg-purple-900/50 text-purple-300 px-3 py-1 rounded-full text-sm">🎨 Horror Filter</span>' : ''}
                ${formValues.effectKenburns ? '<span class="bg-blue-900/50 text-blue-300 px-3 py-1 rounded-full text-sm">📷 Ken Burns</span>' : ''}
                ${formValues.effectTransitions ? '<span class="bg-green-900/50 text-green-300 px-3 py-1 rounded-full text-sm">🔀 Transitions</span>' : ''}
                ${formValues.effectVignette ? '<span class="bg-gray-700 text-gray-300 px-3 py-1 rounded-full text-sm">⚫ Vignette</span>' : ''}
                ${formValues.audioMusic ? '<span class="bg-red-900/50 text-red-300 px-3 py-1 rounded-full text-sm">🎵 Music</span>' : ''}
                ${formValues.audioSfx ? '<span class="bg-orange-900/50 text-orange-300 px-3 py-1 rounded-full text-sm">💥 SFX</span>' : ''}
                ${formValues.highlightScary ? '<span class="bg-red-900/50 text-red-300 px-3 py-1 rounded-full text-sm">🔴 Scary Highlights</span>' : ''}
                <span class="bg-gray-700 text-gray-300 px-3 py-1 rounded-full text-sm">💬 ${formValues.captionStyle} captions</span>
            </div>
        </div>
    `;
    
    container.innerHTML = html;
}

/**
 * Update the progress bar and status text
 */
function updateStatus(text, progress) {
    DOM.statusText.textContent = text;
    DOM.progressPercent.textContent = `${progress}%`;
    DOM.progressBar.style.width = `${progress}%`;

    // Update step indicators based on progress
    for (const [stepId, threshold] of Object.entries(STEP_THRESHOLDS)) {
        if (progress >= threshold) {
            markStepComplete(stepId);
        }
    }
}

/**
 * Mark a step as complete with checkmark
 */
function markStepComplete(stepId) {
    const step = document.getElementById(stepId);
    if (step) {
        step.classList.remove('text-gray-500');
        step.classList.add('text-green-400');
        const icon = step.querySelector('.step-icon');
        if (icon) icon.textContent = '✓';
    }
}

/**
 * Reset a step to incomplete state
 */
function resetStep(stepId) {
    const step = document.getElementById(stepId);
    if (step) {
        step.classList.remove('text-green-400');
        step.classList.add('text-gray-500');
        const icon = step.querySelector('.step-icon');
        if (icon) icon.textContent = '○';
    }
}

/**
 * Show the progress section and disable the form
 */
function showProgress() {
    DOM.generatorForm.classList.add('opacity-50', 'pointer-events-none');
    DOM.progressSection.classList.remove('hidden');
    DOM.resultSection.classList.add('hidden');
    DOM.errorSection.classList.add('hidden');
}

/**
 * Show the result section with video
 */
function showResult(data) {
    DOM.progressSection.classList.add('hidden');
    DOM.resultSection.classList.remove('hidden');
    DOM.generatorForm.classList.remove('opacity-50', 'pointer-events-none');

    DOM.videoTitle.textContent = data.title || 'Untitled Story';
    DOM.videoDuration.textContent = `Duration: ${data.duration_sec} seconds`;
    DOM.videoPlayer.src = data.video_url;
    DOM.downloadBtn.href = data.video_url;

    // Render the timeline if we have scene data
    console.log('Result data:', data);
    console.log('Scenes:', data.scenes);
    console.log('Story text:', data.story_text);
    
    if (data.scenes && data.scenes.length > 0) {
        renderTimeline(data.story_text || '', data.scenes);
    } else if (data.story_text) {
        // No scenes but we have story - show story text only
        renderTimelineFallback(data.story_text);
    }
}

/**
 * Fallback timeline when no scene data available
 */
function renderTimelineFallback(storyText) {
    const container = document.getElementById('timeline-scenes');
    if (!container) return;
    
    container.innerHTML = `
        <div class="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
            <h4 class="text-lg font-semibold text-primary mb-3">📖 Full Story</h4>
            <p class="text-gray-200 leading-relaxed">${escapeHtml(storyText)}</p>
        </div>
    `;
}

/**
 * Render the story timeline with scenes
 */
function renderTimeline(storyText, scenes) {
    const container = document.getElementById('timeline-scenes');
    if (!container) return;

    // Sort scenes by index
    const sortedScenes = [...scenes].sort((a, b) => a.index - b.index);

    // If scenes have text, use that; otherwise split story into scenes
    let sceneTexts = sortedScenes.map(s => s.text).filter(t => t);
    
    if (sceneTexts.length === 0 && storyText) {
        // Fallback: Split story into sentences and group
        const sentences = storyText.match(/[^.!?]+[.!?]+/g) || [storyText];
        let currentScene = "";
        let sentenceCount = 0;
        
        for (const sentence of sentences) {
            currentScene += sentence;
            sentenceCount++;
            
            if (sentenceCount >= 2 || sentence === sentences[sentences.length - 1]) {
                sceneTexts.push(currentScene.trim());
                currentScene = "";
                sentenceCount = 0;
            }
        }
    }

    // Build timeline HTML
    let html = '';
    for (let i = 0; i < Math.max(sceneTexts.length, sortedScenes.length); i++) {
        const sceneText = sceneTexts[i] || '';
        const sceneData = sortedScenes[i] || {};
        const startTime = sceneData.startTime ? formatTime(sceneData.startTime) : '0:00';
        const endTime = sceneData.endTime ? formatTime(sceneData.endTime) : '--:--';
        const keywords = sceneData.keywords || [];

        html += `
            <div class="scene-item bg-gray-800/50 rounded-xl overflow-hidden border border-gray-700 hover:border-gray-600 transition-colors">
                <div class="flex flex-col md:flex-row">
                    <!-- Video thumbnail -->
                    <div class="md:w-48 flex-shrink-0">
                        ${sceneData.videoUrl ? `
                            <video 
                                src="${sceneData.videoUrl}" 
                                class="w-full h-32 md:h-full object-cover"
                                muted
                                loop
                                onmouseenter="this.play()"
                                onmouseleave="this.pause(); this.currentTime=0;"
                            ></video>
                        ` : `
                            <div class="w-full h-32 md:h-full bg-gray-700 flex items-center justify-center text-gray-500">
                                No video
                            </div>
                        `}
                    </div>
                    
                    <!-- Scene content -->
                    <div class="flex-1 p-4">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="bg-primary/20 text-primary px-2 py-1 rounded text-sm font-semibold">
                                Scene ${i + 1}
                            </span>
                            <span class="text-gray-500 text-sm">
                                ${startTime} - ${endTime}
                            </span>
                        </div>
                        <p class="text-gray-200 text-sm leading-relaxed mb-3">${escapeHtml(sceneText)}</p>
                        ${keywords.length > 0 ? `
                            <div class="flex flex-wrap gap-2">
                                ${keywords.map(kw => `
                                    <span class="bg-gray-700 text-gray-400 px-2 py-1 rounded text-xs">
                                        🎬 ${escapeHtml(kw)}
                                    </span>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}

/**
 * Format seconds to MM:SS
 */
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Toggle timeline visibility
 */
function toggleTimeline() {
    const content = document.getElementById('timeline-content');
    const icon = document.getElementById('timeline-toggle-icon');
    
    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        icon.textContent = '▼';
    } else {
        content.classList.add('hidden');
        icon.textContent = '▶';
    }
}

/**
 * Show the error section with message
 */
function showError(message) {
    DOM.progressSection.classList.add('hidden');
    DOM.previewSection?.classList.add('hidden');
    DOM.errorSection.classList.remove('hidden');
    DOM.generatorForm.classList.remove('opacity-50', 'pointer-events-none');
    DOM.errorMessage.textContent = message;
}

/**
 * Reset the UI to initial state
 */
function resetUI() {
    DOM.generatorForm.classList.remove('opacity-50', 'pointer-events-none');
    DOM.progressSection.classList.add('hidden');
    DOM.previewSection?.classList.add('hidden');
    DOM.resultSection.classList.add('hidden');
    DOM.errorSection.classList.add('hidden');
    
    // Reset progress
    updateStatus('Initializing...', 0);
    
    // Reset all step indicators
    STEPS.forEach(resetStep);
    
    // Reset timeline toggle
    const timelineContent = document.getElementById('timeline-content');
    const timelineIcon = document.getElementById('timeline-toggle-icon');
    if (timelineContent) timelineContent.classList.add('hidden');
    if (timelineIcon) timelineIcon.textContent = '▶';
}

// =====================================================
// TAB NAVIGATION
// =====================================================

let currentTab = 'generate';

/**
 * Switch between tabs (Generate / History)
 */
function showTab(tabName) {
    currentTab = tabName;
    
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-primary', 'text-white');
        btn.classList.add('bg-gray-800', 'text-gray-400', 'hover:bg-gray-700');
    });
    
    const activeBtn = document.getElementById(`tab-${tabName}`);
    if (activeBtn) {
        activeBtn.classList.add('active', 'bg-primary', 'text-white');
        activeBtn.classList.remove('bg-gray-800', 'text-gray-400', 'hover:bg-gray-700');
    }
    
    // Update tab content
    document.querySelectorAll('[id^="tab-content-"]').forEach(content => {
        content.classList.add('hidden');
    });
    
    const activeContent = document.getElementById(`tab-content-${tabName}`);
    if (activeContent) {
        activeContent.classList.remove('hidden');
    }
    
    // Load history when switching to history tab
    if (tabName === 'history') {
        loadHistory();
    }
}

// =====================================================
// HISTORY TAB
// =====================================================

let historyPage = 1;
const HISTORY_PAGE_SIZE = 9;

/**
 * Load video history from Supabase
 */
async function loadHistory(direction) {
    const grid = document.getElementById('history-grid');
    const empty = document.getElementById('history-empty');
    const pagination = document.getElementById('history-pagination');
    
    if (!grid) return;
    
    // Handle pagination
    if (direction === 'next') historyPage++;
    if (direction === 'prev' && historyPage > 1) historyPage--;
    
    // Get filter/sort options
    const sort = document.getElementById('history-sort')?.value || 'newest';
    const filter = document.getElementById('history-filter')?.value || 'completed';
    
    // Show loading state
    grid.innerHTML = `
        <div class="col-span-full text-center py-12 text-gray-400">
            <div class="animate-spin text-4xl mb-4">⏳</div>
            <p>Loading history...</p>
        </div>
    `;
    empty.classList.add('hidden');
    pagination.classList.add('hidden');
    
    try {
        // Get supabase client
        const client = getSupabaseClient();
        
        // Build query
        let query = client
            .from('jobs')
            .select('*', { count: 'exact' });
        
        // Apply filter
        if (filter === 'completed') {
            query = query.eq('status', 'complete');
        } else if (filter === 'failed') {
            query = query.eq('status', 'error');
        }
        
        // Apply sort
        query = query.order('created_at', { ascending: sort === 'oldest' });
        
        // Apply pagination
        const from = (historyPage - 1) * HISTORY_PAGE_SIZE;
        query = query.range(from, from + HISTORY_PAGE_SIZE - 1);
        
        const { data: jobs, count, error } = await query;
        
        if (error) throw error;
        
        if (!jobs || jobs.length === 0) {
            grid.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        
        // Render history items
        renderHistoryGrid(jobs);
        
        // Update pagination
        const totalPages = Math.ceil(count / HISTORY_PAGE_SIZE);
        if (totalPages > 1) {
            pagination.classList.remove('hidden');
            document.getElementById('history-page-info').textContent = `Page ${historyPage} of ${totalPages}`;
            document.getElementById('history-prev').disabled = historyPage <= 1;
            document.getElementById('history-next').disabled = historyPage >= totalPages;
        }
        
    } catch (err) {
        console.error('Failed to load history:', err);
        grid.innerHTML = `
            <div class="col-span-full text-center py-12 text-red-400">
                <div class="text-4xl mb-4">❌</div>
                <p>Failed to load history</p>
                <p class="text-sm text-gray-500 mt-2">${escapeHtml(err.message || 'Unknown error')}</p>
            </div>
        `;
    }
}

/**
 * Render the history grid with video cards
 */
function renderHistoryGrid(jobs) {
    const grid = document.getElementById('history-grid');
    if (!grid) return;
    
    grid.innerHTML = jobs.map(job => {
        const meta = job.meta || {};
        const title = meta.title || 'Untitled Video';
        const duration = meta.duration_sec ? `${meta.duration_sec}s` : '?';
        const date = new Date(job.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        const statusBadge = job.status === 'complete' 
            ? '<span class="bg-green-900/50 text-green-400 px-2 py-0.5 rounded text-xs">✓ Complete</span>'
            : job.status === 'error'
            ? '<span class="bg-red-900/50 text-red-400 px-2 py-0.5 rounded text-xs">✗ Failed</span>'
            : '<span class="bg-yellow-900/50 text-yellow-400 px-2 py-0.5 rounded text-xs">⏳ Processing</span>';
        
        const videoUrl = job.output_url || '';
        const hasVideo = job.status === 'complete' && videoUrl;
        
        return `
            <div class="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden hover:border-gray-600 transition-colors">
                <!-- Thumbnail / Preview -->
                <div class="aspect-[9/16] bg-gray-900 relative max-h-48 overflow-hidden">
                    ${hasVideo ? `
                        <video 
                            src="${escapeHtml(videoUrl)}" 
                            class="w-full h-full object-cover" 
                            muted 
                            loop
                            onmouseenter="this.play()" 
                            onmouseleave="this.pause(); this.currentTime=0;"
                        ></video>
                        <div class="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/10 transition-colors pointer-events-none">
                            <span class="text-4xl opacity-80">▶</span>
                        </div>
                    ` : `
                        <div class="w-full h-full flex items-center justify-center text-gray-600">
                            <span class="text-6xl">🎬</span>
                        </div>
                    `}
                    <div class="absolute top-2 right-2">${statusBadge}</div>
                </div>
                
                <!-- Info -->
                <div class="p-3">
                    <h4 class="font-semibold text-sm truncate mb-1" title="${escapeHtml(title)}">${escapeHtml(title)}</h4>
                    <p class="text-xs text-gray-500">${date} • ${duration}</p>
                    
                    ${hasVideo ? `
                        <div class="flex gap-2 mt-3">
                            <button onclick="playHistoryVideo('${escapeHtml(videoUrl)}', '${escapeHtml(title)}')" class="flex-1 bg-primary/20 hover:bg-primary/30 text-primary text-xs py-1.5 rounded transition-colors">
                                ▶ Play
                            </button>
                            <a href="${escapeHtml(videoUrl)}" download class="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs py-1.5 rounded text-center transition-colors">
                                ⬇ Download
                            </a>
                        </div>
                    ` : job.status === 'error' ? `
                        <p class="text-xs text-red-400 mt-2 truncate" title="${escapeHtml(job.error || '')}">${escapeHtml(job.error || 'Unknown error')}</p>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Play a video from history in a modal
 */
function playHistoryVideo(url, title) {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.id = 'video-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4';
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
    
    modal.innerHTML = `
        <div class="relative max-w-md w-full">
            <button onclick="document.getElementById('video-modal').remove()" class="absolute -top-10 right-0 text-white text-2xl hover:text-primary">&times;</button>
            <h3 class="text-lg font-bold mb-3 truncate">${escapeHtml(title)}</h3>
            <video src="${escapeHtml(url)}" controls autoplay class="w-full rounded-xl aspect-[9/16] max-h-[70vh] bg-black"></video>
            <div class="flex gap-3 mt-4">
                <a href="${escapeHtml(url)}" download class="flex-1 bg-gradient-to-r from-primary to-secondary text-white font-bold py-3 rounded-xl text-center">
                    ⬇️ Download
                </a>
                <button onclick="document.getElementById('video-modal').remove()" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl">
                    Close
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// =====================================================
// VISUAL SOURCE SELECTOR
// =====================================================

/**
 * Update hint text when visual source changes
 */
function updateVisualSourceHint() {
    const source = document.getElementById('visual-source');
    const hint = document.getElementById('visual-source-hint');
    
    if (!source || !hint) return;
    
    if (source.value === 'dalle') {
        hint.textContent = 'AI generates unique images for each scene (~$0.08/image)';
        hint.classList.add('text-yellow-500');
        hint.classList.remove('text-gray-500');
    } else {
        hint.textContent = 'Free stock footage from Pexels';
        hint.classList.remove('text-yellow-500');
        hint.classList.add('text-gray-500');
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Set up visual source change listener
    const visualSource = document.getElementById('visual-source');
    if (visualSource) {
        visualSource.addEventListener('change', updateVisualSourceHint);
    }
    
    // Initialize tab state
    showTab('generate');
});
