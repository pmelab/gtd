# Architecture

## Open Questions

### How does a refactor turn recognise a test file?

**A stray never matches `seamAllow`** (the judge counts only paths outside it),
so a test-file check built on `seamAllow` never fires in the shipped flow. The
fork is where the test-file globs come from.

- [x] A fixed built-in list, `seamAllow`'s default test globs
  - `**/*.test.*`, `**/*.spec.*`, `**/*.feature`, `**/tests/**`, `**/test/**`,
    `**/__tests__/**`
  - no new setting, no new Stable surface
  - **a repo with other naming (`*_test.go`, `test_*.py`) gets no refusal**
- [ ] A new process setting `refactorTestFiles`, defaulting to that list
  - covers any naming; pinned at process start like `seamAllow`
  - one more Stable setting: factory option, `GTD_REFACTORTESTFILES`, docs
- [ ] `seamAllow`'s globs minus `.gtd/**`
  - no new setting
  - **vacuous for the shipped flow**; guards only a custom `refactorFirst`
    caller whose strays overlap `seamAllow`
- [ ] _your answer_

## Interfaces

`src/workflows/feature/feature.ts` — `reUnwind` moves to `review.ts`
(no-circular rule: `refactor.ts` needs it) and stays re-exported here under the
same name.

```ts
/**
 * Unchanged signature. Naive pass off: today's loop, no slice() call.
 * Naive pass on: design → seamBuild → slice("feature") { implement → buildTail;
 * feedback → reUnwind → design → implement → buildTail … }.
 * seam.naive / seam.judge never re-run once judged, on any verdict.
 */
export const planAndBuild: (firstBase: string) => Promise<void>
export { reUnwind } from "./review.js"
```

`src/workflows/feature/seam.ts`

```ts
export interface SeamOutcome {
  /** The naive pass's kept tip: the first implement turn's reading material. */
  readonly reference: string
  /** The feature review's base: HEAD after slice("refactor") on refactor-first, else the caller's base. */
  readonly base: string
}

/**
 * Was `(tier?) => Promise<void>`. Runs decide() (no seamGate any more), then on
 * refactor-first slice("refactor", () => reviewedRefactor(shape, { reference })),
 * or seam.by-hand when strays are unreadable. Runs no implement.
 */
export const seamBuild: (base: string) => Promise<SeamOutcome>

/** `reference` now optional: a feedback lap passes none, and the prompt drops the git-show line. */
export const implement: (
  reference: string | undefined,
  tier?: RiskTier,
) => Promise<void>
```

`src/workflows/feature/refactor.ts`

```ts
/** Refuses with `gtd land: refactor-tests: …`, listing each changed test path of the turn's own changes(). */
export const requireNoTestFiles: (patterns: readonly string[]) => void

/**
 * refactorFirst plus its review, all inside the one scope({ name: "refactor",
 * access: { write: [...strays, ".gtd/**"] } }): derive → build → health →
 * close, then buildTail(false, entry, true, { guard, lenses, feedback }) over
 * the refactor's own commits. Feedback → reUnwind → re-derive with the
 * collected notes → build again. Resolves true on sign-off; false, running no
 * step, on exactly the shapes refactorFirst rejects.
 */
export const reviewedRefactor: (
  shape: DiffShapeResult,
  options?: RefactorOptions,
) => Promise<boolean>

// refactorFirst: signature unchanged; its guard gains requireNoTestFiles.
// guard = requireWithin(strays) + requireNoNewFlags(pattern, entry) + requireNoTestFiles(...)
// where `entry` is HEAD at the refactor scope's entry, for every lap.
```

`src/workflows/feature/review.ts`

```ts
/** Where a review's edit notes land, and the turn that writes them. */
export interface FeedbackTarget {
  readonly file: string
  readonly collecting: (capture: string) => Promise<void>
  /** Refusal when the collecting turn changed something but not `file`. */
  readonly unmatched: string
}

export interface BuildTailOptions {
  /** Runs after every code-changing turn: fix-check, quality fix, risk fix, nit fix, escalation describe. */
  readonly guard?: Guard
  /** Quality-lap lenses; default lensesOf(vars.qualityReviews). */
  readonly lenses?: readonly string[]
  /** Default: `.gtd/REQUIREMENTS.md` via `collecting`. */
  readonly feedback?: FeedbackTarget
}

export const buildTail: (
  fixFirst: boolean,
  base: string,
  green?: boolean,
  options?: BuildTailOptions,
) => Promise<ReviewOutcome>

/** Moved from feature.ts; body unchanged. Runs `re-unwind` in the caller's scope. */
export const reUnwind: (
  feedback: Extract<ReviewOutcome, { verdict: "feedback" }>,
) => Promise<void>
```

`src/workflows/shared/tail.ts` — additive trailing parameters, public callers
unaffected.

```ts
export const qualityLap: (
  guard?: Guard,
  lenses?: readonly string[],
) => Promise<"clean" | "findings">
export const tail: <T>(
  fixFirst: boolean,
  finish: (escalations: EscalationCount) => Promise<T>,
  green?: boolean,
  guard?: Guard,
  lenses?: readonly string[],
) => Promise<T>
```

`src/workflows/feature/steps.ts`, `src/workflows/shared/text.ts`

```ts
/** Step `review.collecting` (full name refactor.build.review.collecting): writes `.gtd/REFACTOR.md`, no qa mode. */
export const refactorCollecting: (
  capture: string,
  strays: readonly string[],
) => Promise<void>

/** Like buildReviewCollectingPrompt, but folds concerns into `.gtd/REFACTOR.md` and says a concern needing a non-stray path, a test file or a new flag read cannot be built — abandon and restart. */
export const refactorReviewCollectingPrompt: (
  capture: string,
  strays: readonly string[],
) => string

/** `feedback`: the package carries `## Review feedback`; the turn acts on it. */
export const refactorBuildingPrompt: (
  pkg: string,
  strays: readonly string[],
  pattern: string,
  reference?: string,
  feedback?: boolean,
) => string

/** `reference` optional, as implement. */
export const implementBuildingPrompt: (
  reference: string | undefined,
  tier?: "low" | "high",
) => string
// refactorRules / packageLines: "a test file only when it is one of them" becomes "never a test file".
```

Package file on a feedback lap: `refactor.deriving` reads the collected
`.gtd/REFACTOR.md`, rewrites the fixed sections, and appends its body under
`## Review feedback`. `refactor.closing` removes it before the tail, so the
review's "feedback file present ⇒ feedback" test holds.

`src/workflows/shared/vars.ts`, `options.ts`, `skills.ts`, `access.ts`

```ts
defaults.refactorQualityReviews = "correctness, ponytail-review, conventions"
ShippedOptions.refactorQualityReviews: setting // so FlagOptions gains it too

// skills(vars) adds, same lists as their build.* counterparts:
//   refactor.build, refactor.build.health, refactor.build.fix.quality,
//   refactor.build.review, refactor.build.review.fix.nits,
//   refactor.build.review.fix.risks,
//   ...lensScopes("refactor.build.quality", lensesOf(vars.refactorQualityReviews ?? ""), builtIn-or-self)
// access(vars) adds only:
//   ...lensScopes("refactor.build.quality", lensesOf(vars.refactorQualityReviews ?? ""), () => ({ write: [] }))
// Every other refactor.build.* scope inherits refactor's write: [...strays, ".gtd/**"].
```

Removed from the flow: the `seam.approve` step (`seamGate` stays a public
helper).

## Call Stacks

Naive pass on, `refactor-first`:

- `ordinaryStart` → `planAndBuild(start())` → `design(base)` → `recordRisk`
- → `seamBuild(base)` → `decide` (`seam.naive`, `seam.judge`)
- → `slice("refactor")` → `reviewedRefactor` → `scope("refactor")`
- → `refactor.deriving`, `refactor.building`, `refactor.health.*`,
  `refactor.closing` (guarded)
- →
  `buildTail(…, { guard, lenses: refactorQualityReviews, feedback: REFACTOR.md })`
  → `tail` → `scope("build")` → `refactor.build.quality.<lens>.*`,
  `refactor.build.review.*`
- feedback → `reUnwind` (`refactor.re-unwind`) → `refactor.deriving` (keeps
  notes) → `refactor.building` …
- sign-off → back in `seamBuild` → `{ reference, base: head() }`
- → `slice("feature")` → `implement(reference, tier)` →
  `buildTail(false, base, true)` → `build.quality.<lens>.*`, `build.review.*`
- feedback → `reUnwind` (`re-unwind`) → `design` → `recordRisk` →
  `implement(undefined, tier)` → `buildTail` …

Naive pass on, `land` / overrule at `seam.steer` / `seam.by-hand`:

- `planAndBuild` → `design` → `seamBuild` (`seam.naive`, `seam.judge`[,
  `seam.steer`][, `seam.by-hand`]) → `{ reference, base }`
- → `slice("feature")` → same feature loop as above

Naive pass off: `planAndBuild` → today's `design` → `architecture` → `packages`
→ `buildTail` loop, no `slice()`.

Guarded landing: refactor agent turn → `gtd land` → `guard` → `requireWithin` /
`requireNoNewFlags` / `requireNoTestFiles` → `refuse`.

## E2E Scenarios

- e2e: src/workflows/feature/refactor-first.feature — refactor-first walks
  seam.judge → refactor.* → refactor.build.review sign-off → implement.* →
  build.review sign-off → idle; exact commit subjects, no `seam.approve`, no
  `Gtd-Approved:` (covers 1, 2, 6)
- e2e: src/workflows/feature/refactor-first.feature — `gtd slices` lists
  `refactor` then `feature` (covers 1, 6)
- e2e: src/workflows/feature/refactor-review.feature — an edit note at
  refactor.build.review.await-review collects into `.gtd/REFACTOR.md`,
  re-unwinds, and `refactor.deriving` re-runs with `## Review feedback`, then
  `refactor.building` — never design.triage (covers 2, 6)
- e2e: src/workflows/feature/refactor-review.feature — a human code edit at the
  refactor review is reverted by `refactor.re-unwind` (covers 2)
- e2e: src/workflows/feature/refactor-review.feature — the feature review after
  refactor-first covers only commits since the refactor sign-off (its
  `<!-- base:` is that commit) (covers 3)
- e2e: src/workflows/feature/refactor-review.feature — feature feedback after
  refactor-first runs re-unwind → design.triage → design.gate.answer →
  implement.building, no seam.naive / seam.judge (covers 3, 6)
- e2e: src/workflows/feature/refactor-review.feature — with a narrowed
  `GTD_SEAMALLOW`, a test-named stray changed by `refactor.building` is refused
  with `refactor-tests` (covers 4, 6)
- e2e: src/workflows/feature/refactor-review.feature — a refactor-slice nit fix
  changing a non-stray is refused with `refactor-scope` (covers 2)
- e2e: src/workflows/feature/refactor-review.feature —
  `GTD_REFACTORQUALITYREVIEWS="correctness"` rests at
  `refactor.build.quality.correctness.reviewing`; blank runs no refactor lap;
  `GTD_QUALITYREVIEWS` does not reach it (covers 5)
- e2e: src/workflows/feature/seam.feature — "review feedback re-runs design and
  the whole seam phase" becomes: after `land`, feedback runs re-unwind →
  design.* → implement.building, no seam.naive / seam.judge (covers 3, 6)
- e2e: src/workflows/feature/one-step-land.feature — `gtd slices` lists
  `feature` alone on `land` (covers 1, 6)
- e2e: src/workflows/feature/seam-rejection.feature — overrule at `seam.steer`
  lists `feature` alone (covers 1)
- e2e: tests/integration/features/default-workflow.feature — naive pass off,
  `gtd slices` lists `main` alone (covers 1)
- e2e: tests/integration/features/refactor-package.feature — `refactorFirst`
  with a test file among its strays refuses a build turn changing it,
  `refactor-tests` on stderr (covers 4)

## Unit Tests

### planAndBuild

- unit: src/workflows/feature/feature.test.ts — naive pass on, `land`: feature
  feedback rests next at `design.triage`, then `implement.building`, never
  `seam.naive` (covers 3)
- unit: src/workflows/feature/feature.test.ts — naive pass off: no slice
  entered, step sequence unchanged (covers 1)

### seamBuild

- unit: src/workflows/feature/seam.test.ts — `land` resolves
  `{ reference: tip, base }` with the caller's base and enters no slice
  (covers 1)
- unit: src/workflows/feature/seam.test.ts — `refactor-first` enters slice
  `refactor` and resolves base = HEAD after it; no `seam.approve` request
  (covers 1, 2)
- unit: src/workflows/feature/seam.test.ts — unreadable strays rest at
  `seam.by-hand` and enter no `refactor` slice (covers 1)

### implement

- unit: src/workflows/feature/seam.test.ts — no reference: the building prompt
  carries no `git show` line (covers 3)

### requireNoTestFiles

- unit: src/workflows/feature/refactor.test.ts — refuses a changed test path,
  naming it, even when it is a stray (covers 4)
- unit: src/workflows/feature/refactor.test.ts — passes non-test paths and
  `.gtd/` paths (covers 4)

### reviewedRefactor

- unit: src/workflows/feature/refactor.test.ts — after closing, the tail's steps
  are `refactor.build.*` and the review base is HEAD at scope entry (covers 2)
- unit: src/workflows/feature/refactor.test.ts — a feedback outcome re-derives a
  package holding `## Review feedback` and the collected text, keeping the
  strays fixed (covers 2)
- unit: src/workflows/feature/refactor.test.ts — the guard runs after
  quality-fix, nit-fix and fix-check turns (covers 2, 4)
- unit: src/workflows/feature/refactor.test.ts — `land` or unreadable shapes
  resolve false with no step (covers 2)
- unit: src/workflows/feature/refactor.test.ts — the package rules say "never a
  test file" (covers 4)

### buildTail

- unit: src/workflows/feature/review.test.ts — `feedback.file` replaces
  `.gtd/REQUIREMENTS.md` as the feedback test and `unmatched` is the refusal
  (covers 2)
- unit: src/workflows/feature/review.test.ts — `guard` runs after risk-fix and
  nit-fix turns (covers 2)

### reUnwind

- unit: src/workflows/feature/review.test.ts — restores edited paths from
  `restoreFrom` and removes added ones, in the caller's scope (covers 2, 3)

### tail / qualityLap

- unit: src/workflows/shared/tail.test.ts — `lenses` overrides `qualityReviews`;
  `[]` runs no lens turn (covers 5)

### refactorCollecting / refactorReviewCollectingPrompt

- unit: src/workflows/shared/text.test.ts — the prompt names `.gtd/REFACTOR.md`,
  never `.gtd/REQUIREMENTS.md`, and says a non-stray, test-file or flag concern
  cannot be built (covers 2)

### refactorBuildingPrompt / implementBuildingPrompt

- unit: src/workflows/shared/text.test.ts — `feedback` adds the
  act-on-`## Review feedback` line; the rules say "never a test file" (covers
  2, 4)
- unit: src/workflows/shared/text.test.ts — an undefined reference drops the
  `git show` line (covers 3)

### refactorQualityReviews settings

- unit: src/workflows/shared/options.test.ts — `refactorQualityReviews` defaults
  to `correctness, ponytail-review, conventions` and a factory option wins
  (covers 5)
- unit: src/workflows/shared/skills.test.ts — keys `refactor.build.*` with their
  `build.*` counterparts' lists and one `refactor.build.quality.<lens>` per
  `refactorQualityReviews` entry; `seam.approve` gone from the non-turn list
  (covers 2, 5)
- unit: src/workflows/shared/access.test.ts — `refactor.build.quality.<lens>` is
  `write: []`; no other `refactor.build.*` key (covers 5)

### Chores

- chore: SDLC.md — gate counts (naive 2, 3 on refactor-first), drop
  `seam.approve` row, add refactor review sign-off row, fixture list, "What
  stops a landing" (two reviews split the diff; `refactor-tests` refusal)
  (covers 7)
- chore: docs/configuration.md — naive-pass path list, `seam.approve` out of
  scope/step lists, `refactor.build.*` scopes and skills keys,
  `refactorQualityReviews` setting, refactor package rules (no test file),
  `reviewedRefactor` (covers 7)
- chore: README.md — naive-pass mention and `refactorQualityReviews` (covers 7)
- chore: src/workflows/shared/skills.ts — fix the "every refactor agent turn
  loads ponytail" comment: `refactor.build.*` carry the `build.*` lists
  (covers 2)
- chore: squash commit — `feat!:` with a literal `BREAKING CHANGE:` footer
  naming the removed `seam.approve`, the `refactor.build.*` steps and the
  changed `seamBuild` signature; a process resting at `seam.approve` must
  `gtd abandon` (covers 1, 2)

## Merged Concerns

### 1 + 3 → naive-path orchestration (`feature.ts`, `seam.ts`)

> ## 1. Slices on the naive path (PRODUCT)
>
> ```text
> design → naive pass → seam.judge
>   refactor-first:
>     slice("refactor"): refactor.* → refactor.build.quality.<lens> → refactor.build.review.*
>     slice("feature"):  implement.* → build.quality.<lens> → build.review.*
>   land / overrule at seam.steer / seam.by-hand:
>     slice("feature"):  implement.* → build.quality.<lens> → build.review.*
> ```
>
> - **Every naive-path verdict wraps implement + review in `slice("feature")`**;
>   `gtd slices` shows `feature` for the feature work whatever the verdict
> - **Only `refactor-first` adds `slice("refactor")` ahead of it**
> - **Default path (naive pass off) unchanged**: no `slice()` call, one implicit
>   `main` slice
> - **`seam.approve` is removed**: the refactor review's sign-off commit is the
>   approval record — **no `Gtd-Approved:` trailer on the refactor-first path
>   any more**
> - **Gates on `refactor-first`: design, refactor review, feature review = 3**;
>   on `land`: design, feature review = 2; default path unchanged at 3
> - Design, naive-pass and judge commits before the first slice fold into the
>   first slice (slice gap rule): `refactor` on `refactor-first`, `feature`
>   otherwise

> ## 3. Feature review and its feedback loop (PRODUCT)
>
> - **Feature review covers the feature slice only** — on `refactor-first`,
>   everything since the refactor sign-off
> - **Once judged, every feature feedback round is design → implement, on every
>   verdict**: `seam.naive` and `seam.judge` never re-run (today they do after
>   `land`)
> - **Risk: a seam a re-plan turns up is built unjudged and unrefactored**; a
>   wrong refactor or a missing one means abandon and restart
> - The re-plan loop sits inside `slice("feature")` (a loop must sit inside its
>   slice)

### 2 + 4 + 5 → refactor slice and its review (`refactor.ts`, `review.ts`, `tail.ts`, settings)

> ## 2. Refactor review and its feedback loop (PRODUCT)
>
> - **Step names: the refactor tail nests under `refactor` —
>   `refactor.build.review.*`, `refactor.build.quality.<lens>`**; the feature
>   tail keeps `build.review.*` / `build.quality.<lens>` on every path
> - **`skills` keys are per full scope name**: a `build.review` or
>   `build.quality.<lens>` entry does not reach the refactor scopes; they need
>   their own entries, and ship with the same default skills as their feature
>   counterparts
> - **Refactor review covers the refactor slice's commits only**
> - Same review flow as the feature review: questions answered in place, nits
>   fixed, could-notes deferred to `.gtd/TODO.md`, edits loop
> - **An edit note re-runs the refactor, never a re-plan**, under the same
>   guards: stray paths only, no new or added flag reads, no test file touched
> - **Quality-lap fixes, fix-check turns and nit fixes in the refactor slice run
>   under those guards too**
> - A note asking for a change outside the strays is refused by the guard; the
>   way out is abandon and restart
> - The human's code edits at the refactor review are re-unwound, as at the
>   feature review

> ## 4. No test file touched by the refactor (TECHNICAL)
>
> - **A refactor turn (building, fix, quality fix, nit) that changes a test file
>   is refused at `gtd land`**, even when the file is a stray — today's package
>   rule "a test file only when it is one of them" goes
> - Refactor package text and prompts drop that exception

> ## 5. `refactorQualityReviews` setting (PRODUCT)
>
> - **New process setting `refactorQualityReviews`, default
>   `correctness, ponytail-review, conventions`**: the lenses of the refactor
>   slice's quality lap (`refactor.build.quality.<lens>`); `qualityReviews`
>   keeps driving the feature slice
> - Settable like `qualityReviews`: factory option,
>   `GTD_REFACTORQUALITYREVIEWS`; blank runs no refactor lap

## Answered Questions

### Are the two deferred review notes formerly in `.gtd/TODO.md` in scope?

No — the human's sketch replaced them; their removal drops them.

### Does the refactor review use the full review flow (triage, nits, defer)?

Yes — the issue names it a review like the feature one; only the edit route
differs (re-run refactor, not re-plan).

### What happens when a refactor review note needs a path outside the strays?

The guard refuses it; the issue settles it: a wrong refactor means abandon and
restart.

### What are the refactor review's step names?

The refactor tail nests under `refactor` (`refactor.build.review.*`,
`refactor.build.quality.<lens>`); the feature tail keeps `build.review.*` on
every path, so the default path and the feature review's names are untouched.

### What records the refactor approval once `seam.approve` is gone?

The refactor review's sign-off commit, like the feature review's; no
`Gtd-Approved:` trailer on the refactor-first path.

### Which slices does the naive path record when the judge rules `land`?

Every naive-path verdict wraps implement + review in `slice("feature")`; the
default path keeps the implicit `main`.

### Does feature review feedback re-run the naive pass and judge after a `land` verdict?

No — once judged, every feature feedback round is design → implement, on every
verdict.

### What skills do the new `refactor.build.*` scopes carry by default?

The same lists as their `build.*` counterparts, verbatim — the settled
requirement says so; the refactor's own turns (`refactor`, `refactor.fix.suite`,
`refactor.health`) keep `ponytail`.

### Where does the refactor review collect its edit notes?

Into `.gtd/REFACTOR.md`: `.gtd/REQUIREMENTS.md` still holds the design during
the refactor slice, so its presence cannot signal feedback; the package is
closed before the tail and re-derived with the notes under `## Review feedback`,
so no new state file appears.

### Is `refactorFirst` replaced by the reviewed refactor?

No — it stays a public helper with its signature (custom workflows call it);
`reviewedRefactor` shares its turns and adds the tail inside the same `refactor`
scope, so no `refactor.refactor.*` names appear.

### Which range does the flag-count guard span across refactor feedback laps?

HEAD at the `refactor` scope's entry, for every lap: no lap may raise a flag
count the slice as a whole did not have.

### What file access do the `refactor.build.*` scopes get?

They inherit `refactor`'s `write: [...strays, ".gtd/**"]`; only the leaf
`refactor.build.quality.<lens>` scopes narrow to `write: []`. A static
`refactor.build.review` entry cannot name the runtime strays its nit and risk
fixes need, and `gtd land`'s guard catches the rest.

### Does a feedback lap's implement turn still get the naive pass as reference?

No — the tree already holds the previous implementation; the pre-refactor naive
tip and old requirements would mislead, so `implement` takes an optional
reference and feedback laps pass none.

### Where does `reUnwind` live?

`review.ts`, re-exported from `feature.ts` under the same name: `refactor.ts`
needs it and `.dependency-cruiser.mjs` forbids the `feature.ts` ↔ `refactor.ts`
cycle.

### What happens to a process resting at `seam.approve` on upgrade?

It diverges like any Stable step rename; the `BREAKING CHANGE:` footer tells the
person to `gtd abandon` and restart.
