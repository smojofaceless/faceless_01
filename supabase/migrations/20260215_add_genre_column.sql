-- Add genre column to story_dna table for v3.1 genre-aware weighting
-- This tracks which genre profile was used to generate each story

-- Add the genre column with default value
ALTER TABLE story_dna
ADD COLUMN IF NOT EXISTS genre TEXT DEFAULT 'urban_legend';

-- Add comment for documentation
COMMENT ON COLUMN story_dna.genre IS 'Genre profile used for generation (urban_legend, cosmic_horror, true_crime, analog_horror, neutral)';

-- Create an index on genre for analytics queries
CREATE INDEX IF NOT EXISTS idx_story_dna_genre ON story_dna(genre);

-- Update existing rows to have explicit genre (they were all urban_legend before this feature)
UPDATE story_dna SET genre = 'urban_legend' WHERE genre IS NULL;
