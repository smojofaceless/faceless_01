// Connections page — global state and OAuth configs
// Extracted from connections.html

let selectedPlatform = null;

// YouTube OAuth config
const YOUTUBE_CONFIG = {
    clientId: localStorage.getItem('youtube_client_id') || '',
    clientSecret: localStorage.getItem('youtube_client_secret') || '',
    redirectUri: window.location.href.split('?')[0].split('#')[0]
};

// Meta (Instagram/Facebook) OAuth config
const META_CONFIG = {
    appId: localStorage.getItem('meta_app_id') || '912945051115410',
    appSecret: localStorage.getItem('meta_app_secret') || '',
    redirectUri: window.location.href.split('?')[0].split('#')[0]
};

// TikTok OAuth config
const TIKTOK_CONFIG = {
    clientKey: localStorage.getItem('tiktok_client_key') || 'aw4ab4x5mxatmvsh',
    clientSecret: localStorage.getItem('tiktok_client_secret') || '1LsA4GRFWiYcGGb8Ydb2OLIpNOWwxv5j',
    redirectUri: window.location.href.split('?')[0].split('#')[0]
};

// Threads OAuth config
const THREADS_CONFIG = {
    appId: localStorage.getItem('threads_app_id') || '1747466246227767',
    appSecret: localStorage.getItem('threads_app_secret') || '51c57c50e2a25e19e18cb4be3ab3f36a',
    redirectUri: window.location.href.split('?')[0].split('#')[0]
};

// X (Twitter) OAuth 2.0 with PKCE config
const TWITTER_CONFIG = {
    clientId: localStorage.getItem('twitter_client_id') || 'eFFMeE5QZnZjelI2N2hRWGN6NEE6MTpjaQ',
    clientSecret: localStorage.getItem('twitter_client_secret') || 'npZPXLlsGCB9IG2-1OiSJFk3r9h61dglbX3pP7LdxfNQxbPLE8',
    redirectUri: window.location.href.split('?')[0].split('#')[0]
};
