import { defineCheck } from "../../core/registry.js";
import type { Category, Finding, Severity } from "../../core/types.js";
import type { WebSnapshot } from "../snapshot.js";

const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{FE0F}\u{200D}]/u;

const AI_VOICE: Array<{ pattern: RegExp; label: string; severity: Severity }> = [
  { pattern: /\belevate your\b/i, label: '"Elevate your..." opener', severity: "high" },
  { pattern: /\bseamlessly (integrat|connect|sync|manage)/i, label: '"Seamlessly integrate..."', severity: "high" },
  { pattern: /\bunlock the (power|potential) of\b/i, label: '"Unlock the power of..."', severity: "high" },
  { pattern: /\bin today'?s fast-paced world\b/i, label: '"In today\'s fast-paced world..."', severity: "high" },
  { pattern: /\bit'?s not just [^.,;]+, it'?s\b/i, label: '"It\'s not just X, it\'s Y"', severity: "high" },
  { pattern: /\bwhether you'?re a [^.,;]+ or a\b/i, label: '"Whether you\'re a X or a Y..."', severity: "high" },
  { pattern: /\btake [^.,;]+ to the next level\b/i, label: '"...to the next level"', severity: "medium" },
  { pattern: /\bgame[- ]chang(ing|er)\b/i, label: '"Game-changing"', severity: "medium" },
  { pattern: /\bcutting[- ]edge\b/i, label: '"Cutting-edge"', severity: "medium" },
  { pattern: /\bstate[- ]of[- ]the[- ]art\b/i, label: '"State-of-the-art"', severity: "medium" },
  { pattern: /\bempower(s|ing)? (you|your|teams|businesses)\b/i, label: '"Empower your..."', severity: "medium" },
  { pattern: /\bthe future of [a-z]+ is here\b/i, label: '"The future of X is here"', severity: "high" },
  { pattern: /\bdesigned with you in mind\b/i, label: '"Designed with you in mind"', severity: "medium" },
  { pattern: /\btailored (solutions|experiences|to your needs)\b/i, label: '"Tailored solutions"', severity: "medium" },
];

const LOREM_RE = /\b(lorem ipsum|dolor sit amet|consectetur (adipiscing|elit))\b/i;
const TODO_MARKER_RE = /\b(TODO|FIXME|HACK|XXX)\b(?=\s*[:(\[]|\s*$)/;
const PLACEHOLDER_RE = /\b(your (company|product|text) here|coming soon|sample text|title goes here|\bxxx\b)\b/i;

function collectText(data: WebSnapshot): string {
  const parts = [
    data.title,
    data.metaDescription ?? "",
    ...data.textNodes.map((n) => n.text),
  ];
  return parts.join("\n");
}

export const contentChecks = [
  defineCheck<WebSnapshot>({
    id: "content.emoji",
    category: "content",
    title: "Emojis in copy",
    description:
      "Emojis used in UI copy or as icons. Banned.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const hits: Array<{ text: string; selector: string; emoji: string }> = [];
      for (const n of data.textNodes) {
        const m = n.text.match(EMOJI_RE);
        if (m) hits.push({ text: n.text, selector: n.selector, emoji: m[0] });
      }
      const titleHit = data.title.match(EMOJI_RE);
      if (titleHit) hits.push({ text: data.title, selector: "<title>", emoji: titleHit[0] });
      if (hits.length === 0) return [];
      const uniq = [...new Set(hits.map((h) => h.emoji))];
      return [
        {
          ruleId: "content.emoji",
          category: "content",
          severity: "medium",
          title: `Emoji${hits.length > 1 ? "s" : ""} found in UI copy`,
          detail: `${hits.length} element(s) contain emoji (${uniq.join(" ")}). Emoji in copy or as icons is on the ban list; it is the most common shortcut for "make it friendly" and reads as machine-generated.`,
          location: hits[0]!.selector,
          evidence: hits.slice(0, 4).map((h) => ({
            label: "element",
            selector: h.selector,
            value: h.text.slice(0, 70),
          })),
          fix: "Remove the emoji. If an icon is meant, use the project's icon library at a consistent size.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "content.lorem-placeholder",
    category: "content",
    title: "Lorem ipsum or placeholder copy",
    description: "Placeholder text presented as real content.",
    defaultSeverity: "high",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];
      for (const n of data.textNodes) {
        if (LOREM_RE.test(n.text)) {
          findings.push({
            ruleId: "content.lorem-placeholder",
            category: "content",
            severity: "high",
            title: "Lorem ipsum in shipped copy",
            detail: `Placeholder Latin is rendered in the page: "${n.text.slice(0, 70)}".`,
            location: n.selector,
            evidence: [{ label: "text", selector: n.selector, value: n.text.slice(0, 120) }],
            fix: "Replace with real, specific product copy.",
          });
          break;
        }
      }
      for (const n of data.textNodes) {
        const m = n.text.match(TODO_MARKER_RE) ?? n.text.match(PLACEHOLDER_RE);
        if (m) {
          findings.push({
            ruleId: "content.lorem-placeholder",
            category: "content",
            severity: "medium",
            title: "Placeholder marker in visible copy",
            detail: `Found "${m[0]}" in rendered text: "${n.text.slice(0, 70)}". This was meant to be filled in before shipping.`,
            location: n.selector,
            evidence: [{ label: "text", selector: n.selector, value: n.text.slice(0, 120) }],
            fix: "Write the real content or remove the element.",
          });
          break;
        }
      }
      return findings;
    },
  }),

  defineCheck<WebSnapshot>({
    id: "content.ai-voice",
    category: "content",
    title: "AI marketing voice",
    description:
      "Copy containing the banned marketing clichés from the anti-slop list.",
    defaultSeverity: "high",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const text = collectText(data);
      const matched: Array<{ label: string; severity: Severity }> = [];
      for (const rule of AI_VOICE) {
        if (rule.pattern.test(text)) matched.push({ label: rule.label, severity: rule.severity });
      }
      if (matched.length === 0) return [];
      const worst: Severity = matched.some((m) => m.severity === "high") ? "high" : "medium";
      return [
        {
          ruleId: "content.ai-voice",
          category: "content",
          severity: worst,
          title: `${matched.length} AI marketing phrase${matched.length > 1 ? "s" : ""} in copy`,
          detail: `Matched banned patterns: ${matched.map((m) => m.label).join(", ")}. These phrasings are statistically average filler; they say nothing specific about the product.`,
          evidence: matched.map((m) => ({ label: m.label })),
          fix: "Rewrite plainly and specifically. State what the product does and for whom, with concrete nouns.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "content.invented-proof",
    category: "content",
    title: "Invented social proof",
    description:
      "Testimonials, star ratings or logo walls that name no verifiable source.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const text = collectText(data);
      const hasQuote = /[""\u201C][^""\u201D]{20,}[""\u201D]\s*[-\u2014]/.test(text) || /\btestimonial\b/i.test(text);
      const hasStars = /★{4,5}|5[- ]star|rated \d(\.\d)?\s*\/\s*5/i.test(text);
      if (!hasQuote && !hasStars) return [];
      return [
        {
          ruleId: "content.invented-proof",
          category: "content",
          severity: "medium",
          title: "Social proof without verifiable attribution",
          detail: `${hasQuote ? "A testimonial-style quote " : ""}${hasStars ? "A star rating " : ""}appears in the copy. Fabricated proof is on the ban list; if these are real, name the source and link it.`,
          fix: "Either attribute proof to a real, named source with a link, or remove it.",
          confidence: 0.5,
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "content.generic",
    category: "content",
    title: "Generic, non-specific copy",
    description:
      "The page never names a concrete product, audience or benefit.",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const text = collectText(data).toLowerCase();
      if (text.length < 400) return [];
      const vague = (
        text.match(
          /\b(solutions|services|products|platform|experience|innovation|synerg|leverage|robust|scalable|future-proof|best-in-class|world-class|next-generation|revolutioniz)/g,
        ) ?? []
      ).length;
      const density = vague / (text.length / 500);
      if (density < 3) return [];
      return [
        {
          ruleId: "content.generic",
          category: "content",
          severity: "low",
          title: "Copy is heavy on vague business nouns",
          detail: `Found ${vague} vague buzzwords (solutions, platform, leverage, scalable, world-class...). Copy that could describe any company describes none.`,
          evidence: [{ label: "vague term count", value: String(vague) }],
          fix: "Replace each with a concrete noun: what it is, who it is for, what it does.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "content.empty-body",
    category: "content",
    title: "Little or no real content",
    description:
      "The page renders mostly chrome with almost no readable text.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const chars = data.textNodes.reduce((s, n) => s + n.text.length, 0);
      if (chars >= 400) return [];
      if (data.sections.length === 0) return [];
      return [
        {
          ruleId: "content.empty-body",
          category: "content",
          severity: "medium",
          title: "Page has almost no readable text",
          detail: `Only ${chars} characters of visible text across ${data.sections.length} sections. A page with structure but no content is a mockup, not a product.`,
          fix: "Add the real content, or remove the sections that only pretend to have some.",
        },
      ];
    },
  }),
];
