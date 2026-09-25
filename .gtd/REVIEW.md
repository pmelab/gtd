# Review: 33f2e99

<!-- base: 56f2bda1311831bd1475a9b514ca456136b15415 -->

This range covers three shipped features plus their docs: the judge-payload
truncation trailer, a new qualitative review lap in the bundled workflow, and a
full rework of the phone UI. Read chunk 2 first — it carries the one behaviour
change that costs you coverage today.

## Truncation is now stamped on the landing commit, not re-measured from disk

The three gates that had to know "was the judged evidence cut?" measured the
WORKING TREE's byte length. That measures the wrong document: the judgment was
made against the committed file, so shrinking it before `gtd judge answer` lands
made the gate see an under-budget file and trust a verdict formed on truncated
evidence. Now the same render that produced the judged document reports its own
ledger flag, and `gtd judge answer` stamps `Gtd-Payload: {"truncated":true}`.

- [ ] ./src/Edge.ts#999 — `RenderedRest.truncated`, read off the ledger after
      the content render
- [ ] ./src/program.ts#525 — threads it into `planLanding`; plain `gtd land`
      never passes it
- [ ] ./src/step/planStep.ts#78 — emits the trailer only when true, so absence
      reads as "not truncated"
- [ ] ./src/workflows/unified.yaml#1514 — `build.review.triaging` reads the
      trailer off HEAD instead of `wc -c`
- [ ] ./src/workflows/unified.yaml#1825 — same swap in
      `packages.item.spec.scoping`
- [ ] ./src/workflows/unified.yaml#2536 — new: `architecture-promote` refuses
      outright on a truncated payload, leaving the tree clean so the `"C"` row
      routes to the full architecture pass This is the one of the three that
      changes routing rather than just a flag. The `"C"` row's comment flipped
      from "unreachable in practice" to "reachable now" — worth confirming you
      want a truncated requirements doc to always pay for a full architecture
      pass.
- [ ] ./docs/driver.md#252 — the trailer is now part of the required half of the
      landing script's contract

## The new quality-review lap — and the coverage it silently drops

A new `qualityReview` machine runs one configured skill per turn, each its own
context, appending blocking findings to `.gtd/QUALITY.md`, then a sibling
`fix-quality` turn fixes them once. Two things to check before signing off.

- [ ] ./src/workflows/unified.yaml#90 — **`reviewSkills` dropped from three
      skills to one.** `security-and-hardening` and `code-simplification` were
      removed from `build.review.reviewing` (line 1167) and moved into
      `qualityReviews`
- [ ] ./src/workflows/unified.yaml#2233 — but the lap hangs off
      `buildTail.health`'s green route, which an ordinary round never reaches:
      `packages` hands `onDrained: build.review` directly (line 2565). Only
      `gtd --entry fix-precheck` reaches it Net effect: on the normal path, a
      review that used to load three lenses now loads one, and the other two run
      nowhere. `docs/configuration.md` states this scoping honestly, so it may
      be intended — but it is a real reduction in review coverage for every
      ordinary round, and it is not called out as one.
- [ ] ./src/workflows/unified.yaml#2119 — **`QUALITY_DONE.md` is never swept on
      the fix-precheck path.** `seeding` short-circuits on it, and the only `rm`
      for it is `packages.picking` (line 1946), which `fix-precheck` never
      visits So the SECOND and every later `gtd --entry fix-precheck` in a
      repository skips the lap entirely and silently — the committed marker from
      the first episode is still there. The comment at line 2101 calls the guard
      "per EPISODE", but on this path an episode never ends. No scenario covers
      a repeat run.
- [ ] ./src/workflows/unified.yaml#2137 — `picking` routes on
      `A`/`M .gtd/NEXT_REVIEW.md`; two consecutive queue entries with the SAME
      lens name make `cp` a no-op, so neither row matches and the lap exits
      early through `"* **": $onClean`
- [ ] ./src/workflows/unified.yaml#2122 — `qualityReviews` is interpolated raw
      into `list="..."` and run under `sh -c`. The comment argues this is fine
      because `testCommand` already does it. Agreed in principle; flagging so it
      is a decision you made, not one you inherited
- [ ] ./src/workflows/unified.yaml#2244 — `fix-quality` deletes `QUALITY.md` and
      hands to `health.check`, with no re-review after the fix (by design, per
      the README)
- [ ] ./src/workflows/unified.yaml#1946 — the feedback loop-back sweep grows
      `.gtd/QUALITY*.md`, `NEXT_REVIEW.md` and `rm -rf .gtd/reviews`
- [ ] ./docs/setup.md#67 — "Extending the quality-review lap", including the
      honest warning that a typo'd lens burns a whole turn silently
- [ ] ./docs/configuration.md#452 — `qualityReviews` entry, naming the
      fix-precheck-only reach

## Render-ledger and template-parse corrections

Two independent correctness fixes in the budget machinery.

- [ ] ./src/PatternTemplates.ts#205 — the running total accumulates the RAW
      share, not floored bytes: two `0.51` shares used to floor to the same byte
      count at a small budget and slip past the refusal. Tolerance is `1 + 1e-9`
      for float summation
- [ ] ./src/PatternMachine.ts#1160 — the `it.sections(...)` second-argument walk
      now skips quoted literals, so `it.sections('notes, 2026.md')` stops being
      flagged. A comma inside a backtick `${...}` is deliberately under-flagged,
      backstopped at render time
- [ ] ./src/workflows/unified.yaml#613 — the feedback-comparability guard now
      compares `stripStamp` of both whole reports instead of their byte lengths;
      two equal-length-but-different reports no longer force "not comparable"

## Blockquote text extraction

- [ ] ./src/steering/Blocks.ts#64 — `blockquoteChildrenText` splits off from
      `childrenText`, stripping line-leading `> ` continuation markers from the
      RAW slice before whitespace collapse Scoped to blockquotes only, so a list
      item's fenced code keeps a literal `>`. One residual edge: a fenced code
      block INSIDE a blockquote whose own content starts a line with `>` still
      loses it. Probably fine; confirm.
- [ ] ./src/steering/Blocks.ts#160 — the `fullText` walk option is gone,
      dropping raw-source `block.text` and the `paragraph` fallback for
      `table`/`html`/`thematicBreak`. Those now render through `title` alone

## Free-form is read-plus-note only

Per-block edit, delete, append and the whole `localStorage` draft store are
removed. What remains: notes on any block, plus one textfield when the document
is empty.

- [ ] ./src/steering/freeform.ts#98 — `apply` now ONLY appends; an anchor on a
      real block start refuses `anchor-not-found`
- [ ] ./src/web/screens/FreeForm.tsx#42 — `EmptyDocumentCapture`: bare
      textfield, single Save, no `autoFocus` (iOS refuses programmatic focus).
      Typed text lives in React state alone — an accepted, documented loss on
      tab eviction
- [ ] ./src/web/screens/FreeForm.tsx#161 — `filePath: _filePath` is now unused
      inside the view but still required by `FreeFormViewProps`. Dead prop; drop
      it or keep it deliberately
- [ ] ./src/web/screens/FreeForm.tsx#73 — note sheet extracted, sharing
      `notes.ts`
- [ ] ./src/web/notes.ts#33 — `optimisticNoteSave`, the shared
      show-then-revert-on-refusal handler all three screens now use
- [ ] ./src/web/notes.ts#13 — `existingNoteFor` walks both top-level nodes and
      question bodies

## The note sheet becomes a modal

It was a full-screen takeover that replaced the document. Now it slides over it.

- [ ] ./src/web/NoteSheet.tsx#194 — `fixed inset-x-0 top-0 h-dvh`,
      `role="dialog"`, scrim is a real button, footer in normal flow so a
      software keyboard cannot cover it
- [ ] ./src/web/NoteSheet.tsx#57 — `useAnimatedDismissal` holds the sheet alive
      160ms past the gesture so the exit can play; a save deliberately skips it
- [ ] ./src/web/NoteSheet.tsx#74 — locks `document.body.style.overflow` on
      mount, restores the previous value on unmount
- [ ] ./src/web/screens/Review.tsx#507 — the sheet is now built and mounted
      alongside each branch instead of returned early; same change in `Plan.tsx`
      and `FreeForm.tsx`
- [ ] ./src/web/screens/ProseBlock.tsx#225 — the per-block note control is gone;
      the gesture is a DOUBLE TAP on the block, with `role="button"`/Enter/Space
      as the keyboard path and `touch-manipulation` so the browser's zoom
      gesture does not claim it Discoverability rests on one hint line
      (line 271) and a note badge (line 128). That is the part most worth
      judging on a real phone rather than in a story.

## Free-text answers move into the sheet

- [ ] ./src/web/screens/Question.tsx#373 — the inline textarea and its own Save
      button are replaced by the same sheet, retitled "Your answer"
- [ ] ./src/web/screens/Question.tsx#369 — selecting the free-text radio opens
      the sheet and writes NOTHING; only saving ticks the slot, and an empty
      save unticks it
- [ ] ./src/web/screens/Question.tsx#304 — `commitFreeText` takes the text as an
      argument now, so the save path does not depend on state that has not
      flushed yet

## Palette, type scale and native controls

Every colour becomes a named Radix dark step with its provenance checked by a
test that reads the Radix CSS as data.

- [ ] ./src/web/styles.css#25 — new `divider` token (hairlines between rows)
      split from `border` (a control's own boundary)
- [ ] ./src/web/styles.css#42 — diff backgrounds move to step 4, not 3, so the
      band is not hue-only
- [ ] ./src/web/styles.css#63 — body text 15px → 16px, the iOS focus-zoom floor;
      small 12px → 13px
- [ ] ./src/web/styles.css#88 — checkboxes and radios sized once at 1.25rem with
      `accent-color`; every textarea styled once
- [ ] ./src/web/cn.ts#13 — `extendTailwindMerge` with the project's own token
      names, so a call-site `className` actually wins over a variant's class
- [ ] ./src/web/screens/ProseBlock.tsx#82 — heading size AND hue follow depth
- [ ] ./src/web/testing/palette.ts#7 — stories assert against the live token,
      never a literal `rgb(...)`
- [ ] ./src/web/testing/settled.ts#22 — drains animations in a loop rather than
      one `getAnimations()` snapshot; fixes a real flake where a sheet measured
      278px below rest After 10 passes it returns silently rather than failing,
      though the doc comment above it says the bound exists so a never-ending
      animation would "fail it". Cheap to make it throw.

## Review and Hunk screen polish

- [ ] ./src/web/screens/Review.tsx#449 — a progress header: "N / M chunks
      approved", the only place the round's size is visible
- [ ] ./src/web/screens/Review.tsx#420 — once a chunk has a note, the note text
      itself replaces the "Edit note" button
- [ ] ./src/web/screens/Hunk.tsx#141 — approving becomes a full-width bordered
      row, marked by boundary and label as well as the tick box
- [ ] ./src/web/screens/Hunk.tsx#158 — the hunk's note affordance shows the note
      text too, matching the chunk row
- [ ] ./src/web/screens/Hunk.tsx#54 — diff lines wrap in a `min-w-max` box so
      add/del bands do not stop at the scroll port's edge
- [ ] ./src/web/Deck.tsx#118 — `key={current}` so the item fade replays per item
      rather than once on mount

## Test tooling: the pty runner's timeout was a total-runtime bound

- [ ] ./tests/tooling/support/run-in-pty.py#66 — the deadline resets on every
      successful read, making `IDLE_TIMEOUT_SECONDS` an idle bound as its name
      always claimed Accepted and documented tradeoff: a child emitting one byte
      every nine seconds now runs forever, since there is no total wall-clock
      budget left.
- [ ] ./tests/tooling/run-in-pty.test.ts#31 — both halves pinned: a chatty child
      past ten seconds survives, a silent one is still killed
