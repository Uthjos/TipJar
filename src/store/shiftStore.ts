import { format } from 'date-fns';
import { create } from 'zustand';

import * as repo from '@/db/repositories';
import type { Coworker, SavedShift } from '@/db/repositories';
import type { Db } from '@/db/types';
import { DEFAULT_PROFILES } from '@/engine/profiles';
import { copyHoursToRole as copyHours, type TypedMember } from '@/lib/hoursInput';
import { checkProfile, hasErrors, type ProfileIssue } from '@/lib/profileValidation';
import { builtInProfile, isBuiltInProfile, newProfile, roleNames } from '@/lib/profiles';
import type {
  Cents,
  MissingRoleHandling,
  RoleId,
  ShiftInput,
  ShiftResult,
  TeamMember,
  TipOutProfile,
  UserRole,
} from '@/engine/types';

export type { Coworker, SavedShift };

/** The in-progress shift being entered (kept in memory until saved). */
export interface DraftShift {
  date: string;
  profileId: string;
  roundToDollar: boolean;
  totalTips?: Cents;
  netSales?: Cents;
  foodSales?: Cents;
  team: TeamMember[];
  missingRoleHandling: MissingRoleHandling;
  /**
   * What the user typed in each member's hours fields, by member id (M6). Members only ever hold
   * committed values (`hours` number, `clockIn` / `clockOut` "HH:mm"); this keeps the raw text so
   * checkTeamHours can flag problems before they're committed. Not saved with the shift.
   */
  typed: Record<string, TypedHours>;
  /** M7: set while editing a saved shift; saving then updates that shift instead of adding one. */
  editingShiftId?: string;
  /** M7 (#54): shown on Results when the saved shift's profile was deleted. */
  editingNote?: string;
  /** M8: money fields filled from a scanned receipt and not edited since (highlighted). */
  scanned?: ('totalTips' | 'netSales' | 'foodSales')[];
}

/** Raw hours input for one member, plus which entry mode their panel shows. */
export interface TypedHours {
  mode?: 'hours' | 'clock';
  hoursText?: string;
  clockInText?: string;
  clockOutText?: string;
}

/** The draft team merged with typed text, as `checkTeamHours` expects. */
export function typedTeam(draft: DraftShift): TypedMember[] {
  return draft.team.map((m) => {
    const t = draft.typed[m.id];
    const out: TypedMember = { ...m };
    if (t?.hoursText !== undefined) out.hoursText = t.hoursText;
    if (t?.clockInText !== undefined) out.clockInText = t.clockInText;
    if (t?.clockOutText !== undefined) out.clockOutText = t.clockOutText;
    return out;
  });
}

let idCounter = 0;
export function newId(prefix = 'm'): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function freshDraft(profileId = 'server-default', roundToDollar = true): DraftShift {
  return {
    date: todayIso(),
    profileId,
    roundToDollar,
    team: [],
    missingRoleHandling: 'retain',
    typed: {},
  };
}

export type LoadStatus = 'loading' | 'ready' | 'error';

/** App settings mirrored from the `settings` table. */
export interface AppSettings {
  defaultRoundToDollar: boolean;
  defaultProfileId: string;
  /** "Whole-dollar shares for each person" (#21); passed to the engine as roundMemberShares. */
  wholeDollarShares: boolean;
  onboarded: boolean;
  /** History weeks start on Sunday (0, default) or Monday (1). */
  weekStartsOn: 0 | 1;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultRoundToDollar: true,
  defaultProfileId: 'server-default',
  wholeDollarShares: true,
  onboarded: false,
  weekStartsOn: 0,
};

/** A store action the user asked for that can't be done; `message` is shown to them. */
export class StoreActionError extends Error {
  readonly code:
    | 'PROFILE_INVALID'
    | 'LAST_PROFILE_FOR_ROLE'
    | 'NOT_BUILT_IN'
    | 'COWORKER_NAME_REQUIRED'
    | 'COWORKER_NAME_TAKEN'
    | 'COWORKER_NOT_FOUND';
  readonly issues: ProfileIssue[];

  constructor(code: StoreActionError['code'], message: string, issues: ProfileIssue[] = []) {
    super(message);
    this.name = 'StoreActionError';
    this.code = code;
    this.issues = issues;
    Object.setPrototypeOf(this, StoreActionError.prototype);
  }
}

interface ShiftState {
  /** Hydration state; screens show a loading view until 'ready'. */
  status: LoadStatus;
  loadError?: string;
  /** The on-device database once hydrated; null before then (and in UI tests). */
  db: Db | null;
  draft: DraftShift;
  profiles: TipOutProfile[];
  /** Saved shifts, newest first (mirrors the DB). */
  savedShifts: SavedShift[];
  /** Saved coworkers for quick-add, most recently worked first (mirrors the DB). */
  coworkers: Coworker[];
  settings: AppSettings;

  /** Load profiles, settings defaults, coworkers and saved shifts from the DB. */
  hydrate: (db: Db) => Promise<void>;
  setLoadError: (message: string) => void;
  setMoney: (field: 'totalTips' | 'netSales' | 'foodSales', value: Cents | undefined) => void;
  /** M8: fill New Shift from a confirmed receipt scan; those fields are highlighted until edited. */
  applyScan: (values: Partial<Record<'totalTips' | 'netSales' | 'foodSales', Cents>>) => void;
  setDate: (date: string) => void;
  setRoundToDollar: (on: boolean) => void;
  setProfile: (profileId: string) => void;
  setMissingRoleHandling: (h: MissingRoleHandling) => void;
  addMember: (role: RoleId, name?: string) => string;
  updateMember: (id: string, patch: Partial<Omit<TeamMember, 'id'>>) => void;
  removeMember: (id: string) => void;
  /** Remember what was typed in a member's hours fields (M6), so checks see it before commit. */
  setTyped: (id: string, patch: TypedHours) => void;
  /** "Same for everyone in this role": copy one member's hours / clock times (M6). */
  copyHoursToRole: (fromMemberId: string) => void;
  /**
   * Persist a shift snapshot and remember its coworkers. `team` is the draft team as typed (so
   * placeholder names like "Barback 2" aren't remembered); defaults to `input.team`.
   */
  saveShift: (input: ShiftInput, result: ShiftResult, team?: TeamMember[]) => Promise<void>;
  deleteShift: (id: string) => Promise<void>;
  /** A fresh draft from the default settings (also ends editing a saved shift). */
  resetDraft: () => void;
  /**
   * M7: load a saved shift's input into the draft and edit it. If its profile was deleted (#54),
   * uses the current default profile for its role and sets `draft.editingNote`.
   */
  startEditShift: (shift: SavedShift) => void;
  setWeekStartsOn: (day: 0 | 1) => void;

  // --- profiles (milestone 5) ---
  /** Unsaved new profile for `appliesTo`, copied from that role's built-in, with a unique name. */
  createProfile: (appliesTo: UserRole) => TipOutProfile;
  /** Unsaved copy of profile `id` ("... copy"), or null if it doesn't exist. */
  duplicateProfile: (id: string) => TipOutProfile | null;
  /** Validate (errors throw StoreActionError 'PROFILE_INVALID') and upsert. */
  saveProfile: (profile: TipOutProfile) => Promise<void>;
  /**
   * Delete a profile unless it's the last one for its role (#44). If it was the default (or the
   * draft's profile), falls back to the remaining profile for that role, built-in first.
   */
  deleteProfile: (id: string) => Promise<void>;
  /** Restore a built-in profile's shipped values (keeps its id). */
  resetProfile: (id: string) => Promise<void>;

  // --- settings ---
  setDefaultProfile: (profileId: string) => void;
  /** Settings' rounding default (also the draft's, unless a saved shift is being edited). */
  setDefaultRoundToDollar: (on: boolean) => void;
  setWholeDollarShares: (on: boolean) => void;
  /** Onboarding step 1: use `role`'s built-in profile as the default. */
  chooseOnboardingRole: (role: UserRole) => void;
  /** Onboarding done ("Looks good"). */
  finishOnboarding: () => void;

  // --- coworkers ---
  /** Rename; refuses blanks and another coworker's name (StoreActionError). */
  renameCoworker: (id: string, name: string) => Promise<void>;
  setCoworkerRole: (id: string, role: RoleId) => Promise<void>;
  deleteCoworker: (id: string) => Promise<void>;
}

/** Run a DB write without blocking the UI; log failures (the in-memory state still updates). */
function persistQuietly(db: Db | null, write: (db: Db) => Promise<unknown>): void {
  if (!db) return;
  write(db).catch((e: unknown) => console.warn('TipJar: failed to save setting', e));
}

export const useShiftStore = create<ShiftState>((set, get) => ({
  status: 'loading',
  db: null,
  draft: freshDraft(),
  profiles: [...DEFAULT_PROFILES],
  savedShifts: [],
  coworkers: [],
  settings: { ...DEFAULT_SETTINGS },

  hydrate: async (db) => {
    const [
      profiles,
      roundToDollar,
      profileId,
      wholeDollarShares,
      onboarded,
      weekStartsOn,
      coworkers,
      savedShifts,
    ] = await Promise.all([
      repo.listProfiles(db),
      repo.getSetting(db, 'defaultRoundToDollar', DEFAULT_SETTINGS.defaultRoundToDollar),
      repo.getSetting(db, 'defaultProfileId', DEFAULT_SETTINGS.defaultProfileId),
      repo.getSetting(db, 'wholeDollarShares', DEFAULT_SETTINGS.wholeDollarShares),
      repo.getSetting(db, 'onboarded', DEFAULT_SETTINGS.onboarded),
      repo.getSetting<number>(db, 'weekStartsOn', DEFAULT_SETTINGS.weekStartsOn),
      repo.listCoworkers(db),
      repo.listShifts(db),
    ]);
    const usable = profiles.length > 0 ? profiles : [...DEFAULT_PROFILES];
    const startProfile = usable.some((p) => p.id === profileId) ? profileId : usable[0]!.id;
    // Existing installs that already have shifts skip onboarding (m5 contract).
    const skipOnboarding = onboarded !== true && savedShifts.length > 0;
    if (skipOnboarding) await repo.setSetting(db, 'onboarded', true);
    set({
      db,
      profiles: usable,
      coworkers,
      savedShifts,
      settings: {
        defaultRoundToDollar: roundToDollar,
        defaultProfileId: startProfile,
        wholeDollarShares,
        onboarded: onboarded === true || skipOnboarding,
        weekStartsOn: weekStartsOn === 1 ? 1 : 0,
      },
      draft: freshDraft(startProfile, roundToDollar),
      status: 'ready',
      loadError: undefined,
    });
    // Adds "Me" in the bartender flow.
    get().setProfile(startProfile);
  },
  setLoadError: (message) => set({ status: 'error', loadError: message }),

  setMoney: (field, value) =>
    set((s) => ({
      draft: {
        ...s.draft,
        [field]: value,
        // Editing a scanned value ends its highlight.
        ...(s.draft.scanned ? { scanned: s.draft.scanned.filter((f) => f !== field) } : {}),
      },
    })),
  applyScan: (values) =>
    set((s) => {
      const draft = { ...s.draft };
      const scanned: ('totalTips' | 'netSales' | 'foodSales')[] = [];
      for (const f of ['totalTips', 'netSales', 'foodSales'] as const) {
        const v = values[f];
        if (v !== undefined) {
          draft[f] = v;
          scanned.push(f);
        }
      }
      return { draft: { ...draft, scanned } };
    }),
  setDate: (date) => set((s) => ({ draft: { ...s.draft, date } })),
  setRoundToDollar: (on) => {
    // Editing a saved shift changes that shift only, not the default.
    if (get().draft.editingShiftId) {
      set((s) => ({ draft: { ...s.draft, roundToDollar: on } }));
      return;
    }
    set((s) => ({
      draft: { ...s.draft, roundToDollar: on },
      settings: { ...s.settings, defaultRoundToDollar: on },
    }));
    persistQuietly(get().db, (db) =>
      repo.setSetting(db, repo.SETTINGS.defaultRoundToDollar.key, on),
    );
  },
  setProfile: (profileId) => {
    // Editing a saved shift changes that shift only, not the default.
    const editing = !!get().draft.editingShiftId;
    if (!editing && get().settings.defaultProfileId !== profileId) {
      persistQuietly(get().db, (db) =>
        repo.setSetting(db, repo.SETTINGS.defaultProfileId.key, profileId),
      );
    }
    set((s) => {
      const profile = s.profiles.find((p) => p.id === profileId);
      let team = s.draft.team;
      if (profile?.appliesTo === 'bartender') {
        // Bartender flow: the user shares the bar's kept tips, so make sure they're listed.
        if (!team.some((m) => m.role === 'bartender')) {
          team = [{ id: newId(), name: 'Me', role: 'bartender', isUser: true }, ...team];
        }
      } else if (profile) {
        // Server flow: the user isn't tipped out, so drop the auto-added "Me".
        team = team.filter((m) => !m.isUser);
      }
      return {
        draft: { ...s.draft, profileId, team },
        settings: editing ? s.settings : { ...s.settings, defaultProfileId: profileId },
      };
    });
  },
  setMissingRoleHandling: (h) => set((s) => ({ draft: { ...s.draft, missingRoleHandling: h } })),
  addMember: (role, name = '') => {
    const id = newId();
    set((s) => ({ draft: { ...s.draft, team: [...s.draft.team, { id, name, role }] } }));
    return id;
  },
  updateMember: (id, patch) =>
    set((s) => ({
      draft: {
        ...s.draft,
        team: s.draft.team.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      },
    })),
  removeMember: (id) =>
    set((s) => {
      const typed = { ...s.draft.typed };
      delete typed[id];
      return { draft: { ...s.draft, team: s.draft.team.filter((m) => m.id !== id), typed } };
    }),
  setTyped: (id, patch) =>
    set((s) => ({
      draft: { ...s.draft, typed: { ...s.draft.typed, [id]: { ...s.draft.typed[id], ...patch } } },
    })),
  copyHoursToRole: (fromId) =>
    set((s) => {
      const source = s.draft.team.find((m) => m.id === fromId);
      if (!source) return {};
      const team = copyHours(s.draft.team, fromId);
      // The copies are committed values: drop the targets' typed text, match the source's mode.
      const mode = s.draft.typed[fromId]?.mode ?? (source.hours !== undefined ? 'hours' : 'clock');
      const typed = { ...s.draft.typed };
      for (const m of team) {
        if (m.role === source.role && m.id !== fromId) typed[m.id] = { mode };
      }
      return { draft: { ...s.draft, team, typed } };
    }),
  saveShift: async (input, result, team = input.team) => {
    const db = get().db;
    if (!db) {
      // No database (UI tests / failed open): keep it for this session only.
      const editingId = get().draft.editingShiftId;
      if (editingId) {
        set((s) => ({
          savedShifts: s.savedShifts.map((x) => (x.id === editingId ? { ...x, input, result } : x)),
        }));
        return;
      }
      set((s) => ({
        savedShifts: [
          { id: newId('shift'), savedAt: new Date().toISOString(), input, result },
          ...s.savedShifts,
        ],
      }));
      return;
    }
    const editingId = get().draft.editingShiftId;
    if (editingId) await repo.updateShift(db, editingId, { input, result });
    else await repo.saveShift(db, { input, result });
    await repo.rememberTeam(db, team, input.date);
    const [savedShifts, coworkers] = await Promise.all([
      repo.listShifts(db),
      repo.listCoworkers(db),
    ]);
    set({ savedShifts, coworkers });
  },
  deleteShift: async (id) => {
    const db = get().db;
    if (db) await repo.deleteShift(db, id);
    set((s) => ({ savedShifts: s.savedShifts.filter((x) => x.id !== id) }));
  },
  resetDraft: () => {
    const { settings, profiles } = get();
    const profileId = profiles.some((p) => p.id === settings.defaultProfileId)
      ? settings.defaultProfileId
      : profiles[0]!.id;
    set({ draft: freshDraft(profileId, settings.defaultRoundToDollar) });
    get().setProfile(profileId);
  },
  startEditShift: (shift) => {
    const { profiles, settings } = get();
    const { input } = shift;
    let profile = profiles.find((p) => p.id === input.profileId);
    let editingNote: string | undefined;
    if (!profile) {
      // #54: the shift's profile was deleted; use the current default for its role.
      const sameRole = profiles.filter((p) => p.appliesTo === input.userRole);
      profile =
        sameRole.find((p) => p.id === settings.defaultProfileId) ??
        sameRole.find((p) => isBuiltInProfile(p.id)) ??
        sameRole[0] ??
        profiles[0]!;
      editingNote = `The profile this shift used was deleted, so it was recalculated with ${profile.name}.`;
    }
    const draft: DraftShift = {
      date: input.date,
      profileId: profile.id,
      roundToDollar: input.roundToDollar,
      totalTips: input.totalTips,
      netSales: input.netSales,
      foodSales: input.foodSales,
      team: input.team.map((m) => ({ ...m })),
      missingRoleHandling: input.missingRoleHandling,
      typed: {},
      editingShiftId: shift.id,
    };
    if (editingNote) draft.editingNote = editingNote;
    set({ draft });
  },
  setWeekStartsOn: (day) => {
    set((s) => ({ settings: { ...s.settings, weekStartsOn: day } }));
    persistQuietly(get().db, (db) => repo.setSetting(db, 'weekStartsOn', day));
  },

  // --- profiles --------------------------------------------------------------
  createProfile: (appliesTo) => {
    const base = builtInProfile(
      appliesTo === 'bartender' ? 'bartender-default' : 'server-default',
    )!;
    return newProfile(base, {
      id: repo.generateId('profile'),
      name: uniqueProfileName(`My ${appliesTo} profile`, get().profiles),
      appliesTo,
    });
  },
  duplicateProfile: (id) => {
    const source = get().profiles.find((p) => p.id === id);
    if (!source) return null;
    return newProfile(source, {
      id: repo.generateId('profile'),
      name: uniqueProfileName(`${source.name} copy`, get().profiles),
    });
  },
  saveProfile: async (profile) => {
    // #44 can't be bypassed by editing: the last profile for a role can't switch roles (#65).
    const before = get().profiles.find((p) => p.id === profile.id);
    if (
      before &&
      before.appliesTo !== profile.appliesTo &&
      !get().profiles.some((p) => p.id !== profile.id && p.appliesTo === before.appliesTo)
    ) {
      throw new StoreActionError(
        'LAST_PROFILE_FOR_ROLE',
        `This is your only ${before.appliesTo} profile, so it has to stay a ${before.appliesTo} profile. Create another ${before.appliesTo} profile first.`,
      );
    }
    const issues = checkProfile(profile, get().profiles);
    if (hasErrors(issues)) {
      const first = issues.find((i) => i.severity === 'error')!;
      throw new StoreActionError('PROFILE_INVALID', first.message, issues);
    }
    const db = get().db;
    if (db) {
      await repo.saveProfile(db, profile);
      set({ profiles: await repo.listProfiles(db) });
    } else {
      set((s) => ({ profiles: upsertInMemory(s.profiles, profile) }));
    }
  },
  deleteProfile: async (id) => {
    const { profiles, settings, draft, db } = get();
    const target = profiles.find((p) => p.id === id);
    if (!target) return;
    const sameRole = profiles.filter((p) => p.appliesTo === target.appliesTo && p.id !== id);
    if (sameRole.length === 0) {
      throw new StoreActionError(
        'LAST_PROFILE_FOR_ROLE',
        `This is your only ${target.appliesTo} profile, so it can't be deleted. Edit it instead, or create another ${target.appliesTo} profile first.`,
      );
    }
    // Built-in first, then the first remaining by name (review round 5, #65).
    const fallback =
      sameRole.find((p) => isBuiltInProfile(p.id)) ??
      [...sameRole].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      )[0]!;
    if (db) {
      await repo.deleteProfile(db, id);
      set({ profiles: await repo.listProfiles(db) });
    } else {
      set((s) => ({ profiles: s.profiles.filter((p) => p.id !== id) }));
    }
    if (settings.defaultProfileId === id || draft.profileId === id) {
      // Switches the draft and makes the fallback the default (persisted).
      get().setProfile(fallback.id);
      if (db) await repo.setSetting(db, 'defaultProfileId', fallback.id);
    }
  },
  resetProfile: async (id) => {
    const shipped = builtInProfile(id);
    if (!shipped) {
      throw new StoreActionError('NOT_BUILT_IN', 'Only the built-in profiles can be reset.');
    }
    const db = get().db;
    if (db) {
      await repo.saveProfile(db, shipped);
      set({ profiles: await repo.listProfiles(db) });
    } else {
      set((s) => ({ profiles: upsertInMemory(s.profiles, shipped) }));
    }
  },

  // --- settings --------------------------------------------------------------
  setDefaultProfile: (profileId) => {
    if (!get().draft.editingShiftId) {
      get().setProfile(profileId);
      return;
    }
    // While a saved shift is being edited, change the default without touching that draft.
    set((s) => ({ settings: { ...s.settings, defaultProfileId: profileId } }));
    persistQuietly(get().db, (db) => repo.setSetting(db, 'defaultProfileId', profileId));
  },
  setDefaultRoundToDollar: (on) => {
    if (!get().draft.editingShiftId) {
      get().setRoundToDollar(on);
      return;
    }
    set((s) => ({ settings: { ...s.settings, defaultRoundToDollar: on } }));
    persistQuietly(get().db, (db) => repo.setSetting(db, 'defaultRoundToDollar', on));
  },
  setWholeDollarShares: (on) => {
    set((s) => ({ settings: { ...s.settings, wholeDollarShares: on } }));
    persistQuietly(get().db, (db) => repo.setSetting(db, 'wholeDollarShares', on));
  },
  chooseOnboardingRole: (role) => {
    get().setProfile(role === 'bartender' ? 'bartender-default' : 'server-default');
  },
  finishOnboarding: () => {
    set((s) => ({ settings: { ...s.settings, onboarded: true } }));
    persistQuietly(get().db, (db) => repo.setSetting(db, 'onboarded', true));
  },

  // --- coworkers -------------------------------------------------------------
  renameCoworker: async (id, name) => {
    const trimmed = name.trim();
    const current = get().coworkers.find((c) => c.id === id);
    if (!current) {
      throw new StoreActionError('COWORKER_NOT_FOUND', 'That coworker no longer exists.');
    }
    if (!trimmed) throw new StoreActionError('COWORKER_NAME_REQUIRED', 'Enter a name.');
    const key = repo.coworkerKey(trimmed);
    if (get().coworkers.some((c) => c.id !== id && repo.coworkerKey(c.name) === key)) {
      throw new StoreActionError(
        'COWORKER_NAME_TAKEN',
        `You already have a coworker called "${trimmed}".`,
      );
    }
    await updateCoworker(set, get, { ...current, name: trimmed });
  },
  setCoworkerRole: async (id, role) => {
    const current = get().coworkers.find((c) => c.id === id);
    if (!current) {
      throw new StoreActionError('COWORKER_NOT_FOUND', 'That coworker no longer exists.');
    }
    await updateCoworker(set, get, { ...current, usualRole: role });
  },
  deleteCoworker: async (id) => {
    const db = get().db;
    if (db) {
      await repo.deleteCoworker(db, id);
      set({ coworkers: await repo.listCoworkers(db) });
    } else {
      set((s) => ({ coworkers: s.coworkers.filter((c) => c.id !== id) }));
    }
  },
}));

type SetState = (partial: Partial<ShiftState>) => void;

async function updateCoworker(set: SetState, get: () => ShiftState, c: Coworker): Promise<void> {
  const db = get().db;
  if (db) {
    await repo.upsertCoworker(db, { id: c.id, name: c.name, usualRole: c.usualRole });
    set({ coworkers: await repo.listCoworkers(db) });
  } else {
    set({ coworkers: get().coworkers.map((x) => (x.id === c.id ? c : x)) });
  }
}

function upsertInMemory(profiles: TipOutProfile[], profile: TipOutProfile): TipOutProfile[] {
  return profiles.some((p) => p.id === profile.id)
    ? profiles.map((p) => (p.id === profile.id ? profile : p))
    : [...profiles, profile];
}

/** `base`, or `base 2`, `base 3`, ... whichever no other profile uses (case-insensitive). */
export function uniqueProfileName(base: string, profiles: TipOutProfile[]): string {
  const taken = new Set(profiles.map((p) => p.name.trim().toLocaleLowerCase()));
  if (!taken.has(base.toLocaleLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

/** Engine options from settings (#21: whole-dollar shares -> roundMemberShares). */
export function engineOptions(settings: AppSettings): { roundMemberShares: boolean } {
  return { roundMemberShares: settings.wholeDollarShares };
}

/**
 * Onboarding shows when not onboarded and there are no saved shifts (m5 contract), and only once
 * data has loaded: a failed hydrate looks like "no shifts" and must not trigger it (review round 5,
 * #64). `settings.onboarded` is set from a strict `=== true` check on hydrate.
 */
export function needsOnboarding(state: {
  status: LoadStatus;
  settings: AppSettings;
  savedShifts: SavedShift[];
}): boolean {
  return (
    state.status === 'ready' && state.settings.onboarded !== true && state.savedShifts.length === 0
  );
}

export function selectProfile(state: { draft: DraftShift; profiles: TipOutProfile[] }) {
  return state.profiles.find((p) => p.id === state.draft.profileId) ?? state.profiles[0]!;
}

/** Placeholder for an unnamed member, e.g. "Barback 2" (position within their role). */
export function placeholderName(
  team: TeamMember[],
  member: TeamMember,
  profile?: TipOutProfile,
): string {
  const index = team.filter((m) => m.role === member.role).findIndex((m) => m.id === member.id);
  return `${roleNames(profile, member.role).singular} ${index + 1}`;
}

/** Build the engine input from the draft. Blank money fields count as 0. */
export function buildShiftInput(draft: DraftShift, profile: TipOutProfile): ShiftInput {
  return {
    date: draft.date,
    userRole: profile.appliesTo,
    totalTips: draft.totalTips ?? 0,
    netSales: draft.netSales ?? 0,
    foodSales: draft.foodSales ?? 0,
    // Unnamed members still count (they worked) — give them a readable placeholder name.
    team: draft.team.map((m) => ({
      ...m,
      name: m.name.trim() || placeholderName(draft.team, m, profile),
    })),
    missingRoleHandling: draft.missingRoleHandling,
    profileId: profile.id,
    roundToDollar: draft.roundToDollar,
  };
}

/** Roles the user should list people for on the "Who worked" screen, in display order. */
export function teamRolesFor(profile: TipOutProfile): RoleId[] {
  const roles: RoleId[] = [];
  if (profile.appliesTo === 'bartender') roles.push('bartender');
  for (const rule of profile.rules) {
    if (rule.role === 'kitchen') continue;
    if (!roles.includes(rule.role)) roles.push(rule.role);
  }
  return roles;
}

/**
 * Saved coworkers to offer as quick-add chips on "Who worked": most recently worked first (the
 * order they're stored in), only for roles this profile lists, and hiding anyone already on the
 * team (case-insensitive, trimmed name match).
 */
export function quickAddCoworkers(
  coworkers: Coworker[],
  team: TeamMember[],
  roles: RoleId[],
): Coworker[] {
  const onTeam = new Set(team.map((m) => m.name.trim().toLowerCase()).filter(Boolean));
  return coworkers.filter(
    (c) => roles.includes(c.usualRole) && !onTeam.has(c.name.trim().toLowerCase()),
  );
}
