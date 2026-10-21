import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { WebSnapshot } from "../snapshot.js";

const DEFAULT_FONT_RE = /(-apple-system|system-ui|segoe ui|roboto|helvetica|arial|inter|open sans|noto sans|ubuntu|san-serif|sans-serif)/i;
const REFLEX_FONTS = ["inter", "roboto", "system-ui", "-apple-system", "segoe ui", "arial", "helvetica"];

function rootFamily(fontFamily: string): string {
  return (fontFamily.split(",")[0] ?? "").replace(/["']/g, "").trim().toLowerCase();
}

export const typographyChecks = [
  defineCheck<WebSnapshot>({
    id: "type.default-font",
    category: "typography",
    title: "Reflex default font stack",
    description:
      "Body text uses Inter/Roboto/system-ui without an explicit, named font choice.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const bodyNodes = data.textNodes.filter((n) => n.text.length > 20);
      if (bodyNodes.length < 3) return [];
      const families = bodyNodes.map((n) => rootFamily(n.fontFamily));
      const reflex = families.filter((f) => REFLEX_FONTS.includes(f));
      const ratio = reflex.length / families.length;
      if (ratio < 0.6) return [];
      const sample = reflex[0] ?? "system-ui";
      return [
        {
          ruleId: "type.default-font",
          category: "typography",
          severity: "medium",
          title: "Body uses a reflex default font stack",
          detail: `${Math.round(ratio * 100)}% of body text resolves to a default stack (most common: "${sample}"). Nothing wrong with Inter, but reaching for it by default is the single most common tell that no typographic decision was made.`,
          evidence: [
            { label: "dominant family", value: sample },
            { label: "body nodes", value: String(bodyNodes.length) },
          ],
          fix: "Choose a named font for the product (see the assets skill) and set it once as a token. If you keep this stack, say so deliberately.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "type.too-many-sizes",
    category: "typography",
    title: "No type scale",
    description:
      "Too many distinct rendered font sizes on one page indicates ad-hoc sizing rather than a scale.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const sizes = new Set(
        data.textNodes.map((n) => Math.round(n.fontSize * 2) / 2),
      );
      if (sizes.size <= 6) return [];
      const sorted = [...sizes].sort((a, b) => a - b);
      return [
        {
          ruleId: "type.too-many-sizes",
          category: "typography",
          severity: sizes.size > 10 ? "high" : "medium",
          title: `${sizes.size} distinct font sizes in one page`,
          detail: `Rendered sizes: ${sorted.join(", ")}px. A scale usually exposes 4-6 steps. More than that means sizes were chosen one element at a time.`,
          evidence: [{ label: "sizes", value: sorted.join("px, ") + "px" }],
          fix: "Define a ratio-based type scale as tokens and map every text element to a step. Collapse the extras.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "type.mixed-sizes-in-block",
    category: "typography",
    title: "Mixed sizes inside one text block",
    description:
      "Sibling paragraphs that sit together render at different sizes without a deliberate reason. This reads as broken, not styled.",
    defaultSeverity: "high",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];
      const byBlock = new Map<string, typeof data.textNodes>();
      for (const n of data.textNodes) {
        if (!["p", "li"].includes(n.tag)) continue;
        if (n.text.length < 60) continue;
        const key = n.parentSelector ?? n.selector;
        const list = byBlock.get(key) ?? [];
        list.push(n);
        byBlock.set(key, list);
      }
      for (const [block, nodes] of byBlock) {
        if (nodes.length < 2) continue;
        const sorted = [...nodes].sort((a, b) => a.siblingIndex - b.siblingIndex);
        const runs: (typeof nodes)[] = [];
        let run: typeof nodes = [];
        for (const n of sorted) {
          const prev = run[run.length - 1];
          if (!prev) {
            run = [n];
          } else if (
            n.siblingIndex - prev.siblingIndex <= 2 &&
            n.siblingIndex !== prev.siblingIndex
          ) {
            run.push(n);
          } else {
            runs.push(run);
            run = [n];
          }
        }
        if (run.length) runs.push(run);

        for (const group of runs) {
          if (group.length < 2) continue;
          const sizes = [...new Set(group.map((n) => Math.round(n.fontSize * 2) / 2))];
          if (sizes.length < 2) continue;
          const spread = Math.max(...sizes) - Math.min(...sizes);
          if (spread < 1) continue;
          findings.push({
            ruleId: "type.mixed-sizes-in-block",
            category: "typography",
            severity: "high",
            title: "Sibling paragraphs render at different sizes",
            detail: `Consecutive paragraphs under ${block} render at ${sizes.join("px, ")}px (${spread}px spread). Paragraphs that sit together should share one size and line-height; a larger first paragraph above a smaller second reads as an accident.`,
            location: block,
            evidence: [
              { label: "selector", selector: block },
              { label: "sizes", value: sizes.map((s) => `${s}px`).join(", ") },
              {
                label: "text",
                value: group.slice(0, 3).map((p) => p.text.slice(0, 50)).join(" | "),
              },
            ],
            fix: "Give all paragraphs in this block one shared prose class (same size, same line-height). Keep one deliberate larger lede at most.",
          });
        }
      }
      return findings.slice(0, 8);
    },
  }),

  defineCheck<WebSnapshot>({
    id: "type.line-height",
    category: "typography",
    title: "Body line-height out of range",
    description:
      "Body copy should sit between 1.5 and 1.7 line-height for readability.",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const bodyParas = data.textNodes.filter(
        (n) => n.tag === "p" && n.text.length > 80 && n.lineHeight,
      );
      const offenders = bodyParas.filter((n) => {
        const ratio = (n.lineHeight ?? 0) / n.fontSize;
        return ratio < 1.4 || ratio > 1.9;
      });
      if (offenders.length < 2) return [];
      const first = offenders[0]!;
      const ratio = ((first.lineHeight ?? 0) / first.fontSize).toFixed(2);
      return [
        {
          ruleId: "type.line-height",
          category: "typography",
          severity: "low",
          title: "Body line-height is out of the readable range",
          detail: `${offenders.length} body paragraphs sit outside 1.4-1.9 line-height (example: ${ratio}). Cramped or loose body text makes a page feel unfinished.`,
          location: first.selector,
          evidence: [{ label: "example ratio", value: ratio }],
          fix: "Set body line-height to a token between 1.5 and 1.7.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "type.gradient-text",
    category: "typography",
    title: "Gradient text",
    description: "Text painted with a gradient background-clip.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const gradientText = data.gradients.filter(
        (g) => g.textClip && g.textClip.includes("text"),
      );
      if (gradientText.length === 0) return [];
      return [
        {
          ruleId: "type.gradient-text",
          category: "typography",
          severity: "medium",
          title: "Gradient text detected",
          detail: `${gradientText.length} element(s) paint text with a gradient. Gradient text is on the ban list: it hurts contrast, breaks selection/print, and is a hallmark of generated headings.`,
          location: gradientText[0]!.selector,
          evidence: gradientText.slice(0, 3).map((g) => ({
            label: "element",
            selector: g.selector,
            value: g.backgroundImage.slice(0, 80),
          })),
          fix: "Use a single solid foreground color from the token set.",
        },
      ];
    },
  }),
];
