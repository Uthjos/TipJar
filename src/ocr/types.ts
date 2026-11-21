/** Receipt OCR types (docs/m8-contract.md). Pure: no React / native imports. */
import type { Cents } from '@/engine/types';

export type PosId = 'toast' | 'square' | 'aloha' | 'generic';
export type FieldId = 'totalTips' | 'netSales' | 'foodSales';
export type Confidence = 'high' | 'medium' | 'low';

/** One recognised line. Positions are pixels in the image, when the OCR engine gives them. */
export interface OcrLine {
  text: string;
  top?: number;
  left?: number;
  height?: number;
}

export interface FoundField {
  cents: Cents;
  confidence: Confidence;
  /** The receipt line(s) it came from, trimmed, for the Confirm screen. */
  source: string;
  how: 'label' | 'card+cash' | 'card-only' | 'cash-only';
}

export interface ReceiptParse {
  pos: PosId;
  fields: Partial<Record<FieldId, FoundField>>;
  /** Fields not found, in FieldId order. */
  missing: FieldId[];
  /** Plain-English hints, e.g. "Found card and cash tips and added them." */
  notes: string[];
}

/** FieldId order: totalTips, netSales, foodSales. */
export const FIELD_IDS: readonly FieldId[] = ['totalTips', 'netSales', 'foodSales'];
