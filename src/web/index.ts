import type { Check } from "../core/types.js";
import type { WebSnapshot } from "./snapshot.js";
import { layoutChecks } from "./checks/layout.js";
import { typographyChecks } from "./checks/typography.js";
import { colorChecks } from "./checks/color.js";
import { contentChecks } from "./checks/content.js";
import { componentChecks } from "./checks/components.js";
import { motifChecks } from "./checks/motifs.js";
import { imageChecks } from "./checks/images.js";
import { responsiveChecks } from "./checks/responsive.js";
import { accessibilityChecks } from "./checks/accessibility.js";
import { securityChecks } from "./checks/security.js";

export { collectWebSnapshot } from "./collector.js";
export type { WebCollectorOptions } from "./collector.js";
export type { WebSnapshot } from "./snapshot.js";

export const webChecks: Check<WebSnapshot>[] = [
  ...layoutChecks,
  ...typographyChecks,
  ...colorChecks,
  ...contentChecks,
  ...componentChecks,
  ...imageChecks,
  ...motifChecks,
  ...responsiveChecks,
  ...accessibilityChecks,
  ...securityChecks,
] as Check<WebSnapshot>[];
