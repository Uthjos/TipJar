import { fireEvent, render, screen } from '@testing-library/react-native';

import { useShiftStore } from '@/store/shiftStore';

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

  it('Results shows the golden tip-out and the missing-role toggle', async () => {
    seedGolden();
    await render(<ResultsScreen />);
    expect(screen.getByText('$102.00')).toBeTruthy();
    expect(screen.getByText('Nobody on shift')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Keep for me'));
    expect(useShiftStore.getState().draft.missingRoleHandling).toBe('retain');
  });
});
