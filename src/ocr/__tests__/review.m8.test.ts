/**
 * Milestone 8 decisions from the main-branch review (docs/review-log.md, round 8).
 * Finding numbers (#n) refer to docs/test-findings.md.
 */
import { parseReceipt } from '../parseReceipt';
import { isOcrAvailable, recognizeImage } from '../recognize';

// Expo Go has no ML Kit module and the package calls requireNativeModule at import time. Make
// requiring it throw, as it would in Expo Go: recognize.ts must still import fine and only touch
// the package once OCR is known to be available.
jest.mock('@infinitered/react-native-mlkit-text-recognition', () => {
  throw new Error("Cannot find native module 'RNMLKitTextRecognition'");
});

describe('Expo Go safety (recognize.ts)', () => {
  it('importing recognize.ts does not load the native package; OCR reports unavailable', async () => {
    expect(isOcrAvailable()).toBe(false);
    await expect(recognizeImage('file:///receipt.jpg')).rejects.toThrow(
      'Scanning needs the TipJar development build.',
    );
  });
});

describe('#100: reports for more than one person', () => {
  const NOTE = 'This looks like a report for more than one person — scan your own checkout.';

  it('adds a note when Server: / Employee: / Team member: appears more than once', () => {
    const text = [
      'Server: Joseph M',
      'Net Sales $1,000.00',
      'Total Tips $200.00',
      'Employee: Aaron K',
      'Net Sales $800.00',
      'Total Tips $150.00',
    ].join('\n');
    const r = parseReceipt(text);
    expect(r.notes).toContain(NOTE);
    // values are still filled (last occurrence), so the user can check and correct them
    expect(r.fields.netSales?.cents).toBe(80000);
  });

  it('no note for a single server checkout', () => {
    const text = ['Server: Joseph M', 'Net Sales $1,000.00', 'Total Tips $200.00'].join('\n');
    expect(parseReceipt(text).notes).not.toContain(NOTE);
  });
});
