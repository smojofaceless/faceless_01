/**
 * FFmpeg Video Renderer Service v3.0
 * 
 * Replaces Creatomate with local FFmpeg rendering.
 * Now with Visual DNA → FFmpeg filter binding!
 * Deploy to Render.com, Railway, or Fly.io.
 * 
 * Endpoints:
 *   POST /render - Start a render job
 *   GET /status/:id - Check render status
 *   GET /video/:id - Download finished video
 *   GET /health - Health check
 * 
 * v3.0 Changes:
 *   - Visual DNA integration for deterministic aesthetics
 *   - FFmpeg preset binding from visual_dna.ts mappings
 *   - Reproducible visual fingerprints
 */

const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');

// Import FFmpeg presets for Visual DNA binding
const {
  buildFFmpegFiltersFromVisualDNA,
  buildKenBurnsWithMotionProfile,
  getEffectFlagsFromVisualDNA,
  buildCombinedFilterGraph,
  normalizeEffectsConfig,
  buildFiltersFromEffectsConfig,
  hashSeed,
  safeClamp,
} = require('./ffmpeg_presets');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' })); // Increased for base64 images

// ─── Auth middleware for render endpoints ───
// Set RENDERER_AUTH_KEY env var to require authentication on mutation endpoints
const RENDERER_AUTH_KEY = process.env.RENDERER_AUTH_KEY || '';

function requireAuth(req, res, next) {
  if (!RENDERER_AUTH_KEY) {
    // No auth key configured — allow all (backwards compatible)
    return next();
  }
  const provided = req.headers['x-renderer-key'] || req.headers['authorization']?.replace('Bearer ', '');
  if (provided !== RENDERER_AUTH_KEY) {
    console.warn(`[AUTH] Rejected request from ${req.ip} to ${req.path}`);
    return res.status(401).json({ error: 'Unauthorized — invalid or missing x-renderer-key header' });
  }
  next();
}

// In-memory job storage (use Redis in production for persistence)
const jobs = new Map();

// Configuration
const TEMP_DIR = process.env.TEMP_DIR || '/tmp/renders';
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/tmp/outputs';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Initialize Supabase client for uploading final videos
let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log('✅ Supabase client initialized');
} else {
  console.log('⚠️ Supabase not configured - videos will only be stored locally');
}

// Memory optimization: limit concurrent FFmpeg processes
let activeRenders = 0;
const MAX_CONCURRENT_RENDERS = parseInt(process.env.MAX_CONCURRENT_RENDERS || '1');

// Detect cloud environment memory limits
// Render.com sets RENDER=true, but memory depends on tier (512MB free, 2GB+ paid)
// os.totalmem() returns HOST memory, not container limit - but we can use env vars
const os = require('os');
const TOTAL_MEMORY_MB = Math.floor(os.totalmem() / 1024 / 1024);
const IS_RENDER = process.env.RENDER === 'true' || !!process.env.RENDER_INSTANCE_ID;
const IS_RAILWAY = !!process.env.RAILWAY_ENVIRONMENT;

// Memory mode control via environment variables:
// - FORCE_LOW_MEMORY=true  -> Forces low memory mode (simplified Ken Burns)
// - HIGH_MEMORY=true       -> Forces full quality mode (disables auto low-memory detection)
// Default: Auto-detect based on RENDER_MEMORY_MB or assume paid tier has enough memory
const FORCE_LOW_MEMORY = process.env.FORCE_LOW_MEMORY === 'true';
const HIGH_MEMORY = process.env.HIGH_MEMORY === 'true';
const RENDER_MEMORY_MB = parseInt(process.env.RENDER_MEMORY_MB || '0', 10);
const DISABLE_KEN_BURNS = process.env.DISABLE_KEN_BURNS === 'true';

// Determine low memory mode:
// 1. If FORCE_LOW_MEMORY=true, always use low memory
// 2. If HIGH_MEMORY=true, never use low memory  
// 3. If RENDER_MEMORY_MB is set and >= 1024, don't use low memory
// 4. Default: DON'T assume low memory - user upgraded to paid tier
const AUTO_LOW_MEMORY = FORCE_LOW_MEMORY || 
  (!HIGH_MEMORY && !FORCE_LOW_MEMORY && RENDER_MEMORY_MB > 0 && RENDER_MEMORY_MB < 1024);

console.log(`📊 System memory: ${TOTAL_MEMORY_MB}MB (host), Cloud: ${IS_RENDER ? 'Render.com' : IS_RAILWAY ? 'Railway' : 'none'}`);
console.log(`📊 Memory config: FORCE_LOW=${FORCE_LOW_MEMORY}, HIGH_MEMORY=${HIGH_MEMORY}, RENDER_MEMORY_MB=${RENDER_MEMORY_MB || 'not set'}`);
console.log(`📊 Low memory mode: ${AUTO_LOW_MEMORY ? 'ENABLED' : 'DISABLED (full quality)'}`);
console.log(`📊 Ken Burns effect: ${DISABLE_KEN_BURNS ? 'DISABLED by env' : AUTO_LOW_MEMORY ? 'SIMPLE mode' : 'FULL mode'}`);

// Ensure directories exist
async function ensureDirs() {
  await fs.mkdir(TEMP_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}
ensureDirs();

/**
 * Download a file from URL to local path
 * Supports both HTTP URLs and base64 data URLs
 */
async function downloadFile(url, outputPath) {
  // v5.13: Validate URL is not empty
  if (!url || typeof url !== 'string' || url.trim() === '') {
    throw new Error(`Invalid URL: received empty or undefined URL`);
  }
  
  // Handle base64 data URLs (common for AI-generated images)
  if (url.startsWith('data:')) {
    console.log(`  → Decoding base64 image to ${path.basename(outputPath)}`);
    const matches = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 data URL');
    }
    const buffer = Buffer.from(matches[2], 'base64');
    await fs.writeFile(outputPath, buffer);
    return;
  }
  
  // Handle HTTP URLs
  console.log(`  → Downloading: ${url.substring(0, 80)}...`);
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'arraybuffer',
    timeout: 120000, // 2 minute timeout for large files
    maxContentLength: 100 * 1024 * 1024, // 100MB max
  });
  
  await fs.writeFile(outputPath, response.data);
}

/**
 * Upload video to Supabase Storage
 */
async function uploadToSupabase(localPath, jobId) {
  if (!supabase) {
    console.log(`[${jobId}] No Supabase client - skipping upload`);
    return null;
  }
  
  try {
    console.log(`[${jobId}] Uploading to Supabase Storage...`);
    const fileBuffer = await fs.readFile(localPath);
    const storagePath = `${jobId}/final_video.mp4`;
    
    const { data, error } = await supabase.storage
      .from('story-videos')
      .upload(storagePath, fileBuffer, {
        contentType: 'video/mp4',
        upsert: true,
      });
    
    if (error) {
      console.error(`[${jobId}] Supabase upload error:`, error);
      return null;
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('story-videos')
      .getPublicUrl(storagePath);
    
    console.log(`[${jobId}] Uploaded to: ${urlData.publicUrl}`);
    return urlData.publicUrl;
  } catch (err) {
    console.error(`[${jobId}] Upload failed:`, err.message);
    return null;
  }
}

/**
 * Update job status in Supabase (if configured)
 * 
 * IMPORTANT: The renderer must NOT set jobs.status to 'complete' or 'failed'.
 * Status management is the worker pipeline's responsibility — it needs to run
 * upload + schedule steps after assembly. The renderer only sets video_url
 * and saves the video asset to job_assets.
 */
async function updateJobInSupabase(jobId, supabaseJobId, status, videoUrl = null) {
  if (!supabase || !supabaseJobId) {
    console.log(`[${jobId}] Skipping Supabase update - no client or job ID`);
    return;
  }
  
  try {
    console.log(`[${jobId}] Updating Supabase job ${supabaseJobId}: render ${status}, videoUrl: ${videoUrl ? 'YES' : 'NO'}`);
    
    // Only update video_url and progress — never touch status.
    // The worker pipeline manages status transitions (upload → schedule → complete).
    const updates = {
      updated_at: new Date().toISOString(),
    };
    
    if (status === 'complete' && videoUrl) {
      updates.video_url = videoUrl;
      // Don't set progress to 100 — worker still needs upload + schedule steps
      updates.progress = 90;
    }
    // NOTE: Do NOT set updates.status — let the worker pipeline handle it
    
    const { error: jobError } = await supabase.from('jobs').update(updates).eq('id', supabaseJobId);
    if (jobError) {
      console.error(`[${jobId}] Jobs table update error:`, jobError);
    } else {
      console.log(`[${jobId}] ✓ Jobs table updated (video_url=${videoUrl ? 'SET' : 'unchanged'}, status=NOT_TOUCHED)`);
    }
    
    // If we have a video URL, save it to job_assets
    if (videoUrl && status === 'complete') {
      console.log(`[${jobId}] Saving video URL to job_assets...`);
      
      // Delete existing then insert
      const { error: deleteError } = await supabase.from('job_assets').delete()
        .eq('job_id', supabaseJobId)
        .eq('type', 'final_mp4');
      
      if (deleteError) {
        console.error(`[${jobId}] Delete existing asset error:`, deleteError);
      }
      
      const { data: insertData, error: insertError } = await supabase.from('job_assets').insert({
        job_id: supabaseJobId,
        type: 'final_mp4',
        storage_path: videoUrl,
        public_url: videoUrl,
        idempotency_key: `${supabaseJobId}:video_assemble`,
        meta: { renderer: 'ffmpeg', completed_at: new Date().toISOString(), quality_ok: true },
      }).select();
      
      if (insertError) {
        console.error(`[${jobId}] ❌ Insert job_assets error:`, insertError);
      } else {
        console.log(`[${jobId}] ✓ Video URL saved to job_assets:`, insertData);
      }
    }
  } catch (err) {
    console.error(`[${jobId}] Failed to update Supabase:`, err.message);
  }
}

/**
 * Ken Burns effect - TWO MODES: Classic and Cinematic
 * 
 * CLASSIC (mood 1-6): Simple, elegant zoom in/out only - original Ken Burns style
 * CINEMATIC (mood 7-10): Dynamic pans, diagonals, faster movements for intense moments
 * 
 * @param index - Scene index
 * @param duration - Scene duration in seconds
 * @param width - Output width
 * @param height - Output height  
 * @param moodLevel - 1-10 mood intensity. 1-6 = Classic, 7-10 = Cinematic
 */
function getKenBurnsFilter(index, duration, width = 1080, height = 1920, moodLevel = 5) {
  const frames = Math.round(duration * 30); // 30fps — Math.round prevents cumulative frame loss across scenes
  // Use 2x scale instead of 8x to reduce memory usage significantly
  const scaledW = width * 2;
  const scaledH = height * 2;
  
  // =====================================================
  // CLASSIC KEN BURNS (mood 1-6)
  // Simple, elegant zoom in/out only - the original Ken Burns style
  // No pans, no diagonals - just smooth, subtle zoom
  // =====================================================
  const classicEffects = [
    // Very slow zoom IN (barely noticeable, dreamy) - ease in
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.0+0.08*pow(on/${frames},0.7)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=30`,
    // Very slow zoom OUT (gentle reveal) - ease out
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.1-0.08*pow(on/${frames},0.7)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=30`,
    // Standard zoom IN (smooth linear)
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.0+0.12*on/${frames}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=30`,
    // Standard zoom OUT (smooth linear)
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.12-0.1*on/${frames}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=30`,
    // Zoom IN with eased acceleration
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.0+0.1*pow(on/${frames},0.8)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=30`,
    // Zoom OUT with eased deceleration
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.12-0.1*pow(on/${frames},1.2)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=30`,
  ];
  
  // =====================================================
  // CINEMATIC KEN BURNS (mood 7-10)  
  // Dynamic movement for intense/scary moments
  // Includes pans, diagonals, faster zoom, sweep motions
  // =====================================================
  const cinematicEffects = [
    // Fast zoom IN (punchy, accelerates) - for jump scares, reveals
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.0+0.25*pow(on/${frames},0.6)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=30`,
    // Fast zoom OUT (dramatic reveal)
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.28-0.25*pow(on/${frames},1.3)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=30`,
    // Pan LEFT with zoom (tracking shot feel)
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.08+0.04*sin(on/${frames}*PI)':d=${frames}:x='(iw-iw/zoom)/2+((iw/zoom-ow)/3)*(1-cos(on/${frames}*PI))/2':y='(ih-ih/zoom)/2':s=${width}x${height}:fps=30`,
    // Pan RIGHT with zoom
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.08+0.04*sin(on/${frames}*PI)':d=${frames}:x='(iw-iw/zoom)/2-((iw/zoom-ow)/3)*(1-cos(on/${frames}*PI))/2':y='(ih-ih/zoom)/2':s=${width}x${height}:fps=30`,
    // Pan UP (reveal from below) - great for looking up at threat
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.1':d=${frames}:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2-((ih/zoom-oh)/3)*(1-cos(on/${frames}*PI))/2':s=${width}x${height}:fps=30`,
    // Pan DOWN (descending feel) - for dread, sinking feeling
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.1':d=${frames}:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2+((ih/zoom-oh)/3)*(1-cos(on/${frames}*PI))/2':s=${width}x${height}:fps=30`,
    // Diagonal drift (top-left to bottom-right) with zoom
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.0+0.18*on/${frames}':d=${frames}:x='(iw-iw/zoom)/2+((iw/zoom-ow)/4)*(1-cos(on/${frames}*PI))/2':y='(ih-ih/zoom)/2+((ih/zoom-oh)/6)*(1-cos(on/${frames}*PI))/2':s=${width}x${height}:fps=30`,
    // Diagonal drift (bottom-right to top-left) with zoom out
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.18-0.12*on/${frames}':d=${frames}:x='(iw-iw/zoom)/2-((iw/zoom-ow)/4)*(1-cos(on/${frames}*PI))/2':y='(ih-ih/zoom)/2-((ih/zoom-oh)/6)*(1-cos(on/${frames}*PI))/2':s=${width}x${height}:fps=30`,
    // Sweep pan with pulse zoom (unsettling)
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.1+0.06*sin(on/${frames}*PI*2)':d=${frames}:x='(iw-iw/zoom)/2+((iw/zoom-ow)/2.5)*(1-cos(on/${frames}*PI))/2':y='(ih-ih/zoom)/2':s=${width}x${height}:fps=30`,
  ];
  
  // Select effect pool: Classic (1-6) or Cinematic (7-10)
  let effectPool;
  let poolName;
  
  if (moodLevel <= 6) {
    effectPool = classicEffects;
    poolName = 'CLASSIC';
  } else {
    effectPool = cinematicEffects;
    poolName = 'CINEMATIC';
  }
  
  // Use index to cycle through the selected pool (not random, for reproducibility)
  const effectIndex = index % effectPool.length;
  console.log(`[KB] Scene ${index + 1}: mood=${moodLevel} → ${poolName} effect #${effectIndex + 1}/${effectPool.length}`);
  
  return effectPool[effectIndex];
}

/**
 * Ultra-simple Ken Burns for very low memory (512MB) environments
 * Uses zoompan but with minimal scale factor (1.05x instead of 2x)
 * This provides visible movement while keeping memory usage under control
 */
function getSimpleKenBurnsFilter(index, duration, width = 1080, height = 1920) {
  const frames = Math.ceil(duration * 15); // ceil prevents cumulative frame shortfall → image drift
  // CRITICAL: Use minimal pre-scale (1.1x) to keep memory low
  // The zoompan itself will handle the rest of the motion
  const scaledW = Math.floor(width * 1.1);
  const scaledH = Math.floor(height * 1.1);
  
  const effects = [
    // Subtle zoom in (1.0 -> 1.05) - very gentle motion
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='min(zoom+0.0003,1.05)':d=${frames}:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':s=${width}x${height}:fps=15`,
    // Subtle zoom out (1.05 -> 1.0)
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='if(lte(zoom,1.0),1.05,max(1.001,zoom-0.0003))':d=${frames}:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':s=${width}x${height}:fps=15`,
    // Subtle pan left to right
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.02':d=${frames}:x='(iw/2-ow/2)+((iw-ow)/3)*sin(on/${frames}*PI)':y='(ih-oh)/2':s=${width}x${height}:fps=15`,
    // Subtle pan right to left
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.02':d=${frames}:x='(iw/2-ow/2)-((iw-ow)/3)*sin(on/${frames}*PI)':y='(ih-oh)/2':s=${width}x${height}:fps=15`,
  ];
  return effects[index % effects.length];
}

/**
 * Create video from images - one scene at a time
 * 
 * PERFORMANCE OPTIMIZATION for cloud free tiers (Render.com 512MB):
 * - lowMemory mode uses 15fps instead of 30fps (50% faster encoding)
 * - Uses superfast preset instead of ultrafast (better compression ratio)
 * - Encodes scenes in parallel batches of 2 (within memory limits)
 */
async function createVideoFromImages(jobId, images, durations, outputPath, options = {}) {
  const { kenBurns = true, lowMemory = false, moodLevels = [], effectsConfig = null, seed = 'default' } = options;
  const tempVideos = [];
  const width = 1080;
  const height = 1920;
  // Use 15fps for low memory mode - significantly faster encoding for still images
  const fps = lowMemory ? 15 : 30;
  
  console.log(`[${jobId}] Processing ${images.length} images (lowMemory: ${lowMemory}, fps: ${fps})`);
  
  // Step 1: Create individual video clips for each image
  // Calculate total duration for validation
  const totalDuration = durations.reduce((sum, d) => sum + (d || 5), 0);
  console.log(`[${jobId}] Total video duration will be: ${totalDuration.toFixed(2)}s from ${images.length} scenes`);
  
  // Resolve falsy durations to 5s default.
  // NOTE: Floor enforcement is handled by the worker pipeline (steps.ts) before
  // durations reach the renderer. Applying it AGAIN here caused double distortion
  // and cumulative image-narration drift. The renderer trusts the incoming durations.
  const sceneDurations = durations.map(d => d || 5);
  console.log(`[${jobId}] Scene durations (from worker): ${sceneDurations.map(d => d.toFixed(2)).join(',')}s`);

  for (let i = 0; i < images.length; i++) {
    const imagePath = images[i];
    const duration = sceneDurations[i];
    const tempVideo = path.join(TEMP_DIR, `${jobId}_scene_${i}.mp4`);
    tempVideos.push(tempVideo);
    
    // Force garbage collection if available
    if (global.gc) global.gc();
    
    await new Promise((resolve, reject) => {
      let cmd = ffmpeg(imagePath)
        .inputOptions(['-loop', '1']);
      
      // Apply Ken Burns effect
      if (kenBurns) {
        // Get mood level for this scene (default 5 = medium if not provided)
        const sceneMood = moodLevels && moodLevels[i] !== undefined ? moodLevels[i] : 5;
        
        // v4.0: Controlled Motion — use effects_config Ken Burns if available
        if (effectsConfig && effectsConfig.kenburns?.enabled) {
          try {
            const kbFilter = buildKenBurnsFromConfig(
              effectsConfig.kenburns,
              safeClamp(effectsConfig.intensity, 0.5, 0, 1),
              i, duration, width, height, seed, lowMemory
            );
            if (kbFilter) {
              cmd = cmd.complexFilter(kbFilter);
              console.log(`[${jobId}] Scene ${i + 1}: Controlled Motion KB (dir=${effectsConfig.kenburns.direction || 'alt'}, seed=${seed.substring(0, 8)})`);
            } else {
              // Fallback to standard KB
              const filter = getKenBurnsFilter(i, duration, width, height, sceneMood);
              cmd = cmd.complexFilter(filter);
            }
          } catch (kbErr) {
            console.warn(`[${jobId}] Scene ${i + 1}: Controlled Motion KB failed, fallback:`, kbErr.message);
            const filter = getKenBurnsFilter(i, duration, width, height, sceneMood);
            cmd = cmd.complexFilter(filter);
          }
        } else if (lowMemory) {
          // Low memory: use simplified Ken Burns with minimal scale
          const filter = getSimpleKenBurnsFilter(i, duration, width, height);
          cmd = cmd.complexFilter(filter);
          console.log(`[${jobId}] Scene ${i + 1}: Using simple Ken Burns (low memory, mood=${sceneMood})`);
        } else {
          // Full Ken Burns animation - INTELLIGENT selection based on scene mood
          const filter = getKenBurnsFilter(i, duration, width, height, sceneMood);
          cmd = cmd.complexFilter(filter);
        }
      } else {
        // Ken Burns disabled: simple scale, no animation
        cmd = cmd
          .inputOptions(['-framerate', String(fps)])
          .videoFilter(`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`);
      }
      
      // Encoding options optimized for speed in low memory mode
      const outputOptions = lowMemory ? [
        '-c:v', 'libx264',
        '-preset', 'superfast',  // Better than ultrafast for size, still fast
        '-tune', 'stillimage',   // Optimize for still images
        '-crf', '26',
        '-t', String(duration),
        '-pix_fmt', 'yuv420p',
        '-r', String(fps),
        '-threads', '2',  // Use 2 threads - balance between speed and memory
        '-x264opts', 'ref=1:bframes=0',  // Fastest encoding settings
      ] : [
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-t', String(duration),
        '-pix_fmt', 'yuv420p',
        '-r', '30',
      ];
      
      cmd
        .outputOptions(outputOptions)
        .output(tempVideo)
        .on('start', (cmdLine) => {
          console.log(`[${jobId}] Scene ${i + 1} started (${duration}s @ ${fps}fps)`);
        })
        .on('end', () => resolve())
        .on('error', (err, stdout, stderr) => {
          console.error(`[${jobId}] Scene ${i + 1} error:`, err.message);
          console.error(`[${jobId}] stderr:`, stderr);
          reject(err);
        })
        .run();
    });
    
    console.log(`[${jobId}] ✓ Scene ${i + 1}/${images.length} created`);
    
    // Update job progress
    const job = jobs.get(jobId);
    if (job) {
      job.progress = 25 + Math.round((i + 1) / images.length * 25);
    }
    
    // Delete source image to free disk space
    await fs.unlink(imagePath).catch(() => {});
  }
  
  // Step 2: Concatenate all clips
  const listFile = path.join(TEMP_DIR, `${jobId}_list.txt`);
  const listContent = tempVideos.map(v => `file '${v.replace(/\\/g, '/')}'`).join('\n');
  await fs.writeFile(listFile, listContent);
  
  console.log(`[${jobId}] Concatenating ${tempVideos.length} clips...`);
  
  await new Promise((resolve, reject) => {
    const concatOptions = lowMemory ? [
      '-c:v', 'libx264',
      '-preset', 'superfast',
      '-crf', '24',
      '-pix_fmt', 'yuv420p',
      '-r', String(fps),  // Maintain consistent framerate
      '-threads', '2',
    ] : [
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '22',
      '-pix_fmt', 'yuv420p',
    ];
    
    ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(concatOptions)
      .output(outputPath)
      .on('start', () => console.log(`[${jobId}] Concat started...`))
      .on('end', resolve)
      .on('error', (err, stdout, stderr) => {
        console.error(`[${jobId}] Concat error:`, err.message);
        reject(err);
      })
      .run();
  });
  
  // Cleanup temp files
  for (const v of tempVideos) {
    await fs.unlink(v).catch(() => {});
  }
  await fs.unlink(listFile).catch(() => {});
  
  console.log(`[${jobId}] ✓ Base video created`);
  return outputPath;
}

/**
 * Add audio to video
 */
async function addAudioToVideo(videoPath, audioPath, outputPath) {
  // Get audio duration to use as explicit target instead of -shortest
  const audioDuration = await getMediaDuration(audioPath);
  console.log(`[addAudioToVideo] Audio duration: ${audioDuration}s`);
  
  return new Promise((resolve, reject) => {
    const outputOpts = [
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-map', '0:v:0',
      '-map', '1:a:0',
    ];
    
    // Use explicit -t instead of -shortest to prevent truncating the last image.
    // -shortest would cut whichever stream is shorter, eating the last scene's
    // display time when normalization inflated the video beyond audio length.
    if (audioDuration > 0) {
      outputOpts.push('-t', String(audioDuration));
    } else {
      // Fallback: use -shortest if we can't determine audio duration
      outputOpts.push('-shortest');
    }
    
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions(outputOpts)
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => {
        console.error('Audio merge error:', err.message);
        reject(err);
      })
      .run();
  });
}

/**
 * Mix background music with existing video audio
 * v2.0 - Background Music V1: Sidechain ducking + fade in/out
 * 
 * @param {string} videoPath - Input video with existing audio (narration)
 * @param {string} musicPath - Background music file
 * @param {string} outputPath - Output video path
 * @param {number} musicVolume - Music volume as percentage (0-100)
 * @param {object} musicConfig - Optional config: { ducking: { enabled, duck_volume, attack_ms, release_ms }, fade: { in_ms, out_ms } }
 * @param {number} videoDurationSec - Video duration in seconds (for fade-out timing)
 */
async function mixBackgroundMusic(videoPath, musicPath, outputPath, musicVolume = 15, musicConfig = null, videoDurationSec = 0) {
  return new Promise(async (resolve, reject) => {
    // Clamp and convert percentage to decimal (15% = 0.15)
    const clampedVolume = Math.max(0, Math.min(100, Number(musicVolume) || 15));
    const volumeDecimal = clampedVolume / 100;
    
    // Parse music config with safe defaults — handles null, undefined, partial objects
    const ducking = (musicConfig && typeof musicConfig.ducking === 'object' && musicConfig.ducking)
      ? { enabled: !!musicConfig.ducking.enabled, ...musicConfig.ducking }
      : { enabled: false };
    const fade = (musicConfig && typeof musicConfig.fade === 'object' && musicConfig.fade)
      ? musicConfig.fade
      : { in_ms: 0, out_ms: 0 };
    const fadeInSec = (Number(fade.in_ms) || 0) / 1000;
    const fadeOutSec = (Number(fade.out_ms) || 0) / 1000;
    
    // Get video duration for fade-out calculation if not provided
    let duration = videoDurationSec;
    if (duration <= 0) {
      try {
        duration = await getMediaDuration(videoPath);
      } catch (e) {
        console.warn(`Could not get video duration for fade-out: ${e.message}, using 60s default`);
        duration = 60;
      }
    }
    
    // Build the audio filter chain for the music track [1:a]
    // 
    // Filter pipeline:
    //   1. Volume reduction (always)
    //   2. Fade-in (if configured)
    //   3. Fade-out at end of video (if configured)
    //   4. Mix with narration using either:
    //      a. sidechaincompress (if ducking enabled) — music ducks when voice is present
    //      b. amix (if no ducking) — simple volume blend
    //
    // Sidechain Ducking Explanation:
    //   sidechaincompress uses the narration [0:a] as the "sidechain" signal.
    //   When narration volume exceeds the threshold, the compressor reduces
    //   the music volume (ratio controls how aggressively).
    //   attack_ms = how fast the music ducks when voice starts
    //   release_ms = how fast the music comes back when voice stops
    //   This creates the professional "music lowers during speech" effect.
    //
    // Why this won't clip:
    //   - Music is pre-attenuated to volumeDecimal BEFORE mixing
    //   - amix with duration=first ensures output duration matches video
    //   - dropout_transition provides smooth fade at the end
    //   - sidechaincompress only reduces (never amplifies) the music signal
    //
    // Duration mismatches:
    //   - Music shorter than video: -stream_loop -1 loops it infinitely
    //   - Music longer than video: duration=first in amix truncates to video length
    //   - This handles any music/video length combination safely
    
    const musicFilters = [];
    
    // Step 1: Volume reduction
    let currentLabel = '1:a';
    musicFilters.push(`[${currentLabel}]volume=${volumeDecimal}[mvol]`);
    currentLabel = 'mvol';
    
    // Step 2: Fade-in
    if (fadeInSec > 0) {
      musicFilters.push(`[${currentLabel}]afade=t=in:st=0:d=${fadeInSec}[mfin]`);
      currentLabel = 'mfin';
    }
    
    // Step 3: Fade-out (at end of video)
    if (fadeOutSec > 0 && duration > fadeOutSec) {
      const fadeOutStart = Math.max(0, duration - fadeOutSec);
      musicFilters.push(`[${currentLabel}]afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeOutSec}[mfout]`);
      currentLabel = 'mfout';
    }
    
    let filterComplex;
    
    if (ducking.enabled) {
      // Sidechain ducking: narration controls music volume
      //
      // Parameters:
      //   threshold: voice level that triggers ducking (0.02 = very sensitive, catches whispers)
      //   ratio: compression ratio (6-10 = aggressive ducking for clear narration)
      //   attack: how fast music ducks in seconds (150ms = quick but not clicking)
      //   release: how fast music returns in seconds (250ms = natural swell back)
      //   level_sc: sidechain input gain (1.0 = no change to detection sensitivity)
      //
      const duckVol = ducking.duck_volume || 0.08;
      const attackSec = (ducking.attack_ms || 150) / 1000;
      const releaseSec = (ducking.release_ms || 250) / 1000;
      // ratio = how much to duck. Higher = more aggressive.
      // We calculate from the volume ratio: if default_volume=0.18 and duck_volume=0.08,
      // that's roughly 2.25:1 reduction, so ratio ~6-8 gives us good ducking.
      const ratio = Math.max(4, Math.min(12, Math.round(volumeDecimal / Math.max(duckVol, 0.01))));
      
      filterComplex = [
        ...musicFilters,
        // Use sidechaincompress: narration [0:a] controls music compression
        `[${currentLabel}][0:a]sidechaincompress=threshold=0.02:ratio=${ratio}:attack=${attackSec.toFixed(3)}:release=${releaseSec.toFixed(3)}:level_sc=1.0[ducked]`,
        // Mix narration (full volume) with ducked music
        '[0:a][ducked]amix=inputs=2:duration=first:dropout_transition=2[mixed]',
        // Limiter: prevent clipping from amplitude spikes when mixing different-loudness tracks
        // limit=0.95 leaves 0.5dB headroom; attack/release in ms for transparent limiting
        '[mixed]alimiter=limit=0.95:attack=5:release=50[out]'
      ];
    } else {
      // Simple mix without ducking (original behavior)
      filterComplex = [
        ...musicFilters,
        // Mix narration (full volume) with volume-adjusted music
        `[0:a][${currentLabel}]amix=inputs=2:duration=first:dropout_transition=2[mixed]`,
        // Limiter: prevent clipping from amplitude spikes when mixing different-loudness tracks
        '[mixed]alimiter=limit=0.95:attack=5:release=50[out]'
      ];
    }
    
    console.log(`  Music filter chain: ducking=${ducking.enabled}, fadeIn=${fadeInSec}s, fadeOut=${fadeOutSec}s, volume=${clampedVolume}%`);
    
    // Loopable flag: defaults to true for backward compat
    // When false, music plays once and any remaining video has silence
    const loopable = musicConfig?.loopable !== false;
    
    // Build FFmpeg command
    // [0:a] = video's audio (narration), [1:a] = music
    //
    // FILTER ORDER VERIFICATION (do not reorder):
    //   1. volume → 2. afade(in) → 3. afade(out) → 4. sidechaincompress → 5. amix → 6. alimiter
    //   Steps 1-3 affect ONLY the music stream (pre-mix).
    //   Step 4 ducks music when narration is loud (music=[compressed], sidechain=[0:a]).
    //   Step 5 mixes narration + processed music. duration=first = truncate to video length.
    //   Step 6 limits output amplitude to 0.95 (−0.45 dB headroom) to prevent clipping.
    //   Narration is NEVER passed through fades or volume — it stays at full level.
    //
    const cmd = ffmpeg().input(videoPath).input(musicPath);
    if (loopable) {
      cmd.inputOptions('-stream_loop', '-1'); // Loop music infinitely; amix duration=first truncates
    }
    cmd.complexFilter(filterComplex)
      .outputOptions([
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-map', '0:v:0',
        '-map', '[out]',
        '-shortest',
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => {
        console.error('Music mix error:', err.message);
        reject(err);
      })
      .run();
  });
}

/**
 * Get duration of a media file in seconds using ffprobe
 */
function getMediaDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}

/**
 * Add vignette effect
 */
async function addVignette(inputPath, outputPath, lowMemory = false) {
  return new Promise((resolve, reject) => {
    const outputOptions = lowMemory ? [
      '-c:v', 'libx264',
      '-preset', 'superfast',
      '-crf', '24',
      '-c:a', 'copy',
      '-threads', '2',
    ] : [
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-c:a', 'copy',
    ];
    
    ffmpeg(inputPath)
      .videoFilter('vignette=PI/4')
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

/**
 * Add horror color grading
 */
async function addHorrorGrade(inputPath, outputPath, lowMemory = false) {
  return new Promise((resolve, reject) => {
    const outputOptions = lowMemory ? [
      '-c:v', 'libx264',
      '-preset', 'superfast',
      '-crf', '24',
      '-c:a', 'copy',
      '-threads', '2',
    ] : [
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-c:a', 'copy',
    ];
    
    ffmpeg(inputPath)
      .videoFilter([
        // Desaturate + increase contrast + cold tint
        'eq=saturation=0.7:contrast=1.15:brightness=-0.03',
        'colorbalance=rs=-0.05:gs=-0.05:bs=0.1',
      ].join(','))
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

/**
 * Add film grain/old film effect
 * Includes: subtle shake, film grain noise, and occasional dust/scratch overlay
 */
async function addFilmGrain(inputPath, outputPath, lowMemory = false) {
  // Set timeout - 5 minutes max for film grain
  const TIMEOUT_MS = 5 * 60 * 1000;
  
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      console.error('⚠️ Film grain timed out after 5 minutes, using fallback...');
      ffmpegCommand.kill('SIGKILL');
    }, TIMEOUT_MS);
    
    const outputOptions = lowMemory ? [
      '-c:v', 'libx264',
      '-preset', 'ultrafast',  // Even faster for low memory
      '-crf', '26',
      '-c:a', 'copy',
      '-threads', '2',
    ] : [
      '-c:v', 'libx264',
      '-preset', 'fast',  // Changed from medium to fast
      '-crf', '23',
      '-c:a', 'copy',
      '-threads', '4',
    ];
    
    // Film grain: Visible noise + desaturation + color shift (no darkening)
    const ffmpegCommand = ffmpeg(inputPath)
      .complexFilter([
        // Stronger grain with visible chromatic aberration
        '[0:v]noise=c0s=20:c1s=15:c0f=t+u,eq=saturation=0.78:contrast=1.05,rgbashift=rh=-2:bh=2[final]'
      ], 'final')
      .outputOptions(['-map', '0:a?', ...outputOptions])
      .output(outputPath)
      .on('end', () => {
        clearTimeout(timeoutHandle);
        resolve();
      })
      .on('error', (err) => {
        clearTimeout(timeoutHandle);
        if (timedOut) {
          // Try ultra-simple fallback after timeout
          console.log('  → Trying ultra-simple grain fallback...');
          ffmpeg(inputPath)
            .videoFilter('noise=c0s=18:c0f=t,eq=saturation=0.8')
            .outputOptions(['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-c:a', 'copy'])
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        } else {
          console.error('Film grain error:', err.message);
          // Fallback to simplest possible effect
          ffmpeg(inputPath)
            .videoFilter('noise=c0s=18:c0f=t,eq=saturation=0.8')
            .outputOptions(outputOptions)
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        }
      })
      .run();
  });
}

// =====================================================
// NEW EFFECTS - Fade, Glitch, Atmospheric, Psychological
// =====================================================

/**
 * Add fade in from black at the start and/or fade out to black at the end
 * @param {string} inputPath - Input video path
 * @param {string} outputPath - Output video path
 * @param {object} options - { fadeIn: true, fadeOut: true, fadeDuration: 1.5 }
 */
async function addFadeEffect(inputPath, outputPath, options = {}, lowMemory = false) {
  const { fadeIn = true, fadeOut = true, fadeDuration = 1.5 } = options;
  
  return new Promise(async (resolve, reject) => {
    // Get video duration first
    const duration = await getVideoDuration(inputPath);
    
    const filters = [];
    
    if (fadeIn) {
      filters.push(`fade=t=in:st=0:d=${fadeDuration}`);
    }
    
    if (fadeOut) {
      const fadeOutStart = Math.max(0, duration - fadeDuration);
      filters.push(`fade=t=out:st=${fadeOutStart}:d=${fadeDuration}`);
    }
    
    if (filters.length === 0) {
      // No fades, just copy
      await fs.copyFile(inputPath, outputPath);
      return resolve();
    }
    
    const outputOptions = lowMemory ? [
      '-c:v', 'libx264', '-preset', 'superfast', '-crf', '24', '-c:a', 'copy', '-threads', '2',
    ] : [
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'copy',
    ];
    
    ffmpeg(inputPath)
      .videoFilter(filters.join(','))
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

/**
 * Get video duration using ffprobe
 */
async function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 60);
    });
  });
}

/**
 * Format seconds to MM:SS format
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Add glitch flicker effect - random brightness spikes on a few frames
 * Creates unsettling micro-disturbances (high retention effect)
 */
async function addGlitchFlicker(inputPath, outputPath, lowMemory = false) {
  return new Promise((resolve, reject) => {
    const outputOptions = lowMemory ? [
      '-c:v', 'libx264', '-preset', 'superfast', '-crf', '24', '-c:a', 'copy', '-threads', '2',
    ] : [
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'copy',
    ];
    
    // Glitch effect: periodic brightness spikes + color shift (no random() which fails)
    // Uses modulo math to create pseudo-random feel
    ffmpeg(inputPath)
      .complexFilter([
        // Brightness spike every ~50 frames using mod trick + RGB shift
        `[0:v]eq=brightness='0.1*lt(mod(n*7,50),2)',rgbashift=rh=2:bh=-2[out]`
      ], 'out')
      .outputOptions(['-map', '0:a?', ...outputOptions])
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => {
        console.error('Glitch flicker error, using fallback:', err.message);
        // Ultra-simple fallback: just periodic brightness flicker
        ffmpeg(inputPath)
          .videoFilter('eq=brightness=0.08*sin(n*0.4)')
          .outputOptions(outputOptions)
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      })
      .run();
  });
}

/**
 * Add VHS tracking wobble effect
 * Simulates old VHS tape with horizontal displacement and noise
 */
async function addVHSTracking(inputPath, outputPath, lowMemory = false) {
  const TIMEOUT_MS = 4 * 60 * 1000; // 4 min timeout (increased)
  
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      console.error('⚠️ VHS tracking timed out, using fallback...');
      ffmpegCommand.kill('SIGKILL');
    }, TIMEOUT_MS);
    
    const outputOptions = lowMemory ? [
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'copy', '-threads', '2',
    ] : [
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-c:a', 'copy', '-threads', '4',
    ];
    
    // VHS: visible noise + desaturation + slight blur for analog feel
    const ffmpegCommand = ffmpeg(inputPath)
      .videoFilter('noise=c0s=15:c0f=t,eq=saturation=0.7,unsharp=3:3:-0.5')
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', () => {
        clearTimeout(timeoutHandle);
        resolve();
      })
      .on('error', (err) => {
        clearTimeout(timeoutHandle);
        console.error('VHS tracking error, using fallback:', err.message);
        ffmpeg(inputPath)
          .videoFilter('noise=c0s=12:c0f=t,eq=saturation=0.75')
          .outputOptions(['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-c:a', 'copy'])
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      })
      .run();
  });
}

/**
 * Add light flicker effect - atmospheric horror brightness variation
 * Simulates unstable lighting / candlelight
 */
async function addLightFlicker(inputPath, outputPath, lowMemory = false) {
  const TIMEOUT_MS = 3 * 60 * 1000; // 3 min timeout
  
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      console.error('⚠️ Light flicker timed out, skipping...');
      ffmpegCommand.kill('SIGKILL');
    }, TIMEOUT_MS);
    
    const outputOptions = lowMemory ? [
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-c:a', 'copy', '-threads', '2',
    ] : [
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'copy', '-threads', '4',
    ];
    
    // Visible light flicker - stronger brightness oscillation
    const ffmpegCommand = ffmpeg(inputPath)
      .videoFilter('eq=brightness=0.08*sin(n*0.3):gamma=1.0+0.05*sin(n*0.15)')
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', () => {
        clearTimeout(timeoutHandle);
        resolve();
      })
      .on('error', (err) => {
        clearTimeout(timeoutHandle);
        if (timedOut) {
          // Just copy on timeout
          ffmpeg(inputPath)
            .outputOptions(['-map', '0', '-c:v', 'copy', '-c:a', 'copy'])
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        } else {
          reject(err);
        }
      })
      .run();
  });
}

/**
 * Add heartbeat zoom effect - subtle pulsing scale
 * Creates subliminal unease (psychological effect)
 */
async function addHeartbeatZoom(inputPath, outputPath, lowMemory = false) {
  return new Promise((resolve, reject) => {
    const outputOptions = lowMemory ? [
      '-c:v', 'libx264', '-preset', 'superfast', '-crf', '24', '-c:a', 'copy', '-threads', '2',
    ] : [
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'copy',
    ];
    
    // Subtle scale pulse like a heartbeat (0.5-1% scale variation)
    // Uses zoompan for smooth interpolation
    ffmpeg(inputPath)
      .complexFilter([
        // Scale up slightly then crop to add subtle zoom pulse
        `[0:v]scale=1100:1956,zoompan=z='1.0+0.008*sin(on*0.15)':d=1:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':s=1080x1920:fps=30[out]`
      ], 'out')
      .outputOptions(['-map', '0:a?', ...outputOptions])
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => {
        console.error('Heartbeat zoom error, using fallback:', err.message);
        // Fallback: just copy without effect
        ffmpeg(inputPath)
          .outputOptions(['-c:v', 'copy', '-c:a', 'copy'])
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      })
      .run();
  });
}

/**
 * Add negative flash effect - brief inverted color frames
 * Jump scare / subliminal horror effect
 */
async function addNegativeFlash(inputPath, outputPath, lowMemory = false) {
  return new Promise((resolve, reject) => {
    const outputOptions = lowMemory ? [
      '-c:v', 'libx264', '-preset', 'superfast', '-crf', '24', '-c:a', 'copy', '-threads', '2',
    ] : [
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'copy',
    ];
    
    // SIMPLIFIED: Use brightness spikes instead of geq (geq is EXTREMELY slow)
    // This creates bright flashes that simulate the negative flash feel
    ffmpeg(inputPath)
      .videoFilter('eq=brightness=0.08*sin(n*0.05)*sin(n*0.37)')
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => {
        console.error('Negative flash error:', err.message);
        // Just copy the file
        ffmpeg(inputPath)
          .outputOptions(['-map', '0', '-c:v', 'copy', '-c:a', 'copy'])
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      })
      .run();
  });
}

/**
 * Add cold color creep effect - gradual blue/green shift over time
 * Creates slow atmospheric dread
 */
async function addColdColorCreep(inputPath, outputPath, lowMemory = false) {
  return new Promise(async (resolve, reject) => {
    const duration = await getVideoDuration(inputPath);
    
    const outputOptions = lowMemory ? [
      '-c:v', 'libx264', '-preset', 'superfast', '-crf', '24', '-c:a', 'copy', '-threads', '2',
    ] : [
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'copy',
    ];
    
    // Gradually shift color temperature colder as video progresses
    // n/total_frames gives 0->1 progress
    const totalFrames = Math.floor(duration * 30);
    
    ffmpeg(inputPath)
      .videoFilter([
        // Progressively desaturate and shift blue
        `colorbalance=rs='-0.1*n/${totalFrames}':gs='-0.05*n/${totalFrames}':bs='0.15*n/${totalFrames}'`,
        `eq=saturation='1.0-0.15*n/${totalFrames}'`,
      ].join(','))
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => {
        console.error('Cold color creep error, using fallback:', err.message);
        // Fallback: static cold grade
        ffmpeg(inputPath)
          .videoFilter('colorbalance=bs=0.1,eq=saturation=0.9')
          .outputOptions(outputOptions)
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      })
      .run();
  });
}

/**
 * Add edge darkening creep effect - vignette that closes in over time
 * Creates claustrophobic psychological effect
 */
async function addEdgeDarkeningCreep(inputPath, outputPath, lowMemory = false) {
  return new Promise(async (resolve, reject) => {
    const duration = await getVideoDuration(inputPath);
    
    const outputOptions = lowMemory ? [
      '-c:v', 'libx264', '-preset', 'superfast', '-crf', '24', '-c:a', 'copy', '-threads', '2',
    ] : [
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'copy',
    ];
    
    // Vignette that progressively intensifies
    const totalFrames = Math.floor(duration * 30);
    
    ffmpeg(inputPath)
      .videoFilter([
        // Start with light vignette (PI/3), end with heavy (PI/6)
        // PI/3 ≈ 1.05, PI/6 ≈ 0.52
        `vignette='PI/(3-1.5*n/${totalFrames})'`
      ].join(','))
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => {
        console.error('Edge darkening error, using fallback:', err.message);
        ffmpeg(inputPath)
          .videoFilter('vignette=PI/4')
          .outputOptions(outputOptions)
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      })
      .run();
  });
}

/**
 * Add scanline overlay effect - CRT monitor style
 * Fits analog horror aesthetic
 */
async function addScanlines(inputPath, outputPath, lowMemory = false) {
  const TIMEOUT_MS = 3 * 60 * 1000; // 3 min timeout
  
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      console.error('⚠️ Scanlines timed out, skipping...');
      ffmpegCommand.kill('SIGKILL');
    }, TIMEOUT_MS);
    
    const outputOptions = lowMemory ? [
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-c:a', 'copy', '-threads', '2',
    ] : [
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'copy', '-threads', '4',
    ];
    
    // CRT scanlines: contrast + noise for visible CRT feel (no darkening)
    const ffmpegCommand = ffmpeg(inputPath)
      .videoFilter([
        'noise=c0s=8:c0f=t',  // Visible noise
        'eq=contrast=1.12'  // Contrast for CRT feel without darkening
      ].join(','))
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', () => {
        clearTimeout(timeoutHandle);
        resolve();
      })
      .on('error', (err) => {
        clearTimeout(timeoutHandle);
        if (timedOut) {
          // Just copy on timeout
          ffmpeg(inputPath)
            .outputOptions(['-c:v', 'copy', '-c:a', 'copy', '-map', '0'])
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        } else {
          console.error('Scanlines error, using fallback:', err.message);
          ffmpeg(inputPath)
            .outputOptions(['-c:v', 'copy', '-c:a', 'copy', '-map', '0'])
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        }
      })
      .run();
  });
}

// =====================================================
// VISUAL DNA FILTER APPLICATION v3.0
// =====================================================

/**
 * Apply Visual DNA filter chain in a single pass
 * This applies all DNA-derived filters efficiently
 * 
 * @param {string} inputPath - Input video
 * @param {string} outputPath - Output video
 * @param {string[]} filters - Array of FFmpeg filter strings
 * @param {boolean} lowMemory - Low memory mode
 */
async function applyVisualDNAFilters(inputPath, outputPath, filters, lowMemory = false) {
  const TIMEOUT_MS = 5 * 60 * 1000; // 5 min timeout
  
  return new Promise((resolve, reject) => {
    if (!filters || filters.length === 0) {
      // No filters, just copy
      ffmpeg(inputPath)
        .outputOptions(['-c:v', 'copy', '-c:a', 'copy'])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
      return;
    }
    
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      console.error('⚠️ Visual DNA filters timed out, using simplified filter...');
      ffmpegCommand.kill('SIGKILL');
    }, TIMEOUT_MS);
    
    const outputOptions = lowMemory ? [
      '-c:v', 'libx264', '-preset', 'superfast', '-crf', '24', '-c:a', 'copy', '-threads', '2',
    ] : [
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'copy',
    ];
    
    // Combine all filters into single chain
    const filterChain = filters.join(',');
    console.log(`  → Applying filter chain: ${filterChain.substring(0, 100)}${filterChain.length > 100 ? '...' : ''}`);
    
    const ffmpegCommand = ffmpeg(inputPath)
      .videoFilter(filterChain)
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', () => {
        clearTimeout(timeoutHandle);
        resolve();
      })
      .on('error', (err) => {
        clearTimeout(timeoutHandle);
        if (timedOut) {
          // Fallback: simplified filter (just color grade)
          const simplifiedFilter = filters.find(f => f.startsWith('eq=')) || 'eq=contrast=1.05';
          console.log(`  → Timeout fallback: ${simplifiedFilter}`);
          ffmpeg(inputPath)
            .videoFilter(simplifiedFilter)
            .outputOptions(['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-c:a', 'copy'])
            .output(outputPath)
            .on('end', resolve)
            .on('error', (fallbackErr) => {
              // Ultimate fallback: just copy
              console.error('  → Filter fallback failed, copying raw');
              ffmpeg(inputPath)
                .outputOptions(['-c:v', 'copy', '-c:a', 'copy'])
                .output(outputPath)
                .on('end', resolve)
                .on('error', reject)
                .run();
            })
            .run();
        } else {
          console.error('Visual DNA filter error:', err.message);
          // Try simplified version
          const simplifiedFilter = 'eq=saturation=0.8:contrast=1.1';
          ffmpeg(inputPath)
            .videoFilter(simplifiedFilter)
            .outputOptions(outputOptions)
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        }
      })
      .run();
  });
}

// Scary/horror words to highlight in red (synced with config.ts)
const SCARY_WORDS = new Set([
  'death', 'dead', 'die', 'dying', 'died', 'kill', 'killed', 'killing', 'murder', 'murdered',
  'blood', 'bloody', 'bleeding', 'scream', 'screamed', 'screaming', 'terror', 'terrified',
  'horror', 'horrified', 'fear', 'feared', 'afraid', 'nightmare', 'evil', 'demon', 'demonic',
  'ghost', 'haunted', 'haunting', 'monster', 'creature', 'beast', 'dark', 'darkness',
  'shadow', 'shadows', 'whisper', 'whispered', 'whispers', 'soul', 'souls', 'curse', 'cursed',
  'grave', 'graves', 'graveyard', 'cemetery', 'tomb', 'corpse', 'body', 'bodies',
  'creep', 'creeping', 'crawl', 'crawling', 'flesh', 'bone', 'bones', 'skull', 'skulls',
  'suffer', 'suffered', 'suffering', 'pain', 'agony', 'torment', 'torture', 'hell',
  'doom', 'doomed', 'damned', 'wicked', 'sinister', 'malevolent', 'malicious',
  'vanish', 'vanished', 'disappeared', 'gone', 'lost', 'trapped', 'escape',
  'chase', 'chased', 'chasing', 'hunt', 'hunted', 'hunting', 'prey',
  'eyes', 'stare', 'stared', 'staring', 'watch', 'watched', 'watching',
  'cold', 'frozen', 'freeze', 'chill', 'chilling', 'shiver', 'shivering',
  'alone', 'lonely', 'isolation', 'isolated', 'abandoned', 'forsaken'
]);

/**
 * Caption style configurations (synced with config.ts)
 */
const CAPTION_STYLES = {
  bold: {
    fontName: 'Impact',
    fontSize: 85,
    fontWeight: 'bold',
    primaryColor: '&H00FFFFFF', // White
    outlineColor: '&H00000000', // Black
    outline: 4,
  },
  horror: {
    fontName: 'Times New Roman',
    fontSize: 90,
    fontWeight: 'bold',
    italic: true,
    primaryColor: '&H002626DC', // Dark red (BGR)
    outlineColor: '&H00000000',
    outline: 3,
  },
  glitch: {
    fontName: 'Impact',
    fontSize: 80,
    fontWeight: 'normal',
    primaryColor: '&H00FFFF00', // Cyan (BGR)
    outlineColor: '&H00FF00FF', // Magenta
    outline: 2,
  },
  minimal: {
    fontName: 'Arial',
    fontSize: 65,
    fontWeight: 'normal',
    primaryColor: '&H00E7E5EB', // Light gray
    outlineColor: '&H00000000',
    outline: 1,
  },
  neon: {
    fontName: 'Arial',
    fontSize: 80,
    fontWeight: 'bold',
    primaryColor: '&H00FCABF0', // Pink/purple (BGR)
    outlineColor: '&H00D346EF', // Magenta glow
    outline: 4,
  },
  vintage: {
    fontName: 'Georgia',
    fontSize: 75,
    fontWeight: 'normal',
    primaryColor: '&H00C7F3FE', // Cream/sepia (BGR)
    outlineColor: '&H000F3578', // Brown
    outline: 2,
  },
  blood: {
    fontName: 'Impact',
    fontSize: 90,
    fontWeight: 'bold',
    primaryColor: '&H001D1D7F', // Dark red (BGR)
    outlineColor: '&H000A0A45', // Darker red
    outline: 4,
  },
  typewriter: {
    fontName: 'Courier New',
    fontSize: 65,
    fontWeight: 'normal',
    primaryColor: '&H00D1D5DB', // Light gray
    outlineColor: '&H00000000',
    outline: 2,
  },
  shadow: {
    fontName: 'Arial',
    fontSize: 85,
    fontWeight: 'bold',
    primaryColor: '&H00FFFFFF', // White
    outlineColor: '&H00000000', // Black
    outline: 5,
  },
  comic: {
    fontName: 'Comic Sans MS',
    fontSize: 80,
    fontWeight: 'bold',
    primaryColor: '&H0024BFFB', // Yellow (BGR)
    outlineColor: '&H00000000', // Black
    outline: 4,
  },
};

/**
 * Convert timestamp to ASS format (H:MM:SS.cc)
 */
function toASSTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Create ASS subtitle file from captions — CHUNKED with active-word highlighting
 *
 * Instead of flashing one word at a time, groups words into 2-4 word chunks.
 * The full chunk is displayed for its entire duration. Within the chunk, the
 * currently-spoken word is highlighted in a different color (yellow by default)
 * while the other words remain white. This:
 *   - Matches the style of top viral Shorts/Reels/TikToks
 *   - Hides small timing offsets (±100ms invisible when chunk is on screen 0.5-1s)
 *   - Gives viewers time to read ahead
 *   - Looks more professional than single-word flash
 */
async function createASSSubtitles(captions, outputPath, options = {}) {
  const {
    captionStyle = 'bold',
    highlightScary = true,
    wordsPerChunk = 3,       // 2-4 words per chunk feels best
    subtitleConfig = null,   // v6.0: Full subtitle config from get_subtitle_config_for_job()
  } = options;

  // v6.0: If subtitleConfig is provided, it takes precedence over individual options
  const resolvedStyle = subtitleConfig?.style || captionStyle;
  const resolvedHighlightScary = subtitleConfig?.highlight_scary ?? highlightScary;
  const resolvedWordsPerChunk = subtitleConfig?.words_per_chunk ?? wordsPerChunk;
  const resolvedEmphasisScale = subtitleConfig?.emphasis_scale ?? 110;
  const resolvedPosition = subtitleConfig?.position || 'bottom';
  
  const style = CAPTION_STYLES[resolvedStyle] || CAPTION_STYLES.bold;
  
  // Get style colors — subtitle_config can override font_size
  const fontSize = subtitleConfig?.font_size || style.fontSize;
  const primaryColor = style.primaryColor || '&H00FFFFFF';   // White (default text)
  const outlineColor = style.outlineColor || '&H00000000';   // Black outline
  const outlineWidth = style.outline || 4;
  const isItalic = style.italic ? 1 : 0;
  const fontBold = style.fontWeight === 'bold' ? 1 : 0;
  
  // Highlight color for active word — configurable via subtitle_config
  const highlightColor = subtitleConfig?.highlight_color || '&H0000FFFF';  // Yellow (BGR)
  // Scary word color — configurable via subtitle_config
  const scaryColor = subtitleConfig?.scary_color || '&H001D1DFF';      // Bright red (BGR)

  // Position: convert position name to MarginV value
  // bottom=400 (original), center=700, top=1100
  const marginV = resolvedPosition === 'top' ? 1100
    : resolvedPosition === 'center' ? 700
    : 400; // bottom (default)
  
  // Alignment: 2=bottom-center, 5=center, 8=top-center
  const alignment = resolvedPosition === 'top' ? 8
    : resolvedPosition === 'center' ? 5
    : 2; // bottom (default)

  console.log(`  📝 Subtitle config: style=${resolvedStyle}, fontSize=${fontSize}, position=${resolvedPosition}(marginV=${marginV}), scary=${resolvedHighlightScary}, words/chunk=${resolvedWordsPerChunk}, emphasisScale=${resolvedEmphasisScale}`);
  
  // ASS header
  const header = `[Script Info]
Title: Horror Story Captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontName},${fontSize},${primaryColor},&H000000FF,${outlineColor},&H80000000,${fontBold},${isItalic},0,0,100,100,0,0,1,${outlineWidth},2,${alignment},30,30,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  
  // === Build chunks ===
  const chunks = [];
  for (let i = 0; i < captions.length; i += resolvedWordsPerChunk) {
    const chunkWords = captions.slice(i, i + resolvedWordsPerChunk);
    if (chunkWords.length === 0) continue;
    
    // Chunk timing: first word start → last word end
    const chunkStart = chunkWords[0].start;
    const chunkEnd = chunkWords[chunkWords.length - 1].end;
    
    chunks.push({
      words: chunkWords,
      start: chunkStart,
      end: chunkEnd,
    });
  }
  
  const events = [];
  
  for (const chunk of chunks) {
    const chunkStartASS = toASSTime(chunk.start);
    const chunkEndASS = toASSTime(chunk.end);
    
    // For each word in the chunk, create a dialogue line that shows
    // the FULL chunk text, but with the active word highlighted.
    // Each word gets its own time slice within the chunk's total duration.
    for (let wIdx = 0; wIdx < chunk.words.length; wIdx++) {
      const wordCap = chunk.words[wIdx];
      const wordStart = toASSTime(wordCap.start);
      // Word end: use next word's start if available, else chunk end
      const wordEnd = wIdx < chunk.words.length - 1 
        ? toASSTime(chunk.words[wIdx + 1].start)
        : chunkEndASS;
      
      // Build the full chunk text with the active word highlighted
      const textParts = [];
      for (let j = 0; j < chunk.words.length; j++) {
        const w = chunk.words[j].word || '';
        const escapedWord = w.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
        const cleanWord = w.toLowerCase().replace(/[^a-z]/g, '');
        
        if (j === wIdx) {
          // === ACTIVE WORD: highlighted + slight scale up ===
          const isScary = resolvedHighlightScary && SCARY_WORDS.has(cleanWord);
          const activeColor = isScary ? scaryColor : highlightColor;
          textParts.push(`{\\c${activeColor}\\fscx${resolvedEmphasisScale}\\fscy${resolvedEmphasisScale}}${escapedWord}{\\c${primaryColor}\\fscx100\\fscy100}`);
        } else {
          // Inactive word: default color
          const isScary = resolvedHighlightScary && SCARY_WORDS.has(cleanWord);
          if (isScary) {
            textParts.push(`{\\c${scaryColor}}${escapedWord}{\\c${primaryColor}}`);
          } else {
            textParts.push(escapedWord);
          }
        }
      }
      
      const fullText = textParts.join(' ');
      events.push(`Dialogue: 0,${wordStart},${wordEnd},Default,,0,0,0,,${fullText}`);
    }
  }
  
  const assContent = header + events.join('\n');
  await fs.writeFile(outputPath, assContent, 'utf8');
  console.log(`  ✓ Created ASS subtitle file: ${chunks.length} chunks, ${events.length} events (${captions.length} words, ${resolvedWordsPerChunk}/chunk, style=${resolvedStyle})`);
  
  return outputPath;
}

/**
 * Burn subtitles into video using FFmpeg
 * Optimized for speed in low memory mode
 */
async function burnSubtitles(inputPath, assPath, outputPath, lowMemory = false) {
  return new Promise((resolve, reject) => {
    // Use ass filter to burn subtitles
    // Need to escape colons and backslashes in Windows paths
    const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    
    // Low memory: use superfast preset with optimized settings
    const outputOptions = lowMemory ? [
      '-c:v', 'libx264',
      '-preset', 'superfast',
      '-tune', 'fastdecode',
      '-crf', '24',
      '-c:a', 'copy',
      '-threads', '2',
    ] : [
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-c:a', 'copy',
    ];
    
    ffmpeg(inputPath)
      .videoFilter(`ass='${escapedAssPath}'`)
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('start', (cmd) => console.log(`  → Burning subtitles (lowMemory: ${lowMemory})...`))
      .on('end', resolve)
      .on('error', (err, stdout, stderr) => {
        console.error('Subtitle burn error:', err.message);
        console.error('stderr:', stderr);
        reject(err);
      })
      .run();
  });
}

// =====================================================
// API ENDPOINTS
// =====================================================

/**
 * POST /render - Start a new render job
 * 
 * v3.0: Now accepts visual_dna for deterministic aesthetics
 */
app.post('/render', requireAuth, async (req, res) => {
  // Check capacity
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    return res.status(503).json({ 
      error: 'Server busy - try again in 60 seconds',
      retry_after: 60,
    });
  }
  
  const jobId = uuidv4();
  
  try {
    const {
      images,           // Array of image URLs (or base64 data URLs)
      audio_url,        // Audio file URL (narration)
      music_url,        // Background music URL (optional)
      music_volume = 15, // Music volume (0-100, default 15%)
      music_config = null, // Background Music V1: { ducking: { enabled, duck_volume, attack_ms, release_ms }, fade: { in_ms, out_ms } }
      durations,        // Duration for each image in seconds
      audio_duration = 0, // v7.1: Total audio duration in seconds (used for gameplay trim)
      captions = [],    // Word-by-word captions: [{ word, start, end }, ...]
      effects = {},     // { kenBurns, vignette, horrorGrade, filmGrain, fadeTransitions, captionStyle, highlightScary }
      mood_levels = [], // Per-scene mood intensity (1-10) for intelligent Ken Burns selection
      webhook_url,      // Optional callback URL when done
      job_id: supabaseJobId, // Original Supabase job ID for updating
      low_memory = false, // Enable low memory mode for free tier hosting
      visual_dna = null,  // v3.0: Visual DNA for deterministic aesthetic binding
      effects_profile = null, // v3.1: Effects profile with intensity controls (0-1)
      effects_config = null,  // v4.0: Controlled Motion effects config from get_effects_config_for_job()
      subtitle_config = null, // v6.0: Per-brand subtitle styling from get_subtitle_config_for_job()
      background_video_url = null,  // v7.0: Gameplay/background video URL (replaces images)
      background_video_offset = 0,  // v7.0: Start offset in seconds for background video trim
    } = req.body;
    
    const isGameplayMode = !!background_video_url;
    
    if (!isGameplayMode && (!images || images.length === 0)) {
      return res.status(400).json({ error: 'No images or background_video_url provided' });
    }
    
    if (isGameplayMode) {
      console.log(`[${jobId}] 🎮 GAMEPLAY MODE: background video @ offset ${background_video_offset}s`);
      console.log(`[${jobId}]   Video URL: ${background_video_url.slice(0, 100)}...`);
      console.log(`[${jobId}]   Audio: ${audio_url ? 'yes' : 'no'}, Captions: ${captions.length} words`);
    } else {
      console.log(`[${jobId}] New render job: ${images.length} images, audio: ${audio_url ? 'yes' : 'no'}, music: ${music_url ? 'yes' : 'no'}, captions: ${captions.length} words`);
    }
    console.log(`[${jobId}] Effects:`, effects);
    console.log(`[${jobId}] Mood levels: ${mood_levels.length > 0 ? mood_levels.join(', ') : 'not provided (using defaults)'}`);
    console.log(`[${jobId}] Supabase job: ${supabaseJobId || 'none'}`);
    
    // v3.1: Log effects profile if provided (with fail-soft on invalid data)
    let safeEffectsProfile = null;
    if (effects_profile) {
      try {
        // Validate it's an object with expected structure
        if (typeof effects_profile === 'object' && !Array.isArray(effects_profile)) {
          safeEffectsProfile = effects_profile;
          console.log(`[${jobId}] 🎛️ Effects Profile v1.0 provided (schema_version: ${effects_profile.schema_version || 'unknown'}):`);
          const activeEffects = [];
          if (effects_profile.kenburns?.enabled) activeEffects.push(`kenburns(${((effects_profile.kenburns.intensity || 0) * 100).toFixed(0)}%)`);
          if (effects_profile.vignette?.enabled) activeEffects.push(`vignette(${((effects_profile.vignette.intensity || 0) * 100).toFixed(0)}%)`);
          if (effects_profile.film_grain?.enabled) activeEffects.push(`grain(${((effects_profile.film_grain.intensity || 0) * 100).toFixed(0)}%)`);
          if (effects_profile.scanlines?.enabled) activeEffects.push(`scanlines(${((effects_profile.scanlines.intensity || 0) * 100).toFixed(0)}%)`);
          if (effects_profile.vhs?.enabled) activeEffects.push(`vhs(${((effects_profile.vhs.intensity || 0) * 100).toFixed(0)}%)`);
          if (effects_profile.glitch?.enabled) activeEffects.push(`glitch(${((effects_profile.glitch.intensity || 0) * 100).toFixed(0)}%)`);
          console.log(`[${jobId}]   Active: ${activeEffects.join(', ') || 'none'}`);
        } else {
          console.warn(`[${jobId}] ⚠️ Invalid effects_profile format (not an object), ignoring`);
        }
      } catch (err) {
        console.warn(`[${jobId}] ⚠️ Failed to process effects_profile, continuing without:`, err.message);
        safeEffectsProfile = null;
      }
    }
    
    // v3.0: Log Visual DNA if provided
    if (visual_dna) {
      console.log(`[${jobId}] 🎨 Visual DNA provided:`);
      console.log(`[${jobId}]   Style: ${visual_dna.visual_style}`);
      console.log(`[${jobId}]   Palette: ${visual_dna.color_palette}`);
      console.log(`[${jobId}]   Motion: ${visual_dna.motion_profile}`);
      console.log(`[${jobId}]   Platform: ${visual_dna.platform}`);
    }
    
    // v4.0: Validate and log effects_config (Controlled Motion)
    // v4.1: Normalize + clamp effects_config at the entry gate.
    // normalizeEffectsConfig() guarantees every numeric field is a finite number
    // within safe FFmpeg ranges. Individual builders can then trust the values.
    let safeEffectsConfig = null;
    if (effects_config) {
      try {
        safeEffectsConfig = normalizeEffectsConfig(effects_config);
        if (safeEffectsConfig) {
          console.log(`[${jobId}] 🎛️ Effects Config v2.0 (Controlled Motion):`);
          console.log(`[${jobId}]   enabled=${safeEffectsConfig.enabled}, master_intensity=${safeEffectsConfig.intensity}`);
          const ecParts = [];
          if (safeEffectsConfig.kenburns?.enabled) ecParts.push(`kb(${safeEffectsConfig.kenburns.direction || 'alt'})`);
          if (safeEffectsConfig.grain?.enabled) ecParts.push(`grain(${((safeEffectsConfig.grain.intensity || 0) * 100).toFixed(0)}%)`);
          if (safeEffectsConfig.flicker?.enabled) ecParts.push(`flicker(${((safeEffectsConfig.flicker.intensity || 0) * 100).toFixed(0)}%)`);
          if (safeEffectsConfig.vignette?.enabled) ecParts.push(`vignette(${((safeEffectsConfig.vignette.intensity || 0) * 100).toFixed(0)}%)`);
          if (safeEffectsConfig.color_grade?.enabled) ecParts.push(`cg(${safeEffectsConfig.color_grade.preset || 'auto'})`);
          console.log(`[${jobId}]   Active: ${ecParts.join(', ') || 'none (all disabled)'}`);
          // Log brand-level ceilings if any were applied
          if (safeEffectsConfig._limits_applied?.length > 0) {
            console.log(`[${jobId}]   🔒 Brand ceilings applied: ${safeEffectsConfig._limits_applied.join(', ')}`);
          }
        } else {
          console.warn(`[${jobId}] ⚠️ Invalid effects_config format, ignoring`);
        }
      } catch (err) {
        console.warn(`[${jobId}] ⚠️ Failed to normalize effects_config:`, err.message);
        safeEffectsConfig = null;
      }
    }
    
    if (music_url) {
      console.log(`[${jobId}] Background music at ${music_volume}% volume${music_config?.ducking?.enabled ? ', ducking ON' : ''}${music_config?.fade?.in_ms ? `, fade-in ${music_config.fade.in_ms}ms` : ''}${music_config?.fade?.out_ms ? `, fade-out ${music_config.fade.out_ms}ms` : ''}`);
    }

    // v6.0: Log subtitle config if provided
    let safeSubtitleConfig = null;
    if (subtitle_config && typeof subtitle_config === 'object') {
      safeSubtitleConfig = subtitle_config;
      console.log(`[${jobId}] 📝 Subtitle Config: style=${subtitle_config.style || 'bold'}, fontSize=${subtitle_config.font_size || 'default'}, position=${subtitle_config.position || 'bottom'}, scary=${subtitle_config.highlight_scary ?? true}`);
    }
    
    // Initialize job
    jobs.set(jobId, {
      id: jobId,
      supabase_job_id: supabaseJobId,
      status: 'downloading',
      progress: 0,
      created_at: new Date().toISOString(),
      url: null,
      supabase_url: null,
      error: null,
    });
    
    res.json({ 
      success: true, 
      job_id: jobId,
      status_url: `/status/${jobId}`,
    });
    
    // Process asynchronously (now with visual_dna, effects_profile, effects_config, music_config, subtitle_config, and background_video)
    processRender(jobId, images || [], audio_url, durations || [], captions, effects, webhook_url, supabaseJobId, low_memory, music_url, music_volume, mood_levels, visual_dna, safeEffectsProfile, music_config, safeEffectsConfig, safeSubtitleConfig, background_video_url, background_video_offset, audio_duration);
    
  } catch (error) {
    console.error('[RENDER] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Async render processing
 * v3.0: Now accepts visualDNA for deterministic aesthetic binding
 * v3.1: Now accepts effectsProfile for intensity-based effect controls
 * v3.2: Now accepts musicConfig for ducking + fade (Background Music V1)
 * v4.0: Now accepts effectsConfig for controlled motion (Roadmap #15)
 * v6.0: Now accepts subtitleConfig for per-brand subtitle styling (Roadmap #14)
 * 
 * @param moodLevels - Array of mood intensities (1-10) for each scene, for intelligent Ken Burns selection
 * @param visualDNA - Visual DNA object for FFmpeg filter binding
 * @param effectsProfile - Effects profile with intensity controls (0-1 scale)
 * @param musicConfig - Music mixing config: { ducking: { enabled, duck_volume, attack_ms, release_ms }, fade: { in_ms, out_ms } }
 * @param effectsConfig - Controlled motion config from get_effects_config_for_job()
 * @param subtitleConfig - Per-brand subtitle styling from get_subtitle_config_for_job()
 * @param backgroundVideoUrl - Background video URL for gameplay mode (replaces images)
 * @param backgroundVideoOffset - Start offset in seconds for background video trim
 */
async function processRender(jobId, imageUrls, audioUrl, durations, captions, effects, webhookUrl, supabaseJobId, lowMemory, musicUrl = null, musicVolume = 15, moodLevels = [], visualDNA = null, effectsProfile = null, musicConfig = null, effectsConfig = null, subtitleConfig = null, backgroundVideoUrl = null, backgroundVideoOffset = 0, audioDuration = 0) {
  activeRenders++;
  const jobDir = path.join(TEMP_DIR, jobId);
  await fs.mkdir(jobDir, { recursive: true });
  
  // Auto-enable low memory mode if on cloud free tier
  const useLowMemory = lowMemory || AUTO_LOW_MEMORY;
  if (useLowMemory) {
    console.log(`[${jobId}] ⚠️ Low memory mode ENABLED (Cloud: ${IS_RENDER ? 'Render.com' : IS_RAILWAY ? 'Railway' : 'env'})`);
  }
  
  // v3.0: Build FFmpeg filter chain from Visual DNA
  let dnaFilters = null;
  let dnaEffectFlags = {};
  let dnaMotionOverride = null;
  
  if (visualDNA) {
    console.log(`[${jobId}] 🎨 Building FFmpeg filters from Visual DNA...`);
    const dnaConfig = buildFFmpegFiltersFromVisualDNA(visualDNA, { lowMemory: useLowMemory });
    dnaFilters = dnaConfig.filters;
    dnaMotionOverride = dnaConfig.kenBurnsOverride;
    dnaEffectFlags = getEffectFlagsFromVisualDNA(visualDNA);
    
    console.log(`[${jobId}]   DNA filters: ${dnaFilters.length}`);
    console.log(`[${jobId}]   DNA motion override: ${dnaMotionOverride?.profile || 'none'}`);
    console.log(`[${jobId}]   DNA effect flags: vignette=${dnaEffectFlags.vignette}, horrorGrade=${dnaEffectFlags.horrorGrade}, filmGrain=${dnaEffectFlags.filmGrain}`);
  }
  
  // Merge DNA effect flags with explicit effects (explicit wins)
  // BUT if effectsProfile is provided with all disabled, it takes precedence
  let mergedEffects = { ...dnaEffectFlags, ...effects };

  // Diagnostic: log legacy flags BEFORE CM override
  console.log(`[${jobId}]   Legacy flags: vignette=${mergedEffects.vignette}, horrorGrade=${mergedEffects.horrorGrade}, filmGrain=${mergedEffects.filmGrain}`);
  console.log(`[${jobId}]   effectsConfig: ${effectsConfig ? `enabled=${effectsConfig.enabled}, type=${typeof effectsConfig}` : 'null'}`);
  
  // v4.0: If effectsConfig (Controlled Motion) is provided, it takes highest precedence
  // and replaces the legacy individual-effect pipeline
  let controlledMotionConfig = null;
  let controlledMotionFilters = null;  // Post-processing filter chain from effects_config
  let controlledMotionFade = null;     // Fade config from effects_config
  
  if (effectsConfig && typeof effectsConfig === 'object' && effectsConfig.enabled !== false) {
    console.log(`[${jobId}] 🎬 Controlled Motion v2.0 ACTIVE — effects_config drives the render pipeline`);
    
    // Build the post-processing filter chain (applies after concat + audio)
    // WRAPPED in try/catch: if filter construction fails, fall back to legacy pipeline
    try {
      const cmResult = buildFiltersFromEffectsConfig(effectsConfig, {
        lowMemory: useLowMemory,
        seed: supabaseJobId || jobId,
        sceneIndex: 0,  // For flicker phase; recalculated per-scene for KB
        width: 1080,
        height: 1920,
      });
      
      controlledMotionConfig = effectsConfig;
      controlledMotionFilters = cmResult.postFilters;
      controlledMotionFade = cmResult.fadeConfig;
      
      console.log(`[${jobId}]   Post-filters: ${controlledMotionFilters.length} (${controlledMotionFilters.map(f => f.substring(0, 30)).join(', ')})`);
      console.log(`[${jobId}]   Fade: in=${controlledMotionFade?.fade_in}, out=${controlledMotionFade?.fade_out}, dur=${controlledMotionFade?.duration}s`);
      
      // Override legacy mergedEffects — Controlled Motion disables legacy effect passes
      // because it handles kenBurns, vignette, grain, flicker, color grade itself
      mergedEffects.vignette = false;
      mergedEffects.horrorGrade = false;
      mergedEffects.filmGrain = false;
      mergedEffects.glitchFlicker = false;
      mergedEffects.vhsTracking = false;
      mergedEffects.scanlines = false;
      mergedEffects.lightFlicker = false;
      mergedEffects.coldColorCreep = false;
      mergedEffects.heartbeatZoom = false;
      mergedEffects.negativeFlash = false;
      mergedEffects.edgeDarkeningCreep = false;
      
      // Ken Burns is handled per-scene by controlledMotionConfig, 
      // but keep mergedEffects.kenBurns for the existing createVideoFromImages flow
      mergedEffects.kenBurns = effectsConfig.kenburns?.enabled !== false;
      
      // Fade is handled below by controlledMotionFade
      if (controlledMotionFade) {
        mergedEffects.fadeIn = controlledMotionFade.fade_in;
        mergedEffects.fadeOut = controlledMotionFade.fade_out;
        mergedEffects.fadeDuration = controlledMotionFade.duration;
      }
    } catch (cmBuildErr) {
      // SOFT FAIL: if filter construction crashes, fall back to legacy pipeline
      console.warn(`[${jobId}] ⚠️ Controlled Motion filter build FAILED — falling back to legacy pipeline:`, cmBuildErr.message);
      controlledMotionConfig = null;
      controlledMotionFilters = null;
      controlledMotionFade = null;
      // mergedEffects stays as-is (DNA + explicit effects) → legacy pipeline fires normally
    }
  } else if (effectsConfig && effectsConfig.enabled === false) {
    // IMPORTANT: enabled=false means "skip Controlled Motion" only.
    // Legacy pipeline (Visual DNA, effectsProfile, explicit effects flags) continues unchanged.
    // This ensures baseline parity: effects_config.enabled=false → same output as no effects_config.
    console.log(`[${jobId}] 🎬 Controlled Motion: DISABLED (enabled=false) — legacy pipeline unchanged`);
    // controlledMotionConfig stays null → legacy effects fire normally
  }
  
  // v3.2: If effectsProfile is provided, use it to override legacy flags
  // This ensures custom mode with disabled effects actually disables them
  if (effectsProfile && typeof effectsProfile === 'object') {
    // Override kenBurns
    if (effectsProfile.kenburns && effectsProfile.kenburns.enabled === false) {
      mergedEffects.kenBurns = false;
      console.log(`[${jobId}] 🎛️ effectsProfile: kenBurns DISABLED (intensity=${effectsProfile.kenburns.intensity})`);
    }
    // Override vignette
    if (effectsProfile.vignette && effectsProfile.vignette.enabled === false) {
      mergedEffects.vignette = false;
      console.log(`[${jobId}] 🎛️ effectsProfile: vignette DISABLED`);
    }
    // Override film grain
    if (effectsProfile.film_grain && effectsProfile.film_grain.enabled === false) {
      mergedEffects.filmGrain = false;
      console.log(`[${jobId}] 🎛️ effectsProfile: filmGrain DISABLED`);
    }
    // Override color grade / horror grade
    if (effectsProfile.color_grade && effectsProfile.color_grade.enabled === false) {
      mergedEffects.horrorGrade = false;
      console.log(`[${jobId}] 🎛️ effectsProfile: horrorGrade/colorGrade DISABLED`);
    }
    // Override scanlines
    if (effectsProfile.scanlines && effectsProfile.scanlines.enabled === false) {
      mergedEffects.scanlines = false;
      console.log(`[${jobId}] 🎛️ effectsProfile: scanlines DISABLED`);
    }
    // Override VHS
    if (effectsProfile.vhs && effectsProfile.vhs.enabled === false) {
      mergedEffects.vhsTracking = false;
      console.log(`[${jobId}] 🎛️ effectsProfile: vhsTracking DISABLED`);
    }
    // Override glitch
    if (effectsProfile.glitch && effectsProfile.glitch.enabled === false) {
      mergedEffects.glitchFlicker = false;
      console.log(`[${jobId}] 🎛️ effectsProfile: glitchFlicker DISABLED`);
    }
    // Override light flicker
    if (effectsProfile.light_flicker && effectsProfile.light_flicker.enabled === false) {
      mergedEffects.lightFlicker = false;
      console.log(`[${jobId}] 🎛️ effectsProfile: lightFlicker DISABLED`);
    }
    // Override fade
    if (effectsProfile.fade) {
      if (effectsProfile.fade.fade_in === false) {
        mergedEffects.fadeIn = false;
        console.log(`[${jobId}] 🎛️ effectsProfile: fadeIn DISABLED`);
      }
      if (effectsProfile.fade.fade_out === false) {
        mergedEffects.fadeOut = false;
        console.log(`[${jobId}] 🎛️ effectsProfile: fadeOut DISABLED`);
      }
    }
  }
  
  const startTime = Date.now();
  const timings = {};
  
  // Track applied effects with timing info
  const appliedEffects = [];
  let currentTimeOffset = 0; // Track where we are in the video timeline
  
  try {
    const job = jobs.get(jobId);
    
    // Detect gameplay mode
    const isGameplayMode = !!backgroundVideoUrl;
    let rawVideoPath;
    
    if (isGameplayMode) {
      // =====================================================
      // GAMEPLAY MODE: Download + trim background video
      // =====================================================
      const downloadStart = Date.now();
      console.log(`[${jobId}] 🎮 Downloading gameplay video...`);
      const gameplayPath = path.join(jobDir, 'gameplay_source.mp4');
      await downloadFile(backgroundVideoUrl, gameplayPath);
      job.progress = 15;
      console.log(`[${jobId}] ✓ Gameplay video downloaded`);
      timings.download = Date.now() - downloadStart;
      
      // Get audio duration for trim length (or use video estimation)
      let trimDuration = 60; // default
      if (audioDuration > 0) {
        // v7.1: Prefer explicit audio_duration from worker (most accurate)
        trimDuration = audioDuration;
        console.log(`[${jobId}]   Using explicit audio_duration: ${trimDuration}s`);
      } else if (durations && durations.length > 0) {
        trimDuration = durations.reduce((a, b) => a + b, 0);
        console.log(`[${jobId}]   Using durations sum: ${trimDuration}s`);
      } else {
        console.log(`[${jobId}]   ⚠️ No audio_duration or durations — using default ${trimDuration}s`);
      }
      if (audioUrl) {
        // Probe source video duration (informational only)
        try {
          const probeResult = await new Promise((resolve, reject) => {
            const proc = require('child_process').execFile('ffprobe', [
              '-v', 'quiet', '-print_format', 'json', '-show_format', gameplayPath
            ], (err, stdout) => {
              if (err) return reject(err);
              try { resolve(JSON.parse(stdout)); } catch(e) { reject(e); }
            });
          });
          const sourceDuration = parseFloat(probeResult?.format?.duration || '0');
          console.log(`[${jobId}]   Source video duration: ${sourceDuration.toFixed(1)}s`);
        } catch (probeErr) {
          console.log(`[${jobId}]   ⚠️ Probe failed (non-fatal): ${probeErr.message}`);
        }
      }
      
      // Trim the gameplay video from offset for trimDuration + 2s buffer
      const videoStart = Date.now();
      console.log(`[${jobId}] 🎮 Trimming gameplay: offset=${backgroundVideoOffset}s, duration=${trimDuration}s`);
      rawVideoPath = path.join(jobDir, 'raw.mp4');
      
      const { execFile } = require('child_process');
      const GAMEPLAY_TRIM_TIMEOUT_MS = 5 * 60 * 1000; // 5 min timeout (matches other FFmpeg calls)
      await new Promise((resolve, reject) => {
        let timedOut = false;
        // Use -ss before -i for fast seek, then -t for duration
        // Scale to 1080x1920 (portrait) if needed, with padding
        const args = [
          '-ss', String(backgroundVideoOffset),
          '-i', gameplayPath,
          '-t', String(trimDuration + 1), // +1s buffer
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black',
          '-c:v', 'libx264',
          '-preset', useLowMemory ? 'ultrafast' : 'fast',
          '-crf', '23',
          '-an', // Remove original audio — we'll add narration
          '-y',
          rawVideoPath,
        ];
        
        console.log(`[${jobId}]   FFmpeg trim: ffmpeg ${args.join(' ')}`);
        const proc = execFile('ffmpeg', args, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
          clearTimeout(timeoutHandle);
          if (timedOut) return; // Already rejected by timeout
          if (err) {
            console.error(`[${jobId}]   FFmpeg trim error: ${stderr?.slice(-500)}`);
            return reject(new Error(`Gameplay trim failed: ${err.message}`));
          }
          resolve();
        });
        const timeoutHandle = setTimeout(() => {
          timedOut = true;
          console.error(`[${jobId}] ⚠️ Gameplay trim timed out after 5 minutes, killing FFmpeg`);
          proc.kill('SIGKILL');
          reject(new Error('Gameplay trim timed out after 5 minutes'));
        }, GAMEPLAY_TRIM_TIMEOUT_MS);
      });
      
      // Clean up source file
      await fs.unlink(gameplayPath).catch(() => {});
      timings.createVideo = Date.now() - videoStart;
      job.progress = 50;
      console.log(`[${jobId}] ✓ Gameplay trimmed (${Math.round(timings.createVideo/1000)}s)`);
      
    } else {
      // =====================================================
      // NORMAL MODE: Download images + create video from images
      // =====================================================
    
      // Step 1: Download images (handle base64 and URLs)
      const downloadStart = Date.now();
      console.log(`[${jobId}] Downloading ${imageUrls.length} images...`);
      const imagePaths = [];
      for (let i = 0; i < imageUrls.length; i++) {
        const ext = imageUrls[i].startsWith('data:image/webp') ? 'webp' : 
                    imageUrls[i].startsWith('data:image/png') ? 'png' : 'jpg';
        const imgPath = path.join(jobDir, `image_${i}.${ext}`);
        await downloadFile(imageUrls[i], imgPath);
        imagePaths.push(imgPath);
        job.progress = Math.round((i + 1) / imageUrls.length * 20);
      }
      console.log(`[${jobId}] ✓ Images downloaded`);
      timings.download = Date.now() - downloadStart;
      job.status = 'processing';
      
      // Step 2b (images): Create video from images  
      const videoStart = Date.now();
      const useKenBurns = mergedEffects.kenBurns !== false && !DISABLE_KEN_BURNS;
      console.log(`[${jobId}] Creating video from images (lowMemory: ${useLowMemory}, kenBurns: ${useKenBurns})...`);
      rawVideoPath = path.join(jobDir, 'raw.mp4');
      await createVideoFromImages(jobId, imagePaths, durations, rawVideoPath, {
        kenBurns: useKenBurns,
        lowMemory: useLowMemory,
        moodLevels: moodLevels,
        motionOverride: dnaMotionOverride,
        effectsConfig: controlledMotionConfig,
        seed: supabaseJobId || jobId,
      });
      timings.createVideo = Date.now() - videoStart;
      job.progress = 50;
      console.log(`[${jobId}] ✓ Base video created (${Math.round(timings.createVideo/1000)}s)`);
    }
    
    // Step 3: Download audio (shared by both modes)
    let audioPath = null;
    if (audioUrl) {
      console.log(`[${jobId}] Downloading audio...`);
      audioPath = path.join(jobDir, 'audio.mp3');
      await downloadFile(audioUrl, audioPath);
      console.log(`[${jobId}] ✓ Audio downloaded`);
    }
    job.progress = isGameplayMode ? 55 : 25;
    
    // Step 4: Add audio (narration)
    let currentVideo = rawVideoPath;
    if (audioPath) {
      const audioStart = Date.now();
      console.log(`[${jobId}] Adding narration audio...`);
      const withAudioPath = path.join(jobDir, 'with_audio.mp4');
      await addAudioToVideo(currentVideo, audioPath, withAudioPath);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = withAudioPath;
      timings.addAudio = Date.now() - audioStart;
      console.log(`[${jobId}] ✓ Narration added (${Math.round(timings.addAudio/1000)}s)`);
    }
    job.progress = 55;
    
    // Step 4b: Add background music (if provided)
    // v3.2: Now with sidechain ducking + fade in/out
    // v3.2.1: Backward-compat — null/missing/disabled musicConfig handled gracefully
    if (musicUrl) {
      const musicStart = Date.now();
      console.log(`[${jobId}] Downloading background music...`);
      const musicPath = path.join(jobDir, 'music.mp3');
      try {
        // Guard: if musicConfig explicitly disables music, skip mixing
        if (musicConfig && musicConfig.enabled === false) {
          console.log(`[${jobId}] ⚠️ Music URL provided but music_config.enabled=false, skipping mix`);
        } else {
          await downloadFile(musicUrl, musicPath);
          // Validate the downloaded file exists and has content
          const musicStat = await fs.stat(musicPath).catch(() => null);
          if (!musicStat || musicStat.size < 1024) {
            throw new Error(`Music file too small or missing (${musicStat?.size || 0} bytes)`);
          }
          // Safe volume: ensure it's a valid number in range 0-100
          const safeVolume = (typeof musicVolume === 'number' && musicVolume >= 0 && musicVolume <= 100) ? musicVolume : 15;
          console.log(`[${jobId}] Adding background music at ${safeVolume}% volume (ducking=${musicConfig?.ducking?.enabled || false})...`);
          const withMusicPath = path.join(jobDir, 'with_music.mp4');
          // Calculate total video duration for fade-out timing
          const totalDuration = (durations && durations.length > 0) ? durations.reduce((a, b) => a + b, 0) : 60;
          await mixBackgroundMusic(currentVideo, musicPath, withMusicPath, safeVolume, musicConfig || null, totalDuration);
          await fs.unlink(currentVideo).catch(() => {});
          await fs.unlink(musicPath).catch(() => {});
          currentVideo = withMusicPath;
          timings.addMusic = Date.now() - musicStart;
          console.log(`[${jobId}] ✓ Background music added (${Math.round(timings.addMusic/1000)}s)`);
        }
      } catch (musicErr) {
        console.log(`[${jobId}] ⚠️ Failed to add background music: ${musicErr.message}, continuing without it`);
        // Clean up partial download
        await fs.unlink(path.join(jobDir, 'music.mp3')).catch(() => {});
      }
    }
    job.progress = 60;
    
    // Step 5: Add captions (if provided)
    if (captions && captions.length > 0) {
      const captionStart = Date.now();
      console.log(`[${jobId}] Burning ${captions.length} words as captions...`);
      const assPath = path.join(jobDir, 'captions.ass');
      await createASSSubtitles(captions, assPath, {
        captionStyle: mergedEffects.captionStyle || 'bold',
        highlightScary: mergedEffects.highlightScary !== false,
        subtitleConfig: subtitleConfig,  // v6.0: Pass full subtitle config
      });
      
      const withCaptionsPath = path.join(jobDir, 'with_captions.mp4');
      await burnSubtitles(currentVideo, assPath, withCaptionsPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      await fs.unlink(assPath).catch(() => {});
      currentVideo = withCaptionsPath;
      timings.captions = Date.now() - captionStart;
      console.log(`[${jobId}] ✓ Captions added (${Math.round(timings.captions/1000)}s)`);
    }
    job.progress = 75;
    
    // v3.0: Apply Visual DNA combined filter graph
    if (dnaFilters && dnaFilters.length > 0) {
      const dnaStart = Date.now();
      console.log(`[${jobId}] 🎨 Applying Visual DNA filters (${dnaFilters.length} filters)...`);
      const dnaGradedPath = path.join(jobDir, 'dna_graded.mp4');
      await applyVisualDNAFilters(currentVideo, dnaGradedPath, dnaFilters, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = dnaGradedPath;
      const dnaTime = Date.now() - dnaStart;
      appliedEffects.push({ 
        name: 'Visual DNA Grade', 
        category: 'DNA', 
        timeline: 'Full video', 
        duration: `0:00 - ${formatTime((durations && durations.length > 0) ? durations.reduce((s, d) => s + d, 0) : 0)}`, 
        processTime: dnaTime,
        filters: dnaFilters.slice(0, 5).join(', ') + (dnaFilters.length > 5 ? '...' : ''),
      });
      console.log(`[${jobId}] ✓ Visual DNA filters applied (${Math.round(dnaTime/1000)}s)`);
    }
    
    // Get total video duration for timeline tracking
    const totalDuration = (durations && durations.length > 0) ? durations.reduce((sum, d) => sum + d, 0) : 0;
    
    // Build scene timeline info
    let sceneTimeline = [];
    let sceneStartTime = 0;
    for (let i = 0; i < durations.length; i++) {
      const sceneEnd = sceneStartTime + durations[i];
      sceneTimeline.push({ 
        scene: i + 1, 
        start: formatTime(sceneStartTime), 
        end: formatTime(sceneEnd),
        duration: durations[i].toFixed(1),
        mood: moodLevels[i] || 'N/A'
      });
      sceneStartTime = sceneEnd;
    }
    
    // Track Ken Burns if enabled (not used in gameplay mode)
    const useKenBurns = !isGameplayMode && mergedEffects.kenBurns !== false && !DISABLE_KEN_BURNS;
    if (useKenBurns) {
      appliedEffects.push({ 
        name: dnaMotionOverride ? `Ken Burns (${dnaMotionOverride.profile})` : 'Ken Burns', 
        category: 'Animation', 
        timeline: sceneTimeline.map(s => `Scene ${s.scene}: ${s.start}-${s.end}`).join(', '),
        duration: `0:00 - ${formatTime(totalDuration)}`,
        processTime: timings.createVideo 
      });
    }
    
    // Track captions if added
    if (captions && captions.length > 0) {
      appliedEffects.push({ 
        name: `Captions (${captions.length} words)`, 
        category: 'Text', 
        timeline: 'Word-by-word sync',
        duration: `0:00 - ${formatTime(totalDuration)}`,
        processTime: timings.captions 
      });
    }
    
    // v4.0: Apply Controlled Motion post-processing filters (single pass)
    // This replaces the legacy individual effect passes when effects_config is active
    if (controlledMotionFilters && controlledMotionFilters.length > 0) {
      const cmStart = Date.now();
      console.log(`[${jobId}] 🎛️ Applying Controlled Motion filters (${controlledMotionFilters.length} filters)...`);
      const cmGradedPath = path.join(jobDir, 'cm_graded.mp4');
      try {
        await applyVisualDNAFilters(currentVideo, cmGradedPath, controlledMotionFilters, useLowMemory);
        await fs.unlink(currentVideo).catch(() => {});
        currentVideo = cmGradedPath;
        const cmTime = Date.now() - cmStart;
        appliedEffects.push({
          name: 'Controlled Motion Grade',
          category: 'Effects Config v2.0',
          timeline: 'Full video',
          duration: `0:00 - ${formatTime(totalDuration)}`,
          processTime: cmTime,
          filters: controlledMotionFilters.slice(0, 3).join(', ') + (controlledMotionFilters.length > 3 ? '...' : ''),
        });
        console.log(`[${jobId}] ✓ Controlled Motion filters applied (${Math.round(cmTime/1000)}s)`);
      } catch (cmErr) {
        // SOFT FAIL: if FFmpeg filtergraph rejects the filters, render without effects.
        // This is the #1 production hardening requirement — never let effects crash a render.
        console.warn(`[${jobId}] ⚠️ Controlled Motion filtergraph FAILED — rendering without effects (soft fail):`, cmErr.message);
        console.warn(`[${jobId}]   Failed filters: ${controlledMotionFilters.join(' | ')}`);
        // Try to clean up any partial output
        await fs.unlink(cmGradedPath).catch(() => {});
        // Continue with currentVideo as-is (no effects applied)
      }
    }
    
    // Step 6: Apply vignette (if enabled - skip if DNA already applied vignette)
    // v3.0: Skip individual effects if DNA filters already include them
    const skipVignette = dnaFilters && dnaFilters.some(f => f.includes('vignette'));
    if (mergedEffects.vignette && !skipVignette) {
      const effectStart = Date.now();
      console.log(`[${jobId}] Adding vignette...`);
      const vignettePath = path.join(jobDir, 'vignette.mp4');
      await addVignette(currentVideo, vignettePath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = vignettePath;
      const effectTime = Date.now() - effectStart;
      appliedEffects.push({ name: 'Vignette', category: 'Visual', timeline: 'Full video', duration: `0:00 - ${formatTime(totalDuration)}`, processTime: effectTime });
      console.log(`[${jobId}] ✓ Vignette added (${Math.round(effectTime/1000)}s)`);
    }
    job.progress = 85;
    
    // Step 7: Apply horror color grade (if enabled - skip if DNA already applied color grade)
    const skipHorrorGrade = dnaFilters && dnaFilters.some(f => f.startsWith('eq=') || f.startsWith('colorbalance='));
    if (mergedEffects.horrorGrade && !skipHorrorGrade) {
      const effectStart = Date.now();
      console.log(`[${jobId}] Adding horror color grade...`);
      const gradedPath = path.join(jobDir, 'graded.mp4');
      await addHorrorGrade(currentVideo, gradedPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = gradedPath;
      const effectTime = Date.now() - effectStart;
      appliedEffects.push({ name: 'Horror Grade', category: 'Color', timeline: 'Full video', duration: `0:00 - ${formatTime(totalDuration)}`, processTime: effectTime });
      console.log(`[${jobId}] ✓ Horror grade added (${Math.round(effectTime/1000)}s)`);
    }
    job.progress = 90;
    
    // Step 8: Apply film grain effect (if enabled - skip if DNA already applied noise)
    const skipFilmGrain = dnaFilters && dnaFilters.some(f => f.startsWith('noise='));
    if (mergedEffects.filmGrain && !skipFilmGrain) {
      const effectStart = Date.now();
      console.log(`[${jobId}] Adding film grain/old film effect...`);
      const grainPath = path.join(jobDir, 'grain.mp4');
      await addFilmGrain(currentVideo, grainPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = grainPath;
      const effectTime = Date.now() - effectStart;
      appliedEffects.push({ name: 'Film Grain', category: 'Disturbance', timeline: 'Full video', duration: `0:00 - ${formatTime(totalDuration)}`, processTime: effectTime });
      console.log(`[${jobId}] ✓ Film grain added (${Math.round(effectTime/1000)}s)`);
    }
    job.progress = 92;
    
    // =====================================================
    // NEW EFFECTS (Step 9+)
    // =====================================================
    
    // Glitch flicker (disturbance category)
    if (mergedEffects.glitchFlicker) {
      const effectStart = Date.now();
      console.log(`[${jobId}] Adding glitch flicker effect...`);
      const glitchPath = path.join(jobDir, 'glitch.mp4');
      await addGlitchFlicker(currentVideo, glitchPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = glitchPath;
      const effectTime = Date.now() - effectStart;
      appliedEffects.push({ name: 'Glitch Flicker', category: 'Disturbance', timeline: 'Random frames', duration: `0:00 - ${formatTime(totalDuration)}`, processTime: effectTime });
      console.log(`[${jobId}] ✓ Glitch flicker added (${Math.round(effectTime/1000)}s)`);
    }
    
    // VHS tracking wobble (disturbance category)
    if (mergedEffects.vhsTracking) {
      const effectStart = Date.now();
      console.log(`[${jobId}] Adding VHS tracking wobble...`);
      const vhsPath = path.join(jobDir, 'vhs.mp4');
      await addVHSTracking(currentVideo, vhsPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = vhsPath;
      const effectTime = Date.now() - effectStart;
      appliedEffects.push({ name: 'VHS Tracking', category: 'Disturbance', timeline: 'Full video', duration: `0:00 - ${formatTime(totalDuration)}`, processTime: effectTime });
      console.log(`[${jobId}] ✓ VHS tracking added (${Math.round(effectTime/1000)}s)`);
    }
    
    // Scanlines (disturbance category)
    if (mergedEffects.scanlines) {
      const effectStart = Date.now();
      console.log(`[${jobId}] Adding scanline overlay...`);
      const scanPath = path.join(jobDir, 'scanlines.mp4');
      await addScanlines(currentVideo, scanPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = scanPath;
      const effectTime = Date.now() - effectStart;
      appliedEffects.push({ name: 'Scanlines', category: 'Disturbance', timeline: 'Full video', duration: `0:00 - ${formatTime(totalDuration)}`, processTime: effectTime });
      console.log(`[${jobId}] ✓ Scanlines added (${Math.round(effectTime/1000)}s)`);
    }
    
    // Light flicker (atmospheric category)
    if (mergedEffects.lightFlicker) {
      const effectStart = Date.now();
      console.log(`[${jobId}] Adding light flicker effect...`);
      const flickerPath = path.join(jobDir, 'flicker.mp4');
      await addLightFlicker(currentVideo, flickerPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = flickerPath;
      const effectTime = Date.now() - effectStart;
      appliedEffects.push({ name: 'Light Flicker', category: 'Atmospheric', timeline: 'Sine wave pattern', duration: `0:00 - ${formatTime(totalDuration)}`, processTime: effectTime });
      console.log(`[${jobId}] ✓ Light flicker added (${Math.round(effectTime/1000)}s)`);
    }
    
    // Cold color creep (atmospheric category)
    if (mergedEffects.coldColorCreep) {
      const effectStart = Date.now();
      console.log(`[${jobId}] Adding cold color creep effect...`);
      const coldPath = path.join(jobDir, 'cold.mp4');
      await addColdColorCreep(currentVideo, coldPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = coldPath;
      const effectTime = Date.now() - effectStart;
      appliedEffects.push({ name: 'Cold Color Creep', category: 'Atmospheric', timeline: 'Progressive (0% → 100%)', duration: `0:00 - ${formatTime(totalDuration)}`, processTime: effectTime });
      console.log(`[${jobId}] ✓ Cold color creep added (${Math.round(effectTime/1000)}s)`);
    }
    
    // Heartbeat zoom (psychological category)
    if (mergedEffects.heartbeatZoom) {
      const effectStart = Date.now();
      console.log(`[${jobId}] Adding heartbeat zoom effect...`);
      const heartPath = path.join(jobDir, 'heartbeat.mp4');
      await addHeartbeatZoom(currentVideo, heartPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = heartPath;
      const effectTime = Date.now() - effectStart;
      appliedEffects.push({ name: 'Heartbeat Zoom', category: 'Psychological', timeline: 'Pulsing pattern', duration: `0:00 - ${formatTime(totalDuration)}`, processTime: effectTime });
      console.log(`[${jobId}] ✓ Heartbeat zoom added (${Math.round(effectTime/1000)}s)`);
    }
    
    // Negative flash (psychological category)
    if (mergedEffects.negativeFlash) {
      const effectStart = Date.now();
      console.log(`[${jobId}] Adding negative flash effect...`);
      const negPath = path.join(jobDir, 'negative.mp4');
      await addNegativeFlash(currentVideo, negPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = negPath;
      const effectTime = Date.now() - effectStart;
      appliedEffects.push({ name: 'Negative Flash', category: 'Psychological', timeline: 'Random subliminal flashes', duration: `0:00 - ${formatTime(totalDuration)}`, processTime: effectTime });
      console.log(`[${jobId}] ✓ Negative flash added (${Math.round(effectTime/1000)}s)`);
    }
    
    // Edge darkening creep (psychological category)
    if (mergedEffects.edgeDarkeningCreep) {
      const effectStart = Date.now();
      console.log(`[${jobId}] Adding edge darkening creep effect...`);
      const edgePath = path.join(jobDir, 'edge.mp4');
      await addEdgeDarkeningCreep(currentVideo, edgePath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = edgePath;
      const effectTime = Date.now() - effectStart;
      appliedEffects.push({ name: 'Edge Darkening Creep', category: 'Psychological', timeline: 'Progressive (light → heavy)', duration: `0:00 - ${formatTime(totalDuration)}`, processTime: effectTime });
      console.log(`[${jobId}] ✓ Edge darkening creep added (${Math.round(effectTime/1000)}s)`);
    }
    
    // Fade in/out (transition category) - ALWAYS LAST
    const fadeDuration = mergedEffects.fadeDuration || 1.5;
    if (mergedEffects.fadeIn || mergedEffects.fadeOut) {
      const effectStart = Date.now();
      console.log(`[${jobId}] Adding fade transitions (in: ${mergedEffects.fadeIn}, out: ${mergedEffects.fadeOut})...`);
      const fadePath = path.join(jobDir, 'faded.mp4');
      await addFadeEffect(currentVideo, fadePath, {
        fadeIn: mergedEffects.fadeIn,
        fadeOut: mergedEffects.fadeOut,
        fadeDuration: fadeDuration,
      }, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = fadePath;
      const effectTime = Date.now() - effectStart;
      
      // Build fade timeline description
      let fadeTimeline = [];
      if (mergedEffects.fadeIn) fadeTimeline.push(`Fade in: 0:00 - ${formatTime(fadeDuration)}`);
      if (mergedEffects.fadeOut) fadeTimeline.push(`Fade out: ${formatTime(totalDuration - fadeDuration)} - ${formatTime(totalDuration)}`);
      appliedEffects.push({ name: 'Fade Transitions', category: 'Transition', timeline: fadeTimeline.join(', '), duration: `${fadeDuration}s each`, processTime: effectTime });
      console.log(`[${jobId}] ✓ Fade transitions added (${Math.round(effectTime/1000)}s)`);
    }
    
    job.progress = 95;
    
    // Final step: Move to output directory
    const finalPath = path.join(OUTPUT_DIR, `${jobId}.mp4`);
    await fs.copyFile(currentVideo, finalPath);
    console.log(`[${jobId}] ✓ Final video saved locally`);
    
    // Step 8: Upload to Supabase Storage
    let supabaseUrl = null;
    if (supabase && supabaseJobId) {
      supabaseUrl = await uploadToSupabase(finalPath, supabaseJobId);
    }
    
    // Update job status
    const totalTime = Date.now() - startTime;
    job.progress = 100;
    job.status = 'complete';
    job.url = `/video/${jobId}`;
    job.supabase_url = supabaseUrl;
    
    console.log(`[${jobId}] ✅ Render complete in ${Math.round(totalTime/1000)}s!`);
    console.log(`[${jobId}]    Timings: download=${timings.download}ms, video=${timings.createVideo}ms, audio=${timings.addAudio || 0}ms, captions=${timings.captions || 0}ms`);
    console.log(`[${jobId}]    Local: ${job.url}`);
    console.log(`[${jobId}]    Supabase: ${supabaseUrl || 'N/A'}`);
    
    // Log detailed effect summary
    if (appliedEffects.length > 0) {
      console.log(`[${jobId}]`);
      console.log(`[${jobId}] 🎬 EFFECTS SUMMARY (${appliedEffects.length} effects applied)`);
      console.log(`[${jobId}] ════════════════════════════════════════════════════════════`);
      console.log(`[${jobId}]    Video Duration: ${formatTime(totalDuration)} (${totalDuration.toFixed(1)}s)`);
      console.log(`[${jobId}]`);
      
      // Scene breakdown
      console.log(`[${jobId}]    📍 SCENE BREAKDOWN`);
      sceneTimeline.forEach(s => {
        console.log(`[${jobId}]       Scene ${s.scene}: ${s.start} - ${s.end} (${s.duration}s) | Mood: ${s.mood}/10`);
      });
      console.log(`[${jobId}]`);
      
      // Group by category
      const categories = {};
      appliedEffects.forEach(e => {
        if (!categories[e.category]) categories[e.category] = [];
        categories[e.category].push(e);
      });
      
      for (const [category, categoryEffects] of Object.entries(categories)) {
        console.log(`[${jobId}]    📁 ${category.toUpperCase()}`);
        categoryEffects.forEach(e => {
          console.log(`[${jobId}]       ├─ ${e.name}`);
          console.log(`[${jobId}]       │     Timeline: ${e.timeline}`);
          console.log(`[${jobId}]       │     Duration: ${e.duration}`);
          console.log(`[${jobId}]       │     Process Time: ${Math.round(e.processTime/1000)}s`);
        });
        console.log(`[${jobId}]`);
      }
      
      // Total effect processing time
      const totalEffectTime = appliedEffects.reduce((sum, e) => sum + e.processTime, 0);
      console.log(`[${jobId}]    ⏱️  Total Effect Processing: ${Math.round(totalEffectTime/1000)}s`);
      console.log(`[${jobId}] ════════════════════════════════════════════════════════════`);
    } else {
      console.log(`[${jobId}]    No effects applied`);
    }
    
    // Update Supabase job record
    await updateJobInSupabase(jobId, supabaseJobId, 'complete', supabaseUrl);
    
    // Cleanup temp directory (keep final video)
    await fs.rm(jobDir, { recursive: true, force: true });
    
    // Webhook callback
    if (webhookUrl) {
      try {
        await axios.post(webhookUrl, {
          job_id: jobId,
          supabase_job_id: supabaseJobId,
          status: 'complete',
          url: job.url,
          supabase_url: supabaseUrl,
        });
      } catch (e) {
        console.error(`[${jobId}] Webhook failed:`, e.message);
      }
    }
    
    // Release render slot
    activeRenders--;
    
    // Schedule cleanup of output file after 1 hour
    setTimeout(async () => {
      await fs.unlink(finalPath).catch(() => {});
      jobs.delete(jobId);
      console.log(`[${jobId}] Cleaned up after 1 hour`);
    }, 60 * 60 * 1000);
    
  } catch (error) {
    console.error(`[${jobId}] ❌ Render failed:`, error);
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.error = error.message;
    }
    
    // Update Supabase job record
    await updateJobInSupabase(jobId, supabaseJobId, 'failed');
    
    // Release render slot
    activeRenders--;
    
    // Cleanup on failure
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    
    // Webhook callback for failure
    if (webhookUrl) {
      try {
        await axios.post(webhookUrl, {
          job_id: jobId,
          status: 'failed',
          error: error.message,
        });
      } catch (e) {}
    }
  }
}

// =====================================================
// PARALLEL IMAGE GENERATION
// =====================================================

// Store image generation jobs separately from render jobs
const imageJobs = new Map();

// API keys from environment
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

// Concurrency limits for parallel image generation
const MAX_PARALLEL_IMAGES = parseInt(process.env.MAX_PARALLEL_IMAGES || '4');

/**
 * Generate a single image using OpenAI GPT-4o
 * COST: low=$0.016, medium=$0.063, high=$0.25 (portrait 1024x1536)
 * Includes retry logic for transient errors (502, 503, timeouts)
 */
async function generateGPT4oImage(prompt, sceneIndex, retryCount = 0) {
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 3000; // 3 seconds base delay for retries
  
  console.log(`  [GPT-4o] Scene ${sceneIndex + 1}: Generating...${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);
  
  try {
    const response = await axios.post('https://api.openai.com/v1/images/generations', {
      model: 'gpt-image-1',
      prompt: prompt,
      n: 1,
      size: '1024x1536',
      quality: 'low',   // COST FIX: was 'high' ($0.25) → now 'low' ($0.016) = 94% savings!
      output_format: 'webp',
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 90000, // 90 second timeout per image
    });
    
    const imageData = response.data?.data?.[0];
    if (imageData?.b64_json) {
      console.log(`  [GPT-4o] Scene ${sceneIndex + 1}: ✓ Generated (base64)`);
      return `data:image/webp;base64,${imageData.b64_json}`;
    }
    if (imageData?.url) {
      console.log(`  [GPT-4o] Scene ${sceneIndex + 1}: ✓ Generated (URL)`);
      return imageData.url;
    }
    throw new Error('No image data in response');
  } catch (error) {
    const statusCode = error.response?.status;
    const isRetryable = statusCode === 502 || statusCode === 503 || statusCode === 429 || 
                        error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
    
    if (isRetryable && retryCount < MAX_RETRIES) {
      const delayMs = BASE_DELAY_MS * Math.pow(2, retryCount); // Exponential backoff
      console.log(`  [GPT-4o] Scene ${sceneIndex + 1}: ${statusCode || error.code} error, retrying in ${delayMs/1000}s...`);
      await new Promise(r => setTimeout(r, delayMs));
      return generateGPT4oImage(prompt, sceneIndex, retryCount + 1);
    }
    throw error;
  }
}

/**
 * Generate a single image using DALL-E 3
 * COST: standard=$0.08, hd=$0.12 (portrait 1024x1792)
 * Includes retry logic for transient errors (502, 503, timeouts)
 */
async function generateDallE3Image(prompt, sceneIndex, retryCount = 0) {
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 3000;
  
  console.log(`  [DALL-E 3] Scene ${sceneIndex + 1}: Generating...${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);
  
  try {
    const response = await axios.post('https://api.openai.com/v1/images/generations', {
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: '1024x1792',
      quality: 'standard',  // COST FIX: was 'hd' ($0.12) → now 'standard' ($0.08) = 33% savings
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 90000,
    });
    
    const imageData = response.data?.data?.[0];
    if (imageData?.url) {
      console.log(`  [DALL-E 3] Scene ${sceneIndex + 1}: ✓ Generated`);
      return imageData.url;
    }
    if (imageData?.b64_json) {
      return `data:image/png;base64,${imageData.b64_json}`;
    }
    throw new Error('No image data in response');
  } catch (error) {
    const statusCode = error.response?.status;
    const isRetryable = statusCode === 502 || statusCode === 503 || statusCode === 429 || 
                        error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
    
    if (isRetryable && retryCount < MAX_RETRIES) {
      const delayMs = BASE_DELAY_MS * Math.pow(2, retryCount);
      console.log(`  [DALL-E 3] Scene ${sceneIndex + 1}: ${statusCode || error.code} error, retrying in ${delayMs/1000}s...`);
      await new Promise(r => setTimeout(r, delayMs));
      return generateDallE3Image(prompt, sceneIndex, retryCount + 1);
    }
    throw error;
  }
}

/**
 * Generate a single image using FLUX Pro/Redux
 * Includes retry logic with exponential backoff for rate limits (429)
 */
async function generateFluxImage(prompt, sceneIndex, referenceImageUrl = null, retryCount = 0) {
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 5000; // 5 seconds base delay for 429 errors
  
  const isFirstScene = sceneIndex === 0 || !referenceImageUrl;
  const modelName = isFirstScene ? 'flux-1.1-pro' : 'flux-redux-dev';
  console.log(`  [FLUX] Scene ${sceneIndex + 1}: Generating with ${modelName}...${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);
  
  const endpoint = isFirstScene
    ? 'https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions'
    : 'https://api.replicate.com/v1/models/black-forest-labs/flux-redux-dev/predictions';
  
  const input = isFirstScene ? {
    prompt: prompt,
    width: 768,
    height: 1344,
    aspect_ratio: '9:16',
    output_format: 'webp',
    output_quality: 90,
    safety_tolerance: 5,
  } : {
    prompt: prompt,
    redux_image: referenceImageUrl,
    width: 768,
    height: 1344,
    aspect_ratio: '9:16',
    num_outputs: 1,
    output_format: 'webp',
    output_quality: 90,
    guidance: 3.5,
    num_inference_steps: 28,
  };
  
  try {
    const response = await axios.post(endpoint, { input }, {
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait',
      },
      timeout: 120000, // 2 minute timeout for FLUX
    });
    
    const result = response.data;
    if (result.output) {
      const imageUrl = Array.isArray(result.output) ? result.output[0] : result.output;
      console.log(`  [FLUX] Scene ${sceneIndex + 1}: ✓ Generated`);
      return imageUrl;
    }
    
    // If not immediately ready, poll for result
    if (result.id) {
      return await pollReplicatePrediction(result.id, sceneIndex);
    }
    
    throw new Error('Unexpected FLUX response format');
  } catch (error) {
    // Handle rate limit (429) with exponential backoff
    if (error.response?.status === 429 && retryCount < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, retryCount); // Exponential: 5s, 10s, 20s
      console.log(`  [FLUX] Scene ${sceneIndex + 1}: Rate limited (429), waiting ${delay/1000}s before retry...`);
      await new Promise(r => setTimeout(r, delay));
      return generateFluxImage(prompt, sceneIndex, referenceImageUrl, retryCount + 1);
    }
    throw error;
  }
}

/**
 * Poll Replicate prediction until complete
 */
async function pollReplicatePrediction(predictionId, sceneIndex) {
  const maxWait = 120000;
  const pollInterval = 2000;
  let elapsed = 0;
  
  while (elapsed < maxWait) {
    await new Promise(r => setTimeout(r, pollInterval));
    elapsed += pollInterval;
    
    const response = await axios.get(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      { headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` } }
    );
    
    if (response.data.status === 'succeeded') {
      const imageUrl = Array.isArray(response.data.output) 
        ? response.data.output[0] 
        : response.data.output;
      console.log(`  [FLUX] Scene ${sceneIndex + 1}: ✓ Completed after ${elapsed/1000}s`);
      return imageUrl;
    }
    
    if (response.data.status === 'failed' || response.data.status === 'canceled') {
      throw new Error(`FLUX prediction ${response.data.status}: ${response.data.error}`);
    }
  }
  
  throw new Error('FLUX prediction timed out');
}

/**
 * Upload image to Supabase Storage
 */
async function uploadImageToSupabase(imageSource, bucket, storagePath) {
  if (!supabase) return imageSource; // Return original if no Supabase
  
  let buffer;
  let contentType;
  
  if (imageSource.startsWith('data:')) {
    // Handle base64
    const matches = imageSource.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) throw new Error('Invalid base64 format');
    contentType = matches[1];
    buffer = Buffer.from(matches[2], 'base64');
  } else {
    // Handle URL
    const response = await axios.get(imageSource, { responseType: 'arraybuffer', timeout: 30000 });
    buffer = Buffer.from(response.data);
    contentType = response.headers['content-type'] || 'image/webp';
  }
  
  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, { contentType, upsert: true });
  
  if (error) {
    console.error(`  Failed to upload to Supabase:`, error.message);
    return imageSource; // Return original URL on failure
  }
  
  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}

/**
 * POST /generate-images - Generate all images in parallel
 * 
 * Body: {
 *   job_id: string,          // Supabase job ID for storage path
 *   scenes: Array<{
 *     index: number,
 *     prompt: string,
 *     text: string,          // Scene text for metadata
 *     start_time: number,
 *     end_time: number,
 *   }>,
 *   model: 'gpt-4o' | 'dall-e-3' | 'flux',
 *   art_style: string,       // For metadata
 *   story_anchor: object,    // For metadata (continuity rules, character)
 * }
 */
app.post('/generate-images', async (req, res) => {
  const { job_id, scenes, model = 'gpt-4o', art_style, story_anchor } = req.body;
  
  if (!job_id || !scenes || !Array.isArray(scenes) || scenes.length === 0) {
    return res.status(400).json({ error: 'Missing job_id or scenes array' });
  }
  
  // Validate API keys
  if ((model === 'gpt-4o' || model === 'dall-e-3') && !OPENAI_API_KEY) {
    return res.status(400).json({ error: 'OPENAI_API_KEY not configured on server' });
  }
  if (model === 'flux' && !REPLICATE_API_TOKEN) {
    return res.status(400).json({ error: 'REPLICATE_API_TOKEN not configured on server' });
  }
  
  const imageJobId = `img_${uuidv4().slice(0, 8)}`;
  
  console.log(`\n[IMG-${imageJobId}] Starting parallel image generation`);
  console.log(`[IMG-${imageJobId}]   Job: ${job_id}`);
  console.log(`[IMG-${imageJobId}]   Scenes: ${scenes.length}`);
  console.log(`[IMG-${imageJobId}]   Model: ${model}`);
  console.log(`[IMG-${imageJobId}]   Parallelism: ${MAX_PARALLEL_IMAGES}`);
  
  // =====================================================
  // GROUND-TRUTH LOGGING: What the server RECEIVED
  // =====================================================
  console.log(`\n========== GROUND TRUTH: SERVER RECEIVED (${scenes.length} scenes) ==========`);
  console.log(`[GROUND-TRUTH] image_job_id: ${imageJobId}`);
  console.log(`[GROUND-TRUTH] supabase_job_id: ${job_id}`);
  console.log(`[GROUND-TRUTH] model: ${model}`);
  console.log(`[GROUND-TRUTH] art_style: ${art_style}`);
  
  // Log first and last scene prompts to verify full prompts are received
  if (scenes.length > 0) {
    const first = scenes[0];
    const firstPromptLen = first.prompt?.length || 0;
    console.log(`[GROUND-TRUTH] Scene 1 prompt_len: ${firstPromptLen}`);
    console.log(`[GROUND-TRUTH] Scene 1 prompt_mode: ${first.prompt_mode || 'unknown'}`);
    console.log(`[GROUND-TRUTH] Scene 1 prompt_start: "${(first.prompt || '').substring(0, 200).replace(/\n/g, '↵')}..."`);
    console.log(`[GROUND-TRUTH] Scene 1 has_contract: ${!!first.visual_contract}`);
    console.log(`[GROUND-TRUTH] Scene 1 has_dna: ${!!first.visual_dna}`);
  }
  if (scenes.length > 1) {
    const last = scenes[scenes.length - 1];
    const lastPromptLen = last.prompt?.length || 0;
    console.log(`[GROUND-TRUTH] Scene ${scenes.length} prompt_len: ${lastPromptLen}`);
    console.log(`[GROUND-TRUTH] Scene ${scenes.length} prompt_mode: ${last.prompt_mode || 'unknown'}`);
    console.log(`[GROUND-TRUTH] Scene ${scenes.length} prompt_start: "${(last.prompt || '').substring(0, 200).replace(/\n/g, '↵')}..."`);
  }
  
  // ALERT if prompts look like keywords (too short)
  const avgPromptLen = scenes.reduce((sum, s) => sum + (s.prompt?.length || 0), 0) / scenes.length;
  if (avgPromptLen < 200) {
    console.log(`[GROUND-TRUTH] ⚠️ WARNING: Average prompt length (${avgPromptLen.toFixed(0)}) is suspiciously short - may be keywords not full prompts!`);
  } else {
    console.log(`[GROUND-TRUTH] ✓ Average prompt length: ${avgPromptLen.toFixed(0)} chars (looks like full prompts)`);
  }
  console.log(`==========================================================\n`);
  
  // Initialize job tracking
  imageJobs.set(imageJobId, {
    status: 'processing',
    total: scenes.length,
    completed: 0,
    failed: 0,
    images: [],
    errors: [],
    started_at: new Date().toISOString(),
    model: model,
  });
  
  // Return immediately with job ID
  res.json({
    success: true,
    image_job_id: imageJobId,
    status_url: `/images-status/${imageJobId}`,
    total_scenes: scenes.length,
  });
  
  // Process images asynchronously
  processImageGeneration(imageJobId, job_id, scenes, model, art_style, story_anchor);
});

/**
 * Async image generation with controlled parallelism
 */
async function processImageGeneration(imageJobId, supabaseJobId, scenes, model, artStyle, storyAnchor) {
  const job = imageJobs.get(imageJobId);
  const startTime = Date.now();
  let referenceImageUrl = null; // For FLUX character consistency
  
  try {
    // FLUX is heavily rate-limited on Replicate - use sequential generation
    // GPT-4o and DALL-E 3 can handle more parallelism
    const batchSize = model === 'flux' ? 1 : MAX_PARALLEL_IMAGES;
    const batchDelayMs = model === 'flux' ? 3000 : 1000; // 3s delay for FLUX, 1s for others
    
    console.log(`[IMG-${imageJobId}] Using batch size ${batchSize}, delay ${batchDelayMs}ms (model: ${model})`);
    
    // PROOF BUNDLE: Log Scene 1 and Scene last prompt details (v5.1)
    if (scenes.length > 0) {
      const scene1 = scenes[0];
      console.log(`\n========== PROOF BUNDLE: SERVER.JS SCENE 1 ==========`);
      console.log(`[PROOF] prompt_hash: ${scene1.prompt_hash || 'N/A'}`);
      console.log(`[PROOF] prompt_mode: ${scene1.prompt_mode}`);
      console.log(`[PROOF] prompt_len: ${scene1.prompt?.length || 0}`);
      console.log(`[PROOF] PROMPT_PREVIEW: "${scene1.prompt?.substring(0, 200)}..."`);
      console.log(`==========================================================\n`);
      
      if (scenes.length > 1) {
        const sceneLast = scenes[scenes.length - 1];
        console.log(`\n========== PROOF BUNDLE: SERVER.JS SCENE ${scenes.length} (LAST) ==========`);
        console.log(`[PROOF] prompt_hash: ${sceneLast.prompt_hash || 'N/A'}`);
        console.log(`[PROOF] prompt_mode: ${sceneLast.prompt_mode}`);
        console.log(`[PROOF] prompt_len: ${sceneLast.prompt?.length || 0}`);
        console.log(`[PROOF] PROMPT_PREVIEW: "${sceneLast.prompt?.substring(0, 200)}..."`);
        console.log(`==========================================================\n`);
      }
    }
    
    const results = new Array(scenes.length).fill(null);
    
    for (let batchStart = 0; batchStart < scenes.length; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, scenes.length);
      const batch = scenes.slice(batchStart, batchEnd);
      
      console.log(`[IMG-${imageJobId}] Processing batch ${Math.floor(batchStart/batchSize) + 1}: scenes ${batchStart + 1}-${batchEnd}`);
      
      // Generate batch in parallel
      const batchPromises = batch.map(async (scene, batchIndex) => {
        const sceneIndex = batchStart + batchIndex;
        
        try {
          let imageUrl;
          
          // GROUND-TRUTH: Log exact prompt being sent to model (v5.1)
          const promptLen = scene.prompt?.length || 0;
          const promptMode = scene.prompt_mode || 'unknown';
          const promptHash = scene.prompt_hash || 'NO_HASH';
          
          console.log(`[IMG-${imageJobId}] Scene ${sceneIndex + 1} SENDING TO ${model.toUpperCase()}: hash=${promptHash}, len=${promptLen}, mode=${promptMode}`);
          console.log(`[IMG-${imageJobId}] Scene ${sceneIndex + 1} PROMPT_PREVIEW: "${scene.prompt?.substring(0, 200)}..."`);
          
          // PROMPT QUALITY GATE: Block weak prompts (warn but don't block - let run-job handle repair)
          const isFallbackMode = ['keywords_fallback', 'text_fallback', 'anchor_only'].includes(promptMode);
          if (promptLen < 200 || isFallbackMode) {
            console.log(`[IMG-${imageJobId}] ⚠️ Scene ${sceneIndex + 1} WEAK PROMPT DETECTED:`);
            console.log(`  - Length: ${promptLen} (min: 200)`);
            console.log(`  - Mode: ${promptMode} (fallback modes: ${isFallbackMode})`);
            if (promptLen < 200) {
              console.log(`  - Full short prompt: "${scene.prompt}"`);
            }
            // NOTE: We proceed anyway - the contract/prompt should have been fixed upstream in run-job
            // This warning helps diagnose if the fix isn't working
          }
          
          // Generate image based on model
          if (model === 'gpt-4o') {
            imageUrl = await generateGPT4oImage(scene.prompt, sceneIndex);
          } else if (model === 'dall-e-3') {
            imageUrl = await generateDallE3Image(scene.prompt, sceneIndex);
          } else if (model === 'flux') {
            // FLUX: first scene uses Pro, others use Redux with reference
            imageUrl = await generateFluxImage(scene.prompt, sceneIndex, referenceImageUrl);
            // Store first scene as reference for character consistency
            if (sceneIndex === 0 && imageUrl) {
              referenceImageUrl = imageUrl;
            }
          } else {
            throw new Error(`Unknown model: ${model}`);
          }
          
          // Upload to Supabase Storage for permanent URL
          if (imageUrl && supabase) {
            const storagePath = `${supabaseJobId}/images/scene_${sceneIndex}.webp`;
            imageUrl = await uploadImageToSupabase(imageUrl, 'story-videos', storagePath);
            
            // v5.14: Save directly to job_assets for durability
            // This ensures images survive server restarts and race conditions
            // NOTE: Use delete-then-insert pattern because Supabase upsert doesn't
            // support JSONB path expressions in onConflict
            try {
              // First, delete any existing row for this scene
              const { error: deleteError } = await supabase.from('job_assets')
                .delete()
                .eq('job_id', supabaseJobId)
                .eq('type', 'dalle_image')
                .filter('meta->>scene_index', 'eq', String(sceneIndex));
              
              if (deleteError) {
                console.log(`  [IMG-${imageJobId}] Warning: delete before insert failed: ${deleteError.message}`);
              }
              
              // Then insert the new row
              const { error: assetError } = await supabase.from('job_assets').insert({
                job_id: supabaseJobId,
                type: 'dalle_image',
                storage_path: imageUrl,
                public_url: imageUrl,
                meta: {
                  scene_index: sceneIndex,
                  scene_text: scene.text,
                  keywords: scene.keywords || [],
                  start_time: scene.start_time,
                  end_time: scene.end_time,
                  source: 'parallel',
                  image_model: model,
                  art_style: artStyle,
                  dalle_prompt: scene.prompt,
                  prompt_len: promptLen,
                  prompt_hash: scene.prompt_hash || null,
                  prompt_mode: scene.prompt_mode || null,
                  visual_beat: scene.visual_beat || null,
                  visual_contract: scene.visual_contract || null,
                  visual_dna: scene.visual_dna || null,
                  mood_level: scene.mood_level || null,
                  camera_angle: scene.camera_angle || null,
                  generated_at: new Date().toISOString(),
                  is_permanent: true,
                },
              });
              
              if (assetError) {
                console.log(`  [IMG-${imageJobId}] Warning: Could not save to job_assets: ${assetError.message}`);
              } else {
                console.log(`  [IMG-${imageJobId}] ✓ Scene ${sceneIndex + 1} saved to job_assets`);
              }
            } catch (dbErr) {
              console.log(`  [IMG-${imageJobId}] Warning: job_assets save failed: ${dbErr.message}`);
            }
          }
          
          return {
            success: true,
            index: sceneIndex,
            url: imageUrl,
            meta: {
              scene_index: sceneIndex,
              scene_text: scene.text,
              keywords: scene.keywords || [],
              start_time: scene.start_time,
              end_time: scene.end_time,
              image_model: model,
              art_style: artStyle,
              dalle_prompt: scene.prompt,
              prompt_len: promptLen,
              prompt_hash: scene.prompt_hash || null,  // v5.1: Ground-truth hash
              prompt_mode: scene.prompt_mode || null,
              visual_beat: scene.visual_beat || null,
              visual_contract: scene.visual_contract || null,
              visual_dna: scene.visual_dna || null,
              mood_level: scene.mood_level || null,
              camera_angle: scene.camera_angle || null,
              generated_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          console.error(`  [IMG-${imageJobId}] Scene ${sceneIndex + 1} FAILED:`, err.message);
          return {
            success: false,
            index: sceneIndex,
            error: err.message,
          };
        }
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Store results
      for (const result of batchResults) {
        results[result.index] = result;
        if (result.success) {
          job.completed++;
          job.images.push(result);
        } else {
          job.failed++;
          job.errors.push({ index: result.index, error: result.error });
        }
      }
      
      // Update progress
      job.progress = Math.round((job.completed + job.failed) / scenes.length * 100);
      console.log(`[IMG-${imageJobId}] Progress: ${job.completed}/${scenes.length} complete, ${job.failed} failed`);
      
      // Delay between batches to avoid rate limits (longer for FLUX)
      if (batchEnd < scenes.length) {
        await new Promise(r => setTimeout(r, batchDelayMs));
      }
    }
    
    // Finalize job
    const totalTime = Math.round((Date.now() - startTime) / 1000);
    job.status = job.failed === 0 ? 'complete' : (job.completed > 0 ? 'partial' : 'failed');
    job.completed_at = new Date().toISOString();
    job.total_time_seconds = totalTime;
    
    console.log(`[IMG-${imageJobId}] ✅ Complete: ${job.completed}/${scenes.length} images in ${totalTime}s`);
    if (job.failed > 0) {
      console.log(`[IMG-${imageJobId}] ⚠️ ${job.failed} failures:`, job.errors);
    }
    
  } catch (error) {
    console.error(`[IMG-${imageJobId}] ❌ Fatal error:`, error.message);
    job.status = 'failed';
    job.error = error.message;
  }
  
  // Schedule cleanup after 30 minutes
  setTimeout(() => {
    imageJobs.delete(imageJobId);
    console.log(`[IMG-${imageJobId}] Cleaned up`);
  }, 30 * 60 * 1000);
}

/**
 * GET /images-status/:id - Check image generation job status
 */
app.get('/images-status/:id', (req, res) => {
  const job = imageJobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Image job not found' });
  }
  res.json(job);
});

/**
 * GET /status/:id - Check job status
 */
app.get('/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

/**
 * GET /video/:id - Download finished video
 */
app.get('/video/:id', (req, res) => {
  const videoPath = path.join(OUTPUT_DIR, `${req.params.id}.mp4`);
  if (!fsSync.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }
  res.download(videoPath);
});

/**
 * GET /health - Health check
 */
app.get('/health', async (req, res) => {
  // Check FFmpeg availability
  let ffmpegOk = false;
  try {
    await new Promise((resolve, reject) => {
      ffmpeg.getAvailableFormats((err, formats) => {
        if (err) reject(err);
        else resolve(formats);
      });
    });
    ffmpegOk = true;
  } catch (e) {
    console.error('FFmpeg check failed:', e.message);
  }
  
  res.json({ 
    status: 'ok',
    ffmpeg: ffmpegOk,
    supabase: !!supabase,
    active_renders: activeRenders,
    max_concurrent: MAX_CONCURRENT_RENDERS,
    uptime: Math.floor(process.uptime()),
  });
});

/**
 * GET / - API info
 */
app.get('/', (req, res) => {
  res.json({
    name: 'Horror Video Renderer',
    version: '2.1.0',
    endpoints: {
      'POST /render': 'Start a new video render job',
      'GET /status/:id': 'Check render job status',
      'GET /video/:id': 'Download finished video',
      'POST /generate-images': 'Generate images in parallel (4-6 at once)',
      'GET /images-status/:id': 'Check parallel image generation status',
      'GET /health': 'Health check',
    },
    config: {
      max_parallel_images: MAX_PARALLEL_IMAGES,
      openai_configured: !!OPENAI_API_KEY,
      replicate_configured: !!REPLICATE_API_TOKEN,
      supabase_configured: !!supabase,
    },
  });
});

// ─── Graceful shutdown ───
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n⚠️  Received ${signal} — starting graceful shutdown...`);
  console.log(`   Active renders: ${activeRenders}`);

  // Stop accepting new requests
  server.close(() => {
    console.log('   HTTP server closed');
  });

  // Wait for active renders to finish (max 5 min)
  const shutdownTimeout = setTimeout(() => {
    console.error('   ⏰ Shutdown timeout — forcing exit');
    process.exit(1);
  }, 5 * 60 * 1000);

  const checkDone = setInterval(() => {
    if (activeRenders === 0) {
      clearInterval(checkDone);
      clearTimeout(shutdownTimeout);
      console.log('   ✅ All renders complete — exiting cleanly');
      process.exit(0);
    }
    console.log(`   Waiting for ${activeRenders} active render(s)...`);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log('');
  console.log('🎬 Horror Video Renderer v2.1');
  console.log('================================');
  console.log(`   Port: ${PORT}`);
  console.log(`   Supabase: ${supabase ? '✅ Connected' : '❌ Not configured'}`);
  console.log(`   OpenAI: ${OPENAI_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`   Replicate: ${REPLICATE_API_TOKEN ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`   Max concurrent renders: ${MAX_CONCURRENT_RENDERS}`);
  console.log(`   Max parallel images: ${MAX_PARALLEL_IMAGES}`);
  console.log('');
  console.log('Endpoints:');
  console.log('   POST /render          - Start video render');
  console.log('   GET  /status/:id      - Check render status');
  console.log('   POST /generate-images - Start parallel image gen');
  console.log('   GET  /images-status/:id - Check image gen status');
  console.log('   GET  /health          - Health check');
  console.log('');
});
