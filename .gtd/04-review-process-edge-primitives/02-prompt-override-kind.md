# New `review-process` PromptOverride kind + buildPrompt branch

Extend the `PromptOverride` union (in BOTH `Prompt.ts` and `State.ts`) with a
`review-process` kind carrying the captured diff + record-sha, and make
`buildPrompt` render it like a normal leaf with the diff injected.

## What to do

1. **`src/Prompt.ts`** — the canonical `PromptOverride` interface (~line 100–104)
   is currently a single-member union. Make it a union:
   ```ts
   export type PromptOverride =
     | { readonly kind: "fix-tests"; readonly testOutput: string }
     | { readonly kind: "review-process"; readonly reviewDiff: string; readonly recordSha: string }
   ```
   (Convert the existing interface to the `fix-tests` member of the union.)

2. **`src/State.ts`** — keep its `PromptOverride` type alias (~line 16) in sync:
   add the `review-process` member to the union there too.

3. **`buildPrompt` branch** (`src/Prompt.ts` ~line 148–171): today
   `if (override?.kind === "fix-tests")` SKIPS the normal section + auto-advance.
   Branch on kind:
   - `fix-tests`: unchanged behavior.
   - `review-process`: render like a NORMAL leaf — push `SECTIONS["review-process"]`
     (the leaf prompt), then the injected `override.reviewDiff` fenced via
     `fenceFor` (a `### Review feedback diff` style block), and STILL honor
     `result.autoAdvance` (push the `autoAdvance` partial when true), since
     `review-process` keeps its `auto-advance` tag. Do NOT collapse it into the
     fix-tests shape. Surface `override.recordSha` so the slimmed prompt's
     recovery hint can reference it — e.g. include a line like
     "If you lose this diff, recover it with `git show <recordSha>`." (the slimmed
     prompt text itself lands in package 05; here just make the override data
     available — at minimum render `reviewDiff` and `recordSha` into the output).

## Tests (same task — `src/Prompt.test.ts`)

- Add a test: `buildPrompt(result("review-process", { autoAdvance: true }),
  { kind: "review-process", reviewDiff: "diff --git a/x b/x\n+hi\n", recordSha:
  "deadbee" })` renders the review-process SECTION, fences the injected diff,
  includes the `auto-advance` partial, and surfaces `deadbee` (recovery hint).
- Add a fence-lengthening test if the diff contains backtick runs (mirror the
  existing fix-tests fence test).
- Keep the existing `"review-process prompt instructs to format TODO.md and use
  git revert"` case (~line 57) GREEN — `review-process.md` is still the OLD prompt
  in this package; do not slim it here.

## Acceptance criteria

- [ ] `PromptOverride` is a 2-member union in `src/Prompt.ts` AND `src/State.ts`,
      identical shapes.
- [ ] `buildPrompt` branches on `kind`; `review-process` renders section + fenced
      diff + auto-advance partial + record-sha, never the fix-tests collapse.
- [ ] `src/Prompt.test.ts` pins the new override rendering; existing cases green.
- [ ] `npm run test` green.

## Files

- `src/Prompt.ts`
- `src/State.ts`
- `src/Prompt.test.ts`

## Constraints / edge cases

- File-disjoint from the `Git.ts` task (task 01) in this package.
- `selectPrompt` in `State.ts` only ever produces `fix-tests`; do NOT change it.
  The `review-process` override is constructed in `main.ts` (package 05), so the
  new union member is unused by `selectPrompt` here — that is expected.
- Both `PromptOverride` definitions MUST stay byte-for-byte equivalent or the
  build breaks (they are independent declarations the codebase keeps in sync).
