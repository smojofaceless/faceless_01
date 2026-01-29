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
// Render.com sets RENDER=true, container has 512MB on free tier
// os.totalmem() returns HOST memory, not container limit!
const os = require('os');
const TOTAL_MEMORY_MB = Math.floor(os.totalmem() / 1024 / 1024);
const IS_RENDER = process.env.RENDER === 'true' || !!process.env.RENDER_INSTANCE_ID;
const IS_RAILWAY = !!process.env.RAILWAY_ENVIRONMENT;
const FORCE_LOW_MEMORY = process.env.FORCE_LOW_MEMORY === 'true';

// Auto-enable low memory for cloud free tiers
// Render.com free tier = 512MB, Railway free tier = 512MB
const AUTO_LOW_MEMORY = IS_RENDER || IS_RAILWAY || FORCE_LOW_MEMORY;

console.log(`📊 System memory: ${TOTAL_MEMORY_MB}MB (host), Cloud: ${IS_RENDER ? 'Render.com' : IS_RAILWAY ? 'Railway' : 'none'}`);
console.log(`📊 Low memory mode: ${AUTO_LOW_MEMORY ? 'ENABLED (cloud free tier detected)' : 'disabled'}`);

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
 * Ken Burns effect - scale + position animation
 * Memory-optimized version - uses smaller scale factor
 */
function getKenBurnsFilter(index, duration, width = 1080, height = 1920) {
  const frames = Math.floor(duration * 30); // 30fps
  // Use 2x scale instead of 8x to reduce memory usage significantly
  const scaledW = width * 2;
  const scaledH = height * 2;
  const effects = [
    // Zoom in slowly
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='min(zoom+0.001,1.3)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=30`,
    // Zoom out slowly  
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='if(lte(zoom,1.0),1.3,max(1.001,zoom-0.001))':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=30`,
    // Pan left to right with slight zoom
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.15':d=${frames}:x='(iw-iw/zoom)/2+((iw/zoom-ow)/3)*sin(on/${frames}*PI)':y='(ih-ih/zoom)/2':s=${width}x${height}:fps=30`,
    // Pan right to left with slight zoom
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},zoompan=z='1.15':d=${frames}:x='(iw-iw/zoom)/2-((iw/zoom-ow)/3)*sin(on/${frames}*PI)':y='(ih-ih/zoom)/2':s=${width}x${height}:fps=30`,
  ];
  return effects[index % effects.length];
}

/**
 * Ultra-simple Ken Burns for very low memory (512MB) environments
 * No zoompan filter - just simple scale and fade
 */
function getSimpleKenBurnsFilter(index, duration, width = 1080, height = 1920) {
  // Simple scale-to-fill with no animation (minimal memory)
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
}

/**
 * Create video from images - one scene at a time
 */
async function createVideoFromImages(jobId, images, durations, outputPath, options = {}) {
  const { kenBurns = true, lowMemory = false } = options;
  const tempVideos = [];
  const width = 1080;
  const height = 1920;
  const fps = 30;
  
  console.log(`[${jobId}] Processing ${images.length} images (lowMemory: ${lowMemory})`);
  
  // Step 1: Create individual video clips for each image
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
      
      // Apply Ken Burns or simple scale
      if (kenBurns) {
        const filter = lowMemory 
          ? getSimpleKenBurnsFilter(i, duration, width, height)
          : getKenBurnsFilter(i, duration, width, height);
        cmd = cmd.complexFilter(filter);
      } else {
        cmd = cmd
          .inputOptions(['-framerate', '30'])
          .videoFilter(`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`);
      }
      
      const outputOptions = [
        '-c:v', 'libx264',
        '-preset', lowMemory ? 'ultrafast' : 'medium',
        '-crf', lowMemory ? '28' : '23',
        '-t', String(duration),
        '-pix_fmt', 'yuv420p',
        '-r', '30',
      ];
      
      if (lowMemory) {
        outputOptions.push('-threads', '1');
      }
      
      cmd
        .outputOptions(outputOptions)
        .output(tempVideo)
        .on('start', (cmdLine) => console.log(`[${jobId}] Scene ${i + 1} started`))
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
    ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions([
        '-c:v', 'libx264',
        '-preset', lowMemory ? 'ultrafast' : 'medium',
        '-crf', lowMemory ? '26' : '22',
        '-pix_fmt', 'yuv420p',
      ])
      .output(outputPath)
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
 * Add vignette effect
 */
async function addVignette(inputPath, outputPath, lowMemory = false) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilter('vignette=PI/4')
      .outputOptions([
        '-c:v', 'libx264',
        '-preset', lowMemory ? 'ultrafast' : 'medium',
        '-crf', lowMemory ? '26' : '23',
        '-c:a', 'copy',
      ])
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
    ffmpeg(inputPath)
      .videoFilter([
        // Desaturate + increase contrast + cold tint
        'eq=saturation=0.7:contrast=1.15:brightness=-0.03',
        'colorbalance=rs=-0.05:gs=-0.05:bs=0.1',
      ].join(','))
      .outputOptions([
        '-c:v', 'libx264',
        '-preset', lowMemory ? 'ultrafast' : 'medium',
        '-crf', lowMemory ? '26' : '23',
        '-c:a', 'copy',
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
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
  },
  elegant: {
    fontName: 'Times New Roman',
    fontSize: 75,
    fontWeight: 'normal',
  },
  modern: {
    fontName: 'Arial',
    fontSize: 80,
    fontWeight: 'bold',
  },
  horror: {
    fontName: 'Impact',
    fontSize: 90,
    fontWeight: 'bold',
  },
  minimal: {
    fontName: 'Arial',
    fontSize: 65,
    fontWeight: 'normal',
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
Style: Default,${style.fontName},${style.fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,${style.fontWeight === 'bold' ? 1 : 0},0,0,0,100,100,0,0,1,4,2,2,30,30,400,1
Style: Scary,${style.fontName},${Math.round(style.fontSize * 1.1)},&H000000FF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,2,2,30,30,400,1

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
 */
async function burnSubtitles(inputPath, assPath, outputPath, lowMemory = false) {
  return new Promise((resolve, reject) => {
    // Use ass filter to burn subtitles
    // Need to escape colons and backslashes in Windows paths
    const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    
    ffmpeg(inputPath)
      .videoFilter(`ass='${escapedAssPath}'`)
      .outputOptions([
        '-c:v', 'libx264',
        '-preset', lowMemory ? 'ultrafast' : 'medium',
        '-crf', lowMemory ? '26' : '23',
        '-c:a', 'copy',
      ])
      .output(outputPath)
      .on('start', (cmd) => console.log(`  → Burning subtitles...`))
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
      audio_url,        // Audio file URL
      durations,        // Duration for each image in seconds
      captions = [],    // Word-by-word captions: [{ word, start, end }, ...]
      effects = {},     // { kenBurns, vignette, horrorGrade, fadeTransitions, captionStyle, highlightScary }
      webhook_url,      // Optional callback URL when done
      job_id: supabaseJobId, // Original Supabase job ID for updating
      low_memory = false, // Enable low memory mode for free tier hosting
    } = req.body;
    
    if (!images || images.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }
    
    console.log(`[${jobId}] New render job: ${images.length} images, audio: ${audio_url ? 'yes' : 'no'}, captions: ${captions.length} words`);
    console.log(`[${jobId}] Effects:`, effects);
    console.log(`[${jobId}] Supabase job: ${supabaseJobId || 'none'}`);
    
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
    processRender(jobId, images, audio_url, durations, captions, effects, webhook_url, supabaseJobId, low_memory);
    
  } catch (error) {
    console.error('[RENDER] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Async render processing
 */
async function processRender(jobId, imageUrls, audioUrl, durations, captions, effects, webhookUrl, supabaseJobId, lowMemory) {
  activeRenders++;
  const jobDir = path.join(TEMP_DIR, jobId);
  await fs.mkdir(jobDir, { recursive: true });
  
  // Auto-enable low memory mode if on cloud free tier
  const useLowMemory = lowMemory || AUTO_LOW_MEMORY;
  if (useLowMemory) {
    console.log(`[${jobId}] ⚠️ Low memory mode ENABLED (Cloud: ${IS_RENDER ? 'Render.com' : IS_RAILWAY ? 'Railway' : 'env'})`);
  }
  
  try {
    const job = jobs.get(jobId);
    
    // Step 1: Download images (handle base64 and URLs)
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
    console.log(`[${jobId}] Creating video from images (lowMemory: ${useLowMemory})...`);
    const rawVideoPath = path.join(jobDir, 'raw.mp4');
    await createVideoFromImages(jobId, imagePaths, durations, rawVideoPath, {
      kenBurns: effects.kenBurns !== false,
      lowMemory: useLowMemory,
    });
    job.progress = 50;
    console.log(`[${jobId}] ✓ Base video created`);
    
    // Step 4: Add audio
    let currentVideo = rawVideoPath;
    if (audioPath) {
      console.log(`[${jobId}] Adding audio...`);
      const withAudioPath = path.join(jobDir, 'with_audio.mp4');
      await addAudioToVideo(currentVideo, audioPath, withAudioPath);
      await fs.unlink(currentVideo).catch(() => {});
      currentVideo = withAudioPath;
      console.log(`[${jobId}] ✓ Audio added`);
    }
    job.progress = 60;
    
    // Step 5: Add captions (if provided)
    if (captions && captions.length > 0) {
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
      console.log(`[${jobId}] ✓ Captions added`);
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
    
    // Step 7: Move to output directory
    const finalPath = path.join(OUTPUT_DIR, `${jobId}.mp4`);
    await fs.copyFile(currentVideo, finalPath);
    console.log(`[${jobId}] ✓ Final video saved locally`);
    
    // Step 8: Upload to Supabase Storage
    let supabaseUrl = null;
    if (supabase && supabaseJobId) {
      supabaseUrl = await uploadToSupabase(finalPath, supabaseJobId);
    }
    
    // Update job status
    job.progress = 100;
    job.status = 'complete';
    job.url = `/video/${jobId}`;
    job.supabase_url = supabaseUrl;
    
    console.log(`[${jobId}] ✅ Render complete!`);
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
    version: '2.0.0',
    endpoints: {
      'POST /render': 'Start a new render job',
      'GET /status/:id': 'Check job status',
      'GET /video/:id': 'Download finished video',
      'GET /health': 'Health check',
    },
  });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('');
  console.log('🎬 Horror Video Renderer v2.0');
  console.log('================================');
  console.log(`   Port: ${PORT}`);
  console.log(`   Supabase: ${supabase ? '✅ Connected' : '❌ Not configured'}`);
  console.log(`   Max concurrent renders: ${MAX_CONCURRENT_RENDERS}`);
  console.log('');
  console.log('Endpoints:');
  console.log('   POST /render   - Start render job');
  console.log('   GET  /status/:id - Check job status');
  console.log('   GET  /video/:id  - Download video');
  console.log('   GET  /health     - Health check');
  console.log('');
});
