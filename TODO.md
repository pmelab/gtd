# Remove vendored skills; add a separate subcommand to install required skills

Today the `new-todo` and `modified-todo` prompts append the full
`grill-with-docs` methodology inline (see `src/prompts/grill-with-docs.md`,
wired in `src/Prompt.ts:46`). That vendored text bloats every planning prompt
and duplicates content that already exists upstream as an agent "skill".

Goal: stop vendoring skill text into prompts. Instead, the main prompts assume
the agent has the skill installed and just reference it by name. A **separate
subcommand** emits a prompt that tells the agent to install the skills `gtd`
relies on.

## High-level changes

- Delete `src/prompts/grill-with-docs.md` and the `branchesNeedGrillAppendix`
  branch in `src/Prompt.ts`.
- Edit `new-todo.md` and `modified-todo.md` so they reference the skill by name
  instead of pointing at the appendix ("use the grill-with-docs skill" rather
  than "follow the methodology in the appendix below").
- Add a new subcommand to `src/main.ts` — running `gtd <subcommand>` emits a
  prompt that instructs the agent to install whatever skills the main prompts
  reference, and exits. The default `gtd` (no args) keeps emitting the
  state-driven prompt.
- Update `README.md`: drop the "appendix with the grill-with-docs methodology
  vendored inline" bullet, document the new subcommand, and add it to the
  installation/setup section.
- Update cucumber scenarios in `tests/integration/` to drop the appendix
  assertion and add coverage for the new subcommand.

## Open Questions

### What should the install subcommand be called?

**Recommendation:** `gtd install-skills`. Verb-object form matches `npm install`
mental model; explicit about what it does. Alternatives considered: `gtd setup`
(too generic — could mean install the CLI itself), `gtd skills` (noun-only,
ambiguous between list/install), `gtd init` (collides with the convention that
`init` scaffolds project state, which this doesn't).

<!-- user answers here -->

### Which skills does gtd depend on today, and which need install instructions?

**Recommendation:** Only `grill-with-docs` for now — it's the sole vendored
appendix. Keep the install subcommand's skill list data-driven (an array in
code) so future prompts that reference more skills only need to extend that
list.

<!-- user answers here -->

### What does "install a skill" actually mean — which agent runtime do we target?

**Recommendation:** Target Claude Code's skill system (this repo's primary
audience per `README.md` examples piping to `claude`). The install prompt tells
the agent to fetch the skill from its upstream repo
(`github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs`)
and place it under `~/.claude/skills/<name>/` following the standard skill
layout. We don't shell out or download ourselves — the agent does the work,
matching gtd's "we emit prompts, we don't act" philosophy.

<!-- user answers here -->

### Should the install subcommand check what's already installed, or always emit the full prompt?

**Recommendation:** Always emit the full prompt. gtd has no filesystem access to
`~/.claude/skills/` in the general case (the agent might not even be running on
the same machine — the prompt could be piped over SSH or pasted into a web UI).
The install prompt should tell the agent "check whether each skill is present,
install only the missing ones." Keeps gtd stateless.

<!-- user answers here -->

### Should the main `gtd` prompt warn the user when a referenced skill might not be installed?

**Recommendation:** No. Adding a runtime check would require gtd to know where
skills live for every supported agent runtime, which contradicts the
agent-agnostic stance. Instead, the README documents that first-time users
should run `gtd install-skills | claude` once before piping plans. The
skill-referencing prompts can include a one-liner like "if you don't have this
skill, run `gtd install-skills` first" so the agent can self-correct.

<!-- user answers here -->

### Should `gtd install-skills` accept the same state context (diff, last commit) as the default command?

**Recommendation:** No. The install prompt is state-independent — skills don't
depend on what's in the working tree. Skip the `## Context` block, the diff, and
the conventional-commits header for this subcommand; just emit the skill-install
instructions. Keeps the prompt short and the subcommand runnable outside a git
repo.

<!-- user answers here -->

### Should the install prompt commit anything, or is installation a side-effect?

**Recommendation:** No commit. Skills live under `~/.claude/skills/` (user
home), not in the project repo, so there's nothing to commit. The install prompt
should explicitly tell the agent "do not stage or commit anything in the current
repo."

<!-- user answers here -->

### How should the grill prompts reference the skill — by name only, or with a URL?

**Recommendation:** By name with a short fallback URL in parentheses, e.g.
"Use the `grill-with-docs` skill (see
<https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs>
if not installed)." Name-only risks confusing agents that lack the skill; URL
gives them a recovery path without re-vendoring the whole methodology.

<!-- user answers here -->

### Do we keep `grill-with-docs.md` in the repo for any reason (tests, docs)?

**Recommendation:** Delete it. It's no longer imported by any prompt; tests that
assert on its content should be removed alongside it. The upstream repo is the
source of truth.

<!-- user answers here -->

### Should the subcommand dispatch live in `main.ts` or a new module?

**Recommendation:** Inline in `main.ts` for now — a single
`if (process.argv[2] === "install-skills")` branch keeps things proportional to
one subcommand. Extract a `Cli.ts` module only when a second subcommand lands.
Matches the project's "do exactly what the task requires" rule in `AGENTS.md`.

<!-- user answers here -->

### What happens on `gtd <unknown-subcommand>`?

**Recommendation:** Print a short usage line to stderr listing valid subcommands
and exit non-zero. Don't silently fall back to the default prompt — that hides
typos. Mirror the existing error path in `main.ts:16-21`.

<!-- user answers here -->
