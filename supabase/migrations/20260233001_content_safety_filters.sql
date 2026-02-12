-- =====================================================
-- Migration: 20260233001_content_safety_filters.sql
-- Purpose:  Roadmap #16 — Content Safety Filters
--
--   1. content_safety_rules table  — DB-driven forbidden term lists
--      grouped by category + scope (global / preset:X / platform:X).
--   2. get_content_safety_rules(preset, platform) RPC — returns a merged
--      JSONB array of all applicable rules sorted by category.
--   3. Seed data — comprehensive default rules covering violence, abuse,
--      weapons, body horror, children in danger, panic/suffering,
--      profanity, and self-harm. Plus platform-specific additions.
--   4. log_safety_filter_event() RPC — structured logging for filtered
--      content (ties into job_step_logs).
--
-- Consumed by:
--   - worker-v1/steps.ts  (pre-filter every image prompt)
--   - run-job/images.ts   (pre-filter every image prompt)
-- =====================================================

-- =====================================================
-- 1. TABLE: content_safety_rules
-- =====================================================
CREATE TABLE IF NOT EXISTS content_safety_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global',       -- 'global', 'preset:urban_legend', 'platform:youtube_shorts'
  category TEXT NOT NULL,                      -- violence, abuse, weapons, body_horror, children, panic, profanity, self_harm
  terms JSONB NOT NULL DEFAULT '[]'::jsonb,    -- [{t: "word", r: "replacement"}, {t: "\\bregex", r: "replacement", re: true}]
  severity TEXT NOT NULL DEFAULT 'block',       -- block = always replace, warn = log only, soft = replace only for images
  active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(scope, category)
);

-- RLS: service_role can read/write, anon can read (for edge functions)
ALTER TABLE content_safety_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON content_safety_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "anon_read" ON content_safety_rules
  FOR SELECT TO anon USING (true);

-- Index for scope lookup
CREATE INDEX IF NOT EXISTS idx_csr_scope ON content_safety_rules(scope) WHERE active = true;

-- =====================================================
-- 2. RPC: get_content_safety_rules(preset, platform)
--    Returns merged JSONB array of all applicable rules.
--    Merging order: global → preset-specific → platform-specific
-- =====================================================
CREATE OR REPLACE FUNCTION get_content_safety_rules(
  p_preset TEXT DEFAULT NULL,
  p_platform TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB := '[]'::jsonb;
  v_scopes TEXT[];
BEGIN
  -- Build scope list: global + optional preset + optional platform
  v_scopes := ARRAY['global'];
  IF p_preset IS NOT NULL AND p_preset != '' THEN
    v_scopes := v_scopes || ('preset:' || p_preset);
  END IF;
  IF p_platform IS NOT NULL AND p_platform != '' THEN
    v_scopes := v_scopes || ('platform:' || p_platform);
  END IF;

  -- Aggregate all matching terms with category and severity metadata
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'category', r.category,
      'severity', r.severity,
      'terms', r.terms,
      'scope', r.scope
    )
  ), '[]'::jsonb)
  INTO v_result
  FROM content_safety_rules r
  WHERE r.scope = ANY(v_scopes)
    AND r.active = true;

  RETURN v_result;
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION get_content_safety_rules(TEXT, TEXT) TO anon, service_role;

-- =====================================================
-- 3. RPC: log_safety_filter_event()
--    Logs a safety filter event to job_step_logs
-- =====================================================
CREATE OR REPLACE FUNCTION log_safety_filter_event(
  p_job_id UUID,
  p_step TEXT DEFAULT 'images',
  p_terms_replaced INT DEFAULT 0,
  p_categories TEXT[] DEFAULT '{}',
  p_original_length INT DEFAULT 0,
  p_filtered_length INT DEFAULT 0,
  p_scene_index INT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO job_step_logs (job_id, step_name, event_type, message, meta)
  VALUES (
    p_job_id,
    p_step,
    'snapshot',
    format('Safety filter: %s terms replaced across categories [%s] (scene %s)',
      p_terms_replaced, array_to_string(p_categories, ', '), COALESCE(p_scene_index::text, 'N/A')),
    jsonb_build_object(
      'safety_filter', true,
      'terms_replaced', p_terms_replaced,
      'categories', to_jsonb(p_categories),
      'original_length', p_original_length,
      'filtered_length', p_filtered_length,
      'scene_index', p_scene_index
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION log_safety_filter_event(UUID, TEXT, INT, TEXT[], INT, INT, INT) TO anon, service_role;

-- =====================================================
-- 4. SEED: Global rules (apply to ALL presets/platforms)
-- =====================================================

-- Violence / gore / death
INSERT INTO content_safety_rules (scope, category, severity, terms, notes) VALUES
('global', 'violence', 'block', '[
  {"t": "blood", "r": "red liquid"},
  {"t": "bloody", "r": "stained"},
  {"t": "bleeding", "r": "marked"},
  {"t": "gore", "r": "darkness"},
  {"t": "gory", "r": "dark"},
  {"t": "wound", "r": "mark"},
  {"t": "wounds", "r": "marks"},
  {"t": "injured", "r": "affected"},
  {"t": "corpse", "r": "figure"},
  {"t": "dead body", "r": "still figure"},
  {"t": "death", "r": "end"},
  {"t": "dying", "r": "fading"},
  {"t": "murder", "r": "mystery"},
  {"t": "murdered", "r": "vanished"},
  {"t": "kill", "r": "vanish"},
  {"t": "killed", "r": "vanished"},
  {"t": "killing", "r": "vanishing"},
  {"t": "stab", "r": "strike"},
  {"t": "stabbed", "r": "struck"},
  {"t": "stabbing", "r": "striking"},
  {"t": "slash", "r": "cut"},
  {"t": "slashed", "r": "torn"},
  {"t": "\\bmutilat\\w*", "r": "mysterious", "re": true},
  {"t": "\\bdismember\\w*", "r": "mysterious", "re": true},
  {"t": "\\bdecapitat\\w*", "r": "mysterious", "re": true},
  {"t": "\\bimpale\\w*", "r": "mysterious", "re": true},
  {"t": "\\bexecut\\w+", "r": "mysterious", "re": true},
  {"t": "\\bslaughter\\w*", "r": "mysterious", "re": true},
  {"t": "\\bmassacr\\w*", "r": "mysterious", "re": true}
]'::jsonb, 'Core violence/gore terms. Always replace before sending to image API.')
ON CONFLICT (scope, category) DO UPDATE SET terms = EXCLUDED.terms, updated_at = now();

-- Abuse / stalking / assault / pursuit
INSERT INTO content_safety_rules (scope, category, severity, terms, notes) VALUES
('global', 'abuse', 'block', '[
  {"t": "stalking", "r": "watching"},
  {"t": "stalker", "r": "observer"},
  {"t": "stalked", "r": "watched"},
  {"t": "\\babduct\\w*", "r": "disappearance", "re": true},
  {"t": "\\bkidnap\\w*", "r": "vanishing", "re": true},
  {"t": "\\bassault\\w*", "r": "encounter", "re": true},
  {"t": "\\battack\\w*", "r": "approach", "re": true},
  {"t": "victim", "r": "witness"},
  {"t": "victims", "r": "witnesses"},
  {"t": "prey", "r": "target"},
  {"t": "predator", "r": "presence"},
  {"t": "helpless", "r": "alone"},
  {"t": "defenseless", "r": "exposed"},
  {"t": "vulnerable", "r": "isolated"},
  {"t": "trapped", "r": "surrounded"},
  {"t": "captive", "r": "confined"},
  {"t": "hostage", "r": "detained"},
  {"t": "\\babuse\\w*", "r": "mysterious", "re": true},
  {"t": "\\bmolest\\w*", "r": "mysterious", "re": true},
  {"t": "\\bstrangle\\w*", "r": "grip", "re": true},
  {"t": "choke", "r": "pressure"},
  {"t": "choking", "r": "tightening"},
  {"t": "suffocate", "r": "smother"},
  {"t": "\\btortured?\\b", "r": "darkness", "re": true},
  {"t": "torment", "r": "unease"}
]'::jsonb, 'Abuse, stalking, assault, pursuit terms. High moderation risk.')
ON CONFLICT (scope, category) DO UPDATE SET terms = EXCLUDED.terms, updated_at = now();

-- Weapons
INSERT INTO content_safety_rules (scope, category, severity, terms, notes) VALUES
('global', 'weapons', 'block', '[
  {"t": "knife", "r": "object"},
  {"t": "blade", "r": "metal"},
  {"t": "weapon", "r": "item"},
  {"t": "weapons", "r": "items"},
  {"t": "gun", "r": "device"},
  {"t": "guns", "r": "devices"},
  {"t": "axe", "r": "tool"},
  {"t": "machete", "r": "tool"},
  {"t": "chainsaw", "r": "machine"},
  {"t": "noose", "r": "loop"},
  {"t": "rope around neck", "r": "rope"},
  {"t": "firearm", "r": "device"},
  {"t": "pistol", "r": "device"},
  {"t": "rifle", "r": "device"},
  {"t": "sword", "r": "metal rod"},
  {"t": "dagger", "r": "small object"}
]'::jsonb, 'Weapon terms. Replace to avoid moderation flags.')
ON CONFLICT (scope, category) DO UPDATE SET terms = EXCLUDED.terms, updated_at = now();

-- Body horror
INSERT INTO content_safety_rules (scope, category, severity, terms, notes) VALUES
('global', 'body_horror', 'block', '[
  {"t": "\\bdisembowel\\w*", "r": "mysterious", "re": true},
  {"t": "drowned", "r": "submerged"},
  {"t": "drowning", "r": "sinking"},
  {"t": "hanging", "r": "suspended"},
  {"t": "hanged", "r": "suspended"},
  {"t": "\\brot+ing\\b", "r": "decaying", "re": true},
  {"t": "\\brot+ed\\b", "r": "aged", "re": true},
  {"t": "flesh", "r": "surface"},
  {"t": "entrails", "r": "mysterious shapes"},
  {"t": "intestines", "r": "mysterious shapes"},
  {"t": "severed", "r": "separated"},
  {"t": "amputated", "r": "missing"},
  {"t": "\\bdecompos\\w*", "r": "weathered", "re": true}
]'::jsonb, 'Body horror / graphic anatomy terms.')
ON CONFLICT (scope, category) DO UPDATE SET terms = EXCLUDED.terms, updated_at = now();

-- Children in danger
INSERT INTO content_safety_rules (scope, category, severity, terms, notes) VALUES
('global', 'children', 'block', '[
  {"t": "\\b(child|children|kid|kids|baby|infant|teenager|teen)\\s+(scream|cry|fear|terror|danger|hurt|harm|alone|lost|missing|trapped|dead|dying|bleeding|injured)", "r": "young person in the scene", "re": true},
  {"t": "\\b(child|children|kid|kids|baby|infant)\\s+(corpse|body|murder|killed|victim)", "r": "mysterious figure", "re": true},
  {"t": "orphan", "r": "young person"},
  {"t": "abandoned child", "r": "young person alone"},
  {"t": "abandoned baby", "r": "small figure"},
  {"t": "child abuse", "r": "mysterious situation"},
  {"t": "child victim", "r": "young witness"}
]'::jsonb, 'Children in danger — highest moderation risk. ALWAYS replace.')
ON CONFLICT (scope, category) DO UPDATE SET terms = EXCLUDED.terms, updated_at = now();

-- Panic / suffering / distress
INSERT INTO content_safety_rules (scope, category, severity, terms, notes) VALUES
('global', 'panic', 'block', '[
  {"t": "agony", "r": "stillness"},
  {"t": "suffering", "r": "solitude"},
  {"t": "pain", "r": "tension"},
  {"t": "scream", "r": "silence"},
  {"t": "screaming", "r": "silent"},
  {"t": "screams", "r": "echoes"},
  {"t": "writhing", "r": "shifting"},
  {"t": "\\bpanic\\w*", "r": "unease", "re": true},
  {"t": "\\bhysteri\\w*", "r": "distress", "re": true},
  {"t": "dread", "r": "tension"},
  {"t": "terror", "r": "unease"},
  {"t": "petrified", "r": "frozen"},
  {"t": "paralyzed with fear", "r": "frozen in place"},
  {"t": "frozen in fear", "r": "motionless"},
  {"t": "\\bwail\\w*", "r": "sound", "re": true},
  {"t": "\\bshriek\\w*", "r": "sound", "re": true},
  {"t": "\\bsobbing\\b", "r": "silent", "re": true}
]'::jsonb, 'Panic, suffering, distress terms.')
ON CONFLICT (scope, category) DO UPDATE SET terms = EXCLUDED.terms, updated_at = now();

-- Self-harm / suicide
INSERT INTO content_safety_rules (scope, category, severity, terms, notes) VALUES
('global', 'self_harm', 'block', '[
  {"t": "self-harm", "r": "mysterious"},
  {"t": "self harm", "r": "mysterious"},
  {"t": "suicide", "r": "mysterious ending"},
  {"t": "suicidal", "r": "troubled"},
  {"t": "slit wrist", "r": "mysterious"},
  {"t": "overdose", "r": "collapse"},
  {"t": "\\bcut\\s+(myself|himself|herself|themselves)", "r": "mysterious mark", "re": true}
]'::jsonb, 'Self-harm / suicide — highest moderation priority. ALWAYS replace.')
ON CONFLICT (scope, category) DO UPDATE SET terms = EXCLUDED.terms, updated_at = now();

-- Scary descriptors (softer — replacements keep atmosphere)
INSERT INTO content_safety_rules (scope, category, severity, terms, notes) VALUES
('global', 'scary_descriptors', 'soft', '[
  {"t": "terrifying", "r": "unsettling"},
  {"t": "horrifying", "r": "mysterious"},
  {"t": "grotesque", "r": "unusual"},
  {"t": "deformed", "r": "shadowy"},
  {"t": "disfigured", "r": "obscured"},
  {"t": "monstrous", "r": "imposing"},
  {"t": "demonic", "r": "supernatural"},
  {"t": "evil", "r": "dark"},
  {"t": "sinister", "r": "mysterious"},
  {"t": "menacing", "r": "looming"},
  {"t": "threatening", "r": "imposing"}
]'::jsonb, 'Scary adjectives. Soft severity — replace for images, log-only for story text.')
ON CONFLICT (scope, category) DO UPDATE SET terms = EXCLUDED.terms, updated_at = now();

-- Pursuit / hunting
INSERT INTO content_safety_rules (scope, category, severity, terms, notes) VALUES
('global', 'pursuit', 'block', '[
  {"t": "\\bhunt\\w*", "r": "search", "re": true},
  {"t": "chase", "r": "movement"},
  {"t": "chasing", "r": "following"},
  {"t": "pursue", "r": "follow"},
  {"t": "pursuing", "r": "following"},
  {"t": "fleeing", "r": "moving away"},
  {"t": "cornered", "r": "blocked"},
  {"t": "running away", "r": "moving quickly"},
  {"t": "escape", "r": "departure"},
  {"t": "escaped", "r": "departed"}
]'::jsonb, 'Pursuit and hunting-people language.')
ON CONFLICT (scope, category) DO UPDATE SET terms = EXCLUDED.terms, updated_at = now();

-- =====================================================
-- 5. SEED: Platform-specific rules (stricter)
-- =====================================================

-- YouTube Shorts: extra strict on violence + self-harm
INSERT INTO content_safety_rules (scope, category, severity, terms, notes) VALUES
('platform:youtube_shorts', 'youtube_violence', 'block', '[
  {"t": "serial killer", "r": "mysterious figure"},
  {"t": "mass murder", "r": "mysterious event"},
  {"t": "homicide", "r": "investigation"},
  {"t": "manslaughter", "r": "incident"},
  {"t": "bloodbath", "r": "dark scene"},
  {"t": "carnage", "r": "aftermath"},
  {"t": "slaughter", "r": "disappearance"},
  {"t": "butcher", "r": "figure"},
  {"t": "psychopath", "r": "disturbed individual"},
  {"t": "sociopath", "r": "unusual individual"}
]'::jsonb, 'YouTube-specific: stricter violence terms that may trigger demonetization.')
ON CONFLICT (scope, category) DO UPDATE SET terms = EXCLUDED.terms, updated_at = now();

-- TikTok: strict on drugs, weapons, graphic content
INSERT INTO content_safety_rules (scope, category, severity, terms, notes) VALUES
('platform:tiktok', 'tiktok_restrictions', 'block', '[
  {"t": "drugs", "r": "substances"},
  {"t": "drug", "r": "substance"},
  {"t": "cocaine", "r": "powder"},
  {"t": "heroin", "r": "substance"},
  {"t": "meth", "r": "substance"},
  {"t": "needle", "r": "sharp object"},
  {"t": "injection", "r": "procedure"},
  {"t": "syringe", "r": "medical device"}
]'::jsonb, 'TikTok-specific: drug-related terms strictly enforced.')
ON CONFLICT (scope, category) DO UPDATE SET terms = EXCLUDED.terms, updated_at = now();

-- =====================================================
-- 6. SEED: Preset-specific rules
-- =====================================================

-- One-too-many preset: ensure group language doesn't force groups into non-group scenes
INSERT INTO content_safety_rules (scope, category, severity, terms, notes) VALUES
('preset:one_too_many', 'group_forcing', 'soft', '[
  {"t": "group gathering", "r": "atmospheric scene"},
  {"t": "group of people", "r": "the scene"},
  {"t": "crowd of people", "r": "the space"},
  {"t": "everyone looks", "r": "everything appears"},
  {"t": "count feels wrong", "r": "something feels off"}
]'::jsonb, 'One-too-many: prevent group language from leaking into non-group scenes.')
ON CONFLICT (scope, category) DO UPDATE SET terms = EXCLUDED.terms, updated_at = now();

-- Analog horror: ensure VHS terms don't get too graphic
INSERT INTO content_safety_rules (scope, category, severity, terms, notes) VALUES
('preset:analog_horror', 'analog_safety', 'soft', '[
  {"t": "found footage of murder", "r": "found footage of an incident"},
  {"t": "snuff film", "r": "disturbing recording"},
  {"t": "real death", "r": "real incident"},
  {"t": "actual murder", "r": "actual incident"}
]'::jsonb, 'Analog horror: prevent terms that imply real violence documentation.')
ON CONFLICT (scope, category) DO UPDATE SET terms = EXCLUDED.terms, updated_at = now();
