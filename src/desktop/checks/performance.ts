import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { DesktopSnapshot } from "../snapshot.js";
import { lineAt } from "../xaml.js";

const BLOCKING: Array<{ re: RegExp; label: string }> = [
  { re: /\.Result\b/g, label: ".Result" },
  { re: /\.Wait\(\)/g, label: ".Wait()" },
  { re: /GetAwaiter\(\)\.GetResult\(\)/g, label: "GetAwaiter().GetResult()" },
  { re: /Thread\.Sleep\(/g, label: "Thread.Sleep" },
];

function isGenerated(rel: string): boolean {
  return /(^|\/)(obj|bin)\//.test(rel) || /\.(g|designer)\.cs$/i.test(rel);
}

export const desktopPerformanceChecks = [
  defineCheck<DesktopSnapshot>({
    id: "desktop.ui-thread-blocking",
    category: "performance",
    title: "Blocking call that can freeze the UI",
    description:
      "Synchronous waits (.Result, .Wait(), GetAwaiter().GetResult()) and sleeps run on the UI thread and freeze the window.",
    defaultSeverity: "high",
    appliesTo: ["desktop"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];

      for (const file of data.csFiles) {
        if (isGenerated(file.rel)) continue;

        const offenders: Array<{ line: number; label: string }> = [];
        for (const blocking of BLOCKING) {
          const re = new RegExp(blocking.re.source, "g");
          let match: RegExpExecArray | null;
          while ((match = re.exec(file.content)) !== null) {
            const line = lineAt(file.content, match.index);
            const text = file.lines[line - 1]?.trimStart() ?? "";
            if (text.startsWith("//") || text.startsWith("*")) continue;
            offenders.push({ line, label: blocking.label });
          }
        }

        if (offenders.length === 0) continue;
        offenders.sort((a, b) => a.line - b.line);

        findings.push({
          ruleId: "desktop.ui-thread-blocking",
          category: "performance",
          severity: "high",
          title: `${offenders.length} blocking call(s)`,
          detail: `Synchronous waits freeze the UI while they run; the window stops repainting and resizing. Await asynchronously instead.`,
          location: `${file.rel}:${offenders[0]!.line}`,
          evidence: offenders.slice(0, 8).map((o) => ({
            label: o.label,
            file: file.rel,
            line: o.line,
          })),
          fix: "Make the caller async and await the task; move CPU work off the UI thread.",
          confidence: 0.9,
        });
      }

      return findings;
    },
  }),
];
