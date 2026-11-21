/**
 * Review round 7 (#87): the UTF-8 BOM is added only when the file is written, never by the pure
 * CSV builders.
 */
import { shiftsCsv } from '@/lib/csv';

import { shareCsv } from '../shareCsv';

// jest.mock factories are hoisted above the imports; `mock*` names may be used inside them.
const mockWritten: string[] = [];

jest.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: jest.fn().mockImplementation(() => ({
    uri: 'file:///cache/x.csv',
    create: jest.fn(),
    write: jest.fn(async (text: string) => {
      mockWritten.push(text);
    }),
  })),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

describe('shareCsv', () => {
  it('prefixes the file with a UTF-8 BOM; the pure builder output has none', async () => {
    const csv = shiftsCsv([]);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    await shareCsv('shifts.csv', csv);
    expect(mockWritten).toHaveLength(1);
    expect(mockWritten[0]!.charCodeAt(0)).toBe(0xfeff);
    expect(mockWritten[0]!.slice(1)).toBe(csv);
  });
});
