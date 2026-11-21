import { isOcrAvailable, recognizeImage, toOcrLines } from '../recognize';

describe('recognize (native wrapper)', () => {
  it('is unavailable without the native module (Expo Go / tests) and rejects politely', async () => {
    expect(isOcrAvailable()).toBe(false);
    await expect(recognizeImage('file:///x.jpg')).rejects.toThrow(
      'Scanning needs the TipJar development build.',
    );
  });

  it('maps ML Kit blocks / lines to OcrLine with top, left and height', () => {
    expect(
      toOcrLines({
        text: '',
        blocks: [
          {
            text: 'Net Sales $905.43',
            frame: { left: 0, top: 0, right: 10, bottom: 10 },
            lines: [
              { text: 'Net Sales', frame: { left: 10, top: 100, right: 200, bottom: 124 } },
              { text: '$905.43', frame: { left: 300, top: 98, right: 380, bottom: 122 } },
            ],
          },
          { text: 'Loose block', lines: [] },
        ],
      }),
    ).toEqual([
      { text: 'Net Sales', top: 100, left: 10, height: 24 },
      { text: '$905.43', top: 98, left: 300, height: 24 },
      { text: 'Loose block' },
    ]);
  });
});
