# Requirements

## Concerns

### 1. Build #372(b): condense repeated failures across flag states (PRODUCT)

- Build #372 follow-up (b) as an ordinary `feature` process on
  `feat/384-dogfood-stacked`: **`npm test` stops repeating a failure once per
  release-flag state.** The change lives in the `scripts/test-states.ts` runner;
  the shipped health check and its `.gtd/FEEDBACK.md` writing stay as they are.
- **Done when: one test red in all three states (defaults, `naive_pass` on,
  `risk_tier` on) produces a failure report the size of one state's output, not
  three.**
- **The first failing state prints its full output.** Every later failing state
  is compared against the earlier failing states:
  - **same failures (same failing tasks and same failing test names) → one
    line** naming the earlier state it matches
  - **different failures → only that state's own differing failing tasks'
    output**, so a flag-specific failure still shows in full
- **A later state that passes prints only its pass line.** Every state still
  runs; the runner never stops at the first failure.
- **The pass/FAIL line per state and the runner's exit status stay as today**
  (exit 1 when any state failed, 0 only when all passed).
- **`npm test` keeps streaming live output to the terminal** for the first
  state; condensing applies to what later states repeat.
- Covered by unit tests beside the runner in `tests/tooling/test-states.test.ts`
  (it is tooling, not a gtd feature, so no `.feature` scenario applies). A
  README or docs update is due only if the change alters something a user of
  `npm test` reads there.
- **This process already runs with `flag_naive_pass=1` and `flag_risk_tier=0`**
  (pinned in the entry commit's `Gtd-Var` trailers), so the naive pass and
  seam.judge run as-is. Leave both flags exactly as they are.
- Closing comment on #372 notes that (b) is done and (a) stays open.

### 2. Walk the refactor-first path to two slices (PRODUCT)

- seam.judge rules `refactor-first`. The refactor is built and reviewed on its
  own, then the feature is implemented and reviewed.
- **History must hold two slices, `refactor` and `feature`.** `gtd slices` lists
  both before shipping.
- **The refactor slice must change no behaviour:** the suite stays green after
  it, with no test edits beyond what the refactor review allows.
- **If seam.judge does not rule refactor-first, unwind and restart this process
  with a change more clearly shaped as refactor-first.** Nothing ships from the
  missed run; the miss is filed as friction (concern 4).

### 3. Ship as two stacked PRs (PRODUCT)

- `/gtd ship` (the Claude Code mod) opens two PRs: the refactor PR against
  `main`, and the feature PR stacked on top of it.
- **The human merges the refactor PR first.** Re-running `/gtd ship` then
  restacks the feature PR onto `main` (the #383 behaviour), and the feature PR
  merges after that.
- Each PR title and squash message follows `docs/commits.md`; COMPATIBILITY.md
  decides `!`.

### 4. File the friction and the parked review notes (PRODUCT)

- **Every snag hit along the way becomes a GitHub issue labelled
  `track:dogfood`, with a body that references #384.**
- First check existing open `track:dogfood` issues (#371–#373); add a comment to
  a matching issue rather than filing a duplicate.
- **File the three deferred review notes the sketch removed as one GitHub
  issue**, kept out of this process's packages: restore
  `expect(captured().stdout).toBe("")` in the garbled-flag CLI test; strengthen
  the `gtd history list` scenario (finish a process that kept a tip, assert only
  the finished process shows, never the kept ref); add the `--slice` refusals
  (unknown slice name with valid slices listed, config edited since a closed
  process, diverged replay) to the `runSummaryCommand` doc comment.
- **#384 closes only when concerns 2–4 all held.**

## Answered Questions

### Is friction filing a build package?

No. Filing happens via `gh`, outside the build packages: a package that changes
no file lands an empty attempt and stalls (#373 item 2).

### Who runs ship and merges?

The human does, through the mod's `/gtd ship`, as #384's acceptance states. The
agent never merges a PR.

### Which real change does this dogfood ship?

#372(b): dedupe health-check feedback across release-flag states, by editing the
existing `scripts/test-states.ts` runner.

### What if seam.judge does not rule refactor-first?

Unwind and restart the process with a change more clearly shaped as
refactor-first, keeping #384's acceptance in reach on this branch at the cost of
a full extra run.

### What happens to the three deferred review notes the sketch deleted?

File them as one GitHub issue and keep them out of this process, so the dogfood
diff stays focused on the chosen change.

### Where does the condensing live: the runner or the shipped health check?

The runner. The picked option named `scripts/test-states.ts`, and a change to
the shipped health check would alter every user's feedback, not just this
repo's.

### Which change replaces #372(b) if the run has to restart?

#339 (turn durations in the closing summary) by default: it touches land and
summary code, so a refactor is very likely. The restart is a fresh process, so
the human can still pick another in its sketch.

### What does a run that is red in several flag states print?

Full output for the first failing state; each later failing state prints one
line when its failing tasks and test names match an earlier state, and only its
own differing failing tasks' output when they differ. A failure red everywhere
costs one state's output, while a flag-specific failure still shows in full.
