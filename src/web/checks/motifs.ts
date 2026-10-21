import { defineCheck } from "../../core/registry.js";
import type { Finding, Severity } from "../../core/types.js";
import type { WebSnapshot } from "../snapshot.js";

// A single decorative device (an eyebrow badge, a tinted icon tile, a stepper
// label, a row of chips) is a normal design choice. The recognizable "AI slop"
// signal is repetition: the same handful of devices stamped through every
// section, so the page reads as a template rather than a designed page. This is
// the "gut intuition" people have when they say a site looks generated, made
// countable.
export const motifChecks = [
  defineCheck<WebSnapshot>({
    id: "layout.motif-stacking",
    category: "layout",
    title: "Repetitive decorative motifs",
    description:
      "The same decorative devices (eyebrow badges, icon tiles, stepper labels, chip rows, heading icons) repeated across the page.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const m = data.motifs;
      if (!m) return [];
      const findings: Finding[] = [];
      if (m.kindCount >= 4 && m.total >= 8) {
        const severity: Severity = m.kindCount >= 5 || m.total >= 24 ? "high" : "medium";
        findings.push({
          ruleId: "layout.motif-stacking",
          category: "layout",
          severity,
          title: `${m.kindCount} decorative motifs repeated ${m.total} times`,
          detail: `The page repeats ${m.kindCount} kinds of decoration: ${m.eyebrowBadges} eyebrow badges, ${m.iconTiles} tinted icon tiles, ${m.stepLabels} stepper labels, ${m.chipRows} chip rows (${m.chipCount} chips), ${m.headingIcons} heading icons, ${m.bicolorHeadings} two-tone headings. Any one is fine; stacking them all through every section is what makes a page read as machine-assembled rather than designed.`,
          evidence: m.samples.slice(0, 8).map((s) => ({ label: s })),
          fix: "Keep one decorative device and drop the rest. Let spacing and type carry the hierarchy instead of a badge or tile on every block.",
        });
      }
      if (m.eyebrowBadges >= 6) {
        findings.push({
          ruleId: "layout.motif-stacking",
          category: "layout",
          severity: "medium",
          title: `${m.eyebrowBadges} eyebrow labels`,
          detail: `A small label above a heading is repeated ${m.eyebrowBadges} times. When almost every heading is preceded by a tinted or uppercase tag, the tag stops adding information and becomes noise.`,
          evidence: m.samples.filter((s) => s.startsWith("eyebrow")).slice(0, 5).map((s) => ({ label: s })),
          fix: "Use an eyebrow only where it genuinely categorizes the section; remove the rest.",
        });
      }
      if (m.chipRows >= 2) {
        findings.push({
          ruleId: "layout.motif-stacking",
          category: "layout",
          severity: "low",
          title: `${m.chipRows} rows of near-identical chips`,
          detail: `Chip or pill rows appear ${m.chipRows} times (${m.chipCount} chips total). Uniform rows of small equal-weight chips flatten whatever they list into a wall of the same.`,
          fix: "Use chips sparingly; present short lists as prose or a definition list where weight matters.",
        });
      }
      return findings;
    },
  }),
];
