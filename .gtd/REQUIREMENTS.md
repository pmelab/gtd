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

### 2. `npm test` prints only what failed (PRODUCT)

A red suite today prints the full turbo output of every flag state; gtd's check
step copies it verbatim into `.gtd/FEEDBACK.md`, and the #355 run produced 1187
lines, mostly the same failure repeated per state (issue #372 follow-up b).

- **Scope: this repo's `npm test` runner only** (`scripts/test-states.ts`).
  gtd's check step and its "verbatim" `.gtd/FEEDBACK.md` contract stay unchanged
- **Passing tasks' logs are hidden always** — terminal and redirected output
  alike; a run shows each state's `pass`/`FAIL` line plus failing tasks' logs
- **A flag state failing the same way as an earlier state prints one line**
  naming that earlier state (e.g. "same failure as `defaults`") instead of the
  log again
- "Same" means the same failing tasks with the same failure text after stripping
  durations, timestamps and cache hashes — never byte-identical
- **The first occurrence of each distinct failure prints in full** (test name,
  assertion, stack); condensing never drops it
- Exit code unchanged: any failing state still exits 1
- **Risk: other repos with noisy suites keep the oversized-FEEDBACK problem** —
  accepted by the scope choice
- **Risk: an oversized report still blinds the retry judge elsewhere** —
  evidence over `judgeBudgetBytes` (32768) is truncated, and truncated evidence
  is never ruled "identical"; this fix only shrinks this repo's report under
  that bar
- Unit tests in `tests/tooling/test-states.test.ts` pin the condensed shape;
  `npm test` green

### 3. Docs follow the change

- `docs/development.md`'s `npm test` paragraph states that only failing tasks'
  logs print and repeated failures across flag states collapse to one line
- No change to `README.md`, `docs/configuration.md`, or any gtd user-facing doc
  — the check step's contract is untouched

## Answered Questions

### Do the three deferred review notes (836985b, daed27f, eda53bb) get built?

No. The human deleted all three from `.gtd/TODO.md` in the entry commit,
replacing them with the #372 directive — that removal is the decision.

### Does a later flag state's failure count as "the same" only when byte-identical?

No — the same failing tasks with the same failure text after stripping
durations, timestamps and cache hashes counts as the same; byte-identical never
matches across runs because vitest/turbo timings differ every run.

### Where does the feedback condensing live?

This repo's `npm test` runner only. gtd's check step keeps copying test output
into `.gtd/FEEDBACK.md` verbatim; no size cap, no user-facing contract change.

### Does `npm test` hide passing tasks' logs always, or only when its output is captured?

Always — one behaviour in a terminal and under gtd's redirected check alike.

### Can a developer still see full logs locally?

Yes, without new code: turbo options after `--` already reach every turbo run,
so `npm test -- --output-logs=full` restores them; `docs/development.md` names
it.
