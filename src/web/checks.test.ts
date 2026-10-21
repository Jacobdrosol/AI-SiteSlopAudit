import { test } from "node:test";
import assert from "node:assert/strict";
import { Registry } from "../core/registry.js";
import type { AuditOptions } from "../core/types.js";
import { resolveConfig } from "../core/config.js";
import { runChecks } from "../core/runner.js";
import { contentChecks } from "./checks/content.js";
import { componentChecks } from "./checks/components.js";
import { imageChecks } from "./checks/images.js";
import { colorChecks } from "./checks/color.js";
import { layoutChecks } from "./checks/layout.js";
import { responsiveChecks } from "./checks/responsive.js";
import { accessibilityChecks } from "./checks/accessibility.js";
import type { WebSnapshot } from "./snapshot.js";

function emptySnapshot(overrides: Partial<WebSnapshot> = {}): WebSnapshot {
  return {
    url: "https://example.test",
    finalUrl: "https://example.test",
    statusCode: 200,
    responseHeaders: {},
    title: "Example",
    metaDescription: "A page",
    viewportMeta: "width=device-width, initial-scale=1",
    lang: "en",
    textNodes: [],
    colors: [],
    gradients: [],
    icons: [],
    images: [],
    interactives: [],
    headings: [],
    sections: [],
    animations: [],
    glassmorphism: [],
    motifs: {
      eyebrowBadges: 0,
      iconTiles: 0,
      stepLabels: 0,
      chipRows: 0,
      chipCount: 0,
      headingIcons: 0,
      bicolorHeadings: 0,
      kindCount: 0,
      total: 0,
      samples: [],
    },
    cssVariables: {},
    stylesheets: [],
    scriptSources: [],
    scriptTags: [],
    linkedResources: [],
    forms: [],
    inlineScriptBytes: 0,
    captures: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function options(): AuditOptions {
  return {
    profile: "default",
    categories: [
      "layout", "typography", "color", "content", "components",
      "responsive", "accessibility", "security",
    ],
    disabledRules: [],
    config: resolveConfig("default"),
  };
}

async function run(checks: ReturnType<Registry["all"]>, snapshot: WebSnapshot) {
  const registry = new Registry();
  registry.registerAll(checks);
  return runChecks(
    { kind: "web", label: "test", ref: snapshot.url },
    snapshot,
    registry.forTarget("web"),
    options(),
  );
}

test("emoji and AI-voice copy are both flagged", async () => {
  const snapshot = emptySnapshot({
    textNodes: [
      {
        tag: "p",
        text: "Elevate your workflow with our platform 🚀",
        fontSize: 16,
        lineHeight: 24,
        fontFamily: "Inter, sans-serif",
        fontWeight: "400",
        color: "rgb(0,0,0)",
        letterSpacing: "normal",
        width: 400,
        siblingIndex: 0,
        selector: "p",
        bgColor: "rgb(255,255,255)",
        bgComplex: false,
        parentSelector: "body",
      },
    ],
  });
  const result = await run(contentChecks, snapshot);
  const ids = result.findings.map((f) => f.ruleId);
  assert.ok(ids.includes("content.emoji"), "emoji flagged");
  assert.ok(ids.includes("content.ai-voice"), "AI voice flagged");
});

test("a clean page produces no content findings", async () => {
  const snapshot = emptySnapshot({
    title: "Bike repair scheduling for shops in Portland",
    textNodes: [
      {
        tag: "p",
        text: "Book a repair, track the job, and know when your bike is ready. Built for shops that already have enough software.",
        fontSize: 16,
        lineHeight: 25,
        fontFamily: "\"Söhne\", sans-serif",
        fontWeight: "400",
        color: "rgb(20,20,20)",
        letterSpacing: "normal",
        width: 600,
        siblingIndex: 0,
        selector: "p",
        bgColor: "rgb(255,255,255)",
        bgComplex: false,
        parentSelector: "body",
      },
    ],
  });
  const result = await run(contentChecks, snapshot);
  assert.equal(result.findings.length, 0);
});

test("the sparkles tell-icon is flagged", async () => {
  const snapshot = emptySnapshot({
    icons: [
      {
        selector: "button > svg",
        source: "data-icon:sparkles",
        classes: "lucide lucide-sparkles",
        size: 20,
        strokeWidth: "2",
      },
    ],
  });
  const result = await run(componentChecks, snapshot);
  assert.ok(result.findings.some((f) => f.ruleId === "components.tell-icons"));
});

const textNode = (over: Partial<import("./snapshot.js").ComputedTextNode> = {}) => ({
  tag: "p",
  text: "Some body copy that is long enough",
  fontSize: 16,
  lineHeight: 24,
  fontFamily: "Archivo, sans-serif",
  fontWeight: "400",
  color: "rgb(23, 19, 14)",
  letterSpacing: "normal",
  width: 400,
  siblingIndex: 0,
  bgColor: "rgb(255, 255, 255)",
  bgComplex: false,
  selector: "p",
  parentSelector: "body",
  ...over,
});

test("contrast ignores screen-reader-only text", async () => {
  // Same color on same background would be 1:1, but it is sr-only, so not a defect.
  const only = emptySnapshot({
    textNodes: [textNode({ color: "rgb(23, 19, 14)", bgColor: "rgb(23, 19, 14)", visuallyHidden: true })],
  });
  const clean = await run(colorChecks, only);
  assert.equal(clean.findings.filter((f) => f.ruleId === "color.contrast").length, 0);

  // The same node, painted, is a real finding.
  const painted = emptySnapshot({
    textNodes: [textNode({ color: "rgb(23, 19, 14)", bgColor: "rgb(23, 19, 14)" })],
  });
  const bad = await run(colorChecks, painted);
  assert.ok(bad.findings.some((f) => f.ruleId === "color.contrast"));
});

test("focus check passes when a stylesheet defines a focus style", async () => {
  const interactives = Array.from({ length: 6 }, (_, i) => ({
    selector: `a:nth-of-type(${i + 1})`,
    tag: "a",
    text: "Link",
    width: 80,
    height: 24,
    ariaLabel: null,
    hasVisibleFocusHint: false,
  }));
  const styled = emptySnapshot({ interactives, hasFocusStyles: true });
  const ok = await run(accessibilityChecks, styled);
  assert.equal(ok.findings.filter((f) => f.ruleId === "a11y.focus-visible").length, 0);

  const unstyled = emptySnapshot({ interactives, hasFocusStyles: false });
  const bad = await run(accessibilityChecks, unstyled);
  assert.ok(bad.findings.some((f) => f.ruleId === "a11y.focus-visible"));
});

test("hero signature ignores far-down card grids and chrome pill controls", async () => {
  const base = {
    headings: [{ level: 1, text: "A quiet house on the water", selector: "h1" }],
    interactives: [
      { selector: "a.cta", tag: "a", text: "Book", width: 180, height: 48, ariaLabel: null, hasVisibleFocusHint: false, inChrome: false, top: 400 },
      { selector: "a.second", tag: "a", text: "See rooms", width: 120, height: 20, ariaLabel: null, hasVisibleFocusHint: false, inChrome: false, top: 430 },
      { selector: "nav a", tag: "a", text: "Rooms", width: 50, height: 20, ariaLabel: null, hasVisibleFocusHint: false, inChrome: true, top: 20 },
    ],
    sections: [
      { selector: "section.cards", tag: "section", childCount: 3, cardLikeChildren: 3, columns: 3, isGrid: true, textDensity: 0.1, boundingBox: { width: 1200, height: 500, top: 3000 } },
    ],
  };
  const far = await run(layoutChecks, emptySnapshot(base));
  assert.equal(far.findings.filter((f) => f.ruleId === "layout.hero-signature").length, 0);

  const near = await run(
    layoutChecks,
    emptySnapshot({
      ...base,
      sections: [{ ...base.sections[0]!, boundingBox: { width: 1200, height: 500, top: 800 } }],
    }),
  );
  assert.ok(near.findings.some((f) => f.ruleId === "layout.hero-signature"));
});

test("object-fit crop is not reported as image distortion", async () => {
  const img = (objectFit: string) => ({
    src: "/images/a.jpg",
    alt: "A room",
    width: 200,
    height: 100,
    role: null,
    naturalWidth: 400,
    naturalHeight: 400,
    isDataUri: false,
    isSvgPlaceholder: false,
    loading: null,
    objectFit,
  });
  const covered = await run(imageChecks, emptySnapshot({ images: [img("cover"), img("cover")] }));
  assert.equal(covered.findings.filter((f) => f.ruleId === "components.image-upscaled").length, 0);

  const stretched = await run(imageChecks, emptySnapshot({ images: [img("fill"), img("fill")] }));
  assert.ok(stretched.findings.some((f) => f.ruleId === "components.image-upscaled"));
});

test("touch targets use the mobile viewport and exempt inline text links", async () => {
  const link = (inText: boolean, i: number) => ({
    selector: `a:nth-of-type(${i})`,
    tag: "a",
    text: "Read more here",
    width: 90,
    height: 20,
    ariaLabel: null,
    hasVisibleFocusHint: false,
    inText,
  });
  const capture = (links: ReturnType<typeof link>[]) => ({
    width: 375,
    height: 900,
    scrollWidth: 375,
    clientWidth: 375,
    horizontalOverflow: false,
    overflowAmount: 0,
    bodyFontSize: 16,
    interactives: links,
  });
  const inline = await run(
    responsiveChecks,
    emptySnapshot({ captures: [capture([link(true, 1), link(true, 2), link(true, 3)])] }),
  );
  assert.equal(inline.findings.filter((f) => f.ruleId === "responsive.touch-targets").length, 0);

  const standalone = await run(
    responsiveChecks,
    emptySnapshot({ captures: [capture([link(false, 1), link(false, 2), link(false, 3)])] }),
  );
  assert.ok(standalone.findings.some((f) => f.ruleId === "responsive.touch-targets"));
});

test("a check that throws does not crash the run", async () => {
  const registry = new Registry();
  registry.register({
    id: "boom",
    category: "layout",
    title: "boom",
    description: "throws",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run() {
      throw new Error("kaboom");
    },
  });
  const result = await runChecks(
    { kind: "web", label: "t", ref: "t" },
    emptySnapshot(),
    registry.forTarget("web"),
    options(),
  );
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.checkId, "boom");
  assert.equal(result.findings.length, 0);
});
