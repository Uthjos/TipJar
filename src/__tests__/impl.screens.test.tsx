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

  it('Results shows the tip-out and the missing-role toggle', async () => {
    seedGolden();
    await render(<ResultsScreen />);
    // No host on shift and 'retain' by default: $102 pool less the host's $11 kept.
    expect(screen.getByText('$91.00')).toBeTruthy();
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
    expect(screen.getByLabelText('Bar keeps $149.00')).toBeTruthy();
    expect(
      screen.getByText('$0.55 in change left over — stays with whoever closes out.'),
    ).toBeTruthy();
    expect(screen.getByText('$75.00')).toBeTruthy();
    expect(screen.getByText('$74.00')).toBeTruthy();
  });
});
