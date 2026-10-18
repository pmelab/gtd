# Requirements: PR #393 review fixes

Fix four review findings on the flag-state test runner (`npm test`, PR #393,
closes #372). **Each fix ships with a `tests/tooling/test-states.test.ts` case
that fails before the fix.** `docs/development.md` and the PR description follow
any changed behaviour.

## Open Questions

### What happens when the user passes their own `--log-prefix`?

The runner now always adds `--log-prefix=task`, and turbo 2.10.9 refuses
`--log-prefix` given twice. So `npm test -- --log-prefix=none` needs a defined
outcome.

- [ ] User value replaces the default; collapsing turns off unless it is `task`
  - mirrors how `--output-logs` already works
  - `--log-prefix=none` prints every failing state's full log, no "same failure
    as" lines
- [ ] Runner refuses up front with a clear message, runs nothing
  - prefix is pinned, never user-tunable
  - one more error path to test
- [ ] Runner drops the user's value silently, always uses `task`
  - simplest code
  - user's flag has no effect, with no warning
- [ ] _your answer_

## 1. Always pass `--log-prefix=task` — TECHNICAL

Turbo's default `--log-prefix=auto` switches to GitHub Actions log groups in CI
and drops the `<task>: ` line prefix. **Result in CI: `failureSignature` keeps
no lines, every signature is empty, and repeated failures never collapse.** The
real-turbo test breaks there for the same reason.

- **`turboArgv` always emits `--log-prefix=task`**, in every environment.
- A user `--log-prefix` follows the answer to the open question above.
- Tests: `turboArgv` and the shim-turbo argv case show `--log-prefix=task`; the
  real-turbo test runs with `GITHUB_ACTIONS=true` in its env and still gets a
  non-empty, stable signature.

## 2. Only `--output-logs full` turns on full mode — TECHNICAL

Today any user `--output-logs` value turns off collapsing and prints passing
states' logs. **Full mode applies only when the value is `full`** — both the
`--output-logs=full` and the `--output-logs full` spelling.

- Any other user value (`errors-only`, `new-only`, `hash-only`, `none`) still
  replaces the default in the argv, but collapsing stays on and passing states
  print only their label.
- **One shared, exported helper answers both questions** — "did the user pass
  `--output-logs`?" (for `turboArgv`) and "is it `full`?" (for the entry point's
  `full` argument). The duplicated predicate in `scripts/test-states.main.ts`
  goes.
- Tests: the helper over `=full`, `full` as a separate arg, `=new-only`,
  `new-only` as a separate arg, and no flag.
- `docs/development.md` keeps saying `--output-logs=full` never collapses; it
  must not imply other values do the same. PR #393's "Decisions" bullet ("A
  user-supplied `--output-logs` … turns collapsing off") gets the same
  correction.

## 3. Hex normalisation strips only 16-char turbo hashes — TECHNICAL

`failureSignature` replaces any run of 12+ hex chars with `<hex>`. **That also
erases git shas (40 chars, or 12+ abbreviated), so two failures differing only
in a commit sha collapse into one — a different failure hidden.** That breaks
the PR's own rule: normalisation leans toward "distinct".

- **Replace only whole-word runs of exactly 16 hex chars** (turbo's task hash).
- Tests: two outputs differing only in a 16-char hash share a signature; two
  differing only in a 40-char sha, and in a 12-char abbreviated sha, do not.

## 4. Real-turbo test resolves turbo from the repo root — TECHNICAL

The "failureSignature against real turbo" test builds the turbo path from
`process.cwd()`. **Run from any directory other than the repo root, it cannot
find turbo.**

- **Resolve `node_modules/.bin/turbo` from the test file's own location**
  (`import.meta.url`, two levels up), never from `cwd`.
- The test builds its argv with `turboArgv`, so it exercises the real flags the
  runner sends, `--log-prefix=task` included.

## Answered Questions

### Do the three deferred review notes in `.gtd/TODO.md` still apply?

No. The human deleted all three (note-1 `runSummaryCommand` doc comment, note-2
`gtd history list` scenario, note-3 garbled-flag stdout assertion) in the same
edit that added this sketch; they are dropped, not folded.

### Does the README need a change?

No. The runner's output behaviour is documented in `docs/development.md` only;
the README does not describe it.
