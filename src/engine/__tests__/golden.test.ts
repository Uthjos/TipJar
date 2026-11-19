/**
 * Golden tests: the two worked examples from the source doc (CLAUDE.md §5.5 and §5.6),
 * with the owner's answers to §11 Q1/Q2 (2026-11-18): when rounding is on, member shares and
 * the bar's kept split are whole dollars by default (`roundMemberShares` defaults to true), and
 * the bar's leftover cents are reported as `keptChange`. These must pass exactly.
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
   * floor to dollar                                        -> 10200c ($102)
   * roundingAdjustment = 10217 - 10200                     = 17c
   * KTO unrounded = 2% x 700.12 = $14.0024
   * remainder $102 - 14.0024 = $87.9976 split 4:3:1 -> 43.9988 / 32.9991 / 10.9997
   * whole-dollar largest remainder: floors 14+43+32+10 = 99, 3 dollars to the largest
   *   fractions (.9997 host, .9991 barback, .9988 bartender) -> 14 / 44 / 33 / 11 = 102
   * members in whole dollars (owner Q1): bartenders $44 / 2 = 22 / 22;
   *   barbacks $33 / 2 = 16.5 / 16.5 -> floors 32, $1 left, tie -> David -> 17 / 16; host 11
   * kept = 34056 - 10200 = 23856; server flow -> keptChange 0, no keptSplit
   */
  const { result, warnings } = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE);

  it('floors the pool to $102 and reports $0.17 rounding adjustment', () => {
    expect(result.pool).toBe(10200);
    expect(result.roundingAdjustment).toBe(17);
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

  it('barbacks get $33.00 split David $17.00 / Allen $16.00 (whole dollars, tie to first)', () => {
    const r = roleOf(result, 'barback');
    expect(r.amount).toBe(3300);
    expect(memberAmounts(r)).toEqual({ david: 1700, allen: 1600 });
  });

  it('hosts get $11.00, all to Hannah', () => {
    const r = roleOf(result, 'host');
    expect(r.amount).toBe(1100);
    expect(memberAmounts(r)).toEqual({ hannah: 1100 });
  });

  it('roles sum to the pool and kept = tips - pool ($238.56)', () => {
    expect(paidRolesTotal(result)).toBe(10200);
    expect(result.kept).toBe(23856);
    expect(result.kept + result.pool).toBe(34056);
  });

  it('server flow has no keptSplit and keptChange 0', () => {
    expect(result.keptSplit).toBeUndefined();
    expect(result.keptChange).toBe(0);
  });

  it('reports percentages of tips and of net sales (0-100, unrounded)', () => {
    expect(result.poolPercentOfTips).toBeCloseTo((10200 / 34056) * 100, 6);
    expect(result.poolPercentOfNetSales).toBeCloseTo((10200 / 156025) * 100, 6);
    const bt = roleOf(result, 'bartender');
    expect(bt.percentOfTips).toBeCloseTo((4400 / 34056) * 100, 6);
    expect(bt.percentOfNetSales).toBeCloseTo((4400 / 156025) * 100, 6);
    expect(at(bt.members, 0).percentOfTips).toBeCloseTo((2200 / 34056) * 100, 6);
    const bb = roleOf(result, 'barback');
    expect(at(bb.members, 0).percentOfTips).toBeCloseTo((1700 / 34056) * 100, 6);
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

  it('roundMemberShares: false: barbacks $33 -> $16.50 / $16.50 (members to the cent)', () => {
    const { result: r2 } = calculateShift(golden1Input(), SERVER_DEFAULT_PROFILE, {
      roundMemberShares: false,
    });
    expect(memberAmounts(roleOf(r2, 'barback'))).toEqual({ david: 1650, allen: 1650 });
    expect(memberAmounts(roleOf(r2, 'bartender'))).toEqual({ joseph: 2200, aaron: 2200 });
    expect(memberAmounts(roleOf(r2, 'host'))).toEqual({ hannah: 1100 });
    expect(r2.pool).toBe(10200);
    expect(r2.kept).toBe(23856);
    expect(r2.keptChange).toBe(0);
  });
});

describe("Golden 2 — bartender example, missingRoleHandling 'retain' (CLAUDE.md §5.6)", () => {
  /*
   * Tips $192.55, net $905.43, food $120.00, Bartender default, rounding ON, no host.
   * pool unrounded = 30% x 19255 = 5776.5 -> 5777c ($57.77, half-cent rounds up)
   * floor -> 5700c; roundingAdjustment = 5777 - 5700 = 77
   * KTO = 2% x 120 = $2.40; remainder 57 - 2.40 = 54.60 split 3:1 -> 40.95 / 13.65
   * whole dollars: floors 2+40+13 = 55, 2 left -> .95 barback, .65 host -> $2 / $41 / $14
   * host missing + retain -> $14 stays with the bar (retained), not in pool
   * barback members $41 / 2 = 20.5 / 20.5 -> tie -> David 21 / Allen 20 (matches the doc)
   * pool (paid) = 200 + 4100 = 4300; kept = 19255 - 4300 = 14955 (unchanged by owner Q2)
   * keptSplit (owner Q2): floorToDollar(14955) = 14900 -> $149 / 2 = 74.5 / 74.5 -> tie
   *   -> Joseph 7500 / Aaron 7400; keptChange = 14955 - 14900 = 55
   */
  const { result, warnings } = calculateShift(golden2Input(), BARTENDER_DEFAULT_PROFILE);

  it('pool paid out is $43, retained $14, rounding adjustment $0.77', () => {
    expect(result.pool).toBe(4300);
    expect(result.retained).toBe(1400);
    expect(result.roundingAdjustment).toBe(77);
  });

  it('kitchen gets $2', () => {
    const k = roleOf(result, 'kitchen');
    expect(k.amount).toBe(200);
    expect(k.members).toEqual([]);
    expect(k.missing).toBeFalsy();
  });

  it('barbacks get $41 split David $21 / Allen $20 (whole dollars)', () => {
    const r = roleOf(result, 'barback');
    expect(r.amount).toBe(4100);
    expect(memberAmounts(r)).toEqual({ david: 2100, allen: 2000 });
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

  it('kept is still $149.55 = tips - pool paid', () => {
    expect(result.kept).toBe(14955);
    expect(result.kept + result.pool).toBe(19255);
    expect(paidRolesTotal(result)).toBe(result.pool);
  });

  it('bartenders share $149: Joseph $75 / Aaron $74, with $0.55 change', () => {
    expect(keptSplitAmounts(result)).toEqual({ joseph: 7500, aaron: 7400 });
    expect(result.keptSplit!.map((k) => k.name)).toEqual(['Joseph', 'Aaron']);
    expect(result.keptChange).toBe(55);
    expect(sum(result.keptSplit!.map((k) => k.amount)) + result.keptChange).toBe(result.kept);
  });

  it('pool percentages use the paid pool', () => {
    expect(result.poolPercentOfTips).toBeCloseTo((4300 / 19255) * 100, 6);
    expect(result.poolPercentOfNetSales).toBeCloseTo((4300 / 90543) * 100, 6);
  });

  it('produces no warnings', () => {
    expect(warnings).toEqual([]);
  });

  it('roundMemberShares: false restores cent splits: $20.50 / $20.50, $74.78 / $74.77, no change', () => {
    // keptSplit to the cent: 14955 / 2 = 7477.5 -> tie -> Joseph 7478, Aaron 7477
    const { result: r2 } = calculateShift(golden2Input(), BARTENDER_DEFAULT_PROFILE, {
      roundMemberShares: false,
    });
    expect(memberAmounts(roleOf(r2, 'barback'))).toEqual({ david: 2050, allen: 2050 });
    expect(keptSplitAmounts(r2)).toEqual({ joseph: 7478, aaron: 7477 });
    expect(r2.keptChange).toBe(0);
    expect(r2.pool).toBe(4300);
    expect(r2.kept).toBe(14955);
    expect(r2.retained).toBe(1400);
  });
});

describe("Golden 2 — bartender example, missingRoleHandling 'redistribute'", () => {
  /*
   * Same as above, but the host's share goes to the barbacks (the only present share role):
   * barbacks get the whole remainder 54.60 -> allocation 2.40 / 54.60 -> $2 / $55
   * pool = 200 + 5500 = 5700; retained 0; kept = 19255 - 5700 = 13555
   * barback members $55 / 2 = 27.5 / 27.5 -> tie -> David 28 / Allen 27
   * keptSplit: floorToDollar(13555) = 13500 -> $135 / 2 = 67.5 -> tie -> Joseph 68 / Aaron 67
   * keptChange = 13555 - 13500 = 55
   */
  const { result } = calculateShift(
    golden2Input({ missingRoleHandling: 'redistribute' }),
    BARTENDER_DEFAULT_PROFILE,
  );

  it('barbacks get $55: David $28 / Allen $27', () => {
    const r = roleOf(result, 'barback');
    expect(r.amount).toBe(5500);
    expect(memberAmounts(r)).toEqual({ david: 2800, allen: 2700 });
  });

  it('host is missing with amount 0', () => {
    const h = roleOf(result, 'host');
    expect(h.missing).toBe(true);
    expect(h.amount).toBe(0);
    expect(h.members).toEqual([]);
  });

  it('pool $57, retained 0, kept $135.55, rounding adjustment $0.77', () => {
    expect(result.pool).toBe(5700);
    expect(result.retained).toBe(0);
    expect(result.kept).toBe(13555);
    expect(result.roundingAdjustment).toBe(77);
    expect(roleOf(result, 'kitchen').amount).toBe(200);
  });

  it('bartenders share $135: Joseph $68 / Aaron $67, with $0.55 change', () => {
    expect(keptSplitAmounts(result)).toEqual({ joseph: 6800, aaron: 6700 });
    expect(result.keptChange).toBe(55);
  });

  it('roundMemberShares: false: barbacks $27.50 / $27.50, kept split $67.78 / $67.77', () => {
    // 13555 / 2 = 6777.5 -> tie -> 6778 / 6777
    const { result: r2 } = calculateShift(
      golden2Input({ missingRoleHandling: 'redistribute' }),
      BARTENDER_DEFAULT_PROFILE,
      { roundMemberShares: false },
    );
    expect(memberAmounts(roleOf(r2, 'barback'))).toEqual({ david: 2750, allen: 2750 });
    expect(keptSplitAmounts(r2)).toEqual({ joseph: 6778, aaron: 6777 });
    expect(r2.keptChange).toBe(0);
    expect(r2.kept).toBe(13555);
  });
});
