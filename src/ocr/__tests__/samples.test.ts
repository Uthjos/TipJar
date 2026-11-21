/**
 * Milestone 8 acceptance: sample receipts per POS (src/test-support/receipts/).
 * Written from typical Toast / Square / Aloha report layouts; replace or extend with real OCR
 * output when the owner supplies photos (findings #93).
 */
import { detectPos, parseReceipt } from '../parseReceipt';
import type { FieldId, OcrLine } from '../types';
import { ALL_RECEIPT_FIXTURES, type ReceiptFixture } from '../../test-support/receipts';

const FIELDS: FieldId[] = ['totalTips', 'netSales', 'foodSales'];
const asLines = (input: ReceiptFixture['input']): OcrLine[] =>
  typeof input === 'string'
    ? input
        .split(/\r?\n/)
        .filter((t) => t.trim() !== '')
        .map((text) => ({ text }))
    : input;
const table = ALL_RECEIPT_FIXTURES.map((f) => [f.name, f] as const);

describe('fixture set', () => {
  it('has at least three fixtures per POS, with unique names', () => {
    for (const pos of ['toast', 'square', 'aloha', 'generic'] as const) {
      expect(ALL_RECEIPT_FIXTURES.filter((f) => f.pos === pos).length).toBeGreaterThanOrEqual(3);
    }
    const names = ALL_RECEIPT_FIXTURES.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe.each(table)('%s', (_name, fx) => {
  it('detectPos', () => {
    expect(detectPos(asLines(fx.input))).toBe(fx.pos);
  });

  it('parseReceipt reports the same POS', () => {
    expect(parseReceipt(fx.input).pos).toBe(fx.pos);
  });

  it.each(FIELDS)('%s: cents, confidence and how', (id) => {
    const got = parseReceipt(fx.input).fields[id];
    const want = fx.expected.fields[id];
    if (!want) {
      expect(got).toBeUndefined();
      return;
    }
    expect(got).toBeDefined();
    expect({ cents: got!.cents, confidence: got!.confidence }).toEqual({
      cents: want.cents,
      confidence: want.confidence,
    });
    if (want.how) expect(got!.how).toBe(want.how);
    expect(got!.source.trim().length).toBeGreaterThan(0);
  });

  it('missing fields, in FieldId order', () => {
    expect(parseReceipt(fx.input).missing).toEqual(fx.expected.missing);
  });

  it('forcing the detected POS gives the same result', () => {
    expect(parseReceipt(fx.input, { pos: fx.pos })).toEqual(parseReceipt(fx.input));
  });

  if (typeof fx.input === 'string') {
    it('LF and CRLF line endings parse the same', () => {
      const text = fx.input as string;
      const lf = text.replace(/\r\n/g, '\n');
      const crlf = lf.replace(/\n/g, '\r\n');
      expect(parseReceipt(crlf).fields).toEqual(parseReceipt(lf).fields);
    });

    it('a string and the equivalent OcrLine[] (no coordinates) parse the same', () => {
      expect(parseReceipt(asLines(fx.input)).fields).toEqual(parseReceipt(fx.input).fields);
    });
  }
});
