import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import {
  composite,
  contrastRatio,
  parseColor,
  toHex,
} from "../color.js";
import type { WebSnapshot } from "../snapshot.js";

export const colorChecks = [
  defineCheck<WebSnapshot>({
    id: "color.purple-blue-gradient",
    category: "color",
    title: "Purple/indigo-to-blue gradient",
    description:
      "The default AI gradient. Banned unless the reference explicitly uses it.",
    defaultSeverity: "high",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const offenders = data.gradients.filter((g) => {
        const img = g.backgroundImage.toLowerCase();
        const purplish =
          /indigo|violet|purple|#(?:6d28d9|7c3aed|8b5cf6|a855f7|6366f1|4f46e5|818cf8)/.test(
            img,
          );
        const bluish = /#(?:3b82f6|2563eb|60a5fa|0ea5e9)|blue|sky/.test(img);
        return purplish && bluish;
      });
      if (offenders.length === 0) return [];
      return [
        {
          ruleId: "color.purple-blue-gradient",
          category: "color",
          severity: "high",
          title: "Indigo/purple-to-blue gradient",
          detail: `${offenders.length} element(s) use an indigo-to-blue gradient. This specific ramp is the most recognizable generated-UI color decision and is on the ban list.`,
          location: offenders[0]!.selector,
          evidence: offenders.slice(0, 3).map((g) => ({
            label: "element",
            selector: g.selector,
            value: g.backgroundImage.slice(0, 100),
          })),
          fix: "Replace with a flat surface color from the token set, or a reference-approved scheme.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "color.contrast",
    category: "color",
    title: "Insufficient text contrast",
    description:
      "Text/background pairs below WCAG AA (4.5:1 body, 3:1 large) computed from real rendered colors.",
    defaultSeverity: "high",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];
      const seen = new Set<string>();
      for (const node of data.textNodes) {
        if (node.text.length < 3) continue;
        if (node.bgComplex) continue;
        if (node.visuallyHidden) continue;
        const fg0 = parseColor(node.color);
        if (!fg0) continue;
        const bgRaw = parseColor(node.bgColor ?? "rgb(255, 255, 255)");
        if (!bgRaw) continue;
        const bg = bgRaw.a < 1 ? composite(bgRaw, { r: 255, g: 255, b: 255, a: 1 }) : bgRaw;
        const fg = fg0.a < 1 ? composite(fg0, bg) : fg0;
        const ratio = contrastRatio(fg, bg);
        const large =
          node.fontSize >= 24 ||
          (node.fontSize >= 18.66 && Number(node.fontWeight) >= 700);
        const threshold = large ? 3 : 4.5;
        if (ratio >= threshold) continue;
        const key = `${Math.round(fg.r / 24)}-${Math.round(bg.r / 24)}-${node.fontSize}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          ruleId: "color.contrast",
          category: "color",
          severity: ratio < 2.5 ? "high" : "medium",
          title: "Text contrast below WCAG AA",
          detail: `"${node.text.slice(0, 48)}" renders ${ratio.toFixed(2)}:1 (${toHex(fg)} on ${toHex(bg)}), below the ${threshold}:1 minimum for ${large ? "large" : "body"} text.`,
          location: node.selector,
          evidence: [
            { label: "selector", selector: node.selector },
            { label: "foreground", value: toHex(fg) },
            { label: "background", value: toHex(bg) },
            { label: "ratio", value: ratio.toFixed(2) + ":1" },
          ],
          fix: `Adjust the foreground to reach at least ${threshold}:1, using tokens.`,
          confidence: 0.85,
        });
      }
      return findings.slice(0, 12);
    },
  }),

  defineCheck<WebSnapshot>({
    id: "color.non-token",
    category: "color",
    title: "Colors outside the token set",
    description:
      "Hard-coded colors used where a design token should be. Detected when no CSS custom property holds the same value.",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const tokenRgb = new Set(
        Object.values(data.cssVariables)
          .map((v) => parseColor(v))
          .flatMap((c) => (c ? [toHex(c)] : [])),
      );
      const counts = new Map<string, number>();
      for (const c of data.colors) {
        const rgb = parseColor(c.value);
        if (!rgb || rgb.a === 0) continue;
        const hex = toHex(rgb);
        if (tokenRgb.has(hex)) continue;
        counts.set(hex, (counts.get(hex) ?? 0) + 1);
      }
      const offenders = [...counts.entries()]
        .filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1]);
      if (offenders.length < 3) return [];
      return [
        {
          ruleId: "color.non-token",
          category: "color",
          severity: offenders.length > 8 ? "medium" : "low",
          title: `${offenders.length} colors not backed by a token`,
          detail: `These colors appear in computed styles but match no CSS custom property: ${offenders
            .slice(0, 8)
            .map(([hex, n]) => `${hex} (x${n})`)
            .join(", ")}. Hard-coded color is how a palette ends up with fourteen near-identical grays.`,
          evidence: offenders.slice(0, 8).map(([hex, n]) => ({
            label: hex,
            value: `${n} uses`,
          })),
          fix: "Move each recurring color into the token set and reference the token.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "color.raw-accent",
    category: "color",
    title: "Off-palette accent saturation",
    description:
      "Fully saturated accent colors with no relationship to surrounding hues suggest no palette was chosen.",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const accents = data.colors.filter((c) => {
        if (c.property !== "background-color") return false;
        const rgb = parseColor(c.value);
        if (!rgb) return false;
        const max = Math.max(rgb.r, rgb.g, rgb.b);
        const min = Math.min(rgb.r, rgb.g, rgb.b);
        const sat = max === 0 ? 0 : (max - min) / max;
        return sat > 0.95 && max > 200;
      });
      if (accents.length === 0) return [];
      return [
        {
          ruleId: "color.raw-accent",
          category: "color",
          severity: "low",
          title: "Fully saturated accent colors",
          detail: `${accents.length} element(s) use near-full-saturation fills (e.g. ${accents[0]!.value}). Pure-saturation accents read as defaults rather than decisions.`,
          location: accents[0]!.selector,
          evidence: accents.slice(0, 4).map((a) => ({
            label: "element",
            selector: a.selector,
            value: a.value,
          })),
          fix: "Pick one accent, desaturate it to a defined ramp, and store it as a token.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "color.scrim-missing",
    category: "color",
    title: "Light text over imagery without a scrim",
    description:
      "Very light text sits directly over an image with no opaque or gradient scrim, so contrast depends on the photo.",
    defaultSeverity: "medium",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      if (data.images.length === 0) return [];
      const light = data.textNodes.filter((n) => {
        const c = parseColor(n.color);
        if (!c) return false;
        return c.r > 230 && c.g > 230 && c.b > 230 && n.text.length > 8;
      });
      if (light.length === 0) return [];
      const hasScrim = data.gradients.length > 0;
      if (hasScrim) return [];
      const first = light[0]!;
      return [
        {
          ruleId: "color.scrim-missing",
          category: "color",
          severity: "medium",
          title: "Near-white text present with imagery and no gradient scrim",
          detail: `${light.length} near-white text element(s) found alongside ${data.images.length} image(s), with no gradient overlay detected. If any of this text sits over a photo, contrast is whatever the image happens to be.`,
          location: first.selector,
          evidence: [
            { label: "example text", value: first.text.slice(0, 60) },
            { label: "color", value: first.color },
          ],
          fix: "Add a token-defined scrim under the text, or place the text on a solid surface.",
          confidence: 0.5,
        },
      ];
    },
  }),
];
