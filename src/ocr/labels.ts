/**
 * Receipt label synonyms per POS (docs/m8-contract.md). Data only: add a POS or a synonym here
 * without touching the parser. Matching is case-insensitive and by whole words; each POS's lists
 * are used on top of `generic`, and the longest matching synonym on a line wins.
 */
import type { PosId } from './types';

export interface PosLabels {
  /** Keywords that identify the POS (case-insensitive). */
  detect: string[];
  totalTips: string[];
  cardTips: string[];
  cashTips: string[];
  netSales: string[];
  /** Explicit food-sales labels. A bare "Food" line is handled by the sales-by-category rule. */
  foodSales: string[];
  /** Labels that look similar but must NOT match (the whole line is skipped). */
  ignore: string[];
}

export const LABELS: Record<PosId, PosLabels> = {
  generic: {
    detect: [],
    totalTips: ['total tips', 'tips total', 'tip total', 'total gratuity', 'tips', 'gratuity'],
    cardTips: [
      'credit card tips',
      'cc tips',
      'card tips',
      'charged tips',
      'non-cash tips',
      'tips (credit)',
      'credit tips',
    ],
    cashTips: ['cash tips', 'declared tips', 'cash gratuity', 'declared cash tips'],
    netSales: ['net sales', 'net sales total', 'total net sales', 'sales (net)'],
    foodSales: ['food sales', 'food total', 'kitchen sales'],
    ignore: [
      'gross sales',
      'tip %',
      'tip percentage',
      'tips owed',
      'tip out',
      'tipout',
      'tip share',
      'auto gratuity %',
      'sales tax',
      'food tax',
      'net sales tax',
      'refund',
      'void',
    ],
  },
  toast: {
    detect: ['toast', 'toasttab', 'toast pos', 'toast, inc'],
    totalTips: ['total tips', 'tips collected'],
    cardTips: ['non-cash tips', 'tips (non-cash)', 'credit/non-cash tips'],
    cashTips: ['cash tips declared', 'declared cash tips'],
    netSales: ['net sales'],
    foodSales: ['food sales'],
    ignore: ['tips owed', 'tip-out', 'gratuity owed'],
  },
  square: {
    detect: ['square', 'squareup', 'square pos', 'square, inc'],
    totalTips: ['total tips', 'tips'],
    cardTips: ['card tips', 'card tip'],
    cashTips: ['cash tips', 'cash tip'],
    netSales: ['net sales'],
    foodSales: ['food sales'],
    ignore: ['gross sales', 'discounts & comps', 'tips refunded'],
  },
  aloha: {
    detect: ['aloha', 'ncr aloha', 'ncr voyix', 'ncr'],
    totalTips: ['total tips', 'tips total'],
    cardTips: ['charge tips', 'charged tips', 'total charge tips', 'credit card tips'],
    cashTips: ['declared tips', 'tips declared', 'cash tips declared'],
    netSales: ['net sales', 'net sales total'],
    foodSales: ['food sales', 'food total'],
    ignore: ['tip share', 'tipshare', 'tip share owed', 'gross sales'],
  },
};

/**
 * "Exact" synonyms (contract rule 4/7): high confidence when the amount is on the same line, and
 * preferred over looser ones when a field matches more than once. POS-specific synonyms count as
 * exact too.
 */
export const EXACT: Record<
  'totalTips' | 'cardTips' | 'cashTips' | 'netSales' | 'foodSales',
  string[]
> = {
  totalTips: ['total tips', 'tips total', 'tip total'],
  cardTips: ['credit card tips', 'cc tips', 'card tips', 'credit tips', 'tips (credit)'],
  cashTips: ['cash tips', 'declared cash tips'],
  netSales: ['net sales', 'net sales total', 'total net sales'],
  foodSales: ['food sales', 'food total'],
};
