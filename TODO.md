# Generalize the ⛔ STOP block to all non-auto-advance prompts

## Background

Issue #28 originally added a ⛔ STOP block only to
`src/prompts/await-review.md`. The feedback: the block should appear in
**every** state that is a human gate (i.e. `autoAdvance: false` and the agent
must stop, not merely self-re-run).

## STOP states

Four prompt states have `autoAdvance: false` and require a human to act:

| State                     | Where `autoAdvance: false` | Current STOP block?                        |
| ------------------------- | -------------------------- | ------------------------------------------ |
| `await-review`            | Machine.ts:475             | ✅ already has it                          |
| `escalate`                | Machine.ts:356             | ❌ missing                                 |
| `idle`                    | Machine.ts:539             | ❌ missing                                 |
| `grilling` (stop variant) | Machine.ts:506             | ⚠️ text says STOP but no leading ⛔ banner |

Note: `clean` also has `autoAdvance: false` but it spawns a subagent and tells
the agent to re-run gtd. It is NOT a human gate and must NOT get the ⛔ block.

## Approach: inject centrally in `buildPrompt`, not per-file

`buildPrompt` already has the symmetric pattern for `autoAdvance`: it appends
`auto-advance.md` when `result.autoAdvance === true`. The mirror is: prepend a
`stop.md` partial when `result.autoAdvance === false` AND the state is not
`clean` (the only false-autoAdvance, non-STOP state).

More precisely, the condition is `!result.autoAdvance && state !== "clean"`.

This approach:

- keeps each prompt file focused on its task description, not on the constraint
- removes the existing bespoke STOP block from `await-review.md` (no longer
  needed)
- guarantees any future STOP state gets the banner automatically

## Work packages

### Package 1 — Add `src/prompts/partials/stop.md`

Create `src/prompts/partials/stop.md` with a single, state-neutral banner:

```markdown
⛔ **STOP — do not re-run `gtd`.** This is a human gate. Only the user may
resume this step. Re-running `gtd` now with no changes will loop or advance
without human input.
```

### Package 2 — Strip the bespoke STOP block from `await-review.md`

Remove the existing ⛔ paragraph (lines 1–3) from `src/prompts/await-review.md`
so the section starts cleanly at `## Task: Await the user's review`.

### Package 3 — Wire `stop.md` into `buildPrompt`

In `src/Prompt.ts`:

1. Import the new partial:
   `import stopPartial from "./prompts/partials/stop.md"`
2. Build `parts` so the stop banner follows `header` and precedes
   `buildContextBlock`:

```ts
const parts: Array<string> = [header, ""]
if (!result.autoAdvance && promptState !== "clean") parts.push(stopPartial, "")
parts.push(buildContextBlock(context))
```

This places the constraint before any state details, matching the existing
`await-review.md` layout where the ⛔ block leads before `## Context`.

### Package 4 — Update tests in `src/Prompt.test.ts`

**Existing test to update:**

- `"await-review leads with the STOP constraint"` — the STOP text now comes from
  the central partial. Update the assertion strings to match the new wording in
  `stop.md`. The position check (STOP before task heading) still applies.

**New tests to add** (new `"STOP banner"` describe block):

- `"escalate leads with the STOP banner"` — `⛔` present, appears before
  `"Escalate — the test gate"`
- `"idle leads with the STOP banner"` — `⛔` present, appears before
  `"Nothing to do"`
- `"grilling stop-case leads with the STOP banner"` — `⛔` present, appears
  before `"Open questions await the user"`
- `"clean does NOT get the STOP banner despite autoAdvance: false"` — `⛔`
  absent
- `"auto-advance states do NOT get the STOP banner"` — cover `grilled`,
  `planning`, `building`, `fixing`, `agentic-review`, `grilling` (iterate),
  `clean`

**Existing `"STOP states carry no {{MODEL}}"` test** — keep as-is; it already
covers `await-review`, `escalate`, `idle`.

no open questions — run gtd to plan
