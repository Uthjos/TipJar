import { fireEvent, render, screen } from '@testing-library/react-native';

import { useShiftStore } from '@/store/shiftStore';

import TeamScreen from '../../app/shift/team';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissAll: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

describe('Who worked: hours (M6)', () => {
  beforeEach(() => useShiftStore.setState(useShiftStore.getInitialState(), true));

  it('normalises clock times, shows the live span, flags problems and copies to the role', async () => {
    const st = useShiftStore.getState();
    const david = st.addMember('barback', 'David');
    st.addMember('barback', 'Allen');
    await render(<TeamScreen />);

    await fireEvent.press(screen.getByLabelText('Add hours for David'));
    await fireEvent.press(screen.getByLabelText('Clock in / out'));
    const clockIn = screen.getByLabelText('Clock in time for David');
    await fireEvent.changeText(clockIn, '5pm');
    await fireEvent(clockIn, 'endEditing');
    expect(screen.getByDisplayValue('17:00')).toBeTruthy();
    expect(useShiftStore.getState().draft.team[0]!.clockIn).toBe('17:00');

    // Clock-out missing: member error + Allen missing hours, button disabled.
    expect(screen.getByText('David needs a clock-out time.')).toBeTruthy();
    expect(screen.getByText('Fix 1 hours problem above to see the tip-out.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Clock out time for David'), '1:30am');
    expect(screen.getByText('= 8.5 h · ends next day')).toBeTruthy();
    expect(
      screen.getByText('Enter hours for Allen too, or clear them all for an even split.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('See tip-out').props.accessibilityState.disabled).toBe(true);

    // A bad time keeps the typed text and is flagged; nothing invalid is committed.
    await fireEvent.changeText(screen.getByLabelText('Clock out time for David'), 'late');
    expect(screen.getByDisplayValue('late')).toBeTruthy();
    expect(useShiftStore.getState().draft.team[0]!.clockOut).toBeUndefined();
    await fireEvent.changeText(screen.getByLabelText('Clock out time for David'), '01:30');

    await fireEvent.press(screen.getByLabelText('Same hours for everyone in this role as David'));
    const allen = useShiftStore.getState().draft.team[1]!;
    expect(allen).toEqual(expect.objectContaining({ clockIn: '17:00', clockOut: '01:30' }));
    expect(screen.queryByText(/Fix \d+ hours problem/)).toBeNull();
    expect(screen.getByLabelText('See tip-out').props.accessibilityState.disabled).toBe(false);
    expect(screen.getAllByText('= 8.5 h · ends next day')).toHaveLength(2);
    expect(useShiftStore.getState().draft.team.find((m) => m.id === david)!.clockIn).toBe('17:00');
  });
});
