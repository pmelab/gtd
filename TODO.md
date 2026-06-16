# Turn the whole project into a skill that uses its script internally

Today `gtd` ships as an npm-installed CLI; users pipe its output to an agent
(`gtd | claude`). The previous design iteration added a `gtd setup` subcommand
that emits an install prompt for skills.sh and a `/gtd` slash command — a
patchwork to bridge the CLI into an agent's command surface.

Pivot: drop the bridging layer. The whole project **becomes** a
[skills.sh](https://www.skills.sh/)-installable agent skill that uses the
`gtd` script internally. The user installs one thing
(`npx skills add pmelab/gtd -g`) and the agent gains a self-contained
capability that knows when to invoke the script and follow the emitted prompt
— no separate CLI install, no `gtd setup`, no separately-installed slash
command.

## Confirmed skills.sh facts (from upstream docs + an inspected real skill)

- Source of truth: <https://github.com/vercel-labs/skills>; install CLI is
  `npx skills` (alias for skills.sh).
- Install command: `npx skills add <owner/repo[@skill-name]> [-g] [-y]`.
  `-g` = user-global; `-y` = no prompt. The `@skill-name` suffix selects one
  skill from a multi-skill repo. A repo with one skill at the root probably
  installs as `npx skills add <owner/repo> -g`, though we should verify.
- Skill format: a directory containing a `SKILL.md` file. The file has YAML
  frontmatter with `name` and `description`, followed by markdown body.
  Example (from `vercel-labs/skills/skills/find-skills/SKILL.md`):

  ```markdown
  ---
  name: find-skills
  description: Helps users discover and install agent skills when they ask
    "how do I do X", "find a skill for X", …
  ---

  # Find Skills

  ## When to Use This Skill

  …
  ```

- The `description` is the trigger text the agent matches against user
  intent. Phrasing matters; the field also accepts direct invocation by name
  (e.g. typing `/find-skills`).
- The skill body is **pure markdown / pure prompt**. The agent reads the
  body and decides which shell commands to run. There is no executable
  skill manifest; "the skill runs the script" means "the skill body
  instructs the agent to run the script."
- No explicit dependency-declaration mechanism observed. If our skill needs
  `grill-with-docs`, the SKILL.md body has to instruct the agent to
  `npx skills add ... -g -y` it.

## High-level changes

- Restructure the repo so the skill is the primary artifact. Skill files
  live at the repo root (single-skill repo):

  ```
  SKILL.md          ← skill manifest + body
  dist/gtd.js       ← prebuilt CLI artifact, shipped checked-in
  cli/              ← TypeScript sources (was src/)
  cli-tests/        ← vitest specs (was src/*.test.ts)
  tests/integration ← cucumber e2e (unchanged)
  ```

  `dist/gtd.js` is committed so `npx skills add pmelab/gtd` works without a
  post-install build step.
- Author `SKILL.md`:
  - `name: gtd` (matches `/gtd` direct invocation per the user's
    requirement).
  - `description`: explicit about the workflow. Draft:

    > Use when the user wants to take the next step in a git-aware,
    > conventional-commits workflow on the current repo — planning a
    > feature, refining a plan, committing pending changes, or running
    > tests. Also triggers on phrases like "take the next step", "what's
    > next", "gtd", or `/gtd`.
  - Body (the prompt the agent reads when the skill fires):
    1. Locate the bundled `gtd` script. For a skill installed globally
       this is `~/.skills/pmelab/gtd/dist/gtd.js` (exact path to be
       confirmed during implementation).
    2. Run `node <path-to-dist>/gtd.js` in the user's current working
       directory.
    3. Follow the emitted prompt verbatim.
- Delete the now-redundant pieces:
  - `src/Setup.ts`, `src/Setup.test.ts`, `src/prompts/setup.md`.
  - `setup` subcommand dispatch in `src/main.ts`.
  - `tests/integration/features/setup.feature`.
  - The README "Once, before piping plans, install the agent skills…"
    section.
- Drop the npm-package distribution. Remove `bin`, `exports`,
  `publishConfig` from `package.json` (or rewrite the package as
  build-only). User has confirmed no userbase, so no deprecation path.
- Update README to lead with `npx skills add pmelab/gtd -g -y` and how the
  agent invokes the skill (by direct `/gtd` or by trigger phrase).
- The grill-with-docs dependency: the SKILL.md body's first step instructs
  the agent to ensure `grill-with-docs` is installed via
  `npx skills add mattpocock/skills@grill-with-docs -g -y` if absent. Same
  pattern as before but in-skill rather than in a separate setup prompt.
- CI / build:
  - `npm run build` keeps producing `dist/gtd.js`.
  - Add a `prepublish`-style script (or just a contributor doc step) that
    rebuilds `dist/` before tagging a release, since `dist/` is checked in.

## Open Questions

### Does `npx skills add pmelab/gtd` work for a single-skill repo with `SKILL.md` at the root, or do we need `skills/gtd/SKILL.md`?

**Recommendation:** Default to root-level `SKILL.md` (Option A) and verify
during implementation by running `npx skills add ./` against the working
tree locally before pushing. If skills.sh requires a `skills/` subdirectory,
switch to `skills/gtd/SKILL.md` and document the install URL as
`npx skills add pmelab/gtd@gtd -g -y`. Either way, the install command in
the README is the only place this leaks.

<!-- user answers here -->

### Where exactly does skills.sh install a skill on disk, and what's the working directory when the agent invokes it?

**Recommendation:** Unknown precisely; the `find-skills` SKILL.md doesn't
specify. Resolve by installing a known skill (`npx skills add
vercel-labs/skills@find-skills -g -y`) and inspecting `~/.skills/`,
`~/.config/skills/`, or wherever it lands. The SKILL.md body should
reference the bundled script relative to its own location using whatever
convention skills.sh exposes (likely `${SKILL_DIR}/dist/gtd.js` or
similar). If no env var is exposed, fall back to instructing the agent to
locate the file via `which` / `find` against a known fixed install root.

<!-- user answers here -->

### Should `dist/gtd.js` be committed to the repo, or built at install time?

**Recommendation:** Commit it. skills.sh has no documented post-install
hook, so building on install isn't a clean option. Checking `dist/` in
adds noise to PR diffs but keeps install zero-step. Mitigate with a
`.gitattributes` line marking `dist/gtd.js` as `linguist-generated` to
hide it from GitHub diffs, and a CI check that the committed `dist/` is
up to date with `cli/` sources.

<!-- user answers here -->

### Should the SKILL.md body bootstrap the `grill-with-docs` skill inline, or rely on a documented prerequisite in the README?

**Recommendation:** Bootstrap inline. The cost is two extra lines in
SKILL.md ("if grill-with-docs is missing, install it"). The benefit is
single-command setup — the user runs `npx skills add pmelab/gtd -g -y`
and the skill self-heals on first use. README still mentions the
dependency for transparency.

<!-- user answers here -->

### Do we keep the `githingsdone` npm package alive in any form (e.g. as a build-time dependency for ourselves), or remove it entirely from the npm registry?

**Recommendation:** Remove from npm entirely. User has no userbase. Keep
`package.json` as a local-only build manifest (no `bin`, no `exports`, no
`publishConfig`, `"private": true`). Saves us from accidental publishes
and signals the new distribution model.

<!-- user answers here -->

### Should the previously-shipped `setup` subcommand stay available as a deprecated no-op for one release, or be deleted outright?

**Recommendation:** Delete outright. No userbase; "deprecated for one
release" exists to protect a deprecation pipeline that doesn't apply
here. Cleaner diff, less code to test.

<!-- user answers here -->

### Note: the `grill-with-docs` URL we used previously (`github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs`) does **not** match the skills.sh install syntax (`owner/repo@skill`). Should we fix that in any still-relevant places before this refactor lands?

**Recommendation:** The mismatch is in `src/Setup.ts`'s `REQUIRED_SKILLS`
constant and in `setup.feature`. Since those files are being deleted as
part of this work, we don't need to fix them — they go away. If we
discover any other still-living references during the refactor, fix in
place.

<!-- user answers here -->
