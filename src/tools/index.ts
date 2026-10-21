import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Finding, Severity } from "../core/types.js";

const execFileAsync = promisify(execFile);

// Orchestration layer. It does not reimplement vulnerability detection; it runs
// the best free, deterministic tools when they are installed and normalizes
// their output into this tool's Finding model, so one report and one score cover
// both slop and security. Every adapter degrades gracefully: if the tool is
// missing, the analyzer is skipped with a note, and the native checks still run.

export interface ProjectInfo {
  root: string;
  hasPackageJson: boolean;
  hasPython: boolean;
  hasCargo: boolean;
  hasTerraform: boolean;
  hasDockerfile: boolean;
  hasCpp: boolean;
  hasCMake: boolean;
  compileCommandsDir: string | null;
  languages: string[];
}

export interface AnalyzerResult {
  findings: Finding[];
  note?: string;
  ran: boolean;
}

export interface Analyzer {
  id: string;
  name: string;
  /** Command to detect availability, or null for always-available (e.g. npm). */
  probe: string | null;
  applies: (info: ProjectInfo) => boolean;
  run: (info: ProjectInfo, opts: RunOptions) => Promise<AnalyzerResult>;
}

export interface RunOptions {
  timeoutMs?: number;
  maxPerTool?: number;
  disabled?: string[];
}

const SEV_MAP: Record<string, Severity> = {
  error: "high",
  warning: "medium",
  note: "low",
  info: "low",
  critical: "critical",
  high: "high",
  medium: "medium",
  moderate: "medium",
  low: "low",
  unspecified: "low",
};

function toSeverity(raw: unknown, def: Severity = "medium"): Severity {
  const key = String(raw ?? "").toLowerCase();
  return SEV_MAP[key] ?? def;
}

// Native tools are frequently installed but not on PATH (Visual Studio ships
// clang-tidy; cppcheck has its own installer). These are discovery paths, not
// project configuration.
const TOOL_CANDIDATES: Record<string, string[]> = {
  "clang-tidy": [
    "C:/Program Files/Microsoft Visual Studio/2022/Community/VC/Tools/Llvm/x64/bin/clang-tidy.exe",
    "C:/Program Files/Microsoft Visual Studio/2022/BuildTools/VC/Tools/Llvm/x64/bin/clang-tidy.exe",
    "C:/Program Files/Microsoft Visual Studio/2022/Professional/VC/Tools/Llvm/x64/bin/clang-tidy.exe",
    "C:/Program Files/Microsoft Visual Studio/2022/Enterprise/VC/Tools/Llvm/x64/bin/clang-tidy.exe",
    "C:/Program Files/Microsoft Visual Studio/18/Community/VC/Tools/Llvm/x64/bin/clang-tidy.exe",
    "C:/Program Files/Microsoft Visual Studio/18/BuildTools/VC/Tools/Llvm/x64/bin/clang-tidy.exe",
    "C:/Program Files/LLVM/bin/clang-tidy.exe",
  ],
  cppcheck: [
    "C:/Program Files/Cppcheck/cppcheck.exe",
    "C:/Program Files (x86)/Cppcheck/cppcheck.exe",
  ],
};

async function resolveExecutable(cmd: string): Promise<string | null> {
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    await execFileAsync(finder, [cmd], { timeout: 5000, windowsHide: true });
    return cmd;
  } catch {
    for (const candidate of TOOL_CANDIDATES[cmd] ?? []) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // try the next known location
      }
    }
    return null;
  }
}

async function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  noShell = false,
): Promise<{ stdout: string; code: number }> {
  try {
    const executable = noShell ? ((await resolveExecutable(cmd)) ?? cmd) : cmd;
    const { stdout } = await execFileAsync(executable, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      // On Windows, node/npm and friends are .cmd shims that execFile cannot
      // run without a shell. Real native binaries (cppcheck, clang-tidy) pass
      // noShell so paths with spaces survive.
      shell: process.platform === "win32" && !noShell,
    });
    return { stdout, code: 0 };
  } catch (err: unknown) {
    // Many scanners exit non-zero when they find issues; their stdout is still
    // the report. Use it when present.
    const e = err as { stdout?: string; code?: number };
    return { stdout: e.stdout ?? "", code: e.code ?? 1 };
  }
}

async function hasCppSources(dir: string, depth = 1): Promise<boolean> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && /\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(entry.name)) return true;
    if (entry.isDirectory() && depth > 0 && !/^(build|out|bin|obj|third_party|vendor|\.git|node_modules)$/i.test(entry.name)) {
      if (await hasCppSources(path.join(dir, entry.name), depth - 1)) return true;
    }
  }
  return false;
}

export async function detectProject(root: string): Promise<ProjectInfo> {
  const exists = async (p: string) => {
    try {
      await fs.access(path.join(root, p));
      return true;
    } catch {
      return false;
    }
  };
  const [pkg, py, cargo, tf, docker, cmake, cpp] = await Promise.all([
    exists("package.json"),
    exists("requirements.txt"),
    exists("Cargo.toml"),
    Promise.all([exists("main.tf"), exists("terraform")]).then((r) => r.some(Boolean)),
    exists("Dockerfile"),
    exists("CMakeLists.txt"),
    hasCppSources(root, 1).then(async (found) => found || hasCppSources(path.join(root, "src"), 1)),
  ]);
  const compileCandidates = ["compile_commands.json", "build/compile_commands.json", "out/compile_commands.json", "cmake-build-debug/compile_commands.json"];
  let compileCommandsDir: string | null = null;
  for (const candidate of compileCandidates) {
    if (await exists(candidate)) {
      compileCommandsDir = path.dirname(path.join(root, candidate));
      break;
    }
  }
  const languages: string[] = [];
  if (pkg) languages.push("javascript", "typescript");
  if (py) languages.push("python");
  if (cargo) languages.push("rust");
  if (cpp) languages.push("c++");
  return {
    root,
    hasPackageJson: pkg,
    hasPython: py,
    hasCargo: cargo,
    hasTerraform: tf,
    hasDockerfile: docker,
    hasCpp: cpp,
    hasCMake: cmake,
    compileCommandsDir,
    languages,
  };
}

// --- npm audit (always available wherever npm is) -------------------------------

const npmAudit: Analyzer = {
  id: "sca.npm-audit",
  name: "npm audit",
  probe: null,
  applies: (i) => i.hasPackageJson,
  async run(info, opts) {
    const { stdout } = await runCommand("npm", ["audit", "--json"], info.root, opts.timeoutMs ?? 60000);
    if (!stdout.trim()) return { ran: false, findings: [], note: "npm audit produced no output" };
    let data: { vulnerabilities?: Record<string, { severity?: string; name?: string; range?: string; via?: Array<string | { title?: string; url?: string }>; fixAvailable?: unknown }> };
    try {
      data = JSON.parse(stdout);
    } catch {
      return { ran: false, findings: [], note: "could not parse npm audit output" };
    }
    const vulns = data.vulnerabilities ?? {};
    const findings: Finding[] = [];
    for (const [name, v] of Object.entries(vulns)) {
      const via = (v.via ?? []).filter((x) => typeof x === "object") as Array<{ title?: string; url?: string }>;
      findings.push({
        ruleId: "sca.vulnerable-dependency",
        category: "dependencies",
        severity: toSeverity(v.severity, "medium"),
        title: `Vulnerable dependency: ${name}`,
        detail: `${name}${v.range ? ` (${v.range})` : ""} has a known vulnerability: ${via.map((x) => x.title).filter(Boolean).slice(0, 2).join("; ") || v.severity}. ${v.fixAvailable ? "A fix is available." : "No automatic fix."}`,
        location: "package.json",
        evidence: via.slice(0, 2).map((x) => ({ label: x.title ?? name, value: x.url ?? "" })),
        fix: "Run npm audit fix, or upgrade the dependency to a patched version.",
      });
      if (findings.length >= (opts.maxPerTool ?? 40)) break;
    }
    return { ran: true, findings };
  },
};

// --- Semgrep (SAST) ------------------------------------------------------------

const semgrep: Analyzer = {
  id: "sast.semgrep",
  name: "Semgrep",
  probe: "semgrep",
  applies: () => true,
  async run(info, opts) {
    const { stdout } = await runCommand(
      "semgrep",
      ["--json", "--quiet", "--config=auto", "--max-target-bytes=1000000", "."],
      info.root,
      opts.timeoutMs ?? 180000,
    );
    let data: { results?: Array<{ check_id: string; path: string; start?: { line?: number }; extra?: { message?: string; severity?: string; metadata?: { category?: string } } }> };
    try {
      data = JSON.parse(stdout);
    } catch {
      return { ran: false, findings: [], note: "could not parse semgrep output" };
    }
    const findings: Finding[] = [];
    for (const r of data.results ?? []) {
      findings.push({
        ruleId: "sast.finding",
        category: "security",
        severity: toSeverity(r.extra?.severity, "medium"),
        title: r.check_id.split(".").slice(-2).join(".") || r.check_id,
        detail: (r.extra?.message ?? "Semgrep finding").slice(0, 400),
        location: `${r.path}:${r.start?.line ?? 0}`,
        evidence: [{ label: r.path, file: r.path, line: r.start?.line }],
        fix: "Review the finding and apply the rule's remediation.",
      });
      if (findings.length >= (opts.maxPerTool ?? 40)) break;
    }
    return { ran: true, findings };
  },
};

// --- OSV-Scanner (SCA across ecosystems) ---------------------------------------

const osvScanner: Analyzer = {
  id: "sca.osv",
  name: "OSV-Scanner",
  probe: "osv-scanner",
  applies: (i) => i.hasPackageJson || i.hasPython || i.hasCargo,
  async run(info, opts) {
    const { stdout } = await runCommand(
      "osv-scanner",
      ["--format", "json", "-r", "."],
      info.root,
      opts.timeoutMs ?? 120000,
    );
    let data: { results?: Array<{ source?: { path?: string }; packages?: Array<{ package?: { name?: string; version?: string }; vulnerabilities?: Array<{ id?: string; summary?: string; severity?: Array<{ score?: string }> }> }> }> };
    try {
      data = JSON.parse(stdout);
    } catch {
      return { ran: false, findings: [], note: "could not parse osv-scanner output" };
    }
    const findings: Finding[] = [];
    for (const r of data.results ?? []) {
      for (const p of r.packages ?? []) {
        for (const v of p.vulnerabilities ?? []) {
          findings.push({
            ruleId: "sca.vulnerable-dependency",
            category: "dependencies",
            severity: "high",
            title: `Vulnerable dependency: ${p.package?.name ?? "?"}`,
            detail: `${p.package?.name ?? "?"}@${p.package?.version ?? "?"} is affected by ${v.id ?? "a known vulnerability"}: ${(v.summary ?? "").slice(0, 200)}`,
            location: r.source?.path ?? "manifest",
            evidence: [{ label: v.id ?? "advisory", file: r.source?.path }],
            fix: "Upgrade to a fixed version; see the advisory.",
          });
          if (findings.length >= (opts.maxPerTool ?? 40)) break;
        }
      }
    }
    return { ran: true, findings };
  },
};

// --- Trivy (vulns + misconfig + secrets) ---------------------------------------

const trivy: Analyzer = {
  id: "sca.trivy",
  name: "Trivy",
  probe: "trivy",
  applies: () => true,
  async run(info, opts) {
    const { stdout } = await runCommand(
      "trivy",
      ["fs", "--format", "json", "--quiet", "--scanners", "vuln,misconfig,secret", "."],
      info.root,
      opts.timeoutMs ?? 180000,
    );
    let data: { Results?: Array<{ Target?: string; Vulnerabilities?: Array<{ VulnerabilityID?: string; PkgName?: string; Severity?: string; Title?: string }>; Misconfigurations?: Array<{ ID?: string; Title?: string; Severity?: string; Message?: string; CauseMetadata?: { StartLine?: number } }>; Secrets?: Array<{ RuleID?: string; Title?: string; StartLine?: number }> }> };
    try {
      data = JSON.parse(stdout);
    } catch {
      return { ran: false, findings: [], note: "could not parse trivy output" };
    }
    const findings: Finding[] = [];
    for (const r of data.Results ?? []) {
      for (const v of r.Vulnerabilities ?? []) {
        findings.push({
          ruleId: "sca.vulnerable-dependency",
          category: "dependencies",
          severity: toSeverity(v.Severity, "medium"),
          title: `${v.PkgName ?? "dependency"}: ${v.VulnerabilityID ?? "vulnerability"}`,
          detail: `${v.PkgName ?? "?"} has ${v.VulnerabilityID ?? "a known vulnerability"}. ${v.Title ?? ""}`.slice(0, 300),
          location: r.Target ?? "lockfile",
          evidence: [{ label: v.VulnerabilityID ?? "CVE", file: r.Target }],
          fix: "Upgrade the package to a patched version.",
        });
      }
      for (const m of r.Misconfigurations ?? []) {
        findings.push({
          ruleId: "iac.misconfiguration",
          category: "security",
          severity: toSeverity(m.Severity, "medium"),
          title: m.Title ?? m.ID ?? "IaC misconfiguration",
          detail: (m.Message ?? "").slice(0, 300),
          location: `${r.Target ?? "config"}:${m.CauseMetadata?.StartLine ?? 0}`,
          evidence: [{ label: m.ID ?? "misconfig", file: r.Target, line: m.CauseMetadata?.StartLine }],
          fix: "Apply the check's remediation to the configuration.",
        });
      }
      for (const s of r.Secrets ?? []) {
        findings.push({
          ruleId: "secrets.finding",
          category: "security",
          severity: "critical",
          title: `Secret: ${s.Title ?? s.RuleID ?? "leaked credential"}`,
          detail: `A secret was found in ${r.Target ?? "a file"}. Treat it as compromised.`,
          location: `${r.Target ?? "file"}:${s.StartLine ?? 0}`,
          evidence: [{ label: s.RuleID ?? "secret", file: r.Target, line: s.StartLine }],
          fix: "Rotate the credential and load it from the environment.",
        });
      }
      if (findings.length >= (opts.maxPerTool ?? 40)) break;
    }
    return { ran: true, findings: findings.slice(0, opts.maxPerTool ?? 40) };
  },
};

// --- gitleaks (secret scanning) ------------------------------------------------

const gitleaks: Analyzer = {
  id: "secrets.gitleaks",
  name: "gitleaks",
  probe: "gitleaks",
  applies: () => true,
  async run(info, opts) {
    const { stdout } = await runCommand(
      "gitleaks",
      ["detect", "--no-git", "--no-banner", "-f", "json", "-r", "-"],
      info.root,
      opts.timeoutMs ?? 120000,
    );
    let data: Array<{ RuleID?: string; File?: string; StartLine?: number; Description?: string }>;
    try {
      data = JSON.parse(stdout || "[]");
    } catch {
      return { ran: false, findings: [], note: "could not parse gitleaks output" };
    }
    const findings: Finding[] = (data ?? []).slice(0, opts.maxPerTool ?? 40).map((l) => ({
      ruleId: "secrets.finding",
      category: "security" as const,
      severity: "critical" as Severity,
      title: `Secret: ${l.Description ?? l.RuleID ?? "leaked credential"}`,
      detail: `gitleaks matched ${l.RuleID ?? "a secret rule"} at ${l.File ?? "a file"}:${l.StartLine ?? 0}. If this is real it is compromised the moment it was committed.`,
      location: `${l.File ?? "file"}:${l.StartLine ?? 0}`,
      evidence: [{ label: l.RuleID ?? "secret", file: l.File, line: l.StartLine }],
      fix: "Rotate the credential, purge it from history, and load it at runtime.",
    }));
    return { ran: true, findings };
  },
};

// --- checkov (IaC) -------------------------------------------------------------

const checkov: Analyzer = {
  id: "iac.checkov",
  name: "checkov",
  probe: "checkov",
  applies: (i) => i.hasTerraform || i.hasDockerfile,
  async run(info, opts) {
    const { stdout } = await runCommand(
      "checkov",
      ["-d", ".", "-o", "json", "--quiet", "--compact"],
      info.root,
      opts.timeoutMs ?? 180000,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { ran: false, findings: [], note: "could not parse checkov output" };
    }
    const blocks = Array.isArray(parsed) ? parsed : [parsed];
    const findings: Finding[] = [];
    for (const b of blocks as Array<{ results?: { failed_checks?: Array<{ check_id?: string; check?: { name?: string }; file_path?: string; file_line_range?: number[]; guideline?: string }> } }>) {
      for (const c of b.results?.failed_checks ?? []) {
        const line = c.file_line_range?.[0] ?? 0;
        findings.push({
          ruleId: "iac.misconfiguration",
          category: "security",
          severity: "medium",
          title: c.check?.name ?? c.check_id ?? "IaC misconfiguration",
          detail: (c.check?.name ?? "").slice(0, 200) + (c.guideline ? ` (${c.guideline})` : ""),
          location: `${(c.file_path ?? "config").replace(/^\//, "")}:${line}`,
          evidence: [{ label: c.check_id ?? "check", file: c.file_path, line }],
          fix: "Apply the check's remediation.",
        });
        if (findings.length >= (opts.maxPerTool ?? 40)) break;
      }
    }
    return { ran: true, findings };
  },
};

// --- bandit (Python SAST) ------------------------------------------------------

const bandit: Analyzer = {
  id: "sast.bandit",
  name: "bandit",
  probe: "bandit",
  applies: (i) => i.hasPython,
  async run(info, opts) {
    const { stdout } = await runCommand("bandit", ["-r", ".", "-f", "json", "-q"], info.root, opts.timeoutMs ?? 120000);
    let data: { results?: Array<{ test_id?: string; test_name?: string; issue_text?: string; filename?: string; line_number?: number; issue_severity?: string }> };
    try {
      data = JSON.parse(stdout);
    } catch {
      return { ran: false, findings: [], note: "could not parse bandit output" };
    }
    const findings: Finding[] = (data.results ?? []).slice(0, opts.maxPerTool ?? 40).map((r) => ({
      ruleId: "sast.finding",
      category: "security" as const,
      severity: toSeverity(r.issue_severity, "medium"),
      title: r.test_name ?? r.test_id ?? "bandit finding",
      detail: (r.issue_text ?? "").slice(0, 300),
      location: `${r.filename ?? "file"}:${r.line_number ?? 0}`,
      evidence: [{ label: r.test_id ?? "bandit", file: r.filename, line: r.line_number }],
      fix: "Review the finding and remediate.",
    }));
    return { ran: true, findings };
  },
};

// --- pip-audit (Python SCA) ----------------------------------------------------

const pipAudit: Analyzer = {
  id: "sca.pip-audit",
  name: "pip-audit",
  probe: "pip-audit",
  applies: (i) => i.hasPython,
  async run(info, opts) {
    const { stdout } = await runCommand("pip-audit", ["-f", "json", "-q"], info.root, opts.timeoutMs ?? 120000);
    let data: { dependencies?: Array<{ name?: string; version?: string; vulns?: Array<{ id?: string; description?: string; fix_versions?: string[] }> }> };
    try {
      data = JSON.parse(stdout);
    } catch {
      return { ran: false, findings: [], note: "could not parse pip-audit output" };
    }
    const findings: Finding[] = [];
    for (const dep of data.dependencies ?? []) {
      for (const v of dep.vulns ?? []) {
        findings.push({
          ruleId: "sca.vulnerable-dependency",
          category: "dependencies",
          severity: "high",
          title: `Vulnerable dependency: ${dep.name ?? "?"}`,
          detail: `${dep.name ?? "?"}@${dep.version ?? "?"} is affected by ${v.id ?? "a known vulnerability"}.${v.fix_versions?.length ? ` Fix: ${v.fix_versions.join(", ")}` : ""}`,
          location: "requirements.txt",
          evidence: [{ label: v.id ?? "advisory", file: "requirements.txt" }],
          fix: "Upgrade to a fixed version.",
        });
        if (findings.length >= (opts.maxPerTool ?? 40)) break;
      }
    }
    return { ran: true, findings };
  },
};

// --- cppcheck (C/C++ static analysis) -----------------------------------------

interface CppcheckError {
  file?: string;
  line?: number;
  column?: number;
  severity?: string;
  message?: string;
  id?: string;
}

export function parseCppcheck(stdout: string, root: string): Finding[] {
  let data: { errors?: CppcheckError[] };
  try {
    data = JSON.parse(stdout);
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  for (const e of data.errors ?? []) {
    if (!e.message || !e.file) continue;
    const severity =
      e.severity === "error" ? "high" : e.severity === "warning" ? "medium" : "low";
    const rel = path.relative(root, e.file).split(path.sep).join("/");
    findings.push({
      ruleId: "sast.cppcheck",
      category: "code",
      severity,
      title: `cppcheck: ${e.id ?? "finding"}`,
      detail: e.message.slice(0, 400),
      location: `${rel}:${e.line ?? 0}`,
      evidence: [{ label: e.id ?? "cppcheck", file: rel, line: e.line }],
      fix: "Fix the defect cppcheck identified; if it is a false positive, suppress it inline with a written reason.",
    });
  }
  return findings;
}

const cppcheck: Analyzer = {
  id: "sast.cppcheck",
  name: "cppcheck",
  probe: "cppcheck",
  applies: (i) => i.hasCpp,
  async run(info, opts) {
    const { stdout } = await runCommand(
      "cppcheck",
      [
        "--enable=warning,performance,portability",
        "--std=c++20",
        "--output-format=json",
        "--quiet",
        "--suppress=missingIncludeSystem",
        "--suppress=unusedFunction",
        ".",
      ],
      info.root,
      opts.timeoutMs ?? 180000,
      true,
    );
    if (!stdout.trim()) return { ran: false, findings: [], note: "cppcheck produced no output" };
    const findings = parseCppcheck(stdout, info.root);
    return { ran: true, findings: findings.slice(0, opts.maxPerTool ?? 40) };
  },
};

// --- clang-tidy (C/C++ static analysis via compile_commands.json) -------------

interface ClangTidyMatch {
  file: string;
  line: number;
  column: number;
  severity: string;
  message: string;
  check: string;
}

export function parseClangTidy(stdout: string): ClangTidyMatch[] {
  const re = /^(.+?):(\d+):(\d+): (warning|error|note): (.+?) \[([^\]]+)\]$/gm;
  const out: ClangTidyMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stdout)) !== null) {
    if (m[4] === "note") continue;
    out.push({
      file: m[1]!,
      line: Number(m[2]),
      column: Number(m[3]),
      severity: m[4]!,
      message: m[5]!,
      check: m[6]!,
    });
  }
  return out;
}

const clangTidy: Analyzer = {
  id: "sast.clang-tidy",
  name: "clang-tidy",
  probe: "clang-tidy",
  applies: (i) => i.hasCpp && !!i.compileCommandsDir,
  async run(info, opts) {
    const dir = info.compileCommandsDir!;
    let entries: Array<{ file?: string }>;
    try {
      entries = JSON.parse(await fs.readFile(path.join(dir, "compile_commands.json"), "utf8"));
    } catch {
      return { ran: false, findings: [], note: "could not read compile_commands.json" };
    }
    const files = [...new Set(entries.map((e) => e.file).filter((f): f is string => !!f))].slice(0, 20);
    if (files.length === 0) return { ran: false, findings: [], note: "compile_commands.json has no files" };
    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const file of files) {
      const { stdout } = await runCommand(
        "clang-tidy",
        ["-p", dir, "--quiet", file],
        info.root,
        Math.max(30000, Math.floor((opts.timeoutMs ?? 180000) / files.length)),
        true,
      );
      for (const m of parseClangTidy(stdout)) {
        const key = `${m.file}:${m.line}:${m.check}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rel = path.relative(info.root, m.file).split(path.sep).join("/");
        findings.push({
          ruleId: "sast.clang-tidy",
          category: "code",
          severity: m.severity === "error" ? "high" : "medium",
          title: `clang-tidy: ${m.check}`,
          detail: m.message.slice(0, 400),
          location: `${rel}:${m.line}`,
          evidence: [{ label: m.check, file: rel, line: m.line }],
          fix: "Resolve the diagnostic, or add a narrowly scoped NOLINT with a written reason.",
        });
        if (findings.length >= (opts.maxPerTool ?? 40)) break;
      }
      if (findings.length >= (opts.maxPerTool ?? 40)) break;
    }
    return { ran: true, findings };
  },
};

export const ANALYZERS: Analyzer[] = [
  npmAudit,
  semgrep,
  osvScanner,
  trivy,
  gitleaks,
  checkov,
  bandit,
  pipAudit,
  cppcheck,
  clangTidy,
];

export interface AnalyzerRun {
  id: string;
  name: string;
  ran: boolean;
  findings: number;
  note?: string;
}

export async function runAnalyzers(
  info: ProjectInfo,
  opts: RunOptions = {},
): Promise<{ findings: Finding[]; runs: AnalyzerRun[] }> {
  const findings: Finding[] = [];
  const runs: AnalyzerRun[] = [];
  const disabled = new Set(opts.disabled ?? []);
  for (const a of ANALYZERS) {
    if (disabled.has(a.id)) continue;
    if (!a.applies(info)) continue;
    if (a.probe && !(await resolveExecutable(a.probe))) {
      runs.push({ id: a.id, name: a.name, ran: false, findings: 0, note: `${a.probe} not installed` });
      continue;
    }
    try {
      const res = await a.run(info, opts);
      findings.push(...res.findings);
      runs.push({ id: a.id, name: a.name, ran: res.ran, findings: res.findings.length, note: res.note });
    } catch (err) {
      runs.push({
        id: a.id,
        name: a.name,
        ran: false,
        findings: 0,
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { findings, runs };
}

export function analyzerInstallHint(): string {
  return [
    "Install analyzers to widen coverage (all free):",
    "  semgrep:      pip install semgrep",
    "  osv-scanner:  https://github.com/google/osv-scanner",
    "  trivy:        https://aquasecurity.github.io/trivy",
    "  gitleaks:     https://github.com/gitleaks/gitleaks",
    "  checkov:      pip install checkov",
    "  bandit:       pip install bandit",
    "  pip-audit:    pip install pip-audit",
    "  cppcheck:     winget install cppcheck (or apt install cppcheck)",
    "  clang-tidy:   install LLVM; needs build/compile_commands.json",
  ].join("\n");
}
