// =====================================================
// SCARY STORY GENERATOR - UI UTILITIES
// =====================================================

// =====================================================
// HELPER FUNCTIONS
// =====================================================

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Copy text to clipboard with visual feedback
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard!', 'success');
        return true;
    } catch (err) {
        console.error('Failed to copy:', err);
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            showToast('Copied to clipboard!', 'success');
            return true;
        } catch (e) {
            showToast('Failed to copy', 'error');
            return false;
        } finally {
            document.body.removeChild(textarea);
        }
    }
}

// Copy scene debug info for a specific scene
function copySceneDebugInfo(sceneIndex) {
    const dataEl = document.querySelector(`.scene-debug-data[data-scene="${sceneIndex}"]`);
    if (!dataEl) {
        showToast('Scene data not found', 'error');
        return;
    }
    
    try {
        const debugData = JSON.parse(dataEl.textContent);
        
        // Format as readable text
        const textOutput = `
═══════════════════════════════════════
SCENE ${debugData.scene_number} DEBUG INFO
═══════════════════════════════════════

📍 TIMING
   Timestamp: ${debugData.timestamp}
   Duration: ${debugData.duration_sec}s

📝 NARRATION (${debugData.word_count} words)
   "${debugData.narration}"

🏷️ KEYWORDS
   ${debugData.keywords.length > 0 ? debugData.keywords.join(', ') : 'None'}

🎨 IMAGE GENERATION
   Model: ${debugData.model || 'Unknown'}
   Art Style: ${debugData.art_style || 'Unknown'}
   Camera: ${debugData.camera_angle || 'Unknown'}
   Mood Level: ${debugData.mood_level || 'Unknown'}

🎬 VISUAL BEAT
   ${debugData.visual_beat || 'None'}

👤 CHARACTER
   ${debugData.character_description || 'None'}

📜 CONTINUITY RULES
   ${debugData.continuity_rules || 'None'}

🖼️ IMAGE URL
   ${debugData.image_url || 'None'}

═══════════════════════════════════════
FULL PROMPT
═══════════════════════════════════════
${debugData.prompt || 'No prompt available'}

═══════════════════════════════════════
Generated: ${debugData.generated_at ? new Date(debugData.generated_at).toLocaleString() : 'Unknown'}
═══════════════════════════════════════
`.trim();
        
        copyToClipboard(textOutput);
    } catch (err) {
        console.error('Failed to parse scene data:', err);
        showToast('Failed to copy scene data', 'error');
    }
}

// Copy all scenes debug info (comprehensive format matching individual scene copy)
function copyAllScenesDebugInfo() {
    const dataEls = document.querySelectorAll('.scene-debug-data');
    if (dataEls.length === 0) {
        showToast('No scene data found', 'error');
        return;
    }
    
    let allOutput = '═══════════════════════════════════════\nALL SCENES DEBUG INFO\n═══════════════════════════════════════\n\n';
    
    dataEls.forEach((dataEl, i) => {
        try {
            const d = JSON.parse(dataEl.textContent);
            allOutput += `═══════════════════════════════════════
SCENE ${d.scene_number} DEBUG INFO
═══════════════════════════════════════

📍 TIMING
   Timestamp: ${d.timestamp}
   Duration: ${d.duration_sec}s

📝 NARRATION (${d.word_count} words)
   "${d.narration}"

🏷️ KEYWORDS
   ${d.keywords?.join(', ') || 'None'}

🎨 IMAGE GENERATION
   Model: ${d.model || 'Unknown'}
   Art Style: ${d.art_style || 'Unknown'}
   Camera: ${d.camera_angle || 'Unknown'}
   Mood Level: ${d.mood_level || 'Unknown'}

🎬 VISUAL BEAT
   ${d.visual_beat || 'None'}

👤 CHARACTER
   ${d.character_description || 'null'}

📜 CONTINUITY RULES
   ${d.continuity_rules || 'None'}

🖼️ IMAGE URL
   ${d.image_url || 'None'}

═══════════════════════════════════════
FULL PROMPT
═══════════════════════════════════════
${d.prompt || 'None'}

═══════════════════════════════════════
Generated: ${d.generated_at || 'Unknown'}
═══════════════════════════════════════

`;
        } catch (err) {
            allOutput += `--- SCENE ${i + 1} --- Error parsing data\n\n`;
        }
    });
    
    copyToClipboard(allOutput.trim());
}

// Simple toast notification
function showToast(message, type = 'info') {
    // Remove existing toasts
    const existing = document.querySelector('.copy-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `copy-toast fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg z-50 text-sm font-medium transition-all transform translate-y-0 opacity-100 ${
        type === 'success' ? 'bg-green-600 text-white' :
        type === 'error' ? 'bg-red-600 text-white' :
        'bg-gray-700 text-white'
    }`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Auto-remove after 2 seconds
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// Copy all debug info for a history job
function copyHistoryJobDebugInfo(jobId) {
    const dataEl = document.getElementById('history-scenes-data');
    if (!dataEl) {
        showToast('Scene data not found', 'error');
        return;
    }
    
    try {
        const scenes = JSON.parse(dataEl.textContent);
        
        let output = `═══════════════════════════════════════
ALL SCENES DEBUG INFO (Job: ${jobId})
═══════════════════════════════════════

`;
        
        scenes.forEach((scene) => {
            output += `═══════════════════════════════════════
SCENE ${scene.scene_number} DEBUG INFO
═══════════════════════════════════════

📍 TIMING
   Timestamp: ${scene.timestamp}
   Duration: ${scene.duration_sec}s

📝 NARRATION (${scene.word_count} words)
   "${scene.scene_text}"

🏷️ KEYWORDS
   ${scene.keywords?.length > 0 ? scene.keywords.join(', ') : 'None'}

🎨 IMAGE GENERATION
   Model: ${scene.model || 'Unknown'}
   Art Style: ${scene.art_style || 'Unknown'}
   Camera: ${scene.camera_angle || 'Unknown'}
   Mood Level: ${scene.mood_level || 'Unknown'}

🎬 VISUAL BEAT
   ${scene.visual_beat || 'None'}

👤 CHARACTER
   ${scene.character_description || 'null'}

📜 CONTINUITY RULES
   ${scene.continuity_rules || 'None'}

🖼️ IMAGE URL
   ${scene.image_url || 'None'}

═══════════════════════════════════════
FULL PROMPT
═══════════════════════════════════════
${scene.prompt || 'No prompt available'}

═══════════════════════════════════════
Generated: ${scene.generated_at ? new Date(scene.generated_at).toLocaleString() : 'Unknown'}
═══════════════════════════════════════

`;
        });
        
        copyToClipboard(output.trim());
    } catch (err) {
        console.error('Failed to copy history debug info:', err);
        showToast('Failed to copy debug info', 'error');
    }
}

// Build HTML for history scenes with debug info
function buildHistoryScenesHtml(sceneAssets, jobId) {
    // Check if images are stored in Supabase Storage (permanent) vs temporary OpenAI URLs
    const hasValidImages = sceneAssets.some(a => 
        a.storage_path?.includes('supabase.co') || 
        a.public_url?.includes('supabase.co')
    );
    const hasExpiredImages = sceneAssets.some(a => 
        a.storage_path?.includes('oaidalleapiprodscus.blob.core.windows.net') ||
        a.storage_path?.includes('replicate.delivery')
    );
    
    // Build individual scene HTML
    let scenesHtml = '';
    sceneAssets.forEach((asset, i) => {
        const isImage = asset.type === 'dalle_image';
        const sceneText = asset.meta?.scene_text || '';
        const prompt = asset.meta?.dalle_prompt || '';
        const artStyle = asset.meta?.art_style || 'Unknown';
        const imageModel = asset.meta?.image_model || 'Unknown';
        const startTime = asset.meta?.start_time;
        const endTime = asset.meta?.end_time;
        const moodLevel = asset.meta?.mood_level;
        const imageUrl = asset.public_url || asset.storage_path;
        const isExpired = imageUrl?.includes('oaidalleapiprodscus.blob.core.windows.net') || imageUrl?.includes('replicate.delivery');
        const wordCount = sceneText ? sceneText.split(/\s+/).filter(w => w).length : 0;
        
        const timeStr = startTime !== undefined ? formatTime(startTime) + ' - ' + formatTime(endTime || 0) : '';
        
        let mediaHtml = '';
        if (isImage) {
            const onclickAttr = isExpired ? '' : 'onclick="showImageModal(\'' + escapeHtml(imageUrl) + '\')"';
            const cursorClass = isExpired ? '' : 'cursor-pointer';
            mediaHtml = '<img src="' + escapeHtml(imageUrl) + '" class="w-full h-full object-cover ' + cursorClass + '" ' + onclickAttr + ' loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=\\\'w-full h-full flex items-center justify-center text-gray-500 text-xs\\\'>Expired</div>\'">';
        } else {
            mediaHtml = '<video src="' + escapeHtml(imageUrl) + '" class="w-full h-full object-cover" muted></video>';
        }
        
        let metaHtml = '<div class="flex gap-2 text-xs">';
        if (artStyle !== 'Unknown') {
            metaHtml += '<span class="text-blue-400">Style: ' + escapeHtml(artStyle) + '</span>';
        }
        if (moodLevel) {
            metaHtml += '<span class="text-yellow-400">Mood: ' + moodLevel + '/10</span>';
        }
        metaHtml += '</div>';
        
        let promptHtml = '';
        if (prompt) {
            promptHtml = '<details class="text-xs mt-2"><summary class="text-purple-400 cursor-pointer hover:text-purple-300">📝 View Prompt</summary><div class="mt-1 bg-gray-800 p-2 rounded max-h-24 overflow-y-auto"><p class="text-green-300/80 whitespace-pre-wrap font-mono text-xs">' + escapeHtml(prompt) + '</p></div></details>';
        }
        
        scenesHtml += '<div class="bg-gray-700/50 rounded-lg p-3 border border-gray-600' + (isExpired ? ' opacity-60' : '') + '">' +
            '<div class="flex gap-3">' +
                '<div class="w-16 h-24 flex-shrink-0 bg-gray-800 rounded overflow-hidden">' + mediaHtml + '</div>' +
                '<div class="flex-1 min-w-0">' +
                    '<div class="flex items-center gap-2 mb-1 flex-wrap">' +
                        '<span class="bg-primary/20 text-primary px-2 py-0.5 rounded text-xs font-bold">Scene ' + (i + 1) + '</span>' +
                        (timeStr ? '<span class="text-xs text-gray-500">' + timeStr + '</span>' : '') +
                        '<span class="text-xs text-purple-400">' + escapeHtml(imageModel) + '</span>' +
                        '<span class="text-xs text-gray-500">' + wordCount + ' words</span>' +
                    '</div>' +
                    '<p class="text-xs text-gray-300 mb-1 line-clamp-2">' + escapeHtml(sceneText) + '</p>' +
                    metaHtml +
                    promptHtml +
                '</div>' +
            '</div>' +
        '</div>';
    });
    
    // Build JSON data for copy function
    const scenesData = sceneAssets.map((asset, i) => ({
        scene_number: i + 1,
        scene_text: asset.meta?.scene_text || '',
        timestamp: asset.meta?.start_time !== undefined ? asset.meta.start_time.toFixed(2) + 's - ' + (asset.meta?.end_time || 0).toFixed(2) + 's' : 'Unknown',
        duration_sec: asset.meta?.start_time !== undefined && asset.meta?.end_time !== undefined ? (asset.meta.end_time - asset.meta.start_time).toFixed(2) : 'Unknown',
        word_count: asset.meta?.scene_text ? asset.meta.scene_text.split(/\s+/).filter(w => w).length : 0,
        keywords: asset.meta?.keywords || [],
        image_url: asset.public_url || asset.storage_path || '',
        prompt: asset.meta?.dalle_prompt || '',
        model: asset.meta?.image_model || 'Unknown',
        art_style: asset.meta?.art_style || 'Unknown',
        visual_beat: asset.meta?.visual_beat || '',
        mood_level: asset.meta?.mood_level || '',
        camera_angle: asset.meta?.camera_angle || '',
        character_description: asset.meta?.character_description || '',
        generated_at: asset.meta?.generated_at || ''
    }));
    
    const expiredWarning = hasExpiredImages && !hasValidImages ? '<span class="text-yellow-500 text-sm">(⚠️ Images expired)</span>' : '';
    
    return '<div class="mb-6">' +
        '<div class="flex items-center justify-between mb-2">' +
            '<h3 class="font-semibold">🎬 Scenes ' + expiredWarning + '</h3>' +
            '<button onclick="copyHistoryJobDebugInfo(\'' + jobId + '\')" class="text-xs bg-purple-700 hover:bg-purple-600 px-3 py-1 rounded text-white">📋 Copy All Debug Info</button>' +
        '</div>' +
        '<div class="space-y-3 max-h-80 overflow-y-auto">' + scenesHtml + '</div>' +
        '<script type="application/json" id="history-scenes-data">' + JSON.stringify(scenesData) + '</script>' +
    '</div>';
}

// =====================================================
// HISTORY TAB
// =====================================================

let historyPage = 1;
const HISTORY_PAGE_SIZE = 8;

async function loadHistory(direction) {
    const grid = document.getElementById('history-grid');
    const empty = document.getElementById('history-empty');
    const pagination = document.getElementById('history-pagination');
    
    if (!grid) return;
    
    // Handle pagination
    if (direction === 'next') historyPage++;
    if (direction === 'prev' && historyPage > 1) historyPage--;
    
    const sort = document.getElementById('history-sort')?.value || 'newest';
    const filter = document.getElementById('history-filter')?.value || 'completed';
    
    // Loading state
    grid.innerHTML = `
        <div class="col-span-full text-center py-12 text-gray-400">
            <div class="spin text-4xl mb-4">⏳</div>
            <p>Loading...</p>
        </div>
    `;
    empty.classList.add('hidden');
    pagination.classList.add('hidden');
    
    try {
        const client = getSupabaseClient();
        
        // Build query
        let query = client
            .from('jobs')
            .select('*, job_assets!left(public_url, type, meta)', { count: 'exact' });
        
        // Apply filter
        if (filter === 'completed') {
            query = query.eq('status', 'complete');
        } else if (filter === 'failed') {
            query = query.in('status', ['error', 'failed']);
        }
        
        // Apply sort
        query = query.order('created_at', { ascending: sort === 'oldest' });
        
        // Apply pagination
        const from = (historyPage - 1) * HISTORY_PAGE_SIZE;
        query = query.range(from, from + HISTORY_PAGE_SIZE - 1);
        
        let { data: jobs, count, error } = await query;
        
        if (error) throw error;
        
        if (!jobs || jobs.length === 0) {
            grid.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        
        // Process jobs to extract video URLs
        jobs = jobs.map(job => {
            const assets = job.job_assets || [];
            const videoAsset = assets.find(a => a.type === 'final_mp4');
            return {
                ...job,
                video_url: videoAsset?.public_url || null
            };
        });
        
        // Render
        renderHistoryGrid(jobs);
        
        // Pagination
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
            </div>
        `;
    }
}

function renderHistoryGrid(jobs) {
    const grid = document.getElementById('history-grid');
    if (!grid) return;
    
    grid.innerHTML = jobs.map(job => {
        const title = job.title || 'Untitled';
        const duration = job.duration_sec ? `${job.duration_sec}s` : '?';
        const date = new Date(job.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        
        const statusBadge = job.status === 'complete' 
            ? '<span class="absolute top-2 left-2 bg-green-900/80 text-green-400 px-2 py-0.5 rounded text-xs">✓ Complete</span>'
            : job.status === 'error' || job.status === 'failed'
            ? '<span class="absolute top-2 left-2 bg-red-900/80 text-red-400 px-2 py-0.5 rounded text-xs">✗ Failed</span>'
            : '<span class="absolute top-2 left-2 bg-yellow-900/80 text-yellow-400 px-2 py-0.5 rounded text-xs">⏳ Processing</span>';
        
        const videoUrl = job.video_url || '';
        const hasVideo = job.status === 'complete' && videoUrl;
        
        return `
            <div class="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden hover:border-gray-600 transition-colors group">
                <!-- Full-height video thumbnail -->
                <div class="relative aspect-[9/16] bg-gray-900 cursor-pointer" 
                     ${hasVideo ? `onclick="playHistoryVideo('${escapeHtml(videoUrl)}', '${escapeHtml(title.replace(/'/g, "\\'"))}')"` : ''}>
                    ${hasVideo ? `
                        <video 
                            src="${escapeHtml(videoUrl)}" 
                            class="video-thumbnail w-full h-full" 
                            muted loop preload="metadata"
                            onmouseenter="this.play().catch(()=>{})" 
                            onmouseleave="this.pause();">
                        </video>
                        <div class="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/20 transition-colors pointer-events-none">
                            <span class="text-4xl opacity-80 group-hover:opacity-100 transition-opacity">▶</span>
                        </div>
                    ` : `
                        <div class="w-full h-full flex items-center justify-center text-gray-600">
                            <span class="text-6xl">👻</span>
                        </div>
                    `}
                    ${statusBadge}
                </div>
                
                <!-- Info bar at bottom -->
                <div class="p-3 bg-gray-800/80">
                    <h4 class="font-semibold text-sm truncate" title="${escapeHtml(title)}">${escapeHtml(title)}</h4>
                    <p class="text-xs text-gray-500 mt-1">${date} • ${duration}</p>
                    
                    ${hasVideo ? `
                        <div class="flex gap-2 mt-2">
                            <button onclick="event.stopPropagation(); playHistoryVideo('${escapeHtml(videoUrl)}', '${escapeHtml(title.replace(/'/g, "\\'"))}')" 
                                    class="flex-1 bg-primary/20 hover:bg-primary/30 text-primary text-xs py-1.5 rounded transition-colors">
                                ▶ Play
                            </button>
                            <a href="${escapeHtml(videoUrl)}" download="${escapeHtml(title)}.mp4" 
                               onclick="event.stopPropagation()"
                               class="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs py-1.5 rounded text-center transition-colors">
                                ⬇️
                            </a>
                            <button onclick="event.stopPropagation(); showHistoryDetails('${job.id}')"
                                    class="bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs px-2 py-1.5 rounded transition-colors">
                                ℹ️
                            </button>
                        </div>
                    ` : job.status === 'error' || job.status === 'failed' ? `
                        <p class="text-xs text-red-400 mt-2 truncate">${escapeHtml(job.error || 'Failed')}</p>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// =====================================================
// RE-RENDER VIDEO
// =====================================================

async function startReRender(jobId, title) {
    // Close details modal if open
    document.getElementById('details-modal')?.remove();
    
    // Create progress modal
    const modal = document.createElement('div');
    modal.id = 'rerender-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4';
    
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-2xl p-6 max-w-md w-full text-center">
            <div class="text-4xl mb-4 spin">🔄</div>
            <h3 class="text-xl font-bold mb-2">Re-rendering Video</h3>
            <p class="text-gray-400 mb-4">${escapeHtml(title)}</p>
            <div class="bg-gray-700 rounded-full h-3 mb-4 overflow-hidden">
                <div id="rerender-progress" class="bg-gradient-to-r from-orange-500 to-red-500 h-full transition-all duration-500" style="width: 0%"></div>
            </div>
            <p id="rerender-status" class="text-sm text-gray-400">Starting FFmpeg renderer...</p>
            <p class="text-xs text-gray-500 mt-2">Using existing images & audio (no API cost!)</p>
        </div>
    `;
    document.body.appendChild(modal);
    
    const progressBar = document.getElementById('rerender-progress');
    const statusText = document.getElementById('rerender-status');
    
    try {
        // Start the re-render
        await reRenderVideo(jobId);
        
        progressBar.style.width = '10%';
        statusText.textContent = 'Assembling video with FFmpeg...';
        
        // Poll for completion
        let attempts = 0;
        const maxAttempts = 120; // 10 minutes max
        
        while (attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds
            
            const status = await checkJob(jobId);
            attempts++;
            
            // Update progress
            const progress = Math.min(10 + (attempts / maxAttempts) * 80, 90);
            progressBar.style.width = `${progress}%`;
            
            if (status.status === 'complete') {
                progressBar.style.width = '100%';
                statusText.textContent = 'Video ready!';
                
                // Success - show the video
                setTimeout(() => {
                    modal.remove();
                    if (status.video_url) {
                        playHistoryVideo(status.video_url, title);
                    }
                    // Refresh history grid
                    loadHistory();
                }, 1500);
                return;
            }
            
            if (status.status === 'failed' || status.status === 'error') {
                throw new Error(status.error || 'Render failed');
            }
            
            // Update status text based on phase
            if (status.phase === 'assemble') {
                statusText.textContent = 'FFmpeg rendering in progress...';
            } else {
                statusText.textContent = `Status: ${status.status} (${status.progress || 0}%)`;
            }
        }
        
        throw new Error('Render timed out after 10 minutes');
        
    } catch (error) {
        console.error('Re-render failed:', error);
        modal.querySelector('.bg-gray-800').innerHTML = `
            <div class="text-4xl mb-4">❌</div>
            <h3 class="text-xl font-bold mb-2 text-red-400">Re-render Failed</h3>
            <p class="text-gray-400 mb-4">${escapeHtml(error.message)}</p>
            <button onclick="document.getElementById('rerender-modal').remove()" class="bg-gray-700 hover:bg-gray-600 px-8 py-3 rounded-xl">
                Close
            </button>
        `;
    }
}

// =====================================================
// VIDEO MODAL
// =====================================================

function playHistoryVideo(url, title) {
    const modal = document.createElement('div');
    modal.id = 'video-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    
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
// IMAGE MODAL
// =====================================================

function showImageModal(url) {
    if (!url) return;
    
    const modal = document.createElement('div');
    modal.id = 'image-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    
    modal.innerHTML = `
        <div class="relative max-w-2xl w-full">
            <button onclick="document.getElementById('image-modal').remove()" class="absolute -top-10 right-0 text-white text-2xl hover:text-primary">&times;</button>
            <img src="${escapeHtml(url)}" class="w-full rounded-xl max-h-[80vh] object-contain bg-gray-900" />
            <div class="flex gap-3 mt-4">
                <a href="${escapeHtml(url)}" download="scene.png" target="_blank" class="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-3 rounded-xl text-center">
                    ⬇️ Download
                </a>
                <button onclick="document.getElementById('image-modal').remove()" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl">
                    Close
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// =====================================================
// HISTORY DETAILS MODAL
// =====================================================

async function showHistoryDetails(jobId) {
    const modal = document.createElement('div');
    modal.id = 'details-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 overflow-y-auto';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-2xl p-6 max-w-3xl w-full my-8">
            <div class="text-center py-8 text-gray-400">
                <div class="spin text-4xl mb-4">⏳</div>
                <p>Loading...</p>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    try {
        const client = getSupabaseClient();
        
        const [jobResult, assetsResult] = await Promise.all([
            client.from('jobs').select('*').eq('id', jobId).single(),
            client.from('job_assets').select('*').eq('job_id', jobId).order('created_at')
        ]);
        
        if (jobResult.error) throw jobResult.error;
        
        const job = jobResult.data;
        const assets = assetsResult.data || [];
        
        const videoAsset = assets.find(a => a.type === 'final_mp4');
        const sceneAssets = assets.filter(a => a.type === 'dalle_image' || a.type === 'bg_video');
        
        const isDalle = sceneAssets.some(a => a.type === 'dalle_image');
        const imageCost = isDalle ? sceneAssets.length * 0.08 : 0;
        const totalCost = (0.01 + 0.05 + imageCost).toFixed(2);
        
        const date = new Date(job.created_at).toLocaleString();
        
        modal.querySelector('.bg-gray-800').innerHTML = `
            <div class="flex justify-between items-start mb-6">
                <div>
                    <h2 class="text-2xl font-bold">${escapeHtml(job.title || 'Untitled')}</h2>
                    <p class="text-gray-400 text-sm mt-1">${date} • ${job.duration_sec || 0}s</p>
                </div>
                <button onclick="document.getElementById('details-modal').remove()" class="text-gray-400 hover:text-white text-2xl">&times;</button>
            </div>
            
            <div class="grid grid-cols-3 gap-4 mb-6">
                <div class="bg-gray-700/50 rounded-xl p-4 text-center">
                    <p class="text-2xl font-bold text-primary">${sceneAssets.length}</p>
                    <p class="text-gray-400 text-sm">Scenes</p>
                </div>
                <div class="bg-gray-700/50 rounded-xl p-4 text-center">
                    <p class="text-2xl font-bold ${isDalle ? 'text-purple-400' : 'text-blue-400'}">${isDalle ? 'DALL-E' : 'Pexels'}</p>
                    <p class="text-gray-400 text-sm">Source</p>
                </div>
                <div class="bg-gray-700/50 rounded-xl p-4 text-center">
                    <p class="text-2xl font-bold text-green-400">~$${totalCost}</p>
                    <p class="text-gray-400 text-sm">Cost</p>
                </div>
            </div>
            
            <div class="mb-6">
                <h3 class="font-semibold mb-2">📖 Story</h3>
                <div class="bg-gray-900/50 rounded-xl p-4">
                    <p class="text-gray-200 leading-relaxed text-sm">${escapeHtml(job.story_text || 'N/A')}</p>
                </div>
            </div>
            
            ${sceneAssets.length > 0 ? buildHistoryScenesHtml(sceneAssets, jobId) : ''}
            
            <div class="flex gap-3 flex-wrap">
                ${videoAsset ? `
                    <button onclick="playHistoryVideo('${escapeHtml(videoAsset.public_url)}', '${escapeHtml((job.title || 'Video').replace(/'/g, "\\'"))}')" class="flex-1 bg-primary/20 hover:bg-primary/30 text-primary font-bold py-3 rounded-xl">
                        ▶ Play
                    </button>
                    <a href="${escapeHtml(videoAsset.public_url)}" download class="flex-1 bg-gradient-to-r from-primary to-secondary text-white font-bold py-3 rounded-xl text-center">
                        ⬇️ Download
                    </a>
                ` : ''}
                ${(() => {
                    // Only allow re-render if images are in Supabase Storage
                    const hasValidImages = sceneAssets.some(a => 
                        (a.storage_path?.includes('supabase.co') || a.public_url?.includes('supabase.co'))
                    );
                    if (sceneAssets.length > 0 && hasValidImages) {
                        return `
                            <button onclick="startReRender('${job.id}', '${escapeHtml((job.title || 'Video').replace(/'/g, "\\'"))}')" class="flex-1 bg-orange-600/80 hover:bg-orange-600 text-white font-bold py-3 rounded-xl" title="Re-render video using existing images & audio (free!)">
                                🔄 Re-render Video
                            </button>
                        `;
                    } else if (sceneAssets.length > 0) {
                        return `
                            <button disabled class="flex-1 bg-gray-600 text-gray-400 font-bold py-3 rounded-xl cursor-not-allowed" title="Cannot re-render: Images have expired. Generate a new video instead.">
                                🔄 Images Expired
                            </button>
                        `;
                    }
                    return '';
                })()}
                <button onclick="document.getElementById('details-modal').remove()" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl">
                    Close
                </button>
            </div>
        `;
        
    } catch (error) {
        console.error('Failed to load details:', error);
        modal.querySelector('.bg-gray-800').innerHTML = `
            <div class="text-center py-8">
                <div class="text-4xl mb-4">❌</div>
                <p class="text-red-400 mb-4">Failed to load details</p>
                <button onclick="document.getElementById('details-modal').remove()" class="bg-gray-700 hover:bg-gray-600 px-8 py-3 rounded-xl">Close</button>
            </div>
        `;
    }
}
