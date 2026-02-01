/**
 * FFmpeg Video Renderer Service v2.0
 * 
 * Replaces Creatomate with local FFmpeg rendering.
 * Deploy to Render.com, Railway, or Fly.io.
 * 
 * Endpoints:
 *   POST /render - Start a render job
 *   GET /status/:id - Check render status
 *   GET /video/:id - Download finished video
 *   GET /health - Health check
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

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' })); // Increased for base64 images

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
 */
async function updateJobInSupabase(jobId, supabaseJobId, status, videoUrl = null) {
  if (!supabase || !supabaseJobId) return;
  
  try {
    const updates = {
      progress: status === 'complete' ? 100 : status === 'failed' ? 0 : 85,
      updated_at: new Date().toISOString(),
    };
    
    if (status === 'complete') {
      updates.status = 'complete';
    } else if (status === 'failed') {
      updates.status = 'failed';
    }
    
    await supabase.from('jobs').update(updates).eq('id', supabaseJobId);
    
    // If we have a video URL, save it to job_assets
    if (videoUrl && status === 'complete') {
      // Delete existing then insert
      await supabase.from('job_assets').delete()
        .eq('job_id', supabaseJobId)
        .eq('type', 'final_mp4');
      
      await supabase.from('job_assets').insert({
        job_id: supabaseJobId,
        type: 'final_mp4',
        storage_path: videoUrl,
        public_url: videoUrl,
        meta: { renderer: 'ffmpeg', completed_at: new Date().toISOString() },
      });
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
  const frames = Math.floor(duration * 30); // 30fps
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
  const frames = Math.floor(duration * 15); // 15fps in low memory mode
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
  const { kenBurns = true, lowMemory = false, moodLevels = [] } = options;
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
  
  for (let i = 0; i < images.length; i++) {
    const imagePath = images[i];
    const duration = durations[i] || 5;
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
        
        if (lowMemory) {
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
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        '-map', '0:v:0',
        '-map', '1:a:0',
      ])
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
 * @param {string} videoPath - Input video with existing audio (narration)
 * @param {string} musicPath - Background music file
 * @param {string} outputPath - Output video path
 * @param {number} musicVolume - Music volume as percentage (0-100)
 */
async function mixBackgroundMusic(videoPath, musicPath, outputPath, musicVolume = 15) {
  return new Promise((resolve, reject) => {
    // Convert percentage to decimal (15% = 0.15)
    const volumeDecimal = musicVolume / 100;
    
    // Use amix filter to blend existing audio with background music
    // [0:a] is video's audio (narration), [1:a] is music
    // Music is looped and faded out at the end
    ffmpeg()
      .input(videoPath)
      .input(musicPath)
      .inputOptions('-stream_loop', '-1') // Loop music infinitely
      .complexFilter([
        // Reduce music volume
        `[1:a]volume=${volumeDecimal}[music]`,
        // Mix narration (full volume) with quieter music
        '[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[out]'
      ])
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
    
    // SIMPLIFIED: Fast film grain effect that won't hang
    // Removed geq (extremely slow), simplified to core grain + flicker
    const ffmpegCommand = ffmpeg(inputPath)
      .complexFilter([
        // Simple grain + flicker combo (fast)
        '[0:v]noise=c0s=12:c0f=t+u,eq=brightness=0.02*sin(n*0.3):saturation=0.88,rgbashift=rh=-1:bh=1[final]'
      ], 'final')
      .outputOptions(outputOptions)
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
            .videoFilter('noise=c0s=10:c0f=t')
            .outputOptions(['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-c:a', 'copy'])
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        } else {
          console.error('Film grain error:', err.message);
          // Fallback to simplest possible effect
          ffmpeg(inputPath)
            .videoFilter('noise=c0s=10:c0f=t')
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
    
    // Random brightness fluctuation every ~30-60 frames with subtle RGB shift
    ffmpeg(inputPath)
      .complexFilter([
        // Random brightness spikes (subtle)
        `[0:v]eq=brightness='0.0+0.08*lt(random(1),0.02)*sin(n*0.5)':contrast=1.0+0.05*lt(random(2),0.015)[flicker]`,
        // Occasional RGB split on same random frames
        `[flicker]rgbashift=rh='2*lt(random(3),0.01)':bh='-2*lt(random(4),0.01)'[out]`
      ], 'out')
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => {
        console.error('Glitch flicker error, using fallback:', err.message);
        // Simpler fallback
        ffmpeg(inputPath)
          .videoFilter('eq=brightness=0.0+0.05*sin(n*0.3)*lt(random(1),0.03)')
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
  const TIMEOUT_MS = 3 * 60 * 1000; // 3 min timeout
  
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      console.error('⚠️ VHS tracking timed out, using fallback...');
      ffmpegCommand.kill('SIGKILL');
    }, TIMEOUT_MS);
    
    const outputOptions = lowMemory ? [
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-c:a', 'copy', '-threads', '2',
    ] : [
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'copy', '-threads', '4',
    ];
    
    // SIMPLIFIED VHS: noise + color shift (removed slow scroll filter)
    const ffmpegCommand = ffmpeg(inputPath)
      .videoFilter([
        'noise=c0s=8:c0f=t',
        'colorbalance=rs=0.03:gs=-0.02:bs=-0.03',
        'eq=saturation=0.88'
      ].join(','))
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
          .videoFilter('noise=c0s=8:c0f=t')
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
    
    // Simple brightness variation (removed random() which can be slow)
    const ffmpegCommand = ffmpeg(inputPath)
      .videoFilter('eq=brightness=0.02*sin(n*0.25)')
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
            .outputOptions(['-c:v', 'copy', '-c:a', 'copy'])
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
      .outputOptions(outputOptions)
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
    
    // SIMPLIFIED: Use hue filter for slight darkness + noise for scanline feel
    // geq is too slow, this achieves similar look without per-pixel processing
    const ffmpegCommand = ffmpeg(inputPath)
      .videoFilter([
        'noise=c0s=3:c0f=t',  // Light noise
        'eq=contrast=1.05:brightness=-0.02'  // Slight contrast boost + darken
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
            .outputOptions(['-c:v', 'copy', '-c:a', 'copy'])
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        } else {
          console.error('Scanlines error, using fallback:', err.message);
          ffmpeg(inputPath)
            .outputOptions(['-c:v', 'copy', '-c:a', 'copy'])
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
 * Create ASS subtitle file from captions
 * Word-by-word display with scary word highlighting
 */
async function createASSSubtitles(captions, outputPath, options = {}) {
  const {
    captionStyle = 'bold',
    highlightScary = true,
  } = options;
  
  const style = CAPTION_STYLES[captionStyle] || CAPTION_STYLES.bold;
  
  // Get style colors (with defaults for backward compatibility)
  const primaryColor = style.primaryColor || '&H00FFFFFF';
  const outlineColor = style.outlineColor || '&H00000000';
  const outlineWidth = style.outline || 4;
  const isItalic = style.italic ? 1 : 0;
  
  // ASS header with style definitions
  // PlayResY/PlayResX set the virtual resolution for positioning
  const header = `[Script Info]
Title: Horror Story Captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontName},${style.fontSize},${primaryColor},&H000000FF,${outlineColor},&H80000000,${style.fontWeight === 'bold' ? 1 : 0},${isItalic},0,0,100,100,0,0,1,${outlineWidth},2,2,30,30,400,1
Style: Scary,${style.fontName},${Math.round(style.fontSize * 1.1)},&H000000FF,&H000000FF,${outlineColor},&H80000000,1,0,0,0,100,100,0,0,1,${outlineWidth},2,2,30,30,400,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  
  const events = [];
  
  for (const caption of captions) {
    const word = caption.word || '';
    const cleanWord = word.toLowerCase().replace(/[^a-z]/g, '');
    const isScary = highlightScary && SCARY_WORDS.has(cleanWord);
    
    // Add small buffer to prevent gaps
    const startTime = toASSTime(caption.start);
    const endTime = toASSTime(caption.end + 0.05);
    const styleName = isScary ? 'Scary' : 'Default';
    
    // Escape special ASS characters and add pop animation
    const escapedWord = word.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
    
    // Use transform for pop-in effect
    const animatedText = `{\\fscx80\\fscy80\\t(0,80,\\fscx100\\fscy100)}${escapedWord}`;
    
    events.push(`Dialogue: 0,${startTime},${endTime},${styleName},,0,0,0,,${animatedText}`);
  }
  
  const assContent = header + events.join('\n');
  await fs.writeFile(outputPath, assContent, 'utf8');
  console.log(`  ✓ Created ASS subtitle file with ${events.length} words`);
  
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
 */
app.post('/render', async (req, res) => {
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
      durations,        // Duration for each image in seconds
      captions = [],    // Word-by-word captions: [{ word, start, end }, ...]
      effects = {},     // { kenBurns, vignette, horrorGrade, filmGrain, fadeTransitions, captionStyle, highlightScary }
      mood_levels = [], // Per-scene mood intensity (1-10) for intelligent Ken Burns selection
      webhook_url,      // Optional callback URL when done
      job_id: supabaseJobId, // Original Supabase job ID for updating
      low_memory = false, // Enable low memory mode for free tier hosting
    } = req.body;
    
    if (!images || images.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }
    
    console.log(`[${jobId}] New render job: ${images.length} images, audio: ${audio_url ? 'yes' : 'no'}, music: ${music_url ? 'yes' : 'no'}, captions: ${captions.length} words`);
    console.log(`[${jobId}] Effects:`, effects);
    console.log(`[${jobId}] Mood levels: ${mood_levels.length > 0 ? mood_levels.join(', ') : 'not provided (using defaults)'}`);
    console.log(`[${jobId}] Supabase job: ${supabaseJobId || 'none'}`);
    if (music_url) {
      console.log(`[${jobId}] Background music at ${music_volume}% volume`);
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
    
    // Process asynchronously
    processRender(jobId, images, audio_url, durations, captions, effects, webhook_url, supabaseJobId, low_memory, music_url, music_volume, mood_levels);
    
  } catch (error) {
    console.error('[RENDER] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Async render processing
 * @param moodLevels - Array of mood intensities (1-10) for each scene, for intelligent Ken Burns selection
 */
async function processRender(jobId, imageUrls, audioUrl, durations, captions, effects, webhookUrl, supabaseJobId, lowMemory, musicUrl = null, musicVolume = 15, moodLevels = []) {
  activeRenders++;
  const jobDir = path.join(TEMP_DIR, jobId);
  await fs.mkdir(jobDir, { recursive: true });
  
  // Auto-enable low memory mode if on cloud free tier
  const useLowMemory = lowMemory || AUTO_LOW_MEMORY;
  if (useLowMemory) {
    console.log(`[${jobId}] ⚠️ Low memory mode ENABLED (Cloud: ${IS_RENDER ? 'Render.com' : IS_RAILWAY ? 'Railway' : 'env'})`);
  }
  
  const startTime = Date.now();
  const timings = {};
  
  try {
    const job = jobs.get(jobId);
    
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
    
    // Step 2: Download audio
    let audioPath = null;
    if (audioUrl) {
      console.log(`[${jobId}] Downloading audio...`);
      audioPath = path.join(jobDir, 'audio.mp3');
      await downloadFile(audioUrl, audioPath);
      console.log(`[${jobId}] ✓ Audio downloaded`);
    }
    job.progress = 25;
    
    // Step 3: Create video from images
    const videoStart = Date.now();
    const useKenBurns = effects.kenBurns !== false && !DISABLE_KEN_BURNS;
    console.log(`[${jobId}] Creating video from images (lowMemory: ${useLowMemory}, kenBurns: ${useKenBurns})...`);
    const rawVideoPath = path.join(jobDir, 'raw.mp4');
    await createVideoFromImages(jobId, imagePaths, durations, rawVideoPath, {
      kenBurns: useKenBurns,
      lowMemory: useLowMemory,
      moodLevels: moodLevels, // Pass mood levels for intelligent Ken Burns
    });
    timings.createVideo = Date.now() - videoStart;
    job.progress = 50;
    console.log(`[${jobId}] ✓ Base video created (${Math.round(timings.createVideo/1000)}s)`);
    
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
    if (musicUrl) {
      const musicStart = Date.now();
      console.log(`[${jobId}] Downloading background music...`);
      const musicPath = path.join(jobDir, 'music.mp3');
      try {
        await downloadFile(musicUrl, musicPath);
        console.log(`[${jobId}] Adding background music at ${musicVolume}% volume...`);
        const withMusicPath = path.join(jobDir, 'with_music.mp4');
        await mixBackgroundMusic(currentVideo, musicPath, withMusicPath, musicVolume);
        await fs.unlink(currentVideo).catch(() => {});
        await fs.unlink(musicPath).catch(() => {});
        currentVideo = withMusicPath;
        timings.addMusic = Date.now() - musicStart;
        console.log(`[${jobId}] ✓ Background music added (${Math.round(timings.addMusic/1000)}s)`);
      } catch (musicErr) {
        console.log(`[${jobId}] ⚠️ Failed to add background music: ${musicErr.message}, continuing without it`);
      }
    }
    job.progress = 60;
    
    // Step 5: Add captions (if provided)
    if (captions && captions.length > 0) {
      const captionStart = Date.now();
      console.log(`[${jobId}] Burning ${captions.length} words as captions...`);
      const assPath = path.join(jobDir, 'captions.ass');
      await createASSSubtitles(captions, assPath, {
        captionStyle: effects.captionStyle || 'bold',
        highlightScary: effects.highlightScary !== false,
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
    
    // Step 6: Apply vignette (if enabled)
    if (effects.vignette) {
      console.log(`[${jobId}] Adding vignette...`);
      const vignettePath = path.join(jobDir, 'vignette.mp4');
      await addVignette(currentVideo, vignettePath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = vignettePath;
      console.log(`[${jobId}] ✓ Vignette added`);
    }
    job.progress = 85;
    
    // Step 7: Apply horror color grade (if enabled)
    if (effects.horrorGrade) {
      console.log(`[${jobId}] Adding horror color grade...`);
      const gradedPath = path.join(jobDir, 'graded.mp4');
      await addHorrorGrade(currentVideo, gradedPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = gradedPath;
      console.log(`[${jobId}] ✓ Horror grade added`);
    }
    job.progress = 90;
    
    // Step 8: Apply film grain effect (if enabled)
    if (effects.filmGrain) {
      console.log(`[${jobId}] Adding film grain/old film effect...`);
      const grainPath = path.join(jobDir, 'grain.mp4');
      await addFilmGrain(currentVideo, grainPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = grainPath;
      console.log(`[${jobId}] ✓ Film grain added`);
    }
    job.progress = 92;
    
    // =====================================================
    // NEW EFFECTS (Step 9+)
    // =====================================================
    
    // Glitch flicker (disturbance category)
    if (effects.glitchFlicker) {
      console.log(`[${jobId}] Adding glitch flicker effect...`);
      const glitchPath = path.join(jobDir, 'glitch.mp4');
      await addGlitchFlicker(currentVideo, glitchPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = glitchPath;
      console.log(`[${jobId}] ✓ Glitch flicker added`);
    }
    
    // VHS tracking wobble (disturbance category)
    if (effects.vhsTracking) {
      console.log(`[${jobId}] Adding VHS tracking wobble...`);
      const vhsPath = path.join(jobDir, 'vhs.mp4');
      await addVHSTracking(currentVideo, vhsPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = vhsPath;
      console.log(`[${jobId}] ✓ VHS tracking added`);
    }
    
    // Scanlines (disturbance category)
    if (effects.scanlines) {
      console.log(`[${jobId}] Adding scanline overlay...`);
      const scanPath = path.join(jobDir, 'scanlines.mp4');
      await addScanlines(currentVideo, scanPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = scanPath;
      console.log(`[${jobId}] ✓ Scanlines added`);
    }
    
    // Light flicker (atmospheric category)
    if (effects.lightFlicker) {
      console.log(`[${jobId}] Adding light flicker effect...`);
      const flickerPath = path.join(jobDir, 'flicker.mp4');
      await addLightFlicker(currentVideo, flickerPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = flickerPath;
      console.log(`[${jobId}] ✓ Light flicker added`);
    }
    
    // Cold color creep (atmospheric category)
    if (effects.coldColorCreep) {
      console.log(`[${jobId}] Adding cold color creep effect...`);
      const coldPath = path.join(jobDir, 'cold.mp4');
      await addColdColorCreep(currentVideo, coldPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = coldPath;
      console.log(`[${jobId}] ✓ Cold color creep added`);
    }
    
    // Heartbeat zoom (psychological category)
    if (effects.heartbeatZoom) {
      console.log(`[${jobId}] Adding heartbeat zoom effect...`);
      const heartPath = path.join(jobDir, 'heartbeat.mp4');
      await addHeartbeatZoom(currentVideo, heartPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = heartPath;
      console.log(`[${jobId}] ✓ Heartbeat zoom added`);
    }
    
    // Negative flash (psychological category)
    if (effects.negativeFlash) {
      console.log(`[${jobId}] Adding negative flash effect...`);
      const negPath = path.join(jobDir, 'negative.mp4');
      await addNegativeFlash(currentVideo, negPath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = negPath;
      console.log(`[${jobId}] ✓ Negative flash added`);
    }
    
    // Edge darkening creep (psychological category)
    if (effects.edgeDarkeningCreep) {
      console.log(`[${jobId}] Adding edge darkening creep effect...`);
      const edgePath = path.join(jobDir, 'edge.mp4');
      await addEdgeDarkeningCreep(currentVideo, edgePath, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = edgePath;
      console.log(`[${jobId}] ✓ Edge darkening creep added`);
    }
    
    // Fade in/out (transition category) - ALWAYS LAST
    if (effects.fadeIn || effects.fadeOut) {
      console.log(`[${jobId}] Adding fade transitions (in: ${effects.fadeIn}, out: ${effects.fadeOut})...`);
      const fadePath = path.join(jobDir, 'faded.mp4');
      await addFadeEffect(currentVideo, fadePath, {
        fadeIn: effects.fadeIn,
        fadeOut: effects.fadeOut,
        fadeDuration: effects.fadeDuration || 1.5,
      }, useLowMemory);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = fadePath;
      console.log(`[${jobId}] ✓ Fade transitions added`);
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
              visual_beat: scene.visual_beat || null,
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

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
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
