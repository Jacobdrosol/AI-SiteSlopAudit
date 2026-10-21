import type {
  Category,
  ResolvedConfig,
  RuleSetting,
  Severity,
} from "./types.js";

export type { ResolvedConfig };

export interface Profile {
  name: string;
  description: string;
  severityPenalties: Record<Severity, number>;
  categoryWeights: Record<Category, number>;
  ruleDecay: number;
  /** 0-1: how much the single worst category drags the overall score. */
  worstCategoryWeight: number;
  /** 0-1: penalty applied in proportion to how many categories have findings. */
  breadthPenalty: number;
}

// Additive slop points per matched rule. This is the heart of the score: how
// many points of "slop" a finding of this kind is worth. Deliberately weighted
// by how diagnostic the signal is of careless, machine-assembled work, not by
// how severe a bug it is. A repeated decorative motif or a template hero says
// far more about slop than a missing X-Content-Type-Options header does.
//
// Anything not listed falls back to the category default below.
export const DEFAULT_SLOP_WEIGHTS: Record<string, number> = {
  // Layout: the recognizable template shapes.
  "layout.motif-stacking": 12,
  "layout.hero-signature": 10,
  "layout.equal-card-grid": 5,
  "layout.uniform-padding": 1.5,
  "layout.no-max-width": 1.5,
  // Typography.
  "type.default-font": 6,
  "type.gradient-text": 6,
  "type.mixed-sizes-in-block": 4,
  "type.too-many-sizes": 2,
  "type.line-height": 0.5,
  // Color.
  "color.purple-blue-gradient": 10,
  "color.contrast": 1.5,
  "color.non-token": 0.5,
  "color.raw-accent": 0.5,
  "color.scrim-missing": 1,
  // Content.
  "content.lorem-placeholder": 12,
  "content.ai-voice": 9,
  "content.invented-proof": 6,
  "content.emoji": 5,
  "content.generic": 4,
  "content.empty-body": 3,
  // Components.
  "components.glassmorphism": 5,
  "components.tell-icons": 4,
  "components.mixed-icon-libraries": 4,
  "components.generic-alt": 1,
  "components.load-animation": 0.3,
  // Imagery.
  "components.placeholder-image": 8,
  "components.stock-photo": 2,
  "components.image-upscaled": 2,
  // Security.
  "security.insecure-form": 12,
  "security.secrets-in-bundle": 15,
  "security.secret-in-js": 15,
  "security.exposed-file": 15,
  "security.user-enumeration": 3,
  "security.mixed-content": 6,
  "security.csp-weak": 2,
  "security.third-party-scripts": 1.5,
  "security.sri": 1,
  "security.policy-headers": 0.5,
  // Responsive.
  "responsive.horizontal-overflow": 3,
  "responsive.touch-targets": 1,
  "responsive.viewport-meta": 1,
  "responsive.body-font-too-small": 1.5,
  // Accessibility.
  "a11y.unlabeled-controls": 2,
  "a11y.focus-visible": 0.5,
  "a11y.heading-order": 0.5,
  "a11y.lang": 0.5,
  "a11y.document": 0.3,
  // Security. Real vulnerabilities count; missing hardening headers barely.
  "security.csp": 1,
  "security.cookies": 1,
  "security.hsts": 0.5,
  "security.clickjacking": 0.3,
  "security.nosniff": 0.3,
  "security.version-disclosure": 0.3,
  // Code.
  "security.hardcoded-secrets": 15,
  "security.env-committed": 10,
  "security.command-injection": 15,
  "security.sql-injection": 15,
  "security.insecure-deserialization": 14,
  "security.code-execution": 10,
  "security.debug-enabled": 10,
  "security.tls-verify-disabled": 8,
  "security.jwt-weak": 8,
  "security.iac-public": 7,
  "security.dockerfile": 5,
  "security.weak-crypto": 4,
  "security.permissive-cors": 4,
  "security.insecure-random": 3,
  "code.placeholder-content": 8,
  "code.todo-markers": 1.5,
  "code.commented-out-code": 1.5,
  "code.duplication": 3,
  "code.large-files": 1,
  "code.project-hygiene": 2,
  // Desktop (XAML) signals.
  "desktop.dead-control": 8,
  "desktop.unlabeled-control": 4,
  "desktop.missing-pointer-cursor": 4,
  "desktop.chart-no-axis": 4,
  "desktop.ui-thread-blocking": 6,
  "desktop.placeholder-content": 6,
  "desktop.fixed-size": 3,
  "desktop.no-virtualization": 2,
  "desktop.hardcoded-color": 1,
  "desktop.hardcoded-font": 1,
  "desktop.oversized-view": 1,
  // Native (C++/Qt/Direct3D/Vulkan) crash, safety and slop signals.
  "native.unchecked-api-result": 12,
  "native.resize-path-missing": 12,
  "native.device-loss-unhandled": 6,
  "native.unsafe-c-function": 10,
  "native.command-exec": 12,
  "native.secret-literal": 15,
  "native.thread-detach": 5,
  "native.blocking-ui": 8,
  "native.delete-this": 4,
  "native.fixed-window": 3,
  "native.qt-missing-cursor": 4,
  "native.qt-chart-no-axis": 4,
  "native.placeholder-content": 6,
  "native.hardcoded-color": 1,
  "native.hardcoded-absolute-path": 4,
  "native.todo-markers": 1,
  "native.oversized-file": 1,
  "native.no-tests": 6,
  "native.no-sanitizers": 2,
  "native.weak-warnings": 2,
  "native.no-cxx-standard": 1,
  "native.vulkan-no-validation": 2,
  "native.qt-native-child-host": 5,
  // Runtime smoke findings (from --smoke), not registry checks.
  "native.runtime-crash": 25,
  "native.runtime-exit": 12,
  "native.runtime-no-window": 12,
  "native.runtime-resize-crash": 25,
  "native.runtime-hang": 12,
  "native.runtime-resize-failed": 5,
  // External analyzers.
  "sast.cppcheck": 4,
  "sast.clang-tidy": 3,
};

export const DEFAULT_CATEGORY_SLOP: Record<Category, number> = {
  layout: 3,
  typography: 2,
  color: 2,
  content: 4,
  components: 2,
  responsive: 1,
  accessibility: 1,
  security: 1,
  code: 2,
  dependencies: 1,
  performance: 0.5,
};

const BASE_PENALTIES: Record<Severity, number> = {
  critical: 60,
  high: 42,
  medium: 18,
  low: 7,
  info: 2,
};

const BASE_WEIGHTS: Record<Category, number> = {
  layout: 1.0,
  typography: 1.0,
  color: 1.0,
  content: 1.0,
  components: 0.8,
  responsive: 1.0,
  accessibility: 1.2,
  security: 1.5,
  code: 1.0,
  dependencies: 1.2,
  performance: 0.6,
};

function weights(overrides: Partial<Record<Category, number>>): Record<Category, number> {
  return { ...BASE_WEIGHTS, ...overrides };
}

export const PROFILES: Record<string, Profile> = {
  default: {
    name: "default",
    description:
      "Additive slop rubric. Each matched signal adds points weighted by how diagnostic of slop it is, so a clean site scores in the 90s and a template-driven one scores low. Higher is better.",
    severityPenalties: BASE_PENALTIES,
    categoryWeights: weights({}),
    ruleDecay: 0.85,
    worstCategoryWeight: 0,
    breadthPenalty: 0,
  },
  strict: {
    name: "strict",
    description:
      "Even harsher than the default. For grading others' work where near-perfection is expected.",
    severityPenalties: { critical: 80, high: 55, medium: 26, low: 12, info: 4 },
    categoryWeights: weights({}),
    ruleDecay: 0.9,
    worstCategoryWeight: 0.5,
    breadthPenalty: 0.12,
  },
  lenient: {
    name: "lenient",
    description:
      "The forgiving rubric, close to the tool's original scoring. For auditing your own work in progress without being buried.",
    severityPenalties: { critical: 30, high: 14, medium: 6, low: 2, info: 0 },
    categoryWeights: weights({}),
    ruleDecay: 0.5,
    worstCategoryWeight: 0.15,
    breadthPenalty: 0.04,
  },
  "marketing-site": {
    name: "marketing-site",
    description:
      "Weights visual design and copy heavily; treat this as a brand surface where slop is most visible.",
    severityPenalties: BASE_PENALTIES,
    categoryWeights: weights({
      layout: 1.4,
      typography: 1.4,
      color: 1.3,
      content: 1.4,
      components: 1.0,
      performance: 0.8,
    }),
    ruleDecay: 0.9,
    worstCategoryWeight: 0.5,
    breadthPenalty: 0.12,
  },
  "a11y-first": {
    name: "a11y-first",
    description:
      "Accessibility and semantic-correctness dominate; visual slop is secondary.",
    severityPenalties: BASE_PENALTIES,
    categoryWeights: weights({
      accessibility: 2.0,
      responsive: 1.4,
      security: 1.5,
      layout: 0.7,
      typography: 0.7,
      color: 0.9,
      components: 0.5,
    }),
    ruleDecay: 0.9,
    worstCategoryWeight: 0.5,
    breadthPenalty: 0.12,
  },
};

export const DEFAULT_PROFILE = "default";

export function resolveConfig(
  profileName: string,
  userRules: Record<string, RuleSetting> = {},
  profileOverrides?: Partial<Profile>,
): ResolvedConfig {
  const base = PROFILES[profileName] ?? PROFILES[DEFAULT_PROFILE]!;
  const merged: Profile = {
    ...base,
    ...profileOverrides,
    severityPenalties: {
      ...base.severityPenalties,
      ...(profileOverrides?.severityPenalties ?? {}),
    },
    categoryWeights: {
      ...base.categoryWeights,
      ...(profileOverrides?.categoryWeights ?? {}),
    },
  };
  return {
    profile: merged.name,
    severityPenalties: merged.severityPenalties,
    categoryWeights: merged.categoryWeights,
    ruleDecay: merged.ruleDecay,
    worstCategoryWeight: merged.worstCategoryWeight,
    breadthPenalty: merged.breadthPenalty,
    slopWeights: { ...DEFAULT_SLOP_WEIGHTS },
    instanceDecay: 0.5,
    rules: userRules,
  };
}
