import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { calculateShift } from '@/engine/calculate';
import { buildShiftInput, selectProfile, useShiftStore } from '@/store/shiftStore';

import HistoryScreen from '../../app/(tabs)/history';
import NewShiftScreen from '../../app/(tabs)/index';
import ResultsScreen from '../../app/shift/results';
import TeamScreen from '../../app/shift/team';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), dismissAll: jest.fn() },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

function seedGolden() {
  const s = useShiftStore.getState();
  s.setMoney('totalTips', 34056);
  s.setMoney('netSales', 156025);
  s.setMoney('foodSales', 70012);
  s.addMember('bartender', 'Joseph');
  s.addMember('bartender', 'Aaron');
  s.addMember('barback', 'David');
  s.addMember('barback', 'Allen');
}

describe('manual flow screens', () => {
  beforeEach(() => useShiftStore.setState(useShiftStore.getInitialState()));

  it('New Shift renders money inputs', async () => {
    await render(<NewShiftScreen />);
    expect(screen.getByLabelText('Total tips')).toBeTruthy();
    expect(screen.getByLabelText('Round to nearest dollar')).toBeTruthy();
  });

  it('Who worked lists roles for the server profile', async () => {
    await render(<TeamScreen />);
    expect(screen.getByText('Bartenders')).toBeTruthy();
    expect(screen.getByText('+ Add host')).toBeTruthy();
  });

  it('Results shows the tip-out and the missing-role toggle', async () => {
    seedGolden();
    await render(<ResultsScreen />);
    // No host on shift and 'retain' by default: $102 pool less the host's $11 kept, less the
    // barbacks' odd $1 held back on tied hours.
    expect(screen.getByText('$90.00')).toBeTruthy();
    expect(screen.getByText('$1.00 kept back — tied hours')).toBeTruthy();
    expect(screen.getByText('Nobody on shift')).toBeTruthy();
    // Defaults to keeping the missing share (owner Q3).
    expect(useShiftStore.getState().draft.missingRoleHandling).toBe('retain');
    expect(screen.getByText('$11.00 kept')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Give to other roles'));
    expect(useShiftStore.getState().draft.missingRoleHandling).toBe('redistribute');
  });

  it('bartender Results headline shows whole dollars with a change note', async () => {
    const s = useShiftStore.getState();
    s.setProfile('bartender-default'); // adds "Me" as a bartender
    s.setMoney('totalTips', 19255);
    s.setMoney('netSales', 90543);
    s.setMoney('foodSales', 12000);
    s.addMember('bartender', 'Aaron');
    s.addMember('barback', 'David');
    s.addMember('barback', 'Allen');
    await render(<ResultsScreen />);
    expect(screen.getByLabelText('Bar keeps $150.00')).toBeTruthy();
    expect(
      screen.getByText('$0.55 in change left over — stays with whoever closes out.'),
    ).toBeTruthy();
    expect(screen.getAllByText('$75.00')).toHaveLength(2);
    expect(screen.getByLabelText('Your share $75.55')).toBeTruthy();
  });

  it('Who worked offers saved coworkers as quick-add chips', async () => {
    useShiftStore.setState({
      coworkers: [
        { id: 'c1', name: 'Zoe', usualRole: 'host', lastWorked: '2026-11-10' },
        { id: 'c2', name: 'Joseph', usualRole: 'bartender', lastWorked: '2026-11-09' },
      ],
    });
    await render(<TeamScreen />);
    await fireEvent.press(screen.getByLabelText('Add Zoe as host'));
    expect(useShiftStore.getState().draft.team).toEqual([
      expect.objectContaining({ name: 'Zoe', role: 'host' }),
    ]);
    // Zoe is now on the team, so her chip is hidden.
    expect(screen.queryByLabelText('Add Zoe as host')).toBeNull();
    expect(screen.getByLabelText('Add Joseph as bartender')).toBeTruthy();
  });

  it('History lists saved shifts and confirms before deleting', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    seedGolden();
    const state = useShiftStore.getState();
    const profile = selectProfile(state);
    const input = buildShiftInput(state.draft, profile);
    await state.saveShift(input, calculateShift(input, profile).result);
    await render(<HistoryScreen />);
    await fireEvent.press(screen.getByLabelText('Delete'));
    expect(alert).toHaveBeenCalledWith('Delete this shift?', expect.any(String), expect.any(Array));
    expect(useShiftStore.getState().savedShifts).toHaveLength(1);
    alert.mockRestore();
  });
});
