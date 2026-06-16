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
- No explicit skill-dependency mechanism. Per the user's direction, we do
  **not** bootstrap `grill-with-docs` ourselves — we just use wording in
  the SKILL.md and the emitted prompts that should trigger the
  grill-with-docs skill if it's installed.

## High-level changes

- Add a root-level `SKILL.md`:
  - Frontmatter:
    - `name: gtd`
    - `description`: trigger phrasing covering "take the next step",
      "what's next", "gtd", `/gtd`, plus a sentence about the workflow
      (git-aware conventional-commits planning/build/commit/test loop).
    - `compatibility: Requires Node 20+`
    - `allowed-tools: Bash(node:*)` (experimental, but cheap to add).
  - Body:
    1. State the contract: run the bundled script and follow its emitted
       prompt verbatim.
    2. Show the exact invocation as a relative path: `node scripts/gtd.js`
       (run with the user's git repo as CWD).
    3. Note that the emitted prompt may reference grilling/methodology
       wording that aligns with the `grill-with-docs` skill — leave the
       wording in place so that skill engages if installed; do not try to
       install it ourselves.
- Put the built artifact at `scripts/gtd.js` (per the spec's `scripts/`
  convention) instead of `dist/`. Update `tsup.config.ts` accordingly and
  commit `scripts/gtd.js` so `npx skills add pmelab/gtd` works zero-step.
- Restructure the repo:
  ```
  SKILL.md          ← skill manifest + body (new)
  scripts/gtd.js    ← prebuilt CLI artifact, checked in (was dist/gtd.js)
  cli/              ← TypeScript sources (was src/)
  cli-tests/        ← vitest specs (was src/*.test.ts) [or keep alongside cli/]
  tests/integration ← cucumber e2e (unchanged in spirit; setup feature removed)
  ```
- Delete the now-redundant pieces:
  - `src/Setup.ts`, `src/Setup.test.ts`, `src/prompts/setup.md`.
  - The `setup` subcommand dispatch in `src/main.ts` (and unknown-subcommand
    error path, since no subcommands remain).
  - `tests/integration/features/setup.feature`.
- Drop the npm-package distribution entirely: set `"private": true` in
  `package.json` and remove `bin`, `exports`, `publishConfig`, `files`.
- Rewrite README:
  - Lead: `npx skills add pmelab/gtd -g -y`.
  - How invocation works (`/gtd` or trigger phrase).
  - Mention that the `grill-with-docs` skill — if installed — engages for
    the planning phases; no auto-install.
- Add a `.gitattributes` line marking `scripts/gtd.js` as
  `linguist-generated` so GitHub diffs collapse it.
- Add CI / contributor-doc note: rebuild `scripts/gtd.js` before tagging,
  since it's checked in.

## Open Questions

### Should we keep `dist/` as the tsup build target and copy to `scripts/`, or change tsup to emit directly to `scripts/`?

**Recommendation:** Change tsup's target to `scripts/`. One artifact in
one place; no copy step. The `scripts/` name is dictated by the skill
spec; `dist/` becomes a vestigial intermediate, so we just remove it.

<!-- user answers here -->

### Should we keep the `cli/`-style source-directory rename, or leave sources in `src/`?

**Recommendation:** Leave them in `src/`. The skill spec doesn't care
where unreferenced source files live — only `SKILL.md` and the directories
it references matter. Renaming `src/` to `cli/` is churn with no payoff.

<!-- user answers here -->

### What exactly should the `description` field say?

**Recommendation:** Draft:

> Use when the user wants to take the next git-aware,
> conventional-commits step on the current repo — planning with `TODO.md`,
> refining a plan, committing pending changes, running the test suite, or
> when they type "gtd", "what's next", or "/gtd". Composes with the
> grill-with-docs skill during planning phases.

Concrete enough for trigger matching, mentions grill-with-docs by name so
that skill's description matcher can also engage when relevant. Cap at
1024 chars per spec; this is well under.

<!-- user answers here -->

### Should we declare `allowed-tools: Bash(node:*)` even though it's experimental?

**Recommendation:** Yes. The cost is zero in agents that don't
recognize the field, and a real UX win (no approval prompt) in those
that do. Pre-approve only the narrowest pattern needed.

<!-- user answers here -->

### Should the SKILL.md body inline the description of the gtd workflow (state machine), or stay terse and let the script's output do the talking?

**Recommendation:** Stay terse. The script's output is already a
self-contained prompt with full conventions and task sections. Duplicating
that in SKILL.md would double the maintenance surface and risk drift.
Body should be ~10-20 lines: contract, command, brief note about the
grill-with-docs interaction.

<!-- user answers here -->

### What happens to the `Prompt.test.ts` "does not vendor the grill methodology" assertion — does it still apply?

**Recommendation:** Yes, keep it. The assertion remains correct (no
appendix in emitted prompts). Skill-spec changes are orthogonal to what
the script emits.

<!-- user answers here -->
