export interface RGB {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(input: string): RGB | null {
  const value = input.trim().toLowerCase();
  const rgbMatch = value.match(
    /rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/,
  );
  if (rgbMatch) {
    return {
      r: Number(rgbMatch[1]),
      g: Number(rgbMatch[2]),
      b: Number(rgbMatch[3]),
      a: rgbMatch[4] ? parseAlpha(rgbMatch[4]) : 1,
    };
  }
  const hex = value.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const h = hex[1]!;
    if (h.length === 3 || h.length === 4) {
      return {
        r: parseInt(h[0]! + h[0]!, 16),
        g: parseInt(h[1]! + h[1]!, 16),
        b: parseInt(h[2]! + h[2]!, 16),
        a: h.length === 4 ? parseInt(h[3]! + h[3]!, 16) / 255 : 1,
      };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  return null;
}

function parseAlpha(v: string): number {
  if (v.endsWith("%")) return Math.min(1, parseFloat(v) / 100);
  return Math.min(1, parseFloat(v));
}

export function relativeLuminance(c: RGB): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrastRatio(fg: RGB, bg: RGB): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function composite(fg: RGB, bg: RGB): RGB {
  if (fg.a >= 1) return fg;
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

export function isNearGray(c: RGB, tolerance = 6): boolean {
  return (
    Math.abs(c.r - c.g) <= tolerance && Math.abs(c.g - c.b) <= tolerance
  );
}

export function isPurple(c: RGB): boolean {
  return c.b > 100 && c.r > 60 && c.b > c.g + 40 && c.r > c.g + 10;
}

export function isBlue(c: RGB): boolean {
  return c.b > 120 && c.b > c.r + 30 && c.g > c.r;
}

export function toHex(c: RGB): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function hexToRgb(hex: string): RGB | null {
  return parseColor(hex);
}
