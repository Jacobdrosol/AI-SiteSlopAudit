import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { DesktopSnapshot } from "../snapshot.js";

const INTERACTIVE = [
  "Button",
  "ListBoxItem",
  "ComboBox",
  "CheckBox",
  "RadioButton",
  "ToggleButton",
  "MenuItem",
  "TabItem",
];

export const desktopInteractionChecks = [
  defineCheck<DesktopSnapshot>({
    id: "desktop.missing-pointer-cursor",
    category: "accessibility",
    title: "No pointer cursor on interactive controls",
    description:
      "Buttons and other controls never change the cursor, so they do not read as clickable.",
    defaultSeverity: "medium",
    appliesTo: ["desktop"],
    run({ data }): Finding[] {
      const all = data.xamlFiles.map((file) => file.content).join("\n");
      if (/Cursor\s*=\s*"Hand"/i.test(all) || /Property="Cursor"/i.test(all))
        return [];

      const controls = new RegExp(`<(${INTERACTIVE.join("|")})\\b`, "i");
      if (!controls.test(all))
        return [];

      return [
        {
          ruleId: "desktop.missing-pointer-cursor",
          category: "accessibility",
          severity: "medium",
          title: "Interactive controls do not set a pointer cursor",
          detail:
            "Nothing in the views sets Cursor=Hand on buttons, list items or inputs. A control that looks pressable but keeps the arrow cursor feels dead. Set it once in a style for each interactive control.",
          fix: "Add a global style: Button/ListBoxItem/ComboBox/CheckBox { Cursor = Hand }.",
          confidence: 0.8,
        },
      ];
    },
  }),

  defineCheck<DesktopSnapshot>({
    id: "desktop.chart-no-axis",
    category: "components",
    title: "Chart without axis labels",
    description:
      "A chart control renders marks but no text, so it has no axis labels or tick values.",
    defaultSeverity: "medium",
    appliesTo: ["desktop"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];

      for (const file of data.csFiles) {
        if (!/class\s+\w*Chart\b/.test(file.content)) continue;
        if (!/DrawingContext/.test(file.content)) continue;
        if (/FormattedText|DrawText|TextLayout/.test(file.content)) continue;

        findings.push({
          ruleId: "desktop.chart-no-axis",
          category: "components",
          severity: "medium",
          title: "Chart draws no axis labels",
          detail:
            "This chart control paints marks but never draws text, so the reader gets bars with no scale. A chart needs both an x axis and a y axis with values.",
          location: file.rel,
          evidence: [{ label: "chart", file: file.rel }],
          fix: "Draw tick labels on both axes (FormattedText/DrawText) and a baseline.",
          confidence: 0.6,
        });
      }

      return findings;
    },
  }),
];
