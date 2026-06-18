---
name: gtd
description: Use when the user wants to take the next git-aware, conventional-commits step on the current repo — planning with TODO.md, refining a plan, decomposing into work packages, executing packages with parallel subagents, committing pending changes, or running the test suite. Also triggers on "gtd", "what's next", "take the next step", or `/gtd`.
compatibility: Requires Node 20+, pi-subagents for orchestration
allowed-tools: Bash(node:*)
---

# gtd

Generate the next prompt for the autonomous coding agent based on the current
git state of the user's working directory.

## How to use this skill

1. Run the bundled script from the user's current working directory:

   ```bash
   node scripts/gtd.js
   ```

   Resolve `scripts/gtd.js` relative to this skill's directory, not the
   user's repo. The script must be invoked with the user's repo as the
   working directory so it can read `git status` and the diff.

2. Treat the script's stdout as a complete, self-contained prompt — read it
   and follow its instructions verbatim. The prompt embeds the
   Conventional Commits convention, the current `git diff HEAD`, and one
   or more task sections (plan, decompose, execute, commit, verify, …)
   chosen by the script from the working-tree state.

3. Do not edit, paraphrase, or summarize the prompt before acting on it.
   Anything that needs to be communicated to the user should come out of
   the actions the prompt describes, not from prefacing the prompt itself.

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

1. **Decompose**: A planning-model subagent breaks `TODO.md` into work
   packages in `.gtd/`:

   ```
   .gtd/
     01-auth-module/
       01-define-types.md
       02-implement-login.md
       COMMIT_MSG.md
     02-api-endpoints/
       ...
   ```

2. **Execute**: For each package (sequentially):
   - Spawn parallel execution-model workers for all tasks (with `tdd` skill)
   - Spawn a testing subagent to run tests and fix failures
   - Delete package directory, commit with `COMMIT_MSG.md`

3. **Cleanup**: Remove empty `.gtd/`, verify working tree

## Work package rules

- **Packages are sequential**: Package 02 waits for 01 to complete
- **Tasks within a package are parallel**: No dependencies between tasks
- **Task files are self-contained**: Include description, acceptance criteria,
  relevant file paths
- **COMMIT_MSG.md**: Conventional commit message for the package

## Configuration via AGENTS.md

All configuration comes from AGENTS.md files (user or project scope):

- Model preferences (planning vs execution)
- Test command (or inferred from package.json, Makefile, etc.)
- Retry limits for test failures (default: 5)

No separate config file needed.
