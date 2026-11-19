import * as repo from '@/db/repositories';
import { initDb } from '@/db/seed';
import { createTestDb } from '@/db/testing/sqljsDb';
import type { Db } from '@/db/types';
import { calculateShift } from '@/engine/calculate';
import { SERVER_DEFAULT_PROFILE } from '@/engine/profiles';
import {
  buildShiftInput,
  quickAddCoworkers,
  selectProfile,
  teamRolesFor,
  useShiftStore,
} from '@/store/shiftStore';

/** Let fire-and-forget settings writes finish. */
const flush = () => new Promise((r) => setTimeout(r, 0));

async function hydratedDb(): Promise<Db> {
  const db = await createTestDb();
  await initDb(db);
  await useShiftStore.getState().hydrate(db);
  return db;
}

describe('store persistence (milestone 4)', () => {
  beforeEach(() => useShiftStore.setState(useShiftStore.getInitialState(), true));

  it('starts loading, hydrates defaults from an empty DB', async () => {
    expect(useShiftStore.getState().status).toBe('loading');
    await hydratedDb();
    const s = useShiftStore.getState();
    expect(s.status).toBe('ready');
    expect(s.profiles.map((p) => p.id)).toEqual(['server-default', 'bartender-default']);
    expect(s.draft.profileId).toBe('server-default');
    expect(s.draft.roundToDollar).toBe(true);
    expect(s.savedShifts).toEqual([]);
  });

  it('rounding and profile defaults are saved to settings and restored on the next start', async () => {
    const db = await hydratedDb();
    useShiftStore.getState().setRoundToDollar(false);
    useShiftStore.getState().setProfile('bartender-default');
    await flush();
    expect(await repo.getSetting(db, 'defaultRoundToDollar', true)).toBe(false);
    expect(await repo.getSetting(db, 'defaultProfileId', 'server-default')).toBe(
      'bartender-default',
    );

    useShiftStore.setState(useShiftStore.getInitialState(), true);
    await useShiftStore.getState().hydrate(db);
    const s = useShiftStore.getState();
    expect(s.draft.roundToDollar).toBe(false);
    expect(s.draft.profileId).toBe('bartender-default');
    // Bartender flow: "Me" is added as the user.
    expect(s.draft.team).toEqual([expect.objectContaining({ name: 'Me', isUser: true })]);
  });

  it('save shift persists the snapshot and remembers named coworkers; delete removes it', async () => {
    const db = await hydratedDb();
    const st = useShiftStore.getState();
    st.setMoney('totalTips', 34056);
    st.setMoney('netSales', 156025);
    st.setMoney('foodSales', 70012);
    st.addMember('bartender', 'Joseph');
    st.addMember('barback', ''); // placeholder name: not remembered
    st.addMember('host', 'Hannah');

    const state = useShiftStore.getState();
    const profile = selectProfile(state);
    const input = buildShiftInput(state.draft, profile);
    const { result } = calculateShift(input, profile);
    await state.saveShift(input, result, state.draft.team);

    const saved = await repo.listShifts(db);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.input).toEqual(input);
    expect(saved[0]!.result).toEqual(result);
    expect(useShiftStore.getState().savedShifts.map((x) => x.id)).toEqual([saved[0]!.id]);
    expect(useShiftStore.getState().coworkers.map((c) => [c.name, c.usualRole])).toEqual([
      ['Hannah', 'host'],
      ['Joseph', 'bartender'],
    ]);

    await useShiftStore.getState().deleteShift(saved[0]!.id);
    expect(await repo.listShifts(db)).toEqual([]);
    expect(useShiftStore.getState().savedShifts).toEqual([]);
  });

  it('quick-add hides people already on the team and roles the profile does not use', () => {
    const coworkers: repo.Coworker[] = [
      { id: '1', name: 'Zoe', usualRole: 'host', lastWorked: '2026-11-10' },
      { id: '2', name: 'Joseph', usualRole: 'bartender', lastWorked: '2026-11-09' },
      { id: '3', name: 'Sam', usualRole: 'server', lastWorked: '2026-11-08' },
    ];
    const roles = teamRolesFor(SERVER_DEFAULT_PROFILE);
    expect(
      quickAddCoworkers(coworkers, [{ id: 'x', name: ' joseph ', role: 'barback' }], roles).map(
        (c) => c.name,
      ),
    ).toEqual(['Zoe']);
  });
});
