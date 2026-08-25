# gi[t]hings.**done**

> „Fix all the tests." „✅ All tests pass!" „The E2E suite is red." „Ah, you
> mean _those_ tests."

**Chat is a terrible source of truth. Git isn't.**

**gtd** is a git-aware CLI that derives the entire agentic workflow — capture,
plan, build, check, review — from your repository state, and prints the next
prompt for whatever agent you point at it. Every turn is a commit, so the
process survives a crash, a reboot, or a week away, and travels with the branch
to any machine that checks it out.

## Install

```bash
npm install -g @pmelab/gtd
```

Or run without installing (prefix every `gtd` below with `npx`) — see
[Configuration](https://github.com/pmelab/gtd/blob/main/docs/configuration.md)
for the settings most projects tune.

## First run

Paste this into your coding agent:

```
!gtd install
```

It prints a self-contained briefing that teaches the agent to set the project
up, build a gtd driver for itself in whatever shell or runtime it runs, and ask
you what you want before it starts driving. You get one prompt to paste, not a
state name to choose.

Writing a driver by hand instead? See
[Driving the loop](https://github.com/pmelab/gtd/blob/main/docs/driver.md) for
the full protocol and a complete minimal reference implementation.

## Why

- **Durable & replayable.** The workflow state _is_ your git history — a pure
  fold over commit subjects and the working tree. Kill the session, reboot, come
  back next week: run the driver and it resumes exactly where it stopped.
- **Shareable.** Push the branch, and the workflow travels with it — the state
  lives in the commits, so another machine (or another person) picks up exactly
  where you left off.
- **Files, not chat.** Plans live in `.gtd/` steering files (`REQUIREMENTS.md`,
  `ARCHITECTURE.md`, the package files under `.gtd/packages/`). Request changes
  by editing them, approve by leaving the tree clean — all in your own editor.
  There is no chat UI to lose.
- **Harness agnostic.** gtd emits prompts to stdout (or JSON). Claude Code, a
  bash loop, a CI job, or you reading it out loud — the workflow doesn't care
  who executes it.

The loop behind all of this is one beat, repeated:

```bash
while :; do
  out="$(gtd next --sh)"
  eval "$out"
  case "$gtd_kind" in
    script) sh -c "$gtd_content" ;;
    prompt) printf '%s' "$gtd_content" | your-agent ;;
  esac
  gtd land
done
```

gtd itself never executes anything — the driver owns running scripts, and every
`gtd next` call is strictly mutation-free, safe to poll or peek at any time. See
[Driving the loop](https://github.com/pmelab/gtd/blob/main/docs/driver.md) for
the full protocol, including the `message`/`capture` gates and the stalled case
this sketch leaves out.

See [gtd --help](https://github.com/pmelab/gtd/blob/main/docs/cli.md) for the
full command/flag reference, and
[Configuration](https://github.com/pmelab/gtd/blob/main/docs/configuration.md)
for how to inspect or replace the workflow itself.

## License

MIT
