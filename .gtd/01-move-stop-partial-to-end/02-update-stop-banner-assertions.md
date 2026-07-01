# Update STOP-banner position assertions in `src/Prompt.test.ts`

The STOP banner (`⛔` / `stopPartial`) now renders _after_ all content instead
of before the task heading. Flip the position assertions and comment to match.

## Description

Several tests assert the STOP banner appears _before_ the task heading using
`toBeLessThan`. After the move (companion task `01`), the banner appears _after_
all content, so each of these must become `toBeGreaterThan`. Wording in the
"leads with" test names/comments should reflect the new order.

## Changes

In the `"STOP banner"` describe block:

- Line ~201:
  `expect(out.indexOf("⛔")).toBeLessThan(out.indexOf("Escalate — the test gate"))`
  → change `toBeLessThan` to `toBeGreaterThan`
- Line ~207:
  `expect(out.indexOf("⛔")).toBeLessThan(out.indexOf("Nothing to do"))` →
  change `toBeLessThan` to `toBeGreaterThan`
- Line ~215:
  `expect(out.indexOf("⛔")).toBeLessThan(out.indexOf("Open questions await the user"))`
  → change `toBeLessThan` to `toBeGreaterThan`

In the `await-review` test (lines ~89–96):

- Line ~92: comment "constraint must appear before the task heading" → change to
  "constraint must appear after all content"
- Lines ~93–95:
  `expect(out.indexOf("STOP — do not re-run")).toBeLessThan(out.indexOf("Await the user's review"))`
  → change `toBeLessThan` to `toBeGreaterThan`

## Acceptance criteria

- [ ] All three `⛔` position assertions in the `"STOP banner"` block use
      `toBeGreaterThan`
- [ ] The `await-review` assertion for `"STOP — do not re-run"` uses
      `toBeGreaterThan`
- [ ] The `await-review` inline comment reads "constraint must appear after all
      content" (no longer "before the task heading")
- [ ] `npm test` (or the project test runner) passes with the companion
      `src/Prompt.ts` change applied
- [ ] Test names/descriptions that still say "leads with" remain acceptable if
      they don't assert order incorrectly — only flip the assertions and the one
      comment specified above; do not rename tests unless a name asserts a false
      ordering

## Files

- `src/Prompt.test.ts` — `"STOP banner"` describe block (lines ~197–216) and the
  `await-review` test (lines ~89–96)

## Constraints / edge cases

- The `toContain("⛔")` / `toContain("STOP — do not re-run")` assertions stay
  unchanged — only the `indexOf` ordering comparisons flip.
- Runs in parallel with `01-move-stop-partial-in-prompt.md`; file-disjoint.
