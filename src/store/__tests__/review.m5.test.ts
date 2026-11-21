/**
 * Milestone 5 decisions from the main-branch review (docs/review-log.md, round 5).
 * Finding numbers (#n) refer to docs/test-findings.md.
 */
import * as repo from '@/db/repositories';
import { initDb } from '@/db/seed';
import { createTestDb } from '@/db/testing/sqljsDb';
import type { Db } from '@/db/types';
import { needsOnboarding, StoreActionError, useShiftStore } from '@/store/shiftStore';

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

beforeEach(() => useShiftStore.setState(useShiftStore.getInitialState(), true));

describe('#65: the last profile for a role cannot switch roles', () => {
  it('refuses to turn the only bartender profile into a server profile', async () => {
    await hydrated();
    const bar = useShiftStore.getState().profiles.find((p) => p.id === 'bartender-default')!;
    await expectStoreError(
      useShiftStore.getState().saveProfile({ ...bar, appliesTo: 'server' }),
      'LAST_PROFILE_FOR_ROLE',
    );
  });

  it('allows it once another profile for that role exists', async () => {
    const db = await hydrated();
    const st = useShiftStore.getState();
    await st.saveProfile(st.createProfile('bartender'));
    const bar = useShiftStore.getState().profiles.find((p) => p.id === 'bartender-default')!;
    await useShiftStore
      .getState()
      .saveProfile({ ...bar, name: 'Old bar profile', appliesTo: 'server' });
    expect((await repo.getProfile(db, 'bartender-default'))!.appliesTo).toBe('server');
  });

  it('deleting the default falls back to the first remaining by name when no built-in is left', async () => {
    const db = await hydrated();
    const zed = {
      ...useShiftStore.getState().createProfile('bartender'),
      id: 'zed',
      name: 'Zed bar',
    };
    await useShiftStore.getState().saveProfile(zed);
    const amy = {
      ...useShiftStore.getState().createProfile('bartender'),
      id: 'amy',
      name: 'amy bar',
    };
    await useShiftStore.getState().saveProfile(amy);
    await useShiftStore.getState().deleteProfile('bartender-default');
    useShiftStore.getState().setDefaultProfile('zed');
    await useShiftStore.getState().deleteProfile('zed');
    expect(useShiftStore.getState().draft.profileId).toBe('amy');
    expect(await repo.getSetting(db, 'defaultProfileId', '')).toBe('amy');
  });
});

describe('#64: when onboarding shows', () => {
  it('not while loading or after a failed hydrate', () => {
    expect(useShiftStore.getState().status).toBe('loading');
    expect(needsOnboarding(useShiftStore.getState())).toBe(false);
    useShiftStore.getState().setLoadError('could not open the database');
    expect(needsOnboarding(useShiftStore.getState())).toBe(false);
  });

  it('a stored non-boolean "true" does not count as onboarded (strict === true)', async () => {
    const db = await createTestDb();
    await initDb(db);
    await repo.setSetting(db, 'onboarded', 'true');
    await useShiftStore.getState().hydrate(db);
    expect(needsOnboarding(useShiftStore.getState())).toBe(true);
  });
});
