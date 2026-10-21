import { promises as fs } from "node:fs";
import path from "node:path";
import type { DesktopFile, DesktopSnapshot } from "./snapshot.js";
import { XAML_EXTS } from "./snapshot.js";

export interface DesktopCollectorOptions {
  root: string;
  maxFiles?: number;
}

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "bin", "obj", ".vs", ".idea", ".vscode",
  "TestResults", "packages", "dist", "build", "out", "tests", "test",
  "__tests__", ".gradle", "coverage",
]);

const INCLUDE_EXTS = new Set([
  ".axaml", ".xaml", ".cs", ".csproj", ".fsproj", ".vbproj", ".sln", ".props", ".targets",
]);

const MAX_FILE_BYTES = 1_500_000;
const DEFAULT_MAX_FILES = 6000;

const FRAMEWORK_MARKERS: Array<{ label: string; re: RegExp }> = [
  { label: "Avalonia", re: /Avalonia/i },
  { label: "WinUI", re: /Microsoft\.UI\.Xaml|<UseWinUI>/i },
  { label: "WPF", re: /PresentationFramework|<UseWPF>true/i },
  { label: "MAUI", re: /Microsoft\.Maui/i },
  { label: "Uno", re: /Uno\.UI|Uno\.WinUI/i },
];

function detectFrameworks(files: DesktopFile[]): string[] {
  const found = new Set<string>();
  for (const file of files) {
    for (const marker of FRAMEWORK_MARKERS) {
      if (marker.re.test(file.content)) found.add(marker.label);
    }
  }
  return [...found];
}

export async function collectDesktopSnapshot(
  options: DesktopCollectorOptions,
): Promise<DesktopSnapshot> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const files: DesktopFile[] = [];

  async function walk(dir: string): Promise<void> {
    if (files.length >= maxFiles) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) await walk(full);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!INCLUDE_EXTS.has(ext)) continue;

      try {
        const stat = await fs.stat(full);
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = await fs.readFile(full, "utf8");
        files.push({
          path: full,
          rel: path.relative(options.root, full).replace(/\\/g, "/"),
          ext,
          content,
          lines: content.split(/\r?\n/),
        });
      } catch {
        continue;
      }
    }
  }

  await walk(options.root);

  const xamlFiles = files.filter((f) => XAML_EXTS.has(f.ext));
  const csFiles = files.filter((f) => f.ext === ".cs");
  const projectFiles = files.filter((f) =>
    [".csproj", ".fsproj", ".vbproj", ".sln", ".props", ".targets"].includes(f.ext),
  );

  return {
    root: options.root,
    files,
    xamlFiles,
    csFiles,
    projectFiles,
    frameworks: detectFrameworks(projectFiles),
    totalFiles: files.length,
    totalLines: files.reduce((sum, f) => sum + f.lines.length, 0),
  };
}
