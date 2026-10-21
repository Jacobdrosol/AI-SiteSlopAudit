import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { WebSnapshot } from "../snapshot.js";

export const layoutChecks = [
  defineCheck<WebSnapshot>({
    id: "layout.hero-signature",
    category: "layout",
    title: "Floating-card hero signature",
    description:
      "A centered hero (h1 + subhead + a small cluster of pill buttons) immediately followed by three to four equal feature cards. The most recognizable slop layout.",
    defaultSeverity: "high",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const h1 = data.headings.find((h) => h.level === 1);
      if (!h1) return [];

      // The card grid must sit just under the hero, not anywhere on a long
      // marketing page (which almost always has a 3-card section somewhere).
      const NEAR_TOP = 1400;
      const heroCards = data.sections.find(
        (s) =>
          s.cardLikeChildren >= 3 &&
          s.cardLikeChildren <= 4 &&
          s.cardLikeChildren === s.childCount &&
          (s.boundingBox?.top ?? Number.POSITIVE_INFINITY) < NEAR_TOP,
      );
      if (!heroCards) return [];

      // Pill controls must be in the hero (top of the page) and must not be
      // site chrome - otherwise every nav and footer link is a "pill" and the
      // check fires on any page that happens to have a three-card section.
      const pills = data.interactives.filter(
        (i) =>
          (i.tag === "a" || i.tag === "button") &&
          !i.inChrome &&
          (i.top ?? Number.POSITIVE_INFINITY) < 760 &&
          i.height > 0 &&
          i.height <= 56 &&
          i.width > 0 &&
          i.width < 260,
      );
      if (pills.length < 2) return [];

      return [
        {
          ruleId: "layout.hero-signature",
          category: "layout",
          severity: "high",
          title: "Hero with pill buttons over an equal feature grid",
          detail: `A single h1 ("${h1.text.slice(0, 50)}"), ${pills.length} pill-sized controls, and a ${heroCards.cardLikeChildren}-card equal grid appear together. This combination is the default generated landing page.`,
          location: heroCards.selector,
          evidence: [
            { label: "hero heading", selector: h1.selector },
            { label: "feature grid", selector: heroCards.selector },
            { label: "pill controls", value: String(pills.length) },
          ],
          fix: "Rebuild around one focal element: give the hero a single primary action and replace the equal grid with a layout that has hierarchy.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "layout.equal-card-grid",
    category: "layout",
    title: "Everything boxed in equal cards",
    description:
      "Large share of the page is one uniform card grid with no hierarchy.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const offenders = data.sections.filter(
        (s) =>
          s.cardLikeChildren >= 4 &&
          s.childCount >= 4 &&
          s.cardLikeChildren === s.childCount,
      );
      if (offenders.length === 0) return [];
      return offenders.slice(0, 3).map((s) => ({
        ruleId: "layout.equal-card-grid",
        category: "layout",
        severity: "medium",
        title: "Uniform card grid with no hierarchy",
        detail: `A ${s.columns}-column section contains ${s.childCount} children that are all card-styled and identical in weight. Not all content deserves a card; this flattens importance.`,
        location: s.selector,
        evidence: [{ label: "section", selector: s.selector }],
        fix: "Promote one item, merge related ones, or drop the card chrome for some children.",
      }));
    },
  }),

  defineCheck<WebSnapshot>({
    id: "layout.no-max-width",
    category: "layout",
    title: "Prose without a max-width",
    description:
      "Body copy runs wider than a comfortable measure (~75ch), which is hard to read and reads as unstyled.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const wide = data.textNodes.filter(
        (n) =>
          n.text.length > 160 &&
          ["p", "li"].includes(n.tag) &&
          n.width > 900,
      );
      if (wide.length < 2) return [];
      const first = wide[0]!;
      return [
        {
          ruleId: "layout.no-max-width",
          category: "layout",
          severity: "medium",
          title: "Body text exceeds the readable measure",
          detail: `${wide.length} paragraph(s) render over 900px wide (example: ${first.width}px). At 16px that is well past the ~60-75 character limit and the eye loses its place returning to the next line.`,
          location: first.selector,
          evidence: [
            { label: "selector", selector: first.selector },
            { label: "width", value: `${first.width}px` },
          ],
          fix: "Wrap prose in a container capped around 65-75ch and center it.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "layout.uniform-padding",
    category: "layout",
    title: "No vertical rhythm",
    description:
      "Sections are all essentially the same height and density, so the page has no rhythm.",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const sized = data.sections.filter(
        (s) => s.boundingBox && s.boundingBox.height > 100,
      );
      if (sized.length < 5) return [];
      const heights = sized.map((s) => s.boundingBox!.height);
      const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
      const variance =
        heights.reduce((a, h) => a + (h - mean) ** 2, 0) / heights.length;
      const cv = Math.sqrt(variance) / mean;
      if (cv > 0.4) return [];
      return [
        {
          ruleId: "layout.uniform-padding",
          category: "layout",
          severity: "low",
          title: "Page sections have near-uniform height",
          detail: `${sized.length} major sections average ${Math.round(mean)}px tall with a coefficient of variation of ${cv.toFixed(2)}. Uniform section heights leave no rhythm; alternating dense and open sections reads as intentional.`,
          evidence: [{ label: "sections", value: String(sized.length) }],
          fix: "Vary section density deliberately against the reference.",
          confidence: 0.6,
        },
      ];
    },
  }),
];
