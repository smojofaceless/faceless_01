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

// Load .env for local dev (Supabase credentials, ComfyUI config, etc.)
require('dotenv').config();

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
} = require('./ffmpeg_presets');

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
 */
async function updateJobInSupabase(jobId, supabaseJobId, status, videoUrl = null) {
  if (!supabase || !supabaseJobId) {
    console.log(`[${jobId}] Skipping Supabase update - no client or job ID`);
    return;
  }
  
  try {
    console.log(`[${jobId}] Updating Supabase job ${supabaseJobId} to ${status}, videoUrl: ${videoUrl ? 'YES' : 'NO'}`);
    
    const updates = {
      progress: status === 'complete' ? 100 : status === 'failed' ? 0 : 85,
      updated_at: new Date().toISOString(),
    };
    
    if (status === 'complete') {
      updates.status = 'complete';
    } else if (status === 'failed') {
      updates.status = 'failed';
    }
    
    const { error: jobError } = await supabase.from('jobs').update(updates).eq('id', supabaseJobId);
    if (jobError) {
      console.error(`[${jobId}] Jobs table update error:`, jobError);
    } else {
      console.log(`[${jobId}] ✓ Jobs table updated`);
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
        meta: { renderer: 'ffmpeg', completed_at: new Date().toISOString() },
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
  const frames = Math.ceil(duration * 30); // 30fps — ceil prevents cumulative video shortening
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
  const frames = Math.ceil(duration * 15); // 15fps — ceil prevents cumulative video shortening
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
  const { kenBurns = true, lowMemory = false, moodLevels = [], img2vidClips = null } = options;
  const tempVideos = [];
  const width = 1080;
  const height = 1920;
  // Use 15fps for low memory mode - significantly faster encoding for still images
  const fps = lowMemory ? 15 : 30;
  
  // Track scene sources for post-render summary
  const sceneSources = []; // 'img2vid' | 'kenburns' per scene
  
  console.log(`[${jobId}] Processing ${images.length} images (lowMemory: ${lowMemory}, fps: ${fps})`);
  console.log(`[${jobId}] 📋 img2vidClips received in createVideoFromImages: ${img2vidClips ? `YES (${Object.keys(img2vidClips).length} keys: [${Object.keys(img2vidClips).join(',')}])` : 'NO (null)'}`);
  
  // Step 1: Create individual video clips for each image
  // Calculate total duration for validation
  const totalDuration = durations.reduce((sum, d) => sum + (d || 5), 0);
  console.log(`[${jobId}] Total video duration will be: ${totalDuration.toFixed(2)}s from ${images.length} scenes`);
  
  for (let i = 0; i < images.length; i++) {
    const imagePath = images[i];
    // Add a small buffer to the LAST scene to compensate for cumulative
    // per-scene frame-boundary rounding.  With ceil() in the Ken Burns frame
    // calc the video should already be >= audio, but this extra 0.5s provides
    // a safety margin that the audio merge step will naturally trim.
    let duration = durations[i] || 5;
    if (i === images.length - 1) {
      duration += 0.5;
    }
    const tempVideo = path.join(TEMP_DIR, `${jobId}_scene_${i}.mp4`);
    tempVideos.push(tempVideo);
    
    // Force garbage collection if available
    if (global.gc) global.gc();
    
    // ── img2vid path: use pre-generated video clip instead of Ken Burns ──
    const clipKey = String(i);
    const clipInfo = img2vidClips && img2vidClips[clipKey];
    if (img2vidClips && !clipInfo) {
      console.warn(`[${jobId}] Scene ${i + 1}: ⚠ img2vid clips exist (keys=[${Object.keys(img2vidClips).join(',')}]) but no match for index ${i} — falling through to Ken Burns`);
    }
    if (clipInfo && clipInfo.url) {
      console.log(`[${jobId}] Scene ${i + 1}: Using img2vid clip (${clipInfo.url.substring(0, 60)}...)`);
      try {
        // Download the video clip to a temp file (with 1 retry for transient network errors)
        const clipTempPath = path.join(TEMP_DIR, `${jobId}_img2vid_clip_${i}.mp4`);
        let clipBuffer;
        const MAX_CLIP_DL_ATTEMPTS = 3;  // v9.1: 3 attempts with exponential backoff
        for (let attempt = 1; attempt <= MAX_CLIP_DL_ATTEMPTS; attempt++) {
          try {
            console.log(`[${jobId}] Scene ${i + 1}: downloading clip (attempt ${attempt}/${MAX_CLIP_DL_ATTEMPTS}) from ${clipInfo.url.substring(0, 80)}...`);
            const clipResp = await fetch(clipInfo.url);
            if (!clipResp.ok) throw new Error(`HTTP ${clipResp.status} ${clipResp.statusText}`);
            clipBuffer = Buffer.from(await clipResp.arrayBuffer());
            if (clipBuffer.length < 1000) throw new Error(`Clip too small: ${clipBuffer.length} bytes (corrupt or empty)`);
            break; // success
          } catch (dlErr) {
            if (attempt === MAX_CLIP_DL_ATTEMPTS) throw new Error(`Failed to download img2vid clip after ${MAX_CLIP_DL_ATTEMPTS} attempts: ${dlErr.message}`);
            const backoffMs = attempt * 3000; // 3s, 6s
            console.warn(`[${jobId}] Scene ${i + 1}: clip download attempt ${attempt} failed (${dlErr.message}), retrying in ${backoffMs/1000}s...`);
            await new Promise(r => setTimeout(r, backoffMs));
          }
        }
        await fs.writeFile(clipTempPath, clipBuffer);
        console.log(`[${jobId}] Scene ${i + 1}: Downloaded img2vid clip (${(clipBuffer.length / 1024).toFixed(0)} KB)`);
        
        // Scale & trim the clip to target resolution and scene duration
        await new Promise((resolve, reject) => {
          ffmpeg(clipTempPath)
            .videoFilter(`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`)
            .outputOptions([
              '-c:v', 'libx264',
              '-preset', lowMemory ? 'superfast' : 'medium',
              '-crf', lowMemory ? '26' : '23',
              '-t', String(duration),
              '-pix_fmt', 'yuv420p',
              '-r', String(fps),
              '-an',  // strip audio from clip
            ])
            .output(tempVideo)
            .on('end', () => resolve())
            .on('error', (err, stdout, stderr) => {
              console.error(`[${jobId}] Scene ${i + 1} img2vid clip processing error:`, err.message);
              reject(err);
            })
            .run();
        });
        
        // Clean up downloaded clip
        await fs.unlink(clipTempPath).catch(() => {});
        // Delete source image (not needed for img2vid scenes)
        await fs.unlink(imagePath).catch(() => {});
        
        console.log(`[${jobId}] ✓ Scene ${i + 1}/${images.length} created (img2vid)`);
        sceneSources.push('img2vid');
        const job = jobs.get(jobId);
        if (job) {
          job.progress = 25 + Math.round((i + 1) / images.length * 25);
        }
        continue;  // Skip the Ken Burns path below
      } catch (clipErr) {
        console.warn(`[${jobId}] Scene ${i + 1}: img2vid clip failed, falling back to Ken Burns:`, clipErr.message);
        sceneSources.push('kenburns-fallback');
        // Fall through to Ken Burns path below
      }
    }
    
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
    sceneSources.push('kenburns');
    
    // Update job progress
    const job = jobs.get(jobId);
    if (job) {
      job.progress = 25 + Math.round((i + 1) / images.length * 25);
    }
    
    // Delete source image to free disk space
    await fs.unlink(imagePath).catch(() => {});
  }
  
  // Scene-source summary — shows at a glance whether img2vid clips were used
  const img2vidCount = sceneSources.filter(s => s === 'img2vid').length;
  const kbCount = sceneSources.filter(s => s === 'kenburns').length;
  const fallbackCount = sceneSources.filter(s => s === 'kenburns-fallback').length;
  console.log(`[${jobId}] 📊 SCENE SOURCE SUMMARY: ${img2vidCount} img2vid, ${kbCount} kenburns, ${fallbackCount} fallback (total ${sceneSources.length})`);
  if (img2vidClips && img2vidCount === 0) {
    console.error(`[${jobId}] ⚠️ CRITICAL: img2vid clips were provided (keys=[${Object.keys(img2vidClips).join(',')}]) but NONE were used! All fell back to Ken Burns.`);
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
  return { outputPath, sceneSources };
}

/**
 * Add audio to video
 *
 * NOTE: We intentionally omit -shortest so the audio (narration) defines the
 * total output duration.  If the concatenated image track is a few frames
 * shorter than the audio (due to per-scene frame-boundary rounding), the
 * player will hold the last video frame while the remaining audio finishes.
 * This prevents narration from being clipped at the end.
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
    const totalFrames = Math.ceil(duration * 30);
    
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
    const totalFrames = Math.ceil(duration * 30);
    
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
 * Add video overlay effect — composites a black-background overlay video
 * on top of the main video using FFmpeg "screen" blend mode.
 * The overlay loops to match the main video's duration.
 *
 * @param {string} inputPath   - Main video file
 * @param {string} outputPath  - Output composited video
 * @param {string} overlayPath - Downloaded overlay video file (black background)
 * @param {number} opacity     - Overlay opacity 0-1 (default 0.4)
 * @param {boolean} lowMemory  - Use low-memory encoding settings
 */
async function addVideoOverlay(inputPath, outputPath, overlayPath, opacity = 0.4, lowMemory = false) {
  const TIMEOUT_MS = 5 * 60 * 1000; // 5 min timeout

  return new Promise(async (resolve, reject) => {
    let timedOut = false;
    let overlayFailed = false; // Track if we fell back to copying original
    const duration = await getVideoDuration(inputPath);

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      console.error('⚠️ Video overlay timed out after 5 minutes, skipping...');
      cmd.kill('SIGKILL');
    }, TIMEOUT_MS);

    const outputOptions = lowMemory ? [
      '-c:v', 'libx264', '-preset', 'superfast', '-crf', '24', '-c:a', 'copy', '-threads', '2',
    ] : [
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'copy', '-threads', '4',
    ];

    // Clamp opacity
    const op = Math.max(0.05, Math.min(1.0, opacity));

    // Build the FFmpeg filter graph for overlay compositing.
    //
    // Design:
    //  1. scale2ref: Scale overlay (any resolution) to match main video dimensions
    //  2. colorkey: Remove black background → transparent (similarity threshold)
    //  3. format=yuva420p: Ensure alpha channel exists for overlay filter
    //  4. colorchannelmixer aa=: Control overlay opacity via alpha channel
    //  5. overlay=0:0: Standard alpha compositing (black = transparent)
    //
    // Why colorkey+overlay instead of blend=screen:
    //  - blend operates on raw YUV pixel values; chroma channels (U/V) have
    //    neutral point at 128, NOT 0. Screen blend treats overlay "black"
    //    chroma (128) as non-zero, causing severe purple/magenta color shift.
    //  - colorkey+overlay works in alpha space, avoiding YUV color math entirely.
    //
    // colorkey params:
    //  - color=black (0x000000): Key out black pixels
    //  - similarity=0.15: How close to black counts as "black" (0=exact, 1=all)
    //  - blend=0.1: Feather/softness at edge of keyed region
    const filterGraph = [
      `[1:v][0:v]scale2ref[ov_scaled][main]`,
      `[ov_scaled]setpts=PTS-STARTPTS,colorkey=black:0.15:0.1,format=yuva420p,colorchannelmixer=aa=${op.toFixed(2)}[ov]`,
      `[main][ov]overlay=0:0:shortest=1[out]`,
    ].join(';');

    // Use raw ffmpeg args instead of fluent-ffmpeg complexFilter to avoid
    // label mapping issues with the 'out' second argument
    const cmd = ffmpeg()
      .input(inputPath)
      .input(overlayPath)
      .inputOptions(['-stream_loop', '-1']) // Loop overlay indefinitely
      .outputOptions([
        '-filter_complex', filterGraph,
        '-map', '[out]', '-map', '0:a?',
        '-t', duration.toString(),
        ...outputOptions,
      ])
      .output(outputPath)
      .on('end', () => {
        clearTimeout(timeoutHandle);
        resolve();
      })
      .on('error', (err) => {
        clearTimeout(timeoutHandle);
        if (timedOut) {
          console.log('  → Overlay timed out, copying original...');
          overlayFailed = true;
          fs.copyFile(inputPath, outputPath).then(() => reject(new Error('overlay_timeout'))).catch(reject);
        } else {
          console.error('Video overlay primary method failed:', err.message);
          console.log('Trying fallback overlay (overlay filter with alpha compositing)...');
          // Fallback: overlay filter (supports alpha compositing natively)
          const fallbackFilter = [
            `[1:v][0:v]scale2ref[ov_scaled][main]`,
            `[ov_scaled]setpts=PTS-STARTPTS,format=yuva420p,colorchannelmixer=aa=${(op * 0.7).toFixed(2)}[ov]`,
            `[main][ov]overlay=0:0:shortest=1[out]`,
          ].join(';');

          const cmd2 = ffmpeg()
            .input(inputPath)
            .input(overlayPath)
            .inputOptions(['-stream_loop', '-1'])
            .outputOptions([
              '-filter_complex', fallbackFilter,
              '-map', '[out]', '-map', '0:a?',
              '-t', duration.toString(),
              '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-c:a', 'copy',
            ])
            .output(outputPath)
            .on('end', () => {
              console.log('  → Fallback overlay succeeded');
              resolve();
            })
            .on('error', (err2) => {
              console.error('Video overlay fallback also failed:', err2.message);
              overlayFailed = true;
              // Copy original as last resort, but REJECT so caller knows overlay wasn't applied
              fs.copyFile(inputPath, outputPath)
                .then(() => reject(new Error(`overlay_failed: primary=${err.message}, fallback=${err2.message}`)))
                .catch(reject);
            })
            .run();
        }
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
 * Create ASS subtitle file from captions
 * v6.0: Full chunked subtitle system with per-brand styling
 *   - words_per_chunk groups N words together (default 3)
 *   - Active word highlighted in different color + scaled up
 *   - Configurable position (top/center/bottom), emphasis scale, colors
 *   - Falls back gracefully when no subtitleConfig provided
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
      visual_dna = null,  // v3.0: Visual DNA for deterministic aesthetic binding
      effects_profile = null, // v3.1: Effects profile with intensity controls (0-1)
      img2vid_clips = null,   // Phase 2: img2vid video clips per scene { "0": { url, duration }, ... }
      overlay_video_url = null, // v4.1: URL to a black-background overlay video (screen blend)
      overlay_video_opacity = 0.4, // v4.1: Opacity for overlay video (0-1)
      subtitle_config = null, // v6.0: Per-brand subtitle styling from get_subtitle_config_for_job()
    } = req.body;
    
    if (!images || images.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }
    
    console.log(`[${jobId}] New render job: ${images.length} images, audio: ${audio_url ? 'yes' : 'no'}, music: ${music_url ? 'yes' : 'no'}, captions: ${captions.length} words`);
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
    
    if (music_url) {
      console.log(`[${jobId}] Background music at ${music_volume}% volume`);
    }

    if (img2vid_clips && Object.keys(img2vid_clips).length > 0) {
      console.log(`[${jobId}] 🎥 img2vid clips for ${Object.keys(img2vid_clips).length} scene(s): keys=[${Object.keys(img2vid_clips).join(',')}]`);
      // Log each clip URL for debugging
      for (const [sceneKey, clip] of Object.entries(img2vid_clips)) {
        console.log(`[${jobId}]   clip[${sceneKey}]: ${clip?.url?.slice(0, 80) || 'NO URL'}`);
      }
    } else {
      console.log(`[${jobId}] ⚠ No img2vid_clips in payload (value: ${JSON.stringify(img2vid_clips)?.slice(0, 100)})`);
    }
    
    // v4.1: Resolve overlay video URL
    // Priority: top-level overlay_video_url > effects_profile.overlay_video.url
    let resolvedOverlayUrl = overlay_video_url || null;
    let resolvedOverlayOpacity = overlay_video_opacity || 0.4;
    if (!resolvedOverlayUrl && safeEffectsProfile?.overlay_video?.enabled && safeEffectsProfile?.overlay_video?.url) {
      resolvedOverlayUrl = safeEffectsProfile.overlay_video.url;
      resolvedOverlayOpacity = safeEffectsProfile.overlay_video.opacity || 0.4;
    }
    if (resolvedOverlayUrl) {
      console.log(`[${jobId}] 🎞️ Video overlay configured: opacity=${resolvedOverlayOpacity}, url=${resolvedOverlayUrl.slice(0, 80)}...`);
    }
    
    // v6.0: Validate subtitle config if provided
    let safeSubtitleConfig = null;
    if (subtitle_config && typeof subtitle_config === 'object') {
      safeSubtitleConfig = subtitle_config;
      console.log(`[${jobId}] 📝 Subtitle Config: style=${subtitle_config.style || 'bold'}, fontSize=${subtitle_config.font_size || 'default'}, position=${subtitle_config.position || 'bottom'}, wpc=${subtitle_config.words_per_chunk || 'default'}, scary=${subtitle_config.highlight_scary ?? true}`);
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
    
    // Process asynchronously (now with visual_dna, effects_profile, overlay, and subtitle_config)
    processRender(jobId, images, audio_url, durations, captions, effects, webhook_url, supabaseJobId, low_memory, music_url, music_volume, mood_levels, visual_dna, safeEffectsProfile, img2vid_clips, resolvedOverlayUrl, resolvedOverlayOpacity, safeSubtitleConfig);
    
  } catch (error) {
    console.error('[RENDER] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Async render processing
 * v3.0: Now accepts visualDNA for deterministic aesthetic binding
 * v3.1: Now accepts effectsProfile for intensity-based effect controls
 * v4.1: Now accepts overlayVideoUrl for black-background overlay compositing
 * 
 * @param moodLevels - Array of mood intensities (1-10) for each scene, for intelligent Ken Burns selection
 * @param visualDNA - Visual DNA object for FFmpeg filter binding
 * @param effectsProfile - Effects profile with intensity controls (0-1 scale)
 * @param overlayVideoUrl - URL to a black-background overlay video for screen blend
 * @param overlayOpacity - Overlay opacity 0-1 (default 0.4)
 * @param subtitleConfig - Per-brand subtitle styling from get_subtitle_config_for_job()
 */
async function processRender(jobId, imageUrls, audioUrl, durations, captions, effects, webhookUrl, supabaseJobId, lowMemory, musicUrl = null, musicVolume = 15, moodLevels = [], visualDNA = null, effectsProfile = null, img2vidClips = null, overlayVideoUrl = null, overlayOpacity = 0.4, subtitleConfig = null) {
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
    const useKenBurns = mergedEffects.kenBurns !== false && !DISABLE_KEN_BURNS;
    console.log(`[${jobId}] Creating video from images (lowMemory: ${useLowMemory}, kenBurns: ${useKenBurns})...`);
    console.log(`[${jobId}] 🎬 processRender → createVideoFromImages: img2vidClips=${img2vidClips ? `YES (${Object.keys(img2vidClips).length} keys)` : 'null/undefined'}`);
    const rawVideoPath = path.join(jobDir, 'raw.mp4');
    const videoResult = await createVideoFromImages(jobId, imagePaths, durations, rawVideoPath, {
      kenBurns: useKenBurns,
      lowMemory: useLowMemory,
      moodLevels: moodLevels, // Pass mood levels for intelligent Ken Burns
      motionOverride: dnaMotionOverride, // v3.0: Pass Visual DNA motion override
      img2vidClips: img2vidClips, // Phase 2: pre-generated video clips per scene
    });
    timings.createVideo = Date.now() - videoStart;
    job.progress = 50;
    // v9.1: Store scene_sources in job status so the worker can verify clip usage
    const sceneSources = videoResult.sceneSources || [];
    job.scene_sources = sceneSources;
    const img2vidUsed = sceneSources.filter(s => s === 'img2vid').length;
    const kbFallback = sceneSources.filter(s => s === 'kenburns-fallback').length;
    console.log(`[${jobId}] ✓ Base video created (${Math.round(timings.createVideo/1000)}s) — scene sourcing: ${img2vidUsed} img2vid, ${kbFallback} fallback, ${sceneSources.length - img2vidUsed - kbFallback} kenburns`);
    
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
        duration: `0:00 - ${formatTime(durations.reduce((s, d) => s + d, 0))}`, 
        processTime: dnaTime,
        filters: dnaFilters.slice(0, 5).join(', ') + (dnaFilters.length > 5 ? '...' : ''),
      });
      console.log(`[${jobId}] ✓ Visual DNA filters applied (${Math.round(dnaTime/1000)}s)`);
    }
    
    // Get total video duration for timeline tracking
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    
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
    
    // Track Ken Burns if enabled (useKenBurns already declared above)
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
    
    // =====================================================
    // VIDEO OVERLAY (compositing category) - after all filter effects, before fade
    // =====================================================
    const overlayPipeline = {
      configured: !!overlayVideoUrl,
      applied: false,
      source_url: overlayVideoUrl || null,
      opacity: overlayOpacity,
      blend_mode: 'screen',
      download_ms: null,
      apply_ms: null,
      total_ms: null,
      error: null,
    };
    if (overlayVideoUrl) {
      const effectStart = Date.now();
      console.log(`[${jobId}] 🎞️ Downloading overlay video...`);
      console.log(`[${jobId}] 🎞️ Overlay source: ${overlayVideoUrl}`);
      console.log(`[${jobId}] 🎞️ Overlay opacity: ${overlayOpacity}, blend: screen`);
      const overlayDlPath = path.join(jobDir, 'overlay_source.mp4');
      try {
        const dlStart = Date.now();
        await downloadFile(overlayVideoUrl, overlayDlPath);
        overlayPipeline.download_ms = Date.now() - dlStart;
        // Get overlay file size
        const overlayStats = await fs.stat(overlayDlPath).catch(() => null);
        overlayPipeline.file_size_mb = overlayStats ? +(overlayStats.size / 1024 / 1024).toFixed(2) : null;
        console.log(`[${jobId}] 🎞️ Overlay downloaded: ${overlayPipeline.file_size_mb}MB in ${overlayPipeline.download_ms}ms`);
        console.log(`[${jobId}] 🎞️ Applying video overlay (opacity: ${overlayOpacity}, blend: screen)...`);
        const applyStart = Date.now();
        const overlayOutPath = path.join(jobDir, 'with_overlay.mp4');
        await addVideoOverlay(currentVideo, overlayOutPath, overlayDlPath, overlayOpacity, useLowMemory);
        overlayPipeline.apply_ms = Date.now() - applyStart;
        await fs.unlink(currentVideo).catch(() => {});
        await fs.unlink(overlayDlPath).catch(() => {});
        currentVideo = overlayOutPath;
        const effectTime = Date.now() - effectStart;
        overlayPipeline.total_ms = effectTime;
        overlayPipeline.applied = true;
        appliedEffects.push({
          name: 'Video Overlay',
          category: 'Compositing',
          timeline: 'Full video (looped)',
          duration: `0:00 - ${formatTime(totalDuration)}`,
          processTime: effectTime,
          overlay_details: {
            opacity: overlayOpacity,
            blend_mode: 'screen',
            source: overlayVideoUrl.split('/').pop(),
            file_size_mb: overlayPipeline.file_size_mb,
            download_ms: overlayPipeline.download_ms,
            apply_ms: overlayPipeline.apply_ms,
          }
        });
        console.log(`[${jobId}] ✓ Video overlay applied (${Math.round(effectTime/1000)}s — download: ${overlayPipeline.download_ms}ms, ffmpeg: ${overlayPipeline.apply_ms}ms)`);
      } catch (overlayErr) {
        overlayPipeline.error = overlayErr.message;
        overlayPipeline.total_ms = Date.now() - effectStart;
        console.warn(`[${jobId}] ⚠️ Video overlay failed (non-fatal): ${overlayErr.message}, continuing without overlay`);
        await fs.unlink(overlayDlPath).catch(() => {});
      }
    } else {
      console.log(`[${jobId}] 🎞️ No overlay configured for this render`);
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
    job.overlay_pipeline = overlayPipeline;
    job.effects_applied = appliedEffects.map(e => ({
      name: e.name,
      category: e.category,
      process_time_ms: e.processTime,
      ...(e.overlay_details ? { overlay_details: e.overlay_details } : {}),
    }));
    
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
          if (e.overlay_details) {
            console.log(`[${jobId}]       │     Opacity: ${Math.round(e.overlay_details.opacity * 100)}%`);
            console.log(`[${jobId}]       │     Blend Mode: ${e.overlay_details.blend_mode}`);
            console.log(`[${jobId}]       │     Source: ${e.overlay_details.source}`);
            console.log(`[${jobId}]       │     File Size: ${e.overlay_details.file_size_mb}MB`);
            console.log(`[${jobId}]       │     Download: ${e.overlay_details.download_ms}ms`);
            console.log(`[${jobId}]       │     FFmpeg Apply: ${e.overlay_details.apply_ms}ms`);
          }
        });
        console.log(`[${jobId}]`);
      }
      
      // Overlay pipeline summary
      if (overlayPipeline.configured) {
        console.log(`[${jobId}]    🎞️ OVERLAY PIPELINE`);
        console.log(`[${jobId}]       Status: ${overlayPipeline.applied ? '✅ APPLIED' : '❌ FAILED'}`);
        console.log(`[${jobId}]       Source: ${(overlayPipeline.source_url || '').split('/').pop()}`);
        console.log(`[${jobId}]       Opacity: ${Math.round(overlayPipeline.opacity * 100)}%`);
        console.log(`[${jobId}]       Blend Mode: ${overlayPipeline.blend_mode}`);
        if (overlayPipeline.file_size_mb) console.log(`[${jobId}]       File Size: ${overlayPipeline.file_size_mb}MB`);
        if (overlayPipeline.download_ms) console.log(`[${jobId}]       Download: ${overlayPipeline.download_ms}ms`);
        if (overlayPipeline.apply_ms) console.log(`[${jobId}]       FFmpeg: ${overlayPipeline.apply_ms}ms`);
        if (overlayPipeline.total_ms) console.log(`[${jobId}]       Total: ${Math.round(overlayPipeline.total_ms/1000)}s`);
        if (overlayPipeline.error) console.log(`[${jobId}]       Error: ${overlayPipeline.error}`);
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
          overlay_pipeline: overlayPipeline,
          effects_count: appliedEffects.length,
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

// Kling API configuration
const KLING_ACCESS_KEY = process.env.KLING_ACCESS_KEY;
const KLING_SECRET_KEY = process.env.KLING_SECRET_KEY;
const KLING_API_BASE = 'https://api-singapore.klingai.com';
let jwt; // lazy-loaded
function getKlingJWT() {
  if (!jwt) jwt = require('jsonwebtoken');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: KLING_ACCESS_KEY,
    exp: now + 1800,  // 30 min
    nbf: now - 5,
    iat: now,
  };
  return jwt.sign(payload, KLING_SECRET_KEY, { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } });
}

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

// ═══════════════════════════════════════════════════════════════════════
// ComfyUI Local Generation Endpoints
// ═══════════════════════════════════════════════════════════════════════

let comfyui = null;
try {
  comfyui = require('./comfyui/config');
  console.log('✅ ComfyUI integration loaded');
} catch (err) {
  console.log('⚠️ ComfyUI integration not available:', err.message);
}

// In-memory store for ComfyUI generation jobs
const comfyJobs = new Map();

/**
 * GET /comfyui-health
 * Returns detailed availability info for smart fallback decisions.
 * The edge function pings this before dispatching to ComfyUI.
 */
app.get('/comfyui-health', async (req, res) => {
  if (!comfyui) {
    return res.json({
      available: false,
      fallback_reason: 'offline',
      error: 'ComfyUI integration not loaded',
    });
  }

  try {
    const health = await comfyui.checkHealth();
    res.json(health);
  } catch (err) {
    console.error('[COMFYUI] Health check error:', err.message);
    res.json({
      available: false,
      fallback_reason: 'offline',
      error: err.message,
    });
  }
});

/**
 * POST /comfyui-free
 * Unload models and free VRAM on ComfyUI.
 * Called by worker-v1 between image generation and img2vid to reclaim VRAM.
 */
app.post('/comfyui-free', async (req, res) => {
  if (!comfyui) {
    return res.status(503).json({ error: 'ComfyUI integration not available' });
  }

  try {
    const comfyuiUrl = comfyui.COMFYUI_URL || 'http://127.0.0.1:8188';
    const resp = await fetch(`${comfyuiUrl}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unload_models: req.body?.unload_models ?? true,
        free_memory: req.body?.free_memory ?? true,
      }),
    });
    console.log(`[COMFYUI] Free VRAM: status=${resp.status}`);
    res.json({ success: true, status: resp.status });
  } catch (err) {
    console.error('[COMFYUI] Free VRAM error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /comfyui-generate
 * Generate images via local ComfyUI.
 * 
 * Body: {
 *   job_id: string,
 *   scenes: [{ index, prompt, negative_prompt? }],
 *   workflow?: 'txt2img_sdxl' | 'txt2img_flux',
 *   checkpoint?: string,
 *   width?: number,
 *   height?: number,
 *   brand_dna?: object,   // For prompt translation
 * }
 * 
 * Returns: { comfy_job_id, status_url, scenes_count }
 */
app.post('/comfyui-generate', async (req, res) => {
  if (!comfyui) {
    return res.status(503).json({ error: 'ComfyUI integration not available' });
  }

  const {
    job_id,
    scenes,
    workflow = comfyui.COMFYUI_DEFAULT_WORKFLOW,
    checkpoint = comfyui.COMFYUI_DEFAULT_CHECKPOINT,
    width = 1024,
    height = 1536,
    steps,
    cfg,
    brand_dna = {},
  } = req.body;

  if (!job_id || !scenes || !Array.isArray(scenes) || scenes.length === 0) {
    return res.status(400).json({ error: 'Missing job_id or scenes array' });
  }

  const comfyJobId = `comfy_${uuidv4().slice(0, 8)}`;

  console.log(`\n[COMFY-${comfyJobId}] Starting ComfyUI generation`);
  console.log(`[COMFY-${comfyJobId}]   Job: ${job_id}`);
  console.log(`[COMFY-${comfyJobId}]   Scenes: ${scenes.length}`);
  console.log(`[COMFY-${comfyJobId}]   Workflow: ${workflow}`);
  console.log(`[COMFY-${comfyJobId}]   Checkpoint: ${checkpoint || '(default)'}`);

  // Initialize job tracking
  const jobState = {
    id: comfyJobId,
    job_id,
    status: 'running',
    workflow,
    checkpoint: checkpoint || undefined,
    completed: 0,
    total: scenes.length,
    images: [],
    errors: [],
    started_at: new Date().toISOString(),
    completed_at: null,
  };
  comfyJobs.set(comfyJobId, jobState);

  // Return immediately — generation runs in background
  res.json({
    comfy_job_id: comfyJobId,
    status_url: `/comfyui-status/${comfyJobId}`,
    scenes_count: scenes.length,
  });

  // ── Background generation ──
  (async () => {
    for (const scene of scenes) {
      try {
        const sceneIndex = scene.index ?? 0;
        const seed = comfyui.hashSeed(job_id, sceneIndex);

        // Translate cloud prompt → ComfyUI-native
        const translated = comfyui.translatePromptForComfyUI(
          scene.prompt,
          brand_dna,
          workflow,
        );

        // Override negative if scene provides one
        const negative = scene.negative_prompt || translated.negative;
        const pHash = comfyui.promptHash(translated.positive);

        console.log(`[COMFY-${comfyJobId}] Scene ${sceneIndex}: seed=${seed}, prompt_hash=${pHash}`);

        // Load workflow template and inject parameters
        const workflowData = comfyui.loadWorkflow(workflow, {
          positive: translated.positive,
          negative,
          seed,
          width,
          height,
          checkpoint: checkpoint || undefined,
          steps: steps || undefined,
          cfg: cfg || undefined,
        });

        // Generate
        const result = await comfyui.generateImage(workflowData);

        // Upload first image to Supabase Storage if available
        let publicUrl = null;
        if (result.images.length > 0 && supabase) {
          const imgBuffer = result.images[0];
          const storagePath = `jobs/${job_id}/comfyui_scene_${sceneIndex}.webp`;

          const { error: uploadError } = await supabase.storage
            .from('story-videos')
            .upload(storagePath, imgBuffer, {
              contentType: 'image/webp',
              upsert: true,
            });

          if (uploadError) {
            console.error(`[COMFY-${comfyJobId}] Storage upload failed for scene ${sceneIndex}:`, uploadError.message);
          } else {
            const { data: urlData } = supabase.storage
              .from('story-videos')
              .getPublicUrl(storagePath);
            publicUrl = urlData.publicUrl;
            console.log(`[COMFY-${comfyJobId}] ✓ Scene ${sceneIndex} uploaded: ${storagePath}`);
          }
        }

        // Record success
        jobState.images.push({
          index: sceneIndex,
          url: publicUrl,
          metadata: {
            renderer: 'comfyui',
            job_id,
            scene: sceneIndex,
            workflow,
            checkpoint: checkpoint || '(default)',
            seed,
            cfg: workflowData['3']?.inputs?.cfg || 5.5,
            steps: workflowData['3']?.inputs?.steps || 28,
            sampler: workflowData['3']?.inputs?.sampler_name || 'euler_ancestral',
            scheduler: workflowData['3']?.inputs?.scheduler || 'normal',
            width,
            height,
            prompt_hash: pHash,
            prompt_positive: translated.positive.slice(0, 200),
            prompt_negative: negative.slice(0, 200),
            loras: brand_dna?.comfyui_loras || [],
            generation_time_ms: result.metadata.generation_time_ms,
            comfyui_prompt_id: result.prompt_id,
            fallback_used: false,
            fallback_reason: null,
          },
        });
        jobState.completed++;

      } catch (err) {
        console.error(`[COMFY-${comfyJobId}] Scene ${scene.index} failed:`, err.message);
        jobState.errors.push({
          index: scene.index,
          error: err.message,
          fallback_reason: err.message.includes('timed out')
            ? comfyui.FALLBACK_REASONS.TIMEOUT
            : comfyui.FALLBACK_REASONS.ERROR,
        });
        jobState.completed++;
      }
    }

    // Mark complete
    jobState.status = jobState.errors.length === 0 ? 'complete' : 'partial';
    jobState.completed_at = new Date().toISOString();
    console.log(`[COMFY-${comfyJobId}] Finished: ${jobState.images.length}/${jobState.total} succeeded, ${jobState.errors.length} errors`);

    // Cleanup after 30 min
    setTimeout(() => {
      comfyJobs.delete(comfyJobId);
      console.log(`[COMFY-${comfyJobId}] Cleaned up`);
    }, 30 * 60 * 1000);
  })();
});

/**
 * GET /comfyui-status/:id
 * Check status of a ComfyUI generation job.
 * 
 * Returns: {
 *   id, job_id, status, workflow, completed, total,
 *   images: [{ index, url, metadata }],
 *   errors: [{ index, error, fallback_reason }]
 * }
 */
app.get('/comfyui-status/:id', (req, res) => {
  const job = comfyJobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'ComfyUI job not found' });
  }
  res.json(job);
});

/**
 * POST /comfyui-img2vid
 * Generate a video clip from a source image via local ComfyUI.
 *
 * Body: {
 *   job_id: string,
 *   scene_index: number,
 *   image_url: string,             // Public URL of source image
 *   workflow?: 'img2vid_svd' | 'img2vid_animatediff' | 'img2vid_animatediff_ipa' | 'img2vid_cogvideox' | 'img2vid_wan' | 'img2vid_kling',
 *   motion_strength?: number,      // 0.0–1.0 (default: 0.5)
 *   fps?: number,                  // Frames per second (default: 8)
 *   video_frames?: number,         // Total frames (default: 25 for SVD)
 *   width?: number,
 *   height?: number,
 *   checkpoint?: string,           // Model override
 *   steps?: number,
 *   cfg?: number,
 *   motion_prompt?: string,        // AnimateDiff motion description
 * }
 *
 * Returns: { comfy_job_id, status_url, estimated_seconds }
 */
app.post('/comfyui-img2vid', async (req, res) => {
  if (!comfyui) {
    return res.status(503).json({ error: 'ComfyUI integration not available' });
  }

  const {
    job_id,
    scene_index = 0,
    image_url,
    workflow = 'img2vid_animatediff_ipa',
    motion_strength = 0.5,
    fps = 8,
    video_frames = 16,
    // Accept both width/height and render_width/render_height (edge function sends render_*)
    width: rawWidth,
    height: rawHeight,
    render_width: renderWidth,
    render_height: renderHeight,
    upscale_to_width = 1024,
    upscale_to_height = 1536,
    upscale_width: upscaleWidthAlias,
    upscale_height: upscaleHeightAlias,
    checkpoint,
    steps,
    cfg,
    motion_prompt,
    noise_aug_strength,
  } = req.body;

  // v8.2: Default render resolution bumped from 512x768 → 640x960
  const width = rawWidth || renderWidth || 640;
  const height = rawHeight || renderHeight || 960;
  const finalUpscaleW = upscale_to_width || upscaleWidthAlias || 720;
  const finalUpscaleH = upscale_to_height || upscaleHeightAlias || 1280;

  const shouldUpscale = finalUpscaleW > width || finalUpscaleH > height;

  if (!job_id || !image_url) {
    return res.status(400).json({ error: 'Missing job_id or image_url' });
  }

  // ── Kling API path: skip ComfyUI entirely ──
  if (workflow === 'img2vid_kling') {
    if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
      return res.status(503).json({ error: 'Kling API keys not configured (KLING_ACCESS_KEY / KLING_SECRET_KEY)' });
    }

    const comfyJobId = `kling_${uuidv4().slice(0, 8)}`;
    console.log(`\n[KLING-${comfyJobId}] Starting Kling image-to-video generation`);
    console.log(`[KLING-${comfyJobId}]   Job: ${job_id}, Scene: ${scene_index}`);
    console.log(`[KLING-${comfyJobId}]   Prompt: "${(motion_prompt || '').slice(0, 80)}"`);

    const jobState = {
      id: comfyJobId,
      job_id,
      type: 'img2vid',
      status: 'running',
      stage: 'initializing',
      stage_detail: 'Submitting to Kling API',
      workflow: 'img2vid_kling',
      scene_index,
      motion_strength,
      fps,
      video_frames,
      video_url: null,
      video_duration_seconds: null,
      frame_count: 0,
      generation_progress: { step: 0, max_steps: 100, percentage: 0, node: null },
      errors: [],
      started_at: new Date().toISOString(),
      completed_at: null,
      metadata: {},
    };
    comfyJobs.set(comfyJobId, jobState);

    res.json({
      comfy_job_id: comfyJobId,
      status_url: `/comfyui-status/${comfyJobId}`,
      estimated_seconds: 60,
    });

    // ── Background Kling generation ──
    (async () => {
      try {
        // 1. Create Kling task
        jobState.stage = 'submitting';
        jobState.stage_detail = 'Submitting video generation task to Kling API';
        const token = getKlingJWT();
        const klingBody = {
          model_name: 'kling-v2-1',
          mode: 'std',
          duration: '5',
          image: image_url,
          prompt: motion_prompt || 'cinematic motion, gentle movement',
          negative_prompt: 'static, blurry, distorted, low quality',
          cfg_scale: cfg || 0.5,
          aspect_ratio: height > width ? '9:16' : '16:9',
        };

        console.log(`[KLING-${comfyJobId}] Creating task: model=${klingBody.model_name}, mode=${klingBody.mode}, aspect=${klingBody.aspect_ratio}`);

        const createResp = await fetch(`${KLING_API_BASE}/v1/videos/image2video`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(klingBody),
        });

        if (!createResp.ok) {
          const errText = await createResp.text();
          throw new Error(`Kling API error ${createResp.status}: ${errText.slice(0, 300)}`);
        }

        const createData = await createResp.json();
        const taskId = createData.data?.task_id;
        if (!taskId) throw new Error(`Kling API returned no task_id: ${JSON.stringify(createData).slice(0, 300)}`);

        console.log(`[KLING-${comfyJobId}] Task created: ${taskId}`);
        jobState.stage = 'generating';
        jobState.stage_detail = `Kling generating video (task: ${taskId})`;

        // 2. Poll for completion
        const pollInterval = 5000;
        const timeout = 300000; // 5 min
        const startTime = Date.now();
        let videoUrl = null;

        while (Date.now() - startTime < timeout) {
          await new Promise(r => setTimeout(r, pollInterval));

          const pollToken = getKlingJWT(); // refresh JWT each poll
          const pollResp = await fetch(`${KLING_API_BASE}/v1/videos/image2video/${taskId}`, {
            headers: { 'Authorization': `Bearer ${pollToken}` },
          });

          if (!pollResp.ok) {
            console.warn(`[KLING-${comfyJobId}] Poll error: ${pollResp.status}`);
            continue;
          }

          const pollData = await pollResp.json();
          const taskStatus = pollData.data?.task_status;
          const taskProgress = pollData.data?.task_status_msg || '';

          if (taskStatus === 'succeed') {
            videoUrl = pollData.data?.task_result?.videos?.[0]?.url;
            if (!videoUrl) throw new Error('Kling task succeeded but no video URL returned');
            console.log(`[KLING-${comfyJobId}] ✓ Video ready: ${videoUrl.slice(0, 80)}...`);
            break;
          } else if (taskStatus === 'failed') {
            throw new Error(`Kling task failed: ${taskProgress || JSON.stringify(pollData.data).slice(0, 200)}`);
          }

          // Update progress
          const elapsed = Date.now() - startTime;
          jobState.generation_progress.percentage = Math.min(90, Math.round(elapsed / timeout * 100));
          jobState.stage_detail = `Kling generating... (${Math.round(elapsed / 1000)}s)`;
        }

        if (!videoUrl) throw new Error('Kling task timed out after 5 minutes');

        // 3. Download video from Kling
        jobState.stage = 'downloading';
        jobState.stage_detail = 'Downloading video from Kling';
        const videoResp = await fetch(videoUrl);
        if (!videoResp.ok) throw new Error(`Failed to download Kling video: ${videoResp.status}`);
        const videoBuffer = Buffer.from(await videoResp.arrayBuffer());
        const clipPath = path.join(OUTPUT_DIR, `${comfyJobId}.mp4`);
        fsSync.writeFileSync(clipPath, videoBuffer);
        console.log(`[KLING-${comfyJobId}] Downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);

        // 4. Upload to Supabase if available
        jobState.stage = 'uploading';
        jobState.stage_detail = 'Uploading to cloud storage';
        let publicUrl = null;
        if (supabase) {
          const storagePath = `jobs/${job_id}/img2vid_scene_${scene_index}.mp4`;
          const { error: uploadError } = await supabase.storage
            .from('story-videos')
            .upload(storagePath, videoBuffer, { contentType: 'video/mp4', upsert: true });
          if (uploadError) {
            console.error(`[KLING-${comfyJobId}] Storage upload failed:`, uploadError.message);
          } else {
            const { data: urlData } = supabase.storage.from('story-videos').getPublicUrl(storagePath);
            publicUrl = urlData.publicUrl;
            console.log(`[KLING-${comfyJobId}] ✓ Uploaded: ${storagePath}`);
          }
        }

        // 5. Record success
        jobState.status = 'complete';
        jobState.stage = 'complete';
        jobState.stage_detail = 'Done: Kling video generated';
        jobState.video_url = publicUrl || `/video/${comfyJobId}`;
        jobState.video_duration_seconds = 5.0;
        jobState.frame_count = 0; // Kling returns finished MP4
        jobState.completed_at = new Date().toISOString();
        jobState.generation_progress.percentage = 100;
        jobState.metadata = {
          renderer: 'kling_api',
          job_id,
          scene: scene_index,
          workflow: 'img2vid_kling',
          kling_task_id: taskId,
          motion_prompt: motion_prompt || '',
          kling_model: 'kling-v2-1',
          kling_mode: 'std',
          duration_seconds: 5.0,
          generation_time_ms: Date.now() - new Date(jobState.started_at).getTime(),
        };

        console.log(`[KLING-${comfyJobId}] ✓ Complete`);
      } catch (err) {
        console.error(`[KLING-${comfyJobId}] Failed:`, err.message);
        jobState.status = 'error';
        jobState.stage = 'error';
        jobState.stage_detail = `Failed: ${err.message.slice(0, 200)}`;
        jobState.completed_at = new Date().toISOString();
        jobState.errors.push({ error: err.message, fallback_reason: 'error' });
      }
      setTimeout(() => comfyJobs.delete(comfyJobId), 30 * 60 * 1000);
    })();

    return; // Skip ComfyUI path
  }

  // ── ComfyUI path (SVD, AnimateDiff, CogVideoX, Wan2.1) ──
  const health = await comfyui.checkHealthImg2Vid();
  if (!health.available) {
    return res.status(503).json({
      error: 'ComfyUI not available for img2vid',
      fallback_reason: health.fallback_reason,
      gpu_vram_free_mb: health.gpu_vram_free_mb,
      vram_floor_img2vid_mb: health.vram_floor_img2vid_mb,
    });
  }

  const comfyJobId = `vid_${uuidv4().slice(0, 8)}`;

  console.log(`\n[IMG2VID-${comfyJobId}] Starting image-to-video generation`);
  console.log(`[IMG2VID-${comfyJobId}]   Job: ${job_id}, Scene: ${scene_index}`);
  console.log(`[IMG2VID-${comfyJobId}]   Workflow: ${workflow}`);
  console.log(`[IMG2VID-${comfyJobId}]   Motion: ${motion_strength}, FPS: ${fps}, Frames: ${video_frames}`);
  console.log(`[IMG2VID-${comfyJobId}]   Resolution: ${width}x${height}${shouldUpscale ? ` → upscale to ${finalUpscaleW}x${finalUpscaleH}` : ''}`);

  // Initialize job tracking
  const jobState = {
    id: comfyJobId,
    job_id,
    type: 'img2vid',
    status: 'running',
    stage: 'initializing',       // Track current stage for UI
    stage_detail: 'Preparing image-to-video generation',
    workflow,
    scene_index,
    motion_strength,
    fps,
    video_frames,
    video_url: null,
    video_duration_seconds: null,
    frame_count: 0,
    generation_progress: {       // Real-time ComfyUI progress
      step: 0,
      max_steps: 0,
      percentage: 0,
      node: null,
    },
    errors: [],
    started_at: new Date().toISOString(),
    completed_at: null,
    metadata: {},
  };
  comfyJobs.set(comfyJobId, jobState);

  // Return immediately — generation runs in background
  const estimatedSecondsMap = {
    img2vid_svd: Math.round(video_frames * 2.5),      // SVD: ~2.5s per frame on 4070 Ti
    img2vid_animatediff: Math.round(video_frames * 1.5),
    img2vid_animatediff_ipa: Math.round(video_frames * 1.5),
    img2vid_cogvideox: Math.round(video_frames * 3),   // CogVideoX GGUF: ~3s per frame
    img2vid_cogvideox_fp8: Math.round(video_frames * 5), // CogVideoX fp8: ~5s per frame (higher quality)
    img2vid_wan: Math.round(video_frames * 4),          // Wan2.1 14B FP8 with block swap: ~4s per frame
  };
  const estimatedSeconds = estimatedSecondsMap[workflow] || Math.round(video_frames * 3);
  res.json({
    comfy_job_id: comfyJobId,
    status_url: `/comfyui-status/${comfyJobId}`,
    estimated_seconds: estimatedSeconds,
  });

  // ── Background generation ──
  (async () => {
    try {
      // 1. Download source image to ComfyUI input directory
      jobState.stage = 'downloading';
      jobState.stage_detail = 'Downloading source image to ComfyUI';
      console.log(`[IMG2VID-${comfyJobId}] Downloading source image...`);
      const inputFilename = await comfyui.downloadImageForComfyUI(image_url, job_id, scene_index);

      // 2. Load and configure workflow
      const seed = comfyui.hashSeed(job_id, scene_index + 10000); // offset seed from txt2img
      const workflowData = comfyui.loadImg2VidWorkflow(workflow, {
        inputImageFilename: inputFilename,
        seed,
        width,
        height,
        motionStrength: motion_strength,
        fps,
        videoFrames: video_frames,
        checkpoint: checkpoint || undefined,
        steps: steps || undefined,
        cfg: cfg || undefined,
        motionPrompt: motion_prompt,
        noiseAugStrength: noise_aug_strength,
      });

      // Log the actual parameters that will be sent to ComfyUI
      if (workflow === 'img2vid_svd' && workflowData['6']?.inputs) {
        const svdParams = workflowData['6'].inputs;
        console.log(`[IMG2VID-${comfyJobId}] SVD params → motion_bucket_id=${svdParams.motion_bucket_id}, augmentation=${svdParams.augmentation_level}, fps=${svdParams.fps}, frames=${svdParams.video_frames}`);
      }
      // AnimateDiff / IPA params
      if (workflow.includes('animatediff')) {
        if (workflowData['15']?.inputs) {
          console.log(`[IMG2VID-${comfyJobId}] AnimateDiff → model=${workflowData['15'].inputs.model_name}, motion_scale=${workflowData['15'].inputs.motion_scale ?? 'default'}`);
        }
        if (workflowData['22']?.inputs) {
          console.log(`[IMG2VID-${comfyJobId}] IPA → weight=${workflowData['22'].inputs.weight}, type=${workflowData['22'].inputs.weight_type}, end_at=${workflowData['22'].inputs.end_at}`);
        }
        if (workflowData['6']?.inputs) {
          console.log(`[IMG2VID-${comfyJobId}] Motion prompt → "${workflowData['6'].inputs.text}"`);
        }
        console.log(`[IMG2VID-${comfyJobId}] Denoise → ${workflowData['3']?.inputs?.denoise}`);
      }
      // CogVideoX params
      if (workflow === 'img2vid_cogvideox' || workflow === 'img2vid_cogvideox_fp8') {
        console.log(`[IMG2VID-${comfyJobId}] CogVideoX (${workflow}) → steps=${workflowData['6']?.inputs?.steps}, cfg=${workflowData['6']?.inputs?.cfg}, frames=${workflowData['6']?.inputs?.num_frames}`);
        console.log(`[IMG2VID-${comfyJobId}] Prompt → "${workflowData['2']?.inputs?.prompt?.slice(0, 80)}"`);
        console.log(`[IMG2VID-${comfyJobId}] ImageEncode noise_aug=${workflowData['5']?.inputs?.noise_aug_strength}`);
      }
      // Wan2.1 params
      if (workflow === 'img2vid_wan') {
        console.log(`[IMG2VID-${comfyJobId}] Wan2.1 → steps=${workflowData['10']?.inputs?.steps}, cfg=${workflowData['10']?.inputs?.cfg}, shift=${workflowData['10']?.inputs?.shift}`);
        console.log(`[IMG2VID-${comfyJobId}] Prompt → "${workflowData['5']?.inputs?.positive_prompt?.slice(0, 80)}"`);
        console.log(`[IMG2VID-${comfyJobId}] I2V → ${workflowData['9']?.inputs?.width}x${workflowData['9']?.inputs?.height}, frames=${workflowData['9']?.inputs?.num_frames}, noise_aug=${workflowData['9']?.inputs?.noise_aug_strength}`);
      }
      if (workflowData['3']?.inputs) {
        console.log(`[IMG2VID-${comfyJobId}] KSampler → steps=${workflowData['3'].inputs.steps}, cfg=${workflowData['3'].inputs.cfg}, seed=${workflowData['3'].inputs.seed}`);
      }
      if (workflowData['12']?.inputs) {
        console.log(`[IMG2VID-${comfyJobId}] CFGGuidance → min_cfg=${workflowData['12'].inputs.min_cfg}`);
      }

      // 3. Generate frames via ComfyUI (with real-time progress tracking)
      jobState.stage = 'loading_model';
      const modelNames = {
        img2vid_svd: 'SVD',
        img2vid_animatediff: 'AnimateDiff',
        img2vid_animatediff_ipa: 'AnimateDiff+IPA',
        img2vid_cogvideox: 'CogVideoX-5B (Q4)',
        img2vid_cogvideox_fp8: 'CogVideoX-1.5-5B (fp8)',
        img2vid_wan: 'Wan2.1-14B',
      };
      jobState.stage_detail = `Loading ${modelNames[workflow] || workflow} into VRAM (may take 1-2 min on first run)`;
      console.log(`[IMG2VID-${comfyJobId}] Generating video frames...`);

      const result = await comfyui.generateVideo(workflowData, undefined, (progress) => {
        // Real-time progress callback from ComfyUI WebSocket
        jobState.generation_progress = {
          step: progress.step,
          max_steps: progress.max_steps,
          percentage: progress.percentage,
          node: progress.node,
        };
        if (progress.stage === 'generating') {
          jobState.stage = 'generating';
          if (progress.step > 0) {
            jobState.stage_detail = `Generating frames: step ${progress.step}/${progress.max_steps} (${progress.percentage}%)`;
          } else {
            jobState.stage_detail = 'Processing model nodes...';
          }
        }
        // Log every 10% milestone
        if (progress.step > 0 && progress.max_steps > 0 && progress.step % Math.ceil(progress.max_steps / 10) === 0) {
          console.log(`[IMG2VID-${comfyJobId}] Progress: ${progress.step}/${progress.max_steps} (${progress.percentage}%)`);
        }
      });

      const frames = result.frames;
      jobState.frame_count = frames.length;

      console.log(`[IMG2VID-${comfyJobId}] Got ${frames.length} frames, combining into MP4...`);

      // 4. Write frames to temp dir
      const tmpDir = path.join(OUTPUT_DIR, `img2vid_${comfyJobId}`);
      if (!fsSync.existsSync(tmpDir)) {
        fsSync.mkdirSync(tmpDir, { recursive: true });
      }

      for (let i = 0; i < frames.length; i++) {
        const framePath = path.join(tmpDir, `frame_${String(i).padStart(4, '0')}.png`);
        fsSync.writeFileSync(framePath, frames[i]);
      }

      // 5. Combine frames into MP4 with FFmpeg (+ optional upscale)
      jobState.stage = 'encoding';
      jobState.stage_detail = `Encoding ${frames.length} frames to MP4 (${fps}fps)${shouldUpscale ? ` + upscale ${width}x${height} → ${finalUpscaleW}x${finalUpscaleH}` : ''}`;
      const clipPath = path.join(OUTPUT_DIR, `${comfyJobId}.mp4`);
      const ffmpegOpts = [
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-preset fast',
        '-crf 18',
        '-movflags +faststart',
      ];
      // Upscale via FFmpeg lanczos filter + sharpening — much sharper than bicubic
      // v8.1: Stronger sharpening (luma=0.9, chroma=0.4) to counteract AnimateDiff softness
      // unsharp=luma_msize_x:luma_msize_y:luma_amount:chroma_msize_x:chroma_msize_y:chroma_amount
      if (shouldUpscale) {
        // v8.2: Added light film grain (noise) after sharpening — hides AI softness.
        // noise(alls=3:allf=t) = 3 strength, temporal noise (varies per frame = natural)
        // Reduced sharpening slightly since higher base res means less aggressive upscale.
        ffmpegOpts.unshift(`-vf scale=${finalUpscaleW}:${finalUpscaleH}:flags=lanczos,unsharp=5:5:0.8:5:5:0.35,noise=alls=3:allf=t`);
        console.log(`[IMG2VID-${comfyJobId}] Upscaling ${width}x${height} → ${finalUpscaleW}x${finalUpscaleH} (lanczos+sharpen+grain)`);
      } else {
        // Even without upscale, apply grain to hide AI artifacts
        ffmpegOpts.unshift(`-vf noise=alls=3:allf=t`);
      }
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(path.join(tmpDir, 'frame_%04d.png'))
          .inputFPS(fps)
          .outputOptions(ffmpegOpts)
          .output(clipPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });

      console.log(`[IMG2VID-${comfyJobId}] ✓ MP4 created: ${clipPath}`);

      // 6. Upload to Supabase Storage if available
      jobState.stage = 'uploading';
      jobState.stage_detail = 'Uploading clip to cloud storage';
      let publicUrl = null;
      if (supabase) {
        const clipBuffer = fsSync.readFileSync(clipPath);
        const storagePath = `jobs/${job_id}/img2vid_scene_${scene_index}.mp4`;

        const { error: uploadError } = await supabase.storage
          .from('story-videos')
          .upload(storagePath, clipBuffer, {
            contentType: 'video/mp4',
            upsert: true,
          });

        if (uploadError) {
          console.error(`[IMG2VID-${comfyJobId}] Storage upload failed:`, uploadError.message);
        } else {
          const { data: urlData } = supabase.storage
            .from('story-videos')
            .getPublicUrl(storagePath);
          publicUrl = urlData.publicUrl;
          console.log(`[IMG2VID-${comfyJobId}] ✓ Uploaded: ${storagePath}`);
        }
      }

      // 7. Calculate clip duration
      const durationSeconds = parseFloat((frames.length / fps).toFixed(2));

      // 8. Record success
      jobState.status = 'complete';
      jobState.stage = 'complete';
      jobState.stage_detail = `Done: ${frames.length} frames → ${durationSeconds}s clip`;
      jobState.video_url = publicUrl || `/video/${comfyJobId}`;
      jobState.video_duration_seconds = durationSeconds;
      jobState.completed_at = new Date().toISOString();
      jobState.metadata = {
        renderer: 'comfyui_img2vid',
        job_id,
        scene: scene_index,
        workflow,
        checkpoint: checkpoint || '(default)',
        seed,
        motion_strength,
        fps,
        video_frames: frames.length,
        render_width: width,
        render_height: height,
        output_width: shouldUpscale ? finalUpscaleW : width,
        output_height: shouldUpscale ? finalUpscaleH : height,
        upscaled: shouldUpscale,
        duration_seconds: durationSeconds,
        generation_time_ms: result.metadata.generation_time_ms,
        comfyui_prompt_id: result.prompt_id,
        steps: steps || (workflow === 'img2vid_svd' ? 20 : 15),
        cfg: cfg || (workflow === 'img2vid_svd' ? 2.5 : 7.0),
      };

      console.log(`[IMG2VID-${comfyJobId}] ✓ Complete: ${frames.length} frames → ${durationSeconds}s clip`);

      // 9. Cleanup temp frames
      try {
        const tmpFiles = fsSync.readdirSync(tmpDir);
        for (const f of tmpFiles) fsSync.unlinkSync(path.join(tmpDir, f));
        fsSync.rmdirSync(tmpDir);
      } catch { /* non-critical */ }

    } catch (err) {
      console.error(`[IMG2VID-${comfyJobId}] Failed:`, err.message);
      jobState.status = 'error';
      jobState.stage = 'error';
      jobState.stage_detail = `Failed: ${err.message.slice(0, 200)}`;
      jobState.completed_at = new Date().toISOString();
      jobState.errors.push({
        error: err.message,
        fallback_reason: err.message.includes('timed out')
          ? comfyui.FALLBACK_REASONS.TIMEOUT
          : comfyui.FALLBACK_REASONS.ERROR,
      });
    }

    // Cleanup after 30 min
    setTimeout(() => {
      comfyJobs.delete(comfyJobId);
    }, 30 * 60 * 1000);
  })();
});

/**
 * POST /suggest-motion-prompt — LLM-powered motion prompt suggestion
 *
 * Takes a scene description (the image prompt or user description) and returns
 * a focused AnimateDiff motion prompt via GPT-4o-mini.
 *
 * Body: { scene_description: string }
 * Returns: { motion_prompt: string, source: 'llm' | 'fallback' }
 */
app.post('/suggest-motion-prompt', async (req, res) => {
  const { scene_description } = req.body;
  if (!scene_description || typeof scene_description !== 'string') {
    return res.status(400).json({ error: 'Missing scene_description' });
  }

  if (!OPENAI_API_KEY) {
    // Fallback: keyword-based prompt (mirrors worker buildMotionPrompt logic)
    return res.json({
      motion_prompt: 'cinematic motion, slow atmospheric drift, subtle ambient movement',
      source: 'fallback',
      reason: 'OPENAI_API_KEY not configured',
    });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 80,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content: `You are a motion prompt writer for AnimateDiff video generation. Given a scene description, output ONLY a short motion prompt (max 20 words) describing ambient/atmospheric motion.

CRITICAL — AnimateDiff LIMITATIONS:
- AnimateDiff CANNOT move specific body parts (fingers, hands, arms, legs, mouth, eyes)
- AnimateDiff CANNOT do actions (walking, pointing, grabbing, writing, speaking)
- AnimateDiff CAN do: ambient particle motion (snow, rain, dust, smoke, fog, sparks)
- AnimateDiff CAN do: environmental sway (branches, grass, curtains, hair, fabric, water)
- AnimateDiff CAN do: lighting shifts (flickering, pulsing, shadow movement, light rays)
- AnimateDiff CAN do: camera motion (slow pan, gentle zoom, subtle drift, push-in)
- AnimateDiff CAN do: atmospheric effects (wind, clouds moving, fire, reflections)

RULES:
- NEVER suggest body part movements or human actions — they will fail
- Focus on 2-3 ambient/environmental motions the scene naturally has
- Use present participle verbs (falling, drifting, flickering, swaying, flowing)
- Include one camera hint if appropriate (slow pan, gentle zoom, static)
- Always end with "cinematic"
- Keep it concise — short focused prompts work best

EXAMPLES:
Scene: "A dark hallway with flickering fluorescent lights and a shadowy figure"
Motion: "lights flickering rapidly, shadows shifting on walls, slow push-in camera, cinematic"

Scene: "A woman sitting at a desk reading papers, window curtains behind her"
Motion: "curtains billowing gently, warm light shifting across desk, soft dust particles, cinematic"

Scene: "A snowy forest path with pine trees covered in snow"
Motion: "snowflakes drifting softly, pine branches swaying in wind, gentle camera drift, cinematic"

Scene: "An old man at a microphone in a dimly lit room with candles"
Motion: "candlelight flickering warmly, soft shadows dancing on walls, subtle camera zoom, cinematic"

Scene: "A person reading a book by a fireplace"
Motion: "fire crackling with dancing flames, warm light pulsing across pages, gentle smoke wisps, cinematic"

Output ONLY the motion prompt, nothing else.`,
          },
          {
            role: 'user',
            content: scene_description.slice(0, 1000),
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[SUGGEST-MOTION] GPT error: ${response.status} ${errText.slice(0, 200)}`);
      return res.json({
        motion_prompt: 'cinematic motion, slow atmospheric drift, subtle ambient movement',
        source: 'fallback',
        reason: `GPT error: ${response.status}`,
      });
    }

    const data = await response.json();
    let motionPrompt = data.choices?.[0]?.message?.content?.trim() || '';

    if (!motionPrompt || motionPrompt.length < 5) {
      return res.json({
        motion_prompt: 'cinematic motion, slow atmospheric drift, subtle ambient movement',
        source: 'fallback',
        reason: 'empty response',
      });
    }

    // Ensure it ends with cinematic
    if (!motionPrompt.endsWith('cinematic')) {
      motionPrompt = motionPrompt.replace(/[,.\s]+$/, '') + ', cinematic';
    }

    console.log(`[SUGGEST-MOTION] "${motionPrompt.slice(0, 120)}"`);
    return res.json({ motion_prompt: motionPrompt, source: 'llm' });

  } catch (err) {
    console.error('[SUGGEST-MOTION] Exception:', err);
    return res.json({
      motion_prompt: 'cinematic motion, slow atmospheric drift, subtle ambient movement',
      source: 'fallback',
      reason: err.message || 'unknown error',
    });
  }
});

/**
 * POST /test-img2vid - Test image-to-video generation with a single image
 * 
 * Body: {
 *   image_url: string,            // URL of the image to animate (required)
 *   motion_strength?: number,     // 0.0-1.0 (default: 0.5)
 *   fps?: number,                 // frames per second (default: 6)
 *   video_frames?: number,        // total frames (default: 25)
 *   width?: number,               // render width (default: 640)
 *   height?: number,              // render height (default: 1136)
 *   upscale_to_width?: number,    // upscale output width (default: 1024)
 *   upscale_to_height?: number,   // upscale output height (default: 1536)
 *   workflow?: string,            // 'img2vid_svd' (default)
 * }
 *
 * Returns: { comfy_job_id, status_url, estimated_seconds }
 * Poll GET /comfyui-status/:id for progress and final video_url
 */
app.post('/test-img2vid', async (req, res) => {
  if (!comfyui) {
    return res.status(503).json({ error: 'ComfyUI integration not available' });
  }

  const {
    image_url,
    motion_strength = 0.5,
    fps = 6,
    video_frames = 25,
    width = 640,
    height = 1136,
    upscale_to_width = 1024,
    upscale_to_height = 1536,
    workflow = 'img2vid_svd',
    checkpoint,
    steps,
    cfg,
    motion_prompt,
  } = req.body;

  if (!image_url) {
    return res.status(400).json({ error: 'Missing image_url' });
  }

  const testJobId = `test_${uuidv4().slice(0, 8)}`;
  console.log(`\n[TEST-IMG2VID] Testing img2vid with image: ${image_url.slice(0, 80)}...`);
  console.log(`[TEST-IMG2VID] Resolution: ${width}x${height} → ${upscale_to_width}x${upscale_to_height}, motion=${motion_strength}, fps=${fps}, frames=${video_frames}`);

  // Forward to /comfyui-img2vid via internal fetch
  try {
    const port = process.env.PORT || 3001;
    const resp = await fetch(`http://127.0.0.1:${port}/comfyui-img2vid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: testJobId,
        scene_index: 0,
        image_url,
        workflow,
        motion_strength,
        fps,
        video_frames,
        width,
        height,
        upscale_to_width,
        upscale_to_height,
        checkpoint,
        steps,
        cfg,
        motion_prompt,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);
    return res.json({
      ...data,
      test_job_id: testJobId,
      message: `Test img2vid started. Poll ${data.status_url} for progress.`,
    });
  } catch (err) {
    return res.status(500).json({ error: `Internal forward failed: ${err.message}` });
  }
});

/**
 * GET /test-img2vid-ui - Serve the test UI page
 */
app.get('/test-img2vid-ui', (req, res) => {
  const uiPath = path.join(__dirname, '..', 'pages', 'test-img2vid.html');
  if (fsSync.existsSync(uiPath)) {
    res.sendFile(uiPath);
  } else {
    res.status(404).send('Test UI page not found. Expected at: pages/test-img2vid.html');
  }
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
    comfyui: !!comfyui,
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
    version: '3.0.0',
    endpoints: {
      'POST /render': 'Start a new video render job',
      'GET /status/:id': 'Check render job status',
      'GET /video/:id': 'Download finished video',
      'POST /generate-images': 'Generate images in parallel (4-6 at once)',
      'GET /images-status/:id': 'Check parallel image generation status',
      'GET /health': 'Health check',
      'GET /comfyui-health': 'ComfyUI availability + GPU status',
      'POST /comfyui-generate': 'Generate images via local ComfyUI',
      'POST /comfyui-img2vid': 'Generate video clip from image via local ComfyUI',
      'GET /comfyui-status/:id': 'Check ComfyUI generation/video status',
    },
    config: {
      max_parallel_images: MAX_PARALLEL_IMAGES,
      openai_configured: !!OPENAI_API_KEY,
      replicate_configured: !!REPLICATE_API_TOKEN,
      supabase_configured: !!supabase,
      comfyui_loaded: !!comfyui,
      kling_configured: !!(KLING_ACCESS_KEY && KLING_SECRET_KEY),
    },
  });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('');
  console.log('🎬 Horror Video Renderer v3.0');
  console.log('================================');
  console.log(`   Port: ${PORT}`);
  console.log(`   Supabase: ${supabase ? '✅ Connected' : '❌ Not configured'}`);
  console.log(`   OpenAI: ${OPENAI_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`   Replicate: ${REPLICATE_API_TOKEN ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`   ComfyUI: ${comfyui ? '✅ Loaded' : '⚠️ Not available'}`);
  console.log(`   Kling: ${KLING_ACCESS_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`   Max concurrent renders: ${MAX_CONCURRENT_RENDERS}`);
  console.log(`   Max parallel images: ${MAX_PARALLEL_IMAGES}`);
  console.log('');
  console.log('Endpoints:');
  console.log('   POST /render             - Start video render');
  console.log('   GET  /status/:id         - Check render status');
  console.log('   POST /generate-images    - Start parallel image gen');
  console.log('   GET  /images-status/:id  - Check image gen status');
  console.log('   GET  /comfyui-health     - ComfyUI GPU + queue status');
  console.log('   POST /comfyui-generate   - Generate via local ComfyUI');
  console.log('   POST /comfyui-img2vid    - Image → video via local ComfyUI');
  console.log('   GET  /comfyui-status/:id - Check ComfyUI gen/vid status');
  console.log('   GET  /health             - Health check');
  console.log('');

  // ── Warmup: Pre-load the default SDXL checkpoint into VRAM ──
  // Cold loading a 6.5 GB checkpoint with constrained VRAM can take 2-3 minutes.
  // By generating a tiny warmup image at startup, subsequent requests are near-instant (~5 s).
  if (comfyui && process.env.COMFYUI_SKIP_WARMUP !== '1') {
    (async () => {
      try {
        console.log('[COMFYUI-WARMUP] Pre-loading default checkpoint...');
        const warmupStart = Date.now();

        const workflow = comfyui.loadWorkflow(comfyui.COMFYUI_DEFAULT_WORKFLOW || 'txt2img_sdxl', {
          positive: 'warmup test, blank canvas',
          negative: 'blurry',
          seed: 1,
          width: 64,   // Tiny resolution — we only care about loading the model
          height: 64,
          steps: 1,    // Single step — fastest possible
        });

        await comfyui.generateImage(workflow, 300000); // 5 min timeout for cold load
        const elapsed = ((Date.now() - warmupStart) / 1000).toFixed(1);
        console.log(`[COMFYUI-WARMUP] ✓ Checkpoint pre-loaded in ${elapsed}s — subsequent generations will be fast`);
      } catch (err) {
        console.warn(`[COMFYUI-WARMUP] ⚠ Warmup failed (non-fatal): ${err.message}`);
      }
    })();
  }
});
