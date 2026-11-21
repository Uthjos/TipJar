import { fireEvent, render, screen } from '@testing-library/react-native';

import { useShiftStore } from '@/store/shiftStore';

import SettingsScreen from '../../app/(tabs)/settings';
import OnboardingScreen from '../../app/onboarding';
import ProfileEditorScreen from '../../app/profile/[id]';
import TeamScreen from '../../app/shift/team';

const mockParams: { id: string; from?: string; appliesTo?: string } = { id: 'server-default' };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissAll: jest.fn() },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

describe('milestone 5 screens', () => {
  beforeEach(() => {
    useShiftStore.setState(useShiftStore.getInitialState(), true);
    mockParams.id = 'server-default';
    delete mockParams.from;
    delete mockParams.appliesTo;
  });

  it('Settings lists profiles with summaries, defaults and the whole-dollar toggle', async () => {
    await render(<SettingsScreen />);
    expect(
      screen.getByText(
        '30% of tips · Kitchen 2% of food sales · Bartenders 4 : Barbacks 3 : Hosts 1',
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText('Whole-dollar shares for each person')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Round to nearest dollar'));
    expect(useShiftStore.getState().settings.defaultRoundToDollar).toBe(false);
    expect(screen.getByText('Only applies when rounding to the nearest dollar is on')).toBeTruthy();
  });

  it('Profile editor: shows issues inline, blocks save, and saves a valid edit', async () => {
    await render(<ProfileEditorScreen />);
    await fireEvent.changeText(screen.getByLabelText('Profile name'), 'Bartender default');
    expect(screen.getByText('Another profile is already called "Bartender default".')).toBeTruthy();
    expect(screen.getByLabelText('Save profile').props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByLabelText('Profile name'), 'House rules');
    await fireEvent.changeText(screen.getByLabelText('Tip-out pool percent'), '25');
    await fireEvent.press(screen.getByLabelText('+ Custom…'));
    await fireEvent.changeText(screen.getByLabelText('Role 5 name'), 'Bar Porter');
    await fireEvent.press(screen.getByLabelText('Save profile'));
    const saved = useShiftStore.getState().profiles.find((p) => p.id === 'server-default')!;
    expect(saved.name).toBe('House rules');
    expect(saved.totalTipOutPercentOfTips).toBe(25);
    expect(saved.rules.at(-1)).toEqual({
      role: 'bar-porter',
      label: 'Bar Porter',
      type: 'shareOfRemainder',
      weight: 1,
    });
  });

  it('Profile editor explains why the only profile for a role cannot be deleted', async () => {
    mockParams.id = 'bartender-default';
    await render(<ProfileEditorScreen />);
    expect(screen.getByText(/only bartender profile/)).toBeTruthy();
  });

  it('Who worked shows custom roles by their label', async () => {
    const custom = useShiftStore.getState().duplicateProfile('server-default')!;
    custom.rules.push({
      role: 'bar-porter',
      label: 'Bar Porter',
      type: 'shareOfRemainder',
      weight: 1,
    });
    await useShiftStore.getState().saveProfile(custom);
    useShiftStore.getState().setProfile(custom.id);
    await render(<TeamScreen />);
    expect(screen.getByText('Bar Porter')).toBeTruthy();
    expect(screen.getByLabelText('+ Add bar porter')).toBeTruthy();
  });

  it('Onboarding: pick a role, review, looks good', async () => {
    await render(<OnboardingScreen />);
    await fireEvent.press(screen.getByLabelText('Bartender'));
    expect(useShiftStore.getState().settings.defaultProfileId).toBe('bartender-default');
    expect(
      screen.getByText('30% of tips · Kitchen 2% of food sales · Barbacks 3 : Hosts 1'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Looks good'));
    expect(useShiftStore.getState().settings.onboarded).toBe(true);
  });
});
