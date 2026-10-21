import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreFindings, toGrade } from "./scoring.js";
import { resolveConfig } from "./config.js";
import type { Finding, Category } from "./types.js";

function finding(overrides: Partial<Finding> & { ruleId: string }): Finding {
  return {
    category: "layout",
    severity: "medium",
    title: "t",
    detail: "d",
    ...overrides,
  };
}

test("no findings scores a perfect grade", () => {
  const result = scoreFindings([], resolveConfig("default"), ["layout"]);
  assert.equal(result.score, 100);
  assert.equal(result.grade, "A");
  assert.equal(result.totalFindings, 0);
});

test("grade bands map at the documented boundaries", () => {
  assert.equal(toGrade(100), "A");
  assert.equal(toGrade(90), "A");
  assert.equal(toGrade(89.9), "B");
  assert.equal(toGrade(78), "B");
  assert.equal(toGrade(77.9), "C");
  assert.equal(toGrade(64), "C");
  assert.equal(toGrade(63.9), "D");
  assert.equal(toGrade(50), "D");
  assert.equal(toGrade(49.9), "F");
});

test("repeating one rule decays rather than scaling linearly", () => {
  const config = resolveConfig("default");
  const one = scoreFindings([finding({ ruleId: "a.b" })], config, ["layout"]);
  const two = scoreFindings(
    [finding({ ruleId: "a.b" }), finding({ ruleId: "a.b" })],
    config,
    ["layout"],
  );
  const penaltyOne = 100 - one.categories[0]!.score;
  const penaltyTwo = 100 - two.categories[0]!.score;
  assert.ok(penaltyTwo > penaltyOne, "two findings hurt more than one");
  assert.ok(penaltyTwo < penaltyOne * 2, "but less than twice as much");
});

test("only audited categories are scored", () => {
  const config = resolveConfig("default");
  const result = scoreFindings([], config, ["layout", "security"]);
  assert.deepEqual(
    result.categories.map((c) => c.category).sort(),
    ["layout", "security"] as Category[],
  );
});

test("a slop tell costs far more than a hygiene nit", () => {
  const config = resolveConfig("default");
  const slopTell = scoreFindings(
    [finding({ ruleId: "layout.motif-stacking", category: "layout", severity: "high" })],
    config,
    ["layout"],
  );
  const hygiene = scoreFindings(
    [finding({ ruleId: "security.nosniff", category: "security", severity: "low" })],
    config,
    ["security"],
  );
  assert.ok(
    slopTell.score < hygiene.score,
    "a repeated-motif tell weighs more than a missing header",
  );
});

test("rule weight override changes the penalty", () => {
  const base = resolveConfig("default");
  const muted = resolveConfig("default", { "layout.hero-signature": { weight: 0 } });
  const f = [finding({ ruleId: "layout.hero-signature", category: "layout", severity: "high" })];
  const normal = scoreFindings(f, base, ["layout"]);
  const silenced = scoreFindings(f, muted, ["layout"]);
  assert.ok(normal.score < silenced.score, "weight 0 removes the penalty");
});

test("repeating a tell costs more but sub-linearly", () => {
  const config = resolveConfig("default");
  const one = scoreFindings(
    [finding({ ruleId: "layout.motif-stacking", category: "layout", severity: "high" })],
    config,
    ["layout"],
  );
  const three = scoreFindings(
    [
      finding({ ruleId: "layout.motif-stacking", category: "layout", severity: "high" }),
      finding({ ruleId: "layout.motif-stacking", category: "layout", severity: "high" }),
      finding({ ruleId: "layout.motif-stacking", category: "layout", severity: "high" }),
    ],
    config,
    ["layout"],
  );
  assert.ok(three.score < one.score, "three instances hurt more than one");
});
