# Review: 157cdd8

<!-- base: 7ccc037cebf83dc04ce5bdb04b1eb49893ef8438 -->

- styles are not loaded (at least in development mode)
- if available, it should detect tailscale and emit the tailscale url

## The start gate moves from content kind to actor

`gtd ui` used to bind only on `kind === "prompt"`. It now binds on any non-idle
rest whose **actor is human** and whose `file`/`mode` resolve to a registered
steering format — `kind` is never read. The reason: a `message` rest turns
`capture` the moment the human dirties the tree, so kind is unstable under the
very editing this screen exists for. `Step` also gained `state`, the rest's
machine identity, which the lifetime check below depends on.

- [ ] ./src/ui/Server.ts#295 — `isRenderable` drops the `kind` test for
      `actor === "human"`
- [ ] ./src/ui/Server.ts#311 — `refusalFor` re-ordered narrowest-cause-first:
      unreadable, idle, non-human actor, then human-but-no-usable-steering-file
      Idle is checked before the actor test on purpose — an idle worktree also
      reports `actor: human`, so an actor-only test would bind a port on a
      finished worktree.
- [ ] ./src/ui/Beat.ts#71 — `Step.state` added, filled from the beat's own
      `state` field
- [ ] ./tests/integration/features/ui.feature#194 — new @live scenario: a human
      rest reporting kind `message` binds and exits 0 through a real handoff
- [ ] ./tests/integration/features/ui.feature#43 — the four refusal scenarios
      now assert the actor axis ("rests with you", "agent", "check") instead of
      the kind word
- [ ] ./src/ui/Server.test.ts#582 — same reshaping unit-side, plus a case
      proving a `message` beat with file/mode starts

## Server lifetime: the tab-close beacon is gone, replaced by moved-on detection

`POST /close` and `main.tsx`'s `pagehide` beacon are deleted. The server now
ends through exactly two doors: a real `done` handoff, or a `step` query that
finds the served rest has moved on (different `state`, gone broken, or no longer
renderable). Motive: a reload fired the beacon and killed the server.

**Risk: nothing detects a closed tab any more.** A human who closes the tab
without handing off leaves `gtd ui` alive until either the outer loop advances
the state _and_ some client issues a `step` query, or a signal arrives. No timer
polls. Confirm whatever spawns `gtd ui` owns that kill.

- [ ] ./src/ui/Server.ts#420 — `readServedStep` compares each read against the
      state/label captured at startup and resolves the same idempotent
      end-of-life deferred
- [ ] ./src/ui/Beat.ts#93 — new `MovedOnStep` variant in `StepRead`; `readStep`
      itself narrowed to `Step | BrokenStep` so only the server can produce it
- [ ] ./src/ui/Server.ts#476 — the `/close` handler and its `CLOSE_PATH`
      constant removed
- [ ] ./src/web/main.tsx#12 — the `pagehide`/`sendBeacon` listener removed
- [ ] ./tests/integration/features/ui-lifecycle.feature#203 — the close scenario
      is replaced by "a reload does not kill gtd ui, and done still hands off,
      exit 0"
- [ ] ./tests/integration/support/world.ts#662 — `spawnGtdUiAndClose` →
      `spawnGtdUiReloadThenHandOff`: a real GET, then a real `done` mutation
- [ ] ./src/ui/Server.test.ts#836 — `step` returns `{status: "moved-on"}` and
      the main Effect completes on its own (asserted with `Fiber.await`, not an
      interrupt) Worth a look: `refusalFor`'s `status !== "ok"` branch prints a
      `moved-on` label as "this worktree can't be read: <label>". Unreachable
      today, since startup calls `readStep` directly, but it reads wrong if that
      ever changes.

## Reads and writes confined to the one served file

Every `readSteeringFile`/`writeNote`/`writeValue` request is now checked against
the file the served step named at startup. Anything else is refused as
`file-vanished` — a reused reason rather than a seventh refusal code, since only
a hand-rolled client can reach it.

**Risk: `resolveDiff` is not gated.** It still takes any client-supplied path,
bounded only by `resolveWithinRoot`, so any tailnet caller can read a diff for
any file in the worktree. Deliberate or an oversight — decide.

- [ ] ./src/ui/Server.ts#438 — `isServedFile` plus the three gated context
      entries
- [ ] ./src/ui/Server.test.ts#780 — refuses `.git/config` (a real file, so this
      proves the confinement gate rather than a resolve failure), and the same
      for writeNote/setValue

## Shell quoting for every interpolated string

Client- and `.gtdrc`-supplied strings reaching a `bash` command string now go
through one escape, re-exported from `GitScript.ts#shellQuote` (already
property-tested against real bash) rather than reimplemented.

- [ ] ./src/ui/Shell.ts#15 — `singleQuoted`, a re-export so there is exactly one
      implementation to fix
- [ ] ./src/ui/Diff.ts#174 — `git diff` now quotes the base too, not just the
      path; the base is `gtd base`'s own stdout
- [ ] ./src/ui/Tls.ts#51 — openssl's `-keyout`/`-out`/`-subj`/`-addext` values
      all quoted **Accepted, not fixed, and documented at the line:** a host
      containing `/` or `=` still confuses openssl's own `-subj` key=value
      parser. It fails with a named `GtdError` and never executes anything, but
      a bad `ui.host` yields a confusing error instead of a validation refusal.
- [ ] ./src/ui/Tls.ts#93 — `Effect.ensuring` removes the private-key tmpdir on
      every exit path, not just success
- [ ] ./src/ui/Tls.test.ts#83 — real-openssl tests: a command substitution in
      `ui.host` leaves no marker file; tmpdir cleaned after both a non-zero exit
      and a failed read-back

## Symlink escapes refused

`resolveWithinRoot` now realpaths both root and candidate, so a symlink inside
the worktree pointing outside it is refused. Root is realpathed too, so a
worktree reached through a symlinked parent still serves its own files. The
containment test compares path segments, not a string prefix, so a file named
`..foo` is no longer wrongly refused.

- [ ] ./src/ui/SafePath.ts#14 — `realpathExistingAncestor` walks up past a
      not-yet-existing leaf; any non-ENOENT realpath error propagates and
      becomes a refusal
- [ ] ./src/ui/SafePath.ts#51 — the segment-based containment check Note it
      returns the pre-realpath `candidate`, not the resolved path — the caller
      keeps operating through the symlinked root, by design.
- [ ] ./src/ui/SafePath.test.ts#35 — real on-disk cases: `..foo`, symlinked
      root, escaping file symlink, escaping directory symlink
- [ ] ./src/ui/Write.test.ts#103 — the same escape refused through the real
      `liveReadFile`/`liveWriteFile`, with `readFile` never called
- [ ] ./src/ui/ReadSteeringFile.test.ts#53 — same, on the read path

## `--dev` builds the client once, at startup

The client HTML (and, under `--dev`, its tsdown rebuild) is resolved once ahead
of `listen` instead of per request. The server lives for exactly one step, so a
mid-step rebuild had nothing to reflect — and a subprocess build per
unauthenticated request was free amplification.

- [ ] ./src/ui/Server.ts#383 — `resolveClientHtml` hoisted above `listen`; the
      handler just serves the held string
- [ ] ./src/ui/Server.test.ts#431 — two requests, exactly one tsdown invocation
      Behaviour change for developers: editing the client under `--dev` now
      needs a server restart. Documented at the two doc comments.

## Notes and free text write through without a Save tap

Typing now commits on its own 800ms after the last keystroke, on blur, and on
unmount. Motive: closing the tab or locking the screen without tapping Save
discarded whatever was typed. Each writer keeps one in-flight write with a
single pending slot, so a fast typist produces one write per pause.

- [ ] ./src/web/screens/Question.tsx#213 — `FREE_TEXT_DEBOUNCE_MS`,
      `runCommitFreeText`'s serialization, and the unmount flush
- [ ] ./src/web/screens/Question.tsx#460 — the commit guard moves from "is the
      text empty" to "did it change since last commit", so deleting an answer
      now writes the erase
- [ ] ./src/web/NoteSheet.tsx#34 — `onAutoSave`, a write path separate from
      `onSave` that never dismisses the sheet, with the identical
      debounce/blur/unmount trio
- [ ] ./src/web/screens/Review.tsx#161 — `autoSaveNote`: same optimistic update
      and revert as `saveNote`, but rethrows The rethrow is load-bearing.
      `NoteSheet`'s `runAutoSave` rolls its `lastAutoSavedRef` back only on
      rejection; swallowing the error would leave that ref pointing at
      never-written text and permanently skip later commits.
- [ ] ./src/web/screens/Plan.tsx#358 — the same wiring on the Plan side,
      rethrowing for the same reason
- [ ] ./src/web/NoteSheet.stories.tsx#290 — debounce-with-no-blur, and a refused
      autosave retrying on the next blur
- [ ] ./src/web/screens/Question.stories.tsx#335 — debounce commit,
      erase-on-blur, and refused-write retry

## Stale rejections can no longer clobber newer writes

Revert-on-rejection was keyed on a whole-state snapshot (Question) or a full map
(Review). Tick A, tick B, A's write fails — and B vanished too. Reverts are now
gated by a sequence number, per field in Question and per hunk key in Review,
held in refs so bumping never renders.

- [ ] ./src/web/screens/Question.tsx#240 — per-field
      `selectedSeqRef`/`freeTextSeqRef`; `commitAnchor` takes a `reverts` list
      and applies only entries still on the latest seq Per field, not per
      anchor, because `selected` is one shared radio slot across every option's
      own anchor.
- [ ] ./src/web/screens/Review.tsx#112 — `seqRef` map plus `nextSeqFor`;
      `toggleChunk` bumps one seq per hunk beneath the chunk, `setHunkChecked`
      just its own key
- [ ] ./src/web/screens/Question.stories.tsx#447 — a rejected tick leaves a
      later tick on another option standing; same for a rejected free-text write
      vs a later radio tick
- [ ] ./src/web/screens/Review.stories.tsx#219 — the same for two hunks

## Refusals and save status are visible on screen

Every refused write previously just reverted silently. There is now one
`role="status" aria-live="polite"` banner per screen, carrying one sentence per
refusal reason plus `Saving…`/`Saved`, mounted above both Plan and Review.

- [ ] ./src/web/Refusal.tsx#1 — `useRefusal` + `RefusalBanner`: six named
      reasons, a generic seventh for an unreadable error, never `error.message`
      `trackSave` settles to `"saved"` only on a genuine resolve, and a
      rejection's reset to idle won't clobber a newer success. `dismiss` clears
      only the refusal, not the save status.
- [ ] ./src/web/screens/Plan.tsx#552 — banner mounted, `onRefusal` threaded
      down, and only the tick/note paths wrapped in `trackSave` `onDoneNote` is
      excluded because a successful `done` unmounts the screen before "Saved"
      could show.
- [ ] ./src/web/screens/Review.tsx#517 — the same on Review
- [ ] ./src/web/App.tsx#26 — App never returns `null` again: loading, query
      error, broken, moved-on, and unrenderable each render something A blank
      white screen on a phone over a tailnet was the regression this closes.
- [ ] ./src/web/screens/Question.tsx#110 — the free-text textarea gets a real
      `<label htmlFor>` via `useId`; `NoteSheet.tsx#146` gets the same
- [ ] ./src/web/screens/Plan.tsx#458 — `HandedBackPanel` announced through a
      live region on both screens
- [ ] ./src/web/App.stories.tsx#84 — stories for the message, broken, moved-on
      and loading branches

## Erasing a free-text answer keeps the option writable

An erase used to write an empty label (`- [ ] ` with nothing after the marker),
which `optionContentOffset` can find no content offset for — breaking that
anchor's own `apply` forever with `anchor-not-found`. It now writes the
placeholder, which `parseOptions` already reads back as `""`.

- [ ] ./src/OpenQuestions.ts#914 — `normalizeFreeTextAnswer` returns
      `FREE_TEXT_PLACEHOLDER` for empty input
- [ ] ./src/OpenQuestions.test.ts#1823 — the full erase-then-retype round trip a
      human on a phone depends on

## Housekeeping: graft tooling and stale fallow comments removed

The graft index integration is deleted wholesale from this repo's agent tooling,
and the boilerplate "fallow's static CRAP estimate only sees real coverage
reports" paragraph is stripped from eight doc comments where it said nothing
about the code. No source references to graft remain.

- [ ] ./.claude/settings.json#28 — graft hooks, statusline, permissions and
      footer regex removed
- [ ] ./.mcp.json#1 — the graft MCP server entry deleted along with the file
- [ ] ./.claude/skills/graft/SKILL.md#1 — the skill and both helper scripts
      deleted
- [ ] ./.gitignore#56 — the `/graft/` ignore and the whole `.ignore` file
      dropped
- [ ] ./src/web/Deck.tsx#40 — representative fallow-comment strip; same edit in
      `Mic.tsx`, `Hunk.tsx`, `Plan.tsx`, `Question.tsx`, `Review.tsx`

## Steering-file paths in the features were wrong

Feature scenarios asserted `PLAN.md` at the repo root, but a workflow's `file:`
is relative to `.gtd/`, so the served file is `.gtd/PLAN.md`. Every affected
assertion and handoff step is corrected.

- [ ] ./tests/integration/features/ui-lifecycle.feature#127 — `.gtd/PLAN.md` in
      the handoff and setValue scenarios, with the reason stated inline
- [ ] ./tests/integration/support/steps/ui-lifecycle.steps.ts#36 — the close
      step replaced by the reload-then-handoff step
- [ ] ./.gtd/REVIEW.md#1 — the previous round's review document is deleted, as
      expected; this file replaces it
