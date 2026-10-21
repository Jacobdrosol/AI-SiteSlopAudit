import { chromium, type Browser, type Page } from "playwright";
import type {
  ComputedTextNode,
  ColorSample,
  GradientSample,
  HeadingSample,
  IconSample,
  ImageSample,
  InteractiveSample,
  LayoutSection,
  ViewportCapture,
  WebSnapshot,
} from "./snapshot.js";


export interface WebCollectorOptions {
  url: string;
  viewports?: number[];
  timeoutMs?: number;
  fullPage?: boolean;
  screenshotsDir?: string | null;
  userAgent?: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  storageState?: string | Record<string, unknown>;
}

const DEFAULT_VIEWPORTS = [1440, 768, 375];

function uniqueSelector(node: Element): string {
  const el = node as HTMLElement;
  if (el.id) return `#${el.id}`;
  const parts: string[] = [];
  let cursor: Element | null = node;
  let depth = 0;
  while (cursor && cursor.nodeType === 1 && depth < 4) {
    const current: Element = cursor;
    let part = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (parent) {
      const siblings: Element[] = Array.from(parent.children).filter(
        (c) => c.tagName === current.tagName,
      );
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }
    parts.unshift(part);
    cursor = parent;
    depth += 1;
  }
  return parts.join(" > ");
}

function selectorFunctionString(): string {
  return uniqueSelector.toString();
}

async function collectInPage(page: Page): Promise<Omit<WebSnapshot, "url" | "finalUrl" | "statusCode" | "responseHeaders" | "captures" | "generatedAt">> {
  return page.evaluate(`(() => {
    const uniqueSelector = ${selectorFunctionString()};

    function visible(el) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") return false;
      if (Number(cs.opacity) === 0) return false;
      return true;
    }

    function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

    // Clipped / screen-reader-only (e.g. Tailwind .sr-only): real text, never
    // painted. Contrast must not measure it.
    function visuallyHidden(el, cs, r) {
      if (r.width <= 1 || r.height <= 1) return true;
      if (cs.clip && cs.clip !== "auto") return true;
      if (cs.clipPath && cs.clipPath !== "none") return true;
      return false;
    }

    // A visible keyboard-focus style anywhere in the document's stylesheets.
    // Walks @media/@layer/@supports rules too. Cross-origin sheets are skipped.
    function detectFocusStyles() {
      function matches(rule) {
        const sel = rule.selectorText;
        if (sel && sel.indexOf(":focus") !== -1) {
          const st = rule.style;
          const o = st && (st.outline || st.outlineStyle || st.outlineWidth);
          if ((o && o !== "none" && o !== "0px") || (st && st.boxShadow && st.boxShadow !== "none")) return true;
        }
        if (rule.cssRules) {
          for (const k of Array.from(rule.cssRules)) if (matches(k)) return true;
        }
        return false;
      }
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try { rules = sheet.cssRules; } catch (e) { continue; }
        if (!rules) continue;
        for (const rule of Array.from(rules)) if (matches(rule)) return true;
      }
      return false;
    }

    function parseRgba(v) {
      const m = (v || "").match(/rgba?\\(\\s*([\\d.]+)[, ]\\s*([\\d.]+)[, ]\\s*([\\d.]+)(?:\\s*[,/]\\s*([\\d.]+%?))?\\s*\\)/);
      if (!m) return null;
      const a = m[4] ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1;
      return { r: +m[1], g: +m[2], b: +m[3], a };
    }

    const mediaAncestors = new WeakSet();
    const mediaListCache = new WeakMap();
    for (const m of document.querySelectorAll("img, video, canvas")) {
      let a = m.parentElement;
      while (a) { mediaAncestors.add(a); a = a.parentElement; }
    }
    function mediaIn(node) {
      if (!mediaAncestors.has(node)) return null;
      const cached = mediaListCache.get(node);
      if (cached) return cached;
      const list = [...node.querySelectorAll("img, video, canvas")];
      mediaListCache.set(node, list);
      return list;
    }

    const overlays = [...document.querySelectorAll("body *")].filter((o) => {
      const cs = getComputedStyle(o);
      if (cs.position !== "fixed" && cs.position !== "absolute" && cs.position !== "sticky") return false;
      const bg = parseRgba(cs.backgroundColor);
      const hasBg = (bg && bg.a > 0.05) || (cs.backgroundImage && cs.backgroundImage !== "none");
      if (!hasBg) return false;
      const r = o.getBoundingClientRect();
      return r.width > 4 && r.height > 4;
    });

    function coveredByOverlay(el) {
      const tr = el.getBoundingClientRect();
      for (const o of overlays) {
        if (o.contains(el)) continue;
        const or = o.getBoundingClientRect();
        if (
          or.left < tr.right && or.right > tr.left &&
          or.top < tr.bottom && or.bottom > tr.top
        ) {
          return true;
        }
      }
      return false;
    }

    function effectiveBackground(el) {
      let node = el;
      let accumulated = { r: 255, g: 255, b: 255, a: 1 };
      let complex = false;
      const layers = [];
      const tr = el.getBoundingClientRect();
      while (node && node.nodeType === 1) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage && cs.backgroundImage !== "none") complex = true;
        const c = parseRgba(cs.backgroundColor);
        if (c && c.a > 0) layers.push(c);
        if (!complex) {
          const media = mediaIn(node);
          if (media) {
            for (const m of media) {
              const mr = m.getBoundingClientRect();
              if (
                mr.width > 0 && mr.height > 0 &&
                mr.left < tr.right && mr.right > tr.left &&
                mr.top < tr.bottom && mr.bottom > tr.top
              ) {
                complex = true;
                break;
              }
            }
          }
        }
        node = node.parentElement;
      }
      if (!complex && coveredByOverlay(el)) complex = true;
      layers.push({ r: 255, g: 255, b: 255, a: 1 });
      for (let i = layers.length - 1; i >= 0; i--) {
        const top = layers[i];
        if (top.a >= 1) { accumulated = top; continue; }
        accumulated = {
          r: Math.round(top.r * top.a + accumulated.r * (1 - top.a)),
          g: Math.round(top.g * top.a + accumulated.g * (1 - top.a)),
          b: Math.round(top.b * top.a + accumulated.b * (1 - top.a)),
          a: 1,
        };
      }
      return { color: "rgb(" + accumulated.r + ", " + accumulated.g + ", " + accumulated.b + ")", complex };
    }

    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let tn;
    while ((tn = walker.nextNode())) {
      const raw = tn.textContent || "";
      const text = raw.replace(/\\s+/g, " ").trim();
      if (text.length < 2) continue;
      const el = tn.parentElement;
      if (!el || !visible(el)) continue;
      const cs = getComputedStyle(el);
      const fontSize = num(cs.fontSize);
      if (fontSize === null) continue;
      const r = el.getBoundingClientRect();
      const bg = effectiveBackground(el);
      textNodes.push({
        tag: el.tagName.toLowerCase(),
        text: text.slice(0, 400),
        fontSize,
        lineHeight: num(cs.lineHeight),
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        color: cs.color,
        letterSpacing: cs.letterSpacing,
        width: Math.round(r.width),
        siblingIndex: el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0,
        bgColor: bg.color,
        bgComplex: bg.complex,
        selector: uniqueSelector(el),
        parentSelector: el.parentElement ? uniqueSelector(el.parentElement) : null,
        visuallyHidden: visuallyHidden(el, cs, r),
      });
    }

    const colors = [];
    const gradients = [];
    const glassmorphism = [];
    const CSS_PROPS = ["color", "background-color", "border-top-color", "border-bottom-color"];
    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      const sel = uniqueSelector(el);
      for (const prop of CSS_PROPS) {
        const v = cs.getPropertyValue(prop);
        if (!v) continue;
        if (v === "rgba(0, 0, 0, 0)" || v === "transparent") continue;
        colors.push({ selector: sel, property: prop, value: v });
      }
      const bgImage = cs.backgroundImage;
      if (bgImage && bgImage !== "none" && bgImage.includes("gradient")) {
        gradients.push({ selector: sel, backgroundImage: bgImage, textClip: cs.webkitBackgroundClip || cs.backgroundClip || null });
      }
      if ((cs.backdropFilter && cs.backdropFilter !== "none") || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== "none")) {
        glassmorphism.push({ selector: sel, property: "backdrop-filter", value: cs.backdropFilter || cs.webkitBackdropFilter });
      }
    }

    const ICON_HINTS = ["svg", "i", "[class*=\\"icon\\"]", "[data-icon]", "[class*=\\"lucide\\"]", "[class*=\\"fa-\\"]", ".material-icons", "[class*=\\"heroicon\\"]", "[class*=\\"phosphor\\"]", "[class*=\\"radix\\"]"];
    const icons = [];
    for (const el of document.querySelectorAll(ICON_HINTS.join(","))) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      let source = "unknown";
      if (el.tagName.toLowerCase() === "svg") {
        const cls = el.getAttribute("class") || "";
        if (el.getAttribute("data-lucide") || cls.includes("lucide")) source = "lucide";
        else if (cls.includes("fa-") || cls.includes("fas") || cls.includes("far") || cls.includes("fab")) source = "font-awesome";
        else if (cls.includes("heroicon")) source = "heroicons";
        else if (cls.includes("phosphor")) source = "phosphor";
        else if (cls.includes("radix")) source = "radix";
        else if (el.getAttribute("data-icon")) source = "data-icon:" + el.getAttribute("data-icon");
        else source = "inline-svg";
      } else if (el.classList && (el.classList.contains("material-icons") || el.classList.contains("material-symbols-outlined") || el.classList.contains("material-symbols-rounded"))) {
        source = "material-symbols";
      } else if (el.classList && el.classList.contains("fa")) {
        source = "font-awesome";
      }
      icons.push({
        selector: uniqueSelector(el),
        source,
        classes: el.getAttribute("class") || "",
        size: r.width ? Math.round(r.width) : null,
        strokeWidth: cs.strokeWidth || el.getAttribute("stroke-width") || null,
      });
    }

    const images = [];
    for (const el of document.querySelectorAll("img, picture source, [role=img]")) {
      const r = el.getBoundingClientRect();
      const rawSrc = el.getAttribute("src") || el.getAttribute("srcset") || "";
      const isDataUri = rawSrc.startsWith("data:");
      const isSvgPlaceholder = isDataUri && rawSrc.includes("image/svg");
      images.push({
        src: rawSrc,
        alt: el.getAttribute("alt"),
        width: Math.round(r.width),
        height: Math.round(r.height),
        role: el.getAttribute("role"),
        naturalWidth: (el.naturalWidth || 0),
        naturalHeight: (el.naturalHeight || 0),
        isDataUri,
        isSvgPlaceholder,
        loading: el.getAttribute("loading") || null,
        objectFit: getComputedStyle(el).objectFit || null,
      });
    }

    const scriptTags = [...document.querySelectorAll("script[src]")].map((s) => {
      const src = s.getAttribute("src") || "";
      let origin = null;
      try {
        const u = new URL(s.src, location.href);
        if (u.origin !== location.origin) origin = u.origin;
      } catch (e) {}
      return {
        src,
        integrity: s.getAttribute("integrity"),
        origin,
        crossOrigin: origin !== null,
      };
    });

    const linkedResources = [...document.querySelectorAll("link[href]")].map((l) => ({
      href: l.getAttribute("href") || "",
      rel: l.getAttribute("rel") || "",
      integrity: l.getAttribute("integrity"),
    }));

    const forms = [...document.querySelectorAll("form")].map((f) => {
      const action = f.getAttribute("action") || "";
      let abs = action;
      try { abs = new URL(action || location.href, location.href).href; } catch (e) {}
      const method = (f.getAttribute("method") || "get").toLowerCase();
      const hasPassword = !!f.querySelector('input[type="password"]');
      return {
        action: abs,
        method,
        secure: abs.startsWith("https:") || abs.startsWith("/") || abs.startsWith("mailto:") || action === "",
        hasPassword,
        passwordOverHttp: hasPassword && abs.startsWith("http://"),
      };
    });

    const interactives = [];
    for (const el of document.querySelectorAll("a, button, input, select, textarea, [role=button], [tabindex]")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const focusHint = (cs.outlineStyle !== "none" && cs.outlineStyle !== "") || el.matches(":focus-visible");
      interactives.push({
        selector: uniqueSelector(el),
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120),
        width: Math.round(r.width),
        height: Math.round(r.height),
        ariaLabel: el.getAttribute("aria-label"),
        hasVisibleFocusHint: !!focusHint,
        inChrome: !!el.closest("header, nav, footer"),
        top: Math.round(r.top),
      });
    }

    const headings = [];
    for (const el of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
      if (!visible(el)) continue;
      headings.push({
        level: Number(el.tagName[1]),
        text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 160),
        selector: uniqueSelector(el),
      });
    }

    const sections = [];
    for (const el of document.querySelectorAll("section, main > div, body > div > div, [class*=\\"grid\\"], [class*=\\"cards\\"], [class*=\\"features\\"]")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 40) continue;
      const cs = getComputedStyle(el);
      const isGrid = cs.display.includes("grid") || cs.display.includes("flex");
      const children = [...el.children].filter(c => { const cr = c.getBoundingClientRect(); return cr.width > 40 && cr.height > 40; });
      let cardLike = 0;
      for (const c of children) {
        const ccs = getComputedStyle(c);
        const radius = parseFloat(ccs.borderRadius) || 0;
        const shadow = ccs.boxShadow && ccs.boxShadow !== "none";
        const border = ccs.borderTopWidth && parseFloat(ccs.borderTopWidth) > 0;
        if (radius > 4 || shadow || border) cardLike++;
      }
      const cols = cs.gridTemplateColumns ? cs.gridTemplateColumns.split(" ").filter(Boolean).length : 1;
      const area = r.width * r.height;
      sections.push({
        selector: uniqueSelector(el),
        tag: el.tagName.toLowerCase(),
        childCount: children.length,
        cardLikeChildren: cardLike,
        columns: cols,
        isGrid,
        textDensity: area > 0 ? ((el.textContent || "").trim().length / area) * 1000 : 0,
        boundingBox: { width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top) },
      });
    }

    const animations = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.animationName && cs.animationName !== "none") {
        animations.push({ selector: uniqueSelector(el), animationName: cs.animationName, duration: cs.animationDuration });
      }
    }

    const cssVariables = {};
    const rootStyles = getComputedStyle(document.documentElement);
    for (let i = 0; i < rootStyles.length; i++) {
      const prop = rootStyles[i];
      if (prop.startsWith("--")) cssVariables[prop] = rootStyles.getPropertyValue(prop).trim();
    }

    const stylesheets = [...document.querySelectorAll("link[rel=stylesheet]")].map(l => l.getAttribute("href") || "");
    const scriptSources = [...document.querySelectorAll("script[src]")].map(s => s.getAttribute("src") || "");
    let inlineScriptBytes = 0;
    for (const s of document.querySelectorAll("script:not([src])")) inlineScriptBytes += (s.textContent || "").length;

    function scanMotifs() {
      const txt = (el) => (el.textContent || "").replace(/\\s+/g, " ").trim();
      const interactive = (el) => !!el.closest("a,button,input,select,textarea,[role=button]");
      const samples = [];
      let eyebrowBadges = 0, iconTiles = 0, stepLabels = 0, chipRows = 0, chipCount = 0, headingIcons = 0, bicolorHeadings = 0;

      for (const el of document.querySelectorAll("span,div,p")) {
        if (el.children.length) continue;
        if (interactive(el)) continue;
        const t = txt(el);
        if (t.length < 3 || t.length > 46) continue;
        const c = getComputedStyle(el);
        const fs = parseFloat(c.fontSize);
        if (fs > 15 || fs < 9) continue;
        const tint = c.backgroundColor !== "rgba(0, 0, 0, 0)";
        const border = parseFloat(c.borderTopWidth) > 0;
        const up = c.textTransform === "uppercase";
        const spaced = parseFloat(c.letterSpacing) > 0.4;
        if (tint || border || up || spaced) {
          eyebrowBadges++;
          if (samples.length < 12) samples.push("eyebrow: " + t.slice(0, 30));
        }
      }
      for (const el of document.querySelectorAll("div,span,li")) {
        const svg = el.querySelector(":scope > svg");
        if (!svg || el.children.length > 2) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 28 || r.width > 76 || Math.abs(r.width - r.height) > 6) continue;
        const c = getComputedStyle(el);
        if (parseFloat(c.borderRadius) >= 6 || c.backgroundColor !== "rgba(0, 0, 0, 0)") {
          iconTiles++;
          if (samples.length < 12) samples.push("icon-tile " + Math.round(r.width) + "px");
        }
      }
      stepLabels = [...document.querySelectorAll("*")].filter(
        (e) => e.children.length === 0 && /^(step|stage|phase)\\s*\\d+/i.test(txt(e)),
      ).length;
      for (const parent of document.querySelectorAll("div,ul,section,nav")) {
        const chips = [...parent.children].filter((k) => {
          const r = k.getBoundingClientRect();
          if (r.height <= 14 || r.height > 44 || r.width < 20 || r.width > 220) return false;
          const c = getComputedStyle(k);
          const bordered = c.borderTopWidth !== "0px" || c.backgroundColor !== "rgba(0, 0, 0, 0)";
          const t = txt(k);
          return bordered && t.length > 0 && t.length <= 22;
        });
        if (chips.length >= 4) {
          chipRows++;
          chipCount += chips.length;
          if (samples.length < 12) samples.push("chip-row x" + chips.length);
        }
      }
      for (const h of document.querySelectorAll("h1,h2,h3,h4")) {
        const pv = h.previousElementSibling;
        if (h.querySelector("svg") || (pv && pv.querySelector && pv.querySelector("svg"))) headingIcons++;
      }
      for (const h of document.querySelectorAll("h1,h2,h3")) {
        const kids = [...h.children];
        const colors = new Set(kids.map((k) => getComputedStyle(k).color));
        if (kids.length >= 2 && colors.size >= 2) bicolorHeadings++;
      }

      const kindCount = [eyebrowBadges, iconTiles, stepLabels, chipRows, headingIcons, bicolorHeadings].filter((n) => n > 0).length;
      const total = eyebrowBadges + iconTiles + stepLabels + chipRows + headingIcons + bicolorHeadings;
      return { eyebrowBadges, iconTiles, stepLabels, chipRows, chipCount, headingIcons, bicolorHeadings, kindCount, total, samples };
    }

    const motifs = scanMotifs();

    return {
      title: document.title,
      metaDescription: document.querySelector("meta[name=description]")?.getAttribute("content") || null,
      viewportMeta: document.querySelector("meta[name=viewport]")?.getAttribute("content") || null,
      lang: document.documentElement.getAttribute("lang"),
      textNodes, colors, gradients, icons, images, interactives, headings, sections,
      animations, glassmorphism, cssVariables, hasFocusStyles: detectFocusStyles(),
      motifs, stylesheets, scriptSources,
      scriptTags, linkedResources, forms, inlineScriptBytes,
    };
  })()`) as Promise<Omit<WebSnapshot, "url" | "finalUrl" | "statusCode" | "responseHeaders" | "captures" | "generatedAt">>;
}

// Scroll the whole page once so lazy-loaded images request and decode, then
// return to the top. Without this, anything below the fold is captured with
// naturalWidth 0 and looks "broken".
async function settleLazyContent(page: Page): Promise<void> {
  try {
    await page.evaluate(`(async () => {
      const pageHeight = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y < pageHeight(); y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 70));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 60));
      const imgs = Array.from(document.images);
      await Promise.all(imgs.map((img) => img.complete ? Promise.resolve() : new Promise((res) => {
        img.addEventListener("load", () => res(), { once: true });
        img.addEventListener("error", () => res(), { once: true });
        setTimeout(res, 3000);
      })));
    })()`);
  } catch {
    // Best effort: never fail a collection because a scroll trick did not run.
  }
}

async function captureViewport(
  page: Page,
  width: number,
  screenshotsDir: string | null,
  fullPage: boolean,
): Promise<ViewportCapture> {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(250);
  const metrics = (await page.evaluate(`(() => {
    const doc = document.documentElement;
    const body = document.body;
    const bodyCs = getComputedStyle(body);
    const bodyScroll = body ? body.scrollWidth : 0;
    const docScroll = doc.scrollWidth;
    const client = doc.clientWidth;
    // Real overflow is the largest of document and body scroll widths. A page
    // can hide overflow with overflow-x:hidden on the body, in which case the
    // document scroll width stays at the viewport width while body content is
    // still wider and clipped. Measure both so clipped content is caught.
    const scrollWidth = Math.max(docScroll, bodyScroll);
    return {
      scrollWidth,
      clientWidth: client,
      docScroll,
      bodyScroll,
      overflowHidden: bodyCs.overflowX === "hidden",
      bodyFontSize: parseFloat(bodyCs.fontSize) || 16,
    };
  })()`)) as {
    scrollWidth: number;
    clientWidth: number;
    docScroll: number;
    bodyScroll: number;
    overflowHidden: boolean;
    bodyFontSize: number;
  };

  const horizontalOverflow = metrics.scrollWidth > metrics.clientWidth + 1;
  const capture: ViewportCapture = {
    width,
    height: 900,
    scrollWidth: metrics.scrollWidth,
    clientWidth: metrics.clientWidth,
    horizontalOverflow,
    overflowAmount: Math.max(0, metrics.scrollWidth - metrics.clientWidth),
    clipped: metrics.overflowHidden && horizontalOverflow,
    bodyFontSize: metrics.bodyFontSize,
  };

  // Size the interactive controls as they render at this width, so the
  // touch-target check can judge the mobile layout rather than the desktop one.
  capture.interactives = (await page
    .evaluate(`(() => {
    const uniqueSelector = ${selectorFunctionString()};
    const out = [];
    for (const el of document.querySelectorAll("a, button, input, select, textarea, [role=button], [tabindex]")) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
      out.push({
        selector: uniqueSelector(el),
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120),
        width: Math.round(r.width),
        height: Math.round(r.height),
        ariaLabel: el.getAttribute("aria-label"),
        hasVisibleFocusHint: false,
        inText: !!el.closest("p, li, blockquote, figcaption, td, dd"),
      });
    }
    return out;
  })()`)
    .catch(() => [])) as InteractiveSample[];

  if (screenshotsDir) {
    const path = `${screenshotsDir}/viewport-${width}.png`;
    await page.screenshot({ path, fullPage });
    capture.screenshot = path;
  }
  return capture;
}

export async function collectWebSnapshot(
  options: WebCollectorOptions,
): Promise<WebSnapshot> {
  const viewports = options.viewports ?? DEFAULT_VIEWPORTS;
  const timeout = options.timeoutMs ?? 30000;
  const browser: Browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: viewports[0] ?? 1440, height: 900 },
      userAgent: options.userAgent,
      ...(options.storageState ? { storageState: options.storageState as never } : {}),
    });
    const page = await context.newPage();
    let statusCode: number | null = null;
    let responseHeaders: Record<string, string> = {};
    page.on("response", (res) => {
      if (res.url() === options.url || res.request().resourceType() === "document") {
        if (statusCode === null) {
          statusCode = res.status();
          responseHeaders = res.headers();
        }
      }
    });

    await page.goto(options.url, {
      waitUntil: options.waitUntil ?? "load",
      timeout,
    });
    try {
      await page.waitForLoadState("networkidle", { timeout: 8000 });
    } catch {
      // networkidle is best-effort
    }
    await page.waitForTimeout(500);
    await settleLazyContent(page);

    const base = await collectInPage(page);
    const captures: ViewportCapture[] = [];
    for (const vw of viewports) {
      captures.push(
        await captureViewport(page, vw, options.screenshotsDir ?? null, options.fullPage ?? false),
      );
    }

    return {
      url: options.url,
      finalUrl: page.url(),
      statusCode,
      responseHeaders,
      captures,
      generatedAt: new Date().toISOString(),
      ...base,
    };
  } finally {
    await browser.close();
  }
}
