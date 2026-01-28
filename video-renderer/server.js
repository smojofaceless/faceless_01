/**
 * FFmpeg Video Renderer Service
 * 
 * Replaces Creatomate with local FFmpeg rendering.
 * Deploy to Render.com, Railway, or Fly.io (all have free tiers).
 * 
 * Endpoints:
 *   POST /render - Start a render job
 *   GET /status/:id - Check render status
 *   GET /video/:id - Download finished video
 */

const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// In-memory job storage (use Redis in production)
const jobs = new Map();

// Temp directory for processing
const TEMP_DIR = process.env.TEMP_DIR || '/tmp/renders';
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/tmp/outputs';

// Memory optimization: limit concurrent FFmpeg processes
let activeRenders = 0;
const MAX_CONCURRENT_RENDERS = 1; // Only 1 at a time on 512MB

// Ensure directories exist
async function ensureDirs() {
  await fs.mkdir(TEMP_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}
ensureDirs();

/**
 * Download a file from URL to local path
 */
async function downloadFile(url, outputPath) {
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream',
    timeout: 60000, // 60s timeout
  });
  
  const writer = fsSync.createWriteStream(outputPath);
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/**
 * MEMORY-OPTIMIZED Ken Burns - simpler filter, less memory
 * Uses scale instead of zoompan for lower memory footprint
 */
function getSimpleKenBurnsFilter(index, duration, width = 1080, height = 1920) {
  // Simple scale + slight motion - much less memory than zoompan
  const effects = [
    // Slight zoom in via scale + crop
    `scale=1200:2133,crop=${width}:${height}:60:107`,
    // Different crop position for variety
    `scale=1200:2133,crop=${width}:${height}:0:0`,
    `scale=1200:2133,crop=${width}:${height}:120:213`,
    `scale=1200:2133,crop=${width}:${height}:60:0`,
  ];
  return effects[index % effects.length];
}

/**
 * MEMORY-OPTIMIZED: Create video from images
 * Processes one scene at a time, cleans up immediately
 */
async function createVideoFromImages(jobId, images, durations, outputPath, options = {}) {
  const { kenBurns = true, fadeTransitions = true } = options;
  const tempVideos = [];
  
  console.log(`[${jobId}] Processing ${images.length} images (memory-optimized mode)`);
  
  // Step 1: Create individual video clips for each image (ONE AT A TIME)
  for (let i = 0; i < images.length; i++) {
    const imagePath = images[i];
    const duration = durations[i] || 5;
    const tempVideo = path.join(TEMP_DIR, `${jobId}_scene_${i}.mp4`);
    tempVideos.push(tempVideo);
    
    // Force garbage collection hint
    if (global.gc) global.gc();
    
    await new Promise((resolve, reject) => {
      let cmd = ffmpeg(imagePath)
        .inputOptions(['-loop', '1', '-framerate', '24']) // 24fps instead of 30 = less memory
        .duration(duration);
      
      // Apply simplified Ken Burns effect (or just scale)
      if (kenBurns) {
        const filter = getSimpleKenBurnsFilter(i, duration);
        cmd = cmd.videoFilter(filter);
      } else {
        // Just scale to output size
        cmd = cmd.videoFilter(`scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2`);
      }
      
      cmd
        .outputOptions([
          '-c:v', 'libx264',
          '-preset', 'ultrafast', // Faster = less memory
          '-crf', '28', // Slightly lower quality = smaller files
          '-t', String(duration),
          '-pix_fmt', 'yuv420p',
          '-r', '24',
          '-threads', '1', // Single thread = less memory
        ])
        .output(tempVideo)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    
    console.log(`[${jobId}] Created scene ${i + 1}/${images.length}`);
    
    // Delete source image immediately after processing
    await fs.unlink(imagePath).catch(() => {});
  }
  
  // Step 2: Concatenate all clips (simple method - less memory)
  const listFile = path.join(TEMP_DIR, `${jobId}_list.txt`);
  const listContent = tempVideos.map(v => `file '${v}'`).join('\n');
  await fs.writeFile(listFile, listContent);
  
  // Simple concatenation (xfade uses too much memory on free tier)
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions([
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '26',
        '-pix_fmt', 'yuv420p',
        '-threads', '1',
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
  
  // Cleanup temp videos immediately
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
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

/**
 * Add vignette effect (memory-optimized)
 */
async function addVignette(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilter('vignette=PI/4')
      .outputOptions([
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '26',
        '-c:a', 'copy',
        '-threads', '1',
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

/**
 * Add horror color grading (memory-optimized - simplified filter)
 */
async function addHorrorGrade(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilter([
        // Simplified: just desaturate + contrast (curves uses more memory)
        'eq=saturation=0.75:contrast=1.15:brightness=-0.05',
      ].join(','))
      .outputOptions([
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '26',
        '-c:a', 'copy',
        '-threads', '1',
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

/**
 * Main render endpoint
 */
app.post('/render', async (req, res) => {
  // Check if we're at capacity (memory protection)
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    return res.status(503).json({ 
      error: 'Server busy - try again in 60 seconds',
      retry_after: 60,
    });
  }
  
  const jobId = uuidv4();
  
  try {
    const {
      images,          // Array of image URLs
      audio_url,       // Audio file URL
      durations,       // Duration for each image in seconds
      effects = {},    // { kenBurns: true, vignette: true, horrorGrade: true, fadeTransitions: true }
      webhook_url,     // Optional callback URL when done
    } = req.body;
    
    if (!images || images.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }
    
    // Initialize job
    jobs.set(jobId, {
      id: jobId,
      status: 'downloading',
      progress: 0,
      created_at: new Date().toISOString(),
      url: null,
      error: null,
    });
    
    res.json({ 
      success: true, 
      job_id: jobId,
      status_url: `/status/${jobId}`,
    });
    
    // Process asynchronously
    processRender(jobId, images, audio_url, durations, effects, webhook_url);
    
  } catch (error) {
    console.error('Render error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Async render processing
 */
async function processRender(jobId, imageUrls, audioUrl, durations, effects, webhookUrl) {
  activeRenders++;
  const jobDir = path.join(TEMP_DIR, jobId);
  await fs.mkdir(jobDir, { recursive: true });
  
  try {
    const job = jobs.get(jobId);
    
    // Step 1: Download images
    console.log(`[${jobId}] Downloading ${imageUrls.length} images...`);
    const imagePaths = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const imgPath = path.join(jobDir, `image_${i}.png`);
      await downloadFile(imageUrls[i], imgPath);
      imagePaths.push(imgPath);
      job.progress = Math.round((i + 1) / imageUrls.length * 20);
    }
    job.status = 'processing';
    
    // Step 2: Download audio
    console.log(`[${jobId}] Downloading audio...`);
    const audioPath = path.join(jobDir, 'audio.mp3');
    if (audioUrl) {
      await downloadFile(audioUrl, audioPath);
    }
    job.progress = 25;
    
    // Step 3: Create video from images
    console.log(`[${jobId}] Creating video from images...`);
    const rawVideoPath = path.join(jobDir, 'raw.mp4');
    await createVideoFromImages(jobId, imagePaths, durations, rawVideoPath, {
      kenBurns: effects.kenBurns !== false,
      fadeTransitions: effects.fadeTransitions !== false,
    });
    job.progress = 50;
    
    // Step 4: Add audio
    let currentVideo = rawVideoPath;
    if (audioUrl) {
      console.log(`[${jobId}] Adding audio...`);
      const withAudioPath = path.join(jobDir, 'with_audio.mp4');
      await addAudioToVideo(currentVideo, audioPath, withAudioPath);
      currentVideo = withAudioPath;
    }
    job.progress = 65;
    
    // Step 5: Apply vignette (if enabled)
    if (effects.vignette) {
      console.log(`[${jobId}] Adding vignette...`);
      const vignettePath = path.join(jobDir, 'vignette.mp4');
      await addVignette(currentVideo, vignettePath);
      currentVideo = vignettePath;
    }
    job.progress = 80;
    
    // Step 6: Apply horror color grade (if enabled)
    if (effects.horrorGrade) {
      console.log(`[${jobId}] Adding horror color grade...`);
      const gradedPath = path.join(jobDir, 'graded.mp4');
      await addHorrorGrade(currentVideo, gradedPath);
      currentVideo = gradedPath;
    }
    job.progress = 90;
    
    // Step 7: Move to output directory
    const finalPath = path.join(OUTPUT_DIR, `${jobId}.mp4`);
    await fs.copyFile(currentVideo, finalPath);
    job.progress = 100;
    job.status = 'complete';
    job.url = `/video/${jobId}`;
    
    console.log(`[${jobId}] Render complete!`);
    
    // Cleanup temp directory
    await fs.rm(jobDir, { recursive: true, force: true });
    
    // Webhook callback
    if (webhookUrl) {
      try {
        await axios.post(webhookUrl, {
          job_id: jobId,
          status: 'complete',
          url: job.url,
        });
      } catch (e) {
        console.error(`[${jobId}] Webhook failed:`, e.message);
      }
    }
    
    // Release render slot
    activeRenders--;
    
  } catch (error) {
    console.error(`[${jobId}] Render failed:`, error);
    const job = jobs.get(jobId);
    job.status = 'failed';
    job.error = error.message;
    
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
 * Check job status
 */
app.get('/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

/**
 * Download finished video
 */
app.get('/video/:id', (req, res) => {
  const videoPath = path.join(OUTPUT_DIR, `${req.params.id}.mp4`);
  if (!fsSync.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }
  res.download(videoPath);
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ffmpeg: true });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🎬 Video Renderer running on port ${PORT}`);
  console.log(`   POST /render - Start render job`);
  console.log(`   GET /status/:id - Check job status`);
  console.log(`   GET /video/:id - Download video`);
});
