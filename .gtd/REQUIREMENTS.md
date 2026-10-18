# Requirements

## Open Questions

### Which real change does this dogfood ship?

The sketch says to pick one. It must edit an existing file outside `seamAllow`
(tests, `.feature` files and `.gtd/**` don't count), or seam.judge has nothing
to rule refactor-first on.

- [x] #372(b): dedupe health-check feedback across release-flag states
  - edits the existing `scripts/test-states.ts` runner, which is a likely
    refactor seam
  - fixes real friction: one red test currently writes a 1187-line
    `.gtd/FEEDBACK.md`
  - small and testable; closes half of an open dogfood issue
- [ ] #339: record turn durations and sum them in the closing summary
  - user-visible new feature; touches the land and summary code, so a refactor
    is very likely
  - larger: likely 3+ packages, so a longer run and more surface for friction
- [ ] #373(1): let the declared-tests guard accept a plan that lists an
      unchanged test
  - edits the existing guard code; fixes friction from #355
  - the fix needs a design choice first (planner rule or guard escape hatch), so
    this question would come back on the next lap
- [ ] _your answer_

### What if seam.judge does not rule refactor-first?

The ruling comes from an LLM judge (threshold p 0.7), so this process can't
promise it. The outcomes differ: either the issue's acceptance is met or it
isn't.

- [ ] Ship whatever path ran, file the miss as `track:dogfood` friction, and
      leave #384 open
  - one run; #384 needs a second dogfood later
- [x] Unwind and restart the process with a change more clearly shaped as
      refactor-first
  - acceptance stays in reach in this branch; costs a full extra run
- [ ] _your answer_

### What happens to the three deferred review notes the sketch deleted?

The sketch replaced `.gtd/TODO.md` wholesale, which removed notes 1–3 (restore a
stdout assertion, strengthen the `gtd history list` scenario, extend the
`runSummaryCommand` doc comment). Removing them may mean "drop" or just "clear
the file".

- [ ] Drop them
  - nothing tracks them any more
- [x] File them as one GitHub issue and keep them out of this process
  - the dogfood diff stays focused on the chosen change
- [ ] Fold them into this process as extra concerns
  - they touch only tests and a comment, so they land in the feature slice, not
    the refactor slice
  - mixes unrelated work into the dogfood PRs
- [ ] _your answer_

## Concerns

### 1. Pick and build the change (PRODUCT)

- Build the change picked above as an ordinary `feature` process on
  `feat/384-dogfood-stacked`.
- **This process already runs with `flag_naive_pass=1` and `flag_risk_tier=0`**
  (pinned in the entry commit's `Gtd-Var` trailers), so the naive pass and
  seam.judge run as-is. Leave both flags exactly as they are.
- The change meets its own issue's "done when", with `@inmem` cucumber scenarios
  and a README/docs update wherever it changes user-facing behaviour.

### 2. Walk the refactor-first path to two slices (PRODUCT)

- seam.judge rules `refactor-first`. The refactor is built and reviewed on its
  own, then the feature is implemented and reviewed.
- **History must hold two slices, `refactor` and `feature`.** `gtd slices` lists
  both before shipping.
- **The refactor slice must change no behaviour:** the suite stays green after
  it, with no test edits beyond what the refactor review allows.

### 3. Ship as two stacked PRs (PRODUCT)

- `/gtd ship` (the Claude Code mod) opens two PRs: the refactor PR against
  `main`, and the feature PR stacked on top of it.
- **The human merges the refactor PR first.** Re-running `/gtd ship` then
  restacks the feature PR onto `main` (the #383 behaviour), and the feature PR
  merges after that.
- Each PR title and squash message follows `docs/commits.md`; COMPATIBILITY.md
  decides `!`.

### 4. File the friction (PRODUCT)

- **Every snag hit along the way becomes a GitHub issue labelled
  `track:dogfood`, with a body that references #384.**
- First check existing open `track:dogfood` issues (#371–#373); add a comment to
  a matching issue rather than filing a duplicate.
- **#384 closes only when concerns 2–4 all held.**

## Answered Questions

### Is friction filing a build package?

No. Filing happens via `gh`, outside the build packages: a package that changes
no file lands an empty attempt and stalls (#373 item 2).

### Who runs ship and merges?

The human does, through the mod's `/gtd ship`, as #384's acceptance states. The
agent never merges a PR.
