@echo off
REM ═══════════════════════════════════════════════════════════════════
REM  Local GPU Server Startup Script
REM  Launches ComfyUI + Video Renderer for local image generation
REM
REM  Usage:
REM    1. Double-click this file, OR
REM    2. Add to Windows Task Scheduler for auto-start on login
REM
REM  Task Scheduler setup:
REM    - Trigger: "At log on"
REM    - Action: Start a program → this .bat file
REM    - "Run whether user is logged on or not" (optional)
REM ═══════════════════════════════════════════════════════════════════

title Local GPU Server (ComfyUI + Video Renderer)

REM ─── Configuration ─────────────────────────────────────────────────
REM Update these paths to match your installation:

SET COMFYUI_DIR=D:\ComfyUI_windows_portable\ComfyUI
SET VIDEO_RENDERER_DIR=%~dp0
SET COMFYUI_PORT=8188
SET VIDEO_RENDERER_PORT=3001

REM ─── Pre-flight checks ────────────────────────────────────────────

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║  Local GPU Server Startup                           ║
echo ╠══════════════════════════════════════════════════════╣
echo ║  ComfyUI:        %COMFYUI_DIR%
echo ║  Video Renderer: %VIDEO_RENDERER_DIR%
echo ╚══════════════════════════════════════════════════════╝
echo.

REM Check if ComfyUI directory exists
if not exist "%COMFYUI_DIR%" (
    echo [ERROR] ComfyUI directory not found: %COMFYUI_DIR%
    echo         Update COMFYUI_DIR in this script to your ComfyUI install path.
    echo.
    pause
    exit /b 1
)

REM Check nvidia-smi
nvidia-smi >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] nvidia-smi not found — GPU monitoring will be limited.
) else (
    echo [OK] NVIDIA GPU detected:
    nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader
)
echo.

REM ─── Start ComfyUI ────────────────────────────────────────────────

echo [1/2] Starting ComfyUI on port %COMFYUI_PORT%...

REM Check if ComfyUI is already running
curl -s http://127.0.0.1:%COMFYUI_PORT%/system_stats >nul 2>&1
if %errorlevel% equ 0 (
    echo       ComfyUI is already running! Skipping.
) else (
    REM Try the common batch file first, then fall back to python
    if exist "%COMFYUI_DIR%\run_nvidia_gpu.bat" (
        start "ComfyUI" /min cmd /c "cd /d %COMFYUI_DIR% && run_nvidia_gpu.bat"
    ) else if exist "%COMFYUI_DIR%\run_cpu.bat" (
        start "ComfyUI" /min cmd /c "cd /d %COMFYUI_DIR% && run_cpu.bat"
    ) else (
        start "ComfyUI" /min cmd /c "cd /d %COMFYUI_DIR% && python main.py --listen 127.0.0.1 --port %COMFYUI_PORT%"
    )
    
    REM Wait for ComfyUI to be ready (up to 90 seconds)
    echo       Waiting for ComfyUI to load models...
    set /a WAIT=0
    :wait_comfyui
    timeout /t 3 /nobreak >nul
    set /a WAIT+=3
    curl -s http://127.0.0.1:%COMFYUI_PORT%/system_stats >nul 2>&1
    if %errorlevel% equ 0 (
        echo       ComfyUI ready! (took ~%WAIT%s)
    ) else (
        if %WAIT% lss 90 goto wait_comfyui
        echo [WARN] ComfyUI not responding after 90s — it may still be loading.
        echo        The video renderer will start anyway and retry connections.
    )
)
echo.

REM ─── Start Video Renderer ─────────────────────────────────────────

echo [2/2] Starting Video Renderer on port %VIDEO_RENDERER_PORT%...

cd /d "%VIDEO_RENDERER_DIR%"

REM Check if already running
curl -s http://127.0.0.1:%VIDEO_RENDERER_PORT%/health >nul 2>&1
if %errorlevel% equ 0 (
    echo       Video Renderer is already running! Skipping.
) else (
    start "Video Renderer" /min cmd /c "cd /d %VIDEO_RENDERER_DIR% && node server_clean.js"
    
    REM Wait briefly for it to start
    timeout /t 5 /nobreak >nul
    curl -s http://127.0.0.1:%VIDEO_RENDERER_PORT%/health >nul 2>&1
    if %errorlevel% equ 0 (
        echo       Video Renderer ready!
    ) else (
        echo [WARN] Video Renderer not responding yet — may need a few more seconds.
    )
)

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║  All services started!                              ║
echo ║                                                     ║
echo ║  ComfyUI:        http://127.0.0.1:%COMFYUI_PORT%           ║
echo ║  Video Renderer: http://127.0.0.1:%VIDEO_RENDERER_PORT%           ║
echo ║  Health Check:   http://127.0.0.1:%VIDEO_RENDERER_PORT%/comfyui-health ║
echo ║                                                     ║
echo ║  Close this window to keep services running.        ║
echo ║  Close ComfyUI/Renderer windows to stop them.       ║
echo ╚══════════════════════════════════════════════════════╝
echo.
pause
