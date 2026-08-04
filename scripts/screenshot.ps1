# Take a screenshot of the Markview window.
#
# Usage:
#   scripts\screenshot.ps1 -DocPath design-assets/showcase.md -OutPath design-assets/screenshots/rendered-light.png
#
# Prereqs:
#   * A local Tauri build exists at src-tauri/target/release/markview.exe
#     (produced by `npm run build:tauri` or `cargo tauri build`).
#   * You are running on the Windows host with a visible desktop session —
#     this script does not work over a headless SSH connection.

param(
    [Parameter(Mandatory=$true)][string]$DocPath,
    [Parameter(Mandatory=$true)][string]$OutPath,
    [string]$AppPath = "src-tauri/target/release/markview.exe",
    [int]$Width = 1360,
    [int]$Height = 860,
    [int]$WaitMs = 4500,
    [int]$X = 100,
    [int]$Y = 60,
    [string[]]$SendKeys = @()
)

$ErrorActionPreference = "Stop"

$appAbsolute = (Resolve-Path $AppPath).Path
$docAbsolute = (Resolve-Path $DocPath).Path
$outAbsolute = Join-Path (Get-Location) $OutPath
$outDir = Split-Path -Parent $outAbsolute
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$win32 = @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr SetWindowPos(IntPtr h, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern IntPtr ClientToScreen(IntPtr h, ref POINT p);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@
if (-not ([System.Management.Automation.PSTypeName]"Win32").Type) {
    Add-Type -TypeDefinition $win32 -Language CSharp
}

Write-Host "[screenshot] Launching: $appAbsolute `"$docAbsolute`""
$proc = Start-Process -FilePath $appAbsolute -ArgumentList "`"$docAbsolute`"" -PassThru

# Wait for the window to exist and settle
$deadline = (Get-Date).AddSeconds(20)
$hwnd = [IntPtr]::Zero
while ((Get-Date) -lt $deadline -and $hwnd -eq [IntPtr]::Zero) {
    Start-Sleep -Milliseconds 300
    try {
        $p = Get-Process -Id $proc.Id -ErrorAction Stop
        if ($p.MainWindowHandle -ne [IntPtr]::Zero) { $hwnd = $p.MainWindowHandle }
    } catch { }
}
if ($hwnd -eq [IntPtr]::Zero) { throw "Markview window did not appear within 20s" }

# SWP_SHOWWINDOW = 0x40
[Win32]::SetWindowPos($hwnd, [IntPtr]::Zero, $X, $Y, $Width, $Height, 0x40) | Out-Null
[Win32]::ShowWindow($hwnd, 5) | Out-Null   # SW_SHOW
[Win32]::SetForegroundWindow($hwnd) | Out-Null

Start-Sleep -Milliseconds $WaitMs

# Optional: send keystrokes (view mode toggles, dark mode)
foreach ($keys in $SendKeys) {
    [Win32]::SetForegroundWindow($hwnd) | Out-Null
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait($keys)
    Start-Sleep -Milliseconds 900
}

# Give the WebView a beat to paint after any keystrokes
Start-Sleep -Milliseconds 700

# Screenshot the window region via CopyFromScreen (works for WebView2 unlike PrintWindow)
$rect = New-Object Win32+RECT
[Win32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { throw "Window rect is empty: $w x $h" }

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $w, $h))
$g.Dispose()
$bmp.Save($outAbsolute, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Host "[screenshot] Saved: $outAbsolute ($w x $h)"

# Clean shutdown
try {
    Stop-Process -Id $proc.Id -Force -ErrorAction Stop
} catch { }
