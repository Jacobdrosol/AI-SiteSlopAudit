import { promises as fs } from "node:fs";
import path from "node:path";
import type { Category, RuleSetting, Severity } from "./types.js";
import type { Profile } from "./config.js";
import { resolveConfig, type ResolvedConfig } from "./config.js";
export interface FileConfig {
  profile?: string;
  llm?: {
    enabled?: boolean;
    model?: string;
    baseUrl?: string;
  };
  rules?: Record<string, RuleSetting>;
  profiles?: Record<string, Partial<Profile>>;
  web?: {
    viewports?: number[];
    timeoutMs?: number;
    fullPage?: boolean;
    storageState?: string;
  };
  code?: {
    maxFiles?: number;
    include?: string[];
  };
  failUnder?: number;
}

export const CONFIG_FILENAMES = [
  "slopaudit.config.json",
  ".slopauditrc.json",
  ".slopauditrc",
];

export async function loadFileConfig(
  cwd: string,
  explicitPath?: string,
): Promise<{ config: FileConfig; path: string | null }> {
  if (explicitPath) {
    const abs = path.resolve(cwd, explicitPath);
    const raw = await fs.readFile(abs, "utf8");
    return { config: JSON.parse(raw) as FileConfig, path: abs };
  }
  for (const name of CONFIG_FILENAMES) {
    const p = path.join(cwd, name);
    try {
      const raw = await fs.readFile(p, "utf8");
      return { config: JSON.parse(raw) as FileConfig, path: p };
    } catch {
      continue;
    }
  }
  return { config: {}, path: null };
}

export function resolveFileConfig(
  file: FileConfig,
  profileOverride?: string,
): ResolvedConfig {
  const profileName = profileOverride ?? file.profile ?? "default";
  const overrides = file.profiles?.[profileName];
  return resolveConfig(profileName, file.rules ?? {}, overrides);
}

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
}

const VALID_SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const VALID_CATEGORIES: Category[] = [
  "layout", "typography", "color", "content", "components", "responsive",
  "accessibility", "security", "code", "dependencies", "performance",
];

export function validateFileConfig(file: FileConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (file.profile && !file.profiles?.[file.profile]) {
    const builtins = ["default", "strict", "marketing-site", "a11y-first", "lenient"];
    if (!builtins.includes(file.profile)) {
      issues.push({
        level: "error",
        message: `profile "${file.profile}" is neither a built-in nor defined in profiles.`,
      });
    }
  }
  for (const [name, profile] of Object.entries(file.profiles ?? {})) {
    for (const cat of Object.keys(profile.categoryWeights ?? {})) {
      if (!VALID_CATEGORIES.includes(cat as Category)) {
        issues.push({ level: "error", message: `profile "${name}" has unknown category weight "${cat}".` });
      }
    }
    for (const [sev, value] of Object.entries(profile.severityPenalties ?? {})) {
      if (!VALID_SEVERITIES.includes(sev as Severity)) {
        issues.push({ level: "error", message: `profile "${name}" has unknown severity penalty "${sev}".` });
      }
      if (typeof value !== "number" || value < 0) {
        issues.push({ level: "error", message: `profile "${name}" penalty for "${sev}" must be a non-negative number.` });
      }
    }
    if (profile.ruleDecay !== undefined && (profile.ruleDecay < 0 || profile.ruleDecay > 1)) {
      issues.push({ level: "error", message: `profile "${name}" ruleDecay must be between 0 and 1.` });
    }
    if (
      profile.worstCategoryWeight !== undefined &&
      (typeof profile.worstCategoryWeight !== "number" ||
        profile.worstCategoryWeight < 0 ||
        profile.worstCategoryWeight > 1)
    ) {
      issues.push({ level: "error", message: `profile "${name}" worstCategoryWeight must be between 0 and 1.` });
    }
    if (
      profile.breadthPenalty !== undefined &&
      (typeof profile.breadthPenalty !== "number" ||
        profile.breadthPenalty < 0 ||
        profile.breadthPenalty > 1)
    ) {
      issues.push({ level: "error", message: `profile "${name}" breadthPenalty must be between 0 and 1.` });
    }
  }
  for (const [ruleId, setting] of Object.entries(file.rules ?? {})) {
    if (setting.severity && !VALID_SEVERITIES.includes(setting.severity)) {
      issues.push({ level: "error", message: `rule "${ruleId}" has invalid severity "${setting.severity}".` });
    }
    if (setting.weight !== undefined && (typeof setting.weight !== "number" || setting.weight < 0)) {
      issues.push({ level: "error", message: `rule "${ruleId}" weight must be a non-negative number.` });
    }
  }
  if (file.failUnder !== undefined && (file.failUnder < 0 || file.failUnder > 100)) {
    issues.push({ level: "error", message: "failUnder must be between 0 and 100." });
  }
  return issues;
}
