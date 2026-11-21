/**
 * Shape of a receipt fixture for the milestone 8 parser tests (docs/m8-contract.md).
 * Expected values follow the contract's parsing rules; the working is in each fixture's comment.
 */
import type { Confidence, FieldId, FoundField, OcrLine, PosId } from '../../ocr/types';

export interface ExpectedField {
  cents: number;
  confidence: Confidence;
  how?: FoundField['how'];
}

export interface ReceiptFixture {
  name: string;
  /** What detectPos should return. */
  pos: PosId;
  input: string | OcrLine[];
  expected: {
    fields: Partial<Record<FieldId, ExpectedField>>;
    /** Fields not found, in FieldId order (totalTips, netSales, foodSales). */
    missing: FieldId[];
  };
}

/** Join lines with LF (some fixtures use CRLF on purpose). */
export const lines = (...ls: string[]) => ls.join('\n');
