# Wire the `review-incomplete` prompt section (`src/Prompt.ts`)

Add the new leaf's prompt and register it in the `SECTIONS` map so `buildPrompt`
can render it. Required because package-02 task 02 adds `"review-incomplete"` to
`LeafState`, which makes `SECTIONS: Record<LeafState, string>` demand the key.

## What to do

1. Create `src/prompts/review-incomplete.md` — a terminal HUMAN-GATE prompt
   (mirror the tone/shape of `src/prompts/await-review.md`). It must:
   - State that the human STARTED reviewing but left at least one unchecked box.
   - Tell the human to review **everything** and at minimum tick **all** the
     checkboxes (`- [ ]` → `- [x]`) before re-running, plus optionally leave
     notes / edit source for anything that needs work.
   - Make clear this is distinct from `await-review` (which means "nothing
     touched yet").
   - Instruct: report the review is incomplete, then **STOP**. Do NOT re-run gtd;
     the human must act first. (Exit code is 0 — a normal human gate.)
   - Contain NO `!!` mentions and NO git commands (no operations happen here).

2. In `src/Prompt.ts`:
   - Add `import reviewIncomplete from "./prompts/review-incomplete.md"`
     (alongside `awaitReview`).
   - Add `"review-incomplete": reviewIncomplete,` to the `SECTIONS` map.

3. Do NOT touch `review-process.md` here (it is slimmed in package 05) and do NOT
   touch `await-review.md` (its `!!` clause is removed in package 03).

## Tests (same task — `src/Prompt.test.ts`)

- Add a test that `buildPrompt(result("review-incomplete", { autoAdvance: false
  }))` renders the review-incomplete section and STOP guidance, and does NOT leak
  another leaf's section.
- Keep all existing `Prompt.test.ts` cases green — in particular the existing
  `"review-process prompt instructs to format TODO.md and use git revert"` case
  (~line 57) must still pass because `review-process.md` is UNCHANGED in this
  package.

## Acceptance criteria

- [ ] `src/prompts/review-incomplete.md` created (human gate, STOP, no `!!`, no
      git).
- [ ] `src/Prompt.ts` imports it and registers `"review-incomplete"` in
      `SECTIONS`.
- [ ] `src/Prompt.test.ts` renders/asserts the new section; existing cases
      (incl. the old review-process assertion) stay green.
- [ ] `npm run test` green.

## Files

- `src/prompts/review-incomplete.md` (new)
- `src/Prompt.ts`
- `src/Prompt.test.ts`

## Constraints / edge cases

- File-disjoint from the Events task (task 01) and the Machine task (task 02).
- The `bundle`/build embeds prompt `.md` files via the import — make sure the new
  import path matches the existing pattern (`./prompts/<name>.md`).
- `review-incomplete` is NOT a `MODEL_STATES` member — do not add it there; it
  carries no `{{MODEL}}` placeholder.
