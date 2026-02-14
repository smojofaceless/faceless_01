-- Add 'openai_tts' to all service CHECK constraints in cost control tables
-- Required for OpenAI gpt-4o-mini-tts voice synthesis provider

-- 1. cost_limits: service can be NULL (global) or a known service
ALTER TABLE cost_limits DROP CONSTRAINT IF EXISTS cost_limits_service_check;
ALTER TABLE cost_limits ADD CONSTRAINT cost_limits_service_check
    CHECK (service IS NULL OR service IN (
        'openai_text', 
        'openai_image', 
        'openai_tts',
        'elevenlabs', 
        'ffmpeg_renderer',
        'creatomate'
    ));

-- 2. api_usage: service is NOT NULL
ALTER TABLE api_usage DROP CONSTRAINT IF EXISTS api_usage_service_check;
ALTER TABLE api_usage ADD CONSTRAINT api_usage_service_check
    CHECK (service IN (
        'openai_text', 
        'openai_image', 
        'openai_tts',
        'elevenlabs', 
        'ffmpeg_renderer',
        'creatomate'
    ));

-- 3. api_slots: service is NOT NULL
ALTER TABLE api_slots DROP CONSTRAINT IF EXISTS api_slots_service_check;
ALTER TABLE api_slots ADD CONSTRAINT api_slots_service_check
    CHECK (service IN (
        'openai_text', 
        'openai_image', 
        'openai_tts',
        'elevenlabs', 
        'ffmpeg_renderer',
        'creatomate'
    ));
