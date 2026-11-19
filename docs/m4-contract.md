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
