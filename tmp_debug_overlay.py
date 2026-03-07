import urllib.request, json

key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTU0NzQ3OSwiZXhwIjoyMDg1MTIzNDc5fQ.01lwYvZ-DG8zLMgJfCW4zHVXyegAOaXGf2XPsHpIOn8'

# Call effects RPC with correct params
body = json.dumps({
    'p_brand_id': '68a58afb-8c85-4d6d-9eec-144ab7e5f106',
    'p_vibe_preset': 'dark_origins',
    'p_job_meta': {}
}).encode()
req = urllib.request.Request(
    'https://ustmetegzisztqqcjigt.supabase.co/rest/v1/rpc/get_effects_config_for_job',
    data=body,
    headers={
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json'
    }
)
try:
    resp = urllib.request.urlopen(req)
    raw = resp.read().decode()
    data = json.loads(raw)
    if isinstance(data, dict):
        ov = data.get('overlay_video')
        print('overlay_video:', json.dumps(ov, indent=2) if ov else 'NOT FOUND IN RESPONSE')
        print()
        print('all keys:', sorted(data.keys()))
    else:
        print('type:', type(data).__name__)
        print('value:', str(data)[:500])
except urllib.error.HTTPError as e:
    body_err = e.read().decode() if hasattr(e, 'read') else ''
    print('HTTP Error %d: %s' % (e.code, e.reason))
    print('Body:', body_err[:500])
except Exception as e:
    print('Error:', e)
