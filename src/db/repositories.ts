/**
 * Repositories over the `Db` interface (docs/m4-contract.md). No React / Expo imports, so they
 * run against expo-sqlite in the app and sql.js in tests.
 */
import { DEFAULT_PROFILES } from '@/engine/profiles';
import type {
  Basis,
  RoleId,
  ShiftInput,
  ShiftResult,
  TeamMember,
  TipOutProfile,
  TipOutRule,
  UserRole,
} from '@/engine/types';

import type { Db, SqlParam } from './types';

export interface SavedShift {
  id: string;
  /** ISO datetime. */
  savedAt: string;
  input: ShiftInput;
  /** Snapshot at save time. */
  result: ShiftResult;
}

export interface Coworker {
  id: string;
  name: string;
  usualRole: RoleId;
  lastWorked?: string;
}

let idCounter = 0;
/** Unique-enough local id (no network, single device). */
export function generateId(prefix: string): string {
  idCounter += 1;
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `${prefix}-${Date.now().toString(36)}-${rand}${idCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------

const DEFAULT_IDS = DEFAULT_PROFILES.map((p) => p.id);

interface ProfileRow {
  id: string;
  name: string;
  applies_to: string;
  pool_percent: number;
  pool_basis: string | null;
}

interface RuleRow {
  profile_id: string;
  position: number;
  role: string;
  type: string;
  basis: string | null;
  percent: number | null;
  weight: number | null;
  /** Schema v2; null for built-in roles. */
  label?: string | null;
}

function toRule(r: RuleRow): TipOutRule {
  const rule: TipOutRule =
    r.type === 'percentOfBasis'
      ? {
          role: r.role,
          type: 'percentOfBasis',
          basis: (r.basis ?? 'totalTips') as Basis,
          percent: r.percent ?? 0,
        }
      : { role: r.role, type: 'shareOfRemainder', weight: r.weight ?? 0 };
  // A missing label round-trips as absent, not null (m5 contract).
  if (r.label) rule.label = r.label;
  return rule;
}

function toProfile(row: ProfileRow, rules: RuleRow[]): TipOutProfile {
  const profile: TipOutProfile = {
    id: row.id,
    name: row.name,
    appliesTo: row.applies_to as UserRole,
    totalTipOutPercentOfTips: row.pool_percent,
    rules: rules.sort((a, b) => a.position - b.position).map(toRule),
  };
  if (row.pool_basis) profile.poolBasis = row.pool_basis as Basis;
  return profile;
}

/** All profiles: default profiles first (in their built-in order), then by name. */
export async function listProfiles(db: Db): Promise<TipOutProfile[]> {
  const rows = await db.getAllAsync<ProfileRow>(
    'SELECT * FROM profiles ORDER BY is_default DESC, position ASC, name COLLATE NOCASE ASC, id ASC',
  );
  const rules = await db.getAllAsync<RuleRow>(
    'SELECT * FROM profile_rules ORDER BY profile_id, position',
  );
  return rows.map((row) =>
    toProfile(
      row,
      rules.filter((r) => r.profile_id === row.id),
    ),
  );
}

export async function getProfile(db: Db, id: string): Promise<TipOutProfile | null> {
  const row = await db.getFirstAsync<ProfileRow>('SELECT * FROM profiles WHERE id = ?', [id]);
  if (!row) return null;
  const rules = await db.getAllAsync<RuleRow>(
    'SELECT * FROM profile_rules WHERE profile_id = ? ORDER BY position',
    [id],
  );
  return toProfile(row, rules);
}

/** Upsert a profile and replace its rules (kept in the given order). */
export async function saveProfile(db: Db, profile: TipOutProfile): Promise<void> {
  const defaultIndex = DEFAULT_IDS.indexOf(profile.id);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO profiles (id, name, applies_to, pool_percent, pool_basis, is_default, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         applies_to = excluded.applies_to,
         pool_percent = excluded.pool_percent,
         pool_basis = excluded.pool_basis,
         is_default = excluded.is_default,
         position = excluded.position`,
      [
        profile.id,
        profile.name,
        profile.appliesTo,
        profile.totalTipOutPercentOfTips,
        profile.poolBasis ?? null,
        defaultIndex >= 0 ? 1 : 0,
        defaultIndex >= 0 ? defaultIndex : 0,
      ],
    );
    await db.runAsync('DELETE FROM profile_rules WHERE profile_id = ?', [profile.id]);
    for (const [i, rule] of profile.rules.entries()) {
      await db.runAsync(
        `INSERT INTO profile_rules
           (profile_id, position, role, type, basis, percent, weight, label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          profile.id,
          i,
          rule.role,
          rule.type,
          rule.type === 'percentOfBasis' ? rule.basis : null,
          rule.type === 'percentOfBasis' ? rule.percent : null,
          rule.type === 'shareOfRemainder' ? rule.weight : null,
          rule.label?.trim() ? rule.label : null,
        ],
      );
    }
  });
}

export async function deleteProfile(db: Db, id: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM profile_rules WHERE profile_id = ?', [id]);
    await db.runAsync('DELETE FROM profiles WHERE id = ?', [id]);
  });
}

// ---------------------------------------------------------------------------
// shifts
// ---------------------------------------------------------------------------

interface ShiftRow {
  id: string;
  saved_at: string;
  input_json: string;
  result_json: string | null;
}

function toSavedShift(row: ShiftRow): SavedShift | null {
  if (!row.result_json) return null;
  return {
    id: row.id,
    savedAt: row.saved_at,
    input: JSON.parse(row.input_json) as ShiftInput,
    result: JSON.parse(row.result_json) as ShiftResult,
  };
}

const SHIFT_SELECT = `SELECT s.id, s.saved_at, s.input_json, r.result_json
  FROM shifts s LEFT JOIN shift_results r ON r.shift_id = s.id`;

/** Write the shift row's dependent data (members + result snapshot). Caller holds a transaction. */
async function writeShiftChildren(
  db: Db,
  id: string,
  input: ShiftInput,
  result: ShiftResult,
): Promise<void> {
  await db.runAsync('DELETE FROM shift_members WHERE shift_id = ?', [id]);
  await db.runAsync('DELETE FROM shift_results WHERE shift_id = ?', [id]);
  for (const [i, m] of input.team.entries()) {
    await db.runAsync(
      `INSERT INTO shift_members
         (shift_id, position, member_id, name, role, is_user, hours, clock_in, clock_out)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        i,
        m.id,
        m.name,
        m.role,
        m.isUser ? 1 : 0,
        m.hours ?? null,
        m.clockIn ?? null,
        m.clockOut ?? null,
      ],
    );
  }
  await db.runAsync(
    `INSERT INTO shift_results
       (shift_id, pool, kept, kept_change, retained, rounding_adjustment, result_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      result.pool,
      result.kept,
      result.keptChange,
      result.retained,
      result.roundingAdjustment,
      JSON.stringify(result),
    ],
  );
}

function shiftColumns(input: ShiftInput): SqlParam[] {
  return [
    input.date,
    input.userRole,
    input.profileId,
    input.totalTips,
    input.netSales,
    input.foodSales,
    input.missingRoleHandling,
    input.roundToDollar ? 1 : 0,
    JSON.stringify(input),
  ];
}

/**
 * savedAt is stored as `Date#toISOString()` (UTC, milliseconds, `Z`) so text ordering is time
 * ordering (review round 4, #41). An unparseable value is stored as given.
 */
function normaliseSavedAt(savedAt: string | undefined): string {
  if (savedAt === undefined) return new Date().toISOString();
  const ms = Date.parse(savedAt);
  return Number.isNaN(ms) ? savedAt : new Date(ms).toISOString();
}

/** Save a shift snapshot. Returns its id (generated when absent). */
export async function saveShift(
  db: Db,
  s: { input: ShiftInput; result: ShiftResult; id?: string; savedAt?: string },
): Promise<string> {
  const id = s.id ?? generateId('shift');
  const savedAt = normaliseSavedAt(s.savedAt);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO shifts (id, saved_at, date, user_role, profile_id, total_tips, net_sales,
         food_sales, missing_role_handling, round_to_dollar, input_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         saved_at = excluded.saved_at, date = excluded.date, user_role = excluded.user_role,
         profile_id = excluded.profile_id, total_tips = excluded.total_tips,
         net_sales = excluded.net_sales, food_sales = excluded.food_sales,
         missing_role_handling = excluded.missing_role_handling,
         round_to_dollar = excluded.round_to_dollar, input_json = excluded.input_json`,
      [id, savedAt, ...shiftColumns(s.input)],
    );
    await writeShiftChildren(db, id, s.input, s.result);
  });
  return id;
}

export async function getShift(db: Db, id: string): Promise<SavedShift | null> {
  const row = await db.getFirstAsync<ShiftRow>(`${SHIFT_SELECT} WHERE s.id = ?`, [id]);
  return row ? toSavedShift(row) : null;
}

/**
 * Shifts by `input.date` (inclusive yyyy-MM-dd bounds), newest date first, then newest savedAt,
 * then newest insert (rowid), then id (review round 4, #41).
 */
export async function listShifts(
  db: Db,
  range: { from?: string; to?: string } = {},
): Promise<SavedShift[]> {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (range.from) {
    where.push('s.date >= ?');
    params.push(range.from);
  }
  if (range.to) {
    where.push('s.date <= ?');
    params.push(range.to);
  }
  const rows = await db.getAllAsync<ShiftRow>(
    `${SHIFT_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
     ORDER BY s.date DESC, s.saved_at DESC, s.rowid DESC, s.id DESC`,
    params,
  );
  return rows.map(toSavedShift).filter((s): s is SavedShift => s !== null);
}

/** Replace a saved shift's input and result (keeps its id and savedAt). No-op for unknown ids. */
export async function updateShift(
  db: Db,
  id: string,
  s: { input: ShiftInput; result: ShiftResult },
): Promise<void> {
  const exists = await db.getFirstAsync<{ id: string }>('SELECT id FROM shifts WHERE id = ?', [id]);
  if (!exists) return;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE shifts SET date = ?, user_role = ?, profile_id = ?, total_tips = ?, net_sales = ?,
         food_sales = ?, missing_role_handling = ?, round_to_dollar = ?, input_json = ?
       WHERE id = ?`,
      [...shiftColumns(s.input), id],
    );
    await writeShiftChildren(db, id, s.input, s.result);
  });
}

/** Delete a shift with its members and result. No-op for unknown ids. */
export async function deleteShift(db: Db, id: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    // Explicit child deletes as well as ON DELETE CASCADE, in case foreign keys are off.
    await db.runAsync('DELETE FROM shift_members WHERE shift_id = ?', [id]);
    await db.runAsync('DELETE FROM shift_results WHERE shift_id = ?', [id]);
    await db.runAsync('DELETE FROM shifts WHERE id = ?', [id]);
  });
}

// ---------------------------------------------------------------------------
// coworkers
// ---------------------------------------------------------------------------

interface CoworkerRow {
  id: string;
  name: string;
  usual_role: string;
  last_worked: string | null;
}

function toCoworker(r: CoworkerRow): Coworker {
  const c: Coworker = { id: r.id, name: r.name, usualRole: r.usual_role };
  if (r.last_worked) c.lastWorked = r.last_worked;
  return c;
}

/**
 * Case-insensitive, trimmed, Unicode-normalised name used to match coworkers. Done in JS because
 * SQLite's lower()/NOCASE only fold ASCII ("Zoë" vs "ZOË") — review round 4, #49.
 */
export function coworkerKey(name: string): string {
  return name.trim().normalize('NFC').toLocaleLowerCase();
}

/** Most recently worked first (never-worked last), then by name. */
export async function listCoworkers(db: Db): Promise<Coworker[]> {
  const rows = await db.getAllAsync<CoworkerRow>(
    `SELECT * FROM coworkers
     ORDER BY (last_worked IS NULL) ASC, last_worked DESC, name COLLATE NOCASE ASC, id ASC`,
  );
  return rows.map(toCoworker);
}

/**
 * Insert or update a coworker. With an id: updates that row (inserting it if missing), including
 * its name. Without: matches an existing coworker by `coworkerKey(name)` and keeps the existing
 * spelling, else inserts the trimmed name. A missing `lastWorked` keeps the stored one. Returns
 * the coworker's id.
 */
export async function upsertCoworker(
  db: Db,
  c: { id?: string; name: string; usualRole: RoleId; lastWorked?: string },
): Promise<string> {
  const name = c.name.trim();
  const key = coworkerKey(name);
  let existing: { id: string } | null = null;
  if (c.id) {
    existing = await db.getFirstAsync<{ id: string }>('SELECT id FROM coworkers WHERE id = ?', [
      c.id,
    ]);
  } else {
    existing = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM coworkers WHERE name_key = ? ORDER BY id LIMIT 1',
      [key],
    );
  }
  if (existing) {
    if (c.id) {
      // Explicit id (e.g. renaming in coworker management): the new spelling is stored.
      await db.runAsync(
        `UPDATE coworkers SET name = ?, name_key = ?, usual_role = ?,
           last_worked = COALESCE(?, last_worked)
         WHERE id = ?`,
        [name, key, c.usualRole, c.lastWorked ?? null, existing.id],
      );
    } else {
      // Matched by name: keep the existing spelling (review round 4, #47).
      await db.runAsync(
        `UPDATE coworkers SET usual_role = ?, last_worked = COALESCE(?, last_worked)
         WHERE id = ?`,
        [c.usualRole, c.lastWorked ?? null, existing.id],
      );
    }
    return existing.id;
  }
  const id = c.id ?? generateId('cw');
  await db.runAsync(
    'INSERT INTO coworkers (id, name, name_key, usual_role, last_worked) VALUES (?, ?, ?, ?, ?)',
    [id, name, key, c.usualRole, c.lastWorked ?? null],
  );
  return id;
}

export async function deleteCoworker(db: Db, id: string): Promise<void> {
  await db.runAsync('DELETE FROM coworkers WHERE id = ?', [id]);
}

/**
 * After saving a shift: upsert each named member by `coworkerKey(name)`. Skips isUser members and
 * blank names. lastWorked never moves backwards (review round 4, #48): it becomes the later of the
 * stored value and `date`, and usualRole only changes to the role just worked when `date` is on or
 * after the stored lastWorked. So saving or editing an older shift doesn't demote anyone in
 * quick-add or flip their usual role.
 */
export async function rememberTeam(db: Db, team: TeamMember[], date: string): Promise<void> {
  // #50: if the same name appears twice in one team, only the first occurrence is remembered.
  const seen = new Set<string>();
  for (const m of team) {
    if (m.isUser || !m.name || m.name.trim() === '') continue;
    const key = coworkerKey(m.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = await db.getFirstAsync<{ id: string; last_worked: string | null }>(
      'SELECT id, last_worked FROM coworkers WHERE name_key = ? ORDER BY id LIMIT 1',
      [coworkerKey(m.name)],
    );
    if (existing && existing.last_worked && date < existing.last_worked) continue;
    await upsertCoworker(db, { name: m.name, usualRole: m.role, lastWorked: date });
  }
}

// ---------------------------------------------------------------------------
// settings (JSON-encoded values)
// ---------------------------------------------------------------------------

export async function getSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key],
  );
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Store a JSON-encoded setting. `undefined` has no JSON form, so it deletes the key and later
 * reads return the fallback (review round 4, #52). A stored value that fails to parse also reads
 * as the fallback (see getSetting).
 */
export async function setSetting<T>(db: Db, key: string, value: T): Promise<void> {
  if (value === undefined) {
    await db.runAsync('DELETE FROM settings WHERE key = ?', [key]);
    return;
  }
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)],
  );
}

/** Settings keys used by the app, with their defaults. */
export const SETTINGS = {
  defaultRoundToDollar: { key: 'defaultRoundToDollar', fallback: true },
  defaultProfileId: { key: 'defaultProfileId', fallback: 'server-default' },
} as const;
