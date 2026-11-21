/**
 * Aloha (NCR) style OCR text (written from typical Aloha server checkout layouts).
 */
import { lines, type ReceiptFixture } from './types';

export const ALOHA_FIXTURES: ReceiptFixture[] = [
  {
    /*
     * "Charge Tips" is Aloha's card-tips label (ASSUMPTION, findings #95: it must be in the Aloha
     * synonyms) + "Declared Tips" (generic cash) -> card+cash 30556 + 3500 = 34056, high.
     * "Tip Share Paid" is ignored. Food via "Category Totals" -> medium.
     */
    name: 'aloha-server-checkout',
    pos: 'aloha',
    input: lines(
      'NCR Aloha',
      'SERVER CHECKOUT',
      'Server: 104 JOSEPH M',
      'Business Date: 11/17/2026',
      '',
      'Gross Sales             1,712.40',
      'Net Sales               1,560.25',
      'Charge Tips               305.56',
      'Declared Tips              35.00',
      'Tip Share Paid            -48.00',
      '',
      'Revenue Center Totals',
      'DINING ROOM             1,105.10',
      'BAR                       455.15',
      'Category Totals',
      'FOOD                      700.12',
      'LIQUOR                    512.80',
      'BEER                      198.33',
      'WINE                      149.00',
    ),
    expected: {
      fields: {
        totalTips: { cents: 34056, confidence: 'high', how: 'card+cash' },
        netSales: { cents: 156025, confidence: 'high' },
        foodSales: { cents: 70012, confidence: 'medium' },
      },
      missing: [],
    },
  },
  {
    /*
     * Explicit Total Tips (label, high) wins over Charge/Declared. "Tips Owed" and "Sales Tax"
     * are ignored. Explicit "Food Sales" -> high.
     */
    name: 'aloha-checkout-with-total',
    pos: 'aloha',
    input: lines(
      'ALOHA POS - NCR',
      'Checkout   Server 211 AARON K',
      'Net Sales        845.00',
      'Food Sales       410.00',
      'Charge Tips      120.00',
      'Declared Tips     30.50',
      'Total Tips       150.50',
      'Tips Owed        150.50',
      'Sales Tax         69.71',
    ),
    expected: {
      fields: {
        totalTips: { cents: 15050, confidence: 'high', how: 'label' },
        netSales: { cents: 84500, confidence: 'high' },
        foodSales: { cents: 41000, confidence: 'high' },
      },
      missing: [],
    },
  },
  {
    /*
     * Messy: mixed case, dot leaders, OCR errors (l for 1, O for 0, S for 5).
     * Net Sales "l,O45.75" -> 104575, OCR-fixed -> low.
     * Charge Tips "l9S.20" -> 19520 (OCR-fixed) + Declared "2O.00" -> 2000 (OCR-fixed) ->
     *   card+cash 21520, low (an OCR-fixed part makes the sum low).
     * Food "S12.00" under "Category Totals" -> 51200, low.
     */
    name: 'aloha-messy-dot-leaders',
    pos: 'aloha',
    input: lines(
      'nCR aLOHA',
      'SERVER CHECKOUT REPORT',
      '* * * * * * * * * * * *',
      'NET SALES.........l,O45.75',
      'Charge Tips.......l9S.20',
      'DECLARED TIPS.....2O.00',
      'Category Totals',
      'Food..............S12.00',
      'Bev...............533.75',
      '* * * END * * *',
    ),
    expected: {
      fields: {
        totalTips: { cents: 21520, confidence: 'low', how: 'card+cash' },
        netSales: { cents: 104575, confidence: 'low' },
        foodSales: { cents: 51200, confidence: 'low' },
      },
      missing: [],
    },
  },
];
