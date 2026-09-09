# Package 03 — spec feedback

Tasks 1, 2, 6 (client half), 7 (Question half) and 10's harness are in. Tasks 4,
8 and 9 are entirely undone, Tasks 3, 5 and 7 are half-done, and two acceptance
stories assert nothing at all.

## 1. Task 8 is not started — the beacon and `/close` are still live

- `src/web/main.tsx:18-20` still registers the top-level `pagehide` listener and
  still fires `navigator.sendBeacon("/close")`. Pull-to-refresh still kills
  `gtd ui` — the package's whole Requirement B.
- `src/ui/Server.ts:44-45` still declares `CLOSE_PATH` with its doc comment, and
  `:483-489` still special-cases `POST /close` to resolve end-of-life.
- `src/ui/Server.test.ts:1019-1060` still pins both behaviours (two tests) —
  they must go with the endpoint.
- `src/web/generated.html:22371` carries the beacon in the built bundle; rebuild
  after the delete.
- Task 8 also asks that the end-of-life resolve helper stay, reachable only from
  `handOff` and moved-on detection — check `Server.ts:399-416`'s comments, which
  name `CLOSE_PATH` three times.

## 2. Task 9 is not started

- `tests/integration/features/ui-lifecycle.feature:200-244` — "closing the UI
  without handing off exits 0 and writes no note" is still present and still
  `@live`. Spec: delete it.
- `tests/integration/support/steps/ui-lifecycle.steps.ts:36-40` — the
  `I close a spawned gtd ui without handing off` step, and
  `tests/integration/support/world.ts:664-680`'s `spawnGtdUiAndClose`, still
  exist. Delete both with the scenario.
- No new `@live` scenario loads the client, re-requests it (the reload) and then
  hands off. That scenario is the package's only real-process acceptance for
  Requirement B; it is missing.
- The two mocked reload stories are untouched:
  `src/web/screens/Plan.stories.tsx:718`
  (`RealContainerAnAnsweredOptionSurvivesAPageReload`) and
  `src/web/screens/Review.stories.tsx:711`
  (`RealContainerAHunkTickSurvivesAPageReload`). Rewrite or delete.

## 3. Task 4 is not started — all the copied paragraphs remain

The "fallow's static CRAP estimate only sees real coverage reports" paragraph is
still in eight places: `src/web/Deck.tsx:41`, `src/web/Mic.tsx:46`,
`src/web/screens/Plan.tsx:64`, `:102`, `:302`, `src/web/screens/Review.tsx:284`,
`:378`, `src/web/screens/Hunk.tsx:85`. Only the `Question.tsx` copy is gone.
Delete the rest; keep the `// fallow-ignore-next-line` pragmas.

## 4. Task 3 is half-done

- Neither `HandedBackPanel` got `role="status" aria-live="polite"`:
  `src/web/screens/Plan.tsx:436` and `src/web/screens/Review.tsx:437` are still
  bare `div`s. Both bullets unmet.
- `src/web/NoteSheet.tsx:62-73` — the note textarea still has no label (no
  `<label htmlFor>`, no `aria-label`, and unlike `Question.tsx`'s free-text
  slot, not even a placeholder).
- The "Saving…" / "Saved" affordance never renders: `useRefusal`'s `trackSave`
  (`src/web/Refusal.tsx:63-72`) has **zero callers** in `src/` — no mutation
  wrapper in `Plan.tsx` or `Review.tsx` passes its promise through it, so
  `saveStatus` is permanently `"idle"` and `RefusalBanner`'s two save branches
  are dead. Wire `trackSave` around `onCommitAnswer`/`onSaveNote`/`onSetValue`
  (both screens), or the affordance the blur-on-touch bullet exists for does not
  exist.

## 5. Task 5 is half-done — `NoteSheet` got nothing

`src/web/NoteSheet.tsx:47` still holds the note body in a bare
`useState(note ?? "")` with no debounce, no unmount commit, and no write path at
all except the Save / Save & Done button taps. Required by Task 5's second
bullet ("`NoteSheet.tsx`'s note body fires on the same 800ms debounce") and by
Requirement B's "Tab close, screen lock, or an unmount without a blur event
discards it". `Question.tsx:303-380` implements the pattern correctly —
including the unmount flush its own comment claims "mirrors `NoteSheet.tsx`'s
identical unmount-commit", which does not exist. Fix the code, not the comment.

## 6. Task 7 is half-done — `Review.tsx` still snapshots whole state

- `src/web/screens/Review.tsx:153` still builds
  `const previous = new Map(hunks.map(...))` and `:169` still restores every
  hunk under the chunk from it. Task 7 says that Map is gone.
- `Review.tsx` has no per-anchor sequence ref at all — `setHunkChecked`
  (`:176-184`) reverts unconditionally (`!checked`), so tick A → tick B on the
  same hunk with A rejecting late still clobbers B. Only `Question.tsx`'s
  `seqRef` (`:236-260`) implements the bullet.
- No story asserts "a rejected write for anchor A leaves a later tick on anchor
  B standing" (`Review.stories.tsx` has no such export).

## 7. Two acceptance stories are vacuous — they assert nothing

- `src/web/screens/Question.stories.tsx:274`
  (`TypingThenBlurringCommitsOnceWithCheckedAndTextTogether`) declares
  `args: { node }` only, so its locally-built `onCommitAnswer` is **never passed
  to the component**; `calls` stays empty and the assertion is
  `expect(calls.length).toBeGreaterThanOrEqual(0)` followed by
  `void onCommitAnswer`. Task 10's "exactly one `setValue` carrying `checked`
  and `text` together" is unproven — and the harness already accepts
  `args.onCommitAnswer` (`:74-84`), so wiring it is one line.
- `src/web/screens/Question.stories.tsx:309`
  (`TypedTextCommitsOnItsOwnAfterTheDebounceWithNoBlur`) has the same dead
  `calls` array and asserts only the local `question-status` text after the
  timers advance. It cannot fail if the debounced commit never fires; it does
  not cover Task 5's story bullet.

## 8. Task 1's and Task 6's acceptance stories are missing

- No story anywhere renders a rejected `setValue` with a `stale-token` refusal
  and asserts the named reason on screen — `refusal-banner`/`refusal-message`
  appear in no `*.stories.tsx` file. `Refusal.tsx`'s seven sentences and its
  dismiss control have no test at any layer.
- No story asserts "a previously written answer, deleted and committed, leaves
  no text on disk" (Task 6's last bullet).

## 9. Erasing a free-text answer destroys its anchor — `QA_FORMAT.apply` bug

Probed directly against `src/OpenQuestions.ts#questionsApply`, on
`## Open Questions / ### Which API? / - [ ] REST / - [x] my typed answer`:

- `apply(..., {checked: false, text: ""})` writes `- [ ] ` — an empty label with
  a **trailing space**.
- The very next `apply` on that same option anchor returns
  `{ok: false, reason: "anchor-not-found"}`: with no content on the line,
  `optionContentOffset` yields `undefined`, the item stops parsing as an option,
  and the free-text slot is permanently unwritable from the phone. The human
  erases an answer and can never type a new one — silent `anchor-unresolved`
  refusals from then on.
- The trailing space also breaks AGENTS.md's "`.gtd/` is formatted, not ignored"
  rule: a server-written steering file that is not an oxfmt fixed point reds
  every gate that runs the suite.

Erase must restore `FREE_TEXT_PLACEHOLDER` (`- [ ] _your answer_`), which
`parseOptions:283` already normalizes back to `""` on read — that satisfies
"erase of both" without killing the anchor. Add a unit test on the erase →
retype round trip; nothing in `OpenQuestions.test.ts` exercises
`{checked: false, text: ""}` today.
