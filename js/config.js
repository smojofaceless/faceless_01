// =====================================================
// CONFIGURATION
// =====================================================
const CONFIG = {
    SUPABASE_URL: 'https://ustmetegzisztqqcjigt.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDc0NzksImV4cCI6MjA4NTEyMzQ3OX0.5lEiAP6PS4yY3WwAL5v4XWFHWJS5hzBWPXQxuxWe5d4',
    POLL_INTERVAL: 5000, // 5 seconds
};

// Tailwind configuration
if (typeof tailwind !== 'undefined') {
    tailwind.config = {
        theme: {
            extend: {
                colors: {
                    primary: '#ef4444',
                    secondary: '#991b1b',
                    dark: '#0f0f0f',
                }
            }
        }
    };
}
