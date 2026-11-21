/**
 * Milestone 8 acceptance: parseMoneyToken (docs/m8-contract.md "src/ocr/money.ts").
 */
import * as fc from 'fast-check';
import { parseMoneyToken } from '../money';

describe('parseMoneyToken: accepted forms', () => {
  it.each([
    ['$1,234.56', 123456],
    ['1234.56', 123456],
    ['1,234.56', 123456],
    ['$0.50', 50],
    ['.50', 50],
    ['$.50', 50],
    ['12', 1200],
    ['$12', 1200],
    ['0', 0],
    ['0.00', 0],
    ['12.3', 1230],
    ['12.30', 1230],
    ['$1,560.25', 156025],
    ['1,000,000.00', 100000000],
    ['1,234', 123400], // comma followed by 3 digits is a thousands separator
  ])('%p -> %p', (token, cents) => {
    expect(parseMoneyToken(token)).toBe(cents);
  });

  it.each([
    ['(12.34)', -1234],
    ['-12.34', -1234],
    ['($1,234.56)', -123456],
    ['-$85.00', -8500],
  ])('negative %p -> %p (callers drop negatives)', (token, cents) => {
    expect(parseMoneyToken(token)).toBe(cents);
  });
});

describe('parseMoneyToken: OCR fixes inside numeric-looking tokens', () => {
  it.each([
    ['1O.5O', 1050], // O -> 0
    ['$1,56O.25', 156025],
    ['7oo.12', 70012], // o -> 0
    ['l2.34', 1234], // l -> 1
    ['I2.34', 1234], // I -> 1
    ['|2.34', 1234], // | -> 1
    ['$S.00', 500], // S -> 5
    ['l9S.20', 19520],
    ['B9.00', 8900], // B -> 8
    ['1 234.56', 123456], // a space between digits
    ['$1,56 0.25', 156025],
    ['12,34', 1234], // last separator ',' + exactly 2 digits -> decimal comma
    ['1,23', 123],
    ['$0,50', 50],
  ])('%p -> %p', (token, cents) => {
    expect(parseMoneyToken(token)).toBe(cents);
  });
});

describe('parseMoneyToken: rejections', () => {
  it.each([
    [''],
    ['   '],
    ['$'],
    ['.'],
    ['-'],
    ['()'],
    ['abc'],
    ['Total'],
    ['SALES'], // letters that look like digits do not make a word numeric
    ['OO'],
    ['S'],
    ['12a'],
    ['1.2.3'],
    ['12%'],
    ['21.8%'],
    ['1,23,456'], // thousands groups must be 3 digits
    ['1,2345.00'],
    ['12,3456'],
    ['$$12'],
    ['12-34'],
    ['5:02'],
    ['11/17/2026'],
  ])('%p -> null', (token) => {
    expect(parseMoneyToken(token)).toBeNull();
  });
});

describe('parseMoneyToken: properties', () => {
  const fmt = (c: number, opts: { dollar: boolean; commas: boolean }) => {
    const abs = Math.abs(c);
    const whole = Math.floor(abs / 100);
    const wholeText = opts.commas ? whole.toLocaleString('en-US') : String(whole);
    return `${opts.dollar ? '$' : ''}${wholeText}.${String(abs % 100).padStart(2, '0')}`;
  };

  it('formatted cents round-trip (with or without $ and thousands commas; parentheses = negative)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99_999_999_99 }),
        fc.boolean(),
        fc.boolean(),
        (c, dollar, commas) => {
          const text = fmt(c, { dollar, commas });
          expect(parseMoneyToken(text)).toBe(c);
          if (c > 0) expect(parseMoneyToken(`(${text})`)).toBe(-c);
          if (c > 0) expect(parseMoneyToken(`-${text}`)).toBe(-c);
        },
      ),
      { seed: 20261121, numRuns: 1000 },
    );
  });

  it('never returns NaN, a float or a non-number; never throws', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 15 }),
          fc.stringMatching(/^[\s$(\-]?[0-9OolIS|B ,.]{0,10}[)%]?$/),
        ),
        (token) => {
          const out = parseMoneyToken(token);
          if (out !== null) {
            expect(typeof out).toBe('number');
            expect(Number.isInteger(out)).toBe(true);
          }
        },
      ),
      { seed: 20261121, numRuns: 2000 },
    );
  });
});
