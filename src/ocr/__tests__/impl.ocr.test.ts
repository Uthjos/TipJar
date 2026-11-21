import { LABELS } from '../labels';
import { parseMoneyToken } from '../money';
import { detectPos, parseReceipt } from '../parseReceipt';

describe('parseMoneyToken', () => {
  it.each([
    ['$1,234.56', 123456],
    ['1234.56', 123456],
    ['1,234.56', 123456],
    ['$0.50', 50],
    ['.50', 50],
    ['12', 1200],
    ['(12.34)', -1234],
    ['-12.34', -1234],
    ['12.3', 1230],
    ['12,34', 1234],
    ['1O.5O', 1050],
    ['l2.00', 1200],
    ['S0.00', 5000],
    ['1 234.56', 123456],
    ['$B8.00', 8800],
  ])('%s -> %s', (t, c) => expect(parseMoneyToken(t)).toBe(c));

  it.each(['', 'abc', 'Sales', '1,2', '12.345', '1,2345.00', '$', '--1', 'SOB'])(
    '%s -> null',
    (t) => expect(parseMoneyToken(t)).toBeNull(),
  );
});

const TOAST = `Toast
Server Checkout - Hannah
Net Sales..........$1,560.25
Gross Sales        $1,702.10
Sales by Category
Food      $700.12
Liquor    $500.00
Non-Cash Tips      $300.56
Cash Tips Declared $40.00
Tips Owed          $340.56
`;

const SQUARE = `Square
Shift report
Gross Sales $1,000.00
Net Sales $905.43
Food Sales $120.00
Total Tips $192.55
Tip % 21%
`;

const ALOHA = `NCR Aloha
CHECKOUT
NET SALES
905.43
CHARGE TIPS     150.00
DECLARED TIPS    42.55
TIP SHARE        10.00
`;

describe('parseReceipt', () => {
  it('Toast: card + cash tips, category food, ignores tips owed and gross sales', () => {
    const r = parseReceipt(TOAST);
    expect(r.pos).toBe('toast');
    expect(r.fields.netSales).toEqual(
      expect.objectContaining({ cents: 156025, confidence: 'high', how: 'label' }),
    );
    expect(r.fields.totalTips).toEqual(
      expect.objectContaining({ cents: 34056, how: 'card+cash', confidence: 'high' }),
    );
    expect(r.fields.foodSales).toEqual(
      expect.objectContaining({ cents: 70012, confidence: 'medium' }),
    );
    expect(r.missing).toEqual([]);
    expect(r.notes).toContain('Found card and cash tips and added them.');
  });

  it('Square: explicit labels, ignores tip %', () => {
    const r = parseReceipt(SQUARE);
    expect(r.pos).toBe('square');
    expect(r.fields.totalTips!.cents).toBe(19255);
    expect(r.fields.netSales!.cents).toBe(90543);
    expect(r.fields.foodSales).toEqual(
      expect.objectContaining({ cents: 12000, confidence: 'high' }),
    );
  });

  it('Aloha: next-line amount is medium; charge + declared tips; tip share ignored', () => {
    const r = parseReceipt(ALOHA);
    expect(r.pos).toBe('aloha');
    expect(r.fields.netSales).toEqual(
      expect.objectContaining({ cents: 90543, confidence: 'medium' }),
    );
    expect(r.fields.totalTips).toEqual(expect.objectContaining({ cents: 19255, how: 'card+cash' }));
    expect(r.missing).toEqual(['foodSales']);
  });

  it('positional amounts from OCR frames', () => {
    const r = parseReceipt([
      { text: 'Net Sales', top: 100, left: 10, height: 20 },
      { text: 'Total Tips', top: 140, left: 10, height: 20 },
      { text: '$192.55', top: 142, left: 300, height: 20 },
      { text: '$905.43', top: 98, left: 300, height: 20 },
    ]);
    expect(r.fields.netSales).toEqual(
      expect.objectContaining({ cents: 90543, confidence: 'medium' }),
    );
    expect(r.fields.totalTips!.cents).toBe(19255);
  });

  it('card-only / cash-only tips, negatives, duplicates and sanity notes', () => {
    expect(parseReceipt('Credit Card Tips $50.00\nNet Sales 400').fields.totalTips).toEqual(
      expect.objectContaining({ how: 'card-only', confidence: 'medium' }),
    );
    expect(parseReceipt('Cash Tips 20').fields.totalTips).toEqual(
      expect.objectContaining({ how: 'cash-only', confidence: 'low' }),
    );
    const neg = parseReceipt('Net Sales (12.00)\nTotal Tips 5.00');
    expect(neg.missing).toEqual(['netSales', 'foodSales']);
    expect(neg.notes.join(' ')).toMatch(/negative/);
    const dup = parseReceipt('Net Sales 100.00\nNet Sales 120.00\nTotal Tips 500\nFood Sales 200');
    expect(dup.fields.netSales).toEqual(
      expect.objectContaining({ cents: 12000, confidence: 'medium' }),
    );
    expect(dup.notes).toEqual(
      expect.arrayContaining([
        'Food sales are higher than net sales — check them.',
        'Tips are higher than net sales — check them.',
      ]),
    );
    const loose = parseReceipt('Sales (net) 90.00\nNet Sales 80.00\nSales (net) 70.00');
    expect(loose.fields.netSales!.cents).toBe(8000);
    expect(parseReceipt('Net Sales $1O0.00').fields.netSales!.confidence).toBe('low');
  });

  it('never throws and detects generic', () => {
    for (const junk of ['', '\n\n', '$$$', 'Tips', ':::...', 'Net Sales Tax 4.00', '🙂 tips 5']) {
      expect(() => parseReceipt(junk)).not.toThrow();
    }
    expect(parseReceipt('Net Sales Tax 4.00').missing).toEqual([
      'totalTips',
      'netSales',
      'foodSales',
    ]);
    expect(detectPos([{ text: 'My Diner' }])).toBe('generic');
    expect(Object.keys(LABELS)).toEqual(['generic', 'toast', 'square', 'aloha']);
  });

  it('review decisions #94-#103', () => {
    const r = (...lines: string[]) => parseReceipt(lines.join('\n'));
    // #94: bare "Tips" counts only as the whole label; headers and "gratuity" don't.
    expect(r('Tips $123.45').fields.totalTips).toEqual(
      expect.objectContaining({ cents: 12345, how: 'label', confidence: 'high' }),
    );
    expect(r('Tips and gratuity report 2026', 'Net Sales 100').fields.totalTips).toBeUndefined();
    expect(r('Gratuity 15.00').fields.totalTips).toBeUndefined();
    // #96: a "TIPS" header doesn't take the next label line's amount.
    expect(r('TIPS', 'Credit Card Tips 120.00', 'Cash Tips 20.00').fields.totalTips).toEqual(
      expect.objectContaining({ cents: 14000, how: 'card+cash' }),
    );
    // #97 / #98 / #103: service charges, net tips and tips owed are ignored for every field.
    const ignored = r(
      'Service Charge 25.00',
      'Auto Gratuity 18.00',
      'Net Tips 80.00',
      'Tips Owed 30.00',
      'Net Sales 500.00',
    );
    expect(ignored.fields.totalTips).toBeUndefined();
    expect(ignored.fields.netSales!.cents).toBe(50000);
    // #98: card + cash preferred over a bare "Tips" line.
    expect(r('Tips 80.00', 'Card Tips 90.00', 'Cash Tips 20.00').fields.totalTips).toEqual(
      expect.objectContaining({ cents: 11000, how: 'card+cash' }),
    );
    // #95: Aloha / generic "charge tips".
    expect(r('Charge Tips 50.00', 'Declared Tips 5.00').fields.totalTips!.cents).toBe(5500);
    // #101: the lowest confidence wins (OCR-fixed card tips inside card + cash).
    expect(r('Card Tips 5O.00', 'Cash Tips 5.00').fields.totalTips!.confidence).toBe('low');
  });
});
