# 03 — Every refusal reaches the human, and nothing typed is silently lost

This package carries two requirements. They are stated independently below and
reviewed independently, and they are built together because they collide inside
the same hunks: "every refusal reaches the human" and "revert-on-rejection
restores a stale snapshot" are two changes to the identical
`.catch(() => revert(previous))` handlers in `src/web/screens/Question.tsx#247`
and `src/web/screens/Review.tsx#148`.

## Requirement A

PRODUCT. **Every write refusal is now invisible.** The `doneRefused` banners are
deleted from both screens, `onDoneNote` swallows every error
(`.catch(() => {})`, `src/web/screens/Plan.tsx#497`), and
`onSetValue`/`commitAnchor` catch and silently revert. A `stale-token` on a tick
makes the checkbox flick back with **zero explanation**. This is a regression
against the base commit, which showed one banner.

`writeRefusalFrom` and `WriteRefusalInfo` (`src/web/api.ts#33`) survive and name
exactly the six refusal reasons, with **no caller anywhere in `src/web`** —
their only consumer was the deleted `drafts.ts`. Wire them to a banner, or
delete them with their tests; `fallow` currently scores them live only through
`api.test.ts`.

**A blank white screen is the universal failure mode.** `src/web/App.tsx#28`
returns `null` for query-in-flight, query error, dead server and file-less step
alike — no spinner, no error surface, no `aria-busy`. First paint on a phone
over a tailnet is a blank page. `mode={step.mode ?? ""}` (`App.tsx#36`) forwards
an empty mode into `readSteeringFile` and every mutation, whose
`unsupported-mode` refusal then displays nothing.

Accessibility rides in the same work: `HandedBackPanel`
(`src/web/screens/Review.tsx#429`) is a bare `div` with no
`role="status"`/`aria-live`, so the one state change that matters most is
unannounced; the free-text textarea has a placeholder and no label; and
blur-to-commit has no saving/saved affordance, which on touch means blur is
invisible and the human cannot tell whether the answer landed.

Delete, do not move, the "why fallow scores this untested" paragraph now copied
into six files (`Deck.tsx#41`, `Mic`, `Plan` ×3, `Review` ×2, `Hunk`,
`Question`) — one shared note became six near-identical ones.

**Acceptance**: a story where `setValue` rejects with `stale-token` asserts a
visible, named reason on screen, and a story where `trpc.step` is in flight
asserts something other than an empty document. Both fail today.
`Question.stories.tsx` is untouched by the branch, so `onCommitAnswer` has no
coverage at its own layer; it gains it here.

## Requirement B

PRODUCT. **`pagehide` fires on reload, not only on close — so pull-to-refresh on
the phone kills `gtd ui`.** `src/web/main.tsx#18` beacons `POST /close`, and
`/close` responds 204 and calls `endServer()` immediately with none of
`handOff`'s grace. The reload lands on a dead port and a blank page. On iOS
Safari, `visibilitychange`/`hidden` from an app switch or a screen lock is a
further false-positive candidate for the same beacon. Two stories claim the
opposite and prove only that a fresh React mount reads `checked` back off the
server — they mock away the very process a real reload has just terminated
(`Plan.stories.tsx#718`, `Review.stories.tsx#711`), so package 03's "survives a
page reload" acceptance is satisfied only against a mock.

**Free text is lost if the textarea is never blurred.**
`src/web/screens/Question.tsx#118` commits on blur only, and `NoteSheet.tsx#47`
holds note text in plain `useState` with no autosave at all. Tab close, screen
lock, or an unmount without a blur event discards it — and `drafts.ts`, the
local persistence layer, is deleted. Combined with the beacon, one mis-tap on
refresh discards in-flight typing **and** ends the session.

**An answer cannot be cleared.** `Question.tsx#264` returns early on empty text,
so deleting a previously written free-text answer and blurring leaves the old
text on disk while the UI shows an empty textarea — silent divergence. The guard
is right for a mis-tap and wrong for a deliberate erase, and no gesture
distinguishes them today.

**Revert-on-rejection restores a stale snapshot.** `Question.tsx#247` captures
`previous` at call time and `Review.tsx#148` captures a `previous` Map; a slow
rejection restores it wholesale, clobbering anything the human did in the
interim. Tick A, tick B, A's write fails, B's tick vanishes too — realistic on a
flaky tailnet.

**Acceptance**: a real-process `ui-lifecycle` scenario that reloads the page and
then completes a hand-off — the server is still alive and exits 0 through
`done`, not through the beacon. Plus the positive free-text path as a story —
type, blur, exactly one `setValue` carrying `checked` and `text` together —
which has no coverage anywhere despite being package 03's stated acceptance. The
beacon is registered at module top level in `main.tsx` and so is not injectable;
it moves behind something a story can drive.

## Paths

`src/web/App.tsx`, `src/web/api.ts`, `src/web/main.tsx`,
`src/web/NoteSheet.tsx`, `src/web/screens/Question.tsx`,
`src/web/screens/Review.tsx`, `src/web/screens/Plan.tsx`,
`src/web/screens/Hunk.tsx`, `src/web/Deck.tsx`, `src/web/Mic.tsx` and their
stories, plus a new `src/web/Refusal.tsx`; `src/ui/Server.ts` (the close
endpoint only); `tests/integration/features/ui-lifecycle.feature`.

## Task 1 — One refusal surface, seven sentences

`writeRefusalFrom` and `WriteRefusalInfo` are kept and finally get real callers,
rather than deleted with their tests.

- [ ] New `src/web/Refusal.tsx` exports a `RefusalBanner` and a `useRefusal()`
      hook holding the current refusal
- [ ] One sentence per reason: `stale-token` (naming which token moved),
      `not-resting`, `file-vanished`, `anchor-unresolved`, `note-collision`,
      `unsupported-mode`
- [ ] A seventh generic sentence for an error `writeRefusalFrom` cannot read — a
      network failure or a dead server — which today produces the same silence
- [ ] The banner carries `role="status" aria-live="polite"` and a dismiss
      control
- [ ] It sits at the top of both `Plan` and `Review`
- [ ] Every `.catch(() => revert)` in `Question.tsx`, `Review.tsx` and
      `Plan.tsx` reverts AND shows
- [ ] `onDoneNote`'s `.catch(() => {})` shows the reason; it may still never
      rethrow, because `NoteSheet`'s `onDone` is not awaited
- [ ] A story where `setValue` rejects with `stale-token` asserts a visible,
      named reason on screen

## Task 2 — `App.tsx` never returns `null`

- [ ] Five branches, each rendering something: in-flight (`aria-busy="true"`
      skeleton), query error (named failure), `status: "broken"` (the `detail`
      verbatim), a rest that has moved on (the turn is over, the server is
      exiting), and the openable rest
- [ ] The `openable` predicate requires `mode !== undefined` as well as `file`
- [ ] `mode={step.mode ?? ""}` is deleted rather than papered over, so an empty
      mode can no longer reach `readSteeringFile` and produce an invisible
      `unsupported-mode`
- [ ] A story with `trpc.step` in flight asserts a non-empty document

## Task 3 — Accessibility

- [ ] Both `HandedBackPanel` copies get `role="status" aria-live="polite"`
- [ ] The free-text textarea gets a real label alongside its placeholder
- [ ] The note sheet's textarea gets a real label
- [ ] The commit path gets a live "Saving…" / "Saved" affordance announced
      through the same `aria-live` region, so a blur that is invisible on touch
      still reports whether the write landed

## Task 4 — Delete the six copied comment paragraphs

- [ ] All six copies of the "why fallow scores this untested" paragraph are
      deleted — `Deck.tsx#41`, `Mic`, `Plan` ×3, `Review` ×2, `Hunk`, `Question`
- [ ] None is consolidated into a seventh shared note
- [ ] The machine-read `// fallow-ignore-next-line` pragmas stay — tooling reads
      those

## Task 5 — Free text commits without a blur: debounced write-through

The text lands in the real file. No `localStorage` draft layer, so no draft can
diverge from the steering file.

- [ ] 800ms after the last keystroke, `Question.tsx`'s free-text slot fires the
      same commit its blur handler fires
- [ ] `NoteSheet.tsx`'s note body fires on the same 800ms debounce
- [ ] Serialized trailing-edge: never two writes in flight for one anchor — a
      commit issued while one is pending replaces the queued text and fires once
      the pending one settles, so a fast typist produces one write per pause,
      not one per keystroke
- [ ] Blur still commits
- [ ] Unmount commits
- [ ] The compare-and-swap tokens the mutations already refetch on settle carry
      the next write; no new persistence layer is added
- [ ] A story asserts a typed-but-never-blurred answer commits on its own once
      the debounce elapses
- [ ] **Risk, blunt**: this puts a `setValue` on the tailnet at every typing
      pause, each one spawning a `gtd next --json` through `verifyForWrite`'s
      `actorAt` — the uncapped subprocess amplification this branch accepts now
      has a caller that fires on a timer, not on a tap

## Task 6 — Replace the empty-text guard so an answer can be cleared

- [ ] The guard moves off "is the text empty" onto "did the text change from
      what was last committed"
- [ ] A bare focus-then-blur still writes nothing
- [ ] Deleting an existing answer writes the erase
- [ ] Clearing sends `text: ""` with `checked: false`
- [ ] `src/OpenQuestions.ts`'s `apply` treats that as an erase of both — if it
      cannot express that today, extending `QA_FORMAT.apply` is part of this
      package, not a follow-up
- [ ] A story asserts a previously written answer, deleted and committed, leaves
      no text on disk

## Task 7 — Revert-on-rejection stops clobbering

- [ ] No handler snapshots whole state any more
- [ ] Each write is stamped with a per-anchor sequence number held in a ref
- [ ] A rejection reverts a key only when the failed write is still the latest
      issued for that key
- [ ] `Question.tsx#247`'s whole-`answer` snapshot is gone
- [ ] `Review.tsx#148`'s `previous` Map is gone
- [ ] A story asserts a rejected write for anchor A leaves a later tick on
      anchor B standing

## Task 8 — Delete the beacon and the close endpoint outright

No heuristic remains that could mistake a reload, an iOS app switch or a screen
lock for a close, because no heuristic remains at all.

- [ ] `src/web/main.tsx`'s top-level `pagehide` listener is deleted
- [ ] `src/ui/Server.ts`'s `CLOSE_PATH` constant, its handler branch and its doc
      comment are deleted
- [ ] The end-of-life resolve helper stays, called only by `handOff` and by the
      moved-on detection
- [ ] Nothing listens to `visibilitychange`, then or now
- [ ] No config key is added — `src/ConfigSchema.ts`, its `uiJsonSchema` and
      `docs/cli.md` stay untouched by this package
- [ ] `gtd ui` then ends through exactly two doors: `done`, or a signal. The
      outer loop that spawned it owns killing it
- [ ] **Risk, blunt**: an abandoned tab leaves the port bound and the process
      alive until something signals it — a `gtd ui` started by hand and then
      forgotten needs a Ctrl-C the beacon used to spare the human

## Task 9 — Rework the lifecycle scenarios and the two mocked reload stories

- [ ] The "closing the UI without handing off exits 0" scenario in
      `tests/integration/features/ui-lifecycle.feature` is deleted, along with
      its `I close a spawned gtd ui without handing off` step — both describe a
      path that no longer exists. Deleting a green scenario is deliberate here,
      not collateral
- [ ] A real-process `@live` scenario loads the client, re-requests it (a
      reload), then hands off, exiting 0 through `done` — it passes trivially
      once the beacon is gone, and pins that against a future re-introduction
- [ ] `Plan.stories.tsx#718` and `Review.stories.tsx#711` are rewritten or
      deleted — they prove only that a fresh React mount re-reads the server

## Task 10 — `Question.stories.tsx` gains its first commit coverage

- [ ] Type, blur, exactly one `setValue` carrying `checked` and `text` together
- [ ] The file is no longer untouched by the branch, and `onCommitAnswer` has
      coverage at its own layer
