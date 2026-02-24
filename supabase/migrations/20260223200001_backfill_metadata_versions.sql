-- Backfill: Insert post_metadata_versions for posts that were published
-- before the learning system deployed. They have metrics but no version
-- entries, so they're invisible to the exemplar system.
INSERT INTO post_metadata_versions (post_id, platform, version_number, version_type, fields, created_by)
SELECT pm.post_id, pm.platform, 1, 'ai',
       COALESCE(pm.final_metadata, pm.ai_metadata, '{}'::jsonb),
       'migration-backfill'
FROM post_metadata pm
JOIN posts p ON p.id = pm.post_id
WHERE p.status = 'posted'
  AND pm.status IN ('ready', 'edited')
  AND NOT EXISTS (
    SELECT 1 FROM post_metadata_versions v
    WHERE v.post_id = pm.post_id AND v.platform = pm.platform
  )
ON CONFLICT DO NOTHING;
