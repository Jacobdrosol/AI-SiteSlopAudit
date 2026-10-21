import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { WebSnapshot } from "../snapshot.js";

// Deterministic imagery checks. These measure what an image *is* and how it is
// used, not what it depicts. Judging whether a photo looks AI-generated or
// generic needs a vision model and belongs in the separate model tier; this file
// catches the objective problems: broken and placeholder images, stock assets
// with no attribution, upscaled/blurry images, and image-heavy pages.

const STOCK_SOURCES: Array<{ re: RegExp; label: string }> = [
  { re: /pexels\.com|images\.pexels/i, label: "Pexels" },
  { re: /unsplash\.com|images\.unsplash/i, label: "Unsplash" },
  { re: /shutterstock\.com|shutterstock\./i, label: "Shutterstock" },
  { re: /istockphoto\.com/i, label: "iStock" },
  { re: /gettyimages\.com|media\.gettyimages/i, label: "Getty Images" },
  { re: /stock\.adobe\.com|adobestock/i, label: "Adobe Stock" },
  { re: /depositphotos\.com/i, label: "Depositphotos" },
  { re: /dreamstime\.com/i, label: "Dreamstime" },
  { re: /alamy\.com/i, label: "Alamy" },
  { re: /stocksy\.com/i, label: "Stocksy" },
  { re: /pond5\.com/i, label: "Pond5" },
  { re: /vectorstock\.com/i, label: "VectorStock" },
  { re: /freepik\.com/i, label: "Freepik" },
  { re: /envato|elements\.envato/i, label: "Envato" },
];

const PLACEHOLDER_SOURCES =
  /placehold\.co|placeholder\.com|via\.placeholder|dummyimage|loremflickr|lorempixel|placekitten|picsum\.photos|placeimg/i;

export const imageChecks = [
  defineCheck<WebSnapshot>({
    id: "components.placeholder-image",
    category: "components",
    title: "Broken or placeholder images",
    description:
      "Images that failed to load, or that are stand-in placeholder assets shipped to production.",
    defaultSeverity: "high",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const broken = data.images.filter(
        (i) =>
          i.width > 8 &&
          i.height > 8 &&
          i.naturalWidth === 0 &&
          !i.isSvgPlaceholder &&
          !i.src.startsWith("data:"),
      );
      const svgPlaceholders = data.images.filter(
        (i) => i.isSvgPlaceholder && i.width > 8 && i.height > 8,
      );
      const placeholderService = data.images.filter((i) =>
        PLACEHOLDER_SOURCES.test(i.src),
      );
      const findings: Finding[] = [];
      if (broken.length > 0) {
        findings.push({
          ruleId: "components.placeholder-image",
          category: "components",
          severity: broken.length >= 4 ? "high" : "medium",
          title: `${broken.length} broken image(s)`,
          detail: `${broken.length} image(s) occupy space but their source never loaded (natural size 0). Visitors see empty boxes or broken-image icons where the design intended a picture.`,
          evidence: broken.slice(0, 6).map((i) => ({
            label: i.src.split("/").pop()?.slice(0, 60) || i.src.slice(0, 60),
            selector: i.src.slice(0, 90),
            value: `${i.width}x${i.height}`,
          })),
          fix: "Fix or remove the image source, and give the element a fallback or a sized placeholder.",
        });
      }
      if (svgPlaceholders.length > 0) {
        findings.push({
          ruleId: "components.placeholder-image",
          category: "components",
          severity: svgPlaceholders.length >= 4 ? "medium" : "low",
          title: `${svgPlaceholders.length} inline placeholder image(s)`,
          detail: `${svgPlaceholders.length} image(s) are inline SVG placeholders (data URIs), the stand-in a lazy-load library shows before the real asset arrives. If the real image never resolves, these are the empty or generic boxes on the page.`,
          evidence: svgPlaceholders.slice(0, 6).map((i) => ({
            label: "placeholder svg",
            value: `${i.width}x${i.height} alt=${JSON.stringify(i.alt)}`,
          })),
          fix: "Confirm every lazy-loaded image resolves, or replace the placeholder with a real asset.",
        });
      }
      if (placeholderService.length > 0) {
        findings.push({
          ruleId: "components.placeholder-image",
          category: "components",
          severity: "high",
          title: `${placeholderService.length} placeholder-service image(s) in production`,
          detail: `Images are served from a placeholder service: ${placeholderService
            .slice(0, 4)
            .map((i) => i.src.slice(0, 60))
            .join(", ")}. A placeholder service returns a stock gray box or a random photo, not the product's content.`,
          evidence: placeholderService.slice(0, 5).map((i) => ({
            label: i.src.slice(0, 80),
          })),
          fix: "Replace the placeholder service URL with the real image asset.",
        });
      }
      return findings;
    },
  }),

  defineCheck<WebSnapshot>({
    id: "components.stock-photo",
    category: "components",
    title: "Stock / library photography",
    description:
      "Images loaded from a stock-photo service, often generic and unattributed.",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const hits = data.images.filter((i) => STOCK_SOURCES.some((s) => s.re.test(i.src)));
      if (hits.length === 0) return [];
      const services = [
        ...new Set(
          hits.flatMap((i) =>
            STOCK_SOURCES.filter((s) => s.re.test(i.src)).map((s) => s.label),
          ),
        ),
      ];
      return [
        {
          ruleId: "components.stock-photo",
          category: "components",
          severity: hits.length >= 4 ? "medium" : "low",
          title: `${hits.length} stock photo(s)`,
          detail: `${hits.length} image(s) come from ${services.join(", ")}. Generic stock photography is the visual equivalent of filler copy, and it needs a license. Not always wrong, but it is a tell when it replaces a real product or team photo.`,
          evidence: hits.slice(0, 6).map((i) => ({
            label: services[STOCK_SOURCES.findIndex((s) => s.re.test(i.src))] ?? "stock",
            value: i.src.split("/").pop()?.slice(0, 50) || i.src.slice(0, 50),
          })),
          fix: "Replace with real imagery of the product, place or people where possible; keep and attribute stock only where it earns its place.",
        },
      ];
    },
  }),

  defineCheck<WebSnapshot>({
    id: "components.image-upscaled",
    category: "components",
    title: "Upscaled or distorted images",
    description:
      "Images displayed larger than their natural size (blurry) or stretched from their aspect ratio.",
    defaultSeverity: "low",
    appliesTo: ["web"],
    run({ data }): Finding[] {
      const upscaled: typeof data.images = [];
      const distorted: typeof data.images = [];
      for (const i of data.images) {
        if (i.naturalWidth === 0 || i.isDataUri) continue;
        if (i.width > i.naturalWidth * 1.25 && i.naturalWidth > 16) {
          upscaled.push(i);
        }
        const natRatio = i.naturalWidth / i.naturalHeight;
        const dispRatio = i.width / Math.max(1, i.height);
        // object-fit cover/contain/scale-down crop or letterbox on purpose, so
        // a display aspect that differs from the natural one is not distortion.
        const crops =
          i.objectFit === "cover" ||
          i.objectFit === "contain" ||
          i.objectFit === "scale-down" ||
          i.objectFit === "none";
        if (
          !crops &&
          i.naturalHeight > 0 &&
          i.width > 48 &&
          Math.abs(natRatio - dispRatio) / natRatio > 0.15
        ) {
          distorted.push(i);
        }
      }
      const findings: Finding[] = [];
      if (upscaled.length >= 2) {
        findings.push({
          ruleId: "components.image-upscaled",
          category: "components",
          severity: "low",
          title: `${upscaled.length} upscaled image(s)`,
          detail: `${upscaled.length} image(s) render wider than their real pixel width, so they are stretched and blurry. Example: a ${upscaled[0]!.naturalWidth}px-wide file shown at ${upscaled[0]!.width}px.`,
          evidence: upscaled.slice(0, 5).map((i) => ({
            label: i.src.split("/").pop()?.slice(0, 50) || "image",
            value: `${i.naturalWidth}px → ${i.width}px`,
          })),
          fix: "Export the image at the size it is displayed, or serve a larger source.",
        });
      }
      if (distorted.length >= 2) {
        findings.push({
          ruleId: "components.image-upscaled",
          category: "components",
          severity: "low",
          title: `${distorted.length} distorted image(s)`,
          detail: `${distorted.length} image(s) are stretched away from their natural aspect ratio, which squashes or elongates the subject.`,
          evidence: distorted.slice(0, 5).map((i) => ({
            label: i.src.split("/").pop()?.slice(0, 50) || "image",
            value: `${i.naturalWidth}x${i.naturalHeight} → ${i.width}x${i.height}`,
          })),
          fix: "Use object-fit: cover with a fixed aspect ratio instead of forcing width and height.",
        });
      }
      return findings;
    },
  }),
];
