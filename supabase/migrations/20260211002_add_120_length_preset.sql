-- Add '120' to length_preset constraint for 2-minute videos
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_length_preset_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_length_preset_check 
    CHECK (length_preset IN ('30', '45', '60', '90', '120'));
