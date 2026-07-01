# Update tests in `src/Prompt.test.ts`

Update the existing `"await-review leads with the STOP constraint"` test to
match the new wording from `stop.md`, and add a new `"STOP banner"` describe
block covering all human-gate states.

## Acceptance criteria

- [ ] Existing test `"await-review leads with the STOP constraint"` is updated:
  - asserts `"STOP — do not re-run \`gtd\`"` is still present (wording unchanged
    in the new partial)
  - removes the assertion for `"auto-approve the review"` (that text was
    specific to the old bespoke block in `await-review.md` and is now gone)
  - keeps the position check: STOP banner appears before
    `"Await the user's review"` heading
- [ ] New `describe("STOP banner", ...)` block added with the following tests:
  - `"escalate leads with the STOP banner"` — output contains `"⛔"`, and `"⛔"`
    appears before `"Escalate — the test gate"`
  - `"idle leads with the STOP banner"` — output contains `"⛔"`, and `"⛔"`
    appears before `"Nothing to do"`
  - `"grilling stop-case leads with the STOP banner"` — output contains `"⛔"`,
    and `"⛔"` appears before `"Open questions await the user"` (use
    `result("grilling", { autoAdvance: false, context: { grillingCase: "stop" } })`)
  - `"clean does NOT get the STOP banner despite autoAdvance: false"` — output
    does NOT contain `"⛔"` (use `result("clean")`)
  - `"auto-advance states do NOT get the STOP banner"` — covers `grilled`,
    `planning`, `building` (via `withPackage`), `fixing`, `agentic-review` (via
    `withPackage`), `grilling` iterate-case, and `clean`; none contain `"⛔"`
- [ ] All tests pass after this package (full suite green)
- [ ] No changes to any non-test file in this package

## Files

- **Modify**: `src/Prompt.test.ts`

## Constraints / edge cases

- The `"STOP states carry no {{MODEL}}"` test (line 188) already covers
  `await-review`, `escalate`, `idle` — do NOT alter it.
- Use the existing `result()` and `withPackage()` helpers — no new helpers
  needed.
- For the grilling stop-case test, the `autoAdvance` helper default is `true`;
  pass `autoAdvance: false` explicitly to `result()`.
- The `"⛔"` character is the literal Unicode codepoint U+26D4; use it directly
  in assertions rather than `"STOP"` alone so the test proves the banner is the
  partial and not some other STOP mention.
- Position checks use `.indexOf(a) < .indexOf(b)`; assert `indexOf("⛔") >= 0`
  first (or use `toContain`) before the ordering assertion.
