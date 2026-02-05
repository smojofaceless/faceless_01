# ============================================
# PRE-DEPLOY IMPORT CHECKER
# Run before deploying Supabase Edge Functions
# ============================================
# 
# RATIONALE: esm.sh, skypack, unpkg CDNs can timeout during bundle
# generation, causing "Bundle generation timed out" errors.
# Use npm: specifiers with pinned versions instead.
#
# USAGE: .\supabase\functions\check-imports.ps1
# ============================================

$ErrorActionPreference = "Stop"

Write-Host "`n========== SUPABASE EDGE FUNCTION IMPORT CHECKER ==========`n" -ForegroundColor Cyan

# Patterns that should NOT be in production edge functions
$blockedPatterns = @(
    "esm\.sh",
    "skypack\.dev", 
    "unpkg\.com",
    "cdn\.jsdelivr\.net"
)

$functionsPath = "supabase/functions"
$foundIssues = $false

foreach ($pattern in $blockedPatterns) {
    Write-Host "Checking for: $pattern" -ForegroundColor Yellow
    
    $matches = Get-ChildItem -Path $functionsPath -Recurse -Include "*.ts" | 
        Select-String -Pattern $pattern -AllMatches
    
    if ($matches) {
        $foundIssues = $true
        Write-Host "  ❌ FOUND blocked import pattern:" -ForegroundColor Red
        foreach ($match in $matches) {
            Write-Host "     $($match.Path):$($match.LineNumber)" -ForegroundColor Red
            Write-Host "     $($match.Line.Trim())" -ForegroundColor DarkRed
        }
    } else {
        Write-Host "  ✅ Clean" -ForegroundColor Green
    }
}

# Also check for unpinned versions (@2 instead of @2.x.x)
Write-Host "`nChecking for unpinned npm versions (@2 without patch)..." -ForegroundColor Yellow
$unpinnedMatches = Get-ChildItem -Path $functionsPath -Recurse -Include "*.ts" |
    Select-String -Pattern 'npm:[^@]+@\d+";' -AllMatches

if ($unpinnedMatches) {
    Write-Host "  ⚠️  Found potentially unpinned versions:" -ForegroundColor Yellow
    foreach ($match in $unpinnedMatches) {
        Write-Host "     $($match.Path):$($match.LineNumber)" -ForegroundColor Yellow
        Write-Host "     $($match.Line.Trim())" -ForegroundColor DarkYellow
    }
    Write-Host "  Consider pinning to specific versions (e.g., @2.39.3)" -ForegroundColor Yellow
}

Write-Host "`n============================================================`n" -ForegroundColor Cyan

if ($foundIssues) {
    Write-Host "❌ BLOCKED: Fix import issues before deploying!" -ForegroundColor Red
    Write-Host "   Use npm: specifiers with pinned versions instead." -ForegroundColor Red
    Write-Host "   Example: npm:@supabase/supabase-js@2.39.3" -ForegroundColor Gray
    exit 1
} else {
    Write-Host "✅ All imports look good! Safe to deploy." -ForegroundColor Green
    exit 0
}
