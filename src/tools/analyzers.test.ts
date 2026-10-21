import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClangTidy, parseCppcheck } from "./index.js";

test("cppcheck JSON becomes findings with a relative location", () => {
  const stdout = JSON.stringify({
    errors: [
      {
        file: "C:/project/src/renderer.cpp",
        line: 12,
        severity: "error",
        message: "Null pointer dereference: device",
        id: "nullPointer",
      },
      {
        file: "C:/project/src/renderer.cpp",
        line: 40,
        severity: "warning",
        message: "Resource leak: swapchain",
        id: "memleak",
      },
    ],
  });
  const findings = parseCppcheck(stdout, "C:/project");
  assert.equal(findings.length, 2);
  assert.equal(findings[0]?.severity, "high");
  assert.equal(findings[0]?.location, "src/renderer.cpp:12");
  assert.equal(findings[1]?.severity, "medium");
});

test("cppcheck output that is not JSON is ignored", () => {
  assert.deepEqual(parseCppcheck("Checking a.cpp ...", "C:/project"), []);
});

test("clang-tidy warnings are parsed and notes are skipped", () => {
  const stdout = [
    "C:/project/src/renderer.cpp:10:5: warning: object used after it was moved [bugprone-use-after-move]",
    "C:/project/src/renderer.cpp:11:5: note: move occurred here",
    "C:/project/src/renderer.cpp:20:9: error: no matching function [clang-diagnostic-error]",
    "2 warnings and 1 error generated.",
  ].join("\n");
  const matches = parseClangTidy(stdout);
  assert.equal(matches.length, 2);
  assert.equal(matches[0]?.check, "bugprone-use-after-move");
  assert.equal(matches[0]?.line, 10);
  assert.equal(matches[1]?.severity, "error");
});
