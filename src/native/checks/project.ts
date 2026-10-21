import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { NativeSnapshot } from "../snapshot.js";
import { allSourceText } from "../source.js";

function buildText(data: NativeSnapshot): string {
  return [...data.cmakeFiles, ...data.projectFiles].map((f) => f.content).join("\n");
}

function buildFile(data: NativeSnapshot) {
  return data.cmakeFiles[0] ?? data.projectFiles[0];
}

export const nativeProjectChecks = [
  defineCheck<NativeSnapshot>({
    id: "native.no-tests",
    category: "code",
    title: "No tests for a non-trivial native codebase",
    description:
      "Hundreds of lines of C++ and no test target. Native defects are memory and lifetime bugs that only a test or a run will reveal.",
    defaultSeverity: "medium",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const codeLines = data.sourceFiles.reduce((sum, f) => sum + f.lines.length, 0);
      if (codeLines < 600) return [];

      const cmake = buildText(data);
      const hasRunner = /\badd_test\s*\(|\benable_testing\s*\(/.test(cmake);
      if (data.testFiles.length > 0 || hasRunner) return [];

      return [
        {
          ruleId: "native.no-tests",
          category: "code",
          severity: "medium",
          title: `${codeLines} lines of C++ with no tests`,
          detail:
            "There is no test source and no test target. Parsing, state, file handling and geometry are exactly the code that breaks silently in a native app; a build only proves it compiles.",
          location: data.root,
          evidence: [{ label: "source lines", value: String(codeLines) }],
          fix: "Add CTest with QtTest, Catch2, GoogleTest or doctest and test the non-UI logic plus the resize/error paths.",
        },
      ];
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.no-sanitizers",
    category: "code",
    title: "No sanitizer configuration",
    description:
      "No AddressSanitizer or UndefinedBehaviorSanitizer option. Use-after-free, overflow and UB otherwise ship silently.",
    defaultSeverity: "low",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const text = buildText(data);
      if (!text.trim()) return [];
      if (/fsanitize|SANITIZE|addresssanitizer|ubsan|asan/i.test(text)) return [];
      const file = buildFile(data);
      return [
        {
          ruleId: "native.no-sanitizers",
          category: "code",
          severity: "low",
          title: "No sanitizer build option",
          detail:
            "Nothing enables AddressSanitizer or UndefinedBehaviorSanitizer. Native memory bugs are silent until the app crashes in front of a user.",
          location: file ? file.rel : data.root,
          evidence: file ? [{ label: "build file", file: file.rel }] : [],
          fix: "Add an opt-in debug option enabling ASan+UBSan (MSVC /fsanitize=address, Clang/GCC -fsanitize=address,undefined) and run the tests under it.",
        },
      ];
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.weak-warnings",
    category: "code",
    title: "Compiler warnings are left at the default",
    description:
      "No /W4, -Wall or -Wextra. Default warning levels hide shadowing, unused results and narrowing that precede real bugs.",
    defaultSeverity: "low",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const text = buildText(data);
      if (!text.trim()) return [];
      if (/\/W4\b|-Wall\b|-Wextra\b|<WarningLevel>\s*Level4/i.test(text)) return [];
      const file = buildFile(data);
      return [
        {
          ruleId: "native.weak-warnings",
          category: "code",
          severity: "low",
          title: "Warnings are not raised",
          detail:
            "The build does not enable /W4 (MSVC) or -Wall -Wextra (Clang/GCC), so unused results, shadowing and narrowing compile without a word.",
          location: file ? file.rel : data.root,
          evidence: file ? [{ label: "build file", file: file.rel }] : [],
          fix: "Enable /W4 and /permissive- for MSVC, or -Wall -Wextra -Wpedantic for Clang/GCC, and fix what appears.",
        },
      ];
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.no-cxx-standard",
    category: "code",
    title: "No C++ standard pinned",
    description:
      "The build does not set a C++ standard, so the compiler default decides which language features and semantics you get.",
    defaultSeverity: "low",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const text = buildText(data);
      if (!text.trim()) return [];
      if (/CXX_STANDARD|cxx_std_\d+|<LanguageStandard>/i.test(text)) return [];
      const file = buildFile(data);
      return [
        {
          ruleId: "native.no-cxx-standard",
          category: "code",
          severity: "low",
          title: "C++ standard is not pinned",
          detail:
            "No CXX_STANDARD, cxx_std_XX or LanguageStandard is set. The build silently changes meaning when the compiler default moves.",
          location: file ? file.rel : data.root,
          evidence: file ? [{ label: "build file", file: file.rel }] : [],
          fix: "Pin the standard explicitly (CMAKE_CXX_STANDARD 20 with CMAKE_CXX_STANDARD_REQUIRED ON, or /std:c++20).",
        },
      ];
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.vulkan-no-validation",
    category: "code",
    title: "Vulkan validation layers are absent",
    description:
      "A Vulkan app with no validation layer or debug messenger. Most Vulkan crashes are misuse that validation would name on the first frame.",
    defaultSeverity: "low",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      if (!data.frameworks.includes("Vulkan")) return [];
      const text = allSourceText(data.files);
      if (/VK_LAYER_KHRONOS_validation|VK_EXT_debug_utils|vkCreateDebugUtilsMessengerEXT|validation/i.test(text)) {
        return [];
      }
      const file = data.sourceFiles.find((f) => /vkCreateInstance/.test(f.content));
      return [
        {
          ruleId: "native.vulkan-no-validation",
          category: "code",
          severity: "low",
          title: "No Vulkan validation layers",
          detail:
            "Validation layers and the debug messenger are not enabled. Invalid handles, missing synchronization and wrong image layouts then present as a crash or a black screen with no diagnosis.",
          location: file ? file.rel : data.root,
          evidence: file ? [{ label: "VkInstance", file: file.rel }] : [],
          fix: "Enable VK_LAYER_KHRONOS_validation and VK_EXT_debug_utils in debug builds, with a debug messenger callback.",
        },
      ];
    },
  }),
];
