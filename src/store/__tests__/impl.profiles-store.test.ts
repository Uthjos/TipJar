import * as repo from '@/db/repositories';
import { initDb } from '@/db/seed';
import { createTestDb } from '@/db/testing/sqljsDb';
import type { Db } from '@/db/types';
import { calculateShift } from '@/engine/calculate';
import { SERVER_DEFAULT_PROFILE } from '@/engine/profiles';
import {
  buildShiftInput,
  engineOptions,
  needsOnboarding,
  selectProfile,
  StoreActionError,
  useShiftStore,
} from '@/store/shiftStore';

const flush = () => new Promise((r) => setTimeout(r, 0));

async function hydrated(): Promise<Db> {
  const db = await createTestDb();
  await initDb(db);
  await useShiftStore.getState().hydrate(db);
  return db;
}

async function expectStoreError(p: Promise<unknown>, code: StoreActionError['code']) {
  await expect(p).rejects.toBeInstanceOf(StoreActionError);
  await p.catch((e: StoreActionError) => expect(e.code).toBe(code));
}

describe('store: profiles, settings, coworkers, onboarding (M5)', () => {
  beforeEach(() => useShiftStore.setState(useShiftStore.getInitialState(), true));

  it('create / duplicate give unsaved profiles with unique names; save validates', async () => {
    const db = await hydrated();
    const st = useShiftStore.getState();
    const fresh = st.createProfile('bartender');
    expect(fresh.appliesTo).toBe('bartender');
    expect(fresh.name).toBe('My bartender profile');
    expect(useShiftStore.getState().profiles).toHaveLength(2);

    const dup = st.duplicateProfile('server-default')!;
    expect(dup.name).toBe('Server default copy');
    expect(dup.rules).toEqual(SERVER_DEFAULT_PROFILE.rules);

    await expectStoreError(st.saveProfile({ ...dup, name: 'server default' }), 'PROFILE_INVALID');
    await st.saveProfile(dup);
    expect((await repo.getProfile(db, dup.id))!.name).toBe('Server default copy');
    expect(useShiftStore.getState().profiles.map((p) => p.id)).toContain(dup.id);
  });

  it('#44: the last profile for a role cannot be deleted; deleting the default falls back', async () => {
    const db = await hydrated();
    const st = useShiftStore.getState();
    await expectStoreError(st.deleteProfile('bartender-default'), 'LAST_PROFILE_FOR_ROLE');

    const mine = st.createProfile('bartender');
    await st.saveProfile(mine);
    useShiftStore.getState().setDefaultProfile(mine.id);
    await flush();
    expect(await repo.getSetting(db, 'defaultProfileId', '')).toBe(mine.id);

    await useShiftStore.getState().deleteProfile(mine.id);
    const s = useShiftStore.getState();
    expect(s.profiles.map((p) => p.id)).toEqual(['server-default', 'bartender-default']);
    expect(s.settings.defaultProfileId).toBe('bartender-default');
    expect(s.draft.profileId).toBe('bartender-default');
    expect(await repo.getSetting(db, 'defaultProfileId', '')).toBe('bartender-default');
    // Now bartender-default is the last bartender profile again.
    await expectStoreError(s.deleteProfile('bartender-default'), 'LAST_PROFILE_FOR_ROLE');
  });

  it('reset restores a built-in profile', async () => {
    const db = await hydrated();
    const st = useShiftStore.getState();
    await st.saveProfile({ ...SERVER_DEFAULT_PROFILE, totalTipOutPercentOfTips: 20 });
    await st.resetProfile('server-default');
    expect(await repo.getProfile(db, 'server-default')).toEqual(SERVER_DEFAULT_PROFILE);
    await expectStoreError(st.resetProfile('nope'), 'NOT_BUILT_IN');
  });

  it('#21: wholeDollarShares setting drives roundMemberShares', async () => {
    const db = await hydrated();
    useShiftStore.getState().setWholeDollarShares(false);
    await flush();
    expect(await repo.getSetting(db, 'wholeDollarShares', true)).toBe(false);
    const st = useShiftStore.getState();
    st.setMoney('totalTips', 34056);
    st.setMoney('netSales', 156025);
    st.setMoney('foodSales', 70012);
    st.addMember('barback', 'David');
    st.addMember('barback', 'Allen');
    const state = useShiftStore.getState();
    const profile = selectProfile(state);
    const input = buildShiftInput(state.draft, profile);
    const { result } = calculateShift(input, profile, engineOptions(state.settings));
    const barbacks = result.roles.find((r) => r.role === 'barback')!;
    expect(barbacks.members.map((m) => m.amount)).not.toContain(0);
    expect(barbacks.members[0]!.amount % 100).not.toBe(0);
  });

  it('coworkers: rename refuses duplicates, change role, delete', async () => {
    const db = await hydrated();
    await repo.rememberTeam(
      db,
      [
        { id: '1', name: 'Sam', role: 'barback' },
        { id: '2', name: 'Kim', role: 'host' },
      ],
      '2026-11-20',
    );
    await useShiftStore.getState().hydrate(db);
    const st = useShiftStore.getState();
    const sam = st.coworkers.find((c) => c.name === 'Sam')!;
    await expectStoreError(st.renameCoworker(sam.id, ' kim '), 'COWORKER_NAME_TAKEN');
    await expectStoreError(st.renameCoworker(sam.id, '  '), 'COWORKER_NAME_REQUIRED');
    await st.renameCoworker(sam.id, 'Samantha');
    await useShiftStore.getState().setCoworkerRole(sam.id, 'host');
    expect((await repo.listCoworkers(db)).find((c) => c.id === sam.id)).toEqual(
      expect.objectContaining({ name: 'Samantha', usualRole: 'host' }),
    );
    await useShiftStore.getState().deleteCoworker(sam.id);
    expect(useShiftStore.getState().coworkers.map((c) => c.name)).toEqual(['Kim']);
  });

  it('onboarding: fresh installs see it; installs with shifts skip it and are marked onboarded', async () => {
    const db = await hydrated();
    expect(needsOnboarding(useShiftStore.getState())).toBe(true);
    useShiftStore.getState().chooseOnboardingRole('bartender');
    useShiftStore.getState().finishOnboarding();
    await flush();
    expect(needsOnboarding(useShiftStore.getState())).toBe(false);
    expect(await repo.getSetting(db, 'defaultProfileId', '')).toBe('bartender-default');
    expect(await repo.getSetting(db, 'onboarded', false)).toBe(true);

    const old = await createTestDb();
    await initDb(old);
    const input = buildShiftInput(useShiftStore.getState().draft, SERVER_DEFAULT_PROFILE);
    await repo.saveShift(old, {
      input,
      result: calculateShift(input, SERVER_DEFAULT_PROFILE).result,
    });
    useShiftStore.setState(useShiftStore.getInitialState(), true);
    await useShiftStore.getState().hydrate(old);
    expect(needsOnboarding(useShiftStore.getState())).toBe(false);
    expect(await repo.getSetting(old, 'onboarded', false)).toBe(true);
  });

  it('switching to a server profile drops the auto-added "Me"', async () => {
    await hydrated();
    useShiftStore.getState().setProfile('bartender-default');
    expect(useShiftStore.getState().draft.team).toHaveLength(1);
    useShiftStore.getState().setProfile('server-default');
    expect(useShiftStore.getState().draft.team).toEqual([]);
  });
});
