/** Helpers for scanning XAML opening tags without a full XML parser. */

export interface TagMatch {
  tag: string;
  name: string;
  attrs: string;
  selfClosing: boolean;
  index: number;
}

export function forEachOpeningTag(
  content: string,
  names: string[],
  fn: (match: TagMatch) => void,
): void {
  const re = new RegExp(`<(${names.join("|")})\\b([^>]*?)(\\/?)>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    fn({
      tag: match[0],
      name: match[1]!,
      attrs: match[2] ?? "",
      selfClosing: (match[3] ?? "") === "/",
      index: match.index,
    });
  }
}

export function attr(attrs: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*"([^"]*)"`, "i");
  const match = attrs.match(re);
  return match ? match[1]! : null;
}

export function hasAttr(attrs: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}\\s*=`, "i").test(attrs);
}

export function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

export function isResourceRef(value: string | null): boolean {
  return !!value && value.trim().startsWith("{");
}

export function isNumberLiteral(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}
