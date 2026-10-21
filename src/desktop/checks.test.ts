import { test } from "node:test";
import assert from "node:assert/strict";
import { Registry } from "../core/registry.js";
import type { AuditOptions, Check } from "../core/types.js";
import { resolveConfig } from "../core/config.js";
import { runChecks } from "../core/runner.js";
import { desktopControlChecks } from "./checks/controls.js";
import { desktopLayoutChecks } from "./checks/layout.js";
import { desktopPerformanceChecks } from "./checks/performance.js";
import { desktopInteractionChecks } from "./checks/interaction.js";
import type { DesktopFile, DesktopSnapshot } from "./snapshot.js";

function file(rel: string, content: string): DesktopFile {
  return {
    path: rel,
    rel,
    ext: rel.slice(rel.lastIndexOf(".")),
    content,
    lines: content.split("\n"),
  };
}

function snapshot(xaml: string[], cs: string[] = []): DesktopSnapshot {
  const xamlFiles = xaml.map((content, i) => file(`Views/View${i}.axaml`, content));
  const csFiles = cs.map((content, i) => file(`Services/Service${i}.cs`, content));
  return {
    root: "/project",
    files: [...xamlFiles, ...csFiles],
    xamlFiles,
    csFiles,
    projectFiles: [],
    frameworks: ["Avalonia"],
    totalFiles: xamlFiles.length + csFiles.length,
    totalLines: 0,
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

async function run(checks: Check<DesktopSnapshot>[], snap: DesktopSnapshot) {
  const registry = new Registry();
  registry.registerAll(checks as Check[]);
  return runChecks(
    { kind: "desktop", label: "test", ref: "test" },
    snap,
    registry.forTarget("desktop"),
    options(),
  );
}

test("flags a control with no action but not a wired one", async () => {
  const snap = snapshot([
    `<StackPanel><Button Content="Save" /><Button Content="Cancel" Command="{Binding CancelCommand}" /></StackPanel>`,
  ]);
  const result = await run(desktopControlChecks, snap);
  const finding = result.findings.find((f) => f.ruleId === "desktop.dead-control");
  assert.ok(finding);
  assert.match(finding!.title, /1 control/);
});

test("flags an empty control with no accessible name", async () => {
  const snap = snapshot([`<Button Command="{Binding PingCommand}" />`]);
  const result = await run(desktopControlChecks, snap);
  assert.ok(result.findings.some((f) => f.ruleId === "desktop.unlabeled-control"));
});

test("flags placeholder copy in a view", async () => {
  const snap = snapshot([`<TextBlock Text="Coming soon" />`]);
  const result = await run(desktopLayoutChecks, snap);
  assert.ok(result.findings.some((f) => f.ruleId === "desktop.placeholder-content"));
});

test("flags hard-coded colours in views, not in style dictionaries", async () => {
  const view = await run(desktopLayoutChecks, snapshot([`<Border Background="#FF0000" />`]));
  assert.ok(view.findings.some((f) => f.ruleId === "desktop.hardcoded-color"));

  const styled = file("Styles/AppStyles.axaml", `<Border Background="#FF0000" />`);
  const styleSnap: DesktopSnapshot = {
    ...snapshot([]),
    files: [styled],
    xamlFiles: [styled],
  };
  const styles = await run(desktopLayoutChecks, styleSnap);
  assert.equal(styles.findings.filter((f) => f.ruleId === "desktop.hardcoded-color").length, 0);
});

test("flags a fixed-size container but not a window with minimums", async () => {
  const fixed = await run(desktopLayoutChecks, snapshot([`<Grid Width="800" Height="600" />`]));
  assert.ok(fixed.findings.some((f) => f.ruleId === "desktop.fixed-size"));

  const window = await run(
    desktopLayoutChecks,
    snapshot([`<Window Width="1200" Height="800" MinWidth="900" MinHeight="600" />`]),
  );
  assert.equal(window.findings.filter((f) => f.ruleId === "desktop.fixed-size").length, 0);
});

test("flags blocking calls and ignores commented ones", async () => {
  const snap = snapshot(
    [],
    [[
      `var data = LoadAsync().Result;`,
      `// task.Wait() is called out in this comment`,
      `Thread.Sleep(500);`,
    ].join("\n")],
  );
  const result = await run(desktopPerformanceChecks, snap);
  const finding = result.findings.find((f) => f.ruleId === "desktop.ui-thread-blocking");
  assert.ok(finding);
  assert.match(finding!.title, /2 blocking/);
});

test("flags missing pointer cursor only when controls exist and no style sets it", async () => {
  const without = await run(
    desktopInteractionChecks,
    snapshot([`<Button Content="Save" Command="{Binding SaveCommand}" />`]),
  );
  assert.ok(without.findings.some((f) => f.ruleId === "desktop.missing-pointer-cursor"));

  const styled = await run(
    desktopInteractionChecks,
    snapshot([
      `<Style Selector="Button"><Setter Property="Cursor" Value="Hand"/></Style><Button Content="Save" Command="{Binding SaveCommand}" />`,
    ]),
  );
  assert.equal(
    styled.findings.filter((f) => f.ruleId === "desktop.missing-pointer-cursor").length,
    0,
  );
});

test("flags a chart control that draws no axis labels", async () => {
  const noText = `public sealed class MiniChart : Control { public override void Render(DrawingContext context) { context.DrawRectangle(Brushes.Blue, null, new Rect(0, 0, 10, 10)); } }`;
  const withText = `public sealed class FullChart : Control { public override void Render(DrawingContext context) { var t = new FormattedText("0", CultureInfo.CurrentCulture, FlowDirection.LeftToRight, Typeface.Default, 10, Brushes.Gray); context.DrawText(t, new Point(0, 0)); } }`;

  const bad = await run(desktopInteractionChecks, snapshot([], [noText]));
  assert.ok(bad.findings.some((f) => f.ruleId === "desktop.chart-no-axis"));

  const good = await run(desktopInteractionChecks, snapshot([], [withText]));
  assert.equal(good.findings.filter((f) => f.ruleId === "desktop.chart-no-axis").length, 0);
});

test("flags an oversized view", async () => {
  const big = Array.from({ length: 450 }, (_, i) => `<TextBlock Text="Line ${i}" />`).join("\n");
  const result = await run(desktopLayoutChecks, snapshot([big]));
  assert.ok(result.findings.some((f) => f.ruleId === "desktop.oversized-view"));
});
