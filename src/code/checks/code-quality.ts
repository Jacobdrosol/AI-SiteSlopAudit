import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { CodeSnapshot } from "../snapshot.js";

const COMMENTED_CODE_RE =
  /^\s*(?:\/\/|#|--|;)\s*(?:if|for|while|return|function|const|let|var|def|class|import|from|public|private|void|async|await|=>)\b/;

const TASK_MARKER_RE = /\b(TODO|FIXME|HACK|XXX|BUG)\b[: ]/;

const PROSE_EXT = new Set([
  ".md", ".markdown", ".mdx", ".txt", ".rst", ".adoc", ".org", ".po", ".pot",
]);

function isProse(f: { ext: string; relPath: string }): boolean {
  if (PROSE_EXT.has(f.ext)) return true;
  return /(^|\/)(README|CHANGELOG|LICENSE|CONTRIBUTING|AUTHORS|NOTICE)/i.test(f.relPath);
}

export const codeQualityChecks = [
  defineCheck<CodeSnapshot>({
    id: "code.todo-markers",
    category: "code",
    title: "Unresolved task markers",
    description:
      "TODO/FIXME/HACK comments left in the codebase, a signal the work was abandoned mid-stream.",
    defaultSeverity: "low",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const hits: Array<{ file: string; line: number; text: string }> = [];
      for (const f of data.files) {
        if (f.isGenerated || isProse(f)) continue;
        const lines = f.content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (TASK_MARKER_RE.test(line) && line.length < 200) {
            hits.push({ file: f.relPath, line: i + 1, text: line.trim().slice(0, 120) });
          }
        }
      }
      if (hits.length < 3) return [];
      const density = (hits.length / Math.max(1, data.totalLines)) * 1000;
      return [
        {
          ruleId: "code.todo-markers",
          category: "code",
          severity: density > 1 ? "medium" : "low",
          title: `${hits.length} TODO/FIXME markers`,
          detail: `Found ${hits.length} unresolved markers across the codebase (${density.toFixed(
            2,
          )} per 1000 lines). A few are normal; a high density means the work was left half-done.`,
          evidence: hits.slice(0, 6).map((h) => ({
            label: h.file,
            line: h.line,
            value: h.text,
          })),
          fix: "Resolve the markers, or move real work items into the issue tracker and delete the comments.",
        },
      ];
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "code.commented-out-code",
    category: "code",
    title: "Large blocks of commented-out code",
    description:
      "Dead code left commented rather than deleted or put behind a flag.",
    defaultSeverity: "low",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];
      for (const f of data.files) {
        if (f.isTest || f.isGenerated || isProse(f)) continue;
        const lines = f.content.split(/\r?\n/);
        let streak = 0;
        let start = 0;
        for (let i = 0; i < lines.length; i++) {
          if (COMMENTED_CODE_RE.test(lines[i]!)) {
            if (streak === 0) start = i + 1;
            streak += 1;
          } else {
            if (streak >= 6) {
              findings.push({
                ruleId: "code.commented-out-code",
                category: "code",
                severity: "low",
                title: `${streak} consecutive commented-out code lines`,
                detail: `A dead-code block sits at ${f.relPath}:${start}. Commented code rots, confuses reviewers, and hides whether it still works.`,
                location: `${f.relPath}:${start}`,
                evidence: [{ label: f.relPath, file: f.relPath, line: start, value: lines[start - 1]?.trim().slice(0, 100) }],
                fix: "Delete it. Version control remembers it if you need it back.",
              });
            }
            streak = 0;
          }
        }
        if (findings.length >= 5) break;
      }
      return findings;
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "code.large-files",
    category: "code",
    title: "Oversized source files",
    description:
      "Very large single files usually mean generated output or an un-split monolith.",
    defaultSeverity: "low",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const offenders = data.files.filter(
        (f) => !f.isGenerated && f.lines > 800 && !f.isTest,
      );
      if (offenders.length === 0) return [];
      offenders.sort((a, b) => b.lines - a.lines);
      return [
        {
          ruleId: "code.large-files",
          category: "code",
          severity: offenders.length > 3 ? "medium" : "low",
          title: `${offenders.length} file(s) over 800 lines`,
          detail: `Largest: ${offenders
            .slice(0, 4)
            .map((f) => `${f.relPath} (${f.lines} lines)`)
            .join(", ")}. Very large files are hard to review and are a common byproduct of accepting generated output wholesale.`,
          evidence: offenders.slice(0, 5).map((f) => ({
            label: f.relPath,
            file: f.relPath,
            value: `${f.lines} lines`,
          })),
          fix: "Split by responsibility, or confirm it is a deliberate, generated artifact and mark it as such.",
        },
      ];
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "code.duplication",
    category: "code",
    title: "Visible copy-paste duplication",
    description:
      "Multiple near-identical long functions or blocks, a sign of generated repetition.",
    defaultSeverity: "low",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const blockMap = new Map<string, Array<{ file: string; line: number }>>();
      for (const f of data.files) {
        if (f.isGenerated || f.bytes > 200_000) continue;
        if (!["TypeScript", "JavaScript", "Python", "Java", "C#", "Go", "Rust", "C++"].includes(f.language)) continue;
        const lines = f.content.split(/\r?\n/);
        for (let i = 0; i + 12 <= lines.length; i += 6) {
          const block = lines
            .slice(i, i + 12)
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("#"))
            .join("\n");
          if (block.length < 220) continue;
          const key = block.replace(/\s+/g, " ");
          const list = blockMap.get(key) ?? [];
          list.push({ file: f.relPath, line: i + 1 });
          blockMap.set(key, list);
        }
      }
      const dupes = [...blockMap.entries()].filter(
        ([, locs]) => new Set(locs.map((l) => l.file)).size > 1,
      );
      if (dupes.length === 0) return [];
      const example = dupes[0]!;
      const [, locs] = example;
      return [
        {
          ruleId: "code.duplication",
          category: "code",
          severity: dupes.length > 4 ? "medium" : "low",
          title: `${dupes.length} duplicated code block(s) across files`,
          detail: `The same 12+ line block appears in multiple files (e.g. ${locs
            .slice(0, 3)
            .map((l) => `${l.file}:${l.line}`)
            .join(", ")}). Copy-pasted blocks across files are a fingerprint of generated code.`,
          evidence: locs.slice(0, 4).map((l) => ({
            label: l.file,
            file: l.file,
            line: l.line,
          })),
          fix: "Extract the shared logic into one function and call it.",
          confidence: 0.6,
        },
      ];
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "code.project-hygiene",
    category: "code",
    title: "Project hygiene",
    description:
      "Missing README, license, tests, or a git repository.",
    defaultSeverity: "low",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];
      if (!data.hasReadme) {
        findings.push({
          ruleId: "code.project-hygiene",
          category: "code",
          severity: "medium",
          title: "No README",
          detail:
            "There is no README in the project root. Without one, no one can run, build or understand the project.",
          fix: "Add a README with what it is, how to run it, and how to test it.",
        });
      }
      if (!data.hasTests) {
        findings.push({
          ruleId: "code.project-hygiene",
          category: "code",
          severity: "medium",
          title: "No tests found",
          detail:
            "No test files or test directory were found. Untested code cannot be trusted and is usually the first thing skipped when code is generated.",
          fix: "Add tests for the core behavior; even a few honest ones change the grade.",
        });
      }
      if (!data.git.isRepo) {
        findings.push({
          ruleId: "code.project-hygiene",
          category: "code",
          severity: "low",
          title: "Not a git repository",
          detail:
            "No .git directory found. Version control is baseline hygiene and required for any open-source release.",
          fix: "Initialize a repository and commit incrementally.",
        });
      }
      if (!data.hasLicense) {
        findings.push({
          ruleId: "code.project-hygiene",
          category: "code",
          severity: "info",
          title: "No license file",
          detail: "No license was found. A project without a license is not open source.",
          fix: "Add a LICENSE file (MIT, Apache-2.0, etc.) if you intend to share it.",
        });
      }
      return findings;
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "code.placeholder-content",
    category: "code",
    title: "Placeholder text in source",
    description:
      "Lorem ipsum or obvious placeholder strings committed into the project.",
    defaultSeverity: "medium",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const hits: Array<{ file: string; line: number; text: string }> = [];
      const term =
        "(lorem ipsum|dolor sit amet|your company here|example\\.com placeholder|changeme|change me)";
      const re = new RegExp(term, "i");
      const quoted = new RegExp(`["'\`][^"'\`]*${term}`, "i");
      const ruleMetadata =
        /(ruleId|category|severity|description|detail|fix|title|value|name|summary|label|pattern|term|id)\s*[:=]/;
      const regexLiteral = /(\/\\b|new RegExp|\/i\b|\\\.|\(\?:)/;
      for (const f of data.files) {
        if (f.isGenerated || f.isTest || isProse(f)) continue;
        const lines = f.content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (!re.test(line)) continue;
          const trimmed = line.trimStart();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
          if (!quoted.test(line)) continue;
          if (ruleMetadata.test(line)) continue;
          if (regexLiteral.test(line)) continue;
          const aboutPlaceholders = /(placeholder|detect|pattern|regex|rule|string|fixture|mock|stub)/i;
          const quotedPart = line.match(/["'`]([^"'`]{0,200})["'`]/)?.[1] ?? "";
          if (aboutPlaceholders.test(quotedPart)) continue;
          hits.push({ file: f.relPath, line: i + 1, text: line.trim().slice(0, 100) });
        }
      }
      if (hits.length === 0) return [];
      return [
        {
          ruleId: "code.placeholder-content",
          category: "code",
          severity: "medium",
          title: `Placeholder text in ${hits.length} location(s)`,
          detail: `Placeholder strings were committed, not just stubbed. Examples: ${hits
            .slice(0, 4)
            .map((h) => `${h.file}:${h.line}`)
            .join(", ")}.`,
          evidence: hits.slice(0, 5).map((h) => ({
            label: h.file,
            file: h.file,
            line: h.line,
            value: h.text,
          })),
          fix: "Replace placeholders with real content before shipping.",
        },
      ];
    },
  }),
];
