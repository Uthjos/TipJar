/**
 * Toast-style OCR text (written from typical Toast "Server Checkout" / "Shift Review" layouts;
 * no real photos yet). Golden 1 numbers are reused so the totals are familiar.
 */
import { lines, type ReceiptFixture } from './types';

export const TOAST_FIXTURES: ReceiptFixture[] = [
  {
    /*
     * Net Sales on its own line -> high. Food via the "Sales Category Summary" section -> medium.
     * Total Tips explicit -> label, high. Credit Card Tips / Cash Tips Declared match the longer
     * card/cash synonyms, not "tips". Gross Sales, Sales Tax, Tip %, Auto Gratuity % are ignored.
     */
    name: 'toast-server-checkout',
    pos: 'toast',
    input: lines(
      'Toast',
      'Server Checkout',
      'Joseph M.                Nov 17, 2026',
      '--------------------------------------',
      'SALES',
      'Gross Sales                  $1,712.40',
      'Discounts                      -$85.00',
      'Comps                          -$67.15',
      'Net Sales                    $1,560.25',
      'Sales Tax                      $128.72',
      'Total                        $1,688.97',
      '',
      'Sales Category Summary',
      'Food                           $700.12',
      'Liquor                         $512.80',
      'Beer                           $198.33',
      'Wine                           $149.00',
      '',
      'PAYMENTS',
      'Cash                           $212.50',
      'Credit/Debit                 $1,476.47',
      '',
      'TIPS',
      'Credit Card Tips               $305.56',
      'Cash Tips Declared              $35.00',
      'Total Tips                     $340.56',
      'Tip %                            21.8%',
      'Auto Gratuity %                    18%',
      'Service Charges                 $45.00',
      '',
      'Toast, Inc.  toasttab.com',
    ),
    expected: {
      fields: {
        totalTips: { cents: 34056, confidence: 'high', how: 'label' },
        netSales: { cents: 156025, confidence: 'high' },
        foodSales: { cents: 70012, confidence: 'medium' },
      },
      missing: [],
    },
  },
  {
    /*
     * No total-tips line: Credit Card Tips 120.00 + Cash Tips 30.50 -> card+cash 15050, high.
     * Explicit "Food Sales" -> high. "Tip Out (Bar)" is ignored. CRLF line endings.
     */
    name: 'toast-shift-review-card-plus-cash',
    pos: 'toast',
    input: [
      'Toast POS',
      'Shift Review',
      'Server: Aaron K.',
      'Net Sales                   $845.00',
      'Revenue Centers',
      'Dining Room                 $600.00',
      'Bar                         $245.00',
      'Food Sales                  $410.00',
      'Credit Card Tips            $120.00',
      'Cash Tips                    $30.50',
      'Tip Out (Bar)                $24.00',
      'Hours Worked                   6.50',
    ].join('\r\n'),
    expected: {
      fields: {
        totalTips: { cents: 15050, confidence: 'high', how: 'card+cash' },
        netSales: { cents: 84500, confidence: 'high' },
        foodSales: { cents: 41000, confidence: 'high' },
      },
      missing: [],
    },
  },
  {
    /*
     * Messy OCR: labels and values split onto separate lines, O for 0 and l for 1, lower-case brand.
     * Net Sales: value on the next line (medium) and OCR-fixed "$1,56O.25" (low) -> low.
     * Food: category rule (medium) with OCR-fixed "$7OO.l2" (low) -> low.
     * Total Tips: value on the next line -> medium, label.
     */
    name: 'toast-messy-split-lines',
    pos: 'toast',
    input: lines(
      'toast',
      'SERVER CHECK0UT',
      'Net Sales',
      '$1,56O.25',
      'Sales Category Summary',
      'Food $7OO.l2',
      'Liquor 512.80',
      'TIPS',
      'Credit Card Tips $305.56',
      'Cash Tips Declared $35.00',
      'Total Tips',
      '$340.56',
      'printed 11/17/2026 23:58',
    ),
    expected: {
      fields: {
        totalTips: { cents: 34056, confidence: 'medium', how: 'label' },
        netSales: { cents: 156025, confidence: 'low' },
        foodSales: { cents: 70012, confidence: 'low' },
      },
      missing: [],
    },
  },
];
