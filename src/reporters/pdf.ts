import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

// Render an HTML report file to PDF, so an audit can be printed or archived.
// Opens every collapsed section (e.g. check coverage) first so the PDF contains
// the full report, not just the visible-on-screen parts.
export async function renderPdf(htmlPath: string, pdfPath: string): Promise<void> {
  await fs.access(htmlPath);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      for (const d of Array.from(document.querySelectorAll("details"))) {
        (d as HTMLDetailsElement).open = true;
      }
    });
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
    });
  } finally {
    await browser.close();
  }
}
