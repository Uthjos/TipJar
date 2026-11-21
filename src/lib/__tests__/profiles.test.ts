/**
 * Milestone 5 acceptance: pure profile helpers (docs/m5-contract.md "Pure helpers").
 */
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '../../engine/profiles';
import type { TipOutProfile, TipOutRule } from '../../engine/types';
import {
  addRule,
  builtInProfile,
  displayRole,
  isBuiltInProfile,
  moveRule,
  newProfile,
  profileSummary,
  removeRule,
  roleIdFromLabel,
  updateRule,
} from '../profiles';
import { deepFreeze } from '../../test-support/builders';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A frozen editor-style profile with labelled custom roles. */
function sample(): TipOutProfile {
  return deepFreeze<TipOutProfile>({
    id: 'p1',
    name: 'Patio',
    appliesTo: 'server',
    totalTipOutPercentOfTips: 25,
    poolBasis: 'netSales',
    rules: [
      { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 },
      { role: 'busser', label: 'Busser', type: 'shareOfRemainder', weight: 2 },
      { role: 'bartender', type: 'shareOfRemainder', weight: 4 },
      { role: 'food-runner', label: 'Food Runner', type: 'shareOfRemainder', weight: 1 },
    ],
  });
}
const roles = (p: TipOutProfile) => p.rules.map((r) => r.role);

// ---------------------------------------------------------------------------

describe('roleIdFromLabel', () => {
  it.each([
    ['Barbacks', 'barback'],
    ['Barback', 'barback'],
    ['barbacks', 'barback'],
    ['  HOST ', 'host'],
    ['Host', 'host'],
    ['Hosts', 'host'],
    ['Bartender', 'bartender'],
    ['Bartenders', 'bartender'],
    ['Kitchen', 'kitchen'],
    ['Server', 'server'],
    ['Servers', 'server'],
  ])('built-in label %p -> %p', (label, id) => {
    expect(roleIdFromLabel(label)).toBe(id);
  });

  it('maps the built-in display label "Kitchen (KTO)" back to kitchen', () => {
    // ASSUMPTION (findings #56): roleLabel('kitchen') is "Kitchen (KTO)", so typing the label
    // the app itself shows must not create a separate "kitchen-kto" role.
    expect(roleIdFromLabel('Kitchen (KTO)')).toBe('kitchen');
  });

  it.each([
    ['Busser', 'busser'],
    ['BUSSER', 'busser'],
    ['  busser  ', 'busser'],
    ['Food Runner', 'food-runner'],
    ['Food   Runner', 'food-runner'],
    ['Food Runner!!', 'food-runner'],
    ['  Expo / Dish  ', 'expo-dish'],
    ['Sous--Chef', 'sous-chef'],
    ['--busser--', 'busser'],
    ["Hannah's crew", 'hannah-s-crew'],
    ['Runner 2', 'runner-2'],
    ['Bar Back', 'bar-back'],
  ])(
    'custom label %p -> %p (spaces/punctuation -> "-", repeats collapsed, ends stripped)',
    (label, id) => {
      expect(roleIdFromLabel(label)).toBe(id);
    },
  );

  it('is NFC-normalised: composed and decomposed accents give the same id', () => {
    const composed = 'Café Runner'; // é as one code point
    const decomposed = 'Café Runner'; // e + combining acute
    expect(roleIdFromLabel(composed)).toBe(roleIdFromLabel(decomposed));
    // ASSUMPTION (findings #55): letters with accents are kept, not stripped or replaced by '-'
    expect(roleIdFromLabel(composed)).toBe('café-runner');
    expect(roleIdFromLabel('CAFÉ')).toBe('café');
  });

  it.each([[''], ['   '], ['!!!'], ['- / -']])('empty after cleaning %p -> ""', (label) => {
    expect(roleIdFromLabel(label)).toBe('');
  });

  it('is idempotent on its own output', () => {
    for (const label of ['Food Runner!!', 'Barbacks', 'Café Runner', 'Sous--Chef']) {
      const id = roleIdFromLabel(label);
      expect(roleIdFromLabel(id)).toBe(id);
    }
  });
});

describe('displayRole', () => {
  it('uses the label when present', () => {
    expect(
      displayRole({ role: 'busser', label: 'Busser', type: 'shareOfRemainder', weight: 1 }),
    ).toBe('Busser');
    expect(
      displayRole({
        role: 'food-runner',
        label: 'Food Runner',
        type: 'shareOfRemainder',
        weight: 1,
      }),
    ).toBe('Food Runner');
  });

  it('falls back to the built-in role label', () => {
    expect(displayRole({ role: 'barback', type: 'shareOfRemainder', weight: 3 })).toBe('Barbacks');
    expect(displayRole({ role: 'bartender', type: 'shareOfRemainder', weight: 4 })).toBe(
      'Bartenders',
    );
    expect(displayRole({ role: 'host', type: 'shareOfRemainder', weight: 1 })).toBe('Hosts');
    expect(
      displayRole({ role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 }),
    ).toBe('Kitchen (KTO)');
  });

  it('title-cases a custom role id without a label', () => {
    expect(displayRole({ role: 'busser', type: 'shareOfRemainder', weight: 1 })).toBe('Busser');
  });
});

describe('newProfile', () => {
  it('copies the base with a new id and name, keeping appliesTo by default', () => {
    const base = sample();
    const p = newProfile(base, { id: 'p2', name: 'Patio copy' });
    expect(p).toEqual({ ...clone(base), id: 'p2', name: 'Patio copy' });
  });

  it('appliesTo can be overridden', () => {
    const p = newProfile(SERVER_DEFAULT_PROFILE, {
      id: 'b2',
      name: 'Mine',
      appliesTo: 'bartender',
    });
    expect(p.appliesTo).toBe('bartender');
    expect(p.rules).toEqual(SERVER_DEFAULT_PROFILE.rules);
  });

  it('is a deep copy: mutating the new profile never touches the base', () => {
    const before = JSON.stringify(SERVER_DEFAULT_PROFILE);
    const p = newProfile(SERVER_DEFAULT_PROFILE, { id: 'x', name: 'X' });
    expect(p.rules).not.toBe(SERVER_DEFAULT_PROFILE.rules);
    expect(p.rules[0]).not.toBe(SERVER_DEFAULT_PROFILE.rules[0]);
    p.rules.push({ role: 'busser', type: 'shareOfRemainder', weight: 1 });
    (p.rules[0] as { percent: number }).percent = 99;
    p.totalTipOutPercentOfTips = 1;
    expect(JSON.stringify(SERVER_DEFAULT_PROFILE)).toBe(before);
  });

  it('works on a deep-frozen base (never mutates its input)', () => {
    expect(() => newProfile(sample(), { id: 'y', name: 'Y' })).not.toThrow();
  });
});

describe('rule editing helpers return new objects and never mutate', () => {
  const busser: TipOutRule = { role: 'host', type: 'shareOfRemainder', weight: 1 };

  it('addRule appends at the end', () => {
    const p = sample();
    const q = addRule(p, busser);
    expect(q).not.toBe(p);
    expect(q.rules).toHaveLength(5);
    expect(q.rules[4]).toEqual(busser);
    expect(roles(p)).toEqual(['kitchen', 'busser', 'bartender', 'food-runner']);
  });

  it('addRule on a profile with no rules', () => {
    const p = deepFreeze({ ...clone(sample()), rules: [] as TipOutRule[] });
    expect(addRule(p, busser).rules).toEqual([busser]);
  });

  it('updateRule patches one rule (first and last index)', () => {
    const p = sample();
    const first = updateRule(p, 0, { percent: 3 });
    expect(first.rules[0]).toEqual({
      role: 'kitchen',
      type: 'percentOfBasis',
      basis: 'foodSales',
      percent: 3,
    });
    const last = updateRule(p, 3, { weight: 1.5, label: 'Runner' });
    expect(last.rules[3]).toEqual({
      role: 'food-runner',
      label: 'Runner',
      type: 'shareOfRemainder',
      weight: 1.5,
    });
    // untouched rules are equal; the original is unchanged
    expect(last.rules.slice(0, 3)).toEqual(p.rules.slice(0, 3));
    expect(p.rules[3]).toEqual({
      role: 'food-runner',
      label: 'Food Runner',
      type: 'shareOfRemainder',
      weight: 1,
    });
  });

  it('removeRule removes first, middle and last', () => {
    const p = sample();
    expect(roles(removeRule(p, 0))).toEqual(['busser', 'bartender', 'food-runner']);
    expect(roles(removeRule(p, 2))).toEqual(['kitchen', 'busser', 'food-runner']);
    expect(roles(removeRule(p, 3))).toEqual(['kitchen', 'busser', 'bartender']);
    expect(roles(p)).toHaveLength(4);
  });

  it('moveRule moves first->last, last->first, and up/down by one', () => {
    const p = sample();
    expect(roles(moveRule(p, 0, 3))).toEqual(['busser', 'bartender', 'food-runner', 'kitchen']);
    expect(roles(moveRule(p, 3, 0))).toEqual(['food-runner', 'kitchen', 'busser', 'bartender']);
    expect(roles(moveRule(p, 1, 2))).toEqual(['kitchen', 'bartender', 'busser', 'food-runner']);
    expect(roles(moveRule(p, 2, 1))).toEqual(['kitchen', 'bartender', 'busser', 'food-runner']);
  });

  it('moveRule to the same index returns an equal (new) profile', () => {
    const p = sample();
    const q = moveRule(p, 2, 2);
    expect(q).toEqual(p);
    expect(q).not.toBe(p);
  });

  it('moved rules keep their labels and numbers', () => {
    const q = moveRule(sample(), 3, 0);
    expect(q.rules[0]).toEqual({
      role: 'food-runner',
      label: 'Food Runner',
      type: 'shareOfRemainder',
      weight: 1,
    });
  });

  it('out-of-range indexes leave the rules unchanged and do not throw', () => {
    // ASSUMPTION (findings #57): the contract does not say; the editor never sends these.
    const p = sample();
    for (const q of [
      updateRule(p, 4, { weight: 9 }),
      updateRule(p, -1, { weight: 9 }),
      removeRule(p, 4),
      removeRule(p, -1),
      moveRule(p, 4, 0),
      moveRule(p, -1, 2),
    ]) {
      expect(q.rules).toEqual(p.rules);
    }
  });

  it('other profile fields are carried over unchanged', () => {
    const p = sample();
    for (const q of [
      addRule(p, busser),
      updateRule(p, 1, { weight: 5 }),
      removeRule(p, 1),
      moveRule(p, 0, 1),
    ]) {
      expect({ ...q, rules: [] }).toEqual({ ...clone(p), rules: [] });
    }
  });
});

describe('profileSummary', () => {
  it('Server default', () => {
    // contract example: "30% of tips · Kitchen 2% of food sales · Bartenders 4 : Barbacks 3 : Hosts 1"
    // (findings #56: whether the kitchen part reads "Kitchen" or "Kitchen (KTO)")
    expect(profileSummary(SERVER_DEFAULT_PROFILE)).toMatch(
      /^30% of tips · Kitchen( \(KTO\))? 2% of food sales · Bartenders 4 : Barbacks 3 : Hosts 1$/,
    );
  });

  it('Bartender default', () => {
    expect(profileSummary(BARTENDER_DEFAULT_PROFILE)).toMatch(
      /^30% of tips · Kitchen( \(KTO\))? 2% of food sales · Barbacks 3 : Hosts 1$/,
    );
  });

  it('net sales and food sales pool bases', () => {
    const p: TipOutProfile = {
      ...clone(SERVER_DEFAULT_PROFILE),
      totalTipOutPercentOfTips: 5,
      poolBasis: 'netSales',
      rules: [
        { role: 'bartender', type: 'shareOfRemainder', weight: 1 },
        { role: 'host', type: 'shareOfRemainder', weight: 1 },
      ],
    };
    expect(profileSummary(p)).toBe('5% of net sales · Bartenders 1 : Hosts 1');
    expect(profileSummary({ ...p, poolBasis: 'foodSales' })).toBe(
      '5% of food sales · Bartenders 1 : Hosts 1',
    );
    expect(profileSummary({ ...p, poolBasis: 'totalTips' })).toBe(
      '5% of tips · Bartenders 1 : Hosts 1',
    );
  });

  it('fractional numbers print without trailing zeros', () => {
    const p: TipOutProfile = {
      ...clone(SERVER_DEFAULT_PROFILE),
      totalTipOutPercentOfTips: 12.5,
      rules: [
        {
          role: 'busser',
          label: 'Busser',
          type: 'percentOfBasis',
          basis: 'netSales',
          percent: 1.25,
        },
        { role: 'bartender', type: 'shareOfRemainder', weight: 4.0 },
        { role: 'barback', type: 'shareOfRemainder', weight: 2.5 },
        { role: 'host', type: 'shareOfRemainder', weight: 0.75 },
      ],
    };
    expect(profileSummary(p)).toBe(
      '12.5% of tips · Busser 1.25% of net sales · Bartenders 4 : Barbacks 2.5 : Hosts 0.75',
    );
  });

  it('custom labels are shown as typed; totalTips basis reads "tips"', () => {
    const p: TipOutProfile = {
      id: 'c',
      name: 'C',
      appliesTo: 'bartender',
      totalTipOutPercentOfTips: 20,
      rules: [
        { role: 'expo', label: 'Expo', type: 'percentOfBasis', basis: 'totalTips', percent: 3 },
        { role: 'barback', type: 'shareOfRemainder', weight: 3 },
        { role: 'food-runner', label: 'Food Runner', type: 'shareOfRemainder', weight: 1 },
      ],
    };
    expect(profileSummary(p)).toBe('20% of tips · Expo 3% of tips · Barbacks 3 : Food Runner 1');
  });

  it('a profile with only fixed rules has no share segment', () => {
    const p: TipOutProfile = {
      ...clone(SERVER_DEFAULT_PROFILE),
      rules: [{ role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 }],
    };
    expect(profileSummary(p)).toMatch(/^30% of tips · Kitchen( \(KTO\))? 2% of food sales$/);
  });
});

describe('built-in profiles', () => {
  it('isBuiltInProfile', () => {
    expect(isBuiltInProfile('server-default')).toBe(true);
    expect(isBuiltInProfile('bartender-default')).toBe(true);
    for (const id of ['', 'custom', 'Server-default', 'server-default ', 'server']) {
      expect(isBuiltInProfile(id)).toBe(false);
    }
  });

  it('builtInProfile returns the shipped values', () => {
    expect(builtInProfile('server-default')).toEqual(SERVER_DEFAULT_PROFILE);
    expect(builtInProfile('bartender-default')).toEqual(BARTENDER_DEFAULT_PROFILE);
    expect(builtInProfile('custom')).toBeNull();
  });

  it('builtInProfile returns a fresh copy every call', () => {
    const before = JSON.stringify(SERVER_DEFAULT_PROFILE);
    const a = builtInProfile('server-default')!;
    expect(a).not.toBe(SERVER_DEFAULT_PROFILE);
    a.name = 'changed';
    a.rules.length = 0;
    expect(builtInProfile('server-default')).toEqual(SERVER_DEFAULT_PROFILE);
    expect(JSON.stringify(SERVER_DEFAULT_PROFILE)).toBe(before);
  });
});
