import type {
  AuditOptions,
  AuditTarget,
  Category,
  Check,
  CheckResult,
  Finding,
} from "./types.js";

export interface AuditRunResult {
  target: AuditTarget;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results: CheckResult[];
  findings: Finding[];
  errors: Array<{ checkId: string; error: string }>;
}

export interface RunHooks {
  onCheckStart?(check: Check): void;
  onCheckDone?(result: CheckResult): void;
}

export async function runChecks<C>(
  target: AuditTarget,
  data: C,
  checks: Check[],
  options: AuditOptions,
  hooks: RunHooks = {},
): Promise<AuditRunResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const results: CheckResult[] = [];
  const findings: Finding[] = [];
  const errors: Array<{ checkId: string; error: string }> = [];

  for (const check of checks) {
    if (!check.appliesTo.includes(target.kind)) continue;
    if (options.disabledRules.includes(check.id)) continue;
    const ruleSetting = options.config.rules[check.id];
    if (ruleSetting?.enabled === false) continue;
    if (!options.categories.includes(check.category)) continue;

    hooks.onCheckStart?.(check);
    const checkStart = Date.now();
    try {
      const raw = await check.run({ target, options, data });
      const produced: Finding[] = raw.map((f) => ({
        ...f,
        confidence: f.confidence ?? 1,
        severity: options.config.rules[f.ruleId]?.severity ?? f.severity,
      }));
      const result: CheckResult = {
        checkId: check.id,
        ok: true,
        findings: produced,
        durationMs: Date.now() - checkStart,
      };
      results.push(result);
      findings.push(...produced);
      hooks.onCheckDone?.(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result: CheckResult = {
        checkId: check.id,
        ok: false,
        findings: [],
        error: message,
        durationMs: Date.now() - checkStart,
      };
      results.push(result);
      errors.push({ checkId: check.id, error: message });
      hooks.onCheckDone?.(result);
    }
  }

  const finished = Date.now();
  return {
    target,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    results,
    findings,
    errors,
  };
}
