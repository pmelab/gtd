# 04 — The review screen, the plan-and-answer screen, and dictation

Three requirements land together because all three co-own the same components: a
card list that drills into a one-item-per-screen deck, and one note sheet. The
paragraph seam is a third anchor mode **inside** that sheet, not a consumer of
it, and the mic is a leaf both the sheet and the free-text option render.
Splitting them makes one package own the shell and another rewrite it.

The load-bearing fact, stated up front because it is counter-intuitive: **ticks
are read-progress and nothing else.** A tick-clearing command runs as an edge
ahead of the human review gate's commit, so no ticked box can reach the deciding
state. The round stays open **iff the human left any byte-diff in the review
steering file — a note or a footnote — or edited any path outside the workflow's
own state directory**; the deciding state compares that file at `HEAD^` against
`HEAD` in shell.

## Requirement — concern 3

### 3. The review screen — PRODUCT

A chunk list whose cards carry the chunk's prose, a check-all tick and a
chunk-level note, each drilling into a deck of that chunk's hunks — one hunk per
screen, syntax-highlighted diff of `base..HEAD` sliced to the pointed-at hunk,
controls in flow below the diff rather than floating over it. Approving the last
hunk returns to the chunk list.

**Acceptance**: `##` headings carry no checkbox in the review format, so a chunk
tick ticks all of that chunk's hunks — the only honest meaning available. A
chunk carrying a footnote keeps the round open even when every hunk in it is
ticked. See [#214](https://github.com/pmelab/gtd/issues/214).

## Requirement — concern 4

### 4. The plan-and-answer screen and prose steering files — PRODUCT

The same two-level shape for `qa` documents: a question list with a "Read the
plan" row and an **Already answered** section below the open ones, drilling into
one question per screen. Prose-only steering files get the same treatment minus
the questions.

Answering is **radio**: a question is answered iff exactly one option is ticked,
and a ticked free-text option with empty text is unanswered. Prose comments
anchor **per paragraph, one note each**, via a full-width thin seam below the
paragraph — selection-based anchoring was built and rejected on a phone. The
"read the plan" confirmation is client-side state keyed on the file's content
hash, so any rewrite clears it; the format gains nothing for it.

**Acceptance**: a `##` section may not precede `## Open Questions`, and none may
follow `## Answered Questions`. See
[#222](https://github.com/pmelab/gtd/issues/222) and
[#223](https://github.com/pmelab/gtd/issues/223).

## Requirement — concern 9

### 9. Dictation — PRODUCT

A mic button using the Web Speech API on the free-text answer option and in the
note sheet, and nowhere else; the iOS keyboard's own dictation covers every
textarea for free. No server-side transcription. Dictated text writes through on
attach, never on interim results.

**Acceptance**: feature-detect and catch `not-allowed` — hide the mic, keep the
textarea, show a one-line hint naming the keyboard's mic key. The capability
research is [#216](https://github.com/pmelab/gtd/issues/216). See
[#220](https://github.com/pmelab/gtd/issues/220).

## Tasks

### T1 — the shared two-level shell

A card list whose rows drill into a deck showing one item per screen. Controls
sit **in flow below** the content rather than floating over it. Advancing past
the last item in a deck returns to the list.

Paths: `src/web/Deck.tsx`, `src/web/Deck.stories.tsx`, `src/web/Card.tsx`,
`src/web/Card.stories.tsx`.

- [ ] a list row opens that row's deck
- [ ] the deck shows exactly one item per screen
- [ ] advancing past the last item returns to the list
- [ ] back from the first deck item returns to the list without losing scroll
      position
- [ ] controls render below the content and never overlay it
- [ ] a deck of one item renders without broken navigation
- [ ] the shell renders correctly at 390 px wide

### T2 — the view models

The server turns a steering file plus its mode into what the screen draws by
calling the format registry's view member, **never a format module directly** —
so a custom mode's screens come for free.

Paths: `src/serve/View.ts`, `src/serve/View.test.ts`, `src/serve/Router.ts`.

- [ ] the review view yields chunks, each with its prose and its hunks
- [ ] the question view yields open questions and answered questions separately
- [ ] a prose-only steering file yields paragraphs and no questions
- [ ] the module imports no format module and switches on no mode name
- [ ] an unknown mode yields a typed refusal, not an empty screen

### T3 — the diff parser and hunk selection

A hunk row points with a `./`-relative path plus an optional single line number
— **there is no line range, no hunk header and no hunk index** — and the number
is 1-based against the post-image. A bare path with no number means line 0. gtd
contains **no unified-diff parser at all**; its only diff call reads name and
status. So this is new: run a diff of the review base against the working tree
for that one path, parse the hunk headers, and select the hunk whose post-image
range contains the pointed-at line. The base comes from `gtd base`, which prints
the review anchor and refuses at exit 1 when no process is underway.

When **no hunk contains the line** — a stale pointer, a moved line, or a bare
path — the screen shows that path's whole diff behind a banner saying the
pointer did not resolve, rather than an empty deck.

Paths: `src/serve/Diff.ts`, `src/serve/Diff.test.ts`.

- [ ] a pointer whose line falls inside a hunk selects exactly that hunk
- [ ] a pointer whose line falls between two hunks selects neither and triggers
      the whole-file fallback with its banner
- [ ] a pointer with no line number triggers the whole-file fallback
- [ ] a pointer at the first line of a hunk selects that hunk, not the previous
      one
- [ ] a pointer at the last line of a hunk selects that hunk, not the next one
- [ ] a path with a `#` inside it is not mistaken for a line separator
- [ ] a file added in the range renders as an all-additions diff
- [ ] a file deleted in the range renders without crashing
- [ ] a binary file renders a stated placeholder, not garbage
- [ ] `gtd base` refusing at exit 1 surfaces as a named refusal, not an empty
      screen

### T4 — the review screens

A chunk list whose cards carry the chunk's prose, a check-all tick and a
chunk-level note, each drilling into a deck of that chunk's hunks — one hunk per
screen, with the diff sliced to the pointed-at hunk.

A chunk tick ticks **all** of that chunk's hunks. That is the only honest
meaning available: `##` headings carry no checkbox in the format, and
read-progress is all a tick ever conveyed.

Paths: `src/web/screens/Review.tsx`, `src/web/screens/Review.stories.tsx`,
`src/web/screens/Hunk.tsx`, `src/web/screens/Hunk.stories.tsx`.

- [ ] a chunk card shows its prose, a check-all tick and its note affordance
- [ ] ticking a chunk ticks every hunk in it, including hunks nested at any
      depth
- [ ] un-ticking a chunk un-ticks every hunk in it
- [ ] approving the last hunk in a chunk returns to the chunk list
- [ ] a chunk carrying a footnote keeps the round open even when every hunk in
      it is ticked
- [ ] progress through the deck is visible without leaving the hunk screen
- [ ] stories cover a nested hunk, a chunk with a footnote, and an unresolved
      pointer

### T5 — the plan-and-answer screens

The same two-level shape for question documents: a question list with a "Read
the plan" row and an **Already answered** section below the open ones, drilling
into one question per screen. Prose-only steering files get the same treatment
minus the questions.

Answering is **radio**: a question is answered iff exactly one option is ticked,
and a ticked free-text option with empty text is unanswered. That predicate
already exists and is the single one enforced at landing and by the
open-questions check — the client renders radio semantics and the server never
re-derives the rule. The free-text option is the **last** option positionally,
not by label, and its text normalizes to empty when it equals the placeholder,
compared case-insensitively.

The "read the plan" confirmation is client-side state keyed on the file's
content hash, so **any rewrite clears it**; the format gains nothing for it.

Section order is a validator rule, not a UI convention: no `##` section may
precede the open-questions heading and none may follow the answered-questions
heading. The Already-answered list is therefore a read of the second section,
and moving a question between them must respect that order.

Paths: `src/web/screens/Plan.tsx`, `src/web/screens/Plan.stories.tsx`,
`src/web/screens/Question.tsx`, `src/web/screens/Question.stories.tsx`.

- [ ] ticking a second option un-ticks the first
- [ ] a ticked free-text option with empty text renders as unanswered
- [ ] a ticked free-text option with text renders as answered
- [ ] the free-text slot is identified by position, not by matching its label
      text
- [ ] a placeholder differing only in letter case still normalizes to empty
- [ ] the Already-answered section renders below the open questions
- [ ] the read-the-plan confirmation clears when the file's content hash changes
- [ ] a prose-only steering file renders paragraphs with note seams and no
      question list
- [ ] a document with no open questions renders without an empty section heading

### T6 — the note sheet and its three anchor modes

One sheet, three anchors: a chunk, a hunk, and a paragraph. Prose comments
anchor **per paragraph, one note each**, via a full-width thin seam below the
paragraph — selection-based anchoring was built and rejected on a phone.

Paths: `src/web/NoteSheet.tsx`, `src/web/NoteSheet.stories.tsx`.

- [ ] the sheet opens from a chunk, from a hunk, and from a paragraph seam
- [ ] a paragraph already carrying a note offers editing it, not a second note
- [ ] the seam spans the full width and sits below its paragraph
- [ ] no selection gesture is required to place a note
- [ ] dismissing the sheet without saving discards the text
- [ ] the sheet is usable one-handed at 390 px wide with the keyboard open

### T7 — dictation

A mic button on the free-text answer option and inside the note sheet, **and
nowhere else** — the phone keyboard's own dictation covers every other textarea
for free. No server-side transcription. Dictated text writes through on attach,
**never on interim results**.

This is the requirement HTTPS is mandatory for: the speech API is
secure-context-only and fails silently over plain http.

Paths: `src/web/Mic.tsx`, `src/web/Mic.stories.tsx`.

- [ ] the mic appears on the free-text option and in the note sheet, and on no
      other textarea
- [ ] a browser with no speech API hides the mic, keeps the textarea, and shows
      a one-line hint naming the keyboard's mic key
- [ ] a denied permission is caught and takes the same fallback path
- [ ] interim results are displayed but never written through
- [ ] the write-through happens on attach
- [ ] no audio ever leaves the browser

### T8 — the diff highlighter

The prototype's own ten-line single-pass tokenizer, ported verbatim. No grammar
bundle: one would dwarf the entire client, and the diff lines being read on a
phone are short.

Paths: `src/web/Highlight.ts`, `src/web/Highlight.test.ts`.

- [ ] a matched token is never re-scanned, so a class name inside an emitted
      span cannot be mistaken for a string
- [ ] added, removed and context lines are visually distinguishable
- [ ] a hunk header renders unhighlighted
- [ ] markup characters in source are escaped
- [ ] no language grammar package is added
