import type { Check } from "../core/types.js";
import type { CodeSnapshot } from "./snapshot.js";
import { codeQualityChecks } from "./checks/code-quality.js";
import { secretChecks } from "./checks/secrets.js";
import { dependencyChecks } from "./checks/dependencies.js";
import { serverSecurityChecks } from "./checks/server-security.js";

export { collectCodeSnapshot } from "./collector.js";
export type { CodeCollectorOptions } from "./collector.js";
export type { CodeSnapshot, CodeFile, DependencyInfo } from "./snapshot.js";

export const codeChecks: Check<CodeSnapshot>[] = [
  ...codeQualityChecks,
  ...secretChecks,
  ...dependencyChecks,
  ...serverSecurityChecks,
] as Check<CodeSnapshot>[];
