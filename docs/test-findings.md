# Test findings: calc engine acceptance suite

Author: Agent 2 (Tester), branch `test/engine`; updated on `test/owner-decisions` for the owner's answers of 2026-11-18 (CLAUDE.md §11, commit `dcaecaa`). Audience: the maintainer merging the test branches with the implementation branch.

**Update (test/owner-decisions):** items 3, 4, 5 and 19 are **resolved by the owner**, and 6(a) is confirmed (owner Q5). The suite now encodes the decisions: whole-dollar member shares and `keptSplit` when rounding is on (`roundMemberShares` defaults to true), `keptChange`, `poolBasis` with the `POOL_EXCEEDS_TIPS` cap, and equal clock times rejected with `INVALID_CLOCK` at the `calculateShift` level too. New findings start at **#20**. Against an unmodified `main` engine, 49 of the updated tests fail as expected (new behaviour). Against a scratch stub patched with the new behaviour (outside the repo, not committed), every test in the tester-owned files and `review.test.ts` passes, and they type-check under `strict` + `noUncheckedIndexedAccess`. 4 tests in the implementer-owned `impl.golden.test.ts` encode the old defaults and fail under the new behaviour (#29).

The suite lives in `src/engine/__tests__/` (`money`, `hours`, `calculate`, `golden`, `properties`). Builders are in `src/test-support/builders.ts`. Every expected value is worked out by hand in a comment next to the assertion. Before committing, the suite was type-checked and run against a throwaway reference stub outside the repo: 147 tests passed, and the files compile under `strict` + `noUncheckedIndexedAccess` + `noUnusedLocals`. The stub was written from the same reading of the spec, so this proves the tests agree with each other. It does not prove they match the real implementation.

Each item below gives **what**, **why**, a **proposed resolution**, and the **affected tests** (`file › describe › it`, abbreviated).

---

## A. Contract errors and owner decisions encoded in tests

### 1. The contract's Golden 1 `kept` value is wrong (24056 → 23856)

- **What:** The brief says Golden 1 `kept 24056`. But `kept = totalTips − pool = 34056 − 10200 = 23856` ($340.56 − $102.00 = $238.56).
- **Why:** 24056 is an arithmetic slip, probably subtracting $100 instead of $102. It conflicts with the contract's own definition of `kept`.
- **Resolution:** The tests assert **23856**. If the implementer hard-coded 24056 anywhere, fix it there.
- **Tests:** `golden › Golden 1 › roles sum to the pool and kept = tips - pool`, `… › with roundMemberShares …`, `calculate › missing roles › server, no host, 'redistribute' (rounding on)`.

### 2. How the "unrounded" pool is rounded to the cent (half-up)

- **What:** 30% × $192.55 = 5776.5¢. The contract's `roundingAdjustment 77` only works if that becomes **5777** (round half up, `Math.round`). Flooring or banker's rounding gives 5776, so the adjustment would be 76.
- **Why:** §5.1 step 1 doesn't say how a fractional-cent pool becomes cents. Half-up can push the cent pool up to ½¢ over the exact percentage. That's harmless, because it is still ≤ total tips.
- **Resolution:** Spec: `unroundedPool = Math.round(totalTips × pct / 100)`, computed in a way that keeps float error out (for example, scale integer percentages first). Add this to §5.1.
- **Tests:** `golden › Golden 2 retain › pool paid out is $43, retained $14, rounding adjustment $0.77`, `calculate › rounding OFF › Golden 2 input …` (pool 5777 → 4393 paid), `properties › sum(roles paid) + retained <= unrounded pool <= totalTips` (checks that `pool + retained + roundingAdjustment` is within ±0.5¢ of the exact percentage).

### 3. Whether individual shares round to whole dollars (§11 Q1) — **RESOLVED by the owner**

> **Resolution (owner, 2026-11-18):** whole dollars when rounding is on. `roundMemberShares` defaults to **true**; `false` restores cent splits. It still does nothing when `roundToDollar` is off (3a holds). It now **also** governs `keptSplit` (3b reversed; see #4 and #21). Golden 1 barbacks are $17 / $16; Golden 2 barbacks $21 / $20. Tests updated: `golden › *`, `calculate › rounding ON › member shares are whole dollars by default …`, `calculate › rounding OFF › roundMemberShares has no effect when roundToDollar is off (default, true or false)`, `calculate › hours: unequal splits › *`, `properties › with rounding on, role, member and keptSplit amounts are whole dollars …`, `review › splits equally when every member of a role has 0 hours`. The text below is the original finding.

- **What:** The default `roundMemberShares = off` gives $16.50 / $16.50 (server example) and $20.50 / $20.50 (bartender example). Turning it on gives $17 / $16 and $21 / $20, with the extra dollar going to the first-listed member.
- **Why:** The two source examples disagree.
- **Resolution:** The owner decides the default. The tests cover both settings, so changing the default won't break them. Two more assumptions:
  - (a) `roundMemberShares` **does nothing when `roundToDollar` is off**.
  - (b) It is **not applied to `keptSplit`**. No test asserts `keptSplit` amounts with it on; only `sum(keptSplit) == kept` is checked. The owner should confirm whether bartenders' kept shares should also be whole dollars.
- **Tests:** `golden › * › with roundMemberShares …`, `calculate › rounding OFF › roundMemberShares has no effect when roundToDollar is off`, `properties › with rounding on, every role amount is a whole dollar (and members too with roundMemberShares)`.

### 4. Leftover cents after flooring stay with the bar (§11 Q2) — **RESOLVED by the owner**

> **Resolution (owner, 2026-11-18):** `kept` stays cent-exact (14955, so `kept + pool == totalTips` still holds), but the bartenders share `floorToDollar(kept)` in whole dollars and the cents are reported in the new `ShiftResult.keptChange` (always present; 0 in the server flow, with rounding off, or with `roundMemberShares: false`). Golden 2 retain: keptSplit $75 / $74, keptChange 55; redistribute: $68 / $67, keptChange 55. Tests updated: `golden › Golden 2 * › bartenders share …`, `calculate › keptChange: whole-dollar keptSplit in the bartender flow › *`, `properties › sum(keptSplit) + keptChange == kept …`, `properties › 0 <= keptChange < 100 …`, `properties › keptChange never changes kept …`. The text below is the original finding.

- **What:** The tests expect the bar to keep **$149.55**, split Joseph $74.78 / Aaron $74.77. The source doc shows $149 and $74.50 each.
- **Why:** The doc drops the $0.55 left after flooring the $57.77 pool, and its $74.50 comes from $67.50 + $7. Neither matches the cent-exact rule (`kept = tips − pool`).
- **Resolution:** Keep the spec's behaviour. If the owner wants $149 displayed, do it at the UI layer, not in the engine. If the owner wants the engine to drop the cents, `kept + pool == totalTips` stops holding and roughly 6 tests and 1 property need rewriting.
- **Tests:** `golden › Golden 2 retain › bar keeps $149.55 …`, `… › kept is split between Joseph $74.78 and Aaron $74.77`, `golden › Golden 2 redistribute › kept split Joseph $67.78 / Aaron $67.77`, `properties › kept + pool == totalTips`.

### 5. Default for a missing role (§11 Q3) — **RESOLVED by the owner**

> **Resolution (owner, 2026-11-18):** default is **`retain`**, set in the store only. The engine still requires `missingRoleHandling` explicitly, so nothing changes in the engine suite; store tests belong to the implementer. `shiftInput()` in the builders deliberately still defaults to `'redistribute'` (documented in the builder) so the hand-worked values stay valid; see #30. The text below is the original finding.

- **What:** `missingRoleHandling` is a required field on `ShiftInput`, so the engine has no default. The `redistribute` default in §5.1 belongs in the UI/store.
- **Resolution:** Put the default in the store and test it there in milestone 3. `shiftInput()` in the builders defaults to `'redistribute'` to match.
- **Tests:** none directly.

---

## B. Behaviour the spec leaves undefined (what the tests assume)

### 6. Clock-time edge cases and `INVALID_CLOCK`

- **What:** Several clock cases aren't defined:
  - (a) `clockOut === clockIn`: the contract says `<=` counts as next day, so this is a **24h** shift. That is almost certainly a typo by the user. **Resolved:** review D2 made it `INVALID_CLOCK`, and the owner confirmed it (§11 Q5). Covered by `hours › rejects clockOut === clockIn with INVALID_CLOCK`, `review › rejects clockIn === clockOut …`, and now `calculate › equal clock-in and clock-out › *` (tip-out member, kept-sharing bartender, `HH:mm`, rounding off, plus a one-minute shift that must stay valid).
  - (b) `INVALID_CLOCK` can't fire on ordering, because any ordering is "next day". The tests assume it means **an unparseable clock string**.
  - (c) An ISO time without a UTC offset is parsed as _local_ time, so on a DST-change night an overnight shift comes out ±1h.
  - (d) A negative `hours` value has no error code.
- **Resolution:**
  - (a) Owner/maintainer: consider making equal times `INVALID_CLOCK` (or 0h). If changed, update `hours.test.ts › treats clockOut === clockIn as a full 24h shift`.
  - (b) Document that `INVALID_CLOCK` means unparseable.
  - (c) Have the UI always store times with an offset (the tests use `Z`). Or compute the duration from wall-clock fields.
  - (d) Reject negative or non-finite hours with `INVALID_CLOCK`, or add an `INVALID_HOURS` code. Not tested yet.
- **Tests:** `hours › treats clockOut === clockIn …`, `calculate › validation errors › unparseable clock time -> INVALID_CLOCK`.

### 7. Every member of a role has 0 hours

- **What:** `splitLargestRemainder` throws when all weights are zero (contract). With hours `[0, 0]` the engine would crash with a plain `Error`, not an `EngineValidationError`.
- **Resolution:** Either fall back to an equal split, or throw `EngineValidationError('PARTIAL_HOURS' | 'INVALID_CLOCK')`. Not tested. The tests only assume a single 0-hour member next to others gets $0 (`calculate › hours › a member with hours: 0 alongside others gets nothing`).

### 8. Order of operations for 'redistribute'

- **What:** There are two readings of "the share goes to present roles by weight":
  - (a) Split the remainder over present weights **before** rounding/allocation. With rounding off, Golden 1 with no host gives bartender **5038** / barback **3779**.
  - (b) Allocate all roles first, then re-split the host's already-rounded 1102¢ 4:3, giving **5039** / **3778**.

  With rounding on, both readings give $50 / $38. Golden 2 gives $55 either way.

- **Why:** The two readings differ by one cent, and only one of them is a single largest-remainder allocation.
- **Resolution:** Adopt (a): it is one allocation and has no double rounding. Spell it out in §5.1 step 3.
- **Tests:** `calculate › missing roles › server, no host, 'redistribute' (rounding off): remainder split over present weights`. Also the property `'redistribute' pays out exactly what 'retain' pays plus what it retains`, which holds under (a) or (b).

### 9. 'redistribute' when every shareOfRemainder role is missing

- **What:** No present role can receive the remainder. This happens, for example, when a bartender works with no barbacks and no hosts.
- **Resolution:** Fall back to `retain` for that remainder and emit a warning (a new code such as `NO_RECIPIENTS`), so money is never lost. Not tested. The property generator always staffs at least one share role to avoid this case.

### 10. Capping carve-outs that exceed the pool

- **What:**
  - (a) With **several** carve-outs over the pool, the spec doesn't say how to cap them: proportionally, or in rule order. The tests only check one carve-out (KTO), plus the general invariants in the properties.
  - (b) The tests assume the `CARVEOUTS_EXCEED_POOL` warning fires even when the pool is $0 because tips are $0.
  - (c) They also assume the cap is applied against the **floored** pool when rounding is on.
  - (d) A carve-out exactly equal to the pool does **not** warn.
  - (e) The case where flooring drops a 90¢ pool below a 20¢ KTO doesn't assert any warning.
- **Resolution:** Proportional capping via largest remainder. Warn whenever the uncapped sum is greater than the pool actually allocated. Document both.
- **Tests:** `calculate › carve-outs exceeding the pool › *`, `calculate › zero tips › with food sales, KTO is capped at the $0 pool and a warning is raised`, `calculate › rounding ON › a pool under $1 floors to $0 …`.

### 11. Percentages when dividing by zero, and for retained roles

- **What:**
  - (a) When `totalTips` or `netSales` is 0, the tests expect every percentage to be **0**, not NaN or Infinity.
  - (b) `poolPercentOfTips` is computed from the **paid** `pool`, which excludes the retained share.
  - (c) For missing roles, only finiteness and the 0–100 range are checked, because whether a redistributed role shows 0% or its notional share is a UI choice.
- **Resolution:** Confirm (a) and (b) in the §4 doc comments.
- **Tests:** `calculate › zero tips › *`, `golden › Golden 2 retain › pool percentages use the paid pool`, `properties › percentages are finite and consistent with amounts`.

### 12. "Kitchen is never missing": by role id, or by rule type?

- **What:** A custom profile can give a percentOfBasis rule to a staffed role, for example bartenders getting 1% of net sales. If nobody in that role is on shift, it's unclear whether the role is "missing".
- **Resolution:** Treat a percentOfBasis role with no members as missing (retain/redistribute like any other), except `kitchen`. Or add an explicit `needsMembers: boolean` to rules. Not tested: the property generator always staffs the non-kitchen carve-out role (`expo`).

### 13. Team / profile mismatches

- **What:** None of these are defined:
  - (a) Team members whose role has no rule, for example a `server` on a server's team or a `busser` with no busser rule.
  - (b) Bartender flow with **zero** bartenders on the team: is `keptSplit` an empty array, or an error?
  - (c) `profile.appliesTo` doesn't match `input.userRole`.
  - (d) The bartender flow with a profile that _does_ include a `bartender` rule, where the same people would be both recipients and kept-sharers.
- **Resolution:**
  - (a) Ignore the member and warn.
  - (b) Validation error. The UI should always add the user.
  - (c) Warning.
  - (d) Reject in the profile editor.

  None of these are tested. The property generator excludes them.

### 14. Validation gaps

- **What:** None of these have a defined behaviour yet:
  - Non-integer or non-finite cents (`100.5`, `NaN`).
  - Duplicate role ids in one profile.
  - An empty `weights` array or a negative total passed to `splitLargestRemainder`.
  - Negative values passed to `formatCents`.
- **Resolution:** Add an `INVALID_AMOUNT` code, or reuse `NEGATIVE_AMOUNT`, for non-integer or non-finite money. Reject duplicate rule roles in the profile editor and the engine. Define `formatCents(-1234) === '-$12.34'`. None of these are tested.

### 15. Order of `roles` and the `hours` field on equal-split members

- **What:** The tests find roles **by id** and don't depend on their order. They do assume `roles` contains **exactly one entry per profile rule**, including missing roles. Members follow **team order**, which is what drives tie-breaking. The `hours` value reported for members with no hours entered is not asserted, even though the type says `number`.
- **Resolution:** Document that roles follow profile rule order. Report `hours: 0` (or the equal-split share) and make the UI hide it when the user entered no hours.
- **Tests:** `golden › Golden 2 retain › only tip-out roles from the profile are listed …`, `properties › roles mirror the profile rules …`, `calculate › purity and determinism › member results follow team order`.

---

## C. Contract and tooling risks

### 16. `EngineValidationError instanceof` after transpiling

- **What:** The tests use `toBeInstanceOf(EngineValidationError)`. If Babel or TS compiles classes down to ES5, subclassing `Error` breaks `instanceof`.
- **Resolution:** Call `Object.setPrototypeOf(this, new.target.prototype)` in the constructor, and set `this.name`.
- **Tests:** every `expectValidationError` call, and `calculate › validation errors › thrown EngineValidationError is an Error subclass …`.

### 17. Jest and lint setup the suite needs

- **What:**
  - `fast-check` must be a devDependency (the tests use the v3 API: `fc.double({ noNaN })`, `fc.shuffledSubarray`, `fc.option(…, { nil })`).
  - `src/test-support/builders.ts` must **not** match `testMatch`. Jest's default patterns are fine.
  - The tests use Jest globals, including `expect` inside `builders.ts`. The tsconfig/ESLint env needs `jest` types for `src/test-support/**` too.
  - `golden.test.ts` uses `!` non-null assertions on `keptSplit`. If lint enables `no-non-null-assertion`, switch to `at()`.
- **Resolution:** The implementer/maintainer checks these at merge time.

### 18. Floating-point percentages and weights

- **What:** The property tests use non-integer pool percentages, carve-out percentages, and weights (for example 12.5 or 7.3). So the implementation must not assume integers, and it must allocate with largest remainder over float weights. `splitLargestRemainder(600, [0.1, 0.2, 0.3])` must still return `[100, 200, 300]`.
- **Resolution:** No change needed. This is a reminder.
- **Tests:** `money › is robust to floating-point weights …`, all `properties` tests.

### 19. Percent basis for the pool itself (§11 Q4) — **RESOLVED by the owner**

> **Resolution (owner, 2026-11-18):** new optional `TipOutProfile.poolBasis: 'totalTips' | 'netSales' | 'foodSales'` (default `'totalTips'`). `pool = basis × totalTipOutPercentOfTips / 100`, capped at total tips with the new warning `POOL_EXCEEDS_TIPS`. Tests added: `calculate › pool basis (owner Q4, §5.1 step 1) › *` (defaults unchanged, explicit `'totalTips'` identical to omitted, netSales with rounding off and on, cap + warning with rounding off and on, exactly-equal boundary, zero tips, foodSales basis, bartender flow with `keptChange`), and the property generator now draws `poolBasis` for custom profiles (`properties › a pool over total tips is capped and warns POOL_EXCEEDS_TIPS …`, and the exact-pool check uses the capped basis). New ambiguities: #24–#27. The text below is the original finding.

- **What:** `totalTipOutPercentOfTips` makes the pool always a percentage of **tips**. The tests cover carve-outs on `netSales` and `totalTips`. A pool that is a percentage of sales (common in some restaurants) is not expressible.
- **Resolution:** If the owner says some restaurants use a % of sales, add `poolBasis` to `TipOutProfile`, plus a golden test.
- **Tests:** `calculate › custom profiles › *`.

---

## D. New findings from the owner decisions (test/owner-decisions)

### 20. `keptChange` when the bartender flow has no bartenders

- **What:** §4 defines `keptChange` as "kept − sum(keptSplit)", while §5.4 step 5 defines it as the cents left after `floorToDollar(kept)`. They agree whenever at least one bartender is on the team. With zero bartenders (`keptSplit: []`, review #13b), the first reading gives `keptChange = kept` (can be ≥ $1); the second gives `kept % 100`, and then `sum(keptSplit) + keptChange ≠ kept`.
- **Why:** The coordinator's property `0 ≤ keptChange < 100` and the identity `sum(keptSplit) + keptChange == kept` can't both hold for an empty `keptSplit`.
- **Resolution:** Use `keptChange = kept − floorToDollar(kept)` (or 0 when whole-dollar sharing doesn't apply) in all cases, and document that the identity only holds when `keptSplit` is non-empty. The UI already prompts to add bartenders.
- **Tests:** none for the empty case. The property generator always puts ≥ 1 bartender on a bartender-flow team.

### 21. One flag now controls two things

- **What:** `roundMemberShares` now decides both tip-out member shares and the bar's `keptSplit` (§5.4 step 5: "With rounding off (or `roundMemberShares: false`)"). There is no way to get whole-dollar member shares with a cent-exact `keptSplit`, or vice versa, and the option name no longer describes what it does.
- **Resolution:** Fine for v1 (the owner wants both). Consider renaming to `wholeDollarShares` before the settings screen exposes it (milestone 5), and document the coupling in `CalculateOptions`.
- **Tests:** `golden › * › roundMemberShares: false …`, `calculate › rounding OFF › roundMemberShares has no effect …`, `properties › 0 <= keptChange < 100; it is kept % 100 with whole-dollar shares, else 0`.

### 22. Whole-dollar splits can give someone $0

- **What:** With whole dollars, a role with fewer dollars than members leaves someone at $0 (barbacks' $1 → $1 / $0), kept under $1 makes every `keptSplit` entry $0 with all the money in `keptChange`, and a very short shift rounds to $0 (one-minute shift vs 8h → $0 / $149).
- **Why:** This is correct under the owner's rule, but it may surprise users on tiny shifts.
- **Resolution:** No engine change. The Results screen should show `keptChange` and any $0 member clearly. The owner may want a note on very small shifts.
- **Tests:** `calculate › keptChange … › splits floorToDollar(kept) …` (David $1 / Allen $0), `… › kept under $1 …`, `calculate › equal clock-in and clock-out › a one-minute shift is still valid …`.

### 23. Systematic tie-break bias with whole dollars

- **What:** Ties go to the earlier member (§5.2). In cents that is at most 1¢ per shift; in whole dollars it is **$1 per shift**, every shift, for whoever is listed first (Golden 2: Joseph $75 / Aaron $74; redistribute: $68 / $67; Golden 1 barbacks: David $17 / Allen $16). Over a month of identical shifts that adds up to about $1 per shift for the same person.
- **Why:** Team order typically comes from saved coworkers, so the same person will usually be first.
- **Resolution:** Owner to confirm this is acceptable. Alternatives: rotate the tie-break by shift date, or give the odd dollar to the user (they close out). If changed, every golden whole-dollar tie expectation flips; the property tests are unaffected.
- **Tests:** all whole-dollar tie expectations in `golden.test.ts` and `calculate › hours: unequal splits › 3 hosts share $11 › whole dollars by default …`.

### 24. `POOL_EXCEEDS_TIPS` in the half-cent band

- **What:** If `basis × pct / 100` lands in `(totalTips, totalTips + 0.5¢]` (for example 5% × 400001¢ = 20000.05¢ against tips of 20000¢), it rounds to exactly total tips. It's unspecified whether that warns.
- **Resolution:** Compare the **exact** value: warn whenever `basis × pct / 100 > totalTips`, because the user's profile asked for more than the tips. The property only asserts "warns when more than ½¢ over" and "doesn't warn at or below tips", so either choice passes.
- **Tests:** `properties › a pool over total tips is capped and warns POOL_EXCEEDS_TIPS; otherwise no such warning`, `calculate › pool basis › a sales-based pool exactly equal to total tips does not warn`.

### 25. Capped pool: what everything downstream measures against

- **What:** The tests assume that once the pool is capped, everything downstream uses the **capped** pool: the half-up cent rounding (#2), the floor and `roundingAdjustment` (tips $200.50 → pool $200, adjustment 50¢), carve-out capping (#10), and the exact remainder used for whole-dollar allocation.
- **Resolution:** Document in §5.1 step 1 that the cap replaces the pool before steps 2–7.
- **Tests:** `calculate › pool basis › capped pool with rounding on …`, `… › a sales-based pool above total tips is capped …`, `properties › sum(roles paid) + retained <= unrounded pool <= totalTips` (now checks against the capped exact pool).

### 26. `POOL_EXCEEDS_TIPS` fires on every zero-tip shift with a sales-based pool

- **What:** With `poolBasis: 'netSales'` and tips not yet entered (or a no-tip shift), any positive sales trigger the cap and the warning, usually alongside `CARVEOUTS_EXCEED_POOL`.
- **Why:** It's technically correct, but noisy while the user is still filling in the form.
- **Resolution:** Keep it in the engine (the test asserts it). The UI should hold warnings until the user taps Calculate, or skip this one when tips are 0. Maintainer to decide.
- **Tests:** `calculate › pool basis › a sales-based pool with zero tips is capped at $0 and warns`.

### 27. Naming and percentage labels with a sales-based pool

- **What:** `totalTipOutPercentOfTips` now means "percent of the pool basis". With a sales basis, `poolPercentOfTips` is no longer the profile percentage (5% of net sales shows as 37.5% of tips in the test), and it can reach 100% after the cap.
- **Resolution:** No engine change. The Results/History UI and the CSV export must label the profile percentage with its basis ("5% of net sales"). Rename the field in a later schema migration if desired.
- **Tests:** `calculate › pool basis › netSales basis, rounding off` (asserts 37.5% of tips and 5% of net sales).

### 28. Who gets `keptChange` in history (F6)

- **What:** §5.4 step 5 says the change "stays with whoever closes out", but the engine doesn't attribute it to any `keptSplit` entry. The History screen's "what you earned" therefore has to decide whether to add `keptChange` to the user's share.
- **Resolution:** Persist `keptChange` in `shift_results` (milestone 4) and count it toward the user in history only if the owner agrees. Not an engine test.
- **Tests:** none.

### 29. Implementer-owned tests encode the old defaults

- **What:** `src/engine/__tests__/impl.golden.test.ts` asserts cent-level splits as the default: barbacks 1650/1650 and 2050/2050, keptSplit 7478/7477 and 6778/6777, and `roundMemberShares: true` with keptSplit 7478/7477. Under the owner's decisions 4 of its tests fail (`matches the spec exactly`, `retain: hosts share stays with the bartenders`, `retain + roundMemberShares: barbacks $21 / $20`, `redistribute: hosts share goes to the barbacks`). The tester may not edit that file.
- **Resolution:** The implementer updates those expectations (or passes `roundMemberShares: false` explicitly) on their branch.
- **Tests:** `impl.golden.test.ts › golden test 1 …`, `… golden test 2 …`.

### 30. Builder default for `missingRoleHandling`

- **What:** `shiftInput()` defaults to `'redistribute'`, while the store default is now `'retain'` (owner Q3). `golden1Input()` sets `'redistribute'` and `golden2Input()` sets `'retain'` explicitly.
- **Why:** The engine always receives the value explicitly, so this is only a test convenience. Today no test relies on the `shiftInput()` default with an unstaffed role (the review and pool-basis tests pass it explicitly).
- **Resolution:** Keep it; it is documented in `builders.ts`. Flip it if the maintainer wants builders to mirror the store; no current expectation changes.
- **Tests:** none affected today.

---

## Coverage map vs. the brief

| Brief item                                                              | Where                                                                      |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Golden 1 / Golden 2 retain / redistribute (+ roundMemberShares)         | `golden.test.ts`                                                           |
| Rounding off                                                            | `calculate › rounding OFF`                                                 |
| Unequal hours (roles + keptSplit)                                       | `calculate › hours: unequal splits`                                        |
| Clock-in/out across midnight                                            | `hours.test.ts`, `calculate › hours: clock-in / clock-out across midnight` |
| Both missing-role options                                               | `golden`, `calculate › missing roles`                                      |
| Zero food sales / zero tips                                             | `calculate › zero food sales`, `› zero tips`                               |
| Custom profile (netSales / totalTips basis, custom role ids, 0% / 100%) | `calculate › custom profiles`                                              |
| Carve-outs exceed pool (cap + warning)                                  | `calculate › carve-outs exceeding the pool`                                |
| Food > net warning                                                      | `calculate › food > net sales`                                             |
| PARTIAL_HOURS and the other validation codes                            | `calculate › hours: partial hours …`, `› validation errors`                |
| Largest-remainder tie-breaking                                          | `money.test.ts`, plus member/keptSplit tie tests                           |
| fast-check invariants                                                   | `properties.test.ts` (seed 20261118, 400 runs)                             |
| Whole-dollar member shares (owner Q1), `roundMemberShares` default true | `golden.test.ts`, `calculate › rounding ON`, `› hours: unequal splits`     |
| `keptChange` + whole-dollar `keptSplit` (owner Q2)                      | `golden.test.ts`, `calculate › keptChange …`, `properties`                 |
| `poolBasis` + `POOL_EXCEEDS_TIPS` (owner Q4)                            | `calculate › pool basis …`, `properties`                                   |
| Equal clock-in/out is `INVALID_CLOCK` (owner Q5)                        | `hours.test.ts`, `review.test.ts`, `calculate › equal clock-in and …`      |
