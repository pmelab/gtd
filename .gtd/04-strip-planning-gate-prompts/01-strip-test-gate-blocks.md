# Strip the "Test gate (run first)" blocks from non-execute prompts

The test gate is now machine-modeled and fires ONLY in front of `execute`
(packages 02–03). The `human-review` leaf and the planning steps no longer run
the suite, so their prompts must NOT instruct the agent to run a test gate.
Remove the now-misleading "Test gate (run first)" blocks. Pure prompt-content
cleanup; the gate's red branches (`fix-tests.md`, `escalate.md`) keep their
test-gate wording because they ARE the gate's failure prompts.

## Files (this task — all prompt `.md`)

- `src/prompts/new-todo.md`
- `src/prompts/modified-todo.md`
- `src/prompts/verified.md`
- `src/prompts/human-review.md`
- `src/prompts/execute-simple.md` (only if it carries a test-gate block — check
  and remove if present)

> DO NOT touch `execute.md` (the gate fires before it — but it is the EDGE that
> gates now, not the prompt; verify `execute.md` has no "run tests first" block,
> and remove it if it does so the prompt doesn't double-instruct). DO NOT touch
> `fix-tests.md` or `escalate.md` — their test-gate wording is the red branch.

## What to remove

In each listed prompt, delete the leading block:

```
## Test gate (run first)

Before doing anything else, run the project's test suite ...
- **On failure:** ... fix(gtd): <desc> ... re-run gtd ...
- **On green:** proceed inline with the task below in this same run.
```

(see `new-todo.md:1-11`, `modified-todo.md:1-12`, `verified.md:1-11`). Leave the
remaining `## Task:` body intact and starting cleanly (no stray leading blank
lines that would trip the prompt's `\n{3,}` collapse — that collapse exists, so a
leftover blank line is harmless, but keep it tidy).

For `verified.md`, the "### On failure — structured diagnosis" section stays —
that is the agent's own verification discipline, not the machine test gate.

## Acceptance criteria

- [ ] None of `new-todo.md`, `modified-todo.md`, `verified.md`,
      `human-review.md` contains the string `## Test gate (run first)`.
- [ ] `execute.md` does not instruct running tests first (the edge gates it).
- [ ] `fix-tests.md` and `escalate.md` are unchanged.
- [ ] `human-review.md` still instructs generating/formatting `REVIEW.md`.
- [ ] `verified.md` still keeps its "On failure — structured diagnosis" block.
- [ ] `npm run test` green; `npm run typecheck` passes.

## Tests this task MUST check (to stay green)

- `src/Prompt.test.ts`: assertions on these prompts key off `## Task:` / body
  text (e.g. `format REVIEW.md`, `Confirm the working tree is healthy`,
  `Develop the plan`), NOT the test-gate block — so removing the block must not
  break them. Run `npm run test` and fix any assertion that incidentally matched
  removed text (none expected; the gate-block text is asserted only via the
  override path which is unaffected).
- No new test needed (content-only change); e2e coverage of the behavior change
  ("human-review does not spawn the runner") lands in package 06.

## Constraints / edge cases

- This is the prompt-side companion to the machine change in package 02; it must
  land AFTER 02–03 so the prompts and behavior agree, but it does not itself
  change behavior.
