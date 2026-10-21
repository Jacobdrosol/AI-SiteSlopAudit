import type { AuditReport } from "../core/report.js";
import type { Finding, Severity } from "../core/types.js";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

const STYLES = `
:root {
  --color-bg: #f6f5f2;
  --color-surface: #ffffff;
  --color-ink: #1a1a18;
  --color-ink-muted: #5c5b57;
  --color-rule: #d9d7d0;
  --color-accent: #1f5f4b;
  --color-accent-ink: #ffffff;
  --severity-critical: #8a1c4b;
  --severity-high: #b3341f;
  --severity-medium: #9a6a00;
  --severity-low: #2a6178;
  --severity-info: #6b6a66;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px;
  --radius: 6px;
  --font-sans: "IBM Plex Sans", "Segoe UI", "Helvetica Neue", sans-serif;
  --font-mono: "IBM Plex Mono", "Cascadia Mono", ui-monospace, monospace;
  --step-1: 0.8125rem; --step0: 0.9375rem; --step1: 1.125rem; --step2: 1.5rem; --step3: 2rem; --step4: 2.75rem;
}
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #16161a;
    --color-surface: #1e1e23;
    --color-ink: #eceae4;
    --color-ink-muted: #a3a19b;
    --color-rule: #34343a;
    --color-accent: #5fb79b;
    --color-accent-ink: #10231d;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--color-bg); color: var(--color-ink); font-family: var(--font-sans); font-size: var(--step0); line-height: 1.55; }
.wrap { max-width: 60rem; margin: 0 auto; padding: var(--s7) var(--s5); }
h1 { font-size: var(--step4); line-height: 1.1; margin: 0 0 var(--s2); letter-spacing: -0.02em; }
h2 { font-size: var(--step2); margin: var(--s7) 0 var(--s4); letter-spacing: -0.01em; }
h3 { font-size: var(--step1); }
.target { color: var(--color-ink-muted); font-family: var(--font-mono); font-size: var(--step-1); word-break: break-all; }
.scorebar { display: flex; align-items: baseline; gap: var(--s5); margin: var(--s5) 0; padding: var(--s5); background: var(--color-surface); border: 1px solid var(--color-rule); border-radius: var(--radius); }
.grade { font-size: var(--step4); font-weight: 600; }
.gradelabel { text-transform: uppercase; letter-spacing: 0.08em; font-size: var(--step-1); color: var(--color-ink-muted); }
.numeric { font-family: var(--font-mono); font-size: var(--step1); color: var(--color-ink-muted); }
.track { flex: 1; height: var(--s2); background: var(--color-rule); border-radius: var(--radius); overflow: hidden; min-width: 8rem; }
.fill { height: 100%; background: var(--color-accent); }
.counts { display: flex; gap: var(--s4); margin: 0; flex-wrap: wrap; }
.counts div { font-family: var(--font-mono); font-size: var(--step-1); }
table { width: 100%; border-collapse: collapse; background: var(--color-surface); border: 1px solid var(--color-rule); border-radius: var(--radius); overflow: hidden; }
th, td { text-align: left; padding: var(--s2) var(--s4); border-bottom: 1px solid var(--color-rule); font-size: var(--step-1); }
th { color: var(--color-ink-muted); font-weight: 600; }
tr:last-child td { border-bottom: 0; }
td.num { font-family: var(--font-mono); text-align: right; }
.finding { background: var(--color-surface); border: 1px solid var(--color-rule); border-left-width: 4px; border-radius: var(--radius); padding: var(--s4) var(--s5); margin-bottom: var(--s3); }
.finding.critical { border-left-color: var(--severity-critical); }
.finding.high { border-left-color: var(--severity-high); }
.finding.medium { border-left-color: var(--severity-medium); }
.finding.low { border-left-color: var(--severity-low); }
.finding.info { border-left-color: var(--severity-info); }
.sev { font-family: var(--font-mono); font-size: var(--step-1); font-weight: 600; text-transform: uppercase; }
.sev.critical { color: var(--severity-critical); }
.sev.high { color: var(--severity-high); }
.sev.medium { color: var(--severity-medium); }
.sev.low { color: var(--severity-low); }
.sev.info { color: var(--severity-info); }
.points { font-family: var(--font-mono); font-size: var(--step-1); color: var(--color-ink-muted); float: right; }
.finding h3 { margin: var(--s1) 0 var(--s2); }
.finding p { margin: 0 0 var(--s2); max-width: 70ch; }
.ev { font-family: var(--font-mono); font-size: var(--step-1); color: var(--color-ink-muted); margin: 0; padding: 0; list-style: none; }
.fix { margin: var(--s2) 0 0; padding-left: var(--s3); border-left: 2px solid var(--color-accent); color: var(--color-ink-muted); font-size: var(--step-1); }
.llm { border: 1px dashed var(--color-rule); border-radius: var(--radius); padding: var(--s5); }
.warn { color: var(--severity-medium); font-size: var(--step-1); }
.muted { color: var(--color-ink-muted); }
.catblock { margin-bottom: var(--s6); }
.shot { margin: 0 0 var(--s5); border: 1px solid var(--color-rule); border-radius: var(--radius); overflow: hidden; background: var(--color-surface); }
.shot img { display: block; width: 100%; height: auto; }
.shot figcaption { padding: var(--s2) var(--s4); font-family: var(--font-mono); font-size: var(--step-1); color: var(--color-ink-muted); border-top: 1px solid var(--color-rule); }
.shot .warn { padding: 0 var(--s4) var(--s3); margin: 0; }.cathead { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s4); margin: 0 0 var(--s3); }
.cathead h3 { margin: 0; }
.bar { display: inline-block; height: var(--s2); width: 8rem; background: var(--color-rule); border-radius: var(--radius); overflow: hidden; vertical-align: middle; }
.bar > span { display: block; height: 100%; background: var(--color-accent); }
details { background: var(--color-surface); border: 1px solid var(--color-rule); border-radius: var(--radius); padding: var(--s3) var(--s4); margin-bottom: var(--s2); }
summary { cursor: pointer; font-family: var(--font-mono); font-size: var(--step-1); }
.checkgrid td { font-size: var(--step-1); }
footer { margin-top: var(--s7); padding-top: var(--s4); border-top: 1px solid var(--color-rule); color: var(--color-ink-muted); font-size: var(--step-1); }

@media print {
  :root {
    --color-bg: #ffffff;
    --color-surface: #ffffff;
    --color-ink: #111111;
    --color-ink-muted: #555555;
    --color-rule: #cccccc;
    --color-accent: #1f5f4b;
  }
  body { font-size: 11pt; }
  .wrap { max-width: none; padding: 0; }
  h1 { font-size: 22pt; }
  h2 { font-size: 15pt; page-break-after: avoid; break-after: avoid; }
  .finding, .catblock, .shot, table, details { page-break-inside: avoid; break-inside: avoid; }
  .finding { border-left-width: 3px; }
  .shot img { max-height: 90vh; object-fit: contain; }
  details { border: 0; padding: 0; }
  details > summary { list-style: none; }
  details:not([open]) > *:not(summary) { display: block !important; }
  a { color: inherit; text-decoration: none; }
  .sev { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

interface CardFinding {
  severity: Severity;
  title: string;
  detail: string;
  location?: string;
  fix?: string;
  confidence?: number;
  points?: number;
  evidence?: Array<{
    label: string;
    value?: string;
    selector?: string;
    file?: string;
    line?: number;
  }>;
}

function findingCard(f: CardFinding): string {
  const ev = (f.evidence ?? [])
    .slice(0, 8)
    .map((e) => {
      const loc = e.line ? `${e.label}:${e.line}` : e.label;
      return `<li>${esc(loc)}${e.value ? ` = ${esc(e.value)}` : ""}</li>`;
    })
    .join("");
  const conf =
    f.confidence !== undefined && f.confidence < 1
      ? ` <span class="muted">(confidence ${f.confidence.toFixed(2)})</span>`
      : "";
  const pts =
    f.points !== undefined && f.points > 0
      ? `<span class="points">${f.points.toFixed(1)} pts</span>`
      : "";
  return `<article class="finding ${esc(f.severity)}">
    <span class="sev ${esc(f.severity)}">${esc(f.severity)}</span>${pts}
    <h3>${esc(f.title)}${conf}</h3>
    ${f.location ? `<p class="ev">at ${esc(f.location)}</p>` : ""}
    <p>${esc(f.detail)}</p>
    ${ev ? `<ul class="ev">${ev}</ul>` : ""}
    ${f.fix ? `<p class="fix">Fix: ${esc(f.fix)}</p>` : ""}
  </article>`;
}

export function renderHtml(report: AuditReport): string {
  const d = report.deterministic;
  const sevRank: Record<Severity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };

  // Per-rule points, so each individual finding can show what it cost.
  const rulePoints = new Map<string, number>();
  for (const c of d.categories) {
    for (const r of c.rules) rulePoints.set(r.ruleId, r.effectivePenalty);
  }

  const categoryRows = d.categories
    .map(
      (c) =>
        `<tr><td>${esc(c.category)}</td><td class="num">${c.score.toFixed(1)}</td><td class="num">${c.penalty.toFixed(1)}</td><td class="num">${c.findings}</td></tr>`,
    )
    .join("");

  const counts = SEVERITY_ORDER.map(
    (s) => `<div>${d.counts[s]} <span class="muted">${s}</span></div>`,
  ).join("");

  // Priority fixes: the findings that cost the most points.
  const priorities = d.topFindings.map((f) =>
    findingCard({
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      location: f.location,
      fix: f.fix,
      confidence: f.confidence,
      points: f.effectivePenalty,
      evidence: f.evidence,
    }),
  );

  // Full breakdown: every finding, grouped by category, worst category first.
  const byCategory = new Map<string, Finding[]>();
  for (const f of report.findings) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }
  const categoryBlocks = d.categories
    .filter((c) => (byCategory.get(c.category) ?? []).length > 0)
    .map((c) => {
      const list = (byCategory.get(c.category) ?? []).sort(
        (a, b) => sevRank[a.severity] - sevRank[b.severity],
      );
      const cards = list
        .map((f) =>
          findingCard({
            severity: f.severity,
            title: f.title,
            detail: f.detail,
            location: f.location,
            fix: f.fix,
            confidence: f.confidence,
            points: rulePoints.get(f.ruleId),
            evidence: f.evidence,
          }),
        )
        .join("");
      return `<div class="catblock">
        <div class="cathead">
          <h3>${esc(c.category)} <span class="muted">(${list.length} finding${list.length === 1 ? "" : "s"})</span></h3>
          <span class="numeric">${c.score.toFixed(1)} <span class="bar"><span style="width:${Math.max(0, Math.min(100, c.score))}%"></span></span></span>
        </div>
        ${cards}
      </div>`;
    })
    .join("");

  // Check coverage: which checks ran, and what each found.
  const coverageRows = report.checks
    .slice()
    .sort(
      (a, b) => a.category.localeCompare(b.category) || a.checkId.localeCompare(b.checkId),
    )
    .map(
      (c) =>
        `<tr><td>${esc(c.checkId)}</td><td>${esc(c.category)}</td><td class="num">${c.findings}</td><td>${c.ok ? (c.error ? `<span class="warn">${esc(c.error)}</span>` : "ok") : `<span class="warn">${esc(c.error ?? "failed")}</span>`}</td></tr>`,
    )
    .join("");

  // Screenshots, when the run saved them (`--screenshots`).
  const captures = (report.metadata.captures as
    | Array<{ width: number; screenshot: string | null; overflowAmount: number; clipped: boolean }>
    | undefined) ?? [];
  const screenshots = captures
    .filter((c) => c.screenshot)
    .map((c) => {
      const file = c.screenshot!.replace(/\\/g, "/").split("/").pop()!;
      const flag = c.overflowAmount > 1
        ? `<p class="warn">${c.overflowAmount}px of horizontal overflow${c.clipped ? ", hidden and clipping content" : ""}</p>`
        : "";
      return `<figure class="shot">
        <img src="screenshots/${esc(file)}" alt="Full page render at ${c.width}px wide" loading="lazy">
        <figcaption>${c.width}px viewport</figcaption>
        ${flag}
      </figure>`;
    })
    .join("");

  const smoke = report.metadata.smoke as
    | {
        ran?: boolean;
        windowFound?: boolean;
        crashAt?: string | null;
        respondingAtEnd?: boolean | null;
        resized?: Array<{ width: number; height: number; alive: boolean; responding: boolean }>;
      }
    | undefined;
  const smokeBlock = smoke?.ran
    ? `<h2>Runtime smoke</h2>
      <p class="muted">Launched the built binary and resized it through ${smoke.resized?.length ?? 0} sizes.</p>
      <p class="${smoke.crashAt || smoke.respondingAtEnd === false ? "warn" : "muted"}">${
        smoke.crashAt
          ? `Crashed at ${esc(smoke.crashAt)}.`
          : smoke.windowFound
            ? `Window opened; ${smoke.respondingAtEnd === false ? "stopped responding during resize" : "still responding at the end"}.`
            : "No top-level window appeared."
      }</p>
      <p class="muted">${(smoke.resized ?? []).map((r) => `${r.width}x${r.height} ${r.alive ? (r.responding ? "ok" : "unresponsive") : "crashed"}`).map(esc).join(" &middot; ")}</p>`
    : "";

  const llm = report.llm
    ? `<h2>LLM review (non-authoritative)</h2>
      <div class="llm">
        ${report.llm.enabled ? "" : `<p class="warn">Disabled for this run.</p>`}
        ${report.llm.error ? `<p class="warn">Failed: ${esc(report.llm.error)}</p>` : ""}
        ${
          report.llm.grade
            ? `<p><span class="grade">${esc(report.llm.grade)}</span> <span class="numeric">${esc(report.llm.score)}/100</span> &middot; ${esc(report.llm.model)}</p>`
            : ""
        }
        ${report.llm.summary ? `<p>${esc(report.llm.summary)}</p>` : ""}
        ${(report.llm.findings ?? []).map((f) => findingCard(f)).join("")}
      </div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Slop audit - ${esc(report.target.ref)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Slop audit</h1>
    <p class="target">${esc(report.target.kind)}: ${esc(report.target.ref)}</p>
    <p class="muted">Profile ${esc(report.profile)} &middot; ${esc(new Date(report.generatedAt).toLocaleString())} &middot; ${(report.durationMs / 1000).toFixed(1)}s &middot; ${report.checks.length} checks</p>
  </header>

  <div class="scorebar">
    <span class="grade">${esc(d.grade)}</span>
    <span class="numeric">${d.score.toFixed(1)}/100</span>
    <span class="gradelabel">${esc(gradeWord(d.score))}</span>
    <div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, d.score))}%"></div></div>
  </div>
  <p class="muted">${d.slopPoints.toFixed(1)} slop points across ${d.totalFindings} findings in ${d.categories.filter((c) => c.findings > 0).length} of ${d.categories.length} categories.</p>
  <div class="counts">${counts}</div>

  ${smokeBlock}

  ${screenshots ? `<h2>Rendered screenshots</h2>${screenshots}` : ""}

  <h2>Fix these first</h2>
  ${
    priorities.length
      ? `<p class="muted">The findings that cost the most points, highest first. Fixing these moves the score the most.</p>${priorities.join("")}`
      : `<p class="muted">No findings. Nothing to fix.</p>`
  }

  <h2>By category</h2>
  <table>
    <thead><tr><th>Category</th><th class="num">Score</th><th class="num">Slop points</th><th class="num">Findings</th></tr></thead>
    <tbody>${categoryRows}</tbody>
  </table>

  <h2>Full breakdown</h2>
  ${categoryBlocks || `<p class="muted">No findings.</p>`}

  <h2>Check coverage</h2>
  <details>
    <summary>${report.checks.length} checks ran &mdash; show</summary>
    <table class="checkgrid">
      <thead><tr><th>Check</th><th>Category</th><th class="num">Findings</th><th>Status</th></tr></thead>
      <tbody>${coverageRows}</tbody>
    </table>
  </details>

  ${llm}

  ${
    report.warnings.length
      ? `<h2>Warnings</h2>${report.warnings
          .map((w) => `<p class="warn">${esc(w)}</p>`)
          .join("")}`
      : ""
  }

  <footer>
    Quality score from ${report.checks.length} deterministic checks. Reproduce with
    <code>slopaudit audit ${esc(report.target.ref)} --profile ${esc(report.profile)}</code>.
    ${report.llm?.enabled ? "The LLM section is a second opinion and never affects the deterministic score." : ""}
  </footer>
</div>
</body>
</html>`;
}

function gradeWord(score: number): string {
  if (score >= 90) return "hand-crafted";
  if (score >= 78) return "mostly built";
  if (score >= 64) return "showing slop";
  if (score >= 50) return "vibe-coded";
  return "pure slop";
}
