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
  });
  
  const writer = fsSync.createWriteStream(outputPath);
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/**
 * Generate Ken Burns effect filter for an image
 */
function getKenBurnsFilter(index, duration, width = 1080, height = 1920) {
  // Alternate between zoom-in and zoom-out, with slight pan
  const effects = [
    // Slow zoom in from center
    `zoompan=z='min(zoom+0.0015,1.3)':d=${duration * 30}:fps=30:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}`,
    // Slow zoom out
    `zoompan=z='if(lte(zoom,1.0),1.3,max(1.001,zoom-0.0015))':d=${duration * 30}:fps=30:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}`,
    // Pan left to right with slight zoom
    `zoompan=z='min(zoom+0.001,1.2)':d=${duration * 30}:fps=30:x='if(lte(on,1),0,min(x+2,iw-iw/zoom))':y='ih/2-(ih/zoom/2)':s=${width}x${height}`,
    // Pan top to bottom
    `zoompan=z='1.2':d=${duration * 30}:fps=30:x='iw/2-(iw/zoom/2)':y='if(lte(on,1),0,min(y+1,ih-ih/zoom))':s=${width}x${height}`,
  ];
  
  return effects[index % effects.length];
}

/**
 * Create video from images with Ken Burns effect
 */
async function createVideoFromImages(jobId, images, durations, outputPath, options = {}) {
  const { kenBurns = true, fadeTransitions = true } = options;
  const tempVideos = [];
  
  // Step 1: Create individual video clips for each image
  for (let i = 0; i < images.length; i++) {
    const imagePath = images[i];
    const duration = durations[i] || 5;
    const tempVideo = path.join(TEMP_DIR, `${jobId}_scene_${i}.mp4`);
    tempVideos.push(tempVideo);
    
    await new Promise((resolve, reject) => {
      let cmd = ffmpeg(imagePath)
        .loop(duration)
        .inputOptions(['-framerate', '30']);
      
      // Apply Ken Burns effect
      if (kenBurns) {
        const kenBurnsFilter = getKenBurnsFilter(i, duration);
        cmd = cmd.complexFilter([kenBurnsFilter]);
      } else {
        // Just scale to output size
        cmd = cmd.videoFilter(`scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2`);
      }
      
      cmd
        .outputOptions([
          '-c:v', 'libx264',
          '-t', String(duration),
          '-pix_fmt', 'yuv420p',
          '-r', '30',
        ])
        .output(tempVideo)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    
    console.log(`[${jobId}] Created scene ${i + 1}/${images.length}`);
  }
  
  // Step 2: Concatenate all clips
  const listFile = path.join(TEMP_DIR, `${jobId}_list.txt`);
  const listContent = tempVideos.map(v => `file '${v}'`).join('\n');
  await fs.writeFile(listFile, listContent);
  
  // Step 3: Concatenate with optional fade transitions
  await new Promise((resolve, reject) => {
    let cmd = ffmpeg();
    
    if (fadeTransitions && tempVideos.length > 1) {
      // Use xfade filter for smooth transitions
      tempVideos.forEach((v, i) => {
        cmd = cmd.input(v);
      });
      
      // Build xfade filter chain
      let filterChain = '';
      let lastOutput = '[0:v]';
      
      for (let i = 1; i < tempVideos.length; i++) {
        const offset = durations.slice(0, i).reduce((a, b) => a + b, 0) - 0.5; // 0.5s overlap
        const outputLabel = i === tempVideos.length - 1 ? 'outv' : `v${i}`;
        filterChain += `${lastOutput}[${i}:v]xfade=transition=fade:duration=0.5:offset=${offset}[${outputLabel}];`;
        lastOutput = `[${outputLabel}]`;
      }
      
      // Remove trailing semicolon
      filterChain = filterChain.slice(0, -1);
      
      cmd
        .complexFilter(filterChain, 'outv')
        .outputOptions([
          '-c:v', 'libx264',
          '-crf', '23',
          '-preset', 'medium',
          '-pix_fmt', 'yuv420p',
        ])
        .output(outputPath)
        .on('end', resolve)
        .on('error', (err) => {
          console.error('Xfade failed, falling back to concat:', err.message);
          // Fallback to simple concat
          ffmpeg()
            .input(listFile)
            .inputOptions(['-f', 'concat', '-safe', '0'])
            .outputOptions(['-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p'])
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        })
        .run();
    } else {
      // Simple concatenation
      cmd
        .input(listFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p'])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    }
  });
  
  // Cleanup temp videos
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
 * Add vignette effect
 */
async function addVignette(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilter('vignette=PI/4')
      .outputOptions(['-c:a', 'copy'])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

/**
 * Add horror color grading
 */
async function addHorrorGrade(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilter([
        // Desaturate slightly, boost contrast, add blue tint to shadows
        'eq=saturation=0.8:contrast=1.1',
        'curves=b=0/0.1 0.5/0.5 1/0.9',
      ].join(','))
      .outputOptions(['-c:a', 'copy'])
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
    
  } catch (error) {
    console.error(`[${jobId}] Render failed:`, error);
    const job = jobs.get(jobId);
    job.status = 'failed';
    job.error = error.message;
    
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
