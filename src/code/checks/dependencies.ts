import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { CodeSnapshot } from "../snapshot.js";

export const dependencyChecks = [
  defineCheck<CodeSnapshot>({
    id: "dependencies.no-lockfile",
    category: "dependencies",
    title: "No lockfile",
    description:
      "A manifest exists but no lockfile, so installs are not reproducible and can pull in compromised versions.",
    defaultSeverity: "medium",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const offenders = data.dependencies.filter((d) => !d.lockfilePresent);
      if (offenders.length === 0) return [];
      return offenders.map((d) => ({
        ruleId: "dependencies.no-lockfile",
        category: "dependencies",
        severity: "medium",
        title: `No lockfile for ${d.manager}`,
        detail: `${d.manifestPath} exists with ${d.dependencies.length} dependencies but no lockfile was found. Without one, every install can resolve different versions, and a malicious release can slip in silently.`,
        evidence: [{ label: d.manifestPath, file: d.manifestPath }],
        fix: "Commit the lockfile (package-lock.json / yarn.lock / Cargo.lock / go.sum / poetry.lock).",
      }));
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "dependencies.unpinned",
    category: "dependencies",
    title: "Unpinned dependencies",
    description:
      "Dependencies declared with a floating range, so builds are not reproducible.",
    defaultSeverity: "low",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];
      for (const dep of data.dependencies) {
        if (dep.lockfilePresent) continue;
        const floating = dep.dependencies.filter(
          (d) => /[\^*~]|^latest$|^>/.test(d.version) || d.version === "" || d.version === "*",
        );
        if (floating.length === 0) continue;
        const ratio = floating.length / Math.max(1, dep.dependencies.length);
        if (ratio < 0.3) continue;
        findings.push({
          ruleId: "dependencies.unpinned",
          category: "dependencies",
          severity: ratio > 0.7 ? "medium" : "low",
          title: `${floating.length} of ${dep.dependencies.length} ${dep.manager} deps are unpinned`,
          detail: `Floating ranges (^, ~, *, latest) were found in ${dep.manifestPath}, e.g. ${floating
            .slice(0, 4)
            .map((d) => `${d.name}@${d.version || "*"}`)
            .join(", ")}. Ranges are normal in app code, but a lockfile is then mandatory; without one, reproducibility is gone.`,
          evidence: floating.slice(0, 6).map((d) => ({
            label: d.name,
            file: dep.manifestPath,
            value: d.version || "*",
          })),
          fix: "Keep ranges if you like, but commit a lockfile so the resolved graph is fixed.",
          confidence: 0.7,
        });
      }
      return findings;
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "dependencies.count",
    category: "dependencies",
    title: "Dependency bloat",
    description:
      "A large dependency count increases attack surface and the chance of sloppy transitive code.",
    defaultSeverity: "low",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];
      for (const dep of data.dependencies) {
        if (dep.manager !== "npm") continue;
        const prod = dep.dependencies.filter((d) => d.scope === "prod").length;
        if (prod < 60) continue;
        findings.push({
          ruleId: "dependencies.count",
          category: "dependencies",
          severity: prod > 120 ? "medium" : "low",
          title: `${prod} production dependencies`,
          detail: `${dep.manifestPath} declares ${prod} production dependencies (plus ${dep.devDependencies} dev). Every dependency is code you did not write and must trust; large trees are where supply-chain problems hide.`,
          evidence: [{ label: "prod deps", file: dep.manifestPath, value: String(prod) }],
          fix: "Audit the tree (npm ls / npm audit) and remove what is unused.",
          confidence: 0.6,
        });
      }
      return findings;
    },
  }),

  defineCheck<CodeSnapshot>({
    id: "dependencies.manifest-only",
    category: "dependencies",
    title: "Manifest with no source",
    description:
      "Dependencies are declared but almost no source files exist, a scaffold that was never filled in.",
    defaultSeverity: "medium",
    appliesTo: ["code"],
    run({ data }): Finding[] {
      if (data.dependencies.length === 0) return [];
      const sourceFiles = data.files.filter(
        (f) =>
          !f.isGenerated &&
          !f.isTest &&
          ["TypeScript", "JavaScript", "Python", "Rust", "Go", "Java", "C#", "Kotlin", "Swift", "Ruby", "PHP"].includes(
            f.language,
          ),
      );
      if (sourceFiles.length >= 3) return [];
      const totalDeps = data.dependencies.reduce((s, d) => s + d.dependencies.length, 0);
      if (totalDeps < 5) return [];
      return [
        {
          ruleId: "dependencies.manifest-only",
          category: "dependencies",
          severity: "medium",
          title: "Manifest declares dependencies but there is almost no source",
          detail: `${totalDeps} dependencies are declared across ${data.dependencies.length} manifest(s), but only ${sourceFiles.length} non-test source file(s) exist. This is a scaffold: the setup was generated and the actual work never happened.`,
          evidence: data.dependencies.map((d) => ({
            label: d.manifestPath,
            file: d.manifestPath,
            value: `${d.dependencies.length} deps`,
          })),
          fix: "Either implement the project or remove the unused scaffolding.",
        },
      ];
    },
  }),
];
