export type TargetKind = "web" | "code" | "desktop" | "native";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Category =
  | "layout"
  | "typography"
  | "color"
  | "content"
  | "components"
  | "responsive"
  | "accessibility"
  | "security"
  | "code"
  | "dependencies"
  | "performance";

export const SEVERITIES: Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export const CATEGORIES: Category[] = [
  "layout",
  "typography",
  "color",
  "content",
  "components",
  "responsive",
  "accessibility",
  "security",
  "code",
  "dependencies",
  "performance",
];

export interface Evidence {
  label: string;
  value?: string;
  selector?: string;
  file?: string;
  line?: number;
}

export interface Finding {
  ruleId: string;
  category: Category;
  severity: Severity;
  title: string;
  detail: string;
  evidence?: Evidence[];
  fix?: string;
  location?: string;
  confidence?: number;
}

export interface CheckResult {
  checkId: string;
  ok: boolean;
  findings: Finding[];
  note?: string;
  durationMs?: number;
  error?: string;
}

export interface CheckMeta {
  id: string;
  category: Category;
  title: string;
  description: string;
  defaultSeverity: Severity;
  appliesTo: TargetKind[];
  tags?: string[];
}

export interface AuditTarget {
  kind: TargetKind;
  label: string;
  ref: string;
}

export interface AuditOptions {
  profile: string;
  categories: Category[];
  disabledRules: string[];
  config: ResolvedConfig;
}

export interface CheckContext<C = unknown> {
  target: AuditTarget;
  options: AuditOptions;
  data: C;
}

export interface Check<C = unknown> extends CheckMeta {
  run(ctx: CheckContext<C>): Promise<Finding[]> | Finding[];
}

export interface RuleSetting {
  enabled?: boolean;
  severity?: Severity;
  weight?: number;
}

export interface ResolvedConfig {
  profile: string;
  severityPenalties: Record<Severity, number>;
  categoryWeights: Record<Category, number>;
  ruleDecay: number;
  worstCategoryWeight: number;
  breadthPenalty: number;
  /** Additive slop points per rule id; absent rules use the category default. */
  slopWeights: Record<string, number>;
  /** Fraction of a rule's weight added for each repeat after the first. */
  instanceDecay: number;
  rules: Record<string, RuleSetting>;
}
