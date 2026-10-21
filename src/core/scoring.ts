import type {
  Category,
  Finding,
  ResolvedConfig,
  Severity,
} from "./types.js";
import { CATEGORIES } from "./types.js";
import { DEFAULT_CATEGORY_SLOP } from "./config.js";

export interface RuleGroupScore {
  ruleId: string;
  category: Category;
  count: number;
  /** Slop points this rule contributed in total. */
  effectivePenalty: number;
}

export interface CategoryScore {
  category: Category;
  /** Quality for this category, 0-100 (100 = clean). */
  score: number;
  /** Slop points this category contributed. */
  penalty: number;
  weight: number;
  findings: number;
  rules: RuleGroupScore[];
}

export interface GradeResult {
  /** Overall quality score, 0-100. Higher is better. */
  score: number;
  grade: string;
  /** Total slop points subtracted to reach the score. */
  slopPoints: number;
  categories: CategoryScore[];
  topFindings: ScoringFinding[];
  counts: Record<Severity, number>;
  totalFindings: number;
  worstCategoryScore: number;
  weightedAverage: number;
  breadth: number;
}

export interface ScoringFinding extends Finding {
  /** Slop points this finding contributed (after repeats and multipliers). */
  effectivePenalty: number;
  weightMultiplier: number;
}

// Quality bands. Higher score = less slop. This is a quality score, not a
// slop score: 100 means no signals were found, and a real, well-built site can
// plausibly reach the 90s because ordinary hygiene issues barely move it.
const GRADE_BANDS: Array<{ min: number; grade: string; label: string }> = [
  { min: 90, grade: "A", label: "hand-crafted" },
  { min: 78, grade: "B", label: "mostly built" },
  { min: 64, grade: "C", label: "showing slop" },
  { min: 50, grade: "D", label: "vibe-coded" },
  { min: 0, grade: "F", label: "pure slop" },
];

export function toGrade(score: number): string {
  for (const band of GRADE_BANDS) {
    if (score >= band.min) return band.grade;
  }
  return "F";
}

export function gradeLabel(score: number): string {
  for (const band of GRADE_BANDS) {
    if (score >= band.min) return band.label;
  }
  return "pure slop";
}

function slopWeight(config: ResolvedConfig, ruleId: string, category: Category): number {
  const explicit = config.slopWeights[ruleId];
  if (explicit !== undefined) return explicit;
  return DEFAULT_CATEGORY_SLOP[category] ?? 1;
}

export function scoreFindings(
  findings: Finding[],
  config: ResolvedConfig,
  auditedCategories: Category[],
): GradeResult {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  const scored: ScoringFinding[] = findings.map((f) => {
    const ruleSetting = config.rules[f.ruleId];
    const severity = ruleSetting?.severity ?? f.severity;
    const weightMultiplier = ruleSetting?.weight ?? 1;
    const confidence = Math.max(0, Math.min(1, f.confidence ?? 1));
    const base = slopWeight(config, f.ruleId, f.category);
    counts[severity] += 1;
    return {
      ...f,
      severity,
      effectivePenalty: base * weightMultiplier * confidence,
      weightMultiplier,
      confidence,
    };
  });

  const byCategory = new Map<Category, ScoringFinding[]>();
  for (const f of scored) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }

  const active = auditedCategories.filter(
    (c, i) => auditedCategories.indexOf(c) === i,
  );

  let totalSlop = 0;
  const categories: CategoryScore[] = active.map((category) => {
    const list = byCategory.get(category) ?? [];
    const groupMap = new Map<string, ScoringFinding[]>();
    for (const f of list) {
      const g = groupMap.get(f.ruleId) ?? [];
      g.push(f);
      groupMap.set(f.ruleId, g);
    }
    const rules: RuleGroupScore[] = [];
    let categorySlop = 0;
    for (const [ruleId, group] of groupMap) {
      const base = group[0]!.effectivePenalty;
      // The first instance counts fully; each repeat adds a fraction, so the
      // same tell repeated many times matters but does not scale linearly.
      const total = base * (1 + (group.length - 1) * config.instanceDecay);
      categorySlop += total;
      rules.push({
        ruleId,
        category,
        count: group.length,
        effectivePenalty: Math.round(total * 10) / 10,
      });
    }
    totalSlop += categorySlop;
    return {
      category,
      score: Math.round(Math.max(0, 100 - categorySlop) * 10) / 10,
      penalty: Math.round(categorySlop * 10) / 10,
      weight: config.categoryWeights[category] ?? 1,
      findings: list.length,
      rules: rules.sort((a, b) => b.effectivePenalty - a.effectivePenalty),
    };
  });

  const score = Math.round(Math.max(0, Math.min(100, 100 - totalSlop)) * 10) / 10;

  const weightSum = categories.reduce((s, c) => s + c.weight, 0);
  const weightedAverage =
    weightSum === 0
      ? 100
      : categories.reduce((s, c) => s + c.score * c.weight, 0) / weightSum;
  const worstCategoryScore = categories.reduce((min, c) => Math.min(min, c.score), 100);
  const dirty = categories.filter((c) => c.score < 99.5).length;
  const breadth = categories.length === 0 ? 0 : dirty / categories.length;

  const topFindings = [...scored]
    .filter((f) => f.effectivePenalty > 0)
    .sort((a, b) => b.effectivePenalty - a.effectivePenalty)
    .slice(0, 15);

  return {
    score,
    grade: toGrade(score),
    slopPoints: Math.round(totalSlop * 10) / 10,
    categories: categories.sort((a, b) => a.score - b.score),
    topFindings,
    counts,
    totalFindings: findings.length,
    worstCategoryScore: Math.round(worstCategoryScore * 10) / 10,
    weightedAverage: Math.round(weightedAverage * 10) / 10,
    breadth: Math.round(breadth * 100) / 100,
  };
}

export function emptyCategories(): Category[] {
  return [...CATEGORIES];
}
