import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { NativeSnapshot } from "../snapshot.js";
import { allSourceText, isTestFile, isUiSource, matchLines, stripComments, stripLiterals } from "../source.js";

interface Offender {
  line: number;
  text: string;
}

function evidence(file: { rel: string }, offenders: Offender[]) {
  return offenders.slice(0, 8).map((o) => ({
    label: o.text.slice(0, 120),
    file: file.rel,
    line: o.line,
  }));
}

const VULKAN_CALL =
  /\b(?:vkCreate|vkAllocate|vkBeginCommandBuffer|vkQueueSubmit|vkQueuePresentKHR|vkAcquireNextImageKHR)\w*\s*\(/;
const DX_CALL =
  /(?:\b(?:D3D12CreateDevice|D3D11CreateDevice|CreateDXGIFactory\d*|D3D12CreateRootSignatureDeserializer)\s*\(|->\s*(?:CreateSwapChain|CreateCommittedResource|CreateGraphicsPipelineState|CreateRootSignature|CreateCommandQueue|CreateCommandAllocator|CreateCommandList|CreateDescriptorHeap|CreateBuffer|CreateTexture2D|Map)\s*\()/;
const RESULT_HANDLED =
  /VK_SUCCESS|VK_CHECK|SUCCEEDED|FAILED|ThrowIfFailed|VkResult|HRESULT|assert\s*\(|if\s*\(/;

function hasFramework(data: NativeSnapshot, name: string): boolean {
  return data.frameworks.includes(name);
}

function firstWith(data: NativeSnapshot, re: RegExp) {
  return data.files.find((f) => re.test(f.content));
}

export const nativeCorrectnessChecks = [
  defineCheck<NativeSnapshot>({
    id: "native.unchecked-api-result",
    category: "code",
    title: "Graphics API result ignored",
    description:
      "A Direct3D HRESULT or Vulkan VkResult is not checked. Ignoring it is how device creation, swapchain and allocation failures become crashes later.",
    defaultSeverity: "high",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const useVulkan = hasFramework(data, "Vulkan");
      const useDx = hasFramework(data, "DirectX 11") || hasFramework(data, "DirectX 12");
      if (!useVulkan && !useDx) return [];

      const findings: Finding[] = [];
      for (const file of data.sourceFiles) {
        if (isTestFile(file)) continue;
        const lines = file.lines;
        const stripped = stripLiterals(stripComments(file.content)).split(/\r?\n/);
        const callRe = useVulkan ? VULKAN_CALL : DX_CALL;
        const offenders: Offender[] = [];

        for (let i = 0; i < stripped.length; i++) {
          const line = stripped[i] ?? "";
          const match = callRe.exec(line);
          if (!match) continue;
          const window = [stripped[i - 1] ?? "", line, stripped[i + 1] ?? "", stripped[i + 2] ?? ""].join("\n");
          if (RESULT_HANDLED.test(window)) continue;
          offenders.push({ line: i + 1, text: (lines[i] ?? "").trim() });
        }

        if (offenders.length === 0) continue;
        findings.push({
          ruleId: "native.unchecked-api-result",
          category: "code",
          severity: "high",
          title: `${offenders.length} unchecked graphics API call(s)`,
          detail:
            "These calls return an HRESULT or VkResult that is never tested. A failed device, swapchain or resource creation is then used as if it succeeded, which crashes on the next frame or on resize.",
          location: `${file.rel}:${offenders[0]!.line}`,
          evidence: evidence(file, offenders),
          fix: "Check every result immediately (ThrowIfFailed/SUCCEEDED for DX, VK_CHECK/VK_SUCCESS for Vulkan) and fail with a clear message.",
          confidence: 0.75,
        });
      }
      return findings;
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.resize-path-missing",
    category: "code",
    title: "Resize path missing or incomplete",
    description:
      "A swapchain or GL surface has no code that reacts to a window resize. This is the classic 'opens fine, crashes when you drag the edge' bug.",
    defaultSeverity: "high",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const text = allSourceText(data.files);
      const findings: Finding[] = [];

      if (hasFramework(data, "Vulkan") && /vkCreateSwapchainKHR/.test(text)) {
        const missing: string[] = [];
        if (!/VK_ERROR_OUT_OF_DATE_KHR|VK_SUBOPTIMAL_KHR/.test(text)) missing.push("no VK_ERROR_OUT_OF_DATE_KHR handling");
        if (!/vkDeviceWaitIdle|vkQueueWaitIdle/.test(text)) missing.push("no idle before swapchain destruction");
        if (!/vkDestroySwapchainKHR/.test(text)) missing.push("no swapchain teardown");
        if (missing.length > 0) {
          const file = firstWith(data, /vkCreateSwapchainKHR/);
          findings.push({
            ruleId: "native.resize-path-missing",
            category: "code",
            severity: "high",
            title: "Vulkan swapchain has no recreate-on-resize path",
            detail: `The swapchain is created once, but resizing needs it rebuilt. Missing: ${missing.join(", ")}. On the first resize the surface is out of date and the next present or acquire is invalid.`,
            location: file ? file.rel : data.root,
            evidence: file ? [{ label: "swapchain creation", file: file.rel }] : [],
            fix: "On resize: wait for the device to idle, destroy the old swapchain and views, create a new swapchain, recreate views and framebuffers, and handle VK_ERROR_OUT_OF_DATE_KHR/VK_SUBOPTIMAL_KHR in acquire/present.",
            confidence: 0.8,
          });
        }
      }

      if ((hasFramework(data, "DirectX 11") || hasFramework(data, "DirectX 12")) && /CreateSwapChain/.test(text)) {
        const missing: string[] = [];
        if (!/\bResizeBuffers\s*\(/.test(text)) missing.push("no ResizeBuffers call");
        const win32 = hasFramework(data, "Win32") && !hasFramework(data, "SDL") && !hasFramework(data, "GLFW");
        if (win32 && !/\bWM_SIZE\b/.test(text) && !/\bGetClientRect\s*\(/.test(text)) {
          missing.push("no WM_SIZE/GetClientRect handling");
        }
        if (missing.length > 0) {
          const file = firstWith(data, /CreateSwapChain/);
          findings.push({
            ruleId: "native.resize-path-missing",
            category: "code",
            severity: "high",
            title: "Direct3D swapchain is never resized",
            detail: `The swapchain is created but the resize path is incomplete: ${missing.join(", ")}. Dragging the window edge leaves the back buffers at the old size, and the next Present fails or crashes.`,
            location: file ? file.rel : data.root,
            evidence: file ? [{ label: "swapchain creation", file: file.rel }] : [],
            fix: "Handle WM_SIZE (or the platform resize event): release render targets, call ResizeBuffers with the new client size, then recreate render targets and depth buffers.",
            confidence: 0.8,
          });
        }
      }

      if (hasFramework(data, "OpenGL") && /QOpenGLWidget|paintGL\s*\(/.test(text) && !/resizeGL\s*\(/.test(text)) {
        const file = firstWith(data, /paintGL\s*\(|QOpenGLWidget/);
        findings.push({
          ruleId: "native.resize-path-missing",
          category: "code",
          severity: "medium",
          title: "OpenGL widget has no resizeGL",
          detail:
            "paintGL draws with a projection/viewport that is never updated when the widget resizes, so the image stretches or clips after a resize.",
          location: file ? file.rel : data.root,
          evidence: file ? [{ label: "paintGL", file: file.rel }] : [],
          fix: "Override resizeGL and update glViewport and the projection matrix there.",
          confidence: 0.65,
        });
      }

      if (hasFramework(data, "SDL") && /SDL_CreateWindow/.test(text) && /SDL_WINDOW_RESIZABLE/.test(text)) {
        if (!/SDL_EVENT_WINDOW_RESIZED|SDL_WINDOWEVENT_RESIZED|SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED/.test(text)) {
          const file = firstWith(data, /SDL_CreateWindow/);
          findings.push({
            ruleId: "native.resize-path-missing",
            category: "code",
            severity: "medium",
            title: "Resizable SDL window has no resize handler",
            detail:
              "The window is created as resizable but nothing reacts to the resize event, so the drawable size and projection stay stale.",
            location: file ? file.rel : data.root,
            evidence: file ? [{ label: "SDL window", file: file.rel }] : [],
            fix: "Handle SDL_EVENT_WINDOW_RESIZED / SDL_WINDOWEVENT_RESIZED and update the viewport and projection.",
            confidence: 0.7,
          });
        }
      }

      return findings;
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.device-loss-unhandled",
    category: "code",
    title: "GPU device loss is not handled",
    description:
      "Direct3D device-removed and Vulkan VK_ERROR_DEVICE_LOST are never checked, so a driver reset or GPU hang becomes an unexplained crash.",
    defaultSeverity: "medium",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const text = allSourceText(data.files);
      const findings: Finding[] = [];

      if (hasFramework(data, "DirectX 12") && /ID3D12Device|D3D12CreateDevice/.test(text) && !/GetDeviceRemovedReason|DXGI_ERROR_DEVICE_REMOVED|DXGI_ERROR_DEVICE_RESET/.test(text)) {
        const file = firstWith(data, /D3D12CreateDevice|ID3D12Device/);
        findings.push({
          ruleId: "native.device-loss-unhandled",
          category: "code",
          severity: "medium",
          title: "Direct3D 12 device removal is never checked",
          detail:
            "The app never calls GetDeviceRemovedReason or tests the device-removed HRESULTs. After a driver reset or GPU fault it keeps presenting to a dead device.",
          location: file ? file.rel : data.root,
          evidence: file ? [{ label: "D3D12 device", file: file.rel }] : [],
          fix: "Check Present/GetDeviceRemovedReason for DXGI_ERROR_DEVICE_REMOVED and rebuild the device and all resources, or exit cleanly with a message.",
          confidence: 0.7,
        });
      }

      if (hasFramework(data, "Vulkan") && /vkCreateDevice/.test(text) && !/VK_ERROR_DEVICE_LOST/.test(text)) {
        const file = firstWith(data, /vkCreateDevice/);
        findings.push({
          ruleId: "native.device-loss-unhandled",
          category: "code",
          severity: "medium",
          title: "Vulkan device loss is never checked",
          detail:
            "VK_ERROR_DEVICE_LOST is not handled. A GPU hang or driver reset will surface as an unchecked failure and a crash instead of a recoverable error.",
          location: file ? file.rel : data.root,
          evidence: file ? [{ label: "VkDevice", file: file.rel }] : [],
          fix: "Treat VK_ERROR_DEVICE_LOST as fatal-but-recoverable: stop rendering, destroy and recreate the device and swapchain, and tell the user.",
          confidence: 0.7,
        });
      }

      return findings;
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.unsafe-c-function",
    category: "security",
    title: "Unsafe C string or stack function",
    description:
      "strcpy, strcat, sprintf, gets and alloca have no bounds checking. They are a direct route to buffer overflows and stack corruption.",
    defaultSeverity: "high",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const re = /\b(strcpy|strcat|sprintf|vsprintf|gets|alloca)\s*\(/;
      const findings: Finding[] = [];

      for (const file of data.sourceFiles) {
        const offenders = matchLines(file, re).map((m) => ({ line: m.line, text: m.text }));
        if (offenders.length === 0) continue;
        findings.push({
          ruleId: "native.unsafe-c-function",
          category: "security",
          severity: "high",
          title: `${offenders.length} unsafe C string/stack call(s)`,
          detail:
            "These functions write without knowing the destination size. A long input overwrites the stack or heap, which is both a crash and an exploitable bug.",
          location: `${file.rel}:${offenders[0]!.line}`,
          evidence: evidence(file, offenders),
          fix: "Use std::string, std::span, snprintf with a size, or the platform's safe string API; replace alloca with a container.",
          confidence: 0.85,
        });
      }
      return findings;
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.command-exec",
    category: "security",
    title: "Shell command execution from source",
    description:
      "system(), popen() and WinExec() hand a string to a shell. If any part is user-controlled, it is command injection.",
    defaultSeverity: "high",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const re = /(?<![\w:])(?:system|popen|WinExec)\s*\(\s*[^)\s]|\bstd::system\s*\(\s*[^)\s]/;
      const findings: Finding[] = [];

      for (const file of data.sourceFiles) {
        const offenders = matchLines(file, re).map((m) => ({ line: m.line, text: m.text }));
        if (offenders.length === 0) continue;
        findings.push({
          ruleId: "native.command-exec",
          category: "security",
          severity: "high",
          title: `${offenders.length} shell command call(s)`,
          detail:
            "A shell string is assembled and executed. Quoting rules differ per platform and any variable in the string can break out of the intended command.",
          location: `${file.rel}:${offenders[0]!.line}`,
          evidence: evidence(file, offenders),
          fix: "Use QProcess / CreateProcess / posix_spawn with an explicit program and argument array; never pass a shell string built from input.",
          confidence: 0.8,
        });
      }
      return findings;
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.secret-literal",
    category: "security",
    title: "Credential literal in source",
    description:
      "An API key, token or password is hard-coded in a source file. Anything compiled into the binary is readable.",
    defaultSeverity: "high",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const patterns: RegExp[] = [
        /\b(?:api[_-]?key|secret|token|password|passwd|access[_-]?key)\b\s*[:=]\s*"([^"]{8,})"/i,
        /\bAKIA[0-9A-Z]{16}\b/,
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
        /\bsk-[A-Za-z0-9]{20,}\b/,
      ];
      const placeholder = /^(?:your|changeme|change_me|example|sample|dummy|test|xxx|\*+|<)/i;
      const findings: Finding[] = [];

      for (const file of data.files) {
        if (isTestFile(file)) continue;
        const offenders: Offender[] = [];
        for (const re of patterns) {
          for (const m of matchLines(file, re)) {
            const captured = m.text.match(/[:=]\s*"([^"]+)"/)?.[1] ?? "";
            if (captured && placeholder.test(captured)) continue;
            offenders.push({ line: m.line, text: m.text });
          }
        }
        if (offenders.length === 0) continue;
        offenders.sort((a, b) => a.line - b.line);
        findings.push({
          ruleId: "native.secret-literal",
          category: "security",
          severity: "high",
          title: "Hard-coded credential in source",
          detail:
            "A credential-like literal is compiled into the app. Even if it is only a development key, it ships in the binary and the repository.",
          location: `${file.rel}:${offenders[0]!.line}`,
          evidence: evidence(file, offenders),
          fix: "Load it at runtime from the OS keychain, an environment variable, or a user config; rotate anything that was committed.",
          confidence: 0.7,
        });
      }
      return findings;
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.thread-detach",
    category: "code",
    title: "Detached thread with no lifetime guarantee",
    description:
      "A detached thread can outlive the objects it captures, and nothing can join it. That is a use-after-free waiting for a slow frame.",
    defaultSeverity: "medium",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const re = /\.\s*detach\s*\(\s*\)|pthread_detach\s*\(/;
      const findings: Finding[] = [];

      for (const file of data.sourceFiles) {
        if (isTestFile(file)) continue;
        const offenders = matchLines(file, re).map((m) => ({ line: m.line, text: m.text }));
        if (offenders.length === 0) continue;
        findings.push({
          ruleId: "native.thread-detach",
          category: "code",
          severity: "medium",
          title: `${offenders.length} detached thread(s)`,
          detail:
            "A detached thread has no join point, so it can still be running when captured state is destroyed. Use jthread, a thread pool, or a worker with an explicit stop-and-join.",
          location: `${file.rel}:${offenders[0]!.line}`,
          evidence: evidence(file, offenders),
          fix: "Keep the thread object, signal it to stop, and join it in the owner's destructor (or use std::jthread).",
          confidence: 0.75,
        });
      }
      return findings;
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.blocking-ui",
    category: "performance",
    title: "UI thread blocked by a sleep or wait",
    description:
      "Sleeps and waitForFinished run on the UI thread, so the window stops repainting and resizing while they run.",
    defaultSeverity: "high",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const simple: Array<{ re: RegExp; label: string }> = [
        { re: /QThread::(?:sleep|msleep|usleep)\s*\(/, label: "QThread::sleep" },
        { re: /std::this_thread::sleep_for\s*\(/, label: "sleep_for" },
        { re: /\bSleep\s*\(/, label: "Sleep" },
        { re: /waitForFinished\s*\(/, label: "waitForFinished" },
      ];
      const findings: Finding[] = [];

      for (const file of data.sourceFiles) {
        if (isTestFile(file) || !isUiSource(file)) continue;
        const offenders: Offender[] = [];
        for (const s of simple) {
          for (const m of matchLines(file, s.re)) {
            offenders.push({ line: m.line, text: `${s.label}: ${m.text}` });
          }
        }

        const stripped = stripComments(file.content).split(/\r?\n/);
        for (let i = 0; i < stripped.length; i++) {
          if (!/QApplication::processEvents\s*\(/.test(stripped[i] ?? "")) continue;
          const before = stripped.slice(Math.max(0, i - 12), i).join("\n");
          if (/\b(while|for|do)\s*\(/.test(before)) {
            offenders.push({ line: i + 1, text: "processEvents inside a loop" });
          }
        }

        if (offenders.length === 0) continue;
        offenders.sort((a, b) => a.line - b.line);
        findings.push({
          ruleId: "native.blocking-ui",
          category: "performance",
          severity: "high",
          title: `${offenders.length} blocking UI call(s)`,
          detail:
            "The UI thread is put to sleep or made to wait. The window stops responding to paint, resize and input until the call returns, which reads as a crash to the user.",
          location: `${file.rel}:${offenders[0]!.line}`,
          evidence: evidence(file, offenders),
          fix: "Move the work to a worker (QThreadPool/QtConcurrent/std::jthread), report progress with signals, and keep the UI thread free.",
          confidence: 0.85,
        });
      }
      return findings;
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.delete-this",
    category: "code",
    title: "Object deletes itself",
    description:
      "delete this invites use-after-free when the caller still holds the pointer, and breaks Qt's signal/slot teardown.",
    defaultSeverity: "medium",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const re = /\bdelete\s+this\s*;/;
      const findings: Finding[] = [];

      for (const file of data.sourceFiles) {
        const offenders = matchLines(file, re).map((m) => ({ line: m.line, text: m.text }));
        if (offenders.length === 0) continue;
        findings.push({
          ruleId: "native.delete-this",
          category: "code",
          severity: "medium",
          title: `${offenders.length} self-delete(s)`,
          detail:
            "An object deletes itself from inside its own method. Any caller, signal connection or event still referring to it now holds a dangling pointer.",
          location: `${file.rel}:${offenders[0]!.line}`,
          evidence: evidence(file, offenders),
          fix: "Let the owner delete it, or use deleteLater() for QObject and disconnect first.",
          confidence: 0.8,
        });
      }
      return findings;
    },
  }),
];
