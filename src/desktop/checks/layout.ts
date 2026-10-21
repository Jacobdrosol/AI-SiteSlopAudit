import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { DesktopSnapshot } from "../snapshot.js";
import { attr, forEachOpeningTag, hasAttr, isNumberLiteral, lineAt } from "../xaml.js";

const LAYOUT_CONTAINERS = ["Grid", "Border", "StackPanel", "DockPanel", "WrapPanel", "Canvas", "Window", "UserControl"];

const PLACEHOLDER = /lorem ipsum|coming soon|\bTBD\b|placeholder text|sample text/i;

const COLOR_ATTR =
  /\b(Background|Foreground|BorderBrush|Fill|Stroke|Color)\s*=\s*"(#[0-9a-fA-F]{3,8}|White|Black|Red|Green|Blue|Gray|Grey|Yellow|Orange|Purple|Pink|Brown)"/g;

const FONT_ATTR = /\bFontFamily\s*=\s*"([^"]+)"/g;

function isStyleSheet(rel: string): boolean {
  return (
    /(^|\/)(styles?|themes?|resources?)\//i.test(rel) ||
    /(^|\/)App\.axaml$/i.test(rel)
  );
}

function lineNumbers(content: string, re: RegExp): number[] {
  const lines: number[] = [];
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = global.exec(content)) !== null) {
    lines.push(lineAt(content, match.index));
  }
  return [...new Set(lines)];
}

export const desktopLayoutChecks = [
  defineCheck<DesktopSnapshot>({
    id: "desktop.placeholder-content",
    category: "content",
    title: "Placeholder copy in a view",
    description: "Lorem ipsum, 'coming soon', TBD and similar filler shipped in the interface.",
    defaultSeverity: "medium",
    appliesTo: ["desktop"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];

      for (const file of data.xamlFiles) {
        const lines = lineNumbers(file.content, PLACEHOLDER);
        if (lines.length === 0) continue;
        findings.push({
          ruleId: "desktop.placeholder-content",
          category: "content",
          severity: "medium",
          title: `${lines.length} placeholder line(s)`,
          detail: `Filler copy in a shipped interface reads as unfinished. Replace it with real copy or remove the surface.`,
          location: `${file.rel}:${lines[0]}`,
          evidence: lines.slice(0, 6).map((line) => ({ label: "placeholder", file: file.rel, line })),
          fix: "Write real, specific copy in the product's voice.",
        });
      }

      return findings;
    },
  }),

  defineCheck<DesktopSnapshot>({
    id: "desktop.hardcoded-color",
    category: "color",
    title: "Colour literal in a view",
    description: "Hex or named colours set directly on a view instead of a theme resource.",
    defaultSeverity: "low",
    appliesTo: ["desktop"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];

      for (const file of data.xamlFiles) {
        if (isStyleSheet(file.rel)) continue;
        const lines = lineNumbers(file.content, COLOR_ATTR);
        if (lines.length === 0) continue;
        findings.push({
          ruleId: "desktop.hardcoded-color",
          category: "color",
          severity: "low",
          title: `${lines.length} hard-coded colour(s)`,
          detail: `Views should reference theme brushes (DynamicResource/StaticResource), not literals. Literal colours break light/dark theming and drift.`,
          location: `${file.rel}:${lines[0]}`,
          evidence: lines.slice(0, 6).map((line) => ({ label: "colour", file: file.rel, line })),
          fix: "Move the value into the theme/token dictionary and reference it as a resource.",
        });
      }

      return findings;
    },
  }),

  defineCheck<DesktopSnapshot>({
    id: "desktop.hardcoded-font",
    category: "typography",
    title: "Font family literal in a view",
    description: "A font family set inline instead of through a type token.",
    defaultSeverity: "low",
    appliesTo: ["desktop"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];

      for (const file of data.xamlFiles) {
        if (isStyleSheet(file.rel)) continue;
        const offenders: Array<{ line: number; value: string }> = [];
        const re = new RegExp(FONT_ATTR.source, "g");
        let match: RegExpExecArray | null;
        while ((match = re.exec(file.content)) !== null) {
          const value = match[1] ?? "";
          if (value.trim().startsWith("{")) continue;
          offenders.push({ line: lineAt(file.content, match.index), value });
        }
        if (offenders.length === 0) continue;
        findings.push({
          ruleId: "desktop.hardcoded-font",
          category: "typography",
          severity: "low",
          title: `${offenders.length} inline font famil${offenders.length === 1 ? "y" : "ies"}`,
          detail: `Set the font once as a type token and inherit it; inline families drift and defeat the type scale.`,
          location: `${file.rel}:${offenders[0]!.line}`,
          evidence: offenders.slice(0, 6).map((o) => ({ label: "font", file: file.rel, line: o.line, value: o.value })),
          fix: "Define the family in the theme and reference it with DynamicResource.",
        });
      }

      return findings;
    },
  }),

  defineCheck<DesktopSnapshot>({
    id: "desktop.fixed-size",
    category: "layout",
    title: "Fixed or non-resizable layout",
    description:
      "A container with both width and height fixed, or a window that cannot resize, which breaks on other screen sizes.",
    defaultSeverity: "medium",
    appliesTo: ["desktop"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];

      for (const file of data.xamlFiles) {
        const offenders: Array<{ line: number; tag: string; reason: string }> = [];

        forEachOpeningTag(file.content, LAYOUT_CONTAINERS, (match) => {
          if (/^Window$/i.test(match.name) && attr(match.attrs, "CanResize")?.toLowerCase() === "false") {
            offenders.push({ line: lineAt(file.content, match.index), tag: match.tag.slice(0, 120), reason: "cannot resize" });
            return;
          }

          if (hasAttr(match.attrs, "MinWidth") || hasAttr(match.attrs, "MaxWidth")) return;
          if (hasAttr(match.attrs, "MinHeight") || hasAttr(match.attrs, "MaxHeight")) return;

          const width = isNumberLiteral(attr(match.attrs, "Width"));
          const height = isNumberLiteral(attr(match.attrs, "Height"));
          if (width !== null && height !== null && width >= 200 && height >= 200) {
            offenders.push({
              line: lineAt(file.content, match.index),
              tag: match.tag.slice(0, 120),
              reason: `${width}x${height} fixed`,
            });
          }
        });

        if (offenders.length === 0) continue;
        findings.push({
          ruleId: "desktop.fixed-size",
          category: "layout",
          severity: "medium",
          title: `${offenders.length} fixed layout(s)`,
          detail: `Fixed width+height on a container (or a non-resizable window) clips or letterboxes at other sizes. Let containers size to content or scroll.`,
          location: `${file.rel}:${offenders[0]!.line}`,
          evidence: offenders.slice(0, 6).map((o) => ({ label: o.reason, file: file.rel, line: o.line, value: o.tag })),
          fix: "Use Min/Max, star sizing and scroll viewers instead of a fixed box.",
          confidence: 0.65,
        });
      }

      return findings;
    },
  }),

  defineCheck<DesktopSnapshot>({
    id: "desktop.oversized-view",
    category: "code",
    title: "Oversized view file",
    description: "A single XAML view large enough that it is hard to review or keep consistent.",
    defaultSeverity: "low",
    appliesTo: ["desktop"],
    run({ data }): Finding[] {
      const limit = 400;
      return data.xamlFiles
        .filter((file) => file.lines.length > limit)
        .sort((a, b) => b.lines.length - a.lines.length)
        .slice(0, 5)
        .map((file) => ({
          ruleId: "desktop.oversized-view",
          category: "code" as const,
          severity: "low" as const,
          title: `View file is ${file.lines.length} lines`,
          detail: `${file.rel} is ${file.lines.length} lines. Large views are hard to review and tend to accumulate duplicated styling.`,
          location: `${file.rel}:1`,
          evidence: [{ label: "lines", file: file.rel, line: 1, value: String(file.lines.length) }],
          fix: "Split the view into smaller controls/templates by responsibility.",
        }));
    },
  }),
];
