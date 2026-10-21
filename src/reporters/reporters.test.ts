import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHtml } from "./html.js";
import { renderJson } from "./json.js";
import type { AuditReport } from "../core/report.js";
import { scoreFindings } from "../core/scoring.js";
import { resolveConfig } from "../core/config.js";

function reportWith(malicious: string): AuditReport {
  const config = resolveConfig("default");
  const findings = [
    {
      ruleId: "content.emoji",
      category: "content" as const,
      severity: "medium" as const,
      title: malicious,
      detail: malicious,
      fix: malicious,
      location: malicious,
      evidence: [{ label: malicious, value: malicious }],
    },
  ];
  return {
    tool: "slopaudit",
    version: "0.0.0",
    target: { kind: "web", label: malicious, ref: malicious },
    profile: "default",
    generatedAt: new Date(0).toISOString(),
    durationMs: 1,
    deterministic: scoreFindings(findings, config, ["content"]),
    llm: null,
    checks: [],
    findings,
    warnings: [malicious],
    metadata: {},
  };
}

function reportWithMany(n: number): AuditReport {
  const config = resolveConfig("default");
  const findings = Array.from({ length: n }, (_, i) => ({
    ruleId: i % 2 === 0 ? "layout.hero-signature" : "type.default-font",
    category: (i % 2 === 0 ? "layout" : "typography") as "layout" | "typography",
    severity: "medium" as const,
    title: `Finding number ${i}`,
    detail: `Detail for finding ${i}.`,
    fix: `Fix for finding ${i}`,
    evidence: [{ label: `evidence-${i}` }],
  }));
  return {
    tool: "slopaudit",
    version: "0.0.0",
    target: { kind: "web", label: "t", ref: "https://t.example" },
    profile: "default",
    generatedAt: new Date(0).toISOString(),
    durationMs: 1,
    deterministic: scoreFindings(findings, config, ["layout", "typography"]),
    llm: null,
    checks: [],
    findings,
    warnings: [],
    metadata: {},
  };
}

test("HTML report includes every finding, not just the top ones", () => {
  const report = reportWithMany(40);
  const html = renderHtml(report);
  // 15 priority + 40 full breakdown.
  const cards = (html.match(/class="finding /g) ?? []).length;
  assert.equal(cards, 15 + 40, "all findings must be rendered");
  assert.ok(html.includes("Finding number 39"), "the last finding is present");
  assert.ok(html.includes("Full breakdown"), "the full breakdown section exists");
});

test("HTML report shows a fix for every finding that has one", () => {
  const report = reportWithMany(20);
  const html = renderHtml(report);
  const fixes = (html.match(/class="fix"/g) ?? []).length;
  assert.ok(fixes >= 20, "at least one fix per finding rendered");
});

test("HTML report escapes untrusted site content", () => {
  const payload = `<script>alert("xss")</script><img src=x onerror=alert(1)>`;
  const html = renderHtml(reportWith(payload));
  assert.ok(!html.includes("<script>alert"), "raw script tag must not survive");
  assert.ok(!html.includes("<img src=x"), "raw img tag must not survive");
  assert.ok(html.includes("&lt;script&gt;"), "payload should be escaped");
});

test("JSON report is valid JSON even with hostile strings", () => {
  const payload = `"><script>alert(1)</script>`;
  const json = renderJson(reportWith(payload));
  const parsed = JSON.parse(json) as { target: { ref: string } };
  assert.equal(parsed.target.ref, payload);
});
