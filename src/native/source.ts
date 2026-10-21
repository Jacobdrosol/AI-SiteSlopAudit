import type { NativeFile } from "./snapshot.js";

/**
 * Remove // and block comments while preserving character offsets and line
 * numbers. Strings and character literals are kept, so checks can still inspect
 * literal text (secrets, placeholder copy) without matching commented-out code.
 */
export function stripComments(content: string): string {
  let out = "";
  let i = 0;
  let state: "code" | "line" | "block" | "double" | "single" = "code";
  while (i < content.length) {
    const c = content[i]!;
    const next = content[i + 1] ?? "";

    if (state === "code") {
      if (c === "/" && next === "/") {
        state = "line";
        out += "  ";
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        state = "block";
        out += "  ";
        i += 2;
        continue;
      }
      if (c === '"') state = "double";
      else if (c === "'") state = "single";
      out += c;
      i++;
      continue;
    }

    if (state === "line") {
      if (c === "\n") {
        state = "code";
        out += c;
      } else {
        out += " ";
      }
      i++;
      continue;
    }

    if (state === "block") {
      if (c === "*" && next === "/") {
        state = "code";
        out += "  ";
        i += 2;
        continue;
      }
      out += c === "\n" ? "\n" : " ";
      i++;
      continue;
    }

    // String or character literal.
    if (c === "\\") {
      out += c + next;
      i += 2;
      continue;
    }
    if ((state === "double" && c === '"') || (state === "single" && c === "'")) {
      state = "code";
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Blank string and character literal contents while preserving offsets and
 * line numbers. Use this for code-shape checks: a function name inside an
 * error message ("vkCreateBuffer failed") is not a call.
 */
export function stripLiterals(content: string): string {
  let out = "";
  let i = 0;
  let state: "code" | "double" | "single" = "code";
  while (i < content.length) {
    const c = content[i]!;
    if (state === "code") {
      if (c === '"') state = "double";
      else if (c === "'") state = "single";
      out += c;
      i++;
      continue;
    }
    if (c === "\\") {
      out += "  ";
      i += 2;
      continue;
    }
    if ((state === "double" && c === '"') || (state === "single" && c === "'")) {
      state = "code";
      out += c;
      i++;
      continue;
    }
    out += c === "\n" ? "\n" : " ";
    i++;
  }
  return out;
}

export function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

export interface LineMatch {
  line: number;
  text: string;
  index: number;
}

export function matchLines(file: NativeFile, re: RegExp): LineMatch[] {
  const stripped = stripComments(file.content);
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const seen = new Set<number>();
  const matches: LineMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = global.exec(stripped)) !== null) {
    const line = lineAt(stripped, match.index);
    if (seen.has(line)) continue;
    seen.add(line);
    matches.push({ line, text: (file.lines[line - 1] ?? "").trim(), index: match.index });
    if (global.lastIndex === match.index) global.lastIndex++;
  }
  return matches;
}

export function textOf(file: NativeFile): string {
  return stripComments(file.content);
}

export function isTestFile(file: NativeFile): boolean {
  return file.kind === "test";
}

export function isHeader(file: NativeFile): boolean {
  return file.kind === "header";
}

export function isSource(file: NativeFile): boolean {
  return file.kind === "source" || file.kind === "header";
}

export function isUiSource(file: NativeFile): boolean {
  return (
    /(^|\/)(mainwindow|window|widget|view|page|dialog|screen|app|main)\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(file.rel) ||
    /\bQ(Application|MainWindow|Widget|Dialog|QuickView|QuickWindow)\b/.test(file.content) ||
    /#include\s*<Q(Application|MainWindow|Widget|Dialog|QuickView|QuickWindow)>/.test(file.content)
  );
}

export function allSourceText(files: NativeFile[]): string {
  return files.filter(isSource).map((f) => stripComments(f.content)).join("\n");
}

export function countHexColors(file: NativeFile): number {
  const text = stripComments(file.content);
  const matches = text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  return new Set(matches.map((m) => m.toLowerCase())).size;
}
