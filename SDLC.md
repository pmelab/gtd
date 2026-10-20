# Delivery model

The model gtd's workflows implement: trunk-based delivery behind release flags,
with human gates where a person must decide.

## Trunk and release flags

Work merges to `main` behind a release flag. `rollout` makes the flag
default-on. `cleanup` deletes the flag and keeps the flag-on path. Refusals of
both workflows are in
[Rolling out and cleaning up a release flag](docs/configuration.md#rolling-out-and-cleaning-up-a-release-flag).

## The flag-at-composition-point rule

**Read a flag only at the composition point, where the process is wired
together, never in domain code, so cleanup is a local edit**: delete the check,
keep the flag-on path.

**The flag is pinned at process start, so a mid-process flip never moves a
running process.** Branch on the pinned `flag_<name>` setting, and mark each
such branch with a `GTD_FLAG_<NAME>` comment: the cleanup refusal sees only the
literal `GTD_FLAG_<NAME>`, so an unmarked branch survives cleanup and silently
takes the off path.

## Naive pass and seam judge

After design the agent implements first, breadth-first, with a behaviour-level
acceptance test naming each criterion's ID; `seam.check` runs the suite on the
pass, and a seam judge rules `land`/`refactor-first`/`reject`. On `land` the
pass itself is the implementation (`implement.applying`), with no rebuild and no
release flag; with `flagMode` off no judge runs and every vetted pass lands so.
`GTD_FLAG_RISK_TIER` (off by default) adds a proposed risk tier at the design
gate.

On `refactor-first` the pass is reset, never applied, and the change takes three
turns:

1. **Refactor note.** `seam.note` reads the whole naive diff and writes
   `.gtd/REFACTOR-NOTE.md`: which seams, which shape. It may change nothing
   else.
2. **Refactor.** Flag-free, behaviour-neutral, guided by the note. **Gate: the
   existing suite stays green.** It lands on its own, in the `refactor` slice,
   after its review.
3. **Rebuild.** The change re-implemented on the refactored base, behind a
   release flag read at the composition point, with the note and the naive diff
   as reference. **Gate: the naive pass's `AC-<n>`-tagged acceptance tests,
   carried over, are green** — a rebuild whose tests leave out an ID the naive
   tests named is refused (`rebuild-acceptance`), and the health loop runs the
   suite green. See
   [The naive-pass path](docs/configuration.md#the-naive-pass-path).

The third reject, test fault or red check rests at `seam.steer`, where a human
steers or overrules.

## Coarse slices

**A change with more criteria than `sliceMaxCriteria` (8) is built in slices.**
After design, `design.slicing` groups related criteria into `.gtd/SLICES.md`, at
most the cap per slice and as few slices as it allows. Each slice runs the whole
path above — naive pass, then land or refactor and rebuild, then the health loop
and quality lap — in order, from where the previous one landed, as its own
`feature-<n>` slice (`refactor-<n>` ahead of it when refactored). A change
within the cap is one `feature` slice. See
[Coarse slices](docs/configuration.md#coarse-slices).

## Acceptance-criteria coverage

**A feature is done only when every `AC-<n>` has a passing test.** Once the
implementation's suite is green, `implement.coverage` judges, per criterion ID,
whether a test file the change touched covers it; an uncovered ID sends the
process back to a covering turn, never on to idle. The judge's landing records
`Gtd-Mark: covers=<id>` per ID. After two covering turns `implement.uncovered`
rests for a human, who adds tests or overrules; an overrule records
`Gtd-Mark: uncovered=<id>`. See
[Acceptance-criteria coverage](docs/configuration.md#acceptance-criteria-coverage).

## Human gates

Each gate is a point where a person must act before work continues.

- `feature`: design only; a refactor review sign-off only on judge
  `refactor-first`. **1 gate, plus 1 per slice judged `refactor-first`**
  (design, refactor review). **No human review of the finished change**: the
  process ends when its last slice lands, after the quality lap. Review it
  through the `review` door (`gtd door review <commitish>`), started by hand.
  Overrule at `seam.steer` passes no seam gate. **A sketch whose own acceptance
  criteria `design.clear` judges clear and checkable passes no design gate**:
  one gate fewer — none at all on `land` — and the criteria's author is whoever
  wrote the sketch.
- `cleanup`, `fix`, `review`: review sign-off only.
- `rollout`: **no human gate** — the green suite and the `rollout-only` refusal
  are its only control.

In every row the authorizer is the person who asked for the change, and the
record carries the commit author only, no approver trailer, unless stated.

| Gate                                                | Who approved                         | What was tested                                 | Where the record lives               |
| --------------------------------------------------- | ------------------------------------ | ----------------------------------------------- | ------------------------------------ |
| `design.gate.answer`                                | the person who answers the questions | the design questions and the `AC-<n>` criteria  | step commit and `.gtd/` file history |
| review gate sign-off (not in `feature`)             | the reviewer who signs off           | the diff, against the review checklist          | the sign-off commit                  |
| refactor review sign-off (only on `refactor-first`) | the reviewer who signs off           | the refactor diff, against the review checklist | the sign-off commit                  |

For non-repudiation use signed commits or branch protection outside gtd.

Exception rests are listed apart (examples, not exhaustive); they carry no
approval:

- `seam.steer` — third reject, test fault or red check, a human steers or
  overrules
- `seam.by-hand` — strays whose content cannot be read; a person reviews those
  files by hand
- `seam.oversized`, `refactor.oversized`, `implement.oversized` — a phase whose
  continuations hit the `continuations` cap or stalled; landing grants a fresh
  round
- `*.health.stop` and `*.health.exhausted` — escalation stops
- `build.quality-unresolved` — quality findings the fix cap left; a person fixes
  what matters, then deletes or empties `.gtd/QUALITY.md`
- `*.blocked`, `review.review-missing`, `unwind-failed` — a person must clear
  the cause by hand; a red suite after the `rollout` flip rests at
  `rollout.suite.blocked`

**Every gate record (step commits, answered `.gtd/` files, sign-off, trailers)
survives a squash only under `refs/gtd/history/*`, which nothing pushes by
default (#374).** Read it with `gtd history show <ref>`; the manual fix is in
[Process history](README.md#process-history).

**`Gtd-Mark: risk-tier` trailers appear only with `GTD_FLAG_RISK_TIER` on; a
default setup records none.**

## Worked examples

Each path has a `.feature` file:

- [`src/workflows/feature/one-step-land.feature`](src/workflows/feature/one-step-land.feature):
  naive pass, judge `land`, the pass applied as the implementation
- [`src/workflows/feature/flag-mode.feature`](src/workflows/feature/flag-mode.feature):
  `flagMode` off, the naive pass applied with no judge
- [`src/workflows/feature/refactor-first.feature`](src/workflows/feature/refactor-first.feature):
  judge `refactor-first`, then the refactor review, then the implementation
- [`src/workflows/feature/refactor-rebuild.feature`](src/workflows/feature/refactor-rebuild.feature):
  the refactor note reaching both turns, the refactor landing only green, the
  rebuild landing only with the naive acceptance tests
- [`src/workflows/review/review-door.feature`](src/workflows/review/review-door.feature):
  a feature process ending with no review rest, then the `review` door reviewing
  it
- [`src/workflows/feature/refactor-review.feature`](src/workflows/feature/refactor-review.feature):
  the refactor review's feedback loop, refusals and lenses
- [`src/workflows/feature/seam-rejection.feature`](src/workflows/feature/seam-rejection.feature):
  three rejects ending at `seam.steer`
- [`src/workflows/cleanup/cleanup-path.feature`](src/workflows/cleanup/cleanup-path.feature):
  cleanup's refusal clears once no `GTD_FLAG_<NAME>` is left
- [`src/workflows/feature/acceptance-criteria.feature`](src/workflows/feature/acceptance-criteria.feature):
  ID'd acceptance criteria, and the skip path for a sketch that states clear
  ones
- [`src/workflows/feature/naive-acceptance.feature`](src/workflows/feature/naive-acceptance.feature):
  the naive pass's acceptance tests, sent back until they name every criterion
  and pass
- [`src/workflows/feature/coverage.feature`](src/workflows/feature/coverage.feature):
  the coverage judge, its covering turns and the human overrule
- [`src/workflows/feature/slicing.feature`](src/workflows/feature/slicing.feature):
  criteria above the cap grouped into slices built in order
- [`src/workflows/feature/fast-path.feature`](src/workflows/feature/fast-path.feature):
  a trivial fix takes the same few beats at either risk tier

## What stops a landing

Paths and text are checked, **never behaviour**.

- `gtd land` refusals in `refactor.*` (a path outside the strays, a raised
  flag-read count): see [`refactorFirst`](docs/configuration.md#refactorfirst).
- `seam.note` is refused when it changes anything but the note
  (`refactor-note`); the rebuild's `implement.building` when its tests leave out
  a naive acceptance-test ID (`rebuild-acceptance`), and so is a fix turn that
  drops one. **Both read text only**: the rebuild's carried tests run in the
  health loop, a carried test may be edited to reach the flag, and **a skipped
  test naming the ID passes**.
- `gtd land` refusals in `rollout` and `cleanup`: see
  [Rolling out and cleaning up a release flag](docs/configuration.md#rolling-out-and-cleaning-up-a-release-flag).
  `cleanup` checks shipped `src/` sources only.
- `seam.naive` is sent back, not refused, when a criterion ID no test of the
  pass names (`acceptance-tests`) or a test imports a file the pass added
  (`acceptance-internals`). See
  [The naive-pass path](docs/configuration.md#the-naive-pass-path). `seam.check`
  is the one place the naive pass's behaviour is run.
- `implement.coverage` sends uncovered criteria back, not refused. **Its judge
  reads test text and runs nothing**: a `covers` mark means a judge found a
  matching test in a green suite, not that the test checks the criterion well.
  An overrule at `implement.uncovered` ends the feature with the IDs it leaves
  uncovered recorded as `uncovered` marks.
- `seam.judge` judges the shape of the naive pass. On `land` that pass lands
  unchanged; a rebuild that follows a refactor is checked only for its carried
  acceptance tests, never re-judged or scoped, and **in `feature` no human looks
  at the full diff** — only the quality lap does, unless someone opens the
  `review` door. **Risk: no reviewer `Risk:` fix pass and no weakened-scenario
  flag run in `feature`, and a `high` risk tier's "needs a human reviewer" is
  advisory only.** New files are exempt. `gtd strays` works in any repository.
- The refactor review on `refactor-first` covers only the refactor slice;
  nothing in `feature` reviews what follows its sign-off. A refactor turn that
  changes a test file is refused (`gtd land`: `refactor-tests`), whatever
  `seamAllow` says.
