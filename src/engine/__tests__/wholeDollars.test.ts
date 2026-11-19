/**
 * splitWholeDollars: the whole-dollar member split from CLAUDE.md §5.4 step 4 (owner Q7).
 *   1. floor every exact share (total x weight / sum of weights)
 *   2. hand out leftover dollars by largest fractional remainder
 *   3. equal remainders -> more tie-break hours first
 *   4. still tied (same remainder, same hours) and not enough dollars for all -> held back
 * Amounts here are whole DOLLARS, not cents.
 */
import * as fc from 'fast-check';
import { splitWholeDollars } from '../money';
import { at, sum } from '../../test-support/builders';

describe('splitWholeDollars', () => {
  it('exact shares need no leftover handling', () => {
    expect(splitWholeDollars(10, [1, 1], [0, 0])).toEqual({ parts: [5, 5], heldBack: 0 });
    expect(splitWholeDollars(1000, [4, 3, 1], [4, 3, 1])).toEqual({
      parts: [500, 375, 125],
      heldBack: 0,
    });
  });

  it('a single member gets everything', () => {
    expect(splitWholeDollars(7, [3], [3])).toEqual({ parts: [7], heldBack: 0 });
  });

  it('zero dollars splits to zeros', () => {
    expect(splitWholeDollars(0, [1, 2], [1, 2])).toEqual({ parts: [0, 0], heldBack: 0 });
  });

  it('largest fractional remainder gets the odd dollar ($33 at 7h/3h -> $23 / $10)', () => {
    // 23.10 / 9.90 -> floors 23 + 9 = 32, $1 left -> .90 beats .10
    expect(splitWholeDollars(33, [7, 3], [7, 3])).toEqual({ parts: [23, 10], heldBack: 0 });
  });

  it('remainder beats hours: the shorter shift can win the odd dollar', () => {
    // same as above with the order swapped: 3h member has the larger remainder (.90)
    expect(splitWholeDollars(33, [3, 7], [3, 7])).toEqual({ parts: [10, 23], heldBack: 0 });
  });

  describe('tie on remainder -> more hours wins', () => {
    it('$5 at 3h / 7h = 1.5 / 3.5 -> the 7h member gets the odd dollar', () => {
      expect(splitWholeDollars(5, [3, 7], [3, 7])).toEqual({ parts: [1, 4], heldBack: 0 });
    });

    it('is independent of member order', () => {
      expect(splitWholeDollars(5, [7, 3], [7, 3])).toEqual({ parts: [4, 1], heldBack: 0 });
    });

    it('$10 split equally three ways, hours 8 / 6 / 6 -> the 8h member gets the odd dollar', () => {
      // weights equal (3.33 each), tie-break hours differ: L = 1 -> the unique 8h member
      expect(splitWholeDollars(10, [1, 1, 1], [8, 6, 6])).toEqual({
        parts: [4, 3, 3],
        heldBack: 0,
      });
    });

    it('$11 split equally three ways, hours 8 / 8 / 6 -> both 8h members get one', () => {
      // L = 2, top tie group {8h, 8h} has exactly 2 members -> both served
      expect(splitWholeDollars(11, [1, 1, 1], [8, 8, 6])).toEqual({
        parts: [4, 4, 3],
        heldBack: 0,
      });
    });
  });

  describe('still tied with too few dollars -> held back', () => {
    it('$33 equal hours -> $16 / $16, $1 held (Golden 1 barbacks)', () => {
      expect(splitWholeDollars(33, [1, 1], [0, 0])).toEqual({ parts: [16, 16], heldBack: 1 });
      expect(splitWholeDollars(33, [5, 5], [5, 5])).toEqual({ parts: [16, 16], heldBack: 1 });
    });

    it('$10 among three equal -> 3 / 3 / 3, $1 held', () => {
      expect(splitWholeDollars(10, [1, 1, 1], [0, 0, 0])).toEqual({
        parts: [3, 3, 3],
        heldBack: 1,
      });
    });

    it('$11 among three equal -> 3 / 3 / 3, $2 held (2 dollars, 3 tied members)', () => {
      expect(splitWholeDollars(11, [1, 1, 1], [0, 0, 0])).toEqual({
        parts: [3, 3, 3],
        heldBack: 2,
      });
    });

    it('$10 among 3 equal with hours 8 / 8 / 6 -> the two 8h members tie for $1 -> held', () => {
      expect(splitWholeDollars(10, [1, 1, 1], [8, 8, 6])).toEqual({
        parts: [3, 3, 3],
        heldBack: 1,
      });
    });

    it('partial tie fully served: $7 at 2:1:1 -> 3.5 / 1.75 / 1.75 -> 3 / 2 / 2', () => {
      // L = 2; top group (.75, .75, equal hours) has 2 members -> both get one
      expect(splitWholeDollars(7, [2, 1, 1], [2, 1, 1])).toEqual({
        parts: [3, 2, 2],
        heldBack: 0,
      });
    });

    it('partial tie held: $10 at 2:1:1 -> 5 / 2.5 / 2.5 -> 5 / 2 / 2, $1 held', () => {
      expect(splitWholeDollars(10, [2, 1, 1], [2, 1, 1])).toEqual({
        parts: [5, 2, 2],
        heldBack: 1,
      });
    });

    it('a unique top remainder is served, then the next tied pair is held', () => {
      // $5 at 9:8:8 -> 1.8 / 1.6 / 1.6 -> floors 3, L = 2: .8 gets one, the .6/.6 pair ties
      // for the last dollar with equal hours -> held
      expect(splitWholeDollars(5, [9, 8, 8], [9, 8, 8])).toEqual({
        parts: [2, 1, 1],
        heldBack: 1,
      });
    });

    it('held dollars are not passed down to a smaller remainder', () => {
      // ASSUMPTION (findings #31): $3 at 7:7:1 -> 1.4 / 1.4 / 0.2; the .4/.4 pair ties for the
      // single leftover dollar -> held. It does NOT go to the 0.2 member instead.
      expect(splitWholeDollars(3, [7, 7, 1], [7, 7, 1])).toEqual({
        parts: [1, 1, 0],
        heldBack: 1,
      });
    });

    it('detects remainder ties exactly despite floating-point error', () => {
      // $2 at 4:14:2 -> 0.4 / 1.4 / 0.2. In IEEE754, 1.4 - 1 = 0.3999999999999999, but the
      // remainders of members 0 and 1 are mathematically equal (both 0.4) with equal hours,
      // so the single leftover dollar is held, not given to member 0 (findings #32).
      expect(splitWholeDollars(2, [4, 14, 2], [5, 5, 5])).toEqual({
        parts: [0, 1, 0],
        heldBack: 1,
      });
    });
  });

  it('tieBreakHours is optional: omitted means everyone ties on hours', () => {
    // $33 equal weights, no hours -> remainder tie can't be broken -> $1 held
    expect(splitWholeDollars(33, [1, 1])).toEqual({ parts: [16, 16], heldBack: 1 });
    // a unique largest remainder still gets its dollar
    expect(splitWholeDollars(33, [7, 3])).toEqual({ parts: [23, 10], heldBack: 0 });
  });

  it('does not mutate its inputs', () => {
    const w = Object.freeze([1, 1, 1]) as unknown as number[];
    const h = Object.freeze([0, 0, 0]) as unknown as number[];
    expect(splitWholeDollars(10, w, h)).toEqual({ parts: [3, 3, 3], heldBack: 1 });
  });

  describe('properties', () => {
    // Integer weights so remainders can be compared exactly as (total x w) mod W.
    const caseArb = fc.integer({ min: 1, max: 6 }).chain((n) =>
      fc.record({
        total: fc.integer({ min: 0, max: 2000 }),
        weights: fc.array(fc.integer({ min: 1, max: 12 }), { minLength: n, maxLength: n }),
        hours: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: n, maxLength: n }),
      }),
    );
    const PARAMS = { seed: 20261118, numRuns: 500 };

    it('parts + heldBack == total; heldBack < number of members; parts within 1 of exact', () => {
      fc.assert(
        fc.property(caseArb, ({ total, weights, hours }) => {
          const { parts, heldBack } = splitWholeDollars(total, weights, hours);
          expect(parts).toHaveLength(weights.length);
          expect(sum(parts) + heldBack).toBe(total);
          expect(Number.isInteger(heldBack)).toBe(true);
          expect(heldBack).toBeGreaterThanOrEqual(0);
          expect(heldBack).toBeLessThan(weights.length);
          const W = sum(weights);
          parts.forEach((p, i) => {
            const floor = Math.floor((total * at(weights, i)) / W);
            expect(Number.isInteger(p)).toBe(true);
            expect(p === floor || p === floor + 1).toBe(true);
          });
        }),
        PARAMS,
      );
    });

    it('nobody with a smaller (remainder, hours) gets a dollar that someone ahead of them missed', () => {
      fc.assert(
        fc.property(caseArb, ({ total, weights, hours }) => {
          const { parts, heldBack } = splitWholeDollars(total, weights, hours);
          const W = sum(weights);
          // exact remainder numerators (total x w mod W) avoid float error
          const rem = weights.map((w) => (total * w) % W);
          const got = parts.map((p, i) => p - Math.floor((total * at(weights, i)) / W));
          for (let i = 0; i < parts.length; i++) {
            for (let j = 0; j < parts.length; j++) {
              if (at(got, i) === 1 && at(got, j) === 0) {
                // i was served ahead of j: strictly larger remainder, or equal and more hours
                const ri = at(rem, i);
                const rj = at(rem, j);
                expect(ri > rj || (ri === rj && at(hours, i) > at(hours, j))).toBe(true);
              }
            }
          }
          // members tied on (remainder, hours) are treated identically
          for (let i = 0; i < parts.length; i++) {
            for (let j = 0; j < parts.length; j++) {
              if (at(rem, i) === at(rem, j) && at(hours, i) === at(hours, j)) {
                expect(at(got, i)).toBe(at(got, j));
              }
            }
          }
          // dollars handed out + held == the leftover after flooring
          expect(sum(got) + heldBack).toBe(sum(rem) / W);
        }),
        PARAMS,
      );
    });
  });
});
