import assert from "node:assert/strict";
import { test } from "node:test";
import { AA_PAIRS, PALETTE, contrastRatio, meetsAa, meetsAaa, relativeLuminance } from "./contrast.ts";

test("body and muted text meet WCAG AA on every surface", () => {
  for (const pair of AA_PAIRS) {
    const fg = PALETTE[pair.fg];
    const bg = PALETTE[pair.bg];
    const ratio = contrastRatio(fg, bg);
    assert.ok(
      meetsAa(fg, bg, pair.large),
      `${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1 — need ${pair.large ? 3 : 4.5}:1`,
    );
  }
});

test("primary type reaches AAA on the page background", () => {
  assert.ok(meetsAaa(PALETTE.fg, PALETTE.bg));
  assert.ok(contrastRatio(PALETTE.accentFg, PALETTE.accent) >= 7);
});

test("accent button is dark ink on light paper", () => {
  assert.ok(meetsAaa(PALETTE.accentFg, PALETTE.accent));
  assert.ok(relativeLuminance(PALETTE.accent) > relativeLuminance(PALETTE.accentFg));
});
