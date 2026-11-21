/**
 * Turn OCR text from a server checkout / shift report into Total tips, Net sales and Food sales
 * (docs/m8-contract.md). Pure; never throws for any string input. The user always confirms.
 */
import { EXACT, LABELS } from './labels';
import { parseMoneyTokenDetailed } from './money';
import {
  type Confidence,
  FIELD_IDS,
  type FieldId,
  type FoundField,
  type OcrLine,
  type PosId,
  type ReceiptParse,
} from './types';

type LabelField = 'totalTips' | 'cardTips' | 'cashTips' | 'netSales' | 'foodSales';
const LABEL_FIELDS: readonly LabelField[] = [
  'totalTips',
  'cardTips',
  'cashTips',
  'netSales',
  'foodSales',
];

interface Line extends OcrLine {
  text: string;
  index: number;
}

interface Candidate {
  cents: number;
  confidence: Confidence;
  source: string;
  exact: boolean;
  index: number;
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const minConf = (...c: Confidence[]): Confidence =>
  c.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b));

function normalise(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\.{2,}|…+|_{2,}/g, ' ') // dot / underscore leaders
    .replace(/\s*:\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toLines(input: string | OcrLine[]): Line[] {
  const raw: OcrLine[] =
    typeof input === 'string'
      ? input.split(/\r\n|\r|\n/).map((text) => ({ text }))
      : Array.isArray(input)
        ? input.filter((l): l is OcrLine => !!l && typeof l.text === 'string')
        : [];
  const out: Line[] = [];
  for (const l of raw) {
    const text = normalise(l.text);
    if (text) out.push({ ...l, text, index: out.length });
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
}

/** Whole-word, case-insensitive match; returns the end index of the last match, or -1. */
function matchEnd(text: string, label: string): number {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(label)}(?![\\p{L}\\p{N}])`, 'giu');
  let end = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) end = m.index + m[0].length;
  return end;
}

/** Money tokens in `text` (after `from`), left to right. Joins "1 234.56"-style splits. */
function moneyTokens(text: string, from = 0): { cents: number; fixed: boolean }[] {
  const words = text
    .slice(from)
    .split(' ')
    .filter((w) => !/%$/.test(w)) // percentages are never amounts
    .map((w) => w.replace(/^[^\d$(\-.OolI|SB]+|[^\d)]+$/g, ''))
    .filter(Boolean);
  const out: { cents: number; fixed: boolean }[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const next = words[i + 1];
    if (next && /^\$?\d{1,3}$/.test(w) && /^\d{3}([.,]\d{2})?\)?$/.test(next)) {
      const joined = parseMoneyTokenDetailed(`${w} ${next}`);
      if (joined) {
        out.push(joined);
        i++;
        continue;
      }
    }
    const t = parseMoneyTokenDetailed(w);
    if (t) out.push(t);
  }
  return out;
}

export function detectPos(lines: OcrLine[]): PosId {
  const text = lines.map((l) => (typeof l?.text === 'string' ? l.text : '')).join('\n');
  let best: PosId = 'generic';
  let bestCount = 0;
  for (const pos of ['toast', 'square', 'aloha'] as const) {
    let count = 0;
    for (const kw of LABELS[pos].detect) if (matchEnd(text, kw) >= 0) count++;
    if (count > bestCount) {
      best = pos;
      bestCount = count;
    }
  }
  return best;
}

function synonyms(pos: PosId, field: LabelField): string[] {
  const all = [...LABELS[pos][field], ...LABELS.generic[field]].map((s) => s.toLowerCase());
  return [...new Set(all)];
}

function isExact(pos: PosId, field: LabelField, synonym: string): boolean {
  return (
    EXACT[field].includes(synonym) ||
    (pos !== 'generic' && LABELS[pos][field].map((s) => s.toLowerCase()).includes(synonym))
  );
}

/** The amount for a label on `line`: same line, else positional neighbour, else next line. */
function amountFor(
  lines: Line[],
  line: Line,
  labelEnd: number,
  isLabelLine: (l: Line) => boolean,
): { cents: number; fixed: boolean; sameLine: boolean; source: string } | null {
  const same = moneyTokens(line.text, labelEnd);
  if (same.length > 0) return { ...same[same.length - 1]!, sameLine: true, source: line.text };

  if (line.top !== undefined && line.height !== undefined) {
    const centre = line.top + line.height / 2;
    const right = lines.filter(
      (l) =>
        l !== line &&
        l.top !== undefined &&
        Math.abs(l.top + (l.height ?? line.height!) / 2 - centre) <= line.height! / 2 &&
        (line.left === undefined || l.left === undefined || l.left > line.left),
    );
    right.sort((a, b) => (a.left ?? 0) - (b.left ?? 0));
    for (const l of right) {
      const t = moneyTokens(l.text);
      if (t.length > 0) return { ...t[0]!, sameLine: false, source: `${line.text} ${l.text}` };
    }
  }

  const next = lines[line.index + 1];
  if (next && !isLabelLine(next)) {
    const t = moneyTokens(next.text);
    if (t.length > 0) return { ...t[0]!, sameLine: false, source: `${line.text} / ${next.text}` };
  }
  return null;
}

const FIELD_WORDS: Record<LabelField, string> = {
  totalTips: 'total tips',
  cardTips: 'card tips',
  cashTips: 'cash tips',
  netSales: 'net sales',
  foodSales: 'food sales',
};

export function parseReceipt(input: string | OcrLine[], opts: { pos?: PosId } = {}): ReceiptParse {
  const notes: string[] = [];
  let lines: Line[] = [];
  try {
    lines = toLines(input);
  } catch {
    lines = [];
  }
  const pos = opts.pos ?? detectPos(lines);
  const ignore = [...new Set([...LABELS[pos].ignore, ...LABELS.generic.ignore])].map((s) =>
    s.toLowerCase(),
  );
  const syn = Object.fromEntries(LABEL_FIELDS.map((f) => [f, synonyms(pos, f)])) as Record<
    LabelField,
    string[]
  >;

  /** Best (longest) label on a line across all fields, unless the line is an ignore line. */
  const labelOf = (l: Line): { field: LabelField; synonym: string; end: number } | null => {
    const lower = l.text.toLowerCase();
    if (ignore.some((ig) => matchEnd(lower, ig) >= 0)) return null;
    let best: { field: LabelField; synonym: string; end: number } | null = null;
    for (const field of LABEL_FIELDS) {
      for (const s of syn[field]) {
        const end = matchEnd(lower, s);
        if (end >= 0 && (!best || s.length > best.synonym.length)) {
          best = { field, synonym: s, end };
        }
      }
    }
    return best;
  };
  // The next line only supplies an amount when it is just an amount (two-column OCR splits).
  const isLabelLine = (l: Line) => labelOf(l) !== null || !/^[\s$()\-.,\dOolI|SB]+$/.test(l.text);

  const candidates: Record<LabelField, Candidate[]> = {
    totalTips: [],
    cardTips: [],
    cashTips: [],
    netSales: [],
    foodSales: [],
  };
  const negatives = new Set<LabelField>();

  let inCategorySection = false;
  for (const line of lines) {
    if (/categor|sales by|revenue center/i.test(line.text)) inCategorySection = true;
    const label = labelOf(line);
    if (label) {
      const amount = amountFor(lines, line, label.end, isLabelLine);
      if (!amount) continue;
      if (amount.cents < 0) {
        negatives.add(label.field);
        continue;
      }
      const exact = isExact(pos, label.field, label.synonym);
      let confidence: Confidence = exact && amount.sameLine ? 'high' : 'medium';
      if (amount.fixed) confidence = 'low';
      candidates[label.field].push({
        cents: amount.cents,
        confidence,
        source: amount.source,
        exact,
        index: line.index,
      });
      continue;
    }
    // Food sales by the sales-by-category rule: a line that is just "Food" + amount.
    const food = /^food\b(.*)$/i.exec(line.text);
    if (food && inCategorySection) {
      const tokens = moneyTokens(line.text, 4);
      const rest = food[1]!.replace(/[\s$()\-.,\dOolI|SB%]/g, '');
      if (tokens.length > 0 && rest === '') {
        const t = tokens[tokens.length - 1]!;
        if (t.cents < 0) {
          negatives.add('foodSales');
          continue;
        }
        candidates.foodSales.push({
          cents: t.cents,
          confidence: t.fixed ? 'low' : 'medium',
          source: line.text,
          exact: false,
          index: line.index,
        });
      }
    }
  }

  /** Prefer exact over loose, then the last occurrence; medium if candidates disagree. */
  const pick = (field: LabelField): Candidate | null => {
    const list = candidates[field];
    if (list.length === 0) return null;
    const pool = list.some((c) => c.exact) ? list.filter((c) => c.exact) : list;
    const chosen = { ...pool[pool.length - 1]! };
    if (new Set(list.map((c) => c.cents)).size > 1) {
      chosen.confidence = minConf(chosen.confidence, 'medium');
      notes.push(`Found more than one ${FIELD_WORDS[field]} amount — check it.`);
    }
    return chosen;
  };

  const fields: Partial<Record<FieldId, FoundField>> = {};

  const total = pick('totalTips');
  if (total) {
    fields.totalTips = {
      cents: total.cents,
      confidence: total.confidence,
      source: total.source,
      how: 'label',
    };
  } else {
    const card = pick('cardTips');
    const cash = pick('cashTips');
    if (card && cash) {
      fields.totalTips = {
        cents: card.cents + cash.cents,
        confidence: minConf('high', card.confidence, cash.confidence),
        source: `${card.source} + ${cash.source}`,
        how: 'card+cash',
      };
      notes.push('Found card and cash tips and added them.');
    } else if (card) {
      fields.totalTips = {
        cents: card.cents,
        confidence: minConf('medium', card.confidence),
        source: card.source,
        how: 'card-only',
      };
      notes.push('Only card tips were found — add any cash tips.');
    } else if (cash) {
      fields.totalTips = {
        cents: cash.cents,
        confidence: 'low',
        source: cash.source,
        how: 'cash-only',
      };
      notes.push('Only cash tips were found — check the total tips.');
    }
  }
  for (const field of ['netSales', 'foodSales'] as const) {
    const c = pick(field);
    if (c)
      fields[field] = { cents: c.cents, confidence: c.confidence, source: c.source, how: 'label' };
  }

  for (const f of negatives) {
    const target: FieldId = f === 'cardTips' || f === 'cashTips' ? 'totalTips' : f;
    if (!fields[target]) {
      notes.push(
        `The ${FIELD_WORDS[f]} amount came out negative, so it was left out — enter it yourself.`,
      );
    }
  }

  const net = fields.netSales?.cents;
  if (net !== undefined && fields.foodSales && fields.foodSales.cents > net) {
    notes.push('Food sales are higher than net sales — check them.');
  }
  if (net !== undefined && fields.totalTips && fields.totalTips.cents > net) {
    notes.push('Tips are higher than net sales — check them.');
  }

  return {
    pos,
    fields,
    missing: FIELD_IDS.filter((f) => !fields[f]),
    notes: [...new Set(notes)],
  };
}
