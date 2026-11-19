import { calculateShift } from '../calculate';
import { splitWholeDollars } from '../money';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../profiles';
import type { ShiftInput } from '../types';

describe('splitWholeDollars (owner Q7)', () => {
  it('largest remainder: $33 at 7h/3h -> 23 / 10', () => {
    expect(splitWholeDollars(33, [7, 3], [7, 3])).toEqual({ parts: [23, 10], heldBack: 0 });
  });

  it('equal remainders: more hours wins', () => {
    // Same weights (same remainder), different tie-break hours.
    expect(splitWholeDollars(3, [1, 1], [4, 6])).toEqual({ parts: [1, 2], heldBack: 0 });
  });

  it('still tied with too few dollars: nobody in the tie gets one (held back)', () => {
    expect(splitWholeDollars(33, [1, 1], [0, 0])).toEqual({ parts: [16, 16], heldBack: 1 });
    expect(splitWholeDollars(11, [1, 1, 1], [0, 0, 0])).toEqual({
      parts: [3, 3, 3],
      heldBack: 2,
    });
  });

  it('a tied group that fits is paid in full, then the next group is considered', () => {
    // $3 over [1,1,0]: 1.5 / 1.5 / 0 -> the tied pair can't both get the odd dollar -> held.
    expect(splitWholeDollars(3, [1, 1, 0], [0, 0, 0])).toEqual({ parts: [1, 1, 0], heldBack: 1 });
    // $7 over [2,1,1] with hours 2/1/1: 3.5 / 1.75 / 1.75 -> floors 3,1,1, leftover 2:
    // .75 tie (2 members) fits -> both paid, nothing held.
    expect(splitWholeDollars(7, [2, 1, 1], [2, 1, 1])).toEqual({ parts: [3, 2, 2], heldBack: 0 });
    expect(splitWholeDollars(4, [1, 1, 2], [0, 0, 0])).toEqual({ parts: [1, 1, 2], heldBack: 0 });
    // 5 over [1,1,1,1]: 1.25 each -> four tied for 1 dollar -> held.
    expect(splitWholeDollars(5, [1, 1, 1, 1], [0, 0, 0, 0])).toEqual({
      parts: [1, 1, 1, 1],
      heldBack: 1,
    });
  });

  it('parts + heldBack always equal the total; zero weights split equally', () => {
    expect(splitWholeDollars(0, [1, 2], [0, 0])).toEqual({ parts: [0, 0], heldBack: 0 });
    expect(splitWholeDollars(4, [0, 0], [0, 0])).toEqual({ parts: [2, 2], heldBack: 0 });
    for (let total = 0; total < 60; total += 7) {
      const { parts, heldBack } = splitWholeDollars(total, [3, 2.5, 2.5, 1], [3, 2.5, 2.5, 1]);
      expect(parts.reduce((a, b) => a + b, 0) + heldBack).toBe(total);
      expect(heldBack).toBeGreaterThanOrEqual(0);
    }
  });

  it('rejects bad input', () => {
    expect(() => splitWholeDollars(1.5, [1])).toThrow();
    expect(() => splitWholeDollars(1, [])).toThrow();
    expect(() => splitWholeDollars(1, [1, 1], [0])).toThrow();
    expect(() => splitWholeDollars(1, [-1, 2])).toThrow();
  });
});

describe('calculateShift whole-dollar odd-dollar rule', () => {
  const server: ShiftInput = {
    date: '2026-01-01',
    userRole: 'server',
    totalTips: 34056,
    netSales: 156025,
    foodSales: 70012,
    team: [
      { id: 'b1', name: 'Joseph', role: 'bartender' },
      { id: 'b2', name: 'Aaron', role: 'bartender' },
      { id: 'd', name: 'David', role: 'barback', hours: 7 },
      { id: 'al', name: 'Allen', role: 'barback', hours: 3 },
      { id: 'h', name: 'Hannah', role: 'host' },
    ],
    missingRoleHandling: 'retain',
    profileId: 'server-default',
    roundToDollar: true,
  };

  it('$33 barbacks at 7h/3h -> $23 / $10, nothing held back', () => {
    const { result } = calculateShift(server, SERVER_DEFAULT_PROFILE);
    const barback = result.roles.find((r) => r.role === 'barback')!;
    expect(barback.members.map((m) => m.amount)).toEqual([2300, 1000]);
    expect(barback.amount).toBe(3300);
    expect(barback.heldBack).toBeUndefined();
    expect(result.pool).toBe(10200);
    expect(result.roundingAdjustment).toBe(17);
  });

  it('dollars held back from keptSplit go to keptChange (keptHeldBack)', () => {
    const input: ShiftInput = {
      date: '2026-01-01',
      userRole: 'bartender',
      totalTips: 10100,
      netSales: 0,
      foodSales: 0,
      team: [
        { id: 'me', name: 'Me', role: 'bartender', isUser: true },
        { id: 'x', name: 'X', role: 'bartender' },
      ],
      missingRoleHandling: 'retain',
      profileId: 'bartender-default',
      roundToDollar: true,
    };
    const { result } = calculateShift(input, BARTENDER_DEFAULT_PROFILE);
    expect(result.pool).toBe(0);
    expect(result.kept).toBe(10100);
    expect(result.keptSplit!.map((k) => k.amount)).toEqual([5000, 5000]);
    expect(result.keptChange).toBe(100);
    expect(result.keptHeldBack).toBe(100);
  });

  it('warns ZERO_SHARE_AFTER_ROUNDING for named $0 shares, only with whole-dollar splits', () => {
    // Review round 3 (#34): no warning when the floored pool is $0 (tips $3 -> pool $0.90 -> $0),
    // so use tips $10 -> pool $3: bartenders $2, barbacks $1 (tied, held), hosts $0 -> Hannah $0.
    const empty: ShiftInput = { ...server, totalTips: 300, foodSales: 0, netSales: 1000 };
    expect(calculateShift(empty, SERVER_DEFAULT_PROFILE).warnings.map((x) => x.code)).not.toContain(
      'ZERO_SHARE_AFTER_ROUNDING',
    );
    const tiny: ShiftInput = { ...server, totalTips: 1000, foodSales: 0, netSales: 1000 };
    const on = calculateShift(tiny, SERVER_DEFAULT_PROFILE);
    const w = on.warnings.find((x) => x.code === 'ZERO_SHARE_AFTER_ROUNDING');
    expect(w).toBeDefined();
    expect(w!.message).toContain('Hannah');
    const off = calculateShift(tiny, SERVER_DEFAULT_PROFILE, { roundMemberShares: false });
    expect(off.warnings.map((x) => x.code)).not.toContain('ZERO_SHARE_AFTER_ROUNDING');
    const golden = calculateShift(
      { ...server, team: server.team.map((m) => ({ ...m, hours: undefined })) },
      SERVER_DEFAULT_PROFILE,
    );
    expect(golden.warnings.map((x) => x.code)).not.toContain('ZERO_SHARE_AFTER_ROUNDING');
  });
});
