# Spec review — 04 steering screens and dictation

The suite is green (10/10 turbo tasks, 72 storybook tests) and most acceptance
criteria hold with real assertions. The problems below are either behaviour that
contradicts a criterion, or a criterion whose "test" does not fail when the
behaviour is broken (each of those was proven by mutating the source and
re-running the suite).

## Behaviour that contradicts the spec

### 1. "Edit note" can never save — the write is always refused, silently

T6: _"a paragraph already carrying a note offers editing it, not a second
note."_ The label flips to "Edit note" and the sheet prefills
(`src/web/screens/Plan.tsx:157`, `src/web/screens/Review.tsx:319`,
`src/web/screens/Hunk.tsx:160`, `src/web/NoteSheet.tsx:36`), but saving goes
through the same attach-only path: `footnoteAttachEdits`
(`src/Footnotes.ts:355-358`) derives the id from the anchor key and returns
`{ok:false, reason:"id-collision"}` when a definition for that anchor already
exists, which `src/serve/Write.ts:144` maps to `note-collision`. There is no
update/replace path anywhere. The client then reverts the optimistic note
(`src/web/screens/Review.tsx:122-128`) and the human's typed text is lost with
no message. The screens offer an operation the server refuses by construction.

Also: no story saves an edit of an existing note — `Plan.stories.tsx:189-203`
and `NoteSheet.stories.tsx:44-56` open and prefill, then stop.

### 2. A `#0` pointer selects a hunk instead of falling back

T3: _"a pointer with no line number triggers the whole-file fallback"_, and a
bare path means line 0. `selectHunk` (`src/serve/Diff.ts:76`) treats `0` as a
real line, and `hunkContainsLine` (`Diff.ts:69`) makes a pure-deletion hunk
(`@@ ... +0,0 @@`) match line 0 — deliberately asserted at
`src/serve/Diff.test.ts:204`. `./a.ts#0` validates clean and yields `line: 0`
(`src/ReviewDoc.ts`'s `POINTER_LINE_RE`), and `diffInput`
(`src/serve/Router.ts:199`) accepts it, so that pointer returns `kind:"hunk"`
where the spec mandates the whole-file fallback with its banner. ReviewDoc's
other two pointer readers (`ReviewDoc.ts:713`, `:753`) DO map bare → 0, so
wiring those into `diff` walks straight into it. Either reject `#0` in
`reviewValidate` or normalize `line === 0` to the `no-line` fallback in
`resolveDiff`.

### 3. The diff range makes stale pointers select the WRONG hunk silently

`src/serve/Diff.ts:110` runs `git diff ${base} -- ${path}` — base vs **working
tree**. T3's task text says working tree; requirement 3 says `base..HEAD`. These
differ whenever the tree is dirty, and the consequence is not cosmetic: the
review doc's pointers are 1-based against the post-image **as committed at
HEAD**, so any uncommitted edit — a stray save, `oxfmt --write` during the round
— shifts post-image line numbers and makes a pointer select a different hunk
while still returning `kind:"hunk"`, with no banner. Pick one: pin the command
to `git diff ${base} HEAD --`, or amend requirement 3's text and state why drift
is acceptable. Leaving both as written is a trap.

### 4. The "Read the plan" row has no plan behind it

Requirement 4 / T5: _"a question list with a 'Read the plan' row"_. For a `qa`
document, `questionsView` (`src/OpenQuestions.ts:958-978`) emits question nodes
only — the plan's prose paragraphs are dropped — and `PlanBody`
(`src/web/screens/Plan.tsx:238-243`) renders prose XOR questions. So the row at
`Plan.tsx:340` is a tick-only affordance with nothing to read. The
content-hash-keyed confirmation is then a confirmation of nothing.

### 5. `\ No newline at end of file` is mangled and mis-painted

`src/serve/Diff.ts:58-64` deliberately keeps `\`-prefixed marker lines in
`hunk.lines`. `lineKind` (`src/web/Highlight.ts:59-63`) has no `\` case, so the
marker falls through to `"context"` and `Highlight.ts:77` does `line.slice(1)`,
eating the backslash. It renders as a context source line reading
` No newline at end of file`. T8: _"added, removed and context lines are
visually distinguishable"_ — this line is none of the three and is painted as
one, with its first character gone.

### 6. An answer is discarded by deck navigation

`src/web/screens/Plan.tsx:332` renders `<Question key={index} …/>` per deck
index and nothing lifts `selected`/`freeText` above it, so paging next-then-back
loses the answer. No T5 checkbox names this, but the screen's stated shape is
"drilling into one question per screen" and it does not survive the drill.

### 7. `Question.tsx`'s multi-tick guard does not exist

`src/web/screens/Question.tsx:142-145` seeds `selected` with
`options.findIndex(o => o.checked === true)` — the FIRST ticked option — and the
map at `:166-171` emits `checked: selected === index`, so exactly one option is
ever fed to `isAnswered`. A document with two `- [x]` options renders "answered"
while the server's `question.answered` and the landing gate say false. The doc
comment at `:156-165` claims the opposite protection. Either seed `selected` as
`undefined` when more than one option is checked, or delete the comment's claim.
No story covers a two-ticked node.

### 8. Ticks never reach the file

`src/web/screens/Review.tsx:94`, `:131-145` carry
`TODO(no tick-toggle procedure): local-only`. Ticking a chunk or hunk writes no
`[x]` to `.gtd/REVIEW.md`; a reload or refetch loses all of it. The T4 tick
criteria are satisfied as UI state and are well covered, but this package's own
framing is "ticks are read-progress" and there is a tick-clearing edge ahead of
the review gate that assumes ticks land in the file. Progress that dies on
refresh is not progress. If this is deliberately deferred to a later package,
say so in the package file rather than in a TODO.

## Criteria whose tests do not fail when the behaviour breaks

Each verified by mutation — the change was made, the full suite still passed.

- **T6 "the seam spans the full width and sits below its paragraph."**
  `Plan.stories.tsx:152-165` asserts only label text and `height >= 44`.
  Changing `width: "100%"` → `"40%"` (`Plan.tsx:142`): 72/72 pass. Moving the
  seam button ABOVE the `<p>` (`Plan.tsx:118-158`): 72/72 pass.
- **T6 "the sheet opens from … a hunk."** Replacing
  `onOpenNote: () => state.openNoteSheet(hunk)` (`Review.tsx:219`) with a no-op:
  72/72 pass. `Hunk.stories.tsx:143-151` passes its own fake `onOpenNote` and
  never mounts `NoteSheet`; `Review.stories.tsx:200` covers only the chunk
  affordance.
- **T6 "no selection gesture is required to place a note."**
  `NoteSheet.stories.tsx:58-61` is a prose comment saying there is nothing to
  assert. A source-grep test (no `getSelection`/`Range` under `src/web`) would
  be the honest gate.
- **T7 "hides the mic, KEEPS THE TEXTAREA, and shows a one-line hint."** The
  keeps-the-textarea half is asserted nowhere. `Mic.stories.tsx`'s `MicDemo`
  (`:76`) renders no textarea at all, so `NoSpeechApiShowsHint` (`:115`) and
  `DeniedPermissionFallsBackToTheHint` (`:130`) cannot prove it;
  `Question.stories.tsx:140` asserts only `mic-toggle` absent / `mic-hint`
  present, never that `free-text-input` survives.
- **T7 the note sheet's fallback branches are wholly uncovered.** Note-sheet
  testids `NoteSheet.tsx:106` (`note-sheet-mic-hint`) and `:112`
  (`note-sheet-mic-interim`) appear in no assertion. The sheet is one of the two
  mandated mount points and only its happy path (`NoteSheet.stories.tsx:195`) is
  tested.
- **T7 "the mic appears … on no other textarea"** and **"no audio ever leaves
  the browser"** rest on grep alone. The second is assertable: spy on
  `fetch`/`XMLHttpRequest`/`sendBeacon` across a dictation session and assert
  zero calls.
- **T2 "an unknown mode yields a typed refusal, not an empty screen."** The
  refusal is correct server-side (`View.ts:33` → `Router.ts:281-291` →
  `data.viewRefusal` at `Router.ts:87`), but `viewRefusal` appears exactly once
  in the whole repo — that definition. `Router.test.ts:169` uses `createCaller`,
  for which tRPC's `errorFormatter` never runs, so nothing proves it reaches the
  client as anything but a generic `TRPCClientError`. Compare `writeRefusal`,
  which has `writeRefusalFrom` (`src/web/api.ts:33`) plus tests. `readRefusal`
  has the same gap.

## Lower severity

- `parseUnifiedDiff` (`Diff.ts:45-67`) only skips preamble while
  `current === undefined`, so in multi-file output a second file's `--- a/x` /
  `+++ b/x` are appended into the previous hunk's `lines` as fake content.
  Reachable when the path matches more than one file (a stale pointer at
  `./src`). The same case defeats the binary check at `Diff.ts:122`, which
  requires `hunks.length === 0`.
- `Diff.ts:132` returns `whole-file` with `hunks: []` for a path with no diff at
  all — a banner over nothing. Untested.
- Refusals are swallowed in the UI: `src/web/drafts.ts`
  (`saveDraft`/`loadDraft`/`bannerFor`) and `writeRefusalFrom`
  (`src/web/api.ts:33`) are imported by no screen. `Review.tsx:122` and Plan's
  equivalent `.catch()` with no banner and no draft persistence;
  `Review.stories.tsx:398-433` asserts that nothing is shown to the user.
- `Plan.tsx:22-37` persists the read-the-plan confirmation in `localStorage`
  keyed by hash and never prunes, so reverting a file to previously-confirmed
  bytes restores the ✓ without a re-read ("any rewrite clears it"). It also
  touches `localStorage` directly, bypassing the injected `DraftStorage` seam
  (`src/web/drafts.ts:14-33`) that exists so component storage is testable.
- `OpenQuestions.ts:382` and `:390`: `i !== openIndex && i < openIndex` — the
  first clause is always true given the second. Dead condition, guaranteed
  surviving mutant.
- `OpenQuestions.ts:278` compares
  `rawText.toLowerCase() === FREE_TEXT_PLACEHOLDER` (assuming the constant is
  lowercase) while `Question.tsx:9` lowercases both sides. No test pins the
  constant's case.
- `Review.tsx`'s `ChunkRow` re-implements a row instead of using the shared
  `Card` (`src/web/Card.tsx:12`); only `Plan.tsx` uses it. T1's shell is
  half-adopted by the screen it was built for.
- `src/web/index.html`'s `interactive-widget=resizes-content` is declared
  load-bearing by `NoteSheet.tsx:72-78`; deleting it fails no test.
- No story renders open questions without any answered ones, so the "Already
  answered" heading's own suppression direction is untested.
- `tests/integration/features/review-tick-reset.feature:56-88` covers "all
  ticked + edit → round stays open" with an inline prose edit, not an actual
  `[^fn]` footnote marker. Byte-equivalent, but the footnote form named by the
  acceptance bullet is not pinned e2e.
