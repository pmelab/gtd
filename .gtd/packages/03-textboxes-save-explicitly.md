# 03 — Textboxes store on an explicit Save, never on type

## Requirement

Both textareas debounce writes at 800 ms and flush on blur and on unmount. All
three write paths go: `FREE_TEXT_DEBOUNCE_MS` and `commitFreeTextOnBlur` in the
free-text answer slot (`src/web/screens/Question.tsx#168`, `#362`),
`NOTE_DEBOUNCE_MS` and its blur/unmount flush in the note sheet
(`src/web/NoteSheet.tsx#14`, `#119`, `#142`). Typing updates local state and
nothing else.

The note sheet already has a Save button. The question view has no buttons at
all, so the free-text slot needs one added — this requirement is an addition,
not just a deletion. Its answer state is controlled by the parent's `answers`
map (`src/web/screens/Plan.tsx#317`), so the draft has to live somewhere that a
keystroke can touch without a write.

Text left unsaved is discarded. Leaving the view loses it — no draft that
survives navigation, no restore on reload. Save is the only write, taken
literally, so there is no persistence layer to build here.

Radio option selection keeps writing through immediately. The rule is about
textboxes; do not slow the radios down.

## Task 1 — Delete the note sheet's autosave, and both of its wiring sites

`src/web/NoteSheet.tsx` loses `NOTE_DEBOUNCE_MS` (`#14`), the `onAutoSave` prop
and its doc comment (`#44`, `#61`), `runAutoSave` (`#73`), `scheduleAutoSave`
(`#110`), `clearDebounceTimer` (`#103`), the unmount `useEffect` (`#119`), the
textarea's `onBlur` handler (`#142`), the `scheduleAutoSave()` call inside
`onChange` (`#140`), and the `lastAutoSavedRef`/`inFlightRef`/`pendingRef`/
`debounceTimerRef` set (`#66`, `#69`–`#71`). The `useEffect` import goes with
them.

Both wiring sites go with it, in the same change — nothing may keep passing a
prop that no longer exists: `src/web/screens/Plan.tsx#367`'s `onAutoSave` block
with its rethrow-on-rejection comment, and `src/web/screens/Review.tsx`'s
`autoSaveNote` (`#179`, `#291`) plus its `onAutoSave={state.autoSaveNote}` pass
(`#487`).

The Save button (`#179`) keeps its exact behaviour — write, then dismiss — minus
the two now-dead lines that cleared the timer and primed `lastAutoSavedRef`.
`Save & Done` (`#191`) likewise.

Paths: `src/web/NoteSheet.tsx`, `src/web/NoteSheet.stories.tsx`,
`src/web/NoteSheet.test.ts`, `src/web/screens/Plan.tsx`,
`src/web/screens/Plan.stories.tsx`, `src/web/screens/Review.tsx`,
`src/web/screens/Review.stories.tsx`.

- [ ] a story types into the note sheet's textarea and asserts no mutation fired
      — not after any elapsed time, not on blur
- [ ] a story types, then unmounts the sheet, and asserts no mutation fired
- [ ] a story types, taps Save, and asserts exactly one write landed carrying
      the typed text, and the sheet dismissed
- [ ] `Save & Done` still writes the note and hands the turn back, one write
- [ ] no file references `onAutoSave`, `autoSaveNote`, `NOTE_DEBOUNCE_MS`, or
      `lastAutoSavedRef`
- [ ] `npm run deadcode` reports no unused export

## Task 2 — Delete the free-text slot's debounce and its serialization

`src/web/screens/Question.tsx` loses `FREE_TEXT_DEBOUNCE_MS` (`#168`),
`scheduleDebouncedCommit` (`#368`), `clearDebounceTimer` (`#354`),
`debounceTimerRef` (`#337`), the unmount-commit `useEffect` (`#383`), and the
whole in-flight/pending serialization — `commitFreeTextRef` (`#333`),
`commitInFlightRef` (`#335`), `commitPendingRef` (`#336`), `runCommitFreeText`
(`#339`). A deliberate tap cannot race a timer that no longer exists. The
`useEffect` import goes with them. `setFreeText` (`#377`) keeps only its local
state update.

`commitFreeText` (`#287`) survives, unchanged in body, now called only from Task
3's Save tap. Its changed-since-last-commit guard goes (`#288`–`#290`): an
explicit tap always writes. `lastCommittedFreeTextRef` (`#211`) goes with it,
including the `previousLastCommitted` capture (`#300`) and the `onReverted`
rollback half of its revert entry (`#308`–`#312`).

The per-field seq/revert machinery stays as-is (`#205`–`#209`, `#260`–`#285`) —
a Save's write can still be refused, and it still touches both `selected` and
`freeText`. Radio options are untouched: `setSelected` (`#280`) still writes
through on tap.

Paths: `src/web/screens/Question.tsx`, `src/web/screens/Question.stories.tsx`.

- [ ] a story types into the free-text textarea and asserts no mutation fired —
      not after any elapsed time, not on blur
- [ ] a story types, then unmounts the question, and asserts no mutation fired
- [ ] a story taps a radio option and asserts the write fired immediately, with
      no Save tap
- [ ] a story taps a radio option whose write is refused and asserts the
      selection reverts, and that a later free-text Save's refusal does not
      revert an already-landed radio tick
- [ ] no file references `FREE_TEXT_DEBOUNCE_MS`, `runCommitFreeText`,
      `commitFreeTextOnBlur`, or `lastCommittedFreeTextRef`

## Task 3 — The Save button, and the draft that dies with the component

**The draft moves out of the parent's `answers` map into `Question`'s own
`useState`, seeded from `defaultAnswerFor(node).freeText`
(`src/web/screens/Question.tsx#34`).** This inverts the controlled-state design
deliberately, and the acceptance below is why: "types, navigates away, returns,
box is empty" is only true if the draft dies with the component. `Deck`'s
`renderItem` remounts a fresh `Question` per index, so a local draft is
discarded on navigate-away — exactly "leaving the view loses it".

`selected` stays in the parent map (`src/web/screens/Plan.tsx#317`, `#421`,
`#424`), because radios still write through immediately and their tap feedback
must survive paging. `QuestionAnswer` (`#12`) shrinks to `{ selected }`.

**The addition:** a Save button inside `FreeTextOption` (`#84`), below the
textarea, `data-testid="free-text-save"`, styled like the note sheet's own Save.
It calls `commitFreeText` and does not navigate — ending a view is Done's job.

Paths: `src/web/screens/Question.tsx`, `src/web/screens/Question.stories.tsx`,
`src/web/screens/Plan.tsx`, `src/web/screens/Plan.stories.tsx`.

- [ ] a story types into the free-text textarea, taps Save, and asserts exactly
      one write landed carrying the typed text
- [ ] after Save, the human stays on the question screen — no navigation, no
      deck advance
- [ ] a story types, navigates away from the question, returns to it, and
      asserts the textbox is empty
- [ ] a story picks a radio option, pages to the next question and back, and
      asserts the selection survived
- [ ] a story clears previously-saved text and taps Save, and asserts the erase
      wrote through (`checked: false`, empty text) rather than leaving stale
      text on disk
- [ ] `npm test` green
