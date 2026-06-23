# fix-tests prompt: emit the `Gtd-Test-Fix:` trailer on the success commit

The counted signal is now the `Gtd-Test-Fix:` commit trailer, not the
`fix(gtd):` subject. The fix-tests prompt is the ONLY emitter of this trailer, so
it must instruct the agent to add it. Keep the `fix(gtd): <desc>` subject for
readability.

## Files

- `src/prompts/fix-tests.md`

## Details

- The "On success" bullet (lines ~20-21) currently says: commit all fix changes
  in a single `fix(gtd): <desc>` commit. Update it to instruct a commit that
  ALSO carries the trailer in the body, e.g.:

  ```
  git commit -m "fix(gtd): <desc>" -m "Gtd-Test-Fix: <n>"
  ```

  where `<n>` is the attempt number.
- State explicitly that the `Gtd-Test-Fix:` trailer — NOT the `fix(gtd):`
  subject — is what the verify/escalate gate counts, so the trailer is
  load-bearing and must always be present on a test-fix success commit.
- Leave the ERRORS.md / recurring-signature / escalation instructions (lines ~7,
  11, 14, 24) unchanged.

## Acceptance criteria

- [ ] The "On success" instruction includes a `Gtd-Test-Fix: <n>` trailer in the
      commit body.
- [ ] The `fix(gtd): <desc>` subject is retained (test-gate.feature asserts
      `stdout contains "fix(gtd): <desc>"`).
- [ ] The prompt states the trailer is the counted signal.
- [ ] `npm run test` and the e2e suite pass.

## Constraints / edge cases

- Do not change the subject text `fix(gtd): <desc>` — `test-gate.feature` line 44
  asserts it appears verbatim in stdout.
- File-disjoint: edit only `src/prompts/fix-tests.md`.
- NOTE: this prompt is bundled into `scripts/gtd.js` at build time; the bundle is
  rebuilt in package `02-rebuild-bundle` (the e2e hooks also rebuild at runtime,
  so the suite stays green within this package even before the committed bundle
  is refreshed).
