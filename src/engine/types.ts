/**
 * Domain types for the TipJar calculation engine (CLAUDE.md §4).
 * Pure TypeScript — no React / Expo imports allowed in src/engine.
 */

/** Integer number of cents. Never a floating-point dollar value. */
export type Cents = number;

export type RoleId = 'bartender' | 'barback' | 'host' | 'kitchen' | 'server' | string; // custom roles allowed

export type UserRole = 'server' | 'bartender';

export type MissingRoleHandling = 'redistribute' | 'retain';

export interface ShiftInput {
  /** ISO date (yyyy-MM-dd). */
  date: string;
  userRole: UserRole;
  totalTips: Cents;
  netSales: Cents;
  foodSales: Cents;
  /** Coworkers on shift. Bartender flow: includes the user and the other bartenders sharing the bar's kept tips. */
  team: TeamMember[];
  /** What to do with a role's share when nobody in that role worked. */
  missingRoleHandling: MissingRoleHandling;
  /** Which TipOutProfile to apply. */
  profileId: string;
  roundToDollar: boolean;
}

export interface TeamMember {
  id: string;
  name: string;
  role: RoleId;
  /** Total hours, OR clockIn/clockOut. */
  hours?: number;
  /** ISO datetime (or "HH:mm"). */
  clockIn?: string;
  /** ISO datetime (or "HH:mm"). Shifts past midnight are handled. */
  clockOut?: string;
  /** True for the app's user ("Me"); used by History to attribute earnings (owner Q9). */
  isUser?: boolean;
}

export type Basis = 'foodSales' | 'netSales' | 'totalTips';

/**
 * A rule either takes a fixed % of some basis (carved out of the pool first),
 * or takes a weighted share of whatever remains of the pool.
 */
export type TipOutRule =
  | { role: RoleId; type: 'percentOfBasis'; basis: Basis; percent: number }
  | { role: RoleId; type: 'shareOfRemainder'; weight: number };

export interface TipOutProfile {
  id: string;
  /** "Server default", "Bartender default", user-created... */
  name: string;
  appliesTo: UserRole;
  /** e.g. 30 -> 30% of the pool basis is the tip-out pool (name kept for compatibility). */
  totalTipOutPercentOfTips: number;
  /** What the pool % is taken of. Default 'totalTips' (owner Q4). Pool is capped at total tips. */
  poolBasis?: Basis;
  rules: TipOutRule[];
}

export interface MemberResult {
  memberId: string;
  name: string;
  /** Hours used for the split; 0 when nobody in the role entered hours (equal split). */
  hours: number;
  amount: Cents;
  percentOfTips: number;
}

/**
 * One entry per profile rule, in profile rule order (missing roles included).
 * Percentages are 0-100 and are 0 when the denominator (total tips / net sales) is 0.
 */
export interface RoleResult {
  role: RoleId;
  /** Paid amount; for a missing role: the retained share ('retain') or 0 ('redistribute'). */
  amount: Cents;
  percentOfTips: number;
  percentOfNetSales: number;
  members: MemberResult[];
  /** True when the role had nobody on shift. Kitchen is never missing. */
  missing?: boolean;
  /**
   * Whole dollars of this role's share held back by the odd-dollar tie rule (owner Q7); already
   * subtracted from `amount` and counted in `roundingAdjustment`. Set only when > 0.
   */
  heldBack?: Cents;
}

export interface KeptSplitEntry {
  memberId: string;
  name: string;
  hours: number;
  amount: Cents;
}

export interface ShiftResult {
  /** Total actually paid out to roles (excludes any retained share). */
  pool: Cents;
  /** Paid `pool` as % of total tips (0 when total tips is 0). */
  poolPercentOfTips: number;
  poolPercentOfNetSales: number;
  /** totalTips - pool (what the user / the bar keeps; includes retained + roundingAdjustment). */
  kept: Cents;
  /** Bartender flow: kept tips split among the bartenders on shift. */
  keptSplit?: KeptSplitEntry[];
  /**
   * Bartender flow: `kept - sum(keptSplit)`, the part of `kept` not shared out; stays with
   * whoever closes out. Under $1 with whole-dollar rounding, 0 when splitting to the cent, and
   * all of `kept` when no bartenders are listed (keptSplit []). Always 0 in the server flow.
   */
  keptChange: Cents;
  /**
   * Whole dollars of the bar's kept tips held back from `keptSplit` by the odd-dollar tie rule
   * (owner Q7); already included in `keptChange`. Set only when > 0.
   */
  keptHeldBack?: Cents;
  /** Share of absent roles kept back (missingRoleHandling = 'retain'). */
  retained: Cents;
  roles: RoleResult[];
  /**
   * How much rounding kept back (>= 0): pool cents trimmed by the floor + odd dollars held back
   * from role splits (§5.4).
   */
  roundingAdjustment: Cents;
}
