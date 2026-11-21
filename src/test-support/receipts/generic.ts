/**
 * Generic (unknown POS) OCR text, using only the contract's generic synonyms.
 */
import { lines, type ReceiptFixture } from './types';

export const GENERIC_FIXTURES: ReceiptFixture[] = [
  {
    /* Colon labels; "Total Net Sales", "Food Total", "Tips Total" -> all high. */
    name: 'generic-colon-labels',
    pos: 'generic',
    input: lines(
      'SHIFT REPORT',
      'Total Net Sales: $2,310.00',
      'Food Total: $1,105.50',
      'Tips Total: $462.00',
    ),
    expected: {
      fields: {
        totalTips: { cents: 46200, confidence: 'high', how: 'label' },
        netSales: { cents: 231000, confidence: 'high' },
        foodSales: { cents: 110550, confidence: 'high' },
      },
      missing: [],
    },
  },
  {
    /* Card tips only -> card-only, medium (with a note). "Kitchen Sales" is a food synonym. */
    name: 'generic-card-only',
    pos: 'generic',
    input: lines('End of Day', 'Net Sales 980.00', 'CC Tips 176.40', 'Kitchen Sales 300.00'),
    expected: {
      fields: {
        totalTips: { cents: 17640, confidence: 'medium', how: 'card-only' },
        netSales: { cents: 98000, confidence: 'high' },
        foodSales: { cents: 30000, confidence: 'high' },
      },
      missing: [],
    },
  },
  {
    /*
     * "Sales (Net)" is a looser synonym -> medium. Cash gratuity only -> cash-only, low.
     * No food line -> missing.
     */
    name: 'generic-cash-only-no-food',
    pos: 'generic',
    input: lines('Daily Summary', 'Sales (Net) 450.00', 'Cash Gratuity 60.00'),
    expected: {
      fields: {
        totalTips: { cents: 6000, confidence: 'low', how: 'cash-only' },
        netSales: { cents: 45000, confidence: 'medium' },
      },
      missing: ['foodSales'],
    },
  },
  {
    /*
     * Noise lines, mixed case, and two disagreeing Net Sales lines: the last one wins with
     * medium confidence. "TIP OUT" is ignored; "total tips" is the label.
     */
    name: 'generic-noise-duplicates',
    pos: 'generic',
    input: lines(
      '*** COPY ***',
      'Thank you!!',
      'net sales     1,200.00',
      'Checks: 23   Guests: 41',
      'TIP OUT       -50.00',
      'total tips    210.00',
      '----',
      'Net Sales     1,250.00',
      'Have a great night',
    ),
    expected: {
      fields: {
        totalTips: { cents: 21000, confidence: 'high', how: 'label' },
        netSales: { cents: 125000, confidence: 'medium' },
      },
      missing: ['foodSales'],
    },
  },
];
