import { readdirSync } from "node:fs";
import path from "node:path";
import type { AuditTarget, TargetKind } from "./types.js";

const DOTNET_PROJECT = /\.(csproj|fsproj|vbproj)$/i;
const NATIVE_PROJECT = /^(cmakelists\.txt|meson\.build|xmake\.lua|premake5\.lua|makefile|project\.godot)$/i;
const NATIVE_PROJECT_EXT = /\.(vcxproj|uproject|uplugin|pro|pri)$/i;
const CPP_SOURCE = /\.(c|cc|cpp|cxx|m|mm|h|hh|hpp|hxx|inl|ipp|hlsl|glsl|vert|frag|comp|wgsl)$/i;

const SKIP_DIRS = new Set([
  "bin", "obj", ".git", ".vs", ".idea", ".vscode", "node_modules", "TestResults",
  "packages", "build", "out", "dist", "third_party", "third-party", "vendor",
  "external", "cmake-build-debug", "cmake-build-release", "x64", "debug", "release",
]);

function safeRead(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function nearDotNetProject(root: string): boolean {
  for (const dir of [root, path.join(root, "src")]) {
    if (safeRead(dir).some((name) => DOTNET_PROJECT.test(name) || /\.sln$/i.test(name))) {
      return true;
    }
  }
  return false;
}

export function hasDesktopXaml(root: string): boolean {
  const stack = [root];
  let seen = 0;
  while (stack.length > 0 && seen < 3000) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen++;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name.toLowerCase())) stack.push(path.join(dir, entry.name));
      } else if (/\.(axaml|xaml)$/i.test(entry.name)) {
        return true;
      }
    }
  }
  return false;
}

/** True when the root or its src/ directory is a C/C++ project. */
export function nearNativeProject(root: string): boolean {
  for (const dir of [root, path.join(root, "src")]) {
    const names = safeRead(dir);
    if (names.some((name) => NATIVE_PROJECT.test(name))) return true;
    if (names.some((name) => NATIVE_PROJECT_EXT.test(name))) return true;
    if (names.some((name) => /^CMakeLists\.txt$/i.test(name))) return true;
  }
  return false;
}

/** C/C++/shader sources at the root or two levels down, ignoring build output. */
export function hasCppSources(root: string, depth = 2): boolean {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && CPP_SOURCE.test(entry.name)) return true;
    if (entry.isDirectory() && depth > 0 && !SKIP_DIRS.has(entry.name.toLowerCase())) {
      if (hasCppSources(path.join(root, entry.name), depth - 1)) return true;
    }
  }
  return false;
}

export function detectTarget(ref: string, explicit?: string): AuditTarget {
  const forced = explicit as TargetKind | undefined;
  if (forced === "web" || forced === "code" || forced === "desktop" || forced === "native") {
    return { kind: forced, label: ref, ref };
  }
  if (/^https?:\/\//i.test(ref)) {
    return { kind: "web", label: ref, ref };
  }
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(ref) && !ref.includes(path.sep)) {
    return { kind: "web", label: ref, ref: `https://${ref}` };
  }
  const resolved = path.resolve(ref);
  if (nearDotNetProject(resolved) && hasDesktopXaml(resolved)) {
    return { kind: "desktop", label: ref, ref: resolved };
  }
  if (nearNativeProject(resolved) && hasCppSources(resolved)) {
    return { kind: "native", label: ref, ref: resolved };
  }
  return { kind: "code", label: ref, ref: resolved };
}

export const TARGET_KINDS: TargetKind[] = ["web", "code", "desktop", "native"];
