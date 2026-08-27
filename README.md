# gi[t]hings.**done**

🤓: „Fix all the tests."  
🤖: „✅ All tests pass!"  
😡: „The E2E suite is red."  
🤖: „Ah, you mean _those_ tests."

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

## Quick start

Pipe the output of `gtd install` into your coding agent and answer its
questions. It should build you a script that will autonomously run the process
for you. Ask your agent if you have any questions.

## Why

- **Durable & replayable.** The workflow state _is_ your git history — a pure
  fold over commit subjects and the working tree. Kill the session, reboot, come
  back next week: run the driver and it resumes exactly where it stopped.
- **Shareable.** Push the branch, and the workflow travels with it — the state
  lives in the commits, so another machine (or another person) picks up exactly
  where you left off.
- **Files, not chat.** Conversation lives in files like `REQUIREMENTS.md` or
  `ARCHITECTURE.md`. Request changes by editing them, approve by leaving the
  tree clean — all in your own editor. There is no chat UI that could flicker.
- **Harness agnostic.** gtd emits prompts to stdout (or JSON). Claude Code, a
  bash loop, a CI job, or you reading it out loud to your sentient cat — the
  workflow doesn't care who executes it.

See [gtd --help](https://github.com/pmelab/gtd/blob/main/docs/cli.md) for the
full command/flag reference, and
[Configuration](https://github.com/pmelab/gtd/blob/main/docs/configuration.md)
for how to inspect or replace the workflow itself.

## Basic concept

Two commands make up the whole cycle. **`gtd next` says what to do now.
`gtd land` records that it is done — as a commit.** Everything else follows from
that.

The fastest way to understand it is to drive a few beats by hand. Any git
repository with at least one commit will do — the first two beats need no setup
at all, and `gtd init` seeds the one setting that matters later (your test
command).

### Beat 1 — `gtd next` says whose turn it is

```bash
gtd next
```

```
No active gtd process.

To start one, make ANY change — a hand-edit to real code, a scratch note,
anything at all. TODO.md is a good default place to start sketching.
```

This means its your turn. Add a `TODO.md` file with a detailed, well articulated
idea:

```bash
echo "Make a billion dollar SaaS. Make no mistakes." > TODO.md
```

Ask again, and gtd leads with what to do, then reports what it sees:

```
The edit is already made — run `gtd land` to land it.
State: idle
Awaits: human
Pending:
  A TODO.md -> * **
Next: Start → unwind
```

Your change matched the pattern `* **`, which routes to the `unwind` state. For
the moment its not important what that is. Important is the fact that changes to
the source tree control what is going to happen next.

### Beat 2 — `gtd land` records it as a commit

`gtd land` tells you, in one line, exactly what it would do:

```bash
gtd land
```

```
commit everything with this message: gtd(human): idle → unwind
(run `gtd land --json=script | sh` to get the landing script)
```

You could run that commit by hand. Take the script instead — it adds the
precondition checks and retries you would otherwise have to remember:

```bash
gtd land --json=script | sh
```

```
-> idle → unwind
   TODO.md
```

```bash
$ git log --oneline
0fb0300 gtd(human): idle → unwind
75b6836 chore: initial commit
```

One beat, one commit. That commit **is** the state — nothing is stored anywhere
else, which is why the process survives a reboot and travels with the branch.

### Beat 3 — the same two commands, now for a machine

```bash
gtd next
```

```
Run this script:
State: unwind
Awaits: check
Label: Unwinding your input

#!/usr/bin/env sh
...
git revert --no-commit "$commit"
```

`Awaits: check` means this beat is not yours: it is a script. gtd never runs
anything itself, so run it and land it exactly as before:

```bash
sh -c "$(gtd next --json=content)"
gtd land --json=script | sh
```

`--json=<field>` is how a script reads one value out of a beat. Bare `--json`
prints the whole document; `--json=content` prints just that field, raw, with no
quoting to strip and no `jq` to install. Plain `gtd next` is for you to read —
the leading `Run this script:` line makes it prose, not something to pipe.

Keep going and the beats keep arriving. The next one checks that your test
baseline is green:

```
State: start-gate.check
Awaits: check
Next: C → design.triage
```

`C` is the clean-tree pattern: the suite passed, nothing changed, so move on to
triage. A red suite instead writes `.gtd/FEEDBACK.md`, which matches a different
pattern and routes to `start-gate.blocked` — same two commands, different
outcome, decided entirely by what the beat left in the tree.

Land the green one, and the beat after it belongs to an agent.

### Beat 4 — handing a beat to Claude

```bash
gtd next | head -2
```

```
This file is a deliverable, not a chat reply — size follows the work, and
padding is the target of any cut. Lead with the answer immediately; never ...
```

No header at all this time. That is the prompt itself — those bytes are the
agent's input, so gtd prints nothing around them. Selectors are how you find out
whose turn it is:

```bash
gtd next --json=kind    # prompt
gtd next --json=state   # design.triage
gtd next --json=file    # .gtd/REQUIREMENTS.md
```

Now hand it over. Pipe plain `gtd next` straight in — at a prompt rest that
output already **is** the bare content, so it costs one render instead of two,
and it keeps a full diff off the command line, which is capped at 4 KB by POSIX
and around 1 MB on macOS:

```bash
gtd next | claude -p --dangerously-skip-permissions
```

Reading a value twice is free: **`gtd next` never mutates**, so a peek and a
dispatch are the same call.

The prompt tells the agent to asses your request and write
`.gtd/REQUIREMENTS.md`, and that file is the turn. Land it like any other beat:

```bash
gtd land --json=script | sh
```

`gtd next --json=validate` is there if you want to check the agent's work first:
a ready-to-run script that validates the file the prompt asked for and prints a
complete fix prompt on failure, ready to pipe straight back into the same
session.

### Then automate the beats

That was not very convenient. But it is easy to put it into a loop. Way more
convenient!

```bash
while :; do
  case "$(gtd next --json=kind)" in
    # A deterministic script to execute
    script)  gtd next --json=content | sh ;;
    # A prompt for an agent
    prompt)  gtd next | claude -p --dangerously-skip-permissions ;;
    # A message printed for a human
    message) gtd next; exit 0 ;;
    # Nothing left to do, abort.
    stalled) gtd next >&2; exit 1 ;;
  esac
  gtd land --json=script | sh
done
```

This is a very basic implementation, but there are a lot of options to integrate
this with your environment. See
[Driving the loop](https://github.com/pmelab/gtd/blob/main/docs/driver.md) for
the full protocol.

### Then let an agent build your own

But lets be honest, who reads documentation these days. Paste this into your
coding agent:

```
!gtd install
```

It prints a self-contained briefing that teaches the agent to set the project
up, build two commands for itself in whatever shell or runtime it runs, and ask
you what you want before it starts driving. You get one prompt to paste, not a
state name to choose. The two commands: a **loop command** that drives beats
until the process rests, and an **edit command** that opens the steering file
the process is waiting on right now — falling back to `.gtd/TODO.md` when the
resting state declares none. That fallback is also how you begin: on a clean
repository the edit command opens the empty `.gtd/TODO.md`, and whatever you
write there is the first sketch the whole process gets planned from.

### The workflow it ships with

One built-in workflow drives all of that. From where you sit, it has four
moments — everything between them runs without you.

1. **You sketch.** Change anything, or write the idea into `.gtd/TODO.md`. Rough
   is fine; it is treated as a sketch, not as work.
2. **You answer questions.** Planning stops and hands you a file with its open
   questions in it — what the thing should do first, then how it should be
   built. Answer them in your editor, in the file, and start the loop again.
3. **You wait.** The work is split into packages and built one at a time, each
   one checked against your test suite and fixed until it passes.
4. **You review.** You get a review document listing what changed and what to
   look at. Tick the boxes to approve, or write what is wrong. Approving ends
   the process; feedback sends it back to step 2 for a fresh plan — it never
   patches over a design you rejected.

You never talk to it. Every exchange is a file in `.gtd/` that you edit in your
own editor, and every answer you give is a commit. Your test suite is the gate
throughout: a red baseline stops the process before it starts, and a red package
is fixed before the next one begins.

Two side doors skip step 1. `gtd --entry fix-precheck` repairs a red baseline as
its own reviewed commit instead of starting a process. And

```bash
gtd --entry review-gate.check --var reviewBase=<commitish>
```

starts a pure review of everything from `<commitish>` to HEAD — straight to step
4, no planning and no building.

The workflow itself is data, not code: a `.gtdrc` `workflow:` key replaces it
wholesale. See
[Configuration](https://github.com/pmelab/gtd/blob/main/docs/configuration.md).

## License

MIT
