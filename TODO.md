# Remove vendored skills; add `gtd setup` subcommand to install required skills

Today the `new-todo` and `modified-todo` prompts append the full
`grill-with-docs` methodology inline (see `src/prompts/grill-with-docs.md`,
wired in `src/Prompt.ts:46`). That vendored text bloats every planning prompt
and duplicates content that already exists upstream as an agent "skill".

Goal: stop vendoring skill text into prompts. The main prompts reference the
skill by name only (e.g. "Use the `grill-with-docs` skill"). A new `gtd setup`
subcommand emits a one-shot prompt that tells the agent to install the skills
`gtd` relies on, via [skills.sh](https://www.skills.sh/).

## High-level changes

- Delete `src/prompts/grill-with-docs.md` and the `branchesNeedGrillAppendix`
  branch in `src/Prompt.ts`.
- Edit `new-todo.md` and `modified-todo.md` so they reference the skill **by
  name only** (`grill-with-docs`) — no URL, no fallback instructions. First-time
  users are expected to have run `gtd setup` once.
- Add a `setup` subcommand to `src/main.ts`:
  - Dispatch inline via `process.argv[2]` — no new module yet.
  - When invoked, emit a state-independent prompt and exit. No `## Context`
    block, no diff, no git access, no commit instructions.
  - The prompt tells the agent to:
    1. Check whether [skills.sh](https://www.skills.sh/) (the skill installer)
       is available, and install it if not.
    2. Use it to install each required skill, skipping ones already present.
    3. Verify every required skill is installed before reporting done.
    4. Do not stage or commit anything in the current repo.
  - The list of required skills lives in a data-driven array in code (single
    entry for now: `grill-with-docs`) so adding more skills later is one line.
  - Unknown subcommands print a short usage line to stderr and exit non-zero;
    no silent fallback to the default prompt.
- Update `README.md`: drop the "appendix with the grill-with-docs methodology
  vendored inline" bullet; document `gtd setup`; mention that first-time users
  should run `gtd setup | claude` once before piping plans.
- Update cucumber scenarios in `tests/integration/` to drop the appendix
  assertion and cover both `gtd setup` and the unknown-subcommand error path.

## Open Questions

### What does skills.sh look like on disk — a CLI binary, an npm package, a curl-installable script?

**Recommendation:** Treat it as a CLI named `skills` discoverable on `$PATH`,
per the [skills.sh](https://www.skills.sh/) landing page. The setup prompt
instructs the agent to: run `which skills` (or equivalent), follow the
installer documented at <https://www.skills.sh/> if missing, then run `skills
install <name>` for each required skill. We don't hardcode the install command
into the prompt — we point at the website and let the agent read the
canonical instructions. Avoids prompt rot if upstream changes its install
recipe.

<!-- user answers here -->

### Where should the required-skills list live in source?

**Recommendation:** A top-level `const REQUIRED_SKILLS = ["grill-with-docs"]`
in `src/main.ts` (or a small `src/Skills.ts` if it grows). Keep it as a flat
string array — no metadata yet. The setup prompt interpolates the array into a
markdown bullet list. When a future prompt references a new skill, the author
adds one line here.

<!-- user answers here -->

### Should `gtd setup` need to run inside a git repo?

**Recommendation:** No. The default `gtd` command depends on `GitService` to
read state, but `setup` is state-independent. Dispatch the subcommand
**before** providing `GitService.Live` in `main.ts` so it works in any
directory. This also means `setup` can't fail with "not a git repo" — which is
the right UX for a one-time install command.

<!-- user answers here -->

### Exactly what usage string does the unknown-subcommand error print?

**Recommendation:**

```
gtd: unknown subcommand '<x>'
usage: gtd [setup]
```

Single-line subcommand list keeps it scannable; bracket notation signals
"optional argument"; matches the existing error formatting in
`src/main.ts:18`.

<!-- user answers here -->

### Should the cucumber suite get a new feature file for `setup`, or extend an existing one?

**Recommendation:** New `tests/integration/features/setup.feature`. The other
features key off git state; `setup` is orthogonal and asserting different
content (skill install instructions, no diff, no header). A separate file
keeps Given/Then scenarios composable per the `AGENTS.md` testing rules.

<!-- user answers here -->
