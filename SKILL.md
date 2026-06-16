---
name: gtd
description: Use when the user wants to take the next git-aware, conventional-commits step on the current repo — planning with TODO.md, refining a plan, building from a finalized plan, committing pending changes, or running the test suite. Also triggers on "gtd", "what's next", "take the next step", or `/gtd`.
compatibility: Requires Node 20+
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
   or more task sections (plan, build, commit, run tests, …) chosen by
   the script from the working-tree state.

3. Do not edit, paraphrase, or summarize the prompt before acting on it.
   Anything that needs to be communicated to the user should come out of
   the actions the prompt describes, not from prefacing the prompt itself.
