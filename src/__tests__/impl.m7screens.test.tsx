import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import { calculateShift } from '@/engine/calculate';
import { buildShiftInput, selectProfile, todayIso, useShiftStore } from '@/store/shiftStore';

import HistoryScreen from '../../app/(tabs)/history';
import ShiftDetailScreen from '../../app/history/[id]';
import ResultsScreen from '../../app/shift/results';

const mockParams: { id: string } = { id: '' };

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    dismissAll: jest.fn(),
    navigate: jest.fn(),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

async function saveOne() {
  const st = useShiftStore.getState();
  st.setMoney('totalTips', 34056);
  st.setMoney('netSales', 156025);
  st.setMoney('foodSales', 70012);
  st.addMember('bartender', 'Joseph');
  st.addMember('barback', 'David');
  const s = useShiftStore.getState();
  const profile = selectProfile(s);
  const input = buildShiftInput(s.draft, profile);
  await s.saveShift(input, calculateShift(input, profile).result);
  useShiftStore.getState().resetDraft();
  return useShiftStore.getState().savedShifts[0]!;
}

describe('History and shift detail (M7)', () => {
  beforeEach(() => {
    useShiftStore.setState(useShiftStore.getInitialState(), true);
    jest.clearAllMocks();
  });

  it('empty week state, next disabled at the current period, previous steps back', async () => {
    await render(<HistoryScreen />);
    expect(screen.getByText('No shifts this week yet.')).toBeTruthy();
    expect(screen.getByLabelText('Next week').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText('Previous week'));
    expect(screen.getByLabelText('Next week').props.accessibilityState.disabled).toBe(false);
    expect(screen.getByText(/^No shifts in /)).toBeTruthy();
  });

  it('shows totals, the chart description, tip-outs and the shift list', async () => {
    const saved = await saveOne();
    expect(saved.input.date).toBe(todayIso());
    await render(<HistoryScreen />);
    expect(screen.getByLabelText(/^You earned \$/)).toBeTruthy();
    expect(screen.getByLabelText(/^Shifts 1$/)).toBeTruthy();
    expect(screen.getByLabelText(/^What you earned per day, /)).toBeTruthy();
    expect(screen.getByText('Joseph')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Month'));
    expect(screen.getByLabelText(/^Shifts 1$/)).toBeTruthy();
  });

  it('detail: read-only results, delete asks first, edit loads the draft; Results says Update', async () => {
    const saved = await saveOne();
    mockParams.id = saved.id;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<ShiftDetailScreen />);
    expect(screen.getByLabelText(/^Total tip-out \$/)).toBeTruthy();
    expect(screen.queryByLabelText(/What to do with the/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Delete'));
    expect(alert).toHaveBeenCalledWith('Delete this shift?', expect.any(String), expect.any(Array));
    expect(useShiftStore.getState().savedShifts).toHaveLength(1);
    alert.mockRestore();

    await fireEvent.press(screen.getByLabelText('Edit shift'));
    expect(useShiftStore.getState().draft.editingShiftId).toBe(saved.id);
    expect(router.navigate).toHaveBeenCalledWith('/');

    await render(<ResultsScreen />);
    await fireEvent.press(screen.getByLabelText('Update shift'));
    expect(useShiftStore.getState().savedShifts).toHaveLength(1);
    expect(useShiftStore.getState().draft.editingShiftId).toBeUndefined();
  });
});
