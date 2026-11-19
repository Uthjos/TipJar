import { calculateShift } from '@/engine/calculate';
import { userEarnings } from '@/lib/earnings';
import { buildShareText } from '@/lib/format';
import { buildShiftInput, selectProfile, teamRolesFor, useShiftStore } from '@/store/shiftStore';

describe('shift store (in-memory)', () => {
  beforeEach(() => {
    useShiftStore.setState(useShiftStore.getInitialState());
  });

  it('builds engine input and reproduces the server golden example', () => {
    const s = useShiftStore.getState();
    s.setMoney('totalTips', 34056);
    s.setMoney('netSales', 156025);
    s.setMoney('foodSales', 70012);
    s.addMember('bartender', 'Joseph');
    s.addMember('bartender', 'Aaron');
    s.addMember('barback', 'David');
    s.addMember('barback', '');
    s.addMember('host', 'Hannah');

    const state = useShiftStore.getState();
    const profile = selectProfile(state);
    const input = buildShiftInput(state.draft, profile);
    expect(input.userRole).toBe('server');
    expect(input.team[3]!.name).toBe('Barback 2');

    const { result } = calculateShift(input, profile);
    expect(result.pool).toBe(10100);

    const text = buildShareText(input, result);
    expect(text).toContain('Total tip-out: $101.00');
    expect(text).toContain('Bartenders: $44.00 — Joseph $22.00, Aaron $22.00');
    expect(text).toContain(
      'Barbacks: $32.00 ($1.00 kept back — tied hours) — David $16.00, Barback 2 $16.00',
    );
    expect(text).toContain('I keep: $239.56');
    expect(userEarnings(input, result)).toBe(23956);
  });

  it('switching to the bartender profile adds the user as a bartender', () => {
    useShiftStore.getState().setProfile('bartender-default');
    const state = useShiftStore.getState();
    expect(state.draft.team.filter((m) => m.role === 'bartender')).toHaveLength(1);
    expect(teamRolesFor(selectProfile(state))).toEqual(['bartender', 'barback', 'host']);
  });

  it('defaults missing roles to retain (owner Q3)', () => {
    expect(useShiftStore.getState().draft.missingRoleHandling).toBe('retain');
  });

  it('bartender share text shows whole-dollar bar share and the change', () => {
    const s = useShiftStore.getState();
    s.setProfile('bartender-default');
    s.setMoney('totalTips', 19255);
    s.setMoney('netSales', 90543);
    s.setMoney('foodSales', 12000);
    s.addMember('bartender', 'Aaron');
    s.addMember('barback', 'David');
    s.addMember('barback', 'Allen');
    const state = useShiftStore.getState();
    const profile = selectProfile(state);
    const input = buildShiftInput(state.draft, profile);
    const { result } = calculateShift(input, profile);
    const text = buildShareText(input, result);
    expect(text).toContain('Bar keeps: $150.00');
    expect(text).toContain('  Me $75.00');
    expect(text).toContain('  Aaron $75.00');
    expect(text).toContain('Barbacks: $40.00 ($1.00 kept back — tied hours)');
    // The auto-added "Me" is the user: own share + the change (owner Q9).
    expect(state.draft.team.find((m) => m.name === 'Me')!.isUser).toBe(true);
    expect(userEarnings(input, result)).toBe(7555);
    expect(text).toContain('($0.55 in change left over — stays with whoever closes out.)');
    expect(text).toContain('Hosts: nobody on shift ($14.00 kept)');
  });
});
