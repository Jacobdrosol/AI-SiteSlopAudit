import { test } from "node:test";
import assert from "node:assert/strict";
import { Registry } from "../core/registry.js";
import type { AuditOptions, Check } from "../core/types.js";
import { resolveConfig } from "../core/config.js";
import { runChecks } from "../core/runner.js";
import type { NativeFile, NativeFileKind, NativeSnapshot } from "./snapshot.js";
import { nativeCorrectnessChecks } from "./checks/correctness.js";
import { nativeProjectChecks } from "./checks/project.js";
import { nativeSlopChecks } from "./checks/slop.js";
import { nativeQtChecks } from "./checks/qt.js";
import { smokeFindings, type SmokeResult } from "./smoke.js";

function kindOf(rel: string): NativeFileKind {
  if (/CMakeLists\.txt$/.test(rel)) return "cmake";
  if (/(^|\/)(tests?|specs?)\//.test(rel) || /(^|\/)tst_/.test(rel)) return "test";
  if (/\.(h|hh|hpp|hxx|inl|ipp)$/i.test(rel)) return "header";
  if (/\.(ui|qml|qrc|qss)$/i.test(rel)) return "ui";
  return "source";
}

function mk(rel: string, content: string): NativeFile {
  const dot = rel.lastIndexOf(".");
  return {
    path: rel,
    rel,
    ext: dot >= 0 ? rel.slice(dot) : "",
    content,
    lines: content.split("\n"),
    kind: kindOf(rel),
  };
}

function snap(
  entries: Array<[string, string]>,
  frameworks: string[] = [],
  testFrameworks: string[] = [],
): NativeSnapshot {
  const files = entries.map(([rel, content]) => mk(rel, content));
  const sourceFiles = files.filter((f) => f.kind === "source" || f.kind === "header");
  return {
    root: "/project",
    files,
    sourceFiles,
    headerFiles: files.filter((f) => f.kind === "header"),
    cmakeFiles: files.filter((f) => f.kind === "cmake"),
    projectFiles: files.filter((f) => f.kind === "project"),
    shaderFiles: files.filter((f) => f.kind === "shader"),
    uiFiles: files.filter((f) => f.kind === "ui"),
    testFiles: files.filter((f) => f.kind === "test"),
    frameworks,
    testFrameworks,
    totalFiles: files.length,
    totalLines: files.reduce((sum, f) => sum + f.lines.length, 0),
  };
}

function options(): AuditOptions {
  return {
    profile: "default",
    categories: [
      "layout", "typography", "color", "content", "components",
      "responsive", "accessibility", "security", "code", "dependencies", "performance",
    ],
    disabledRules: [],
    config: resolveConfig("default"),
  };
}

async function run(checks: Check<NativeSnapshot>[], data: NativeSnapshot) {
  const registry = new Registry();
  registry.registerAll(checks as Check[]);
  return runChecks(
    { kind: "native", label: "test", ref: "test" },
    data,
    registry.forTarget("native"),
    options(),
  );
}

test("flags an unchecked D3D12 result but not a ThrowIfFailed call", async () => {
  const bad = await run(
    nativeCorrectnessChecks,
    snap([["src/renderer.cpp", `D3D12CreateDevice(adapter, D3D_FEATURE_LEVEL_11_0, IID_PPV_ARGS(&device));`]], ["DirectX 12"]),
  );
  assert.ok(bad.findings.some((f) => f.ruleId === "native.unchecked-api-result"));

  const good = await run(
    nativeCorrectnessChecks,
    snap([["src/renderer.cpp", `ThrowIfFailed(D3D12CreateDevice(adapter, D3D_FEATURE_LEVEL_11_0, IID_PPV_ARGS(&device)));`]], ["DirectX 12"]),
  );
  assert.equal(good.findings.filter((f) => f.ruleId === "native.unchecked-api-result").length, 0);

  const inString = await run(
    nativeCorrectnessChecks,
    snap([[
      "src/vk.cpp",
      `const char* label = "vkCreateBuffer (staging)";
VkResult result = vkCreateBuffer(&info, nullptr, &buffer);
if (result != VK_SUCCESS) throw std::runtime_error(label);`,
    ]], ["Vulkan"]),
  );
  assert.equal(inString.findings.filter((f) => f.ruleId === "native.unchecked-api-result").length, 0);
});

test("flags a D3D12 swapchain with no ResizeBuffers path", async () => {
  const bad = await run(
    nativeCorrectnessChecks,
    snap([["src/renderer.cpp", `factory->CreateSwapChain(queue, &desc, &swapChain);`]], ["DirectX 12", "Win32"]),
  );
  assert.ok(bad.findings.some((f) => f.ruleId === "native.resize-path-missing"));

  const good = await run(
    nativeCorrectnessChecks,
    snap([[
      "src/renderer.cpp",
      `factory->CreateSwapChain(queue, &desc, &swapChain);
case WM_SIZE:
  swapChain->ResizeBuffers(2, LOWORD(lParam), HIWORD(lParam), DXGI_FORMAT_R8G8B8A8_UNORM, 0);
  break;`,
    ]], ["DirectX 12", "Win32"]),
  );
  assert.equal(good.findings.filter((f) => f.ruleId === "native.resize-path-missing").length, 0);
});

test("flags a Vulkan swapchain without out-of-date handling", async () => {
  const bad = await run(
    nativeCorrectnessChecks,
    snap([["src/vk.cpp", `vkCreateSwapchainKHR(device, &info, nullptr, &swapchain);`]], ["Vulkan"]),
  );
  assert.ok(bad.findings.some((f) => f.ruleId === "native.resize-path-missing"));

  const good = await run(
    nativeCorrectnessChecks,
    snap([[
      "src/vk.cpp",
      `vkCreateSwapchainKHR(device, &info, nullptr, &swapchain);
if (result == VK_ERROR_OUT_OF_DATE_KHR) { vkDeviceWaitIdle(device); vkDestroySwapchainKHR(device, swapchain, nullptr); }`,
    ]], ["Vulkan"]),
  );
  assert.equal(good.findings.filter((f) => f.ruleId === "native.resize-path-missing").length, 0);
});

test("flags unsafe C string calls but not std::string", async () => {
  const bad = await run(nativeCorrectnessChecks, snap([["src/a.cpp", `strcpy(dest, src);`]]));
  assert.ok(bad.findings.some((f) => f.ruleId === "native.unsafe-c-function"));
  const good = await run(nativeCorrectnessChecks, snap([["src/a.cpp", `std::string dest = src;`]]));
  assert.equal(good.findings.filter((f) => f.ruleId === "native.unsafe-c-function").length, 0);
});

test("flags shell execution but not QProcess with a fixed program", async () => {
  const bad = await run(nativeCorrectnessChecks, snap([["src/a.cpp", `system(cmd.c_str());`]]));
  assert.ok(bad.findings.some((f) => f.ruleId === "native.command-exec"));
  const good = await run(nativeCorrectnessChecks, snap([["src/a.cpp", `QProcess::startDetached("explorer.exe", {path});`]]));
  assert.equal(good.findings.filter((f) => f.ruleId === "native.command-exec").length, 0);

  const locale = await run(nativeCorrectnessChecks, snap([["src/a.cpp", `label->setText(QLocale::system().formattedDataSize(1024));`]]));
  assert.equal(locale.findings.filter((f) => f.ruleId === "native.command-exec").length, 0);

  const declaration = await run(nativeCorrectnessChecks, snap([["src/a.h", `VcsSystem system() const noexcept;`]]));
  assert.equal(declaration.findings.filter((f) => f.ruleId === "native.command-exec").length, 0);
});

test("flags a hard-coded credential but not an environment lookup", async () => {
  const fakeKey = ["sk", "abcdefghijklmnopqrstuvwx"].join("-");
  const bad = await run(nativeCorrectnessChecks, snap([["src/a.cpp", `const char* api_key = "${fakeKey}";`]])); // sec-ok: hardcoded-password constructed fake value used only to test the detector
  assert.ok(bad.findings.some((f) => f.ruleId === "native.secret-literal"));
  const good = await run(nativeCorrectnessChecks, snap([["src/a.cpp", `const char* api_key = std::getenv("API_KEY");`]]));
  assert.equal(good.findings.filter((f) => f.ruleId === "native.secret-literal").length, 0);
});

test("flags a detached thread and delete this", async () => {
  const result = await run(
    nativeCorrectnessChecks,
    snap([["src/a.cpp", `worker.detach();\nvoid Widget::close() { delete this; }`]]),
  );
  assert.ok(result.findings.some((f) => f.ruleId === "native.thread-detach"));
  assert.ok(result.findings.some((f) => f.ruleId === "native.delete-this"));
});

test("flags a blocking sleep in UI code but not in a worker", async () => {
  const bad = await run(
    nativeCorrectnessChecks,
    snap([["src/mainwindow.cpp", `#include <QMainWindow>\nQThread::msleep(500);`]]),
  );
  assert.ok(bad.findings.some((f) => f.ruleId === "native.blocking-ui"));

  const good = await run(
    nativeCorrectnessChecks,
    snap([["src/thumbnailloader.cpp", `std::this_thread::sleep_for(10ms);`]]),
  );
  assert.equal(good.findings.filter((f) => f.ruleId === "native.blocking-ui").length, 0);
});

test("flags a fixed top-level window but not fixed child sizes", async () => {
  const bad = await run(nativeSlopChecks, snap([["src/mainwindow.cpp", `this->setFixedSize(800, 600);`]]));
  assert.ok(bad.findings.some((f) => f.ruleId === "native.fixed-window"));

  const good = await run(nativeSlopChecks, snap([["src/mainwindow.cpp", `header->setFixedHeight(66);\nsearch->setFixedWidth(260);`]]));
  assert.equal(good.findings.filter((f) => f.ruleId === "native.fixed-window").length, 0);
});

test("flags Qt controls with no pointer cursor", async () => {
  const bad = await run(
    nativeSlopChecks,
    snap([["src/mainwindow.cpp", `auto* b = new QPushButton("Open");`]], ["Qt"]),
  );
  assert.ok(bad.findings.some((f) => f.ruleId === "native.qt-missing-cursor"));

  const good = await run(
    nativeSlopChecks,
    snap([["src/mainwindow.cpp", `auto* b = new QPushButton("Open"); b->setCursor(Qt::PointingHandCursor);`]], ["Qt"]),
  );
  assert.equal(good.findings.filter((f) => f.ruleId === "native.qt-missing-cursor").length, 0);

  const styled = await run(
    nativeSlopChecks,
    snap([
      ["src/mainwindow.cpp", `auto* b = new QPushButton("Open");`],
      ["src/style.qss", `QPushButton { cursor: pointer; }`],
    ], ["Qt"]),
  );
  assert.equal(styled.findings.filter((f) => f.ruleId === "native.qt-missing-cursor").length, 0);
});

test("flags a custom chart with no axis text", async () => {
  const bad = await run(
    nativeSlopChecks,
    snap([["src/revenuechart.cpp", `void paintEvent(QPaintEvent*) { QPainter p(this); p.drawRect(0,0,10,10); }`]]),
  );
  assert.ok(bad.findings.some((f) => f.ruleId === "native.qt-chart-no-axis"));

  const good = await run(
    nativeSlopChecks,
    snap([["src/revenuechart.cpp", `void paintEvent(QPaintEvent*) { QPainter p(this); p.drawRect(0,0,10,10); p.drawText(0,0,"0"); }`]]),
  );
  assert.equal(good.findings.filter((f) => f.ruleId === "native.qt-chart-no-axis").length, 0);
});

test("flags placeholder copy but not a search placeholder hint", async () => {
  const bad = await run(nativeSlopChecks, snap([["src/mainwindow.cpp", `label->setText("Coming soon");`]]));
  assert.ok(bad.findings.some((f) => f.ruleId === "native.placeholder-content"));

  const good = await run(nativeSlopChecks, snap([["src/mainwindow.cpp", `search->setPlaceholderText("Search images");`]]));
  assert.equal(good.findings.filter((f) => f.ruleId === "native.placeholder-content").length, 0);
});

test("flags many colour literals but not a few icon colours or a theme file", async () => {
  const many = `QColor a("#111111"); QColor b("#222222"); QColor c("#333333"); QColor d("#444444"); QColor e("#555555");`;
  const bad = await run(nativeSlopChecks, snap([["src/mainwindow.cpp", many]]));
  assert.ok(bad.findings.some((f) => f.ruleId === "native.hardcoded-color"));

  const few = await run(nativeSlopChecks, snap([["src/mainwindow.cpp", `QColor a("#111111"); QColor b("#222222");`]]));
  assert.equal(few.findings.filter((f) => f.ruleId === "native.hardcoded-color").length, 0);

  const theme = await run(nativeSlopChecks, snap([["src/theme.cpp", many]]));
  assert.equal(theme.findings.filter((f) => f.ruleId === "native.hardcoded-color").length, 0);
});

test("flags an absolute user path and unresolved task markers", async () => {
  const result = await run(
    nativeSlopChecks,
    snap([["src/a.cpp", `auto p = "C:\\\\Users\\\\jacob\\\\images";\n// ${"TO" + "DO"}: handle missing files`]]),
  );
  assert.ok(result.findings.some((f) => f.ruleId === "native.hardcoded-absolute-path"));
  assert.ok(result.findings.some((f) => f.ruleId === "native.todo-markers"));
});

test("flags a source file over 800 lines", async () => {
  const big = Array.from({ length: 850 }, (_, i) => `int v${i} = ${i};`).join("\n");
  const result = await run(nativeSlopChecks, snap([["src/huge.cpp", big]]));
  assert.ok(result.findings.some((f) => f.ruleId === "native.oversized-file"));
});

test("flags a non-trivial project with no tests", async () => {
  const big = Array.from({ length: 650 }, (_, i) => `int v${i} = ${i};`).join("\n");
  const bad = await run(nativeProjectChecks, snap([["src/a.cpp", big], ["CMakeLists.txt", `project(A LANGUAGES CXX)`]]));
  assert.ok(bad.findings.some((f) => f.ruleId === "native.no-tests"));

  const good = await run(
    nativeProjectChecks,
    snap([
      ["src/a.cpp", big],
      ["tests/tst_a.cpp", `#include <QtTest>\nQTEST_MAIN(TestA)`],
      ["CMakeLists.txt", `project(A LANGUAGES CXX)\nadd_test(NAME a COMMAND tst_a)`],
    ]),
  );
  assert.equal(good.findings.filter((f) => f.ruleId === "native.no-tests").length, 0);
});

test("flags a CMake build with no warnings, standard or sanitizers", async () => {
  const result = await run(nativeProjectChecks, snap([["CMakeLists.txt", `project(A LANGUAGES CXX)`]]));
  assert.ok(result.findings.some((f) => f.ruleId === "native.no-sanitizers"));
  assert.ok(result.findings.some((f) => f.ruleId === "native.weak-warnings"));
  assert.ok(result.findings.some((f) => f.ruleId === "native.no-cxx-standard"));
});

test("accepts a build that pins the standard and raises warnings", async () => {
  const result = await run(
    nativeProjectChecks,
    snap([[
      "CMakeLists.txt",
      `project(A LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
add_compile_options(/W4 -fsanitize=address)`,
    ]]),
  );
  assert.equal(result.findings.filter((f) => f.ruleId === "native.no-sanitizers").length, 0);
  assert.equal(result.findings.filter((f) => f.ruleId === "native.weak-warnings").length, 0);
  assert.equal(result.findings.filter((f) => f.ruleId === "native.no-cxx-standard").length, 0);
});

test("flags a Vulkan app with no validation layers", async () => {
  const result = await run(
    nativeProjectChecks,
    snap([["src/vk.cpp", `vkCreateInstance(&info, nullptr, &instance);`]], ["Vulkan"]),
  );
  assert.ok(result.findings.some((f) => f.ruleId === "native.vulkan-no-validation"));
});

function smoke(overrides: Partial<SmokeResult>): SmokeResult {
  return {
    ran: true,
    platform: "win32",
    windowFound: true,
    resized: [{ width: 800, height: 600, alive: true, responding: true }],
    exitedDuring: false,
    exitCode: 0,
    crashAt: null,
    respondingAtEnd: true,
    resizeFailed: false,
    durationMs: 1000,
    ...overrides,
  };
}

test("flags a native window embedded in a Qt pane layout", async () => {
  const bad = await run(
    nativeQtChecks,
    snap([
      ["src/mainwindow.cpp", `auto* window = new QMainWindow;`],
      ["src/viewport.cpp", `HWND child = CreateWindowExA(0, L"Viewport", L"", WS_CHILD, 0, 0, 800, 600, parent, nullptr, instance, nullptr);`],
    ], ["Qt"]),
  );
  assert.ok(bad.findings.some((f) => f.ruleId === "native.qt-native-child-host"));

  const good = await run(
    nativeQtChecks,
    snap([["src/mainwindow.cpp", `auto* window = new QMainWindow;`]], ["Qt"]),
  );
  assert.equal(good.findings.filter((f) => f.ruleId === "native.qt-native-child-host").length, 0);
});

test("smoke findings: crash before a window is critical", () => {
  const findings = smokeFindings(
    smoke({ windowFound: false, exitedDuring: true, exitCode: -1073741819 }),
    "Focal.exe",
  );
  assert.equal(findings[0]?.ruleId, "native.runtime-crash");
  assert.equal(findings[0]?.severity, "critical");
});

test("smoke findings: crash during resize is critical", () => {
  const findings = smokeFindings(
    smoke({
      crashAt: "1280x720",
      exitedDuring: true,
      exitCode: -1073741819,
      resized: [{ width: 1280, height: 720, alive: false, responding: false }],
    }),
    "Focal.exe",
  );
  assert.equal(findings[0]?.ruleId, "native.runtime-resize-crash");
  assert.equal(findings[0]?.severity, "critical");
});

test("smoke findings: unresponsive window is a hang, clean run is silent", () => {
  const hang = smokeFindings(smoke({ respondingAtEnd: false }), "Focal.exe");
  assert.equal(hang[0]?.ruleId, "native.runtime-hang");
  assert.deepEqual(smokeFindings(smoke({}), "Focal.exe"), []);
});
