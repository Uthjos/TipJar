/**
 * Profile editor validation (docs/m5-contract.md). Errors block saving; warnings are shown but
 * allow saving. Anything error-free here is accepted by `calculateShift`'s profile checks.
 */
import type { TipOutProfile } from '@/engine/types';

import { displayRole } from './profiles';

export type ProfileIssueCode =
  | 'NAME_REQUIRED'
  | 'NAME_TAKEN'
  | 'POOL_PERCENT_RANGE'
  | 'NO_RULES'
  | 'NO_SHARE_RULE'
  | 'RULE_ROLE_REQUIRED'
  | 'DUPLICATE_ROLE'
  | 'RULE_PERCENT_RANGE'
  | 'RULE_WEIGHT_POSITIVE'
  | 'BARTENDER_RULE_IN_BARTENDER_PROFILE'
  | 'SELF_TIP_OUT';

export type ProfileIssue = {
  code: ProfileIssueCode;
  severity: 'error' | 'warning';
  /** Set for rule-level issues. */
  ruleIndex?: number;
  /** Plain English, shown in the editor. */
  message: string;
};

function nameKey(name: string): string {
  return name.trim().normalize('NFC').toLocaleLowerCase();
}

function inRange(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

/**
 * Check a profile. Issues come in a stable order: profile-level first, then by rule index.
 * `others` are the other saved profiles (the profile itself, by id, is ignored for NAME_TAKEN).
 */
export function checkProfile(p: TipOutProfile, others: TipOutProfile[]): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  const error = (code: ProfileIssueCode, message: string, ruleIndex?: number) =>
    issues.push(
      ruleIndex === undefined
        ? { code, severity: 'error', message }
        : { code, severity: 'error', ruleIndex, message },
    );

  // --- profile level ---------------------------------------------------------
  const name = p.name.trim();
  if (!name) {
    error('NAME_REQUIRED', 'Give the profile a name.');
  } else if (others.some((o) => o.id !== p.id && nameKey(o.name) === nameKey(name))) {
    error('NAME_TAKEN', `Another profile is already called "${name}".`);
  }
  if (!inRange(p.totalTipOutPercentOfTips)) {
    error('POOL_PERCENT_RANGE', 'The tip-out percentage must be between 0 and 100.');
  }
  if (p.rules.length === 0) {
    error('NO_RULES', 'Add at least one role to tip out.');
  } else if (!p.rules.some((r) => r.type === 'shareOfRemainder')) {
    issues.push({
      code: 'NO_SHARE_RULE',
      severity: 'warning',
      message:
        'No role takes a share of what is left, so anything after the fixed amounts is not paid out.',
    });
  }

  // --- rule level ------------------------------------------------------------
  const seen = new Set<string>();
  p.rules.forEach((rule, i) => {
    const role = rule.role.trim();
    const who = displayRole(rule) || `Role ${i + 1}`;
    if (!role) {
      error('RULE_ROLE_REQUIRED', `Role ${i + 1} needs a name.`, i);
    } else if (seen.has(role)) {
      error('DUPLICATE_ROLE', `${who} is listed more than once.`, i);
    } else {
      seen.add(role);
    }
    if (role === 'bartender' && p.appliesTo === 'bartender') {
      error(
        'BARTENDER_RULE_IN_BARTENDER_PROFILE',
        'A bartender profile cannot tip out bartenders — the bar keeps its tips and splits them among the bartenders.',
        i,
      );
    }
    if (role === 'server' && p.appliesTo === 'server') {
      error(
        'SELF_TIP_OUT',
        'A server profile cannot tip out servers (that would be tipping yourself).',
        i,
      );
    }
    if (rule.type === 'percentOfBasis') {
      if (!inRange(rule.percent)) {
        error('RULE_PERCENT_RANGE', `${who}: the percentage must be between 0 and 100.`, i);
      }
    } else if (!(Number.isFinite(rule.weight) && rule.weight > 0)) {
      error('RULE_WEIGHT_POSITIVE', `${who}: the share must be more than 0.`, i);
    }
  });

  return issues;
}

/** True when `issues` contains an error (saving is blocked). */
export function hasErrors(issues: ProfileIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
