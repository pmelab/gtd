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
- **Files, not chat.** Plans live in `.gtd/TODO.md`, reviews in
  `.gtd/REVIEW.md`. Answer the agent's questions inline, approve by ticking
  checkboxes — all in your own editor. There is no chat UI to lose.
- **Harness agnostic.** gtd emits prompts to stdout (or JSON). Claude Code, a
  bash loop, a CI job, or you reading it out loud — the workflow doesn't care
  who executes it.
- **Bounded, not runaway.** Fix attempts are capped (`retry` on a state). When
  the cap is hit, gtd redirects to a human gate instead of burning tokens
  rewriting the same test for the 47th time.
- **Clean history.** When the feature ships, every intermediate
  `gtd(actor): state` commit squashes into one conventional commit — as if a
  very disciplined engineer did it in one sitting.

## Install

```bash
npm install -g @pmelab/gtd
```

Or run without installing:

```bash
npx @pmelab/gtd
```

No config file, no setup subcommand — `gtd` auto-initializes a `.gtdrc.json`
schema stub on first run (see [Configuration](docs/configuration.md#auto-init)).

## How it works

gtd is a small **pattern machine**: named states, each awaiting one actor and
carrying one piece of content (a script, a prompt, a message, or a squash commit
template), with an ordered set of change-patterns routing to the next state.
Four commands drive it:

- **`gtd step <actor>`** — authenticate as `<actor>` and perform the one
  transition the pending changes match.
- **`gtd next [--json]`** — print whichever actor is awaited and what they
  should do, without mutating anything.
- **`gtd run`** — execute the awaited script (the only place gtd itself spawns a
  subprocess), then step its actor.
- **`gtd status`** — a dry-run report of the resolved state and which pattern
  each pending change matches.

The loop is one beat, repeated: run `gtd next --json` and dispatch on `kind` —
`"message"` means it's a human's move (stop and hand off); `"script"` means
`gtd run` it; `"prompt"` means feed `content` to your agent, then run
`gtd step <actor>` once it's done. See [STATES.md](STATES.md) for the model and
[Driving the loop](docs/loop.md) for the full protocol.

Along the way, the bundled default workflow grills your idea into a product
plan, then a technical architecture, decomposes it into task files, builds them,
runs your tests, has the agent review its own diff, walks you through a final
review, and squashes the whole cycle into one clean commit — see
[STATES.md](STATES.md#10-the-bundled-default-workflow) for the full shape. The
workflow itself is just `.gtdrc` config — swap it for your own (see
[Configuration](docs/configuration.md)).

`gtd-loop`, installed alongside `gtd`, is a ready-to-run driver for the whole
protocol — point it at a repo and it runs the loop until it's your turn. See
[Driving the loop](docs/loop.md).

Before wiring gtd into a repo, note the
[repository requirements](docs/cli.md#repository-requirements) — most
importantly: gitignore everything your scripts write.

## Documentation

- [STATES.md](STATES.md) — the full pattern-machine specification: the model,
  the pattern grammar, resolution, retry, the squash lifecycle, and the bundled
  default workflow
- [CLI reference](docs/cli.md) — every command, exit codes, JSON schemas,
  repository requirements
- [Driving the loop](docs/loop.md) — the reference loop driver, `gtd-loop`,
  custom agents
- [Configuration](docs/configuration.md) — `.gtdrc` `workflow:` schema, lookup,
  auto-init
- [Upgrading](docs/upgrading.md) — breaking changes and migration
- [Development](docs/development.md) — building, testing, releasing

## License

MIT
