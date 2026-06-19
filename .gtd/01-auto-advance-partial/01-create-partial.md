# Create auto-advance partial

Create the reusable auto-advance instruction partial that will be appended to prompts that should trigger re-running gtd.

## What to build

Create `src/prompts/partials/auto-advance.md` containing the standardized re-run instruction text. The phrasing should instruct the agent to immediately re-run `node <path>/scripts/gtd.js` after completing the current step, rather than waiting for the user.

## Acceptance criteria

- [ ] File `src/prompts/partials/auto-advance.md` exists
- [ ] Contains clear instruction to re-run gtd after completing the step
- [ ] Mentions that the agent should NOT re-run if an error/failure requires user input
- [ ] File is importable as a default string export (same pattern as other `.md` prompt files in `src/prompts/`)

## Relevant files

- `src/prompts/header.md` — example of existing prompt markdown file (check import pattern)
- `src/prompts/decompose.md` — example of task section with passive "next invocation" text to understand what auto-advance replaces

## Constraints

- Keep the instruction concise (3-5 lines max)
- Use imperative voice ("Re-run...", "Do not...")
- The partial should be generic enough to append to any prompt without modification
