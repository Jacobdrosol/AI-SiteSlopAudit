import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { NativeSnapshot } from "../snapshot.js";
import { countHexColors, isTestFile, matchLines, stripComments } from "../source.js";

const INTERACTIVE_QT =
  /\b(QPushButton|QToolButton|QCheckBox|QRadioButton|QComboBox|QListView|QTreeView|QTableView|QTabBar|QSlider|QMenu|Button\s*\{|MouseArea\s*\{)/;

const PLACEHOLDER =
  /lorem ipsum|coming soon|\bTBD\b|placeholder text|sample text|your (?:text|content|company) here|insert .* here/i;

const ABSOLUTE_PATH =
  /"[A-Za-z]:[\\/]{1,2}(?:Users|Documents|Projects|Program Files)[\\/]|"\/(?:home|Users)\/[^"]+"/;

const TASK_MARKER =
  /(?:\/\/|\/\*|^\s*\*)\s*(TODO|FIXME|HACK|XXX)\b/;

function isThemeFile(rel: string): boolean {
  return /(^|\/)(themes?|palettes?|colors?|tokens?|styles?)(\/|\.|$)/i.test(rel) || /\.qss$/i.test(rel);
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

export const nativeSlopChecks = [
  defineCheck<NativeSnapshot>({
    id: "native.fixed-window",
    category: "layout",
    title: "Top-level window cannot resize",
    description:
      "A main window is pinned to a fixed size (setFixedSize, fixed QML/.ui constraints, or a Win32 style without a sizing frame).",
    defaultSeverity: "medium",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];

      for (const file of [...data.sourceFiles, ...data.uiFiles]) {
        const offenders: Array<{ line: number; text: string }> = [];

        if (/(^|\/)(mainwindow|window|main|dialog|app)\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(file.rel)) {
          for (const m of matchLines(file, /(?:this->|QMainWindow::|QDialog::)?setFixedSize\s*\(/)) {
            offenders.push({ line: m.line, text: m.text });
          }
          for (const m of matchLines(file, /MSWindowsFixedSizeDialogHint/)) {
            offenders.push({ line: m.line, text: m.text });
          }
        }

        if (/\.ui$/i.test(file.rel)) {
          const min = file.content.match(/<property name="minimumSize">[\s\S]*?<width>(\d+)<\/width>[\s\S]*?<height>(\d+)<\/height>/);
          const max = file.content.match(/<property name="maximumSize">[\s\S]*?<width>(\d+)<\/width>[\s\S]*?<height>(\d+)<\/height>/);
          if (min && max && Number(min[1]) > 0 && min[1] === max[1] && min[2] === max[2]) {
            offenders.push({ line: lineOf(file.content, min.index ?? 0), text: `fixed ${min[1]}x${min[2]}` });
          }
        }

        if (/\.qml$/i.test(file.rel)) {
          const minW = file.content.match(/minimumWidth\s*:\s*(\d+)/);
          const maxW = file.content.match(/maximumWidth\s*:\s*(\d+)/);
          if (minW && maxW && minW[1] === maxW[1]) {
            offenders.push({ line: lineOf(file.content, minW.index ?? 0), text: `fixed width ${minW[1]}` });
          }
        }

        const win32 = /CreateWindowEx[AW]?\s*\(/.test(file.content);
        if (win32 && /\bWS_CAPTION\b/.test(file.content) && !/\bWS_THICKFRAME\b|\bWS_SIZEBOX\b|\bWS_OVERLAPPEDWINDOW\b/.test(file.content)) {
          const m = file.content.match(/CreateWindowEx[AW]?\s*\(/);
          offenders.push({ line: lineOf(file.content, m?.index ?? 0), text: "window style has no sizing frame" });
        }

        if (offenders.length === 0) continue;
        findings.push({
          ruleId: "native.fixed-window",
          category: "layout",
          severity: "medium",
          title: "A top-level window is fixed-size",
          detail:
            "The window cannot be resized, so it clips on a smaller screen and wastes space on a larger one. Fixed-size windows are also the first thing reviewers notice.",
          location: `${file.rel}:${offenders[0]!.line}`,
          evidence: offenders.slice(0, 6).map((o) => ({ label: o.text.slice(0, 100), file: file.rel, line: o.line })),
          fix: "Use a resizable window with minimum sizes and responsive layouts; let content scroll instead of pinning the frame.",
          confidence: 0.7,
        });
      }

      return findings;
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.qt-missing-cursor",
    category: "accessibility",
    title: "Qt controls never show a pointer cursor",
    description:
      "Buttons and item views keep the arrow cursor, so pressable controls do not read as clickable.",
    defaultSeverity: "medium",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      if (!data.frameworks.includes("Qt")) return [];
      const all = [...data.sourceFiles, ...data.uiFiles].map((f) => f.content).join("\n");
      if (!INTERACTIVE_QT.test(all)) return [];
      if (/PointingHandCursor|cursor\s*:\s*pointer/i.test(all)) return [];

      const file = [...data.sourceFiles, ...data.uiFiles].find((f) => INTERACTIVE_QT.test(f.content));
      return [
        {
          ruleId: "native.qt-missing-cursor",
          category: "accessibility",
          severity: "medium",
          title: "Interactive Qt controls do not set a pointer cursor",
          detail:
            "None of the buttons, item views or inputs change the cursor. A control that looks pressable but keeps the arrow cursor feels dead.",
          location: file ? file.rel : data.root,
          evidence: file ? [{ label: "interactive control", file: file.rel }] : [],
          fix: "Set setCursor(Qt::PointingHandCursor) on buttons, item views and sliders, or add cursor: pointer in the stylesheet for those selectors.",
          confidence: 0.8,
        },
      ];
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.qt-chart-no-axis",
    category: "components",
    title: "Custom chart draws no axis labels",
    description:
      "A custom-painted chart draws marks but no text, so there is no scale on either axis.",
    defaultSeverity: "medium",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];

      for (const file of data.sourceFiles) {
        if (!/chart|graph|plot/i.test(file.rel)) continue;
        if (!/paintEvent|paintGL|QPainter/.test(file.content)) continue;
        if (!/drawRect|drawLine|drawPath|drawEllipse|drawPie|drawPolyline/.test(file.content)) continue;
        if (/drawText|QTextOption|QFontMetrics/.test(file.content)) continue;

        findings.push({
          ruleId: "native.qt-chart-no-axis",
          category: "components",
          severity: "medium",
          title: "Chart draws marks but no axis labels",
          detail:
            "The chart paints bars or lines without any text, so the reader gets shapes with no scale. A chart needs both an x axis and a y axis with values.",
          location: file.rel,
          evidence: [{ label: "chart", file: file.rel }],
          fix: "Draw tick labels with QPainter::drawText on both axes, including a baseline and value labels.",
          confidence: 0.6,
        });
      }

      return findings;
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.placeholder-content",
    category: "content",
    title: "Placeholder copy in shipped UI",
    description: "Lorem ipsum, 'coming soon', TBD and similar filler compiled into the app.",
    defaultSeverity: "medium",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];

      for (const file of [...data.sourceFiles, ...data.uiFiles]) {
        if (isTestFile(file)) continue;
        const lines = matchLines(file, PLACEHOLDER);
        if (lines.length === 0) continue;
        findings.push({
          ruleId: "native.placeholder-content",
          category: "content",
          severity: "medium",
          title: `${lines.length} placeholder string(s)`,
          detail:
            "Filler copy in a shipped interface reads as unfinished. Replace it with real, specific copy or remove the surface.",
          location: `${file.rel}:${lines[0]!.line}`,
          evidence: lines.slice(0, 6).map((m) => ({ label: m.text.slice(0, 100), file: file.rel, line: m.line })),
          fix: "Write the real copy in the product's voice.",
          confidence: 0.85,
        });
      }

      return findings;
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.hardcoded-color",
    category: "color",
    title: "Colour literals in native code",
    description:
      "Hex colours scattered through C++ paint/setStyleSheet code instead of one theme or stylesheet.",
    defaultSeverity: "low",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];

      for (const file of data.sourceFiles) {
        if (isTestFile(file) || isThemeFile(file.rel)) continue;
        const count = countHexColors(file);
        const inlineStyle = /setStyleSheet\s*\([^)]*#[0-9a-fA-F]{3,8}/.test(stripComments(file.content));
        if (count < 5 && !inlineStyle) continue;

        const text = stripComments(file.content);
        const first = text.search(/#[0-9a-fA-F]{3,8}\b/);
        findings.push({
          ruleId: "native.hardcoded-color",
          category: "color",
          severity: "low",
          title: inlineStyle ? "Inline stylesheet contains a literal colour" : `${count} colour literals in code`,
          detail:
            "Colours are written directly in C++ instead of a theme, palette or stylesheet. They drift, break dark mode, and cannot be changed in one place.",
          location: `${file.rel}:${first >= 0 ? lineOf(text, first) : 1}`,
          evidence: [{ label: "colour literals", file: file.rel, value: String(count) }],
          fix: "Move colours into one palette/stylesheet and reference them by name.",
          confidence: 0.65,
        });
      }

      return findings;
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.hardcoded-absolute-path",
    category: "code",
    title: "Machine-specific absolute path",
    description:
      "A literal C:\\Users\\..., /home/... or /Users/... path. It works on the author's machine and fails everywhere else.",
    defaultSeverity: "medium",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];

      for (const file of data.sourceFiles) {
        const lines = matchLines(file, ABSOLUTE_PATH);
        if (lines.length === 0) continue;
        findings.push({
          ruleId: "native.hardcoded-absolute-path",
          category: "code",
          severity: "medium",
          title: `${lines.length} hard-coded absolute path(s)`,
          detail:
            "A path is tied to one machine's home directory or drive layout, so the app fails for every other user and in a packaged build.",
          location: `${file.rel}:${lines[0]!.line}`,
          evidence: lines.slice(0, 6).map((m) => ({ label: m.text.slice(0, 120), file: file.rel, line: m.line })),
          fix: "Resolve paths at runtime with QStandardPaths, std::filesystem and the executable location; store the rest in user settings.",
          confidence: 0.9,
        });
      }

      return findings;
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.todo-markers",
    category: "code",
    title: "Unresolved task markers in native code",
    description: "Markers that record known unfinished or broken code.",
    defaultSeverity: "low",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const findings: Finding[] = [];

      for (const file of data.sourceFiles) {
        if (isTestFile(file)) continue;
        const offenders: Array<{ line: number; text: string }> = [];
        file.lines.forEach((line, i) => {
          const m = line.match(TASK_MARKER);
          if (m) offenders.push({ line: i + 1, text: line.trim() });
        });
        if (offenders.length === 0) continue;
        findings.push({
          ruleId: "native.todo-markers",
          category: "code",
          severity: "low",
          title: `${offenders.length} unresolved task marker(s)`,
          detail:
            "These markers usually point at a known defect or an unfinished path. Each one is a claim the app is not done.",
          location: `${file.rel}:${offenders[0]!.line}`,
          evidence: offenders.slice(0, 8).map((o) => ({ label: o.text.slice(0, 120), file: file.rel, line: o.line })),
          fix: "Resolve it, or move it to the issue tracker; do not ship the marker.",
          confidence: 0.9,
        });
      }

      return findings;
    },
  }),

  defineCheck<NativeSnapshot>({
    id: "native.oversized-file",
    category: "code",
    title: "Oversized native source file",
    description: "A single C/C++ file large enough that ownership and lifetime are hard to review.",
    defaultSeverity: "low",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      const limit = 800;
      return data.sourceFiles
        .filter((f) => f.lines.length > limit)
        .sort((a, b) => b.lines.length - a.lines.length)
        .slice(0, 5)
        .map((f) => ({
          ruleId: "native.oversized-file",
          category: "code" as const,
          severity: "low" as const,
          title: `Source file is ${f.lines.length} lines`,
          detail: `${f.rel} is ${f.lines.length} lines. Large native files hide ownership bugs and duplicated resource handling.`,
          location: `${f.rel}:1`,
          evidence: [{ label: "lines", file: f.rel, line: 1, value: String(f.lines.length) }],
          fix: "Split by responsibility (window, rendering, state, IO) and keep ownership in one obvious place.",
        }));
    },
  }),
];
