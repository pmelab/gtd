## Open Questions

### Where does the feedback condensing live?

The 1187 lines came from this repo's own `npm test` runner (one full turbo log
per release-flag state), but gtd's check step copies any test command's output
into `.gtd/FEEDBACK.md` verbatim — and docs promise "verbatim". Fixing the
runner helps only this repo; fixing the check step changes what every gtd user's
fix turn reads.

- [ ] This repo's runner only
  - `npm test` prints failing tasks' logs only, and a flag state whose failure
    matches an earlier state's prints one "same failure as `defaults`" line
    instead of the log again
  - gtd's `.gtd/FEEDBACK.md` contract stays verbatim; no user-facing change, no
    docs change beyond `docs/development.md` if it describes the runner
  - other repos with noisy suites keep the problem
- [ ] gtd's check step, for every user
  - `.gtd/FEEDBACK.md` gets a size cap (keep the head and tail, drop the middle
    with a marker)
  - changes a documented contract: `docs/configuration.md` "verbatim" wording
    and the retry judge's input both shift
  - risk: a cap can cut the one line that names the real failure
- [ ] Both
  - runner dedupes flag states here; check step caps size for everyone as a
    backstop
  - largest change; carries the cap's cut-the-real-error risk too
- [ ] _your answer_

### Does `npm test` hide passing tasks' logs always, or only when its output is captured?

Hiding passing logs is most of the cut, but a developer running `npm test` in a
terminal loses the live progress they see today.

- [ ] Always
  - one behaviour everywhere; a local run shows only failures and the per-state
    pass/FAIL lines
- [ ] Only when stdout is not a terminal
  - gtd's check (output redirected to a file) gets the short form; a terminal
    run keeps full logs
  - two behaviours to test
- [ ] _your answer_

## Concerns

### 1. The repo-config test derives its workflow list (TECHNICAL)

`tests/tooling/package-exports.test.ts` › "this repository's config" › "loads,
running the shipped workflows" pins `workflowNames` to the literal
`["cleanup", "feature", "fix", "review", "rollout"]`. Adding or removing a
workflow export in `gtd.config.ts` reds `test:unit` in every flag state (issue
#372 follow-up a).

- Derive the expected list from what `gtd.config.ts` actually exports, so a
  config change updates one place
- Keep the test's real guard: the config loads, the default workflow is
  `feature`, every exported workflow is startable
- Green on its own: `npm run test:unit`

### 2. Condensed health-check feedback (PRODUCT)

A red suite today writes the full turbo output of every flag state into
`.gtd/FEEDBACK.md`; the #355 run produced 1187 lines, mostly the same failure
repeated per state (issue #372 follow-up b).

- Identical failures across flag states appear once, with the other states named
  as failing the same way
- The real failing output (test name, assertion, stack) always survives
  condensing
- Scope and terminal behaviour follow the two open questions above
- **Risk: an oversized report also blinds the retry judge** — evidence over
  `judgeBudgetBytes` (32768) is truncated, and truncated evidence is never ruled
  "identical", so a repeated red never escalates early
- A `@inmem` scenario or unit test pins the condensed shape; `npm test` green

### 3. README and docs follow the change

- Any user-visible change from concern 2 lands in `README.md` /
  `docs/configuration.md` in the same slice
- A runner-only change touches no user docs (AGENTS.md: docs describe use, not
  build)

## Answered Questions

### Do the three deferred review notes (836985b, daed27f, eda53bb) get built?

No. The human deleted all three from `.gtd/TODO.md` in the entry commit,
replacing them with the #372 directive — that removal is the decision.

### Does a later flag state's failure count as "the same" only when byte-identical?

No — the same failing tasks with the same failure text after stripping
durations, timestamps and cache hashes counts as the same; byte-identical never
matches across runs because vitest/turbo timings differ every run.
