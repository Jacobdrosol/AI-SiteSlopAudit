import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { DesktopSnapshot } from "../snapshot.js";
import { attr, forEachOpeningTag, hasAttr, lineAt } from "../xaml.js";

const ACTION_CONTROLS = ["Button", "RepeatButton", "HyperlinkButton", "MenuItem"];

function isStyleSheet(rel: string): boolean {
  return /(^|\/)(styles?|themes?|resources?)\//i.test(rel);
}

function isWired(name: string, attrs: string): boolean {
  if (hasAttr(attrs, "Command") || hasAttr(attrs, "Click")) return true;
  if (/^HyperlinkButton$/i.test(name) && hasAttr(attrs, "NavigateUri")) return true;
  if (attr(attrs, "IsDefault")?.toLowerCase() === "true") return true;
  if (attr(attrs, "IsCancel")?.toLowerCase() === "true") return true;
  return false;
}

export const desktopControlChecks = [
  defineCheck<DesktopSnapshot>({
    id: "desktop.dead-control",
    category: "components",
    title: "Control with no action",
    description:
      "Buttons and menu items that are not wired to a command, click handler, navigation or dialog role.",
    defaultSeverity: "high",
    appliesTo: ["desktop"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];

      for (const file of data.xamlFiles) {
        if (isStyleSheet(file.rel)) continue;

        const offenders: Array<{ line: number; name: string; tag: string }> = [];
        forEachOpeningTag(file.content, ACTION_CONTROLS, (match) => {
          if (isWired(match.name, match.attrs)) return;
          if (/^MenuItem$/i.test(match.name) && !match.selfClosing) return;
          offenders.push({
            line: lineAt(file.content, match.index),
            name: match.name,
            tag: match.tag.slice(0, 120),
          });
        });

        if (offenders.length === 0) continue;
        findings.push({
          ruleId: "desktop.dead-control",
          category: "components",
          severity: "high",
          title: `${offenders.length} control(s) with no action`,
          detail: `These controls have no Command, Click handler, navigation or dialog role: ${offenders
            .slice(0, 4)
            .map((o) => `${o.name} (line ${o.line})`)
            .join(", ")}. A control that does nothing is worse than no control.`,
          location: `${file.rel}:${offenders[0]!.line}`,
          evidence: offenders.slice(0, 6).map((o) => ({
            label: o.name,
            file: file.rel,
            line: o.line,
            value: o.tag,
          })),
          fix: "Wire every control (Command, Click, NavigateUri, or a dialog role), or remove it.",
          confidence: 0.85,
        });
      }

      return findings;
    },
  }),

  defineCheck<DesktopSnapshot>({
    id: "desktop.unlabeled-control",
    category: "accessibility",
    title: "Unlabeled empty control",
    description:
      "A self-closing button with no content and no accessible name, so assistive tech announces only 'button'.",
    defaultSeverity: "medium",
    appliesTo: ["desktop"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];
      const names = ["Button", "RepeatButton", "HyperlinkButton"];

      for (const file of data.xamlFiles) {
        if (isStyleSheet(file.rel)) continue;
        const offenders: Array<{ line: number; tag: string }> = [];

        forEachOpeningTag(file.content, names, (match) => {
          if (!match.selfClosing) return;
          if (hasAttr(match.attrs, "Content")) return;
          if (hasAttr(match.attrs, "AutomationProperties.Name")) return;
          if (hasAttr(match.attrs, "ToolTip.Tip")) return;
          offenders.push({ line: lineAt(file.content, match.index), tag: match.tag.slice(0, 120) });
        });

        if (offenders.length === 0) continue;
        findings.push({
          ruleId: "desktop.unlabeled-control",
          category: "accessibility",
          severity: "medium",
          title: `${offenders.length} empty control(s) without an accessible name`,
          detail: `A self-closing control with no Content and no AutomationProperties.Name is announced as just "button". Add visible text or an accessible name.`,
          location: `${file.rel}:${offenders[0]!.line}`,
          evidence: offenders.slice(0, 6).map((o) => ({ label: "control", file: file.rel, line: o.line, value: o.tag })),
          fix: "Set Content, or AutomationProperties.Name for an icon-only control.",
        });
      }

      return findings;
    },
  }),

  defineCheck<DesktopSnapshot>({
    id: "desktop.no-virtualization",
    category: "performance",
    title: "Unvirtualized item list",
    description:
      "An ItemsControl bound to a collection renders every row; large data sets stall the UI.",
    defaultSeverity: "medium",
    appliesTo: ["desktop"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];

      for (const file of data.xamlFiles) {
        const offenders: Array<{ line: number; tag: string }> = [];

        forEachOpeningTag(file.content, ["ItemsControl"], (match) => {
          if (!hasAttr(match.attrs, "ItemsSource")) return;
          if (hasAttr(match.attrs, "ItemsPanel")) return;
          offenders.push({ line: lineAt(file.content, match.index), tag: match.tag.slice(0, 120) });
        });

        if (offenders.length === 0) continue;
        findings.push({
          ruleId: "desktop.no-virtualization",
          category: "performance",
          severity: "low",
          title: `${offenders.length} unvirtualized item list(s)`,
          detail: `ItemsControl renders every item. A short fixed list is fine; if this one can grow past a few hundred rows, switch to a virtualizing list so scrolling and resize stay smooth.`,
          location: `${file.rel}:${offenders[0]!.line}`,
          evidence: offenders.slice(0, 6).map((o) => ({ label: "ItemsControl", file: file.rel, line: o.line, value: o.tag })),
          fix: "For large collections, use ListBox or ItemsRepeater with a virtualizing panel.",
          confidence: 0.5,
        });
      }

      return findings;
    },
  }),
];
