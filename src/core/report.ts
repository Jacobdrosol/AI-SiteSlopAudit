import type {
  AuditTarget,
  Category,
  Finding,
  Severity,
} from "./types.js";
import type { GradeResult } from "./scoring.js";

export interface LlmFinding {
  category: string;
  severity: Severity;
  title: string;
  detail: string;
  fix?: string;
}

export interface LlmResult {
  enabled: boolean;
  model: string | null;
  score: number | null;
  grade: string | null;
  summary: string | null;
  findings: LlmFinding[];
  error?: string;
  durationMs?: number;
}

export interface AuditReport {
  tool: string;
  version: string;
  target: AuditTarget;
  profile: string;
  generatedAt: string;
  durationMs: number;
  deterministic: GradeResult;
  llm: LlmResult | null;
  checks: Array<{
    checkId: string;
    category: Category;
    ok: boolean;
    findings: number;
    durationMs?: number;
    error?: string;
  }>;
  findings: Finding[];
  warnings: string[];
  metadata: Record<string, unknown>;
}
