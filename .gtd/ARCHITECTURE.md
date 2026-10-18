# PR 390 follow-up fixes

Five packages, built in this order: unbuildable-note refusal (1), refactor
fix-scope write limit plus its docs (2+3), `afterTail` naive feedback lap (4),
per-slice quality-lap base (5), one shared collecting prompt (6). Each ships
green on its own.

## Interfaces

### ReviewPolicy

`src/workflow-kit/review.ts` — public (`@pmelab/gtd/workflow-kit`), additive
only. Concern 1.

```ts
/** What a round asked to change: the `edit` notes it carried and the code paths the human hand-edited. */
export interface Requested {
  readonly notes: readonly ReviewNote[]
  readonly paths: readonly string[]
}

export interface ReviewPolicy {
  // …unchanged members…
  readonly refusals: {
    readonly deleted: string
    readonly unmatched: string
    /**
     * The collecting turn changed nothing though the round carried an `edit`
     * note or a code hand-edit. Absent: that round signs off, as today.
     */
    readonly dropped?: (requested: Requested) => string
  }
}
```

- `collect(p, capture, requested?)` refuses with `dropped(requested)` when the
  turn wrote no `feedback` file, changed nothing, `dropped` is set, and
  `requested` holds at least one note or path
- `routeNotes`' edits branch passes `{ notes: edits, paths: [] }`
- `finish`'s hand-edit branch passes
  `{ notes: reviewNotes(baselineText, record), paths: edited.map((c) => c.path) }`
- The unparsed-notes branch (`captures.notes`) passes nothing: an approving
  remark there still signs off by changing nothing
- **The refusal refuses the collecting turn's landing**: no new step, no new
  step name; the driver re-prompts once, then the process shows as blocked

### FeedbackTarget

`src/workflows/feature/review.ts`. Concern 1.

```ts
export interface FeedbackTarget {
  readonly file: string
  readonly collecting: (capture: string) => Promise<void>
  readonly unmatched: string
  /** Passed through as `refusals.dropped`; absent on the feature review. */
  readonly dropped?: (requested: kit.Requested) => string
}
```

### refactorDroppedRefusal

`src/workflows/shared/text.ts`. Concern 1.

```ts
/**
 * `gtd land: refactor-feedback: …` — names every left-out note
 * (`note-<n> (<anchor>): <text>`) and hand-edited path, tells the human to run
 * `gtd abandon` and restart, and says abandoning throws away the naive pass,
 * the refactor and its review.
 */
export const refactorDroppedRefusal: (requested: Requested) => string
```

### BuildTailOptions

`src/workflows/feature/review.ts`. Concerns 2 and 5.

```ts
export interface BuildTailOptions {
  readonly guard?: Guard
  readonly guardRests?: boolean
  readonly lenses?: readonly string[]
  readonly feedback?: FeedbackTarget
  /** Write access for `review.fix.nits` and `review.fix.risks`; absent: the bundled `access` export decides. */
  readonly fixAccess?: ScopeAccess
  /** The commit the quality lap reviews from; absent: `start()`. */
  readonly lensBase?: string
}
```

### fixNits / fixRisks

`src/workflows/feature/steps.ts`, `src/workflows/shared/steps.ts`. Concern 2.

```ts
export const fixNits: (
  notes: readonly t.NoteInput[],
  access?: ScopeAccess,
) => Promise<void>
export const fixRisks: (
  notes: readonly t.NoteInput[],
  access?: ScopeAccess,
) => Promise<void>
```

- With `access`, the turn runs as
  `scope({ name: "review.fix.nits", access }, () => agentWithSkills("fixing", …))`
  (`review.fix.risks` likewise): **the full step name stays
  `refactor.build.review.fix.nits.fixing` — public API, unchanged**
- The scope option sits at the fix scope's own prefix, so it outranks the
  bundled `refactor.build.review` entry (`.gtd/REVIEW.md`) a shorter prefix
  would otherwise hit; a `config.access` entry on the fix scope still wins
- Without `access`, the call is today's, byte for byte

### access

`src/workflows/shared/access.ts`. Concern 2.

```ts
// Removed: "refactor.build.review.fix.nits": {}, "refactor.build.review.fix.risks": {}
// Kept:    "refactor.build.review": { write: [".gtd/REVIEW.md"] },
//          "refactor.build.review.defer": { write: [".gtd/TODO.md"] }
```

### afterTail

`src/workflows/feature/feature.ts` — public, signature unchanged. Concern 4.

```ts
/** After a tail that skipped planning: stop on sign-off; on feedback, re-plan — on the naive path design → implement → feature review, never the seam. */
export const afterTail: (outcome: ReviewOutcome) => Promise<void>
```

- Internal `featureFeedback(outcome, lensBase?)` holds the loop now inlined in
  `naivePlanAndBuild`: re-unwind, `design(outcome.base)`, record the risk tier,
  `implement(undefined, tier)`, `buildTail(false, outcome.base, true, …)`, until
  sign-off
- `naivePlanAndBuild` calls it after its first tail; `afterTail` calls it when
  `vars.flag_naive_pass === "1"`, else `planAndBuild` as today
- `afterTail` opens no slice: its caller's tail ran outside one

### tail

`src/workflows/shared/tail.ts`, `src/workflows/shared/steps.ts`. Concern 5.

```ts
export const tail: <T>(
  fixFirst: boolean,
  finish: (escalations: EscalationCount) => Promise<T>,
  green?: boolean,
  guard?: Guard,
  lenses?: readonly string[],
  guardRests?: boolean,
  lensBase?: string,
) => Promise<T>

export const qualityLap: (
  guard?: Guard,
  lenses?: readonly string[],
  base?: string,
) => Promise<"clean" | "findings">
export const reviewQuality: (lens: string, base?: string) => Promise<void>
```

### buildQualityReviewingPrompt

`src/workflows/shared/text.ts`. Concern 5.

```ts
/** Reviews from `base` (default `start()`) to the working tree. */
export const buildQualityReviewingPrompt: (
  lens: string,
  brief?: string,
  base?: string,
) => string
```

- The prompt names the process start beside `base`; `specChallengeBrief` looks
  up planning documents from the process start, never from `base` — the
  feature's `design.triage` lands before the slice base

### buildReviewCollectingPrompt

`src/workflows/shared/text.ts`. Concern 6.

```ts
/** One collecting prompt. `refactor` adds the constraint block and targets `.gtd/REFACTOR.md`. */
export const buildReviewCollectingPrompt: (
  capture: string,
  refactor?: { readonly strays: readonly string[] },
) => string
// Removed: refactorReviewCollectingPrompt
```

- Without `refactor`: **text identical to today's** (target
  `.gtd/REQUIREMENTS.md`, PRODUCT/TECHNICAL concern shape)
- With `refactor`: target `.gtd/REFACTOR.md`; constraint block lists the strays
  and forbids any other path, a test file, a new or added flag read, or a
  behaviour change; a concern breaking it is not folded; **no "say in the reply"
  wording** — the refusal carries the `gtd abandon` advice
- Both variants carry answered questions into the target file's
  `## Answered Questions` when the capture names an answering commit

### reviewedRefactor

`src/workflows/feature/refactor.ts` — signature unchanged. Concerns 1, 2, 5, 6.

```ts
export const reviewedRefactor: (
  shape: DiffShapeResult,
  options?: RefactorOptions,
) => Promise<boolean>
```

- Passes
  `buildTail(false, entry, true, { guard, guardRests: false, lenses, feedback, fixAccess, lensBase: entry })`
  with `fixAccess = { write: [...strays, ".gtd/**"] }` and
  `feedback.dropped = t.refactorDroppedRefusal`
- `refactorCollecting(capture, strays)` calls
  `buildReviewCollectingPrompt(capture, { strays })`
- The re-derived package demotes every heading of the collected text one level
  (`## Answered Questions` → `### Answered Questions`), so it nests under
  `## Review feedback`

## Call Stacks

### 1. Unbuildable refactor note refuses

- `reviewedRefactor` → `buildTail` → `review(base, …, { feedback })` →
  `kit.review`
- `kit.review` → `finish` → `routeNotes` (edit notes) or hand-edit branch →
  `collect(p, capture, requested)`
- `collect` → `p.collecting` (`refactorCollecting`) → no `.gtd/REFACTOR.md`, no
  change → `refuse(p.refusals.dropped(requested))`

### 2+3. Refactor fix scopes keep the write limit

- `reviewedRefactor` → `buildTail({ fixAccess })` → `review` → `kit.review` →
  `p.fixNits` / `p.fixRisks`
- `review.ts` wrapper → `fixNits(notes, fixAccess)` →
  `scope({ name: "review.fix.nits", access })` → `agentWithSkills("fixing")`
- Engine `resolveAccess("refactor.build.review.fix.nits")` → own scope option →
  `gtd next --json` `access.write` = strays + `.gtd/**` (+ `.gtd/REVIEW.md`
  folded) → `gtd land` refuses a write outside it

### 4. `afterTail` on the naive path

- custom workflow → `buildTail(…)` → `afterTail(outcome)`
- `afterTail` → `flag_naive_pass === "1"` → `featureFeedback(outcome)` →
  `reUnwind` → `design` → `implement` → `buildTail` (loop until sign-off)
- otherwise → `reUnwind` → `planAndBuild(outcome.base)` (unchanged)

### 5. Quality lap from the slice base

- `reviewedRefactor` → `buildTail({ lensBase: entry })` → `tail(…, lensBase)` →
  `qualityLap(guard, lenses, lensBase)` → `reviewQuality(lens, lensBase)` →
  `buildQualityReviewingPrompt(lens, brief, lensBase)`
- `naivePlanAndBuild` →
  `buildTail(false, seam.base, true, { lensBase: seam.base })` →
  `featureFeedback(outcome, seam.base)` → every lap's `buildTail` keeps
  `lensBase: seam.base` while its review `base` is `outcome.base`
- `planAndBuild` (non-naive), `afterTail`, `handOffTail` → no `lensBase` →
  `start()`

### 6. One collecting prompt

- `review` (feature) → `collecting(capture)` →
  `buildReviewCollectingPrompt(capture)`
- `reviewedRefactor` → `refactorCollecting(capture, strays)` →
  `buildReviewCollectingPrompt(capture, { strays })`
- `reviewedRefactor` loop → `read(.gtd/REFACTOR.md)` →
  `refactorLap(…, collected)` → `deriveScript` with demoted headings under
  `## Review feedback`

## E2E Scenarios

- e2e: src/workflows/feature/refactor-review.feature — an `edit` note the
  refactor collecting turn leaves out (no `.gtd/REFACTOR.md`, nothing changed)
  refuses the collecting landing with "refactor-feedback", naming the note and
  `gtd abandon`, and never signs off (covers 1)
- e2e: src/workflows/feature/refactor-review.feature — a code hand-edit at the
  refactor review the collecting turn leaves out refuses the same way, naming
  the edited path (covers 1)
- e2e: src/workflows/feature/refactor-review.feature — a praise-only refactor
  review round still signs off and the feature slice follows (covers 1)
- e2e: src/workflows/feature/refactor-review.feature — at
  `refactor.build.review.fix.nits.fixing`, `gtd next --json=access.write` lists
  the strays and `.gtd/**`, and a nit fix writing a non-stray is refused at
  landing (covers 2+3)
- e2e: tests/integration/features/workflow-module-reuse.feature — a custom
  workflow ending in `afterTail` with `GTD_FLAG_NAIVE_PASS=1`: review feedback
  rests at `design.triage`, then `implement.building`, and no commit subject
  names `seam.naive` or `seam.judge` (covers 4)
- e2e: src/workflows/feature/refactor-review.feature — on `refactor-first` the
  refactor's quality-lens prompt names the refactor's entry commit as its base,
  and the feature's quality-lens prompt names the refactor's sign-off commit,
  before and after a feature feedback lap (covers 5)
- e2e: src/workflows/feature/refactor-review.feature — a question answered at
  the refactor review, followed by an edit note, reaches the re-derived
  `.gtd/REFACTOR.md` under `## Review feedback` as `### Answered Questions`
  (covers 6)

## Unit Tests

### ReviewPolicy

- unit: src/workflow-kit/review.test.ts — with `refusals.dropped` set, an
  edit-note round whose collecting turn changes nothing refuses with the message
  `dropped` builds from those notes (covers 1)
- unit: src/workflow-kit/review.test.ts — with `refusals.dropped` set, a
  hand-edit round whose collecting turn changes nothing refuses, passing the
  edited paths (covers 1)
- unit: src/workflow-kit/review.test.ts — with `refusals.dropped` set, a
  praise-only round and an unparsed-note round that change nothing still sign
  off (covers 1)
- unit: src/workflow-kit/review.test.ts — without `refusals.dropped`, an
  edit-note round that changes nothing signs off as today (covers 1)

### FeedbackTarget

- unit: src/workflows/feature/review.test.ts — the feature review's default
  target sets no `dropped`: an edit-note round collected to nothing signs off
  (covers 1)

### refactorDroppedRefusal

- unit: src/workflows/shared/text.test.ts — the message starts
  `gtd land: refactor-feedback:`, lists each note's id, anchor and text and each
  path, names `gtd abandon`, and says the naive pass, the refactor and its
  review are thrown away (covers 1)

### BuildTailOptions

- unit: src/workflows/feature/review.test.ts — `fixAccess` reaches both the
  nit-fix and risk-fix turns' resolved access; absent, both resolve as today
  (covers 2+3)
- unit: src/workflows/feature/review.test.ts — `lensBase` reaches every
  quality-lens prompt; absent, the prompt names `start()` (covers 5)

### fixNits / fixRisks

- unit: src/workflows/feature/review.test.ts — with `access`, the turn's full
  step name is still `review.fix.nits.fixing` / `review.fix.risks.fixing` under
  the enclosing scopes (covers 2+3)

### access

- unit: src/workflows/shared/access.test.ts — the bundled export carries no
  `refactor.build.review.fix.nits` or `refactor.build.review.fix.risks` entry;
  `refactor.build.review` and `refactor.build.review.defer` are unchanged
  (covers 2+3)

### afterTail

- unit: src/workflows/feature/feature.test.ts — with `flag_naive_pass=1`,
  feedback through `afterTail` rests at `design.triage`, then
  `implement.building`, and reaches no `seam.*` step (covers 4)
- unit: src/workflows/feature/feature.test.ts — with `flag_naive_pass=0`,
  feedback through `afterTail` runs `architecture.*` and `packages.*` as today
  (covers 4)

### tail

- unit: src/workflows/shared/tail.test.ts — `tail(…, lensBase)` hands `lensBase`
  to every lens turn's prompt; without it the prompt names `start()` (covers 5)

### buildQualityReviewingPrompt

- unit: src/workflows/shared/text.test.ts — reviews from the given base,
  defaults to `start()`, and keeps naming the process start for the
  spec-challenge brief's planning-document lookup (covers 5)

### buildReviewCollectingPrompt

- unit: src/workflows/shared/text.test.ts — without `refactor` the text equals
  today's feature prompt verbatim (covers 6)
- unit: src/workflows/shared/text.test.ts — with `refactor` it targets
  `.gtd/REFACTOR.md`, lists every stray, forbids test files, flag reads and
  behaviour changes, carries answered questions to `## Answered Questions`, and
  contains no "say in the reply" wording (covers 1, 6)

### reviewedRefactor

- unit: src/workflows/feature/refactor.test.ts — an edit-note round whose
  collecting turn writes nothing is refused naming the note, never a `signoff`
  (covers 1)
- unit: src/workflows/feature/refactor.test.ts — the nit-fix turn's resolved
  write access is the strays plus `.gtd/**` (covers 2+3)
- unit: src/workflows/feature/refactor.test.ts — the refactor's quality-lens
  prompt names the refactor's entry commit on the first lap and after a feedback
  lap (covers 5)
- unit: src/workflows/feature/refactor.test.ts — the re-derived package nests a
  collected `## Answered Questions` as `### Answered Questions` under
  `## Review feedback` (covers 6)
- unit: src/workflows/feature/refactor.test.ts — collecting uses the shared
  prompt with the refactor block (covers 6)

### Chores

- chore: docs/configuration.md — rewrite the refactor-review paragraph: an
  unbuildable note refuses the collecting landing, the only way out is
  `gtd abandon`, which throws away the naive pass, the refactor and its review
  (covers 1)
- chore: docs/configuration.md — add `refactor.build.review`,
  `refactor.build.review.defer` and the two fix scopes (strays plus `.gtd/**`,
  set at run time; a `config.access` entry on the fix scope outranks it, a
  `config.access.refactor` entry does not reach it) to "Bundled defaults"
  (covers 2+3)
- chore: docs/configuration.md — drop `refactor.build.review.health.*` from the
  never-guarded rests; check every `refactor.build.*` name against the scopes
  the flow opens (covers 2+3)
- chore: docs/configuration.md — the naive-pass section says `afterTail`'s
  feedback lap is design → implement, never the seam (covers 4)
- chore: docs/configuration.md — the naive-pass section says each slice's
  quality lap reviews from that slice's base (covers 5)
- chore: src/workflows/shared/text.ts — delete `refactorReviewCollectingPrompt`
  (covers 6)

## Merged Concerns

### 2+3. Refactor review fix scopes keep the write limit, and the docs match

Merged: concern 2 must update `docs/configuration.md`'s access table anyway, and
concern 3 is that same table and its scope lists.

> **2. Refactor review fix scopes keep the refactor's write limit (TECHNICAL)**
>
> The access table gives `refactor.build.review.fix.nits` and
> `refactor.build.review.fix.risks` `{}`, copied from the feature review. **`{}`
> reopens all writes, so a nit or risk fix inside the refactor review can edit
> any file**, past the strays-plus-`.gtd/**` limit the `refactor` scope sets.
>
> - Both scopes get the strays plus `.gtd/**` as `write`, never `{}`
> - The strays are only known at run time, so the limit comes from the
>   refactor's own `scope()` option, not the static table; the static `{}`
>   entries go
> - `refactor.build.review` (`.gtd/REVIEW.md`) and `refactor.build.review.defer`
>   (`.gtd/TODO.md`) stay as they are
> - Tests: `access.test.ts`, plus a scope-access scenario where a refactor nit
>   fix writing outside the strays is refused

> **3. `docs/configuration.md` access and scope lists match the code
> (TECHNICAL)**
>
> - Add the refactor review rows to the "Bundled defaults" table:
>   `refactor.build.review`, `refactor.build.review.defer`, and the two fix
>   scopes with the write limit from concern 2
> - Drop `refactor.build.review.health` from the refactor-tail rest list: no
>   such scope exists — the tail's health loop is `refactor.build.health.*`
> - Check every other `refactor.build.*` name in the doc against what the flow
>   actually opens

## Answered Questions

### How does a run-time write limit reach the two refactor fix scopes?

A `fixAccess` option on `buildTail` wraps each fix turn in a scope named for its
own memory scope (`review.fix.nits`, `review.fix.risks`): only an option at that
exact prefix outranks the bundled `refactor.build.review` entry, and the full
step names stay unchanged.

### Where does the "nothing to build" refusal live?

As an optional `refusals.dropped` hook in the workflow kit's `collect`: only the
kit knows whether the round carried an edit note or a hand-edit, and leaving it
optional keeps the feature review's "change nothing to sign off" intact.

### Does an unparsed-note round count as carrying a change request?

No. It is where an approving remark lands, and the concern keeps such a round
signing off.

### Does `afterTail`'s naive feedback lap open a `feature` slice?

No. Its caller's tail ran outside any slice, and slices cannot nest.

### What base does a quality lap use outside a naive slice?

`start()`, as today: `planAndBuild`, `afterTail` and the hand-off tails pass no
`lensBase`.

### Where does spec-challenge look for planning documents once the lap base moves?

From the process start, still: `design.triage` lands before the feature slice's
base, so a slice-based lookup would find no requirements.

### How do answered questions nest under `## Review feedback` in the re-derived package?

The derive script demotes every heading of the collected text one level, so the
collected `## Answered Questions` becomes `### Answered Questions` inside the
feedback section.

### Should an unbuildable refactor-review edit note sign off, or refuse?

Refuse. `.gtd/TODO.md` says so outright: "must never sign off silently - refuse
instead".

### Do the two deferred-review-note sections removed from `.gtd/TODO.md` become concerns?

No. The human deleted both (note-3, the garbled-flag stdout assertion; note-2,
the `gtd history list` kept-tip scenario) in the same edit that wrote the fix
list. Deleting a parked note drops it.

### Should the refactor review's fix scopes stay unrestricted like the feature review's?

No. The TODO asks for strays plus `.gtd/**` write, and the refactor slice's
whole promise is that it touches only the strays.

### Should a feedback lap reached through `afterTail` re-run the seam on the naive path?

No. The TODO says it skips the seam, and the shipped flow already never re-runs
the seam once judged.

### After an unbuildable refactor note is refused, what is the human's way out?

`gtd abandon` only. The collecting turn's landing is refused, matching the
current docs ("abandon and restart"); no rest step for dropping the note is
added. Abandoning loses the naive pass, the refactor and its review.
