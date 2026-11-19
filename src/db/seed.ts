import { DEFAULT_PROFILES } from '@/engine/profiles';

import { migrate } from './migrations';
import { saveProfile } from './repositories';
import type { Db } from './types';

/**
 * Insert the default Server / Bartender profiles, only when the profiles table is empty.
 * Idempotent and never overwrites a profile the user has edited.
 */
export async function seedDefaults(db: Db): Promise<void> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM profiles');
  if ((row?.n ?? 0) > 0) return;
  for (const profile of DEFAULT_PROFILES) await saveProfile(db, profile);
}

/** Migrate the schema, then seed defaults. Run once at app start. */
export async function initDb(db: Db): Promise<void> {
  await migrate(db);
  await seedDefaults(db);
}
