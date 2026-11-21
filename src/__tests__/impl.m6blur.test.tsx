import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { useShiftStore } from '@/store/shiftStore';

import TeamScreen from '../../app/shift/team';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissAll: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

/**
 * Regression (emulator bug, M6): on blur, normalising used the typed text captured by an earlier
 * render ("5"), wrote "05:00" into the field while the committed clockIn stayed 17:00, and
 * checkTeamHours then warned about a 20.5 h shift.
 */
describe('Who worked: blur normalisation uses the latest text', () => {
  beforeEach(() => useShiftStore.setState(useShiftStore.getInitialState(), true));

  it('clock in: a stale end-editing handler still normalises 5pm to 17:00', async () => {
    useShiftStore.getState().addMember('barback', 'David');
    await render(<TeamScreen />);
    await fireEvent.press(screen.getByLabelText('Add hours for David'));
    await fireEvent.press(screen.getByLabelText('Clock in / out'));

    await fireEvent.changeText(screen.getByLabelText('Clock in time for David'), '5');
    // The handler as it was after the first keystroke (closure over "5").
    const staleEndEditing = screen.getByLabelText('Clock in time for David').props.onEndEditing;
    await fireEvent.changeText(screen.getByLabelText('Clock in time for David'), '5p');
    await fireEvent.changeText(screen.getByLabelText('Clock in time for David'), '5pm');
    await act(async () => staleEndEditing({ nativeEvent: { text: '5' } }));

    await fireEvent.changeText(screen.getByLabelText('Clock out time for David'), '130am');
    await fireEvent(screen.getByLabelText('Clock out time for David'), 'endEditing', {
      nativeEvent: { text: '130am' },
    });

    expect(screen.getByLabelText('Clock in time for David').props.value).toBe('17:00');
    expect(screen.getByLabelText('Clock out time for David').props.value).toBe('01:30');
    const david = useShiftStore.getState().draft.team[0]!;
    expect(david.clockIn).toBe('17:00');
    expect(david.clockOut).toBe('01:30');
    expect(screen.getByText('= 8.5 h · ends next day')).toBeTruthy();
    expect(screen.queryByText(/double-check/)).toBeNull();
    expect(screen.queryByText(/20\.5 h/)).toBeNull();
  });

  it('hours: a stale end-editing handler never rewrites the text to an older value', async () => {
    useShiftStore.getState().addMember('barback', 'David');
    await render(<TeamScreen />);
    await fireEvent.press(screen.getByLabelText('Add hours for David'));

    await fireEvent.changeText(screen.getByLabelText('Hours worked by David'), '6');
    const staleEndEditing = screen.getByLabelText('Hours worked by David').props.onEndEditing;
    await fireEvent.changeText(screen.getByLabelText('Hours worked by David'), '6h');
    await fireEvent.changeText(screen.getByLabelText('Hours worked by David'), '6h30');
    await act(async () => staleEndEditing({ nativeEvent: { text: '6' } }));

    expect(screen.getByLabelText('Hours worked by David').props.value).toBe('6.5');
    expect(useShiftStore.getState().draft.team[0]!.hours).toBe(6.5);
  });
});
