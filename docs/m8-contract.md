# Milestone 8 — Receipt scanning contract

Shared API between the Implementer (code) and the Tester (acceptance tests) for milestone 8
(CLAUDE.md §2 F2, §3, §6 "Receipt scanning details", §9 step 8, owner Q10). Both build against this
in parallel; the Maintainer reconciles.

## Scope

- **Scan receipt** on New Shift: take a photo (camera) or pick one (photo library) of a server
  checkout / shift report → on-device OCR → a **Confirm** screen with the values it found
  (Total tips, Net sales, Food sales), each editable, with a confidence hint and the receipt line it
  came from → **Use these numbers** fills New Shift. Never calculates without confirmation.
- POS formats first: **Toast, Square, Aloha** (owner Q10), plus a generic fallback. Label synonyms
  live in a config map so more POS formats can be added without code changes elsewhere.
- **Privacy:** OCR runs on the device; the photo is never uploaded or stored. Captured / copied
  temp files are deleted after OCR. (No "keep photo" option in v1.)
- **Development build:** OCR needs a native module, so the app moves from Expo Go to an **Expo dev
  client** (`expo-dev-client`), built locally with `npx expo run:android` (Android SDK + Android
  Studio's bundled JDK are installed). `android/` and `ios/` stay git-ignored (Continuous Native
  Generation — config lives in `app.json` / plugins). iOS can't be built on this Windows PC.
- The app must still **start in Expo Go**: the OCR module is loaded lazily, and if it isn't
  available the Scan button explains "Scanning needs the TipJar development build" instead of
  crashing.

Not in scope: storing receipt images, cloud OCR, iOS build (needs a Mac or EAS — milestone 9).

## Libraries

- Capture: `expo-image-picker` (camera + library, handles permissions; simplest). `expo-camera`
  only if a live viewfinder is needed — not required.
- OCR: on-device ML Kit text recognition. Preferred `@react-native-ml-kit/text-recognition`; the
  Implementer may choose another maintained on-device ML Kit wrapper **if** it builds with SDK 58 /
  the New Architecture — document the choice. No network OCR.
- Install Expo packages with `npx expo install`.

## Pure parser — `src/ocr/` (no React / native imports)

```ts
// src/ocr/types.ts
type PosId = 'toast' | 'square' | 'aloha' | 'generic';
type FieldId = 'totalTips' | 'netSales' | 'foodSales';
type Confidence = 'high' | 'medium' | 'low';

interface OcrLine {
  text: string;
  top?: number;
  left?: number;
  height?: number;
} // px, optional
interface FoundField {
  cents: Cents;
  confidence: Confidence;
  source: string; // the receipt line(s) it came from, trimmed, for the Confirm screen
  how: 'label' | 'card+cash' | 'card-only' | 'cash-only';
}
interface ReceiptParse {
  pos: PosId;
  fields: Partial<Record<FieldId, FoundField>>;
  missing: FieldId[]; // fields not found, in FieldId order
  notes: string[]; // plain-English hints, e.g. "Found card and cash tips and added them."
}
```

```ts
// src/ocr/labels.ts — the config map (data only)
export const LABELS: Record<
  PosId,
  {
    detect: string[]; // keywords that identify the POS (case-insensitive)
    totalTips: string[];
    cardTips: string[];
    cashTips: string[];
    netSales: string[];
    foodSales: string[];
    ignore: string[]; // labels that look similar but must NOT match
  }
>;
```

Generic synonyms at minimum (each POS adds its own on top of generic):

- totalTips: `total tips`, `tips total`, `tip total`, `total gratuity`, `tips`, `gratuity`
- cardTips: `credit card tips`, `cc tips`, `card tips`, `charged tips`, `non-cash tips`,
  `tips (credit)`, `credit tips`
- cashTips: `cash tips`, `declared tips`, `cash gratuity`, `declared cash tips`
- netSales: `net sales`, `net sales total`, `total net sales`, `sales (net)`
- foodSales: `food sales`, `food`, `food & beverage`? **no** — `food` only when it's a sales
  category line (see parsing rules); `food total`, `kitchen sales`
- ignore: `gross sales`, `tip %`, `tip percentage`, `tips owed`, `tip out`, `tipout`,
  `tip share`, `auto gratuity %`, `sales tax`, `food tax`, `net sales tax`, `refund`, `void`

```ts
// src/ocr/money.ts
parseMoneyToken(token: string): Cents | null
```

- Accepts `$1,234.56`, `1234.56`, `1,234.56`, `$0.50`, `.50`, `12`, `(12.34)` and `-12.34`
  (negative → returned as negative cents; callers reject negatives for these fields), `12.3` → 1230.
- OCR fixes inside a token that otherwise looks numeric: `O`/`o` → 0, `l`/`I`/`|` → 1, `S` → 5,
  `B` → 8, a space between digits, and `,` used as decimal when it's the last separator followed by
  exactly two digits (`12,34` → 1234). Thousands separators must be groups of 3.
- Anything else → null. Never returns NaN or a float.

```ts
// src/ocr/parseReceipt.ts
detectPos(lines: OcrLine[]): PosId
parseReceipt(input: string | OcrLine[], opts?: { pos?: PosId }): ReceiptParse
```

Rules:

1. A string input is split on line breaks; blank lines dropped; text normalised (collapse
   whitespace, NFC, strip `:`/`.` leaders like `Net Sales.......$1,560.25`).
2. **Label match:** case-insensitive, whole words, against the POS's synonyms plus generic; the
   longest matching synonym wins; any line matching an `ignore` label is skipped for that field.
3. **Amount:** the **rightmost** money token on the same line after the label. If the label line has
   no amount, use the first money token on the **next** line (two-column layouts where OCR splits
   label and value) — or, when `top`/`left` are given, the money token on the line whose vertical
   centre is within half a line-height and lies to the right.
4. **Multiple matches** for a field: prefer an exact synonym over a looser one (e.g. `net sales` over
   `sales (net)`), then the **last** occurrence (reports usually end with totals). Report
   `medium` confidence if two candidates disagree.
5. **Tips:** an explicit total-tips line → `how: 'label'`. Otherwise card + cash if both found
   (`'card+cash'`, high). Otherwise card only (`'card-only'`, medium) or cash only (`'cash-only'`,
   low) with a note asking the user to check.
6. **Food sales:** a `food sales` / `food total` label, or a line that is just `Food` + amount
   inside a sales-by-category section (a preceding line containing `categor` / `sales by` /
   `revenue center`) → medium if found via the category rule, high via an explicit label.
7. **Confidence:** high = exact synonym, amount on the same line; medium = next-line / positional
   amount, looser synonym, disagreeing duplicates, or category rule; low = cash-only tips or an
   OCR-fixed token. Amounts that parse negative are dropped (field missing + note).
8. Sanity notes (don't drop the value): food sales > net sales; tips > net sales.
9. Never throws for any string input.

## UI

- New Shift: **Scan receipt** button (replaces "coming soon") → `app/scan.tsx` with **Take photo** /
  **Choose photo**. Permission denied → explain and link to settings.
- Confirm screen: each field with value (MoneyInput), a confidence pill (Found / Check this / Not
  found), and the source line in small text; notes listed; **Use these numbers** / **Cancel**.
  Fields filled from a scan are highlighted on New Shift until edited.
- In Expo Go (no OCR module): the button shows the dev-build message and the app keeps working.
