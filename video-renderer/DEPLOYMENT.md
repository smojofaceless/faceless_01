# FFmpeg Video Renderer - Deployment Guide

## Quick Start (Free Hosting Options)

### Option 1: Render.com (Recommended - Free Tier)

1. **Push code to GitHub**
   ```bash
   git add video-renderer/
   git commit -m "Add FFmpeg video renderer"
   git push
   ```

2. **Create Render Account**: https://render.com

3. **New Web Service**:
   - Connect your GitHub repo
   - Root Directory: `video-renderer`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment: Node
   - Instance Type: Free

4. **Copy URL** (e.g., `https://your-app.onrender.com`)

### Option 2: Railway (Free Tier with $5/month credit)

1. **Create Railway Account**: https://railway.app

2. **New Project → Deploy from GitHub**

3. **Settings**:
   - Root Directory: `video-renderer`
   - Start Command: `npm start`

4. **Generate Domain** in Settings

### Option 3: Fly.io (Free Tier)

1. **Install Fly CLI**: https://fly.io/docs/hands-on/install-flyctl/

2. **Deploy**:
   ```bash
   cd video-renderer
   fly launch
   fly deploy
   ```

---

## Configure Supabase Edge Function

After deploying the renderer, add environment variables to Supabase:

### Option A: Via Dashboard (Easiest)

1. Go to: https://supabase.com/dashboard/project/ustmetegzisztqqcjigt/settings/edge-functions

2. Add these secrets:
   - `FFMPEG_RENDERER_URL` = Your renderer URL (e.g., `https://scary-video-renderer.onrender.com`)
   - `USE_FFMPEG_RENDERER` = `true`

### Option B: Via CLI

```bash
supabase secrets set FFMPEG_RENDERER_URL=https://your-renderer.onrender.com
supabase secrets set USE_FFMPEG_RENDERER=true
```

---

## Deploy Edge Function

After setting secrets, redeploy the Edge Function:

```bash
cd d:\SMOJO\Online\Buisness\faceless_01
supabase functions deploy run-job --no-verify-jwt
```

---

## Test It

1. Generate a new video through your web app
2. Check logs:
   ```bash
   supabase functions logs run-job
   ```
3. You should see: `[ASSEMBLE] Using FFmpeg renderer`

---

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Web App                              │
│                   (index.html)                               │
└─────────────────────┬───────────────────────────────────────┘
                      │ 1. User clicks "Generate"
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Supabase Edge Functions                         │
│                                                              │
│  run-job/index.ts                                           │
│  ├── Phase 1: Generate story, audio, captions               │
│  ├── Phase 2: Generate DALL-E images                        │
│  └── Phase 3: Assemble video                                │
│       │                                                      │
│       ▼ USE_FFMPEG_RENDERER=true?                           │
│       │                                                      │
│       ├─ Yes ──► Call FFmpeg Renderer Service               │
│       │          (POST /render, GET /status/:id)            │
│       │                                                      │
│       └─ No ───► Call Creatomate (needs credits)            │
└─────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│            FFmpeg Renderer Service                           │
│         (video-renderer/server.js)                          │
│                                                              │
│  Hosted on: Render.com / Railway / Fly.io                   │
│                                                              │
│  Features:                                                   │
│  ✓ Ken Burns (zoom/pan) effect                              │
│  ✓ 0.5s fade transitions                                    │
│  ✓ Vignette overlay                                         │
│  ✓ Horror color grading                                     │
│  ✓ Captions burned in                                       │
│  ✓ Portrait 1080x1920                                       │
│  ✓ Async processing with status polling                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Fallback to Creatomate

If you want to use Creatomate again later:

1. Set `USE_FFMPEG_RENDERER=false` in Supabase secrets
2. Or remove the variable entirely
3. Redeploy: `supabase functions deploy run-job --no-verify-jwt`

---

## Troubleshooting

### Render/Railway Free Tier Cold Starts
Free tiers spin down after inactivity. First request may take 30-60 seconds.

**Solution**: The Edge Function has retry logic and waits for rendering.

### "Out of Memory" on Free Tier
Free tiers have limited RAM (~512MB). Long videos (>3 min) may fail.

**Solutions**:
1. Keep videos under 2 minutes
2. Upgrade to paid tier ($7/month on Render)
3. Use smaller image dimensions (add to render options)

### FFmpeg Errors
Check renderer logs:
- Render.com: Dashboard → Service → Logs
- Railway: Dashboard → Service → Deployments → View Logs

---

## API Reference

### POST /render
Start a new render job.

```json
{
  "audioUrl": "https://..../audio.mp3",
  "scenes": [
    {
      "imageUrl": "https://..../image1.png",
      "duration": 5.0,
      "startTime": 0,
      "endTime": 5
    }
  ],
  "options": {
    "width": 1080,
    "height": 1920,
    "transition": "fade",
    "transitionDuration": 0.5,
    "horrorMode": true,
    "kenBurns": true,
    "vignette": true
  }
}
```

### GET /status/:id
Check render status.

Response:
```json
{
  "id": "abc123",
  "status": "completed",  // "processing", "completed", "failed"
  "progress": 100,
  "videoUrl": "https://your-renderer.com/video/abc123"
}
```

### GET /video/:id
Download the rendered video (redirects to file or streams).
