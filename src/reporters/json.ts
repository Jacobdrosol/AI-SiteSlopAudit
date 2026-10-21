import type { AuditReport } from "../core/report.js";

export function renderJson(report: AuditReport, pretty = true): string {
  const payload = {
    $schema: "https://raw.githubusercontent.com/slopaudit/slopaudit/main/schema/report.schema.json",
    tool: report.tool,
    version: report.version,
    generatedAt: report.generatedAt,
    target: report.target,
    profile: report.profile,
    durationMs: report.durationMs,
    deterministic: report.deterministic,
    llm: report.llm,
    checks: report.checks,
    findings: report.findings,
    warnings: report.warnings,
    metadata: report.metadata,
  };
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}
