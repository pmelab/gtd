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
- **Files, not chat.** Plans live in `.gtd/` steering files (`REQUIREMENTS.md`,
  `ARCHITECTURE.md`. Request changes by editing them, approve by leaving the
  tree clean — all in your own editor. There is no chat UI to lose.
- **Harness agnostic.** gtd emits prompts to stdout (or JSON). Claude Code, a
  bash loop, a CI job, or you reading it out loud — the workflow doesn't care
  who executes it.

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
anything at all. .gtd/TODO.md is a good default place to start sketching.
```

This means its your turn. Add a `TODO.md` file with a detailed, well articulated
idea:

```bash
mkdir -p .gtd
echo "Make a billion dollar SaaS. Make no mistakes." > TODO.md
```

Ask again, and the header now reports what gtd sees:

```
Pending:
  A TODO.md -> * **
Next: Start → unwind
```

Your change matched the pattern `* **`, which routes to the `unwind` state. For
the moment its not important what that is. Important is the fact that changes to
the source tree control what is going to happen next.

### Beat 2 — `gtd land` records it as a commit

`gtd land` prints a shell script and deliberately does not run it. Read it, then
pipe it:

```bash
gtd land | sh
```

```
-> idle → unwind
   .gtd/TODO.md
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
eval "$(gtd next --sh)"; sh -c "$gtd_content"
gtd land | sh
```

Plain `gtd next` prints that human-readable header, so it is not pipeable into
`sh` — the runnable bytes come from `--sh` or `--json`.

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

That is the prompt itself — those bytes are an agent's input, so gtd prints
nothing around them. Ask for structure when you want to know whose turn it is:

```bash
eval "$(gtd next --sh)"
printf '%s / %s / %s\n' "$gtd_kind" "$gtd_state" "$gtd_file"
```

```
prompt / design.triage / .gtd/REQUIREMENTS.md
```

Now hand it over.

```bash
printf '%s' "$gtd_content" | claude -p --session-id "$gtd_session_id" \
  --model "$gtd_model" --dangerously-skip-permissions
```

Two of those variables are worth understanding:

- **`$gtd_session_id`** is derived from your history, never stored, so the same
  part of the workflow always resumes the same conversation — across restarts,
  and even on another machine that checks out the branch. Because it is derived
  rather than remembered, treat `$gtd_session_resume` as a hint: try the flag it
  points at, and fall back to the other one if the agent rejects it.
- **`$gtd_model`** is an opaque hint the workflow declared (`smart` and `base`
  in the bundled one). gtd never interprets it — you map it onto whatever your
  agent calls that tier.

The agent writes `.gtd/REQUIREMENTS.md`, and that file is the turn. Land it like
any other beat:

```bash
gtd land | sh
```

`$gtd_validate` is there if you want to check the agent's work first: a
ready-to-run script that validates the file the prompt asked for and prints a
complete fix prompt on failure, ready to pipe straight back into the same
session.

### Then automate the beats

That was not very convenient. Running this manually doesn't make us faster. But
it is easy to put it into a loop:

```bash
while :; do
  out="$(gtd next --sh)"
  eval "$out"
  case "$gtd_kind" in
    script) sh -c "$gtd_content" ;;
    prompt) printf '%s' "$gtd_content" | your-agent ;;
  esac
  gtd land | sh
done
```

gtd itself never executes anything — the driver owns running scripts, and every
`gtd next` call is strictly mutation-free, safe to poll or peek at any time. See
[Driving the loop](https://github.com/pmelab/gtd/blob/main/docs/driver.md) for
the full protocol, including the `message`/`capture` gates, the stalled case,
and refusal handling — a real driver captures `gtd land --sh` and pipes its
`$gtd_script`, because a refusal exits non-zero with an empty script that `| sh`
would swallow.

### Then let an agent build your own

Paste this into your coding agent:

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

Those beats all come from one built-in workflow. It is data, not code — a
`.gtdrc` `workflow:` key replaces it wholesale. Condensed:

1. **idle** (you) — change anything. gtd treats it as a _sketch_, not as work.
2. **unwind** (script) — reverts your sketch back out of the tree; its intent
   survives in history for the next step to read.
3. **start-gate** (script) — the suite must be green before new work starts. Red
   routes to you, with the failing output in `.gtd/FEEDBACK.md`.
4. **design** (agent, then you) — triages the reverted diff into
   `.gtd/REQUIREMENTS.md`. Open product questions come back for you to answer
   inline in that file.
5. **architecture** (agent, then you) — turns it into `.gtd/ARCHITECTURE.md`,
   asks technical questions the same way, then decomposes the work into one
   package per concern under `.gtd/packages/`.
6. **packages** (agent, looped) — per package: build, run the checks, fix what
   is red, review it against its own package file, close it out. Repeats until
   no package is left.
7. **review** (agent, then you) — an agent writes `.gtd/REVIEW.md`; you tick its
   boxes or write feedback into it. A clean sign-off ends the process; feedback
   re-enters at step 2.
8. **idle** — done, and HEAD is a linear history of every turn that got you
   there.

Two side doors skip the front of that list. `gtd --entry fix-precheck` repairs a
red baseline as its own reviewed commit instead of starting a process. And

```bash
gtd --entry review-gate.check --var reviewBase=<commitish>
```

starts a pure review: it enters at step 7 with no planning or building at all,
reviewing everything from `<commitish>` to HEAD. Sign-off ends it; feedback
re-enters at step 2 as a full re-plan lap.

Every numbered step above is just beats. `gtd next` prints one, you or an agent
do it, `gtd land` commits it — all the way down.

## License

MIT
