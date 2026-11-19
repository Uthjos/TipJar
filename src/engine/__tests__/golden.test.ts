/**
 * Golden tests: the two worked examples from the source doc (CLAUDE.md §5.5 and §5.6),
 * with the owner's answers (2026-11-18):
 * - Q1/Q2: when rounding is on, member shares and the bar's kept split are whole dollars by
 *   default (`roundMemberShares` defaults to true); the bar's leftover cents are `keptChange`.
 * - Q7: whole-dollar split = floor, then largest remainder, then more hours; members still tied
 *   with too few dollars get none -> held back (role: pool down, kept up, added to
 *   roundingAdjustment; keptSplit: added to keptChange).
 * These must pass exactly.
 */
import { calculateShift } from '../calculate';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../profiles';
import {
  at,
  golden1Input,
  golden2Input,
  keptSplitAmounts,
  memberAmounts,
  paidRolesTotal,
  roleOf,
  sum,
} from '../../test-support/builders';

describe('Golden 1 — server example (CLAUDE.md §5.5)', () => {
  /*
   * Tips $340.56, net $1,560.25, food $700.12, Server default, rounding ON, equal hours.
   * pool (unrounded, to the cent) = 30% x 34056 = 10216.8 -> 10217c ($102.17)
   * floor to dollar                                        -> 10200c ($102), trims 17c
   * KTO unrounded = 2% x 700.12 = $14.0024
   * remainder $102 - 14.0024 = $87.9976 split 4:3:1 -> 43.9988 / 32.9991 / 10.9997
   * whole-dollar largest remainder: floors 14+43+32+10 = 99, 3 dollars to the largest
   *   fractions (.9997 host, .9991 barback, .9988 bartender) -> 14 / 44 / 33 / 11 = 102
   * members (owner Q7): bartenders $44 / 2 = 22 / 22 exact; host $11 -> Hannah
   *   barbacks $33 / 2 = 16.5 / 16.5 -> floors 32, $1 left, remainders tie (.5/.5), hours tie
   *   (none entered) -> held back -> 16 / 16, barback role amount 3200
   * pool paid = 1400 + 4400 + 3200 + 1100 = 10100
   * roundingAdjustment = 17 (floor) + 100 (held) = 117
   * kept = 34056 - 10100 = 23956; server flow -> keptChange 0, no keptSplit
   */
  const { result, warnings } = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE);

  it('pays out $101: floor to $102, then $1 held back from the barbacks', () => {
    expect(result.pool).toBe(10100);
    expect(result.roundingAdjustment).toBe(117);
    expect(result.retained).toBe(0);
  });

  it('kitchen (KTO) gets $14.00, no members, never missing', () => {
    const kitchen = roleOf(result, 'kitchen');
    expect(kitchen.amount).toBe(1400);
    expect(kitchen.members).toEqual([]);
    expect(kitchen.missing).toBeFalsy();
  });

  it('bartenders get $44.00 split Joseph $22.00 / Aaron $22.00', () => {
    const r = roleOf(result, 'bartender');
    expect(r.amount).toBe(4400);
    expect(memberAmounts(r)).toEqual({ joseph: 2200, aaron: 2200 });
    expect(r.missing).toBeFalsy();
  });

  it('barbacks: $33 share pays David $16 / Allen $16; the tied odd dollar is held back', () => {
    const r = roleOf(result, 'barback');
    expect(r.amount).toBe(3200);
    expect(r.heldBack ?? 0).toBe(100);
    expect(memberAmounts(r)).toEqual({ david: 1600, allen: 1600 });
  });

  it('hosts get $11.00, all to Hannah', () => {
    const r = roleOf(result, 'host');
    expect(r.amount).toBe(1100);
    expect(memberAmounts(r)).toEqual({ hannah: 1100 });
  });

  it('roles sum to the pool and the server keeps $239.56', () => {
    expect(paidRolesTotal(result)).toBe(10100);
    expect(result.kept).toBe(23956);
    expect(result.kept + result.pool).toBe(34056);
  });

  it('server flow has no keptSplit and keptChange 0', () => {
    expect(result.keptSplit).toBeUndefined();
    expect(result.keptChange).toBe(0);
  });

  it('reports percentages of tips and of net sales (0-100, unrounded)', () => {
    expect(result.poolPercentOfTips).toBeCloseTo((10100 / 34056) * 100, 6);
    expect(result.poolPercentOfNetSales).toBeCloseTo((10100 / 156025) * 100, 6);
    const bt = roleOf(result, 'bartender');
    expect(bt.percentOfTips).toBeCloseTo((4400 / 34056) * 100, 6);
    expect(bt.percentOfNetSales).toBeCloseTo((4400 / 156025) * 100, 6);
    expect(at(bt.members, 0).percentOfTips).toBeCloseTo((2200 / 34056) * 100, 6);
    const bb = roleOf(result, 'barback');
    expect(bb.percentOfTips).toBeCloseTo((3200 / 34056) * 100, 6);
    expect(at(bb.members, 0).percentOfTips).toBeCloseTo((1600 / 34056) * 100, 6);
    expect(roleOf(result, 'kitchen').percentOfTips).toBeCloseTo((1400 / 34056) * 100, 6);
  });

  it('member results carry name and id', () => {
    const bt = roleOf(result, 'bartender');
    expect(bt.members.map((m) => [m.memberId, m.name])).toEqual([
      ['joseph', 'Joseph'],
      ['aaron', 'Aaron'],
    ]);
  });

  it('produces no warnings', () => {
    expect(warnings).toEqual([]);
  });

  it('explicit roundMemberShares: true gives the same result as the default', () => {
    const explicit = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE, {
      roundMemberShares: true,
    });
    expect(explicit.result).toEqual(result);
  });

  it('roundMemberShares: false: barbacks $33 -> $16.50 / $16.50, nothing held back', () => {
    const { result: r2 } = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE, {
      roundMemberShares: false,
    });
    expect(roleOf(r2, 'barback').amount).toBe(3300);
    expect(roleOf(r2, 'barback').heldBack ?? 0).toBe(0);
    expect(memberAmounts(roleOf(r2, 'barback'))).toEqual({ david: 1650, allen: 1650 });
    expect(memberAmounts(roleOf(r2, 'bartender'))).toEqual({ joseph: 2200, aaron: 2200 });
    expect(memberAmounts(roleOf(r2, 'host'))).toEqual({ hannah: 1100 });
    expect(r2.pool).toBe(10200);
    expect(r2.roundingAdjustment).toBe(17);
    expect(r2.kept).toBe(23856);
    expect(r2.keptChange).toBe(0);
  });
});

describe("Golden 2 — bartender example, missingRoleHandling 'retain' (CLAUDE.md §5.6)", () => {
  /*
   * Tips $192.55, net $905.43, food $120.00, Bartender default, rounding ON, no host.
   * pool unrounded = 30% x 19255 = 5776.5 -> 5777c ($57.77, half-cent rounds up)
   * floor -> 5700c (trims 77c)
   * KTO = 2% x 120 = $2.40; remainder 57 - 2.40 = 54.60 split 3:1 -> 40.95 / 13.65
   * whole dollars: floors 2+40+13 = 55, 2 left -> .95 barback, .65 host -> $2 / $41 / $14
   * host missing + retain -> $14 stays with the bar (retained 1400), not in pool
   * barbacks $41 / 2 = 20.5 / 20.5 -> tie on remainder and hours -> 20 / 20, $1 held back
   * pool (paid) = 200 + 4000 = 4200; roundingAdjustment = 77 + 100 = 177
   * kept = 19255 - 4200 = 15055
   * keptSplit: floorToDollar(15055) = 15000 -> $150 / 2 = 75 / 75 exact; keptChange 55
   */
  const { result, warnings } = calculateShift(golden2Input(), BARTENDER_DEFAULT_PROFILE);

  it('pool paid out is $42, retained $14, rounding adjustment $1.77', () => {
    expect(result.pool).toBe(4200);
    expect(result.retained).toBe(1400);
    expect(result.roundingAdjustment).toBe(177);
  });

  it('kitchen gets $2', () => {
    const k = roleOf(result, 'kitchen');
    expect(k.amount).toBe(200);
    expect(k.members).toEqual([]);
    expect(k.missing).toBeFalsy();
  });

  it('barbacks: $41 share pays David $20 / Allen $20; the tied odd dollar stays with the bar', () => {
    const r = roleOf(result, 'barback');
    expect(r.amount).toBe(4000);
    expect(r.heldBack ?? 0).toBe(100);
    expect(memberAmounts(r)).toEqual({ david: 2000, allen: 2000 });
  });

  it('host share ($14) is listed as missing with no members and counted as retained', () => {
    const h = roleOf(result, 'host');
    expect(h.missing).toBe(true);
    expect(h.amount).toBe(1400);
    expect(h.members).toEqual([]);
  });

  it('only tip-out roles from the profile are listed (bartenders are not a tip-out role here)', () => {
    expect(result.roles.map((r) => r.role).sort()).toEqual(['barback', 'host', 'kitchen']);
  });

  it('kept is $150.55 = tips - pool paid', () => {
    expect(result.kept).toBe(15055);
    expect(result.kept + result.pool).toBe(19255);
    expect(paidRolesTotal(result)).toBe(result.pool);
  });

  it('bartenders share $150: Joseph $75 / Aaron $75, with $0.55 change', () => {
    expect(keptSplitAmounts(result)).toEqual({ joseph: 7500, aaron: 7500 });
    expect(result.keptSplit!.map((k) => k.name)).toEqual(['Joseph', 'Aaron']);
    expect(result.keptChange).toBe(55);
    expect(result.keptHeldBack ?? 0).toBe(0); // $150 splits evenly, nothing held
    expect(sum(result.keptSplit!.map((k) => k.amount)) + result.keptChange).toBe(result.kept);
  });

  it('pool percentages use the paid pool', () => {
    expect(result.poolPercentOfTips).toBeCloseTo((4200 / 19255) * 100, 6);
    expect(result.poolPercentOfNetSales).toBeCloseTo((4200 / 90543) * 100, 6);
  });

  it('produces no warnings', () => {
    expect(warnings).toEqual([]);
  });

  it('roundMemberShares: false restores cent splits with nothing held back', () => {
    // barbacks 4100 -> 2050 / 2050; pool 4300; kept 14955 -> 7477.5 tie -> 7478 / 7477
    const { result: r2 } = calculateShift(golden2Input(), BARTENDER_DEFAULT_PROFILE, {
      roundMemberShares: false,
    });
    expect(roleOf(r2, 'barback').amount).toBe(4100);
    expect(memberAmounts(roleOf(r2, 'barback'))).toEqual({ david: 2050, allen: 2050 });
    expect(keptSplitAmounts(r2)).toEqual({ joseph: 7478, aaron: 7477 });
    expect(r2.keptChange).toBe(0);
    expect(r2.pool).toBe(4300);
    expect(r2.kept).toBe(14955);
    expect(r2.retained).toBe(1400);
    expect(r2.roundingAdjustment).toBe(77);
  });
});

describe("Golden 2 — bartender example, missingRoleHandling 'redistribute'", () => {
  /*
   * Same as above, but the host's share goes to the barbacks (the only present share role):
   * barbacks get the whole remainder 54.60 -> allocation 2.40 / 54.60 -> $2 / $55
   * barbacks $55 / 2 = 27.5 / 27.5 -> tie -> 27 / 27, $1 held back -> barback 5400
   * pool = 200 + 5400 = 5600; retained 0; roundingAdjustment = 77 + 100 = 177
   * kept = 19255 - 5600 = 13655
   * keptSplit: floorToDollar(13655) = 13600 -> $136 / 2 = 68 / 68 exact; keptChange 55
   */
  const { result } = calculateShift(
    golden2Input({ missingRoleHandling: 'redistribute' }),
    BARTENDER_DEFAULT_PROFILE,
  );

  it('barbacks: $55 share pays David $27 / Allen $27', () => {
    const r = roleOf(result, 'barback');
    expect(r.amount).toBe(5400);
    expect(r.heldBack ?? 0).toBe(100);
    expect(memberAmounts(r)).toEqual({ david: 2700, allen: 2700 });
  });

  it('host is missing with amount 0', () => {
    const h = roleOf(result, 'host');
    expect(h.missing).toBe(true);
    expect(h.amount).toBe(0);
    expect(h.members).toEqual([]);
  });

  it('pool $56, retained 0, kept $136.55, rounding adjustment $1.77', () => {
    expect(result.pool).toBe(5600);
    expect(result.retained).toBe(0);
    expect(result.kept).toBe(13655);
    expect(result.roundingAdjustment).toBe(177);
    expect(roleOf(result, 'kitchen').amount).toBe(200);
  });

  it('bartenders share $136: Joseph $68 / Aaron $68, with $0.55 change', () => {
    expect(keptSplitAmounts(result)).toEqual({ joseph: 6800, aaron: 6800 });
    expect(result.keptChange).toBe(55);
  });

  it('roundMemberShares: false: barbacks $27.50 / $27.50, kept split $67.78 / $67.77', () => {
    // pool 5700, kept 13555 -> 6777.5 -> tie -> 6778 / 6777
    const { result: r2 } = calculateShift(
      golden2Input({ missingRoleHandling: 'redistribute' }),
      BARTENDER_DEFAULT_PROFILE,
      { roundMemberShares: false },
    );
    expect(memberAmounts(roleOf(r2, 'barback'))).toEqual({ david: 2750, allen: 2750 });
    expect(keptSplitAmounts(r2)).toEqual({ joseph: 6778, aaron: 6777 });
    expect(r2.keptChange).toBe(0);
    expect(r2.pool).toBe(5700);
    expect(r2.kept).toBe(13555);
    expect(r2.roundingAdjustment).toBe(77);
  });
});
