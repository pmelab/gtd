# Turn the whole project into a skill that uses its script internally

Today `gtd` ships as an npm-installed CLI; users pipe its output to an agent
(`gtd | claude`). The previous design iteration added a `gtd setup` subcommand
that emits an install prompt for skills.sh and a `/gtd` slash command — a
patchwork to bridge the CLI into an agent's command surface.

Pivot: drop the bridging layer. The whole project **becomes** a
[skills.sh](https://www.skills.sh/)-installable agent skill that uses the
`gtd` script internally. The user installs one thing (`skills install
github.com/pmelab/gtd`) and the agent gains a self-contained capability that
knows when to invoke the script, parse its output, and follow the emitted
prompt — no separate CLI install, no `gtd setup`, no `/gtd` slash command.

## High-level changes (sketch — heavily contingent on Open Questions below)

- Add a top-level `SKILL.md` (or skill manifest in whatever shape skills.sh
  expects) describing when the skill should fire ("user wants to take the
  next gtd-style step on the current repo") and what it does.
- The skill body invokes the `gtd` binary internally — either by bundling a
  prebuilt artifact in the skill, or by requiring it on `$PATH`. The agent
  reads the script's stdout and follows the embedded prompt.
- Decide what happens to the standalone CLI distribution:
  - **Option A:** Skill bundles the prebuilt `dist/gtd.js` and runs it via
    `node`. No separate npm install needed.
  - **Option B:** Skill assumes `gtd` is on `$PATH`. Keeps the npm
    distribution; skill is a thin wrapper.
  - **Option C:** Skill bundles the source and runs via the agent's local
    Node, building on first use. Heaviest, most flexible.
- Delete the `gtd setup` subcommand and `src/Setup.ts` / `src/prompts/setup.md`
  / setup-related cucumber scenarios — the skill itself **is** the install
  artifact, so a self-install subcommand is circular.
- Delete or rewrite the `/gtd` slash-command bridge work that was in flight —
  invoking a skill from chat is the canonical entry point now.
- Restructure the repo so the skill is the primary artifact:
  - `SKILL.md` at the root (or in a `skill/` directory if skills.sh prefers).
  - The CLI source moves to `cli/` (or stays in `src/` if Option B keeps the
    standalone npm package alive).
- README is rewritten around "install with skills.sh, then ask your agent to
  take the next step."

## Open Questions

### Should we keep the standalone CLI distribution, or fold it entirely into the skill?

**Recommendation:** Fold it in (Option A). Bundle a prebuilt `dist/gtd.js`
inside the skill so the user installs exactly one thing. The CLI's user
audience today is "people piping into an agent" — they don't run `gtd` by
itself. Keeping the npm package alive doubles the maintenance surface
(release process, versioning sync) for negligible reach. We can always
publish later if a non-agent use case appears.

<!-- user answers here -->

### What runtime does the skill assume — Node, or "whatever the agent's host has"?

**Recommendation:** Assume Node ≥ 20 (matches current `package.json`
`engines`). The skill body shells out to `node dist/gtd.js`. skills.sh
installs run on the user's machine, where Node availability is a reasonable
ask for the target audience (developers already running agents). If the
skill needs to run on a Node-less host, that's a separate problem we can
solve later by compiling to a single binary (e.g. `bun build --compile`).

<!-- year answers here -->

### Where does the skill live — same repo, or split out?

**Recommendation:** Same repo, root-level `SKILL.md`. The skill and the
script are tightly coupled (skill shells into the script and depends on its
output format). Splitting would mean cross-repo version drift. skills.sh
installs from a git URL pointing at a directory, so a single repo with
`SKILL.md` at the root works directly.

<!-- user answers here -->

### What is the skill's trigger description — when should the agent decide to use it?

**Recommendation:** Something like:

> Use when the user wants to take the next step in a git-aware,
> conventional-commits workflow on the current repo — planning a feature,
> refining a plan, committing pending changes, or running the test suite.
> Triggers on phrases like "take the next step", "what's next", "gtd", or
> running it after `TODO.md` changes.

The phrasing matters because skills.sh decides whether to fire based on this
text. Should be revisited after the first round of real usage.

<!-- user answers here -->

### Does this kill `gtd setup` and the `/gtd` slash command?

**Recommendation:** Yes, both. The skill replaces them:

- `gtd setup` existed to install skills + a slash command — but if `gtd`
  itself is a skill, the user already used skills.sh to install it, so the
  installer step is moot. The slash command was a UX shortcut into the
  agent; a skill is the canonical shortcut.
- Delete `src/Setup.ts`, `src/Setup.test.ts`, `src/prompts/setup.md`, the
  `setup` subcommand dispatch in `src/main.ts`, and
  `tests/integration/features/setup.feature`.
- The skill still needs to ensure `grill-with-docs` is installed; the
  skill's own dependency declaration (whatever skills.sh supports) handles
  that, rather than us writing a prompt that tells the agent to do it.

<!-- user answers here -->

### What's the format of a skills.sh skill — `SKILL.md` with frontmatter, a directory layout, something else?

**Recommendation:** Treat this as an unknown that needs verification before
implementation. Action item before any code change: read
<https://www.skills.sh/> docs and inspect a real example (e.g.
`github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs`)
to learn the canonical layout. The plan above assumes `SKILL.md` at the
repo root, but that's a guess.

<!-- user answers here -->

### How does the skill invoke the script and surface its output to the agent?

**Recommendation:** Depends on what skills.sh's runtime model is — whether
skill bodies are pure prompts the agent reads, or whether they can execute
commands. If pure prompts: the skill body instructs the agent to run
`node dist/gtd.js` itself and follow the output. If executable: the skill
runs the script and returns its stdout to the agent. Either way the
contract is the same from the user's perspective. Resolve this together
with the previous question.

<!-- user answers here -->

### Does removing the npm package break existing users?

**Recommendation:** Likely yes for anyone who installed via `npm install -g
githingsdone`, but adoption is probably very low (this is the user's own
project, fresh rewrite). Bump major version, note breaking change in README,
move on. No deprecation pipeline needed.

<!-- user answers here -->
