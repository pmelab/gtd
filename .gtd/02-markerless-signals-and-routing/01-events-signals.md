# Compute markerless review signals at the edge (`src/Events.ts`)

Replace the bang signal and the inline forward-tick machinery with two new
boolean signals computed over the working tree, using the pure `formatString`
from package 01.

## Context

`gatherEvents` in `src/Events.ts` currently computes `bangPresent` (via
`git.hasBangAdded`) and `reviewApprovedNoChanges` (via the `onlyReviewDirty`
forward-tick loop). Both go away; two new signals replace them.

## What to do

1. **Remove the bang machinery** in `gatherEvents`:
   - Delete the `let bangPresent = false` declaration and the harvest comment
     block above it (~lines 248–252).
   - Delete the `bangPresent = Option.isSome(reviewCommit) ? yield*
     git.hasBangAdded(reviewCommit.value) : false` assignment (~line 263–264).
     NOTE: the `const reviewCommit = yield* git.lastReviewCommit()` line above it
     was only used for bang detection — remove it too if nothing else uses it.
   - Remove `bangPresent` from the `payload` object literal (~line 336).

2. **Remove the `reviewApprovedNoChanges` machinery**:
   - Delete `let reviewApprovedNoChanges = false` and the entire
     `if (onlyReviewDirty) { … committedLines/workingLines … UNTICKED/TICKED/
     stripMarker … atLeastOneTick/allDiffsAreForwardTicks … }` block
     (~lines 275–307).
   - Remove `reviewApprovedNoChanges` from the `payload` object literal.

3. **Add `reviewHasUncheckedBoxes`** computed over the working-tree REVIEW.md
   (`reviewContent`, already read ~line 259–261): `true` iff `reviewContent`
   contains at least one line matching `^- \[ \] ` (multiline regex, e.g.
   `/^- \[ \] /m.test(reviewContent)`). Computed over working-tree content, not
   the committed copy. If the human stripped all checkboxes, this is `false` and
   we fall through to the feedback decision.

4. **Add `reviewHasRealFeedback`** via normalize-and-compare:
   - `otherDirtyPathsExist = !entries.every((e) => e.path === REVIEW_FILE)` (the
     existing `onlyReviewDirty` negated). Untracked files surface in
     `git status --porcelain` as `??` so they are already included in `entries`.
   - If only REVIEW.md is dirty, take the committed copy via
     `git.showHead(REVIEW_FILE)` (wrap with the existing
     `Effect.mapError((e) => new Error(String(e)))`), string-replace every
     `- [ ]` → `- [x]` in it, run BOTH the normalized-committed and the
     working-tree `reviewContent` through `formatString` (imported from
     `./Format.js`), and compare the two formatted strings.
   - `reviewHasRealFeedback = otherDirtyPathsExist ||
     (formattedNormalizedCommitted !== formattedWorking)`.
   - When `otherDirtyPathsExist` is true you may short-circuit and skip the
     formatString comparison entirely.
   - Run this inside the existing `Effect.gen`; surface `formatString` errors via
     the same `Effect.mapError((e) => new Error(String(e)))` convention.
   - Compute these two only when `reviewExists` (inside the existing
     `if (reviewExists) { … }` block); default both to `false` otherwise.

5. Add both keys to the `payload` object literal:
   `reviewHasUncheckedBoxes` and `reviewHasRealFeedback`.

## KEEP unchanged

- `reviewModified` / `reviewUnmodified` detection.
- The `<!-- base: … -->` parse into `reviewBaseRef` and the corrupted-REVIEW.md
  `Effect.fail` (still needed; threaded as `context.baseRef`).
- `computeReviewBase`, `reviewPresent`, `codeEntries`/`codeDirty`, all TODO/
  packages/errors logic, and the `reviewPresent` suppression of code-changes.

## Tests (same task — `src/Events.test.ts`)

`src/Events.test.ts` currently only covers `getPackages` + the `isTestFix`
trailer regex. Add a `describe` block pinning the new classifier logic against a
real temp git repo (mirror the temp-repo setup used in `src/Git.test.ts` — init
a repo, commit a REVIEW.md, modify the working tree). Cover:

- [ ] `reviewHasUncheckedBoxes`: working-tree REVIEW.md with a `- [ ]` line ⇒
      true; all boxes `- [x]` ⇒ false; no boxes at all ⇒ false.
- [ ] `reviewHasRealFeedback`: only-forward-ticks (committed `- [ ]`, working
      `- [x]`, otherwise identical) ⇒ false (normalize-and-compare equal); a
      non-tick REVIEW.md prose edit ⇒ true; a dirty source file alongside ⇒ true;
      an untracked file alongside ⇒ true.

If asserting through `gatherEvents` is impractical for unit scope, extract the
two pure-ish helpers (e.g. an exported `reviewHasUncheckedBoxes(content)` and a
`reviewHasRealFeedback({ entries, committed, working })`-style function) and test
those directly — keep the extraction minimal and in `Events.ts`.

## Acceptance criteria

- [ ] `bangPresent` and `reviewApprovedNoChanges` no longer computed or present
      in the payload built by `gatherEvents`.
- [ ] `git.hasBangAdded` is no longer called anywhere in `Events.ts`.
- [ ] `reviewHasUncheckedBoxes` and `reviewHasRealFeedback` computed and added to
      the payload, using `formatString` from `./Format.js` for normalization.
- [ ] `src/Events.test.ts` pins both new signals.
- [ ] `npm run test` green.

## Files

- `src/Events.ts`
- `src/Events.test.ts`

## Constraints / edge cases

- DEPENDS ON package 01 (`formatString`) and package 02 task 02 (`Machine.ts`
  `ResolvePayload` field swap). Those land in the same/earlier package; the
  package is only graded green after all its tasks complete, so `Events.ts` and
  `Machine.ts` updating the payload shape together is expected.
- This task touches ONLY `src/Events.ts` and `src/Events.test.ts` — it must NOT
  edit `Machine.ts` (that is task 02) to keep tasks file-disjoint.
- `git.hasBangAdded` itself stays defined in `Git.ts` until package 03 (dead but
  harmless); do NOT remove it here.
