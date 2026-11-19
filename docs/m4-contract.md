# Milestone 4 — Persistence contract

Shared API between the Implementer (code) and the Tester (acceptance tests) for milestone 4
(CLAUDE.md §7, §9 step 4). Both build against this in parallel; the Maintainer reconciles.

## Scope

- SQLite storage via `expo-sqlite` (works in Expo Go), local only, no network.
- Saved shifts (input + result snapshot), saved coworkers, seeded default profiles, settings.
- Store hydrates from the DB on app start; **Save shift** persists; **Who worked** offers quick-add
  from saved coworkers; **History** lists saved shifts from the DB and can delete one.
- Not in scope: profile editing UI (M5), hours UI (M6), charts / CSV (M7).

## `Db` interface — `src/db/types.ts`

A subset of expo-sqlite's `SQLiteDatabase` async API, so the real database satisfies it directly
and tests can use an in-memory adapter.

```ts
export type SqlParam = string | number | null;

export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: SqlParam[]): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: SqlParam[]): Promise<T | null>;
  withTransactionAsync(fn: () => Promise<void>): Promise<void>;
}
```

Test adapter (Implementer owns, devDependency `sql.js`): `src/db/testing/sqljsDb.ts` exporting
`createTestDb(): Promise<Db>` — a fresh, empty in-memory database each call, foreign keys ON.

## Schema & migrations — `src/db/migrations.ts`

- `export const SCHEMA_VERSION: number` (1 for this milestone).
- `migrate(db: Db): Promise<number>` — creates/upgrades tables, returns the resulting version.
  Idempotent (calling twice is a no-op), records version in a `schema_version` table.
- Tables (CLAUDE.md §7): `shifts`, `shift_members`, `shift_results`, `profiles`, `profile_rules`,
  `coworkers`, `settings`, `schema_version`. Money columns are INTEGER cents.
  `shift_members` / `shift_results` / `profile_rules` rows are deleted with their parent
  (`ON DELETE CASCADE`).

## Seeding — `src/db/seed.ts`

- `seedDefaults(db: Db): Promise<void>` — inserts `SERVER_DEFAULT_PROFILE` and
  `BARTENDER_DEFAULT_PROFILE` only if the `profiles` table is empty. Idempotent; never overwrites
  a profile the user edited.
- `initDb(db: Db): Promise<void>` = `migrate` + `seedDefaults`.

## Repositories — `src/db/repositories.ts`

```ts
export interface SavedShift {
  id: string;
  savedAt: string;          // ISO datetime
  input: ShiftInput;
  result: ShiftResult;      // snapshot at save time
}

// profiles
listProfiles(db): Promise<TipOutProfile[]>            // rules in their original order; default profiles first, then by name
getProfile(db, id): Promise<TipOutProfile | null>
saveProfile(db, profile): Promise<void>               // upsert; replaces the profile's rules
deleteProfile(db, id): Promise<void>

// shifts
saveShift(db, s: { input: ShiftInput; result: ShiftResult; id?: string; savedAt?: string }): Promise<string>  // returns id (generated if absent)
getShift(db, id): Promise<SavedShift | null>
listShifts(db, range?: { from?: string; to?: string }): Promise<SavedShift[]>  // by input.date, inclusive yyyy-MM-dd bounds; newest date first, then newest savedAt
updateShift(db, id, s: { input: ShiftInput; result: ShiftResult }): Promise<void>
deleteShift(db, id): Promise<void>                    // also removes its members and result

// coworkers
interface Coworker { id: string; name: string; usualRole: RoleId; lastWorked?: string }
listCoworkers(db): Promise<Coworker[]>                // most recently worked first, then name
upsertCoworker(db, c: { id?: string; name: string; usualRole: RoleId; lastWorked?: string }): Promise<string>
deleteCoworker(db, id): Promise<void>
rememberTeam(db, team: TeamMember[], date: string): Promise<void>
  // after saving a shift: upsert each named member by case-insensitive trimmed name, set usualRole to
  // the role they just worked and lastWorked = date. Skips isUser members and blank names.

// settings (JSON-encoded values)
getSetting<T>(db, key: string, fallback: T): Promise<T>
setSetting<T>(db, key: string, value: T): Promise<void>
```

Rules:

- **Snapshot:** `getShift` returns exactly the `input` and `result` that were saved (deep-equal),
  including optional fields (`keptSplit`, `heldBack`, `keptHeldBack`, `isUser`, hours/clock
  times). Editing or deleting a profile later never changes a saved shift.
- Integer cents round-trip exactly; no floats stored for money.
- Unknown ids: `get*` returns `null`; `update*` / `delete*` are no-ops (don't throw).
- Settings keys used by the app: `defaultRoundToDollar` (boolean, default true),
  `defaultProfileId` (string, default `'server-default'`).

## Decisions (main-branch review, round 4)

Recorded by the Maintainer when merging `feat/m4-persistence` and `test/m4-persistence`. The
numbers refer to docs/test-findings.md. Details are in docs/review-log.md.

### Pinned schema (#40)

Version 1 columns. Money columns are `INTEGER` cents and are tested by name.

| Table            | Columns                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema_version` | `version`                                                                                                                                                          |
| `profiles`       | `id`, `name`, `applies_to`, `pool_percent` (REAL), `pool_basis` (nullable), `is_default`, `position`                                                               |
| `profile_rules`  | `profile_id` → profiles, `position`, `role`, `type`, `basis`, `percent` (REAL), `weight` (REAL)                                                                    |
| `shifts`         | `id`, `saved_at`, `date`, `user_role`, `profile_id`, **`total_tips`**, **`net_sales`**, **`food_sales`**, `missing_role_handling`, `round_to_dollar`, `input_json` |
| `shift_members`  | `shift_id` → shifts, `position`, `member_id`, `name`, `role`, `is_user`, `hours` (REAL), `clock_in`, `clock_out`                                                   |
| `shift_results`  | `shift_id` → shifts, **`pool`**, **`kept`**, **`kept_change`**, **`retained`**, **`rounding_adjustment`**, `result_json`                                           |
| `coworkers`      | `id`, `name`, `name_key`, `usual_role`, `last_worked` (nullable)                                                                                                   |
| `settings`       | `key`, `value` (JSON text)                                                                                                                                         |

How the columns are used:

- `input_json` and `result_json` are the snapshot. The scalar columns and the `shift_members` rows are copies kept for querying (History and CSV in M7).
- Child rows are deleted with their parent (`ON DELETE CASCADE`).

### Ordering

- **`listProfiles` (#53):** the Server default comes first, then the Bartender default (built-in order), then the other profiles by name, case-insensitive. Putting the user's own role's default first is a UI/store concern.
- **`listShifts` (#41):**
  - Order: `date` DESC, then `saved_at` DESC, then newest insert (`rowid` DESC), then `id` DESC.
  - `savedAt` is stored as `Date#toISOString()`, so text order is time order. A caller-supplied value is normalised; an unparseable value is stored as given.
- **`listCoworkers` (#42):** order by `lastWorked` DESC, then name, case-insensitive. Coworkers who have never worked sort **last**.

### Shifts

- **`updateShift` (#43):** keeps the original `id` and `savedAt`. If an edit time is ever needed, add a separate `updatedAt`.

### Coworkers

- **Matching key (#49):** `coworkerKey(name) = name.trim().normalize('NFC').toLocaleLowerCase()`, computed in JS and stored in `name_key`. SQLite's `lower()`/`NOCASE` only fold ASCII.
- **Spelling (#47):**
  - A name match keeps the existing spelling.
  - New names are stored trimmed.
  - `upsertCoworker` with an explicit `id` renames the coworker.
- **`rememberTeam` and `lastWorked` (#48):**
  - `lastWorked` becomes the later of the stored value and `date`.
  - `usualRole` only changes when `date` is on or after the stored `lastWorked`. Saving or editing an older shift never demotes or re-roles anyone.
- **Placeholders (#46):** the store passes the draft team as typed, so unnamed members have blank names and are skipped. Placeholder names such as "Barback 2" are never remembered.

### Snapshots and settings

- **Optional fields (#51):** optional fields come back **absent**, never `null`. This covers `poolBasis`, `lastWorked`, and every optional field of a saved `input` or `result`.
- **Settings (#52):**
  - `setSetting(key, undefined)` deletes the key, so later reads return the fallback.
  - A stored value that fails `JSON.parse` returns the fallback.

### Deferred to M5 (profile editor and coworker management)

- **#44:** deleting every profile re-seeds both defaults on the next start. The M5 editor should block deleting the last profile.
- **#45, #50:** coworkers are matched by name only, across roles and within one team. M5 can add matching by (name, role) or a "different people" option.
- **#54:** saved shifts can reference a deleted profile. History's Edit flow should fall back to the current default for the shift's `userRole` and tell the user.
