# Clean gtd run/no-run directives out of all prompts except the advance/no-advance suffixes

## Goal

Only the "advance" suffix (`src/prompts/partials/auto-advance.md`) and the
"no-advance" suffix (`src/prompts/partials/stop.md`) should carry instructions
about running or not running `gtd`. `src/Prompt.ts` already appends these
partials programmatically, so individual prompt `.md` files must not embed their
own agent directives about re-running / stopping.

Distinction to preserve: **agent directives** ("re-run gtd", "STOP — do not
re-run gtd") get removed; **user-facing instructions** (what the agent should
_tell the user_ to do, e.g. "tell the user to open TODO.md and re-run gtd")
stay.

## File-by-file changes

### 1. `src/prompts/agentic-review.md`

Remove the trailing agent directive (after step 4):

> Re-run gtd — the edge reads `FEEDBACK.md`: an empty file closes the package; a
> content-bearing one routes to a fix cycle and then re-reviews.

The auto-advance partial covers the re-run behavior.

### 2. `src/prompts/clean.md`

Remove the inline ⛔ STOP block at the very end:

> ⛔ **STOP — do not re-run `gtd`.** The next cycle commits `REVIEW.md` as
> `gtd: awaiting review` and stops for the user. Re-running gtd now advances
> without human input.

The stop partial now covers this (see the `Prompt.ts` change below).

### 3. `src/prompts/escalate.md`

Remove the trailing agent directive:

> After reporting, **STOP**. Do not re-run gtd — the user must act first.

The stop partial covers this.

### 4. `src/prompts/fixing.md`

Remove the trailing agent directive:

> Re-run gtd once the fix is in place — the fix returns through the test gate.

The auto-advance partial covers this.

### 5. `src/prompts/grilling.md` (stop tail, after `<!-- gtd:stop -->`)

Keep the user-facing instruction, remove the agent directive. Current text:

> Tell the user to open `TODO.md`, answer each question inline (replacing its
> `<!-- user answers here -->` marker with the answer), and re-run gtd. Then
> **STOP** — do not edit `TODO.md`, spawn a subagent, or re-run gtd yourself.
> The user must answer first.

- KEEP: "Tell the user to open `TODO.md`, answer each question inline (replacing
  its `<!-- user answers here -->` marker with the answer), and re-run gtd."
- REMOVE: "Then **STOP** — do not edit `TODO.md`, spawn a subagent, or re-run
  gtd yourself. The user must answer first."

### 6. `src/prompts/idle.md`

Current text:

> Report that the repository is idle — nothing for gtd to do — and **STOP**. To
> start something new, write a `TODO.md` (or leave pending changes in the
> working tree) and re-run gtd.

- REMOVE the agent directive "and **STOP**" from the first sentence → "Report
  that the repository is idle — nothing for gtd to do."
- KEEP the user-facing second sentence "To start something new, write a
  `TODO.md` (or leave pending changes in the working tree) and re-run gtd."

### Files intentionally left unchanged

- `src/prompts/await-review.md` — "re-run gtd" here is a user-facing
  instruction.
- `src/prompts/building.md`, `src/prompts/decompose.md` — "the next gtd run…" is
  descriptive text, not an imperative agent directive.

## `src/Prompt.ts` change

Remove the `clean` exception so the stop partial is appended for `clean` like
every other non-autoAdvance state. Lines ~211-212:

```js
// before
if (!result.autoAdvance && promptState !== "clean") parts.push(stopPartial, "")
if (result.autoAdvance) parts.push(autoAdvance, "")

// after
if (!result.autoAdvance) parts.push(stopPartial, "")
if (result.autoAdvance) parts.push(autoAdvance, "")
```

## Tests

No test changes needed.

- `src/Prompt.test.ts` "clean gets the STOP banner" asserts `out` contains `⛔`.
  After the change, `clean.md` no longer has the inline ⛔, but `buildPrompt`
  appends `stopPartial` (which contains ⛔) because the
  `promptState !== "clean"` exception is removed. Test still passes.
- All other STOP/advance tests reference content from the partials or from
  sections that don't change. No failures expected.

Run the test suite after the edits to confirm.

no open questions — run gtd to plan
