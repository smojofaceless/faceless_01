# Horror Video Renderer

FFmpeg-based video renderer that replaces Creatomate. Deploy for free on Render.com or Railway.

## Features

- ✅ Ken Burns effect (zoom/pan on images)
- ✅ Fade transitions between scenes
- ✅ Audio sync with narration
- ✅ Vignette effect
- ✅ Horror color grading
- ✅ Portrait orientation (1080x1920)
- ✅ Webhook callbacks

## Deploy to Render.com (Free)

1. Create account at [render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repo (or use public URL)
4. Settings:
   - **Name:** `horror-video-renderer`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
5. Add environment variable:
   - `TEMP_DIR`: `/tmp/renders`
   - `OUTPUT_DIR`: `/tmp/outputs`
6. Deploy!

## Deploy to Railway (Free)

1. Create account at [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub"
3. Select this repo
4. Railway auto-detects Node.js
5. Done!

## Local Development

```bash
# Install dependencies
npm install

# Install FFmpeg (Windows)
winget install FFmpeg

# Install FFmpeg (Mac)
brew install ffmpeg

# Install FFmpeg (Ubuntu)
apt install ffmpeg

# Run server
npm start
```

## API Endpoints

### POST /render

Start a new render job.

**Request:**
```json
{
  "images": [
    "https://example.com/image1.png",
    "https://example.com/image2.png"
  ],
  "audio_url": "https://example.com/narration.mp3",
  "durations": [5, 8, 6],
  "effects": {
    "kenBurns": true,
    "fadeTransitions": true,
    "vignette": true,
    "horrorGrade": true
  },
  "webhook_url": "https://your-app.com/webhook"
}
```

**Response:**
```json
{
  "success": true,
  "job_id": "uuid-here",
  "status_url": "/status/uuid-here"
}
```

### GET /status/:id

Check render progress.

**Response:**
```json
{
  "id": "uuid-here",
  "status": "processing",
  "progress": 65,
  "url": null,
  "error": null
}
```

Status values: `downloading`, `processing`, `complete`, `failed`

### GET /video/:id

Download the finished video file.

## Integration with Supabase Edge Function

Update `run-job/index.ts` to call this service instead of Creatomate:

```typescript
// Replace Creatomate call with:
const RENDERER_URL = Deno.env.get("VIDEO_RENDERER_URL") || "https://your-renderer.onrender.com";

async function renderVideo(images: string[], audioUrl: string, durations: number[]) {
  // Start render
  const response = await fetch(`${RENDERER_URL}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      images,
      audio_url: audioUrl,
      durations,
      effects: {
        kenBurns: true,
        fadeTransitions: true,
        vignette: true,
        horrorGrade: true,
      },
    }),
  });
  
  const { job_id } = await response.json();
  
  // Poll for completion
  while (true) {
    await new Promise(r => setTimeout(r, 5000));
    
    const status = await fetch(`${RENDERER_URL}/status/${job_id}`);
    const job = await status.json();
    
    if (job.status === "complete") {
      return `${RENDERER_URL}${job.url}`;
    }
    if (job.status === "failed") {
      throw new Error(job.error);
    }
  }
}
```

## Effects Explained

### Ken Burns
Slow zoom/pan on each image to add motion. Alternates between:
- Zoom in from center
- Zoom out from zoomed
- Pan left to right
- Pan top to bottom

### Fade Transitions
0.5 second crossfade between scenes.

### Vignette
Darkens the edges of the frame for a cinematic look.

### Horror Grade
- Slight desaturation (80% color)
- Increased contrast
- Blue tint in shadows
- Cooler overall tone

## Troubleshooting

### "FFmpeg not found"
Make sure FFmpeg is installed and in PATH:
```bash
ffmpeg -version
```

### "Out of memory"
Free tier servers have limited RAM. Try:
- Reducing image resolution
- Processing fewer images at once
- Using a paid tier

### "Render timeout"
Free tiers often have 30s request timeout. The async processing handles this - check `/status/:id` for progress.
