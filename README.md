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
- **Bounded, not runaway.** Fix attempts are budgeted. When the cap is hit, gtd
  stops and escalates to a human instead of burning tokens rewriting the same
  test for the 47th time.
- **Clean history.** When the feature ships, all the intermediate `gtd:` commits
  squash into one conventional commit — as if a very disciplined engineer did it
  in one sitting.

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

Three commands drive everything:

- **`gtd step`** — advance the workflow as the **human** actor.
- **`gtd step-agent`** — advance the workflow as the **agent** actor.
- **`gtd next`** — print the prompt for whichever actor is currently awaited,
  without mutating anything.

The loop is two beats, repeated: run `gtd step-agent`, then `gtd next --json`.
If the `actor` field says `"agent"`, feed the prompt to your agent and repeat;
if it says `"human"`, stop — it's your move. You act by editing files (answering
questions, reviewing the diff in your editor, fixing code) and running
`gtd step`.

Along the way, gtd grills your idea into a product plan, then a technical
architecture, decomposes it into work packages, builds them one at a time, runs
your tests after every package, has the agent review its own diff, walks you
through a final review, and squashes the whole cycle into one clean commit.

`gtd-loop`, installed alongside `gtd`, is a ready-to-run driver for the whole
protocol — point it at a repo and it runs the loop until it's your turn. See
[Driving the loop](docs/loop.md).

Before wiring gtd into a repo, note the
[repository requirements](docs/cli.md#repository-requirements) — most
importantly: gitignore everything your test command writes.

## Documentation

- [CLI reference](docs/cli.md) — every command, exit codes, JSON schemas,
  repository requirements
- [The workflow](docs/workflow.md) — states, grilling, budgets, the review gate,
  learning, squash
- [Driving the loop](docs/loop.md) — the reference loop driver, `gtd-loop`,
  custom agents
- [Configuration](docs/configuration.md) — `.gtdrc` schema, lookup, auto-init
- [Upgrading from v1](docs/upgrading-from-v1.md) — breaking changes and
  migration
- [Development](docs/development.md) — building, testing, releasing
- [STATES.md](STATES.md) — the full state-machine specification

## License

MIT
