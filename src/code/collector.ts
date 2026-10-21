import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  CodeFile,
  CodeSnapshot,
  DependencyInfo,
} from "./snapshot.js";
import { LANGUAGE_BY_EXT } from "./snapshot.js";

const execFileAsync = promisify(execFile);

export interface CodeCollectorOptions {
  root: string;
  maxFiles?: number;
  maxFileBytes?: number;
  include?: string[];
}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "out",
  "target",
  "bin",
  "obj",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "coverage",
  ".turbo",
  ".cache",
  "Pods",
  "DerivedData",
  ".gradle",
  ".idea",
  ".vs",
  "reports",
  "screenshots",
  "fixtures",
]);

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".svg",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".pdf", ".zip", ".gz", ".tar", ".7z", ".rar",
  ".mp3", ".mp4", ".mov", ".avi", ".wav",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".wasm", ".class", ".o", ".a",
  ".pyc", ".lock",
]);

const GENERATED_HINTS = [
  ".min.js", ".min.css", ".bundle.js", ".generated.", ".g.cs", ".designer.cs",
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
];

function isGenerated(relPath: string, content: string): boolean {
  const lower = relPath.toLowerCase();
  if (GENERATED_HINTS.some((h) => lower.includes(h))) return true;
  const head = content.slice(0, 400).toLowerCase();
  return (
    head.includes("code generated") ||
    head.includes("@generated") ||
    head.includes("do not edit") ||
    head.includes("auto-generated")
  );
}

function isTestPath(relPath: string): boolean {
  const lower = relPath.toLowerCase().replace(/\\/g, "/");
  return (
    /\/(tests?|__tests__|spec)\//.test(lower) ||
    /\.(test|spec)\.(ts|tsx|js|jsx|py|rb|go|java|cs)$/.test(lower) ||
    /_test\.(go|py)$/.test(lower) ||
    /test_.*\.py$/.test(lower) ||
    /\.feature$/.test(lower)
  );
}

function languageFor(ext: string): string {
  return LANGUAGE_BY_EXT[ext] ?? "Other";
}

async function loadGitignoreSet(root: string): Promise<Set<string> | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd: root, timeout: 15000, maxBuffer: 32 * 1024 * 1024 },
    );
    const set = new Set(
      stdout.split(/\r?\n/).filter(Boolean).map((p) => p.replace(/\\/g, "/")),
    );
    return set;
  } catch {
    return null;
  }
}

async function walk(
  root: string,
  include: string[] | undefined,
  maxFiles: number,
  maxFileBytes: number,
): Promise<{ files: CodeFile[]; skipped: number }> {
  const files: CodeFile[] = [];
  let skipped = 0;
  const includeSet = include?.map((i) => i.toLowerCase());
  const gitignored = await loadGitignoreSet(root);

  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (gitignored && !gitignored.has(rel)) {
        skipped += 1;
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXT.has(ext)) {
        skipped += 1;
        continue;
      }
      if (includeSet && !includeSet.some((i) => rel.toLowerCase().includes(i) || ext === i)) {
        continue;
      }
      let stat;
      try {
        stat = await fs.stat(full);
      } catch {
        continue;
      }
      if (stat.size > maxFileBytes) {
        skipped += 1;
        continue;
      }
      let content: string;
      try {
        content = await fs.readFile(full, "utf8");
      } catch {
        skipped += 1;
        continue;
      }
      if (content.includes("\u0000")) {
        skipped += 1;
        continue;
      }
      const lines = content.length === 0 ? 0 : content.split(/\r?\n/).length;
      files.push({
        path: full,
        relPath: rel,
        ext,
        language: languageFor(ext),
        bytes: stat.size,
        lines,
        content,
        isTest: isTestPath(rel),
        isGenerated: isGenerated(rel, content),
      });
    }
  }

  await visit(root);
  return { files, skipped };
}

async function readJsonSafe(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function collectDependencies(root: string): Promise<DependencyInfo[]> {
  const out: DependencyInfo[] = [];

  const pkgPath = path.join(root, "package.json");
  const pkg = await readJsonSafe(pkgPath);
  if (pkg) {
    const deps: DependencyInfo["dependencies"] = [];
    const read = (obj: unknown, scope: string) => {
      if (!obj || typeof obj !== "object") return;
      for (const [name, raw] of Object.entries(obj as Record<string, string>)) {
        deps.push({
          name,
          version: String(raw),
          pinned: /^\d+\.\d+\.\d+/.test(String(raw)),
          scope,
        });
      }
    };
    read(pkg.dependencies, "prod");
    read(pkg.devDependencies, "dev");
    read(pkg.peerDependencies, "peer");
    const hasLock = await exists(path.join(root, "package-lock.json")) ||
      await exists(path.join(root, "yarn.lock")) ||
      await exists(path.join(root, "pnpm-lock.yaml"));
    out.push({
      manager: "npm",
      manifestPath: "package.json",
      lockfilePresent: hasLock,
      dependencies: deps,
      devDependencies: deps.filter((d) => d.scope === "dev").length,
    });
  }

  const reqPath = path.join(root, "requirements.txt");
  const reqContent = await readTextSafe(reqPath);
  if (reqContent !== null) {
    const deps = reqContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("-"))
      .map((l) => {
        const [name, version] = l.split(/[=<>~!]+/);
        return {
          name: (name ?? l).trim(),
          version: (version ?? "").trim(),
          pinned: l.includes("=="),
          scope: "prod",
        };
      });
    out.push({
      manager: "pip",
      manifestPath: "requirements.txt",
      lockfilePresent: await exists(path.join(root, "requirements.lock")) ||
        await exists(path.join(root, "poetry.lock")) ||
        await exists(path.join(root, "Pipfile.lock")),
      dependencies: deps,
      devDependencies: 0,
    });
  }

  const cargoPath = path.join(root, "Cargo.toml");
  const cargo = await readTextSafe(cargoPath);
  if (cargo !== null) {
    const deps: DependencyInfo["dependencies"] = [];
    let inDeps = false;
    for (const line of cargo.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("[")) {
        inDeps = /\[(dependencies|dev-dependencies|build-dependencies)\]/.test(trimmed);
        continue;
      }
      if (!inDeps || !trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
      if (m) {
        const versionMatch = m[2]!.match(/"([^"]+)"/);
        deps.push({
          name: m[1]!,
          version: versionMatch ? versionMatch[1]! : m[2]!,
          pinned: versionMatch ? /^\d+\.\d+\.\d+/.test(versionMatch[1]!) : false,
          scope: "prod",
        });
      }
    }
    out.push({
      manager: "cargo",
      manifestPath: "Cargo.toml",
      lockfilePresent: await exists(path.join(root, "Cargo.lock")),
      dependencies: deps,
      devDependencies: 0,
    });
  }

  const goModPath = path.join(root, "go.mod");
  const goMod = await readTextSafe(goModPath);
  if (goMod !== null) {
    const deps = goMod
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("module ") && !l.startsWith("go ") && !l.startsWith("require (") && l !== ")")
      .map((l) => l.replace(/^require\s+/, ""))
      .map((l) => l.split(/\s+/))
      .filter((parts) => parts.length >= 2)
      .map((parts) => ({
        name: parts[0]!,
        version: parts[1]!,
        pinned: /^v\d+\.\d+\.\d+/.test(parts[1]!),
        scope: "prod",
      }));
    out.push({
      manager: "go",
      manifestPath: "go.mod",
      lockfilePresent: await exists(path.join(root, "go.sum")),
      dependencies: deps,
      devDependencies: 0,
    });
  }

  return out;
}

async function readTextSafe(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function collectGit(root: string): Promise<CodeSnapshot["git"]> {
  const isRepo = await exists(path.join(root, ".git"));
  if (!isRepo) {
    let dir = path.dirname(root);
    for (let i = 0; i < 12 && dir && dir !== path.dirname(dir); i++) {
      if (await exists(path.join(dir, ".git"))) {
        return {
          isRepo: true,
          commitCount: null,
          hasGitignore: await exists(path.join(root, ".gitignore")),
          trackedSecretCandidates: [],
        };
      }
      dir = path.dirname(dir);
    }
    return { isRepo: false, commitCount: null, hasGitignore: false, trackedSecretCandidates: [] };
  }
  let commitCount: number | null = null;
  try {
    const { stdout } = await execFileAsync("git", ["rev-list", "--count", "HEAD"], {
      cwd: root,
      timeout: 5000,
    });
    commitCount = Number(stdout.trim());
  } catch {
    commitCount = 0;
  }
  const hasGitignore = await exists(path.join(root, ".gitignore"));
  let trackedSecretCandidates: string[] = [];
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--", ".env", "*.pem", "*.key", "*id_rsa*", "*.pfx", "*.p12"],
      { cwd: root, timeout: 5000 },
    );
    trackedSecretCandidates = stdout.split(/\r?\n/).filter(Boolean);
  } catch {
    trackedSecretCandidates = [];
  }
  return { isRepo: true, commitCount, hasGitignore, trackedSecretCandidates };
}

export async function collectCodeSnapshot(
  options: CodeCollectorOptions,
): Promise<CodeSnapshot> {
  const root = path.resolve(options.root);
  const maxFiles = options.maxFiles ?? 8000;
  const maxFileBytes = options.maxFileBytes ?? 1_000_000;
  const { files, skipped } = await walk(root, options.include, maxFiles, maxFileBytes);
  const languages: Record<string, { files: number; lines: number }> = {};
  let totalLines = 0;
  for (const f of files) {
    totalLines += f.lines;
    const entry = languages[f.language] ?? { files: 0, lines: 0 };
    entry.files += 1;
    entry.lines += f.lines;
    languages[f.language] = entry;
  }

  const [dependencies, git, hasReadme, hasLicense] = await Promise.all([
    collectDependencies(root),
    collectGit(root),
    findAny(root, ["README.md", "README", "readme.md", "README.txt"]),
    findAny(root, ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"]),
  ]);

  const hasTests =
    files.some((f) => f.isTest) ||
    (await exists(path.join(root, "tests"))) ||
    (await exists(path.join(root, "test")));

  return {
    root,
    files,
    totalFiles: files.length,
    totalLines,
    scannedFiles: files.length,
    skippedFiles: skipped,
    languages,
    dependencies,
    git,
    hasReadme,
    hasLicense,
    hasTests,
    generatedAt: new Date().toISOString(),
  };
}

async function findAny(root: string, names: string[]): Promise<boolean> {
  for (const n of names) {
    if (await exists(path.join(root, n))) return true;
  }
  return false;
}
