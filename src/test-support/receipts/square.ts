/**
 * Square-style OCR text (written from typical Square "Sales Summary" / shift report layouts).
 */
import { lines, type ReceiptFixture } from './types';

export const SQUARE_FIXTURES: ReceiptFixture[] = [
  {
    /*
     * Sales Summary: "Tips" is a total-tips synonym (label, high). Gross Sales ignored.
     * Food via "Category Sales" -> medium. "Total" alone is not a tips label.
     */
    name: 'square-sales-summary',
    pos: 'square',
    input: lines(
      'Square',
      'Sales Summary',
      'Nov 17, 2026 4:00 PM - Nov 18, 2026 2:00 AM',
      'Team member: Joseph M.',
      '',
      'Gross Sales            $1,712.40',
      'Returns                    $0.00',
      'Discounts & Comps       -$152.15',
      'Net Sales              $1,560.25',
      'Taxes                    $128.72',
      'Tips                     $340.56',
      'Gift Card Sales            $0.00',
      'Total                  $2,029.53',
      '',
      'Category Sales',
      'Food                     $700.12',
      'Drinks                   $860.13',
      '',
      'Powered by Square',
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
     * Shift report with Card Tips + Cash Tips -> card+cash 15050 high. "Sales by Category" then
     * "Food" -> medium. Clock times are not money.
     */
    name: 'square-shift-report-card-cash',
    pos: 'square',
    input: lines(
      'Square',
      'Shift Report - Aaron K.',
      'Clock in 5:02 PM   Clock out 1:47 AM',
      'Net Sales              $845.00',
      'Card Tips              $120.00',
      'Cash Tips               $30.50',
      'Sales by Category',
      'Food                   $410.00',
      'Beverage               $435.00',
    ),
    expected: {
      fields: {
        totalTips: { cents: 15050, confidence: 'high', how: 'card+cash' },
        netSales: { cents: 84500, confidence: 'high' },
        foodSales: { cents: 41000, confidence: 'medium' },
      },
      missing: [],
    },
  },
  {
    /*
     * Two-column layout with coordinates: OCR returned the label column, then the value column.
     * Values are matched by position (same vertical centre within half a line-height, to the
     * right) -> medium for every field. Gross Sales is ignored even though it has a value.
     */
    name: 'square-two-column-positional',
    pos: 'square',
    input: [
      { text: 'Square', top: 10, left: 20, height: 20 },
      { text: 'Sales Summary', top: 40, left: 20, height: 20 },
      { text: 'Gross Sales', top: 100, left: 20, height: 20 },
      { text: 'Net Sales', top: 130, left: 20, height: 20 },
      { text: 'Tips', top: 160, left: 20, height: 20 },
      { text: 'Category Sales', top: 220, left: 20, height: 20 },
      { text: 'Food', top: 250, left: 20, height: 20 },
      { text: 'Drinks', top: 280, left: 20, height: 20 },
      { text: '$1,712.40', top: 101, left: 400, height: 20 },
      { text: '$1,560.25', top: 131, left: 400, height: 20 },
      { text: '$340.56', top: 162, left: 400, height: 20 },
      { text: '$700.12', top: 249, left: 400, height: 20 },
      { text: '$860.13', top: 279, left: 400, height: 20 },
    ],
    expected: {
      fields: {
        totalTips: { cents: 34056, confidence: 'medium', how: 'label' },
        netSales: { cents: 156025, confidence: 'medium' },
        foodSales: { cents: 70012, confidence: 'medium' },
      },
      missing: [],
    },
  },
];
