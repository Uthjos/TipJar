/** All receipt fixtures for the milestone 8 parser tests. */
import { ALOHA_FIXTURES } from './aloha';
import { GENERIC_FIXTURES } from './generic';
import { SQUARE_FIXTURES } from './square';
import { TOAST_FIXTURES } from './toast';
import type { ReceiptFixture } from './types';

export type { ExpectedField, ReceiptFixture } from './types';
export { ALOHA_FIXTURES, GENERIC_FIXTURES, SQUARE_FIXTURES, TOAST_FIXTURES };

export const ALL_RECEIPT_FIXTURES: ReceiptFixture[] = [
  ...TOAST_FIXTURES,
  ...SQUARE_FIXTURES,
  ...ALOHA_FIXTURES,
  ...GENERIC_FIXTURES,
];
