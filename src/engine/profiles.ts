import type { TipOutProfile } from './types';

/** Role ids used by the default profiles. */
export const ROLE_IDS = {
  kitchen: 'kitchen',
  bartender: 'bartender',
  barback: 'barback',
  host: 'host',
} as const;

/**
 * Server default (CLAUDE.md §4): pool = 30% of tips; kitchen = 2% of food sales carved out
 * first; remainder split bartenders 4 : barbacks 3 : hosts 1.
 */
export const SERVER_DEFAULT_PROFILE: TipOutProfile = {
  id: 'server-default',
  name: 'Server default',
  appliesTo: 'server',
  totalTipOutPercentOfTips: 30,
  rules: [
    { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 },
    { role: 'bartender', type: 'shareOfRemainder', weight: 4 },
    { role: 'barback', type: 'shareOfRemainder', weight: 3 },
    { role: 'host', type: 'shareOfRemainder', weight: 1 },
  ],
};

/**
 * Bartender default (CLAUDE.md §4): pool = 30% of tips; kitchen = 2% of food sales carved out
 * first; remainder split barbacks 3 : hosts 1. What the bar keeps is split among bartenders.
 */
export const BARTENDER_DEFAULT_PROFILE: TipOutProfile = {
  id: 'bartender-default',
  name: 'Bartender default',
  appliesTo: 'bartender',
  totalTipOutPercentOfTips: 30,
  rules: [
    { role: 'kitchen', type: 'percentOfBasis', basis: 'foodSales', percent: 2 },
    { role: 'barback', type: 'shareOfRemainder', weight: 3 },
    { role: 'host', type: 'shareOfRemainder', weight: 1 },
  ],
};

export const DEFAULT_PROFILES: readonly TipOutProfile[] = [
  SERVER_DEFAULT_PROFILE,
  BARTENDER_DEFAULT_PROFILE,
];

const ROLE_LABELS: Record<string, string> = {
  kitchen: 'Kitchen (KTO)',
  bartender: 'Bartenders',
  barback: 'Barbacks',
  host: 'Hosts',
  server: 'Servers',
};

const ROLE_SINGULAR: Record<string, string> = {
  kitchen: 'Kitchen',
  bartender: 'Bartender',
  barback: 'Barback',
  host: 'Host',
  server: 'Server',
};

/** Human-readable singular label, e.g. 'barback' -> "Barback". */
export function roleSingular(role: string): string {
  return ROLE_SINGULAR[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

/** Human-readable (plural) label for a role id; custom roles are title-cased. */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}
