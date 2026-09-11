# Review: 2ecad1b

<!-- base: 541c1d3cceba4eee953a95501e64c8b8de806baa -->

Four independent packages land here: a `tailscale serve` front door for
`gtd ui`, structured prose blocks in the phone UI, the removal of all
autosave/debounce in favour of explicit Save buttons, and a Done control on the
Q&A deck.

- a "done" button for the design document view is missing. i can't stop the
  process from the ui.
- open questions should be surfaced to the top and visually clearly
  distinguished

## Tailscale serve front door for `gtd ui`

`gtd ui` no longer binds a tailnet IP itself by default. It publishes a loopback
listener through `tailscale serve`, letting tailscaled terminate TLS, and falls
back to today's direct HTTPS bind — never refusing — when serve is unavailable.
`--host` and `--self-signed` opt out of serve entirely.

- [ ] ./src/ui/Serve.ts#31 — new module: parse `tailscale serve status --json`,
      publish/unpublish a mapping, and read/write an ownership record A non-zero
      `tailscale` exit is a value (`ok: false`), never an Effect failure, so
      every caller can fall back.
- [ ] ./src/ui/Serve.ts#127 — `~/.gtd/serve/<port>.json` is the FIRST gtd state
      written outside a worktree `base` is a test-only seam defaulting to
      `homedir()`. Confirm you want gtd writing into the home directory at all.
- [ ] ./src/ui/Server.ts#179 — `HttpsServer` renamed `UiListener`; `tls` present
      picks https, absent picks plain http The plain-http branch is new: it
      exists only for the loopback socket tailscaled proxies into. The old
      "never plain http, deliberate policy" comment is gone.
- [ ] ./src/ui/Server.ts#470 — the status probe distinguishes "probe failed"
      from "probe ran, found nothing" Reads `stdout` alone, not merged
      stdout+stderr, so exit-0 stderr chatter can't make a foreign mapping look
      like a free port.
- [ ] ./src/ui/Server.ts#504 — ownership: a foreign live mapping, or a probe
      that failed, blocks publishing; a record naming a dead pid is cleared
      first
- [ ] ./src/ui/Server.ts#535 — the serve attempt itself: probe, orphan check,
      ephemeral loopback bind, publish; every failure returns a reason and
      closes what it bound
- [ ] ./src/ui/Server.ts#604 — teardown unpublishes only a mapping whose live
      target still matches our record; an unreadable probe leaves the record
      alone
- [ ] ./src/ui/Server.ts#624 — `resolveListener` picks serve vs direct bind and
      prints the fallback reason above the URL
- [ ] ./src/ui/Server.ts#819 — teardown chained onto the existing
      `Effect.ensuring` close
- [ ] ./docs/cli.md#74 — help text and `--host`/`--port` semantics rewritten for
      the serve default `--host` now means "opt out of serve", a meaning change,
      not an addition.
- [ ] ./docs/configuration.md#56 — `ui.host` absent no longer refuses; it falls
      back to the auto-detected CGNAT address This drops the old safety promise
      that gtd refuses rather than bind something unintended. Worth a deliberate
      nod.

## Serve-path integration coverage

`@live` scenarios drive a fake `tailscale` CLI installed on the PATH shim,
because neither a tailnet nor the binary exists on CI.

- [ ] ./tests/integration/support/hooks.ts#60 — stateful fake `tailscale` bash
      script; one `<port>.mapping` file per published port, plus a
      `fail-publish` marker It is installed for EVERY `@live` scenario, so it
      also answers plain `tailscale status --json` for scenarios that never
      opted into serve. Check that none of them relied on the real absence of
      tailscale.
- [ ] ./tests/integration/support/world.ts#700 — the publish-failure scenario
      asserts a real Tailscale CGNAT interface exists on the machine RISK: this
      `@live` scenario fails on any machine (a CI runner, a contributor's
      laptop) without Tailscale up — not skipped, failed. Every other serve
      scenario was carefully faked; this one is not.
- [ ] ./tests/integration/support/world.ts#619 — `$HOME` sandboxed to a temp dir
      for serve spawns only, so the ownership record never touches a real home
      directory
- [ ] ./tests/integration/features/ui-lifecycle.feature#285 — new scenarios:
      serve publish + teardown on handoff, SIGINT/SIGTERM teardown, and the
      publish-failure fallback Signal scenarios use the serve path deliberately,
      since the `--self-signed` spawns would assert teardown vacuously.

## Structured prose blocks in the phone UI

The `qa` view stopped projecting only paragraphs. Every top-level block —
heading, list, code, blockquote, paragraph — now becomes a view node carrying
its structure, and the client renders that structure instead of one flat `p`.

- [ ] ./src/SteeringFormat.ts#122 — new `BlockListItem` (recursive) and
      `SteeringViewNode.block` No new anchor kind: every block still anchors as
      `{kind: "paragraph", line}`.
- [ ] ./src/OpenQuestions.ts#1176 — `blockNodesOf` replaces `paragraphNodesOf`;
      blocks before, between and AFTER the questions sections all become nodes
      Skips only the two section headings and anything inside a question's span.
- [ ] ./src/OpenQuestions.ts#1067 — text is joined per child, never sliced as
      one span, so `>` markers and nested-list markdown never leak into a title
- [ ] ./src/OpenQuestions.ts#1114 — every node still gets a non-empty title; an
      empty code fence falls back to a literal `(empty code block)` string
- [ ] ./src/web/screens/ProseBlock.tsx#1 — new file: per-kind renderers behind a
      lookup table, with the plain `p` fallback for any unknown kind
- [ ] ./src/web/screens/ProseBlock.tsx#109 — a code block gets neither a note
      seam nor an inline note, because a marker on the fence line would corrupt
      it A human therefore cannot annotate a code block at all. Deliberate, but
      it is a capability gap worth confirming.
- [ ] ./src/web/screens/Plan.tsx#209 — ORDERING: all non-question nodes render
      above both question sections Since `blockNodesOf` now also emits blocks
      that follow the questions sections, trailing prose is hoisted to the top
      of the screen, out of document order. The comment directly above still
      claims these are "everything before `## Open Questions`" and is now wrong.
      The story that covers a trailing paragraph only asserts presence, not
      position.

## Explicit Save replaces every autosave and debounce

Package 03's debounce/blur/unmount write-through is unwound. Text now writes
only on a deliberate tap, and a free-text draft dies with its component.

- [ ] ./src/web/NoteSheet.tsx#41 — all debounce state, the in-flight/pending
      pair, the unmount commit and the `onAutoSave` prop are gone; Save and Save
      & Done are the only write paths
- [ ] ./src/web/screens/Question.tsx#116 — a real Save button next to the
      free-text box; blur no longer commits
- [ ] ./src/web/screens/Question.tsx#200 — the free-text draft moved out of the
      caller's `answers` map into local state, so navigating away discards it
      Deliberate per the doc comment: "types, navigates away, returns, box is
      empty" is only true if the draft dies with the component. This is a
      behaviour change a human will notice.
- [ ] ./src/web/screens/Question.tsx#283 — the changed-since-last-commit guard
      is gone; an explicit tap always writes, even a no-op
- [ ] ./src/web/screens/Plan.tsx#320 — the `onAutoSave` wrapper and its
      rethrow-to-let-the-sheet-retry contract removed
- [ ] ./src/web/screens/Review.tsx#178 — `autoSaveNote` and its optimistic
      revert removed from review state
- [ ] ./src/web/NoteSheet.test.ts#44 — a source-grep test asserting eight
      removed identifiers appear nowhere This pins a deletion by name, not by
      behaviour. It will pass forever and fail only on a rename. Decide if you
      want that kind of test kept.

## Done control on the Q&A deck

A human with nothing to write still needs a way to end the turn.

- [ ] ./src/ui/Router.ts#207 — `done`'s input is now `{ note?: {...} }`; the
      note absent branch skips the write and the compare-and-swap entirely Every
      existing caller had to move its flat fields under `note`.
- [ ] ./src/ui/Router.ts#304 — a malformed note still throws before anything is
      written or handed off
- [ ] ./src/web/Deck.tsx#26 — optional `onDone`/`doneLabel`; when given, the
      advance button's last-item label reverts from "Done" to "Back to list"
      `Review.tsx`'s hunk deck passes neither and is unchanged.
- [ ] ./src/web/screens/Plan.tsx#503 — `onDone` fires `done.mutateAsync({})`,
      fire-and-forget, refusal surfaced via the banner
- [ ] ./tests/integration/features/ui-lifecycle.feature#235 — a real no-note
      `done` round trip against a real spawned process, exiting 0

## Incidental cleanups

- [ ] ./src/web/screens/Plan.tsx#235 — nested ternaries extracted into
      `planLoadingMessage` and `deckDoneProps`
- [ ] ./tests/integration/support/world.ts#36 — the repeated `done` request
      literal and the TLS-env restore/exit-record tails factored into shared
      helpers
- [ ] ./src/web/screens/Plan.stories.tsx#170 — a leftover duplicate doc comment
      sits directly above the replacement one on
      `NoteAttachesToAHeadingOnItsOwnLine`
