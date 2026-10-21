import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { WebSnapshot } from "../snapshot.js";

export const responsiveChecks = [
  defineCheck<WebSnapshot>({
    id: "responsive.horizontal-overflow",
    category: "responsive",
    title: "Horizontal overflow",
    description:
      "Content wider than the viewport, causing sideways scroll at a tested width.",
    defaultSeverity: "high",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const offenders = data.captures.filter((c) => c.horizontalOverflow);
      if (offenders.length === 0) return [];
      return offenders.map((c) => ({
        ruleId: "responsive.horizontal-overflow",
        category: "responsive",
        severity: c.overflowAmount > 40 ? "high" : "medium",
        title: `Horizontal overflow at ${c.width}px${c.clipped ? " (content clipped)" : ""}`,
        detail: c.clipped
          ? `Content is ${c.scrollWidth}px wide inside a ${c.clientWidth}px viewport (${c.overflowAmount}px wider), but horizontal overflow is hidden, so the excess is cut off instead of scrollable. Anything off to the right is unreachable.`
          : `The document is ${c.scrollWidth}px wide in a ${c.clientWidth}px viewport (${c.overflowAmount}px of sideways scroll). Content is not reflowing.`,
        evidence: [
          { label: "viewport", value: `${c.width}px` },
          { label: "content width", value: `${c.scrollWidth}px` },
          { label: "overflow", value: `${c.overflowAmount}px${c.clipped ? " (hidden)" : ""}` },
        ],
        fix: "Fix the element forcing the width (min-width, fixed width, or an unbreakable row) so it reflows. If overflow is hidden, content is being clipped, not just scrolled.",
      }));
    },
  }),

  defineCheck<WebSnapshot>({
    id: "responsive.body-font-too-small",
    category: "responsive",
    title: "Body text below 16px",
    description: "Base font size drops under the readable minimum on a viewport.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const offenders = data.captures.filter((c) => c.bodyFontSize < 16);
      if (offenders.length === 0) return [];
      return offenders.map((c) => ({
        ruleId: "responsive.body-font-too-small",
        category: "responsive",
        severity: "medium",
        title: `Body font is ${c.bodyFontSize}px at ${c.width}px`,
        detail: `Body text renders below 16px at a ${c.width}px viewport. Shrinking type to fit is not responsive design; it makes content unreadable.`,
        evidence: [{ label: "viewport", value: `${c.width}px` }, { label: "body font", value: `${c.bodyFontSize}px` }],
        fix: "Keep body text at 16px or above at every breakpoint and let the layout reflow instead.",
      }));
    },
  }),

  defineCheck<WebSnapshot>({
    id: "responsive.touch-targets",
    category: "responsive",
    title: "Undersized touch targets",
    description:
      "Interactive controls smaller than the 44pt/48dp minimum on a mobile viewport.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const mobile = data.captures.reduce(
        (min, c) => (c.width < (min?.width ?? Infinity) ? c : min),
        data.captures[0],
      );
      if (!mobile || mobile.width > 480) {
        const hasNarrow = data.captures.some((c) => c.width <= 480);
        if (!hasNarrow) return [];
      }
      // Prefer the controls as they render at the mobile width. Falling back to
      // the desktop snapshot would judge desktop nav links by a phone threshold.
      const pool =
        mobile?.interactives && mobile.interactives.length
          ? mobile.interactives
          : data.interactives;
      const offenders = pool.filter((i) => {
        if (i.width === 0 || i.height === 0) return false;
        if (i.tag === "a" && i.text.length === 0 && i.ariaLabel === null) return false;
        // WCAG 2.5.5 exempts links embedded in a sentence: their target is the
        // text run, not a standalone control, so the 44px rule does not apply.
        if (i.tag === "a" && i.inText) return false;
        return i.width < 44 || i.height < 44;
      });
      if (offenders.length < 3) return [];
      return [
        {
          ruleId: "responsive.touch-targets",
          category: "responsive",
          severity: "medium",
          title: `${offenders.length} controls below the 44px touch minimum`,
          detail: `Examples: ${offenders
            .slice(0, 4)
            .map((o) => `${o.tag} "${o.text.slice(0, 20)}" (${o.width}x${o.height})`)
            .join("; ")}. Small tap targets are an accessibility failure on phones.`,
          evidence: offenders.slice(0, 6).map((o) => ({
            label: `${o.width}x${o.height}`,
            selector: o.selector,
            value: o.text.slice(0, 40) || o.ariaLabel || "",
          })),
          fix: "Give each control at least a 44x44px hit area via padding or a pseudo-element.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "responsive.viewport-meta",
    category: "responsive",
    title: "Missing or misconfigured viewport meta",
    description:
      "No viewport tag, or one that disables zoom, which breaks mobile usability.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const vp = data.viewportMeta;
      if (vp === null) {
        return [
          {
            ruleId: "responsive.viewport-meta",
            category: "responsive",
            severity: "medium",
            title: "No viewport meta tag",
            detail:
              "The page has no <meta name=\"viewport\">. Mobile browsers will render it at desktop width and scale it down, so the whole page becomes tiny.",
            fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
          },
        ];
      }
      if (/user-scalable\s*=\s*no/i.test(vp) || /maximum-scale\s*=\s*1(\.0)?\b/i.test(vp)) {
        return [
          {
            ruleId: "responsive.viewport-meta",
            category: "responsive",
            severity: "medium",
            title: "Zoom disabled in viewport meta",
            detail: `Viewport is "${vp}", which blocks pinch-zoom. This fails WCAG 1.4.4 and is hostile to low-vision users.`,
            evidence: [{ label: "viewport", value: vp }],
            fix: "Remove user-scalable=no and maximum-scale=1 from the viewport meta.",
          },
        ];
      }
      return [];
    },
  }),
];
