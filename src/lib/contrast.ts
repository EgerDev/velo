/** WCAG 2.x relative luminance and contrast — used to lock the palette. */

export function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace("#", "").trim();
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Bad hex: ${hex}`);
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsAa(foreground: string, background: string, large = false): boolean {
  return contrastRatio(foreground, background) >= (large ? 3 : 4.5);
}

export function meetsAaa(foreground: string, background: string, large = false): boolean {
  return contrastRatio(foreground, background) >= (large ? 4.5 : 7);
}

/** Keep in sync with `src/styles.css` @theme. */
export const PALETTE = {
  bg: "#0a0a0b",
  surface: "#121214",
  elevated: "#1a1a1e",
  fg: "#f4f4f5",
  muted: "#c4c4cc",
  subtle: "#9a9aa3",
  accent: "#d4d4d8",
  accentFg: "#0a0a0b",
  danger: "#f0a090",
  success: "#9fbf9a",
} as const;

export const AA_PAIRS: Array<{ fg: keyof typeof PALETTE; bg: keyof typeof PALETTE; large?: boolean }> = [
  { fg: "fg", bg: "bg" },
  { fg: "fg", bg: "surface" },
  { fg: "fg", bg: "elevated" },
  { fg: "muted", bg: "bg" },
  { fg: "muted", bg: "surface" },
  { fg: "muted", bg: "elevated" },
  { fg: "subtle", bg: "bg" },
  { fg: "subtle", bg: "surface" },
  { fg: "subtle", bg: "elevated" },
  { fg: "accentFg", bg: "accent" },
  { fg: "danger", bg: "bg" },
  { fg: "danger", bg: "surface" },
  { fg: "success", bg: "bg" },
  { fg: "success", bg: "surface" },
];
