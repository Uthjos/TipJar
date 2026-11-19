import { floorToDollar, formatCents, splitLargestRemainder } from '../money';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('splitLargestRemainder', () => {
  it('splits evenly divisible totals exactly', () => {
    expect(splitLargestRemainder(1000, [4, 3, 1])).toEqual([500, 375, 125]);
    expect(splitLargestRemainder(4400, [1, 1])).toEqual([2200, 2200]);
  });

  it('returns the whole total for a single weight', () => {
    expect(splitLargestRemainder(12345, [7])).toEqual([12345]);
  });

  it('returns all zeros when total is zero', () => {
    expect(splitLargestRemainder(0, [1, 2, 3])).toEqual([0, 0, 0]);
  });

  it('gives leftover cents to the largest fractional remainders', () => {
    // 100 * [1/3, 2/3] = 33.33, 66.67 -> floors 33 + 66 = 99, 1 left -> index 1 (.67)
    expect(splitLargestRemainder(100, [1, 2])).toEqual([33, 67]);
    // 5 * [1,1,2]/4 = 1.25, 1.25, 2.5 -> floors 1,1,2 = 4, 1 left -> index 2 (.5)
    expect(splitLargestRemainder(5, [1, 1, 2])).toEqual([1, 1, 3]);
  });

  it('does not simply give leftovers to the first index (largest remainder wins)', () => {
    // 7 * [2,1,1]/4 = 3.5, 1.75, 1.75 -> floors 3,1,1 = 5, 2 left -> .75 (idx 1), .75 (idx 2)
    expect(splitLargestRemainder(7, [2, 1, 1])).toEqual([3, 2, 2]);
  });

  describe('tie-breaking: equal remainders go to the lower index first', () => {
    it('100 / 3 equal -> 34, 33, 33', () => {
      expect(splitLargestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33]);
    });
    it('10 / 3 equal -> 4, 3, 3', () => {
      expect(splitLargestRemainder(10, [1, 1, 1])).toEqual([4, 3, 3]);
    });
    it('2 / 3 equal -> 1, 1, 0', () => {
      expect(splitLargestRemainder(2, [1, 1, 1])).toEqual([1, 1, 0]);
    });
    it('101 / 2 equal -> 51, 50', () => {
      expect(splitLargestRemainder(101, [1, 1])).toEqual([51, 50]);
    });
    it('1100 / 3 equal -> 367, 367, 366', () => {
      // 366.67 each -> floors 1098, 2 left -> idx 0 and 1
      expect(splitLargestRemainder(1100, [1, 1, 1])).toEqual([367, 367, 366]);
    });
    it('14955 split 7:3 -> 10469, 4486 (half-cent tie goes to index 0)', () => {
      // 10468.5 / 4486.5 -> floors 14954, 1 left, tie .5/.5 -> idx 0
      expect(splitLargestRemainder(14955, [7, 3])).toEqual([10469, 4486]);
    });
    it('tie-break is by position, not by weight size', () => {
      // 3 * [1,1]/2 = 1.5, 1.5 -> idx 0 gets the extra regardless of order of identical weights
      expect(splitLargestRemainder(3, [1, 1])).toEqual([2, 1]);
      // 3 * [2,2,2,2]/8 = .75 each -> floors 0, 3 left -> idx 0,1,2
      expect(splitLargestRemainder(3, [2, 2, 2, 2])).toEqual([1, 1, 1, 0]);
    });
  });

  it('accepts fractional weights (e.g. hours)', () => {
    expect(splitLargestRemainder(100, [7.5, 2.5])).toEqual([75, 25]);
    expect(splitLargestRemainder(8973 + 5982, [6, 4])).toEqual([8973, 5982]);
  });

  it('is robust to floating-point weights that do not sum cleanly', () => {
    // 0.1 + 0.2 + 0.3 !== 0.6 in IEEE754; parts must still be exact.
    expect(splitLargestRemainder(600, [0.1, 0.2, 0.3])).toEqual([100, 200, 300]);
  });

  it('gives a zero-weight part nothing', () => {
    expect(splitLargestRemainder(10, [0, 1])).toEqual([0, 10]);
    expect(splitLargestRemainder(11, [1, 0, 1])).toEqual([6, 0, 5]);
  });

  it('throws when all weights are zero', () => {
    expect(() => splitLargestRemainder(100, [0, 0])).toThrow();
  });

  it('parts always sum exactly to the total and are integers', () => {
    const cases: [number, number[]][] = [
      [1, [1, 1, 1, 1, 1, 1, 1]],
      [999_999, [3, 7, 11, 13]],
      [10217, [4, 3, 1]],
      [123_456_789, [0.25, 8.75, 3.5]],
    ];
    for (const [total, weights] of cases) {
      const parts = splitLargestRemainder(total, weights);
      expect(parts).toHaveLength(weights.length);
      expect(sum(parts)).toBe(total);
      for (const p of parts) {
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('does not mutate the weights array', () => {
    const weights = Object.freeze([3, 1]) as unknown as number[];
    expect(splitLargestRemainder(400, weights)).toEqual([300, 100]);
  });
});

describe('floorToDollar', () => {
  it.each([
    [10217, 10200],
    [5777, 5700],
    [10200, 10200],
    [100, 100],
    [99, 0],
    [1, 0],
    [0, 0],
  ])('floorToDollar(%i) -> %i', (input, expected) => {
    expect(floorToDollar(input)).toBe(expected);
  });
});

describe('formatCents', () => {
  it.each([
    [123456, '$1,234.56'],
    [0, '$0.00'],
    [5, '$0.05'],
    [50, '$0.50'],
    [100, '$1.00'],
    [10200, '$102.00'],
    [14955, '$149.55'],
    [100000000, '$1,000,000.00'],
  ])('formatCents(%i) -> %s', (input, expected) => {
    expect(formatCents(input)).toBe(expected);
  });
});
