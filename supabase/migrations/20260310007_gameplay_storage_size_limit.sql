-- Increase story-videos bucket file size limit from 50MB to 500MB
-- to allow gameplay video uploads (Minecraft parkour etc.)
UPDATE storage.buckets
SET file_size_limit = 524288000   -- 500 MB in bytes
WHERE id = 'story-videos';
