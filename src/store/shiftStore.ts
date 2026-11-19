import { format } from 'date-fns';
import { create } from 'zustand';

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

/** The in-progress shift being entered (in-memory only for milestone 3). */
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

export interface SavedShift {
  id: string;
  savedAt: string;
  input: ShiftInput;
  result: ShiftResult;
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

interface ShiftState {
  draft: DraftShift;
  profiles: TipOutProfile[];
  savedShifts: SavedShift[];

  setMoney: (field: 'totalTips' | 'netSales' | 'foodSales', value: Cents | undefined) => void;
  setDate: (date: string) => void;
  setRoundToDollar: (on: boolean) => void;
  setProfile: (profileId: string) => void;
  setMissingRoleHandling: (h: MissingRoleHandling) => void;
  addMember: (role: RoleId, name?: string) => string;
  updateMember: (id: string, patch: Partial<Omit<TeamMember, 'id'>>) => void;
  removeMember: (id: string) => void;
  saveShift: (input: ShiftInput, result: ShiftResult) => void;
  resetDraft: () => void;
}

export const useShiftStore = create<ShiftState>((set, get) => ({
  draft: freshDraft(),
  profiles: [...DEFAULT_PROFILES],
  savedShifts: [],

  setMoney: (field, value) => set((s) => ({ draft: { ...s.draft, [field]: value } })),
  setDate: (date) => set((s) => ({ draft: { ...s.draft, date } })),
  setRoundToDollar: (on) => set((s) => ({ draft: { ...s.draft, roundToDollar: on } })),
  setProfile: (profileId) =>
    set((s) => {
      const profile = s.profiles.find((p) => p.id === profileId);
      let team = s.draft.team;
      // Bartender flow: the user shares the bar's kept tips, so make sure they're listed.
      if (profile?.appliesTo === 'bartender' && !team.some((m) => m.role === 'bartender')) {
        team = [{ id: newId(), name: 'Me', role: 'bartender' }, ...team];
      }
      return { draft: { ...s.draft, profileId, team } };
    }),
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
  saveShift: (input, result) =>
    set((s) => ({
      savedShifts: [
        { id: newId('shift'), savedAt: new Date().toISOString(), input, result },
        ...s.savedShifts,
      ],
    })),
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
