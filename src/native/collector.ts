import { promises as fs } from "node:fs";
import path from "node:path";
import type { NativeFile, NativeFileKind, NativeSnapshot } from "./snapshot.js";
import {
  CPP_HEADER_EXTS,
  CPP_SOURCE_EXTS,
  NATIVE_PROJECT_EXT,
  NATIVE_PROJECT_FILES,
  SHADER_EXTS,
  UI_EXTS,
} from "./snapshot.js";

export interface NativeCollectorOptions {
  root: string;
  maxFiles?: number;
}

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".vs", ".idea", ".vscode", "bin", "obj", "build",
  "out", "dist", "cmake-build-debug", "cmake-build-release", "debug", "release",
  "x64", "x86", "arm64", "third_party", "third-party", "vendor", "external",
  "vcpkg_installed", ".conan", ".cache", "coverage", "testresults",
  "cmakefiles", "_deps", "testing",
]);

function isIgnoredDir(name: string): boolean {
  const lower = name.toLowerCase();
  return IGNORE_DIRS.has(lower) || lower.endsWith(".dir");
}

const MAX_FILE_BYTES = 2_000_000;
const DEFAULT_MAX_FILES = 8000;

const FRAMEWORK_MARKERS: Array<{ label: string; re: RegExp }> = [
  { label: "Qt", re: /#include\s*<Q[A-Z]\w*>|\bfind_package\s*\(\s*Qt|^\s*QT\s*\+=|\bQApplication\b|\bQMainWindow\b/m },
  { label: "Win32", re: /#include\s*<windows\.h>|\bWinMain\b|\bWNDCLASSEX\b|\bCreateWindowEx[AW]?\s*\(/ },
  { label: "DirectX 12", re: /d3d12\.h|\bID3D12\w+|\bD3D12CreateDevice\b/ },
  { label: "DirectX 11", re: /d3d11\.h|\bID3D11\w+|\bD3D11CreateDevice\b/ },
  { label: "Vulkan", re: /vulkan\/vulkan\.h|\bvkCreateInstance\b|\bVkInstance\b/ },
  { label: "OpenGL", re: /#include\s*<GL\/|glad\/glad\.h|\bQOpenGLWidget\b|\bglGenBuffers\b/ },
  { label: "SDL", re: /#include\s*[<"]SDL2?\/|#include\s*[<"]SDL3\/|#include\s*[<"]SDL\.h[>"]|\bSDL_CreateWindow\b/ },
  { label: "GLFW", re: /GLFW\/glfw3\.h|\bglfwCreateWindow\b/ },
  { label: "SFML", re: /#include\s*<SFML\/|\bsf::RenderWindow\b/ },
  { label: "Dear ImGui", re: /imgui\.h|\bImGui::Begin\b/ },
  { label: "Unreal Engine", re: /CoreMinimal\.h|#include\s+"Engine\/|\bUCLASS\s*\(/ },
  { label: "Godot", re: /godot\.hpp|godot_cpp\/|\bGDCLASS\s*\(/ },
  { label: "raylib", re: /#include\s*"raylib\.h"|\bInitWindow\s*\(/ },
];

const TEST_MARKERS: Array<{ label: string; re: RegExp }> = [
  { label: "QtTest", re: /#include\s*<QtTest|\bQTEST_MAIN\b|\bQTest::/ },
  { label: "Catch2", re: /catch2\/catch|catch\.hpp|\bCATCH_CONFIG_MAIN\b/ },
  { label: "GoogleTest", re: /gtest\/gtest\.h|\bTEST_F?\s*\(|\bINSTANTIATE_TEST_SUITE\b/ },
  { label: "doctest", re: /doctest\/doctest\.h|\bDOCTEST_CONFIG_IMPLEMENT/ },
  { label: "Boost.Test", re: /boost\/test\/|\bBOOST_AUTO_TEST_CASE\b/ },
  { label: "CTest", re: /\badd_test\s*\(|\benable_testing\s*\(/ },
];

function classify(rel: string, name: string): NativeFileKind {
  const lower = name.toLowerCase();
  const ext = path.extname(lower);
  if (lower === "cmakelists.txt" || ext === ".cmake") return "cmake";
  if (NATIVE_PROJECT_FILES.has(lower) || NATIVE_PROJECT_EXT.has(ext)) return "project";
  if (SHADER_EXTS.has(ext)) return "shader";
  if (UI_EXTS.has(ext)) return "ui";
  if (CPP_SOURCE_EXTS.has(ext) || CPP_HEADER_EXTS.has(ext)) {
    return isTestPath(rel, name) ? "test" : ext.startsWith(".h") || ext === ".inl" || ext === ".ipp" ? "header" : "source";
  }
  return "other";
}

function isTestPath(rel: string, name: string): boolean {
  const lower = rel.toLowerCase();
  return (
    /(^|\/)(tests?|specs?)\//.test(lower) ||
    /(^|\/)test_[^/]+$/.test(lower) ||
    /_tests?\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/.test(lower) ||
    /(^|\/)tst_[^/]+$/.test(lower) ||
    /\.(test|spec)\.(c|cc|cpp|cxx)$/.test(lower) ||
    /[._-]test\.(h|hh|hpp|hxx)$/.test(lower) ||
    /^test_.*\.(h|hh|hpp|hxx)$/.test(name.toLowerCase())
  );
}

function detectMarkers(files: NativeFile[], markers: Array<{ label: string; re: RegExp }>): string[] {
  const found = new Set<string>();
  for (const file of files) {
    for (const marker of markers) {
      if (marker.re.test(file.content)) found.add(marker.label);
    }
  }
  return [...found];
}

export async function collectNativeSnapshot(
  options: NativeCollectorOptions,
): Promise<NativeSnapshot> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const files: NativeFile[] = [];

  async function walk(dir: string): Promise<void> {
    if (files.length >= maxFiles) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!isIgnoredDir(entry.name)) await walk(full);
        continue;
      }

      const lower = entry.name.toLowerCase();
      const ext = path.extname(lower);
      const relevant =
        CPP_SOURCE_EXTS.has(ext) ||
        CPP_HEADER_EXTS.has(ext) ||
        SHADER_EXTS.has(ext) ||
        UI_EXTS.has(ext) ||
        ext === ".cmake" ||
        NATIVE_PROJECT_FILES.has(lower) ||
        NATIVE_PROJECT_EXT.has(ext);
      if (!relevant) continue;

      try {
        const stat = await fs.stat(full);
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = await fs.readFile(full, "utf8");
        const rel = path.relative(options.root, full).replace(/\\/g, "/");
        let kind = classify(rel, entry.name);
        if (
          (kind === "source" || kind === "header") &&
          TEST_MARKERS.some((m) => m.label !== "CTest" && m.re.test(content))
        ) {
          kind = "test";
        }
        files.push({
          path: full,
          rel,
          ext,
          content,
          lines: content.split(/\r?\n/),
          kind,
        });
      } catch {
        continue;
      }
    }
  }

  await walk(options.root);

  const testFiles = files.filter((f) => f.kind === "test");
  const sourceFiles = files.filter((f) => f.kind === "source" || f.kind === "header");
  const headerFiles = files.filter((f) => f.kind === "header");
  const cmakeFiles = files.filter((f) => f.kind === "cmake");
  const projectFiles = files.filter((f) => f.kind === "project");
  const shaderFiles = files.filter((f) => f.kind === "shader");
  const uiFiles = files.filter((f) => f.kind === "ui");

  return {
    root: options.root,
    files,
    sourceFiles,
    headerFiles,
    cmakeFiles,
    projectFiles,
    shaderFiles,
    uiFiles,
    testFiles,
    frameworks: detectMarkers(files, FRAMEWORK_MARKERS),
    testFrameworks: detectMarkers(files, TEST_MARKERS),
    totalFiles: files.length,
    totalLines: files.reduce((sum, f) => sum + f.lines.length, 0),
  };
}
