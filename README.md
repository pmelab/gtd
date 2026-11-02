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

gtd needs Node 22.19 or newer.

```bash
npm install -g @pmelab/gtd
```

That installs `latest`, which moves once a day to the newest release. Every
merge to `main` publishes to `next` first: `npm install -g @pmelab/gtd@next`
gets each one as it lands.

gtd bundles `gtd.config.ts` with [rolldown](https://rolldown.rs), whose native
binary npm installs for your platform. Where rolldown ships none, install its
WebAssembly build next to gtd:
`npm install -g --force @rolldown/binding-wasm32-wasi`.

Or run without installing (prefix every `gtd` below with `npx`) — see
[Configuration](https://github.com/pmelab/gtd/blob/main/docs/configuration.md)
for the settings most projects tune. A process setting's value is committed to
Git history; keep secrets in an environment setting (see
[Settings](https://github.com/pmelab/gtd/blob/main/docs/configuration.md#settings)).
`GTD_FLAG_<NAME>` variables toggle experimental features — see
[Feature flags](https://github.com/pmelab/gtd/blob/main/docs/configuration.md#feature-flags).

gtd ships no workflow. Get one from
[gtd-workflows](https://github.com/pmelab/gtd-workflows) — a pinned checkout
whose `default` workflow is the feature → review → fix workflow gtd used to
bundle:

```bash
git clone https://github.com/pmelab/gtd-workflows ~/.local/share/gtd/workflows
~/.local/share/gtd/workflows/bin/gtd-wf pin origin/main
~/.local/share/gtd/workflows/bin/gtd-wf config default > gtd.config.ts
```

The config imports the workflow by absolute path, so each machine needs its own
checkout. Its README covers pinning, upgrading and the skills its prompts name.
Or write your own workflow: see
[Configuration](https://github.com/pmelab/gtd/blob/main/docs/configuration.md)
and
[Testing a workflow](https://github.com/pmelab/gtd/blob/main/docs/testing.md).

A workflow's scopes may also declare which files their agent turns may read and
write; `gtd land` refuses a turn that wrote outside its scope, and a driver can
pass the read side to its agent. `read` is not a security boundary unless your
driver enforces it at the OS level. See
[Configuration](https://github.com/pmelab/gtd/blob/main/docs/configuration.md#file-access).

> **A repository's `gtd.config.ts` is code, and gtd runs it.** A custom workflow
> is a TypeScript module, and every gtd command that looks at workflow state —
> `gtd next`, `gtd lsp` and `gtd start` included, not just `gtd land` —
> evaluates it. Treat it like a Makefile or a `package.json` script: don't run
> gtd in a checkout you don't trust.

## Quick start

Put a `gtd.config.ts` at your repository's root (see [Install](#install)) and
commit it; gtd refuses to run without one. The repository need not be a
JavaScript project: gtd resolves the config's `@pmelab/gtd/*` imports itself, so
a Python, Rust or notes repository needs no `package.json` and no install. Then
run `gtd guide`: it writes nothing and prints a briefing (and where to get a
workflow, if you have none yet). Pipe that briefing into your coding agent and
answer its questions. It should build you a script that will autonomously run
the process for you. Ask your agent if you have any questions.

## Why

- **Durable & replayable.** The workflow state _is_ your git history — a pure
  fold over commit subjects and the working tree. Kill the session, reboot, come
  back next week: run the driver and it resumes exactly where it stopped.
- **Shareable.** Push the branch, and the workflow travels with it — the state
  lives in the commits, so another machine (or another person) picks up exactly
  where you left off. Each commit records the history format it was written in
  (`Gtd-Format:`), so a gtd that cannot read a history says so instead of
  misreading it — see
  [History format](https://github.com/pmelab/gtd/blob/main/docs/configuration.md#history-format).
- **Files, not chat.** Conversation lives in files like `REQUIREMENTS.md` or
  `REVIEW.md`. Request changes by editing them, approve by leaving the tree
  clean — all in your own editor. There is no chat UI that could flicker.
- **Harness agnostic.** gtd emits prompts to stdout (or JSON). Claude Code, a
  bash loop, a CI job, or you reading it out loud to your sentient cat — the
  workflow doesn't care who executes it.

See [gtd --help](https://github.com/pmelab/gtd/blob/main/docs/cli.md) for the
full command/flag reference,
[Compatibility](https://github.com/pmelab/gtd/blob/main/COMPATIBILITY.md) for
which surfaces you can rely on across releases, and
[Configuration](https://github.com/pmelab/gtd/blob/main/docs/configuration.md)
for how to write or replace the workflow itself.

## Basic concept

Two commands make up the whole cycle. **`gtd next` says what to do now.
`gtd land` records that it is done — as a commit.** Everything else follows from
that.

The fastest way to understand it is to drive a few beats by hand. The beats
below are those of gtd-workflows' `default` workflow. Any git repository with at
least one commit will do once its `gtd.config.ts` is committed — the first two
beats need nothing else. Later beats run your test command, set as the
`testCommand` workflow option in `gtd.config.ts`.

### Beat 1 — `gtd next` says whose turn it is

```bash
gtd next
```

```
No active gtd process.

To start one, make ANY change — a hand-edit to real code, a scratch
note, anything at all. .gtd/TODO.md is a good default
place to start sketching.
```

This means its your turn. Add a `.gtd/TODO.md` file with a detailed, well
articulated idea:

```bash
mkdir -p .gtd
echo "Make a billion dollar SaaS. Make no mistakes." > .gtd/TODO.md
```

Ask again, and gtd leads with what to do, then reports what it sees:

```
The edit is already made — run `gtd land` to land it.
State: idle
Awaits: human
Label: Idle
File: .gtd/TODO.md
```

At `idle`, any change at all starts a process, and the next step is `unwind`.
For the moment its not important what that is. Important is the fact that what
you leave in the tree controls what is going to happen next.

### Beat 2 — `gtd land` records it as a commit

`gtd land` tells you, in one line, exactly what it would do:

```bash
gtd land
```

```
commit everything with this message: gtd(human): idle → unwind
(to land it: s=$(gtd land --json=script) && sh -c "$s")
```

You could run that commit by hand. Take the script instead — it spells out the
exact message and reports what landed:

```bash
s=$(gtd land --json=script) && sh -c "$s"
```

```
-> idle → unwind
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
set +e
if ! git diff --quiet '<sketch commit>^' '<sketch commit>' --; then
  mkdir -p "$(dirname '.gtd/FEEDBACK.md')"
  git diff --binary '<sketch commit>^' '<sketch commit>' -- | git apply -R 2> …
  …
```

`Awaits: check` means this beat is not yours: it is a script, here one that
reverts your sketch out of the working tree. gtd never runs anything itself,
never commits and never touches the index, so run it and land it exactly as
before:

```bash
sh -c "$(gtd next --json=content)"
s=$(gtd land --json=script) && sh -c "$s"
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
Label: Checking the baseline
```

A green suite leaves the tree clean, so the process moves on to triage. A red
suite instead writes `.gtd/FEEDBACK.md`; the process runs it once more at
`start-gate.recheck`, and only a second red goes to `start-gate.blocked` — same
two commands, different outcome, decided entirely by what the beat left in the
tree.

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

**The turn ends when `claude -p` returns** — a command the agent backgrounds
dies unread, and the process stalls on an empty turn. Claude Code lets the agent
background commands and caps foreground ones at 10 minutes by default, so a real
driver exports these first (`gtd guide`'s reference driver does):

```bash
export CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1
export BASH_DEFAULT_TIMEOUT_MS=1800000 # 30 min
export BASH_MAX_TIMEOUT_MS=7200000     # 2 h
```

Reading a value twice is free: **`gtd next` never mutates**, so a peek and a
dispatch are the same call.

The prompt tells the agent to asses your request and write
`.gtd/REQUIREMENTS.md`, and that file is the turn. Land it like any other beat:

```bash
s=$(gtd land --json=script) && sh -c "$s"
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
  s=$(gtd land --json=script) && sh -c "$s"
done
```

This is a very basic implementation, but there are a lot of options to integrate
this with your environment. See
[Driving the loop](https://github.com/pmelab/gtd/blob/main/docs/driver.md) for
the full protocol.

Or skip writing one: the
[complete minimal driver](https://github.com/pmelab/gtd/blob/main/docs/driver.md#a-complete-minimal-driver)
is a paste to own outright. It drives `claude` until the process rests on you,
logs every turn to the file `gtd next --json=log` names, records each turn's
cost on its landing, answers judge gates through `gtd judge run`, and maps the
workflow's `smart`/`base` model hints to real model names through
`GTD_LOOP_MODEL_SMART`/`GTD_LOOP_MODEL_BASE`.

Neither guards an agent turn's context: a long turn relies on the agent
harness's own compaction. Size the work before the sketch — a change too big for
one process is several processes.

### Or drive it from inside Claude Code

The gtd mod runs the same loop inside an interactive Claude Code session
(2.1.287 or later), without `claude -p`. The plugin is the npm package itself,
so it brings its own gtd; it needs only `node` and `npm` on your `PATH`:

```sh
claude plugin marketplace add pmelab/gtd
claude plugin install gtd@gtd
```

Then, in any repository:

```
/gtd Add a --json flag to the export command
```

That starts a process from your requirements and drives it until it needs you.
The requirements go to the top of `.gtd/TODO.md`, above whatever it already
holds. A long, multi-line requirements paste still starts a process; if Claude
Code never expanded the paste, gtd says it could not read it, and you add the
requirements to the top of `.gtd/TODO.md` and run `/gtd`. `/gtd <door> [args]`
takes one of the doors a bare `gtd start` lists (gtd-workflows' `default` brings
`fix`, `review [base]`, and `rollout <flag>` and `cleanup <flag>` where the
config exports them); text whose word count does not fit a door's args (bare
`/gtd rollout` included) starts a process from that text as requirements. At
every human rest Claude itself takes over: it walks you through the open
questions one at a time, answers your own questions about the plan or the diff,
records what you decide in the steering file the way the step asks, and moves
the process on only when you say so; a review you leave untouched signs off.
While a step runs you can keep asking; requests for changes wait for the next
rest. When the process finishes, Claude offers to squash it and open its pull
request (or run `/gtd ship`: one commit under one pull request, see the
[driver doc](docs/driver.md)); a process started for an issue ships with
`Closes #N` on its pull request; a closed pull request whose branch was deleted
from origin is left behind and a new one opens. A process can change hands at
any gate: ask Claude to hand it off (or run `/gtd throw @dev`) and it opens a
draft pull request assigned to them, and `/gtd catch <pr>` picks it up exactly
where it waits, so whoever wrote the requirements can hand the build to someone
else. `/gtd pr` brings a pull request's unresolved review threads into the
review: each becomes a note in `.gtd/REVIEW.md` ticked "fix as suggested"
(untick it for "won't fix" plus a reason, or your own answer), the review door
fixes them in place, and each thread then gets a reply naming the fixing commit
(or your reason) and is resolved. Ship, hand-off and throw answer at once and
run in the background, with progress on the status line; they report by waking
Claude, a toast, a transcript line and a push notification, and a failed push or
`gh` call reports as a failure. While a ship or hand-off runs or is queued,
`/gtd catch`, the doors, `/gtd <requirements>` and bare `/gtd` wait for its
report. See
[Inside Claude Code](https://github.com/pmelab/gtd/blob/main/docs/driver.md#inside-claude-code-the-gtd-mod).

### Then let an agent build your own

But lets be honest, who reads documentation these days. Paste this into your
coding agent:

```
!gtd guide
```

It prints a self-contained briefing that teaches the agent to set the project
up, build four commands for itself in whatever shell or runtime it runs, and ask
you what you want before it starts driving. You get one prompt to paste, not a
state name to choose. The four commands: **`gtd-build`** drives beats until the
process rests; **`gtd-edit`** opens the steering file the process is waiting on
right now — falling back to `.gtd/TODO.md` when the resting state declares none;
**`gtd-door <name> [args...]`** starts a process through one of the doors a bare
`gtd start` lists (`gtd-door fix`, `gtd-door review [base]` with gtd-workflows'
`default`) and drives it. The `.gtd/TODO.md` fallback is also how you begin: on
a clean repository the edit command opens the empty `.gtd/TODO.md`, and whatever
you write there is the first sketch the whole process gets planned from. As a
final step, if it finds an LSP-capable editor, the briefing also offers to wire
up live diagnostics and review actions in it — asking first and naming the exact
file, and merging rather than overwriting your editor's config. That editor
integration also adds a footnote at the exact cursor position with one code
action, landing the cursor in the new, empty definition ready to type, and jumps
between a footnote's marker and its definition both ways — so leaving a comment
for the next agent turn never means hand-typing the `[^name]` syntax yourself.
In a review file, a `./path#42-70` hunk pointer is also a clickable link
straight to that file and range, no go-to-definition required. A footnote can
also hold a `H:`/`A:` conversation (a thread — see
[configuration](docs/configuration.md)); the editor outlines threads, flags the
open ones, and a `gtd: reply` code action adds your empty `- H:` entry and puts
the cursor there; `gtd check <mode> <file> --open-threads` lists the ones still
waiting on you. The same conversation works as bare `// H: …` / `// A: …` line
comments (`#`, `--`, `;` by language) in files the process changed;
`gtd check --open-threads` alone lists the open ones (editor-only — the phone UI
does not show them).

### The workflow

gtd decides nothing about _what_ a process does: the workflow in your
`gtd.config.ts` does. gtd-workflows' `default` has four moments for you — you
sketch, you answer the planning questions in `.gtd/REQUIREMENTS.md`, you wait
while it builds, checks and runs its quality lenses, and you review — with every
exchange a file in `.gtd/` that you edit in your own editor, and every answer a
commit. Its guide is
[The default workflow](https://github.com/pmelab/gtd-workflows/blob/main/docs/default.md).

Prefer a phone or another device over your editor? `gtd ui` opens the file whose
turn it is as a small web app, over Tailscale — including a step that names no
format, or one nothing recognizes, which still opens as plain markdown structure
instead of refusing to start: read, plus a note on any block. It also binds on
an idle worktree — nothing pending yet — opening `.gtd/TODO.md` free-form with a
bare textfield so you can sketch from your phone; the sketch stays un-triaged on
disk until you run `gtd` again, from anywhere, to pick it up. A description
renders inline markdown — bold, code, strikethrough, links, and images — instead
of literal asterisks and backticks. A note you add from the phone starts a
thread: a footnote holding a `H:`/`A:` conversation. Threads show as a
conversation under their block, question, chunk, or hunk, and one the agent
answered last carries a "waiting on you" badge. Tap it to reply — your reply is
added as a new `H:` entry; while the agent has yet to answer, reopening it edits
your last entry instead. Tap an already-answered question to leave a note on it;
the agent may overturn the answer. A `findings` file lists its findings, each
with a fix checkbox and, once ticked, an optional line of guidance; Done stays
disabled while the file holds anything its gate would refuse. See
[Configuration](https://github.com/pmelab/gtd/blob/main/docs/configuration.md)
for its `ui:` settings.

The workflow itself is a plain async TypeScript function, and the
`gtd.config.ts` at the repository root names it. A workflow may be a factory —
`feature({ testCommand: "npm run ci" })` — whose options gtd validates when it
loads the config: a misspelled or mistyped one fails every command, naming the
workflow, the key and what was expected. `gtd start` lists the workflows your
config exports and the doors they bring, and `gtd start <name> [args...]` starts
one by name; a door named like a workflow wins. See
[Configuration](https://github.com/pmelab/gtd/blob/main/docs/configuration.md) —
and remember gtd evaluates that file on every command. A shared workflow package
bundling its own `@pmelab/gtd` is checked against the running gtd and refused,
naming which side to upgrade, on a flows protocol mismatch.

Everything else a repository configures — steering-file modes, `gtd ui`
settings, per-scope skills and file access — goes in the same file's `config`
export, built with `defineConfig` from `@pmelab/gtd/flows`, which rejects an
unknown key. `gtd.config.ts` is the only repository config: gtd 23 removed the
`.gtdrc` files, and a leftover one — in the repository, above it, or in your
home directory — fails every command until you delete it. See
[Migrating from `.gtdrc`](https://github.com/pmelab/gtd/blob/main/docs/configuration.md#migrating-from-gtdrc).

## Checking a range for stray files

```sh
gtd strays main..HEAD 'src/**' '*.md'   # files the range touched outside the globs
```

Prints a sorted JSON array of every file the range's committed diff touched that
matches none of the globs, and exits `10` when there are any (`0` when none).
stderr gets a summary; `--verbose` adds one `stray:` line per path. `--json=<n>`
picks one entry (nothing when past the end). Symlinks count as paths and are
never followed; a submodule counts as its path, whatever `diff.ignoreSubmodules`
or `.gitmodules` `ignore` say. Works in any git repository, no process needed.

## Process history

When a process finishes, the landing that closes it also keeps the whole run
behind a ref, `refs/gtd/history/<entry>`, so a squash or a deleted branch
doesn't lose it. `/gtd ship` pushes this process's own ref to origin alongside
the branch (never the others) and writes a `Gtd-History: <ref>` trailer on the
squashed commit. The push is forced, so it replaces origin's copy of that one
ref. If that push fails, the ship fails and nothing is squashed. Recover the
full trail with `s=$(gtd history fetch --json=script) && sh -c "$s"`, then
`gtd history show <ref>`.

```sh
gtd history list                 # one line per kept process
gtd history show <ref>           # replay its steps, judge verdicts and approvals
gtd history metrics [ref...]     # how the kept processes went, per process and in total
gtd history judges [ref...]      # how often each judge's verdicts were overturned
# pull every kept ref from origin
s=$(gtd history fetch --json=script) && sh -c "$s"
```

`gtd history metrics` measures gtd-workflows' `default` `feature` workflow from
the kept refs — every ref, or the ones named. It reads commit subjects and
trailers only, so it never replays and a config changed since is no refusal:

- **refactor-first rate** — of the builds whose naive pass was decided, the
  share rebuilt rather than landed as it is; a landed pass that no longer
  applies and is built afresh counts as rebuilt (`refactored` counts the
  rebuilds a refactor came first for)
- **cost** — the `Gtd-Cost` a driver recorded with `gtd land --cost --model`, by
  model and by phase (`naive`, `refactor`, `implement`, `other`), and the
  **double work** of a rebuild: its naive pass plus the implement turns that
  rebuilt it. By-model costs make two coder models comparable over the same kind
  of work
- **findings** — the net count of `## ` findings each quality-lap lens added to
  `.gtd/QUALITY.md`, keyed by the lap's lens path (`build.quality.correctness`,
  `refactor.build.quality.correctness`, …)
- **flaky** — red checks that passed on their re-check (`Gtd-Mark: flaky=…`),
  keyed by the re-check's full step name (`start-gate.recheck`,
  `build.health.recheck`, …)

`--json` prints `{ processes, total }`; `--json=total.refactorFirstRate` prints
one value. Model, phase and lens keys may hold dots a path cannot reach: select
their record whole (`--json=total.cost.byModel`). A branch name selects every
process kept from that branch. A rate is `null` without a decided build. Each
process names its `workflow` (`null` for the default one); the total spans every
ref measured, so name the refs to leave another workflow's processes out.

`gtd history judges` calibrates three of gtd-workflows' `default` `feature`
workflow's judges from the `Gtd-Judge` verdicts the kept refs recorded. It never
replays and asks no model. A verdict is **overturned** when later history
contradicts it:

- **retry** (`health.judge`) — an `identical` verdict, when the next fix turn's
  check went green anyway (no outcome when a person edited code in between)
- **triage** (`quality.triage`) — a `mechanical` or `noise` verdict the review
  listed under _Fixed automatically_ or _Dropped as noise_, when the human
  edited that finding's line there or wrote under it
- **clear** (`design.clear`) — a `yes` that skipped design (landed on
  `design.normalise`), when a later human design step in the same process
  changed the acceptance criteria

Any other verdict has no outcome. The report counts verdicts, scored verdicts
and overturns per judge and per `p` bucket (`0.8-0.9: 1/2` — one of two
overturned). `--threshold <name>=<value>` (formerly `--var`) re-decides every
past verdict under another threshold and prints the decisions that would change,
against the threshold each process recorded (a process that recorded none is
left out):

```sh
gtd history judges --threshold qualityTriageMinP=0.9
# what-if qualityTriageMinP=0.9: 7 noise drops become notes (2 overturned)
```

The thresholds are `judgeIdenticalMinP` (retry) and `qualityTriageMinP`
(triage). The judge's evidence-budget cut is not recorded, so a cut verdict is
scored and re-decides as if it was whole. A retry verdict on an empty report is
not scored, as the flow drops it. `--json` prints
`{ processes, total, whatIf }`, each process and the total with its `judges`.
`--jsonl` prints one line per verdict instead — `process`, `judge`, `commit`,
`step`, `question`, `state` (the evidence the tree still shows: the finding, the
two check reports, the sketch without its numbered criteria), `answer`, `p` and
`outcome` (`overturned`, `held` or `null`) — ready to fine-tune a local model
on:

```sh
gtd history judges --jsonl > judges.jsonl
```

`gtd history fetch` only prints a fetch script; pipe it into `sh` to run it.
Beyond that one ship push, refs are not pushed or fetched by default. The ref
holds every step commit, including steering files and code a later step removed,
so anyone who can fetch the remote can read it. To share the rest:

```sh
git push origin 'refs/gtd/history/*'
git config --add remote.origin.fetch 'refs/gtd/history/*:refs/gtd/history/*'
```

The second line makes every plain `git fetch` include them. It has no leading
`+`, so a conflicting local ref fails instead of being overwritten: after a
forced `/gtd ship` push, a clone holding the old tip deletes its local ref
(`git update-ref -d <ref>`) and fetches again.

A step declared with `keep: true` files its turn under `refs/gtd/kept/` instead
of on the branch (see [Kept tips](docs/configuration.md#kept-tips)). Those refs
are not process history: `gtd history` does not list them, and the
`refs/gtd/history/*` refspecs above neither push nor fetch them.

A workflow can rest at an approval gate (`human(name, { approve: true })`; the
`seamGate` helper does this for a `refactor-first` diff-shape judgment;
gtd-workflows' `default` does not use it). Only a clean `gtd land` approves it,
and the commit records who in a
`Gtd-Approved: {"step":"<step>#<n>","name":"<name>","email":"<email>"}` trailer;
a landing with any edit is refused (as is a script run after the tree changed —
revert and land again), and `gtd abandon` is the only other way out. `approve`
cannot be combined with `mode` or `file` (refused when replay reaches the step).
Git hooks do not run on the approval commit; `commit.gpgSign` still applies, so
a failing signer refuses the approval. `gtd next --json` lists the process's
approvals as `approvals` (`[]` when none), and `gtd history show` prints each as
`approved <step>#<n> by <name> <<email>>`. See
[Step options](docs/configuration.md#step-options).

## Entrypoints

gtd is one package, `@pmelab/gtd`, and every entrypoint shares its version and
[SemVer promise](https://github.com/pmelab/gtd/blob/main/COMPATIBILITY.md).

| Import                        | What it is                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@pmelab/gtd/flows`           | The flow API a workflow is written in: the steps (`agent`, `human`, `run`, …), `scope`, `workflow()`, workflow factories, `defineConfig` and `FLOWS_PROTOCOL`.                                                                                                                                                           |
| `@pmelab/gtd/wire`            | The driver protocol: `WIRE_SCHEMA`, the exit codes and the types of every `--json` document.                                                                                                                                                                                                                             |
| `@pmelab/gtd/steering`        | The steering-file formats (`qa`, `review`, `findings`), `listFormat`/`sectionFormat` to [declare a format](https://github.com/pmelab/gtd/blob/main/docs/configuration.md#declared-formats) a step's `mode` validates against, the review-note readers, and `sections`, `threads` and `openQuestions` as plain functions. |
| `@pmelab/gtd/workflow-kit`    | Policy-free building blocks to compose a workflow from: health checks, quality laps, scenario freezing, review tails. See [Workflow kit](https://github.com/pmelab/gtd/blob/main/docs/workflow-kit.md).                                                                                                                  |
| `@pmelab/gtd/testkit`         | Runs any workflow against the real engine in an in-memory repository, under any test runner, plus a flow-context harness for rendering prompts. See [Testing a workflow](https://github.com/pmelab/gtd/blob/main/docs/testing.md).                                                                                       |
| `@pmelab/gtd/testkit/gherkin` | The testkit as quickpickle steps for vitest. Needs `vitest` and `quickpickle`, optional peer dependencies.                                                                                                                                                                                                               |

Types come from the TypeScript sources the package ships. Configs never need an
install for any of these but the testkit's: gtd resolves a `gtd.config.ts`'s
`@pmelab/gtd/*` imports to its own copy.

The `gtd` bin's commands — `next`, `land`, `start`, `abandon`, `restore`,
`repin`, `validate`, `check`, `uncheck`, `guide`, `bundle`, `summary`, `base`,
`version`, `help`, `history list`, `history show`, `history metrics`,
`history judges`, `history fetch`, `strays`, the tools `ui`, `lsp`, `judge`
(`judge answer`, `judge run`) — are listed in the
[CLI reference](https://github.com/pmelab/gtd/blob/main/docs/cli.md). Every
command that prints a script takes `--json=script`, and `--` ends the options.

`gtd bundle` prints a pin: gtd's engine and the current workflow, npm packages
included, as one gzipped ES module after a plain-text
`gtdpin <format> gtd <version>` line. A workflow using a package with a native
addon cannot be pinned.

Every process commits its pin: its first beat after it starts is a pin beat
writing `gtd bundle`'s output to `.gtd/process.gtdpin`, and its last, once the
flow has ended, an unpin beat removing it — the commit that closes the process.
Both are ordinary `script` beats a driver runs unattended; see
[Pin and unpin beats](https://github.com/pmelab/gtd/blob/main/docs/driver.md#pin-and-unpin-beats).
Histories with pin commits are history format 2 or later, which an older gtd
refuses. The beats rest at `gtd:pin` and `gtd:unpin`; a workflow step may not
take a name starting with `gtd:`.

While a process is pinned, the `gtd` on your `PATH` hands every command over to
the pin, so editing the workflow or upgrading gtd mid-process changes nothing;
gtd notes on stderr when the live config differs from the pinned one. `ui`,
`lsp`, `guide`, `bundle`, `repin`, `help`, `version` and the `history` commands
always run live, and `gtd --live <command>` runs the live engine for any other,
at the risk of misreading the process. To fix a workflow mid-process, edit it
and run `gtd repin`: its script commits a fresh pin from the live engine and
config, and the process continues on it. Where the edited workflow no longer
replays the process, the repin continues from the divergence: the commits it
cannot replay stay as files, and the process rests at the step the edited
workflow reached (history format 3 or later). A pin in a format your gtd does
not know is refused: upgrade gtd. See
[Pinned processes](https://github.com/pmelab/gtd/blob/main/docs/cli.md#pinned-processes).

## License

MIT
