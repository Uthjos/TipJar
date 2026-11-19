import { calculateShift } from '../calculate';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../profiles';
import type { RoleResult, ShiftInput, TeamMember } from '../types';

const role = (roles: RoleResult[], id: string) => {
  const r = roles.find((x) => x.role === id);
  if (!r) throw new Error(`role ${id} not found`);
  return r;
};

const amounts = (r: RoleResult) => r.members.map((m) => m.amount);

const serverTeam: TeamMember[] = [
  { id: 'j', name: 'Joseph', role: 'bartender' },
  { id: 'a', name: 'Aaron', role: 'bartender' },
  { id: 'd', name: 'David', role: 'barback' },
  { id: 'al', name: 'Allen', role: 'barback' },
  { id: 'h', name: 'Hannah', role: 'host' },
];

const goldenServer: ShiftInput = {
  date: '2026-01-01',
  userRole: 'server',
  totalTips: 34056,
  netSales: 156025,
  foodSales: 70012,
  team: serverTeam,
  missingRoleHandling: 'redistribute',
  profileId: 'server-default',
  roundToDollar: true,
};

describe('golden test 1 — server example (§5.5)', () => {
  const { result, warnings } = calculateShift(goldenServer, SERVER_DEFAULT_PROFILE);

  it('matches the spec exactly', () => {
    expect(warnings).toEqual([]);
    expect(result.pool).toBe(10200);
    expect(result.roundingAdjustment).toBe(17);
    // kept = totalTips - pool = 34056 - 10200
    expect(result.kept).toBe(23856);
    expect(result.keptChange).toBe(0);
    expect(result.retained).toBe(0);
    expect(result.keptSplit).toBeUndefined();

    expect(role(result.roles, 'kitchen').amount).toBe(1400);
    expect(role(result.roles, 'kitchen').members).toEqual([]);
    expect(role(result.roles, 'kitchen').missing).toBeFalsy();
    expect(role(result.roles, 'bartender').amount).toBe(4400);
    expect(amounts(role(result.roles, 'bartender'))).toEqual([2200, 2200]);
    expect(role(result.roles, 'barback').amount).toBe(3300);
    // Whole-dollar member shares by default (owner Q1); tie -> earlier member.
    expect(amounts(role(result.roles, 'barback'))).toEqual([1700, 1600]);
    expect(role(result.roles, 'host').amount).toBe(1100);
    expect(amounts(role(result.roles, 'host'))).toEqual([1100]);
  });

  it('roundMemberShares: false restores cent splits', () => {
    const r = calculateShift(goldenServer, SERVER_DEFAULT_PROFILE, { roundMemberShares: false });
    expect(amounts(role(r.result.roles, 'barback'))).toEqual([1650, 1650]);
    expect(r.result.keptChange).toBe(0);
  });

  it('reports percentages in 0–100', () => {
    expect(result.poolPercentOfTips).toBeCloseTo((10200 / 34056) * 100, 10);
    expect(result.poolPercentOfNetSales).toBeCloseTo((10200 / 156025) * 100, 10);
    expect(role(result.roles, 'host').members[0]!.percentOfTips).toBeCloseTo(
      (1100 / 34056) * 100,
      10,
    );
  });

  it('roles keep profile order', () => {
    expect(result.roles.map((r) => r.role)).toEqual(['kitchen', 'bartender', 'barback', 'host']);
  });
});

const bartenderInput = (handling: 'retain' | 'redistribute'): ShiftInput => ({
  date: '2026-01-01',
  userRole: 'bartender',
  totalTips: 19255,
  netSales: 90543,
  foodSales: 12000,
  team: [
    { id: 'j', name: 'Joseph', role: 'bartender' },
    { id: 'a', name: 'Aaron', role: 'bartender' },
    { id: 'd', name: 'David', role: 'barback' },
    { id: 'al', name: 'Allen', role: 'barback' },
  ],
  missingRoleHandling: handling,
  profileId: 'bartender-default',
  roundToDollar: true,
});

describe('golden test 2 — bartender example (§5.6)', () => {
  it('retain: hosts share stays with the bartenders', () => {
    const { result } = calculateShift(bartenderInput('retain'), BARTENDER_DEFAULT_PROFILE);
    expect(result.pool).toBe(4300);
    expect(role(result.roles, 'kitchen').amount).toBe(200);
    expect(role(result.roles, 'barback').amount).toBe(4100);
    expect(amounts(role(result.roles, 'barback'))).toEqual([2100, 2000]);
    const host = role(result.roles, 'host');
    expect(host.amount).toBe(1400);
    expect(host.missing).toBe(true);
    expect(host.members).toEqual([]);
    expect(result.retained).toBe(1400);
    expect(result.roundingAdjustment).toBe(77);
    expect(result.kept).toBe(14955);
    // Bar shares $149 in whole dollars; $0.55 change (owner Q2).
    expect(result.keptSplit!.map((k) => k.amount)).toEqual([7500, 7400]);
    expect(result.keptChange).toBe(55);
    expect(result.keptSplit!.map((k) => k.name)).toEqual(['Joseph', 'Aaron']);
  });

  it('retain + roundMemberShares: false restores cent-level splits', () => {
    const { result } = calculateShift(bartenderInput('retain'), BARTENDER_DEFAULT_PROFILE, {
      roundMemberShares: false,
    });
    expect(amounts(role(result.roles, 'barback'))).toEqual([2050, 2050]);
    expect(result.keptSplit!.map((k) => k.amount)).toEqual([7478, 7477]);
    expect(result.keptChange).toBe(0);
    expect(result.kept).toBe(14955);
  });

  it('rounding off: keptSplit to the cent, keptChange 0', () => {
    const { result } = calculateShift(
      { ...bartenderInput('retain'), roundToDollar: false },
      BARTENDER_DEFAULT_PROFILE,
    );
    expect(result.keptChange).toBe(0);
    expect(result.keptSplit!.reduce((a, k) => a + k.amount, 0)).toBe(result.kept);
  });

  it('redistribute: hosts share goes to the barbacks', () => {
    const { result } = calculateShift(bartenderInput('redistribute'), BARTENDER_DEFAULT_PROFILE);
    expect(role(result.roles, 'kitchen').amount).toBe(200);
    expect(role(result.roles, 'barback').amount).toBe(5500);
    expect(amounts(role(result.roles, 'barback'))).toEqual([2800, 2700]);
    const host = role(result.roles, 'host');
    expect(host.amount).toBe(0);
    expect(host.missing).toBe(true);
    expect(result.retained).toBe(0);
    expect(result.pool).toBe(5700);
    expect(result.kept).toBe(13555);
    expect(result.roundingAdjustment).toBe(77);
    expect(result.keptSplit!.map((k) => k.amount)).toEqual([6800, 6700]);
    expect(result.keptChange).toBe(55);
  });
});
