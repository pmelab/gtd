# Review: 6338c1c

<!-- base: e1d28c768b5c9faf11b7600c2ab6b54cbc22fe1c -->

## Remove dictation from the phone UI

The `Mic` component and every consumer are gone. Both the note sheet and the
free-text answer slot now offer typing only; the keyboard's own mic key remains
the dictation path, so no code carries it. All the doc comments that existed
purely to explain "why a functional updater survives a dictation session" are
rewritten or deleted.

- [ ] ./src/web/Mic.tsx — the whole component deleted (152 lines), together with
      ./src/web/Mic.stories.tsx (250 lines)
- [ ] ./src/web/NoteSheet.tsx#168 — footer loses the Dictate button, the
      unavailable-hint span, and the interim-transcript span; layout flips from
      `justify-between` to `justify-end` The doc comment paragraph about
      dictated text writing only into local `text` state also goes.
      `scheduleAutoSave` survives with one remaining call site (line 140) —
      verify that is the typing path, not orphaned code.
- [ ] ./src/web/screens/Question.tsx#84 — `FreeTextOption` drops the `onDictate`
      prop and the `Mic` block; `OptionRow` drops the pass-through; the
      `onDictate` handler on `Question` is deleted
- [ ] ./src/web/screens/Question.tsx#50 — the `answer` prop's functional-updater
      rationale is rewritten from "Mic binds onAttach once" to the
      refusal-revert sequence after an awaited write Good catch — the functional
      updater is still load-bearing without dictation, and the comment now names
      the reason that actually remains.
- [ ] ./src/web/screens/Question.stories.tsx — 132 lines of mic stories removed
- [ ] ./src/web/NoteSheet.stories.tsx — mic stories removed here too

## Remove the QR code from `gtd ui`

`gtd ui` prints only the URL now. `qrcode-terminal` and its types leave
`package.json`, which lets the bundler config drop its one exception. Every "the
Web Speech API is secure-context-only" justification for HTTPS is replaced with
a plain policy statement — TLS on its own merits — because Web Speech is no
longer in play.

- [ ] ./src/ui/Server.ts#583 — the `out.write(renderQrCode(url))` line and the
      import are gone; one printed line remains
- [ ] ./src/ui/Server.ts#172 — HTTPS-only comment restated as deliberate policy,
      not a technical requirement
- [ ] ./src/ui/Qr.ts — deleted, along with ./src/ui/Qr.test.ts
- [ ] ./src/ui/Server.test.ts#594 — three URL-printing tests drop their QR
      assertion and wait for 1 write instead of 2, with titles renamed to match
      The strongest assertion in the old tests — the QR encodes the SAME URL
      just printed — disappears with the feature, which is correct; what remains
      still pins the tailnet-hostname-vs-bind-IP split.
- [ ] ./tsdown.config.ts#45 — `alwaysBundle` becomes `[/.*/]`, dropping the
      predicate that kept `qrcode-terminal` external over its legacy octal
      escapes Confirmed: `dist/gtd.bundle.mjs` contains zero `qrcode-terminal`
      references, so nothing is left external by accident.
- [ ] ./package.json#74 — `qrcode-terminal` and `@types/qrcode-terminal` removed
      from dependencies
- [ ] ./src/Cli.ts#489 and ./docs/cli.md#77 — the `ui` help text's parenthetical
      is reworded; the two stay pinned equal as required
- [ ] ./src/ui/Tls.ts#35 — self-signed cert rationale drops "Web Speech API
      secure-context check"; the three `-addext` flags now justified as "for iOS
      to trust the leaf at all" The flags themselves are unchanged. Worth a
      sanity read: the new claim is broader than the old one and is untested
      either way.
- [ ] ./src/ui/Tailscale.ts#41 and ./tests/integration/features/ui.feature#261 —
      trailing QR mentions scrubbed from comments

## Split a hunk's own prose from a reviewer's attached note

A hunk pointer's inline description used to land on the view node's `note`, the
same channel a human's footnote uses — so every described hunk looked like it
already carried a reviewer note. Now the author's prose is `detail` (read-only
context) and only a real footnote attached at the pointer's line becomes `note`.
This is what makes `hasNote` and the note textbox honest.

- [ ] ./src/ReviewDoc.ts#817 — new `hunkNoteOf`, mirroring `chunkNoteOf`:
      matches markers by `line === sourceLine`, drops markers with no
      definition, joins multiple bodies with a space
- [ ] ./src/ReviewDoc.ts#843 — hunk children now emit `detail: file.note` and
      `note: hunkNoteOf(...)`
- [ ] ./src/web/screens/Hunk.tsx#152 — renders `node.detail` as a muted line
      between the title and the diff, nothing when absent
- [ ] ./src/web/screens/Hunk.stories.tsx#256 — three stories: DOM ordering title
      → description → diff, no placeholder when absent, and "Add note" still
      shown for a description-only hunk
- [ ] ./src/ReviewDoc.test.ts#2125 — existing footnote-projection tests updated
      to the `detail`/`note` split, plus three new cases (two footnotes joined,
      missing definition dropped, description-only hunk has no `note`) The
      note-sheet path is the payoff: `Review.tsx#149` opens the textbox with
      `node.note`, which is now empty unless a human wrote something.

## Tighten what counts as a chunk's description

The description used to be every node before the chunk's first `list`. That
mis-read two shapes: pointers nested inside a blockquote produced no top-level
list, so the pointer text itself became the description; and a `###` heading or
HTML comment before the pointers was swallowed into it. The cut is now made at
the first node containing a real pointer at any depth, then filtered to
prose-shaped nodes only.

- [ ] ./src/ReviewDoc.ts#302 — `firstParagraphToken` plus `hasPointerToken`, the
      single shared "is this list item a pointer" test
- [ ] ./src/ReviewDoc.ts#324 — `parseHunk` delegates to it It calls
      `hasPointerToken` and then `firstParagraphToken(...)!` — the same walk
      twice, with a non-null assertion carrying the correlation. One call
      returning the token, with an `undefined` early return, would be both
      cheaper and assertion-free.
- [ ] ./src/ReviewDoc.ts#349 — the cut moves from `findIndex(type === "list")`
      to the first node whose `taskItems` include a pointer; the
      `footnoteDefinition` blacklist becomes the `PROSE_NODE_KINDS` allowlist
      Behaviour widens as well as narrows: `list` is in the allowlist, so a
      plain non-pointer bullet list before the pointers now joins the
      description, where before it truncated it. Intended, but it is a change no
      test in this range pins.
- [ ] ./src/ReviewDoc.ts#340 — `PROSE_NODE_KINDS` = paragraph, blockquote, list;
      heading, html, code, thematicBreak, footnoteDefinition all dropped
- [ ] ./src/ReviewDoc.test.ts#350 — five cases: blockquote-wrapped pointers,
      four-space-indented code block, `###` sub-heading, HTML comment, and real
      prose still surviving
