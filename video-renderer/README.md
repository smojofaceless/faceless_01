# Horror Video Renderer v2.0

FFmpeg-based video renderer that replaces Creatomate. Generates horror-style videos from images + audio.

## 🎯 Features

- ✅ Ken Burns effect (zoom/pan on images)
- ✅ Smooth fade transitions between scenes
- ✅ Audio sync with narration
- ✅ Vignette effect (dark corners)
- ✅ Horror color grading (desaturated, cold tones)
- ✅ Portrait orientation (1080x1920) for TikTok/Shorts/Reels
- ✅ Base64 image support (for AI-generated images)
- ✅ Direct upload to Supabase Storage
- ✅ Webhook callbacks
- ✅ Low-memory mode for free tier hosting

## 💰 Cost Comparison

| Service | Cost per Video | Monthly (100 videos) |
|---------|---------------|---------------------|
| **Creatomate** | $0.03-$0.08 | $3-$8 |
| **FFmpeg Worker** | ~$0 | $0-$5 (server only) |

## 🚀 Deploy to Render.com (Recommended - Free Tier)

1. Fork/push this repo to GitHub

2. Go to [render.com](https://render.com) → New → Web Service

3. Connect your GitHub repo

4. Configure:
   - **Name:** `horror-video-renderer`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free (or Starter for more RAM)

5. Add Environment Variables:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=eyJ... (service role key)
   MAX_CONCURRENT_RENDERS=1
   ```

6. Deploy!

### Render.com Free Tier Limitations
- 512MB RAM (use `low_memory: true` in render requests)
- Spins down after 15 min inactivity (first request takes 30-60s)
- 750 hours/month

## 🚀 Deploy to Railway

1. Go to [railway.app](https://railway.app)

2. New Project → Deploy from GitHub

3. Select this repo

4. Add environment variables (same as above)

5. Done! Railway auto-detects Node.js

## 🚀 Deploy to Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch (from video-renderer directory)
fly launch

# Set secrets
fly secrets set SUPABASE_URL=https://your-project.supabase.co
fly secrets set SUPABASE_SERVICE_KEY=eyJ...

# Deploy
fly deploy
```

## 🔧 Local Development

```bash
# Install dependencies
npm install

# Install FFmpeg
# Windows: winget install FFmpeg
# Mac: brew install ffmpeg
# Ubuntu: apt install ffmpeg

# Copy env file
cp .env.example .env
# Edit .env with your Supabase credentials

# Run server
npm start

# Or with auto-reload
npm run dev
```

## 📡 API Endpoints

### POST /render

Start a new render job.

**Request:**
```json
{
  "images": [
    "https://example.com/image1.png",
    "data:image/webp;base64,UklGR...",
    "https://example.com/image3.png"
  ],
  "audio_url": "https://example.com/narration.mp3",
  "durations": [5, 8, 6],
  "effects": {
    "kenBurns": true,
    "fadeTransitions": true,
    "vignette": true,
    "horrorGrade": true
  },
  "job_id": "supabase-job-uuid",
  "low_memory": false,
  "webhook_url": "https://your-app.com/webhook"
}
```

**Response:**
```json
{
  "success": true,
  "job_id": "render-job-uuid",
  "status_url": "/status/render-job-uuid"
}
```

### GET /status/:id

Check render progress.

**Response:**
```json
{
  "id": "render-job-uuid",
  "status": "processing",
  "progress": 65,
  "url": null,
  "supabase_url": null,
  "error": null
}
```

Status values: `downloading`, `processing`, `complete`, `failed`

### GET /video/:id

Download the finished video file (if not uploaded to Supabase).

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "ffmpeg": true,
  "supabase": true,
  "active_renders": 0,
  "max_concurrent": 1,
  "uptime": 3600
}
```

## 🔗 Wiring to Supabase Edge Functions

In your Supabase project, set these environment variables:

```bash
# In Supabase Dashboard → Project Settings → Edge Functions → Secrets
FFMPEG_RENDERER_URL=https://your-renderer.onrender.com
USE_FFMPEG_RENDERER=true
```

Or via CLI:
```bash
npx supabase secrets set FFMPEG_RENDERER_URL=https://your-renderer.onrender.com
npx supabase secrets set USE_FFMPEG_RENDERER=true
```

## 🎬 How It Works

1. **Download** - Fetches images (URLs or base64) and audio
2. **Scene Creation** - Creates individual video clips with Ken Burns
3. **Concatenation** - Joins clips together
4. **Audio Merge** - Adds narration audio track
5. **Effects** - Applies vignette and horror color grading
6. **Upload** - Uploads final video to Supabase Storage
7. **Cleanup** - Removes temporary files

## 📊 Performance Tips

### For Free Tier (512MB RAM)
- Set `MAX_CONCURRENT_RENDERS=1`
- Use `low_memory: true` in requests
- Keep scenes under 8 per video
- Use compressed images (webp)

### For Paid Tier (1GB+ RAM)
- Set `MAX_CONCURRENT_RENDERS=2`
- Can handle 10+ scenes
- Full Ken Burns zoompan effect

## 🐛 Troubleshooting

### "Server busy - try again in 60 seconds"
Another render is in progress. Wait or increase `MAX_CONCURRENT_RENDERS`.

### FFmpeg errors
Check that FFmpeg is installed: `ffmpeg -version`

### Upload fails
Verify `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are correct.
The service key needs `storage.objects` insert permission.

### Videos have no audio
Check the audio URL is accessible and in MP3/AAC format.

## 📝 License

MIT - Use freely for your horror story videos! 🎃
