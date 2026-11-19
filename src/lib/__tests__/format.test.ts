import type { ShiftResult } from '@/engine/types';
import { basisLabel, buildShareText, hasChangeNote, keptShown, roundingParts } from '@/lib/format';
import { golden2Input } from '@/test-support/builders';

const base: ShiftResult = {
  pool: 4300,
  poolPercentOfTips: 22.33,
  poolPercentOfNetSales: 4.75,
  kept: 14955,
  keptChange: 55,
  retained: 1400,
  roles: [],
  roundingAdjustment: 77,
};

describe('keptShown / hasChangeNote (Results headline, share text and History agree)', () => {
  it('bartender flow with bartenders: whole dollars shared, change note shown', () => {
    const r: ShiftResult = {
      ...base,
      keptSplit: [
        { memberId: 'joseph', name: 'Joseph', hours: 0, amount: 7500 },
        { memberId: 'aaron', name: 'Aaron', hours: 0, amount: 7400 },
      ],
    };
    expect(keptShown(r)).toBe(14900);
    expect(hasChangeNote(r)).toBe(true);
    const text = buildShareText(golden2Input(), r);
    expect(text).toContain('Bar keeps: $149.00');
    expect(text).toContain('$0.55 in change');
  });

  it('no bartenders listed: shows all of kept and no change note (#20)', () => {
    const r: ShiftResult = { ...base, keptSplit: [], keptChange: 14955 };
    expect(keptShown(r)).toBe(14955);
    expect(hasChangeNote(r)).toBe(false);
  });

  it('server flow: all of kept', () => {
    const r: ShiftResult = { ...base, keptChange: 0 };
    expect(keptShown(r)).toBe(14955);
    expect(hasChangeNote(r)).toBe(false);
  });
});

describe('basisLabel (#27)', () => {
  it('labels each basis, defaulting to total tips', () => {
    expect(basisLabel(undefined)).toBe('total tips');
    expect(basisLabel('totalTips')).toBe('total tips');
    expect(basisLabel('netSales')).toBe('net sales');
    expect(basisLabel('foodSales')).toBe('food sales');
  });
});

describe('roundingParts (#37: floor trim and tie-held dollars shown separately)', () => {
  it('Golden 1: $0.17 floor trim + $1 held from barbacks', () => {
    const r: ShiftResult = {
      ...base,
      keptChange: 0,
      roundingAdjustment: 117,
      roles: [
        {
          role: 'barback',
          amount: 3200,
          percentOfTips: 0,
          percentOfNetSales: 0,
          members: [],
          heldBack: 100,
        },
        { role: 'host', amount: 1100, percentOfTips: 0, percentOfNetSales: 0, members: [] },
      ],
    };
    expect(roundingParts(r)).toEqual({ floorTrim: 17, heldFromRoles: 100 });
    const text = buildShareText(golden2Input({ userRole: 'server' }), r);
    expect(text).toContain('Rounded down to the dollar — $0.17 kept back');
    expect(text).toContain('$1.00 kept back from tied whole-dollar shares');
  });

  it('no held dollars: all of roundingAdjustment is floor trim', () => {
    expect(roundingParts({ ...base, roles: [] })).toEqual({ floorTrim: 77, heldFromRoles: 0 });
  });
});
