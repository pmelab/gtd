---
name: gtd
description:
  Use when the user wants to take the next git-aware, conventional-commits step
  on the current repo — planning with TODO.md, refining a plan, decomposing into
  work packages, executing packages with parallel subagents, committing pending
  changes, running the test suite, or reviewing the changes on the current
  branch. Also triggers on "gtd", "what's next", "take the next step", `/gtd`,
  "review changes", or "start a review".
compatibility: Requires Node 20+, pi-subagents for orchestration
allowed-tools: Bash(node:*)
---

# gtd

Generate the next prompt for the autonomous coding agent by folding the repo's
commit history and working tree through an event-sourced state machine that
resolves to a single active state.

## How to use this skill

1. Run the bundled script from the user's current working directory:

   ```bash
   node scripts/gtd.js
   ```

   Resolve `scripts/gtd.js` relative to this skill's directory, not the user's
   repo. The script must be invoked with the user's repo as the working
   directory so it can read `git status`, the commit history, and the diff. The
   script takes **no ref argument** — the review base is always auto-computed.

2. Treat the script's stdout as a complete, self-contained prompt — read it and
   follow its instructions verbatim. The script folds the commit history (since
   the merge-base with the default branch) plus the working tree through an
   event-sourced state machine and resolves to exactly **one** active state,
   whose prompt is emitted. The prompt embeds the Conventional Commits
   convention, the current `git diff HEAD`, and the single task section (plan,
   decompose, execute, commit, review, …) for the resolved state.

3. Do not edit, paraphrase, or summarize the prompt before acting on it.
   Anything that needs to be communicated to the user should come out of the
   actions the prompt describes, not from prefacing the prompt itself.

## Model configuration

gtd uses two model tiers:

- **Planning model**: High-reasoning (e.g., Claude Opus) for developing plans,
  grilling on questions, and decomposing into work packages.
- **Execution model**: Everyday work (e.g., Claude Sonnet) for implementing
  tasks, running tests, and fixing failures.

Configure these in your `~/.pi/AGENTS.md` or project AGENTS.md:

```markdown
## Model preferences

- Use Claude Opus for planning work
- Use Claude Sonnet for execution work
```

If no preferences are set, the prompts include sensible defaults.

## Build orchestration

When a plan is finalized (no open questions), gtd enters build mode:

1. **Decompose**: A planning-model subagent breaks `TODO.md` into work packages
   in `.gtd/`:

   ```
   .gtd/
     01-auth-module/
       01-define-types.md
       02-implement-login.md
       COMMIT_MSG.md
     02-api-endpoints/
       ...
   ```

2. **Execute** (one package per cycle): each run executes EXACTLY ONE package —
   the lowest-numbered package remaining in `.gtd/`:
   - Spawn parallel execution-model workers for all tasks in that package (with
     `tdd` skill)
   - Commit all changes with `COMMIT_MSG.md`, then delete the package directory
   - Re-run gtd. The execute step itself does NOT run tests; the next cycle's
     edge verifies the just-committed package by running `npm run test` before
     resolving (green → advance to the next package, red → fix-tests).

3. **Cleanup**: Remove empty `.gtd/`, verify working tree

## Work package rules

- **Packages are sequential**: Package 02 waits for 01 to complete
- **Tasks within a package are parallel**: No dependencies between tasks
- **Task files are self-contained**: Include description, acceptance criteria,
  relevant file paths
- **COMMIT_MSG.md**: Conventional commit message for the package

## Configuration via AGENTS.md

Advisory guidance comes from AGENTS.md files (user or project scope):

- Model preferences (planning vs execution)
- Test command (or inferred from package.json, Makefile, etc.)

No separate config file needed.

> **Note:** when the fold resolves to `human-review` or `execute`, the Effect
> **edge** runs the hardcoded `npm run test` (no env/config override) before
> emitting a prompt. On green it emits the leaf's normal prompt; on red it emits
> the `fix-tests` prompt with the captured output embedded. The test-fix
> iteration cap is **not** configurable: the edge counts the trailing run of
> `fix(gtd):` commits at HEAD and, once it reaches a fixed **5**, resolves to
> `escalate` instead of fix-tests. The cap is enforced **in the edge** (before
> emitting fix-tests), so it applies uniformly to both `human-review` and
> `execute`. Any retry guidance in the prompts is advisory only.

## States

The script always runs the same way and resolves to one of these leaf states by
folding the commit history + working tree through guards evaluated in priority
order:

- `close-review` — `REVIEW.md` has only forward checkbox ticks
  (`- [ ]`→`- [x]`); discard the ticks, delete `REVIEW.md`, commit the close
  (becomes the new review base so the next run resolves to `verified`)
- `review-process` — `REVIEW.md` was edited; fold the feedback into `TODO.md`
- `code-changes` — uncommitted changes outside `TODO.md`; commit them
- `execute` — `.gtd/` has work packages; the edge runs `npm run test` first
  (green → execute the next, lowest-numbered package; red → fix-tests, or
  `escalate` at the cap)
- `cleanup` — `.gtd/` is empty; remove it and verify
- `execute-simple` — `TODO.md` is finalized and marked `<!-- simple -->`
- `decompose` — `TODO.md` is finalized; break it into work packages
- `escalate` — the trailing run of `fix(gtd):` commits hit 5; stop and hand off
  to the human
- `new-todo` / `modified-todo` — `TODO.md` is new or modified; keep planning
- `human-review` — clean tree with un-reviewed commits; the edge runs
  `npm run test` first (green → auto-generate `REVIEW.md`; red → fix-tests, or
  `escalate` at the cap)
- `verified` — nothing left to do; tree is healthy and fully reviewed

`fix-tests` is **not** a leaf state. It is a PROMPT the Effect edge selects (it
never appears in the machine's resolved leaf set) when the hardcoded
`npm run test` fails on the `human-review` or `execute` path. The prompt embeds
the captured failure output and instructs exactly ONE `fix(gtd): <desc>` commit
followed by a re-run; the cap-vs-escalate decision is made in the edge before
this prompt is emitted.

## Review

There is no separate review-mode invocation and no ref argument. Review is part
of the normal loop:

1. **human-review**: When the tree is clean and there are un-reviewed commits
   relative to the auto-computed base (parent-branch merge-base, last
   `<!-- base: … -->` review commit, or last `chore(gtd): close approved review`
   commit), gtd generates `REVIEW.md` with structured feedback sections and a
   `<!-- base: <sha> -->` marker, then stops.
2. The user edits `REVIEW.md` with feedback (and may edit source files to
   illustrate desired changes).
3. **review-process**: On the next run gtd detects the dirty `REVIEW.md`, folds
   all feedback (comments, source edits, and any `TODO:` markers in the reviewed
   code) into a fresh `TODO.md`, resets the working tree, and commits —
   restarting the loop.
4. **close-review**: If the user only ticks checkboxes in `REVIEW.md` (marks
   items approved with no other edits), gtd detects this as an approval signal:
   it discards the ticks, deletes `REVIEW.md`, and commits a
   `chore(gtd): close approved review for …` close commit. That commit becomes
   the new review base, so the immediately following run resolves to `verified`.
