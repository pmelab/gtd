# Part B — driver wiring + remove `git commit` from agent prompts

Wire the generalized commit `EdgeAction` into the driver, and remove the
`git commit` instructions from the seven agent prompts whose commit now happens
on the NEXT cycle's edge. The agent leaves output uncommitted + the intent
descriptor; the next `gtd` run commits it.

## Files (this task)

- `src/main.ts`
- `src/prompts/execute.md`
- `src/prompts/decompose.md`
- `src/prompts/new-todo.md`
- `src/prompts/modified-todo.md`
- `src/prompts/execute-simple.md`
- `src/prompts/human-review.md`
- `src/prompts/fix-tests.md`
- `src/Prompt.ts` (only if the execute-package render block — the "remove the
  now-empty `.gtd/`" line — must move; see below)
- `src/Prompt.test.ts` (update the execute-render assertion)

> File-disjoint from sibling tasks 01 (`Machine.ts`/`Machine.test.ts`) and 02
> (`Git.ts`/`Events.ts` + their tests). `main.ts` has no unit test; prompt edits
> are content-only. Behavior verified by e2e (package 06).

## Changes

### Driver (`src/main.ts`)

- In the `case "commitPending":` arm, pass the action's
  `message`/`removeLastPackage`/`restorePaths` through to `git.commitPending(...)`.
  For intents whose message is content-derived (task 02 helper), compute the
  `message` from the helper before calling, using the selected package / base /
  TODO.md as needed — keep all reads in the edge, not the machine.
- Ensure the loop re-gathers events and re-advances after the commit, so the now-
  clean tree resolves forward (the A0 cap/stuck bounds a commit that fails to
  clear the tree → escalate).

### Prompts — remove the commit step

For each prompt, delete the "commit / `git commit -m ...`" instruction and
replace with: "Leave the changes uncommitted and write the intent descriptor
`<marker>` (as defined by the edge); re-run gtd — the next cycle commits this
verbatim." Keep the LLM-judgment work that stays:

- `execute.md` — keep package execution; drop the COMMIT_MSG.md commit step (edge
  commits with that message + removes the consumed `.gtd/`). Drop the
  "also remove the now-empty `.gtd/` directory" instruction (edge does it).
- `decompose.md` — keep writing `.gtd/`; drop the decompose commit step.
- `human-review.md` — keep REVIEW.md generation + **hunk grouping** (the residual
  LLM work); drop the `review(gtd): create review for ...` commit step.
- `new-todo.md` / `modified-todo.md` — keep plan development + `gtd format`; drop
  the `Commit TODO.md` step (and recall the test-gate block was already removed
  in package 04). NOTE: `format` may become a deterministic edge `gtd format`
  call — if task 02/the edge handles it, drop the format instruction too;
  otherwise keep the format instruction and only drop the commit.
- `execute-simple.md` — keep the simple implementation; drop the commit step.
- `fix-tests.md` — keep the fix loop; drop the per-fix `git commit` (edge commits
  with the `Gtd-Test-Fix:` trailer). Keep the "do not commit per attempt"
  framing consistent with the edge now owning the commit.

## Acceptance criteria

- [ ] Driver `commitPending` arm forwards message/cleanup options and computes
      content-derived messages edge-side.
- [ ] None of the seven prompts instruct `git commit` for the moved commit; each
      instructs leaving work uncommitted + writing the intent descriptor +
      re-running gtd.
- [ ] `execute.md` no longer tells the agent to remove `.gtd/` (edge does it).
- [ ] `human-review.md` retains hunk-grouping guidance.
- [ ] `npm run test` green; `npm run typecheck` passes; `npm run lint` clean.

## Tests this task MUST check

- No `*.test.ts` covers `main.ts` or these prompts directly; run `npm run test`
  and fix any `Prompt.test.ts` assertion that matched removed commit text. The
  execute-package render test asserts `remove the now-empty \`.gtd/\` directory`
  (`Prompt.test.ts` / `execute-gate.feature`) — UPDATE that assertion here
  (Prompt.test.ts) since the instruction is removed; the e2e equivalent is
  updated in package 06.

## Constraints / edge cases

- The single-prompt-per-invocation contract holds; no status output.
- The residual LLM work per the plan: hunk grouping (human-review) and
  execute-simple's mild message judgment stay agent-side; everything else is
  deterministic edge work.
