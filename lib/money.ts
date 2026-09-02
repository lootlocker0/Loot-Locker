/** All money is integer cents. This module is the only place cents become text. */

export function formatCents(cents: number, locale = "en-CA"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}

/** basis points -> cents. 500 bps = 5%. */
export function applyBps(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10_000);
}

export function sumLines(
  lines: { unitPriceCents: number; qty: number }[],
): number {
  return lines.reduce((acc, l) => acc + l.unitPriceCents * l.qty, 0);
}

/** Guard used at every trust boundary. */
export function assertCents(n: unknown, field: string): asserts n is number {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    throw new Error(`${field} must be a non-negative integer cent value`);
  }
}
