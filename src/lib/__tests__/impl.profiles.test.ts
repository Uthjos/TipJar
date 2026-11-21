import { calculateShift } from '@/engine/calculate';
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '@/engine/profiles';
import type { ShiftInput, TipOutProfile } from '@/engine/types';
import { checkProfile, hasErrors } from '@/lib/profileValidation';
import {
  addRule,
  builtInProfile,
  displayRole,
  isBuiltInProfile,
  moveRule,
  newProfile,
  profileSummary,
  removeRule,
  renameRolePatch,
  roleIdFromLabel,
  roleNames,
  updateRule,
} from '@/lib/profiles';

describe('profile helpers', () => {
  it('roleIdFromLabel cleans names and maps built-in roles', () => {
    expect(roleIdFromLabel('  Bar   Porter!! ')).toBe('bar-porter');
    expect(roleIdFromLabel('Barbacks')).toBe('barback');
    expect(roleIdFromLabel('Host')).toBe('host');
    expect(roleIdFromLabel('Kitchen (KTO)')).toBe('kitchen');
    expect(roleIdFromLabel('Sommelier')).toBe('sommelier');
    expect(roleIdFromLabel(' -- ')).toBe('');
  });

  it('displayRole and roleNames use the label for custom roles', () => {
    expect(displayRole({ role: 'barback' })).toBe('Barbacks');
    expect(displayRole({ role: 'bar-porter', label: 'Bar Porter' })).toBe('Bar Porter');
    const p = addRule(SERVER_DEFAULT_PROFILE, {
      role: 'bar-porter',
      label: 'Bar Porter',
      type: 'shareOfRemainder',
      weight: 1,
    });
    expect(roleNames(p, 'bar-porter')).toEqual({ plural: 'Bar Porter', singular: 'Bar Porter' });
    expect(roleNames(p, 'host')).toEqual({ plural: 'Hosts', singular: 'Host' });
  });

  it('rule operations return new objects and never mutate', () => {
    const base = newProfile(SERVER_DEFAULT_PROFILE, { id: 'x', name: 'X' });
    const frozen = JSON.stringify(base);
    const moved = moveRule(base, 3, 0);
    expect(moved.rules.map((r) => r.role)).toEqual(['host', 'kitchen', 'bartender', 'barback']);
    const removed = removeRule(base, 0);
    expect(removed.rules).toHaveLength(3);
    const switched = updateRule(base, 1, { type: 'percentOfBasis', percent: 5 });
    expect(switched.rules[1]).toEqual({
      role: 'bartender',
      type: 'percentOfBasis',
      basis: 'foodSales',
      percent: 5,
    });
    expect(JSON.stringify(base)).toBe(frozen);
    expect(base.rules).not.toBe(SERVER_DEFAULT_PROFILE.rules);
    expect(newProfile(BARTENDER_DEFAULT_PROFILE, { id: 'y', name: 'Y' }).appliesTo).toBe(
      'bartender',
    );
  });

  it('profileSummary is one readable line', () => {
    expect(profileSummary(SERVER_DEFAULT_PROFILE)).toBe(
      '30% of tips · Kitchen 2% of food sales · Bartenders 4 : Barbacks 3 : Hosts 1',
    );
    expect(
      profileSummary({
        ...BARTENDER_DEFAULT_PROFILE,
        poolBasis: 'netSales',
        totalTipOutPercentOfTips: 4.5,
      }),
    ).toBe('4.5% of net sales · Kitchen 2% of food sales · Barbacks 3 : Hosts 1');
  });

  it('renameRolePatch: role fixed once created (#61); built-in names carry no label (#62)', () => {
    // New custom row being named: role follows the text; built-in names map to the built-in.
    expect(renameRolePatch({ role: '' }, 'Bar Porter', false)).toEqual({
      role: 'bar-porter',
      label: 'Bar Porter',
    });
    expect(renameRolePatch({ role: '' }, 'Bartenders', false)).toEqual({
      role: 'bartender',
      label: '',
    });
    expect(renameRolePatch({ role: 'bar-porter' }, 'Kitchen (KTO)', false)).toEqual({
      role: 'kitchen',
      label: '',
    });
    // Existing rule: renaming only changes the label.
    expect(renameRolePatch({ role: 'bar-porter' }, 'Runner', true)).toEqual({
      role: 'bar-porter',
      label: 'Runner',
    });
    expect(renameRolePatch({ role: 'barback' }, 'Bar helpers', true)).toEqual({
      role: 'barback',
      label: 'Bar helpers',
    });
    expect(renameRolePatch({ role: 'barback' }, 'Barbacks', true)).toEqual({
      role: 'barback',
      label: '',
    });
    // Applied through updateRule, an empty label removes it.
    const p = updateRule(
      SERVER_DEFAULT_PROFILE,
      2,
      renameRolePatch({ role: 'barback' }, 'Barback', true),
    );
    expect(p.rules[2]).toEqual(SERVER_DEFAULT_PROFILE.rules[2]);
  });

  it('built-in profiles', () => {
    expect(isBuiltInProfile('server-default')).toBe(true);
    expect(isBuiltInProfile('custom')).toBe(false);
    const copy = builtInProfile('bartender-default')!;
    expect(copy).toEqual(BARTENDER_DEFAULT_PROFILE);
    expect(copy).not.toBe(BARTENDER_DEFAULT_PROFILE);
    expect(builtInProfile('nope')).toBeNull();
  });
});

describe('checkProfile', () => {
  it('accepts the defaults', () => {
    expect(checkProfile(SERVER_DEFAULT_PROFILE, [BARTENDER_DEFAULT_PROFILE])).toEqual([]);
  });

  it('reports issues in a stable order with rule indexes', () => {
    const bad: TipOutProfile = {
      id: 'b',
      name: ' server DEFAULT ',
      appliesTo: 'bartender',
      totalTipOutPercentOfTips: 120,
      rules: [
        { role: 'bartender', type: 'shareOfRemainder', weight: 0 },
        { role: '', type: 'percentOfBasis', basis: 'foodSales', percent: 101 },
        { role: 'bartender', type: 'shareOfRemainder', weight: 1 },
      ],
    };
    const issues = checkProfile(bad, [SERVER_DEFAULT_PROFILE]);
    expect(issues.map((i) => [i.code, i.ruleIndex])).toEqual([
      ['NAME_TAKEN', undefined],
      ['POOL_PERCENT_RANGE', undefined],
      ['BARTENDER_RULE_IN_BARTENDER_PROFILE', 0],
      ['RULE_WEIGHT_POSITIVE', 0],
      ['RULE_ROLE_REQUIRED', 1],
      ['RULE_PERCENT_RANGE', 1],
      ['DUPLICATE_ROLE', 2],
      ['BARTENDER_RULE_IN_BARTENDER_PROFILE', 2],
    ]);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('NO_RULES is an error, NO_SHARE_RULE a warning, SELF_TIP_OUT an error', () => {
    const empty = { ...SERVER_DEFAULT_PROFILE, id: 'e', name: 'E', rules: [] };
    expect(checkProfile(empty, []).map((i) => i.code)).toEqual(['NO_RULES']);
    const fixedOnly = {
      ...SERVER_DEFAULT_PROFILE,
      id: 'f',
      name: 'F',
      rules: [SERVER_DEFAULT_PROFILE.rules[0]!],
    };
    const issues = checkProfile(fixedOnly, []);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'NO_SHARE_RULE', severity: 'warning' }),
    ]);
    expect(hasErrors(issues)).toBe(false);
    const self = addRule(fixedOnly, { role: 'server', type: 'shareOfRemainder', weight: 1 });
    expect(checkProfile(self, []).map((i) => i.code)).toEqual(['SELF_TIP_OUT']);
  });

  it('error-free custom profiles calculate without throwing', () => {
    const custom: TipOutProfile = {
      id: 'c',
      name: 'Patio',
      appliesTo: 'server',
      totalTipOutPercentOfTips: 3,
      poolBasis: 'netSales',
      rules: [
        {
          role: 'bar-porter',
          label: 'Bar Porter',
          type: 'percentOfBasis',
          basis: 'totalTips',
          percent: 5,
        },
        { role: 'busser', label: 'Busser', type: 'shareOfRemainder', weight: 2.5 },
      ],
    };
    expect(hasErrors(checkProfile(custom, []))).toBe(false);
    const input: ShiftInput = {
      date: '2026-11-20',
      userRole: 'server',
      totalTips: 30000,
      netSales: 150000,
      foodSales: 60000,
      team: [
        { id: '1', name: 'Pat', role: 'bar-porter' },
        { id: '2', name: 'Bo', role: 'busser' },
      ],
      missingRoleHandling: 'retain',
      profileId: 'c',
      roundToDollar: true,
    };
    const { result } = calculateShift(input, custom);
    expect(result.pool).toBe(4500);
  });
});
