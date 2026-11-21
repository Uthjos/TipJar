# Milestone 5 — Profiles & settings contract

Shared API between the Implementer (code) and the Tester (acceptance tests) for milestone 5
(CLAUDE.md §6 items 1 and 6, §9 step 5, features F3 and F5). Both build against this in parallel;
the Maintainer reconciles. Builds on milestone 4 (`docs/m4-contract.md`).

## Scope

- **Profile editor (F3):** create, duplicate, edit, delete and reset tip-out profiles: name, who it's
  for (server / bartender), pool % and pool basis (`poolBasis`, owner Q4), and rules — add / remove /
  reorder roles, fixed % of a basis (kitchen-style) or weighted share of the remainder, custom roles.
- **Settings (F5):** default rounding, default profile, whole-dollar shares per person, saved
  coworkers (rename, change usual role, delete).
- **Onboarding (§6.1):** first launch only — pick Server / Bartender, review that profile's numbers,
  optionally edit, done.
- Deferred findings from earlier rounds: #13d, #21, #44, #45, #50 (decisions below).
- Small fix: on **Who worked**, the last section must not sit behind the bottom "See tip-out" button
  (scroll padding).
- Not in scope: hours / clock-in UI (M6), History edit, charts, CSV (M7), #54 (moves to M7 with
  History edit).

## Type change — custom role labels

`TipOutRule` gains an optional display label (the engine ignores it):

```ts
type TipOutRule =
  | { role: RoleId; label?: string; type: 'percentOfBasis'; basis: Basis; percent: number }
  | { role: RoleId; label?: string; type: 'shareOfRemainder'; weight: number };
```

Built-in roles (`kitchen`, `bartender`, `barback`, `host`, `server`) have no label. Custom roles get
`role = roleIdFromLabel(label)` and keep `label` for display. Storage: `profile_rules` gains a
nullable `label` column (schema **v2**, a real migration from v1; existing data kept). A missing label
round-trips as absent, not `null`.

## Pure helpers — `src/lib/profiles.ts` (no React / DB imports)

```ts
roleIdFromLabel(label: string): RoleId
  // trim, NFC, lower-case, spaces/punctuation -> '-', collapse repeats, strip ends.
  // A label that maps to a built-in role id returns that id ("Barbacks" -> 'barback', "Host" -> 'host').
  // Empty after cleaning -> ''.

displayRole(rule: TipOutRule): string            // label if present, else roleLabel(rule.role)

newProfile(base: TipOutProfile, opts: { id: string; name: string; appliesTo?: UserRole }): TipOutProfile
  // deep copy of base with new id/name; appliesTo defaults to base's.

addRule(p, rule): TipOutProfile                  // appended at the end
updateRule(p, index, patch): TipOutProfile
removeRule(p, index): TipOutProfile
moveRule(p, from, to): TipOutProfile             // all return new objects; inputs never mutated

profileSummary(p: TipOutProfile): string
  // one line for lists, e.g. "30% of tips · Kitchen 2% of food sales · Bartenders 4 : Barbacks 3 : Hosts 1"
  // pool basis words: tips | net sales | food sales. Weights printed without trailing zeros.

isBuiltInProfile(id: string): boolean            // 'server-default' | 'bartender-default'
builtInProfile(id: string): TipOutProfile | null // fresh copy of the shipped default (for Reset)
```

## Validation — `src/lib/profileValidation.ts`

```ts
type ProfileIssue = {
  code:
    | 'NAME_REQUIRED' | 'NAME_TAKEN'
    | 'POOL_PERCENT_RANGE'
    | 'NO_RULES' | 'NO_SHARE_RULE'
    | 'RULE_ROLE_REQUIRED' | 'DUPLICATE_ROLE'
    | 'RULE_PERCENT_RANGE' | 'RULE_WEIGHT_POSITIVE'
    | 'BARTENDER_RULE_IN_BARTENDER_PROFILE'   // #13d
    | 'SELF_TIP_OUT';                         // a 'server' rule in a server profile
  severity: 'error' | 'warning';
  ruleIndex?: number;                         // set for rule-level issues
  message: string;                            // plain English, shown in the editor
};

checkProfile(p: TipOutProfile, others: TipOutProfile[]): ProfileIssue[]
```

- Errors block saving; warnings are shown but allow saving.
- `NAME_TAKEN`: another profile (different id) has the same name, compared trim + case-insensitive.
- `POOL_PERCENT_RANGE`, `RULE_PERCENT_RANGE`: must be finite and 0–100. `RULE_WEIGHT_POSITIVE`: > 0.
- `NO_RULES` (error): zero rules. `NO_SHARE_RULE` (**warning**): no `shareOfRemainder` rule, so the
  remainder of the pool is not paid out.
- `DUPLICATE_ROLE`: same role id twice (also catches "Busser" + "busser"); reported on the later rule.
- `BARTENDER_RULE_IN_BARTENDER_PROFILE`, `SELF_TIP_OUT`: errors.
- Issues are returned in a stable order: profile-level first, then by `ruleIndex`.
- Anything `checkProfile` reports as error-free must not make `calculateShift` throw for a valid shift.

## Store & repository behaviour

- `saveProfile` refuses (throws / returns an error) if `checkProfile` has errors.
- **#44 — deleting:** a profile can be deleted unless it is the **last profile for its `appliesTo`**
  (the app always keeps at least one server and one bartender profile). Deleting the current
  default profile resets `defaultProfileId` to the remaining profile for that role (built-in first).
  Saved shifts are unaffected (snapshots).
- **Reset** (built-in profiles only): restores the shipped values, keeps the id.
- **#21 — setting name:** the user-facing setting is **"Whole-dollar shares for each person"**,
  settings key `wholeDollarShares` (boolean, default `true`). The store passes it to
  `calculateShift` as `roundMemberShares`. Engine option name unchanged. Has no effect when rounding
  is off (the toggle is shown disabled with a hint).
- **#45 / #50 — coworkers:** matching stays by normalised name across roles (a person is a person;
  `usualRole` follows their latest shift, per M4 #48). Within one team, if the same name appears
  twice, `rememberTeam` remembers the first occurrence only. Settings lets the user rename, change
  usual role, and delete coworkers; renaming to an existing coworker's name is refused.
- **Onboarding:** settings key `onboarded` (boolean). Shown when `onboarded` is not true **and**
  there are no saved shifts (existing installs that already have shifts skip it and get
  `onboarded = true` set on hydrate). Choosing a role sets `defaultProfileId` to that role's
  built-in profile.
