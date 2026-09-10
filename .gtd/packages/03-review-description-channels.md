# 03 — Description channels in the review view

## Requirement

This package carries TWO requirements. Both center on `src/ReviewDoc.ts`'s view
emission and both land their unit tests in the same file, so they build and
review as one package — but each stands on its own below.

Both establish the same rule at the parse, not at the render: `detail` carries
the author's prose, `note` carries an attached footnote, and no renderer filters
either.

### Requirement A — Render nothing for a chunk with no description

A chunk summary sometimes displays a hunk's raw `- [ ]` checkbox line as its
description text. When a chunk has no description prose, it must show nothing —
not a pointer line, not a checkbox, not a placeholder.

The root cause is `src/ReviewDoc.ts#334`: the description is "every body node
before the chunk's first top-level `list`", and when `findIndex` returns `-1`
the fallback is the ENTIRE body. That predicate is wrong in both directions —
`-1` does not mean "no pointers" (`taskItems` collects pointers recursively, at
any depth and inside any container), and "before the first list" does not mean
"prose". Three shapes leak today, all reproduced against the real parser:

- Pointers inside a blockquote — no top-level `list`, so `findIndex` is `-1`,
  the fallback takes the whole body, and the description becomes
  `> - [ ] ./src/a.ts#1 — thing` while the hunk itself still parses fine.
- Pointers indented four spaces — a code block, not a list. Same `-1` fallback;
  description shows the checkbox and the chunk shows "No file pointers".
- A `###` sub-heading or an HTML comment before the pointers — `findIndex`
  succeeds, but the description becomes `### Sub` or `<!-- x -->`. This one the
  `-1` fallback does not explain, and a fix aimed only at `-1` leaves it.

So the guarantee is not "handle `-1`" but "the description is the chunk's own
PROSE, and never a node that contains a hunk pointer". Establish it at the
parse. `src/web/screens/Review.tsx#395` renders `chunk.detail` whenever it is a
non-empty string and must keep doing exactly that — filtering at the render
would leave the same wrong string in the LSP outline and in every other view.

### Requirement B — Show a hunk's description above its diff, and give the note box its own channel

A hunk pointer's inline description — the `— what this hunk does` text the
review author writes — is currently loaded into the human's note textbox. Wrong
twice over: the author's description is not the reviewer's note, and seeding the
textbox means every hunk opens looking like it already carries a note the human
never wrote. The description belongs above the diff as read-only context, and
the note box starts empty unless the human actually attached a note.

`SteeringViewNode` already has the right two fields and chunks already use them
correctly — `detail` for the author's prose, `note` for an attached footnote
(`chunkNoteOf`, `src/ReviewDoc.ts#789`). Hunks put the author's prose in `note`
and never populate `detail` at all. Make hunks match chunks:

- `src/ReviewDoc.ts#819` — the hunk child emits `note: file.note`. `file.note`
  is purely the author's explanation: `hunkNote` (`#221`) explicitly filters out
  `footnoteDefinition`, and `sourceText` excises footnote references. Emit it as
  `detail` instead.
- `src/ReviewDoc.ts#813` — add the hunk mirror of `chunkNoteOf` to fill `note`.
  The key is exact, not a guess: `resolveHunkAnchor` (`#848`) attaches a hunk
  footnote at `file.sourceLine`, so the lookup is markers whose
  `line === file.sourceLine`.
- `src/web/screens/Hunk.tsx#151` — renders `node.title` then `DiffBody`. The
  description goes between them, from `node.detail`, and nothing renders when
  there is none.
- `src/web/screens/Review.tsx#148` — `noteTextOf` reads
  `notes[key] ?? node.note` and feeds `openNoteSheet`'s `initialNote`; `#151`
  `hasNoteText` reads the same field, so a hunk with only a description shows
  "Edit note" instead of "Add note". Both become correct once `note` carries
  only real notes; neither changes.

Risk: the hunk footnote read-back is not optional polish, it is what stops this
fix from making things worse. Today `notes[key]` holds a saved hunk note for the
session only and `node.note` is the wrong text. Move the description to `detail`
WITHOUT the mirror lookup and a hunk's `note` is permanently undefined — save a
note, reload, and it is gone with no trace in the UI, a silent data-loss face on
what is currently only a mislabelled textbox. Land both `ReviewDoc.ts` edits in
one commit.

Not at risk, checked: hunk-level footnotes already keep a review round open.
`reviewOutline` (`#568`) filters markers by the chunk's whole line span, which
covers its hunk lines, so `unchecked` already accounts for them. Neither
requirement adds round-completion behaviour and neither may change any.

## Task 1 — Extract the "contains a hunk pointer" test as one shared helper

The pointer test exists inline at the top of `parseHunk`
(`src/ReviewDoc.ts#310`–`#316`): a list item's first paragraph's first word is a
pointer token. Extract it as a private `hasPointerToken(content, item)` helper
in the same module and call it from `parseHunk` as well as from Task 2.

"A node that contains a hunk pointer" gets exactly one definition in the module,
or the parse and the description drift apart on the next pointer-syntax change.

Pure refactor: no behaviour change, no test change beyond what already passes.

Paths: `src/ReviewDoc.ts`.

- [ ] `parseHunk` calls the shared helper instead of testing the token inline
- [ ] the existing `src/ReviewDoc.test.ts` suite passes unchanged
- [ ] `npm run typecheck` and `npm run lint` green

## Task 2 — Make the chunk description the chunk's own prose

Replace `parseChunkBody`'s predicate (`src/ReviewDoc.ts#324`) with two
conditions applied to the body, in order:

1. Stop at the first POINTER-BEARING node — one whose `taskItems` include an
   item Task 1's helper accepts.
2. From that leading run, keep only prose node kinds — `paragraph`,
   `blockquote`, `list` — dropping `heading`, `html`, `code`, `thematicBreak`,
   and `footnoteDefinition` (the last already dropped today).

That kills all three leaking shapes: pointers in a blockquote and pointers
indented four spaces are stopped by (1) and by (2) respectively, and a `###`
sub-heading or an HTML comment before the pointers is stopped by (2) — the shape
a fix aimed only at `-1` leaves behind. No `-1` fallback remains: no
pointer-bearing node means the run is the whole body, and the kind filter still
decides what counts.

No error handling is added. A chunk with no prose yields `description === ""`,
and `src/web/screens/Review.tsx#395` already renders nothing for an empty string
— it keeps that exact conditional, unchanged. Filtering at the render would
leave the wrong string in the LSP outline and every other consumer.

Risk: a chunk whose prose sits AFTER its pointers now renders no description at
all. That is the intended reading of "the chunk's own prose", and it is a
behaviour change for any existing review file written that way.

Paths: `src/ReviewDoc.ts`, `src/ReviewDoc.test.ts`, `src/web/screens/Review.tsx`
(read-only — must not change).

- [ ] a `parseReviewDoc` unit test asserts `description === ""` for pointers
      inside a blockquote, and it fails against the old predicate
- [ ] a `parseReviewDoc` unit test asserts `description === ""` for pointers
      indented four spaces, and it fails against the old predicate
- [ ] a `parseReviewDoc` unit test asserts `description === ""` for a `###`
      sub-heading and for an HTML comment before the pointers, and it fails
      against the old predicate
- [ ] a chunk with real leading prose still yields that prose as its description
- [ ] `src/web/screens/Review.tsx#395`'s render conditional is byte-identical to
      before this package
- [ ] `npm test` green

## Task 3 — Move a hunk's description to `detail` and read its note back

`SteeringViewNode` is unchanged — no new field, no type change. Only which field
carries what changes, so hunks match chunks. Both edits below land in one
commit; the first alone loses saved notes.

`src/ReviewDoc.ts#819` — the hunk child emits `file.note` as `detail` instead of
`note`, keeping the same "only when defined" conditional.

`src/ReviewDoc.ts#813` — add `hunkNoteOf`, the exact mirror of `chunkNoteOf`
(`#789`): markers whose `line === file.sourceLine`, mapped through
`definitionByName`, `undefined`-filtered, joined with a single space,
`undefined` when none. The key is not a guess — `resolveHunkAnchor` (`#848`)
attaches a hunk footnote at `file.sourceLine`. A marker with no resolvable
definition is dropped, same as the chunk path; a chunk heading line and a hunk
source line can never collide, so the two lookups stay disjoint.

`src/web/screens/Review.tsx#148` `noteTextOf` and `#151` `hasNoteText` do not
change — they become correct for free once `note` carries only real notes.

Paths: `src/ReviewDoc.ts`, `src/ReviewDoc.test.ts`, `src/web/screens/Review.tsx`
(read-only — must not change).

- [ ] a `reviewView` unit test asserts a hunk node carries the author's
      explanation in `detail` and has no `note`, and it fails today
- [ ] a `reviewView` unit test asserts that hunk node carries the footnote body
      in `note` once a footnote is attached at its pointer line, and it fails
      today
- [ ] a hunk with two footnotes attached at its pointer line joins their bodies
      with a single space, matching the chunk path
- [ ] a marker whose definition is missing is dropped, not emitted as
      `undefined` text
- [ ] `noteTextOf` and `hasNoteText` in `src/web/screens/Review.tsx` are
      byte-identical to before this package
- [ ] a chunk-level footnote still surfaces as the chunk's `note`, unaffected
- [ ] `unchecked` still counts a hunk-level footnote as keeping the round open
- [ ] `npm test` green

## Task 4 — Render the description above the diff

`src/web/screens/Hunk.tsx#151` renders `node.detail` between the `node.title`
line and `<DiffBody />`, under the same guard `Review.tsx#395` uses
(`!== undefined && length > 0`), as a muted small-text block with its own test
id.

Plain text, mirroring the chunk detail exactly — no markdown rendering, which
would be the only markdown surface in the client.

Nothing renders when there is no description: no placeholder, one rule with the
chunk level.

Paths: `src/web/screens/Hunk.tsx`, `src/web/screens/Hunk.stories.tsx`.

- [ ] a `Hunk` story asserts the description renders between the title and the
      diff, and it fails today
- [ ] a `Hunk` story asserts nothing renders in that slot for a hunk with no
      description — no placeholder element
- [ ] the note affordance on a hunk carrying only a description reads "Add
      note", not "Edit note"
- [ ] `npm run test:web` green
