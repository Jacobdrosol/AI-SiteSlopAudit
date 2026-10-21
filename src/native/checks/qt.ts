import { defineCheck } from "../../core/registry.js";
import type { Finding } from "../../core/types.js";
import type { NativeSnapshot } from "../snapshot.js";
import { matchLines, textOf } from "../source.js";

const NATIVE_WINDOW = /\bCreateWindowEx[AW]?\s*\(/;
const FOREIGN_WINDOW = /QWindow::fromWinId|createWindowContainer\s*\(/;
const QT_LAYOUT = /\b(QMainWindow|QDockWidget|QSplitter|QHBoxLayout|QVBoxLayout|QGridLayout)\b/;

export const nativeQtChecks = [
  defineCheck<NativeSnapshot>({
    id: "native.qt-native-child-host",
    category: "components",
    title: "Native window embedded in a Qt layout",
    description:
      "A raw Win32 window (or a foreign QWindow) is hosted inside a QMainWindow/QSplitter/QDockWidget layout. Qt does not own the native child's geometry, so it can cover panes or force the central area to its own size after layout.",
    defaultSeverity: "medium",
    appliesTo: ["native"],
    run({ data }): Finding[] {
      if (!data.frameworks.includes("Qt")) return [];

      const layoutFile = data.sourceFiles.find((f) => QT_LAYOUT.test(textOf(f)));
      if (!layoutFile) return [];

      let nativeFile: (typeof data.sourceFiles)[number] | undefined;
      let nativeLine = 0;
      for (const file of data.sourceFiles) {
        for (const match of matchLines(file, NATIVE_WINDOW)) {
          const windowLines = file.lines
            .slice(Math.max(0, match.line - 1), match.line + 3)
            .join("\n");
          if (/WS_CHILD|WS_POPUP/.test(windowLines)) {
            nativeFile = file;
            nativeLine = match.line;
            break;
          }
        }
        if (nativeFile) break;
      }
      if (!nativeFile) {
        nativeFile = data.sourceFiles.find((f) => FOREIGN_WINDOW.test(textOf(f)));
        if (nativeFile) {
          nativeLine = matchLines(nativeFile, FOREIGN_WINDOW)[0]?.line ?? 1;
        }
      }
      if (!nativeFile) return [];

      return [
        {
          ruleId: "native.qt-native-child-host",
          category: "components",
          severity: "medium",
          title: "Native window is embedded inside a Qt pane layout",
          detail:
            "This project combines a native Win32/foreign window with Qt's QMainWindow, splitter or dock layout. The native window is not managed by Qt: after the layout settles it can keep its pre-layout size, cover the Inspector/Output, or force the central pane to the full window. This is the pattern that made the Arcstone Qt shell lose panes.",
          location: `${nativeFile.rel}:${nativeLine}`,
          evidence: [
            { label: "native window", file: nativeFile.rel, line: nativeLine },
            { label: "Qt layout", file: layoutFile.rel },
          ],
          fix: "Prefer rendering the viewport to an offscreen target displayed by a normal Qt widget (QRhiWidget, texture, or image). If a foreign window is required, use a tested QWindow container and assert every pane is visible with non-zero geometry after show/resize.",
          confidence: 0.75,
        },
      ];
    },
  }),
];
