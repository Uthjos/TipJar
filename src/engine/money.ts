import type { Cents } from './types';

/** Tolerance used when comparing floating-point quotas, so 0.5 and 0.49999999999 tie. */
const EPS = 1e-9;

/**
 * Split an integer `total` into integer parts proportional to `weights`, using the
 * largest-remainder (Hamilton) method. Parts always sum exactly to `total`.
 * Ties on the fractional remainder are broken by lower index first.
 *
 * @throws if weights are empty, any weight is negative / non-finite, or all weights are zero.
 */
export function splitLargestRemainder(total: Cents, weights: number[]): Cents[] {
  if (!Number.isInteger(total)) {
    throw new Error(`splitLargestRemainder: total must be an integer, got ${total}`);
  }
  if (weights.length === 0) {
    throw new Error('splitLargestRemainder: weights must not be empty');
  }
  let weightSum = 0;
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) {
      throw new Error(`splitLargestRemainder: invalid weight ${w}`);
    }
    weightSum += w;
  }
  if (weightSum <= 0) {
    throw new Error('splitLargestRemainder: all weights are zero');
  }

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);

  const quotas = weights.map((w) => (abs * w) / weightSum);
  const parts = quotas.map((q) => Math.floor(q + EPS));
  const fracs = quotas.map((q, i) => q - parts[i]!);

  let leftover = abs - parts.reduce((a, b) => a + b, 0);

  // Order indices by fractional part desc, then index asc (deterministic tie-break).
  const order = weights
    .map((_, i) => i)
    .sort((a, b) => {
      const d = fracs[b]! - fracs[a]!;
      if (Math.abs(d) > EPS) return d;
      return a - b;
    });

  for (let k = 0; leftover > 0; k = (k + 1) % order.length) {
    const i = order[k]!;
    if (weights[i]! > 0) {
      parts[i]! += 1;
      leftover -= 1;
    }
  }
  // Floating-point safety: if flooring with EPS overshot, take back from the smallest fractions.
  for (let k = order.length - 1; leftover < 0; k = (k - 1 + order.length) % order.length) {
    const i = order[k]!;
    if (parts[i]! > 0) {
      parts[i]! -= 1;
      leftover += 1;
    }
  }

  return parts.map((p) => (p === 0 ? 0 : p * sign));
}

/** Round down to a whole dollar (e.g. 10217 -> 10200). */
export function floorToDollar(c: Cents): Cents {
  return Math.floor(c / 100) * 100;
}

/** Format cents for display, e.g. 123456 -> "$1,234.56", -500 -> "-$5.00". */
export function formatCents(c: Cents): string {
  const negative = c < 0;
  const abs = Math.abs(Math.round(c));
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  const dollarsStr = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${dollarsStr}.${String(cents).padStart(2, '0')}`;
}

/**
 * Parse a user-entered money string ("1,234.5", "$12", ".75") into integer cents.
 * Returns undefined for empty / unparseable input. Never goes through float dollars
 * for the fractional part.
 */
export function parseMoneyToCents(text: string): Cents | undefined {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (cleaned === '') return undefined;
  const m = /^(\d*)(?:\.(\d{0,2})\d*)?$/.exec(cleaned);
  if (!m) return undefined;
  const whole = m[1] ?? '';
  const frac = m[2] ?? '';
  if (whole === '' && frac === '') return undefined;
  const dollars = whole === '' ? 0 : parseInt(whole, 10);
  const cents = frac === '' ? 0 : parseInt(frac.padEnd(2, '0'), 10);
  return dollars * 100 + cents;
}

/** Cents -> plain editable string without currency symbol, e.g. 123456 -> "1234.56". */
export function centsToInputString(c: Cents): string {
  const abs = Math.abs(c);
  return `${c < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
