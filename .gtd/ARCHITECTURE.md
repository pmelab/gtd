# Architecture

## Open Questions

### Does `onAnswerChange`'s functional-updater overload get deleted with `Mic`, or kept for the async refusal-revert path?

The settled concern says the overload exists for exactly one reason — `Mic`'s
tap-time closure — and goes with it. The code says otherwise: four call sites
inside `src/web/screens/Question.tsx` pass an updater, and one of them (`#288`,
the refusal-revert sequence) fires AFTER an awaited write, so it needs the
deferred read of "current answer" for the same reason `Mic` did. Deleting the
overload rewrites that path against a closure captured before the write.

- [ ] Keep the overload; delete only `onDictate` and the `Mic`-specific
      comments, and re-point `Question.tsx#65`'s doc comment at the async revert
      path as the surviving reason
- [ ] Delete the overload as written; rewrite `#235`, `#288`, `#361`, `#441` to
      plain values computed from the `answer` prop, accepting a stale-read
      clobber when a refusal-revert lands after further typing
- [ ] _your answer_

## Remove the QR code

A pure deletion, one commit, no new structure. `renderQrCode` is a leaf: one
call site, one module, one dependency pair.

Order inside the change matters only for the gate. `npm run deadcode`
(`fallow --summary --quiet`) reds on both an unreferenced `src/ui/Qr.ts` and an
unused `qrcode-terminal`, so the file deletion and the two `package.json` lines
land together or the gate stays red. `package.json` is in `turbo.json`'s
`globalDependencies`, so every cached task re-runs on this change — no stale
green to design around.

Primary paths:

- `src/ui/Server.ts` — drop the `renderQrCode` import (`#28`) and the
  `out.write(`${renderQrCode(url)}\n`)` line (`#584`). The `url` write above it
  and the `out.flush()` below it stay exactly as they are.
- `src/ui/Qr.ts`, `src/ui/Qr.test.ts` — deleted outright.
- `package.json` — drop `qrcode-terminal` (`#118`) and `@types/qrcode-terminal`
  (`#77`), and run `npm install` so `package-lock.json` matches.
- `src/ui/Server.test.ts` — drop the `./Qr.js` import (`#28`) and rewrite the
  three assertions, below.

The test rewrite is the only judgement in this concern. Those three tests pin
the Tailscale-hostname probe and the CGNAT-IP fallback — which address gets
bound versus which gets printed — not the QR code. Each keeps its `written[0]`
URL assertion and loses only its `written[1]` line (`#628`, `#679`, `#720`),
plus the comment at `#627` that explains the QR line's coupling to the URL.
Nothing after them re-indexes, because `written[1]` was the last index each one
read; the helper at `#1060` already reads `written[0]` only. Deleting a whole
test to reach green drops the address-selection coverage — that is the failure
mode to avoid here.

Acceptance: `npm test` green with `deadcode` reporting no unreferenced module
and no unused dependency, and the three address-selection tests still present,
each asserting exactly one written line.

## Remove the dictate button

Also a deletion, but it cuts through four components' props and two pinned help
texts, so it is its own package. No new module, no new dependency; the Web
Speech API leaves the codebase entirely, including the hand-written
`SpeechRecognition` type shims — there is no other consumer in `src/web/`.

Primary paths:

- `src/web/Mic.tsx`, `src/web/Mic.stories.tsx` — deleted.
- `src/web/NoteSheet.tsx` — the `Mic` wrapper (`#177`–`#201`) and its three test
  ids (`note-sheet-mic`, `note-sheet-mic-interim`, `note-sheet-mic-hint`). The
  footer keeps its Save/Dismiss group and becomes a single-child flex row;
  `justify-between` against one child is wrong once the mic side is gone, so the
  footer's own layout classes change with it. The dictation doc comment at `#56`
  goes too.
- `src/web/screens/Question.tsx` — `FreeTextOption`'s `Mic` wrapper
  (`#131`–`#150`), `mic-toggle`, `mic-interim`, `mic-hint`, the `onDictate` prop
  and its handler (`#432`), and the closure-hazard doc comments at `#54`, `#87`,
  `#422`.
- `src/web/NoteSheet.stories.tsx`, `src/web/screens/Question.stories.tsx` — the
  `FakeSpeechRecognition` classes and every story built on them, including
  `NoSpeechApiShowsAHintInsteadOfAMicButton`, `MicToggleMeetsThe44pxFloor`, and
  `MicToggleShowsStopLabelWhileRecording`. A story asserting `mic-hint` or
  `note-sheet-mic-hint` is deleted, never repointed at a surviving element — the
  hint text does not survive anywhere.
- `src/Cli.ts#492` and `docs/cli.md#77` — the `ui` help text.

The help text is one edit in two files that must render identically:
`src/Cli.test.ts#867` pins `docs/cli.md`'s `## Commands` fenced block equal to
`renderHelp()`. The `ui` entry's first `details` line currently reads "never
plain http — the Web Speech API is secure-context-only", which is false the
moment `Mic` is deleted. Nothing else in `src/web/` needs a secure context — no
`navigator.clipboard`, no `serviceWorker`, no `crypto.subtle`, no
`getUserMedia`. Replacement states the policy, invents no new technical reason:
"never plain http — a phone client reachable over a tailnet gets TLS on its own
merits". Re-wrap both sides to the same column width the surrounding lines use.
The cert, `--self-signed`, `ui.cert`, and `ui.key` machinery is untouched.

Risk: `src/web/generated.html` is a build artifact holding the bundled old code.
It is regenerated by `npm run build`, which `test:unit` depends on — do not
hand-edit it, and do not read it as a source of truth about what still
references `Mic`.

Acceptance: `deadcode` reports no unreferenced `Mic.tsx`; the `docs/cli.md` pin
test reds when the help text changes in only one of the two places;
`npm run test:web` green with no story installing `window.SpeechRecognition`.

## Description channels in the review view

Two fixes to `src/ReviewDoc.ts`'s view emission, one package (see
`## Merged Concerns`). Both establish the same rule at the parse, not at the
render: `detail` carries the author's prose, `note` carries an attached
footnote, and no renderer filters either.

### The chunk description is prose, never a pointer-bearing node

`parseChunkBody` (`#324`) defines the description as "every body node before the
chunk's first top-level `list`", falling back to the ENTIRE body when
`findIndex` returns `-1`. Both halves are wrong: `-1` does not mean "no
pointers" (`taskItems` collects them recursively, at any depth and inside any
container), and "before the first list" does not mean "prose".

Replace the predicate with two conditions, both applied to the body:

1. Stop at the first POINTER-BEARING node — one whose `taskItems` include an
   item whose first paragraph's first word is a pointer token. That test already
   exists inline at the top of `parseHunk` (`#310`–`#316`); extract it as a
   shared `hasPointerToken(content, item)` helper so "a node that contains a
   hunk pointer" has exactly one definition in the module, used by both call
   sites.
2. From that leading run, keep only prose node kinds — `paragraph`,
   `blockquote`, `list` — dropping `heading`, `html`, `code`, `thematicBreak`,
   and `footnoteDefinition` (the last already dropped today).

That kills all three leaking shapes: pointers in a blockquote and pointers
indented four spaces are stopped by (1) and by (2) respectively, and a `###`
sub-heading or an HTML comment before the pointers is stopped by (2) — the shape
a fix aimed only at `-1` would leave behind. There is no `-1` fallback left: no
pointer-bearing node means the run is the whole body, and the kind filter still
decides what counts.

Error handling: none is added. A chunk with no prose yields `description === ""`
and `src/web/screens/Review.tsx#395` already renders nothing for an empty
string. It keeps that exact conditional — filtering at the render would leave
the wrong string in the LSP outline and every other consumer.

Risk: a chunk whose prose sits AFTER its pointers now renders no description at
all. That is the intended reading of "the chunk's own prose", and it is a
behaviour change for any existing review file written that way.

### A hunk's description moves to `detail`, and `note` gets a real read-back

`SteeringViewNode` is unchanged — no new field, no type change. Only which field
carries what changes, so hunks match chunks.

- `src/ReviewDoc.ts#819` — the hunk child emits `note: file.note`. Emit it as
  `detail` instead, keeping the same "only when defined" conditional.
  `file.note` is purely the author's explanation: `hunkNote` (`#221`) explicitly
  filters out `footnoteDefinition`, and `sourceText` excises footnote
  references.
- `src/ReviewDoc.ts#813` — add `hunkNoteOf`, the exact mirror of `chunkNoteOf`
  (`#789`): markers whose `line === file.sourceLine`, mapped through
  `definitionByName`, `undefined`-filtered, joined with a single space,
  `undefined` when none. The key is not a guess — `resolveHunkAnchor` (`#848`)
  attaches a hunk footnote at `file.sourceLine`. A marker with no resolvable
  definition is dropped, same as the chunk path; a chunk heading line and a hunk
  source line can never collide, so the two lookups stay disjoint.
- `src/web/screens/Hunk.tsx#151` — render `node.detail` between the `node.title`
  line and `<DiffBody />`, under the same guard Review.tsx uses
  (`!== undefined && length > 0`), as a muted small-text block with its own test
  id. Nothing renders when there is no description — no placeholder, one rule
  with the chunk level.
- `src/web/screens/Review.tsx#148` `noteTextOf` and `#151` `hasNoteText` do not
  change. They become correct for free once `note` carries only real notes.

Risk: the `hunkNoteOf` read-back is not polish, it is what stops this fix from
regressing. Move the description to `detail` WITHOUT it and a hunk's `note` is
permanently `undefined` — save a note, reload, and it is gone with no trace in
the UI: silent data loss replacing what is today only a mislabelled textbox.
Land the two `ReviewDoc.ts` edits in one commit.

Not at risk, checked: hunk-level footnotes already keep a review round open.
`reviewOutline` (`#568`) filters markers by the chunk's whole line span, which
covers its hunk lines. This package adds no round-completion behaviour and must
not change any.

Acceptance:

- a `parseReviewDoc` unit test over all three leaking shapes above asserting
  `description === ""` — each fails today;
- a `reviewView` unit test asserting a hunk node carries the explanation in
  `detail` and no `note`, and carries a footnote body in `note` once one is
  attached to its pointer line — fails today;
- a `Hunk` story asserting the description renders between the title and the
  diff — fails today.

## Merged Concerns

Merged: "Render nothing for a chunk with no description" and "Show a hunk's
description above its diff, and give the note box its own channel". Both center
on `src/ReviewDoc.ts` (`parseChunkBody`/`reviewView` and their `description` and
`note` emission) and both land their unit tests in the same file; the second
consumes no interface the first creates, so keeping them apart would just split
one file's edit across two packages.

Both requirements verbatim, so spec review still covers each independently:

### PRODUCT — Render nothing for a chunk with no description

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

Acceptance: a `parseReviewDoc` unit test over all three shapes above asserting
`description === ""`. Each one fails today.

### PRODUCT — Show a hunk's description above its diff, and give the note box its own channel

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
what is currently only a mislabelled textbox.

Not at risk, checked: hunk-level footnotes already keep a review round open.
`reviewOutline` (`#568`) filters markers by the chunk's whole line span, which
covers its hunk lines, so `unchecked` already accounts for them. This concern
adds no round-completion behaviour and must not change any.

Acceptance: a `reviewView` unit test asserting a hunk node carries the
explanation in `detail` and no `note`, and carries a footnote body in `note`
after one is attached to its pointer line; plus a `Hunk` story asserting the
description renders between the title and the diff. Both fail today.

## Answered Questions

### Do the QR removal and the dictate removal ship as one package?

No. They share no file — `src/ui/` versus `src/web/` plus `src/Cli.ts` and
`docs/cli.md` — and only the dictate one carries the two-place help-text pin.

### What predicate replaces "every node before the first top-level list"?

The leading run of body nodes up to the first pointer-bearing node, filtered to
`paragraph`/`blockquote`/`list`. One rule covers all three leaking shapes; a
`-1`-only fix leaves the heading and HTML-comment case wrong.

### Does the pointer test get extracted as a shared helper, or duplicated in `parseChunkBody`?

Extracted. "A node that contains a hunk pointer" must have one definition, or
the parse and the description drift apart on the next pointer-syntax change.

### Does the hunk description render as markdown or plain text?

Plain text, mirroring `Review.tsx#395`'s chunk detail exactly — two renderings
of the same field would be the only markdown surface in the client.

### Do the three address-selection tests in `Server.test.ts` get deleted or rewritten?

Rewritten. They pin the Tailscale probe and CGNAT fallback, not the QR code;
deleting them for green silently drops that coverage.

### What does the `ui` help text say now that the Web Speech reason is false?

That HTTPS-only is deliberate policy — a phone client reachable over a tailnet
gets TLS on its own merits. No invented replacement technical constraint, and
both pinned copies change together.
