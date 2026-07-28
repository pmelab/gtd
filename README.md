# gi[t]hings.**done**

> „Fix all the tests." „✅ All tests pass!" „The E2E suite is red." „Ah, you
> mean _those_ tests."

**Chat is a terrible source of truth. Git isn't.**

**gtd** is a git-aware CLI that derives the entire agentic workflow — capture,
plan, build, test, review — from your repository state, and prints the next
prompt for whatever agent you point at it. Every step is a commit. Tests are run
by the tool and branched on by exit code, so the agent never grades its own
homework.

No chat scrollback. No lost sessions. No infinite fix loops. Just git.

## Why

- **Durable & replayable.** The workflow state _is_ your git history — a pure
  fold over commit subjects and the working tree. Kill the session, reboot, come
  back next week: run `gtd` and it resumes exactly where it stopped.
- **Shareable.** Push the branch, and the workflow travels with it — the state
  lives in the commits, so another machine (or another person) picks up exactly
  where you left off.
- **Files, not chat.** Plans live in `.gtd/TODO.md`. Request changes by editing
  it, approve by leaving the tree clean — all in your own editor. There is no
  chat UI to lose.
- **Harness agnostic.** gtd emits prompts to stdout (or JSON). Claude Code, a
  bash loop, a CI job, or you reading it out loud — the workflow doesn't care
  who executes it.
- **Bounded, not runaway.** Fix attempts are capped (`retry` on a state). When
  the cap is hit, gtd redirects to a human gate instead of burning tokens
  rewriting the same test for the 47th time.
- **Your call on history.** Every intermediate `gtd(actor): from → to` commit is
  a real, attributed commit — the subject names both the state the work was done
  in and where it advanced to, nothing hidden in chat. Squash them into one
  conventional commit if you want that (an interactive rebase, an amend, a PR's
  squash-merge, or a custom workflow with a `commit:` finale), or don't — gtd
  makes no assumption.

## Install

```bash
npm install -g @pmelab/gtd
```

Or run without installing:

```bash
npx @pmelab/gtd
```

Then scaffold a workflow for the repo — run once:

```bash
gtd init simple      # or: gtd init advanced
```

This writes a `.gtdrc.json` for the chosen workflow, with each agent state's
prompt saved as an editable Markdown file under `gtd-prompts/` and referenced
from the config (review and commit both). Edit a prompt by editing its
`gtd-prompts/*.md` file — no config edit needed. It also seeds a top-level
`modes:` block suggesting **Prettier** as the steering-file formatter
(`npx prettier --write` for the built-in `qa`/`review` modes — format only, so
gtd still validates); edit or drop it freely (swap in dprint, a script, or
delete the key). gtd ships **no** default workflow: a state command run before
`gtd init` fails, pointing you back here. See
[Configuration](docs/configuration.md#gtd-init) for the two templates.

## How it works

gtd is a small **pattern machine**: named states, each awaiting one actor and
carrying one piece of content (a script, a prompt, a message, or a squash commit
template), with an ordered set of change-patterns routing to the next state.
Four commands drive it:

- **`gtd step <actor>`** — authenticate as `<actor>` and perform the one
  transition the pending changes match.
- **`gtd next [--json]`** — print whichever actor is awaited and what they
  should do, without mutating anything.
- **`gtd status`** — a dry-run report of the resolved state and which pattern
  each pending change matches.
- **`gtd review <commitish>`** — start a brand new review process reviewing
  `<commitish>..HEAD` (e.g. a colleague's PR branch), reusing the workflow's
  existing review/feedback machinery over that diff.

`gtd version` (or `gtd --version`/`-v`) prints the installed version and exits;
`gtd help` (or `gtd --help`/`-h`) prints the command list. Both short-circuit
before any repo work, so they run anywhere.

The loop is one beat, repeated: run `gtd next --json` and dispatch on `kind` —
`"message"` means it's a human's move (stop and hand off); `"script"` means the
driver runs `content` itself, then steps its actor; `"prompt"` means feed
`content` to your agent, then run `gtd step <actor>` once it's done. gtd itself
never executes anything — the driver owns running scripts. See
[STATES.md](STATES.md) for the model and [Driving the loop](docs/loop.md) for
the full protocol.

Along the way, the `simple` workflow (`gtd init simple`) develops your sketch
into an implementation plan — asking any open question it can't settle itself
via a deterministic `.gtd/TODO.md` format, validated before it ever reaches you
— builds it, runs your tests (looping on failures), and hands you a
`.gtd/REVIEW.md` checkbox review of the cycle's diff: tick a box to approve that
item, or edit/untick for feedback. The same review flow also has a direct entry
point — `gtd review <commitish>` starts a brand new process reviewing
`<commitish>..HEAD` with no cycle of its own, e.g. a colleague's PR branch.
Approving rests the cycle back at idle, with every turn commit still sitting in
history for you to squash however you like (or not at all; gtd makes no
assumption) — see [STATES.md](STATES.md#10-the-bundled-workflow-templates) for
the full shape. The `advanced` template (`gtd init advanced`) is a heavier
machine — two-phase Q&A planning, an architecture phase, task decomposition, a
per-task build loop, and a squash finale — walked through at
[docs/examples/advanced-workflow.md](docs/examples/advanced-workflow.md). Either
way the workflow is just `.gtdrc` config — edit it or write your own (see
[Configuration](docs/configuration.md)). Both templates route every agent
state's model through two `vars` tiers — `plannerModel` (heavier planning and
review) and `coderModel` (the coding turns) — so you can repoint the models
globally in one place (a `vars:` edit or a `GTD_VAR_plannerModel` override)
instead of per state.

`gtd-loop`, installed alongside `gtd`, is a ready-to-run driver for the whole
protocol — point it at a repo and it runs the loop until it's your turn. It is
the only command you run: at a gate you edit files (answer a plan question, tick
a review box, fix code) and re-launch it, and it captures your edit as its
opening move before driving on — so you never run `gtd step human` by hand. See
[Driving the loop](docs/loop.md).

Before wiring gtd into a repo, note the
[repository requirements](docs/cli.md#repository-requirements) — most
importantly: gitignore everything your scripts write.

Editor integration: `gtd lsp` starts an LSP server over stdio for `.gtd/`
steering files — symbols and check/uncheck actions over a `review`-mode file's
chunks, symbols over a `qa`-mode file's open questions, diagnostics for both
(live as you edit), and a `gtd.openSteeringFile` command that jumps to the
current state's steering file. Config-driven via each state's `file:`/`mode:`
(see [CLI reference](docs/cli.md#gtd-lsp)) — falls back to basename dispatch
(`TODO.md`/`REVIEW.md`) with no config in sight. Those two formats are gtd's
built-in steering-file MODES — validators, not formatters: a mode's `format:`
and `validate:` are shell commands a workflow (or a project's `.gtdrc`) declares
for itself, so you bring your own formatter and your own checkers (see
[Configuration](docs/configuration.md#modes--pluggable-steering-file-modes)).
Both halves are enforced by `gtd validate` and the `gtd step` gate.

## Documentation

- [STATES.md](STATES.md) — the full pattern-machine specification: the model,
  the pattern grammar, resolution, retry, the squash lifecycle, and the bundled
  workflow templates
- [CLI reference](docs/cli.md) — every command, exit codes, JSON schemas,
  repository requirements
- [Driving the loop](docs/loop.md) — the reference loop driver, `gtd-loop`,
  custom agents
- [Configuration](docs/configuration.md) — `gtd init`, the `.gtdrc` `workflow:`
  schema, lookup
- [Upgrading](docs/upgrading.md) — breaking changes and migration
- [Development](docs/development.md) — building, testing, releasing

## License

MIT
