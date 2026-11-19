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

/**
 * Whole-dollar split with the owner's odd-dollar rule (CLAUDE.md §5.4 step 4, owner Q7).
 *
 * 1. Everyone gets the floor of their exact share (total x weight / sum of weights).
 * 2. Leftover dollars go one at a time by largest fractional remainder.
 * 3. Equal remainders: more `tieBreakHours` first.
 * 4. Members still tied (same remainder and same hours) when there aren't enough dollars for all
 *    of them get none; those dollars (and any after them) are held back.
 *
 * Units are whatever the caller uses (whole dollars in the engine).
 * `sum(parts) + heldBack === totalDollars`. All-zero weights split equally. Remainders and hours
 * are compared with a small tolerance so float noise (0.5 vs 0.4999999) doesn't break a tie.
 *
 * @throws if totalDollars is not a non-negative integer, weights are empty / negative /
 *   non-finite, or tieBreakHours has a different length than weights.
 */
export function splitWholeDollars(
  totalDollars: number,
  weights: number[],
  tieBreakHours: number[] = weights.map(() => 0),
): { parts: number[]; heldBack: number } {
  if (!Number.isInteger(totalDollars) || totalDollars < 0) {
    throw new Error(`splitWholeDollars: total must be a non-negative integer, got ${totalDollars}`);
  }
  if (weights.length === 0) throw new Error('splitWholeDollars: weights must not be empty');
  if (tieBreakHours.length !== weights.length) {
    throw new Error('splitWholeDollars: tieBreakHours must match weights in length');
  }
  for (const x of weights) {
    if (!Number.isFinite(x) || x < 0) throw new Error(`splitWholeDollars: invalid weight ${x}`);
  }
  const rawSum = weights.reduce((a, b) => a + b, 0);
  const w = rawSum > 0 ? weights : weights.map(() => 1);
  const sum = rawSum > 0 ? rawSum : w.length;

  const quotas = w.map((x) => (totalDollars * x) / sum);
  const parts = quotas.map((q) => Math.floor(q + EPS));
  const fracs = quotas.map((q, i) => Math.max(0, q - parts[i]!));
  let leftover = totalDollars - parts.reduce((a, b) => a + b, 0);

  // Floating-point safety: flooring with EPS can only overshoot by a hair; undo from the end.
  for (let i = parts.length - 1; leftover < 0 && i >= 0; i--) {
    if (parts[i]! > 0) {
      parts[i]! -= 1;
      leftover += 1;
    }
  }

  // Candidates (positive remainder) ordered by remainder desc, then hours desc.
  const candidates = w
    .map((_, i) => i)
    .filter((i) => fracs[i]! > EPS)
    .sort((a, b) => {
      const d = fracs[b]! - fracs[a]!;
      if (Math.abs(d) > EPS) return d;
      const h = tieBreakHours[b]! - tieBreakHours[a]!;
      if (Math.abs(h) > EPS) return h;
      return a - b;
    });
  let k = 0;
  while (leftover > 0 && k < candidates.length) {
    const first = candidates[k]!;
    let end = k + 1;
    while (
      end < candidates.length &&
      Math.abs(fracs[candidates[end]!]! - fracs[first]!) <= EPS &&
      Math.abs(tieBreakHours[candidates[end]!]! - tieBreakHours[first]!) <= EPS
    ) {
      end++;
    }
    const size = end - k;
    if (size > leftover) break; // still tied and not enough for all of them: held back
    for (let j = k; j < end; j++) parts[candidates[j]!]! += 1;
    leftover -= size;
    k = end;
  }
  return { parts, heldBack: leftover };
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
