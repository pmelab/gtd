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

That installs `latest`, which moves once a day to the newest release. Every
merge to `main` publishes to `next` first: `npm install -g @pmelab/gtd@next`
gets each one as it lands.

Or run without installing (prefix every `gtd` below with `npx`) — see
[Configuration](https://github.com/pmelab/gtd/blob/main/docs/configuration.md)
for the settings most projects tune. A process setting's value is committed to
Git history; keep secrets in an environment setting (see
[Settings](https://github.com/pmelab/gtd/blob/main/docs/configuration.md#settings)).
`GTD_FLAG_<NAME>` variables toggle experimental features — see
[Feature flags](https://github.com/pmelab/gtd/blob/main/docs/configuration.md#feature-flags).

Also install all three skill sources the bundled workflow names in its prompts —
none is optional. See
[Setup](https://github.com/pmelab/gtd/blob/main/docs/setup.md) for the list, the
install flags, and the never-install-the-plugin caveat. Skills are declared per
scope, and restricted per turn where the driver can; each bundled scope has its
own addressable `config.skills` entry in `gtd.config.ts` — see
[Configuration](https://github.com/pmelab/gtd/blob/main/docs/configuration.md#skills)
to repoint one to a set your own harness has instead.

Each scope also declares which files its agent turns may read and write;
`gtd land` refuses a turn that wrote outside its scope, and a driver can pass
the read side to its agent. `read` is not a security boundary unless your driver
enforces it at the OS level. See
[Configuration](https://github.com/pmelab/gtd/blob/main/docs/configuration.md#file-access).

> **A repository's `gtd.config.ts` is code, and gtd runs it.** A custom workflow
> is a TypeScript module, and every gtd command that looks at workflow state —
> `gtd next`, `gtd lsp`, `gtd door` and `gtd doors` included, not just
> `gtd land` — evaluates it. Treat it like a Makefile or a `package.json`
> script: don't run gtd in a checkout you don't trust.

## Quick start

Run `gtd install` at your repository's root. It writes a `gtd.config.ts` that
runs gtd's shipped workflows — commit it; gtd refuses to run without one — and
prints a briefing. The repository need not be a JavaScript project: gtd resolves
the config's `@pmelab/gtd/*` imports itself, so a Python, Rust or notes
repository needs no `package.json` and no install. Pipe that briefing into your
coding agent and answer its questions. It should build you a script that will
autonomously run the process for you. Ask your agent if you have any questions.

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
for how to inspect or replace the workflow itself.

## Basic concept

Two commands make up the whole cycle. **`gtd next` says what to do now.
`gtd land` records that it is done — as a commit.** Everything else follows from
that.

The fastest way to understand it is to drive a few beats by hand. Any git
repository with at least one commit will do once `gtd install` has written its
`gtd.config.ts` and you have committed it — the first two beats need nothing
else. Later beats run your test command, set as the `testCommand` workflow
option in `gtd.config.ts`.

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
(run `gtd land --json=script | sh` to get the landing script)
```

You could run that commit by hand. Take the script instead — it spells out the
exact message and reports what landed:

```bash
gtd land --json=script | sh
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
driver exports these first (`gtd install`'s reference driver does):

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

Or skip writing one: the
[complete minimal driver](https://github.com/pmelab/gtd/blob/main/docs/driver.md#a-complete-minimal-driver)
is a paste to own outright. It drives `claude` until the process rests on you,
logs every turn to the file `gtd next --json=log` names, records each turn's
cost on its landing, answers judge gates through `gtd judge run`, and maps the
workflow's `smart`/`base` model hints to real model names through
`GTD_LOOP_MODEL_SMART`/`GTD_LOOP_MODEL_BASE`.

Both it and the Claude Code mod stop an agent turn that outgrows its context:
past 60% of the model's window the agent is asked to wrap up with a handoff
note, past 70% (or when the context is about to be compacted) the turn stops and
nothing lands. A step's `context` option, or the bundled workflows'
`contextLimit` option, moves the two limits — see
[Context limits](https://github.com/pmelab/gtd/blob/main/docs/driver.md#context-limits).
In `feature`, a naive pass, refactor or build turn that wrapped up that way is a
snapshot: a fresh turn picks up from it with the handoff note and the criteria
still open, up to 3 times per phase, across its retries (`continuations`), and a
phase whose continuations keep stopping, or close nothing twice in a row
(`continuationStall`), rests for a person — see
[Continuations](https://github.com/pmelab/gtd/blob/main/docs/configuration.md#continuations).

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
requirements to the top of `.gtd/TODO.md` and run `/gtd`. `/gtd fix`,
`/gtd review [base]`, `/gtd rollout <flag>` and `/gtd cleanup <flag>` (where the
config exports them) take the doors described below; text whose word count does
not fit a door's args (bare `/gtd rollout` included) starts a process from that
text as requirements. At every human rest Claude itself takes over: it walks you
through the open questions one at a time, answers your own questions about the
plan or the diff, records what you decide in the steering file the way the step
asks, and moves the process on only when you say so; a review you leave
untouched signs off. While a step runs you can keep asking; requests for changes
wait for the next rest. When the process finishes, Claude offers to squash it
and open its pull request(s) (or run `/gtd ship`; `GTD_SHIP_MODE` picks one
commit per slice under one pull request (the default) or, set to `stack`, one
stacked pull request per slice, see the [driver doc](docs/driver.md)); a process
started for an issue ships with `Closes #N` on its top pull request; a closed
pull request whose branch was deleted from origin is left behind and a new one
opens; on a branch an earlier ship in this clone stacked (unless
`GTD_SHIP_MODE=commits`), a later process, such as review fixes, lands one
commit per slice on the top pull request and keeps the stack, and re-running
`/gtd ship` after a lower stacked pull request merged restacks the rest (it
refuses, with nothing changed, when that pull request merged anywhere but the
default branch (unless into a lower slice branch before that one merged into
it), a slice branch is checked out in another worktree, an unrelated local
branch sits inside the rebased commits, or a slice's change is already upstream;
a failed rebase is rolled back; to tear a stack down from its worktree, delete
the top branch with `git push origin --delete`, since
`gh pr close --delete-branch` cannot). A process can change hands at any gate:
ask Claude to hand it off (or run `/gtd throw @dev`) and it opens a draft pull
request assigned to them, and `/gtd catch <pr>` picks it up exactly where it
waits, so whoever wrote the requirements can hand the build to someone else.
`/gtd pr` brings a pull request's unresolved review threads into the review:
each becomes a note in `.gtd/REVIEW.md` ticked "fix as suggested" (untick it for
"won't fix" plus a reason, or your own answer), the review door fixes them in
place, and each thread then gets a reply naming the fixing commit (or your
reason) and is resolved. Ship, hand-off and throw answer at once and run in the
background, with progress on the status line; they report by waking Claude, a
toast, a transcript line and a push notification, and a failed push or `gh` call
reports as a failure. While a ship or hand-off runs or is queued, `/gtd catch`,
the doors, `/gtd <requirements>` and bare `/gtd` wait for its report. See
[Inside Claude Code](https://github.com/pmelab/gtd/blob/main/docs/driver.md#inside-claude-code-the-gtd-mod).

### Then let an agent build your own

But lets be honest, who reads documentation these days. Paste this into your
coding agent:

```
!gtd install
```

It prints a self-contained briefing that teaches the agent to set the project
up, build four commands for itself in whatever shell or runtime it runs, and ask
you what you want before it starts driving. You get one prompt to paste, not a
state name to choose. The four commands: **`gtd-build`** drives beats until the
process rests; **`gtd-edit`** opens the steering file the process is waiting on
right now — falling back to `.gtd/TODO.md` when the resting state declares none;
**`gtd-door <name> [args...]`** starts a process through a door (`gtd-door fix`,
`gtd-door review [base]`, `gtd-door rollout <flag>`, `gtd-door cleanup <flag>`
where the config exports them) and drives it. The `.gtd/TODO.md` fallback is
also how you begin: on a clean repository the edit command opens the empty
`.gtd/TODO.md`, and whatever you write there is the first sketch the whole
process gets planned from. As a final step, if it finds an LSP-capable editor,
the briefing also offers to wire up live diagnostics and review actions in it —
asking first and naming the exact file, and merging rather than overwriting your
editor's config. That editor integration also adds a footnote at the exact
cursor position with one code action, landing the cursor in the new, empty
definition ready to type, and jumps between a footnote's marker and its
definition both ways — so leaving a comment for the next agent turn never means
hand-typing the `[^name]` syntax yourself. In a review file, a `./path#42-70`
hunk pointer is also a clickable link straight to that file and range, no
go-to-definition required. A footnote can also hold a `H:`/`A:` conversation (a
thread — see [configuration](docs/configuration.md)); the editor outlines
threads, flags the open ones, and a `gtd: reply` code action adds your empty
`- H:` entry and puts the cursor there; `gtd check <mode> <file> --open-threads`
lists the ones still waiting on you, and a review question gets its answer at
the review gate again, not a lap. The same conversation works as bare `// H: …`
/ `// A: …` line comments (`#`, `--`, `;` by language) in files the process
changed; `gtd check --open-threads` alone lists the open ones (editor-only — the
phone UI does not show them).

### The workflow it ships with

One built-in workflow drives all of that. From where you sit, it has four
moments — everything between them runs without you, with the judged exceptions
noted in steps 3 and 4 below.

1. **You sketch.** Change anything, or write the idea into `.gtd/TODO.md`. Rough
   is fine; it is treated as a sketch, not as work.
2. **You answer questions and discuss.** Planning works out what the thing
   should do and hands you `.gtd/REQUIREMENTS.md` — every process stops there,
   even with no open question. Answer open questions in your editor, in the
   file, and start the loop again; a round that only leaves notes needs no tick.
   Start a footnote with `- H: <question>` to ask something: the agent replies
   with `- A: <reply>` and the process stops at the same gate again. Close a
   thread by replying with a conclusion or deleting it. While a thread's last
   entry is the agent's, moving on is refused. Leave the file untouched and
   start the loop to accept the plan as-is, unanswered questions and all. The
   file lists numbered acceptance criteria (`AC-1`, `AC-2`, …) that bind the
   build. Sketch your own under an `Acceptance criteria` heading and, when a
   judge finds every one clear and checkable, they are recorded as they are and
   this moment is skipped; one vague criterion brings it back. See
   [Acceptance criteria](docs/configuration.md#acceptance-criteria).

3. **You wait.** The agent first implements the requirements the quickest way
   that works — the naive pass — and a judge reads where it changed code (see
   [the naive pass](#the-naive-pass) below; with [flag mode](#the-naive-pass)
   off, no judge runs). A pass the judge lets through is the implementation; one
   whose seam is refactored first is built again test-first. Then it is checked
   against the full suite (`testCommand`) and fixed until it passes — so keep
   that suite fast; gtd has no lighter one. Scenario wording is not frozen: a
   review's `## Scenarios` chunk marks any assertion an existing scenario lost
   as `Weakened:`, so you sign the scenarios off at step 4. After the build the
   quality lap runs. Three points along the process (two with flag mode off) are
   judged rather than always asking you outright — each stops and hands you a
   verdict to make (`gtd judge answer`, or land with a clean tree to accept the
   conservative default, which never skips work;
   `gtd judge run --provider fixed --answers <path>` — or the
   `GTD_JUDGE_ANSWERS` env var, inline JSON — answers one from a file, piped
   between `gtd judge --json` and `gtd judge answer`;
   `gtd judge run --provider jev` asks TypeSafe's Jev instead, with the key in
   `TYPESAFE_API_KEY` and `JEV_BASE_URL` optionally overriding the endpoint;
   `gtd judge run --provider llm` asks the `claude` CLI on `PATH` (Claude Code
   users only; model `sonnet`; `--model <name>` overrides) and reuses its login.
   With no `--provider`, `gtd judge run` picks jev when `TYPESAFE_API_KEY` is
   set and non-empty and no `--model` is given, else llm — never falling back
   across them; the `GTD_JUDGE_PROVIDER` / `GTD_JUDGE_MODEL` environment
   variables and a user-level `~/.config/gtd/judge.json` `{ provider, model }`
   choose the judge without editing the driver (flags win over both, in that
   order); `--model` with `--provider fixed`/`jev` is refused. jev and llm exit
   1 with nothing on stdout when they cannot answer every question):
   - After the naive pass: does it land as is, need its seam refactored first,
     or get rejected and retried?
   - Every red round after the first: was the failure identical, new, or
     progress?
   - After you review: is each of your notes an edit, a question, a nit or
     praise?

   gtd itself never calls a judge: the Claude Code mod and the reference driver
   answer these through `gtd judge run` (auto selection: jev when
   `TYPESAFE_API_KEY` is set, else `llm` via `claude`, default model sonnet,
   while the Claude Code mod's own judge subagent stays on `haiku` —
   `--model <name>` overrides); if that fails it shows you the message and
   stops. **The `llm` provider's `p` is self-reported by the model, not a
   measured probability, so a confidently wrong verdict can clear the 0.7 floor
   and skip a gate unattended.**

   Once the change is built, the whole change goes through a qualitative review
   lap before you see anything: six lenses, one turn each, in order —
   `correctness`, `owasp-security`, `ponytail-review`, `test-audit`,
   `conventions`, `spec-challenge`. `correctness`, `owasp-security` and
   `spec-challenge` run on the planner model (`smart`), the other three on the
   coder model (`base`); a `qualityReviews` entry `<lens>=<model>` picks a
   lens's own. Each traces the change from its own angle and records every
   finding, blocking or not, as its own `## ` chunk of `.gtd/QUALITY.md`. A
   clean turn means approval only when that lens found nothing at all. The
   lenses are the only agentic review: a judge (`build.quality.triage`) then
   classifies each finding — `mechanical` ones are fixed by the fix turn
   (`build.fix.quality.fixing`, up to three turns), `noise` is dropped with its
   `p` recorded as `Gtd-Mark: noise=<id> p=<p> <title>`, and `design` ones
   (questioning a criterion or the approach) become notes for your review. An
   unsure verdict (below `qualityTriageMinP`, `0.7`) is `design`; mechanical
   findings the fix turns leave become notes too. This lap is where code quality
   is looked at, and every round pays for it. It never replaces step 4 — your
   review stays the final gate, and nothing here skips it. Every
   [coarse slice](docs/configuration.md#coarse-slices) runs the same triaged lap
   and never rests for its findings: its notes are carried to the review after
   the last slice, each naming its slice and lens, beside every slice's fixes.
   The `fix` and `cleanup` doors triage their lap too, and hand its notes to
   their own review.

   A red suite that keeps failing past a few fix attempts escalates instead of
   retrying forever: an agent turn reads the failing output and writes
   `.gtd/ESCALATION.md` — what's failing, why the earlier attempts didn't fix
   it, and what to try next — and the process stops for you to edit or land
   as-is, handing that document to the next fix turn as its instruction. Two
   such rounds with no fix is the terminal stop: the last analysis stays on disk
   instead of a third being written, and editing it is what gets the next
   attempt anywhere new. A loop the retry judge still calls progress at the cap
   gets one extra fix turn first. Before any escalation or red-baseline stop the
   suite runs once more; a pass there continues without you and is recorded as
   `Gtd-Mark: flaky=<check>` (see
   [Re-check before a person](docs/configuration.md#re-check-before-a-person)).

4. **You review.** After the last slice's quality lap gtd writes the review
   document itself (`build.review.composing`; no reviewer turn runs): one `## `
   chunk per design note the lap left, each ending in three tick boxes — **fix
   as suggested**, **won't fix**, or **your own answer** written over
   `_your answer_` — then, for reference, no tick boxes, no answer needed — what
   was **fixed automatically** (with the fixing commit) and what was **dropped
   as noise**. On `refactor-first` the refactor slice gets one of its own first,
   before the feature is built; see [the naive pass](#the-naive-pass). Review
   the diff yourself (`gtd base` prints its base). **Every note needs exactly
   one tick before `gtd land` accepts the review** (`answer-completeness`; an
   open `- H:` thread waiting on the agent is the one exception). Fix as
   suggested joins the nit batch below, unjudged; won't fix drops the note and
   records it as `Gtd-Mark: wontfix=<title>` on the gate's commit; your own
   answer is judged like a note. A note you answered is left out of the fresh
   review after a nit fix; a round that also answered a question restores the
   review instead, your ticks kept. Land with every note answered and nothing
   else changed to approve, or write what is wrong — disagreeing with a fix or a
   drop means writing a note of your own. Approving ends the process (at the
   refactor review, it moves on to the feature); feedback is judged note by
   note, each as `edit`, `question`, `nit` or `praise`. An `edit` sends the
   process back to step 2 for re-derived requirements — the built criteria keep
   their IDs (reworded in place when their behaviour changes) and new behaviour
   gets new ones — then the implementation is amended to meet them, with no new
   naive pass or seam judge, every criterion's coverage is judged again, the
   quality lap runs, and you review again. At the refactor review an `edit`
   re-derives the refactor instead. A `question` is answered inline under your
   note and the process stops at the review again — no new plan. A `nit` is
   fixed in one batch, the suite must go green (a red one gets fix turns first),
   then a fresh review of the change stops at the review again. `praise` is
   dropped; a round of only praise signs off. When a round mixes them, questions
   are answered and nits fixed first, then the edits are planned — risk: the
   planning lap may redo nit fixes it touches.

   Each `edit` note also gets a severity tier from four judge questions
   (security, reversibility, blast radius, new concept). Every tier is
   re-planned this round, `critical` first, then `should`, then `could`; nothing
   is deferred. A leading `!` on a note forces `critical` and skips the judge.
   `reviewSeverityMinP` sets the confidence floor (see
   [configuration](docs/configuration.md)). A hand-edit to code always plans a
   lap. Only a confident non-`edit` verdict skips the replan — a note whose
   evidence was cut, or that got no verdict, counts as `edit`. The same
   `gtd judge answer` / conservative-default shape as step 3's own judged
   points.

   **The review learns your taste.** Each won't-fix and each own answer is a
   candidate standard. A judge (`build.review.standards.judge`) asks whether it
   is reusable beyond this note; at `standardMinP` (`0.8`) or above it is kept
   in `.gtd/STANDARDS.md` with no question asked, and the next review lists it
   under `## Standards added`. Every later agent turn — the lenses, the naive
   pass, the build, every fix — is handed the kept standards, so a finding you
   rejected once is not raised again and a rule you wrote is followed, in this
   process and every later one. One the judge does not confidently rule out
   contradicting a standard already kept is not applied: it waits under
   `## Undecided` and becomes a `## Standard conflict <id>` note in the review,
   with its own three boxes — **keep the new one (drop the old)**, **keep the
   old one (discard the new)**, or **your own wording**, which replaces both —
   and the review does not sign off until it is answered. `.gtd/STANDARDS.md` is
   committed and yours to edit; gtd rewrites it as one bullet per standard when
   it learns.

You never talk to it. Every exchange is a file in `.gtd/` that you edit in your
own editor, and every answer you give is a commit. Your test suite is the gate
throughout: a red baseline stops the process before it starts, and a red build
is fixed before review.

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
the agent may overturn the answer. See
[Configuration](https://github.com/pmelab/gtd/blob/main/docs/configuration.md)
for its `ui:` settings.

The bundled workflows are named `feature` (the ordinary start above), `review`
and `fix`. `review` and `fix` never plan. Each brings its own door. This
command:

```bash
gtd door review <commitish>
```

starts a review of everything from `<commitish>` to HEAD — the same review a
`feature` process ends with, minus planning and building. A green gate, then the
quality lenses: mechanical findings are fixed, noise is dropped, and the rest
become notes in `.gtd/REVIEW.md`, one tick box each. Tick `fix as suggested` or
write your own answer and the process fixes it in place — your own answers that
ask for a change are collected into `.gtd/REQUIREMENTS.md` and built by one
`feedback.fixing` turn, with no design phase and no criteria — under the health
loop, then asks for your review again. Sign off (or tick `won't fix`) and it
closes; nothing is left behind. A note asking for new behaviour belongs in a
`feature` process: tick `won't fix` and start one. `gtd door fix` repairs a red
baseline as its own reviewed commit; a note at its review is left in
`.gtd/REVIEW.md` (beside the reviewer's original, `.gtd/REVIEW.orig.md`) for the
next `gtd door fix`, and until that runs, starting `feature` or `review` is
refused — remove both files to abandon the hand-off. `gtd doors` lists the doors
of the workflows your `gtd.config.ts` exports, plus any it adds.
`gtd --workflow <name>` starts any workflow by name.

The workflow itself is a plain async TypeScript function, and the
`gtd.config.ts` at the repository root names it: the one `gtd install` writes
re-exports each shipped workflow from its own subpath
(`@pmelab/gtd/workflows/feature`, `…/review`, `…/fix`), and the pieces they are
built from are exported for yours to reuse. Each shipped workflow is a factory —
`feature({ testCommand: "npm run ci" })` — whose options gtd validates when it
loads the config: a misspelled or mistyped one fails every command, naming the
workflow, the key and what was expected. See
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

#### The naive pass

After design the agent first implements the requirements directly,
breadth-first, with a behaviour-level acceptance test per criterion that names
its ID (`[AC-3] …`) and reaches only code that existed before the pass. The pass
is sent back while a criterion's ID is missing from its tests, a test imports a
file it added, or the suite is red on it. A judge checks whether it changed
anything outside the expected set (tests, steering files; see `seamAllow`).
Incidental changes land: the pass itself is the implementation, with no rebuild,
straight through the health loop and the quality lap. A needed seam change
resets: the pass is never applied. An agent reads its whole diff and writes a
refactor note (`.gtd/REFACTOR-NOTE.md`: which seams, which shape); the seam is
refactored first, flag-free with the existing suite green, in its own slice with
its own quality lap (`refactorQualityReviews`) and review; then the feature is
rebuilt on the refactored base, behind a release flag, with the note and the
naive diff as reference. The rebuild is refused until its tests carry every
criterion ID the naive pass's tests named, and the suite must be green with
them. A wrong approach is retried twice, then rests for you to steer or overrule
it. `gtd slices` lists the `refactor` and `feature` slices. A refactor that
already carried the whole feature leaves the rebuild only the carried-over
tests, and the feature's quality lap and review cover the whole change. Once the
implementation is green, a judge checks every criterion ID has a covering test:
an uncovered one goes back to the agent (twice, then to you) instead of ending
the feature, and each covered ID is recorded as a `Gtd-Mark: covers=<id>`
trailer. See
[Acceptance-criteria coverage](docs/configuration.md#acceptance-criteria-coverage).
Feedback at the feature review re-runs design and the implementation, never the
naive pass; feedback at the refactor review re-runs the refactor, never design;
a refactor-review change the refactor cannot build is refused, and the only way
out is `gtd abandon`. A process from 27.5.0 or later whose judge ruled
`refactor-first` must `gtd abandon` too. Each slice's quality lap reviews only
that slice. Details in
[the naive-pass path](docs/configuration.md#the-naive-pass-path).

**Coarse slices (`sliceMaxCriteria`, default 8).** A change with more acceptance
criteria than the cap is built in slices: after design an agent groups related
criteria (same flow or subsystem) into `.gtd/SLICES.md`, as few slices as the
cap allows, and each slice — naive pass, refactor and rebuild when judged so,
health loop, quality lap — runs in order from where the previous one landed; the
review follows the last one and covers the whole change. `gtd slices` lists them
as `feature-1`, `feature-2`, … (`refactor-<n>` ahead of a refactored one). A
change within the cap is one `feature` slice, as before. See
[Coarse slices](docs/configuration.md#coarse-slices).

**Flag mode (`flagMode`, on by default).** On, the naive pass's judge runs as
above and a rebuilt implementation is asked for a new release flag (none at a
`low` risk tier); a pass the judge lets land is not asked for one. A project
that is not publicly released turns it off explicitly —
`feature({ flagMode: false })` in `gtd.config.ts`, it is never detected: then no
flag is asked for, no seam judge or refactor runs, and the naive pass lands as
the implementation, straight through the health loop and the quality lap. See
[`flagMode`](docs/configuration.md#the-bundled-workflows-settings).

**Risk tier (flag `GTD_FLAG_RISK_TIER=1`, off by default).** Triage proposes a
risk tier, `low` or `high`, and the production signals to watch after merge.
Edit the first word under `## Risk Tier` at the design gate to change it; a
missing or unreadable tier means `high`. Each lap lands a
`Gtd-Mark: risk-tier=<low|high>` trailer and a `Gtd-Mark: production-signal=…`
trailer per signal; `gtd summary` reads the last lap's only. Its "needs a human
reviewer" line for `high` is advisory, not a gate.

A `gtd.config.ts` call to `buildTail` or `tail` that fits neither call form is
rejected; `tail`'s positional form is deprecated for `tail(finish, options?)`.
See [docs/configuration.md](docs/configuration.md).

### Rolling out and cleaning up release flags

Two more bundled workflows retire a release flag. They are opt-in: the
`gtd.config.ts` that `gtd install` writes does not export them, so add `rollout`
from `@pmelab/gtd/workflows/rollout` and `cleanup` from
`@pmelab/gtd/workflows/cleanup` to its exports first. `gtd door rollout <flag>`
turns it default-on, `gtd door cleanup <flag>` removes it afterwards
(`/gtd rollout <flag>` and `/gtd cleanup <flag>` in Claude Code;
`gtd --workflow rollout --var flag=<name>` works too). See
[Feature flags](docs/configuration.md#rolling-out-and-cleaning-up-a-release-flag).

Rollout makes "on under `GTD_FLAG_<NAME>=1`" prose wrong until cleanup, so once
the suite passes it lists every line outside the registry that names the flag
(as `path:line`, the first 50, then a `git grep` command over tracked files for
the rest) and edits none of them, leaving no file behind. The squash carries the
list only through the closing message `gtd summary` writes; the `Gtd-Mark:`
trailers survive only in the process history ref `refs/gtd/history/<entry>`,
recovered with `gtd history fetch | sh` and read with
`git log --format=%B <ref>`. An empty list says so in one line. Fix the prose by
hand or leave it for cleanup.

The delivery model these workflows implement: [Delivery model](SDLC.md).

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
commit of every slice. The push is forced, so it replaces origin's copy of that
one ref. If that push fails, the ship fails and nothing is squashed. Recover the
full trail with `gtd history fetch | sh`, then `gtd history show <ref>`.

```sh
gtd history list                 # one line per kept process
gtd history show <ref>           # replay its steps, judge verdicts and approvals
gtd history metrics [ref...]     # how the kept processes went, per process and in total
gtd history judges [ref...]      # how often each judge's verdicts were overturned
gtd history fetch | sh           # pull every kept ref from origin
```

`gtd history metrics` measures the bundled `feature` workflow from the kept refs
— every ref, or the ones named. It reads commit subjects and trailers only, so
it never replays and a config changed since is no refusal:

- **refactor-first rate** — of the slices whose naive pass was decided, the
  share rebuilt rather than landed as it is; a landed pass that no longer
  applies and is built afresh counts as rebuilt (`refactored` counts the
  rebuilds a refactor came first for)
- **continuations** — agent turns that picked up a turn stopped at its context
  limit, per phase (`seam.naive`, `implement.building`, `refactor.building`, …)
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
process kept from that branch. A rate is `null` without a decided slice. Each
process names its `workflow` (`null` for the default one); the total spans every
ref measured, so name the refs to leave another workflow's processes out.

`gtd history judges` calibrates three of the bundled `feature` workflow's judges
from the `Gtd-Judge` verdicts the kept refs recorded. It never replays and asks
no model. A verdict is **overturned** when later history contradicts it:

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
overturned). `--var <threshold>=<value>` re-decides every past verdict under
another threshold and prints the decisions that would change, against the
threshold each process recorded (a process that recorded none is left out):

```sh
gtd history judges --var qualityTriageMinP=0.9
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
`seamGate` helper does this for a `refactor-first` diff-shape judgment; the
shipped flow does not use it). Only a clean `gtd land` approves it, and the
commit records who in a
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

| Import                                                                                                                                                         | What it is                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@pmelab/gtd/flows`                                                                                                                                            | The flow API a workflow is written in: the steps (`agent`, `human`, `run`, …), `scope` and `slice` (named spans of a process), workflow factories, `defineConfig` and `FLOWS_PROTOCOL`.                |
| `@pmelab/gtd/wire`                                                                                                                                             | The driver protocol: `WIRE_SCHEMA`, the exit codes and the types of every `--json` document.                                                                                                           |
| `@pmelab/gtd/steering`                                                                                                                                         | The steering-file formats (`qa`, `review`) and the review-note readers.                                                                                                                                |
| `@pmelab/gtd/workflow-kit`                                                                                                                                     | Policy-free building blocks to compose a workflow from: health checks, quality laps, scenario freezing, review tails.                                                                                  |
| `@pmelab/gtd/workflows`                                                                                                                                        | Every shipped workflow and all its parts in one module; also resolvable as `@pmelab/gtd/workflow`.                                                                                                     |
| `@pmelab/gtd/workflows/feature`, `@pmelab/gtd/workflows/review`, `@pmelab/gtd/workflows/fix`, `@pmelab/gtd/workflows/rollout`, `@pmelab/gtd/workflows/cleanup` | One shipped workflow each: its factory as the default export, its parts, and the reserved exports (`defaults`, `envDefaults`, `summary`, `steering`, `skills`, `access`). `gtd install` imports these. |
| `@pmelab/gtd/testkit`                                                                                                                                          | Runs any workflow against the real engine, in an in-memory or a real repository. Needs `vitest` and `quickpickle`, optional peer dependencies.                                                         |

Types come from the TypeScript sources the package ships. Configs never need an
install for any of these but `./testkit`: gtd resolves a `gtd.config.ts`'s
`@pmelab/gtd/*` imports to its own copy.

The `gtd` bin's commands — `next`, `land`, `abandon`, `restore`, `validate`,
`check`, `uncheck`, `install`, `summary`, `base`, `door`, `doors`, `slices`,
`version`, `help`, `history list`, `history show`, `history metrics`,
`history judges`, `history fetch`, `strays`, and the tools `ui`, `lsp`,
`context-hook`, `judge` (`judge answer`, `judge run`) — are listed in the
[CLI reference](https://github.com/pmelab/gtd/blob/main/docs/cli.md).
`gtd slices` lists the spans a flow's `slice()` calls mark. It refuses (exit 1)
when HEAD neither closes nor sits inside a process, or when today's config
disagrees with history about the process; a version mismatch only warns on
stderr. `gtd summary --slice <name>` prints the closing-message prompt for one
of those slices — its own range, human commits and cost — and inherits those
refusals; an unknown name is refused with every valid slice listed.

## License

MIT
