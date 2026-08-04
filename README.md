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

That's it — gtd ships the **unified** workflow as its **built-in default**, so a
state command works out of the box with no configuration at all.

Optionally, seed the settings a project usually tunes — run once:

```bash
gtd init
```

This writes a minimal `.gtdrc.json` seeding the one variable most projects
change — the test command (`vars.testCommand`, defaulting to `npm test`) — plus
a top-level `modes:` block suggesting **Prettier** as the steering-file
formatter (`npx prettier --write` for the built-in `qa`/`review`/`prose` modes —
format only, so gtd still validates the `qa`/`review` ones; `prose`, used by the
simple flow's plan file, has no validator to begin with); edit or drop either
freely (point `testCommand` at your suite, swap Prettier for dprint or a script,
delete a key). It writes **no** `workflow:` key — the machine is built in — so
review and commit the file before your first `gtd step`. `gtd init` takes no
argument and refuses to clobber an existing config; it may also run in a plain
parent directory (not a git repo) to seed a shared config a nested repo picks
up. To customize the machine itself, add a `workflow:` key (there is no default
fallback to merge over — a `workflow:` is the whole definition).

## How it works

gtd is a small **pattern machine**: named states, each awaiting one actor and
carrying one piece of content (a script, a prompt, a message, or a squash commit
template), with an ordered set of change-patterns routing to the next state.

The loop is one beat, repeated: run `gtd next --json` and dispatch on `kind` —
`"message"` means it's a human's move (stop and hand off); `"script"` means the
driver runs `content` itself, then steps its actor; `"prompt"` means feed
`content` to your agent, then run `gtd step <actor>` once it's done. gtd itself
never executes anything — the driver owns running scripts.

An `on` edge may also carry a short imperative `action` (e.g. `Accept plan`)
alongside its existing `describe` sentence — a human-facing name for the choice
itself, not just the underlying glob pattern. `gtd status` (plain and `--json`)
and `gtd visualize`'s diagram and inspector all render the two composed
together: the `action` leads when the edge declares one, with the raw pattern
(and `describe`) still shown alongside it, so a human choosing between routes
reads intent first, glob second.

The unified workflow has **entry points behind a green-baseline gate, into one
shared tail**. Every entry first runs your test suite and only starts once it's
green — you never build (or review) on top of a red baseline; a red run halts
and tells you to repair it first (that's what `gtd fix` is for). The two
steering-file entries are chosen by which file you create:

- Create **`.gtd/TODO.md`** with a short sketch to start the **simple** flow: an
  agent develops your sketch into a concrete plan — deciding open points itself
  rather than asking questions — and hands it back for you to accept as-is or
  edit. Editing sends it round again; accepting builds the plan in one turn and
  runs your tests (looping on failures) — the check run also mechanically sweeps
  `.gtd/TODO.md` and other spent steering files, so a plan that's left in place
  by mistake never leaks into the review diff or the final squash.
- Create **`.gtd/REQUIREMENTS.md`** to start the **advanced** flow: two-phase
  product then technical Q&A (`.gtd/REQUIREMENTS.md` → `.gtd/ARCHITECTURE.md`) —
  each open question offers a couple of candidate answers plus a
  `- [ ] _your answer_` slot, and you tick exactly one per question (the gate
  won't let a phase advance while any question is unanswered) — then
  decomposition into work **packages** (each a set of independent tasks a single
  build turn fans out to parallel subagents), a per-package test loop, and a
  per-package **agentic review** that verifies the package against its spec.

Both flows converge on the same tail: an agent hands you a `.gtd/REVIEW.md`
checkbox review of the diff — the prompt never inlines the diff itself; it names
the commit the changes are based at and the agent runs `git diff` to read the
range before writing the review. Tick a box as you review each hunk (ticking
just records "I read this"), and leave a **comment** to request changes: a note
on a line, an inline `// TODO`-style comment in the code, or a direct code edit.
Any comment sends a build + re-review round — an agent first turns your comments
into an explicit instruction list, then a build turn implements it (a re-review
then covers only the follow-through, and a hand-edit is treated as your own fix
the agent completes without reverting your lines; a comment can't be silently
dropped — a build turn that addresses nothing is refused). Ticking every box
with no comment is the sign-off, which collapses the whole cycle into one commit
(a **squash finale** whose message an agent drafts). Stepping with a box still
unticked and no comment is refused (finish reviewing first), as is deleting
`.gtd/REVIEW.md`.

The same review tail also has a direct entry point — `gtd review <commitish>`
starts a brand new process reviewing `<commitish>..HEAD` with no cycle of its
own, e.g. a colleague's PR branch. Its squash keeps and describes only the fixes
made _during_ the review (not the reviewed changeset); a clean sign-off with no
fixes becomes an empty `chore: human review` commit. A fourth entry, `gtd fix`,
starts from a clean `idle` and goes straight into repairing a red baseline —
repair, review, and squash into one commit. If the suite is already green there
is nothing to fix, and the log is left untouched — no commit is left behind.

Every agent state routes its model through two `vars` tiers — `plannerModel`
(heavier planning and review) and `coderModel` (the coding turns) — so you can
repoint the models globally in one place (a `vars:` edit or a `GTD_PLANNERMODEL`
override) instead of per state. Steering-file path vars (`feedbackFile`,
`reviewFile`, …) work the same way, and propagate to the `on` patterns that
route on them too — a repointed path var actually reroutes the machine, not just
the templates that read/write the file. A separate `stateDir` var (default
`.gtd`) names only where the check scripts keep their own scratch/bookkeeping,
independent of the per-file vars — relocate one steering file without touching
it.

To inspect or change the machine itself, see [Configuration](#configuration) —
the workflow is just `.gtdrc` config.

## Commands

```
Usage: gtd [command] [options]

Commands:
  (no command), loop
                   Launch the loop driver (bin/gtd), which repeatedly drives
                   an agent through gtd next/gtd step calls until the
                   workflow rests at a human gate (a non-autonomous state)
                   or settles. A bare gtd invocation and gtd loop both
                   launch it identically
  init             Scaffold a minimal .gtdrc.json for this repo, seeding the
                   default variables you are most likely to change (the test
                   command) and a Prettier formatting suggestion. gtd runs its
                   built-in workflow by default, so no workflow is written —
                   add a workflow: key only to customize the machine itself.
                   Takes no argument. Run once per repo; refuses if a gtd
                   config already exists. Leaves the file uncommitted for you
                   to review and commit
  step <actor>     Authenticate as <actor>, match the resolved rest's
                   declared patterns against the pending changes, and commit
                   (or squash) the one resulting transition. Pass
                   --cost=<n> (optionally --model=<name>) to record the
                   just-finished invocation's token cost and model on the
                   turn commit (summed into it.processCost/processCostByModel)
  review <commitish>
                   Start a NEW review process at the workflow's declared
                   review-entry state (reviewEntry: true), reviewing
                   <commitish>..HEAD — e.g. a colleague's PR branch. Requires
                   a clean tree resting at the workflow's initial state
  fix              Start a NEW process at the workflow's declared fix-entry
                   state (fixEntry: true) that goes straight into repairing the
                   current failing tests. Requires a clean tree resting at the
                   workflow's initial state
  abandon          End the process currently underway without completing it:
                   close any open review checkout window, then rewind HEAD to
                   the commit the process started from, keeping everything it
                   produced as uncommitted changes. A no-op when no process is
                   underway
  restore          Hard-reset HEAD back to the pre-squash tip retained by the
                   last squash/abandon (refs/worktree/gtd/history), undoing a
                   squash or bringing back an abandoned process's turns.
                   Refuses on a dirty working tree, when there is no retained
                   history, or when HEAD has advanced past the squash with
                   commits that would be lost
  next             Print the resolved rest's rendered script/prompt/message
                   (no mutation)
  status           Print the resolved rest's state/actor and which declared
                   pattern (if any) each pending change matches (no mutation)
  validate         Format and validate the steering file the resolved rest
                   declares, with its mode's commands (its file:/mode:);
                   exits non-zero with the findings when it is invalid
  lsp              Start the LSP server for .gtd/ steering files (stdio)
  visualize        Serve an interactive diagram of the active workflow on a
                   local web server (--port <n>, --no-open; --json prints the
                   model and exits)
  version          Print version and exit
  help             Print this help and exit

Options:
  --json           Output structured JSON instead of plain text
  --port=<n>       (gtd visualize only) port to serve on (default: a free port)
  --no-open        (gtd visualize only) do not open the browser
  --cost=<n>       (gtd step only) record the invocation's token cost
  --model=<name>   (gtd step only, with --cost) tag that cost's model
  --once           (bare gtd or gtd loop only) run exactly one loop beat (one
                   human-gate capture, one script check+step, or one agent
                   prompt+step), then exit
  --version, -v    Print version and exit
  --help, -h       Print this help and exit
```

`--version` (`-v`) / `gtd version` and `--help` (`-h`) / `gtd help`
short-circuit before any git or repository-state work — they run outside a repo
and in any repo state. Bare `gtd` (no subcommand) and `gtd loop` both launch the
loop driver immediately — neither is a usage error. Any other, truly unknown
subcommand is a usage error: it prints the help text and exits 1 without
touching the repository. Every other (recognized) command must be run from the
**repository root** — gtd derives the workflow, pending changes, and process
history relative to cwd, so it refuses with a clear error if invoked from a
subdirectory.

`--json`, `--cost=<n>`, and `--model=<name>` (the latter two only for
`gtd step`) are the only long options the compiled bundle recognizes. Any other
`--` option (including a typo like `--jsn`) is rejected with a usage error
rather than silently ignored, so a mistyped flag can never degrade a JSON caller
to plain-text mode. A bare `--cost`/`--model` with no value, a non-numeric or
negative `--cost`, an empty `--model`, `--model` without `--cost`, or either
flag on any command other than `gtd step` are all usage errors.

`--once` is a separate, bash-level flag handled entirely by the `bin/gtd` driver
itself, stripped before anything reaches the bundle.

### `gtd status`'s `Next:`/`next`

Both plain and `--json` output include a headline preview of what would happen
next: the first declared `on` edge whose pattern matches the pending changes AS
A WHOLE (the same first-match-wins semantics `gtd step` itself uses), using its
`action` when the edge declares one, else its raw pattern, alongside its target
state. Plain output prints a `Next: <action-or-pattern> → <target>` line (or
`Next: (no match — nothing would happen)`); `--json`'s `next` key mirrors it as
`{ action?, pattern, target }`, or `null` on no match.

This reports the **declared** route only: a capped `retry` may redirect
elsewhere at real step time, which `Next:`/`next` does not apply — it previews
what the declared `on` patterns would match, not a guarantee of where a real
`gtd step` lands.

### Error envelope

Every command, in `--json` mode, reports a failure as a machine-readable
envelope on **stdout**, and still exits 1:

```json
{ "state": "error", "prompt": "<message>" }
```

A human-readable `gtd: <message>` line is still written to **stderr** regardless
of `--json` — the envelope adds a structured stdout channel, it does not replace
the plain-text one.

## Driving the loop

Bare `gtd` (or `gtd loop`) is a ready-to-run driver for the whole protocol —
point it at a repo and it runs the loop until it's your turn. It drives the
autonomous states (agent turns, check runs) and stops at the first
non-autonomous one: reaching a human gate it prints the gate and exits. You act
by editing files (answer a plan question, tick a review box, fix code) and
re-launching it — its opening move captures whatever you left, so you never run
`gtd step human` by hand.

Anything richer at that boundary — opening your editor, desktop notifications,
terminal-multiplexer status — is the job of an outer wrapper around `gtd`, not
of the loop itself; see
[Terminal-multiplexer status: a herdr wrapper](#terminal-multiplexer-status-a-herdr-wrapper)
below for a worked example. Pass `--once` to restrict a run to exactly one beat
— one human-gate capture, one check, or one agent turn — instead of driving all
the way to idle.

Bare `gtd` prints one line per event — colored and emoji on a real terminal,
plain ASCII under `NO_COLOR` or when piped — and redirects the noisier
agent/check/step subprocess output to a per-repo/per-worktree log file (its path
is the run's first output line, ready to `tail -f`). Any execution that FAILS
also replays its last 20 lines of output inline on stderr, on top of the log
still holding the complete record: an agent turn that fails stops the loop (it
would fail identically next lap), while a check script that exits non-zero is
reported as a warning and the loop carries on, because the outcome lives in the
tree, not in the script's exit code.

A workflow state can declare an optional `label:` — a human-readable display
name surfaced in `gtd next --json`/`gtd status`. The driver uses it for its
per-beat progress lines; an outer wrapper (a terminal multiplexer, a notifier)
can use it the same way.

### Terminal-multiplexer status: a herdr wrapper

[herdr](https://herdr.dev) shows a per-pane status in its sidebar. This wrapper
reports `gtd`'s own lifecycle to that status without any herdr-specific
knowledge in `gtd` itself: `working` while the loop drives, `blocked` when it
comes to rest on a human (a gate, a stall, a non-zero exit), and `idle`
(rendered as "done" once the pane's tab is unfocused) when a run ends without
anything owed. It needs nothing from `gtd` beyond `gtd next --json`'s `.actor`
field, which the loop's driver already reads at every beat.

Save this as `~/.local/bin/gtdh`, `chmod +x` it, and run `gtdh` in place of
`gtd` — it's a plain bash file, so it works from fish or any other shell, and it
forwards every argument (`gtdh --once`, `gtdh status`, ...).

```bash
#!/usr/bin/env bash
# Report gtd's own lifecycle to the herdr pane it runs in: working while the
# loop drives, blocked when it rests on you, idle (shown as "done") otherwise.
# Needs nothing from gtd but `gtd next --json`. Outside herdr it is a plain
# passthrough. Requires `jq` — so does gtd's own loop driver.
set -uo pipefail

pane="${HERDR_PANE_ID:-}"

# `--agent gtd` is deliberate: herdr only lets screen detection (or a visible
# approval prompt) override a reported state when the reported label names a
# KNOWN agent. "gtd" names none, so the loop's `claude -p` turns can never move
# this pane's status.
report() { # report <state>
  [ -n "$pane" ] || return 0
  herdr pane report-agent "$pane" \
    --source custom:gtd --agent gtd --state "$1" >/dev/null 2>&1 || true
}

report working
trap 'report blocked; exit 130' INT TERM

# HERDR_PANE_ID is unset for the loop: herdr's Claude Code hook needs it, and
# without it no `claude -p` turn reports a claude SESSION identity for this
# pane. That is load-bearing, not cosmetic — a pane that owns one rejects every
# later state report, so the report below would be dropped.
env -u HERDR_PANE_ID gtd "$@"
rc=$?

# Whose turn is it now? `gtd next --json` is mutation-free. A human actor means
# gtd is waiting on you; anything else means the run ended with nothing owed.
actor="$(gtd next --json 2>/dev/null | jq -r '.actor // ""' 2>/dev/null || true)"

if [ "$rc" -ne 0 ] || [ -z "$actor" ] || [ "$actor" = human ]; then
  report blocked
else
  report idle
fi

exit $rc
```

A few things to know before relying on it:

- **Give `gtd` its own pane.** Run an interactive `claude` (or any agent whose
  herdr integration reports session identity) in the same pane and that pane
  owns a `herdr:claude` session until the process exits; while it does, the
  wrapper's reports are silently ignored and the sidebar stops tracking `gtd`.
- **`blocked` covers the resting `idle` state too** — gtd's own `idle` is a
  human gate (it waits for you to write a steering file), so a finished cycle
  reads as "your turn", which is what it is.
- The status **persists after the wrapper exits** — that's the point: the
  sidebar keeps showing which worktree is waiting on you. Hand the pane back to
  ordinary detection with
  `herdr pane release-agent "$HERDR_PANE_ID" --source custom:gtd --agent gtd`.
- A non-zero exit (a stall, a refusal, an error) reports `blocked`: herdr has no
  failure state, and those all need a human.
- Ctrl-C reports `blocked` rather than leaving a stale `working`.

Optionally,
`herdr pane report-metadata "$HERDR_PANE_ID" --source custom:gtd-display --token summary=<text>`
sets a value renderable as `$summary` in an Agent sidebar row, if you want more
than the state itself.

## Configuration

gtd reads an optional `.gtdrc` config file via
[cosmiconfig](https://github.com/cosmiconfig/cosmiconfig). With no `workflow:`
configured anywhere in the cwd→home config chain, the bundled unified workflow
is used automatically, so a state command works out of the box with no config at
all. Supported filenames (searched in this order):

- `.gtdrc`
- `.gtdrc.json`
- `.gtdrc.yaml`
- `.gtdrc.yml`
- `gtd.config.json`
- `gtd.config.yaml`

### Schema

`.gtdrc` has exactly three blessed top-level keys:

- **`workflow`** (object, optional) — the whole machine definition (its states,
  plus its own `vars:` defaults and `modes:`). Absent = gtd's built-in default
  is used. Declare it to fully REPLACE that default with your own machine (there
  is no `extends`/merge).
- **`vars`** (object, optional) — a flat `name -> scalar` map, one layer of the
  merged `it.vars` every template sees.
- **`modes`** (object, optional) — steering-file modes (`format:`/`validate:`
  shell commands), layered over the active workflow's own `modes:` and gtd's
  built-in validators, so a project can plug in its formatter or linter without
  re-declaring that mode on the workflow itself.
- **`$schema`** (string, optional) — stripped before validation, so it never
  counts as an unknown key. Point it at the published schema for editor-backed
  autocompletion (this is what `gtd init` writes):

  ```
  https://cdn.jsdelivr.net/npm/@pmelab/gtd/schema.json
  ```

  That URL serves `schema.json` straight out of the published npm tarball, so it
  always matches the latest release. Pin it to a major with
  `@pmelab/gtd@8/schema.json`, or point at your own install
  (`./node_modules/@pmelab/gtd/schema.json`) to work offline.

Any other top-level key is **rejected**. The engine blesses no VARIABLE NAMES
either — `testCommand` is workflow-authored data like any other `it.vars` entry,
not a special key gtd interprets.

### The `workflow:` key

A declared `workflow:` key fully REPLACES gtd's built-in default. The built-in
default is itself a YAML asset (`src/workflows/unified.yaml`) compiled through
the exact same compiler your own `workflow:` value goes through — no privileged
code path. Its shape:

```yaml
workflow:
  vars: # optional — the workflow's own declared `it.vars` defaults
    anyKey: anyScalarValue
  modes: # optional — steering-file modes a state's `mode:` may name
    <name>:
      format: <shell command> # at least one of format/validate
      validate: <shell command>
  states:
    <name>:
      actor: <string> # forbidden on a commit state, required otherwise
      script: <string> # exactly one of script/prompt/message/commit
      prompt: <string>
      message: <string>
      commit: <string>
      on: # a mapping, DECLARATION ORDER PRESERVED
        "<pattern>": <targetState> # short form
        "<pattern>": {
            to: <targetState>,
            describe: <sentence>,
            action: <label>,
          } # description/action
      initial: true # exactly one state across the whole workflow
      retry:
        max: <number>
        otherwise: <targetState>
      model: <string> # optional, opaque harness hint — forbidden on a commit state
      memory: <string> # optional, opaque memory-scope label — forbidden on a commit state
      file: <string> # optional, an Eta template naming the state's steering file
      mode: <modeName> # optional, requires "file" — a built-in (qa/review/prose) or a `modes:` entry
```

Besides `it.vars` (below), a `script`/`prompt`/`message`/`commit` template sees:

- **`it.startCommit`** — the process's diff base (the commit the current cycle
  started from, or a `gtd review <commitish>` entry's resolved base).
- **`it.reviewBase`** — the previous review round's boundary, falling back to
  `it.startCommit` on a first review.
- **`it.retainedBase`** — the process's trace/retry boundary, what a squash
  actually keeps (never moved by a `gtd review` entry).
- **`it.currentCommit`** / **`it.previousCommit`** — HEAD's hash and its parent,
  at render time.

A template never sees rendered diff CONTENT — no field carries a diff. It names
a base and leaves the agent to run `git diff <base>` itself; this keeps every
render cheap (no diff computed on `gtd next`/`gtd status`/`gtd lsp`) and the
prompt small and cacheable.

Authoring or editing a workflow with a coding agent? `skills/authoring/SKILL.md`
is the agent-facing contract for producing a valid `workflow:` — the state
model, pattern grammar, load-time rules, and how to verify a change compiles.

### Variables

Every template — `script`/`prompt`/`message`/`commit`, and
`model`/`memory`/`file` — sees `it.vars`: a flat `Record<string, string>`
assembled from three layers, **later wins**:

1. **The workflow's own `vars:` key** (sibling to `states:`) — the workflow
   author's declared defaults. The unified template declares
   `vars: { testCommand: "npm test" }`, read by `checking`'s script as
   `<%~ it.vars.testCommand %>`.
2. **A top-level `.gtdrc` `vars:` key** (a sibling of `workflow:`, NOT nested
   inside it) — per-repo tuning without redefining the whole workflow.
3. **`GTD_<UPPERCASE-name>` environment variables** — highest precedence,
   checked at every invocation, case-insensitively against each name already
   declared by layer 1 or 2: `GTD_TESTCOMMAND` overrides `testCommand`. The
   environment can only OVERRIDE a name a config layer already declared — a
   `GTD_*` var matching no declared name is silently ignored.

Values in layers 1–2 must be YAML scalars (string/number/boolean), coerced to
strings at load time; an object or array value is a load error.

```yaml
# .gtdrc — overriding the unified template's testCommand
vars:
  testCommand: npm run test:ci
```

```bash
# highest precedence — beats both the workflow default and the .gtdrc value above
GTD_TESTCOMMAND="npm run test -- --bail" gtd next
```

### Lookup and precedence

gtd walks from the current working directory **up to your home directory** (or
to the filesystem root when cwd is outside home), collecting every `.gtdrc` it
finds along the way. All found levels are **deep-merged**, with the **innermost
(cwd) config winning** on conflicts — so a shared `.gtdrc` in a worktree-parent
directory cascades to every checkout beneath it, while any individual checkout
can still override with its own `.gtdrc`.

### Validation and errors

Config-shape problems (unknown keys, wrong types, unreadable file references)
are collected together; if the shape is clean, the assembled definition is
additionally run through the engine's own validation. A bad config throws
**one** error listing every finding, at load time — before anything touches the
repository — never partially, and never deferred to step time:

```
workflow config:
  - state "idle": must declare exactly one of script/prompt/message/commit (found 2)
  - state "idle": "on" target "nowhere" is not a defined state
```

Those findings include the **semantic graph checks**: every `on` target and
`retry.otherwise` must name a defined state, and every state must be
**reachable** from the initial state. All load failures exit **1** and write to
**stderr**, never stdout.

Many of these problems never reach gtd at all if your editor validates against
the [published schema](#schema), which fully types the `workflow:` key. The
rules JSON Schema cannot express — exactly one content kind, exactly one
`initial: true`, targets naming defined states, reachability — remain the
compiler's job at load time.

## Repository requirements

- **Single writer, linear branch.** A process's history is walked via
  **first-parent** commits only.
- **Test/build artifacts must be gitignored.** This is **load-bearing**, not a
  style preference: every step decision detects "clean" via
  `git diff --name-status HEAD` (tracked changes) unioned with
  `git ls-files --others --exclude-standard` (untracked files), which silently
  omits anything matched by `.gitignore`. If a `script` state's command (or the
  build it triggers) writes output — a `dist/`, a coverage report, a log file —
  into the working tree, the tree never goes clean after a green run, and the
  check's `"C"` pattern never fires. Gitignore every path your scripts write
  before wiring gtd into a repo.
- **Repository root invocation.** Every state subcommand must run from the git
  repository root. `--help`/`--version` (and the `help`/`version` subcommands),
  `lsp`, and `visualize` skip this guard entirely (`visualize` still reads the
  `.gtdrc` workflow, but needs no git state).
- **Linked worktrees are independent.** N `git worktree` worktrees of one
  repository (sharing a single `.git`) each run their own gtd process: state is
  derived from that worktree's own HEAD, and the review checkout window's refs
  live in git's per-worktree `refs/worktree/gtd/*` namespace, so a review
  resting in one worktree neither blocks nor rewrites any other.

## Editor integration

`gtd lsp` starts an LSP server over stdio for `.gtd/` steering files — a symbol
per `review`-mode chunk that still has an unchecked hunk (an outline of the
packages left to review) plus check/uncheck actions over those chunks,
go-to-definition from a `review`-mode hunk line into the file it points at (at
its `#line`), symbols over a `qa`-mode file's open questions plus "pick this
option"/"uncheck this option" code actions on each option — offered anywhere on
the option's list item, including any wrapped continuation lines, not just its
own `- [ ]` line — diagnostics for both (live as you edit), and a
`gtd.openSteeringFile` command that jumps to the current state's steering file.

It is config-driven via each state's `file:`/`mode:`, and falls back to basename
dispatch (`REVIEW.md` → `review`) with no config in sight. `qa` and `review` are
gtd's built-in steering-file MODES with a VALIDATOR gtd itself implements; a
mode's `format:` and `validate:` are shell commands a workflow (or a project's
`.gtdrc`) declares for itself, so you bring your own formatter and your own
checkers. A third built-in, `prose` — format-only, no validator, used by the
simple flow's plan file — has no live editor support: `gtd lsp` publishes no
symbols or diagnostics for it, though `gtd validate` and the `gtd step` gate
still format and validate it like any other mode.

## Development

```bash
npm install
npm run dev          # run from source, no build (node dev/run.mjs)
npm run build        # tsdown → dist/gtd.bundle.mjs
npm test             # format:check, typecheck, lint, unit + e2e tests, fallow
npm run test:unit    # vitest unit tests (the pure resolver) — --project unit
npm run test:e2e     # gherkin e2e via vitest + quickpickle — --project e2e
npm run test:mutation # StrykerJS mutation testing (manual only, ~10 min)
npm run typecheck
npm run lint
```

A pre-commit hook is installed automatically via the `prepare` script when you
run `npm install` on a fresh clone — it runs
[lint-staged](https://github.com/lint-staged/lint-staged) with
[oxfmt](https://oxc.rs/docs/guide/usage/formatter.html), mirroring the
`format:check` step enforced in CI.

The decision core is pure and IO-free: the pattern machine's shape (states,
patterns, retry) is a plain-data `WorkflowDefinition` (`src/PatternMachine.ts`),
and the same module's `resolveState`/`step` are the pure resolver/interpreter
over it — so the whole engine is trivially unit-testable in isolation. All
git/filesystem/template IO is confined to the edge (`src/Edge.ts`).

Releases are automatic: push releasable Conventional Commits (`fix:`, `feat:`,
or breaking changes) to `main` and semantic-release computes the next version,
builds the bundle, tags it, and publishes.

## License

MIT
