import { calculateShift } from '@/engine/calculate';
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
    expect(result.pool).toBe(10200);

    const text = buildShareText(input, result);
    expect(text).toContain('Total tip-out: $102.00');
    expect(text).toContain('Bartenders: $44.00 — Joseph $22.00, Aaron $22.00');
    expect(text).toContain('I keep: $238.56');
  });

  it('switching to the bartender profile adds the user as a bartender', () => {
    useShiftStore.getState().setProfile('bartender-default');
    const state = useShiftStore.getState();
    expect(state.draft.team.filter((m) => m.role === 'bartender')).toHaveLength(1);
    expect(teamRolesFor(selectProfile(state))).toEqual(['bartender', 'barback', 'host']);
  });
});
