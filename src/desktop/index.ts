import type { Check } from "../core/types.js";
import type { DesktopSnapshot } from "./snapshot.js";
import { desktopControlChecks } from "./checks/controls.js";
import { desktopLayoutChecks } from "./checks/layout.js";
import { desktopPerformanceChecks } from "./checks/performance.js";
import { desktopInteractionChecks } from "./checks/interaction.js";

export { collectDesktopSnapshot } from "./collector.js";
export type { DesktopCollectorOptions } from "./collector.js";
export type { DesktopSnapshot, DesktopFile } from "./snapshot.js";

export const desktopChecks: Check<DesktopSnapshot>[] = [
  ...desktopControlChecks,
  ...desktopLayoutChecks,
  ...desktopPerformanceChecks,
  ...desktopInteractionChecks,
] as Check<DesktopSnapshot>[];
