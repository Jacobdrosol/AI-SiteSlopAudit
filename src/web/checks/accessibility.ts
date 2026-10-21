import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { WebSnapshot } from "../snapshot.js";

export const accessibilityChecks = [
  defineCheck<WebSnapshot>({
    id: "a11y.lang",
    category: "accessibility",
    title: "Missing lang attribute",
    description:
      "The html element has no lang, so screen readers guess the pronunciation.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      if (data.lang && data.lang.trim() !== "") return [];
      return [
        {
          ruleId: "a11y.lang",
          category: "accessibility",
          severity: "medium",
          title: "<html> has no lang attribute",
          detail:
            "Screen readers use the document language to choose pronunciation rules. Without it, content may be read in the wrong language.",
          fix: 'Set <html lang="en"> (or the correct BCP-47 tag).',
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "a11y.heading-order",
    category: "accessibility",
    title: "Broken heading hierarchy",
    description:
      "Heading levels skip (e.g. h1 to h3) or there is no h1 at all.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      if (data.headings.length === 0) return [];
      const findings: Finding[] = [];
      if (!data.headings.some((h) => h.level === 1)) {
        findings.push({
          ruleId: "a11y.heading-order",
          category: "accessibility",
          severity: "medium",
          title: "No h1 on the page",
          detail:
            "Every page needs one h1 that names its purpose. It is the first thing a screen-reader user navigates to.",
          fix: "Add a single descriptive h1.",
        });
      }
      let prev = 1;
      for (const h of data.headings) {
        if (h.level > prev + 1) {
          findings.push({
            ruleId: "a11y.heading-order",
            category: "accessibility",
            severity: "low",
            title: `Heading level skips from h${prev} to h${h.level}`,
            detail: `"${h.text.slice(0, 50)}" is an h${h.level} following an h${prev}. Skipped levels break the document outline.`,
            location: h.selector,
            evidence: [{ label: "heading", selector: h.selector, value: h.text.slice(0, 60) }],
            fix: "Use the next level down, or restyle with CSS instead of jumping the level.",
          });
          break;
        }
        prev = h.level;
      }
      return findings;
    },
  }),

  defineCheck<WebSnapshot>({
    id: "a11y.unlabeled-controls",
    category: "accessibility",
    title: "Unlabeled interactive controls",
    description:
      "Buttons or inputs with no accessible name (no text, aria-label, or label).",
    defaultSeverity: "high",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const offenders = data.interactives.filter((i) => {
        if (!["button", "a", "select", "textarea"].includes(i.tag)) return false;
        const hasText = i.text.trim().length > 0;
        const hasLabel = (i.ariaLabel ?? "").trim().length > 0;
        return !hasText && !hasLabel;
      });
      if (offenders.length === 0) return [];
      return [
        {
          ruleId: "a11y.unlabeled-controls",
          category: "accessibility",
          severity: "high",
          title: `${offenders.length} control(s) with no accessible name`,
          detail:
            "These controls render no text and carry no aria-label, so assistive tech announces them as just \"button\" or \"link\". Icon-only controls without a label are invisible to screen-reader users.",
          evidence: offenders.slice(0, 6).map((o) => ({
            label: o.tag,
            selector: o.selector,
            value: o.ariaLabel ? `aria-label="${o.ariaLabel}"` : "<no name>",
          })),
          fix: "Add a concise aria-label (or visually-hidden text) describing the action.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "a11y.document",
    category: "accessibility",
    title: "Document accessibility basics",
    description: "Missing page title or meta description.",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];
      if (!data.title || data.title.trim() === "") {
        findings.push({
          ruleId: "a11y.document",
          category: "accessibility",
          severity: "medium",
          title: "Page has no <title>",
          detail: "The title is the first thing announced and is critical for orientation and browser tabs.",
          fix: "Set a unique, descriptive <title>.",
        });
      }
      if (!data.metaDescription || data.metaDescription.trim() === "") {
        findings.push({
          ruleId: "a11y.document",
          category: "accessibility",
          severity: "low",
          title: "No meta description",
          detail: "A meta description is used for search snippets and link previews.",
          fix: "Add a one-sentence meta description describing the page.",
        });
      }
      return findings;
    },
  }),

  defineCheck<WebSnapshot>({
    id: "a11y.focus-visible",
    category: "accessibility",
    title: "Missing focus indication",
    description:
      "No interactive element exposes a visible focus style, so keyboard users cannot see where they are.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      if (data.interactives.length < 5) return [];
      if (data.hasFocusStyles) return [];
      const anyFocus = data.interactives.some((i) => i.hasVisibleFocusHint);
      if (anyFocus) return [];
      return [
        {
          ruleId: "a11y.focus-visible",
          category: "accessibility",
          severity: "medium",
          title: "No visible focus styles detected",
          detail:
            "No interactive element reported a non-none outline. If outline is removed globally without a replacement, keyboard users lose their place.",
          fix: "Provide a :focus-visible style that is clearly visible against the surrounding surface.",
          confidence: 0.5,
        },
      ];
    },
  }),
];
