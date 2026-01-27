-- =====================================================
-- Faceless Video Generator - Database Schema
-- =====================================================

-- =====================================================
-- JOBS TABLE
-- Tracks video generation jobs and their status
-- =====================================================
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Status tracking
    status TEXT NOT NULL DEFAULT 'queued' 
        CHECK (status IN ('queued', 'generating', 'assembling', 'complete', 'failed')),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    error TEXT,
    
    -- Generation settings
    length_preset TEXT DEFAULT '45' CHECK (length_preset IN ('30', '45', '60')),
    vibe_preset TEXT DEFAULT 'slow_creepy' CHECK (vibe_preset IN ('slow_creepy', 'punchy_shock', 'atmospheric')),
    visual_preset TEXT DEFAULT 'forest' CHECK (visual_preset IN ('forest', 'hallway', 'attic', 'foggy', 'rain')),
    voice_id TEXT DEFAULT 'pNInz6obpgDQGcFmaJgB', -- ElevenLabs Adam voice
    
    -- Generated content
    title TEXT,
    story_text TEXT,
    story_word_count INTEGER,
    duration_sec INTEGER,
    
    -- Metadata
    prompt_version TEXT DEFAULT 'v1',
    meta JSONB DEFAULT '{}'::jsonb
);

-- =====================================================
-- JOB_ASSETS TABLE
-- Stores references to generated files
-- =====================================================
CREATE TABLE job_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Asset info
    type TEXT NOT NULL 
        CHECK (type IN ('story_json', 'captions_srt', 'captions_json', 'audio_mp3', 'bg_video', 'final_mp4')),
    storage_path TEXT NOT NULL,
    public_url TEXT,
    
    -- Metadata (file size, duration, etc.)
    meta JSONB DEFAULT '{}'::jsonb
);

-- =====================================================
-- BACKGROUND_VIDEOS TABLE
-- Pre-loaded stock footage library
-- =====================================================
CREATE TABLE background_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Video info
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('forest', 'hallway', 'attic', 'foggy', 'rain')),
    source_url TEXT NOT NULL, -- Original source (Pexels/Pixabay)
    storage_path TEXT, -- Our storage path
    public_url TEXT,
    
    -- Metadata
    duration_sec INTEGER,
    width INTEGER DEFAULT 1080,
    height INTEGER DEFAULT 1920,
    meta JSONB DEFAULT '{}'::jsonb,
    
    -- Status
    is_active BOOLEAN DEFAULT true
);

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX idx_job_assets_job_id ON job_assets(job_id);
CREATE INDEX idx_job_assets_type ON job_assets(type);
CREATE INDEX idx_background_videos_category ON background_videos(category);

-- =====================================================
-- UPDATED_AT TRIGGER
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_jobs_updated_at
    BEFORE UPDATE ON jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- For MVP, we'll allow all operations (personal use)
-- =====================================================
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE background_videos ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated and anon users (MVP - personal use only)
CREATE POLICY "Allow all operations on jobs" ON jobs
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on job_assets" ON job_assets
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on background_videos" ON background_videos
    FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- SEED DATA: Background Videos (Free Stock)
-- =====================================================
INSERT INTO background_videos (name, category, source_url, duration_sec) VALUES
    -- Forest category
    ('Dark Forest Fog', 'forest', 'https://www.pexels.com/video/video-of-forest-1448735/', 30),
    ('Misty Woods', 'forest', 'https://www.pexels.com/video/fog-covering-the-forest-3571264/', 20),
    
    -- Hallway category  
    ('Dark Corridor', 'hallway', 'https://www.pexels.com/video/a-long-dark-hallway-4873133/', 15),
    ('Abandoned Hallway', 'hallway', 'https://www.pexels.com/video/walking-on-an-empty-hallway-4812204/', 12),
    
    -- Foggy category
    ('Dense Fog', 'foggy', 'https://www.pexels.com/video/misty-mountain-1666597/', 30),
    ('Fog Rolling', 'foggy', 'https://www.pexels.com/video/foggy-scenery-857074/', 25),
    
    -- Rain category
    ('Rain on Window', 'rain', 'https://www.pexels.com/video/rain-drops-on-glass-window-2491284/', 30),
    ('Heavy Rain Night', 'rain', 'https://www.pexels.com/video/rain-on-a-glass-window-4175464/', 20),
    
    -- Attic category
    ('Dusty Attic Light', 'attic', 'https://www.pexels.com/video/light-coming-through-window-3129957/', 20),
    ('Old Room Shadows', 'attic', 'https://www.pexels.com/video/shadows-in-a-room-4065924/', 15);
