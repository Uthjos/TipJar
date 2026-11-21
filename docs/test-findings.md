# Test findings: calc engine acceptance suite

Author: Agent 2 (Tester), branch `test/engine`; updated on `test/owner-decisions` for the owner's answers of 2026-11-18 (CLAUDE.md §11, commit `dcaecaa`). Audience: the maintainer merging the test branches with the implementation branch.

**Update (test/owner-decisions):** items 3, 4, 5 and 19 are **resolved by the owner**, and 6(a) is confirmed (owner Q5). The suite now encodes the decisions: whole-dollar member shares and `keptSplit` when rounding is on (`roundMemberShares` defaults to true), `keptChange`, `poolBasis` with the `POOL_EXCEEDS_TIPS` cap, and equal clock times rejected with `INVALID_CLOCK` at the `calculateShift` level too. New findings start at **#20**. Against an unmodified `main` engine, 49 of the updated tests fail as expected (new behaviour). Against a scratch stub patched with the new behaviour (outside the repo, not committed), every test in the tester-owned files and `review.test.ts` passes, and they type-check under `strict` + `noUncheckedIndexedAccess`. 4 tests in the implementer-owned `impl.golden.test.ts` encode the old defaults and fail under the new behaviour (#29).

**Update (test/owner-decisions-2):** encodes owner Q7–Q9. Whole-dollar member splits use floor, then largest remainder, then more hours; members still tied get none and those dollars are held back. Held dollars from a role reduce `pool`, raise `kept` and add to `roundingAdjustment`; held dollars from `keptSplit` add to `keptChange`. Also covered: the `ZERO_SHARE_AFTER_ROUNDING` warning, `TeamMember.isUser` being ignored by the engine, and the new `splitWholeDollars` helper (`wholeDollars.test.ts`). Golden values follow CLAUDE.md §5.5/§5.6 at `57c4053`. #23 (tie bias to the first member) is superseded by Q7. New findings start at **#31**.

**Update (test/m4-persistence):** milestone 4 acceptance tests against `docs/m4-contract.md`: `src/db/__tests__/{migrations,seed,repositories,snapshot}.test.ts`, plus fixtures in `src/test-support/shiftFixtures.ts`. They were run against a throwaway sql.js stub of the contract outside the repo (not committed); the stub was also deliberately broken to confirm the tests catch ordering, null-vs-absent and missing-cascade bugs. New findings start at **#40**.

**Update (test/m5-profiles):** milestone 5 acceptance tests against `docs/m5-contract.md`:

- `src/lib/__tests__/profiles.test.ts` and `src/lib/__tests__/profileValidation.test.ts`
- `src/db/__tests__/migrations-v2.test.ts`
- `src/engine/__tests__/customProfiles.test.ts`

They were run against throwaway stubs outside the repo (not committed). New findings start at **#55**.

**Update (test/m6-hours):** milestone 6 acceptance tests against `docs/m6-contract.md`: `src/lib/__tests__/hoursInput.test.ts` and `src/lib/__tests__/teamHours.test.ts`, with helpers in `src/test-support/hoursFixtures.ts`. They were run against a throwaway stub outside the repo (not committed). New findings start at **#68**.

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

### 23. Systematic tie-break bias with whole dollars — **SUPERSEDED by owner Q7**

> Ties no longer go to the first-listed member: more hours wins, and a full tie holds the dollar back. See #38 for the new trade-off.

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

## E. New findings from owner Q7–Q9 (test/owner-decisions-2)

### 31. Held dollars are not passed down to smaller remainders

- **What:** Take $3 split 7:7:1, with exact shares 1.4 / 1.4 / 0.2. The two .4 members tie for the single leftover dollar, so it is held. The spec doesn't say whether that dollar should then go to the 0.2 member instead.
- **Why:** §5.4 step 4.4 says "none of them gets it — those dollars are held back". Giving it to someone with a smaller remainder would reward a less-deserving share over the tied ones.
- **Resolution:** The tests assume that **all** remaining leftover dollars are held once a tied group can't be fully served. Spell this out in §5.4.
- **Tests:** `wholeDollars › … › held dollars are not passed down to a smaller remainder`, and `wholeDollars › properties › nobody with a smaller (remainder, hours) gets a dollar …`.

### 32. Remainder ties must be detected despite floating-point error

- **What:** $2 split 4:14:2 gives exact shares 0.4 / 1.4 / 0.2. In IEEE754, `1.4 − 1 = 0.3999999999999999`, so a naive `===` comparison of remainders misses the tie and gives member 0 the dollar.
- **Why:** Hours are user-entered decimals (7.5h, 6.25h), so mathematically equal remainders often differ in the last bit. Uneven tie handling would be visible to users.
- **Resolution:** Compare remainders with a small epsilon (for example 1e-9 dollars), or compute in integer units (quarter-hours × cents). Apply the same epsilon to the hours comparison.
- **Tests:** `wholeDollars › … › detects remainder ties exactly despite floating-point error`. The fast-check property uses integer weights and exact `(total × w) mod W` remainders.

### 33. `ZERO_SHARE_AFTER_ROUNDING` for bartenders in `keptSplit`

- **What:** The tests assume a bartender whose whole-dollar `keptSplit` share is $0 is named in the warning, the same as a role member.
- **Why:** §5.4 step 4 introduces the split as "used for role members and for `keptSplit`", and the warning sits in the same step. The coordinator's brief only said "any member".
- **Resolution:** Confirm. If the warning should cover tip-out role members only, drop that test.
- **Tests:** `calculate › ZERO_SHARE_AFTER_ROUNDING warning › a bartender whose whole-dollar keptSplit share is $0 is named too`.

### 34. `ZERO_SHARE_AFTER_ROUNDING` when there was nothing to split

- **What:** With $0 tips (or a $0 pool), every member's whole-dollar share is $0. Read literally, the warning fires on every empty shift.
- **Resolution:** Only warn when the amount being split was at least $1 and someone still got $0. The tests don't assert either way for an empty split: the zero-tips test filters this code out, and the property only requires the warning when the role had at least $1 before holds.
- **Tests:** `calculate › zero tips › server flow: everything is 0 …`, `properties › ZERO_SHARE_AFTER_ROUNDING: never with rounding off; …`.

### 35. 'redistribute' vs 'retain' identity only holds for cent splits

- **What:** Before Q7, `pool(redistribute) == pool(retain) + retained(retain)` always held. With whole-dollar members, the two allocations can hold back different odd dollars. In Golden 2 both hold $1 (barbacks $41 and $55), so the identity happens to hold there, but it breaks when only one of the two allocations hits a tie.
- **Resolution:** No engine change. The property now checks the identity with `roundMemberShares: false`.
- **Tests:** `properties › 'redistribute' pays out exactly what 'retain' pays plus what it retains (cent members)`.

### 36. `ZERO_SHARE_AFTER_ROUNDING` with rounding on but cent splits

- **What:** With `roundToDollar: true` and `roundMemberShares: false`, members are split to the cent and can still get $0.00 (for example a 0-hour member). The spec says "whole-dollar share is $0", so the warning arguably doesn't apply.
- **Resolution:** Don't emit it in cent mode. Not tested: the property skips this combination.

### 37. `heldBack` / `keptHeldBack` are only present when > 0

- **What:** `RoleResult.heldBack` and `ShiftResult.keptHeldBack` are optional and only set when positive. The tests read them as `?? 0`. `roundingAdjustment` now mixes two things: the floor trim (0–99¢) and the held dollars.
- **Resolution:** Either always set them (0 when nothing is held), or keep them optional and document it in `types.ts`. The Results "rounding note" should show the floor trim and the held dollars separately, using `heldBack` per role.
- **Tests:** `properties › roundingAdjustment = floor trim (0-99c) + dollars held back from roles; 0 when off`, `properties › held-back dollars per role …`, `golden › *` (`heldBack ?? 0`).

### 38. Equal splits with no hours now always hold the odd dollar

- **What:** Members with no hours entered all report 0 hours, so an odd dollar in an even split is **always** held: the server or bar keeps it. Examples: Golden 1 barbacks $33 → the server keeps $1; three hosts sharing $11 → $2 held. This replaces #23's bias toward the first-listed member with a bias toward the user, of up to (members − 1) dollars per role per shift.
- **Why:** It follows the owner's rule, but tipped-out coworkers will see $16 / $16 where the doc showed $16.50 each.
- **Resolution:** Owner awareness only. The Results screen should state "$1 kept back from barbacks (tie)", using `heldBack`.
- **Tests:** `golden › *`, `calculate › hours: unequal splits › 3 hosts share $11 › whole dollars by default …`, `properties › members with no hours entered get equal shares (identical in whole dollars, within 1c)`.

### 39. Implementer-owned tests that encode pre-Q7 values

- **What:** Against a stub with the Q7 behaviour, 5 implementer-owned tests fail:
  - `impl.golden.test.ts`, 4 tests: `golden test 1 … › matches the spec exactly`, `… › reports percentages in 0–100`, `golden test 2 … › retain: …`, `… › redistribute: …`.
  - `impl.edge.test.ts`, 1 test: `poolBasis: pool as a % of net sales, capped at total tips with a warning`, which expects the old whole-dollar split with no hold.
- **Resolution:** The implementer updates these on their branch. The tester may not edit them.

---

## F. Milestone 4 persistence (test/m4-persistence)

### 40. Column names aren't in the contract

- **What:** The contract names tables but not columns. The migration tests therefore rely on:
  - the version appearing as _some_ value in `schema_version`;
  - `shifts` being an ordinary rowid table (the direct-SQL cascade test deletes `WHERE rowid = …`);
  - one `shift_members` row per team member;
  - a name heuristic for "money columns are INTEGER": columns matching `/tip|sales|amount|pool|kept|retained|cents|adjust|change|held/` (excluding hours, percent, weight, date and id) must hold integers, and must not be declared REAL.
- **Why:** If money is stored only inside a JSON column, the integer check passes trivially. If a column is named unexpectedly (for example `tot`), it isn't checked at all.
- **Resolution:** Add column names to the contract, or a naming convention such as `*_cents` for money. Then the test can check those columns exactly.
- **Tests:** `migrations › money is stored as INTEGER cents (no floats) › *`, `migrations › cascade deletes › *`.

### 41. `listShifts` ordering ties, and how `savedAt` is compared

- **What:** The contract orders by "newest date first, then newest savedAt". It doesn't say what happens when two shifts share both `date` and `savedAt`. It also doesn't say how `savedAt` is compared: as text, mixed formats such as `…Z` vs `+00:00`, or with and without milliseconds, sort wrongly.
- **Resolution:** Add a final tie-break, for example newest insert (`rowid DESC`) or `id`. Store `savedAt` normalised with `toISOString()`. The tests avoid exact ties and use one ISO format.
- **Tests:** `repositories › shifts › listShifts › *`.

### 42. `listCoworkers` order for never-worked coworkers and name case

- **What:** "Most recently worked first, then name" doesn't place coworkers with no `lastWorked`, and doesn't say whether the name sort is case-sensitive or locale-aware.
- **Resolution:** The tests assume never-worked coworkers sort **last**, then by name. The test names avoid mixed case. Use a case-insensitive name sort (`COLLATE NOCASE`, or JS `localeCompare`).
- **Tests:** `repositories › coworkers › listCoworkers: most recently worked first, then by name; never-worked last`.

### 43. `updateShift` and `savedAt`

- **What:** The contract doesn't say whether `updateShift` keeps the original `savedAt` or bumps it. Bumping would re-sort an edited shift within its date.
- **Resolution:** The tests assume `savedAt` is **kept**, along with `id`. If edit time is wanted, add a separate `updatedAt`.
- **Tests:** `repositories › shifts › updateShift replaces input and result, keeping id and savedAt`.

### 44. Seeding after the user deletes every profile

- **What:** "Only if the profiles table is empty" means deleting both defaults, with no custom profiles, brings both back on the next `initDb`. Deleting just one is respected.
- **Resolution:** Keep this; the app always needs at least one profile. The profile editor (M5) should probably block deleting the last one anyway. The test encodes the contract as written.
- **Tests:** `seed › reseeds both defaults once every profile has been deleted (table empty)`, `seed › does not reseed a default the user deleted while other profiles exist`.

### 45. `rememberTeam` matches across roles

- **What:** Matching is by name only, so "Sam" the host and "Sam" the barback become one coworker, and a one-off cover shift flips `usualRole`. The tests assert this contract behaviour: one coworker, with `usualRole` set to the role just worked.
- **Resolution:** Accept for v1. If it bites, match on (name, role) or keep a role history, and add a "these are different people" option in the coworker list (M5).
- **Tests:** `repositories › coworkers › rememberTeam › updates usualRole to the role just worked (matching ignores role)`.

### 46. Placeholder names such as "Barback 2"

- **What:** If **Who worked** pre-fills unnamed slots with placeholders ("Barback 2", "Bartender 1"), `rememberTeam` will save them as coworkers. They then pollute quick-add, and different people merge under one placeholder.
- **Resolution:** The UI should leave unnamed members blank (blank names are skipped), or flag placeholders (for example `TeamMember.isPlaceholder`) so `rememberTeam` skips them. A regex on `/^<role> \d+$/i` is a fallback. Not tested; the contract doesn't cover it.

### 47. Which spelling wins when a name matches

- **What:** When "joseph" matches a saved "Joseph", the contract doesn't say which spelling is stored. It also doesn't say whether a new name is stored trimmed.
- **Resolution:** Keep the existing spelling, and store new names trimmed. The tests only assert the trimmed new name and that the coworker `id` is stable, not which spelling wins.
- **Tests:** `repositories › coworkers › rememberTeam › stores a new name trimmed`, `… › matches existing coworkers by case-insensitive, trimmed name (no duplicates)`.

### 48. `lastWorked` can move backwards

- **What:** Saving or editing an **older** shift calls `rememberTeam` with an older date. "lastWorked = date" then moves a coworker down the quick-add list.
- **Resolution:** Use `lastWorked = max(existing, date)`, and only change `usualRole` when the date is at least the existing `lastWorked`. Not tested.

### 49. Case-insensitive matching of non-ASCII names

- **What:** SQLite's `lower()` and `NOCASE` only fold ASCII, so "Zoë" and "ZOË" won't match if the comparison is done in SQL.
- **Resolution:** Normalise in JS (`name.trim().normalize('NFC').toLocaleLowerCase()`), or store a normalised key column. Not tested. The tests only check that non-ASCII names and quotes round-trip.

### 50. Duplicate names within one team

- **What:** Two members both called "Sam" in one shift collapse into one coworker, and the last role wins.
- **Resolution:** Accept for v1; tie this to #45. Not tested.

### 51. Optional fields must stay absent, not null

- **What:** "Deep-equal" with Jest's `toEqual` treats a missing key and `undefined` as equal, but treats `null` as different. The tests require optional fields (`poolBasis`, `lastWorked`, `heldBack`, `keptHeldBack`, `keptSplit`, `isUser`, `hours`, `clockIn`/`clockOut`) to come back absent, not `null`. They also require nothing extra to appear after a JSON round-trip.
- **Resolution:** State this in the contract. When reading from nullable columns, omit null values rather than copying them through.
- **Tests:** `snapshot › saved shifts are snapshots › *: getShift deep-equals what was saved`, `repositories › profiles › each poolBasis value round-trips, and an absent poolBasis stays absent`, `repositories › coworkers › a coworker who never worked has no lastWorked …`.

### 52. Settings edge cases

- **What:** The contract doesn't define:
  - `setSetting(key, undefined)`, which has no JSON form;
  - a stored value that fails `JSON.parse` (a corrupt row).
- **Resolution:** Treat `undefined` as delete. Return the fallback on a parse error. Not tested. The tests do check that a stored `false` / `0` / `''` is returned rather than the fallback, and that a JSON-looking string stays a string.

### 53. Order of the two defaults in `listProfiles`

- **What:** "Default profiles first" doesn't say whether Server comes before Bartender, and doesn't give the collation for the name sort.
- **Resolution:** The tests accept either order for the two defaults. Suggest: the default for the user's role first in the UI, decided by the store, not the repository.
- **Tests:** `repositories › profiles › listProfiles: default profiles first, then the rest by name`.

### 54. Saved shifts can reference a deleted profile

- **What:** After `deleteProfile`, saved shifts still carry the old `input.profileId`. The snapshot rule makes viewing them safe, but **Edit** on such a shift (re-calculate) has no profile to load.
- **Resolution:** The History edit flow should fall back to the current default profile for the shift's `userRole`, and tell the user. Not an engine or repository test.

---

## G. Milestone 5 profiles & settings (test/m5-profiles)

### 55. `roleIdFromLabel` for unusual labels

- **What:** The contract says "spaces/punctuation → '-'". It doesn't cover:
  - accented letters (kept, stripped, or turned into '-'?);
  - non-Latin scripts and emoji;
  - apostrophes ("Hannah's crew" → `hannah-s-crew`);
  - near-misses of built-ins ("Bar Back" → `bar-back`, not `barback`).
- **Resolution:** The tests assume:
  - letters and digits in any script are kept (`\p{L}\p{N}`), so "Café Runner" → `café-runner`, with composed and decomposed input giving the same id;
  - an apostrophe becomes '-';
  - only exact built-in labels map to built-in ids.

  Suggestion: drop apostrophes rather than dashing them. Emoji-only labels clean to `''`, which `RULE_ROLE_REQUIRED` then catches.

- **Tests:** `profiles › roleIdFromLabel › *`.

### 56. "Kitchen" vs "Kitchen (KTO)"

- **What:** The kitchen role appears with two different names:
  - `roleLabel('kitchen')` returns "Kitchen (KTO)", which is what `displayRole` shows.
  - The contract's `profileSummary` example shows "Kitchen 2% of food sales".
- **Why:** Two names for one role. Also, a user who types the label the app itself shows ("Kitchen (KTO)") should get the built-in kitchen role, not a new `kitchen-kto` role.
- **Resolution:** The summary tests accept either form. The tests assume `roleIdFromLabel('Kitchen (KTO)')` returns `'kitchen'`. Decide on one short label for the summary.
- **Tests:** `profiles › profileSummary › Server default / Bartender default / only fixed rules`, `profiles › roleIdFromLabel › maps the built-in display label "Kitchen (KTO)" back to kitchen`.

### 57. Rule helpers given out-of-range indexes

- **What:** The contract doesn't say what `updateRule`, `removeRule` and `moveRule` do with an index of -1 or one past the end.
- **Resolution:** The tests assume they return an unchanged copy and don't throw. They also assume `moveRule` is an array move: remove at `from`, then insert at `to`.
- **Tests:** `profiles › rule editing helpers … › out-of-range indexes leave the rules unchanged and do not throw`, `… › moveRule moves first->last, …`.

### 58. A 0% pool

- **What:** A pool of 0% is within "0–100", so it isn't an error. But nothing would ever be tipped out.
- **Resolution:** The tests assume 0% and 100% are both error-free. Consider a warning for 0%, such as "nothing is tipped out".
- **Tests:** `profileValidation › valid profiles › pool percent 0 and 100 are in range`.

### 59. Several issues on one rule or profile

- **What:** The contract doesn't say whether one rule can carry several issues. Examples:
  - an empty role with a bad weight;
  - a duplicate bartender rule in a bartender profile, which is both `DUPLICATE_ROLE` and `BARTENDER_RULE_IN_BARTENDER_PROFILE`.

  It also doesn't say whether `NO_RULES` suppresses `NO_SHARE_RULE`.

- **Resolution:** The tests assume every issue is reported (no "first one wins"), in a stable order. They don't assert whether `NO_SHARE_RULE` appears alongside `NO_RULES`. Suggestion: suppress `NO_SHARE_RULE` when there are no rules at all.
- **Tests:** `profileValidation › ordering and stability › several problems on one rule are all reported, in a stable order`.

### 60. The unpaid remainder (no share rule) isn't reported

- **What:** With only fixed rules, the engine pays the carve-outs, and the rest of the pool stays in `kept`. It isn't counted in `retained` or in `roundingAdjustment`. A "Kitchen only" 30% profile on $400 shows `pool` $16, and nothing explains the gap.
- **Resolution:** Either add `ShiftResult.unallocated`, or have the engine also warn `NO_SHARE_RULE`, so the Results screen can say "$104 of the pool has no one to go to and stays with you".
- **Tests:** `customProfiles › no share rule … › *`.

### 61. Is `rule.role` or `rule.label` the source of truth?

- **What:** Custom rules carry both `role` (the slug) and `label`. The contract doesn't say whether `checkProfile` and the repository trust `role` as given or recompute it from `label`. Renaming a label in the editor also changes the role id. Then:
  - past shifts (snapshots) and coworkers' `usualRole` keep the old id;
  - History's per-role totals (M7) split one role into two.
- **Resolution:** Treat `role` as the source of truth, set once when the rule is created. Editing the label changes only the display, unless the user explicitly re-keys the role. The tests always pass a matching `role`.

### 62. Labels on built-in roles

- **What:** A custom label that maps onto a built-in ("Bartenders", "Servers") gives `role: 'bartender'` while keeping `label: 'Bartenders'`. The contract says built-ins "have no label".
- **Resolution:** The editor should drop the label when the role resolves to a built-in. The validation tests build such rules with a label to prove `DUPLICATE_ROLE`, `SELF_TIP_OUT` and #13d still fire.
- **Tests:** `profileValidation › … via a "Bartenders" label`, `… via a "Servers" label`, `DUPLICATE_ROLE when a custom label maps onto a built-in role`.

### 63. Infinite weights and non-normalised names

- **What:**
  - `RULE_WEIGHT_POSITIVE` only says "> 0", so `Infinity` passes.
  - `NAME_TAKEN` compares trimmed and lower-cased names, so composed and decomposed "Café" don't collide.
- **Resolution:** Also require finite weights. Normalise names to NFC before comparing, as `coworkerKey` already does (M4 #49). Neither is tested.

### 64. When onboarding shows

- **What:** "Shown when `onboarded` is not true and there are no saved shifts" leaves these cases open:
  - a stored non-boolean such as the string `'true'` from a bad write;
  - the app killed mid-onboarding (shows again, which is fine);
  - a failed DB read during hydrate, which looks like "no shifts" and would wrongly show onboarding;
  - a user who later deletes every shift (`onboarded` stays true, so it doesn't show; fine).
- **Resolution:** Use a strict `onboarded === true` check, and don't show onboarding if hydrate failed. These are store behaviours (implementer-owned tests), so none are tested here.

### 65. #44 can be bypassed by switching `appliesTo`

- **What:** The rule "can't delete the last profile for its `appliesTo`" can be dodged by **editing**: changing the only bartender profile to `appliesTo: 'server'` leaves no bartender profile. Also, "reset `defaultProfileId` to the remaining profile (built-in first)" doesn't say what happens if the built-in for that role was itself deleted.
- **Resolution:** Block changing `appliesTo` on the last profile for a role, either in the store or as a `checkProfile` issue that takes `others`. If no built-in remains, fall back to the first remaining profile by name.

### 66. Milestone 4 tests that break under milestone 5

- **What:**
  - `migrations.test.ts › migrate › SCHEMA_VERSION is 1 for milestone 4` fails once the schema is v2. This was confirmed against the stub; the other 118 M4 db tests passed against a v2 stub.
  - If the **repository's** `saveProfile` runs `checkProfile`, these M4 tests would also start throwing:
    - `repositories › profiles › a profile with no rules round-trips` (`NO_RULES`);
    - `repositories › profiles › each poolBasis value round-trips …`, whose copies share the name "Net sales pool" and so hit `NAME_TAKEN`.
- **Resolution:** The maintainer updates the version test to `SCHEMA_VERSION >= 1` or `2`; the tester may not edit it on this branch. Prefer validating in the store, or in a `saveProfileChecked` wrapper, so the repository stays a plain storage layer. Otherwise those M4 tests need valid fixtures.

### 67. `wholeDollarShares` and the engine default

- **What:** The setting defaults to `true`, matching the engine's `roundMemberShares` default. A missing setting therefore behaves the same as an omitted option.
- **Resolution:** No change. The tests check that `{ wholeDollarShares: true }` equals the engine's default output, and that the setting has no effect with rounding off.
- **Tests:** `customProfiles › "Whole-dollar shares for each person" setting … › *`.

---

## H. Milestone 6 hours (test/m6-hours)

### 68. 12-hour edge forms and `1200`

- **What:** The contract's rule "with a suffix the hour must be 1–12" makes `0pm`, `0am` and `00:00pm` invalid (null), while `12:00pm` → `12:00` and `12:00am` → `00:00`. A bare `1200` is read as `HHmm` → `12:00` (noon), and `1730pm` is null.
- **Why:** These are the forms users are most likely to get "wrong": `0:30am` for just after midnight, or `1200` meaning midnight.
- **Resolution:** The tests encode the contract as written. The hint text "e.g. 5pm, 17:00, 1730" should make the 24h reading of `1200` clear. Consider accepting `0:30am` as `00:30`, since it's unambiguous.
- **Tests:** `hoursInput › parseTimeInput › accepted forms` (`1200`, `12:00pm`, `12:00am`, `1200am`, `1200pm`) and `› rejections` (`0pm`, `0am`, `00:00pm`, `1730pm`).

### 69. What "space-insensitive" covers

- **What:** The tests assume leading and trailing spaces, and spaces between the number and the suffix (`5   pm`, `9 A.M.`, `12:30 A`), are all ignored. The contract doesn't say whether spaces _inside_ the number are allowed (`5 : 30`, `17 30`).
- **Resolution:** Strip all whitespace before parsing, so `17 30` → `17:30`. Not tested either way.

### 70. One-digit minutes and decimal-looking clock times

- **What:** `H:mm` and `H.mm` need two minute digits. So `5:3`, `5.3` and `5.5` are rejected, but someone typing `5.5` in a clock field might mean 5:30. `5:30:00` (with seconds) is assumed rejected.
- **Resolution:** Keep rejecting, and show the INVALID_TIME hint. `5:30:00` → null is tested; the one-digit-minute forms aren't.

### 71. Does a role's PARTIAL_HOURS count members whose hours have errors?

- **What:** The contract reports PARTIAL_HOURS only when another member of the role has **valid** hours. If the only member with hours has an error, the rest of the role gets nothing. Then the moment that error is fixed, every other member gets PARTIAL_HOURS. The list of problems changes one fix at a time.
- **Resolution:** The tests encode the contract. An alternative is to treat "entered but invalid" as enough to trigger PARTIAL_HOURS for the others, so the user sees every problem at once.
- **Tests:** `teamHours › PARTIAL_HOURS › is not emitted when nobody in the role has valid hours`, `… › is not emitted for a member with an error of their own`.

### 72. Zero hours

- **What:** `parseHoursInput` rejects `0`, but the engine accepts `hours: 0`: that member gets $0, and a role where everyone has 0 hours splits equally (review #7). Someone who clocked in and left right away can't be recorded with 0 hours.
- **Resolution:** Keep rejecting 0 (the user should remove the member instead), and make the INVALID_HOURS message say so. Otherwise, allow 0 and rely on the ZERO_SHARE note. Owner or maintainer to decide.
- **Tests:** `hoursInput › parseHoursInput › "0" -> null …`, `teamHours › … INVALID_HOURS for hours text "0"`.

### 73. Check the range before or after rounding to 2 decimals?

- **What:** The contract doesn't say whether "> 0 and ≤ 24" is checked before or after rounding. The tests assume **after**, so `0.001` rounds to 0 and is rejected. By the same rule, `24.004` would round to 24 and be accepted; that case isn't tested.
- **Tests:** `hoursInput › parseHoursInput › results always have at most 2 decimals` (asserts the result is > 0).

### 74. LONG_SHIFT at 16 hours

- **What:** A bartender's double (11am–3am) is exactly 16h, which doesn't warn because the threshold is > 16. An hour longer does warn. The warning doesn't block, so the only cost is noise. Total hours > 24 can't be entered at all (INVALID_HOURS).
- **Resolution:** Keep it as a warning. Consider 18h, or wording like "Long shift — double-check the times" rather than implying an error.
- **Tests:** `teamHours › no issues › 16h exactly is not a long shift`, `› LONG_SHIFT is a warning only`.

### 75. Blank typed text clears a value

- **What:** "Works on what the user typed (when present)" doesn't say what a present but **blank** field (`''` or spaces) means.
- **Resolution:** The tests assume blank text means "cleared": no hours, and no fall-back to the committed value. `commitTeamHours` in `src/test-support/hoursFixtures.ts` follows the same rule.
- **Tests:** `teamHours › PARTIAL_HOURS › blank text counts as no hours`, and the key property.

### 76. Hours text and clock text on the same member

- **What:** The UI is either/or, but nothing stops a draft from holding both an hours text and clock texts, or a committed `hours` plus typed clock times. The contract doesn't say which one is checked. Combinations like this are also the only way to get an error and a LONG_SHIFT warning on the same member, which is the only case where the "within a member, errors first" ordering rule matters.
- **Resolution:** Total hours win, matching the engine (`hours` beats clock times). Switching the panel between modes should clear the other mode's fields. Not tested.

### 77. Several problems on one member

- **What:** "One issue per member problem" doesn't say whether two unreadable times (clock-in and clock-out) give one INVALID_TIME or two.
- **Resolution:** One INVALID_TIME per member is simplest to show. The tests only ever make one field bad.

### 78. Kitchen members bypass the checks but not the engine

- **What:** `rolesThatSplit` leaves kitchen out, since kitchen never has named members. But the engine resolves hours for **every** profile rule role that has members, and that includes `kitchen` (`rolesNeedingHours` in `calculate.ts`). A kitchen member with a bad clock pair passes `checkTeamHours` and then makes `calculateShift` throw INVALID_CLOCK. That breaks the contract's guarantee.
- **Resolution:** Either the engine skips hour resolution for roles that are never split (kitchen), or the store adds any profile role that has members to `rolesThatSplit`. The key property only generates bartenders, barbacks and hosts to stay inside the contract.
- **Tests:** `teamHours › property: checkTeamHours error-free => calculateShift never throws …` (kitchen excluded deliberately).

### 79. `copyHoursToRole` and pending drafts

- **What:**
  - Copying writes **committed** values. Another member with leftover typed text (`hoursText`) would then win over the copied value, because typed text takes precedence.
  - Copying from a member with no hours isn't defined (it would presumably clear the others). The UI only shows the link on a member with valid hours, so this shouldn't happen.
- **Resolution:** When copying, the store should clear the other members' `*Text` drafts. Not tested; `copyHoursToRole` takes plain `TeamMember`s.
- **Tests:** `hoursInput › copyHoursToRole › *` cover hours, clock times, other roles, immutability, unknown id and single-member roles.

### 80. `clockHours` only accepts strict `HH:mm`

- **What:** `clockHours` is specified for two `HH:mm` values. The tests assume it doesn't do forgiving parsing itself (`abc` → null). The UI must run `parseTimeInput` first.
- **Tests:** `hoursInput › clockHours › invalid input …`.

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
| Odd-dollar rule and held-back dollars (owner Q7)                        | `wholeDollars.test.ts`, `golden`, `calculate › whole-dollar held-back …`   |
| `ZERO_SHARE_AFTER_ROUNDING` (owner Q8)                                  | `calculate › ZERO_SHARE_AFTER_ROUNDING warning`, `properties`              |
| `TeamMember.isUser` ignored by the engine (owner Q9)                    | `calculate › TeamMember.isUser …`, `properties`                            |
| M4: schema, version, idempotent migrate, cascades, integer money        | `src/db/__tests__/migrations.test.ts`                                      |
| M4: default-profile seeding                                             | `src/db/__tests__/seed.test.ts`                                            |
| M4: profiles / shifts / coworkers / settings repositories               | `src/db/__tests__/repositories.test.ts`                                    |
| M4: saved shifts are snapshots (incl. fast-check round-trip)            | `src/db/__tests__/snapshot.test.ts`                                        |
| M5: pure profile helpers                                                | `src/lib/__tests__/profiles.test.ts`                                       |
| M5: `checkProfile` codes, ordering, error-free ⇒ engine never throws    | `src/lib/__tests__/profileValidation.test.ts`                              |
| M5: schema v2 (rule labels) migration from v1                           | `src/db/__tests__/migrations-v2.test.ts`                                   |
| M5: editor-style profiles end to end, `wholeDollarShares` path          | `src/engine/__tests__/customProfiles.test.ts`                              |
| M6: time/hours parsing, clockHours, formatHours, copyHoursToRole        | `src/lib/__tests__/hoursInput.test.ts`                                     |
| M6: checkTeamHours codes, precedence, PARTIAL_HOURS, ordering, property | `src/lib/__tests__/teamHours.test.ts`                                      |
