# 02 — Slices on the naive path

Wires package 01's `reviewedRefactor` into `seamBuild`, wraps the feature work
in `slice("feature")`, removes `seam.approve`, and stops feedback re-running the
naive pass and judge. **The refactor-review scenarios that cover concern 2 live
here: they reach the refactor slice only through this wiring.**

Interfaces, call stacks and settled answers: `.gtd/ARCHITECTURE.md`.

## Requirements

### 1. Slices on the naive path (PRODUCT)

```text
design → naive pass → seam.judge
  refactor-first:
    slice("refactor"): refactor.* → refactor.build.quality.<lens> → refactor.build.review.*
    slice("feature"):  implement.* → build.quality.<lens> → build.review.*
  land / overrule at seam.steer / seam.by-hand:
    slice("feature"):  implement.* → build.quality.<lens> → build.review.*
```

- **Every naive-path verdict wraps implement + review in `slice("feature")`**;
  `gtd slices` shows `feature` for the feature work whatever the verdict
- **Only `refactor-first` adds `slice("refactor")` ahead of it**
- **Default path (naive pass off) unchanged**: no `slice()` call, one implicit
  `main` slice
- **`seam.approve` is removed**: the refactor review's sign-off commit is the
  approval record — **no `Gtd-Approved:` trailer on the refactor-first path any
  more**
- **Gates on `refactor-first`: design, refactor review, feature review = 3**; on
  `land`: design, feature review = 2; default path unchanged at 3
- Design, naive-pass and judge commits before the first slice fold into the
  first slice (slice gap rule): `refactor` on `refactor-first`, `feature`
  otherwise

### 3. Feature review and its feedback loop (PRODUCT)

- **Feature review covers the feature slice only** — on `refactor-first`,
  everything since the refactor sign-off
- **Once judged, every feature feedback round is design → implement, on every
  verdict**: `seam.naive` and `seam.judge` never re-run (today they do after
  `land`)
- **Risk: a seam a re-plan turns up is built unjudged and unrefactored**; a
  wrong refactor or a missing one means abandon and restart
- The re-plan loop sits inside `slice("feature")` (a loop must sit inside its
  slice)

### 7. Documentation (from the architecture's chores)

- SDLC.md, docs/configuration.md and README.md describe the shipped flow
- **Squash commit is `feat!:` with a literal `BREAKING CHANGE:` footer** — a
  `refactor!:` alone cuts no release

## Tasks

### 1. `seamBuild` returns `SeamOutcome`; `implement` reference optional

Paths: `src/workflows/feature/seam.ts`, `src/workflows/feature/seam.test.ts`,
`src/workflows/shared/text.ts`, `src/workflows/shared/text.test.ts`

- [ ] `seamBuild(base): Promise<SeamOutcome>` runs `decide()` with no `seamGate`
      call; runs no implement
- [ ] `land` resolves `{ reference: tip, base }` with the caller's base and
      enters no slice (test)
- [ ] `refactor-first` enters slice `refactor` running
      `reviewedRefactor(shape, { reference })`, resolves base = HEAD after it;
      no `seam.approve` request (test)
- [ ] Unreadable strays rest at `seam.by-hand` and enter no `refactor` slice
      (test)
- [ ] `implement(reference | undefined, tier?)` and
      `implementBuildingPrompt(reference | undefined, tier?)`: an undefined
      reference drops the `git show` line (tests in `seam.test.ts` and
      `text.test.ts`)
- [ ] `seamGate` stays exported as a public helper

### 2. `planAndBuild` slices the naive path

Paths: `src/workflows/feature/feature.ts`,
`src/workflows/feature/feature.test.ts`

- [ ] Naive pass on:
      `design → seamBuild → slice("feature") { implement →     buildTail(false, base, true); feedback → reUnwind → design → implement(undefined, tier) → buildTail … }`
- [ ] **`seam.naive` / `seam.judge` never re-run once judged, on any verdict**:
      after `land`, feedback rests next at `design.triage`, then
      `implement.building` (test)
- [ ] Naive pass off: no slice entered, step sequence unchanged (test)
- [ ] Signature unchanged; `reUnwind` still re-exported

### 3. Drop `seam.approve` from skills

Paths: `src/workflows/shared/skills.ts`, `src/workflows/shared/skills.test.ts`

- [ ] `seam.approve` gone from the non-turn list (test)

### 4. Scenarios

Paths: `src/workflows/feature/refactor-first.feature`,
`src/workflows/feature/refactor-review.feature` (new, `@inmem`),
`src/workflows/feature/seam.feature`,
`src/workflows/feature/one-step-land.feature`,
`src/workflows/feature/seam-rejection.feature`,
`tests/integration/features/default-workflow.feature`

- [ ] refactor-first.feature: seam.judge → refactor.* → refactor.build.review
      sign-off → implement.* → build.review sign-off → idle; exact commit
      subjects, **no `seam.approve`, no `Gtd-Approved:`**
- [ ] refactor-first.feature: `gtd slices` lists `refactor` then `feature`
- [ ] refactor-review.feature: an edit note at
      `refactor.build.review.await-review` collects into `.gtd/REFACTOR.md`,
      re-unwinds, `refactor.deriving` re-runs with `## Review feedback`, then
      `refactor.building` — never `design.triage`
- [ ] refactor-review.feature: a human code edit at the refactor review is
      reverted by `refactor.re-unwind`
- [ ] refactor-review.feature: the feature review after refactor-first covers
      only commits since the refactor sign-off (its `<!-- base:` is that commit)
- [ ] refactor-review.feature: feature feedback after refactor-first runs
      re-unwind → design.triage → design.gate.answer → implement.building, no
      seam.naive / seam.judge
- [ ] refactor-review.feature: with a narrowed `GTD_SEAMALLOW`, a test-named
      stray changed by `refactor.building` is refused with `refactor-tests`
- [ ] refactor-review.feature: a refactor-slice nit fix changing a non-stray is
      refused with `refactor-scope`
- [ ] refactor-review.feature: `GTD_REFACTORQUALITYREVIEWS="correctness"` rests
      at `refactor.build.quality.correctness.reviewing`; blank runs no refactor
      lap; `GTD_QUALITYREVIEWS` does not reach it
- [ ] seam.feature: "review feedback re-runs design and the whole seam phase"
      becomes: after `land`, feedback runs re-unwind → design.* →
      implement.building, no seam.naive / seam.judge
- [ ] one-step-land.feature: `gtd slices` lists `feature` alone on `land`
- [ ] seam-rejection.feature: overrule at `seam.steer` lists `feature` alone
- [ ] default-workflow.feature: naive pass off, `gtd slices` lists `main` alone
- [ ] Every remaining `seam.approve` / `Gtd-Approved:` expectation on the naive
      path removed from existing scenarios

### 5. Docs

Paths: `SDLC.md`, `docs/configuration.md`, `README.md`

- [ ] SDLC.md: gate counts (naive 2, 3 on refactor-first), drop `seam.approve`
      row, add refactor review sign-off row, fixture list, "What stops a
      landing" (two reviews split the diff; `refactor-tests` refusal)
- [ ] docs/configuration.md: naive-pass path list, `seam.approve` out of
      scope/step lists, `refactor.build.*` scopes and skills keys,
      `refactorQualityReviews` setting, refactor package rules (no test file;
      the fixed test-file globs; **`*_test.go`/`test_*.py` naming is not
      refused**), `reviewedRefactor`
- [ ] README.md: naive-pass mention and `refactorQualityReviews`
- [ ] No doc names a `src/*.ts` module or internal function (AGENTS.md)

### 6. Gate and squash

- [ ] `npm test` green (all release-flag states), `lint:boundaries` clean,
      `format:check` clean
- [ ] Squash commit `feat!:` with a literal `BREAKING CHANGE:` footer naming the
      removed `seam.approve`, the `refactor.build.*` steps and the changed
      `seamBuild` signature; **a process resting at `seam.approve` must
      `gtd abandon`**

## Tests

- unit: `src/workflows/feature/seam.test.ts`
- unit: `src/workflows/feature/feature.test.ts`
- unit: `src/workflows/shared/text.test.ts`
- unit: `src/workflows/shared/skills.test.ts`
- e2e: `src/workflows/feature/refactor-first.feature`
- e2e: `src/workflows/feature/refactor-review.feature`
- e2e: `src/workflows/feature/seam.feature`
- e2e: `src/workflows/feature/one-step-land.feature`
- e2e: `src/workflows/feature/seam-rejection.feature`
- e2e: `tests/integration/features/default-workflow.feature`
