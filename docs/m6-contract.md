# Milestone 6 — Hours contract

Shared API between the Implementer (code) and the Tester (acceptance tests) for milestone 6
(CLAUDE.md §5.1 step 4, §6 item 3, §9 step 6, feature F4). Both build against this in parallel;
the Maintainer reconciles. Builds on milestones 3–5.

## Where we start

Who worked already has a collapsed "+ Hours (optional)" panel per member with **Total hours** or
**Clock in/out** (24h `HH:mm` text). The engine (`src/engine/hours.ts`) already handles hours,
`HH:mm` and ISO clock values, overnight shifts, `PARTIAL_HOURS` and `INVALID_CLOCK`. Today a bad
or incomplete entry is only caught when Results calls the engine.

## Goals

1. **Forgiving input.** People type times the way they say them: `5pm`, `5:30 PM`, `1730`, `9a`.
   Normalise to `HH:mm` on blur; store only `HH:mm` (never ISO) so DST / time zones can't matter
   (review #6c).
2. **Catch problems on Who worked**, per member and per role, before Results — with plain-English
   messages — and keep "See tip-out" disabled while there are errors.
3. **Faster entry:** "Same for everyone in this role" copies one member's hours / times to the rest
   of the role. Live "= 6.5 h" (and "overnight") next to clock entries.
4. **Show hours** where money is split: Results member rows and the bar's split (bartender flow),
   and the share text, whenever hours were entered.
5. The engine stays unchanged in behaviour; new logic lives in `src/lib/hoursInput.ts` (pure).

Not in scope: remembering a coworker's usual hours, time pickers / native clock widgets, History
(M7).

## Pure helpers — `src/lib/hoursInput.ts` (no React / DB imports)

```ts
parseTimeInput(text: string): string | null
```

Returns a normalised 24h `"HH:mm"` (zero-padded) or `null` if it isn't a time. Accepts, case- and
space-insensitive:

- `H`, `HH` → whole hour, 24h (`9` → `09:00`, `17` → `17:00`, `0` → `00:00`; `24` → null).
- `H:mm`, `HH:mm`, and `H.mm` / `HH.mm` (`5.30` → `05:30`).
- `Hmm` / `HHmm` with 3–4 digits (`930` → `09:30`, `1730` → `17:30`).
- Any of the above followed by `a`, `am`, `a.m.`, `p`, `pm`, `p.m.` → 12h clock
  (`12am` → `00:00`, `12pm` → `12:00`, `12:30a` → `00:30`, `5pm` → `17:00`). With a suffix the hour
  must be 1–12, otherwise null (`13pm` → null).
- Words `noon` → `12:00`, `midnight` → `00:00`.
- Minutes must be 00–59; hours 0–23 (24h). Empty / whitespace → null.

```ts
parseHoursInput(text: string): number | null
```

Total hours as a number, or null. Accepts `6`, `6.5`, `6,5` (comma decimal), `6:30` (h:mm → 6.5),
`6h`, `6h30`, `6h 30m`, `6 hrs`, `45m` / `45 min` (→ 0.75), `.5`. Result rounded to 2 decimals.
Must be > 0 and ≤ 24; anything else (incl. 0, negative, > 24) → null.

```ts
clockHours(clockIn: string, clockOut: string): { hours: number; overnight: boolean } | null
```

For two `HH:mm` values: minutes between them, +24h when `clockOut` < `clockIn` (`overnight: true`),
hours rounded to 2 decimals. Equal times → null (matches engine `INVALID_CLOCK`). Invalid → null.

```ts
formatHours(h: number): string
```

`6` → `"6 h"`, `6.5` → `"6.5 h"`, `6.25` → `"6.25 h"`, `0.75` → `"0.75 h"`, never trailing zeros,
max 2 decimals.

```ts
type HoursIssue = {
  code:
    | 'INVALID_TIME'      // a clock field that parseTimeInput can't read
    | 'MISSING_CLOCK_OUT' | 'MISSING_CLOCK_IN'
    | 'SAME_TIME'         // clock in == clock out
    | 'INVALID_HOURS'     // total hours text that parseHoursInput can't read
    | 'PARTIAL_HOURS'     // role has hours for some members but not all
    | 'LONG_SHIFT';       // computed hours > 16 (warning only)
  severity: 'error' | 'warning';
  memberId?: string;      // set for member-level issues; PARTIAL_HOURS lists each member missing hours
  role: RoleId;
  message: string;        // e.g. "Allen needs a clock-out time." / "Enter hours for Hannah too, or clear them all for an even split."
};

checkTeamHours(
  team: Array<TeamMember & { hoursText?: string; clockInText?: string; clockOutText?: string }>,
  rolesThatSplit: RoleId[],
): HoursIssue[]
```

- Works on what the user **typed** (the `*Text` fields, when present) so problems show before
  values are committed; falls back to `hours` / `clockIn` / `clockOut`.
- `rolesThatSplit` = the profile's roles that have named members, plus `bartender` in the
  bartender flow (the store already knows this list).
- One issue per member problem; `PARTIAL_HOURS` is one issue **per member missing hours** in a role
  where at least one other member has valid hours. Members with an error of their own count as
  "has hours entered" (so they get their own error, not PARTIAL_HOURS too).
- Members in roles not in `rolesThatSplit` are ignored.
- Ordering: by `rolesThatSplit` order, then member order in `team`; within a member, errors first.
- Anything `checkTeamHours` reports as error-free must not make `calculateShift` throw
  `PARTIAL_HOURS` or `INVALID_CLOCK` once the parsed values are committed to the team.

```ts
copyHoursToRole(team: TeamMember[], fromMemberId: string): TeamMember[]
```

Returns a new team where every other member **with the same role** gets the source member's
`hours`, `clockIn`, `clockOut` (exactly one source of hours: the other fields cleared). Members in
other roles untouched; inputs never mutated; unknown id → unchanged copy.

## UI behaviour

- Clock fields: free text with the normalised value applied on blur (`5pm` → shows `17:00`); a
  field the parser rejects keeps the typed text and shows `INVALID_TIME`. Hint text:
  "e.g. 5pm, 17:00, 1730".
- Under a valid clock pair: `= 6.5 h` and, if overnight, `· ends next day`.
- Per-member issues show under that member; `PARTIAL_HOURS` shows under each member missing
  hours. A banner above "See tip-out" summarises the error count; the button is disabled while
  errors exist. Warnings (`LONG_SHIFT`) show but don't block.
- "Same for everyone in this role" link appears on a member whose hours are valid when the role
  has 2+ members.
- Results member rows already show hours; also show them on the bar's split rows (bartender flow).
  Share text adds `(6.5 h)` after a name when that member has hours.
- Saved shifts keep whatever hours / `HH:mm` times were committed (snapshot, already JSON).
