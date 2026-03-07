#Requires -Version 5.1
<#
.SYNOPSIS
    Auto-starts the video-renderer + Cloudflare tunnel and updates Supabase secret.
    
.DESCRIPTION
    This script:
    1. Starts the video-renderer (server_clean.js) on port 3001 if not already running
    2. Starts a Cloudflare quick tunnel pointing to localhost:3001
    3. Captures the random tunnel URL
    4. Updates the COMFYUI_RENDERER_URL Supabase secret so edge functions can reach ComfyUI
    
    Designed to run on Windows login via Task Scheduler.
    
.NOTES
    The quick tunnel URL changes each time. This script auto-updates the Supabase secret.
#>

# ─── CONFIG ──────────────────────────────────────────────────────────────────
$PROJECT_DIR      = "D:\SMOJO\Online\Buisness\faceless_01"
$RENDERER_DIR     = "$PROJECT_DIR\video-renderer"
$RENDERER_PORT    = 3001
$CLOUDFLARED_EXE  = "C:\Users\Justin\AppData\Roaming\npm\node_modules\cloudflared\bin\cloudflared.exe"
$NODE_EXE         = "C:\Program Files\nodejs\node.exe"
$NPX_CMD          = "C:\Program Files\nodejs\npx.cmd"
$TUNNEL_LOG       = "$env:TEMP\cloudflared-tunnel.log"
$STARTUP_LOG      = "$PROJECT_DIR\logs\tunnel-startup.log"
$MAX_WAIT_SECS    = 45
# ─────────────────────────────────────────────────────────────────────────────

# Ensure log directory exists
$logDir = Split-Path $STARTUP_LOG -Parent
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Write-Log {
    param([string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $Message"
    Write-Host $line
    Add-Content -Path $STARTUP_LOG -Value $line
}

function Test-Port {
    param([int]$Port)
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", $Port)
        $tcp.Close()
        return $true
    } catch {
        return $false
    }
}

# ─── STEP 1: Start video-renderer if not running ────────────────────────────
Write-Log "=== ComfyUI Tunnel Startup ==="
Write-Log "Checking if video-renderer is already running on port $RENDERER_PORT..."

if (Test-Port $RENDERER_PORT) {
    Write-Log "Video-renderer already running on port $RENDERER_PORT - skipping start"
} else {
    Write-Log "Starting video-renderer..."
    
    $rendererProc = Start-Process -FilePath $NODE_EXE `
        -ArgumentList "server_clean.js" `
        -WorkingDirectory $RENDERER_DIR `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput "$env:TEMP\renderer-stdout.log" `
        -RedirectStandardError "$env:TEMP\renderer-stderr.log"
    
    Write-Log "Video-renderer started (PID: $($rendererProc.Id)). Waiting for it to be ready..."
    
    $ready = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 2
        if (Test-Port $RENDERER_PORT) {
            $ready = $true
            break
        }
    }
    
    if ($ready) {
        Write-Log "Video-renderer is ready on port $RENDERER_PORT"
    } else {
        Write-Log "WARNING: Video-renderer did not start within 40s. Continuing anyway..."
    }
}

# ─── STEP 2: Kill any existing cloudflared tunnels ──────────────────────────
Write-Log "Stopping any existing cloudflared processes..."
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# ─── STEP 3: Start Cloudflare tunnel ────────────────────────────────────────
Write-Log "Starting Cloudflare tunnel to localhost:$RENDERER_PORT..."

# Clear old log
if (Test-Path $TUNNEL_LOG) { Remove-Item $TUNNEL_LOG -Force }

$tunnelProc = Start-Process -FilePath $CLOUDFLARED_EXE `
    -ArgumentList "tunnel", "--url", "http://localhost:$RENDERER_PORT" `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardError $TUNNEL_LOG `
    -RedirectStandardOutput "$env:TEMP\cloudflared-stdout.log"

Write-Log "Cloudflared started (PID: $($tunnelProc.Id)). Waiting for tunnel URL..."

# ─── STEP 4: Parse tunnel URL ───────────────────────────────────────────────
$tunnelUrl = $null
for ($i = 0; $i -lt $MAX_WAIT_SECS; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $TUNNEL_LOG) {
        $content = Get-Content $TUNNEL_LOG -Raw -ErrorAction SilentlyContinue
        if ($content -match '(https://[a-z0-9-]+\.trycloudflare\.com)') {
            $tunnelUrl = $Matches[1]
            break
        }
    }
}

if (-not $tunnelUrl) {
    Write-Log "ERROR: Could not capture tunnel URL after ${MAX_WAIT_SECS}s"
    Write-Log "Check $TUNNEL_LOG for details"
    exit 1
}

Write-Log "Tunnel URL: $tunnelUrl"

# Save URL to a file for reference
$tunnelUrl | Out-File "$PROJECT_DIR\logs\current-tunnel-url.txt" -Force

# ─── STEP 5: Update Supabase secret ─────────────────────────────────────────
Write-Log "Updating Supabase COMFYUI_RENDERER_URL secret..."

Push-Location $PROJECT_DIR
try {
    $result = & $NPX_CMD supabase secrets set "COMFYUI_RENDERER_URL=$tunnelUrl" 2>&1
    $exitCode = $LASTEXITCODE
    Write-Log "Supabase secrets set result (exit $exitCode): $result"
    
    if ($exitCode -eq 0) {
        Write-Log "SUCCESS! Supabase secret updated."
    } else {
        Write-Log "WARNING: Supabase secrets set may have failed. Exit code: $exitCode"
    }
} finally {
    Pop-Location
}

# ─── STEP 6: Verify tunnel health ───────────────────────────────────────────
Write-Log "Verifying tunnel is reachable..."
Start-Sleep -Seconds 3

try {
    $healthCheck = & $NODE_EXE -e "fetch('$tunnelUrl/comfyui-health').then(r=>r.json()).then(d=>console.log(JSON.stringify(d))).catch(e=>console.log('ERROR:'+e.message))" 2>&1
    Write-Log "Health check: $healthCheck"
} catch {
    Write-Log "Health check failed: $($_.Exception.Message)"
}

# ─── DONE ────────────────────────────────────────────────────────────────────
Write-Log "=== Startup complete ==="
Write-Log "Tunnel URL: $tunnelUrl"
Write-Log "Video-renderer: http://localhost:$RENDERER_PORT"
Write-Log "Logs: $STARTUP_LOG"
Write-Log ""
Write-Log "To stop: Get-Process cloudflared | Stop-Process -Force"
