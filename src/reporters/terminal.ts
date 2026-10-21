import type { AuditReport } from "../core/report.js";
import type { Severity } from "../core/types.js";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: ANSI.magenta,
  high: ANSI.red,
  medium: ANSI.yellow,
  low: ANSI.cyan,
  info: ANSI.gray,
};

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

function gradeColor(grade: string): string {
  const letter = grade[0];
  if (letter === "A") return ANSI.green;
  if (letter === "B") return ANSI.green;
  if (letter === "C") return ANSI.yellow;
  if (letter === "D") return ANSI.yellow;
  return ANSI.red;
}

function bar(score: number, width = 20, useColor = true): string {
  const filled = Math.round((score / 100) * width);
  if (!useColor) return `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
  const color = score >= 80 ? ANSI.green : score >= 60 ? ANSI.yellow : ANSI.red;
  return `${color}${"#".repeat(filled)}${ANSI.gray}${"-".repeat(width - filled)}${ANSI.reset}`;
}

export interface TerminalOptions {
  useColor?: boolean;
  verbose?: boolean;
}

export function renderTerminal(report: AuditReport, options: TerminalOptions = {}): string {
  const color = options.useColor ?? true;
  const c = (code: string, s: string) => (color ? `${code}${s}${ANSI.reset}` : s);
  const lines: string[] = [];

  const { deterministic: d, target } = report;
  lines.push("");
  lines.push(c(ANSI.bold, "SLOP AUDIT"));
  lines.push(c(ANSI.dim, `target   ${target.kind}: ${target.ref}`));
  lines.push(c(ANSI.dim, `profile  ${report.profile}   time ${(report.durationMs / 1000).toFixed(1)}s`));
  lines.push("");

  const gradeColorCode = gradeColor(d.grade);
  lines.push(
    `  ${c(ANSI.bold, "QUALITY SCORE")}   ${c(gradeColorCode + ANSI.bold, d.grade.padEnd(3))} ${c(
      ANSI.bold,
      `${d.score.toFixed(1)}/100`,
    )}   ${c(ANSI.dim, `${d.slopPoints.toFixed(1)} slop points`)}`,
  );
  lines.push(`  ${bar(d.score, 20, color)}`);
  const counts = SEVERITY_ORDER.filter((s) => d.counts[s] > 0)
    .map((s) => c(SEVERITY_COLOR[s], `${d.counts[s]} ${s}`))
    .join("  ");
  lines.push(`  ${d.totalFindings} findings   ${counts}`);
  lines.push("");

  const smoke = report.metadata.smoke as
    | {
        ran?: boolean;
        windowFound?: boolean;
        crashAt?: string | null;
        respondingAtEnd?: boolean | null;
        resized?: Array<{ width: number; height: number; alive: boolean; responding: boolean }>;
      }
    | undefined;
  if (smoke?.ran) {
    const sizes = (smoke.resized ?? []).map((r) => `${r.width}x${r.height}`).join(", ");
    const status = smoke.crashAt
      ? `crashed at ${smoke.crashAt}`
      : smoke.windowFound
        ? `window opened; resized ${sizes}; ${smoke.respondingAtEnd === false ? "unresponsive" : "still responding"}`
        : "no top-level window";
    lines.push(c(ANSI.dim, `  runtime smoke  ${status}`));
    lines.push("");
  }

  lines.push(c(ANSI.bold, "  BY CATEGORY"));
  for (const cat of d.categories) {
    const label = cat.category.padEnd(14);
    const score = `${cat.score.toFixed(1)}`.padStart(5);
    const suffix = cat.findings > 0 ? c(ANSI.dim, `  ${cat.findings} finding${cat.findings === 1 ? "" : "s"}`) : "";
    lines.push(`    ${label} ${bar(cat.score, 12, color)} ${score}${suffix}`);
  }
  lines.push("");

  const sevLabel = (s: Severity) => c(SEVERITY_COLOR[s] + ANSI.bold, s.toUpperCase().padEnd(8));
  if (d.topFindings.length > 0) {
    lines.push(c(ANSI.bold, "  PRIORITY FIXES") + c(ANSI.dim, "  (highest cost first)"));
    for (const f of d.topFindings) {
      const conf = f.confidence !== undefined && f.confidence < 1 ? c(ANSI.dim, ` (confidence ${f.confidence.toFixed(2)})`) : "";
      const pts = f.effectivePenalty > 0 ? c(ANSI.dim, `  ${f.effectivePenalty.toFixed(1)} pts`) : "";
      lines.push(`    ${sevLabel(f.severity)} ${c(ANSI.bold, f.title)}${conf}${pts}`);
      if (f.location) lines.push(c(ANSI.dim, `             at ${f.location}`));
      const detail = options.verbose ? f.detail : f.detail.split(/(?<=\.)\s/)[0]!;
      lines.push(`             ${detail}`);
      if (f.evidence) {
        for (const e of f.evidence.slice(0, 3)) {
          const loc = e.line ? `${e.label}:${e.line}` : e.label;
          lines.push(c(ANSI.dim, `               - ${loc}${e.value ? ` = ${e.value}` : ""}`));
        }
      }
      if (options.verbose && f.fix) lines.push(c(ANSI.green, `             fix: ${f.fix}`));
      lines.push("");
    }
    if (!options.verbose && report.findings.length > d.topFindings.length) {
      lines.push(c(ANSI.dim, `  (${report.findings.length - d.topFindings.length} more findings; run with --verbose for the full breakdown)`));
      lines.push("");
    }
  } else {
    lines.push(c(ANSI.green, "  No deterministic findings. Clean."));
    lines.push("");
  }

  if (options.verbose && d.topFindings.length > 0) {
    lines.push(c(ANSI.bold, "  FULL BREAKDOWN BY CATEGORY"));
    const sevRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    for (const cat of d.categories) {
      const list = report.findings
        .filter((f) => f.category === cat.category)
        .sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
      if (list.length === 0) continue;
      lines.push(`    ${c(ANSI.bold, cat.category)} ${c(ANSI.dim, `(${list.length}, ${cat.penalty.toFixed(1)} pts)`)}`);
      for (const f of list) {
        lines.push(`      ${c(SEVERITY_COLOR[f.severity], f.severity.padEnd(8))} ${f.title}`);
        if (f.fix) lines.push(c(ANSI.dim, `               fix: ${f.fix}`));
      }
      lines.push("");
    }
  }

  if (report.llm) {
    lines.push(c(ANSI.bold, "  LLM REVIEW (non-authoritative)"));
    if (!report.llm.enabled) {
      lines.push(c(ANSI.dim, "    disabled"));
    } else if (report.llm.error) {
      lines.push(c(ANSI.red, `    failed: ${report.llm.error}`));
    } else {
      lines.push(`    model ${report.llm.model}   ${c(gradeColor(report.llm.grade ?? "F"), report.llm.grade ?? "?")} ${report.llm.score ?? "?"}/100`);
      if (report.llm.summary) lines.push(`    ${report.llm.summary}`);
      for (const f of report.llm.findings.slice(0, 8)) {
        lines.push(`    ${c(SEVERITY_COLOR[f.severity] ?? ANSI.gray, `[${f.severity}]`)} ${f.title}`);
        lines.push(c(ANSI.dim, `      ${f.detail}`));
      }
    }
    lines.push("");
  }

  if (report.warnings.length > 0) {
    lines.push(c(ANSI.bold, "  WARNINGS"));
    for (const w of report.warnings) lines.push(c(ANSI.yellow, `    - ${w}`));
    lines.push("");
  }

  return lines.join("\n");
}
