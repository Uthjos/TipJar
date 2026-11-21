# Milestone 7 — History contract

Shared API between the Implementer (code) and the Tester (acceptance tests) for milestone 7
(CLAUDE.md §6 item 5, §6 item 6 "export data (CSV)", §9 step 7, feature F6). Both build against this
in parallel; the Maintainer reconciles. Builds on milestones 4–6 (saved shifts are snapshots).

## Scope

- **History tab** with a segmented control **Week / Month / Year**, ‹ › to step to the previous /
  next period (next disabled past the current one), and for the selected period:
  - Totals: **You earned**, **Tipped out**, **Shifts**, **Average per shift** (earned).
  - **Chart** of what you earned over the period (bars: days for week and month, months for year).
  - **Where your tip-outs went:** by role and by coworker (amount, number of shifts).
  - The period's shifts, newest first; tap one to open it.
- **Shift detail** screen: the saved snapshot shown read-only like Results (headline, roles with
  members and hours, notes), with **Edit**, **Share/Copy**, **Delete**.
- **Edit a saved shift:** loads the saved input into the New Shift → Who worked → Results flow;
  saving **updates that shift** (same id, keeps `savedAt`) instead of creating a new one. Review
  #54: if the shift's profile was deleted, use the current default profile for its `userRole` and
  show a note: "The profile this shift used was deleted, so it was recalculated with <name>."
- **CSV export** (Settings → Export data): two files — shifts and payouts — shared through the
  system share sheet. No network; nothing leaves the device unless the user shares it.
- **Week start** setting: settings key `weekStartsOn`, `0` (Sunday, default) or `1` (Monday).
- Charts: `react-native-gifted-charts` + `react-native-svg` (both work in Expo Go). Export:
  `expo-file-system` + `expo-sharing`.

Not in scope: receipt scanning (M8), cloud backup (owner Q6, still open).

## Pure helpers — `src/lib/history.ts` (no React / DB imports)

All dates are `yyyy-MM-dd` strings (the shift's `input.date`); no time zones are involved.

```ts
type Period = 'week' | 'month' | 'year';
type WeekStart = 0 | 1;
interface PeriodRange { period: Period; from: string; to: string; label: string } // inclusive

periodRange(period: Period, anchor: string, weekStartsOn?: WeekStart): PeriodRange
  // week: the 7 days containing anchor, starting on weekStartsOn (default 0 = Sunday)
  // month: 1st..last day of anchor's month; year: Jan 1..Dec 31
  // label: week "Nov 15 – 21, 2026" / "Nov 29 – Dec 5, 2026" / "Dec 27, 2026 – Jan 2, 2027";
  //        month "November 2026"; year "2026"
shiftPeriod(range: PeriodRange, step: -1 | 1, weekStartsOn?: WeekStart): PeriodRange
  // previous / next period of the same kind
inRange(date: string, range: PeriodRange): boolean
```

```ts
interface HistorySummary {
  shiftCount: number;
  earned: Cents;               // sum of userEarnings(input, result)
  tippedOut: Cents;            // sum of result.pool
  totalTips: Cents;            // sum of input.totalTips
  averageEarned: Cents;        // earned / shiftCount, rounded half-up; 0 when no shifts
  series: { key: string; label: string; earned: Cents }[];
    // week: 7 entries (key yyyy-MM-dd, label "Sun".."Sat" in week order)
    // month: one per day (key yyyy-MM-dd, label "1".."31")
    // year: 12 entries (key yyyy-MM, label "Jan".."Dec")
    // every bucket present even when 0; sum(series.earned) === earned
  byRole: { role: RoleId; label: string; amount: Cents; shifts: number }[];
    // paid tip-out per role (RoleResult.amount of non-missing roles), amount desc then label;
    // roles with 0 total omitted; `shifts` = shifts where that role was paid > 0
  byCoworker: { key: string; name: string; roles: RoleId[]; amount: Cents; shifts: number }[];
    // from result.roles[].members (NOT keptSplit — the bar's own split isn't a tip-out);
    // members with isUser skipped; key = normalised name (trim, NFC, locale lower-case), name =
    // most recent spelling; roles in first-seen order; amount desc then name; 0-amount omitted
}

summarize(
  shifts: SavedShift[],
  range: PeriodRange,
  opts?: { weekStartsOn?: WeekStart; roleLabel?: (role: RoleId) => string },
): HistorySummary
  // only shifts with inRange(input.date); ignores the rest
  // roleLabel resolves custom labels from current profiles; default = roleLabel() from profiles.ts
```

## CSV — `src/lib/csv.ts`

```ts
csvEscape(value: string | number | null | undefined): string
  // RFC 4180: wrap in quotes if it contains , " CR or LF (or leading/trailing space);
  // double any "; null/undefined -> ''
centsToCsv(c: Cents): string                     // 12345 -> "123.45", -5 -> "-0.05", 0 -> "0.00"

shiftsCsv(shifts: SavedShift[], opts?: { profileName?: (id: string) => string | undefined }): string
payoutsCsv(shifts: SavedShift[], opts?: { roleLabel?: (role: RoleId) => string }): string
```

- Lines end with `\r\n`; the file ends with `\r\n`; header row first; shifts in date order
  (oldest first, then `savedAt`).
- **shiftsCsv** columns, in order:
  `date, profile, user_role, total_tips, net_sales, food_sales, tipped_out, kept, you_earned,
  retained, rounding_adjustment, kept_change, rounded_to_dollar, shift_id`
  — money via `centsToCsv`; `profile` = profile name or the id if unknown;
  `rounded_to_dollar` = `yes` / `no`.
- **payoutsCsv**: one row per paid member and one per role with no members (e.g. kitchen) or a
  missing role's retained amount — columns
  `date, role, name, hours, amount, kind, shift_id`, where `kind` is `paid` (member), `role`
  (memberless role such as kitchen), `retained` (missing role kept) or `bar_split` (a bartender's
  share of the bar's kept tips, bartender flow, including the user). `hours` blank when 0 / not
  entered, else up to 2 decimals.
- Sum check: for each shift, the `paid` + `role` rows equal `tipped_out`.

## Store / repository

- `updateShift` (M4) is used for edits; `savedAt` unchanged; History reloads after save / delete.
- Settings: `weekStartsOn` persisted like the other settings.
- No schema change.
