# Turn the whole project into a skill that uses its script internally

Today `gtd` ships as an npm-installed CLI; users pipe its output to an agent
(`gtd | claude`). Pivot: drop the bridging layer. The whole project **becomes**
a [skills.sh](https://www.skills.sh/) / Agent-Skills-Spec compliant skill that
uses the `gtd` script internally. The user installs one thing
(`npx skills add pmelab/gtd -g -y`) and the agent gains a self-contained
capability that knows when to invoke the script and follow the emitted prompt.

## Confirmed facts (from skills.sh README + agentskills.io spec + an inspected real skill)

- Install command: `npx skills add <owner/repo[@skill]> [-g] [-y]`. `-g` =
  user-global; `-y` = no prompt. GitHub shorthand `owner/repo` is supported.
- Skill format (Anthropic Agent Skills Spec, which skills.sh follows):

  ```
  skill-name/
  ├── SKILL.md          # required: YAML frontmatter + markdown body
  ├── scripts/          # optional: executable code
  ├── references/       # optional: documentation
  ├── assets/           # optional: static resources
  ```

  Root-level `SKILL.md` is a valid layout — skills.sh discovers it.
- **Path-resolution mechanism (the "built-in mechanism" to use):** the
  SKILL.md body references companion files by **relative path from the
  skill root** — e.g. `scripts/gtd.js`. The agent loads the SKILL.md with
  that root as its context and resolves relative paths itself. No env var
  or placeholder needed.
- `name` field must match the **parent directory name**. For a root-level
  SKILL.md, that's the cloned repo name. Repo is `pmelab/gtd`, so
  `name: gtd` and `/gtd` direct invocation both work.
- Relevant frontmatter fields beyond `name`/`description`:
  - `compatibility`: free-form string for environment requirements (e.g.
    `Requires Node 20+`).
  - `allowed-tools` (experimental): space-separated pre-approved tools,
    e.g. `Bash(node:*)`. Skips approval prompts in supporting agents.
- Body guidance: keep `SKILL.md` under ~500 lines / ~5000 tokens; move
  detailed material into `references/`.
- No skill-dependency mechanism, no inline bootstrap. The script's emitted
  prompts must **organically** trigger the `grill-with-docs` skill if
  installed — by reusing the keywords from grill-with-docs's own
  description (e.g. "grilling session", "walk the design tree",
  "sharpens terminology") — without naming the skill. The grill-with-docs
  description matcher does the rest.

## High-level changes

- Add a root-level `SKILL.md`:
  - Frontmatter:
    - `name: gtd`
    - `description` (no mention of grill-with-docs):

      > Use when the user wants to take the next git-aware,
      > conventional-commits step on the current repo — planning with
      > `TODO.md`, refining a plan, committing pending changes, or
      > running the test suite. Also triggers on "gtd", "what's next",
      > "take the next step", or `/gtd`.
    - `compatibility: Requires Node 20+`
    - `allowed-tools: Bash(node:*)`
  - Body (terse, ~10-20 lines): contract = run the bundled script via
    `node scripts/gtd.js` from the user's git repo CWD and follow the
    emitted prompt verbatim. No mention of grill-with-docs.
- Reword the planning prompts (`src/prompts/new-todo.md`,
  `src/prompts/modified-todo.md`) so the wording **organically** triggers
  grill-with-docs without naming it. Replace phrases like "using the
  `grill-with-docs` skill" with the skill's own description vocabulary —
  "grilling session", "interview the plan", "walk every branch of the
  design tree", "sharpen terminology". The grill-with-docs description
  matcher then engages from the prompt content alone.
- Drop the `Prompt.test.ts` assertion `does not vendor the grill methodology`
  — that assertion was tied to the now-defunct appendix concept and is no
  longer load-bearing.
- Drop the cucumber assertion `stdout contains "`grill-with-docs` skill"`
  in `tests/integration/features/branches.feature` outright (no
  replacement). Asserting on specific organic-trigger vocabulary would
  bake brittle wording into tests; better to leave the planning
  scenarios verifying only the structural pieces.
- Put the built artifact at `scripts/gtd.js` (spec's `scripts/`
  directory). Update `tsup.config.ts` to emit there directly; remove
  `dist/` from the build. Commit `scripts/gtd.js` so
  `npx skills add pmelab/gtd` is zero-step.
- Update `tests/integration/support/world.ts` to point at
  `scripts/gtd.js` (was `dist/gtd.js`) in the same commit that moves the
  build target.
- Leave sources in `src/` — the skill spec doesn't care about
  unreferenced directories.
- Delete the now-redundant pieces:
  - `src/Setup.ts`, `src/Setup.test.ts`, `src/prompts/setup.md`.
  - The `setup` subcommand dispatch + unknown-subcommand error path in
    `src/main.ts` (no subcommands remain — `main.ts` returns to the
    simple "build prompt from git state and print" shape).
  - `tests/integration/features/setup.feature`.
- Drop the npm-package distribution entirely: set `"private": true` in
  `package.json` and remove `bin`, `exports`, `publishConfig`, `files`.
- Rewrite README:
  - Lead: `npx skills add pmelab/gtd -g -y`.
  - How invocation works (`/gtd` or trigger phrase).
  - No mention of grill-with-docs (organic trigger only).
- Add a `.gitattributes` line marking `scripts/gtd.js` as
  `linguist-generated` so GitHub diffs collapse it.
- Add a contributor-doc note: rebuild `scripts/gtd.js` before tagging,
  since it's checked in.
