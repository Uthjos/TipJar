/** Money tokens from OCR text (docs/m8-contract.md). Pure; integer cents only. */
import type { Cents } from '@/engine/types';

/** Letters OCR often reads in place of digits. */
const OCR_DIGITS: Record<string, string> = {
  O: '0',
  o: '0',
  l: '1',
  I: '1',
  '|': '1',
  S: '5',
  B: '8',
};

const THOUSANDS = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;
const PLAIN = /^\d+(\.\d{1,2})?$/;
const FRACTION_ONLY = /^\.\d{1,2}$/;
const COMMA_DECIMAL = /^\d+,\d{2}$/;

/**
 * Like `parseMoneyToken`, and also says whether an OCR letter fix was needed (low confidence).
 */
export function parseMoneyTokenDetailed(token: string): { cents: Cents; fixed: boolean } | null {
  let t = token.trim();
  if (t === '') return null;
  // At most one sign: "-12", "(12)" or "$-12", never "--12" or "(-12)".
  if ((t.match(/-/g) ?? []).length + (t.startsWith('(') ? 1 : 0) > 1) return null;

  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1).trim();
  }
  if (t.startsWith('-')) {
    negative = !negative;
    t = t.slice(1).trim();
  }
  if (t.startsWith('$')) t = t.slice(1).trim();
  if (t.startsWith('-')) {
    // "$-12.34"
    negative = !negative;
    t = t.slice(1).trim();
  }

  // OCR fixes only inside a token that otherwise looks numeric (at least one real digit).
  let fixed = false;
  if (!/\d/.test(t)) return null;
  if (/[^\d.,\s]/.test(t)) {
    if (!/^[\dOolI|SB.,\s]+$/.test(t)) return null;
    t = t.replace(/[OolI|SB]/g, (ch) => OCR_DIGITS[ch]!);
    fixed = true;
  }
  // A space between digits ("1 234.56", "12 .50" is not allowed).
  if (/\s/.test(t)) {
    if (!/^\d+(\s\d+)*([.,]\d+)?$/.test(t)) return null;
    t = t.replace(/\s+/g, '');
  }

  let whole: string;
  let frac = '';
  if (THOUSANDS.test(t)) {
    const [w, f] = t.replace(/,/g, '').split('.');
    whole = w!;
    frac = f ?? '';
  } else if (PLAIN.test(t)) {
    const [w, f] = t.split('.');
    whole = w!;
    frac = f ?? '';
  } else if (FRACTION_ONLY.test(t)) {
    whole = '0';
    frac = t.slice(1);
  } else if (COMMA_DECIMAL.test(t)) {
    const [w, f] = t.split(',');
    whole = w!;
    frac = f!;
  } else {
    return null;
  }
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents)) return null;
  return { cents: negative && cents !== 0 ? -cents : cents, fixed };
}

/**
 * "$1,234.56" -> 123456, ".50" -> 50, "(12.34)" / "-12.34" -> -1234, "12.3" -> 1230, "12,34" ->
 * 1234; OCR letter fixes (O->0, l/I/| ->1, S->5, B->8) inside an otherwise numeric token.
 * Anything else -> null. Never NaN or a float.
 */
export function parseMoneyToken(token: string): Cents | null {
  return parseMoneyTokenDetailed(token)?.cents ?? null;
}
