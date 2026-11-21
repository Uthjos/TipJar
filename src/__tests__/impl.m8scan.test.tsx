import { fireEvent, render, screen } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';

import { useShiftStore } from '@/store/shiftStore';

import NewShiftScreen from '../../app/(tabs)/index';
import ScanScreen from '../../app/scan';

const mockOcr = { available: true };
const mockDelete = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissAll: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({
    uri,
    exists: true,
    delete: () => mockDelete(uri),
  })),
}));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('@/ocr/recognize', () => ({
  DEV_BUILD_MESSAGE: 'Scanning needs the TipJar development build.',
  isOcrAvailable: () => mockOcr.available,
  recognizeImage: jest.fn(async () => [
    { text: 'Square' },
    { text: 'Net Sales $905.43' },
    { text: 'Total Tips $192.55' },
  ]),
}));

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

describe('Receipt scanning (M8)', () => {
  beforeEach(() => {
    useShiftStore.setState(useShiftStore.getInitialState(), true);
    mockOcr.available = true;
    jest.clearAllMocks();
  });

  it('Expo Go: shows the dev-build message, nothing crashes', async () => {
    mockOcr.available = false;
    await render(<NewShiftScreen />);
    expect(screen.getByText('Scanning needs the TipJar development build.')).toBeTruthy();
    expect(screen.getByLabelText('Scan receipt').props.accessibilityState.disabled).toBe(true);
    await render(<ScanScreen />);
    expect(screen.getByText('Scanning needs the TipJar development build.')).toBeTruthy();
  });

  it('camera permission denied explains and offers settings', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false } as never);
    await render(<ScanScreen />);
    await fireEvent.press(screen.getByLabelText('Take photo'));
    expect(screen.getByText(/needs camera access/)).toBeTruthy();
    expect(screen.getByLabelText('Open settings')).toBeTruthy();
  });

  it('reads a photo, deletes it, confirms and fills New Shift with highlights', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/receipt.jpg' }],
    } as never);
    await render(<ScanScreen />);
    await fireEvent.press(screen.getByLabelText('Choose photo'));

    expect(mockDelete).toHaveBeenCalledWith('file:///cache/receipt.jpg');
    expect(screen.getByText('Check the numbers')).toBeTruthy();
    expect(screen.getAllByText('Found')).toHaveLength(2);
    expect(screen.getByText('Not found')).toBeTruthy();
    expect(screen.getByText('From: “Net Sales $905.43”')).toBeTruthy();

    // The user fixes the tips before using them.
    await fireEvent.changeText(screen.getByLabelText('Total tips from receipt'), '200.00');
    await fireEvent.press(screen.getByLabelText('Use these numbers'));
    const d = useShiftStore.getState().draft;
    expect(d.totalTips).toBe(20000);
    expect(d.netSales).toBe(90543);
    expect(d.foodSales).toBeUndefined();
    expect(d.scanned).toEqual(['totalTips', 'netSales']);
    expect(router.back).toHaveBeenCalled();

    await render(<NewShiftScreen />);
    expect(screen.getByText('Net sales · from receipt')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Net sales'), '900');
    expect(useShiftStore.getState().draft.scanned).toEqual(['totalTips']);
    expect(screen.queryByText('Net sales · from receipt')).toBeNull();
  });
});
