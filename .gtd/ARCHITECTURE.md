# Architecture: PR 390 round 3 correctness fixes

Five packages, in build order: (1+5) test-file strays and capped headings, (2)
settled-round refusal, (3+4) closed collecting variant, (6) reviewing-prompt lap
wording, (7) upgrade note. Every one is TECHNICAL and ships its own tests.

## Interfaces

```ts
// src/workflows/feature/refactor.ts — concern 1
/** True for a path any `testFileGlobs` entry matches; `requireNoTestFiles` uses it too. */
export const isTestFile: (path: string) => boolean

/** `shape.strays` minus every test file: the refactor's whole scope. */
export const refactorStrays: (shape: DiffShapeResult) => readonly string[]

// Changed contract, same signatures:
// - `refactorFirst` / `reviewedRefactor` resolve `false` and open no `refactor`
//   scope when `refactorStrays(shape)` is empty. Package scope list,
//   `strayAccess`, `guardOf`'s `requireWithin` and the collecting fence all
//   read the filtered list.
// - concern 5: the derived package's `## Review feedback` headings shift so the
//   shallowest lands at `###`, each capped at `######`; fenced and non-heading
//   lines untouched.

// src/workflows/feature/seam.ts — concern 1, changed contract only
// `seamBuild(base)`: a `refactor-first` shape whose `refactorStrays` is empty
// resolves `{ reference, base }` (the caller's base), opens no `refactor`
// slice and runs no `seam.by-hand`. Checked before the unreadable branch.
```

```ts
// src/workflow-kit/review.ts — concerns 2 and 3
/** Which collecting turn runs: in-gate thread replies, or a closed round of each kind. */
export type CollectRound = "reply" | "edits" | "notes" | "triaged"

export interface ReviewPolicy {
  // was: (capture: string) => Promise<void>
  readonly collecting: (capture: string, round: CollectRound) => Promise<void>
  // ...unchanged
}

// Changed contract of `review` (concern 2): a round that is `settled` and not
// `folded`, with `refusals.dropped` set, no longer signs off unjudged when
// anything since `reviewed` asked for a change:
//   1. notes = reviewNotes(review@reviewed, review now); edited = code hand-edits since `reviewed`
//   2. notes non-empty → `triage(notes)`; change notes = verdict `edit`, `nit` or `defer`
//   3. no change note and no hand-edit → sign off, as today
//   4. else close, then `collect` with
//        edited non-empty → captures.edits(round), round "edits"
//        otherwise        → captures.editNotes(round, changeNotes, undefined), round "triaged"
//      and `requested = { notes: changeNotes, paths: edited }`, so an empty
//      collecting turn refuses through `refusals.dropped`.
// Without `refusals.dropped` (the feature review) the settled branch is unchanged.
```

```ts
// src/workflows/feature/review.ts — concern 3
export interface FeedbackTarget {
  readonly file: string
  readonly collecting: (
    capture: string,
    round: kit.CollectRound,
  ) => Promise<void> // was (capture)
  readonly unmatched: string
  readonly dropped?: (requested: kit.Requested) => string
}

// src/workflows/feature/steps.ts — concern 3
// `open` now derives from `round === "reply"`, not from whether .gtd/REVIEW.md exists.
export const refactorCollecting: (
  capture: string,
  round: CollectRound,
  strays: readonly string[],
) => Promise<void>
export const collecting: (capture: string, round: CollectRound) => Promise<void> // round unused

// src/workflows/shared/text.ts — concerns 3 and 4
export const buildReviewCollectingPrompt: (
  capture: string,
  refactor?: {
    readonly strays: readonly string[]
    readonly round: CollectRound // was: open: boolean
  },
) => string
// round "reply": open variant, unchanged (keeps footnoteFoldIn + codeThreadReplies).
// Closed variants (any other round): render NEITHER footnoteFoldIn NOR codeThreadReplies, and fold
//   "edits"   → every hand-edit and every note the human left that round
//   "notes"   → each note that asks for a change
//   "triaged" → each `edit` note the capture lists, no other note (today's text)
// Fence and the "must write .gtd/REFACTOR.md" rule unchanged. No `refactor` → unchanged.
```

```ts
// src/workflows/shared/text.ts — concern 6
/** Which review round the reviewer writes; the caller says, the prompt never infers it from `base`. */
export type ReviewLap = "first" | "feedback" | "refactor"

export const buildReviewReviewingPrompt: (
  base: string,
  lap: ReviewLap, // new, required
  carry?: string,
  removed?: readonly RemovedAssertions[],
) => string
// "first":    the range covers everything since `base`
// "feedback": only what is new since the previous review
// "refactor": the whole refactor since it started, on every round

// src/workflows/shared/steps.ts
export const reviewing: (
  base: string,
  lap: ReviewLap,
  carry?: string,
) => Promise<void>

// src/workflows/feature/review.ts
export interface BuildTailOptions {
  /** Absent: "first". */
  readonly lap?: ReviewLap
  // ...unchanged
}
```

## Call Stacks

Concern 1 (+5):

- `naivePlanAndBuild` → `seamBuild(base)` → `decide()` → `judgeSeam` →
  `refactorStrays(shape)` empty → `{ reference, base }` → `implement` →
  `buildTail(…, seam.base = base)`
- `seamBuild` → `slice("refactor")` → `reviewedRefactor(shape)` → `plan` (reads
  `refactorStrays`) → `scope("refactor", strayAccess(filtered))` → `refactorLap`
  → `deriveScript(packageLines(filtered) + demoteHeadings(feedback))`
- `refactorLap` guard → `guardOf` → `requireWithin(filtered)` /
  `requireNoTestFiles` → `isTestFile`

Concern 2:

- `kit.review` → `converse` (in-gate `collecting(capture, "reply")`) → `finish`
  → settled ∧ ¬folded ∧ `refusals.dropped` → `triage(notes)` → `close` →
  `collect(capture, round, requested)` → `refusals.dropped` →
  `refactorDroppedRefusal`

Concern 3 (+4):

- `kit.finish` / `routeNotes` / `converse` → `p.collecting(capture, round)` →
  `FeedbackTarget.collecting` → `refactorCollecting(capture, round, strays)` →
  `buildReviewCollectingPrompt(capture, { strays, round })`

Concern 6:

- `planAndBuild` / `featureFeedback` / `naivePlanAndBuild` / `afterTail` →
  `buildTail(…, { lap })` → `review(base, …, options)` → `kit.review` →
  `p.reviewing(b, carry)` → `reviewing(b, lap, carry)` →
  `buildReviewReviewingPrompt(b, lap, carry, removed)`
- `reviewedRefactor` → `buildTail(…, { lap: "refactor" })` → same chain
- `shared/tail.ts` hand-off review → `reviewing(b, "first")`

## E2E Scenarios

- e2e: src/workflows/feature/refactor-review.feature — with a narrowed
  `seamAllow`, `refactor-first` strays `src/calc.ts` and `src/calc.test.ts`
  derive a `.gtd/REFACTOR.md` whose scope lists only `src/calc.ts` (covers
  concern 1)
- e2e: src/workflows/feature/refactor-review.feature — `refactor-first` whose
  strays are all test files rests next at `implement.building`, no `refactor.*`
  step in the history, and the feature review's base is the caller's base
  (covers concern 1)
- e2e: src/workflows/feature/refactor-review.feature — a line note asking for a
  change plus a `- H:` thread question; the in-gate collecting turn only
  replies; the human lands only a concluding thread reply; the closed collecting
  turn writes nothing → `gtd land` refuses with `refactor-feedback`, naming the
  note and `gtd abandon` (covers concern 2)
- e2e: src/workflows/feature/refactor-review.feature — the same round where the
  human's code hand-edit precedes the thread → the refusal names
  `hand-edited <path>` (covers concern 2)
- e2e: src/workflows/feature/refactor-review.feature — a praise line note plus a
  concluded thread on a settled round signs off and the feature slice follows
  (covers concern 2)
- e2e: src/workflows/feature/refactor-review.feature — a hand-edit round with a
  line note rests at `refactor.build.review.collecting` whose content says to
  fold every hand-edit and every note left that round, and holds neither the
  footnote fold-in rule nor the code-thread reply rule (covers concerns 3, 4)
- e2e: src/workflows/feature/refactor-review.feature — a collected
  `.gtd/REFACTOR.md` with `#` and `#####` headings re-derives a package holding
  them as `###` and `######` under `## Review feedback` (covers concern 5)
- e2e: src/workflows/feature/refactor-review.feature — the second
  `refactor.build.review.reviewing` rest's content says the range is the whole
  refactor since it started, and the feature's feedback-lap
  `build.review.reviewing` says only what is new since the previous review
  (covers concern 6)

## Unit Tests

### isTestFile / refactorStrays

- unit: src/workflows/feature/refactor.test.ts — `refactorStrays` drops
  `src/a.test.ts` and keeps `src/a.ts`, and ignores a narrowed `seamAllow`
  (covers concern 1)
- unit: src/workflows/feature/refactor.test.ts — `requireNoTestFiles` still
  refuses exactly what it refused before, through `isTestFile` (covers
  concern 1)

### refactorFirst / reviewedRefactor (changed contract)

- unit: src/workflows/feature/refactor.test.ts — strays `src/a.ts` +
  `src/a.test.ts`: the package's scope lists only `src/a.ts`, scope write access
  is `src/a.ts` + `.gtd/**`, the collecting prompt's fence names only `src/a.ts`
  (covers concern 1)
- unit: src/workflows/feature/refactor.test.ts — all-test strays resolve `false`
  with no step run and no `refactor` scope (covers concern 1)
- unit: src/workflows/feature/refactor.test.ts — collected feedback with `#` and
  `#####` headings derives `###` and `######`; a fenced `#######`-bound line and
  prose stay untouched (covers concern 5)

### seamBuild (changed contract)

- unit: src/workflows/feature/seam.test.ts — `refactor-first` with only
  test-file strays resolves `{ reference, base: caller's base }`, enters no
  slice and runs no `seam.by-hand` (covers concern 1)

### CollectRound / ReviewPolicy.collecting

- unit: src/workflow-kit/review.test.ts — `collecting` receives `"reply"` in the
  gate, `"edits"` on a hand-edit round, `"notes"` on an unparsed-notes round,
  `"triaged"` after triage (covers concern 3)

### review (settled-round contract)

- unit: src/workflow-kit/review.test.ts — settled round, `dropped` set, an
  `edit`-judged note since `reviewed`, empty collecting turn → refuses with
  `dropped`, `requested.notes` naming that note (covers concern 2)
- unit: src/workflow-kit/review.test.ts — settled round, `dropped` set, a code
  hand-edit since `reviewed` → `requested.paths` names the path (covers
  concern 2)
- unit: src/workflow-kit/review.test.ts — settled round, `dropped` set, the
  closed collecting turn writes the feedback file → `feedback`, no refusal
  (covers concern 2)
- unit: src/workflow-kit/review.test.ts — settled round, `dropped` set, only
  praise or question notes or only thread replies → signs off (covers concern 2)
- unit: src/workflow-kit/review.test.ts — settled round without `dropped` and an
  `edit` note → signs off unjudged, no triage call (covers concern 2)

### FeedbackTarget / refactorCollecting / collecting

- unit: src/workflows/feature/refactor.test.ts — the in-gate collecting turn
  renders the open variant and a closed round the closed one, decided by the
  round, not by `.gtd/REVIEW.md`'s presence (covers concern 3)

### buildReviewCollectingPrompt

- unit: src/workflows/shared/text.test.ts — closed `"edits"` says fold every
  hand-edit and every note the human left that round (covers concern 3)
- unit: src/workflows/shared/text.test.ts — closed `"notes"` says fold each note
  that asks for a change (covers concern 3)
- unit: src/workflows/shared/text.test.ts — closed `"triaged"` keeps "each
  `edit` note the capture lists, no other note"; the fence and the must-write
  rule are present in every closed round (covers concern 3)
- unit: src/workflows/shared/text.test.ts — every closed round contains neither
  `footnoteFoldIn`'s text nor the code-thread reply text (a waiting code thread
  seeded); the open variant and the feature prompt contain both (covers
  concern 4)

### ReviewLap / buildReviewReviewingPrompt

- unit: src/workflows/shared/text.test.ts — `"first"`, `"feedback"` and
  `"refactor"` each render their own range wording and none of the other two
  (covers concern 6)

### reviewing / BuildTailOptions.lap

- unit: src/workflows/feature/feature.test.ts — the first review lap's reviewing
  prompt says everything since base; after feedback it says only what is new, on
  both the planned and the naive-pass path (covers concern 6)
- unit: src/workflows/feature/refactor.test.ts — the refactor review's reviewing
  prompt says the whole refactor since it started, on the first and the second
  round (covers concern 6)

### Chores

- chore: docs/configuration.md — refactor-review section: test-file strays are
  dropped and an all-test refactor-first goes straight to `implement.*`; a
  settled round with an unfolded change note or hand-edit refuses
  (`refactor-feedback`), naming notes judged `edit`, `nit` or `defer` and
  hand-edited paths; the closed collecting turn folds hand-edits and unparsed
  notes (covers concerns 1, 2, 3)
- chore: docs/configuration.md — **Upgrading**: "a `GTD_FLAG_NAIVE_PASS` process
  from 27.5.0 or later" in place of "from any 28.x release" (covers concern 7)
- chore: PR 390 body (`gh pr edit 390`) — `BREAKING CHANGE:` footer says "from
  27.5.0 or later" in place of "from 28.0.0" (covers concern 7)

## Merged Concerns

### Concern 5 merged into concern 1 — both center on `src/workflows/feature/refactor.ts`'s package derivation

Concern 1, verbatim:

> **Today `plan` hands every stray to the refactor, test files included.** With
> a narrowed `seamAllow`, a test file becomes a stray. The refactor may never
> change a test file (`refactor-tests`), so a package scoped to it can never
> pass.
>
> - **Drop every stray matching `testFileGlobs` before building the plan.** The
>   same fixed list the `refactor-tests` guard uses — never `seamAllow`.
> - **No stray left: treat the verdict as `land`.** No `refactor` scope, no
>   `refactor.*` step, no refactor review; the feature builds from the naive
>   pass's tip, and the feature review's base is the caller's base, not a
>   post-refactor `head()`.
> - Package scope list, write access (`strayAccess`), the scope guard and the
>   collecting fence all use the filtered list.
> - Ordered first: concerns 2–4 build on what the refactor scope holds.
>
> Acceptance: `refactor-first` with strays `src/a.ts` and `src/a.test.ts` → the
> package lists only `src/a.ts`. `refactor-first` whose strays are all test
> files → the process goes straight to `implement.*`, no `refactor.*` step runs.

Concern 5, verbatim:

> **Today `demoteHeadings` shifts every heading by the same amount, so a deep
> heading in the collected feedback passes `######` and stops being a heading.**
> A `#####` heading with shallowest `#` lands at `#######`.
>
> - **Cap every demoted heading at `######`.**
> - Fenced lines and non-heading lines stay untouched, as today.
>
> Acceptance: feedback with `#` and `#####` headings → `###` and `######`.

### Concern 4 merged into concern 3 — both rewrite the closed variant of `buildReviewCollectingPrompt` in `src/workflows/shared/text.ts`

Concern 3, verbatim:

> **Today the closed variant (`open: false`) folds "each `edit` note the capture
> lists, no other note, and every hand-edit".** On a hand-edit round and on a
> notes round whose edit parses to no note, the capture lists no `edit` note, so
> the human's notes on those rounds are never folded.
>
> - **On a hand-edit round, fold every hand-edit and every note the human left
>   that round.**
> - **On an unparsed-notes round (`captures.notes`), fold each note that asks
>   for a change.**
> - On a triaged round, keep folding only the `edit` notes the capture lists.
> - The refactor fence and the "must write `.gtd/REFACTOR.md`" rule are
>   unchanged.

Concern 4, verbatim:

> **Today the closed variant still carries `footnoteFoldIn` and
> `codeThreadReplies()`.** Both tell the turn to reply in or edit a review that
> is already closed, contradicting "do not recreate it or reply in it".
>
> - **Render neither block in the `open: false` variant.**
> - The open variant and the feature (non-refactor) collecting prompt keep both,
>   unchanged.
> - Pin it in `text.test.ts`: the closed variant contains neither block's text;
>   the open variant contains both.

## Answered Questions

### Are the two deleted `## Deferred review notes` sections folded in?

No: the human deleted both (note-3 `stdout` assertion, note-2 `history list`
scenario) in the same edit that scoped this round to "correctness only", so they
are dismissed, not work for this process.

### Does a dropped test-file stray still get its change built?

Yes: the feature's `implement.*` turn reads the whole naive-pass tip, test files
included, so dropping a stray from the refactor never drops it from the feature.

### Where is the test-file filter applied: in `seamBuild`, in `plan`, or both?

Both, through one exported `refactorStrays`: `plan` filters so a custom workflow
calling the public `reviewedRefactor`/`refactorFirst` is safe too, and
`seamBuild` checks it first so an empty refactor opens no `refactor` slice and
keeps the caller's base.

### How does a settled round know which of its notes asked for a change?

It runs the same `triage` judge the unsettled path uses, but only when
`refusals.dropped` is set and the round left notes; the in-gate collecting turn
is no reliable witness, and praise must still sign off.

### Does a settled round with a change note refuse at once, or after a collecting turn?

After one closed collecting turn, through the existing `collect` path: that is
the only place a refusal lands on a turn's landing with the existing
`refusals.dropped` text, and a turn that does fold the note turns the round into
feedback instead of a forced `gtd abandon`.

### Which verdicts count as change notes on a settled round?

`edit`, `nit` and `defer`: on the settled path no nit-fix or deferral step runs,
so anything but praise and questions would otherwise be lost.

### How does the collecting prompt learn the round kind?

The kit passes it: `ReviewPolicy.collecting` gains a `CollectRound` argument,
since only the kit knows which capture it built; the prompt never parses the
capture, and `open` derives from `"reply"` instead of probing `.gtd/REVIEW.md`.

### How does the reviewing prompt learn the lap?

A required `ReviewLap` argument on `buildReviewReviewingPrompt` and `reviewing`,
fed from `BuildTailOptions.lap` (absent means `"first"`); each `buildTail`
caller passes `"feedback"` on a re-plan lap and `reviewedRefactor` passes
`"refactor"`.

### Is a settled notes round whose open turn deleted a change note without folding it detected?

No: notes are parsed from the review as it stands against the review at
`reviewed`, so a note the in-gate turn deleted unfolded is invisible; the open
variant's prompt already orders it to fold before deleting, and detecting it
would need the human's own landing commit, which the kit does not record.
