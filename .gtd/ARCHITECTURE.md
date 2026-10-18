## Interfaces

Five packages, in build order: refactor review round (concerns 1–3), refactor
tail prompts (4), feature feedback lap (5), shared fence tracker (6), docs and
migration (7–8).

**Concern 2 is half built already.** One-shot footnotes in `.gtd/REVIEW.md` are
review notes today and reach the triage judge on a plain round. Two holes let
one skip the judge:

- **The kit's settled check strips every footnote definition.** After an in-gate
  reply turn, a one-shot footnote landed later counts as "nothing noted": the
  round signs off unjudged
- **The in-gate collecting turn folds and deletes one-shot footnotes unjudged**
  (shared fold-in rule). Once concern 1 lets the refactor turn run in-gate, a
  footnote it deletes without writing `.gtd/REFACTOR.md` vanishes

Package A closes both. The `dropped` refusal already names a footnote by its
marker line, its `ReviewNote.anchor`.

```ts
// src/workflow-kit/review.ts — package A (concerns 2, 3)
export interface Requested {
  /** The round's notes judged `edit`. Empty on a hand-edit round: that path runs no triage. */
  readonly notes: readonly ReviewNote[]
  readonly paths: readonly string[]
}
// Contract change, no signature change: `review()` strips only THREAD
// footnotes (definition plus markers) when it decides a round is settled.
// One-shot footnotes count as notes and go to `triage` like line notes.
// `reviewToHandOff` uses the same rule: a footnote-only edit hands off and
// no longer closes as a sign-off.
// `finish` passes `{ notes: [], paths }` on the hand-edit path.
```

```ts
// src/workflows/shared/text.ts — package A (concern 1)
export const buildReviewCollectingPrompt: (
  capture: string,
  refactor?: {
    readonly strays: readonly string[]
    /** `.gtd/REVIEW.md` is still in the tree: an in-gate reply turn, not the end of the round. */
    readonly open: boolean
  },
) => string
// refactor && open: write exactly one `- A:` reply per thread whose last entry
// is a `- H:` question. Fold a concluded thread into `.gtd/REFACTOR.md` only
// when it asks for a change, then delete it. Leave one-shot footnotes and
// notes untouched: the round's triage judges them. Run
// `gtd check review .gtd/REVIEW.md`.
// refactor && !open: as today. The file is closed; do not recreate it or reply in it.
```

```ts
// src/workflows/feature/steps.ts — package A (concern 1). Signature unchanged.
// It now sets `open` from `read(REVIEW) !== undefined` at prompt time.
export const refactorCollecting: (
  capture: string,
  strays: readonly string[],
) => Promise<void>
```

```ts
// src/workflows/shared/text.ts — package B (concern 4)
export const refactorRules: (
  strays: readonly string[],
  pattern: string,
) => string // now exported
// Each prompt below gains an optional trailing `rules`. When given, the
// rendered block (strays, no test file, no new flag read) is appended, and any
// "add a test" line is dropped.
export const buildFixPrompt: (rules?: string) => string
export const buildFixQualityPrompt: (rules?: string) => string
export const buildReviewFixRisksPrompt: (
  notes: readonly NoteInput[],
  rules?: string,
) => string
export const buildReviewFixNitsPrompt: (
  notes: readonly NoteInput[],
  rules?: string,
) => string
export const healthDescribePrompt: (rules?: string) => string
```

```ts
// Public exports of @pmelab/gtd/workflows — package B (concern 4). Each new
// parameter is optional and trailing, so every change is additive.
// src/workflows/shared/steps.ts
export const fixCheck: (rules?: string) => Promise<void>
export const fixQuality: (rules?: string) => Promise<void>
export const describeEscalation: (rules?: string) => Promise<void>
export const fixRisks: (
  notes: readonly NoteInput[],
  access?: ScopeAccess,
  rules?: string,
) => Promise<void>
// src/workflows/feature/steps.ts
export const fixNits: (
  notes: readonly NoteInput[],
  access?: ScopeAccess,
  rules?: string,
) => Promise<void>
// src/workflows/shared/health.ts
export interface HealthOptions {
  /* … */ readonly rules?: string | undefined
} // reaches describe
export const escalation: (
  count: EscalationCount,
  guard?: Guard,
  guardRests?: boolean,
  rules?: string,
) => Promise<void>
// src/workflows/shared/tail.ts
export const fixQualityFindings: (
  escalations: EscalationCount,
  guard?: Guard,
  guardRests?: boolean,
  rules?: string,
) => Promise<boolean>
export const tail: <T>(
  fixFirst: boolean,
  finish: (e: EscalationCount) => Promise<T>,
  green?: boolean,
  guard?: Guard,
  lenses?: readonly string[],
  guardRests?: boolean,
  lensBase?: string,
  rules?: string,
) => Promise<T>
// src/workflows/feature/review.ts
export interface BuildTailOptions {
  /* … */
  /** Appended to every fix and describe prompt of the tail; `reviewedRefactor` passes `refactorRules(strays, pattern)`. */
  readonly rules?: string
}
```

```ts
// src/workflows/feature/seam.ts — package C (concern 5), public
export const implement: (
  reference: string | undefined,
  tier?: RiskTier,
  amend?: boolean,
) => Promise<void>
// src/workflows/shared/text.ts
export const implementBuildingPrompt: (
  reference: string | undefined,
  tier?: "low" | "high",
  amend?: boolean,
) => string
// amend: "the change already exists in the tree from an earlier lap; amend it
// to meet the re-derived .gtd/REQUIREMENTS.md". Drops "implement properly",
// "write the change fresh" and the new-flag line. Flag line: tier low → "Add no
// release flag"; otherwise → "keep the release flag the earlier lap added; add
// none". `featureFeedback` (and so `afterTail`) passes `amend = true`. The
// first lap renders exactly as today.
```

```ts
// src/workflows/shared/fences.ts — package D (concern 6), new, not re-exported from @pmelab/gtd/workflows
export const markFenced: (
  text: string,
) => readonly { line: string; fenced: boolean }[]
// Moved verbatim from feature/tier.ts. `demoteHeadings` in feature/refactor.ts
// uses it: a fenced line is never a heading.
```

## Call Stacks

- In-gate thread at the refactor review: `reviewedRefactor` → `buildTail` →
  `review` (feature) → `kit.review` → `converse` → `refactorCollecting` (open) →
  `buildReviewCollectingPrompt` → `requireReplies` → `awaitReview` again
- End of a refactor round: `kit.review` → `finish` → `routeNotes` → `p.triage`
  (line notes and one-shot footnotes) → `close` → `collect` →
  `refactorCollecting` (closed) → `refusals.dropped` →
  `t.refactorDroppedRefusal`
- Settled check: `finish` → `afterCollect` → `settledAfter` → `notedSince` →
  `notesOf` (strips thread footnotes only)
- Hand-edit round: `finish` → `collectWith(edits capture, { notes: [], paths })`
  → `collect` → `refusals.dropped`
- Refactor tail fix turns: `reviewedRefactor` → `buildTail(…, { rules })` →
  `tail(…, rules)` → `fixCheck(rules)` / `fixQualityFindings(…, rules)` →
  `fixQuality(rules)` / `healthy({ rules })` → `escalation` →
  `describeEscalation(rules)`; `review` → `fixRisks(…, rules)`,
  `fixNits(…, rules)`
- Feature feedback lap: `naivePlanAndBuild` / `afterTail` → `featureFeedback` →
  `implement(undefined, tier, true)` → `implementBuildingPrompt(…, true)`
- Package derive: `reviewedRefactor` → `refactorLap` → `demoteHeadings` →
  `markFenced` (shared/fences.ts); `readRiskTier` → `sectionLines` →
  `markFenced`

## E2E Scenarios

- e2e: src/workflows/feature/refactor-review.feature — a `- H:` thread question
  at the refactor gate gets one `- A:` reply from
  `refactor.build.review.collecting`, no `.gtd/REFACTOR.md`, and the process
  rests at `refactor.build.review.await-review` again (covers 1)
- e2e: src/workflows/feature/refactor-review.feature — after that reply, a
  landing that changes nothing signs off the refactor and the feature slice
  follows; the reply-only turn trips no `refactor-feedback` refusal (covers 1)
- e2e: src/workflows/feature/refactor-review.feature — a round carrying only a
  one-shot praise footnote, judged `praise`, signs off and the feature slice
  follows (covers 2)
- e2e: src/workflows/feature/refactor-review.feature — a one-shot footnote
  judged `edit` whose collecting turn writes no `.gtd/REFACTOR.md` refuses the
  landing with `refactor-feedback`, naming the footnote's anchor line (covers 2)
- e2e: src/workflows/feature/refactor-review.feature — a one-shot footnote
  landed after an in-gate thread reply is judged at
  `refactor.build.review.triage`, not signed off unjudged (covers 2)
- e2e: src/workflows/feature/refactor-review.feature — the existing hand-edit
  refusal scenario: a hand-edit round carrying a praise line note refuses naming
  the edited path only, never the note (covers 3)

## Unit Tests

### Requested (src/workflow-kit/review.ts)

- unit: src/workflow-kit/review.test.ts — `review` with a one-shot footnote
  added after an in-gate collecting turn routes it through `triage`, not the
  settled sign-off (covers 2)
- unit: src/workflow-kit/review.test.ts — `review` with only a thread reply
  after an in-gate collecting turn still settles (covers 2)
- unit: src/workflow-kit/review.test.ts — on a hand-edit round with notes,
  `refusals.dropped` receives `notes: []` and the edited paths (covers 3)
- unit: src/workflow-kit/review.test.ts — on a notes-only round,
  `refusals.dropped` receives only the notes judged `edit`, footnotes included
  (covers 2, 3)
- unit: src/workflow-kit/review.test.ts — `reviewToHandOff` with a footnote-only
  edit hands off instead of closing (covers 2)

### buildReviewCollectingPrompt

- unit: src/workflows/feature/refactor.test.ts — `reviewedRefactor`'s in-gate
  collecting prompt asks for exactly one `- A:` reply per waiting thread, says
  leave one-shot footnotes and notes untouched, and lacks "already closed"
  (covers 1, 2)
- unit: src/workflows/feature/refactor.test.ts — the end-of-round collecting
  prompt still says the review is closed and must not be recreated (covers 1)
- unit: src/workflows/feature/steps.test.ts — the feature `collecting` prompt
  renders unchanged (pinned fixture `feature-collecting-prompt.txt`) (covers 1)

### refactorCollecting

- unit: src/workflows/feature/steps.test.ts — renders the open variant when
  `.gtd/REVIEW.md` is present and the closed variant when it is absent
  (covers 1)

### refactorRules and the rules-taking prompts

- unit: src/workflows/shared/text.test.ts — each of `buildFixPrompt`,
  `buildFixQualityPrompt`, `buildReviewFixRisksPrompt`,
  `buildReviewFixNitsPrompt`, `healthDescribePrompt` renders unchanged without
  `rules`, and with `rules` lists the strays, the no-test-file rule and the
  no-new-flag-read rule; the risks prompt then drops its "add a test" line
  (covers 4)

### fixCheck, fixQuality, describeEscalation, fixRisks, fixNits, escalation, fixQualityFindings, tail, BuildTailOptions

- unit: src/workflows/feature/refactor.test.ts — `reviewedRefactor`'s prompts at
  `refactor.build.fix`, `refactor.build.fix.quality.fixing`,
  `refactor.build.review.fix.risks.fixing`,
  `refactor.build.review.fix.nits.fixing` and `refactor.build.health.describe`
  each name every stray, ban test files and ban new flag reads (covers 4)
- unit: src/workflows/feature/review.test.ts — `buildTail` without `rules`
  renders the feature tail's fix, quality-fix, risk-fix, nit-fix and describe
  prompts unchanged (covers 4)

### implement

- unit: src/workflows/feature/seam.test.ts —
  `implement(undefined, undefined, true)` says the change exists and must be
  amended, keeps the earlier release flag and asks for no new one, and lacks
  "implement them properly" and "write the change fresh" (covers 5)
- unit: src/workflows/feature/seam.test.ts — `implement(…, "low", true)` says
  "Add no release flag" (covers 5)
- unit: src/workflows/feature/seam.test.ts — first-lap `implement(reference)`
  renders unchanged, reference line included (covers 5)
- unit: src/workflows/feature/feature.test.ts — on the naive pass, the feedback
  lap's `implement.building` prompt is the amend variant, and so is the one
  `afterTail` drives (covers 5)

### markFenced

- unit: src/workflows/feature/refactor.test.ts — through `reviewedRefactor`'s
  re-derived package: a collected heading after a longer closing fence (` `
  `opened,` ``` ```` inside) stays fenced and undemoted (covers 6)
- unit: src/workflows/feature/refactor.test.ts — a 4-space-indented ` ``` ` line
  is not a fence: the heading after it is demoted (covers 6)
- unit: src/workflows/feature/tier.test.ts — existing `readRiskTier` and
  `productionSignals` cases stay green on the moved tracker (covers 6)

### In-flight naive-pass processes

- unit: src/workflows/feature/feature.test.ts — forge a 28.0.0 naive-pass trail
  as commits carrying its `Gtd-Step:` trailers (step sequence read off `main`'s
  naive-pass scenarios), one per rest: `design.*`, `seam.naive`, `seam.judge`,
  `seam.approve`, `refactor.*`, `implement.*`, `build.*` on each verdict, and
  after a feature feedback lap. Pin for each whether `feature` replays to the
  same rest or fails replay. The failing set is what the docs list (covers 8)

### Chores

- chore: docs/configuration.md — the naive-pass path's refusal paragraph says
  the hand-edit refusal names edited paths and the `edit` notes, footnotes
  included, never praise or questions (covers 3)
- chore: docs/configuration.md — in-gate threads at the refactor review get a
  reply; footnotes are judged like line notes (covers 1, 2)
- chore: docs/configuration.md — `### refactorFirst`: replace "runs
  `refactorFirst` only on the naive-pass path" with `reviewedRefactor`. Say the
  review tail's fix-check, quality-fix, risk-fix, nit-fix and describe turns are
  guarded and prompted with the same rules. Name no `src/*.ts` module (covers 7)
- chore: docs/configuration.md — `**Upgrading:**` names both migrations: the
  `seam.approve` removal, and `seamBuild(tier)` → `seamBuild(base)` returning
  `{ reference, base }` and no longer running `implement` (a custom workflow
  calls `implement` itself). Add the exact set of in-flight rests that must
  `gtd abandon`, taken from the replay test (covers 8)
- chore: README.md — mention the abandon set in the naive-pass paragraph, only
  if the replay test shows rests beyond `seam.approve` that must abandon
  (covers 8)
- chore: PR #390 body (`gh pr edit 390`) — a `BREAKING CHANGE:` footer carrying
  both migrations, per docs/commits.md, so the squash message carries `!` plus
  the literal footer (covers 8)

## Merged Concerns

### A: refactor review round (concerns 1, 2, 3)

All three center on `src/workflow-kit/review.ts`, the refactor collecting prompt
and `refactor-review.feature`. Concern 2's in-gate hole is closed by the prompt
concern 1 rewrites.

> ### 1. Refactor collecting turn may reply in `.gtd/REVIEW.md` threads — TECHNICAL
>
> **The refactor collecting prompt forbids replying in `.gtd/REVIEW.md`, but the
> review kit's in-gate conversation calls that same turn while the file is open
> and then requires an `- A:` reply.** Any `- H:` thread at the refactor review
> gate therefore refuses the turn.
>
> - Allow exactly one `- A:` reply per waiting thread, as the feature variant
>   does; drop the "already closed, do not reply" line
> - Keep the end-of-round case working: there the file is closed before
>   collecting, and a reply must not recreate it
> - A reply-only turn must not trip the `refactor-feedback` "unmatched" refusal
> - Cover with a `@inmem` scenario in
>   `src/workflows/feature/refactor-review.feature`: a thread question at the
>   refactor gate gets an answer and rests at the gate again

> ### 2. Footnotes are judged like line notes; an `edit` footnote left undone refuses — PRODUCT
>
> **Today a refactor-review round carrying only footnotes reaches the kit's
> no-line-notes path with nothing marked as requested, so a collecting turn that
> writes nothing silently signs off.** Footnotes must go through the same triage
> judge as line notes.
>
> - Send each footnote of the round to the triage judge, one question per
>   footnote; the judge learns footnote anchors (the anchored hunk or paragraph)
> - **Praise and question footnotes sign off, exactly as line notes do** — a
>   footnote-only round of praise never dead-ends
> - A footnote judged `edit` joins the requested items of the `dropped` check; a
>   collecting turn that writes no `.gtd/REFACTOR.md` for it refuses
> - The `refactor-feedback` refusal names each dropped footnote by its anchor
> - The feature review is untouched: it has no `dropped` refusal
> - Cover with `@inmem` scenarios in
>   `src/workflows/feature/refactor-review.feature`: a praise-only footnote
>   round signs off; an `edit` footnote with no `.gtd/REFACTOR.md` refuses
>   naming its anchor

> ### 3. The `dropped` refusal lists edit notes only — TECHNICAL
>
> **On a hand-edit round the refusal lists every review note of the round,
> praise and questions included.** It must name only what asked for a change.
>
> - `editNotes` path already passes edit notes only; the hand-edit path passes
>   all notes untriaged
> - **The hand-edit path runs no triage, so it has no verdicts to filter by** —
>   the next phase picks between triaging there or listing hand-edited paths
>   (plus footnotes judged `edit`, per concern 2) only
> - Update `docs/configuration.md`'s "naming every left-out note" to match

### E: docs and migration (concerns 7, 8)

Both are edits to `docs/configuration.md`'s `### refactorFirst` and naive-pass
sections.

> ### 7. Fix the stale `refactorFirst` doc — TECHNICAL
>
> **`docs/configuration.md` still says "the shipped `feature` flow runs
> `refactorFirst` only on the naive-pass path"; it now runs
> `reviewedRefactor`.**
>
> - Correct that sentence and any other line in `### refactorFirst` that
>   predates the review tail (e.g. the list of guarded turns now also includes
>   the review tail's fix turns)
> - No `src/*.ts` module name enters prose (AGENTS.md rule); exported API names
>   are fine

> ### 8. Docs and breaking footer: `seamBuild` change, in-flight naive processes — TECHNICAL
>
> **The `BREAKING CHANGE:` footer and docs mention only `seam.approve`; they
> miss the `seamBuild` API change and what happens to other in-flight naive-pass
> processes.**
>
> - `seamBuild` is a public export: `seamBuild(tier)` became `seamBuild(base)`,
>   returns `{ reference, base }`, and no longer runs `implement` — a custom
>   workflow calling it must call `implement` itself
> - Determine by test which rests of an in-flight `GTD_FLAG_NAIVE_PASS` process
>   still replay (step order and slices changed); document the exact set that
>   must `gtd abandon`
> - Update `docs/configuration.md`'s **Upgrading** line, README if it covers the
>   path, and the PR body
> - The squash message's footer must carry both migrations (`docs/commits.md`:
>   `!` plus a literal `BREAKING CHANGE:` footer)

## Answered Questions

### Do the two deferred review notes removed from `.gtd/TODO.md` become concerns?

No. The human deleted both (note-3 garbled-flag stdout, note-2
`gtd history list` scenario); a removal is the answer.

### On a feature feedback lap, does the amended change keep the first lap's release flag?

Yes. One feature, one flag; a second flag for the same behaviour is never what a
reviewer's note asks for.

### Do in-flight naive-pass processes get migration code, or a documented `gtd abandon`?

Documented `gtd abandon`, matching `seam.approve`. The flag is off by default,
and COMPATIBILITY.md already treats a step-order change as breaking.

### Does a footnote that only praises still dead-end a refactor-review round?

No. Footnotes go through the triage judge like line notes. Praise and question
footnotes sign off; only a footnote judged `edit` that the collecting turn
leaves undone refuses the round.

### Does the hand-edit path triage its notes, or does its refusal list paths only?

Paths only, with `notes: []`. A hand-edit alone already forces
`.gtd/REFACTOR.md`, so the refusal fires either way. A judge call there would
add a rest whose verdicts change nothing, and the collecting capture still
carries every note.

### Does the kit's footnote fix reach the feature review and the fix hand-off too?

Yes, kit-wide. The await message already promises "a footnote works the same way
here as a line note". A per-workflow switch would keep a known silent-sign-off
bug alive in the feature review. The feature review still gets no `dropped`
refusal.

### Does the in-gate refactor turn fold one-shot footnotes, as the shared fold-in rule says?

No. It replies to waiting threads and leaves one-shot footnotes for the round's
triage. Folding there would skip the judge and could delete a footnote without
writing `.gtd/REFACTOR.md`.

### Does a concluded thread at the refactor gate always write `.gtd/REFACTOR.md`?

Only when it asks for a change; otherwise the turn just deletes it. Folding a
"thanks, fine" conclusion would force a needless refactor lap.

### How do the refactor rules reach the tail's fix turns?

An optional trailing `rules` string, threaded from `BuildTailOptions` through
`tail`, `healthy` and `escalation` into each step. Every public signature gains
only an optional trailing parameter, so the change is additive. The feature tail
passes none and renders unchanged.

### Does the refactor lap's own escalation describe turn get the rules too?

No. Concern 4 scopes to the review tail; the lap's fix turn already uses
`refactorFixPrompt`, which carries them.

### Where does `markFenced` live?

In a new `src/workflows/shared/fences.ts`, not re-exported from
`@pmelab/gtd/workflows`. Both `feature/` modules already import from `shared/`,
so the boundary rules need no change.

### How is the in-flight replay set determined?

With a unit test that forges the 28.0.0 naive-pass trail as `Gtd-Step:` commits
per rest and drives the current `feature`. The test pins the result, and the
docs list exactly the rests that fail.
