# TipJar — Claude Code Build Spec

> Source: `Tipjar build file.docx` (project context). This file tells Claude Code what to build, how, and in what order.
> When something here conflicts with the source doc, the source doc wins. Items marked **[DECISION]** are assumptions made to fill gaps; items under **Open questions** need the owner's answer before they're finalized.

---

## 1. Product summary

**TipJar** is a mobile app (iOS + Android) for **servers and bartenders**. At the end of a shift, the user enters (or scans) their sales and tips and who worked, and the app instantly shows how much each role and each coworker gets tipped out — in dollars and as a percentage of total tips / total sales. It also stores every shift so the user can see where their tips went and what they earned over the past week, month and year.

**Why it exists:** staff must calculate their own tip-outs (the business deliberately stays out of it for liability reasons). Doing that arithmetic every shift is tedious and error-prone. The app should make check-out feel faster and remove the math.

**Users:**
- **Server** — tips out bartenders, barbacks, hosts, and kitchen.
- **Bartender** — tips out barbacks, hosts, and kitchen (hosts usually get a smaller share from the bar, since they help the bar less). Bar tips are **pooled**: what the bar keeps after tip-out is split among the bartenders on shift (including the user), by hours.

---

## 2. Required features (from source doc)

| # | Requirement | Notes |
|---|---|---|
| F1 | Deployable on **Android and iOS** | Single cross-platform codebase. |
| F2 | **Scan receipts** (server checkout / service report) and pull the numbers into the calculation | OCR → editable form; user always confirms values before calculating. |
| F3 | **Adjust tip-out percentages and which roles** receive them | Editable "tip-out profiles"; ship with Server and Bartender defaults. |
| F4 | **Adjust by hours worked** — enter each member's clock-in/clock-out **or** total hours | Default: everyone in a role worked equal hours (even split). |
| F5 | **Toggle rounding to the nearest dollar**; rounding must **never** make total tip-out exceed earned tips | See §5.4. |
| F6 | **Breakdown/history** for past week, month, year: where tips went and what the user earned | Local history with charts. |

---

## 3. Tech stack  **[DECISION]**

- **React Native + Expo (SDK latest stable), TypeScript (strict)** — one codebase for iOS/Android, builds via **EAS Build**.
- **Navigation:** `expo-router`.
- **State:** `zustand` for UI/session state.
- **Persistence:** `expo-sqlite` (local, offline-first; no backend/account required for v1).
- **Receipt scanning:** `expo-camera` / `expo-image-picker` for capture + on-device OCR via ML Kit Text Recognition (e.g. `@react-native-ml-kit/text-recognition`) — requires an **Expo dev client** (not Expo Go).
- **Charts:** `victory-native` (or `react-native-gifted-charts`).
- **Dates/times:** `date-fns`.
- **Testing:** `jest` + `@testing-library/react-native`; calc engine must be 100% unit tested.
- **Lint/format:** ESLint + Prettier.

Rules:
- **All money is stored and computed as integer cents.** Never use floating-point dollars in the calc engine. Format only at the UI layer.
- The calculation engine is **pure TypeScript with no React/Expo imports** (`src/engine/`), so it is trivially testable.
- No network calls in v1. All data stays on device.

---

## 4. Domain model

```ts
type Cents = number; // integer

type RoleId = 'bartender' | 'barback' | 'host' | 'kitchen' | 'server' | string; // custom roles allowed

interface ShiftInput {
  date: string;              // ISO date
  userRole: 'server' | 'bartender';
  totalTips: Cents;
  netSales: Cents;
  foodSales: Cents;
  // optional extra sales buckets the user may enable later (e.g. liquorSales)
  team: TeamMember[];        // coworkers on shift. Bartender flow: includes the user and the other bartenders sharing the bar's kept tips
  missingRoleHandling: 'redistribute' | 'retain'; // what to do with a role's share when nobody in that role worked
  profileId: string;         // which TipOutProfile to apply
  roundToDollar: boolean;
}

interface TeamMember {
  id: string;
  name: string;
  role: RoleId;
  hours?: number;            // total hours, OR
  clockIn?: string;          // ISO datetime
  clockOut?: string;         // ISO datetime (handle shifts past midnight)
}

interface TipOutProfile {
  id: string;
  name: string;              // "Server default", "Bartender default", user-created...
  appliesTo: 'server' | 'bartender';
  totalTipOutPercentOfTips: number;   // e.g. 30 -> 30% of the pool basis is the tip-out pool (name kept for compatibility)
  poolBasis?: 'totalTips' | 'netSales' | 'foodSales'; // what the pool % is taken of; default 'totalTips' (owner Q4)
  rules: TipOutRule[];
}

// A rule either takes a fixed % of some basis (carved out of the pool first),
// or takes a weighted share of whatever remains of the pool.
type TipOutRule =
  | { role: RoleId; type: 'percentOfBasis'; basis: 'foodSales' | 'netSales' | 'totalTips'; percent: number }
  | { role: RoleId; type: 'shareOfRemainder'; weight: number };

interface ShiftResult {
  pool: Cents;                         // total tipped out (after any retained share is removed)
  poolPercentOfTips: number;
  poolPercentOfNetSales: number;
  kept: Cents;                         // totalTips - pool (what the user / the bar keeps)
  keptSplit?: { memberId: string; name: string; hours: number; amount: Cents }[]; // bartender flow: kept tips split among bartenders
  keptChange: Cents;                   // bartender flow: kept − sum(keptSplit) (cents left by the whole-dollar split; 0 when split to the cent; all of kept if no bartenders listed); server flow: 0
  retained: Cents;                     // share of absent roles kept back (missingRoleHandling = 'retain')
  roles: RoleResult[];
  roundingAdjustment: Cents;           // how much rounding kept back (>= 0)
}

interface RoleResult {
  role: RoleId;
  amount: Cents;
  percentOfTips: number;
  percentOfNetSales: number;
  members: { memberId: string; name: string; hours: number; amount: Cents; percentOfTips: number }[];
}
```

### Default profiles (seeded on first launch)  — derived from the two worked examples in the source doc

**Server default**
- Tip-out pool = **30% of total tips**
- Kitchen (KTO) = **2% of food sales**, taken out of the pool first
- Remainder of pool split by weight: **Bartenders 4 : Barbacks 3 : Hosts 1** (i.e. 50% / 37.5% / 12.5%)

**Bartender default**
- Tip-out pool = **30% of total tips**
- Kitchen (KTO) = **2% of food sales**, taken out of the pool first
- Remainder of pool split by weight: **Barbacks 3 : Hosts 1** (i.e. 75% / 25%)
- Whatever the bar keeps (total tips − tip-out) is split among the **bartenders on shift** by hours (equal by default).

---

## 5. Calculation engine (`src/engine/calculate.ts`)

### 5.1 Algorithm
1. `pool = poolBasis × totalTipOutPercentOfTips / 100`, where `poolBasis` is total tips by default, or net / food sales if the profile says so (owner Q4). If a sales-based pool comes out above total tips, cap it at total tips and warn (`POOL_EXCEEDS_TIPS`); the warning compares the exact (unrounded) value, and the capped value is the pool for every later step (carve-out capping, §5.4 flooring and `roundingAdjustment`).
2. For each `percentOfBasis` rule (e.g. KTO): `amount = basis × percent / 100`. Subtract from the pool.
   - If carve-outs exceed the pool, cap them to the pool and surface a warning to the user.
3. `remainder = pool − sum(carve-outs)`. Split across `shareOfRemainder` rules proportional to `weight`.
   - **Roles with nobody on shift** (e.g. no host): their share is still calculated, then handled per the user's choice (source doc, bartender example):
     - `redistribute` — the share goes to the other tip-out roles that are present (by weight; for a bartender with no host it goes to the barbacks).
     - `retain` — the share stays with the user / the bartenders and is added to the kept tips (`retained`).
     - Kitchen doesn't need named members and is never "missing".
   - Show this as a clear choice on the Results screen whenever a role is empty; default to **`retain`** (owner Q3 — matches the bartender example).
4. Within each role, split the role amount across members **by hours**:
   - Hours from `hours`, or `clockOut − clockIn` (support overnight shifts).
   - If no hours are given for anyone in the role → equal split (the default per F4).
   - If hours are given for some but not all → block calculation and ask the user to complete them.
5. Compute every percentage (of total tips and of net sales) for the pool, each role, and each member.
6. `kept = totalTips − pool` (plus any `retained` share).
7. **Bartender flow:** split `kept` among the bartenders on shift by hours (equal by default), using the same cent allocation. With rounding on, see §5.4 step 5.

### 5.2 Cent allocation
Use the **largest-remainder method** whenever an amount is split, so parts always sum exactly to the whole (no lost or invented pennies). Tie-break deterministically (by member order).

### 5.3 Validation
- All money inputs ≥ 0; food sales ≤ net sales (warn, don't block).
- Percentages 0–100; weights > 0.
- Clock-out must be after clock-in (or treated as next-day).
- Pool can never exceed total tips.

### 5.4 Rounding (F5)
When `roundToDollar` is on (this reproduces both examples in the source doc):
1. **Floor the pool** to the whole dollar (e.g. $102.17 → $102; $57.77 → $57). Rounding never rounds the total up, so tip-out can never exceed earned tips (or the unrounded pool).
2. Compute every carve-out (KTO) and role share **unrounded**, then allocate **whole dollars** across them with the largest-remainder method so they sum exactly to the floored pool. (Bartender example: KTO 2.40, barbacks 41.25, hosts 13.75 → $2 / $41 / $14 = $57.)
3. The cents trimmed off the pool stay with the user / the bar and are reported as `roundingAdjustment`.
4. Member amounts within a role are split from the rounded role amount **in whole dollars** (largest remainder, ties to the earlier member) — owner Q1. The engine option `roundMemberShares` now defaults to **true**; passing `false` restores cent-level member splits.
5. **Bartender flow:** the bar's kept tips are also shared in whole dollars: `keptSplit` splits `floorToDollar(kept)` by hours, and the leftover cents are reported as `keptChange` (stays with whoever closes out) — owner Q2. `kept` itself is unchanged (`kept + pool = totalTips`), and `sum(keptSplit) + keptChange = kept`. The Results screen headline shows the whole-dollar amount (e.g. "Bar keeps $149") with a note for the change. With rounding off (or `roundMemberShares: false`), `keptSplit` is to the cent and `keptChange = 0`. If no bartenders are listed, `keptSplit` is empty and `keptChange = kept` (the identity still holds; the Results screen prompts to add bartenders and shows the full `kept`). Server flow: `keptChange = 0`.
- Property-test: for any input, `sum(roles) ≤ pool ≤ totalTips`.

### 5.5 Golden test (must pass exactly) — from the source doc

Input (server, Server default profile, rounding **on**):
- Total tips **$340.56**, net sales **$1,560.25**, food sales **$700.12**
- Bartenders: Joseph, Aaron · Barbacks: David, Allen · Host: Hannah · equal hours

Expected output:

| Role | Amount | Members |
|---|---|---|
| **Total tip-out** | **≈ $102 (30% → $102.17 unrounded)** | |
| Kitchen (KTO) | $14.00 | — |
| Bartenders | $44.00 | Joseph $22.00 · Aaron $22.00 |
| Barbacks | $33.00 | David $17.00 · Allen $16.00 (doc shows $16.50 each; whole-dollar shares per owner Q1) |
| Hosts | $11.00 | Hannah $11.00 |

Working: pool = 30% × 340.56 = 102.17 → floor $102 → KTO 2% × 700.12 = 14.00 → remainder split 4:3:1 → whole dollars 14 / 44 / 33 / 11 = $102.
Rounding kept back $0.17. Server keeps $238.56 (`kept` 23856, `keptChange` 0).

### 5.6 Golden test 2 — bartender example from the source doc

Input (bartender, Bartender default profile, rounding **on**, `missingRoleHandling = 'retain'`):
- Total tips **$192.55**, net sales **$905.43**, food sales **$120.00**
- Bartenders (sharing the bar's kept tips): Joseph, Aaron · Barbacks: David, Allen · **No host** · equal hours

Expected:

| Line | Amount |
|---|---|
| **Total tip-out pool** | 30% × 192.55 = 57.77 → **$57** |
| Kitchen (KTO) | **$2** (2% × 120 = 2.40) |
| Barbacks | **$41** — David $21 / Allen $20 |
| Hosts | **$14** — nobody on shift → retained by the bartenders |
| Bartenders keep | **$149** shared (`kept` 14955, `keptChange` 55 = $0.55 change) |
| Joseph / Aaron | **$75 / $74** (doc shows $74.50 each; whole dollars per owner Q1/Q2, tie → earlier member) |

Also test the same input with `missingRoleHandling = 'redistribute'`: hosts' $14 goes to the barbacks ($55 total → David $28 / Allen $27); `kept` 13555 → bartenders share $135 (Joseph $68 / Aaron $67), `keptChange` 55.

With `roundMemberShares: false` the old cent-level values apply: barbacks $20.50 / $20.50, keptSplit $74.78 / $74.77, `keptChange` 0.

Add tests for: rounding off, unequal hours (for tip-out roles and for the bartenders sharing kept tips), clock-in/out across midnight, both missing-role options, zero food sales, custom profile.

---

## 6. Screens & UX

Design goal: **finish a checkout in under 30 seconds, one-handed, at the end of a shift.** Big tap targets, numeric keypads for money, dark mode supported, works fully offline.

1. **Onboarding (first launch only)** — pick your role (Server / Bartender), confirm/edit default percentages.
2. **New Shift (home)**
   - Fields: Total tips, Net sales, Food sales, Date (defaults to today).
   - **Scan receipt** button → camera → OCR → pre-filled fields highlighted for the user to confirm.
   - Profile selector + **Round to nearest dollar** toggle.
3. **Who worked** — add team members by role (bartender flow: also list the bartenders who share the bar's tips, including the user); quick-add from **saved coworkers** (remember names + usual role). Optional per-person hours or clock-in/out (collapsed by default; equal split if left blank).
4. **Results** — headline: *Total tip-out $X (Y% of tips)* and *You keep $Z* (bartender flow: *Bar keeps $Z* with each bartender's share). Then each role with $ and %, expandable to members. Rounding note when applied. If a role has nobody on shift, show its share with a toggle: **Give to other roles** / **Keep for bartenders (or me)**. Actions: **Save shift**, **Share/copy** (plain-text summary to paste in a group chat), Edit.
5. **History / Breakdown (F6)** — segmented control **Week / Month / Year**:
   - Total earned (kept) tips, total tipped out, average per shift, number of shifts.
   - Chart of earned tips over time; breakdown of tip-outs by role and by coworker.
   - Tap into any past shift to view/edit/delete.
6. **Settings** — manage tip-out profiles (add/edit roles, percentages, weights, basis), saved coworkers, default rounding, currency formatting, export data (CSV).

### Receipt scanning details (F2)
- Parse OCR text for labelled values: lines like `Net Sales`, `Food Sales`, `Total Tips`, `Credit Card Tips`, `Cash Tips` (combine card + cash if separate). Keep label synonyms in a config map so new POS formats can be added (Toast, Square, Aloha, etc.).
- Never auto-calculate from OCR without user confirmation; show a confidence hint for fields it couldn't find.
- Image is processed on device and **not stored** unless the user opts in.

---

## 7. Data storage

SQLite tables: `shifts`, `shift_members`, `shift_results` (snapshot of computed results at save time, so editing a profile later doesn't rewrite history), `profiles`, `profile_rules`, `coworkers`, `settings`. Use a simple migration runner keyed on a `schema_version` table.

---

## 8. Project structure

```
tipjar/
  app/                    # expo-router screens
    (tabs)/index.tsx      # New Shift
    (tabs)/history.tsx
    (tabs)/settings.tsx
    shift/team.tsx
    shift/results.tsx
    scan.tsx
    onboarding.tsx
  src/
    engine/               # pure TS calc engine + tests (no RN imports)
      calculate.ts
      money.ts            # cents helpers, largest-remainder split, formatting
      hours.ts
      __tests__/
    ocr/                  # receipt text parsing + label synonym map + tests
    db/                   # sqlite client, migrations, repositories
    store/                # zustand stores
    components/           # MoneyInput, RoleCard, MemberRow, Chart wrappers...
    theme/
  app.json / eas.json
```

---

## 9. Build order (milestones)

1. **Scaffold** — Expo + TypeScript + expo-router + ESLint/Prettier + Jest. `npm test` and `npx expo start` work.
2. **Engine** — `money.ts`, `hours.ts`, `calculate.ts` with the golden test (§5.5) and all edge-case tests passing. *Do not start UI until this is green.*
3. **Manual flow** — New Shift → Who worked → Results, using the default Server profile, in-memory only.
4. **Persistence** — SQLite, save shifts, saved coworkers, seeded profiles.
5. **Profiles & settings** — editable percentages/roles/weights (F3), rounding default (F5), bartender profile.
6. **Hours** — per-member hours and clock-in/out (F4).
7. **History** — week/month/year breakdown and charts (F6), CSV export.
8. **Receipt scanning** — dev client, camera, OCR, parser + tests with sample receipt text (F2).
9. **Polish & ship** — accessibility (labels, dynamic type, contrast), dark mode, app icons/splash, EAS builds for iOS and Android.

---

## 10. Definition of done

- All six required features (F1–F6) work on both an iOS simulator and an Android emulator.
- Golden example reproduces exactly; engine tests cover rounding, hours, and edge cases; `sum(tip-outs) ≤ total tips` holds everywhere.
- App works fully offline; no data leaves the device.
- `npm run lint`, `npm run typecheck`, and `npm test` all pass.

---

## 11. Open questions for the owner

Answered by the updated source doc (now built in): bartender defaults (30% of tips, KTO 2% of food sales, barbacks 3 : hosts 1), that KTO sits inside the tip-out total for both flows, and what happens when a role is missing (redistribute or retain, user's choice).

Answered by the owner (2026-11-18):
- Q1 **Rounding individual shares** → whole dollars when rounding is on (§5.4 step 4).
- Q2 **Leftover cents** → round the bar's kept share down to whole dollars too; the cents are reported as `keptChange` (§5.4 step 5).
- Q3 **Missing-role default** → keep it (`retain`) by default; user can switch to give it to other roles.
- Q4 **Percent basis** → support a pool that's a % of sales via `poolBasis` (§4, §5.1). Profile-editor UI for it lands with milestone 5.
- Q5 (review) **Equal clock-in and clock-out** → show an error (`INVALID_CLOCK`), not a 24-hour shift.

Still open:
5. **Receipt formats:** which POS systems' reports should scanning support first? Sample photos would help.
6. **Cloud backup / accounts:** needed for v1, or local-only is fine?
