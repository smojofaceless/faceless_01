-- =====================================================
-- Campaign Templates — Reusable Campaign Configurations
-- =====================================================
-- Stores saved campaign configs so users can quick-launch
-- common campaign patterns (daily horror, weekend blitz, etc.)

-- Ensure updated_at trigger function exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Table
CREATE TABLE IF NOT EXISTS campaign_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      UUID REFERENCES brands(id) ON DELETE CASCADE,  -- NULL = system-wide template
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  config        JSONB NOT NULL DEFAULT '{}',
  tags          TEXT[] DEFAULT ARRAY[]::TEXT[],
  usage_count   INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE campaign_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaign_templates_all"
  ON campaign_templates FOR ALL
  USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaign_templates_brand
  ON campaign_templates(brand_id);
CREATE INDEX IF NOT EXISTS idx_campaign_templates_active
  ON campaign_templates(is_active) WHERE is_active = true;

-- Auto-update updated_at
CREATE TRIGGER trg_campaign_templates_updated
  BEFORE UPDATE ON campaign_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RPC: increment usage counter
CREATE OR REPLACE FUNCTION increment_template_usage(p_template_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE campaign_templates
  SET usage_count = usage_count + 1,
      updated_at  = NOW()
  WHERE id = p_template_id;
END;
$$;

-- ── Seed default system templates ───────────────────
-- brand_id = NULL makes them available to every brand.

INSERT INTO campaign_templates (brand_id, name, description, config, tags) VALUES
(
  NULL,
  'Daily Horror (7 Days)',
  'One video per day for a week. Steady, consistent posting across all platforms.',
  '{
    "videoCount": 7,
    "postsPerDay": 1,
    "platforms": ["youtube_shorts", "instagram_reels", "facebook_reels", "threads"],
    "windows": ["18:00", "18:00", "18:00"],
    "jitterMinutes": 30,
    "platformOffsetMinutes": 5,
    "sceneCount": 0,
    "asapMode": false
  }',
  ARRAY['starter', 'weekly', 'daily']
),
(
  NULL,
  'Weekend Blitz',
  '14 videos over 5 days at 3/day. High-volume push for maximum reach.',
  '{
    "videoCount": 14,
    "postsPerDay": 3,
    "platforms": ["youtube_shorts", "instagram_reels"],
    "windows": ["09:00", "14:00", "20:00"],
    "jitterMinutes": 15,
    "platformOffsetMinutes": 5,
    "sceneCount": 0,
    "asapMode": false
  }',
  ARRAY['high-volume', 'blitz']
),
(
  NULL,
  'Month-Long Drip',
  '30 videos, 1 per day for a full month. Sustained algorithmic presence.',
  '{
    "videoCount": 30,
    "postsPerDay": 1,
    "platforms": ["youtube_shorts", "instagram_reels", "facebook_reels", "threads"],
    "windows": ["19:00", "19:00", "19:00"],
    "jitterMinutes": 45,
    "platformOffsetMinutes": 5,
    "sceneCount": 0,
    "asapMode": false
  }',
  ARRAY['monthly', 'sustained', 'drip']
);
