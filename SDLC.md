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
pass, and a seam judge rules `land`/`refactor-first`/`reject`.
`GTD_FLAG_RISK_TIER` (off by default) adds a proposed risk tier at the design
gate. See [The naive-pass path](docs/configuration.md#the-naive-pass-path).

The third reject or red check rests at `seam.steer`, where a human steers or
overrules.

## Human gates

Each gate is a point where a person must act before work continues. Counts are
per design round: a review-feedback round re-runs design.

- `feature`: design and review sign-off; a refactor review sign-off only on
  judge `refactor-first`. **2 gates, or 3 on `refactor-first`** (design,
  refactor review, feature review). Overrule at `seam.steer` passes no seam
  gate. **A sketch whose own acceptance criteria `design.clear` judges clear and
  checkable passes no design gate** on its first lap: one gate fewer, and the
  criteria's author is whoever wrote the sketch.
- `cleanup`, `fix`, `review`: review sign-off only.
- `rollout`: **no human gate** — the green suite and the `rollout-only` refusal
  are its only control.

In every row the authorizer is the person who asked for the change, and the
record carries the commit author only, no approver trailer, unless stated.

| Gate                                                | Who approved                         | What was tested                                 | Where the record lives               |
| --------------------------------------------------- | ------------------------------------ | ----------------------------------------------- | ------------------------------------ |
| `design.gate.answer`                                | the person who answers the questions | the design questions and the `AC-<n>` criteria  | step commit and `.gtd/` file history |
| review gate sign-off                                | the reviewer who signs off           | the diff, against the review checklist          | the sign-off commit                  |
| refactor review sign-off (only on `refactor-first`) | the reviewer who signs off           | the refactor diff, against the review checklist | the sign-off commit                  |

For non-repudiation use signed commits or branch protection outside gtd.

Exception rests are listed apart (examples, not exhaustive); they carry no
approval:

- `seam.steer` — third reject or red check, a human steers or overrules
- `seam.by-hand` — strays whose content cannot be read; a person reviews those
  files by hand
- `*.health.stop` and `*.health.exhausted` — escalation stops
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
  naive pass, judge `land`
- [`src/workflows/feature/refactor-first.feature`](src/workflows/feature/refactor-first.feature):
  judge `refactor-first`, then the refactor review, then the implementation
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
  the naive pass's acceptance tests, refused or sent back until green
- [`src/workflows/feature/fast-path.feature`](src/workflows/feature/fast-path.feature):
  a trivial fix takes the same few beats at either risk tier

## What stops a landing

Paths and text are checked, **never behaviour**.

- `gtd land` refusals in `refactor.*` (a path outside the strays, a raised
  flag-read count): see [`refactorFirst`](docs/configuration.md#refactorfirst).
- `gtd land` refusals in `rollout` and `cleanup`: see
  [Rolling out and cleaning up a release flag](docs/configuration.md#rolling-out-and-cleaning-up-a-release-flag).
  `cleanup` checks shipped `src/` sources only.
- `gtd land` refusals in `seam.naive`: a criterion ID no test of the pass names
  (`acceptance-tests`), a test importing a file the pass added
  (`acceptance-internals`). See
  [The naive-pass path](docs/configuration.md#the-naive-pass-path). `seam.check`
  is the one place the naive pass's behaviour is run.
- `seam.judge` judges the shape of the naive pass. The implementation turn that
  lands is not re-judged or scoped, and review sign-off is the only human look
  at the full diff. New files are exempt. `gtd strays` works in any repository.
- Two reviews split the diff on `refactor-first`: the refactor review covers
  only the refactor slice, and the feature review only what follows its
  sign-off. A refactor turn that changes a test file is refused (`gtd land`:
  `refactor-tests`), whatever `seamAllow` says.
