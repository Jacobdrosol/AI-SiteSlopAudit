import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectTarget, nearNativeProject } from "./detect.js";

async function tempProject(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "slopaudit-detect-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }
  return dir;
}

test("detects a CMake project with C++ sources as native", async () => {
  const dir = await tempProject({
    "CMakeLists.txt": "project(App LANGUAGES CXX)",
    "src/main.cpp": "int main() { return 0; }",
  });
  try {
    const target = detectTarget(dir);
    assert.equal(target.kind, "native");
    assert.ok(nearNativeProject(dir));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a CMake file with no C++ sources is not enough to call it native", async () => {
  const dir = await tempProject({ "CMakeLists.txt": "project(App LANGUAGES CXX)" });
  try {
    assert.equal(detectTarget(dir).kind, "code");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("finds C++ sources in a non-src subdirectory", async () => {
  const dir = await tempProject({
    "CMakeLists.txt": "project(App LANGUAGES CXX)",
    "Source/App.cpp": "int main() { return 0; }",
  });
  try {
    assert.equal(detectTarget(dir).kind, "native");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("detects a Qt .pro project as native", async () => {
  const dir = await tempProject({
    "app.pro": "QT += widgets",
    "main.cpp": "#include <QApplication>",
  });
  try {
    assert.equal(detectTarget(dir).kind, "native");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("keeps .NET XAML projects on the desktop target", async () => {
  const dir = await tempProject({
    "App.csproj": "<Project Sdk=\"Microsoft.NET.Sdk\" />",
    "App.axaml": "<Application />",
  });
  try {
    assert.equal(detectTarget(dir).kind, "desktop");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("falls back to the code target for a JS project", async () => {
  const dir = await tempProject({ "package.json": "{}" });
  try {
    assert.equal(detectTarget(dir).kind, "code");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("detects URLs as web and honours an explicit type", async () => {
  assert.equal(detectTarget("https://example.com").kind, "web");
  assert.equal(detectTarget("example.com").kind, "web");
  assert.equal(detectTarget("C:\\some\\dir", "native").kind, "native");
  assert.equal(detectTarget("C:\\some\\dir", "desktop").kind, "desktop");
});
