# Requirements

## PRODUCT — Remove the QR code

The QR code printed on server start has no purpose. Remove it, its module, and
its dependency — not just the call site.

- `src/ui/Server.ts#584` — the sole `renderQrCode(url)` write, one line below
  the `url` write. The `url` line immediately above it stays.
- `src/ui/Server.ts#28` — the `renderQrCode` import.
- `src/ui/Qr.ts`, `src/ui/Qr.test.ts` — the module (14 lines) and its test.
- `package.json#118`, `package.json#77` — `qrcode-terminal` and
  `@types/qrcode-terminal`.

Acceptance: `npm run deadcode` (fallow) reds on both an unreferenced `Qr.ts` and
an unused dependency, so the module deletion and the two `package.json` lines
are one atomic change — dropping the file without the deps fails the gate.

Risk: three tests in `src/ui/Server.test.ts` assert the QR line (`#595`, `#635`,
`#685`), and they are NOT QR tests. They pin the Tailscale-hostname probe and
the CGNAT-IP fallback — which address gets bound versus which gets printed.
Deleting them to make the suite green silently drops that coverage. Rewrite each
to assert the URL only, and fix the `written[1]` index every following assertion
in them uses.

## PRODUCT — Remove the dictate button

The in-page Dictate control is unnecessary and freezes the UI. Phone users
dictate from the on-screen keyboard's own mic key, which needs no code here.
Remove the control and everything that exists only to serve it.

- `src/web/Mic.tsx` — the whole Web Speech API render-prop component (152
  lines), including its hand-written `SpeechRecognition` type shims.
- `src/web/Mic.stories.tsx` — its stories (250 lines).
- `src/web/NoteSheet.tsx#177` — the `Mic` wrapper, the `note-sheet-mic` button,
  `note-sheet-mic-interim`, AND `note-sheet-mic-hint`. The hint string goes too:
  it is the `state.available === false` branch of the same render prop, and the
  answer is to drop it, not to keep it as static text. The note-sheet footer
  keeps only its Save/Dismiss controls.
- `src/web/screens/Question.tsx#131` — the `Mic` wrapper, `mic-toggle`,
  `mic-interim`, and `mic-hint`, on the same rule.
- `src/web/NoteSheet.stories.tsx`, `src/web/screens/Question.stories.tsx` — the
  stories that install `window.SpeechRecognition` and assert those test ids.
  Anything asserting the hint is deleted, not repointed at a surviving element.
- `src/Cli.ts#492` and `docs/cli.md#77` — the `ui` help text. These two are
  pinned equal to each other, so both change or the gate reds.

`gtd ui` stays HTTPS-only, and the help text says so for a new reason. The old
one — "the Web Speech API is secure-context-only" — is the only reason given,
and it is false the moment `Mic` is deleted. Nothing else in the client needs a
secure context: `src/web/` has no `navigator.clipboard`, no `serviceWorker`, no
`crypto.subtle`, no `getUserMedia`. So the constraint is now a deliberate
policy, not a technical requirement, and the replacement wording must say that
straight — a phone client reachable over a tailnet gets TLS on its own merits.
Do not swap in another invented technical justification. The
cert/`--self-signed`/`ui.cert`/`ui.key` machinery is untouched.

Also dead once `Mic` is gone, and easy to leave behind because nothing
type-errors: `Question.tsx`'s `onDictate` prop, and the FUNCTIONAL-updater shape
of `onAnswerChange` (`src/web/screens/Question.tsx#65`). Both exist for exactly
one reason — `Mic` binds `onAttach` once inside `start()`, so a dictation
session ending later calls back through a closure captured at tap-time. The long
doc comments at `Question.tsx#54`, `#87`, and `NoteSheet.tsx#56` explain that
closure hazard and describe no other caller. Delete the prop, the updater
overload, and those comments together; a plain value is correct once no
late-firing callback exists.

Acceptance: `npm run deadcode` reds on an unreferenced `Mic.tsx`, and the
`docs/cli.md` pin test reds on a help-text change made in only one of the two
places.

## PRODUCT — Render nothing for a chunk with no description

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

## PRODUCT — Show a hunk's description above its diff, and give the note box its own channel

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

### Should the hunk screen show a placeholder when a hunk has no description?

No — nothing renders. Same rule the chunk-description concern establishes one
level up, and one rule beats two.

### Should the chunk-description fix filter at the render instead of the parse?

Parse. The LSP outline and every other consumer read the same `description`
string, so a render-side filter fixes one surface and leaves the rest wrong.

### Do the author's description and a human's note both have to survive a round trip through `annotate`?

Yes, and they already can — they occupy separate storage in the file (pointer
text versus a footnote definition), so separating them in the view needs no
format change at all.

### With dictation gone, does `gtd ui` stay HTTPS-only?

Yes. HTTPS-only stays and the stated reason is reworded — a phone client over a
tailnet wants TLS on its own merits. Plain http was rejected. The cert and
`--self-signed` machinery is untouched.

### What replaces the "Use your keyboard's mic key to dictate" hint?

Nothing. The hint is deleted with the button. The on-screen keyboard's mic key
needs no signpost, and an empty note-sheet footer is one less thing on a small
screen.
