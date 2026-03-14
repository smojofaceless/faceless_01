#Requires -Version 5.1
<#
.SYNOPSIS
    Watchdog that monitors the Cloudflare tunnel and auto-restarts if dead.
    
.DESCRIPTION
    Run this every 5 minutes via Task Scheduler. It:
    1. Reads the current tunnel URL from logs/current-tunnel-url.txt
    2. Pings it with a health check
    3. If unreachable (DNS fail, timeout, non-200), restarts the tunnel
    4. Updates the Supabase secret with the new URL
    
    This prevents stale tunnel URLs from causing job failures.

.NOTES
    Schedule with: 
      schtasks /create /tn "ContentEngine-TunnelWatchdog" /tr "powershell -ExecutionPolicy Bypass -File D:\SMOJO\Online\Buisness\faceless_01\scripts\tunnel-watchdog.ps1" /sc minute /mo 5 /ru SYSTEM
#>

# ─── CONFIG ──────────────────────────────────────────────────────────────────
$PROJECT_DIR      = "D:\SMOJO\Online\Buisness\faceless_01"
$TUNNEL_URL_FILE  = "$PROJECT_DIR\logs\current-tunnel-url.txt"
$WATCHDOG_LOG     = "$PROJECT_DIR\logs\tunnel-watchdog.log"
$STARTUP_SCRIPT   = "$PROJECT_DIR\scripts\start-comfyui-tunnel.ps1"
$MAX_LOG_LINES    = 500
$HEALTH_TIMEOUT   = 15  # seconds
$NODE_EXE         = "C:\Program Files\nodejs\node.exe"
# ─────────────────────────────────────────────────────────────────────────────

# Ensure log directory
$logDir = Split-Path $WATCHDOG_LOG -Parent
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Write-WatchdogLog {
    param([string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $Message"
    # Append to log
    Add-Content -Path $WATCHDOG_LOG -Value $line
}

# Trim log if too long
if (Test-Path $WATCHDOG_LOG) {
    $lines = Get-Content $WATCHDOG_LOG -ErrorAction SilentlyContinue
    if ($lines -and $lines.Count -gt $MAX_LOG_LINES) {
        $lines | Select-Object -Last ($MAX_LOG_LINES / 2) | Set-Content $WATCHDOG_LOG
        Write-WatchdogLog "--- Log trimmed ---"
    }
}

# ─── CHECK 1: Is cloudflared process alive? ─────────────────────────────────
$cfProc = Get-Process cloudflared -ErrorAction SilentlyContinue
if (-not $cfProc) {
    Write-WatchdogLog "ALERT: cloudflared process not found. Restarting tunnel..."
    & $STARTUP_SCRIPT
    exit 0
}

# ─── CHECK 2: Can we reach the tunnel URL? ──────────────────────────────────
if (-not (Test-Path $TUNNEL_URL_FILE)) {
    Write-WatchdogLog "ALERT: No tunnel URL file found. Restarting tunnel..."
    & $STARTUP_SCRIPT
    exit 0
}

$tunnelUrl = (Get-Content $TUNNEL_URL_FILE -Raw).Trim()
if (-not $tunnelUrl) {
    Write-WatchdogLog "ALERT: Tunnel URL file is empty. Restarting tunnel..."
    & $STARTUP_SCRIPT
    exit 0
}

# Ping the health endpoint through the tunnel
try {
    $healthResult = & $NODE_EXE -e @"
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), ${HEALTH_TIMEOUT}000);
fetch('${tunnelUrl}/comfyui-health', { signal: controller.signal })
  .then(r => { clearTimeout(timeout); return r.ok ? 'OK' : 'HTTP_' + r.status; })
  .then(s => console.log(s))
  .catch(e => console.log('FAIL:' + e.message));
"@ 2>&1

    $healthResult = ($healthResult | Out-String).Trim()
    
    if ($healthResult -eq 'OK') {
        # Tunnel is healthy — nothing to do
        Write-WatchdogLog "OK: Tunnel healthy ($tunnelUrl)"
        exit 0
    } else {
        Write-WatchdogLog "ALERT: Health check failed ($healthResult). Restarting tunnel..."
    }
} catch {
    Write-WatchdogLog "ALERT: Health check exception ($($_.Exception.Message)). Restarting tunnel..."
}

# ─── RESTART ─────────────────────────────────────────────────────────────────
Write-WatchdogLog "Restarting tunnel via start-comfyui-tunnel.ps1..."
& $STARTUP_SCRIPT

# Verify the restart worked
Start-Sleep -Seconds 5
if (Test-Path $TUNNEL_URL_FILE) {
    $newUrl = (Get-Content $TUNNEL_URL_FILE -Raw).Trim()
    Write-WatchdogLog "Restart complete. New URL: $newUrl"
} else {
    Write-WatchdogLog "WARNING: Restart completed but no URL file found"
}
