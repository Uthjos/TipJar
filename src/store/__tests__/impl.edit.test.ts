import * as repo from '@/db/repositories';
import { initDb } from '@/db/seed';
import { createTestDb } from '@/db/testing/sqljsDb';
import type { Db } from '@/db/types';
import { calculateShift } from '@/engine/calculate';
import { buildShiftInput, engineOptions, selectProfile, useShiftStore } from '@/store/shiftStore';

const flush = () => new Promise((r) => setTimeout(r, 0));

async function hydrated(): Promise<Db> {
  const db = await createTestDb();
  await initDb(db);
  await useShiftStore.getState().hydrate(db);
  return db;
}

async function saveCurrentDraft() {
  const s = useShiftStore.getState();
  const profile = selectProfile(s);
  const input = buildShiftInput(s.draft, profile);
  const { result } = calculateShift(input, profile, engineOptions(s.settings));
  await s.saveShift(input, result, s.draft.team);
  return { input, result };
}

describe('editing a saved shift (M7)', () => {
  beforeEach(() => useShiftStore.setState(useShiftStore.getInitialState(), true));

  it('loads the saved input, updates the same shift (same id and savedAt), then resets', async () => {
    const db = await hydrated();
    const st = useShiftStore.getState();
    st.setDate('2026-11-10');
    st.setMoney('totalTips', 34056);
    st.setMoney('netSales', 156025);
    st.setMoney('foodSales', 70012);
    st.addMember('barback', 'David');
    useShiftStore.getState().updateMember(useShiftStore.getState().draft.team[0]!.id, { hours: 6 });
    st.setMissingRoleHandling('redistribute');
    await saveCurrentDraft();
    const [saved] = await repo.listShifts(db);

    useShiftStore.getState().startEditShift(saved!);
    const d = useShiftStore.getState().draft;
    expect(d.editingShiftId).toBe(saved!.id);
    expect(d.date).toBe('2026-11-10');
    expect(d.totalTips).toBe(34056);
    expect(d.missingRoleHandling).toBe('redistribute');
    expect(d.team).toEqual(saved!.input.team);
    expect(d.editingNote).toBeUndefined();

    // Changing rounding while editing doesn't change the default.
    useShiftStore.getState().setRoundToDollar(false);
    await flush();
    expect(useShiftStore.getState().settings.defaultRoundToDollar).toBe(true);
    expect(await repo.getSetting(db, 'defaultRoundToDollar', true)).toBe(true);

    useShiftStore.getState().setMoney('totalTips', 40000);
    await saveCurrentDraft();
    const after = await repo.listShifts(db);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(saved!.id);
    expect(after[0]!.savedAt).toBe(saved!.savedAt);
    expect(after[0]!.input.totalTips).toBe(40000);
    expect(after[0]!.input.roundToDollar).toBe(false);
    expect(useShiftStore.getState().savedShifts[0]!.input.totalTips).toBe(40000);

    useShiftStore.getState().resetDraft();
    const fresh = useShiftStore.getState().draft;
    expect(fresh.editingShiftId).toBeUndefined();
    expect(fresh.team).toEqual([]);
    expect(fresh.roundToDollar).toBe(true);
  });

  it('#54: a deleted profile falls back to the default for its role, with a note', async () => {
    const db = await hydrated();
    const st = useShiftStore.getState();
    const mine = st.createProfile('bartender');
    await st.saveProfile({ ...mine, name: 'Patio bar' });
    useShiftStore.getState().setProfile(mine.id);
    useShiftStore.getState().setMoney('totalTips', 10000);
    await saveCurrentDraft();
    await useShiftStore.getState().deleteProfile(mine.id);
    const [saved] = await repo.listShifts(db);
    useShiftStore.getState().startEditShift(saved!);
    const d = useShiftStore.getState().draft;
    expect(d.profileId).toBe('bartender-default');
    expect(d.editingNote).toBe(
      'The profile this shift used was deleted, so it was recalculated with Bartender default.',
    );
  });

  it('weekStartsOn is persisted', async () => {
    const db = await hydrated();
    expect(useShiftStore.getState().settings.weekStartsOn).toBe(0);
    useShiftStore.getState().setWeekStartsOn(1);
    await flush();
    expect(await repo.getSetting(db, 'weekStartsOn', 0)).toBe(1);
    useShiftStore.setState(useShiftStore.getInitialState(), true);
    await useShiftStore.getState().hydrate(db);
    expect(useShiftStore.getState().settings.weekStartsOn).toBe(1);
  });
});
