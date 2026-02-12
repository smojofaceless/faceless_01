-- Fix story_dna NOT NULL columns that block worker-v1 inserts
-- Worker-v1 uniqueness step only provides job_id, brand_id, concept_hash
-- but 11 columns are NOT NULL with no defaults. Drop NOT NULL constraints
-- so basic hash-based tracking works immediately. Full DNA extraction
-- can be added as an enhancement later.

ALTER TABLE story_dna ALTER COLUMN full_hash SET DEFAULT '';
ALTER TABLE story_dna ALTER COLUMN full_hash DROP NOT NULL;

ALTER TABLE story_dna ALTER COLUMN era_id SET DEFAULT 'unknown';
ALTER TABLE story_dna ALTER COLUMN era_id DROP NOT NULL;

ALTER TABLE story_dna ALTER COLUMN era_label SET DEFAULT 'unknown';
ALTER TABLE story_dna ALTER COLUMN era_label DROP NOT NULL;

ALTER TABLE story_dna ALTER COLUMN location_id SET DEFAULT 'unknown';
ALTER TABLE story_dna ALTER COLUMN location_id DROP NOT NULL;

ALTER TABLE story_dna ALTER COLUMN location_label SET DEFAULT 'unknown';
ALTER TABLE story_dna ALTER COLUMN location_label DROP NOT NULL;

ALTER TABLE story_dna ALTER COLUMN subgenre_id SET DEFAULT 'unknown';
ALTER TABLE story_dna ALTER COLUMN subgenre_id DROP NOT NULL;

ALTER TABLE story_dna ALTER COLUMN authority_id SET DEFAULT 'unknown';
ALTER TABLE story_dna ALTER COLUMN authority_id DROP NOT NULL;

ALTER TABLE story_dna ALTER COLUMN repeating_detail_id SET DEFAULT 'unknown';
ALTER TABLE story_dna ALTER COLUMN repeating_detail_id DROP NOT NULL;

ALTER TABLE story_dna ALTER COLUMN weird_axis_id SET DEFAULT 'unknown';
ALTER TABLE story_dna ALTER COLUMN weird_axis_id DROP NOT NULL;

ALTER TABLE story_dna ALTER COLUMN escalation_id SET DEFAULT 'unknown';
ALTER TABLE story_dna ALTER COLUMN escalation_id DROP NOT NULL;

ALTER TABLE story_dna ALTER COLUMN emotion_id SET DEFAULT 'unknown';
ALTER TABLE story_dna ALTER COLUMN emotion_id DROP NOT NULL;

-- Also ensure concept_hash has NOT NULL (it already does, but confirm)
-- and that the job_id unique constraint exists for upsert to work
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_story_dna_job_id_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_story_dna_job_id_unique ON story_dna(job_id);
  END IF;
END $$;
