# Requirements

## PRODUCT — Show a hunk's description above its diff, never inside the note box

A hunk pointer's inline description — the `— what this hunk does` text the
review author writes on the pointer line — is currently loaded into the human's
note textbox. That is the wrong destination twice over: the author's description
is not the reviewer's note, and seeding the textbox with it means every hunk
opens looking like it already carries a note the human never wrote.

The description belongs above the diff, as read-only context. The note box
starts empty unless the human has actually attached a note.

- `src/ReviewDoc.ts#819` — a hunk pointer's parsed inline text is emitted as the
  view node's `note` field, the same field a real human-attached note uses.
  These are two different things sharing one channel; the view has to
  distinguish them.
- `src/web/screens/Review.tsx#148` — `noteTextOf` reads
  `notes[key] ?? node.note` and feeds it to `openNoteSheet`'s `initialNote`, so
  the author's description becomes the textarea's starting value.
- `src/web/screens/Review.tsx#151` — `hasNoteText` reads the same field, so a
  hunk with only a description shows "Edit note" instead of "Add note".
- `src/web/screens/Hunk.tsx#148` — the hunk screen renders `node.title` above
  `DiffBody` today and nothing else. This is where the description goes.

Risk: a hunk's description and a hunk's attached footnote note are both real,
and both must survive a round trip through `annotate`. Separating them in the
view must not make a human's note un-writable or drop the author's description
from the file.

## PRODUCT — Render nothing for a chunk with no description

A chunk summary sometimes displays the first hunk's checkbox line as its
description text. When a chunk has no description prose, it must show nothing —
not a pointer line, not a checkbox, not a placeholder.

- `src/ReviewDoc.ts#335` — the description is every body node before the chunk's
  first `list` node. When `findIndex` returns `-1` because the pointers did not
  parse as a top-level `list`, the fallback is the ENTIRE body, so the pointer
  items get joined into the description string. That fallback is the leak.
- `src/web/screens/Review.tsx#395` — `ChunkRow` renders `chunk.detail` whenever
  it is a non-empty string, with no notion of "this isn't really prose". The
  guarantee has to hold at the parse, not by filtering at the render.

## PRODUCT — Remove the dictate button

The in-page Dictate control is unnecessary and freezes the UI. Phone users
dictate from the on-screen keyboard's own mic key, which needs no code here.
Remove the control and everything that exists only to serve it — not just the
button, but the Web Speech API wrapper behind it, its stories, and the "Use your
keyboard's mic key to dictate" fallback hint that only makes sense alongside it.

- `src/web/Mic.tsx` — the whole Web Speech API render-prop component, including
  its hand-written `SpeechRecognition` type shims.
- `src/web/Mic.stories.tsx` — its stories.
- `src/web/NoteSheet.tsx#186` — the `Mic` wrapper, the `note-sheet-mic` button,
  `note-sheet-mic-hint`, and `note-sheet-mic-interim`.
- `src/web/screens/Question.tsx#130` — the `Mic` wrapper, `mic-toggle`,
  `mic-hint`, and `mic-interim` on the free-text answer.
- `src/web/NoteSheet.stories.tsx`, `src/web/screens/Question.stories.tsx` — the
  stories that install `window.SpeechRecognition` and assert on those test ids.

## PRODUCT — Remove the QR code

The QR code printed on server start has no purpose. Remove it and its
dependency, not just the call site.

- `src/ui/Server.ts#584` — `out.write(renderQrCode(url))`, the only call site.
  The URL line above it stays.
- `src/ui/Server.ts#28` — the `renderQrCode` import.
- `src/ui/Qr.ts`, `src/ui/Qr.test.ts` — the module and its test.
- `src/ui/Server.test.ts` — the server tests that assert the QR block is
  printed.
- `package.json#118`, `package.json#77` — `qrcode-terminal` and
  `@types/qrcode-terminal` become unused dependencies.
