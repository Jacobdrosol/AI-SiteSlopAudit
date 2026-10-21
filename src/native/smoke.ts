import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Finding } from "../core/types.js";

const execFileAsync = promisify(execFile);

export interface SmokeStep {
  width: number;
  height: number;
  alive: boolean;
  responding: boolean;
}

export interface SmokeResult {
  ran: boolean;
  platform: string;
  windowFound: boolean;
  resized: SmokeStep[];
  exitedDuring: boolean;
  exitCode: number | null;
  crashAt: string | null;
  respondingAtEnd: boolean | null;
  resizeFailed: boolean;
  error?: string;
  note?: string;
  durationMs: number;
}

export interface SmokeOptions {
  exe: string;
  cwd?: string;
  timeoutMs?: number;
  sizes?: Array<[number, number]>;
}

const DEFAULT_SIZES: Array<[number, number]> = [
  [800, 600],
  [1280, 720],
  [640, 480],
  [1024, 768],
];

const PS_SCRIPT = String.raw`
param(
  [Parameter(Mandatory=$true)][string]$Exe,
  [string]$WorkDir = "",
  [int]$TimeoutMs = 15000
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SlopWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
'@

if ([string]::IsNullOrWhiteSpace($WorkDir)) {
  $WorkDir = Split-Path -Parent $Exe
}

$p = Start-Process -FilePath $Exe -WorkingDirectory $WorkDir -PassThru
$deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
$h = [IntPtr]::Zero
$windowFound = $false

while ([DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Milliseconds 150
  $p.Refresh()
  if ($p.HasExited) { break }
  if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
    $h = $p.MainWindowHandle
    $windowFound = $true
    break
  }
}

$exitedDuring = $p.HasExited
$resized = @()
$crashAt = $null
$respondingAtEnd = $null
$resizeFailed = $false

if ($windowFound -and -not $exitedDuring) {
  [SlopWin]::PostMessage($h, 0x0231, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  $sizes = @(@(800,600), @(1280,720), @(640,480), @(1024,768))
  foreach ($s in $sizes) {
    if ($p.HasExited) { break }
    $ok = [SlopWin]::SetWindowPos($h, [IntPtr]::Zero, 100, 100, $s[0], $s[1], 0x0004 -bor 0x0010)
    if (-not $ok) { $resizeFailed = $true }
    Start-Sleep -Milliseconds 350
    $p.Refresh()
    $alive = -not $p.HasExited
    $responding = $false
    if ($alive) {
      try { $responding = $p.Responding } catch { $responding = $false }
    }
    $resized += [pscustomobject]@{ width = $s[0]; height = $s[1]; alive = $alive; responding = $responding }
    if (-not $alive) {
      $crashAt = "$($s[0])x$($s[1])"
      break
    }
  }
  if (-not $p.HasExited) {
    [SlopWin]::PostMessage($h, 0x0232, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    try { $respondingAtEnd = $p.Responding } catch { $respondingAtEnd = $false }
  }
}

$exitedDuring = $p.HasExited
$exitCode = $null
if ($exitedDuring) {
  try { $exitCode = $p.ExitCode } catch { $exitCode = $null }
} else {
  [SlopWin]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  if (-not $p.WaitForExit(3000)) {
    try { $p.Kill(); $p.WaitForExit(2000) } catch {}
  }
  try { $exitCode = $p.ExitCode } catch { $exitCode = $null }
}

[pscustomobject]@{
  ran = $true
  platform = "win32"
  windowFound = $windowFound
  resized = @($resized)
  exitedDuring = $exitedDuring
  exitCode = $exitCode
  crashAt = $crashAt
  respondingAtEnd = $respondingAtEnd
  resizeFailed = $resizeFailed
  error = $null
} | ConvertTo-Json -Compress -Depth 6
`;

function formatExitCode(code: number | null): string {
  if (code === null) return "unknown exit code";
  if (code < 0) return `0x${(code >>> 0).toString(16).toUpperCase()} (${code})`;
  if (code > 0x80000000) return `0x${code.toString(16).toUpperCase()} (${code})`;
  return String(code);
}

function looksLikeCrash(code: number | null): boolean {
  if (code === null) return false;
  return code < 0 || code >= 0x80000000;
}

export async function runNativeSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const started = Date.now();
  const exe = path.resolve(options.exe);
  const base: SmokeResult = {
    ran: false,
    platform: process.platform,
    windowFound: false,
    resized: [],
    exitedDuring: false,
    exitCode: null,
    crashAt: null,
    respondingAtEnd: null,
    resizeFailed: false,
    durationMs: 0,
  };

  if (process.platform !== "win32") {
    return {
      ...base,
      note: "runtime smoke is currently implemented on Windows; static checks still ran",
      durationMs: Date.now() - started,
    };
  }

  try {
    const stat = await fs.stat(exe);
    if (!stat.isFile()) {
      return { ...base, error: `not a file: ${exe}`, durationMs: Date.now() - started };
    }
  } catch {
    return { ...base, error: `executable not found: ${exe}`, durationMs: Date.now() - started };
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "slopaudit-smoke-"));
  const script = path.join(dir, "smoke.ps1");
  const timeoutMs = options.timeoutMs ?? 20000;
  try {
    await fs.writeFile(script, PS_SCRIPT, "utf8");
    const { stdout } = await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-Exe",
        exe,
        "-WorkDir",
        options.cwd ?? path.dirname(exe),
        "-TimeoutMs",
        String(timeoutMs),
      ],
      {
        timeout: timeoutMs + 40000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const text = String(stdout).trim();
    const start = text.indexOf("{");
    if (start < 0) {
      return { ...base, error: "smoke harness produced no JSON", durationMs: Date.now() - started };
    }
    const parsed = JSON.parse(text.slice(start)) as Partial<SmokeResult>;
    return {
      ...base,
      ...parsed,
      ran: true,
      platform: "win32",
      resized: Array.isArray(parsed.resized) ? parsed.resized : [],
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const text = String(e.stdout ?? "").trim();
    const start = text.indexOf("{");
    if (start >= 0) {
      try {
        const parsed = JSON.parse(text.slice(start)) as Partial<SmokeResult>;
        return {
          ...base,
          ...parsed,
          ran: true,
          platform: "win32",
          resized: Array.isArray(parsed.resized) ? parsed.resized : [],
          durationMs: Date.now() - started,
        };
      } catch {
        // fall through
      }
    }
    return {
      ...base,
      error: (e.stderr || e.message || "smoke harness failed").slice(0, 500),
      durationMs: Date.now() - started,
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Turn a smoke run into findings. A clean run returns no findings. */
export function smokeFindings(result: SmokeResult, label: string): Finding[] {
  if (!result.ran || result.error) return [];
  const findings: Finding[] = [];
  const sizes = (result.resized ?? []).map((s) => `${s.width}x${s.height}`).join(", ");

  if (result.exitedDuring && !result.windowFound) {
    const crash = looksLikeCrash(result.exitCode);
    findings.push({
      ruleId: crash ? "native.runtime-crash" : "native.runtime-exit",
      category: "code",
      severity: crash ? "critical" : "high",
      title: crash ? "App crashed before opening a window" : "App exited before opening a window",
      detail: `The process ended before any top-level window appeared, with ${formatExitCode(result.exitCode)}. A packaged app that cannot get to its first frame is not shippable.`,
      location: label,
      evidence: [{ label: "exit code", value: formatExitCode(result.exitCode) }],
      fix: "Run it from a console or debugger to see the first failure. Check runtime DLL/plugin deployment, device creation and every unchecked startup result.",
      confidence: 0.95,
    });
    return findings;
  }

  if (!result.windowFound) {
    findings.push({
      ruleId: "native.runtime-no-window",
      category: "code",
      severity: "high",
      title: "App did not create a top-level window",
      detail: `The process started but no top-level window appeared within the timeout. It may be stuck on a modal error, a splash screen, or a blocked startup path.`,
      location: label,
      fix: "Check startup logging, the main event loop, and any modal dialog or blocking wait before the main window is shown.",
      confidence: 0.8,
    });
    return findings;
  }

  if (result.crashAt) {
    findings.push({
      ruleId: "native.runtime-resize-crash",
      category: "code",
      severity: "critical",
      title: `App crashed when resized to ${result.crashAt}`,
      detail: `The window opened, then the process died during a resize to ${result.crashAt}, with ${formatExitCode(result.exitCode)}. This is exactly the 'looks fine, then you drag the edge' failure.`,
      location: label,
      evidence: [{ label: "sizes tested", value: sizes || result.crashAt }],
      fix: "Handle the resize path: resize the swapchain/render targets, update the viewport and projection, and recheck every graphics result. Test at the minimum and maximum window size.",
      confidence: 0.98,
    });
    return findings;
  }

  if (result.respondingAtEnd === false || result.resized.some((s) => s.alive && !s.responding)) {
    findings.push({
      ruleId: "native.runtime-hang",
      category: "performance",
      severity: "high",
      title: "App stopped responding during resize",
      detail: `The window went unresponsive while being resized (${sizes || "no sizes recorded"}). A blocked UI thread reads as a hang or a crash.`,
      location: label,
      evidence: [{ label: "sizes tested", value: sizes }],
      fix: "Move work off the UI thread, keep the resize handler cheap, and never sleep or wait on the UI thread.",
      confidence: 0.85,
    });
    return findings;
  }

  if (result.resizeFailed) {
    findings.push({
      ruleId: "native.runtime-resize-failed",
      category: "code",
      severity: "medium",
      title: "Resize request was rejected",
      detail: "The window did not accept a programmatic resize, so the app may be fixed-size or ignoring the resize path.",
      location: label,
      fix: "Make the window resizable and verify the resize handler runs.",
      confidence: 0.6,
    });
  }

  return findings;
}
