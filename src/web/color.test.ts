import { test } from "node:test";
import assert from "node:assert/strict";
import { parseColor, contrastRatio, toHex } from "./color.js";

test("parses hex and rgb forms", () => {
  assert.deepEqual(parseColor("#ffffff"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor("#000"), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor("rgb(10, 20, 30)"), { r: 10, g: 20, b: 30, a: 1 });
  assert.deepEqual(parseColor("rgba(10, 20, 30, 0.5)"), { r: 10, g: 20, b: 30, a: 0.5 });
});

test("rejects nonsense color strings", () => {
  assert.equal(parseColor("not-a-color"), null);
  assert.equal(parseColor(""), null);
});

test("black on white is 21:1 and white on white is 1:1", () => {
  const black = parseColor("#000000")!;
  const white = parseColor("#ffffff")!;
  assert.equal(Math.round(contrastRatio(black, white)), 21);
  assert.equal(Math.round(contrastRatio(white, white)), 1);
});

test("round-trips a color through hex", () => {
  assert.equal(toHex(parseColor("rgb(18, 52, 86)")!), "#123456");
});
