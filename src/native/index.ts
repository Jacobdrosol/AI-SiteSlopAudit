import type { Check } from "../core/types.js";
import type { NativeSnapshot } from "./snapshot.js";
import { nativeCorrectnessChecks } from "./checks/correctness.js";
import { nativeProjectChecks } from "./checks/project.js";
import { nativeSlopChecks } from "./checks/slop.js";
import { nativeQtChecks } from "./checks/qt.js";

export { collectNativeSnapshot } from "./collector.js";
export type { NativeCollectorOptions } from "./collector.js";
export type { NativeSnapshot, NativeFile } from "./snapshot.js";
export { runNativeSmoke, smokeFindings } from "./smoke.js";
export type { SmokeResult, SmokeOptions, SmokeStep } from "./smoke.js";

export const nativeChecks: Check<NativeSnapshot>[] = [
  ...nativeCorrectnessChecks,
  ...nativeProjectChecks,
  ...nativeSlopChecks,
  ...nativeQtChecks,
] as Check<NativeSnapshot>[];
