/**
 * Milestone 8 acceptance: parseReceipt / detectPos rules 1–9 (docs/m8-contract.md).
 * Small hand-written inputs, one rule at a time. Full receipts are in samples.test.ts.
 */
import * as fc from 'fast-check';
import { LABELS } from '../labels';
import { detectPos, parseReceipt } from '../parseReceipt';
import type { FieldId, OcrLine, ReceiptParse } from '../types';
import { lines } from '../../test-support/receipts/types';

const parse = (...ls: string[]) => parseReceipt(lines(...ls));
const field = (r: ReceiptParse, id: FieldId) => r.fields[id];
const cents = (r: ReceiptParse, id: FieldId) => r.fields[id]?.cents;

describe('labels config (data only)', () => {
  it('has an entry for every POS with the generic minimum synonyms', () => {
    for (const pos of ['toast', 'square', 'aloha', 'generic'] as const) {
      const l = LABELS[pos];
      expect(l).toBeDefined();
      for (const k of [
        'detect',
        'totalTips',
        'cardTips',
        'cashTips',
        'netSales',
        'foodSales',
        'ignore',
      ] as const) {
        expect(Array.isArray(l[k])).toBe(true);
      }
    }
    const g = LABELS.generic;
    const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());
    expect(lower(g.totalTips)).toEqual(
      expect.arrayContaining(['total tips', 'tips total', 'tip total', 'total gratuity', 'tips']),
    );
    // Review round 8 (#94): a bare "gratuity" label was dropped from totalTips. On real reports it
    // mostly labels auto-gratuity / service-charge lines (ignored per #97), not tips collected.
    expect(lower(g.totalTips)).not.toContain('gratuity');
    expect(lower(g.cardTips)).toEqual(
      expect.arrayContaining([
        'credit card tips',
        'cc tips',
        'card tips',
        'charged tips',
        'non-cash tips',
        'tips (credit)',
        'credit tips',
      ]),
    );
    expect(lower(g.cashTips)).toEqual(
      expect.arrayContaining(['cash tips', 'declared tips', 'cash gratuity', 'declared cash tips']),
    );
    expect(lower(g.netSales)).toEqual(
      expect.arrayContaining(['net sales', 'net sales total', 'total net sales', 'sales (net)']),
    );
    expect(lower(g.foodSales)).toEqual(
      expect.arrayContaining(['food sales', 'food total', 'kitchen sales']),
    );
    expect(lower(g.ignore)).toEqual(
      expect.arrayContaining([
        'gross sales',
        'tip %',
        'tip percentage',
        'tips owed',
        'tip out',
        'tipout',
        'tip share',
        'auto gratuity %',
        'sales tax',
        'food tax',
        'net sales tax',
        'refund',
        'void',
      ]),
    );
  });
});

describe('detectPos', () => {
  const L = (...t: string[]): OcrLine[] => t.map((text) => ({ text }));
  it.each([
    [['Toast', 'Server Checkout'], 'toast'],
    [['Powered by Square', 'Sales Summary'], 'square'],
    [['NCR Aloha', 'SERVER CHECKOUT'], 'aloha'],
    [['shift report', 'net sales 100.00'], 'generic'],
    [[], 'generic'],
  ] as const)('%p -> %p', (texts, pos) => {
    expect(detectPos(L(...texts))).toBe(pos);
  });

  it('is case-insensitive', () => {
    expect(detectPos(L('TOAST'))).toBe('toast');
    expect(detectPos(L('nCR aLOHA'))).toBe('aloha');
  });

  it('parseReceipt reports the detected POS, and opts.pos overrides it', () => {
    expect(parse('Square', 'Net Sales 10.00').pos).toBe('square');
    expect(parseReceipt(lines('Square', 'Net Sales 10.00'), { pos: 'aloha' }).pos).toBe('aloha');
  });
});

describe('rule 1: splitting and normalising', () => {
  it('splits on LF and CRLF, drops blank lines', () => {
    const r = parseReceipt('Net Sales 100.00\r\n\r\n\r\nTotal Tips 20.00\r\n');
    expect(cents(r, 'netSales')).toBe(10000);
    expect(cents(r, 'totalTips')).toBe(2000);
  });

  it('collapses whitespace and strips ":" and "." leaders', () => {
    const r = parse('Net Sales.......$1,560.25', 'Total   Tips:   $340.56', 'Food Sales : 700.12');
    expect(field(r, 'netSales')).toMatchObject({ cents: 156025, confidence: 'high', how: 'label' });
    expect(field(r, 'totalTips')).toMatchObject({ cents: 34056, confidence: 'high', how: 'label' });
    expect(field(r, 'foodSales')).toMatchObject({ cents: 70012, confidence: 'high' });
  });

  it('NFC: a decomposed accent in a label line does not break matching', () => {
    const r = parse('Café Bistro', 'Net Sales 50.00');
    expect(cents(r, 'netSales')).toBe(5000);
  });

  it('source is the trimmed receipt line the value came from', () => {
    const r = parse('   Net Sales   $1,560.25   ');
    expect(field(r, 'netSales')!.source).toContain('Net Sales');
    expect(field(r, 'netSales')!.source).toBe(field(r, 'netSales')!.source.trim());
  });

  it('missing lists the fields not found, in FieldId order', () => {
    expect(parse('hello').missing).toEqual(['totalTips', 'netSales', 'foodSales']);
    expect(parse('Food Sales 10.00').missing).toEqual(['totalTips', 'netSales']);
    expect(parseReceipt('').missing).toEqual(['totalTips', 'netSales', 'foodSales']);
  });
});

describe('rule 2: label matching', () => {
  it('is case-insensitive', () => {
    expect(cents(parse('NET SALES 100.00'), 'netSales')).toBe(10000);
    expect(cents(parse('net sales 100.00'), 'netSales')).toBe(10000);
  });

  it('matches whole words only', () => {
    // "Internet Sales" contains "net sales" but not as whole words
    expect(cents(parse('Internet Sales 50.00'), 'netSales')).toBeUndefined();
    expect(cents(parse('Seafood 25.00', 'Food Sales 10.00'), 'foodSales')).toBe(1000);
  });

  it.each([
    ['Gross Sales 2000.00', 'netSales'],
    ['Net Sales Tax 5.00', 'netSales'],
    ['Sales Tax 12.00', 'netSales'],
    ['Tip % 18.00', 'totalTips'],
    ['Tip Percentage 18.00', 'totalTips'],
    ['Tip Out 25.00', 'totalTips'],
    ['Tipout 25.00', 'totalTips'],
    ['Tip Share 25.00', 'totalTips'],
    ['Tips Owed 80.00', 'totalTips'],
    ['Auto Gratuity % 18.00', 'totalTips'],
    ['Food Tax 3.00', 'foodSales'],
    ['Refund Tips 5.00', 'totalTips'],
    ['Void Net Sales 5.00', 'netSales'],
  ] as const)('ignore label: %p never fills %s', (line, id) => {
    const r = parse(line);
    expect(field(r, id)).toBeUndefined();
    expect(r.missing).toContain(id);
  });

  it('an ignored line does not hide a real one', () => {
    const r = parse('Gross Sales 2000.00', 'Net Sales 1800.00', 'Net Sales Tax 144.00');
    expect(field(r, 'netSales')).toMatchObject({ cents: 180000, confidence: 'high' });
  });

  it('the longest matching synonym wins (card/cash lines are not "tips" lines)', () => {
    // "Credit Card Tips" contains "tips" (total) but "credit card tips" (card) is longer
    const r = parse('Credit Card Tips 40.00', 'Cash Tips 10.00');
    expect(field(r, 'totalTips')).toMatchObject({ cents: 5000, how: 'card+cash' });
    // "Declared Cash Tips" is a cash synonym, longer than "cash tips"/"tips"
    const d = parse('Declared Cash Tips 12.00', 'CC Tips 30.00');
    expect(field(d, 'totalTips')).toMatchObject({ cents: 4200, how: 'card+cash' });
    // "Total Net Sales" vs "Net Sales": same field either way
    expect(cents(parse('Total Net Sales 99.00'), 'netSales')).toBe(9900);
  });
});

describe('rule 3: finding the amount', () => {
  it('uses the rightmost money token on the label line', () => {
    expect(cents(parse('Net Sales 12 items $1,560.25'), 'netSales')).toBe(156025);
    expect(cents(parse('Net Sales  1,400.00  1,560.25'), 'netSales')).toBe(156025);
  });

  it('falls back to the first money token on the next line (medium)', () => {
    const r = parse('Net Sales', '$1,560.25   $9.99');
    expect(field(r, 'netSales')).toMatchObject({ cents: 156025, confidence: 'medium' });
  });

  it('with coordinates, uses the token on the same row to the right (medium)', () => {
    const input: OcrLine[] = [
      { text: 'Net Sales', top: 100, left: 10, height: 20 },
      { text: 'Total Tips', top: 130, left: 10, height: 20 },
      { text: '$9.99', top: 100, left: 0, height: 20 }, // same row but to the LEFT
      { text: '$340.56', top: 131, left: 300, height: 20 },
      { text: '$1,560.25', top: 103, left: 300, height: 20 },
    ];
    const r = parseReceipt(input);
    expect(field(r, 'netSales')).toMatchObject({ cents: 156025, confidence: 'medium' });
    expect(field(r, 'totalTips')).toMatchObject({
      cents: 34056,
      confidence: 'medium',
      how: 'label',
    });
  });

  it('with coordinates, a value more than half a line-height away is not used', () => {
    const input: OcrLine[] = [
      { text: 'Net Sales', top: 100, left: 10, height: 20 },
      { text: '$1,560.25', top: 125, left: 300, height: 20 }, // centre 135 vs 110: too far
    ];
    expect(field(parseReceipt(input), 'netSales')).toBeUndefined();
  });

  it('the next-line fallback never takes the value of another label line (section headers)', () => {
    // ASSUMPTION (findings #96): a bare "TIPS" header must not grab the card-tips amount below it
    const r = parse('TIPS', 'Credit Card Tips 40.00', 'Cash Tips 10.00');
    expect(field(r, 'totalTips')).toMatchObject({
      cents: 5000,
      confidence: 'high',
      how: 'card+cash',
    });
    const s = parse('SALES', 'Net Sales 900.00');
    expect(field(s, 'netSales')).toMatchObject({ cents: 90000, confidence: 'high' });
  });

  it('a label with no amount anywhere is missing', () => {
    expect(parse('Net Sales', 'Thanks!').missing).toContain('netSales');
  });
});

describe('rule 4: several matches for one field', () => {
  it('the last occurrence wins; disagreeing candidates -> medium', () => {
    const r = parse('Net Sales 100.00', 'Net Sales 150.00');
    expect(field(r, 'netSales')).toMatchObject({ cents: 15000, confidence: 'medium' });
  });

  it('agreeing duplicates stay high', () => {
    const r = parse('Net Sales 100.00', 'Net Sales 100.00');
    expect(field(r, 'netSales')).toMatchObject({ cents: 10000, confidence: 'high' });
  });

  it('an exact synonym beats a looser one even when the looser one comes later', () => {
    const r = parse('Net Sales 100.00', 'Sales (Net) 90.00');
    expect(field(r, 'netSales')).toMatchObject({ cents: 10000, confidence: 'medium' });
  });

  it('a looser synonym alone is medium', () => {
    expect(field(parse('Sales (Net) 90.00'), 'netSales')).toMatchObject({
      cents: 9000,
      confidence: 'medium',
    });
  });
});

describe('rule 5: tips', () => {
  it("an explicit total-tips line -> how 'label', high (even with card/cash lines present)", () => {
    const r = parse('Credit Card Tips 40.00', 'Cash Tips 10.00', 'Total Tips 50.00');
    expect(field(r, 'totalTips')).toMatchObject({ cents: 5000, confidence: 'high', how: 'label' });
  });

  it("card + cash -> summed, how 'card+cash', high, with a note; source names both lines", () => {
    const r = parse('Credit Card Tips 40.00', 'Cash Tips 10.25');
    const f = field(r, 'totalTips')!;
    expect(f).toMatchObject({ cents: 5025, confidence: 'high', how: 'card+cash' });
    expect(f.source).toContain('Credit Card Tips');
    expect(f.source).toContain('Cash Tips');
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it("card only -> how 'card-only', medium, with a note asking to check", () => {
    const r = parse('Net Sales 500.00', 'CC Tips 80.00');
    expect(field(r, 'totalTips')).toMatchObject({
      cents: 8000,
      confidence: 'medium',
      how: 'card-only',
    });
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it("cash only -> how 'cash-only', low, with a note asking to check", () => {
    const r = parse('Net Sales 500.00', 'Declared Tips 35.00');
    expect(field(r, 'totalTips')).toMatchObject({
      cents: 3500,
      confidence: 'low',
      how: 'cash-only',
    });
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('no tips lines at all -> totalTips missing', () => {
    expect(parse('Net Sales 500.00').missing).toEqual(['totalTips', 'foodSales']);
  });
});

describe('rule 6: food sales', () => {
  it('explicit "Food Sales" / "Food Total" / "Kitchen Sales" -> high', () => {
    for (const label of ['Food Sales', 'Food Total', 'Kitchen Sales']) {
      expect(field(parse(`${label} 700.12`), 'foodSales')).toMatchObject({
        cents: 70012,
        confidence: 'high',
      });
    }
  });

  it.each([
    ['Sales by Category'],
    ['Category Sales'],
    ['Revenue Center Totals'],
    ['CATEGORY SUMMARY'],
  ])('"Food" + amount after a %p line -> medium (category rule)', (header) => {
    const r = parse(header, 'Food 700.12', 'Liquor 300.00');
    expect(field(r, 'foodSales')).toMatchObject({ cents: 70012, confidence: 'medium' });
  });

  it('"Food" + amount outside a category section is not food sales', () => {
    expect(field(parse('Net Sales 900.00', 'Food 700.12'), 'foodSales')).toBeUndefined();
  });

  it('a line that is more than just "Food" is not the category rule', () => {
    // item names that contain "food" are not food sales
    const r = parse('Sales by Category', 'Food Runner Tip Pool 25.00', 'Seafood Platter 40.00');
    expect(field(r, 'foodSales')).toBeUndefined();
  });

  it('an explicit label beats the category rule', () => {
    const r = parse('Food Sales 650.00', 'Sales by Category', 'Food 700.12');
    expect(field(r, 'foodSales')).toMatchObject({ cents: 65000, confidence: 'medium' }); // disagree
  });
});

describe('rule 7: confidence and negative amounts', () => {
  it('an OCR-fixed token -> low', () => {
    expect(field(parse('Net Sales $1,56O.25'), 'netSales')).toMatchObject({
      cents: 156025,
      confidence: 'low',
    });
    expect(field(parse('Total Tips l2O.5O'), 'totalTips')).toMatchObject({
      cents: 12050,
      confidence: 'low',
    });
  });

  it('a negative amount is dropped: the field is missing and a note explains', () => {
    for (const v of ['(12.34)', '-12.34', '-$12.34']) {
      const r = parse(`Net Sales ${v}`);
      expect(field(r, 'netSales')).toBeUndefined();
      expect(r.missing).toContain('netSales');
      expect(r.notes.length).toBeGreaterThan(0);
    }
  });

  it('cents are always non-negative integers', () => {
    const r = parse('Net Sales 1,560.25', 'Total Tips 340.56', 'Food Sales 700.12');
    for (const f of Object.values(r.fields)) {
      expect(Number.isInteger(f!.cents)).toBe(true);
      expect(f!.cents).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('rule 8: sanity notes (values kept)', () => {
  it('food sales > net sales', () => {
    const r = parse('Net Sales 100.00', 'Food Sales 200.00');
    expect(cents(r, 'netSales')).toBe(10000);
    expect(cents(r, 'foodSales')).toBe(20000);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('tips > net sales', () => {
    const r = parse('Net Sales 100.00', 'Total Tips 150.00');
    expect(cents(r, 'totalTips')).toBe(15000);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('a clean receipt has no notes', () => {
    expect(parse('Net Sales 1,560.25', 'Total Tips 340.56', 'Food Sales 700.12').notes).toEqual([]);
  });
});

describe('rule 9: never throws', () => {
  const tokenish = fc.constantFrom(
    'Net Sales',
    'Total Tips',
    'Food',
    'Sales by Category',
    'Cash Tips',
    'CC Tips',
    'Tip %',
    '$1,560.25',
    '(12.34)',
    '-5',
    'l2O.5O',
    '....',
    ':',
    '%',
    '\u0000',
    '\r',
    '\n',
    '  ',
  );
  const textArb = fc.oneof(
    fc.string({ maxLength: 200 }),
    fc.array(tokenish, { maxLength: 30 }).map((xs) => xs.join(' ')),
    fc
      .array(
        fc.array(tokenish, { maxLength: 4 }).map((xs) => xs.join(' ')),
        { maxLength: 15 },
      )
      .map((ls) => ls.join('\n')),
  );

  it('for any string: no throw, valid pos, and only non-negative integer cents', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        const r = parseReceipt(text);
        expect(['toast', 'square', 'aloha', 'generic']).toContain(r.pos);
        for (const [id, f] of Object.entries(r.fields)) {
          expect(['totalTips', 'netSales', 'foodSales']).toContain(id);
          expect(Number.isInteger(f!.cents)).toBe(true);
          expect(f!.cents).toBeGreaterThanOrEqual(0);
          expect(['high', 'medium', 'low']).toContain(f!.confidence);
        }
        for (const id of r.missing) expect(r.fields[id as FieldId]).toBeUndefined();
        expect(r.missing.length + Object.keys(r.fields).length).toBe(3);
      }),
      { seed: 20261121, numRuns: 1000 },
    );
  });

  it('for any OcrLine[] with odd coordinates', () => {
    const lineArb = fc.record({
      text: textArb,
      top: fc.option(fc.double({ min: -1e6, max: 1e6, noNaN: false }), { nil: undefined }),
      left: fc.option(fc.double({ min: -1e6, max: 1e6 }), { nil: undefined }),
      height: fc.option(fc.double({ min: -10, max: 100 }), { nil: undefined }),
    });
    fc.assert(
      fc.property(fc.array(lineArb, { maxLength: 12 }), (ls) => {
        expect(() => parseReceipt(ls as OcrLine[])).not.toThrow();
      }),
      { seed: 20261121, numRuns: 300 },
    );
  });
});
