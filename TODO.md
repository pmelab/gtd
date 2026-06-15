# Remove vendored skills; add `gtd setup` subcommand to install required skills

Today the `new-todo` and `modified-todo` prompts append the full
`grill-with-docs` methodology inline (see `src/prompts/grill-with-docs.md`,
wired in `src/Prompt.ts:46`). That vendored text bloats every planning prompt
and duplicates content that already exists upstream as an agent "skill".

Goal: stop vendoring skill text into prompts. The main prompts reference the
skill by short name only (e.g. "Use the `grill-with-docs` skill"). A new `gtd
setup` subcommand emits a one-shot prompt that tells the agent to install the
skills `gtd` relies on, via [skills.sh](https://www.skills.sh/) — passing the
upstream **git URL** of each skill as the install identifier.

## High-level changes

- Delete `src/prompts/grill-with-docs.md` and the `branchesNeedGrillAppendix`
  branch in `src/Prompt.ts`.
- Edit `new-todo.md` and `modified-todo.md` so they reference the skill **by
  short name only** (`grill-with-docs`) — no URL, no fallback instructions.
  First-time users are expected to have run `gtd setup` once.
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
       command — we point at the website so we don't rot when upstream
       changes its install recipe.
    2. Use `skills install <git-url>` for each required skill, skipping ones
       already present.
    3. Verify every required skill is installed before reporting done.
    4. Do not stage or commit anything in the current repo.
  - The list of required skills lives as a simple `const REQUIRED_SKILLS`
    array (single entry for now) holding the **git URLs** of the skills.
    Initial value:
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
    prompt (skill URLs present, no diff, no header) and the
    unknown-subcommand error path. Separate file keeps Given/Then scenarios
    composable per `AGENTS.md`.

## Open Questions

### Does `skills install` actually accept a git URL — or only a short name?

**Recommendation:** Assume it accepts the git URL. The setup prompt should
pass the URL verbatim so the agent doesn't have to translate. If skills.sh
turns out to require a short name, the agent can fall back to deriving the
last path segment of the URL — but we don't pre-empt that in the prompt; we
let the agent handle the failure mode. If we discover during implementation
that URLs aren't supported, flip the array to short-name form and revisit.

<!-- user answers here -->

### Is the upstream URL stable — should we pin to a commit/tag instead of `tree/main`?

**Recommendation:** Use `tree/main` (unpinned). The skill is itself a moving
target — pinning would mean we ship stale grill methodology. If upstream
breaks the skill contract, that's a real signal to revisit, not a reason for
us to freeze a snapshot. Match how most "install from a git URL" tooling
behaves by default.

<!-- user answers here -->

### Should the short name used in the planning prompts (`grill-with-docs`) and the URL stay in sync automatically?

**Recommendation:** No mechanism — keep them as two independent values. The
short name lives in `new-todo.md`/`modified-todo.md` as plain prose; the URL
lives in `REQUIRED_SKILLS`. Coupling them would mean parsing the URL or
introducing a `{name, url}` record. For one skill, the duplication is
trivial; for many, we'd revisit then. Drift risk is low because both refer to
the same upstream skill name by convention.

<!-- user answers here -->
