# Main-branch review log

Maintainer: Agent 3. Date: 2026-11-18. Branch: `main` (no remote; nothing pushed).

## 1. Merges

| Step                          | Commit    | What                                                                                                                                                 |
| ----------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merge `feat/core` (--no-ff)   | `0e85081` | Expo SDK 58 scaffold, engine (`src/engine/*`), in-memory New Shift → Who worked → Results flow.                                                      |
| Tooling                       | `532f9ec` | `.gitignore`: `.claude/worktrees/`.                                                                                                                  |
| Tooling                       | `b695d94` | Jest, ESLint, tsc and Prettier now skip `.claude/` (agent worktrees hold full repo copies; Jest and ESLint were picking up their tests and failing). |
| Merge `test/engine` (--no-ff) | `d4fdb18` | Tester's acceptance suite, builders, `docs/test-findings.md`.                                                                                        |
| Style                         | `5551541` | Mechanical only: `prettier --write` on 4 tester files; `import * as fc from 'fast-check'` (cleared 71 `import/no-named-as-default-member` warnings). |
| Triage                        | `24d5ba3` | Two failing tests resolved (D1).                                                                                                                     |
| Findings                      | `9cefaaa` | Engine changes for accepted findings + `review.test.ts`.                                                                                             |

After the `feat/core` merge (before `test/engine`): 23 tests / 4 suites passed, lint and typecheck clean.
After merging `test/engine` with no changes: **168 passed, 2 failed** (170 total). Typecheck clean; lint 0 errors / 71 warnings; Prettier flagged 4 files.

## 2. Triage of failing tests

| Test                                                                                                                                     | Category          | Resolution                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hours › memberHours › returns undefined when only clockIn or only clockOut is given`                                                    | (c) judgment call | Implementation throws `INVALID_CLOCK`; tester expected `undefined`. Kept the implementation (D1). Test now asserts `INVALID_CLOCK`.                              |
| `calculate › hours: partial hours block calculation › throws PARTIAL_HOURS when a half-entered clock pair leaves a member without hours` | (c) judgment call | Same root cause. Both readings block the calculation; only the code differs. Test now expects `INVALID_CLOCK`, and a new test covers the case that motivated D1. |

Summary: 0 implementation bugs, 0 test bugs (wrong hand math), 2 judgment calls with one root cause. Every other expected value the tester worked out by hand matched the implementation, including both goldens, rounding off, the 5038/3779 redistribute order (#8), half-up pool rounding (#2), and all 400-run fast-check properties.

### Decisions

- **D1. A half-entered clock pair is `INVALID_CLOCK`.** Under the tester's reading (`undefined` = no hours), a member with only a clock-in, whose role-mates also have no hours, would silently fall back to an equal split and ignore what the user typed. §5.1 step 4 says to block and ask the user to finish entering hours. Throwing always blocks, and the message ("needs both a clock-in and a clock-out time") tells the user what to fix. Added test: `calculate › … for a half-entered clock pair even when nobody else has hours`.
- **D2. `clockIn === clockOut` is `INVALID_CLOCK` (finding #6a).** Previously it was a 24h shift. §5.3 allows an earlier clock-out to mean the next day. A zero-length pair is almost always a typo, and weighting it as 24h would badly skew a by-hours split. `hours.test.ts` was updated with this reason.
- **D3. Redistribute order of operations (#8):** the remainder is split over the weights of the present roles in a single largest-remainder allocation (reading (a)). The implementation already did this.
- **D4. Unstaffed non-kitchen `percentOfBasis` roles are "missing" (#12).** Before, a custom carve-out such as "busser 1% of net sales" with no busser on shift was added to `pool` and paid to nobody. Now:
  - With `retain`, its amount goes to `retained`.
  - With `redistribute`, it carves nothing and the money stays in the remainder for the staffed share roles.
  - Kitchen is still never missing (§5.1).

## 3. Findings disposition (`docs/test-findings.md`)

| #   | Finding                                               | Disposition                                                                       | Notes                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Golden 1 `kept` = 23856, not 24056                    | **Accepted**                                                                      | Tests assert 23856, and the implementation already returns it. Nothing was hard-coded.                                                                                                                                                                                                                                                                                        |
| 2   | Unrounded pool rounds half-up to the cent             | **Accepted** (already implemented)                                                | `Math.round(totalTips × pct / 100)`, capped at total tips. Golden 2 `roundingAdjustment` = 77.                                                                                                                                                                                                                                                                                |
| 3   | Rounding individual member shares                     | **Owner decision needed** (§11 Q1)                                                | Kept `roundMemberShares` off by default. It only applies when rounding is on and never to `keptSplit`. Both settings are tested.                                                                                                                                                                                                                                              |
| 4   | Leftover cents stay with the bar ($149.55)            | **Owner decision needed** (§11 Q2)                                                | Kept cent-exact `kept = tips − pool`. If the owner wants $149, change the display layer only.                                                                                                                                                                                                                                                                                 |
| 5   | Default for a missing role lives in the store         | **Accepted** (already implemented) / default value is **owner decision** (§11 Q3) | `shiftStore` defaults to `'redistribute'`, and the engine requires the field.                                                                                                                                                                                                                                                                                                 |
| 6a  | `clockOut === clockIn` → 24h                          | **Accepted** (changed)                                                            | D2: now `INVALID_CLOCK`.                                                                                                                                                                                                                                                                                                                                                      |
| 6b  | `INVALID_CLOCK` meaning                               | **Accepted**                                                                      | Documented in `errors.ts`: unparseable value, half-entered pair, zero-length pair, or negative/non-finite hours.                                                                                                                                                                                                                                                              |
| 6c  | DST and timezone-less ISO times                       | **Accepted, deferred to milestone 6 (hours UI)**                                  | The UI must store clock times with an offset, or as `HH:mm`, which is DST-proof. No clock UI exists yet.                                                                                                                                                                                                                                                                      |
| 6d  | Negative hours                                        | **Accepted** (already implemented)                                                | `INVALID_CLOCK`. Tests added for -1, NaN and Infinity.                                                                                                                                                                                                                                                                                                                        |
| 7   | Every member of a role at 0 hours                     | **Accepted** (already implemented)                                                | Falls back to an equal split. Test added.                                                                                                                                                                                                                                                                                                                                     |
| 8   | Redistribute order of operations                      | **Accepted** (already implemented)                                                | D3.                                                                                                                                                                                                                                                                                                                                                                           |
| 9   | Redistribute with no recipients                       | **Accepted** (changed)                                                            | Already fell back to retaining. Now also warns `NO_REDISTRIBUTION_RECIPIENTS`. Test added.                                                                                                                                                                                                                                                                                    |
| 10  | Capping carve-outs that exceed the pool               | **Accepted** (already implemented)                                                | Capped proportionally against the exact pool (largest remainder at allocation). Warns when the uncapped sum is more than the pool. Documented in `errors.ts`.                                                                                                                                                                                                                 |
| 11  | Percentages on a zero denominator; % of the paid pool | **Accepted**                                                                      | Already 0 and paid pool. Documented in `types.ts`.                                                                                                                                                                                                                                                                                                                            |
| 12  | Is a fixed-% role with no members "missing"?          | **Accepted** (changed)                                                            | D4. Three tests added.                                                                                                                                                                                                                                                                                                                                                        |
| 13a | Team member whose role has no rule                    | **Accepted** (changed)                                                            | One aggregated `UNUSED_TEAM_MEMBERS` warning. Bartenders sharing kept tips and kitchen are excluded.                                                                                                                                                                                                                                                                          |
| 13b | Bartender flow with zero bartenders                   | **Rejected**                                                                      | Kept `keptSplit: []`. The Results screen already shows "Add the bartenders on shift (including you)…". A hard error would block a result that is otherwise valid (`kept` is still correct).                                                                                                                                                                                   |
| 13c | `profile.appliesTo` ≠ `userRole`                      | **Accepted** (changed)                                                            | Warns `PROFILE_ROLE_MISMATCH`. The UI derives `userRole` from the profile, so this only affects direct engine callers.                                                                                                                                                                                                                                                        |
| 13d | Bartender profile with a `bartender` rule             | **Accepted, deferred to milestone 5 (profile editor)**                            | The editor should reject it. The engine is unchanged.                                                                                                                                                                                                                                                                                                                         |
| 14  | Validation gaps                                       | **Partly accepted**                                                               | Duplicate rule roles → new `DUPLICATE_ROLE` validation error (accepted). Empty weights already throw, and `formatCents(-1234) === '-$12.34'` already held; tests added for both. **Rejected:** a new `INVALID_AMOUNT` code. Non-finite money already throws `NEGATIVE_AMOUNT`, and non-integer cents are rounded on purpose (the UI parses to integer cents). Tests pin this. |
| 15  | Order of roles; `hours` for equal-split members       | **Accepted** (already implemented)                                                | Roles follow profile rule order. Members report `hours: 0`. Documented in `types.ts`, test added.                                                                                                                                                                                                                                                                             |
| 16  | `instanceof EngineValidationError`                    | **Accepted** (already implemented)                                                | `Object.setPrototypeOf` and `name` are set.                                                                                                                                                                                                                                                                                                                                   |
| 17  | Jest and lint setup                                   | **Accepted** (already implemented)                                                | fast-check v4 is a devDependency and the v3-style API calls used work. Builders aren't matched by `testMatch`. Jest types are global. `no-non-null-assertion` isn't enabled.                                                                                                                                                                                                  |
| 18  | Floating-point weights                                | **Accepted** (no change needed)                                                   | Covered by tests.                                                                                                                                                                                                                                                                                                                                                             |
| 19  | Pool as a % of sales                                  | **Owner decision needed** (§11 Q4)                                                | Not implemented. Add `poolBasis` if the owner confirms.                                                                                                                                                                                                                                                                                                                       |

Counts (25 rows, with 6 and 13 split into sub-items): **Accepted 20** (13 already implemented or documentation only, 5 behaviour changes, 2 deferred to a later milestone), **Partly accepted 1** (#14), **Rejected 1** (#13b), **Owner decision needed 3** (#3, #4, #19). #5 is accepted for the engine/store split, but its default value is an owner question.

## 4. Owner decisions needed (current behaviour kept)

1. **§11 Q1, round member shares to whole dollars?** Current: off (members split to the cent; $16.50 / $16.50 and $20.50 / $20.50). `CalculateOptions.roundMemberShares` gives $21 / $20. Never applies to `keptSplit`. Should the bartenders' kept shares also be whole dollars?
2. **§11 Q2, leftover cents after flooring the pool.** Current: they stay with the bar or user ($149.55, Joseph $74.78 / Aaron $74.77). The source doc shows $149 and $74.50 each.
3. **§11 Q3, default for a missing role.** Current: `'redistribute'` (store default).
4. **§11 Q4, pool as a % of sales** (finding #19). Current: the pool is always a % of tips. Carve-outs can use any basis.
5. **Clock-in equal to clock-out** (D2) is now rejected rather than treated as 24h. Confirm there is no real 24h shift case.

## 5. Final check output (main @ HEAD)

- `npm test`: **10 suites, 189 tests passed, 0 failed**.
  - engine project: 9 suites, 186 tests.
  - ui project: 1 suite, 3 tests.
  - The tester's suite is 147 tests across `money`, `hours`, `calculate`, `golden` and `properties`. `calculate` gained one more test in triage. `review.test.ts` adds 18.
- `npm run lint`: 0 errors, 0 warnings.
- `npm run typecheck`: clean.
- `npx prettier --check .`: all files formatted.
- `git status`: clean (`.claude/worktrees/` ignored).

---

# Round 2: owner decisions

Main started at `dcaecaa`, which records the owner's answers in CLAUDE.md §4, §5.1, §5.4, §5.5, §5.6 and §11. I re-read those sections before merging.

## R2.1 Merges

| Step                                   | Commit    | What                                                                                                                                                                                                                     |
| -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Merge `feat/owner-decisions` (--no-ff) | `562cb17` | Whole-dollar member shares by default, `keptChange`, store default `'retain'`, `poolBasis` + `POOL_EXCEEDS_TIPS`, Results headline `kept − keptChange` + `changeNote()`, "Keep" listed first on the missing-role toggle. |
| Merge `test/owner-decisions` (--no-ff) | `c10bf70` | Acceptance suite updated for the owner decisions; findings #20–#30.                                                                                                                                                      |
| Engine                                 | `6597d9b` | #20 `keptChange` with no bartenders; tests for #20 and #24; #30 builder default.                                                                                                                                         |
| UI                                     | `b402d27` | History and share text use the Results headline amount; Settings labels the pool % with its basis (#27).                                                                                                                 |
| Spec                                   | `969e998` | CLAUDE.md wording clarifications (R2.4).                                                                                                                                                                                 |

Check results at each stage:

- After the `feat/owner-decisions` merge only: **179 passed, 17 failed** (196). All 17 were the old acceptance suite asserting cent-level defaults, which the owner has since replaced. The tester's branch updates them.
- After both merges: **224 passed, 0 failed**, lint, typecheck and Prettier all clean, no conflicts.

## R2.2 Triage

There was nothing to triage once both branches were merged.

The 17 interim failures were all category (b), tests encoding superseded decisions. The tester's own branch already fixed them, and no test was weakened. Finding #29 (implementer tests encoding the old defaults) was resolved by the implementer's branch, and `impl.golden.test.ts` passes.

Totals: 0 implementation bugs, 0 test bugs left after merge, 0 judgment calls among failures. One judgment call came out of the findings (#20, below).

## R2.3 Findings #20–#30

| #   | Finding                                                                | Disposition                                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20  | `keptChange` with zero bartenders                                      | **Accepted** (changed, judgment call)               | Before, it was `keptSplit: []` and `keptChange: 0`, which broke `sum(keptSplit) + keptChange == kept`. Now, in the bartender flow, `keptChange = kept − sum(keptSplit)` always holds; with no bartenders listed it equals `kept`. To avoid a surprising "Bar keeps $0", the UI uses `keptShown()`: whole dollars shared when `keptSplit` is non-empty, otherwise the full `kept`. The change note shows only when `kept` was actually shared out. The Results banner still prompts the user to add bartenders. Tested in the engine (rounding on and off) and in `src/lib/__tests__/format.test.ts`. The property `keptChange < 100` keeps its precondition (≥ 1 bartender), now commented. |
| 21  | One flag (`roundMemberShares`) controls member shares and `keptSplit`  | **Accepted, rename deferred to milestone 5**        | The coupling matches the owner's intent (Q1 + Q2) and is documented in `CalculateOptions` and §5.4. Rename it (e.g. `wholeDollarShares`) when the settings screen exposes it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 22  | Whole-dollar splits can give someone $0                                | **Owner decision needed**                           | Correct under the owner's rule. No engine change. Should tiny shifts get a note?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 23  | Whole-dollar ties always favour the first-listed member ($1 per shift) | **Owner decision needed**                           | Kept §5.2 "tie → earlier member" (the golden values depend on it). Alternatives are to rotate by date or give the odd dollar to the user.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 24  | `POOL_EXCEEDS_TIPS` in the half-cent band                              | **Accepted** (already implemented)                  | The engine compares the exact `basis × pct / 100` with total tips. Added a test (20000.05¢ vs 20000¢ warns). Wording added to §5.1 step 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 25  | The capped pool feeds everything downstream                            | **Accepted** (already implemented)                  | The cap replaces the exact pool before carve-outs, flooring and `roundingAdjustment`. Wording added to §5.1 step 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 26  | `POOL_EXCEEDS_TIPS` on every zero-tip shift with a sales pool          | **Rejected** (no change)                            | Engine warnings appear only on the Results screen, after the user taps through. The New Shift form shows only its own food > net check, so the warning isn't noisy while typing. On a real $0-tip shift the warning is accurate.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 27  | Pool % label with a sales basis                                        | **Accepted** (changed)                              | Settings hard-coded "% of total tips"; it now uses `basisLabel()` for the pool and the carve-outs. Results already shows computed % of tips and % of net sales. History and CSV labels are for milestone 7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 28  | Who gets `keptChange` in History                                       | **Owner decision needed**                           | History now shows the same figure as the Results headline (`kept − keptChange` when shared), and the change is not attributed to anyone. Whether the user's "earned" total includes the change depends on this decision. Persist `keptChange` in `shift_results` in milestone 4.                                                                                                                                                                                                                                                                                                                                                                                                            |
| 29  | `impl.golden.test.ts` encodes the old defaults                         | **Accepted** (resolved by the implementer's branch) | Passes after the merge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 30  | Builder default `'redistribute'` vs store `'retain'`                   | **Accepted** (changed)                              | `shiftInput()` now defaults to `'retain'`. No expectation changed, because every test with an unstaffed role passes the field explicitly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Counts (11 findings): **Accepted 8** (#20, #27 and #30 changed; #24, #25 and #29 already done or resolved; #21 documented now, rename deferred), **Rejected 1** (#26), **Owner decision needed 3** (#22, #23, #28). Note that #21 counts once, as accepted.

History vs Results: these are now consistent. Both use `keptShown()` from `src/lib/format.ts`, and so does the share text, which before used `kept − keptChange` directly and would have shown "Bar keeps $0.00" with no bartenders under the new #20 definition.

## R2.4 CLAUDE.md edits (wording only; owner decisions and golden values unchanged)

1. **§4 `keptChange` comment.** It said "bartender flow + rounding: … else 0", which contradicted the identity for an empty `keptSplit`. It now reads "bartender flow: kept − sum(keptSplit) (… all of kept if no bartenders listed); server flow: 0".
2. **§5.1 step 1.** Added that `POOL_EXCEEDS_TIPS` compares the exact value, and that the capped value is the pool for every later step (#24, #25).
3. **§5.4 step 5.** Added the no-bartenders case: `keptSplit` is empty and `keptChange = kept`, and the Results screen shows the full `kept` and prompts the user to add bartenders (#20).

## R2.5 Owner decisions still needed

1. **#23 tie-break bias.** With whole dollars, the first-listed member gets the odd $1 on every tied shift. Keep it, rotate it, or give it to the user?
2. **#22 $0 shares.** Is someone getting $0 on a tiny or short shift acceptable, and should it come with a note?
3. **#28 `keptChange` attribution.** Should the change count toward the user's earnings in History, or stay unattributed?
4. Still open from §11: Q5 receipt formats, Q6 cloud backup.

## R2.6 Final check output (main @ HEAD)

- `npm test`: **11 suites, 231 tests passed, 0 failed**.
  - engine project: 10 suites, 227 tests.
  - ui project: 1 suite, 4 tests.
  - Round 2 added 7 tests: 3 in `review.test.ts`, 4 in the new `src/lib/__tests__/format.test.ts`.
- `npm run lint`: 0 errors, 0 warnings.
- `npm run typecheck`: clean.
- `npx prettier --check .`: all files formatted.
- `git status`: clean.

---

# Round 3: owner decisions Q7–Q9

Main started at `57c4053`, which records the owner's answers Q7–Q10 in CLAUDE.md §4, §5.4 steps 4–5, §5.5, §5.6 and §11. I re-read those sections before merging.

## R3.1 Merges

| Step                                     | Commit    | What                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merge `feat/owner-decisions-2` (--no-ff) | `52723ec` | Adds `splitWholeDollars` and the hold-back accounting (`RoleResult.heldBack`, `ShiftResult.keptHeldBack`, both optional and set only when > 0), the `ZERO_SHARE_AFTER_ROUNDING` warning, `TeamMember.isUser`, and `userEarnings` in `src/lib/earnings.ts`. Results and the share text now explain held-back dollars, and History shows "You earned". The implementer's own tests were updated. |
| Merge `test/owner-decisions-2` (--no-ff) | `4518acc` | New `wholeDollars.test.ts`; rewritten golden, calculate, properties and review tests; findings #31–#39.                                                                                                                                                                                                                                                                                        |
| Engine                                   | `b964ce9` | #34: zero-share warning gated on having at least $1 to split.                                                                                                                                                                                                                                                                                                                                  |
| UI                                       | `c34838f` | #37: the floor trim and the tie-held dollars are shown as separate notes.                                                                                                                                                                                                                                                                                                                      |
| Spec                                     | `72f30eb` | CLAUDE.md wording clarifications (R3.4).                                                                                                                                                                                                                                                                                                                                                       |

I merged both branches back to back with no conflicts and ran the checks after both merges: **284 passed, 0 failed** (14 suites); lint, typecheck and Prettier were clean. I did not run the checks between the two merges.

## R3.2 Triage

Nothing failed after the merge. The tester's stub matched the real implementation on every expected value, including:

- the goldens (`pool` 10100 / 4200 / 5600, `roundingAdjustment` 117 / 177, Joseph and Aaron $75 / $75);
- the #31 no-hand-down rule;
- the #32 float-tie case.

#39 (5 implementer tests failing) had already been fixed on the implementer's branch.

One test changed as a result of accepting #34:

| Test                                                                                                    | Category                                            | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `impl.wholedollar › warns ZERO_SHARE_AFTER_ROUNDING for named $0 shares, only with whole-dollar splits` | (c) judgment call, decided by the coordinator (#34) | The test expected a warning with $3 tips, where the pool floors to $0, so there is nothing to split. That contradicts #34. I kept the test's intent (Hannah named, no warning with cent splits, none in Golden 1) by moving it to $10 tips: the pool is $3, the hosts' share rounds to $0, and Hannah gets $0. I also added an assertion that the $3 case does **not** warn. Not weakened: the test now asserts one more thing. |

Totals: 0 implementation bugs and 0 test bugs found by merging. 1 judgment call (#34), which needed an engine change and an update to an implementer test.

**#34 interpretation.** "At least $1 to split" is checked against the **floored pool** for role members and against `floorToDollar(kept)` for `keptSplit`, not against each role's own amount. With a per-role check, a host whose role share rounds to $0 out of a $3 pool would never be named, and that is exactly the case the owner's Q8 note is for. The tester's property ("always when a member got $0 of a non-empty split") still holds, because a non-empty role split implies a non-empty pool.

## R3.3 Findings #31–#39

| #   | Finding                                                         | Disposition                                         | Notes                                                                                                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 31  | Held dollars aren't passed down to a smaller remainder          | **Accepted** (already implemented)                  | `splitWholeDollars` stops handing out dollars as soon as a tied group can't be fully served. Spelled out in §5.4 step 4.4 with the $3 at 7:7:1 example.                                                                                                                                                                                                           |
| 32  | Float-safe tie detection                                        | **Accepted** (already implemented)                  | Remainders and hours are compared with EPS = 1e-9 in `splitWholeDollars`. Covered by the tester's 4:14:2 test. Documented in §5.4.                                                                                                                                                                                                                                |
| 33  | Zero-share warning names a $0 `keptSplit` bartender             | **Accepted** (already implemented)                  | Tested by the tester. Documented in §5.4.                                                                                                                                                                                                                                                                                                                         |
| 34  | Warn only when there was at least $1 to split                   | **Accepted** (changed)                              | Gated on the floored pool and on `floorToDollar(kept)` (see R3.2). Tests in `review.test.ts` and `impl.wholedollar.test.ts`.                                                                                                                                                                                                                                      |
| 35  | 'redistribute' = 'retain' + retained only holds for cent splits | **Accepted, documented only**                       | No engine change. Noted in §5.4. The property tests it with `roundMemberShares: false`.                                                                                                                                                                                                                                                                           |
| 36  | No zero-share warning with cent splits                          | **Accepted** (already implemented)                  | The warning only fires when whole-dollar member splits are on. Documented in §5.4.                                                                                                                                                                                                                                                                                |
| 37  | Show the floor trim and held dollars separately                 | **Accepted** (changed, small)                       | `roundingParts()` in `src/lib/format.ts`. Results: "Rounded down to the dollar — $0.17 stays with you." plus "$1.00 kept back from tied whole-dollar shares — stays with you.", with the per-role `heldBack` note kept. The share text does the same. `heldBack` and `keptHeldBack` stay optional; documented in `types.ts` and §5.4. Tested in `format.test.ts`. |
| 38  | Equal or no-hours splits always hold the odd dollar             | **Accepted, documented only. Owner awareness.**     | This follows from Q7. Documented in §5.4 as a consequence. Results already shows "$1.00 kept back — tied hours" on the role.                                                                                                                                                                                                                                      |
| 39  | Implementer tests encoding pre-Q7 values                        | **Accepted** (resolved on the implementer's branch) | All pass after the merge.                                                                                                                                                                                                                                                                                                                                         |

Counts (9 findings): **Accepted 9**. Two were behaviour changes (#34, #37), five were already implemented (#31, #32, #33, #36, #39), and two were documentation only (#35, #38). Nothing was rejected, and no new owner decision is needed. #38 is for owner awareness.

**History vs Results.** History now shows `userEarnings` ("You earned"), as Q9 asks. That is a different figure from the Results headline ("Bar keeps" = whole dollars shared), and that's intended: Results now also has a "Your share" line equal to `userEarnings`, so History matches that line. The fallback when no bartender has `isUser` is all of `kept`. The store always adds "Me" with `isUser` in the bartender flow, so the fallback only applies to direct engine callers or old data.

## R3.4 CLAUDE.md edits (wording only; owner decisions and golden values unchanged)

All of these are in §5.4 step 4:

1. **Step 4.4 (#31).** Held dollars are not handed down to smaller remainders or fewer hours. Added the example: $3 at 7:7:1 → $1 / $1 / $0, with $1 held.
2. **Tie tolerance (#32).** Remainders and hours are compared with a 1e-9 tolerance.
3. **Consequence (#38).** With equal hours or none entered, an odd dollar is always held back by the server or the bar. Example: Golden 1 barbacks.
4. **`ZERO_SHARE_AFTER_ROUNDING` (#33, #34, #36).** It names role members and `keptSplit` bartenders. It fires only when there was at least $1 to hand out (floored pool / `floorToDollar(kept)`), and never with cent splits.
5. **Notes and fields (#37).** Results and the share text show the floor trim and the held dollars separately. `heldBack` and `keptHeldBack` are present only when > 0.
6. **Identity (#35).** `pool(redistribute) = pool(retain) + retained(retain)` holds only with cent-level splits.

## R3.5 Owner awareness and decisions

- **Consequence of Q7 (#38), for the owner to know about.** Whenever coworkers in a role have equal hours (including the default of no hours entered), an odd dollar in their share is always held back by the server or the bar. Examples:
  - Golden 1 barbacks: $16 / $16 instead of the doc's $16.50 each.
  - Three hosts sharing $11: $3 / $3 / $3, with $2 held.

  This replaces the old bias toward the first-listed member with a bias toward the user. The user can keep up to (members − 1) dollars per role per shift. Results labels it "$1.00 kept back — tied hours" on the role.

- No new owner decisions are needed from #31–#39.
- Still open from §11: Q6 (cloud backup / accounts).

## R3.6 Final check output (main @ HEAD)

- `npm test`: **14 suites, 288 tests passed, 0 failed**.
  - engine project: 13 suites, 284 tests.
  - ui project: 1 suite, 4 tests.
  - Round 3 added 4 tests: 2 in `review.test.ts` and 2 in `format.test.ts`. One assertion was added to `impl.wholedollar.test.ts`.
- `npm run lint`: 0 errors, 0 warnings.
- `npm run typecheck`: clean.
- `npx prettier --check .`: all files formatted.
- `git status`: clean.

---

# Round 4: milestone 4

Main started at `6af76e5`. That commit added `docs/m4-contract.md`, the shared persistence API, after the GitHub `LICENSE` merge. I read the contract and CLAUDE.md §7 before merging. A remote `origin` now exists, and nothing was pushed.

## R4.1 Merges

| Step                                  | Commit    | What                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merge `feat/m4-persistence` (--no-ff) | `97420e1` | Adds `expo-sqlite`, plus `sql.js` as a devDependency. New `src/db/` files: types, migrations, seed, repositories, `testing/sqljsDb`, and `client` with the `fromExpoSqlite` adapter. The store now hydrates with loading and error states. Save and delete persist, `rememberTeam` runs on save, quick-add chips are added, and settings are persisted. |
| Merge `test/m4-persistence` (--no-ff) | `d3a653a` | Migrations, seed, repository and snapshot acceptance tests (85, written against a stub), `src/test-support/shiftFixtures.ts`, and findings #40–#54.                                                                                                                                                                                                     |
| Decisions                             | `24bbb40` | Repository changes for #41, #47, #48, #49 and #52, the test updates, `review.db.test.ts`, and the contract decisions section.                                                                                                                                                                                                                           |

After both merges, with `npm ci` run for the new dependencies:

- **385 passed, 0 failed** (20 suites).
- Lint, typecheck and Prettier clean.
- No merge conflicts.

## R4.2 Triage

Nothing failed after the merge. The tester's column-name guesses (#40) didn't cause failures, because the tests used `PRAGMA table_info` plus a name heuristic and the real columns (`total_tips`, `pool`, `kept_change`, …) matched it. As instructed, I still made the tests exact to the real schema (below).

Applying the decisions changed three tests:

| Test                                                              | Category                         | Resolution                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `impl.db › coworkers + settings › rememberTeam upserts by name …` | (c) judgment call, decided (#47) | This implementer test expected the later spelling ("aaron") to replace "Aaron". Under #47 the existing spelling is kept, so it now expects "Aaron". The test still checks everything else it did.                                                                                                   |
| `migrations › money is stored as INTEGER cents › *`               | (b) test-side guess (#40)        | The name-regex heuristic was replaced by the column list pinned in the contract. Two tests now check that every pinned money column exists and is declared `INTEGER`, and that every stored value in them is `integer`. This is stricter than before: the old test also accepted `null` and `text`. |
| `repositories › listProfiles: default profiles first …`           | (b) under-specified test (#53)   | It accepted either order of the two defaults. It now asserts `['server-default', 'bartender-default']`.                                                                                                                                                                                             |

Totals: 0 implementation bugs and 0 test bugs found by merging. 1 judgment call (#47), already decided by the coordinator. 2 tests were made stricter (#40, #53).

## R4.3 Findings #40–#54

| #   | Finding                                | Disposition                                              | Notes                                                                                                                                                                                                                               |
| --- | -------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 40  | Column names not in the contract       | **Accepted** (contract + tests)                          | The full v1 schema is now pinned in `docs/m4-contract.md`. Money columns: `shifts.total_tips/net_sales/food_sales` and `shift_results.pool/kept/kept_change/retained/rounding_adjustment`. The tests check them by name.            |
| 41  | `listShifts` ties; `savedAt` format    | **Accepted** (changed)                                   | Order is `date` DESC, `saved_at` DESC, `rowid` DESC (newest insert), then `id` DESC. `savedAt` is normalised through `toISOString()`, including caller-supplied values. Tests cover the tie, mixed formats and normalisation.       |
| 42  | `listCoworkers` order                  | **Accepted** (already implemented)                       | Never-worked coworkers sort last, then by name with `COLLATE NOCASE`. Added a mixed-case test.                                                                                                                                      |
| 43  | `updateShift` and `savedAt`            | **Accepted** (already implemented)                       | `id` and `savedAt` are kept. The tester's test covers it.                                                                                                                                                                           |
| 44  | Re-seed after every profile is deleted | **Deferred to M5**                                       | Contract behaviour is kept. The M5 editor should block deleting the last profile.                                                                                                                                                   |
| 45  | `rememberTeam` matches across roles    | **Deferred to M5**                                       | v1 matches by name only. M5 coworker management can add matching by (name, role) or a "different people" option.                                                                                                                    |
| 46  | Placeholder names                      | **Resolved** (implementer decision 4)                    | `saveShift(input, result, draft.team)` passes the team as typed. Unnamed members have blank names, which `rememberTeam` skips. Covered by `impl.persistence.test`.                                                                  |
| 47  | Which spelling wins                    | **Accepted** (changed)                                   | A name match keeps the existing spelling, and new names are stored trimmed. `upsertCoworker` with an explicit `id` renames. Tests added.                                                                                            |
| 48  | `lastWorked` moving backwards          | **Accepted** (changed; overrides implementer decision 3) | `lastWorked` becomes the later of the stored value and the shift date. `usualRole` only changes when the date is on or after the stored `lastWorked`. An older shift still adds coworkers who weren't saved yet. Three tests added. |
| 49  | Non-ASCII case folding                 | **Accepted** (changed, small)                            | `coworkerKey` is now `trim().normalize('NFC').toLocaleLowerCase()`, stored in `name_key`. Zoë, ZOË and a decomposed "Zoë" all match. Test added. No shipped data exists, so no migration was needed.                                |
| 50  | Duplicate names in one team            | **Deferred to M5**                                       | Tied to #45.                                                                                                                                                                                                                        |
| 51  | Optional fields absent, not null       | **Accepted** (holds)                                     | Snapshots round-trip through JSON. `poolBasis` and `lastWorked` are omitted when the column is NULL. The tester's snapshot tests pass. Stated in the contract.                                                                      |
| 52  | Settings edge cases                    | **Accepted** (changed)                                   | `setSetting(key, undefined)` deletes the row. A parse error already returned the fallback. Two tests added.                                                                                                                         |
| 53  | Order of the two defaults              | **Accepted** (test made specific)                        | Server default, then Bartender default (`DEFAULT_PROFILES` order).                                                                                                                                                                  |
| 54  | Shifts referencing a deleted profile   | **Deferred to M5**                                       | History Edit should fall back to the current default for the shift's `userRole` and tell the user.                                                                                                                                  |

Counts (15 findings):

- **Accepted 10:**
  - 5 changed: #41, #47, #48, #49, #52.
  - 3 already implemented or holding: #42, #43, #51.
  - 2 contract or test only: #40, #53.
- **Resolved 1:** #46.
- **Deferred to M5 4:** #44, #45, #50, #54.
- **Rejected 0.**

**Implementer decisions.** 1, 2, 4, 5 and 6 are kept: defaults first in built-in order, name-match `upsertCoworker` without an id, placeholders not remembered, chips only for profile roles, fire-and-forget settings writes. Decision 3 is replaced by #48.

## R4.4 Doc edits

- `docs/m4-contract.md`: added "Decisions (main-branch review, round 4)". It pins the schema and records #41, #42, #43, #46, #47, #48, #49, #51, #52 and #53, plus the M5 deferrals.
- CLAUDE.md: not edited this round.

## R4.5 Owner decisions

No new owner decisions. Still open from §11: Q6 (cloud backup / accounts).

## R4.6 Final check output (main @ HEAD)

- `npm test`: **21 suites, 398 tests passed, 0 failed**.
  - engine project: 20 suites, 392 tests.
  - ui project: 1 suite, 6 tests.
  - Round 4 added 13 tests: 12 in `src/db/__tests__/review.db.test.ts`, and the money-column test became two.
- `npm run lint`: 0 errors, 0 warnings.
- `npm run typecheck`: clean.
- `npx prettier --check .`: all files formatted.
- `npx expo export --platform android`: bundled. One Hermes bundle (`entry-….hbc`, 3 MB), exported to the scratchpad, not the repo. The app doesn't import `sql.js` or `src/db/testing`.
- `git status`: clean. Nothing pushed.

---

# Round 5: milestone 5

Main started at `519187b`, which added `docs/m5-contract.md`. I read it before merging. Nothing was pushed.

## R5.1 Merges

| Step                               | Commit    | What                                                                                                                    |
| ---------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| Merge `feat/m5-profiles` (--no-ff) | `c8b2ad7` | See the list below the table. 81 implementer tests.                                                                     |
| Merge `test/m5-profiles` (--no-ff) | `d55a19b` | 129 acceptance tests: profiles (55), profileValidation (43), migrations-v2 (15), customProfiles (16). Findings #55–#67. |
| Decisions                          | `37a2637` | Code changes for #58, #60, #64 and #65, `displayRole` signature fix, M4 version test, review tests, contract decisions. |

`feat/m5-profiles` adds:

- the `label` column (schema v2) and `migrate(db, toVersion?)`;
- `src/lib/profiles.ts` and `src/lib/profileValidation.ts`;
- store actions for profiles, coworkers and settings, with `checkProfile` run in the store;
- the Settings, profile editor and onboarding screens, a chip-row profile picker, and extra bottom padding on Who worked;
- a fix so switching to a server profile drops the auto-added "Me".

After both merges, with `npm ci`:

- **Tests:** 551 passed, 1 failed (552, 29 suites). The failure was the M4 test `SCHEMA_VERSION is 1 for milestone 4`, as expected (#66).
- **Lint and Prettier:** clean.
- **Typecheck:** 16 errors, in two groups:
  1. 6 expo-router route-type errors (`/onboarding`, `/profile/...`). These were **environment only**: the gitignored, generated `.expo/types/router.d.ts` predated the new routes. I regenerated it with expo-router's own `regenerateDeclarations`, and the errors went away. No code change; a fresh `expo start` does the same.
  2. 10 errors in `profiles.test.ts`, where the tests pass a full `TipOutRule` to `displayRole`. The implementation typed the parameter as `Pick<TipOutRule, 'role' | 'label'>`, which rejects the extra properties. The contract signature is `displayRole(rule: TipOutRule)`, so this was an implementation deviation. I widened the parameter to `TipOutRule | Pick<…>`.

## R5.2 Triage

| Failure                                            | Category                                                | Resolution                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations › SCHEMA_VERSION is 1 for milestone 4` | (b) outdated test (#66, instructed)                     | Now `SCHEMA_VERSION is the current version (2 since milestone 5)`, with a comment to bump it per migration. The v1→v2 upgrade itself is covered by `migrations-v2.test.ts`. |
| `profiles.test › displayRole › *` (typecheck only) | (a) implementation deviated from the contract signature | `displayRole` accepts a full `TipOutRule`. Jest passed before because Babel doesn't typecheck.                                                                              |
| Stale `.expo/types/router.d.ts` (typecheck only)   | Environment                                             | Regenerated. Not a code issue.                                                                                                                                              |

Totals: 1 implementation bug (the `displayRole` signature), 1 outdated test (the version test), 0 judgment calls among failures, plus 1 environment issue.

I expected stub-vs-real differences for #55, #56, #57 and #59, but none caused a failure. The tester's assumptions matched the real helpers, or the tests accepted either form (kitchen naming). The real behaviour is now written into the contract.

## R5.3 Findings #55–#67

| #   | Finding                                  | Disposition                                      | Notes                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 55  | `roleIdFromLabel` for unusual labels     | **Recorded in the contract**                     | Any-script letters and digits are kept. Other runs, including apostrophes, become `-`. Built-in aliases are the id, the id plus "s", and the display and singular labels. "Bar Back" becomes `bar-back`. I kept the apostrophe → `-` behaviour: the tester only suggested dropping it, and no saved data depends on it yet. |
| 56  | "Kitchen" vs "Kitchen (KTO)"             | **Recorded in the contract**                     | `displayRole` shows "Kitchen (KTO)". `profileSummary` shows "Kitchen" (parenthetical stripped). `roleIdFromLabel('Kitchen (KTO)')` returns `'kitchen'`.                                                                                                                                                                     |
| 57  | Out-of-range indexes                     | **Recorded in the contract**                     | Unchanged copy, no throw. `moveRule` clamps `to`; an out-of-range `from` is a no-op.                                                                                                                                                                                                                                        |
| 58  | 0% pool                                  | **Accepted** (changed)                           | New `POOL_PERCENT_ZERO` warning. Tested. The tester's "0% has no errors" test still passes.                                                                                                                                                                                                                                 |
| 59  | `NO_SHARE_RULE` with no rules            | **Accepted** (already implemented)               | Suppressed when `NO_RULES` fires. Tested.                                                                                                                                                                                                                                                                                   |
| 60  | Unallocated remainder                    | **Accepted** (changed, small)                    | New engine warning `REMAINDER_UNALLOCATED` with the amount ("$104.00 of the tip-out pool has no role to share it, so it stays with you"), shown on Results through the warning banners. No result field. Tested with rounding on and off, plus the no-warning cases.                                                        |
| 61  | `role` vs `label` as the source of truth | **Confirmed** (implementer, on your instruction) | `renameRolePatch`: the role id is fixed once the rule exists, and renames change only `label`.                                                                                                                                                                                                                              |
| 62  | Labels on built-in roles                 | **Confirmed**                                    | A name that resolves to a built-in stores that role with no label.                                                                                                                                                                                                                                                          |
| 63  | Infinite weights; NFC names              | **Accepted** (already implemented)               | `RULE_WEIGHT_POSITIVE` requires a finite weight. `NAME_TAKEN` compares NFC-normalised, lower-cased names. Tests added.                                                                                                                                                                                                      |
| 64  | When onboarding shows                    | **Accepted** (changed)                           | `needsOnboarding` now also requires `status === 'ready'`, so a failed or unfinished hydrate never shows onboarding. The strict `onboarded === true` check was already in `hydrate`. Tested: loading, error, and a stored `'true'` string.                                                                                   |
| 65  | #44 bypassed by switching `appliesTo`    | **Accepted** (changed)                           | The store's `saveProfile` refuses to change `appliesTo` on the last profile for a role (`LAST_PROFILE_FOR_ROLE`). The default fallback is the built-in first, then the first remaining by name. Tested.                                                                                                                     |
| 66  | M4 tests breaking under M5               | **Confirmed**                                    | Version test updated. Validation runs in the store, not the repository, so the M4 repository tests are untouched.                                                                                                                                                                                                           |
| 67  | `wholeDollarShares` default              | **Confirmed** (no change)                        | Defaults to `true`, matching the engine default.                                                                                                                                                                                                                                                                            |

Counts (13 findings):

- **Accepted 6:** #58, #59, #60, #63, #64, #65. Four were behaviour changes (#58, #60, #64, #65); two were already implemented (#59, #63).
- **Confirmed 4:** #61, #62, #66, #67.
- **Recorded in the contract 3:** #55, #56, #57.
- **Rejected 0.**

## R5.4 Doc edits

- `docs/m5-contract.md`: added `POOL_PERCENT_ZERO` to the issue codes, and a "Decisions (main-branch review, round 5)" section. It records schema v2, the real helper behaviour (#55–#57), #58–#67, and the implementer's additions beyond the contract.
- CLAUDE.md: not edited.

## R5.5 Owner decisions

None new. Still open from §11: Q6 (cloud backup / accounts).

## R5.6 Final check output (main @ HEAD)

- `npm test`: **31 suites, 565 tests passed, 0 failed**.
  - engine project: 29 suites, 554 tests.
  - ui project: 2 suites, 11 tests.
  - Round 5 added 13 tests: 3 in the engine `review.test.ts`, 5 in `src/lib/__tests__/review.m5.test.ts`, and 5 in `src/store/__tests__/review.m5.test.ts`.
- `npm run lint`: 0 errors, 0 warnings.
- `npm run typecheck`: clean, after regenerating the gitignored typed-routes file.
- `npx prettier --check .`: all files formatted.
- `npx expo export --platform android`: bundled. One Hermes bundle (`entry-….hbc`, 3 MB), exported to the scratchpad.
- `git status`: clean. Nothing pushed.

---

# Round 6: milestone 6

Main started at `0e752bf`, which added `docs/m6-contract.md`. I read it before merging. Nothing was pushed.

## R6.1 Merges

| Step                            | Commit    | What                                                                                                                     |
| ------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| Merge `feat/m6-hours` (--no-ff) | `2eec266` | See the list below the table. 51 implementer tests.                                                                      |
| Merge `test/m6-hours` (--no-ff) | `ddd8b47` | `hoursInput.test` (154), `teamHours.test` (28), `src/test-support/hoursFixtures.ts`; findings #68–#80.                   |
| Decisions                       | `57056c9` | Engine fix for #78, message changes for #72 and #74, the property extended to kitchen, review tests, contract decisions. |

`feat/m6-hours` adds:

- `src/lib/hoursInput.ts`;
- store support: a `typed` draft field, `typedTeam`, `setTyped`, `copyHoursToRole`;
- on Who worked: normalising on blur, a live hours line, issues listed per member, a banner with the button disabled while there are errors, and "Same for everyone";
- hours on the Results bar-split rows and in the share text.

After both merges:

- **798 passed, 0 failed** (35 suites).
- Lint, typecheck and Prettier clean.
- No conflicts.

## R6.2 Triage

Nothing failed after the merge. The stub-vs-real differences I expected on edge parse forms (#68–#70, #77) didn't appear: the real parser matched every form the tester encoded.

Extending the tester's key property to kitchen members (instructed, #78) reproduced the gap before the fix. A kitchen member with a bad clock passed `checkTeamHours`, then `calculateShift` threw `INVALID_CLOCK`. After the engine fix the property passes, 1500 runs.

Totals: 0 implementation bugs and 0 test bugs found by merging. 1 implementation gap found by review (#78, now fixed). 0 judgment calls.

## R6.3 Findings #68–#80

| #   | Finding                                              | Disposition                                    | Notes                                                                                                                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 68  | 12-hour edge forms and `1200`                        | **Recorded** (contract kept)                   | `0pm`, `0am`, `00:00pm` and `0:30am` are null. `1200` is noon. `1730pm` is null. The hint text shows the 24h reading. I didn't add `0:30am`, because it wasn't in your decision list.                                                                                                                                                        |
| 69  | Whitespace inside input                              | **Accepted** (already implemented)             | Both parsers strip all whitespace. Tests added (`5 : 30`, `17 30`, `6 h 30 m`, `4 5 min`).                                                                                                                                                                                                                                                   |
| 70  | One-digit minutes                                    | **Recorded** (keep rejecting)                  | `5:3`, `5.3`, `5.5` → null. Tested.                                                                                                                                                                                                                                                                                                          |
| 71  | `PARTIAL_HOURS` and members with errors              | **Recorded** (contract kept)                   | Only valid hours trigger `PARTIAL_HOURS`.                                                                                                                                                                                                                                                                                                    |
| 72  | Zero hours                                           | **Accepted** (changed)                         | Still `INVALID_HOURS`. The message now ends with "Enter hours above 0, or remove them from the team." Tested.                                                                                                                                                                                                                                |
| 73  | Range check before or after rounding                 | **Confirmed**                                  | After rounding, so `0.001` → null.                                                                                                                                                                                                                                                                                                           |
| 74  | `LONG_SHIFT` at 16 h                                 | **Recorded** (changed wording)                 | Fires above 16 h, warning only. Message: "That's a long shift for Allen (17 h) — double-check the times." Tested.                                                                                                                                                                                                                            |
| 75  | Blank typed text                                     | **Confirmed**                                  | Present but blank means cleared, with no fallback to that field's committed value.                                                                                                                                                                                                                                                           |
| 76  | Hours text vs clock text                             | **Accepted** (already implemented)             | Total hours win, as in the engine. Tests cover both directions.                                                                                                                                                                                                                                                                              |
| 77  | Several problems on one member                       | **Accepted** (already implemented)             | One `INVALID_TIME` per unreadable field, clock-in first. Tested.                                                                                                                                                                                                                                                                             |
| 78  | Kitchen members bypass the checks but not the engine | **Accepted** (engine fix)                      | `calculateShift` resolves hours only for split roles: profile roles except never-missing ones, plus bartenders in the bartender flow. Kitchen members, and members of roles outside the profile, are never validated. New test with four kinds of bad kitchen entry (the result equals Golden 1). The property now includes kitchen members. |
| 79  | `copyHoursToRole` and pending typed text             | **Verified** (already implemented); test added | The store replaces the other same-role members' typed text with only the source's mode. A stale `abc` can't override the copied hours, and other roles are untouched.                                                                                                                                                                        |
| 80  | `clockHours` strict `HH:mm`                          | **Confirmed**                                  | Callers must run `parseTimeInput` first.                                                                                                                                                                                                                                                                                                     |

Counts (13 findings):

- **Accepted 5:** #69, #72, #76, #77, #78. Two were behaviour changes (#72, #78); three were already implemented (#69, #76, #77).
- **Verified 1:** #79.
- **Confirmed 3:** #73, #75, #80.
- **Recorded 4:** #68, #70, #71, #74. #74 also got the new wording.
- **Rejected 0.**

The implementer's interpretations are all accepted:

- `PARTIAL_HOURS` counts only valid hours.
- Committed 0 hours is `INVALID_HOURS`.
- Hours text is normalised on blur.
- "Same for everyone" switches the panel mode.

## R6.4 Doc edits

- `docs/m6-contract.md`: added "Decisions (main-branch review, round 6)", covering the #78 engine rule, parsing rules, `checkTeamHours` rules, store behaviour, and the implementer's interpretations.
- CLAUDE.md: not edited.

## R6.5 Owner decisions

None new. Still open from §11: Q6 (cloud backup / accounts).

## R6.6 Final check output (main @ HEAD)

- `npm test`: **37 suites, 815 tests passed, 0 failed**.
  - engine project: 34 suites, 803 tests.
  - ui project: 3 suites, 12 tests.
  - Round 6 added 17 tests: 16 in `src/lib/__tests__/review.m6.test.ts` and 1 in `src/store/__tests__/review.m6.test.ts`. The `teamHours` property now covers kitchen members.
- `npm run lint`: 0 errors, 0 warnings.
- `npm run typecheck`: clean.
- `npx prettier --check .`: all files formatted.
- `npx expo export --platform android`: bundled. One Hermes bundle (`entry-….hbc`, 3 MB), exported to the scratchpad.
- `git status`: clean. Nothing pushed.

---

# Round 6b: blur fix

Merged `fix/m6-blur` (`d2c9be3`, Implementer) into main as `63b1c15` (--no-ff). Main was at `35aeb9c`.

**The bug (found on the emulator).** In a clock field, typing "5pm" and then tapping the next field made the field show `05:00`. The on-blur handler normalised a stale copy of the text, captured one keystroke behind. The committed value stayed `17:00`, so the screen and the money disagreed, and a bogus LONG_SHIFT warning appeared. The hours field had the same problem.

**The fix (`app/shift/team.tsx`, reviewed).**

- On blur, both handlers read the latest typed text and the committed value from the store (`useShiftStore.getState()`), not from the render's closure.
- They only rewrite the text when its normalised form equals the committed value, so normalising can't make the field and the money disagree.

The diff is limited to that component, plus a 2-test regression file, `src/__tests__/impl.m6blur.test.tsx`. There are no engine or store changes.

**Checks.**

- `npm test`: **38 suites, 817 tests passed**, 0 failed.
- `npm run lint`: 0 errors, 0 warnings.
- `npm run typecheck`: clean.
- `npx prettier --check .`: clean.
- `npx expo export --platform android`: bundled.
- `git status`: clean. Nothing pushed.

---

# Round 7: milestone 7

Main started at `b27d3d6`, which added `docs/m7-contract.md`. I read it before merging. Nothing was pushed.

## R7.1 Merges

| Step                              | Commit    | What                                                                                           |
| --------------------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| Merge `feat/m7-history` (--no-ff) | `f6aecab` | See the list below the table.                                                                  |
| Merge `test/m7-history` (--no-ff) | `a22bc02` | `history.test` (55), `csv.test` (42), `historyFixtures.ts`; findings #81–#92.                  |
| Decisions                         | `fa2a4de` | `displayPeriodLabel` for #81, csvEscape test update for #88, review tests, contract decisions. |

`feat/m7-history` adds:

- new dependencies: gifted-charts, svg, linear-gradient, file-system, sharing, tslib;
- `src/lib/history.ts` and `src/lib/csv.ts`;
- `ShiftResultView`, shared by Results and shift detail;
- the History tab with its chart;
- the `app/history/[id]` shift detail screen, with edit that updates the saved shift;
- CSV share, and the `weekStartsOn` setting.

After both merges, with `npm ci`:

- **Tests:** 928 passed, 1 failed (929, 43 suites).
- **Lint and Prettier:** clean.
- **Typecheck:** one error. The gitignored, generated `.expo/types/router.d.ts` predated the new `/history/[id]` route. I regenerated it with expo-router's `regenerateDeclarations`, as in round 5. This is an environment issue only; there was no code change.

## R7.2 Triage

| Failure                                                                         | Category                                    | Resolution                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `csv › csvEscape › any string round-trips through the parser as a single field` | (b) test predates decision #88 (instructed) | The counterexample was `"@"`. Under #88, text starting with `= + - @` gets a leading `'`, so the property now expects that prefix and an exact round-trip otherwise. Added explicit cases: `=SUM(A1)`, `+1`, `-5`, `@cmd`, `=a,b` (prefixed and quoted), and `a=b` (unchanged). This is not a weakening: the property still checks every string, with the prefix made explicit. |

**Payouts row semantics (#85 vs implementer interpretation 1).** No test failed. The tester compared rows as sets and didn't assert $0 rows. The sum property (`paid + role = tipped_out`, `bar_split + kept_change = kept`) holds under the implementer's rules. I kept those rules and pinned them in new tests, Golden 2 exact rows plus the $0 cases:

- `paid` rows appear even at $0;
- `role` rows appear even at $0;
- `retained` rows appear only when > 0;
- `bar_split` rows include the user;
- `role` and `retained` rows have a blank name;
- the role column holds the label.

Totals: 0 implementation bugs, 1 test predating a decision (#88), 0 judgment calls, plus 1 environment issue (stale route types).

**Android export.** The first `npx expo export --platform android` after the new native dependencies printed a transient `Error: Unable to deserialize cloned data.` from a Metro worker, but still produced the bundle. A clean rerun exited 0 with no errors and a 3.7 MB Hermes bundle. I treated it as a first-run Metro cache/worker issue.

## R7.3 Findings #81–#92

| #   | Finding                                   | Disposition                                          | Notes                                                                                                                                                                                                                                   |
| --- | ----------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 81  | Week labels always include the year       | **Accepted** (changed, small)                        | New pure `displayPeriodLabel(range, today)` used for the History heading: "Nov 15 – 21", "November" in the current year. Other years, year ranges and weeks spanning two years keep the full label. `periodRange` is unchanged. Tested. |
| 82  | Average per shift, not per hour           | **Recorded**                                         | Per shift, rounded half-up (`Math.floor(x + 0.5)`). Per hour would need a "my hours" field.                                                                                                                                             |
| 83  | What counts as "where your tip-outs went" | **Confirmed**                                        | Only paid role and member amounts. Retained, rounding, `keptChange` and `keptSplit` are excluded. The tester's tests cover it.                                                                                                          |
| 84  | `byCoworker` details                      | **Confirmed** (implementer behaviour); tests aligned | Order-independent (shifts sorted internally), most recent spelling, roles in first-seen order. Each shift is counted **once** per person, including a $0 share in a paid role. Two new tests pin the once-per-shift and $0-share cases. |
| 85  | `payoutsCsv` columns and row order        | **Resolved toward the implementer**                  | See R7.2. Row order: profile rule order, members in team order, then `bar_split`.                                                                                                                                                       |
| 86  | Payouts don't reconcile to total tips     | **Recorded**                                         | Kept money has no payout row. The shifts file is the reconciliation view.                                                                                                                                                               |
| 87  | CSV locale and BOM                        | **Done; verified**                                   | The BOM is added only in `shareCsv` (the file writer). New test with mocked `expo-file-system` and `expo-sharing`: the written file starts with U+FEFF, and the builder output doesn't. Decimals stay `.`.                              |
| 88  | Formula injection                         | **Done; verified**                                   | `'` prefix on strings starting with `= + - @`. Numbers, money and hours bypass it, so `-0.05` is not prefixed. Tests updated (R7.2).                                                                                                    |
| 89  | Period of an edited shift                 | **Recorded**                                         | Follows the edited `input.date` and keeps the original `savedAt`.                                                                                                                                                                       |
| 90  | "Today" for the current period            | **Done; verified**                                   | `todayIso()` is `format(new Date(), 'yyyy-MM-dd')`, the local date. A fake-timer test at local 23:30 and 00:15 confirms it. Used for the History anchor, the next-limit and the New Shift default.                                      |
| 91  | Hours in the payouts file                 | **Recorded**                                         | Blank when 0 or not entered, otherwise up to 2 decimals.                                                                                                                                                                                |
| 92  | `isUser` on a tip-out member              | **Recorded**                                         | The coworker reconciliation identity holds only when no `isUser` member is paid.                                                                                                                                                        |

Counts (12 findings):

- **Accepted 1:** #81.
- **Done and verified 3:** #87, #88, #90.
- **Confirmed 2:** #83, #84.
- **Resolved toward the implementer 1:** #85.
- **Recorded 5:** #82, #86, #89, #91, #92.
- **Rejected 0.**

**Implementer's open items.**

- Switching tabs mid-edit keeps the edit. Left as is; the banner with **Cancel edit** is acceptable.
- Chart bars can't be focused individually. Noted for M9 (accessibility).

## R7.4 Doc edits

- `docs/m7-contract.md`: added "Decisions (main-branch review, round 7)", covering local today, display labels, averages, the `byRole`/`byCoworker` rules, CSV escaping, the BOM, the payout row table, reconciliation and the UI notes.
- CLAUDE.md: not edited.

## R7.5 Owner decisions

None new. Still open from §11: Q6 (cloud backup / accounts).

## R7.6 Final check output (main @ HEAD)

- `npm test`: **45 suites, 946 tests passed, 0 failed**.
  - engine project: 40 suites, 929 tests.
  - ui project: 5 suites, 17 tests.
  - Round 7 added 17 tests:
    - 10 in `src/lib/__tests__/review.m7.test.ts`;
    - 1 in `src/export/__tests__/shareCsv.test.ts`;
    - 6 explicit `csvEscape` cases for #88 in `csv.test.ts`.
- `npm run lint`: 0 errors, 0 warnings.
- `npm run typecheck`: clean, after regenerating the typed-routes file.
- `npx prettier --check .`: all files formatted.
- `npx expo export --platform android`: bundled, 3.7 MB Hermes bundle, clean rerun exit 0.
- `git status`: clean. Nothing pushed.
