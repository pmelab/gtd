# Test `seedNewFeature` when `gtd: new task` is the first commit

## Description

Add a unit test in `src/Events.test.ts`, alongside the existing `seedNewFeature`
tests (current lines 533 and 542), exercising the no-parent-commit case that the
fix targets.

The existing two tests both rely on `initRepo`, which always lays down a
`chore: init` baseline so `HEAD~1` always resolves — that is why the bug was
never caught. The new test needs a repo with **no baseline commit**: init the
repo and configure git user (`user.name`, `user.email`, `commit.gpgsign false`),
set cwd, but make NO `chore: init` commit. Per AGENTS.md no-one-off-setup
guidance, inline this minimal setup in the test body (or add a boolean parameter
to `initRepo` that skips the baseline commit) rather than adding an abstract
helper. Restore cwd / clean up the tmp dir the same way the existing tests do.

Then write a feature file (e.g. `feature.ts` with `export const raw = 1\n`), run
`runPerform({ kind: "seedNewFeature" })`, and assert.

## Acceptance criteria

- [ ] New `it(...)` added near the existing `seedNewFeature` tests in
      `src/Events.test.ts`
- [ ] Repo set up with NO baseline `chore: init` commit (so `gtd: new task` is
      the first and only commit)
- [ ] Asserts `git log -1 --format=%s` === `gtd: new task`
- [ ] Asserts `TODO.md` exists AND its content **contains the captured change**
      (e.g. the feature file name or `export const raw = 1`) — not merely the
      `Captured input` header. This is the assertion that fails before the fix.
- [ ] Asserts the feature file no longer exists in the working tree (reverted to
      baseline)
- [ ] tmp dir cleanup / cwd restore handled (no leaked dirs, no cwd leak)
- [ ] Full test suite passes, including the two pre-existing `seedNewFeature`
      tests (parent-commit path must remain unchanged)

## Relevant files

- `src/Events.test.ts` — add the test near lines 533-552; reuse `git()`,
  `runPerform`, `writeFileSync`, `readFileSync`, `existsSync`, `cleanup` helpers
- `src/Events.test.ts:34` — `initRepo` (always commits baseline; the reason a
  custom no-baseline setup is needed)

## Constraints

- Touch **only** `src/Events.test.ts`. Do NOT edit `src/Events.ts` (parallel
  task in this package).
- Reuse existing test helpers (`git`, `runPerform`, `cleanup`) rather than
  introducing new abstractions.
- Do not run `git add` / `git commit`.
