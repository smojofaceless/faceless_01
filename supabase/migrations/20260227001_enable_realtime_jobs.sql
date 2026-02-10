-- Enable full replica identity for jobs table (needed for Realtime updates)
-- Without this, Supabase Realtime may not detect UPDATE events properly

ALTER TABLE jobs REPLICA IDENTITY FULL;

-- Also enable for related tables used in real-time subscriptions
ALTER TABLE generation_batches REPLICA IDENTITY FULL;
ALTER TABLE job_step_logs REPLICA IDENTITY FULL;

-- Enable the jobs table for realtime if not already done
-- This adds the table to the supabase_realtime publication
DO $$
BEGIN
    -- Check if publication exists
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        -- Add tables to publication if not already members
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND tablename = 'jobs'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE jobs;
        END IF;
        
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND tablename = 'generation_batches'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE generation_batches;
        END IF;
        
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND tablename = 'job_step_logs'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE job_step_logs;
        END IF;
    END IF;
END
$$;

COMMENT ON TABLE jobs IS 'Video generation jobs - realtime enabled for UI updates';
