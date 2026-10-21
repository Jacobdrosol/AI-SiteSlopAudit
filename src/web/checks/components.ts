import { defineCheck } from "../../core/registry.js";
import type { Finding, Severity } from "../../core/types.js";
import type { WebSnapshot } from "../snapshot.js";

const TELL_ICONS: Array<{ key: string; names: string[]; why: string; severity: Severity }> = [
  {
    key: "sparkles",
    names: ["sparkles", "sparkle", "wand-sparkles", "wandsparkles", "wand_sparkles", "auto_awesome", "auto-awesome", "magic"],
    why: 'used to mean "new", "AI" or "enhance"',
    severity: "medium",
  },
  {
    key: "trend",
    names: ["trending-up", "trending-down", "trendingup", "trendingdown", "trend_up", "trending_up"],
    why: "the generic stat decoration",
    severity: "low",
  },
  {
    key: "user-round",
    names: ["user-round", "userround", "user_circle", "user-circle", "users-round", "userround"],
    why: "the filler avatar glyph",
    severity: "low",
  },
  {
    key: "calendar",
    names: ["calendar", "calendar-days", "calendardays", "calendar_today", "calendar_month"],
    why: 'the default "schedule" glyph',
    severity: "low",
  },
  {
    key: "sliders",
    names: ["sliders", "sliders-horizontal", "slidershorizontal", "tune", "settings"],
    why: 'the default "settings" glyph',
    severity: "low",
  },
  {
    key: "shield",
    names: ["shield", "shield-check", "shieldcheck", "shield_check", "verified_user", "security"],
    why: 'the default "secure" glyph',
    severity: "low",
  },
];

function iconNames(icon: { classes: string; source: string }): string {
  return `${icon.classes} ${icon.source}`.toLowerCase();
}

function normalize(source: string): string {
  if (source.startsWith("data-icon:")) return source.slice("data-icon:".length);
  return source;
}

export const componentChecks = [
  defineCheck<WebSnapshot>({
    id: "components.tell-icons",
    category: "components",
    title: "Tell icons used as placeholders",
    description:
      "Glyphs so overused in generated UI that they read as machine-chosen.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];
      for (const tell of TELL_ICONS) {
        const hits = data.icons.filter((i) => {
          const names = iconNames(i);
          return tell.names.some((n) => names.includes(n));
        });
        if (hits.length === 0) continue;
        findings.push({
          ruleId: "components.tell-icons",
          category: "components",
          severity: tell.severity,
          title: `"${tell.key}" icon used`,
          detail: `The "${tell.key}" glyph appears ${hits.length} time(s); it is a commonly machine-chosen icon ${tell.why}. It reads as a placeholder unless the meaning is genuinely exact.`,
          location: hits[0]!.selector,
          evidence: hits.slice(0, 4).map((h) => ({
            label: normalize(h.source),
            selector: h.selector,
            value: h.classes.slice(0, 60),
          })),
          fix: "Use a glyph specific to the meaning, or drop the icon where it adds nothing.",
        });
      }
      return findings;
    },
  }),

  defineCheck<WebSnapshot>({
    id: "components.mixed-icon-libraries",
    category: "components",
    title: "Mixed icon libraries",
    description:
      "More than one icon library on a page, or inconsistent stroke weights.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const known = data.icons
        .map((i) => normalize(i.source))
        .filter((s) => s !== "unknown" && s !== "inline-svg");
      const libs = [...new Set(known)];
      if (libs.length <= 1) return [];
      return [
        {
          ruleId: "components.mixed-icon-libraries",
          category: "components",
          severity: "medium",
          title: `${libs.length} icon libraries in use`,
          detail: `Found icons from: ${libs.join(", ")}. One library per project, used consistently; mixing sets makes stroke weights and sizes fight.`,
          evidence: libs.map((l) => ({ label: l, value: "present" })),
          fix: "Standardize on one icon library and remove the others.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "components.glassmorphism",
    category: "components",
    title: "Glassmorphism",
    description:
      "Blur plus translucent panels, used without a reference that calls for it.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      if (data.glassmorphism.length === 0) return [];
      return [
        {
          ruleId: "components.glassmorphism",
          category: "components",
          severity: data.glassmorphism.length > 3 ? "medium" : "low",
          title: `${data.glassmorphism.length} backdrop-blur element(s)`,
          detail: `Frosted-glass panels are on the ban list unless the design reference uses them. They usually ship with no contrast guarantee and look dated fast.`,
          location: data.glassmorphism[0]!.selector,
          evidence: data.glassmorphism.slice(0, 3).map((g) => ({
            label: "element",
            selector: g.selector,
            value: g.value,
          })),
          fix: "Use a solid surface from the token set, or confirm the reference genuinely uses glass.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "components.load-animation",
    category: "components",
    title: "Decorative animation",
    description:
      "Animation running on the page with no functional purpose, often on load.",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      if (data.animations.length === 0) return [];
      return [
        {
          ruleId: "components.load-animation",
          category: "components",
          severity: "low",
          title: `${data.animations.length} animated element(s)`,
          detail: `Animations include: ${[...new Set(data.animations.map((a) => a.animationName))].slice(0, 5).join(", ")}. Motion is functional, not decorative; verify each earns its place and respects prefers-reduced-motion.`,
          location: data.animations[0]!.selector,
          evidence: data.animations.slice(0, 4).map((a) => ({
            label: a.animationName,
            selector: a.selector,
            value: a.duration,
          })),
          fix: "Keep only motion that conveys state or spatial relationship; define durations as tokens.",
          confidence: 0.6,
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "components.generic-alt",
    category: "accessibility",
    title: "Missing or generic alt text",
    description:
      "Images lack meaningful alt text, or use filename/generic filler.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const offenders = data.images.filter((img) => {
        if (img.role === "presentation" || img.role === "none") return false;
        if (img.width * img.height < 64) return false;
        if (img.alt === null) return true;
        const a = img.alt.trim().toLowerCase();
        if (a === "") return false;
        if (/\.(png|jpe?g|gif|webp|svg|avif)$/.test(a)) return true;
        if (/^(image|img|photo|picture|banner|hero|logo|icon|screenshot)[\s\d_-]*$/.test(a)) return true;
        return false;
      });
      if (offenders.length === 0) return [];
      return [
        {
          ruleId: "components.generic-alt",
          category: "accessibility",
          severity: "medium",
          title: `${offenders.length} image(s) with missing or generic alt text`,
          detail: `Examples: ${offenders
            .slice(0, 3)
            .map((o) => (o.alt === null ? "<no alt>" : `"${o.alt}"`))
            .join(", ")}. Alt text should describe the image's content in context, or be empty for purely decorative images.`,
          evidence: offenders.slice(0, 4).map((o) => ({
            label: o.src.slice(0, 60) || "<inline>",
            value: o.alt === null ? "no alt attribute" : `alt="${o.alt}"`,
          })),
          fix: "Write meaningful alt text, or alt=\"\" with role=\"presentation\" for decorative images.",
        },
      ];
    },
  }),
];
