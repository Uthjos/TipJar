# Test findings: calc engine acceptance suite

Author: Agent 2 (Tester), branch `test/engine`. Audience: the maintainer merging `test/engine` with the implementation branch.

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

### 3. Whether individual shares round to whole dollars (§11 Q1)
- **What:** The default `roundMemberShares = off` gives $16.50 / $16.50 (server example) and $20.50 / $20.50 (bartender example). Turning it on gives $17 / $16 and $21 / $20, with the extra dollar going to the first-listed member.
- **Why:** The two source examples disagree.
- **Resolution:** The owner decides the default. The tests cover both settings, so changing the default won't break them. Two more assumptions:
  - (a) `roundMemberShares` **does nothing when `roundToDollar` is off**.
  - (b) It is **not applied to `keptSplit`**. No test asserts `keptSplit` amounts with it on; only `sum(keptSplit) == kept` is checked. The owner should confirm whether bartenders' kept shares should also be whole dollars.
- **Tests:** `golden › * › with roundMemberShares …`, `calculate › rounding OFF › roundMemberShares has no effect when roundToDollar is off`, `properties › with rounding on, every role amount is a whole dollar (and members too with roundMemberShares)`.

### 4. Leftover cents after flooring stay with the bar (§11 Q2)
- **What:** The tests expect the bar to keep **$149.55**, split Joseph $74.78 / Aaron $74.77. The source doc shows $149 and $74.50 each.
- **Why:** The doc drops the $0.55 left after flooring the $57.77 pool, and its $74.50 comes from $67.50 + $7. Neither matches the cent-exact rule (`kept = tips − pool`).
- **Resolution:** Keep the spec's behaviour. If the owner wants $149 displayed, do it at the UI layer, not in the engine. If the owner wants the engine to drop the cents, `kept + pool == totalTips` stops holding and roughly 6 tests and 1 property need rewriting.
- **Tests:** `golden › Golden 2 retain › bar keeps $149.55 …`, `… › kept is split between Joseph $74.78 and Aaron $74.77`, `golden › Golden 2 redistribute › kept split Joseph $67.78 / Aaron $67.77`, `properties › kept + pool == totalTips`.

### 5. Default for a missing role (§11 Q3)
- **What:** `missingRoleHandling` is a required field on `ShiftInput`, so the engine has no default. The `redistribute` default in §5.1 belongs in the UI/store.
- **Resolution:** Put the default in the store and test it there in milestone 3. `shiftInput()` in the builders defaults to `'redistribute'` to match.
- **Tests:** none directly.

---

## B. Behaviour the spec leaves undefined (what the tests assume)

### 6. Clock-time edge cases and `INVALID_CLOCK`
- **What:** Several clock cases aren't defined:
  - (a) `clockOut === clockIn`: the contract says `<=` counts as next day, so this is a **24h** shift. That is almost certainly a typo by the user.
  - (b) `INVALID_CLOCK` can't fire on ordering, because any ordering is "next day". The tests assume it means **an unparseable clock string**.
  - (c) An ISO time without a UTC offset is parsed as *local* time, so on a DST-change night an overnight shift comes out ±1h.
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
  - (d) The bartender flow with a profile that *does* include a `bartender` rule, where the same people would be both recipients and kept-sharers.
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

### 19. Percent basis for the pool itself (§11 Q4)
- **What:** `totalTipOutPercentOfTips` makes the pool always a percentage of **tips**. The tests cover carve-outs on `netSales` and `totalTips`. A pool that is a percentage of sales (common in some restaurants) is not expressible.
- **Resolution:** If the owner says some restaurants use a % of sales, add `poolBasis` to `TipOutProfile`, plus a golden test.
- **Tests:** `calculate › custom profiles › *`.

---

## Coverage map vs. the brief

| Brief item | Where |
|---|---|
| Golden 1 / Golden 2 retain / redistribute (+ roundMemberShares) | `golden.test.ts` |
| Rounding off | `calculate › rounding OFF` |
| Unequal hours (roles + keptSplit) | `calculate › hours: unequal splits` |
| Clock-in/out across midnight | `hours.test.ts`, `calculate › hours: clock-in / clock-out across midnight` |
| Both missing-role options | `golden`, `calculate › missing roles` |
| Zero food sales / zero tips | `calculate › zero food sales`, `› zero tips` |
| Custom profile (netSales / totalTips basis, custom role ids, 0% / 100%) | `calculate › custom profiles` |
| Carve-outs exceed pool (cap + warning) | `calculate › carve-outs exceeding the pool` |
| Food > net warning | `calculate › food > net sales` |
| PARTIAL_HOURS and the other validation codes | `calculate › hours: partial hours …`, `› validation errors` |
| Largest-remainder tie-breaking | `money.test.ts`, plus member/keptSplit tie tests |
| fast-check invariants | `properties.test.ts` (seed 20261118, 400 runs) |
