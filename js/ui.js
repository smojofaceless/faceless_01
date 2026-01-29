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
            
            ${sceneAssets.length > 0 ? `
                <div class="mb-6">
                    <h3 class="font-semibold mb-2">🎬 Scenes</h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        ${sceneAssets.map((asset, i) => {
                            const isImage = asset.type === 'dalle_image';
                            const prompt = asset.meta?.visual_beat || asset.meta?.dalle_prompt || '';
                            return `
                                <div class="bg-gray-700/50 rounded-lg overflow-hidden">
                                    ${isImage ? `
                                        <img src="${escapeHtml(asset.storage_path)}" class="w-full aspect-[9/16] object-cover cursor-pointer" onclick="showImageModal('${escapeHtml(asset.storage_path)}')" loading="lazy" onerror="this.src='https://via.placeholder.com/200x350?text=Expired'">
                                    ` : `
                                        <video src="${escapeHtml(asset.storage_path)}" class="w-full aspect-[9/16] object-cover" muted></video>
                                    `}
                                    <div class="p-2">
                                        <p class="text-xs text-gray-400">Scene ${i + 1}</p>
                                        ${prompt ? `<p class="text-xs text-purple-400 truncate mt-1" title="${escapeHtml(prompt)}">${escapeHtml(prompt.substring(0, 25))}...</p>` : ''}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            ` : ''}
            
            <div class="flex gap-3 flex-wrap">
                ${videoAsset ? `
                    <button onclick="playHistoryVideo('${escapeHtml(videoAsset.public_url)}', '${escapeHtml((job.title || 'Video').replace(/'/g, "\\'"))}')" class="flex-1 bg-primary/20 hover:bg-primary/30 text-primary font-bold py-3 rounded-xl">
                        ▶ Play
                    </button>
                    <a href="${escapeHtml(videoAsset.public_url)}" download class="flex-1 bg-gradient-to-r from-primary to-secondary text-white font-bold py-3 rounded-xl text-center">
                        ⬇️ Download
                    </a>
                ` : ''}
                ${sceneAssets.length > 0 ? `
                    <button onclick="startReRender('${job.id}', '${escapeHtml((job.title || 'Video').replace(/'/g, "\\'"))}')" class="flex-1 bg-orange-600/80 hover:bg-orange-600 text-white font-bold py-3 rounded-xl" title="Re-render video using existing images & audio (free!)">
                        🔄 Re-render Video
                    </button>
                ` : ''}
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
