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

## Configuration

gtd reads an optional `.gtdrc` config file (via cosmiconfig). Supported
filenames: `.gtdrc`, `.gtdrc.json`, `.gtdrc.yaml`, `.gtdrc.yml`,
`gtd.config.json`, `gtd.config.yaml`. Schema:

- **`testCommand`** (string) — command the edge runs to verify `human-review` /
  `execute` (default `npm run test`). The test-fix cap stays fixed and is not
  overridable.
- **`models`** — `planning` (default `claude-opus-4-8`), `execution` (default
  `claude-sonnet-4-8`), and `states.*` per-state overrides for the 5
  subagent-spawning states (`new-todo`, `modified-todo`, `decompose`, `execute`,
  `execute-simple`). Unknown `models.states` keys are rejected.

Lookup walks from cwd up to the home dir (or filesystem root when cwd is outside
home); all found levels merge, **innermost (cwd) wins**. A `.gtdrc` in a shared
parent directory therefore cascades to every checkout/worktree beneath it. See
the README for the full schema and an example.

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

2. **Execute** (one package per cycle): gtd selects the single next package
   itself, NAMES it, and inlines its task files' full contents into the emitted
   prompt (self-contained — the agent does not browse `.gtd/` or pick a
   package):
   - Spawn parallel execution-model workers for all tasks in that package (with
     `tdd` skill)
   - Commit all changes with `COMMIT_MSG.md`, then delete the package directory
   - On the **last** package the execute prompt also removes the now-empty
     `.gtd/` in the same commit, so the next run goes straight to human-review —
     the cleanup round-trip is normally skipped
   - Re-run gtd. The execute step itself does NOT run tests; the next cycle's
     edge verifies the just-committed package by running `npm run test` before
     resolving (green → advance to the next package, red → fix-tests).

3. **Cleanup**: Remove empty `.gtd/`, verify working tree. The last-package
   `.gtd/` removal happens inside execute, so the normal tail skips this step;
   `cleanup` is retained only as a safety net for a stray empty `.gtd/` (e.g.
   created by hand).

## Work package rules

- **Packages are sequential**: Package 02 waits for 01 to complete
- **Tasks within a package are parallel**: No dependencies between tasks
- **Task files are self-contained**: Include description, acceptance criteria,
  relevant file paths
- **COMMIT_MSG.md**: Conventional commit message for the package

> **Note:** when the fold resolves to `human-review` or `execute`, the Effect
> **edge** runs the configured `testCommand` (default `npm run test`) before
> emitting a prompt. On green it emits the leaf's normal prompt; on red it emits
> the `fix-tests` prompt with the captured output embedded. The fix-tests prompt
> loops internally (tracking attempts in an uncommitted `ERRORS.md`), committing
> only on success or escalation. The test-fix iteration cap is **not**
> configurable: the edge counts the trailing run of commits carrying a
> `Gtd-Test-Fix:` trailer at HEAD and, once it reaches a fixed **3** — or a
> committed `ERRORS.md` is present, or a failure signature recurs — resolves to
> `escalate` instead of fix-tests. Any retry guidance in the prompts is advisory
> only.

## States

The script always runs the same way and resolves to one of these leaf states by
folding the commit history + working tree through guards evaluated in priority
order:

- `escalate` — a committed `ERRORS.md` is present, or the trailing run of
  commits carrying a `Gtd-Test-Fix:` trailer hit 3; stop and hand off to the
  human
- `close-review` — `REVIEW.md` has only forward checkbox ticks
  (`- [ ]`→`- [x]`) and no `!!` comment; discard the ticks, delete `REVIEW.md`,
  commit the close (becomes the new review base so the next run is `verified`)
- `code-changes` — uncommitted changes outside `TODO.md` and `REVIEW.md`; commit
  them verbatim (`git add -A`) before any gate is evaluated
- `review-process` — `REVIEW.md` has notes (or an approved review carries a `!!`
  comment); fold the feedback into `TODO.md`, harvesting `!!` comments verbatim
  from the files the current `REVIEW.md` references (its chunk references) plus
  the dirty working tree — not the whole tracked tree
- `await-review` — `REVIEW.md` is committed and unmodified; human gate, STOP
- `execute` — `.gtd/` has work packages; the edge runs `npm run test` first
  (green → emit the named single next package with its task contents inlined, one
  subagent per task, and on the last package also remove the empty `.gtd/`; red →
  fix-tests, or `escalate` at the cap)
- `cleanup` — `.gtd/` is empty; remove it and verify. Safety net for a stray
  empty `.gtd/` — the normal tail skips it because execute removes `.gtd/` on the
  last package
- `execute-simple` — `TODO.md` `status: simple` (≤5 files, or legacy
  `<!-- simple -->`); implement directly without decomposition
- `decompose` — `TODO.md` `status: complete`; break it into ordinal,
  dependency-ordered work packages
- `await-answers` — `TODO.md` `status: grilling`, committed, with open questions
  remaining; human gate, STOP
- `new-todo` / `modified-todo` — a markerless `TODO.md` (first grill, sets
  `status: grilling`) / a grilling-or-markerless `TODO.md` edited (re-grill)
- `human-review` — clean tree with un-reviewed commits; the edge runs
  `npm run test` first (green → auto-generate `REVIEW.md`; red → fix-tests, or
  `escalate` at the cap)
- `verified` — nothing left to do; tree is healthy and fully reviewed

`fix-tests` is **not** a leaf state. It is a PROMPT the Effect edge selects (it
never appears in the machine's resolved leaf set) when the hardcoded
`npm run test` fails on the `human-review` or `execute` path. The prompt embeds
the captured failure output and instructs exactly ONE `fix(gtd): <desc>` commit
with a `Gtd-Test-Fix: <n>` trailer, followed by a re-run; the `Gtd-Test-Fix:`
trailer is the counted signal — not the subject prefix — and any commit without
it resets the counter to 0; the cap-vs-escalate decision is made in the edge
before this prompt is emitted.

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
3. **review-process**: On the next run gtd folds all feedback (comments, source
   edits, and any `!!` follow-up comments in the files the current `REVIEW.md`
   references plus the dirty working tree — not plain `TODO:` markers, and not
   the whole tracked tree) into a fresh `TODO.md`, resets the working tree, and commits
   — restarting the loop. Changes outside `REVIEW.md`/`TODO.md` are committed
   verbatim first (`code-changes`).
4. **close-review**: If the user only ticks checkboxes in `REVIEW.md` (marks
   items approved with no other edits), gtd detects this as an approval signal:
   it discards the ticks, deletes `REVIEW.md`, and commits a
   `chore(gtd): close approved review for …` close commit. That commit becomes
   the new review base, so the immediately following run resolves to `verified`.
