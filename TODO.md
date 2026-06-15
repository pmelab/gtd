# Remove vendored skills; add `gtd setup` subcommand to install required skills

Today the `new-todo` and `modified-todo` prompts append the full
`grill-with-docs` methodology inline (see `src/prompts/grill-with-docs.md`,
wired in `src/Prompt.ts:46`). That vendored text bloats every planning prompt
and duplicates content that already exists upstream as an agent "skill".

Goal: stop vendoring skill text into prompts. The main prompts reference the
skill by short name only (e.g. "Use the `grill-with-docs` skill"). A new
`gtd setup` subcommand emits a one-shot prompt that tells the agent to install
the skills `gtd` relies on, via [skills.sh](https://www.skills.sh/) — passing
the upstream **git URL** of each skill (unpinned, `tree/main`) as the install
identifier, which the `skills` CLI accepts directly.

## High-level changes

- Delete `src/prompts/grill-with-docs.md` and the `branchesNeedGrillAppendix`
  branch in `src/Prompt.ts`.
- Edit `new-todo.md` and `modified-todo.md` so they reference the skill **by
  short name only** (`grill-with-docs`) — no URL, no fallback instructions.
  First-time users are expected to have run `gtd setup` once. The short name
  in the planning prompts and the URL in `REQUIRED_SKILLS` are kept as two
  independent values; no syncing mechanism for a single skill.
- Add a `setup` subcommand to `src/main.ts`:
  - Dispatch inline via `process.argv[2]` — no new module yet. Subcommand
    dispatch happens **before** providing `GitService.Live`, so `setup` works
    outside a git repo.
  - When invoked, emit a state-independent prompt and exit. No `## Context`
    block, no diff, no git access, no commit instructions.
  - The prompt tells the agent to:
    1. Check whether [skills.sh](https://www.skills.sh/) (the `skills` CLI on
       `$PATH`) is available, and follow the installer at
       <https://www.skills.sh/> if missing. We do not hardcode the install
       command — we point at the website so we don't rot when upstream changes
       its install recipe.
    2. Use `skills install <git-url>` for each required skill, skipping ones
       already present.
    3. Verify every required skill is installed before reporting done.
    4. Do not stage or commit anything in the current repo.
  - The list of required skills lives as a simple `const REQUIRED_SKILLS` array
    (single entry for now) holding the **git URLs** of the skills, unpinned
    (`tree/main` — the skill itself is a moving target; pinning would ship
    stale methodology). Initial value:
    `["https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs"]`.
    Adding a new skill is one line.
  - Unknown subcommands print to stderr and exit non-zero — no silent fallback
    to the default prompt. Format:

    ```
    gtd: unknown subcommand '<x>'
    usage: gtd [setup]
    ```

- Update `README.md`: drop the "appendix with the grill-with-docs methodology
  vendored inline" bullet; document `gtd setup`; mention that first-time users
  should run `gtd setup | claude` once before piping plans.
- Update cucumber scenarios in `tests/integration/`:
  - Drop the appendix assertion from existing planning scenarios.
  - Add a new `tests/integration/features/setup.feature` covering the install
    prompt (skill URLs present, no diff, no header) and the unknown-subcommand
    error path. Separate file keeps Given/Then scenarios composable per
    `AGENTS.md`.
