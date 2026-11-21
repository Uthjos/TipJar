/**
 * Milestone 5 decisions from the main-branch review (docs/review-log.md, round 5).
 * Finding numbers (#n) refer to docs/test-findings.md.
 */
import { BARTENDER_DEFAULT_PROFILE, SERVER_DEFAULT_PROFILE } from '@/engine/profiles';
import type { TipOutProfile } from '@/engine/types';
import { checkProfile } from '@/lib/profileValidation';
import { displayRole } from '@/lib/profiles';

const copy = (p: TipOutProfile): TipOutProfile => JSON.parse(JSON.stringify(p));
const codes = (p: TipOutProfile, others: TipOutProfile[] = []) =>
  checkProfile(p, others).map((i) => [i.code, i.severity]);

describe('#58: a 0% pool is a warning', () => {
  it('POOL_PERCENT_ZERO (warning) at 0%, nothing at 100%', () => {
    expect(codes({ ...copy(SERVER_DEFAULT_PROFILE), totalTipOutPercentOfTips: 0 })).toEqual([
      ['POOL_PERCENT_ZERO', 'warning'],
    ]);
    expect(codes({ ...copy(SERVER_DEFAULT_PROFILE), totalTipOutPercentOfTips: 100 })).toEqual([]);
  });
});

describe('#59: NO_SHARE_RULE is suppressed when there are no rules', () => {
  it('reports only NO_RULES', () => {
    expect(codes({ ...copy(SERVER_DEFAULT_PROFILE), rules: [] })).toEqual([['NO_RULES', 'error']]);
  });
});

describe('#63: finite weights and NFC names', () => {
  it('rejects an Infinity weight', () => {
    const p = copy(BARTENDER_DEFAULT_PROFILE);
    p.rules = [p.rules[0]!, { role: 'barback', type: 'shareOfRemainder', weight: Infinity }];
    expect(codes(p)).toContainEqual(['RULE_WEIGHT_POSITIVE', 'error']);
  });

  it('composed and decomposed names collide (NAME_TAKEN)', () => {
    const a = { ...copy(SERVER_DEFAULT_PROFILE), id: 'a', name: 'Café' };
    const b = { ...copy(SERVER_DEFAULT_PROFILE), id: 'b', name: 'CAFÉ' };
    expect(codes(b, [a])).toContainEqual(['NAME_TAKEN', 'error']);
  });
});

describe('displayRole accepts a full rule (contract signature)', () => {
  it('works with a TipOutRule', () => {
    expect(
      displayRole({ role: 'busser', label: 'Busser', type: 'shareOfRemainder', weight: 1 }),
    ).toBe('Busser');
  });
});
