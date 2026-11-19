import { format } from 'date-fns';
import { create } from 'zustand';

import * as repo from '@/db/repositories';
import type { Coworker, SavedShift } from '@/db/repositories';
import type { Db } from '@/db/types';
import { DEFAULT_PROFILES, roleSingular } from '@/engine/profiles';
import type {
  Cents,
  MissingRoleHandling,
  RoleId,
  ShiftInput,
  ShiftResult,
  TeamMember,
  TipOutProfile,
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
  };
}

export type LoadStatus = 'loading' | 'ready' | 'error';

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

  /** Load profiles, settings defaults, coworkers and saved shifts from the DB. */
  hydrate: (db: Db) => Promise<void>;
  setLoadError: (message: string) => void;
  setMoney: (field: 'totalTips' | 'netSales' | 'foodSales', value: Cents | undefined) => void;
  setDate: (date: string) => void;
  setRoundToDollar: (on: boolean) => void;
  setProfile: (profileId: string) => void;
  setMissingRoleHandling: (h: MissingRoleHandling) => void;
  addMember: (role: RoleId, name?: string) => string;
  updateMember: (id: string, patch: Partial<Omit<TeamMember, 'id'>>) => void;
  removeMember: (id: string) => void;
  /**
   * Persist a shift snapshot and remember its coworkers. `team` is the draft team as typed (so
   * placeholder names like "Barback 2" aren't remembered); defaults to `input.team`.
   */
  saveShift: (input: ShiftInput, result: ShiftResult, team?: TeamMember[]) => Promise<void>;
  deleteShift: (id: string) => Promise<void>;
  resetDraft: () => void;
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

  hydrate: async (db) => {
    const [profiles, roundToDollar, profileId, coworkers, savedShifts] = await Promise.all([
      repo.listProfiles(db),
      repo.getSetting(
        db,
        repo.SETTINGS.defaultRoundToDollar.key,
        repo.SETTINGS.defaultRoundToDollar.fallback as boolean,
      ),
      repo.getSetting(
        db,
        repo.SETTINGS.defaultProfileId.key,
        repo.SETTINGS.defaultProfileId.fallback as string,
      ),
      repo.listCoworkers(db),
      repo.listShifts(db),
    ]);
    const usable = profiles.length > 0 ? profiles : [...DEFAULT_PROFILES];
    const startProfile = usable.some((p) => p.id === profileId) ? profileId : usable[0]!.id;
    set({
      db,
      profiles: usable,
      coworkers,
      savedShifts,
      draft: freshDraft(startProfile, roundToDollar),
      status: 'ready',
      loadError: undefined,
    });
    // Adds "Me" in the bartender flow.
    get().setProfile(startProfile);
  },
  setLoadError: (message) => set({ status: 'error', loadError: message }),

  setMoney: (field, value) => set((s) => ({ draft: { ...s.draft, [field]: value } })),
  setDate: (date) => set((s) => ({ draft: { ...s.draft, date } })),
  setRoundToDollar: (on) => {
    set((s) => ({ draft: { ...s.draft, roundToDollar: on } }));
    persistQuietly(get().db, (db) =>
      repo.setSetting(db, repo.SETTINGS.defaultRoundToDollar.key, on),
    );
  },
  setProfile: (profileId) => {
    if (get().draft.profileId !== profileId) {
      persistQuietly(get().db, (db) =>
        repo.setSetting(db, repo.SETTINGS.defaultProfileId.key, profileId),
      );
    }
    set((s) => {
      const profile = s.profiles.find((p) => p.id === profileId);
      let team = s.draft.team;
      // Bartender flow: the user shares the bar's kept tips, so make sure they're listed.
      if (profile?.appliesTo === 'bartender' && !team.some((m) => m.role === 'bartender')) {
        team = [{ id: newId(), name: 'Me', role: 'bartender', isUser: true }, ...team];
      }
      return { draft: { ...s.draft, profileId, team } };
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
    set((s) => ({ draft: { ...s.draft, team: s.draft.team.filter((m) => m.id !== id) } })),
  saveShift: async (input, result, team = input.team) => {
    const db = get().db;
    if (!db) {
      // No database (UI tests / failed open): keep it for this session only.
      set((s) => ({
        savedShifts: [
          { id: newId('shift'), savedAt: new Date().toISOString(), input, result },
          ...s.savedShifts,
        ],
      }));
      return;
    }
    await repo.saveShift(db, { input, result });
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
    const { draft } = get();
    set({ draft: freshDraft(draft.profileId, draft.roundToDollar) });
    get().setProfile(draft.profileId);
  },
}));

export function selectProfile(state: { draft: DraftShift; profiles: TipOutProfile[] }) {
  return state.profiles.find((p) => p.id === state.draft.profileId) ?? state.profiles[0]!;
}

/** Placeholder for an unnamed member, e.g. "Barback 2" (position within their role). */
export function placeholderName(team: TeamMember[], member: TeamMember): string {
  const index = team.filter((m) => m.role === member.role).findIndex((m) => m.id === member.id);
  return `${roleSingular(member.role)} ${index + 1}`;
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
    team: draft.team.map((m) => ({ ...m, name: m.name.trim() || placeholderName(draft.team, m) })),
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
