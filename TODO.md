---
status: simple
---

# Drop the redundant "re-run gtd" verb from all auto-advance producer prompts

Review feedback (recovered from review commit `ebe2faa`). Wording-only cleanup —
no machine or behavior change.

## Background

The `auto-advance` tag already makes `buildPrompt` append the
`src/prompts/partials/auto-advance.md` block ("## Auto-advance — Re-run gtd
immediately after completing the steps above…") to the end of every
auto-advancing leaf's prompt (`src/Prompt.ts:155-156, 180-181`). So the body
sentence in each producer prompt that ALSO says "Re-run gtd — the next cycle
commits …" duplicates the re-run directive. The body sentence's real value is
the **marker/commit mechanics** the generic partial omits, not the re-run verb.

## Change: trim the three producer prompts

Reword the closing body sentence in each so it states only the mechanics and
lets the appended `## Auto-advance` partial own the single "re-run gtd"
directive.

- `src/prompts/human-review.md` (closing line, ~70): currently "After writing
  `REVIEW.md` and the marker, re-run gtd — the next cycle commits `REVIEW.md`
  and deletes the marker, then stops at the human-review gate for the user to
  work through it." Drop "re-run gtd" AND fix the gate name — it stops at
  **`await-review`**, not "human-review": "After writing `REVIEW.md` and the
  marker, the next cycle's edge commits `REVIEW.md` and deletes the marker, then
  stops at the `await-review` gate for the user to work through it."
- `src/prompts/new-todo.md` (~72): currently "Re-run gtd — the next cycle
  commits the developed `TODO.md` and deletes the marker." → drop the "Re-run
  gtd — " prefix: "The next cycle commits the developed `TODO.md` and deletes
  the marker."
- `src/prompts/modified-todo.md` (~81): currently "Re-run gtd — the next cycle
  commits `TODO.md` and deletes the marker." → drop the prefix: "The next cycle
  commits `TODO.md` and deletes the marker."

## Verify

- No body sentence in the three prompts says "re-run gtd"; the appended
  `## Auto-advance` partial remains the single re-run directive.
- The `auto-advance.feature` human-review assertion still holds:
  `stdout contains "the next cycle commits"` (the phrase survives in the body)
  and `stdout does not contain "STOP"`.
- `npm run test` (vitest) stays green; `npm run test:e2e` stays green (it
  rebuilds the bundle at runtime).
- Rebuild the committed bundle (`npm run build`) so the shipped `scripts/gtd.js`
  carries the reworded prompts.

## Scope

Wording-only edits to 3 prompt `.md` files plus the rebuilt `scripts/gtd.js`
bundle — `status: simple` (no decomposition needed). No `src/*.ts`, no tests, no
README change (README does not quote these sentences).
