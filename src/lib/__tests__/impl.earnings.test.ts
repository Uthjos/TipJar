import { calculateShift } from '@/engine/calculate';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '@/engine/profiles';
import type { ShiftInput } from '@/engine/types';
import { userEarnings, userKeptEntry } from '@/lib/earnings';
import { changeNote, heldBackNote } from '@/lib/format';

const bartender = (withUser: boolean): ShiftInput => ({
  date: '2026-01-01',
  userRole: 'bartender',
  totalTips: 19255,
  netSales: 90543,
  foodSales: 12000,
  team: [
    { id: 'j', name: 'Joseph', role: 'bartender', isUser: withUser },
    { id: 'a', name: 'Aaron', role: 'bartender' },
    { id: 'd', name: 'David', role: 'barback' },
    { id: 'al', name: 'Allen', role: 'barback' },
  ],
  missingRoleHandling: 'retain',
  profileId: 'bartender-default',
  roundToDollar: true,
});

describe('userEarnings (owner Q9)', () => {
  it('bartender flow: own keptSplit amount + keptChange', () => {
    const input = bartender(true);
    const { result } = calculateShift(input, BARTENDER_DEFAULT_PROFILE);
    expect(userKeptEntry(input, result)!.memberId).toBe('j');
    expect(userEarnings(input, result)).toBe(7500 + 55);
  });

  it('bartender flow without isUser: falls back to all of kept', () => {
    const input = bartender(false);
    const { result } = calculateShift(input, BARTENDER_DEFAULT_PROFILE);
    expect(userKeptEntry(input, result)).toBeUndefined();
    expect(userEarnings(input, result)).toBe(result.kept);
  });

  it('bartender flow with no bartenders listed: all of kept (not counted twice)', () => {
    const input = { ...bartender(false), team: [] };
    const { result } = calculateShift(input, BARTENDER_DEFAULT_PROFILE);
    expect(result.keptChange).toBe(result.kept);
    expect(userEarnings(input, result)).toBe(result.kept);
  });

  it('server flow: kept', () => {
    const input: ShiftInput = { ...bartender(false), userRole: 'server', team: [] };
    const { result } = calculateShift(input, SERVER_DEFAULT_PROFILE);
    expect(userEarnings(input, result)).toBe(result.kept);
  });
});

describe('notes', () => {
  it('changeNote mentions held-back dollars only when there are some', () => {
    expect(changeNote(55)).toBe('$0.55 in change left over — stays with whoever closes out.');
    expect(changeNote(155, 100)).toBe(
      '$1.55 in change left over ($1.00 from tied hours) — stays with whoever closes out.',
    );
    expect(heldBackNote(100)).toBe('$1.00 kept back — tied hours');
  });
});
